"""mvmCloud's deliberately narrow file capability service.

This backend lives outside the store app because only the administrator's
external shares need to touch selected Linux folders.  Every path is resolved
under an explicit root; it never exposes a shell or a general filesystem API.
"""
import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

router = APIRouter()
desktop_router = APIRouter()

APP_ID = "mvmcloud"
APP_DIR = Path(__file__).resolve().parents[3] / "apps" / APP_ID
STORAGE = APP_DIR / "storage"
USERS_ROOT = STORAGE / "users"
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
    path = (root / value).resolve()
    if path != root and root not in path.parents:
        raise HTTPException(403, "Path escapes its folder")
    probe = root
    for part in path.relative_to(root).parts:
        probe = probe / part
        if probe.is_symlink():
            raise HTTPException(403, "Symlinks are not supported")
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
    quota = _policy(user_id)["quota_bytes"]
    if quota is not None and _usage(root) + incoming > quota:
        raise HTTPException(413, "Storage quota reached")


def _entries(root: Path, rel: str):
    folder = _safe(root, rel)
    if not folder.is_dir(): raise HTTPException(404, "Folder not found")
    rows = []
    for p in sorted(folder.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
        if p.is_symlink(): continue
        stat = p.stat()
        rows.append({"name": p.name, "type": "folder" if p.is_dir() else "file", "size": stat.st_size, "modified": int(stat.st_mtime)})
    return {"path": rel.strip("/"), "entries": rows}


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
    return {"id": user["id"], "usage_bytes": _usage(root), "policy": _policy(user["id"]), "vaults": vaults}


@router.get("/files")
async def files(path: str = "", x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); return _entries(_user_root(user["id"]), path)


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
async def revoke_user_api_key(token_id: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn:
        conn.execute("DELETE FROM user_api_tokens WHERE id=? AND user_id=?", (token_id, user["id"]))
        conn.commit()
    _audit("hub:" + user["id"], "revoke_user_api_key", token_id)
    return {"ok": True}


@router.get("/download")
async def download(path: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); file = _safe(_user_root(user["id"]), path)
    if not file.is_file(): raise HTTPException(404, "File not found")
    return FileResponse(file, filename=file.name)


@router.post("/folders")
async def mkdir(body: PathBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); _check_write(root, user["id"])
    target = _safe(root, body.path)
    target.mkdir(parents=True, exist_ok=False); _audit("hub:"+user["id"], "mkdir", body.path)
    return {"ok": True}


@router.post("/upload")
async def upload(path: str = Form(""), file: UploadFile = File(...), x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    if not file.filename or os.path.basename(file.filename) != file.filename: raise HTTPException(400, "Invalid filename")
    root = _user_root(user["id"]); target_dir = _safe(root, path)
    if not target_dir.is_dir(): raise HTTPException(404, "Folder not found")
    target = _safe(root, str(Path(path) / file.filename)); temp = target.with_name("." + target.name + ".upload")
    written = 0
    try:
        with open(temp, "wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk); _check_write(root, user["id"], written)
                handle.write(chunk)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    _audit("hub:"+user["id"], "upload", str(Path(path) / file.filename)); return {"ok": True, "size": written}


@router.post("/move")
async def move(body: MoveBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); _check_write(root, user["id"])
    source, dest = _safe(root, body.source), _safe(root, body.destination)
    if not source.exists() or dest.exists(): raise HTTPException(409, "Invalid move")
    if source.is_dir() and source in dest.parents: raise HTTPException(400, "Cannot move a folder into itself")
    source.rename(dest); _audit("hub:"+user["id"], "move", body.source + " -> " + body.destination); return {"ok":True}


@router.delete("/files")
async def delete(path: str, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); _check_write(root, user["id"])
    target = _safe(root, path)
    if target == root or not target.exists(): raise HTTPException(404, "Not found")
    if target.is_dir(): shutil.rmtree(target)
    else: target.unlink()
    _audit("hub:"+user["id"], "delete", path); return {"ok":True}


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


@router.get("/shares")
async def list_shares(x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token)
    with _db() as conn:
        rows = conn.execute("SELECT id,owner_id,path,permissions,created_at FROM folder_shares WHERE recipient_id=?", (user["id"],)).fetchall()
    profiles = {p["id"]:p for p in (_hub().get_users_by_ids([r["owner_id"] for r in rows]) if _hub() else [])}
    return {"shares":[{**dict(r),"owner":profiles.get(r["owner_id"],{})} for r in rows]}


@router.post("/shares")
async def create_share(body: ShareBody, x_pub_token: str = Header(default=None)):
    user = _need_public(x_pub_token); root = _user_root(user["id"]); folder = _safe(root,body.path)
    if not folder.is_dir() or folder.is_symlink(): raise HTTPException(404,"Folder not found")
    perms = sorted(set(body.permissions))
    if not perms or set(perms)-{"read","write","delete"}: raise HTTPException(400,"Invalid permissions")
    hub = _hub(); matches = hub.get_users_by_ids([body.recipient_id]) if hub else []
    if not matches or body.recipient_id == user["id"]: raise HTTPException(404,"Apps Hub user not found")
    share_id=secrets.token_urlsafe(12)
    with _db() as conn:
        conn.execute("INSERT INTO folder_shares(id,owner_id,recipient_id,path,permissions,created_at) VALUES(?,?,?,?,?,?)",(share_id,user["id"],body.recipient_id,body.path.strip("/"),json.dumps(perms),int(time.time())))
        conn.commit()
    _audit("hub:"+user["id"],"share",body.path+" -> "+body.recipient_id); return {"id":share_id,"ok":True}


def _shared(user_id: str, share_id: str):
    with _db() as conn: row=conn.execute("SELECT * FROM folder_shares WHERE id=? AND recipient_id=?",(share_id,user_id)).fetchone()
    if not row: raise HTTPException(404,"Shared folder not found")
    root=_safe(_user_root(row["owner_id"]),row["path"])
    if not root.is_dir(): raise HTTPException(410,"Shared folder is unavailable")
    return row,root,set(json.loads(row["permissions"]))


@router.get("/shares/{share_id}/files")
async def shared_files(share_id: str, path: str="", x_pub_token: str = Header(default=None)):
    user=_need_public(x_pub_token); row,root,perms=_shared(user["id"],share_id)
    if "read" not in perms: raise HTTPException(403,"Read not permitted")
    return _entries(root,path)


@router.post("/shares/{share_id}/upload")
async def shared_upload(share_id: str, path: str = Form(""), file: UploadFile = File(...), x_pub_token: str = Header(default=None)):
    user=_need_public(x_pub_token); row,root,perms=_shared(user["id"],share_id)
    if "write" not in perms or not file.filename or os.path.basename(file.filename)!=file.filename: raise HTTPException(403,"Write not permitted")
    folder=_safe(root,path)
    if not folder.is_dir(): raise HTTPException(404,"Folder not found")
    target=_safe(root,str(Path(path)/file.filename)); temp=target.with_name("."+target.name+".upload"); size=0
    try:
        with open(temp,"wb") as handle:
            while chunk:=await file.read(1024*1024):
                size+=len(chunk)
                if size>MAX_UPLOAD_BYTES: raise HTTPException(413,"File is too large")
                handle.write(chunk)
        os.replace(temp,target)
    finally: temp.unlink(missing_ok=True)
    _audit("hub:"+user["id"],"shared_upload",share_id+":"+str(Path(path)/file.filename)); return {"ok":True}


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
async def admin_delete_user(user_id: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
    _desktop_admin(session)
    root = _user_root(user_id)
    shutil.rmtree(root); _audit("desktop:root", "delete_user_storage", user_id)
    return {"ok":True}


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
async def revoke_external_token(token_id: str, session=Depends(sys.modules["backend.auth"].get_current_session)):
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
async def api_delete(path: str, authorization: str = Header(default=None)):
    row, root, perms = _capability(authorization)
    if "delete" not in perms: raise HTTPException(403,"Delete not permitted")
    target = _safe(root,path)
    if target == root or not target.exists(): raise HTTPException(404,"Not found")
    if target.is_dir(): shutil.rmtree(target)
    else: target.unlink()
    _audit("token:"+row["id"],"delete",path); return {"ok":True}
