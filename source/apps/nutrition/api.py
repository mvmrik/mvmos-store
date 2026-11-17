"""
mvmOS Nutrition — a per Apps Hub account food journal.

Mounted at /pub/nutrition by public_loader.py. Identity is the Apps Hub token
(X-Pub-Token header), used identically by the desktop window and the public
page, so there is no separate backend.py.

Every food carries eight numbers per 100 g (or per 100 ml for a drink): energy
(kcal), protein, carbohydrates, of which sugars, fat, of which saturated fat,
fibre (all in g) and salt (g). A logged entry stores a snapshot of those numbers,
so editing or deleting a food later never rewrites history. Foods come from
three places: the ready-made list in foods.json (generic averages, with names in
every language in public/i18n.js), the user's own foods and recipes, and Open
Food Facts, which is asked for a barcode or a name and whose answers are kept
for the user.

Allergies, intolerances and foods to avoid are kept per profile. check() turns
them, the daily goals and the day so far into plain warnings for a food that is
about to be eaten; the window and the AI both use it, so they always agree.

A "day" is the client's local calendar date (YYYY-MM-DD); before the hour the
user chose as the end of their day it is still yesterday.
"""
import json
import os
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
import urllib.error
import uuid
from datetime import datetime, timedelta

from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "nutrition"
_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_FOODS_PATH = os.path.join(_PUBLIC_DIR, "foods.json")
_I18N = os.path.join(_PUBLIC_DIR, "i18n.js")

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_AMOUNT = 20000
MAX_DAY_END_HOUR = 8
# The meals every person starts with. They can rename, re-time or delete them
# and add their own (MAX_MEALS in all); an entry keeps the id of its meal.
DEFAULT_MEALS = (("breakfast", "🌅", "08:00"), ("lunch", "☀️", "12:00"), ("dinner", "🌙", "19:00"), ("snack", "🍎", ""))
DEFAULT_LABELS = {"breakfast": "Breakfast", "lunch": "Lunch", "dinner": "Dinner", "snack": "Snack"}
MAX_MEALS = 12
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
GOAL_TYPES = ("lose_weight", "maintain", "gain_muscle", "healthier", "high_protein", "low_carb", "custom")
ACTIVITY = (1.2, 1.375, 1.55, 1.725, 1.9)
HEALTH_SYNC_DAYS = 90
REWARD_LOOKBACK_DAYS = 7

# The numbers of a food, per 100 g or ml, with the largest sensible value.
NUTRIENTS = (("kcal", 950), ("protein", 100), ("carbs", 100), ("sugar", 100),
             ("fat", 100), ("sat_fat", 100), ("fiber", 100), ("salt", 100), ("water", 100))
NKEYS = tuple(n for n, _ in NUTRIENTS)

ALLERGENS = ("gluten", "milk", "eggs", "peanuts", "tree_nuts", "soy", "fish", "shellfish",
             "sesame", "mustard", "celery", "lupin", "molluscs", "sulphites")
# Words that give an allergen away in an ingredient list, in the languages of
# the app (lower case, matched as parts of words).
ALLERGEN_WORDS = {
    "gluten": ("gluten", "wheat", "rye", "barley", "oat", "spelt", "pšenic", "пшеница", "пшенично", "ръж", "ечемик",
               "овес", "weizen", "roggen", "gerste", "hafer", "dinkel", "trigo", "centeno", "cebada", "avena",
               "blé", "seigle", "orge", "avoine", "小麦", "大麦", "ライ麦", "オーツ", "пшенич", "рожь", "ячмень",
               "овёс", "麸质", "面粉", "farinha", "trigo", "mąka", "flour", "farina", "mehl", "harina", "farine",
               "брашно", "мука"),
    "milk": ("milk", "lactose", "whey", "casein", "butter", "cream", "cheese", "yogurt", "yoghurt", "мляко", "лактоза",
             "суроватка", "казеин", "масло", "сметана", "сирене", "кашкавал", "кисело", "milch", "laktose", "molke",
             "sahne", "käse", "joghurt", "leche", "lactosa", "suero", "nata", "queso", "yogur", "lait", "lactose",
             "crème", "fromage", "yaourt", "牛乳", "乳", "チーズ", "バター", "молоко", "лактоза", "сыр", "сливки",
             "牛奶", "乳糖", "奶酪", "奶油", "leite", "queijo", "manteiga"),
    "eggs": ("egg", "яйц", "ei ", "eier", "huevo", "oeuf", "œuf", "卵", "яйц", "鸡蛋", "蛋", "ovo"),
    "peanuts": ("peanut", "groundnut", "фъстък", "фъстъ", "erdnuss", "erdnüss", "cacahuete", "cacahuète", "ピーナッツ",
                "落花生", "арахис", "花生", "amendoim"),
    "tree_nuts": ("almond", "hazelnut", "walnut", "cashew", "pistachio", "pecan", "brazil nut", "macadamia", "nut",
                  "бадем", "лешник", "орех", "кашу", "шамфъстък", "mandel", "haselnuss", "walnuss", "nuss",
                  "almendra", "avellana", "nuez", "amande", "noisette", "noix", "アーモンド", "くるみ", "ヘーゼル",
                  "миндаль", "фундук", "грецк", "орех", "杏仁", "榛子", "核桃", "腰果", "amêndoa", "avelã", "nozes"),
    "soy": ("soy", "соя", "соев", "soja", "大豆", "豆乳", "豆腐", "соя", "соев", "黄豆", "豆浆"),
    "fish": ("fish", "salmon", "tuna", "cod", "anchov", "риба", "сьомга", "тон", "треска", "fisch", "lachs", "thunfisch",
             "pescado", "salmón", "atún", "poisson", "saumon", "thon", "魚", "サーモン", "ツナ", "рыба", "лосось",
             "тунец", "鱼", "三文鱼", "金枪鱼", "peixe", "salmão", "atum"),
    "shellfish": ("shrimp", "prawn", "crab", "lobster", "crustacean", "скарид", "рак", "омар", "garnele", "krabbe",
                  "hummer", "gamba", "camarón", "cangrejo", "crevette", "crabe", "homard", "えび", "かに", "креветк",
                  "краб", "омар", "虾", "蟹", "龙虾", "camarão", "caranguejo"),
    "sesame": ("sesame", "tahini", "сусам", "тахан", "sesam", "sésamo", "sésame", "ごま", "кунжут", "芝麻", "gergelim"),
    "mustard": ("mustard", "горчица", "senf", "mostaza", "moutarde", "からし", "マスタード", "горчиц", "芥末", "芥子",
                "mostarda"),
    "celery": ("celery", "целина", "sellerie", "apio", "céleri", "セロリ", "сельдерей", "芹菜", "aipo"),
    "lupin": ("lupin", "лупина", "lupine", "altramuz", "lupin", "ルピナス", "люпин", "羽扇豆", "tremoço"),
    "molluscs": ("mollus", "mussel", "oyster", "squid", "snail", "мида", "стрида", "калмар", "muschel", "auster",
                 "tintenfisch", "mejillón", "ostra", "calamar", "moule", "huître", "calmar", "貝", "いか", "мидии",
                 "устриц", "кальмар", "贝", "牡蛎", "鱿鱼", "mexilhão", "ostra", "lula"),
    "sulphites": ("sulphite", "sulfite", "sulphur dioxide", "e220", "e221", "e222", "e223", "e224", "e225", "e226",
                  "e227", "e228", "сулфит", "серен диоксид", "sulfit", "schwefeldioxid", "sulfito", "sulfites",
                  "亜硫酸", "сульфит", "亚硫酸", "dióxido de enxofre"),
}
OFF_ALLERGENS = {
    "en:gluten": "gluten", "en:milk": "milk", "en:eggs": "eggs", "en:peanuts": "peanuts", "en:nuts": "tree_nuts",
    "en:soybeans": "soy", "en:fish": "fish", "en:crustaceans": "shellfish", "en:sesame-seeds": "sesame",
    "en:mustard": "mustard", "en:celery": "celery", "en:lupin": "lupin", "en:molluscs": "molluscs",
    "en:sulphur-dioxide-and-sulphites": "sulphites",
}
RESTRICTION_KINDS = ("allergy", "intolerance", "avoid")
OFF_UA = "mvmOS-Nutrition/1.0 (https://mvmos.org)"


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    nutri_cols = ", ".join(f"{n}_100 REAL NOT NULL DEFAULT 0" for n in NKEYS)
    with _db() as c:
        c.executescript(f"""
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                meal TEXT NOT NULL DEFAULT 'snack',
                food_ref TEXT,
                name TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT 'g',
                amount REAL NOT NULL,
                allergens TEXT NOT NULL DEFAULT '[]',
                ingredients TEXT NOT NULL DEFAULT '',
                {nutri_cols}
            );
            CREATE INDEX IF NOT EXISTS idx_nu_entries ON entries(user_id, day);
            CREATE TABLE IF NOT EXISTS foods (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'food',
                name TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT 'g',
                allergens TEXT NOT NULL DEFAULT '[]',
                ingredients TEXT NOT NULL DEFAULT '',
                barcode TEXT,
                brand TEXT,
                portion REAL,
                recipe TEXT,
                created TEXT NOT NULL,
                {nutri_cols}
            );
            CREATE INDEX IF NOT EXISTS idx_nu_foods ON foods(user_id);
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY,
                day_end_hour INTEGER NOT NULL DEFAULT 0,
                goal_type TEXT NOT NULL DEFAULT 'maintain',
                cal_min REAL NOT NULL DEFAULT 0,
                cal_max REAL NOT NULL DEFAULT 0,
                protein_min REAL NOT NULL DEFAULT 0,
                carbs_max REAL NOT NULL DEFAULT 0,
                sugar_max REAL NOT NULL DEFAULT 0,
                fiber_min REAL NOT NULL DEFAULT 0,
                salt_max REAL NOT NULL DEFAULT 0,
                sex TEXT NOT NULL DEFAULT '',
                age INTEGER NOT NULL DEFAULT 0,
                height_cm REAL NOT NULL DEFAULT 0,
                weight_kg REAL NOT NULL DEFAULT 0,
                target_weight_kg REAL NOT NULL DEFAULT 0,
                activity REAL NOT NULL DEFAULT 1.375
            );
            CREATE TABLE IF NOT EXISTS restrictions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                key TEXT NOT NULL DEFAULT '',
                label TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_nu_restr ON restrictions(user_id);
            CREATE TABLE IF NOT EXISTS off_cache (
                barcode TEXT PRIMARY KEY,
                body TEXT NOT NULL,
                fetched TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS meals (
                user_id TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '🍽️',
                time TEXT NOT NULL DEFAULT '',
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE IF NOT EXISTS health_link (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS rewards (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                amount REAL NOT NULL DEFAULT 0,
                to_categories TEXT,
                from_category TEXT,
                enabled_from TEXT
            );
            CREATE TABLE IF NOT EXISTS reward_days (
                user_id TEXT NOT NULL,
                day TEXT NOT NULL,
                paid INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, day)
            );
        """)
        cols = [r[1] for r in c.execute("PRAGMA table_info(health_link)")]
        if "read_profile" not in cols:
            c.execute("ALTER TABLE health_link ADD COLUMN read_profile INTEGER NOT NULL DEFAULT 0")
        if "read_other" not in cols:
            c.execute("ALTER TABLE health_link ADD COLUMN read_other INTEGER NOT NULL DEFAULT 0")
        for table in ("entries", "foods"):
            have = [r[1] for r in c.execute(f"PRAGMA table_info({table})")]
            for n in NKEYS:
                if n + "_100" not in have:
                    c.execute(f"ALTER TABLE {table} ADD COLUMN {n}_100 REAL NOT NULL DEFAULT 0")
        c.commit()


