import sys, os, re, subprocess, pwd, sqlite3
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/git-manager", tags=["git-manager"])

_DB_PATH = os.path.realpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "git-manager", "data.db"))


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS repo_favorites (system_user TEXT NOT NULL, path TEXT NOT NULL, "
                 "PRIMARY KEY (system_user, path))")
    # A display name the user gave a repository in this window only; the
    # folder and the repository itself are never renamed.
    conn.execute("CREATE TABLE IF NOT EXISTS repo_aliases (system_user TEXT NOT NULL, path TEXT NOT NULL, "
                 "alias TEXT NOT NULL, PRIMARY KEY (system_user, path))")
    # The command the Deploy button runs in the repository, whatever the
    # project uses for it (php artisan deploy, composer deploy, a script).
    conn.execute("CREATE TABLE IF NOT EXISTS repo_deploy (system_user TEXT NOT NULL, path TEXT NOT NULL, "
                 "command TEXT NOT NULL, PRIMARY KEY (system_user, path))")
    conn.execute("CREATE TABLE IF NOT EXISTS repo_cache (system_user TEXT NOT NULL, path TEXT NOT NULL, "
                 "PRIMARY KEY (system_user, path))")
    try:
        os.chmod(_DB_PATH, 0o600)
    except OSError:
        pass
    return conn


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
        return None


def _require_owned_directory(user, path):
    path = os.path.realpath(path)
    if not os.path.isdir(path):
        raise HTTPException(400, f'Directory not found: {path}')
    try:
        expected_uid = pwd.getpwnam(user).pw_uid
    except KeyError:
        raise HTTPException(403, 'Current system user does not exist')
    if os.stat(path).st_uid != expected_uid:
        raise HTTPException(403, 'This directory belongs to another user')
    git_path = os.path.join(path, '.git')
    if os.path.exists(git_path) and _repo_owner(path) != user:
        raise HTTPException(403, 'This repository belongs to another user')
    return path


def _premium_module():
    premium = sys.modules.get("backend.premium")
    return premium.load_premium_backend("git-manager") if premium else None


def _foreign_access(session):
    module = _premium_module()
    available = bool(module and module.is_available())
    is_root = session["effective_user"] == "root"
    return {
        'premium': available,
        'can_unlock': bool(available and module.can_unlock(session["effective_user"])),
        'unlocked': bool(is_root or (available and module.is_unlocked(session))),
    }


def _require_repo_access(session, path):
    path = os.path.realpath(path)
    if not os.path.isdir(path) or not os.path.exists(os.path.join(path, '.git')):
        raise HTTPException(404, 'Repository not found')
    owner = _repo_owner(path)
    if not owner:
        raise HTTPException(404, 'Repository owner not found')
    if owner != session["effective_user"] and not _foreign_access(session)['unlocked']:
        raise HTTPException(403, 'This repository is locked')
    return path, owner


def _run_git(user, path, args, timeout=60):
    return subprocess.run(
        ['runuser', '-u', user, '--', 'git', '-c', 'safe.directory=*', '-C', path] + args,
        capture_output=True, text=True, timeout=timeout, env=_env(user)
    )


def _git(session, path, args, timeout=60):
    path, owner = _require_repo_access(session, path)
    return _run_git(owner, path, args, timeout)


def _issues_module():
    module = _premium_module()
    if module is None or not module.is_available():
        raise HTTPException(403, 'Premium is required for Issues')
    return module


def _issues_context(session, path):
    path, _ = _require_repo_access(session, path)
    remote_r = _git(session, path, ['remote', 'get-url', 'origin'])
    if remote_r.returncode != 0 or not remote_r.stdout.strip():
        raise HTTPException(400, 'This repository has no origin remote')
    return _issues_module(), path, remote_r.stdout.strip(), session['effective_user']


def _issue_call(callback):
    try:
        return callback()
    except Exception as exc:
        status = getattr(exc, 'status', 500)
        detail = getattr(exc, 'detail', None) or str(exc) or 'GitHub request failed'
        raise HTTPException(status, detail) from exc


