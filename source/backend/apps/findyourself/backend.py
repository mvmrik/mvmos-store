"""
FindYourself — backend.

Single-player needs no backend. Multiplayer is handled by the Game Hub framework
(backend/apps/gamehub/mp.py + backend/apps/findyourself/mp_game.py).

This file only exposes settings endpoints used by the multiplayer setup UI.
"""

import json
import os
import sqlite3
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/pub/findyourself")

_BASE = os.path.dirname(__file__)
GH_DB_PATH = os.path.abspath(os.path.join(_BASE, "..", "gamehub", "data.db"))


def _get_gh_player(token: str) -> dict | None:
    if not token:
        return None
    try:
        conn = sqlite3.connect(GH_DB_PATH)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT p.* FROM players p JOIN gh_tokens t ON t.player_id=p.id WHERE t.token=? AND t.expires_at>?",
            (token, __import__('datetime').datetime.utcnow().isoformat())
        ).fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception:
        return None


@router.get("/config")
async def get_config(request: Request):
    """Return saved FindYourself settings (api_key, rounds, time) for authenticated GH users."""
    token = request.headers.get("X-GH-Token", "")
    if not token or not _get_gh_player(token):
        return JSONResponse({"api_key": "", "rounds": 5, "time": 60})
    real_db = os.path.abspath(os.path.join(_BASE, "..", "..", "..", "apps", "findyourself", "data.db"))
    try:
        conn = sqlite3.connect(real_db)
        conn.row_factory = sqlite3.Row
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM cfg").fetchall()}
        conn.close()
        def _val(k, default):
            v = rows.get(k)
            try: return json.loads(v) if v is not None else default
            except Exception: return v or default
        return JSONResponse({"api_key": _val("api_key", ""), "rounds": _val("rounds", 5), "time": _val("time", 60)})
    except Exception:
        return JSONResponse({"api_key": "", "rounds": 5, "time": 60})
