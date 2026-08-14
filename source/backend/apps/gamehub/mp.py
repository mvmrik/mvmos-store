"""
Game Hub — generic multiplayer framework.

This is the shared host for ALL multiplayer games. It owns everything that is
NOT game-specific:

  • rooms / sessions (create, lobby, start, finish)
  • WebSocket connections + heartbeat
  • player identity via Game Hub token (the token IS the reconnect key)
  • roster + automatic reconnect to the same slot
  • broadcast / send-to-one
  • invites (reuses the gamehub invites table)
  • recording the finished session into game_sessions

It knows NOTHING about rounds, guesses, scores, boards or any game rule.
A game plugs in only its logic, in  backend/apps/<game_id>/mp_game.py , which
must expose a class `Game(ctx)` with the async callbacks:

    on_start(settings)      host pressed Start — initialise game state
    on_join(player)         a player connected / reconnected — send them state
    on_leave(player)        a player disconnected
    on_message(player, msg) a move / action from a player (the game logic)

and may expose one optional method, which is what makes a solo run of it
continuable another day:

    snapshot() -> dict      whatever the SERVER must remember to carry the run
                            on; the client half of the save comes from the
                            browser. A game with no server state does not
                            need it at all.

and may call back into the hub through `ctx`:

    ctx.settings                     opaque settings dict from room creation
    ctx.room_id / ctx.host_id
    ctx.players()                    connected roster entries
    ctx.all_players()                full roster (incl. disconnected)
    await ctx.broadcast(msg, exclude=None)
    await ctx.send(player_id, msg)
    ctx.schedule(delay, coro_factory)   run an async fn after `delay` seconds
    await ctx.finish(records)        end game, write session, broadcast game_over
    ctx.resume / ctx.saved_state     the save this room was started from, if any
    ctx.save_state(player_id, data)  store a save and let the player walk away
    await ctx.close(reason)          end the room WITHOUT recording a session

Saving is framework work, not game work: every solo room answers the client's
`__save` message the same way — collect the client blob, ask the game for
snapshot(), write one row, close the room. No game implements the button, the
prompt, the storage or the "new game or continue?" question.

The hub never imports a specific game — it loads mp_game.py by convention.
"""

import asyncio
import importlib.util
import inspect
import json
import os
import random
import sqlite3
import string
import sys
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

router = APIRouter(prefix="/api/pub/gamehub/mp")

_BASE        = os.path.dirname(__file__)                       # backend/apps/gamehub
_APPS_DIR    = os.path.dirname(_BASE)                          # backend/apps
GH_DB_PATH   = os.path.join(_BASE, "..", "..", "apps", "gamehub", "data.db")
FRONTEND_APPS = os.path.join(_BASE, "..", "..", "..", "apps")  # apps/<id>/

ROOM_TTL      = 7200   # 2 h — drop stale rooms
EMPTY_GRACE   = 300    # 5 min — drop an abandoned lobby once everyone leaves
# A run already in progress is something a player means to come back to (see
# /rooms/mine), so it waits far longer than a lobby nobody joined. ROOM_TTL
# still caps it.
PLAYING_GRACE = 3600   # 1 h
HEARTBEAT     = 25     # seconds between server pings
PLAYER_COLORS = [
    "#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af",
    "#cba6f7", "#fab387", "#94e2d5", "#f5c2e7",
    "#74c7ec", "#eba0ac", "#b4befe", "#f2cdcd",
]

# room_id → room dict
_rooms: dict[str, dict] = {}


# ── helpers ─────────────────────────────────────────────────────────────────

def _make_id(n=10):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _gh_conn():
    conn = sqlite3.connect(GH_DB_PATH)
    conn.row_factory = sqlite3.Row
    # Multiplayer writes a row per move, from several rooms at once — WAL keeps
    # reads going during a write, and the timeout queues a simultaneous write
    # (a few ms) instead of failing it outright with "database is locked".
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _apphub():
    return sys.modules.get("backend.apphub")

