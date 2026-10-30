"""Agent isolation, reviews, background lifecycle and recovery without paid models."""
import ast
import asyncio
import contextvars
import importlib.util
import json
import os
import sqlite3
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import Depends, Header, Request
from fastapi.responses import JSONResponse, Response

ROOT = Path(__file__).resolve().parents[3]
if not (ROOT/'apps/mvmai/premium/agents.py').is_file():
    raise unittest.SkipTest('Premium agent module is not installed')
spec = importlib.util.spec_from_file_location('tested_agents', ROOT/'apps/mvmai/premium/agents.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)


def extract(names, ns):
    nodes = []
    for node in ast.parse((ROOT/'apps/mvmai/api.py').read_text()).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            nodes.append(node)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),'api.py','exec'),ns)


class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        path = os.path.join(self.folder.name,'data.db')
        def db():
            conn = sqlite3.connect(path); conn.row_factory = sqlite3.Row; return conn
        schema = {'_sdb':db}
        extract({'_ensure_tables'},schema);schema['_ensure_tables']()
        self.cfg = {'agents_enabled':True,'pub_exec_enabled':True,'exec_enabled':True,'provider':'fake','model':'model-a'}
        self.users = {'admin':{'id':'a','is_admin':True},'other':{'id':'b','is_admin':True},'member':{'id':'c','is_admin':False}}
        self.premium = True
        self.prem = types.SimpleNamespace(agents_enabled=lambda cfg:self.premium and cfg.get('agents_enabled'),resolve_pub_cfg=lambda cfg:cfg,is_available=lambda:self.premium)
        self.desk = types.SimpleNamespace(CHAT_TURN=contextvars.ContextVar('turn',default=None),_read_cfg=lambda:dict(self.cfg),PROVIDERS={'fake':{}},CLI_PROVIDERS=[],_get_project=lambda pid:{'id':pid} if pid=='project' else None,kill_process=lambda proc:None,_wrap_as_user=lambda argv,user:argv,resolve_project_cwd=lambda pid:self.folder.name,_home_for=lambda user:self.folder.name)
        self.api = types.SimpleNamespace(_sdb=db,_DB_PATH=path,_resolve=lambda token:self.users.get(token),_premium=lambda:self.prem,_desktop=lambda:self.desk,_LANG_NAMES={'en':'English'},_AGENT_CONTEXT=contextvars.ContextVar('agent',default=None),ChatRequest=lambda **kw:types.SimpleNamespace(**kw),_forget_cli_sessions=lambda rows:None)
        self.outputs = []
        async def model(body,*args):
            self.assertIsNotNone(self.api._AGENT_CONTEXT.get())
            return JSONResponse({'message':self.outputs.pop(0)})
        self.api._chat = model
        agent.initialize(self.api)
    async def asyncTearDown(self):
        jobs = list(agent.JOBS.values())
        for worker in jobs: worker.cancel()
        if jobs: await asyncio.gather(*jobs,return_exceptions=True)
        agent.JOBS.clear();agent.INITIALIZED.discard(self.api._DB_PATH)
        self.folder.cleanup()
    async def request(self,path,body=None,method=None,token='admin'):
        req=types.SimpleNamespace(method=method or ('POST' if body is not None else 'GET'),headers={})
        async def data():return body
        req.json=data
        return await agent.route(self.api,req,path,self.users[token],token,'',None)
    async def create(self,**kw):
        response=await self.request('tasks',{'title':'Campaign','goal':'Research suitable sites','lang':'en',**kw})
        self.assertEqual(response.status_code,200,response.body)
        return json.loads(response.body)['task']
    def stored(self,task):return agent.load(self.api,task['id'],'a')
    async def run_task(self,task):
        response=await self.request('tasks/'+task['id']+'/start',{})
        self.assertEqual(response.status_code,200,response.body)
        worker=agent.JOBS[task['id']]
        await worker
        return self.stored(task)
    def call(self,name,args,id='call1'):
        return {'id':id,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}

    async def test_plan_model_selection_and_separate_normal_sessions(self):
        now=int(time.time())
        with self.api._sdb() as c:
            c.execute("INSERT INTO pub_sessions(id,user_id,title,provider,model,project_id,created_at,updated_at,last_message_at) VALUES ('chat','a','Existing','fake','pinned','project',?,?,?)",(now,now,now))
        task=await self.create(source_chat_id='chat')
        self.assertEqual((task['provider'],task['model'],task['project_id']),('fake','pinned','project'))
        original=self.stored(task);self.assertNotEqual(original['session_id'],'chat')
        ns={'_resolve':self.api._resolve,'_sdb':self.api._sdb,'JSONResponse':JSONResponse,'Header':Header,'_desktop':lambda:None,'_archive_stale':lambda *a:None}
        extract({'list_sessions'},ns)
        rows=json.loads((await ns['list_sessions']('admin')).body)['sessions']
        self.assertEqual([r['id'] for r in rows],['chat'])
        self.assertNotIn('messages',task);self.assertNotIn('session_id',task)
        self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_save_item',{'title':'Research','status':'completed','result':'Checked sources'}),self.call('agent_finish',{'result':'Research completed'},'finish')]}]
        result=await self.run_task(task)
        self.assertEqual(result['status'],'completed');self.assertEqual(len(result['items']),1)
        with self.api._sdb() as c:self.assertEqual(c.execute("SELECT model FROM pub_sessions WHERE id='chat'").fetchone()[0],'pinned')

    async def test_exact_approval_no_execution_until_continue_and_no_replay(self):
        task=await self.create()
        command=self.call('agent_run_command',{'command':'printf approved','reason':'Publish exact draft','content':'Exact draft','destination':'https://example.com','account':'owner'})
        self.outputs=[{'role':'assistant','tool_calls':[command]}]
        execute=AsyncMock(return_value={'code':0,'stdout':'approved'})
        with patch.object(agent,'execute_command',execute):
            result=await self.run_task(task)
            self.assertEqual(result['status'],'awaiting_approval');execute.assert_not_called()
            pending=result['pending'][0]
            denied=await self.request('tasks/'+task['id']+'/review',{'id':pending['id'],'decision':'approve'},token='other')
            self.assertEqual(denied.status_code,404)
            busy=await self.request('tasks/'+task['id']+'/start',{})
            self.assertEqual(busy.status_code,400)
            response=await self.request('tasks/'+task['id']+'/review',{'id':pending['id'],'decision':'approve','command':'malicious replacement'})
            self.assertEqual(response.status_code,200);execute.assert_not_called()
            duplicate=await self.request('tasks/'+task['id']+'/review',{'id':pending['id'],'decision':'approve'})
            self.assertEqual(duplicate.status_code,400)
            self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_wait',{'next_action':'Verify the published page'})]}]
            result=await self.run_task(task)
            self.assertEqual(execute.await_args.args[2]['command'],'printf approved')
            self.assertEqual(execute.await_count,1)
            self.outputs=[{'role':'assistant','content':'Waiting for evidence'}]
            await self.run_task(task);self.assertEqual(execute.await_count,1)

    async def test_rejection_and_feedback_wait_for_tool_results(self):
        task=await self.create()
        self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_run_command',{'command':'true','reason':'Test'})]}]
        result=await self.run_task(task)
        response=await self.request('tasks/'+task['id']+'/feedback',{'message':'Changed'})
        self.assertEqual(response.status_code,400)
        await self.request('tasks/'+task['id']+'/review',{'id':result['pending'][0]['id'],'decision':'reject'})
        stored=self.stored(task);self.assertIn('cancelled',stored['messages'][-1]['content'])
        response=await self.request('tasks/'+task['id']+'/feedback',{'message':'Use another destination'})
        self.assertEqual(response.status_code,200)

    async def test_waiting_and_completed_item_validation_is_atomic(self):
        task=await self.create();stored=self.stored(task)
        with self.assertRaisesRegex(ValueError,'next_action_required'):agent.update_item(stored,{'title':'Forum','status':'awaiting_user'})
        self.assertEqual(stored['items'],[])
        item=agent.update_item(stored,{'title':'Forum','kind':'site','status':'planned'})
        with self.assertRaisesRegex(ValueError,'evidence_required'):agent.update_item(stored,{'id':item['id'],'title':'Forum','status':'completed','result':'Published'})
        self.assertEqual(stored['items'][0]['status'],'planned')
        with self.assertRaisesRegex(ValueError,'invalid_url'):agent.update_item(stored,{'id':item['id'],'title':'Forum','url':'javascript:alert(1)'})
        agent.save(self.api,stored)
        self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_finish',{'result':'Done'})]},{'role':'assistant','content':'Need to finish the forum entry'}]
        result=await self.run_task(task);self.assertNotEqual(result['status'],'completed')
        self.assertIn('unfinished_items',json.dumps(result['messages']))

    async def test_pause_cancels_model_and_duplicate_start_is_rejected(self):
        task=await self.create();entered=asyncio.Event()
        async def slow(*args):entered.set();await asyncio.sleep(99)
        self.api._chat=slow
        await self.request('tasks/'+task['id']+'/start',{});await entered.wait()
        again=await self.request('tasks/'+task['id']+'/start',{});self.assertEqual(again.status_code,409)
        response=await self.request('tasks/'+task['id']+'/pause',{})
        self.assertEqual(json.loads(response.body)['task']['status'],'paused');self.assertNotIn(task['id'],agent.JOBS)

    async def test_pause_immediately_after_start_does_not_leave_busy_worker(self):
        task=await self.create()
        await self.request('tasks/'+task['id']+'/start',{})
        await self.request('tasks/'+task['id']+'/pause',{})
        await asyncio.sleep(0)
        self.assertNotIn(task['id'],agent.JOBS);self.assertEqual(self.stored(task)['status'],'paused')

    async def test_revocation_stops_background_model(self):
        task=await self.create();entered=asyncio.Event()
        async def slow(*args):entered.set();await asyncio.sleep(99)
        self.api._chat=slow
        await self.request('tasks/'+task['id']+'/start',{});await entered.wait()
        worker=agent.JOBS[task['id']];self.premium=False
        with self.assertRaises(asyncio.CancelledError):await asyncio.wait_for(worker,3)
        self.assertEqual(self.stored(task)['status'],'paused')
        self.assertEqual(self.stored(task)['events'][-1]['code'],'access_revoked')

    async def test_restart_never_replays_an_action_of_unknown_outcome(self):
        task=await self.create();stored=self.stored(task);stored['status']='running'
        stored['pending']=[{'id':'p','call_id':'c','status':'executing','arguments':{'command':'publish'}}]
        agent.save(self.api,stored);agent.INITIALIZED.remove(self.api._DB_PATH);agent.initialize(self.api)
        stored=self.stored(task);self.assertEqual(stored['status'],'paused');self.assertEqual(stored['pending'][0]['status'],'unknown')
        self.outputs=[{'role':'assistant','content':'Verify first'}]
        with patch.object(agent,'execute_command',AsyncMock()) as execute:
            await self.run_task(task);execute.assert_not_called()

    async def test_round_limit_and_server_access_checks(self):
        task=await self.create(max_rounds=1)
        self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_save_item',{'title':'Check sources'})]}]
        result=await self.run_task(task);self.assertEqual(result['status'],'paused');self.assertEqual(result['rounds'],1)
        for token in ['member',None]:
            with self.assertRaises(PermissionError):agent.access(self.api,token)
        self.cfg['agents_enabled']=False
        with self.assertRaises(PermissionError):agent.access(self.api,'admin')
        self.cfg['agents_enabled']=True;self.premium=False
        with self.assertRaises(PermissionError):agent.access(self.api,'admin')

    async def test_command_requires_current_server_execution_permission(self):
        task=await self.create();self.cfg['pub_exec_enabled']=False
        names=[x['function']['name'] for x in agent.tools(self.api,task,'',None)]
        self.assertNotIn('agent_run_command',names)
        with self.assertRaises(PermissionError):await agent.execute_command(self.api,task,{'command':'true'},'admin','',None)

    async def test_public_web_rejects_private_destinations_and_bad_schemes(self):
        for url in ['file:///etc/passwd','http://127.0.0.1','http://[::1]/','http://169.254.169.254/latest/meta-data','http://example.com:22']:
            with self.assertRaises(ValueError):await agent.web_read(url)
        self.assertEqual(agent.clean_url('https://example.com/path'),'https://example.com/path')

    async def test_endpoint_and_assets_require_admin_premium_and_setting(self):
        name='agent_api_test_module'
        module=types.ModuleType(name)
        ns=module.__dict__;ns.update({'sys':__import__('sys'),'Request':Request,'Header':Header,'Depends':Depends,'Response':Response,'JSONResponse':JSONResponse,'_os_session_optional':lambda:None,'_resolve':self.api._resolve,'_premium':self.api._premium,'_desktop':self.api._desktop})
        extract({'agent_api','premium_asset'},ns)
        import sys
        sys.modules[name]=module
        called=AsyncMock(return_value=JSONResponse({'ok':True}))
        self.prem.agents_module=lambda:types.SimpleNamespace(route=called)
        self.prem.get_asset=lambda name:b'premium source'
        self.prem.terminal_enabled=lambda cfg:False
        request=types.SimpleNamespace()
        for token in [None,'member']:
            response=await ns['agent_api'](request,'tasks',token,'',None);self.assertEqual(response.status_code,403)
            response=await ns['premium_asset']('agents.js',token,'',None);self.assertEqual(response.status_code,404)
        self.cfg['agents_enabled']=False
        self.assertEqual((await ns['agent_api'](request,'tasks','admin','',None)).status_code,403)
        self.assertEqual((await ns['premium_asset']('agents.js','admin','',None)).status_code,404)
        self.cfg['agents_enabled']=True
        self.assertEqual((await ns['agent_api'](request,'tasks','admin','',None)).status_code,200)
        self.assertEqual((await ns['premium_asset']('agents.js','admin','',None)).body,b'premium source')
        called.assert_awaited_once()
        del sys.modules[name]

    async def test_interrupted_tool_results_precede_later_feedback(self):
        assistant = {'role':'assistant','tool_calls':[self.call('agent_web_read',{'url':'https://example.com'},'one'),self.call('agent_save_item',{'title':'Step'},'two')]}
        history=[{'role':'user','content':'Start'},assistant,{'role':'tool','tool_call_id':'one','content':'Read'}, {'role':'user','content':'Manual correction'}]
        fixed=agent.recover_history(history)
        self.assertEqual([x['role'] for x in fixed],['user','assistant','tool','tool','user'])
        self.assertEqual(fixed[2]['tool_call_id'],'two')
        self.assertEqual(agent.recover_history(fixed),fixed)

    async def test_search_feed_filters_unrelated_results_and_optional_key_stays_in_header(self):
        import httpx
        original = httpx.AsyncClient
        seen=[]
        def respond(request):
            seen.append(request)
            if request.url.host == 'api.search.brave.com':
                return httpx.Response(200,json={'web':{'results':[{'title':'Tesla charging','url':'https://example.com','description':'Relevant discussion'}]}})
            return httpx.Response(200,text='<rss><channel><item><title>Tesla charging guide</title><link>https://example.com</link><description>Charging costs</description></item><item><title>Unrelated news</title><link>https://other.example</link></item></channel></rss>')
        with patch.object(agent.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(respond),**kw)):
            result=await agent.web_search('Tesla charging',self.api)
            self.assertEqual(len(result['results']),1)
            self.cfg['agent_search_key']='private-search-key'
            result=await agent.web_search('Tesla charging',self.api)
            self.assertEqual(len(result['results']),1)
        self.assertEqual(seen[-1].headers['X-Subscription-Token'],'private-search-key')
        self.assertNotIn('private-search-key',str(seen[-1].url))
        self.assertNotIn('private-search-key',json.dumps(result))

    async def test_approval_cannot_change_linux_execution_context(self):
        task=await self.create()
        self.outputs=[{'role':'assistant','tool_calls':[self.call('agent_run_command',{'command':'true','reason':'Check'})]}]
        result=await self.run_task(task)
        await self.request('tasks/'+task['id']+'/review',{'id':result['pending'][0]['id'],'decision':'approve'})
        stored=self.stored(task)
        self.outputs=[{'role':'assistant','content':'A new approval is needed'}]
        with patch.object(agent,'execute_command',AsyncMock()) as execute:
            agent.start(self.api,stored,'admin','desktop',{'effective_user':'another-user'})
            await agent.JOBS[task['id']]
            execute.assert_not_called()
        self.assertIn('execution_context_changed',json.dumps(self.stored(task)['messages']))

    async def test_command_cancellation_kills_process_group(self):
        task=await self.create()
        operation=asyncio.create_task(agent.execute_command(self.api,task,{'command':'sleep 30'},'admin','',None))
        await asyncio.sleep(.15);operation.cancel()
        with self.assertRaises(asyncio.CancelledError):await asyncio.wait_for(operation,3)


if __name__=='__main__':unittest.main()
