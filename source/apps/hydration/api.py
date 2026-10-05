"""
mvmOS Hydration — a per Apps Hub account drink journal.

Mounted at /pub/hydration by public_loader.py. Identity is the Apps Hub token
(X-Pub-Token header), used identically by the desktop window and the public
page, so there is no separate backend.py.

Every drink carries six numbers per 100 ml: the share of it that is water
(percent), its caffeine (mg), its alcohol (percent by volume), its energy
(kcal), its sugar (g) and its protein (g). Solid foods that hold water, such
as soup, yogurt or fruit, are counted by weight, one gram as one millilitre. An entry
stores a snapshot of those numbers, so editing or deleting a custom drink never
rewrites history. Water counted for an entry is amount * water_percent / 100.

A "day" is the client's local calendar date (YYYY-MM-DD), sent by the browser,
so the journal follows the user's own midnight and not the server's. A user who
goes to bed late can move the end of their day to a later hour (day_end_hour):
until then the browser still sends the previous date. The day is stored with
every entry, so changing that hour later never moves drinks already logged.

Every drink has a colour (the ring and the history are drawn in it) and custom
drinks have their own emoji icon. Entries keep a copy of both, so a drink that
was deleted still shows as it was.
"""
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone

from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "hydration"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ALCOHOL_G_PER_ML = 0.789
MAX_AMOUNT_ML = 5000
MAX_SERVINGS = 12
DEFAULT_CUSTOM_SERVINGS = [150, 250, 500]

# Generic values per 100 ml, rounded. Recipes and brands vary, which is what
# custom drinks are for. id -> (emoji, water %, caffeine mg, alcohol % vol)
PRESETS = {
    "water":       ("💧", 100, 0, 0),
    "coffee":      ("☕", 99, 40, 0),
    "espresso":    ("☕", 90, 212, 0),
    "black_tea":   ("🍵", 99, 20, 0),
    "green_tea":   ("🍵", 99, 12, 0),
    "milk":        ("🥛", 88, 0, 0),
    "juice":       ("🧃", 88, 0, 0),
    "soft_drink":  ("🥤", 90, 10, 0),
    "energy":      ("⚡", 89, 32, 0),
    "beer":        ("🍺", 92, 0, 5),
    "wine":        ("🍷", 86, 0, 12),
    "spirits":     ("🥃", 60, 0, 40),
    "herbal_tea":  ("🌿", 99, 0, 0),
    "cocoa":       ("🍫", 82, 2, 0),
    "protein_shake": ("💪", 85, 0, 0),
    "kefir":       ("🥛", 89, 0, 0),
    "ayran":       ("🥛", 95, 0, 0),
    "plant_milk":  ("🌱", 90, 0, 0),
    "smoothie":    ("🥤", 80, 0, 0),
    "coconut_water": ("🥥", 95, 0, 0),
    "sports_drink": ("🏃", 94, 0, 0),
    "soup":        ("🍲", 90, 0, 0),
    "yogurt":      ("🍶", 85, 0, 0),
    "fruit":       ("🍉", 85, 0, 0),
    "cider":       ("🍏", 90, 0, 5),
}

# Energy (kcal), sugar (g) and protein (g) per 100 ml, generic averages like the
# values above. A drink not listed here has none of them.
PRESET_NUTRI = {
    "coffee": (1, 0, 0.1), "espresso": (9, 0, 1.7), "black_tea": (1, 0, 0), "green_tea": (1, 0, 0),
    "milk": (46, 5, 3.4), "juice": (45, 10, 0.5), "soft_drink": (42, 10.6, 0), "energy": (45, 11, 0),
    "beer": (43, 0, 0.5), "wine": (83, 1, 0.1), "spirits": (231, 0, 0),
    "cocoa": (77, 9.5, 3.3), "protein_shake": (55, 3, 8), "kefir": (41, 4, 3.4), "ayran": (25, 2, 1.7),
    "plant_milk": (35, 2.5, 1.5), "smoothie": (55, 10, 1), "coconut_water": (19, 3.7, 0.7),
    "sports_drink": (26, 6, 0), "soup": (35, 1, 2), "yogurt": (60, 4.7, 3.8), "fruit": (52, 10, 0.6),
    "cider": (45, 4, 0),
}
# Ready-made drinks added after the first release stay off the main screen until
# the user shows them in Settings, so nobody's drink list suddenly grows.
# The colour each ready-made drink is drawn in until the user picks another.
PRESET_COLORS = {
    "water": "#4ea8ff", "coffee": "#8b5a2b", "espresso": "#4e2a12", "black_tea": "#c0702a",
    "green_tea": "#6a9f2e", "milk": "#e8dfc8", "juice": "#ffa726", "soft_drink": "#8c1d18",
    "energy": "#c6e600", "beer": "#f2b705", "wine": "#8e244d", "spirits": "#c98b3c",
    "herbal_tea": "#9ccc65", "cocoa": "#6d4c41", "protein_shake": "#ab47bc", "kefir": "#c8d6e5",
    "ayran": "#9fd8cf", "plant_milk": "#c9b458", "smoothie": "#ec407a", "coconut_water": "#7fdfee",
    "sports_drink": "#00bfa5", "soup": "#ff7043", "yogurt": "#e1bee7", "fruit": "#ef5350",
    "cider": "#d8c44a",
}
# Custom drinks without a chosen colour get one of these, picked by their id,
# so two of them rarely look the same.
CUSTOM_PALETTE = ("#e57373", "#f06292", "#ba68c8", "#7986cb", "#4fc3f7", "#4db6ac", "#81c784",
                  "#dce775", "#ffd54f", "#ffb74d", "#a1887f", "#90a4ae")