def _resolve_player(token: str) -> dict | None:
    """Resolve a token (apphub or legacy gh_token) to a player dict."""
    if not token:
        return None
    # Try Apps Hub first (current auth system)
    hub = _apphub()
    if hub:
        u = hub.get_pub_session(token)
        if u:
            with _gh_conn() as conn:
                conn.execute("UPDATE players SET display_name=?,avatar_color=?,avatar_svg=? WHERE id=?",
                             (u.get("display_name", ""), u.get("avatar_color", "#89b4fa"), u.get("avatar_svg"), u["id"]))
                conn.commit()
            return {"id": u["id"], "display_name": u.get("display_name", ""), "avatar_color": u.get("avatar_color", "#89b4fa"), "avatar_svg": u.get("avatar_svg", "")}
    # Fallback: legacy gh_tokens table
    try:
        now = datetime.now(timezone.utc).isoformat()
        with _gh_conn() as conn:
            row = conn.execute(
                """SELECT p.id, p.display_name, p.avatar_color, p.avatar_svg
                   FROM players p JOIN gh_tokens t ON t.player_id = p.id
                   WHERE t.token = ? AND t.expires_at > ?""",
                (token, now),
            ).fetchone()
        return dict(row) if row else None
    except Exception:
        return None


def _is_invited(room_url: str, player_id: str) -> bool:
    try:
        now = datetime.now(timezone.utc).isoformat()
        with _gh_conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM invites WHERE to_id=? AND room_url=? AND expires_at>?",
                (player_id, room_url, now),
            ).fetchone()
        return row is not None
    except Exception:
        return False


def _record_session(game_id: str, records: list, duration: int | None, metadata: dict):
    """Write a finished game into game_sessions / session_players."""
    try:
        mode = "singleplayer" if len(records) < 2 else "multiplayer"
        now = datetime.now(timezone.utc).isoformat()
        with _gh_conn() as conn:
            cur = conn.execute(
                "INSERT INTO game_sessions(game_id,mode,played_at,duration_seconds,metadata) VALUES(?,?,?,?,?)",
                (game_id, mode, now, duration, json.dumps(metadata or {})),
            )
            sid = cur.lastrowid
            for r in records:
                pid = r.get("player_id")
                if not pid and not r.get("guest_name"):
                    continue
                conn.execute(
                    "INSERT INTO session_players(session_id,player_id,guest_name,score,rank,is_winner) VALUES(?,?,?,?,?,?)",
                    (sid, pid, r.get("guest_name"), r.get("score"), r.get("rank"),
                     1 if r.get("is_winner") else 0),
                )
            conn.commit()
    except Exception as e:
        print(f"[gamehub-mp] record_session failed: {e}")


def _mp_game_path(game_id: str):
    """apps/<id>/mp_game.py in the current layout, backend/apps/<id>/mp_game.py
    in the older one. Returns None when the game has no multiplayer logic."""
    for d in (FRONTEND_APPS, _APPS_DIR):
        p = os.path.join(d, game_id, "mp_game.py")
        if os.path.isfile(p):
            return p
    return None


