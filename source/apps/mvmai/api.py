"""
mvmAI public page — router mounted at /pub/mvmai by public_loader.py.

Reuses the desktop backend's provider/config/danger-check logic
(app_backend_mvmai, loaded by app_backends.py before this module) instead of
duplicating it, so the provider list and the dangerous-command denylist stay
in one place.

Trust model:
  - Admin (public_users.is_admin) can get the same chat + shell access as the
    desktop app, gated by their own pub_exec_enabled/pub_exec_auto toggle
    (set from the exec button in the chat sidebar, admin-only — see
    /exec-settings below): off means run_command is never offered to the
    model at all, same as a non-admin; on means it is offered, either with a
    confirmation step per command or fully automatic depending on
    pub_exec_auto. This is the server owner's own remote control of their
    own server, so none of it is gated by premium or credits.
  - Everyone else gets plain chat, unconditionally free, with run_command
    never offered to the model — it is structurally absent from the tool
    list they get, not merely blocked at execution time.
  - The personal-data bridge (asking mvmAI to read or change the caller's own
    data in another installed app) additionally requires this installation to
    have the store-premium module downloaded (apps/mvmai/premium/backend.py).
    Without it the model is simply never given those tools and /tool-call
    always answers "not available" — no premium upsell here, matching how
    the public page never shows premium prompts. user_id for every bridge
    call is always the caller's own authenticated session id — the model can
    choose which tool to call and with what arguments, but never who it acts
    as, which is what keeps one user's tool calls off another user's data.
  - An optional per-message credit charge (admin's choice, via the Public
    Apps tab's existing credit catalog) is fully independent of premium and
    applies uniformly, including to the admin's own account.
"""

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import uuid

import httpx
from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "mvmai"
_DIR = os.path.dirname(__file__)
_PUBLIC_DIR = os.path.join(_DIR, "public")
_DB_PATH = os.path.join(_DIR, "data.db")


# ── Per-user public chat sessions ──────────────────────────────────────────────
# Separate from the desktop app's own sessions/messages tables (those have no
# user_id at all — one shared history for whoever is logged into the desktop —
# and mixing them would leak the admin's desktop chats into their public
# profile or vice versa). These tables live in the same data.db file but are
# scoped by public_users id from the start.

def _sdb():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_tables():
    with _sdb() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pub_sessions ("
            "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',"
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pub_messages ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,"
            "role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, seq INTEGER NOT NULL)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_pub_messages_session ON pub_messages(session_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_pub_sessions_user ON pub_sessions(user_id)")


_ensure_tables()


def _make_title(messages):
    for m in messages:
        if m.get("role") == "user" and m.get("content"):
            txt = m["content"].strip()
            return (txt[:57] + "…") if len(txt) > 57 else txt
    return "New chat"


def _persist_turn(user_id, session_id, messages, reply):
    """Snapshot this send()'s full message list (client-maintained, always
    complete) plus the new reply into the session, creating one if needed or
    if the given id doesn't belong to this user. Replace-all rather than
    incremental append: simplest correct option for chat-sized histories, and
    self-healing if a previous turn's persist was interrupted."""
    now = int(time.time())
    with _sdb() as conn:
        row = None
        if session_id:
            row = conn.execute(
                "SELECT id FROM pub_sessions WHERE id=? AND user_id=?", (session_id, user_id)
            ).fetchone()
        if row:
            conn.execute("UPDATE pub_sessions SET updated_at=? WHERE id=?", (now, session_id))
        else:
            session_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO pub_sessions (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
                (session_id, user_id, _make_title(messages), now, now),
            )
        conn.execute("DELETE FROM pub_messages WHERE session_id=?", (session_id,))
        full = list(messages) + [reply]
        for i, m in enumerate(full):
            conn.execute(
                "INSERT INTO pub_messages (session_id, role, content, tool_call_id, tool_calls, seq) "
                "VALUES (?,?,?,?,?,?)",
                (
                    session_id, m.get("role"), m.get("content"), m.get("tool_call_id"),
                    json.dumps(m["tool_calls"]) if m.get("tool_calls") else None, i,
                ),
            )
    return session_id


def _hub():
    return sys.modules.get("backend.apphub")


