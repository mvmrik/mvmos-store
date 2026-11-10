import asyncio,importlib.util,json,pathlib,sqlite3,tempfile,random
import httpx
from fastapi import FastAPI,Request,HTTPException
ROOT=pathlib.Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('catalogue_test',ROOT/'backend/apps/gamehub/names.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
temp=tempfile.TemporaryDirectory();db_path=pathlib.Path(temp.name)/'catalogue.db'
def db():
 c=sqlite3.connect(db_path);c.row_factory=sqlite3.Row;return c

def session(request:Request):
 role=request.headers.get('X-Test-Role')
 if not role:raise HTTPException(401)
 return {'effective_user':role}
app=FastAPI();app.include_router(mod.make_router(db,session))
async def main():
 # A saved identity is rendered through one common script policy for all consumers.
 for code, native, latin in [('BG','Никола Димитров','Nikola Dimitrov'),('RU','Иван Петров','Ivan Petrov')]:
  identity=dict(country=code,native=native,latin=latin)
  for language in ['bg','ru','bg-BG','ru-RU','ru_RU']:
   assert mod.display_name(identity,language)==native
  for language in ['en','de','es','fr','pt-BR','ja','zh-CN','unknown']:
   assert mod.display_name(identity,language)==latin
 assert mod.display_name(dict(country='JP',native='佐藤 一郎',latin='Sato Ichiro'),'ja')=='佐藤 一郎'
 assert mod.display_name(dict(country='JP',native='佐藤 一郎',latin='Sato Ichiro'),'zh-CN')=='Sato Ichiro'
 assert mod.display_name(dict(country='CN',native='王伟',latin='Wang Wei'),'zh-CN')=='王伟'
 assert mod.display_name(dict(country='CN',native='王伟',latin='Wang Wei'),'ja')=='Wang Wei'
 with db() as conn:
  a=mod.generate(conn,country='BG',gender='mixed',rng=random.Random(8),count=50)
  b=mod.generate(conn,country='BG',gender='mixed',rng=random.Random(8),count=50)
  assert a==b and {v['gender'] for v in a}=={'male','female'}

 for code,data in mod.defaults().items():
  expected=mod.TEAM_GROUPS if code=='teams' else mod.PERSON_GROUPS
  assert set(data['groups'])==set(expected)
  for group,rows in data['groups'].items():
   assert len(rows)==100,(code,group)
   assert len({v[0].casefold() for v in rows})==100,(code,group)
   for native,latin in rows:
    assert mod.clean(native)==native
    assert mod.latin_text(latin)==latin,(code,native,latin)
 async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as c:
  base='/api/gamehub/names';root={'X-Test-Role':'root'};user={'X-Test-Role':'viewer'}
  assert (await c.get(base)).status_code==401
  idx=(await c.get(base,headers=root)).json();assert len(idx['countries'])==10 and idx['editable']
  assert not (await c.get(base,headers=user)).json()['editable']
  for code in mod.defaults():
   d=(await c.get(base+'/'+code,headers=root)).json();assert d['total']==100 and len(d['entries'])==50
   assert len((await c.get(base+'/'+code,params={'offset':50},headers=root)).json()['entries'])==50
   for lang in ['en','bg','ru','ja','zh-CN']:
    r=await c.post(base+'/preview',headers=root,json={'country':code,'lang':lang,'count':50})
    assert r.status_code==200,r.text
    rows=r.json()['examples'];assert len(rows)==50 and len({v['latin'] for v in rows})==50
    use_native = (code in ('BG','RU') and lang in ('bg','ru')) or (code=='JP' and lang=='ja') or (code=='CN' and lang=='zh-CN')
    assert all(v['display']==v['native' if use_native else 'latin'] for v in rows)
  body={'category':'male_first','native':'Пробноиме','latin':'Testname'}
  assert (await c.post(base+'/BG/entries',headers=user,json=body)).status_code==403
  assert (await c.post(base+'/BG/entries',json=body)).status_code==401
  assert (await c.post(base+'/BG/entries',headers=root,json=dict(body,latin='Кирилица'))).status_code==422
  assert (await c.post(base+'/BG/entries',headers=root,json=dict(body,native='<script>'))).status_code==422
  assert (await c.post(base+'/BG/entries',headers=root,json=dict(body,native='Иван'))).status_code==409
  entry=(await c.post(base+'/BG/entries',headers=root,json=body)).json();assert entry['custom']
  assert (await c.post(base+'/BG/entries',headers=root,json=body)).status_code==409
  found=(await c.get(base+'/BG',params={'q':'Testname'},headers=root)).json();assert found['total']==1
  # A fresh connection still sees the local addition; defaults stay unchanged.
  assert len(mod.defaults()['BG']['groups']['male_first'])==100
  assert (await c.delete(base+'/BG/entries/'+entry['id'],headers=user)).status_code==403
  assert (await c.delete(base+'/BG/entries/'+entry['id'],headers=root)).status_code==200
  assert (await c.delete(base+'/BG/entries/'+entry['id'],headers=root)).status_code==404
  assert (await c.get(base+'/../foo',headers=root)).status_code==404
  assert (await c.get(base+'/BG',params={'category':'bogus'},headers=root)).status_code==422
  assert (await c.get(base+'/BG',params={'limit':1000},headers=root)).status_code==422
  for path,bad in [('teams',{'category':'prefix','native':'Кирилица','latin':'Kirilitsa'}),('BG',{'category':'prefix','native':'Hello','latin':'Hello'})]:
   assert (await c.post(base+'/'+path+'/entries',headers=root,json=bad)).status_code==422
  # No fixed total limit on administrator additions.
  for i in range(110):
   assert (await c.post(base+'/BG/entries',headers=root,json={'category':'male_first','native':f'Test {i}','latin':f'Test {i}'})).status_code==200
  assert (await c.get(base+'/BG',headers=root)).json()['total']==210
 print('PASS: 3,800 defaults, nine countries, gender categories, Latin spelling, local-language display, teams, paging, search, persistence, duplicate handling, input validation, administrator and anonymous access, more than 100 custom additions.')
asyncio.run(main())
