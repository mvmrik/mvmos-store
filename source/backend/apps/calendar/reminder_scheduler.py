"""
Run every minute by the core scheduler (backend/scheduler.py) via
GET/POST /api/scheduler/tick. Fires a push notification + Telegram message
the minute an event/reminder's start_time arrives.

All-day events (start_time IS NULL) never get a reminder push — only
reminders and timed events (which both have a start_time) do.
"""

import os
import sqlite3
import sys
from datetime import datetime, timedelta

# Events older than this when first noticed (e.g. the server was down, or
# the app was just installed with old test data) are marked notified without
# pushing, so a long outage doesn't cause a burst of stale reminders.
_GRACE = timedelta(minutes=15)


def _fire(row):
    hub = sys.modules.get("backend.apphub")
    if not hub:
        return
    users = hub.get_users_by_ids([row["user_id"]])
    if not users or not users[0].get("username"):
        return

    notif = sys.modules.get("backend.notifications")
    if notif:
        notif.create_notification(
            users[0]["username"], row["title"], (row["description"] or "")[:200],
            kind="push", source="calendar", action_app="calendar", ref=row["id"],
        )

    tg = sys.modules.get("app_backend_telegramhub")
    if tg:
        base = tg.get_public_base_url() or ""
        url = f"{base.rstrip('/')}/pub/calendar/telegram?event={row['id']}"
        tg.notify(row["user_id"], "calendar", f"⏰ {row['title']}", web_app=url)


def run(now, db_path, config):
    if not db_path or not os.path.isfile(db_path):
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM events WHERE notified = 0 AND start_time IS NOT NULL"
        ).fetchall()
        for row in rows:
            try:
                due = datetime.strptime(f"{row['date']} {row['start_time']}", "%Y-%m-%d %H:%M")
            except ValueError:
                continue
            if due > now:
                continue
            conn.execute("UPDATE events SET notified = 1 WHERE id = ?", (row["id"],))
            conn.commit()
            if now - due <= _GRACE:
                _fire(row)
    finally:
        conn.close()
