import ast,asyncio,json,threading,time,unittest
from pathlib import Path
from fastapi.responses import JSONResponse
from fastapi import Header
root=Path(__file__).resolve().parents[3]
namespace={'json':json,'threading':threading,'time':time,'JSONResponse':JSONResponse,'Header':Header}
for path,names in [(root/'backend/apps/mvmai/backend.py',{'_record_turn_event','_append_turn_event','_record_claude_event','_claude_tool_progress'}),(root/'apps/mvmai/api.py',{'_turn_progress','poll_chat_turn'})]:
    tree=ast.parse(path.read_text());nodes=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in names];[setattr(n,'decorator_list',[]) for n in nodes];exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),'exec'),namespace)
class LiveTests(unittest.IsolatedAsyncioTestCase):
    def test_claude_command_and_result_update_same_tool(self):
        turn = {}
        events = [
            {'type': 'assistant', 'message': {'id': 'a', 'content': [
                {'type': 'tool_use', 'id': 'bash-1', 'name': 'Bash', 'input': {'command': 'printf hello'}}]}},
            {'type': 'user', 'message': {'content': [
                {'type': 'tool_result', 'tool_use_id': 'bash-1', 'content': [{'type': 'text', 'text': 'hello'}]}]}},
        ]
        for event in events:
            namespace['_record_turn_event'](turn, json.dumps(event))
        first, last = turn['events']
        self.assertEqual(first['text'], 'printf hello')
        self.assertEqual(first['language'], 'bash')
        self.assertEqual(first['key'], last['key'])
        self.assertEqual(last['status'], 'done')
        self.assertEqual(last['output'], 'hello')

    def test_claude_partial_text_and_tool_json_without_reasoning(self):
        turn = {}
        frames = [
            {'type': 'message_start', 'message': {'id': 'msg-1'}},
            {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'thinking'}},
            {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'thinking_delta', 'thinking': 'private'}},
            {'type': 'content_block_start', 'index': 1, 'content_block': {'type': 'text', 'text': ''}},
            {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': 'Checking '}},
            {'type': 'content_block_delta', 'index': 1, 'delta': {'type': 'text_delta', 'text': 'the file'}},
            {'type': 'content_block_start', 'index': 2, 'content_block': {'type': 'tool_use', 'id': 't1', 'name': 'Bash', 'input': {}}},
            {'type': 'content_block_delta', 'index': 2, 'delta': {'type': 'input_json_delta', 'partial_json': '{"command":"cat '}},
            {'type': 'content_block_delta', 'index': 2, 'delta': {'type': 'input_json_delta', 'partial_json': 'demo.py"}'}},
            {'type': 'content_block_stop', 'index': 2},
        ]
        for frame in frames:
            namespace['_record_turn_event'](turn, json.dumps({'type': 'stream_event', 'event': frame}))
        self.assertEqual([e['text'] for e in turn['events']], ['Checking ', 'Checking the file', 'cat demo.py'])
        self.assertEqual(turn['events'][0]['key'], turn['events'][1]['key'])
        self.assertNotIn('private', json.dumps(turn['claude_stream']))
        namespace['_record_turn_event'](turn, json.dumps({'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': 't1', 'is_error': True, 'content': 'Missing file'}]}}))
        self.assertEqual(turn['events'][-1]['output'], 'Missing file')
        self.assertEqual(turn['events'][-1]['status'], 'done')

    def test_claude_tool_tracking_and_output_are_bounded(self):
        turn = {}
        for i in range(120):
            namespace['_record_turn_event'](turn, json.dumps({'type': 'assistant', 'message': {'content': [
                {'type': 'tool_use', 'id': str(i), 'name': 'Read', 'input': {'file_path': '/example'}}]}}))
        self.assertEqual(len(turn['claude_tools']), 100)
        namespace['_record_turn_event'](turn, json.dumps({'type': 'user', 'message': {'content': [
            {'type': 'tool_result', 'tool_use_id': '119', 'content': 'x' * 9000}]}}))
        self.assertEqual(len(turn['events'][-1]['output']), 4000)
    def test_public_messages_and_tool_updates(self):
        turn={}
        for event in [{'type':'item.completed','item':{'id':'msg1','type':'agent_message','text':'Working on the file'}},{'type':'item.started','item':{'id':'tool1','type':'command_execution','command':'node --check demo.js'}},{'type':'item.completed','item':{'id':'tool1','type':'command_execution','command':'node --check demo.js','aggregated_output':'PASS'}}]: namespace['_record_turn_event'](turn,json.dumps(event))
        events=namespace['_turn_progress'](turn)['events'];self.assertEqual(len(events),3);self.assertEqual(events[-1]['status'],'done');self.assertEqual(events[-1]['output'],'PASS');self.assertEqual(len(namespace['_turn_progress'](turn,2)['events']),1)
    def test_private_reasoning_and_malformed_lines_excluded(self):
        turn={}
        for event in [{'type':'item.completed','item':{'type':'reasoning','text':'private'}},{'type':'thread.started','thread_id':'secret'},[],{'type':'assistant','message':{'id':'a','content':[{'type':'thinking','thinking':'private'},{'type':'text','text':'Visible commentary'}]}}]:namespace['_record_turn_event'](turn,json.dumps(event))
        namespace['_record_turn_event'](turn,'bad json')
        self.assertEqual([e['text'] for e in namespace['_turn_progress'](turn)['events']],['Visible commentary'])
    def test_bounded_storage_and_concurrent_polls(self):
        turn={}
        def writer():
            for i in range(1500):namespace['_append_turn_event'](turn,{'key':str(i),'kind':'message','text':'Hello'})
        thread=threading.Thread(target=writer);thread.start()
        while thread.is_alive():namespace['_turn_progress'](turn)
        thread.join();self.assertEqual(len(turn['events']),100);self.assertEqual(turn['events'][-1]['seq'],1500)
    async def test_owner_only_and_final_batch(self):
        task=asyncio.create_task(asyncio.sleep(0,result=JSONResponse({'message':{'content':'Final'}})));turn={'task':task,'token':'owner'};namespace['_append_turn_event'](turn,{'key':'a','kind':'message','text':'Progress'});namespace['_TURNS']={'test':turn}
        response=await namespace['poll_chat_turn']('test',0,'other');self.assertEqual(response.status_code,404);self.assertIn('test',namespace['_TURNS'])
        response=await namespace['poll_chat_turn']('test',0,'owner');self.assertEqual(response.status_code,202)
        await task
        response=await namespace['poll_chat_turn']('test',0,'owner');payload=json.loads(response.body);self.assertFalse(payload['pending']);self.assertEqual(payload['events'][0]['text'],'Progress');self.assertEqual(payload['message']['content'],'Final')
if __name__ == '__main__':
    unittest.main()
