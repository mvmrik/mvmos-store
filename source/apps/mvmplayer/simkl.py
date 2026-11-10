"""Simkl for mvmPlayer: trending lists, history, details, automatic "watched".

The administrator shares a Simkl client ID through Apps Hub Service keys. Every person then
connects their own Simkl account with a code (Simkl's PIN sign-in), so history and
finished videos always belong to that person. Nothing works while there is no key.

The host is fixed, tokens never reach the browser, replies are cached, and a failed
call never breaks watching. `db` is added by api.py.
"""
import hashlib
import json
import re
import threading
import time

import httpx
from fastapi import HTTPException

HOST = 'https://api.simkl.com'
USER_AGENT = 'mvmPlayer/1.0.0 (https://mvmos.org)'
POSTER = 'https://simkl.in/posters/%s_m.jpg'
SITE = 'https://simkl.com'
FINISHED = 0.9


def setup():
    with db() as c:
        c.execute('CREATE TABLE IF NOT EXISTS simkl_sent (user_id TEXT NOT NULL, media_id TEXT NOT NULL, at REAL NOT NULL, '
                  'ok INTEGER NOT NULL, error TEXT NOT NULL DEFAULT \'\', PRIMARY KEY (user_id, media_id))')
        c.execute('CREATE TABLE IF NOT EXISTS simkl_user (user_id TEXT PRIMARY KEY, token TEXT NOT NULL, at REAL NOT NULL)')
        if 'client_id' not in [r[1] for r in c.execute('PRAGMA table_info(simkl_user)')]:
            c.execute("ALTER TABLE simkl_user ADD COLUMN client_id TEXT NOT NULL DEFAULT ''")


resolver = None  # set by api.py: the key Apps Hub (Service keys) lets this person use


def client_key(user_id):
    """The Simkl client ID the administrator shared with this person in Apps Hub -> Service keys."""
    try:
        return (resolver(user_id) if resolver else '') or ''
    except Exception:
        return ''


def credentials(user_id):
    """{'client_id', 'token'} for this person, or None while they have no Simkl key.
    A sign-in belongs to the key it was made with: after the key changes the person connects again."""
    cid = client_key(user_id)
    if not cid:
        return None
    with db() as c:
        row = c.execute('SELECT token, client_id FROM simkl_user WHERE user_id=?', (user_id,)).fetchone()
    return dict(client_id=cid, token=row[0] if row and row[1] == cid else '')


def save_token(user_id, token, cid):
    with db() as c:
        c.execute('INSERT OR REPLACE INTO simkl_user(user_id, token, at, client_id) VALUES(?,?,?,?)', (user_id, token, time.time(), cid))


def disconnect(user_id):
    with db() as c:
        c.execute('DELETE FROM simkl_user WHERE user_id=?', (user_id,))
        c.execute("DELETE FROM cache WHERE key LIKE 'simkl:history:%' OR key LIKE 'simkl:raw:%'")


def pin_start(cid):
    """Starts the device sign-in: a short code for the person and a device code for polling."""
    try:
        r = httpx.post(HOST + '/oauth2/device', json=dict(client_id=cid), headers={'User-Agent': USER_AGENT}, timeout=20, follow_redirects=False)
        data = r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'simklUnavailable')
    if not isinstance(data, dict): raise HTTPException(502, 'simklUnavailable')
    code = str(data.get('user_code') or '')
    device = str(data.get('device_code') or '')
    url = str(data.get('verification_uri_complete') or data.get('verification_uri') or '')
    if r.status_code >= 400 or not re.fullmatch(r'[A-Za-z0-9-]{3,24}', code) or not re.fullmatch(r'[A-Za-z0-9]{16,128}', device) or not re.match(r'https://(www\.)?simkl\.com/', url):
        raise HTTPException(502, 'simklKey')
    return dict(code=code, device=device, url=url, expires=int(data.get('expires_in') or 900), interval=max(3, int(data.get('interval') or 5)))


def pin_check(cid, device):
    """The access token once the person approved the code, else ''."""
    try:
        r = httpx.post(HOST + '/oauth2/token', json=dict(client_id=cid, device_code=device, grant_type='urn:ietf:params:oauth:grant-type:device_code'), headers={'User-Agent': USER_AGENT}, timeout=20, follow_redirects=False)
        data = r.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'simklUnavailable')
    token = str(data.get('access_token') or '') if isinstance(data, dict) else ''
    return token if re.fullmatch(r'[A-Za-z0-9._-]{8,300}', token) else ''


