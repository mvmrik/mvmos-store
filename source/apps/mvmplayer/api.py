"""mvmPlayer: app-contained library, private viewer state and ticketed video.

No subprocess, system backend, transcoding or external server is required.
Media bytes are never placed in public/. Only desktop sessions manage files.
"""
import contextlib
import html
import json
import os
import re
import secrets
import sqlite3
import sys
import time
import types
import uuid
from pathlib import PurePosixPath

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
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
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY, filename TEXT NOT NULL, expected INTEGER NOT NULL,
          received INTEGER NOT NULL DEFAULT 0, expires REAL NOT NULL, media_id TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS tickets (
          token TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL, pub_token TEXT NOT NULL, expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS limits (host TEXT PRIMARY KEY, next_request REAL NOT NULL);
        ''')


init()
helper_path = os.path.join(ROOT, 'catalogue.py')
catalogue = types.ModuleType('mvmplayer_catalogue')
catalogue.__file__ = helper_path
with open(helper_path, encoding='utf-8') as source:
    exec(compile(source.read(), helper_path, 'exec'), catalogue.__dict__)
catalogue.db = db


def media(c, mid):
    row = c.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()
    if not row:
        fail()
    return row


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
    item['subtitles'] = [dict(r) for r in c.execute('SELECT id,title,language FROM subtitles WHERE media_id=? ORDER BY title', (row['id'],))]
    return item


def library_for(uid):
    with db() as c:
        items = [present(c,r,uid) for r in c.execute('SELECT * FROM media ORDER BY created DESC')]
        lists = []
        for row in c.execute('SELECT * FROM collections WHERE user_id=? ORDER BY title', (uid,)):
            entry = dict(row); entry.pop('user_id')
            entry['items'] = [r[0] for r in c.execute('SELECT media_id FROM collection_items WHERE collection_id=? ORDER BY position',(row['id'],))]
            lists.append(entry)
    return dict(items=items, collections=lists, languages=language_codes())


@router.get('/')
def index():
    if not hub().is_app_public(APP_ID):
        return hub().private_page('mvmPlayer','▶️')
    return FileResponse(os.path.join(ROOT,'public','index.html'))


@router.get('/library')
def library(user=Depends(me)):
    return {**library_for(user['id']), 'user_language':user.get('language','auto')}


@desktop_router.get('/admin')
def admin():
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
        c.execute('DELETE FROM uploads WHERE media_id=?',(mid,))
        c.execute('DELETE FROM media WHERE id=?',(mid,))
    with contextlib.suppress(FileNotFoundError):os.unlink(os.path.join(UPLOADS,filename))
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
    return dict(ok=True)


@router.post('/media/{mid}/ticket')
def ticket(mid: str, user=Depends(me), x_pub_token: str = Header(default='')):
    with db() as c:
        media(c,mid);token=secrets.token_urlsafe(32)
        c.execute('DELETE FROM tickets WHERE expires<?',(time.time(),))
        c.execute('INSERT INTO tickets VALUES(?,?,?,?,?)',(token,mid,user['id'],x_pub_token,time.time()+86400))
    return dict(url=f'/pub/{APP_ID}/stream/{mid}?ticket={token}',ticket=token)


def grant(c, mid, token):
    row=c.execute('SELECT * FROM tickets WHERE token=? AND media_id=? AND expires>?',(token,mid,time.time())).fetchone()
    user=hub().get_pub_session(row['pub_token']) if row else None
    if not row or not user or user['id']!=row['user_id']:fail('login',401)
    return media(c,mid)


def video_response(row):
    path=os.path.join(UPLOADS,row['filename'])
    if not os.path.isfile(path):fail('fileMissing',404)
    return FileResponse(path,media_type=row['mime'],headers={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'})


@router.get('/stream/{mid}')
@router.head('/stream/{mid}')
def stream(mid: str, ticket: str = ''):
    with db() as c:return video_response(grant(c,mid,ticket))


@desktop_router.get('/stream/{mid}')
@desktop_router.head('/stream/{mid}')
def admin_stream(mid: str):
    with db() as c:return video_response(media(c,mid))


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
        media(c,mid);c.execute('INSERT INTO subtitles VALUES(?,?,?,?,?)',(sid,mid,title.strip()[:200] or language,language,text))
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
            values.update(source=candidate['source'],source_url=candidate['url'],updated=time.time())
            if cover:values.update(cover=cover,cover_mime=valid_image(cover),cover_revision=uuid.uuid4().hex)
            c.execute('UPDATE media SET '+','.join(k+'=?' for k in values)+' WHERE id=?',(*values.values(),target))
    return dict(ok=True,cover_missing='cover' in body.fields and not cover)


@router.get('/series/{mid}')
async def series_info(mid: str, user=Depends(me)):
    with db() as c:row=media(c,mid)
    return await catalogue.show(row['show_id']) if row['show_id'] else dict(seasons=[],episodes=[])


@desktop_router.get('/series/{mid}')
async def admin_series_info(mid: str):
    return await series_info(mid,user={})
