"""Fitness' desktop half: the owner's switch for the AI help.

Only the switch lives here. Everything that does the work lives in
premium/backend.py.
"""

import os
import sqlite3
import sys
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter()

_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)")
    return c


def _available():
    mod = sys.modules.get("backend.premium")
    prem = mod.load_premium_backend("fitness") if mod else None
    return bool(prem and prem.is_available())


@router.get("/settings")
async def get_settings(session=Depends(get_current_session)):
    with _conn() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='ai_enabled'").fetchone()
    # The owner's choice is reported untouched so it survives a lapsed
    # subscription; whether it can run travels as its own field.
    return JSONResponse({"ai_enabled": bool(row and row["value"] == "1"), "ai_available": _available()})


class SettingsBody(BaseModel):
    ai_enabled: Optional[bool] = None


@router.post("/settings")
async def save_settings(body: SettingsBody, session=Depends(get_current_session)):
    if not _available():
        return JSONResponse({"error": "premium_required"}, status_code=403)
    with _conn() as c:
        if body.ai_enabled is not None:
            c.execute("INSERT INTO cfg(key,value) VALUES('ai_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      ("1" if body.ai_enabled else "0",))
        c.commit()
    return JSONResponse({"ok": True})
