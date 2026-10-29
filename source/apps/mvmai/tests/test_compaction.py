"""Provider confirmation and per-chat serialization without paid API calls."""

import ast
import asyncio
import importlib.util
import json
import os
import hashlib
import re
import sqlite3
import time
import uuid
from pathlib import Path
import tempfile
import types
import unittest

from fastapi.responses import JSONResponse


ROOT = Path(__file__).resolve().parents[3]


def functions(path, names, namespace):
    nodes = [n for n in ast.parse((ROOT / path).read_text()).body
             if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), path, "exec"), namespace)


class ClaudeTests(unittest.TestCase):
    def test_only_matching_boundary_and_success_confirm_compaction(self):
        ns = {"json": json, "JSONResponse": JSONResponse}
        functions("backend/apps/mvmai/backend.py", {"_claude_compaction_result"}, ns)
        boundary = {"type": "system", "subtype": "compact_boundary", "session_id": "original"}
        success = {"type": "result", "subtype": "success", "session_id": "original"}
        for events, code, expected in [
            ([boundary, success], 0, 200),
            ([success], 0, 502),  # CLI can report success for an unavailable command.
            ([boundary, {**success, "is_error": True}], 0, 502),
            ([boundary, success], 1, 502),
            ([{**boundary, "session_id": "other"}, success], 0, 502),
            ([boundary], 0, 502),
        ]:
            proc = types.SimpleNamespace(stdout="\n".join(map(json.dumps, events)), returncode=code)
            self.assertEqual(ns["_claude_compaction_result"](proc, "original").status_code, expected)


class LockTests(unittest.IsolatedAsyncioTestCase):
    async def test_next_turn_waits_until_maintenance_finishes(self):
        entered, release, order = asyncio.Event(), asyncio.Event(), []

        async def run(body, *args):
            order.append(body.name)
            if body.compact_cli:
                entered.set()
                await release.wait()

        ns = {"ChatRequest": object, "asyncio": asyncio, "_CHAT_LOCKS": {}, "_chat_unlocked": run}
        functions("apps/mvmai/api.py", {"_chat"}, ns)
        maintenance = types.SimpleNamespace(session_id="chat", no_persist=True, compact_cli=True, name="compact")
        message = types.SimpleNamespace(session_id="chat", no_persist=False, compact_cli=False, name="message")
        first = asyncio.create_task(ns["_chat"](maintenance, None, "", None))
        await entered.wait()
        second = asyncio.create_task(ns["_chat"](message, None, "", None))
        await asyncio.sleep(0)
        self.assertEqual(order, ["compact"])
        # Title generation does not advance the session and must not deadlock
        # behind the main answer that scheduled it.
        title = types.SimpleNamespace(session_id="chat", no_persist=True, compact_cli=False, name="title")
        await ns["_chat"](title, None, "", None)
        release.set()
        await asyncio.gather(first, second)
        self.assertEqual(order, ["compact", "title", "message"])


class CodexTests(unittest.TestCase):
    def test_acknowledgement_is_not_completion_and_session_is_preserved(self):
        spec = importlib.util.spec_from_file_location("compaction", ROOT / "backend/apps/mvmai/compaction.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        desk = types.SimpleNamespace(_wrap_as_user=lambda cmd, user: cmd,
                                     _cli_search_path=lambda home: os.environ["PATH"])
        with tempfile.TemporaryDirectory() as folder:
            executable = Path(folder) / "codex"
            for mode in ("success", "ack_only", "failed", "different_session"):
                executable.write_text('''#!/usr/bin/env python3
import json, sys
mode = MODE
def emit(event):
    print(json.dumps(event), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    method = request['method']
    if method == 'initialize':
        emit({'id': 1, 'result': {}})
    elif method == 'thread/resume':
        assert request['params']['sandbox'] == 'read-only'
        assert request['params']['threadId'] == 'original'
        emit({'id': 2, 'result': {'thread': {'id': 'other' if mode == 'different_session' else 'original'}}})
    elif method == 'thread/compact/start':
        assert request['params']['threadId'] == 'original'
        emit({'id': 3, 'result': {}})
        if mode == 'ack_only':
            break
        emit({'method': 'turn/started', 'params': {'threadId': 'original', 'turn': {'id': 'compact'}}})
        emit({'method': 'item/completed', 'params': {'threadId': 'original', 'item': {'type': 'contextCompaction'}}})
        emit({'method': 'turn/completed', 'params': {'threadId': 'original', 'turn': {'id': 'compact', 'status': 'failed' if mode == 'failed' else 'completed'}}})
'''.replace("MODE", repr(mode)))
                executable.chmod(0o700)
                if mode == "success":
                    module.compact_codex(desk, ("test", folder, str(executable)), "original", folder, "")
                else:
                    with self.assertRaises(RuntimeError):
                        module.compact_codex(desk, ("test", folder, str(executable)), "original", folder, "")


