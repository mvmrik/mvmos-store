"""Onboarding and account isolation; all Tesla and public HTTP calls are mocked."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
def load(name):
    spec = importlib.util.spec_from_file_location('tesla_setup_test_' + name, ROOT / (name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

setup = load('onboarding')
engine = setup.eng
api = load('api')

class Onboarding(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = self.temp.name + '/data.db'
        self.patches = [patch.object(m,'DB_PATH',self.db_path) for m in (engine,api.eng,api.onboarding.eng)]
        for p in self.patches:p.start()
        self.c = engine.db()
        self.app = FastAPI();self.app.include_router(api.router,prefix='/pub/tesla')
        self.hub = types.SimpleNamespace(is_app_public=lambda app:True,get_pub_session=lambda token: {'id':token} if token in ('alice','bob') else None)
        self.previous_hub = sys.modules.get('backend.apphub')
        sys.modules['backend.apphub'] = self.hub
        self.client = TestClient(self.app)
        self.alice = {'X-Pub-Token':'alice'}; self.bob = {'X-Pub-Token':'bob'}

    def tearDown(self):
        self.client.close();self.c.close()
        if self.previous_hub is None: sys.modules.pop('backend.apphub', None)
        else: sys.modules['backend.apphub'] = self.previous_hub
        for p in self.patches:p.stop()
        self.temp.cleanup()

    def prepare(self):
        setup.configure_server(self.c,'https://alice.example','alice')
        setup.save_credentials(self.c,'alice','alice-id','alice-secret','eu',10)

    def account(self):
        self.c.execute("INSERT INTO accounts(user_id,access_token,refresh_token,expires_at) VALUES('alice','token','refresh',9999999999)")
        self.c.execute("INSERT INTO vehicles(id,user_id,name) VALUES('v1','alice','Private car')")
        self.c.commit()

    def tesla(self,method,url,**kw):
        if url.endswith('/token'):
            self.assertEqual(kw['form']['client_id'],'alice-id');return 200,{'access_token':'partner-test'}
        if method=='POST':
            self.assertEqual(kw['payload'],{'domain':'alice.example'});return 200,{'response':{'domain':'alice.example'}}
        return 200,{'response':{'public_key':engine.cfg_get(self.c,'server_public_key')}}

    def server_client(self):
        from fastapi import Request, HTTPException
        def desktop_session(request: Request):
            if request.cookies.get('session') != 'test-desktop':
                raise HTTPException(401)
            return {'effective_user':'root'}
        previous = sys.modules.get('backend.auth')
        sys.modules['backend.auth'] = types.SimpleNamespace(get_current_session=desktop_session)
        try:
            path = ROOT.parents[1] / 'backend/apps/tesla/backend.py'
            spec = importlib.util.spec_from_file_location('tesla_server_test',path)
            module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        finally:
            if previous is None:sys.modules.pop('backend.auth',None)
            else:sys.modules['backend.auth']=previous
        module.setup = setup;module.eng = engine
        app = FastAPI();app.include_router(module.router)
        return TestClient(app),module

    def test_server_setup_requires_desktop_and_profile_and_key_is_public_only_at_approved_host(self):
        client,module = self.server_client()
        with client:
            self.assertEqual(client.get('/api/apps/tesla/server').status_code,401)
            client.cookies.set('session','test-desktop')
            self.assertEqual(client.put('/api/apps/tesla/server',json={'origin':'https://alice.example'}).status_code,403)
            r=client.put('/api/apps/tesla/server',headers=self.alice,json={'origin':'https://alice.example'})
            self.assertEqual(r.status_code,200);self.assertNotIn('PRIVATE KEY',r.text)
            key=client.get(setup.KEY_PATH,headers={'Host':'alice.example'})
            self.assertEqual(key.status_code,200);self.assertIn('BEGIN PUBLIC KEY',key.text)
            self.assertNotIn('PRIVATE KEY',key.text)
            self.assertEqual(client.get(setup.KEY_PATH,headers={'Host':'bob.example'}).status_code,404)
            # Key verification by Tesla must not need a desktop or Apps Hub login.
            client.cookies.clear()
            self.assertEqual(client.get(setup.KEY_PATH,headers={'Host':'alice.example'}).status_code,200)

    def test_missing_key_dependency_is_reported_without_partial_server_setup(self):
        client,module=self.server_client()
        with client,patch.object(module.importlib.util,'find_spec',return_value=None),patch.object(module.subprocess,'run',side_effect=OSError('no network')):
            client.cookies.set('session','test-desktop')
            r=client.put('/api/apps/tesla/server',headers=self.alice,json={'origin':'https://alice.example'})
            self.assertEqual(r.status_code,503);self.assertEqual(r.json()['error'],'dependency_failed')
            self.assertFalse(setup.server_state(self.c)['key_ready'])

    def test_another_account_cannot_overwrite_or_poll_an_owned_vehicle(self):
        self.prepare();self.account()
        with patch.object(engine,'fleet',return_value=(200,{'response':[{'id':'v1','vin':'other','display_name':'Changed','state':'online'}]})):
            states=engine.refresh_list(self.c,engine.settings(self.c,'bob'),{'user_id':'bob'},1)
        self.assertEqual(states,{})
        self.assertEqual(self.c.execute("SELECT name FROM vehicles WHERE id='v1'").fetchone()[0],'Private car')

    def test_personal_credentials_and_vehicle_history_never_leak(self):
        self.prepare();self.account()
        a = self.client.get('/pub/tesla/status',headers=self.alice).json()
        b = self.client.get('/pub/tesla/status',headers=self.bob)
        self.assertTrue(a['configured']);self.assertEqual(b.status_code,404)
        self.assertNotIn('alice-secret',json.dumps(a));self.assertNotIn('refresh',b.text)
        for endpoint in ['now','car','trips','charges','tires']:
            self.assertEqual(self.client.get('/pub/tesla/v/v1/'+endpoint,headers=self.bob).status_code,404)
        self.assertEqual(self.client.get('/pub/tesla/status').status_code,401)
        self.assertEqual(self.client.put('/pub/tesla/credentials',headers=self.bob,json={'client_id':'b','client_secret':'b'}).status_code,404)
        self.assertEqual(self.client.post('/pub/tesla/register',headers=self.bob).status_code,404)

    def test_registration_checks_public_key_and_uses_personal_client(self):
        self.prepare()
        with patch.object(setup,'verify_public_key') as verify,patch.object(engine,'http',side_effect=self.tesla) as http:
            result = setup.register(self.c,'alice')
            self.assertTrue(result['ready']);verify.assert_called_once();self.assertEqual(http.call_count,3)
        with patch.object(api.onboarding.eng,'http',side_effect=AssertionError('unexpected HTTP')):
            r = self.client.get('/pub/tesla/connect?origin=https://alice.example',headers={**self.alice,'Host':'alice.example'})
        self.assertEqual(r.status_code,200)
        self.assertIn('client_id=alice-id',r.json()['url'])
        self.assertEqual(r.json()['redirect'],'https://alice.example/pub/tesla/callback')
        self.assertEqual(self.client.get('/pub/tesla/connect?origin=https://wrong.example',headers={**self.alice,'Host':'wrong.example'}).status_code,409)

    def test_key_unreachable_blocks_registration_without_tesla_calls(self):
        self.prepare()
        with patch.object(setup,'verify_public_key',side_effect=setup.SetupError('key_unreachable')),patch.object(engine,'http') as http:
            with self.assertRaisesRegex(setup.SetupError,'key_unreachable'):setup.register(self.c,'alice')
            http.assert_not_called()
        self.assertFalse(setup.ready(self.c,'alice'));self.assertEqual(engine.cfg_get(self.c,'registration_busy_until'),0)

    def test_failed_partner_auth_and_mismatched_registered_key(self):
        self.prepare()
        for answers,error in [([(401,{})],'partner_auth_failed'),([(200,{'access_token':'x'}),(200,{}),(200,{'response':{'public_key':'wrong'}})],'registration_failed')]:
            with patch.object(setup,'verify_public_key'),patch.object(engine,'http',side_effect=answers):
                with self.assertRaisesRegex(setup.SetupError,error):setup.register(self.c,'alice')
            self.assertFalse(setup.ready(self.c,'alice'))

    def test_registration_lease_blocks_changes_and_callback_state_is_one_time(self):
        self.prepare()
        engine.set_cfg(self.c,'registration_busy_until',int(__import__('time').time())+60);self.c.commit()
        with self.assertRaisesRegex(setup.SetupError,'setup_busy'):
            setup.save_credentials(self.c,'alice','different','x','eu',10)
        self.assertEqual(engine.settings(self.c,'alice')['client_id'],'alice-id')
        engine.set_cfg(self.c,'registration_busy_until',0);self.c.commit()
        with patch.object(setup,'verify_public_key'),patch.object(engine,'http',side_effect=self.tesla):setup.register(self.c,'alice')
        r=self.client.get('/pub/tesla/connect?origin=https://alice.example',headers={**self.alice,'Host':'alice.example'})
        from urllib.parse import parse_qs,urlsplit
        state=parse_qs(urlsplit(r.json()['url']).query)['state'][0]
        with patch.object(api.eng,'exchange_code') as exchange,patch.object(api.eng,'tick'):
            first=self.client.get('/pub/tesla/callback?state='+state+'&code=test',follow_redirects=False)
            second=self.client.get('/pub/tesla/callback?state='+state+'&code=test',follow_redirects=False)
        self.assertIn('connected=1',first.headers['location']);self.assertIn('connect_error=state',second.headers['location'])
        exchange.assert_called_once();self.assertEqual(exchange.call_args.args[2],'alice')

    def test_usage_is_personal(self):
        self.prepare();engine.count(self.c,'data','alice');engine.count(self.c,'data','alice');engine.count(self.c,'list','bob');self.c.commit()
        self.assertEqual(engine.month_usage(self.c,'alice'),{'data':2})
        self.assertEqual(engine.month_usage(self.c,'bob'),{'list':1})
        self.assertEqual(engine.month_usage(self.c,'unknown'),{})

    def test_secret_is_retained_and_connected_changes_are_blocked(self):
        self.prepare();self.account()
        setup.save_credentials(self.c,'alice','alice-id','','eu',20)
        self.assertEqual(engine.settings(self.c,'alice')['client_secret'],'alice-secret')
        with self.assertRaisesRegex(setup.SetupError,'disconnect_first'):setup.save_credentials(self.c,'alice','different','x','eu',10)
        with self.assertRaisesRegex(setup.SetupError,'server_locked'):setup.configure_server(self.c,'https://other.example','alice')
        self.assertEqual(self.c.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0],1)

    def test_server_key_stable_and_origin_validation(self):
        self.prepare();first=engine.cfg_get(self.c,'server_public_key')
        setup.configure_server(self.c,'https://alice.example/','alice')
        self.assertEqual(engine.cfg_get(self.c,'server_public_key'),first)
        for value in ['http://alice.example','https://alice.example/path','https://user:pass@alice.example','https://alice.example?x=1','https://localhost','https://alice.example:8080']:
            with self.assertRaises(setup.SetupError):setup.origin_url(value)

    def test_migration_preserves_existing_tokens_and_history_only_for_owner(self):
        self.account()
        for key,value in [('client_id','old-id'),('client_secret','old-secret'),('region','eu'),('personal_credentials_migrated',False)]:engine.set_cfg(self.c,key,value)
        self.c.commit()
        with engine.db() as upgraded:
            self.assertEqual(engine.settings(upgraded,'alice')['client_id'],'old-id')
            self.assertEqual(engine.settings(upgraded,'bob')['client_secret'],'')
            self.assertEqual(upgraded.execute('SELECT refresh_token FROM accounts').fetchone()[0],'refresh')
            self.assertEqual(upgraded.execute('SELECT user_id FROM vehicles').fetchone()[0],'alice')
            self.assertTrue(setup.allowed(upgraded,'alice'))

    def test_unregistered_callback_never_exchanges_token(self):
        self.prepare()
        self.c.execute('INSERT INTO oauth_states VALUES(?,?,?,?)',('fake','alice',int(__import__('time').time()),'https://alice.example/pub/tesla/callback'));self.c.commit()
        with patch.object(api.eng,'exchange_code') as exchange:
            r=self.client.get('/pub/tesla/callback?state=fake&code=fake',follow_redirects=False)
            self.assertIn('connect_error=state',r.headers['location']);exchange.assert_not_called()

if __name__=='__main__':unittest.main()
