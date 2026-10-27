"""Jigsaw - what a player has already built.

The game itself runs inside the Game Hub multiplayer framework (mp_game.py).
This file only hands a signed-in player back their own best result for every
picture and size, which the picture gallery in the lobby shows.
"""
import importlib.util
import os
import sys

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

# Loaded straight from the file rather than through sys.path, so an app update
# never keeps running an older jp_stats a live backend has already cached.
_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("jigsaw_jp_stats", os.path.join(_APP_DIR, "jp_stats.py"))
jp_stats = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jp_stats)

router = APIRouter()


@router.get("/results")
def results(request: Request):
    """The caller's own results. Apps Hub is the only sign-in, so the token in
    the request says whose they are; nobody can ask for someone else's."""
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-Pub-Token", "") or request.headers.get("X-GH-Token", "")
    user = hub.get_pub_session(token) if hub else None
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    return JSONResponse({"results": jp_stats.best(user["id"])})