def _issue_branch_state(session, path, branch, fetch=True):
    dirty_r = _git(session, path, ['status', '--porcelain'])
    if dirty_r.returncode != 0:
        raise HTTPException(400, dirty_r.stderr.strip() or 'Could not inspect working tree')
    current_r = _git(session, path, ['branch', '--show-current'])
    current = current_r.stdout.strip() if current_r.returncode == 0 else ''
    local_r = _git(session, path, ['show-ref', '--verify', '--quiet', f'refs/heads/{branch}'])
    fetch_error = ''
    if fetch:
        fetch_r = _git(session, path, ['fetch', 'origin'], timeout=120)
        if fetch_r.returncode != 0:
            fetch_error = (fetch_r.stdout + fetch_r.stderr).strip() or 'Could not fetch origin'
    remote_r = _git(
        session, path,
        ['show-ref', '--verify', '--quiet', f'refs/remotes/origin/{branch}'],
    )
    return {
        'branch': branch,
        'current': current,
        'dirty': bool(dirty_r.stdout.strip()),
        'local_exists': local_r.returncode == 0,
        'remote_exists': remote_r.returncode == 0,
        'fetch_error': fetch_error,
    }


def _checkout_existing(session, path, branch):
    """Plain checkout of a branch that must already exist locally. Never creates."""
    result = _git(session, path, ['checkout', branch])
    output = (result.stdout + result.stderr).strip()
    if result.returncode != 0:
        raise HTTPException(400, output or 'Could not switch branch')
    return output


