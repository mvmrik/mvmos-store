"""
mvmSiteBuilder — WordPress-like site builder, one shared app instance,
many sites owned by Apps Hub accounts.

Mounted at /pub/mvmsitebuilder by public_loader.py. Identity is always the
Apps Hub token (X-Pub-Token header) — same pattern as backend/apps/budget/
public.py, no separate registration/login system of our own.

A site's content is a list of pages, each page an ordered JSON list of
{type, data} blocks rendered through blocks.py's BLOCK_RENDERERS registry.
Visual styling is a theme folder picked up by themes.py's list_themes().
Both registries are the "add a module without touching this file" points —
see blocks.py's docstring.

Access control: site_members(site_id, user_id, role) — 'owner' | 'editor' |
'viewer', same reasoning as budget's category_members (a single joined
table instead of an owner_id-or-shared special case). Only the owner can
manage members or delete the site; owner+editor can edit content/design.

Custom domains are intentionally out of scope for v1 — sites are only
reachable at /pub/mvmsitebuilder/<slug>/... for now, same as any other
public app. Mapping a domain straight to a single site will build on top
of the existing msc/domains system later (a deliberate, separate change).
"""

import html as _html
import importlib.util
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, File, Form, Header, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel

router = APIRouter()

APP_ID = "mvmsitebuilder"

_DIR          = os.path.dirname(__file__)                                          # apps/mvmsitebuilder


