const {chromium}=require(process.env.MVM_AUDIO_PLAYWRIGHT||'playwright-core');
const assert=require('assert');
let browser;
(async()=>{
 const base='http://127.0.0.1:2087';browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1000,height:800}});
 await context.addCookies([{name:'session',value:'admin',url:base}]);
 await context.addInitScript(()=>localStorage.setItem('apphub_token','a'));
 const r=await context.request.post(base+'/api/apps/mvmaudio/media',{data:{kind:'books',title:'Chunk upload test'}}),mid=(await r.json()).id;
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const size=17*1024*1024,wav=Buffer.alloc(size);
 wav.write('RIFF');wav.writeUInt32LE(size-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(size-44,40);
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');await page.click('[data-manage]');await page.click('[data-tab=books]');await page.click('[data-detail="'+mid+'"]');await page.click('[data-edit-upload]');
 const pattern='**/api/apps/mvmaudio/uploads/**';
 const reject=route=>route.request().method()==='PUT'?route.fulfill({status:413,contentType:'text/html',body:'Proxy rejected upload'}):route.continue();
 await page.route(pattern,reject);
 await page.setInputFiles('[type=file]',{name:'large-book.wav',mimeType:'audio/wav',buffer:wav});await page.click('[data-upload]');
 await page.waitForFunction(()=>document.querySelector('.ma-error')?.textContent.includes('rejected'));
 await page.waitForFunction(()=>document.querySelector('[data-upload-status]')?.textContent.includes('No files were confirmed'));
 assert.equal(await page.locator('progress').isVisible(),false);
 await page.unroute(pattern,reject);
 let duplicated=0,release;
 await page.route(pattern,async route=>{
   const req=route.request();
   if(req.method()==='PUT'){
     assert(req.postDataBuffer().length<=8*1024*1024);
     if(req.url().includes('offset=8388608')&&!duplicated){duplicated++;await route.fetch();return route.fulfill({status:503,body:'Lost response simulation'});}
   }
   if(req.url().endsWith('/finish')){await new Promise(ok=>{release=ok});}
   return route.continue();
 });
 await page.click('[data-upload]');
 await page.waitForFunction(()=>document.querySelector('[data-upload-status]')?.textContent.includes('Checking and saving'),{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('progress')&&!document.querySelector('progress').hasAttribute('value'));
 while(!release)await page.waitForTimeout(20);release();
 await page.waitForSelector('[data-add-chapters]',{timeout:20000});
 const admin=await (await context.request.get(base+'/api/apps/mvmaudio/admin')).json(),item=admin.items.find(i=>i.id===mid);
 assert.equal(item.tracks.length,1);assert.equal(item.bytes,size);assert.equal(duplicated,1);assert.deepEqual(errors,[]);
 await context.request.delete(base+'/api/apps/mvmaudio/media/'+mid);
 console.log('Browser upload: 413 message, no false success, 17 MiB in 8 MiB parts, lost-response retry, verifying stage, exactly one saved file.');
 await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exit(1)});