def _default_branch(session, path):
    r = _git(session, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    if r.returncode == 0 and r.stdout.strip():
        return r.stdout.strip().split('/', 1)[-1]
    for name in ('main', 'master'):
        check = _git(session, path, ['show-ref', '--verify', '--quiet', f'refs/heads/{name}'])
        if check.returncode == 0:
            return name
    return ''


def _activate_issue_branch(session, path, branch, mode='', base='', source='remote'):
    """Explicit 'Create branch' action for an issue. The window asks what to do
    first and sends it as mode, so the branch a user sees described in the
    dialog is the branch they get:
      switch   -> the branch exists locally, only check it out
      pull     -> check it out and fast-forward it from origin
      download -> it exists only on origin, create a local tracking branch
      create   -> it exists nowhere, start it from base/source
    An empty mode keeps the original behaviour of deciding automatically."""
    state = _issue_branch_state(session, path, branch)
    if state['fetch_error']:
        raise HTTPException(502, state['fetch_error'])
    if state['dirty'] and state['current'] != branch:
        raise HTTPException(409, 'Commit or discard your changes before switching branches')

    # The repository can change between opening the dialog and confirming it.
    if mode in ('switch', 'pull') and not state['local_exists']:
        raise HTTPException(409, f'Branch "{branch}" no longer exists locally')
    if mode == 'download' and not state['remote_exists']:
        raise HTTPException(409, f'Branch "{branch}" is not on origin')
    if mode == 'create' and (state['local_exists'] or state['remote_exists']):
        raise HTTPException(409, f'Branch "{branch}" already exists')

    base_label = ''
    if state['current'] != branch:
        if state['local_exists']:
            args = ['checkout', branch]
        elif state['remote_exists']:
            args = ['checkout', '-b', branch, '--track', f'origin/{branch}']
        else:
            start_point, base_label = _branch_start_point(session, path, base, source)
            # --no-track: an issue branch started from origin/main must not push into main.
            args = ['checkout', '--no-track', '-b', branch, start_point]
        result = _git(session, path, args)
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            raise HTTPException(400, output or 'Could not switch issue branch')

    pulled = False
    pull_output = ''
    if state['remote_exists'] and not state['dirty'] and mode != 'switch':
        upstream_r = _git(
            session, path,
            ['branch', '--set-upstream-to', f'origin/{branch}', branch],
        )
        if upstream_r.returncode != 0:
            raise HTTPException(400, upstream_r.stderr.strip() or 'Could not set branch upstream')
        pull_r = _git(session, path, ['pull', '--ff-only', 'origin', branch], timeout=120)
        pull_output = (pull_r.stdout + pull_r.stderr).strip()
        if pull_r.returncode != 0:
            raise HTTPException(409, pull_output or 'Could not fast-forward issue branch')
        pulled = True

    return {
        'ok': True,
        'branch': branch,
        'created_fresh': not state['local_exists'] and not state['remote_exists'],
        'downloaded': not state['local_exists'] and state['remote_exists'],
        'pulled': pulled,
        'local_only': not state['remote_exists'],
        'base': base_label,
        'output': pull_output,
    }


def _sync_issue_branch(session, path, branch):
    """Called whenever an issue is opened or navigated to. Never creates a
    branch — it only switches to one that already exists:
      - local branch exists  -> switch to it (fast-forward pull if tracked)
      - only remote exists   -> leave the working tree alone, report it as
                                 available for the explicit 'download' action
      - neither exists       -> move to the repo's default branch (if the
                                 tree is clean) so the user never stays
                                 stranded on a different issue's branch
    """
    state = _issue_branch_state(session, path, branch)
    result = {
        'branch': branch,
        'local_exists': state['local_exists'],
        'remote_exists': state['remote_exists'],
        'dirty': state['dirty'],
        'fetch_error': state['fetch_error'],
        'current': state['current'],
        'switched': False,
        'pulled': False,
        'redirected_default': '',
    }
    if state['fetch_error']:
        return result

    dirty = state['dirty']
    current = state['current']

    if state['local_exists']:
        if current != branch:
            if dirty:
                raise HTTPException(409, 'Commit or discard your changes before switching branches')
            _checkout_existing(session, path, branch)
            result['switched'] = True
            result['current'] = branch
        if state['remote_exists'] and not dirty:
            upstream_r = _git(session, path, ['branch', '--set-upstream-to', f'origin/{branch}', branch])
            if upstream_r.returncode == 0:
                pull_r = _git(session, path, ['pull', '--ff-only', 'origin', branch], timeout=120)
                result['pulled'] = pull_r.returncode == 0
        return result

    if not dirty:
        default_branch = _default_branch(session, path)
        if default_branch and current != default_branch:
            _checkout_existing(session, path, default_branch)
            result['redirected_default'] = default_branch
            result['current'] = default_branch

    return result


def _download_issue_branch(session, path, branch):
    """Explicit 'download' action: the issue's branch only exists on origin —
    fetch it, create a local tracking branch, switch to it, and pull."""
    state = _issue_branch_state(session, path, branch)
    if state['fetch_error']:
        raise HTTPException(502, state['fetch_error'])
    if not state['remote_exists']:
        raise HTTPException(400, 'This branch does not exist on origin')
    if state['dirty'] and state['current'] != branch:
        raise HTTPException(409, 'Commit or discard your changes before switching branches')

    if state['current'] != branch:
        if state['local_exists']:
            _checkout_existing(session, path, branch)
        else:
            result = _git(session, path, ['checkout', '-b', branch, '--track', f'origin/{branch}'])
            output = (result.stdout + result.stderr).strip()
            if result.returncode != 0:
                raise HTTPException(400, output or 'Could not check out remote branch')

    pull_r = _git(session, path, ['pull', '--ff-only', 'origin', branch], timeout=120)
    pull_output = (pull_r.stdout + pull_r.stderr).strip()
    if pull_r.returncode != 0:
        raise HTTPException(409, pull_output or 'Could not fast-forward issue branch')

    return {'ok': True, 'branch': branch, 'downloaded': True, 'local_only': False, 'output': pull_output}


# ── Repos ──────────────────────────────────────────────────────────────────────

def _scan_repo_paths(user):
    """Walks the usual project roots for .git folders. This is the slow part of
    listing repositories, so the result is cached per system user and only
    refreshed when every repository is requested."""
    seen = set()
    paths = []
    for base in ['/var/www', '/opt', '/home', _home(user)]:
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
    return paths


def _repo_entry(path, user, access, detailed):
    owner = _repo_owner(path)
    if not owner:
        return None
    entry = {'path': path, 'name': os.path.basename(path), 'branch': '', 'changes': 0,
             'remote': '', 'owner': owner, 'locked': owner != user and not access['unlocked'],
             'detailed': False}
    if entry['locked'] or not detailed:
        return entry
    entry['detailed'] = True
    try:
        # One status call gives both the branch header and the changed files.
        status_r = _run_git(owner, path, ['status', '--porcelain', '-b'], timeout=5)
        if status_r.returncode == 0:
            lines = [l for l in status_r.stdout.splitlines() if l.strip()]
            header = lines[0][3:] if lines and lines[0].startswith('## ') else ''
            if header.startswith('No commits yet on '):
                entry['branch'] = header[len('No commits yet on '):]
            elif header.startswith('HEAD (no branch)'):
                entry['branch'] = 'HEAD'
            else:
                entry['branch'] = header.split('...', 1)[0] or '?'
            entry['changes'] = len(lines) - (1 if header else 0)
        else:
            entry['branch'] = '?'
        remote_r = _run_git(owner, path, ['remote', 'get-url', 'origin'], timeout=5)
        entry['remote'] = remote_r.stdout.strip() if remote_r.returncode == 0 else ''
    except Exception:
        entry['branch'] = '?'
    return entry


@router.get("/repos")
def list_repos(all: bool = False, scan: bool = False, extra: list[str] = Query(default=[]),
               session=Depends(get_current_session)):
    """Lists every known repository, but only reads git state for favorites,
    the extra paths the window has opened this session, or everything when
    all=1. The disk scan runs only for scan=1 or when nothing is cached yet."""
    _require_git()
    user = session["effective_user"]
    access = _foreign_access(session)

    with _db() as conn:
        favorites = {r[0] for r in conn.execute(
            "SELECT path FROM repo_favorites WHERE system_user = ?", (user,))}
        aliases = dict(conn.execute(
            "SELECT path, alias FROM repo_aliases WHERE system_user = ?", (user,)))
        deploys = dict(conn.execute(
            "SELECT path, command FROM repo_deploy WHERE system_user = ?", (user,)))
        cached = [r[0] for r in conn.execute(
            "SELECT path FROM repo_cache WHERE system_user = ?", (user,))]
        if scan or not cached:
            paths = _scan_repo_paths(user)
            conn.execute("DELETE FROM repo_cache WHERE system_user = ?", (user,))
            conn.executemany("INSERT OR IGNORE INTO repo_cache (system_user, path) VALUES (?, ?)",
                             [(user, p) for p in paths])
            scanned = True
        else:
            paths = [p for p in cached if os.path.isdir(os.path.join(p, '.git'))]
            scanned = False

    wanted = favorites | set(extra)
    with ThreadPoolExecutor(max_workers=8) as pool:
        entries = pool.map(lambda p: _repo_entry(p, user, access, all or p in wanted), paths)
    result = []
    for entry in entries:
        if entry:
            entry['favorite'] = entry['path'] in favorites
            entry['alias'] = aliases.get(entry['path'])
            entry['deploy'] = deploys.get(entry['path'])
            result.append(entry)

    return JSONResponse({'repos': sorted(result, key=lambda x: (x['alias'] or x['name']).lower()),
                         'current_user': user, 'foreign_access': access, 'scanned': scanned})


class FavoriteBody(BaseModel):
    path: str
    favorite: bool


@router.post("/repos/favorite")
def set_repo_favorite(body: FavoriteBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    path = body.path.strip()
    if not path:
        raise HTTPException(400, 'Repository path is required')
    with _db() as conn:
        if body.favorite:
            conn.execute("INSERT OR IGNORE INTO repo_favorites (system_user, path) VALUES (?, ?)", (user, path))
        else:
            conn.execute("DELETE FROM repo_favorites WHERE system_user = ? AND path = ?", (user, path))
    return JSONResponse({'ok': True, 'path': path, 'favorite': body.favorite})


class RepoSettingsBody(BaseModel):
    path: str
    alias: str = ''
    deploy: str = ''


@router.post("/repos/settings")
def set_repo_settings(body: RepoSettingsBody, session=Depends(get_current_session)):
    """Sets the name the repository is shown under and the command its Deploy
    button runs; an empty value clears either. The name is purely visual —
    nothing on disk or in git changes. The command is only stored here and
    runs in the user's own shell when they press Deploy, never on its own."""
    user = session["effective_user"]
    path = body.path.strip()
    if not path:
        raise HTTPException(400, 'Repository path is required')
    alias = ' '.join(body.alias.split())[:120]
    # One line: it is typed into a shell, where a line break would run the
    # rest as a separate command.
    deploy = ' '.join(body.deploy.splitlines()).strip()[:500]
    with _db() as conn:
        if alias:
            conn.execute("INSERT INTO repo_aliases (system_user, path, alias) VALUES (?, ?, ?) "
                         "ON CONFLICT(system_user, path) DO UPDATE SET alias = excluded.alias", (user, path, alias))
        else:
            conn.execute("DELETE FROM repo_aliases WHERE system_user = ? AND path = ?", (user, path))
        if deploy:
            conn.execute("INSERT INTO repo_deploy (system_user, path, command) VALUES (?, ?, ?) "
                         "ON CONFLICT(system_user, path) DO UPDATE SET command = excluded.command", (user, path, deploy))
        else:
            conn.execute("DELETE FROM repo_deploy WHERE system_user = ? AND path = ?", (user, path))
    return JSONResponse({'ok': True, 'path': path, 'alias': alias or None, 'deploy': deploy or None})


class UnlockBody(BaseModel):
    password: str


@router.post("/repo/unlock")
def unlock_foreign_repos(body: UnlockBody, request: Request,
                         session=Depends(get_current_session)):
    module = _premium_module()
    if module is None or not module.is_available():
        raise HTTPException(403, 'Premium is required to unlock repositories from other profiles')
    ip = request.headers.get("X-Real-IP") or request.client.host
    result = module.unlock(session, body.password, ip)
    if not result.get('ok'):
        raise HTTPException(result.get('status', 403), result.get('detail', 'Unlock failed'))
    return JSONResponse({'ok': True, 'unlocked': True})


@router.get("/repo/status")
def repo_status(path: str, session=Depends(get_current_session)):
    branch_r = _git(session, path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    branch = branch_r.stdout.strip() if branch_r.returncode == 0 else '?'

    # -z keeps names with spaces or non-ASCII letters unquoted, so they can be
    # handed straight back to git (diff, discard). A rename carries its old
    # name as one extra NUL-separated field, which is skipped.
    status_r = _git(session, path, ['status', '--porcelain', '-z'])
    files = []
    entries = status_r.stdout.split('\0')
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        files.append({'code': entry[:2], 'file': entry[3:]})
        if entry[0] in 'RC' or entry[1] in 'RC':
            i += 1

    remote_r = _git(session, path, ['remote', 'get-url', 'origin'])
    remote = remote_r.stdout.strip() if remote_r.returncode == 0 else ''

    upstream_r = _git(session, path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    local_only = upstream_r.returncode != 0
    # A branch can be perfectly in sync with origin yet have no upstream
    # configured (e.g. a clone or checkout that never set -u). Re-link it
    # instead of showing it as local-only just because that metadata is
    # missing — otherwise ahead/behind stays blind and a plain "pull" fails.
    if local_only and branch != '?':
        remote_ref = _git(session, path, ['show-ref', '--verify', '--quiet', f'refs/remotes/origin/{branch}'])
        if remote_ref.returncode == 0:
            _git(session, path, ['branch', '--set-upstream-to', f'origin/{branch}', branch])
            local_only = False

    ahead, behind = 0, 0
    try:
        ab = _git(session, path, ['rev-list', '--count', '--left-right', 'HEAD...@{u}'], timeout=8)
        if ab.returncode == 0:
            parts = ab.stdout.strip().split()
            if len(parts) == 2:
                ahead, behind = int(parts[0]), int(parts[1])
    except Exception:
        pass

    return JSONResponse({'branch': branch, 'files': files, 'ahead': ahead, 'behind': behind,
                         'remote': remote, 'local_only': local_only,
                         'default_branch': _default_branch(session, path),
                         'has_commit_template': bool(_commit_template(session, path))})


def _commit_template(session, path):
    """The message git's own commit.template setting points to, the text `git
    commit` opens its editor with. Read as the repo owner, never as root, so
    the setting cannot be aimed at a file its owner may not read. Comment
    lines are dropped the way git's default cleanup drops them."""
    path, owner = _require_repo_access(session, path)
    r = _run_git(owner, path, ['config', '--path', '--get', 'commit.template'], timeout=8)
    template = r.stdout.strip()
    if r.returncode != 0 or not template:
        return ''
    try:
        read = subprocess.run(['runuser', '-u', owner, '--', 'head', '-c', '65536', '--',
                               os.path.join(path, template)],
                              capture_output=True, text=True, timeout=8)
    except Exception:
        return ''
    if read.returncode != 0:
        return ''
    return '\n'.join(line.rstrip() for line in read.stdout.splitlines()
                     if not line.startswith('#')).strip()


@router.get("/repo/commit-template")
def repo_commit_template(path: str, session=Depends(get_current_session)):
    return JSONResponse({'message': _commit_template(session, path)})


@router.get("/repo/branches")
def repo_branches(path: str, session=Depends(get_current_session)):
    r = _git(session, path, ['branch', '-a', '--format=%(refname:short)'])
    branches = []
    seen = set()
    for line in r.stdout.splitlines():
        b = line.strip()
        if not b or b in seen:
            continue
        seen.add(b)
        branches.append(b)
    current_r = _git(session, path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    current = current_r.stdout.strip() if current_r.returncode == 0 else ''
    return JSONResponse({'branches': branches, 'current': current})


class CheckoutBody(BaseModel):
    path: str
    branch: str


@router.post("/repo/checkout")
def repo_checkout(body: CheckoutBody, session=Depends(get_current_session)):
    branch = body.branch
    # strip remote prefix (origin/) for checkout
    local = branch.replace('origin/', '', 1) if branch.startswith('origin/') else branch
    r = _git(session, body.path, ['checkout', local])
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Checkout failed')
    return JSONResponse({'ok': True, 'branch': local, 'output': out})


class CreateBranchBody(BaseModel):
    path: str
    name: str
    base: str = ''
    source: str = 'remote'


def _branch_start_point(session, path, base, source):
    """Resolves where a new branch starts. The current branch is copied exactly
    as it is locally. Any other branch starts from its freshest remote state
    after a fetch, or from the local copy as it is when source is 'local'."""
    current_r = _git(session, path, ['branch', '--show-current'])
    if not base or base == current_r.stdout.strip():
        return 'HEAD', current_r.stdout.strip() or 'HEAD'

    local = _git(session, path, ['show-ref', '--verify', '--quiet', f'refs/heads/{base}']).returncode == 0
    if source == 'local':
        if not local:
            raise HTTPException(400, f'Branch "{base}" does not exist locally')
        return f'refs/heads/{base}', base
    _git(session, path, ['fetch', 'origin', base], timeout=60)
    remote = _git(session, path, ['show-ref', '--verify', '--quiet',
                                  f'refs/remotes/origin/{base}']).returncode == 0
    if remote:
        return f'refs/remotes/origin/{base}', f'origin/{base}'
    if local:
        return f'refs/heads/{base}', base
    raise HTTPException(400, f'Branch "{base}" was not found')


@router.post("/repo/branch/create")
def repo_branch_create(body: CreateBranchBody, session=Depends(get_current_session)):
    name = body.name.strip()
    base = body.base.strip()
    if not name:
        raise HTTPException(400, 'Branch name is required')
    if re.search(r'\s', name) or name.startswith('-') or '..' in name:
        raise HTTPException(400, 'Invalid branch name')
    if base.startswith('-'):
        raise HTTPException(400, 'Invalid base branch')
    exists_r = _git(session, body.path, ['show-ref', '--verify', '--quiet', f'refs/heads/{name}'])
    if exists_r.returncode == 0:
        raise HTTPException(400, f'Branch "{name}" already exists')
    start_point, base_label = _branch_start_point(session, body.path, base, body.source)
    # --no-track: a branch started from origin/main must not push back into main.
    r = _git(session, body.path, ['checkout', '--no-track', '-b', name, start_point])
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Could not create branch')
    remote_r = _git(session, body.path, ['show-ref', '--verify', '--quiet', f'refs/remotes/origin/{name}'])
    return JSONResponse({'ok': True, 'branch': name, 'base': base_label, 'output': out,
                         'local_only': remote_r.returncode != 0})


@router.get("/repo/diff")
def repo_diff(path: str, file: str, session=Depends(get_current_session)):
    # Try unstaged diff first, then staged (for new files added with git add)
    r = _git(session, path, ['diff', 'HEAD', '--', file])
    if not r.stdout.strip():
        r = _git(session, path, ['diff', '--cached', '--', file])
    return JSONResponse({'diff': r.stdout})


class DiscardBody(BaseModel):
    path: str
    file: str = ''


@router.post("/repo/discard")
def repo_discard(body: DiscardBody, session=Depends(get_current_session)):
    # Discard means both the working tree and the staged copy go back to HEAD,
    # otherwise a staged change would silently stay. Files that git does not
    # track yet (??) are never touched.
    target = ['--', body.file] if body.file else ['--', '.']
    r = _git(session, body.path, ['restore', '--staged', '--worktree'] + target)
    if r.returncode != 0:
        # fallback for older git
        r = _git(session, body.path, ['checkout', 'HEAD'] + target)
    if r.returncode != 0:
        raise HTTPException(400, (r.stdout + r.stderr).strip() or 'Discard failed')
    return JSONResponse({'ok': True})


@router.get("/repo/log")
def repo_log(path: str, session=Depends(get_current_session)):
    r = _git(session, path, ['log', '--format=%H\t%ar\t%s\t%an', '-30'])
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
    r = _git(session, body.path, ['pull'], timeout=120)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Pull failed')
    return JSONResponse({'ok': True, 'output': out})


@router.post("/repo/push")
def repo_push(body: PathBody, session=Depends(get_current_session)):
    upstream_r = _git(session, body.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    if upstream_r.returncode != 0:
        branch_r = _git(session, body.path, ['branch', '--show-current'])
        branch = branch_r.stdout.strip()
        if not branch:
            raise HTTPException(400, 'Not on a branch (detached HEAD) — cannot push')
        r = _git(session, body.path, ['push', '-u', 'origin', branch], timeout=120)
    else:
        r = _git(session, body.path, ['push'], timeout=120)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Push failed')
    return JSONResponse({'ok': True, 'output': out})


@router.post("/repo/fetch")
def repo_fetch(body: PathBody, session=Depends(get_current_session)):
    r = _git(session, body.path, ['fetch'], timeout=60)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Fetch failed')
    return JSONResponse({'ok': True, 'output': out})


class CommitBody(BaseModel):
    path: str
    message: str


@router.post("/repo/commit")
def repo_commit(body: CommitBody, session=Depends(get_current_session)):
    if not body.message.strip():
        raise HTTPException(400, 'Commit message is required')
    add_r = _git(session, body.path, ['add', '-A'])
    if add_r.returncode != 0:
        raise HTTPException(400, add_r.stderr.strip())
    r = _git(session, body.path, ['commit', '-m', body.message])
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
    path = _require_owned_directory(user, body.path)
    r = _run_git(user, path, ['init'])
    if r.returncode != 0:
        raise HTTPException(400, (r.stdout + r.stderr).strip() or 'git init failed')
    if body.remote.strip():
        _git(session, path, ['remote', 'add', 'origin', body.remote.strip()])
    return JSONResponse({'ok': True, 'output': (r.stdout + r.stderr).strip()})


class CloneBody(BaseModel):
    url: str
    dest: str


@router.post("/repo/clone")
def repo_clone(body: CloneBody, session=Depends(get_current_session)):
    user = session["effective_user"]
    dest = _require_owned_directory(user, body.dest)
    r = subprocess.run(
        ['runuser', '-u', user, '--', 'git', '-c', 'safe.directory=*', 'clone', body.url],
        capture_output=True, text=True, timeout=300,
        cwd=dest, env=_env(user)
    )
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise HTTPException(400, out or 'Clone failed')
    return JSONResponse({'ok': True, 'output': out})


# ── GitHub Issues (Premium implementation lives in apps/git-manager/premium) ──

@router.get("/repo/issues/status")
def issues_status(path: str, session=Depends(get_current_session)):
    module, _, remote, user = _issues_context(session, path)
    return JSONResponse(_issue_call(lambda: module.issue_status(user, remote)))


class IssueTokenBody(BaseModel):
    path: str
    token: str


@router.post("/repo/issues/token")
def issues_save_token(body: IssueTokenBody, session=Depends(get_current_session)):
    module, path, remote, user = _issues_context(session, body.path)
    return JSONResponse(_issue_call(lambda: module.save_token(user, remote, body.token)))


@router.delete("/repo/issues/token")
def issues_remove_token(path: str, session=Depends(get_current_session)):
    module, _, _, user = _issues_context(session, path)
    return JSONResponse(_issue_call(lambda: module.remove_token(user)))


@router.get("/repo/issues")
def issues_list(path: str, state: str = 'open', session=Depends(get_current_session)):
    if state not in ('open', 'closed'):
        raise HTTPException(400, 'Invalid issue state')
    module, _, remote, user = _issues_context(session, path)
    return JSONResponse({'issues': _issue_call(lambda: module.list_issues(user, remote, state))})


@router.get("/repo/issues/meta")
def issues_meta(path: str, session=Depends(get_current_session)):
    module, _, remote, user = _issues_context(session, path)
    return JSONResponse(_issue_call(lambda: module.repo_meta(user, remote)))


@router.get("/repo/issues/{number}")
def issues_detail(number: int, path: str, session=Depends(get_current_session)):
    module, _, remote, user = _issues_context(session, path)
    return JSONResponse({'issue': _issue_call(lambda: module.get_issue(user, remote, number))})


class IssueCreateBody(BaseModel):
    path: str
    title: str
    body: str = ''
    assignees: list[str] = []
    labels: list[str] = []
    milestone: int | None = None


@router.post("/repo/issues")
def issues_create(body: IssueCreateBody, session=Depends(get_current_session)):
    if not body.title.strip():
        raise HTTPException(400, 'Issue title is required')
    module, path, remote, user = _issues_context(session, body.path)
    issue = _issue_call(lambda: module.create_issue(
        user, remote, body.title, body.body, body.assignees, body.labels, body.milestone
    ))
    return JSONResponse({'issue': issue})


class IssueUpdateBody(BaseModel):
    path: str
    title: str
    body: str = ''
    assignees: list[str] = []
    labels: list[str] = []
    milestone: int | None = None


@router.patch("/repo/issues/{number}")
def issues_update(number: int, body: IssueUpdateBody, session=Depends(get_current_session)):
    if not body.title.strip():
        raise HTTPException(400, 'Issue title is required')
    module, _, remote, user = _issues_context(session, body.path)
    return JSONResponse({'issue': _issue_call(
        lambda: module.update_issue(
            user, remote, number, body.title, body.body, body.assignees, body.labels, body.milestone
        )
    )})


class ChecklistToggleBody(BaseModel):
    path: str
    index: int
    checked: bool


@router.patch("/repo/issues/{number}/checklist")
def issues_toggle_checklist(number: int, body: ChecklistToggleBody, session=Depends(get_current_session)):
    module, _, remote, user = _issues_context(session, body.path)
    return JSONResponse({'issue': _issue_call(
        lambda: module.toggle_checklist_item(user, remote, number, body.index, body.checked)
    )})


class IssueStateBody(BaseModel):
    path: str
    state: str


@router.patch("/repo/issues/{number}/state")
def issues_set_state(number: int, body: IssueStateBody, session=Depends(get_current_session)):
    if body.state not in ('open', 'closed'):
        raise HTTPException(400, 'Invalid issue state')
    module, _, remote, user = _issues_context(session, body.path)
    return JSONResponse({'issue': _issue_call(
        lambda: module.set_issue_state(user, remote, number, body.state)
    )})


class IssueBranchBody(BaseModel):
    path: str
    mode: str = ''
    base: str = ''
    source: str = 'remote'


@router.get("/repo/issues/{number}/branch")
def issues_branch_status(number: int, path: str, session=Depends(get_current_session)):
    module, path, remote, user = _issues_context(session, path)
    branch = _issue_call(lambda: module.issue_branch_name(user, remote, number))
    state = _issue_branch_state(session, path, branch)
    state['default_branch'] = _default_branch(session, path)
    return JSONResponse(state)


@router.post("/repo/issues/{number}/branch")
def issues_create_branch(number: int, body: IssueBranchBody, session=Depends(get_current_session)):
    module, path, remote, user = _issues_context(session, body.path)
    branch = _issue_call(lambda: module.issue_branch_name(user, remote, number))
    return JSONResponse(_activate_issue_branch(session, path, branch, body.mode, body.base, body.source))


@router.post("/repo/issues/{number}/branch/sync")
def issues_sync_branch(number: int, body: IssueBranchBody, session=Depends(get_current_session)):
    module, path, remote, user = _issues_context(session, body.path)
    branch = _issue_call(lambda: module.issue_branch_name(user, remote, number))
    return JSONResponse(_sync_issue_branch(session, path, branch))


@router.post("/repo/issues/{number}/branch/download")
def issues_download_branch(number: int, body: IssueBranchBody, session=Depends(get_current_session)):
    module, path, remote, user = _issues_context(session, body.path)
    branch = _issue_call(lambda: module.issue_branch_name(user, remote, number))
    return JSONResponse(_download_issue_branch(session, path, branch))


@router.get("/repo/pr")
def repo_list_prs(path: str, head: str, session=Depends(get_current_session)):
    module, _, remote, user = _issues_context(session, path)
    head = head.strip()
    if not head:
        raise HTTPException(400, 'Branch is required')
    return JSONResponse({'prs': _issue_call(lambda: module.list_pull_requests_for_branch(user, remote, head))})


class CreatePRBody(BaseModel):
    path: str
    head: str
    base: str
    title: str = ''
    body: str = ''


@router.post("/repo/pr")
def repo_create_pr(body: CreatePRBody, session=Depends(get_current_session)):
    # Requires Premium (GitHub API/gh CLI) just like the rest of the Issues
    # feature — plain git users never need this endpoint.
    module, path, remote, user = _issues_context(session, body.path)
    head = body.head.strip()
    base = body.base.strip()
    if not head or not base:
        raise HTTPException(400, 'Source and target branch are required')
    if head == base:
        raise HTTPException(400, 'Source and target branch cannot be the same')

    local_r = _git(session, path, ['show-ref', '--verify', '--quiet', f'refs/heads/{head}'])
    if local_r.returncode != 0:
        raise HTTPException(400, f'Branch "{head}" does not exist locally')

    upstream_r = _git(session, path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', f'{head}@{{u}}'])
    if upstream_r.returncode != 0:
        push_r = _git(session, path, ['push', '-u', 'origin', head], timeout=120)
        if push_r.returncode != 0:
            raise HTTPException(400, (push_r.stdout + push_r.stderr).strip() or 'Could not push the branch before opening the pull request')

    title = body.title.strip() or head
    result = _issue_call(lambda: module.create_pull_request(user, remote, head, base, title, body.body))
    return JSONResponse(result)


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
