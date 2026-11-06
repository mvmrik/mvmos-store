// PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/racelandia/tools/test-phone-cars-browser.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
 for(const race of [false,true])for(const width of [360,390,640]){
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.setContent('<style>body{margin:0;font:14px Arial}.ap-view{height:844px !important}</style><div class="ap-view"><div class="ap-hud"><div class="ap-tower"><div class="ap-tower-head">Classification</div><div id="h-order"><div class="ap-order-row mine watched" data-team-car="player" data-car="player"><b>2</b><span>Driver Alpha</span><strong>1:32.000<small>+1.000</small></strong></div><div class="ap-order-row '+(race?'mine':'teammate')+'" data-team-car="player2" data-car="player2"><b>1</b><span>Driver Bravo</span><strong>1:31.000</strong></div></div></div><div class="ap-hud-l">Speed and tyres</div><div class="ap-hud-t"><div id="h-lap" data-n="1" data-m="3">Lap 1</div><div id="h-session-clock"></div></div></div><div class="ap-ctl"><div class="ap-cams"><button>Chase</button></div><div class="ap-watch"><button class="on" data-team-car="player" data-race-watch="player">Driver Alpha</button><button data-team-car="player2" data-race-watch="player2">Driver Bravo</button></div><button id="box">Box</button><button id="h-through">Drive through pit lane</button><div class="ap-speeds"><button>×1</button></div></div></div>');
  await page.addStyleTag({content:read('style.css')});
  await page.evaluate(async url=>{
   const D=await import(url),view=document.querySelector('.ap-view');window.fit=()=>D.fitHud(view,k=>k);window.calls=[];
   view.querySelector('.ap-hud').insertAdjacentHTML('beforeend','<div class="ap-radio peek"><button class="ap-radio-head">Driver radio ▾</button><div class="ap-radio-list"><div class="ap-radio-msg"><span>Some tyres are still below their working temperature.</span></div></div></div>');
   view.querySelectorAll('.ap-watch button').forEach(source=>source.onclick=()=>{
    window.calls.push(source.dataset.teamCar);view.querySelectorAll('.ap-watch button').forEach(b=>b.classList.toggle('on',b===source));
    view.querySelectorAll('.ap-order-row').forEach(r=>r.classList.toggle('watched',r.dataset.teamCar===source.dataset.teamCar));window.fit();
   });window.fit();
  },'data:text/javascript;base64,'+Buffer.from(read('division.js')).toString('base64'));
  const button=page.locator('.ap-phone-switch');assert.equal(await button.count(),1);assert(await button.isVisible());
  assert.equal(await page.locator('.ap-ph-team').count(),0);assert(!(await page.locator('.ap-tower').isVisible()));
  assert.equal(await button.innerText(),'⇄');assert((await button.getAttribute('aria-label')).includes('Driver Bravo'));
  for(const mode of ['shut','peek','open']){
   await page.evaluate(mode=>{const radio=document.querySelector('.ap-radio');radio.className='ap-radio '+mode;window.fit();},mode);
   assert(await page.evaluate(()=>{const r=document.querySelector('.ap-radio').getBoundingClientRect(),b=document.querySelector('.ap-phone-switch').getBoundingClientRect();return b.top>=r.bottom+5&&b.right<=innerWidth&&b.height>0;}),'car switch must remain below radio');
  }

  await button.click();assert.deepEqual(await page.evaluate(()=>window.calls),['player2']);
  assert.equal(await button.innerText(),'⇄');assert((await button.getAttribute('aria-label')).includes('Driver Alpha'));
  await button.click();assert.deepEqual(await page.evaluate(()=>window.calls),['player2','player']);
  await page.locator('.ap-ph-pos').click();assert(await page.locator('.ap-tower').isVisible());assert.equal(await page.locator('.ap-tower .ap-order-row').count(),2);
  await page.locator('.ap-tower-head').click();assert(!(await page.locator('.ap-tower').isVisible()));assert(await button.isVisible());
  if(process.env.PHONE_CAR_SCREENSHOTS)await page.screenshot({path:path.join(process.env.PHONE_CAR_SCREENSHOTS,'phone-cars-'+width+'-'+race+'.png')});
  await page.setViewportSize({width:1360,height:844});await page.evaluate(()=>window.fit());assert.equal(await page.locator('.ap-ph').count(),0);assert.equal(await page.locator('.ap-ctl > .ap-watch button').count(),2);
  console.log('PASS',race?'race':'practice',width,'compact classification, separate car switch and desktop restoration');await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
