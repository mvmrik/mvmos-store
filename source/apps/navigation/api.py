"""
mvmOS Navigation — saved places and trip history per Apps Hub account and the Google Maps key.

Mounted at /pub/navigation. Identity is the Apps Hub token (X-Pub-Token),
used identically by the desktop window and the public page. The map, the
search and the routes are fetched by the browser straight from Google with
the owner's key, so the only data kept here is each profile's saved places and the history of its trips.
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
MAX_TRIPS = 200
ACTIVE_TTL_MS = 24 * 3600 * 1000   # an unfinished trip is forgotten a day after its last update
MAX_ACTIVE_BYTES = 600_000


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
    conn.execute("""CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        stops TEXT NOT NULL DEFAULT '[]',
        started INTEGER NOT NULL,
        ended INTEGER,
        status TEXT NOT NULL DEFAULT 'started')""")
    conn.execute("CREATE INDEX IF NOT EXISTS trips_user ON trips (user_id, started)")
    conn.execute("""CREATE TABLE IF NOT EXISTS active_trip (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated INTEGER NOT NULL)""")
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
    """The browser needs the key to load the map; it is only given to a signed-in profile.
    The key is the profile's own Google Maps key or the one the administrator shares
    with it for this app (Apps Hub -> API keys), never a setting of this app."""
    me, err = _gate(x_pub_token)
    if err:
        return err
    hub = _hub()
    res = hub.resolve_service_key(me["id"], "google_maps", APP_ID) if hub and hasattr(hub, "resolve_service_key") else {"key": "", "source": ""}
    map_id = ""
    with _db() as c:
        row = c.execute("SELECT value FROM cfg WHERE key=?", ("map_id",)).fetchone()
        if row:
            try:
                map_id = json.loads(row["value"])
            except Exception:
                map_id = row["value"] or ""
    return JSONResponse({"api_key": res["key"], "key_source": res["source"], "map_id": str(map_id or "").strip()})


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


# ── Trip history ─────────────────────────────────────────────────────────

def _trip_out(r):
    try:
        stops = json.loads(r["stops"] or "[]")
    except Exception:
        stops = []
    return {"id": r["id"], "name": r["name"], "address": r["address"], "lat": r["lat"], "lng": r["lng"],
            "stops": stops, "started": r["started"], "ended": r["ended"], "status": r["status"]}


class StopBody(BaseModel):
    name: str = ""
    lat: float
    lng: float


class TripBody(BaseModel):
    name: str
    address: str = ""
    lat: float
    lng: float
    stops: list[StopBody] = []


@router.get("/history")
async def list_history(x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        rows = c.execute("SELECT * FROM trips WHERE user_id=? ORDER BY started DESC LIMIT ?", (me["id"], MAX_TRIPS)).fetchall()
    return JSONResponse({"trips": [_trip_out(r) for r in rows]})


@router.post("/history")
async def add_trip(body: TripBody, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    name = body.name.strip()[:80]
    if not name:
        return _bad("name_required")
    if not (-90 <= body.lat <= 90 and -180 <= body.lng <= 180):
        return _bad("invalid_position")
    stops = [{"name": s.name.strip()[:80], "lat": s.lat, "lng": s.lng} for s in body.stops[:25]
             if -90 <= s.lat <= 90 and -180 <= s.lng <= 180]
    tid = uuid.uuid4().hex[:12]
    with _db() as c:
        c.execute("INSERT INTO trips (id,user_id,name,address,lat,lng,stops,started) VALUES (?,?,?,?,?,?,?,?)",
                  (tid, me["id"], name, body.address.strip()[:200], body.lat, body.lng, json.dumps(stops), int(time.time() * 1000)))
        # Keep only the newest trips of this profile.
        c.execute("""DELETE FROM trips WHERE user_id=? AND id NOT IN
                     (SELECT id FROM trips WHERE user_id=? ORDER BY started DESC LIMIT ?)""", (me["id"], me["id"], MAX_TRIPS))
        c.commit()
        row = c.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone()
    return JSONResponse(_trip_out(row))


class TripEndBody(BaseModel):
    status: str


@router.put("/history/{trip_id}")
async def end_trip(trip_id: str, body: TripEndBody, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    if body.status not in ("arrived", "stopped"):
        return _bad("invalid_status")
    with _db() as c:
        cur = c.execute("UPDATE trips SET status=?, ended=? WHERE id=? AND user_id=? AND status='started'",
                        (body.status, int(time.time() * 1000), trip_id, me["id"]))
        c.commit()
        row = c.execute("SELECT * FROM trips WHERE id=? AND user_id=?", (trip_id, me["id"])).fetchone()
    if not row:
        return _bad("not_found", 404)
    return JSONResponse(_trip_out(row))


@router.delete("/history/{trip_id}")
async def delete_trip(trip_id: str, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        c.execute("DELETE FROM trips WHERE id=? AND user_id=?", (trip_id, me["id"]))
        c.commit()
    return JSONResponse({"ok": True})


@router.delete("/history")
async def clear_history(x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        c.execute("DELETE FROM trips WHERE user_id=?", (me["id"],))
        c.commit()
    return JSONResponse({"ok": True})



# ── Active trip (survives closing the browser) ───────────────────────────

class ActiveBody(BaseModel):
    data: dict


@router.get("/active")
async def get_active(x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    now = int(time.time() * 1000)
    with _db() as c:
        c.execute("DELETE FROM active_trip WHERE updated<?", (now - ACTIVE_TTL_MS,))
        row = c.execute("SELECT data, updated FROM active_trip WHERE user_id=?", (me["id"],)).fetchone()
        c.commit()
    if not row:
        return JSONResponse({"active": None})
    try:
        data = json.loads(row["data"])
    except Exception:
        return JSONResponse({"active": None})
    return JSONResponse({"active": data, "updated": row["updated"]})


@router.put("/active")
async def put_active(body: ActiveBody, x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    raw = json.dumps(body.data, separators=(",", ":"))
    if len(raw) > MAX_ACTIVE_BYTES:
        return _bad("too_large", 413)
    with _db() as c:
        c.execute("INSERT INTO active_trip (user_id,data,updated) VALUES (?,?,?) "
                  "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated=excluded.updated",
                  (me["id"], raw, int(time.time() * 1000)))
        c.commit()
    return JSONResponse({"ok": True})


@router.delete("/active")
async def delete_active(x_pub_token: str = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with _db() as c:
        c.execute("DELETE FROM active_trip WHERE user_id=?", (me["id"],))
        c.commit()
    return JSONResponse({"ok": True})
