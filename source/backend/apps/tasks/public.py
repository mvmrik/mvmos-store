"""
mvmOS Tasks — persistent / one-time / periodic tasks per Apps Hub account,
optionally rewarding (or penalizing) a Budget category on completion.

Mounted at /pub/tasks by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header) — used identically by the in-app mvmOS window and
by the standalone public page, so there is no separate backend.py (same
reasoning as backend/apps/budget/public.py).

Tasks are always private to their owner — no sharing, unlike Budget
categories. Three types:
  - persistent: never expires, can be completed repeatedly at will. Either
    'fixed' (flat reward per completion) or 'hourly' (user starts/stops a
    timer, reward = elapsed hours * reward_amount rate).
  - onetime: has a due_at; completing it permanently marks it done.
  - periodic: recurs daily/weekly/monthly; "done" for the current period is
    derived from the completions ledger (latest completion's period bucket
    vs now's), never stored — same "derive, don't cache" approach Budget
    uses for category balances.

Budget integration is opt-in per user (settings.budget_integration) and
per-task (task.category_id). Reward application goes through
hub.call_app_api("budget", "add_to_category", ...) — Tasks has zero
knowledge of Budget's schema, only of the generic app-to-app API contract.
If Budget isn't installed or its API isn't enabled, the task still
completes normally; the reward is just skipped (recorded as budget_ok=0 in
the completions ledger) rather than failing the whole action.
"""

import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "tasks"

