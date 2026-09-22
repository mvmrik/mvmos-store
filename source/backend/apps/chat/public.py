"""
mvmOS Chat — conversations between Apps Hub users, local to this server.
A conversation is either a direct one (exactly two people, or one person
talking to themselves) or a group. Both share the same tables, so every rule
below — who may read, who may write, what counts as unread — is one rule.

Mounted at /pub/chat by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header for REST, an initial {"type":"join","token":...}
frame for the websocket) — used identically by the in-app mvmOS window and
by the standalone public page, so there is no separate backend.py.

Storage is SQLite in apps/chat/data.db. That is a deliberate fit for one
server: a chat writes tiny rows, WAL lets readers run beside the writer, and
there is nothing to install or back up separately. What keeps it fast is how it
is used: every connection sets synchronous=NORMAL (the default FULL waits for a
disk flush on every message, which on this hardware capped delivery at about
fifty a second and stalled the whole server for each one) and a busy timeout,
and no query runs on the event loop — each goes through a worker thread.

Membership is checked on the server for every read, write, edit, delete and
typing signal; the client is never trusted to say which conversation it may
touch. A member sees a group's messages from the moment they joined.

End-to-end encrypted conversations are a Premium feature whose logic lives in
apps/chat/premium/backend.py (downloaded only for licensed installs). This file
keeps just the skeleton: the flags on a conversation, and a hook at every place
where an encrypted conversation must be treated differently. Without that module,
or while the administrator has the feature off, an encrypted conversation is
locked: it is listed, but its content is neither shown, accepted nor delivered.
The server never sees an encrypted message in the clear.
"""

import asyncio
import html
import json
import os
import sqlite3
import sys
import time
import uuid
from collections import deque
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Body, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

router = APIRouter()
desktop_router = APIRouter()      # mounted by public_loader at /api/apps/chat (desktop session)

APP_ID = "chat"

