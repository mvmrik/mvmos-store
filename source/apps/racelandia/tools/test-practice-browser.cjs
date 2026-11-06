// Run against test-ui-server.py, which uses a temporary database.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];let documents=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++});
  await page.goto(process.env.UI_TEST_URL||'http://127.0.0.1:2187');await page.locator('[data-open="baku"]').waitFor();await page.locator('[data-open="baku"]').click();
  await page.locator('#ap-send').waitFor();
  await page.locator('#ap-laps').evaluate(e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))});
  for(const c of await page.locator('[data-mark-car]').all())if(!await c.isChecked())await c.check();
  await page.locator('#ap-send').click();await page.locator('#h-speed').waitFor({timeout:60000});await page.locator('#ap-3d canvas').waitFor();
  await page.locator('[data-sp="8"]').click();await page.waitForFunction(()=>parseInt(document.querySelector('#h-speed').textContent)>50,{},{timeout:60000});
  for(const i of [1,0,1,0]){await page.locator(`[data-car="${i}"]`).click();assert(await page.locator(`[data-car="${i}"]`).evaluate(e=>e.classList.contains('on')));}
  await page.screenshot({path:'/tmp/racelandia-practice-3d.png'});
  await page.locator('[data-sp="skip"]').click();await page.locator('.ap-sum').waitFor({timeout:120000});
  const summary=await page.evaluate(()=>window.messages.filter(m=>m.type==='ap_summary').at(-1));
  assert.ok(summary&&!summary.cheat);assert.ok(summary.other?.laps?.length>=2);assert.ok(summary.laps.length>=2);
  await page.locator('#ap-s-garage').click();await page.locator('input[data-k="fuel"]').waitFor();
  assert.equal(documents,1);assert.deepEqual(errors,[]);
  console.log('PASS: real 3D practice, both cars, live HUD switching, speed controls, skip, validated two-car results and return to setup without document reload');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
