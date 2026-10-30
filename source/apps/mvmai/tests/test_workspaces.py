"""General workspace flows: no project-specific business integration or paid AI."""
import asyncio
import json
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
        self.outputs[:]=outputs or [{'role':'assistant','content':'What would you like to work on first?'}]
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

    async def test_agent_builds_knowledge_views_and_continues_one_conversation(self):
        calls=[self.call('workspace_overview',{'summary':'A verified project overview'},'overview'),
               self.call('workspace_remember',{'title':'Architecture','content':'Project-specific structure','source':'README'},'note'),
               self.call('workspace_present',{'title':'Choose scope','kind':'form','fields':[{'name':'scope','label':'Scope','type':'select','required':True,'options':[{'value':'all','label':'Everything'},{'value':'some','label':'Selected'}]}]},'form'),
               self.call('agent_save_item',{'title':'Initial analysis','status':'completed','result':'Documented'},'todo'),
               self.call('agent_finish',{'result':'Ready for the next request'},'finish')]
        project=await self.create_project([{'role':'assistant','content':'The project is organized','tool_calls':calls}])
        self.assertEqual(project['summary'],'A verified project overview');self.assertEqual(len(project['knowledge']),1)
        first=agent.workspaces().tasks(self.api,agent,self.private(project))[0]
        self.outputs[:]=[{'role':'assistant','content':'I received your selection'}]
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
            return __import__('fastapi.responses',fromlist=['JSONResponse']).JSONResponse({'message':{'role':'assistant','content':'Reply '+str(count)}})
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


if __name__=='__main__':unittest.main()
