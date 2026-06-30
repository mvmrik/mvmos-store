import os
import sys
import sqlite3
import json
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/rssfeed")

_DB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "rssfeed", "data.db"
)


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def _init_db():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS cfg (
                key   TEXT PRIMARY KEY,
                value TEXT
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS feeds (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                url          TEXT    UNIQUE NOT NULL,
                name         TEXT    NOT NULL,
                created_at   TEXT    DEFAULT (datetime('now')),
                last_fetched TEXT,
                error        TEXT
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS articles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id    INTEGER NOT NULL,
                title      TEXT,
                link       TEXT,
                description TEXT,
                pub_date   TEXT,
                guid       TEXT,
                fetched_at TEXT DEFAULT (datetime('now')),
                is_read    INTEGER DEFAULT 0,
                UNIQUE(feed_id, guid)
            )""")
        c.execute("INSERT OR IGNORE INTO cfg (key,value) VALUES ('fetch_interval','30')")
        c.execute("INSERT OR IGNORE INTO cfg (key,value) VALUES ('public_enabled','0')")
        try:
            c.execute("ALTER TABLE articles ADD COLUMN is_saved INTEGER DEFAULT 0")
        except Exception:
            pass
        c.execute("""
            CREATE TABLE IF NOT EXISTS user_feeds (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                url            TEXT NOT NULL,
                name           TEXT NOT NULL,
                created_at     TEXT DEFAULT (datetime('now')),
                last_fetched   TEXT,
                error          TEXT,
                UNIQUE(public_user_id, url)
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS user_articles (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_feed_id INTEGER NOT NULL REFERENCES user_feeds(id) ON DELETE CASCADE,
                title        TEXT,
                link         TEXT,
                description  TEXT,
                pub_date     TEXT,
                guid         TEXT,
                fetched_at   TEXT DEFAULT (datetime('now')),
                is_read      INTEGER DEFAULT 0,
                is_saved     INTEGER DEFAULT 0,
                UNIQUE(user_feed_id, guid)
            )""")
        c.commit()


_init_db()


def _pub_user(x_pub_token):
    hub = sys.modules.get("backend.apphub")
    if not hub or not x_pub_token:
        return None
    return hub.get_pub_session(x_pub_token)


def _do_fetch_user_feed(user_feed_id, url):
    _, articles = _fetch_and_parse(url)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    c = _conn()
    try:
        inserted = 0
        for a in articles:
            guid = a["guid"] or a["link"]
            if not guid:
                continue
            try:
                cur = c.execute(
                    "INSERT OR IGNORE INTO user_articles "
                    "(user_feed_id, title, link, description, pub_date, guid) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_feed_id, a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
                if cur.lastrowid:
                    inserted += 1
            except Exception:
                pass
        c.execute("UPDATE user_feeds SET last_fetched=?, error=NULL WHERE id=?", (now, user_feed_id))
        c.commit()
    finally:
        c.close()
    return inserted


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
    req = urllib.request.Request(
        url, headers={"User-Agent": "mvmOS RSS Reader/1.0"}
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()

    root = ET.fromstring(data)
    ATOM = "http://www.w3.org/2005/Atom"

    # RSS 2.0
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

    # Atom
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


def _do_fetch_feed(feed_id, url):
    _, articles = _fetch_and_parse(url)
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    c = _conn()
    try:
        inserted = 0
        for a in articles:
            guid = a["guid"] or a["link"]
            if not guid:
                continue
            try:
                cur = c.execute(
                    "INSERT OR IGNORE INTO articles "
                    "(feed_id, title, link, description, pub_date, guid) "
                    "VALUES (?,?,?,?,?,?)",
                    (feed_id, a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
                if cur.lastrowid:
                    inserted += 1
            except Exception:
                pass
        c.execute("UPDATE feeds SET last_fetched=?, error=NULL WHERE id=?", (now, feed_id))
        c.commit()
    finally:
        c.close()
    return inserted


# ── Feeds ─────────────────────────────────────────────────────────────────────

@router.get("/feeds")
async def get_feeds(session=Depends(get_current_session)):
    c = _conn()
    try:
        rows   = c.execute("SELECT * FROM feeds ORDER BY name").fetchall()
        counts = {
            r["feed_id"]: r["cnt"]
            for r in c.execute(
                "SELECT feed_id, COUNT(*) cnt FROM articles WHERE is_read=0 GROUP BY feed_id"
            ).fetchall()
        }
    finally:
        c.close()
    result = []
    for r in rows:
        d = dict(r)
        d["unread_count"] = counts.get(r["id"], 0)
        result.append(d)
    return JSONResponse(result)


class AddFeedBody(BaseModel):
    url: str


@router.post("/feeds")
async def add_feed(body: AddFeedBody, session=Depends(get_current_session)):
    url = body.url.strip()
    if not url:
        return JSONResponse({"error": "URL required"}, status_code=400)
    try:
        name, articles = _fetch_and_parse(url)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    c = _conn()
    try:
        try:
            cur = c.execute(
                "INSERT INTO feeds (url, name, last_fetched) VALUES (?,?,?)",
                (url, name, now),
            )
            feed_id = cur.lastrowid
        except sqlite3.IntegrityError:
            c.close()
            return JSONResponse({"error": "Feed already exists"}, status_code=409)
        for a in articles:
            guid = a["guid"] or a["link"]
            if not guid:
                continue
            try:
                c.execute(
                    "INSERT OR IGNORE INTO articles "
                    "(feed_id, title, link, description, pub_date, guid) "
                    "VALUES (?,?,?,?,?,?)",
                    (feed_id, a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
            except Exception:
                pass
        c.commit()
    finally:
        c.close()
    return JSONResponse({"ok": True, "name": name, "feed_id": feed_id})


@router.delete("/feeds/{feed_id}")
async def delete_feed(feed_id: int, session=Depends(get_current_session)):
    with _conn() as c:
        c.execute("DELETE FROM articles WHERE feed_id=?", (feed_id,))
        c.execute("DELETE FROM feeds WHERE id=?", (feed_id,))
        c.commit()
    return JSONResponse({"ok": True})


# ── Articles ──────────────────────────────────────────────────────────────────

@router.get("/articles")
async def get_articles(
    feed_id:  int = Query(0),
    is_read:  int = Query(-1),
    is_saved: int = Query(-1),
    limit:    int = Query(100),
    offset:   int = Query(0),
    session=Depends(get_current_session),
):
    parts = ["SELECT a.*, f.name as feed_name FROM articles a JOIN feeds f ON f.id=a.feed_id"]
    conds = []
    params = []
    if feed_id:
        conds.append("a.feed_id=?")
        params.append(feed_id)
    if is_saved >= 0:
        conds.append("a.is_saved=?")
        params.append(is_saved)
    elif is_read >= 0:
        conds.append("a.is_read=?")
        params.append(is_read)
    if conds:
        parts.append("WHERE " + " AND ".join(conds))
    parts.append("ORDER BY COALESCE(a.pub_date, a.fetched_at) DESC LIMIT ? OFFSET ?")
    params += [limit, offset]
    with _conn() as c:
        rows = c.execute(" ".join(parts), params).fetchall()
    return JSONResponse([dict(r) for r in rows])


@router.post("/articles/{article_id}/read")
async def mark_read(article_id: int, session=Depends(get_current_session)):
    with _conn() as c:
        c.execute("UPDATE articles SET is_read=1 WHERE id=?", (article_id,))
        c.commit()
    return JSONResponse({"ok": True})


@router.post("/articles/{article_id}/save")
async def toggle_save(article_id: int, session=Depends(get_current_session)):
    with _conn() as c:
        c.execute("UPDATE articles SET is_saved = 1 - is_saved WHERE id=?", (article_id,))
        c.commit()
        row = c.execute("SELECT is_saved FROM articles WHERE id=?", (article_id,)).fetchone()
    return JSONResponse({"ok": True, "is_saved": row["is_saved"] if row else 0})


class ReadAllBody(BaseModel):
    feed_id: int = 0


@router.post("/articles/read-all")
async def mark_all_read(body: ReadAllBody, session=Depends(get_current_session)):
    with _conn() as c:
        if body.feed_id:
            c.execute("UPDATE articles SET is_read=1 WHERE feed_id=?", (body.feed_id,))
        else:
            c.execute("UPDATE articles SET is_read=1")
        c.commit()
    return JSONResponse({"ok": True})


# ── Manual fetch ──────────────────────────────────────────────────────────────

@router.post("/fetch")
async def fetch_now(session=Depends(get_current_session)):
    with _conn() as c:
        feeds = c.execute("SELECT id, url FROM feeds").fetchall()
    results = []
    for feed in feeds:
        try:
            n = _do_fetch_feed(feed["id"], feed["url"])
            results.append({"feed_id": feed["id"], "new": n})
        except Exception as e:
            with _conn() as c:
                c.execute("UPDATE feeds SET error=? WHERE id=?", (str(e), feed["id"]))
                c.commit()
            results.append({"feed_id": feed["id"], "error": str(e)})
    return JSONResponse({"ok": True, "results": results})


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(session=Depends(get_current_session)):
    with _conn() as c:
        rows = c.execute("SELECT key, value FROM cfg").fetchall()
    return JSONResponse({r["key"]: r["value"] for r in rows})


class SettingsBody(BaseModel):
    fetch_interval: str = "30"
    public_enabled: str = "0"
    ai_source:      str = "off"
    ai_buttons:     str = "[]"


@router.post("/settings")
async def save_settings(body: SettingsBody, session=Depends(get_current_session)):
    with _conn() as c:
        c.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('fetch_interval',?)", (body.fetch_interval,))
        c.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('public_enabled',?)", (body.public_enabled,))
        c.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('ai_source',?)",      (body.ai_source,))
        c.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('ai_buttons',?)",     (body.ai_buttons,))
        c.commit()
    return JSONResponse({"ok": True})


# ── Per-user feeds (apphub identity, requires mvmOS session + X-Pub-Token) ────

from fastapi import Header as _Header
from typing import Optional as _Opt


@router.get("/user/feeds")
async def user_get_feeds(session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
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


@router.post("/user/feeds")
async def user_add_feed(body: AddFeedBody, session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
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


@router.delete("/user/feeds/{feed_id}")
async def user_delete_feed(feed_id: int, session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        c.execute("DELETE FROM user_feeds WHERE id=? AND public_user_id=?", (feed_id, u["id"]))
        c.commit()
    return JSONResponse({"ok": True})


@router.get("/user/articles")
async def user_get_articles(
    feed_id:  int = Query(0),
    is_read:  int = Query(-1),
    is_saved: int = Query(-1),
    limit:    int = Query(100),
    offset:   int = Query(0),
    session=Depends(get_current_session),
    x_pub_token: _Opt[str] = _Header(default=None),
):
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


@router.post("/user/articles/{article_id}/read")
async def user_mark_read(article_id: int, session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
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


@router.post("/user/articles/{article_id}/save")
async def user_toggle_save(article_id: int, session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
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


@router.post("/user/articles/read-all")
async def user_mark_all_read(body: ReadAllBody, session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
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


@router.post("/user/fetch")
async def user_fetch_feeds(session=Depends(get_current_session), x_pub_token: _Opt[str] = _Header(default=None)):
    u = _pub_user(x_pub_token)
    if not u:
        return JSONResponse({"error": "login_required"}, status_code=401)
    with _conn() as c:
        feeds = c.execute("SELECT id, url FROM user_feeds WHERE public_user_id=?", (u["id"],)).fetchall()
    results = []
    for f in feeds:
        try:
            n = _do_fetch_user_feed(f["id"], f["url"])
            results.append({"feed_id": f["id"], "new": n})
        except Exception as e:
            with _conn() as c:
                c.execute("UPDATE user_feeds SET error=? WHERE id=?", (str(e), f["id"]))
                c.commit()
            results.append({"feed_id": f["id"], "error": str(e)})
    return JSONResponse({"ok": True, "results": results})
