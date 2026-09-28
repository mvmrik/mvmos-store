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

from fastapi import APIRouter, Header, Request
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter()

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


def _title_of(path: str) -> str:
    # Only the title is needed for the list; it sits near the start of the
    # file, but a document is small enough to just read.
    try:
        with open(path, encoding="utf-8") as f:
            return str(json.load(f).get("title") or "")
    except Exception:
        return ""


def _meta(doc_id: str, path: str, title: Optional[str] = None) -> dict:
    st = os.stat(path)
    return {
        "id": doc_id,
        "title": title if title is not None else _title_of(path),
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
    return _meta(doc_id, path, str(doc.get("title") or ""))


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
    return _meta(doc_id, path, str(doc.get("title") or ""))


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
    return _meta(new_id, new_path, str(doc.get("title") or ""))
