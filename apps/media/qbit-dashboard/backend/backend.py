import httpx
import sys
import time
from fastapi import APIRouter, Depends, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/qbit", tags=["qbit"])

_AUTODISCOVER_PORTS = [8080, 8090, 9090, 10095, 6881]

# Persistent client with session cookie cache: key = (host, port, username) → {client, expires}
_sessions: dict = {}
_SESSION_TTL = 1800  # 30 min


async def _get_client(host: str, port: int, username: str, password: str) -> httpx.AsyncClient:
    key = (host, port, username)
    now = time.time()
    entry = _sessions.get(key)
    if entry and entry["expires"] > now:
        return entry["client"]
    # close old client if exists
    if entry:
        try: await entry["client"].aclose()
        except Exception: pass
    base = f"http://{host}:{port}"
    client = httpx.AsyncClient(base_url=base, timeout=15)
    if username:
        lr = await client.post("/api/v2/auth/login", data={"username": username, "password": password})
        if lr.text.strip() not in ("Ok.", ""):
            await client.aclose()
            raise ValueError("Login failed")
    _sessions[key] = {"client": client, "expires": now + _SESSION_TTL}
    return client


async def _proxy_request(host, port, username, password, path, method, data):
    """Make a proxied request, retry once if session expired."""
    for attempt in range(2):
        try:
            client = await _get_client(host, port, username, password)
            if method == "GET":
                r = await client.get(path)
            else:
                r = await client.post(path, data=data or {})
            # if qBittorrent returns 403, session expired — invalidate and retry
            if r.status_code == 403 and attempt == 0:
                key = (host, port, username)
                if key in _sessions:
                    try: await _sessions[key]["client"].aclose()
                    except Exception: pass
                    del _sessions[key]
                continue
            return r
        except httpx.ConnectError:
            raise
    raise ValueError("Session error after retry")


@router.get("/discover")
async def discover(session=Depends(get_current_session)):
    for port in _AUTODISCOVER_PORTS:
        try:
            async with httpx.AsyncClient(timeout=2) as client:
                r = await client.get(f"http://localhost:{port}/api/v2/app/version")
                if r.status_code == 200:
                    return JSONResponse({"found": True, "host": "localhost", "port": port, "version": r.text.strip()})
        except Exception:
            continue
    return JSONResponse({"found": False})


@router.post("/proxy")
async def proxy(request: Request, session=Depends(get_current_session)):
    body = await request.json()
    host = body.get("host", "localhost")
    port = int(body.get("port", 8080))
    username = body.get("username", "")
    password = body.get("password", "")
    path = body.get("path", "/api/v2/app/version")
    method = body.get("method", "GET").upper()
    data = body.get("data", None)
    try:
        r = await _proxy_request(host, port, username, password, path, method, data)
        try:
            return JSONResponse(r.json())
        except Exception:
            return Response(content=r.content, media_type=r.headers.get("content-type", "text/plain"))
    except httpx.ConnectError:
        return JSONResponse({"error": "Cannot connect to qBittorrent"}, status_code=502)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=401)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/upload")
async def upload_torrent(
    host: str = Form("localhost"),
    port: int = Form(8080),
    username: str = Form(""),
    password: str = Form(""),
    savepath: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    torrents: UploadFile = File(...),
    session=Depends(get_current_session),
):
    content = await torrents.read()
    try:
        client = await _get_client(host, port, username, password)
        files = {"torrents": (torrents.filename, content, "application/x-bittorrent")}
        data = {}
        if savepath: data["savepath"] = savepath
        if category: data["category"] = category
        r = await client.post("/api/v2/torrents/add", files=files, data=data)
        return JSONResponse({"ok": True, "result": r.text})
    except httpx.ConnectError:
        return JSONResponse({"error": "Cannot connect to qBittorrent"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
