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

_DIR        = os.path.dirname(__file__)                                    # apps/tasks
_DB_PATH    = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")

TYPES        = {"persistent", "onetime", "periodic", "todo"}
REWARD_MODES = {"fixed", "hourly"}
PERIODS      = {"daily", "weekly", "monthly"}
TODO_ITEM_MAX = 2000


def _hub():
    return sys.modules.get("backend.apphub")


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
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

            CREATE TABLE IF NOT EXISTS task_categories (
                task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                category_id TEXT NOT NULL,
                PRIMARY KEY (task_id, category_id)
            );
            CREATE INDEX IF NOT EXISTS idx_task_categories_task ON task_categories(task_id);

            CREATE TABLE IF NOT EXISTS completion_rewards (
                id            TEXT PRIMARY KEY,
                completion_id TEXT NOT NULL REFERENCES completions(id) ON DELETE CASCADE,
                category_id   TEXT NOT NULL,
                amount        REAL NOT NULL,
                budget_ok     INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_completion_rewards_completion ON completion_rewards(completion_id);

            CREATE TABLE IF NOT EXISTS projects (
                id              TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                title           TEXT NOT NULL,
                position        INTEGER NOT NULL DEFAULT 0,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, position);

            CREATE TABLE IF NOT EXISTS todo_items (
                id           TEXT PRIMARY KEY,
                task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                title        TEXT NOT NULL,
                position     INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                created_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_todo_items_task ON todo_items(task_id, position);
        """)
        # A timed task can be paused and resumed. Keep the completed segments
        # separately from the currently running segment so a restart never
        # turns a pause into either lost time or an accidental completion.
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tasks)")}
        if "timer_elapsed_seconds" not in cols:
            conn.execute(
                "ALTER TABLE tasks ADD COLUMN timer_elapsed_seconds REAL NOT NULL DEFAULT 0"
            )
        if "project_id" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN project_id TEXT")
        # Subprojects: a project with a parent_id is shown nested inside its
        # parent. NULL means a top-level project.
        pcols = {r[1] for r in conn.execute("PRAGMA table_info(projects)")}
        if "parent_id" not in pcols:
            conn.execute("ALTER TABLE projects ADD COLUMN parent_id TEXT")
        # One-time-per-startup, idempotent backfill: tasks created before the
        # move to many-to-many categories only had a single category_id column.
        conn.execute(
            "INSERT OR IGNORE INTO task_categories(task_id, category_id) "
            "SELECT id, category_id FROM tasks WHERE category_id IS NOT NULL AND category_id != ''"
        )
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


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Tasks", "✅")
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


def _task_category_ids(conn, task_id: str) -> list:
    rows = conn.execute(
        "SELECT category_id FROM task_categories WHERE task_id=? ORDER BY rowid", (task_id,)
    ).fetchall()
    return [r["category_id"] for r in rows]


def _set_task_categories(conn, task_id: str, category_ids: list):
    conn.execute("DELETE FROM task_categories WHERE task_id=?", (task_id,))
    for cid in dict.fromkeys(category_ids or []):  # dedupe, keep order
        conn.execute(
            "INSERT OR IGNORE INTO task_categories(task_id,category_id) VALUES(?,?)", (task_id, cid)
        )


def _row_to_task(conn, row, now: datetime) -> dict:
    d = dict(row)
    d.pop("category_id", None)
    d["category_ids"] = _task_category_ids(conn, d["id"])
    if d["type"] == "todo":
        counts = conn.execute(
            "SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done "
            "FROM todo_items WHERE task_id=?", (d["id"],),
        ).fetchone()
        d["todo_total"] = counts["total"] or 0
        d["todo_done"] = counts["done"] or 0
    elif d["type"] == "periodic":
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
        elapsed = float(d.get("timer_elapsed_seconds") or 0)
        if d["timer_running"]:
            started = datetime.fromisoformat(d["timer_started_at"])
            elapsed += max(0.0, (now - started).total_seconds())
        d["elapsed_seconds"] = elapsed
        d["timer_paused"] = not d["timer_running"] and elapsed > 0
    return d


def _apply_reward(hub, user_id: str, category_ids: list, amount: Optional[float],
                   reason: str, idempotency_key_base: str) -> list:
    """Best-effort: task completion always succeeds even if this fails —
    Budget not being installed/enabled is a normal, expected outcome. The
    full amount is applied to EACH selected category independently (not
    split/divided among them) — each gets its own add_to_category call and
    its own idempotency key so a retry doesn't double-charge any one of
    them."""
    if not category_ids or not amount:
        return []
    results = []
    for category_id in category_ids:
        if hub is None:
            results.append({"category_id": category_id, "budget_ok": False, "amount": amount})
            continue
        try:
            hub.call_app_api("budget", "add_to_category", user_id, category_id, amount,
                              source_app="tasks", source_app_name="Tasks",
                              reason=reason, idempotency_key=f"{idempotency_key_base}:{category_id}")
            results.append({"category_id": category_id, "budget_ok": True, "amount": amount})
        except Exception:
            results.append({"category_id": category_id, "budget_ok": False, "amount": amount})
    return results


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
        try:
            currency = hub.call_app_api("budget", "get_currency", me["id"])
        except Exception:
            currency = None
        return JSONResponse({"available": True, "categories": cats, "currency": currency})
    except Exception:
        return JSONResponse({"available": False, "categories": []})


# ── Projects ─────────────────────────────────────────────────────
# Purely an organizational grouping (accordion sections in the UI) — unrelated
# to Budget category_ids above, which control the reward/penalty on completion.

class ProjectBody(BaseModel):
    title: str
    parent_id: Optional[str] = None


def _list_projects(user_id: str):
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM projects WHERE user_id=? ORDER BY position", (user_id,)
        ).fetchall()
        return JSONResponse([dict(r) for r in rows])


@router.get("/projects")
async def list_projects(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _list_projects(me["id"])


def _create_project(user_id: str, body: ProjectBody):
    title = body.title.strip()[:100]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    now = _now_iso()
    pid = str(uuid.uuid4())
    with _db() as conn:
        if body.parent_id and not _project_exists(conn, user_id, body.parent_id):
            return JSONResponse({"error": "invalid parent project"}, status_code=400)
        maxpos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) AS m FROM projects WHERE user_id=?", (user_id,)
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO projects(id,user_id,parent_id,title,position,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (pid, user_id, body.parent_id or None, title, maxpos + 1, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
        return JSONResponse(dict(row))


@router.post("/projects")
async def create_project(body: ProjectBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _create_project(me["id"], body)


class ProjectReorderBody(BaseModel):
    order: list[str]


@router.put("/projects/reorder")
async def reorder_projects(body: ProjectReorderBody, x_pub_token: str = Header(default=None)):
    """The accordion always opens whichever project is first in this order —
    there is no separate default-open flag to keep in sync.

    Registered ahead of PUT /projects/{project_id} below: that dynamic route
    would otherwise swallow "reorder" as a project_id and never let this one
    match."""
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute("SELECT id FROM projects WHERE user_id=?", (me["id"],)).fetchall()
        existing_ids = {r["id"] for r in rows}
        if set(body.order) != existing_ids or len(body.order) != len(existing_ids):
            return JSONResponse({"error": "order must list every project exactly once"}, status_code=400)
        now = _now_iso()
        for i, pid in enumerate(body.order):
            conn.execute("UPDATE projects SET position=?, updated_at=? WHERE id=? AND user_id=?", (i, now, pid, me["id"]))
        conn.commit()
        rows = conn.execute("SELECT * FROM projects WHERE user_id=? ORDER BY position", (me["id"],)).fetchall()
        return JSONResponse([dict(r) for r in rows])


def _rename_project(user_id: str, project_id: str, body: ProjectBody):
    """Renames only — parent_id in the body is ignored, a project keeps its
    place in the tree."""
    title = body.title.strip()[:100]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    with _db() as conn:
        existing = conn.execute("SELECT id FROM projects WHERE id=? AND user_id=?", (project_id, user_id)).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE projects SET title=?, updated_at=? WHERE id=?", (title, _now_iso(), project_id)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        return JSONResponse(dict(row))


@router.put("/projects/{project_id}")
async def rename_project(project_id: str, body: ProjectBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _rename_project(me["id"], project_id, body)


def _delete_project(user_id: str, project_id: str):
    """Nothing inside the project is deleted: its tasks and subprojects move
    up one level, to its parent project (or to no project at the top)."""
    with _db() as conn:
        existing = conn.execute("SELECT id, parent_id FROM projects WHERE id=? AND user_id=?", (project_id, user_id)).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        parent = existing["parent_id"]
        conn.execute("UPDATE tasks SET project_id=? WHERE project_id=? AND user_id=?", (parent, project_id, user_id))
        conn.execute("UPDATE projects SET parent_id=? WHERE parent_id=? AND user_id=?", (parent, project_id, user_id))
        conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _delete_project(me["id"], project_id)


# ── Tasks ────────────────────────────────────────────────────────

class TaskBody(BaseModel):
    title:          str
    description:    str = ""
    type:           str
    reward_mode:    str = "fixed"
    reward_amount:  Optional[float] = None
    category_ids:   list[str] = []
    due_at:         Optional[str] = None
    period:         Optional[str] = None
    project_id:     Optional[str] = None


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
    elif body.type == "todo":
        if body.due_at or body.period:
            return "due_at/period not applicable to todo tasks"
        if body.category_ids or body.reward_amount is not None:
            return "rewards not applicable to todo tasks"
    if body.category_ids and (body.reward_amount is None or body.reward_amount == 0):
        return "reward_amount required when a category is selected"
    if body.reward_amount is not None and body.reward_amount == 0:
        return "reward_amount must be non-zero"
    return None


def _project_exists(conn, user_id: str, project_id: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM projects WHERE id=? AND user_id=?", (project_id, user_id)
    ).fetchone())


def _list_tasks(user_id: str):
    now = _now()
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE user_id=? AND archived=0 ORDER BY created_at", (user_id,)
        ).fetchall()
        return JSONResponse([_row_to_task(conn, r, now) for r in rows])


@router.get("/tasks")
async def list_tasks(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _list_tasks(me["id"])


def _create_task(user_id: str, body: TaskBody):
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
        if body.project_id and not _project_exists(conn, user_id, body.project_id):
            return JSONResponse({"error": "invalid project"}, status_code=400)
        conn.execute(
            "INSERT INTO tasks(id,user_id,title,description,type,reward_mode,reward_amount,"
            "due_at,period,project_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, user_id, title, body.description.strip()[:1000], body.type, reward_mode,
             body.reward_amount, body.due_at, body.period, body.project_id, now, now),
        )
        _set_task_categories(conn, tid, body.category_ids)
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, _now()))


@router.post("/tasks")
async def create_task(body: TaskBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _create_task(me["id"], body)


def _update_task(user_id: str, task_id: str, body: TaskBody):
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    err = _validate_task(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)

    reward_mode = body.reward_mode if body.type == "persistent" else "fixed"
    with _db() as conn:
        existing = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        if body.project_id and not _project_exists(conn, user_id, body.project_id):
            return JSONResponse({"error": "invalid project"}, status_code=400)
        conn.execute(
            "UPDATE tasks SET title=?, description=?, type=?, reward_mode=?, reward_amount=?, "
            "due_at=?, period=?, project_id=?, updated_at=? WHERE id=?",
            (title, body.description.strip()[:1000], body.type, reward_mode, body.reward_amount,
             body.due_at, body.period, body.project_id, _now_iso(), task_id),
        )
        _set_task_categories(conn, task_id, body.category_ids)
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, _now()))


@router.put("/tasks/{task_id}")
async def update_task(task_id: str, body: TaskBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _update_task(me["id"], task_id, body)


def _delete_task(user_id: str, task_id: str):
    with _db() as conn:
        existing = conn.execute("SELECT id FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not existing:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _delete_task(me["id"], task_id)


# ── Completion / timer ──────────────────────────────────────────

def _complete_task(user_id: str, task_id: str):
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        task = _row_to_task(conn, row, now)

        if task["type"] == "todo":
            return JSONResponse({"error": "open the task to check off its items"}, status_code=400)
        if task["type"] == "persistent" and task["reward_mode"] == "hourly":
            return JSONResponse({"error": "use the timer for hourly tasks"}, status_code=400)
        if task["type"] == "onetime" and task["completed"]:
            return JSONResponse({"error": "already completed"}, status_code=400)
        if task["type"] == "periodic" and task["done_this_period"]:
            return JSONResponse({"error": "already completed for this period"}, status_code=400)

        hub = _hub()
        cid = str(uuid.uuid4())
        rewards = _apply_reward(
            hub, user_id, task["category_ids"], task["reward_amount"],
            task["title"], cid,
        )
        overall_ok = bool(rewards) and all(r["budget_ok"] for r in rewards)
        conn.execute(
            "INSERT INTO completions(id,task_id,user_id,amount,duration_hours,budget_ok,note,created_at) "
            "VALUES(?,?,?,?,NULL,?,?,?)",
            (cid, task_id, user_id, task["reward_amount"] or 0.0, 1 if overall_ok else 0, "", now.isoformat()),
        )
        for r in rewards:
            conn.execute(
                "INSERT INTO completion_rewards(id,completion_id,category_id,amount,budget_ok) VALUES(?,?,?,?,?)",
                (str(uuid.uuid4()), cid, r["category_id"], r["amount"], 1 if r["budget_ok"] else 0),
            )
        if task["type"] == "onetime":
            conn.execute("UPDATE tasks SET completed_at=?, updated_at=? WHERE id=?", (now.isoformat(), now.isoformat(), task_id))
        else:
            conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (now.isoformat(), task_id))
        conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        result = _row_to_task(conn, row, now)
        result["reward"] = {"amount": task["reward_amount"] or 0.0, "budget_ok": overall_ok, "categories": rewards}
        return JSONResponse(result)


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _complete_task(me["id"], task_id)


def _start_timer(user_id: str, task_id: str):
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
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


@router.post("/tasks/{task_id}/timer/start")
async def start_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _start_timer(me["id"], task_id)


def _pause_timer(user_id: str, task_id: str):
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["type"] != "persistent" or row["reward_mode"] != "hourly":
            return JSONResponse({"error": "not an hourly task"}, status_code=400)
        if not row["timer_started_at"]:
            return JSONResponse({"error": "timer not running"}, status_code=400)

        started = datetime.fromisoformat(row["timer_started_at"])
        elapsed = float(row["timer_elapsed_seconds"] or 0) + max(0.0, (now - started).total_seconds())
        conn.execute(
            "UPDATE tasks SET timer_started_at=NULL, timer_elapsed_seconds=?, updated_at=? WHERE id=?",
            (elapsed, now.isoformat(), task_id),
        )
        conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, now))


@router.post("/tasks/{task_id}/timer/pause")
async def pause_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _pause_timer(me["id"], task_id)


def _discard_timer(user_id: str, task_id: str):
    """Throw the tracked time away — no completion, no Budget reward."""
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["type"] != "persistent" or row["reward_mode"] != "hourly":
            return JSONResponse({"error": "not an hourly task"}, status_code=400)
        conn.execute(
            "UPDATE tasks SET timer_started_at=NULL, timer_elapsed_seconds=0, updated_at=? WHERE id=?",
            (now.isoformat(), task_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return JSONResponse(_row_to_task(conn, row, now))


@router.post("/tasks/{task_id}/timer/discard")
async def discard_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _discard_timer(me["id"], task_id)


def _complete_timer(user_id: str, task_id: str):
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["type"] != "persistent" or row["reward_mode"] != "hourly":
            return JSONResponse({"error": "not an hourly task"}, status_code=400)

        elapsed_seconds = float(row["timer_elapsed_seconds"] or 0)
        if row["timer_started_at"]:
            started = datetime.fromisoformat(row["timer_started_at"])
            elapsed_seconds += max(0.0, (now - started).total_seconds())
        if elapsed_seconds <= 0:
            return JSONResponse({"error": "timer has no elapsed time"}, status_code=400)

        elapsed_hours = elapsed_seconds / 3600
        amount = round(row["reward_amount"] * elapsed_hours, 2) if row["reward_amount"] else None
        hub = _hub()
        cid = str(uuid.uuid4())
        category_ids = _task_category_ids(conn, task_id)
        rewards = _apply_reward(hub, user_id, category_ids, amount, row["title"], cid)
        overall_ok = bool(rewards) and all(r["budget_ok"] for r in rewards)
        conn.execute(
            "INSERT INTO completions(id,task_id,user_id,amount,duration_hours,budget_ok,note,created_at) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (cid, task_id, user_id, amount or 0.0, round(elapsed_hours, 4),
             1 if overall_ok else 0, "", now.isoformat()),
        )
        for r in rewards:
            conn.execute(
                "INSERT INTO completion_rewards(id,completion_id,category_id,amount,budget_ok) VALUES(?,?,?,?,?)",
                (str(uuid.uuid4()), cid, r["category_id"], r["amount"], 1 if r["budget_ok"] else 0),
            )
        conn.execute(
            "UPDATE tasks SET timer_started_at=NULL, timer_elapsed_seconds=0, updated_at=? WHERE id=?",
            (now.isoformat(), task_id),
        )
        conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        result = _row_to_task(conn, row, now)
        result["reward"] = {"amount": amount or 0.0, "budget_ok": overall_ok, "categories": rewards}
        result["duration_hours"] = round(elapsed_hours, 4)
        return JSONResponse(result)


@router.post("/tasks/{task_id}/timer/complete")
async def complete_timer(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _complete_timer(me["id"], task_id)


@router.post("/tasks/{task_id}/timer/stop")
async def stop_timer_legacy(task_id: str, x_pub_token: str = Header(default=None)):
    """Compatibility for older Tasks clients: their Stop still completes."""
    return await complete_timer(task_id, x_pub_token)


# ── Todo checklist items ─────────────────────────────────────────
# A 'todo' task is a container of checkable items (like a shopping list) —
# it never has its own reward/completion, only its items do (locally, no
# Budget involved). Unfinished items sort by position; finished ones sort to
# the bottom by completion time, oldest-completed first.

class TodoItemBody(BaseModel):
    title: str


class TodoItemUpdateBody(BaseModel):
    title:     Optional[str] = None
    completed: Optional[bool] = None


def _get_todo_task(conn, task_id: str, user_id: str):
    row = conn.execute(
        "SELECT id FROM tasks WHERE id=? AND user_id=? AND type='todo'", (task_id, user_id)
    ).fetchone()
    return row


def _list_todo_items(user_id: str, task_id: str):
    with _db() as conn:
        if not _get_todo_task(conn, task_id, user_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM todo_items WHERE task_id=? "
            "ORDER BY (completed_at IS NOT NULL), position, completed_at",
            (task_id,),
        ).fetchall()
        return JSONResponse([dict(r) for r in rows])


@router.get("/tasks/{task_id}/items")
async def list_todo_items(task_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _list_todo_items(me["id"], task_id)


def _add_todo_item(user_id: str, task_id: str, body: TodoItemBody):
    title = body.title.strip()[:TODO_ITEM_MAX]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    with _db() as conn:
        if not _get_todo_task(conn, task_id, user_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        maxpos = conn.execute(
            "SELECT COALESCE(MAX(position), -1) AS m FROM todo_items WHERE task_id=?", (task_id,)
        ).fetchone()["m"]
        iid = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO todo_items(id,task_id,title,position,completed_at,created_at) VALUES(?,?,?,?,NULL,?)",
            (iid, task_id, title, maxpos + 1, _now_iso()),
        )
        conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (_now_iso(), task_id))
        conn.commit()
        row = conn.execute("SELECT * FROM todo_items WHERE id=?", (iid,)).fetchone()
        return JSONResponse(dict(row))


@router.post("/tasks/{task_id}/items")
async def add_todo_item(task_id: str, body: TodoItemBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _add_todo_item(me["id"], task_id, body)


def _update_todo_item(user_id: str, task_id: str, item_id: str, body: TodoItemUpdateBody):
    with _db() as conn:
        if not _get_todo_task(conn, task_id, user_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        item = conn.execute("SELECT * FROM todo_items WHERE id=? AND task_id=?", (item_id, task_id)).fetchone()
        if not item:
            return JSONResponse({"error": "not found"}, status_code=404)
        title = item["title"]
        if body.title is not None:
            title = body.title.strip()[:TODO_ITEM_MAX]
            if not title:
                return JSONResponse({"error": "title required"}, status_code=400)
        completed_at = item["completed_at"]
        if body.completed is True and not completed_at:
            completed_at = _now_iso()
        elif body.completed is False:
            completed_at = None
        conn.execute(
            "UPDATE todo_items SET title=?, completed_at=? WHERE id=?", (title, completed_at, item_id)
        )
        conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (_now_iso(), task_id))
        conn.commit()
        row = conn.execute("SELECT * FROM todo_items WHERE id=?", (item_id,)).fetchone()
        return JSONResponse(dict(row))


@router.put("/tasks/{task_id}/items/{item_id}")
async def update_todo_item(task_id: str, item_id: str, body: TodoItemUpdateBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _update_todo_item(me["id"], task_id, item_id, body)


def _delete_todo_item(user_id: str, task_id: str, item_id: str):
    with _db() as conn:
        if not _get_todo_task(conn, task_id, user_id):
            return JSONResponse({"error": "not found"}, status_code=404)
        item = conn.execute("SELECT id FROM todo_items WHERE id=? AND task_id=?", (item_id, task_id)).fetchone()
        if not item:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute("DELETE FROM todo_items WHERE id=?", (item_id,))
        conn.execute("UPDATE tasks SET updated_at=? WHERE id=?", (_now_iso(), task_id))
        conn.commit()
    return JSONResponse({"ok": True})


@router.delete("/tasks/{task_id}/items/{item_id}")
async def delete_todo_item(task_id: str, item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return _delete_todo_item(me["id"], task_id, item_id)


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
        result = []
        for r in rows:
            d = dict(r)
            cr = conn.execute(
                "SELECT category_id, amount, budget_ok FROM completion_rewards WHERE completion_id=?",
                (d["id"],),
            ).fetchall()
            d["categories"] = [dict(x) for x in cr]
            result.append(d)
        return JSONResponse(result)
