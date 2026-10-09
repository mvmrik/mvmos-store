"""Private per-profile cards and passes, shared by desktop and Apps Hub web views."""
import base64
import binascii
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Header, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
APP_ID = "cardbox"
ROOT = os.path.dirname(__file__)
DB = os.path.join(ROOT, "data.db")
UPLOADS = os.path.join(ROOT, "uploads")
KINDS = {"loyalty", "discount", "voucher", "ticket", "business", "other"}
FORMATS = {"none", "qr", "code128"}
SORTS = {"favorites_recent", "recent_used", "most_used", "expires_soon"}
DEFAULT_SORT = "favorites_recent"
MAX_IMAGE = 5 * 1024 * 1024
FIELDS = ("kind", "title", "issuer", "code", "code_format", "notes", "tags", "expires_at", "favorite", "archived", "person", "company", "role", "phone", "email", "website", "address")


def _db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def _init():
    os.makedirs(UPLOADS, exist_ok=True)
    with _db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
            title TEXT NOT NULL, issuer TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '',
            code_format TEXT NOT NULL DEFAULT 'none', notes TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '',
            favorite INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
            person TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '',
            role TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
            email TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
            address TEXT NOT NULL DEFAULT '', front_image TEXT NOT NULL DEFAULT '',
            back_image TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 0, last_used_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_cardbox_user ON items(user_id, archived, kind, updated_at);
        CREATE TABLE IF NOT EXISTS sort_preferences (
            user_id TEXT NOT NULL, category TEXT NOT NULL, sort TEXT NOT NULL,
            PRIMARY KEY (user_id, category)
        );
        """)
        columns = {row[1] for row in c.execute("PRAGMA table_info(items)")}
        if "use_count" not in columns:
            c.execute("ALTER TABLE items ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0")
        if "last_used_at" not in columns:
            c.execute("ALTER TABLE items ADD COLUMN last_used_at TEXT NOT NULL DEFAULT ''")


_init()


def _me(token):
    hub = sys.modules.get("backend.apphub")
    return hub.get_pub_session(token) if hub and token else None


def _error(message, status=400):
    return JSONResponse({"error": message}, status_code=status)


def _one(c, user_id, item_id):
    return c.execute("SELECT * FROM items WHERE id=? AND user_id=?", (item_id, user_id)).fetchone()


def _public(row):
    d = dict(row)
    d.pop("user_id", None)
    d["favorite"] = bool(d["favorite"])
    d["archived"] = bool(d["archived"])
    d["images"] = {side: bool(d.pop(side + "_image")) for side in ("front", "back")}
    return d


def _clean(data, partial=False):
    if not isinstance(data, dict):
        raise ValueError("invalid item")
    out = {}
    for key in FIELDS:
        if key not in data:
            continue
        value = data[key]
        if key in ("favorite", "archived"):
            if not isinstance(value, bool):
                raise ValueError("invalid " + key)
            out[key] = int(value)
            continue
        if not isinstance(value, str):
            raise ValueError("invalid " + key)
        value = value.strip()
        if len(value) > (4000 if key == "notes" else 512):
            raise ValueError(key + " is too long")
        if key == "kind" and value not in KINDS:
            raise ValueError("invalid kind")
        if key == "code_format" and value not in FORMATS:
            raise ValueError("invalid code format")
        if key == "expires_at" and value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError:
                raise ValueError("invalid expiration date")
        if key == "email" and value and ("@" not in value or "\n" in value):
            raise ValueError("invalid email")
        if key == "website" and value and not re.match(r"^https?://[^\s]+$", value, re.I):
            raise ValueError("website must start with http:// or https://")
        out[key] = value
    if not partial:
        out.setdefault("kind", "other")
        if not out.get("title"):
            out["title"] = "Business card" if out["kind"] == "business" else "Saved item"
        out.setdefault("code_format", "none")
    elif "title" in out and not out["title"]:
        raise ValueError("title cannot be empty")
    return out


def list_items(user_id, query="", kind="", archived=False):
    if kind and kind not in KINDS:
        raise ValueError("invalid kind")
    with _db() as c:
        sort = _sort_for(c, user_id, kind)
        order = {
            "favorites_recent": "favorite DESC, updated_at DESC, id DESC",
            "recent_used": "CASE WHEN last_used_at='' THEN 1 ELSE 0 END, last_used_at DESC, favorite DESC, updated_at DESC, id DESC",
            "most_used": "use_count DESC, last_used_at DESC, favorite DESC, updated_at DESC, id DESC",
            "expires_soon": "CASE WHEN expires_at='' THEN 2 WHEN expires_at < date('now') THEN 1 ELSE 0 END, CASE WHEN expires_at >= date('now') THEN expires_at END ASC, CASE WHEN expires_at < date('now') THEN expires_at END DESC, favorite DESC, updated_at DESC, id DESC",
        }[sort]
        rows = c.execute("SELECT * FROM items WHERE user_id=? AND archived=?" + (" AND kind=?" if kind else "") + " ORDER BY " + order, (user_id, int(archived), kind) if kind else (user_id, int(archived))).fetchall()
    q = query.strip().casefold()[:100]
    return [_public(r) for r in rows if not q or any(q in str(r[k]).casefold() for k in ("title", "issuer", "code", "tags", "notes", "person", "company", "phone", "email"))]


def _sort_for(c, user_id, kind=""):
    keys = (kind, "all") if kind else ("all",)
    rows = c.execute("SELECT category, sort FROM sort_preferences WHERE user_id=? AND category IN (" + ",".join("?" for _ in keys) + ")", (user_id, *keys)).fetchall()
    saved = {r["category"]: r["sort"] for r in rows}
    return saved.get(kind) or saved.get("all") or DEFAULT_SORT


def get_sort_settings(user_id):
    with _db() as c:
        rows = c.execute("SELECT category, sort FROM sort_preferences WHERE user_id=?", (user_id,)).fetchall()
    saved = {r["category"]: r["sort"] for r in rows}
    return {"general": saved.pop("all", DEFAULT_SORT), "categories": saved}


def set_sort_setting(user_id, category, sort):
    if category != "all" and category not in KINDS:
        raise ValueError("invalid category")
    if sort != "inherit" and sort not in SORTS:
        raise ValueError("invalid sort")
    if category == "all" and sort == "inherit":
        raise ValueError("general sort cannot inherit")
    with _db() as c:
        if sort == "inherit":
            c.execute("DELETE FROM sort_preferences WHERE user_id=? AND category=?", (user_id, category))
        else:
            c.execute("INSERT INTO sort_preferences(user_id, category, sort) VALUES(?,?,?) ON CONFLICT(user_id, category) DO UPDATE SET sort=excluded.sort", (user_id, category, sort))
    return get_sort_settings(user_id)


def record_use(user_id, item_id):
    with _db() as c:
        if not _one(c, user_id, item_id):
            raise LookupError("item not found")
        c.execute("UPDATE items SET use_count=use_count+1, last_used_at=? WHERE id=? AND user_id=?", (datetime.now(timezone.utc).isoformat(), item_id, user_id))
    return get_item(user_id, item_id)


def get_item(user_id, item_id):
    with _db() as c:
        row = _one(c, user_id, item_id)
    if not row:
        raise LookupError("item not found")
    return _public(row)


def create_item(user_id, data):
    values = _clean(data)
    now = datetime.now(timezone.utc).isoformat()
    item_id = uuid.uuid4().hex
    columns = ["id", "user_id", "created_at", "updated_at"] + list(values)
    params = [item_id, user_id, now, now] + list(values.values())
    with _db() as c:
        c.execute("INSERT INTO items (" + ",".join(columns) + ") VALUES (" + ",".join("?" for _ in columns) + ")", params)
    return get_item(user_id, item_id)


def update_item(user_id, item_id, data):
    values = _clean(data, partial=True)
    with _db() as c:
        if not _one(c, user_id, item_id):
            raise LookupError("item not found")
        if values:
            values["updated_at"] = datetime.now(timezone.utc).isoformat()
            c.execute("UPDATE items SET " + ",".join(k + "=?" for k in values) + " WHERE id=? AND user_id=?", list(values.values()) + [item_id, user_id])
    return get_item(user_id, item_id)


def delete_item(user_id, item_id):
    with _db() as c:
        row = _one(c, user_id, item_id)
        if not row:
            raise LookupError("item not found")
        c.execute("DELETE FROM items WHERE id=? AND user_id=?", (item_id, user_id))
    for side in ("front", "back"):
        if row[side + "_image"]:
            try:
                os.remove(os.path.join(UPLOADS, row[side + "_image"]))
            except FileNotFoundError:
                pass
    return {"ok": True}


def _image_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    raise ValueError("use PNG, JPEG or WebP image")


def set_image(user_id, item_id, side, data):
    if side not in ("front", "back"):
        raise ValueError("invalid side")
    if not data or len(data) > MAX_IMAGE:
        raise ValueError("image must be at most 5 MB")
    ext, _ = _image_type(data)
    name = uuid.uuid4().hex + "." + ext
    path = os.path.join(UPLOADS, name)
    with _db() as c:
        row = _one(c, user_id, item_id)
        if not row:
            raise LookupError("item not found")
        with open(path, "wb") as f:
            f.write(data)
        c.execute("UPDATE items SET " + side + "_image=?, updated_at=? WHERE id=? AND user_id=?", (name, datetime.now(timezone.utc).isoformat(), item_id, user_id))
    if row[side + "_image"]:
        try:
            os.remove(os.path.join(UPLOADS, row[side + "_image"]))
        except FileNotFoundError:
            pass
    return get_item(user_id, item_id)


def set_image_base64(user_id, item_id, side, image_base64):
    if not isinstance(image_base64, str) or len(image_base64) > MAX_IMAGE * 2:
        raise ValueError("invalid image")
    try:
        data = base64.b64decode(image_base64.split(",", 1)[-1], validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("invalid base64 image")
    return set_image(user_id, item_id, side, data)


def get_image_base64(user_id, item_id, side):
    if side not in ("front", "back"):
        raise ValueError("invalid side")
    with _db() as c:
        row = _one(c, user_id, item_id)
    if not row or not row[side + "_image"]:
        raise LookupError("image not found")
    with open(os.path.join(UPLOADS, row[side + "_image"]), "rb") as f:
        data = f.read()
    _, mime = _image_type(data)
    return {"mime_type": mime, "image_base64": base64.b64encode(data).decode("ascii")}


def remove_image(user_id, item_id, side):
    if side not in ("front", "back"):
        raise ValueError("invalid side")
    with _db() as c:
        row = _one(c, user_id, item_id)
        if not row:
            raise LookupError("item not found")
        c.execute("UPDATE items SET " + side + "_image='' WHERE id=? AND user_id=?", (item_id, user_id))
    if row[side + "_image"]:
        try:
            os.remove(os.path.join(UPLOADS, row[side + "_image"]))
        except FileNotFoundError:
            pass
    return get_item(user_id, item_id)


class ItemBody(BaseModel):
    data: dict


class SortBody(BaseModel):
    category: str
    sort: str


@router.get("/")
async def index():
    hub = sys.modules.get("backend.apphub")
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Cardbox", "🎟️")
    return FileResponse(os.path.join(ROOT, "public", "index.html"))


@router.get("/items")
async def list_route(q: str = "", kind: str = "", archived: bool = False, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(list_items(me["id"], q, kind, archived))
    except ValueError as e: return _error(str(e))


@router.get("/settings/sort")
async def sort_settings_route(x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    return JSONResponse(get_sort_settings(me["id"]))


@router.put("/settings/sort")
async def set_sort_route(body: SortBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(set_sort_setting(me["id"], body.category, body.sort))
    except ValueError as e: return _error(str(e))


@router.get("/items/{item_id}")
async def get_route(item_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(get_item(me["id"], item_id))
    except LookupError as e: return _error(str(e), 404)


@router.post("/items/{item_id}/use")
async def use_route(item_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(record_use(me["id"], item_id))
    except LookupError as e: return _error(str(e), 404)


@router.post("/items")
async def create_route(body: ItemBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(create_item(me["id"], body.data))
    except ValueError as e: return _error(str(e))


@router.put("/items/{item_id}")
async def update_route(item_id: str, body: ItemBody, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(update_item(me["id"], item_id, body.data))
    except ValueError as e: return _error(str(e))
    except LookupError as e: return _error(str(e), 404)


@router.delete("/items/{item_id}")
async def delete_route(item_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(delete_item(me["id"], item_id))
    except LookupError as e: return _error(str(e), 404)


@router.post("/items/{item_id}/images/{side}")
async def image_route(item_id: str, side: str, image: UploadFile = File(...), x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    data = await image.read(MAX_IMAGE + 1)
    try: return JSONResponse(set_image(me["id"], item_id, side, data))
    except ValueError as e: return _error(str(e))
    except LookupError as e: return _error(str(e), 404)


@router.get("/items/{item_id}/images/{side}")
async def image_get_route(item_id: str, side: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    if side not in ("front", "back"): return _error("invalid side")
    with _db() as c: row = _one(c, me["id"], item_id)
    if not row or not row[side + "_image"]: return _error("image not found", 404)
    name = row[side + "_image"]
    with open(os.path.join(UPLOADS, name), "rb") as f:
        _, mime = _image_type(f.read(16))
    return FileResponse(os.path.join(UPLOADS, name), media_type=mime, headers={"Cache-Control": "private, no-store"})


@router.delete("/items/{item_id}/images/{side}")
async def image_delete_route(item_id: str, side: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me: return _error("unauthorized", 401)
    try: return JSONResponse(remove_image(me["id"], item_id, side))
    except ValueError as e: return _error(str(e))
    except LookupError as e: return _error(str(e), 404)
