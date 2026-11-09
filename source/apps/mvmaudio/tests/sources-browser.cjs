// The library manager can add audio from the server and from a shared folder through the
// shared picker. Needs the test server: python tests/test_api.py serve
const {chromium}=require(process.env.MVM_AUDIO_PLAYWRIGHT||'playwright-core');
const assert=require('assert');
(async()=>{
 const base='http://127.0.0.1:2087',browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 await ctx.addCookies([{name:'session',value:'admin',url:base}]);await ctx.addInitScript(()=>localStorage.setItem('apphub_token','a'));
 const request=ctx.request;await request.put(base+'/test-only/premium?value=false');
 const server=await (await request.put(base+'/test-only/server-file')).json();
 const wav=Buffer.alloc(44+8000*2*12);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 // What File Manager would answer to the picker, and a remote sharing server.
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(base+'/api/files/places',r=>r.fulfill({json:{username:'u',home:server.home,xdg:[]}}));
 await page.route(base+'/api/files?**',r=>{const p=new URL(r.request().url()).searchParams.get('path');
  r.fulfill({json:{entries:p===server.home?[{name:'server-files',type:'dir',size:0}]:p===server.dir?[{name:'Chapter One.wav',type:'file',size:wav.length},{name:'readme.txt',type:'file',size:3}]:[]}})});
 await page.route(base+'/api/files/sharing',r=>r.fulfill({json:{outgoing:[],incoming:[{id:'f1',name:'Studio NAS',origin:'https://nas.example',grant_id:'g'.repeat(32)}]}}));
 await page.route(base+'/api/files/remote-folders/f1',r=>r.fulfill({json:{id:'f1',name:'Studio NAS',origin:'https://nas.example',grant_id:'g'.repeat(32),secret:'s'.repeat(40)}}));
 let remoteHits=[];
 await page.route('https://nas.example/**',r=>{const u=new URL(r.request().url()),h={'access-control-allow-origin':base,'access-control-allow-headers':'Authorization,Content-Type','access-control-allow-methods':'GET,POST,OPTIONS'};
  remoteHits.push(r.request().method()+' '+u.pathname.replace(/[a-f0-9]{32}/,'GRANT'));
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:h});
  if(u.pathname.endsWith('/list'))return r.fulfill({headers:h,json:{entries:u.searchParams.get('path')===''?[{name:'Part 1.wav',type:'file',size:wav.length},{name:'cover.jpg',type:'file',size:5}]:[],permissions:['read']}});
  if(u.pathname.endsWith('/ticket'))return r.fulfill({headers:h,json:{ticket:'T.S'}});
  if(u.pathname.endsWith('/file'))return r.fulfill({headers:{...h,'content-type':'audio/wav','accept-ranges':'bytes'},body:wav});
  r.fulfill({status:404,headers:h,body:'{}'});});
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');await page.click('[data-manage]');await page.click('[data-tab=books]');await page.click('[data-add]');await page.waitForSelector('[data-import-upload]');
 // 1. From the server: opens in the person's home, only audio is offered.
 await page.click('[data-pick=files]');await page.waitForSelector('.mvm-fp [data-source]');
 assert.equal(await page.locator('.mvm-fp [data-source]').count(),3,'device, server and shared folder');
 await page.click('.mvm-fp [data-source=server]');await page.click('.mvm-fp [data-open="server-files"]');await page.waitForSelector('.mvm-fp [data-file]');
 assert.deepEqual(await page.locator('.mvm-fp [data-file]').evaluateAll(n=>n.map(x=>x.dataset.file)),['Chapter One.wav']);
 await page.click('.mvm-fp [data-file]');await page.click('.mvm-fp [data-confirm]');
 await page.waitForFunction(()=>document.querySelector('[data-import-count]').textContent.startsWith('1'));
 await page.click('[data-import-upload]');await page.waitForSelector('[data-import-upload]',{state:'detached',timeout:30000});
 let items=(await (await request.get(base+'/api/apps/mvmaudio/admin')).json()).items.filter(i=>i.tracks.length);
 const copied=items.find(i=>i.tracks.some(t=>!t.remote));assert.ok(copied,'the server file was copied into the library');
 assert.equal(await page.locator('.ma-import-result').count(),1);
 // 2. From a shared folder: linked, not copied, and played from the sharing server.
 await page.click('[data-add]');await page.waitForSelector('[data-import-upload]');
 await page.click('[data-pick=files]');await page.click('.mvm-fp [data-source=shared]');await page.waitForSelector('.mvm-fp [data-file]');
 assert.deepEqual(await page.locator('.mvm-fp [data-file]').evaluateAll(n=>n.map(x=>x.dataset.file)),['Part 1.wav'],'only audio files are listed');
 await page.click('.mvm-fp [data-file]');await page.click('.mvm-fp [data-confirm]');
 await page.click('[data-import-upload]');await page.waitForSelector('[data-import-upload]',{state:'detached',timeout:30000});
 items=(await (await request.get(base+'/api/apps/mvmaudio/admin')).json()).items.filter(i=>i.tracks.length);
 const linked=items.find(i=>i.tracks.some(t=>t.remote));assert.ok(linked,'the shared file is in the library');
 assert.equal(linked.tracks[0].title,'Part 1');assert.ok(Math.abs(linked.tracks[0].duration-12)<1,'duration was read from the file');
 assert.ok(remoteHits.some(h=>h.startsWith('POST')&&h.endsWith('/ticket')),'the browser asked the sharing server for a link');
 // Playing it loads the audio straight from the sharing server.
 const sources=[];page.on('request',r=>{if(r.url().startsWith('https://nas.example/')&&r.url().includes('/file?'))sources.push(r.url())});
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-tab="books"]');await page.click('[data-tab="books"]');
 await page.locator('.ma-card [data-detail="'+linked.id+'"]').first().click();
 await page.locator('[data-detail-play]').first().click();
 await page.waitForFunction(()=>{const a=document.querySelector('audio');return a&&a.src.startsWith('https://nas.example/')},null,{timeout:15000});
 assert.ok(sources.length>0,'audio bytes were requested from the sharing server');
 assert.ok(!(await page.evaluate(()=>document.querySelector('audio').src)).includes('127.0.0.1'),'not proxied through this server');
 assert.deepEqual(errors,[]);
 console.log('Library sources: server copy, shared-folder link without a copy, playback from the sharing server; no page errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
