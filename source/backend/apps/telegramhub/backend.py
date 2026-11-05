"""
Telegram Hub — every Apps Hub profile connects its own Telegram bot.

A person creates a bot with @BotFather, pastes its token on the Telegram Hub
page of Apps Hub and presses Start in Telegram. From then on the bot

  * opens their Apps Hub (or, with the single-app option, one app) as a
    Telegram Mini App, signed in without a login screen, and
  * delivers the notifications mvmOS creates for that profile, in the language
    of the profile, so they arrive as an ordinary Telegram push on the phone.

Telegram Hub knows nothing about any specific app. It listens to the shared
notification store (backend/notifications.py::register_listener), so an app
needs no Telegram code at all: whatever it notifies through mvmOS reaches the
bot. The only per-person choice is which apps to mute.

A bot belongs to exactly one profile and talks to exactly one Telegram chat —
the one that pressed Start with the pairing code. Bot tokens are stored
encrypted with a key kept outside the app's own database and never leave the
server again.

A profile can have three kinds of bot:

  * an Apps Hub bot — opens Apps Hub and brings the notifications of all apps,
  * an app bot — opens one app and brings only that app's notifications,
  * a custom menu bot — a menu of buttons the person builds from the functions
    apps expose through their App API.

The first two are free. The custom menu bot is the premium part: everything that
makes it work lives in apps/telegramhub/premium/backend.py, which an unlicensed
install never receives.
"""

import asyncio
import contextlib
import hmac
import hashlib
import html
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qsl, quote

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

API_BASE = "https://api.telegram.org/bot{token}/{method}"

_DIR       = os.path.dirname(__file__)
_ROOT      = os.path.abspath(os.path.join(_DIR, "..", "..", ".."))
_DB_PATH   = os.path.join(_ROOT, "apps", "telegramhub", "data.db")
_APPS_DIR  = os.path.join(_ROOT, "apps")
_I18N_DIR  = os.path.join(_ROOT, "frontend", "i18n")
# Not under apps/telegramhub or backend/apps/telegramhub: those folders travel in
# the store archive, and the key must never be next to the data it protects.
_KEY_PATH  = os.path.join(_ROOT, "backend", "apphub_data", "telegramhub.key")

LANGS = ("en", "bg", "de", "es", "fr", "ja", "pt-BR", "ru", "zh-CN")
_TOKEN_RE  = re.compile(r"^\d{5,}:[A-Za-z0-9_-]{30,}$")
_SOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_TO_RE     = re.compile(r"^/pub/[a-z0-9][a-z0-9_-]*/[A-Za-z0-9_./?=&%-]*$")


def _release():
    """Hub code reading its own data or key on behalf of a confined app's request
    (a notification created inside shoppinglist, say) is the same case as
    backend/db.py::get_conn(): it runs outside the caller's confinement."""
    isolation = sys.modules.get("backend.app_isolation")
    return isolation.release() if isolation is not None else contextlib.nullcontext()


# ── Storage ─────────────────────────────────────────────────────

