"""Access boundaries and revision conflicts, using isolated temporary storage."""
import concurrent.futures
import pathlib
import sys
import tempfile
import types
import unittest

from fastapi import FastAPI, Header
from fastapi.testclient import TestClient


class SharingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_modules = {k:sys.modules.get(k) for k in ('backend.auth','backend.apphub')}
        def session(x_test_owner: str = Header(default='owner')):
            return {'effective_user':x_test_owner}
        self.enabled = True
        users = {'reader':{'id':'reader','username':'reader','display_name':'Reader'},
                 'editor':{'id':'editor','username':'editor','display_name':'Editor'}}
        sys.modules['backend.auth'] = types.SimpleNamespace(get_current_session=session)
        sys.modules['backend.apphub'] = types.SimpleNamespace(
            is_app_public=lambda _:self.enabled,
            get_pub_session=lambda token:users.get(token),
            get_users_by_ids=lambda ids:[users[i] for i in ids if i in users],
            search_users=lambda q,limit=20:[u for u in users.values() if q in u['username']])
        self.mod = types.ModuleType('sharing_fixture')
        self.mod.__file__ = str(pathlib.Path(self.temp.name)/'api.py')
        source = pathlib.Path(__file__).resolve().parents[1]/'api.py'
        exec(compile(source.read_text(),str(source),'exec'),self.mod.__dict__)
        app = FastAPI()
        app.include_router(self.mod.desktop_router,prefix='/api/apps/mvmdesign')
        app.include_router(self.mod.router,prefix='/pub/mvmdesign')
        self.client = TestClient(app)
        self.project = {'format':'mvmdesign','version':1,'name':'Template','width':1920,'height':1080,'pages':[{'id':'page','items':[]}], 'captionStyles':[{'id':'line1','name':'First line','style':{'x':0.1}}]}
        self.desktop = '/api/apps/mvmdesign'
        self.public = '/pub/mvmdesign'
        self.headers = {'X-MvmDesign':'1'}
        r = self.client.post(self.desktop+'/projects',json={'project':self.project},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        self.id = r.json()['id']
        self.path = '/projects/'+self.id

    def tearDown(self):
        self.client.close()
        for k,v in self.old_modules.items():
            if v is None:sys.modules.pop(k,None)
            else:sys.modules[k]=v
        self.temp.cleanup()

    def grant(self,user,role):
        r=self.client.put(self.desktop+self.path+'/shares/'+user,json={'role':role},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)

    def test_owner_scoping_and_public_creation_denied(self):
        self.assertEqual(self.client.get(self.desktop+'/projects',headers={'X-Test-Owner':'another'}).json(),[])
        self.assertEqual(self.client.get(self.desktop+self.path,headers={'X-Test-Owner':'another'}).status_code,404)
        self.assertEqual(self.client.put(self.desktop+self.path,json={'project':self.project,'revision':1}).status_code,403)
        self.assertEqual(self.client.post(self.public+'/projects',json={'project':self.project},headers={'X-Pub-Token':'editor'}).status_code,405)
        self.assertEqual(self.client.get(self.public+'/projects').status_code,401)
        self.assertEqual(self.client.get(self.public+'/projects',headers={'X-Pub-Token':'editor'}).json(),[])
        self.assertEqual(self.client.get(self.public+self.path,headers={'X-Pub-Token':'editor'}).status_code,404)

    def test_viewer_editor_and_revocation(self):
        self.grant('reader','viewer')
        self.grant('editor','editor')
        for user,role in [('reader','viewer'),('editor','editor')]:
            r=self.client.get(self.public+self.path,headers={'X-Pub-Token':user})
            self.assertEqual(r.status_code,200)
            self.assertEqual(r.json()['role'],role)
            self.assertEqual(r.json()['project']['captionStyles'],self.project['captionStyles'])
            self.assertNotIn('owner',r.json())
        body={'project':{**self.project,'name':'Edited'},'revision':1}
        self.assertEqual(self.client.put(self.public+self.path,json=body,headers={'X-Pub-Token':'reader'}).status_code,403)
        saved=self.client.put(self.public+self.path,json=body,headers={'X-Pub-Token':'editor'})
        self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.json()['revision'],2)
        self.assertEqual(self.client.put(self.public+self.path,json=body,headers={'X-Pub-Token':'editor'}).status_code,409)
        self.assertEqual(self.client.get(self.desktop+self.path).json()['project']['name'],'Edited')
        self.assertEqual(self.client.put(self.public+self.path+'/shares/reader',json={'role':'editor'},headers={'X-Pub-Token':'editor'}).status_code,404)
        self.grant('editor','viewer')
        self.assertEqual(self.client.get(self.public+self.path+'/status',headers={'X-Pub-Token':'editor'}).json()['role'],'viewer')
        self.assertEqual(self.client.put(self.public+self.path,json={**body,'revision':2},headers={'X-Pub-Token':'editor'}).status_code,403)
        self.assertEqual(self.client.delete(self.desktop+self.path+'/shares/editor',headers=self.headers).status_code,200)
        self.assertEqual(self.client.get(self.public+self.path+'/status',headers={'X-Pub-Token':'editor'}).status_code,404)
        self.assertEqual(self.client.get(self.public+'/projects',headers={'X-Pub-Token':'editor'}).json(),[])
        self.assertEqual(self.client.get(self.public+self.path,headers={'X-Pub-Token':'editor'}).status_code,404)

    def test_cover_preview_permissions_and_payload(self):
        project = {**self.project, 'audio': {'data': 'private music'},
                   'assets': {'used': {'src': 'image'}, 'unused': {'src': 'other'}},
                   'pages': [{'id': 'cover', 'items': [{'type': 'image', 'assetId': 'used'}]},
                             {'id': 'second', 'items': []}]}
        saved = self.client.put(self.desktop+self.path, json={'project': project, 'revision': 1}, headers=self.headers)
        self.assertEqual(saved.status_code, 200)
        path = self.path+'/preview'
        self.assertEqual(self.client.get(self.desktop+path, headers={'X-Test-Owner':'another'}).status_code, 404)
        self.assertEqual(self.client.get(self.public+path).status_code, 401)
        self.assertEqual(self.client.get(self.public+path, headers={'X-Pub-Token':'reader'}).status_code, 404)
        self.grant('reader', 'viewer')
        response = self.client.get(self.public+path, headers={'X-Pub-Token':'reader'})
        self.assertEqual(response.status_code, 200)
        preview = response.json()['project']
        self.assertEqual(len(preview['pages']), 1)
        self.assertEqual(set(preview['assets']), {'used'})
        self.assertNotIn('audio', preview)
        self.assertNotIn('captionStyles', preview)
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        self.client.delete(self.desktop+self.path+'/shares/reader', headers=self.headers)
        self.assertEqual(self.client.get(self.public+path, headers={'X-Pub-Token':'reader'}).status_code, 404)

    def test_simultaneous_saves_preserve_one_revision(self):
        def save(n):
            return self.client.put(self.desktop+self.path,json={'project':{**self.project,'name':str(n)},'revision':1},headers=self.headers).status_code
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            results=list(pool.map(save,[1,2]))
        self.assertEqual(sorted(results),[200,409])
        self.assertEqual(self.client.get(self.desktop+self.path).json()['revision'],2)

    def test_disabled_public_and_validation(self):
        self.grant('editor','editor')
        self.enabled=False
        self.assertEqual(self.client.get(self.public+'/projects',headers={'X-Pub-Token':'editor'}).status_code,403)
        self.assertEqual(self.client.get(self.public+self.path,headers={'X-Pub-Token':'editor'}).status_code,403)
        self.assertEqual(self.client.put(self.public+self.path,json={'project':self.project,'revision':1},headers={'X-Pub-Token':'editor'}).status_code,403)
        self.assertEqual(self.client.post(self.desktop+'/projects',json={'project':{'format':'wrong'}},headers=self.headers).status_code,400)
        self.assertEqual(self.client.put(self.desktop+self.path,json={'project':self.project},headers=self.headers).status_code,409)
        self.mod.MAX_BYTES=100
        self.assertEqual(self.client.post(self.desktop+'/projects',json={'project':self.project},headers=self.headers).status_code,413)


if __name__=='__main__':unittest.main()
