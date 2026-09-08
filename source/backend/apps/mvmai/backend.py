"""
mvmAI backend — OpenAI-compatible chat proxy + policy-gated shell execution.

All known providers (Gemini, OpenAI, Groq, OpenRouter, Qwen, DeepSeek, Mistral,
Ollama) expose an OpenAI-compatible /chat/completions endpoint, so a single
adapter serves them all. The provider config and API key live in the app's own
SQLite DB (apps/mvmai/data.db, cfg table) — the key is read server-side and is
never sent back to the browser.
"""

import json
import os
import pwd
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from glob import glob

import httpx
from fastapi import APIRouter, Depends, Header
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


# ── cfg helpers (read/write the app's own data.db) ──────────────────────────────
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


def _write_cfg(key: str, value) -> None:
    """Used by the public-page router (apps/mvmai/api.py) to persist the
    admin-only pub_exec_* toggle — the desktop app writes its own exec_* keys
    directly via mvmOS.db('mvmai') from the frontend, bypassing this backend
    entirely, same as every other desktop setting."""
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("INSERT OR REPLACE INTO cfg (key, value) VALUES (?, ?)", (key, json.dumps(value)))
    conn.commit()
    conn.close()


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

_INSPECT_TOOL = {
    "type": "function",
    "function": {
        "name": "inspect_server",
        "description": "Run any shell command needed to inspect the server. Read-only rule: never use it to change server state.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Any command that only reads or inspects server state."},
                "reason": {"type": "string", "description": "A short explanation of what is being inspected."},
            },
            "required": ["command"],
        },
    },
}


def _apps_hub_user(token: str | None):
    hub = sys.modules.get("backend.apphub")
    return hub.get_pub_session(token) if hub and token else None


def _is_apps_hub_admin(token: str | None) -> bool:
    user = _apps_hub_user(token)
    return bool(user and user.get("is_admin"))


def _server_tools(is_admin: bool, exec_enabled: bool) -> list:
    if not is_admin:
        return []
    return list(_TOOLS) if exec_enabled else [_INSPECT_TOOL]


def _access_prompt(is_admin: bool, exec_enabled: bool) -> str:
    if not is_admin:
        return (
            "You are a general AI assistant. You have no access to this server, its files, "
            "shell, environment, configuration, databases, services, or private data. Never "
            "claim that you inspected or can inspect them. Only use explicitly provided app "
            "API tools, if any; those are scoped to the current user's own data."
        )
    if exec_enabled:
        return (
            "You are mvmAI assisting an Apps Hub administrator. You may inspect the server with "
            "inspect_server and may request shell execution with run_command. Use tools when a "
            "server fact is needed; do not invent server state."
        )
    return (
        "You are mvmAI assisting a trusted Apps Hub administrator with server access. READ-ONLY "
        "RULE: use inspect_server and commands only to inspect the server. Do not create, edit, "
        "delete, install, restart, stop, or otherwise change anything. Do not invent server state."
    )


def _trusted_messages(messages: list, access_prompt: str) -> list:
    """Discard caller-supplied system roles and install the access policy here."""
    out = [{"role": "system", "content": access_prompt}]
    for message in messages:
        role = message.get("role")
        if role == "summary" and message.get("content"):
            out.append({"role": "user", "content": f"[Conversation summary]:\n{message['content']}"})
        elif role in ("user", "assistant", "tool"):
            clean = {key: message[key] for key in ("role", "content", "tool_calls", "tool_call_id", "name") if key in message}
            out.append(clean)
    return out


def _run_readonly_command(command: str) -> dict:
    cmd = command.strip()
    if not cmd:
        raise ValueError("Empty command")
    try:
        proc = subprocess.run(["/bin/bash", "-lc", cmd], capture_output=True, text=True, timeout=120)
        return {"stdout": proc.stdout[-20000:], "stderr": proc.stderr[-20000:], "code": proc.returncode}
    except subprocess.TimeoutExpired:
        return {"stdout": "", "stderr": "Read-only command timed out after 120s", "code": 124}


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
        "exec_enabled": bool(cfg.get("exec_enabled")),
        "exec_auto": bool(cfg.get("exec_auto")),
    })


