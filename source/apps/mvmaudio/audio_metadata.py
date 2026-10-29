"""Embedded tags and optional, user-initiated catalogue lookup per installation.

Requests go directly to the providers. Cached responses and a SQLite-backed
request schedule are local to this app; no mvmOS central service or key is used.
"""
import asyncio
import hashlib
import json
import os
import re
import struct
import sys
import time
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

FIELDS = ('title', 'creator', 'album', 'category', 'year', 'description', 'language', 'isbn', 'narrator')
LIMITS = {'title': 200, 'creator': 200, 'album': 200, 'category': 100, 'year': 20, 'description': 4000, 'language': 40, 'isbn': 32, 'narrator': 200}
MAX_IMAGE = 2 * 1024 ** 2
USER_AGENT = 'mvmAudio/1.0.0 (https://mvmos.org)'


def base():
    return sys.modules['app_public_mvmaudio']


def init(c):
    existing = {r[1] for r in c.execute('PRAGMA table_info(media)')}
    for field in ('year', 'narrator', 'isbn', 'language', 'metadata_source', 'metadata_url', 'original_title', 'original_creator'):
        if field not in existing:
            c.execute(f"ALTER TABLE media ADD COLUMN {field} TEXT NOT NULL DEFAULT ''")
    if 'translations' not in existing:c.execute("ALTER TABLE media ADD COLUMN translations TEXT NOT NULL DEFAULT '{}'")
    if 'import_mode' not in existing:c.execute("ALTER TABLE media ADD COLUMN import_mode TEXT NOT NULL DEFAULT ''")
    c.executescript('''
      CREATE TABLE IF NOT EXISTS media_covers (
        media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
        data BLOB, mime TEXT NOT NULL DEFAULT '', remote TEXT NOT NULL DEFAULT '', revision TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS metadata_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL, expires REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata_limits (host TEXT PRIMARY KEY, next_request REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS embedded_tags (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE, data TEXT NOT NULL
      );
    ''')


def clean(data):
    return {k: str(data[k]).strip()[:LIMITS[k]] for k in FIELDS if data.get(k) is not None and str(data[k]).strip()}


def image_type(data):
    if not 12 <= len(data) <= MAX_IMAGE:
        raise HTTPException(400, 'coverInvalid')
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) >= 33 and data[12:16] == b'IHDR':
        w, h = struct.unpack('>II', data[16:24])
        if not (0 < w <= 8000 and 0 < h <= 8000 and w*h <= 16000000) or b'IEND' not in data[-16:]:
            raise HTTPException(400, 'coverInvalid')
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff') and data.endswith(b'\xff\xd9'):
        return 'image/jpeg'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP' and int.from_bytes(data[4:8], 'little') + 8 == len(data):
        return 'image/webp'
    raise HTTPException(400, 'coverInvalid')


def set_cover(c, mid, data=None, remote=''):
    mime = image_type(data) if data else ''
    if remote and not re.fullmatch(r'https://covers\.openlibrary\.org/b/id/[1-9][0-9]*-L\.jpg\?default=false', remote):
        raise HTTPException(400, 'coverInvalid')
    c.execute('INSERT INTO media_covers VALUES(?,?,?,?,?) ON CONFLICT(media_id) DO UPDATE SET data=excluded.data,mime=excluded.mime,remote=excluded.remote,revision=excluded.revision', (mid, data, mime, remote, str(time.time_ns())))


def embedded(path):
    """Best-effort tag reading must never turn a valid audio upload into a failure."""
    app = base()
    if os.path.splitext(path)[1].lower() == '.webm':
        return {}, None
    try:
        with open(path, 'rb') as f:
            tag = app._probe.TinyTag.get(file_obj=app._probe.Reader(f), tags=True, duration=False, image=True)
        other = tag.other
        first = lambda k: (other.get(k) or [''])[0]
        fields = clean({'title': tag.title, 'creator': tag.artist or tag.albumartist, 'album': tag.album,
                        'category': tag.genre, 'year': tag.year, 'description': tag.comment,
                        'language': first('language'), 'isbn': first('isbn')})
        img = tag.images.front_cover or tag.images.any
        data = img.data if img is not None else None
        if data:
            try: image_type(data)
            except HTTPException: data = None
        return fields, data
    except Exception:
        # Missing, damaged or oversized optional tags do not discard audio.
        return {}, None


