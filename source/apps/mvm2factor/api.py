"""
mvm2factor — TOTP authenticator for mvmOS.

The public router is mounted at /pub/mvm2factor and uses Apps Hub identity
(X-Pub-Token), exactly like Budget and Tasks. The desktop window and the
standalone public page use the same routes and therefore see the same vault.

The old desktop_router remains temporarily for compatibility with an already
open/cached desktop window. Legacy Linux-user rows remain untouched; the new
shared view only shows rows owned by the currently logged-in Apps Hub profile.

Secrets are encrypted in the browser, the way mvmPasswords keeps its vault: a
password the server never sees is stretched with PBKDF2 into an AES-GCM key,
and each account's secret is stored only as iv + ciphertext. The server can no
longer compute a code, so codes are computed in the browser as well. `vaults`
holds the salt and an encrypted check value, which is how a wrong password is
told apart from a right one even before the first account exists.

Accounts saved before this have a plaintext `secret`. They are handed to their
owner's browser once, encrypted there with the newly chosen password and sent
back in the same request that creates the vault, which clears the plaintext.
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
    # A cleared plaintext secret must not linger in a free page of the file.
    conn.execute("PRAGMA secure_delete=ON")
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
            CREATE TABLE IF NOT EXISTS vaults (
                owner_id   TEXT PRIMARY KEY,
                salt       TEXT NOT NULL,
                iterations INTEGER NOT NULL,
                check_iv   TEXT NOT NULL,
                check_ct   TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );
        """)
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(accounts)").fetchall()}
        if "owner_id" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN owner_id TEXT")
        if "website_url" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN website_url TEXT NOT NULL DEFAULT ''")
        if "website_host" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN website_host TEXT NOT NULL DEFAULT ''")
        if "iv" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN iv TEXT NOT NULL DEFAULT ''")
        if "ciphertext" not in cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN ciphertext TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts(owner_id)")
        conn.commit()


_init_db()


class AccountIn(BaseModel):
    name: str
    issuer: Optional[str] = ""
    secret: str
    website_url: Optional[str] = ""


class EncryptedAccountIn(BaseModel):
    name: str
    issuer: Optional[str] = ""
    website_url: Optional[str] = ""
    iv: str
    ciphertext: str


class SealedAccount(BaseModel):
    id: str
    iv: str
    ciphertext: str


class VaultIn(BaseModel):
    salt: str
    iterations: int
    check_iv: str
    check_ct: str
    # Every account that still has a plaintext secret, encrypted in the browser.
    accounts: list[SealedAccount] = []


class PrefsIn(BaseModel):
    sort_by: str


_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


def _valid_b64(value: str, minimum: int, maximum: int) -> bool:
    if not isinstance(value, str) or len(value) > maximum or not _B64_RE.fullmatch(value):
        return False
    try:
        return len(base64.b64decode(value, validate=True)) >= minimum
    except Exception:
        return False


def _valid_sealed(iv: str, ciphertext: str) -> bool:
    # AES-GCM: a 12-byte iv, and at least the 16-byte tag in the ciphertext.
    return (_valid_b64(iv, 12, 24) and len(base64.b64decode(iv)) == 12
            and _valid_b64(ciphertext, 17, 4096))


def _vault(conn, owner_id: str):
    row = conn.execute(
        "SELECT salt,iterations,check_iv,check_ct FROM vaults WHERE owner_id=?", (owner_id,)
    ).fetchone()
    return dict(row) if row else None


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


