"""Isolated AI policy tests: no provider calls and no real credit spending."""
import asyncio
import concurrent.futures
import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

ROOT=pathlib.Path(__file__).resolve().parents[1]


class AITests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.saved={k:sys.modules.get(k) for k in ('backend.auth','backend.apphub','backend.premium','app_public_mvmai')}
        spec=importlib.util.spec_from_file_location('design_ai_test',ROOT/'premium/backend.py')
        self.ai=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.ai)
        self.ai._DB=str(pathlib.Path(self.temp.name)/'data.db')
        self.premium=True;self.api_enabled=True;self.public=True;self.calls=[];self.balance={'u':100,'v':100};self.fail=False
        def session(x_test_owner: str = Header(default='root')):
            return {'effective_user':x_test_owner}
        def admin(session,request):
            if session['effective_user']!='root':raise HTTPException(403,'accessDenied')
        def charge(user,app,feature,reason,key):
            price=3 if feature=='ai_message' else 7
            if self.balance[user]<price:raise ValueError('insufficient')
            self.balance[user]-=price;return {'price':price,'balance':self.balance[user]}
        def api(app,method,**kw):
            self.calls.append((method,kw))
            if method=='image_status':return {'available':True}
            if self.fail:return {'error':'failure'}
            if method=='image':return {'mime':'image/png','data':'base64fixture'}
            return {'text':'A scene inspired by the project' if 'Write ONLY' in kw['prompt'] else 'Proposed.\n```actions\n[{"op":"set_project","properties":{"name":"New name"}}]\n```'}
        self.hub=types.SimpleNamespace(get_pub_session=lambda token:{'id':token} if token in ('u','v') else None,
            is_app_public=lambda _:self.public,is_app_api_enabled=lambda _:self.api_enabled,
            credits_available=lambda:True,get_credit_balance=lambda u:self.balance[u],
            get_credit_feature_price=lambda app,key:3 if key=='ai_message' else 7,
            charge_credit_feature=charge,grant_credits=lambda u,app,amount,reason,key:self.balance.__setitem__(u,self.balance[u]+amount),call_app_api=api)
        sys.modules['backend.auth']=types.SimpleNamespace(get_current_session=session,ensure_admin=admin)
        sys.modules['backend.apphub']=self.hub
        sys.modules['backend.premium']=types.SimpleNamespace(is_premium=lambda:self.premium,load_premium_backend=lambda _:self.ai if self.premium else None)
        sys.modules['app_public_mvmai']=types.SimpleNamespace()
        self.mod=types.ModuleType('design_api_ai_fixture');self.mod.__file__=str(pathlib.Path(self.temp.name)/'api.py')
        exec(compile((ROOT/'api.py').read_text(),str(ROOT/'api.py'),'exec'),self.mod.__dict__)
        app=FastAPI();app.include_router(self.mod.desktop_router,prefix='/api/apps/mvmdesign');app.include_router(self.mod.router,prefix='/pub/mvmdesign')
        self.client=TestClient(app)
        self.headers={'X-MvmDesign':'1','X-Pub-Token':'u'}
        self.body={'project':{'name':'Sea and solitude','width':1920,'height':1080,'pages':[{'id':'p','items':[{'type':'text','text':'A quiet coast'}]}],'captions':[{'id':'c','text':'Waves at sunset','start':0,'end':4}]},'messages':[{'role':'user','content':'Make title green'}],'prompt':'Soft evening light','lang':'bg'}

    def tearDown(self):
        self.client.close()
        for k,v in self.saved.items():
            if v is None:sys.modules.pop(k,None)
            else:sys.modules[k]=v
        self.temp.cleanup()

    def enable(self):
        self.ai.save_settings({'assistant':True,'images':True,'public':True})

    def test_premium_gates_settings_and_authentication(self):
        self.assertFalse(self.client.get('/api/apps/mvmdesign/ai/status').json()['enabled'])
        self.assertEqual(self.client.post('/api/apps/mvmdesign/ai/chat',json=self.body,headers={'X-MvmDesign':'1'}).status_code,401)
        self.assertEqual(self.client.post('/api/apps/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,403)
        self.assertEqual(self.client.get('/pub/mvmdesign/ai/status').status_code,401)
        self.assertEqual(self.client.get('/api/apps/mvmdesign/ai/assistant.js',headers=self.headers).status_code,404)
        self.assertEqual(self.client.put('/api/apps/mvmdesign/admin/settings',json={'assistant':True},headers={**self.headers,'X-Test-Owner':'other'}).status_code,403)
        self.assertEqual(self.client.put('/api/apps/mvmdesign/admin/settings',json={'assistant':'x'},headers=self.headers).status_code,400)
        self.enable()
        self.assertEqual(self.client.get('/api/apps/mvmdesign/ai/assistant.js',headers=self.headers).status_code,200)
        self.premium=False
        self.assertEqual(self.client.get('/api/apps/mvmdesign/ai/assistant.js',headers=self.headers).status_code,404)
        self.assertEqual(self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,402)
        self.assertFalse(self.client.get('/pub/mvmdesign/ai/status',headers=self.headers).json()['enabled'])
        self.assertEqual(self.calls,[])

    def test_context_chat_credits_and_public_page(self):
        self.enable()
        for _ in range(2):
            r=self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers)
            self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['actions'][0]['op'],'set_project')
        self.assertEqual(self.balance['u'],94)
        self.ai.save_settings({'assistant':True,'images':True,'public':False})
        self.assertEqual(self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,403)
        self.assertEqual(self.client.post('/api/apps/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,200)
        self.ai.save_settings({'assistant':True,'images':True,'public':True})
        prompt=[c[1]['prompt'] for c in self.calls if c[0]=='ask'][0]
        for text in ('Sea and solitude','Waves at sunset','1920','Make title green'):self.assertIn(text,prompt)
        self.assertEqual(self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers={**self.headers,'X-Pub-Token':'v'}).status_code,200)
        self.assertEqual(self.client.post('/api/apps/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,200)
        self.public=False
        self.assertEqual(self.client.get('/pub/mvmdesign/ai/status',headers=self.headers).status_code,403)

    def test_images_context_aspect_one_charge_and_refund(self):
        self.enable();self.fail=True
        r=self.client.post('/pub/mvmdesign/ai/image',json=self.body,headers=self.headers)
        self.assertEqual(r.status_code,502);self.assertEqual(self.balance['u'],100)
        self.fail=False
        r=self.client.post('/pub/mvmdesign/ai/image',json=self.body,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(self.balance['u'],93)
        image=[kw for method,kw in self.calls if method=='image'][0];self.assertEqual(image['aspect'],'landscape')
        prompt=[kw['prompt'] for method,kw in self.calls if method=='ask'][-1]
        self.assertIn('Waves at sunset',prompt);self.assertIn('Soft evening light',prompt)

    def test_failure_refunds_and_insufficient_credit_does_not_call_provider(self):
        self.enable();self.fail=True
        r=self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers)
        self.assertEqual(r.status_code,502);self.assertEqual(self.balance['u'],100)
        self.fail=False;self.balance['u']=0;self.calls=[]
        self.assertEqual(self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers).status_code,402)
        self.assertFalse(any(method=='ask' for method,_ in self.calls))

    def test_one_request_per_profile(self):
        self.enable()
        first=self.ai._reserve('u','message')
        with self.assertRaises(self.ai.LimitError):self.ai._reserve('u','image')
        self.ai._finish(first,True)
        def reserve(_):
            try:return self.ai._reserve('parallel','message')
            except self.ai.LimitError:return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(reserve,range(2)))
        self.assertEqual(sum(key is not None for key in results),1)

    def test_invalid_ai_output_refunded(self):
        self.enable()
        previous=self.hub.call_app_api
        self.hub.call_app_api=lambda app,method,**kw: {'text':'```actions\n[{"op":"run_shell","command":"anything"}]\n```'} if method=='ask' else previous(app,method,**kw)
        r=self.client.post('/pub/mvmdesign/ai/chat',json=self.body,headers=self.headers)
        self.assertEqual(r.status_code,400,r.text);self.assertEqual(self.balance['u'],100)


if __name__=='__main__':unittest.main()
