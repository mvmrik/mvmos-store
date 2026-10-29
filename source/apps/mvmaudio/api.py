"""mvmAudio: shared library, private shelves and authenticated range streaming.

All media is outside public/. Only desktop sessions manage the common library;
Apps Hub identities own listening state, playlists and subscriber uploads.
"""
import asyncio
import contextlib
import os
import secrets
import sqlite3
import json
import sys
import time
import types
import uuid
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response, RedirectResponse
from pydantic import BaseModel, Field

APP_ID = "mvmaudio"
ROOT = os.path.dirname(__file__)
# Both helpers are root-level Python files so the normal Store installer keeps
# them beside api.py. Load the bundled sources without site-packages imports.
_probe_path = os.path.join(ROOT, "audio_probe.py")
_probe = types.ModuleType("mvmaudio_audio_probe")
_probe.__file__ = _probe_path
with open(_probe_path, encoding="utf-8") as _probe_source:
    exec(compile(_probe_source.read(), _probe_path, "exec"), _probe.__dict__)
_metadata_path = os.path.join(ROOT, "audio_metadata.py")
_metadata = types.ModuleType("mvmaudio_audio_metadata")
_metadata.__file__ = _metadata_path
with open(_metadata_path, encoding="utf-8") as _metadata_source:
    exec(compile(_metadata_source.read(), _metadata_path, "exec"), _metadata.__dict__)
DB = os.path.join(ROOT, "data.db")
UPLOADS = os.path.join(ROOT, "uploads")
MAX_FILE = 4 * 1024 ** 3
CHUNK_SIZE = 8 * 1024 ** 2
EXTENSIONS = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".m4b": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".flac": "audio/flac", ".wav": "audio/wav", ".webm": "audio/webm"}
router = APIRouter()


def desktop_session(request: Request):
    return sys.modules["backend.auth"].get_current_session(request)


desktop_router = APIRouter(dependencies=[Depends(desktop_session)])


@contextlib.contextmanager
def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA journal_mode=WAL")
    try:
        with c:
            yield c
    finally:
        c.close()