def _account_payload(row: sqlite3.Row, with_secret: bool) -> dict:
    payload = {
        "id": row["id"],
        "name": row["name"],
        "issuer": row["issuer"],
        "created_at": row["created_at"],
        "last_used": row["last_used"],
        "website_url": row["website_url"],
        "website_host": row["website_host"],
        "iv": row["iv"],
        "ciphertext": row["ciphertext"],
    }
    # Only before the vault exists, and only to the owner: the browser needs the
    # old plaintext once, to encrypt it with the password being chosen.
    if with_secret and row["secret"]:
        payload["secret"] = row["secret"]
    return payload


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("mvm2factor", "🔐")
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/vault")
async def public_vault(x_pub_token: str = Header(default=None)):
    """Everything the widget draws, in one request: the vault parameters, the
    encrypted accounts and the sort order."""
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _conn() as conn:
        vault = _vault(conn, me["id"])
        rows = conn.execute(
            "SELECT id,name,issuer,secret,iv,ciphertext,created_at,last_used,website_url,website_host "
            "FROM accounts WHERE owner_id=? ORDER BY created_at DESC",
            (me["id"],),
        ).fetchall()
        pref = conn.execute("SELECT sort_by FROM public_prefs WHERE user_id=?", (me["id"],)).fetchone()
    return JSONResponse({
        "vault": vault,
        "accounts": [_account_payload(row, vault is None) for row in rows],
        "sort_by": pref["sort_by"] if pref else "newest",
    })


@router.post("/vault")
async def public_create_vault(data: VaultIn, x_pub_token: str = Header(default=None)):
    """Create the vault and, in the same transaction, swap every plaintext
    secret of this owner for the ciphertext the browser made of it.

    The browser must send exactly the accounts that still hold plaintext: one
    left out would stay readable on the server, and one that was never there
    would be someone else's id. Either way nothing is written.
    """
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if (
        not _valid_b64(data.salt, 16, 128)
        or not 100_000 <= data.iterations <= 10_000_000
        or not _valid_sealed(data.check_iv, data.check_ct)
        or not all(_valid_sealed(a.iv, a.ciphertext) for a in data.accounts)
    ):
        return JSONResponse({"error": "invalid_vault"}, status_code=400)
    with _conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if _vault(conn, me["id"]):
            conn.rollback()
            return JSONResponse({"error": "vault_exists"}, status_code=409)
        plain = {
            row["id"] for row in conn.execute(
                "SELECT id FROM accounts WHERE owner_id=? AND secret!=''", (me["id"],)
            ).fetchall()
        }
        sealed = {a.id: a for a in data.accounts}
        if len(sealed) != len(data.accounts) or set(sealed) != plain:
            conn.rollback()
            return JSONResponse({"error": "accounts_changed"}, status_code=409)
        conn.execute(
            "INSERT INTO vaults(owner_id,salt,iterations,check_iv,check_ct) VALUES(?,?,?,?,?)",
            (me["id"], data.salt, data.iterations, data.check_iv, data.check_ct),
        )
        for account in data.accounts:
            conn.execute(
                "UPDATE accounts SET iv=?,ciphertext=?,secret='' WHERE id=? AND owner_id=?",
                (account.iv, account.ciphertext, account.id, me["id"]),
            )
        conn.commit()
        if plain:
            # The old pages still sit in the write-ahead log until it is folded
            # back into the file; secure_delete then zeroes them there.
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    return JSONResponse({"ok": True})


@router.post("/accounts")
async def public_add_account(
    data: EncryptedAccountIn, x_pub_token: str = Header(default=None)
):
    me = _public_user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    name = data.name.strip()
    issuer = (data.issuer or "").strip()
    if not name:
        return JSONResponse({"error": "name_required"}, status_code=400)
    if not _valid_sealed(data.iv, data.ciphertext):
        return JSONResponse({"error": "invalid_secret"}, status_code=400)
    try:
        website_url, website_host = _normalise_website(data.website_url or "")
    except ValueError:
        return JSONResponse({"error": "invalid_website"}, status_code=400)
    account_id = str(uuid.uuid4())
    with _conn() as conn:
        if not _vault(conn, me["id"]):
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        conn.execute(
            "INSERT INTO accounts(id,user,owner_id,name,issuer,secret,iv,ciphertext,website_url,website_host) "
            "VALUES(?,?,?,?,?,'',?,?,?,?)",
            (account_id, f"hub:{me['id']}", me["id"], name, issuer, data.iv, data.ciphertext,
             website_url, website_host),
        )
        conn.commit()
    return JSONResponse({"id": account_id})


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