_init_db()


# ── Ready-made foods ─────────────────────────────────────────────

_foods_cache = {"mtime": None, "data": {}}
_names_cache = {"mtime": None, "data": {}}


def _builtin():
    """id -> food, from foods.json (re-read when the file changes)."""
    try:
        m = os.path.getmtime(_FOODS_PATH)
    except OSError:
        return {}
    if _foods_cache["mtime"] != m:
        with open(_FOODS_PATH, encoding="utf-8") as f:
            _foods_cache["data"] = {x["id"]: x for x in json.load(f)}
        _foods_cache["mtime"] = m
    return _foods_cache["data"]


def _all_names():
    """lang -> {food id: name}, read from the window's own i18n.js so there is
    a single source of the translated names."""
    try:
        m = os.path.getmtime(_I18N)
    except OSError:
        return {}
    if _names_cache["mtime"] != m:
        with open(_I18N, encoding="utf-8") as f:
            src = f.read()
        blocks = {}
        parts = re.split(r'^    "?([A-Za-z-]+)"?: \{\s*$', src, flags=re.M)
        for code, body in zip(parts[1::2], parts[2::2]):
            blocks[code.lower()] = dict(re.findall(r'^\s+nu_f_(\w+): "((?:[^"\\]|\\.)*)"', body, flags=re.M))
        _names_cache["data"], _names_cache["mtime"] = blocks, m
    return _names_cache["data"]


def _builtin_name(fid, lang="en"):
    names = _all_names()
    pick = names.get((lang or "en").lower()) or names.get((lang or "en").lower().split("-")[0]) or {}
    return pick.get(fid) or names.get("en", {}).get(fid) or fid


def _builtin_food(fid, lang="en"):
    f = _builtin().get(fid)
    if not f:
        return None
    return {"ref": "b:" + fid, "id": fid, "kind": "ready", "name": _builtin_name(fid, lang), "icon": f.get("icon", "🍽️"),
            "unit": f["unit"], "allergens": list(f.get("allergens") or []), "ingredients": "", "barcode": None,
            "portions": list(f.get("portions") or []), **{k: float(f.get(k) or 0) for k in NKEYS}}


# ── Small helpers ────────────────────────────────────────────────

def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


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


def _r(v, d=1):
    return round(float(v or 0), d)


def _check_day(day):
    if not isinstance(day, str) or not DAY_RE.match(day):
        raise ValueError("invalid_day")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise ValueError("invalid_day")
    return day


def _clean_allergens(v):
    out = []
    for a in (v or []):
        a = str(a).strip().lower()
        if a in ALLERGENS and a not in out:
            out.append(a)
    return out


def _loads(s, default):
    try:
        v = json.loads(s or "")
        return v if isinstance(v, type(default)) else default
    except ValueError:
        return default


def _premium():
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


# ── Settings and the day ─────────────────────────────────────────

def _settings(c, uid):
    row = c.execute("SELECT * FROM settings WHERE user_id=?", (uid,)).fetchone()
    if not row:
        c.execute("INSERT INTO settings(user_id) VALUES(?)", (uid,))
        row = c.execute("SELECT * FROM settings WHERE user_id=?", (uid,)).fetchone()
    d = dict(row)
    d.pop("user_id", None)
    return d


BODY_KEYS = ("sex", "age", "height_cm", "weight_kg")


def _health_profile(uid):
    """The person's profile from Health, or None when Health cannot answer."""
    hub = _hub()
    if hub is None:
        return None
    try:
        p = hub.call_app_api("health", "get_profile", uid)
        return p if isinstance(p, dict) else None
    except Exception:
        return None


def _health_read_on(uid):
    with _db() as c:
        row = c.execute("SELECT read_profile FROM health_link WHERE user_id=?", (uid,)).fetchone()
    return bool(row and row["read_profile"])


def _settings_view(c, uid):
    """The settings as the person sees them. With "take my body data from
    Health" on, sex, age, height and weight are Health's current values (not
    kept here, so they never go stale) and cannot be changed in this app;
    target weight and activity stay this app's own."""
    st = _settings(c, uid)
    row = c.execute("SELECT read_profile FROM health_link WHERE user_id=?", (uid,)).fetchone()
    st["health_read"] = bool(row and row["read_profile"])
    st["health_ok"] = False
    if st["health_read"]:
        p = _health_profile(uid)
        if p is not None:
            st["health_ok"] = True
            st["sex"] = p.get("sex") or ""
            st["age"] = p.get("age") or 0
            st["height_cm"] = p.get("height_cm") or 0
            st["weight_kg"] = p.get("weight_kg") or 0
    return st


