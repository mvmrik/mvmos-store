import asyncio,sys,types,tempfile,json,contextvars
from pathlib import Path
import httpx
root=Path(__file__).resolve().parents[3]
import unittest

@unittest.skipUnless((root/'apps/mvmai/premium/agents.py').is_file(), 'Premium agent module is not installed')
class ProviderPipelineTests(unittest.IsolatedAsyncioTestCase):
  async def test_agent_uses_existing_provider_and_keeps_history_private(self):
    with tempfile.TemporaryDirectory() as folder:
        name='mvmai_test_provider_pipeline';api=types.ModuleType(name);api.__file__=folder+'/api.py';sys.modules[name]=api
        exec(compile((root/'apps/mvmai/api.py').read_text(),str(root/'apps/mvmai/api.py'),'exec'),api.__dict__)
        code=(root/'apps/mvmai/premium/agents.py').read_text();agents=types.ModuleType('agents');exec(compile(code,'agents.py','exec'),agents.__dict__)
        cfg={'provider':'fake','model':'model-a','api_key_fake':'test','agents_enabled':True}
        admin={'id':'aaaabbbb','is_admin':True}
        desk=types.SimpleNamespace(CHAT_TURN=contextvars.ContextVar('turn',default=None),PROVIDERS={'fake':{}},CLI_PROVIDERS=[],_read_cfg=lambda:dict(cfg),_get_project=lambda pid:None,_server_tools=lambda *a:[{'function':{'name':'inspect_server'}}],_resolve_provider=lambda c:('fake','https://provider.test/v1','test',c['model']),_access_prompt=lambda *a:'Server operations require tools.',_trusted_messages=lambda messages,prompt:[{'role':'system','content':prompt}]+messages,kill_process=lambda proc:None)
        prem=types.SimpleNamespace(is_available=lambda:True,agents_enabled=lambda cfg:cfg['agents_enabled'],resolve_pub_cfg=lambda cfg:cfg)
        api._desktop=lambda:desk;api._resolve=lambda token:admin if token=='admin' else None;api._hub=lambda:None;api._premium=lambda:prem
        class Req:
            method='POST';headers={}
            async def json(self):return {'title':'Test','goal':'Make a plan','lang':'en'}
        response=await agents.route(api,Req(),'tasks',admin,'admin','',None)
        assert response.status_code==200,response.body
        task=json.loads(response.body)['task']; saved=agents.load(api,task['id'],admin['id'])
        seen=[]
        def reply(request):
            data=json.loads(request.content);seen.append(data)
            names=[x['function']['name'] for x in data['tools']]
            assert 'agent_save_item' in names and 'inspect_server' not in names and 'run_command' not in names
            assert data['model']=='model-a'
            calls=[{'id':'c1','type':'function','function':{'name':'agent_save_item','arguments':json.dumps({'title':'Read a page','status':'completed','result':'Read successfully'})}},{'id':'c2','type':'function','function':{'name':'agent_finish','arguments':'{"result":"Done"}'}}]
            return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'Plan complete','tool_calls':calls}}]})
        original=httpx.AsyncClient
        api.httpx=types.SimpleNamespace(AsyncClient=lambda **kw:original(transport=httpx.MockTransport(reply),**kw),ConnectError=httpx.ConnectError)
        agents.start(api,saved,'admin','',None);await agents.JOBS[task['id']]
        result=agents.load(api,task['id'],admin['id']);assert result['status']=='completed',result
        rows=json.loads((await api.list_sessions('admin')).body)['sessions'];assert rows==[],rows
        response=await api.chat(api.ChatRequest(messages=[{'role':'user','content':'interfere'}],session_id=saved['session_id']),'admin','',None)
        assert response.status_code==409,response.body
        response=await api.get_session_messages(saved['session_id'],None,'admin','',None)
        assert response.status_code==404,response.body
        with api._sdb() as conn:
            assert conn.execute('SELECT COUNT(*) FROM pub_messages WHERE session_id=?',(saved['session_id'],)).fetchone()[0]==2
        # The CLI adapter still receives the agent transport tools, never
        # unrestricted native execution, even with ordinary chat auto enabled.
        cfg.update(provider='fake-cli', model='cli-model', pub_exec_enabled=True, pub_exec_auto=True)
        desk.CLI_PROVIDERS=[{'id':'fake-cli','name':'Fake CLI'}]
        desk.CliChatRequest=lambda **kw:types.SimpleNamespace(**kw)
        async def cli_reply(body, **kwargs):
            assert body.provider_id=='fake-cli' and body.model=='cli-model'
            assert kwargs['exec_enabled'] is False
            names={x['function']['name'] for x in kwargs['tools']}
            assert 'agent_save_item' in names and 'agent_run_command' in names
            assert 'run_command' not in names and 'inspect_server' not in names
            calls=[{'name':'agent_save_item','arguments':{'title':'CLI step','status':'completed','result':'Verified'}},
                   {'name':'agent_finish','arguments':{'result':'CLI finished'}}]
            content='\n'.join('```mvmai_tool_call\n'+json.dumps(x)+'\n```' for x in calls)
            return api.JSONResponse({'content':content})
        desk._run_cli_chat=cli_reply
        response=await agents.route(api,Req(),'tasks',admin,'admin','',None)
        task=json.loads(response.body)['task'];saved=agents.load(api,task['id'],admin['id'])
        agents.start(api,saved,'admin','',None);await agents.JOBS[task['id']]
        result=agents.load(api,task['id'],admin['id']);assert result['status']=='completed',result
        assert result['items'][0]['title']=='CLI step'
        print('PASS: actual API and CLI adapters, model pinning, review-only execution and private agent history')
        sys.modules.pop(name,None)
if __name__ == '__main__': unittest.main()
