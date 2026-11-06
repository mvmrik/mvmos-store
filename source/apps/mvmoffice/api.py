"""
mvmOS mvmOffice — documents in the cloud of this server, per Apps Hub account.

Mounted at /pub/mvmoffice by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header), used the same way by the desktop window and the
public page.

Every document is a plain .mvmoffice file (JSON) in
storage/<account id>/<document id>.mvmoffice — no database. The same file is
what the user downloads, sends to someone or opens on another mvmOS, so what
lives here and what travels are one and the same thing.

Saving carries the revision the editor started from (the file's mtime_ns);
when the file has changed since, the save is refused with 409 so two open
windows never silently overwrite each other.
"""

import json
import os
import re
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import FileResponse, JSONResponse, Response

router = APIRouter()
desktop_router = APIRouter()

APP_ID = "mvmoffice"

_DIR         = os.path.dirname(__file__)                     # apps/mvmoffice
_PUBLIC_DIR  = os.path.join(_DIR, "public")
_STORAGE_DIR = os.path.join(_DIR, "storage")

EXT          = ".mvmoffice"
MAX_BYTES    = 20 * 1024 * 1024
MAX_DOCS     = 2000
_ID_RE       = re.compile(r"^[a-f0-9]{32}$")


def _hub():
    return sys.modules.get("backend.apphub")


