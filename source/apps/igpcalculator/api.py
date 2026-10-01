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
    for table in ("drivers", "races"):
        columns = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if "igp_id" not in columns:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN igp_id INTEGER")
            except sqlite3.OperationalError:
                # Another request may have completed this migration first.
                if "igp_id" not in {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}:
                    raise
        conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS idx_igp_{table}_external ON {table}(player_id, igp_id)")
    conn.commit()
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
            "data": data, "updated_at": r["updated_at"], "igp_id": r["igp_id"]}


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
            "talent": r["talent"], "ability": r["ability"], "tier": r["tier"], "car": r["car"], "igp_id": r["igp_id"]}


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


@router.post("/import")
async def import_data(request: Request):
    """Apply one reviewed import atomically; external IDs are scoped to a profile.

    Unread fields are preserved. Historical drivers never take a current seat,
    and results merge by driver identity rather than by today's car number.
    """
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    try:
        body = await request.json()
        if not isinstance(body, dict) or len(json.dumps(body)) > 128 * 1024:
            raise ValueError
        imported = body.get("drivers", [])
        races = body.get("races", [])
        if not isinstance(imported, list) or not isinstance(races, list) or len(imported) > 10 or len(races) > 2:
            raise ValueError
        ids = [d["igp_id"] for d in imported]
        if any(type(i) is not int or i <= 0 for i in ids) or len(set(ids)) != len(ids):
            raise ValueError
    except (ValueError, TypeError, KeyError):
        return JSONResponse({"error": "invalid"}, status_code=400)
    conn = _connect()
    now = datetime.now(timezone.utc).isoformat()
    saved = []
    try:
        with conn:
            driver_ids = {}
            seats = {}
            for source in imported:
                existing = conn.execute("SELECT * FROM drivers WHERE player_id=? AND igp_id=?", (pid, source["igp_id"])).fetchone()
                # Attach an exact full-name match from an older manual record.
                if existing is None and " " in str(source.get("name", "")) and not re.match(r"^\w\s", str(source.get("name", ""))):
                    matches = conn.execute("SELECT * FROM drivers WHERE player_id=? AND igp_id IS NULL AND name=?", (pid, source.get("name"))).fetchall()
                    if len(matches) == 1:
                        existing = matches[0]
                merged = _driver_row(existing) if existing else {}
                merged.update({k: source[k] for k in ("name", "country", "fav_track", "talent", "ability", "tier") if k in source})
                d = _clean_driver(merged)
                if d is None:
                    raise ValueError
                if source.get("car") is not None:
                    car = source["car"]
                    if type(car) is not int or car not in (1, 2) or car in seats:
                        raise ValueError
                    seats[car] = source["igp_id"]
                values = (d["name"], d["country"], d["fav_track"], d["talent"], d["ability"], d["tier"])
                if existing:
                    did = existing["id"]
                    conn.execute("UPDATE drivers SET name=?,country=?,fav_track=?,talent=?,ability=?,tier=?,igp_id=?,updated_at=? WHERE id=? AND player_id=?",
                                 (*values, source["igp_id"], now, did, pid))
                else:
                    did = conn.execute("INSERT INTO drivers(player_id,name,country,fav_track,talent,ability,tier,igp_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                                       (pid, *values, source["igp_id"], now, now)).lastrowid
                driver_ids[source["igp_id"]] = did
            if seats:
                conn.execute("UPDATE drivers SET car=NULL WHERE player_id=?", (pid,))
                for car, external in seats.items():
                    conn.execute("UPDATE drivers SET car=? WHERE id=? AND player_id=?", (car, driver_ids[external], pid))
            seen = set()
            for source in races:
                eid = source.get("igpRaceId")
                if type(eid) is not int or eid <= 0 or eid in seen:
                    raise ValueError
                seen.add(eid)
                track, day = source.get("track"), source.get("race_date", "")
                if track not in TRACKS or not isinstance(day, str) or not _DATE.fullmatch(day):
                    raise ValueError
                datetime.strptime(day, "%Y-%m-%d")
                laps = source.get("laps")
                cars = source.get("cars")
                if type(laps) is not int or not 1 <= laps <= 200 or not isinstance(cars, list) or not 1 <= len(cars) <= 2:
                    raise ValueError
                existing = conn.execute("SELECT * FROM races WHERE player_id=? AND igp_id=?", (pid, eid)).fetchone()
                # A preview can explicitly link an existing manual race.
                if existing is None and source.get("id") is not None:
                    existing = conn.execute("SELECT * FROM races WHERE player_id=? AND id=? AND (igp_id IS NULL OR igp_id=?)", (pid, int(source["id"]), eid)).fetchone()
                    if existing is None:
                        raise ValueError
                data = json.loads(existing["data"]) if existing else {}
                data.update({"igpRaceId": eid, "laps": laps})
                data.setdefault("reserve", 1)
                data.setdefault("minLife", 50)
                data.setdefault("rain", False)
                old_cars = data.get("cars", [])
                combined = list(old_cars)
                car_ids = set()
                for source_car in cars:
                    external = source_car.get("igpDriverId")
                    did = driver_ids.get(external)
                    if not did or did in car_ids:
                        raise ValueError
                    car_ids.add(did)
                    driver = conn.execute("SELECT name FROM drivers WHERE id=? AND player_id=?", (did, pid)).fetchone()
                    index = next((i for i, c in enumerate(combined) if c.get("igpDriverId") == external or c.get("driver") == did), None)
                    car = dict(combined[index]) if index is not None else {}
                    car.update({"driver": did, "driverName": driver["name"], "igpDriverId": external})
                    for key in ("setup", "practice", "actual", "report", "position", "finish", "bestLap", "igpResultId"):
                        if key in source_car:
                            car[key] = source_car[key]
                    if source_car.get("setup"):
                        car["setupMissing"] = False
                    tyres = dict(car.get("tyres", {}))
                    for tyre, value in source_car.get("tyres", {}).items():
                        if tyre not in ("SS", "S", "M", "H", "I", "W") or not isinstance(value, dict):
                            raise ValueError
                        tyres[tyre] = {**tyres.get(tyre, {}), **value}
                    car["tyres"] = tyres
                    if index is None:
                        combined.append(car)
                    else:
                        combined[index] = car
                if len(combined) > 2:
                    raise ValueError  # Never silently replace a different driver's history.
                data["cars"] = combined
                blob = json.dumps(data, separators=(",", ":"))
                if len(blob) > _MAX_DATA:
                    raise ValueError
                if existing:
                    rid = existing["id"]
                    conn.execute("UPDATE races SET track=?,race_date=?,data=?,igp_id=?,updated_at=? WHERE id=? AND player_id=?", (track, day, blob, eid, now, rid, pid))
                else:
                    rid = conn.execute("INSERT INTO races(player_id,track,race_date,data,igp_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", (pid, track, day, blob, eid, now, now)).lastrowid
                saved.append(rid)
        return JSONResponse({"drivers": _list_drivers(conn, pid), "races": [_row(r) for r in conn.execute("SELECT * FROM races WHERE player_id=? ORDER BY race_date DESC,id DESC", (pid,))], "saved": saved})
    except (ValueError, TypeError, KeyError, AttributeError, sqlite3.IntegrityError):
        return JSONResponse({"error": "invalid"}, status_code=400)
    finally:
        conn.close()