def call(creds, method, path, params=None, body=None, auth=False):
    if auth and not creds['token']:
        raise HTTPException(403, 'simklNoToken')
    headers = {'User-Agent': USER_AGENT, 'simkl-api-key': creds['client_id'], 'Content-Type': 'application/json'}
    if auth:
        headers['Authorization'] = 'Bearer ' + creds['token']
    query = dict(params or {}, client_id=creds['client_id'], **{'app-name': 'mvmplayer', 'app-version': '1.0'})
    try:
        r = httpx.request(method, HOST + path, params=query, json=body, headers=headers, timeout=20, follow_redirects=False)
    except httpx.HTTPError:
        raise HTTPException(502, 'simklUnavailable')
    if r.status_code in (401, 403):
        raise HTTPException(502, 'simklToken')
    if r.status_code in (412, 400) and 'client_id' in r.text:
        raise HTTPException(502, 'simklKey')
    if r.status_code == 429 or r.status_code >= 500:
        raise HTTPException(502, 'simklUnavailable')
    if r.status_code >= 400:
        raise HTTPException(502, 'simklUnavailable')
    if not r.content:
        return {}
    try:
        return r.json()
    except ValueError:
        raise HTTPException(502, 'simklUnavailable')


def cached(key):
    with db() as c:
        row = c.execute('SELECT data FROM cache WHERE key=? AND expires>?', (key, time.time())).fetchone()
    return json.loads(row[0]) if row else None


def keep(key, data, seconds):
    with db() as c:
        c.execute('DELETE FROM cache WHERE expires<?', (time.time(),))
        c.execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)', (key, json.dumps(data, ensure_ascii=False), time.time() + seconds))


def who(creds):
    return hashlib.sha256((creds['client_id'] + ':' + creds['token']).encode()).hexdigest()[:20]


def norm(text):
    return re.sub(r'[^0-9a-z\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]+', '', (text or '').casefold())


def year_of(item):
    value = str(item.get('year') or '')
    if not value:
        match = re.search(r'(19|20)\d{2}', str(item.get('release_date') or ''))
        value = match[0] if match else ''
    return value[:4]


def rating(item):
    r = item.get('ratings') or {}
    out = {}
    for name in ('simkl', 'imdb'):
        v = (r.get(name) or {}).get('rating')
        if isinstance(v, (int, float)) and 0 < v <= 10:
            out[name] = round(float(v), 1)
    return out


def card(item, kind):
    ids = item.get('ids') or {}
    path = item.get('url') or ''
    poster = item.get('poster') or ''
    return dict(title=str(item.get('title') or '')[:200], year=year_of(item), kind=kind,
                url=SITE + path if path.startswith('/') else '', poster=POSTER % poster if re.fullmatch(r'[\w/]+', poster) else '',
                rank=item.get('rank') or 0, ratings=rating(item), runtime=str(item.get('runtime') or '')[:20],
                overview=str(item.get('overview') or '')[:600], simkl_id=ids.get('simkl_id') or ids.get('simkl') or 0)


def trending(creds, kind):
    path = '/movies/trending' if kind == 'movies' else '/tv/trending'
    key = 'simkl:trending:' + kind
    data = cached(key)
    if data is None:
        raw = call(creds, 'GET', path)
        data = [card(i, 'movie' if kind == 'movies' else 'show') for i in raw[:50]] if isinstance(raw, list) else []
        keep(key, data, 3600)
    return data


def listed(raw, name):
    if isinstance(raw, dict):
        raw = raw.get(name) or []
    return raw if isinstance(raw, list) else []


def history(creds):
    """Finished movies and the shows the profile watches, with progress."""
    key = 'simkl:history:2:' + who(creds)
    data = cached(key)
    if data is not None:
        return data
    movies, shows, plan = [], [], []
    for item in listed(call(creds, 'GET', '/sync/all-items/movies/completed', auth=True), 'movies'):
        m = item.get('movie') or {}
        if m.get('title'):
            movies.append(dict(card(m, 'movie'), watched_at=item.get('last_watched_at') or '', user_rating=item.get('user_rating') or 0))
    for item in raw_shows(creds):
        if item['status'] == 'notinteresting':
            continue
        entry = {k: v for k, v in item.items() if k != 'eps'}
        (plan if item['status'] == 'plantowatch' else shows).append(entry)
    key_date = lambda i: i['watched_at']
    data = dict(movies=sorted(movies, key=key_date, reverse=True)[:300], shows=sorted(shows, key=key_date, reverse=True)[:300],
                plan=sorted(plan, key=lambda i: i['added_at'], reverse=True)[:300])
    keep(key, data, 300)
    return data


