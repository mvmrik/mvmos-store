"""RSS/Atom fetching shared by desktop and public readers."""

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
