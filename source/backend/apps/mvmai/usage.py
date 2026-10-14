"""Read subscription usage for the Linux account running an mvmAI CLI provider.

Claude's OAuth usage endpoint is not a public API. Keep failures silent and
cache successful reads so opening chats does not repeatedly poll the service.
"""

import json
import math
import os
import select
import subprocess
import time
import urllib.request
from datetime import datetime


_CACHE = {}
_CACHE_SECONDS = 60


def _window(percent, reset):
    try:
        percent = float(percent)
        if not math.isfinite(percent):
            return None
        if isinstance(reset, str):
            reset = datetime.fromisoformat(reset.replace("Z", "+00:00")).timestamp()
        reset = int(reset) if reset is not None else None
        return {"used_percent": max(0, min(100, round(percent))), "resets_at": reset}
    except (TypeError, ValueError, OverflowError):
        return None


def _claude_usage(home):
    try:
        with open(os.path.join(home, ".claude", ".credentials.json"), encoding="utf-8") as file:
            token = json.load(file)["claudeAiOauth"]["accessToken"]
        req = urllib.request.Request(
            "https://api.anthropic.com/api/oauth/usage",
            headers={"Authorization": "Bearer " + token, "anthropic-beta": "oauth-2025-04-20",
                     "Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.load(response)
        def get(name):
            item = data.get(name) or {}
            return _window(item.get("utilization"), item.get("resets_at"))
        return {"five_hour": get("five_hour"), "week": get("seven_day")}
    except (OSError, ValueError, KeyError):
        return None


def _codex_usage(desk, cmd_bin, user, home):
    env = {**os.environ, "HOME": home, "USER": user, "LOGNAME": user,
           "PATH": desk._cli_search_path(home)}
    proc = None
    try:
        proc = subprocess.Popen(
            desk._wrap_as_user([cmd_bin, "app-server"], user),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, text=False,
        )
        def send(value):
            proc.stdin.write((json.dumps(value) + "\n").encode())
            proc.stdin.flush()
        def receive(wanted, seconds):
            end = time.monotonic() + seconds
            pending = b""
            while time.monotonic() < end:
                ready, _, _ = select.select([proc.stdout], [], [], max(0, end - time.monotonic()))
                if not ready:
                    break
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    try:
                        message = json.loads(line)
                    except ValueError:
                        continue
                    if message.get("id") == wanted:
                        return message.get("result")
            return None
        send({"id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "mvmai", "version": "1.0"}}})
        if not receive(1, 5):
            return None
        send({"method": "initialized", "params": {}})
        send({"id": 2, "method": "account/rateLimits/read", "params": {
            "excludeResetCreditDetails": True}})
        data = receive(2, 10) or {}
        limits = data.get("rateLimitsByLimitId") or {}
        limit = limits.get("codex") or data.get("rateLimits") or {}
        def get(name):
            item = limit.get(name) or {}
            return _window(item.get("usedPercent"), item.get("resetsAt"))
        return {"five_hour": get("primary"), "week": get("secondary")}
    except (OSError, ValueError, BrokenPipeError):
        return None
    finally:
        if proc is not None:
            if proc.poll() is None:
                try:
                    proc.terminate()
                except ProcessLookupError:
                    pass
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


def _gemini_family(model_id):
    name = model_id.lower()
    if "flash-lite" in name:
        return "Flash Lite"
    if "flash" in name:
        return "Flash"
    if "pro" in name:
        return "Pro"
    return model_id[:40]


def _gemini_windows(buckets, model):
    """Match the active model and use the most exhausted bucket per family."""
    model = (model or "").strip().lower()
    if model and model not in ("auto", "default"):
        exact = [b for b in buckets if b.get("model_id", "").lower() == model]
        if exact:
            buckets = exact
        else:
            family = _gemini_family(model)
            buckets = [b for b in buckets if _gemini_family(b.get("model_id", "")) == family]
    grouped = {}
    for bucket in buckets:
        try:
            remaining = float(bucket["remaining_fraction"])
            if not 0 <= remaining <= 1:
                continue
            label = _gemini_family(bucket["model_id"])
            current = grouped.get(label)
            if current is None or remaining < current[0]:
                grouped[label] = (remaining, bucket.get("reset_time"))
        except (KeyError, TypeError, ValueError):
            continue
    windows = []
    for label, (remaining, reset) in grouped.items():
        window = _window((1 - remaining) * 100, reset)
        if window:
            windows.append({"model_label": label, **window})
    return windows[:3]


def _gemini_usage(desk, cmd_bin, user, home, model):
    helper = os.path.join(os.path.dirname(__file__), "gemini_usage.mjs")
    env = {**os.environ, "HOME": home, "USER": user, "LOGNAME": user,
           "PATH": desk._cli_search_path(home)}
    try:
        proc = subprocess.run(
            desk._wrap_as_user(["node", helper, cmd_bin], user),
            capture_output=True, text=True, timeout=18, env=env,
        )
        line = next((line for line in proc.stdout.splitlines()
                     if line.startswith("MVMAI_USAGE_JSON:")), None)
        if line is None:
            return None
        result = json.loads(line.removeprefix("MVMAI_USAGE_JSON:"))
        if result.get("unmetered"):
            return {"hide": True}
        if not isinstance(result.get("buckets"), list):
            return None
        if not model:
            try:
                with open(os.path.join(home, ".gemini", "settings.json"), encoding="utf-8") as file:
                    model = (json.load(file).get("model") or {}).get("name") or ""
            except (OSError, ValueError):
                pass
        return {"models": _gemini_windows(result["buckets"], model)}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def read_usage(desk, provider, user, home, cmd_bin, force=False, model=""):
    key = (provider, user, model)
    cached = _CACHE.get(key)
    if not force and cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    data = (_claude_usage(home) if provider == "claude-cli" else
            _codex_usage(desk, cmd_bin, user, home) if provider == "codex-cli" else
            _gemini_usage(desk, cmd_bin, user, home, model) if provider == "gemini-cli" else None)
    if data and (data.get("hide") or data.get("models") or data.get("five_hour") or data.get("week")):
        _CACHE[key] = (time.monotonic(), data)
        return data
    return None
