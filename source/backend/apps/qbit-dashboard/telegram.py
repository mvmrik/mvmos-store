"""
Telegram adapter for qBit Dashboard — detected by Telegram Hub because this
file exists next to backend.py. No public.py/Mini App here on purpose: this
is meant to stay private, toggled admin_only from Telegram Hub's Apps tab so
only the mvmOS admin can see/use it from the bot.

Reuses the qBittorrent WebUI session/login machinery already implemented in
backend.py (sys.modules["app_backend_qbit-dashboard"]._get_client), and reads
host/port/username/password from the same cfg table the app's own frontend
settings panel writes to (apps/qbit-dashboard/data.db).

Contract expected by Telegram Hub (backend/apps/telegramhub/backend.py):
  APP_NAME, APP_ICON
  render_menu(user) -> Awaitable[TgView]   (async — does live network I/O)

TgView = {"text": str, "buttons": [[{"text","data"}, ...], ...]}
"""

import json
import os
import sqlite3
import sys

APP_NAME = "qBit Dashboard"
APP_ICON = "🌊"

_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "qbit-dashboard", "data.db")

_INFINITE_ETA = 8640000  # qBittorrent's sentinel for "no ETA" (seeding/paused/unknown)

_STATE_LABELS = {
    "downloading":  "⬇️ Downloading",
    "metaDL":       "⬇️ Fetching metadata",
    "forcedDL":     "⬇️ Downloading (forced)",
    "uploading":    "🌱 Seeding",
    "forcedUP":     "🌱 Seeding (forced)",
    "stalledUP":    "🌱 Seeding (idle)",
    "stalledDL":    "⏳ Stalled",
    "pausedDL":     "⏸️ Paused",
    "pausedUP":     "⏸️ Paused (done)",
    "queuedDL":     "🕒 Queued",
    "queuedUP":     "🕒 Queued (seed)",
    "checkingDL":   "🔎 Checking",
    "checkingUP":   "🔎 Checking",
    "checkingResumeData": "🔎 Checking",
    "error":        "❌ Error",
    "missingFiles": "❌ Missing files",
    "moving":       "📦 Moving",
}


def _qbit_backend():
    return sys.modules.get("app_backend_qbit-dashboard")


def _cfg() -> dict:
    out = {"host": "localhost", "port": 8080, "username": "admin", "password": ""}
    if not os.path.isfile(_DB_PATH):
        return out
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT key, value FROM cfg").fetchall()
    conn.close()
    for r in rows:
        try:
            out[r["key"]] = json.loads(r["value"])
        except (json.JSONDecodeError, TypeError):
            out[r["key"]] = r["value"]
    return out


def _esc(s) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_size(n) -> str:
    if not n or n < 0:
        return "—"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _fmt_speed(bps) -> str:
    if not bps or bps <= 0:
        return "—"
    return f"{_fmt_size(bps)}/s"


def _fmt_eta(sec) -> str:
    if not sec or sec <= 0 or sec >= _INFINITE_ETA:
        return "—"
    sec = int(sec)
    d, sec = divmod(sec, 86400)
    h, sec = divmod(sec, 3600)
    m, sec = divmod(sec, 60)
    if d:
        return f"{d}d {h}h"
    if h:
        return f"{h}h {m}m"
    if m:
        return f"{m}m {sec}s"
    return f"{sec}s"


def _sort_key(t: dict):
    eta = t.get("eta") or 0
    has_eta = 0 < eta < _INFINITE_ETA
    return (0 if has_eta else 1, eta if has_eta else 0)


_REFRESH_BUTTON = [{"text": "🔄 Refresh", "data": "__open__"}]


async def render_menu(user: dict) -> dict:
    be = _qbit_backend()
    if not be:
        return {"text": "⚠️ qBittorrent backend isn't loaded.", "buttons": []}

    cfg = _cfg()
    try:
        client = await be._get_client(cfg["host"], int(cfg["port"]), cfg.get("username", ""), cfg.get("password", ""))
        r = await client.get("/api/v2/torrents/info")
        torrents = r.json()
    except Exception as e:
        return {"text": f"⚠️ Could not reach qBittorrent:\n<code>{_esc(e)}</code>", "buttons": [_REFRESH_BUTTON]}

    if not torrents:
        return {"text": "🌊 <b>qBit Dashboard</b>\n\nNo torrents.", "buttons": [_REFRESH_BUTTON]}

    torrents.sort(key=_sort_key)

    lines = [f"🌊 <b>qBit Dashboard</b> — {len(torrents)} torrent(s)\n"]
    SHOWN = 20
    for t in torrents[:SHOWN]:
        pct = round((t.get("progress") or 0) * 100)
        state_label = _STATE_LABELS.get(t.get("state", ""), t.get("state", "?"))
        lines.append(
            f"<b>{_esc(t.get('name', '?'))}</b>\n"
            f"  {state_label} · {pct}%\n"
            f"  ⬇️ {_fmt_speed(t.get('dlspeed'))}  🌱 {t.get('num_seeds', 0)}/{t.get('num_complete', 0)}"
            f"  ⏱ {_fmt_eta(t.get('eta'))}"
        )
    if len(torrents) > SHOWN:
        lines.append(f"\n… and {len(torrents) - SHOWN} more.")

    return {"text": "\n\n".join(lines), "buttons": [_REFRESH_BUTTON]}
