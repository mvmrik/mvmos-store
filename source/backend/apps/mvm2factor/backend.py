"""
mvm2factor — TOTP authenticator backend for mvmOS.
Routes: /api/apps/mvm2factor/...
"""

import os
import re
import sqlite3
import sys
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/mvm2factor")
router._app_backend = "mvm2factor"

_DB_PATH = os.path.join(
    os.path.dirname(sys.modules["backend.db"].APPS_DIR),
    "apps", "mvm2factor", "data.db"
)

_B32_RE = re.compile(r'^[A-Z2-7]+$')


def _conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS accounts (
            id         TEXT PRIMARY KEY,
            user       TEXT NOT NULL,
            name       TEXT NOT NULL,
            issuer     TEXT NOT NULL DEFAULT '',
            secret     TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            last_used  INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS prefs (
            user    TEXT PRIMARY KEY,
            sort_by TEXT NOT NULL DEFAULT 'newest'
        )
    """)
    # migrate existing DBs that lack last_used
    try:
        conn.execute("ALTER TABLE accounts ADD COLUMN last_used INTEGER")
    except Exception:
        pass
    conn.commit()
    return conn


class AccountIn(BaseModel):
    name: str
    issuer: Optional[str] = ""
    secret: str

class PrefsIn(BaseModel):
    sort_by: str


@router.get("/accounts")
def list_accounts(session=Depends(get_current_session)):
    with _conn() as c:
        rows = c.execute(
            "SELECT id, name, issuer, secret, created_at, last_used FROM accounts WHERE user=? ORDER BY created_at DESC",
            (session["effective_user"],),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/accounts")
def add_account(data: AccountIn, session=Depends(get_current_session)):
    name   = data.name.strip()
    issuer = (data.issuer or "").strip()
    secret = data.secret.strip().upper().replace(" ", "").replace("=", "")
    if not name:
        raise HTTPException(400, "name required")
    if not secret or not _B32_RE.match(secret):
        raise HTTPException(400, "invalid Base32 secret")
    aid = str(uuid.uuid4())
    with _conn() as c:
        c.execute(
            "INSERT INTO accounts(id, user, name, issuer, secret) VALUES(?,?,?,?,?)",
            (aid, session["effective_user"], name, issuer, secret),
        )
    return {"id": aid}


@router.delete("/accounts/{aid}")
def delete_account(aid: str, session=Depends(get_current_session)):
    with _conn() as c:
        r = c.execute("DELETE FROM accounts WHERE id=? AND user=?", (aid, session["effective_user"]))
        if r.rowcount == 0:
            raise HTTPException(404, "not found")
    return {"ok": True}


@router.post("/accounts/{aid}/use")
def mark_used(aid: str, session=Depends(get_current_session)):
    with _conn() as c:
        c.execute(
            "UPDATE accounts SET last_used=strftime('%s','now') WHERE id=? AND user=?",
            (aid, session["effective_user"]),
        )
    return {"ok": True}


@router.get("/prefs")
def get_prefs(session=Depends(get_current_session)):
    with _conn() as c:
        row = c.execute("SELECT sort_by FROM prefs WHERE user=?", (session["effective_user"],)).fetchone()
    return {"sort_by": row["sort_by"] if row else "newest"}


@router.post("/prefs")
def set_prefs(data: PrefsIn, session=Depends(get_current_session)):
    if data.sort_by not in ("newest", "last_used"):
        raise HTTPException(400, "invalid sort_by")
    with _conn() as c:
        c.execute(
            "INSERT INTO prefs(user, sort_by) VALUES(?,?) ON CONFLICT(user) DO UPDATE SET sort_by=excluded.sort_by",
            (session["effective_user"], data.sort_by),
        )
    return {"ok": True}
