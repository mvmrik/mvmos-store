"""mvmCloud's deliberately narrow file capability service.

This backend lives outside the store app because only the administrator's
external shares need to touch selected Linux folders.  Every path is resolved
under an explicit root; it never exposes a shell or a general filesystem API.
"""
import hashlib
import hmac
import importlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from backend.assets import asset, manifest as assets_manifest

router = APIRouter()
desktop_router = APIRouter()

APP_ID = "mvmcloud"
APP_DIR = Path(__file__).resolve().parents[3] / "apps" / APP_ID
STORAGE = APP_DIR / "storage"
USERS_ROOT = STORAGE / "users"
THUMBS_ROOT = STORAGE / "thumbs"
DB_PATH = APP_DIR / "data.db"
MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
MIN_FREE_BYTES = 1024 * 1024 * 1024
USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")


def _hub(): return sys.modules.get("backend.apphub")
def _premium():
    mod = sys.modules.get("backend.premium")
    return mod.load_premium_backend(APP_ID) if mod else None


def _db():
    STORAGE.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # Store apps may be copied in while the server is already running.  Ensure
    # the schema on every connection so a pre-created but empty data.db can
    # never leave the first real request failing with "no such table".
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_rules (user_id TEXT PRIMARY KEY, quota_bytes INTEGER, encryption_allowed INTEGER);
    CREATE TABLE IF NOT EXISTS vaults (user_id TEXT NOT NULL, path TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,path));
    CREATE TABLE IF NOT EXISTS external_tokens (id TEXT PRIMARY KEY, linux_user TEXT NOT NULL, label TEXT NOT NULL, root_path TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, expires_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_api_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL, root_path TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, permissions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS folder_shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, recipient_id TEXT NOT NULL, path TEXT NOT NULL, permissions TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(owner_id,recipient_id,path));
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS public_links (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, path TEXT NOT NULL, is_dir INTEGER NOT NULL, pass_salt TEXT, pass_hash TEXT, created_at INTEGER NOT NULL, UNIQUE(owner_id,path));
    CREATE TABLE IF NOT EXISTS mounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, linux_user TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', folder_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mount_grants (mount_id TEXT NOT NULL, recipient TEXT NOT NULL, permissions TEXT NOT NULL, PRIMARY KEY(mount_id,recipient));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mvmcloud_vault_user_path ON vaults(user_id,path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mvmcloud_token_hash ON external_tokens(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mvmcloud_user_api_token_hash ON user_api_tokens(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mvmcloud_share_owner_recipient_path ON folder_shares(owner_id,recipient_id,path);
    """)
    conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('emergency_free_bytes',?)", (str(MIN_FREE_BYTES),))
    conn.commit()
    return conn


def _init():
    with _db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS user_rules (
          user_id TEXT PRIMARY KEY, quota_bytes INTEGER, encryption_allowed INTEGER
        );
        CREATE TABLE IF NOT EXISTS vaults (
          user_id TEXT NOT NULL, path TEXT NOT NULL, salt TEXT NOT NULL,
          created_at INTEGER NOT NULL, PRIMARY KEY(user_id,path)
        );
        CREATE TABLE IF NOT EXISTS folder_shares (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
          path TEXT NOT NULL, permissions TEXT NOT NULL, created_at INTEGER NOT NULL,
          UNIQUE(owner_id,recipient_id,path)
        );
        CREATE TABLE IF NOT EXISTS external_tokens (
          id TEXT PRIMARY KEY, linux_user TEXT NOT NULL, label TEXT NOT NULL,
          root_path TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          permissions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          expires_at INTEGER, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_api_tokens (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT NOT NULL,
          root_path TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
          permissions TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        """)
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('emergency_free_bytes',?)", (str(MIN_FREE_BYTES),))
        conn.commit()


_init()


def _public_enabled():
    hub = _hub()
    return bool(hub and hub.is_app_public(APP_ID))


def _user(token):
    hub = _hub()
    return hub.get_pub_session(token) if hub and token else None


def _user_root(user_id: str) -> Path:
    if not USER_ID_RE.fullmatch(user_id):
        raise HTTPException(400, "Invalid user")
    root = (USERS_ROOT / user_id).resolve()
    if root.parent != USERS_ROOT.resolve():
        raise HTTPException(403, "Invalid user storage")
    root.mkdir(parents=True, exist_ok=True)
    return root


def _safe(root: Path, value: str = "") -> Path:
    # Paths are API-relative only. Symlinks are refused so a user can never
    # turn a permitted directory into a route elsewhere after it is shared.
    value = (value or "").replace("\\", "/").strip("/")
    if "\x00" in value or any(part in ("", ".", "..") for part in value.split("/") if part):
        if value:
            raise HTTPException(400, "Invalid path")
    path = root / value
    probe = root
    for part in path.relative_to(root).parts:
        probe = probe / part
        if probe.is_symlink():
            raise HTTPException(403, "Symlinks are not supported")
    path = path.resolve()
    if path != root and root not in path.parents:
        raise HTTPException(403, "Path escapes its folder")
    return path


def _usage(root: Path) -> int:
    total = 0
    for base, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if not (Path(base) / d).is_symlink()]
        for name in files:
            p = Path(base) / name
            try:
                if not p.is_symlink(): total += p.stat().st_size
            except OSError: pass
    return total


def _policy(user_id: str) -> dict:
    premium = _premium()
    # Policy calculation belongs entirely to the subscriber build. Without it
    # normal folders stay unrestricted and encrypted folders do not exist.
    return premium.get_policy(user_id) if premium and hasattr(premium, "get_policy") else {
        "quota_bytes": None, "encryption_allowed": False,
    }


def _check_write(root: Path, user_id: str, incoming: int = 0):
    if incoming < 0 or incoming > MAX_UPLOAD_BYTES: raise HTTPException(413, "File is too large")
    if shutil.disk_usage(STORAGE).free - incoming < MIN_FREE_BYTES:
        raise HTTPException(507, "Server storage safety limit reached")
    quota = _policy(user_id)["quota_bytes"] if user_id else None
    if quota is not None and _usage(root) + incoming > quota:
        raise HTTPException(413, "Storage quota reached")


def _natural(name: str) -> list:
    # IMG_2 before IMG_10.  re.split with a group puts the digits at odd positions.
    return [int(x) if i % 2 else x.lower() for i, x in enumerate(re.split(r"([0-9]+)", name))]


def _entry_row(p: Path, root: Path, known: dict):
    try: stat = p.stat()
    except OSError: return None
    row = {"name": p.name, "type": "folder" if p.is_dir() else "file", "size": stat.st_size, "modified": int(stat.st_mtime)}
    if known and row["type"] == "file" and p.suffix.lower() in INLINE_TYPES:
        dur = known.get((_thumb_hash(p.relative_to(root).as_posix()), int(stat.st_mtime), stat.st_size))
        if dur is not None: row["thumb"] = 1; row["dur"] = dur
    return row


def _entries(root: Path, rel: str, thumbs_for: str | None = None, offset: int = 0, limit: int = 0):
    """List a folder.  With a limit the answer is one page in a stable order
    (folders, other files, then pictures and videos, each in natural order) so a
    big folder can be loaded piece by piece while the user scrolls."""
    folder = _safe(root, rel)
    if not folder.is_dir(): raise HTTPException(404, "Folder not found")
    known = _thumb_index(thumbs_for) if thumbs_for else {}
    if not limit:
        rows = [r for r in (_entry_row(p, root, known) for p in sorted(folder.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())) if not p.is_symlink()) if r]
        return {"path": rel.strip("/"), "entries": rows}
    with os.scandir(folder) as it:
        kids = [(e.name, e.is_dir(follow_symlinks=False)) for e in it if not e.is_symlink()]
    def group(kid): return 0 if kid[1] else (2 if Path(kid[0]).suffix.lower() in INLINE_TYPES else 1)
    kids.sort(key=lambda k: (group(k), _natural(k[0])))
    end = offset + limit
    rows = [r for r in (_entry_row(folder / k[0], root, known) for k in kids[offset:end]) if r]
    return {"path": rel.strip("/"), "entries": rows, "total": len(kids), "media_total": sum(1 for k in kids if group(k) == 2), "next": end if end < len(kids) else None}


