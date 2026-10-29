const {chromium}=require(process.env.MVM_AUDIO_PLAYWRIGHT||'playwright-core');
const assert=require('assert'),fs=require('fs'),path=require('path');
let browser;
(async()=>{
 const base='http://127.0.0.1:2087';browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1150,height:850}});await ctx.addCookies([{name:'session',value:'admin',url:base}]);await ctx.addInitScript(()=>localStorage.setItem('apphub_token','a'));
 await ctx.request.put(base+'/test-only/catalogue');
 const create=await ctx.request.post(base+'/api/apps/mvmaudio/media',{data:{kind:'music',title:'Manual title'}}),mid=(await create.json()).id;
 const mp3=fs.readFileSync(path.join(__dirname,'fixtures/tone.mp3'));
 await ctx.request.post(base+'/api/apps/mvmaudio/media/'+mid+'/tracks?filename=tone.mp3',{data:mp3});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 await ctx.route('https://coverartarchive.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:png}));
 await ctx.route('https://covers.openlibrary.org/**',r=>r.fulfill({status:200,contentType:'image/png',body:png}));
 const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');await page.click('[data-manage]');await page.locator('.ma-card [data-detail="'+mid+'"]').first().click();await page.click('[data-edit-metadata]');
 await page.locator('[data-meta-form] button[type=submit]').click();await page.waitForSelector('[data-candidate]');await page.click('[data-candidate="0"]');
 assert.equal(await page.locator('[data-meta-field=title]').isDisabled(),false);
 await page.locator('[data-overwrite]').check();await page.locator('[data-meta-field=creator]').uncheck();await page.click('[data-meta-apply]');await page.waitForSelector('[data-metadata]');
 let admin=await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json(),item=admin.items.find(i=>i.id===mid);
 assert.equal(item.title,'Catalogue Song');assert.equal(item.creator,'Test Artist');assert.equal(item.year,'2022');assert(item.has_cover);
 await page.waitForSelector('.ma-detail-cover .ma-cover.has-art');
 await page.click('[data-metadata]');await page.setInputFiles('[data-cover-file]',{name:'manual.png',mimeType:'image/png',buffer:png});await page.click('[data-cover-upload]');await page.waitForSelector('[data-metadata]');
 await page.click('[data-metadata]');await page.click('[data-cover-remove]');await page.waitForSelector('[data-metadata]');
 admin=await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json();assert.equal(admin.items.find(i=>i.id===mid).has_cover,false);
 await page.setViewportSize({width:390,height:844});await page.click('[data-metadata]');await page.locator('[data-overwrite]').check();await page.click('[data-read-tags]');await page.waitForSelector('[data-metadata]');
 admin=await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json();assert.equal(admin.items.find(i=>i.id===mid).title,'Fixture Tone');
 await page.click('[data-metadata]');await page.locator('[data-meta-form] button[type=submit]').click();await page.waitForSelector('[data-candidate]');await page.click('[data-candidate="0"]');
 const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,vw:innerWidth,dialog:document.querySelector('.ma-dialog').getBoundingClientRect().width}));assert(overflow.width<=overflow.vw);assert(overflow.dialog<=390);
 await page.screenshot({path:path.join(require('os').tmpdir(),'mvmaudio-metadata-phone.png')});
 assert.deepEqual(errors,[]);await ctx.request.delete(base+'/api/apps/mvmaudio/media/'+mid);
 // Add language blocks only on demand; lookup selects the desired saved names.
 await page.click('[data-close]');await page.click('[data-tab="books"]');await page.click('[data-add]');await page.click('[data-manual-entry]');
 assert.equal(await page.locator('[data-variant]').count(),1);
 await page.locator('[data-variant]').first().locator('[data-variant-lang]').selectOption('bg');
 await page.fill('[name=title]','Възпламеняване');await page.fill('[name=creator]','Сюзан Колинс');
 await page.selectOption('[data-new-lang]','en');await page.click('[data-add-language]');
 const english=page.locator('[data-variant]').nth(1);await english.locator('[name=title]').fill('Catching Fire');await english.locator('[name=creator]').fill('Suzanne Collins');
 await page.selectOption('[data-new-lang]','de');await page.click('[data-add-language]');
 const german=page.locator('[data-variant]').nth(2);await german.locator('[name=title]').fill('Gefährliche Liebe');await german.locator('[name=creator]').fill('Suzanne Collins');
 await page.screenshot({path:path.join(require('os').tmpdir(),'mvmaudio-language-editor-phone.png')});
 await page.click('button[type=submit]');await page.waitForSelector('[data-upload]');await page.click('[data-close]');
 const books=(await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json()).items;
 const book=books.find(i=>i.translations.en?.title==='Catching Fire');assert(book);assert.equal(book.translations.bg.title,'Възпламеняване');
 await page.locator('.ma-card [data-detail="'+book.id+'"]').first().click();await page.click('[data-edit-metadata]');
 await page.selectOption('[data-lookup-lang]','en');assert.equal(await page.inputValue('[data-meta-form] [name=title]'),'Catching Fire');
 const search=page.waitForRequest(r=>r.url().endsWith('/metadata/search')&&r.method()==='POST');await page.locator('[data-meta-form] button[type=submit]').click();
 const body=(await search).postDataJSON();assert.equal(body.title,'Catching Fire');assert.equal(body.creator,'Suzanne Collins');await page.waitForSelector('[data-candidate]');
 await page.click('[data-candidate="0"]');assert.equal(await page.locator('[data-meta-field=title]').isDisabled(),false);
 await page.locator('[data-meta-field=title]').check();await page.click('[data-meta-apply]');await page.waitForSelector('[data-metadata]');
 const updated=(await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json()).items.find(i=>i.id===book.id);
 assert.equal(updated.translations.en.title,'Catalogue Book');assert.equal(updated.translations.bg.title,'Възпламеняване');assert.equal(updated.translations.de.title,'Gefährliche Liebe');
 await page.click('[data-close]');
 // Account language wins on public pages. Missing languages fall back to English,
 // then to the first available language when English is absent.
 for(const [language,expected] of [['bg','Възпламеняване'],['de','Gefährliche Liebe'],['ja','Catalogue Book']]){
   await page.route('**/pub/mvmaudio/library',async route=>{const response=await route.fetch();const data=await response.json();data.user_language=language;await route.fulfill({response,json:data});});
   await page.goto(base+'/preview');await page.waitForSelector('.ma-card');await page.click('[data-tab="books"]');
   assert.equal(await page.locator('.ma-card .ma-titlebtn[data-detail="'+book.id+'"]').textContent(),expected);
   await page.unroute('**/pub/mvmaudio/library');
 }
 await ctx.request.put(base+'/api/apps/mvmaudio/media/'+book.id,{data:{kind:'books',title:'Възпламеняване',translations:{bg:{title:'Възпламеняване',creator:'Сюзан Колинс'}}}});
 await page.goto(base+'/preview');await page.waitForSelector('.ma-card');await page.click('[data-tab="books"]');assert.equal(await page.locator('.ma-card .ma-titlebtn[data-detail="'+book.id+'"]').textContent(),'Възпламеняване');
 await ctx.request.delete(base+'/api/apps/mvmaudio/media/'+book.id);
 // Preserve both old names when a legacy bilingual record is opened in management.
 const legacy=(await (await ctx.request.post(base+'/api/apps/mvmaudio/media',{data:{kind:'books',title:'Старо заглавие',creator:'Стар автор',original_title:'Legacy English Title',original_creator:'Legacy English Author'}})).json()).id;
 await page.addInitScript(()=>{window.mvmOS={lang:'bg'}});await page.goto(base+'/preview?desktop=true');await page.waitForSelector('[data-manage]');await page.click('[data-manage]');await page.click('[data-tab="books"]');
 await page.click('[data-add]');await page.click('[data-manual-entry]');assert.equal(await page.locator('[data-variant-lang]').inputValue(),'bg');assert.equal(await page.locator('[data-variant]').count(),1);await page.click('[data-cancel]');
 await page.locator('.ma-card [data-detail="'+legacy+'"]').first().click();assert.equal(await page.locator('[data-variant]').count(),2);await page.click('[data-edit-metadata]');await page.waitForSelector('[data-lookup-lang]');
 const converted=(await (await ctx.request.get(base+'/api/apps/mvmaudio/admin')).json()).items.find(i=>i.id===legacy);
 assert.equal(converted.translations.bg.title,'Старо заглавие');assert.equal(converted.translations.en.title,'Legacy English Title');
 await ctx.request.delete(base+'/api/apps/mvmaudio/media/'+legacy);
 console.log('Metadata UI: search, preview, field selection, overwrite protection, cover display/upload/remove, tag rescan, phone layout; no page errors.');await browser.close();
})().catch(async e=>{console.error(e);await browser?.close();process.exit(1)});