_DIR        = os.path.dirname(__file__)                                   # backend/apps/chat
_DB_PATH    = os.path.join(_DIR, "..", "..", "..", "apps", "chat", "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "..", "..", "..", "apps", "chat", "public")

HEARTBEAT         = 25
MAX_BODY          = 4000
MAX_TITLE         = 60
MAX_RAW           = 20000  # hard cap on any frame body before it is even looked at
MAX_GROUP_MEMBERS = 50
RATE_WINDOW       = 10     # seconds
RATE_MAX          = 20     # messages per RATE_WINDOW per user

# user_id -> set[WebSocket] — every open tab/device for that user
_conns: dict = {}

# user_id -> send timestamps inside the rate window
_sent: dict = {}

# Fire-and-forget tasks need a strong reference or they can be collected mid-run.
_bg: set = set()


def _hub():
    return sys.modules.get("backend.apphub")


class ChatError(Exception):
    def __init__(self, code: str, status: int = 400, extra: Optional[dict] = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra or {}


# ── Premium hook: end-to-end encryption ──────────────────────────────────

_ENC_TTL = 5.0
_enc_mod = {"mtime": None, "mod": None}
_enc_state = {"at": 0.0, "mod": None}


def _premium_module():
    """apps/chat/premium/backend.py while the licence is valid, else None.
    load_premium_backend() executes the file afresh on every call, so the
    module is kept until the file on disk changes or disappears."""
    path = os.path.join(_DIR, "..", "..", "..", "apps", "chat", "premium", "backend.py")
    try:
        mtime = os.stat(path).st_mtime_ns
    except OSError:
        _enc_mod.update(mtime=None, mod=None)
        return None
    if _enc_mod["mtime"] != mtime or _enc_mod["mod"] is None:
        core = sys.modules.get("backend.premium")
        _enc_mod.update(mtime=mtime, mod=core.load_premium_backend(APP_ID) if core else None)
    mod = _enc_mod["mod"]
    try:
        return mod if mod and mod.is_available() else None
    except Exception:
        return None


def _enc():
    """The premium module when encrypted chats are switched on, else None.
    The on/off answer is remembered for a few seconds: it is asked on every
    conversation list and every message."""
    now = time.monotonic()
    if now - _enc_state["at"] > _ENC_TTL:
        mod = _premium_module()
        try:
            on = bool(mod and mod.enabled())
        except Exception:
            on = False
        _enc_state.update(at=now, mod=mod if on else None)
    return _enc_state["mod"]


def _enc_reset():
    _enc_state["at"] = 0.0


def _need_enc():
    mod = _enc()
    if not mod:
        raise ChatError("encryption_unavailable", 402)
    return mod


# ── Database ─────────────────────────────────────────────────────────────

@contextmanager
def _conn():
    """One short-lived connection: commit on success, roll back on error, and
    always close (a bare `with sqlite3.connect()` only commits)."""
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA synchronous=NORMAL")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        title      TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        dm_key     TEXT UNIQUE,
        encrypted      INTEGER NOT NULL DEFAULT 0,
        key_version    INTEGER NOT NULL DEFAULT 0,
        needs_rotation INTEGER NOT NULL DEFAULT 0
    )""",
    """CREATE TABLE IF NOT EXISTS members (
        conversation_id TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        role            TEXT NOT NULL DEFAULT 'member',
        joined_at       TEXT NOT NULL DEFAULT '',
        last_read_at    TEXT,
        PRIMARY KEY (conversation_id, user_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id)",
    """CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id       TEXT NOT NULL,
        body            TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        edited_at       TEXT,
        key_version     INTEGER
    )""",
    "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at)",
    """CREATE TABLE IF NOT EXISTS hidden_for (
        message_id TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id)
    )""",
]


def _copy_legacy(conn):
    """Turn the old from_id/to_id table into direct conversations.

    Every unordered pair of people becomes one conversation. The old per-message
    read_at becomes each person's read pointer: everything before their oldest
    unread message counts as read, so nobody loses or gains unread badges."""
    pairs = conn.execute(
        "SELECT DISTINCT CASE WHEN from_id<to_id THEN from_id ELSE to_id END AS a, "
        "                CASE WHEN from_id<to_id THEN to_id ELSE from_id END AS b "
        "FROM messages_legacy"
    ).fetchall()
    for p in pairs:
        a, b = p["a"], p["b"]
        cid = str(uuid.uuid4())
        first = conn.execute(
            "SELECT MIN(created_at) FROM messages_legacy "
            "WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)", (a, b, b, a)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO conversations(id,type,title,created_by,created_at,dm_key) VALUES(?,?,?,?,?,?)",
            (cid, "dm", None, a, first, f"{a}:{b}"),
        )
        for u, peer in ([(a, b), (b, a)] if a != b else [(a, a)]):
            unread_first = None
            if u != peer:
                unread_first = conn.execute(
                    "SELECT MIN(created_at) FROM messages_legacy "
                    "WHERE from_id=? AND to_id=? AND read_at IS NULL", (peer, u)
                ).fetchone()[0]
            if unread_first is None:
                last_read = conn.execute(
                    "SELECT MAX(created_at) FROM messages_legacy "
                    "WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)", (a, b, b, a)
                ).fetchone()[0]
            else:
                last_read = conn.execute(
                    "SELECT MAX(created_at) FROM messages_legacy "
                    "WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?)) AND created_at<?",
                    (a, b, b, a, unread_first),
                ).fetchone()[0] or ""
            conn.execute(
                "INSERT INTO members(conversation_id,user_id,role,joined_at,last_read_at) VALUES(?,?,?,?,?)",
                (cid, u, "member", "", last_read),
            )
    conn.execute(
        "INSERT INTO messages(id,conversation_id,sender_id,body,created_at,edited_at) "
        "SELECT l.id, c.id, l.from_id, l.body, l.created_at, l.edited_at "
        "FROM messages_legacy l JOIN conversations c ON c.dm_key = "
        "CASE WHEN l.from_id<l.to_id THEN l.from_id||':'||l.to_id ELSE l.to_id||':'||l.from_id END"
    )


def _init_db():
    """Create the schema, and move a pre-group database over in one transaction:
    if anything fails it rolls back and the old table is untouched."""
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("BEGIN IMMEDIATE")
        try:
            cols = {r[1] for r in conn.execute("PRAGMA table_info(messages)")}
            legacy = "from_id" in cols
            if legacy:
                if "edited_at" not in cols:
                    conn.execute("ALTER TABLE messages ADD COLUMN edited_at TEXT")
                conn.execute("ALTER TABLE messages RENAME TO messages_legacy")
            for stmt in _SCHEMA:
                conn.execute(stmt)
            # Columns added after the first group-chat release.
            for table, column, ddl in (
                ("conversations", "encrypted",      "INTEGER NOT NULL DEFAULT 0"),
                ("conversations", "key_version",    "INTEGER NOT NULL DEFAULT 0"),
                ("conversations", "needs_rotation", "INTEGER NOT NULL DEFAULT 0"),
                ("messages",      "key_version",    "INTEGER"),
            ):
                have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                if column not in have:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            if legacy:
                _copy_legacy(conn)
                conn.execute("DROP TABLE messages_legacy")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _profiles(ids) -> dict:
    hub = _hub()
    ids = [i for i in dict.fromkeys(ids) if i]
    if not hub or not ids:
        return {}
    return {u["id"]: u for u in hub.get_users_by_ids(ids)}


def _profile_out(u: dict, uid: str) -> dict:
    return {
        "id":           uid,
        "username":     (u or {}).get("username", ""),
        "display_name": (u or {}).get("display_name", "?"),
        "avatar_color": (u or {}).get("avatar_color", "#89b4fa"),
        "avatar_svg":   (u or {}).get("avatar_svg"),
    }


# ── Conversation queries (all synchronous — call through a thread) ───────

# One row per conversation the user is in: last visible message and unread
# count computed in SQL, so the cost does not grow with the length of history.
# A message counts only if it is not hidden for this user and was sent at or
# after the moment they joined.
_CONV_SQL = """
SELECT c.id, c.type, c.title, c.created_at AS conv_created, m.role,
       c.encrypted, c.key_version, c.needs_rotation, lm.key_version AS last_kv,
       COALESCE((SELECT p.user_id FROM members p
                  WHERE p.conversation_id=c.id AND p.user_id<>:u LIMIT 1), :u) AS peer_id,
       (SELECT COUNT(*) FROM members WHERE conversation_id=c.id) AS member_count,
       lm.sender_id AS last_sender_id, lm.body AS last_body, lm.created_at AS last_at,
       (SELECT COUNT(*) FROM messages x
          LEFT JOIN hidden_for h ON h.message_id=x.id AND h.user_id=:u
         WHERE x.conversation_id=c.id AND x.sender_id<>:u
           AND x.created_at>COALESCE(m.last_read_at,'') AND x.created_at>=m.joined_at
           AND h.message_id IS NULL) AS unread
FROM members m
JOIN conversations c ON c.id=m.conversation_id
LEFT JOIN messages lm ON lm.id=(
    SELECT x.id FROM messages x
    LEFT JOIN hidden_for h ON h.message_id=x.id AND h.user_id=:u
    WHERE x.conversation_id=c.id AND x.created_at>=m.joined_at AND h.message_id IS NULL
    ORDER BY x.created_at DESC LIMIT 1)
WHERE m.user_id=:u
"""


def _summaries(uid: str, cid: str = None) -> list:
    with _conn() as conn:
        if cid:
            rows = conn.execute(_CONV_SQL + " AND c.id=:cid", {"u": uid, "cid": cid}).fetchall()
        else:
            # A direct conversation nobody has written in yet stays out of the
            # list; a fresh group still shows, so its creator can find it.
            rows = conn.execute(
                _CONV_SQL + " AND (c.type='group' OR lm.id IS NOT NULL)", {"u": uid}
            ).fetchall()
    ids = []
    for r in rows:
        if r["type"] == "dm":
            ids.append(r["peer_id"])
        if r["last_sender_id"]:
            ids.append(r["last_sender_id"])
    prof = _profiles(ids)
    enc_on = bool(_enc())
    out = []
    for r in rows:
        # An encrypted conversation whose feature is off is listed but empty:
        # what is stored is ciphertext nobody may work with right now.
        locked = bool(r["encrypted"]) and not enc_on
        item = {
            "id":               r["id"],
            "type":             r["type"],
            "title":            None if locked else r["title"],
            "role":             r["role"],
            "member_count":     r["member_count"],
            "encrypted":        bool(r["encrypted"]),
            "locked":           locked,
            "key_version":      r["key_version"],
            "needs_rotation":   bool(r["needs_rotation"]),
            "peer":             _profile_out(prof.get(r["peer_id"]), r["peer_id"]) if r["type"] == "dm" else None,
            "last_body":        "" if locked else (r["last_body"] or ""),
            "last_kv":          r["last_kv"],
            "last_at":          r["last_at"],
            "last_sender_id":   r["last_sender_id"],
            "last_sender_name": (prof.get(r["last_sender_id"]) or {}).get("display_name", "") if r["last_sender_id"] else "",
            "unread":           r["unread"],
            "sort_at":          r["last_at"] or r["conv_created"],
        }
        out.append(item)
    out.sort(key=lambda c: c["sort_at"], reverse=True)
    return out


def _detail(uid: str, cid: str) -> dict:
    s = _summaries(uid, cid)
    if not s:
        raise ChatError("not_found", 404)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT user_id, role FROM members WHERE conversation_id=? ORDER BY joined_at, user_id", (cid,)
        ).fetchall()
    prof = _profiles([r["user_id"] for r in rows])
    d = s[0]
    d["members"] = [dict(_profile_out(prof.get(r["user_id"]), r["user_id"]), role=r["role"]) for r in rows]
    return d


