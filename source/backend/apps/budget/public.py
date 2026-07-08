"""
mvmOS Budget — category-based budget tracking per Apps Hub account.

Mounted at /pub/budget by public_loader.py. Identity is always the Apps Hub
token (X-Pub-Token header) — used identically by the in-app mvmOS window and
by the standalone public page / Telegram mini-app, so there is no separate
backend.py (same reasoning as backend/apps/chat/public.py and
backend/apps/calendar/public.py).

A category's balance is always derived from its transactions (never stored),
so two shared members transacting concurrently can never drift a cached
total out of sync with the real ledger. Every category has a
category_members row for its owner (role='owner'), which is what lets
"categories visible to me" be a single join instead of an owner_id-or-shared
special case.

Sharing is owner-only (share/unshare/edit/delete); once shared, the money
itself is fully joint — any member can add/withdraw and see history. A
member can leave a shared category on their own; only the owner can remove
someone else. No pending-invite step: sharing is immediate, like Favourites,
but the recipient gets a notification the moment they're added.
"""

import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Header
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "budget"

_DIR         = os.path.dirname(__file__)                                    # backend/apps/budget
_DB_PATH     = os.path.join(_DIR, "..", "..", "..", "apps", "budget", "data.db")
_PUBLIC_DIR  = os.path.join(_DIR, "..", "..", "..", "apps", "budget", "public")
_CORE_DB_PATH = os.path.join(_DIR, "..", "..", "..", "data.db")

