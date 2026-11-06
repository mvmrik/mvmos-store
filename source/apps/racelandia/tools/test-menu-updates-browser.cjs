// Start test-ui-server.py, then run with PLAYWRIGHT_MODULE=/path/to/playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=process.env.UI_TEST_URL||'http://127.0.0.1:2187';
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox','--enable-unsafe-swiftshader']});
 try{
 for(const width of [1360,390]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];let documents=0;
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents++});
  await page.goto(base);await page.locator('#ap-team-name').waitFor();
  // Exercise the reconciler with focused drafts, open details and keyed reordering.
  await page.evaluate(async()=>{
   const {render,on}=window.RacelandiaUI;const host=document.createElement('div');document.body.append(host);
   const html=n=>`<input id="draft" value="server"><details><summary>Open</summary>Text</details><button data-id="a">${n}</button><button data-id="b">B</button>`;
   render(host,html(0));const input=host.querySelector('input'),details=host.querySelector('details'),button=host.querySelector('button');input.value='unsaved';input.focus();input.setSelectionRange(2,4);details.open=true;
   let calls=0;for(let i=0;i<5;i++){render(host,html(i));on(host.querySelector('button'),'click',()=>calls++)}button.click();
   if(host.querySelector('input')!==input||input.value!=='unsaved'||document.activeElement!==input||input.selectionStart!==2||!details.open||calls!==1)throw Error('DOM update lost draft/focus/open state or duplicated an action');
   render(host,`<button data-id="b">B updated</button><button data-id="a">A</button>`);
   if(host.lastChild!==button)throw Error('Keyed update replaced an existing button');host.remove();
  });
  const name=page.locator('#ap-team-name');await name.fill('Unsaved team draft');await name.evaluate(e=>window.savedName=e);
  const tab=async name=>{await page.locator(`[data-tab="${name}"]`).click();await page.locator('#ap-'+name).waitFor({state:'visible'});};
  await tab('warehouse');await page.locator('[data-wcart]').click();
  for(let i=1;i<=5;i++){
   const b=page.locator('[data-wqty="M"][data-d="1"]');if(i===1)await b.evaluate(e=>window.qtyButton=e);
   await b.click();assert.equal(await b.evaluate(e=>e===window.qtyButton),true,'Quantity action replaced its button');
   assert.equal(await page.locator('[data-wqty="M"][data-d="1"]').evaluate(e=>e.parentNode.querySelector('output').textContent),String(i));
  }
  const response=page.waitForResponse(r=>r.url().includes('/warehouse/buy-many'));
  await page.locator('[data-wbuynow]').click();assert.equal((await response).status(),200);await page.locator('.ap-cart').waitFor({state:'hidden'});
  await tab('team');assert.equal(await name.inputValue(),'Unsaved team draft');assert(await name.evaluate(e=>e===window.savedName),'Server refresh replaced the name input');
  await page.locator('[data-home-circuit]').click();const circuitName=page.locator('[data-tb-name]');await circuitName.fill('Draft test circuit');await circuitName.evaluate(e=>window.circuitNameNode=e);
  await tab('warehouse');await tab('team');assert.equal(await circuitName.inputValue(),'Draft test circuit');assert(await circuitName.evaluate(e=>e===window.circuitNameNode));
  await page.locator('[data-tb="cancel"]').click();
  await tab('lab');await page.locator('[data-rpart="engine"]').waitFor();
  const qty=page.locator('[data-qty]').first();if(await qty.count()){await qty.selectOption('3');assert.equal(await qty.inputValue(),'3');await qty.evaluate(e=>window.labQty=e);}
  await tab('driver');await page.locator('[data-staff-tab="crew"]').click();await page.locator('[data-crew-car]').first().waitFor();
  for(let i=0;i<4;i++)await page.locator('[data-crew-car]').nth(i%2).click();
  await page.locator('[data-staff-tab="specialists"]').click();await page.locator('.ap-crew-grid').waitFor();
  await tab('lab');if(await qty.count())assert.equal(await qty.inputValue(),'3');
  await tab('finance');const filter=page.locator('[data-fin-category]');await filter.waitFor();const category=await filter.locator('option').nth(1).getAttribute('value');await filter.selectOption(category);await page.waitForTimeout(150);
  await tab('stats');await page.locator('#ap-stats .ap-statspg').waitFor();await tab('finance');assert.equal(await filter.inputValue(),category);
  await tab('team');await page.locator('[data-open="baku"]').click();const fuel=page.locator('input[data-k="fuel"]');await fuel.waitFor();
  await fuel.evaluate(e=>window.fuelNode=e);
  const carIds=await page.locator('[data-mark-car]').evaluateAll(es=>es.map(e=>e.dataset.markCar));assert.equal(carIds.length,2);
  const setFuel=async value=>{await fuel.evaluate((e,value)=>{e.value=String(value);e.dispatchEvent(new Event('input',{bubbles:true}))},value)};
  const other=page.locator('.ap-teamcar-body[data-test-car]').first();const second=await other.getAttribute('data-test-car'),first=carIds.find(id=>id!==second);
  await setFuel(33);await other.click();await page.waitForFunction(id=>document.querySelector(`[data-mark-car="${id}"]`).closest('.ap-teamcar').classList.contains('open'),second);
  await setFuel(47);await page.locator(`.ap-teamcar-body[data-test-car="${first}"]`).click();
  await page.waitForFunction(()=>document.querySelector('input[data-k="fuel"]').value==='33');assert(await fuel.evaluate(e=>e===window.fuelNode));
  await page.locator(`.ap-teamcar-body[data-test-car="${second}"]`).click();await page.waitForFunction(()=>document.querySelector('input[data-k="fuel"]').value==='47');
  await tab('warehouse');await tab('garage');assert.equal(await fuel.inputValue(),'47');
  // Game Hub may remount on reconnect; the game restores its own live tree.
  await page.evaluate(()=>{const root=document.querySelector('#root');root.replaceChildren();window.game.renderGame(root,{reconnect:true})});
  assert.equal(await fuel.inputValue(),'47');assert(await fuel.evaluate(e=>e===window.fuelNode));
  await page.locator('#ap-back').click();await page.locator('[data-edit-livery]').click();const paint=page.locator('input[data-paint="body"]');await paint.waitFor();
  await paint.evaluate(e=>{e.value='#34aa66';e.dispatchEvent(new Event('input',{bubbles:true}));window.paintNode=e});
  await tab('warehouse');await tab('garage');assert.equal(await paint.inputValue(),'#34aa66');assert(await paint.evaluate(e=>e===window.paintNode));
  await page.locator('[data-paint-cancel]').click();
  assert.equal(documents,1,'Menu actions navigated/reloaded the document');assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/racelandia-ui-'+width+'.png'});
  console.log('PASS',width,'all menus, repeated cart actions/purchase, drafts, node identity, focus, details, crew, finance filter, independent car setups, reconnect, one document load');
  await page.close();
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
