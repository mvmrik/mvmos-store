"""
mvmOS Fitness — a per Apps Hub account training log.

Mounted at /pub/fitness by public_loader.py. Identity is the Apps Hub token
(X-Pub-Token header), used identically by the desktop window and the public
page, so there is no separate backend.py.

What a person does is kept as sessions made of sets. An exercise has a type
that says which numbers one set has:
  weight_reps  weight (kg) and repetitions
  reps         repetitions only (push-ups, pull-ups)
  time         seconds (a plank, a hold)
  distance     distance (km) and time (running, cycling, swimming)
  cardio       time, with a distance when there is one (a bike, a rope)
Everything is stored in kg, km and seconds; pounds and miles are only how the
window shows and takes them.

A workout is a template: ordered exercises with a target for each, optionally
grouped as a superset, run as the usual sets, as circuit rounds or as
work/rest intervals. Starting one creates an active session with every set
planned; the person fills it in set by set and finishes it. Records and
statistics are always worked out from the sets that were done, never stored
separately, so correcting a set corrects them.

A "day" is the client's local calendar date (YYYY-MM-DD).
"""
import json
import os
import re
import sqlite3
import sys
import time
import uuid
from datetime import datetime, timedelta

from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "fitness"
_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_CATALOG_PATH = os.path.join(_PUBLIC_DIR, "exercises.json")

DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$")
TYPES = ("weight_reps", "reps", "time", "distance", "cardio")
MUSCLES = ("chest", "back", "shoulders", "biceps", "triceps", "forearms", "abs", "quads", "hamstrings", "glutes",
           "calves", "full_body", "cardio")
