"""Contract tests with isolated files and three fictional Apps Hub profiles.

Run: venv/bin/python apps/mvmaudio/tests/test_api.py
No live account, library, subscription or platform database is changed.
"""
import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch, AsyncMock
import wave

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, Response
from fastapi.testclient import TestClient

SOURCE = Path(__file__).resolve().parents[1]


def audio_bytes(seconds=12):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(8000)
        f.writeframes(b'\x00\x00' * (8000 * seconds))
    return buf.getvalue()


def build():
    temp = tempfile.TemporaryDirectory(prefix='mvmaudio-tests-')
    root = Path(temp.name)
    shutil.copytree(SOURCE, root, dirs_exist_ok=True, ignore=shutil.ignore_patterns('uploads', '*.db*', '__pycache__'))
    enabled = {'premium': True}
    people = {x: {'id': x, 'username': 'listener_'+x, 'display_name': 'Listener '+x.upper()} for x in ['a', 'b', 'c']}
    hub = types.SimpleNamespace(get_pub_session=lambda token: people.get(token), is_app_public=lambda _: True,
        search_users=lambda q, uid: [u for k,u in people.items() if k != uid and q.lower() in (u['username']+' '+u['display_name']).lower()],
        get_users_by_ids=lambda ids: [people[x] for x in ids if x in people])
    def session(request: Request):
        if request.cookies.get('session') != 'admin':
            raise HTTPException(401)
        return {'token':'admin', 'effective_user':'root'}
    sys.modules['backend.auth'] = types.SimpleNamespace(get_current_session=session)
    sys.modules['backend.apphub'] = hub
    spec = importlib.util.spec_from_file_location('app_public_mvmaudio', root/'api.py')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    pspec = importlib.util.spec_from_file_location('test_audio_premium', root/'premium/backend.py')
    p = importlib.util.module_from_spec(pspec)
    pspec.loader.exec_module(p)
    sys.modules['backend.premium'] = types.SimpleNamespace(is_premium=lambda:enabled['premium'],load_premium_backend=lambda _:p if enabled.get('module',True) else None)
    app = FastAPI()
    app.include_router(mod.router, prefix='/pub/mvmaudio')
    app.include_router(mod.desktop_router,prefix='/api/apps/mvmaudio')
    @app.put('/test-only/premium')
    def test_premium(value: bool):
        enabled['premium'] = value
        return {'premium':value}
    @app.put('/test-only/catalogue')
    def test_catalogue():
        import base64
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')
        async def fetch(url,params=None,cover=False):
            if cover:return png
            if 'openlibrary.org' in url:return {'docs':[{'key':'/works/OL123W','title':'Catalogue Book','author_name':['Catalogue Author'],'subject':['Fiction'],'cover_i':123,'first_publish_year':1890}]}
            return {'recordings':[{'id':'11111111-1111-1111-1111-111111111111','title':'Catalogue Song','artist-credit':[{'name':'Catalogue Artist'}],'tags':[{'name':'Jazz'}],'releases':[{'id':'22222222-2222-2222-2222-222222222222','title':'Catalogue Album','date':'2022-01-01'}]}]}
        mod._metadata.fetch=fetch
        return {'ok':True}
    @app.get('/preview')
    def preview(desktop: bool = False):
        html = (root/'public/index.html').read_text().replace('<script src="/i18n/i18n.js"></script>', '<script>window.asset=x=>x;</script>')
        html = html.replace("window.MvmAudio.mount(document.getElementById('mvmaudio-root'),{onNeedLogin(){location.replace('/pub/apphub/?return='+encodeURIComponent(location.href))}})", "window.testPlayer=window.MvmAudio.mount(document.getElementById('mvmaudio-root'),{desktop:"+str(desktop).lower()+"})")
        return HTMLResponse(html)
    app.mount('/apps/mvmaudio', StaticFiles(directory=root/'public'))
    return app, mod, enabled, temp


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.process_guard = patch('subprocess.Popen', side_effect=AssertionError('Audio uploads must not start external processes'))
        self.path_guard = patch.dict(os.environ, {'PATH': ''})
        self.process_guard.start()
        self.path_guard.start()
        self.addCleanup(self.process_guard.stop)
        self.addCleanup(self.path_guard.stop)
        self.app,self.mod,self.enabled,self.temp=build()
        self.client=TestClient(self.app)
        self.client.cookies.set('session','admin')
    def tearDown(self):
        self.client.close()
        self.temp.cleanup()
    def pub(self,method,path,user='a',**kw):
        return self.client.request(method,'/pub/mvmaudio'+path,headers={'X-Pub-Token':user,**kw.pop('headers',{})},**kw)
    def admin(self,method,path,**kw):
        return self.client.request(method,'/api/apps/mvmaudio'+path,**kw)
    def create(self,kind='books',personal=False,**extra):
        body={'kind':kind,'title':'Example '+kind,**extra}
        r=self.pub('POST','/media',json=body) if personal else self.admin('POST','/media',json=body)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()['id']
    def upload(self,mid,personal=False,name='01.wav',data=None):
        content=audio_bytes() if data is None else data
        path='/media/'+mid+'/tracks?filename='+name
        r=self.pub('POST',path,content=content) if personal else self.admin('POST',path,content=content)
        return r
    def items(self,user='a'):
        return self.pub('GET','/library',user).json()['items']
    def test_rename_preserves_every_listeners_progress(self):
        mid=self.create()
        tid=self.upload(mid).json()['id']
        for user,seconds in [('a',4),('b',9)]:
            self.assertEqual(self.pub('PUT','/media/'+mid+'/state',user,json={'track_id':tid,'seconds':seconds,'speed':1.5,'favorite':True,'played':True}).status_code,200)
        before={user:self.items(user)[0]['state'] for user in ['a','b']}
        self.assertEqual(self.admin('PUT','/media/'+mid,json={'kind':'books','title':'Renamed book','creator':'Edited author'}).status_code,200)
        for user in ['a','b']:
            item=self.items(user)[0]
            self.assertEqual(item['title'],'Renamed book')
            self.assertEqual(item['state'],before[user])
            self.assertEqual(item['tracks'][0]['id'],tid)

    def test_multilingual_media_edit_metadata_and_progress(self):
        entries={'bg':{'title':'Възпламеняване','creator':'Сюзан Колинс','category':'Фантастика'},'en':{'title':'Catching Fire','creator':'Suzanne Collins'},'de':{'title':'Gefährliche Liebe','creator':'Suzanne Collins'}}
        mid=self.create(title='Възпламеняване',translations=entries)
        tid=self.upload(mid).json()['id']
        for user,pos in [('a',2),('b',7)]:self.pub('PUT','/media/'+mid+'/state',user,json={'track_id':tid,'seconds':pos})
        item=self.items()[0]
        self.assertEqual(item['translations']['en']['title'],'Catching Fire')
        self.assertEqual(len(self.pub('GET','/library').json()['languages']),9)
        # Applying selected German fields never replaces Bulgarian or English names.
        result=self.mod._metadata.candidate('Open Library','books','/works/OL123W',{'title':'German result','creator':'Online author'},'https://openlibrary.org/works/OL123W','https://covers.openlibrary.org/b/id/123-L.jpg?default=false')
        body={'candidate_id':result['id'],'fields':['title','cover'],'overwrite':True,'lang':'de'}
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json=body).status_code,200)
        item=self.items()[0]
        self.assertEqual(item['translations']['de']['title'],'German result')
        self.assertEqual(item['translations']['bg']['title'],'Възпламеняване')
        self.assertEqual(item['translations']['en']['title'],'Catching Fire')
        self.assertEqual(item['translations']['de']['creator'],'Suzanne Collins')
        result2=self.mod._metadata.candidate('Open Library','books','/works/OL124W',{'title':'Other book'},'https://openlibrary.org/works/OL124W','https://covers.openlibrary.org/b/id/124-L.jpg?default=false')
        body['candidate_id']=result2['id'];body['fields']=['cover']
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json=body).status_code,200)
        self.assertIn('/124-L.jpg',self.items()[0]['cover_url'])
        for user,pos in [('a',2),('b',7)]:self.assertEqual(self.items(user)[0]['state']['seconds'],pos)
        self.assertEqual(self.pub('POST','/media/'+mid+'/metadata/apply',user='b',json=body).status_code,404)
        for invalid in [{'xx':{'title':'Bad'}},{'en':{'title':''}},{'en':{'title':'Fine','owner':'b'}}]:
            self.assertEqual(self.admin('PUT','/media/'+mid,json={'kind':'books','title':'Fine','translations':invalid}).status_code,400)
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json={**body,'lang':'xx'}).status_code,400)
        del entries['de']
        self.admin('PUT','/media/'+mid,json={'kind':'books','title':'Възпламеняване','translations':entries})
        self.assertEqual(set(self.items()[0]['translations']),{'bg','en'})
        self.assertEqual(self.items('b')[0]['state']['seconds'],7)

    def test_embedded_tags_fill_initial_language_variant(self):
        mid=self.create('music',title='tone',translations={'de':{'title':'tone'},'en':{'title':'English title'}})
        result=self.upload(mid,name='tone.mp3',data=(SOURCE/'tests/fixtures/tone.mp3').read_bytes())
        self.assertEqual(result.status_code,200,result.text)
        item=self.items()[0]
        self.assertEqual(item['translations']['de']['title'],'Fixture Tone')
        self.assertEqual(item['translations']['de']['creator'],'Test Artist')
        self.assertEqual(item['translations']['en']['title'],'English title')

    def test_optional_original_book_names(self):
        mid=self.create(title='Възпламеняване',creator='Сюзан Колинс',original_title='Catching Fire',original_creator='Suzanne Collins')
        tid=self.upload(mid).json()['id']
        self.pub('PUT','/media/'+mid+'/state',json={'track_id':tid,'seconds':5})
        item=self.items()[0]
        self.assertEqual(item['original_title'],'Catching Fire')
        self.assertEqual(item['original_creator'],'Suzanne Collins')
        # Older clients omitting these fields must preserve them.
        self.admin('PUT','/media/'+mid,json={'kind':'books','title':'Възпламеняване','creator':'Сюзан Колинс'})
        self.assertEqual(self.items()[0]['original_title'],'Catching Fire')
        with patch.object(self.mod._metadata,'fetch',AsyncMock(return_value={'docs':[]})) as fetch:
            r=self.admin('POST','/media/'+mid+'/metadata/search',json={})
            self.assertEqual(r.status_code,200)
            self.assertEqual(fetch.call_args.args[1]['title'],'Catching Fire')
            self.assertEqual(fetch.call_args.args[1]['author'],'Suzanne Collins')
        self.admin('PUT','/media/'+mid,json={'kind':'books','title':'Възпламеняване','creator':'Сюзан Колинс','original_title':'','original_creator':''})
        item=self.items()[0]
        self.assertEqual(item['original_title'],'')
        self.assertEqual(item['state']['seconds'],5)

    def test_admin_statistics_progress_groups_storage_and_privacy(self):
        book=self.create(title='Common book',translations={'en':{'title':'Common book'},'bg':{'title':'Обща книга'}})
        first=self.upload(book).json()['id'];second=self.upload(book,name='02.wav').json()['id']
        song=self.create('music',title='Common song');song_track=self.upload(song).json()['id']
        radio=self.create('radio',title='Common radio',url='https://example.org/radio')
        untouched=self.create(title='Not played');self.upload(untouched)
        self.pub('PUT','/media/'+book+'/state','a',json={'track_id':second,'seconds':6,'speed':1.5,'played':True})
        self.pub('PUT','/media/'+book+'/state','b',json={'completed':True})
        self.pub('PUT','/media/'+untouched+'/state','c',json={'favorite':True})
        self.pub('PUT','/media/'+song+'/state','a',json={'track_id':song_track,'seconds':2,'played':True})
        self.pub('PUT','/media/'+radio+'/state','b',json={'played':True})
        self.admin('PUT','/settings',json={'upload_limit_mb':2})
        private=self.create(personal=True,title='Private upload');private_track=self.upload(private,personal=True).json()['id']
        self.pub('PUT','/media/'+private+'/state',json={'track_id':private_track,'seconds':8,'played':True})
        self.enabled['module']=False
        stats=self.admin('GET','/statistics').json()
        item=next(i for i in stats['items'] if i['id']==book)
        self.assertEqual(item['listener_count'],2);self.assertEqual(item['completed_count'],1)
        self.assertEqual(item['in_progress'],1);self.assertFalse(item['ready'])
        reader=next(r for r in item['readers'] if r['user_id']=='a')
        self.assertEqual(reader['percent'],75);self.assertEqual(reader['chapter'],2);self.assertEqual(reader['remaining'],4)
        self.assertEqual(item['bytes'],len(audio_bytes())*2)
        self.assertEqual(self.admin('GET','/statistics/users?q=listener_b').json()[0]['id'],'b')
        self.assertEqual(stats['summary']['listeners'],2)
        self.assertEqual(stats['summary']['active_week'],2)
        self.assertNotIn(private,{i['id'] for i in stats['items']})
        self.assertFalse(next(i for i in stats['items'] if i['id']==untouched)['ready'])
        self.assertEqual(next(i for i in stats['items'] if i['id']==untouched)['listener_count'],0)
        self.assertEqual({r['media_id'] for r in stats['activity']},{book,song,radio})
        # A selected not-started reader prevents a review recommendation.
        self.assertEqual(self.admin('PUT','/statistics/media/'+book+'/readers',json={'user_ids':['b','c']}).status_code,200)
        item=next(i for i in self.admin('GET','/statistics').json()['items'] if i['id']==book)
        self.assertEqual(item['cohort_count'],2);self.assertEqual(item['cohort_completed'],1);self.assertFalse(item['ready']);self.assertEqual(item['average_percent'],50)
        self.pub('PUT','/media/'+book+'/state','c',json={'completed':True})
        stats=self.admin('GET','/statistics').json();item=next(i for i in stats['items'] if i['id']==book)
        self.assertTrue(item['ready']);self.assertEqual(stats['summary']['ready_bytes'],item['bytes'])
        # Recommendations never remove files or overwrite another reader's position.
        self.assertEqual(next(i for i in self.items('a') if i['id']==book)['state']['seconds'],6)
        self.assertEqual(self.admin('PUT','/statistics/media/'+book+'/readers',json={'user_ids':['unknown']}).status_code,400)
        self.assertEqual(self.admin('PUT','/statistics/media/'+private+'/readers',json={'user_ids':['a']}).status_code,404)
        self.assertEqual(self.admin('PUT','/statistics/media/'+song+'/readers',json={'user_ids':['a']}).status_code,400)
        self.admin('PUT','/statistics/media/'+book+'/readers',json={'user_ids':[]})
        item=next(i for i in self.admin('GET','/statistics').json()['items'] if i['id']==book)
        self.assertEqual(item['cohort_count'],3);self.assertFalse(item['ready'])
        self.assertEqual(self.pub('GET','/statistics').status_code,404)
        self.assertEqual(self.pub('PUT','/statistics/media/'+book+'/readers',json={'user_ids':[]}).status_code,404)
        self.client.cookies.clear()
        self.assertEqual(self.admin('GET','/statistics').status_code,401)
        self.assertEqual(self.admin('PUT','/statistics/media/'+book+'/readers',json={'user_ids':[]}).status_code,401)

    def test_file_first_import_metadata_and_safe_cleanup(self):
        data,png=self.tagged_mp3()
        mid=self.create(title='1106600',import_mode='files',translations={'bg':{'title':'1106600','creator':'Filename guess'}})
        tid=self.upload(mid,name='1106600.mp3',data=data).json()['id']
        item=next(i for i in self.items() if i['id']==mid)
        self.assertEqual(item['title'],'Tagged Book')
        self.assertEqual(item['creator'],'Tagged Author')
        self.assertEqual(item['translations']['bg']['title'],'Tagged Book')
        self.assertEqual(item['translations']['bg']['creator'],'Tagged Author')
        self.assertTrue(item['has_cover']);self.assertEqual(item['import_mode'],'')
        self.assertFalse(self.admin('DELETE','/imports/'+mid).json()['removed'])
        self.assertEqual(self.pub('DELETE','/imports/'+mid).status_code,404)
        grouped=self.create(title='Chapter 01',import_mode='chapters')
        self.upload(grouped,name='01.mp3',data=data);self.upload(grouped,name='02.mp3',data=data)
        self.assertEqual(next(i for i in self.items() if i['id']==grouped)['title'],'Tagged Book')
        self.assertEqual(len(next(i for i in self.items() if i['id']==grouped)['tracks']),2)
        self.pub('PUT','/media/'+mid+'/state',json={'track_id':tid,'seconds':.3})
        self.admin('PUT','/media/'+mid,json={'kind':'books','title':'My reviewed title'})
        self.upload(mid,name='new-chapter.mp3',data=data)
        self.assertEqual(next(i for i in self.items() if i['id']==mid)['title'],'My reviewed title')
        self.assertEqual(next(i for i in self.items() if i['id']==mid)['state']['seconds'],.3)
        no_album=self.create(title='Opening',import_mode='chapters')
        with patch.object(self.mod._metadata,'embedded',return_value=({'title':'Chapter title','creator':'Author'},None)):
            self.upload(no_album,name='01.mp3',data=data)
        self.assertEqual(next(i for i in self.items() if i['id']==no_album)['title'],'Opening')
        empty=self.create(title='Bad import',import_mode='files')
        started=self.admin('POST','/media/'+empty+'/uploads',json={'filename':'bad.mp3','bytes':10}).json()['id']
        self.admin('PUT','/uploads/'+started+'?offset=0',content=b'0123456789')
        self.assertTrue(self.admin('DELETE','/imports/'+empty).json()['removed'])
        with self.mod.db() as c:self.assertFalse(c.execute('SELECT 1 FROM chunk_uploads WHERE id=?',(started,)).fetchone())
        self.assertFalse((Path(self.temp.name)/'uploads'/(started+'.mp3')).exists())
        manual=self.create(title='Manual empty')
        self.assertFalse(self.admin('DELETE','/imports/'+manual).json()['removed'])
        self.assertEqual(self.admin('POST','/media',json={'kind':'books','title':'Bad','import_mode':'invalid'}).status_code,400)
        # Personal imports use the existing Premium quota and ownership checks.
        self.assertEqual(self.pub('POST','/media',json={'kind':'music','title':'Own','import_mode':'files'}).status_code,403)
        self.admin('PUT','/settings',json={'upload_limit_mb':1})
        personal=self.create('music',personal=True,title='Own',import_mode='files')
        self.assertEqual(self.pub('DELETE','/imports/'+personal,user='b').status_code,404)
        self.assertTrue(self.pub('DELETE','/imports/'+personal).json()['removed'])

    def test_audio_formats_without_system_tools(self):
        mid=self.create()
        for name in ('tone.mp3','tone.m4a','tone.ogg','tone.opus','tone.flac','tone.aac','tone.webm','recorder.webm'):
            with self.subTest(name=name):
                data=(SOURCE/'tests/fixtures'/name).read_bytes()
                r=self.upload(mid,name=name,data=data)
                self.assertEqual(r.status_code,200,r.text)
                self.assertAlmostEqual(r.json()['duration'],1,delta=.06)
        r=self.upload(mid,name='book.m4b',data=(SOURCE/'tests/fixtures/tone.m4a').read_bytes())
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(self.items()[0]['tracks']),9)
        for name,data in [
            ('video-only.webm',(SOURCE/'tests/fixtures/video-only.webm').read_bytes()),
            ('video-only.m4a',(SOURCE/'tests/fixtures/video-only.m4a').read_bytes()),
            ('truncated.aac',(SOURCE/'tests/fixtures/tone.aac').read_bytes()[:-1]),
            ('fake.mp3',b'ID3'+b'\0'*200),
            ('fake.wav',b'RIFF'+b'\0'*400),
            ('wrong-extension.mp3',audio_bytes()),
        ]:
            with self.subTest(invalid=name):
                self.assertEqual(self.upload(mid,name=name,data=data).status_code,400)
        self.assertEqual(len(self.items()[0]['tracks']),9)
        self.assertEqual(len(list((Path(self.temp.name)/'uploads').iterdir())),9)

    def test_recorder_webm_with_unknown_cluster_sizes(self):
        source=(SOURCE/'tests/fixtures/recorder.webm').read_bytes()
        # Simulate browser MediaRecorder's open-ended Segment/Clusters.
        data=bytearray(source)
        reader=self.mod._probe.Reader(io.BytesIO(source))
        header=self.mod._probe.header
        _,_,stop,_=header(reader,reader.size)
        reader.seek(stop)
        _,start,stop,_=header(reader,reader.size)
        reader.seek(start)
        changed=0
        while reader.tell()<stop:
            before=reader.tell()
            key,pos,end,_=header(reader,stop)
            if key==0x1F43B675:
                width=pos-before-4
                data[before+4:pos]=bytes([(1 << (9-width))-1])+b'\xff'*(width-1)
                changed+=1
            reader.seek(end)
        self.assertGreater(changed,1)
        mid=self.create()
        result=self.upload(mid,name='browser.webm',data=bytes(data))
        self.assertEqual(result.status_code,200,result.text)
        self.assertAlmostEqual(result.json()['duration'],1,delta=.06)

    def test_chunked_upload_retry_and_authorization(self):
        mid=self.create()
        data=audio_bytes()
        start=self.admin('POST','/media/'+mid+'/uploads',json={'filename':'whole-book.wav','bytes':len(data)})
        self.assertEqual(start.status_code,200,start.text)
        uid=start.json()['id']
        self.assertEqual(start.json()['chunk_bytes'],8*1024**2)
        self.assertEqual(self.pub('PUT','/uploads/'+uid+'?offset=0',content=data[:100]).status_code,403)
        first=self.admin('PUT','/uploads/'+uid+'?offset=0',content=data[:100])
        self.assertEqual(first.json()['received'],100)
        self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset=0',content=data[:100]).json()['received'],100)
        self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset=0',content=b'wrong').status_code,409)
        self.assertEqual(self.admin('POST','/uploads/'+uid+'/finish').status_code,409)
        self.assertEqual(self.items()[0]['tracks'],[])
        self.assertEqual(self.admin('PUT','/uploads/'+uid+'?offset=100',content=data[100:]).status_code,200)
        result=self.admin('POST','/uploads/'+uid+'/finish')
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['bytes'],len(data))
        self.assertEqual(self.admin('POST','/uploads/'+uid+'/finish').json(),result.json())
        self.assertEqual(len(self.items()[0]['tracks']),1)
        with self.mod.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM chunk_uploads').fetchone()[0],0)

    def test_personal_chunk_reservation_and_cancel(self):
        self.admin('PUT','/settings',json={'upload_limit_mb':1})
        mid=self.create(personal=True)
        data=audio_bytes()
        uid=self.pub('POST','/media/'+mid+'/uploads',json={'filename':'book.wav','bytes':900000}).json()['id']
        self.assertEqual(self.pub('POST','/media/'+mid+'/uploads',json={'filename':'other.wav','bytes':len(data)}).status_code,413)
        self.assertEqual(self.pub('PUT','/uploads/'+uid+'?offset=0',content=data).status_code,200)
        self.pub('DELETE','/uploads/'+uid,user='b')
        with self.mod.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM chunk_uploads').fetchone()[0],1)
        self.assertEqual(self.pub('DELETE','/uploads/'+uid).status_code,200)
        self.assertEqual(list((Path(self.temp.name)/'uploads').iterdir()),[])
        uid=self.pub('POST','/media/'+mid+'/uploads',json={'filename':'book.wav','bytes':len(data)}).json()['id']
        self.pub('PUT','/uploads/'+uid+'?offset=0',content=data)
        self.assertEqual(self.pub('POST','/uploads/'+uid+'/finish').status_code,200)
        with self.mod.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM upload_reservations').fetchone()[0],0)
        uid=self.pub('POST','/media/'+mid+'/uploads',json={'filename':'bad.mp3','bytes':4}).json()['id']
        self.pub('PUT','/uploads/'+uid+'?offset=0',content=b'nope')
        self.assertEqual(self.pub('POST','/uploads/'+uid+'/finish').status_code,400)
        with self.mod.db() as c:self.assertEqual(c.execute('SELECT COUNT(*) FROM chunk_uploads').fetchone()[0],0)
        self.assertEqual(len(list((Path(self.temp.name)/'uploads').iterdir())),1)

    def test_640_mb_book_in_small_requests(self):
        import struct
        mid=self.create()
        size=640*1024**2
        header=bytearray(audio_bytes()[:44])
        struct.pack_into('<I',header,4,size-8)
        struct.pack_into('<I',header,40,size-44)
        uid=self.admin('POST','/media/'+mid+'/uploads',json={'filename':'large-book.wav','bytes':size}).json()['id']
        part=bytes(8*1024**2)
        for offset in range(0,size,len(part)):
            data=bytes(header)+part[44:] if offset==0 else part
            result=self.admin('PUT','/uploads/'+uid+'?offset='+str(offset),content=data)
            self.assertEqual(result.status_code,200,result.text)
        result=self.admin('POST','/uploads/'+uid+'/finish')
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['bytes'],size)
        self.assertAlmostEqual(result.json()['duration'],(size-44)/16000)
        item=self.items()[0]
        self.assertEqual(len(item['tracks']),1)
        self.assertEqual(item['bytes'],size)

    def tagged_mp3(self):
        import base64
        png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')
        def frame(key,data):return key.encode()+len(data).to_bytes(4,'big')+b'\0\0'+data
        content=b''.join(frame(k,b'\0'+v.encode()) for k,v in [('TIT2','Chapter One'),('TPE1','Tagged Author'),('TALB','Tagged Book'),('TCON','Fiction'),('TYER','2021')])
        content+=frame('APIC',b'\0image/png\0\x03\0'+png)
        size=len(content);sync=bytes((size>>21&127,size>>14&127,size>>7&127,size&127))
        source=(SOURCE/'tests/fixtures/tone.mp3').read_bytes()
        old=sum(b<<(7*(3-i)) for i,b in enumerate(source[6:10])) if source[:3]==b'ID3' else -10
        return b'ID3\x03\0\0'+sync+content+source[10+old:],png

    def test_embedded_tags_art_and_existing_fields(self):
        data,png=self.tagged_mp3();mid=self.create(title='My book')
        result=self.upload(mid,name='01.mp3',data=data)
        self.assertEqual(result.status_code,200,result.text)
        item=self.items()[0]
        self.assertEqual(item['title'],'My book')
        self.assertEqual(item['creator'],'Tagged Author')
        self.assertEqual(item['category'],'Fiction')
        self.assertEqual(item['year'],'2021')
        self.assertEqual(item['tracks'][0]['title'],'Chapter One')
        self.assertTrue(item['has_cover'])
        art=self.pub('GET','/media/'+mid+'/cover')
        self.assertEqual(art.content,png)
        self.assertIn('private',art.headers['cache-control'])
        self.pub('PUT','/media/'+mid+'/state',json={'track_id':result.json()['id'],'seconds':.3,'favorite':True})
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/tags',json={'overwrite':True}).status_code,200)
        self.assertEqual(self.items()[0]['title'],'Tagged Book')
        self.assertEqual(self.items()[0]['state']['seconds'],.3)
        self.assertTrue(self.items()[0]['state']['favorite'])
        with self.mod.db() as c:stored=c.execute('SELECT filename FROM tracks WHERE id=?',(result.json()['id'],)).fetchone()[0]
        self.assertEqual((Path(self.temp.name)/'uploads'/stored).read_bytes(),data)
        self.assertEqual(self.pub('PUT','/media/'+mid+'/cover',content=png).status_code,404)
        self.assertEqual(self.admin('PUT','/media/'+mid+'/cover',content=b'<svg onload=evil()>').status_code,400)
        self.admin('DELETE','/media/'+mid+'/cover')
        self.assertFalse(self.items()[0]['has_cover'])
        self.assertEqual(self.pub('GET','/media/'+mid+'/cover').status_code,404)

    def test_online_metadata_cache_preview_and_apply(self):
        _,png=self.tagged_mp3()
        mid=self.create('music',title='My title')
        tid=self.upload(mid).json()['id']
        recid='11111111-1111-1111-1111-111111111111';rid='22222222-2222-2222-2222-222222222222'
        response={'recordings':[{'id':recid,'title':'Online title','artist-credit':[{'name':'Online artist'}],'tags':[{'name':'Jazz'}],'releases':[{'id':rid,'title':'Online album','date':'2020-05-01'}]}]}
        fetch=AsyncMock(return_value=response)
        with patch.object(self.mod._metadata,'fetch',fetch):
            body={'title':'Online title','creator':'Online artist'}
            a=self.admin('POST','/media/'+mid+'/metadata/search',json=body)
            self.assertEqual(a.status_code,200,a.text)
            b=self.admin('POST','/media/'+mid+'/metadata/search',json=body)
            self.assertTrue(b.json()['cached']);self.assertEqual(fetch.await_count,1)
        candidate=a.json()['results'][0]
        self.assertEqual(self.items()[0]['title'],'My title')
        with patch.object(self.mod._metadata,'fetch',AsyncMock(return_value=png)):
            r=self.admin('POST','/media/'+mid+'/metadata/apply',json={'candidate_id':candidate['id']})
        self.assertEqual(r.status_code,200,r.text)
        item=self.items()[0];self.assertEqual(item['title'],'My title');self.assertEqual(item['creator'],'Online artist');self.assertEqual(item['year'],'2020')
        self.assertEqual(item['metadata_source'],'MusicBrainz');self.assertTrue(item['has_cover'])
        self.assertEqual(item['tracks'][0]['id'],tid)
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json={'candidate_id':candidate['id'],'fields':['title'],'overwrite':True}).status_code,200)
        self.assertEqual(self.items()[0]['title'],'Online title')
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json={'candidate_id':candidate['id'],'fields':['owner']}).status_code,400)
        self.assertEqual(self.admin('POST','/media/'+mid+'/metadata/apply',json={'candidate_id':'unknown'}).status_code,410)

    def test_book_catalogue_and_private_cover_permissions(self):
        self.admin('PUT','/settings',json={'upload_limit_mb':1})
        mid=self.create(personal=True,title='Private book')
        _,png=self.tagged_mp3()
        self.assertEqual(self.pub('PUT','/media/'+mid+'/cover',content=png).status_code,200)
        self.assertEqual(self.pub('GET','/media/'+mid+'/cover',user='b').status_code,404)
        self.enabled['module']=False  # Metadata stays available without Premium.
        response={'docs':[{'key':'/works/OL123W','title':'Book title','author_name':['Author'],'first_publish_year':1890,'cover_i':123,'isbn':['123'],'language':['eng'],'subject':['Fiction']}]}
        with patch.object(self.mod._metadata,'fetch',AsyncMock(return_value=response)):
            self.assertEqual(self.pub('POST','/media/'+mid+'/metadata/search',user='b',json={'title':'Book title'}).status_code,404)
            result=self.pub('POST','/media/'+mid+'/metadata/search',json={'title':'Book title'}).json()['results'][0]
        self.assertNotIn('year',result);self.assertNotIn('narrator',result);self.assertNotIn('isbn',result)
        r=self.pub('POST','/media/'+mid+'/metadata/apply',json={'candidate_id':result['id'],'fields':['cover','creator'],'overwrite':True})
        self.assertEqual(r.status_code,200,r.text)
        item=self.items()[0];self.assertEqual(item['cover_url'],'https://covers.openlibrary.org/b/id/123-L.jpg?default=false')
        self.assertEqual(item['year'],'')
        self.assertEqual(self.pub('POST','/media/'+mid+'/metadata/apply',user='b',json={'candidate_id':result['id']}).status_code,404)
        for url in ['http://musicbrainz.org/ws/2/','https://127.0.0.1/','https://archive.org.evil.test/a','https://169.254.169.254/','https://archive.org:bad/a']:
            self.assertFalse(self.mod._metadata.allowed(url,cover=True),url)
        with patch.object(self.mod._metadata,'fetch',AsyncMock(side_effect=HTTPException(502,'metadataUnavailable'))):
            self.assertEqual(self.pub('POST','/media/'+mid+'/metadata/search',json={'title':'Different query'}).status_code,502)
        self.assertEqual(self.items()[0]['title'],'Private book')

    def test_provider_requests_are_spaced_per_installation(self):
        import asyncio,time
        async def check():
            await self.mod._metadata.pace('musicbrainz.org')
            first=time.monotonic()
            await self.mod._metadata.pace('musicbrainz.org')
            return time.monotonic()-first
        self.assertGreaterEqual(asyncio.run(check()),1.0)

    def test_identity_progress_and_chapters(self):
        mid=self.create()
        t1=self.upload(mid).json()['id'];t2=self.upload(mid,name='02.wav').json()['id']
        r=self.pub('PUT','/media/'+mid+'/state',json={'track_id':t2,'seconds':3,'speed':1.5,'played':True,'favorite':True})
        self.assertEqual(r.status_code,200)
        a=self.items()[0];b=self.items('b')[0]
        self.assertEqual(a['elapsed'],15);self.assertEqual(a['percent'],62.5)
        self.assertEqual(a['state']['speed'],1.5);self.assertEqual(b['percent'],0)
        self.assertFalse(b['state']['favorite']);self.assertTrue(a['state']['last_played'])
        self.assertEqual(self.pub('PUT','/media/'+mid+'/state',json={'track_id':'missing','seconds':1}).status_code,400)
        self.assertEqual(self.pub('PUT','/media/'+mid+'/state',json={'seconds':1}).status_code,400)
        self.assertEqual(self.admin('PUT','/media/'+mid+'/tracks/order',json={'ids':[t2,t1]}).status_code,200)
        self.assertEqual(self.items()[0]['tracks'][0]['id'],t2)
        self.pub('PUT','/media/'+mid+'/state',json={'completed':True})
        self.assertEqual(self.items()[0]['percent'],100)
        self.pub('PUT','/media/'+mid+'/state',json={'completed':False})
        self.assertEqual(self.items()[0]['percent'],0)
        self.assertEqual(self.pub('GET','/library',user='invalid').status_code,401)
    def test_private_sharing_range_and_revocation(self):
        self.admin('PUT','/settings',json={'upload_limit_mb':2})
        mid=self.create(personal=True)
        tid=self.upload(mid,personal=True).json()['id']
        self.assertEqual(self.items('b'),[])
        self.assertEqual(self.pub('POST','/tracks/'+tid+'/ticket',user='b').status_code,404)
        pid=self.pub('POST','/playlists',json={'title':'Friends','items':[mid]}).json()['id']
        self.assertEqual(self.pub('POST','/playlists/'+pid+'/members',json={'user_id':'b'}).status_code,200)
        self.assertEqual(self.items('b')[0]['id'],mid)
        url=self.pub('POST','/tracks/'+tid+'/ticket',user='b').json()['url']
        r=self.client.get(url,headers={'Range':'bytes=0-31'})
        self.assertEqual(r.status_code,206,r.text)
        self.assertEqual(r.headers['content-range'],'bytes 0-31/192044')
        self.assertEqual(len(r.content),32)
        self.assertEqual(self.pub('PUT','/media/'+mid,user='b',json={'kind':'books','title':'Stolen'}).status_code,404)
        self.assertEqual(self.pub('POST','/playlists',user='b',json={'title':'Copy','items':[mid]}).status_code,403)
        self.assertEqual(self.pub('PUT','/playlists/'+pid,user='b',json={'title':'Stolen','items':[mid]}).status_code,404)
        self.pub('DELETE','/playlists/'+pid+'/members/b')
        self.assertEqual(self.items('b'),[])
        self.assertEqual(self.client.get(url).status_code,401)
        self.assertEqual(self.client.get('/pub/mvmaudio/stream/'+tid).status_code,401)
    def test_premium_policy_quota_and_existing_files(self):
        self.assertEqual(self.pub('POST','/media',json={'kind':'books','title':'Disabled'}).status_code,403)
        self.admin('PUT','/settings',json={'upload_limit_mb':1})
        mid=self.create(personal=True)
        self.assertEqual(self.upload(mid,personal=True).status_code,200)
        with self.mod.db() as c:
            c.execute('INSERT INTO upload_reservations VALUES(?,?,?,?)',('other','a',900000,9999999999))
        self.assertEqual(self.upload(mid,personal=True).status_code,413)
        with self.mod.db() as c:c.execute('DELETE FROM upload_reservations')
        self.assertEqual(self.upload(mid,personal=True,data=b'not audio',name='bad.wav').status_code,400)
        self.assertEqual(self.upload(mid,personal=True,data=b'bad',name='bad.html').status_code,400)
        self.assertEqual(len(self.items()[0]['tracks']),1)
        self.admin('PUT','/settings',json={'upload_limit_mb':0})
        self.assertEqual(self.upload(mid,personal=True).status_code,403)
        self.assertEqual(len(self.items()),1)
        self.enabled['module']=False
        self.assertEqual(self.admin('PUT','/settings',json={'upload_limit_mb':1}).status_code,402)
        self.assertFalse(self.admin('GET','/admin').json()['premium'])
        self.assertEqual(self.pub('GET','/library').json()['upload_limit_mb'],0)
        self.assertEqual(self.upload(self.create(),personal=False).status_code,200)
        self.assertEqual(self.pub('DELETE','/media/'+mid).status_code,200)
    def test_bookmarks_and_radio_validation(self):
        mid=self.create();tid=self.upload(mid).json()['id']
        r=self.pub('POST','/media/'+mid+'/bookmarks',json={'track_id':tid,'seconds':3,'title':'My note'})
        bid=r.json()['id'];self.assertEqual(len(self.pub('GET','/media/'+mid+'/bookmarks').json()),1)
        self.assertEqual(self.pub('GET','/media/'+mid+'/bookmarks',user='b').json(),[])
        self.pub('DELETE','/bookmarks/'+bid,user='b');self.assertEqual(len(self.pub('GET','/media/'+mid+'/bookmarks').json()),1)
        self.assertEqual(self.admin('POST','/media',json={'kind':'radio','title':'Bad','url':'http://example.com/live'}).status_code,400)
        self.assertEqual(self.admin('POST','/media',json={'kind':'radio','title':'Bad','url':'https://[broken'}).status_code,400)
        rid=self.create('radio',url='https://example.com/live')
        self.assertEqual(self.upload(rid).status_code,400)
        self.client.cookies.clear()
        self.assertEqual(self.admin('GET','/admin').status_code,401)
    def test_common_playlists_and_cleanup(self):
        mid=self.create();tid=self.upload(mid).json()['id']
        p=self.admin('POST','/playlists',json={'title':'Shared shelf','items':[mid]}).json()['id']
        self.assertTrue(self.pub('GET','/library',user='c').json()['playlists'][0]['shared'])
        self.assertEqual(self.pub('DELETE','/playlists/'+p).status_code,404)
        self.pub('POST','/media/'+mid+'/bookmarks',json={'track_id':tid,'seconds':3,'title':'Bookmark'})
        self.pub('PUT','/media/'+mid+'/state',json={'track_id':tid,'seconds':3})
        url=self.pub('POST','/tracks/'+tid+'/ticket').json()['url']
        self.assertEqual(self.admin('DELETE','/media/'+mid).status_code,200)
        self.assertEqual(self.client.get(url).status_code,401)
        self.assertEqual(list((Path(self.temp.name)/'uploads').iterdir()),[])


