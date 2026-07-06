"""
Telegram Hub — re-presents Apps Hub public apps inside a Telegram bot.

Knows nothing about any specific app. Any app can opt in by adding
backend/apps/<id>/telegram.py next to its public.py, exposing:

    APP_NAME  (str)
    APP_ICON  (str, optional)
    render_menu(user: dict)                    -> TgView | Awaitable[TgView]
    handle_callback(user: dict, data: str)      -> TgView | Awaitable[TgView]   (optional)
    handle_text(user: dict, state: str, text: str) -> TgView | Awaitable[TgView] | None (optional)

All three may be `async def` — the dispatcher awaits the result if it's
awaitable, so adapters needing network/IO (e.g. querying a local service)
can use async httpx calls directly.

TgView = {"text": str, "buttons": [[{"text": str, "data"|"url"|"web_app": str}, ...], ...]}
A button has exactly one of "data" (callback_data, namespaced by the
dispatcher as "<app_id>:<payload>" before being handed back to the app),
"url" (opens in the system browser), or "web_app" (opens a Telegram Mini
App at that URL — adapters that are pure Mini Apps can skip
handle_callback/handle_text entirely).

Exports (used by other app backends via sys.modules["app_backend_telegramhub"]):
  notify(user_id, app_id, text, callback=None) -> None
  get_public_base_url() -> str | None
  verify_init_data(init_data: str) -> dict | None
"""

import asyncio
import hashlib
import hmac
import inspect
import json
import os
import secrets
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import parse_qsl

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

API_BASE = "https://api.telegram.org/bot{token}/{method}"

_DIR      = os.path.dirname(__file__)
_DB_PATH  = os.path.join(_DIR, "..", "..", "..", "apps", "telegramhub", "data.db")
_APPS_DIR = os.path.join(_DIR, "..")

# app_id -> module, cached after first load; cleared on (re)detect
_adapters: dict = {}


