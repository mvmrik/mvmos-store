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


_VAULTS_SCHEMA = """
    CREATE TABLE IF NOT EXISTS vaults (
        owner_id TEXT NOT NULL,
        npub TEXT NOT NULL,
        salt TEXT NOT NULL,
        iterations INTEGER NOT NULL DEFAULT 600000,
        iv TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        PRIMARY KEY (owner_id, npub)
    );
"""


def _init_db():
    with _conn() as conn:
        cols = conn.execute("PRAGMA table_info(vaults)").fetchall()
        if cols and any(c["name"] == "owner_id" and c["pk"] == 1 for c in cols):
            # Pre-multi-account installs had owner_id alone as the primary key: one
            # Nostr identity per mvmOS user. Switching to (owner_id, npub) lets the
            # same user hold several encrypted identities side by side, without
            # losing whatever vault already exists on this installation.
            conn.execute("ALTER TABLE vaults RENAME TO vaults_old")
            conn.executescript(_VAULTS_SCHEMA)
            conn.execute(
                "INSERT INTO vaults(owner_id,npub,salt,iterations,iv,ciphertext,created_at,updated_at) "
                "SELECT owner_id,npub,salt,iterations,iv,ciphertext,created_at,updated_at FROM vaults_old"
            )
            conn.execute("DROP TABLE vaults_old")
        else:
            conn.executescript(_VAULTS_SCHEMA)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS relay_prefs (
                owner_id TEXT NOT NULL,
                url TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 1,
                write INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (owner_id, url)
            );
            CREATE TABLE IF NOT EXISTS lang_prefs (
                owner_id TEXT NOT NULL PRIMARY KEY,
                translate_lang TEXT,
                publish_lang TEXT
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


class PrefsIn(BaseModel):
    translate_lang: Optional[str] = None
    publish_lang: Optional[str] = None


_DEEPL_LANG_RE = re.compile(r"^[A-Z]{2}(-[A-Z]{2})?$")


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


class TranslateIn(BaseModel):
    text: str
    target_lang: str
    source_lang: Optional[str] = None


def _premium():
    """This app's premium module, or None on an install that was never sent it.

    Looked up per request rather than held onto: premium/ is downloaded when a
    licence is activated and deleted when it lapses, so a module cached at
    import time would keep a removed subscription working until a restart.
    """
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def _deepl_offered() -> bool:
    """Whether the translate button may be drawn and used at all.

    Two separate conditions: the owner switched the integration on, and the
    premium module that performs the translation is actually present and
    licensed. The second is not a courtesy check — without that module there
    is no translation code on this installation to call.
    """
    with _conn() as conn:
        row = conn.execute("SELECT value FROM cfg WHERE key='deepl_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return False
    prem = _premium()
    return bool(prem and prem.is_available())


@router.post("/translate")
async def translate(data: TranslateIn, x_pub_token: str = Header(default=None)):
    """Translate one post. The whole of this feature lives in the premium
    module; this route only carries the request to it and the answer back.

    An unlicensed installation has no premium module, so there is nothing to
    carry the request to and the endpoint reports itself as not found. That is
    the honest answer: on this installation the feature does not exist.
    """
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    me = _user(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if not _deepl_offered():
        return JSONResponse({"error": "not_found"}, status_code=404)
    result = _premium().translate(me["id"], data.text, data.target_lang, data.source_lang)
    if "error" in result:
        status = 400 if result["error"] in ("empty_text", "text_too_long", "api_key_missing",
                                            "bad_target_lang", "bad_source_lang") else 502
        return JSONResponse(result, status_code=status)
    return result


@router.get("/deepl-status")
async def deepl_status():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    return JSONResponse({"enabled": _deepl_offered()})


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Nostradamus", "🔮")
    with open(os.path.join(_PUBLIC_DIR, "index.html")) as file:
        html = file.read().replace("__APP_VERSION__", _asset_version())
    return HTMLResponse(html)


@router.get("/vault")
async def get_vault(x_pub_token: str = Header(default=None)):
    """Kept for older widget builds: the first vault for this owner, if any."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        vault = conn.execute(
            "SELECT npub,salt,iterations,iv,ciphertext FROM vaults WHERE owner_id=? ORDER BY created_at LIMIT 1",
            (me["id"],),
        ).fetchone()
    return {"vault": dict(vault) if vault else None}


@router.get("/vaults")
async def list_vaults(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT npub,salt,iterations,iv,ciphertext FROM vaults WHERE owner_id=? ORDER BY created_at",
            (me["id"],),
        ).fetchall()
    return {"vaults": [dict(row) for row in rows]}


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
        exists = conn.execute(
            "SELECT 1 FROM vaults WHERE owner_id=? AND npub=?", (me["id"], data.npub.strip())
        ).fetchone()
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
async def update_vault(
    data: VaultUpdate,
    target_npub: str = "",
    x_pub_token: str = Header(default=None),
):
    """Re-encrypts (or, with data.npub set, replaces the key of) one specific
    identity — target_npub picks which of the owner's vaults, since an owner
    can now hold several. Older widget builds that never send target_npub
    fall back to the owner's first vault, matching the pre-multi-account
    behaviour."""
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
    target = target_npub.strip()
    if target and not _NPUB_RE.fullmatch(target):
        return JSONResponse({"error": "invalid_npub"}, status_code=400)
    with _conn() as conn:
        if not target:
            row = conn.execute(
                "SELECT npub FROM vaults WHERE owner_id=? ORDER BY created_at LIMIT 1", (me["id"],)
            ).fetchone()
            target = row["npub"] if row else ""
        if not target:
            return JSONResponse({"error": "vault_missing"}, status_code=409)
        if npub and npub != target:
            clash = conn.execute(
                "SELECT 1 FROM vaults WHERE owner_id=? AND npub=?", (me["id"], npub)
            ).fetchone()
            if clash:
                return JSONResponse({"error": "vault_exists"}, status_code=409)
        result = conn.execute(
            "UPDATE vaults SET npub=COALESCE(?,npub),salt=?,iterations=?,iv=?,ciphertext=?,"
            "updated_at=strftime('%s','now') WHERE owner_id=? AND npub=?",
            (npub or None, data.salt.strip(), data.iterations, data.iv.strip(), data.ciphertext.strip(), me["id"], target),
        )
        conn.commit()
    if not result.rowcount:
        return JSONResponse({"error": "vault_missing"}, status_code=409)
    return {"ok": True}


@router.delete("/vault")
async def delete_vault(npub: str, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    npub = npub.strip()
    if not _NPUB_RE.fullmatch(npub):
        return JSONResponse({"error": "invalid_npub"}, status_code=400)
    with _conn() as conn:
        result = conn.execute(
            "DELETE FROM vaults WHERE owner_id=? AND npub=?", (me["id"], npub)
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


@router.get("/prefs")
async def get_prefs(x_pub_token: str = Header(default=None)):
    """The translate/publish target language, saved per Apps Hub account (not
    per identity or per browser) so the same choice follows the user across
    devices instead of needing to be picked again on every one."""
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        row = conn.execute(
            "SELECT translate_lang,publish_lang FROM lang_prefs WHERE owner_id=?", (me["id"],)
        ).fetchone()
    return {"translate_lang": row["translate_lang"] if row else None, "publish_lang": row["publish_lang"] if row else None}


@router.put("/prefs")
async def put_prefs(data: PrefsIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if data.translate_lang and not _DEEPL_LANG_RE.fullmatch(data.translate_lang):
        return JSONResponse({"error": "invalid_lang"}, status_code=400)
    if data.publish_lang and not _DEEPL_LANG_RE.fullmatch(data.publish_lang):
        return JSONResponse({"error": "invalid_lang"}, status_code=400)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO lang_prefs(owner_id,translate_lang,publish_lang) VALUES(?,?,?) "
            "ON CONFLICT(owner_id) DO UPDATE SET "
            "translate_lang=COALESCE(?,lang_prefs.translate_lang),"
            "publish_lang=COALESCE(?,lang_prefs.publish_lang)",
            (me["id"], data.translate_lang, data.publish_lang, data.translate_lang, data.publish_lang),
        )
        conn.commit()
    return {"ok": True}