def init():
    os.makedirs(UPLOADS, exist_ok=True)
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS media (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL,
          title TEXT NOT NULL, creator TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
          album TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
          created REAL NOT NULL, updated REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS media_owner ON media(owner,kind);
        CREATE TABLE IF NOT EXISTS tracks (
          id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          title TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL,
          bytes INTEGER NOT NULL, duration REAL NOT NULL, position INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS tracks_media ON tracks(media_id,position);
        CREATE TABLE IF NOT EXISTS state (
          user_id TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL DEFAULT '', seconds REAL NOT NULL DEFAULT 0,
          speed REAL NOT NULL DEFAULT 1, completed INTEGER NOT NULL DEFAULT 0,
          favorite INTEGER NOT NULL DEFAULT 0, last_played REAL NOT NULL DEFAULT 0,
          PRIMARY KEY(user_id,media_id)
        );
        CREATE TABLE IF NOT EXISTS playlists (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS playlist_items (
          playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE, position INTEGER NOT NULL,
          PRIMARY KEY(playlist_id,media_id)
        );
        CREATE TABLE IF NOT EXISTS members (
          playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL, PRIMARY KEY(playlist_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS bookmarks (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, seconds REAL NOT NULL, title TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tickets (
          token TEXT PRIMARY KEY, user_id TEXT NOT NULL, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
          pub_token TEXT NOT NULL, expires REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chunk_uploads (
          id TEXT PRIMARY KEY, actor TEXT NOT NULL, owner TEXT NOT NULL, media_id TEXT NOT NULL,
          filename TEXT NOT NULL, expected INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0,
          expires REAL NOT NULL, status TEXT NOT NULL DEFAULT 'active'
        );
        CREATE TABLE IF NOT EXISTS book_readers (
          media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL, PRIMARY KEY(media_id,user_id)
        );
        CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS upload_reservations (
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,bytes INTEGER NOT NULL,expires REAL NOT NULL
        );
        """)
        _metadata.init(c)


init()


def hub():
    return sys.modules["backend.apphub"]


def me(x_pub_token: str = Header(default="")):
    user = hub().get_pub_session(x_pub_token)
    if not user:
        raise HTTPException(401, "login")
    return user


def premium():
    p = sys.modules.get("backend.premium")
    mod = p.load_premium_backend(APP_ID) if p else None
    return mod if mod and mod.is_available() else None


def fail(code="not_found", status=404):
    raise HTTPException(status, code)


def access(c, user_id, media_id):
    return c.execute("""SELECT m.* FROM media m WHERE m.id=? AND
      (m.owner IN ('',?) OR EXISTS(SELECT 1 FROM playlist_items i JOIN playlists p ON p.id=i.playlist_id
        LEFT JOIN members s ON s.playlist_id=p.id AND s.user_id=?
        WHERE i.media_id=m.id AND (p.owner='' OR p.owner=? OR s.user_id IS NOT NULL)))""",
        (media_id, user_id, user_id, user_id)).fetchone()


def owned(c, media_id, owner):
    row = c.execute("SELECT * FROM media WHERE id=? AND owner=?", (media_id, owner)).fetchone()
    if not row:
        fail()
    return row


def playlist(c, pid, user_id, write=False):
    row = c.execute("SELECT * FROM playlists WHERE id=?", (pid,)).fetchone()
    if not row:
        fail()
    if row["owner"] == user_id or (not write and (row["owner"] == "" or c.execute("SELECT 1 FROM members WHERE playlist_id=? AND user_id=?", (pid, user_id)).fetchone())):
        return row
    fail()


def tracks(c, media_id):
    return [dict(r) for r in c.execute("SELECT id,title,duration,position,bytes FROM tracks WHERE media_id=? ORDER BY position,id", (media_id,))]


def present(c, row, uid):
    item = dict(row)
    item["translations"] = _metadata.variants(row)
    item["shared"] = row["owner"] == ""
    item["mine"] = row["owner"] == uid
    item.pop("owner")
    cover = c.execute('SELECT remote,revision FROM media_covers WHERE media_id=?',(row['id'],)).fetchone()
    item['has_cover'] = bool(cover)
    item['cover_url'] = cover['remote'] if cover else ''
    item['cover_revision'] = cover['revision'] if cover else '' 
    item["tracks"] = ts = tracks(c, row["id"])
    item["duration"] = total = sum(t["duration"] for t in ts)
    item["bytes"] = sum(t["bytes"] for t in ts)
    s = c.execute("SELECT * FROM state WHERE user_id=? AND media_id=?", (uid, row["id"])).fetchone()
    item["state"] = dict(s) if s else {"track_id": "", "seconds": 0, "speed": 1, "completed": 0, "favorite": 0, "last_played": 0}
    item["state"].pop("user_id", None)
    elapsed = 0
    for t in ts:
        if t["id"] == item["state"]["track_id"]:
            elapsed += min(item["state"]["seconds"], t["duration"])
            break
        if item["state"]["track_id"]:
            elapsed += t["duration"]
    item["elapsed"] = total if item["state"]["completed"] else elapsed
    item["percent"] = round(min(100, item["elapsed"] / total * 100), 1) if total else 0
    return item


def supported_languages():
    if hasattr(hub(),'valid_languages'):return sorted(hub().valid_languages()-{'auto'})
    with open(os.path.join(ROOT,'public','i18n.js')) as f:
        source=f.read();return list(json.loads(source[source.index('{'):source.rindex('}')+1]))


class MediaBody(BaseModel):
    kind: str = "music"
    title: str = Field(min_length=1, max_length=200)
    creator: str = Field(default="", max_length=200)
    category: str = Field(default="", max_length=100)
    album: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=4000)
    url: str = Field(default="", max_length=2000)
    year: str | None = Field(default=None, max_length=20)
    narrator: str | None = Field(default=None, max_length=200)
    isbn: str | None = Field(default=None, max_length=32)
    language: str | None = Field(default=None, max_length=40)
    translations: dict[str,dict[str,str]] | None = None
    import_mode: str | None = Field(default=None,max_length=8)
    original_title: str | None = Field(default=None, max_length=200)
    original_creator: str | None = Field(default=None, max_length=200)


def clean_media(body):
    d = {k: v.strip() for k, v in body.model_dump(exclude_none=True,exclude={'translations'}).items()}
    if d.get('import_mode','') not in ('','files','chapters'):fail('invalid',400)
    if body.translations is not None:
        if not body.translations or len(body.translations)>len(supported_languages()):fail('invalid',400)
        localized={}
        for lang,entry in body.translations.items():
            if lang not in supported_languages() or not entry.get('title','').strip():fail('invalid',400)
            if any(k not in _metadata.LOCAL_FIELDS or len(v)>_metadata.LIMITS[k] for k,v in entry.items()):fail('invalid',400)
            localized[lang]={k:entry.get(k,'').strip() for k in _metadata.LOCAL_FIELDS}
        d.update(next(iter(localized.values())))
        d['translations']=json.dumps(localized,ensure_ascii=False)
    if d["kind"] not in ("music", "books", "radio") or not d["title"]:
        fail("invalid", 400)
    if d["kind"] == "radio":
        try:
            url = urlsplit(d["url"])
            valid = url.scheme == "https" and url.hostname and not url.username and not url.password and not any(ch.isspace() for ch in d["url"])
        except ValueError:
            valid = False
        if not valid:
            fail("radio_https", 400)
    else:
        d["url"] = ""
    return d


def create_media(owner, body):
    d = clean_media(body)
    mid = uuid.uuid4().hex
    with db() as c:
        c.execute("INSERT INTO media(id,owner,kind,title,creator,category,album,description,url,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                  (mid, owner, *[d[k] for k in ("kind", "title", "creator", "category", "album", "description", "url")], time.time(), time.time()))
        for field in ('year','narrator','isbn','language','original_title','original_creator','translations','import_mode'):
            if field in d:c.execute('UPDATE media SET '+field+'=? WHERE id=?',(d[field],mid))
    return {"id": mid}


@router.get("/")
async def index():
    if not hub().is_app_public(APP_ID):
        return hub().private_page("mvmAudio", "🎧")
    return FileResponse(os.path.join(ROOT, "public", "index.html"))


@router.get("/library")
def library(user=Depends(me)):
    uid = user["id"]
    with db() as c:
        rows = c.execute("""SELECT DISTINCT m.* FROM media m WHERE m.owner IN ('',?) OR EXISTS(
          SELECT 1 FROM playlist_items i JOIN playlists p ON p.id=i.playlist_id
          LEFT JOIN members s ON s.playlist_id=p.id AND s.user_id=?
          WHERE i.media_id=m.id AND (p.owner='' OR p.owner=? OR s.user_id IS NOT NULL)) ORDER BY m.created DESC""", (uid, uid, uid)).fetchall()
        items = [present(c, r, uid) for r in rows]
        lists = []
        for p in c.execute("SELECT DISTINCT p.* FROM playlists p LEFT JOIN members s ON s.playlist_id=p.id AND s.user_id=? WHERE p.owner IN ('',?) OR s.user_id IS NOT NULL ORDER BY p.title", (uid, uid)):
            d = dict(p)
            d["mine"], d["shared"] = p["owner"] == uid, p["owner"] == ""
            d.pop("owner")
            d["items"] = [r[0] for r in c.execute("SELECT media_id FROM playlist_items WHERE playlist_id=? ORDER BY position", (p["id"],))]
            d["members"] = [r[0] for r in c.execute("SELECT user_id FROM members WHERE playlist_id=?", (p["id"],))] if d["mine"] else []
            lists.append(d)
        used = c.execute("SELECT COALESCE(SUM(t.bytes),0) FROM tracks t JOIN media m ON m.id=t.media_id WHERE m.owner=?", (uid,)).fetchone()[0]
    p = premium()
    limit = p.limit_mb() if p else 0
    return {"items": items, "playlists": lists, "upload_limit_mb": limit, "used_bytes": used, "user_id": uid, "languages": supported_languages(), "user_language": user.get("language","auto")}


@desktop_router.get("/admin")
def admin():
    p = premium()
    with db() as c:
        items = [present(c, r, "@admin") for r in c.execute("SELECT * FROM media WHERE owner='' ORDER BY created DESC")]
        lists = []
        for row in c.execute("SELECT * FROM playlists WHERE owner='' ORDER BY title"):
            d = dict(row)
            d["items"] = [r[0] for r in c.execute("SELECT media_id FROM playlist_items WHERE playlist_id=? ORDER BY position", (row["id"],))]
            lists.append(d)
    return {"premium": bool(p), "upload_limit_mb": p.limit_mb() if p else 0, "items": items, "playlists": lists}


@desktop_router.get('/statistics')
def statistics():
    """Current common-library listening state, never subscriber-owned content.

    A completed flag includes explicit marking as read. Saved positions are not
    listening-duration or play-count telemetry; seeking can change them.
    """
    with db() as c:
        media=[dict(r) for r in c.execute("SELECT * FROM media WHERE owner='' ORDER BY created DESC")]
        states=[dict(r) for r in c.execute("SELECT s.* FROM state s JOIN media m ON m.id=s.media_id WHERE m.owner=''")]
        chapters=[dict(r) for r in c.execute("SELECT t.id,t.media_id,t.title,t.duration,t.bytes FROM tracks t JOIN media m ON m.id=t.media_id WHERE m.owner='' ORDER BY t.position,t.id")]
        groups=[dict(r) for r in c.execute("SELECT r.* FROM book_readers r JOIN media m ON m.id=r.media_id WHERE m.owner=''")]
    ids=list(dict.fromkeys(r['user_id'] for r in states+groups));profiles={}
    for offset in range(0,len(ids),400):
        for u in hub().get_users_by_ids(ids[offset:offset+400]):
            profiles[u['id']]={k:u.get(k,'') for k in ('id','username','display_name')}
    people=[profiles.get(uid,{'id':uid,'username':'','display_name':'','deleted':True}) for uid in ids]
    by_media={m['id']:[] for m in media};tracks_by_media={m['id']:[] for m in media};targets={m['id']:[] for m in media}
    for r in states:by_media[r['media_id']].append(r)
    for r in chapters:tracks_by_media[r['media_id']].append(r)
    for r in groups:targets[r['media_id']].append(r['user_id'])
    items=[];activity=[]
    for m in media:
        mid=m['id'];ts=tracks_by_media[mid];duration=sum(t['duration'] for t in ts)
        item={k:m[k] for k in ('id','kind','title','creator','category')}
        item.update(translations=_metadata.variants(m),bytes=sum(t['bytes'] for t in ts),duration=duration,tracked_user_ids=targets[mid],readers=[])
        for row in by_media[mid]:
            elapsed=0;chapter=0;chapter_title=''
            for n,track in enumerate(ts):
                if track['id']==row['track_id']:
                    elapsed+=min(max(0,row['seconds']),track['duration']);chapter=n+1;chapter_title=track['title'];break
                elapsed+=track['duration']
            if not chapter:elapsed=0
            if row['completed']:elapsed=duration
            active=bool(row['last_played'] or elapsed>0 or row['completed'])
            reading={'user_id':row['user_id'],'media_id':mid,'completed':bool(row['completed']),
                'favorite':bool(row['favorite']),'last_played':row['last_played'],'elapsed':elapsed,
                'percent':100 if row['completed'] else round(min(100,elapsed/duration*100),1) if duration else 0,
                'remaining':max(0,duration-elapsed)/row['speed'],'speed':row['speed'],
                'chapter':chapter,'chapter_title':chapter_title,'chapter_count':len(ts),'active':active}
            item['readers'].append(reading)
            if active:activity.append(reading)
        engaged=[r for r in item['readers'] if r['active']]
        cohort=targets[mid] or [r['user_id'] for r in engaged]
        completed={r['user_id'] for r in item['readers'] if r['completed']}
        progress_by_user={r['user_id']:r['percent'] for r in item['readers']}
        item.update(listener_count=len(engaged),completed_count=sum(r['completed'] for r in engaged),
            in_progress=sum(not r['completed'] for r in engaged),cohort_count=len(cohort),
            cohort_completed=sum(uid in completed for uid in cohort),
            ready=bool(m['kind']=='books' and item['bytes'] and cohort and all(uid in completed for uid in cohort)),
            last_played=max((r['last_played'] for r in engaged),default=0),
            average_percent=round(sum(progress_by_user.get(uid,0) for uid in cohort)/len(cohort),1) if cohort else 0)
        items.append(item)
    books=[i for i in items if i['kind']=='books'];ready=[i for i in books if i['ready']]
    return {'items':items,'people':people,'activity':sorted(activity,key=lambda r:r['last_played'],reverse=True),
        'generated':time.time(),'summary':{'bytes':sum(i['bytes'] for i in items),'books':len(books),
        'listeners':len({r['user_id'] for r in activity}),
        'active_week':len({r['user_id'] for r in activity if r['last_played']>=time.time()-7*86400}),
        'completed':sum(i['completed_count'] for i in books),'in_progress':sum(i['in_progress'] for i in books),
        'ready':len(ready),'ready_bytes':sum(i['bytes'] for i in ready)}}


@desktop_router.get('/statistics/users')
def statistics_users(q: str=''):
    return [{k:u.get(k,'') for k in ('id','username','display_name')} for u in hub().search_users(q[:100],None)]


class ReadingGroupBody(BaseModel):
    user_ids: list[str] = Field(default_factory=list,max_length=500)


@desktop_router.put('/statistics/media/{mid}/readers')
def statistics_readers(mid: str, body: ReadingGroupBody):
    ids=list(dict.fromkeys(body.user_ids))
    with db() as c:
        row=owned(c,mid,'')
        if row['kind']!='books':fail('invalid',400)
    found={u['id'] for u in hub().get_users_by_ids(ids)}
    if found!=set(ids):fail('invalid',400)
    with db() as c:
        owned(c,mid,'')
        c.execute('DELETE FROM book_readers WHERE media_id=?',(mid,))
        c.executemany('INSERT INTO book_readers VALUES(?,?)',[(mid,uid) for uid in ids])
    return {'ok':True}


@desktop_router.put("/settings")
async def settings(body: dict):
    p = premium()
    if not p:
        fail("premium_required", 402)
    return p.save_settings(body)


@desktop_router.post("/media")
def admin_create(body: MediaBody):
    return create_media("", body)


@router.post("/media")
def personal_create(body: MediaBody, user=Depends(me)):
    p = premium()
    if not p:
        fail("uploads_disabled", 403)
    return p.create_media(user["id"], body)


def edit_media(mid, owner, body):
    d = clean_media(body)
    with db() as c:
        row = owned(c, mid, owner)
        if row["kind"] != d["kind"]:
            fail("invalid", 400)
        c.execute("UPDATE media SET title=?,creator=?,category=?,album=?,description=?,url=?,updated=? WHERE id=?",
                  (*[d[k] for k in ("title", "creator", "category", "album", "description", "url")], time.time(), mid))
        for field in ('year','narrator','isbn','language','original_title','original_creator','translations'):
            if field in d:c.execute('UPDATE media SET '+field+'=? WHERE id=?',(d[field],mid))
        c.execute("UPDATE media SET import_mode='' WHERE id=?",(mid,))
    return {"ok": True}


@desktop_router.put("/media/{mid}")
def admin_edit(mid: str, body: MediaBody):
    return edit_media(mid, "", body)


@router.put("/media/{mid}")
def personal_edit(mid: str, body: MediaBody, user=Depends(me)):
    return edit_media(mid, user["id"], body)


def delete_media(mid, owner):
    with db() as c:
        owned(c, mid, owner)
        names = [r[0] for r in c.execute("SELECT filename FROM tracks WHERE media_id=?", (mid,))]
        pending = c.execute("SELECT id,actor FROM chunk_uploads WHERE media_id=?", (mid,)).fetchall()
        c.execute("DELETE FROM media WHERE id=?", (mid,))
    for upload in pending:
        discard_upload(upload["id"], upload["actor"], force=True)
    for name in names:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(os.path.join(UPLOADS, name))
    return {"ok": True}


@desktop_router.delete("/media/{mid}")
def admin_delete(mid: str):
    return delete_media(mid, "")


@router.delete("/media/{mid}")
def personal_delete(mid: str, user=Depends(me)):
    return delete_media(mid, user["id"])


def discard_empty_import(mid, owner):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=owned(c,mid,owner)
        if not row['import_mode'] or c.execute('SELECT 1 FROM tracks WHERE media_id=?',(mid,)).fetchone():
            return {'removed':False}
        pending=c.execute('SELECT id,actor FROM chunk_uploads WHERE media_id=?',(mid,)).fetchall()
        c.execute('DELETE FROM media WHERE id=?',(mid,))
    for upload in pending:discard_upload(upload['id'],upload['actor'],force=True)
    return {'removed':True}


@desktop_router.delete('/imports/{mid}')
def admin_discard_import(mid: str):
    return discard_empty_import(mid,'')


@router.delete('/imports/{mid}')
def personal_discard_import(mid: str, user=Depends(me)):
    return discard_empty_import(mid,user['id'])


async def ingest(mid, owner, request, filename, max_bytes=MAX_FILE, reservation=None):
    """Shared file storage primitive. Personal policy/reservations live in Premium."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in EXTENSIONS:
        fail("format", 400)
    with db() as c:
        row = owned(c, mid, owner)
        if row["kind"] == "radio":
            fail("invalid", 400)
    tid = uuid.uuid4().hex
    stored = tid + ext
    path = os.path.join(UPLOADS, stored)
    size = 0
    saved = False
    try:
        with open(path, "xb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > min(MAX_FILE, max_bytes):
                    fail("quota", 413)
                f.write(chunk)
        if not size:
            fail("format", 400)
        result = await finalize_audio(mid, owner, filename, path, size, tid, reservation)
        saved = True
        return result
    finally:
        if not saved:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)


async def finalize_audio(mid, owner, filename, path, size, tid, reservation=None):
    try:
        seconds = await asyncio.to_thread(_probe.inspect_audio, path)
    except _probe.InvalidAudio:
        fail("format", 400)
    tags, art = await asyncio.to_thread(_metadata.embedded, path)
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        media_row = owned(c, mid, owner)
        if reservation:
            reservation(c, size)
        pos = c.execute("SELECT COALESCE(MAX(position),-1)+1 FROM tracks WHERE media_id=?", (mid,)).fetchone()[0]
        c.execute("INSERT INTO tracks VALUES(?,?,?,?,?,?,?,?)", (tid, mid, tags.get("title") or os.path.splitext(os.path.basename(filename))[0][:200], os.path.basename(path), EXTENSIONS[os.path.splitext(filename)[1].lower()], size, seconds, pos))
        _metadata.apply_embedded(c, media_row, tid, tags, art, filename)
        c.execute("UPDATE media SET updated=? WHERE id=?", (time.time(), mid))
        c.execute("DELETE FROM chunk_uploads WHERE id=?", (tid,))
    return {"id": tid, "duration": seconds, "bytes": size}


class UploadBody(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    bytes: int = Field(gt=0, le=MAX_FILE)


def upload_path(row):
    return os.path.join(UPLOADS, row["id"] + os.path.splitext(row["filename"])[1].lower())


def discard_upload(uid, actor, force=False, expired_only=False):
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        row = c.execute("SELECT * FROM chunk_uploads WHERE id=? AND actor=?", (uid, actor)).fetchone()
        if not row:
            return {"ok": True}
        if expired_only and row['expires'] >= time.time():
            return {"ok": True}
        if row["status"] == 'finishing' and not force:
            fail('uploadBusy', 409)
        with contextlib.suppress(FileNotFoundError):
            os.unlink(upload_path(row))
        c.execute("DELETE FROM chunk_uploads WHERE id=?", (uid,))
        c.execute("DELETE FROM upload_reservations WHERE id=?", (uid,))
    return {"ok": True}


def clean_uploads():
    with db() as c:
        rows = c.execute("SELECT id,actor FROM chunk_uploads WHERE expires<?", (time.time(),)).fetchall()
    for row in rows:
        discard_upload(row['id'], row['actor'], force=True, expired_only=True)


def start_upload(mid, owner, actor, body, reserve=None):
    clean_uploads()
    ext = os.path.splitext(body.filename)[1].lower()
    if ext not in EXTENSIONS:
        fail('format', 400)
    uid = uuid.uuid4().hex
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = owned(c, mid, owner)
        if row['kind'] == 'radio':
            fail('invalid', 400)
        if c.execute('SELECT COUNT(*) FROM chunk_uploads WHERE actor=?', (actor,)).fetchone()[0] >= 5:
            fail('uploadBusy', 409)
        if reserve:
            reserve(c, uid, body.bytes)
        c.execute('INSERT INTO chunk_uploads(id,actor,owner,media_id,filename,expected,expires) VALUES(?,?,?,?,?,?,?)', (uid, actor, owner, mid, body.filename, body.bytes, time.time()+86400))
    return {'id': uid, 'chunk_bytes': CHUNK_SIZE}


def upload_row(c, uid, actor):
    row = c.execute('SELECT * FROM chunk_uploads WHERE id=? AND actor=?', (uid, actor)).fetchone()
    if not row:
        fail()
    if row['expires'] < time.time():
        fail('uploadExpired', 410)
    owned(c, row['media_id'], row['owner'])
    return row


async def append_upload(uid, actor, request, offset):
    data = bytearray()
    async for part in request.stream():
        if len(data) + len(part) > CHUNK_SIZE:
            fail('uploadTooLarge', 413)
        data.extend(part)
    if not data or offset < 0:
        fail('invalid', 400)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = upload_row(c, uid, actor)
        if row['status'] != 'active':
            fail('uploadBusy', 409)
        if offset + len(data) > row['expected']:
            fail('invalid', 400)
        path = upload_path(row)
        if offset < row['received']:
            # A retry after a lost response is idempotent, never an append.
            if offset + len(data) > row['received']:
                fail('uploadOffset', 409)
            with open(path, 'rb') as f:
                f.seek(offset)
                if f.read(len(data)) != data:
                    fail('uploadOffset', 409)
            return {'received': row['received']}
        if offset != row['received']:
            fail('uploadOffset', 409)
        with open(path, 'r+b' if os.path.exists(path) else 'xb') as f:
            # A worker may have exited after writing but before committing.
            f.seek(offset)
            f.truncate(offset)
            f.write(data)
            f.flush()
        c.execute('UPDATE chunk_uploads SET received=?,expires=? WHERE id=?', (offset+len(data), time.time()+86400, uid))
    return {'received': offset+len(data)}


async def finish_upload(uid, actor, reservation=None):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        existing = c.execute('SELECT t.id,t.duration,t.bytes,m.owner FROM tracks t JOIN media m ON m.id=t.media_id WHERE t.id=?', (uid,)).fetchone()
        if existing and actor == ('p:'+existing['owner'] if existing['owner'] else 'admin'):
            return {k:existing[k] for k in ('id','duration','bytes')}
        row = upload_row(c, uid, actor)
        if row['status'] != 'active':
            fail('uploadBusy', 409)
        if row['received'] != row['expected'] or not os.path.isfile(upload_path(row)) or os.path.getsize(upload_path(row)) != row['expected']:
            fail('uploadOffset', 409)
        c.execute("UPDATE chunk_uploads SET status='finishing' WHERE id=?", (uid,))
    try:
        return await finalize_audio(row['media_id'], row['owner'], row['filename'], upload_path(row), row['expected'], uid, reservation)
    finally:
        # Successful finalization already removed the session, retaining media.
        discard_upload(uid, actor, force=True)


@desktop_router.post('/media/{mid}/uploads')
def admin_start_upload(mid: str, body: UploadBody):
    return start_upload(mid, '', 'admin', body)


@desktop_router.put('/uploads/{uid}')
async def admin_append_upload(uid: str, request: Request, offset: int):
    return await append_upload(uid, 'admin', request, offset)


@desktop_router.post('/uploads/{uid}/finish')
async def admin_finish_upload(uid: str):
    return await finish_upload(uid, 'admin')


@desktop_router.delete('/uploads/{uid}')
def admin_cancel_upload(uid: str):
    return discard_upload(uid, 'admin')


@router.post('/media/{mid}/uploads')
def personal_start_upload(mid: str, body: UploadBody, user=Depends(me)):
    p = premium()
    if not p:
        fail('uploads_disabled', 403)
    return p.start_upload(user['id'], mid, body)


@router.put('/uploads/{uid}')
async def personal_append_upload(uid: str, request: Request, offset: int, user=Depends(me)):
    p = premium()
    if not p:
        fail('uploads_disabled', 403)
    return await p.append_upload(user['id'], uid, request, offset)


@router.post('/uploads/{uid}/finish')
async def personal_finish_upload(uid: str, user=Depends(me)):
    p = premium()
    if not p:
        fail('uploads_disabled', 403)
    return await p.finish_upload(user['id'], uid)


@router.delete('/uploads/{uid}')
def personal_cancel_upload(uid: str, user=Depends(me)):
    return discard_upload(uid, 'p:'+user['id'])


@desktop_router.post("/media/{mid}/tracks")
async def admin_upload(mid: str, request: Request, filename: str):
    return await ingest(mid, "", request, filename)


@router.post("/media/{mid}/tracks")
async def personal_upload(mid: str, request: Request, filename: str, user=Depends(me)):
    p = premium()
    if not p:
        fail("uploads_disabled", 403)
    return await p.upload(user["id"], mid, request, filename)


class OrderBody(BaseModel):
    ids: list[str] = Field(max_length=5000)


def order_tracks(mid, owner, ids):
    with db() as c:
        owned(c, mid, owner)
        actual = {r[0] for r in c.execute("SELECT id FROM tracks WHERE media_id=?", (mid,))}
        if len(ids) != len(actual) or set(ids) != actual:
            fail("invalid", 400)
        c.executemany("UPDATE tracks SET position=? WHERE id=? AND media_id=?", [(i, tid, mid) for i, tid in enumerate(ids)])
    return {"ok": True}


@desktop_router.put("/media/{mid}/tracks/order")
def admin_order(mid: str, body: OrderBody):
    return order_tracks(mid, "", body.ids)


@router.put("/media/{mid}/tracks/order")
def personal_order(mid: str, body: OrderBody, user=Depends(me)):
    return order_tracks(mid, user["id"], body.ids)


def remove_track(mid, tid, owner):
    with db() as c:
        owned(c, mid, owner)
        row = c.execute("SELECT * FROM tracks WHERE id=? AND media_id=?", (tid, mid)).fetchone()
        if not row:
            fail()
        c.execute("DELETE FROM tracks WHERE id=?", (tid,))
        c.execute("UPDATE state SET track_id='',seconds=0,completed=0 WHERE media_id=? AND track_id=?", (mid, tid))
    with contextlib.suppress(FileNotFoundError):
        os.unlink(os.path.join(UPLOADS, row["filename"]))
    return {"ok": True}


@desktop_router.delete("/media/{mid}/tracks/{tid}")
def admin_remove_track(mid: str, tid: str):
    return remove_track(mid, tid, "")


@router.delete("/media/{mid}/tracks/{tid}")
def personal_remove_track(mid: str, tid: str, user=Depends(me)):
    return remove_track(mid, tid, user["id"])


class StateBody(BaseModel):
    track_id: str | None = None
    seconds: float | None = Field(default=None, ge=0, le=1e8, allow_inf_nan=False)
    speed: float | None = Field(default=None, ge=0.5, le=3, allow_inf_nan=False)
    completed: bool | None = None
    favorite: bool | None = None
    played: bool = False


@router.put("/media/{mid}/state")
def save_state(mid: str, body: StateBody, user=Depends(me)):
    uid = user["id"]
    with db() as c:
        if not access(c, uid, mid):
            fail()
        c.execute("INSERT OR IGNORE INTO state(user_id,media_id) VALUES(?,?)", (uid, mid))
        d = body.model_dump(exclude_none=True)
        if body.track_id is not None:
            t = c.execute("SELECT duration FROM tracks WHERE id=? AND media_id=?", (body.track_id, mid)).fetchone()
            if not t:
                fail("invalid", 400)
            if body.seconds is not None:
                d["seconds"] = min(body.seconds, t["duration"])
        elif body.seconds is not None:
            fail("invalid", 400)
        d.pop("played")
        if body.played:
            d["last_played"] = time.time()
        if body.completed is False and body.track_id is None:
            d.update(track_id="", seconds=0)
        if d:
            c.execute("UPDATE state SET " + ",".join(k + "=?" for k in d) + " WHERE user_id=? AND media_id=?", (*d.values(), uid, mid))
    return {"ok": True}


@router.post("/tracks/{tid}/ticket")
def ticket(tid: str, x_pub_token: str = Header(default=""), user=Depends(me)):
    with db() as c:
        track = c.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
        if not track or not access(c, user["id"], track["media_id"]):
            fail()
        token = secrets.token_urlsafe(32)
        c.execute("DELETE FROM tickets WHERE expires<?", (time.time(),))
        c.execute("INSERT INTO tickets VALUES(?,?,?,?,?)", (token, user["id"], tid, x_pub_token, time.time() + 86400))
    return {"url": f"/pub/{APP_ID}/stream/{tid}?ticket={token}"}


@router.get("/stream/{tid}")
@router.head("/stream/{tid}")
def stream(tid: str, ticket: str = ""):
    with db() as c:
        grant = c.execute("SELECT * FROM tickets WHERE token=? AND track_id=? AND expires>?", (ticket, tid, time.time())).fetchone()
        if not grant or not hub().get_pub_session(grant["pub_token"]) or not access(c, grant["user_id"], c.execute("SELECT media_id FROM tracks WHERE id=?", (tid,)).fetchone()[0]):
            fail("login", 401)
        t = c.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    return FileResponse(os.path.join(UPLOADS, t["filename"]), media_type=t["mime"], headers={"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff"})


class PlaylistBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    items: list[str] = Field(default_factory=list, max_length=5000)


def save_playlist(uid, body, pid=None):
    if not body.title.strip() or len(set(body.items)) != len(body.items):
        fail("invalid", 400)
    with db() as c:
        if pid:
            playlist(c, pid, uid, write=True)
        for mid in body.items:
            row = c.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
            # Only the owner can redistribute a private upload to recipients.
            if not row or row["owner"] not in ("", uid):
                fail("not_owned", 403)
        pid = pid or uuid.uuid4().hex
        c.execute("INSERT INTO playlists VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,updated=excluded.updated", (pid, uid, body.title.strip(), time.time()))
        c.execute("DELETE FROM playlist_items WHERE playlist_id=?", (pid,))
        c.executemany("INSERT INTO playlist_items VALUES(?,?,?)", [(pid, mid, n) for n, mid in enumerate(body.items)])
    return {"id": pid}


@router.post("/playlists")
def new_playlist(body: PlaylistBody, user=Depends(me)):
    return save_playlist(user["id"], body)


@router.put("/playlists/{pid}")
def edit_playlist(pid: str, body: PlaylistBody, user=Depends(me)):
    return save_playlist(user["id"], body, pid)


@desktop_router.post("/playlists")
def admin_new_playlist(body: PlaylistBody):
    return save_playlist("", body)


@desktop_router.put("/playlists/{pid}")
def admin_edit_playlist(pid: str, body: PlaylistBody):
    return save_playlist("", body, pid)


def delete_playlist(uid, pid):
    with db() as c:
        playlist(c, pid, uid, write=True)
        c.execute("DELETE FROM playlists WHERE id=?", (pid,))
    return {"ok": True}


@router.delete("/playlists/{pid}")
def remove_playlist(pid: str, user=Depends(me)):
    return delete_playlist(user["id"], pid)


@desktop_router.delete("/playlists/{pid}")
def admin_remove_playlist(pid: str):
    return delete_playlist("", pid)


class MemberBody(BaseModel):
    user_id: str = Field(max_length=100)


@router.get("/users")
def users(q: str = "", user=Depends(me)):
    return [{k: r[k] for k in ("id", "username", "display_name")} for r in hub().search_users(q, user["id"])]


@router.get("/playlists/{pid}/members")
def members(pid: str, user=Depends(me)):
    with db() as c:
        playlist(c, pid, user["id"], write=True)
        ids = [r[0] for r in c.execute("SELECT user_id FROM members WHERE playlist_id=?", (pid,))]
    return [{k: r[k] for k in ("id", "username", "display_name")} for r in hub().get_users_by_ids(ids)]


@router.post("/playlists/{pid}/members")
def add_member(pid: str, body: MemberBody, user=Depends(me)):
    if not hub().get_users_by_ids([body.user_id]):
        fail()
    with db() as c:
        playlist(c, pid, user["id"], write=True)
        if body.user_id != user["id"]:
            c.execute("INSERT OR IGNORE INTO members VALUES(?,?)", (pid, body.user_id))
    return {"ok": True}


@router.delete("/playlists/{pid}/members/{uid}")
def remove_member(pid: str, uid: str, user=Depends(me)):
    with db() as c:
        playlist(c, pid, user["id"], write=True)
        c.execute("DELETE FROM members WHERE playlist_id=? AND user_id=?", (pid, uid))
    return {"ok": True}


class BookmarkBody(BaseModel):
    track_id: str
    seconds: float = Field(ge=0, le=1e8, allow_inf_nan=False)
    title: str = Field(min_length=1, max_length=200)


@router.get("/media/{mid}/bookmarks")
def bookmarks(mid: str, user=Depends(me)):
    with db() as c:
        if not access(c, user["id"], mid):
            fail()
        return [dict(r) for r in c.execute("SELECT id,track_id,seconds,title FROM bookmarks WHERE user_id=? AND media_id=? ORDER BY rowid", (user["id"], mid))]


@router.post("/media/{mid}/bookmarks")
def add_bookmark(mid: str, body: BookmarkBody, user=Depends(me)):
    with db() as c:
        if not access(c, user["id"], mid):
            fail()
        t = c.execute("SELECT duration FROM tracks WHERE id=? AND media_id=?", (body.track_id, mid)).fetchone()
        if not t:
            fail("invalid", 400)
        bid = uuid.uuid4().hex
        c.execute("INSERT INTO bookmarks VALUES(?,?,?,?,?,?)", (bid, user["id"], mid, body.track_id, min(body.seconds, t["duration"]), body.title))
    return {"id": bid}


@router.delete("/bookmarks/{bid}")
def remove_bookmark(bid: str, user=Depends(me)):
    with db() as c:
        c.execute("DELETE FROM bookmarks WHERE id=? AND user_id=?", (bid, user["id"]))
    return {"ok": True}


# Metadata and artwork are base features; edits always require title ownership.
class MetadataSearchBody(BaseModel):
    title: str = Field(default='',max_length=200)
    creator: str = Field(default='',max_length=200)
    album: str = Field(default='',max_length=200)
    isbn: str = Field(default='',max_length=32)


class MetadataApplyBody(BaseModel):
    candidate_id: str = Field(default='',max_length=64)
    fields: list[str] = Field(default_factory=lambda:list(_metadata.FIELDS)+['cover'],max_length=10)
    overwrite: bool = False
    lang: str = Field(default='',max_length=16)


async def metadata_search(mid,owner,body):
    with db() as c:row=owned(c,mid,owner)
    creator=body.creator if 'creator' in body.model_fields_set else row['original_creator']
    return await _metadata.search(row['kind'],body.title or row['original_title'] or row['title'],creator,body.album,body.isbn)


@desktop_router.post('/media/{mid}/metadata/search')
async def admin_metadata_search(mid: str, body: MetadataSearchBody):
    return await metadata_search(mid,'',body)


@router.post('/media/{mid}/metadata/search')
async def user_metadata_search(mid: str, body: MetadataSearchBody, user=Depends(me)):
    return await metadata_search(mid,user['id'],body)


@desktop_router.post('/media/{mid}/metadata/apply')
async def admin_metadata_apply(mid: str, body: MetadataApplyBody):
    if body.lang and body.lang not in supported_languages():fail('invalid',400)
    return await _metadata.apply_candidate(mid,'',body.candidate_id,body.fields,body.overwrite,body.lang)


@router.post('/media/{mid}/metadata/apply')
async def user_metadata_apply(mid: str, body: MetadataApplyBody, user=Depends(me)):
    if body.lang and body.lang not in supported_languages():fail('invalid',400)
    return await _metadata.apply_candidate(mid,user['id'],body.candidate_id,body.fields,body.overwrite,body.lang)


@desktop_router.post('/media/{mid}/metadata/tags')
async def admin_metadata_tags(mid: str, body: MetadataApplyBody):
    if body.lang and body.lang not in supported_languages():fail('invalid',400)
    return await _metadata.scan_tags(mid,'',body.fields,body.overwrite,body.lang)


@router.post('/media/{mid}/metadata/tags')
async def user_metadata_tags(mid: str, body: MetadataApplyBody, user=Depends(me)):
    if body.lang and body.lang not in supported_languages():fail('invalid',400)
    return await _metadata.scan_tags(mid,user['id'],body.fields,body.overwrite,body.lang)


def read_cover(mid,uid,admin=False):
    with db() as c:
        row=owned(c,mid,'') if admin else access(c,uid,mid)
        if not row:fail()
        cover=c.execute('SELECT * FROM media_covers WHERE media_id=?',(mid,)).fetchone()
        if not cover:fail()
    headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}
    if cover['remote']:return RedirectResponse(cover['remote'],headers=headers)
    return Response(bytes(cover['data']),media_type=cover['mime'],headers=headers)


@desktop_router.get('/media/{mid}/cover')
def admin_cover(mid: str):
    return read_cover(mid,'',True)


@router.get('/media/{mid}/cover')
def user_cover(mid: str, user=Depends(me)):
    return read_cover(mid,user['id'])


async def write_cover(mid,owner,request):
    with db() as c:owned(c,mid,owner)
    data=bytearray()
    async for part in request.stream():
        if len(data)+len(part)>_metadata.MAX_IMAGE:fail('coverInvalid',413)
        data.extend(part)
    with db() as c:
        owned(c,mid,owner);_metadata.set_cover(c,mid,bytes(data))
        c.execute('UPDATE media SET updated=? WHERE id=?',(time.time(),mid))
    return {'ok':True}


@desktop_router.put('/media/{mid}/cover')
async def admin_write_cover(mid: str, request: Request):
    return await write_cover(mid,'',request)


@router.put('/media/{mid}/cover')
async def user_write_cover(mid: str, request: Request, user=Depends(me)):
    return await write_cover(mid,user['id'],request)


def delete_cover(mid,owner):
    with db() as c:
        owned(c,mid,owner);c.execute('DELETE FROM media_covers WHERE media_id=?',(mid,))
        c.execute('UPDATE media SET updated=? WHERE id=?',(time.time(),mid))
    return {'ok':True}


@desktop_router.delete('/media/{mid}/cover')
def admin_delete_cover(mid: str):
    return delete_cover(mid,'')


@router.delete('/media/{mid}/cover')
def user_delete_cover(mid: str, user=Depends(me)):
    return delete_cover(mid,user['id'])
