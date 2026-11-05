"""Domains — connects the user's own domains to mvmOS through a Cloudflare Tunnel.

The app keeps its own copy of the open-source cloudflared connector in
/var/lib/mvmos-domains, signs in to Cloudflare with the official browser login,
creates one tunnel, points each domain at it and runs it as the systemd service
mvmos-domains. Nothing outside that folder and that service is touched, so a
cloudflared the user already runs keeps working. Every change asks for the
user's sudo password.
"""

import base64
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

_auth = sys.modules["backend.auth"]
get_current_session = _auth.get_current_session
router = APIRouter(prefix="/api/apps/domains", tags=["domains"])
router._app_backend = "domains"

STATE = "/var/lib/mvmos-domains"
BIN = os.path.join(STATE, "bin", "cloudflared")
CERTS = os.path.join(STATE, "certs")
HOME = os.path.join(STATE, "home")
STATE_FILE = os.path.join(STATE, "domains.json")
CONFIG = os.path.join(STATE, "config.yml")
CREDS = os.path.join(STATE, "credentials.json")
ENV_FILE = os.path.join(STATE, "tunnel.env")
SERVICE = "mvmos-domains"
UNIT = f"/etc/systemd/system/{SERVICE}.service"
SYSTEM_USER = "mvmos-domains"
DOWNLOAD = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-"
ARCHES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64",
          "armv7l": "arm", "armv6l": "arm", "i686": "386", "i386": "386"}

HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
ZONE_RE = re.compile(r"^[0-9a-f]{32}$")

STEPS = ("prepare", "download", "login", "tunnel", "dns", "start", "check")

_lock = threading.Lock()
_job = {"running": False, "host": "", "step": "", "done": [], "login_url": "", "ok": None,
        "error": "", "detail": "", "log": ""}
_login_proc = None
_cancel = threading.Event()


class JobError(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


# ── state ─────────────────────────────────────────────────────────────────────

def _load() -> dict:
    try:
        with open(STATE_FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    data.setdefault("mode", "")          # "" | "login" | "token"
    data.setdefault("tunnel", "")        # tunnel id (login mode)
    data.setdefault("domains", [])       # [{host, zone_id, zone, online, checked}]
    data.setdefault("zones", {})         # zone_id -> zone name or ""
    data.setdefault("port", 0)
    return data


def _save(data: dict) -> None:
    os.makedirs(STATE, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, STATE_FILE)


def _log(line: str) -> None:
    with _lock:
        _job["log"] = (_job["log"] + line.rstrip("\n") + "\n")[-12000:]


def _step(name: str) -> None:
    with _lock:
        if _job["step"] and _job["step"] not in _job["done"]:
            _job["done"].append(_job["step"])
        _job["step"] = name


# ── helpers ───────────────────────────────────────────────────────────────────

def _is_admin(session: dict) -> bool:
    user = session.get("effective_user")
    return user == "root" or bool(_auth.user_can_sudo(user))


def _require_admin(session: dict) -> None:
    if not _is_admin(session):
        raise HTTPException(status_code=403, detail="not_admin")


def _supported() -> bool:
    return (platform.system() == "Linux" and shutil.which("systemctl") is not None
            and ARCHES.get(platform.machine().lower()) is not None)


def _clean_host(value: str) -> str:
    host = (value or "").strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0].rstrip(".")
    if not HOST_RE.match(host):
        raise HTTPException(status_code=400, detail="bad_domain")
    return host


def _cf_env(cert: str = "") -> dict:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": HOME, "NO_COLOR": "1"}
    if cert:
        env["TUNNEL_ORIGIN_CERT"] = cert
    return env


def _run(args: list, cert: str = "", timeout: int = 120) -> tuple:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=_cf_env(cert))
        out = (p.stdout or "") + (p.stderr or "")
        return p.returncode, out
    except Exception as e:
        return 1, str(e)


def _systemctl(*args) -> str:
    try:
        r = subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=30)
        return r.stdout.strip()
    except Exception:
        return ""


def _foreign() -> bool:
    """True when the user already runs a cloudflared of their own."""
    found = shutil.which("cloudflared")
    if found and not (os.path.exists(BIN) and os.path.samefile(found, BIN)):
        return True
    return bool(_systemctl("list-unit-files", "--no-legend", "cloudflared*.service").strip())


