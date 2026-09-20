"""Score Arena's own statistics.

Game Hub is told who played and what the points were when a match ends, and
nothing more. Everything the statistics screens and the Ghost learn from lives
here, in apps/scorearena/data.db (a runtime database, never packaged).
"""
import json
import os
import sqlite3
from datetime import datetime, timezone

_DIR = os.path.dirname(os.path.realpath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")
# Only used by import_from_hub(): the database Game Hub kept Score Arena's
# matches in before the app had statistics of its own.
_HUB_DB_PATH = os.path.realpath(os.path.join(_DIR, "..", "..", "backend", "apps", "gamehub", "data.db"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    played_at TEXT NOT NULL,
    mode TEXT NOT NULL,
    owner TEXT,
    metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_sa_players ON match_players(player_id, match_id DESC);
CREATE INDEX IF NOT EXISTS idx_sa_owner ON matches(owner, id DESC);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def _connect():
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(_SCHEMA)
    return conn


def _owner_of(metadata: dict):
    custom = metadata.get("scorearena_custom")
    if isinstance(custom, dict) and custom.get("owner_id") is not None:
        return str(custom["owner_id"])
    return None


def _insert(conn, played_at: str, mode: str, player_ids, metadata: dict):
    cur = conn.execute(
        "INSERT INTO matches(played_at, mode, owner, metadata) VALUES(?,?,?,?)",
        (played_at, mode, _owner_of(metadata), json.dumps(metadata)),
    )
    conn.executemany(
        "INSERT OR IGNORE INTO match_players(match_id, player_id) VALUES(?,?)",
        [(cur.lastrowid, str(p)) for p in set(player_ids) if p],
    )


def record(mode: str, player_ids, metadata: dict):
    """Keep one finished match: who took part and every number about it."""
    conn = _connect()
    try:
        with conn:
            _insert(conn, datetime.now(timezone.utc).isoformat(), mode, player_ids, metadata)
    finally:
        conn.close()


def history(player_id: str) -> list:
    """Every match the player took part in, plus matches played by rules the
    player authored, newest first. Each entry has the shape the statistics
    screens have always read: a session whose metadata is a JSON string."""
    pid = str(player_id)
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT id, played_at, metadata FROM matches
               WHERE id IN (SELECT match_id FROM match_players WHERE player_id=?) OR owner=?
               ORDER BY id DESC""",
            (pid, pid),
        ).fetchall()
        return [{"id": r["id"], "game_id": "scorearena", "played_at": r["played_at"],
                 "metadata": r["metadata"]} for r in rows]
    finally:
        conn.close()


def recent_metadata(player_id: str, limit: int) -> list:
    """Metadata (JSON strings) of the player's latest matches, newest first."""
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT m.metadata FROM matches m JOIN match_players p ON p.match_id = m.id
               WHERE p.player_id=? ORDER BY m.id DESC LIMIT ?""",
            (str(player_id), int(limit)),
        ).fetchall()
        return [r["metadata"] for r in rows]
    finally:
        conn.close()


def import_from_hub() -> int:
    """One-time move of the matches Game Hub kept for Score Arena before it had
    statistics of its own. Returns how many were moved, or -1 if it could not
    run this time (it is then tried again next time).

    This has to be called from the game side, never from api.py: an app's
    routes are confined to their own folder and may not open Game Hub's files.
    """
    conn = _connect()
    try:
        if conn.execute("SELECT 1 FROM meta WHERE key='hub_import'").fetchone():
            return 0
        moved = 0
        if os.path.isfile(_HUB_DB_PATH):
            hub = sqlite3.connect(f"file:{_HUB_DB_PATH}?mode=ro", uri=True, timeout=5)
            hub.row_factory = sqlite3.Row
            try:
                sessions = hub.execute(
                    "SELECT id, played_at, metadata FROM game_sessions WHERE game_id='scorearena' "
                    "ORDER BY played_at, id").fetchall()
                with conn:
                    for s in sessions:
                        try:
                            meta = json.loads(s["metadata"] or "{}")
                        except Exception:
                            meta = {}
                        if not isinstance(meta, dict):
                            meta = {}
                        meta.pop("turn_history", None)
                        ids = {str(r[0]) for r in hub.execute(
                            "SELECT player_id FROM session_players WHERE session_id=? AND player_id IS NOT NULL",
                            (s["id"],))}
                        ids |= {str(k) for k in (meta.get("player_stats") or {})}
                        _insert(conn, s["played_at"], meta.get("scorearena_mode") or "501", ids, meta)
                        moved += 1
                    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('hub_import', ?)", (str(moved),))
            finally:
                hub.close()
        else:
            with conn:
                conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('hub_import', '0')")
        return moved
    except Exception as e:
        print(f"[scorearena] history import failed: {e}")
        return -1
    finally:
        conn.close()
