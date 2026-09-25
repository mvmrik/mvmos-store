"""Local Display — shows mvmOS full screen on the computer's own screen.

The actual work is done by mvmos-display.sh, installed as the system command
/usr/local/bin/mvmos-display, so the app, the local terminal and an SSH
session all switch the screen the same way. This backend keeps that command
and its address file current, reports the state and runs the command for the
desktop, asking for the user's sudo password first.
"""

import os
import shutil
import subprocess
import sys
import threading

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

_auth = sys.modules["backend.auth"]
get_current_session = _auth.get_current_session
router = APIRouter(prefix="/api/local-display", tags=["local-display"])

SCRIPT_SRC = os.path.join(os.path.dirname(__file__), "mvmos-display.sh")
COMMAND = "/usr/local/bin/mvmos-display"
CONF = "/etc/mvmos-display.conf"
SERVICE = "mvmos-display"

# One action at a time; the first start installs packages and can take minutes.
_job = {"running": False, "action": None, "log": "", "ok": None}
_job_lock = threading.Lock()


def _sync_command(port: int) -> None:
    """Installs the current command and points it at this mvmOS. Cheap and
    idempotent, so it runs on every status request and follows a port change
    or an app update without a separate step."""
    try:
        with open(SCRIPT_SRC, "rb") as f:
            src = f.read()
        cur = open(COMMAND, "rb").read() if os.path.exists(COMMAND) else None
        if cur != src:
            with open(COMMAND + ".tmp", "wb") as f:
                f.write(src)
            os.chmod(COMMAND + ".tmp", 0o755)
            os.replace(COMMAND + ".tmp", COMMAND)
        conf = f'URL="http://localhost:{port}/"\n'
        old = open(CONF).read() if os.path.exists(CONF) else None
        if old != conf:
            with open(CONF, "w") as f:
                f.write(conf)
            os.chmod(CONF, 0o644)
    except OSError as e:
        print(f"[local-display] could not install {COMMAND}: {e}")


def _systemctl(*args) -> str:
    try:
        r = subprocess.run(["systemctl", *args, SERVICE], capture_output=True, text=True, timeout=10)
        return r.stdout.strip()
    except Exception:
        return ""


def _screens() -> list:
    """Connected outputs as the kernel sees them, e.g. HDMI-A-1."""
    found = []
    base = "/sys/class/drm"
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return found
    for name in names:
        path = os.path.join(base, name, "status")
        if "-" not in name or not os.path.isfile(path):
            continue
        try:
            if open(path).read().strip() == "connected":
                found.append(name.split("-", 1)[1])
        except OSError:
            pass
    return found


def _browser() -> str | None:
    for b in ("/usr/bin/chromium", "/snap/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"):
        if os.access(b, os.X_OK):
            return b
    return None


def _desktop() -> bool:
    """True when a graphical desktop already owns the screen. The kiosk would
    take the screen, keyboard and mouse away from it, so the app refuses.
    Same test as desktop() in mvmos-display.sh."""
    def run(*args):
        try:
            return subprocess.run(args, capture_output=True, text=True, timeout=5)
        except Exception:
            return None
    r = run("systemctl", "is-active", "--quiet", "display-manager")
    if r is not None and r.returncode == 0:
        return True
    r = run("loginctl", "list-sessions", "--no-legend")
    for line in (r.stdout.splitlines() if r else []):
        sid = line.split()[0] if line.split() else ""
        if not sid:
            continue
        info = run("loginctl", "show-session", sid, "-p", "Name", "-p", "Type")
        props = dict(l.split("=", 1) for l in (info.stdout.splitlines() if info else []) if "=" in l)
        if props.get("Name") != SERVICE and props.get("Type") in ("x11", "wayland", "mir"):
            return True
    return False


@router.get("/status")
def status(request: Request, session=Depends(get_current_session)):
    port = (request.scope.get("server") or ("", 0))[1]
    if port:
        _sync_command(port)
    with _job_lock:
        job = dict(_job)
    return JSONResponse({
        "supported": shutil.which("apt-get") is not None,
        "desktop": _desktop(),
        "screens": _screens(),
        "cage": shutil.which("cage") is not None,
        "browser": _browser(),
        "running": _systemctl("is-active") == "active",
        "enabled": _systemctl("is-enabled") == "enabled",
        "command": os.path.exists(COMMAND),
        "url": f"http://localhost:{port}/" if port else None,
        "job": job,
    })


class ActionBody(BaseModel):
    action: str
    password: str = ""


def _run(action: str) -> None:
    try:
        p = subprocess.Popen([COMMAND, action], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, bufsize=1)
        for line in p.stdout:
            with _job_lock:
                _job["log"] = (_job["log"] + line)[-20000:]
        ok = p.wait(timeout=1800) == 0
    except Exception as e:
        with _job_lock:
            _job["log"] += f"{e}\n"
        ok = False
    with _job_lock:
        _job.update(running=False, ok=ok)


@router.post("/action")
def action(body: ActionBody, request: Request, session=Depends(get_current_session)):
    if body.action not in ("start", "stop", "enable", "disable"):
        raise HTTPException(status_code=400, detail="Unknown action")
    # Switching the screen and installing system packages is an administrator
    # action, so it takes the same sudo password as the rest of mvmOS.
    _auth.require_sudo_password(session, body.password, request)
    if not os.path.exists(COMMAND):
        raise HTTPException(status_code=409, detail="not_ready")
    with _job_lock:
        if _job["running"]:
            raise HTTPException(status_code=409, detail="busy")
        _job.update(running=True, action=body.action, log="", ok=None)
    threading.Thread(target=_run, args=(body.action,), daemon=True).start()
    return JSONResponse({"ok": True})


def on_uninstall():
    """Takes the service, its user, the command and the packages the first
    start installed off the system again. Removing the Chromium snap can take
    a few minutes."""
    # The copy bundled with the app, not the installed one: that may be from an
    # older version that did not yet know how to remove everything.
    if os.path.exists(COMMAND) or os.path.exists("/var/lib/mvmos-display"):
        subprocess.run(["bash", SCRIPT_SRC, "remove"], capture_output=True, timeout=1800)
