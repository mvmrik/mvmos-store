"""Encrypted key vault and relay preferences for Nostradamus.

Nostr events themselves never pass through this service — the browser talks to
relays directly over WebSocket. This service only stores the encrypted nsec
(so the same identity works across devices). The
server never sees a plaintext private key or a master password.
"""

import asyncio
import base64
import hashlib
import ipaddress
import json
import os
import re
import socket
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

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
            CREATE TABLE IF NOT EXISTS lang_prefs (
                owner_id TEXT NOT NULL PRIMARY KEY,
                translate_lang TEXT,
                publish_lang TEXT
            );
            CREATE TABLE IF NOT EXISTS link_previews (
                url_hash TEXT NOT NULL PRIMARY KEY,
                url TEXT NOT NULL,
                payload TEXT NOT NULL,
                fetched_at INTEGER NOT NULL
            );
        """)
        conn.commit()


_init_db()

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


class PrefsIn(BaseModel):
    translate_lang: Optional[str] = None
    publish_lang: Optional[str] = None
    ai_reply_lang: Optional[str] = None
    ai_reply_style: Optional[str] = Field(default=None, max_length=1000)


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


# ---------------------------------------------------------------------------
# Link previews
#
# Nostr carries no attachments: a shared article is a bare URL sitting in the
# text, and that is all a reader saw. Every other client shows the page's own
# title and picture instead, which is what makes a link readable at a glance.
#
# Doing it needs the page fetched, and the browser cannot: the pages are on
# other origins and will not permit a cross-origin read. So the server fetches
# it — which means this endpoint takes a URL chosen by whoever is asking and
# makes the server open it. That is the classic shape of an SSRF, and the
# machine running mvmOS is exactly the machine with something worth reaching:
# localhost admin panels, the metadata service on a cloud VM, other hosts on the
# LAN. The guards below are the whole point of this section, not decoration:
#
#   * http(s) only, so file:// and gopher:// cannot be asked for,
#   * every hostname resolved first and refused if any address it answers with
#     is private, loopback, link-local, multicast or otherwise not a public
#     address, and the same check applied again at every redirect hop,
#   * the response capped, so a multi-gigabyte body cannot be used to exhaust
#     the box, and a timeout, so a host that never answers cannot hold a worker,
#   * the whole thing behind the same Apps Hub session every other route needs,
#     so it is not an open fetching service for the internet at large.
#
# One residual gap is worth naming rather than hiding: between the name being
# resolved here and urllib resolving it again to connect, a hostile DNS server
# could answer differently the second time (DNS rebinding). Closing that
# properly means connecting to a pinned address by hand and carrying the
# original host through TLS verification; it is not worth that complexity here,
# where the caller must already hold a valid session on this installation.
#
# The route is a plain def on purpose. Fetching a remote page is blocking work
# that can take seconds, so FastAPI runs it in a worker thread; written as async
# it would sit on the event loop and every other request on the installation
# would wait behind somebody else's link preview.
# ---------------------------------------------------------------------------

_PREVIEW_TTL = 7 * 24 * 3600
_PREVIEW_MAX_BYTES = 262144
_PREVIEW_TIMEOUT = 6
_PREVIEW_UA = "Mozilla/5.0 (compatible; mvmOS-Nostradamus/1.0; +link-preview)"
_WANTED_META = {
    "og:title", "og:description", "og:image", "og:site_name",
    "twitter:title", "twitter:description", "twitter:image",
    "description",
}


def _public_host(host: Optional[str]) -> bool:
    """True only when every address this name resolves to is a public one."""
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    if not infos:
        return False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return False
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                or ip.is_reserved or ip.is_unspecified):
            return False
    return True


class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is a second URL the caller never showed us, so it gets the
    same address check as the first. Returning None stops urllib following it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme not in ("http", "https") or not _public_host(parsed.hostname):
            return None
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class _MetaParser(HTMLParser):
    """Reads the handful of tags a preview needs and stops at </head>.

    Open Graph lives in the head, so there is no reason to walk the body of a
    page that may be megabytes of markup.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = ""
        self._in_title = False
        self.finished = False

    def handle_starttag(self, tag, attrs):
        if self.finished:
            return
        if tag == "meta":
            a = dict(attrs)
            key = (a.get("property") or a.get("name") or "").strip().lower()
            content = (a.get("content") or "").strip()
            if key in _WANTED_META and content and key not in self.meta:
                self.meta[key] = content
        elif tag == "title" and not self.title:
            self._in_title = True

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in ("head", "html"):
            self.finished = True


