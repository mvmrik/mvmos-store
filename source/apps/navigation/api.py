"""
mvmOS Navigation — saved places per Apps Hub account and the Google Maps key.

Mounted at /pub/navigation. Identity is the Apps Hub token (X-Pub-Token),
used identically by the desktop window and the public page. The map, the
search and the routes are fetched by the browser straight from Google with
the owner's key, so the only data kept here is each profile's saved places.
"""
import json
import os
import sqlite3
import sys
import time
import uuid

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "navigation"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
MAX_PLACES = 500


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("""CREATE TABLE IF NOT EXISTS places (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        created INTEGER NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS places_user ON places (user_id)")
    return conn


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _gate(token):
    """Return (user, error response). Every route calls this first."""
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return None, _bad("private", 403)
    me = _me(token)
    if not me:
        return None, _bad("unauthorized", 401)
    return me, None


def _out(r):
    return {"id": r["id"], "name": r["name"], "address": r["address"], "lat": r["lat"], "lng": r["lng"]}


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Navigation", "🧭")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/config")
async def get_config(x_pub_token: str = Header(default=None)):
    """The browser needs the key to load the map; it is only given to a signed-in profile."""
    me, err = _gate(x_pub_token)
    if err:
        return err
    out = {}
    with _db() as c:
        for k in ("api_key", "map_id"):
            row = c.execute("SELECT value FROM cfg WHERE key=?", (k,)).fetchone()
            v = ""
            if row:
                try:
                    v = json.loads(row["value"])
                except Exception:
                    v = row["value"] or ""
            out[k] = str(v or "").strip()
    return JSONResponse(out)


@router.get("/places")
async def list_places(x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        rows = c.execute("SELECT * FROM places WHERE user_id=? ORDER BY created", (me["id"],)).fetchall()
    return JSONResponse({"places": [_out(r) for r in rows]})


class PlaceBody(BaseModel):
    name: str
    address: str = ""
    lat: float
    lng: float


@router.post("/places")
async def add_place(body: PlaceBody, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    name = body.name.strip()[:80]
    if not name:
        return _bad("name_required")
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        return _bad("invalid_position")
    with _db() as c:
        n = c.execute("SELECT COUNT(*) FROM places WHERE user_id=?", (me["id"],)).fetchone()[0]
        if n >= MAX_PLACES:
            return _bad("too_many_places")
        pid = uuid.uuid4().hex[:12]
        c.execute("INSERT INTO places (id,user_id,name,address,lat,lng,created) VALUES (?,?,?,?,?,?,?)",
                  (pid, me["id"], name, body.address.strip()[:200], body.lat, body.lng, int(time.time() * 1000)))
        c.commit()
        row = c.execute("SELECT * FROM places WHERE id=?", (pid,)).fetchone()
    return JSONResponse(_out(row))


class RenameBody(BaseModel):
    name: str


@router.put("/places/{place_id}")
async def rename_place(place_id: str, body: RenameBody, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    name = body.name.strip()[:80]
    if not name:
        return _bad("name_required")
    with _db() as c:
        cur = c.execute("UPDATE places SET name=? WHERE id=? AND user_id=?", (name, place_id, me["id"]))
        c.commit()
        if not cur.rowcount:
            return _bad("not_found", 404)
        row = c.execute("SELECT * FROM places WHERE id=?", (place_id,)).fetchone()
    return JSONResponse(_out(row))


@router.delete("/places/{place_id}")
async def delete_place(place_id: str, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        c.execute("DELETE FROM places WHERE id=? AND user_id=?", (place_id, me["id"]))
        c.commit()
    return JSONResponse({"ok": True})