def _today(uid, conn=None):
    if conn is not None:
        hour = _settings(conn, uid)["day_end_hour"]
    else:
        with _db() as c:
            hour = _settings(c, uid)["day_end_hour"]
    now = datetime.now()
    if now.hour < hour:
        now -= timedelta(days=1)
    return now.strftime("%Y-%m-%d")


def _save_settings(uid, data):
    """data holds any of the settings; what is left out stays as it was."""
    num_fields = {"cal_min": (0, 20000), "cal_max": (0, 20000), "protein_min": (0, 1000), "carbs_max": (0, 3000),
                  "sugar_max": (0, 1000), "fiber_min": (0, 500), "salt_max": (0, 100), "age": (0, 120),
                  "height_cm": (0, 250), "weight_kg": (0, 500), "target_weight_kg": (0, 500)}
    if _health_read_on(uid) and _health_profile(uid) is not None:
        data = {k: v for k, v in data.items() if k not in BODY_KEYS}
    with _db() as c:
        cur = _settings(c, uid)
        new = dict(cur)
        for k, (lo, hi) in num_fields.items():
            if data.get(k) is not None:
                v = _num(data[k], lo, hi)
                if v is None:
                    raise ValueError("invalid_" + k)
                new[k] = int(v) if k == "age" else v
        if data.get("day_end_hour") is not None:
            h = data["day_end_hour"]
            if not isinstance(h, int) or not (0 <= h <= MAX_DAY_END_HOUR):
                raise ValueError("invalid_day_end_hour")
            new["day_end_hour"] = h
        if data.get("goal_type") is not None:
            if data["goal_type"] not in GOAL_TYPES:
                raise ValueError("invalid_goal_type")
            new["goal_type"] = data["goal_type"]
        if data.get("sex") is not None:
            if data["sex"] not in ("", "m", "f"):
                raise ValueError("invalid_sex")
            new["sex"] = data["sex"]
        if data.get("activity") is not None:
            v = _num(data["activity"], 1.0, 2.5)
            if v is None:
                raise ValueError("invalid_activity")
            new["activity"] = v
        if new["cal_max"] and new["cal_min"] > new["cal_max"]:
            raise ValueError("invalid_calorie_range")
        sets = ", ".join(f"{k}=?" for k in new)
        c.execute(f"UPDATE settings SET {sets} WHERE user_id=?", (*new.values(), uid))
        c.commit()
        out = _settings_view(c, uid)
        today = _today(uid, c)
        logged = c.execute("SELECT 1 FROM entries WHERE user_id=? AND day=? LIMIT 1", (uid, today)).fetchone()
    if logged:
        _push_health(uid, today)
    return out


def suggest_goals(sex, age, height_cm, weight_kg, activity, goal_type, target_weight_kg=0):
    """A starting point for the goals (Mifflin-St Jeor), meant to be edited."""
    sex, goal_type = (sex or "m"), (goal_type or "maintain")
    age, height_cm, weight_kg = _num(age, 5, 120), _num(height_cm, 80, 250), _num(weight_kg, 20, 500)
    if age is None or height_cm is None or weight_kg is None:
        raise ValueError("invalid_body")
    act = _num(activity, 1.0, 2.5, 1.375)
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == "m" else -161)
    tdee = bmr * act
    delta = {"lose_weight": -500, "gain_muscle": 300}.get(goal_type, 0)
    cal = max(tdee + delta, 1500 if sex == "m" else 1200)
    cal_max = int(round(cal / 50.0) * 50)
    cal_min = max(1000, cal_max - 300)
    per_kg = {"high_protein": 2.0, "gain_muscle": 2.0, "lose_weight": 1.8}.get(goal_type, 1.2)
    out = {"bmr": int(round(bmr)), "tdee": int(round(tdee)), "cal_min": cal_min, "cal_max": cal_max,
           "protein_min": int(round(weight_kg * per_kg)), "carbs_max": 0, "sugar_max": 0, "fiber_min": 0, "salt_max": 0}
    if goal_type == "healthier":
        out.update(sugar_max=50, fiber_min=25, salt_max=5)
    if goal_type == "low_carb":
        out["carbs_max"] = 100
    tw = _num(target_weight_kg, 0, 500, 0)
    if tw and goal_type == "lose_weight" and weight_kg > tw:
        out["weeks"] = int(round((weight_kg - tw) / 0.5))
    return out


# ── Restrictions ─────────────────────────────────────────────────

def _restrictions(c, uid):
    return [dict(r) for r in c.execute(
        "SELECT id,kind,key,label FROM restrictions WHERE user_id=? ORDER BY rowid", (uid,))]


def _add_restriction(uid, kind, key="", label=""):
    kind = (kind or "").strip().lower()
    key = (key or "").strip().lower()
    label = (label or "").strip()[:60]
    if kind not in RESTRICTION_KINDS:
        raise ValueError("invalid_kind")
    if key and key not in ALLERGENS:
        raise ValueError("invalid_allergen")
    if not key and not label:
        raise ValueError("invalid_restriction")
    with _db() as c:
        dup = c.execute("SELECT id FROM restrictions WHERE user_id=? AND kind=? AND key=? AND lower(label)=?",
                        (uid, kind, key, label.lower())).fetchone()
        if dup:
            rid = dup["id"]
        else:
            rid = uuid.uuid4().hex[:12]
            c.execute("INSERT INTO restrictions(id,user_id,kind,key,label) VALUES(?,?,?,?,?)",
                      (rid, uid, kind, key, label))
            c.commit()
        return next(r for r in _restrictions(c, uid) if r["id"] == rid)


def _delete_restriction(uid, rid):
    with _db() as c:
        cur = c.execute("DELETE FROM restrictions WHERE id=? AND user_id=?", (rid, uid))
        c.commit()
        if not cur.rowcount:
            raise LookupError("not found")
    return {"ok": True}


def _restriction_hits(restrictions, allergens, text):
    """The restrictions a food runs into: through an allergen it is tagged
    with, or through a word of its name or ingredient list."""
    low = " " + (text or "").casefold() + " "
    hits = []
    for r in restrictions:
        if r["key"]:
            if r["key"] in allergens:
                hits.append({"kind": r["kind"], "key": r["key"], "label": r["label"], "via": "allergen"})
            elif any(w in low for w in ALLERGEN_WORDS.get(r["key"], ())):
                hits.append({"kind": r["kind"], "key": r["key"], "label": r["label"], "via": "ingredient"})
        elif r["label"] and r["label"].casefold() in low:
            hits.append({"kind": r["kind"], "key": "", "label": r["label"], "via": "ingredient"})
    return hits


# ── Foods ────────────────────────────────────────────────────────

def _user_food_out(r):
    d = {"ref": "u:" + r["id"], "id": r["id"], "kind": r["kind"], "name": r["name"], "icon": "🍲" if r["kind"] == "recipe" else "🍴",
         "unit": r["unit"], "allergens": _loads(r["allergens"], []), "ingredients": r["ingredients"] or "",
         "barcode": r["barcode"], "brand": r["brand"], "portion": r["portion"],
         "portions": [r["portion"]] if r["portion"] else [], **{k: r[k + "_100"] for k in NKEYS}}
    if r["kind"] == "recipe":
        d["recipe"] = _loads(r["recipe"], [])
    return d


def _food_by_ref(uid, ref, lang="en"):
    ref = (ref or "").strip()
    if ref.startswith("b:"):
        f = _builtin_food(ref[2:], lang)
    elif ref.startswith("u:"):
        with _db() as c:
            row = c.execute("SELECT * FROM foods WHERE id=? AND user_id=?", (ref[2:], uid)).fetchone()
        f = _user_food_out(row) if row else None
    else:
        f = None
    if not f:
        raise LookupError("not found")
    return f


def _find_by_name(uid, name, lang="en"):
    """A food by id (b:/u:), or by its name in any language: the user's own
    foods first, then the ready-made ones."""
    name = (name or "").strip()
    if name[:2] in ("b:", "u:"):
        return _food_by_ref(uid, name, lang)
    want = name.casefold()
    if not want:
        raise LookupError("not found")
    # Exact name first, then a name that starts with it, then one that holds it;
    # the person's own foods come before the ready-made ones at each step.
    mine = []
    with _db() as c:
        for r in c.execute("SELECT * FROM foods WHERE user_id=?", (uid,)):
            mine.append((r["name"].casefold(), r))
    ready = [(n.casefold(), fid) for names in _all_names().values() for fid, n in names.items() if fid in _builtin()]
    for test in (lambda n: n == want, lambda n: n.startswith(want), lambda n: want in n):
        hit = sorted((n, r) for n, r in mine if test(n))
        if hit:
            return _user_food_out(hit[0][1])
        hit = sorted((len(n), n, fid) for n, fid in ready if test(n))
        if hit:
            return _builtin_food(hit[0][2], lang)
    raise LookupError("not found")


