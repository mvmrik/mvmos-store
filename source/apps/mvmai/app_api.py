"""App API bridge: lets another app's server code put one question to the AI
that mvmAI uses for its public page, without opening a chat.

Nothing is stored and no tools are offered; the answer is plain text. The
administrator switches this on under Apps Hub, like every app API."""

import asyncio
import concurrent.futures
import contextvars
import sys

INTERNAL_ONLY = {"ask", "image", "image_status"}


def ask(user_id: str, prompt: str, lang: str = None, timeout: int = 60, max_chars: int = 20000):
    """Ask the public-page AI one question on behalf of an Apps Hub user.

    max_chars is how much of the prompt is used (20000 by default, at most
    200000): an app that sends a whole chapter asks for more.

    Returns {"text": "..."} or {"error": "..."} (unknown_user, empty_prompt,
    mvmai_unavailable, timeout, or the provider's own message).
    """
    api = sys.modules.get("app_public_mvmai")
    if api is None:
        return {"error": "mvmai_unavailable"}

    def run():
        return asyncio.run(asyncio.wait_for(api.ask_once(user_id, prompt, lang, max_chars), timeout))

    # Always in a worker thread: the caller may already be inside an event loop.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            return pool.submit(contextvars.copy_context().run, run).result(timeout + 5)
        except (asyncio.TimeoutError, concurrent.futures.TimeoutError):
            return {"error": "timeout"}
        except Exception as exc:
            return {"error": str(exc) or "mvmai_failed"}


def image_status():
    """Whether mvmAI can make a picture right now: {"available": bool}.

    Which generator does it (an image API with a key mvmAI holds, or Codex) is
    mvmAI's business; the asker only learns whether one is ready."""
    desk = sys.modules.get("app_backend_mvmai")
    if desk is None:
        return {"available": False}
    try:
        return {"available": bool(desk.image_status().get("available"))}
    except Exception:
        return {"available": False}


def image(user_id: str, prompt: str, aspect: str = "portrait", timeout: int = 240):
    """Make one picture on behalf of an Apps Hub user.

    aspect is "portrait", "landscape" or "square". Returns {"data": base64,
    "mime": "image/png", "backend": id} or {"error": "..."}: unknown_user,
    empty_prompt, mvmai_unavailable, image_unavailable (no generator is ready),
    image_timeout, image_refused (the generator declined the description) or
    image_failed. Nothing is stored and no chat credits are charged here; the
    asker decides what a picture costs."""
    api = sys.modules.get("app_public_mvmai")
    desk = sys.modules.get("app_backend_mvmai")
    if api is None or desk is None:
        return {"error": "mvmai_unavailable"}
    hub = api._hub()
    try:
        if not hub or not hub.get_users_by_ids([user_id]):
            return {"error": "unknown_user"}
    except Exception:
        return {"error": "unknown_user"}
    prompt = str(prompt or "").strip()
    if not prompt:
        return {"error": "empty_prompt"}
    try:
        timeout = max(30, min(600, int(timeout)))
    except (TypeError, ValueError):
        timeout = 240

    def run():
        try:
            return desk.generate_image(prompt, aspect, timeout)
        except Exception as exc:
            return {"error": getattr(exc, "code", None) or str(exc) or "image_failed"}

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            return pool.submit(contextvars.copy_context().run, run).result(timeout + 15)
        except concurrent.futures.TimeoutError:
            return {"error": "image_timeout"}
