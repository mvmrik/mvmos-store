"""Encrypted key vault and relay preferences for Nostradamus.

Nostr events themselves never pass through this service — the browser talks to
relays directly over WebSocket. This service only stores the encrypted nsec
(so the same identity works across devices) and the user's relay list. The
server never sees a plaintext private key or a master password.
"""

import base64
import os
import re
import sqlite3
import sys
from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
APP_ID = "nostradamus"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
_NPUB_RE = re.compile(r"^npub1[a-z0-9]{20,100}$")


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
            CREATE TABLE IF NOT EXISTS vaults (
                owner_id TEXT PRIMARY KEY,
                npub TEXT NOT NULL,
                salt TEXT NOT NULL,
                iterations INTEGER NOT NULL DEFAULT 600000,
                iv TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS relay_prefs (
                owner_id TEXT NOT NULL,
                url TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 1,
                write INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (owner_id, url)
            );
        """)
        conn.commit()


_init_db()

_DEFAULT_RELAYS = [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
    "wss://relay.primal.net",
]


class VaultIn(BaseModel):
    npub: str
    salt: str
    iterations: int = 600000
    iv: str
    ciphertext: str


class VaultUpdate(BaseModel):
    salt: str
    iterations: int = 600000
    iv: str
    ciphertext: str
    # Only sent when the owner unlocks with a key that is not the stored one and
    # confirms the swap — a re-encryption with the same key leaves this out.
    npub: Optional[str] = None


class RelayItem(BaseModel):
    url: str
    read: bool = True
    write: bool = True


class RelaysIn(BaseModel):
    relays: List[RelayItem]


def _user(token: Optional[str]):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _valid_b64(value: str, minimum: int, maximum: int) -> bool:
    value = (value or "").strip()
    if not _B64_RE.fullmatch(value) or len(value) > maximum:
        return False
    try:
        return len(base64.b64decode(value, validate=True)) >= minimum
    except Exception:
        return False


def _private_response():
    return JSONResponse({"error": "unauthorized"}, status_code=401)


_SCRIPTS = ("i18n.js", "nostr-widget.js", "vendor/noble-secp256k1.js")


def _asset_version():
    newest = 0
    for name in _SCRIPTS:
        try:
            newest = max(newest, int(os.path.getmtime(os.path.join(_PUBLIC_DIR, name))))
        except OSError:
            pass
    return str(newest or 0)


@router.get("/assets")
async def assets():
    return {"version": _asset_version()}


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "public_access_disabled"}, status_code=403)
    with open(os.path.join(_PUBLIC_DIR, "index.html")) as file:
        html = file.read().replace("__APP_VERSION__", _asset_version())
    return HTMLResponse(html)


@router.get("/vault")
async def get_vault(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        vault = conn.execute(
            "SELECT npub,salt,iterations,iv,ciphertext FROM vaults WHERE owner_id=?",
            (me["id"],),
        ).fetchone()
    return {"vault": dict(vault) if vault else None}


@router.post("/vault")
async def create_vault(data: VaultIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _NPUB_RE.fullmatch(data.npub.strip()):
        return JSONResponse({"error": "invalid_npub"}, status_code=400)
    if not _valid_b64(data.salt, 16, 128) or not 200000 <= data.iterations <= 1000000:
        return JSONResponse({"error": "invalid_vault_parameters"}, status_code=400)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 1024):
        return JSONResponse({"error": "invalid_encrypted_key"}, status_code=400)
    with _conn() as conn:
        exists = conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone()
        if exists:
            return JSONResponse({"error": "vault_exists"}, status_code=409)
        conn.execute(
            "INSERT INTO vaults(owner_id,npub,salt,iterations,iv,ciphertext) VALUES(?,?,?,?,?,?)",
            (me["id"], data.npub.strip(), data.salt.strip(), data.iterations, data.iv.strip(), data.ciphertext.strip()),
        )
        conn.executemany(
            "INSERT OR IGNORE INTO relay_prefs(owner_id,url,read,write) VALUES(?,?,1,1)",
            [(me["id"], url) for url in _DEFAULT_RELAYS],
        )
        conn.commit()
    return {"ok": True}


@router.put("/vault")
async def update_vault(data: VaultUpdate, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.salt, 16, 128) or not 200000 <= data.iterations <= 1000000:
        return JSONResponse({"error": "invalid_vault_parameters"}, status_code=400)
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 1024):
        return JSONResponse({"error": "invalid_encrypted_key"}, status_code=400)
    npub = (data.npub or "").strip()
    if npub and not _NPUB_RE.fullmatch(npub):
        return JSONResponse({"error": "invalid_npub"}, status_code=400)
    with _conn() as conn:
        result = conn.execute(
            "UPDATE vaults SET npub=COALESCE(?,npub),salt=?,iterations=?,iv=?,ciphertext=?,"
            "updated_at=strftime('%s','now') WHERE owner_id=?",
            (npub or None, data.salt.strip(), data.iterations, data.iv.strip(), data.ciphertext.strip(), me["id"]),
        )
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "vault_missing"}, status_code=409)
    return {"ok": True}


@router.get("/relays")
async def get_relays(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT url,read,write FROM relay_prefs WHERE owner_id=? ORDER BY rowid",
            (me["id"],),
        ).fetchall()
    return {"relays": [dict(row) for row in rows]}


@router.put("/relays")
async def put_relays(data: RelaysIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    urls = set()
    for relay in data.relays:
        url = relay.url.strip()
        if not (url.startswith("wss://") or url.startswith("ws://")) or len(url) > 200:
            return JSONResponse({"error": "invalid_relay_url"}, status_code=400)
        urls.add(url)
    if len(urls) > 30:
        return JSONResponse({"error": "too_many_relays"}, status_code=400)
    with _conn() as conn:
        conn.execute("DELETE FROM relay_prefs WHERE owner_id=?", (me["id"],))
        conn.executemany(
            "INSERT INTO relay_prefs(owner_id,url,read,write) VALUES(?,?,?,?)",
            [(me["id"], relay.url.strip(), int(relay.read), int(relay.write)) for relay in data.relays],
        )
        conn.commit()
    return {"ok": True}