DEFAULT_CUSTOM_ICON = "🧪"
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
MAX_DAY_END_HOUR = 8
HIDDEN_BY_DEFAULT = {"herbal_tea", "cocoa", "protein_shake", "kefir", "ayran", "plant_milk", "smoothie",
                     "coconut_water", "sports_drink", "soup", "yogurt", "fruit", "cider"}
NUTRI_FIELDS = (("calories_kcal_100", 900), ("sugar_g_100", 100), ("protein_g_100", 100))

# Standard servings in ml for the ready-made drinks. A user who drinks other
# sizes replaces them (per drink, for that user only).
PRESET_SERVINGS = {
    "water":     [100, 200, 250, 330, 500],
    "coffee":    [100, 150, 250],
    "espresso":  [30, 60],
    "black_tea": [150, 250, 350],
    "green_tea": [150, 250, 350],
    "milk":      [100, 200, 250],
    "juice":     [150, 200, 250],
    "soft_drink": [250, 330, 500],
    "energy":    [250, 330, 500],
    "beer":      [330, 500],
    "wine":      [125, 150, 250],
    "spirits":   [40, 50],
    "herbal_tea": [150, 250, 350],
    "cocoa":     [150, 250, 330],
    "protein_shake": [250, 330, 500],
    "kefir":     [150, 250, 500],
    "ayran":     [250, 330, 500],
    "plant_milk": [100, 200, 250],
    "smoothie":  [200, 300, 400],
    "coconut_water": [250, 330, 500],
    "sports_drink": [330, 500, 750],
    "soup":      [200, 300, 400],
    "yogurt":    [125, 150, 200],
    "fruit":     [100, 200, 300],
    "cider":     [330, 500],
}


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                product_id TEXT NOT NULL,
                name TEXT NOT NULL,
                amount_ml REAL NOT NULL,
                water_percent REAL NOT NULL,
                caffeine_mg_100 REAL NOT NULL,
                alcohol_percent REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hy_entries ON entries(user_id, day);
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY,
                unit TEXT NOT NULL DEFAULT 'ml',
                target_ml REAL NOT NULL DEFAULT 2000,
                day_end_hour INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                water_percent REAL NOT NULL,
                caffeine_mg_100 REAL NOT NULL DEFAULT 0,
                alcohol_percent REAL NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_hy_products ON products(user_id);
            CREATE TABLE IF NOT EXISTS preset_overrides (
                user_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                water_percent REAL NOT NULL,
                caffeine_mg_100 REAL NOT NULL,
                alcohol_percent REAL NOT NULL,
                PRIMARY KEY (user_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS drink_prefs (
                user_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                servings TEXT,
                last_used TEXT,
                PRIMARY KEY (user_id, product_id)
            );
            CREATE TABLE IF NOT EXISTS cfg (
                key TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE TABLE IF NOT EXISTS rewards (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                amount REAL NOT NULL DEFAULT 0,
                to_category TEXT,
                from_category TEXT
            );
            CREATE TABLE IF NOT EXISTS health_link (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS reward_days (
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS day_goals (
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                target_ml REAL NOT NULL,
                PRIMARY KEY (user_id, day)
            );
            CREATE TABLE IF NOT EXISTS serving_use (
                user_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                amount_ml REAL NOT NULL,
                last_used TEXT NOT NULL,
                PRIMARY KEY (user_id, product_id, amount_ml)
            );
        """)
        # The energy, sugar and protein of a drink came later than the table.
        for table in ("entries", "products", "preset_overrides"):
            have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
            for col, _ in NUTRI_FIELDS:
                if col not in have:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {col} REAL NOT NULL DEFAULT 0")
        # Colours, icons and the end of the day came later still.
        for table, col, decl in (("settings", "day_end_hour", "INTEGER NOT NULL DEFAULT 0"),
                                 ("drink_prefs", "color", "TEXT"), ("products", "icon", "TEXT"),
                                 ("preset_overrides", "name", "TEXT NOT NULL DEFAULT ''"),
                                 ("entries", "color", "TEXT"), ("entries", "icon", "TEXT"),
                                 ("health_link", "goals_sent", "INTEGER NOT NULL DEFAULT 0")):
            if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
        # Days logged before each day kept its own goal get the goal of today.
        c.execute("INSERT OR IGNORE INTO day_goals(user_id,day,target_ml) "
                  "SELECT DISTINCT e.user_id, e.day, COALESCE(s.target_ml, 2000) FROM entries e "
                  "LEFT JOIN settings s ON s.user_id = e.user_id")
        c.commit()


_init_db()


def _premium():
    """This app's premium module, or None on an install that was never sent
    it. Looked up per request: premium/ is deleted when a licence lapses."""
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def _reward_offered():
    """Whether profiles may see and use the Budget reward: the owner switched
    the integration on and the premium module that pays it is present and
    licensed. Without that module there is no code to pay with."""
    with _db() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='budget_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return False
    prem = _premium()
    return bool(prem and prem.is_available())


def _reward_settings(c, uid):
    row = c.execute("SELECT enabled,amount,to_category,from_category FROM rewards WHERE user_id=?", (uid,)).fetchone()
    if not row:
        return {"enabled": False, "amount": 0, "to_category": None, "from_category": None}
    return {"enabled": bool(row["enabled"]), "amount": row["amount"],
            "to_category": row["to_category"], "from_category": row["from_category"]}


def _goal_hook(uid, day):
    """Called after an entry was added or enlarged. Pays the profile's Budget
    reward once per day, the moment the water goal is reached. Best-effort:
    returns {"amount"} when paid, else None, and never raises."""
    try:
        if abs((datetime.now().date() - datetime.strptime(day, "%Y-%m-%d").date()).days) > 1:
            return None
        if not _reward_offered():
            return None
        with _db() as c:
            rw = _reward_settings(c, uid)
            target = _settings(c, uid)["target_ml"]
        if not (rw["enabled"] and rw["amount"] > 0 and rw["to_category"]):
            return None
        if _get_day(uid, day)["totals"]["water_ml"] < target:
            return None
        with _db() as c:
            cur = c.execute("INSERT OR IGNORE INTO reward_days(user_id,day) VALUES(?,?)", (uid, day))
            c.commit()
            if not cur.rowcount:
                return None
        res = _premium().pay(uid, day, rw["amount"], rw["to_category"], rw["from_category"])
        if not res.get("ok"):
            with _db() as c:  # not paid: let a later drink try again
                c.execute("DELETE FROM reward_days WHERE user_id=? AND day=?", (uid, day))
                c.commit()
            return None
        return {"amount": rw["amount"], "currency": res.get("currency")}
    except Exception:
        return None


# ── Health integration ───────────────────────────────────────────
# Opt-in per profile. Hydration keeps only the choice; the numbers are sent to
# Health's app API as this app's total for the day, so Health always shows what
# Hydration shows and a corrected or deleted entry corrects Health as well.

HEALTH_SYNC_DAYS = 90


def _health_enabled(uid):
    with _db() as c:
        row = c.execute("SELECT enabled FROM health_link WHERE user_id=?", (uid,)).fetchone()
    return bool(row and row["enabled"])


def _health_available(uid):
    """Whether Health is installed and its App API is switched on."""
    hub = _hub()
    if hub is None:
        return False
    try:
        hub.call_app_api("health", "status", uid)
        return True
    except Exception:
        return False


def _push_health(uid, day):
    """Send this day's totals to Health. Best-effort: a missing Health or a
    disabled App API never affects the drink that was just logged. True when
    Health took the day's goal too."""
    try:
        if not _health_enabled(uid):
            return
        hub = _hub()
        if hub is None:
            return
        d = _get_day(uid, day)
        t = d["totals"]
        values = {"water": round(t["water_ml"], 1), "caffeine": round(t["caffeine_mg"], 1),
                  "alcohol": round(t["alcohol_g"], 1), "calories": round(t["calories_kcal"], 1),
                  "sugar": round(t["sugar_g"], 1), "protein": round(t["protein_g"], 1)}
        try:
            hub.call_app_api("health", "record_daily", uid, day, values, source_app=APP_ID,
                             source_app_name="Hydration", goals={"water": d["target_ml"]})
            return True
        except TypeError:  # a Health from before goals: the amounts still go
            hub.call_app_api("health", "record_daily", uid, day, values, source_app=APP_ID,
                             source_app_name="Hydration")
    except Exception:
        pass


def _health_sync(uid):
    """Send the recent days that have entries, when the link is switched on."""
    since = (datetime.now() - timedelta(days=HEALTH_SYNC_DAYS)).strftime("%Y-%m-%d")
    with _db() as c:
        days = [r["day"] for r in c.execute(
            "SELECT DISTINCT day FROM entries WHERE user_id=? AND day>=? ORDER BY day", (uid, since))]
    took = [_push_health(uid, d) for d in days]
    return len(days), all(took)


def _mark_goals_sent(uid):
    with _db() as c:
        c.execute("UPDATE health_link SET goals_sent=1 WHERE user_id=?", (uid,))
        c.commit()


def _send_goals_once(uid):
    """A link made before days kept their goal sent Health the amounts only:
    the recent days go once more, now with their goals."""
    with _db() as c:
        r = c.execute("SELECT enabled, goals_sent FROM health_link WHERE user_id=?", (uid,)).fetchone()
    if r and r["enabled"] and not r["goals_sent"] and _health_available(uid) and _health_sync(uid)[1]:
        _mark_goals_sent(uid)


def _set_health_link(uid, enabled):
    with _db() as c:
        c.execute("INSERT INTO health_link(user_id,enabled) VALUES(?,?) "
                  "ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled", (uid, 1 if enabled else 0))
        c.commit()
    synced, goals = _health_sync(uid) if enabled else (0, False)
    if goals:
        _mark_goals_sent(uid)
    return {"enabled": bool(enabled), "available": _health_available(uid), "synced_days": synced}


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _num(v, lo, hi, default=None):
    if v is None:
        return default
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v != v or v < lo or v > hi:
        return None
    return v


# ── Models ───────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    unit: str = "ml"
    target_ml: float = 2000
    day_end_hour: Optional[int] = None


class ProductBody(BaseModel):
    name: str = "-"
    water_percent: float = 100
    caffeine_mg_100: float = 0
    alcohol_percent: float = 0
    calories_kcal_100: Optional[float] = None
    sugar_g_100: Optional[float] = None
    protein_g_100: Optional[float] = None
    servings: Optional[List[float]] = None
    active: Optional[bool] = None
    icon: Optional[str] = None
    color: Optional[str] = None


class PrefsBody(BaseModel):
    servings: Optional[List[float]] = None
    active: Optional[bool] = None
    color: Optional[str] = None


class EntryBody(BaseModel):
    day: str
    amount_ml: float
    product_id: str = "water"


class RewardBody(BaseModel):
    enabled: bool = False
    amount: float = 0
    to_category: Optional[str] = None
    from_category: Optional[str] = None


class HealthBody(BaseModel):
    enabled: bool = False


class AmountBody(BaseModel):
    amount_ml: float


# ── Helpers ──────────────────────────────────────────────────────

def _settings(c, uid):
    row = c.execute("SELECT unit,target_ml,day_end_hour FROM settings WHERE user_id=?", (uid,)).fetchone()
    if not row:
        return {"unit": "ml", "target_ml": 2000, "day_end_hour": 0}
    return {"unit": row["unit"], "target_ml": row["target_ml"], "day_end_hour": row["day_end_hour"]}


def _today(uid, conn=None):
    """Today for this user by the server's clock: before their day_end_hour it
    is still yesterday, the same rule the browser follows."""
    if conn is not None:
        hour = _settings(conn, uid)["day_end_hour"]
    else:
        with _db() as c:
            hour = _settings(c, uid)["day_end_hour"]
    now = datetime.now()
    if now.hour < hour:
        now -= timedelta(days=1)
    return now.strftime("%Y-%m-%d")


# Every day keeps the goal it had: today follows the goal setting, and a day
# that is over keeps the goal it ended with when the goal is changed later.

def _keep_goal(c, uid, day):
    target = _settings(c, uid)["target_ml"]
    verb = "INSERT INTO day_goals(user_id,day,target_ml) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET target_ml=excluded.target_ml" \
        if day >= _today(uid, c) else "INSERT OR IGNORE INTO day_goals(user_id,day,target_ml) VALUES(?,?,?)"
    c.execute(verb, (uid, day, target))


def _day_goals(c, uid, start, end):
    return {r["day"]: r["target_ml"] for r in c.execute(
        "SELECT day,target_ml FROM day_goals WHERE user_id=? AND day>=? AND day<=?", (uid, start, end))}


def _goal_of(uid, day):
    """The goal of one day: the one it kept, else the goal setting."""
    with _db() as c:
        return _day_goals(c, uid, day, day).get(day) or _settings(c, uid)["target_ml"]


def _clean_color(v):
    if v is None:
        return None
    if not isinstance(v, str) or not COLOR_RE.match(v):
        raise ValueError("invalid_color")
    return v.lower()


def _clean_icon(v):
    """An emoji (or a few characters) for a custom drink; None keeps the old one."""
    if v is None:
        return None
    v = v.strip() if isinstance(v, str) else ""
    if not v or len(v) > 16 or any(ch in v for ch in "<>&\"'"):
        raise ValueError("invalid_icon")
    return v


def _default_color(product_id):
    if product_id in PRESET_COLORS:
        return PRESET_COLORS[product_id]
    return CUSTOM_PALETTE[sum(map(ord, product_id or "")) % len(CUSTOM_PALETTE)]


def _products(c, uid):
    rows = c.execute(
        "SELECT id,name,icon,water_percent,caffeine_mg_100,alcohol_percent,calories_kcal_100,sugar_g_100,protein_g_100"
        " FROM products WHERE user_id=? ORDER BY name COLLATE NOCASE",
        (uid,),
    ).fetchall()
    return [{**dict(r), "icon": r["icon"] or DEFAULT_CUSTOM_ICON} for r in rows]


def _presets(c, uid):
    """The ready-made drinks with this user's own changes applied."""
    over = {r["product_id"]: r for r in c.execute(
        "SELECT product_id,name,water_percent,caffeine_mg_100,alcohol_percent,calories_kcal_100,sugar_g_100,protein_g_100"
        " FROM preset_overrides WHERE user_id=?", (uid,))}
    out = []
    for k, (icon, w, caf, alc) in PRESETS.items():
        o = over.get(k)
        out.append({
            "id": k, "icon": icon, "modified": bool(o), "name": o["name"] if o else "",
            "water_percent": o["water_percent"] if o else w,
            "caffeine_mg_100": o["caffeine_mg_100"] if o else caf,
            "alcohol_percent": o["alcohol_percent"] if o else alc,
            **{col: (o[col] if o else PRESET_NUTRI.get(k, (0, 0, 0))[i]) for i, (col, _) in enumerate(NUTRI_FIELDS)},
        })
    return out


def _clean_servings(v):
    if not isinstance(v, (list, tuple)):
        raise ValueError("invalid_servings")
    out = []
    for x in v:
        n = _num(x, 1, MAX_AMOUNT_ML)
        if n is None:
            raise ValueError("invalid_servings")
        n = round(n, 1)
        if n not in out:
            out.append(n)
    if len(out) > MAX_SERVINGS:
        raise ValueError("too_many_servings")
    return sorted(out)


def _drinks(c, uid):
    """Every drink of this user, ready-made first: values, whether it is shown
    on the main screen, its servings and when it and each serving were last used."""
    prefs = {r["product_id"]: r for r in c.execute(
        "SELECT product_id,active,servings,last_used,color FROM drink_prefs WHERE user_id=?", (uid,))}
    used = {}
    for r in c.execute("SELECT product_id,amount_ml,last_used FROM serving_use WHERE user_id=?", (uid,)):
        used.setdefault(r["product_id"], {})[r["amount_ml"]] = r["last_used"]
    out = []

    def build(base, defaults):
        pr = prefs.get(base["id"])
        raw = json.loads(pr["servings"]) if pr and pr["servings"] is not None else defaults
        u = used.get(base["id"], {})
        base["active"] = bool(pr["active"]) if pr else base["id"] not in HIDDEN_BY_DEFAULT
        base["last_used"] = pr["last_used"] if pr else None
        base["color"] = (pr["color"] if pr else None) or _default_color(base["id"])
        base["servings"] = [{"ml": ml, "last_used": u.get(ml)} for ml in sorted(raw)]
        out.append(base)

    for p in _presets(c, uid):
        p["kind"] = "ready"
        build(p, PRESET_SERVINGS[p["id"]])
    for p in _products(c, uid):
        p["kind"] = "custom"
        build(p, DEFAULT_CUSTOM_SERVINGS)
    return out


def _find_product(c, uid, product_id):
    if product_id in PRESETS:
        p = next(x for x in _presets(c, uid) if x["id"] == product_id)
        return {"id": product_id, "name": product_id, "water_percent": p["water_percent"],
                "caffeine_mg_100": p["caffeine_mg_100"], "alcohol_percent": p["alcohol_percent"],
                **{col: p[col] for col, _ in NUTRI_FIELDS}}
    row = c.execute(
        "SELECT id,name,water_percent,caffeine_mg_100,alcohol_percent,calories_kcal_100,sugar_g_100,protein_g_100"
        " FROM products WHERE id=? AND user_id=?",
        (product_id, uid),
    ).fetchone()
    return dict(row) if row else None


def _entry_out(r):
    amount = r["amount_ml"]
    return {
        "color": r["color"] or _default_color(r["product_id"]),
        "icon": r["icon"] or (PRESETS[r["product_id"]][0] if r["product_id"] in PRESETS else DEFAULT_CUSTOM_ICON),
        "id": r["id"],
        "day": r["day"],
        "recorded_at": r["recorded_at"],
        "product_id": r["product_id"],
        "name": r["name"],
        "amount_ml": amount,
        "water_percent": r["water_percent"],
        "caffeine_mg_100": r["caffeine_mg_100"],
        "alcohol_percent": r["alcohol_percent"],
        "calories_kcal_100": r["calories_kcal_100"],
        "sugar_g_100": r["sugar_g_100"],
        "protein_g_100": r["protein_g_100"],
        "calories_kcal": amount * r["calories_kcal_100"] / 100.0,
        "sugar_g": amount * r["sugar_g_100"] / 100.0,
        "protein_g": amount * r["protein_g_100"] / 100.0,
        "water_ml": amount * r["water_percent"] / 100.0,
        "caffeine_mg": amount * r["caffeine_mg_100"] / 100.0,
        "alcohol_g": amount * r["alcohol_percent"] / 100.0 * ALCOHOL_G_PER_ML,
    }


def _totals(entries):
    return {
        "amount_ml": sum(e["amount_ml"] for e in entries),
        "water_ml": sum(e["water_ml"] for e in entries),
        "caffeine_mg": sum(e["caffeine_mg"] for e in entries),
        "alcohol_g": sum(e["alcohol_g"] for e in entries),
        "calories_kcal": sum(e["calories_kcal"] for e in entries),
        "sugar_g": sum(e["sugar_g"] for e in entries),
        "protein_g": sum(e["protein_g"] for e in entries),
    }


# ── Operations ───────────────────────────────────────────────────
# Shared by the routes below and by app_api.py. They raise ValueError with a
# short reason for bad input and LookupError("not found") for a missing record.

def _check_day(day):
    if not isinstance(day, str) or not DAY_RE.match(day):
        raise ValueError("invalid_day")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise ValueError("invalid_day")
    return day


def _get_day(uid, day):
    _check_day(day)
    with _db() as c:
        rows = c.execute(
            "SELECT * FROM entries WHERE user_id=? AND day=? ORDER BY recorded_at DESC", (uid, day)
        ).fetchall()
    entries = [_entry_out(r) for r in rows]
    return {"day": day, "entries": entries, "totals": _totals(entries), "target_ml": _goal_of(uid, day)}


def _get_history(uid, end, days):
    _check_day(end)
    days = max(1, min(int(days), 90))
    end_d = datetime.strptime(end, "%Y-%m-%d")
    start = (end_d - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with _db() as c:
        rows = c.execute(
            "SELECT * FROM entries WHERE user_id=? AND day>=? AND day<=?", (uid, start, end)
        ).fetchall()
        goals = _day_goals(c, uid, start, end)
    by_day = {}
    for r in sorted(rows, key=lambda r: r["recorded_at"]):
        by_day.setdefault(r["day"], []).append(_entry_out(r))
    return [
        {"day": d, **_totals(by_day.get(d, [])), "drinks": _by_drink(by_day.get(d, [])), "target_ml": goals.get(d)}
        for d in ((end_d - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d") for i in range(days))
    ]


def _by_drink(entries):
    """A day's totals per drink, in the order the drinks were first had."""
    out = {}
    for e in entries:
        d = out.setdefault(e["product_id"], {"product_id": e["product_id"], "name": e["name"], "color": e["color"],
                                             "icon": e["icon"], "amount_ml": 0, "water_ml": 0})
        d["amount_ml"] += e["amount_ml"]
        d["water_ml"] += e["water_ml"]
    return list(out.values())


def _add_entry(uid, day, amount_ml, product_id):
    _check_day(day)
    amount = _num(amount_ml, 1, MAX_AMOUNT_ML)
    if amount is None:
        raise ValueError("invalid_amount")
    with _db() as c:
        p = _find_product(c, uid, product_id)
        if not p:
            raise LookupError("not found")
        look = _drink(c, uid, p["id"])
        eid = uuid.uuid4().hex
        c.execute(
            "INSERT INTO entries(id,user_id,day,recorded_at,product_id,name,amount_ml,water_percent,caffeine_mg_100,alcohol_percent,"
            "calories_kcal_100,sugar_g_100,protein_g_100,color,icon) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (eid, uid, day, datetime.now(timezone.utc).isoformat(), p["id"], p["name"], amount,
             p["water_percent"], p["caffeine_mg_100"], p["alcohol_percent"],
             p["calories_kcal_100"], p["sugar_g_100"], p["protein_g_100"], look["color"], look["icon"]),
        )
        now = datetime.now(timezone.utc).isoformat()
        c.execute(
            "INSERT INTO drink_prefs(user_id,product_id,last_used) VALUES(?,?,?) "
            "ON CONFLICT(user_id,product_id) DO UPDATE SET last_used=excluded.last_used",
            (uid, p["id"], now),
        )
        c.execute(
            "INSERT INTO serving_use(user_id,product_id,amount_ml,last_used) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id,product_id,amount_ml) DO UPDATE SET last_used=excluded.last_used",
            (uid, p["id"], round(amount, 1), now),
        )
        _keep_goal(c, uid, day)
        c.commit()
        row = c.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
    out = _entry_out(row)
    _push_health(uid, day)
    reward = _goal_hook(uid, day)
    if reward:
        out["reward"] = reward
    return out


def _set_amount(uid, entry_id, amount_ml):
    amount = _num(amount_ml, 1, MAX_AMOUNT_ML)
    if amount is None:
        raise ValueError("invalid_amount")
    with _db() as c:
        cur = c.execute("UPDATE entries SET amount_ml=? WHERE id=? AND user_id=?", (amount, entry_id, uid))
        if not cur.rowcount:
            raise LookupError("not found")
        row = c.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()
        _keep_goal(c, uid, row["day"])
        c.commit()
    out = _entry_out(row)
    _push_health(uid, row["day"])
    reward = _goal_hook(uid, row["day"])
    if reward:
        out["reward"] = reward
    return out


def _delete_entry(uid, entry_id):
    with _db() as c:
        row = c.execute("SELECT day FROM entries WHERE id=? AND user_id=?", (entry_id, uid)).fetchone()
        cur = c.execute("DELETE FROM entries WHERE id=? AND user_id=?", (entry_id, uid))
        c.commit()
    if not cur.rowcount:
        raise LookupError("not found")
    _push_health(uid, row["day"])
    return {"ok": True}


def _product_values(name, water_percent, caffeine_mg_100, alcohol_percent):
    name = (name or "").strip()[:60]
    if not name:
        raise ValueError("name_required")
    w = _num(water_percent, 0, 100)
    caf = _num(caffeine_mg_100, 0, 1000, 0)
    alc = _num(alcohol_percent, 0, 100, 0)
    if w is None or caf is None or alc is None:
        raise ValueError("invalid_value")
    return name, w, caf, alc


def _nutri(kcal, sugar, protein):
    """The energy, sugar and protein sent with a drink: a validated number, or
    None for one that was not sent (a new drink then has none, an edited one
    keeps what it had)."""
    out = []
    for v, (_, hi) in zip((kcal, sugar, protein), NUTRI_FIELDS):
        n = _num(v, 0, hi)
        if v is not None and n is None:
            raise ValueError("invalid_value")
        out.append(n)
    return out


def _drink(c, uid, product_id):
    return next(d for d in _drinks(c, uid) if d["id"] == product_id)


def _save_prefs(c, uid, product_id, active=None, servings=None, reset_servings=False, color=None):
    """Change what this user chose for a drink; None leaves a field as it was."""
    c.execute("INSERT OR IGNORE INTO drink_prefs(user_id,product_id) VALUES(?,?)", (uid, product_id))
    if color is not None:
        c.execute("UPDATE drink_prefs SET color=? WHERE user_id=? AND product_id=?", (color, uid, product_id))
    if active is not None:
        c.execute("UPDATE drink_prefs SET active=? WHERE user_id=? AND product_id=?",
                  (1 if active else 0, uid, product_id))
    if servings is not None:
        c.execute("UPDATE drink_prefs SET servings=? WHERE user_id=? AND product_id=?",
                  (json.dumps(_clean_servings(servings)), uid, product_id))
    elif reset_servings:
        c.execute("UPDATE drink_prefs SET servings=NULL,color=NULL WHERE user_id=? AND product_id=?", (uid, product_id))


def _add_product(uid, name, water_percent, caffeine_mg_100, alcohol_percent, servings=None, active=None,
                 calories_kcal_100=None, sugar_g_100=None, protein_g_100=None, icon=None, color=None):
    vals = _product_values(name, water_percent, caffeine_mg_100, alcohol_percent)
    nut = [n or 0 for n in _nutri(calories_kcal_100, sugar_g_100, protein_g_100)]
    icon, color = _clean_icon(icon), _clean_color(color)
    if servings is not None:
        _clean_servings(servings)
    pid = uuid.uuid4().hex
    with _db() as c:
        c.execute(
            "INSERT INTO products(id,user_id,name,water_percent,caffeine_mg_100,alcohol_percent,"
            "calories_kcal_100,sugar_g_100,protein_g_100,icon) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (pid, uid, *vals, *nut, icon),
        )
        _save_prefs(c, uid, pid, active, servings, color=color)
        c.commit()
        return _drink(c, uid, pid)


def _edit_product(uid, product_id, name, water_percent, caffeine_mg_100, alcohol_percent, servings=None, active=None,
                  calories_kcal_100=None, sugar_g_100=None, protein_g_100=None, icon=None, color=None):
    vals = _product_values(name, water_percent, caffeine_mg_100, alcohol_percent)
    nut = _nutri(calories_kcal_100, sugar_g_100, protein_g_100)
    icon, color = _clean_icon(icon), _clean_color(color)
    if servings is not None:
        _clean_servings(servings)
    with _db() as c:
        cur = c.execute(
            "UPDATE products SET name=?,water_percent=?,caffeine_mg_100=?,alcohol_percent=?,"
            "calories_kcal_100=COALESCE(?,calories_kcal_100),sugar_g_100=COALESCE(?,sugar_g_100),"
            "protein_g_100=COALESCE(?,protein_g_100),icon=COALESCE(?,icon) WHERE id=? AND user_id=?",
            (*vals, *nut, icon, product_id, uid),
        )
        if not cur.rowcount:
            raise LookupError("not found")
        _save_prefs(c, uid, product_id, active, servings, color=color)
        c.commit()
        return _drink(c, uid, product_id)


def _delete_product(uid, product_id):
    with _db() as c:
        cur = c.execute("DELETE FROM products WHERE id=? AND user_id=?", (product_id, uid))
        c.execute("DELETE FROM drink_prefs WHERE user_id=? AND product_id=?", (uid, product_id))
        c.execute("DELETE FROM serving_use WHERE user_id=? AND product_id=?", (uid, product_id))
        c.commit()
    if not cur.rowcount:
        raise LookupError("not found")
    return {"ok": True}


def _set_prefs(uid, product_id, active=None, servings=None, color=None):
    """Show or hide a drink, replace its servings and/or change its colour
    (ready-made or custom)."""
    color = _clean_color(color)
    with _db() as c:
        if not _find_product(c, uid, product_id):
            raise LookupError("not found")
        _save_prefs(c, uid, product_id, active, servings, color=color)
        c.commit()
        return _drink(c, uid, product_id)


def _set_preset(uid, product_id, water_percent, caffeine_mg_100, alcohol_percent, servings=None, active=None,
                calories_kcal_100=None, sugar_g_100=None, protein_g_100=None, color=None, name=None):
    """name is the user's own name for a ready-made drink; an empty one brings
    back the translated standard name and None leaves the name as it is."""
    if product_id not in PRESETS:
        raise LookupError("not found")
    _, w, caf, alc = _product_values("-", water_percent, caffeine_mg_100, alcohol_percent)
    nut = _nutri(calories_kcal_100, sugar_g_100, protein_g_100)
    color = _clean_color(color)
    if servings is not None:
        _clean_servings(servings)
    with _db() as c:
        cur = next(x for x in _presets(c, uid) if x["id"] == product_id)
        nut = [cur[col] if n is None else n for n, (col, _) in zip(nut, NUTRI_FIELDS)]
        name = cur["name"] if name is None else name.strip()[:60]
        c.execute(
            "INSERT INTO preset_overrides(user_id,product_id,name,water_percent,caffeine_mg_100,alcohol_percent,"
            "calories_kcal_100,sugar_g_100,protein_g_100) VALUES(?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(user_id,product_id) DO UPDATE SET name=excluded.name, water_percent=excluded.water_percent, "
            "caffeine_mg_100=excluded.caffeine_mg_100, alcohol_percent=excluded.alcohol_percent, "
            "calories_kcal_100=excluded.calories_kcal_100, sugar_g_100=excluded.sugar_g_100, "
            "protein_g_100=excluded.protein_g_100",
            (uid, product_id, name, w, caf, alc, *nut),
        )
        _save_prefs(c, uid, product_id, active, servings, color=color)
        c.commit()
        return _drink(c, uid, product_id)


def _reset_preset(uid, product_id):
    """Back to the standard name, values, servings and colour; shown or hidden stays as chosen."""
    if product_id not in PRESETS:
        raise LookupError("not found")
    with _db() as c:
        c.execute("DELETE FROM preset_overrides WHERE user_id=? AND product_id=?", (uid, product_id))
        _save_prefs(c, uid, product_id, reset_servings=True)
        c.commit()
        return _drink(c, uid, product_id)


def _reply(fn, *args):
    try:
        return JSONResponse(fn(*args))
    except LookupError:
        return _bad("not_found", 404)
    except ValueError as e:
        return _bad(str(e) or "invalid_request")


# ── Routes ───────────────────────────────────────────────────────

@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Hydration", "💧")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    _send_goals_once(me["id"])
    offered = _reward_offered()
    with _db() as c:
        out = {
            "settings": _settings(c, me["id"]),
            "drinks": _drinks(c, me["id"]),
            "reward_offered": offered,
        }
        if offered:
            out["reward"] = _reward_settings(c, me["id"])
    return JSONResponse(out)


@router.put("/settings")
async def put_settings(body: SettingsBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    unit = body.unit if body.unit in ("ml", "oz") else "ml"
    target = _num(body.target_ml, 100, 20000)
    if target is None:
        return _bad("invalid_target")
    hour = body.day_end_hour
    if hour is not None and not (0 <= hour <= MAX_DAY_END_HOUR):
        return _bad("invalid_day_end_hour")
    with _db() as c:
        if hour is None:  # left out: keep what was chosen
            hour = _settings(c, me["id"])["day_end_hour"]
        c.execute(
            "INSERT INTO settings(user_id,unit,target_ml,day_end_hour) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET unit=excluded.unit, target_ml=excluded.target_ml, "
            "day_end_hour=excluded.day_end_hour",
            (me["id"], unit, target, hour),
        )
        today = _today(me["id"], c)
        _keep_goal(c, me["id"], today)
        c.commit()
        logged = c.execute("SELECT 1 FROM entries WHERE user_id=? AND day=? LIMIT 1", (me["id"], today)).fetchone()
        out = _settings(c, me["id"])
    if logged:
        _push_health(me["id"], today)
    return JSONResponse(out)


@router.get("/health")
async def get_health(x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return JSONResponse({"enabled": _health_enabled(me["id"]), "available": _health_available(me["id"])})


@router.put("/health")
async def put_health(body: HealthBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return JSONResponse(_set_health_link(me["id"], body.enabled))


@router.get("/reward")
async def get_reward(x_pub_token: str = Header(default=None)):
    """The profile's Budget categories for the pickers. The categories come
    from the premium module; without it the feature does not exist."""
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    if not _reward_offered():
        return _bad("not_found", 404)
    with _db() as c:
        rw = _reward_settings(c, me["id"])
    return JSONResponse({**_premium().categories(me["id"]), "reward": rw})


@router.put("/reward")
async def put_reward(body: RewardBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    if not _reward_offered():
        return _bad("not_found", 404)
    amount = _num(body.amount, 0, 1000000000)
    if amount is None:
        return _bad("invalid_amount")
    to_cat = (body.to_category or "").strip()[:100] or None
    from_cat = (body.from_category or "").strip()[:100] or None
    if body.enabled and (not to_cat or amount <= 0):
        return _bad("invalid_reward")
    if from_cat and from_cat == to_cat:
        return _bad("same_category")
    with _db() as c:
        c.execute(
            "INSERT INTO rewards(user_id,enabled,amount,to_category,from_category) VALUES(?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, amount=excluded.amount, "
            "to_category=excluded.to_category, from_category=excluded.from_category",
            (me["id"], 1 if body.enabled else 0, amount, to_cat, from_cat),
        )
        c.commit()
        return JSONResponse(_reward_settings(c, me["id"]))


@router.get("/day")
async def get_day(day: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_get_day, me["id"], day)


@router.get("/history")
async def get_history(end: str, days: int = 7, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(lambda u, e, d: {"days": _get_history(u, e, d)}, me["id"], end, days)


@router.post("/entries")
async def add_entry(body: EntryBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_add_entry, me["id"], body.day, body.amount_ml, body.product_id)


@router.put("/entries/{entry_id}")
async def edit_entry(entry_id: str, body: AmountBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_set_amount, me["id"], entry_id, body.amount_ml)


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_delete_entry, me["id"], entry_id)


@router.put("/presets/{product_id}")
async def edit_preset(product_id: str, body: ProductBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_set_preset, me["id"], product_id, body.water_percent, body.caffeine_mg_100,
                  body.alcohol_percent, body.servings, body.active,
                  body.calories_kcal_100, body.sugar_g_100, body.protein_g_100, body.color,
                  None if body.name == "-" else body.name)


@router.delete("/presets/{product_id}")
async def reset_preset(product_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_reset_preset, me["id"], product_id)


@router.post("/products")
async def add_product(body: ProductBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_add_product, me["id"], body.name, body.water_percent, body.caffeine_mg_100,
                  body.alcohol_percent, body.servings, body.active,
                  body.calories_kcal_100, body.sugar_g_100, body.protein_g_100, body.icon, body.color)


@router.put("/products/{product_id}")
async def edit_product(product_id: str, body: ProductBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_edit_product, me["id"], product_id, body.name, body.water_percent,
                  body.caffeine_mg_100, body.alcohol_percent, body.servings, body.active,
                  body.calories_kcal_100, body.sugar_g_100, body.protein_g_100, body.icon, body.color)


@router.put("/drinks/{product_id}")
async def edit_prefs(product_id: str, body: PrefsBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_set_prefs, me["id"], product_id, body.active, body.servings, body.color)


@router.delete("/products/{product_id}")
async def delete_product(product_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_delete_product, me["id"], product_id)
