"""mvmShare — encrypted sharing of files, notes and links.

Everything a share holds is encrypted in the browser before it is sent here,
with a random key that travels only in the fragment of the share link (the
part after `#`), which a browser never puts on the wire. So this file stores,
and this server can only ever see, ciphertext: it does not know where a shared
link points, what a note says, or even what a file is called.

What the server does own is the rules, because they are the only part that
cannot be enforced anywhere else — when a share stops working, whether its
password has been proven, and how many times it has been opened. That is also
why an encrypted file never sits under public/: it lives in this app's own
SQLite database, which is beside public/ rather than inside it, so no URL
reaches it. The one way to the bytes is an unlock through the share link,
which hands out a short-lived download token (see /api/s/{id}/open).
"""

import base64
import hashlib
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

router = APIRouter()

APP_ID = "mvmshare"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")

KINDS = ("url", "note", "file")

# The owner controls the normal policy in the Store settings. These are only
# safety ceilings for this JSON-based encrypted transport: a request is held
# in memory briefly before SQLite writes it, so it must never be unlimited.
DEFAULT_MAX_FILE_COUNT = 20
DEFAULT_MAX_FILE_MB = 10
HARD_MAX_FILE_COUNT = 200
HARD_MAX_FILE_BYTES = 100 * 1024 * 1024
HARD_MAX_PAYLOAD_BYTES = 256 * 1024 * 1024

# How long a download token stays valid after an unlock. Long enough for a
# large file to finish downloading, short enough that a copied download URL is
# worthless by the time it is passed on.
DOWNLOAD_TOKEN_MINUTES = 30

PBKDF2_ROUNDS = 200_000
MAX_PASSWORD_FAILURES = 8
PASSWORD_WINDOW_MINUTES = 15


def _hub():
    return sys.modules.get("backend.apphub")


def _notifications():
    return sys.modules.get("backend.notifications")


