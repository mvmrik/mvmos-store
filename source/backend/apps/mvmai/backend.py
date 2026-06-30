"""
mvmAI backend — OpenAI-compatible chat proxy + policy-gated shell execution.

All known providers (Gemini, OpenAI, Groq, OpenRouter, Qwen, DeepSeek, Mistral,
Ollama) expose an OpenAI-compatible /chat/completions endpoint, so a single
adapter serves them all. The provider config and API key live in the app's own
SQLite DB (apps/mvmai/data.db, cfg table) — the key is read server-side and is
never sent back to the browser.
"""

import os
import pwd
import re
import sqlite3
import subprocess
import sys

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/mvmai", tags=["mvmai"])

# Path to this app's own SQLite DB (shared with the frontend mvmOS.db('mvmai'))
_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "mvmai", "data.db")

# ── Known providers — all OpenAI-compatible ─────────────────────────────────────
PROVIDERS = {
    "gemini":     {"name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/", "needs_key": True,  "default_model": "gemini-2.0-flash"},
    "openai":     {"name": "OpenAI",         "base_url": "https://api.openai.com/v1/",                              "needs_key": True,  "default_model": "gpt-4o-mini"},
    "groq":       {"name": "Groq",           "base_url": "https://api.groq.com/openai/v1/",                         "needs_key": True,  "default_model": "llama-3.3-70b-versatile"},
    "openrouter": {"name": "OpenRouter",     "base_url": "https://openrouter.ai/api/v1/",                           "needs_key": True,  "default_model": "openai/gpt-4o-mini"},
    "deepseek":   {"name": "DeepSeek",       "base_url": "https://api.deepseek.com/",                               "needs_key": True,  "default_model": "deepseek-chat"},
    "qwen":       {"name": "Qwen (DashScope)","base_url": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/", "needs_key": True, "default_model": "qwen-plus"},
    "mistral":    {"name": "Mistral",        "base_url": "https://api.mistral.ai/v1/",                              "needs_key": True,  "default_model": "mistral-small-latest"},
    "ollama":     {"name": "Ollama (local)", "base_url": "http://localhost:11434/v1/",                              "needs_key": False, "default_model": "llama3.1"},
    "custom":     {"name": "Custom",         "base_url": "",                                                        "needs_key": True,  "default_model": ""},
}

# ── Dangerous command patterns ──────────────────────────────────────────────────
_DANGER = [
    r"\brm\s+-[a-z]*[rf]",          # rm -rf / rm -fr / rm -r
    r"\bmkfs\b", r"\bwipefs\b", r"\bfdisk\b", r"\bparted\b", r"\bsgdisk\b",
    r"\bdd\s+.*\bof=/dev/",          # dd to a device
    r">\s*/dev/sd", r">\s*/dev/nvme", r">\s*/dev/vd",
    r"\bshutdown\b", r"\breboot\b", r"\bpoweroff\b", r"\bhalt\b", r"\binit\s+[06]\b",
    r":\(\)\s*\{",                   # fork bomb
    r"\bchmod\s+-R\s+777\s+/(\s|$)", r"\bchown\s+-R\s+.*\s+/(\s|$)",
    r"\buserdel\b", r"\bdeluser\b",
    r"\brm\s+-[a-z]*\s+/(\s|$)", r"\brm\s+-[a-z]*\s+/\*",
    r">\s*/etc/", r"\bmv\b.*\s+/etc/",
]


def _is_dangerous(cmd: str) -> bool:
    c = cmd.strip()
    return any(re.search(p, c) for p in _DANGER)


# ── cfg helpers (read the app's own data.db) ────────────────────────────────────
def _read_cfg() -> dict:
    cfg = {}
    if not os.path.isfile(_DB_PATH):
        return cfg
    try:
        conn = sqlite3.connect(_DB_PATH)
        for key, value in conn.execute("SELECT key, value FROM cfg"):
            try:
                import json as _json
                cfg[key] = _json.loads(value)
            except Exception:
                cfg[key] = value
        conn.close()
    except Exception:
        pass
    return cfg


def _resolve_provider(cfg: dict):
    """Return (base_url, api_key, model) from saved config."""
    pid = cfg.get("provider", "gemini")
    meta = PROVIDERS.get(pid, PROVIDERS["custom"])
    base_url = cfg.get("base_url") or meta["base_url"]
    if base_url and not base_url.endswith("/"):
        base_url += "/"
    # per-provider key (api_key_gemini, api_key_groq…) takes priority over legacy api_key
    api_key = cfg.get(f"api_key_{pid}") or cfg.get("api_key", "")
    model = cfg.get("model") or meta["default_model"]
    return pid, base_url, api_key, model


# ── Tool definition exposed to the model ────────────────────────────────────────
_TOOLS = [{
    "type": "function",
    "function": {
        "name": "run_command",
        "description": "Execute a shell command on the Linux server and return its stdout, stderr and exit code. Use this whenever you need to inspect, configure or modify the system. Commands run with the privileges of the logged-in mvmOS user.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "The shell command to run."},
                "reason": {"type": "string", "description": "A short, human-readable explanation of why you are running this command."},
            },
            "required": ["command"],
        },
    },
}]


