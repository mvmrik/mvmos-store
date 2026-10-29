"""Compact an existing Codex thread; never create or replace one."""

import json
import os
import selectors
import subprocess
import time


def compact_codex(desk, runtime, session_id, cwd, model):
    user, home, executable = runtime
    process = subprocess.Popen(
        desk._wrap_as_user([executable, "app-server"], user),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        cwd=cwd, env={**os.environ, "HOME": home, "USER": user, "LOGNAME": user,
                      "PATH": desk._cli_search_path(home)},
    )
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    pending = b""
    deadline = time.monotonic() + 180
    turn_id = None
    compacted = False

    def send(value):
        process.stdin.write((json.dumps(value) + "\n").encode())
        process.stdin.flush()

    try:
        send({"id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "mvmai_compaction", "version": "1.0"}}})
        while time.monotonic() < deadline:
            if not selector.select(max(0, deadline - time.monotonic())):
                break
            chunk = os.read(process.stdout.fileno(), 65536)
            if not chunk:
                break
            pending += chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                event = json.loads(line)
                if event.get("error"):
                    raise RuntimeError("Codex context compaction failed.")
                if event.get("id") == 1:
                    send({"method": "initialized"})
                    # Loading the saved thread does not start a model turn.
                    send({"id": 2, "method": "thread/resume", "params": {
                        "threadId": session_id, "cwd": cwd,
                        "approvalPolicy": "never", "sandbox": "read-only",
                        **({"model": model} if model else {}),
                    }})
                elif event.get("id") == 2:
                    thread = event.get("result", {}).get("thread", {})
                    if thread.get("id") != session_id:
                        raise RuntimeError("Codex returned a different session.")
                    send({"id": 3, "method": "thread/compact/start", "params": {"threadId": session_id}})
                params = event.get("params") or {}
                if params.get("threadId") != session_id:
                    continue
                method = event.get("method")
                if method == "turn/started":
                    turn_id = (params.get("turn") or {}).get("id")
                elif method == "item/completed" and (params.get("item") or {}).get("type") == "contextCompaction":
                    compacted = True
                elif method == "turn/completed":
                    turn = params.get("turn") or {}
                    if turn.get("id") == turn_id and turn.get("status") == "completed" and compacted:
                        return
                    raise RuntimeError("Codex context compaction was not confirmed.")
        raise RuntimeError("Codex context compaction timed out.")
    finally:
        selector.close()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        process.stdin.close()
        process.stdout.close()