def _db():
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS config (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS links (
            chat_id    TEXT PRIMARY KEY,
            user_id    TEXT NOT NULL,
            pub_token  TEXT NOT NULL,
            linked_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS link_codes (
            code       TEXT PRIMARY KEY,
            chat_id    TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS enabled_apps (
            app_id     TEXT PRIMARY KEY,
            enabled    INTEGER NOT NULL DEFAULT 0,
            admin_only INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_state (
            chat_id    TEXT PRIMARY KEY,
            app_id     TEXT,
            state      TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_usage (
            chat_id        TEXT NOT NULL,
            app_id         TEXT NOT NULL,
            open_count     INTEGER NOT NULL DEFAULT 0,
            last_opened_at TEXT,
            PRIMARY KEY (chat_id, app_id)
        );
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(enabled_apps)")}
    if "admin_only" not in cols:
        conn.execute("ALTER TABLE enabled_apps ADD COLUMN admin_only INTEGER NOT NULL DEFAULT 0")
    return conn


def _hub():
    return sys.modules.get("backend.apphub")


# ── Config (bot token) ──────────────────────────────────────────

def _get_config(key: str) -> Optional[str]:
    with _db() as conn:
        row = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def _set_config(key: str, value: str) -> None:
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO config(key,value) VALUES(?,?)", (key, value))
        conn.commit()


def get_bot_token() -> Optional[str]:
    return _get_config("bot_token")


def get_webhook_secret() -> Optional[str]:
    secret = _get_config("webhook_secret")
    if not secret:
        secret = secrets.token_urlsafe(24)
        _set_config("webhook_secret", secret)
    return secret


def get_public_base_url() -> Optional[str]:
    """Exported for other app backends building Mini App URLs
    (sys.modules["app_backend_telegramhub"].get_public_base_url())."""
    return _get_config("public_base_url")


def verify_init_data(init_data: str, max_age: int = 86400) -> Optional[dict]:
    """Verify a Telegram Mini App `initData` string per Telegram's documented
    HMAC-SHA256 scheme (secret_key = HMAC_SHA256("WebAppData", bot_token)).
    Returns the parsed `user` dict on success, None if the signature is
    invalid, expired, or the bot token isn't configured."""
    token = get_bot_token()
    if not token or not init_data:
        return None
    try:
        pairs = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        return None
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return None
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(computed_hash, received_hash):
        return None
    try:
        auth_date = int(pairs.get("auth_date", "0"))
    except ValueError:
        return None
    if max_age and datetime.now(timezone.utc).timestamp() - auth_date > max_age:
        return None
    try:
        user = json.loads(pairs.get("user", "{}"))
    except ValueError:
        return None
    return user or None


# ── App adapter discovery ───────────────────────────────────────

def _detect_telegram_apps() -> list:
    """Scan backend/apps/ for directories with telegram.py."""
    result = []
    if not os.path.isdir(_APPS_DIR):
        return result
    for app_id in sorted(os.listdir(_APPS_DIR)):
        if app_id.startswith("_"):
            continue
        if os.path.isfile(os.path.join(_APPS_DIR, app_id, "telegram.py")):
            result.append(app_id)
    return result


def _load_adapter(app_id: str):
    if app_id in _adapters:
        return _adapters[app_id]
    path = os.path.join(_APPS_DIR, app_id, "telegram.py")
    if not os.path.isfile(path):
        _adapters[app_id] = None
        return None
    import types
    mod_name = f"telegram_adapter_{app_id}"
    try:
        with open(path) as f:
            source = f.read()
        mod = types.ModuleType(mod_name)
        mod.__file__ = path
        sys.modules[mod_name] = mod
        exec(compile(source, path, "exec"), mod.__dict__)
        _adapters[app_id] = mod
        return mod
    except Exception as e:
        print(f"[telegramhub] failed to load adapter {app_id}: {e}")
        _adapters[app_id] = None
        return None


def is_app_enabled(app_id: str) -> bool:
    with _db() as conn:
        row = conn.execute("SELECT enabled FROM enabled_apps WHERE app_id=?", (app_id,)).fetchone()
    return bool(row and row["enabled"])


def _is_admin_only(app_id: str) -> bool:
    with _db() as conn:
        row = conn.execute("SELECT admin_only FROM enabled_apps WHERE app_id=?", (app_id,)).fetchone()
    return bool(row and row["admin_only"])


def _can_use_app(app_id: str, user: Optional[dict]) -> bool:
    """Enabled AND (not admin-only, or the linked user is flagged is_admin
    on their Apps Hub profile). `user` is whatever get_pub_session() returned."""
    if not is_app_enabled(app_id):
        return False
    if _is_admin_only(app_id):
        return bool(user and user.get("is_admin"))
    return True


def _enabled_adapters(user: Optional[dict] = None) -> list:
    out = []
    for app_id in _detect_telegram_apps():
        if not _can_use_app(app_id, user):
            continue
        mod = _load_adapter(app_id)
        if mod:
            out.append((app_id, mod))
    return out


# ── App ordering (mirrors the Apps Hub "Sort by" options) ────────

def _record_app_usage(chat_id: str, app_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute(
            """INSERT INTO app_usage(chat_id, app_id, open_count, last_opened_at) VALUES(?,?,1,?)
               ON CONFLICT(chat_id, app_id) DO UPDATE SET
                 open_count = open_count + 1,
                 last_opened_at = excluded.last_opened_at""",
            (chat_id, app_id, now)
        )
        conn.commit()


def _get_app_usage(chat_id: str) -> dict:
    with _db() as conn:
        rows = conn.execute(
            "SELECT app_id, open_count, last_opened_at FROM app_usage WHERE chat_id=?", (chat_id,)
        ).fetchall()
    return {r["app_id"]: {"count": r["open_count"], "last": r["last_opened_at"] or ""} for r in rows}


def _sort_adapters(chat_id: str, adapters: list) -> list:
    mode = _get_config("apps_sort_mode") or "alpha"
    if mode == "alpha":
        return sorted(adapters, key=lambda item: getattr(item[1], "APP_NAME", item[0]).lower())
    usage = _get_app_usage(chat_id)
    if mode == "recent":
        return sorted(adapters, key=lambda item: usage.get(item[0], {}).get("last", ""), reverse=True)
    if mode == "frequent":
        return sorted(adapters, key=lambda item: usage.get(item[0], {}).get("count", 0), reverse=True)
    return adapters


# ── Chat state (which app/state a chat is currently in) ─────────

def _get_state(chat_id: str):
    with _db() as conn:
        row = conn.execute("SELECT app_id, state FROM chat_state WHERE chat_id=?", (chat_id,)).fetchone()
    return (row["app_id"], row["state"]) if row else (None, None)


def _set_state(chat_id: str, app_id: Optional[str], state: Optional[str]) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO chat_state(chat_id,app_id,state,updated_at) VALUES(?,?,?,?)",
            (chat_id, app_id, state, datetime.now(timezone.utc).isoformat())
        )
        conn.commit()


# ── Linking chat_id <-> mvmOS pub user ───────────────────────────

def _find_link(chat_id: str) -> Optional[dict]:
    with _db() as conn:
        row = conn.execute("SELECT * FROM links WHERE chat_id=?", (chat_id,)).fetchone()
    return dict(row) if row else None


def _pub_user_for_chat(chat_id: str) -> Optional[dict]:
    link = _find_link(chat_id)
    if not link:
        return None
    hub = _hub()
    if not hub:
        return None
    user = hub.get_pub_session(link["pub_token"])
    if not user:
        return None
    return user


def create_link_code(chat_id: str) -> str:
    code = secrets.token_urlsafe(6)
    now = datetime.now(timezone.utc)
    expires = datetime.fromtimestamp(now.timestamp() + 600, tz=timezone.utc)
    with _db() as conn:
        conn.execute(
            "INSERT INTO link_codes(code,chat_id,created_at,expires_at) VALUES(?,?,?,?)",
            (code, chat_id, now.isoformat(), expires.isoformat())
        )
        conn.commit()
    return code


def confirm_link_code(code: str, pub_token: str) -> bool:
    """Called from the small web confirmation page once the user is logged in
    with their mvmOS Apps Hub account. Binds the chat_id that requested `code`
    to this pub_token."""
    hub = _hub()
    user = hub.get_pub_session(pub_token) if hub else None
    if not user:
        return False
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        row = conn.execute(
            "SELECT chat_id FROM link_codes WHERE code=? AND expires_at>?", (code, now)
        ).fetchone()
        if not row:
            return False
        conn.execute(
            "INSERT OR REPLACE INTO links(chat_id,user_id,pub_token,linked_at) VALUES(?,?,?,?)",
            (row["chat_id"], user["id"], pub_token, now)
        )
        conn.execute("DELETE FROM link_codes WHERE code=?", (code,))
        conn.commit()
    return True


def unlink_chat(chat_id: str) -> None:
    with _db() as conn:
        conn.execute("DELETE FROM links WHERE chat_id=?", (chat_id,))
        conn.commit()


def _link_button(chat_id: str) -> dict:
    """A native Telegram URL button that opens the link-confirmation page
    directly in the browser — no callback round-trip, no text link to spot
    and tap by hand."""
    code = create_link_code(chat_id)
    base = _get_config("public_base_url") or ""
    link_url = f"{base.rstrip('/')}/pub/telegramhub/link?code={code}"
    return {"text": "🔗 Link account", "url": link_url}


# ── Telegram Bot API client ──────────────────────────────────────

async def _api(method: str, payload: dict) -> Optional[dict]:
    token = get_bot_token()
    if not token:
        return None
    url = API_BASE.format(token=token, method=method)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=payload)
            data = r.json()
            if not data.get("ok"):
                print(f"[telegramhub] api call {method} returned error: {data.get('description')}")
            return data
    except Exception as e:
        print(f"[telegramhub] api call {method} failed: {e}")
        return None


def _kb(buttons):
    if not buttons:
        return None
    def _btn(b):
        if "web_app" in b:
            return {"text": b["text"], "web_app": {"url": b["web_app"]}}
        if "url" in b:
            return {"text": b["text"], "url": b["url"]}
        return {"text": b["text"], "callback_data": b["data"]}
    return {"inline_keyboard": [[_btn(b) for b in row] for row in buttons]}


async def _send(chat_id: str, view: dict) -> None:
    await _api("sendMessage", {
        "chat_id": chat_id,
        "text": view.get("text", ""),
        "reply_markup": _kb(view.get("buttons")),
        "parse_mode": "HTML",
    })


async def _edit(chat_id: str, message_id: int, view: dict) -> None:
    ok = await _api("editMessageText", {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": view.get("text", ""),
        "reply_markup": _kb(view.get("buttons")),
        "parse_mode": "HTML",
    })
    if not ok or not ok.get("ok"):
        await _send(chat_id, view)


async def set_webhook(base_url: str) -> dict:
    secret = get_webhook_secret()
    url = f"{base_url.rstrip('/')}/api/telegramhub/webhook/{secret}"
    return await _api("setWebhook", {"url": url})


async def delete_webhook() -> dict:
    return await _api("deleteWebhook", {})


# ── Home menu ─────────────────────────────────────────────────────

def _home_view(chat_id: str) -> dict:
    user = _pub_user_for_chat(chat_id)
    if not user:
        return {
            "text": "👋 Welcome to mvmOS Hub.\n\nLink your Apps Hub account to get started.",
            "buttons": [[_link_button(chat_id)]],
        }
    adapters = _enabled_adapters(user)
    if not adapters:
        return {"text": f"Hi {user.get('display_name','?')} 👋\n\nNo apps are enabled yet.", "buttons": []}
    adapters = _sort_adapters(chat_id, adapters)
    rows = []
    for app_id, mod in adapters:
        icon = getattr(mod, "APP_ICON", "📦")
        name = getattr(mod, "APP_NAME", app_id)
        rows.append([{"text": f"{icon} {name}", "data": f"{app_id}:__open__"}])
    return {
        "text": f"Hi {user.get('display_name','?')} 👋\n\nChoose an app:",
        "buttons": rows,
    }


def _with_home_button(view: dict) -> dict:
    buttons = list(view.get("buttons") or [])
    buttons.append([{"text": "🏠 Home", "data": "hub:home"}])
    return {"text": view.get("text", ""), "buttons": buttons}


def _namespaced(app_id: str, view: dict) -> dict:
    """Adapters return bare callback data (e.g. "open:123"); prefix it with
    the app_id so the dispatcher can route the tap back to this adapter."""
    buttons = [
        [{**b, "data": f"{app_id}:{b['data']}"} if "data" in b else b for b in row]
        for row in (view.get("buttons") or [])
    ]
    return {**view, "buttons": buttons}


# ── Update dispatch ────────────────────────────────────────────

async def _dispatch_callback(chat_id: str, message_id: Optional[int], data: str) -> None:
    if ":" not in data:
        return
    app_id, payload = data.split(":", 1)

    if app_id == "hub":
        if payload == "home":
            _set_state(chat_id, None, None)
        view = _home_view(chat_id)
        if message_id:
            await _edit(chat_id, message_id, view)
        else:
            await _send(chat_id, view)
        return

    if not is_app_enabled(app_id):
        return
    mod = _load_adapter(app_id)
    if not mod:
        return
    user = _pub_user_for_chat(chat_id)
    if not user:
        await _send(chat_id, {"text": "Please link your account first.", "buttons": [[_link_button(chat_id)]]})
        return
    if not _can_use_app(app_id, user):
        return

    if payload == "__open__":
        _record_app_usage(chat_id, app_id)
        view = mod.render_menu(user)
    else:
        fn = getattr(mod, "handle_callback", None)
        view = fn(user, payload) if fn else mod.render_menu(user)
    if inspect.isawaitable(view):
        view = await view

    _set_state(chat_id, app_id, view.get("_enter_state"))
    view = _with_home_button(_namespaced(app_id, view))
    if message_id:
        await _edit(chat_id, message_id, view)
    else:
        await _send(chat_id, view)


async def _dispatch_text(chat_id: str, text: str) -> None:
    if text.strip() in ("/start", "/home"):
        _set_state(chat_id, None, None)
        await _send(chat_id, _home_view(chat_id))
        return

    app_id, state = _get_state(chat_id)
    if not app_id or not is_app_enabled(app_id):
        await _send(chat_id, _home_view(chat_id))
        return
    mod = _load_adapter(app_id)
    if not mod:
        return
    user = _pub_user_for_chat(chat_id)
    if not user:
        await _send(chat_id, {"text": "Please link your account first.", "buttons": [[_link_button(chat_id)]]})
        return
    if not _can_use_app(app_id, user):
        await _send(chat_id, _home_view(chat_id))
        return
    fn = getattr(mod, "handle_text", None)
    if not fn:
        return
    view = fn(user, state, text)
    if inspect.isawaitable(view):
        view = await view
    if view:
        _set_state(chat_id, app_id, view.get("_enter_state", state))
        await _send(chat_id, _with_home_button(_namespaced(app_id, view)))


async def handle_update(update: dict) -> None:
    if "callback_query" in update:
        cq = update["callback_query"]
        chat_id = str(cq["message"]["chat"]["id"])
        message_id = cq["message"].get("message_id")
        data = cq.get("data", "")
        await _api("answerCallbackQuery", {"callback_query_id": cq["id"]})
        await _dispatch_callback(chat_id, message_id, data)
        return

    if "message" in update:
        msg = update["message"]
        chat_id = str(msg["chat"]["id"])
        text = msg.get("text", "")
        if text:
            await _dispatch_text(chat_id, text)


# ── Notify hook (called by app backends) ─────────────────────────

def notify(user_id: str, app_id: str, text: str, callback: Optional[str] = None,
           web_app: Optional[str] = None) -> None:
    """Fire-and-forget notification to a linked user's Telegram chat.
    App backends call this via sys.modules["app_backend_telegramhub"].notify(...)
    when something happens that the user should hear about even outside mvmOS
    (e.g. a new chat message). Safe to call even if the user isn't linked or
    the app isn't enabled — becomes a no-op.
    Pass `web_app` (a Mini App URL) for apps that are pure Mini Apps and have
    no `handle_callback`; pass `callback` for apps still using the classic
    callback_data menu flow. `web_app` takes precedence if both are given."""
    if not is_app_enabled(app_id):
        return
    with _db() as conn:
        row = conn.execute("SELECT chat_id, pub_token FROM links WHERE user_id=?", (user_id,)).fetchone()
    if not row:
        return
    if _is_admin_only(app_id):
        hub = _hub()
        linked_user = hub.get_pub_session(row["pub_token"]) if hub else None
        if not linked_user or not linked_user.get("is_admin"):
            return
    chat_id = row["chat_id"]
    if web_app:
        button = [{"text": "Open", "web_app": web_app}]
    elif callback:
        button = [{"text": "Open", "data": f"{app_id}:{callback}"}]
    else:
        button = []
    view = {"text": text, "buttons": [button] if button else []}
    view = _with_home_button(view)

    async def _go():
        await _send(chat_id, view)

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(_go())
        else:
            loop.run_until_complete(_go())
    except RuntimeError:
        asyncio.run(_go())


# ── Routers ────────────────────────────────────────────────────

_admin = APIRouter(prefix="/api/telegramhub", tags=["telegramhub"])
_pub   = APIRouter(prefix="/api/pub/telegramhub", tags=["telegramhub-pub"])
router = APIRouter()


@_admin.get("/config")
async def get_config_admin(session=Depends(get_current_session)):
    token = get_bot_token()
    return JSONResponse({
        "bot_token_set": bool(token),
        "bot_token_preview": (token[:8] + "…") if token else None,
        "bot_username": _get_config("bot_username") or "",
        "public_base_url": _get_config("public_base_url") or "",
        "webhook_secret": get_webhook_secret(),
    })


class ConfigBody(BaseModel):
    bot_token: Optional[str] = None
    bot_username: Optional[str] = None
    public_base_url: Optional[str] = None


@_admin.put("/config")
async def update_config_admin(body: ConfigBody, session=Depends(get_current_session)):
    if body.bot_token is not None and body.bot_token.strip():
        _set_config("bot_token", body.bot_token.strip())
    if body.bot_username is not None:
        _set_config("bot_username", body.bot_username.strip().lstrip("@"))
    if body.public_base_url is not None:
        _set_config("public_base_url", body.public_base_url.strip())
    return JSONResponse({"ok": True})


@_admin.post("/webhook/register")
async def register_webhook(session=Depends(get_current_session)):
    base = _get_config("public_base_url")
    if not base:
        raise HTTPException(400, detail="Set the public base URL first")
    result = await set_webhook(base)
    return JSONResponse(result or {"ok": False})


@_admin.post("/webhook/unregister")
async def unregister_webhook(session=Depends(get_current_session)):
    result = await delete_webhook()
    return JSONResponse(result or {"ok": False})


@_admin.get("/apps")
async def list_telegram_apps(session=Depends(get_current_session)):
    import json as _json
    detected = _detect_telegram_apps()
    with _db() as conn:
        rows = {r["app_id"]: r for r in conn.execute("SELECT app_id, enabled, admin_only FROM enabled_apps").fetchall()}
    result = []
    for app_id in detected:
        mpath = os.path.join(_APPS_DIR, app_id, "manifest.json")
        try:
            m = _json.load(open(mpath)) if os.path.isfile(mpath) else {}
        except Exception:
            m = {}
        mod = _load_adapter(app_id)
        r = rows.get(app_id)
        result.append({
            "id":         app_id,
            "name":       getattr(mod, "APP_NAME", m.get("name", app_id)) if mod else m.get("name", app_id),
            "icon":       getattr(mod, "APP_ICON", m.get("icon", "📦")) if mod else m.get("icon", "📦"),
            "enabled":    bool(r["enabled"]) if r else False,
            "admin_only": bool(r["admin_only"]) if r else False,
        })
    return JSONResponse(result)


class AppToggle(BaseModel):
    enabled: bool
    admin_only: Optional[bool] = None


@_admin.put("/apps/{app_id}")
async def toggle_telegram_app(app_id: str, body: AppToggle, session=Depends(get_current_session)):
    with _db() as conn:
        row = conn.execute("SELECT admin_only FROM enabled_apps WHERE app_id=?", (app_id,)).fetchone()
        admin_only = body.admin_only if body.admin_only is not None else bool(row and row["admin_only"])
        conn.execute(
            "INSERT INTO enabled_apps(app_id, enabled, admin_only) VALUES(?,?,?) "
            "ON CONFLICT(app_id) DO UPDATE SET enabled=excluded.enabled, admin_only=excluded.admin_only",
            (app_id, 1 if body.enabled else 0, 1 if admin_only else 0)
        )
        conn.commit()
    return JSONResponse({"ok": True})


@_admin.get("/apps-sort")
async def get_apps_sort(session=Depends(get_current_session)):
    return JSONResponse({"mode": _get_config("apps_sort_mode") or "alpha"})


class SortBody(BaseModel):
    mode: str


@_admin.put("/apps-sort")
async def set_apps_sort(body: SortBody, session=Depends(get_current_session)):
    if body.mode not in ("alpha", "recent", "frequent"):
        raise HTTPException(400, detail="Invalid sort mode")
    _set_config("apps_sort_mode", body.mode)
    return JSONResponse({"ok": True})


@_admin.get("/stats")
async def get_stats_admin(session=Depends(get_current_session)):
    with _db() as conn:
        linked = conn.execute("SELECT COUNT(*) FROM links").fetchone()[0]
    return JSONResponse({"linked_chats": linked})


# ── Public webhook receiver ──────────────────────────────────────

@_admin.post("/webhook/{secret}")
async def webhook(secret: str, request: Request):
    if secret != get_webhook_secret():
        raise HTTPException(404)
    update = await request.json()
    await handle_update(update)
    return JSONResponse({"ok": True})

# Telegram's servers call this directly — they never carry an mvmOS session
# cookie. The route is already protected by the random `secret` path segment
# above, so it opts out of the core session-auth middleware via this generic
# marker (see backend/app_backends.py / backend/main.py's auth_middleware).
# Set on the endpoint function itself since include_router() copies route
# objects (losing any attribute set directly on the route).
webhook.no_session_auth = True


# ── Public link-confirmation page ────────────────────────────────

class LinkConfirmBody(BaseModel):
    code: str


@_pub.post("/link/confirm")
async def link_confirm(body: LinkConfirmBody, request: Request):
    pub_token = request.headers.get("x-pub-token")
    if not pub_token:
        raise HTTPException(401)
    ok = confirm_link_code(body.code, pub_token)
    if not ok:
        raise HTTPException(400, detail="Invalid or expired code")
    return JSONResponse({"ok": True})


class MiniAppAuthBody(BaseModel):
    init_data: str


@_pub.post("/miniapp/auth")
async def miniapp_auth(body: MiniAppAuthBody):
    """Exchange a Telegram Mini App `initData` string for the linked mvmOS
    pub_token, so a Mini App page can reuse the existing ChatWidget etc.
    without any separate login flow."""
    tg_user = verify_init_data(body.init_data)
    if not tg_user or "id" not in tg_user:
        raise HTTPException(401, detail="Invalid Telegram auth")
    link = _find_link(str(tg_user["id"]))
    if not link:
        raise HTTPException(401, detail="Telegram account not linked")
    hub = _hub()
    user = hub.get_pub_session(link["pub_token"]) if hub else None
    if not user:
        raise HTTPException(401, detail="Session expired")
    return JSONResponse({"pub_token": link["pub_token"]})


@_pub.get("/info")
async def public_info():
    """Bare, unauthenticated info for the /pub/telegramhub/ directory page —
    just enough to link visitors to the bot itself."""
    return JSONResponse({"bot_username": _get_config("bot_username") or ""})


router.include_router(_admin)
router.include_router(_pub)
