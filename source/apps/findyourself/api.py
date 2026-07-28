"""
FindYourself — backend.

Single-player needs no backend. Multiplayer is handled by the Game Hub framework
(backend/apps/gamehub/mp.py + backend/apps/findyourself/mp_game.py).

This file only exposes settings endpoints used by the multiplayer setup UI.
"""

import json
import os
import sqlite3
import sys
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_BASE = os.path.dirname(__file__)
_DB_PATH = os.path.join(_BASE, "data.db")


def _get_gh_player(token: str) -> dict | None:
    """Apps Hub is the only auth. The old gh_tokens fallback read gamehub's
    own database directly; that table is gone, and an app may not open another
    app's files anyway."""
    if not token:
        return None
    hub = sys.modules.get("backend.apphub")
    return hub.get_pub_session(token) if hub else None


@router.get("/config")
async def get_config(request: Request):
    """Return saved FindYourself settings (api_key, rounds, time) for authenticated GH users."""
    token = request.headers.get("X-GH-Token", "")
    if not token or not _get_gh_player(token):
        return JSONResponse({"api_key": "", "rounds": 5, "time": 60})
    try:
        conn = sqlite3.connect(_DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM cfg").fetchall()}
        conn.close()
        def _val(k, default):
            v = rows.get(k)
            try: return json.loads(v) if v is not None else default
            except Exception: return v or default
        return JSONResponse({"api_key": _val("api_key", ""), "rounds": _val("rounds", 5), "time": _val("time", 60)})
    except Exception:
        return JSONResponse({"api_key": "", "rounds": 5, "time": 60})
