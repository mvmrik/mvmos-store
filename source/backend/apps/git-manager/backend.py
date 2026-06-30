import sys, os, subprocess, pwd
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/git-manager", tags=["git-manager"])


def _home(user):
    try:
        return pwd.getpwnam(user).pw_dir
    except KeyError:
        return '/root' if user == 'root' else f'/home/{user}'


def _env(user):
    return {
        'HOME': _home(user),
        'PATH': '/usr/bin:/bin:/usr/local/bin:/usr/sbin',
        'GIT_TERMINAL_PROMPT': '0',
        'GIT_PAGER': 'cat',
        'LANG': 'en_US.UTF-8',
        'USER': user,
    }


def _require_git():
    import shutil
    if not shutil.which('git'):
        raise HTTPException(503, 'git is not installed on this server. Run: apt install git')


def _repo_owner(path):
    try:
        uid = os.stat(os.path.join(path, '.git')).st_uid
        return pwd.getpwuid(uid).pw_name
    except Exception:
        return 'root'


def _git(user, path, args, timeout=60):
    run_as = _repo_owner(path)
    return subprocess.run(
        ['runuser', '-u', run_as, '--', 'git', '-c', 'safe.directory=*', '-C', path] + args,
        capture_output=True, text=True, timeout=timeout, env=_env(run_as)
    )


# ── Repos ──────────────────────────────────────────────────────────────────────

@router.get("/repos")
def list_repos(session=Depends(get_current_session)):
    _require_git()
    user = session["effective_user"]
    home = _home(user)
    scan_dirs = ['/var/www', '/opt', home]
    if user != 'root':
        scan_dirs.append('/home')

    seen = set()
    paths = []
    for base in scan_dirs:
        if not os.path.isdir(base):
            continue
        try:
            r = subprocess.run(
                ['find', base, '-name', '.git', '-maxdepth', '4', '-type', 'd',
                 '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.git/*'],
                capture_output=True, text=True, timeout=10
            )
            for line in r.stdout.splitlines():
                p = os.path.dirname(line.strip())
                if p and p not in seen:
                    seen.add(p)
                    paths.append(p)
        except Exception:
            pass

    result = []
    for path in paths:
        try:
            branch_r = _git(user, path, ['rev-parse', '--abbrev-ref', 'HEAD'], timeout=5)
            branch = branch_r.stdout.strip() if branch_r.returncode == 0 else '?'

            status_r = _git(user, path, ['status', '--porcelain'], timeout=5)
            changes = len([l for l in status_r.stdout.splitlines() if l.strip()]) if status_r.returncode == 0 else 0

            remote_r = _git(user, path, ['remote', 'get-url', 'origin'], timeout=5)
            remote = remote_r.stdout.strip() if remote_r.returncode == 0 else ''

            result.append({
                'path': path,
                'name': os.path.basename(path),
                'branch': branch,
                'changes': changes,
                'remote': remote,
                'owner': _repo_owner(path),
            })
        except Exception:
            result.append({'path': path, 'name': os.path.basename(path), 'branch': '?', 'changes': 0, 'remote': ''})

    return JSONResponse({'repos': sorted(result, key=lambda x: x['name'].lower()), 'current_user': user})


