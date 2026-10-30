const {chromium}=require(process.env.MVM_AUDIO_PLAYWRIGHT || 'playwright-core');
const assert=require('assert');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:900}});
await context.addCookies([{name:'session',value:'admin',url:'http://127.0.0.1:2087'}]);
await context.addInitScript(()=>localStorage.setItem('apphub_token','a'));
const request=context.request,base='http://127.0.0.1:2087';
async function admin(path,body){const r=await request.post(base+'/api/apps/mvmaudio'+path,{data:body});assert(r.ok(),await r.text());return r.json()}
const wav=Buffer.alloc(44+8000*2*15);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<8000*15;i++)wav.writeInt16LE(Math.sin(i*2*Math.PI*220/8000)*1800,44+i*2);
let book,tid;
for(const [kind,title,creator,category,album]of [
 ['books','The Quiet Atlas','Clara Bennett','Fiction','Journeys, Vol. 1'],['books','A Brief History of Tomorrow','Daniel Brooks','Science',''],
 ['music','Coastal Lines','North & Willow','Indie','Saltwater'],['music','Blue Hour Sessions','Maya Stone','Jazz','After Hours'],['music','A Place to Begin','The Paper Kites','Acoustic','Morning'],['music','Night Drive','Parallel City','Electronic','Motion'],['music','Sunday Morning','Alba Flores','Soul','Golden'],['music','Wildflower','Juniper Lane','Indie','Fields'],
 ['radio','The Jazz Room','Live radio','Jazz','']]){
 const item=await admin('/media',{kind,title,creator,category,album,url:kind==='radio'?'https://example.com/stream':''});
 if(kind!=='radio'){const track=await admin('/media/'+item.id+'/tracks?filename=01%20-%20Opening.wav',wav);if(kind==='books'&&!book){book=item.id;tid=track.id;await admin('/media/'+item.id+'/tracks?filename=02%20-%20The%20Journey.wav',wav)}}
}
await request.put(base+'/pub/mvmaudio/media/'+book+'/state',{headers:{'X-Pub-Token':'a'},data:{track_id:tid,seconds:5,speed:1.5,played:true}});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-detail]');
await page.screenshot({path:require('path').join(require('os').tmpdir(),'mvmaudio-desktop.png')});
await page.click('[data-tab="books"]');await page.locator('.ma-card [data-detail="'+book+'"]').first().click();
assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
assert.equal(await page.locator('[data-detail-play]').count(),1);
await page.click('[data-detail-play]');
await page.waitForFunction(()=>!document.querySelector('audio').paused);
await page.waitForTimeout(1300);
let current=await page.evaluate(()=>({time:document.querySelector('audio').currentTime,speed:document.querySelector('audio').playbackRate,src:document.querySelector('audio').src}));
assert(current.time>=5,current);assert.equal(current.speed,1.5);assert(!current.src.includes('apphub'));
await page.click('[data-manage]');await page.click('[data-tab="books"]');
await page.locator('.ma-card [data-detail="'+book+'"]').first().click();
await page.fill('[name=title]','The Quiet Atlas Revised');await page.click('button[type=submit]');await page.waitForSelector('.ma-modal',{state:'detached'});
const renamed=await (await request.get(base+'/pub/mvmaudio/library',{headers:{'X-Pub-Token':'a'}})).json();
assert(renamed.items.find(i=>i.id===book).state.seconds>=5);assert.equal(renamed.items.find(i=>i.id===book).title,'The Quiet Atlas Revised');
assert.equal(await page.locator('.ma-playbadge').count(),0);
await page.click('[data-manage]');
await page.click('[data-tab="music"]');assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
await page.click('[data-toggle]');
await page.reload();await page.waitForSelector('[data-manage]');await page.click('[data-tab="books"]');await page.locator('.ma-card [data-detail="'+book+'"]').first().click();
await page.click('[data-detail-play]');await page.waitForFunction(()=>document.querySelector('audio').currentTime>=5);await page.click('[data-toggle]');assert.equal(await page.locator('audio').evaluate(a=>a.paused),true);
await page.click('[data-settings]');await page.waitForSelector('[name=upload_limit_mb]');await page.fill('[name=upload_limit_mb]','2');await page.click('[data-policy-save]');await page.waitForSelector('.ma-modal',{state:'detached'});
await page.click('[data-tab="books"]');await page.locator('.ma-card [data-detail="'+book+'"]').first().click();await page.click('[data-complete]');await page.waitForTimeout(300);await page.click('[data-close]');
await page.click('[data-tab="playlists"]');await page.click('[data-new-playlist]');await page.fill('[name=title]','Evening stories');await page.locator('.ma-checklist [type=checkbox]').first().check();await page.click('button[type=submit]');await page.waitForSelector('[data-list-play]');await page.click('[data-list-share]');await page.fill('[data-user-search]','listener_b');await page.waitForSelector('[data-member=b]');await page.click('[data-member=b]');await page.waitForSelector('[data-remove-member=b]');await page.click('[data-close]');
await page.setViewportSize({width:390,height:844});await page.click('[data-tab="books"]');await page.screenshot({path:require('path').join(require('os').tmpdir(),'mvmaudio-phone.png')});
const layout=await page.evaluate(()=>{const p=document.querySelector('.ma-player').getBoundingClientRect();return{width:document.documentElement.scrollWidth,vw:innerWidth,bottom:p.bottom,vh:innerHeight}});assert(layout.width<=layout.vw,JSON.stringify(layout));assert(layout.bottom<=layout.vh+1,JSON.stringify(layout));
await page.click('[data-now]');await page.waitForSelector('[data-now-speed]');await page.selectOption('[data-now-speed]','2');await page.click('[data-now-sleep]');await page.click('[data-minutes="15"]');
await page.click('[data-now]');await page.click('[data-bookmark]');await page.fill('[name=title]','A memorable passage');await page.click('button[type=submit]');await page.waitForSelector('.ma-modal',{state:'detached'});
await page.locator('.ma-card [data-detail="'+book+'"]').first().click();await page.waitForSelector('[data-mark]');await page.click('[data-close]');
// Premium personal upload, including separate music items.
await page.click('[data-tab="music"]');await page.click('[data-add]');await page.click('[data-manual-entry]');await page.fill('[name=title]','My recording');await page.click('button[type=submit]');await page.waitForSelector('[data-upload]');await page.setInputFiles('[type=file]',[{name:'one.wav',mimeType:'audio/wav',buffer:wav},{name:'two.wav',mimeType:'audio/wav',buffer:wav}]);await page.click('[data-upload]');await page.waitForSelector('[data-add-chapters]',{timeout:20000});await page.click('[data-close]');
const lib=await (await request.get(base+'/pub/mvmaudio/library',{headers:{'X-Pub-Token':'a'}})).json();assert.equal(lib.items.filter(i=>i.mine).length,2);assert(lib.items.find(i=>i.title==='two').tracks.length===1);
// Public view must hide uploads and any Premium promotion when unavailable.
await request.put(base+'/test-only/premium?value=false');
await page.goto(base+'/preview');await page.waitForSelector('[data-detail]');
assert.equal(await page.locator('[data-add]').count(),0);
await page.click('[data-settings]');assert.equal(await page.locator('[data-premium-policy]').count(),0);
assert.equal(await page.getByText('Premium',{exact:false}).count(),0);await page.click('[data-close]');
// The desktop still displays the control and applies the platform gate.
await page.addInitScript(()=>{window.mvmOS={lang:'en',premiumGate(el){el.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();window.premiumOpened=true;},true);}}});
await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-detail]');await page.click('[data-settings]');await page.click('[name=upload_limit_mb]');assert.equal(await page.evaluate(()=>window.premiumOpened),true);
assert.deepEqual(errors,[]);
console.log(JSON.stringify({browser:'Chromium',desktop:'1280x900',phone:'390x844',checks:'playback, resume, speed, navigation, quota settings, completed book, playlist, sharing, bookmark, upload, separate songs, overflow',layout,errors}));
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
