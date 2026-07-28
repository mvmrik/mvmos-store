"""
mvmOS Shopping List — per Apps Hub account shopping lists, optionally
withdrawing from a Budget category when an item is marked bought.

Mounted at /pub/shoppinglist by public_loader.py. Identity is always the
Apps Hub token (X-Pub-Token header) — used identically by the in-app mvmOS
window and the standalone public page, so there is no separate backend.py
(same reasoning as backend/apps/budget/public.py and
backend/apps/tasks/public.py).

Lists follow Budget's category sharing model exactly: every list has a
list_members row for its owner (role='owner'); sharing is owner-only
(add/remove member, edit/delete list) but once shared the list itself is
fully joint — any member can add/edit/delete/buy items. No pending-invite
step, gated on the Apps Hub Favourites relationship, same as Budget. A
list with no members besides its owner is private to them.

Buying (POST /items/{id}/buy) and un-buying (POST /items/{id}/unbuy) are
both supported, still locking a bought item from edits until it's unbought
first. items.budget_applied tracks whether a Budget withdrawal is currently
in effect for the item, independent of category_id/price (which can be
edited before a purchase but stay fixed once bought) — unbuy only reverses
the Budget transaction when budget_applied=1, and each buy/unbuy exchange
uses a fresh idempotency key derived from the item id + the bought_at being
set/cleared, so repeated toggling charges and reverses correctly instead of
deduping against a stale key. Deleting an item is allowed regardless of
bought state (mirrors Tasks allowing deletion of completed tasks) and never
reverses any Budget transaction already applied — same precedent as Tasks.

Budget integration is gated by a per-user user_settings.budget_integration
toggle (same pattern/table shape as Tasks) — GET /budget-categories only
returns available=True when the setting is on, and the frontend skips
calling it at all when off, so users who don't want the feature neither see
it nor pay for the extra app-to-app call on every load. When enabled, the
category picker on the add/edit form appears and withdrawal goes through
hub.call_app_api("budget", "add_to_category", ...) — Shopping List has zero
knowledge of Budget's schema, only of the generic app-to-app API contract.
If Budget isn't installed or its API isn't enabled, the item still gets
marked bought normally; the withdrawal is just skipped (reported as
budget_ok=false in the response) rather than failing the whole action.

Each item can also carry an optional warranty: items.warranty_years +
warranty_start (set together, start preserved across period edits so
changing the length doesn't reset the clock) plus a child warranty_photos
table for attached photos (multiple-per-item, mirrors the join-table
pattern used elsewhere in this codebase rather than a JSON column). Photo
files live under apps/shoppinglist/public/warranty-uploads/<item_id>/,
served by a dedicated unauthenticated GET route (filenames are random
uuid4 hex, never the client-supplied name) — deleting an item, a list, a
single photo, or the warranty itself cleans up both the DB rows and the
files on disk. GET /warranties returns every item across all of the
caller's lists that has a warranty set, soonest-expiring first, for the
cross-list "Warranties" overview — including orphaned/history items (see
below), so a warranty never disappears just because its list did.

Deleting a list (DELETE /lists/{id}) is a soft delete for its items: every
item gets detached (list_id -> NULL, with the list's title snapshotted onto
list_title_snapshot for context) instead of being cascade-deleted, so
warranties/photos/purchase history all survive; only the list row itself
and its list_members rows are actually removed. Detached items become
personal "history", scoped by added_by since there's no list_members row
left to check permissions through (see _can_access_item) — GET /history
lists them for the caller, and the existing DELETE /items/{id} (reused,
not a separate endpoint) is what actually hard-deletes an item forever,
same as it always has for items still on a live list.
"""

import os
import re
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Header, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "shoppinglist"

_DIR        = os.path.dirname(__file__)                                    # apps/shoppinglist
_DB_PATH    = os.path.join(_DIR, "data.db")
_PUBLIC_DIR = os.path.join(_DIR, "public")
_WARRANTY_UPLOADS_DIR = os.path.join(_PUBLIC_DIR, "warranty-uploads")