@router.get("/repo/status")
def repo_status(path: str, session=Depends(get_current_session)):
    user = session["effective_user"]

    branch_r = _git(user, path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    branch = branch_r.stdout.strip() if branch_r.returncode == 0 else '?'

    status_r = _git(user, path, ['status', '--porcelain'])
    files = []
    for line in status_r.stdout.splitlines():
        if len(line) >= 3:
            files.append({'code': line[:2], 'file': line[3:]})

    ahead, behind = 0, 0
    try:
        ab = _git(user, path, ['rev-list', '--count', '--left-right', 'HEAD...@{u}'], timeout=8)
        if ab.returncode == 0:
            parts = ab.stdout.strip().split()
            if len(parts) == 2:
                ahead, behind = int(parts[0]), int(parts[1])
    except Exception:
        pass

    remote_r = _git(user, path, ['remote', 'get-url', 'origin'])
    remote = remote_r.stdout.strip() if remote_r.returncode == 0 else ''

    return JSONResponse({'branch': branch, 'files': files, 'ahead': ahead, 'behind': behind, 'remote': remote})


@router.get("/repo/branches")
def repo_branches(path: str, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = _git(user, path, ['branch', '-a', '--format=%(refname:short)'])
    branches = []
    seen = set()
    for line in r.stdout.splitlines():
        b = line.strip()
        if not b or b in seen:
            continue
        seen.add(b)
        branches.append(b)
    current_r = _git(user, path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    current = current_r.stdout.strip() if current_r.returncode == 0 else ''
    return JSONResponse({'branches': branches, 'current': current})


class CheckoutBody(BaseModel):
    path: str
    branch: str


@router.post("/repo/checkout")
def repo_checkout(body: CheckoutBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    branch = body.branch
    # strip remote prefix (origin/) for checkout
    local = branch.replace('origin/', '', 1) if branch.startswith('origin/') else branch
    r = _git(user, body.path, ['checkout', local])
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Checkout failed')
    return JSONResponse({'ok': True, 'branch': local, 'output': out})


@router.get("/repo/diff")
def repo_diff(path: str, file: str, session=Depends(get_current_session)):
    user = session["effective_user"]
    # Try unstaged diff first, then staged (for new files added with git add)
    r = _git(user, path, ['diff', 'HEAD', '--', file])
    if not r.stdout.strip():
        r = _git(user, path, ['diff', '--cached', '--', file])
    return JSONResponse({'diff': r.stdout})


class DiscardBody(BaseModel):
    path: str
    file: str = ''


@router.post("/repo/discard")
def repo_discard(body: DiscardBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    if body.file:
        r = _git(user, body.path, ['restore', '--', body.file])
        if r.returncode != 0:
            # fallback for older git
            r = _git(user, body.path, ['checkout', '--', body.file])
        if r.returncode != 0:
            raise HTTPException(400, (r.stdout + r.stderr).strip() or 'Discard failed')
    else:
        r = _git(user, body.path, ['restore', '.'])
        if r.returncode != 0:
            r = _git(user, body.path, ['checkout', '--', '.'])
        if r.returncode != 0:
            raise HTTPException(400, (r.stdout + r.stderr).strip() or 'Discard failed')
    return JSONResponse({'ok': True})


@router.get("/repo/log")
def repo_log(path: str, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = _git(user, path, ['log', '--format=%H\t%ar\t%s\t%an', '-30'])
    entries = []
    for line in r.stdout.splitlines():
        parts = line.split('\t', 3)
        if len(parts) == 4:
            entries.append({'hash': parts[0][:7], 'date': parts[1], 'message': parts[2], 'author': parts[3]})
    return JSONResponse(entries)


class PathBody(BaseModel):
    path: str


@router.post("/repo/pull")
def repo_pull(body: PathBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = _git(user, body.path, ['pull'], timeout=120)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Pull failed')
    return JSONResponse({'ok': True, 'output': out})


@router.post("/repo/push")
def repo_push(body: PathBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = _git(user, body.path, ['push'], timeout=120)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Push failed')
    return JSONResponse({'ok': True, 'output': out})


@router.post("/repo/fetch")
def repo_fetch(body: PathBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = _git(user, body.path, ['fetch'], timeout=60)
    return JSONResponse({'ok': True, 'output': (r.stdout + r.stderr).strip()})


class CommitBody(BaseModel):
    path: str
    message: str


@router.post("/repo/commit")
def repo_commit(body: CommitBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    if not body.message.strip():
        raise HTTPException(400, 'Commit message is required')
    add_r = _git(user, body.path, ['add', '-A'])
    if add_r.returncode != 0:
        raise HTTPException(400, add_r.stderr.strip())
    r = _git(user, body.path, ['commit', '-m', body.message])
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Commit failed')
    return JSONResponse({'ok': True, 'output': out})


class InitBody(BaseModel):
    path: str
    remote: str = ''


@router.post("/repo/init")
def repo_init(body: InitBody, session=Depends(get_current_session)):
    _require_git()
    user = session["effective_user"]
    if not os.path.isdir(body.path):
        raise HTTPException(400, f'Directory not found: {body.path}')
    r = _git(user, body.path, ['init'])
    if r.returncode != 0:
        raise HTTPException(400, (r.stdout + r.stderr).strip() or 'git init failed')
    if body.remote.strip():
        _git(user, body.path, ['remote', 'add', 'origin', body.remote.strip()])
    return JSONResponse({'ok': True, 'output': (r.stdout + r.stderr).strip()})


class CloneBody(BaseModel):
    url: str
    dest: str


@router.post("/repo/clone")
def repo_clone(body: CloneBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    if not os.path.isdir(body.dest):
        raise HTTPException(400, f'Directory not found: {body.dest}')
    r = subprocess.run(
        ['runuser', '-u', user, '--', 'git', '-c', 'safe.directory=*', 'clone', body.url],
        capture_output=True, text=True, timeout=300,
        cwd=body.dest, env=_env(user)
    )
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Clone failed')
    return JSONResponse({'ok': True, 'output': out})


# ── SSH ────────────────────────────────────────────────────────────────────────

@router.get("/ssh")
def list_ssh_keys(session=Depends(get_current_session)):
    user = session["effective_user"]
    ssh_dir = os.path.join(_home(user), '.ssh')
    keys = []
    for name in ['id_ed25519', 'id_rsa', 'id_ecdsa']:
        pub = os.path.join(ssh_dir, name + '.pub')
        if os.path.exists(pub) and os.path.exists(os.path.join(ssh_dir, name)):
            try:
                keys.append({'type': name, 'public_key': open(pub).read().strip()})
            except Exception:
                pass
    return JSONResponse(keys)


class GenerateKeyBody(BaseModel):
    comment: str = ''


@router.post("/ssh/generate")
def generate_ssh_key(body: GenerateKeyBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    ssh_dir = os.path.join(_home(user), '.ssh')
    key_file = os.path.join(ssh_dir, 'id_ed25519')
    if os.path.exists(key_file):
        raise HTTPException(400, 'Key id_ed25519 already exists')
    os.makedirs(ssh_dir, mode=0o700, exist_ok=True)
    comment = body.comment.strip() or f'{user}@mvmos'
    r = subprocess.run(
        ['runuser', '-u', user, '--', 'ssh-keygen', '-t', 'ed25519', '-f', key_file, '-N', '', '-C', comment],
        capture_output=True, text=True, timeout=15, env=_env(user)
    )
    if r.returncode != 0:
        raise HTTPException(400, r.stderr.strip())
    return JSONResponse({'ok': True, 'public_key': open(key_file + '.pub').read().strip()})


class TestSSHBody(BaseModel):
    host: str


@router.post("/ssh/test")
def test_ssh(body: TestSSHBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    r = subprocess.run(
        ['runuser', '-u', user, '--', 'ssh', '-T',
         '-o', 'StrictHostKeyChecking=no',
         '-o', 'ConnectTimeout=8',
         '-o', 'BatchMode=yes',
         f'git@{body.host}'],
        capture_output=True, text=True, timeout=15, env=_env(user)
    )
    output = (r.stdout + r.stderr).strip()
    ok = any(x in output for x in ['Hi ', 'Welcome to', 'successfully authenticated', 'You\'ve successfully'])
    return JSONResponse({'ok': ok, 'output': output})