def _list_user_foods(uid):
    with _db() as c:
        return [_user_food_out(r) for r in c.execute(
            "SELECT * FROM foods WHERE user_id=? ORDER BY name COLLATE NOCASE", (uid,))]


def _recent_refs(uid, limit=12, meal=None):
    """What was eaten last, newest first, with the amount of that last time
    (last_amount). With meal, only what was logged for that meal."""
    sql = ("SELECT food_ref, amount, MAX(recorded_at) AS last FROM entries WHERE user_id=? AND food_ref IS NOT NULL"
           + (" AND meal=?" if meal else "") + " GROUP BY food_ref ORDER BY last DESC LIMIT ?")
    args = (uid, meal, limit) if meal else (uid, limit)
    with _db() as c:
        rows = c.execute(sql, args).fetchall()
    out = []
    for r in rows:
        try:
            f = _food_by_ref(uid, r["food_ref"])
            f["last_amount"] = r["amount"]
            out.append(f)
        except LookupError:
            pass
    return out


def _search_foods(uid, query, lang="en", limit=30, meal=None):
    """The user's own foods and recipes, then ready-made ones, whose name in
    any language contains the query. An empty query gives what was eaten last."""
    q = (query or "").strip().casefold()
    if not q:
        if meal:
            try:
                meal = _resolve_meal(uid, meal)
            except ValueError:
                meal = None
        own = _recent_refs(uid, meal=meal) if meal else []
        if own:
            return {"foods": own, "recent": True, "for_meal": True}
        return {"foods": _recent_refs(uid), "recent": True, "for_meal": False}
    mine = [f for f in _list_user_foods(uid) if q in f["name"].casefold() or q == (f["barcode"] or "")]
    ready = []
    names = _all_names()
    for fid in _builtin():
        hay = [n.get(fid, "") for n in names.values()]
        if any(q in h.casefold() for h in hay):
            ready.append(_builtin_food(fid, lang))
    ready.sort(key=lambda f: (not f["name"].casefold().startswith(q), f["name"].casefold()))
    return {"foods": (mine + ready)[:limit], "recent": False}


def _food_fields(body, existing=None):
    """Validated columns of a custom food from a dict."""
    name = (body.get("name") or "").strip()[:80]
    if not name:
        raise ValueError("invalid_name")
    unit = body.get("unit") or "g"
    if unit not in ("g", "ml"):
        raise ValueError("invalid_unit")
    out = {"name": name, "unit": unit, "allergens": json.dumps(_clean_allergens(body.get("allergens"))),
           "ingredients": (body.get("ingredients") or "").strip()[:2000],
           "barcode": re.sub(r"\D", "", str(body.get("barcode") or ""))[:20] or None,
           "brand": (body.get("brand") or "").strip()[:60] or None}
    portion = _num(body.get("portion"), 0, MAX_AMOUNT, 0)
    if portion is None:
        raise ValueError("invalid_portion")
    out["portion"] = portion or None
    for k, hi in NUTRIENTS:
        v = _num(body.get(k), 0, hi, 0)
        if v is None:
            raise ValueError("invalid_" + k)
        out[k + "_100"] = v
    return out


