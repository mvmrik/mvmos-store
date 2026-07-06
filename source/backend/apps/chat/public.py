"""
mvmOS Chat — direct messages between Apps Hub users, local to this server.

Mounted at /pub/chat by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header for REST, an initial {"type":"join","token":...}
frame for the websocket) — used identically by the in-app mvmOS window and
by the standalone public page, so there is no separate backend.py.
"""

import asyncio
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

router = APIRouter()

APP_ID = "chat"

_DIR        = os.path.dirname(__file__)                                   # backend/apps/chat
_DB_PATH    = os.path.join(_DIR, "..", "..", "..", "apps", "chat", "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "..", "..", "..", "apps", "chat", "public")

HEARTBEAT = 25

# user_id -> set[WebSocket] — every open tab/device for that user
_conns: dict = {}


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages (
                id         TEXT PRIMARY KEY,
                from_id    TEXT NOT NULL,
                to_id      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                read_at    TEXT,
                edited_at  TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id, to_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_messages_to   ON messages(to_id, from_id, created_at);
            CREATE TABLE IF NOT EXISTS hidden_for (
                message_id TEXT NOT NULL,
                user_id    TEXT NOT NULL,
                PRIMARY KEY (message_id, user_id)
            );
        """)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(messages)")}
        if "edited_at" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT")
        conn.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mvmOS Chat</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">mvmOS Chat is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/telegram")
async def telegram_mini_app():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "telegram.html"))


# ── REST ─────────────────────────────────────────────────────────────────

@router.get("/conversations")
async def conversations(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    uid = me["id"]
    with _db() as conn:
        rows = conn.execute(
            """SELECT CASE WHEN m.from_id=? THEN m.to_id ELSE m.from_id END AS peer_id,
                      m.body, m.created_at, m.to_id, m.read_at
               FROM messages m
               LEFT JOIN hidden_for hf ON hf.message_id = m.id AND hf.user_id = ?
               WHERE (m.from_id=? OR m.to_id=?) AND hf.message_id IS NULL
               ORDER BY m.created_at DESC""",
            (uid, uid, uid, uid)
        ).fetchall()

    last = {}
    unread = {}
    for r in rows:
        pid = r["peer_id"]
        if pid not in last:
            last[pid] = {"body": r["body"], "created_at": r["created_at"]}
        if r["to_id"] == uid and r["read_at"] is None:
            unread[pid] = unread.get(pid, 0) + 1

    hub = _hub()
    profiles = {u["id"]: u for u in hub.get_users_by_ids(list(last.keys()))} if hub else {}

    out = []
    for pid, info in last.items():
        p = profiles.get(pid, {})
        out.append({
            "peer_id":      pid,
            "username":     p.get("username", ""),
            "display_name": p.get("display_name", "?"),
            "avatar_color": p.get("avatar_color", "#89b4fa"),
            "avatar_svg":   p.get("avatar_svg"),
            "last_body":    info["body"],
            "last_at":      info["created_at"],
            "unread":       unread.get(pid, 0),
        })
    out.sort(key=lambda c: c["last_at"], reverse=True)
    return JSONResponse(out)


@router.get("/messages/{peer_id}")
async def messages(peer_id: str, before: str = None, limit: int = 50,
                    x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    uid = me["id"]
    limit = max(1, min(limit, 200))

    q = """SELECT m.id, m.from_id, m.to_id, m.body, m.created_at, m.edited_at FROM messages m
           LEFT JOIN hidden_for hf ON hf.message_id = m.id AND hf.user_id = ?
           WHERE hf.message_id IS NULL AND ((m.from_id=? AND m.to_id=?) OR (m.from_id=? AND m.to_id=?))"""
    params = [uid, uid, peer_id, peer_id, uid]
    if before:
        q += " AND m.created_at < ?"
        params.append(before)
    q += " ORDER BY m.created_at DESC LIMIT ?"
    params.append(limit)

    with _db() as conn:
        rows = conn.execute(q, params).fetchall()
        conn.execute(
            "UPDATE messages SET read_at=? WHERE to_id=? AND from_id=? AND read_at IS NULL",
            (_now(), uid, peer_id)
        )
        conn.commit()

    out = [dict(r) for r in rows]
    out.reverse()
    return JSONResponse(out)


# ── WebSocket ────────────────────────────────────────────────────────────

async def _send(ws: WebSocket, msg: dict):
    try:
        await ws.send_text(json.dumps(msg))
    except Exception:
        pass


async def _push(user_id: str, msg: dict):
    for ws in list(_conns.get(user_id, ())):
        await _send(ws, msg)


@router.websocket("/ws")
async def chat_ws(websocket: WebSocket):
    await websocket.accept()
    uid = None
    hb_task = None
    try:
        try:
            first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=10.0))
        except Exception:
            await websocket.close()
            return
        if first.get("type") != "join":
            await _send(websocket, {"type": "error", "message": "expected join"})
            await websocket.close()
            return

        me = _resolve(first.get("token", ""))
        if not me:
            await _send(websocket, {"type": "error", "message": "unauthorized"})
            await websocket.close()
            return
        uid = me["id"]
        _conns.setdefault(uid, set()).add(websocket)

        await _send(websocket, {"type": "joined", "user": {
            "id":           uid,
            "username":     me.get("username", ""),
            "display_name": me.get("display_name", "?"),
            "avatar_color": me.get("avatar_color", "#89b4fa"),
            "avatar_svg":   me.get("avatar_svg"),
        }})

        async def _hb():
            while True:
                await asyncio.sleep(HEARTBEAT)
                try:
                    await websocket.send_text('{"type":"ping"}')
                except Exception:
                    break
        hb_task = asyncio.create_task(_hb())

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
            if t == "send":
                to_id = str(msg.get("to", "")).strip()
                body  = str(msg.get("body", "")).strip()[:4000]
                if not to_id or not body:
                    continue
                mid = str(uuid.uuid4())
                now = _now()
                with _db() as conn:
                    conn.execute(
                        "INSERT INTO messages(id,from_id,to_id,body,created_at) VALUES(?,?,?,?,?)",
                        (mid, uid, to_id, body, now)
                    )
                    conn.commit()
                payload = {
                    "type": "message", "id": mid, "from": uid, "to": to_id,
                    "body": body, "created_at": now, "client_id": msg.get("client_id"),
                }
                await _push(uid, payload)
                if to_id != uid:
                    await _push(to_id, payload)
                    if not _conns.get(to_id):
                        tg = sys.modules.get("app_backend_telegramhub")
                        if tg:
                            sender = me.get("display_name", "?")
                            base = tg.get_public_base_url() or ""
                            url = f"{base.rstrip('/')}/pub/chat/telegram?peer={uid}"
                            tg.notify(to_id, "chat", f"💬 {sender}: {body}", web_app=url)
                continue

            if t == "typing":
                to_id = str(msg.get("to", "")).strip()
                if to_id and to_id != uid:
                    await _push(to_id, {"type": "typing", "from": uid})
                continue

            if t == "edit":
                mid  = str(msg.get("id", "")).strip()
                body = str(msg.get("body", "")).strip()[:4000]
                if not mid or not body:
                    continue
                now = _now()
                with _db() as conn:
                    row = conn.execute("SELECT from_id, to_id FROM messages WHERE id=?", (mid,)).fetchone()
                    if not row or row["from_id"] != uid:
                        continue
                    conn.execute("UPDATE messages SET body=?, edited_at=? WHERE id=?", (body, now, mid))
                    conn.commit()
                    to_id = row["to_id"]
                payload = {"type": "edited", "id": mid, "body": body, "edited_at": now}
                await _push(uid, payload)
                if to_id != uid:
                    await _push(to_id, payload)
                continue

            if t == "delete":
                mid = str(msg.get("id", "")).strip()
                for_everyone = bool(msg.get("for_everyone"))
                if not mid:
                    continue
                with _db() as conn:
                    row = conn.execute("SELECT from_id, to_id FROM messages WHERE id=?", (mid,)).fetchone()
                    if not row or uid not in (row["from_id"], row["to_id"]):
                        continue
                    if for_everyone:
                        if row["from_id"] != uid:
                            continue
                        conn.execute("DELETE FROM messages WHERE id=?", (mid,))
                        conn.execute("DELETE FROM hidden_for WHERE message_id=?", (mid,))
                        conn.commit()
                        to_id = row["to_id"]
                        payload = {"type": "deleted", "id": mid}
                        await _push(uid, payload)
                        if to_id != uid:
                            await _push(to_id, payload)
                    else:
                        conn.execute("INSERT OR IGNORE INTO hidden_for(message_id, user_id) VALUES(?,?)", (mid, uid))
                        conn.commit()
                        await _push(uid, {"type": "deleted", "id": mid})
                continue

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if hb_task:
            hb_task.cancel()
        if uid and uid in _conns:
            _conns[uid].discard(websocket)
            if not _conns[uid]:
                del _conns[uid]
