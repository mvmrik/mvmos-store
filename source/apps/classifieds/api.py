"""Classifieds: shared marketplace with Apps Hub ownership and desktop administration."""
import os
import sys
import time
import uuid
import sqlite3
from contextlib import contextmanager
from fastapi import APIRouter, Depends, Header, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

APP_ID = 'classifieds'
ROOT = os.path.dirname(__file__)
DB_PATH = os.path.join(ROOT, 'data.db')
UPLOADS = os.path.join(ROOT, 'uploads')
DAY = 86400
MAX_PHOTOS = 10
MAX_BYTES = 5 * 1024 * 1024
# Matches the regional selector in frontend/settings.js. Core exposes only the
# selected currency through Platform API, not its option catalog.
CURRENCIES = ('EUR','USD','GBP','CHF','JPY','CNY','TRY','UAH','PLN','RON','CZK','HUF','CAD','AUD','SEK','NOK','DKK','RUB','INR','BTC')

def hub():
    return sys.modules['backend.apphub']

def _premium():
    prem = sys.modules.get('backend.premium')
    return prem.load_premium_backend(APP_ID) if prem else None

@contextmanager
def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.create_function('casefold', 1, lambda text: str(text).casefold(), deterministic=True)
    c.execute('PRAGMA foreign_keys=ON')
    try:
        with c:
            yield c
    finally:
        c.close()

