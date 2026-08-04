"""mvmShare's minute tick.

Expiry itself needs no cron: every read checks the clock, so a share stops
opening the moment it runs out whether or not anything ran. What genuinely
needs a tick is the work that has to happen even when nobody visits — throwing
away spent download tokens, and destroying the shares whose owner asked for
deletion rather than a lock.
"""

import os
import sqlite3
import sys
from datetime import datetime, timezone

APP_ID = "mvmshare"


def _premium():
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def run(now, db_path, config):
    # No database yet means the app has never been opened, so there is nothing
    # to expire and nothing to clean up.
    if not os.path.exists(db_path):
        return

    now_iso = (now if isinstance(now, datetime) else datetime.now(timezone.utc)).astimezone(
        timezone.utc
    ).isoformat()

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        conn.execute("DELETE FROM download_tokens WHERE expires_at <= ?", (now_iso,))
        conn.commit()
    except sqlite3.Error:
        pass
    finally:
        conn.close()

    # Automatic deletion is the subscriber half, so it lives entirely in the
    # premium module. With no licence there is nothing to call and every
    # expired share simply stays locked in its owner's list.
    prem = _premium()
    if prem and prem.is_available():
        prem.purge_expired(db_path, now_iso)