def raw_shows(creds):
    """Every show on the person's lists, with status, progress and which episodes are watched."""
    key = 'simkl:raw:' + who(creds)
    data = cached(key)
    if data is not None:
        return data
    data = []
    for item in listed(call(creds, 'GET', '/sync/all-items/shows', dict(extended='full', episode_watched_at='yes'), auth=True), 'shows'):
        s = item.get('show') or {}
        if not s.get('title'):
            continue
        eps = [[int(sea.get('number') or 0), int(e.get('number') or 0)] for sea in item.get('seasons') or [] for e in sea.get('episodes') or []]
        data.append(dict(card(dict(s, url=''), 'show'), url=show_url(s.get('ids')), watched_at=item.get('last_watched_at') or '', added_at=item.get('added_to_watchlist_at') or '',
                         user_rating=item.get('user_rating') or 0, status=item.get('status') or '', watched=int(item.get('watched_episodes_count') or 0),
                         total=int(item.get('total_episodes_count') or 0), next=str(item.get('next_to_watch') or '')[:20], eps=eps))
    keep(key, data, 300)
    return data


def match_library(rows, data):
    """Mark which Simkl titles exist in this library, by name and year."""
    by_movie, by_show = {}, {}
    for r in rows:
        if r['kind'] == 'movie' or r['kind'] == 'video':
            by_movie.setdefault(norm(r['title']), []).append(r)
        elif r['kind'] == 'episode' and r['series']:
            by_show.setdefault(norm(r['series']), []).append(r)
    for item in data.get('movies', []):
        found = by_movie.get(norm(item['title'])) or []
        found = [r for r in found if not r['year'] or not item['year'] or r['year'] == item['year']]
        item['library_id'] = found[0]['id'] if found else ''
    for item in data.get('shows', []) + data.get('plan', []):
        found = by_show.get(norm(item['title'])) or []
        item['library_id'] = found[0]['id'] if found else ''
    return data


def details(creds, row):
    """Simkl's page for one library video: ratings, summary, genres and the link."""
    kind = 'show' if row['kind'] == 'episode' else 'movie'
    title = row['series'] if kind == 'show' else row['title']
    year = '' if kind == 'show' else row['year']
    key = 'simkl:info:' + json.dumps([kind, norm(title), year])
    data = cached(key)
    if data is not None:
        return data or None
    found = call(creds, 'GET', '/search/' + ('tv' if kind == 'show' else 'movie'), dict(q=title, extended='full', limit=10))
    found = found if isinstance(found, list) else []
    best = None
    for item in found:
        if norm(item.get('title')) == norm(title) and (not year or str(item.get('year') or '') == year):
            best = item
            break
    if not best:
        best = next((i for i in found if norm(i.get('title')) == norm(title)), None)
    result = {}
    if best:
        sid = (best.get('ids') or {}).get('simkl_id') or (best.get('ids') or {}).get('simkl')
        full = call(creds, 'GET', '/%s/%s' % ('tv' if kind == 'show' else 'movies', sid), dict(extended='full')) if sid else {}
        full = full if isinstance(full, dict) else {}
        merged = dict(best, **full)
        merged['ids'] = dict(best.get('ids') or {}, **(full.get('ids') or {}))
        slug = (merged['ids'].get('slug') or '')
        merged.setdefault('url', '/%s/%s/%s' % ('tv' if kind == 'show' else 'movies', sid, slug) if sid else '')
        result = card(merged, kind)
        result['genres'] = [str(g)[:40] for g in (merged.get('genres') or [])][:8]
        result['status'] = str(merged.get('status') or '')[:30]
        result['imdb_id'] = str((merged['ids'].get('imdb') or ''))[:20]
        if result['imdb_id'].startswith('tt'):
            result['imdb_url'] = 'https://www.imdb.com/title/' + result['imdb_id'] + '/'
    keep(key, result, 7 * 86400 if result else 3600)
    return result or None


def payload(row, when):
    stamp = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(when))
    if row['kind'] == 'episode' and row['series'] and row['season'] and row['episode']:
        return dict(shows=[dict(title=row['series'], seasons=[dict(number=row['season'], episodes=[dict(number=row['episode'], watched_at=stamp)])])])
    year = int(row['year']) if str(row['year']).isdigit() else None
    movie = dict(title=row['title'], watched_at=stamp)
    if year:
        movie['year'] = year
    return dict(movies=[movie])