def apply_embedded(c, row, tid, tags, cover, filename=''):
    c.execute('INSERT OR REPLACE INTO embedded_tags VALUES(?,?)', (tid, json.dumps(tags, ensure_ascii=False)))
    values = {k:v for k,v in tags.items() if not row[k]}
    # Chapter titles are never used as the title of an entire book. Music
    # titles created from a file name may be replaced by its actual title.
    values.pop('title', None)
    if row['kind']=='music' and row['title']==os.path.splitext(os.path.basename(filename))[0] and tags.get('title'):
        values['title']=tags['title']
    if row['import_mode']:
        values.update({k:v for k,v in tags.items() if k!='title' and v})
        title=tags.get('album') if row['kind']=='books' else tags.get('title')
        if row['kind']=='books' and row['import_mode']=='files':title=title or tags.get('title')
        if title:values['title']=title
        c.execute("UPDATE media SET import_mode='' WHERE id=?",(row['id'],))
    if values:
        write_fields(c,row,values,next(iter(variants(row)),''))
        c.execute("UPDATE media SET metadata_source=CASE WHEN metadata_source='' THEN 'Embedded tags' ELSE metadata_source END WHERE id=?",(row['id'],))
    if cover and not c.execute('SELECT 1 FROM media_covers WHERE media_id=?', (row['id'],)).fetchone():
        set_cover(c, row['id'], cover)


LOCAL_FIELDS = ('title','creator','category','album','description','narrator')


def variants(row):
    try:return json.loads(row['translations'])
    except (ValueError,TypeError,KeyError):return {}


def variant(row, lang):
    data=variants(row)
    return data.get(lang) or data.get('en') or next(iter(data.values()),dict(row))


def write_fields(c, row, values, lang=''):
    if values:c.execute('UPDATE media SET '+','.join(k+'=?' for k in values)+' WHERE id=?',(*values.values(),row['id']))
    if lang:
        data=variants(row)
        entry=dict(data.get(lang) or {k:row[k] for k in LOCAL_FIELDS})
        entry.update({k:v for k,v in values.items() if k in LOCAL_FIELDS})
        data[lang]=entry
        c.execute('UPDATE media SET translations=? WHERE id=?',(json.dumps(data,ensure_ascii=False),row['id']))


def cached(key):
    with base().db() as c:
        row=c.execute('SELECT data FROM metadata_cache WHERE key=? AND expires>?', (key,time.time())).fetchone()
    return json.loads(row['data']) if row else None


def cache(key, data, days=7):
    with base().db() as c:
        c.execute('DELETE FROM metadata_cache WHERE expires<?', (time.time(),))
        c.execute('INSERT OR REPLACE INTO metadata_cache VALUES(?,?,?)', (key,json.dumps(data,ensure_ascii=False),time.time()+days*86400))


async def pace(host):
    with base().db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT next_request FROM metadata_limits WHERE host=?', (host,)).fetchone()
        now=time.time(); when=max(now,row[0] if row else now)
        if when-now>20:
            raise HTTPException(429,'metadataBusy')
        c.execute('INSERT OR REPLACE INTO metadata_limits VALUES(?,?)',(host,when+1.1))
    await asyncio.sleep(max(0,when-time.time()))


def allowed(url, cover=False):
    try:
        u=urlsplit(str(url)); host=(u.hostname or '').lower(); port=u.port
    except ValueError:return False
    hosts=('coverartarchive.org','archive.org') if cover else ('musicbrainz.org','openlibrary.org')
    valid=host in hosts or cover and host.endswith('.archive.org')
    return u.scheme=='https' and valid and not u.username and not u.password and port in (None,443)


