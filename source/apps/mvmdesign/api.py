"""mvmDesign server originals and explicit per-project Apps Hub grants.

Public profiles can download local copies and update existing editor grants only.
They cannot create server projects, browse Linux paths, or manage sharing.
"""
import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

APP_ID = 'mvmdesign'
_DIR = os.path.dirname(__file__)
_DB = os.path.join(_DIR, 'data.db')
MAX_BYTES = 256 * 1024 * 1024
current_session = sys.modules['backend.auth'].get_current_session


@contextmanager
def _conn():
    c = sqlite3.connect(_DB, timeout=30)
    try:
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        with c:
            yield c
    finally:
        c.close()


def _init():
    with _conn() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS design_projects (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
          width INTEGER NOT NULL, height INTEGER NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS design_shares (
          project_id TEXT NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor')),
          PRIMARY KEY(project_id,user_id));
        CREATE INDEX IF NOT EXISTS design_share_user ON design_shares(user_id);
        ''')


_init()


def _hub():
    return sys.modules.get('backend.apphub')


def _enabled():
    hub = _hub()
    if not hub or not hub.is_app_public(APP_ID):
        raise HTTPException(403, 'publicDisabled')
    return hub


def public_user(x_pub_token: str = Header(default='')):
    user = _enabled().get_pub_session(x_pub_token)
    if not user:
        raise HTTPException(401, 'loginRequired')
    return user


def desktop_user(request: Request, session=Depends(current_session)):
    if request.method not in ('GET', 'HEAD') and request.headers.get('x-mvmdesign') != '1':
        raise HTTPException(403, 'accessDenied')
    return session['effective_user']


router = APIRouter()
desktop_router = APIRouter()


def _project(c, project_id, owner=None, user=None, write=False):
    row = c.execute('SELECT * FROM design_projects WHERE id=?', (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'projectUnavailable')
    if owner is not None:
        if row['owner'] != owner:
            raise HTTPException(404, 'projectUnavailable')
        return row, 'owner'
    grant = c.execute('SELECT role FROM design_shares WHERE project_id=? AND user_id=?',
                      (project_id, user['id'])).fetchone()
    if not grant:
        raise HTTPException(404, 'projectUnavailable')
    if write and grant['role'] != 'editor':
        raise HTTPException(403, 'readOnlyProject')
    return row, grant['role']


def _meta(row, role):
    return {k: row[k] for k in ('id', 'name', 'width', 'height', 'revision')} | {'role': role}


async def _body(request):
    raw = bytearray()
    async for part in request.stream():
        raw.extend(part)
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, 'tooLarge')
    try:
        body = json.loads(raw)
        p = body['project']
        if not isinstance(p, dict) or p.get('format') != 'mvmdesign' or p.get('version') != 1:
            raise ValueError()
        if not isinstance(p.get('pages'), list) or not 1 <= len(p['pages']) <= 500:
            raise ValueError()
        if not all(isinstance(p.get(k), (int, float)) and 64 <= p[k] <= 7680 for k in ('width','height')):
            raise ValueError()
        if p['width'] * p['height'] > 34000000:
            raise ValueError()
        name = str(p.get('name') or '')[:200]
        p['name'] = name
        content = json.dumps(p, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        return body, p, content
    except (ValueError, TypeError, KeyError, RecursionError):
        raise HTTPException(400, 'invalidProject')


@router.get('/')
def index():
    _enabled()
    return FileResponse(os.path.join(_DIR, 'public', 'index.html'), headers={'Cache-Control':'no-store'})


@router.get('/projects')
def shared_projects(user=Depends(public_user)):
    with _conn() as c:
        rows = c.execute('''SELECT p.id,p.name,p.width,p.height,p.revision,s.role
          FROM design_projects p JOIN design_shares s ON s.project_id=p.id
          WHERE s.user_id=? ORDER BY p.rowid DESC''', (user['id'],)).fetchall()
    return JSONResponse([_meta(r, r['role']) for r in rows], headers={'Cache-Control':'no-store'})


@desktop_router.get('/projects')
def own_projects(owner=Depends(desktop_user)):
    with _conn() as c:
        rows = c.execute('SELECT id,name,width,height,revision FROM design_projects WHERE owner=? ORDER BY rowid DESC', (owner,)).fetchall()
    return JSONResponse([_meta(r, 'owner') for r in rows], headers={'Cache-Control':'no-store'})


@desktop_router.post('/projects')
async def create_project(request: Request, owner=Depends(desktop_user)):
    _, p, content = await _body(request)
    project_id = uuid.uuid4().hex
    with _conn() as c:
        c.execute('INSERT INTO design_projects(id,owner,name,width,height,body) VALUES(?,?,?,?,?,?)',
                  (project_id, owner, p['name'], p['width'], p['height'], content))
        row, role = _project(c, project_id, owner=owner)
    return JSONResponse(_meta(row, role), headers={'Cache-Control':'no-store'})


def _get(project_id, owner=None, user=None, status=False):
    with _conn() as c:
        row, role = _project(c, project_id, owner, user)
        result = _meta(row, role)
        if not status:
            result['project'] = json.loads(row['body'])
    return JSONResponse(result, headers={'Cache-Control':'no-store'})


def _preview(project_id, owner=None, user=None):
    # Return only the cover page and its images. Audio and other pages stay on the server.
    with _conn() as c:
        row, _ = _project(c, project_id, owner, user)
        project = json.loads(row['body'])
    page = project['pages'][0]
    used = {item.get('assetId') for item in page.get('items', []) if item.get('type') == 'image'}
    preview = {k: project[k] for k in ('format', 'version', 'width', 'height')}
    preview['pages'] = [page]
    preview['assets'] = {k: v for k, v in project.get('assets', {}).items() if k in used}
    return JSONResponse({'project': preview}, headers={'Cache-Control': 'private, no-store'})


@desktop_router.get('/projects/{project_id}/preview')
def preview_own(project_id: str, owner=Depends(desktop_user)):
    return _preview(project_id, owner=owner)


@router.get('/projects/{project_id}/preview')
def preview_shared(project_id: str, user=Depends(public_user)):
    return _preview(project_id, user=user)


@desktop_router.get('/projects/{project_id}')
def get_own(project_id: str, owner=Depends(desktop_user)):
    return _get(project_id, owner=owner)


@router.get('/projects/{project_id}')
def get_shared(project_id: str, user=Depends(public_user)):
    return _get(project_id, user=user)


@router.get('/projects/{project_id}/status')
def shared_status(project_id: str, user=Depends(public_user)):
    return _get(project_id, user=user, status=True)


async def _save(project_id, request, owner=None, user=None):
    with _conn() as c:
        _project(c, project_id, owner, user, write=True)
    body, p, content = await _body(request)
    with _conn() as c:
        c.execute('BEGIN IMMEDIATE')
        row, role = _project(c, project_id, owner, user, write=True)
        # Equality including type: reject missing and stale revisions.
        if type(body.get('revision')) is not int or body['revision'] != row['revision']:
            raise HTTPException(409, 'projectConflict')
        c.execute('UPDATE design_projects SET name=?,width=?,height=?,body=?,revision=revision+1 WHERE id=?',
                  (p['name'], p['width'], p['height'], content, project_id))
        row, role = _project(c, project_id, owner, user)
    return JSONResponse(_meta(row, role), headers={'Cache-Control':'no-store'})


@desktop_router.put('/projects/{project_id}')
async def save_own(project_id: str, request: Request, owner=Depends(desktop_user)):
    return await _save(project_id, request, owner=owner)


@router.put('/projects/{project_id}')
async def save_shared(project_id: str, request: Request, user=Depends(public_user)):
    return await _save(project_id, request, user=user)


@desktop_router.get('/profiles')
def profiles(q: str = '', owner=Depends(desktop_user)):
    hub = _hub()
    users = hub.search_users(q[:100], limit=20) if hub else []
    return JSONResponse([{k:u[k] for k in ('id','username','display_name')} for u in users], headers={'Cache-Control':'no-store'})


@desktop_router.get('/projects/{project_id}/shares')
def shares(project_id: str, owner=Depends(desktop_user)):
    with _conn() as c:
        _project(c, project_id, owner=owner)
        rows = c.execute('SELECT user_id,role FROM design_shares WHERE project_id=?', (project_id,)).fetchall()
    users = {u['id']:u for u in _hub().get_users_by_ids([r['user_id'] for r in rows])} if _hub() else {}
    return JSONResponse([{'user_id':r['user_id'], 'role':r['role'],
        'name':users.get(r['user_id'],{}).get('display_name') or users.get(r['user_id'],{}).get('username') or r['user_id']} for r in rows], headers={'Cache-Control':'no-store'})


@desktop_router.put('/projects/{project_id}/shares/{user_id}')
async def set_share(project_id: str, user_id: str, request: Request, owner=Depends(desktop_user)):
    body = await request.json()
    role = body.get('role') if isinstance(body, dict) else None
    if role not in ('viewer','editor'):
        raise HTTPException(400, 'invalidRole')
    hub = _hub()
    if not hub or not hub.get_users_by_ids([user_id]):
        raise HTTPException(404, 'profileNotFound')
    with _conn() as c:
        c.execute('BEGIN IMMEDIATE')
        _project(c, project_id, owner=owner)
        c.execute('INSERT INTO design_shares(project_id,user_id,role) VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role', (project_id,user_id,role))
    return {'ok':True}


@desktop_router.delete('/projects/{project_id}/shares/{user_id}')
def revoke_share(project_id: str, user_id: str, owner=Depends(desktop_user)):
    with _conn() as c:
        c.execute('BEGIN IMMEDIATE')
        _project(c, project_id, owner=owner)
        c.execute('DELETE FROM design_shares WHERE project_id=? AND user_id=?', (project_id,user_id))
    return {'ok':True}

@desktop_router.get('/admin/settings')
async def ai_admin_settings(request: Request, session=Depends(current_session)):
    sys.modules['backend.auth'].ensure_admin(session,request)
    module=_ai_module()
    return {'premium':bool(module),**(module.get_settings() if module else
            {'assistant':False,'images':False,'public':False})}


@desktop_router.put('/admin/settings')
async def ai_save_settings(request: Request, session=Depends(current_session)):
    sys.modules['backend.auth'].ensure_admin(session,request)
    if request.headers.get('x-mvmdesign')!='1':
        raise HTTPException(403,'accessDenied')
    module=_ai_module()
    if not module:
        raise HTTPException(402,'aiPremium')
    body=await request.json()
    if not isinstance(body,dict) or any(k in body and type(body[k]) is not bool for k in ('assistant','images','public')):
        raise HTTPException(400,'invalidProject')
    module.save_settings(body)
    return {'ok':True}


# Premium entry points only; paid functionality and browser tools are shipped
# separately, under premium/. All policy is checked again on every request.
def _ai_module():
    premium = sys.modules.get('backend.premium')
    module = premium.load_premium_backend(APP_ID) if premium else None
    return module if module and module.is_available() else None


def _ai_profile(request, required=True):
    hub = _hub()
    user = hub.get_pub_session(request.headers.get('x-pub-token','')) if hub else None
    if required and not user:
        raise HTTPException(401,'loginRequired')
    return user


async def _ai_status(request, surface, user):
    import asyncio
    module = _ai_module()
    info = {'premium':bool(module),'enabled':bool(module and module.enabled(surface)),
            'images_enabled':bool(module and module.images_enabled(surface)),
            'ready':bool(module and module.ready()), 'signed_in':bool(user)}
    if module and user:
        info['credits'] = module.credits(user['id'])
        info['images'] = bool(info['images_enabled'] and await asyncio.to_thread(module.images_ready))
    return JSONResponse(info,headers={'Cache-Control':'private, no-store'})


@desktop_router.get('/ai/status')
async def desktop_ai_status(request: Request, owner=Depends(desktop_user)):
    return await _ai_status(request,'desktop',_ai_profile(request,False))


@router.get('/ai/status')
async def public_ai_status(request: Request, user=Depends(public_user)):
    return await _ai_status(request,'public',user)


async def _ai_script(surface):
    from fastapi.responses import Response
    module = _ai_module()
    if not module or not (module.enabled(surface) or module.images_enabled(surface)):
        raise HTTPException(404,'aiUnavailable')
    return Response(module.get_asset(),media_type='application/javascript',headers={'Cache-Control':'private, no-store'})


@desktop_router.get('/ai/assistant.js')
async def desktop_ai_script(request: Request, owner=Depends(desktop_user)):
    _ai_profile(request)
    return await _ai_script('desktop')


@router.get('/ai/assistant.js')
async def public_ai_script(user=Depends(public_user)):
    return await _ai_script('public')


async def _ai_call(request, surface, user, kind):
    module = _ai_module()
    if not module:
        raise HTTPException(402,'aiPremium')
    if not (module.enabled(surface) if kind=='chat' else module.images_enabled(surface)):
        raise HTTPException(403,'aiDisabled')
    raw=bytearray()
    async for part in request.stream():
        raw.extend(part)
        if len(raw)>2*1024*1024:
            raise HTTPException(413,'aiContextTooLarge')
    try:
        body=json.loads(raw)
        if not isinstance(body,dict):
            raise ValueError()
    except (ValueError,UnicodeDecodeError):
        raise HTTPException(400,'invalidProject')
    try:
        result=await getattr(module,kind)(user['id'],body,surface)
    except ValueError as exc:
        return JSONResponse({'error':str(exc) if str(exc) in ('invalidProject','aiContextTooLarge','aiInvalidActions','aiUnavailable') else 'aiInvalidActions'},status_code=400,headers={'Cache-Control':'no-store'})
    except Exception:
        return JSONResponse({'error':'aiUnavailable'},status_code=502,headers={'Cache-Control':'no-store'})
    if result.get('error'):
        status=402 if result['error']=='aiNoCredits' else 429 if result['error']=='aiBusy' else 502
    else:
        status=200
    result['credits']=module.credits(user['id'])
    return JSONResponse(result,status_code=status,headers={'Cache-Control':'private, no-store'})


@desktop_router.post('/ai/{kind}')
async def desktop_ai_call(kind: str, request: Request, owner=Depends(desktop_user)):
    if kind not in ('chat','image'):
        raise HTTPException(404)
    return await _ai_call(request,'desktop',_ai_profile(request),kind)


@router.post('/ai/{kind}')
async def public_ai_call(kind: str, request: Request, user=Depends(public_user)):
    if kind not in ('chat','image'):
        raise HTTPException(404)
    return await _ai_call(request,'public',user,kind)
