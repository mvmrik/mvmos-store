"""App API bridge: lets another app's server code put one question to the AI
that mvmAI uses for its public page, without opening a chat.

Nothing is stored and no tools are offered; the answer is plain text. The
administrator switches this on under Apps Hub, like every app API."""

import asyncio
import concurrent.futures
import contextvars
import sys

INTERNAL_ONLY = {"ask"}


def ask(user_id: str, prompt: str, lang: str = None, timeout: int = 60):
    """Ask the public-page AI one question on behalf of an Apps Hub user.

    Returns {"text": "..."} or {"error": "..."} (unknown_user, empty_prompt,
    mvmai_unavailable, timeout, or the provider's own message).
    """
    api = sys.modules.get("app_public_mvmai")
    if api is None:
        return {"error": "mvmai_unavailable"}

    def run():
        return asyncio.run(asyncio.wait_for(api.ask_once(user_id, prompt, lang), timeout))

    # Always in a worker thread: the caller may already be inside an event loop.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        try:
            return pool.submit(contextvars.copy_context().run, run).result(timeout + 5)
        except (asyncio.TimeoutError, concurrent.futures.TimeoutError):
            return {"error": "timeout"}
        except Exception as exc:
            return {"error": str(exc) or "mvmai_failed"}
