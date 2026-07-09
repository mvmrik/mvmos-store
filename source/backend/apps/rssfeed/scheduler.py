"""
RSS Reader scheduler — called every minute by /api/scheduler/tick.
Fetches feeds based on fetch_interval setting (minutes).
"""
import sqlite3
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime


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


def _fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": "mvmOS RSS Reader/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read()
    root = ET.fromstring(data)
    ATOM = "http://www.w3.org/2005/Atom"
    articles = []
    channel = root.find("channel")
    if channel is not None:
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
        return articles
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
    return articles


def run(now, db_path, config):
    import os
    if not db_path or not os.path.isfile(db_path):
        return

    interval = int(config.get("fetch_interval", 30))
    last_run = config.get("last_fetch_time", "")

    if last_run:
        try:
            last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00")).replace(tzinfo=None)
            elapsed = (now - last_dt).total_seconds()
            if elapsed < interval * 60:
                return
        except Exception:
            pass

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    feeds = conn.execute("SELECT id, url FROM feeds").fetchall()
    for feed in feeds:
        try:
            articles = _fetch_feed(feed["url"])
            for a in articles:
                guid = a["guid"] or a["link"]
                if not guid:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO articles "
                    "(feed_id, title, link, description, pub_date, guid) "
                    "VALUES (?,?,?,?,?,?)",
                    (feed["id"], a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
            conn.execute("UPDATE feeds SET last_fetched=?, error=NULL WHERE id=?", (ts, feed["id"]))
        except Exception as e:
            conn.execute("UPDATE feeds SET error=? WHERE id=?", (str(e), feed["id"]))

    # Apps Hub / public-profile feeds — same fetch, separate per-user tables,
    # so every user's own feed list (not just the token-less legacy one above)
    # gets picked up automatically by this same minute-tick instead of only
    # refreshing when that user happens to open the app.
    user_feeds = conn.execute("SELECT id, url FROM user_feeds").fetchall()
    for feed in user_feeds:
        try:
            articles = _fetch_feed(feed["url"])
            for a in articles:
                guid = a["guid"] or a["link"]
                if not guid:
                    continue
                conn.execute(
                    "INSERT OR IGNORE INTO user_articles "
                    "(user_feed_id, title, link, description, pub_date, guid) "
                    "VALUES (?,?,?,?,?,?)",
                    (feed["id"], a["title"], a["link"], a["description"], a["pub_date"], guid),
                )
            conn.execute("UPDATE user_feeds SET last_fetched=?, error=NULL WHERE id=?", (ts, feed["id"]))
        except Exception as e:
            conn.execute("UPDATE user_feeds SET error=? WHERE id=?", (str(e), feed["id"]))

    conn.execute("INSERT OR REPLACE INTO cfg (key,value) VALUES ('last_fetch_time',?)", (ts,))
    conn.commit()
    conn.close()