def send(creds, user_id, row, when=None):
    """Tell Simkl a video was watched; remember the result so it is sent once."""
    when = when or time.time()
    error = ''
    ok = 1
    try:
        reply = call(creds, 'POST', '/sync/history', body=payload(row, when), auth=True)
        added = (reply or {}).get('added') or {}
        if isinstance(added, dict) and not any(added.get(k) for k in ('movies', 'shows', 'episodes')):
            ok, error = 0, 'simklNotFound'
    except HTTPException as e:
        ok, error = 0, str(e.detail)
    with db() as c:
        c.execute('INSERT OR REPLACE INTO simkl_sent VALUES(?,?,?,?,?)', (user_id, row['id'], when, ok, error))
    return ok, error


def send_later(user, row):
    """Called when a video is finished. Never blocks or breaks the saving of progress."""
    creds = credentials(user['id'])
    if not creds or not creds['token']:
        return
    with db() as c:
        if c.execute('SELECT 1 FROM simkl_sent WHERE user_id=? AND media_id=? AND ok=1', (user['id'], row['id'])).fetchone():
            return
    threading.Thread(target=lambda: send(creds, user['id'], dict(row)), daemon=True).start()


def show_url(ids):
    ids = ids or {}
    sid = ids.get('simkl_id') or ids.get('simkl')
    return '%s/tv/%s/%s' % (SITE, sid, ids.get('slug') or '') if sid else ''


def show_info(creds, sid):
    """One series: its description and every season with its episodes (shared by all people, cached)."""
    key = 'simkl:show:%d' % sid
    data = cached(key)
    if data is not None:
        return data
    full = call(creds, 'GET', '/tv/%d' % sid, dict(extended='full'))
    full = full if isinstance(full, dict) else {}
    if not full.get('title'):
        raise HTTPException(404, 'simklNotFound')
    raw = call(creds, 'GET', '/tv/episodes/%d' % sid, dict(extended='full'))
    seasons = {}
    for e in raw if isinstance(raw, list) else []:
        season, number = e.get('season'), e.get('episode')
        if not isinstance(season, int) or not isinstance(number, int) or season < 0 or number < 1:
            continue
        seasons.setdefault(season, []).append(dict(number=number, title=str(e.get('title') or '')[:200], aired=bool(e.get('aired', True)),
                                                   date=str(e.get('date') or '')[:10], overview=str(e.get('description') or '')[:400]))
    info = card(dict(full, url=''), 'show')
    info.update(url=show_url(full.get('ids')), genres=[str(g)[:40] for g in (full.get('genres') or [])][:8], status=str(full.get('status') or '')[:30],
                simkl_id=sid)
    data = dict(show=info, seasons=[dict(number=n, episodes=sorted(v, key=lambda x: x['number'])) for n, v in sorted(seasons.items())])
    keep(key, data, 86400)
    return data


def show_for(creds, sid):
    """show_info plus this person's status and watched flags."""
    info = show_info(creds, sid)
    mine = next((i for i in raw_shows(creds) if i['simkl_id'] == sid), None)
    done = {(a, b) for a, b in (mine['eps'] if mine else [])}
    seasons = [dict(number=s['number'], episodes=[dict(e, watched=(s['number'], e['number']) in done) for e in s['episodes']]) for s in info['seasons']]
    return dict(show=info['show'], seasons=seasons, status=mine['status'] if mine else '', watched=len(done), tracked=bool(mine))


def forget(creds):
    with db() as c:
        c.execute("DELETE FROM cache WHERE key IN (?,?)", ('simkl:history:2:' + who(creds), 'simkl:raw:' + who(creds)))


def mark(creds, sid, episodes, watched):
    """Mark episodes watched or not on Simkl. `episodes` is a list of [season, episode]."""
    if not episodes:
        return 0
    seasons = {}
    stamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    for season, number in episodes[:2000]:
        e = dict(number=number)
        if watched:
            e['watched_at'] = stamp
        seasons.setdefault(season, []).append(e)
    body = dict(shows=[dict(ids=dict(simkl=sid), seasons=[dict(number=n, episodes=v) for n, v in sorted(seasons.items())])])
    reply = call(creds, 'POST', '/sync/history' if watched else '/sync/history/remove', body=body, auth=True)
    forget(creds)
    if watched:
        added = (reply or {}).get('added') or {}
        if isinstance(added, dict) and not any(added.get(k) for k in ('movies', 'shows', 'episodes')):
            raise HTTPException(502, 'simklNotFound')
    return len(episodes)


def set_plan(creds, sid, on):
    """Put a series on, or take it off, the "plan to watch" list."""
    if on:
        call(creds, 'POST', '/sync/add-to-list', body=dict(shows=[dict(to='plantowatch', ids=dict(simkl=sid))]), auth=True)
    else:
        call(creds, 'POST', '/sync/history/remove', body=dict(shows=[dict(ids=dict(simkl=sid))]), auth=True)
    forget(creds)
