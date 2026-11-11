"""mvmPlayer: app-contained library, private viewer state and ticketed video.

Videos are uploaded here or stay in a library folder on the server, read as the
Linux user who added the folder. No transcoding or external server is required.
Media bytes are never placed in public/. Only desktop sessions manage files.
"""
import asyncio
import contextlib
import html
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import types
import uuid
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

APP_ID = 'mvmplayer'
ROOT = os.path.dirname(__file__)
DB = os.path.join(ROOT, 'data.db')
UPLOADS = os.path.join(ROOT, 'uploads')
CHUNK_SIZE = 8 * 1024 ** 2
MAX_FILE = 32 * 1024 ** 3
EXTENSIONS = {'.mp4':'video/mp4', '.m4v':'video/mp4', '.mov':'video/quicktime',
              '.webm':'video/webm', '.mkv':'video/x-matroska', '.ogv':'video/ogg', '.avi':'video/x-msvideo'}
router = APIRouter()


def desktop_session(request: Request):
    return sys.modules['backend.auth'].get_current_session(request)


desktop_router = APIRouter(dependencies=[Depends(desktop_session)])


def hub():
    return sys.modules['backend.apphub']


def me(x_pub_token: str = Header(default='')):
    user = hub().get_pub_session(x_pub_token)
    if not user:
        raise HTTPException(401, 'login')
    return user


def fail(code='notFound', status=404):
    raise HTTPException(status, code)


@contextlib.contextmanager
def db():
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    c.execute('PRAGMA journal_mode=WAL')
    try:
        with c:
            yield c
    finally:
        c.close()