def _cert_info(path: str) -> dict:
    """zone and account ids and the token inside a cloudflared login certificate."""
    try:
        text = open(path).read()
        m = re.search(r"-----BEGIN ARGO TUNNEL TOKEN-----(.*?)-----END ARGO TUNNEL TOKEN-----", text, re.S)
        data = json.loads(base64.b64decode("".join(m.group(1).split())))
        return {"zone_id": str(data.get("zoneID", "")), "account": str(data.get("accountID", "")),
                "token": str(data.get("apiToken", ""))}
    except Exception:
        return {}


def _zone_name(info: dict) -> str:
    """The zone's domain name, so a domain from another zone is caught early."""
    try:
        r = httpx.get(f"https://api.cloudflare.com/client/v4/zones/{info['zone_id']}",
                      headers={"Authorization": f"Bearer {info['token']}"}, timeout=15)
        return str(r.json()["result"]["name"]).lower()
    except Exception:
        return ""


def _cert_for(data: dict, host: str) -> tuple:
    """(zone_id, cert path) of the best signed-in zone that holds the host."""
    best = ("", "", -1)
    for zone_id, zone in data["zones"].items():
        path = os.path.join(CERTS, f"{zone_id}.pem")
        if not os.path.isfile(path):
            continue
        if zone and (host == zone or host.endswith("." + zone)) and len(zone) > best[2]:
            best = (zone_id, path, len(zone))
    return (best[0], best[1]) if best[2] >= 0 else ("", "")


def _write_config(data: dict) -> None:
    port = data.get("port") or 2026
    lines = []
    if data["mode"] == "login":
        lines += [f"tunnel: {data['tunnel']}", f"credentials-file: {CREDS}", "ingress:"]
        for d in data["domains"]:
            lines += [f"  - hostname: {d['host']}", f"    service: http://127.0.0.1:{port}"]
        lines += ["  - service: http_status:404"]
    with open(CONFIG, "w") as f:
        f.write("\n".join(lines) + "\n")
    _own(CONFIG)


def _own(path: str) -> None:
    """Readable by the service user only (and root)."""
    try:
        shutil.chown(path, "root", SYSTEM_USER)
        os.chmod(path, 0o640)
    except (OSError, LookupError):
        pass


def _ensure_user() -> None:
    if subprocess.run(["id", SYSTEM_USER], capture_output=True).returncode != 0:
        r = subprocess.run(["useradd", "--system", "--home-dir", STATE, "--no-create-home",
                            "--shell", "/usr/sbin/nologin", SYSTEM_USER], capture_output=True, text=True)
        if r.returncode != 0:
            raise JobError("service", r.stderr)
    os.makedirs(STATE, exist_ok=True)
    shutil.chown(STATE, "root", SYSTEM_USER)
    os.chmod(STATE, 0o750)
    for d in (CERTS, HOME, os.path.dirname(BIN)):
        os.makedirs(d, exist_ok=True)
    os.chmod(CERTS, 0o700)
    os.chmod(HOME, 0o700)


def _write_unit(mode: str) -> None:
    if mode == "token":
        exec_line = f"{BIN} --no-autoupdate tunnel run"
        env = f"EnvironmentFile={ENV_FILE}\n"
    else:
        exec_line = f"{BIN} --no-autoupdate tunnel --config {CONFIG} run"
        env = ""
    unit = (
        "[Unit]\nDescription=mvmOS Domains (Cloudflare Tunnel)\nAfter=network-online.target\nWants=network-online.target\n\n"
        f"[Service]\nUser={SYSTEM_USER}\nGroup={SYSTEM_USER}\n{env}"
        f"ExecStart={exec_line}\nRestart=always\nRestartSec=5\nNoNewPrivileges=yes\nPrivateTmp=yes\n\n"
        "[Install]\nWantedBy=multi-user.target\n"
    )
    with open(UNIT, "w") as f:
        f.write(unit)
    subprocess.run(["systemctl", "daemon-reload"], capture_output=True, timeout=30)


