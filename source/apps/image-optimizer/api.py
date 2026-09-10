"""Thin public/admin shell for the browser-only Image Optimizer.

Image bytes never reach these routes. The base app only asks the separately
delivered premium module which controls the administrator enabled publicly.
"""

import os
import sqlite3
import sys

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel


router = APIRouter()
desktop_router = APIRouter()
APP_ID = "image-optimizer"
_PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _hub():
    return sys.modules.get("backend.apphub")


def _premium():
    module = sys.modules.get("backend.premium")
    return module.load_premium_backend(APP_ID) if module else None


def _premium_available():
    premium = _premium()
    return premium if premium and premium.is_available() else None


def _desktop_admin(session):
    if session.get("effective_user") != "root":
        raise HTTPException(403, "Root desktop access required")
    return session


def _public_user(token):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


class PublicFeaturesBody(BaseModel):
    archive_upload: bool = False
    resize: bool = False
    bulk_rename: bool = False
    preserve_transparency: bool = False


@router.get("/")
async def public_page():
    return FileResponse(
        os.path.join(_PUBLIC_DIR, "index.html"),
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/api/config")
async def public_config(x_pub_token: str = Header(default=None)):
    user = _public_user(x_pub_token)
    premium = _premium_available()
    settings = premium.get_settings() if premium else {
        "archive_upload": False,
        "resize": False,
        "bulk_rename": False,
        "preserve_transparency": False,
    }
    return JSONResponse({
        "signed_in": bool(user),
        "profile_id": user["id"] if user else None,
        "premium": bool(premium),
        "features": settings,
    }, headers={"Cache-Control": "no-store"})


@router.get("/api/premium/{asset}")
async def public_premium_asset(asset: str, x_pub_token: str = Header(default=None)):
    if not _public_user(x_pub_token):
        return Response(status_code=401, headers={"Cache-Control": "no-store"})
    premium = _premium_available()
    settings = premium.get_settings() if premium else {}
    if not premium or not any(settings.values()):
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    content = premium.get_asset(asset)
    if content is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "private, no-store"})


@desktop_router.get("/admin/settings")
async def admin_settings(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    premium = _premium_available()
    settings = premium.get_settings() if premium else {
        "archive_upload": False,
        "resize": False,
        "bulk_rename": False,
        "preserve_transparency": False,
    }
    return {"premium": bool(premium), **settings}


@desktop_router.put("/admin/settings")
async def save_admin_settings(body: PublicFeaturesBody,
                              session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    premium = _premium_available()
    if not premium:
        raise HTTPException(402, "premium_required")
    premium.save_settings(body.model_dump())
    return {"ok": True}


@desktop_router.get("/admin/premium/{asset}")
async def desktop_premium_asset(asset: str,
                                session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    premium = _premium_available()
    content = premium.get_asset(asset) if premium else None
    if content is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "private, no-store"})
