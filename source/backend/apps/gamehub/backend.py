import hashlib, json, os, secrets, sqlite3, sys, uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session


def _apphub():
    return sys.modules.get("backend.apphub")


def _gate_public(request: Request):
    """Game Hub's public surface respects the Apps Hub 'Public Access' toggle.
    When the app is public, anyone may reach these routes. When it is set to
    Private, they are reachable only locally — i.e. from an authenticated mvmOS
    desktop session (the `session` cookie). Public web requests get 403.
    Note: most routes still require a valid X-GH-Token on top of this gate."""
    hub = _apphub()
    if hub and hub.is_app_public("gamehub"):
        return
    token = request.cookies.get("session")
    if token:
        try:
            auth = sys.modules["backend.auth"]
            with auth.get_conn() as conn:
                if conn.execute("SELECT 1 FROM sessions WHERE token=?", (token,)).fetchone():
                    return
        except Exception:
            pass
    raise HTTPException(403, detail="Game Hub is private")

_admin = APIRouter(prefix="/api/gamehub",     tags=["gamehub"])
_pub   = APIRouter(prefix="/api/pub/gamehub", tags=["gamehub-pub"])

# Combined router exposed to the loader
router = APIRouter()

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "gamehub", "data.db")
TOKEN_DAYS = 30
AVATAR_COLORS = ['#89b4fa','#a6e3a1','#f38ba8','#fab387','#f9e2af','#cba6f7','#94e2d5','#f5c2e7','#74c7ec','#eba0ac']