def _premium():
    """The premium half, or None on an install that was never sent it.

    None is the normal state, not an error: view limits and automatic deletion
    are the subscriber features, and an install without the module simply
    never enforces either. Everything else — validity, passwords, the whole
    share mechanism — is the base app and always works.
    """
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def _premium_on() -> bool:
    prem = _premium()
    return bool(prem and prem.is_available())


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS shares (
                id           TEXT PRIMARY KEY,
                owner_id     TEXT NOT NULL,
                kind         TEXT NOT NULL,
                -- The one thing the owner chooses to leave readable: a label
                -- for their own list, and for the "X shared … with you" page.
                -- The shared thing itself is in `meta`/`data` and is not.
                title        TEXT NOT NULL DEFAULT '',
                meta_iv      TEXT NOT NULL,
                meta         TEXT NOT NULL,
                data_iv      TEXT,
                data         BLOB,
                size_bytes   INTEGER NOT NULL DEFAULT 0,
                pass_salt    TEXT,
                pass_hash    TEXT,
                expires_at   TEXT,
                -- What the clock does when it runs out. 'lock' keeps the share
                -- in the owner's list so they can extend it; 'delete' destroys
                -- it for good and is enforced by the premium module alone.
                expire_mode  TEXT NOT NULL DEFAULT 'lock',
                max_views    INTEGER,
                views        INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL,
                last_view_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_id, created_at DESC);

            -- Issued by an unlock, spent by the download. Without this the
            -- bytes would need a guessable URL of their own, and a file would
            -- stay downloadable long after its share stopped opening.
            CREATE TABLE IF NOT EXISTS download_tokens (
                token      TEXT PRIMARY KEY,
                share_id   TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            -- New file shares store each encrypted file independently. The
            -- old shares.data/data_iv pair remains readable for every share
            -- made before this migration.
            CREATE TABLE IF NOT EXISTS share_files (
                id          TEXT PRIMARY KEY,
                share_id    TEXT NOT NULL,
                data_iv     TEXT NOT NULL,
                data        BLOB NOT NULL,
                size_bytes  INTEGER NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_share_files_share ON share_files(share_id);

            CREATE TABLE IF NOT EXISTS unlock_attempts (
                share_id       TEXT NOT NULL,
                client_key     TEXT NOT NULL,
                failures       INTEGER NOT NULL DEFAULT 0,
                window_started TEXT NOT NULL,
                blocked_until  TEXT,
                PRIMARY KEY (share_id, client_key)
            );

            CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT);
            """
        )
        conn.commit()


_init_db()


# ── helpers ──────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(iso: str):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _me(token):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _cfg_value(conn, key, default):
    row = conn.execute("SELECT value FROM cfg WHERE key = ?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except (TypeError, ValueError):
        return default


def _file_policy():
    """Owner-set file policy, read from the Store app-settings cfg table."""
    with _db() as conn:
        count = _cfg_value(conn, "max_file_count", DEFAULT_MAX_FILE_COUNT)
        megabytes = _cfg_value(conn, "max_file_mb", DEFAULT_MAX_FILE_MB)
        categories = {
            "images": bool(_cfg_value(conn, "allow_images", True)),
            "videos": bool(_cfg_value(conn, "allow_videos", True)),
            "documents": bool(_cfg_value(conn, "allow_documents", True)),
            "archives": bool(_cfg_value(conn, "allow_archives", True)),
        }
    try:
        count = int(count)
    except (TypeError, ValueError):
        count = DEFAULT_MAX_FILE_COUNT
    try:
        megabytes = float(megabytes)
    except (TypeError, ValueError):
        megabytes = DEFAULT_MAX_FILE_MB
    count = max(1, min(count, HARD_MAX_FILE_COUNT))
    max_bytes = max(1, min(int(megabytes * 1024 * 1024), HARD_MAX_FILE_BYTES))
    return {"max_files": count, "max_bytes": max_bytes, "categories": categories}


def _create_request_limit(policy):
    # JSON/base64 overhead plus an encrypted metadata object. The final hard
    # ceiling protects the server even if an owner typed an extreme value.
    expected = policy["max_files"] * policy["max_bytes"] + 512 * 1024
    return min(HARD_MAX_PAYLOAD_BYTES, expected * 4 // 3 + 512 * 1024)


async def _limited_json(request: Request, maximum: int):
    """Parse JSON without accepting an unbounded request body into memory."""
    length = request.headers.get("content-length")
    try:
        if length is not None and int(length) > maximum:
            return None
    except ValueError:
        return None
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > maximum:
            return None
        chunks.append(chunk)
    try:
        data = json.loads(b"".join(chunks))
    except (TypeError, ValueError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


def _public_sharing_enabled() -> bool:
    hub = _hub()
    return not hub or hub.is_app_public(APP_ID)


def _public_disabled_response():
    return JSONResponse({"error": "private"}, status_code=403)


def _client_key(request: Request) -> str:
    """Use a proxy address only when the immediate peer is local."""
    peer = request.client.host if request.client else "unknown"
    if peer in {"127.0.0.1", "::1"}:
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded[:128]
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip[:128]
    return peer[:128]


def _is_unlock_blocked(conn, share_id: str, client_key: str) -> bool:
    row = conn.execute(
        "SELECT blocked_until FROM unlock_attempts WHERE share_id = ? AND client_key = ?",
        (share_id, client_key),
    ).fetchone()
    return bool(row and _parse(row["blocked_until"]) and _parse(row["blocked_until"]) > _now())


def _record_password_failure(conn, share_id: str, client_key: str):
    now = _now()
    row = conn.execute(
        "SELECT * FROM unlock_attempts WHERE share_id = ? AND client_key = ?", (share_id, client_key)
    ).fetchone()
    started = _parse(row["window_started"]) if row else None
    failures = (row["failures"] if row and started and started > now - timedelta(minutes=PASSWORD_WINDOW_MINUTES) else 0) + 1
    blocked = _iso(now + timedelta(minutes=PASSWORD_WINDOW_MINUTES)) if failures >= MAX_PASSWORD_FAILURES else None
    conn.execute(
        "INSERT INTO unlock_attempts (share_id, client_key, failures, window_started, blocked_until) VALUES (?,?,?,?,?) "
        "ON CONFLICT(share_id, client_key) DO UPDATE SET failures=excluded.failures, window_started=excluded.window_started, blocked_until=excluded.blocked_until",
        (share_id, client_key, failures, _iso(now), blocked),
    )


def _clear_password_failures(conn, share_id: str, client_key: str):
    conn.execute("DELETE FROM unlock_attempts WHERE share_id = ? AND client_key = ?", (share_id, client_key))


def _hash_password(password: str, salt: str) -> str:
    return base64.b64encode(
        hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt), PBKDF2_ROUNDS)
    ).decode()


def _b64len(value: str) -> int:
    """Decoded size of a base64 string, without decoding it."""
    if not value:
        return 0
    return max(0, len(value) * 3 // 4 - value.count("="))


def _expired(row) -> bool:
    at = _parse(row["expires_at"])
    return bool(at and at <= _now())


def _exhausted(row) -> bool:
    """Whether the view limit has been used up.

    The count itself is base behaviour — every share reports how many times it
    was opened. Only the *limit* is a subscriber feature, and it is the premium
    module that decides it has been reached, so an install that was never sent
    that module has no way to stop anybody: the number keeps rising and the
    share keeps opening.
    """
    prem = _premium()
    if not prem or not prem.is_available():
        return False
    return bool(prem.is_exhausted(row["views"], row["max_views"]))


def _state(row) -> str:
    if _expired(row):
        return "expired"
    if _exhausted(row):
        return "exhausted"
    return "ok"


def _share_public(row) -> dict:
    """What anyone holding the link may know before they unlock it.

    Deliberately not the payload, and deliberately not `meta`: the point of a
    password on a link share is that the address stays unknown until the
    password is right, so nothing that could reconstruct it leaves here.
    """
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "needs_password": bool(row["pass_hash"]),
        "state": _state(row),
        "size_bytes": row["size_bytes"],
    }


def _share_owner(row) -> dict:
    """The owner's own view: everything except the encrypted content, which
    even they can only read with the key from the link."""
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "needs_password": bool(row["pass_hash"]),
        "state": _state(row),
        "size_bytes": row["size_bytes"],
        "expires_at": row["expires_at"],
        "expire_mode": row["expire_mode"],
        "max_views": row["max_views"],
        "views": row["views"],
        "created_at": row["created_at"],
        "last_view_at": row["last_view_at"],
    }


def _clean_tokens(conn):
    conn.execute("DELETE FROM download_tokens WHERE expires_at <= ?", (_iso(_now()),))


def _apply_limits(max_views, expire_mode):
    """Turn what the browser asked for into what may actually be stored.

    Both of these are the subscription's features, so on an install with no
    premium module they are dropped here and the controls that set them are
    inert — the share is still created, still expires, still takes a password.
    Nothing is refused and nothing breaks; the app is simply the free one.
    """
    prem = _premium()
    if not prem or not prem.is_available():
        return None, "lock"
    return prem.sanitize_limits(max_views, expire_mode)


# ── the public page ──────────────────────────────────────────────────

def _private_page():
    return HTMLResponse("""<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>mvmShare</title>
<style>body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:10px;background:#1e1e2e;color:#cdd6f4;font-family:system-ui,sans-serif}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:600}.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">mvmShare is private</div>
<div class="sub">Sharing is not available to the public on this server.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/s/{share_id}")
async def share_page(share_id: str):
    """A share link is a real address, not a fragment route, so that the page
    can be opened, bookmarked and forwarded like any other — the key rides
    along in the fragment behind it and is never part of this request."""
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


# ── the owner's side ─────────────────────────────────────────────────

@router.get("/api/config")
async def config(x_pub_token: str = Header(default=None)):
    """What the UI is allowed to offer. Premium here decides what the form
    *shows*, never what a share may do — that is settled again server-side on
    every create and every open, where lying about it would achieve nothing."""
    me = _me(x_pub_token)
    policy = _file_policy()
    return JSONResponse({
        "premium": _premium_on(),
        "max_bytes": policy["max_bytes"],
        "max_files": policy["max_files"],
        "file_categories": policy["categories"],
        "signed_in": bool(me),
        "me": {"id": me["id"], "display_name": me["display_name"]} if me else None,
    })


@router.get("/api/mine")
async def my_shares(x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM shares WHERE owner_id = ? ORDER BY created_at DESC", (me["id"],)
        ).fetchall()
    return JSONResponse([_share_owner(r) for r in rows])


@router.post("/api/create")
async def create_share(request: Request, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)

    policy = _file_policy()
    body = await _limited_json(request, _create_request_limit(policy))
    if body is None:
        return JSONResponse({"error": "too_large", "max_bytes": policy["max_bytes"]}, status_code=413)
    kind = body.get("kind")
    if kind not in KINDS:
        return JSONResponse({"error": "kind"}, status_code=400)

    meta_iv, meta = body.get("meta_iv"), body.get("meta")
    if not meta_iv or not meta:
        return JSONResponse({"error": "payload"}, status_code=400)

    files = body.get("files") if kind == "file" else []
    legacy_payload = False
    # The former one-file payload is accepted as a one-item list, so links
    # created by an older browser remain compatible with the new backend.
    if kind == "file" and not files and body.get("data_iv") and body.get("data"):
        legacy_payload = True
        files = [{"id": "legacy", "data_iv": body.get("data_iv"), "data": body.get("data")}]
    if kind == "file" and (not isinstance(files, list) or not files or len(files) > policy["max_files"]):
        return JSONResponse({"error": "file_count", "max_files": policy["max_files"]}, status_code=400)
    if kind != "file":
        files = []

    prepared_files, used_ids = [], set()
    for item in files:
        if not isinstance(item, dict):
            return JSONResponse({"error": "payload"}, status_code=400)
        file_id, data_iv, data_b64 = item.get("id"), item.get("data_iv"), item.get("data")
        if not isinstance(file_id, str) or not file_id or len(file_id) > 80 or file_id in used_ids:
            return JSONResponse({"error": "payload"}, status_code=400)
        if not isinstance(data_iv, str) or not isinstance(data_b64, str) or not data_iv or not data_b64:
            return JSONResponse({"error": "payload"}, status_code=400)
        decoded_size = _b64len(data_b64)
        if decoded_size > policy["max_bytes"] + 64 * 1024:
            return JSONResponse({"error": "file_too_large", "max_bytes": policy["max_bytes"]}, status_code=413)
        try:
            blob = base64.b64decode(data_b64, validate=True)
        except Exception:
            return JSONResponse({"error": "payload"}, status_code=400)
        used_ids.add(file_id)
        prepared_files.append((file_id, data_iv, blob, len(blob)))

    size = _b64len(meta) + sum(item[3] for item in prepared_files)
    if size > HARD_MAX_PAYLOAD_BYTES:
        return JSONResponse({"error": "too_large", "max_bytes": policy["max_bytes"]}, status_code=413)

    expires_at = None
    minutes = body.get("expires_in_minutes")
    if isinstance(minutes, (int, float)) and minutes > 0:
        expires_at = _iso(_now() + timedelta(minutes=int(minutes)))

    max_views, expire_mode = _apply_limits(body.get("max_views"), body.get("expire_mode"))
    if expire_mode == "delete" and not expires_at:
        expire_mode = "lock"      # nothing to count down to

    password = body.get("password") or ""
    if not isinstance(password, str):
        return JSONResponse({"error": "password"}, status_code=400)
    salt = base64.b64encode(secrets.token_bytes(16)).decode() if password else None
    pass_hash = _hash_password(password, salt) if password else None

    share_id = secrets.token_urlsafe(9)
    with _db() as conn:
        conn.execute(
            "INSERT INTO shares (id, owner_id, kind, title, meta_iv, meta, data_iv, data, size_bytes,"
            " pass_salt, pass_hash, expires_at, expire_mode, max_views, views, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)",
            (share_id, me["id"], kind, (body.get("title") or "").strip()[:120], meta_iv, meta,
             prepared_files[0][1] if legacy_payload else None,
             prepared_files[0][2] if legacy_payload else None,
             size, salt, pass_hash, expires_at, expire_mode, max_views, _iso(_now())),
        )
        for file_id, data_iv, blob, file_size in ([] if legacy_payload else prepared_files):
            conn.execute(
                "INSERT INTO share_files (id, share_id, data_iv, data, size_bytes, created_at) VALUES (?,?,?,?,?,?)",
                (file_id, share_id, data_iv, blob, file_size, _iso(_now())),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
    return JSONResponse(_share_owner(row))


@router.post("/api/{share_id}/update")
async def update_share(share_id: str, request: Request, x_pub_token: str = Header(default=None)):
    """Extend an expired share, retime it, change or lift its password, change
    the limits. This is what "it stays in your account and can be extended"
    means — expiry locks a share, it never destroys one."""
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await _limited_json(request, 128 * 1024)
    if body is None:
        return JSONResponse({"error": "payload"}, status_code=400)

    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM shares WHERE id = ? AND owner_id = ?", (share_id, me["id"])
        ).fetchone()
        if not row:
            return JSONResponse({"error": "not_found"}, status_code=404)

        fields, values = [], []

        if "expires_in_minutes" in body:
            minutes = body.get("expires_in_minutes")
            if isinstance(minutes, (int, float)) and minutes > 0:
                fields.append("expires_at = ?")
                values.append(_iso(_now() + timedelta(minutes=int(minutes))))
            else:
                fields.append("expires_at = NULL")

        if "max_views" in body or "expire_mode" in body:
            max_views, expire_mode = _apply_limits(
                body.get("max_views", row["max_views"]),
                body.get("expire_mode", row["expire_mode"]),
            )
            fields += ["max_views = ?", "expire_mode = ?"]
            values += [max_views, expire_mode]

        if "reset_views" in body and body.get("reset_views"):
            fields.append("views = 0")

        if "password" in body:
            password = body.get("password") or ""
            if not isinstance(password, str):
                return JSONResponse({"error": "password"}, status_code=400)
            if password:
                salt = base64.b64encode(secrets.token_bytes(16)).decode()
                fields += ["pass_salt = ?", "pass_hash = ?"]
                values += [salt, _hash_password(password, salt)]
            else:
                fields += ["pass_salt = NULL", "pass_hash = NULL"]

        if "title" in body:
            fields.append("title = ?")
            values.append((body.get("title") or "").strip()[:120])

        if fields:
            conn.execute(f"UPDATE shares SET {', '.join(fields)} WHERE id = ?", values + [share_id])
            conn.commit()

        # An expiry that no longer exists cannot delete anything; leaving the
        # mode behind would arm a share that the owner has just made permanent.
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
        if row["expire_mode"] == "delete" and not row["expires_at"]:
            conn.execute("UPDATE shares SET expire_mode = 'lock' WHERE id = ?", (share_id,))
            conn.commit()
            row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()

    return JSONResponse(_share_owner(row))


@router.delete("/api/{share_id}")
async def delete_share(share_id: str, x_pub_token: str = Header(default=None)):
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)
    with _db() as conn:
        owned = conn.execute(
            "SELECT id FROM shares WHERE id = ? AND owner_id = ?", (share_id, me["id"])
        ).fetchone()
        if not owned:
            return JSONResponse({"ok": True, "deleted": 0})
        # Be explicit as well as relying on the foreign-key cascade: premium's
        # older cleanup code and hand-maintained databases must never leave an
        # encrypted file blob behind after its share goes away.
        conn.execute("DELETE FROM share_files WHERE share_id = ?", (share_id,))
        cur = conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
        conn.execute("DELETE FROM download_tokens WHERE share_id = ?", (share_id,))
        conn.commit()
    return JSONResponse({"ok": True, "deleted": cur.rowcount})


