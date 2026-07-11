import os, sys
from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter(tags=["apphub-public"])

_DIR = os.path.join(os.path.dirname(__file__), "public")

APP_ID = "apphub"


def _hub():
    return sys.modules.get("backend.apphub")


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Apps Hub</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Apps Hub is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_DIR, "index.html"))


@router.get("/avatar.js")
async def avatar_js():
    return FileResponse(os.path.join(_DIR, "avatar.js"),
                        media_type="application/javascript")


@router.get("/layout.js")
async def layout_js():
    return FileResponse(os.path.join(_DIR, "layout.js"),
                        media_type="application/javascript")
