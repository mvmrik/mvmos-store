"""
Telegram Hub public surface, mounted at /pub/telegramhub by public_loader.py:
the page where a profile connects and manages its own bots, and the small page a
bot's Mini App button opens to sign the person in. The bot webhook and the
management API live in backend.py, auto-loaded by app_backends.py.
"""

import os
from fastapi import APIRouter
from fastapi.responses import FileResponse

router = APIRouter()

_PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "telegramhub", "public")


@router.get("/")
async def index_page():
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/open")
async def open_page():
    return FileResponse(os.path.join(_PUBLIC_DIR, "open.html"))
