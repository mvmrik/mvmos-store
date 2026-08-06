"""Encrypted vault storage for mvmPasswords.

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
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

router = APIRouter()
APP_ID = "mvmpasswords"
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
            -- A folder is stored exactly like an entry, and for the same reason: a
            -- folder name is as revealing as the login inside it, so it is one more
            -- opaque blob rather than a readable column. Which entry belongs to
            -- which folder is not here at all — it rides inside the entry's own
            -- ciphertext, so this table cannot even be used to count them.
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL,
                iv TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_folders_owner ON folders(owner_id, created_at);
        """)
        conn.commit()


_init_db()


class VaultIn(BaseModel):
    salt: str
    iterations: int = 600000


class EntryIn(BaseModel):
    iv: str
    ciphertext: str


class FolderIn(BaseModel):
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


def _totp_enabled() -> bool:
    """Whether the administrator has switched the 2FA integration on.

    This is deliberately not a per-user preference. Linking the vault to
    mvm2factor opens a channel between two apps, and who may do that is the
    decision of the person running the server — the same person who has to
    enable the App API in Apps Hub before any of it works at all. A public Apps
    Hub profile is a guest here and does not get to open that channel for the
    whole installation.

    The value comes from `cfg`, the table the App Store's own settings form
    writes into (Apps → mvmPasswords → Settings), so there is nothing bespoke to
    maintain: the checkbox in manifest.json and this read are the two ends of the
    same wire. Missing table or row simply means off, which is the default.
    """
    try:
        with _conn() as conn:
            row = conn.execute(
                "SELECT value FROM cfg WHERE key='totp_integration'"
            ).fetchone()
    except sqlite3.Error:
        return False
    if row is None:
        return False
    # The form stores JSON, so a checkbox is the literal `true` or `false`.
    return str(row["value"]).strip().lower() in ("true", "1", '"true"')


def _private_response():
    return JSONResponse({"error": "unauthorized"}, status_code=401)


_SCRIPTS = ("i18n.js", "passkey-webauthn.js", "password-manager-widget.js")


def _asset_version():
    """Cache-buster for the page's scripts: the newest mtime among them.

    The app version looks like the natural choice, but it only moves on a
    release while the files change with every edit — so between releases the
    browser keeps answering from its own cache and never sees the new code.
    Tying the number to the files themselves means the URL changes exactly
    when their contents do, and cannot go stale in either direction.
    """
    newest = 0
    for name in _SCRIPTS:
        try:
            newest = max(newest, int(os.path.getmtime(os.path.join(_PUBLIC_DIR, name))))
        except OSError:
            pass
    return str(newest or 0)


@router.get("/assets")
async def assets():
    """The current asset version, for surfaces that load the scripts themselves.

    The public page gets this stamped into its HTML, but the desktop app loads
    main.js statically and cannot be rewritten on the way out — so it asks. Without
    it, main.js skips the <script> tags entirely once window.MvmPasswordManagerWidget
    exists, and a desktop session started before an edit keeps running the old code
    until the whole desktop is reloaded. No token: this is a number, not vault data.
    """
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
        vault = conn.execute("SELECT salt,iterations FROM vaults WHERE owner_id=?", (me["id"],)).fetchone()
        rows = conn.execute(
            "SELECT id,iv,ciphertext,created_at,updated_at FROM entries WHERE owner_id=? ORDER BY updated_at DESC",
            (me["id"],),
        ).fetchall()
        # No meaningful order is possible here — the names are ciphertext — so the
        # browser sorts them once it has decrypted them. The tab row then reorders
        # itself by how recently each folder was used, which is the browser's own
        # record and not something the server has any business holding.
        folders = conn.execute(
            "SELECT id,iv,ciphertext FROM folders WHERE owner_id=? ORDER BY created_at",
            (me["id"],),
        ).fetchall()
    return {
        "vault": dict(vault) if vault else None,
        "entries": [dict(row) for row in rows],
        "folders": [dict(row) for row in folders],
        # Whether this installation offers the 2FA integration at all. It rides
        # along with the vault because every surface needs it before drawing the
        # list and none of them should pay for a second round trip — and it is
        # the same answer for everyone, since it is the administrator's decision
        # about this server, not a per-profile preference.
        # Both halves, so the UI never offers a button that cannot work: the
        # administrator's switch and the licence that delivers the code behind
        # it. _totp_premium() answers for both at once.
        "totp": _totp_premium() is not None,
        # Whether the password check is available on this installation. Same
        # rule as totp: it is the licence of the server, not of the viewer, so
        # every surface gets the same answer — and it is what the public page
        # and the extension go by, since neither has window.mvmOS to ask.
        "audit": _premium() is not None,
    }


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


