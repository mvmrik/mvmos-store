"""Tower Defense - the permanent shop.

Runs themselves are played inside the Game Hub multiplayer framework
(mp_game.py), and a room stops listening the moment its run is over. The
permanent shop lives on exactly that game-over screen, so it talks to this
router instead: it reads the caller's bank and spends its points.

Fast play (Premium) is only routed here: the module that decides and the
script that does the work live in premium/, which an unlicensed installation
never receives.
"""
import importlib.util
import os
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response

# Loaded straight from the file rather than through sys.path, so an app update
# never keeps running an older td_bank a live backend has already cached.
_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("towerdefense_td_bank", os.path.join(_APP_DIR, "td_bank.py"))
td_bank = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(td_bank)

router = APIRouter()
desktop_router = APIRouter()
APP_ID = "towerdefense"


def _user(request: Request):
    """Apps Hub is the only sign-in, so the token says whose bank this is;
    nobody can read or spend someone else's."""
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-GH-Token", "") or request.headers.get("X-Pub-Token", "")
    return hub.get_pub_session(token) if hub and token else None


@router.get("/bank")
def bank(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    return JSONResponse({**td_bank.get(user["id"]), "shop": td_bank.catalogue()})


@router.post("/buy")
async def buy(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        body = {}
    act, key = str(body.get("act", "")), str(body.get("key", ""))
    result, err = td_bank.buy(user["id"], act, key)
    if not result:
        return JSONResponse({"error": err, **td_bank.get(user["id"])}, status_code=400)
    return JSONResponse(result)


# ── Fast play (Premium) ──────────────────────────────────────────────────────

def _premium():
    module = sys.modules.get("backend.premium")
    premium = module.load_premium_backend(APP_ID) if module else None
    return premium if premium and premium.is_available() else None


@router.get("/premium/{asset}")
def premium_asset(asset: str, request: Request):
    """The script, for a signed-in player, or 404 — the page then has none of it."""
    premium = _premium()
    content = premium.get_asset(asset) if premium and _user(request) else None
    if content is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=content, media_type="application/javascript",
                    headers={"Cache-Control": "private, no-store"})


@desktop_router.get("/admin/fastplay")
def fastplay_settings(session=Depends(sys.modules["backend.auth"].get_current_session)):
    premium = _premium()
    return {"premium": bool(premium), "on": premium.fast_play_on() if premium else False}


@desktop_router.put("/admin/fastplay")
async def save_fastplay(request: Request, session=Depends(sys.modules["backend.auth"].get_current_session)):
    premium = _premium()
    if not premium:
        raise HTTPException(402, "premium_required")
    try:
        body = await request.json()
    except Exception:
        body = {}
    premium.set_fast_play(bool(body.get("on")))
    return {"ok": True, "on": premium.fast_play_on()}
