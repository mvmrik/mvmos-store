"""
Telegram Hub public surface — a small directory page (since there is one
shared bot for the whole server, not a per-app browser view) plus the
account-linking confirmation page. Mounted at /pub/telegramhub by
public_loader.py. The bot webhook and link-confirm API live in backend.py,
auto-loaded by app_backends.py.
"""

import os
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

_PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "telegramhub", "public")


@router.get("/")
async def index_page():
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/link")
async def link_page():
    return FileResponse(os.path.join(_PUBLIC_DIR, "link.html"))