with db() as c:
    c.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), validity_days INTEGER NOT NULL DEFAULT 30, currency TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO settings(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL, parent_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT);
    CREATE UNIQUE INDEX IF NOT EXISTS category_names ON categories(COALESCE(parent_id,0),name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS listings(
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        price_cents INTEGER NOT NULL, currency TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1, created_at REAL NOT NULL, updated_at REAL NOT NULL,
        sort_at REAL NOT NULL, expires_at REAL NOT NULL, last_bump_at REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS listings_public ON listings(active, sort_at DESC);
    CREATE INDEX IF NOT EXISTS listings_owner ON listings(owner_id,sort_at DESC);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE, filename TEXT NOT NULL, created_at REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS photos_listing ON photos(listing_id,created_at);
    -- One row per (listing, viewer, day): a plain COUNT(*) is the view count,
    -- and the primary key is what keeps a refresh or a bot loop from
    -- inflating it — at most one counted view per viewer per listing per day.
    CREATE TABLE IF NOT EXISTS listing_views(
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        viewer TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY(listing_id,viewer,day));
    CREATE INDEX IF NOT EXISTS listing_views_listing ON listing_views(listing_id);
    CREATE TABLE IF NOT EXISTS watches(
        listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(listing_id,user_id));
    CREATE INDEX IF NOT EXISTS watches_user ON watches(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS watches_listing ON watches(listing_id);
    ''')
    if 'vip_until' not in {r['name'] for r in c.execute("PRAGMA table_info(listings)")}:
        c.execute('ALTER TABLE listings ADD COLUMN vip_until REAL NOT NULL DEFAULT 0')

# A crash between deleting a listing's DB row and unlinking its photo files
# (delete()) leaves orphaned files on disk — harmless but wasted space, and
# with no cron job in this app to sweep them later. Reconcile once per
# process start instead: cheap, and catches whatever the last run missed.
def _gc_uploads():
    if not os.path.isdir(UPLOADS):
        return
    with db() as c:
        keep = {row[0] for row in c.execute('SELECT filename FROM photos')}
    for name in os.listdir(UPLOADS):
        if name not in keep:
            try: os.unlink(os.path.join(UPLOADS, name))
            except OSError: pass
_gc_uploads()

async def access(request: Request):
    if hub().is_app_public(APP_ID):
        return
    auth = sys.modules['backend.auth']
    if auth.get_current_session_optional(request):
        return
    raise HTTPException(403, 'private')

router = APIRouter(dependencies=[Depends(access)])
desktop_router = APIRouter()

def user(token):
    me = hub().get_pub_session(token)
    if not me:
        raise HTTPException(401, 'login_required')
    return me

def _client_key(request):
    """Use a proxy address only when the immediate peer is local."""
    peer = request.client.host if request.client else 'unknown'
    if peer in {'127.0.0.1', '::1'}:
        forwarded = request.headers.get('x-forwarded-for', '').split(',')[0].strip()
        if forwarded: return forwarded[:128]
        real_ip = request.headers.get('x-real-ip', '').strip()
        if real_ip: return real_ip[:128]
    return peer[:128]

def own(c, lid, me):
    row = c.execute('SELECT * FROM listings WHERE id=? AND owner_id=?', (lid, me['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'not_found')
    return row

def settings(c):
    result = dict(c.execute('SELECT validity_days,currency FROM settings WHERE id=1').fetchone())
    platform = sys.modules.get('backend.platform_api')
    regional = platform.get_settings().get('currency', 'EUR') if platform else 'EUR'
    if regional not in CURRENCIES: regional = 'EUR'
    result['default_currency'] = result['currency']
    result['system_currency'] = regional
    result['currencies'] = list(CURRENCIES)
    result['currency'] = result['currency'] or regional
    return result

def checked_currency(value, c):
    currency = value or settings(c)['currency']
    if currency not in CURRENCIES: raise HTTPException(400, 'invalid_currency')
    return currency

def output(c, row, me=None):
    d = dict(row)
    d['status'] = 'inactive' if not d['active'] else ('expired' if d['expires_at'] <= time.time() else 'active')
    d['owned'] = bool(me and me['id'] == d['owner_id'])
    d['vip'] = d['vip_until'] > time.time()
    d['watched'] = bool(me and not d['owned'] and c.execute('SELECT 1 FROM watches WHERE listing_id=? AND user_id=?', (d['id'], me['id'])).fetchone())
    # View and watcher counts are the owner's own stats, never shown to anyone
    # else — the visitor side of "watching" is just the watched flag above.
    if d['owned']:
        d['views'] = c.execute('SELECT COUNT(*) FROM listing_views WHERE listing_id=?', (d['id'],)).fetchone()[0]
        d['watchers_count'] = c.execute('SELECT COUNT(*) FROM watches WHERE listing_id=?', (d['id'],)).fetchone()[0]
    d['bump_available_at'] = d['last_bump_at'] + DAY
    d['photos'] = [{'id': p['id'], 'url': f"/pub/classifieds/photos/{p['id']}"} for p in c.execute('SELECT id FROM photos WHERE listing_id=? ORDER BY created_at,id', (d['id'],))]
    profiles = hub().get_users_by_ids([d.pop('owner_id')])
    d['seller'] = (profiles[0].get('display_name') or profiles[0].get('username') or '') if profiles else ''
    return d

@router.get('/')
async def index():
    return FileResponse(os.path.join(ROOT, 'public', 'index.html'))

@router.get('/config')
async def config():
    with db() as c:
        result = {**settings(c), 'categories': [dict(r) for r in c.execute('SELECT * FROM categories ORDER BY name COLLATE NOCASE')]}
    # No mention of premium here on purpose — the public page either has VIP
    # packages to offer or it doesn't; there is nothing to upsell to a visitor
    # whose account has nothing to do with this installation's own licence.
    prem = _premium()
    result['vip_packages'] = prem.list_packages(active_only=True) if prem and prem.is_available() else []
    return result

@router.get('/listings')
async def listing_list(mine: bool = False, watched: bool = False, q: str = Query('', max_length=160), category: int = 0,
                       free: bool = False, min_price: int = Query(0, ge=0), max_price: int | None = Query(None, ge=0),
                       status: str = 'all', currency: str = '', offset: int = Query(0, ge=0), x_pub_token: str | None = Header(None)):
    me = user(x_pub_token) if (mine or watched) else hub().get_pub_session(x_pub_token)
    clauses, params = [], []
    now = time.time()
    if mine:
        clauses.append('owner_id=?'); params.append(me['id'])
        if status == 'active': clauses.append('active=1 AND expires_at>?'); params.append(now)
        elif status == 'expired': clauses.append('active=1 AND expires_at<=?'); params.append(now)
        elif status == 'inactive': clauses.append('active=0')
    elif watched:
        clauses.append('id IN (SELECT listing_id FROM watches WHERE user_id=?)'); params.append(me['id'])
    else:
        clauses.append('active=1 AND expires_at>?'); params.append(now)
    if q.strip():
        clauses.append('(instr(casefold(title),casefold(?))>0 OR instr(casefold(description),casefold(?))>0)'); params.extend([q.strip(), q.strip()])
    if category:
        clauses.append('(category_id=? OR category_id IN (SELECT id FROM categories WHERE parent_id=?))'); params.extend([category, category])
    if free: clauses.append('price_cents=0')
    if currency and currency not in CURRENCIES: raise HTTPException(400,'invalid_currency')
    # Price comparisons always operate within a single currency.
    with db() as c:
        if (min_price or max_price is not None) and not currency: currency = settings(c)['currency']
    if currency: clauses.append('currency=?'); params.append(currency)
    clauses.append('price_cents>=?'); params.append(min_price)
    if max_price is not None: clauses.append('price_cents<=?'); params.append(max_price)
    where = ' AND '.join(clauses)
    with db() as c:
        total = c.execute('SELECT COUNT(*) FROM listings WHERE ' + where, params).fetchone()[0]
        # VIP listings (an active premium purchase) sort first, both in the
        # overall feed and within a category, ahead of the normal recency order.
        rows = c.execute('SELECT * FROM listings WHERE ' + where + ' ORDER BY (vip_until>?) DESC,sort_at DESC,id DESC LIMIT 24 OFFSET ?', [*params, now, offset]).fetchall()
        return {'items': [output(c, r, me) for r in rows], 'total': total}

@router.get('/listings/{lid}')
async def detail(lid: str, request: Request, x_pub_token: str | None = Header(None)):
    me = hub().get_pub_session(x_pub_token)
    with db() as c:
        row = c.execute('SELECT * FROM listings WHERE id=?', (lid,)).fetchone()
        if not row or ((not row['active'] or row['expires_at'] <= time.time()) and (not me or row['owner_id'] != me['id'])):
            raise HTTPException(404, 'not_found')
        if not (me and me['id'] == row['owner_id']):
            viewer = me['id'] if me else 'ip:' + _client_key(request)
            day = time.strftime('%Y-%m-%d', time.gmtime())
            c.execute('INSERT OR IGNORE INTO listing_views(listing_id,viewer,day) VALUES(?,?,?)', (lid, viewer, day))
        result = output(c, row, me)
        if result['owned']:
            ids = [w['user_id'] for w in c.execute('SELECT user_id FROM watches WHERE listing_id=? ORDER BY created_at DESC', (lid,))]
            profiles = {p['id']: p.get('display_name') or p.get('username') or '' for p in hub().get_users_by_ids(ids)}
            result['watchers'] = [{'id': i, 'name': profiles.get(i, '')} for i in ids]
        return result

class ListingBody(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    description: str = Field(min_length=1, max_length=10000)
    category_id: int
    price_cents: int = Field(ge=0, le=99999999999)
    currency: str | None = None
    location: str = Field('', max_length=160)
    contact: str = Field('', max_length=250)

    @field_validator('title', 'description')
    @classmethod
    def nonblank(cls, value):
        if not value.strip(): raise ValueError('required')
        return value.strip()

def check_category(c, cid):
    if not c.execute('SELECT 1 FROM categories WHERE id=?', (cid,)).fetchone():
        raise HTTPException(400, 'category_required')

@router.post('/listings', status_code=201)
async def create(body: ListingBody, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    now, lid = time.time(), uuid.uuid4().hex
    with db() as c:
        check_category(c, body.category_id)
        cfg = settings(c)
        c.execute('INSERT INTO listings(id,owner_id,title,description,category_id,price_cents,currency,location,contact,active,created_at,updated_at,sort_at,expires_at,last_bump_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)',
                  (lid, me['id'], body.title, body.description, body.category_id, body.price_cents, checked_currency(body.currency,c), body.location, body.contact,
                   now, now, now, now + cfg['validity_days'] * DAY, now))
    return {'id': lid}

@router.put('/listings/{lid}')
async def edit(lid: str, body: ListingBody, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        row = own(c, lid, me); check_category(c, body.category_id)
        c.execute('UPDATE listings SET title=?,description=?,category_id=?,price_cents=?,currency=?,location=?,contact=?,updated_at=? WHERE id=?',
                  (body.title,body.description,body.category_id,body.price_cents,checked_currency(body.currency or row['currency'],c),body.location,body.contact,time.time(),lid))
    return {'ok': True}

@router.post('/listings/{lid}/actions/{action}')
async def action(lid: str, action: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = own(c,lid,me)
        now = time.time()
        if action == 'bump':
            if not row['active'] or row['expires_at'] <= now: raise HTTPException(409,'inactive_listing')
            if row['last_bump_at'] + DAY > now: raise HTTPException(429,'bump_wait')
            c.execute('UPDATE listings SET sort_at=?,last_bump_at=?,updated_at=? WHERE id=?', (now,now,now,lid))
        elif action == 'activate':
            expiry = row['expires_at'] if row['expires_at'] > now else now + settings(c)['validity_days'] * DAY
            c.execute('UPDATE listings SET active=1,expires_at=?,updated_at=? WHERE id=?', (expiry,now,lid))
        elif action == 'deactivate':
            c.execute('UPDATE listings SET active=0,updated_at=? WHERE id=?', (now,lid))
        else: raise HTTPException(404,'not_found')
    return {'ok':True}

@router.post('/listings/{lid}/watch', status_code=201)
async def watch(lid: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        row = c.execute('SELECT owner_id FROM listings WHERE id=?', (lid,)).fetchone()
        if not row: raise HTTPException(404, 'not_found')
        if row['owner_id'] == me['id']: raise HTTPException(400, 'watch_self')
        c.execute('INSERT OR IGNORE INTO watches(listing_id,user_id,created_at) VALUES(?,?,?)', (lid, me['id'], time.time()))
    return {'ok': True}

@router.delete('/listings/{lid}/watch')
async def unwatch(lid: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        c.execute('DELETE FROM watches WHERE listing_id=? AND user_id=?', (lid, me['id']))
    return {'ok': True}

@router.post('/listings/{lid}/watchers/{uid}/conversation')
async def message_watcher(lid: str, uid: str, x_pub_token: str | None = Header(None)):
    """The seller reaching out first — e.g. to offer a watcher a discount —
    instead of waiting for them to message in. Same conversations table and
    UNIQUE(listing_id,buyer_id) as the buyer-initiated flow below; only who
    initiates differs, so both sides land in the same thread either way."""
    me = user(x_pub_token)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = own(c, lid, me)
        if not c.execute('SELECT 1 FROM watches WHERE listing_id=? AND user_id=?', (lid, uid)).fetchone():
            raise HTTPException(404, 'not_found')
        old = c.execute('SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?', (lid, uid)).fetchone()
        if old: return {'id': old['id']}
        cid, now = uuid.uuid4().hex, time.time()
        c.execute('INSERT INTO conversations(id,listing_id,listing_title,buyer_id,seller_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                  (cid, lid, row['title'], uid, me['id'], now, now))
    return {'id': cid}

class VipBody(BaseModel):
    package_id: str
    client_id: str = Field(min_length=16, max_length=64, pattern=r'^[a-zA-Z0-9-]+$')

@router.post('/listings/{lid}/vip')
async def purchase_vip(lid: str, body: VipBody, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    prem = _premium()
    if not prem or not prem.is_available():
        raise HTTPException(402, 'premium_required')
    with db() as c:
        own(c, lid, me)
    try:
        vip_until = prem.buy_vip(me['id'], lid, body.package_id, f'classifieds-vip-{body.client_id}')
    except KeyError:
        raise HTTPException(400, 'package_not_found')
    except prem.InsufficientCredits:
        raise HTTPException(402, 'insufficient_credits')
    return {'vip_until': vip_until}

@router.delete('/listings/{lid}')
async def delete(lid: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        own(c,lid,me)
        files = [p[0] for p in c.execute('SELECT filename FROM photos WHERE listing_id=?',(lid,))]
        c.execute('DELETE FROM listings WHERE id=?',(lid,))
    for name in files:
        try: os.unlink(os.path.join(UPLOADS,name))
        except FileNotFoundError: pass
    return {'ok':True}

def image_ext(data):
    if data.startswith(b'\xff\xd8\xff'): return 'jpg'
    if data.startswith(b'\x89PNG\r\n\x1a\n'): return 'png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP': return 'webp'
    raise HTTPException(400,'image_type')

@router.post('/listings/{lid}/photos', status_code=201)
async def upload(lid: str, file: UploadFile = File(...), x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c: own(c,lid,me)
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if len(data) > MAX_BYTES: raise HTTPException(413,'image_size')
    ext = image_ext(data)
    pid = uuid.uuid4().hex
    name = pid + '.' + ext
    os.makedirs(UPLOADS,exist_ok=True)
    path = os.path.join(UPLOADS,name)
    try:
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            own(c,lid,me)
            if c.execute('SELECT COUNT(*) FROM photos WHERE listing_id=?',(lid,)).fetchone()[0] >= MAX_PHOTOS: raise HTTPException(400,'image_limit')
            with open(path,'wb') as f: f.write(data)
            c.execute('INSERT INTO photos VALUES(?,?,?,?)',(pid,lid,name,time.time()))
    except Exception:
        if os.path.exists(path): os.unlink(path)
        raise
    return {'id':pid}

@router.get('/photos/{pid}')
async def photo(pid: str, x_pub_token: str | None = Header(None)):
    me = hub().get_pub_session(x_pub_token)
    with db() as c:
        p = c.execute('SELECT p.filename,l.active,l.expires_at,l.owner_id FROM photos p JOIN listings l ON l.id=p.listing_id WHERE p.id=?',(pid,)).fetchone()
        if not p or ((not p['active'] or p['expires_at'] <= time.time()) and (not me or p['owner_id'] != me['id'])): raise HTTPException(404,'not_found')
    return FileResponse(os.path.join(UPLOADS,p['filename']), headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})

@router.delete('/listings/{lid}/photos/{pid}')
async def remove_photo(lid: str, pid: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        own(c,lid,me)
        p = c.execute('SELECT filename FROM photos WHERE id=? AND listing_id=?',(pid,lid)).fetchone()
        if not p: raise HTTPException(404,'not_found')
        c.execute('DELETE FROM photos WHERE id=?',(pid,))
    try: os.unlink(os.path.join(UPLOADS,p['filename']))
    except FileNotFoundError: pass
    return {'ok':True}

class SettingsBody(BaseModel):
    validity_days: int = Field(ge=1,le=3650)
    currency: str = ''

    @field_validator('currency')
    @classmethod
    def valid_currency(cls, value):
        if value and value not in CURRENCIES: raise ValueError('invalid_currency')
        return value

@desktop_router.get('/settings')
async def admin_settings():
    return await config()

@desktop_router.put('/settings')
async def save_settings(body: SettingsBody):
    with db() as c:
        c.execute('UPDATE settings SET validity_days=?,currency=? WHERE id=1',(body.validity_days,body.currency))
    return {'ok':True}

# VIP packages: the control below always exists in desktop Settings (per the
# store premium convention) — mutating it is refused server-side without an
# active core Premium licence, same posture as Apps Hub credits. The listing
# never needs to know why the list is empty or a save was refused; the
# desktop's own premium modal (via window.mvmOS.premiumGate) explains that.
@desktop_router.get('/vip-packages')
async def vip_packages_list():
    prem = _premium()
    available = bool(prem and prem.is_available())
    return {'premium': available, 'items': prem.list_packages() if prem else []}

class VipPackageBody(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    days: int = Field(ge=1, le=3650)
    price_credits: int = Field(ge=0, le=1000000)
    active: bool = True

@desktop_router.post('/vip-packages', status_code=201)
async def vip_package_create(body: VipPackageBody):
    prem = _premium()
    if not prem or not prem.is_available(): raise HTTPException(402, 'premium_required')
    return prem.save_package(body.name, body.days, body.price_credits, active=body.active)

@desktop_router.put('/vip-packages/{pid}')
async def vip_package_edit(pid: str, body: VipPackageBody):
    prem = _premium()
    if not prem or not prem.is_available(): raise HTTPException(402, 'premium_required')
    try:
        return prem.save_package(body.name, body.days, body.price_credits, pid=pid, active=body.active)
    except KeyError:
        raise HTTPException(404, 'not_found')

@desktop_router.delete('/vip-packages/{pid}')
async def vip_package_delete(pid: str):
    prem = _premium()
    if not prem or not prem.is_available(): raise HTTPException(402, 'premium_required')
    prem.delete_package(pid)
    return {'ok': True}

class CategoryBody(BaseModel):
    name: str = Field(min_length=1,max_length=80)
    parent_id: int | None = None

async def category_save(body, cid=None):
    name = body.name.strip()
    if not name: raise HTTPException(400,'category_required')
    try:
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            if cid and not c.execute('SELECT 1 FROM categories WHERE id=?',(cid,)).fetchone(): raise HTTPException(404,'not_found')
            if body.parent_id:
                p = c.execute('SELECT * FROM categories WHERE id=?',(body.parent_id,)).fetchone()
                if not p or p['parent_id'] or body.parent_id == cid: raise HTTPException(400,'category_depth')
                if cid and c.execute('SELECT 1 FROM categories WHERE parent_id=?',(cid,)).fetchone(): raise HTTPException(400,'category_depth')
            if cid: c.execute('UPDATE categories SET name=?,parent_id=? WHERE id=?',(name,body.parent_id,cid))
            else: cid=c.execute('INSERT INTO categories(name,parent_id) VALUES(?,?)',(name,body.parent_id)).lastrowid
    except sqlite3.IntegrityError: raise HTTPException(409,'category_duplicate')
    return {'id':cid}

@desktop_router.post('/categories', status_code=201)
async def add_category(body: CategoryBody): return await category_save(body)

@desktop_router.put('/categories/{cid}')
async def edit_category(cid: int, body: CategoryBody): return await category_save(body,cid)

@desktop_router.delete('/categories/{cid}')
async def delete_category(cid: int):
    try:
        with db() as c:
            if not c.execute('DELETE FROM categories WHERE id=?',(cid,)).rowcount: raise HTTPException(404,'not_found')
    except sqlite3.IntegrityError: raise HTTPException(409,'category_used')
    return {'ok':True}

# Conversations retain their listing title after deletion. Only the two participants
# can read or send messages; the desktop session grants no inbox access.
with db() as c:
    c.executescript('''
    CREATE TABLE IF NOT EXISTS conversations(
        id TEXT PRIMARY KEY, listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
        listing_title TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        buyer_read_at REAL NOT NULL DEFAULT 0, seller_read_at REAL NOT NULL DEFAULT 0,
        UNIQUE(listing_id,buyer_id));
    CREATE INDEX IF NOT EXISTS conversations_buyer ON conversations(buyer_id,updated_at DESC);
    CREATE INDEX IF NOT EXISTS conversations_seller ON conversations(seller_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL,
        client_id TEXT NOT NULL, UNIQUE(sender_id,client_id));
    CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id,created_at);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,id);
    ''')

def participant(c, cid, me):
    row = c.execute('SELECT * FROM conversations WHERE id=? AND (buyer_id=? OR seller_id=?)',(cid,me['id'],me['id'])).fetchone()
    if not row: raise HTTPException(404,'not_found')
    return row

@router.post('/listings/{lid}/conversation')
async def start_conversation(lid: str, x_pub_token: str | None = Header(None)):
    me = user(x_pub_token)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row = c.execute('SELECT * FROM listings WHERE id=? AND active=1 AND expires_at>?',(lid,time.time())).fetchone()
        if not row: raise HTTPException(404,'not_found')
        if row['owner_id'] == me['id']: raise HTTPException(400,'message_self')
        old = c.execute('SELECT id FROM conversations WHERE listing_id=? AND buyer_id=?',(lid,me['id'])).fetchone()
        if old: return {'id':old['id']}
        cid,now=uuid.uuid4().hex,time.time()
        c.execute('INSERT INTO conversations(id,listing_id,listing_title,buyer_id,seller_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                  (cid,lid,row['title'],me['id'],row['owner_id'],now,now))
    return {'id':cid}

@router.get('/conversations')
async def conversations(offset: int = Query(0,ge=0), x_pub_token: str | None = Header(None)):
    me=user(x_pub_token)
    with db() as c:
        rows=c.execute('SELECT * FROM conversations WHERE buyer_id=? OR seller_id=? ORDER BY updated_at DESC,id LIMIT 50 OFFSET ?', (me['id'],me['id'],offset)).fetchall()
        result=[]
        ids={r['seller_id'] if r['buyer_id']==me['id'] else r['buyer_id'] for r in rows}
        profiles={p['id']:p.get('display_name') or p.get('username') or '' for p in hub().get_users_by_ids(list(ids))}
        unread_total=c.execute('''SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id
          WHERE m.sender_id!=? AND ((c.buyer_id=? AND m.created_at>c.buyer_read_at) OR (c.seller_id=? AND m.created_at>c.seller_read_at))''',(me['id'],me['id'],me['id'])).fetchone()[0]
        total=c.execute('SELECT COUNT(*) FROM conversations WHERE buyer_id=? OR seller_id=?',(me['id'],me['id'])).fetchone()[0]
        for row in rows:
            peer=row['seller_id'] if row['buyer_id']==me['id'] else row['buyer_id']
            read_at=row['buyer_read_at'] if row['buyer_id']==me['id'] else row['seller_read_at']
            unread=c.execute('SELECT COUNT(*) FROM messages WHERE conversation_id=? AND sender_id!=? AND created_at>?',(row['id'],me['id'],read_at)).fetchone()[0]
            last=c.execute('SELECT body FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1',(row['id'],)).fetchone()
            result.append({'id':row['id'],'listing_id':row['listing_id'],'listing_title':row['listing_title'],'peer':profiles.get(peer,''),'unread':unread,'preview':last['body'][:100] if last else '', 'updated_at':row['updated_at']})
    return {'items':result,'unread':unread_total,'total':total}

@router.get('/conversations/{cid}/messages')
async def messages(cid: str, before: int = Query(0,ge=0), after: int = Query(0,ge=0), x_pub_token: str | None = Header(None)):
    me=user(x_pub_token)
    with db() as c:
        conversation=participant(c,cid,me)
        if after:
            rows=c.execute('SELECT * FROM messages WHERE conversation_id=? AND id>? ORDER BY id LIMIT 51',(cid,after)).fetchall()
        else:
            rows=c.execute('SELECT * FROM messages WHERE conversation_id=? AND (?=0 OR id<?) ORDER BY id DESC LIMIT 51',(cid,before,before)).fetchall()
        more=len(rows)>50
        rows=rows[:50] if after else list(reversed(rows[:50]))
        return {'items':[{'id':r['id'],'body':r['body'],'mine':r['sender_id']==me['id'],'created_at':r['created_at']} for r in rows],
                'more':more,'listing_title':conversation['listing_title'],'listing_id':conversation['listing_id']}

class ReadBody(BaseModel):
    message_id: int = Field(ge=0)

@router.post('/conversations/{cid}/read')
async def read_messages(cid: str, body: ReadBody, x_pub_token: str | None = Header(None)):
    me=user(x_pub_token)
    with db() as c:
        row=participant(c,cid,me)
        message=c.execute('SELECT created_at FROM messages WHERE id=? AND conversation_id=?',(body.message_id,cid)).fetchone()
        if message:
            col='buyer_read_at' if row['buyer_id']==me['id'] else 'seller_read_at'
            c.execute(f'UPDATE conversations SET {col}=MAX({col},?) WHERE id=?',(message['created_at'],cid))
    return {'ok':True}

class MessageBody(BaseModel):
    body: str = Field(min_length=1,max_length=4000)
    client_id: str = Field(min_length=16,max_length=64,pattern=r'^[a-zA-Z0-9-]+$')

    @field_validator('body')
    @classmethod
    def nonblank(cls,value):
        if not value.strip(): raise ValueError('required')
        return value.strip()

@router.post('/conversations/{cid}/messages', status_code=201)
async def send_message(cid: str, body: MessageBody, x_pub_token: str | None = Header(None)):
    me=user(x_pub_token)
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        participant(c,cid,me)
        previous=c.execute('SELECT id,conversation_id FROM messages WHERE sender_id=? AND client_id=?',(me['id'],body.client_id)).fetchone()
        if previous:
            if previous['conversation_id']!=cid: raise HTTPException(409,'error')
            return {'id':previous['id']}
        now=time.time()
        count=c.execute('SELECT COUNT(*) FROM messages WHERE sender_id=? AND created_at>?',(me['id'],now-60)).fetchone()[0]
        if count>=30: raise HTTPException(429,'message_rate')
        mid=c.execute('INSERT INTO messages(conversation_id,sender_id,body,created_at,client_id) VALUES(?,?,?,?,?)',(cid,me['id'],body.body,now,body.client_id)).lastrowid
        c.execute('UPDATE conversations SET updated_at=? WHERE id=?',(now,cid))
    return {'id':mid}
