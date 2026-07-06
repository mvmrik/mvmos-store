"""
Telegram adapter for mvmOS Chat — detected by Telegram Hub because this
file exists next to public.py. Chat is a full Telegram Mini App: this
adapter only has to hand back a button that opens it, since the Mini App
page (apps/chat/public/telegram.html) reuses the existing ChatWidget and
REST/WebSocket endpoints in backend/apps/chat/public.py directly.

Contract expected by Telegram Hub (backend/apps/telegramhub/backend.py):
  APP_NAME, APP_ICON
  render_menu(user) -> TgView

TgView = {"text": str, "buttons": [[{"text","web_app"}, ...], ...]}
"""

import sys

APP_NAME = "Chat"
APP_ICON = "💬"


def _telegramhub():
    return sys.modules.get("app_backend_telegramhub")


def render_menu(user: dict) -> dict:
    tg = _telegramhub()
    base = tg.get_public_base_url() if tg else None
    url = f"{(base or '').rstrip('/')}/pub/chat/telegram"
    return {
        "text": "💬 <b>Chat</b>\n\nTap below to open your conversations.",
        "buttons": [[{"text": "💬 Open Chat", "web_app": url}]],
    }