EQUIP = ("barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "bands", "cardio_machine", "none")
MODES = ("standard", "circuit", "interval")
KINDS = ("normal", "warmup", "failure")
HEALTH_SYNC_DAYS = 90
DEFAULT_REST = 90
DEFAULT_KG = 70.0
MAX_SETS_PER_ITEM = 30
MAX_ITEMS = 40
MAX_SESSION_SETS = 400
MAX_HOURS = 8


# ── Basics ───────────────────────────────────────────────────────

def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _hub():
    return sys.modules.get("backend.apphub")


def _premium():
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _auth(token):
    me = _me(token)
    return me["id"] if me else None


def _num(v, lo, hi, default=None):
    if v is None or v == "":
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


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _db() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                user_id TEXT PRIMARY KEY,
                sex TEXT NOT NULL DEFAULT '',
                age INTEGER NOT NULL DEFAULT 0,
                height_cm REAL NOT NULL DEFAULT 0,
                weight_kg REAL NOT NULL DEFAULT 0,
                rest_s INTEGER NOT NULL DEFAULT 90,
                week_goal INTEGER NOT NULL DEFAULT 3
            );
            CREATE TABLE IF NOT EXISTS health_link (
                user_id TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 0,
                read_profile INTEGER NOT NULL DEFAULT 0,
                read_other INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE IF NOT EXISTS exercises (
                user_id TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                muscle TEXT NOT NULL DEFAULT 'full_body',
                equip TEXT NOT NULL DEFAULT 'none',
                met REAL NOT NULL DEFAULT 5,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE IF NOT EXISTS templates (
                user_id TEXT NOT NULL,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                mode TEXT NOT NULL DEFAULT 'standard',
                rounds INTEGER NOT NULL DEFAULT 1,
                work_s INTEGER NOT NULL DEFAULT 0,
                rest_s INTEGER NOT NULL DEFAULT 0,
                days TEXT NOT NULL DEFAULT '[]',
                position INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE IF NOT EXISTS template_items (
                user_id TEXT NOT NULL,
                template_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                ex_ref TEXT NOT NULL,
                sets INTEGER NOT NULL DEFAULT 3,
                reps REAL NOT NULL DEFAULT 0,
                weight REAL NOT NULL DEFAULT 0,
                secs REAL NOT NULL DEFAULT 0,
                dist REAL NOT NULL DEFAULT 0,
                rest_s INTEGER NOT NULL DEFAULT 0,
                group_no INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_fi_titems ON template_items(user_id, template_id, position);
            CREATE TABLE IF NOT EXISTS sessions (
                user_id TEXT NOT NULL,
                id TEXT NOT NULL,
                day TEXT NOT NULL,
                started_at TEXT NOT NULL DEFAULT '',
                started_ts REAL NOT NULL DEFAULT 0,
                name TEXT NOT NULL DEFAULT '',
                template_id TEXT,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                duration_s INTEGER NOT NULL DEFAULT 0,
                kcal REAL NOT NULL DEFAULT 0,
                body_kg REAL NOT NULL DEFAULT 0,
                mode TEXT NOT NULL DEFAULT 'standard',
                work_s INTEGER NOT NULL DEFAULT 0,
                rest_s INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_fi_sessions ON sessions(user_id, day);
            CREATE TABLE IF NOT EXISTS session_sets (
                user_id TEXT NOT NULL,
                id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                ex_ref TEXT NOT NULL,
                ex_name TEXT NOT NULL DEFAULT '',
                ex_type TEXT NOT NULL DEFAULT 'weight_reps',
                muscle TEXT NOT NULL DEFAULT 'full_body',
                met REAL NOT NULL DEFAULT 5,
                group_no INTEGER NOT NULL DEFAULT 0,
                set_no INTEGER NOT NULL DEFAULT 1,
                kind TEXT NOT NULL DEFAULT 'normal',
                t_reps REAL NOT NULL DEFAULT 0,
                t_weight REAL NOT NULL DEFAULT 0,
                t_secs REAL NOT NULL DEFAULT 0,
                t_dist REAL NOT NULL DEFAULT 0,
                reps REAL NOT NULL DEFAULT 0,
                weight REAL NOT NULL DEFAULT 0,
                secs REAL NOT NULL DEFAULT 0,
                dist REAL NOT NULL DEFAULT 0,
                rpe REAL NOT NULL DEFAULT 0,
                rest_s INTEGER NOT NULL DEFAULT 0,
                done INTEGER NOT NULL DEFAULT 0,
                done_at TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                prs TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY (user_id, id)
            );
            CREATE INDEX IF NOT EXISTS idx_fi_sets_s ON session_sets(user_id, session_id, position);
            CREATE INDEX IF NOT EXISTS idx_fi_sets_e ON session_sets(user_id, ex_ref);
        """)
        c.commit()


_init_db()

_CATALOG = None


def _catalog():
    global _CATALOG
    if _CATALOG is None:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            _CATALOG = {"r:" + e["id"]: dict(e, ref="r:" + e["id"], custom=False) for e in json.load(f)}
    return _CATALOG


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _check_day(day):
    if not isinstance(day, str) or not DAY_RE.match(day):
        raise ValueError("invalid_day")
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise ValueError("invalid_day")


# ── Settings, body data ──────────────────────────────────────────

def _settings(c, uid):
    row = c.execute("SELECT * FROM settings WHERE user_id=?", (uid,)).fetchone()
    if not row:
        c.execute("INSERT INTO settings(user_id) VALUES(?)", (uid,))
        row = c.execute("SELECT * FROM settings WHERE user_id=?", (uid,)).fetchone()
    return dict(row)


def _link(c, uid):
    row = c.execute("SELECT * FROM health_link WHERE user_id=?", (uid,)).fetchone()
    return dict(row) if row else {"enabled": 0, "read_profile": 0, "read_other": 0}


def _health_profile(uid):
    hub = _hub()
    if hub is None:
        return None
    try:
        return hub.call_app_api("health", "get_profile", uid)
    except Exception:
        return None


def _settings_view(c, uid):
    """The settings as the person sees them. With "take my body data from
    Health" on, sex, age, height and weight are Health's current values."""
    st = _settings(c, uid)
    link = _link(c, uid)
    st["health_read"] = bool(link["read_profile"])
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


def _body_kg(c, uid):
    st = _settings_view(c, uid)
    return float(st.get("weight_kg") or 0)


def _save_settings(uid, data):
    fields = {"age": (0, 120), "height_cm": (0, 250), "weight_kg": (0, 500), "rest_s": (10, 900), "week_goal": (1, 14)}
    with _db() as c:
        cur = _settings(c, uid)
        link = _link(c, uid)
        for k, (lo, hi) in fields.items():
            if k not in data or data[k] is None:
                continue
            if link["read_profile"] and k in ("age", "height_cm", "weight_kg"):
                continue
            v = _num(data[k], lo, hi)
            if v is None:
                raise ValueError("invalid_" + k)
            cur[k] = int(round(v)) if k in ("age", "rest_s", "week_goal") else round(v, 1)
        if "sex" in data and data["sex"] is not None and not link["read_profile"]:
            if data["sex"] not in ("", "m", "f"):
                raise ValueError("invalid_sex")
            cur["sex"] = data["sex"]
        c.execute("UPDATE settings SET sex=?,age=?,height_cm=?,weight_kg=?,rest_s=?,week_goal=? WHERE user_id=?",
                  (cur["sex"], cur["age"], cur["height_cm"], cur["weight_kg"], cur["rest_s"], cur["week_goal"], uid))
        c.commit()
        return _settings_view(c, uid)


# ── Exercises ────────────────────────────────────────────────────

def _custom_exercises(c, uid):
    return [dict(r, ref="u:" + r["id"], custom=True) for r in
            c.execute("SELECT id,name,type,muscle,equip,met FROM exercises WHERE user_id=? ORDER BY name COLLATE NOCASE", (uid,))]


def _exercise(c, uid, ref):
    """One exercise by ref (r:<id> ready-made, u:<id> the person's own)."""
    ref = str(ref or "")
    if ref.startswith("r:"):
        e = _catalog().get(ref)
        if e:
            return dict(e)
    elif ref.startswith("u:"):
        r = c.execute("SELECT id,name,type,muscle,equip,met FROM exercises WHERE user_id=? AND id=?",
                      (uid, ref[2:])).fetchone()
        if r:
            return dict(r, ref=ref, custom=True)
    raise LookupError("not found")


def _find_exercise(c, uid, ref, lang_names=None):
    """A ref, or a name (any case) of a ready-made or own exercise."""
    try:
        return _exercise(c, uid, ref)
    except LookupError:
        pass
    low = str(ref or "").strip().casefold().replace(" ", "_").replace("-", "_")
    for e in _custom_exercises(c, uid):
        if e["name"].casefold() == str(ref or "").strip().casefold():
            return e
    for k, e in _catalog().items():
        if e["id"] == low or e["name"].casefold() == str(ref or "").strip().casefold():
            return dict(e)
    raise LookupError("not found")


def _exercise_fields(d, partial=False):
    out = {}
    name = str(d.get("name") or "").strip()
    if not name or len(name) > 80:
        raise ValueError("invalid_name")
    out["name"] = name
    out["type"] = d.get("type") if d.get("type") in TYPES else None
    if out["type"] is None:
        raise ValueError("invalid_type")
    out["muscle"] = d.get("muscle") if d.get("muscle") in MUSCLES else "full_body"
    out["equip"] = d.get("equip") if d.get("equip") in EQUIP else "none"
    met = _num(d.get("met"), 1, 20, None)
    out["met"] = met if met is not None else {"weight_reps": 4.5, "reps": 4.0, "time": 3.3, "distance": 7.0, "cardio": 6.0}[out["type"]]
    return out


def _add_exercise(uid, d):
    f = _exercise_fields(d)
    with _db() as c:
        if c.execute("SELECT COUNT(*) n FROM exercises WHERE user_id=?", (uid,)).fetchone()["n"] >= 500:
            raise ValueError("too_many")
        eid = uuid.uuid4().hex[:12]
        c.execute("INSERT INTO exercises(user_id,id,name,type,muscle,equip,met) VALUES(?,?,?,?,?,?,?)",
                  (uid, eid, f["name"], f["type"], f["muscle"], f["equip"], f["met"]))
        c.commit()
        return _exercise(c, uid, "u:" + eid)


def _edit_exercise(uid, eid, d):
    f = _exercise_fields(d)
    with _db() as c:
        cur = c.execute("SELECT type FROM exercises WHERE user_id=? AND id=?", (uid, eid)).fetchone()
        if not cur:
            raise LookupError("not found")
        # The type decides how its sets were recorded, so it stays once sets exist.
        used = c.execute("SELECT 1 FROM session_sets WHERE user_id=? AND ex_ref=? LIMIT 1", (uid, "u:" + eid)).fetchone()
        if used and f["type"] != cur["type"]:
            raise ValueError("type_in_use")
        c.execute("UPDATE exercises SET name=?,type=?,muscle=?,equip=?,met=? WHERE user_id=? AND id=?",
                  (f["name"], f["type"], f["muscle"], f["equip"], f["met"], uid, eid))
        c.execute("UPDATE session_sets SET ex_name=? WHERE user_id=? AND ex_ref=?", (f["name"], uid, "u:" + eid))
        c.commit()
        return _exercise(c, uid, "u:" + eid)


def _delete_exercise(uid, eid):
    with _db() as c:
        if not c.execute("SELECT 1 FROM exercises WHERE user_id=? AND id=?", (uid, eid)).fetchone():
            raise LookupError("not found")
        c.execute("DELETE FROM exercises WHERE user_id=? AND id=?", (uid, eid))
        # Planned items of a workout cannot run without it; done sets keep their own copy.
        c.execute("DELETE FROM template_items WHERE user_id=? AND ex_ref=?", (uid, "u:" + eid))
        c.commit()
    return {"ok": True}


# ── Workouts (templates) ─────────────────────────────────────────

def _template_view(c, uid, row):
    items = [dict(r) for r in c.execute(
        "SELECT ex_ref,sets,reps,weight,secs,dist,rest_s,group_no FROM template_items WHERE user_id=? AND template_id=? "
        "ORDER BY position", (uid, row["id"]))]
    for it in items:
        try:
            e = _exercise(c, uid, it["ex_ref"])
            it["name"], it["type"], it["muscle"] = e["name"], e["type"], e["muscle"]
        except LookupError:
            it["name"], it["type"], it["muscle"] = it["ex_ref"], "weight_reps", "full_body"
    try:
        days = [int(x) for x in json.loads(row["days"] or "[]")]
    except ValueError:
        days = []
    return {"id": row["id"], "name": row["name"], "notes": row["notes"], "mode": row["mode"], "rounds": row["rounds"],
            "work_s": row["work_s"], "rest_s": row["rest_s"], "days": days, "items": items}


def _templates(c, uid):
    return [_template_view(c, uid, r) for r in
            c.execute("SELECT * FROM templates WHERE user_id=? ORDER BY position, rowid", (uid,))]


def _clean_items(c, uid, items):
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ValueError("invalid_items")
    out = []
    for it in items:
        it = it or {}
        e = _find_exercise(c, uid, it.get("ex_ref") or it.get("exercise"))
        sets = _num(it.get("sets"), 1, MAX_SETS_PER_ITEM, 3)
        reps = _num(it.get("reps"), 0, 1000, 0)
        weight = _num(it.get("weight"), 0, 1000, 0)
        secs = _num(it.get("secs"), 0, 86400, 0)
        dist = _num(it.get("dist"), 0, 1000, 0)
        rest = _num(it.get("rest_s"), 0, 900, 0)
        group = _num(it.get("group_no"), 0, 99, 0)
        if None in (sets, reps, weight, secs, dist, rest, group):
            raise ValueError("invalid_items")
        out.append({"ex_ref": e["ref"], "sets": int(sets), "reps": reps, "weight": weight, "secs": secs, "dist": dist,
                    "rest_s": int(rest), "group_no": int(group)})
    return out


def _save_template(uid, d, tid=None):
    name = str(d.get("name") or "").strip()
    if not name or len(name) > 80:
        raise ValueError("invalid_name")
    mode = d.get("mode") if d.get("mode") in MODES else "standard"
    rounds = int(_num(d.get("rounds"), 1, 50, 1) or 1)
    work_s = int(_num(d.get("work_s"), 0, 3600, 0) or 0)
    rest_s = int(_num(d.get("rest_s"), 0, 900, 0) or 0)
    days = sorted({int(x) for x in (d.get("days") or []) if str(x).isdigit() and 0 <= int(x) <= 6})
    notes = str(d.get("notes") or "").strip()[:1000]
    with _db() as c:
        items = _clean_items(c, uid, d.get("items") or [])
        if not items:
            raise ValueError("invalid_items")
        if tid is None:
            if c.execute("SELECT COUNT(*) n FROM templates WHERE user_id=?", (uid,)).fetchone()["n"] >= 200:
                raise ValueError("too_many")
            tid = uuid.uuid4().hex[:12]
            pos = c.execute("SELECT COALESCE(MAX(position),0)+1 p FROM templates WHERE user_id=?", (uid,)).fetchone()["p"]
            c.execute("INSERT INTO templates(user_id,id,name,notes,mode,rounds,work_s,rest_s,days,position) VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (uid, tid, name, notes, mode, rounds, work_s, rest_s, json.dumps(days), pos))
        else:
            if not c.execute("SELECT 1 FROM templates WHERE user_id=? AND id=?", (uid, tid)).fetchone():
                raise LookupError("not found")
            c.execute("UPDATE templates SET name=?,notes=?,mode=?,rounds=?,work_s=?,rest_s=?,days=? WHERE user_id=? AND id=?",
                      (name, notes, mode, rounds, work_s, rest_s, json.dumps(days), uid, tid))
            c.execute("DELETE FROM template_items WHERE user_id=? AND template_id=?", (uid, tid))
        for i, it in enumerate(items):
            c.execute("INSERT INTO template_items(user_id,template_id,position,ex_ref,sets,reps,weight,secs,dist,rest_s,group_no) "
                      "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                      (uid, tid, i, it["ex_ref"], it["sets"], it["reps"], it["weight"], it["secs"], it["dist"], it["rest_s"], it["group_no"]))
        c.commit()
        return _template_view(c, uid, c.execute("SELECT * FROM templates WHERE user_id=? AND id=?", (uid, tid)).fetchone())


def _delete_template(uid, tid):
    with _db() as c:
        if not c.execute("SELECT 1 FROM templates WHERE user_id=? AND id=?", (uid, tid)).fetchone():
            raise LookupError("not found")
        c.execute("DELETE FROM template_items WHERE user_id=? AND template_id=?", (uid, tid))
        c.execute("DELETE FROM templates WHERE user_id=? AND id=?", (uid, tid))
        c.execute("UPDATE sessions SET template_id=NULL WHERE user_id=? AND template_id=?", (uid, tid))
        c.commit()
    return {"ok": True}


# ── Sessions ─────────────────────────────────────────────────────

def _set_view(r):
    d = dict(r)
    d["done"] = bool(d["done"])
    try:
        d["prs"] = json.loads(d.get("prs") or "[]")
    except ValueError:
        d["prs"] = []
    for k in ("user_id", "session_id"):
        d.pop(k, None)
    return d


def _last_sets(c, uid, ex_ref, before_session=None):
    """The normal sets of this exercise in the most recent finished session
    that had it, in order: what the person did last time."""
    q = ("SELECT s.id sid, s.day FROM sessions s WHERE s.user_id=? AND s.status='done' AND EXISTS "
         "(SELECT 1 FROM session_sets x WHERE x.user_id=s.user_id AND x.session_id=s.id AND x.ex_ref=? AND x.done=1 AND x.kind!='warmup')")
    args = [uid, ex_ref]
    if before_session:
        q += " AND s.id!=?"
        args.append(before_session)
    q += " ORDER BY s.day DESC, s.started_ts DESC LIMIT 1"
    row = c.execute(q, args).fetchone()
    if not row:
        return None
    sets = [dict(r) for r in c.execute(
        "SELECT set_no,reps,weight,secs,dist FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=? AND done=1 AND kind!='warmup' "
        "ORDER BY position", (uid, row["sid"], ex_ref))]
    return {"day": row["day"], "sets": sets}


def _session_view(c, uid, row, with_prev=False):
    sets = [_set_view(r) for r in c.execute(
        "SELECT * FROM session_sets WHERE user_id=? AND session_id=? ORDER BY position", (uid, row["id"]))]
    out = {k: row[k] for k in ("id", "day", "started_at", "name", "template_id", "notes", "status", "duration_s", "kcal",
                              "body_kg", "mode", "work_s", "rest_s")}
    out["sets"] = sets
    out["done_sets"] = sum(1 for s in sets if s["done"])
    out["started_ts"] = row["started_ts"]
    if with_prev:
        prev = {}
        for ref in {s["ex_ref"] for s in sets}:
            p = _last_sets(c, uid, ref, row["id"])
            if p:
                prev[ref] = p
        out["prev"] = prev
    return out


def _session_summary(c, uid, row):
    stats = c.execute(
        "SELECT COUNT(*) n, SUM(done) d FROM session_sets WHERE user_id=? AND session_id=?", (uid, row["id"])).fetchone()
    names = []
    for r in c.execute("SELECT ex_ref, ex_name FROM session_sets WHERE user_id=? AND session_id=? AND done=1 ORDER BY position",
                       (uid, row["id"])):
        if r["ex_ref"] not in [x["ex_ref"] for x in names]:
            names.append({"ex_ref": r["ex_ref"], "name": r["ex_name"]})
    vol = _volume(c, uid, row["id"])
    prs = 0
    for r in c.execute("SELECT prs FROM session_sets WHERE user_id=? AND session_id=? AND done=1", (uid, row["id"])):
        if r["prs"] and r["prs"] != "[]":
            prs += 1
    return {"id": row["id"], "day": row["day"], "started_at": row["started_at"], "name": row["name"], "status": row["status"],
            "duration_s": row["duration_s"], "kcal": _r(row["kcal"], 0), "sets": stats["n"] or 0, "done_sets": stats["d"] or 0,
            "volume": _r(vol, 0), "exercises": names, "prs": prs, "mode": row["mode"]}


def _volume(c, uid, sid):
    v = 0.0
    for r in c.execute("SELECT reps,weight FROM session_sets WHERE user_id=? AND session_id=? AND done=1 AND kind!='warmup' "
                       "AND ex_type='weight_reps'", (uid, sid)):
        v += r["reps"] * r["weight"]
    return v


def _get_session(c, uid, sid):
    row = c.execute("SELECT * FROM sessions WHERE user_id=? AND id=?", (uid, sid)).fetchone()
    if not row:
        raise LookupError("not found")
    return row


def _active_session(c, uid):
    return c.execute("SELECT * FROM sessions WHERE user_id=? AND status='active' ORDER BY started_ts DESC LIMIT 1", (uid,)).fetchone()


def _new_set(c, uid, sid, pos, e, set_no, kind="normal", group_no=0, t_reps=0, t_weight=0, t_secs=0, t_dist=0, rest_s=0):
    c.execute("INSERT INTO session_sets(user_id,id,session_id,position,ex_ref,ex_name,ex_type,muscle,met,group_no,set_no,kind,"
              "t_reps,t_weight,t_secs,t_dist,reps,weight,secs,dist,rest_s) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              (uid, uuid.uuid4().hex[:12], sid, pos, e["ref"], e["name"], e["type"], e["muscle"], e["met"], group_no, set_no, kind,
               t_reps, t_weight, t_secs, t_dist, t_reps, t_weight, t_secs, t_dist, rest_s))


def _plan_sets(c, uid, items, mode, rounds, work_s, rest_s):
    """The planned sets of a workout, in the order they are done. A superset
    (items sharing a group number) alternates its exercises set by set; a
    circuit and an interval workout go through every exercise once per round."""
    plan = []
    exs = {}

    def target(it, e):
        last = _last_sets(c, uid, e["ref"])
        lw = (last["sets"][-1] if last and last["sets"] else {})
        reps = it["reps"] or (lw.get("reps") if e["type"] in ("weight_reps", "reps") else 0) or 0
        weight = it["weight"] or (lw.get("weight") if e["type"] == "weight_reps" else 0) or 0
        secs = it["secs"] or (lw.get("secs") if e["type"] in ("time", "cardio", "distance") else 0) or 0
        dist = it["dist"] or (lw.get("dist") if e["type"] in ("distance", "cardio") else 0) or 0
        return reps, weight, secs, dist

    resolved = []
    for it in items:
        try:
            e = _exercise(c, uid, it["ex_ref"])
        except LookupError:
            continue
        resolved.append((it, e))
    if mode in ("circuit", "interval"):
        for rnd in range(1, max(1, rounds) + 1):
            for it, e in resolved:
                reps, weight, secs, dist = target(it, e)
                if mode == "interval" and work_s:
                    secs = work_s
                plan.append((e, rnd, it["group_no"], reps, weight, secs, dist, rest_s or it["rest_s"]))
        return plan
    i = 0
    while i < len(resolved):
        it, e = resolved[i]
        grp = it["group_no"]
        block = [resolved[i]]
        if grp:
            while i + 1 < len(resolved) and resolved[i + 1][0]["group_no"] == grp:
                i += 1
                block.append(resolved[i])
        n = max(b[0]["sets"] for b in block)
        for sn in range(1, n + 1):
            for it2, e2 in block:
                if sn <= it2["sets"]:
                    reps, weight, secs, dist = target(it2, e2)
                    plan.append((e2, sn, grp, reps, weight, secs, dist, it2["rest_s"]))
        i += 1
    return plan


def _start_session(uid, day, name="", template_id=None, started_at="", empty=False):
    _check_day(day)
    if started_at and not AT_RE.match(started_at):
        raise ValueError("invalid_time")
    with _db() as c:
        act = _active_session(c, uid)
        if act:
            err = ValueError("active_session")
            err.session_id = act["id"]
            raise err
        mode, rounds, work_s, rest_s, items = "standard", 1, 0, 0, []
        if template_id:
            t = c.execute("SELECT * FROM templates WHERE user_id=? AND id=?", (uid, template_id)).fetchone()
            if not t:
                raise LookupError("not found")
            name = name or t["name"]
            mode, rounds, work_s, rest_s = t["mode"], t["rounds"], t["work_s"], t["rest_s"]
            items = [dict(r) for r in c.execute("SELECT * FROM template_items WHERE user_id=? AND template_id=? ORDER BY position",
                                                (uid, template_id))]
        sid = uuid.uuid4().hex[:12]
        c.execute("INSERT INTO sessions(user_id,id,day,started_at,started_ts,name,template_id,status,mode,work_s,rest_s,body_kg) "
                  "VALUES(?,?,?,?,?,?,?,'active',?,?,?,?)",
                  (uid, sid, day, started_at, time.time(), str(name or "").strip()[:80], template_id, mode, work_s, rest_s, _body_kg(c, uid)))
        default_rest = _settings(c, uid)["rest_s"]
        for pos, (e, sn, grp, reps, weight, secs, dist, rs) in enumerate(_plan_sets(c, uid, items, mode, rounds, work_s, rest_s)):
            if pos >= MAX_SESSION_SETS:
                break
            _new_set(c, uid, sid, pos, e, sn, "normal", grp, reps, weight, secs, dist, rs or (0 if mode == "interval" else default_rest))
        c.commit()
        return _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)


def _next_pos(c, uid, sid):
    return c.execute("SELECT COALESCE(MAX(position),-1)+1 p FROM session_sets WHERE user_id=? AND session_id=?", (uid, sid)).fetchone()["p"]


def _count_sets(c, uid, sid):
    return c.execute("SELECT COUNT(*) n FROM session_sets WHERE user_id=? AND session_id=?", (uid, sid)).fetchone()["n"]


def _add_set(uid, sid, ex_ref, kind="normal"):
    """One more set of an exercise (copying the last one of it), or the first
    set of an exercise that was not in the workout."""
    if kind not in KINDS:
        raise ValueError("invalid_kind")
    with _db() as c:
        _get_session(c, uid, sid)
        if _count_sets(c, uid, sid) >= MAX_SESSION_SETS:
            raise ValueError("too_many")
        e = _find_exercise(c, uid, ex_ref)
        last = c.execute("SELECT * FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=? ORDER BY position DESC LIMIT 1",
                         (uid, sid, e["ref"])).fetchone()
        if last:
            # Right after the exercise's last set, so a set added later sits with its exercise.
            pos = last["position"] + 1
            c.execute("UPDATE session_sets SET position=position+1 WHERE user_id=? AND session_id=? AND position>=?", (uid, sid, pos))
            sn = c.execute("SELECT COALESCE(MAX(set_no),0)+1 n FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=?",
                           (uid, sid, e["ref"])).fetchone()["n"]
            _new_set(c, uid, sid, pos, e, sn, kind, last["group_no"],
                     last["reps"] or last["t_reps"], last["weight"] or last["t_weight"], last["secs"] or last["t_secs"],
                     last["dist"] or last["t_dist"], last["rest_s"])
        else:
            prev = _last_sets(c, uid, e["ref"])
            lw = prev["sets"][-1] if prev and prev["sets"] else {}
            _new_set(c, uid, sid, _next_pos(c, uid, sid), e, 1, kind, 0, lw.get("reps", 0) if e["type"] in ("weight_reps", "reps") else 0,
                     lw.get("weight", 0) if e["type"] == "weight_reps" else 0,
                     lw.get("secs", 0) if e["type"] in ("time", "cardio", "distance") else 0,
                     lw.get("dist", 0) if e["type"] in ("distance", "cardio") else 0, _settings(c, uid)["rest_s"])
        c.commit()
        return _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)


def _add_exercise_to_session(uid, sid, ex_ref, sets=3):
    n = int(_num(sets, 1, MAX_SETS_PER_ITEM, 3) or 3)
    out = None
    for _ in range(n):
        out = _add_set(uid, sid, ex_ref)
    return out


def _remove_exercise_from_session(uid, sid, ex_ref):
    with _db() as c:
        _get_session(c, uid, sid)
        c.execute("DELETE FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=?", (uid, sid, ex_ref))
        for i, r in enumerate(c.execute("SELECT id FROM session_sets WHERE user_id=? AND session_id=? ORDER BY position", (uid, sid)).fetchall()):
            c.execute("UPDATE session_sets SET position=? WHERE user_id=? AND id=?", (i, uid, r["id"]))
        c.commit()
        return _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)


def _delete_set(uid, sid, set_id):
    with _db() as c:
        _get_session(c, uid, sid)
        cur = c.execute("DELETE FROM session_sets WHERE user_id=? AND session_id=? AND id=?", (uid, sid, set_id))
        if not cur.rowcount:
            raise LookupError("not found")
        for i, r in enumerate(c.execute("SELECT id FROM session_sets WHERE user_id=? AND session_id=? ORDER BY position", (uid, sid)).fetchall()):
            c.execute("UPDATE session_sets SET position=? WHERE user_id=? AND id=?", (i, uid, r["id"]))
        c.commit()
        return _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)


def _e1rm(weight, reps):
    if weight <= 0 or reps <= 0:
        return 0.0
    return weight if reps == 1 else weight * (1 + reps / 30.0)


def _pace(secs, dist):
    return secs / dist if dist > 0 and secs > 0 else 0.0


def _set_prs(c, uid, s):
    """The records a done set breaks, against every other done set of the same
    exercise (warm-ups never count). Nothing is a record the first time the
    exercise is done, so a new exercise starts quietly."""
    if s["kind"] == "warmup":
        return []
    prior = [dict(r) for r in c.execute(
        "SELECT reps,weight,secs,dist FROM session_sets WHERE user_id=? AND ex_ref=? AND done=1 AND kind!='warmup' AND id!=?",
        (uid, s["ex_ref"], s["id"]))]
    if not prior:
        return []
    out = []
    t = s["ex_type"]
    if t == "weight_reps":
        if s["weight"] > 0 and s["reps"] > 0:
            if s["weight"] > max(p["weight"] for p in prior if p["reps"] > 0):
                out.append("weight")
            if _e1rm(s["weight"], s["reps"]) > max(_e1rm(p["weight"], p["reps"]) for p in prior) + 1e-9:
                out.append("e1rm")
            if s["weight"] * s["reps"] > max(p["weight"] * p["reps"] for p in prior) + 1e-9:
                out.append("volume")
            heavier = [p["reps"] for p in prior if p["weight"] >= s["weight"]]
            if s["reps"] > (max(heavier) if heavier else 0):
                out.append("reps")
    elif t == "reps":
        if s["reps"] > max(p["reps"] for p in prior) and s["reps"] > 0:
            out.append("reps")
    elif t == "time":
        if s["secs"] > max(p["secs"] for p in prior) and s["secs"] > 0:
            out.append("time")
    else:
        if s["secs"] > max(p["secs"] for p in prior) and s["secs"] > 0:
            out.append("time")
        if s["dist"] > max(p["dist"] for p in prior) and s["dist"] > 0:
            out.append("dist")
        if s["dist"] >= 1 and s["secs"] > 0:
            paces = [_pace(p["secs"], p["dist"]) for p in prior if p["dist"] >= 1 and p["secs"] > 0]
            if paces and _pace(s["secs"], s["dist"]) < min(paces) - 1e-9:
                out.append("pace")
    return out


def _update_set(uid, sid, set_id, d):
    with _db() as c:
        _get_session(c, uid, sid)
        row = c.execute("SELECT * FROM session_sets WHERE user_id=? AND session_id=? AND id=?", (uid, sid, set_id)).fetchone()
        if not row:
            raise LookupError("not found")
        cur = dict(row)
        limits = {"reps": (0, 1000), "weight": (0, 1000), "secs": (0, 86400), "dist": (0, 1000), "rpe": (0, 10), "rest_s": (0, 900)}
        for k, (lo, hi) in limits.items():
            if k in d and d[k] is not None:
                v = _num(d[k], lo, hi)
                if v is None:
                    raise ValueError("invalid_" + k)
                cur[k] = v
        if "kind" in d and d["kind"] is not None:
            if d["kind"] not in KINDS:
                raise ValueError("invalid_kind")
            cur["kind"] = d["kind"]
        if "note" in d and d["note"] is not None:
            cur["note"] = str(d["note"])[:300]
        if "done" in d and d["done"] is not None:
            was = bool(cur["done"])
            cur["done"] = 1 if d["done"] else 0
            if cur["done"] and not was:
                at = d.get("done_at") or ""
                cur["done_at"] = at if AT_RE.match(str(at)) else datetime.now().strftime("%Y-%m-%dT%H:%M")
        prs = []
        if cur["done"]:
            prs = _set_prs(c, uid, cur)
        c.execute("UPDATE session_sets SET reps=?,weight=?,secs=?,dist=?,rpe=?,rest_s=?,kind=?,note=?,done=?,done_at=?,prs=? "
                  "WHERE user_id=? AND id=?",
                  (cur["reps"], cur["weight"], cur["secs"], cur["dist"], cur["rpe"], cur["rest_s"], cur["kind"], cur["note"],
                   cur["done"], cur["done_at"], json.dumps(prs), uid, set_id))
        sess = _get_session(c, uid, sid)
        c.commit()
        if sess["status"] == "done":
            _recount(c, uid, sid)
            c.commit()
            _push_health(uid, sess["day"])
        r = c.execute("SELECT * FROM session_sets WHERE user_id=? AND id=?", (uid, set_id)).fetchone()
        return _set_view(r)


def _kcal(c, uid, sid, duration_s, kg):
    """A rough estimate, not a measurement: MET x body weight x hours for the
    time the sets take, a light effort for the rest of the session."""
    kg = kg or DEFAULT_KG
    active, kcal, n = 0.0, 0.0, 0
    for r in c.execute("SELECT ex_type,met,reps,secs FROM session_sets WHERE user_id=? AND session_id=? AND done=1", (uid, sid)):
        n += 1
        secs = r["secs"] if r["ex_type"] in ("time", "cardio", "distance") else max(20.0, r["reps"] * 4.0)
        active += secs
        kcal += r["met"] * kg * secs / 3600.0
    if not duration_s:
        duration_s = active + n * 60
    kcal += 1.5 * kg * max(0.0, duration_s - active) / 3600.0
    return kcal, duration_s


def _recount(c, uid, sid):
    row = _get_session(c, uid, sid)
    kg = row["body_kg"] or _body_kg(c, uid)
    kcal, dur = _kcal(c, uid, sid, row["duration_s"], kg)
    c.execute("UPDATE sessions SET kcal=?, duration_s=?, body_kg=? WHERE user_id=? AND id=?", (round(kcal, 1), int(dur), kg, uid, sid))


def _session_prs(c, uid, sid):
    """Records set in a session: each set's own, plus the best weight lifted in
    total per exercise against all earlier sessions."""
    out = []
    for r in c.execute("SELECT ex_ref, ex_name, prs FROM session_sets WHERE user_id=? AND session_id=? AND done=1 ORDER BY position", (uid, sid)):
        for k in json.loads(r["prs"] or "[]"):
            if not any(o["ex_ref"] == r["ex_ref"] and o["kind"] == k for o in out):
                out.append({"ex_ref": r["ex_ref"], "name": r["ex_name"], "kind": k})
    row = _get_session(c, uid, sid)
    for ref in [x["ex_ref"] for x in c.execute(
            "SELECT DISTINCT ex_ref FROM session_sets WHERE user_id=? AND session_id=? AND done=1 AND ex_type='weight_reps' AND kind!='warmup'", (uid, sid))]:
        cur = c.execute("SELECT COALESCE(SUM(reps*weight),0) v FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=? AND done=1 AND kind!='warmup'",
                        (uid, sid, ref)).fetchone()["v"]
        best = 0
        for p in c.execute("SELECT s.id FROM sessions s WHERE s.user_id=? AND s.status='done' AND s.id!=?", (uid, sid)):
            v = c.execute("SELECT COALESCE(SUM(reps*weight),0) v FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=? AND done=1 AND kind!='warmup'",
                          (uid, p["id"], ref)).fetchone()["v"]
            best = max(best, v)
        if best > 0 and cur > best + 1e-9:
            nm = c.execute("SELECT ex_name FROM session_sets WHERE user_id=? AND session_id=? AND ex_ref=? LIMIT 1", (uid, sid, ref)).fetchone()
            out.append({"ex_ref": ref, "name": nm["ex_name"], "kind": "session_volume"})
    return out


def _finish_session(uid, sid, notes=None, duration_min=None, day=None):
    with _db() as c:
        row = _get_session(c, uid, sid)
        if row["status"] == "done":
            raise ValueError("already_done")
        c.execute("DELETE FROM session_sets WHERE user_id=? AND session_id=? AND done=0", (uid, sid))
        if not c.execute("SELECT 1 FROM session_sets WHERE user_id=? AND session_id=? LIMIT 1", (uid, sid)).fetchone():
            raise ValueError("nothing_done")
        if duration_min is not None:
            m = _num(duration_min, 1, MAX_HOURS * 60)
            if m is None:
                raise ValueError("invalid_duration")
            dur = int(m * 60)
        else:
            dur = int(time.time() - row["started_ts"])
            if dur > MAX_HOURS * 3600 or dur < 60:
                dur = 0  # forgotten or instant: estimated from the sets
        if day:
            _check_day(day)
        else:
            day = row["day"]
        c.execute("UPDATE sessions SET status='done', duration_s=?, notes=?, day=? WHERE user_id=? AND id=?",
                  (dur, str(notes if notes is not None else row["notes"]).strip()[:1000], day, uid, sid))
        for i, r in enumerate(c.execute("SELECT id FROM session_sets WHERE user_id=? AND session_id=? ORDER BY position", (uid, sid)).fetchall()):
            c.execute("UPDATE session_sets SET position=? WHERE user_id=? AND id=?", (i, uid, r["id"]))
        c.execute("UPDATE sessions SET body_kg=? WHERE user_id=? AND id=?", (_body_kg(c, uid), uid, sid))
        _recount(c, uid, sid)
        c.commit()
        out = _session_summary(c, uid, _get_session(c, uid, sid))
        out["records"] = _session_prs(c, uid, sid)
    _push_health(uid, day)
    return out


def _update_session(uid, sid, d):
    with _db() as c:
        row = _get_session(c, uid, sid)
        name = str(d["name"]).strip()[:80] if d.get("name") is not None else row["name"]
        notes = str(d["notes"]).strip()[:1000] if d.get("notes") is not None else row["notes"]
        day = row["day"]
        if d.get("day"):
            _check_day(d["day"])
            day = d["day"]
        dur = row["duration_s"]
        if d.get("duration_min") is not None:
            m = _num(d["duration_min"], 1, MAX_HOURS * 60)
            if m is None:
                raise ValueError("invalid_duration")
            dur = int(m * 60)
        c.execute("UPDATE sessions SET name=?,notes=?,day=?,duration_s=? WHERE user_id=? AND id=?", (name, notes, day, dur, uid, sid))
        if row["status"] == "done":
            _recount(c, uid, sid)
        c.commit()
        out = _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)
    if row["status"] == "done":
        _push_health(uid, day)
        if day != row["day"]:
            _push_health(uid, row["day"])
    return out


def _delete_session(uid, sid):
    with _db() as c:
        row = _get_session(c, uid, sid)
        c.execute("DELETE FROM session_sets WHERE user_id=? AND session_id=?", (uid, sid))
        c.execute("DELETE FROM sessions WHERE user_id=? AND id=?", (uid, sid))
        c.commit()
    if row["status"] == "done":
        _push_health(uid, row["day"])
    return {"ok": True}


def _template_from_session(uid, sid, name=None):
    with _db() as c:
        row = _get_session(c, uid, sid)
        items = []
        for r in c.execute("SELECT * FROM session_sets WHERE user_id=? AND session_id=? AND kind!='warmup' ORDER BY position", (uid, sid)):
            it = next((i for i in items if i["ex_ref"] == r["ex_ref"]), None)
            if it is None:
                it = {"ex_ref": r["ex_ref"], "sets": 0, "reps": r["reps"] or r["t_reps"], "weight": r["weight"] or r["t_weight"],
                      "secs": r["secs"] or r["t_secs"], "dist": r["dist"] or r["t_dist"], "rest_s": r["rest_s"], "group_no": r["group_no"]}
                items.append(it)
            it["sets"] += 1
        if row["mode"] != "standard":
            raise ValueError("not_standard")
    return _save_template(uid, {"name": name or row["name"] or "Workout", "items": items})


def _log_session(uid, day, name, exercises, duration_min=None, notes="", started_at=""):
    """A finished session in one go (from the API): exercises is a list of
    {exercise, sets: [{reps, weight, secs, dist}]}."""
    _check_day(day)
    if not isinstance(exercises, list) or not exercises or len(exercises) > MAX_ITEMS:
        raise ValueError("invalid_items")
    with _db() as c:
        sid = uuid.uuid4().hex[:12]
        total = 0
        c.execute("INSERT INTO sessions(user_id,id,day,started_at,started_ts,name,status,body_kg) VALUES(?,?,?,?,?,?, 'active', ?)",
                  (uid, sid, day, started_at if AT_RE.match(started_at or "") else "", time.time(), str(name or "").strip()[:80], _body_kg(c, uid)))
        pos = 0
        for ex in exercises:
            ex = ex or {}
            e = _find_exercise(c, uid, ex.get("exercise") or ex.get("ex_ref"))
            sets = ex.get("sets")
            if not isinstance(sets, list) or not sets or len(sets) > MAX_SETS_PER_ITEM:
                raise ValueError("invalid_sets")
            for i, st in enumerate(sets, 1):
                st = st or {}
                vals = {}
                for k, hi in (("reps", 1000), ("weight", 1000), ("secs", 86400), ("dist", 1000)):
                    v = _num(st.get(k), 0, hi, 0)
                    if v is None:
                        raise ValueError("invalid_" + k)
                    vals[k] = v
                kind = st.get("kind") if st.get("kind") in KINDS else "normal"
                _new_set(c, uid, sid, pos, e, i, kind, 0, vals["reps"], vals["weight"], vals["secs"], vals["dist"], 0)
                c.execute("UPDATE session_sets SET done=1, done_at=? WHERE user_id=? AND session_id=? AND position=?",
                          (datetime.now().strftime("%Y-%m-%dT%H:%M"), uid, sid, pos))
                pos += 1
                total += 1
                if total > MAX_SESSION_SETS:
                    raise ValueError("too_many")
        # Each set's records are worked out in the order they were given.
        for r in c.execute("SELECT * FROM session_sets WHERE user_id=? AND session_id=? ORDER BY position", (uid, sid)).fetchall():
            c.execute("UPDATE session_sets SET prs=? WHERE user_id=? AND id=?", (json.dumps(_set_prs(c, uid, dict(r))), uid, r["id"]))
        c.commit()
    return _finish_session(uid, sid, notes, duration_min, day)


# ── Statistics and records ───────────────────────────────────────

def _done_sets(c, uid, ref=None, since=None):
    q = ("SELECT x.*, s.day, s.started_ts FROM session_sets x JOIN sessions s ON s.user_id=x.user_id AND s.id=x.session_id "
         "WHERE x.user_id=? AND s.status='done' AND x.done=1 AND x.kind!='warmup'")
    args = [uid]
    if ref:
        q += " AND x.ex_ref=?"
        args.append(ref)
    if since:
        q += " AND s.day>=?"
        args.append(since)
    q += " ORDER BY s.day, s.started_ts, x.position"
    return [dict(r) for r in c.execute(q, args)]


def _records(uid, ref=None):
    """The best of every exercise, with the day it was set."""
    with _db() as c:
        sets = _done_sets(c, uid, ref)
    out = {}
    sess_vol = {}
    for s in sets:
        r = out.setdefault(s["ex_ref"], {"ex_ref": s["ex_ref"], "name": s["ex_name"], "type": s["ex_type"], "muscle": s["muscle"],
                                         "sets": 0, "best": {}, "by_reps": {}})
        r["sets"] += 1
        b = r["best"]

        def upd(k, v, better):
            if v and (k not in b or better(v, b[k]["value"])):
                b[k] = {"value": _r(v, 2), "day": s["day"]}
        if s["ex_type"] == "weight_reps" and s["weight"] > 0 and s["reps"] > 0:
            upd("weight", s["weight"], lambda a, z: a > z)
            upd("e1rm", _e1rm(s["weight"], s["reps"]), lambda a, z: a > z)
            upd("volume", s["weight"] * s["reps"], lambda a, z: a > z)
            rk = str(int(s["reps"]))
            if int(s["reps"]) <= 15 and (rk not in r["by_reps"] or s["weight"] > r["by_reps"][rk]["weight"]):
                r["by_reps"][rk] = {"weight": s["weight"], "day": s["day"]}
            sv = sess_vol.setdefault((s["ex_ref"], s["session_id"]), [0.0, s["day"]])
            sv[0] += s["weight"] * s["reps"]
        elif s["ex_type"] == "reps":
            upd("reps", s["reps"], lambda a, z: a > z)
        else:
            upd("time", s["secs"], lambda a, z: a > z)
            upd("dist", s["dist"], lambda a, z: a > z)
            if s["dist"] >= 1 and s["secs"] > 0:
                upd("pace", _pace(s["secs"], s["dist"]), lambda a, z: a < z)
        if s["ex_type"] == "weight_reps" and s["reps"] > 0:
            upd("reps", s["reps"], lambda a, z: a > z)
    for (ref_, _sid), (v, day) in sess_vol.items():
        b = out[ref_]["best"]
        if v > 0 and ("session_volume" not in b or v > b["session_volume"]["value"]):
            b["session_volume"] = {"value": _r(v, 0), "day": day}
    return sorted(out.values(), key=lambda x: -x["sets"])


def _exercise_stats(uid, ref):
    with _db() as c:
        e = _exercise(c, uid, ref)
        sets = _done_sets(c, uid, ref)
    sessions = {}
    for s in sets:
        sessions.setdefault(s["session_id"], {"day": s["day"], "sets": []})["sets"].append(
            {"reps": s["reps"], "weight": s["weight"], "secs": s["secs"], "dist": s["dist"], "rpe": s["rpe"],
             "prs": json.loads(s["prs"] or "[]")})
    hist = sorted(sessions.values(), key=lambda x: x["day"])
    series = []
    for h in hist:
        sx = h["sets"]
        series.append({"day": h["day"],
                       "e1rm": _r(max([_e1rm(x["weight"], x["reps"]) for x in sx] or [0]), 1),
                       "top_weight": max([x["weight"] for x in sx] or [0]),
                       "volume": _r(sum(x["weight"] * x["reps"] for x in sx), 0),
                       "reps": max([x["reps"] for x in sx] or [0]),
                       "total_reps": sum(x["reps"] for x in sx),
                       "secs": max([x["secs"] for x in sx] or [0]),
                       "dist": _r(sum(x["dist"] for x in sx), 2),
                       "total_secs": sum(x["secs"] for x in sx)})
    rec = next(iter(_records(uid, ref)), None)
    return {"exercise": e, "records": rec, "series": series[-60:], "history": list(reversed(hist))[:30], "sessions": len(hist)}


def _week_start(day, ws):
    d = datetime.strptime(day, "%Y-%m-%d")
    off = (d.weekday() + 1) % 7 if ws == 0 else d.weekday()  # ws 0: Sunday, 1: Monday
    return (d - timedelta(days=off)).strftime("%Y-%m-%d")


def _stats(uid, days=90, today=None, week_start=1):
    days = int(_num(days, 7, 366, 90) or 90)
    today = today if today and DAY_RE.match(today) else _today()
    since = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    with _db() as c:
        sessions = [dict(r) for r in c.execute(
            "SELECT * FROM sessions WHERE user_id=? AND status='done' AND day>=? AND day<=? ORDER BY day, started_ts", (uid, since, today))]
        sets = _done_sets(c, uid, None, since)
        all_days = sorted({r["day"] for r in c.execute("SELECT day FROM sessions WHERE user_id=? AND status='done'", (uid,))})
        wg = _settings(c, uid)["week_goal"]
        recent_prs = []
        for r in c.execute(
                "SELECT x.ex_ref,x.ex_name,x.prs,x.done_at,s.day FROM session_sets x JOIN sessions s ON s.user_id=x.user_id AND s.id=x.session_id "
                "WHERE x.user_id=? AND s.status='done' AND x.done=1 AND x.prs!='[]' ORDER BY s.day DESC, s.started_ts DESC, x.position DESC LIMIT 60", (uid,)):
            for k in json.loads(r["prs"] or "[]"):
                if not any(p["ex_ref"] == r["ex_ref"] and p["kind"] == k and p["day"] == r["day"] for p in recent_prs):
                    recent_prs.append({"ex_ref": r["ex_ref"], "name": r["ex_name"], "kind": k, "day": r["day"]})
        recent_prs = recent_prs[:12]
    weeks = {}
    for s in sessions:
        w = weeks.setdefault(_week_start(s["day"], week_start), {"week": None, "sessions": 0, "minutes": 0, "kcal": 0, "volume": 0})
        w["sessions"] += 1
        w["minutes"] += s["duration_s"] / 60.0
        w["kcal"] += s["kcal"]
    for s in sets:
        if s["ex_type"] == "weight_reps":
            w = weeks.setdefault(_week_start(s["day"], week_start), {"week": None, "sessions": 0, "minutes": 0, "kcal": 0, "volume": 0})
            w["volume"] += s["reps"] * s["weight"]
    wk = []
    for k in sorted(weeks):
        w = weeks[k]
        wk.append({"week": k, "sessions": w["sessions"], "minutes": _r(w["minutes"], 0), "kcal": _r(w["kcal"], 0), "volume": _r(w["volume"], 0)})
    muscles = {}
    for s in sets:
        muscles[s["muscle"]] = muscles.get(s["muscle"], 0) + 1
    # Streaks: days in a row with a session (today may still be to come), and
    # weeks in a row that reached the person's own weekly goal.
    dayset = set(all_days)
    d = datetime.strptime(today, "%Y-%m-%d")
    if today not in dayset:
        d -= timedelta(days=1)
    sd = 0
    while d.strftime("%Y-%m-%d") in dayset:
        sd += 1
        d -= timedelta(days=1)
    per_week = {}
    for dd in all_days:
        k = _week_start(dd, week_start)
        per_week[k] = per_week.get(k, 0) + 1
    cur = _week_start(today, week_start)
    sw = 0
    wd = datetime.strptime(cur, "%Y-%m-%d")
    if per_week.get(cur, 0) < wg:
        wd -= timedelta(days=7)  # this week is still in progress
    while per_week.get(wd.strftime("%Y-%m-%d"), 0) >= wg:
        sw += 1
        wd -= timedelta(days=7)
    total_vol = sum(s["reps"] * s["weight"] for s in sets if s["ex_type"] == "weight_reps")
    return {"days": days, "since": since, "today": today,
            "totals": {"sessions": len(sessions), "minutes": _r(sum(s["duration_s"] for s in sessions) / 60.0, 0),
                       "kcal": _r(sum(s["kcal"] for s in sessions), 0), "sets": len(sets), "volume": _r(total_vol, 0),
                       "reps": _r(sum(s["reps"] for s in sets), 0), "dist": _r(sum(s["dist"] for s in sets), 1)},
            "weeks": wk, "muscles": muscles, "session_days": sorted({s["day"] for s in sessions}),
            "streak_days": sd, "streak_weeks": sw, "week_goal": wg,
            "week_sessions": per_week.get(cur, 0), "recent_records": recent_prs}


def _sessions_range(uid, start, end):
    _check_day(start)
    _check_day(end)
    with _db() as c:
        rows = c.execute("SELECT * FROM sessions WHERE user_id=? AND status='done' AND day>=? AND day<=? ORDER BY day DESC, started_ts DESC LIMIT 500",
                         (uid, start, end)).fetchall()
        return [_session_summary(c, uid, r) for r in rows]


# ── Health integration ───────────────────────────────────────────
# Opt-in per profile. Fitness keeps only the choice; the minutes and calories
# of the finished sessions of a day are sent to Health's app API as this app's
# total for the day, so Health always shows what Fitness shows.

def _health_enabled(uid):
    with _db() as c:
        return bool(_link(c, uid)["enabled"])


def _read_other_on(uid):
    with _db() as c:
        return bool(_link(c, uid)["read_other"])


def _health_read_on(uid):
    with _db() as c:
        return bool(_link(c, uid)["read_profile"])


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
    session that was just saved."""
    try:
        if not _health_enabled(uid):
            return
        hub = _hub()
        if hub is None:
            return
        with _db() as c:
            r = c.execute("SELECT COALESCE(SUM(duration_s),0) d, COALESCE(SUM(kcal),0) k FROM sessions "
                          "WHERE user_id=? AND status='done' AND day=?", (uid, day)).fetchone()
        hub.call_app_api("health", "record_daily", uid, day,
                         {"workout_min": _r(r["d"] / 60.0, 0), "workout_kcal": _r(r["k"], 0)},
                         source_app=APP_ID, source_app_name="Fitness")
    except Exception:
        pass


def _health_sync(uid):
    since = (datetime.now() - timedelta(days=HEALTH_SYNC_DAYS)).strftime("%Y-%m-%d")
    with _db() as c:
        days = [r["day"] for r in c.execute("SELECT DISTINCT day FROM sessions WHERE user_id=? AND status='done' AND day>=?", (uid, since))]
    for d in days:
        _push_health(uid, d)
    return len(days)


def _other_range(uid, start, end):
    """What other apps sent Health for the days start..end: day -> {"minutes",
    "kcal", "sources": [{"source", "name", "minutes", "kcal"}]}. This app's
    own source is left out. Empty when the person did not switch it on or
    Health cannot answer."""
    out = {}
    hub = _hub()
    if hub is None or not _read_other_on(uid):
        return out
    days = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days + 1
    for metric, key in (("workout_min", "minutes"), ("workout_kcal", "kcal")):
        try:
            series = hub.call_app_api("health", "get_series", uid, metric, days, end)
        except Exception:
            return {}
        for pt in series.get("points") or []:
            for src in pt.get("sources") or []:
                if src.get("source") == APP_ID or not src.get("value"):
                    continue
                d = out.setdefault(pt["day"], {"minutes": 0.0, "kcal": 0.0, "sources": {}})
                d[key] += src["value"]
                s = d["sources"].setdefault(src["source"], {"source": src["source"], "name": src.get("name") or src["source"]})
                s[key] = s.get(key, 0.0) + src["value"]
    for d in out.values():
        d["sources"] = list(d["sources"].values())
    return out


def _set_link(uid, **kw):
    with _db() as c:
        c.execute("INSERT OR IGNORE INTO health_link(user_id) VALUES(?)", (uid,))
        for k in ("enabled", "read_profile", "read_other"):
            if kw.get(k) is not None:
                c.execute(f"UPDATE health_link SET {k}=? WHERE user_id=?", (1 if kw[k] else 0, uid))
        c.commit()
    synced = _health_sync(uid) if kw.get("enabled") else 0
    return {"enabled": _health_enabled(uid), "read": _health_read_on(uid), "read_other": _read_other_on(uid),
            "available": _health_available(uid), "synced_days": synced}


# ── AI help (premium) ────────────────────────────────────────────

def _ai_offered():
    """The owner switched the AI help on and the premium module is here."""
    with _db() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='ai_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return None
    prem = _premium()
    return prem if prem and prem.is_available() else None


def _ai_info(uid):
    prem = _ai_offered()
    if not prem:
        return {"offered": False}
    return {"offered": True, "ready": bool(prem.ready()), "credits": prem.credits(uid)}


def _ai_fail(err):
    code = str(err or "ai_failed")
    return _bad(code, 402 if code == "no_credits" else 502)


def _ai_profile(uid):
    with _db() as c:
        st = _settings_view(c, uid)
        tpl = [{"name": t["name"], "exercises": [i["name"] for i in t["items"]]} for t in _templates(c, uid)][:12]
    stats = _stats(uid, 60)
    recs = _records(uid)[:15]
    p = {"sex": st["sex"], "age": st["age"], "height_cm": st["height_cm"], "weight_kg": st["weight_kg"],
         "sessions_last_60_days": stats["totals"]["sessions"], "sessions_this_week": stats["week_sessions"],
         "weekly_goal": stats["week_goal"], "my_workouts": tpl,
         "records": [{"exercise": r["name"], "best": {k: v["value"] for k, v in r["best"].items()}} for r in recs]}
    if st.get("health_read") and st.get("health_ok"):
        hp = _health_profile(uid) or {}
        p["health_notes"] = {"conditions": hp.get("conditions") or "", "medications": hp.get("medications") or ""}
    return p


def _clean_ai_plan(uid, d):
    """What the AI proposed, cut down to workouts the app accepts. Only
    exercises that exist are kept: an unknown name is dropped, never made up."""
    out = []
    with _db() as c:
        for w in (d.get("workouts") or [])[:7]:
            if not isinstance(w, dict):
                continue
            items = []
            for it in (w.get("exercises") or [])[:MAX_ITEMS]:
                if not isinstance(it, dict):
                    continue
                try:
                    e = _find_exercise(c, uid, it.get("id") or it.get("exercise"))
                except LookupError:
                    continue
                sets = _num(it.get("sets"), 1, MAX_SETS_PER_ITEM, 3)
                reps = _num(it.get("reps"), 0, 1000, 0)
                secs = _num(it.get("secs"), 0, 86400, 0)
                dist = _num(it.get("dist"), 0, 1000, 0)
                rest = _num(it.get("rest_s"), 0, 900, 0)
                if None in (sets, reps, secs, dist, rest):
                    continue
                items.append({"ex_ref": e["ref"], "name": e["name"], "type": e["type"], "sets": int(sets),
                              "reps": reps if e["type"] in ("weight_reps", "reps") else 0,
                              "weight": 0, "secs": secs if e["type"] in ("time", "cardio", "distance") else 0,
                              "dist": dist if e["type"] in ("distance", "cardio") else 0, "rest_s": int(rest), "group_no": 0})
            name = str(w.get("name") or "").strip()[:80]
            if name and items:
                days = [int(x) for x in (w.get("days") or []) if str(x).isdigit() and 0 <= int(x) <= 6]
                out.append({"name": name, "notes": str(w.get("notes") or "").strip()[:400], "days": sorted(set(days)), "items": items})
    return out


class AiPlanBody(BaseModel):
    goal: str = ""
    days: int = 3
    minutes: int = 45
    level: str = "beginner"
    equipment: str = ""
    note: str = ""
    lang: str = "en"


class AiReviewBody(BaseModel):
    lang: str = "en"


# ── Models ───────────────────────────────────────────────────────

class ExerciseBody(BaseModel):
    name: str
    type: str
    muscle: Optional[str] = None
    equip: Optional[str] = None
    met: Optional[float] = None


class ItemBody(BaseModel):
    ex_ref: str
    sets: float = 3
    reps: float = 0
    weight: float = 0
    secs: float = 0
    dist: float = 0
    rest_s: float = 0
    group_no: float = 0


class TemplateBody(BaseModel):
    name: str
    notes: str = ""
    mode: str = "standard"
    rounds: int = 1
    work_s: int = 0
    rest_s: int = 0
    days: List[int] = []
    items: List[ItemBody] = []


class StartBody(BaseModel):
    day: Optional[str] = None
    name: str = ""
    template_id: Optional[str] = None
    started_at: str = ""


class AddSetBody(BaseModel):
    ex_ref: str
    kind: str = "normal"
    sets: Optional[int] = None


class SetBody(BaseModel):
    reps: Optional[float] = None
    weight: Optional[float] = None
    secs: Optional[float] = None
    dist: Optional[float] = None
    rpe: Optional[float] = None
    rest_s: Optional[float] = None
    kind: Optional[str] = None
    note: Optional[str] = None
    done: Optional[bool] = None
    done_at: Optional[str] = None


class FinishBody(BaseModel):
    notes: Optional[str] = None
    duration_min: Optional[float] = None
    day: Optional[str] = None


class SessionBody(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    day: Optional[str] = None
    duration_min: Optional[float] = None


class SettingsBody(BaseModel):
    sex: Optional[str] = None
    age: Optional[int] = None
    height_cm: Optional[float] = None
    weight_kg: Optional[float] = None
    rest_s: Optional[int] = None
    week_goal: Optional[int] = None


class HealthBody(BaseModel):
    enabled: Optional[bool] = None
    read: Optional[bool] = None
    read_other: Optional[bool] = None


def _reply(fn, *args, **kw):
    try:
        return JSONResponse(fn(*args, **kw))
    except LookupError:
        return _bad("not_found", 404)
    except ValueError as e:
        sid = getattr(e, "session_id", None)
        if sid:
            return JSONResponse({"error": str(e), "session_id": sid}, status_code=409)
        return _bad(str(e) or "invalid_request")
    except RuntimeError as e:
        return _bad(str(e) or "error", 502)


# ── Routes ───────────────────────────────────────────────────────

@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Fitness", "🏋️")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    with _db() as c:
        act = _active_session(c, uid)
        out = {"settings": _settings_view(c, uid), "templates": _templates(c, uid), "custom": _custom_exercises(c, uid),
               "ai": _ai_info(uid), "active": act["id"] if act else None,
               "health": {"enabled": _health_enabled(uid), "read": _health_read_on(uid), "read_other": _read_other_on(uid)}}
    out["health"]["available"] = _health_available(uid)
    return JSONResponse(out)


@router.put("/settings")
async def put_settings(body: SettingsBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_settings, uid, body.dict(exclude_unset=True))


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
    return _reply(_set_link, uid, enabled=body.enabled, read_profile=body.read, read_other=body.read_other)


@router.get("/catalog")
async def get_catalog(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    with _db() as c:
        return JSONResponse({"ready": list(_catalog().values()), "custom": _custom_exercises(c, uid)})


@router.post("/exercises")
async def post_exercise(body: ExerciseBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_add_exercise, uid, body.dict())


@router.put("/exercises/{eid}")
async def put_exercise(eid: str, body: ExerciseBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_edit_exercise, uid, eid, body.dict())


@router.delete("/exercises/{eid}")
async def del_exercise(eid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_exercise, uid, eid)


@router.post("/templates")
async def post_template(body: TemplateBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_template, uid, body.dict())


@router.put("/templates/{tid}")
async def put_template(tid: str, body: TemplateBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_save_template, uid, body.dict(), tid)


@router.delete("/templates/{tid}")
async def del_template(tid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_template, uid, tid)


@router.post("/templates/from-session/{sid}")
async def post_template_from_session(sid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_template_from_session, uid, sid)


@router.get("/sessions")
async def get_sessions(start: str, end: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(lambda: {"sessions": _sessions_range(uid, start, end),
                           "other": _other_range(uid, start, end) if (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days < 400 else {}})


@router.get("/sessions/active")
async def get_active(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    with _db() as c:
        act = _active_session(c, uid)
        return JSONResponse({"session": _session_view(c, uid, act, with_prev=True) if act else None})


@router.get("/sessions/{sid}")
async def get_session(sid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)

    def go():
        with _db() as c:
            return _session_view(c, uid, _get_session(c, uid, sid), with_prev=True)
    return _reply(go)


@router.post("/sessions")
async def post_session(body: StartBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_start_session, uid, body.day or _today(), body.name, body.template_id, body.started_at)


@router.put("/sessions/{sid}")
async def put_session(sid: str, body: SessionBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_update_session, uid, sid, body.dict(exclude_unset=True))


@router.delete("/sessions/{sid}")
async def del_session(sid: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_session, uid, sid)


@router.post("/sessions/{sid}/finish")
async def post_finish(sid: str, body: FinishBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_finish_session, uid, sid, body.notes, body.duration_min, body.day)


@router.post("/sessions/{sid}/sets")
async def post_set(sid: str, body: AddSetBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    if body.sets:
        return _reply(_add_exercise_to_session, uid, sid, body.ex_ref, body.sets)
    return _reply(_add_set, uid, sid, body.ex_ref, body.kind)


@router.put("/sessions/{sid}/sets/{set_id}")
async def put_set(sid: str, set_id: str, body: SetBody, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_update_set, uid, sid, set_id, body.dict(exclude_unset=True))


@router.delete("/sessions/{sid}/sets/{set_id}")
async def del_set(sid: str, set_id: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_delete_set, uid, sid, set_id)


@router.delete("/sessions/{sid}/exercise/{ex_ref}")
async def del_session_exercise(sid: str, ex_ref: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_remove_exercise_from_session, uid, sid, ex_ref)


@router.get("/exercise/{ex_ref}")
async def get_exercise_stats(ex_ref: str, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_exercise_stats, uid, ex_ref)


@router.get("/records")
async def get_records(x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(lambda: {"records": _records(uid)})


@router.get("/stats")
async def get_stats(days: int = 90, today: str = None, week_start: int = 1, x_pub_token: str = Header(default=None)):
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    return _reply(_stats, uid, days, today, 0 if week_start == 0 else 1)


@router.post("/ai/plan")
async def ai_plan(body: AiPlanBody, x_pub_token: str = Header(default=None)):
    """Asks the AI for workouts. Nothing is saved: the person reviews them and
    saves the ones they want."""
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    prem = _ai_offered()
    if not prem:
        return _bad("not_found", 404)
    cat = [{"id": e["ref"], "name": e["name"], "type": e["type"], "muscle": e["muscle"], "equip": e["equip"]} for e in _catalog().values()]
    with _db() as c:
        cat += [{"id": e["ref"], "name": e["name"], "type": e["type"], "muscle": e["muscle"], "equip": e["equip"]} for e in _custom_exercises(c, uid)]
    res = await prem.plan(uid, _ai_profile(uid), body.dict(), cat)
    if res.get("error"):
        return _ai_fail(res["error"])
    plan = _clean_ai_plan(uid, res["data"])
    if not plan:
        return _bad("ai_bad_answer", 502)
    return JSONResponse({"workouts": plan, "summary": str(res["data"].get("summary") or "").strip()[:700], "balance": res.get("balance")})


@router.post("/ai/review")
async def ai_review(body: AiReviewBody, x_pub_token: str = Header(default=None)):
    """Asks the AI what is improving and what to do next, from the person's records."""
    uid = _auth(x_pub_token)
    if not uid:
        return _bad("unauthorized", 401)
    prem = _ai_offered()
    if not prem:
        return _bad("not_found", 404)
    stats = _stats(uid, 90)
    if not stats["totals"]["sessions"]:
        return _bad("no_data")
    res = await prem.review(uid, _ai_profile(uid), {"totals": stats["totals"], "weeks": stats["weeks"][-12:], "muscles": stats["muscles"],
                                                     "streak_weeks": stats["streak_weeks"], "recent_records": stats["recent_records"]}, body.lang)
    if res.get("error"):
        return _ai_fail(res["error"])
    d = res["data"]
    return JSONResponse({"summary": str(d.get("summary") or "").strip()[:1200],
                         "improving": [str(x)[:200] for x in (d.get("improving") or [])][:5],
                         "attention": [str(x)[:200] for x in (d.get("attention") or [])][:5],
                         "next": [str(x)[:200] for x in (d.get("next") or [])][:6], "balance": res.get("balance")})