def _load_game_class(game_id: str):
    """Dynamically load Game from the game's mp_game.py (by convention)."""
    path = _mp_game_path(game_id)
    if path is None:
        return None
    try:
        spec = importlib.util.spec_from_file_location(f"mp_game_{game_id}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return getattr(mod, "Game", None)
    except Exception as e:
        print(f"[gamehub-mp] failed to load mp_game for {game_id}: {e}")
        return None


# ── Saved games ──────────────────────────────────────────────────────────────
# A room is a run in progress: it lives in memory, survives a lost connection
# and nothing more. A *save* is the other thing — the player deliberately
# stopping, keeping where they got to, and coming back whenever. The two are
# kept strictly apart, and a player can only be in one of the states at a time:
#
#   run in progress   → the hub offers Continue and refuses to start a new run
#   saved game        → the hub asks: continue the save, or start fresh?
#
# Starting a run from a save consumes it, so there is never both. Everything
# here is game-agnostic: the framework stores an opaque blob per (game, player)
# and never looks inside it. What goes in it, and when, is the game's call.

def _ensure_saves_table():
    try:
        with _gh_conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS game_saves (
                    game_id    TEXT NOT NULL,
                    player_id  TEXT NOT NULL,
                    state      TEXT NOT NULL DEFAULT '{}',
                    created_at REAL,
                    updated_at REAL,
                    PRIMARY KEY (game_id, player_id)
                )""")
            conn.commit()
    except Exception as e:
        print(f"[gamehub-mp] game_saves table: {e}")


_ensure_saves_table()


def _save_get(game_id: str, player_id: str) -> dict | None:
    try:
        with _gh_conn() as conn:
            row = conn.execute(
                "SELECT state, updated_at FROM game_saves WHERE game_id=? AND player_id=?",
                (game_id, str(player_id)),
            ).fetchone()
        if not row:
            return None
        return {"state": json.loads(row["state"] or "{}"), "updated_at": row["updated_at"]}
    except Exception as e:
        print(f"[gamehub-mp] save read failed: {e}")
        return None


def _save_put(game_id: str, player_id: str, state: dict) -> bool:
    now = time.time()
    try:
        with _gh_conn() as conn:
            conn.execute(
                """INSERT INTO game_saves(game_id,player_id,state,created_at,updated_at)
                   VALUES(?,?,?,?,?)
                   ON CONFLICT(game_id,player_id) DO UPDATE SET
                       state=excluded.state, updated_at=excluded.updated_at""",
                (game_id, str(player_id), json.dumps(state), now, now),
            )
            conn.commit()
        return True
    except Exception as e:
        print(f"[gamehub-mp] save write failed: {e}")
        return False


def _save_del(game_id: str, player_id: str):
    try:
        with _gh_conn() as conn:
            conn.execute("DELETE FROM game_saves WHERE game_id=? AND player_id=?",
                         (game_id, str(player_id)))
            conn.commit()
    except Exception as e:
        print(f"[gamehub-mp] save delete failed: {e}")


def _saves_for(player_id: str) -> list:
    try:
        with _gh_conn() as conn:
            rows = conn.execute(
                "SELECT game_id, created_at, updated_at FROM game_saves WHERE player_id=? ORDER BY updated_at DESC",
                (str(player_id),),
            ).fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


def _saved_client(room: dict) -> dict | None:
    """The browser's half of the save this room was started from. The client
    framework hands it to the game, which decides when in its own startup the
    board is ready to receive it."""
    return (room.get("saved_state") or {}).get("client")


def _live_solo_room(game_id: str, player_id: str) -> dict | None:
    """The player's own solo run of this game that is still going. At most one
    can exist — create_room refuses a second, because two half-played runs of
    the same game is a state nobody can make sense of."""
    _cleanup()
    pid = str(player_id)
    for room in _rooms.values():
        if (room["game_id"] == game_id and room["max_players"] <= 1
                and room["status"] != "finished" and pid in room["players"]):
            return room
    return None


def _cleanup():
    now = time.time()
    for rid in list(_rooms.keys()):
        room = _rooms[rid]
        if now - room["created_at"] > ROOM_TTL:
            _rooms.pop(rid, None)
            continue
        any_connected = any(p["connected"] for p in room["players"].values())
        grace = PLAYING_GRACE if room["status"] == "playing" else EMPTY_GRACE
        if not any_connected and room["empty_since"] and now - room["empty_since"] > grace:
            _rooms.pop(rid, None)


def _room_url(room_id: str) -> str:
    return f"/api/pub/gamehub/mp/play/{room_id}"


def _roster_public(room: dict) -> list:
    """Roster without sockets, ordered by slot — safe to send to clients."""
    return [
        {
            "id":           p["id"],
            "display_name": p["display_name"],
            "avatar_color": p["avatar_color"],
            "avatar_svg":   p["avatar_svg"],
            "slot":         p["slot"],
            "connected":    p["connected"],
            "is_host":      p["id"] == room["host_id"],
        }
        for p in sorted(room["players"].values(), key=lambda x: x["slot"])
    ]


# ── ctx — the API a game handler uses to talk back to the hub ────────────────

class RoomCtx:
    def __init__(self, room: dict):
        self._room = room

    @property
    def settings(self) -> dict:
        return self._room["settings"]

    @property
    def room_id(self) -> str:
        return self._room["id"]

    @property
    def host_id(self) -> str:
        return self._room["host_id"]

    def players(self) -> list:
        """Connected roster entries (public shape)."""
        return [p for p in _roster_public(self._room) if p["connected"]]

    def all_players(self) -> list:
        return _roster_public(self._room)

    async def broadcast(self, msg: dict, exclude: str | None = None):
        await _broadcast(self._room, msg, exclude=exclude)

    async def send(self, player_id: str, msg: dict):
        p = self._room["players"].get(player_id)
        if p and p["ws"] is not None:
            await _send(p["ws"], msg)

    def schedule(self, delay: float, coro_factory):
        """Run coro_factory() (an async callable) after `delay` seconds, if the
        room is still alive. coro_factory is called at fire time, not now."""
        rid = self._room["id"]

        async def _runner():
            await asyncio.sleep(delay)
            if rid in _rooms:
                try:
                    await coro_factory()
                except Exception as e:
                    print(f"[gamehub-mp] scheduled task error: {e}")

        asyncio.create_task(_runner())

    # ── saves ───────────────────────────────────────────────────────────────
    # The framework stores an opaque blob; only the game knows what belongs in
    # it. A save has two halves — what the browser knows and what the server
    # knows — because that split is different in every game and neither side
    # should have to care which one this game is. `saved_state` is the server
    # half, already loaded when on_start runs, and the row is consumed at that
    # moment: a save is a one-shot thing, not a checkpoint to fall back to
    # twice.

    @property
    def resume(self) -> bool:
        """True when this room was started from a saved game."""
        return self._room.get("saved_state") is not None

    @property
    def saved_state(self) -> dict | None:
        return (self._room.get("saved_state") or {}).get("server")

    def save_state(self, player_id: str, state: dict) -> bool:
        return _save_put(self._room["game_id"], player_id, {"server": state})

    def clear_save(self, player_id: str):
        _save_del(self._room["game_id"], player_id)

    async def close(self, reason: str = "closed"):
        """End the room without recording a session. This is the exit a player
        takes when they are stopping, not losing: nothing goes to the
        leaderboard, because the run did not actually end."""
        room = self._room
        await _broadcast(room, {"type": "room_closed", "reason": reason})
        _rooms.pop(room["id"], None)

    async def finish(self, records: list, duration: int | None = None, metadata: dict | None = None):
        room = self._room
        if room["status"] == "finished":
            return
        room["status"] = "finished"
        dur = duration
        if dur is None and room.get("started_at"):
            dur = int(time.time() - room["started_at"])
        _record_session(room["game_id"], records, dur, metadata or {})
        await _broadcast(room, {"type": "game_over", "records": records})


async def _send(ws: WebSocket, msg: dict):
    try:
        await ws.send_text(json.dumps(msg))
    except Exception:
        pass


async def _broadcast(room: dict, msg: dict, exclude: str | None = None):
    data = json.dumps(msg)
    for pid, p in list(room["players"].items()):
        if pid != exclude and p["ws"] is not None:
            try:
                await p["ws"].send_text(data)
            except Exception:
                pass


async def _handle_save(room: dict, pid: str, msg: dict):
    """`__save` — the one save-and-exit path, shared by every game.

    Solo only, and only the player whose run it is: a multiplayer room is other
    people's evening, not one player's to freeze. The blob is opaque to the
    hub — the browser's half arrives with the message, the server's half comes
    from the game's optional snapshot(). A game that keeps nothing on the
    server, or nothing in the browser, simply contributes one half.

    Saving ends the room without recording a session: the run has not finished,
    it has been put down, and nothing about it belongs on a leaderboard yet.
    """
    entry = room["players"].get(pid)
    ws    = entry["ws"] if entry else None
    ok    = False
    if (room["max_players"] <= 1 and room["status"] == "playing"
            and pid == room["host_id"] and room.get("game") is not None):
        state  = {}
        client = msg.get("state")
        if isinstance(client, dict):
            state["client"] = client
        snap = getattr(room["game"], "snapshot", None)
        if callable(snap):
            try:
                server = snap()
                if inspect.isawaitable(server):
                    server = await server
                if isinstance(server, dict):
                    state["server"] = server
            except Exception as e:
                print(f"[gamehub-mp] snapshot error: {e}")
        if state:
            ok = _save_put(room["game_id"], pid, state)
    if ws is not None:
        await _send(ws, {"type": "__saved", "ok": ok})
    if ok:
        ctx = room.get("ctx") or RoomCtx(room)
        await ctx.close("saved")


async def _broadcast_roster(room: dict):
    await _broadcast(room, {
        "type":        "roster",
        "players":     _roster_public(room),
        "status":      room["status"],
        "host_id":     room["host_id"],
        "max_players": room["max_players"],
    })


# ── REST ─────────────────────────────────────────────────────────────────────

@router.post("/rooms")
async def create_room(request: Request, body: dict):
    """Create a room. Body: { game_id, settings?, max_players?, resume? } + GH token.

    `resume` only means anything for a solo room and only when the player has a
    saved game: true continues it, false throws it away and starts fresh,
    omitted answers 409 `saved_game` so the caller has to ask the player."""
    token  = body.get("gh_token") or request.headers.get("X-GH-Token", "")
    player = _resolve_player(token)
    if not player:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    game_id = str(body.get("game_id", "")).strip()
    if not game_id:
        return JSONResponse({"error": "game_id required"}, status_code=400)
    if _load_game_class(game_id) is None:
        return JSONResponse({"error": "game has no multiplayer handler"}, status_code=400)

    _cleanup()
    # A room can never seat more than the game itself supports — the create
    # endpoint is the only gate for that, since a lobby that already let a 5th
    # player in has nowhere left to turn them away.
    game_cap = int(_game_manifest(game_id).get("max_players", 8) or 8)
    max_players = max(1, min(12, game_cap, int(body.get("max_players", 8))))
    pid = str(player["id"])

    # One run at a time, and a saved game has to be dealt with before a new run
    # can exist. Both checks live here rather than in the hub's UI, because the
    # UI is not the only way in.
    #
    # This applies to every game's solo mode, old ones included: one unfinished
    # solo run of a game is a thing a player can hold in their head, several are
    # not. A player who wants the run gone rather than continued deletes it
    # (DELETE /rooms/{id}); no game has to implement anything for that.
    if max_players <= 1:
        live = _live_solo_room(game_id, pid)
        if live is not None:
            return JSONResponse({"error": "run_in_progress", "room_id": live["id"],
                                 "play_url": _room_url(live["id"])}, status_code=409)
        saved = _save_get(game_id, pid)
        if saved is not None:
            resume = body.get("resume")
            if resume is None:
                # Neither "continue it" nor "throw it away" — ask the player.
                return JSONResponse({"error": "saved_game", "game_id": game_id,
                                     "updated_at": saved["updated_at"]}, status_code=409)
            if not resume:
                _save_del(game_id, pid)

    room_id = _make_id(10)
    _rooms[room_id] = {
        "id":          room_id,
        "game_id":     game_id,
        "host_id":     pid,
        "max_players": max_players,
        "resume":      bool(body.get("resume")) and max_players <= 1,
        "saved_state": None,     # filled at start, from the save being consumed
        "settings":    body.get("settings", {}) or {},
        "created_at":  time.time(),
        "started_at":  None,
        "empty_since": None,
        "status":      "lobby",
        "players":     {},          # gh_player_id → roster entry (with live ws)
        "game":        None,        # Game instance, created on start
        "ctx":         None,
    }
    return {"room_id": room_id, "play_url": _room_url(room_id)}


@router.get("/rooms")
async def list_rooms(game_id: str = ""):
    """Open lobbies (optionally filtered by game_id) for the 'open games' list."""
    _cleanup()
    out = []
    for room in _rooms.values():
        if room["status"] != "lobby":
            continue
        if room["max_players"] <= 1:
            continue  # solo room — not joinable, so never shown to others
        if game_id and room["game_id"] != game_id:
            continue
        host = room["players"].get(room["host_id"])
        out.append({
            "room_id":      room["id"],
            "game_id":      room["game_id"],
            "play_url":     _room_url(room["id"]),
            "host_name":    host["display_name"] if host else None,
            "players":      len(room["players"]),
            "max_players":  room["max_players"],
            "created_at":   room["created_at"],
            "settings":     room["settings"],
        })
    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out


@router.get("/rooms/mine")
async def my_rooms(request: Request):
    """The caller's own live rooms — a game they walked away from and can walk
    back into. Not the same list as /rooms: that one is open lobbies for other
    people, which deliberately excludes solo rooms and rooms already playing,
    and those are exactly the ones a player wants back."""
    player = _resolve_player(request.headers.get("X-GH-Token", ""))
    if not player:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    _cleanup()
    pid = str(player["id"])
    out = []
    for room in _rooms.values():
        if room["status"] == "finished" or pid not in room["players"]:
            continue
        out.append({
            "room_id":     room["id"],
            "game_id":     room["game_id"],
            "play_url":    _room_url(room["id"]),
            "status":      room["status"],
            "players":     len(room["players"]),
            "max_players": room["max_players"],
            "created_at":  room["created_at"],
        })
    out.sort(key=lambda r: r["created_at"], reverse=True)
    return out


@router.delete("/rooms/{room_id}")
async def discard_room(room_id: str, request: Request):
    """Throw away a run instead of continuing it. Nothing is recorded — an
    unfinished run was never a session. This is the way out of "you already
    have a run in progress" for a player who does not want it back, and it
    needs nothing from the game itself."""
    player = _resolve_player(request.headers.get("X-GH-Token", ""))
    if not player:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    room = _rooms.get(room_id)
    pid  = str(player["id"])
    # Only your own room, and only a solo one: a multiplayer room is not one
    # person's to end for everybody.
    if not room or pid not in room["players"] or room["max_players"] > 1:
        return JSONResponse({"error": "not found"}, status_code=404)
    await _broadcast(room, {"type": "room_closed", "reason": "discarded"})
    _rooms.pop(room_id, None)
    # And with it whatever the game wrote down while it was being played. A game
    # that keeps the live run on disk so a reload or a restarted backend cannot
    # eat it must not have that copy outlive the player throwing the run away —
    # "I don't want this run" would otherwise come back as "you have a saved
    # game" the next time they press play.
    _save_del(room["game_id"], pid)
    return {"ok": True}


@router.get("/saves")
async def my_saves(request: Request):
    """The caller's saved games — one per game at most. The hub uses this to
    know whether starting a game means asking a question first."""
    player = _resolve_player(request.headers.get("X-GH-Token", ""))
    if not player:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _saves_for(player["id"])


@router.delete("/saves/{game_id}")
async def delete_save(game_id: str, request: Request):
    player = _resolve_player(request.headers.get("X-GH-Token", ""))
    if not player:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    _save_del(game_id, player["id"])
    return {"ok": True}


@router.get("/games")
async def list_mp_games():
    """Multiplayer-capable games, discovered by convention (presence of
    mp_game.py). Name/icon come from the installed plugins — the hub keeps no
    hardcoded list of games."""
    meta = {}
    try:
        main_db = os.path.join(_BASE, "..", "..", "..", "data.db")
        mc = sqlite3.connect(main_db)
        mc.row_factory = sqlite3.Row
        for r in mc.execute("SELECT id,name,icon FROM plugins").fetchall():
            meta[r["id"]] = {"name": r["name"], "icon": r["icon"]}
        mc.close()
    except Exception:
        pass

    games = []
    try:
        seen = set()
        for d in (FRONTEND_APPS, _APPS_DIR):
            seen |= set(os.listdir(d)) if os.path.isdir(d) else set()
        for gid in sorted(seen):
            if _mp_game_path(gid) is None:
                continue
            max_players = 8
            # Absent means "as before": every game that predates this flag is
            # multiplayer, so only an explicit false makes a game solo-only.
            multiplayer = True
            mpath = os.path.join(FRONTEND_APPS, gid, "manifest.json")
            try:
                with open(mpath) as f:
                    mani = json.load(f)
                max_players = int(mani.get("max_players", 8))
                multiplayer = mani.get("multiplayer") is not False and max_players > 1
            except Exception:
                pass
            m = meta.get(gid, {})
            games.append({
                "id":          gid,
                "name":        m.get("name", gid),
                "icon":        m.get("icon", "🎮"),
                "max_players": max_players,
                "multiplayer": multiplayer,
            })
    except Exception:
        pass
    return games


@router.post("/rooms/{room_id}/start")
async def start_room(room_id: str, request: Request, body: dict):
    """Host starts the game. Optionally updates settings first."""
    room = _rooms.get(room_id)
    if not room:
        return JSONResponse({"error": "not found"}, status_code=404)
    token  = body.get("gh_token") or request.headers.get("X-GH-Token", "")
    player = _resolve_player(token)
    if not player or str(player["id"]) != room["host_id"]:
        return JSONResponse({"error": "only host can start"}, status_code=403)
    if room["status"] != "lobby":
        return JSONResponse({"error": "already started"}, status_code=409)
    connected = [p for p in room["players"].values() if p["connected"]]
    if len(connected) < 1:
        return JSONResponse({"error": "need at least 1 player"}, status_code=400)

    if isinstance(body.get("settings"), dict):
        room["settings"].update(body["settings"])

    GameCls = _load_game_class(room["game_id"])
    if GameCls is None:
        return JSONResponse({"error": "game handler missing"}, status_code=500)

    # Starting consumes the save: from here on the run is the live thing, and
    # there is no half-state where a player has both a run and a save of it.
    if room.get("resume"):
        saved = _save_get(room["game_id"], room["host_id"])
        if saved is not None:
            room["saved_state"] = saved["state"]
            _save_del(room["game_id"], room["host_id"])

    ctx = RoomCtx(room)
    room["ctx"]        = ctx
    room["game"]       = GameCls(ctx)
    room["status"]     = "playing"
    room["started_at"] = time.time()

    await _broadcast(room, {"type": "game_started", "settings": room["settings"],
                            "saved_state": _saved_client(room)})
    try:
        await room["game"].on_start(room["settings"])
    except Exception as e:
        print(f"[gamehub-mp] on_start error: {e}")
    return {"ok": True}


@router.get("/play/{room_id}", response_class=HTMLResponse)
async def play_page(room_id: str):
    room = _rooms.get(room_id)
    if not room:
        return HTMLResponse("""<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mvmOS · Game Hub</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#1e1e2e;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100dvh}
    .card{background:#181825;border:1px solid #313244;border-radius:16px;padding:48px 40px;text-align:center;max-width:360px;width:90%}
    .icon{font-size:3rem;margin-bottom:16px}
    h2{font-size:1.3rem;font-weight:700;color:#cdd6f4;margin-bottom:8px}
    p{color:#a6adc8;font-size:.95rem;margin-bottom:28px;line-height:1.5}
    a{display:inline-block;background:#89b4fa;color:#1e1e2e;font-weight:700;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:.95rem;transition:background .15s}
    a:hover{background:#b4d0fb}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔗</div>
    <h2>Стаята вече я няма</h2>
    <p>Играта е приключила, линкът е невалиден или стаята е изтекла. Ходът ти не е загубен, ако играта го записва — върни се в Game Hub и натисни play: ще те попита дали да продължиш оттам, докъдето беше.</p>
    <a href="/pub/gamehub/">← Game Hub</a>
  </div>
</body>
</html>""", status_code=404)
    return HTMLResponse(_play_html(room["game_id"], room_id))


def _public_bootstrap(themed: bool) -> str:
    """The theme + language bootstrap every other public page gets injected by
    backend/main.py's /pub/<app>/ middleware. The play page lives under
    /api/pub/… (deliberately — it must stay free of the Apps Hub chrome, this
    is a full-screen game), so that middleware never sees it and the page used
    to be hardcoded to the dark theme and English. Pulled in directly here so a
    game's own i18n.js can translate it like any other app.

    The language half is safe for every game: it only picks the visitor's
    language, which a game either uses or ignores. The theme half is not —
    it can turn the page light, and a game written when this page was always
    dark may have baked dark colours into its own markup. So a game only gets
    it by saying `"themed": true` in its manifest."""
    try:
        main = sys.modules.get("backend.main")
        theme = (getattr(main, "_PUBLIC_THEME_BOOTSTRAP", "") or "") if themed else ""
        lang_fn = getattr(main, "_public_lang_bootstrap", None)
        return theme + (lang_fn() if lang_fn else "")
    except Exception:
        return ""


def _game_manifest(game_id: str) -> dict:
    for d in (FRONTEND_APPS, _APPS_DIR):
        try:
            with open(os.path.join(d, game_id, "manifest.json")) as f:
                return json.load(f)
        except Exception:
            continue
    return {}


def _play_html(game_id: str, room_id: str) -> str:
    """Generic, game-agnostic play page. Loads the GameHub client + the game's
    mp.js bundle; GameHub.mp drives lobby → game."""
    def _mt(rel):
        # apps/<id>/public/<file> — the folder /apps/<id>/<file> is served from.
        # Missing files fall back to "now", which simply means no caching.
        app_id, _, name = rel.partition("/")
        for d in (FRONTEND_APPS, _APPS_DIR):
            try:
                return int(os.path.getmtime(os.path.join(d, app_id, "public", name)))
            except Exception:
                continue
        return int(time.time())
    v_widget = _mt("gamehub/widget.js")
    v_game   = _mt(f"{game_id}/mp.js")
    v_gcss   = _mt(f"{game_id}/style.css")
    # Games ship their own string table beside mp.js, exactly like every store
    # app does; the core table is already on the page via the bootstrap above.
    i18n_tag = ""
    if os.path.isfile(os.path.join(FRONTEND_APPS, game_id, "public", "i18n.js")):
        i18n_tag = f'<script src="/apps/{game_id}/i18n.js?v={_mt(f"{game_id}/i18n.js")}"></script>'
    themed = _game_manifest(game_id).get("themed") is True
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mvmOS · Game Hub</title>
  {_public_bootstrap(themed)}
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    :root{{--bg:#1e1e2e;--surface1:#181825;--surface2:#313244;--border:#45475a;
      --fg:#cdd6f4;--fg2:#a6adc8;--accent:#89b4fa;--green:#a6e3a1;--red:#f38ba8;--yellow:#f9e2af}}
    body{{background:var(--bg);color:var(--fg);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex;flex-direction:column;height:100dvh;overflow:hidden}}
    #mp-root{{flex:1;min-height:0;display:flex;flex-direction:column}}
  </style>
  <link rel="stylesheet" href="/apps/{game_id}/style.css?v={v_gcss}">
</head>
<body>
  <div id="mp-root"></div>
  <script>
    window.mvmOS = window.mvmOS || {{}};
    window.mvmOS.lang = window.mvmOS.pubLang || 'en';
    window.GameHubRoom = {{ roomId: '{room_id}', gameId: '{game_id}' }};
  </script>
  <script src="/i18n/i18n.js"></script>
  <script src="/apps/gamehub/i18n.js?v={_mt("gamehub/i18n.js")}"></script>
  {i18n_tag}
  <script src="/apps/gamehub/widget.js?v={v_widget}"></script>
  <script src="/apps/{game_id}/mp.js?v={v_game}"></script>
  <script>
    (function boot() {{
      if (!window.GameHub || !window.GameHub.mp) {{ return setTimeout(boot, 30); }}
      window.GameHub.init().then(function() {{
        var root = document.getElementById('mp-root');
        window.GameHub.renderHeader(root);
        window.GameHub.mp.start(root, window.GameHubRoom);
      }});
    }})();
  </script>
</body>
</html>"""


# ── WebSocket ─────────────────────────────────────────────────────────────────

@router.websocket("/rooms/{room_id}/ws")
async def room_ws(websocket: WebSocket, room_id: str):
    room = _rooms.get(room_id)
    if not room:
        await websocket.close(code=4004)
        return

    await websocket.accept()
    pid = None
    hb_task = None

    try:
        # First frame must be a join with a Game Hub token.
        try:
            first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10.0))
        except Exception:
            await websocket.close()
            return
        if first.get("type") != "join":
            await _send(websocket, {"type": "error", "message": "expected join"})
            await websocket.close()
            return

        player = _resolve_player(first.get("gh_token", ""))
        if not player:
            await _send(websocket, {"type": "error", "message": "unauthorized"})
            await websocket.close()
            return
        pid = str(player["id"])

        existing = room["players"].get(pid)
        is_host  = pid == room["host_id"]

        if existing is None:
            # New player — only allowed to join while in lobby, if host/invited.
            if room["status"] != "lobby":
                await _send(websocket, {"type": "error", "message": "game_in_progress"})
                await websocket.close()
                return
            if not is_host and not _is_invited(_room_url(room_id), pid):
                await _send(websocket, {"type": "error", "message": "not_invited"})
                await websocket.close()
                return
            if len(room["players"]) >= room["max_players"]:
                await _send(websocket, {"type": "error", "message": "room_full"})
                await websocket.close()
                return
            slot = len(room["players"])
            room["players"][pid] = {
                "id":           pid,
                "display_name": player["display_name"],
                "avatar_color": player.get("avatar_color") or PLAYER_COLORS[slot % len(PLAYER_COLORS)],
                "avatar_svg":   player.get("avatar_svg"),
                "slot":         slot,
                "connected":    True,
                "ws":           websocket,
            }
            reconnect = False
        else:
            # Known player → reconnect to the same slot (GH token is the key).
            existing["ws"]           = websocket
            existing["connected"]    = True
            existing["display_name"] = player["display_name"]
            existing["avatar_svg"]   = player.get("avatar_svg")
            reconnect = True

        room["empty_since"] = None

        # Tell the joiner who they are + current room state.
        await _send(websocket, {
            "type":        "joined",
            "you":         pid,
            "is_host":     is_host,
            "reconnect":   reconnect,
            "game_id":     room["game_id"],
            "status":      room["status"],
            "settings":    room["settings"],
            "host_id":     room["host_id"],
            "max_players": room["max_players"],
            "players":     _roster_public(room),
            "saved_state": _saved_client(room) if pid == room["host_id"] else None,
        })
        await _broadcast_roster(room)

        # If a game is running, let it bring this (re)joiner up to speed.
        if room["status"] == "playing" and room["game"] is not None:
            try:
                await room["game"].on_join(room["players"][pid])
            except Exception as e:
                print(f"[gamehub-mp] on_join error: {e}")

        # Server-side heartbeat.
        async def _hb():
            while True:
                await asyncio.sleep(HEARTBEAT)
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception:
                    break
        hb_task = asyncio.create_task(_hb())

        # Main loop.
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue
            t = msg.get("type")
            if t in ("ping", "pong"):
                if t == "ping":
                    await _send(websocket, {"type": "pong"})
                continue
            if t == "__save":
                await _handle_save(room, pid, msg)
                continue
            # Everything else is game logic.
            if room["status"] == "playing" and room["game"] is not None:
                try:
                    await room["game"].on_message(room["players"][pid], msg)
                except Exception as e:
                    print(f"[gamehub-mp] on_message error: {e}")

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if hb_task:
            hb_task.cancel()
        if pid and room_id in _rooms:
            entry = room["players"].get(pid)
            if entry:
                entry["connected"] = False
                entry["ws"] = None
            if not any(p["connected"] for p in room["players"].values()):
                room["empty_since"] = time.time()
            await _broadcast_roster(room)
            if room["status"] == "playing" and room["game"] is not None and entry:
                try:
                    await room["game"].on_leave(entry)
                except Exception as e:
                    print(f"[gamehub-mp] on_leave error: {e}")
