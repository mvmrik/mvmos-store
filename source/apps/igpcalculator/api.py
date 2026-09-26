"""IGP Calculator - the races each player has prepared, and their drivers.

Every race and driver is kept against the Apps Hub profile that saved it, in
the app's own apps/igpcalculator/data.db (a runtime database, never packaged).
The token in the request says whose they are; nobody can read or change
another player's.
"""
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

_DIR = os.path.dirname(os.path.realpath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")

TRACKS = {
    "abu_dhabi", "australia", "austria", "azerbaijan", "bahrain", "belgium", "brazil",
    "canada", "china", "europe", "france", "germany", "great_britain",
    "hungary", "italy", "japan", "malaysia", "mexico", "monaco",
    "netherlands", "russia", "singapore", "spain", "turkey", "usa",
}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COUNTRY = re.compile(r"^[A-Z]{2}$")
ABILITIES = {"racecraft", "qualifying", "street", "wet"}
TIERS = {"common", "rare", "legendary"}
_MAX_DATA = 64 * 1024

_SCHEMA = """
CREATE TABLE IF NOT EXISTS races (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    track TEXT NOT NULL,
    race_date TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_igp_player ON races(player_id, race_date DESC, id DESC);
CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT '',
    fav_track TEXT NOT NULL DEFAULT '',
    talent INTEGER,
    ability TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT '',
    car INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_igp_drivers ON drivers(player_id);
"""

router = APIRouter()


def _connect():
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(_SCHEMA)
    return conn


def _player(request: Request):
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-Pub-Token", "") or request.headers.get("X-GH-Token", "")
    user = hub.get_pub_session(token) if hub else None
    return str(user["id"]) if user else None


def _row(r) -> dict:
    try:
        data = json.loads(r["data"])
    except Exception:
        data = {}
    return {"id": r["id"], "track": r["track"], "race_date": r["race_date"],
            "data": data, "updated_at": r["updated_at"]}


@router.get("/races")
def list_races(request: Request):
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT * FROM races WHERE player_id=? ORDER BY race_date DESC, id DESC", (pid,)
        ).fetchall()
        return JSONResponse({"races": [_row(r) for r in rows]})
    finally:
        conn.close()


