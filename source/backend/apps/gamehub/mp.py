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

and may call back into the hub through `ctx`:

    ctx.settings                     opaque settings dict from room creation
    ctx.room_id / ctx.host_id
    ctx.players()                    connected roster entries
    ctx.all_players()                full roster (incl. disconnected)
    await ctx.broadcast(msg, exclude=None)
    await ctx.send(player_id, msg)
    ctx.schedule(delay, coro_factory)   run an async fn after `delay` seconds
    await ctx.finish(records)        end game, write session, broadcast game_over

The hub never imports a specific game — it loads mp_game.py by convention.
"""

import asyncio
import importlib.util
import json
import os
import random
import sqlite3
import string
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
EMPTY_GRACE   = 300    # 5 min — drop a room after everyone disconnects
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
    return conn


def _resolve_player(token: str) -> dict | None:
    """Game Hub token → player {id, display_name, avatar_color, avatar_svg}."""
    if not token:
        return None
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
        now = datetime.now(timezone.utc).isoformat()
        with _gh_conn() as conn:
            cur = conn.execute(
                "INSERT INTO game_sessions(game_id,mode,played_at,duration_seconds,metadata) VALUES(?,?,?,?,?)",
                (game_id, "multiplayer", now, duration, json.dumps(metadata or {})),
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


def _load_game_class(game_id: str):
    """Dynamically load Game from backend/apps/<game_id>/mp_game.py (by convention)."""
    path = os.path.join(_APPS_DIR, game_id, "mp_game.py")
    if not os.path.isfile(path):
        return None
    try:
        spec = importlib.util.spec_from_file_location(f"mp_game_{game_id}", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return getattr(mod, "Game", None)
    except Exception as e:
        print(f"[gamehub-mp] failed to load mp_game for {game_id}: {e}")
        return None


def _cleanup():
    now = time.time()
    for rid in list(_rooms.keys()):
        room = _rooms[rid]
        if now - room["created_at"] > ROOM_TTL:
            _rooms.pop(rid, None)
            continue
        any_connected = any(p["connected"] for p in room["players"].values())
        if not any_connected and room["empty_since"] and now - room["empty_since"] > EMPTY_GRACE:
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
    """Create a multiplayer room. Body: { game_id, settings?, max_players? } + GH token."""
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
    room_id = _make_id(10)
    _rooms[room_id] = {
        "id":          room_id,
        "game_id":     game_id,
        "host_id":     str(player["id"]),
        "max_players": max(2, min(12, int(body.get("max_players", 8)))),
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
        for gid in sorted(os.listdir(_APPS_DIR)):
            if not os.path.isfile(os.path.join(_APPS_DIR, gid, "mp_game.py")):
                continue
            max_players = 8
            mpath = os.path.join(FRONTEND_APPS, gid, "manifest.json")
            try:
                with open(mpath) as f:
                    mani = json.load(f)
                max_players = int(mani.get("max_players", 8))
            except Exception:
                pass
            m = meta.get(gid, {})
            games.append({
                "id":          gid,
                "name":        m.get("name", gid),
                "icon":        m.get("icon", "🎮"),
                "max_players": max_players,
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
    if len(connected) < 2:
        return JSONResponse({"error": "need at least 2 players"}, status_code=400)

    if isinstance(body.get("settings"), dict):
        room["settings"].update(body["settings"])

    GameCls = _load_game_class(room["game_id"])
    if GameCls is None:
        return JSONResponse({"error": "game handler missing"}, status_code=500)

    ctx = RoomCtx(room)
    room["ctx"]        = ctx
    room["game"]       = GameCls(ctx)
    room["status"]     = "playing"
    room["started_at"] = time.time()

    await _broadcast(room, {"type": "game_started", "settings": room["settings"]})
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
    <h2>Стаята не съществува или е изтекла</h2>
    <p>Играта може да е приключила или линкът е невалиден. Върни се в Game Hub и създай нова игра.</p>
    <a href="/apps/gamehub/public/">← Game Hub</a>
  </div>
</body>
</html>""", status_code=404)
    return HTMLResponse(_play_html(room["game_id"], room_id))


def _play_html(game_id: str, room_id: str) -> str:
    """Generic, game-agnostic play page. Loads the GameHub client + the game's
    mp.js bundle; GameHub.mp drives lobby → game."""
    def _mt(rel):
        try:
            return int(os.path.getmtime(os.path.join(FRONTEND_APPS, rel)))
        except Exception:
            return int(time.time())
    v_widget = _mt("gamehub/widget.js")
    v_game   = _mt(f"{game_id}/mp.js")
    v_gcss   = _mt(f"{game_id}/style.css")
    return f"""<!DOCTYPE html>
<html lang="bg">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mvmOS · Game Hub</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{background:#1e1e2e;color:#cdd6f4;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex;flex-direction:column;height:100dvh;overflow:hidden}}
    #mp-root{{flex:1;min-height:0;display:flex;flex-direction:column}}
  </style>
  <link rel="stylesheet" href="/apps/{game_id}/style.css?v={v_gcss}">
</head>
<body>
  <div id="mp-root"></div>
  <script>
    window.mvmOS = {{ lang: 'en' }};
    window.GameHubRoom = {{ roomId: '{room_id}', gameId: '{game_id}' }};
  </script>
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
