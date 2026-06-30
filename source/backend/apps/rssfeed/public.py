"""
RSS Reader public page — per-user, authenticated via apphub token.

Pattern for public apps:
1. Create this file (public.py) in backend/apps/<app_id>/
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

_DB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "rssfeed", "data.db"
)

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
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>RSS Reader</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">RSS Reader is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""")


def _parse_date(s):
    if not s:
        return ""
    s = s.strip()
    try:
        dt = parsedate_to_datetime(s)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        pass
    return s


def _fetch_and_parse(url):
    req = urllib.request.Request(url, headers={"User-Agent": "mvmOS RSS Reader/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()
    root = ET.fromstring(data)
    ATOM = "http://www.w3.org/2005/Atom"
    channel = root.find("channel")
    if channel is not None:
        name = (channel.findtext("title") or url).strip()
        articles = []
        for item in channel.findall("item"):
            link = (item.findtext("link") or "").strip()
            guid = (item.findtext("guid") or link).strip()
            articles.append({
                "title":       (item.findtext("title") or "").strip(),
                "link":        link,
                "description": (item.findtext("description") or "").strip(),
                "pub_date":    _parse_date(item.findtext("pubDate") or ""),
                "guid":        guid,
            })
        return name, articles
    title_el = root.find(f"{{{ATOM}}}title")
    name = (title_el.text if title_el is not None else url).strip()
    articles = []
    for entry in root.findall(f"{{{ATOM}}}entry"):
        link_el = entry.find(f"{{{ATOM}}}link")
        link = link_el.get("href", "") if link_el is not None else ""
        guid = (entry.findtext(f"{{{ATOM}}}id") or link).strip()
        content = (
            entry.findtext(f"{{{ATOM}}}content")
            or entry.findtext(f"{{{ATOM}}}summary")
            or ""
        ).strip()
        updated = (
            entry.findtext(f"{{{ATOM}}}updated")
            or entry.findtext(f"{{{ATOM}}}published")
            or ""
        )
        articles.append({
            "title":       (entry.findtext(f"{{{ATOM}}}title") or "").strip(),
            "link":        link,
            "description": content,
            "pub_date":    _parse_date(updated),
            "guid":        guid,
        })
    return name, articles


# ── Routes ────────────────────────────────────────────────────────

@router.get("/")
async def index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
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