def _desktop():
    return sys.modules.get("app_backend_mvmai")


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _premium():
    prem = sys.modules.get("backend.premium")
    return prem.load_premium_backend(APP_ID) if prem else None


# CLI providers (claude-cli, gemini-cli, ...) talk in plain text, not the
# OpenAI tool_calls JSON the HTTP providers use — so neither run_command nor
# the premium app-api bridge has anything to attach to there. To let a CLI
# provider use the exact same tools an HTTP provider would get (same
# pub_exec_enabled/pub_exec_auto gate via /exec for run_command, same
# per-user-scoped bridge dispatch via /tool-call for everything else), we
# describe the already-computed `tools` list in the prompt and ask for a
# fenced code block naming one; a match is translated into a synthesized
# tool_calls entry, which the widget already knows how to drive unchanged —
# it never distinguishes CLI from HTTP providers, only run_command from any
# other tool name.
_CLI_TOOL_CALL_RE = re.compile(r"```mvmai_tool_call\s*\n(.*?)```", re.DOTALL)


def _cli_tool_instructions(tools):
    if not tools:
        return None
    lines = ["You can call at most one of the following tools per reply, when it helps answer the request:"]
    for spec in tools:
        fn = spec["function"]
        props = (fn.get("parameters") or {}).get("properties") or {}
        args_desc = ", ".join(f"{k} ({v.get('type', 'string')})" for k, v in props.items()) or "no arguments"
        lines.append(f"- {fn['name']}: {fn['description']} Arguments: {args_desc}.")
    lines.append(
        "To call one, output ONLY a fenced code block labeled mvmai_tool_call containing a JSON "
        "object with \"name\" and \"arguments\" keys, e.g.:\n"
        "```mvmai_tool_call\n{\"name\": \"tool_name\", \"arguments\": {\"key\": \"value\"}}\n```\n"
        "Only include that block when you actually want to call a tool. "
        "Otherwise just answer normally in plain text."
    )
    return "\n".join(lines)


def _cli_flatten_messages(messages, tools):
    """Adapt the widget's OpenAI-shaped message list for desk.cli_chat(),
    which only understands system/user/assistant roles: fold tool-result
    turns (produced after a tool-call round-trip) into readable user text,
    and prepend the tool instructions — built from the same per-request
    `tools` list the HTTP path uses, so an empty list (e.g. a regular user
    with no premium bridge) means no instructions and no way to trigger one."""
    out = []
    instructions = _cli_tool_instructions(tools)
    if instructions:
        out.append({"role": "system", "content": instructions})
    for m in messages:
        role = m.get("role")
        if role == "tool":
            out.append({"role": "user", "content": f"[Tool result]:\n{m.get('content') or ''}"})
        elif role in ("system", "user", "assistant") and m.get("content"):
            out.append(m)
    return out


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>mvmAI</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">mvmAI is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    prem = _premium()
    desk = _desktop()
    price = 0
    if hub and hub.credits_available():
        price = hub.get_credit_feature_price(APP_ID, "chat_message")
    return JSONResponse({
        "id": me["id"],
        "is_admin": bool(me.get("is_admin")),
        "has_api_bridge": bool(prem and prem.is_available() and desk is not None and desk._read_cfg().get("pub_data_bridge_enabled")),
        "credit_price": price,
        "credit_balance": hub.get_credit_balance(me["id"]) if hub else 0,
    })