def _start_service() -> None:
    subprocess.run(["systemctl", "enable", SERVICE], capture_output=True, timeout=30)
    r = subprocess.run(["systemctl", "restart", SERVICE], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise JobError("service", r.stderr)


def _probe(host: str) -> bool:
    """A tunnel that is not connected answers 502 or 530 from Cloudflare."""
    try:
        r = httpx.get(f"https://{host}/", timeout=12, follow_redirects=True)
        return r.status_code < 500
    except Exception:
        return False


def _download() -> None:
    if os.path.isfile(BIN) and _run([BIN, "--version"], timeout=20)[0] == 0:
        return
    arch = ARCHES[platform.machine().lower()]
    tmp = BIN + ".tmp"
    try:
        with httpx.stream("GET", DOWNLOAD + arch, follow_redirects=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes():
                    f.write(chunk)
        os.chmod(tmp, 0o755)
        if _run([tmp, "--version"], timeout=20)[0] != 0:
            raise JobError("download", "The downloaded file does not run on this server.")
        os.replace(tmp, BIN)
    except JobError:
        raise
    except Exception as e:
        raise JobError("download", str(e))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def _login() -> tuple:
    """Official browser sign-in. Returns (zone_id, cert path)."""
    global _login_proc
    cert_default = os.path.join(HOME, ".cloudflared", "cert.pem")
    if os.path.exists(cert_default):
        os.remove(cert_default)
    p = subprocess.Popen([BIN, "tunnel", "login"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, env=_cf_env())
    _login_proc = p

    def reader():
        for line in p.stdout:
            m = re.search(r"https://\S+", line)
            if m and "cloudflare" in m.group(0):
                with _lock:
                    _job["login_url"] = m.group(0)
    threading.Thread(target=reader, daemon=True).start()
    deadline = time.time() + 600
    try:
        while p.poll() is None:
            if _cancel.is_set():
                raise JobError("cancelled")
            if time.time() > deadline:
                raise JobError("login", "Nobody signed in within ten minutes.")
            time.sleep(1)
    finally:
        if p.poll() is None:
            p.kill()
        _login_proc = None
        with _lock:
            _job["login_url"] = ""
    info = _cert_info(cert_default)
    if not ZONE_RE.match(info.get("zone_id", "")):
        raise JobError("login", "Cloudflare did not return a certificate.")
    target = os.path.join(CERTS, f"{info['zone_id']}.pem")
    shutil.move(cert_default, target)
    os.chmod(target, 0o600)
    data = _load()
    data["zones"][info["zone_id"]] = _zone_name(info)
    _save(data)
    return info["zone_id"], target


def _connect(host: str, port: int, target: str = "all") -> None:
    try:
        _step("prepare")
        data = _load()
        if data["mode"] == "token":
            raise JobError("token_mode")
        if any(d["host"] == host for d in data["domains"]):
            raise JobError("exists")
        from backend.db import get_conn
        with get_conn() as conn:
            if conn.execute("SELECT 1 FROM domains WHERE domain = ?", (host,)).fetchone():
                raise JobError("mapped")
        _ensure_user()
        _step("download")
        _download()
        _step("login")
        zone_id, cert = _cert_for(data, host)
        if not cert:
            zone_id, cert = _login()
            data = _load()
            zone = data["zones"].get(zone_id, "")
            if zone and not (host == zone or host.endswith("." + zone)):
                raise JobError("zone", zone)
        _step("tunnel")
        if not data["tunnel"] or not os.path.isfile(CREDS):
            name = "mvmos-" + re.sub(r"[^a-z0-9-]", "", socket.gethostname().lower())[:30] + "-" + secrets.token_hex(2)
            rc, out = _run([BIN, "tunnel", "create", name], cert=cert)
            m = re.search(r"Created tunnel \S+ with id ([0-9a-f-]{36})", out)
            c = re.search(r"credentials written to (\S+?)\.?\s", out + " ")
            if rc != 0 or not m or not c or not os.path.isfile(c.group(1)):
                raise JobError("tunnel", out)
            shutil.move(c.group(1), CREDS)
            os.chmod(CREDS, 0o640)
            _own(CREDS)
            data["tunnel"] = m.group(1)
            data["mode"] = "login"
            _save(data)
        _step("dns")
        rc, out = _run([BIN, "tunnel", "route", "dns", data["tunnel"], host], cert=cert)
        m = re.search(r"Added CNAME (\S+) which", out)
        if rc != 0:
            raise JobError("dns_exists" if "already exists" in out else "dns", out)
        if not m or m.group(1).lower() != host:
            raise JobError("zone", out)
        _step("start")
        data = _load()
        data["port"] = port
        data["domains"].append({"host": host, "zone_id": zone_id, "target": target, "online": None, "checked": 0})
        _save(data)
        _map_host(host, target)
        _write_config(data)
        _write_unit("login")
        _start_service()
        _step("check")
        ok = False
        for _ in range(8):
            time.sleep(4)
            if _probe(host):
                ok = True
                break
        data = _load()
        for d in data["domains"]:
            if d["host"] == host:
                d["online"], d["checked"] = ok, int(time.time())
        _save(data)
        with _lock:
            _job["done"].append("check")
            _job["step"] = ""
            _job["ok"] = True
    except JobError as e:
        with _lock:
            _job.update(ok=False, error=e.code, detail=(e.detail or "")[-1500:])
    except Exception as e:
        with _lock:
            _job.update(ok=False, error="failed", detail=str(e)[-1500:])
    finally:
        with _lock:
            _job["running"] = False


class ConnectBody(BaseModel):
    domain: str
    target: str = "all"      # "all" | "apphub" | the id of a public app
    password: str = ""


class PasswordBody(BaseModel):
    password: str = ""


class RemoveBody(BaseModel):
    domain: str
    password: str = ""


class TokenBody(BaseModel):
    token: str
    password: str = ""


def _targets() -> list:
    """What a domain can show besides the whole installation: Apps Hub and the public apps."""
    from backend.apphub import is_app_public
    from backend.db import get_conn
    with get_conn() as conn:
        rows = conn.execute("SELECT id, name, icon FROM plugins ORDER BY name COLLATE NOCASE").fetchall()
    found = [{"id": r["id"], "name": r["name"], "icon": r["icon"] or ""} for r in rows
             if r["id"] != "apphub" and is_app_public(r["id"])]
    return found


def _map_host(host: str, target: str) -> None:
    """Tells core to show only Apps Hub or only that app on the host."""
    from backend.db import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM domains WHERE domain = ? AND public_mode IS NOT NULL", (host,))
        if target != "all":
            conn.execute("INSERT INTO domains (domain, path, app_id, public_mode) VALUES (?, NULL, ?, ?)",
                         (host, target, "hub" if target == "apphub" else "app"))


def _unmap_host(host: str) -> None:
    from backend.db import get_conn
    with get_conn() as conn:
        conn.execute("DELETE FROM domains WHERE domain = ? AND public_mode IS NOT NULL", (host,))


def _start_job(host: str, port: int, target: str = "all") -> None:
    with _lock:
        if _job["running"]:
            raise HTTPException(status_code=409, detail="busy")
        _job.update(running=True, host=host, step="", done=[], login_url="", ok=None, error="", detail="", log="")
    _cancel.clear()
    threading.Thread(target=_connect, args=(host, port, target), daemon=True).start()


def _port(request: Request) -> int:
    return (request.scope.get("server") or ("", 0))[1] or 2026


# ── routes ────────────────────────────────────────────────────────────────────

@router.get("/status")
def status(request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    data = _load()
    port = _port(request)
    if data["mode"] == "login" and data["domains"] and data["port"] != port and not _job["running"]:
        data["port"] = port
        _save(data)
        _write_config(data)
        _systemctl("restart", SERVICE)
    with _lock:
        job = dict(_job)
    return JSONResponse({
        "supported": _supported(),
        "foreign": _foreign() if _supported() else False,
        "mode": data["mode"],
        "running": _systemctl("is-active", SERVICE) == "active",
        "domains": data["domains"],
        "targets": _targets(),
        "job": job,
        "steps": list(STEPS),
    })


@router.post("/connect")
def connect(body: ConnectBody, request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    _auth.require_sudo_password(session, body.password, request)
    if not _supported():
        raise HTTPException(status_code=409, detail="unsupported")
    target = (body.target or "all").strip()
    if target not in ("all", "apphub") and target not in [t["id"] for t in _targets()]:
        raise HTTPException(status_code=400, detail="bad_target")
    _start_job(_clean_host(body.domain), _port(request), target)
    return JSONResponse({"ok": True})


@router.post("/cancel")
def cancel(session=Depends(get_current_session)):
    _require_admin(session)
    _cancel.set()
    p = _login_proc
    if p is not None and p.poll() is None:
        p.kill()
    return JSONResponse({"ok": True})


@router.post("/check")
def check(body: RemoveBody, session=Depends(get_current_session)):
    _require_admin(session)
    host = _clean_host(body.domain)
    data = _load()
    for d in data["domains"]:
        if d["host"] == host:
            d["online"], d["checked"] = _probe(host), int(time.time())
            _save(data)
            return JSONResponse({"online": d["online"]})
    raise HTTPException(status_code=404, detail="not_found")


def _delete_dns(data: dict, host: str, zone_id: str) -> None:
    """Best effort: removes the CNAME record the app created for the host."""
    info = _cert_info(os.path.join(CERTS, f"{zone_id}.pem"))
    if not info:
        return
    try:
        h = {"Authorization": f"Bearer {info['token']}"}
        base = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        recs = httpx.get(base, params={"name": host, "type": "CNAME"}, headers=h, timeout=15).json().get("result", [])
        for rec in recs:
            if str(rec.get("content", "")).startswith(data["tunnel"] + ".cfargotunnel.com"):
                httpx.delete(f"{base}/{rec['id']}", headers=h, timeout=15)
    except Exception:
        pass


@router.post("/remove")
def remove(body: RemoveBody, request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    _auth.require_sudo_password(session, body.password, request)
    host = _clean_host(body.domain)
    data = _load()
    keep = [d for d in data["domains"] if d["host"] != host]
    if len(keep) == len(data["domains"]):
        raise HTTPException(status_code=404, detail="not_found")
    gone = next(d for d in data["domains"] if d["host"] == host)
    _delete_dns(data, host, gone["zone_id"])
    _unmap_host(host)
    data["domains"] = keep
    _save(data)
    _write_config(data)
    _systemctl("restart", SERVICE)
    return JSONResponse({"ok": True})


@router.post("/restart")
def restart(body: PasswordBody, request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    _auth.require_sudo_password(session, body.password, request)
    if _load()["mode"]:
        _systemctl("restart", SERVICE)
    return JSONResponse({"ok": True})


@router.post("/token")
def use_token(body: TokenBody, request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    _auth.require_sudo_password(session, body.password, request)
    if not _supported():
        raise HTTPException(status_code=409, detail="unsupported")
    token = (body.token or "").strip()
    # A tunnel token is base64 JSON with the account, tunnel id and secret.
    try:
        padded = token + "=" * (-len(token) % 4)
        parts = json.loads(base64.b64decode(padded))
        if not all(k in parts for k in ("a", "t", "s")):
            raise ValueError
    except Exception:
        raise HTTPException(status_code=400, detail="bad_token")
    data = _load()
    if data["mode"] == "login":
        raise HTTPException(status_code=409, detail="login_mode")
    with _lock:
        if _job["running"]:
            raise HTTPException(status_code=409, detail="busy")
    try:
        _ensure_user()
        _download()
        with open(ENV_FILE, "w") as f:
            f.write(f"TUNNEL_TOKEN={token}\n")
        _own(ENV_FILE)
        data.update(mode="token", tunnel="", domains=[])
        _save(data)
        _write_unit("token")
        _start_service()
    except JobError as e:
        raise HTTPException(status_code=500, detail=e.code + (": " + e.detail if e.detail else ""))
    return JSONResponse({"ok": True})


def _teardown() -> None:
    """Stops the service, removes the DNS records and tunnel the app created, and its files."""
    data = _load()
    for d in data["domains"]:
        try:
            _unmap_host(d["host"])
        except Exception:
            pass
    _systemctl("disable", "--now", SERVICE)
    if data["mode"] == "login" and os.path.isfile(BIN):
        for d in data["domains"]:
            _delete_dns(data, d["host"], d["zone_id"])
        certs = [os.path.join(CERTS, f) for f in os.listdir(CERTS)] if os.path.isdir(CERTS) else []
        if data["tunnel"] and certs:
            _run([BIN, "tunnel", "cleanup", data["tunnel"]], cert=certs[0], timeout=60)
            _run([BIN, "tunnel", "delete", data["tunnel"]], cert=certs[0], timeout=60)
    if os.path.exists(UNIT):
        os.remove(UNIT)
    subprocess.run(["systemctl", "daemon-reload"], capture_output=True, timeout=30)
    shutil.rmtree(STATE, ignore_errors=True)
    subprocess.run(["userdel", SYSTEM_USER], capture_output=True)


@router.post("/disconnect")
def disconnect(body: PasswordBody, request: Request, session=Depends(get_current_session)):
    _require_admin(session)
    _auth.require_sudo_password(session, body.password, request)
    with _lock:
        if _job["running"]:
            raise HTTPException(status_code=409, detail="busy")
    _teardown()
    return JSONResponse({"ok": True})


def on_uninstall():
    """Takes the service, the tunnel and everything the app put on the server off again."""
    if os.path.exists(STATE) or os.path.exists(UNIT):
        _teardown()
