// Deterministic public activity facts: no paid model, personal project or real command.
const {chromium}=require(process.env.MVMAI_PLAYWRIGHT_MODULE||'playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{for(const width of [1440,390])for(const theme of ['dark','light']){
  const page=await browser.newPage({viewport:{width,height:960},reducedMotion:theme==='light'?'reduce':'no-preference'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><main id="root"></main>');
  await page.evaluate(theme=>{window.browserErrors=[];window.addEventListener('error',e=>browserErrors.push(e.message));window.mvmOS={lang:'en'};window._i18n={};window.t=k=>window._i18n[k]||k;document.documentElement.dataset.theme=theme;document.body.style.color=theme==='light'?'#111':'#eee';},theme);
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'public/i18n.js'),'utf8')});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'premium/public/workspaces.js'),'utf8')});
  await page.evaluate(()=>{
   const stamp=Date.now()/1000;
   window.fixture={id:'project',name:'Product launch',description:'Prepare the launch with verified sources.',approval:'auto',model_info:{label:'Selected model'},messages:[{id:1,role:'user',content:'Prepare the announcement.'}],views:[],tools:[],knowledge:[],resources:[],tasks:[{id:'task',title:'Prepare the launch',status:'running',pending:[],events:[],items:[{id:'step',title:'Review product sources',status:'running',action:'Inspect the documentation'}],rounds:1,max_rounds:30,activity:{id:'model1',kind:'model',detail:'1/30',since:stamp},trace:[{id:'model1',kind:'model',detail:'1/30',since:stamp,status:'running'}]}]};
   window.handle=MvmaiPremium.createWorkspaces({root:document.querySelector('#root'),t:window.t,esc:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),lang:()=> 'en',api:async url=>url==='/agents/workspaces'?{__status:200,workspaces:[{id:'project',name:'Product launch'}]}:{__status:200,workspace:structuredClone(fixture)}});
  });
  await page.locator('.mws-graph').waitFor();
  assert.equal(await page.locator('.mws-tabs [aria-selected=true]').innerText(),'Activity');
  if(width===390){const box=await page.locator('.mws-dashboard').boundingBox();for(const ring of await page.locator('.mws-node-ring').all()){const r=await ring.boundingBox();assert(r.y+r.height/2>box.y&&r.y+r.height/2<box.y+box.height,'Map nodes should be visible at initial mobile size');}await page.locator('.mws-chat-toggle').click();assert.equal(await page.locator('.mws-layout').getAttribute('data-chat-expanded'),'true');}
  assert.equal(await page.locator('.mws-flow').count(),1);assert.equal(await page.locator('[data-flow="agent:model"]').getAttribute('data-direction'),'out');
  await page.locator('.mws-compose textarea').fill('Keep my draft');
  await page.evaluate(()=>{window.inputBefore=document.querySelector('.mws-compose textarea');const t=fixture.tasks[0],stamp=Date.now()/1000;t.trace[0].status='completed';t.trace[0].finished_at=stamp;t.trace.push({id:'read1',kind:'read',detail:'https://example.com/product',since:stamp,status:'running'});t.activity={...t.trace[1]};});
  await page.locator('[data-flow="agent:read"][data-direction=out]').waitFor({timeout:6000});
  assert.equal(await page.locator('[data-flow="agent:model"]').getAttribute('data-direction'),'in');
  assert.equal(await page.locator('[data-flow="agent:model"] .mws-return').count(),theme==='light'?0:1);
  assert.equal(await page.locator('.mws-flow').count(),1);
  await page.evaluate(()=>window.currentReturn=document.querySelector('[data-flow="agent:model"] .mws-return'));
  await page.waitForTimeout(2100);assert(await page.evaluate(()=>window.currentReturn===document.querySelector('[data-flow="agent:model"] .mws-return')));
  assert(await page.evaluate(()=>window.inputBefore===document.querySelector('.mws-compose textarea')));
  await page.locator('[data-tab=overview]').click();await page.locator('[data-tab=live]').click();assert.equal(await page.locator('.mws-return').count(),0);assert.equal(await page.locator('.mws-flow').count(),1,'Real ongoing work should still animate after returning');
  if(width===390&&await page.locator('.mws-chat-toggle').getAttribute('aria-expanded')==='true')await page.locator('.mws-chat-toggle').click();
  await page.screenshot({path:(process.env.MVMAI_GRAPH_SCREENSHOTS||'/tmp')+'/mvmai-graph-'+width+'-'+theme+'-running.png'});
  await page.locator('[data-graph-node=read]').click();
  await page.locator('.mws-inspector [role=dialog]').waitFor();assert((await page.locator('.mws-inspector').innerText()).includes('https://example.com/product'));
  await page.keyboard.press('Escape');assert.equal(await page.locator('.mws-inspector').count(),0);
  assert(await page.locator('[data-graph-node=read]').evaluate(el=>el===document.activeElement));
  await page.evaluate(()=>{const t=fixture.tasks[0];t.status='awaiting_user';t.next_action='Publish to all subscribers or keep the draft? <img src=x onerror=alert(1)> I recommend keeping the draft.';t.trace[1].status='completed';t.trace[1].finished_at=Date.now()/1000;t.activity=null;});
  await page.locator('[data-graph-node=user].awaiting_user').waitFor({timeout:6000});
  assert.equal(await page.locator('.mws-flow').count(),0);
  await page.screenshot({path:(process.env.MVMAI_GRAPH_SCREENSHOTS||'/tmp')+'/mvmai-graph-'+width+'-'+theme+'-waiting.png'});
  // All tabs retain identical chrome, work panel and conversation geometry.
  const geometry=()=>page.evaluate(()=>Object.fromEntries(['.mws-header','.mws-livebar','.mws-tabs','.mws-layout','.mws-dashboard','.mws-chat'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return [selector,[r.x,r.y,r.width,r.height].map(Math.round)];})));
  const initialGeometry=await geometry();
  for(const tab of ['overview','tasks','tools','knowledge','resources','activity','live']){
   await page.locator('.mws-tabs [data-tab='+tab+']').click();
   assert.deepEqual(await geometry(),initialGeometry,'Stable layout on '+tab+' at '+width);
   assert.equal(await page.locator('.mws-tabs [data-tab=live].mws-needs-action').count(),1);
   assert.equal(await page.locator('.mws-tabs [data-tab=tasks].mws-needs-action').count(),1);
   assert((await page.locator('.mws-live-text').innerText()).includes('Publish to all subscribers'));
   await page.locator('.mws-livebar [data-attention]').click();
   assert((await page.locator('.mws-inspector-question').innerText()).includes('Publish to all subscribers'));
   await page.keyboard.press('Escape');
  }

  await page.locator('[data-graph-node=user]').click();
  await page.locator('.mws-inspector-question',{hasText:'Publish to all subscribers'}).waitFor();assert.equal(await page.locator('.mws-inspector img').count(),0);
  await page.screenshot({path:(process.env.MVMAI_GRAPH_SCREENSHOTS||'/tmp')+'/mvmai-graph-'+width+'-'+theme+'-inspector.png'});
  await page.locator('.mws-inspector [data-action=reply]').click();assert.equal(await page.locator('.mws-inspector').count(),0);
  assert(await page.locator('.mws-compose textarea').evaluate(el=>el===document.activeElement));assert.equal(await page.locator('.mws-compose textarea').inputValue(),'Keep my draft');
  // Graph task steps open their actual board record, including the next action.
  await page.locator('[data-graph-item="0"]').click();assert((await page.locator('.mws-inspector').innerText()).includes('Inspect the documentation'));await page.keyboard.press('Escape');
  await page.evaluate(()=>{const t=fixture.tasks[0];t.status='completed';t.result='Verified launch draft is ready.';t.items[0].status='completed';t.items[0].result='Sources verified';});
  await page.locator('[data-graph-node=result].completed').waitFor({timeout:6000});
  assert.equal(await page.locator('.mws-graph-node.awaiting_user,.mws-graph-node.awaiting_approval,.mws-flow,.mws-needs-action').count(),0);
  await page.locator('[data-tab=overview]').click();await page.evaluate(()=>{fixture.tasks[0].trace.push({id:'finished-while-away',kind:'result',status:'completed',since:Date.now()/1000,finished_at:Date.now()/1000});});await page.waitForTimeout(2100);await page.locator('[data-tab=live]').click();assert.equal(await page.locator('.mws-return,.mws-flow').count(),0,'Results received off the Activity page must not replay');
  await page.waitForTimeout(3800);assert.equal(await page.locator('.mws-return').count(),0);
  for(let i=0;i<3;i++){await page.locator('[data-tab=overview]').click();await page.locator('[data-tab=live]').click();assert.equal(await page.locator('.mws-return,.mws-flow').count(),0);}
  await page.evaluate(()=>{handle.show(false);handle.show(true);});await page.waitForTimeout(100);assert.equal(await page.locator('.mws-return,.mws-flow').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(theme==='light')assert.equal(await page.locator('.mws-node-ring:visible').first().evaluate(el=>getComputedStyle(el,':after').animationName),'none');
  await page.screenshot({path:(process.env.MVMAI_GRAPH_SCREENSHOTS||'/tmp')+'/mvmai-graph-'+width+'-'+theme+'.png'});
  if(theme==='dark'){await page.evaluate(()=>{fixture.tasks[0].items=Array.from({length:40},(_,i)=>({id:'s'+i,title:'Recorded step '+i,status:'completed',result:'Verified'}));});await page.locator('[data-graph-item="39"]').waitFor({state:'attached',timeout:6000});for(const [w,h] of [[1600,805],[1366,768],[1280,600],[900,500],[600,400],[390,844],[320,568],[844,390]]){await page.setViewportSize({width:w,height:h});if(w<=760&&await page.locator('.mws-chat-toggle').getAttribute('aria-expanded')==='true')await page.locator('.mws-chat-toggle').click();await page.waitForTimeout(100);const bounds=await page.evaluate(()=>{const d=document.querySelector('.mws-dashboard'),c=document.querySelector('.mws-flowchart'),r=c.getBoundingClientRect();return {scroll:d.scrollHeight-d.clientHeight,overflow:document.documentElement.scrollWidth-innerWidth,nodes:[...document.querySelectorAll('.mws-graph-node')].map(n=>{const b=n.getBoundingClientRect();return {name:n.dataset.graphNode,inside:b.top>=r.top-1&&b.bottom<=r.bottom+1&&b.left>=r.left-1&&b.right<=r.right+1};})};});assert(bounds.scroll<=1,`${w}x${h}: map needs vertical scrolling`);assert(bounds.overflow<=0);assert(bounds.nodes.every(n=>n.inside),`${w}x${h}: clipped nodes `+JSON.stringify(bounds));}}
  if(theme==='dark'){await page.setViewportSize({width:1600,height:900});for(const [w,h] of [[1000,600],[850,440],[600,420],[320,568]]){await page.evaluate(({w,h})=>{const root=document.querySelector('#root');root.style.width=w+'px';root.style.height=h+'px';},{w,h});await page.waitForTimeout(100);const fit=await page.evaluate(()=>{const d=document.querySelector('.mws-dashboard'),c=document.querySelector('.mws-flowchart'),r=c.getBoundingClientRect();return {scroll:d.scrollHeight-d.clientHeight,chart:r.width,nodes:[...document.querySelectorAll('.mws-graph-node')].every(n=>{const b=n.getBoundingClientRect();return b.top>=r.top-1&&b.bottom<=r.bottom+1&&b.left>=r.left-1&&b.right<=r.right+1;})};});assert(fit.scroll<=1&&fit.nodes,`App container ${w}x${h}: `+JSON.stringify(fit));}await page.evaluate(()=>{document.querySelector('#root').style.width='';document.querySelector('#root').style.height='';});}
  assert.deepEqual(await page.evaluate(()=>browserErrors),[],'No browser error events, including ResizeObserver delivery errors');assert.deepEqual(errors,[]);await page.evaluate(()=>handle.destroy());await page.close();
  console.log(`PASS ${width}px ${theme}: real requests/results, directed flow, typed draft, inspectable nodes/steps, decision pulse, focus and completion`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
