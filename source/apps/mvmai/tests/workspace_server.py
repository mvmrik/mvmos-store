"""Local, disposable fixture for the real workspace browser tests."""
import asyncio
import json
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from test_agents import AgentTests, agent

fixture=AgentTests();asyncio.run(fixture.asyncSetUp())
app=FastAPI();root=Path(__file__).resolve().parents[1];calls=0

def call(name,args,cid):return {'id':cid,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}

async def model(body,*args):
    global calls
    calls+=1
    source="import json,sys\nd=json.load(sys.stdin)\np=d['params']['percent']\nprint(json.dumps({'summary':'Calculated result','columns':['Before','After'],'rows':[{'Before':100,'After':100*(1+p/100)}]}))"
    context=fixture.api._AGENT_CONTEXT.get()
    assert 'workspace_present' in {s['function']['name'] for s in context['tools']}
    content='Project organized' if calls%2 else 'Selection received'
    tools=[call('workspace_overview',{'summary':'A general project workspace'},'overview'),
        call('workspace_remember',{'title':'Project notes','content':'Known facts and decisions','source':'Initial research'},'note'),
        call('workspace_present',{'title':'Choose scope','description':'Choose what to work on','kind':'form','fields':[{'name':'scope','label':'Scope','type':'select','required':True,'options':[{'value':'all','label':'All'},{'value':'some','label':'Some'}]}]},'view'),
        call('workspace_save_tool',{'title':'Reusable percentage','description':'Calculate a reusable percentage','source':source,'fields':[{'name':'percent','label':'Percentage','type':'number','required':True,'min':-90,'max':1000}]},'tool'),
        call('agent_save_item',{'title':'Understand the project','status':'completed','result':'Organized'},'item'),
        call('agent_finish',{'result':'Ready'},'finish')]
    # Follow-ups keep the existing project structures intact.
    if any('Choose scope' in str(m.get('content')) for m in body.messages):
        tools=[call('agent_save_item',{'title':'Handle the selection','status':'completed','result':'Selection received'},'item'),call('agent_finish',{'result':'Done'},'finish')]
    return JSONResponse({'message':{'role':'assistant','content':content,'tool_calls':tools}})
fixture.api._chat=model

@app.get('/')
async def index():return HTMLResponse('<style>html,body{height:100%;margin:0}#root{height:100%}</style><div id="root"></div>')
@app.get('/test/state')
async def state():return {'model_calls':calls}
@app.get('/pub/mvmai/me')
async def me():return {'id':'a','is_admin':True,'agents':True,'bridge_premium':True,'provider':'fake','model':'model-a'}
@app.get('/pub/mvmai/premium/agents.js')
async def asset():return Response((root/'premium/public/workspaces.js').read_text()+'\n'+(root/'premium/public/agents.js').read_text(),media_type='application/javascript')
@app.api_route('/pub/mvmai/agents/{path:path}',methods=['GET','POST','DELETE','PATCH'])
async def dispatch(path:str,request:Request,x_pub_token:str=Header(default=None)):
    try:me=agent.access(fixture.api,x_pub_token)
    except PermissionError:return JSONResponse({'error':'forbidden'},status_code=403)
    return await agent.route(fixture.api,request,path,me,x_pub_token,'',None)
@app.get('/pub/mvmai/{path:path}')
async def empty(path:str):
    if path=='projects':return {'projects':[]}
    if path=='sessions':return {'sessions':[]}
    return {}

if __name__=='__main__':uvicorn.run(app,host='127.0.0.1',port=int(sys.argv[1]),log_level='error')
