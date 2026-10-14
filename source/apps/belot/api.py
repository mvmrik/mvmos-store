"""Public (Apps Hub) surface for Belot: what the table setup needs to know
about AI bots before a game starts. The AI itself lives in the premium build;
without it this only ever answers that AI bots are not available."""

import json
import os
import sqlite3
import sys

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse

router = APIRouter()
APP_ID = "belot"
_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _hub():
    return sys.modules.get("backend.apphub")


def _premium():
    prem = sys.modules.get("backend.premium")
    return prem.load_premium_backend(APP_ID) if prem else None


def ai_allowed() -> bool:
    """The administrator's switch for AI bots (Belot's settings on the desktop)."""
    try:
        conn = sqlite3.connect(_DB_PATH)
        try:
            row = conn.execute("SELECT value FROM cfg WHERE key='ai_enabled'").fetchone()
        finally:
            conn.close()
        return bool(row and json.loads(row[0]))
    except Exception:
        return False


@router.get("/ai-info")
async def ai_info(x_pub_token: str = Header(default=None)):
    """Whether the setup may offer AI bots, what one costs and what the caller has."""
    hub = _hub()
    user = hub.get_pub_session(x_pub_token) if hub and x_pub_token else None
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    prem = _premium()
    if not prem or not ai_allowed():
        return JSONResponse({"available": False})
    return JSONResponse(prem.info(user["id"]))
