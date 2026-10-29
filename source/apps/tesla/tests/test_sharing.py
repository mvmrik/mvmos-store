"""Share roles, revocation, direct URLs and delegated data ownership."""
import unittest
import test_onboarding as fixtures
api,setup,engine,load = fixtures.api,fixtures.setup,fixtures.engine,fixtures.load

class Sharing(unittest.TestCase):
    setUp = fixtures.Onboarding.setUp
    tearDown = fixtures.Onboarding.tearDown
    prepare = fixtures.Onboarding.prepare
    account = fixtures.Onboarding.account

    def start(self):
        self.prepare();self.account()
        self.hub.get_pub_session=lambda token:{'id':token} if token in ('alice','bob','carol') else None
        self.hub.get_favourites=lambda uid:[{'id':'bob','username':'bob','display_name':'Example friend'}] if uid=='alice' else []
        self.hub.get_users_by_ids=lambda ids:[{'id':uid,'username':uid,'display_name':'Example friend'} for uid in ids]

    def grant(self,role='view'):
        response=self.client.put('/pub/tesla/shares',headers=self.alice,json={'user_id':'bob','role':role})
        self.assertEqual(response.status_code,200,response.text)

    def test_viewer_reads_owners_cars_but_no_credentials_and_cannot_write(self):
        self.start();self.grant()
        r=self.client.get('/pub/tesla/status',headers=self.bob)
        self.assertEqual(r.status_code,200,r.text)
        data=r.json();self.assertEqual(data['access'],{'role':'view','is_owner':False})
        self.assertEqual(data['vehicles'][0]['id'],'v1');self.assertEqual(data['setup']['client_id'],'')
        self.assertFalse(data['setup']['has_secret']);self.assertNotIn('alice-id',r.text);self.assertNotIn('alice-secret',r.text)
        self.assertEqual(self.client.get('/pub/tesla/v/v1/now',headers=self.bob).status_code,200)
        for path in ['/schedule','/connect?origin=https://alice.example','/shares']:
            self.assertEqual(self.client.get('/pub/tesla'+path,headers=self.bob).status_code,403,path)
        for method,path,body in [
            ('PUT','/credentials',{'client_id':'attacker','client_secret':'x'}),('POST','/register',{}),('POST','/disconnect',{}),
            ('PUT','/schedule',{}),('PUT','/prefs',{}),('POST','/places',{'name':'x','lat':0,'lng':0}),
            ('POST','/v/v1/journeys',{}),('POST','/tariffs',{}),('PUT','/v/v1/charges/1/cost',{}),('DELETE','/shares/alice',None)]:
            r=self.client.request(method,'/pub/tesla'+path,headers=self.bob,**({'json':body} if body is not None else {}))
            self.assertEqual(r.status_code,403,(path,r.text))
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM accounts').fetchone()[0],1)

    def test_admin_edits_owners_settings_but_cannot_take_over_account_or_reshare(self):
        self.start();self.grant('admin')
        r=self.client.put('/pub/tesla/prefs',headers=self.bob,json={'default_ac_price':0.25})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.c.execute("SELECT user_id FROM prefs WHERE key='default_ac_price'").fetchone()[0],'alice')
        r=self.client.put('/pub/tesla/schedule',headers=self.bob,json=engine.default_schedule())
        self.assertEqual(r.status_code,200,r.text)
        for method,path,body in [('GET','/shares',None),('PUT','/shares',{'user_id':'carol','role':'admin'}),('POST','/disconnect',{}),('PUT','/credentials',{'client_id':'evil','client_secret':'x'}),('POST','/register',{})]:
            r=self.client.request(method,'/pub/tesla'+path,headers=self.bob,**({'json':body} if body is not None else {}))
            self.assertEqual(r.status_code,403,path)
        self.assertEqual(engine.settings(self.c,'alice')['client_id'],'alice-id')

    def test_visibility_hook_and_access_change_immediately_on_revoke(self):
        self.start()
        hook=load('app_api');hook._engine.DB_PATH=self.db_path
        self.assertTrue(hook._can_access_public('alice'));self.assertFalse(hook._can_access_public('bob'))
        self.assertFalse(hook._can_access_public(None));self.grant()
        self.assertTrue(hook._can_access_public('bob'));self.assertFalse(hook._can_access_public('carol'))
        self.grant('admin');self.assertEqual(self.client.get('/pub/tesla/status',headers=self.bob).json()['access']['role'],'admin')
        self.assertEqual(self.client.delete('/pub/tesla/shares/bob',headers=self.alice).status_code,200)
        self.assertFalse(hook._can_access_public('bob'))
        for path in ['/status','/v/v1/now','/places','/tariffs']:
            self.assertEqual(self.client.get('/pub/tesla'+path,headers=self.bob).status_code,404,path)

    def test_visibility_does_not_create_missing_database(self):
        hook = load('app_api')
        missing = self.db_path + '.missing'
        hook._engine.DB_PATH = missing
        self.assertFalse(hook._can_access_public('alice'))
        self.assertFalse(fixtures.Path(missing).exists())

    def test_only_selected_existing_favourites_can_receive_a_share(self):
        self.start()
        for person,role in [('carol','view'),('alice','view'),('bob','owner')]:
            r=self.client.put('/pub/tesla/shares',headers=self.alice,json={'user_id':person,'role':role})
            self.assertEqual(r.status_code,400,r.text)
        self.grant();data=self.client.get('/pub/tesla/shares',headers=self.alice).json()
        self.assertEqual(data['shares'][0]['display_name'],'Example friend')
        self.assertEqual(data['shares'][0]['role'],'view')
        self.assertNotIn('alice-secret',str(data))

    def test_direct_page_does_not_reveal_app_to_unshared_profile(self):
        self.start()
        self.client.cookies.set('apphub_token','carol')
        self.assertEqual(self.client.get('/pub/tesla/',follow_redirects=False).status_code,404)
        self.client.cookies.clear()
        self.assertEqual(self.client.get('/pub/tesla/',follow_redirects=False).status_code,303)
        self.grant();self.client.cookies.set('apphub_token','bob')
        self.assertEqual(self.client.get('/pub/tesla/').status_code,200)
