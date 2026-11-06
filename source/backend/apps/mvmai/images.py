"""Pictures made for other apps: one question to mvmAI — "draw this" — and
whichever generator the installation has answers it.

An app never knows which one. mvmAI keeps a short list of generators and
uses the first that is ready, or the one the administrator chose with the
`image_backend` setting ("auto" by default, an id from the list, or "off"):

  codex-cli  Codex's built-in image tool, run as the account Codex is signed
             in with, in a folder made for the one picture
  openai     the OpenAI images API, with the key mvmAI already holds
  gemini     Google's Gemini image model, with the key mvmAI already holds

A new generator is one more entry in BACKENDS: a name, a way to say it is
ready and a function that returns the bytes.
"""

import base64
import json
import os
import pwd
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

SIZES = {"portrait": "1024x1536", "landscape": "1536x1024", "square": "1024x1024"}
ASPECT_WORDS = {"portrait": "portrait orientation, 2:3", "landscape": "landscape orientation, 3:2", "square": "square, 1:1"}
MAX_BYTES = 12 * 1024 * 1024


class ImageError(Exception):
    """code: image_unavailable, image_timeout, image_failed or image_refused."""

    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _sniff(data: bytes):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _post_json(url, body, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return json.load(res)
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = json.load(exc).get("error", {}).get("message", "")
        except Exception:
            pass
        raise ImageError("image_refused" if exc.code in (400, 403, 422) else "image_failed", detail or f"HTTP {exc.code}")
    except (TimeoutError, urllib.error.URLError, OSError) as exc:
        if "timed out" in str(exc):
            raise ImageError("image_timeout")
        raise ImageError("image_failed", str(exc)[:200])


def _key(cfg, pid):
    key = cfg.get(f"api_key_{pid}") or (cfg.get("api_key") if cfg.get("provider") == pid else "")
    return key if isinstance(key, str) and key.strip() else ""


# ── API generators ───────────────────────────────────────────────────────

def _openai_ready(desk, cfg):
    return bool(_key(cfg, "openai"))


def _openai_make(desk, cfg, prompt, aspect, timeout):
    model = cfg.get("image_model_openai") or "gpt-image-1"
    data = _post_json("https://api.openai.com/v1/images/generations",
                      {"model": model, "prompt": prompt, "size": SIZES[aspect], "n": 1},
                      {"Authorization": "Bearer " + _key(cfg, "openai")}, timeout)
    item = (data.get("data") or [{}])[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url") and str(item["url"]).startswith("https://"):
        with urllib.request.urlopen(item["url"], timeout=timeout) as res:
            return res.read(MAX_BYTES + 1)
    raise ImageError("image_failed", "no image in the answer")


def _gemini_ready(desk, cfg):
    return bool(_key(cfg, "gemini"))


def _gemini_make(desk, cfg, prompt, aspect, timeout):
    model = cfg.get("image_model_gemini") or "gemini-2.5-flash-image"
    data = _post_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                      {"contents": [{"parts": [{"text": f"{prompt}\n\nFormat: {ASPECT_WORDS[aspect]}."}]}],
                       "generationConfig": {"responseModalities": ["IMAGE"]}},
                      {"x-goog-api-key": _key(cfg, "gemini")}, timeout)
    for cand in data.get("candidates") or []:
        for part in (cand.get("content") or {}).get("parts") or []:
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                return base64.b64decode(blob["data"])
    raise ImageError("image_refused", "the model returned no image")


# ── Codex CLI ────────────────────────────────────────────────────────────

_CODEX_CACHE = {}


def _codex_runtime(desk):
    provider = next((p for p in desk.CLI_PROVIDERS if p["id"] == "codex-cli"), None)
    if not provider:
        return None
    runtime = desk._resolve_cli_runtime(provider, None)
    if not runtime:
        return None
    eu, home, cmd_bin = runtime
    hit = _CODEX_CACHE.get((eu, cmd_bin))
    if hit and time.time() - hit[0] < 120:
        return runtime if hit[1] else None
    ok = desk._cli_is_logged_in(provider, cmd_bin, eu, home) is not False
    _CODEX_CACHE[(eu, cmd_bin)] = (time.time(), ok)
    return runtime if ok else None


def _codex_ready(desk, cfg):
    return _codex_runtime(desk) is not None


def _codex_make(desk, cfg, prompt, aspect, timeout):
    runtime = _codex_runtime(desk)
    if not runtime:
        raise ImageError("image_unavailable")
    eu, home, cmd_bin = runtime
    work = tempfile.mkdtemp(prefix="mvmai-image-")
    try:
        os.chmod(work, 0o700)
        if eu != "root":
            try:
                info = pwd.getpwnam(eu)
                os.chown(work, info.pw_uid, info.pw_gid)
            except Exception:
                pass
        task = ("Use your built-in image_gen tool (not a command line program) to create exactly one image "
                f"as described below, {ASPECT_WORDS[aspect]}. Copy the finished image into the current "
                "folder as base.png and do nothing else.\n\nDescription of the image:\n" + prompt)
        env = {**os.environ, "HOME": home, "USER": eu, "LOGNAME": eu, "PATH": desk._cli_search_path(home)}
        cmd = desk._wrap_as_user([cmd_bin, "exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", work, task], eu)
        try:
            subprocess.run(cmd, cwd=work, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ImageError("image_timeout")
        path = os.path.join(work, "base.png")
        if not os.path.isfile(path):
            others = [f for f in os.listdir(work) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
            path = os.path.join(work, others[0]) if others else ""
        if not path or not os.path.isfile(path) or os.path.getsize(path) > MAX_BYTES:
            raise ImageError("image_failed", "no picture was made")
        with open(path, "rb") as handle:
            return handle.read()
    finally:
        shutil.rmtree(work, ignore_errors=True)


# In the order "auto" tries them: the subscription tool first (a picture there
# costs no more than the subscription already does), then the API generators
# (each picture is billed to the key).
BACKENDS = [
    {"id": "codex-cli", "name": "Codex", "ready": _codex_ready, "make": _codex_make},
    {"id": "openai", "name": "OpenAI", "ready": _openai_ready, "make": _openai_make},
    {"id": "gemini", "name": "Google Gemini", "ready": _gemini_ready, "make": _gemini_make},
]


def _chosen(desk, cfg):
    want = cfg.get("image_backend") or "auto"
    if want == "off":
        return []
    ready = []
    for b in BACKENDS:
        try:
            if (want in ("auto", b["id"])) and b["ready"](desk, cfg):
                ready.append(b)
        except Exception:
            continue
    return ready


def listing(desk) -> dict:
    """For the settings: every generator with whether it is ready, and the choice."""
    cfg = desk._read_cfg()
    out = []
    for b in BACKENDS:
        try:
            ok = bool(b["ready"](desk, cfg))
        except Exception:
            ok = False
        out.append({"id": b["id"], "name": b["name"], "ready": ok})
    return {"backends": out, "choice": cfg.get("image_backend") or "auto", "active": status(desk)["backend"]}


def status(desk) -> dict:
    """{"available": bool, "backend": id or None}"""
    ready = _chosen(desk, desk._read_cfg())
    return {"available": bool(ready), "backend": ready[0]["id"] if ready else None}


def generate(desk, prompt: str, aspect: str = "portrait", timeout: int = 240) -> dict:
    """{"data": base64, "mime", "backend"}; raises ImageError."""
    prompt = str(prompt or "").strip()[:4000]
    if not prompt:
        raise ImageError("image_failed", "empty prompt")
    aspect = aspect if aspect in SIZES else "portrait"
    ready = _chosen(desk, desk._read_cfg())
    if not ready:
        raise ImageError("image_unavailable")
    last = None
    deadline = time.time() + timeout
    for b in ready:
        left = max(20, int(deadline - time.time()))
        try:
            data = b["make"](desk, desk._read_cfg(), prompt, aspect, left)
        except ImageError as exc:
            if exc.code in ("image_refused", "image_timeout"):
                raise
            last = exc
            continue
        mime = _sniff(data or b"")
        if not mime or len(data) > MAX_BYTES:
            last = ImageError("image_failed", "not a picture")
            continue
        return {"data": base64.b64encode(data).decode(), "mime": mime, "backend": b["id"]}
    raise last or ImageError("image_failed")
