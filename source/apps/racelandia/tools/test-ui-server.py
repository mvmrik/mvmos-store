# Isolated browser fixture: venv/bin/python apps/racelandia/tools/test-ui-server.py
# Uses a temporary database and synthetic users; listens on localhost only.
import importlib.util,json,tempfile,os,sys
from pathlib import Path
from fastapi import FastAPI,Request
from fastapi.responses import HTMLResponse,FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
ROOT=Path(__file__).resolve().parents[3]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,str(ROOT/'apps/racelandia'/file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
api=load('test_api','api.py');mp=load('test_mp','mp_game.py');scratch=tempfile.TemporaryDirectory(prefix='racelandia-browser-');pid='browser-test';user={'id':pid,'display_name':'Test Manager'}
fc=[dict(air=24,track=38,cloud=.1,rain=0,water=0,sun=.8,hum=45,rubber=.975) for _ in range(24)]
for d in [api.data,mp.data]:
 d._DB=scratch.name+'/test.db';d.weather_of=lambda d,t:dict(forecast=fc,live=False,now=12,now_frac=12,hour=12,date=None);d.division_weather=lambda d:None
api._user=lambda r:user
d=api.data;d.get_driver(pid,'Test Manager');d._update(pid,budget=50000000,licences=sorted(d.tracks.official()),license_unlocked=1)
for car in d.public_team(d.get_driver(pid))['cars']:
 offer=d.recruit_offers(pid)[0];assert d.recruit_driver(pid,offer['id']) is None
 d._update(pid,skills={k:70 for k in d.SKILLS},potential={k:95 for k in d.SKILLS},energy=100)
 pilot=d.get_driver(pid)['pilot_id'];assert d.team_action(pid,'assign',car=car['id'],pilot=pilot) is None
assert d.buy_tyres_many(pid,{'M':4,'S':2,'H':2}) is None
class Ctx:
 host_id=pid
 def __init__(self):self.out=[]
 def all_players(self):return [user]
 def players(self):return [user]
 async def send(self,pid,msg):self.out.append(msg)
 async def broadcast(self,msg,exclude=None):
  if exclude!=pid:self.out.append(msg)
 async def finish(self,*a,**kw):pass
ctx=Ctx();game=mp.Game(ctx);app=FastAPI();app.include_router(api.router,prefix='/pub/racelandia')
@app.post('/test/message')
async def message(r:Request):
 ctx.out=[];await game.on_message(user,await r.json());return ctx.out
@app.get('/api/settings/display')
def display():return {}
@app.post('/test/recover')
def recover():
 conn=d._connect()
 for row in conn.execute('SELECT id,profile FROM team_pilot WHERE player_id=?',(pid,)).fetchall():
  profile=json.loads(row['profile']);profile['energy']=100;profile['energy_ts']=__import__('time').time();conn.execute('UPDATE team_pilot SET profile=? WHERE id=?',(json.dumps(profile),row['id']))
 conn.commit();conn.close();d._update(pid,energy=100);return {'ok':True}
@app.get('/test/fixture')
def fixture():return api.garage(user)
@app.get('/')
def index():
 return HTMLResponse('''<!doctype html><meta charset="utf-8"><style>html,body,#root{height:100%;margin:0}body{--bg:#0d1420;--fg:#e5edf9;--muted:#a8b5c8;--border:#344257;--accent:#526cff;--on-accent:#fff;font:14px Arial}</style><link rel="stylesheet" href="/apps/racelandia/public/style.css"><div id="root"></div><script>
 window.asset=p=>p+(p.includes('?')?'&':'?')+'v=test';window.mvmOS={lang:'en'};window.t=(k,v)=>{let s=window._i18n?.[k]||k;for(const [a,b]of Object.entries(v||{}))s=s.replaceAll('{'+a+'}',b);return s};
 const handlers={};window.GameHub={getToken:()=>'',mp:{on:(t,f)=>(handlers[t]??=[]).push(f),isHost:()=>true,registerGame:g=>{window.game=g;g.renderGame(document.querySelector('#root'))},send:async m=>{window.sent??=[];window.sent.push(m);const msgs=await(await fetch('/test/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)})).json();for(const msg of msgs){window.messages??=[];window.messages.push(msg);for(const f of handlers[msg.type]||[])await f(msg)}}}};
 </script><script src="/apps/racelandia/public/i18n.js"></script><script src="/apps/racelandia/public/mp.js"></script>''')
@app.get('/pub/racelandia/tracks.json')
def catalog():return FileResponse(ROOT/'apps/racelandia/public/tracks.json')
@app.get('/favicon.ico')
def favicon():return HTMLResponse('',status_code=204)
@app.get('/datetime-picker.js')
def dates():return FileResponse(ROOT/'frontend/datetime-picker.js')
@app.get('/apps/racelandia/{file:path}')
def static(file:str):
 # App public assets are available through both production URL conventions.
 target=(ROOT/'apps/racelandia'/file) if file.startswith('public/') else (ROOT/'apps/racelandia/public'/file)
 if not target.is_file():return FileResponse(ROOT/'apps/racelandia'/file)
 return FileResponse(target)
uvicorn.run(app,host='127.0.0.1',port=2187,log_level='warning')