def _member_ids(uid: str, cid: str) -> Optional[list]:
    """Everyone in the conversation, or None if `uid` is not one of them."""
    with _conn() as conn:
        ids = [r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))]
    return ids if uid in ids else None


def _get_messages(uid: str, cid: str, before: Optional[str], limit: int) -> dict:
    with _conn() as conn:
        mem = conn.execute(
            "SELECT m.joined_at, c.encrypted FROM members m JOIN conversations c ON c.id=m.conversation_id "
            "WHERE m.conversation_id=? AND m.user_id=?", (cid, uid)
        ).fetchone()
        if not mem:
            raise ChatError("not_found", 404)
        if mem["encrypted"]:
            _need_enc()
        q = ("SELECT x.id, x.sender_id AS 'from', x.body, x.created_at, x.edited_at, x.key_version FROM messages x "
             "LEFT JOIN hidden_for h ON h.message_id=x.id AND h.user_id=? "
             "WHERE x.conversation_id=? AND x.created_at>=? AND h.message_id IS NULL")
        params = [uid, cid, mem["joined_at"]]
        if before:
            q += " AND x.created_at<?"
            params.append(before)
        q += " ORDER BY x.created_at DESC LIMIT ?"
        params.append(limit)
        rows = [dict(r) for r in conn.execute(q, params).fetchall()]
        _mark_read(conn, uid, cid)
    rows.reverse()
    prof = _profiles([r["from"] for r in rows])
    return {
        "messages": rows,
        "users": {i: _profile_out(prof.get(i), i) for i in {r["from"] for r in rows}},
    }