class BundledInstallTests(unittest.TestCase):
    def test_clean_install_needs_only_stdlib(self):
        import zipfile
        with tempfile.TemporaryDirectory(prefix='mvmaudio-clean-install-') as directory:
            archive=io.BytesIO()
            # Private in-memory fixture, not a release/package publication.
            names=('manifest.json','api.py','audio_probe.py','audio_metadata.py','tinytag_vendor.py','public/tinytag-NOTICE.txt')
            with zipfile.ZipFile(archive,'w') as z:
                for name in names:z.writestr(name,(SOURCE/name).read_bytes())
            archive.seek(0)
            installed=Path(directory)/'app'
            # Mirror the normal Store installer's root .py / public routing.
            with zipfile.ZipFile(archive) as z:
                for name in z.namelist():
                    dest=installed/name if name=='manifest.json' or '/' not in name and name.endswith('.py') else installed/'public'/name.removeprefix('public/')
                    dest.parent.mkdir(parents=True,exist_ok=True)
                    dest.write_bytes(z.read(name))
            script="""
import runpy,sys
from pathlib import Path

def guard(event,args):
    if event in ('subprocess.Popen','os.system','socket.connect'):
        raise AssertionError('Unexpected external dependency: '+event)
sys.addaudithook(guard)
probe=runpy.run_path(sys.argv[1])['inspect_audio']
for p in Path(sys.argv[2]).glob('tone.*'):
    assert .94 < probe(str(p)) < 1.06, p.name
print('Fresh interpreter: bundled sources and stdlib only; no network or executables.')
"""
            result=subprocess.run([sys.executable,'-I','-S','-c',script,str(installed/'audio_probe.py'),str(SOURCE/'tests/fixtures')],env={'PATH':''},text=True,capture_output=True,timeout=20)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertIn('bundled sources and stdlib only',result.stdout)
            self.assertTrue((installed/'public/tinytag-NOTICE.txt').is_file())


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='serve':
        import uvicorn
        app,mod,enabled,temp=build()
        uvicorn.run(app,host='127.0.0.1',port=2087,log_level='warning',access_log=False)
    else:unittest.main()