def _db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    with _release():
        conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bots (
            id         TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL,
            token      TEXT NOT NULL,
            tg_id      TEXT NOT NULL UNIQUE,
            username   TEXT NOT NULL,
            mode       TEXT NOT NULL DEFAULT 'hub',
            app_id     TEXT,
            secret     TEXT NOT NULL UNIQUE,
            chat_id    TEXT,
            pair_code  TEXT,
            lang       TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS muted (
            bot_id TEXT NOT NULL,
            source TEXT NOT NULL,
            PRIMARY KEY (bot_id, source)
        );
        CREATE TABLE IF NOT EXISTS buttons (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id   TEXT NOT NULL,
            name     TEXT NOT NULL,
            app_id   TEXT NOT NULL,
            fn       TEXT NOT NULL,
            params   TEXT NOT NULL DEFAULT '[]',
            reply    TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS convo (
            bot_id  TEXT PRIMARY KEY,
            state   TEXT NOT NULL,
            updated REAL NOT NULL
        );
    """)
    _migrate_legacy(conn)
    return conn


def _migrate_legacy(conn) -> None:
    """The first versions had one bot for the whole server, configured by the
    administrator, and a table linking Telegram chats to profiles. Carry the one
    linked person over to a bot of their own — same token, same webhook address,
    so nothing has to be registered again — then drop the tables nothing reads."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "links" not in tables:
        return
    cfg = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM config")}
    link = conn.execute("SELECT * FROM links ORDER BY linked_at LIMIT 1").fetchone()
    token = cfg.get("bot_token")
    if token and link and not conn.execute("SELECT 1 FROM bots LIMIT 1").fetchone():
        conn.execute(
            "INSERT INTO bots(id,user_id,token,tg_id,username,mode,secret,chat_id,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (secrets.token_urlsafe(8), link["user_id"], _enc(token), token.split(":")[0],
             cfg.get("bot_username") or "", "hub",
             cfg.get("webhook_secret") or secrets.token_urlsafe(24), link["chat_id"],
             datetime.now(timezone.utc).isoformat()),
        )
    for table in ("links", "link_codes", "enabled_apps", "chat_state", "app_usage"):
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.execute("DELETE FROM config WHERE key IN ('bot_token','bot_username','webhook_secret','apps_sort_mode')")
    conn.commit()


def _get_config(key: str) -> Optional[str]:
    with _db() as conn:
        row = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _set_config(key: str, value: str) -> None:
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO config(key,value) VALUES(?,?)", (key, value))
        conn.commit()


def get_public_base_url() -> Optional[str]:
    return _get_config("public_base_url")


# ── Token encryption ────────────────────────────────────────────

def _fernet():
    from cryptography.fernet import Fernet
    with _release():
        if not os.path.isfile(_KEY_PATH):
            os.makedirs(os.path.dirname(_KEY_PATH), exist_ok=True)
            fd = os.open(_KEY_PATH, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(Fernet.generate_key())
        with open(_KEY_PATH, "rb") as f:
            return Fernet(f.read().strip())


def _enc(token: str) -> str:
    return "enc:" + _fernet().encrypt(token.encode()).decode()


def _dec(value: str) -> str:
    if value.startswith("enc:"):
        return _fernet().decrypt(value[4:].encode()).decode()
    return value


def _bot_row(row) -> Optional[dict]:
    if not row:
        return None
    bot = dict(row)
    bot["token"] = _dec(bot["token"])
    return bot


def _bots_of(user_id: str) -> list:
    with _db() as conn:
        rows = conn.execute("SELECT * FROM bots WHERE user_id=? ORDER BY created_at", (user_id,)).fetchall()
    return [_bot_row(r) for r in rows]


def _bot_by(column: str, value: str) -> Optional[dict]:
    with _db() as conn:
        row = conn.execute(f"SELECT * FROM bots WHERE {column}=?", (value,)).fetchone()
    return _bot_row(row)


def _muted(bot_id: str) -> set:
    with _db() as conn:
        return {r["source"] for r in conn.execute("SELECT source FROM muted WHERE bot_id=?", (bot_id,))}


# ── Premium: the custom menu bot ────────────────────────────────

def _premium():
    """Present only on a licensed install. Absent means a profile has the Apps Hub
    bot and app bots — the free behaviour — and any custom bot already stored
    stays inert."""
    mod = sys.modules["backend.premium"].load_premium_backend("telegramhub")
    return mod if mod is not None and hasattr(mod, "available") else None


def custom_available() -> bool:
    mod = _premium()
    return bool(mod and mod.available())


def _custom():
    """The premium module when custom bots may be used, else a refusal."""
    mod = _premium()
    if not (mod and mod.available()):
        raise HTTPException(403, detail="unavailable")
    return mod


def _valid_app(user: dict, app_id: str) -> bool:
    """An app bot needs a public page this profile is allowed to open."""
    hub = sys.modules.get("backend.apphub")
    if not hub or not app_id or app_id in ("apphub", "telegramhub"):
        return False
    return (
        app_id in hub._detect_public_apps()
        and hub.is_app_public(app_id)
        and hub.can_access_public_app(app_id, user["id"])
    )


# ── Languages and translations ──────────────────────────────────
#
# Notifications are stored with a translation key (and the English sentence as
# fallback) because the person who writes one and the person who reads it can
# use different languages. The browser resolves the key from the app's i18n.js;
# Telegram receives finished text, so the same tables are read here.

def _tokens(text: str):
    i, n = 0, len(text)
    ident = re.compile(r"[A-Za-z_$][\w$]*|\d+")
    simple = {"n": "\n", "t": "\t", "r": "\r"}
    while i < n:
        c = text[i]
        if c in " \t\r\n":
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if c in "'\"`":
            i += 1
            buf = []
            while i < n and text[i] != c:
                if text[i] == "\\" and i + 1 < n:
                    e = text[i + 1]
                    if e == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", text[i + 2:i + 6]):
                        buf.append(chr(int(text[i + 2:i + 6], 16)))
                        i += 6
                        continue
                    buf.append(simple.get(e, e))
                    i += 2
                    continue
                buf.append(text[i])
                i += 1
            i += 1
            yield ("s", "".join(buf))
            continue
        m = ident.match(text, i)
        if m:
            yield ("i", m.group())
            i = m.end()
            continue
        yield ("p", c)
        i += 1


def _parse_table(text: str) -> dict:
    """{(enclosing key, key): string} for every `key: 'string'` in a JS i18n file.
    An app's file nests its strings under the language code; a core file has them
    at the top level (enclosing key None)."""
    toks = list(_tokens(text))
    out, stack = {}, []
    for k, (kind, val) in enumerate(toks):
        if kind == "p":
            if val == "{":
                name = None
                if k >= 2 and toks[k - 1] == ("p", ":") and toks[k - 2][0] in "si":
                    name = toks[k - 2][1]
                stack.append(name)
            elif val == "}" and stack:
                stack.pop()
        elif kind in "si" and k + 2 < len(toks) and toks[k + 1] == ("p", ":") and toks[k + 2][0] == "s":
            out[(stack[-1] if stack else None, val)] = toks[k + 2][1]
    return out


_tables: dict = {}


def _table(path: str) -> dict:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return {}
    cached = _tables.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        with _release(), open(path, encoding="utf-8") as f:
            table = _parse_table(f.read())
    except OSError:
        table = {}
    _tables[path] = (mtime, table)
    return table


def _find(key: Optional[str], lang: str, source: Optional[str]) -> Optional[str]:
    if not key:
        return None
    app_table = _table(os.path.join(_APPS_DIR, source, "public", "i18n.js")) if source and _SOURCE_RE.match(source) else {}
    for code in dict.fromkeys((lang, "en")):
        value = app_table.get((code, key))
        if value is None:
            value = _table(os.path.join(_I18N_DIR, f"{code}.js")).get((None, key))
        if value is not None:
            return value
    return None


def _text(key: Optional[str], fallback: str, vars: dict, lang: str, source: Optional[str]) -> str:
    value = _find(key, lang, source)
    if value is None:
        return fallback or ""
    return re.sub(r"\{(\w+)\}", lambda m: str(vars.get(m.group(1), "")), value)


def _own(key: str, lang: str, **vars) -> str:
    return _text(key, key, vars, lang, "telegramhub")


def _normalize_lang(code: Optional[str]) -> Optional[str]:
    if not code:
        return None
    code = code.replace("_", "-")
    for known in LANGS:
        if code.lower() == known.lower():
            return known
    base = code.split("-")[0].lower()
    if base == "pt":
        return "pt-BR"
    if base == "zh":
        return "zh-CN"
    return base if base in LANGS else None


def _lang_for(bot: dict, user: Optional[dict]) -> str:
    """The language the profile chose for its public pages; when it follows the
    browser ('auto') there is nothing to read here, so the language Telegram
    reported when the person pressed Start."""
    chosen = (user or {}).get("language")
    if chosen and chosen != "auto":
        return _normalize_lang(chosen) or "en"
    return _normalize_lang(bot.get("lang")) or "en"


# ── Telegram Bot API ────────────────────────────────────────────

def _call(token: str, method: str, payload: Optional[dict] = None) -> dict:
    try:
        r = httpx.post(API_BASE.format(token=token, method=method), json=payload or {}, timeout=10)
        data = r.json()
    except Exception as e:
        print(f"[telegramhub] {method} failed: {e}")
        return {"ok": False, "description": "network"}
    if not data.get("ok"):
        print(f"[telegramhub] {method} returned error: {data.get('description')}")
    return data


def _keyboard(buttons):
    if not buttons:
        return None
    def one(b):
        if "web_app" in b:
            return {"text": b["text"], "web_app": {"url": b["web_app"]}}
        if "callback" in b:
            return {"text": b["text"], "callback_data": b["callback"]}
        return {"text": b["text"], "url": b["url"]}
    return {"inline_keyboard": [[one(b) for b in row] for row in buttons]}


def _send(bot: dict, chat_id: str, text: str, buttons=None) -> dict:
    return _call(bot["token"], "sendMessage", {
        "chat_id": chat_id, "text": text, "parse_mode": "HTML",
        "reply_markup": _keyboard(buttons), "disable_web_page_preview": True,
    })


_UPDATES = ["message", "callback_query"]


def _webhook_url(bot: dict, base: str) -> str:
    return f"{base.rstrip('/')}/api/telegramhub/webhook/{bot['secret']}"


# ── What a bot opens ────────────────────────────────────────────

def _target(bot: dict) -> Optional[str]:
    """The public page a bot opens: Apps Hub, or its one app. A custom bot opens
    nothing — it is a menu."""
    if bot["mode"] == "hub":
        return "/pub/apphub/"
    if bot["mode"] == "app" and _SOURCE_RE.match(bot.get("app_id") or ""):
        return f"/pub/{bot['app_id']}/"
    return None


def _open_url(bot: dict, to: str) -> Optional[str]:
    base = get_public_base_url()
    if not base or not _TO_RE.match(to) or ".." in to or "//" in to:
        return None
    return f"{base.rstrip('/')}/pub/telegramhub/open?bot={bot['id']}&to={quote(to, safe='')}"


def _app_meta(source: Optional[str], lang: str) -> tuple:
    """(icon, name) of the app a notification comes from."""
    if source == "apphub" or not source:
        return "🏠", _own("tgh_src_apphub", lang)
    manifest = {}
    if _SOURCE_RE.match(source):
        try:
            with _release(), open(os.path.join(_APPS_DIR, source, "manifest.json"), encoding="utf-8") as f:
                manifest = json.load(f)
        except (OSError, ValueError):
            manifest = {}
    names = manifest.get("name_i18n") or {}
    return manifest.get("icon") or "🔔", names.get(lang) or manifest.get("name") or source


def _home_view(bot: dict, user: Optional[dict]) -> dict:
    lang = _lang_for(bot, user)
    if bot["mode"] == "custom":
        mod = _premium()
        if mod and mod.available():
            return mod.menu(bot, lang)
        return {"text": html.escape(_own("tgh_cb_unavailable", lang)), "buttons": []}
    to = _target(bot)
    url = _open_url(bot, to) if to else None
    if bot["mode"] == "hub":
        text = _own("tgh_bot_hub_ready", lang)
    else:
        text = _own("tgh_bot_app_ready", lang, app=html.escape(_app_meta(bot.get("app_id"), lang)[1]))
    return {"text": text, "buttons": [[{"text": _own("tgh_bot_open", lang), "web_app": url}]] if url else []}


# ── Updates from Telegram ───────────────────────────────────────

def _handle_update_sync(bot: dict, update: dict) -> None:
    hub = sys.modules.get("backend.apphub")
    users = hub.get_users_by_ids([bot["user_id"]]) if hub else []
    user = users[0] if users else None
    callback = update.get("callback_query")
    if callback:
        _handle_callback(bot, user, callback)
        return
    msg = update.get("message")
    if not msg or (msg.get("chat") or {}).get("type") != "private":
        return
    chat_id = str(msg["chat"]["id"])
    text = (msg.get("text") or "").strip()

    if bot["chat_id"] is None:
        m = re.fullmatch(r"/start\s+(\S+)", text)
        if m and bot["pair_code"] and hmac.compare_digest(m.group(1), bot["pair_code"]):
            lang = _normalize_lang((msg.get("from") or {}).get("language_code"))
            with _db() as conn:
                conn.execute("UPDATE bots SET chat_id=?, pair_code=NULL, lang=? WHERE id=?",
                             (chat_id, lang, bot["id"]))
                conn.commit()
            bot = {**bot, "chat_id": chat_id, "lang": lang}
            view = _home_view(bot, user)
            to = _target(bot)
            url = _open_url(bot, to) if to else None
            if url:
                _call(bot["token"], "setChatMenuButton", {
                    "chat_id": chat_id,
                    "menu_button": {"type": "web_app", "text": _own("tgh_bot_open", _lang_for(bot, user)),
                                    "web_app": {"url": url}},
                })
            _send(bot, chat_id, view["text"], view["buttons"])
        else:
            _send(bot, chat_id, html.escape(_own("tgh_bot_private", _lang_for(bot, user))))
        return

    if chat_id != bot["chat_id"]:
        _send(bot, chat_id, html.escape(_own("tgh_bot_private", _lang_for(bot, user))))
        return
    if bot["mode"] == "custom":
        mod = _premium()
        if mod and mod.available() and user:
            mod.on_message(bot, user, text, _lang_for(bot, user))
            return
    view = _home_view(bot, user)
    _send(bot, chat_id, view["text"], view["buttons"])


def _handle_callback(bot: dict, user: Optional[dict], callback: dict) -> None:
    """A button press in a custom bot. Only the chat the bot is paired with counts."""
    _call(bot["token"], "answerCallbackQuery", {"callback_query_id": callback.get("id")})
    chat = ((callback.get("message") or {}).get("chat") or {})
    if bot["mode"] != "custom" or not bot["chat_id"] or not user:
        return
    if str(chat.get("id")) != bot["chat_id"] or str((callback.get("from") or {}).get("id")) != bot["chat_id"]:
        return
    mod = _premium()
    lang = _lang_for(bot, user)
    if not (mod and mod.available()):
        _send(bot, bot["chat_id"], html.escape(_own("tgh_cb_unavailable", lang)))
        return
    mod.on_callback(bot, user, str(callback.get("data") or ""), lang)


# ── Notifications → Telegram ────────────────────────────────────

def _on_notification(row: dict) -> None:
    """Listener registered with backend/notifications.py. Runs in whatever thread
    created the notification, so it only hands the work to a thread of its own."""
    if row.get("audience") == "os":
        return
    threading.Thread(target=_deliver, args=(row,), daemon=True).start()


# A person who is looking at the thing the notification is about clears it from
# the bell within moments (an open chat marks its own messages read). Waiting
# this long before sending, and sending only if it is still unread, keeps Telegram
# from buzzing about what they are already reading.
_GRACE_SECONDS = 10


def _still_unread(row: dict) -> bool:
    if not row.get("id"):
        return True
    try:
        with sys.modules["backend.db"].get_conn() as conn:
            current = conn.execute("SELECT is_read FROM notifications WHERE id=?", (row["id"],)).fetchone()
    except Exception:
        return True
    return bool(current) and not current["is_read"]


def _deliver(row: dict) -> None:
    try:
        time.sleep(_GRACE_SECONDS)
        if not _still_unread(row):
            return
        with _db() as conn:
            bots = [_bot_row(r) for r in conn.execute("SELECT * FROM bots WHERE chat_id IS NOT NULL")]
        if not bots:
            return
        hub = sys.modules.get("backend.apphub")
        if not hub:
            return
        users = {u["id"]: u for u in hub.get_users_by_ids(list({b["user_id"] for b in bots}))}
        source = row.get("action_app") or row.get("source") or "apphub"
        for bot in bots:
            user = users.get(bot["user_id"])
            if not user or user.get("username") != row.get("username"):
                continue
            if bot["mode"] == "custom":
                continue
            if bot["mode"] == "hub":
                if source in _muted(bot["id"]):
                    continue
                link = row.get("link") or ""
                if link.startswith("/pub/"):
                    to = link
                elif _SOURCE_RE.match(source) and source in hub._detect_public_apps():
                    to = f"/pub/{source}/"
                else:
                    to = "/pub/apphub/"
            else:
                if source != bot["app_id"]:
                    continue
                to = f"/pub/{source}/"
            lang = _lang_for(bot, user)
            vars = {}
            if row.get("vars"):
                try:
                    vars = json.loads(row["vars"]) or {}
                except ValueError:
                    vars = {}
            title = _text(row.get("title_key"), row.get("title") or "", vars, lang, source)
            body = _text(row.get("body_key"), row.get("body") or "", vars, lang, source)
            icon, name = _app_meta(source, lang)
            text = f"{icon} <b>{html.escape(name)}</b>\n{html.escape(title)}"
            if body and body != title:
                text += f"\n{html.escape(body)}"
            url = _open_url(bot, to)
            link = row.get("link") or ""
            if not url and link.startswith("https://"):
                buttons = [[{"text": _own("tgh_bot_open", lang), "url": link}]]
            else:
                buttons = [[{"text": _own("tgh_bot_open", lang), "web_app": url}]] if url else []
            _send(bot, bot["chat_id"], text, buttons)
    except Exception as e:
        print(f"[telegramhub] delivering a notification failed: {e}")


def notify(*args, **kwargs) -> None:
    """Kept so an older app that still calls it does not break. Telegram now
    receives everything that is notified through backend/notifications.py, and
    those apps notify there as well, so sending here too would only duplicate."""
    return None


# ── Routers ─────────────────────────────────────────────────────

_admin = APIRouter(prefix="/api/telegramhub", tags=["telegramhub"])
_pub   = APIRouter(prefix="/api/pub/telegramhub", tags=["telegramhub-pub"])
router = APIRouter()


@_admin.get("/config")
async def get_config_admin(session=Depends(get_current_session)):
    with _db() as conn:
        bots = conn.execute("SELECT COUNT(*) FROM bots").fetchone()[0]
        linked = conn.execute("SELECT COUNT(*) FROM bots WHERE chat_id IS NOT NULL").fetchone()[0]
    return JSONResponse({
        "public_base_url": get_public_base_url() or "",
        "custom_enabled": _get_config("custom_enabled") == "1",
        "bots": bots,
        "linked": linked,
    })


class ConfigBody(BaseModel):
    public_base_url: Optional[str] = None
    custom_enabled: Optional[bool] = None


@_admin.put("/config")
async def update_config_admin(body: ConfigBody, session=Depends(get_current_session)):
    if body.custom_enabled:
        mod = _premium()
        if not (mod and mod.can_enable()):
            raise HTTPException(402, detail="Premium required")
    if body.custom_enabled is not None:
        _set_config("custom_enabled", "1" if body.custom_enabled else "0")
    if body.public_base_url is not None:
        base = body.public_base_url.strip().rstrip("/")
        if base and not base.startswith("https://"):
            raise HTTPException(400, detail="The public address must start with https://")
        old = get_public_base_url() or ""
        _set_config("public_base_url", base)
        if base and base != old:
            with _db() as conn:
                bots = [_bot_row(r) for r in conn.execute("SELECT * FROM bots")]
            for bot in bots:
                await asyncio.to_thread(_call, bot["token"], "setWebhook",
                                        {"url": _webhook_url(bot, base), "allowed_updates": _UPDATES})
    return JSONResponse({"ok": True})


# Telegram's servers call this directly — they carry no mvmOS session. The random
# per-bot secret in the path is what authenticates it, so it opts out of the core
# session-auth middleware with the generic marker (set on the function because
# include_router() copies route objects).
@_admin.post("/webhook/{secret}")
async def webhook(secret: str, request: Request):
    bot = _bot_by("secret", secret)
    if not bot:
        raise HTTPException(404)
    update = await request.json()
    await asyncio.to_thread(_handle_update_sync, bot, update)
    return JSONResponse({"ok": True})


webhook.no_session_auth = True


def _user_of(token: Optional[str]) -> dict:
    hub = sys.modules.get("backend.apphub")
    user = hub.get_pub_session(token) if hub else None
    if not user:
        raise HTTPException(401)
    return user


def _bot_json(bot: dict) -> dict:
    out = {
        "id": bot["id"], "username": bot["username"], "mode": bot["mode"], "app_id": bot.get("app_id"),
        "linked": bool(bot["chat_id"]),
        "pair_url": f"https://t.me/{bot['username']}?start={bot['pair_code']}" if bot["pair_code"] else None,
        "muted": sorted(_muted(bot["id"])) if bot["mode"] == "hub" else [],
    }
    if bot["mode"] == "custom":
        mod = _premium()
        out["usable"] = bool(mod and mod.available())
        out["buttons"] = mod.list_buttons(bot) if out["usable"] else []
    return out


@_pub.get("/state")
async def state(x_pub_token: Optional[str] = Header(default=None)):
    user = _user_of(x_pub_token)
    return JSONResponse({
        "configured": bool(get_public_base_url()),
        "custom": custom_available(),
        "bots": [_bot_json(b) for b in _bots_of(user["id"])],
    })


class BotBody(BaseModel):
    token: str
    mode: str = "hub"
    app_id: Optional[str] = None


def _fail(code: str, status: int = 400):
    raise HTTPException(status, detail=code)


@_pub.post("/bots")
async def create_bot(body: BotBody, x_pub_token: Optional[str] = Header(default=None)):
    user = _user_of(x_pub_token)
    base = get_public_base_url()
    if not base:
        _fail("no_base_url")
    token = body.token.strip()
    if not _TOKEN_RE.match(token):
        _fail("invalid_token")
    existing = _bots_of(user["id"])
    app_id = None
    if body.mode == "app":
        app_id = (body.app_id or "").strip()
        if not _valid_app(user, app_id):
            _fail("invalid_app")
        if any(b["mode"] == "app" and b["app_id"] == app_id for b in existing):
            _fail("app_exists")
    elif body.mode == "custom":
        if not custom_available():
            _fail("unavailable", 403)
    elif body.mode == "hub":
        if any(b["mode"] == "hub" for b in existing):
            _fail("hub_exists")
    else:
        _fail("invalid_mode")

    me = await asyncio.to_thread(_call, token, "getMe")
    if not me.get("ok"):
        _fail("invalid_token")
    tg_id = str(me["result"]["id"])
    if _bot_by("tg_id", tg_id):
        _fail("bot_in_use")

    bot = {
        "id": secrets.token_urlsafe(8), "user_id": user["id"], "token": token, "tg_id": tg_id,
        "username": me["result"].get("username") or "", "mode": body.mode, "app_id": app_id,
        "secret": secrets.token_urlsafe(24), "chat_id": None, "pair_code": secrets.token_urlsafe(9), "lang": None,
    }
    hook = await asyncio.to_thread(_call, token, "setWebhook",
                                   {"url": _webhook_url(bot, base), "allowed_updates": _UPDATES})
    if not hook.get("ok"):
        _fail("webhook_failed")
    with _db() as conn:
        conn.execute(
            "INSERT INTO bots(id,user_id,token,tg_id,username,mode,app_id,secret,pair_code,created_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (bot["id"], bot["user_id"], _enc(token), tg_id, bot["username"], bot["mode"], app_id,
             bot["secret"], bot["pair_code"], datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    return JSONResponse(_bot_json(bot))


def _own_bot(bot_id: str, user: dict) -> dict:
    bot = _bot_by("id", bot_id)
    if not bot or bot["user_id"] != user["id"]:
        raise HTTPException(404)
    return bot


@_pub.delete("/bots/{bot_id}")
async def delete_bot(bot_id: str, x_pub_token: Optional[str] = Header(default=None)):
    bot = _own_bot(bot_id, _user_of(x_pub_token))
    await asyncio.to_thread(_call, bot["token"], "deleteWebhook")
    with _db() as conn:
        conn.execute("DELETE FROM muted WHERE bot_id=?", (bot["id"],))
        conn.execute("DELETE FROM buttons WHERE bot_id=?", (bot["id"],))
        conn.execute("DELETE FROM convo WHERE bot_id=?", (bot["id"],))
        conn.execute("DELETE FROM bots WHERE id=?", (bot["id"],))
        conn.commit()
    return JSONResponse({"ok": True})


@_pub.post("/bots/{bot_id}/reconnect")
async def reconnect_bot(bot_id: str, x_pub_token: Optional[str] = Header(default=None)):
    bot = _own_bot(bot_id, _user_of(x_pub_token))
    code = secrets.token_urlsafe(9)
    with _db() as conn:
        conn.execute("UPDATE bots SET chat_id=NULL, pair_code=? WHERE id=?", (code, bot["id"]))
        conn.commit()
    return JSONResponse(_bot_json({**bot, "chat_id": None, "pair_code": code}))


class MuteBody(BaseModel):
    source: str
    muted: bool


@_pub.put("/bots/{bot_id}/muted")
async def set_muted(bot_id: str, body: MuteBody, x_pub_token: Optional[str] = Header(default=None)):
    bot = _own_bot(bot_id, _user_of(x_pub_token))
    if bot["mode"] != "hub" or not _SOURCE_RE.match(body.source):
        raise HTTPException(400)
    with _db() as conn:
        if body.muted:
            conn.execute("INSERT OR IGNORE INTO muted(bot_id,source) VALUES(?,?)", (bot["id"], body.source))
        else:
            conn.execute("DELETE FROM muted WHERE bot_id=? AND source=?", (bot["id"], body.source))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Custom bot buttons (the work is done by the premium module) ──

class ButtonBody(BaseModel):
    name: str
    app_id: str
    fn: str
    params: list = []
    reply: str = ""


def _custom_bot(bot_id: str, token: Optional[str]) -> tuple:
    user = _user_of(token)
    bot = _own_bot(bot_id, user)
    if bot["mode"] != "custom":
        raise HTTPException(400)
    return _custom(), user, bot


def _guard(call):
    try:
        return call()
    except Exception as e:
        code = getattr(e, "args", [""])[0]
        if type(e).__name__ == "Invalid":
            raise HTTPException(400, detail=str(code))
        raise


@_pub.get("/catalog")
async def custom_catalog(x_pub_token: Optional[str] = Header(default=None)):
    mod, user = _custom(), _user_of(x_pub_token)
    return JSONResponse({"apps": await asyncio.to_thread(mod.catalog, user)})


@_pub.get("/options")
async def custom_options(app: str, fn: str, param: str, x_pub_token: Optional[str] = Header(default=None)):
    mod, user = _custom(), _user_of(x_pub_token)
    return JSONResponse({"options": await asyncio.to_thread(_guard, lambda: mod.options(user, app, fn, param))})


@_pub.post("/bots/{bot_id}/buttons")
async def add_button(bot_id: str, body: ButtonBody, x_pub_token: Optional[str] = Header(default=None)):
    mod, user, bot = _custom_bot(bot_id, x_pub_token)
    saved = await asyncio.to_thread(_guard, lambda: mod.save_button(bot, user, body.model_dump()))
    return JSONResponse(saved)


@_pub.put("/bots/{bot_id}/buttons/{button_id}")
async def edit_button(bot_id: str, button_id: int, body: ButtonBody,
                      x_pub_token: Optional[str] = Header(default=None)):
    mod, user, bot = _custom_bot(bot_id, x_pub_token)
    saved = await asyncio.to_thread(_guard, lambda: mod.save_button(bot, user, body.model_dump(), button_id))
    return JSONResponse(saved)


@_pub.delete("/bots/{bot_id}/buttons/{button_id}")
async def remove_button(bot_id: str, button_id: int, x_pub_token: Optional[str] = Header(default=None)):
    mod, user, bot = _custom_bot(bot_id, x_pub_token)
    await asyncio.to_thread(mod.delete_button, bot, button_id)
    return JSONResponse({"ok": True})


class MiniAppAuthBody(BaseModel):
    init_data: str
    bot_id: str


def _verify_init_data(init_data: str, token: str, max_age: int = 86400) -> Optional[dict]:
    """Telegram's documented Mini App check: HMAC-SHA256 keyed with
    HMAC_SHA256("WebAppData", bot_token). Returns the Telegram user, or None."""
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None
    received = pairs.pop("hash", None)
    if not received:
        return None
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(hmac.new(secret, check.encode(), hashlib.sha256).hexdigest(), received):
        return None
    try:
        if max_age and datetime.now(timezone.utc).timestamp() - int(pairs.get("auth_date", "0")) > max_age:
            return None
        return json.loads(pairs.get("user", "{}")) or None
    except ValueError:
        return None


@_pub.post("/miniapp/auth")
async def miniapp_auth(body: MiniAppAuthBody):
    """Signs a person in from inside their own bot: the Mini App data must be
    signed by this bot's token and come from the chat the bot is paired with."""
    bot = _bot_by("id", body.bot_id)
    tg_user = _verify_init_data(body.init_data, bot["token"]) if bot else None
    if not bot or not tg_user or not bot["chat_id"] or str(tg_user.get("id")) != bot["chat_id"]:
        raise HTTPException(401, detail="Invalid Telegram auth")
    hub = sys.modules.get("backend.apphub")
    if not hub or not hub.get_users_by_ids([bot["user_id"]]):
        raise HTTPException(401, detail="Profile not found")
    return JSONResponse({"pub_token": hub.issue_pub_token(bot["user_id"])})


router.include_router(_admin)
router.include_router(_pub)

_notifications = sys.modules.get("backend.notifications")
if _notifications is not None:
    _notifications.register_listener("telegramhub", _on_notification)