def _mark_read(conn, uid: str, cid: str):
    """Move the read pointer to the newest message; it never moves backwards."""
    conn.execute(
        "UPDATE members SET last_read_at=(SELECT MAX(created_at) FROM messages WHERE conversation_id=:c) "
        "WHERE conversation_id=:c AND user_id=:u AND "
        "(last_read_at IS NULL OR last_read_at<(SELECT MAX(created_at) FROM messages WHERE conversation_id=:c))",
        {"c": cid, "u": uid},
    )


def _db_mark_read(uid: str, cid: str):
    with _conn() as conn:
        _mark_read(conn, uid, cid)


def _db_send(uid: str, cid: str, body: str, key_version=None) -> Optional[dict]:
    with _conn() as conn:
        conv = conn.execute(
            "SELECT c.type, c.title, c.encrypted, c.key_version FROM conversations c "
            "JOIN members m ON m.conversation_id=c.id WHERE c.id=? AND m.user_id=?", (cid, uid)
        ).fetchone()
        if not conv:
            return None
        if conv["encrypted"]:
            # Ciphertext is stored as it arrived: cutting it would corrupt it.
            kv = _need_enc().check_message(body, key_version, conv["key_version"])
        else:
            body, kv = body[:MAX_BODY], None
        mid, now = str(uuid.uuid4()), _now()
        conn.execute(
            "INSERT INTO messages(id,conversation_id,sender_id,body,created_at,key_version) VALUES(?,?,?,?,?,?)",
            (mid, cid, uid, body, now, kv),
        )
        members = [r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))]
    return {"id": mid, "created_at": now, "type": conv["type"], "title": conv["title"], "members": members,
            "body": body, "encrypted": bool(conv["encrypted"]), "key_version": kv}


def _db_edit(uid: str, mid: str, body: str, key_version=None) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT x.conversation_id, x.sender_id, c.encrypted, c.key_version FROM messages x "
            "JOIN conversations c ON c.id=x.conversation_id WHERE x.id=?", (mid,)
        ).fetchone()
        if not row or row["sender_id"] != uid:
            return None
        cid = row["conversation_id"]
        members = [r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))]
        if uid not in members:
            return None
        if row["encrypted"]:
            kv = _need_enc().check_message(body, key_version, row["key_version"])
        else:
            body, kv = body[:MAX_BODY], None
        now = _now()
        conn.execute("UPDATE messages SET body=?, edited_at=?, key_version=? WHERE id=?", (body, now, kv, mid))
    return {"conversation_id": cid, "edited_at": now, "members": members, "body": body,
            "encrypted": bool(row["encrypted"]), "key_version": kv}


def _db_delete(uid: str, mid: str, for_everyone: bool) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute("SELECT conversation_id, sender_id FROM messages WHERE id=?", (mid,)).fetchone()
        if not row:
            return None
        cid = row["conversation_id"]
        members = [r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))]
        if uid not in members:
            return None
        if for_everyone:
            if row["sender_id"] != uid:
                return None
            conn.execute("DELETE FROM messages WHERE id=?", (mid,))
            conn.execute("DELETE FROM hidden_for WHERE message_id=?", (mid,))
            return {"conversation_id": cid, "members": members}
        conn.execute("INSERT OR IGNORE INTO hidden_for(message_id, user_id) VALUES(?,?)", (mid, uid))
    return {"conversation_id": cid, "members": [uid]}


# ── Direct and group management ──────────────────────────────────────────

def _existing_users(ids) -> set:
    return set(_profiles(ids).keys())


def _clean_title(title) -> str:
    title = " ".join(str(title or "").split())[:MAX_TITLE]
    if not title:
        raise ChatError("invalid")
    return title


def _db_open_dm(uid: str, peer: str) -> str:
    if not peer or peer == uid:
        raise ChatError("invalid")
    if peer not in _existing_users([peer]):
        raise ChatError("not_found", 404)
    a, b = sorted((uid, peer))
    key = f"{a}:{b}"
    with _conn() as conn:
        row = conn.execute("SELECT id FROM conversations WHERE dm_key=?", (key,)).fetchone()
        if row:
            return row["id"]
        cid, now = str(uuid.uuid4()), _now()
        try:
            conn.execute(
                "INSERT INTO conversations(id,type,title,created_by,created_at,dm_key) VALUES(?,?,?,?,?,?)",
                (cid, "dm", None, uid, now, key),
            )
        except sqlite3.IntegrityError:          # the other person opened it at the same moment
            return conn.execute("SELECT id FROM conversations WHERE dm_key=?", (key,)).fetchone()["id"]
        for u in (uid, peer):
            conn.execute(
                "INSERT INTO members(conversation_id,user_id,role,joined_at,last_read_at) VALUES(?,?,?,?,?)",
                (cid, u, "member", "", None),
            )
    return cid