# ── Spaces: the places a person can browse ───────────────────────────────────
# "own" is the private folder.  "s:<id>" is a folder another profile shared,
# "m:<id>" is a folder the administrator offers (a folder of this server or a
# folder shared from another mvmOS).  Every request resolves the space again
# and works with the rights in force at that moment, so taking a right away,
# or the sharing server lowering its own, applies at once.
#   view   - browse names and preview pictures and videos
#   read   - download files        write  - upload, create, rename, move
#   delete - delete files and folders
PERMS = ("view", "read", "write", "delete")
_remote_cache: dict = {}


def _fp(): return importlib.import_module("backend.filepicker")


def _norm_perms(values) -> set:
    given = set(values or [])
    if not given or given - set(PERMS): raise HTTPException(400, "Invalid permissions")
    return given | {"view"}


def _load_perms(raw) -> set:
    try: given = set(json.loads(raw)) & set(PERMS)
    except (TypeError, ValueError): return set()
    return given | {"view"} if given else set()


def _remote_ceiling(row) -> set:
    """The most the sharing server allows on this folder right now (cached for 20 seconds)."""
    key = (row["linux_user"], row["folder_id"], row["path"])
    hit = _remote_cache.get(key)
    if hit and hit[0] > time.time(): return hit[1]
    try: _entries_, remote = _fp().shared_listing(row["linux_user"], row["folder_id"], row["path"])
    except HTTPException: remote = None
    out = set()
    if remote is not None:
        out.add("view")
        if "read" in remote: out.add("read")
        if "upload" in remote: out.add("write")
        if "delete" in remote: out.add("delete")
    _remote_cache[key] = (time.time() + 20, out)
    return out


def _mount_ceiling(row) -> set:
    return set(PERMS) if row["kind"] == "server" else _remote_ceiling(row)


def _mount_home(linux_user: str) -> Path:
    return Path(os.path.expanduser("~" if linux_user == "root" else "~" + linux_user)).resolve()


def _mount_root(row) -> Path:
    root = Path(row["path"]).resolve(); home = _mount_home(row["linux_user"])
    if not root.is_dir() or (root != home and home not in root.parents): raise HTTPException(410, "This shared folder is unavailable")
    return root


def _grants(conn, mount_id: str) -> dict:
    return {g["recipient"]: _load_perms(g["permissions"]) for g in conn.execute("SELECT recipient,permissions FROM mount_grants WHERE mount_id=?", (mount_id,))}


def _space(user_id: str, space: str = ""):
    if not space or space == "own":
        root = _user_root(user_id)
        return SimpleNamespace(id="own", kind="local", root=root, perms=set(PERMS), quota_root=root, quota_user=user_id, own=True)
    kind, _, ident = space.partition(":")
    with _db() as conn:
        if kind == "s":
            row = conn.execute("SELECT * FROM folder_shares WHERE id=? AND recipient_id=?", (ident, user_id)).fetchone()
            if not row: raise HTTPException(404, "Shared folder not found")
            owner_root = _user_root(row["owner_id"]); target = _safe(owner_root, row["path"]); perms = _load_perms(row["permissions"])
            if target.is_file():
                # One shared file: only that file is visible and it can only be viewed or downloaded.
                return SimpleNamespace(id=space, kind="local", root=target.parent, perms=perms & {"view", "read"}, quota_root=owner_root, quota_user=row["owner_id"], own=False, only=target.name)
            if not target.is_dir(): raise HTTPException(410, "This shared folder is unavailable")
            return SimpleNamespace(id=space, kind="local", root=target, perms=perms, quota_root=owner_root, quota_user=row["owner_id"], own=False)
        if kind == "m":
            row = conn.execute("SELECT * FROM mounts WHERE id=?", (ident,)).fetchone()
            if not row: raise HTTPException(404, "Shared folder not found")
            grants = _grants(conn, ident)
            granted = grants[user_id] if user_id in grants else grants.get("*")
            if granted is None: raise HTTPException(404, "Shared folder not found")
            perms = granted & _mount_ceiling(row)
            if row["kind"] == "server":
                root = _mount_root(row)
                return SimpleNamespace(id=space, kind="local", root=root, perms=perms, quota_root=None, quota_user=None, own=False)
            return SimpleNamespace(id=space, kind="remote", root=None, perms=perms, remote=dict(row), quota_root=None, quota_user=None, own=False)
    raise HTTPException(404, "Shared folder not found")


def _need(sp, perm: str, path: str | None = None):
    if perm not in sp.perms: raise HTTPException(403, "This shared folder does not allow that")
    only = getattr(sp, "only", None)
    if only is not None and path is not None and (path or "").strip("/") != only: raise HTTPException(404, "File not found")


def _remote_rel(sp, rel: str) -> str:
    rel = (rel or "").replace("\\", "/").strip("/")
    if "\x00" in rel or any(part in ("", ".", "..") for part in rel.split("/") if part): raise HTTPException(400, "Invalid path")
    return "/".join(x for x in (sp.remote["path"], rel) if x)


def _remote_entries(sp, rel: str) -> dict:
    items, _perms = _fp().shared_listing(sp.remote["linux_user"], sp.remote["folder_id"], _remote_rel(sp, rel))
    rows = []
    for e in items:
        name = e.get("name") if isinstance(e, dict) else None
        if not isinstance(name, str) or not name or "/" in name or name in (".", ".."): continue
        try: import datetime; modified = int(datetime.datetime.fromisoformat(str(e.get("modified"))).timestamp())
        except ValueError: modified = 0
        rows.append({"name": name, "type": "folder" if e.get("type") == "dir" else "file", "size": int(e.get("size") or 0), "modified": modified})
    rows.sort(key=lambda r: (r["type"] != "folder", r["name"].lower()))
    return {"path": rel.strip("/"), "entries": rows, "total": len(rows), "media_total": 0, "next": None}


def _audit(actor, action, target):
    with _db() as conn:
        conn.execute("INSERT INTO audit_log(actor,action,target,created_at) VALUES(?,?,?,?)", (actor[:120], action, target[:500], int(time.time())))
        conn.commit()


class PathBody(BaseModel): path: str = Field(default="", max_length=800)
class MoveBody(BaseModel): source: str = Field(max_length=800); destination: str = Field(max_length=800)
class VaultBody(BaseModel):
    path: str = Field(min_length=1,max_length=800)
    salt: str = Field(min_length=16,max_length=1024)
    credit_confirmed: bool = False
    confirmed_price: int = Field(default=0, ge=0, le=1_000_000)
    credit_request_id: str | None = Field(default=None, max_length=120)
class RuleBody(BaseModel): quota_bytes: int | None = Field(default=None, ge=0); encryption_allowed: bool | None = None
class TokenBody(BaseModel):
    label: str = Field(min_length=1,max_length=80); path: str = Field(min_length=1,max_length=1000)
    permissions: list[str] = Field(default_factory=lambda:["read"]); expires_at: int | None = None
class TokenPermissionsBody(BaseModel):
    permissions: list[str] = Field(default_factory=list)