# ── Endpoints ───────────────────────────────────────────────────────────────────
@router.get("/providers")
async def list_providers(session=Depends(get_current_session)):
    out = [{"id": k, **{x: v[x] for x in ("name", "base_url", "needs_key", "default_model")}} for k, v in PROVIDERS.items()]
    return JSONResponse({"providers": out})


@router.get("/status")
async def status(session=Depends(get_current_session)):
    """Report current config without leaking the key."""
    cfg = _read_cfg()
    pid, base_url, api_key, model = _resolve_provider(cfg)
    return JSONResponse({
        "provider": pid,
        "model": model,
        "base_url": base_url,
        "has_key": bool(api_key) or not PROVIDERS.get(pid, {}).get("needs_key", True),
        "confirm_mode": cfg.get("confirm_mode", "always"),
        "allow_dangerous": str(cfg.get("allow_dangerous", "0")) == "1",
    })


class ModelsRequest(BaseModel):
    provider: str = ""
    api_key: str = ""
    base_url: str = ""


@router.post("/models")
async def list_models(body: ModelsRequest, session=Depends(get_current_session)):
    """Fetch available models from the configured (or provided) provider."""
    cfg = _read_cfg()
    pid = body.provider or cfg.get("provider", "gemini")
    meta = PROVIDERS.get(pid, PROVIDERS["custom"])
    base_url = body.base_url or cfg.get("base_url") or meta["base_url"]
    if base_url and not base_url.endswith("/"):
        base_url += "/"
    api_key = body.api_key or cfg.get("api_key", "")

    if not base_url:
        return JSONResponse({"error": "No base URL — pick a provider first."}, status_code=400)

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = base_url + "models"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers=headers)
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", {}).get("message") or r.text[:300]
            except Exception:
                detail = r.text[:300]
            return JSONResponse({"error": f"Provider error ({r.status_code}): {detail}"}, status_code=r.status_code)
        data = r.json()
        # Standard OpenAI format: {"data": [{"id": "model-name", ...}]}
        models = sorted([m["id"] for m in data.get("data", []) if m.get("id")])
        return JSONResponse({"models": models})
    except httpx.ConnectError:
        return JSONResponse({"error": f"Cannot reach {base_url}"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


class ChatRequest(BaseModel):
    messages: list
    tools_enabled: bool = True


@router.post("/chat")
async def chat(body: ChatRequest, session=Depends(get_current_session)):
    cfg = _read_cfg()
    pid, base_url, api_key, model = _resolve_provider(cfg)
    if not base_url:
        return JSONResponse({"error": "No provider configured. Open settings and pick a provider."}, status_code=400)
    if PROVIDERS.get(pid, {}).get("needs_key", True) and not api_key:
        return JSONResponse({"error": "No API key set. Open settings and enter your API key."}, status_code=400)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    url = base_url + "chat/completions"

    async def _post(with_tools: bool):
        p = {"model": model, "messages": body.messages}
        if with_tools:
            p["tools"] = _TOOLS
            p["tool_choice"] = "auto"
        async with httpx.AsyncClient(timeout=120) as client:
            return await client.post(url, headers=headers, json=p)

    try:
        r = await _post(body.tools_enabled)
        # some models/providers don't support tool use — retry without tools
        if r.status_code == 404 and body.tools_enabled and "tool" in r.text.lower():
            r = await _post(False)
    except httpx.ConnectError:
        return JSONResponse({"error": f"Cannot reach provider at {base_url}"}, status_code=502)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

    if r.status_code >= 400:
        detail = r.text
        try:
            j = r.json()
            detail = j.get("error", {}).get("message") or j.get("error") or detail
        except Exception:
            pass
        return JSONResponse({"error": f"Provider error ({r.status_code}): {detail}"}, status_code=r.status_code)

    try:
        data = r.json()
        msg = data["choices"][0]["message"]
    except Exception:
        return JSONResponse({"error": "Unexpected provider response"}, status_code=502)
    return JSONResponse({"message": msg})


class ExecRequest(BaseModel):
    command: str
    confirmed: bool = False


@router.post("/exec")
async def exec_command(body: ExecRequest, session=Depends(get_current_session)):
    cfg = _read_cfg()
    confirm_mode = cfg.get("confirm_mode", "always")          # always | dangerous | never
    allow_dangerous = str(cfg.get("allow_dangerous", "0")) == "1"
    cmd = body.command.strip()
    if not cmd:
        return JSONResponse({"error": "Empty command"}, status_code=400)

    danger = _is_dangerous(cmd)
    if danger and not allow_dangerous:
        return JSONResponse({
            "blocked": True,
            "is_dangerous": True,
            "reason": "This command is classified as dangerous and 'Allow dangerous commands' is disabled in settings.",
        })

    needs_confirm = confirm_mode == "always" or (confirm_mode == "dangerous" and danger)
    if needs_confirm and not body.confirmed:
        return JSONResponse({"pending": True, "is_dangerous": danger})

    # Run with the privileges of the logged-in mvmOS user, exactly like the core
    # terminal (backend/terminal.py): uvicorn is root so it can drop down to the
    # session's effective_user via runuser. Never run app commands as root unless
    # the user actually logged in as root.
    eu = (session or {}).get("effective_user", "root")
    needs_sudo = os.geteuid() != 0
    if needs_sudo:
        wrapped = ["sudo", "runuser", "-l", eu, "-c", cmd]
    elif eu and eu != "root":
        wrapped = ["runuser", "-l", eu, "-c", cmd]
    else:
        wrapped = ["/bin/bash", "-lc", cmd]
    try:
        home = pwd.getpwnam(eu).pw_dir
    except KeyError:
        home = "/root"

    try:
        proc = subprocess.run(
            wrapped, capture_output=True, text=True, timeout=120,
            cwd=home, env={**os.environ, "HOME": home, "USER": eu, "LOGNAME": eu},
        )
        return JSONResponse({
            "stdout": proc.stdout[-20000:],
            "stderr": proc.stderr[-20000:],
            "code": proc.returncode,
            "is_dangerous": danger,
        })
    except subprocess.TimeoutExpired:
        return JSONResponse({"stdout": "", "stderr": "Command timed out after 120s", "code": 124, "is_dangerous": danger})
    except Exception as e:
        return JSONResponse({"stdout": "", "stderr": str(e), "code": 1, "is_dangerous": danger})


# ── CLI providers ────────────────────────────────────────────────────────────────
CLI_PROVIDERS = [
    {"id": "claude-cli",  "name": "Claude CLI",  "cmd": "claude",  "args": ["--print"]},
    {"id": "gemini-cli",  "name": "Gemini CLI",  "cmd": "gemini",  "args": ["--prompt"]},
    {"id": "ollama-cli",  "name": "Ollama CLI",  "cmd": "ollama",  "args": ["run"]},
    {"id": "sgpt-cli",    "name": "shell-gpt",   "cmd": "sgpt",    "args": []},
    {"id": "aichat-cli",  "name": "aichat",      "cmd": "aichat",  "args": []},
    {"id": "llm-cli",     "name": "llm",         "cmd": "llm",     "args": []},
    {"id": "gpt4all-cli", "name": "GPT4All CLI", "cmd": "gpt4all", "args": []},
    {"id": "mods-cli",    "name": "mods",        "cmd": "mods",    "args": []},
    {"id": "tgpt-cli",    "name": "tgpt",        "cmd": "tgpt",    "args": []},
]


def _which(cmd: str) -> str | None:
    try:
        r = subprocess.run(["which", cmd], capture_output=True, text=True, timeout=3)
        return r.stdout.strip() or None
    except Exception:
        return None


def _detected_cli_providers():
    return [p for p in CLI_PROVIDERS if _which(p["cmd"])]


@router.get("/cli-providers")
async def cli_providers(session=Depends(get_current_session)):
    return JSONResponse({"cli_providers": _detected_cli_providers()})


class CliChatRequest(BaseModel):
    provider_id: str
    messages: list


@router.post("/cli-chat")
async def cli_chat(body: CliChatRequest, session=Depends(get_current_session)):
    provider = next((p for p in CLI_PROVIDERS if p["id"] == body.provider_id), None)
    if not provider:
        return JSONResponse({"error": f"Unknown CLI provider: {body.provider_id}"}, status_code=400)
    cmd_bin = _which(provider["cmd"])
    if not cmd_bin:
        return JSONResponse({"error": f"'{provider['cmd']}' not found in PATH"}, status_code=400)

    # Build conversation as a single prompt with history
    parts = []
    for m in body.messages:
        role = m.get("role", "")
        content = m.get("content") or ""
        if not isinstance(content, str):
            continue
        if role == "system":
            parts.append(f"[System]: {content}")
        elif role == "user":
            parts.append(f"[User]: {content}")
        elif role == "assistant":
            parts.append(f"[Assistant]: {content}")
    prompt = "\n".join(parts)

    pid = body.provider_id
    if pid == "claude-cli":
        cmd = [cmd_bin, "--print", prompt]
    elif pid == "gemini-cli":
        cmd = [cmd_bin, "--prompt", prompt]
    elif pid == "ollama-cli":
        # ollama run <model> needs model from cfg
        cfg = _read_cfg()
        model = cfg.get("model") or "llama3.1"
        cmd = [cmd_bin, "run", model, prompt]
    else:
        cmd = [cmd_bin] + provider["args"] + [prompt]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if proc.returncode != 0 and not proc.stdout.strip():
            err = proc.stderr.strip() or f"exit code {proc.returncode}"
            return JSONResponse({"error": err}, status_code=502)
        return JSONResponse({"content": proc.stdout.strip()})
    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "CLI timed out after 120s"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
