"""
Calendar's app-to-app API — the only way another app (or mvmAI) should touch
Calendar data. Loaded by Apps Hub via hub.call_app_api("calendar", ...) once
an admin enables it at Apps Hub -> Settings -> App APIs. Reuses api.py's
already-running DB and helpers via sys.modules["app_public_calendar"] (api.py
is exec'd into that module name by backend/public_loader.py at startup), so
recurrence generation and row shaping are never re-implemented here.

user_id is always an Apps Hub public_users.id, the same identity the events
table keys on. Every function only ever reads or changes that user's events.

Invalid input raises ValueError with a short English reason; an event that
doesn't exist or belongs to someone else raises LookupError("not found").
"""

import json
import re
import sys
from datetime import datetime

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _pub():
    pub = sys.modules.get("app_public_calendar")
    if pub is None:
        raise RuntimeError("calendar api.py not loaded")
    return pub


def _check_date(value, field):
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"{field} must be YYYY-MM-DD")
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"{field} is not a real date")


def _check_time(value, field):
    if not isinstance(value, str) or not _TIME_RE.match(value):
        raise ValueError(f"{field} must be HH:MM (24h)")


def _norm_times(start_time, end_time):
    """Same rules as the Calendar UI: no start_time is an all-day event, a
    start_time without end_time is a reminder, both make a timed event."""
    start_time = start_time or None
    end_time = end_time or None
    if start_time:
        _check_time(start_time, "start_time")
    else:
        end_time = None
    if end_time:
        _check_time(end_time, "end_time")
        if end_time < start_time:
            raise ValueError("end_time must not be before start_time")
    return start_time, end_time


def _parse_recur_days(recur_days):
    if not recur_days:
        return None
    try:
        days = sorted({int(x) for x in str(recur_days).split(",") if x.strip() != ""})
    except ValueError:
        raise ValueError("recur_days must be comma separated numbers 0-6")
    if not days or any(d < 0 or d > 6 for d in days):
        raise ValueError("recur_days must be comma separated numbers 0-6")
    return days


def _get_own(conn, user_id, event_id):
    row = conn.execute(
        "SELECT * FROM events WHERE id=? AND user_id=?", (event_id, user_id)
    ).fetchone()
    if not row:
        raise LookupError("not found")
    return row


def list_events(user_id: str, date_from: str, date_to: str):
    """List the user's calendar events between date_from and date_to
    (both YYYY-MM-DD, inclusive), ordered by date and start time. Each event
    has id, title, description, date, start_time and end_time (HH:MM or
    null), all_day, reminder, completed and recurring."""
    _check_date(date_from, "date_from")
    _check_date(date_to, "date_to")
    pub = _pub()
    with pub._db() as conn:
        rows = conn.execute(
            "SELECT * FROM events WHERE user_id=? AND date >= ? AND date <= ? "
            "ORDER BY date, start_time",
            (user_id, date_from, date_to),
        ).fetchall()
    return [pub._row_to_event(r) for r in rows]


def get_event(user_id: str, event_id: str):
    """Get one of the user's calendar events by its id."""
    pub = _pub()
    with pub._db() as conn:
        return pub._row_to_event(_get_own(conn, user_id, event_id))


def add_event(user_id: str, title: str, date: str, start_time: str = None,
              end_time: str = None, description: str = "",
              recur_type: str = None, recur_days: str = None,
              recur_until: str = None):
    """Add a calendar event for the user. date is YYYY-MM-DD; start_time and
    end_time are HH:MM (24h). Leave start_time empty for an all-day event,
    give only start_time for a reminder, or both for a timed event. To repeat
    it, set recur_type to daily, weekly or monthly and recur_until to the last
    date (YYYY-MM-DD); weekly also needs recur_days as comma separated
    weekdays where 0 is Sunday and 6 is Saturday (e.g. "1,3,5"). Returns the
    created event (the first occurrence of a repeating one).

    Recurrence is expanded into one row per occurrence exactly like the
    Calendar UI does, sharing a series_id, capped by api.py's
    _MAX_OCCURRENCES."""
    pub = _pub()
    title = (title or "").strip()[:200]
    if not title:
        raise ValueError("title required")
    _check_date(date, "date")
    start_time, end_time = _norm_times(start_time, end_time)
    description = (description or "").strip()[:2000]
    if recur_type:
        if recur_type not in ("daily", "weekly", "monthly"):
            raise ValueError("recur_type must be daily, weekly or monthly")
        if not recur_until:
            raise ValueError("recur_until required for a repeating event")
        _check_date(recur_until, "recur_until")
    else:
        recur_type, recur_until, recur_days = None, None, None
    days = _parse_recur_days(recur_days) if recur_type == "weekly" else None
    if recur_type == "weekly" and not days:
        raise ValueError("recur_days required for a weekly event")

    body = pub.EventBody(
        title=title, description=description, date=date,
        start_time=start_time, end_time=end_time,
        recur_type=recur_type, recur_days=days, recur_until=recur_until,
    )
    dates, err = pub._resolve_dates(body)
    if err is not None:
        raise ValueError(json.loads(err.body).get("error") or "invalid event")

    now = pub._now()
    with pub._db() as conn:
        created = pub._insert_series(conn, user_id, title, description,
                                     start_time, end_time, dates, body, now)
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id=?", (created[0][0],)).fetchone()
    return pub._row_to_event(row)