async def fetch(url, params=None, cover=False):
    """Bounded HTTP to fixed catalogue hosts; redirects cannot reach local services."""
    async with httpx.AsyncClient(timeout=15,headers={'User-Agent':USER_AGENT,'Accept':'image/*' if cover else 'application/json'},follow_redirects=False) as client:
        for _ in range(5):
            if not allowed(url,cover):
                raise HTTPException(502,'metadataUnavailable')
            host=urlsplit(str(url)).hostname
            await pace(host)
            try:
                async with client.stream('GET',url,params=params) as r:
                    if r.status_code in (301,302,303,307,308):
                        target=str(r.url.join(r.headers.get('location','')))
                        if target.startswith('http://'):target='https://'+target[7:]
                        url=target; params=None; continue
                    if r.status_code==404 and cover:return None
                    if r.status_code in (429,503):raise HTTPException(429,'metadataBusy')
                    if r.status_code!=200:raise HTTPException(502,'metadataUnavailable')
                    data=bytearray()
                    async for part in r.aiter_bytes():
                        if len(data)+len(part)>MAX_IMAGE:raise HTTPException(502,'metadataUnavailable')
                        data.extend(part)
                    if cover:
                        image_type(data)
                        return bytes(data)
                    try:return json.loads(data)
                    except (ValueError,UnicodeError):raise HTTPException(502,'metadataUnavailable')
            except httpx.HTTPError:
                raise HTTPException(502,'metadataUnavailable')
    raise HTTPException(502,'metadataUnavailable')


def quote(value):
    # Treat input as literal text, never as arbitrary Lucene query operators.
    return '"'+re.sub(r'[^\w\s\-\u0080-\uffff]', ' ',value).strip()+'"'


def candidate(provider, kind, ident, fields, url, cover_url=''):
    data=clean(fields)
    data.update(provider=provider,kind=kind,url=url,cover_url=cover_url)
    data['id']=hashlib.sha256((provider+ident+json.dumps(data,sort_keys=True)).encode()).hexdigest()
    cache('candidate:'+data['id'],data)
    return data


async def search(kind, title, creator='', album='', isbn=''):
    title,creator,album,isbn=(str(x).strip()[:200] for x in (title,creator,album,isbn))
    if kind not in ('music','books') or not title and not isbn:
        raise HTTPException(400,'metadataQuery')
    key='search:'+hashlib.sha256(json.dumps([kind,title.casefold(),creator.casefold(),album.casefold(),isbn]).encode()).hexdigest()
    hit=cached(key)
    if hit is not None:return {'results':hit,'cached':True}
    results=[]
    if kind=='music':
        query='recording:'+quote(title)
        if creator:query+=' AND artist:'+quote(creator)
        if album:query+=' AND release:'+quote(album)
        response=await fetch('https://musicbrainz.org/ws/2/recording/',{'query':query,'fmt':'json','limit':5})
        for recording in response.get('recordings',[])[:5]:
            artist=''.join((a.get('name') or a.get('artist',{}).get('name',''))+a.get('joinphrase','') for a in recording.get('artist-credit',[]) if isinstance(a,dict))
            releases=recording.get('releases') or [{}]
            genres=recording.get('genres') or recording.get('tags') or []
            genre=next((x.get('name','') for x in genres if isinstance(x,dict)), '')
            for release in releases[:2]:
                rid=release.get('id',''); recid=recording.get('id','')
                if not re.fullmatch(r'[0-9a-f-]{36}',recid):continue
                art='https://coverartarchive.org/release/'+rid+'/front-500' if re.fullmatch(r'[0-9a-f-]{36}',rid) else ''
                results.append(candidate('MusicBrainz',kind,recid+rid,{'title':recording.get('title',''),'creator':artist,'album':release.get('title',''),'year':release.get('date','')[:4],'category':genre},'https://musicbrainz.org/'+('release/'+rid if art else 'recording/'+recid),art))
    else:
        params={'limit':8,'fields':'key,title,author_name,first_publish_year,cover_i,isbn,language,subject'}
        if isbn:params['isbn']=re.sub(r'[^0-9Xx]','',isbn)
        else:
            params['title']=title
            if creator:params['author']=creator
        response=await fetch('https://openlibrary.org/search.json',params)
        for book in response.get('docs',[])[:8]:
            ident=book.get('key','')
            if not re.fullmatch(r'/works/OL[0-9]+W',ident):continue
            cover_id=book.get('cover_i')
            art=f'https://covers.openlibrary.org/b/id/{cover_id}-L.jpg?default=false' if isinstance(cover_id,int) and cover_id>0 else ''
            results.append(candidate('Open Library','books',ident,{'title':book.get('title',''),'creator':', '.join(book.get('author_name',[])),'category':', '.join(book.get('subject',[])[:2])},'https://openlibrary.org'+ident,art))
    results=results[:8];cache(key,results,days=7 if results else 1)
    return {'results':results,'cached':False}