@router.get("/sessions")
async def list_sessions(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _sdb() as conn:
        rows = conn.execute(
            "SELECT id, title, updated_at FROM pub_sessions WHERE user_id=? ORDER BY updated_at DESC",
            (me["id"],),
        ).fetchall()
    return JSONResponse({"sessions": [dict(r) for r in rows]})


@router.get("/sessions/{sid}/messages")
async def get_session_messages(sid: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _sdb() as conn:
        owned = conn.execute(
            "SELECT 1 FROM pub_sessions WHERE id=? AND user_id=?", (sid, me["id"])
        ).fetchone()
        if not owned:
            return JSONResponse({"error": "not_found"}, status_code=404)
        rows = conn.execute(
            "SELECT role, content, tool_call_id, tool_calls FROM pub_messages WHERE session_id=? ORDER BY seq",
            (sid,),
        ).fetchall()
    messages = []
    for r in rows:
        m = {"role": r["role"], "content": r["content"]}
        if r["tool_call_id"]:
            m["tool_call_id"] = r["tool_call_id"]
        if r["tool_calls"]:
            m["tool_calls"] = json.loads(r["tool_calls"])
        messages.append(m)
    return JSONResponse({"messages": messages})


class RenameRequest(BaseModel):
    title: str


@router.patch("/sessions/{sid}")
async def rename_session(sid: str, body: RenameRequest, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:120] or "New chat"
    with _sdb() as conn:
        cur = conn.execute(
            "UPDATE pub_sessions SET title=? WHERE id=? AND user_id=?", (title, sid, me["id"])
        )
        if cur.rowcount == 0:
            return JSONResponse({"error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True})


@router.delete("/sessions/{sid}")
async def delete_session(sid: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _sdb() as conn:
        owned = conn.execute(
            "SELECT 1 FROM pub_sessions WHERE id=? AND user_id=?", (sid, me["id"])
        ).fetchone()
        if not owned:
            return JSONResponse({"error": "not_found"}, status_code=404)
        conn.execute("DELETE FROM pub_messages WHERE session_id=?", (sid,))
        conn.execute("DELETE FROM pub_sessions WHERE id=?", (sid,))
    return JSONResponse({"ok": True})


class ChatRequest(BaseModel):
    messages: list
    session_id: str | None = None


@router.post("/chat")
async def chat(body: ChatRequest, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    desk = _desktop()
    if desk is None:
        return JSONResponse({"error": "mvmAI is not available"}, status_code=500)

    hub = _hub()
    is_admin = bool(me.get("is_admin"))

    price = 0
    if hub and hub.credits_available():
        price = hub.get_credit_feature_price(APP_ID, "chat_message")
        if price and hub.get_credit_balance(me["id"]) < price:
            return JSONResponse({"error": "insufficient_credits", "price": price}, status_code=402)

    cfg = desk._read_cfg()
    tools = list(desk._TOOLS) if (is_admin and cfg.get("pub_exec_enabled")) else []
    prem = _premium()
    if prem and prem.is_available():
        if cfg.get("pub_data_bridge_enabled"):
            tools = tools + prem.list_tools()
        cfg = prem.resolve_pub_cfg(cfg)
    cli_provider = next((p for p in desk.CLI_PROVIDERS if p["id"] == cfg.get("provider")), None)
    if cli_provider:
        cli_messages = _cli_flatten_messages(body.messages, tools)
        r = await desk.cli_chat(
            desk.CliChatRequest(provider_id=cli_provider["id"], messages=cli_messages, model=cfg.get("model") or ""),
            session=None,
        )
        data = json.loads(r.body)
        if r.status_code >= 400:
            return JSONResponse({"error": data.get("error") or "CLI provider error"}, status_code=r.status_code)

        content = data.get("content", "")
        msg = {"role": "assistant", "content": content}
        valid_names = {spec["function"]["name"] for spec in tools}
        m = _CLI_TOOL_CALL_RE.search(content) if valid_names else None
        if m:
            try:
                parsed = json.loads(m.group(1))
                name = str(parsed.get("name") or "")
                arguments = parsed.get("arguments") or {}
            except Exception:
                name = ""
            if name in valid_names:
                rest = (content[:m.start()] + content[m.end():]).strip()
                msg = {
                    "role": "assistant",
                    "content": rest or None,
                    "tool_calls": [{
                        "id": "cli-call-1",
                        "type": "function",
                        "function": {"name": name, "arguments": json.dumps(arguments)},
                    }],
                }

        if price:
            try:
                hub.charge_credit_feature(me["id"], APP_ID, "chat_message", "mvmAI chat message")
            except hub.CreditError:
                return JSONResponse({"error": "insufficient_credits", "price": price}, status_code=402)
        sid = _persist_turn(me["id"], body.session_id, body.messages, msg)
        return JSONResponse({"session_id": sid, "message": msg})

    pid, base_url, api_key, model = desk._resolve_provider(cfg)
    if not base_url:
        return JSONResponse({"error": "mvmAI is not configured yet."}, status_code=400)
    if desk.PROVIDERS.get(pid, {}).get("needs_key", True) and not api_key:
        return JSONResponse({"error": "mvmAI is not configured yet."}, status_code=400)

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    url = base_url + "chat/completions"

    async def _post(with_tools: bool):
        p = {"model": model, "messages": body.messages}
        if with_tools and tools:
            p["tools"] = tools
            p["tool_choice"] = "auto"
        async with httpx.AsyncClient(timeout=120) as client:
            return await client.post(url, headers=headers, json=p)

    try:
        r = await _post(bool(tools))
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

    if price:
        try:
            hub.charge_credit_feature(me["id"], APP_ID, "chat_message", "mvmAI chat message")
        except hub.CreditError:
            return JSONResponse({"error": "insufficient_credits", "price": price}, status_code=402)

    sid = _persist_turn(me["id"], body.session_id, body.messages, msg)
    return JSONResponse({"session_id": sid, "message": msg})


class ExecSettingsRequest(BaseModel):
    enabled: bool
    auto: bool = False


@router.get("/exec-settings")
async def get_exec_settings(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me or not me.get("is_admin"):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    desk = _desktop()
    if desk is None:
        return JSONResponse({"error": "mvmAI is not available"}, status_code=500)
    cfg = desk._read_cfg()
    return JSONResponse({
        "enabled": bool(cfg.get("pub_exec_enabled")),
        "auto": bool(cfg.get("pub_exec_auto")),
    })


@router.post("/exec-settings")
async def set_exec_settings(body: ExecSettingsRequest, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me or not me.get("is_admin"):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    desk = _desktop()
    if desk is None:
        return JSONResponse({"error": "mvmAI is not available"}, status_code=500)
    desk._write_cfg("pub_exec_enabled", bool(body.enabled))
    desk._write_cfg("pub_exec_auto", bool(body.auto))
    return JSONResponse({"ok": True})


class ExecRequest(BaseModel):
    command: str
    confirmed: bool = False


@router.post("/exec")
async def exec_command(body: ExecRequest, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me or not me.get("is_admin"):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    desk = _desktop()
    if desk is None:
        return JSONResponse({"error": "mvmAI is not available"}, status_code=500)

    cfg = desk._read_cfg()
    exec_enabled = bool(cfg.get("pub_exec_enabled"))
    exec_auto = bool(cfg.get("pub_exec_auto"))
    cmd = body.command.strip()
    if not cmd:
        return JSONResponse({"error": "Empty command"}, status_code=400)

    if not exec_enabled:
        return JSONResponse({
            "blocked": True,
            "is_dangerous": False,
            "reason": "Command execution is turned off. Turn it on from the exec toggle in the chat sidebar.",
        })

    danger = desk._is_dangerous(cmd)
    needs_confirm = not exec_auto
    if needs_confirm and not body.confirmed:
        return JSONResponse({"pending": True, "is_dangerous": danger})

    # The public page has no mvmOS OS session to take an effective_user from —
    # this endpoint is already admin-only, so it runs as the server owner
    # (uvicorn's own user, root), the same reach the desktop terminal has.
    try:
        proc = subprocess.run(
            ["/bin/bash", "-lc", cmd], capture_output=True, text=True, timeout=120,
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


class ToolCallRequest(BaseModel):
    name: str
    arguments: dict = {}


@router.post("/tool-call")
async def tool_call(body: ToolCallRequest, x_pub_token: str = Header(default=None)):
    """Dispatches one personal-data bridge tool call. Never used for
    run_command — that stays the dedicated, admin-only /exec endpoint.
    user_id is always the caller's own session id, resolved here from the
    token and never taken from the request body, so no argument the model or
    a tampered client sends can reach another user's data."""
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    prem = _premium()
    if not prem or not prem.is_available():
        return JSONResponse({"error": "not_available"}, status_code=403)
    desk = _desktop()
    if desk is None or not desk._read_cfg().get("pub_data_bridge_enabled"):
        return JSONResponse({"error": "not_available"}, status_code=403)
    try:
        result = prem.call_tool(me["id"], body.name, body.arguments or {})
        return JSONResponse({"result": result})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
