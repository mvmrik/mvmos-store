/* Run against the isolated build() server on 127.0.0.1:2088. */
const {chromium}=require(process.env.MVM_PLAYER_PLAYWRIGHT||'playwright-core');
const assert=require('assert');const fs=require('fs');const path=require('path');const os=require('os');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.addCookies([{name:'session',value:'admin',url:'http://127.0.0.1:2088'}]);
 await context.addInitScript(()=>localStorage.setItem('apphub_token','a'));
 const request=context.request,base='http://127.0.0.1:2088',api='/api/apps/mvmplayer';
 const fixture=fs.readFileSync(path.join(__dirname,'fixtures/sample.webm'));
 async function upload(filename){
  let r=await request.post(base+api+'/uploads',{data:{filename,bytes:fixture.length}});assert(r.ok(),await r.text());const uid=(await r.json()).id;
  r=await request.put(base+api+'/uploads/'+uid+'?offset=0',{data:fixture});assert(r.ok(),await r.text());
  r=await request.post(base+api+'/uploads/'+uid+'/finish');assert(r.ok(),await r.text());return (await r.json()).id;
 }
 const episode=await upload('The.Quiet.Orbit/Season 02/The.Quiet.Orbit.S02E05.The.Arrival.webm');
 const next=await upload('The.Quiet.Orbit.S02E06.The.Signal.webm');
 await upload('The.Last.Harbour.2024.webm');await upload('A walk by the sea.webm');
 for(const [user,seconds]of [['a',5],['b',11]])await request.put(base+'/pub/mvmplayer/media/'+episode+'/state',{headers:{'X-Pub-Token':user},data:{seconds,duration:16,speed:1.25,played:true}});
 await request.put(base+'/test-only/catalogue');
 const match=await(await request.post(base+api+'/media/'+episode+'/lookup',{data:{query:'Quiet Orbit',language:'en'}})).json();
 const applied=await request.post(base+api+'/media/'+episode+'/lookup/apply',{data:{candidate:match.results[0].id,fields:['description'],series_group:true}});assert(applied.ok(),await applied.text());
 const sub=await request.post(base+api+'/media/'+episode+'/subtitles?title=English&language=en',{data:Buffer.from('1\n00:00:00,000 --> 00:00:15,000\nAn example subtitle.\n')});assert(sub.ok(),await sub.text());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');
 assert.equal(await page.locator('video').getAttribute('src'),null);
 await page.locator('[data-open="'+episode+'"]').first().click();await page.waitForSelector('[data-detail-play]');
 assert.equal(await page.locator('video').getAttribute('src'),null); // Details never start playback.
 await page.click('[data-detail-play]');
 await page.waitForFunction(()=>document.querySelector('video').readyState>=2&&!document.querySelector('video').paused);
 const initial=await page.locator('video').evaluate(v=>({position:v.currentTime,speed:v.playbackRate}));assert(initial.position>=5,initial);assert.equal(initial.speed,1.25);
 await page.locator('video').evaluate(v=>v.pause());
 await page.selectOption('[data-speed]','1.5');
 const sid=(await sub.json()).id;await page.selectOption('[data-subtitles]',sid);
 await page.waitForFunction(()=>document.querySelector('video').textTracks.length>0&&document.querySelector('video').textTracks[0].cues?.length>0);
 assert.equal(await page.locator('video').evaluate(v=>v.textTracks[0].mode),'showing');
 await page.locator('video').evaluate(v=>v.currentTime=8);await page.waitForTimeout(300);
 await page.click('[data-tab="movies"]');assert.equal(await page.locator('video').evaluate(v=>v.currentTime),8);
 await page.click('[data-manage]');await page.click('[data-tab="series"]');await page.locator('[data-series]').first().click();
 await page.waitForSelector('[data-season="5"]');await page.click('[data-season="2"]');
 assert.equal(await page.locator('.mp-episode').count(),10);
 assert.equal(await page.locator('.mp-episode.unavailable').count(),8);
 await page.click('[data-episode-open="'+episode+'"]');await page.waitForSelector('[name="title"]');
 await page.click('[data-lookup]');assert((await page.locator('.mp-lookup-context').innerText()).includes('S02E05'));
 await page.click('[data-lookup-search]');await page.waitForSelector('[data-match-status="found"]');
 assert((await page.locator('[data-result]').first().innerText()).includes('Episode 5'));
 await page.locator('[data-result]').first().click();await page.waitForSelector('[data-field="episode_title"]');
 assert(await page.locator('[data-field="episode_title"]').isChecked());
 await page.click('[data-apply]');await page.waitForSelector('[name="title"]');
 assert.equal(await page.inputValue('[name="title"]'),'Episode 5');
 const matched=await(await request.get(base+'/pub/mvmplayer/library',{headers:{'X-Pub-Token':'a'}})).json();
 assert.equal(matched.items.find(i=>i.id===next).title,'Episode 6');
 await page.fill('[name="title"]','The Arrival — Revised');await page.locator('.mp-form button[type="submit"]').click();await page.waitForSelector('.mp-modal',{state:'detached'});
 let lib=await(await request.get(base+'/pub/mvmplayer/library',{headers:{'X-Pub-Token':'a'}})).json();assert(lib.items.find(i=>i.id===episode).state.seconds>=8);
 const bLib=await(await request.get(base+'/pub/mvmplayer/library',{headers:{'X-Pub-Token':'b'}})).json();assert.equal(bLib.items.find(i=>i.id===episode).state.seconds,11);
 await page.click('[data-manage]');await page.click('[data-tab="home"]');
 await page.screenshot({path:path.join(os.tmpdir(),'mvmplayer-desktop.png')});
 await page.click('[data-tab="collections"]');await page.click('[data-new-collection]');await page.fill('[name="title"]','Evening watch');await page.locator('[type="checkbox"][value="'+episode+'"]').check();await page.locator('.mp-modal button[type="submit"]').click();await page.waitForSelector('.mp-modal',{state:'detached'});
 await page.waitForSelector('[data-open="'+episode+'"]');
 await page.click('[data-close-player]');await page.locator('[data-open="'+episode+'"]').first().click();await page.click('[data-detail-play]');
 await page.waitForFunction(()=>document.querySelector('video').currentTime>=8&&!document.querySelector('video').paused);
 assert(await page.locator('video').evaluate(v=>[...v.textTracks].every(track=>track.mode==='disabled')));
 await page.locator('video').evaluate(v=>v.pause());
 await page.setViewportSize({width:390,height:844});await page.click('[data-tab="home"]');await page.screenshot({path:path.join(os.tmpdir(),'mvmplayer-phone.png')});
 const layout=await page.evaluate(()=>({vw:innerWidth,width:document.documentElement.scrollWidth,rootWidth:document.querySelector('.mp').scrollWidth,client:document.querySelector('.mp').clientWidth}));assert(layout.width<=layout.vw,layout);assert(layout.rootWidth<=layout.client,layout);
 await page.click('[data-close-player]');
 // Import 20 valid files and one invalid file: continue after failure, preserve files.
 await page.click('[data-manage]');await page.click('[data-upload]');
 let proxyRejected=0,lostFinishes=0,firstSession='';
 await page.route('**/api/apps/mvmplayer/uploads/*?offset=*',async route=>{if(!proxyRejected++){await route.fulfill({status:413,body:'Proxy rejected chunk'});return}await route.continue()});
 await page.route('**/api/apps/mvmplayer/uploads/*/finish',async route=>{const session=route.request().url().split('/').at(-2);if(!firstSession)firstSession=session;if(session===firstSession&&lostFinishes<3){await route.fetch();lostFinishes++;await route.fulfill({status:502,body:'Lost finish response'});return}await route.continue()});
 const files=Array.from({length:20},(_,n)=>({name:`Movie.${String(n+1).padStart(2,'0')}.2024.webm`,mimeType:'video/webm',buffer:fixture}));files.splice(10,0,{name:'Movie.10x.2024.webm',mimeType:'video/webm',buffer:Buffer.from('bad container')});
 await page.setInputFiles('[data-files]',files);await page.click('[data-start-upload]');await page.waitForSelector('.mp-review>article',{timeout:30000});
 assert.equal(await page.locator('.mp-review>article').count(),21);assert.equal(await page.locator('.mp-review>article [data-open]').count(),20);
 assert.equal(await page.locator('.mp-review>article .mp-error').count(),1);
 assert.equal(lostFinishes,3);assert(proxyRejected>1);
 const imported=(await(await request.get(base+'/pub/mvmplayer/library',{headers:{'X-Pub-Token':'a'}})).json()).items;assert.equal(imported.length,24);
 await page.locator('.mp-review [data-lookup-id]').first().click();await page.click('[data-lookup-search]');await page.waitForSelector('[data-result]');await page.locator('[data-result]').first().click();await page.waitForSelector('[data-field="description"]');await page.click('[data-apply]');await page.waitForSelector('[name="title"]');
 // A second metadata selection must remain enabled with existing data.
 await page.click('[data-lookup]');await page.click('[data-lookup-search]');await page.waitForSelector('[data-result]');await page.locator('[data-result]').first().click();assert(await page.locator('[data-field="title"]').isEnabled());await page.click('[data-close]');
 // Auto-next follows season/episode order and saves completion.
 await page.click('[data-manage]');await page.click('[data-tab="home"]');
 await page.locator('[data-open="'+episode+'"]').first().click();await page.click('[data-detail-play]');await page.waitForFunction(()=>document.querySelector('video').readyState>=2&&!document.querySelector('video').paused);
 await page.check('[data-auto-next]');await page.locator('video').evaluate(v=>v.currentTime=v.duration-.15);
 await page.waitForFunction(id=>document.querySelector('video').src.includes('/stream/'+id)&&!document.querySelector('video').paused,next);
 await page.locator('video').evaluate(v=>v.pause());
 lib=await(await request.get(base+'/pub/mvmplayer/library',{headers:{'X-Pub-Token':'a'}})).json();assert(lib.items.find(i=>i.id===episode).state.completed);
 await page.reload();await page.waitForSelector('[data-manage]');assert.equal(await page.locator('.mp-stage').getAttribute('hidden'),'');
 // Public page offers neither management nor uploading.
 await page.goto(base+'/preview');await page.waitForSelector('.mp-card');assert.equal(await page.locator('[data-manage]').count(),0);assert.equal(await page.locator('[data-upload]').count(),0);
 await request.put(base+'/test-only/language?language=bg');await page.setViewportSize({width:320,height:740});
 await page.goto(base+'/preview');await page.waitForSelector('.mp[lang="bg"]');assert.equal(await page.locator('[data-help]').innerText(),'Помощ');
 assert.equal(await page.locator('[data-search]').getAttribute('placeholder'),'Търси в библиотеката');
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');await page.click('[data-manage]');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({browser:'Chromium',checks:'playback, paused details, resume, independent progress, edit, subtitles, catalogue seasons, collections, 20-file batch, invalid-file continuation, metadata replacement, auto-next, public permissions, phone layout',layout,errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