def init():
    os.makedirs(UPLOADS, exist_ok=True)
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL,
          series TEXT NOT NULL DEFAULT '', season INTEGER NOT NULL DEFAULT 0,
          episode INTEGER NOT NULL DEFAULT 0, year TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL, original TEXT NOT NULL, mime TEXT NOT NULL,
          bytes INTEGER NOT NULL, created REAL NOT NULL, updated REAL NOT NULL,
          cover BLOB, cover_mime TEXT NOT NULL DEFAULT '', cover_revision TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', show_id INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS state (
          user_id TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          seconds REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0,
          speed REAL NOT NULL DEFAULT 1, completed INTEGER NOT NULL DEFAULT 0,
          favorite INTEGER NOT NULL DEFAULT 0, last_played REAL NOT NULL DEFAULT 0,
          PRIMARY KEY(user_id,media_id)
        );
        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS collection_items (
          collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE, position INTEGER NOT NULL,
          PRIMARY KEY(collection_id,media_id)
        );
        CREATE TABLE IF NOT EXISTS subtitles (
          id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          title TEXT NOT NULL, language TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sources (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, owner TEXT NOT NULL,
          auto INTEGER NOT NULL DEFAULT 0, last_scan REAL NOT NULL DEFAULT 0,
          scan_state TEXT NOT NULL DEFAULT '', scan_error TEXT NOT NULL DEFAULT '', created REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, expected INTEGER NOT NULL,
          received INTEGER NOT NULL DEFAULT 0, expires REAL NOT NULL, media_id TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS tickets (
          token TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL, pub_token TEXT NOT NULL, expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS series (
          name TEXT PRIMARY KEY, show_id INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT '', year TEXT NOT NULL DEFAULT '', rating REAL NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
          cover BLOB, cover_mime TEXT NOT NULL DEFAULT '', cover_revision TEXT NOT NULL DEFAULT '', updated REAL NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS limits (host TEXT PRIMARY KEY, next_request REAL NOT NULL);
        ''')
        # Files that stay in a library folder instead of being uploaded here.
        for table,column,spec in (('media','source_id',"TEXT NOT NULL DEFAULT ''"),('media','relpath',"TEXT NOT NULL DEFAULT ''"),
                                  ('media','missing','INTEGER NOT NULL DEFAULT 0'),('media','file_mtime','REAL NOT NULL DEFAULT 0'),('media','rating','REAL NOT NULL DEFAULT 0'),
                                  ('subtitles','path',"TEXT NOT NULL DEFAULT ''"),('subtitles','file_mtime','REAL NOT NULL DEFAULT 0'),('subtitles','origin',"TEXT NOT NULL DEFAULT ''")):
            if column not in [r[1] for r in c.execute('PRAGMA table_info(%s)'%table)]:
                c.execute('ALTER TABLE %s ADD COLUMN %s %s'%(table,column,spec))
        for column,spec in (('kind',"TEXT NOT NULL DEFAULT 'server'"),('folder_id',"TEXT NOT NULL DEFAULT ''")):
            if column not in [r[1] for r in c.execute('PRAGMA table_info(sources)')]:
                c.execute('ALTER TABLE sources ADD COLUMN %s %s'%(column,spec))
        c.execute("UPDATE sources SET scan_state='' WHERE scan_state='running'")


init()
helper_path = os.path.join(ROOT, 'catalogue.py')
catalogue = types.ModuleType('mvmplayer_catalogue')
catalogue.__file__ = helper_path
with open(helper_path, encoding='utf-8') as source:
    exec(compile(source.read(), helper_path, 'exec'), catalogue.__dict__)
catalogue.db = db
helper_path = os.path.join(ROOT, 'simkl.py')
simkl = types.ModuleType('mvmplayer_simkl')
simkl.__file__ = helper_path
with open(helper_path, encoding='utf-8') as source:
    exec(compile(source.read(), helper_path, 'exec'), simkl.__dict__)
simkl.db = db
simkl.resolver = lambda uid: hub().resolve_service_key(uid, 'simkl', APP_ID).get('key', '')
simkl.setup()


def media(c, mid):
    row = c.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()
    if not row:
        fail()
    return row


def premium():
    module = sys.modules.get('backend.premium')
    mod = module.load_premium_backend(APP_ID) if module else None
    return mod if mod and mod.is_available() else None


def mvmai_state():
    """Whether mvmAI is installed and its app-to-app API is switched on."""
    h = hub()
    try:
        installed = 'mvmai' in h._detect_app_apis()
        api = bool(installed and h.is_app_api_enabled('mvmai'))
    except Exception:
        installed = api = False
    return dict(installed=installed, api=api)


def translation_available():
    """What the viewers may use: module present, switched on by the administrator, mvmAI ready."""
    mod = premium()
    return bool(mod and mod.get_settings()['enabled'] and mvmai_state()['api'])


def language_codes():
    if hasattr(hub(), 'valid_languages'):
        return sorted(hub().valid_languages() - {'auto'})
    return ['bg','de','en','es','fr','ja','pt-BR','ru','zh-CN']


def present(c, row, uid):
    item = {k:row[k] for k in row.keys() if k not in ('cover','cover_mime','filename')}
    item['has_cover'] = row['cover'] is not None
    st = c.execute('SELECT * FROM state WHERE user_id=? AND media_id=?', (uid,row['id'])).fetchone()
    item['state'] = {k:st[k] for k in ('seconds','duration','speed','completed','favorite','last_played')} if st else dict(seconds=0,duration=0,speed=1,completed=False,favorite=False,last_played=0)
    state = item['state']
    item['percent'] = 100 if state['completed'] else round(min(100,100*state['seconds']/state['duration']),1) if state['duration'] else 0
    item['subtitles'] = [dict(r) for r in c.execute('SELECT id,title,language,origin FROM subtitles WHERE media_id=? ORDER BY title', (row['id'],))]
    return item


def library_for(uid):
    with db() as c:
        items = [present(c,r,uid) for r in c.execute('SELECT * FROM media WHERE missing=0 ORDER BY created DESC')]
        lists = []
        for row in c.execute('SELECT * FROM collections WHERE user_id=? ORDER BY title', (uid,)):
            entry = dict(row); entry.pop('user_id')
            entry['items'] = [r[0] for r in c.execute('SELECT media_id FROM collection_items WHERE collection_id=? ORDER BY position',(row['id'],))]
            lists.append(entry)
        shows = [dict(name=r['name'], show_id=r['show_id'], description=r['description'], category=r['category'], year=r['year'], rating=r['rating'],
                      source=r['source'], source_url=r['source_url'], has_cover=r['cover'] is not None, cover_revision=r['cover_revision'])
                 for r in c.execute('SELECT * FROM series')]
    return dict(items=items, collections=lists, series=shows, languages=language_codes(), translation=translation_available())


@router.get('/')
def index():
    if not hub().is_app_public(APP_ID):
        return hub().private_page('mvmPlayer','▶️')
    return FileResponse(os.path.join(ROOT,'public','index.html'))


@router.get('/library')
def library(user=Depends(me)):
    return {**library_for(user['id']), 'user_language':user.get('language','auto')}


@desktop_router.get('/translation')
def translation_settings():
    mod = premium()
    return dict(premium=bool(mod), enabled=bool(mod and mod.get_settings()['enabled']), mvmai=mvmai_state())


class TranslationBody(BaseModel):
    enabled: bool


@desktop_router.put('/translation')
def save_translation(body: TranslationBody):
    mod = premium()
    if not mod:fail('premiumRequired',402)
    if body.enabled and not mvmai_state()['api']:fail('mvmaiMissing',409)
    mod.save_settings(body.enabled)
    return dict(ok=True)


@desktop_router.get('/admin')
def admin():
    threading.Thread(target=enrich_known_series, daemon=True).start()
    return library_for('@management')


def clean_filename(filename):
    name = filename.replace('\\','/').strip()[:1000]
    parts = PurePosixPath(name).parts
    if not name or name.startswith('/') or '..' in parts or any(ord(ch)<32 for ch in name):
        fail('invalid',400)
    return name


def recognize(filename):
    path = PurePosixPath(filename)
    stem = path.stem
    match = re.search(r'(?i)(?:\b|[._ -])s(\d{1,2})[ ._-]*e(\d{1,3})(?:\b|[._ -])',stem)
    if not match:
        match = re.search(r'(?i)(?:\b|[._ -])(\d{1,2})x(\d{2,3})(?:\b|[._ -])',stem)
    clean = lambda value: re.sub(r'\s+',' ', re.sub(r'[._]+',' ',value)).strip(' -[]()')
    season_folder = next((re.search(r'(?i)^(?:season|saison|сезон|s)\s*(\d{1,2})$',clean(p)) for p in reversed(path.parts[:-1]) if re.search(r'(?i)^(?:season|saison|сезон|s)\s*(\d{1,2})$',clean(p))),None)
    if match:
        before = clean(stem[:match.start()]); folders=list(path.parts[:-1])
        while folders and re.match(r'(?i)^(?:season|saison|сезон|s)\s*\d+$',clean(folders[-1])):folders.pop()
        series = before or (clean(folders[-1]) if folders else '')
        after = clean(re.split(r'(?i)\b(?:480p|720p|1080p|2160p|webrip|web-dl|bluray|h264|x264|x265|hevc)\b',clean(stem[match.end():]))[0])
        return dict(kind='episode',title=after or clean(stem),series=series,season=int(match[1]),episode=int(match[2]),year='')
    if season_folder and len(path.parts)>=3:
        episode = re.search(r'(?i)^(?:e(?:pisode)?[ ._-]*)?(\d{1,3})(?:[ ._-]|$)',stem)
        if episode:
            return dict(kind='episode',title=clean(stem),series=clean(path.parts[-3]),season=int(season_folder[1]),episode=int(episode[1]),year='')
    title=clean(stem)
    year=re.search(r'(?:^|[\s([])((?:19|20)\d{2})(?:$|[\s)\]])',title)
    if year:
        name=title[:year.start()].strip(' -[(')
        if name:return dict(kind='movie',title=name,series='',season=0,episode=0,year=year[1])
    title=re.split(r'(?i)\b(?:480p|720p|1080p|2160p|webrip|web-dl|bluray|h264|x264|x265|hevc)\b',title)[0].strip(' -[(')
    return dict(kind='video',title=title or stem,series='',season=0,episode=0,year='')


class UploadBody(BaseModel):
    filename: str = Field(min_length=1,max_length=1000)
    bytes: int = Field(gt=0,le=MAX_FILE)


def expire_uploads(c):
    for row in c.execute('SELECT id,filename FROM uploads WHERE expires<? AND media_id=""',(time.time(),)).fetchall():
        with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,row['id']+'.part'))
        if not c.execute('SELECT 1 FROM media WHERE id=?',(row['id'],)).fetchone():
            with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,row['id']+os.path.splitext(row['filename'])[1].lower()))
    c.execute('DELETE FROM uploads WHERE expires<?',(time.time(),))


@desktop_router.post('/uploads')
def start_upload(body: UploadBody):
    filename=clean_filename(body.filename)
    if os.path.splitext(filename)[1].lower() not in EXTENSIONS:fail('unsupported',400)
    uid=uuid.uuid4().hex
    with db() as c:
        c.execute('BEGIN IMMEDIATE');expire_uploads(c)
        if c.execute('SELECT COUNT(*) FROM uploads WHERE media_id=""').fetchone()[0]>=200:fail('uploadBusy',429)
        c.execute('INSERT INTO uploads(id,filename,expected,expires) VALUES(?,?,?,?)',(uid,filename,body.bytes,time.time()+86400))
    return dict(id=uid,chunk_size=CHUNK_SIZE)


def upload(c, uid):
    row=c.execute('SELECT * FROM uploads WHERE id=? AND expires>?',(uid,time.time())).fetchone()
    if not row:fail('uploadExpired',410)
    return row


@desktop_router.get('/uploads/{uid}')
def upload_status(uid: str):
    with db() as c:
        row=upload(c,uid)
        return dict(received=row['received'],id=row['media_id'],bytes=row['expected'])


async def bounded_body(request, limit):
    data=bytearray()
    async for part in request.stream():
        if len(data)+len(part)>limit:fail('tooLarge',413)
        data.extend(part)
    if not data:fail('invalid',400)
    return bytes(data)


@desktop_router.put('/uploads/{uid}')
async def append_upload(uid: str, request: Request, offset: int):
    data=await bounded_body(request,CHUNK_SIZE)
    with db() as c:
        c.execute('BEGIN IMMEDIATE');row=upload(c,uid)
        if row['media_id']:return dict(received=row['received'])
        if offset<0 or offset+len(data)>row['expected']:fail('uploadOffset',409)
        path=os.path.join(UPLOADS,uid+'.part')
        if offset<row['received']:
            if offset+len(data)>row['received']:fail('uploadOffset',409)
            with open(path,'rb') as f:
                f.seek(offset)
                if f.read(len(data))!=data:fail('uploadOffset',409)
            return dict(received=row['received'])
        if offset!=row['received']:fail('uploadOffset',409)
        with open(path,'r+b' if os.path.exists(path) else 'xb') as f:
            f.seek(offset);f.truncate(offset);f.write(data);f.flush()
        c.execute('UPDATE uploads SET received=?,expires=? WHERE id=?',(offset+len(data),time.time()+86400,uid))
    return dict(received=offset+len(data))


def validate_video(path):
    with open(path,'rb') as f:head=f.read(64)
    if not (head[4:8] in (b'ftyp',b'moov',b'mdat',b'wide',b'free') or head.startswith(b'\x1aE\xdf\xa3') or head.startswith(b'OggS') or head.startswith(b'RIFF') and head[8:12]==b'AVI '):
        fail('invalidVideo',400)


@desktop_router.post('/uploads/{uid}/finish')
def finish_upload(uid: str):
    with db() as c:
        c.execute('BEGIN IMMEDIATE');row=upload(c,uid)
        if row['media_id']:return dict(id=row['media_id'])
        path=os.path.join(UPLOADS,uid+'.part')
        ext=os.path.splitext(row['filename'])[1].lower()
        filename=uid+ext;target=os.path.join(UPLOADS,filename)
        # Recover a worker exit between the rename and SQLite's commit.
        if not os.path.isfile(path) and os.path.isfile(target):path=target
        if row['received']!=row['expected'] or not os.path.isfile(path) or os.path.getsize(path)!=row['expected']:fail('uploadOffset',409)
        validate_video(path)
        info=recognize(row['filename'])
        # The random identifier is stable across retries and title/metadata edits.
        if path!=target:os.replace(path,target)
        try:
            c.execute('INSERT INTO media(id,kind,title,series,season,episode,year,filename,original,mime,bytes,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (uid,*[info[k] for k in ('kind','title','series','season','episode','year')],filename,row['filename'],EXTENSIONS[ext],row['expected'],time.time(),time.time()))
            c.execute('UPDATE uploads SET media_id=? WHERE id=?',(uid,uid))
        except Exception:
            if path!=target:os.replace(target,path)
            raise
    return dict(id=uid)


@desktop_router.delete('/uploads/{uid}')
def cancel_upload(uid: str):
    with db() as c:
        row=upload(c,uid)
        if not row['media_id']:
            with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,uid+'.part'))
            if not c.execute('SELECT 1 FROM media WHERE id=?',(uid,)).fetchone():
                with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,uid+os.path.splitext(row['filename'])[1].lower()))
        c.execute('DELETE FROM uploads WHERE id=?',(uid,))
    return dict(ok=True)


class MediaBody(BaseModel):
    kind: str
    title: str = Field(min_length=1,max_length=250)
    series: str = Field(default='',max_length=250)
    season: int = Field(default=0,ge=0,le=999)
    episode: int = Field(default=0,ge=0,le=9999)
    year: str = Field(default='',max_length=10)
    category: str = Field(default='',max_length=250)
    description: str = Field(default='',max_length=10000)


@desktop_router.put('/media/{mid}')
def edit_media(mid: str, body: MediaBody):
    d=body.model_dump();d={k:v.strip() if isinstance(v,str) else v for k,v in d.items()}
    if d['kind'] not in ('video','movie','episode') or not d['title']:fail('invalid',400)
    if d['kind']=='episode' and not d['series']:fail('seriesRequired',400)
    with db() as c:
        media(c,mid)
        c.execute('UPDATE media SET '+','.join(k+'=?' for k in d)+',updated=? WHERE id=?',(*d.values(),time.time(),mid))
    return dict(ok=True)


@desktop_router.delete('/media/{mid}')
def delete_media(mid: str):
    with db() as c:
        row=media(c,mid);filename=row['filename']
        if row['source_id']:fail('sourceMedia',409)
        c.execute('DELETE FROM uploads WHERE media_id=?',(mid,))
        c.execute('DELETE FROM media WHERE id=?',(mid,))
    with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,filename))
    stem=os.path.splitext(filename)[0]
    for code in language_codes():
        with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,stem+'.'+code+'.srt'))
    return dict(ok=True)


class StateBody(BaseModel):
    seconds: float | None = Field(default=None,ge=0,le=1e8,allow_inf_nan=False)
    duration: float | None = Field(default=None,gt=0,le=1e8,allow_inf_nan=False)
    speed: float | None = Field(default=None,ge=0.25,le=3,allow_inf_nan=False)
    completed: bool | None = None
    favorite: bool | None = None
    played: bool = False


@router.put('/media/{mid}/state')
def save_state(mid: str, body: StateBody, user=Depends(me)):
    with db() as c:
        media(c,mid);uid=user['id']
        c.execute('INSERT OR IGNORE INTO state(user_id,media_id) VALUES(?,?)',(uid,mid))
        row=c.execute('SELECT * FROM state WHERE user_id=? AND media_id=?',(uid,mid)).fetchone()
        d=body.model_dump(exclude_none=True);d.pop('played')
        if body.seconds is not None:
            duration=body.duration or row['duration']
            d['seconds']=min(body.seconds,duration) if duration else body.seconds
        if body.played:d['last_played']=time.time()
        if d:c.execute('UPDATE state SET '+','.join(k+'=?' for k in d)+' WHERE user_id=? AND media_id=?',(*d.values(),uid,mid))
        finished=bool(body.completed and not row['completed']);item=dict(media(c,mid)) if finished else None
    if finished:simkl.send_later(user,item)
    return dict(ok=True)


# ── Simkl: the key comes from Apps Hub, every person connects their own account ──

def simkl_creds(user=Depends(me)):
    creds=simkl.credentials(user['id'])
    if not creds:fail('simklOff',403)
    return creds


@router.get('/simkl')
def simkl_status(user=Depends(me)):
    creds=simkl.credentials(user['id'])
    return dict(enabled=bool(creds),history=bool(creds and creds['token']))


@router.post('/simkl/pin')
def simkl_pin(user=Depends(me), creds=Depends(simkl_creds)):
    return simkl.pin_start(creds['client_id'])


@router.get('/simkl/pin/{code}')
def simkl_pin_check(code: str, user=Depends(me), creds=Depends(simkl_creds)):
    if not re.fullmatch(r'[A-Za-z0-9]{16,128}',code):fail('invalid',400)
    token=simkl.pin_check(creds['client_id'],code)
    if token:simkl.save_token(user['id'],token,creds['client_id'])
    return dict(connected=bool(token))


@router.delete('/simkl/connection')
def simkl_disconnect(user=Depends(me)):
    simkl.disconnect(user['id'])
    return dict(ok=True)


@router.get('/simkl/trending')
def simkl_trending(kind: str = 'movies', creds=Depends(simkl_creds)):
    if kind not in ('movies','tv'):fail('invalid',400)
    return dict(items=simkl.trending(creds,kind))


@router.get('/simkl/history')
def simkl_history(user=Depends(me), creds=Depends(simkl_creds)):
    with db() as c:rows=[dict(r) for r in c.execute('SELECT id,kind,title,series,year FROM media WHERE missing=0')]
    return simkl.match_library(rows,simkl.history(creds))


class SimklWatchedBody(BaseModel):
    watched: bool
    season: int | None = Field(default=None, ge=0, le=500)
    episode: int | None = Field(default=None, ge=1, le=20000)


class SimklPlanBody(BaseModel):
    on: bool


def simkl_show(creds, sid):
    data = simkl.show_for(creds, sid)
    with db() as c:
        rows = c.execute("SELECT id,series,season,episode FROM media WHERE kind='episode' AND missing=0").fetchall()
    name = simkl.norm(data['show']['title'])
    files = {(r['season'], r['episode']): r['id'] for r in rows if simkl.norm(r['series']) == name}
    for season in data['seasons']:
        for e in season['episodes']:
            e['library_id'] = files.get((season['number'], e['number']), '')
    return data


@router.get('/simkl/show/{sid}')
def simkl_show_get(sid: int, user=Depends(me), creds=Depends(simkl_creds)):
    return simkl_show(creds, sid)


@router.post('/simkl/show/{sid}/watched')
def simkl_show_watched(sid: int, body: SimklWatchedBody, user=Depends(me), creds=Depends(simkl_creds)):
    """One episode, a whole season (season only) or the whole series (neither)."""
    info = simkl.show_info(creds, sid)
    wanted = [[s['number'], e['number']] for s in info['seasons'] for e in s['episodes']
              if (body.season is None or s['number'] == body.season) and (body.episode is None or e['number'] == body.episode)
              and (e['aired'] or not body.watched)]
    if not wanted:fail('simklNotFound',404)
    simkl.mark(creds, sid, wanted, body.watched)
    return simkl_show(creds, sid)


@router.post('/simkl/show/{sid}/plan')
def simkl_show_plan(sid: int, body: SimklPlanBody, user=Depends(me), creds=Depends(simkl_creds)):
    current = simkl.show_for(creds, sid)
    if body.on:
        if current['tracked']:fail('invalid',400)
    elif not (current['status'] == 'plantowatch' and not current['watched']):
        fail('invalid',400)  # never remove a series that has watched episodes
    simkl.set_plan(creds, sid, body.on)
    return simkl_show(creds, sid)


@router.get('/simkl/info/{mid}')
def simkl_info(mid: str, user=Depends(me), creds=Depends(simkl_creds)):
    with db() as c:row=dict(media(c,mid))
    return dict(info=simkl.details(creds,row))


@router.post('/media/{mid}/ticket')
def ticket(mid: str, user=Depends(me), x_pub_token: str = Header(default='')):
    with db() as c:
        row=media(c,mid)
        src=c.execute('SELECT * FROM sources WHERE id=?',(row['source_id'],)).fetchone() if row['source_id'] else None
        if src and src['kind']=='shared':
            # Played straight from the sharing server; nothing passes through here.
            if row['missing']:fail('fileMissing',404)
            path='/'.join(x for x in (src['path'],row['relpath']) if x)
            return dict(url=fp().shared_file_url(src['owner'],src['folder_id'],path,ttl=6*3600),ticket='')
        token=secrets.token_urlsafe(32)
        c.execute('DELETE FROM tickets WHERE expires<?',(time.time(),))
        c.execute('INSERT INTO tickets VALUES(?,?,?,?,?)',(token,mid,user['id'],x_pub_token,time.time()+86400))
    return dict(url=f'/pub/{APP_ID}/stream/{mid}?ticket={token}',ticket=token)


def grant(c, mid, token):
    row=c.execute('SELECT * FROM tickets WHERE token=? AND media_id=? AND expires>?',(token,mid,time.time())).fetchone()
    user=hub().get_pub_session(row['pub_token']) if row else None
    if not row or not user or user['id']!=row['user_id']:fail('login',401)
    return media(c,mid)


def video_response(row, request=None):
    if row['source_id']:return source_response(row,request)
    path=os.path.join(UPLOADS,row['filename'])
    if not os.path.isfile(path):fail('fileMissing',404)
    return FileResponse(path,media_type=row['mime'],headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'})


def source_file(row):
    """Open a library file as the Linux user who added its folder; the folder is checked again."""
    with db() as c:
        src=c.execute('SELECT * FROM sources WHERE id=?',(row['source_id'],)).fetchone()
    if not src or src['kind']!='server' or row['missing'] or os.path.splitext(row['relpath'])[1].lower() not in EXTENSIONS:fail('fileMissing',404)
    f,size=fp().open_server_file(src['owner'],src['path'],row['relpath'])
    return f,size,src


def source_response(row, request):
    f,size,_src=source_file(row)
    return ranged_response(f,size,row['mime'],request)


def ranged_response(f, size, mime, request):
    """Stream an opened file with byte ranges; ``f`` is closed here."""
    start,end,status=0,size-1,200
    spec=request.headers.get('range','').strip() if request else ''
    if spec:
        m=re.fullmatch(r'bytes=(\d*)-(\d*)',spec)
        if not m or (not m[1] and not m[2]):
            f.close();raise HTTPException(416,'range',headers={'Content-Range':'bytes */%d'%size})
        if m[1]:
            start=int(m[1]);end=min(int(m[2]),size-1) if m[2] else size-1
        else:
            start=max(0,size-int(m[2]))
        if start>=size or start>end:
            f.close();raise HTTPException(416,'range',headers={'Content-Range':'bytes */%d'%size})
        status=206
    length=end-start+1
    headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
             'Accept-Ranges':'bytes','Content-Length':str(length)}
    if status==206:headers['Content-Range']='bytes %d-%d/%d'%(start,end,size)
    if request and request.method=='HEAD':
        f.close();return Response(status_code=status,headers=headers,media_type=mime)
    def body():
        try:
            f.seek(start);left=length
            while left>0:
                part=f.read(min(1024*1024,left))
                if not part:break
                left-=len(part);yield part
        finally:f.close()
    return StreamingResponse(body(),status_code=status,headers=headers,media_type=mime)


@router.get('/stream/{mid}')
@router.head('/stream/{mid}')
def stream(mid: str, request: Request, ticket: str = ''):
    with db() as c:return video_response(grant(c,mid,ticket),request)


@desktop_router.get('/file')
@desktop_router.head('/file')
def open_file(path: str, request: Request, session=Depends(desktop_session)):
    """A single video of this server opened from the file manager, read as the signed-in Linux user."""
    real=fp().resolve_server_path(session,path,roots=['/'],kind='file',extensions=list(EXTENSIONS))
    f,size=fp().open_server_file(session['effective_user'],os.path.dirname(real),os.path.basename(real))
    return ranged_response(f,size,EXTENSIONS[os.path.splitext(real)[1].lower()],request)


@desktop_router.get('/stream/{mid}')
@desktop_router.head('/stream/{mid}')
def admin_stream(mid: str, request: Request):
    with db() as c:return video_response(media(c,mid),request)


def valid_image(data):
    # Never serve user-provided SVG/HTML as an image.
    if data.startswith(b'\x89PNG\r\n\x1a\n') and b'IEND' in data[-16:]:return 'image/png'
    if data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9'):return 'image/jpeg'
    if data.startswith(b'RIFF') and data[8:12]==b'WEBP':return 'image/webp'
    fail('invalidCover',400)


@desktop_router.put('/media/{mid}/cover')
async def put_cover(mid: str, request: Request):
    data=await bounded_body(request,3*1024**2);mime=valid_image(data)
    with db() as c:
        media(c,mid);c.execute('UPDATE media SET cover=?,cover_mime=?,cover_revision=? WHERE id=?',(data,mime,uuid.uuid4().hex,mid))
    return dict(ok=True)


@desktop_router.delete('/media/{mid}/cover')
def remove_cover(mid: str):
    with db() as c:
        media(c,mid);c.execute('UPDATE media SET cover=NULL,cover_mime="",cover_revision="" WHERE id=?',(mid,))
    return dict(ok=True)


def cover_response(mid):
    with db() as c:
        row=media(c,mid)
        if row['cover'] is None:fail()
        return Response(bytes(row['cover']),media_type=row['cover_mime'],headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})


@router.get('/media/{mid}/cover')
def cover(mid: str, user=Depends(me)):
    return cover_response(mid)


@desktop_router.get('/media/{mid}/cover')
def admin_cover(mid: str):
    return cover_response(mid)


def to_vtt(data):
    # Strip cue markup, including script/URL-bearing tags and cue settings.
    # Retain only timed text; this same safe subset handles SRT and WebVTT.
    text=None
    encodings=('utf-16',) if data.startswith((b'\xff\xfe',b'\xfe\xff')) else ('utf-8-sig','cp1251')
    for encoding in encodings:
        try:text=data.decode(encoding);break
        except UnicodeError:pass
    if text is None or '\x00' in text:fail('invalidSubtitle',400)
    text=text.replace('\r\n','\n').replace('\r','\n')
    timing=re.compile(r'^\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})(?:[ \t].*)?$')
    output=['WEBVTT',''];count=0
    for block in re.split(r'\n[ \t]*\n',text):
        lines=block.split('\n');idx=next((i for i,line in enumerate(lines[:2]) if timing.match(line)),None)
        if idx is None:continue
        m=timing.match(lines[idx]);body='\n'.join(lines[idx+1:]).strip()
        body=html.unescape(re.sub(r'<[^>]*>','',body))
        body=body.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;').replace('-->','—›')
        if body:
            output.extend([m[1].replace(',','.')+' --> '+m[2].replace(',','.'),body,'']);count+=1
    if not count:fail('invalidSubtitle',400)
    return '\n'.join(output)


@desktop_router.post('/media/{mid}/subtitles')
async def add_subtitle(mid: str, request: Request, title: str = '', language: str = 'en'):
    if language not in language_codes():fail('invalid',400)
    data=await bounded_body(request,5*1024**2);text=to_vtt(data);sid=uuid.uuid4().hex
    with db() as c:
        media(c,mid);c.execute('INSERT INTO subtitles(id,media_id,title,language,data) VALUES(?,?,?,?,?)',(sid,mid,title.strip()[:200] or language,language,text))
    return dict(id=sid)


@desktop_router.delete('/media/{mid}/subtitles/{sid}')
def delete_subtitle(mid: str, sid: str):
    with db() as c:
        media(c,mid);c.execute('DELETE FROM subtitles WHERE id=? AND media_id=?',(sid,mid))
    return dict(ok=True)


@router.get('/media/{mid}/subtitles/{sid}')
def subtitle(mid: str, sid: str, user=Depends(me)):
    with db() as c:
        media(c,mid);row=c.execute('SELECT data FROM subtitles WHERE id=? AND media_id=?',(sid,mid)).fetchone()
        if not row:fail()
        return Response(row['data'],media_type='text/vtt',headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})


@desktop_router.get('/media/{mid}/subtitles/{sid}')
def admin_subtitle(mid: str, sid: str):
    return subtitle(mid,sid,user={})


class CollectionBody(BaseModel):
    title: str = Field(min_length=1,max_length=200)
    items: list[str] = Field(default_factory=list,max_length=5000)


@router.post('/collections')
@router.put('/collections/{pid}')
def save_collection(body: CollectionBody, pid: str = '', user=Depends(me)):
    if not body.title.strip() or len(set(body.items))!=len(body.items):fail('invalid',400)
    with db() as c:
        if pid and not c.execute('SELECT 1 FROM collections WHERE id=? AND user_id=?',(pid,user['id'])).fetchone():fail()
        for mid in body.items:media(c,mid)
        pid=pid or uuid.uuid4().hex
        c.execute('INSERT INTO collections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title',(pid,user['id'],body.title.strip()))
        c.execute('DELETE FROM collection_items WHERE collection_id=?',(pid,))
        c.executemany('INSERT INTO collection_items VALUES(?,?,?)',[(pid,mid,n) for n,mid in enumerate(body.items)])
    return dict(id=pid)


@router.delete('/collections/{pid}')
def delete_collection(pid: str, user=Depends(me)):
    with db() as c:
        if not c.execute('SELECT 1 FROM collections WHERE id=? AND user_id=?',(pid,user['id'])).fetchone():fail()
        c.execute('DELETE FROM collections WHERE id=?',(pid,))
    return dict(ok=True)


class SearchBody(BaseModel):
    query: str = Field(min_length=1,max_length=250)
    language: str = 'en'


@desktop_router.post('/media/{mid}/lookup')
async def lookup(mid: str, body: SearchBody):
    if body.language not in language_codes() or not body.query.strip():fail('invalid',400)
    with db() as c:row=dict(media(c,mid))
    return dict(results=await catalogue.search(row,body.query.strip(),body.language))


class ApplyBody(BaseModel):
    candidate: str = Field(max_length=100)
    fields: list[str] = Field(max_length=9)
    series_group: bool = False


@desktop_router.post('/media/{mid}/lookup/apply')
async def apply_metadata(mid: str, body: ApplyBody):
    candidate=catalogue.cached('candidate:'+body.candidate)
    allowed={'title','description','category','year','cover','series','episode_title','episode_description'}
    if not candidate or not body.fields or set(body.fields)-allowed:fail('invalid',400)
    episode_fields=set(body.fields)&{'episode_title','episode_description'}
    with db() as c:original=dict(media(c,mid))
    exact=candidate.get('episode') or {}
    episode_data={}
    if episode_fields:
        if original['kind']!='episode' or exact.get('status')!='found' or (exact.get('season'),exact.get('number'))!=(original['season'],original['episode']):fail('invalid',400)
        episode_data[(original['season'],original['episode'])]=exact
        if body.series_group:
            remote=await catalogue.show(candidate['show_id'])
            episode_data.update({(e['season'],e['number']):e for e in remote['episodes'] if e.get('number') is not None})
    cover=None
    if 'cover' in body.fields and candidate.get('cover'):
        try:
            cover=await catalogue.fetch(candidate['cover'],image=True)
            if cover:valid_image(cover)
        except HTTPException:
            # Artwork is optional: retain the existing cover and save selected
            # text fields even when the image provider is temporarily down.
            cover=None
    with db() as c:
        row=media(c,mid);group=[mid]
        if episode_fields and any(row[k]!=original[k] for k in ('kind','series','season','episode')):fail('invalid',409)
        if body.series_group and row['kind']=='episode' and row['series']:
            group=[r[0] for r in c.execute('SELECT id FROM media WHERE kind=? AND series=?',('episode',row['series']))]
        for target in group:
            target_row=media(c,target)
            values={k:candidate[k] for k in body.fields if k in candidate and k not in ('cover','series')}
            if row['kind']=='episode':
                values.pop('title',None)
                if 'series' in body.fields:values['series']=candidate['title']
                if candidate.get('show_id'):values['show_id']=candidate['show_id']
                episode=episode_data.get((target_row['season'],target_row['episode']),{})
                if 'episode_title' in episode_fields and episode.get('title'):values['title']=episode['title']
                if 'episode_description' in episode_fields and episode.get('description'):values['description']=episode['description']
            values.update(source=candidate['source'],source_url=candidate['url'],rating=float(candidate.get('rating') or 0),updated=time.time())
            if cover:values.update(cover=cover,cover_mime=valid_image(cover),cover_revision=uuid.uuid4().hex)
            c.execute('UPDATE media SET '+','.join(k+'=?' for k in values)+' WHERE id=?',(*values.values(),target))
    return dict(ok=True,cover_missing='cover' in body.fields and not cover)


@router.get('/series/{mid}')
async def series_info(mid: str, user=Depends(me)):
    with db() as c:
        row=media(c,mid)
        show_id=row['show_id'] or (c.execute('SELECT show_id FROM series WHERE name=?',(row['series'],)).fetchone() or [0])[0]
    return await catalogue.show(show_id) if show_id else dict(seasons=[],episodes=[])


def series_cover_response(name):
    with db() as c:
        row=c.execute('SELECT cover,cover_mime FROM series WHERE name=?',(name,)).fetchone()
    if not row or row['cover'] is None:fail()
    return Response(bytes(row['cover']),media_type=row['cover_mime'],headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})


@router.get('/series-cover')
def series_cover(name: str = Query(max_length=250), user=Depends(me)):
    return series_cover_response(name)


@desktop_router.get('/series-cover')
def admin_series_cover(name: str = Query(max_length=250)):
    return series_cover_response(name)


@desktop_router.post('/series/lookup')
async def series_lookup(body: SearchBody):
    if body.language not in language_codes() or not body.query.strip():fail('invalid',400)
    return dict(results=await catalogue.search(dict(kind='episode',season=0,episode=0),body.query.strip(),body.language))


class SeriesRemoteBody(BaseModel):
    candidate: str = Field(max_length=100)


@desktop_router.post('/series/remote')
async def series_remote(body: SeriesRemoteBody):
    candidate=catalogue.cached('candidate:'+body.candidate)
    if not candidate or not candidate.get('show_id'):fail('invalid',400)
    return await catalogue.show(candidate['show_id'])


class SeriesApplyBody(BaseModel):
    name: str = Field(min_length=1,max_length=250)
    candidate: str = Field(max_length=100)
    fields: list[str] = Field(default=[],max_length=4)
    episodes: list[str] = Field(default=[],max_length=5000)
    episode_fields: list[str] = Field(default=[],max_length=2)


@desktop_router.post('/series/apply')
async def series_apply(body: SeriesApplyBody):
    candidate=catalogue.cached('candidate:'+body.candidate)
    if not candidate or not candidate.get('show_id') or set(body.fields)-{'description','category','year','cover'} or set(body.episode_fields)-{'title','description'}:fail('invalid',400)
    if not body.fields and not (body.episodes and body.episode_fields):fail('invalid',400)
    remote=await catalogue.show(candidate['show_id']) if body.episodes and body.episode_fields else dict(episodes=[])
    remote_episodes={(e['season'],e['number']):e for e in remote['episodes'] if e.get('number') is not None}
    cover=None
    if 'cover' in body.fields and candidate.get('cover'):
        try:
            cover=await catalogue.fetch(candidate['cover'],image=True)
            if cover:valid_image(cover)
        except HTTPException:
            cover=None
    updated=missing=0
    with db() as c:
        if not c.execute('SELECT 1 FROM media WHERE kind=? AND series=?',('episode',body.name)).fetchone():fail()
        c.execute('INSERT OR IGNORE INTO series(name) VALUES(?)',(body.name,))
        values=dict(show_id=candidate['show_id'],rating=float(candidate.get('rating') or 0),source=candidate['source'],source_url=candidate['url'],updated=time.time())
        values.update({k:candidate[k] for k in body.fields if k in ('description','category','year') and k in candidate})
        if cover:values.update(cover=cover,cover_mime=valid_image(cover),cover_revision=uuid.uuid4().hex)
        c.execute('UPDATE series SET '+','.join(k+'=?' for k in values)+' WHERE name=?',(*values.values(),body.name))
        c.execute('UPDATE media SET show_id=? WHERE kind=? AND series=?',(candidate['show_id'],'episode',body.name))
        for mid in body.episodes:
            row=c.execute('SELECT * FROM media WHERE id=? AND kind=? AND series=?',(mid,'episode',body.name)).fetchone()
            if not row:continue
            found=remote_episodes.get((row['season'],row['episode']))
            changes={}
            if found:
                if 'title' in body.episode_fields and found.get('title'):changes['title']=found['title'][:250]
                if 'description' in body.episode_fields and found.get('description'):changes['description']=found['description']
            if changes:
                c.execute('UPDATE media SET '+','.join(k+'=?' for k in changes)+',source=?,source_url=?,updated=? WHERE id=?',(*changes.values(),candidate['source'],candidate['url'],time.time(),mid));updated+=1
            else:missing+=1
    return dict(ok=True,updated=updated,missing=missing,cover_missing='cover' in body.fields and not cover)


@desktop_router.get('/series/{mid}')
async def admin_series_info(mid: str):
    return await series_info(mid,user={})


# ── Library folders: videos stay where they are ─────────────────────

def fp():
    import importlib
    return sys.modules.get('backend.filepicker') or importlib.import_module('backend.filepicker')


SUBTITLE_EXTENSIONS = {'.srt', '.vtt'}
LANGUAGE3 = {'eng':'en','bul':'bg','ger':'de','deu':'de','spa':'es','fre':'fr','fra':'fr','jpn':'ja','por':'pt','rus':'ru','chi':'zh','zho':'zh'}
_scanning = set()
_scan_lock = threading.Lock()


def sidecar_info(video_rel, sub_rel):
    """Language and title of ``Movie.bg.srt`` beside ``Movie.mkv``, or None when it belongs to another file."""
    vstem = os.path.splitext(os.path.basename(video_rel))[0]
    sname = os.path.splitext(os.path.basename(sub_rel))[0]
    if os.path.dirname(video_rel) != os.path.dirname(sub_rel) or not (sname == vstem or sname.startswith(vstem + '.')):
        return None
    rest = sname[len(vstem):].lstrip('.')
    first = rest.split('.')[0].lower() if rest else ''
    code = LANGUAGE3.get(first, first) if re.fullmatch(r'[a-z]{2,3}(-[a-z]{2,4})?', first) else ''
    if code == 'pt-br':code = 'pt-BR'
    if code == 'zh-cn':code = 'zh-CN'
    return dict(language=code or 'und', title=rest or 'Subtitles')


def scan_source(sid):
    with _scan_lock:
        if sid in _scanning:return
        _scanning.add(sid)
    try:
        with db() as c:
            src = c.execute('SELECT * FROM sources WHERE id=?', (sid,)).fetchone()
            if not src:return
            c.execute("UPDATE sources SET scan_state='running',scan_error='' WHERE id=?", (sid,))
        try:
            wanted = set(EXTENSIONS) | SUBTITLE_EXTENSIONS
            files = (fp().shared_folder_files(src['owner'], src['folder_id'], src['path'], wanted) if src['kind'] == 'shared'
                     else fp().folder_files(src['owner'], src['path'], wanted))
            videos = sorted((f for f in files if os.path.splitext(f['rel'])[1].lower() in EXTENSIONS), key=lambda f: f['rel'])
            subs = [f for f in files if os.path.splitext(f['rel'])[1].lower() in SUBTITLE_EXTENSIONS]
            now = time.time()
            with db() as c:
                known = {r['relpath']:r['id'] for r in c.execute('SELECT id,relpath FROM media WHERE source_id=?', (sid,))}
                for f in videos:
                    ext = os.path.splitext(f['rel'])[1].lower()
                    if f['rel'] in known:
                        c.execute('UPDATE media SET bytes=?,file_mtime=?,missing=0 WHERE id=?', (f['size'], f['mtime'], known[f['rel']]))
                    else:
                        info = recognize(f['rel'])
                        mid = uuid.uuid4().hex
                        c.execute('INSERT INTO media(id,kind,title,series,season,episode,year,filename,original,mime,bytes,created,updated,source_id,relpath,file_mtime)'
                                  ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                                  (mid, *[info[k] for k in ('kind','title','series','season','episode','year')], '', os.path.basename(f['rel']),
                                   EXTENSIONS[ext], f['size'], now, now, sid, f['rel'], f['mtime']))
                        known[f['rel']] = mid
                present = {f['rel'] for f in videos}
                for rel, mid in known.items():
                    if rel not in present:c.execute('DELETE FROM media WHERE id=?', (mid,))
            # Subtitle files beside the videos.
            seen = set()
            for f in subs:
                for rel, mid in known.items():
                    if rel not in present:continue
                    info = sidecar_info(rel, f['rel'])
                    if not info:continue
                    seen.add(f['rel'])
                    with db() as c:
                        have = c.execute('SELECT id,file_mtime FROM subtitles WHERE media_id=? AND path=?', (mid, f['rel'])).fetchone()
                    if have and have['file_mtime'] == f['mtime']:continue
                    try:
                        if src['kind'] == 'shared':
                            data = fp().shared_read_head(src['owner'], src['folder_id'], '/'.join(x for x in (src['path'], f['rel']) if x))
                        else:
                            handle, size = fp().open_server_file(src['owner'], src['path'], f['rel'])
                            with handle:data = handle.read(5 * 1024 ** 2)
                        text = to_vtt(data)
                    except HTTPException:
                        continue
                    with db() as c:
                        if have:c.execute('UPDATE subtitles SET data=?,file_mtime=? WHERE id=?', (text, f['mtime'], have['id']))
                        else:c.execute('INSERT INTO subtitles(id,media_id,title,language,data,path,file_mtime) VALUES(?,?,?,?,?,?,?)',
                                       (uuid.uuid4().hex, mid, info['title'][:200], info['language'], text, f['rel'], f['mtime']))
            with db() as c:
                for r in c.execute("SELECT s.id,s.path FROM subtitles s JOIN media m ON m.id=s.media_id WHERE m.source_id=? AND s.path!=''", (sid,)).fetchall():
                    if r['path'] not in seen:c.execute('DELETE FROM subtitles WHERE id=?', (r['id'],))
                c.execute("UPDATE sources SET scan_state='done',last_scan=?,scan_error='' WHERE id=?", (time.time(), sid))
        except HTTPException as e:
            with db() as c:c.execute("UPDATE sources SET scan_state='failed',scan_error=? WHERE id=?", (str(e.detail)[:200], sid))
        except Exception as e:
            with db() as c:c.execute("UPDATE sources SET scan_state='failed',scan_error=? WHERE id=?", (type(e).__name__, sid))
        enrich_known_series()
    finally:
        _scanning.discard(sid)


_enrich_lock = threading.Lock()


def enrich_known_series():
    """New episodes of a series that was already identified get their title and description by themselves.

    Only a series the owner has identified once (it has a catalogue id in ``series``) is touched, and only
    episodes that still have no description; a series never searched for stays as it is until then.
    """
    if not _enrich_lock.acquire(blocking=False):return
    try:
        with db() as c:
            known = [(r['name'], r['show_id']) for r in c.execute(
                "SELECT s.name,s.show_id FROM series s WHERE s.show_id>0 AND EXISTS("
                "SELECT 1 FROM media m WHERE m.kind='episode' AND m.series=s.name AND m.description='' AND m.missing=0)")]
        for name, show_id in known:
            try:
                remote = asyncio.run(catalogue.show(show_id))
            except Exception:
                continue
            found = {(e['season'], e['number']): e for e in remote.get('episodes', []) if e.get('number') is not None}
            with db() as c:
                for row in c.execute("SELECT id,season,episode FROM media WHERE kind='episode' AND series=? AND description='' AND missing=0", (name,)).fetchall():
                    e = found.get((row['season'], row['episode']))
                    if e and e.get('description'):
                        c.execute('UPDATE media SET title=?,description=?,show_id=?,updated=? WHERE id=?',
                                  ((e.get('title') or '')[:250] or row['id'], e['description'], show_id, time.time(), row['id']))
    except Exception:
        pass
    finally:
        _enrich_lock.release()


def scan_in_background(sid):
    threading.Thread(target=scan_source, args=(sid,), daemon=True).start()


def auto_scanner(module):
    while sys.modules.get(module.__name__) is module:
        time.sleep(60)
        try:
            with db() as c:
                due = [r['id'] for r in c.execute("SELECT id FROM sources WHERE auto>0 AND scan_state!='running' AND last_scan+auto*60<?", (time.time(),))]
            for sid in due:scan_source(sid)
        except Exception:
            pass


threading.Thread(target=auto_scanner, args=(sys.modules[__name__],), daemon=True).start()


class SourceBody(BaseModel):
    kind: str = Field(default='server', pattern='^(server|shared)$')
    folder_id: str = Field(default='', max_length=64)
    path: str = Field(default='', max_length=4000)
    name: str = Field(default='', max_length=200)
    auto: int = Field(default=0, ge=0, le=10080)


def present_source(c, r):
    return dict(id=r['id'], kind=r['kind'], folder_id=r['folder_id'], name=r['name'], path=r['path'], auto=r['auto'], last_scan=r['last_scan'], state=r['scan_state'],
                error=r['scan_error'], videos=c.execute('SELECT COUNT(*) FROM media WHERE source_id=? AND missing=0', (r['id'],)).fetchone()[0],
                missing=c.execute('SELECT COUNT(*) FROM media WHERE source_id=? AND missing=1', (r['id'],)).fetchone()[0])


@desktop_router.get('/sources')
def list_sources():
    with db() as c:return dict(sources=[present_source(c, r) for r in c.execute('SELECT * FROM sources ORDER BY name')])


@desktop_router.post('/sources')
def add_source(body: SourceBody, session=Depends(desktop_session)):
    owner = session['effective_user']
    if body.kind == 'shared':
        # A folder shared from another mvmOS, connected by this person in Files: it must be readable.
        sub = body.path.strip('/')
        try:
            fp().shared_listing(owner, body.folder_id, sub)
        except HTTPException:
            fail('sourceUnreadable', 403)
        real, name = sub, body.name.strip()[:200] or sub.split('/')[-1] or 'Shared'
        with db() as c:
            if c.execute("SELECT 1 FROM sources WHERE kind='shared' AND folder_id=? AND path=?", (body.folder_id, real)).fetchone():fail('sourceExists', 409)
    else:
        real = fp().resolve_server_path(session, body.path, roots=['/'], kind='dir')
        if real == '/':fail('invalid', 400)
        name = body.name.strip()[:200] or os.path.basename(real) or real
        with db() as c:
            if c.execute("SELECT 1 FROM sources WHERE kind='server' AND path=?", (real,)).fetchone():fail('sourceExists', 409)
    with db() as c:
        sid = uuid.uuid4().hex
        c.execute('INSERT INTO sources(id,kind,folder_id,name,path,owner,auto,created) VALUES(?,?,?,?,?,?,?,?)',
                  (sid, body.kind, body.folder_id if body.kind == 'shared' else '', name, real, owner, body.auto, time.time()))
    return dict(id=sid)


@desktop_router.put('/sources/{sid}')
def edit_source(sid: str, body: SourceBody):
    with db() as c:
        if not c.execute('SELECT 1 FROM sources WHERE id=?', (sid,)).fetchone():fail()
        c.execute('UPDATE sources SET name=?,auto=? WHERE id=?', (body.name.strip()[:200] or 'Library', body.auto, sid))
    return dict(ok=True)


@desktop_router.post('/sources/{sid}/scan')
def scan_now(sid: str):
    with db() as c:
        if not c.execute('SELECT 1 FROM sources WHERE id=?', (sid,)).fetchone():fail()
    scan_in_background(sid)
    return dict(ok=True)


@desktop_router.delete('/sources/{sid}')
def remove_source(sid: str):
    # Only what mvmPlayer remembers is removed; the files in the folder are never touched.
    with db() as c:
        if not c.execute('SELECT 1 FROM sources WHERE id=?', (sid,)).fetchone():fail()
        c.execute('DELETE FROM media WHERE source_id=?', (sid,))
        c.execute('DELETE FROM sources WHERE id=?', (sid,))
    return dict(ok=True)


# ── AI subtitle translation (the work itself lives in premium/) ────

def profile(x_pub_token: str = Header(default='')):
    """The Apps Hub profile of whoever asks, also on the desktop, which carries the same sign-in."""
    user = hub().get_pub_session(x_pub_token) if x_pub_token else None
    if not user:
        raise HTTPException(401, 'login')
    return user


class EmbeddedCues(BaseModel):
    number: int = Field(ge=1, le=100000)
    title: str = Field(default='', max_length=200)
    language: str = Field(default='und', max_length=20)
    cues: list = Field(max_length=20000)


class TranslateBody(BaseModel):
    source: str = Field(min_length=1, max_length=60)
    language: str = Field(min_length=2, max_length=10)


def translating():
    mod = premium()
    if not mod or not translation_available():
        fail('translationOff', 403)
    return mod


def guarded(call):
    mod = translating()
    try:
        return call(mod)
    except mod.JobError as e:
        raise HTTPException(e.status, e.code)


def make_translation_routes(target, who):
    @target.get('/media/{mid}/translate/sources')
    def translate_sources(mid: str, user=Depends(who)):
        return dict(sources=guarded(lambda m: m.sources(mid)))

    @target.post('/media/{mid}/translate/cues')
    def translate_cues(mid: str, body: EmbeddedCues, user=Depends(who)):
        return guarded(lambda m: m.add_embedded(mid, body.number, body.title, body.language, body.cues))

    @target.post('/media/{mid}/translate/quote')
    def translate_quote(mid: str, body: TranslateBody, user=Depends(who)):
        return guarded(lambda m: m.quote(user['id'], mid, body.source, body.language))

    @target.post('/media/{mid}/translate')
    def translate_start(mid: str, body: TranslateBody, user=Depends(who)):
        return dict(id=guarded(lambda m: m.start(user['id'], mid, body.source, body.language)))

    @target.get('/translate/{job}')
    def translate_status(job: str, user=Depends(who)):
        return guarded(lambda m: m.status(user['id'], job))

    @target.post('/translate/{job}/cancel')
    def translate_cancel(job: str, user=Depends(who)):
        guarded(lambda m: m.cancel(user['id'], job))
        return dict(ok=True)


make_translation_routes(router, me)
make_translation_routes(desktop_router, profile)