_DIR        = os.path.dirname(__file__)                              # backend/apps/tasks
_DB_PATH    = os.path.join(_DIR, "..", "..", "..", "apps", "tasks", "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "..", "..", "..", "apps", "tasks", "public")

TYPES        = {"persistent", "onetime", "periodic"}
REWARD_MODES = {"fixed", "hourly"}
PERIODS      = {"daily", "weekly", "monthly"}


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                id                TEXT PRIMARY KEY,
                user_id           TEXT NOT NULL,
                title             TEXT NOT NULL,
                description       TEXT NOT NULL DEFAULT '',
                type              TEXT NOT NULL,
                reward_mode       TEXT NOT NULL DEFAULT 'fixed',
                reward_amount     REAL,
                category_id       TEXT,
                due_at            TEXT,
                period            TEXT,
                timer_started_at  TEXT,
                completed_at      TEXT,
                archived          INTEGER NOT NULL DEFAULT 0,
                created_at        TEXT NOT NULL,
                updated_at        TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, archived);

            CREATE TABLE IF NOT EXISTS completions (
                id              TEXT PRIMARY KEY,
                task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                user_id         TEXT NOT NULL,
                amount          REAL NOT NULL DEFAULT 0,
                duration_hours  REAL,
                budget_ok       INTEGER NOT NULL DEFAULT 0,
                note            TEXT NOT NULL DEFAULT '',
                created_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_completions_task ON completions(task_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_completions_user ON completions(user_id, created_at);

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id             TEXT PRIMARY KEY,
                budget_integration  INTEGER NOT NULL DEFAULT 0
            );
        """)
        conn.commit()


_init_db()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Tasks</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Tasks is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


# ── Period-bucket helpers (periodic "done this period" is derived, never stored) ──

def _period_key(dt: datetime, period: str) -> str:
    if period == "daily":
        return dt.strftime("%Y-%m-%d")
    if period == "weekly":
        y, w, _ = dt.isocalendar()
        return f"{y}-W{w:02d}"
    if period == "monthly":
        return dt.strftime("%Y-%m")
    return ""


def _row_to_task(conn, row, now: datetime) -> dict:
    d = dict(row)
    if d["type"] == "periodic":
        last = conn.execute(
            "SELECT created_at FROM completions WHERE task_id=? ORDER BY created_at DESC LIMIT 1",
            (d["id"],),
        ).fetchone()
        d["done_this_period"] = bool(
            last and _period_key(datetime.fromisoformat(last["created_at"]), d["period"]) == _period_key(now, d["period"])
        )
    elif d["type"] == "onetime":
        d["completed"] = bool(d.get("completed_at"))
        d["overdue"] = bool(d.get("due_at") and not d["completed"] and d["due_at"] < now.isoformat())
    elif d["type"] == "persistent":
        d["timer_running"] = bool(d.get("timer_started_at"))
        if d["timer_running"]:
            started = datetime.fromisoformat(d["timer_started_at"])
            d["elapsed_seconds"] = max(0.0, (now - started).total_seconds())
    return d


def _apply_reward(hub, user_id: str, category_id: Optional[str], amount: Optional[float],
                   reason: str, idempotency_key: str) -> dict:
    """Best-effort: task completion always succeeds even if this fails —
    Budget not being installed/enabled is a normal, expected outcome."""
    if not category_id or not amount:
        return {"budget_ok": False, "amount": 0.0}
    if hub is None:
        return {"budget_ok": False, "amount": amount}
    try:
        hub.call_app_api("budget", "add_to_category", user_id, category_id, amount,
                          reason=reason, idempotency_key=idempotency_key)
        return {"budget_ok": True, "amount": amount}
    except Exception:
        return {"budget_ok": False, "amount": amount}


# ── Settings ─────────────────────────────────────────────────────

class SettingsBody(BaseModel):
    budget_integration: bool


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute(
            "SELECT budget_integration FROM user_settings WHERE user_id=?", (me["id"],)
        ).fetchone()
        return JSONResponse({
            "id": me["id"],
            "budget_integration": bool(row["budget_integration"]) if row else False,
        })


@router.put("/me/settings")
async def set_my_settings(body: SettingsBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        conn.execute(
            "INSERT INTO user_settings(user_id,budget_integration) VALUES(?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET budget_integration=excluded.budget_integration",
            (me["id"], 1 if body.budget_integration else 0),
        )
        conn.commit()
    return JSONResponse({"budget_integration": body.budget_integration})


@router.get("/budget-categories")
async def budget_categories(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    if hub is None:
        return JSONResponse({"available": False, "categories": []})
    try:
        cats = hub.call_app_api("budget", "list_categories", me["id"])
        return JSONResponse({"available": True, "categories": cats})
    except Exception:
        return JSONResponse({"available": False, "categories": []})


# ── Tasks ────────────────────────────────────────────────────────

class TaskBody(BaseModel):
    title:          str
    description:    str = ""
    type:           str
    reward_mode:    str = "fixed"
    reward_amount:  Optional[float] = None
    category_id:    Optional[str] = None
    due_at:         Optional[str] = None
    period:         Optional[str] = None


def _validate_task(body: "TaskBody") -> Optional[str]:
    if body.type not in TYPES:
        return "invalid type"
    if body.type == "persistent":
        if body.reward_mode not in REWARD_MODES:
            return "invalid reward_mode"
        if body.due_at or body.period:
            return "due_at/period not applicable to persistent tasks"
    elif body.type == "onetime":
        if not body.due_at:
            return "due_at required"
        if body.period:
            return "period not applicable to onetime tasks"
    elif body.type == "periodic":
        if body.period not in PERIODS:
            return "invalid period"
        if body.due_at:
            return "due_at not applicable to periodic tasks"
    if body.category_id and (body.reward_amount is None or body.reward_amount == 0):
        return "reward_amount required when a category is selected"
    if body.reward_amount is not None and body.reward_amount == 0:
        return "reward_amount must be non-zero"
    return None


@router.get("/tasks")
async def list_tasks(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    now = _now()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE user_id=? AND archived=0 ORDER BY created_at", (me["id"],)
        ).fetchall()
        return JSONResponse([_row_to_task(conn, r, now) for r in rows])


@router.post("/tasks")
async def create_task(body: TaskBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    err = _validate_task(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)

    reward_mode = body.reward_mode if body.type == "persistent" else "fixed"
    now = _now_iso()
    tid = str(uuid.uuid4())
    with _db() as conn:
        conn.execute(
            "INSERT INTO tasks(id,user_id,title,description,type,reward_mode,reward_amount,"
            "category_id,due_at,period,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, me["id"], title, body.description.strip()[:1000], body.type, reward_mode,
             body.reward_amount, body.category_id, body.due_at, body.period, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, _now()))


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    err = _validate_task(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)

    reward_mode = body.reward_mode if body.type == "persistent" else "fixed"
    with _db() as conn:
        existing = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, me["id"])).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE tasks SET title=?, description=?, type=?, reward_mode=?, reward_amount=?, "
            "category_id=?, due_at=?, period=?, updated_at=? WHERE id=?",
            (title, body.description.strip()[:1000], body.type, reward_mode, body.reward_amount,
             body.category_id, body.due_at, body.period, _now_iso(), task_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, _now()))


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        existing = conn.execute("SELECT id FROM tasks WHERE id=? AND user_id=?", (task_id, me["id"])).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Completion / timer ──────────────────────────────────────────

@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, me["id"])).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        task = _row_to_task(conn, row, now)

        if task["type"] == "persistent" and task["reward_mode"] == "hourly":
            return JSONResponse({"error": "use the timer for hourly tasks"}, status_code=400)
        if task["type"] == "onetime" and task["completed"]:
            return JSONResponse({"error": "already completed"}, status_code=400)
        if task["type"] == "periodic" and task["done_this_period"]:
            return JSONResponse({"error": "already completed for this period"}, status_code=400)

        hub = _hub()
        cid = str(uuid.uuid4())
        reward = _apply_reward(
            hub, me["id"], task["category_id"], task["reward_amount"],
            f"Задача: {task['title']}", cid,
        )
        conn.execute(
            "INSERT INTO completions(id,task_id,user_id,amount,duration_hours,budget_ok,note,created_at) "
            "VALUES(?,?,?,?,NULL,?,?,?)",
            (cid, task_id, me["id"], reward["amount"], 1 if reward["budget_ok"] else 0, "", now.isoformat()),
        )
        if task["type"] == "onetime":
            conn.execute("UPDATE tasks SET completed_at=?, updated_at=? WHERE id=?", (now.isoformat(), now.isoformat(), task_id))
        else:
            conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now.isoformat(), task_id))
        conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        result = _row_to_task(conn, row, now)
        result["reward"] = reward
        return JSONResponse(result)


@router.post("/tasks/{task_id}/timer/start")
async def start_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, me["id"])).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["type"] != "persistent" or row["reward_mode"] != "hourly":
            return JSONResponse({"error": "not an hourly task"}, status_code=400)
        if row["timer_started_at"]:
            return JSONResponse({"error": "timer already running"}, status_code=400)
        now = _now_iso()
        conn.execute("UPDATE tasks SET timer_started_at=?, updated_at=? WHERE id=?", (now, now, task_id))
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, _now()))


@router.post("/tasks/{task_id}/timer/stop")
async def stop_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, me["id"])).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["type"] != "persistent" or row["reward_mode"] != "hourly":
            return JSONResponse({"error": "not an hourly task"}, status_code=400)
        if not row["timer_started_at"]:
            return JSONResponse({"error": "timer not running"}, status_code=400)

        started = datetime.fromisoformat(row["timer_started_at"])
        elapsed_hours = max(0.0, (now - started).total_seconds() / 3600)
        amount = round(row["reward_amount"] * elapsed_hours, 2) if row["reward_amount"] else None

        hub = _hub()
        cid = str(uuid.uuid4())
        reward = _apply_reward(hub, me["id"], row["category_id"], amount, f"Задача: {row['title']}", cid)
        conn.execute(
            "INSERT INTO completions(id,task_id,user_id,amount,duration_hours,budget_ok,note,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (cid, task_id, me["id"], reward["amount"], round(elapsed_hours, 4),
             1 if reward["budget_ok"] else 0, "", now.isoformat()),
        )
        conn.execute("UPDATE tasks SET timer_started_at=NULL, updated_at=? WHERE id=?", (now.isoformat(), task_id))
        conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        result = _row_to_task(conn, row, now)
        result["reward"] = reward
        result["duration_hours"] = round(elapsed_hours, 4)
        return JSONResponse(result)


# ── History ──────────────────────────────────────────────────────

@router.get("/history")
async def history(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT c.*, t.title AS task_title FROM completions c "
            "JOIN tasks t ON t.id=c.task_id WHERE c.user_id=? ORDER BY c.created_at DESC LIMIT 200",
            (me["id"],),
        ).fetchall()
        return JSONResponse([dict(r) for r in rows])
