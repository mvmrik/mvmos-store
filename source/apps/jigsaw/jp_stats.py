"""Jigsaw's own record of finished puzzles.

Game Hub is told who played and what the points were when a game ends, and
nothing more. Which picture was built at which size, how fast and for how many
points lives here, in apps/jigsaw/data.db (a runtime database, never
packaged), so the picture gallery can show each player what they have done.
"""
import os
import sqlite3
from datetime import datetime, timezone

_DIR = os.path.dirname(os.path.realpath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL,
    image TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    points INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    hints INTEGER NOT NULL,
    played_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jp_player ON results(player_id, image, difficulty);
"""


def _connect():
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def record(player_id: str, image: str, difficulty: str, points: int, seconds: int, hints: int):
    """Keep one completed puzzle."""
    conn = _connect()
    try:
        with conn:
            conn.execute(
                "INSERT INTO results(player_id, image, difficulty, points, seconds, hints, played_at) VALUES(?,?,?,?,?,?,?)",
                (str(player_id), image, difficulty, int(points), int(seconds), int(hints),
                 datetime.now(timezone.utc).isoformat()),
            )
    finally:
        conn.close()


def best(player_id: str) -> dict:
    """The player's best result for every picture and size they have completed:
    {image: {difficulty: {points, seconds, hints, played_at, count}}}."""
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT image, difficulty, points, seconds, hints, played_at FROM results "
            "WHERE player_id=? ORDER BY points DESC, seconds ASC", (str(player_id),)).fetchall()
        counts = {(r["image"], r["difficulty"]): r["n"] for r in conn.execute(
            "SELECT image, difficulty, COUNT(*) AS n FROM results WHERE player_id=? GROUP BY image, difficulty",
            (str(player_id),))}
    finally:
        conn.close()
    out = {}
    for r in rows:
        level = out.setdefault(r["image"], {})
        if r["difficulty"] not in level:
            level[r["difficulty"]] = {"points": r["points"], "seconds": r["seconds"], "hints": r["hints"],
                                      "played_at": r["played_at"], "count": counts[(r["image"], r["difficulty"])]}
    return out
