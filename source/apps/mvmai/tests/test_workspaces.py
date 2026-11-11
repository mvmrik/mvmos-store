"""General workspace flows: no project-specific business integration or paid AI."""
import asyncio
import json
import time
import types
import unittest
from unittest.mock import AsyncMock, patch

import test_agents as base
agent=base.agent


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=base.AgentTests.asyncSetUp
    asyncTearDown=base.AgentTests.asyncTearDown
    request=base.AgentTests.request
    call=base.AgentTests.call

    async def ws(self,path='',body=None,method=None,token='admin'):
        return await self.request('workspaces'+path,body,method,token)

    async def settle(self):
        for _ in range(10):
            pending=list(agent.JOBS.values())
            if not pending:return
            await asyncio.gather(*pending,return_exceptions=True)
            await asyncio.sleep(0)
        self.fail('Workspace did not settle')

    async def create_project(self,outputs=None):
        self.outputs[:]=outputs or [{'role':'assistant','content':'Which project should I inspect?','tool_calls':[self.call('agent_wait',{'next_action':'Which project should I inspect?'})]}]
        response=await self.ws('',{'name':'Example project','description':'Help me manage my project','lang':'en'})
        self.assertEqual(response.status_code,200,response.body)
        project=json.loads(response.body)['workspace'];await self.settle()
        return json.loads((await self.ws('/'+project['id'])).body)['workspace']

    def private(self,project):return agent.workspaces().load(self.api,project['id'],'a')

    async def create_tool(self,project,source=None):
        source=source or "import sys,json\nd=json.load(sys.stdin)\nn=d['params']['percent']\nprint(json.dumps({'summary':'Calculated','columns':['old','new'],'rows':[{'old':100,'new':100*(1+n/100)}]}))"
        response=await self.ws('/'+project['id']+'/tool',{'title':'Reusable calculation','description':'Calculate a percentage for selected inputs','source':source,
            'fields':[{'name':'percent','label':'Percentage','type':'number','required':True,'min':-90,'max':1000}]})
        self.assertEqual(response.status_code,200,response.body)
        return json.loads(response.body)['tool']

    async def activate(self,project,tool):
        response=await self.ws('/'+project['id']+'/activate',{'id':tool['id'],'version':tool['version'],'hash':tool['hash']})
        self.assertEqual(response.status_code,200,response.body)

    async def run_tool(self,project,tool,phase='preview',percent=20):
        return await self.ws('/'+project['id']+'/run-tool',{'id':tool['id'],'version':tool['version'],'hash':tool['hash'],'phase':phase,'values':{'percent':percent}})

    async def approve_and_start(self,project):
        data=json.loads((await self.ws('/'+project['id'])).body)['workspace'];task=data['tasks'][0]
        pending=next(p for p in task['pending'] if p['status']=='pending')
        response=await self.ws('/'+project['id']+'/task',{'id':task['id'],'action':'review','data':{'id':pending['id'],'decision':'approve','source':'tampered'}})
        self.assertEqual(response.status_code,200,response.body)
        response=await self.ws('/'+project['id']+'/task',{'id':task['id'],'action':'start'})
        self.assertEqual(response.status_code,200,response.body);await self.settle()
        return json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]

    async def test_execution_trace_records_real_start_result_and_errors(self):
        project=await self.create_project()
        entered=asyncio.Event();release=asyncio.Event()
        async def read(url):
            entered.set();await release.wait();raise ValueError('source_unavailable')
        self.outputs[:]=[
            {'role':'assistant','content':'Public progress only','tool_calls':[self.call('agent_web_read',{'url':'https://example.com'},'read')]},
            {'role':'assistant','tool_calls':[self.call('agent_save_item',{'title':'Inspect source','status':'completed','result':'Recorded unavailable source'},'step'),self.call('agent_finish',{'result':'Source failure documented'},'finish')]}
        ]
        with patch.object(agent,'web_read',read):
            await self.ws('/'+project['id']+'/message',{'message':'Inspect the source'})
            await entered.wait()
            running=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
            record=running['trace'][-1]
            self.assertEqual((record['kind'],record['status'],record['detail']),('read','running','https://example.com'))
            self.assertEqual(running['activity']['id'],record['id'])
            release.set();await self.settle()
        finished=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        final=next(r for r in finished['trace'] if r['id']==record['id'])
        self.assertEqual(final['status'],'failed');self.assertEqual(final['outcome']['error'],'source_unavailable')
        self.assertGreaterEqual(final['finished_at'],final['since'])
        self.assertEqual(finished['trace'][-1]['kind'],'result')
        self.assertEqual(finished['trace'][-1]['status'],'completed')
        self.assertNotIn('Public progress only',json.dumps(finished['trace']))
        self.assertTrue(any(r.get('item_id')==finished['items'][0]['id'] for r in finished['trace']))

    async def test_execution_trace_is_bounded_and_never_marks_review_as_execution(self):
        task={'status':'running'}
        for _ in range(90):
            agent.activity(task,'read','A real read');agent.finish_activity(task)
        self.assertEqual(len(task['trace']),80)
        project=await self.create_project()
        self.outputs[:]=[{'role':'assistant','tool_calls':[self.call('agent_run_command',{'command':'printf reviewed','reason':'Prepare a reviewed action'},'queue'),self.call('agent_save_item',{'title':'Record the request','status':'completed','result':'Exact action queued'},'record')]}]
        execute=AsyncMock()
        with patch.object(agent,'execute_command',execute):
            await self.ws('/'+project['id']+'/message',{'message':'Prepare the action'});await self.settle()
        task=agent.workspaces().active(self.api,agent,self.private(project))
        queued=next(r for r in task['trace'] if r['kind']=='prepare')
        self.assertEqual(queued['status'],'awaiting_approval')
        self.assertEqual(task['trace'][-1]['kind'],'plan')
        self.assertEqual(task['trace'][-1]['status'],'completed')
        self.assertFalse(any(r['kind']=='command' for r in task['trace']))
        execute.assert_not_called()

    async def test_progress_without_tools_continues_to_verified_finish(self):
        project=await self.create_project([
            {'role':'assistant','content':'I will organize this now.'},
            {'role':'assistant','tool_calls':[self.call('agent_save_item',{'title':'Inspect sources','status':'completed','result':'Checked sources'},'step'),self.call('agent_finish',{'result':'Verified result'},'finish')]}
        ])
        task=project['tasks'][0]
        self.assertEqual(task['status'],'completed')
        self.assertEqual(task['result'],'Verified result')
        self.assertFalse(any(e['code']=='input_requested' for e in task['events']))

    async def test_text_only_provider_stops_with_explicit_diagnosis(self):
        project=await self.create_project([{'role':'assistant','content':'Working on it'}]*3)
        task=project['tasks'][0]
        self.assertEqual(task['status'],'paused')
        self.assertEqual(task['next_action'],'model_no_action')
        self.assertEqual(task['rounds'],3)

    async def test_auto_mode_keeps_explicit_major_decision_wait(self):
        project=await self.create_project()
        await self.ws('/'+project['id']+'/approval',{'level':'auto'})
        question='Publishing reaches everyone. Publish now or keep the draft? I recommend keeping the draft.'
        self.outputs[:]=[{'role':'assistant','tool_calls':[self.call('agent_wait',{'next_action':question})]}]
        await self.ws('/'+project['id']+'/message',{'message':'Prepare the announcement'})
        await self.settle()
        current=agent.workspaces().active(self.api,agent,self.private(project))
        self.assertEqual(current['status'],'awaiting_user')
        self.assertEqual(current['next_action'],question)
        self.assertEqual(agent.workspaces().history(self.api,self.private(project))[-1]['content'],question)
        context=agent.workspaces().context(self.api,agent,current)
        self.assertIn('approval mode: auto',context)
        self.assertIn('major decision',context)

    async def test_agent_builds_knowledge_views_and_continues_one_conversation(self):
        calls=[self.call('workspace_overview',{'summary':'A verified project overview'},'overview'),
               self.call('workspace_remember',{'title':'Architecture','content':'Project-specific structure','source':'README'},'note'),
               self.call('workspace_present',{'title':'Choose scope','kind':'form','fields':[{'name':'scope','label':'Scope','type':'select','required':True,'options':[{'value':'all','label':'Everything'},{'value':'some','label':'Selected'}]}]},'form'),
               self.call('agent_save_item',{'title':'Initial analysis','status':'completed','result':'Documented'},'todo'),
               self.call('agent_finish',{'result':'Ready for the next request'},'finish')]
        project=await self.create_project([{'role':'assistant','content':'The project is organized','tool_calls':calls}])
        self.assertEqual(project['summary'],'A verified project overview');self.assertEqual(len(project['knowledge']),1)
        first=agent.workspaces().tasks(self.api,agent,self.private(project))[0]
        self.outputs[:]=[{'role':'assistant','content':'I received your selection','tool_calls':[self.call('agent_wait',{'next_action':'I received your selection'})]}]
        view=project['views'][0]
        response=await self.ws('/'+project['id']+'/answer',{'id':view['id'],'revision':view['revision'],'values':{'scope':'some'}})
        self.assertEqual(response.status_code,200,response.body);await self.settle()
        project=json.loads((await self.ws('/'+project['id'])).body)['workspace']
        self.assertEqual(len([m for m in project['messages'] if m['role']=='user']),2)
        latest=agent.workspaces().tasks(self.api,agent,self.private(project))[0]
        self.assertNotEqual(first['session_id'],latest['session_id'])
        self.assertEqual(json.loads((await self.request('tasks')).body)['tasks'],[])
        self.assertNotIn('session_id',json.dumps(project));self.assertNotIn('user_id',project)

    async def test_owner_gate_and_stale_or_forged_form_answers(self):
        project=await self.create_project()
        response=await self.ws('/'+project['id'],token='other');self.assertEqual(response.status_code,404)
        response=await self.ws('/'+project['id']+'/views',{'title':'Scope','kind':'form','fields':[{'name':'choice','label':'Choose','type':'select','options':[{'value':'yes','label':'Yes'}]}]})
        view=json.loads(response.body)['record']
        for values,revision in [({'choice':'forged'},view['revision']),({'choice':'yes'},0),({'unknown':'yes'},view['revision'])]:
            response=await self.ws('/'+project['id']+'/answer',{'id':view['id'],'revision':revision,'values':values})
            self.assertEqual(response.status_code,400,response.body)
        self.assertEqual(len(self.private(project)['views']),1)

    async def test_saved_code_activation_exact_approval_and_execution_without_ai(self):
        project=await self.create_project();tool=await self.create_tool(project)
        self.assertEqual((await self.run_tool(project,tool)).status_code,400)
        await self.activate(project,tool)
        response=await self.run_tool(project,tool)
        self.assertEqual(response.status_code,200,response.body)
        queued=json.loads(response.body)['workspace']['tasks'][0]
        self.assertFalse(queued.get('tool_output'))
        # No model is asked to reimplement a saved operation.
        self.api._chat=AsyncMock(side_effect=AssertionError('saved tool must not call AI'))
        task=await self.approve_and_start(project)
        self.assertEqual(task['status'],'completed',task)
        self.assertEqual(task['tool_output']['data']['rows'][0]['new'],120)
        response=await self.run_tool(project,tool,'execute')
        self.assertEqual(response.status_code,200,response.body)
        task=await self.approve_and_start(project)
        self.assertEqual(task['status'],'completed');self.api._chat.assert_not_called()

    async def test_execute_requires_successful_matching_preview(self):
        project=await self.create_project();tool=await self.create_tool(project);await self.activate(project,tool)
        response=await self.run_tool(project,tool,'execute');self.assertEqual(response.status_code,400,response.body)
        self.assertIn('preview_required',response.body.decode())
        await self.run_tool(project,tool);await self.approve_and_start(project)
        response=await self.run_tool(project,tool,'execute',30)
        self.assertEqual(response.status_code,400);self.assertIn('preview_required',response.body.decode())

    async def test_tool_version_or_resource_change_invalidates_queued_code(self):
        project=await self.create_project();tool=await self.create_tool(project);await self.activate(project,tool)
        await self.run_tool(project,tool)
        response=await self.ws('/'+project['id']+'/resources',{'name':'Changed environment','kind':'directory','location':'/new','description':'Changed'})
        self.assertEqual(response.status_code,200,response.body)
        task=await self.approve_and_start(project)
        self.assertEqual(task['status'],'failed')
        self.assertEqual(task['tool_output']['code'],1)
        self.assertIn('resources_changed',json.dumps(task))

    async def test_source_versions_are_immutable_and_drafts_not_executed(self):
        project=await self.create_project();tool=await self.create_tool(project)
        first=self.private(project)['tools'][0]['versions'][0]['source']
        response=await self.ws('/'+project['id']+'/tool',{'id':tool['id'],'title':'Changed','description':'New version','source':"print('new')",'fields':[]})
        self.assertEqual(response.status_code,200,response.body)
        versions=self.private(project)['tools'][0]['versions'];self.assertEqual(len(versions),2);self.assertEqual(versions[0]['source'],first)
        response=await self.ws('/'+project['id']+'/activate',{'id':tool['id'],'version':1,'hash':'forged'})
        self.assertEqual(response.status_code,400)
        bad=await self.ws('/'+project['id']+'/tool',{'id':tool['id'],'title':'Bad','description':'Bad','source':'not valid python ::','fields':[]})
        self.assertEqual(bad.status_code,400,bad.body)
        self.assertEqual(len(self.private(project)['tools'][0]['versions']),2)

    async def test_model_can_request_same_tool_and_cannot_activate_it(self):
        project=await self.create_project();tool=await self.create_tool(project);await self.activate(project,tool)
        self.outputs[:]=[{'role':'assistant','tool_calls':[self.call('workspace_request_tool',{'tool_id':tool['id'],'phase':'preview','params':{'percent':12}},'request')]}]
        response=await self.ws('/'+project['id']+'/message',{'message':'Use the saved calculation'})
        self.assertEqual(response.status_code,200,response.body);await self.settle()
        p=json.loads((await self.ws('/'+project['id'])).body)['workspace']
        self.assertEqual(p['tasks'][0]['pending'][0]['name'],'workspace_tool')
        self.assertEqual(p['tasks'][0]['status'],'awaiting_approval')
        names=[t['function']['name'] for t in agent.workspaces().model_tools()]
        self.assertNotIn('workspace_activate',names)

    async def test_new_messages_queue_while_agent_is_working(self):
        entered=asyncio.Event();release=asyncio.Event();count=0
        async def slow(body,*args):
            nonlocal count
            count+=1
            if count==1:entered.set();await release.wait()
            return __import__('fastapi.responses',fromlist=['JSONResponse']).JSONResponse({'message':{'role':'assistant','content':'Reply '+str(count),'tool_calls':[self.call('agent_wait',{'next_action':'Which source should I use?'})]}})
        self.api._chat=slow
        response=await self.ws('',{'description':'A generic project','lang':'en'});project=json.loads(response.body)['workspace']
        await entered.wait()
        response=await self.ws('/'+project['id']+'/message',{'message':'Also organize this'})
        self.assertEqual(json.loads(response.body)['workspace']['queued'],1)
        release.set();await self.settle()
        project=json.loads((await self.ws('/'+project['id'])).body)['workspace']
        self.assertEqual(project['queued'],0);self.assertEqual(count,2)
        self.assertEqual([m['content'] for m in project['messages'] if m['role']=='user'],['A generic project','Also organize this'])

    async def test_long_internal_context_rotates_without_new_visible_chat(self):
        project=await self.create_project();w=agent.workspaces();private=self.private(project);task=w.active(self.api,agent,private)
        old=task['session_id'];task['messages'].append({'role':'assistant','content':'x'*95000})
        w.before_round(self.api,agent,task)
        self.assertNotEqual(task['session_id'],old);self.assertEqual(task['previous_session_ids'],[old])
        self.assertLess(len(json.dumps(task['messages'])),90000)
        self.assertEqual(len(w.history(self.api,private)),2)

    async def test_model_is_shown_and_change_continues_unfinished_task_in_new_session(self):
        project=await self.create_project()
        self.assertEqual(project['model_info'],{'provider':'fake','model':'model-a','label':'fake · model-a'})
        w=agent.workspaces();private=self.private(project);task=w.active(self.api,agent,private);old=task['session_id']
        response=await self.ws('/'+project['id']+'/model',{'provider':'fake','model':'model-a'})
        self.assertTrue(json.loads(response.body).get('unchanged'));self.assertEqual(w.active(self.api,agent,private)['session_id'],old)
        response=await self.ws('/'+project['id']+'/model',{'provider':'other','model':'model-b'})
        self.assertEqual(response.status_code,200,response.body)
        shown=json.loads(response.body)['workspace'];self.assertEqual(shown['model_info']['label'],'other · model-b')
        self.assertEqual(shown['messages'][-1]['role'],'switch');self.assertIn('other · model-b',shown['messages'][-1]['content'])
        task=w.active(self.api,agent,w.load(self.api,project['id'],'a'))
        self.assertNotEqual(task['session_id'],old);self.assertEqual((task['provider'],task['model']),('other','model-b'))
        with self.api._sdb() as c:self.assertEqual(tuple(c.execute('SELECT provider,model FROM pub_sessions WHERE id=?',(task['session_id'],)).fetchone()),('other','model-b'))
        bad=await self.ws('/'+project['id']+'/model',{'provider':'missing','model':''});self.assertEqual(bad.status_code,400)
        denied=await self.ws('/'+project['id']+'/model',{'provider':'fake','model':''},token='member');self.assertNotEqual(denied.status_code,200)
        # A new task on this project uses the chosen model.
        self.outputs[:]=[{'role':'assistant','content':'ok','tool_calls':[self.call('agent_wait',{'next_action':'ok'})]}]
        task['status']='completed';agent.save(self.api,task)
        response=await self.ws('/'+project['id']+'/message',{'message':'Next'});await self.settle()
        newest=w.tasks(self.api,agent,w.load(self.api,project['id'],'a'))[0];self.assertEqual((newest['provider'],newest['model']),('other','model-b'))

    async def test_model_cannot_change_while_working_and_status_shows_activity(self):
        entered=asyncio.Event();release=asyncio.Event();seen={}
        async def slow(body,*args):
            entered.set();await release.wait()
            return __import__('fastapi.responses',fromlist=['JSONResponse']).JSONResponse({'message':{'role':'assistant','content':'Done','tool_calls':[self.call('agent_wait',{'next_action':'Done'})]}})
        self.api._chat=slow
        response=await self.ws('',{'description':'A generic project','lang':'en'});project=json.loads(response.body)['workspace']
        await entered.wait()
        shown=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        self.assertEqual(shown['status'],'running');self.assertEqual(shown['activity']['kind'],'model');self.assertEqual(shown['activity']['detail'],'1/30')
        busy=await self.ws('/'+project['id']+'/model',{'provider':'other','model':''});self.assertEqual(busy.status_code,400)
        release.set();await self.settle()
        shown=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        self.assertIsNone(shown['activity'])

    async def test_rested_or_large_task_continues_in_new_short_session_but_fresh_one_keeps_session(self):
        project=await self.create_project();w=agent.workspaces();private=self.private(project);task=w.active(self.api,agent,private)
        first=task['session_id'];self.assertEqual(task['status'],'awaiting_user')
        self.outputs[:]=[{'role':'assistant','content':'Second answer','tool_calls':[self.call('agent_wait',{'next_action':'Second answer'})]}]
        await self.ws('/'+project['id']+'/message',{'message':'Soon after'});await self.settle()
        task=w.active(self.api,agent,w.load(self.api,project['id'],'a'));self.assertEqual(task['session_id'],first)
        # After the provider cache has expired the same task continues in a new session with a short checkpoint.
        task['updated_at']=int(time.time())-3*3600;agent.save(self.api,task);task['updated_at']=int(time.time())-3*3600
        with self.api._sdb() as c:c.execute('UPDATE agent_tasks SET data=? WHERE id=?',(json.dumps(task),task['id']))
        self.outputs[:]=[{'role':'assistant','content':'Third answer','tool_calls':[self.call('agent_wait',{'next_action':'Third answer'})]}]
        await self.ws('/'+project['id']+'/message',{'message':'Two days later'});await self.settle()
        task=w.active(self.api,agent,w.load(self.api,project['id'],'a'))
        self.assertNotEqual(task['session_id'],first);self.assertEqual(task['previous_session_ids'],[first])
        self.assertEqual(task['messages'][0]['role'],'user');self.assertIn('execution checkpoint',task['messages'][0]['content'])
        self.assertTrue(any(m.get('content')=='Two days later' for m in task['messages']))
        # A large session is renewed too, and the visible conversation stays one.
        task['messages'].append({'role':'assistant','content':'x'*50000})
        shown=w.public(self.api,agent,w.load(self.api,project['id'],'a'));self.assertIn('context_chars',shown['tasks'][0])
        self.assertTrue(w.renew_if_stale(self.api,agent,task));self.assertLess(len(json.dumps(task['messages'])),w.SESSION_CHARS)

    async def test_project_index_describes_saved_helpers_and_prompt_prefers_them(self):
        project=await self.create_project();tool=await self.create_tool(project)
        ws=agent.workspaces();private=self.private(project)
        entry=next(x for x in [ws.helper_entry(t) for t in private['tools']] if x['id']==tool['id'])
        self.assertTrue(entry['does']);self.assertIn('percent',entry['inputs']);self.assertFalse(entry['ready'])
        task=ws.active(self.api,agent,private)
        prompt=ws.context(self.api,agent,task)
        self.assertIn('Helpers save tokens',prompt);self.assertIn(tool['id'],prompt);self.assertIn('"does"',prompt)
        private['tools'][0]['archived']=True;ws.save(self.api,private)
        self.assertNotIn(tool['id'],ws.context(self.api,agent,task).split('Project index:')[1])

    async def test_new_project_can_choose_provider_and_model(self):
        self.outputs[:]=[{'role':'assistant','content':'Hello','tool_calls':[self.call('agent_wait',{'next_action':'Hello'})]}]
        response=await self.ws('',{'description':'Chosen model project','provider':'other','model':'model-z','lang':'en'});await self.settle()
        shown=json.loads(response.body)['workspace'];self.assertEqual(shown['model_info']['label'],'other · model-z')
        task=agent.workspaces().active(self.api,agent,agent.workspaces().load(self.api,shown['id'],'a'))
        self.assertEqual((task['provider'],task['model']),('other','model-z'))
        bad=await self.ws('',{'description':'x','provider':'missing'});self.assertEqual(bad.status_code,400)

    async def test_disabled_execution_cannot_queue_or_offer_tool_runs(self):
        project=await self.create_project();tool=await self.create_tool(project);await self.activate(project,tool)
        self.cfg['pub_exec_enabled']=False
        response=await self.run_tool(project,tool)
        self.assertEqual(response.status_code,403,response.body)
        task=agent.workspaces().tasks(self.api,agent,self.private(project))[0]
        self.assertNotIn('workspace_request_tool',[t['function']['name'] for t in agent.tools(self.api,task,'public',None)])
        self.assertEqual(len(agent.workspaces().tasks(self.api,agent,self.private(project))),1)

    async def test_cancelled_tool_kills_process(self):
        project=await self.create_project()
        tool=await self.create_tool(project,"import time\ntime.sleep(60)")
        await self.activate(project,tool);response=await self.run_tool(project,tool)
        self.assertEqual(response.status_code,200,response.body)
        task=agent.workspaces().tasks(self.api,agent,self.private(project))[0]
        spawned=[];spawn=asyncio.create_subprocess_exec
        async def capture(*args,**kwargs):
            proc=await spawn(*args,**kwargs);spawned.append(proc);return proc
        with patch.object(asyncio,'create_subprocess_exec',capture):
            worker=asyncio.create_task(agent.workspaces().execute_tool(self.api,agent,task,task['pending'][0],'admin','public',None))
            for _ in range(100):
                if spawned:break
                await asyncio.sleep(.01)
            self.assertTrue(spawned)
            worker.cancel()
            with self.assertRaises(asyncio.CancelledError):await worker
        self.assertIsNotNone(spawned[0].returncode)

    def test_read_only_commands_are_recognised_strictly(self):
        w=agent.workspaces()
        for ok in ('ls -la /tmp','cat notes.txt','grep -rn "word" src','find . -name x.txt','wc -l a.txt'):self.assertTrue(w.read_only_command(ok),ok)
        for bad in ('','rm -rf x','ls; rm x','cat a > b','ls | sh','echo $(id)','find . -delete','find . -exec rm {} +','cat *','sed -i s/a/b/ f','ls `id`','ls\nrm x','curl http://x'):self.assertFalse(w.read_only_command(bad),bad)
        command={'name':'agent_run_command','arguments':{'command':'ls'}};write={'name':'agent_run_command','arguments':{'command':'rm x'}}
        preview={'name':'workspace_tool','arguments':{'phase':'preview'}};execute={'name':'workspace_tool','arguments':{'phase':'execute'}}
        self.assertEqual([w.auto_approvable('manual',x) for x in (command,write,preview,execute)],[False]*4)
        self.assertEqual([w.auto_approvable('safe',x) for x in (command,write,preview,execute)],[True,False,True,False])
        self.assertEqual([w.auto_approvable('auto',x) for x in (command,write,preview,execute)],[True]*4)

    async def test_approval_level_is_saved_per_project_and_validated(self):
        project=await self.create_project();self.assertEqual(project['approval'],'manual')
        self.assertEqual((await self.ws('/'+project['id']+'/approval',{'level':'everything'})).status_code,400)
        self.assertEqual((await self.ws('/'+project['id']+'/approval',{'level':'safe'},token='other')).status_code,404)
        response=await self.ws('/'+project['id']+'/approval',{'level':'safe'});self.assertEqual(response.status_code,200,response.body)
        self.assertEqual(json.loads(response.body)['workspace']['approval'],'safe')
        self.assertEqual(json.loads((await self.ws('/'+project['id'])).body)['workspace']['approval'],'safe')

    async def test_deleting_a_project_removes_everything_it_stores_but_not_what_the_agent_built_elsewhere(self):
        import os
        chat=os.path.join(self.folder.name,'chat');os.makedirs(chat)
        self.api._chat_file_path=lambda uid,p:p if isinstance(p,str) and p.startswith(chat+'/') else None
        self.api._forget_cli_sessions=lambda rows:None
        own=os.path.join(chat,'1_own.txt');shared=os.path.join(chat,'2_shared.txt');built=os.path.join(self.folder.name,'app.py')
        for path in (own,shared,built):open(path,'w').write('x')
        project=await self.create_project();second=await self.create_project()
        w=agent.workspaces()
        for item,files in ((project,(own,shared)),(second,(shared,))):
            private=self.private(item) if item is project else w.load(self.api,item['id'],'a')
            w.message(self.api,private,'user','\n'.join('[Attached file saved on the server: '+f+']' for f in files))
        self.assertEqual((await self.ws('/'+project['id'],method='DELETE',token='other')).status_code,404)
        response=await self.ws('/'+project['id'],method='DELETE');self.assertEqual(response.status_code,200,response.body)
        self.assertFalse(os.path.exists(own));self.assertTrue(os.path.exists(shared));self.assertTrue(os.path.exists(built))
        with self.api._sdb() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM agent_workspaces WHERE id=?',(project['id'],)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM agent_tasks WHERE json_extract(data,\'$.workspace_id\')=?',(project['id'],)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM agent_workspace_messages WHERE workspace_id=?',(project['id'],)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM agent_workspaces WHERE id=?',(second['id'],)).fetchone()[0],1)
        self.assertEqual((await self.ws('/'+project['id'])).status_code,404)
        await self.ws('/'+second['id'],method='DELETE');self.assertFalse(os.path.exists(shared))

    async def test_safe_level_runs_previews_but_asks_for_execution_and_auto_runs_everything(self):
        project=await self.create_project();tool=await self.create_tool(project);await self.activate(project,tool)
        self.api._chat=AsyncMock(side_effect=AssertionError('saved tool must not call AI'))
        await self.ws('/'+project['id']+'/approval',{'level':'safe'})
        response=await self.run_tool(project,tool);self.assertEqual(response.status_code,200,response.body);await self.settle()
        task=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        self.assertEqual(task['status'],'completed',task);self.assertEqual(task['tool_output']['data']['rows'][0]['new'],120)
        self.assertTrue(any(e['detail'].startswith('[auto]') for e in task['events']))
        response=await self.run_tool(project,tool,'execute');self.assertEqual(response.status_code,200,response.body);await self.settle()
        task=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        self.assertEqual(task['status'],'awaiting_approval',task)
        # Choosing the fully automatic level releases what is already waiting.
        await self.ws('/'+project['id']+'/approval',{'level':'auto'});await self.settle()
        task=json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]
        self.assertEqual(task['status'],'completed',task)

    async def test_model_commands_follow_the_project_approval_level(self):
        project=await self.create_project()
        execute=AsyncMock(return_value={'code':0,'stdout':'ok'})
        async def state():return json.loads((await self.ws('/'+project['id'])).body)['workspace']['tasks'][0]['status']
        async def ask(command):
            self.outputs[:]=[{'role':'assistant','tool_calls':[self.call('agent_run_command',{'command':command,'reason':'Check '+command})]},{'role':'assistant','content':'Done.','tool_calls':[self.call('agent_wait',{'next_action':'Done.'})]}]
            response=await self.ws('/'+project['id']+'/message',{'message':'Please run '+command});self.assertEqual(response.status_code,200,response.body);await self.settle()
        with patch.object(agent,'execute_command',execute):
            await ask('ls /tmp');self.assertEqual((execute.call_count,await state()),(0,'awaiting_approval'))
            # Raising the level releases the waiting read-only command.
            await self.ws('/'+project['id']+'/approval',{'level':'safe'});await self.settle()
            self.assertEqual(execute.call_count,1)
            self.assertNotEqual(await state(),'awaiting_approval')
            await ask('rm -r /tmp/x');self.assertEqual((execute.call_count,await state()),(1,'awaiting_approval'))
            await self.ws('/'+project['id']+'/approval',{'level':'auto'});await self.settle()
            self.assertEqual(execute.call_count,2)


if __name__=='__main__':unittest.main()