def _clip(value: Optional[str], limit: int) -> str:
    value = " ".join((value or "").split())
    return value[:limit]


def _scrape_preview(url: str) -> dict:
    """Fetch one page and pull a title, description and image out of it.

    Any failure — refused address, timeout, non-HTML, unparseable markup —
    returns an empty dict, which is cached like any other answer so a dead link
    is not re-fetched on every render.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https") or not _public_host(parsed.hostname):
        return {}
    req = urllib.request.Request(url, headers={
        "User-Agent": _PREVIEW_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en;q=0.8,*;q=0.5",
    })
    opener = urllib.request.build_opener(_GuardedRedirect)
    try:
        with opener.open(req, timeout=_PREVIEW_TIMEOUT) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if "html" not in ctype:
                return {}
            raw = resp.read(_PREVIEW_MAX_BYTES)
            final_url = resp.geturl()
    except Exception:
        return {}

    charset = "utf-8"
    match = re.search(r"charset=([\w-]+)", ctype)
    if match:
        charset = match.group(1)
    try:
        text = raw.decode(charset, "replace")
    except LookupError:
        text = raw.decode("utf-8", "replace")

    # Only the head is ever read, so only the head is handed to the parser.
    # HTMLParser is plain Python and holds the GIL while it tokenises, and a
    # news page inside the read cap is a quarter of a megabyte of body markup
    # that contains nothing this function wants. Cutting at </head> first turns
    # the parse into a few kilobytes of work, which is what keeps a burst of
    # previews from stealing CPU from every other request in the process.
    head = text
    cut = re.search(r"</head\s*>", text, re.I)
    if cut:
        head = text[:cut.end()]
    elif len(head) > 65536:
        # No </head> in a page this size means malformed markup, not a real
        # head that big; the tags worth having are at the top either way.
        head = head[:65536]

    parser = _MetaParser()
    try:
        parser.feed(head)
    except Exception:
        pass
    meta = parser.meta

    title = _clip(meta.get("og:title") or meta.get("twitter:title") or parser.title, 200)
    description = _clip(
        meta.get("og:description") or meta.get("twitter:description") or meta.get("description"), 300
    )
    image = (meta.get("og:image") or meta.get("twitter:image") or "").strip()
    if image:
        image = urllib.parse.urljoin(final_url, image)
        if urllib.parse.urlsplit(image).scheme not in ("http", "https"):
            image = ""
    site = _clip(meta.get("og:site_name"), 80) or (urllib.parse.urlsplit(final_url).hostname or "")

    if not title and not image:
        return {}
    return {"url": url, "title": title, "description": description, "image": image, "site": site}


@router.get("/preview")
def link_preview(url: str, x_pub_token: str = Header(default=None)):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    if not _user(x_pub_token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    url = (url or "").strip()
    if len(url) > 2048 or urllib.parse.urlsplit(url).scheme not in ("http", "https"):
        return JSONResponse({}, status_code=200)

    url_hash = hashlib.sha256(url.encode("utf-8")).hexdigest()
    now = int(time.time())
    with _conn() as conn:
        row = conn.execute(
            "SELECT payload, fetched_at FROM link_previews WHERE url_hash=?", (url_hash,)
        ).fetchone()
    if row and now - row["fetched_at"] < _PREVIEW_TTL:
        try:
            return JSONResponse(json.loads(row["payload"]))
        except ValueError:
            pass

    data = _scrape_preview(url)
    # An empty result is cached too. A page with no Open Graph tags at all is
    # the common case for a plain link, and without this every reader of that
    # note would make the server fetch it again.
    with _conn() as conn:
        conn.execute(
            "INSERT INTO link_previews(url_hash,url,payload,fetched_at) VALUES(?,?,?,?) "
            "ON CONFLICT(url_hash) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at",
            (url_hash, url[:2048], json.dumps(data), now),
        )
        conn.commit()
    return JSONResponse(data)


def _ai_offered() -> bool:
    """The Ask-AI chat exists only when the owner switched it on and the premium
    module that runs it is present and licensed (same rule as DeepL)."""
    with _conn() as conn:
        row = conn.execute("SELECT value FROM cfg WHERE key='ai_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return False
    prem = _premium()
    return bool(prem and prem.is_available())


class AiChatIn(BaseModel):
    chat_id: Optional[str] = None
    mode: str = "explain"
    text: Optional[str] = None
    lang: Optional[str] = None
    note: Optional[dict] = None


def _ai_user(x_pub_token):
    """(user, error response) for the AI routes."""
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return None, JSONResponse({"error": "private"}, status_code=403)
    me = _user(x_pub_token)
    if not me:
        return None, JSONResponse({"error": "unauthorized"}, status_code=401)
    if not _ai_offered():
        return None, JSONResponse({"error": "not_found"}, status_code=404)
    return me, None


@router.get("/ai/status")
async def ai_status(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me or not _ai_offered():
        return JSONResponse({"enabled": False}, headers={"Cache-Control": "no-store"})
    prem = _premium()
    return JSONResponse({"enabled": True, "ready": bool(prem.ai_ready()), "credits": prem.credits(me["id"])},
                        headers={"Cache-Control": "no-store"})


@router.post("/ai/chat")
async def ai_chat(data: AiChatIn, x_pub_token: str = Header(default=None)):
    me, err = _ai_user(x_pub_token)
    if err:
        return err
    result = await asyncio.to_thread(_premium().ask, me["id"], data.dict())
    if result.get("error"):
        e = result["error"]
        status = 402 if e == "no_credits" else 404 if e == "not_found" else 400 if e in ("empty_message", "empty_post", "chat_full") else 503 if e in ("mvmai_unavailable", "mvmai_disabled") else 502
        return JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


class AiDiscussIn(BaseModel):
    chat_id: str
    lang: Optional[str] = None


@router.post("/ai/discuss")
async def ai_discuss(data: AiDiscussIn, x_pub_token: str = Header(default=None)):
    me, err = _ai_user(x_pub_token)
    if err:
        return err
    result = await asyncio.to_thread(_premium().discuss, me["id"], data.chat_id, (data.lang or "").upper())
    if result.get("error"):
        e = result["error"]
        status = 404 if e == "not_found" else 503 if e in ("mvmai_unavailable", "mvmai_disabled") else 502
        return JSONResponse(result, status_code=status, headers={"Cache-Control": "no-store"})
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.get("/ai/history")
async def ai_history(x_pub_token: str = Header(default=None)):
    me, err = _ai_user(x_pub_token)
    if err:
        return err
    return JSONResponse({"chats": _premium().history(me["id"])}, headers={"Cache-Control": "no-store"})


@router.get("/ai/history/{chat_id}")
async def ai_history_one(chat_id: str, x_pub_token: str = Header(default=None)):
    me, err = _ai_user(x_pub_token)
    if err:
        return err
    chat = _premium().get_chat(me["id"], chat_id)
    if not chat:
        return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse(chat, headers={"Cache-Control": "no-store"})


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
    out = {"translate_lang": row["translate_lang"] if row else None, "publish_lang": row["publish_lang"] if row else None}
    if _ai_offered():
        out.update(_premium().comment_prefs(me["id"]))
    return out


@router.put("/prefs")
async def put_prefs(data: PrefsIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    if data.translate_lang and not _DEEPL_LANG_RE.fullmatch(data.translate_lang):
        return JSONResponse({"error": "invalid_lang"}, status_code=400)
    if data.publish_lang and not _DEEPL_LANG_RE.fullmatch(data.publish_lang):
        return JSONResponse({"error": "invalid_lang"}, status_code=400)
    if data.ai_reply_lang is not None or data.ai_reply_style is not None:
        if not _ai_offered():
            return JSONResponse({"error": "not_found"}, status_code=404)
        result = _premium().save_comment_prefs(me["id"], data.ai_reply_lang, data.ai_reply_style)
        if result.get("error"):
            return JSONResponse(result, status_code=400)
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
