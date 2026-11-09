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
    """The signed-in profile's Google Maps key (its own, or the one the administrator
    shares with it for this app: Apps Hub -> API keys) and the saved rounds/time."""
    hub = sys.modules.get("backend.apphub")
    if hub and not hub.is_app_public("findyourself"):
        return JSONResponse({"error": "private"}, status_code=403)
    token = request.headers.get("X-GH-Token", "")
    player = _get_gh_player(token) if token else None
    out = {"api_key": "", "key_source": "", "signed_in": bool(player), "rounds": 5, "time": 60}
    if not player:
        return JSONResponse(out)
    if hub and hasattr(hub, "resolve_service_key"):
        res = hub.resolve_service_key(player["id"], "google_maps", "findyourself")
        out["api_key"], out["key_source"] = res["key"], res["source"]
    try:
        conn = sqlite3.connect(_DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM cfg").fetchall()}
        conn.close()
        for k, default in (("rounds", 5), ("time", 60)):
            v = rows.get(k)
            try:
                out[k] = json.loads(v) if v is not None else default
            except Exception:
                out[k] = v or default
    except Exception:
        pass
    return JSONResponse(out)
