const {chromium}=require(process.env.MVMAI_PLAYWRIGHT_MODULE||'playwright');
const {spawn}=require('child_process'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),net=require('net');
const root=path.resolve(__dirname,'../../..');
if(!fs.existsSync(path.join(root,'apps/mvmai/premium/workspaces.py'))){console.log('SKIP: Premium workspaces are not installed');process.exit(0);}
(async()=>{
  const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const server=spawn(path.join(root,'venv/bin/python'),[path.join(__dirname,'workspace_server.py'),String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});
  let logs='';server.stderr.on('data',x=>logs+=x);const base='http://127.0.0.1:'+port;let browser;
  try{
    let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base)).ok){ready=true;break;}}catch(_){}await new Promise(r=>setTimeout(r,100));}
    assert(ready,logs);
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const width of [1280,390]){
      const p=await browser.newPage({viewport:{width,height:900}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
      await p.goto(base);await p.evaluate(()=>{localStorage.setItem('apphub_token','admin');window.asset=x=>x;window.mvmOS={lang:'en',premiumStatus:'premium',premiumGate:()=>{}};window.t=k=>window._i18n?.[k]||k;});
      for(const file of ['i18n.js','mvmai-widget.js'])await p.addScriptTag({content:fs.readFileSync(path.join(root,'apps/mvmai/public',file),'utf8')});
      await p.evaluate(()=>window.handle=MvmaiWidget.mount(document.querySelector('#root'),{isDesktopApp:true}));
      await p.locator('.mvmai-input').fill('Keep my ordinary chat draft');await p.locator('.mva-agent-mode').click();
      await p.locator('.mws').waitFor();await p.locator('.mws-side [data-action=new]').click();
      await p.locator('.mws-dialog [name=name]').fill('General project '+width);
      await p.locator('.mws-dialog [name=description]').fill('Help me organize my work');
      await p.locator('.mws-dialog [type=submit]').click();
      await p.locator('.mws-graph-node[data-graph-node=agent]').waitFor();await p.locator('.mws-tabs [data-tab=overview]').click();
      await p.locator('form[data-view]').first().waitFor();
      assert.equal(await p.locator('.mws [name=source_chat_id]').count(),0);
      await p.locator('.mws-header h2',{hasText:'General project '+width}).waitFor();{const label=await p.locator('.mws-model').innerText();assert(label.includes('fake · model-a'),label);}
      assert((await p.locator('.mws-livebar').innerText()).length>0);
      await p.locator('.mws-model').click();await p.locator('.mws-dialog [name=model]:not([disabled])').waitFor();
      await p.locator('.mws-dialog [name=provider]').selectOption('other');await p.locator('.mws-dialog [name=model]:not([disabled])').waitFor();
      await p.locator('.mws-dialog [name=model]').selectOption('model-b');await p.locator('.mws-dialog [type=submit]').click();
      await p.waitForFunction(()=>document.querySelector('.mws-model')?.textContent.includes('other · model-b'));
      assert((await p.locator('.mws-messages').innerText()).includes('other · model-b'));
      const wid=await p.locator('.mws-side [aria-selected=true]').getAttribute('data-project');
      const direct=async(url,body,token='admin')=>p.evaluate(async({url,body,token})=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'X-Pub-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{url,body,token});
      const before=(await direct('/pub/mvmai/agents/workspaces/'+wid)).data.workspace;
      assert(before.knowledge.length>0);assert(before.views.length>0);assert(before.tools.length>0);
      assert.equal((await direct('/pub/mvmai/agents/workspaces/'+wid,undefined,'other')).status,404);
      const view=before.views[0];assert.equal((await direct('/pub/mvmai/agents/workspaces/'+wid+'/answer',{id:view.id,revision:0,values:{scope:'all'}})).status,400);
      await p.locator('form[data-view]').first().locator('select').selectOption('some');
      await p.locator('form[data-view]').first().locator('[type=submit]').click();
      await p.getByText('Selection received',{exact:true}).waitFor({state:'attached'});
      if(width===390&&await p.locator('.mws-chat-toggle').getAttribute('aria-expanded')==='false')await p.locator('.mws-chat-toggle').click();
      await p.getByText('Selection received',{exact:true}).waitFor();
      await p.locator('[data-tab=knowledge]').click();await p.getByText('Known facts and decisions',{exact:true}).waitFor();
      await p.locator('[data-tab=tools]').click();
      await p.locator('[data-version="1"]').first().click();
      await p.locator('.mws-dialog [name=confirm]').check();await p.locator('.mws-dialog [type=submit]').click();
      await p.locator('form[data-tool-form]').first().waitFor();
      const startCalls=(await (await fetch(base+'/test/state')).json()).model_calls;
      await p.locator('form[data-tool-form]').first().locator('[name=percent]').fill('20');
      await p.locator('form[data-tool-form]').first().locator('button[value=preview]').click();
      await p.locator('[data-decision=approve]').waitFor();
      assert.equal(await p.getByText('Calculated result',{exact:true}).count(),0);
      await p.locator('[data-decision=approve]').click();
      await p.getByText('Calculated result',{exact:true}).first().waitFor();
      assert((await p.locator('.mws-dashboard').innerText()).includes('120'));
      assert.equal((await (await fetch(base+'/test/state')).json()).model_calls,startCalls);
      await p.locator('form[data-tool-form]').first().locator('[name=percent]').fill('20');
      await p.locator('form[data-tool-form]').first().locator('button[value=execute]').click();
      await p.locator('[data-decision=approve]').waitFor();await p.locator('[data-decision=approve]').click();
      await p.waitForFunction(()=>document.querySelectorAll('.mws-dashboard .mws-card').length>2);
      if(width===390){
      await p.locator('.mws-file').setInputFiles({name:'shot.png',mimeType:'image/png',buffer:Buffer.from('png')});
      await p.locator('.mws-chip',{hasText:'shot.png'}).waitFor();
      await p.locator('.mws-compose [name=message]').fill('Look at this screenshot');
      await p.locator('.mws-compose [type=submit]').click();
      await p.locator('.mws-message.user',{hasText:'📎 shot.png'}).waitFor();
      assert.equal(await p.locator('.mws-chip').count(),0);
      assert(!(await p.locator('.mws-messages').innerText()).includes('saved on the server'));
      }
      {
        // The view never moves by itself: a change made by the agent leaves the chosen tab as it is.
        let mode='plain';const stamp=Date.now()/1000;
        await p.route(new RegExp('/agents/workspaces/'+wid+'$'),async route=>{const res=await route.fetch();const data=await res.json();
          if(mode!=='plain'){data.workspace.tasks=[{id:'ft',title:'Follow task',status:'running',items:[],events:[],pending:[],rounds:1,max_rounds:3,activity:{kind:'search',detail:'x',since:stamp}}];}
          if(mode==='found')data.workspace.knowledge.push({id:'zz',title:'Followed finding',content:'Found by the agent',source:'agent'});
          await route.fulfill({response:res,json:data});});
        await p.locator('[data-tab=tools]').click();await p.evaluate(()=>document.activeElement.blur());
        mode='run';await p.waitForTimeout(2500);mode='found';
        await p.waitForTimeout(4500);
        assert.equal(await p.locator('[data-tab=tools]').getAttribute('aria-selected'),'true');
        await p.locator('[data-tab=knowledge]').click();
        assert.equal(await p.locator('.mws-new').count(),0);
        await p.locator('.mws-dashboard',{hasText:'Followed finding'}).waitFor({timeout:6000});
        await p.locator('[data-tab=tools]').click();
        await p.unroute(new RegExp('/agents/workspaces/'+wid+'$'));
      }
      {
        // Approval level: saved for the project, and a new approval never moves the view.
        assert.equal(await p.locator('.mws-approval').inputValue(),'manual');
        await p.locator('.mws-approval').selectOption('safe');
        await p.waitForFunction(()=>document.querySelector('.mws-approval')?.value==='safe');
        assert.equal((await direct('/pub/mvmai/agents/workspaces/'+wid)).data.workspace.approval,'safe');
        await p.locator('.mws-approval').selectOption('manual');await p.waitForFunction(()=>document.querySelector('.mws-approval')?.value==='manual');
        let ask=false;await p.route(new RegExp('/agents/workspaces/'+wid+'$'),async route=>{const res=await route.fetch();const data=await res.json();
          if(ask){data.workspace.tasks=[{id:'at',title:'Approval task',status:'awaiting_approval',items:[],events:[],rounds:1,max_rounds:3,pending:[{id:'ap1',name:'agent_run_command',status:'pending',arguments:{reason:'Run it',content:'',command:'ls'},execution_scope:{}}]}];}
          await route.fulfill({response:res,json:data});});
        await p.locator('[data-tab=resources]').click();await p.evaluate(()=>document.activeElement.blur());
        ask=true;await p.waitForTimeout(4500);
        assert.equal(await p.locator('[data-tab=resources]').getAttribute('aria-selected'),'true');
        await p.unroute(new RegExp('/agents/workspaces/'+wid+'$'));
      }
      {
        // Polling must keep working while composing, with a real question and the latest result.
        let phase='working';
        await p.route(new RegExp('/agents/workspaces/'+wid+'$'),async route=>{
          const res=await route.fetch(),data=await res.json();
          data.workspace.tasks=[{id:'latest',title:'Latest request',status:phase==='working'?'running':phase==='question'?'awaiting_user':'completed',
            next_action:'Publish to all subscribers? <img src=x onerror=alert(1)> I recommend saving a draft.',result:'Latest verified result',items:[],events:[],pending:[],rounds:1,max_rounds:30,
            activity:{kind:'read',detail:'Reviewing sources',since:Date.now()/1000}},
            {id:'older',title:'Old request',status:'completed',result:'Obsolete result',items:[],events:[],pending:[]}];
          data.workspace.messages.push({id:999,role:'assistant',content:'**Verified** result\n```text\n<img src=x onerror=alert(1)>\n```\n[Source](https://example.com)'});
          await route.fulfill({response:res,json:data});
        });
        await p.locator('[data-tab=live]').click();
        if(width===390&&await p.locator('.mws-chat-toggle').getAttribute('aria-expanded')==='false')await p.locator('.mws-chat-toggle').click();
        const input=p.locator('.mws-compose textarea');await input.fill('Keep this draft');
        await p.evaluate(()=>window.originalComposer=document.querySelector('.mws-compose textarea'));
        phase='question';
        await p.locator('[data-graph-node=user].awaiting_user').waitFor({timeout:6000});
        assert.equal(await input.inputValue(),'Keep this draft');
        assert(await p.evaluate(()=>window.originalComposer===document.querySelector('.mws-compose textarea')));
        assert.equal(await p.locator('.mws img').count(),0);
        assert.equal(await p.locator('.mws-message strong',{hasText:'Verified'}).count(),1);
        assert.equal(await p.locator('.mws-message a',{hasText:'Source'}).getAttribute('href'),'https://example.com');
        assert((await p.locator('.mws-message pre code').innerText()).includes('<img'));
        await p.locator('[data-graph-node=user]').click();await p.locator('.mws-inspector-question',{hasText:'Publish to all subscribers?'}).waitFor();
        await p.locator('.mws-inspector [data-action=reply]').click();assert(await input.evaluate(el=>el===document.activeElement));
        phase='done';await p.locator('[data-graph-node=result].completed').waitFor({timeout:6000});await p.locator('[data-graph-node=result]').click();await p.locator('.mws-inspector-body',{hasText:'Latest verified result'}).waitFor();await p.keyboard.press('Escape');
        assert(!(await p.locator('.mws-dashboard').innerText()).includes('Obsolete result'));
        await p.unroute(new RegExp('/agents/workspaces/'+wid+'$'));
      }
      await p.locator('.mva-chat-mode').click();assert.equal(await p.locator('.mvmai-input').inputValue(),'Keep my ordinary chat draft');
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
      await p.evaluate(()=>handle.destroy());await p.close();
      console.log(`PASS ${width}px: real backend project onboarding, one conversation, schema choice, persistent notes, version activation, approved preview/execute and no extra AI calls`);
    }
  }finally{await browser?.close();server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