def update_event(user_id: str, event_id: str, title: str = None,
                 date: str = None, start_time: str = None,
                 end_time: str = None, description: str = None,
                 scope: str = "this"):
    """Edit one of the user's calendar events. Only the fields you pass
    change; pass an empty string for start_time to make it all-day, or an
    empty string for end_time to make it a reminder. For a repeating event,
    scope "this" changes only this occurrence, "future" this and later ones,
    "all" every occurrence from today on; date can only change with scope
    "this". Returns the updated event.

    Unlike the Calendar UI, a "future"/"all" edit never regenerates the
    series — it updates the existing occurrence rows in place, so it cannot
    delete or add occurrences. A changed date or time resets the reminder so
    it fires again for the new moment."""
    pub = _pub()
    if scope not in ("this", "future", "all"):
        raise ValueError("scope must be this, future or all")
    with pub._db() as conn:
        row = _get_own(conn, user_id, event_id)
        if not row["series_id"]:
            scope = "this"
        if date is not None and scope != "this":
            raise ValueError("date can only change with scope this")

        new_title = row["title"] if title is None else title.strip()[:200]
        if not new_title:
            raise ValueError("title required")
        new_desc = row["description"] if description is None else description.strip()[:2000]
        new_date = row["date"] if date is None else date
        _check_date(new_date, "date")
        new_start = row["start_time"] if start_time is None else start_time
        new_end = row["end_time"] if end_time is None else end_time
        new_start, new_end = _norm_times(new_start, new_end)
        moved = (new_date != row["date"] or new_start != row["start_time"]
                 or new_end != row["end_time"])

        now = pub._now()
        if scope == "this":
            conn.execute(
                "UPDATE events SET title=?, description=?, date=?, start_time=?, end_time=?, "
                "notified=CASE WHEN ? THEN 0 ELSE notified END, updated_at=? WHERE id=?",
                (new_title, new_desc, new_date, new_start, new_end, 1 if moved else 0, now, event_id),
            )
        else:
            threshold = row["date"] if scope == "future" else datetime.now().strftime("%Y-%m-%d")
            conn.execute(
                "UPDATE events SET title=?, description=?, start_time=?, end_time=?, "
                "notified=CASE WHEN ? THEN 0 ELSE notified END, updated_at=? "
                "WHERE series_id=? AND user_id=? AND date>=?",
                (new_title, new_desc, new_start, new_end, 1 if moved else 0, now,
                 row["series_id"], user_id, threshold),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return pub._row_to_event(row)


def set_event_completed(user_id: str, event_id: str, completed: bool):
    """Mark one of the user's calendar events as done (completed true) or
    not done (completed false). Returns the updated event."""
    pub = _pub()
    with pub._db() as conn:
        row = _get_own(conn, user_id, event_id)
        end_time = row["end_time"]
        if completed and end_time is not None:
            end_time = datetime.now().strftime("%H:%M")
        conn.execute(
            "UPDATE events SET completed=?, end_time=?, updated_at=? WHERE id=?",
            (1 if completed else 0, end_time, pub._now(), event_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    return pub._row_to_event(row)


def delete_event(user_id: str, event_id: str, scope: str = "this"):
    """Delete one of the user's calendar events. For a repeating event,
    scope "this" deletes only this occurrence, "future" this and later ones,
    "all" every occurrence from today on (past ones stay as history)."""
    pub = _pub()
    if scope not in ("this", "future", "all"):
        raise ValueError("scope must be this, future or all")
    with pub._db() as conn:
        row = _get_own(conn, user_id, event_id)
        if scope != "this" and row["series_id"]:
            threshold = row["date"] if scope == "future" else datetime.now().strftime("%Y-%m-%d")
            cur = conn.execute(
                "DELETE FROM events WHERE series_id=? AND user_id=? AND date>=?",
                (row["series_id"], user_id, threshold),
            )
        else:
            cur = conn.execute("DELETE FROM events WHERE id=? AND user_id=?", (event_id, user_id))
        conn.commit()
    return {"ok": True, "deleted": cur.rowcount}