def _load_sibling(name: str):
    # public_loader.py exec()s this file as a standalone module (not a real
    # package, to avoid stale-.pyc reuse), so `from .blocks import ...` has
    # no parent package to resolve against. Load blocks.py/themes.py by file
    # path instead — they're leaf modules with no imports of their own.
    path = os.path.join(_DIR, f"{name}.py")
    spec = importlib.util.spec_from_file_location(f"mvmsitebuilder_{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


render_blocks = _load_sibling("blocks").render_blocks
_themes_mod = _load_sibling("themes")
list_themes, theme_exists, theme_css_path, theme_template_path, install_theme_from_zip = (
    _themes_mod.list_themes, _themes_mod.theme_exists,
    _themes_mod.theme_css_path, _themes_mod.theme_template_path,
    _themes_mod.install_theme_from_zip,
)
_APP_DIR      = _DIR                                                                # apps/mvmsitebuilder
_DB_PATH      = os.path.join(_APP_DIR, "data.db")
_PUBLIC_DIR   = os.path.join(_APP_DIR, "public")
_UPLOADS_DIR  = os.path.join(_PUBLIC_DIR, "uploads")

RESERVED_SLUGS = {"sites", "themes", "uploads", "api"}
ROLES = ("owner", "editor", "viewer")
EDIT_ROLES = ("owner", "editor")
ALLOWED_UPLOAD_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024


def _hub():
    return sys.modules.get("backend.apphub")


def _render_404(message_en: str, message_bg: str) -> HTMLResponse:
    mod = sys.modules.get("backend.notfound")
    if not mod:
        return HTMLResponse("Not Found", status_code=404)
    return mod.render_404(message_en, message_bg)


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db():
    os.makedirs(_UPLOADS_DIR, exist_ok=True)
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sites (
                id          TEXT PRIMARY KEY,
                owner_id    TEXT NOT NULL,
                name        TEXT NOT NULL,
                slug        TEXT NOT NULL UNIQUE,
                theme       TEXT NOT NULL DEFAULT 'default',
                custom_css  TEXT NOT NULL DEFAULT '',
                custom_js   TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS site_members (
                site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
                user_id     TEXT NOT NULL,
                role        TEXT NOT NULL DEFAULT 'editor',
                created_at  TEXT NOT NULL,
                PRIMARY KEY (site_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_site_members_user ON site_members(user_id);

            CREATE TABLE IF NOT EXISTS pages (
                id          TEXT PRIMARY KEY,
                site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
                slug        TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                blocks      TEXT NOT NULL DEFAULT '[]',
                is_homepage INTEGER NOT NULL DEFAULT 0,
                status      TEXT NOT NULL DEFAULT 'draft',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                UNIQUE(site_id, slug)
            );
            CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

            CREATE TABLE IF NOT EXISTS menu_items (
                id          TEXT PRIMARY KEY,
                site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
                label       TEXT NOT NULL,
                target_type TEXT NOT NULL DEFAULT 'page',
                target      TEXT NOT NULL DEFAULT '',
                sort_order  INTEGER NOT NULL DEFAULT 0,
                parent_id   TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_menu_items_site ON menu_items(site_id);
        """)
        conn.commit()


_init_db()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _esc(s) -> str:
    return _html.escape(str(s or ""), quote=True)


def _resolve(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    s = _SLUG_RE.sub("-", str(text or "").strip().lower()).strip("-")
    return s or "site"


def _unique_slug(conn, table: str, base: str, site_id: Optional[str] = None) -> str:
    base = _slugify(base)
    slug = base
    n = 2
    while True:
        if slug in RESERVED_SLUGS:
            slug = f"{base}-{n}"
            n += 1
            continue
        if table == "sites":
            row = conn.execute("SELECT id FROM sites WHERE slug=?", (slug,)).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM pages WHERE site_id=? AND slug=?", (site_id, slug)
            ).fetchone()
        if not row:
            return slug
        slug = f"{base}-{n}"
        n += 1


def _my_role(conn, site_id: str, user_id: str) -> Optional[str]:
    row = conn.execute(
        "SELECT role FROM site_members WHERE site_id=? AND user_id=?", (site_id, user_id)
    ).fetchone()
    return row["role"] if row else None


def _site_to_dict(conn, row, me_id: str) -> dict:
    d = dict(row)
    d["role"] = _my_role(conn, d["id"], me_id)
    d["member_count"] = conn.execute(
        "SELECT COUNT(*) c FROM site_members WHERE site_id=?", (d["id"],)
    ).fetchone()["c"]
    return d


def _page_to_dict(row) -> dict:
    d = dict(row)
    try:
        d["blocks"] = json.loads(d["blocks"])
    except (TypeError, ValueError):
        d["blocks"] = []
    return d


def _menu_item_to_dict(row) -> dict:
    return dict(row)


# ── Themes ───────────────────────────────────────────────────────

@router.get("/themes")
async def get_themes():
    return JSONResponse(list_themes())


# Same staging dir the core chunk-uploader (backend/files.py, noFinalize=1)
# writes to — the frontend uploads the zip there first (session-cookie auth,
# handles progress UI itself), then hands us the resulting path here. We only
# ever open files under this exact directory, never a client-supplied path
# elsewhere on disk.
_CHUNK_TMP_DIR = "/tmp/mvmos-uploads"


@router.post("/themes/upload")
async def upload_theme(theme_id: str = Form(...), tmp_path: str = Form(...),
                        x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    real_dir = os.path.dirname(os.path.abspath(tmp_path))
    if real_dir != os.path.abspath(_CHUNK_TMP_DIR) or not os.path.isfile(tmp_path):
        return JSONResponse({"error": "invalid upload"}, status_code=400)
    try:
        meta = install_theme_from_zip(theme_id.strip().lower(), tmp_path, me["id"])
    except PermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
    return JSONResponse(meta)


# ── Sites ────────────────────────────────────────────────────────

class SiteBody(BaseModel):
    name: str
    slug: Optional[str] = None
    theme: Optional[str] = None
    custom_css: Optional[str] = None
    custom_js: Optional[str] = None


@router.get("/sites")
async def list_sites(x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        rows = conn.execute(
            "SELECT s.* FROM sites s JOIN site_members m ON m.site_id = s.id "
            "WHERE m.user_id = ? ORDER BY s.created_at DESC",
            (me["id"],),
        ).fetchall()
        return JSONResponse([_site_to_dict(conn, r, me["id"]) for r in rows])


@router.post("/sites")
async def create_site(body: SiteBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if not body.name.strip():
        return JSONResponse({"error": "name is required"}, status_code=400)
    with _db() as conn:
        site_id = str(uuid.uuid4())
        slug = _unique_slug(conn, "sites", body.slug or body.name)
        now = _now()
        conn.execute(
            "INSERT INTO sites(id,owner_id,name,slug,theme,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?)",
            (site_id, me["id"], body.name.strip(), slug, "default", now, now),
        )
        conn.execute(
            "INSERT INTO site_members(site_id,user_id,role,created_at) VALUES(?,?,'owner',?)",
            (site_id, me["id"], now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
        return JSONResponse(_site_to_dict(conn, row, me["id"]))


@router.get("/sites/{site_id}")
async def get_site(site_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, site_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(_site_to_dict(conn, row, me["id"]))


@router.put("/sites/{site_id}")
async def update_site(site_id: str, body: SiteBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        if body.theme is not None and not theme_exists(body.theme):
            return JSONResponse({"error": "unknown theme"}, status_code=400)
        slug = row["slug"]
        if body.slug and body.slug != row["slug"]:
            slug = _unique_slug(conn, "sites", body.slug)
        conn.execute(
            "UPDATE sites SET name=?, slug=?, theme=?, custom_css=?, custom_js=?, updated_at=? WHERE id=?",
            (
                body.name.strip() or row["name"],
                slug,
                body.theme if body.theme is not None else row["theme"],
                body.custom_css if body.custom_css is not None else row["custom_css"],
                body.custom_js if body.custom_js is not None else row["custom_js"],
                _now(),
                site_id,
            ),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()
        return JSONResponse(_site_to_dict(conn, row, me["id"]))


@router.delete("/sites/{site_id}")
async def delete_site(site_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        conn.execute("DELETE FROM sites WHERE id=?", (site_id,))
        conn.commit()
        return JSONResponse({"ok": True})


# ── Pages ────────────────────────────────────────────────────────

class PageBody(BaseModel):
    title: str = ""
    slug: Optional[str] = None
    blocks: list = []
    status: Optional[str] = None


@router.get("/sites/{site_id}/pages")
async def list_pages(site_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, site_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM pages WHERE site_id=? ORDER BY sort_order, created_at", (site_id,)
        ).fetchall()
        return JSONResponse([_page_to_dict(r) for r in rows])


@router.post("/sites/{site_id}/pages")
async def create_page(site_id: str, body: PageBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        page_id = str(uuid.uuid4())
        slug = _unique_slug(conn, "pages", body.slug or body.title or "page", site_id=site_id)
        now = _now()
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order),-1) m FROM pages WHERE site_id=?", (site_id,)
        ).fetchone()["m"]
        is_homepage = 1 if conn.execute(
            "SELECT COUNT(*) c FROM pages WHERE site_id=?", (site_id,)
        ).fetchone()["c"] == 0 else 0
        conn.execute(
            "INSERT INTO pages(id,site_id,slug,title,blocks,is_homepage,status,sort_order,created_at,updated_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?)",
            (page_id, site_id, slug, body.title.strip(), json.dumps(body.blocks or []),
             is_homepage, body.status if body.status in ("draft", "published") else "draft",
             max_order + 1, now, now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pages WHERE id=?", (page_id,)).fetchone()
        return JSONResponse(_page_to_dict(row))


@router.put("/sites/{site_id}/pages/{page_id}")
async def update_page(site_id: str, page_id: str, body: PageBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        row = conn.execute("SELECT * FROM pages WHERE id=? AND site_id=?", (page_id, site_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        slug = row["slug"]
        if body.slug and body.slug != row["slug"]:
            slug = _unique_slug(conn, "pages", body.slug, site_id=site_id)
        status = body.status if body.status in ("draft", "published") else row["status"]
        conn.execute(
            "UPDATE pages SET slug=?, title=?, blocks=?, status=?, updated_at=? WHERE id=?",
            (slug, body.title.strip() or row["title"], json.dumps(body.blocks or []), status, _now(), page_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM pages WHERE id=?", (page_id,)).fetchone()
        return JSONResponse(_page_to_dict(row))


@router.post("/sites/{site_id}/pages/{page_id}/homepage")
async def set_homepage(site_id: str, page_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        row = conn.execute("SELECT * FROM pages WHERE id=? AND site_id=?", (page_id, site_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute("UPDATE pages SET is_homepage=0 WHERE site_id=?", (site_id,))
        conn.execute("UPDATE pages SET is_homepage=1 WHERE id=?", (page_id,))
        conn.commit()
        return JSONResponse({"ok": True})


@router.delete("/sites/{site_id}/pages/{page_id}")
async def delete_page(site_id: str, page_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        conn.execute("DELETE FROM pages WHERE id=? AND site_id=?", (page_id, site_id))
        conn.commit()
        return JSONResponse({"ok": True})


# ── Menu items ───────────────────────────────────────────────────

class MenuItemBody(BaseModel):
    label: str
    target_type: str = "page"   # 'page' | 'url'
    target: str = ""
    sort_order: int = 0


@router.get("/sites/{site_id}/menu-items")
async def list_menu_items(site_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        if not _my_role(conn, site_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT * FROM menu_items WHERE site_id=? ORDER BY sort_order", (site_id,)
        ).fetchall()
        return JSONResponse([_menu_item_to_dict(r) for r in rows])


@router.post("/sites/{site_id}/menu-items")
async def create_menu_item(site_id: str, body: MenuItemBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.target_type not in ("page", "url"):
        return JSONResponse({"error": "invalid target_type"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        item_id = str(uuid.uuid4())
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order),-1) m FROM menu_items WHERE site_id=?", (site_id,)
        ).fetchone()["m"]
        conn.execute(
            "INSERT INTO menu_items(id,site_id,label,target_type,target,sort_order) VALUES(?,?,?,?,?,?)",
            (item_id, site_id, body.label.strip(), body.target_type, body.target, max_order + 1),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone()
        return JSONResponse(_menu_item_to_dict(row))


@router.put("/sites/{site_id}/menu-items/{item_id}")
async def update_menu_item(site_id: str, item_id: str, body: MenuItemBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.target_type not in ("page", "url"):
        return JSONResponse({"error": "invalid target_type"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        row = conn.execute("SELECT * FROM menu_items WHERE id=? AND site_id=?", (item_id, site_id)).fetchone()
        if not row:
            return JSONResponse({"error": "not found"}, status_code=404)
        conn.execute(
            "UPDATE menu_items SET label=?, target_type=?, target=?, sort_order=? WHERE id=?",
            (body.label.strip() or row["label"], body.target_type, body.target, body.sort_order, item_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone()
        return JSONResponse(_menu_item_to_dict(row))


@router.delete("/sites/{site_id}/menu-items/{item_id}")
async def delete_menu_item(site_id: str, item_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        conn.execute("DELETE FROM menu_items WHERE id=? AND site_id=?", (item_id, site_id))
        conn.commit()
        return JSONResponse({"ok": True})


# ── Members / permissions ───────────────────────────────────────

class MemberBody(BaseModel):
    user_id: str
    role: str = "editor"


class MemberRoleBody(BaseModel):
    role: str


@router.get("/sites/{site_id}/members")
async def list_members(site_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    with _db() as conn:
        if not _my_role(conn, site_id, me["id"]):
            return JSONResponse({"error": "not found"}, status_code=404)
        rows = conn.execute(
            "SELECT user_id, role, created_at FROM site_members WHERE site_id=? ORDER BY created_at", (site_id,)
        ).fetchall()
    profiles = {p["id"]: p for p in hub.get_users_by_ids([r["user_id"] for r in rows])} if hub else {}
    out = []
    for r in rows:
        p = profiles.get(r["user_id"], {})
        out.append({
            "user_id": r["user_id"], "role": r["role"], "created_at": r["created_at"],
            "username": p.get("username"), "display_name": p.get("display_name"),
        })
    return JSONResponse(out)


@router.get("/sites/{site_id}/member-search")
async def search_members(site_id: str, q: str = "", x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    hub = _hub()
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        existing = {r["user_id"] for r in conn.execute(
            "SELECT user_id FROM site_members WHERE site_id=?", (site_id,)
        ).fetchall()}
    if not hub:
        return JSONResponse([])
    results = [u for u in hub.search_users(q, exclude_id=me["id"]) if u["id"] not in existing]
    return JSONResponse(results)


@router.post("/sites/{site_id}/members")
async def add_member(site_id: str, body: MemberBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.role not in ("editor", "viewer"):
        return JSONResponse({"error": "invalid role"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        if _my_role(conn, site_id, body.user_id):
            return JSONResponse({"error": "already a member"}, status_code=400)
        conn.execute(
            "INSERT INTO site_members(site_id,user_id,role,created_at) VALUES(?,?,?,?)",
            (site_id, body.user_id, body.role, _now()),
        )
        conn.commit()
        return JSONResponse({"ok": True})


@router.put("/sites/{site_id}/members/{user_id}")
async def update_member(site_id: str, user_id: str, body: MemberRoleBody, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if body.role not in ("editor", "viewer"):
        return JSONResponse({"error": "invalid role"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        target_role = _my_role(conn, site_id, user_id)
        if not target_role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if target_role == "owner":
            return JSONResponse({"error": "cannot change the owner's role"}, status_code=400)
        conn.execute(
            "UPDATE site_members SET role=? WHERE site_id=? AND user_id=?", (body.role, site_id, user_id)
        )
        conn.commit()
        return JSONResponse({"ok": True})


@router.delete("/sites/{site_id}/members/{user_id}")
async def remove_member(site_id: str, user_id: str, x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if user_id == me["id"]:
            if role == "owner":
                return JSONResponse({"error": "owner cannot leave, delete the site instead"}, status_code=400)
        elif role != "owner":
            return JSONResponse({"error": "forbidden"}, status_code=403)
        else:
            target_role = _my_role(conn, site_id, user_id)
            if not target_role:
                return JSONResponse({"error": "not found"}, status_code=404)
            if target_role == "owner":
                return JSONResponse({"error": "cannot remove the owner"}, status_code=400)
        conn.execute("DELETE FROM site_members WHERE site_id=? AND user_id=?", (site_id, user_id))
        conn.commit()
        return JSONResponse({"ok": True})


# ── Uploads ──────────────────────────────────────────────────────

@router.post("/uploads")
async def upload_image(site_id: str = Form(...), file: UploadFile = File(...),
                        x_pub_token: str = Header(default=None)):
    me = _resolve(x_pub_token)
    if not me:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    if ext not in ALLOWED_UPLOAD_EXT:
        return JSONResponse({"error": "unsupported file type"}, status_code=400)
    with _db() as conn:
        role = _my_role(conn, site_id, me["id"])
        if not role:
            return JSONResponse({"error": "not found"}, status_code=404)
        if role not in EDIT_ROLES:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        site = conn.execute("SELECT slug FROM sites WHERE id=?", (site_id,)).fetchone()
    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        return JSONResponse({"error": "file too large"}, status_code=400)
    site_dir = os.path.join(_UPLOADS_DIR, site_id)
    os.makedirs(site_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(site_dir, filename), "wb") as f:
        f.write(contents)
    return JSONResponse({"filename": filename, "url": f"/pub/{APP_ID}/{site['slug']}/uploads/{filename}"})


_UPLOAD_FILENAME_RE = re.compile(r"^[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp)$")


@router.get("/{site_slug}/uploads/{filename}")
async def serve_upload(site_slug: str, filename: str):
    if not _UPLOAD_FILENAME_RE.match(filename):
        return JSONResponse({"error": "not found"}, status_code=404)
    with _db() as conn:
        site = conn.execute("SELECT id FROM sites WHERE slug=?", (site_slug,)).fetchone()
    if not site:
        return JSONResponse({"error": "not found"}, status_code=404)
    path = os.path.join(_UPLOADS_DIR, site["id"], filename)
    if not os.path.isfile(path):
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(path)


# ── Public site rendering ───────────────────────────────────────

def _not_found_page(message_en: str = "Site not found", message_bg: str = "Сайтът не е намерен") -> HTMLResponse:
    return _render_404(message_en, message_bg)


def _menu_data(conn, site_slug: str, site_id: str, pages_by_id: dict) -> list:
    # Absolute hrefs, not relative ("./") — the canonical page URL has no
    # trailing slash (/pub/mvmsitebuilder/<slug>, not .../<slug>/), so a
    # relative href would resolve against the wrong base in the browser.
    base = f"/pub/{APP_ID}/{site_slug}"
    items = conn.execute(
        "SELECT * FROM menu_items WHERE site_id=? AND parent_id IS NULL ORDER BY sort_order", (site_id,)
    ).fetchall()
    out = []
    for item in items:
        if item["target_type"] == "page":
            page = pages_by_id.get(item["target"])
            if not page or page["status"] != "published":
                continue
            href = base if page["is_homepage"] else f"{base}/{page['slug']}"
        else:
            href = item["target"]
        out.append({"label": item["label"], "href": href})
    return out


def _menu_default_html(menu: list) -> str:
    # Convenience default a theme can drop in with {{menu}} — themes that
    # want their own markup (dropdowns, a mobile hamburger, ...) should
    # read {{menu_json}} instead and render it themselves in their own JS.
    if not menu:
        return ""
    links = "".join(f'<a class="msb-nav-item" href="{_esc(i["href"])}">{_esc(i["label"])}</a>' for i in menu)
    return f'<nav class="msb-nav">{links}</nav>'


def _json_for_script(data) -> str:
    # Safe to embed inside <script type="application/json">...</script>.
    return json.dumps(data).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


def _render_template(template: str, context: dict) -> str:
    # Deliberately dumb {{tag}} substitution, no loops/conditionals — see
    # public/themes/README.md. Block/menu iteration already happened in
    # Python before this call; a theme just places the resulting HTML.
    for key, val in context.items():
        template = template.replace("{{" + key + "}}", val)
    return template


def _render_page(conn, site, page) -> str:
    pages_by_id = {r["id"]: r for r in conn.execute(
        "SELECT id, slug, is_homepage, status FROM pages WHERE site_id=?", (site["id"],)
    ).fetchall()}
    menu = _menu_data(conn, site["slug"], site["id"], pages_by_id)
    content = render_blocks(json.loads(page["blocks"]) if page["blocks"] else [])
    theme_id = site["theme"] if theme_exists(site["theme"]) else "default"
    with open(theme_template_path(theme_id), encoding="utf-8") as f:
        template = f.read()
    context = {
        "site_name": _esc(site["name"]),
        "page_title": _esc(page["title"] or site["name"]),
        "theme_css_url": f"/pub/{APP_ID}/{site['slug']}/theme.css",
        "home_url": f"/pub/{APP_ID}/{site['slug']}",
        "menu": _menu_default_html(menu),
        "menu_json": _json_for_script(menu),
        "content": content,
        "custom_css": site["custom_css"] or "",
        "custom_js": site["custom_js"] or "",
    }
    return _render_template(template, context)


@router.get("/{site_slug}/theme.css")
async def serve_theme_css(site_slug: str):
    with _db() as conn:
        site = conn.execute("SELECT theme FROM sites WHERE slug=?", (site_slug,)).fetchone()
    theme_id = site["theme"] if site and theme_exists(site["theme"]) else "default"
    return FileResponse(theme_css_path(theme_id), media_type="text/css")


@router.get("/{site_slug}")
async def public_homepage(site_slug: str):
    with _db() as conn:
        site = conn.execute("SELECT * FROM sites WHERE slug=?", (site_slug,)).fetchone()
        if not site:
            return _not_found_page()
        page = conn.execute(
            "SELECT * FROM pages WHERE site_id=? AND is_homepage=1 AND status='published'", (site["id"],)
        ).fetchone()
        if not page:
            page = conn.execute(
                "SELECT * FROM pages WHERE site_id=? AND status='published' ORDER BY sort_order LIMIT 1",
                (site["id"],),
            ).fetchone()
        if not page:
            return _not_found_page("This site has no published pages yet.", "Този сайт все още няма публикувани страници.")
        return HTMLResponse(_render_page(conn, site, page))


@router.get("/{site_slug}/{page_slug}")
async def public_page(site_slug: str, page_slug: str):
    with _db() as conn:
        site = conn.execute("SELECT * FROM sites WHERE slug=?", (site_slug,)).fetchone()
        if not site:
            return _not_found_page()
        page = conn.execute(
            "SELECT * FROM pages WHERE site_id=? AND slug=? AND status='published'", (site["id"], page_slug)
        ).fetchone()
        if not page:
            return _not_found_page("Page not found", "Страницата не е намерена")
        return HTMLResponse(_render_page(conn, site, page))
