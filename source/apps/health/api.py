"""
mvmOS Health — a per Apps Hub account collection of health measurements, with
charts and statistics.

Mounted at /pub/health by public_loader.py. Identity is the Apps Hub token
(X-Pub-Token header), used identically by the desktop window and the public
page. Other apps send data through app_api.py; the person always allows that
in the sending app first.

Two kinds of metric, both listed in METRICS (add a line there and the app,
the API and the charts pick it up):
  reading  one measurement at a moment in time, several can exist per day
           (weight, blood pressure). Stored in `readings`.
  daily    a total for a calendar day, summed over its sources (water,
           caffeine, alcohol). Each source, an app or the person by hand,
           owns one value per day in `daily`, so an app can keep correcting
           its own total without touching what was typed in by hand.

A "day" is the person's local calendar date (YYYY-MM-DD) and a moment is a
local YYYY-MM-DDTHH:MM, both sent by the client.
"""
import json
import os
import re
import unicodedata
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

APP_ID = "health"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")
MAX_DAYS = 366
MANUAL = "manual"

# id -> definition. `fields` are the numbers of a reading, each with its
# allowed range; `max` is the largest sensible daily total.
METRICS = {
    "weight":   {"kind": "reading", "group": "body", "unit": "kg",
                 "fields": [("value", 20, 500, False)]},
    "bp":       {"kind": "reading", "group": "body", "unit": "mmHg",
                 "fields": [("sys", 50, 300, False), ("dia", 30, 200, False), ("pulse", 20, 250, True)]},
    "water":    {"kind": "daily", "group": "nutrition", "unit": "ml", "max": 20000},
    "caffeine": {"kind": "daily", "group": "nutrition", "unit": "mg", "max": 5000},
    "alcohol":  {"kind": "daily", "group": "nutrition", "unit": "g", "max": 2000},
    "calories": {"kind": "daily", "group": "nutrition", "unit": "kcal", "max": 20000},
    "sugar":    {"kind": "daily", "group": "nutrition", "unit": "g", "max": 2000},
    "protein":  {"kind": "daily", "group": "nutrition", "unit": "g", "max": 1000},
}


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS readings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                metric TEXT NOT NULL,
                at TEXT NOT NULL,
                day TEXT NOT NULL,
                v1 REAL NOT NULL,
                v2 REAL,
                v3 REAL,
                source TEXT NOT NULL DEFAULT 'manual',
                source_name TEXT,
                source_key TEXT,
                note TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_hl_readings ON readings(user_id, metric, day);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_hl_readings_key
                ON readings(user_id, metric, source, source_key) WHERE source_key IS NOT NULL;
            CREATE TABLE IF NOT EXISTS daily (
                user_id TEXT NOT NULL,
                metric TEXT NOT NULL,
                day TEXT NOT NULL,
                source TEXT NOT NULL,
                source_name TEXT,
                value REAL NOT NULL,
                PRIMARY KEY (user_id, metric, day, source)
            );
            CREATE TABLE IF NOT EXISTS daily_goals (
                user_id TEXT NOT NULL,
                metric TEXT NOT NULL,
                day TEXT NOT NULL,
                source TEXT NOT NULL,
                value REAL NOT NULL,
                PRIMARY KEY (user_id, metric, day, source)
            );
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY,
                weight_unit TEXT NOT NULL DEFAULT 'kg',
                volume_unit TEXT NOT NULL DEFAULT 'ml'
            );
            CREATE TABLE IF NOT EXISTS lab_custom (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                unit TEXT NOT NULL,
                names TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lab_prefs (
                user_id TEXT NOT NULL,
                test_key TEXT NOT NULL,
                code TEXT,
                unit TEXT,
                aliases TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (user_id, test_key)
            );
            CREATE TABLE IF NOT EXISTS lab_results (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                test_key TEXT NOT NULL,
                written_name TEXT,
                value REAL NOT NULL,
                orig_value REAL NOT NULL,
                orig_unit TEXT NOT NULL,
                day TEXT NOT NULL,
                low REAL,
                high REAL,
                lab TEXT,
                note TEXT,
                source TEXT NOT NULL DEFAULT 'manual',
                source_name TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_hl_labs ON lab_results(user_id, test_key, day);
        """)
        c.commit()


_init_db()


def _hub():
    return sys.modules.get("backend.apphub")


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _num(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v != v or v < lo or v > hi:
        return None
    return v


def _check_day(day):
    if not isinstance(day, str) or not DAY_RE.match(day):
        raise ValueError("invalid_day")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise ValueError("invalid_day")
    return day


def _check_at(at):
    if not isinstance(at, str) or not AT_RE.match(at):
        raise ValueError("invalid_time")
    try:
        datetime.strptime(at, "%Y-%m-%dT%H:%M")
    except ValueError:
        raise ValueError("invalid_time")
    return at


def _metric(metric, kind=None):
    m = METRICS.get(metric)
    if not m or (kind and m["kind"] != kind):
        raise LookupError("not found")
    return m


def _now():
    return datetime.now().strftime("%Y-%m-%dT%H:%M")


def _round(v, n=2):
    return None if v is None else round(v, n)


# ── Settings ─────────────────────────────────────────────────────

def _settings(c, uid):
    row = c.execute("SELECT weight_unit,volume_unit FROM settings WHERE user_id=?", (uid,)).fetchone()
    return {"weight_unit": row["weight_unit"], "volume_unit": row["volume_unit"]} if row else \
        {"weight_unit": "kg", "volume_unit": "ml"}


def _set_settings(uid, weight_unit, volume_unit):
    wu = weight_unit if weight_unit in ("kg", "lb") else "kg"
    vu = volume_unit if volume_unit in ("ml", "oz") else "ml"
    with _db() as c:
        c.execute(
            "INSERT INTO settings(user_id,weight_unit,volume_unit) VALUES(?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET weight_unit=excluded.weight_unit, volume_unit=excluded.volume_unit",
            (uid, wu, vu))
        c.commit()
    return {"weight_unit": wu, "volume_unit": vu}


# ── Readings (weight, blood pressure, …) ─────────────────────────

def _reading_out(r):
    return {"id": r["id"], "metric": r["metric"], "at": r["at"], "day": r["day"],
            "v": [r["v1"], r["v2"], r["v3"]], "source": r["source"],
            "source_name": r["source_name"], "note": r["note"] or ""}


def _values(metric, values):
    """Validate the numbers of a reading against its metric's fields."""
    m = _metric(metric, "reading")
    values = list(values or [])
    out = []
    for i, (name, lo, hi, optional) in enumerate(m["fields"]):
        raw = values[i] if i < len(values) else None
        if raw in (None, "") and optional:
            out.append(None)
            continue
        v = _num(raw, lo, hi)
        if v is None:
            raise ValueError("invalid_" + name)
        out.append(round(v, 2))
    while len(out) < 3:
        out.append(None)
    return out


def _add_reading(uid, metric, values, at=None, note="", source=MANUAL, source_name=None, source_key=None):
    v = _values(metric, values)
    at = _check_at(at) if at else _now()
    note = (note or "").strip()[:500]
    with _db() as c:
        if source_key:
            old = c.execute(
                "SELECT * FROM readings WHERE user_id=? AND metric=? AND source=? AND source_key=?",
                (uid, metric, source, source_key)).fetchone()
            if old:
                return _reading_out(old)
        rid = uuid.uuid4().hex
        c.execute(
            "INSERT INTO readings(id,user_id,metric,at,day,v1,v2,v3,source,source_name,source_key,note)"
            " VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (rid, uid, metric, at, at[:10], v[0], v[1], v[2], source, source_name, source_key, note))
        c.commit()
        return _reading_out(c.execute("SELECT * FROM readings WHERE id=?", (rid,)).fetchone())


def _edit_reading(uid, rid, values, at=None, note=None):
    with _db() as c:
        row = c.execute("SELECT * FROM readings WHERE id=? AND user_id=?", (rid, uid)).fetchone()
        if not row:
            raise LookupError("not found")
        v = _values(row["metric"], values)
        at = _check_at(at) if at else row["at"]
        note = row["note"] if note is None else (note or "").strip()[:500]
        c.execute("UPDATE readings SET at=?,day=?,v1=?,v2=?,v3=?,note=? WHERE id=?",
                  (at, at[:10], v[0], v[1], v[2], note, rid))
        c.commit()
        return _reading_out(c.execute("SELECT * FROM readings WHERE id=?", (rid,)).fetchone())


def _delete_reading(uid, rid):
    with _db() as c:
        cur = c.execute("DELETE FROM readings WHERE id=? AND user_id=?", (rid, uid))
        c.commit()
    if not cur.rowcount:
        raise LookupError("not found")
    return {"ok": True}


# ── Daily totals (water, caffeine, alcohol, …) ───────────────────

def _set_daily(uid, metric, day, value, source=MANUAL, source_name=None):
    """Set what one source contributes to a day. Zero (or nothing) removes it."""
    m = _metric(metric, "daily")
    _check_day(day)
    with _db() as c:
        if value in (None, "") or float(value or 0) == 0:
            c.execute("DELETE FROM daily WHERE user_id=? AND metric=? AND day=? AND source=?",
                      (uid, metric, day, source))
        else:
            v = _num(value, 0, m["max"])
            if v is None:
                raise ValueError("invalid_value")
            c.execute(
                "INSERT INTO daily(user_id,metric,day,source,source_name,value) VALUES(?,?,?,?,?,?) "
                "ON CONFLICT(user_id,metric,day,source) DO UPDATE SET value=excluded.value, source_name=excluded.source_name",
                (uid, metric, day, source, source_name, round(v, 2)))
        c.commit()
    return {"ok": True}


def _set_daily_goal(uid, metric, day, value, source):
    """The goal one source had for a day's total of a metric (the water an app
    asks you to drink that day). Zero (or nothing) removes it. A source sends
    the goal of each day as it was then, so the chart shows every day against
    its own goal."""
    m = _metric(metric, "daily")
    _check_day(day)
    with _db() as c:
        if value in (None, "") or float(value or 0) == 0:
            c.execute("DELETE FROM daily_goals WHERE user_id=? AND metric=? AND day=? AND source=?",
                      (uid, metric, day, source))
        else:
            v = _num(value, 0, m["max"])
            if v is None:
                raise ValueError("invalid_goal")
            c.execute(
                "INSERT INTO daily_goals(user_id,metric,day,source,value) VALUES(?,?,?,?,?) "
                "ON CONFLICT(user_id,metric,day,source) DO UPDATE SET value=excluded.value",
                (uid, metric, day, source, round(v, 2)))
        c.commit()


def _set_daily_many(uid, day, values, source, source_name, goals=None):
    if not isinstance(values, dict) or not values:
        raise ValueError("invalid_values")
    if goals is not None and not isinstance(goals, dict):
        raise ValueError("invalid_goals")
    for metric in list(values) + list(goals or {}):
        _metric(metric, "daily")
    for metric, value in values.items():
        _set_daily(uid, metric, day, value, source, source_name)
    for metric, value in (goals or {}).items():
        _set_daily_goal(uid, metric, day, value, source)
    return {"ok": True}


# ── Series and statistics ────────────────────────────────────────

def _range(end, days):
    _check_day(end)
    days = max(1, min(int(days), MAX_DAYS))
    end_d = datetime.strptime(end, "%Y-%m-%d")
    return (end_d - timedelta(days=days - 1)).strftime("%Y-%m-%d"), end, days


def _bp_category(sys_v, dia_v):
    if sys_v > 180 or dia_v > 120:
        return "crisis"
    if sys_v >= 140 or dia_v >= 90:
        return "stage2"
    if sys_v >= 130 or dia_v >= 80:
        return "stage1"
    if sys_v >= 120:
        return "elevated"
    return "normal"


def _field_stats(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"latest": vals[-1], "first": vals[0], "min": min(vals), "max": max(vals),
            "avg": _round(sum(vals) / len(vals)), "change": _round(vals[-1] - vals[0]), "count": len(vals)}


def _series(uid, metric, end, days):
    m = _metric(metric)
    start, end, days = _range(end, days)
    out = {"metric": metric, "kind": m["kind"], "unit": m["unit"], "start": start, "end": end, "days": days}
    with _db() as c:
        if m["kind"] == "reading":
            rows = c.execute(
                "SELECT * FROM readings WHERE user_id=? AND metric=? AND day>=? AND day<=? ORDER BY at ASC, rowid ASC",
                (uid, metric, start, end)).fetchall()
            pts = [_reading_out(r) for r in rows]
            out["points"] = pts
            out["fields"] = [f[0] for f in m["fields"]]
            out["stats"] = [_field_stats([p["v"][i] for p in pts]) for i in range(len(m["fields"]))]
            last = c.execute(
                "SELECT * FROM readings WHERE user_id=? AND metric=? ORDER BY at DESC, rowid DESC LIMIT 1",
                (uid, metric)).fetchone()
            out["latest"] = _reading_out(last) if last else None
            if metric == "bp" and pts:
                cats = {}
                for p in pts:
                    k = _bp_category(p["v"][0], p["v"][1])
                    cats[k] = cats.get(k, 0) + 1
                out["categories"] = cats
                out["category"] = _bp_category(pts[-1]["v"][0], pts[-1]["v"][1])
        else:
            rows = c.execute(
                "SELECT day,source,source_name,value FROM daily WHERE user_id=? AND metric=? AND day>=? AND day<=? "
                "ORDER BY day ASC, source ASC", (uid, metric, start, end)).fetchall()
            by_day = {}
            for r in rows:
                d = by_day.setdefault(r["day"], {"day": r["day"], "total": 0, "sources": []})
                d["total"] = round(d["total"] + r["value"], 2)
                d["sources"].append({"source": r["source"], "name": r["source_name"], "value": r["value"]})
            # A day's goal: the highest any source set for it.
            goals = {}
            for r in c.execute("SELECT day, MAX(value) AS goal FROM daily_goals WHERE user_id=? AND metric=? "
                               "AND day>=? AND day<=? GROUP BY day ORDER BY day", (uid, metric, start, end)):
                goals[r["day"]] = r["goal"]
            for d in by_day.values():
                if d["day"] in goals:
                    d["goal"] = goals[d["day"]]
            pts = list(by_day.values())
            out["points"] = pts
            out["goals"] = [{"day": d, "goal": g} for d, g in goals.items()]
            met = [p for p in pts if "goal" in p]
            out["goal_days"] = {"met": sum(1 for p in met if p["total"] >= p["goal"]), "of": len(met)} if met else None
            totals = [p["total"] for p in pts]
            out["stats"] = None
            if totals:
                best = max(pts, key=lambda p: p["total"])
                out["stats"] = {"avg": _round(sum(totals) / len(totals)), "total": _round(sum(totals)),
                                "max": best["total"], "max_day": best["day"], "min": min(totals),
                                "count": len(totals), "latest": pts[-1]["total"], "latest_day": pts[-1]["day"]}
    return out


def _overview(uid, end):
    """Every metric at a glance: its latest value, the last week's average
    and the last month for a small chart."""
    with _db() as c:
        settings = _settings(c, uid)
    week_start = _range(end, 7)[0]
    items = {}
    for metric, m in METRICS.items():
        s = _series(uid, metric, end, 30)
        item = {"metric": metric, "kind": m["kind"], "unit": m["unit"], "points": s["points"]}
        if m["kind"] == "reading":
            item["latest"] = s["latest"]
            wk = [p for p in s["points"] if p["day"] >= week_start]
            item["week"] = [_field_stats([p["v"][i] for p in wk]) for i in range(len(m["fields"]))]
            if metric == "bp" and s["latest"]:
                item["category"] = _bp_category(s["latest"]["v"][0], s["latest"]["v"][1])
        else:
            wk = [p["total"] for p in s["points"] if p["day"] >= week_start]
            item["week_avg"] = _round(sum(wk) / len(wk)) if wk else None
            item["latest"] = s["points"][-1] if s["points"] else None
        items[metric] = item
    return {"settings": settings, "metrics": items}


def _list_metrics():
    return [{"id": k, "kind": v["kind"], "group": v["group"], "unit": v["unit"],
             "fields": [f[0] for f in v["fields"]] if v["kind"] == "reading" else None}
            for k, v in METRICS.items()]


# ── Laboratory results ───────────────────────────────────────────
# A test is identified by a key, never by the words a lab printed. The
# built-in catalog (labs.json) gives each test its code (LOINC), the unit
# results are kept in, conversions from other common units, a display name
# per language and any number of known aliases. A person can add aliases,
# change the code shown and pick the unit to see, or create their own tests.
# Each result keeps the name and unit exactly as written on the form and the
# reference range of that very form.

def _load_catalog():
    try:
        with open(os.path.join(_DIR, "labs.json"), encoding="utf-8") as f:
            return {t["key"]: t for t in json.load(f)}
    except Exception:
        return {}


LAB_CATALOG = _load_catalog()
MAX_LAB_VALUE = 1e9


def _norm(text):
    """Comparable form of a name: letter case, accents, spaces and punctuation
    do not matter."""
    text = unicodedata.normalize("NFKD", str(text or "")).lower()
    return "".join(ch for ch in text if ch.isalnum())


def _clean_aliases(items):
    out, seen = [], set()
    for a in items or []:
        a = str(a or "").strip()[:80]
        if a and _norm(a) and _norm(a) not in seen:
            seen.add(_norm(a))
            out.append(a)
    return out[:40]


def _clean_names(names):
    out = {}
    for lang, name in (names or {}).items():
        name = str(name or "").strip()[:80]
        if name and isinstance(lang, str) and len(lang) <= 8:
            out[lang] = name
    return out


def _conv(unit_def, unit):
    """(factor, offset) turning a value in `unit` into the base unit."""
    if unit == unit_def["unit"]:
        return 1.0, 0.0
    f = (unit_def.get("units") or {}).get(unit)
    if not f:
        raise ValueError("invalid_unit")
    return float(f[0]), float(f[1])


def _to_base(t, value, unit):
    f, o = _conv(t, unit)
    return value * f + o


def _from_base(t, value, unit):
    f, o = _conv(t, unit)
    return (value - o) / f


def _lab_tests(c, uid):
    """Every test this person can use: catalog tests and their own."""
    prefs = {r["test_key"]: r for r in c.execute("SELECT * FROM lab_prefs WHERE user_id=?", (uid,))}
    tests = []
    for key, t in LAB_CATALOG.items():
        tests.append({"key": key, "custom": False, "catalog_code": t["code"], "unit": t["unit"],
                      "units": t.get("units") or {}, "names": t["names"], "aliases": list(t["aliases"])})
    for r in c.execute("SELECT * FROM lab_custom WHERE user_id=?", (uid,)):
        tests.append({"key": r["id"], "custom": True, "catalog_code": "", "unit": r["unit"], "units": {},
                      "names": json.loads(r["names"]), "aliases": []})
    for t in tests:
        p = prefs.get(t["key"])
        mine = json.loads(p["aliases"]) if p else []
        t["user_aliases"] = mine
        t["aliases"] = t["aliases"] + [a for a in mine if a not in t["aliases"]]
        t["code"] = p["code"] if p and p["code"] is not None else t["catalog_code"]
        t["base_unit"] = t["unit"]
        allowed = [t["unit"]] + list(t["units"].keys())
        t["display_unit"] = p["unit"] if p and p["unit"] in allowed else t["unit"]
    return tests


def _test_map(c, uid):
    return {t["key"]: t for t in _lab_tests(c, uid)}


def _test_keys(t):
    """Every comparable form a test answers to: its codes, aliases and names,
    a name also without a trailing "(abbreviation)"."""
    keys = {_norm(t["code"]), _norm(t["catalog_code"])} | {_norm(x) for x in t["aliases"]}
    for name in t["names"].values():
        keys.add(_norm(name))
        keys.add(_norm(re.sub(r"\s*\([^)]*\)\s*$", "", name)))
    keys.discard("")
    return keys


def _find_test(c, uid, text, unit=None):
    """A test by key, code, any of its names or any alias. A name some tests
    share once the signs are gone (NEUT% and NEUT#) goes to the one that
    knows the unit."""
    n = _norm(text)
    if not n:
        return None
    tests = _lab_tests(c, uid)
    for t in tests:
        if t["key"] == text:
            return t
    found = [t for t in tests if n in _test_keys(t)]
    for t in found:
        if unit and (unit == t["unit"] or unit in (t["units"] or {})):
            return t
    return found[0] if found else None


def _lab_out(t, r):
    du = t["display_unit"]
    conv = lambda v: None if v is None else round(_from_base(t, v, du), 4)
    status = None
    if r["low"] is not None and r["value"] < r["low"]:
        status = "low"
    elif r["high"] is not None and r["value"] > r["high"]:
        status = "high"
    elif r["low"] is not None or r["high"] is not None:
        status = "ok"
    return {"id": r["id"], "test": r["test_key"], "day": r["day"], "value": conv(r["value"]), "unit": du,
            "low": conv(r["low"]), "high": conv(r["high"]), "status": status,
            "orig_value": r["orig_value"], "orig_unit": r["orig_unit"], "written_name": r["written_name"] or "",
            "lab": r["lab"] or "", "note": r["note"] or "", "source": r["source"], "source_name": r["source_name"]}


def _save_custom_test(uid, key, code, unit, names, aliases):
    names = _clean_names(names)
    unit = str(unit or "").strip()[:20]
    if not names:
        raise ValueError("invalid_name")
    if not unit:
        raise ValueError("invalid_unit")
    with _db() as c:
        if key:
            row = c.execute("SELECT id FROM lab_custom WHERE id=? AND user_id=?", (key, uid)).fetchone()
            if not row:
                raise LookupError("not found")
            c.execute("UPDATE lab_custom SET unit=?, names=? WHERE id=?", (unit, json.dumps(names, ensure_ascii=False), key))
        else:
            if len(c.execute("SELECT 1 FROM lab_custom WHERE user_id=?", (uid,)).fetchall()) >= 200:
                raise ValueError("too_many")
            key = "c_" + uuid.uuid4().hex[:12]
            c.execute("INSERT INTO lab_custom(id,user_id,unit,names) VALUES(?,?,?,?)",
                      (key, uid, unit, json.dumps(names, ensure_ascii=False)))
        c.commit()
    _save_prefs(uid, key, code, None, aliases)
    with _db() as c:
        return _test_map(c, uid)[key]


def _save_prefs(uid, key, code, unit, aliases):
    with _db() as c:
        t = _test_map(c, uid).get(key)
        if not t:
            raise LookupError("not found")
        code = t["code"] if code is None else str(code).strip()[:30]
        allowed = [t["base_unit"]] + list(t["units"].keys())
        unit = unit if unit in allowed else t["display_unit"]
        mine = _clean_aliases(aliases) if aliases is not None else t["user_aliases"]
        c.execute("INSERT INTO lab_prefs(user_id,test_key,code,unit,aliases) VALUES(?,?,?,?,?) "
                  "ON CONFLICT(user_id,test_key) DO UPDATE SET code=excluded.code, unit=excluded.unit, aliases=excluded.aliases",
                  (uid, key, code, unit, json.dumps(mine, ensure_ascii=False)))
        c.commit()
        return _test_map(c, uid)[key]


def _delete_custom_test(uid, key):
    with _db() as c:
        cur = c.execute("DELETE FROM lab_custom WHERE id=? AND user_id=?", (key, uid))
        if not cur.rowcount:
            raise LookupError("not found")
        c.execute("DELETE FROM lab_results WHERE test_key=? AND user_id=?", (key, uid))
        c.execute("DELETE FROM lab_prefs WHERE test_key=? AND user_id=?", (key, uid))
        c.commit()
    return {"ok": True}


def _lab_fields(t, value, unit, low, high):
    unit = (unit or t["display_unit"]).strip()
    v = _num(value, -MAX_LAB_VALUE, MAX_LAB_VALUE)
    if v is None:
        raise ValueError("invalid_value")
    base = _to_base(t, v, unit)
    lo = None if low in (None, "") else _num(low, -MAX_LAB_VALUE, MAX_LAB_VALUE)
    hi = None if high in (None, "") else _num(high, -MAX_LAB_VALUE, MAX_LAB_VALUE)
    if (low not in (None, "") and lo is None) or (high not in (None, "") and hi is None):
        raise ValueError("invalid_range")
    if lo is not None and hi is not None and lo > hi:
        raise ValueError("invalid_range")
    return (unit, v, round(base, 6), None if lo is None else round(_to_base(t, lo, unit), 6),
            None if hi is None else round(_to_base(t, hi, unit), 6))


def _remember_alias(c, uid, t, written):
    """A name the person typed for a test is kept, so it is recognised next time."""
    written = (written or "").strip()
    if not written or _norm(written) in _test_keys(t):
        return
    mine = _clean_aliases(t["user_aliases"] + [written])
    c.execute("INSERT INTO lab_prefs(user_id,test_key,code,unit,aliases) VALUES(?,?,?,?,?) "
              "ON CONFLICT(user_id,test_key) DO UPDATE SET aliases=excluded.aliases",
              (uid, t["key"], t["code"], t["display_unit"], json.dumps(mine, ensure_ascii=False)))


def _add_lab(uid, test, value, unit=None, day=None, low=None, high=None, lab="", note="",
             written_name="", source=MANUAL, source_name=None):
    with _db() as c:
        t = _find_test(c, uid, test, unit)
        if not t:
            raise LookupError("not found")
        day = _check_day(day) if day else datetime.now().strftime("%Y-%m-%d")
        unit, orig, base, lo, hi = _lab_fields(t, value, unit, low, high)
        rid = uuid.uuid4().hex
        c.execute("INSERT INTO lab_results(id,user_id,test_key,written_name,value,orig_value,orig_unit,day,low,high,lab,note,source,source_name)"
                  " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (rid, uid, t["key"], (written_name or "").strip()[:80], base, orig, unit, day, lo, hi,
                   (lab or "").strip()[:80], (note or "").strip()[:500], source, source_name))
        if source == MANUAL:
            _remember_alias(c, uid, t, written_name)
        c.commit()
        return _lab_out(t, c.execute("SELECT * FROM lab_results WHERE id=?", (rid,)).fetchone())


def _edit_lab(uid, rid, value, unit, day, low, high, lab, note, written_name):
    with _db() as c:
        row = c.execute("SELECT * FROM lab_results WHERE id=? AND user_id=?", (rid, uid)).fetchone()
        if not row:
            raise LookupError("not found")
        t = _test_map(c, uid).get(row["test_key"])
        if not t:
            raise LookupError("not found")
        day = _check_day(day) if day else row["day"]
        unit, orig, base, lo, hi = _lab_fields(t, value, unit, low, high)
        c.execute("UPDATE lab_results SET value=?,orig_value=?,orig_unit=?,day=?,low=?,high=?,lab=?,note=?,written_name=? WHERE id=?",
                  (base, orig, unit, day, lo, hi, (lab or "").strip()[:80], (note or "").strip()[:500],
                   (written_name or "").strip()[:80], rid))
        if row["source"] == MANUAL:
            _remember_alias(c, uid, t, written_name)
        c.commit()
        return _lab_out(t, c.execute("SELECT * FROM lab_results WHERE id=?", (rid,)).fetchone())


def _delete_lab(uid, rid):
    with _db() as c:
        cur = c.execute("DELETE FROM lab_results WHERE id=? AND user_id=?", (rid, uid))
        c.commit()
    if not cur.rowcount:
        raise LookupError("not found")
    return {"ok": True}


def _lab_results(uid, test):
    with _db() as c:
        t = _find_test(c, uid, test)
        if not t:
            raise LookupError("not found")
        rows = c.execute("SELECT * FROM lab_results WHERE user_id=? AND test_key=? ORDER BY day ASC, rowid ASC LIMIT 1000",
                         (uid, t["key"])).fetchall()
    return {"test": t, "results": [_lab_out(t, r) for r in rows]}


def _lab_overview(uid):
    """Tests that have results: the latest one, the one before it and the
    values in between for a small chart."""
    with _db() as c:
        tests = _test_map(c, uid)
        out = []
        for key in [r["test_key"] for r in c.execute(
                "SELECT test_key, MAX(day) d FROM lab_results WHERE user_id=? GROUP BY test_key ORDER BY d DESC", (uid,))]:
            t = tests.get(key)
            if not t:
                continue
            rows = c.execute("SELECT * FROM lab_results WHERE user_id=? AND test_key=? ORDER BY day DESC, rowid DESC LIMIT 12",
                             (uid, key)).fetchall()
            res = [_lab_out(t, r) for r in reversed(rows)]
            out.append({"test": t, "latest": res[-1], "previous": res[-2] if len(res) > 1 else None, "points": res})
        labs = [r["lab"] for r in c.execute(
            "SELECT lab, MAX(day) d FROM lab_results WHERE user_id=? AND lab<>'' GROUP BY lab ORDER BY d DESC, lab", (uid,))]
    return {"tests": out, "catalog": list(tests.values()), "labs": labs}


def _lab_catalog(uid):
    with _db() as c:
        return {"tests": _lab_tests(c, uid)}


def _reply(fn, *args):
    try:
        return JSONResponse(fn(*args))
    except LookupError:
        return _bad("not_found", 404)
    except ValueError as e:
        return _bad(str(e) or "invalid_request")


# ── Routes ───────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    weight_unit: str = "kg"
    volume_unit: str = "ml"


class ReadingBody(BaseModel):
    metric: str = ""
    values: list = []
    at: Optional[str] = None
    note: Optional[str] = None


class DailyBody(BaseModel):
    metric: str
    day: str
    value: float = 0


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Health", "❤️")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    with _db() as c:
        return JSONResponse({"settings": _settings(c, me["id"]), "metrics": _list_metrics()})


@router.put("/settings")
async def put_settings(body: SettingsBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return JSONResponse(_set_settings(me["id"], body.weight_unit, body.volume_unit))


@router.get("/overview")
async def get_overview(end: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_overview, me["id"], end)


@router.get("/series")
async def get_series(metric: str, end: str, days: int = 30, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_series, me["id"], metric, end, days)


@router.post("/readings")
async def add_reading(body: ReadingBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_add_reading, me["id"], body.metric, body.values, body.at, body.note or "")


@router.put("/readings/{rid}")
async def edit_reading(rid: str, body: ReadingBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_edit_reading, me["id"], rid, body.values, body.at, body.note)


@router.delete("/readings/{rid}")
async def delete_reading(rid: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_delete_reading, me["id"], rid)


@router.put("/daily")
async def put_daily(body: DailyBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_set_daily, me["id"], body.metric, body.day, body.value)


@router.delete("/daily")
async def delete_daily(metric: str, day: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return _bad("unauthorized", 401)
    return _reply(_set_daily, me["id"], metric, day, 0)


class LabTestBody(BaseModel):
    code: Optional[str] = None
    unit: Optional[str] = None
    names: Optional[dict] = None
    aliases: Optional[list] = None


class LabBody(BaseModel):
    test: str = ""
    value: float = 0
    unit: Optional[str] = None
    day: Optional[str] = None
    low: Optional[float] = None
    high: Optional[float] = None
    lab: Optional[str] = None
    note: Optional[str] = None
    written_name: Optional[str] = None


def _labs_auth(token):
    me = _me(token)
    return me["id"] if me else None


@router.get("/labs/tests")
async def labs_tests(x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_lab_catalog, uid) if uid else _bad("unauthorized", 401)


@router.post("/labs/tests")
async def labs_create_test(body: LabTestBody, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_save_custom_test, uid, None, body.code or "", body.unit, body.names, body.aliases) if uid else _bad("unauthorized", 401)


@router.put("/labs/tests/{key}")
async def labs_update_test(key: str, body: LabTestBody, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    if body.names is not None and key.startswith("c_"):
        return _reply(_save_custom_test, uid, key, body.code, body.unit, body.names, body.aliases)
    return _reply(_save_prefs, uid, key, body.code, body.unit, body.aliases)


@router.delete("/labs/tests/{key}")
async def labs_delete_test(key: str, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_delete_custom_test, uid, key) if uid else _bad("unauthorized", 401)


@router.get("/labs/overview")
async def labs_overview(x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_lab_overview, uid) if uid else _bad("unauthorized", 401)


@router.get("/labs/results")
async def labs_results(test: str, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_lab_results, uid, test) if uid else _bad("unauthorized", 401)


@router.post("/labs/results")
async def labs_add(body: LabBody, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_add_lab, uid, body.test, body.value, body.unit, body.day, body.low, body.high,
                  body.lab or "", body.note or "", body.written_name or "")


@router.put("/labs/results/{rid}")
async def labs_edit(rid: str, body: LabBody, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_edit_lab, uid, rid, body.value, body.unit, body.day, body.low, body.high,
                  body.lab or "", body.note or "", body.written_name or "")


@router.delete("/labs/results/{rid}")
async def labs_delete(rid: str, x_pub_token: str = Header(default=None)):
    uid = _labs_auth(x_pub_token)
    return _reply(_delete_lab, uid, rid) if uid else _bad("unauthorized", 401)
