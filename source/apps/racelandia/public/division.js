// race.js is imported through the app's asset loader by mp.js and passed below.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mod=(a,b)=>((a%b)+b)%b;
// The team's two cars are 'player' and 'player2' in every classification.
export const isMine=id=>id==='player'||id==='player2';
// Shared driving instruments for practice, qualifying and the race.
export function bindSoundButton(button,options){
  let restore=false;
  const remember=()=>{restore=button.dataset.blocked==='true'||!!options.engine()?.blocked;};
  button.addEventListener('pointerdown',remember);button.addEventListener('keydown',remember);
  const paint=()=>{const on=options.enabled(),blocked=on&&!!options.engine()?.blocked;button.dataset.blocked=String(blocked);button.textContent=on?(blocked?'🔈':'🔊'):'🔇';button.title=options.t(blocked?'ap_sound_resume':on?'ap_sound_mute':'ap_sound_enable');button.setAttribute('aria-label',button.title);};
  button.onclick=()=>{if(options.enabled()&&(restore||options.engine()?.blocked)){options.engine()?.resume();}else options.set(!options.enabled());restore=false;paint();};
  paint();return paint;
}
export function drivingMetersHtml(t){
  return `<div class="ap-driving-meters"><div class="ap-instrument-head"><span>RPM</span><b data-hud-rpm-value>0</b></div><div class="ap-instrument-track ap-rpm-track"><i data-hud-rpm></i></div>
    <div class="ap-pedals"><div><div class="ap-instrument-head"><span>${esc(t('ap_hud_brake'))}</span><b data-hud-brake-value>0%</b></div><div class="ap-instrument-track ap-brake-track"><i data-hud-brake></i></div></div>
    <div><div class="ap-instrument-head"><span>${esc(t('ap_hud_throttle'))}</span><b data-hud-throttle-value>0%</b></div><div class="ap-instrument-track ap-throttle-track"><i data-hud-throttle></i></div></div></div></div>`;
}
export function updateDrivingMeters(host,state,t){
  const percent=v=>Math.max(0,Math.min(1,Number(v)||0))*100;
  host.querySelector('[data-hud-rpm-value]').textContent=Math.round(state.rpm||0);
  host.querySelector('[data-hud-rpm]').style.width=percent((state.rpm||0)/12400)+'%';
  // Show the sampled pedal travel directly. Telemetry already includes the
  // physical actuator response; a second wall-clock filter hid short inputs
  // and kept moving after the replay was paused or a different car selected.
  for(const [name,value] of [['brake',state.brk],['throttle',state.thr]]){
    const travel=percent(value);
    host.querySelector('[data-hud-'+name+']').style.width=travel+'%';
    host.querySelector('[data-hud-'+name+'-value]').textContent=Math.round(travel)+'%';
  }
}
export function tyreHudHtml({compound,wear,temps,tempColor,remaining},t){
  const colors={S:'#ff626b',M:'#f2ce39',H:'#f2f4f8',I:'#4fd18b',W:'#5aa9ff'},color=colors[compound]||colors.M;
  return `<div class="ap-wheel-grid" style="--compound-color:${color}">${['FL','FR','RL','RR'].map((name,i)=>{
    const w=Math.max(0,Math.min(1,wear[i]||0)),level=w<.4?'#4fd18b':w<.62?'#f2ce39':w<.72?'#ffab66':'#ff737a';
    const shown=remaining?100-Math.round(w*100):Math.round(w*100),title=esc(t('ap_c_'+compound)+' · '+name+' · '+t(remaining?'ap_hud_left':'ap_hud_wear')+': '+shown+'%');
    return `<div class="ap-wheel-cell" title="${title}" aria-label="${title}"><small>${name}</small><span class="ap-hud-wheel" aria-hidden="true"><i>${esc(compound)}</i></span><b style="color:${level}">${shown}%</b>${temps?`<em style="color:${tempColor(temps[i])}">${Math.round(temps[i])}°</em>`:''}</div>`;
  }).join('')}</div>`;
}
export function classificationHtml(rows,t,time){
  return `<div class="ap-scroll"><table class="ap-table"><tr><th>#</th><th>${esc(t('ap_tab_driver'))}</th><th>${esc(t('ap_time_h'))}</th><th>${esc(t('ap_laps'))}</th><th>${esc(t('ap_points'))}</th></tr>${rows.map((r,i)=>`<tr class="${isMine(r.id)?'best':''}"><td>${i+1}</td><td>${esc(r.name)}${r.dnf?' · '+esc(t('ap_dnf_'+r.dnf,{part:t('ap_part_engine')})):''}${r.penalty?' +'+r.penalty+'s':''}</td><td>${r.time==null?'—':time(r.time)}</td><td>${r.laps??'—'}</td><td>${r.points??'—'}</td></tr>`).join('')}</table></div>`;
}
// The first places always stay at the top and the list scrolls freely. When our own row is outside the
// visible part it is shown again, pinned to the bottom edge with its position.
export function focusClassification(rows){
  if(!rows)return;
  rows.tabIndex=0;
  let pin=rows.querySelector(':scope > .ap-order-pin');
  const own=rows.querySelector('.ap-order-row.watched:not(.ap-order-pin)')||rows.querySelector('.ap-order-row.mine:not(.ap-order-pin)');
  if(!own){if(pin)pin.hidden=true;return;}
  if(!pin){pin=document.createElement('div');rows.appendChild(pin);}
  else if(rows.lastElementChild!==pin)rows.appendChild(pin);
  pin.dataset.car=own.dataset.car||'';pin.dataset.teamCar=own.dataset.teamCar||'';
  pin.className=own.className+' ap-order-pin';pin.innerHTML=own.innerHTML;pin.title=own.title||'';
  Object.assign(pin.style,{position:'sticky',top:'auto',bottom:'0',left:'0',right:'0',transform:'none'});
  pin.style.removeProperty('--i');
  const box=rows.getBoundingClientRect(),row=own.getBoundingClientRect();
  pin.hidden=!rows.clientHeight||(row.top>=box.top-1&&row.bottom<=box.bottom+1);
}
// The timing tower sits above the speed and tyre panels and must never overlap them: it gets
// exactly the height that is left, on any screen, and scrolls inside when there is less.
// ── The phone layout of the track screens (practice, qualifying and races) ──
// Cameras, watched car and replay speed go into one menu button; the classification shrinks to the
// player's position and three letters; the lap timer to the time and sector colours. A tap opens each
// in full. The nodes are only moved, so every button keeps its handler, and move back on a wide screen.
const PHONE_MAX=640;
function phoneHudBuild(view,t){
  const ph=document.createElement('div');ph.className='ap-ph';
  ph.innerHTML=`<button class="ap-ph-pos" type="button"></button>`;
  view.appendChild(ph);
  // the menu button and its panel live in the bottom bar, next to the pit buttons; the panel opens upwards
  const ctl=view.querySelector('.ap-ctl'),label=t?t('ap_menu'):'Menu';
  const menu=document.createElement('button');menu.type='button';menu.className='ap-ph-menu';menu.setAttribute('aria-label',label);menu.title=label;menu.textContent='☰';
  const panel=document.createElement('div');panel.className='ap-ph-panel';
  if(ctl){ctl.insertBefore(menu,ctl.firstChild);ctl.appendChild(panel);}
  ph._menu=[menu,panel];
  const moved=[];
  for(const sel of ['.ap-cams','.ap-watch','.ap-speeds']){
    const el=view.querySelector(sel);
    if(el&&!panel.contains(el)){moved.push({el,parent:el.parentNode,next:el.nextSibling});panel.appendChild(el);}
  }
  ph._moved=moved;
  const toggle=cls=>{const on=!view.classList.contains(cls);view.classList.remove('ap-menu-open','ap-tw-open','ap-hud-open');if(on)view.classList.add(cls);};
  menu.addEventListener('click',()=>toggle('ap-menu-open'));
  ph.querySelector('.ap-ph-pos').addEventListener('click',()=>toggle('ap-tw-open'));
  const tw=view.querySelector('.ap-tower');if(tw)tw.addEventListener('click',e=>{if(e.target.closest('.ap-tower-head')&&!e.target.closest('button'))view.classList.remove('ap-tw-open');});
  panel.addEventListener('click',e=>{if(e.target.closest('button'))setTimeout(()=>view.classList.remove('ap-menu-open'),160);});
  const timer=view.querySelector('.ap-hud-t');
  if(timer)timer.addEventListener('click',()=>toggle('ap-hud-open'));
  return ph;
}
function phoneHudRestore(view,ph){
  for(const {el,parent,next} of (ph._moved||[]).slice().reverse())parent.insertBefore(el,next&&next.parentNode===parent?next:null);
  for(const n of ph._menu||[])n.remove();
  view.querySelector('.ap-hud-t>.ap-ph-who')?.remove();
  view.querySelector(':scope > .ap-phone-switch')?.remove();
  view.classList.remove('ap-has-laps','ap-has-team');
  view.style.removeProperty('--ap-team-height');
  ph.remove();view.classList.remove('ap-menu-open','ap-tw-open','ap-hud-open');
}
export function phoneHud(view,t){
  if(!view)return false;
  let ph=view.querySelector(':scope>.ap-ph');
  if(innerWidth>PHONE_MAX){if(ph)phoneHudRestore(view,ph);return false;}
  if(!ph)ph=phoneHudBuild(view,t);
  // the player's position and the first three letters of the name, from the classification itself
  const row=view.querySelector('.ap-tower .ap-order-row.watched:not(.ap-order-pin)')||view.querySelector('.ap-tower .ap-order-row.mine:not(.ap-order-pin)')||view.querySelector('.ap-tower .ap-order-row.mine');
  const pos=row?.querySelector('b')?.textContent.trim()||'–',name=(row?.querySelector('span')?.textContent||'').trim().slice(0,3);
  // the small classification is in race order: the leader on top, the car being watched only marked in its place
  const order=[...view.querySelectorAll('.ap-tower .ap-order-row:not(.ap-order-pin)')]
    .filter(r=>r===row||!['pit','finished','dnf'].includes(r.dataset.trackStatus))
    .sort((a,b)=>Number(a.querySelector('b')?.textContent)-Number(b.querySelector('b')?.textContent));
  const top=order[0]||row,topPos=top?.querySelector('b')?.textContent.trim()||'–',topName=((top?.querySelector('.ap-rival-name')||top?.querySelector('span'))?.textContent||'').trim().slice(0,3);
  const chip=ph.querySelector('.ap-ph-pos');
  chip.removeAttribute('title');chip.setAttribute('aria-label',topPos+' '+topName);chip.classList.toggle('watched',top===row);chip.setAttribute('aria-expanded',String(view.classList.contains('ap-tw-open')));
  const html=`<b>${esc(topPos)}</b><span>${esc(topName)}</span>`;
  if(chip._html!==html){chip.innerHTML=html;chip._html=html;}
  // Reuse the original compact timing style for every car on track, without a second heading.
  let runners=ph.querySelector('.ap-ph-runners');
  if(!runners){runners=document.createElement('div');runners.className='ap-ph-runners';ph.appendChild(runners);}
  const driving=order.slice(1);
  driving.forEach((entry,i)=>{
    let button=runners.children[i];
    if(!button){button=document.createElement('button');button.type='button';runners.appendChild(button);}
    const driver=(entry.querySelector('.ap-rival-name')||entry.querySelector('span'))?.textContent.trim()||'';
    const rank=entry.querySelector('b')?.textContent.trim()||'–';
    const html=`<b>${esc(rank)}</b><span>${esc(driver.slice(0,3))}</span>`;
    if(button._html!==html){button.innerHTML=html;button._html=html;}
    button.classList.toggle('watched',entry===row);button.title=driver;button.onclick=()=>{view.classList.add('ap-tw-open');entry.scrollIntoView({block:'nearest'});};
  });
  while(runners.children.length>driving.length)runners.lastElementChild.remove();
  // One explicit car switch sits under the phone radio, separate from the timing tower.
  const watch=[...view.querySelectorAll('.ap-watch button')];
  let switcher=view.querySelector(':scope > .ap-phone-switch');
  if(watch.length>1){
    if(!switcher){switcher=document.createElement('button');switcher.type='button';switcher.className='ap-phone-switch';view.appendChild(switcher);}
    const current=Math.max(0,watch.findIndex(b=>b.classList.contains('on'))),next=watch[(current+1)%watch.length];
    switcher.textContent='⇄';
    switcher.title=(t?t('ap_watch_car'):'Watch this car')+' · '+next.textContent.trim();
    switcher.setAttribute('aria-label',switcher.title);switcher.onclick=()=>next.click();
  }else switcher?.remove();
  // the lap timer on the right names its driver: position and three letters before the time
  const timer=view.querySelector('.ap-hud-t');
  if(timer){let who=timer.querySelector(':scope>.ap-ph-who');
    if(!who){who=document.createElement('div');who.className='ap-ph-who';timer.insertBefore(who,timer.firstChild);}
    const w=pos+' '+name;if(who.textContent!==w)who.textContent=w;}
  // above the names of the classification: which lap it is and how long the session lasts (a race has its own status bar)
  const tower=view.querySelector('.ap-tower'),lapEl=view.querySelector('#h-lap,[data-race-lap]');
  if(tower&&lapEl){
    let bar=ph.querySelector('.ap-ph-laps');
    if(!bar){bar=document.createElement('div');bar.className='ap-ph-laps';ph.insertBefore(bar,ph.firstChild);}
    const cnt=lapEl.dataset.n!=null?lapEl.dataset.n+(lapEl.dataset.m?'/'+lapEl.dataset.m:''):lapEl.textContent.trim();
    const txt=['🏁 '+cnt,view.querySelector('#h-session-clock')?.textContent.trim()].filter(Boolean).join(' · ');
    if(bar.textContent!==txt)bar.textContent=txt;
    view.classList.add('ap-has-laps');
  }
  return true;
}
export function fitHud(view,t){
  const phone=phoneHud(view,t);
  const hud=view?.querySelector('.ap-hud'),tower=hud?.querySelector('.ap-tower'),left=hud?.querySelector('.ap-hud-l');
  if(!hud||!tower||!left)return;
  const controls=view.querySelector('.ap-ctl'),base=parseFloat(getComputedStyle(left).getPropertyValue('--ap-hud-bottom'))||58;
  // Camera and speed controls wrap into several rows on phones.
  const bottom=Math.max(base,controls?controls.offsetHeight+(parseFloat(getComputedStyle(controls).bottom)||0)+8:0);
  view.style.setProperty('--ap-controls-clearance', bottom+'px');
  left.style.bottom=phone?(controls?controls.offsetHeight+8:8)+'px':bottom+'px';
  const top=parseFloat(getComputedStyle(tower).top)||0;
  // a phone shows only the head of the classification; a big screen may show most of it
  const room=Math.min(hud.clientHeight-left.offsetHeight-bottom-top-8,hud.clientHeight*(innerWidth<=860?.3:.7));
  tower.style.maxHeight=Math.max(130,room)+'px';
  // on a phone the fuel, energy and weather row sits right above the speed strip
  const gauges=hud.querySelector('.ap-gauges');
  if(gauges&&phone)gauges.style.bottom=(parseFloat(left.style.bottom)+left.offsetHeight+6)+'px';
  else if(gauges)gauges.style.removeProperty('bottom');
  const switcher=view.querySelector(':scope > .ap-phone-switch');
  if(phone&&switcher){
    const anchor=view.querySelector('.ap-radio')||view.querySelector('[data-race-wx]')||view.querySelector('.ap-hud-t');
    const rect=view.getBoundingClientRect();
    const floor=left.getBoundingClientRect().top-rect.top-switcher.offsetHeight-8;
    if(anchor?.classList.contains('ap-radio'))anchor.style.maxHeight=Math.max(0,floor-(anchor.getBoundingClientRect().top-rect.top)-8)+'px';
    const a=anchor?.getBoundingClientRect();
    switcher.style.top=Math.max(0,Math.min(floor,Math.max(156,a&&a.height?a.bottom-rect.top+6:156)))+'px';
  }
  const rows=tower.querySelector('#h-order,[data-race-order]');
  if(rows){const head=(tower.querySelector('.ap-tower-head')?.offsetHeight||0)+(tower.querySelector('.ap-race-status')?.offsetHeight||0),own=tower.querySelector('#h-own-position')?.offsetHeight||0;rows.style.maxHeight=Math.max(78,room-head-own)+'px';rows.style.overflowY='auto';if(rows._classificationFocus)focusClassification(rows);}
}
// Keep the authoritative 100 ms steps intact; render one step behind using the
// accumulator fraction. Unwrapped distance also interpolates across the finish line.
export class RacePlayback {
  constructor(race){this.race=race;this.acc=0;this.previous=race.cars.map(c=>({...c}));}
  advance(dt){
    if(this.race.done)return;
    this.acc+=dt;
    while(this.acc>=.1){
      this.previous=this.race.cars.map(c=>({...c}));
      this.race.step();this.acc-=.1;
      if(this.race.done)break;
    }
  }
  sample(i){
    const c=this.race.cars[i],a=this.previous[i],f=this.race.done?1:Math.min(1,Math.max(0,this.acc/.1));
    return {...c,p:a.p+(c.p-a.p)*f,lane:a.lane+(c.lane-a.lane)*f,v:a.v+(c.v-a.v)*f};
  }
}

