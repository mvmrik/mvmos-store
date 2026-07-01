import os
import sys
import sqlite3
import secrets
from typing import Optional
from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/quotebuilder")

_DB_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "apps", "quotebuilder", "data.db"
)


def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _init_db():
    with _conn() as c:
        c.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                public_user_id TEXT NOT NULL,
                key            TEXT NOT NULL,
                value          TEXT,
                PRIMARY KEY (public_user_id, key)
            );
            CREATE TABLE IF NOT EXISTS base_services (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                name           TEXT NOT NULL,
                hours          REAL NOT NULL DEFAULT 1,
                description    TEXT,
                fixed_price    REAL
            );
            CREATE TABLE IF NOT EXISTS categories (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id TEXT NOT NULL,
                name           TEXT NOT NULL,
                UNIQUE (public_user_id, name)
            );
            CREATE TABLE IF NOT EXISTS projects (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                public_user_id   TEXT NOT NULL,
                name             TEXT NOT NULL,
                hourly_rate      REAL,
                deposit_percent  REAL,
                discount_percent REAL NOT NULL DEFAULT 0,
                created_at       TEXT NOT NULL DEFAULT (datetime('now')),
                public_token     TEXT,
                show_hours       INTEGER NOT NULL DEFAULT 1,
                show_rate        INTEGER NOT NULL DEFAULT 1,
                public_lang      TEXT NOT NULL DEFAULT 'en'
            );
            CREATE TABLE IF NOT EXISTS project_services (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                hours       REAL NOT NULL DEFAULT 1,
                description TEXT,
                fixed_price REAL
            );
        """)
        try:
            c.execute("ALTER TABLE base_services ADD COLUMN category TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE base_services ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE project_services ADD COLUMN category TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            c.execute("ALTER TABLE project_services ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        c.commit()


_init_db()


def _pub_user(x_pub_token):
    hub = sys.modules.get("backend.apphub")
    if not hub or not x_pub_token:
        return None
    return hub.get_pub_session(x_pub_token)


def _require_user(x_pub_token):
    u = _pub_user(x_pub_token)
    if not u:
        return None
    return u["id"]


def _unauthorized():
    return JSONResponse({"error": "login_required"}, status_code=401)


def _not_found():
    return JSONResponse({"error": "not_found"}, status_code=404)


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings")
async def get_settings(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute("SELECT key, value FROM settings WHERE public_user_id=?", (uid,)).fetchall()
    return JSONResponse({r["key"]: r["value"] for r in rows})


class SettingsBody(BaseModel):
    hourly_rate: float = 50
    currency: str = "€"
    deposit_percent: float = 0


@router.put("/settings")
async def save_settings(body: SettingsBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        for key, value in body.model_dump().items():
            c.execute(
                "INSERT OR REPLACE INTO settings (public_user_id, key, value) VALUES (?,?,?)",
                (uid, key, str(value)),
            )
        c.commit()
    return JSONResponse({"ok": True})


# ── Templates (base services) ──────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute("SELECT * FROM base_services WHERE public_user_id=? ORDER BY sort_order, name", (uid,)).fetchall()
    return JSONResponse([dict(r) for r in rows])


class TemplateBody(BaseModel):
    name: str
    description: str = ""
    hours: float = 0
    fixed_price: Optional[float] = None
    category: str = ""


@router.post("/templates")
async def add_template(body: TemplateBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute(
            "INSERT INTO base_services (public_user_id, name, description, hours, fixed_price, category) VALUES (?,?,?,?,?,?)",
            (uid, body.name, body.description, body.hours, body.fixed_price, body.category or None),
        )
        c.commit()
        row = c.execute("SELECT * FROM base_services WHERE id=?", (cur.lastrowid,)).fetchone()
    return JSONResponse(dict(row))


class TemplateUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    hours: Optional[float] = None
    fixed_price: Optional[float] = None
    category: Optional[str] = None


@router.put("/templates/{tid}")
async def update_template(tid: int, body: TemplateUpdateBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return JSONResponse({"ok": True})
    set_sql = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        cur = c.execute(
            f"UPDATE base_services SET {set_sql} WHERE id=? AND public_user_id=?",
            (*fields.values(), tid, uid),
        )
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


class ReorderBody(BaseModel):
    order: list[int]


@router.post("/templates/reorder")
async def reorder_templates(body: ReorderBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        for i, tid in enumerate(body.order):
            c.execute("UPDATE base_services SET sort_order=? WHERE id=? AND public_user_id=?", (i, tid, uid))
        c.commit()
    return JSONResponse({"ok": True})


@router.delete("/templates/{tid}")
async def delete_template(tid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("DELETE FROM base_services WHERE id=? AND public_user_id=?", (tid, uid))
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


# ── Categories ──────────────────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute("SELECT * FROM categories WHERE public_user_id=? ORDER BY sort_order, name", (uid,)).fetchall()
    return JSONResponse([dict(r) for r in rows])


class CategoryBody(BaseModel):
    name: str


@router.post("/categories")
async def add_category(body: CategoryBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    name = body.name.strip()
    if not name:
        return JSONResponse({"error": "name_required"}, status_code=400)
    with _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO categories (public_user_id, name) VALUES (?,?)",
            (uid, name),
        )
        c.commit()
        row = c.execute("SELECT * FROM categories WHERE public_user_id=? AND name=?", (uid, name)).fetchone()
    return JSONResponse(dict(row))


@router.post("/categories/reorder")
async def reorder_categories(body: ReorderBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        for i, cid in enumerate(body.order):
            c.execute("UPDATE categories SET sort_order=? WHERE id=? AND public_user_id=?", (i, cid, uid))
        c.commit()
    return JSONResponse({"ok": True})


@router.delete("/categories/{cid}")
async def delete_category(cid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("DELETE FROM categories WHERE id=? AND public_user_id=?", (cid, uid))
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


# ── Projects ────────────────────────────────────────────────────────────────────

@router.get("/projects")
async def list_projects(session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        rows = c.execute("SELECT * FROM projects WHERE public_user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
    return JSONResponse([dict(r) for r in rows])


@router.get("/projects/{pid}")
async def get_project(pid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        row = c.execute("SELECT * FROM projects WHERE id=? AND public_user_id=?", (pid, uid)).fetchone()
    if not row:
        return _not_found()
    return JSONResponse(dict(row))


class ProjectBody(BaseModel):
    name: str


@router.post("/projects")
async def add_project(body: ProjectBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("INSERT INTO projects (public_user_id, name) VALUES (?,?)", (uid, body.name))
        c.commit()
        row = c.execute("SELECT * FROM projects WHERE id=?", (cur.lastrowid,)).fetchone()
    return JSONResponse(dict(row))


class ProjectUpdateBody(BaseModel):
    name: Optional[str] = None
    hourly_rate: Optional[float] = None
    deposit_percent: Optional[float] = None
    discount_percent: Optional[float] = None
    show_hours: Optional[int] = None
    show_rate: Optional[int] = None
    public_lang: Optional[str] = None


@router.put("/projects/{pid}")
async def update_project(pid: int, body: ProjectUpdateBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return JSONResponse({"ok": True})
    set_sql = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        cur = c.execute(
            f"UPDATE projects SET {set_sql} WHERE id=? AND public_user_id=?",
            (*fields.values(), pid, uid),
        )
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


@router.delete("/projects/{pid}")
async def delete_project(pid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute("DELETE FROM projects WHERE id=? AND public_user_id=?", (pid, uid))
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


class ShareTokenBody(BaseModel):
    lang: str = "en"


@router.post("/projects/{pid}/share-token")
async def ensure_share_token(pid: int, body: ShareTokenBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        row = c.execute("SELECT * FROM projects WHERE id=? AND public_user_id=?", (pid, uid)).fetchone()
        if not row:
            return _not_found()
        if row["public_token"]:
            return JSONResponse({"public_token": row["public_token"], "public_lang": row["public_lang"]})
        token = secrets.token_hex(16)
        c.execute("UPDATE projects SET public_token=?, public_lang=? WHERE id=?", (token, body.lang, pid))
        c.commit()
    return JSONResponse({"public_token": token, "public_lang": body.lang})


# ── Project services ──────────────────────────────────────────────────────────

@router.get("/projects/{pid}/services")
async def list_project_services(pid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        owns = c.execute("SELECT 1 FROM projects WHERE id=? AND public_user_id=?", (pid, uid)).fetchone()
        if not owns:
            return _not_found()
        rows = c.execute(
            "SELECT ps.* FROM project_services ps "
            "LEFT JOIN categories cat ON cat.public_user_id=? AND cat.name=ps.category "
            "WHERE ps.project_id=? "
            "ORDER BY COALESCE(cat.sort_order, 999999), ps.sort_order, ps.id",
            (uid, pid),
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])


class ProjectServiceBody(BaseModel):
    name: str
    description: str = ""
    hours: float = 0
    fixed_price: Optional[float] = None
    category: str = ""
    sort_order: int = 0


@router.post("/projects/{pid}/services")
async def add_project_service(pid: int, body: ProjectServiceBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        owns = c.execute("SELECT 1 FROM projects WHERE id=? AND public_user_id=?", (pid, uid)).fetchone()
        if not owns:
            return _not_found()
        cur = c.execute(
            "INSERT INTO project_services (project_id, name, description, hours, fixed_price, category, sort_order) VALUES (?,?,?,?,?,?,?)",
            (pid, body.name, body.description, body.hours, body.fixed_price, body.category or None, body.sort_order),
        )
        c.commit()
        row = c.execute("SELECT * FROM project_services WHERE id=?", (cur.lastrowid,)).fetchone()
    return JSONResponse(dict(row))


class ProjectServiceUpdateBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    hours: Optional[float] = None
    fixed_price: Optional[float] = None


@router.put("/projects/{pid}/services/{sid}")
async def update_project_service(pid: int, sid: int, body: ProjectServiceUpdateBody, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return JSONResponse({"ok": True})
    set_sql = ", ".join(f"{k}=?" for k in fields)
    with _conn() as c:
        cur = c.execute(
            f"UPDATE project_services SET {set_sql} "
            "WHERE id=? AND project_id IN (SELECT id FROM projects WHERE id=? AND public_user_id=?)",
            (*fields.values(), sid, pid, uid),
        )
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})


@router.delete("/projects/{pid}/services/{sid}")
async def delete_project_service(pid: int, sid: int, session=Depends(get_current_session), x_pub_token: Optional[str] = Header(default=None)):
    uid = _require_user(x_pub_token)
    if not uid:
        return _unauthorized()
    with _conn() as c:
        cur = c.execute(
            "DELETE FROM project_services "
            "WHERE id=? AND project_id IN (SELECT id FROM projects WHERE id=? AND public_user_id=?)",
            (sid, pid, uid),
        )
        c.commit()
    if cur.rowcount == 0:
        return _not_found()
    return JSONResponse({"ok": True})
