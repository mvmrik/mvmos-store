"""Keyless, opt-in provider suggestions with fixed hosts and local caching.

TVmaze provides series structure (CC BY-SA); Wikipedia supplies article-based
movie suggestions, which may be incomplete. Keep original source attribution.
Provider descriptions are untrusted text and never rendered as HTML.
"""
import asyncio
import hashlib
import html
import json
import re
import time
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

WIKIS={'bg':'bg','de':'de','en':'en','es':'es','fr':'fr','ja':'ja','pt-BR':'pt','ru':'ru','zh-CN':'zh'}
USER_AGENT='mvmPlayer/1.0.0 (https://mvmos.org)'


def cached(key):
    with db() as c:
        row=c.execute('SELECT data FROM cache WHERE key=? AND expires>?',(key,time.time())).fetchone()
    return json.loads(row[0]) if row else None


def cache(key,data,days=7):
    with db() as c:
        c.execute('DELETE FROM cache WHERE expires<?',(time.time(),))
        c.execute('INSERT OR REPLACE INTO cache VALUES(?,?,?)',(key,json.dumps(data,ensure_ascii=False),time.time()+days*86400))


def allowed(url,image=False):
    try:
        u=urlsplit(str(url))
        hosts={'static.tvmaze.com','upload.wikimedia.org'} if image else {'api.tvmaze.com',*[code+'.wikipedia.org' for code in WIKIS.values()]}
        return u.scheme=='https' and u.hostname in hosts and u.port in (None,443) and not u.username and not u.password
    except ValueError:return False


async def pace(host):
    with db() as c:
        c.execute('BEGIN IMMEDIATE')
        row=c.execute('SELECT next_request FROM limits WHERE host=?',(host,)).fetchone()
        when=max(time.time(),row[0] if row else 0)
        if when-time.time()>15:raise HTTPException(429,'catalogueBusy')
        c.execute('INSERT OR REPLACE INTO limits VALUES(?,?)',(host,when+0.6))
    await asyncio.sleep(max(0,when-time.time()))


async def fetch(url,params=None,image=False):
    async with httpx.AsyncClient(timeout=20,follow_redirects=False,headers={'User-Agent':USER_AGENT}) as client:
        for _ in range(4):
            if not allowed(url,image):raise HTTPException(502,'catalogueUnavailable')
            await pace(urlsplit(str(url)).hostname)
            try:
                async with client.stream('GET',url,params=params) as response:
                    if response.status_code in (301,302,303,307,308):
                        url=str(response.url.join(response.headers.get('location','')));params=None;continue
                    if response.status_code==404 and (image or urlsplit(str(url)).path.endswith('/episodebynumber')):return None
                    if response.status_code in (429,503):raise HTTPException(429,'catalogueBusy')
                    response.raise_for_status()
                    data=bytearray();limit=3*1024**2 if image else 12*1024**2
                    async for part in response.aiter_bytes():
                        if len(data)+len(part)>limit:raise HTTPException(502,'catalogueUnavailable')
                        data.extend(part)
                    if image:return bytes(data)
                    result=json.loads(data)
                    if isinstance(result,dict) and result.get('error'):raise HTTPException(502,'catalogueUnavailable')
                    return result
            except (httpx.HTTPError,ValueError):raise HTTPException(502,'catalogueUnavailable')
    raise HTTPException(502,'catalogueUnavailable')


def plain(value):
    return html.unescape(re.sub(r'<[^>]*>','',value or '')).strip()[:10000]


def candidate(data):
    data['id']=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()[:32]
    cache('candidate:'+data['id'],data)
    return data


async def search(row,query,language):
    season,number=int(row.get('season',0)),int(row.get('episode',0))
    key='search:v2:'+json.dumps([row['kind'],query.casefold(),language,season,number])
    result=cached(key)
    if result is not None:
        for item in result:cache('candidate:'+item['id'],item)
        return result
    if row['kind']=='episode':
        response=await fetch('https://api.tvmaze.com/search/shows',{'q':query})
        result=[]
        matches=response[:8]
        exacts=await asyncio.gather(*(episode(int(match['show']['id']),season,number) for match in matches)) if number else [dict(status='unavailable') for _ in matches]
        for match,exact in zip(matches,exacts):
            show=match['show'];cover=(show.get('image') or {}).get('original','')
            network=show.get('network') or show.get('webChannel') or {}
            country=network.get('country') or {}
            result.append(candidate(dict(title=show['name'][:250],description=plain(show.get('summary')),category=', '.join(show.get('genres',[]))[:250],year=(show.get('premiered') or '')[:4],
                cover=cover if allowed(cover,True) else '',source='TVmaze',url=show['url'],show_id=int(show['id']),
                premiered=show.get('premiered') or '',ended=show.get('ended') or '',network=network.get('name',''),country=country.get('name',''),
                language=show.get('language',''),episode=exact)))
        result.sort(key=lambda item: {'found':0,'unavailable':1,'missing':2}.get(item['episode']['status'],1))
    else:
        code=WIKIS[language]
        params={'action':'query','generator':'search','gsrsearch':query,'gsrnamespace':0,'gsrlimit':6,
                'prop':'extracts|pageimages|info','exintro':1,'explaintext':1,'exsentences':5,
                'piprop':'thumbnail','pithumbsize':600,'pilimit':6,'inprop':'url','format':'json','formatversion':2}
        response=await fetch('https://'+code+'.wikipedia.org/w/api.php',params)
        result=[]
        for page in sorted(response.get('query',{}).get('pages',[]),key=lambda p:p.get('index',100)):
            cover=page.get('thumbnail',{}).get('source','');title=page['title']
            year=re.search(r'\b((?:19|20)\d{2})\b',title)
            title=re.sub(r'\s*\([^)]*\)\s*$','',title)
            result.append(candidate(dict(title=title[:250],description=plain(page.get('extract')),category='',year=year[1] if year else '',
                cover=cover if allowed(cover,True) else '',source='Wikipedia',url=page.get('fullurl',''),show_id=0)))
    cache(key,result)
    return result


async def episode(show_id,season,number):
    key=f'episode:{show_id}:{season}:{number}'
    result=cached(key)
    if result is not None:return result
    try:
        data=await fetch(f'https://api.tvmaze.com/shows/{show_id}/episodebynumber',{'season':season,'number':number})
    except HTTPException:
        return dict(status='unavailable',season=season,number=number)
    if data is None:
        result=dict(status='missing',season=season,number=number)
    elif data.get('season')==season and data.get('number')==number:
        result=dict(status='found',season=season,number=number,title=data.get('name','')[:250],description=plain(data.get('summary')),airdate=data.get('airdate') or '',url=data.get('url') or '')
    else:
        return dict(status='unavailable',season=season,number=number)
    cache(key,result,1)
    return result


async def show(show_id):
    if not isinstance(show_id,int) or show_id<=0:return dict(seasons=[],episodes=[])
    key='show:'+str(show_id);result=cached(key)
    if result is not None:return result
    seasons=await fetch(f'https://api.tvmaze.com/shows/{show_id}/seasons')
    episodes=await fetch(f'https://api.tvmaze.com/shows/{show_id}/episodes',{'specials':1})
    result=dict(seasons=[dict(number=s.get('number'),episodes=s.get('episodeOrder'),premiere=s.get('premiereDate')) for s in seasons],
        episodes=[dict(id=e['id'],season=e.get('season'),number=e.get('number'),title=e.get('name',''),description=plain(e.get('summary')),airdate=e.get('airdate','')) for e in episodes],source='TVmaze',url=f'https://www.tvmaze.com/shows/{show_id}')
    cache(key,result,1)
    return result
