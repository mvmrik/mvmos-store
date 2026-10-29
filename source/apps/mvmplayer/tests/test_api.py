"""Isolated contracts; no live accounts, library, system DB or network needed.

Run: venv/bin/python apps/mvmplayer/tests/test_api.py
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, AsyncMock

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

SOURCE=Path(__file__).resolve().parents[1]
FIXTURE=(SOURCE/'tests/fixtures/sample.webm').read_bytes()


def build():
    temp=tempfile.TemporaryDirectory(prefix='mvmplayer-tests-');root=Path(temp.name)
    shutil.copytree(SOURCE,root,dirs_exist_ok=True,ignore=shutil.ignore_patterns('uploads','*.db*','__pycache__'))
    people={uid:dict(id=uid,language='en') for uid in ('a','b')}
    def desktop(request: Request):
        if request.cookies.get('session')!='admin':raise HTTPException(401,'login')
        return dict(token='admin')
    sys.modules['backend.auth']=types.SimpleNamespace(get_current_session=desktop)
    sys.modules['backend.apphub']=types.SimpleNamespace(get_pub_session=lambda token:people.get(token),is_app_public=lambda _:True,valid_languages=lambda:set(['bg','de','en','es','fr','ja','pt-BR','ru','zh-CN']))
    spec=importlib.util.spec_from_file_location('app_public_mvmplayer',root/'api.py');mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod)
    app=FastAPI();app.include_router(mod.router,prefix='/pub/mvmplayer');app.include_router(mod.desktop_router,prefix='/api/apps/mvmplayer')
    @app.get('/preview')
    def preview(desktop: bool=False):
        html=(root/'public/index.html').read_text().replace('<script src="/i18n/i18n.js"></script>','<script>window.asset=x=>x;</script>')
        html=html.replace("window.MvmPlayer.mount(document.getElementById('mvmplayer-root'),{onNeedLogin(){location.replace('/pub/apphub/?return='+encodeURIComponent(location.href))}})","window.testPlayer=window.MvmPlayer.mount(document.getElementById('mvmplayer-root'),{desktop:"+str(desktop).lower()+"})")
        return HTMLResponse(html)
    @app.put('/test-only/catalogue')
    def mock_catalogue():
        async def fetch(url,params=None,image=False):
            if image:
                import base64
                return base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')
            if url.endswith('/search/shows'):return [dict(show=dict(id=123,name='Example Series',url='https://www.tvmaze.com/shows/123/example',image=None,genres=['Drama'],premiered='2020-01-01',summary='<p>A series description.</p>'))]
            if url.endswith('/episodebynumber'):return dict(season=params['season'],number=params['number'],name=f"Episode {params['number']}",summary=f"<p>Story {params['number']}</p>",airdate='2020-02-05',url='https://www.tvmaze.com/episodes/123/example')
            if url.endswith('/seasons'):return [dict(number=n,episodeOrder=10) for n in range(1,6)]
            if url.endswith('/episodes'):return [dict(id=200+s*10+e,season=s,number=e,name=f'Episode {e}',summary=f'Story {e}',airdate='2020-01-01') for s in range(1,6) for e in range(1,11)]
            return dict(query=dict(pages=[dict(title='Example Movie (2024 film)',index=1,extract='A movie description.',fullurl='https://en.wikipedia.org/wiki/Example',thumbnail={})]))
        mod.catalogue.fetch=fetch
        return dict(ok=True)
    @app.put('/test-only/language')
    def set_language(language: str):
        people['a']['language']=language
        return dict(ok=True)
    app.mount('/apps/mvmplayer',StaticFiles(directory=root/'public'))
    return app,mod,people,temp


class PlayerTests(unittest.TestCase):
    def setUp(self):
        self.app,self.mod,self.people,self.temp=build();self.c=TestClient(self.app);self.c.cookies.set('session','admin')
        self.guard=patch('subprocess.Popen',side_effect=AssertionError('No external processes allowed'));self.guard.start();self.addCleanup(self.guard.stop)
    def tearDown(self):self.c.close();self.temp.cleanup()
    def admin(self,method,path,**kw):return self.c.request(method,'/api/apps/mvmplayer'+path,**kw)
    def pub(self,method,path,user='a',**kw):return self.c.request(method,'/pub/mvmplayer'+path,headers={'X-Pub-Token':user,**kw.pop('headers',{})},**kw)
    def upload(self,name='Example.Series/Season 02/Example.Series.S02E05.webm',data=FIXTURE):
        start=self.admin('POST','/uploads',json={'filename':name,'bytes':len(data)});self.assertEqual(start.status_code,200,start.text);uid=start.json()['id']
        r=self.admin('PUT','/uploads/'+uid+'?offset=0',content=data);self.assertEqual(r.status_code,200,r.text)
        r=self.admin('POST','/uploads/'+uid+'/finish');self.assertEqual(r.status_code,200,r.text)
        return r.json()['id']
    def items(self,user='a'):return self.pub('GET','/library',user).json()['items']
    def test_authentication_and_admin_separation(self):
        mid=self.upload()
        self.assertEqual(self.pub('GET','/library','invalid').status_code,401)
        self.c.cookies.clear()
        self.assertEqual(self.admin('GET','/admin').status_code,401)
        self.assertEqual(self.admin('DELETE','/media/'+mid).status_code,401)
        self.assertEqual(self.pub('GET','/library').status_code,200)
        self.assertEqual(self.pub('POST','/uploads',json={}).status_code,404)
    def test_recognition_folders_and_years(self):
        f=self.mod.recognize
        self.assertEqual(f('Example.Series/Season 02/Example.Series.S02E05.The.Arrival.1080p.webm'),dict(kind='episode',title='The Arrival',series='Example Series',season=2,episode=5,year=''))
        self.assertEqual(f('Example Series/Season 02/S02E05.webm')['series'],'Example Series')
        self.assertEqual(f('Example/Season 02/05 - The Arrival.webm')['episode'],5)
        self.assertEqual(f('Movie.Name.2024.1080p.mp4')['year'],'2024')
        self.assertEqual(f('My lesson.webm')['kind'],'video')
        self.assertEqual(f('Example.2x05.webm')['season'],2)
    def test_upload_retries_are_idempotent(self):
        data=FIXTURE;uid=self.admin('POST','/uploads',json={'filename':'Video.webm','bytes':len(data)}).json()['id']
        cut=len(data)//2
        for _ in range(2):self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset=0',content=data[:cut]).status_code,200)
        self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset=0',content=b'x'*cut).status_code,409)
        self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset='+str(cut),content=data[cut:]).status_code,200)
        ids=[self.admin('POST','/uploads/'+uid+'/finish').json()['id'] for _ in range(3)]
        self.assertEqual(len(set(ids)),1);self.assertEqual(len(self.items()),1)
        self.assertEqual(self.admin('GET','/uploads/'+uid).json()['id'],ids[0])
        self.admin('DELETE','/uploads/'+uid)
        self.assertEqual(len(self.items()),1)
    def test_invalid_uploads_and_private_files(self):
        for name in ['../oops.webm','/secret.mp4','test.svg']:
            self.assertEqual(self.admin('POST','/uploads',json={'filename':name,'bytes':20}).status_code,400)
        uid=self.admin('POST','/uploads',json={'filename':'bad.mp4','bytes':32}).json()['id']
        self.admin('PUT','/uploads/'+uid+'?offset=0',content=b'<script>bad</script>'.ljust(32,b' '))
        self.assertEqual(self.admin('POST','/uploads/'+uid+'/finish').status_code,400)
        self.admin('DELETE','/uploads/'+uid)
        self.assertEqual(len(self.items()),0)
        mid=self.upload();item=self.items()[0]
        self.assertNotIn('filename',item);self.assertNotIn('cover',item)
        self.assertEqual(self.c.get('/apps/mvmplayer/uploads/'+mid+'.webm').status_code,404)
    def test_finish_recovers_renamed_file_after_worker_exit(self):
        uid=self.admin('POST','/uploads',json={'filename':'Recover.webm','bytes':len(FIXTURE)}).json()['id']
        self.admin('PUT','/uploads/'+uid+'?offset=0',content=FIXTURE)
        os.replace(Path(self.mod.UPLOADS)/(uid+'.part'),Path(self.mod.UPLOADS)/(uid+'.webm'))
        r=self.admin('POST','/uploads/'+uid+'/finish');self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['id'],uid);self.assertEqual(len(self.items()),1)
    def test_independent_progress_survives_edits_and_metadata(self):
        mid=self.upload()
        for uid,pos in [('a',5),('b',11)]:
            self.pub('PUT','/media/'+mid+'/state',uid,json={'seconds':pos,'duration':16,'speed':1.25,'favorite':True,'played':True})
        before={uid:self.items(uid)[0]['state'] for uid in ('a','b')}
        body={'kind':'episode','title':'Renamed','series':'Changed Series','season':2,'episode':5,'description':'Updated'}
        self.assertEqual(self.admin('PUT','/media/'+mid,json=body).status_code,200)
        self.c.put('/test-only/catalogue')
        candidate=self.admin('POST','/media/'+mid+'/lookup',json={'query':'Example','language':'en'}).json()['results'][0]
        self.assertEqual(self.admin('POST','/media/'+mid+'/lookup/apply',json={'candidate':candidate['id'],'fields':['series','description','cover'],'series_group':True}).status_code,200)
        for uid in ('a','b'):self.assertEqual(self.items(uid)[0]['state'],before[uid])
        self.assertEqual(self.items()[0]['title'],'Renamed')
        self.assertEqual(self.items()[0]['series'],'Example Series')
        self.assertEqual(self.items()[0]['show_id'],123)
    def test_state_validation_and_completion(self):
        mid=self.upload()
        for values in [{'seconds':-1},{'seconds':float('inf')},{'speed':10},{'duration':0}]:
            if values.get('seconds')==float('inf'):continue
            self.assertEqual(self.pub('PUT','/media/'+mid+'/state',json=values).status_code,422)
        self.pub('PUT','/media/'+mid+'/state',json={'seconds':999,'duration':16})
        self.assertEqual(self.items()[0]['state']['seconds'],16)
        self.pub('PUT','/media/'+mid+'/state',json={'completed':True})
        self.assertEqual(self.items()[0]['percent'],100)
        self.pub('PUT','/media/'+mid+'/state',json={'favorite':True})
        self.assertTrue(self.items()[0]['state']['completed'])
        self.assertFalse(self.items('b')[0]['state']['favorite'])
    def test_range_tickets_revocation_and_no_profile_token_in_url(self):
        mid=self.upload();info=self.pub('POST','/media/'+mid+'/ticket').json()
        self.assertNotIn('apphub',info['url']);self.assertEqual(self.c.get('/pub/mvmplayer/stream/'+mid).status_code,401)
        r=self.c.get(info['url'],headers={'Range':'bytes=10-25'});self.assertEqual(r.status_code,206,r.text);self.assertEqual(r.content,FIXTURE[10:26])
        self.assertEqual(self.c.head(info['url']).status_code,200)
        self.assertIn('no-store',r.headers['cache-control'])
        del self.people['a'];self.assertEqual(self.c.get(info['url']).status_code,401)
    def test_subtitles_converted_sanitized_and_deleted(self):
        mid=self.upload();srt='1\n00:00:01,000 --> 00:00:03,000\n<b>Здравей</b> <script>bad</script>\n'
        r=self.admin('POST','/media/'+mid+'/subtitles?language=bg&title=Bulgarian',content=srt.encode('cp1251'));self.assertEqual(r.status_code,200,r.text);sid=r.json()['id']
        r=self.pub('GET','/media/'+mid+'/subtitles/'+sid);self.assertIn('WEBVTT',r.text);self.assertIn('00:00:01.000',r.text);self.assertNotIn('<script>',r.text);self.assertIn('Здравей',r.text)
        self.assertEqual(self.admin('POST','/media/'+mid+'/subtitles',content=b'not timed text').status_code,400)
        self.assertEqual(self.pub('GET','/media/'+mid+'/subtitles/'+sid,'invalid').status_code,401)
        self.assertEqual(self.admin('DELETE','/media/'+mid+'/subtitles/'+sid).status_code,200)
        self.assertEqual(self.pub('GET','/media/'+mid+'/subtitles/'+sid).status_code,404)
    def test_private_collections_and_cascade(self):
        a=self.upload('A.webm');b=self.upload('B.webm')
        pid=self.pub('POST','/collections',json={'title':'Evening','items':[b,a]}).json()['id']
        self.assertEqual(self.pub('GET','/library').json()['collections'][0]['items'],[b,a])
        self.assertEqual(self.pub('GET','/library','b').json()['collections'],[])
        self.assertEqual(self.pub('PUT','/collections/'+pid,'b',json={'title':'Stolen','items':[a]}).status_code,404)
        self.assertEqual(self.pub('DELETE','/collections/'+pid,'b').status_code,404)
        self.admin('DELETE','/media/'+a)
        self.assertEqual(self.pub('GET','/library').json()['collections'][0]['items'],[b])
    def test_delete_removes_file_cover_subtitles_and_everyones_state(self):
        mid=self.upload();self.c.put('/test-only/catalogue')
        candidate=self.admin('POST','/media/'+mid+'/lookup',json={'query':'Series','language':'en'}).json()['results'][0]
        # Inject a trusted source image URL into the cached fixture.
        candidate['cover']='https://static.tvmaze.com/uploads/images/original_untouched/1/1.jpg';self.mod.catalogue.cache('candidate:'+candidate['id'],candidate)
        self.admin('POST','/media/'+mid+'/lookup/apply',json={'candidate':candidate['id'],'fields':['cover']})
        self.admin('POST','/media/'+mid+'/subtitles',content=b'1\n00:00:01,000 --> 00:00:02,000\nHello\n')
        for uid in ('a','b'):self.pub('PUT','/media/'+mid+'/state',uid,json={'seconds':3,'duration':16})
        ticket=self.pub('POST','/media/'+mid+'/ticket').json()['url']
        self.assertEqual(self.pub('GET','/media/'+mid+'/cover').status_code,200)
        self.admin('DELETE','/media/'+mid)
        self.assertEqual(self.items(),[]);self.assertFalse((Path(self.mod.UPLOADS)/(mid+'.webm')).exists())
        with self.mod.db() as c:
            for table in ['state','subtitles','tickets']:self.assertEqual(c.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
        self.assertEqual(self.c.get(ticket).status_code,401)
    def test_series_catalogue_and_optional_movie_suggestions(self):
        mid=self.upload();self.c.put('/test-only/catalogue')
        result=self.admin('POST','/media/'+mid+'/lookup',json={'query':'Example','language':'en'});self.assertEqual(result.status_code,200,result.text)
        candidate=result.json()['results'][0]
        self.admin('POST','/media/'+mid+'/lookup/apply',json={'candidate':candidate['id'],'fields':['series','description']})
        remote=self.pub('GET','/series/'+mid).json();self.assertEqual(len(remote['seasons']),5);self.assertEqual(len(remote['episodes']),50)
        movie=self.upload('Example.Movie.2024.webm')
        result=self.admin('POST','/media/'+movie+'/lookup',json={'query':'Example Movie','language':'bg'}).json()['results'][0]
        self.assertEqual(result['source'],'Wikipedia')
        self.assertEqual(self.admin('POST','/media/'+movie+'/lookup/apply',json={'candidate':result['id'],'fields':['filename']}).status_code,400)
        self.assertEqual(self.admin('POST','/media/'+movie+'/lookup',json={'query':'Example','language':'xx'}).status_code,400)
    def test_catalogue_fixed_hosts(self):
        allowed=self.mod.catalogue.allowed
        for url in ['http://api.tvmaze.com/','https://127.0.0.1/','https://api.tvmaze.com.evil.org/','https://api.tvmaze.com:8443/','https://user:pass@api.tvmaze.com/']:
            self.assertFalse(allowed(url))
        self.assertTrue(allowed('https://api.tvmaze.com/shows/1'))
        self.assertFalse(allowed('https://en.wikipedia.org/',image=True))
        self.assertTrue(allowed('https://upload.wikimedia.org/test.jpg',image=True))

    def test_optional_cover_failure_keeps_text_and_manual_cover(self):
        mid=self.upload('Example.Movie.2024.webm')
        import base64
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')
        self.assertEqual(self.admin('PUT','/media/'+mid+'/cover',content=png).status_code,200)
        self.assertEqual(self.admin('PUT','/media/'+mid+'/cover',content=b'<svg>unsafe</svg>').status_code,400)
        self.c.put('/test-only/catalogue')
        candidate=self.admin('POST','/media/'+mid+'/lookup',json={'query':'Example','language':'en'}).json()['results'][0]
        candidate['cover']='https://upload.wikimedia.org/missing.jpg';self.mod.catalogue.cache('candidate:'+candidate['id'],candidate)
        self.mod.catalogue.fetch=AsyncMock(side_effect=HTTPException(502,'catalogueUnavailable'))
        r=self.admin('POST','/media/'+mid+'/lookup/apply',json={'candidate':candidate['id'],'fields':['description','cover']})
        self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['cover_missing'])
        self.assertEqual(self.items()[0]['description'],'A movie description.')
        self.assertEqual(self.pub('GET','/media/'+mid+'/cover').content,png)

    def test_lookup_checks_exact_episode_ranks_matches_and_separates_cache(self):
        mid=self.upload();calls=[]
        async def fetch(url,params=None,image=False):
            calls.append((url,dict(params or {})))
            if url.endswith('/search/shows'):
                return [dict(show=dict(id=n,name='Same Title',url=f'https://www.tvmaze.com/shows/{n}/same',premiered=f'{year}-01-01',image=None,genres=[],summary='',network={'name':network,'country':{'name':'Country'}})) for n,year,network in [(1,1990,'Old Network'),(2,2020,'New Network')]]
            if '/shows/1/episodebynumber' in url:return None
            return dict(season=params['season'],number=params['number'],name=f"Matching episode {params['number']}",summary='Exact story',airdate='2021-04-05')
        self.mod.catalogue.fetch=fetch
        results=self.admin('POST','/media/'+mid+'/lookup',json={'query':'Same Title','language':'en'}).json()['results']
        self.assertEqual([r['show_id'] for r in results],[2,1])
        self.assertEqual(results[0]['episode']['title'],'Matching episode 5')
        self.assertEqual(results[0]['episode']['airdate'],'2021-04-05')
        self.assertEqual(results[0]['network'],'New Network')
        self.assertEqual(results[1]['episode']['status'],'missing')
        count=len(calls)
        self.admin('POST','/media/'+mid+'/lookup',json={'query':'Same Title','language':'en'})
        self.assertEqual(len(calls),count)
        other=self.upload('Example.Series.S02E06.webm')
        results=self.admin('POST','/media/'+other+'/lookup',json={'query':'Same Title','language':'en'}).json()['results']
        self.assertEqual(results[0]['episode']['number'],6)
        self.assertGreater(len(calls),count)

    def test_episode_fields_apply_per_episode_and_preserve_progress(self):
        a=self.upload();b=self.upload('Example.Series.S02E06.webm');missing=self.upload('Example.Series.S02E99.webm')
        self.c.put('/test-only/catalogue')
        for uid in ('a','b'):self.pub('PUT','/media/'+a+'/state',uid,json={'seconds':7,'duration':16,'played':True})
        before={uid:self.items(uid)[-1]['state'] for uid in ('a','b')}
        candidate=self.admin('POST','/media/'+a+'/lookup',json={'query':'Example','language':'en'}).json()['results'][0]
        r=self.admin('POST','/media/'+a+'/lookup/apply',json={'candidate':candidate['id'],'fields':['series','episode_title','episode_description'],'series_group':True})
        self.assertEqual(r.status_code,200,r.text)
        items={i['id']:i for i in self.items()}
        self.assertEqual((items[a]['title'],items[a]['description']),('Episode 5','Story 5'))
        self.assertEqual((items[b]['title'],items[b]['description']),('Episode 6','Story 6'))
        self.assertNotEqual(items[missing]['title'],'Episode 5')
        for uid in ('a','b'):
            state=next(i['state'] for i in self.items(uid) if i['id']==a)
            self.assertEqual(state,before[uid])
        # A candidate verified for E05 must never rename E06 using E05 data.
        self.assertEqual(self.admin('POST','/media/'+b+'/lookup/apply',json={'candidate':candidate['id'],'fields':['episode_title']}).status_code,400)


if __name__=='__main__':
    if '--serve' in sys.argv:
        import uvicorn
        app,mod,people,temp=build()
        try:uvicorn.run(app,host='127.0.0.1',port=2088,log_level='warning')
        finally:temp.cleanup()
    else:unittest.main()
