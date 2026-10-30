const {chromium} = require(process.env.MVMAI_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const dir = path.join(__dirname,'..');
const widget = fs.readFileSync(path.join(dir,'public/mvmai-widget.js'),'utf8');
const translations = fs.readFileSync(path.join(dir,'public/i18n.js'),'utf8');
if (!fs.existsSync(path.join(dir,'premium/public/agents.js'))) { console.log('SKIP: Premium agent module is not installed'); process.exit(0); }
const premium = fs.readFileSync(path.join(dir,'premium/public/agents.js'),'utf8');
(async () => {
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  for (const width of [1280,390]) {
    const page = await browser.newPage({viewport:{width,height:844}});
    let me={id:'admin',is_admin:true,agents:true,bridge_premium:true,provider:'fake',model:'small',provider_label:'Fake · small'},tasks=[],assetLoads=0;
    await page.route('http://mvmai.test/**',async route => {
      const req=route.request(),u=new URL(req.url()),pathname=u.pathname.replace('/pub/mvmai','');
      let data={};const body=req.postDataJSON();
      if (u.pathname==='/') return route.fulfill({contentType:'text/html',body:'<style>html,body{height:100%;margin:0}#root{height:100%}</style><div id="root"></div>'});
      if (pathname==='/me') data=me;
      else if (pathname==='/premium/agents.js') {assetLoads++;return route.fulfill({contentType:'application/javascript',body:premium});}
      else if (pathname==='/sessions') data={sessions:[]};
      else if (pathname==='/projects') data={projects:[{id:'p',name:'Test project'}]};
      else if (pathname==='/model-options') data={provider:'fake',model:'small',api_providers:[{id:'fake',name:'Fake'}],cli_providers:[]};
      else if (pathname==='/model-options/models') data={models:['small','large']};
      else if (pathname==='/agents/tasks' && req.method()==='GET') data={tasks};
      else if (pathname==='/agents/tasks' && req.method()==='POST') {
        assert.equal(body.lang,'en');assert.equal(body.provider,'fake');
        const task={...body,id:'task1',status:'planned',rounds:0,items:[],events:[],pending:[]};tasks=[task];data={task};
      } else if (pathname.includes('/agents/tasks/task1/')) {
        const task=tasks[0],action=pathname.split('/').pop();
        if (action==='items') {assert.equal(body.status,'awaiting_user');assert.equal(body.next_action,'Verify email');task.items.push({...body,id:'row1'});}
        else if (action==='review') {assert.equal(body.decision,'approve');task.pending[0].status='approved';task.status='paused';}
        else if (action==='start') {task.status='running';task.rounds++;}
        else if (action==='pause') task.status='paused';
        data={task};
      }
      return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.goto('http://mvmai.test/');
    await page.evaluate(()=>{
      localStorage.setItem('apphub_token','test');window.asset=x=>x;
      window.mvmOS={lang:'en',premiumStatus:'premium'};window.t=k=>window._i18n?.[k]||k;
    });
    await page.addScriptTag({content:translations});await page.addScriptTag({content:widget});
    await page.evaluate(()=>window.handle=MvmaiWidget.mount(document.querySelector('#root'),{isDesktopApp:true}));
    await page.locator('.mvmai-input').fill('Unsent main chat draft');
    await page.locator('.mva-agent-mode').click();await page.locator('.mva-main').waitFor();
    assert.equal(await page.locator('.mvmai-widget').isVisible(),false);
    await page.locator('.mva-main [data-action=new]').click();
    await page.locator('.mva-dialog [name=title]').fill('Research campaign');
    await page.locator('.mva-dialog [name=goal]').fill('Find relevant communities');
    await page.locator('.mva-dialog [type=submit]').click();
    await page.locator('.mva-main h2').filter({hasText:'Research campaign'}).waitFor();
    await page.locator('[data-action=add_site]').click();
    await page.locator('.mva-dialog [name=title]').fill('Example forum');
    await page.locator('.mva-dialog [name=status]').selectOption('awaiting_user');
    await page.locator('.mva-dialog [name=next_action]').fill('Verify email');
    await page.locator('.mva-dialog [name=url]').fill('https://example.com');
    await page.locator('.mva-dialog [type=submit]').click();
    await page.locator('td strong').filter({hasText:'Example forum'}).waitFor();
    assert((await page.locator('.mva-main').innerText()).includes('Needs your attention'));
    tasks[0].pending=[{id:'approval1',status:'pending',arguments:{command:'printf safe',reason:'Publish reviewed draft',content:'<img src=x onerror=alert(1)>',destination:'https://example.com',account:'owner'}}];tasks[0].status='awaiting_approval';
    await page.locator('[data-review=approval1][data-decision=approve]').waitFor();
    assert.equal(await page.locator('.mva-main img').count(),0);
    await page.locator('[data-review=approval1][data-decision=approve]').click();
    await page.getByText('Approved — press Continue to execute',{exact:true}).waitFor();
    await page.locator('[data-action=start]').click();await page.locator('.mva-main>.mva-status.mva-running').waitFor();
    await page.locator('[data-action=pause]').click();await page.locator('.mva-main>.mva-status.mva-paused').waitFor();
    await page.evaluate(()=>{window.confirm=()=>{throw new Error('Native dialogs are unavailable');};});
    for (const action of ['cancel','delete']) {
      await page.locator('[data-action='+action+']').click();
      await page.locator('.mva-dialog form[role=dialog]').waitFor();
      await page.locator('.mva-dialog [data-close]').click();
      assert.equal(tasks[0].status,'paused');
    }
    await page.locator('.mva-chat-mode').click();
    assert.equal(await page.locator('.mvmai-input').inputValue(),'Unsent main chat draft');
    await page.locator('.mva-agent-mode').click();
    me={...me,agents:false};
    await page.locator('.mvmai-widget').waitFor({state:'visible'});
    assert.equal(await page.locator('.mvmai-input').inputValue(),'Unsent main chat draft');
    assert.equal(assetLoads,1);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.evaluate(()=>handle.destroy());await page.close();console.log(`PASS ${width}px: create task, edit site, attention status, immutable approval preview, pause, isolated chat draft and feature revocation`);
  }
  for (const scenario of [{admin:false,premium:true,desktop:true},{admin:true,premium:false,desktop:false},{admin:true,premium:false,desktop:true},{admin:true,premium:true,desktop:true}]) {
    const page=await browser.newPage({viewport:{width:1000,height:800}});let assets=0;
    await page.route('http://mvmai.test/**',route=>{
      const p=new URL(route.request().url()).pathname;
      if(p==='/')return route.fulfill({contentType:'text/html',body:'<div id="root" style="height:800px"></div>'});
      if(p.includes('/premium/'))assets++;
      const body=p.endsWith('/me')?{is_admin:scenario.admin,agents:false,bridge_premium:scenario.premium}:{};
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto('http://mvmai.test/');await page.evaluate(({premium})=>{
      localStorage.setItem('apphub_token','test');window.asset=x=>x;window.gates=0;
      window.mvmOS={lang:'en',premiumStatus:premium?'premium':'free',premiumGate:(el)=>el.addEventListener('click',()=>window.gates++)};window.t=k=>window._i18n?.[k]||k;
    },scenario);
    await page.addScriptTag({content:translations});await page.addScriptTag({content:widget});
    await page.evaluate(desktop=>window.handle=MvmaiWidget.mount(document.querySelector('#root'),{isDesktopApp:desktop}),scenario.desktop);
    await page.locator('.mvmai-input').waitFor();
    const locked=scenario.admin&&!scenario.premium&&scenario.desktop;
    assert.equal(await page.locator('.mva-agent-mode').isVisible(),locked);
    if(locked){await page.locator('.mva-agent-mode').click();assert.equal(await page.evaluate(()=>gates),1);}
    assert.equal(assets,0);await page.evaluate(()=>handle.destroy());await page.close();
  }
  console.log('PASS: non-admin, disabled feature and public free controls stay hidden; desktop free button opens Premium without loading code');
  const page=await browser.newPage();
  for(const lang of ['en','bg','de','es','fr','ja','pt-BR','ru','zh-CN']){
    await page.evaluate(lang=>{window.mvmOS={lang};window._i18n={};},lang);await page.addScriptTag({content:translations});
    const keys=await page.evaluate(()=>Object.keys(window._i18n).filter(x=>x.startsWith('mvmai_agent_')));assert.equal(keys.length,82);
  }
  console.log('PASS: all 82 agent strings supplied in all nine languages');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
