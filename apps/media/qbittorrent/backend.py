import httpx
import asyncio
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from .auth import get_current_session

router = APIRouter(prefix="/api/qbit", tags=["qbit"])

_AUTODISCOVER_PORTS = [8080, 8090, 9090, 10095, 6881]


class QbitConfig(BaseModel):
    host: str = "localhost"
    port: int = 8080
    username: str = ""
    password: str = ""


async def _qbit_login(host: str, port: int, username: str, password: str) -> tuple[httpx.AsyncClient, str]:
    base = f"http://{host}:{port}"
    client = httpx.AsyncClient(base_url=base, timeout=8)
    r = await client.post("/api/v2/auth/login", data={"username": username, "password": password})
    if r.text.strip() == "Ok.":
        return client, base
    await client.aclose()
    raise ValueError("Login failed")


@router.get("/discover")
async def discover(session=Depends(get_current_session)):
    """Try common ports and return the first responding qBittorrent WebUI."""
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
    """
    Proxy qBittorrent API calls to avoid CORS.
    Body: { host, port, username, password, path, method, data }
    """
    body = await request.json()
    host = body.get("host", "localhost")
    port = int(body.get("port", 8080))
    username = body.get("username", "")
    password = body.get("password", "")
    path = body.get("path", "/api/v2/app/version")
    method = body.get("method", "GET").upper()
    data = body.get("data", None)

    base = f"http://{host}:{port}"
    try:
        async with httpx.AsyncClient(base_url=base, timeout=15) as client:
            # login
            lr = await client.post("/api/v2/auth/login", data={"username": username, "password": password})
            if lr.text.strip() not in ("Ok.", ""):
                # qbit may not require auth (bypass mode)
                if lr.status_code not in (200,):
                    return JSONResponse({"error": "Login failed"}, status_code=401)

            if method == "GET":
                r = await client.get(path)
            else:
                r = await client.post(path, data=data or {})

            try:
                return JSONResponse(r.json())
            except Exception:
                return Response(content=r.content, media_type=r.headers.get("content-type", "text/plain"))
    except httpx.ConnectError:
        return JSONResponse({"error": "Cannot connect to qBittorrent"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