// Short-range weather for the HUD: what the next few minutes bring, and a lap-by-lap table for strategy calls.
const WX_RAIN=.02,wxSky=c=>c.rain>.5?'🌧️':c.rain>.02?'🌦️':c.cloud>.72?'☁️':c.cloud>.35?'⛅':'☀️';
const wxPct=c=>Math.round(100*Math.max(0,Math.min(1,c.pp!=null?Math.max(c.pp,c.rain||0):(c.rain||0))));
// `half` is the half-width of the rain-chance range the team's meteorologist can give (null: nobody, no forecast).
export function weatherShort(M,forecast,hf,t,span=10,half=0){
  const at=m=>M.SIM.condAt(forecast,hf+m/60),now=at(0).rain>WX_RAIN;let change=null;
  for(let s=15;s<=span*60&&change==null;s+=15)if((at(s/60).rain>WX_RAIN)!==now)change=Math.max(1,Math.round(s/60));
  const FX=M.FX,state=`${wxSky(at(0))} ${esc(t(now?'ap_wx_raining':'ap_wx_not_raining'))}`;
  if(half==null)return `<span>${state}</span><small>${esc(t('ap_wx_none'))}</small>`;
  const chance=FX.wxText(wxPct(at(0)),'r'+Math.floor(hf*6),half);
  if(!FX.wxShortOn(half))return `<span>${state} · ${chance}</span><small>${esc(t('ap_wx_hourly_only'))}</small>`;
  if(half<=6){const msg=now?(change==null?'ap_wx_short_wet':'ap_wx_short_stops'):(change==null?'ap_wx_short_dry':'ap_wx_short_starts');
    return `<span>${state} · ${chance}</span><small>${esc(t(msg,{n:change??span}))}</small>`;}
  const top=Math.max(...[0,span/2,span].map(m=>wxPct(at(m))));
  return `<span>${state} · ${chance}</span><small>${esc(t('ap_wx_short_chance',{n:FX.wxText(top,'a'+Math.floor(hf*6),half),m:span}))}</small>`;
}
export function weatherLapsHtml(M,forecast,hf,lapSec,lap,laps,t,half=0){
  const rows=[];const last=Math.min(laps,lap+11);
  for(let n=lap;n<=last;n++){
    const m=(n-lap+.5)*lapSec/60,c=M.SIM.condAt(forecast,hf+m/60);
    rows.push(`<tr><td>${n}</td><td>${esc(t('ap_wx_in',{n:Math.max(0,Math.round(m))}))}</td><td>${wxSky(c)}</td><td><b>${esc(M.FX.wxText(wxPct(c),'l'+n+':'+Math.floor(hf*2),half))}</b></td><td>${half<=6&&c.rain>WX_RAIN?esc(t('ap_wx_intensity',{n:(c.rain*2.5).toFixed(1)})):'—'}</td><td>${Math.round(c.track)}°</td></tr>`);
  }
  return `<div class="ap-sum-in ap-wxlaps" role="dialog" aria-modal="true"><h2>${esc(t('ap_wx_by_lap'))}</h2><div class="ap-scroll"><table class="ap-table"><tr><th>${esc(t('ap_wx_col_lap'))}</th><th></th><th></th><th>${esc(t('ap_wx_col_rain'))}</th><th>mm/h</th><th>${esc(t('ap_asphalt'))}</th></tr>${rows.join('')}</table></div><p class="ap-hint">${esc(t('ap_wx_by_lap_hint'))}</p><button class="ap-btn" data-wx-close>${esc(t('ap_close'))}</button></div>`;
}
export function openWeatherLaps(host,html){
  const ov=document.createElement('div');ov.className='ap-sum';ov.innerHTML=html;host.appendChild(ov);
  const close=()=>ov.remove();ov.querySelector('[data-wx-close]').onclick=close;ov.addEventListener('click',e=>{if(e.target===ov)close();});return ov;
}
export function playRace({host,M,track,payload,t,money,time,sendPit,onFinish,onGarage,RaceModel,sound,saveProgress}){
  const race=new RaceModel(payload.race_config,payload.race_commands||[]),L=race.length;
  // a reloaded page runs the race again, with the stored pit calls, up to where it was
  const checkpointKey='racelandia:race:'+payload.session;
  let localTime=0;try{localTime=Number(localStorage.getItem(checkpointKey))||0;}catch(_){}
  const resumeAt=Math.max(Number(payload.progress?.t)||0,Math.min(20000,localTime),...(payload.race_commands||[]).map(c=>c.t));
  for(let n=0;resumeAt>0&&race.t<resumeAt-.05&&!race.done&&n<400000;n++)race.step();
  const playback=new RacePlayback(race);
  let saveAt=performance.now(),localAt=0;
  function checkpoint(force=false){
    if(dead||reported)return;
    const now=performance.now();
    if(force||now-localAt>=100){localAt=now;try{localStorage.setItem(checkpointKey,String(race.t));}catch(_){}}
    if(saveProgress&&(force||now-saveAt>=1000)){saveAt=now;saveProgress(race.t);}
  }
  const flushProgress=()=>checkpoint(true);
  window.addEventListener('pagehide',flushProgress);document.addEventListener('visibilitychange',flushProgress);
  let paused=false,dead=false,reported=false,speed=1,drawAcc=1,pending=false,shown=null;
  // The team has two cars in the race: the one being watched is the one the camera, the instruments and the pit calls belong to.
  const ownIds=race.cars.filter(c=>c.e.mine).map(c=>c.e.id);let watched=ownIds[0]||'player';
  const ownCar=()=>race.by_id[watched],ownIndex=()=>race.cars.indexOf(ownCar()),entryOf=()=>payload.entries?.[watched]||{tyre_set:payload.tyre_set,tyres:payload.tyres};
  host.innerHTML=`<div class="ap-view ap-race-view"><div class="ap-3d" id="ap-race-3d"></div><div class="ap-hud">
    <div class="ap-tower ap-race-tower"><div class="ap-race-status"><i class="ap-flag" data-race-flags>⚑</i><b data-race-lap></b><small data-race-sc></small></div><div class="ap-tower-head"><b>${esc(t('ap_classification'))}</b><button class="ap-gap-toggle" data-race-gapmode title="${esc(t('ap_gap_toggle'))}">${esc(t('ap_gap'))} ⇅</button></div><div class="ap-race-order" data-race-order></div></div>
    <div class="ap-hud-l"><div class="ap-speed"><b data-race-speed>0</b><small>km/h</small><span data-race-gear>N</span></div>${drivingMetersHtml(t)}<div class="ap-race-telemetry" data-race-tyres></div></div>
    <div class="ap-hud-r"><canvas data-race-map width="170" height="120"></canvas><button class="ap-wxbox" data-race-wx title="${esc(t('ap_wx_tap'))}"></button></div><div class="ap-lights" data-race-lights></div><div class="ap-banner" data-race-msg hidden></div>
    </div><div class="ap-ctl"><div class="ap-cams">${['chase','cockpit','tv','heli','nose','orbit'].map(c=>`<button data-race-cam="${c}">${esc(t('ap_cam_'+c))}</button>`).join('')}</div>
    <div class="ap-race-pit">${ownIds.length>1?`<div class="ap-watch">${ownIds.map(id=>`<button data-race-watch="${id}" title="${esc(t('ap_watch_car'))}">${esc(payload.entries?.[id]?.name||id)}</button>`).join('')}</div>`:''}<button class="ap-boxbtn" data-race-box>${esc(t('ap_box'))}</button><button class="ap-boxbtn" data-race-through>${esc(t('ap_pit_through'))}</button></div>
    <div class="ap-speeds"><button data-race-sound>${sound?.enabled===false?'🔇':'🔊'}</button>${[1,2,4,8,64].map(v=>`<button data-race-speed-set="${v}">${v===64?esc(t('ap_skip')):'×'+v}</button>`).join('')}</div></div></div>`;
  const FACT=[.92,1.10,.96,1.02];                       // a left-handed circuit works the right-hand tyres harder
  const asked=new Set();
  const mountedSet=()=>new Set([entryOf().tyre_set.id,...race.commands.filter(c=>(c.car||'player')===watched).map(c=>c.set)]);
  const free=()=>{const mounted=mountedSet();return (entryOf().tyres||[]).filter(x=>!mounted.has(x.id)&&!asked.has(x.id)&&Math.max(...x.wear)<.98);};
  const wearOf=x=>x.wear.reduce((a,b)=>a+b,0)/4;
  const q=s=>host.querySelector(s),view=M.VIEW.createView(M.THREE,q('#ap-race-3d'),track,{low:matchMedia('(pointer:coarse)').matches,venue:payload.venue,site:payload.site,livery:ownCar().e.livery,compound:entryOf().tyre_set?.compound||payload.compound});
  view.setConditions(M.SIM.condAt(payload.forecast,payload.hour||12),payload.hour||12);view.setCamera('chase');let setLapStart=0,lastStops=0,weatherAt=-9;
  q('[data-race-wx]').onclick=()=>{if(!M.FX.wxShortOn(payload.wx_half))return;
    const own=ownCar(),prog=own.laps+Math.max(0,(own.p%L)/L),lapSec=prog>.7?race.t/prog:L/50,hf=(payload.hour||12)+race.t/3600;
    openWeatherLaps(host.querySelector('.ap-race-view'),weatherLapsHtml(M,payload.forecast,hf-(prog%1)*lapSec/3600+0,lapSec,Math.min(payload.laps,own.laps+1),payload.laps,t,payload.wx_half));
  };

  let soundEnabled=sound?.enabled!==false,engine=null;
  const ensureSound=()=>{if(soundEnabled&&!engine){try{engine=sound?.factory({enabled:true,context:sound.context?.()});}catch(_){}}};ensureSound();
  const paintSound=bindSoundButton(q('[data-race-sound]'),{engine:()=>engine,enabled:()=>soundEnabled,t,set:value=>{soundEnabled=value;ensureSound();engine?.setEnabled(value);sound?.changed(value);}});
  let pitDialog=null;
  const closePitDialog=()=>{pitDialog?.remove();pitDialog=null;};
  q('[data-race-box]').addEventListener('click',()=>{
    const c=ownCar();if(pending||pitDialog||race.done||c.dnf||c.finish!==null||c.request||c.pit||race.commands.some(x=>x.t>race.t))return;
    const available=free().sort((a,b)=>'HMSIW'.indexOf(a.compound)-'HMSIW'.indexOf(b.compound)||wearOf(a)-wearOf(b));
    let selected=null;
    const PART_ORDER=['frontWing','rearWing','floor','suspension','brakes','engine','gearbox','battery'];
    const used=()=>new Set(race.commands.flatMap(x=>[x.wing_unit,...Object.values(x.service||{})]).filter(Boolean));
    const spares=part=>(payload.spares||[]).filter(u=>u.part===part&&u.wear<.98&&!used().has(u.id));
    const spareOptions=part=>spares(part).map(u=>`<option value="${esc(u.id)}">${esc(t('ap_pit_spare',{ver:u.ver||1,left:Math.round((1-u.wear)*100)}))}</option>`).join('');
    const ov=document.createElement('div');pitDialog=ov;ov.className='ap-pitpanel';
    ov.innerHTML=`<div class="ap-pit-in" role="dialog" aria-modal="true" aria-labelledby="ap-race-plan-title"><h2 id="ap-race-plan-title">${esc(t('ap_pit_plan'))}</h2><p class="ap-hint">${esc(t('ap_pit_plan_hint'))}</p>
      <h3>${esc(t('ap_tyres'))}</h3><div class="ap-setrow"><button class="ap-setchip on" data-plan-set="">${esc(t('ap_pit_keep'))}</button>${available.map(x=>`<button class="ap-setchip" data-plan-set="${esc(x.id)}"><i class="ap-tyre-badge tyre-${x.compound}">${x.compound}</i><b>${esc(x.id)}</b><small>${x.runs?Math.round((1-wearOf(x))*100)+'%':esc(t('ap_set_new'))}</small></button>`).join('')}</div>
      <h3>${esc(t('ap_pit_wing'))}</h3><p class="ap-hint">${esc(t('ap_pit_wing_hint'))}</p>
      <label class="ap-service-option">${esc(t('ap_pit_wing_state',{n:Math.round((1-(c.wing||0))*100)}))} <select data-plan-wing><option value="">${esc(t('ap_pit_keep'))}</option>${spareOptions('frontWing')}</select></label>
      <label class="ap-service-option"><input type="checkbox" data-plan-service> ${esc(t('ap_pit_service'))}</label>
      <p class="ap-hint">${esc(t('ap_pit_service_hint'))}</p>
      <div data-plan-parts hidden>${PART_ORDER.map(k=>`<div class="ap-set"><div class="ap-set-h"><label>${esc(t('ap_part_'+k))}</label><output>${k==='frontWing'?Math.round((1-(c.wing||0))*100):Math.round((1-(payload.parts?.[k]||0))*100)}%</output></div>${spares(k).length?`<label class="ap-service-option"><select data-plan-swap="${k}"><option value="">${esc(t('ap_pit_keep'))}</option>${spareOptions(k)}</select><b>${M.RACE.SWAP_SECONDS[k]} s</b></label>`:`<p class="ap-hint">${esc(t('ap_pit_no_spare'))}</p>`}</div>`).join('')}</div>
      <p data-plan-time class="ap-hint"></p><p data-plan-error class="ap-warn" role="status"></p>
      <div class="ap-plan-actions"><button class="ap-btn ap-ghost" data-plan-cancel>${esc(t('ap_cancel'))}</button><button class="ap-btn" data-plan-confirm disabled>${esc(t('ap_box'))}</button></div></div>`;
    q('.ap-view').appendChild(ov);
    const confirm=ov.querySelector('[data-plan-confirm]'),wing=ov.querySelector('[data-plan-wing]'),service=ov.querySelector('[data-plan-service]'),parts=ov.querySelector('[data-plan-parts]');
    const swaps=()=>service.checked?Object.fromEntries([...ov.querySelectorAll('[data-plan-swap]')].filter(i=>i.value).map(i=>[i.dataset.planSwap,i.value])):{};
    const update=()=>{
      parts.hidden=!service.checked;wing.disabled=service.checked||pending;if(service.checked)wing.value='';
      const swap=swaps(),n=Object.keys(swap).length,quick=!!wing.value;
      confirm.disabled=pending||!selected&&!quick&&!n;
      const p=c.e.pit_typical,seconds=n?(selected?(p?p.tyre:2.8):.8)+M.RACE.serviceSeconds(swap):selected||quick?(p?(selected&&quick?p.both:selected?p.tyre:p.repair):((selected?2.8:.8)+(quick?6:0))):0;
      ov.querySelector('[data-plan-time]').textContent=seconds?t('ap_pit_time',{n:seconds.toFixed(1)}):'';
    };
    ov.querySelectorAll('[data-plan-set]').forEach(button=>button.onclick=()=>{selected=available.find(x=>x.id===button.dataset.planSet)||null;ov.querySelectorAll('[data-plan-set]').forEach(b=>b.classList.toggle('on',b===button));update();});
    wing.onchange=update;service.onchange=update;ov.querySelectorAll('[data-plan-swap]').forEach(i=>i.onchange=update);ov.querySelector('[data-plan-cancel]').onclick=closePitDialog;
    confirm.onclick=async()=>{
      if(pending||race.done||c.dnf||c.finish!==null){closePitDialog();return;}
      const swap=swaps(),quick=wing.value;
      pending=true;update();ov.querySelectorAll('button,select,input').forEach(b=>b.disabled=true);
      const command={t:Math.round((race.t+.1)*10)/10,compound:selected?.compound||null,set:selected?.id||null,...(quick?{wing:true,wing_unit:quick}:{}),...(Object.keys(swap).length?{service:swap}:{}),...(watched!=='player'?{car:watched}:{})};
      const ok=await sendPit(command);
      if(dead)return;
      if(ok){race.commands.push(command);if(selected)asked.add(selected.id);closePitDialog();checkpoint(true);}
      else{ov.querySelector('[data-plan-error]').textContent=t('ap_no_budget');ov.querySelectorAll('button,select,input').forEach(b=>b.disabled=false);}
      pending=false;if(pitDialog)update();
    };
    confirm.focus();
  });
  q('[data-race-through]').onclick=async()=>{
    const c=ownCar();if(pending||pitDialog||race.done||c.pit||c.request||c.dnf||c.finish!==null||race.commands.some(x=>x.t>race.t))return;
    pending=true;
    const command={t:Math.round((race.t+.1)*10)/10,compound:null,set:null,pass:true,...(watched!=='player'?{car:watched}:{})};
    try { if(await sendPit(command)){race.commands.push(command);checkpoint(true);} }
    finally { pending=false; }
  };
  host.querySelectorAll('[data-race-cam]').forEach(b=>b.onclick=()=>view.setCamera(b.dataset.raceCam));
  host.querySelectorAll('[data-race-speed-set]').forEach(b=>b.onclick=()=>{speed=+b.dataset.raceSpeedSet;host.querySelectorAll('[data-race-speed-set]').forEach(x=>x.classList.toggle('on',x===b));});
  const pose=(c)=>{
    const f=mod(c.p,L)/L*track.N,i=Math.floor(f)%track.N,j=(i+1)%track.N,k=f-Math.floor(f),path=c.pit?track.pit.line:track.line;
    const off=c.dnf?track.half+3:c.lane;
    let dp=path.psi[j]-path.psi[i];while(dp>Math.PI)dp-=2*Math.PI;while(dp<-Math.PI)dp+=2*Math.PI;
    return {x:path.x[i]*(1-k)+path.x[j]*k+(track.nx[i]*(1-k)+track.nx[j]*k)*off,y:path.y[i]*(1-k)+path.y[j]*k+(track.ny[i]*(1-k)+track.ny[j]*k)*off,psi:path.psi[i]+dp*k,idx:i};
  };
  const gapText=(leader,c)=>{const gap=M.RACE.raceGap(leader,c,L);return gap.laps?esc(t(gap.laps===1?'ap_gap_lap':'ap_gap_laps',{n:gap.laps})):'+'+gap.seconds.toFixed(1);};
  const bounds={minX:Math.min(...track.x),maxX:Math.max(...track.x),minY:Math.min(...track.y),maxY:Math.max(...track.y)};
  // The classification: every car has its own row, which slides to its new place when the order changes.
  // The right-hand column is the gap to the leader, or (after a click on its head) the interval to the car ahead.
  const TYRE_COL={S:'#ff626b',M:'#f2ce39',H:'#f2f4f8',I:'#4fd18b',W:'#5aa9ff'},rowEls=new Map(),orderBox=q('[data-race-order]');
  let intervalMode=false;
  // Clicking one of the team's drivers, in the tower or on the buttons, makes that car the one that is watched and called into the pit.
  const watchBtns=host.querySelectorAll('[data-race-watch]'),paintWatch=()=>watchBtns.forEach(b=>b.classList.toggle('on',b.dataset.raceWatch===watched));
  const setWatched=id=>{if(!ownIds.includes(id)||id===watched)return;closePitDialog();watched=id;const c=ownCar();view.setCompound(c.compound);view.setLivery(c.e.livery);lastStops=c.stops;setLapStart=c.laps;drawAcc=1;paintWatch();};
  watchBtns.forEach(b=>b.onclick=()=>setWatched(b.dataset.raceWatch));paintWatch();
  orderBox.addEventListener('click',e=>{const id=e.target.closest('.ap-order-row')?.dataset.car;if(id)setWatched(id);});
  const gapBtn=q('[data-race-gapmode]');
  gapBtn.onclick=()=>{intervalMode=!intervalMode;gapBtn.textContent=t(intervalMode?'ap_interval':'ap_gap')+' ⇅';drawAcc=1;};
  const setText=(el,v)=>{if(el.textContent!==v)el.textContent=v;};
  let evSeen=0,msgNow=null;const msgQueue=[];
  function renderOrder(order,leader){
    const own=ownCar(),rh=innerWidth<=650?24:27;
    orderBox.style.setProperty('--rh',rh+'px');orderBox.style.height=order.length*rh+'px';
    order.forEach((c,i)=>{
      let el=rowEls.get(c.e.id);
      if(!el){el=document.createElement('div');el.className='ap-order-row';el.innerHTML='<b></b><span></span><i class="ap-tyrebadge"></i><em class="ap-stopn"></em><strong></strong>';rowEls.set(c.e.id,el);orderBox.appendChild(el);}
      el.style.setProperty('--i',i);
      el.classList.toggle('mine',!!c.e.mine);el.classList.toggle('watched',c===own);el.dataset.car=c.e.id;el.dataset.trackStatus=c.dnf?'dnf':c.finish!==null?'finished':c.pit?'pit':'flying';
      const [pos,name,tyre,stops,gap]=el.children;
      setText(pos,String(i+1));
      setText(name,c.e.name+(c.pit?' 🅿':c.blue_for?' 🔵':'')+(c.pen_due&&!c.dnf?' ! +'+c.pen_due+'s':''));
      setText(tyre,c.compound);tyre.style.setProperty('--tc',TYRE_COL[c.compound]||TYRE_COL.M);tyre.title=t('ap_c_'+c.compound);
      setText(stops,String(c.stops));stops.title=t('ap_pit_stops')+': '+c.stops;
      const before=i>0?order[i-1]:null;
      setText(gap,c.dnf?(c.dnf==='dsq'?'DSQ':'DNF'):c.finish!==null?'🏁':c===leader||!before?'—':intervalMode?gapText(before,c):gapText(leader,c));
    });
  }
  function draw(dt){
    if(dead)return;
    if(!paused&&!pending&&!race.done)playback.advance(dt*speed);
    const rendered=race.cars.map((_,i)=>playback.sample(i));
    const own=ownCar(),oi=ownIndex(),visual=rendered[oi],p=pose(visual),neutral=race.t<race.sc_until;
    Object.assign(view.S,p,{u:visual.v,v:0,t:race.t,gear:own.v<1?0:Math.min(8,1+Math.floor(own.v/11)),rpm:own.v<2?3800:Math.min(12400,7000+(own.v%11)/11*4000),delta:0,ax:0,ay:0,pit:own.pit?(own.stop_until>race.t?2:1):0,lap:own.laps});
    // The field model stores velocity rather than pedal inputs. Derive its
    // acceleration demand from the fixed step, independent of rendering FPS.
    const acceleration=(own.v-playback.previous[oi].v)/.1;
    const active=race.t>=race.cfg.lights+own.e.reaction&&!own.dnf&&own.finish===null&&!(own.stop_until>race.t);
    const brake=active?Math.min(1,Math.max(0,-acceleration/18)):0;
    const base=!active?0:Math.min(1,Math.max(own.v>0?(neutral?.22:.4):0,acceleration/7)),throttle=brake>.01?(brake<.35?base*(1-brake/.35)*.6:0):base;
    Object.assign(view.S,{thr:throttle,brk:brake});
    updateDrivingMeters(host,view.S,t);
    engine?.update({rpm:view.S.rpm,gear:view.S.gear,throttle,
      speed:own.v,time:race.t,camera:view.camera,playing:!paused&&!pending&&!own.dnf&&own.finish===null&&soundEnabled});
    paintSound();
    view.setCompound(own.compound);
    view.setField(rendered.filter((_,i)=>i!==oi).map(c=>({...pose(c),col:c.e.col,livery:c.e.livery,compound:c.compound,hidden:c.finish!==null||c.dnf&&race.t>=(c.clear_at??race.sc_until)})));
    if(neutral&&race.flag!=='red'){const lead=race.order().find(c=>!c.dnf&&c.finish===null&&!c.pit);view.setSafetyCar(lead?pose({...rendered[race.cars.indexOf(lead)],p:rendered[race.cars.indexOf(lead)].p+35,lane:0,dnf:null,pit:false}):null);}else view.setSafetyCar(null);
    const n=race.t<race.cfg.lights?Math.min(5,Math.max(0,Math.floor((race.t-1)/.8)+1)):0;view.lights(n);q('[data-race-lights]').hidden=!n;q('[data-race-lights]').innerHTML=[0,1,2,3,4].map(i=>`<i class="${i<n?'on':''}"></i>`).join('');
    drawAcc+=dt;if(drawAcc>.15){drawAcc=0;const order=race.order(),leader=order.find(c=>!c.dnf),position=order.indexOf(own)+1;
      q('[data-race-lap]').textContent=t('ap_lapn',{n:Math.min(payload.laps,own.laps+1),m:payload.laps});
      {const flag=q('[data-race-flags]'),kind=race.flag==='red'?'red':neutral?'yellow':own.blue_for?'blue':'green',name=race.flag==='red'?t('ap_red_flag'):neutral?t('ap_safety_car'):own.blue_for?t('ap_blue_flag'):t('ap_green_flag');
        if(flag.dataset.kind!==kind){flag.dataset.kind=kind;flag.className='ap-flag '+kind;flag.title=name;}
        setText(q('[data-race-sc]'),neutral?(race.flag==='restart'?'':Math.max(0,Math.ceil(race.sc_until-race.t))+' s'):'');}
      renderOrder(order,leader);
      fitHud(host.querySelector('.ap-view'),t);
      {const evs=race.events||[],nameOf=id=>race.by_id[id]?.e.name||id;
        while(evSeen<evs.length){const e=evs[evSeen++];
          const text=e.type==='penalty'?t('ap_ev_penalty',{a:nameOf(e.id),b:nameOf(e.other),n:e.secs}):e.type==='served'?t('ap_ev_served',{a:nameOf(e.id),n:e.secs}):e.tier==='touch'?t('ap_ev_touch',{a:nameOf(e.id),b:nameOf(e.other)}):e.tier==='spin'?t('ap_ev_spin',{a:nameOf(e.id),b:nameOf(e.other)}):t('ap_ev_crash',{a:nameOf(e.id),b:nameOf(e.other)});
          msgQueue.push(text);}
        if(!msgNow&&msgQueue.length)msgNow={text:msgQueue.shift(),until:race.t+7};
        if(msgNow&&race.t>msgNow.until)msgNow=null;
        const el=q('[data-race-msg]');setText(el,msgNow?msgNow.text:'');el.hidden=!msgNow;}
      focusClassification(q('[data-race-order]'),own.laps);
      q('[data-race-speed]').textContent=Math.round(own.v*3.6);q('[data-race-gear]').textContent=view.S.gear||'N';
      if(own.stops!==lastStops){lastStops=own.stops;setLapStart=own.laps+Math.max(0,(mod(own.p,L))/L);}
      const onSet=Math.max(0,own.laps+Math.max(0,mod(own.p,L)/L)-setLapStart),rate=onSet>.4?own.wear/onSet:null,err=payload.tyre_err,laps=rate&&rate>0?Math.max(0,(.72-own.wear)/rate):null,left=err==null||laps==null?null:err<.02?Math.floor(laps):Math.max(0,Math.floor(laps*(1-err)))+'–'+Math.max(1,Math.ceil(laps*(1+err)));
      const water=M.RACE.waterAt(race.cfg,race.t),rain=water>.05;
      const html=`<div class="ap-wheel-meta"><span>⛽ ${own.fuel.toFixed(1)} kg</span><span>${rain?'🌧️ '+water.toFixed(1)+' mm':'☀️'}</span></div>
        ${tyreHudHtml({compound:own.compound,wear:FACT.map(f=>own.wear*f),remaining:true},t)}
        ${left==null?'':`<div class="ap-wheel-footer"><span>${esc(t('ap_rt_left',{n:left}))}</span></div>`}`;
      const box=q('[data-race-tyres]');if(box._html!==html){box.innerHTML=html;box._html=html;}
      if(race.t-weatherAt>3){weatherAt=race.t;{const hf=(payload.hour||12)+race.t/3600,w=q('[data-race-wx]'),h=weatherShort(M,payload.forecast,hf,t,10,payload.wx_half);if(w._h!==h){w.innerHTML=h;w._h=h;}}view.setConditions(M.SIM.condAt(payload.forecast,(payload.hour||12)+race.t/3600),(payload.hour||12)+race.t/3600);}
      q('[data-race-box]').disabled=race.commands.some(x=>x.t>race.t)||pending||!!own.request||own.pit||!!own.dnf||own.finish!==null||race.done;
      q('[data-race-box]').textContent=own.pit?t('ap_pit_lane'):own.request?t('ap_box_armed'):t('ap_box');
      q('[data-race-through]').disabled=q('[data-race-box]').disabled||!!pitDialog;
      const canvas=q('[data-race-map]'),g=canvas.getContext('2d'),scale=Math.min(150/(bounds.maxX-bounds.minX),100/(bounds.maxY-bounds.minY)),xy=p=>[10+(p.x-bounds.minX)*scale,110-(p.y-bounds.minY)*scale];
      g.clearRect(0,0,170,120);g.strokeStyle='#c2cad7';g.lineWidth=2;g.beginPath();for(let i=0;i<track.N;i+=4){const [x,y]=xy({x:track.x[i],y:track.y[i]});i?g.lineTo(x,y):g.moveTo(x,y);}g.closePath();g.stroke();for(const c of race.cars){if(c===own)continue;const [x,y]=xy(pose(c));g.fillStyle=c.dnf?'#888':c.e.mine?'#ffd166':c.pit?'rgba(111,168,255,.55)':'#6fa8ff';g.beginPath();g.arc(x,y,3.6,0,7);g.fill();g.strokeStyle='rgba(8,12,20,.9)';g.lineWidth=1.2;g.stroke();}{const [x,y]=xy(pose(own));g.fillStyle='rgba(255,76,84,.28)';g.beginPath();g.arc(x,y,9+2*Math.sin(performance.now()/260),0,7);g.fill();g.fillStyle='#ff3b3b';g.beginPath();g.arc(x,y,5.2,0,7);g.fill();g.strokeStyle='#fff';g.lineWidth=2;g.stroke();}
    }
    checkpoint();
    if(race.done&&!reported){closePitDialog();checkpoint(true);reported=true;onFinish({race_commands:race.commands,laps:race.player_laps,duration:race.t-6,dnf:own.dnf});}
  }
  view.onTick=draw;draw(.01);
  return {race,pause(){paused=true;engine?.update({playing:false});},resume(){paused=false;engine?.resume();},destroy(){checkpoint(true);dead=true;closePitDialog();window.removeEventListener('pagehide',flushProgress);document.removeEventListener('visibilitychange',flushProgress);engine?.destroy();view.destroy();},showResult(m){
    if(shown)return;try{localStorage.removeItem(checkpointKey);}catch(_){}shown=m;paused=true;engine?.update({playing:false});
    const ov=document.createElement('div');ov.className='ap-sum';ov.innerHTML=`<div class="ap-sum-in"><h2>${esc(t('ap_race_result'))} · ${esc(t('ap_round',{n:m.weekend.round}))}</h2><div class="ap-sum-top"><div class="ap-big"><small>${esc(t('ap_prize'))}</small><b>+${money(m.reward)}</b></div><div class="ap-big"><small>${esc(t('ap_points'))}</small><b>${m.weekend.points}</b></div><div class="ap-big"><small>${esc(t('ap_spent_h'))}</small><b>−${money(m.cost)}</b></div></div>${m.cars?`<div class="ap-sum-cars">${Object.entries(m.cars).map(([k,c])=>`<div><b>${esc(payload.entries?.[k]?.name||k)}</b><span>P${c.position}</span><small>+${money(c.reward)}</small></div>`).join('')}</div>`:''}${classificationHtml(m.weekend.classification,t,time)}<p class="ap-hint">${esc(t('ap_recovery_rule'))}</p><button class="ap-btn" data-race-return>${esc(t('ap_to_season'))}</button></div>`;
    q('.ap-view').appendChild(ov);ov.querySelector('[data-race-return]').onclick=()=>onGarage();
  }};
}