def _db_create_group(uid: str, title: str, member_ids: list) -> dict:
    title = _clean_title(title)
    ids = [i for i in dict.fromkeys(str(m).strip() for m in member_ids or []) if i and i != uid]
    real = _existing_users(ids)
    ids = [i for i in ids if i in real]
    if not ids:
        raise ChatError("invalid")
    if len(ids) + 1 > MAX_GROUP_MEMBERS:
        raise ChatError("too_many")
    cid, now = str(uuid.uuid4()), _now()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO conversations(id,type,title,created_by,created_at,dm_key) VALUES(?,?,?,?,?,NULL)",
            (cid, "group", title, uid, now),
        )
        conn.execute(
            "INSERT INTO members(conversation_id,user_id,role,joined_at,last_read_at) VALUES(?,?,?,?,?)",
            (cid, uid, "admin", now, None),
        )
        for m in ids:
            conn.execute(
                "INSERT INTO members(conversation_id,user_id,role,joined_at,last_read_at) VALUES(?,?,?,?,?)",
                (cid, m, "member", now, None),
            )
    return {"id": cid, "members": [uid] + ids}


def _db_open_encrypted_dm(uid: str, peer: str, wraps) -> str:
    return _need_enc().open_dm(uid, peer, wraps)


def _db_create_encrypted_group(uid: str, title: str, member_ids: list, wraps) -> dict:
    return _need_enc().create_group(uid, title, member_ids, wraps)


def _group_admin_check(conn, uid: str, cid: str):
    """Returns the group's row (title, encrypted, ...) if `uid` is an admin of
    it; raises otherwise."""
    row = conn.execute(
        "SELECT c.type, c.title, c.encrypted, c.key_version, m.role FROM conversations c "
        "JOIN members m ON m.conversation_id=c.id WHERE c.id=? AND m.user_id=?", (cid, uid)
    ).fetchone()
    if not row or row["type"] != "group":
        raise ChatError("not_found", 404)
    if row["role"] != "admin":
        raise ChatError("forbidden", 403)
    return row


def _db_rename(uid: str, cid: str, title: str) -> list:
    with _conn() as conn:
        group = _group_admin_check(conn, uid, cid)
        # An encrypted group's title is ciphertext, so it is checked and kept
        # as sent instead of being tidied and shortened.
        title = _need_enc().check_title(title, group["key_version"]) if group["encrypted"] else _clean_title(title)
        conn.execute("UPDATE conversations SET title=? WHERE id=?", (title, cid))
        return [r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))]


def _db_add_members(uid: str, cid: str, ids: list) -> dict:
    ids = [i for i in dict.fromkeys(str(m).strip() for m in ids or []) if i]
    real = _existing_users(ids)
    ids = [i for i in ids if i in real]
    if not ids:
        raise ChatError("invalid")
    with _conn() as conn:
        group = _group_admin_check(conn, uid, cid)
        current = {r[0] for r in conn.execute("SELECT user_id FROM members WHERE conversation_id=?", (cid,))}
        new = [i for i in ids if i not in current]
        if len(current) + len(new) > MAX_GROUP_MEMBERS:
            raise ChatError("too_many")
        if group["encrypted"] and new:
            # Nobody can be given the key of a group before they have keys of their own.
            _need_enc().require_keys(conn, new)
        now = _now()
        for m in new:
            conn.execute(
                "INSERT INTO members(conversation_id,user_id,role,joined_at,last_read_at) VALUES(?,?,?,?,?)",
                (cid, m, "member", now, None),
            )
        if group["encrypted"] and new:
            # The group key must change so the newcomer holds only the new one;
            # a member's client does it as soon as it sees this flag.
            conn.execute("UPDATE conversations SET needs_rotation=1 WHERE id=?", (cid,))
    return {"members": list(current) + new}


