"""Score Arena - the statistics behind its screens.

Matches themselves run inside the Game Hub multiplayer framework (mp_game.py).
This file only hands a signed-in player back their own history, which the
statistics screens and the custom-game lists are built from.
"""
import importlib.util
import os
import sys

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# Loaded straight from the file rather than through sys.path, so an app update
# never keeps running an older sa_stats a live backend has already cached.
_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("scorearena_sa_stats", os.path.join(_APP_DIR, "sa_stats.py"))
sa_stats = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sa_stats)

router = APIRouter()


@router.get("/history")
def history(request: Request):
    """The caller's own matches. Apps Hub is the only sign-in, so the token in
    the request says whose history this is; nobody can ask for someone else's."""
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-Pub-Token", "") or request.headers.get("X-GH-Token", "")
    user = hub.get_pub_session(token) if hub else None
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    return JSONResponse({"recent": sa_stats.history(user["id"])})
