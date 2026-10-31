"""Run: venv/bin/python -m unittest discover -s apps/familytree/tests -v"""
import json
import pathlib
import sys
import tempfile
import types
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient

SOURCE = pathlib.Path(__file__).resolve().parents[1]
USERS = {i: dict(id=i, username=i, display_name=i.title(), avatar_color='#228866')
         for i in ('owner','editor','viewer','admin','stranger')}


def fixture(directory):
    hub = types.SimpleNamespace(
        get_pub_session=lambda token: USERS.get(token),
        get_users_by_ids=lambda ids: [USERS[i] for i in ids if i in USERS],
        search_users=lambda q, **kw: [u for u in USERS.values() if q.lower() in u['username']],
        is_app_public=lambda app: True,
    )
    sys.modules['backend.apphub'] = hub
    module = types.ModuleType('familytree_test_api')
    module.__file__ = str(pathlib.Path(directory) / 'api.py')
    sys.modules[module.__name__] = module
    exec(compile((SOURCE / 'api.py').read_text(), str(SOURCE / 'api.py'), 'exec'), module.__dict__)
    app = FastAPI()
    app.include_router(module.router, prefix='/pub/familytree')
    return app,module


class TreeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='familytree-test-')
        self.previous = sys.modules.get('backend.apphub')
        app,self.module = fixture(self.temp.name)
        self.client = TestClient(app)
        self.tid = self.request('POST','/trees', {'title':'Test family'})['id']
        for role in ('editor','viewer','admin'):
            self.request('PUT',f'/trees/{self.tid}/members', {'user_id':role,'role':role})

    def test_tree_reports_authenticated_viewer_for_initial_focus(self):
        for user in ('owner','viewer','editor','admin'):
            self.assertEqual(self.request('GET',f'/trees/{self.tid}',user=user)['current_user_id'],user)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()
        if self.previous is not None:
            sys.modules['backend.apphub'] = self.previous
        else:
            sys.modules.pop('backend.apphub',None)

    def request(self, method, path, data=None, user='owner', status=200):
        r = self.client.request(method, '/pub/familytree'+path, headers={'X-Pub-Token':user}, json=data)
        self.assertEqual(r.status_code,status,r.text)
        return r.json()

    def get(self,user='owner'):
        return self.request('GET',f'/trees/{self.tid}',user=user)

    def person(self,name='Alex',parents=None,user='owner',**kw):
        return self.request('POST',f'/trees/{self.tid}/changes',{'action':'create','data':{'name':name,'parents':parents or [],**kw}},user=user)

    def change(self,p,action='update',user='owner',status=200,**kw):
        return self.request('POST',f'/trees/{self.tid}/changes',{'action':action,'person_id':p['id'],'version':p['version'],'data':{**p,**kw}},user=user,status=status)

    def review(self,proposal,decision='approve',status=200,user='owner'):
        return self.request('POST',f'/trees/{self.tid}/proposals/{proposal}/review',{'decision':decision,'note':'Checked'},user=user,status=status)

    def test_person_tree_links_multiple_targets_permissions_and_unlink(self):
        pid = self.person('Emma')['id']
        first = self.request('POST', '/trees', {'title':'First'})['id']
        second = self.request('POST', '/trees', {'title':'Second'})['id']
        for target in (first, second):
            self.request('POST', f'/trees/{target}/references', {'action':'link','person_id':pid})
        state = self.request('GET', f'/people/{pid}/tree-links')
        self.assertEqual(state['home_tree_id'], self.tid)
        self.assertEqual({x['tree_id'] for x in state['connections']}, {first, second})
        self.assertTrue(all(x['role']=='owner' and x['version'] for x in state['connections']))
        # A viewer of the person's home must not learn private target tree titles.
        self.assertEqual(self.request('GET', f'/people/{pid}/tree-links', user='viewer')['connections'], [])
        self.request('GET', f'/people/{pid}/tree-links', user='stranger', status=404)
        link = next(x for x in state['connections'] if x['tree_id']==first)
        self.request('POST', f'/trees/{first}/references', {'action':'unlink','person_id':pid,'version':link['version']}, user='viewer', status=404)
        self.request('POST', f'/trees/{first}/references', {'action':'unlink','person_id':pid,'version':link['version']})
        remaining = self.request('GET', f'/people/{pid}/tree-links')['connections']
        self.assertEqual([x['tree_id'] for x in remaining], [second])
        self.assertTrue(any(x['id']==pid for x in self.get()['people']))
        self.request('PUT', f'/trees/{second}/members', {'user_id':'editor','role':'editor'})
        editor_link = self.request('GET', f'/people/{pid}/tree-links', user='editor')['connections'][0]
        self.assertEqual(editor_link['role'], 'editor')
        proposal = self.request('POST', f'/trees/{second}/references', {'action':'unlink','person_id':pid,'version':editor_link['version']}, user='editor')
        self.assertEqual(proposal['status'], 'pending')
        self.assertEqual(len(self.request('GET', f'/people/{pid}/tree-links')['connections']), 1)

    def test_view_preferences_are_persistent_and_private_per_profile(self):
        self.assertEqual(self.request('GET', '/preferences'), {'view_mode':'tree'})
        for user in ('owner', 'viewer', 'editor'):
            self.assertEqual(self.request('PUT', '/preferences', {'view_mode':'flat'}, user=user), {'view_mode':'flat'})
            self.assertEqual(self.request('GET', '/preferences', user=user), {'view_mode':'flat'})
        self.assertEqual(self.request('GET', '/preferences', user='stranger'), {'view_mode':'tree'})
        self.request('PUT', '/preferences', {'view_mode':'tree'}, user='viewer')
        self.assertEqual(self.request('GET', '/preferences', user='owner'), {'view_mode':'flat'})
        self.request('PUT', '/preferences', {'view_mode':'invalid'}, status=400)
        self.request('PUT', '/preferences', {'view_mode':'flat'}, user='invalid', status=401)
        self.request('GET', '/preferences', user='invalid', status=401)
        # The preference is stored in SQLite, not in process memory or browser storage.
        with self.module.database() as c:
            self.assertEqual(c.execute('SELECT view_mode FROM user_preferences WHERE user_id=?', ('owner',)).fetchone()[0], 'flat')

    def test_adoptive_parent_links_validation_review_and_cleanup(self):
        parent=self.person('Adoptive parent')['id']
        child=self.person('Child', parents=[parent], adopted_parents=[parent])['id']
        record=next(p for p in self.get()['people'] if p['id']==child)
        self.assertEqual(record['adopted_parents'],[parent])
        self.change(record,notes='Keep adoption on partial edit')
        record=next(p for p in self.get()['people'] if p['id']==child)
        self.assertEqual(record['adopted_parents'],[parent])
        for value in ([child],[parent,parent],'yes',[{}]):
            self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':child,'version':record['version'],'data':{'adopted_parents':value}},status=400)
        proposal=self.change(record,user='editor',adopted_parents=[])
        self.assertEqual(proposal['status'],'pending')
        self.assertEqual(next(p for p in self.get()['people'] if p['id']==child)['adopted_parents'],[parent])
        self.review(proposal['proposal_id'])
        record=next(p for p in self.get()['people'] if p['id']==child)
        self.assertEqual(record['adopted_parents'],[])
        self.change(record,adopted_parents=[parent])
        parent_record=next(p for p in self.get()['people'] if p['id']==parent)
        self.change(parent_record,action='delete')
        record=next(p for p in self.get()['people'] if p['id']==child)
        self.assertEqual(record['parents'],[])
        self.assertEqual(record['adopted_parents'],[])

    def test_auth_and_isolation(self):
        self.request('GET','/trees',user='invalid',status=401)
        self.assertEqual(self.request('GET','/trees',user='stranger'),[])
        self.request('GET',f'/trees/{self.tid}',user='stranger',status=404)
        for action in ('create','update','delete'):
            self.request('POST',f'/trees/{self.tid}/changes',{'action':action,'data':{'name':'No'}},user='viewer',status=403)
        self.request('PUT',f'/trees/{self.tid}',{'title':'No'},user='viewer',status=403)
        self.request('DELETE',f'/trees/{self.tid}',user='editor',status=403)
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'stranger','role':'admin'},user='editor',status=403)

    def test_editor_changes_wait_for_review(self):
        change = self.person(user='editor',profile_id='editor',birth_year=1984)
        self.assertEqual(change['status'],'pending')
        self.assertEqual(self.get()['people'],[])
        self.review(change['proposal_id'],user='editor',status=403)
        self.review(change['proposal_id'])
        p = self.get()['people'][0]
        self.assertEqual(p['birth_year'],1984)
        update = self.change(p,user='editor',name='Updated')
        self.assertEqual(self.get()['people'][0]['name'],'Alex')
        self.review(update['proposal_id'],decision='reject')
        removal = self.change(p,action='delete',user='editor')
        self.assertEqual(len(self.get()['people']),1)
        self.review(removal['proposal_id'])
        self.assertEqual(self.get()['people'],[])

    def test_stale_proposal_and_duplicate_review(self):
        self.person()
        p=self.get()['people'][0]
        proposal=self.change(p,user='editor',name='Proposed')
        self.change(p,name='Newer')
        self.review(proposal['proposal_id'],status=409)
        self.assertEqual(self.get()['people'][0]['name'],'Newer')
        self.review(proposal['proposal_id'],decision='reject')
        self.review(proposal['proposal_id'],decision='reject',status=409)
        self.change(p,name='Stale browser',status=409)

    def test_cycles_and_foreign_parents(self):
        parent=self.person()['id']
        child=self.person('Child',[parent])['id']
        p=next(p for p in self.get()['people'] if p['id']==parent)
        self.change(p,parents=[child],status=400)
        self.change(p,parents=[parent],status=400)
        other=self.request('POST','/trees',{'title':'Other'})['id']
        self.request('POST',f'/trees/{other}/changes',{'action':'create','data':{'name':'Outside','parents':[parent]}},status=400)
        self.request('POST',f'/trees/{self.tid}/changes',{'action':'create','data':{'name':'Double','parents':[parent,parent]}},status=400)

    def test_parent_removed_before_merge(self):
        parent=self.person()['id']
        proposal=self.person('Child',[parent],user='editor')
        self.change(self.get()['people'][0],action='delete')
        self.review(proposal['proposal_id'],status=400)
        self.assertEqual(self.get()['people'],[])

    def test_cycle_created_between_proposal_and_merge(self):
        a=self.person('A')['id'];b=self.person('B')['id']
        people={p['id']:p for p in self.get()['people']}
        proposal=self.change(people[a],user='editor',parents=[b])
        self.change(people[b],parents=[a])
        self.review(proposal['proposal_id'],status=400)

    def test_children_list_sets_parents_from_the_person_record(self):
        me=self.person('Me')['id']
        mother=self.person('Mother',children=[me])['id']
        people={p['id']:p for p in self.get()['people']}
        self.assertEqual(people[me]['parents'],[mother]);self.assertEqual(people[me]['version'],2)
        self.assertNotIn('children',people[mother])
        sister=self.person('Sister',children=[])['id']
        mom=people[mother]
        self.change(mom,children=[me,sister])
        people={p['id']:p for p in self.get()['people']}
        self.assertEqual(people[sister]['parents'],[mother])
        self.change(people[mother],children=[sister])
        people={p['id']:p for p in self.get()['people']}
        self.assertEqual(people[me]['parents'],[]);self.assertEqual(people[sister]['parents'],[mother])
        self.change(people[mother])
        self.assertEqual({p['id']:p for p in self.get()['people']}[sister]['parents'],[mother])

    def test_children_conflicts_are_rejected_atomically(self):
        me=self.person('Me')['id']
        mother=self.person('Mother',children=[me])['id']
        grand=self.person('Grandmother',children=[mother])['id']
        a=self.person('A')['id'];b=self.person('B')['id']
        self.person('Kid',parents=[a,b])
        kid=[p for p in self.get()['people'] if p['name']=='Kid'][0]['id']
        people={p['id']:p for p in self.get()['people']}
        def post(pid,status,**data):
            self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':pid,'version':people[pid]['version'],'data':{**people[pid],**data}},status=status)
        post(me,400,children=[me])                      # own child
        post(mother,400,children=[grand])               # own parent as child
        post(me,400,children=[grand])                   # ancestor as child
        post(grand,400,parents=[me])                    # descendant as parent
        post(mother,400,children=[me],partners=[{'person_id':me,'kind':'partner'}])  # child and partner
        post(me,400,children=[kid])                     # third parent for Kid
        people={p['id']:p for p in self.get()['people']}
        self.assertEqual(people[kid]['parents'],[a,b]);self.assertEqual(people[me]['parents'],[mother])
        post(mother,200,children=[],parents=[me])        # removing the child frees the cycle

    def test_delete_parent_keeps_children_and_increments_version(self):
        parent=self.person()['id'];child=self.person('Child',[parent])['id']
        people={p['id']:p for p in self.get()['people']}
        self.change(people[parent],action='delete')
        p=self.get()['people'][0]
        self.assertEqual(p['id'],child);self.assertEqual(p['parents'],[]);self.assertEqual(p['version'],2)

    def test_admin_authority_and_owner_protection(self):
        self.request('PUT',f'/trees/{self.tid}',{'title':'Renamed'},user='admin')
        self.person(user='admin')
        self.assertEqual(len(self.get()['people']),1)
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'owner','role':'remove'},user='admin',status=400)
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'stranger','role':'viewer'},user='admin')
        self.assertEqual(self.get(user='stranger')['role'],'viewer')
        self.request('DELETE',f'/trees/{self.tid}',user='admin')
        with self.module.database() as c:
            for table in ('trees','people','members','proposals'):
                self.assertEqual(c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0],0)

    def test_revocation_and_demoted_proposal(self):
        p=self.person(user='editor')
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'editor','role':'remove'})
        self.request('GET',f'/trees/{self.tid}',user='editor',status=404)
        self.review(p['proposal_id'],status=404)
        self.review(p['proposal_id'],decision='reject')
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'viewer','role':'editor'})
        self.assertEqual(self.get(user='viewer')['proposals'],[])

    def test_validation_birth_profile_and_text(self):
        for data in ({'name':''},{'name':'A','birth_date':'2023-02-29'},{'name':'A','birth_year':1800,'birth_date':'1984-01-02'},{'name':'A','birth_year':9999},{'name':'A','profile_id':'missing'}):
            self.request('POST',f'/trees/{self.tid}/changes',{'action':'create','data':data},status=400)
        self.person(birth_date='1984-02-29')
        self.assertEqual(self.get()['people'][0]['birth_year'],1984)
        self.person('<script>alert(1)</script>',notes='A < B & C')
        self.assertEqual(self.get()['people'][1]['notes'],'A < B & C')

    def test_reopen_persistence_and_profile_link_is_not_sharing(self):
        self.person(profile_id='stranger')
        self.assertIn('stranger',self.get()['profiles'])
        self.request('GET',f'/trees/{self.tid}',user='stranger',status=404)
        app,_=fixture(self.temp.name)
        with TestClient(app) as client:
            r=client.get('/pub/familytree/trees/'+self.tid,headers={'X-Pub-Token':'owner'})
            self.assertEqual(len(r.json()['people']),1)

    def test_life_dates_gender_and_unknown_death(self):
        self.person(gender='female',birth_date='1900-03-02',death_date='1986-07-08')
        p=self.get()['people'][0]
        self.assertEqual((p['gender'],p['death_year'],p['deceased']),('female',1986,True))
        self.change(p,death_date='',death_year=None,deceased=True)
        p=self.get()['people'][0]
        self.assertTrue(p['deceased']);self.assertIsNone(p['death_year'])
        self.change(p,deceased=False)
        self.assertFalse(self.get()['people'][0]['deceased'])

    def test_invalid_life_dates_and_gender(self):
        for data in ({'death_date':'2023-02-29'},{'death_year':9999},{'death_date':'1980-02-03','death_year':1981},{'birth_year':1985,'death_year':1984},{'birth_date':'1985-07-08','death_date':'1985-07-07'},{'gender':'bad'},{'deceased':'yes'}):
            self.request('POST',f'/trees/{self.tid}/changes',{'action':'create','data':{'name':'Test',**data}},status=400)
        self.assertEqual(self.get()['people'],[])

    def test_five_partners_and_reciprocal_relationships(self):
        partner_ids=[self.person('Partner '+str(i),gender='female')['id'] for i in range(5)]
        pid=self.person('Parent',gender='male',partners=[{'person_id':p,'kind':'former_spouse' if i<4 else 'partner'} for i,p in enumerate(partner_ids)])['id']
        items={p['id']:p for p in self.get()['people']}
        self.assertEqual(len(items[pid]['partners']),5)
        for i,p in enumerate(partner_ids):
            self.assertEqual(items[p]['partners'],[{'person_id':pid,'kind':'former_spouse' if i<4 else 'partner'}])
            self.person('Child '+str(i),parents=[pid,p])
        items={p['id']:p for p in self.get()['people']}
        self.change(items[pid],partners=[{'person_id':partner_ids[4],'kind':'spouse'}])
        items={p['id']:p for p in self.get()['people']}
        self.assertEqual(items[partner_ids[0]]['partners'],[])
        self.assertEqual(items[partner_ids[4]]['partners'],[{'person_id':pid,'kind':'spouse'}])
        self.assertEqual(len([p for p in items.values() if pid in p['parents']]),5)

    def test_invalid_partner_links_are_atomic(self):
        p=self.person()['id']
        cur=self.get()['people'][0]
        for links in ([{'person_id':p,'kind':'partner'}],[{'person_id':'missing','kind':'spouse'}],[{'person_id':p,'kind':'bad'}],[{'person_id':p,'kind':'partner'}]*2):
            self.change(cur,partners=links,status=400)
        other=self.request('POST','/trees',{'title':'Other'})['id']
        self.request('POST',f'/trees/{other}/changes',{'action':'create','data':{'name':'Cross tree','partners':[{'person_id':p,'kind':'partner'}]}},status=400)
        self.assertEqual(self.get()['people'][0]['version'],cur['version'])

    def test_partner_proposals_and_conflicts(self):
        a=self.person('A')['id'];b=self.person('B')['id']
        items={p['id']:p for p in self.get()['people']}
        proposal=self.change(items[a],user='editor',partners=[{'person_id':b,'kind':'partner'}])
        self.assertTrue(all(not p['partners'] for p in self.get()['people']))
        self.review(proposal['proposal_id'])
        items={p['id']:p for p in self.get()['people']}
        self.assertEqual(items[b]['partners'],[{'person_id':a,'kind':'partner'}])
        stale=self.change(items[a],user='editor',notes='Old proposal')
        self.change(items[b],partners=[{'person_id':a,'kind':'spouse'}])
        self.review(stale['proposal_id'],status=409)
        for person in self.get()['people']:
            self.assertEqual(person['partners'][0]['kind'],'spouse')

    def test_partner_deleted_before_proposal_is_reviewed(self):
        partner=self.person('Partner')['id']
        proposal=self.person('Proposed',partners=[{'person_id':partner,'kind':'partner'}],user='editor')
        self.change(self.get()['people'][0],action='delete')
        self.review(proposal['proposal_id'],status=400)
        self.assertEqual(self.get()['people'],[])

    def test_delete_removes_partner_references(self):
        a=self.person('A')['id'];b=self.person('B',partners=[{'person_id':a,'kind':'spouse'}])['id']
        child=self.person('Child',parents=[a,b])['id']
        items={p['id']:p for p in self.get()['people']}
        self.change(items[a],action='delete')
        items2={p['id']:p for p in self.get()['people']}
        self.assertEqual(items2[b]['partners'],[])
        self.assertEqual(items2[b]['version'],items[b]['version']+1)
        self.assertEqual(items2[child]['parents'],[b])

    def test_legacy_update_preserves_new_fields(self):
        a=self.person('A',gender='male',birth_year=1900,death_year=1980)['id']
        current=self.get()['people'][0]
        self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':a,'version':current['version'],'data':{'name':'Legacy update','parents':[]}})
        p=self.get()['people'][0]
        self.assertEqual((p['gender'],p['death_year'],p['deceased']),('male',1980,True))

    def foreign(self):
        other=self.request('POST','/trees',{'title':'Other family'},user='admin')['id']
        pid=self.request('POST',f'/trees/{other}/changes',{'action':'create','data':{'name':'Private original','gender':'female','notes':'Private biography','birth_date':'1970-05-06'}},user='admin')['id']
        return other,pid

    def share_foreign(self,other,user='owner',role='viewer'):
        self.request('PUT',f'/trees/{other}/members',{'user_id':user,'role':role},user='admin')

    def reference(self,pid,action='link',user='owner',version=None,status=200):
        return self.request('POST',f'/trees/{self.tid}/references',{'action':action,'person_id':pid,'version':version},user=user,status=status)

    def test_live_reference_requires_access_and_does_not_copy(self):
        other,pid=self.foreign()
        self.reference(pid,status=404)
        self.share_foreign(other)
        self.reference(pid)
        p=self.get()['people'][0]
        self.assertEqual((p['id'],p['name'],p['home_tree_id'],p['in_current_tree']),(pid,'Private original',other,True))
        with self.module.database() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM people').fetchone()[0],1)
        original=self.request('GET',f'/trees/{other}',user='admin')['people'][0]
        self.request('POST',f'/trees/{other}/changes',{'action':'update','person_id':pid,'version':original['version'],'data':{'name':'Updated original'}},user='admin')
        self.assertEqual(self.get()['people'][0]['name'],'Updated original')
        self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':pid,'version':p['version'],'data':{'name':'Unauthorized overwrite'}},status=404)

    def test_cross_tree_partner_and_parent_links_without_source_write(self):
        other,mother=self.foreign();self.share_foreign(other)
        before=self.request('GET',f'/trees/{other}',user='admin')['people'][0]
        father=self.person('Father',gender='male')['id']
        p=self.get()['people'][0]
        self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':father,'version':p['version'],'references':[mother],'data':{'partners':[{'person_id':mother,'kind':'spouse'}]}})
        child=self.person('Child',parents=[father,mother])['id']
        after=self.request('GET',f'/trees/{other}',user='admin')['people'][0]
        self.assertEqual(after['version'],before['version'])
        self.assertEqual(after['stored_partners'],[])
        self.assertEqual(after['partners'],[{'person_id':father,'kind':'spouse'}])
        with self.module.database() as c:
            self.assertEqual(json.loads(c.execute('SELECT data FROM people WHERE id=?',(mother,)).fetchone()[0])['partners'],[])
        view=self.request('GET',f'/trees/{self.tid}?include_trees={other}')
        self.assertEqual(len(view['people']),3)
        self.assertEqual(len([p for p in view['people'] if p['id']==mother]),1)
        self.assertEqual(next(p for p in view['people'] if p['id']==mother)['partners'],[{'person_id':father,'kind':'spouse'}])
        self.assertEqual(next(p for p in view['people'] if p['id']==child)['parents'],[father,mother])
        self.assertEqual([t['id'] for t in view['view_trees']],[self.tid])
        self.assertTrue(all(p['view_tree_id']==self.tid for p in view['people']))

    def test_reverse_family_view_has_partner_and_child_without_copying(self):
        other,mother=self.foreign();self.share_foreign(other);self.reference(mother)
        father=self.person('Father',partners=[{'person_id':mother,'kind':'partner'}])['id']
        child=self.person('Son',parents=[father,mother])['id']
        source=self.request('GET',f'/trees/{other}')
        people={p['id']:p for p in source['people']}
        self.assertEqual(set(people),{mother,father,child})
        self.assertEqual(people[mother]['partners'],[{'person_id':father,'kind':'partner'}])
        self.assertEqual(people[mother]['stored_partners'],[])
        self.assertEqual(people[child]['parents'],[father,mother])
        for pid in (father,child):
            self.assertTrue(people[pid]['view_only']);self.assertFalse(people[pid]['in_current_tree'])
            self.assertEqual(people[pid]['home_tree_id'],self.tid)
            self.assertEqual(people[pid]['view_tree_id'],other)
            self.assertIsNone(people[pid]['reference_version'])
        combined=self.request('GET',f'/trees/{other}?include_trees={self.tid}')
        self.assertEqual({p['id'] for p in combined['people']},{mother,father,child})
        self.assertTrue(all(p['view_tree_id']==other for p in combined['people']))
        self.assertEqual([t['id'] for t in combined['view_trees']],[other])
        original={p['id']:p for p in self.get()['people']}
        self.assertIn(other,original[father]['linked_tree_ids']);self.assertIn(other,original[child]['linked_tree_ids'])
        with self.module.database() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM people WHERE tree_id=?',(other,)).fetchone()[0],1)
            self.assertEqual(c.execute('SELECT COUNT(*) FROM person_refs WHERE tree_id=?',(other,)).fetchone()[0],0)
            row=c.execute('SELECT data,version FROM people WHERE id=?',(mother,)).fetchone()
            self.assertEqual(json.loads(row[0])['partners'],[]);self.assertEqual(row[1],1)

    def test_reverse_child_brings_coparent_without_assuming_partnership(self):
        other,mother=self.foreign();self.share_foreign(other);self.reference(mother)
        father=self.person('Coparent')['id'];child=self.person('Child',parents=[mother,father])['id']
        self.person('Unrelated private family member')
        people={p['id']:p for p in self.request('GET',f'/trees/{other}')['people']}
        self.assertEqual(set(people),{mother,father,child})
        self.assertEqual(people[mother]['partners'],[])
        self.assertEqual(people[father]['partners'],[])

    def test_reverse_projection_checks_access_and_disappears_after_unlink(self):
        other,mother=self.foreign();self.share_foreign(other);self.reference(mother)
        father=self.person('Foreign partner',partners=[{'person_id':mother,'kind':'partner'}])['id']
        child=self.person('Foreign child',parents=[mother,father])['id']
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'admin','role':'remove'})
        hidden=self.request('GET',f'/trees/{other}',user='admin')
        self.assertEqual([p['id'] for p in hidden['people']],[mother])
        self.assertNotIn(father,json.dumps(hidden));self.assertNotIn(child,json.dumps(hidden))
        visible=self.request('GET',f'/trees/{other}')
        self.assertEqual(len(visible['people']),3)
        version=next(p for p in self.get()['people'] if p['id']==mother)['reference_version']
        self.reference(mother,'unlink',version=version)
        self.assertEqual([p['id'] for p in self.request('GET',f'/trees/{other}')['people']],[mother])

    def test_revoked_origin_is_redacted_and_cannot_expand(self):
        other,pid=self.foreign();self.share_foreign(other);self.reference(pid)
        # A member of only the destination never receives the source's attributes.
        view=self.get(user='viewer')
        redacted=view['people'][0]
        self.assertTrue(redacted['redacted']);self.assertEqual(redacted['name'],'');self.assertEqual(redacted['notes'],'')
        self.assertEqual(redacted['home_tree_title'],None);self.assertEqual(view['linked_trees'],[])
        self.assertNotIn('Private biography',json.dumps(view))
        self.request('PUT',f'/trees/{other}/members',{'user_id':'owner','role':'remove'},user='admin')
        view=self.get()
        self.assertTrue(view['people'][0]['redacted'])
        self.assertNotIn('Private original',json.dumps(view));self.assertNotIn('Private biography',json.dumps(view))
        single=self.request('GET',f'/trees/{self.tid}?include_trees={other}')
        self.assertEqual([t['id'] for t in single['view_trees']],[self.tid])
        self.assertNotIn('Private biography',json.dumps(single))

    def test_reference_editor_review_and_revocation(self):
        other,pid=self.foreign();self.share_foreign(other,'editor');self.share_foreign(other)
        proposal=self.reference(pid,user='editor')
        self.assertEqual(self.get()['people'],[])
        self.assertEqual(self.get()['reference_names'][pid],'Private original')
        self.request('PUT',f'/trees/{other}/members',{'user_id':'editor','role':'remove'},user='admin')
        self.review(proposal['proposal_id'],status=404)
        self.share_foreign(other,'editor')
        self.review(proposal['proposal_id'])
        version=self.get()['people'][0]['reference_version']
        removal=self.reference(pid,'unlink',user='editor',version=version)
        self.assertEqual(len(self.get()['people']),1)
        self.review(removal['proposal_id'])
        self.assertEqual(self.get()['people'],[])
        self.assertEqual(len(self.request('GET',f'/trees/{other}',user='admin')['people']),1)

    def test_reference_viewer_cannot_mutate_and_stale_unlink(self):
        other,pid=self.foreign();self.share_foreign(other);self.share_foreign(other,'viewer')
        self.reference(pid,user='viewer',status=403)
        self.reference(pid)
        version=self.get()['people'][0]['reference_version']
        self.reference(pid,'unlink',version=version)
        self.reference(pid)
        self.reference(pid,'unlink',version=version,status=409)

    def test_source_deletion_cleans_foreign_connections(self):
        other,pid=self.foreign();self.share_foreign(other);self.reference(pid)
        child=self.person('Child',parents=[pid])['id']
        origin=self.request('GET',f'/trees/{other}',user='admin')['people'][0]
        self.request('POST',f'/trees/{other}/changes',{'action':'delete','person_id':pid,'version':origin['version']},user='admin')
        people=self.get()['people'];self.assertEqual(len(people),1)
        self.assertEqual((people[0]['id'],people[0]['parents']),(child,[]))
        self.assertEqual(people[0]['version'],2)

    def test_source_tree_deletion_cleans_references(self):
        other,pid=self.foreign();self.share_foreign(other);self.reference(pid)
        self.person('Child',parents=[pid])
        self.request('DELETE',f'/trees/{other}',user='admin')
        self.assertEqual(len(self.get()['people']),1)
        self.assertEqual(self.get()['people'][0]['parents'],[])
        with self.module.database() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM person_refs').fetchone()[0],0)

    def test_cross_tree_cycle_and_unapproved_reference_are_rejected(self):
        other,pid=self.foreign();self.share_foreign(other)
        native=self.person('Parent')['id']
        self.request('POST',f'/trees/{self.tid}/changes',{'action':'update','person_id':native,'version':1,'references':[pid],'data':{'parents':[pid]}})
        # Admin of the other tree must also have access to this tree before linking back.
        self.request('POST',f'/trees/{other}/changes',{'action':'update','person_id':pid,'version':1,'references':[native],'data':{'parents':[native]}},user='admin',status=400)
        self.assertEqual(self.request('GET',f'/trees/{other}',user='admin')['people'][0]['parents'],[])

    def test_reference_can_be_shared_across_three_trees_without_duplicates(self):
        other,pid=self.foreign();self.share_foreign(other);self.reference(pid)
        third=self.request('POST','/trees',{'title':'Third tree'})['id']
        self.request('POST',f'/trees/{third}/references',{'action':'link','person_id':pid})
        view=self.request('GET',f'/trees/{self.tid}?include_trees={other},{third}')
        self.assertEqual(len(view['people']),1)
        self.assertEqual(set(view['people'][0]['linked_tree_ids']),{self.tid,other,third})
        self.assertEqual([t['id'] for t in view['view_trees']],[self.tid])


if __name__=='__main__':
    unittest.main()