class MaintenanceTests(unittest.IsolatedAsyncioTestCase):
    async def test_owned_current_session_only_and_failure_keeps_state(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE pub_sessions (id, user_id, project_id, provider, model, cli_state, archived_at)")
        conn.execute("CREATE TABLE pub_messages (session_id, role, content, tool_calls, seq)")
        ns = {"ChatRequest": object, "asyncio": asyncio, "json": json, "hashlib": hashlib,
              "re": re, "time": time, "uuid": uuid, "JSONResponse": JSONResponse,
              "_CLI_REPLAY_CHARS": 60000, "_sdb": lambda: conn,
              "_archive_stale": lambda *args: None, "_hub": lambda: None,
              "_premium": lambda: None, "_safe_download_content": lambda user, text: text,
              "_language_prompt": lambda lang: "Keep the user's language."}
        functions("apps/mvmai/api.py", {"_chat_unlocked", "_parse_cli_state", "_msg_fingerprint",
                  "_unseen_messages", "_cli_flatten_messages", "_cap_conversation", "_chat_reply"}, ns)
        last = {"role": "assistant", "content": "Original answer"}
        state = {"session_id": "12345678-abcd", "user": "test", "last": ns["_msg_fingerprint"](last)}
        conn.execute("INSERT INTO pub_sessions VALUES (?,?,?,?,?,?,?)",
                     ("a" * 32, "owner", None, "claude-cli", "haiku", json.dumps(state), None))
        conn.execute("INSERT INTO pub_messages VALUES (?,?,?,?,?)", ("a" * 32, "assistant", last["content"], None, 0))
        conn.commit()
        calls = []
        native_status = 200

        async def run(body, **kwargs):
            calls.append(kwargs)
            return JSONResponse({"compacted": True} if kwargs.get("native_compact") else {"content": "Summary"},
                                status_code=native_status if kwargs.get("native_compact") else 200)

        desk = types.SimpleNamespace(
            _read_cfg=lambda: {"provider": "claude-cli", "model": "haiku"},
            CLI_PROVIDERS=[{"id": "claude-cli"}], CliChatRequest=lambda **kw: types.SimpleNamespace(**kw),
            _run_cli_chat=run, _resolve_cli_runtime=lambda *args: ("test", "/tmp", "claude"),
            _SESSION_ID_RE=re.compile(r"[0-9a-fA-F-]{8,64}"), _server_tools=lambda *args: [])
        ns["_desktop"] = lambda: desk
        body = types.SimpleNamespace(session_id="a" * 32, no_persist=True, compact_cli=True, compact_last=last,
                                     project_id=None, project_model=None, messages=[{"role": "user", "content": "Summarize"}],
                                     app_id=None, lang="en", elapsed_ms=0)
        for status in (200, 502):
            native_status = status
            calls.clear()
            result = await ns["_chat_unlocked"](body, None, "", None, {"id": "owner", "is_admin": False})
            self.assertEqual(result.status_code, status)
            self.assertEqual(len(calls), 2)
            self.assertIsNone(calls[0]["cli_resume"])
            self.assertTrue(calls[1]["native_compact"])
            self.assertEqual(calls[1]["cli_resume"]["session_id"], state["session_id"])
            self.assertEqual(json.loads(conn.execute("SELECT cli_state FROM pub_sessions").fetchone()[0]), state)
        for user, expected in [("other", 409), ("owner", 409)]:
            body.compact_last = {"role": "assistant", "content": "Outdated answer"}
            calls.clear()
            result = await ns["_chat_unlocked"](body, None, "", None, {"id": user, "is_admin": False})
            self.assertEqual(result.status_code, expected)
            self.assertFalse(calls)
        conn.close()


if __name__ == "__main__":
    unittest.main()