@router.post("/races")
async def save_race(request: Request):
    """Create a race, or update one of the caller's own when it carries an id."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    track = str(body.get("track", ""))
    race_date = str(body.get("race_date", ""))
    data = body.get("data")
    if track not in TRACKS or not _DATE.match(race_date) or not isinstance(data, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    try:
        datetime.strptime(race_date, "%Y-%m-%d")
    except ValueError:
        return JSONResponse({"error": "invalid"}, status_code=400)
    blob = json.dumps(data, separators=(",", ":"))
    if len(blob) > _MAX_DATA:
        return JSONResponse({"error": "too_large"}, status_code=413)

    now = datetime.now(timezone.utc).isoformat()
    race_id = body.get("id")
    conn = _connect()
    try:
        with conn:
            if race_id is not None:
                cur = conn.execute(
                    "UPDATE races SET track=?, race_date=?, data=?, updated_at=? WHERE id=? AND player_id=?",
                    (track, race_date, blob, now, int(race_id), pid),
                )
                if cur.rowcount == 0:
                    return JSONResponse({"error": "not_found"}, status_code=404)
                new_id = int(race_id)
            else:
                cur = conn.execute(
                    "INSERT INTO races(player_id, track, race_date, data, created_at, updated_at) VALUES(?,?,?,?,?,?)",
                    (pid, track, race_date, blob, now, now),
                )
                new_id = cur.lastrowid
        r = conn.execute("SELECT * FROM races WHERE id=?", (new_id,)).fetchone()
        return JSONResponse({"race": _row(r)})
    except (TypeError, ValueError):
        return JSONResponse({"error": "invalid"}, status_code=400)
    finally:
        conn.close()


@router.delete("/races/{race_id}")
def delete_race(race_id: int, request: Request):
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        with conn:
            cur = conn.execute("DELETE FROM races WHERE id=? AND player_id=?", (race_id, pid))
        if cur.rowcount == 0:
            return JSONResponse({"error": "not_found"}, status_code=404)
        return JSONResponse({"ok": True})
    finally:
        conn.close()


# ── Drivers ─────────────────────────────────────────────────────────────────
# Only what stays put: name, country, favourite track, talent and the special
# ability. `car` is the seat the driver holds right now (1, 2 or none); a new
# race takes its drivers from here, and each race keeps its own copy.

def _driver_row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "country": r["country"], "fav_track": r["fav_track"],
            "talent": r["talent"], "ability": r["ability"], "tier": r["tier"], "car": r["car"]}


def _clean_driver(body: dict):
    name = str(body.get("name", "")).strip()[:40]
    country = str(body.get("country") or "").upper()
    fav = str(body.get("fav_track") or "")
    ability = str(body.get("ability") or "")
    tier = str(body.get("tier") or "")
    talent = body.get("talent")
    car = body.get("car")
    if not name or (country and not _COUNTRY.match(country)) or (fav and fav not in TRACKS):
        return None
    if ability and ability not in ABILITIES:
        return None
    if ability:
        tier = tier if tier in TIERS else "common"
    else:
        tier = ""
    if talent is not None and talent != "":
        try:
            talent = int(talent)
        except (TypeError, ValueError):
            return None
        if not 1 <= talent <= 100:
            return None
    else:
        talent = None
    if car not in (None, 1, 2):
        return None
    return {"name": name, "country": country, "fav_track": fav, "talent": talent,
            "ability": ability, "tier": tier, "car": car}


def _list_drivers(conn, pid):
    rows = conn.execute("SELECT * FROM drivers WHERE player_id=? ORDER BY name COLLATE NOCASE, id", (pid,)).fetchall()
    return [_driver_row(r) for r in rows]


@router.get("/drivers")
def list_drivers(request: Request):
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        return JSONResponse({"drivers": _list_drivers(conn, pid)})
    finally:
        conn.close()


@router.post("/drivers")
async def save_driver(request: Request):
    """Create a driver, or update one of the caller's own when it carries an id.
    Putting a driver in a car takes that car away from whoever held it.
    Answers with the whole list, since a seat change touches two drivers."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid"}, status_code=400)
    if not isinstance(body, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    d = _clean_driver(body)
    if d is None:
        return JSONResponse({"error": "invalid"}, status_code=400)
    now = datetime.now(timezone.utc).isoformat()
    driver_id = body.get("id")
    conn = _connect()
    try:
        with conn:
            if d["car"] is not None:
                conn.execute("UPDATE drivers SET car=NULL WHERE player_id=? AND car=?", (pid, d["car"]))
            if driver_id is not None:
                cur = conn.execute(
                    "UPDATE drivers SET name=?, country=?, fav_track=?, talent=?, ability=?, tier=?, car=?, updated_at=? "
                    "WHERE id=? AND player_id=?",
                    (d["name"], d["country"], d["fav_track"], d["talent"], d["ability"], d["tier"], d["car"], now,
                     int(driver_id), pid),
                )
                if cur.rowcount == 0:
                    raise LookupError
                new_id = int(driver_id)
            else:
                cur = conn.execute(
                    "INSERT INTO drivers(player_id, name, country, fav_track, talent, ability, tier, car, created_at, updated_at) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (pid, d["name"], d["country"], d["fav_track"], d["talent"], d["ability"], d["tier"], d["car"], now, now),
                )
                new_id = cur.lastrowid
        return JSONResponse({"id": new_id, "drivers": _list_drivers(conn, pid)})
    except LookupError:
        return JSONResponse({"error": "not_found"}, status_code=404)
    except (TypeError, ValueError):
        return JSONResponse({"error": "invalid"}, status_code=400)
    finally:
        conn.close()


@router.post("/drivers/seats")
async def set_seats(request: Request):
    """Who drives car 1 and car 2: {"1": driver_id|null, "2": driver_id|null}."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    try:
        body = await request.json()
        seats = {car: (None if body.get(str(car)) in (None, "") else int(body.get(str(car)))) for car in (1, 2)}
    except Exception:
        return JSONResponse({"error": "invalid"}, status_code=400)
    if seats[1] is not None and seats[1] == seats[2]:
        return JSONResponse({"error": "invalid"}, status_code=400)
    conn = _connect()
    try:
        with conn:
            conn.execute("UPDATE drivers SET car=NULL WHERE player_id=?", (pid,))
            for car, did in seats.items():
                if did is not None:
                    conn.execute("UPDATE drivers SET car=? WHERE id=? AND player_id=?", (car, did, pid))
        return JSONResponse({"drivers": _list_drivers(conn, pid)})
    finally:
        conn.close()


@router.delete("/drivers/{driver_id}")
def delete_driver(driver_id: int, request: Request):
    """Races keep the driver's name, so deleting a driver leaves history intact."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        with conn:
            cur = conn.execute("DELETE FROM drivers WHERE id=? AND player_id=?", (driver_id, pid))
        if cur.rowcount == 0:
            return JSONResponse({"error": "not_found"}, status_code=404)
        return JSONResponse({"drivers": _list_drivers(conn, pid)})
    finally:
        conn.close()
