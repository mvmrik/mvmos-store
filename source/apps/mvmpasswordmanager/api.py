"""Encrypted vault storage for mvmPasswordManager.

Cryptography deliberately lives in the browser: this service only stores opaque
AES-GCM payloads for the authenticated Apps Hub profile. It never accepts a
master password or readable login data.
"""

import base64
import os
import re
import sqlite3
import sys
import uuid
from typing import Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
APP_ID = "mvmpasswordmanager"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


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
                salt TEXT NOT NULL,
                iterations INTEGER NOT NULL DEFAULT 600000,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS entries (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                iv TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_entries_owner ON entries(owner_id, updated_at DESC);
        """)
        conn.commit()


_init_db()


class VaultIn(BaseModel):
    salt: str
    iterations: int = 600000


class EntryIn(BaseModel):
    iv: str
    ciphertext: str


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


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "public_access_disabled"}, status_code=403)
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/vault")
async def get_vault(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        vault = conn.execute("SELECT salt,iterations FROM vaults WHERE owner_id=?", (me["id"],)).fetchone()
        rows = conn.execute(
            "SELECT id,iv,ciphertext,created_at,updated_at FROM entries WHERE owner_id=? ORDER BY updated_at DESC",
            (me["id"],),
        ).fetchall()
    return {"vault": dict(vault) if vault else None, "entries": [dict(row) for row in rows]}


@router.post("/vault")
async def create_vault(data: VaultIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.salt, 16, 128) or not 200000 <= data.iterations <= 1000000:
        return JSONResponse({"error": "invalid_vault_parameters"}, status_code=400)
    with _conn() as conn:
        exists = conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone()
        if exists:
            return JSONResponse({"error": "vault_exists"}, status_code=409)
        conn.execute("INSERT INTO vaults(owner_id,salt,iterations) VALUES(?,?,?)", (me["id"], data.salt.strip(), data.iterations))
        conn.commit()
    return {"ok": True}


@router.post("/entries")
async def add_entry(data: EntryIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_entry"}, status_code=400)
    entry_id = str(uuid.uuid4())
    with _conn() as conn:
        if not conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone():
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        conn.execute("INSERT INTO entries(id,owner_id,iv,ciphertext) VALUES(?,?,?,?)", (entry_id, me["id"], data.iv.strip(), data.ciphertext.strip()))
        conn.execute("UPDATE vaults SET updated_at=strftime('%s','now') WHERE owner_id=?", (me["id"],))
        conn.commit()
    return {"id": entry_id}


@router.put("/entries/{entry_id}")
async def update_entry(entry_id: str, data: EntryIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 65536):
        return JSONResponse({"error": "invalid_encrypted_entry"}, status_code=400)
    with _conn() as conn:
        result = conn.execute("UPDATE entries SET iv=?,ciphertext=?,updated_at=strftime('%s','now') WHERE id=? AND owner_id=?", (data.iv.strip(), data.ciphertext.strip(), entry_id, me["id"]))
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        result = conn.execute("DELETE FROM entries WHERE id=? AND owner_id=?", (entry_id, me["id"]))
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