# --- folders ---------------------------------------------------------------
#
# Three routes with nothing in them but ownership and a size check, because a
# folder is a blob this service cannot read. Deleting one does not touch a
# single entry: the membership lives inside each entry's ciphertext, so only the
# browser — which holds the key — can move those entries out, and it does so
# before calling DELETE. An entry left pointing at a folder that is gone is
# treated as unfiled when the list is drawn, so a half-finished delete is
# untidy rather than damaging.


@router.post("/folders")
async def add_folder(data: FolderIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 8192):
        return JSONResponse({"error": "invalid_encrypted_folder"}, status_code=400)
    folder_id = str(uuid.uuid4())
    with _conn() as conn:
        if not conn.execute("SELECT 1 FROM vaults WHERE owner_id=?", (me["id"],)).fetchone():
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        conn.execute("INSERT INTO folders(id,owner_id,iv,ciphertext) VALUES(?,?,?,?)", (folder_id, me["id"], data.iv.strip(), data.ciphertext.strip()))
        conn.commit()
    return {"id": folder_id}


@router.put("/folders/{folder_id}")
async def update_folder(folder_id: str, data: FolderIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if not _valid_b64(data.iv, 12, 64) or not _valid_b64(data.ciphertext, 17, 8192):
        return JSONResponse({"error": "invalid_encrypted_folder"}, status_code=400)
    with _conn() as conn:
        result = conn.execute("UPDATE folders SET iv=?,ciphertext=?,updated_at=strftime('%s','now') WHERE id=? AND owner_id=?", (data.iv.strip(), data.ciphertext.strip(), folder_id, me["id"]))
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        result = conn.execute("DELETE FROM folders WHERE id=? AND owner_id=?", (folder_id, me["id"]))
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return {"ok": True}


# --- 2FA integration -------------------------------------------------------
#
# The two routes below are the app's whole surface for it, and they are hollow
# on purpose: everything they do is delegate to premium/backend.py, which an
# unlicensed install never receives. When it is missing the answer is a plain
# "premium_required" and the vault carries on working exactly as before — the
# base app is never broken by the absence of a subscription, only quieter.


# --- Password check ---------------------------------------------------------
#
# The vault's passwords are only ever decrypted in the browser, so unlike the
# 2FA integration above there is nothing this route can compute server-side —
# the analysis has to run in the visitor's own JS. What still moves behind the
# licence is the analysis code itself: it lives in premium/public/audit.js,
# never in the app's own public/ bundle, so an unlicensed install's request
# for it 404s and no analysis code ever reaches that browser at all.


def _premium():
    premium = sys.modules.get("backend.premium")
    return premium.load_premium_backend(APP_ID) if premium else None


@router.get("/audit.js")
async def audit_script():
    module = _premium()
    # getattr, not a plain call: premium builds are fetched from mvmos.org and
    # are not versioned, so an install can be carrying an older one that has no
    # such function. That is a 404 like any other missing script, never a 500.
    getter = getattr(module, "get_audit_script", None) if module else None
    script = getter() if getter else None
    # no-store on both outcomes: a browser that cached a 200 from before a
    # licence was revoked must not go on believing it still has one, and this
    # is the one route where "was it ever allowed" is not the question — only
    # "is it allowed right now" is.
    if script is None:
        return Response(status_code=404, headers={"Cache-Control": "no-store"})
    return Response(
        content=script,
        media_type="application/javascript",
        headers={"Cache-Control": "no-store"},
    )


def _totp_premium():
    """The premium module, but only when the integration is switched on.

    Two independent conditions, both belonging to the server and neither to the
    visitor: the administrator has to have allowed the integration, and the
    installation has to be licensed — an unlicensed one was never sent this
    module at all. Checking the switch here rather than in each route means a
    disabled integration is indistinguishable from an unlicensed one from the
    outside, which is correct: in both cases the app does not offer it.
    """
    if not _totp_enabled():
        return None
    premium = sys.modules.get("backend.premium")
    return premium.load_premium_backend(APP_ID) if premium else None


@router.get("/totp/accounts")
async def totp_accounts(x_pub_token: str = Header(default=None)):
    """The 2FA accounts available to link, for the entry editor's picker."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _totp_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    result = module.list_accounts(me["id"])
    if result.get("error") == "premium_required":
        return JSONResponse(result, status_code=402)
    return result


@router.get("/totp/code/{account_id}")
async def totp_code(account_id: str, x_pub_token: str = Header(default=None)):
    """One current code. Requested on a click, never while the vault loads."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    module = _totp_premium()
    if module is None:
        return JSONResponse({"error": "premium_required"}, status_code=402)
    result = module.get_code(me["id"], account_id)
    error = result.get("error")
    if error == "premium_required":
        return JSONResponse(result, status_code=402)
    if error == "account_not_found":
        return JSONResponse(result, status_code=404)
    return result