@router.get("/api/{share_id}/files")
async def owner_files(share_id: str, x_pub_token: str = Header(default=None)):
    """Encrypted file manifest for an owner who still has their link key.

    Names and MIME types remain inside the encrypted metadata; this route only
    returns opaque file ids and sizes so the browser can reconcile a removal.
    """
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM shares WHERE id = ? AND owner_id = ? AND kind = 'file'", (share_id, me["id"])
        ).fetchone()
        if not row:
            return JSONResponse({"error": "not_found"}, status_code=404)
        files = conn.execute(
            "SELECT id, size_bytes FROM share_files WHERE share_id = ? ORDER BY created_at, id", (share_id,)
        ).fetchall()
    # One old-style file has no row in share_files but can still be managed as
    # the synthetic legacy id (removing it deletes the whole share).
    if not files and row["data"] is not None:
        files = [{"id": "legacy", "size_bytes": row["size_bytes"]}]
    return JSONResponse({
        "meta_iv": row["meta_iv"], "meta": row["meta"],
        "files": [dict(f) for f in files],
    })


@router.post("/api/{share_id}/files/remove")
async def remove_files(share_id: str, request: Request, x_pub_token: str = Header(default=None)):
    """Remove selected encrypted files and atomically replace their manifest."""
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)
    body = await _limited_json(request, 256 * 1024)
    if body is None:
        return JSONResponse({"error": "payload"}, status_code=400)
    ids = body.get("file_ids")
    meta_iv, meta = body.get("meta_iv"), body.get("meta")
    if (not isinstance(ids, list) or not ids or len(ids) > HARD_MAX_FILE_COUNT
            or not isinstance(meta_iv, str) or not isinstance(meta, str) or not meta_iv or not meta):
        return JSONResponse({"error": "payload"}, status_code=400)
    ids = list(dict.fromkeys(x for x in ids if isinstance(x, str) and x))
    if not ids:
        return JSONResponse({"error": "payload"}, status_code=400)

    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM shares WHERE id = ? AND owner_id = ? AND kind = 'file'", (share_id, me["id"])
        ).fetchone()
        if not row:
            return JSONResponse({"error": "not_found"}, status_code=404)
        existing = conn.execute("SELECT id FROM share_files WHERE share_id = ?", (share_id,)).fetchall()
        existing_ids = {r["id"] for r in existing}
        if row["data"] is not None:
            existing_ids.add("legacy")
        if not set(ids).issubset(existing_ids):
            return JSONResponse({"error": "not_found"}, status_code=404)
        # A file share with no files has no useful recipient state. Deleting
        # its final item intentionally destroys the whole share and its token.
        if len(existing_ids - set(ids)) == 0:
            conn.execute("DELETE FROM share_files WHERE share_id = ?", (share_id,))
            conn.execute("DELETE FROM download_tokens WHERE share_id = ?", (share_id,))
            conn.execute("DELETE FROM shares WHERE id = ?", (share_id,))
            conn.commit()
            return JSONResponse({"ok": True, "deleted_share": True})

        placeholders = ",".join("?" * len(ids))
        conn.execute(f"DELETE FROM share_files WHERE share_id = ? AND id IN ({placeholders})", [share_id] + ids)
        # The only legacy item cannot coexist with modern rows. It was handled
        # as the final-item case above, so it never reaches this partial path.
        remaining = conn.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM share_files WHERE share_id = ?", (share_id,)
        ).fetchone()["total"]
        conn.execute(
            "UPDATE shares SET meta_iv = ?, meta = ?, size_bytes = ? WHERE id = ?",
            (meta_iv, meta, _b64len(meta) + int(remaining), share_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
    return JSONResponse(_share_owner(row))


@router.post("/api/{share_id}/send")
async def send_share(share_id: str, request: Request, x_pub_token: str = Header(default=None)):
    """Tell Apps Hub profiles about a share by raising a notification for each.

    There is no such thing as an "internal" share here — a share is a link, and
    everyone opens the same one. This only saves the owner the trouble of
    carrying it across to someone who already has an account on this server.

    The link is passed in by the browser precisely because it contains the
    decryption key, which this server has never had and cannot reconstruct.
    Which also means: sending a share this way puts its key into the
    recipient's notification, exactly as posting the link into any chat window
    would. The at-rest encryption protects the share store, not a message the
    owner chose to send.
    """
    me = _me(x_pub_token)
    if not me:
        return JSONResponse({"error": "auth"}, status_code=401)

    body = await _limited_json(request, 64 * 1024)
    if body is None:
        return JSONResponse({"error": "bad_request"}, status_code=400)
    link = (body.get("link") or "").strip()
    recipients = body.get("recipients") or []
    if not link.startswith("/") or not isinstance(recipients, list):
        return JSONResponse({"error": "bad_request"}, status_code=400)

    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM shares WHERE id = ? AND owner_id = ?", (share_id, me["id"])
        ).fetchone()
    if not row:
        return JSONResponse({"error": "not_found"}, status_code=404)

    notifications = _notifications()
    if not notifications:
        return JSONResponse({"sent": 0})

    sender = me.get("display_name") or me.get("username") or ""
    sent = 0
    for user_id in recipients[:50]:
        if not isinstance(user_id, str) or user_id == me["id"]:
            continue
        result = notifications.notify_hub_user(
            APP_ID, user_id=user_id, sender=sender,
            # The key and its variables, not a finished sentence: the person
            # reading this may not be using the language it was sent in, and
            # may not read it until tomorrow. The English below is only the
            # fallback for a client with no table for the key.
            title_key=f"msh_notif_{row['kind']}",
            vars={"name": sender},
            title=f"{sender} shared a {row['kind']} with you",
            # The body is the label its owner typed, so it stays plain text —
            # there is no key that could translate a sentence nobody wrote.
            body=row["title"],
            link=link, ref=share_id,
        )
        if result:
            sent += 1
    return JSONResponse({"sent": sent})


# ── the recipient's side ─────────────────────────────────────────────

@router.get("/api/s/{share_id}")
async def peek_share(share_id: str):
    """What the link is, without opening it: the kind, the label the owner
    typed, and whether a password stands in the way. Nothing here can be
    turned back into the address, the note or the file."""
    if not _public_sharing_enabled():
        return _public_disabled_response()
    with _db() as conn:
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
    if not row:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse(_share_public(row))


@router.post("/api/s/{share_id}/open")
async def open_share(share_id: str, request: Request):
    """The one door. Everything that decides whether a share still works is
    checked here, in one place, before any ciphertext is handed over — and the
    view is counted here too, which is why a file's bytes are fetched with a
    token issued by this call rather than by a URL of their own."""
    if not _public_sharing_enabled():
        return _public_disabled_response()
    body = await _limited_json(request, 16 * 1024)
    if body is None:
        return JSONResponse({"error": "payload"}, status_code=400)
    password = body.get("password") or ""
    if not isinstance(password, str):
        return JSONResponse({"error": "password"}, status_code=400)
    client_key = _client_key(request)

    with _db() as conn:
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "not_found"}, status_code=404)

        state = _state(row)
        if state != "ok":
            return JSONResponse({"error": state}, status_code=410)

        if row["pass_hash"]:
            if _is_unlock_blocked(conn, share_id, client_key):
                return JSONResponse({"error": "too_many_attempts"}, status_code=429)
            if not password:
                return JSONResponse({"error": "password_required"}, status_code=401)
            if not secrets.compare_digest(_hash_password(password, row["pass_salt"]), row["pass_hash"]):
                _record_password_failure(conn, share_id, client_key)
                conn.commit()
                return JSONResponse({"error": "password_wrong"}, status_code=403)
            _clear_password_failures(conn, share_id, client_key)

        now = _now()
        conn.execute(
            "UPDATE shares SET views = views + 1, last_view_at = ? WHERE id = ?", (_iso(now), share_id)
        )

        token = None
        file_ids = []
        file_manifest = []
        if row["kind"] == "file":
            _clean_tokens(conn)
            token = secrets.token_urlsafe(24)
            conn.execute(
                "INSERT INTO download_tokens (token, share_id, expires_at) VALUES (?,?,?)",
                (token, share_id, _iso(now + timedelta(minutes=DOWNLOAD_TOKEN_MINUTES))),
            )
            file_manifest = [dict(r) for r in conn.execute(
                "SELECT id, data_iv, size_bytes FROM share_files WHERE share_id = ? ORDER BY created_at, id", (share_id,)
            ).fetchall()]
            file_ids = [r["id"] for r in file_manifest]
            if not file_ids and row["data"] is not None:
                file_ids = ["legacy"]
                file_manifest = [{"id": "legacy", "data_iv": row["data_iv"], "size_bytes": row["size_bytes"]}]
        conn.commit()
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()

    return JSONResponse({
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "meta_iv": row["meta_iv"],
        "meta": row["meta"],
        "data_iv": row["data_iv"],
        "size_bytes": row["size_bytes"],
        "views": row["views"],
        "views_left": (row["max_views"] - row["views"]) if _premium_on() and row["max_views"] else None,
        "download_token": token,
        "file_ids": file_ids,
        "file_manifest": file_manifest,
    })