class UserApiTokenBody(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    path: str = Field(default="", max_length=800)
    permissions: list[str] = Field(default_factory=lambda: ["read"])
    credit_confirmed: bool = False
    confirmed_price: int = Field(default=0, ge=0, le=1_000_000)
    credit_request_id: str | None = Field(default=None, max_length=120)
class SettingsBody(BaseModel):
    encryption_enabled: bool = False
    default_quota_bytes: int | None = Field(default=None, ge=0)
    user_api_enabled: bool = False
class ShareBody(BaseModel): recipient_id: str = Field(min_length=1,max_length=100); path: str = Field(default="",max_length=800); permissions: list[str] = Field(default_factory=lambda:["read"])


def _need_public(token):
    # Apps Hub visibility controls the public *page*, not the user's data API:
    # the desktop uses the same signed Apps Hub identity and must keep working
    # when an administrator turns the public surface off.
    me = _user(token)
    if not me: raise HTTPException(401, "Apps Hub login required")
    return me


@router.get("/")
async def index():
    if not _public_enabled():
        return HTMLResponse("""<!doctype html><html><head><meta charset="utf-8"><title>mvmCloud</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e1e2e;color:#a6adc8;flex-direction:column;gap:12px}.icon{font-size:3rem}.msg{font-size:1.1rem;font-weight:700;color:#cdd6f4}.sub{font-size:.9rem;color:#6c7086}</style>
</head><body><div class="icon">🔒</div><div class="msg">mvmCloud is private</div><div class="sub">Access is not available to the public.</div></body></html>""", status_code=403)
    return FileResponse(APP_DIR / "public" / "index.html")


@router.get("/external")
async def external_folder_page():
    """A deliberately narrow browser view for an external capability URL.

    The secret stays in the URL fragment rather than the request path/query:
    fragments never reach server, proxy, or access logs.  The page reads it
    client-side and sends it only in the Authorization header to the API.
    """
    return HTMLResponse("""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mvmCloud folder</title><style>body{margin:0;background:#1e1e2e;color:#cdd6f4;font:14px system-ui}.bar{padding:15px 18px;border-bottom:1px solid #45475a;display:flex;gap:12px;align-items:center}.bar b{font-size:16px;margin-right:auto}.path{padding:10px 18px;color:#a6adc8;font-family:monospace}.row{display:flex;gap:12px;align-items:center;padding:12px 18px;border-top:1px solid #313244;cursor:pointer}.row:hover{background:#313244}.name{flex:1}.muted{color:#a6adc8}.empty{padding:42px;text-align:center;color:#a6adc8}.error{max-width:580px;margin:12vh auto;padding:24px;border:1px solid #f38ba8;border-radius:12px;background:#313244;line-height:1.5}</style></head><body><div id="app"></div><script src="/apps/mvmcloud/external.js?v=2"></script></body></html>""", headers={"X-Mvm-No-Public-Chrome": "1", "Cache-Control": "no-store"})


@router.get("/me")
async def me(x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"])
    with _db() as conn:
        vaults = [dict(row) for row in conn.execute("SELECT path,salt FROM vaults WHERE user_id=?", (user["id"],))]
    free = max(0, shutil.disk_usage(STORAGE).free - MIN_FREE_BYTES)
    return {"id": user["id"], "usage_bytes": _usage(root), "policy": _policy(user["id"]), "vaults": vaults, "free_bytes": free}


@router.get("/files")
async def files(path: str = "", offset: int = 0, limit: int = 0, space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "view")
    if sp.kind == "remote": return await run_in_threadpool(_remote_entries, sp, path)
    only = getattr(sp, "only", None)
    if only is not None:
        if (path or "").strip("/"): raise HTTPException(404, "Folder not found")
        row = _entry_row(sp.root / only, sp.root, {})
        return {"path": "", "entries": [row] if row else [], "total": 1, "media_total": 0, "next": None}
    return _entries(sp.root, path, user["id"] if sp.own else None, max(0, offset), min(max(0, limit), 1000))


@router.get("/credit-features/encrypted_folder")
async def encrypted_folder_credit(x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if not _policy(user["id"])["encryption_allowed"]:
        return {"available": False, "price": 0, "balance": 0}
    hub = _hub()
    price = hub.get_credit_feature_price(APP_ID, "encrypted_folder") if hub else 0
    balance = hub.get_credit_balance(user["id"]) if hub else 0
    return {"available": True, "price": price, "balance": balance}


def _user_api_available() -> bool:
    premium = _premium()
    return bool(premium and hasattr(premium, "user_api_enabled") and premium.user_api_enabled())


def _key_permissions(values: list[str]) -> list[str]:
    permissions = sorted(set(values))
    if not permissions or set(permissions) - {"read", "write", "delete"}:
        raise HTTPException(400, "Invalid permissions")
    return permissions


@router.get("/api-keys")
async def user_api_keys(x_pub_token: str = Header(default=None)):
    """List only the caller's own API keys; secrets are never stored or returned."""
    user = _need_public(x_pub_token)
    available = _user_api_available()
    hub = _hub()
    price = hub.get_credit_feature_price(APP_ID, "user_api_key") if available and hub else 0
    balance = hub.get_credit_balance(user["id"]) if available and hub else 0
    with _db() as conn:
        rows = conn.execute("SELECT id,label,root_path,permissions,enabled,created_at FROM user_api_tokens WHERE user_id=? ORDER BY created_at DESC", (user["id"],)).fetchall()
    keys = []
    for row in rows:
        key = dict(row)
        key["permissions"] = json.loads(key["permissions"])
        keys.append(key)
    return {"available": available, "price": price, "balance": balance, "keys": keys}


@router.post("/api-keys")
async def create_user_api_key(body: UserApiTokenBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if not _user_api_available():
        raise HTTPException(403, "User API keys are not enabled")
    root = _user_root(user["id"])
    folder = _safe(root, body.path)
    if not folder.is_dir() or folder.is_symlink():
        raise HTTPException(404, "Folder not found")
    permissions = _key_permissions(body.permissions)
    hub = _hub()
    price = hub.get_credit_feature_price(APP_ID, "user_api_key") if hub else 0
    if price and (not body.credit_confirmed or body.confirmed_price != price or not body.credit_request_id):
        raise HTTPException(409, detail={"error": "credit_confirmation_required", "price": price})
    token_id, secret = secrets.token_urlsafe(12), secrets.token_urlsafe(32)
    if price:
        try:
            hub.charge_credit_feature(user["id"], APP_ID, "user_api_key", "mvmCloud: user API key", body.credit_request_id)
        except Exception as exc:
            if exc.__class__.__name__ == "CreditError":
                raise HTTPException(402, str(exc))
            raise
    try:
        with _db() as conn:
            conn.execute("INSERT INTO user_api_tokens(id,user_id,label,root_path,token_hash,permissions,created_at) VALUES(?,?,?,?,?,?,?)", (token_id, user["id"], body.label.strip(), body.path.strip("/"), hashlib.sha256(secret.encode()).hexdigest(), json.dumps(permissions), int(time.time())))
            conn.commit()
    except Exception:
        if price and hub:
            try: hub.grant_credits(user["id"], APP_ID, price, "mvmCloud: failed API key refund", body.credit_request_id + ":refund")
            except Exception: pass
        raise
    _audit("hub:" + user["id"], "create_user_api_key", body.path.strip("/"))
    return {"id": token_id, "token": secret, "permissions": permissions, "help_url": "/pub/mvmcloud/api/help"}


@router.put("/api-keys/{token_id}")
async def update_user_api_key(token_id: str, body: TokenPermissionsBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if not _user_api_available(): raise HTTPException(403, "User API keys are not enabled")
    permissions = _key_permissions(body.permissions)
    with _db() as conn:
        changed = conn.execute("UPDATE user_api_tokens SET permissions=? WHERE id=? AND user_id=?", (json.dumps(permissions), token_id, user["id"])).rowcount
        conn.commit()
    if not changed: raise HTTPException(404, "Key not found")
    _audit("hub:" + user["id"], "update_user_api_key", token_id)
    return {"ok": True, "permissions": permissions}


@router.delete("/api-keys/{token_id}")
def revoke_user_api_key(token_id: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn:
        conn.execute("DELETE FROM user_api_tokens WHERE id=? AND user_id=?", (token_id, user["id"]))
        conn.commit()
    _audit("hub:" + user["id"], "revoke_user_api_key", token_id)
    return {"ok": True}


@router.get("/download")
async def download(path: str, space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "read", path)
    if sp.kind == "remote": return RedirectResponse(_fp().shared_file_url(sp.remote["linux_user"], sp.remote["folder_id"], _remote_rel(sp, path)) + "&download=1")
    file = _safe(sp.root, path)
    if not file.is_file(): raise HTTPException(404, "File not found")
    return FileResponse(file, filename=file.name)


# ── Media links ──────────────────────────────────────────────────────────────
# <img>, <video> and a plain download link cannot send the X-Pub-Token header,
# so the browser asks once for a signed ticket and puts it in the media URLs.
# A ticket only reads the signed-in user's own files and expires on its own.
MEDIA_TICKET_TTL = 3 * 3600
# Only these types are ever shown inline. Anything else (HTML, SVG, scripts)
# can only be downloaded as an attachment, so a stored file never runs in the
# page's origin.
INLINE_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
    ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp",
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".ogv": "video/ogg",
}
_media_secret_cache: list[str] = []


def _media_secret() -> str:
    if _media_secret_cache: return _media_secret_cache[0]
    with _db() as conn:
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('media_secret',?)", (secrets.token_hex(32),))
        conn.commit()
        _media_secret_cache.append(conn.execute("SELECT value FROM settings WHERE key='media_secret'").fetchone()["value"])
    return _media_secret_cache[0]


def _media_sig(user_id: str, expires: int) -> str:
    return hmac.new(_media_secret().encode(), f"{user_id}.{expires}".encode(), hashlib.sha256).hexdigest()


def _media_user(ticket: str) -> str:
    try:
        user_id, expires, sig = ticket.rsplit(".", 2)
        expires = int(expires)
    except ValueError:
        raise HTTPException(401, "Invalid media link")
    if expires < time.time() or not USER_ID_RE.fullmatch(user_id) or not hmac.compare_digest(sig, _media_sig(user_id, expires)):
        raise HTTPException(401, "Media link expired")
    return user_id


@router.get("/media-ticket")
async def media_ticket(x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); expires = int(time.time()) + MEDIA_TICKET_TTL
    return {"ticket": f"{user['id']}.{expires}.{_media_sig(user['id'], expires)}", "expires": expires}


@router.get("/stream")
async def stream(path: str, t: str, dl: int = 0, space: str = ""):
    sp = _space(_media_user(t), space); _need(sp, "read" if dl else "view", path)
    if sp.kind == "remote":
        if not dl and Path(path).suffix.lower() not in INLINE_TYPES: raise HTTPException(415, "This file type cannot be previewed")
        return RedirectResponse(_fp().shared_file_url(sp.remote["linux_user"], sp.remote["folder_id"], _remote_rel(sp, path)) + ("&download=1" if dl else ""))
    file = _safe(sp.root, path)
    if not file.is_file(): raise HTTPException(404, "File not found")
    headers = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox"}
    if dl: return FileResponse(file, filename=file.name, headers=headers)
    kind = INLINE_TYPES.get(file.suffix.lower())
    if not kind: raise HTTPException(415, "This file type cannot be previewed")
    headers["Cache-Control"] = "private, max-age=3600"
    return FileResponse(file, media_type=kind, filename=file.name, content_disposition_type="inline", headers=headers)


# ── Thumbnails ───────────────────────────────────────────────────────────────
# The server has no image tools and needs none: the browser makes a small JPEG
# once (right after an upload, or the first time it shows an older file) and
# leaves it here, so every other device only downloads a few kilobytes.  They
# live outside the user's folder (no listing, no quota, no sharing).  Files in
# encrypted folders never get one, because that would leak their content.
MAX_THUMB_BYTES = 300 * 1024
_THUMB_NAME = re.compile(r"^([0-9a-f]{24})-(\d+)-(\d+)-(\d+)\.jpg$")


def _thumb_hash(rel: str) -> str: return hashlib.sha256(rel.encode()).hexdigest()[:24]
def _thumb_dir(user_id: str) -> Path: return THUMBS_ROOT / user_id


def _thumb_index(user_id: str) -> dict:
    """(path hash, mtime, size) -> video duration, for every thumbnail the user has."""
    found = {}
    try:
        for name in os.listdir(_thumb_dir(user_id)):
            m = _THUMB_NAME.match(name)
            if m: found[(m.group(1), int(m.group(2)), int(m.group(3)))] = int(m.group(4))
    except OSError: pass
    return found


def _thumb_forget(user_id: str, rels: list[str]):
    hashes = {_thumb_hash(r) for r in rels}
    if not hashes: return
    d = _thumb_dir(user_id)
    try: names = os.listdir(d)
    except OSError: return
    for name in names:
        if name.split("-", 1)[0] in hashes:
            try: (d / name).unlink()
            except OSError: pass


def _forget_thumbs(target: Path):
    """Drop the thumbnails of a file or folder that is about to be deleted or moved."""
    try: parts = target.resolve().relative_to(USERS_ROOT.resolve()).parts
    except ValueError: return
    if not parts or not USER_ID_RE.fullmatch(parts[0]) or not _thumb_dir(parts[0]).is_dir(): return
    base = USERS_ROOT.resolve() / parts[0]
    files = [target] if target.is_file() else (list(target.rglob("*")) if target.is_dir() else [])
    _thumb_forget(parts[0], [p.relative_to(base).as_posix() for p in files if p.is_file() and p.suffix.lower() in INLINE_TYPES])


@router.get("/thumb")
async def thumb(path: str, t: str, space: str = ""):
    if space not in ("", "own"): raise HTTPException(404, "No thumbnail")
    user_id = _media_user(t); root = _user_root(user_id); file = _safe(root, path)
    if not file.is_file(): raise HTTPException(404, "File not found")
    stat = file.stat(); key = (_thumb_hash(file.relative_to(root).as_posix()), int(stat.st_mtime), stat.st_size)
    for name in os.listdir(_thumb_dir(user_id)) if _thumb_dir(user_id).is_dir() else []:
        m = _THUMB_NAME.match(name)
        if m and (m.group(1), int(m.group(2)), int(m.group(3))) == key:
            return FileResponse(_thumb_dir(user_id) / name, media_type="image/jpeg", headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, max-age=86400"})
    raise HTTPException(404, "No thumbnail")


@router.post("/thumb")
async def put_thumb(path: str = Form(...), dur: int = Form(0), file: UploadFile = File(...), space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if space not in ("", "own"): return {"ok": True}
    root = _user_root(user["id"]); target = _safe(root, path)
    if not target.is_file() or target.suffix.lower() not in INLINE_TYPES: raise HTTPException(404, "File not found")
    rel = target.relative_to(root).as_posix()
    with _db() as conn:
        for vault in conn.execute("SELECT path FROM vaults WHERE user_id=?", (user["id"],)):
            if rel == vault["path"] or rel.startswith(vault["path"] + "/"): raise HTTPException(403, "Encrypted folders never get server thumbnails")
    data = await file.read(MAX_THUMB_BYTES + 1)
    if len(data) > MAX_THUMB_BYTES or not data.startswith(b"\xff\xd8\xff"): raise HTTPException(400, "Invalid thumbnail")
    if shutil.disk_usage(STORAGE).free < MIN_FREE_BYTES: raise HTTPException(507, "Server storage safety limit reached")
    stat = target.stat(); folder = _thumb_dir(user["id"]); folder.mkdir(parents=True, exist_ok=True)
    _thumb_forget(user["id"], [rel])
    dest = folder / f"{_thumb_hash(rel)}-{int(stat.st_mtime)}-{stat.st_size}-{max(0, min(dur, 359999))}.jpg"
    temp = dest.with_name("." + dest.name + ".tmp"); temp.write_bytes(data); os.replace(temp, dest)
    return {"ok": True}


@router.post("/folders")
async def mkdir(body: PathBody, space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "write")
    if sp.kind == "remote":
        if not await run_in_threadpool(_fp().shared_mkdir, sp.remote["linux_user"], sp.remote["folder_id"], _remote_rel(sp, body.path)): raise HTTPException(400, "The folder could not be created")
        _audit("hub:"+user["id"], "mkdir", sp.id + ":" + body.path); return {"ok": True}
    _check_write(sp.root, None)
    if sp.quota_user: _check_write(sp.quota_root, sp.quota_user)
    target = _safe(sp.root, body.path)
    target.mkdir(parents=True, exist_ok=False); _audit("hub:"+user["id"], "mkdir", sp.id + ":" + body.path)
    return {"ok": True}


@router.post("/upload")
async def upload(path: str = Form(""), file: UploadFile = File(...), space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "write")
    if not file.filename or os.path.basename(file.filename) != file.filename: raise HTTPException(400, "Invalid filename")
    if sp.kind == "remote": return await _remote_upload(user, sp, path, file)
    root = sp.root; target_dir = _safe(root, path)
    if not target_dir.is_dir(): raise HTTPException(404, "Folder not found")
    target = _safe(root, str(Path(path) / file.filename)); temp = target.with_name("." + target.name + ".upload")
    written = 0
    try:
        with open(temp, "wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk); _check_write(sp.quota_root or root, sp.quota_user, written)
                handle.write(chunk)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    _audit("hub:"+user["id"], "upload", sp.id + ":" + str(Path(path) / file.filename)); return {"ok": True, "size": written}


async def _remote_upload(user, sp, path, file):
    """The file goes through a temporary local copy to the sharing server, which applies its own rules."""
    tmp = STORAGE / "tmp"; tmp.mkdir(parents=True, exist_ok=True); temp = tmp / secrets.token_hex(12); written = 0
    try:
        with open(temp, "wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES: raise HTTPException(413, "File is too large")
                if shutil.disk_usage(STORAGE).free - written < MIN_FREE_BYTES: raise HTTPException(507, "Server storage safety limit reached")
                handle.write(chunk)
        rel = _remote_rel(sp, str(Path(path) / file.filename))
        await run_in_threadpool(_fp().shared_upload_file, sp.remote["linux_user"], sp.remote["folder_id"], rel, str(temp))
    finally:
        temp.unlink(missing_ok=True)
    _audit("hub:"+user["id"], "upload", sp.id + ":" + str(Path(path) / file.filename)); return {"ok": True, "size": written}


class UploadTicketBody(BaseModel):
    path: str = Field(default="", max_length=800)       # folder the file goes into
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0, le=MAX_UPLOAD_BYTES)


@router.post("/upload-ticket")
async def upload_ticket(body: UploadTicketBody, space: str = "", x_pub_token: str = Header(default=None)):
    """Lets the browser send one file straight to a folder shared from another mvmOS.

    Only that one file name and size are signed, for a few hours, with the key this
    server holds; the person never receives the folder key and the bytes do not pass
    through this server.  Where the sharing server cannot take tickets (an older Core)
    the answer is 501 and the browser uses the normal upload instead."""
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "write")
    if sp.kind != "remote": raise HTTPException(400, "Only for folders shared from another server")
    if "/" in body.name or body.name in (".", ".."): raise HTTPException(400, "Invalid filename")
    fp = _fp()
    if not hasattr(fp, "shared_upload_ticket"): raise HTTPException(501, "Direct upload is not available")
    rel = _remote_rel(sp, str(Path(body.path) / body.name))
    info = await run_in_threadpool(fp.shared_upload_ticket, sp.remote["linux_user"], sp.remote["folder_id"], rel, body.size)
    _audit("hub:" + user["id"], "upload_direct", sp.id + ":" + rel)
    return info


@router.post("/move")
async def move(body: MoveBody, space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "write")
    if sp.kind == "remote": raise HTTPException(400, "Moving is not available in a folder shared from another server")
    root = sp.root; _check_write(root, None)
    source, dest = _safe(root, body.source), _safe(root, body.destination)
    if not source.exists() or dest.exists(): raise HTTPException(409, "Invalid move")
    if source.is_dir() and source in dest.parents: raise HTTPException(400, "Cannot move a folder into itself")
    _forget_thumbs(source); source.rename(dest); _audit("hub:"+user["id"], "move", sp.id + ":" + body.source + " -> " + body.destination); return {"ok":True}


@router.delete("/files")
def delete(path: str, space: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); sp = _space(user["id"], space); _need(sp, "delete")
    if sp.kind == "remote":
        if not _fp().shared_delete(sp.remote["linux_user"], sp.remote["folder_id"], _remote_rel(sp, path)): raise HTTPException(400, "It could not be deleted (a folder must be empty)")
        _audit("hub:"+user["id"], "delete", sp.id + ":" + path); return {"ok": True}
    root = sp.root; _check_write(root, None)
    target = _safe(root, path)
    if target == root or not target.exists(): raise HTTPException(404, "Not found")
    _forget_thumbs(target)
    if target.is_dir(): shutil.rmtree(target)
    else: target.unlink()
    _audit("hub:"+user["id"], "delete", sp.id + ":" + path); return {"ok":True}


@router.post("/vaults")
async def create_vault(body: VaultBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); policy = _policy(user["id"])
    if not policy["encryption_allowed"]: raise HTTPException(403, "Encrypted folders are not enabled")
    hub = _hub(); price = hub.get_credit_feature_price(APP_ID, "encrypted_folder") if hub else 0
    if price and (not body.credit_confirmed or body.confirmed_price != price or not body.credit_request_id):
        raise HTTPException(409, detail={"error": "credit_confirmation_required", "price": price})
    _check_write(root, user["id"]); folder = _safe(root, body.path)
    if folder.exists(): raise HTTPException(409, "Folder already exists")
    if price:
        try:
            hub.charge_credit_feature(user["id"], APP_ID, "encrypted_folder", "mvmCloud: encrypted folder", body.credit_request_id)
        except Exception as exc:
            # Apps Hub exposes CreditError as a base-module type.  Do not
            # create the folder when its single authoritative charge declines.
            if exc.__class__.__name__ == "CreditError":
                raise HTTPException(402, str(exc))
            raise
    try:
        folder.mkdir(parents=True, exist_ok=False)
    except Exception:
        if price and hub:
            try:
                hub.grant_credits(user["id"], APP_ID, price, "mvmCloud: failed folder refund", body.credit_request_id + ":refund")
            except Exception:
                pass
        raise
    with _db() as conn:
        conn.execute("INSERT INTO vaults(user_id,path,salt,created_at) VALUES(?,?,?,?)", (user["id"], body.path.strip("/"), body.salt, int(time.time())))
        conn.commit()
    _audit("hub:"+user["id"], "create_vault", body.path); return {"ok":True}


@router.get("/share-users")
async def share_users(q: str = "", x_pub_token: str = Header(default=None)):
    _need_public(x_pub_token)
    hub = _hub()
    return {"users": hub.search_users(q, limit=12) if hub else []}


def _profiles(ids):
    hub = _hub()
    return {p["id"]: p for p in (hub.get_users_by_ids(list(ids)) if hub and ids else [])}


@router.get("/shares")
async def list_shares(x_pub_token: str = Header(default=None)):
    """Folders other profiles shared with this person."""
    user = _need_public(x_pub_token)
    with _db() as conn:
        rows = conn.execute("SELECT id,owner_id,path,permissions,created_at FROM folder_shares WHERE recipient_id=?", (user["id"],)).fetchall()
    profiles = _profiles({r["owner_id"] for r in rows})
    return {"shares": [{**dict(r), "permissions": sorted(_load_perms(r["permissions"])), "owner": profiles.get(r["owner_id"], {})} for r in rows]}


@router.get("/shares/mine")
async def my_shares(x_pub_token: str = Header(default=None)):
    """Folders this person shared with other profiles."""
    user = _need_public(x_pub_token)
    with _db() as conn:
        rows = conn.execute("SELECT id,recipient_id,path,permissions,created_at FROM folder_shares WHERE owner_id=? ORDER BY created_at", (user["id"],)).fetchall()
    profiles = _profiles({r["recipient_id"] for r in rows})
    return {"shares": [{**dict(r), "permissions": sorted(_load_perms(r["permissions"])), "recipient": profiles.get(r["recipient_id"], {})} for r in rows]}


@router.get("/spaces")
async def spaces(x_pub_token: str = Header(default=None)):
    """Everything this person can browse besides their own folder, with the rights they have there."""
    user = _need_public(x_pub_token); out = []
    with _db() as conn:
        shares = conn.execute("SELECT id,owner_id,path,permissions FROM folder_shares WHERE recipient_id=?", (user["id"],)).fetchall()
        mounts = conn.execute("SELECT * FROM mounts ORDER BY name").fetchall()
        mount_grants = {m["id"]: _grants(conn, m["id"]) for m in mounts}
    profiles = _profiles({r["owner_id"] for r in shares})
    for r in shares:
        owner = profiles.get(r["owner_id"], {})
        out.append({"id": "s:" + r["id"], "kind": "share", "name": (r["path"].rsplit("/", 1)[-1] or owner.get("display_name") or "mvmCloud"),
                    "owner": owner.get("display_name") or owner.get("username") or "", "permissions": sorted(_load_perms(r["permissions"]))})
    for m in mounts:
        grants = mount_grants[m["id"]]
        granted = grants[user["id"]] if user["id"] in grants else grants.get("*")
        if granted is None: continue
        perms = await run_in_threadpool(lambda m=m: granted & _mount_ceiling(m))
        out.append({"id": "m:" + m["id"], "kind": "mount", "name": m["name"], "owner": "", "remote": m["kind"] == "remote", "permissions": sorted(perms)})
    return {"spaces": out}


@router.post("/shares")
async def create_share(body: ShareBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); folder = _safe(root,body.path)
    if not folder.exists() or folder.is_symlink(): raise HTTPException(404,"Not found")
    perms = _norm_perms(body.permissions)
    if folder.is_file(): perms &= {"view", "read"}
    perms = sorted(perms)
    hub = _hub(); matches = hub.get_users_by_ids([body.recipient_id]) if hub else []
    if not matches or body.recipient_id == user["id"]: raise HTTPException(404,"Apps Hub user not found")
    path = body.path.strip("/")
    with _db() as conn:
        found = conn.execute("SELECT id FROM folder_shares WHERE owner_id=? AND recipient_id=? AND path=?", (user["id"], body.recipient_id, path)).fetchone()
        share_id = found["id"] if found else secrets.token_urlsafe(12)
        if found: conn.execute("UPDATE folder_shares SET permissions=? WHERE id=?", (json.dumps(perms), share_id))
        else: conn.execute("INSERT INTO folder_shares(id,owner_id,recipient_id,path,permissions,created_at) VALUES(?,?,?,?,?,?)",(share_id,user["id"],body.recipient_id,path,json.dumps(perms),int(time.time())))
        conn.commit()
    _audit("hub:"+user["id"],"share",path+" -> "+body.recipient_id); return {"id":share_id,"ok":True}


class SharePermissionsBody(BaseModel): permissions: list[str] = Field(default_factory=list)


@router.put("/shares/{share_id}")
async def update_share(share_id: str, body: SharePermissionsBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); perms = sorted(_norm_perms(body.permissions))
    with _db() as conn:
        if not conn.execute("UPDATE folder_shares SET permissions=? WHERE id=? AND owner_id=?", (json.dumps(perms), share_id, user["id"])).rowcount: raise HTTPException(404, "Share not found")
        conn.commit()
    return {"ok": True}


@router.delete("/shares/{share_id}")
async def revoke_share(share_id: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn:
        if not conn.execute("DELETE FROM folder_shares WHERE id=? AND owner_id=?", (share_id, user["id"])).rowcount: raise HTTPException(404, "Share not found")
        conn.commit()
    _audit("hub:"+user["id"], "unshare", share_id); return {"ok": True}


# ── Public links ─────────────────────────────────────────────────────────────
# Anyone with the address can open a shared file or folder, optionally behind
# a password.  The link follows the file: it always shows what is in the
# owner's folder now, and stops working the moment the owner removes it.
PL_ROUNDS = 200_000
PL_TICKET_TTL = 6 * 3600
_pl_fail: dict = {}


class LinkBody(BaseModel):
    path: str = Field(default="", max_length=800)
    password: str | None = Field(default=None, max_length=200)


class LinkUpdateBody(BaseModel):
    password: str | None = Field(default=None, max_length=200)   # empty or null removes it


def _pl_hash(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PL_ROUNDS).hex()


def _pl_row(link_id: str):
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", link_id or ""): raise HTTPException(404, "This link is not available")
    with _db() as conn: row = conn.execute("SELECT * FROM public_links WHERE id=?", (link_id,)).fetchone()
    if not row: raise HTTPException(404, "This link is not available")
    if not _public_enabled(): raise HTTPException(403, "This link is not available")
    return row


def _pl_target(row):
    root = _user_root(row["owner_id"]); target = _safe(root, row["path"])
    if not target.exists(): raise HTTPException(410, "This link is not available")
    rel = target.relative_to(root).as_posix()
    if rel == ".": rel = ""
    with _db() as conn:
        for vault in conn.execute("SELECT path FROM vaults WHERE user_id=?", (row["owner_id"],)):
            v = vault["path"]
            if not rel or rel == v or rel.startswith(v + "/") or v.startswith(rel + "/"):
                raise HTTPException(403, "Encrypted folders cannot get a public link")
    return target


def _pl_sig(row, expires: int) -> str:
    return hmac.new(_media_secret().encode(), f"pl:{row['id']}:{expires}:{row['pass_hash'] or ''}".encode(), hashlib.sha256).hexdigest()


def _pl_ticket(row) -> str:
    expires = int(time.time()) + PL_TICKET_TTL
    return f"{expires}.{_pl_sig(row, expires)}"


def _pl_check(row, ticket: str):
    try: expires, sig = (ticket or "").split(".", 1); expires = int(expires)
    except ValueError: raise HTTPException(401, "Password required")
    if expires < time.time() or not hmac.compare_digest(sig, _pl_sig(row, expires)): raise HTTPException(401, "Password required")


def _client_ip(request) -> str:
    peer = request.client.host if request.client else "unknown"
    if peer in ("127.0.0.1", "::1"):
        fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or request.headers.get("x-real-ip", "").strip()
        if fwd: return fwd[:128]
    return peer[:128]


@router.get("/p/{link_id}")
async def public_link_page(link_id: str):
    if not _public_enabled(): return await index()
    return HTMLResponse("""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>mvmCloud</title><style>html,body{margin:0;min-height:100%;background:#1e1e2e;color:#cdd6f4;font:15px system-ui}</style></head><body><div id="app"></div><script>window.__assets=__ASSET_MAP__</script><script src="__ASSET_HELPER__"></script><script src="__ASSET_BOOT__"></script></body></html>""".replace("__ASSET_MAP__", assets_manifest()).replace("__ASSET_HELPER__", asset("/asset.js")).replace("__ASSET_BOOT__", asset("/apps/mvmcloud/link.js")),
                        headers={"X-Mvm-No-Public-Chrome": "1", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.get("/pl/{link_id}/info")
async def public_link_info(link_id: str):
    row = _pl_row(link_id); target = _pl_target(row)
    return {"name": target.name or "mvmCloud", "is_dir": target.is_dir(), "size": target.stat().st_size if target.is_file() else 0, "needs_password": bool(row["pass_hash"])}


@router.post("/pl/{link_id}/unlock")
async def public_link_unlock(link_id: str, body: LinkUpdateBody, request: Request):
    row = _pl_row(link_id); key = (link_id, _client_ip(request)); now = time.time()
    count, first = _pl_fail.get(key, (0, now))
    if now - first > 600: count, first = 0, now
    if count >= 8: raise HTTPException(429, "Too many attempts. Try again later.")
    if row["pass_hash"]:
        if not body.password or not hmac.compare_digest(_pl_hash(body.password, row["pass_salt"]), row["pass_hash"]):
            _pl_fail[key] = (count + 1, first); raise HTTPException(403, "Wrong password")
    _pl_fail.pop(key, None)
    return {"ticket": _pl_ticket(row)}


@router.get("/pl/{link_id}/list")
async def public_link_list(link_id: str, path: str = "", a: str = ""):
    row = _pl_row(link_id); _pl_check(row, a); target = _pl_target(row)
    if not target.is_dir(): raise HTTPException(404, "Folder not found")
    out = _entries(target, path)
    out["entries"] = [e for e in out["entries"] if not e["name"].startswith(".")]
    return out


@router.get("/pl/{link_id}/file")
async def public_link_file(link_id: str, path: str = "", a: str = "", dl: int = 1):
    row = _pl_row(link_id); _pl_check(row, a); target = _pl_target(row)
    file = target if target.is_file() else _safe(target, path)
    if not file.is_file() or file.name.startswith("."): raise HTTPException(404, "File not found")
    headers = {"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "sandbox"}
    kind = INLINE_TYPES.get(file.suffix.lower())
    if dl or not kind: return FileResponse(file, filename=file.name, headers=headers)
    return FileResponse(file, media_type=kind, filename=file.name, content_disposition_type="inline", headers={**headers, "Cache-Control": "private, max-age=600"})


@router.get("/links")
async def my_links(x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn: rows = conn.execute("SELECT id,path,is_dir,pass_hash,created_at FROM public_links WHERE owner_id=? ORDER BY created_at", (user["id"],)).fetchall()
    return {"enabled": _public_enabled(), "links": [{"id": r["id"], "path": r["path"], "is_dir": bool(r["is_dir"]), "has_password": bool(r["pass_hash"]), "created_at": r["created_at"]} for r in rows]}


def _pl_pass_fields(password):
    if not password: return None, None
    salt = secrets.token_bytes(16).hex(); return salt, _pl_hash(password, salt)


@router.post("/links")
async def create_link(body: LinkBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if not _public_enabled(): raise HTTPException(403, "Public links are turned off for mvmCloud")
    root = _user_root(user["id"]); target = _safe(root, body.path); rel = body.path.strip("/")
    if not target.exists() or target.is_symlink(): raise HTTPException(404, "Not found")
    with _db() as conn:
        for vault in conn.execute("SELECT path FROM vaults WHERE user_id=?", (user["id"],)):
            if not rel or rel == vault["path"] or rel.startswith(vault["path"] + "/") or vault["path"].startswith(rel + "/"):
                raise HTTPException(403, "Encrypted folders cannot get a public link")
        salt, digest = _pl_pass_fields(body.password)
        found = conn.execute("SELECT id FROM public_links WHERE owner_id=? AND path=?", (user["id"], rel)).fetchone()
        link_id = found["id"] if found else secrets.token_urlsafe(16)
        if found: conn.execute("UPDATE public_links SET pass_salt=?,pass_hash=? WHERE id=?", (salt, digest, link_id))
        else: conn.execute("INSERT INTO public_links(id,owner_id,path,is_dir,pass_salt,pass_hash,created_at) VALUES(?,?,?,?,?,?,?)", (link_id, user["id"], rel, int(target.is_dir()), salt, digest, int(time.time())))
        conn.commit()
    _audit("hub:" + user["id"], "public_link", rel); return {"id": link_id, "ok": True}


@router.put("/links/{link_id}")
async def update_link(link_id: str, body: LinkUpdateBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); salt, digest = _pl_pass_fields(body.password)
    with _db() as conn:
        if not conn.execute("UPDATE public_links SET pass_salt=?,pass_hash=? WHERE id=? AND owner_id=?", (salt, digest, link_id, user["id"])).rowcount: raise HTTPException(404, "Link not found")
        conn.commit()
    return {"ok": True}


@router.delete("/links/{link_id}")
async def delete_link(link_id: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn:
        if not conn.execute("DELETE FROM public_links WHERE id=? AND owner_id=?", (link_id, user["id"])).rowcount: raise HTTPException(404, "Link not found")
        conn.commit()
    _audit("hub:" + user["id"], "public_link_remove", link_id); return {"ok": True}


def _desktop_admin(session):
    if session.get("effective_user") != "root": raise HTTPException(403, "Root desktop access required")
    return session


def _premium_required():
    p = _premium()
    if not p or not p.is_available(): raise HTTPException(402, "premium_required")
    return p


@desktop_router.get("/admin/users")
async def admin_users(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session); hub = _hub()
    if not hub: return {"users":[]}
    users = hub.get_users_by_ids([p.name for p in USERS_ROOT.iterdir() if p.is_dir() and USER_ID_RE.fullmatch(p.name)] if USERS_ROOT.exists() else [])
    premium = _premium()
    enabled = bool(premium and premium.is_available())
    rules = premium.list_rules() if enabled and hasattr(premium, "list_rules") else {}
    for user in users:
        root = _user_root(user["id"]); user["usage_bytes"] = _usage(root); user["rule"] = rules.get(user["id"])
    return {"premium": enabled, "users":users}


@desktop_router.put("/admin/users/{user_id}/rule")
async def admin_rule(user_id: str, body: RuleBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session); premium = _premium_required()
    if not USER_ID_RE.fullmatch(user_id): raise HTTPException(400, "Invalid user")
    premium.save_rule(user_id, body.quota_bytes, body.encryption_allowed)
    return {"ok":True}


@desktop_router.get("/admin/settings")
async def admin_settings(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    premium = _premium()
    enabled = bool(premium and premium.is_available())
    settings = premium.get_settings() if enabled and hasattr(premium, "get_settings") else {"encryption_enabled": False, "default_quota_bytes": None, "user_api_enabled": False}
    return {"premium": enabled, **settings}


@desktop_router.put("/admin/settings")
async def save_settings(body: SettingsBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session); premium = _premium_required()
    premium.save_settings(body.encryption_enabled, body.default_quota_bytes, body.user_api_enabled)
    return {"ok":True}


@desktop_router.delete("/admin/users/{user_id}")
def admin_delete_user(user_id: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    root = _user_root(user_id)
    shutil.rmtree(root); shutil.rmtree(_thumb_dir(user_id), ignore_errors=True); _audit("desktop:root", "delete_user_storage", user_id)
    with _db() as conn:
        conn.execute("DELETE FROM folder_shares WHERE owner_id=? OR recipient_id=?", (user_id, user_id)); conn.execute("DELETE FROM public_links WHERE owner_id=?", (user_id,)); conn.execute("DELETE FROM mount_grants WHERE recipient=?", (user_id,)); conn.commit()
    return {"ok":True}


class GrantBody(BaseModel):
    recipient: str = Field(min_length=1, max_length=100)   # "*" means every profile
    permissions: list[str] = Field(default_factory=lambda: ["view"])


class MountBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = Field(pattern="^(server|remote)$")
    path: str = Field(default="", max_length=1000)          # absolute folder of this server, or the folder inside a shared folder
    folder_id: str | None = Field(default=None, max_length=100)
    grants: list[GrantBody] = Field(default_factory=list)


class MountGrantsBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    grants: list[GrantBody] = Field(default_factory=list)


def _mount_view(conn, row) -> dict:
    grants = _grants(conn, row["id"])
    profiles = _profiles({g for g in grants if g != "*"})
    ceiling = _mount_ceiling(row)
    return {"id": row["id"], "name": row["name"], "kind": row["kind"], "path": row["path"], "ceiling": sorted(ceiling),
            "available": bool(ceiling), "grants": [{"recipient": g, "name": ("*" if g == "*" else (profiles.get(g, {}).get("display_name") or profiles.get(g, {}).get("username") or g)),
                                                    "permissions": sorted(p)} for g, p in grants.items()]}


def _save_grants(conn, mount_id: str, ceiling: set, grants: list):
    seen = {}
    for g in grants:
        perms = _norm_perms(g.permissions)
        if perms - ceiling: raise HTTPException(400, "A right was chosen that the folder itself does not allow")
        if g.recipient != "*" and not USER_ID_RE.fullmatch(g.recipient): raise HTTPException(400, "Invalid profile")
        seen[g.recipient] = sorted(perms)
    real = {u for u in seen if u != "*"}
    if real and len(_profiles(real)) != len(real): raise HTTPException(404, "Apps Hub user not found")
    conn.execute("DELETE FROM mount_grants WHERE mount_id=?", (mount_id,))
    for who, perms in seen.items(): conn.execute("INSERT INTO mount_grants(mount_id,recipient,permissions) VALUES(?,?,?)", (mount_id, who, json.dumps(perms)))


@desktop_router.get("/admin/mounts")
async def admin_mounts(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    def build():
        with _db() as conn: return [_mount_view(conn, r) for r in conn.execute("SELECT * FROM mounts ORDER BY name")]
    return {"mounts": await run_in_threadpool(build)}


@desktop_router.post("/admin/mounts")
async def admin_mount_create(body: MountBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    session = _desktop_admin(session); linux_user = session["effective_user"]; folder_id = None; path = body.path.strip()
    if body.kind == "server":
        root = _fp().resolve_server_path(session, path, ["~"], kind="dir"); path = root
        home = _mount_home(linux_user)
        if Path(root) != home and home not in Path(root).parents: raise HTTPException(403, "Choose a folder inside the current Linux profile home")
    else:
        folder_id = _fp().shared_folder(session, body.folder_id or "")["id"]; path = path.strip("/")
        _remote_rel(SimpleNamespace(remote={"path": ""}), path)
    mount_id = secrets.token_urlsafe(10); row = {"id": mount_id, "kind": body.kind, "linux_user": linux_user, "path": path, "folder_id": folder_id}
    ceiling = await run_in_threadpool(_mount_ceiling, row)
    if not ceiling: raise HTTPException(400, "This folder cannot be reached")
    with _db() as conn:
        _save_grants(conn, mount_id, ceiling, body.grants)
        conn.execute("INSERT INTO mounts(id,name,kind,linux_user,path,folder_id,created_at) VALUES(?,?,?,?,?,?,?)", (mount_id, body.name.strip(), body.kind, linux_user, path, folder_id, int(time.time())))
        conn.commit()
    _audit("desktop:" + linux_user, "mount_create", body.kind + ":" + path)
    return {"id": mount_id, "ok": True}


@desktop_router.put("/admin/mounts/{mount_id}")
async def admin_mount_update(mount_id: str, body: MountGrantsBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    with _db() as conn:
        row = conn.execute("SELECT * FROM mounts WHERE id=?", (mount_id,)).fetchone()
        if not row: raise HTTPException(404, "Not found")
        ceiling = await run_in_threadpool(_mount_ceiling, row)
        _save_grants(conn, mount_id, ceiling, body.grants)
        if body.name: conn.execute("UPDATE mounts SET name=? WHERE id=?", (body.name.strip(), mount_id))
        conn.commit()
    return {"ok": True}


@desktop_router.delete("/admin/mounts/{mount_id}")
async def admin_mount_delete(mount_id: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    with _db() as conn:
        conn.execute("DELETE FROM mount_grants WHERE mount_id=?", (mount_id,))
        if not conn.execute("DELETE FROM mounts WHERE id=?", (mount_id,)).rowcount: raise HTTPException(404, "Not found")
        conn.commit()
    return {"ok": True}


@desktop_router.post("/admin/external-tokens")
async def create_external_token(body: TokenBody, session=Depends(sys.modules["backend.auth"].get_current_session)):
    session = _desktop_admin(session); root = Path(body.path).expanduser().resolve()
    home = Path(os.path.expanduser("~" if session["effective_user"] == "root" else "~" + session["effective_user"])).resolve()
    if root != home and home not in root.parents: raise HTTPException(403, "Choose a folder inside the current Linux profile home")
    if not root.is_dir() or root.is_symlink(): raise HTTPException(400, "Folder not found or is a symlink")
    permissions = sorted(set(body.permissions))
    if not permissions or set(permissions) - {"read","write","delete"}: raise HTTPException(400, "Invalid permissions")
    secret = secrets.token_urlsafe(32); token_id = secrets.token_urlsafe(12); digest = hashlib.sha256(secret.encode()).hexdigest()
    with _db() as conn:
        conn.execute("INSERT INTO external_tokens(id,linux_user,label,root_path,token_hash,permissions,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)", (token_id,session["effective_user"],body.label.strip(),str(root),digest,json.dumps(permissions),body.expires_at,int(time.time())))
        conn.commit()
    _audit("desktop:"+session["effective_user"], "create_external_token", str(root)); return {
        "id": token_id, "token": secret, "permissions": permissions,
        "external_url": "/pub/mvmcloud/external#key=" + quote(secret, safe=""),
    }


@desktop_router.get("/admin/external-tokens")
async def external_tokens(session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    with _db() as conn: rows = conn.execute("SELECT id,label,root_path,permissions,enabled,expires_at,created_at FROM external_tokens ORDER BY created_at DESC").fetchall()
    tokens = []
    for row in rows:
        token = dict(row)
        # Stored as JSON so it remains safe and queryable in SQLite; the
        # desktop receives an actual list for rendering and never parses data
        # in the browser.
        token["permissions"] = json.loads(token["permissions"])
        tokens.append(token)
    return {"tokens": tokens}


@desktop_router.delete("/admin/external-tokens/{token_id}")
def revoke_external_token(token_id: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    with _db() as conn: conn.execute("DELETE FROM external_tokens WHERE id=?", (token_id,)); conn.commit()
    return {"ok":True}


@desktop_router.put("/admin/external-tokens/{token_id}")
async def update_external_token_permissions(token_id: str, body: TokenPermissionsBody,
                                            session=Depends(sys.modules["backend.auth"].get_current_session)):
    """Change capability rights without rotating the secret or browser URL."""
    _desktop_admin(session)
    permissions = sorted(set(body.permissions))
    if not permissions or set(permissions) - {"read", "write", "delete"}:
        raise HTTPException(400, "Select at least one valid permission")
    with _db() as conn:
        changed = conn.execute("UPDATE external_tokens SET permissions=? WHERE id=?", (json.dumps(permissions), token_id)).rowcount
        conn.commit()
    if not changed:
        raise HTTPException(404, "Key not found")
    _audit("desktop:" + session["effective_user"], "update_external_token_permissions", token_id)
    return {"ok": True, "permissions": permissions}


def _capability(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "): raise HTTPException(401, "Bearer token required")
    digest = hashlib.sha256(authorization[7:].strip().encode()).hexdigest()
    with _db() as conn:
        row = conn.execute("SELECT * FROM external_tokens WHERE token_hash=?", (digest,)).fetchone()
        kind = "external"
        if not row:
            row = conn.execute("SELECT * FROM user_api_tokens WHERE token_hash=?", (digest,)).fetchone()
            kind = "user"
    if not row or not row["enabled"] or (kind == "external" and row["expires_at"] and row["expires_at"] < time.time()):
        raise HTTPException(401, "Invalid token")
    # User-created API capabilities are part of the administrator's Premium
    # offering. Existing key records remain intact when Premium ends, but
    # they are inert until the administrator renews and enables the feature.
    if kind == "user" and not _user_api_available():
        raise HTTPException(403, "User API keys are not enabled")
    root = Path(row["root_path"]).resolve() if kind == "external" else _safe(_user_root(row["user_id"]), row["root_path"])
    if not root.is_dir(): raise HTTPException(410, "Shared folder is unavailable")
    return row, root, set(json.loads(row["permissions"]))


def _capability_write_check(row, incoming: int = 0):
    """Apply the owner's normal storage policy to user-created API keys.

    Administrator Linux-folder keys are intentionally outside Apps Hub storage
    accounting; a user's key is not.
    """
    if "user_id" in row.keys():
        _check_write(_user_root(row["user_id"]), row["user_id"], incoming)


@router.get("/api/help")
async def api_help(authorization: str = Header(default=None)):
    """Self-describing entry point for people and AI clients.

    It deliberately describes only actions granted by this key. A client can
    start here after authentication instead of relying on an out-of-band
    command list, and a later permission change is reflected immediately.
    """
    _row, _root, perms = _capability(authorization)
    base = "/pub/mvmcloud/api"
    commands = []
    if "read" in perms:
        commands.extend([{"id": "list", "method": "GET", "path": base + "/list?path={path}",
                         "description": "List files and folders. Use an empty path for the shared root."},
            {"id": "download", "method": "GET", "path": base + "/download?path={path}",
                         "description": "Download one file."}])
    if "write" in perms:
        commands.extend([
            {"id": "mkdir", "method": "POST", "path": base + "/folders",
             "content_type": "application/json", "body": {"path": "new-folder"},
             "description": "Create a folder relative to the shared root."},
            {"id": "upload", "method": "POST", "path": base + "/upload",
             "content_type": "multipart/form-data", "fields": ["path", "file"],
             "description": "Upload a local file into a folder."},
        ])
    if "delete" in perms:
        commands.append({"id": "delete", "method": "DELETE", "path": base + "/files?path={path}",
                         "description": "Permanently delete one file or folder."})
    return {
        "service": "mvmCloud restricted folder API", "version": "1", "permissions": sorted(perms),
        "authentication": {"type": "bearer", "header": "Authorization: Bearer <API key>"},
        "rules": ["All paths are relative to the shared folder.", "No SSH, shell, or access outside this folder exists.",
                  "Call list before changing files when the target is uncertain."],
        "commands": commands,
    }


@router.get("/api/list")
async def api_list(path: str="", authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "read" not in perms: raise HTTPException(403,"Read not permitted")
    _audit("token:"+row["id"],"list",path); return _entries(root,path)


@router.get("/api/download")
async def api_download(path: str, authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "read" not in perms: raise HTTPException(403,"Read not permitted")
    file = _safe(root,path)
    if not file.is_file(): raise HTTPException(404,"File not found")
    _audit("token:"+row["id"],"download",path); return FileResponse(file,filename=file.name)


@router.post("/api/upload")
async def api_upload(path: str = Form(""), file: UploadFile = File(...), authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "write" not in perms or not file.filename or os.path.basename(file.filename)!=file.filename: raise HTTPException(403,"Write not permitted")
    target_dir = _safe(root,path)
    if not target_dir.is_dir(): raise HTTPException(404,"Folder not found")
    target = _safe(root,str(Path(path)/file.filename)); temp = target.with_name("."+target.name+".upload"); written=0
    try:
        with open(temp,"wb") as handle:
            while chunk := await file.read(1024*1024):
                written += len(chunk)
                if written > MAX_UPLOAD_BYTES: raise HTTPException(413,"File is too large")
                _capability_write_check(row, written)
                handle.write(chunk)
        os.replace(temp,target)
    finally: temp.unlink(missing_ok=True)
    _audit("token:"+row["id"],"upload",str(Path(path)/file.filename)); return {"ok":True,"size":written}


@router.post("/api/folders")
async def api_mkdir(body: PathBody, authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "write" not in perms: raise HTTPException(403,"Write not permitted")
    _capability_write_check(row)
    folder = _safe(root, body.path); folder.mkdir(parents=True, exist_ok=False)
    _audit("token:"+row["id"],"mkdir",body.path); return {"ok":True}


@router.delete("/api/files")
def api_delete(path: str, authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "delete" not in perms: raise HTTPException(403,"Delete not permitted")
    target = _safe(root,path)
    if target == root or not target.exists(): raise HTTPException(404,"Not found")
    _forget_thumbs(target)
    if target.is_dir(): shutil.rmtree(target)
    else: target.unlink()
    _audit("token:"+row["id"],"delete",path); return {"ok":True}
