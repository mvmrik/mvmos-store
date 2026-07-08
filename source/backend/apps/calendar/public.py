"""
mvmOS Calendar — events and reminders, per Apps Hub account.

Mounted at /pub/calendar by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header) — used identically by the in-app mvmOS window and
by the standalone public page, so there is no separate backend.py (same
reasoning as backend/apps/chat/public.py).

An event with no start_time is all-day. One with a start_time but no
end_time is a reminder (a single point in time, not a range). One with both
is a timed event. reminder_scheduler.py (run every minute by the core
scheduler) fires a push notification + Telegram message the minute an
event/reminder's start_time arrives.
"""

import calendar as calendar_mod
import json
import os
import sqlite3
import sys
import uuid
from datetime import date as date_cls, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

# Safety cap on how many rows a single recurring series can generate, so a
# careless "repeat daily until year 9999" can't blow up the DB.
_MAX_OCCURRENCES = 730

router = APIRouter()

APP_ID = "calendar"

_DIR        = os.path.dirname(__file__)                                      # backend/apps/calendar
_DB_PATH    = os.path.join(_DIR, "..", "..", "..", "apps", "calendar", "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "..", "..", "..", "apps", "calendar", "public")


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS events (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                date        TEXT NOT NULL,
                start_time  TEXT,
                end_time    TEXT,
                notified    INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);
        """)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(events)").fetchall()]
        for col, decl in [
            ("completed", "INTEGER NOT NULL DEFAULT 0"),
            ("series_id", "TEXT"),
            ("recur_type", "TEXT"),
            ("recur_days", "TEXT"),
            ("recur_until", "TEXT"),
        ]:
            if col not in cols:
                conn.execute(f"ALTER TABLE events ADD COLUMN {col} {decl}")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id)")
        conn.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Calendar</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Calendar is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/telegram")
async def telegram_mini_app():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "telegram.html"))


def _row_to_event(r) -> dict:
    d = dict(r)
    d["all_day"] = d["start_time"] is None
    d["reminder"] = d["start_time"] is not None and d["end_time"] is None
    d["completed"] = bool(d["completed"])
    d["recurring"] = d.get("series_id") is not None
    d["recur_days"] = [int(x) for x in d["recur_days"].split(",")] if d.get("recur_days") else None
    return d


class EventBody(BaseModel):
    title: str
    description: str = ""
    date: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    # Recurrence: recur_type is one of 'daily' / 'weekly' / 'monthly' (or
    # None for a plain one-off event). recur_days is only used for
    # 'weekly' — a list of JS-style weekday numbers (Sun=0..Sat=6).
    # recur_until is the last date (inclusive) the series should cover;
    # 'monthly' always repeats on the day-of-month of `date` itself.
    recur_type: Optional[str] = None
    recur_days: Optional[List[int]] = None
    recur_until: Optional[str] = None


def _py_weekday_to_js(d: date_cls) -> int:
    return (d.weekday() + 1) % 7


def _generate_dates(start_str, until_str, recur_type, recur_days):
    start = datetime.strptime(start_str, "%Y-%m-%d").date()
    until = datetime.strptime(until_str, "%Y-%m-%d").date()
    if until < start:
        return []
    dates = []
    if recur_type == "daily":
        d = start
        while d <= until:
            dates.append(d)
            d += timedelta(days=1)
            if len(dates) > _MAX_OCCURRENCES:
                raise ValueError("too_many_occurrences")
    elif recur_type == "weekly":
        days = set(recur_days or [])
        d = start
        while d <= until:
            if _py_weekday_to_js(d) in days:
                dates.append(d)
            d += timedelta(days=1)
            if len(dates) > _MAX_OCCURRENCES:
                raise ValueError("too_many_occurrences")
    elif recur_type == "monthly":
        day_of_month = start.day
        y, m = start.year, start.month
        while date_cls(y, m, 1) <= until:
            last_day = calendar_mod.monthrange(y, m)[1]
            if day_of_month <= last_day:
                d = date_cls(y, m, day_of_month)
                if start <= d <= until:
                    dates.append(d)
            m += 1
            if m > 12:
                m = 1
                y += 1
            if len(dates) > _MAX_OCCURRENCES:
                raise ValueError("too_many_occurrences")
    return [d.strftime("%Y-%m-%d") for d in dates]


def _resolve_dates(body: "EventBody"):
    """Returns (dates, error_response). error_response is None on success."""
    if body.recur_type is None:
        return [body.date], None
    if body.recur_type not in ("daily", "weekly", "monthly"):
        return None, JSONResponse({"error": "invalid recur_type"}, status_code=400)
    if not body.recur_until:
        return None, JSONResponse({"error": "recur_until required"}, status_code=400)
    if body.recur_type == "weekly" and not body.recur_days:
        return None, JSONResponse({"error": "recur_days required"}, status_code=400)
    try:
        dates = _generate_dates(body.date, body.recur_until, body.recur_type, body.recur_days)
    except ValueError:
        return None, JSONResponse({"error": "too_many_occurrences"}, status_code=400)
    if not dates:
        return None, JSONResponse({"error": "invalid recurrence range"}, status_code=400)
    return dates, None


def _insert_series(conn, user_id, title, description, start_time, end_time, dates, body: "EventBody", now,
                    reuse_series_id=None):
    is_series = len(dates) > 1
    series_id = (reuse_series_id or str(uuid.uuid4())) if is_series else None
    recur_type = body.recur_type if is_series else None
    recur_until = body.recur_until if is_series else None
    recur_days = None
    if is_series and body.recur_type == "weekly" and body.recur_days:
        recur_days = ",".join(str(x) for x in sorted(set(body.recur_days)))
    created = []
    for d in dates:
        eid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO events(id,user_id,title,description,date,start_time,end_time,notified,completed,"
            "series_id,recur_type,recur_days,recur_until,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,0,0,?,?,?,?,?,?)",
            (eid, user_id, title, description, d, start_time, end_time,
             series_id, recur_type, recur_days, recur_until, now, now),
        )
        created.append((eid, d))
    return created


@router.get("/events")
async def list_events(start: str, end: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id=? AND date >= ? AND date <= ? "
            "ORDER BY date, start_time",
            (me["id"], start, end),
        ).fetchall()
    return JSONResponse([_row_to_event(r) for r in rows])


@router.post("/events")
async def create_event(body: EventBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    start_time = body.start_time or None
    end_time = body.end_time if start_time else None
    description = body.description.strip()[:2000]

    dates, err = _resolve_dates(body)
    if err:
        return err

    now = _now()
    with _db() as conn:
        created = _insert_series(conn, me["id"], title, description, start_time, end_time, dates, body, now)
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id=?", (created[0][0],)).fetchone()
    return JSONResponse(_row_to_event(row))


@router.put("/events/{event_id}")
async def update_event(event_id: str, body: EventBody, x_pub_token: str = Header(default=None),
                        scope: str = "this"):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if scope not in ("this", "future", "all"):
        return JSONResponse({"error": "invalid scope"}, status_code=400)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    start_time = body.start_time or None
    end_time = body.end_time if start_time else None
    description = body.description.strip()[:2000]

    now = _now()
    today = datetime.now().strftime("%Y-%m-%d")
    with _db() as conn:
        existing = conn.execute("SELECT * FROM events WHERE id=? AND user_id=?", (event_id, me["id"])).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)

        if existing["series_id"] and scope == "this":
            # Single-occurrence edit: only this exact row changes (title,
            # description, date, time). Every sibling occurrence — past AND
            # future — is left completely untouched, and this row keeps its
            # existing series_id/recur_* metadata so it's still recognized
            # as part of the series (e.g. for the recurring badge, and so a
            # later "future"/"all" edit on any sibling still finds it).
            conn.execute(
                "UPDATE events SET title=?, description=?, date=?, start_time=?, end_time=?, updated_at=? "
                "WHERE id=?",
                (title, description, body.date, start_time, end_time, now, event_id),
            )
            row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
            conn.commit()
            return JSONResponse(_row_to_event(row))

        if existing["series_id"]:
            # "future": this occurrence and everything after it *in series
            # order*, so regeneration starts at the clicked occurrence's
            # own date. "all": every occurrence that hasn't happened yet
            # (today or later), regardless of which occurrence was clicked
            # — so regeneration must start at TODAY, not at whatever date
            # the clicked occurrence happened to be, otherwise anything
            # between today and the clicked date gets deleted but never
            # regenerated. Either way, reuses the same series_id so
            # repeated edits over time never fragment the lineage into
            # overlapping sub-series, and anything strictly before the
            # threshold is left untouched (never touches real history).
            threshold = existing["date"] if scope == "future" else today
            gen_body = body if scope == "future" else body.model_copy(update={"date": today})
            dates, err = _resolve_dates(gen_body)
            if err:
                return err
            conn.execute(
                "DELETE FROM events WHERE series_id=? AND user_id=? AND date>=?",
                (existing["series_id"], me["id"], threshold),
            )
            created = _insert_series(conn, me["id"], title, description, start_time, end_time, dates, gen_body, now,
                                      reuse_series_id=existing["series_id"])
        else:
            dates, err = _resolve_dates(body)
            if err:
                return err
            conn.execute("DELETE FROM events WHERE id=? AND user_id=?", (event_id, me["id"]))
            created = _insert_series(conn, me["id"], title, description, start_time, end_time, dates, body, now)

        conn.commit()
        target_id = next((eid for eid, d in created if d == body.date), created[0][0])
        row = conn.execute("SELECT * FROM events WHERE id=?", (target_id,)).fetchone()
    return JSONResponse(_row_to_event(row))


class CompleteBody(BaseModel):
    completed: bool


@router.patch("/events/{event_id}/complete")
async def complete_event(event_id: str, body: CompleteBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM events WHERE id=? AND user_id=?", (event_id, me["id"])).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        end_time = row["end_time"]
        if body.completed and end_time is not None:
            end_time = datetime.now().strftime("%H:%M")
        conn.execute(
            "UPDATE events SET completed=?, end_time=?, updated_at=? WHERE id=?",
            (1 if body.completed else 0, end_time, _now(), event_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return JSONResponse(_row_to_event(row))


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, x_pub_token: str = Header(default=None), scope: str = "this"):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if scope not in ("this", "future", "all"):
        return JSONResponse({"error": "invalid scope"}, status_code=400)
    today = datetime.now().strftime("%Y-%m-%d")
    with _db() as conn:
        if scope in ("future", "all"):
            existing = conn.execute("SELECT * FROM events WHERE id=? AND user_id=?", (event_id, me["id"])).fetchone()
            if existing and existing["series_id"]:
                threshold = existing["date"] if scope == "future" else today
                conn.execute(
                    "DELETE FROM events WHERE series_id=? AND user_id=? AND date>=?",
                    (existing["series_id"], me["id"], threshold),
                )
            else:
                conn.execute("DELETE FROM events WHERE id=? AND user_id=?", (event_id, me["id"]))
        else:
            conn.execute("DELETE FROM events WHERE id=? AND user_id=?", (event_id, me["id"]))
        conn.commit()
    return JSONResponse({"ok": True})