def checked_fields(fields):
    if not isinstance(fields,list) or any(k not in (*FIELDS,'cover') for k in fields):
        raise HTTPException(400,'invalid')
    return set(fields)


async def apply_candidate(mid, owner, cid, fields, replace=False, lang=''):
    selected=checked_fields(fields)
    data=cached('candidate:'+cid)
    if not data:raise HTTPException(410,'metadataExpired')
    with base().db() as c:
        row=base().owned(c,mid,owner)
        if row['kind']!=data['kind']:raise HTTPException(400,'invalid')
        existing_cover=bool(c.execute('SELECT 1 FROM media_covers WHERE media_id=?',(mid,)).fetchone())
    cover=None
    cover_requested='cover' in selected and (replace or not existing_cover)
    if cover_requested and data.get('cover_url') and data['provider']=='MusicBrainz':
        cover=await fetch(data['cover_url'],cover=True)
    with base().db() as c:
        c.execute('BEGIN IMMEDIATE'); row=base().owned(c,mid,owner)
        current={**dict(row),**variant(row,lang)} if lang else dict(row)
        values={k:v for k,v in clean(data).items() if k in selected and (replace or not current[k])}
        write_fields(c,row,values,lang)
        has=c.execute('SELECT 1 FROM media_covers WHERE media_id=?',(mid,)).fetchone()
        cover_changed=False
        if 'cover' in selected and (replace or not has):
            if cover:set_cover(c,mid,cover);cover_changed=True
            elif data['provider']=='Open Library' and data.get('cover_url'):set_cover(c,mid,remote=data['cover_url']);cover_changed=True
        if values or cover_changed:c.execute('UPDATE media SET metadata_source=?,metadata_url=?,updated=? WHERE id=?',(data['provider'],data['url'],time.time(),mid))
    return {'ok':True,'cover_missing':cover_requested and not cover and data['provider']=='MusicBrainz'}


async def scan_tags(mid, owner, fields, replace=False, lang=''):
    app=base();selected=checked_fields(fields)
    with app.db() as c:
        row=app.owned(c,mid,owner)
        rows=c.execute('SELECT * FROM tracks WHERE media_id=? ORDER BY position,id',(mid,)).fetchall()
    found={}; cover=None
    for track in rows:
        tags,image=await asyncio.to_thread(embedded,os.path.join(app.UPLOADS,track['filename']))
        if row['kind']=='books':
            # M4B album usually identifies the book; title often identifies a chapter.
            tags['title']=tags.get('album') or (tags.get('title','') if len(rows)==1 else '')
        for k,v in tags.items():
            if v and not found.get(k):found[k]=v
        cover=cover or image
        if found and cover:break
    with app.db() as c:
        c.execute('BEGIN IMMEDIATE');current=app.owned(c,mid,owner)
        existing={**dict(current),**variant(current,lang)} if lang else dict(current)
        values={k:v for k,v in clean(found).items() if k in selected and (replace or not existing[k])}
        write_fields(c,current,values,lang)
        changed=bool(values)
        if cover and 'cover' in selected and (replace or not c.execute('SELECT 1 FROM media_covers WHERE media_id=?',(mid,)).fetchone()):set_cover(c,mid,cover);changed=True
        if changed:c.execute("UPDATE media SET metadata_source='Embedded tags',metadata_url='',updated=? WHERE id=?",(time.time(),mid))
    return {'ok':True,'found':bool(found or cover)}