ALLOWED_UPLOAD_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_UPLOAD_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp)$")


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
            CREATE TABLE IF NOT EXISTS lists (
                id          TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                title       TEXT NOT NULL,
                archived    INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lists_owner ON lists(owner_id);

            CREATE TABLE IF NOT EXISTS list_members (
                list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'member',
                created_at  TEXT NOT NULL,
                PRIMARY KEY (list_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_list_members_user ON list_members(user_id);

            CREATE TABLE IF NOT EXISTS items (
                id          TEXT PRIMARY KEY,
                list_id     TEXT REFERENCES lists(id) ON DELETE SET NULL,
                name        TEXT NOT NULL,
                quantity    REAL NOT NULL DEFAULT 1,
                price       REAL,
                category_id TEXT,
                added_by    TEXT NOT NULL,
                bought_at   TEXT,
                bought_by   TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_items_list ON items(list_id, created_at);

            CREATE TABLE IF NOT EXISTS user_settings (
                user_id             TEXT PRIMARY KEY,
                budget_integration  INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS warranty_photos (
                id          TEXT PRIMARY KEY,
                item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                filename    TEXT NOT NULL,
                created_at  TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_warranty_photos_item ON warranty_photos(item_id);
        """)
        try:
            conn.execute("ALTER TABLE items ADD COLUMN budget_applied INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE items ADD COLUMN warranty_years INTEGER")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE items ADD COLUMN warranty_start TEXT")
        except sqlite3.OperationalError:
            pass

        # Pre-existing installs still have list_id NOT NULL (from before
        # list deletion started detaching items instead of cascading them
        # away) — SQLite can't relax a NOT NULL constraint in place, so
        # rebuild the table. Fresh installs already get a nullable list_id
        # from the CREATE TABLE above and skip this.
        col = next(
            (r for r in conn.execute("PRAGMA table_info(items)").fetchall() if r["name"] == "list_id"),
            None,
        )
        if col is not None and col["notnull"]:
            conn.executescript("""
                ALTER TABLE items RENAME TO items_pre_history;
                CREATE TABLE items (
                    id          TEXT PRIMARY KEY,
                    list_id     TEXT REFERENCES lists(id) ON DELETE SET NULL,
                    name        TEXT NOT NULL,
                    quantity    REAL NOT NULL DEFAULT 1,
                    price       REAL,
                    category_id TEXT,
                    added_by    TEXT NOT NULL,
                    bought_at   TEXT,
                    bought_by   TEXT,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL,
                    budget_applied INTEGER NOT NULL DEFAULT 0,
                    warranty_years INTEGER,
                    warranty_start TEXT,
                    list_title_snapshot TEXT
                );
                INSERT INTO items (id,list_id,name,quantity,price,category_id,added_by,bought_at,bought_by,
                                    created_at,updated_at,budget_applied,warranty_years,warranty_start)
                    SELECT id,list_id,name,quantity,price,category_id,added_by,bought_at,bought_by,
                           created_at,updated_at,budget_applied,warranty_years,warranty_start
                    FROM items_pre_history;
                DROP TABLE items_pre_history;
                CREATE INDEX idx_items_list ON items(list_id, created_at);
            """)

        try:
            conn.execute("ALTER TABLE items ADD COLUMN list_title_snapshot TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE items ADD COLUMN warranty_end TEXT")
        except sqlite3.OperationalError:
            pass

        # Warranties used to be stored as start + a duration in years, with the
        # expiry date computed on every read (replace-year, Feb 29 fallback to
        # Feb 28). Editing now works off an explicit end date instead, so
        # backfill warranty_end once for any pre-existing warranty that only
        # has years, using that same replace-year rule.
        legacy = conn.execute(
            "SELECT id, warranty_start, warranty_years FROM items "
            "WHERE warranty_start IS NOT NULL AND warranty_years IS NOT NULL AND warranty_end IS NULL"
        ).fetchall()
        for r in legacy:
            start = datetime.fromisoformat(r["warranty_start"])
            years = r["warranty_years"]
            try:
                end = start.replace(year=start.year + years)
            except ValueError:
                end = start.replace(month=2, day=28, year=start.year + years)
            conn.execute("UPDATE items SET warranty_end=? WHERE id=?", (end.isoformat(), r["id"]))

        # The items rebuild above (ALTER TABLE items RENAME TO items_pre_history)
        # makes SQLite auto-rewrite warranty_photos' FK clause to point at
        # items_pre_history; once that table is dropped and a fresh items is
        # created, the FK is left dangling and every INSERT INTO warranty_photos
        # fails with "no such table: main.items_pre_history". Detect and repair.
        bad_fk = any(
            fk["table"] != "items"
            for fk in conn.execute("PRAGMA foreign_key_list(warranty_photos)").fetchall()
        )
        if bad_fk:
            conn.executescript("""
                ALTER TABLE warranty_photos RENAME TO warranty_photos_pre_fix;
                CREATE TABLE warranty_photos (
                    id          TEXT PRIMARY KEY,
                    item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
                    filename    TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );
                INSERT INTO warranty_photos SELECT * FROM warranty_photos_pre_fix;
                DROP TABLE warranty_photos_pre_fix;
                CREATE INDEX idx_warranty_photos_item ON warranty_photos(item_id);
            """)

        conn.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _private_page():
    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Shopping List</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}
.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}
.sub{font-size:.9rem;color:#6c7086}</style>
</head><body>
<div class="icon">🔒</div>
<div class="msg">Shopping List is private</div>
<div class="sub">Access is not available to the public.</div>
</body></html>""", status_code=403)


@router.get("/")
async def public_index():
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return _private_page()
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


# ── Helpers ──────────────────────────────────────────────────────

def _my_role(conn, list_id, user_id) -> Optional[str]:
    row = conn.execute(
        "SELECT role FROM list_members WHERE list_id=? AND user_id=?", (list_id, user_id)
    ).fetchone()
    return row["role"] if row else None


def _can_access_item(conn, row, user_id) -> bool:
    """Items whose list was deleted have list_id=NULL and become personal
    history — no list_members row to check anymore, so ownership falls
    back to whoever originally added the item."""
    if row["list_id"] is None:
        return row["added_by"] == user_id
    return _my_role(conn, row["list_id"], user_id) is not None


def _row_to_list(conn, row, me_id) -> dict:
    d = dict(row)
    lid = d["id"]
    d["role"] = _my_role(conn, lid, me_id)
    d["member_count"] = conn.execute(
        "SELECT COUNT(*) c FROM list_members WHERE list_id=?", (lid,)
    ).fetchone()["c"]
    counts = conn.execute(
        "SELECT COUNT(*) total, SUM(CASE WHEN bought_at IS NOT NULL THEN 1 ELSE 0 END) bought "
        "FROM items WHERE list_id=?", (lid,)
    ).fetchone()
    d["item_count"] = counts["total"] or 0
    d["bought_count"] = counts["bought"] or 0
    return d


def _profile_brief(p: dict) -> dict:
    return {
        "username": p.get("username"),
        "display_name": p.get("display_name"),
        "avatar_color": p.get("avatar_color"),
        "avatar_svg": p.get("avatar_svg"),
    }


def _warranty_info(row) -> Optional[dict]:
    if not row["warranty_start"] or not row["warranty_end"]:
        return None
    start = datetime.fromisoformat(row["warranty_start"])
    expires = datetime.fromisoformat(row["warranty_end"])
    now = datetime.now(timezone.utc)
    total_days = max((expires - start).days, 1)
    remaining_days = (expires - now).days
    elapsed_days = total_days - remaining_days
    progress_pct = max(0, min(100, round(elapsed_days / total_days * 100, 1)))
    return {
        "start": row["warranty_start"],
        "expires_at": expires.isoformat(),
        "remaining_days": remaining_days,
        "progress_pct": progress_pct,
        "expired": remaining_days < 0,
    }


def _item_warranty_photos(conn, item_id: str) -> list:
    rows = conn.execute(
        "SELECT id, filename, created_at FROM warranty_photos WHERE item_id=? ORDER BY created_at",
        (item_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "filename": r["filename"],
            "url": f"/pub/{APP_ID}/items/{item_id}/warranty/photos/{r['filename']}",
        }
        for r in rows
    ]


def _row_to_item(conn, row, profiles: dict) -> dict:
    d = dict(row)
    d["added_by_user"] = _profile_brief(profiles.get(row["added_by"], {}))
    d["bought_by_user"] = _profile_brief(profiles.get(row["bought_by"], {})) if row["bought_by"] else None
    d["warranty"] = _warranty_info(row)
    d["warranty_photos"] = _item_warranty_photos(conn, row["id"]) if d["warranty"] else []
    return d


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


# ── Item name suggestions ────────────────────────────────────────

@router.get("/item-suggestions")
async def item_suggestions(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT name, COUNT(*) c, MAX(created_at) last_at FROM items "
            "WHERE added_by=? GROUP BY name COLLATE NOCASE "
            "ORDER BY c DESC, last_at DESC LIMIT 20",
            (me["id"],),
        ).fetchall()
    return JSONResponse([r["name"] for r in rows])


# ── Budget lookup ────────────────────────────────────────────────

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


# ── Lists ────────────────────────────────────────────────────────

class ListBody(BaseModel):
    title: str


@router.get("/lists")
async def list_lists(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT l.* FROM lists l JOIN list_members lm ON lm.list_id=l.id "
            "WHERE lm.user_id=? AND l.archived=0 ORDER BY l.created_at",
            (me["id"],),
        ).fetchall()
        return JSONResponse([_row_to_list(conn, r, me["id"]) for r in rows])


@router.post("/lists")
async def create_list(body: ListBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    now = _now()
    lid = str(uuid.uuid4())
    with _db() as conn:
        conn.execute(
            "INSERT INTO lists(id,owner_id,title,archived,created_at,updated_at) VALUES(?,?,?,0,?,?)",
            (lid, me["id"], title, now, now),
        )
        conn.execute(
            "INSERT INTO list_members(list_id,user_id,role,created_at) VALUES(?,?,'owner',?)",
            (lid, me["id"], now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM lists WHERE id=?", (lid,)).fetchone()
        return JSONResponse(_row_to_list(conn, row, me["id"]))


@router.put("/lists/{list_id}")
async def update_list(list_id: str, body: ListBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    title = body.title.strip()[:200]
    if not title:
        return JSONResponse({"error": "title required"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, list_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        conn.execute("UPDATE lists SET title=?, updated_at=? WHERE id=?", (title, _now(), list_id))
        conn.commit()
        row = conn.execute("SELECT * FROM lists WHERE id=?", (list_id,)).fetchone()
        return JSONResponse(_row_to_list(conn, row, me["id"]))


@router.delete("/lists/{list_id}")
async def delete_list(list_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, list_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        lst = conn.execute("SELECT title FROM lists WHERE id=?", (list_id,)).fetchone()
        now = _now()
        # Soft delete: detach items instead of destroying them, so their
        # warranties/photos/history survive under GET /history. Only the
        # list row (and its list_members) actually goes away.
        conn.execute(
            "UPDATE items SET list_id=NULL, list_title_snapshot=?, updated_at=? WHERE list_id=?",
            (lst["title"] if lst else None, now, list_id),
        )
        conn.execute("DELETE FROM lists WHERE id=?", (list_id,))
        conn.commit()
    return JSONResponse({"ok": True})


# ── Items ────────────────────────────────────────────────────────

class ItemBody(BaseModel):
    name: str
    quantity: float = 1
    price: Optional[float] = None
    category_id: Optional[str] = None


def _validate_item(body: "ItemBody") -> Optional[str]:
    if body.quantity <= 0:
        return "quantity must be > 0"
    if body.price is not None and body.price < 0:
        return "price must be >= 0"
    return None


@router.get("/lists/{list_id}/items")
async def list_items(list_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, list_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM items WHERE list_id=? ORDER BY (bought_at IS NOT NULL), created_at",
            (list_id,),
        ).fetchall()
    hub = _hub()
    ids = {r["added_by"] for r in rows} | {r["bought_by"] for r in rows if r["bought_by"]}
    profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub and ids else {}
    with _db() as conn:
        return JSONResponse([_row_to_item(conn, r, profiles) for r in rows])


@router.post("/lists/{list_id}/items")
async def add_item(list_id: str, body: ItemBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    name = body.name.strip()[:200]
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    err = _validate_item(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)
    now = _now()
    iid = str(uuid.uuid4())
    with _db() as conn:
        if not _my_role(conn, list_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "INSERT INTO items(id,list_id,name,quantity,price,category_id,added_by,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (iid, list_id, name, body.quantity, body.price, body.category_id, me["id"], now, now),
        )
        conn.execute("UPDATE lists SET updated_at=? WHERE id=?", (now, list_id))
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (iid,)).fetchone()
        profiles = {me["id"]: me}
        return JSONResponse(_row_to_item(conn, row, profiles))


@router.put("/items/{item_id}")
async def update_item(item_id: str, body: ItemBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    name = body.name.strip()[:200]
    if not name:
        return JSONResponse({"error": "name required"}, status_code=400)
    err = _validate_item(body)
    if err:
        return JSONResponse({"error": err}, status_code=400)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["bought_at"]:
            return JSONResponse({"error": "already bought"}, status_code=400)
        conn.execute(
            "UPDATE items SET name=?, quantity=?, price=?, category_id=?, updated_at=? WHERE id=?",
            (name, body.quantity, body.price, body.category_id, _now(), item_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    hub = _hub()
    ids = {row["added_by"]}
    profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub else {}
    with _db() as conn:
        return JSONResponse(_row_to_item(conn, row, profiles))


@router.delete("/items/{item_id}")
async def delete_item(item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute("DELETE FROM items WHERE id=?", (item_id,))
        conn.commit()
    shutil.rmtree(os.path.join(_WARRANTY_UPLOADS_DIR, item_id), ignore_errors=True)
    return JSONResponse({"ok": True})


@router.post("/items/{item_id}/buy")
async def buy_item(item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        if row["bought_at"]:
            return JSONResponse({"error": "already bought"}, status_code=400)

        budget_ok = None
        budget_applied = 0
        if row["category_id"] and row["price"] is not None:
            hub = _hub()
            amount = -round(row["price"] * row["quantity"], 2)
            try:
                hub.call_app_api(
                    "budget", "add_to_category", me["id"], row["category_id"], amount,
                    source_app="shoppinglist", source_app_name="Списък за пазаруване",
                    reason=f"Пазаруване: {row['name']}",
                    idempotency_key=f"shoppinglist:buy:{item_id}:{now}",
                )
                budget_ok = True
                budget_applied = 1
            except Exception:
                budget_ok = False

        conn.execute(
            "UPDATE items SET bought_at=?, bought_by=?, budget_applied=?, updated_at=? WHERE id=?",
            (now, me["id"], budget_applied, now, item_id),
        )
        conn.execute("UPDATE lists SET updated_at=? WHERE id=?", (now, row["list_id"]))
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    hub = _hub()
    ids = {row["added_by"], row["bought_by"]}
    profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub else {}
    with _db() as conn:
        d = _row_to_item(conn, row, profiles)
    d["budget_ok"] = budget_ok
    return JSONResponse(d)


@router.post("/items/{item_id}/unbuy")
async def unbuy_item(item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    now = _now()
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        if not row["bought_at"]:
            return JSONResponse({"error": "not bought"}, status_code=400)

        budget_ok = None
        if row["budget_applied"] and row["category_id"] and row["price"] is not None:
            hub = _hub()
            amount = round(row["price"] * row["quantity"], 2)
            try:
                hub.call_app_api(
                    "budget", "add_to_category", me["id"], row["category_id"], amount,
                    source_app="shoppinglist", source_app_name="Списък за пазаруване",
                    reason=f"Отмаркиране: {row['name']}",
                    idempotency_key=f"shoppinglist:unbuy:{item_id}:{row['bought_at']}",
                )
                budget_ok = True
            except Exception:
                budget_ok = False

        conn.execute(
            "UPDATE items SET bought_at=NULL, bought_by=NULL, budget_applied=0, updated_at=? WHERE id=?",
            (now, item_id),
        )
        conn.execute("UPDATE lists SET updated_at=? WHERE id=?", (now, row["list_id"]))
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    hub = _hub()
    ids = {row["added_by"]}
    profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub else {}
    with _db() as conn:
        d = _row_to_item(conn, row, profiles)
    d["budget_ok"] = budget_ok
    return JSONResponse(d)


# ── Warranty ─────────────────────────────────────────────────────

class WarrantyBody(BaseModel):
    start_date: str  # "YYYY-MM-DD"
    end_date: str    # "YYYY-MM-DD"


@router.put("/items/{item_id}/warranty")
async def set_warranty(item_id: str, body: WarrantyBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        start = datetime.fromisoformat(body.start_date).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(body.end_date).replace(tzinfo=timezone.utc)
    except ValueError:
        return JSONResponse({"error": "invalid date"}, status_code=400)
    if end <= start:
        return JSONResponse({"error": "end date must be after start date"}, status_code=400)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE items SET warranty_years=NULL, warranty_start=?, warranty_end=?, updated_at=? WHERE id=?",
            (start.isoformat(), end.isoformat(), _now(), item_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        hub = _hub()
        profiles = {p["id"]: p for p in hub.get_users_by_ids([row["added_by"]])} if hub else {}
        return JSONResponse(_row_to_item(conn, row, profiles))


@router.delete("/items/{item_id}/warranty")
async def clear_warranty(item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE items SET warranty_years=NULL, warranty_start=NULL, warranty_end=NULL, updated_at=? WHERE id=?",
            (_now(), item_id),
        )
        conn.execute("DELETE FROM warranty_photos WHERE item_id=?", (item_id,))
        conn.commit()
    shutil.rmtree(os.path.join(_WARRANTY_UPLOADS_DIR, item_id), ignore_errors=True)
    return JSONResponse({"ok": True})


@router.post("/items/{item_id}/warranty/photos")
async def upload_warranty_photo(
    item_id: str, file: UploadFile = File(...), x_pub_token: str = Header(default=None)
):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    fname = file.filename or ""
    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    if ext not in ALLOWED_UPLOAD_EXT:
        return JSONResponse({"error": "unsupported file type"}, status_code=400)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        if not row["warranty_start"]:
            return JSONResponse({"error": "no warranty set"}, status_code=400)

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": "file too large"}, status_code=400)

    item_dir = os.path.join(_WARRANTY_UPLOADS_DIR, item_id)
    os.makedirs(item_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(item_dir, filename), "wb") as f:
        f.write(contents)

    with _db() as conn:
        conn.execute(
            "INSERT INTO warranty_photos(id,item_id,filename,created_at) VALUES(?,?,?,?)",
            (str(uuid.uuid4()), item_id, filename, _now()),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        hub = _hub()
        profiles = {p["id"]: p for p in hub.get_users_by_ids([row["added_by"]])} if hub else {}
        return JSONResponse(_row_to_item(conn, row, profiles))


@router.get("/items/{item_id}/warranty/photos/{filename}")
async def serve_warranty_photo(item_id: str, filename: str):
    if not _UPLOAD_FILENAME_RE.match(filename):
        return JSONResponse({"error": "not found"}, status_code=404)
    path = os.path.join(_WARRANTY_UPLOADS_DIR, item_id, filename)
    if not os.path.isfile(path):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path)


@router.delete("/items/{item_id}/warranty/photos/{photo_id}")
async def delete_warranty_photo(item_id: str, photo_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        if not row or not _can_access_item(conn, row, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        photo = conn.execute(
            "SELECT * FROM warranty_photos WHERE id=? AND item_id=?", (photo_id, item_id)
        ).fetchone()
        if not photo:
            return JSONResponse({"error": "not found"}, status_code=404)
        filename = photo["filename"]
        conn.execute("DELETE FROM warranty_photos WHERE id=?", (photo_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
        hub = _hub()
        profiles = {p["id"]: p for p in hub.get_users_by_ids([row["added_by"]])} if hub else {}
        result = _row_to_item(conn, row, profiles)
    try:
        os.remove(os.path.join(_WARRANTY_UPLOADS_DIR, item_id, filename))
    except OSError:
        pass
    return JSONResponse(result)


@router.get("/warranties")
async def list_warranties(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT i.*, l.title AS list_title FROM items i "
            "JOIN list_members lm ON lm.list_id=i.list_id AND lm.user_id=? "
            "JOIN lists l ON l.id=i.list_id "
            "WHERE i.warranty_start IS NOT NULL "
            "UNION ALL "
            "SELECT i.*, i.list_title_snapshot AS list_title FROM items i "
            "WHERE i.warranty_start IS NOT NULL AND i.list_id IS NULL AND i.added_by=?",
            (me["id"], me["id"]),
        ).fetchall()
        ids = {r["added_by"] for r in rows}
        hub = _hub()
        profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub and ids else {}
        result = [_row_to_item(conn, r, profiles) for r in rows]
    result.sort(key=lambda d: d["warranty"]["expires_at"])
    return JSONResponse(result)


# ── History (items detached from a deleted list) ────────────────

@router.get("/history")
async def list_history(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM items WHERE list_id IS NULL AND added_by=? ORDER BY updated_at DESC",
            (me["id"],),
        ).fetchall()
        ids = {r["bought_by"] for r in rows if r["bought_by"]} | {me["id"]}
        hub = _hub()
        profiles = {p["id"]: p for p in hub.get_users_by_ids(list(ids))} if hub and ids else {}
        return JSONResponse([_row_to_item(conn, r, profiles) for r in rows])


# ── Members (sharing) ───────────────────────────────────────────

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


@router.get("/lists/{list_id}/members")
async def list_members(list_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, list_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT user_id, role, created_at FROM list_members WHERE list_id=? "
            "ORDER BY role DESC, created_at",
            (list_id,),
        ).fetchall()
    hub = _hub()
    profiles = {}
    if hub:
        profiles = {p["id"]: p for p in hub.get_users_by_ids([r["user_id"] for r in rows])}
    return JSONResponse([_member_row_to_dict(r, profiles) for r in rows])


@router.post("/lists/{list_id}/members")
async def add_member(list_id: str, body: MemberBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    if not hub:
        return JSONResponse({"error": "apps hub unavailable"}, status_code=500)

    with _db() as conn:
        role = _my_role(conn, list_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)

        favourites = hub.get_favourites(me["id"])
        if body.user_id not in {f["id"] for f in favourites}:
            return JSONResponse({"error": "user is not in your favourites"}, status_code=400)

        if _my_role(conn, list_id, body.user_id):
            return JSONResponse({"error": "already a member"}, status_code=400)

        lst = conn.execute("SELECT title FROM lists WHERE id=?", (list_id,)).fetchone()
        now = _now()
        conn.execute(
            "INSERT INTO list_members(list_id,user_id,role,created_at) VALUES(?,?,'member',?)",
            (list_id, body.user_id, now),
        )
        conn.commit()

    _notify_share(hub, me, body.user_id, list_id, lst["title"] if lst else "")

    profiles = {p["id"]: p for p in hub.get_users_by_ids([body.user_id])}
    with _db() as conn:
        row = conn.execute(
            "SELECT user_id, role, created_at FROM list_members WHERE list_id=? AND user_id=?",
            (list_id, body.user_id),
        ).fetchone()
    return JSONResponse(_member_row_to_dict(row, profiles))


@router.delete("/lists/{list_id}/members/{user_id}")
async def remove_member(list_id: str, user_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        my_role = _my_role(conn, list_id, me["id"])
        if not my_role:
            return JSONResponse({"error": "not found"}, status_code=404)

        if user_id == me["id"]:
            if my_role == "owner":
                return JSONResponse({"error": "owner cannot leave, delete the list instead"}, status_code=400)
        elif my_role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        else:
            target_role = _my_role(conn, list_id, user_id)
            if not target_role:
                return JSONResponse({"error": "not found"}, status_code=404)
            if target_role == "owner":
                return JSONResponse({"error": "cannot remove the owner"}, status_code=400)

        conn.execute(
            "DELETE FROM list_members WHERE list_id=? AND user_id=?", (list_id, user_id)
        )
        conn.commit()
    return JSONResponse({"ok": True})


def _notify_share(hub, from_user: dict, to_id: str, list_id: str, list_title: str):
    """Unconditional notification when a list is shared — mirrors Budget's
    _notify_share, since shoppinglist has no realtime connection to check
    for presence."""
    users = hub.get_users_by_ids([to_id])
    if not users or not users[0].get("username"):
        return
    sender = from_user.get("display_name", "?")
    body = f'{sender} сподели списък за пазаруване "{list_title}" с теб.'

    notif = sys.modules.get("backend.notifications")
    if notif:
        notif.create_notification(
            users[0]["username"], "🛒 Споделен списък", body, kind="persistent",
            source="shoppinglist", action_app="shoppinglist", ref=list_id,
        )

    tg = sys.modules.get("app_backend_telegramhub")
    if tg:
        base = tg.get_public_base_url() or ""
        url = f"{base.rstrip('/')}/pub/shoppinglist/"
        tg.notify(to_id, "shoppinglist", f"🛒 {body}", web_app=url)
