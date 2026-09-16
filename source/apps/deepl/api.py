"""Public (Apps Hub) surface for the DeepL Translator app.

Every Apps Hub user holds their own DeepL API key here — never a single
server-wide key, since a shared key would be exhausted almost immediately by
a handful of active users. Other apps (RSS Reader, Nostradamus) call
/pub/deepl/translate directly from their own public frontend using the same
X-Pub-Token the visitor already holds; this module never sees which app the
call originated from, it only ever translates on behalf of the calling user.
"""

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from fastapi import APIRouter, Header
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()
APP_ID = "deepl"
_DIR = os.path.dirname(__file__)
_DB_PATH = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_SCRIPTS = ("i18n.js", "widget.js")

_MAX_TEXT_LEN = 5000
_MAX_HISTORY = 200


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
            CREATE TABLE IF NOT EXISTS user_keys (
                user_id TEXT PRIMARY KEY,
                api_key TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                source_lang TEXT,
                target_lang TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id, created_at DESC);
        """)
        conn.commit()


_init_db()


class SettingsIn(BaseModel):
    api_key: str


class TranslateIn(BaseModel):
    text: str
    target_lang: str
    source_lang: Optional[str] = None


def _user(token: Optional[str]):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _private_response():
    return JSONResponse({"error": "unauthorized"}, status_code=401)


def get_key(user_id: str) -> Optional[str]:
    with _conn() as conn:
        row = conn.execute("SELECT api_key FROM user_keys WHERE user_id=?", (user_id,)).fetchone()
    return row["api_key"] if row else None


def call_deepl(api_key: str, text: str, target_lang: str, source_lang: Optional[str] = None):
    """Calls DeepL's HTTP API server-side with one user's own key. Returns
    (translated_text, detected_source_lang) or raises ValueError with a short
    machine-readable reason."""
    base = "https://api-free.deepl.com" if api_key.strip().endswith(":fx") else "https://api.deepl.com"
    params = {"text": text, "target_lang": target_lang.upper()}
    if source_lang:
        params["source_lang"] = source_lang.upper()
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/v2/translate",
        data=data,
        method="POST",
        headers={
            "Authorization": f"DeepL-Auth-Key {api_key.strip()}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            raise ValueError("invalid_api_key")
        if exc.code == 456:
            raise ValueError("quota_exceeded")
        raise ValueError("deepl_error")
    except urllib.error.URLError:
        raise ValueError("deepl_unreachable")
    translations = body.get("translations") or []
    if not translations:
        raise ValueError("deepl_error")
    first = translations[0]
    return first.get("text", ""), first.get("detected_source_language")


def call_deepl_usage(api_key: str):
    """Fetches the caller's own DeepL usage (character_count/character_limit)
    from DeepL's /v2/usage endpoint. Returns a dict or raises ValueError with
    a short machine-readable reason, same convention as call_deepl()."""
    base = "https://api-free.deepl.com" if api_key.strip().endswith(":fx") else "https://api.deepl.com"
    req = urllib.request.Request(
        f"{base}/v2/usage",
        headers={"Authorization": f"DeepL-Auth-Key {api_key.strip()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 403:
            raise ValueError("invalid_api_key")
        raise ValueError("deepl_error")
    except urllib.error.URLError:
        raise ValueError("deepl_unreachable")


def _record_history(user_id: str, source_lang: Optional[str], target_lang: str, source_text: str, translated_text: str):
    with _conn() as conn:
        conn.execute(
            "INSERT INTO history(user_id,source_lang,target_lang,source_text,translated_text) VALUES(?,?,?,?,?)",
            (user_id, source_lang, target_lang, source_text, translated_text),
        )
        conn.execute(
            "DELETE FROM history WHERE user_id=? AND id NOT IN "
            "(SELECT id FROM history WHERE user_id=? ORDER BY created_at DESC LIMIT ?)",
            (user_id, user_id, _MAX_HISTORY),
        )
        conn.commit()


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
        return hub.private_page("DeepL Translator", "🌐")
    with open(os.path.join(_PUBLIC_DIR, "index.html")) as file:
        html = file.read().replace("__APP_VERSION__", _asset_version())
    return HTMLResponse(html)


@router.get("/settings")
async def get_settings(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    key = get_key(me["id"])
    return {"has_api_key": bool(key)}


@router.put("/settings")
async def put_settings(data: SettingsIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    api_key = data.api_key.strip()
    if not api_key or len(api_key) > 200:
        return JSONResponse({"error": "invalid_api_key"}, status_code=400)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO user_keys(user_id,api_key,updated_at) VALUES(?,?,strftime('%s','now')) "
            "ON CONFLICT(user_id) DO UPDATE SET api_key=excluded.api_key, updated_at=excluded.updated_at",
            (me["id"], api_key),
        )
        conn.commit()
    return {"ok": True}


@router.delete("/settings")
async def delete_settings(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        conn.execute("DELETE FROM user_keys WHERE user_id=?", (me["id"],))
        conn.commit()
    return {"ok": True}


@router.get("/usage")
async def usage(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    api_key = get_key(me["id"])
    if not api_key:
        return JSONResponse({"error": "api_key_missing"}, status_code=400)
    try:
        data = call_deepl_usage(api_key)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    return {
        "character_count": data.get("character_count", 0),
        "character_limit": data.get("character_limit", 0),
    }


@router.post("/translate")
async def translate(data: TranslateIn, x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    text = data.text.strip()
    if not text:
        return JSONResponse({"error": "empty_text"}, status_code=400)
    if len(text) > _MAX_TEXT_LEN:
        return JSONResponse({"error": "text_too_long"}, status_code=400)
    api_key = get_key(me["id"])
    if not api_key:
        return JSONResponse({"error": "api_key_missing"}, status_code=400)
    try:
        translated, detected_source = call_deepl(api_key, text, data.target_lang, data.source_lang)
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)
    source_lang = data.source_lang or detected_source
    _record_history(me["id"], source_lang, data.target_lang.upper(), text, translated)
    return {"translated_text": translated, "source_lang": source_lang, "target_lang": data.target_lang.upper()}


@router.get("/history")
async def history(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id,source_lang,target_lang,source_text,translated_text,created_at FROM history "
            "WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (me["id"], _MAX_HISTORY),
        ).fetchall()
    return {"history": [dict(row) for row in rows]}


@router.delete("/history")
async def clear_history(x_pub_token: str = Header(default=None)):
    me = _user(x_pub_token)
    if not me:
        return _private_response()
    with _conn() as conn:
        conn.execute("DELETE FROM history WHERE user_id=?", (me["id"],))
        conn.commit()
    return {"ok": True}
