// PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/racelandia/tools/test-car-hud-browser.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const src=process.env.HUD_SOURCE?fs.readFileSync(process.env.HUD_SOURCE,'utf8'):read('mp.js');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
const functions=cut('  function compoundAt(', '  // ── playback')+cut('  function ownSectors()', '  // ── the pit box:')+cut('  function paintBox()', '  // minimap');
const view=read('view3d.js');
const sampler=view.slice(view.indexOf('  let frames = null'),view.indexOf('  const carPos ='));
const moduleUrl=n=>'data:text/javascript;base64,'+Buffer.from(read(n)).toString('base64');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
 for(const width of [390,1360]){
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.setContent('<div id="ap-track"><div class="ap-view ap-tw-open"><div class="ap-hud"><div class="ap-tower"><div class="ap-tower-head">Classification</div><div id="h-order"></div></div><div class="ap-hud-l"><div id="h-speed"></div><div id="h-gear"></div><div id="meters"></div><div id="h-tyres"></div></div><div class="ap-hud-t"><div id="h-lap"></div><div id="h-session-clock"></div><div id="h-time"></div><div id="hs0"><b></b><em></em></div><div id="hs1"><b></b><em></em></div><div id="hs2"><b></b><em></em></div><div id="h-last"></div></div><div id="h-fuel"></div><div id="h-ers"></div><div id="h-wx"></div><div id="h-banner"></div></div><div class="ap-ctl"><button id="h-box"></button><button id="h-through"></button><button data-car="0">Driver A</button><button data-car="1">Driver B</button></div></div></div>');
  await page.addStyleTag({content:read('style.css')});
  const result=await page.evaluate(async cfg=>{
   const [D,T,A,SIM]=await Promise.all(cfg.modules.map(u=>import(u)));
   document.querySelector('#meters').innerHTML=D.drivingMetersHtml(k=>k);
   const $=s=>document.querySelector(s),root=document,esc=String,_t=(k,v)=>k+(v?' '+JSON.stringify(v):''),lapStr=x=>x==null?'—':x.toFixed(3),secStr=lapStr;
   const FX={tyreErr:()=>0},lvl=()=>1,lapsSpan=(n)=>String(Math.floor(n)),wxNowHtml=()=>'',FUEL_KG_PER_L=.75,CLIFF=.72;
   const board=[{pid:'room',best:60}],multi=false,peers={},G={driver:{name:'A'}},simMod=SIM;
   const mods={SIM,TIMING:T,ANALYSIS:A,DIVISION:{...D,focusClassification(){},fitHud(){}}};
   let audioSample,mapSample,radioClears=0;
   const sndUpdate=s=>audioSample={...s},drawMap=s=>mapSample={...s},radioClear=()=>radioClears++;
   const make=(i)=>{
    const compound=i?'H':'S',other=i?'W':'M',frame=new Array(36).fill(0);
    Object.assign(frame,{4:10+i*10,8:.2+i*.5,9:.1+i*.2,10:3+i,11:8000+i*1000,17:15+i*15,18:.25+i*.5,21:2,31:0});
    for(let k=0;k<4;k++){frame[12+k]=90+i*10+k;frame[32+k]=.1+i*.2+k*.01;}
    const wear=new Array(4).fill(.1),m={};
    const laps=[{n:1,t0:10,time:90+i*10,valid:true,compound,wear,m},{n:2,t0:100+i*10,time:90,valid:true,compound:other,wear:new Array(4).fill(.7),m}];
    const frames=Array.from({length:130*30+2},()=>frame).flat();
    return {key:i?'player2':'player',name:i?'Driver B':'Driver A',msg:{compound,kind:'practice',hour:12,forecast:SIM.dryDay(),livery:{body:i?'#ffffff':'#ff0000'}},sec:{personal:[30+i,30+i,30+i]},secColors:{},run:{frames,FRAME:36,laps,events:[{type:'sector',lap:1,sec:0,time:30+i,t:40+i},{type:'sector',lap:1,sec:1,time:30+i,t:70+i},{type:'sector',lap:1,sec:2,time:30+i,t:100+i}],pits:[{t:135,tyres:true,compound:other}],compoundNow:other,P:{comp:SIM.COMPOUNDS[other]},pushLaps:5,pitRequest:i===1}};
   };
   const cars=[make(0),make(1)];let carIdx=0,run=cars[0].run,sec=cars[0].sec,secColors=cars[0].secColors,pitModal=false;
   const pb={t:130,lightsOut:0,msg:cars[0].msg,playing:false};
   const F={fuel:17,pit:30,sec:31,x:1,y:2,psi:3,u:4,v:5,delta:7,thr:8,brk:9,gear:10,rpm:11,ax:19,ay:20,lap:21,idx:22},FRAME=36;
   const view=eval('(function(){'+cfg.sampler+';return {setRun,sample,S,setEvents(e){this.events=e},setCompound(c){this.compound=c},setLivery(l){this.livery=l},removeGhost(){},setConditions(){}}})()');
   view.setRun(run.frames);
   eval(cfg.functions+';window.changeCar=switchCar;window.paintCurrent=()=>hud(view.sample(pb.t));');
   const snapshots=[];
   for(const i of [1,0,1,0]){
    window.changeCar(i);
    snapshots.push({i,speed:$('#h-speed').textContent,gear:$('#h-gear').textContent,fuel:$('#h-fuel').textContent,ers:$('#h-ers').textContent,tyres:[...document.querySelectorAll('#h-tyres .ap-wheel-cell')].map(e=>e.textContent),compound:view.compound,livery:view.livery,time:$('#h-time').textContent,last:$('#h-last').textContent,sectors:[0,1,2].map(i=>$('#hs'+i).textContent),brake:$('[data-hud-brake-value]').textContent,throttle:$('[data-hud-throttle-value]').textContent,audio:audioSample.u,map:mapSample.u,forecastSamples:hud._ty.samples,boxDisabled:$('#h-box').disabled,boxArmed:$('#h-box').classList.contains('armed'),marked:document.querySelector('[data-car].on').dataset.car});
   }
   // Crossing a recorded tyre change updates both the tyre panel and the 3D car, without another selection.
   pb.t=136;window.paintCurrent();
   return {snapshots,afterStop:{compound:view.compound,tyres:$('#h-tyres').textContent,samples:hud._ty.samples},radioClears};
  },{functions,sampler,modules:['division.js','timing.js','analysis.js','sim.js'].map(moduleUrl)});
  for(const s of result.snapshots){
   const i=s.i;assert.equal(s.speed,i?'72':'36');assert.equal(s.gear,String(3+i));assert.equal(s.fuel,i?'40.0 L':'20.0 L');assert.equal(s.ers,i?'75%':'25%');assert.equal(s.compound,i?'H':'S');assert.equal(s.time,i?'20.000':'30.000');assert(s.last.includes(i?'100.000':'90.000'));assert.equal(s.audio,10+i*10);assert.equal(s.map,10+i*10);assert.equal(s.throttle,i?'70%':'20%');assert.equal(s.brake,i?'30%':'10%');assert.equal(s.forecastSamples,1,'future lap entered tyre forecast');assert.equal(s.boxDisabled,false);assert.equal(s.boxArmed,i===1);assert.equal(s.marked,String(i));
   assert(s.sectors[0].startsWith((30+i).toFixed(3)));assert(s.sectors[2].startsWith((90+3*i).toFixed(3)));
   assert(s.tyres[0].includes(i?'H70%100°':'S90%90°'));assert.equal(s.livery.body,i?'#ffffff':'#ff0000');
  }
  assert.deepEqual(result.snapshots[0],result.snapshots[2]);assert.deepEqual(result.snapshots[1],result.snapshots[3]);
  assert.equal(result.afterStop.compound,'M');assert(result.afterStop.tyres.includes('M'));assert.equal(result.afterStop.samples,0,'old tyre set entered new set forecast');assert.equal(result.radioClears,4);
  console.log('PASS',width,'immediate paused car switch: tyres, wear, temperatures, fuel, ERS, lap/sector times, pedals, audio, map, livery, pit controls; playback tyre changes and forecast');
  if(process.env.HUD_SCREENSHOTS) await page.screenshot({path:path.join(process.env.HUD_SCREENSHOTS,'car-hud-'+width+'.png')});
  await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