@router.get("/access")
async def access(x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
    user = _apps_hub_user(x_pub_token)
    return JSONResponse({"apps_hub_logged_in": bool(user), "is_admin": bool(user and user.get("is_admin"))})


@router.post("/migrate-history")
async def migrate_history(x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
    """Move legacy shared desktop chats into the signed-in admin's Apps Hub history.

    Legacy chats have no owner field, so only an Apps Hub admin may claim them.
    Stable prefixed ids make the migration idempotent on every desktop launch.
    """
    user = _apps_hub_user(x_pub_token)
    if not user:
        return JSONResponse({"error": "apps_hub_login_required"}, status_code=401)
    if not user.get("is_admin"):
        return JSONResponse({"ok": True, "migrated": 0})
    migrated = 0
    with sqlite3.connect(_DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"sessions", "messages", "pub_sessions", "pub_messages"}.issubset(tables):
            return JSONResponse({"ok": True, "migrated": 0})
        for legacy in conn.execute("SELECT id,title,created_at,updated_at FROM sessions ORDER BY created_at"):
            target_id = f"desktop-{legacy['id']}"
            existing = conn.execute("SELECT user_id FROM pub_sessions WHERE id=?", (target_id,)).fetchone()
            if existing:
                continue
            conn.execute(
                "INSERT INTO pub_sessions (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)",
                (target_id, user["id"], legacy["title"] or "New chat", legacy["created_at"] or 0, legacy["updated_at"] or 0),
            )
            rows = conn.execute("SELECT role,content FROM messages WHERE session_id=? ORDER BY id", (legacy["id"],)).fetchall()
            for seq, row in enumerate(rows):
                try:
                    message = json.loads(row["content"])
                except Exception:
                    message = {"role": row["role"], "content": row["content"]}
                conn.execute(
                    "INSERT INTO pub_messages (session_id,role,content,tool_call_id,tool_calls,seq) VALUES (?,?,?,?,?,?)",
                    (
                        target_id,
                        message.get("role") or row["role"],
                        message.get("content"),
                        message.get("tool_call_id"),
                        json.dumps(message.get("tool_calls")) if message.get("tool_calls") else None,
                        seq,
                    ),
                )
            migrated += 1
        conn.commit()
    return JSONResponse({"ok": True, "migrated": migrated})


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
    api_key = body.api_key or cfg.get(f"api_key_{pid}") or cfg.get("api_key", "")

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
async def chat(body: ChatRequest, x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
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

    exec_enabled = bool(cfg.get("exec_enabled"))
    is_admin = _is_apps_hub_admin(x_pub_token)
    tools = _server_tools(is_admin, exec_enabled) if body.tools_enabled else []
    messages = _trusted_messages(body.messages, _access_prompt(is_admin, exec_enabled))

    async def _post(with_tools: bool):
        p = {"model": model, "messages": messages}
        if with_tools:
            p["tools"] = tools
            p["tool_choice"] = "auto"
        async with httpx.AsyncClient(timeout=120) as client:
            return await client.post(url, headers=headers, json=p)

    try:
        r = await _post(bool(tools))
        # some models/providers don't support tool use — retry without tools
        if r.status_code == 404 and tools and "tool" in r.text.lower():
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
async def exec_command(body: ExecRequest, x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
    if not _is_apps_hub_admin(x_pub_token):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    cfg = _read_cfg()
    exec_enabled = bool(cfg.get("exec_enabled"))
    exec_auto = bool(cfg.get("exec_auto"))
    cmd = body.command.strip()
    if not cmd:
        return JSONResponse({"error": "Empty command"}, status_code=400)

    if not exec_enabled:
        return JSONResponse({
            "blocked": True,
            "is_dangerous": False,
            "reason": "Command execution is turned off. Turn it on from the exec toggle in the chat sidebar.",
        })

    danger = _is_dangerous(cmd)
    needs_confirm = not exec_auto
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


class InspectRequest(BaseModel):
    command: str
    reason: str = ""


@router.post("/inspect")
async def inspect_server(body: InspectRequest, x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
    if not _is_apps_hub_admin(x_pub_token):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    try:
        return JSONResponse({"result": _run_readonly_command(body.command)})
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


# ── CLI providers ────────────────────────────────────────────────────────────────
CLI_PROVIDERS = [
    {"id": "claude-cli",  "name": "Claude CLI",  "cmd": "claude",  "args": ["--print"], "supports_model": True,  "model_choices": []},
    {"id": "gemini-cli",  "name": "Gemini CLI",  "cmd": "gemini",  "args": ["--prompt"], "supports_model": True,  "model_choices": []},
    {"id": "ollama-cli",  "name": "Ollama CLI",  "cmd": "ollama",  "args": ["run"],      "supports_model": True,  "model_choices": [], "model_discovery": "ollama"},
    {"id": "sgpt-cli",    "name": "shell-gpt",   "cmd": "sgpt",    "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
    {"id": "aichat-cli",  "name": "aichat",      "cmd": "aichat",  "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
    {"id": "llm-cli",     "name": "llm",         "cmd": "llm",     "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
    {"id": "gpt4all-cli", "name": "GPT4All CLI", "cmd": "gpt4all", "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
    {"id": "codex-cli",   "name": "Codex CLI",   "cmd": "codex",   "args": [],           "supports_model": True,  "model_choices": [], "model_discovery": "codex"},
    {"id": "mods-cli",    "name": "mods",        "cmd": "mods",    "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
    {"id": "tgpt-cli",    "name": "tgpt",        "cmd": "tgpt",    "args": [],           "supports_model": False, "model_hint": "", "model_choices": []},
]


# CLI providers only understand plain text, so the centrally authorized tool
# list is described in the prompt and a fenced reply block is translated back
# into the same tool-call shape used by HTTP providers.
_CLI_TOOL_CALL_RE = re.compile(r"```mvmai_tool_call\s*\n(.*?)```", re.DOTALL)


def _cli_tool_instructions(tools: list) -> str:
    lines = ["You can call at most one of the following tools per reply:"]
    for spec in tools:
        fn = spec["function"]
        props = (fn.get("parameters") or {}).get("properties") or {}
        args_desc = ", ".join(f"{k} ({v.get('type', 'string')})" for k, v in props.items())
        lines.append(f"- {fn['name']}: {fn['description']} Arguments: {args_desc}.")
    lines.append(
        "To call it, output ONLY a fenced code block labeled mvmai_tool_call containing a JSON "
        "object with \"name\" and \"arguments\" keys, e.g.:\n"
        "```mvmai_tool_call\n{\"name\": \"tool_name\", \"arguments\": {}}\n```\n"
        "Only include that block when you actually want to run a command. Otherwise just answer normally in plain text."
    )
    return "\n".join(lines)


def _cli_search_path() -> str:
    """Return PATH plus common per-user CLI install locations.

    Services do not load interactive shell startup files, so tools installed by
    Codex, npm, nvm, pnpm, Bun, Volta, asdf, or mise may be available in a
    terminal but absent from the service's PATH.
    """
    home = os.path.expanduser("~")
    env_paths = [
        os.environ.get("NVM_BIN"),
        os.environ.get("PNPM_HOME"),
        os.path.join(os.environ["BUN_INSTALL"], "bin") if os.environ.get("BUN_INSTALL") else None,
        os.path.join(os.environ["VOLTA_HOME"], "bin") if os.environ.get("VOLTA_HOME") else None,
        os.path.join(os.environ["NPM_CONFIG_PREFIX"], "bin") if os.environ.get("NPM_CONFIG_PREFIX") else None,
    ]
    user_paths = [
        os.path.join(home, ".local", "bin"),
        os.path.join(home, "bin"),
        os.path.join(home, ".npm-global", "bin"),
        os.path.join(home, ".local", "share", "pnpm"),
        os.path.join(home, ".bun", "bin"),
        os.path.join(home, ".volta", "bin"),
        os.path.join(home, ".asdf", "shims"),
        os.path.join(home, ".local", "share", "mise", "shims"),
    ]
    nvm_paths = sorted(glob(os.path.join(home, ".nvm", "versions", "node", "*", "bin")), reverse=True)
    system_paths = os.environ.get("PATH", "").split(os.pathsep)

    # Keep the first occurrence so an explicitly configured PATH still wins.
    return os.pathsep.join(dict.fromkeys(p for p in system_paths + env_paths + user_paths + nvm_paths if p))


def _which(cmd: str) -> str | None:
    try:
        return shutil.which(cmd, path=_cli_search_path())
    except Exception:
        return None


def _discover_cli_models(provider: dict, cmd_bin: str) -> list[str]:
    discovery = provider.get("model_discovery")
    try:
        if discovery == "codex":
            proc = subprocess.run(
                [cmd_bin, "debug", "models"], capture_output=True, text=True, timeout=15,
            )
            if proc.returncode != 0:
                return []
            data = json.loads(proc.stdout)
            return list(dict.fromkeys(
                model["slug"] for model in data.get("models", [])
                if model.get("slug") and model.get("visibility") != "hide"
            ))
        if discovery == "ollama":
            proc = subprocess.run([cmd_bin, "list"], capture_output=True, text=True, timeout=10)
            if proc.returncode != 0:
                return []
            lines = [line.split() for line in proc.stdout.splitlines() if line.strip()]
            return list(dict.fromkeys(parts[0] for parts in lines if parts and parts[0].upper() != "NAME"))
    except Exception:
        pass
    return []


def _detected_cli_providers():
    detected = []
    for provider in CLI_PROVIDERS:
        cmd_bin = _which(provider["cmd"])
        if not cmd_bin:
            continue
        item = dict(provider)
        item["model_choices"] = _discover_cli_models(provider, cmd_bin)
        item["models_dynamic"] = bool(provider.get("model_discovery"))
        item.pop("model_discovery", None)
        detected.append(item)
    return detected


@router.get("/cli-providers")
async def cli_providers(session=Depends(get_current_session)):
    return JSONResponse({"cli_providers": _detected_cli_providers()})


class CliChatRequest(BaseModel):
    provider_id: str
    messages: list
    # None = read the saved model from cfg (desktop chat, unchanged
    # behavior); an explicit value (including "") lets a caller like the
    # public-page chat pass an already-resolved model without it being
    # silently overwritten by the desktop's own saved model for a
    # different provider.
    model: str | None = None
    # Retained for compatibility with older frontends; access is resolved
    # exclusively from the Apps Hub token and this value is never trusted.
    offer_run_command: bool = False


async def _run_cli_chat(
    body: CliChatRequest,
    tools: list,
    is_admin: bool,
    exec_enabled: bool,
    exec_auto: bool = False,
    identity_prompt: str = "",
):
    provider = next((p for p in CLI_PROVIDERS if p["id"] == body.provider_id), None)
    if not provider:
        return JSONResponse({"error": f"Unknown CLI provider: {body.provider_id}"}, status_code=400)
    cmd_bin = _which(provider["cmd"])
    if not cmd_bin:
        return JSONResponse({"error": f"'{provider['cmd']}' not found in PATH"}, status_code=400)

    # Build conversation as a single prompt with history
    native_server_access = is_admin and (not exec_enabled or exec_auto)
    server_tool_names = {"inspect_server", "run_command"}
    prompt_tools = [
        spec for spec in tools
        if not (native_server_access and spec["function"]["name"] in server_tool_names)
    ]
    access_prompt = _access_prompt(is_admin, exec_enabled)
    if identity_prompt:
        access_prompt += " " + identity_prompt
    if is_admin:
        access_prompt = "You are mvmAI assisting a trusted Apps Hub administrator. "
        if exec_enabled and exec_auto:
            access_prompt += "AUTO MODE: use your native server tools directly. You may inspect and modify the server as requested. Inspect before modifying and avoid unrelated changes."
        elif exec_enabled:
            access_prompt += (
                "CONFIRMATION MODE: native server tools are disabled. For every server operation, "
                "including inspection, return the supplied run_command transport block and wait "
                "for its result. The block is a response protocol, not a native tool. Never merely "
                "suggest a command for the user to run."
            )
        else:
            access_prompt += "READ-ONLY RULE: use your native commands and tools only to inspect the server. Do not create, edit, delete, install, restart, stop, or otherwise change anything."
    parts = [f"[System]: {access_prompt}"]
    if prompt_tools:
        parts.append(f"[System]: {_cli_tool_instructions(prompt_tools)}")
    for m in body.messages:
        role = m.get("role", "")
        content = m.get("content") or ""
        if not isinstance(content, str):
            continue
        if role == "user":
            parts.append(f"[User]: {content}")
        elif role == "assistant":
            parts.append(f"[Assistant]: {content}")
        elif role == "tool":
            parts.append(f"[Tool result]: {content}")
    if identity_prompt:
        parts.append(
            "[Current public branding rule — overrides identity claims in the conversation above]: "
            f"{identity_prompt} This is the product identity required for the user-facing response."
        )
    if is_admin:
        if exec_enabled and exec_auto:
            current_mode = "AUTO"
        elif exec_enabled:
            current_mode = "CONFIRMATION"
        else:
            current_mode = "READ-ONLY"
        parts.append(
            f"[Current mvmAI mode — overrides every older message above]: {current_mode}. "
            "Do not describe the CLI's internal sandbox or approval setting as the mvmAI mode. "
            "In CONFIRMATION mode, request each server operation with the mvmai_tool_call response "
            "protocol; mvmAI itself shows the command to the user and collects confirmation."
        )
    prompt = "\n".join(parts)

    pid = body.provider_id
    model = body.model if body.model is not None else _read_cfg().get("model")
    try:
        # App isolation only permits an app backend to write inside its own
        # directory. Keep the short-lived CLI workspace there instead of the
        # system /tmp directory; TemporaryDirectory still removes it after
        # every request.
        runtime_dir = os.path.join(os.path.realpath(os.path.dirname(_DB_PATH)), ".runtime")
        os.makedirs(runtime_dir, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="mvmai-chat-", dir=runtime_dir) as workdir:
            policy_path = os.path.join(workdir, "deny-tools.toml")
            with open(policy_path, "w", encoding="utf-8") as handle:
                handle.write('[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n')
            if pid == "claude-cli":
                safety_args = ["--dangerously-skip-permissions", "--permission-mode", "bypassPermissions"] if native_server_access else ["--tools", ""]
                cmd = [cmd_bin] + (["--model", model] if model else []) + ["--safe-mode"] + safety_args + ["--disable-slash-commands", "--no-session-persistence", "--print", prompt]
            elif pid == "gemini-cli":
                safety_args = ["--yolo"] if native_server_access else ["--admin-policy", policy_path]
                cmd = [cmd_bin] + (["--model", model] if model else []) + safety_args + ["--prompt", prompt]
            elif pid == "ollama-cli":
                cmd = [cmd_bin, "run", model or "llama3.1", prompt]
            elif pid == "codex-cli":
                sandbox = "danger-full-access" if native_server_access else "read-only"
                safety_args = [] if native_server_access else ["-c", "features.shell_tool=false"]
                cmd = [cmd_bin, "exec", "--skip-git-repo-check", "--sandbox", sandbox, "-C", workdir, "-c", 'web_search="disabled"'] + safety_args + (["--model", model] if model else []) + [prompt]
            else:
                cmd = [cmd_bin] + provider["args"] + [prompt]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=workdir)
        if proc.returncode != 0 and not proc.stdout.strip():
            err = proc.stderr.strip() or f"exit code {proc.returncode}"
            return JSONResponse({"error": err}, status_code=502)
        content = proc.stdout.strip()
        if prompt_tools:
            m = _CLI_TOOL_CALL_RE.search(content)
            if m:
                name = ""
                arguments = {}
                try:
                    parsed = json.loads(m.group(1))
                    name = str(parsed.get("name") or "")
                    arguments = parsed.get("arguments") or {}
                except Exception:
                    pass
                valid_names = {spec["function"]["name"] for spec in prompt_tools}
                if name in valid_names:
                    rest = (content[:m.start()] + content[m.end():]).strip()
                    return JSONResponse({
                        "content": rest or None,
                        "tool_calls": [{
                            "id": "cli-call-1",
                            "type": "function",
                            "function": {"name": name, "arguments": json.dumps(arguments)},
                        }],
                    })
        return JSONResponse({"content": content})
    except subprocess.TimeoutExpired:
        return JSONResponse({"error": "CLI timed out after 120s"}, status_code=504)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)


@router.post("/cli-chat")
async def cli_chat(body: CliChatRequest, x_pub_token: str = Header(default=None), session=Depends(get_current_session)):
    cfg = _read_cfg()
    is_admin = _is_apps_hub_admin(x_pub_token)
    exec_enabled = bool(cfg.get("exec_enabled"))
    exec_auto = bool(cfg.get("exec_auto"))
    return await _run_cli_chat(body, _server_tools(is_admin, exec_enabled), is_admin, exec_enabled, exec_auto)
