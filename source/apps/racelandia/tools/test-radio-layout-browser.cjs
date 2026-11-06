// PLAYWRIGHT_MODULE=/path/to/playwright-core node apps/racelandia/tools/test-radio-layout-browser.cjs
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../public'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
(async()=>{
 const browser=await chromium.launch({args:['--no-sandbox']});
 try{
 for(const [width,height] of [[390,844],[640,360],[874,460],[1100,550],[1360,740]])for(const theme of ['light','dark']){
  const page=await browser.newPage({viewport:{width,height}});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px Arial}#app{height:100vh}.ap-view{height:100% !important}</style><div id="app"><div class="ap-view"><div class="ap-hud"><div class="ap-tower"><div class="ap-tower-head">Classification</div><div id="h-order"></div></div><div class="ap-hud-l">Speed and tyres</div><div class="ap-hud-t"><div id="h-lap">Lap 2</div><div id="h-session-clock"></div></div><div class="ap-radio peek"><button class="ap-radio-head"><span><span class="ap-radio-ic">🎙</span><span class="ap-radio-tt">Driver radio</span></span><i>▾</i></button><div class="ap-radio-list"></div></div></div><div class="ap-ctl"><div class="ap-cams">'+['Chase','Cockpit','TV','Helicopter','Nose','Orbit'].map(n=>'<button>'+n+'</button>').join('')+'</div><div class="ap-watch"><button>Driver Alpha</button><button>Driver Bravo</button></div><button id="box">Бокс</button><button id="through">Преминаване през питлейна</button><div class="ap-speeds">'+['×1','×2','×4','×8','Skip','Sound'].map(n=>'<button>'+n+'</button>').join('')+'</div></div></div></div>');
  await page.addStyleTag({content:read('style.css')});
  await page.evaluate(theme=>{document.documentElement.style.setProperty('--fg',theme==='dark'?'#f5f7fc':'#181d28');document.documentElement.style.setProperty('--bg',theme==='dark'?'#151922':'#fff');},theme);
  await page.evaluate(async url=>{
   const D=await import(url);window.fit=()=>D.fitHud(document.querySelector('.ap-view'),k=>k);window.fit();
   const list=document.querySelector('.ap-radio-list');
   list.innerHTML=Array.from({length:20},()=>'<div class="ap-radio-msg warn"><em>3:41</em><span>Някои гуми още са под работната си температура. При този разход горивото стига за още около 5 обиколки.</span></div>').join('');
  },'data:text/javascript;base64,'+Buffer.from(read('division.js')).toString('base64'));
  for(const mode of ['shut','peek','open']){
   await page.evaluate(mode=>{document.querySelector('.ap-radio').className='ap-radio '+mode;window.fit();},mode);
   const rects=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};return {radio:box('.ap-radio'),ctl:box('.ap-ctl'),head:box('.ap-radio-head'),through:box('#through'),box:box('#box')};});
   assert(rects.radio.height>0);assert(rects.radio.bottom<=rects.ctl.top-7,JSON.stringify({width,height,mode,rects}));assert(rects.radio.top>=0);
   for(const id of ['box','through']){
    const r=rects[id],x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
    const hit=await page.evaluate(({x,y,id})=>document.elementFromPoint(x,y)?.closest('button')?.id===id,{x,y,id});assert(hit,'radio blocks '+id);
   }
  }
  // Increasing text size reflows the controls. The radio follows the new bar height.
  await page.addStyleTag({content:'.ap-ctl button{font-size:20px !important}'});await page.evaluate(()=>window.fit());
  assert(await page.evaluate(()=>document.querySelector('.ap-radio').getBoundingClientRect().bottom<=document.querySelector('.ap-ctl').getBoundingClientRect().top-7));
  if(process.env.RADIO_SCREENSHOTS)await page.screenshot({path:path.join(process.env.RADIO_SCREENSHOTS,'radio-'+width+'-'+theme+'.png')});
  console.log('PASS layout',width,height,theme,'collapsed, preview, history, wrapped/large controls, pit button hit tests');await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
