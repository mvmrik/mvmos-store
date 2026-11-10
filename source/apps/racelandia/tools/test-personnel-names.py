"""All recruitable people use persistent Game Hub identities, including migrated staff."""
import importlib.util
import json
import tempfile
from pathlib import Path
from name_service_fixture import install
install()
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('personnel_data',ROOT/'apps/racelandia/apex_data.py')
data=importlib.util.module_from_spec(spec);spec.loader.exec_module(data)
def identity(p):
 i=p['name_identity'];assert i['country'] and i['gender'] in ('male','female') and i['native'] and i['latin'];return i
with tempfile.TemporaryDirectory(prefix='racelandia-personnel-') as scratch:
 data._DB=str(Path(scratch)/'career.db');pid='personnel-test';d=data.get_driver(pid,'Test Manager')
 offers=data.recruit_offers(pid);assert len(offers)==4
 for p in offers:identity(p)
 first=offers[0];assert data.recruit_driver(pid,first['id']) is None
 d=data.get_driver(pid);assert identity(d)==identity(first)
 cars=data.public_team(d)['cars'];assert data.team_action(pid,'assign',car=cars[0]['id'],pilot=d['pilot_id']) is None
 first_id=d['pilot_id'];first_identity=identity(d)
 second=data.recruit_offers(pid)[0];assert data.recruit_driver(pid,second['id']) is None
 d=data.get_driver(pid);second_id=d['pilot_id'];assert data.team_action(pid,'assign',car=cars[1]['id'],pilot=second_id) is None
 pilots=data.public_team(data.get_driver(pid))['pilots'];assert all(identity(p) for p in pilots)
 data.set_name(pid,'My Champion');d=data.get_driver(pid);assert d['name']=='My Champion' and identity(d)['custom_name']=='My Champion'
 with data._connect() as conn:
  assert data.team.select(conn,d,'pilot',first_id) is None
 d=data.get_driver(pid);assert identity(d)==first_identity
 with data._connect() as conn:
  assert data.team.select(conn,d,'pilot',second_id) is None
 d=data.get_driver(pid);assert d['name']=='My Champion'
 staff=data.public_specialists(d);crew=data.public_crew(d)
 assert all(identity(o) for pool in staff['market'].values() for o in pool)
 assert all(identity(o) for pool in crew['market'].values() for o in pool)
 role=staff['roles'][0];offer=staff['market'][role][0];assert data.specialist_hire(pid,role,offer['id']) is None
 d=data.get_driver(pid);hired=data.public_specialists(d)['members'][role];assert identity(hired)==identity(offer)
 position=crew['positions'][0]['id'];offer=crew['market'][position][0];car=cars[0]['id']
 assert data.crew_hire(pid,car,position,offer['id']) is None
 d=data.get_driver(pid);member=data.public_crew(d)['cars'][car]['members'][position];assert identity(member)==identity(offer)
 # Simulate old stored profiles and verify migration changes only identity fields.
 before={}
 with data._connect() as conn:
  for table,name in [('crew_member','Ben Archer'),('staff_member','Ada Abbott')]:
   row=conn.execute(f'SELECT id,profile FROM {table} WHERE player_id=?',(pid,)).fetchone();p=json.loads(row['profile']);p.pop('name_identity');p['name']=name
   before[table]=(row['id'],{k:v for k,v in p.items() if k not in ('name','energy','energy_ts')})
   conn.execute(f'UPDATE {table} SET profile=? WHERE id=?',(json.dumps(p),row['id']))
  conn.execute("UPDATE driver SET name='Alex Morgan',name_identity='{}' WHERE player_id=?",(pid,))
  for table in ['team_offer','crew_offer','staff_offer']:
   row=conn.execute(f'SELECT id,profile FROM {table} WHERE player_id=? LIMIT 1',(pid,)).fetchone();p=json.loads(row['profile']);p.pop('name_identity',None)
   conn.execute(f'UPDATE {table} SET profile=? WHERE id=?',(json.dumps(p),row['id']))
 d=data.get_driver(pid);assert identity(d) and d['name']!='Alex Morgan';migrated=identity(d)
 for _ in range(2):assert identity(data.get_driver(pid))==migrated
 with data._connect() as conn:
  for table,(ident,old) in before.items():
   p=json.loads(conn.execute(f'SELECT profile FROM {table} WHERE id=?',(ident,)).fetchone()[0]);identity(p)
   assert {k:v for k,v in p.items() if k not in ('name','name_identity','energy','energy_ts')}==old
  for table in ['team_offer','crew_offer','staff_offer']:
   assert all(identity(json.loads(r['profile'])) for r in conn.execute(f'SELECT profile FROM {table} WHERE player_id=?',(pid,)))
 # Nationalities and spellings survive career archives and restoration.
 started=d['created'];assert data.reset_career(pid,started) is None
 fresh=data.get_driver(pid);assert data.restore_career(pid,fresh['created']) is None
 restored=data.get_driver(pid);assert identity(restored)==migrated
print('PASS: generated pilot/crew/specialist markets, hiring, assignment, custom pilot names, legacy migration, unchanged skills/contracts, stable identities and archive restoration.')
