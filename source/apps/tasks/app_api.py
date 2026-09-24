"""
Tasks' app-to-app API — the only way another app (or mvmAI) should touch
Tasks data. Loaded by Apps Hub via hub.call_app_api("tasks", ...) once an
admin enables it at Apps Hub -> Settings -> App APIs. Every action runs the
very same _<route>(user_id, ...) function api.py's own routes call, reached
via sys.modules["app_public_tasks"] (api.py is exec'd into that module name by
backend/public_loader.py at startup), so validation, Budget rewards, timers
and periods behave exactly as they do in the Tasks window.

user_id is always an Apps Hub public_users.id; every action only ever sees or
changes that user's own projects, tasks and items.

Invalid input raises ValueError with api.py's own short English reason; a
task, project or item that doesn't exist or belongs to someone else raises
LookupError("not found").
"""

import json
import sys
from datetime import datetime, timezone


def _pub():
    pub = sys.modules.get("app_public_tasks")
    if pub is None:
        raise RuntimeError("tasks api.py not loaded")
    return pub


def _unwrap(resp):
    """api.py's helpers answer with a JSONResponse; turn it back into data,
    or into the matching exception when it carries an error status."""
    data = json.loads(resp.body)
    if resp.status_code == 404:
        raise LookupError(data.get("error") or "not found")
    if resp.status_code >= 400:
        raise ValueError(data.get("error") or "invalid request")
    return data


def _split_ids(value):
    if value is None:
        return None
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    return [x.strip() for x in str(value).split(",") if x.strip()]


