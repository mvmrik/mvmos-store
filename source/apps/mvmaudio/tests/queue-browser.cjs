const {chromium}=require(process.env.MVM_AUDIO_PLAYWRIGHT || 'playwright-core');
const assert=require('assert');
// Needs the test server: python tests/test_api.py serve (after browser.cjs has created the sample library).
(async()=>{
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.addCookies([{name:'session',value:'admin',url:'http://127.0.0.1:2087'}]);
await context.addInitScript(()=>localStorage.setItem('apphub_token','a'));
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:2087/preview?desktop=true');await page.waitForSelector('[data-detail]');
assert.equal(await page.locator('.ma-player:visible').count(),0,'player hidden while nothing is loaded');
await page.click('[data-tab="music"]');
assert(await page.locator('[data-quick]').count()>=3);
const first=page.locator('[data-quick]').first();await first.click();
await page.waitForFunction(()=>!document.querySelector('audio').paused);
assert.equal(await page.locator('.ma-player:visible').count(),1);
assert((await first.innerHTML()).includes('M7 5h4'));
await page.locator('.ma-playing strong').click();
await page.waitForSelector('[data-now-queue]');
assert(await page.locator('.ma-modal h3').first().textContent());
await page.click('[data-now-shuffle]');
assert((await page.locator('[data-now-shuffle]').textContent()).includes('On'));
const names=async()=>page.evaluate(()=>[...document.querySelectorAll('.ma-modal .ma-qrow strong')].map(x=>x.textContent));
await page.click('[data-now-queue]');await page.waitForSelector('[data-queue-live]',{state:'attached'});
let order=await names();assert(order.length>=3);
const title=await page.evaluate(()=>document.querySelector('.ma-playing strong').textContent);assert.equal(order[0],title,'current item first when shuffled');
// move the last up-next song down/up and remove it
await page.locator('[data-q-up]:not([disabled])').last().click();
await page.waitForSelector('[data-queue-live]',{state:'attached'});
let after=await names();assert.notDeepEqual(after,order);
await page.locator('[data-q-remove]').last().click();await page.waitForSelector('[data-queue-live]',{state:'attached'});
assert.equal((await names()).length,order.length-1);
await page.click('[data-q-shuffle]');await page.waitForSelector('[data-queue-live]',{state:'attached'});
assert((await page.locator('[data-q-shuffle]').textContent()).includes('Off'));
await page.click('[data-close]');
// next goes to the first up-next song
const expected=(await names().catch(()=>[]));
await page.locator('.ma-playing strong').click();await page.waitForSelector('[data-now-next]');
const upFirst=await page.locator('.ma-modal .ma-list strong').first().textContent();
await page.click('[data-now-next]');
await page.waitForFunction(t=>document.querySelector('.ma-detail-top h2')?.textContent===t,upFirst);
await page.click('[data-now-stop]');
await page.waitForFunction(()=>document.querySelector('.ma-player').hidden);
// play next / add to queue from the detail dialog
await page.locator('[data-quick]').first().click();await page.waitForFunction(()=>!document.querySelector('audio').paused);
await page.locator('.ma-card [data-detail]').nth(2).click();await page.waitForSelector('[data-queue-next]');
const picked=await page.locator('.ma-dialog-head h2').textContent();
await page.click('[data-queue-next]');await page.click('[data-close]');
await page.locator('.ma-playing strong').click();await page.click('[data-now-queue]');await page.waitForSelector('[data-queue-live]',{state:'attached'});
const rows=await names();assert.equal(rows[1],picked);
assert.deepEqual(errors,[]);
console.log('queue ok');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