def _user(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _err(status, code):
    return JSONResponse({"error": code}, status_code=status)


def _user_dir(user_id: str) -> str:
    # Account ids come from Apps Hub; keep only safe characters all the same.
    safe = re.sub(r"[^A-Za-z0-9_-]", "", str(user_id))
    if not safe:
        raise ValueError("bad user")
    path = os.path.join(_STORAGE_DIR, safe)
    os.makedirs(path, exist_ok=True)
    return path


def _doc_path(user_id: str, doc_id: str) -> Optional[str]:
    if not _ID_RE.match(doc_id or ""):
        return None
    return os.path.join(_user_dir(user_id), doc_id + EXT)


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _revision(path: str) -> str:
    return str(os.stat(path).st_mtime_ns)


def _read_body(raw: bytes):
    """The request body as a document, or an error code."""
    if len(raw) > MAX_BYTES:
        return None, "too_large"
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, "bad_json"
    if not isinstance(body, dict):
        return None, "bad_json"
    return body, None


def _check_doc(doc) -> Optional[str]:
    if not isinstance(doc, dict) or doc.get("format") != "mvmoffice":
        return "not_mvmoffice"
    if not isinstance(doc.get("tables", {}), dict) or not isinstance(doc.get("pages", []), list):
        return "not_mvmoffice"
    return None


def _write(path: str, doc: dict) -> None:
    """Write through a temporary file so a crash never leaves half a document."""
    data = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _head_of(path: str) -> dict:
    # Only the title and the type are needed for the list, but a document is
    # small enough to just read.
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
        return {"title": str(doc.get("title") or ""), "type": "book" if doc.get("type") == "book" else "text"}
    except Exception:
        return {"title": "", "type": "text"}


def _meta(doc_id: str, path: str, doc: Optional[dict] = None) -> dict:
    st = os.stat(path)
    head = ({"title": str(doc.get("title") or ""), "type": "book" if doc.get("type") == "book" else "text"}
            if doc is not None else _head_of(path))
    return {
        "id": doc_id,
        **head,
        "updated": _iso(st.st_mtime),
        "size": st.st_size,
        "revision": str(st.st_mtime_ns),
    }


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("mvmOffice", "📝")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/fonts")
async def fonts(x_pub_token: Optional[str] = Header(None)):
    """The fonts mvmFonts has installed, when that app is there and its App API is on.
    Anything else (not installed, switched off) is simply no fonts: the editor then
    offers none, and nothing else changes."""
    user = _user(x_pub_token)
    if not user:
        return _err(401, "unauthorized")
    hub = _hub()
    try:
        data = hub.call_app_api("mvmfonts", "list_fonts", user.get("id")) if hub else None
    except Exception:
        data = None
    if not isinstance(data, dict) or not isinstance(data.get("families"), list):
        return {"families": [], "ranges": {}}
    return {"families": data["families"], "ranges": data.get("ranges") or {}}


@router.get("/region")
async def region(x_pub_token: Optional[str] = Header(None)):
    """How this person writes numbers and dates: their own Apps Hub settings,
    and where those are empty, the settings of this mvmOS install."""
    user = _user(x_pub_token)
    if not user:
        return _err(401, "unauthorized")
    system = {}
    platform = sys.modules.get("backend.platform_api")
    if platform and hasattr(platform, "get_settings"):
        try:
            system = platform.get_settings() or {}
        except Exception:
            system = {}
    return {
        "lang": user.get("language") or system.get("locale") or "",
        "date_format": user.get("date_format") or system.get("date_format") or "",
    }


@router.get("/docs")
async def list_docs(x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    folder = _user_dir(user["id"])
    out = []
    for name in os.listdir(folder):
        if not name.endswith(EXT):
            continue
        doc_id = name[: -len(EXT)]
        if _ID_RE.match(doc_id):
            out.append(_meta(doc_id, os.path.join(folder, name)))
    out.sort(key=lambda d: d["updated"], reverse=True)
    return {"docs": out}


@router.post("/docs")
async def create_doc(request: Request, x_pub_token: Optional[str] = Header(None)):
    """A new document, or an uploaded .mvmoffice file — both are just the
    document's JSON."""
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    doc, err = _read_body(await request.body())
    if err:
        return _err(413 if err == "too_large" else 400, err)
    err = _check_doc(doc)
    if err:
        return _err(400, err)
    folder = _user_dir(user["id"])
    if sum(1 for n in os.listdir(folder) if n.endswith(EXT)) >= MAX_DOCS:
        return _err(400, "too_many")
    doc_id = uuid.uuid4().hex
    path = os.path.join(folder, doc_id + EXT)
    _write(path, doc)
    return _meta(doc_id, path, doc)


@router.get("/docs/{doc_id}")
async def get_doc(doc_id: str, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    path = _doc_path(user["id"], doc_id)
    if not path or not os.path.isfile(path):
        return _err(404, "not_found")
    with open(path, encoding="utf-8") as f:
        try:
            doc = json.load(f)
        except json.JSONDecodeError:
            return _err(500, "damaged")
    return {"id": doc_id, "revision": _revision(path), "doc": doc}


@router.put("/docs/{doc_id}")
async def save_doc(doc_id: str, request: Request,
                   x_pub_token: Optional[str] = Header(None),
                   x_base_revision: Optional[str] = Header(None)):
    """Save over the document. X-Base-Revision is the revision the editor
    loaded or last saved; a different one on disk means someone else saved
    in between. Without the header the save always goes through (used for
    "keep mine" after a conflict)."""
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    path = _doc_path(user["id"], doc_id)
    if not path or not os.path.isfile(path):
        return _err(404, "not_found")
    doc, err = _read_body(await request.body())
    if err:
        return _err(413 if err == "too_large" else 400, err)
    err = _check_doc(doc)
    if err:
        return _err(400, err)
    if x_base_revision and x_base_revision != _revision(path):
        return JSONResponse({"error": "conflict", "revision": _revision(path)}, status_code=409)
    _write(path, doc)
    return _meta(doc_id, path, doc)


@router.delete("/docs/{doc_id}")
async def delete_doc(doc_id: str, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    path = _doc_path(user["id"], doc_id)
    if not path or not os.path.isfile(path):
        return _err(404, "not_found")
    os.unlink(path)
    return {"ok": True}


@router.post("/docs/{doc_id}/duplicate")
async def duplicate_doc(doc_id: str, request: Request, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "login_required")
    path = _doc_path(user["id"], doc_id)
    if not path or not os.path.isfile(path):
        return _err(404, "not_found")
    try:
        body = await request.json()
    except Exception:
        body = {}
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    title = body.get("title") if isinstance(body, dict) else None
    if isinstance(title, str) and title.strip():
        doc["title"] = title.strip()[:200]
    new_id = uuid.uuid4().hex
    new_path = os.path.join(_user_dir(user["id"]), new_id + EXT)
    _write(new_path, doc)
    return _meta(new_id, new_path, doc)


# ── The writing assistant ─────────────────────────────────────────────────
# Everything it does lives in premium/backend.py, which exists only on an
# installation with a licence. These routes only ask for it: without the module
# there is no assistant, whatever a browser claims.

def _premium():
    module = sys.modules.get("backend.premium")
    return module.load_premium_backend(APP_ID) if module else None


def _ai_module():
    module = _premium()
    return module if module is not None and getattr(module, "is_available", lambda: False)() else None


def _surface(request: Request) -> str:
    """"desktop" only for the desktop window of someone who is also signed in to
    mvmOS; everything else is a public page."""
    if request.headers.get("x-mvmoffice-surface") != "desktop":
        return "public"
    auth = sys.modules.get("backend.auth")
    try:
        return "desktop" if auth and auth.get_current_session_optional(request) else "public"
    except Exception:
        return "public"


@router.get("/ai/status")
async def ai_status(request: Request, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "unauthorized")
    module = _ai_module()
    ready = bool(module and module.ready())
    surface = _surface(request)
    info = {"premium": module is not None, "ready": ready, "enabled": bool(module and module.enabled(surface))}
    if module is not None and info["enabled"]:
        info["images"] = bool(ready and module.images_enabled(surface) and module.images_ready())
        info["credits"] = module.credits(user["id"])
    return JSONResponse(info, headers={"Cache-Control": "no-store"})


@router.get("/ai/assistant.js")
async def ai_script(request: Request, x_pub_token: Optional[str] = Header(None)):
    if not _user(x_pub_token):
        return Response(status_code=401, headers={"Cache-Control": "no-store"})
    module = _ai_module()
    content = module.get_asset("assistant.js") if module and module.enabled(_surface(request)) else None
    if content is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=content, media_type="application/javascript", headers={"Cache-Control": "private, no-store"})


@router.post("/ai/chat")
async def ai_chat(request: Request, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "unauthorized")
    module = _ai_module()
    if module is None:
        return _err(402, "premium_required")
    raw = await request.body()
    if len(raw) > 4 * 1024 * 1024:
        return _err(413, "too_large")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _err(400, "bad_json")
    if not isinstance(body, dict):
        return _err(400, "bad_json")
    result = await module.chat(user["id"], body, _surface(request))
    status = 200 if not result.get("error") else (403 if result["error"] == "disabled" else 402 if result["error"] == "no_credits" else 503 if result["error"] in ("mvmai_unavailable", "mvmai_disabled") else 502)
    return JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})


@router.post("/ai/image")
async def ai_image(request: Request, x_pub_token: Optional[str] = Header(None)):
    user = _user(x_pub_token)
    if not user:
        return _err(401, "unauthorized")
    module = _ai_module()
    if module is None:
        return _err(402, "premium_required")
    try:
        body = json.loads((await request.body()).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _err(400, "bad_json")
    if not isinstance(body, dict):
        return _err(400, "bad_json")
    result = await module.image(user["id"], body, _surface(request))
    if result.get("error"):
        status = 403 if result["error"] == "disabled" else 402 if result["error"] == "no_credits" else 503 if result["error"] in ("image_unavailable", "mvmai_unavailable", "mvmai_disabled") else 502
        return JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


# The administrator's switches for the assistant (desktop settings of the app).
# Without the premium module there is nothing to switch and the form is locked.

def _desktop_session(session):
    if not session or not session.get("effective_user"):
        raise HTTPException(401, "Desktop session required")
    return session


class AiSettingsBody(BaseModel):
    assistant: bool = True
    images: bool = True
    public: bool = True


@desktop_router.get("/admin/settings")
async def admin_settings(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_session(session)
    module = _ai_module()
    return {"premium": module is not None, **(module.get_settings() if module else {"assistant": False, "images": False, "public": False})}


@desktop_router.put("/admin/settings")
async def save_admin_settings(body: AiSettingsBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_session(session)
    module = _ai_module()
    if module is None:
        raise HTTPException(402, "premium_required")
    module.save_settings(body.model_dump())
    return {"ok": True}