def _norm_due(value):
    """The Tasks window stores due_at as a UTC ISO string (JS toISOString),
    and api.py compares it to "now" as text — so whatever the caller sends
    is converted to that exact shape. A time without an offset is taken as
    the server's local time."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("due_at must be an ISO date and time, e.g. 2026-10-01T18:00")
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _own_task(pub, user_id, task_id):
    with pub._db() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, user_id)
        ).fetchone()
        if not row:
            raise LookupError("not found")
        return pub._row_to_task(conn, row, pub._now())


# ── Projects ─────────────────────────────────────────────────────

def list_projects(user_id: str):
    """List the user's task projects (id, title, parent_id). A project with
    a parent_id is a subproject of that project."""
    return _unwrap(_pub()._list_projects(user_id))


def add_project(user_id: str, title: str, parent_id: str = None):
    """Create a task project for the user. Give parent_id (another
    project's id) to create it as a subproject. Returns the project."""
    pub = _pub()
    return _unwrap(pub._create_project(user_id, pub.ProjectBody(title=title or "", parent_id=parent_id or None)))


def rename_project(user_id: str, project_id: str, title: str):
    """Rename one of the user's task projects."""
    pub = _pub()
    return _unwrap(pub._rename_project(user_id, project_id, pub.ProjectBody(title=title or "")))


def delete_project(user_id: str, project_id: str):
    """Delete one of the user's task projects. Nothing inside it is lost:
    its tasks and subprojects move one level up."""
    return _unwrap(_pub()._delete_project(user_id, project_id))


# ── Tasks ────────────────────────────────────────────────────────

def list_tasks(user_id: str, project_id: str = None):
    """List the user's tasks, optionally only those in one project. Each
    task has id, title, description, type (persistent, onetime, periodic or
    todo), project_id and project_title, plus its state: completed and
    due_at for onetime, done_this_period for periodic, timer_running,
    timer_paused and elapsed_seconds for hourly persistent tasks, and
    todo_total/todo_done for todo lists."""
    pub = _pub()
    tasks = _unwrap(pub._list_tasks(user_id))
    projects = {p["id"]: p["title"] for p in _unwrap(pub._list_projects(user_id))}
    if project_id:
        tasks = [t for t in tasks if t.get("project_id") == project_id]
    for t in tasks:
        t["project_title"] = projects.get(t.get("project_id"))
    return tasks


def get_task(user_id: str, task_id: str):
    """Get one of the user's tasks by id; a todo list also includes its
    items."""
    pub = _pub()
    task = _own_task(pub, user_id, task_id)
    if task["type"] == "todo":
        task["items"] = _unwrap(pub._list_todo_items(user_id, task_id))
    return task


def add_task(user_id: str, title: str, type: str = "persistent",
             description: str = "", project_id: str = None,
             due_at: str = None, period: str = None,
             reward_mode: str = "fixed", reward_amount: float = None,
             category_ids: str = None):
    """Create a task for the user. type is persistent (repeatable any time,
    or timed when reward_mode is hourly), onetime (needs due_at as an ISO
    date and time, e.g. 2026-10-01T18:00), periodic (needs period: daily,
    weekly or monthly) or todo (a checklist of items). project_id puts it in
    a project. reward_amount with category_ids (comma separated Budget
    category ids from list_budget_categories) adds or takes money in Budget
    on completion; with reward_mode hourly it is per hour. Returns the
    task."""
    pub = _pub()
    body = pub.TaskBody(
        title=title or "", description=description or "", type=type,
        reward_mode=reward_mode or "fixed", reward_amount=reward_amount,
        category_ids=_split_ids(category_ids) or [],
        due_at=_norm_due(due_at), period=period or None,
        project_id=project_id or None,
    )
    return _unwrap(pub._create_task(user_id, body))


def update_task(user_id: str, task_id: str, title: str = None,
                description: str = None, type: str = None,
                project_id: str = None, due_at: str = None,
                period: str = None, reward_mode: str = None,
                reward_amount: float = None, category_ids: str = None):
    """Edit one of the user's tasks. Only the fields you pass change; pass
    an empty project_id to take it out of its project, and an empty
    category_ids to stop its Budget reward. Same field rules as add_task.
    Returns the task."""
    pub = _pub()
    cur = _own_task(pub, user_id, task_id)
    new_type = type or cur["type"]
    # Fields that don't apply to a new type are dropped unless the caller
    # sets them, so changing only the type doesn't fail validation on
    # leftovers from the old one.
    keep = new_type == cur["type"]
    body = pub.TaskBody(
        title=cur["title"] if title is None else title,
        description=cur["description"] if description is None else description,
        type=new_type,
        reward_mode=reward_mode or (cur["reward_mode"] if keep else "fixed"),
        reward_amount=reward_amount if reward_amount is not None else (cur["reward_amount"] if keep else None),
        category_ids=_split_ids(category_ids) if category_ids is not None else (cur["category_ids"] if keep else []),
        due_at=_norm_due(due_at) if due_at is not None else (cur.get("due_at") if keep else None),
        period=(period or None) if period is not None else (cur.get("period") if keep else None),
        project_id=(project_id or None) if project_id is not None else cur.get("project_id"),
    )
    if not body.category_ids and category_ids is not None:
        body.reward_amount = None
    return _unwrap(pub._update_task(user_id, task_id, body))


def delete_task(user_id: str, task_id: str):
    """Delete one of the user's tasks, with its todo items."""
    return _unwrap(_pub()._delete_task(user_id, task_id))


def complete_task(user_id: str, task_id: str):
    """Mark one of the user's tasks as done and apply its Budget reward. For
    an hourly (timed) task this stops its timer and saves the tracked time.
    A todo list is never completed itself — complete its items instead."""
    pub = _pub()
    task = _own_task(pub, user_id, task_id)
    if task["type"] == "persistent" and task["reward_mode"] == "hourly":
        return _unwrap(pub._complete_timer(user_id, task_id))
    return _unwrap(pub._complete_task(user_id, task_id))


def start_task_timer(user_id: str, task_id: str):
    """Start, or resume after a pause, the timer of one of the user's hourly
    (timed) tasks."""
    return _unwrap(_pub()._start_timer(user_id, task_id))


def pause_task_timer(user_id: str, task_id: str):
    """Pause the running timer of one of the user's hourly tasks, keeping
    the time tracked so far for a later resume or completion."""
    return _unwrap(_pub()._pause_timer(user_id, task_id))


def discard_task_timer(user_id: str, task_id: str):
    """Stop the timer of one of the user's hourly tasks and throw the
    tracked time away, with no completion and no Budget reward."""
    return _unwrap(_pub()._discard_timer(user_id, task_id))


def list_budget_categories(user_id: str):
    """The user's Budget categories (id, title) that a task reward can go
    to. available is false when Budget isn't installed or its API is off."""
    hub = sys.modules.get("backend.apphub")
    if hub is None:
        return {"available": False, "categories": []}
    try:
        cats = hub.call_app_api("budget", "list_categories", user_id)
    except Exception:
        return {"available": False, "categories": []}
    return {"available": True, "categories": [{"id": c.get("id"), "title": c.get("title")} for c in cats]}


# ── Todo items ───────────────────────────────────────────────────

def list_todo_items(user_id: str, task_id: str):
    """List the items of one of the user's todo list tasks, unfinished first.
    An item with completed_at set is checked off."""
    return _unwrap(_pub()._list_todo_items(user_id, task_id))


def add_todo_item(user_id: str, task_id: str, title: str):
    """Add an item to the end of one of the user's todo list tasks."""
    pub = _pub()
    return _unwrap(pub._add_todo_item(user_id, task_id, pub.TodoItemBody(title=title or "")))


def update_todo_item(user_id: str, task_id: str, item_id: str,
                     title: str = None, completed: bool = None):
    """Check off (completed true), uncheck (completed false) or rename an
    item of one of the user's todo list tasks."""
    pub = _pub()
    return _unwrap(pub._update_todo_item(
        user_id, task_id, item_id, pub.TodoItemUpdateBody(title=title, completed=completed)))


def delete_todo_item(user_id: str, task_id: str, item_id: str):
    """Remove an item from one of the user's todo list tasks."""
    return _unwrap(_pub()._delete_todo_item(user_id, task_id, item_id))