def _add_food(uid, body):
    f = _food_fields(body)
    fid = uuid.uuid4().hex[:12]
    cols = ["id", "user_id", "kind", "created", *f.keys()]
    vals = [fid, uid, "food", datetime.now().isoformat(timespec="seconds"), *f.values()]
    with _db() as c:
        c.execute(f"INSERT INTO foods({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
        c.commit()
    return _food_by_ref(uid, "u:" + fid)


def _edit_food(uid, fid, body):
    f = _food_fields(body)
    with _db() as c:
        row = c.execute("SELECT kind FROM foods WHERE id=? AND user_id=?", (fid, uid)).fetchone()
        if not row:
            raise LookupError("not found")
        sets = ", ".join(f"{k}=?" for k in f)
        c.execute(f"UPDATE foods SET {sets} WHERE id=? AND user_id=?", (*f.values(), fid, uid))
        c.commit()
    return _food_by_ref(uid, "u:" + fid)


def _delete_food(uid, fid):
    with _db() as c:
        cur = c.execute("DELETE FROM foods WHERE id=? AND user_id=?", (fid, uid))
        c.commit()
        if not cur.rowcount:
            raise LookupError("not found")
    return {"ok": True}


def _resolve_item(uid, item, lang="en"):
    """One recipe ingredient or logged item: a known food (food = id or name)
    or one described on the spot with its values per 100 g/ml. Returns the food
    and the amount."""
    amount = _num(item.get("amount"), 0.1, MAX_AMOUNT)
    if amount is None:
        raise ValueError("invalid_amount")
    if item.get("food"):
        food = _find_by_name(uid, str(item["food"]), lang)
    else:
        f = _food_fields({**item, "name": item.get("name") or "-"})
        food = {"ref": None, "name": f["name"], "unit": f["unit"], "allergens": json.loads(f["allergens"]),
                "ingredients": f["ingredients"], **{k: f[k + "_100"] for k in NKEYS}}
    return food, amount


def _save_recipe(uid, name, items, portions=1, total_g=None, lang="en"):
    """A recipe from its ingredients: the values per 100 g are worked out from
    the amounts. total_g is the weight of the finished dish (it loses water
    when cooked); without it the ingredients' weights are added up. One portion
    is total_g divided by portions."""
    if not items or not isinstance(items, list) or len(items) > 60:
        raise ValueError("invalid_ingredients")
    portions = _num(portions, 1, 100, 1)
    if portions is None:
        raise ValueError("invalid_portions")
    sums = {k: 0.0 for k in NKEYS}
    weight, allergens, names, rows, unit_ml = 0.0, [], [], [], 0.0
    for it in items:
        food, amount = _resolve_item(uid, it, lang)
        weight += amount
        if food["unit"] == "ml":
            unit_ml += amount
        for k in NKEYS:
            sums[k] += (food.get(k) or 0) * amount / 100.0
        for a in food["allergens"]:
            if a not in allergens:
                allergens.append(a)
        names.append(food["name"])
        rows.append({"name": food["name"], "amount": amount, "unit": food["unit"], "ref": food.get("ref"),
                     **{k: food.get(k) or 0 for k in NKEYS}})
    total = _num(total_g, 1, 100000, weight)
    if total is None:
        raise ValueError("invalid_total")
    body = {"name": name, "unit": "ml" if unit_ml > weight / 2 else "g", "allergens": allergens,
            "ingredients": ", ".join(names), "portion": total / portions,
            **{k: sums[k] / total * 100.0 for k in NKEYS}}
    f = _food_fields(body)
    fid = uuid.uuid4().hex[:12]
    cols = ["id", "user_id", "kind", "recipe", "created", *f.keys()]
    vals = [fid, uid, "recipe", json.dumps(rows), datetime.now().isoformat(timespec="seconds"), *f.values()]
    with _db() as c:
        c.execute(f"INSERT INTO foods({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
        c.commit()
    return _food_by_ref(uid, "u:" + fid)


# ── Open Food Facts ──────────────────────────────────────────────

def _http_json(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": OFF_UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _off_food(p):
    """A food from an Open Food Facts product, per 100 g (or ml when it is a
    drink). None when it does not carry an energy value."""
    n = p.get("nutriments") or {}
    kcal = n.get("energy-kcal_100g")
    if kcal is None and n.get("energy_100g") is not None:
        kcal = float(n["energy_100g"]) / 4.184
    if kcal is None:
        return None
    name = (p.get("product_name") or "").strip()
    brands = p.get("brands")
    brand = (", ".join(brands) if isinstance(brands, list) else (brands or "")).split(",")[0].strip()
    if not name:
        return None
    salt = n.get("salt_100g")
    if salt is None and n.get("sodium_100g") is not None:
        salt = float(n["sodium_100g"]) * 2.5
    qty = (p.get("quantity") or "").lower()
    unit = "ml" if re.search(r"\d\s*(ml|cl|dl|l)\b", qty) else "g"
    allergens = []
    for tag in p.get("allergens_tags") or []:
        a = OFF_ALLERGENS.get(tag)
        if a and a not in allergens:
            allergens.append(a)
    g = lambda k: max(0.0, float(n.get(k) or 0))
    return {"ref": None, "name": name[:80], "brand": brand[:60] or None, "unit": unit, "kind": "online", "icon": "🏷️",
            "allergens": allergens, "ingredients": (p.get("ingredients_text") or "")[:2000],
            "barcode": re.sub(r"\D", "", str(p.get("code") or "")) or None, "portions": [],
            "kcal": _r(kcal), "protein": _r(g("proteins_100g")), "carbs": _r(g("carbohydrates_100g")),
            "sugar": _r(g("sugars_100g")), "fat": _r(g("fat_100g")), "sat_fat": _r(g("saturated-fat_100g")),
            "fiber": _r(g("fiber_100g")), "salt": _r(salt, 2)}


def _barcode(uid, code, lang="en"):
    """The food for a barcode: the user's own first, then the cache, then Open
    Food Facts. Raises LookupError("not found") for an unknown code and
    RuntimeError("offline") when the service cannot be reached."""
    code = re.sub(r"\D", "", str(code or ""))
    if not (6 <= len(code) <= 14):
        raise ValueError("invalid_barcode")
    with _db() as c:
        row = c.execute("SELECT * FROM foods WHERE user_id=? AND barcode=?", (uid, code)).fetchone()
        if row:
            return _user_food_out(row)
        cached = c.execute("SELECT body FROM off_cache WHERE barcode=?", (code,)).fetchone()
    if cached:
        return json.loads(cached["body"])
    try:
        data = _http_json("https://world.openfoodfacts.org/api/v2/product/" + code + ".json?fields="
                          "code,product_name,brands,quantity,nutriments,allergens_tags,ingredients_text")
    except urllib.error.HTTPError as e:
        # Open Food Facts answers 404 for a code it does not know: that is
        # "not found", not a broken connection.
        if e.code == 404:
            raise LookupError("not found")
        raise RuntimeError("offline")
    except Exception:
        raise RuntimeError("offline")
    food = _off_food(data.get("product") or {}) if data.get("status") == 1 else None
    if not food:
        raise LookupError("not found")
    food["barcode"] = code
    with _db() as c:
        c.execute("INSERT OR REPLACE INTO off_cache(barcode,body,fetched) VALUES(?,?,?)",
                  (code, json.dumps(food), datetime.now().isoformat(timespec="seconds")))
        c.commit()
    return food


def _search_online(query, limit=10):
    q = (query or "").strip()
    if len(q) < 2:
        raise ValueError("invalid_query")
    try:
        data = _http_json("https://search.openfoodfacts.org/search?q=" + urllib.parse.quote(q) +
                          "&page_size=" + str(max(1, min(limit, 20))) +
                          "&fields=code,product_name,brands,quantity,nutriments,allergens_tags,ingredients_text",
                          timeout=10)
    except Exception:
        raise RuntimeError("offline")
    out = []
    for h in data.get("hits") or []:
        f = _off_food(h)
        if f:
            out.append(f)
    return {"foods": out}


def _remember_online(uid, food):
    """Keep a food found online as the user's own food (by barcode, once) and
    return its reference."""
    if food.get("barcode"):
        with _db() as c:
            row = c.execute("SELECT id FROM foods WHERE user_id=? AND barcode=?", (uid, food["barcode"])).fetchone()
        if row:
            return "u:" + row["id"]
    return _add_food(uid, {**food, "ingredients": food.get("ingredients", "")})["ref"]


# ── Meals ────────────────────────────────────────────────────────

def _meals(c, uid):
    """The person's meals in the order of the day: those with a time by the
    clock, then the ones without a time in the order they were made. A person
    who never changed anything gets the four defaults."""
    rows = c.execute("SELECT * FROM meals WHERE user_id=?", (uid,)).fetchall()
    if not rows:
        for i, (mid, icon, tm) in enumerate(DEFAULT_MEALS):
            c.execute("INSERT OR IGNORE INTO meals(user_id,id,name,icon,time,position) VALUES(?,?,?,?,?,?)",
                      (uid, mid, "", icon, tm, i))
        c.commit()
        rows = c.execute("SELECT * FROM meals WHERE user_id=?", (uid,)).fetchall()
    out = [{"id": r["id"], "name": r["name"], "icon": r["icon"], "time": r["time"], "position": r["position"],
            "default": r["id"] in DEFAULT_LABELS, "label": r["name"] or DEFAULT_LABELS.get(r["id"], r["id"])} for r in rows]
    out.sort(key=lambda m: (m["time"] == "", m["time"], m["position"]))
    return out


def _list_meals(uid):
    with _db() as c:
        return _meals(c, uid)


def _clean_meal(name, icon, tm):
    name = (name or "").strip()[:40]
    icon = (icon or "").strip()[:8] or "🍽️"
    tm = (tm or "").strip()
    if tm and not TIME_RE.match(tm):
        raise ValueError("invalid_time")
    return name, icon, tm


def _save_meal(uid, meal_id=None, name=None, icon=None, time=None):
    """Add a meal, or change one (meal_id). A default meal may have an empty
    name, which shows its translated standard name; a new meal needs one."""
    with _db() as c:
        cur = _meals(c, uid)
        if meal_id:
            old = next((m for m in cur if m["id"] == meal_id), None)
            if not old:
                raise LookupError("not found")
            n, ic, tm = _clean_meal(old["name"] if name is None else name, old["icon"] if icon is None else icon,
                                    old["time"] if time is None else time)
            if not n and not old["default"]:
                raise ValueError("invalid_name")
            c.execute("UPDATE meals SET name=?, icon=?, time=? WHERE user_id=? AND id=?", (n, ic, tm, uid, meal_id))
        else:
            if len(cur) >= MAX_MEALS:
                raise ValueError("too_many_meals")
            n, ic, tm = _clean_meal(name, icon, time)
            if not n:
                raise ValueError("invalid_name")
            meal_id = uuid.uuid4().hex[:8]
            c.execute("INSERT INTO meals(user_id,id,name,icon,time,position) VALUES(?,?,?,?,?,?)",
                      (uid, meal_id, n, ic, tm, max([m["position"] for m in cur] + [-1]) + 1))
        c.commit()
        return next(m for m in _meals(c, uid) if m["id"] == meal_id)


def _delete_meal(uid, meal_id):
    """Logged entries keep their meal id and show under "Other" afterwards;
    one meal always remains."""
    with _db() as c:
        cur = _meals(c, uid)
        if not any(m["id"] == meal_id for m in cur):
            raise LookupError("not found")
        if len(cur) <= 1:
            raise ValueError("last_meal")
        c.execute("DELETE FROM meals WHERE user_id=? AND id=?", (uid, meal_id))
        c.commit()
    return {"ok": True}


def _resolve_meal(uid, meal):
    """A meal id, or its name in any case, or a standard name (breakfast...),
    as the id of one of the person's meals."""
    text = str(meal or "").strip()
    if not text:
        return _default_meal(uid)
    cur = _list_meals(uid)
    low = text.casefold()
    for m in cur:
        if m["id"] == text:
            return m["id"]
    for m in cur:
        if low in (m["name"].casefold(), m["label"].casefold()):
            return m["id"]
    raise ValueError("invalid_meal")


def _default_meal(uid):
    """The meal that fits the time of day: the latest one whose time has
    passed, else the first of the day."""
    cur = _list_meals(uid)
    now = datetime.now().strftime("%H:%M")
    passed = [m for m in cur if m["time"] and m["time"] <= now]
    return (passed[-1] if passed else cur[0])["id"]


# ── Entries ──────────────────────────────────────────────────────

def _entry_out(r):
    amount = r["amount"]
    out = {"id": r["id"], "day": r["day"], "recorded_at": r["recorded_at"], "meal": r["meal"], "food_ref": r["food_ref"],
           "name": r["name"], "unit": r["unit"], "amount": amount, "allergens": _loads(r["allergens"], []),
           "ingredients": r["ingredients"]}
    for k in NKEYS:
        out[k + "_100"] = r[k + "_100"]
        out[k] = r[k + "_100"] * amount / 100.0
    return out


def _totals(entries):
    return {k: sum(e[k] for e in entries) for k in NKEYS}


HEALTH_METRIC = {k: ("calories" if k == "kcal" else k) for k in NKEYS}


def _read_other_on(uid):
    with _db() as c:
        row = c.execute("SELECT read_other FROM health_link WHERE user_id=?", (uid,)).fetchone()
    return bool(row and row["read_other"])


def _other_range(uid, start, end):
    """What other apps sent Health for the days start..end: day -> {"totals":
    {nutrient: amount}, "sources": [{"source", "name", **amounts}]}. This app's
    own source is left out, so nothing is counted twice, and a day with nothing
    from elsewhere is missing. Empty when the person did not switch it on or
    Health cannot answer."""
    out = {}
    hub = _hub()
    if hub is None or not _read_other_on(uid):
        return out
    days = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days + 1
    for k in NKEYS:
        try:
            series = hub.call_app_api("health", "get_series", uid, HEALTH_METRIC[k], days, end)
        except Exception:
            return {}
        for pt in series.get("points") or []:
            for src in pt.get("sources") or []:
                if src.get("source") == APP_ID or not src.get("value"):
                    continue
                d = out.setdefault(pt["day"], {"totals": {n: 0.0 for n in NKEYS}, "sources": {}})
                d["totals"][k] += src["value"]
                s = d["sources"].setdefault(src["source"], {"source": src["source"], "name": src.get("name") or src["source"]})
                s[k] = s.get(k, 0.0) + src["value"]
    for d in out.values():
        d["sources"] = list(d["sources"].values())
    return out


def _warnings_for(uid, c, entries):
    restr = _restrictions(c, uid)
    out = {}
    if not restr:
        return out
    for e in entries:
        hits = _restriction_hits(restr, e["allergens"], e["name"] + " " + e["ingredients"])
        if hits:
            out[e["id"]] = hits
    return out


def _get_day(uid, day, other=True):
    """A day's entries and numbers. With other (and the person's setting on) the
    totals include what other apps sent Health for the day and "other" lists
    where it came from; own_totals is always this app's entries alone, which is
    what is sent to Health."""
    _check_day(day)
    with _db() as c:
        rows = c.execute("SELECT * FROM entries WHERE user_id=? AND day=? ORDER BY recorded_at", (uid, day)).fetchall()
        entries = [_entry_out(r) for r in rows]
        warn = _warnings_for(uid, c, entries)
        st = _settings(c, uid)
    own = _totals(entries)
    totals, extra = own, None
    if other:
        extra = _other_range(uid, day, day).get(day)
        if extra:
            totals = {k: own[k] + extra["totals"][k] for k in NKEYS}
    return {"day": day, "entries": entries, "totals": totals, "own_totals": own, "other": extra, "warnings": warn,
            "goals": {k: st[k] for k in ("goal_type", "cal_min", "cal_max", "protein_min", "carbs_max", "sugar_max",
                                          "fiber_min", "salt_max")}}


def _get_history(uid, end, days):
    _check_day(end)
    days = max(1, min(int(days), 90))
    end_d = datetime.strptime(end, "%Y-%m-%d")
    start = (end_d - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with _db() as c:
        rows = c.execute("SELECT * FROM entries WHERE user_id=? AND day>=? AND day<=?", (uid, start, end)).fetchall()
    by_day = {}
    for r in rows:
        by_day.setdefault(r["day"], []).append(_entry_out(r))
    extra = _other_range(uid, start, end)
    out = []
    for d in ((end_d - timedelta(days=days - 1 - i)).strftime("%Y-%m-%d") for i in range(days)):
        own = _totals(by_day.get(d, []))
        x = extra.get(d)
        out.append({"day": d, **({k: own[k] + x["totals"][k] for k in NKEYS} if x else own),
                    "entries": len(by_day.get(d, [])), "other": bool(x)})
    return out


def _insert_entry(uid, day, food, amount, meal):
    meal = _resolve_meal(uid, meal)
    eid = uuid.uuid4().hex[:12]
    cols = ["id", "user_id", "day", "recorded_at", "meal", "food_ref", "name", "unit", "amount", "allergens",
            "ingredients", *[k + "_100" for k in NKEYS]]
    vals = [eid, uid, day, datetime.now().isoformat(timespec="seconds"), meal, food.get("ref"), food["name"],
            food["unit"], amount, json.dumps(food["allergens"]), food.get("ingredients") or "",
            *[food.get(k) or 0 for k in NKEYS]]
    with _db() as c:
        c.execute(f"INSERT INTO entries({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals)
        c.commit()
        row = c.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
    return _entry_out(row)


def _add_entry(uid, day, ref, amount, meal=None, food=None, lang="en"):
    """Log what was eaten: a known food by ref/name, or a food described on the
    spot (food = {name, unit, kcal, protein, ... per 100, allergens,
    ingredients}). A food found online is kept as the user's own."""
    _check_day(day)
    amount = _num(amount, 0.1, MAX_AMOUNT)
    if amount is None:
        raise ValueError("invalid_amount")
    if food is not None:
        f = _food_fields(food)
        item = {"ref": None, "name": f["name"], "unit": f["unit"], "allergens": json.loads(f["allergens"]),
                "ingredients": f["ingredients"], **{k: f[k + "_100"] for k in NKEYS}}
        if food.get("save"):
            item["ref"] = _add_food(uid, food)["ref"]
    else:
        item = _find_by_name(uid, ref, lang)
    out = _insert_entry(uid, day, item, amount, meal)
    _push_health(uid, day)
    return out


def _edit_entry(uid, eid, amount=None, meal=None):
    if meal is not None:
        with _db() as c:
            cur = c.execute("SELECT meal FROM entries WHERE id=? AND user_id=?", (eid, uid)).fetchone()
        # An entry whose meal was deleted may keep it; any other meal must exist.
        meal = meal if cur and meal == cur["meal"] else _resolve_meal(uid, meal)
    with _db() as c:
        row = c.execute("SELECT * FROM entries WHERE id=? AND user_id=?", (eid, uid)).fetchone()
        if not row:
            raise LookupError("not found")
        if amount is not None:
            amount = _num(amount, 0.1, MAX_AMOUNT)
            if amount is None:
                raise ValueError("invalid_amount")
            c.execute("UPDATE entries SET amount=? WHERE id=?", (amount, eid))
        if meal is not None:
            c.execute("UPDATE entries SET meal=? WHERE id=?", (meal, eid))
        c.commit()
        row = c.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
    _push_health(uid, row["day"])
    return _entry_out(row)


def _delete_entry(uid, eid):
    with _db() as c:
        row = c.execute("SELECT day FROM entries WHERE id=? AND user_id=?", (eid, uid)).fetchone()
        if not row:
            raise LookupError("not found")
        c.execute("DELETE FROM entries WHERE id=?", (eid,))
        c.commit()
    _push_health(uid, row["day"])
    return {"ok": True}


# ── Is this good for me? ─────────────────────────────────────────

def _check(uid, food, amount, day=None, lang="en"):
    """Weigh a food that is about to be eaten against the profile's allergies,
    intolerances and foods to avoid, the daily goals and the day so far.
    food is a known food (ref or name) or one described on the spot. Returns
    verdict (ok, caution or avoid), warnings and the day's numbers."""
    amount = _num(amount, 0.1, MAX_AMOUNT)
    if amount is None:
        raise ValueError("invalid_amount")
    if isinstance(food, dict):
        f = _food_fields(food)
        item = {"name": f["name"], "unit": f["unit"], "allergens": json.loads(f["allergens"]),
                "ingredients": f["ingredients"], **{k: f[k + "_100"] for k in NKEYS}}
    else:
        item = _find_by_name(uid, str(food), lang)
    day = _check_day(day) if day else _today(uid)
    with _db() as c:
        st = _settings(c, uid)
        restr = _restrictions(c, uid)
    current = _get_day(uid, day)["totals"]
    this = {k: (item.get(k) or 0) * amount / 100.0 for k in NKEYS}
    warnings = []
    for h in _restriction_hits(restr, item["allergens"], item["name"] + " " + item["ingredients"]):
        warnings.append({"type": h["kind"], "key": h["key"], "label": h["label"], "via": h["via"],
                         "severity": "high" if h["kind"] == "allergy" else "medium" if h["kind"] == "intolerance" else "low"})
    drink = item["unit"] == "ml"
    for k, hi in (("sugar", 11.25 if drink else 22.5), ("sat_fat", 2.5 if drink else 5.0), ("salt", 0.75 if drink else 1.5)):
        if item[k] > hi:
            warnings.append({"type": "high_" + k, "per_100": _r(item[k], 2), "severity": "low"})
    if st["cal_max"] and current["kcal"] + this["kcal"] > st["cal_max"]:
        warnings.append({"type": "over_calories", "over": _r(current["kcal"] + this["kcal"] - st["cal_max"], 0),
                         "severity": "medium"})
    for k, key in (("sugar", "sugar_max"), ("salt", "salt_max"), ("carbs", "carbs_max")):
        if st[key] and current[k] + this[k] > st[key]:
            warnings.append({"type": "over_" + k, "over": _r(current[k] + this[k] - st[key]), "severity": "low"})
    if st["goal_type"] == "lose_weight" and item["kcal"] > 400:
        warnings.append({"type": "calorie_dense", "per_100": _r(item["kcal"], 0), "severity": "low"})
    verdict = "avoid" if any(w["severity"] == "high" or w["type"] == "intolerance" for w in warnings) else \
        "caution" if warnings else "ok"
    return {"verdict": verdict, "warnings": warnings, "name": item["name"], "amount": amount, "unit": item["unit"],
            "this": {k: _r(v) for k, v in this.items()}, "day_before": {k: _r(v) for k, v in current.items()},
            "goals": {k: st[k] for k in ("goal_type", "cal_min", "cal_max", "protein_min", "carbs_max", "sugar_max",
                                          "fiber_min", "salt_max")}}


# ── Health integration ───────────────────────────────────────────
# Opt-in per profile. Nutrition keeps only the choice; the numbers are sent to
# Health's app API as this app's total for the day, so Health always shows what
# Nutrition shows and a corrected or deleted entry corrects Health as well.

def _health_enabled(uid):
    with _db() as c:
        row = c.execute("SELECT enabled FROM health_link WHERE user_id=?", (uid,)).fetchone()
    return bool(row and row["enabled"])


def _health_available(uid):
    hub = _hub()
    if hub is None:
        return False
    try:
        hub.call_app_api("health", "status", uid)
        return True
    except Exception:
        return False


def _push_health(uid, day):
    """Best-effort: a missing Health or a disabled App API never affects the
    entry that was just logged. A calorie range has no single goal Health can
    chart, so only the goals that are one number are sent (protein, fibre)."""
    try:
        if not _health_enabled(uid):
            return
        hub = _hub()
        if hub is None:
            return
        d = _get_day(uid, day, other=False)
        t = d["totals"]
        values = {"calories": _r(t["kcal"]), "water": _r(t["water"]), "protein": _r(t["protein"]), "carbs": _r(t["carbs"]),
                  "sugar": _r(t["sugar"]), "fat": _r(t["fat"]), "sat_fat": _r(t["sat_fat"]),
                  "fiber": _r(t["fiber"]), "salt": _r(t["salt"], 2)}
        goals = {}
        if d["goals"]["protein_min"]:
            goals["protein"] = d["goals"]["protein_min"]
        if d["goals"]["fiber_min"]:
            goals["fiber"] = d["goals"]["fiber_min"]
        hub.call_app_api("health", "record_daily", uid, day, values, source_app=APP_ID,
                         source_app_name="Nutrition", goals=goals or None)
    except Exception:
        pass


def _health_sync(uid):
    since = (datetime.now() - timedelta(days=HEALTH_SYNC_DAYS)).strftime("%Y-%m-%d")
    with _db() as c:
        days = [r["day"] for r in c.execute(
            "SELECT DISTINCT day FROM entries WHERE user_id=? AND day>=? ORDER BY day", (uid, since))]
    for d in days:
        _push_health(uid, d)
    return len(days)


def _set_health_read(uid, read):
    with _db() as c:
        c.execute("INSERT INTO health_link(user_id,enabled,read_profile) VALUES(?,0,?) "
                  "ON CONFLICT(user_id) DO UPDATE SET read_profile=excluded.read_profile", (uid, 1 if read else 0))
        c.commit()
    return {"read": bool(read), "available": _health_available(uid)}


def _set_read_other(uid, read):
    with _db() as c:
        c.execute("INSERT INTO health_link(user_id,enabled,read_other) VALUES(?,0,?) "
                  "ON CONFLICT(user_id) DO UPDATE SET read_other=excluded.read_other", (uid, 1 if read else 0))
        c.commit()
    return {"read_other": bool(read), "available": _health_available(uid)}


def _set_health_link(uid, enabled):
    with _db() as c:
        c.execute("INSERT INTO health_link(user_id,enabled) VALUES(?,?) "
                  "ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled", (uid, 1 if enabled else 0))
        c.commit()
    synced = _health_sync(uid) if enabled else 0
    return {"enabled": bool(enabled), "read": _health_read_on(uid), "read_other": _read_other_on(uid), "available": _health_available(uid), "synced_days": synced}


# ── Budget reward (premium) ──────────────────────────────────────
# Paid once for a finished day on which the calories stayed inside the range
# the profile chose. Eating nothing never earns it: the total must reach the
# lowest figure of the range. A day is settled after the profile's own end of
# day, the next time the app is opened.

def _reward_offered():
    with _db() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='budget_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return False
    prem = _premium()
    return bool(prem and prem.is_available())


def _reward_settings(c, uid):
    row = c.execute("SELECT enabled,amount,to_categories,from_category FROM rewards WHERE user_id=?", (uid,)).fetchone()
    if not row:
        return {"enabled": False, "amount": 0, "to_categories": [], "from_category": None}
    cats = [x for x in _loads(row["to_categories"], []) if isinstance(x, str) and x]
    return {"enabled": bool(row["enabled"]), "amount": row["amount"], "to_categories": cats,
            "from_category": row["from_category"]}


def _settle_rewards(uid):
    """Pay the finished days that met the calorie range. Best-effort: returns
    the payments made, never raises."""
    paid = []
    try:
        if not _reward_offered():
            return paid
        with _db() as c:
            rw = _reward_settings(c, uid)
            st = _settings(c, uid)
            start = c.execute("SELECT enabled_from FROM rewards WHERE user_id=?", (uid,)).fetchone()
            today = _today(uid, c)
        if not (rw["enabled"] and rw["amount"] > 0 and rw["to_categories"] and st["cal_min"] > 0
                and st["cal_max"] >= st["cal_min"]):
            return paid
        first = max((start["enabled_from"] if start and start["enabled_from"] else today),
                    (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=REWARD_LOOKBACK_DAYS)).strftime("%Y-%m-%d"))
        day = first
        while day < today:
            with _db() as c:
                cur = c.execute("INSERT OR IGNORE INTO reward_days(user_id,day,paid) VALUES(?,?,0)", (uid, day))
                c.commit()
                fresh = bool(cur.rowcount)
            if fresh:
                kcal = _get_day(uid, day)["totals"]["kcal"]
                if st["cal_min"] <= kcal <= st["cal_max"]:
                    to = rw["to_categories"]
                    res = _premium().pay(uid, day, rw["amount"], to if len(to) > 1 else to[0], rw["from_category"])
                    if res.get("ok"):
                        with _db() as c:
                            c.execute("UPDATE reward_days SET paid=1 WHERE user_id=? AND day=?", (uid, day))
                            c.commit()
                        paid.append({"day": day, "amount": rw["amount"], "currency": res.get("currency")})
                    else:  # not paid: let a later opening try again
                        with _db() as c:
                            c.execute("DELETE FROM reward_days WHERE user_id=? AND day=?", (uid, day))
                            c.commit()
            day = (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        pass
    return paid


# ── Models ───────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    day_end_hour: Optional[int] = None
    goal_type: Optional[str] = None
    cal_min: Optional[float] = None
    cal_max: Optional[float] = None
    protein_min: Optional[float] = None
    carbs_max: Optional[float] = None
    sugar_max: Optional[float] = None
    fiber_min: Optional[float] = None
    salt_max: Optional[float] = None
    sex: Optional[str] = None
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    target_weight_kg: Optional[float] = None
    activity: Optional[float] = None


class SuggestBody(BaseModel):
    sex: str = "m"
    age: float = 0
    height_cm: float = 0
    weight_kg: float = 0
    activity: float = 1.375
    goal_type: str = "maintain"
    target_weight_kg: float = 0


class EntryBody(BaseModel):
    day: str
    amount: float
    ref: Optional[str] = None
    food: Optional[dict] = None
    meal: Optional[str] = None
    lang: str = "en"


class EntryEdit(BaseModel):
    amount: Optional[float] = None
    meal: Optional[str] = None


class FoodBody(BaseModel):
    name: str = ""
    unit: str = "g"
    kcal: float = 0
    protein: float = 0
    carbs: float = 0
    sugar: float = 0
    fat: float = 0
    sat_fat: float = 0
    fiber: float = 0
    salt: float = 0
    allergens: List[str] = []
    ingredients: str = ""
    barcode: Optional[str] = None
    brand: Optional[str] = None
    portion: Optional[float] = None


class RecipeBody(BaseModel):
    name: str
    items: List[dict]
    portions: float = 1
    total_g: Optional[float] = None
    lang: str = "en"


class RestrictionBody(BaseModel):
    kind: str
    key: str = ""
    label: str = ""


class CheckBody(BaseModel):
    ref: Optional[str] = None
    food: Optional[dict] = None
    amount: float
    day: Optional[str] = None
    lang: str = "en"


class HealthBody(BaseModel):
    enabled: Optional[bool] = None
    read: Optional[bool] = None
    read_other: Optional[bool] = None


class RewardBody(BaseModel):
    enabled: bool = False
    amount: float = 0
    to_categories: Optional[List[str]] = None
    from_category: Optional[str] = None


def _reply(fn, *args, **kw):
    try:
        return JSONResponse(fn(*args, **kw))
    except LookupError:
        return _bad("not_found", 404)
    except RuntimeError as e:
        return _bad(str(e) or "error", 502)
    except ValueError as e:
        return _bad(str(e) or "invalid_request")


def _auth(token):
    me = _me(token)
    return me["id"] if me else None


# ── Routes ───────────────────────────────────────────────────────

@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Nutrition", "🥗")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    rewards = _settle_rewards(uid)
    offered = _reward_offered()
    with _db() as c:
        out = {"settings": _settings_view(c, uid), "restrictions": _restrictions(c, uid), "rewarded": rewards,
               "reward_offered": offered, "allergens": list(ALLERGENS), "meals": _meals(c, uid)}
        if offered:
            out["reward"] = _reward_settings(c, uid)
    return JSONResponse(out)


@router.put("/settings")
async def put_settings(body: SettingsBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_settings, uid, body.dict(exclude_none=True))


@router.post("/suggest")
async def post_suggest(body: SuggestBody, x_pub_token: str = Header(default=None)):
    if not _auth(x_pub_token):
        return _bad("unauthorized", 401)
    return _reply(suggest_goals, body.sex, body.age, body.height_cm, body.weight_kg, body.activity, body.goal_type,
                  body.target_weight_kg)


@router.get("/day")
async def get_day(day: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_get_day, uid, day)


@router.get("/history")
async def get_history(end: str, days: int = 7, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(lambda u, e, d: {"days": _get_history(u, e, d)}, uid, end, days)


@router.post("/entries")
async def add_entry(body: EntryBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_add_entry, uid, body.day, body.ref, body.amount, body.meal, body.food, body.lang)


@router.put("/entries/{entry_id}")
async def edit_entry(entry_id: str, body: EntryEdit, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_edit_entry, uid, entry_id, body.amount, body.meal)


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_entry, uid, entry_id)


@router.get("/search")
async def search(q: str = "", lang: str = "en", meal: str = "", x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_search_foods, uid, q, lang, 30, meal or None)


class MealBody(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    time: Optional[str] = None


@router.get("/meals")
async def get_meals(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return JSONResponse({"meals": _list_meals(uid), "max": MAX_MEALS})


@router.post("/meals")
async def post_meal(body: MealBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_meal, uid, None, body.name, body.icon, body.time)


@router.put("/meals/{meal_id}")
async def put_meal(meal_id: str, body: MealBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_meal, uid, meal_id, body.name, body.icon, body.time)


@router.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_meal, uid, meal_id)


@router.get("/online")
async def online(q: str, x_pub_token: str = Header(default=None)):
    if not _auth(x_pub_token):
        return _bad("unauthorized", 401)
    return _reply(_search_online, q)


@router.get("/barcode/{code}")
async def barcode(code: str, lang: str = "en", x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_barcode, uid, code, lang)


@router.get("/foods")
async def list_foods(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return JSONResponse({"foods": _list_user_foods(uid)})


@router.post("/foods")
async def add_food(body: FoodBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_add_food, uid, body.dict())


@router.put("/foods/{food_id}")
async def edit_food(food_id: str, body: FoodBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_edit_food, uid, food_id, body.dict())


@router.delete("/foods/{food_id}")
async def delete_food(food_id: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_food, uid, food_id)


@router.post("/remember")
async def remember(body: FoodBody, x_pub_token: str = Header(default=None)):
    """Keep a food found online as the user's own, so it can be picked again."""
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(lambda u, f: _food_by_ref(u, _remember_online(u, f)), uid, body.dict())


@router.post("/recipes")
async def add_recipe(body: RecipeBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_recipe, uid, body.name, body.items, body.portions, body.total_g, body.lang)


@router.post("/restrictions")
async def add_restriction(body: RestrictionBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_add_restriction, uid, body.kind, body.key, body.label)


@router.delete("/restrictions/{rid}")
async def delete_restriction(rid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_restriction, uid, rid)


@router.post("/check")
async def check(body: CheckBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_check, uid, body.food if body.food is not None else body.ref, body.amount, body.day, body.lang)


@router.get("/health")
async def get_health(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return JSONResponse({"enabled": _health_enabled(uid), "read": _health_read_on(uid), "read_other": _read_other_on(uid),
                         "available": _health_available(uid)})


@router.put("/health")
async def put_health(body: HealthBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    if body.read is not None:
        _set_health_read(uid, body.read)
    if body.read_other is not None:
        _set_read_other(uid, body.read_other)
    if body.enabled is not None:
        return JSONResponse(_set_health_link(uid, body.enabled))
    return JSONResponse({"enabled": _health_enabled(uid), "read": _health_read_on(uid), "read_other": _read_other_on(uid),
                         "available": _health_available(uid)})


@router.get("/reward")
async def get_reward(x_pub_token: str = Header(default=None)):
    """The profile's Budget categories for the pickers. They come from the
    premium module; without it the feature does not exist."""
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    if not _reward_offered():
        return _bad("not_found", 404)
    with _db() as c:
        rw = _reward_settings(c, uid)
    return JSONResponse({**_premium().categories(uid), "reward": rw})


@router.put("/reward")
async def put_reward(body: RewardBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    if not _reward_offered():
        return _bad("not_found", 404)
    amount = _num(body.amount, 0, 1000000000)
    if amount is None:
        return _bad("invalid_amount")
    to_cats = []
    for x in (body.to_categories or [])[:50]:
        x = (x or "").strip()[:100]
        if x and x not in to_cats:
            to_cats.append(x)
    from_cat = (body.from_category or "").strip()[:100] or None
    if body.enabled and (not to_cats or amount <= 0):
        return _bad("invalid_reward")
    if from_cat and from_cat in to_cats:
        return _bad("same_category")
    with _db() as c:
        was = c.execute("SELECT enabled FROM rewards WHERE user_id=?", (uid,)).fetchone()
        started = _today(uid, c) if body.enabled and not (was and was["enabled"]) else None
        c.execute(
            "INSERT INTO rewards(user_id,enabled,amount,to_categories,from_category,enabled_from) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, amount=excluded.amount, "
            "to_categories=excluded.to_categories, from_category=excluded.from_category, "
            "enabled_from=COALESCE(?, rewards.enabled_from)",
            (uid, 1 if body.enabled else 0, amount, json.dumps(to_cats), from_cat, started, started),
        )
        c.commit()
        return JSONResponse(_reward_settings(c, uid))
