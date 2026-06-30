import os
import sys
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter(tags=["gamehub-public"])

APP_ID = "gamehub"

_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "gamehub", "public")


def _hub():
    return sys.modules.get("backend.apphub")


def _is_local(request: Request) -> bool:
    """True when the request carries a valid mvmOS desktop session — i.e. it
    comes from inside the OS rather than the public web."""
    token = request.cookies.get("session")
    if not token:
        return False
    try:
        auth = sys.modules["backend.auth"]
        with auth.get_conn() as conn:
            return conn.execute("SELECT 1 FROM sessions WHERE token=?", (token,)).fetchone() is not None
    except Exception:
        return False


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Game Hub</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Game Hub is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index(request: Request):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID) and not _is_local(request):
        return _private_page()
    return FileResponse(os.path.join(_DIR, "index.html"))
