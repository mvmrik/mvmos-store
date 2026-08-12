"""
mvm2factor — TOTP authenticator for mvmOS.

The public router is mounted at /pub/mvm2factor and uses Apps Hub identity
(X-Pub-Token), exactly like Budget and Tasks. The desktop window and the
standalone public page use the same routes and therefore see the same vault.

The old desktop_router remains temporarily for compatibility with an already
open/cached desktop window. Legacy Linux-user rows remain untouched; the new
shared view only shows rows owned by the currently logged-in Apps Hub profile.
"""

import base64
import hashlib
import hmac
import os
import re
import sqlite3
import struct
import sys
import time
import uuid
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
desktop_router = APIRouter()

APP_ID = "mvm2factor"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_B32_RE = re.compile(r"^[A-Z2-7]+$")

current_session = sys.modules["backend.auth"].get_current_session


def _hub():
    return sys.modules.get("backend.apphub")


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def _init_db():
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS accounts (
                id         TEXT PRIMARY KEY,
                user       TEXT NOT NULL,
                name       TEXT NOT NULL,
                issuer     TEXT NOT NULL DEFAULT '',
                secret     TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                last_used  INTEGER
            );
            CREATE TABLE IF NOT EXISTS prefs (
                user    TEXT PRIMARY KEY,
                sort_by TEXT NOT NULL DEFAULT 'newest'
            );
            CREATE TABLE IF NOT EXISTS public_prefs (
                user_id TEXT PRIMARY KEY,
                sort_by TEXT NOT NULL DEFAULT 'newest'
            );
        """)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "owner_id" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN owner_id TEXT")
        if "website_url" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN website_url TEXT NOT NULL DEFAULT ''")
        if "website_host" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN website_host TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id)")
        conn.commit()


_init_db()


class AccountIn(BaseModel):
    name: str
    issuer: Optional[str] = ""
    secret: str
    website_url: Optional[str] = ""


class PrefsIn(BaseModel):
    sort_by: str


def _normalise_secret(secret: str) -> str:
    return secret.strip().upper().replace(" ", "").replace("=", "")


def _totp(secret: str) -> str:
    key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8), casefold=True)
    counter = int(time.time()) // 30
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(number % 1_000_000).zfill(6)


def _normalise_website(value: str) -> tuple[str, str]:
    value = (value or "").strip()
    if not value:
        return "", ""
    if "://" not in value and re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", value):
        raise ValueError("invalid website")
    candidate = value if "://" in value else "https://" + value
    parsed = urlparse(candidate)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise ValueError("invalid website")
    host = parsed.hostname.lower().rstrip(".")
    if host.startswith("www."):
        host = host[4:]
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path or ''}".rstrip("/"), host


def _resolve(token: Optional[str]):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _public_user(token: Optional[str]):
    return _resolve(token)


def _account_payload(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "issuer": row["issuer"],
        "created_at": row["created_at"],
        "last_used": row["last_used"],
        "website_url": row["website_url"],
        "website_host": row["website_host"],
        "code": _totp(row["secret"]),
    }


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mvm2factor</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style></head><body>
<div class="icon">🔒</div><div class="msg">mvm2factor is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/accounts")
async def public_accounts(x_pub_token: str = Header(default=None)):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id,name,issuer,secret,created_at,last_used,website_url,website_host FROM accounts "
            "WHERE owner_id=? ORDER BY created_at DESC",
            (me["id"],),
        ).fetchall()
    return JSONResponse([_account_payload(row) for row in rows])


@router.post("/accounts")
async def public_add_account(
    data: AccountIn, x_pub_token: str = Header(default=None)
):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    name = data.name.strip()
    issuer = (data.issuer or "").strip()
    secret = _normalise_secret(data.secret)
    if not name:
        return JSONResponse({"error": "name_required"}, status_code=400)
    if not secret or not _B32_RE.fullmatch(secret):
        return JSONResponse({"error": "invalid_secret"}, status_code=400)
    try:
        _totp(secret)
    except Exception:
        return JSONResponse({"error": "invalid_secret"}, status_code=400)
    try:
        website_url, website_host = _normalise_website(data.website_url or "")
    except ValueError:
        return JSONResponse({"error": "invalid_website"}, status_code=400)
    account_id = str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO accounts(id,user,owner_id,name,issuer,secret,website_url,website_host) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (account_id, f"hub:{me['id']}", me["id"], name, issuer, secret, website_url, website_host),
        )
        conn.commit()
    return JSONResponse({"id": account_id})


@router.get("/backup")
async def public_backup(x_pub_token: str = Header(default=None)):
    """Return a portable, deliberately plaintext backup for its owner only."""
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        rows = conn.execute(
            "SELECT name,issuer,secret,website_url FROM accounts WHERE owner_id=? ORDER BY created_at",
            (me["id"],),
        ).fetchall()
        pref = conn.execute("SELECT sort_by FROM public_prefs WHERE user_id=?", (me["id"],)).fetchone()
    return {
        "format": "mvm2factor-backup",
        "version": 1,
        "exported_at": int(time.time()),
        "preferences": {"sort_by": pref["sort_by"] if pref else "newest"},
        "accounts": [dict(row) for row in rows],
    }


@router.delete("/accounts/{account_id}")
async def public_delete_account(
    account_id: str, x_pub_token: str = Header(default=None)
):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        result = conn.execute(
            "DELETE FROM accounts WHERE id=? AND owner_id=?", (account_id, me["id"])
        )
        conn.commit()
    if result.rowcount == 0:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True})


@router.post("/accounts/{account_id}/use")
async def public_mark_used(
    account_id: str, x_pub_token: str = Header(default=None)
):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        result = conn.execute(
            "UPDATE accounts SET last_used=strftime('%s','now') WHERE id=? AND owner_id=?",
            (account_id, me["id"]),
        )
        conn.commit()
    if result.rowcount == 0:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True})


@router.get("/prefs")
async def public_get_prefs(x_pub_token: str = Header(default=None)):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        row = conn.execute(
            "SELECT sort_by FROM public_prefs WHERE user_id=?", (me["id"],)
        ).fetchone()
    return JSONResponse({"sort_by": row["sort_by"] if row else "newest"})


@router.post("/prefs")
async def public_set_prefs(
    data: PrefsIn, x_pub_token: str = Header(default=None)
):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if data.sort_by not in ("newest", "last_used"):
        return JSONResponse({"error": "invalid_sort"}, status_code=400)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO public_prefs(user_id,sort_by) VALUES(?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET sort_by=excluded.sort_by",
            (me["id"], data.sort_by),
        )
        conn.commit()
    return JSONResponse({"ok": True})


# Legacy desktop-session API. Kept so an already-open window does not break
# while the updated main.js is being loaded.
@desktop_router.get("/accounts")
def legacy_list_accounts(session=Depends(current_session)):
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id,name,issuer,secret,created_at,last_used,website_url,website_host FROM accounts "
            "WHERE user=? AND owner_id IS NULL ORDER BY created_at DESC",
            (session["effective_user"],),
        ).fetchall()
    return [dict(row) for row in rows]


@desktop_router.post("/accounts")
def legacy_add_account(data: AccountIn, session=Depends(current_session)):
    name = data.name.strip()
    issuer = (data.issuer or "").strip()
    secret = _normalise_secret(data.secret)
    if not name:
        return JSONResponse({"error": "name_required"}, status_code=400)
    if not secret or not _B32_RE.fullmatch(secret):
        return JSONResponse({"error": "invalid_secret"}, status_code=400)
    try:
        website_url, website_host = _normalise_website(data.website_url or "")
    except ValueError:
        return JSONResponse({"error": "invalid_website"}, status_code=400)
    account_id = str(uuid.uuid4())
    with _conn() as conn:
        conn.execute(
            "INSERT INTO accounts(id,user,name,issuer,secret,website_url,website_host) VALUES(?,?,?,?,?,?,?)",
            (account_id, session["effective_user"], name, issuer, secret, website_url, website_host),
        )
        conn.commit()
    return {"id": account_id}


@desktop_router.delete("/accounts/{account_id}")
def legacy_delete_account(account_id: str, session=Depends(current_session)):
    with _conn() as conn:
        result = conn.execute(
            "DELETE FROM accounts WHERE id=? AND user=? AND owner_id IS NULL",
            (account_id, session["effective_user"]),
        )
        conn.commit()
    if result.rowcount == 0:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@desktop_router.post("/accounts/{account_id}/use")
def legacy_mark_used(account_id: str, session=Depends(current_session)):
    with _conn() as conn:
        conn.execute(
            "UPDATE accounts SET last_used=strftime('%s','now') "
            "WHERE id=? AND user=? AND owner_id IS NULL",
            (account_id, session["effective_user"]),
        )
        conn.commit()
    return {"ok": True}


@desktop_router.get("/prefs")
def legacy_get_prefs(session=Depends(current_session)):
    with _conn() as conn:
        row = conn.execute(
            "SELECT sort_by FROM prefs WHERE user=?", (session["effective_user"],)
        ).fetchone()
    return {"sort_by": row["sort_by"] if row else "newest"}


@desktop_router.post("/prefs")
def legacy_set_prefs(data: PrefsIn, session=Depends(current_session)):
    if data.sort_by not in ("newest", "last_used"):
        return JSONResponse({"error": "invalid_sort"}, status_code=400)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO prefs(user,sort_by) VALUES(?,?) "
            "ON CONFLICT(user) DO UPDATE SET sort_by=excluded.sort_by",
            (session["effective_user"], data.sort_by),
        )
        conn.commit()
    return {"ok": True}
