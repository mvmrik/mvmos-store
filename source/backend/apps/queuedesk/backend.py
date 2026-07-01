import os
import sys
import sqlite3
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/queuedesk")

_DB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "queuedesk", "data.db"
)


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _init_db():
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                public_user_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (public_user_id, key)
            );
            CREATE TABLE IF NOT EXISTS public_slugs (
                slug TEXT PRIMARY KEY,
                public_user_id TEXT NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS schedule_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                weekday INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                slot_minutes INTEGER NOT NULL DEFAULT 30
            );
            CREATE TABLE IF NOT EXISTS date_overrides (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                date TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                UNIQUE (public_user_id, date)
            );
            CREATE TABLE IF NOT EXISTS bookings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                client_name TEXT NOT NULL,
                client_phone TEXT NOT NULL DEFAULT '',
                client_email TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'booked',
                created_at TEXT NOT NULL,
                UNIQUE (public_user_id, date, start_time)
            );
            CREATE TABLE IF NOT EXISTS queue_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                date TEXT NOT NULL,
                number INTEGER NOT NULL,
                client_name TEXT NOT NULL,
                client_phone TEXT NOT NULL DEFAULT '',
                client_email TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'waiting',
                created_at TEXT NOT NULL,
                called_at TEXT,
                served_at TEXT,
                verify_code TEXT,
                UNIQUE (public_user_id, date, number)
            );
            CREATE TABLE IF NOT EXISTS queue_state (
                public_user_id TEXT PRIMARY KEY,
                date TEXT NOT NULL,
                current_number INTEGER NOT NULL DEFAULT 0,
                limit_remaining INTEGER
            );
        """)
        cols = [r["name"] for r in c.execute("PRAGMA table_info(queue_state)").fetchall()]
        if "limit_remaining" not in cols:
            c.execute("ALTER TABLE queue_state ADD COLUMN limit_remaining INTEGER")
        cols = [r["name"] for r in c.execute("PRAGMA table_info(queue_tickets)").fetchall()]
        if "verify_code" not in cols:
            c.execute("ALTER TABLE queue_tickets ADD COLUMN verify_code TEXT")
        c.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _today():
    return datetime.now(timezone.utc).date().isoformat()


def _pub_user(x_pub_token):
    hub = sys.modules.get("backend.apphub")
    if not hub or not x_pub_token:
        return None
    return hub.get_pub_session(x_pub_token)


def _require_user(x_pub_token):
    u = _pub_user(x_pub_token)
    if not u:
        return None
    return u["id"]


def _unauthorized():
    return JSONResponse({"error": "login_required"}, status_code=401)


def _not_found():
    return JSONResponse({"error": "not_found"}, status_code=404)


# ── Settings ──────────────────────────────────────────────────────────────────

_DEFAULT_SETTINGS = {"mode": "schedule", "business_name": "", "public_lang": "en"}


@router.get("/settings")
async def get_settings(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute("SELECT key, value FROM settings WHERE public_user_id=?", (uid,)).fetchall()
    out = dict(_DEFAULT_SETTINGS)
    out.update({r["key"]: r["value"] for r in rows})
    return JSONResponse(out)


class SettingsBody(BaseModel):
    mode: str = "schedule"
    business_name: str = ""
    public_lang: str = "en"


@router.post("/settings")
async def save_settings(body: SettingsBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    if body.mode not in ("schedule", "queue"):
        return JSONResponse({"error": "invalid_mode"}, status_code=400)
    if body.public_lang not in ("en", "bg"):
        return JSONResponse({"error": "invalid_lang"}, status_code=400)
    with _conn() as c:
        for k, v in (("mode", body.mode), ("business_name", body.business_name), ("public_lang", body.public_lang)):
            c.execute(
                "INSERT INTO settings (public_user_id, key, value) VALUES (?,?,?) "
                "ON CONFLICT (public_user_id, key) DO UPDATE SET value=excluded.value",
                (uid, k, v),
            )
    return JSONResponse({"ok": True})


def _slug_from_name(name: str) -> str:
    base = "".join(ch.lower() if ch.isalnum() else "-" for ch in name).strip("-")
    while "--" in base:
        base = base.replace("--", "-")
    return base[:40] or "user"


@router.get("/public-slug")
async def get_public_slug(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        row = c.execute("SELECT slug FROM public_slugs WHERE public_user_id=?", (uid,)).fetchone()
        if row:
            return JSONResponse({"slug": row["slug"]})
        u = _pub_user(x_pub_token)
        base = _slug_from_name(u.get("username") or u.get("display_name") or uid)
        slug = base
        n = 1
        while c.execute("SELECT 1 FROM public_slugs WHERE slug=?", (slug,)).fetchone():
            n += 1
            slug = f"{base}-{n}"
        c.execute("INSERT INTO public_slugs (slug, public_user_id) VALUES (?,?)", (slug, uid))
        return JSONResponse({"slug": slug})


class SlugBody(BaseModel):
    slug: str


@router.post("/public-slug")
async def set_public_slug(body: SlugBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    slug = _slug_from_name(body.slug)
    if not slug:
        return JSONResponse({"error": "invalid_slug"}, status_code=400)
    with _conn() as c:
        existing = c.execute("SELECT public_user_id FROM public_slugs WHERE slug=?", (slug,)).fetchone()
        if existing and existing["public_user_id"] != uid:
            return JSONResponse({"error": "slug_taken"}, status_code=409)
        c.execute("DELETE FROM public_slugs WHERE public_user_id=?", (uid,))
        c.execute("INSERT INTO public_slugs (slug, public_user_id) VALUES (?,?)", (slug, uid))
    return JSONResponse({"slug": slug})


# ── Schedule rules ────────────────────────────────────────────────────────────

@router.get("/schedule/rules")
async def list_rules(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM schedule_rules WHERE public_user_id=? ORDER BY weekday, start_time", (uid,)
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class RuleBody(BaseModel):
    weekday: int
    start_time: str
    end_time: str
    slot_minutes: int = 30


@router.post("/schedule/rules")
async def add_rule(body: RuleBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    if not (0 <= body.weekday <= 6) or body.slot_minutes <= 0 or body.start_time >= body.end_time:
        return JSONResponse({"error": "invalid_rule"}, status_code=400)
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO schedule_rules (public_user_id, weekday, start_time, end_time, slot_minutes) VALUES (?,?,?,?,?)",
            (uid, body.weekday, body.start_time, body.end_time, body.slot_minutes),
        )
        row = c.execute("SELECT * FROM schedule_rules WHERE id=?", (cur.lastrowid,)).fetchone()
    return JSONResponse(dict(row))


@router.delete("/schedule/rules/{rid}")
async def del_rule(rid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("DELETE FROM schedule_rules WHERE id=? AND public_user_id=?", (rid, uid))
        if cur.rowcount == 0:
            return _not_found()
    return JSONResponse({"ok": True})


# ── Date overrides (days off) ────────────────────────────────────────────────

@router.get("/schedule/overrides")
async def list_overrides(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute(
            "SELECT * FROM date_overrides WHERE public_user_id=? AND date>=? ORDER BY date", (uid, _today())
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class OverrideBody(BaseModel):
    date: str
    note: str = ""


@router.post("/schedule/overrides")
async def add_override(body: OverrideBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        c.execute(
            "INSERT INTO date_overrides (public_user_id, date, note) VALUES (?,?,?) "
            "ON CONFLICT (public_user_id, date) DO UPDATE SET note=excluded.note",
            (uid, body.date, body.note),
        )
    return JSONResponse({"ok": True})


@router.delete("/schedule/overrides/{oid}")
async def del_override(oid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("DELETE FROM date_overrides WHERE id=? AND public_user_id=?", (oid, uid))
        if cur.rowcount == 0:
            return _not_found()
    return JSONResponse({"ok": True})


# ── Bookings (schedule mode) ─────────────────────────────────────────────────

def _slots_for_date(c, uid, date_str):
    """All slots for a date derived from weekly rules, marked booked/free."""
    import datetime as dt
    weekday = dt.date.fromisoformat(date_str).weekday()
    closed = c.execute(
        "SELECT 1 FROM date_overrides WHERE public_user_id=? AND date=?", (uid, date_str)
    ).fetchone()
    if closed:
        return []
    rules = c.execute(
        "SELECT * FROM schedule_rules WHERE public_user_id=? AND weekday=? ORDER BY start_time",
        (uid, weekday),
    ).fetchall()
    booked = {
        r["start_time"]
        for r in c.execute(
            "SELECT start_time FROM bookings WHERE public_user_id=? AND date=? AND status='booked'",
            (uid, date_str),
        ).fetchall()
    }
    slots = []
    for rule in rules:
        h, m = map(int, rule["start_time"].split(":"))
        eh, em = map(int, rule["end_time"].split(":"))
        cur_min = h * 60 + m
        end_min = eh * 60 + em
        step = rule["slot_minutes"]
        while cur_min + step <= end_min:
            start = f"{cur_min // 60:02d}:{cur_min % 60:02d}"
            end_c = cur_min + step
            end = f"{end_c // 60:02d}:{end_c % 60:02d}"
            slots.append({"start_time": start, "end_time": end, "booked": start in booked})
            cur_min += step
    slots.sort(key=lambda s: s["start_time"])
    return slots


@router.get("/schedule/slots")
async def get_slots(date: str, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        slots = _slots_for_date(c, uid, date)
    return JSONResponse(slots)


@router.get("/bookings")
async def list_bookings(date_from: Optional[str] = None, date_to: Optional[str] = None,
                         session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    q = "SELECT * FROM bookings WHERE public_user_id=?"
    params = [uid]
    if date_from:
        q += " AND date>=?"
        params.append(date_from)
    if date_to:
        q += " AND date<=?"
        params.append(date_to)
    q += " ORDER BY date, start_time"
    with _conn() as c:
        rows = c.execute(q, params).fetchall()
    return JSONResponse([dict(r) for r in rows])


@router.post("/bookings/{bid}/cancel")
async def cancel_booking(bid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute(
            "UPDATE bookings SET status='cancelled' WHERE id=? AND public_user_id=? AND status='booked'",
            (bid, uid),
        )
        if cur.rowcount == 0:
            return _not_found()
    return JSONResponse({"ok": True})


# ── Queue (queue mode) ────────────────────────────────────────────────────────

def _avg_service_seconds(c, uid) -> float:
    rows = c.execute(
        "SELECT called_at, served_at FROM queue_tickets "
        "WHERE public_user_id=? AND status='served' AND called_at IS NOT NULL AND served_at IS NOT NULL "
        "ORDER BY served_at DESC LIMIT 20",
        (uid,),
    ).fetchall()
    if not rows:
        return 600.0  # default guess: 10 min
    total = 0.0
    for r in rows:
        a = datetime.fromisoformat(r["called_at"])
        b = datetime.fromisoformat(r["served_at"])
        total += (b - a).total_seconds()
    return max(total / len(rows), 30.0)


@router.get("/queue/today")
async def queue_today(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    today = _today()
    with _conn() as c:
        state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
        same_day = state and state["date"] == today
        current_number = state["current_number"] if same_day else 0
        limit_remaining = state["limit_remaining"] if same_day else None
        tickets = c.execute(
            "SELECT * FROM queue_tickets WHERE public_user_id=? AND date=? ORDER BY number",
            (uid, today),
        ).fetchall()
    return JSONResponse({
        "date": today, "current_number": current_number, "limit_remaining": limit_remaining,
        "tickets": [dict(t) for t in tickets],
    })


class QueueLimitBody(BaseModel):
    remaining: Optional[int] = None


@router.post("/queue/limit")
async def set_queue_limit(body: QueueLimitBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    if body.remaining is not None and body.remaining < 0:
        return JSONResponse({"error": "invalid_limit"}, status_code=400)
    today = _today()
    with _conn() as c:
        state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
        current_number = state["current_number"] if state and state["date"] == today else 0
        c.execute(
            "INSERT INTO queue_state (public_user_id, date, current_number, limit_remaining) VALUES (?,?,?,?) "
            "ON CONFLICT (public_user_id) DO UPDATE SET date=excluded.date, current_number=excluded.current_number, limit_remaining=excluded.limit_remaining",
            (uid, today, current_number, body.remaining),
        )
    return JSONResponse({"ok": True, "remaining": body.remaining})


@router.get("/queue/history")
async def queue_history(date: str, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        tickets = c.execute(
            "SELECT * FROM queue_tickets WHERE public_user_id=? AND date=? ORDER BY number",
            (uid, date),
        ).fetchall()
    return JSONResponse([dict(t) for t in tickets])


@router.post("/queue/call-next")
async def call_next(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    today = _today()
    now = _now()
    with _conn() as c:
        state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
        same_day = state and state["date"] == today
        limit_remaining = state["limit_remaining"] if same_day else None
        if same_day and state["current_number"] > 0:
            c.execute(
                "UPDATE queue_tickets SET status='served', served_at=? "
                "WHERE public_user_id=? AND date=? AND number=? AND status='called'",
                (now, uid, today, state["current_number"]),
            )
        nxt = c.execute(
            "SELECT * FROM queue_tickets WHERE public_user_id=? AND date=? AND status='waiting' "
            "ORDER BY number LIMIT 1",
            (uid, today),
        ).fetchone()
        if not nxt:
            c.execute(
                "INSERT INTO queue_state (public_user_id, date, current_number, limit_remaining) VALUES (?,?,0,?) "
                "ON CONFLICT (public_user_id) DO UPDATE SET date=excluded.date, current_number=0, limit_remaining=excluded.limit_remaining",
                (uid, today, limit_remaining),
            )
            return JSONResponse({"ok": True, "next": None})
        c.execute(
            "UPDATE queue_tickets SET status='called', called_at=? WHERE id=?", (now, nxt["id"])
        )
        c.execute(
            "INSERT INTO queue_state (public_user_id, date, current_number, limit_remaining) VALUES (?,?,?,?) "
            "ON CONFLICT (public_user_id) DO UPDATE SET date=excluded.date, current_number=excluded.current_number, limit_remaining=excluded.limit_remaining",
            (uid, today, nxt["number"], limit_remaining),
        )
    return JSONResponse({"ok": True, "next": dict(nxt) | {"status": "called", "called_at": now}})


@router.post("/queue/tickets/{tid}/cancel")
async def cancel_ticket(tid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    today = _today()
    with _conn() as c:
        t = c.execute(
            "SELECT * FROM queue_tickets WHERE id=? AND public_user_id=? AND status IN ('waiting','called')",
            (tid, uid),
        ).fetchone()
        if not t:
            return _not_found()
        c.execute("UPDATE queue_tickets SET status='cancelled' WHERE id=?", (tid,))
        if t["date"] == today:
            c.execute(
                "UPDATE queue_state SET limit_remaining = limit_remaining + 1 "
                "WHERE public_user_id=? AND date=? AND limit_remaining IS NOT NULL",
                (uid, today),
            )
    return JSONResponse({"ok": True})


@router.post("/queue/reset")
async def reset_queue(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    today = _today()
    with _conn() as c:
        state = c.execute("SELECT * FROM queue_state WHERE public_user_id=?", (uid,)).fetchone()
        limit_remaining = state["limit_remaining"] if state and state["date"] == today else None
        c.execute(
            "DELETE FROM queue_tickets WHERE public_user_id=? AND date=?",
            (uid, today),
        )
        c.execute(
            "INSERT INTO queue_state (public_user_id, date, current_number, limit_remaining) VALUES (?,?,0,?) "
            "ON CONFLICT (public_user_id) DO UPDATE SET date=excluded.date, current_number=0, limit_remaining=excluded.limit_remaining",
            (uid, today, limit_remaining),
        )
    return JSONResponse({"ok": True})


# ── Notification polling ─────────────────────────────────────────────────────

@router.get("/events")
async def events(since: str, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        bookings = c.execute(
            "SELECT id, client_name, date, start_time FROM bookings "
            "WHERE public_user_id=? AND status='booked' AND created_at>? ORDER BY created_at",
            (uid, since),
        ).fetchall()
        tickets = c.execute(
            "SELECT id, client_name, number, date FROM queue_tickets "
            "WHERE public_user_id=? AND status='waiting' AND created_at>? ORDER BY created_at",
            (uid, since),
        ).fetchall()
    return JSONResponse({
        "now": _now(),
        "bookings": [dict(r) for r in bookings],
        "tickets": [dict(r) for r in tickets],
    })