def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS players (
            id            TEXT PRIMARY KEY,
            username      TEXT UNIQUE NOT NULL,
            display_name  TEXT NOT NULL,
            avatar_color  TEXT NOT NULL DEFAULT '#89b4fa',
            password_hash TEXT,
            created_at    TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gh_tokens (
            token      TEXT PRIMARY KEY,
            player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS game_sessions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id          TEXT NOT NULL,
            mode             TEXT NOT NULL DEFAULT 'multiplayer',
            played_at        TEXT NOT NULL,
            duration_seconds INTEGER,
            metadata         TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS session_players (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
            player_id  TEXT REFERENCES players(id) ON DELETE SET NULL,
            guest_name TEXT,
            score      REAL,
            rank       INTEGER,
            is_winner  INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS hub_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS invites (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            from_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            to_id      TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            game_id    TEXT NOT NULL,
            room_url   TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS player_favourites (
            player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            favourite_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            created_at   TEXT NOT NULL,
            PRIMARY KEY (player_id, favourite_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sp_player  ON session_players(player_id);
        CREATE INDEX IF NOT EXISTS idx_sp_session ON session_players(session_id);
        CREATE INDEX IF NOT EXISTS idx_gs_game    ON game_sessions(game_id, played_at);
        CREATE INDEX IF NOT EXISTS idx_tok_player ON gh_tokens(player_id);
        CREATE INDEX IF NOT EXISTS idx_inv_to     ON invites(to_id, expires_at);
    """)
    conn.execute("INSERT OR IGNORE INTO hub_settings(key,value) VALUES('allow_registrations','true')")
    conn.commit()
    # migrations
    pcols = {r[1] for r in conn.execute("PRAGMA table_info(players)").fetchall()}
    if "password_hash" not in pcols:
        conn.execute("ALTER TABLE players ADD COLUMN password_hash TEXT")
    if "avatar_data" not in pcols:
        conn.execute("ALTER TABLE players ADD COLUMN avatar_data TEXT")
    if "avatar_svg" not in pcols:
        conn.execute("ALTER TABLE players ADD COLUMN avatar_svg TEXT")
    gcols = {r[1] for r in conn.execute("PRAGMA table_info(game_sessions)").fetchall()}
    if "mode" not in gcols:
        conn.execute("ALTER TABLE game_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'multiplayer'")
    conn.commit()
    return conn

# ── One-time migration to apphub ─────────────────────────────

def _migrate_players_to_apphub():
    hub = _apphub()
    if not hub:
        return
    try:
        with _db() as conn:
            players = [dict(r) for r in conn.execute("SELECT * FROM players").fetchall()]
            tokens  = [dict(r) for r in conn.execute("SELECT * FROM gh_tokens").fetchall()]
        count = hub.migrate_from_gamehub(players, tokens)
        if count:
            print(f"[gamehub] migrated {count} players to apphub")
    except Exception as e:
        print(f"[gamehub] migration to apphub failed: {e}")

_migrate_players_to_apphub()


def _migrate_favourites_to_apphub():
    """Favourites now live centrally in Apps Hub (shared with Chat and any
    other app). Copy any pre-existing local rows over once; player_favourites
    itself is left in place but is no longer written to."""
    hub = _apphub()
    if not hub:
        return
    try:
        with _db() as conn:
            rows = conn.execute("SELECT player_id, favourite_id FROM player_favourites").fetchall()
        count = 0
        for r in rows:
            try:
                hub.add_favourite(r["player_id"], r["favourite_id"])
                count += 1
            except ValueError:
                pass
        if count:
            print(f"[gamehub] migrated {count} favourites to apphub")
    except Exception as e:
        print(f"[gamehub] favourites migration to apphub failed: {e}")

_migrate_favourites_to_apphub()

# ── Password helpers ──────────────────────────────────────────

def _hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(32)
    key  = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000)
    return salt.hex() + ':' + key.hex()

def _verify_pw(stored: str, pw: str) -> bool:
    try:
        salt_hex, key_hex = stored.split(':')
        key = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt_hex), 100000)
        return secrets.compare_digest(key.hex(), key_hex)
    except Exception:
        return False

def _resolve_token(x_gh_token: Optional[str]) -> Optional[dict]:
    hub = _apphub()
    if not hub or not x_gh_token:
        return None
    u = hub.get_pub_session(x_gh_token)
    if not u:
        return None
    # Ensure a players entry exists (needed for FK references in sessions/invites/favourites)
    with _db() as conn:
        exists = conn.execute("SELECT id FROM players WHERE id=?", (u["id"],)).fetchone()
        if not exists:
            conn.execute(
                "INSERT OR IGNORE INTO players(id,username,display_name,avatar_color,avatar_data,avatar_svg,created_at)"
                " VALUES(?,?,?,?,?,?,?)",
                (u["id"], u["username"], u["display_name"], u.get("avatar_color","#89b4fa"),
                 u.get("avatar_data"), u.get("avatar_svg"), u.get("created_at",""))
            )
            conn.commit()
    return u

def _issue_token(player_id: str) -> str:
    hub = _apphub()
    if hub:
        return hub.issue_pub_token(player_id)
    # fallback: issue local gh_token (should not happen normally)
    token = secrets.token_urlsafe(32)
    now   = datetime.now(timezone.utc)
    exp   = (now + timedelta(days=TOKEN_DAYS)).isoformat()
    with _db() as conn:
        conn.execute("INSERT INTO gh_tokens(token,player_id,created_at,expires_at) VALUES(?,?,?,?)",
                     (token, player_id, now.isoformat(), exp))
        conn.commit()
    return token

# ── Public auth endpoints ─────────────────────────────────────
# Game Hub has no login of its own. Identity comes entirely from Apps Hub:
# the frontend logs in through the central Apps Hub page and the resulting
# token is validated here via _resolve_token() / hub.get_pub_session().
# There are deliberately no /register or /login endpoints.

@_pub.post("/logout")
async def logout(x_gh_token: Optional[str] = Header(default=None)):
    if x_gh_token:
        hub = _apphub()
        if hub:
            hub.revoke_token(x_gh_token)
        else:
            with _db() as conn:
                conn.execute("DELETE FROM gh_tokens WHERE token=?", (x_gh_token,))
                conn.commit()
    return JSONResponse({"ok": True})

@_pub.get("/me")
async def me(x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    return JSONResponse({"id": p["id"], "username": p["username"],
                         "display_name": p["display_name"], "avatar_color": p["avatar_color"],
                         "avatar_data": p["avatar_data"], "avatar_svg": p["avatar_svg"]})

class MeUpdateBody(BaseModel):
    display_name: Optional[str] = None
    password:     Optional[str] = None
    avatar_data:  Optional[str] = None
    avatar_svg:   Optional[str] = None

@_pub.put("/me")
async def update_me(body: MeUpdateBody, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    fields, vals = [], []
    if body.display_name is not None:
        dn = body.display_name.strip()
        if not dn:
            raise HTTPException(400, detail="Display name required")
        fields.append("display_name=?"); vals.append(dn)
    if body.password:
        fields.append("password_hash=?"); vals.append(_hash_pw(body.password))
    if body.avatar_data is not None:
        fields.append("avatar_data=?"); vals.append(body.avatar_data)
    if body.avatar_svg is not None:
        fields.append("avatar_svg=?"); vals.append(body.avatar_svg)
    if fields:
        vals_with_id = vals + [p["id"]]
        with _db() as conn:
            conn.execute(f"UPDATE players SET {','.join(fields)} WHERE id=?", vals_with_id)
            conn.commit()
        hub = _apphub()
        if hub:
            sync = {"id": p["id"]}
            if body.display_name is not None: sync["display_name"] = body.display_name.strip()
            if body.password:                  sync["password_hash"] = _hash_pw(body.password)
            if body.avatar_data is not None:   sync["avatar_data"]   = body.avatar_data
            if body.avatar_svg is not None:    sync["avatar_svg"]    = body.avatar_svg
            hub.sync_user_from_backend(sync)
    return JSONResponse({"ok": True})

@_pub.get("/favourites")
async def get_favourites(x_gh_token: Optional[str] = Header(default=None)):
    # Favourites are now stored centrally in Apps Hub, shared with Chat and
    # any other app — this route just proxies so Game Hub's own UI is unchanged.
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    hub = _apphub()
    if not hub:
        return JSONResponse([])
    return JSONResponse(hub.get_favourites(p["id"]))

@_pub.post("/favourites/{fav_id}")
async def add_favourite(fav_id: str, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    hub = _apphub()
    if not hub:
        raise HTTPException(503, detail="Apps Hub unavailable")
    try:
        hub.add_favourite(p["id"], fav_id)
    except ValueError as e:
        raise HTTPException(400, detail=str(e))
    return JSONResponse({"ok": True})

@_pub.delete("/favourites/{fav_id}")
async def remove_favourite(fav_id: str, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    hub = _apphub()
    if hub:
        hub.remove_favourite(p["id"], fav_id)
    with _db() as conn:
        conn.execute("DELETE FROM player_favourites WHERE player_id=? AND favourite_id=?", (p["id"], fav_id))
        conn.commit()
    return JSONResponse({"ok": True})

@_pub.get("/players")
async def players_public():
    with _db() as conn:
        rows = conn.execute("SELECT id,username,display_name,avatar_color,avatar_data,avatar_svg FROM players ORDER BY display_name").fetchall()
    return JSONResponse([dict(r) for r in rows])

@_pub.get("/stats")
async def stats_public():
    return await _build_stats()

# ── Public session recording ──────────────────────────────────

class SessionPlayer(BaseModel):
    player_id:  Optional[str] = None
    guest_name: Optional[str] = None
    score:      Optional[float] = None
    rank:       Optional[int] = None
    is_winner:  bool = False

class SessionBody(BaseModel):
    game_id:          str
    mode:             str = 'multiplayer'
    players:          list[SessionPlayer]
    duration_seconds: Optional[int] = None
    metadata:         dict = {}

@_pub.post("/session")
async def record_session(body: SessionBody):
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        cur = conn.execute(
            "INSERT INTO game_sessions(game_id,mode,played_at,duration_seconds,metadata) VALUES(?,?,?,?,?)",
            (body.game_id, body.mode, now, body.duration_seconds, json.dumps(body.metadata))
        )
        sid = cur.lastrowid
        for p in body.players:
            if not p.player_id and not p.guest_name:
                continue
            conn.execute(
                "INSERT INTO session_players(session_id,player_id,guest_name,score,rank,is_winner) VALUES(?,?,?,?,?,?)",
                (sid, p.player_id or None, p.guest_name or None, p.score, p.rank, 1 if p.is_winner else 0)
            )
        conn.commit()
    return JSONResponse({"ok": True, "session_id": sid})

# ── Admin player management (mvmOS session required) ─────────

@_admin.get("/players")
async def list_players(session=Depends(get_current_session)):
    with _db() as conn:
        rows = conn.execute("SELECT id,username,display_name,avatar_color,avatar_data,avatar_svg,created_at FROM players ORDER BY display_name").fetchall()
    return JSONResponse([dict(r) for r in rows])

class PlayerBody(BaseModel):
    username:     str
    display_name: str
    avatar_color: str = '#89b4fa'
    password:     Optional[str] = None

@_admin.post("/players")
async def create_player(body: PlayerBody, session=Depends(get_current_session)):
    pid   = str(uuid.uuid4())[:8]
    now   = datetime.now(timezone.utc).isoformat()
    uname = body.username.strip().lower()
    dname = body.display_name.strip()
    phash = _hash_pw(body.password) if body.password else None
    try:
        with _db() as conn:
            conn.execute(
                "INSERT INTO players(id,username,display_name,avatar_color,password_hash,created_at) VALUES(?,?,?,?,?,?)",
                (pid, uname, dname, body.avatar_color, phash, now)
            )
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    hub = _apphub()
    if hub:
        hub.sync_user_from_backend({"id": pid, "username": uname, "display_name": dname,
                                    "avatar_color": body.avatar_color, "password_hash": phash, "created_at": now})
    return JSONResponse({"id": pid})

@_admin.put("/players/{pid}")
async def update_player(pid: str, body: PlayerBody, session=Depends(get_current_session)):
    uname = body.username.strip().lower()
    dname = body.display_name.strip()
    phash = _hash_pw(body.password) if body.password else None
    try:
        with _db() as conn:
            if phash:
                conn.execute("UPDATE players SET username=?,display_name=?,avatar_color=?,password_hash=? WHERE id=?",
                             (uname, dname, body.avatar_color, phash, pid))
            else:
                conn.execute("UPDATE players SET username=?,display_name=?,avatar_color=? WHERE id=?",
                             (uname, dname, body.avatar_color, pid))
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(400, detail="Username already exists")
    hub = _apphub()
    if hub:
        sync = {"id": pid, "username": uname, "display_name": dname, "avatar_color": body.avatar_color}
        if phash: sync["password_hash"] = phash
        hub.sync_user_from_backend(sync)
    return JSONResponse({"ok": True})

@_admin.delete("/players/{pid}")
async def delete_player(pid: str, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute("DELETE FROM players WHERE id=?", (pid,))
        conn.commit()
    hub = _apphub()
    if hub:
        try:
            with hub._db() as conn:
                conn.execute("DELETE FROM public_users WHERE id=?", (pid,))
                conn.commit()
        except Exception:
            pass
    return JSONResponse({"ok": True})

@_admin.get("/stats")
async def get_stats(session=Depends(get_current_session)):
    return await _build_stats()

# ── Stats builder ─────────────────────────────────────────────

async def _build_stats():
    # Fetch plugin metadata (name, icon) from main DB
    import sqlite3 as _sqlite3
    _main_db = os.path.join(os.path.dirname(__file__), "..", "..", "..", "data.db")
    _plugin_meta = {}
    try:
        _pc = _sqlite3.connect(_main_db)
        _pc.row_factory = _sqlite3.Row
        for r in _pc.execute("SELECT id,name,icon FROM plugins").fetchall():
            _plugin_meta[r["id"]] = {"name": r["name"], "icon": r["icon"]}
        _pc.close()
    except Exception:
        pass

    with _db() as conn:
        games   = [r["game_id"] for r in conn.execute("SELECT DISTINCT game_id FROM game_sessions ORDER BY game_id").fetchall()]
        players = {r["id"]: dict(r) for r in conn.execute("SELECT id,username,display_name,avatar_color,avatar_data,avatar_svg FROM players").fetchall()}

        leaderboard = {}
        for game_id in games:
            rows = conn.execute("""
                SELECT sp.player_id, p.display_name, p.avatar_color,
                       COUNT(*) as played, SUM(sp.is_winner) as wins,
                       MAX(sp.score) as best_score, AVG(sp.score) as avg_score
                FROM session_players sp JOIN players p ON sp.player_id=p.id
                WHERE sp.player_id IS NOT NULL
                  AND sp.session_id IN (SELECT id FROM game_sessions WHERE game_id=?)
                GROUP BY sp.player_id ORDER BY wins DESC, avg_score DESC
            """, (game_id,)).fetchall()
            leaderboard[game_id] = [dict(r) for r in rows]

        recent = conn.execute("""
            SELECT id,game_id,mode,played_at,duration_seconds,metadata FROM game_sessions
            ORDER BY played_at DESC LIMIT 50
        """).fetchall()
        recent_out = []
        for gs in recent:
            sp = conn.execute("""
                SELECT sp.player_id,sp.guest_name,sp.score,sp.is_winner,p.display_name,p.avatar_color
                FROM session_players sp LEFT JOIN players p ON sp.player_id=p.id
                WHERE sp.session_id=? ORDER BY sp.rank,sp.score DESC
            """, (gs["id"],)).fetchall()
            recent_out.append({**dict(gs), "players": [dict(p) for p in sp]})

        h2h_rows = conn.execute("""
            SELECT a.player_id as p1, b.player_id as p2,
                   SUM(CASE WHEN a.is_winner=1 THEN 1 ELSE 0 END) as p1_wins,
                   SUM(CASE WHEN b.is_winner=1 THEN 1 ELSE 0 END) as p2_wins,
                   COUNT(*) as total
            FROM session_players a
            JOIN session_players b ON a.session_id=b.session_id AND a.player_id < b.player_id
            WHERE a.player_id IS NOT NULL AND b.player_id IS NOT NULL
            GROUP BY a.player_id, b.player_id
        """).fetchall()

    return JSONResponse({
        "games": games,
        "game_meta": _plugin_meta,
        "leaderboard": leaderboard,
        "recent": recent_out,
        "head2head": [dict(r) for r in h2h_rows],
        "players": list(players.values()),
    })

# ── Hub settings ─────────────────────────────────────────────

def _get_hub_settings(conn) -> dict:
    rows = conn.execute("SELECT key,value FROM hub_settings").fetchall()
    s = {r["key"]: r["value"] for r in rows}
    return {
        "public":               s.get("public", "true") == "true",
        "allow_registrations":  s.get("allow_registrations", "true") == "true",
    }

@_pub.get("/config")
async def hub_config():
    with _db() as conn:
        return JSONResponse(_get_hub_settings(conn))

class HubSettingsBody(BaseModel):
    allow_registrations: bool

@_admin.get("/settings")
async def get_hub_settings_admin(session=Depends(get_current_session)):
    with _db() as conn:
        return JSONResponse(_get_hub_settings(conn))

@_admin.put("/settings")
async def update_hub_settings(body: HubSettingsBody, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO hub_settings(key,value) VALUES('allow_registrations',?)",
                     ("true" if body.allow_registrations else "false",))
        conn.commit()
    return JSONResponse({"ok": True})

# ── Invites ───────────────────────────────────────────────────

class InviteBody(BaseModel):
    to_ids:   list[str]
    game_id:  str
    room_url: str

@_pub.post("/invite")
async def send_invite(body: InviteBody, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    now = datetime.now(timezone.utc)
    exp = (now + timedelta(hours=2)).isoformat()
    now_s = now.isoformat()
    with _db() as conn:
        # delete old pending invites from this sender only for the specific recipients being (re-)invited
        if body.to_ids:
            placeholders = ",".join("?" for _ in body.to_ids)
            conn.execute(
                f"DELETE FROM invites WHERE from_id=? AND room_url=? AND to_id IN ({placeholders})",
                [p["id"], body.room_url] + list(body.to_ids)
            )
        for to_id in body.to_ids:
            if to_id == p["id"]:
                continue
            exists = conn.execute("SELECT id FROM players WHERE id=?", (to_id,)).fetchone()
            if not exists:
                continue
            conn.execute(
                "INSERT INTO invites(from_id,to_id,game_id,room_url,created_at,expires_at) VALUES(?,?,?,?,?,?)",
                (p["id"], to_id, body.game_id, body.room_url, now_s, exp)
            )
        conn.commit()
    return JSONResponse({"ok": True})

@_pub.get("/invites")
async def get_invites(x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        rows = conn.execute("""
            SELECT i.id, i.game_id, i.room_url, i.created_at,
                   pl.display_name as from_name, pl.avatar_color as from_color
            FROM invites i JOIN players pl ON pl.id = i.from_id
            WHERE i.to_id=? AND i.expires_at>?
            ORDER BY i.created_at DESC
        """, (p["id"], now)).fetchall()
    return JSONResponse([dict(r) for r in rows])

@_pub.delete("/invites/{invite_id}")
async def dismiss_invite(invite_id: int, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    with _db() as conn:
        conn.execute("DELETE FROM invites WHERE id=? AND to_id=?", (invite_id, p["id"]))
        conn.commit()
    return JSONResponse({"ok": True})

@_pub.delete("/invites")
async def cancel_my_invites(room_url: str, x_gh_token: Optional[str] = Header(default=None)):
    p = _resolve_token(x_gh_token)
    if not p:
        raise HTTPException(401)
    with _db() as conn:
        conn.execute("DELETE FROM invites WHERE from_id=? AND room_url=?", (p["id"], room_url))
        conn.commit()
    return JSONResponse({"ok": True})

# Combine into single router for the loader.
# _admin (/api/gamehub) is already local-only via the global auth middleware.
# The public surface (_pub and the multiplayer router) is gated by _gate_public,
# so that setting Game Hub to Private in Apps Hub makes it reachable only locally.
router.include_router(_admin)
router.include_router(_pub, dependencies=[Depends(_gate_public)])

# ── Multiplayer framework ─────────────────────────────────────
# Generic, game-agnostic multiplayer host lives in mp.py (sibling file).
# Loaded here because the app loader only execs backend.py per app.
try:
    import importlib.util as _ilu
    _mp_path = os.path.join(os.path.dirname(__file__), "mp.py")
    if os.path.isfile(_mp_path):
        _spec = _ilu.spec_from_file_location("gamehub_mp", _mp_path)
        _mp = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_mp)
        router.include_router(_mp.router)
        print("[gamehub] multiplayer framework loaded")
except Exception as _e:
    print(f"[gamehub] failed to load multiplayer framework: {_e}")
