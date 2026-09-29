"""Hattrick Calculator - each manager's squad and team settings.

Every player and the team's settings (training, lineup, arena) are kept against
the Apps Hub profile that saved them, in the app's own
apps/hattrickcalculator/data.db (a runtime database, never packaged). The token
in the request says whose they are; nobody can read or change another
manager's.

The page does all the arithmetic, so a player is stored as the JSON the page
sends; only its name is lifted into a column, to keep the squad in order.

Everything the page could read from each of the manager's Hattrick pages is
kept too, the latest read of every page, whether the calculator uses it yet or
not: what is there to work with is known before a feature needs it.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

_DIR = os.path.dirname(os.path.realpath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")

_MAX_PLAYER = 32 * 1024
_MAX_TEAM = 32 * 1024
_MAX_PLAYERS = 200
_MAX_PAGE = 512 * 1024
_PAGE_KINDS = {"players", "training", "stadium", "fans", "youth", "youthtraining", "match", "analysis"}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_htc_players ON players(player_id);
CREATE TABLE IF NOT EXISTS teams (
    player_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pages (
    player_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, kind)
);
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
    """The Apps Hub account behind the request (the manager, not a footballer)."""
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-Pub-Token", "") or request.headers.get("X-GH-Token", "")
    user = hub.get_pub_session(token) if hub else None
    return str(user["id"]) if user else None


def _load(blob):
    try:
        data = json.loads(blob)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _row(r) -> dict:
    return {"id": r["id"], "data": _load(r["data"]), "created_at": r["created_at"], "updated_at": r["updated_at"]}


def _list(conn, pid):
    rows = conn.execute("SELECT * FROM players WHERE player_id=? ORDER BY name COLLATE NOCASE, id", (pid,)).fetchall()
    return [_row(r) for r in rows]


async def _body(request: Request):
    try:
        body = await request.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


@router.get("/state")
def get_state(request: Request):
    """Everything the page needs at once: the squad and the team settings."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        team = conn.execute("SELECT data FROM teams WHERE player_id=?", (pid,)).fetchone()
        return JSONResponse({"players": _list(conn, pid), "team": _load(team["data"]) if team else {}})
    finally:
        conn.close()


@router.post("/players")
async def save_player(request: Request):
    """Create a player, or update one of the caller's own when it carries an id."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data = body.get("data") if body else None
    if not isinstance(data, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    name = str(data.get("name", "")).strip()[:60]
    if not name:
        return JSONResponse({"error": "invalid"}, status_code=400)
    data["name"] = name
    blob = json.dumps(data, separators=(",", ":"))
    if len(blob) > _MAX_PLAYER:
        return JSONResponse({"error": "too_large"}, status_code=413)

    now = datetime.now(timezone.utc).isoformat()
    player_id = body.get("id")
    conn = _connect()
    try:
        with conn:
            if player_id is not None:
                cur = conn.execute(
                    "UPDATE players SET name=?, data=?, updated_at=? WHERE id=? AND player_id=?",
                    (name, blob, now, int(player_id), pid),
                )
                if cur.rowcount == 0:
                    return JSONResponse({"error": "not_found"}, status_code=404)
                new_id = int(player_id)
            else:
                count = conn.execute("SELECT COUNT(*) FROM players WHERE player_id=?", (pid,)).fetchone()[0]
                if count >= _MAX_PLAYERS:
                    return JSONResponse({"error": "too_many"}, status_code=400)
                cur = conn.execute(
                    "INSERT INTO players(player_id, name, data, created_at, updated_at) VALUES(?,?,?,?,?)",
                    (pid, name, blob, now, now),
                )
                new_id = cur.lastrowid
        r = conn.execute("SELECT * FROM players WHERE id=?", (new_id,)).fetchone()
        return JSONResponse({"player": _row(r)})
    except (TypeError, ValueError):
        return JSONResponse({"error": "invalid"}, status_code=400)
    finally:
        conn.close()


@router.delete("/players/{player_id}")
def delete_player(player_id: int, request: Request):
    """A sold or released player simply leaves the squad."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        with conn:
            cur = conn.execute("DELETE FROM players WHERE id=? AND player_id=?", (player_id, pid))
        if cur.rowcount == 0:
            return JSONResponse({"error": "not_found"}, status_code=404)
        return JSONResponse({"ok": True})
    finally:
        conn.close()


@router.post("/team")
async def save_team(request: Request):
    """The team settings: training, lineup choices and the arena."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data = body.get("data") if body else None
    if not isinstance(data, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    blob = json.dumps(data, separators=(",", ":"))
    if len(blob) > _MAX_TEAM:
        return JSONResponse({"error": "too_large"}, status_code=413)
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "INSERT INTO teams(player_id, data, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(player_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (pid, blob, now),
            )
        return JSONResponse({"ok": True})
    finally:
        conn.close()


@router.get("/pages")
def get_pages(request: Request):
    """The latest read of each Hattrick page, by kind."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    conn = _connect()
    try:
        rows = conn.execute("SELECT kind, data, updated_at FROM pages WHERE player_id=?", (pid,)).fetchall()
        return JSONResponse({r["kind"]: {"data": _load(r["data"]), "updated_at": r["updated_at"]} for r in rows})
    finally:
        conn.close()


@router.post("/pages/{kind}")
async def save_page(kind: str, request: Request):
    """What was read from one Hattrick page, replacing the previous read."""
    pid = _player(request)
    if not pid:
        return JSONResponse({"error": "signin"}, status_code=401)
    if kind not in _PAGE_KINDS:
        return JSONResponse({"error": "invalid"}, status_code=400)
    body = await _body(request)
    data = body.get("data") if body else None
    if not isinstance(data, dict):
        return JSONResponse({"error": "invalid"}, status_code=400)
    blob = json.dumps(data, separators=(",", ":"))
    if len(blob) > _MAX_PAGE:
        return JSONResponse({"error": "too_large"}, status_code=413)
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "INSERT INTO pages(player_id, kind, data, updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(player_id, kind) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                (pid, kind, blob, now),
            )
        return JSONResponse({"ok": True})
    finally:
        conn.close()
