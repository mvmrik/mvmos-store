// PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/racelandia/tools/test-weekend-classification-browser.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const url=n=>'data:text/javascript;base64,'+Buffer.from(read(n)).toString('base64');
const mp=read('mp.js'),paint=mp.slice(mp.indexOf('  function mateRows()'),mp.indexOf('  function lapStartOf('));
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
 for(const width of [390,640,1360])for(const kind of ['fp1','fp2','fp3','qualifying','race']){
  const page=await browser.newPage({viewport:{width,height:844}});await page.setContent('<style>body{margin:0;font:14px Arial}#host{height:844px}.ap-view{height:100%!important}</style><div id="host"></div>');await page.addStyleTag({content:read('style.css')});
  await page.evaluate(async cfg=>{
   const [D,R,S,T]=await Promise.all(cfg.modules.map(u=>import(u)));const host=document.querySelector('#host'),t=(k,v)=>k==='ap_classification'?'Classification':k==='ap_lapn'?`Lap ${v.n}/${v.m}`:k;
   let state;window.ownIds=['player','player2'];window.kind=cfg.kind;
   if(cfg.kind==='race'){
    const track=S.buildTrack(S.TRACKS.test),entry=(i)=>({id:i<2?['player','player2'][i]:'ai-'+i,name:i<2?['Driver Alpha','Driver Bravo'][i]:'Rival '+i,col:0,grid:i,target:1,care:.5,reaction:.2,compound:i?'H':'S',fuel:60,mine:i<2,pit_lap:12});
    const profile={length:track.length,speeds:Array(100).fill(45),sectors:[.34,.68],half:6,pit:{}};
    const payload={session:'fixture',laps:20,hour:12,forecast:S.dryDay(),wx_half:null,race_config:{entries:Array.from({length:20},(_,i)=>entry(i)),incidents:[],profile,laps:20,lights:6},entries:{player:{name:'Driver Alpha',tyre_set:{id:'a',compound:'S'},tyres:[]},player2:{name:'Driver Bravo',tyre_set:{id:'b',compound:'H'},tyres:[]}}};
    let view;const M={SIM:S,RACE:R,VIEW:{createView(){return view={S:{},setConditions(){},setCamera(){},setField(){},setSafetyCar(){},setCompound(c){this.compound=c},setLivery(){},lights(){},destroy(){}}}}};
    state=D.playRace({host,M,track,payload,t,money:String,time:String,RaceModel:R.Race,sound:{enabled:false},onFinish(){},onGarage(){}});state.pause();
    state.race.cars.forEach((c,i)=>{c.p=(20-i)*100;c.v=30;});state.race.by_id.player.p=300;state.race.by_id.player2.p=1100;
    view.onTick(.2);window.draw=()=>view.onTick(.2);window.controller=state;
   }else{
    host.innerHTML='<div class="ap-view"><div class="ap-hud"><div class="ap-tower"><div class="ap-tower-head"><b>Classification</b><span>Best</span></div><div id="h-own-position" hidden></div><div id="h-order"></div></div><div class="ap-hud-l">Tyres and speed</div><div class="ap-hud-t"><div id="h-lap" data-n="2">Lap 2</div><div id="h-session-clock">10:00</div></div></div><div class="ap-ctl"><div class="ap-watch"><button data-car="0" data-team-car="player" class="on">Driver Alpha</button><button data-car="1" data-team-car="player2">Driver Bravo</button></div><button>Box</button></div></div>';
    const make=(key,name,best)=>({key,name,msg:{compound:'M'},run:{frames:[0,1],FRAME:1,pits:[],done:false,laps:[{n:1,t0:10,time:best,valid:true}]}});
    const cars=[make('player','Driver Alpha',110),make('player2','Driver Bravo',105)];let carIdx=0,run=cars[0].run;
    const field=Array.from({length:18},(_,i)=>({id:'ai-'+i,name:'Rival '+i,laps:[{valid:true,start:0,at:80+i,time:80+i,sectors:[25,25,30+i]}]}));
    const pb={t:130,lightsOut:0,msg:{timing_field:field}},mods={TIMING:T,DIVISION:D},$=s=>host.querySelector(s),G={driver:{name:'Driver Alpha'}},simMod=S,secStr=String,lapStr=x=>x==null?'—':x.toFixed(3),esc=String,personName=p=>p?.name||'',_t=t;
    eval(cfg.paint+';window.draw=()=>{paintOrder(run.laps[0].time,{marks:[],cells:[]},{lap:2,pit:0});D.fitHud(host.querySelector(".ap-view"),t)};');
    host.querySelectorAll('[data-car]').forEach(b=>b.onclick=()=>{carIdx=+b.dataset.car;run=cars[carIdx].run;host.querySelectorAll('[data-car]').forEach(x=>x.classList.toggle('on',x===b));const order=$('#h-order');order._timingTick=-1;window.draw();});window.draw();
   }
  },{kind,paint,modules:['division.js','race.js','sim.js','timing.js'].map(url)});
  const mobile=width<=640,team=page.locator('.ap-phone-switch');
  if(mobile){
   assert.equal(await team.count(),1);assert(await team.isVisible());assert(!(await page.locator('.ap-tower').isVisible()));
   assert.equal(await page.locator('.ap-ph-team').count(),0);
   assert.equal(await page.locator('.ap-ph-runners button').count(),kind==='race'?19:1);
   assert((await page.locator('.ap-ph-pos').innerText()).length<12,'compact chip grew into a heading');
   assert(await page.locator('.ap-ph-runners').evaluate(el=>el.getBoundingClientRect().height<=180));
   assert((await page.locator('.ap-ph-laps').innerText()).includes(kind==='race'?'Lap':'2'),'lap counter missing');
   await team.click();await page.evaluate(()=>window.draw());assert.equal(await team.innerText(),'⇄');assert((await team.getAttribute('aria-label')).includes('Driver Alpha'));
   await page.locator('.ap-ph-pos').click();await page.evaluate(()=>window.draw());
  }
  const rows=page.locator(kind==='race'?'[data-race-order]':'#h-order');assert.equal(await rows.locator(':scope > .ap-order-row:not(.ap-order-pin)').count(),20);assert(await page.locator('.ap-tower').isVisible());
  if(mobile&&kind==='race'){await page.locator('[data-race-gapmode]').click();assert(await page.locator('.ap-tower').isVisible(),'gap toggle closed classification');await page.evaluate(()=>window.draw());}
  await rows.evaluate(el=>{el.scrollTop=el.scrollHeight});
  assert(await rows.evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollTop>0),'full field cannot scroll');
  await rows.locator(':scope > .ap-order-row:not(.ap-order-pin)').last().scrollIntoViewIfNeeded();assert(await page.locator('.ap-tower').isVisible());
  if(process.env.WEEKEND_SCREENSHOTS)await page.screenshot({path:path.join(process.env.WEEKEND_SCREENSHOTS,kind+'-'+width+'.png')});
  if(mobile){await page.locator('.ap-tower-head b').click();assert(!(await page.locator('.ap-tower').isVisible()));assert(await team.nth(0).isVisible());if(process.env.WEEKEND_SCREENSHOTS)await page.screenshot({path:path.join(process.env.WEEKEND_SCREENSHOTS,kind+'-compact-'+width+'.png')});}
  console.log('PASS',kind,width,'20 cars, team positions/switching, lap counter, classification access/scroll and gap mode');await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
