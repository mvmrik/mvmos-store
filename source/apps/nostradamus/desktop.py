"""OS-session settings for Nostradamus: currently just the DeepL translate
integration toggle. Everything else (vault, relays, notes) is handled by
api.py via the Apps Hub token, the same for the desktop window and the
public page."""

import os
import sqlite3
import sys

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter()

_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def _init_db():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS cfg (
                key   TEXT PRIMARY KEY,
                value TEXT
            )""")
        c.execute("INSERT OR IGNORE INTO cfg (key,value) VALUES ('deepl_enabled','0')")
        c.commit()


_init_db()


def _deepl_integration_available():
    """Whether this server can offer the DeepL integration at all: the
    nostradamus premium module must have been downloaded (licensed install)
    and the server's premium subscription must be active. Each user still
    picks their own DeepL key in the free DeepL Translator app — this only
    gates whether the translate button exists."""
    premium = sys.modules.get("backend.premium")
    if not premium or not premium.is_premium():
        return False
    mod = premium.load_premium_backend("nostradamus")
    return bool(mod and mod.is_available())


@router.get("/settings")
async def get_settings(session=Depends(get_current_session)):
    with _conn() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='deepl_enabled'").fetchone()
    value = row["value"] if row else "0"
    # Reported exactly as stored: this is the administrator's own choice and it
    # outlives a lapsed subscription, so the box is still ticked when one comes
    # back. Whether the feature can run is separate and has its own field.
    return JSONResponse({
        "deepl_enabled": value,
        "deepl_available": _deepl_integration_available(),
    })


class SettingsBody(BaseModel):
    deepl_enabled: str = "0"


@router.post("/settings")
async def save_settings(body: SettingsBody, session=Depends(get_current_session)):
    deepl_enabled = body.deepl_enabled
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('deepl_enabled',?)", (deepl_enabled,))
        c.commit()
    return JSONResponse({"ok": True})