def _db_remove_member(uid: str, cid: str, target: str) -> dict:
    """Leave a group (target is yourself) or, as an admin, remove someone.
    The last member leaving deletes the group; the last admin leaving hands the
    role to whoever has been there longest, so a group is never left without one."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT c.type, c.encrypted, m.role FROM conversations c JOIN members m ON m.conversation_id=c.id "
            "WHERE c.id=? AND m.user_id=?", (cid, uid)
        ).fetchone()
        if not row or row["type"] != "group":
            raise ChatError("not_found", 404)
        if target != uid and row["role"] != "admin":
            raise ChatError("forbidden", 403)
        gone = conn.execute(
            "DELETE FROM members WHERE conversation_id=? AND user_id=?", (cid, target)
        ).rowcount
        if not gone:
            raise ChatError("not_found", 404)
        remaining = [r[0] for r in conn.execute(
            "SELECT user_id FROM members WHERE conversation_id=? ORDER BY joined_at, user_id", (cid,))]
        if row["encrypted"]:
            # Whoever is left replaces the group key; the person who went gets
            # none of it. The stored keys are cleared when the module is around.
            mod = _premium_module()
            if mod:
                mod.forget(conn, cid, None if not remaining else target)
            if remaining:
                conn.execute("UPDATE conversations SET needs_rotation=1 WHERE id=?", (cid,))
        if not remaining:
            conn.execute("DELETE FROM hidden_for WHERE message_id IN "
                         "(SELECT id FROM messages WHERE conversation_id=?)", (cid,))
            conn.execute("DELETE FROM messages WHERE conversation_id=?", (cid,))
            conn.execute("DELETE FROM conversations WHERE id=?", (cid,))
        elif not conn.execute(
                "SELECT 1 FROM members WHERE conversation_id=? AND role='admin'", (cid,)).fetchone():
            conn.execute("UPDATE members SET role='admin' WHERE conversation_id=? AND user_id=?",
                         (cid, remaining[0]))
    return {"remaining": remaining}


# ── Notifications ────────────────────────────────────────────────────────

def _notify_members(uid: str, sender_name: str, conv: dict, cid: str, body: str, recipients: list):
    """In-app push notification for each recipient's mvmOS session. Runs in a
    worker thread: it writes to the notifications database.

    ref lets the recipient's client clear just this conversation's notification
    when they open it (see /api/notifications/read-by-ref). For a direct chat it
    is the sender's user id, as it has always been; for a group it is the
    conversation id."""
    hub = _hub()
    notif = sys.modules.get("backend.notifications")
    if not hub or not notif or not recipients:
        return
    is_group = conv["type"] == "group"
    if conv.get("encrypted"):
        # The group name is ciphertext and the text must not leave the browsers:
        # only who wrote, with a lock instead of the message.
        title, body = sender_name, "🔒"
    else:
        title = f"{sender_name} · {conv['title']}" if is_group else sender_name
    ref = cid if is_group else uid
    users = {u["id"]: u for u in hub.get_users_by_ids(recipients)}
    for rid in recipients:
        username = (users.get(rid) or {}).get("username")
        if not username:
            continue
        try:
            notif.create_notification(
                username, title, body[:200], kind="push", source="chat",
                action_app="chat", ref=ref,
            )
        except Exception:
            pass


def _telegram_fallback(sender_name: str, conv: dict, cid: str, body: str, offline: list):
    """Only for people with no open chat connection at all. Must run on the
    event loop: Telegram Hub schedules its send with asyncio.create_task."""
    tg = sys.modules.get("app_backend_telegramhub")
    if not tg or not offline:
        return
    base = (tg.get_public_base_url() or "").rstrip("/")
    url = f"{base}/pub/chat/telegram?conv={cid}"
    who = html.escape(sender_name)
    if conv.get("encrypted"):
        text, head = "🔒", f"💬 {who}"
    else:
        text = html.escape(body)
        head = f"💬 {html.escape(conv['title'])} · {who}" if conv["type"] == "group" else f"💬 {who}"
    for rid in offline:
        try:
            tg.notify(rid, "chat", f"{head}: {text}", web_app=url)
        except Exception:
            pass


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


# ── WebSocket delivery ───────────────────────────────────────────────────

async def _send(ws: WebSocket, msg: dict):
    try:
        await ws.send_text(json.dumps(msg))
    except Exception:
        pass


async def _push(user_id: str, msg: dict):
    for ws in list(_conns.get(user_id, ())):
        await _send(ws, msg)


async def _push_many(user_ids, msg: dict):
    await asyncio.gather(*(_push(u, msg) for u in dict.fromkeys(user_ids)))


def _spawn(coro):
    task = asyncio.ensure_future(coro)
    _bg.add(task)
    task.add_done_callback(_bg.discard)


# ── REST ─────────────────────────────────────────────────────────────────

class OpenDM(BaseModel):
    peer_id: str
    encrypted: bool = False
    wraps: Optional[dict] = None


class NewGroup(BaseModel):
    title: str
    member_ids: List[str] = []
    encrypted: bool = False
    wraps: Optional[dict] = None


class Rename(BaseModel):
    title: str


class AddMembers(BaseModel):
    user_ids: List[str] = []


async def _guard(token, fn, *args):
    """Authenticate, then run a synchronous handler in a worker thread and turn
    its ChatError into the JSON error the client expects."""
    me = await asyncio.to_thread(_resolve, token)
    if not me:
        return None, JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        return await asyncio.to_thread(fn, me["id"], *args), None
    except ChatError as e:
        return None, JSONResponse({"error": e.code, **e.extra}, status_code=e.status)


@router.get("/conversations")
async def conversations(x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _summaries)
    return err or JSONResponse(out)


@router.get("/conversations/{cid}")
async def conversation_detail(cid: str, x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _detail, cid)
    return err or JSONResponse(out)


@router.get("/conversations/{cid}/messages")
async def messages(cid: str, before: str = None, limit: int = 50,
                   x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _get_messages, cid, before, max(1, min(limit, 200)))
    return err or JSONResponse(out)


@router.post("/dm")
async def open_dm(body: OpenDM, x_pub_token: str = Header(default=None)):
    if body.encrypted:
        cid, err = await _guard(x_pub_token, _db_open_encrypted_dm, body.peer_id.strip(), body.wraps)
    else:
        cid, err = await _guard(x_pub_token, _db_open_dm, body.peer_id.strip())
    if err:
        return err
    out, err = await _guard(x_pub_token, _detail, cid)
    return err or JSONResponse(out)


@router.post("/groups")
async def create_group(body: NewGroup, x_pub_token: str = Header(default=None)):
    if body.encrypted:
        made, err = await _guard(x_pub_token, _db_create_encrypted_group, body.title, body.member_ids, body.wraps)
    else:
        made, err = await _guard(x_pub_token, _db_create_group, body.title, body.member_ids)
    if err:
        return err
    await _push_many(made["members"], {"type": "conversation_updated", "conversation_id": made["id"]})
    out, err = await _guard(x_pub_token, _detail, made["id"])
    return err or JSONResponse(out)


@router.patch("/groups/{cid}")
async def rename_group(cid: str, body: Rename, x_pub_token: str = Header(default=None)):
    members, err = await _guard(x_pub_token, _db_rename, cid, body.title)
    if err:
        return err
    await _push_many(members, {"type": "conversation_updated", "conversation_id": cid})
    out, err = await _guard(x_pub_token, _detail, cid)
    return err or JSONResponse(out)


@router.post("/groups/{cid}/members")
async def add_members(cid: str, body: AddMembers, x_pub_token: str = Header(default=None)):
    res, err = await _guard(x_pub_token, _db_add_members, cid, body.user_ids)
    if err:
        return err
    await _push_many(res["members"], {"type": "conversation_updated", "conversation_id": cid})
    out, err = await _guard(x_pub_token, _detail, cid)
    return err or JSONResponse(out)


@router.delete("/groups/{cid}/members/{target}")
async def remove_member(cid: str, target: str, x_pub_token: str = Header(default=None)):
    res, err = await _guard(x_pub_token, _db_remove_member, cid, target)
    if err:
        return err
    await _push(target, {"type": "conversation_updated", "conversation_id": cid, "removed": True})
    await _push_many(res["remaining"], {"type": "conversation_updated", "conversation_id": cid})
    return JSONResponse({"ok": True})


# ── Encrypted chats: skeleton routes ─────────────────────────────────────
# Every one of these only asks the premium module. Without it (or with the
# feature off) they answer 402 and the public page never even learns the
# option exists: /features says false and the client script is not served.

@router.get("/features")
async def features(x_pub_token: str = Header(default=None)):
    me = await asyncio.to_thread(_resolve, x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return JSONResponse({"encryption": bool(_enc())}, headers={"Cache-Control": "no-store"})


@router.get("/e2ee/crypto.js")
async def crypto_script(x_pub_token: str = Header(default=None)):
    me = await asyncio.to_thread(_resolve, x_pub_token)
    if not me:
        return Response(status_code=401, headers={"Cache-Control": "no-store"})
    mod = _enc()
    content = mod.get_asset("crypto.js") if mod else None
    if content is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(content=content, media_type="application/javascript",
                    headers={"Cache-Control": "private, no-store"})


def _enc_run(name):
    def run(uid, *args):
        return getattr(_need_enc(), name)(uid, *args)
    return run


@router.get("/e2ee/me")
async def e2ee_me(x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_me"))
    return err or JSONResponse(out, headers={"Cache-Control": "no-store"})


@router.put("/e2ee/me")
async def e2ee_put_me(body: dict = Body(...), x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_put_me"), body)
    if err:
        return err
    # A replaced identity leaves the person's chats needing a new key round.
    for cid, members in (out.pop("affected", None) or {}).items():
        await _push_many(members, {"type": "conversation_updated", "conversation_id": cid})
    return JSONResponse(out)


@router.post("/e2ee/public-keys")
async def e2ee_public_keys(body: dict = Body(...), x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_public_keys"), body.get("user_ids"))
    return err or JSONResponse(out, headers={"Cache-Control": "no-store"})


@router.get("/e2ee/keys")
async def e2ee_all_keys(x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_all_keys"))
    return err or JSONResponse(out, headers={"Cache-Control": "no-store"})


@router.get("/e2ee/conversations/{cid}/keys")
async def e2ee_conv_keys(cid: str, x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_conv_keys"), cid)
    return err or JSONResponse(out, headers={"Cache-Control": "no-store"})


@router.post("/e2ee/conversations/{cid}/rotate")
async def e2ee_rotate(cid: str, body: dict = Body(...), x_pub_token: str = Header(default=None)):
    out, err = await _guard(x_pub_token, _enc_run("api_rotate"), cid, body)
    if err:
        return err
    await _push_many(out.pop("members"), {"type": "conversation_updated", "conversation_id": cid})
    return JSONResponse(out)


# Desktop side: the administrator's switch, in the app's settings (the gear in
# the window title). The desktop session is already required by the loader.

@desktop_router.get("/admin/settings")
async def admin_settings():
    mod = await asyncio.to_thread(_premium_module)
    settings = await asyncio.to_thread(mod.get_settings) if mod else {}
    on = bool(settings.get("encryption"))
    return {"premium": bool(mod), "encryption": on}


@desktop_router.put("/admin/settings")
async def save_admin_settings(body: dict = Body(...)):
    mod = await asyncio.to_thread(_premium_module)
    if not mod:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    await asyncio.to_thread(mod.save_settings, body)
    _enc_reset()
    return {"ok": True}


# ── WebSocket ────────────────────────────────────────────────────────────

def _rate_ok(uid: str) -> bool:
    now = time.monotonic()
    q = _sent.setdefault(uid, deque())
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_MAX:
        return False
    q.append(now)
    return True


async def _on_send(ws, me: dict, uid: str, msg: dict):
    cid  = str(msg.get("conversation_id", "")).strip()
    # Not shortened here: only _db_send knows whether this is plain text, which
    # may be cut to MAX_BODY, or ciphertext, which must arrive whole or not at all.
    body = str(msg.get("body", "")).strip()
    if not cid or not body or len(body) > MAX_RAW:
        return
    if not _rate_ok(uid):
        await _send(ws, {"type": "error", "message": "rate_limited", "client_id": msg.get("client_id")})
        return
    try:
        res = await asyncio.to_thread(_db_send, uid, cid, body, msg.get("key_version"))
    except ChatError as e:
        await _send(ws, {"type": "error", "message": e.code, "conversation_id": cid,
                         "client_id": msg.get("client_id")})
        return
    if not res:
        await _send(ws, {"type": "error", "message": "not_member", "conversation_id": cid,
                         "client_id": msg.get("client_id")})
        return
    body = res["body"]
    await _push_many(res["members"], {
        "type": "message", "id": res["id"], "conversation_id": cid, "from": uid,
        "body": body, "created_at": res["created_at"], "client_id": msg.get("client_id"),
        "encrypted": res["encrypted"], "key_version": res["key_version"],
    })
    others  = [m for m in res["members"] if m != uid]
    offline = [m for m in others if not _conns.get(m)]
    name    = me.get("display_name", "?")
    conv    = {"type": res["type"], "title": res["title"], "encrypted": res["encrypted"]}
    _spawn(asyncio.to_thread(_notify_members, uid, name, conv, cid, body, others))
    _telegram_fallback(name, conv, cid, body, offline)


async def _on_edit(ws, uid: str, msg: dict):
    mid  = str(msg.get("id", "")).strip()
    body = str(msg.get("body", "")).strip()
    if not mid or not body or len(body) > MAX_RAW:
        return
    try:
        res = await asyncio.to_thread(_db_edit, uid, mid, body, msg.get("key_version"))
    except ChatError as e:
        await _send(ws, {"type": "error", "message": e.code, "message_id": mid})
        return
    if res:
        await _push_many(res["members"], {
            "type": "edited", "id": mid, "conversation_id": res["conversation_id"],
            "body": res["body"], "edited_at": res["edited_at"],
            "encrypted": res["encrypted"], "key_version": res["key_version"],
        })


async def _on_delete(uid: str, msg: dict):
    mid = str(msg.get("id", "")).strip()
    if not mid:
        return
    res = await asyncio.to_thread(_db_delete, uid, mid, bool(msg.get("for_everyone")))
    if res:
        await _push_many(res["members"], {"type": "deleted", "id": mid, "conversation_id": res["conversation_id"]})


async def _on_typing(uid: str, msg: dict):
    cid = str(msg.get("conversation_id", "")).strip()
    if not cid:
        return
    members = await asyncio.to_thread(_member_ids, uid, cid)
    if members:
        await _push_many([m for m in members if m != uid],
                         {"type": "typing", "conversation_id": cid, "from": uid})


async def _on_read(uid: str, msg: dict):
    cid = str(msg.get("conversation_id", "")).strip()
    if not cid:
        return
    if await asyncio.to_thread(_member_ids, uid, cid) is None:
        return
    await asyncio.to_thread(_db_mark_read, uid, cid)
    await _push(uid, {"type": "read", "conversation_id": cid})


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

        me = await asyncio.to_thread(_resolve, first.get("token", ""))
        if not me:
            await _send(websocket, {"type": "error", "message": "unauthorized"})
            await websocket.close()
            return
        uid = me["id"]
        _conns.setdefault(uid, set()).add(websocket)

        await _send(websocket, {"type": "joined", "user": _profile_out(me, uid)})

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
            if not isinstance(msg, dict):
                continue
            t = msg.get("type")
            if t == "ping":
                await _send(websocket, {"type": "pong"})
            elif t == "send":
                await _on_send(websocket, me, uid, msg)
            elif t == "typing":
                await _on_typing(uid, msg)
            elif t == "edit":
                await _on_edit(websocket, uid, msg)
            elif t == "delete":
                await _on_delete(uid, msg)
            elif t == "read":
                await _on_read(uid, msg)

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        if hb_task:
            hb_task.cancel()
        if uid and uid in _conns:
            _conns[uid].discard(websocket)
            if not _conns[uid]:
                del _conns[uid]
                _sent.pop(uid, None)
