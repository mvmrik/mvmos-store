"""
RSS Reader public page — per-user, authenticated via apphub token.

Pattern for public apps:
1. Create this file (api.py) in apps/<app_id>/
2. Call hub.is_app_public(APP_ID) to check if admin enabled it
3. HTML page handles auth client-side (redirects to /pub/apphub/?next=...)
4. API endpoints validate X-Pub-Token via hub.get_pub_session()
5. Apps Hub admin will auto-detect this file and show a toggle for it
"""

import os
import sys
import sqlite3
import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter(tags=["rssfeed-public"])

APP_ID = "rssfeed"

_DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")

_DIR = os.path.join(os.path.dirname(__file__), "public")


def _hub():
    return sys.modules.get("backend.apphub")


def _pub_user(token: Optional[str]):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("PRAGMA foreign_keys=ON")
    return c


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
    with _conn() as c:
        row = c.execute("SELECT value FROM cfg WHERE key='deepl_enabled'").fetchone()
    if not (row and row["value"] == "1"):
        return False
    prem = _premium()
    return bool(prem and prem.is_available())


@router.post("/translate")
async def translate(data: TranslateIn, x_pub_token: str = Header(default=None)):
    """Translate one article. The whole of this feature lives in the premium
    module; this route only carries the request to it and the answer back.

    An unlicensed installation has no premium module, so there is nothing to
    carry the request to and the endpoint reports itself as not found. That is
    the honest answer: on this installation the feature does not exist.
    """
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    me = _pub_user(x_pub_token)
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
        return hub.private_page("RSS Reader", "📰")
    return FileResponse(os.path.join(_DIR, "index.html"))


@router.get("/feeds")
async def get_feeds(x_pub_token: Optional[str] = Header(default=None)):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        rows = c.execute(
            "SELECT f.*, COUNT(CASE WHEN a.is_read=0 THEN 1 END) as unread_count "
            "FROM user_feeds f LEFT JOIN user_articles a ON a.user_feed_id=f.id "
            "WHERE f.public_user_id=? GROUP BY f.id ORDER BY f.name",
            (u["id"],)
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class AddFeedBody(BaseModel):
    url: str


@router.post("/feeds")
async def add_feed(body: AddFeedBody, x_pub_token: Optional[str] = Header(default=None)):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    url = body.url.strip()
    if not url:
        return JSONResponse({"error": "URL required"}, status_code=400)
    try:
        name, articles = _fetch_and_parse(url)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with _conn() as c:
        try:
            cur = c.execute(
                "INSERT INTO user_feeds (public_user_id, url, name, last_fetched) VALUES (?,?,?,?)",
                (u["id"], url, name, now),
            )
            feed_id = cur.lastrowid
        except sqlite3.IntegrityError:
            return JSONResponse({"error": "Feed already added"}, status_code=409)
        for a in articles:
            guid = a["guid"] or a["link"]
            if not guid:
                continue
            try:
                c.execute(
                    "INSERT OR IGNORE INTO user_articles (user_feed_id, title, link, description, pub_date, guid) VALUES (?,?,?,?,?,?)",
                    (feed_id, a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
            except Exception:
                pass
        c.commit()
    return JSONResponse({"ok": True, "name": name, "feed_id": feed_id})


@router.delete("/feeds/{feed_id}")
async def delete_feed(feed_id: int, x_pub_token: Optional[str] = Header(default=None)):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        c.execute("DELETE FROM user_feeds WHERE id=? AND public_user_id=?", (feed_id, u["id"]))
        c.commit()
    return JSONResponse({"ok": True})


@router.get("/articles")
async def get_articles(
    feed_id:  int = 0,
    is_read:  int = -1,
    is_saved: int = -1,
    limit:    int = 100,
    offset:   int = 0,
    x_pub_token: Optional[str] = Header(default=None),
):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return JSONResponse({"error": "private"}, status_code=403)
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    parts = [
        "SELECT a.*, f.name as feed_name FROM user_articles a "
        "JOIN user_feeds f ON f.id=a.user_feed_id WHERE f.public_user_id=?"
    ]
    params = [u["id"]]
    if feed_id:
        parts.append("AND a.user_feed_id=?")
        params.append(feed_id)
    if is_saved >= 0:
        parts.append("AND a.is_saved=?")
        params.append(is_saved)
    elif is_read >= 0:
        parts.append("AND a.is_read=?")
        params.append(is_read)
    parts.append("ORDER BY COALESCE(a.pub_date, a.fetched_at) DESC LIMIT ? OFFSET ?")
    params += [limit, offset]
    with _conn() as c:
        rows = c.execute(" ".join(parts), params).fetchall()
    return JSONResponse([dict(r) for r in rows])


class ReadAllBody(BaseModel):
    feed_id: int = 0


@router.post("/articles/read-all")
async def mark_all_read(body: ReadAllBody, x_pub_token: Optional[str] = Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        if body.feed_id:
            c.execute(
                "UPDATE user_articles SET is_read=1 WHERE user_feed_id=? AND user_feed_id IN (SELECT id FROM user_feeds WHERE public_user_id=?)",
                (body.feed_id, u["id"])
            )
        else:
            c.execute(
                "UPDATE user_articles SET is_read=1 WHERE user_feed_id IN (SELECT id FROM user_feeds WHERE public_user_id=?)",
                (u["id"],)
            )
        c.commit()
    return JSONResponse({"ok": True})


@router.post("/articles/{article_id}/read")
async def mark_read(article_id: int, x_pub_token: Optional[str] = Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        c.execute(
            "UPDATE user_articles SET is_read=1 WHERE id=? AND user_feed_id IN (SELECT id FROM user_feeds WHERE public_user_id=?)",
            (article_id, u["id"])
        )
        c.commit()
    return JSONResponse({"ok": True})


@router.post("/articles/{article_id}/save")
async def toggle_save(article_id: int, x_pub_token: Optional[str] = Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        c.execute(
            "UPDATE user_articles SET is_saved = 1 - is_saved WHERE id=? AND user_feed_id IN (SELECT id FROM user_feeds WHERE public_user_id=?)",
            (article_id, u["id"])
        )
        c.commit()
        row = c.execute("SELECT is_saved FROM user_articles WHERE id=?", (article_id,)).fetchone()
    return JSONResponse({"ok": True, "is_saved": row["is_saved"] if row else 0})
