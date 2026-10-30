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
      await p.locator('form[data-view]').first().waitFor();
      assert.equal(await p.locator('.mws [name=source_chat_id]').count(),0);
      const wid=await p.locator('.mws-side [aria-selected=true]').getAttribute('data-project');
      const direct=async(url,body,token='admin')=>p.evaluate(async({url,body,token})=>{const r=await fetch(url,{method:body?'POST':'GET',headers:{'X-Pub-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};},{url,body,token});
      const before=(await direct('/pub/mvmai/agents/workspaces/'+wid)).data.workspace;
      assert(before.knowledge.length>0);assert(before.views.length>0);assert(before.tools.length>0);
      assert.equal((await direct('/pub/mvmai/agents/workspaces/'+wid,undefined,'other')).status,404);
      const view=before.views[0];assert.equal((await direct('/pub/mvmai/agents/workspaces/'+wid+'/answer',{id:view.id,revision:0,values:{scope:'all'}})).status,400);
      await p.locator('form[data-view]').first().locator('select').selectOption('some');
      await p.locator('form[data-view]').first().locator('[type=submit]').click();
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
      await p.locator('.mva-chat-mode').click();assert.equal(await p.locator('.mvmai-input').inputValue(),'Keep my ordinary chat draft');
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
      await p.evaluate(()=>handle.destroy());await p.close();
      console.log(`PASS ${width}px: real backend project onboarding, one conversation, schema choice, persistent notes, version activation, approved preview/execute and no extra AI calls`);
    }
  }finally{await browser?.close();server.kill('SIGTERM');}
})().catch(e=>{console.error(e);process.exitCode=1});