@router.get("/api/s/{share_id}/data")
async def download_share(share_id: str, t: str = "", f: str = ""):
    """The encrypted bytes of a file, and only against a token from an unlock
    that has just succeeded. The response is ciphertext either way — the
    browser that asked for it holds the key from the link fragment, and this
    server does not."""
    if not _public_sharing_enabled():
        return _public_disabled_response()
    with _db() as conn:
        _clean_tokens(conn)
        conn.commit()
        token_row = conn.execute(
            "SELECT * FROM download_tokens WHERE token = ? AND share_id = ?", (t, share_id)
        ).fetchone()
        if not token_row:
            return JSONResponse({"error": "not_unlocked"}, status_code=403)
        row = conn.execute("SELECT * FROM shares WHERE id = ?", (share_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "not_found"}, status_code=404)
        # Re-checked rather than trusted to the token: a share can expire, or
        # be revoked by its owner, between the unlock and the download.
        if _state(row) != "ok":
            return JSONResponse({"error": _state(row)}, status_code=410)
        if f and f != "legacy":
            file_row = conn.execute(
                "SELECT data FROM share_files WHERE share_id = ? AND id = ?", (share_id, f)
            ).fetchone()
            if not file_row:
                return JSONResponse({"error": "not_found"}, status_code=404)
            blob = file_row["data"]
        else:
            # Legacy links and the former one-file client have no row in the
            # child table. Keeping this fallback is what makes them durable.
            if row["data"] is None:
                return JSONResponse({"error": "not_found"}, status_code=404)
            blob = row["data"]

    return Response(content=blob, media_type="application/octet-stream", headers={
        "Cache-Control": "no-store",
        "Content-Disposition": "attachment; filename=\"share.bin\"",
    })
