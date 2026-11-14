// No real provider requests or charges: exercise the licensed browser module.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:950}}),errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  let info={premium:true,enabled:true,images_enabled:true,ready:true,signed_in:true,images:true};
  let chatMode='edit',imageData='',chatBody,imageBody,images=0,scripts=0;
  let settings={premium:true,assistant:false,images:false,public:false};
  await page.route('https://design.test/**',async route=>{
   const u=new URL(route.request().url()),name=u.pathname;
   if(name==='/api/apps/mvmdesign/admin/settings'){
    if(route.request().method()==='PUT'){settings={premium:true,...route.request().postDataJSON()};return route.fulfill({json:{ok:true}});}
    return route.fulfill({json:settings});
   }
   if(name.endsWith('/ai/status'))return route.fulfill({json:info});
   if(name.endsWith('/ai/assistant.js')){scripts++;return route.fulfill({path:path.join(app,'premium/public/assistant.js'),contentType:'text/javascript'});}
   if(name.endsWith('/ai/chat')){
    chatBody=route.request().postDataJSON();const p=chatBody.project,pg=p.pages[0],it=pg.items[0];
    const actions=chatMode==='edit'?[
     {op:'update_item',pageId:pg.id,itemId:it.id,properties:{color:'#22aa44'}},
     ...p.captionStyles.map(s=>({op:'set_caption_style',styleId:s.id,properties:{color:'#22aa44',strokeWidth:3}}))
    ]:chatMode==='image'?[{op:'generate_image',pageId:pg.id,placement:'background',prompt:'A quiet sea at sunset, no text'}]:[{op:'run_shell'}];
    return route.fulfill({json:{text:'Proposed the requested changes.',actions}});
   }
   if(name.endsWith('/ai/image')){imageBody=route.request().postDataJSON();images++;return route.fulfill({json:{mime:'image/png',data:imageData}});}
   if(name.startsWith('/apps/mvmdesign/'))return route.fulfill({path:path.join(app,'public',name.slice('/apps/mvmdesign/'.length)),contentType:name.endsWith('.css')?'text/css':'text/javascript'});
   if(name==='/api/auth/whoami')return route.fulfill({json:{effective_user:'fixture'}});
   if(name==='/pub/mvmfonts/client.js')return route.fulfill({contentType:'text/javascript',body:'window.MvmFontsClient={families:[],load:async()=>[],ready:async()=>{},has:()=>false};'});
   if(name==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>html,body{height:100%;margin:0}:root{--bg:#f5f6fa;--surface:#fff;--text:#202635;--border:#c9cdd8;--accent:#6352d8;--on-accent:#fff}</style><link rel="stylesheet" href="/apps/mvmdesign/design.css"><div id="root" style="height:100%"></div><script>window.asset=s=>s;localStorage.setItem('apphub_token','fixture');window.mvmOS={lang:'en',premiumGate:()=>{}};</script>${['i18n','model','render','export','ai','editor'].map(f=>`<script src="/apps/mvmdesign/${f}.js"></script>`).join('')}<script>window.editor=new MvmDesign.Editor(document.querySelector('#root'));</script>`});
   throw Error('Unexpected request '+name);
  });
  await page.goto('https://design.test/');await page.waitForFunction(()=>editor.db&&editor.ai?.info);
  imageData=await page.evaluate(async()=>{
   const M=MvmDesignModel,p=M.project();p.name='Sea and solitude';
   p.pages[0].items=[Object.assign(M.item('text'),{text:'Alone by the sea',color:'#ffffff'})];
   p.captionStyles=[{id:'row1',name:'First row',style:{...p.captionStyle,y:.1}},{id:'row2',name:'Second row',style:{...p.captionStyle,y:.4,font:'serif'}}];
   p.captions=[{id:'c1',text:'The waves return',start:1,end:3,styleId:'row1',style:{}},{id:'c2',text:'A quiet shore',start:3,end:5,styleId:'row2',style:{x:.2}}];
   await editor.installProject(p);
   const c=document.createElement('canvas');c.width=320;c.height=180;c.getContext('2d').fillRect(0,0,320,180);return c.toDataURL().split(',')[1];
  });
  await page.evaluate(data=>window.testImageData=data,imageData);
  info.premium=false;info.enabled=info.images_enabled=false;await page.evaluate(()=>editor.ai.status());
  assert.equal(await page.locator('[data-action=ai-chat]').isVisible(),true);
  await page.locator('[data-action=ai-chat]').click();assert.equal(scripts,0);
  info.premium=true;await page.evaluate(()=>editor.ai.status());await page.locator('[data-action=ai-chat]').click();assert.equal(scripts,0);
  info.enabled=info.images_enabled=true;await page.evaluate(()=>editor.ai.status());
  const before=await page.evaluate(()=>({p:JSON.stringify(editor.p),timing:editor.p.captions.map(c=>[c.id,c.start,c.end]),pos:editor.p.captionStyles.map(s=>[s.id,s.style.x,s.style.y,s.style.font])}));
  await page.locator('[data-action=ai-chat]').click();await page.locator('.md-ai-panel').waitFor();assert.equal(scripts,1);
  const ask=async text=>{await page.locator('.md-ai-panel textarea').fill(text);await page.locator('.md-ai-panel').getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>!editor.ai.panel.busy);};
  await ask('Make the title and both subtitle styles green with an outline.');
  assert.equal(chatBody.project.name,'Sea and solitude');assert.equal(chatBody.project.width,1920);assert.equal(chatBody.project.captions[0].text,'The waves return');assert.equal(chatBody.project.audio,null);
  assert.equal(await page.evaluate(()=>JSON.stringify(editor.p)),before.p,'review must not mutate');
  await page.locator('.md-ai-panel').getByRole('button',{name:'Apply',exact:true}).click();
  const after=await page.evaluate(()=>({color:editor.p.pages[0].items[0].color,styles:editor.p.captionStyles.map(s=>s.style.color),timing:editor.p.captions.map(c=>[c.id,c.start,c.end]),pos:editor.p.captionStyles.map(s=>[s.id,s.style.x,s.style.y,s.style.font])}));
  assert.equal(after.color,'#22aa44');assert.deepEqual(after.styles,['#22aa44','#22aa44']);assert.deepEqual(after.timing,before.timing);assert.deepEqual(after.pos,before.pos);
  await page.evaluate(()=>editor.action('undo'));assert.equal(await page.evaluate(()=>JSON.stringify(editor.p)),before.p);
  await ask('Make it green again');await page.evaluate(()=>editor.commit(()=>{editor.p.name='Edited meanwhile';}));
  await page.locator('.md-ai-panel').getByRole('button',{name:'Apply',exact:true}).click();
  assert.equal(await page.evaluate(()=>editor.p.pages[0].items[0].color),'#ffffff');assert.match(await page.locator('.md-toast').textContent(),/project changed/i);
  // Dedicated image action sends context, reviews pixels and inserts in one Undo.
  await page.locator('[data-action=ai-image]').click();
  const modal=page.locator('.md-modal');await modal.locator('textarea').fill('Warm light, a calm sea');
  await modal.locator('[data-apply]').click();await modal.locator('img').waitFor();
  fs.mkdirSync('/tmp/mvmdesign-check',{recursive:true});await page.screenshot({path:'/tmp/mvmdesign-check/ai-image-preview.png'});
  assert.equal(images,1);assert.equal(imageBody.project.width,1920);assert.equal(imageBody.prompt,'Warm light, a calm sea');
  assert.equal(await page.evaluate(()=>editor.p.pages[0].items.length),1);
  await modal.locator('[data-apply]').click();await page.waitForFunction(()=>!document.querySelector('.md-modal'));
  assert.equal(await page.evaluate(()=>editor.p.pages[0].items[0].type),'image');
  assert.equal(await page.evaluate(()=>editor.p.pages[0].items[0].w),1);
  assert.equal(await page.evaluate(()=>Object.keys(editor.p.assets).length),1);
  await page.evaluate(()=>editor.action('undo'));assert.equal(await page.evaluate(()=>editor.p.pages[0].items.length),1);
  await page.evaluate(async()=>{
   const M=MvmDesignModel,source='data:image/png;base64,'+window.testImageData;
   const old=Object.assign(M.item('image'),{assetId:'old-bg',x:0,y:0,w:1,h:1});
   editor.commit(()=>{editor.p.assets['old-bg']={src:source,name:'Old background'};editor.p.pages[0].items.unshift(old);});
   await editor.ai.panel.insertImage(source,editor.pg.id,'background');
   window.backgroundOrder=editor.pg.items.map(i=>i.type==='image'?(i.assetId==='old-bg'?'old':'new'):'text');
   editor.action('undo');editor.action('undo');
  });
  assert.deepEqual(await page.evaluate(()=>backgroundOrder),['old','new','text']);
  chatMode='image';await page.locator('.md-ai-panel').getByRole('button',{name:'Clear chat',exact:true}).click();
  await ask('Generate a background inspired by the subtitles');
  await page.locator('.md-ai-panel').getByRole('button',{name:'Apply',exact:true}).click();await modal.waitFor();assert.equal(images,1);
  assert.match(await modal.locator('textarea').inputValue(),/quiet sea/);await modal.locator('[data-cancel]').click();
  // Invalid/locked plans are atomic; no IDs, timing or unrelated fields drift.
  const atomic=await page.evaluate(()=>{
   const A=MvmDesignAssistant,p=editor.p,pg=p.pages[0],it=pg.items[0],before=JSON.stringify(p);let rejected=0;
   for(const action of [{op:'run_shell'},{op:'update_item',pageId:pg.id,itemId:it.id,properties:{src:'https://anything'}},{op:'update_caption',captionId:p.captions[0].id,properties:{end:-1}}])try{A.plan(p,[{op:'set_project',properties:{name:'Bad'}},action]);}catch(_){rejected++;}
   const q=MvmDesignModel.clone(p);q.pages[0].items[0].locked=true;try{A.plan(q,[{op:'delete_item',pageId:pg.id,itemId:it.id}]);}catch(_){rejected++;}
   return {rejected,same:before===JSON.stringify(p)};
  });assert.deepEqual(atomic,{rejected:4,same:true});
  const composition=await page.evaluate(()=>{
   const p=editor.p,A=MvmDesignAssistant;
   const result=A.plan(p,[
    {op:'add_page',ref:'scene',properties:{name:'New scene',bg:'#204060',gradient:false}},
    {op:'add_item',ref:'title',pageId:'@scene',type:'text',properties:{text:'A new beginning',size:.08,color:'#ffffff'}},
    {op:'update_item',pageId:'@scene',itemId:'@title',properties:{x:.2}},
    {op:'add_clip',pageId:'@scene',duration:8},
    {op:'add_caption_style',ref:'green',name:'Green row',properties:{color:'#22aa44',y:.2}},
    {op:'add_caption',properties:{text:'New subtitle',start:6,end:8,styleId:'@green'}},
    {op:'add_caption_drafts',texts:['Not timed yet']}
   ]).project;
   const last=result.pages.at(-1),style=result.captionStyles.at(-1),caption=result.captions.at(-1);
   return {original:p.pages.length,pages:result.pages.length,text:last.items[0].text,x:last.items[0].x,clip:result.sequence.at(-1).pageId===last.id,linked:caption.styleId===style.id,draft:result.captionDrafts.at(-1).text,ids:result.captions.slice(0,p.captions.length).every((c,i)=>c.id===p.captions[i].id)};
  });
  assert.deepEqual(composition,{original:1,pages:2,text:'A new beginning',x:.2,clip:true,linked:true,draft:'Not timed yet',ids:true});
  fs.mkdirSync('/tmp/mvmdesign-check',{recursive:true});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>{if(theme==='dark'){for(const [k,v]of Object.entries({bg:'#171b29',surface:'#252b3b',text:'#edf0ff',border:'#515b70'}))document.documentElement.style.setProperty('--'+k,v);}editor.root.querySelector('.md-toast')?.remove();},theme);
   await page.screenshot({path:'/tmp/mvmdesign-check/ai-'+theme+'.png'});
  }
  // Public shell hides unavailable premium controls, without a premium upsell.
  await page.evaluate(()=>{editor.ai.public=true;editor.ai.token='fixture';});info.premium=false;info.enabled=info.images_enabled=false;await page.evaluate(()=>editor.ai.status());
  assert.equal(await page.locator('[data-action=ai-chat]').isHidden(),true);assert.equal(await page.locator('[data-action=ai-image]').isHidden(),true);
  // Settings: three switches only, locked without the premium module; profile and prices stay with Apps Hub.
  await page.evaluate(()=>{window.mvmOS.registerApp=definition=>window.designDefinition=definition;});
  await page.addScriptTag({url:'https://design.test/apps/mvmdesign/main.js'});
  await page.evaluate(async()=>{const wrap=document.createElement('div');wrap.id='ai-settings-test';document.body.appendChild(wrap);await designDefinition.renderSettingsExtra(wrap);});
  const panel=page.locator('#ai-settings-test');
  assert.equal(await page.evaluate(()=>designDefinition.requires_apphub),true);
  assert.equal(await panel.locator('[data-design-ai]').count(),3);
  await panel.locator('[data-design-ai=assistant]').check();await panel.locator('[data-design-ai=images]').check();
  await page.evaluate(()=>designDefinition.saveSettingsExtra(document.querySelector('#ai-settings-test')));
  assert.equal(settings.assistant,true);assert.equal(settings.images,true);assert.equal(settings.public,false);
  settings.premium=false;
  await page.evaluate(()=>designDefinition.renderSettingsExtra(document.querySelector('#ai-settings-test')));
  assert.equal(await panel.locator('input:disabled').count(),3);
  await panel.evaluate(el=>el.remove());
  assert.deepEqual(errors,[]);await page.evaluate(()=>editor.destroy());
  console.log('PASS premium/public gates, contextual chat, atomic tools, stable IDs/times/positions, stale rejection, Undo, image context/review/insertion, chat image tool and themes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
