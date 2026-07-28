"""
Budget's app-to-app API — the only way another app should touch Budget data.
Loaded by Apps Hub via hub.call_app_api("budget", ...) once an admin enables
it at Apps Hub -> Settings -> App APIs. Reuses public.py's already-running
DB and helpers via sys.modules["app_public_budget"] (api.py is exec'd
into that module name by backend/public_loader.py at startup, so this file
never re-implements schema/balance/membership logic of its own).

user_id here is always an Apps Hub public_users.id, the same identity space
category_members/transactions already key on — the caller is expected to
already know which Apps Hub user it's acting on behalf of.
"""

import sqlite3
import sys
import uuid
from datetime import datetime, timezone


def _pub():
    return sys.modules.get("app_public_budget")


def list_categories(user_id: str):
    """Top-level categories the given user is a member of, with balance/role."""
    pub = _pub()
    if pub is None:
        raise RuntimeError("budget public.py not loaded")
    with pub._db() as conn:
        rows = conn.execute(
            "SELECT c.* FROM categories c JOIN category_members cm ON cm.category_id=c.id "
            "WHERE cm.user_id=? AND c.archived=0 AND c.parent_id IS NULL ORDER BY c.created_at",
            (user_id,),
        ).fetchall()
        return [pub._row_to_category(conn, r, user_id) for r in rows]


def get_currency(user_id: str):
    """The given user's effective display currency (their own override, or
    the system default). Not tied to any category — Budget doesn't store
    currency per-category or per-transaction, only as a per-user display
    setting."""
    pub = _pub()
    if pub is None:
        raise RuntimeError("budget public.py not loaded")
    with pub._db() as conn:
        return pub._effective_currency(conn, user_id)


def add_to_category(user_id: str, category_id: str, amount: float,
                     source_app: str, source_app_name: str,
                     reason: str = "", idempotency_key: str = None):
    """Add (amount > 0) or withdraw (amount < 0) money in a category the user
    is a member of. Raises ValueError if the category doesn't exist, the user
    isn't a member, or it holds subcategories (same rules as the normal
    add-transaction route). Safe to retry with the same idempotency_key —
    replaying it returns the original result instead of inserting twice.

    source_app/source_app_name identify the calling app (e.g. "tasks" /
    "Задачи") so Budget can label the entry and let the user show/hide it —
    Budget stores and echoes these back verbatim but has no logic keyed on
    any specific value; the caller is responsible for a stable id and a
    human-readable name."""
    pub = _pub()
    if pub is None:
        raise RuntimeError("budget public.py not loaded")
    if amount == 0:
        raise ValueError("amount must be non-zero")
    if not source_app or not source_app_name:
        raise ValueError("source_app and source_app_name are required")

    with pub._db() as conn:
        if idempotency_key:
            row = conn.execute(
                "SELECT * FROM transactions WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone()
            if row is not None:
                return {**dict(row), "balance": pub._balance(conn, row["category_id"])}

        if not pub._my_role(conn, category_id, user_id):
            raise ValueError("category not found or user is not a member")
        if pub._child_ids(conn, category_id):
            raise ValueError("category has subcategories")

        tid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        try:
            conn.execute(
                "INSERT INTO transactions(id,category_id,user_id,amount,note,batch_id,created_at,"
                "idempotency_key,source,source_app,source_app_name) "
                "VALUES(?,?,?,?,?,NULL,?,?,'external',?,?)",
                (tid, category_id, user_id, amount, (reason or "").strip()[:300], now, idempotency_key,
                 source_app, source_app_name),
            )
            conn.commit()
        except sqlite3.IntegrityError:
            # Lost the race on the idempotency key to a concurrent identical call.
            row = conn.execute(
                "SELECT * FROM transactions WHERE idempotency_key=?", (idempotency_key,)
            ).fetchone()
            if row is not None:
                return {**dict(row), "balance": pub._balance(conn, row["category_id"])}
            raise

        row = conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
        return {**dict(row), "balance": pub._balance(conn, category_id)}