# Fixed list — symbol-only display, never real FX conversion. Kept in sync
# manually with frontend/settings.js's own copy (public/Telegram surfaces
# never load core desktop JS, so there's no shared module to import from).
ALLOWED_CURRENCIES = {
    "EUR", "USD", "GBP", "CHF", "JPY", "CNY", "TRY", "UAH", "PLN",
    "RON", "CZK", "HUF", "CAD", "AUD", "SEK", "NOK", "DKK", "RUB", "INR",
}


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
            CREATE TABLE IF NOT EXISTS categories (
                id          TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                title       TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                alloc_type  TEXT NOT NULL,
                alloc_value REAL NOT NULL,
                goal        REAL,
                archived    INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_categories_owner ON categories(owner_id);

            CREATE TABLE IF NOT EXISTS category_members (
                category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'member',
                created_at  TEXT NOT NULL,
                PRIMARY KEY (category_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_category_members_user ON category_members(user_id);

            CREATE TABLE IF NOT EXISTS transactions (
                id          TEXT PRIMARY KEY,
                category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                amount      REAL NOT NULL,
                note        TEXT NOT NULL DEFAULT '',
                batch_id    TEXT,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_transactions_batch ON transactions(batch_id);

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id     TEXT PRIMARY KEY,
                currency    TEXT
            );
        """)
        try:
            conn.execute("ALTER TABLE transactions ADD COLUMN deleted_by TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE transactions ADD COLUMN deleted_at TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE user_settings ADD COLUMN default_sign INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id) ON DELETE CASCADE")
        except sqlite3.OperationalError:
            pass
        conn.execute("CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id)")
        conn.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _system_currency() -> str:
    """Read-only lookup of mvmOS's regional currency (backend/settings.py
    DEFAULTS['currency']). Budget never writes to core data.db."""
    try:
        conn = sqlite3.connect(_CORE_DB_PATH)
        try:
            row = conn.execute("SELECT value FROM settings WHERE key='main'").fetchone()
        finally:
            conn.close()
        if row:
            saved = json.loads(row[0])
            cur = saved.get("currency")
            if cur in ALLOWED_CURRENCIES:
                return cur
    except sqlite3.Error:
        pass
    return "EUR"


def _effective_currency(conn, user_id: str) -> str:
    row = conn.execute(
        "SELECT currency FROM user_settings WHERE user_id=?", (user_id,)
    ).fetchone()
    if row and row["currency"]:
        return row["currency"]
    return _system_currency()


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Budget</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Budget is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


@router.get("/telegram")
async def telegram_mini_app():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "telegram.html"))


# ── Helpers ──────────────────────────────────────────────────────

def _child_ids(conn, category_id) -> List[str]:
    rows = conn.execute("SELECT id FROM categories WHERE parent_id=?", (category_id,)).fetchall()
    return [r["id"] for r in rows]


def _balance(conn, category_id) -> float:
    children = _child_ids(conn, category_id)
    if children:
        return round(sum(_balance(conn, cid) for cid in children), 2)
    row = conn.execute(
        "SELECT COALESCE(SUM(amount),0) b FROM transactions WHERE category_id=? AND deleted_at IS NULL",
        (category_id,),
    ).fetchone()
    return round(row["b"], 2)


def _owning_category_id(conn, category_id) -> Optional[str]:
    """Subcategories have no category_members of their own — sharing/role
    checks always resolve through the parent, so 'share the parent, see the
    children' falls out for free instead of needing its own mechanism."""
    row = conn.execute("SELECT parent_id FROM categories WHERE id=?", (category_id,)).fetchone()
    if row is None:
        return None
    return row["parent_id"] or category_id


def _my_role(conn, category_id, user_id) -> Optional[str]:
    owning_id = _owning_category_id(conn, category_id)
    if owning_id is None:
        return None
    row = conn.execute(
        "SELECT role FROM category_members WHERE category_id=? AND user_id=?", (owning_id, user_id)
    ).fetchone()
    return row["role"] if row else None


def _row_to_category(conn, row, me_id) -> dict:
    d = dict(row)
    cid = d["id"]
    balance = _balance(conn, cid)
    d["balance"] = balance
    d["role"] = _my_role(conn, cid, me_id)
    owning_id = d["parent_id"] or cid
    d["member_count"] = conn.execute(
        "SELECT COUNT(*) c FROM category_members WHERE category_id=?", (owning_id,)
    ).fetchone()["c"]
    d["progress_pct"] = round(min(100.0, balance / d["goal"] * 100), 1) if d.get("goal") else None
    d["has_children"] = len(_child_ids(conn, cid)) > 0
    return d


# ── Per-user settings (currency, default transaction sign) ─────────

class UserSettingsBody(BaseModel):
    currency: Optional[str] = None
    default_sign: int = 1


@router.get("/me")
async def get_me(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute(
            "SELECT currency, default_sign FROM user_settings WHERE user_id=?", (me["id"],)
        ).fetchone()
        override = row["currency"] if row else None
        default_sign = row["default_sign"] if row and row["default_sign"] is not None else 1
        return JSONResponse({
            "id": me["id"],
            "currency": override,
            "effective_currency": override or _system_currency(),
            "default_sign": default_sign,
        })


@router.put("/me/settings")
async def set_my_settings(body: UserSettingsBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.currency is not None and body.currency not in ALLOWED_CURRENCIES:
        return JSONResponse({"error": "invalid currency"}, status_code=400)
    if body.default_sign not in (1, -1):
        return JSONResponse({"error": "invalid default_sign"}, status_code=400)
    with _db() as conn:
        conn.execute(
            "INSERT INTO user_settings(user_id,currency,default_sign) VALUES(?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET currency=excluded.currency, default_sign=excluded.default_sign",
            (me["id"], body.currency, body.default_sign),
        )
        conn.commit()
        return JSONResponse({
            "currency": body.currency,
            "effective_currency": body.currency or _system_currency(),
            "default_sign": body.default_sign,
        })


# ── Categories ───────────────────────────────────────────────────

class CategoryBody(BaseModel):
    title: str
    description: str = ""
    alloc_type: str = "fixed"          # 'percent' | 'fixed' — ignored for subcategories
    alloc_value: float = 0
    goal: Optional[float] = None
    parent_id: Optional[str] = None


def _validate_category(body: "CategoryBody"):
    if body.parent_id:
        return None  # subcategories carry no allocation/goal of their own
    if body.alloc_type not in ("percent", "fixed"):
        return "invalid alloc_type"
    if body.alloc_value < 0:
        return "alloc_value must be >= 0"
    if body.alloc_type == "percent" and body.alloc_value > 100:
        return "percent alloc_value must be <= 100"
    if body.goal is not None and body.goal <= 0:
        return "goal must be > 0"
    return None


@router.get("/categories")
async def list_categories(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT c.* FROM categories c JOIN category_members cm ON cm.category_id=c.id "
            "WHERE cm.user_id=? AND c.archived=0 AND c.parent_id IS NULL ORDER BY c.created_at",
            (me["id"],),
        ).fetchall()
        return JSONResponse([_row_to_category(conn, r, me["id"]) for r in rows])


@router.get("/categories/{category_id}/children")
async def list_children(category_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, category_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM categories WHERE parent_id=? AND archived=0 ORDER BY created_at",
            (category_id,),
        ).fetchall()
        return JSONResponse([_row_to_category(conn, r, me["id"]) for r in rows])


@router.post("/categories")
async def create_category(body: CategoryBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    err = _validate_category(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)

    now = _now()
    cid = str(uuid.uuid4())
    with _db() as conn:
        if body.parent_id:
            parent = conn.execute("SELECT * FROM categories WHERE id=?", (body.parent_id,)).fetchone()
            if not parent or parent["parent_id"]:
                return JSONResponse({"error": "invalid parent"}, status_code=400)
            if _my_role(conn, body.parent_id, me["id"]) != "owner":
                return JSONResponse({"error": "forbidden"}, status_code=403)
            if parent["alloc_value"]:
                return JSONResponse({"error": "parent is not a subcategory holder"}, status_code=400)
            has_own_tx = conn.execute(
                "SELECT 1 FROM transactions WHERE category_id=? AND deleted_at IS NULL LIMIT 1",
                (body.parent_id,),
            ).fetchone()
            if has_own_tx:
                return JSONResponse({"error": "parent has own transactions"}, status_code=400)
        conn.execute(
            "INSERT INTO categories(id,owner_id,title,description,alloc_type,alloc_value,goal,"
            "archived,created_at,updated_at,parent_id) VALUES(?,?,?,?,?,?,?,0,?,?,?)",
            (cid, me["id"], title, body.description.strip()[:1000], body.alloc_type, body.alloc_value,
             body.goal, now, now, body.parent_id),
        )
        if not body.parent_id:
            conn.execute(
                "INSERT INTO category_members(category_id,user_id,role,created_at) VALUES(?,?,'owner',?)",
                (cid, me["id"], now),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()
        return JSONResponse(_row_to_category(conn, row, me["id"]))


@router.put("/categories/{category_id}")
async def update_category(category_id: str, body: CategoryBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    err = _validate_category(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)

    with _db() as conn:
        role = _my_role(conn, category_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        if not body.parent_id and body.alloc_value and _child_ids(conn, category_id):
            return JSONResponse({"error": "category has subcategories"}, status_code=400)
        conn.execute(
            "UPDATE categories SET title=?, description=?, alloc_type=?, alloc_value=?, goal=?, updated_at=? "
            "WHERE id=?",
            (title, body.description.strip()[:1000], body.alloc_type, body.alloc_value, body.goal,
             _now(), category_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM categories WHERE id=?", (category_id,)).fetchone()
        return JSONResponse(_row_to_category(conn, row, me["id"]))


@router.delete("/categories/{category_id}")
async def delete_category(category_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, category_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        conn.execute("DELETE FROM categories WHERE id=?", (category_id,))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Transactions ─────────────────────────────────────────────────

class TransactionBody(BaseModel):
    amount: float
    note: str = ""


def _profile_brief(p: dict) -> dict:
    return {
        "username": p.get("username"),
        "display_name": p.get("display_name"),
        "avatar_color": p.get("avatar_color"),
        "avatar_svg": p.get("avatar_svg"),
    }


@router.get("/categories/{category_id}/transactions")
async def list_transactions(category_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, category_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM transactions WHERE category_id=? ORDER BY created_at DESC LIMIT 200",
            (category_id,),
        ).fetchall()

    hub = _hub()
    ids = {r["user_id"] for r in rows} | {r["deleted_by"] for r in rows if r["deleted_by"]}
    profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub and ids else {}

    result = []
    for r in rows:
        d = dict(r)
        d["added_by"] = _profile_brief(profiles.get(r["user_id"], {}))
        d["deleted_by_user"] = _profile_brief(profiles.get(r["deleted_by"], {})) if r["deleted_by"] else None
        result.append(d)
    return JSONResponse(result)


@router.post("/categories/{category_id}/transactions")
async def add_transaction(category_id: str, body: TransactionBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.amount == 0:
        return JSONResponse({"error": "amount must be non-zero"}, status_code=400)
    with _db() as conn:
        if not _my_role(conn, category_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        if _child_ids(conn, category_id):
            return JSONResponse({"error": "category has subcategories"}, status_code=400)
        tid = str(uuid.uuid4())
        now = _now()
        conn.execute(
            "INSERT INTO transactions(id,category_id,user_id,amount,note,batch_id,created_at) "
            "VALUES(?,?,?,?,?,NULL,?)",
            (tid, category_id, me["id"], body.amount, body.note.strip()[:300], now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM transactions WHERE id=?", (tid,)).fetchone()
        return JSONResponse({**dict(row), "balance": _balance(conn, category_id)})


@router.delete("/transactions/{transaction_id}")
async def delete_transaction(transaction_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM transactions WHERE id=?", (transaction_id,)).fetchone()
        if not row or row["deleted_at"] or not _my_role(conn, row["category_id"], me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE transactions SET deleted_by=?, deleted_at=? WHERE id=?",
            (me["id"], _now(), transaction_id),
        )
        conn.commit()
        return JSONResponse({"ok": True, "balance": _balance(conn, row["category_id"])})


# ── Mass-add ─────────────────────────────────────────────────────

class MassAddEntry(BaseModel):
    category_id: str
    amount: float
    note: str = ""


class MassAddBody(BaseModel):
    entries: List[MassAddEntry]


@router.post("/mass-add")
async def mass_add(body: MassAddBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    entries = [e for e in body.entries if e.amount != 0]
    if not entries:
        return JSONResponse({"error": "no entries"}, status_code=400)

    batch_id = str(uuid.uuid4())
    now = _now()
    with _db() as conn:
        for e in entries:
            if not _my_role(conn, e.category_id, me["id"]):
                return JSONResponse({"error": f"category not found: {e.category_id}"}, status_code=404)
            if _child_ids(conn, e.category_id):
                return JSONResponse({"error": f"category has subcategories: {e.category_id}"}, status_code=400)
        for e in entries:
            conn.execute(
                "INSERT INTO transactions(id,category_id,user_id,amount,note,batch_id,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), e.category_id, me["id"], e.amount, e.note.strip()[:300], batch_id, now),
            )
        conn.commit()
        touched_ids = list(dict.fromkeys(e.category_id for e in entries))
        result = []
        for cid in touched_ids:
            row = conn.execute("SELECT * FROM categories WHERE id=?", (cid,)).fetchone()
            result.append(_row_to_category(conn, row, me["id"]))
        return JSONResponse({"batch_id": batch_id, "categories": result})


# ── Members / sharing ────────────────────────────────────────────

class MemberBody(BaseModel):
    user_id: str


def _member_row_to_dict(row, profiles) -> dict:
    p = profiles.get(row["user_id"], {})
    return {
        "user_id": row["user_id"],
        "role": row["role"],
        "username": p.get("username"),
        "display_name": p.get("display_name"),
        "avatar_color": p.get("avatar_color"),
        "avatar_svg": p.get("avatar_svg"),
    }


@router.get("/categories/{category_id}/members")
async def list_members(category_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, category_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT user_id, role, created_at FROM category_members WHERE category_id=? "
            "ORDER BY role DESC, created_at",
            (category_id,),
        ).fetchall()
    hub = _hub()
    profiles = {}
    if hub:
        profiles = {p["id"]: p for p in hub.get_users_by_ids([r["user_id"] for r in rows])}
    return JSONResponse([_member_row_to_dict(r, profiles) for r in rows])


@router.post("/categories/{category_id}/members")
async def add_member(category_id: str, body: MemberBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    if not hub:
        return JSONResponse({"error": "apps hub unavailable"}, status_code=500)

    with _db() as conn:
        role = _my_role(conn, category_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)

        favourites = hub.get_favourites(me["id"])
        if body.user_id not in {f["id"] for f in favourites}:
            return JSONResponse({"error": "user is not in your favourites"}, status_code=400)

        if _effective_currency(conn, me["id"]) != _effective_currency(conn, body.user_id):
            return JSONResponse({"error": "currency_mismatch"}, status_code=400)

        if _my_role(conn, category_id, body.user_id):
            return JSONResponse({"error": "already a member"}, status_code=400)

        cat = conn.execute("SELECT title FROM categories WHERE id=?", (category_id,)).fetchone()
        now = _now()
        conn.execute(
            "INSERT INTO category_members(category_id,user_id,role,created_at) VALUES(?,?,'member',?)",
            (category_id, body.user_id, now),
        )
        conn.commit()

    _notify_share(hub, me, body.user_id, category_id, cat["title"] if cat else "")

    profiles = {p["id"]: p for p in hub.get_users_by_ids([body.user_id])}
    with _db() as conn:
        row = conn.execute(
            "SELECT user_id, role, created_at FROM category_members WHERE category_id=? AND user_id=?",
            (category_id, body.user_id),
        ).fetchone()
    return JSONResponse(_member_row_to_dict(row, profiles))


@router.delete("/categories/{category_id}/members/{user_id}")
async def remove_member(category_id: str, user_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        my_role = _my_role(conn, category_id, me["id"])
        if not my_role:
            return JSONResponse({"error": "not found"}, status_code=404)

        if user_id == me["id"]:
            if my_role == "owner":
                return JSONResponse({"error": "owner cannot leave, delete the category instead"}, status_code=400)
        elif my_role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        else:
            target_role = _my_role(conn, category_id, user_id)
            if not target_role:
                return JSONResponse({"error": "not found"}, status_code=404)
            if target_role == "owner":
                return JSONResponse({"error": "cannot remove the owner"}, status_code=400)

        conn.execute(
            "DELETE FROM category_members WHERE category_id=? AND user_id=?", (category_id, user_id)
        )
        conn.commit()
    return JSONResponse({"ok": True})


def _notify_share(hub, from_user: dict, to_id: str, category_id: str, category_title: str):
    """Unconditional notification + Telegram push when a category is shared —
    mirrors reminder_scheduler.py's "always notify both channels" pattern,
    since budget has no realtime connection to check for presence."""
    users = hub.get_users_by_ids([to_id])
    if not users or not users[0].get("username"):
        return
    sender = from_user.get("display_name", "?")
    body = f'{sender} сподели бюджетна категория "{category_title}" с теб.'

    notif = sys.modules.get("backend.notifications")
    if notif:
        notif.create_notification(
            users[0]["username"], "💰 Споделена категория", body, kind="persistent",
            source="budget", action_app="budget", ref=category_id,
        )

    tg = sys.modules.get("app_backend_telegramhub")
    if tg:
        base = tg.get_public_base_url() or ""
        url = f"{base.rstrip('/')}/pub/budget/telegram?category={category_id}"
        tg.notify(to_id, "budget", f"💰 {body}", web_app=url)
