// Pit crew drills have their own controls and scenes. Raw measurements are scored
// by the server using the settings frozen when the attempt starts.
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const MECHANICS = { wheel_service: wheel, jack_balance: jack, repair_wiring: repair, release_gap: release };

export function run(game, box, tr, done, opts = {}) {
  const cfg = opts.settings;
  if (!cfg || !MECHANICS[game]) throw new Error('Missing pit crew drill settings');
  box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'ap-tg-wrap ap-crew-drill';
  const canvas = document.createElement('canvas'); canvas.className = 'ap-tg-canvas';
  canvas.style.touchAction = 'none'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', tr('ap_trd_crew_' + ({wheel_service:'wheel',jack_balance:'jack',repair_wiring:'repair',release_gap:'release'}[game])));
  const start = document.createElement('button'); start.className = 'ap-btn'; start.textContent = tr('ap_train');
  wrap.append(canvas, start); box.append(wrap);
  const g = canvas.getContext('2d'), W = 400, H = 350;
  const fit = () => { const w = Math.min(wrap.clientWidth || 400, 520), dpr = Math.min(2, window.devicePixelRatio || 1); canvas.style.width=w+'px';canvas.style.height=w*H/W+'px';canvas.width=w*dpr;canvas.height=w*H/W*dpr; };
  fit(); const resize = new ResizeObserver(fit); resize.observe(wrap);
  let raf=0, dead=false, started=false, finished=false, round=0, time=0, previous=performance.now(), drill=null;
  const results=[], listeners=[];
  const listen=(target,type,fn)=>{target.addEventListener(type,fn);listeners.push(()=>target.removeEventListener(type,fn));};
  const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};};
  const label=(text,x,y,size=16,color='#ecf2fc')=>{g.font=`600 ${size}px ${FONT}`;g.textAlign='center';g.textBaseline='middle';g.fillStyle=color;g.fillText(String(text),x,y);};
  const line=(points,color,width)=>{g.beginPath();points.forEach((p,i)=>i?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y));g.strokeStyle=color;g.lineWidth=width;g.lineCap='round';g.lineJoin='round';g.stroke();};
  const circle=(x,y,r,color)=>{g.beginPath();g.arc(x,y,r,0,TAU);g.fillStyle=color;g.fill();};
  const api={g,cfg,label,line,circle,clock:()=>time,active:()=>started&&!finished&&!document.querySelector('dialog.ap-message[open]'),capture:e=>canvas.setPointerCapture(e.pointerId)};
  const next=()=>{time=0;drill=MECHANICS[game](api,round);};
  next();
  start.onclick=()=>{if(started)return;started=true;start.remove();canvas.focus();previous=performance.now();};
  listen(canvas,'pointerdown',e=>{if(!api.active())return;e.preventDefault();drill.down?.(point(e),e);});
  listen(canvas,'pointermove',e=>{if(api.active())drill.move?.(point(e),e);});
  listen(canvas,'pointerup',e=>{drill.up?.(point(e));});
  listen(canvas,'pointercancel',()=>drill.cancel?.());
  listen(canvas,'lostpointercapture',()=>drill.cancel?.());
  listen(canvas,'contextmenu',e=>e.preventDefault());
  listen(window,'keydown',e=>{if(!api.active()||document.activeElement!==canvas)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','Enter'].includes(e.code)){e.preventDefault();drill.key?.(e.code,true,e.repeat);}});
  listen(window,'keyup',e=>drill.key?.(e.code,false,false));
  listen(window,'blur',()=>drill.cancel?.());
  const frame=now=>{
    if(dead)return;
    const dt=Math.min(.05,Math.max(0,(now-previous)/1000));previous=now;
    if(api.active()){
      time=Math.min(cfg.roundSeconds,time+dt);drill.tick?.(dt);
      if(time>=cfg.roundSeconds-1e-8){results.push(drill.result());round++;if(round>=cfg.rounds){finished=true;done({version:1,rounds:results});if(dead)return;}else next();}
    }
    g.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
    g.fillStyle='#111c2a';g.fillRect(0,0,W,H);
    g.fillStyle='#26364a';g.fillRect(20,16,360,7);g.fillStyle='#5cbdff';g.fillRect(20,16,360*(time/cfg.roundSeconds),7);
    label(tr('ap_crew_drill_round',{n:Math.min(round+1,cfg.rounds),total:cfg.rounds}),200,43,15,'#bdcce0');
    drill.draw();
    if(!started){g.fillStyle='#111c2abf';g.fillRect(0,65,W,H-65);label('🔧',200,165,55);}
    raf=requestAnimationFrame(frame);
  };
  raf=requestAnimationFrame(frame);
  return {destroy(){if(dead)return;dead=true;cancelAnimationFrame(raf);resize.disconnect();listeners.forEach(f=>f());drill.cancel?.();}};
}

// Rotate a wheel gun around the hub and release at one full turn. Radial
// wandering and overshooting torque both count; the handle works with touch.
function wheel(a) {
  const {g,cfg,label,circle}=a, hub={x:200,y:192}, radius=82;
  let held=false, angle=0, last=0, radial=0, count=0, released=false, seconds=5, turning=false;
  function turn(p){
    const current=Math.atan2(p.y-hub.y,p.x-hub.x);
    let delta=current-last;if(delta>Math.PI)delta-=TAU;if(delta<-Math.PI)delta+=TAU;
    // Ignore discontinuous pointer jumps instead of counting them as turns.
    if(Math.abs(delta)<.7)angle=Math.max(0,angle+delta);
    radial+=Math.abs(Math.hypot(p.x-hub.x,p.y-hub.y)-radius);count++;last=current;
  }
  function finish(){if(!held||released)return;held=false;released=true;turning=false;seconds=a.clock();}
  return {
    down(p,e){if(released)return;const dist=Math.hypot(p.x-hub.x,p.y-hub.y);if(Math.abs(dist-radius)>45)return;held=true;last=Math.atan2(p.y-hub.y,p.x-hub.x);a.capture(e);},
    move(p){if(held&&!released)turn(p);}, up:finish,
    cancel(){held=false;turning=false;},
    key(code,on){if(code!=='ArrowRight'||released)return;if(on){held=true;turning=true;}else finish();},
    tick(dt){if(turning){angle+=dt*2.4;count++;}},
    result:()=>({released,angle,radial:count?radial/count:999,seconds}),
    draw(){
      circle(200,192,111,'#080e16');circle(200,192,97,'#33445b');circle(200,192,68,'#142235');
      for(let i=0;i<6;i++){const t=i*TAU/6;circle(200+Math.cos(t)*49,192+Math.sin(t)*49,8,'#a9bacd');}
      g.beginPath();g.arc(200,192,radius,-Math.PI/2,-Math.PI/2+Math.min(TAU,angle));g.strokeStyle='#6ee4ae';g.lineWidth=11;g.stroke();
      const t=angle-Math.PI/2;circle(200+Math.cos(t)*radius,192+Math.sin(t)*radius,16,'#ffd166');
      g.strokeStyle='#f0f6ff';g.lineWidth=3;g.beginPath();g.moveTo(200,92);g.lineTo(200,120);g.stroke();
      label(Math.round(angle/TAU*100)+'%',200,192,25);
      label(released?(Math.abs(angle-TAU)<cfg.wheelTolerance?'✓':'✕'):'↻',200,320,25,released?'#ffd166':'#d4e4f7');
    }
  };
}

// Pump a real lever through full downward strokes. Pressure leaks, so rapid
// pumping can overshoot the safe band; keep the chassis up rather than spam.
function jack(a) {
  const {g,cfg,label,line}=a;
  let held=false, stroke=false, lever=0, pressure=0, stable=0, streak=0, strokes=0, keyboard=false;
  const pump=()=>{pressure=clamp(pressure+cfg.jackCharge,0,1.25);strokes++;};
  function move(p){if(!held)return;const next=clamp((p.y-123)/130,0,1);if(!stroke&&next>.85){pump();stroke=true;}if(next<.15)stroke=false;lever=next;}
  return {
    down(p,e){if(p.x<245||p.x>365)return;held=true;a.capture(e);move(p);},move,
    up(){held=false;lever=0;stroke=false;},cancel(){held=false;keyboard=false;lever=0;stroke=false;},
    key(code,on,repeat){if(code!=='ArrowDown'&&code!=='ArrowUp')return;if(code==='ArrowDown'&&on&&!repeat&&!keyboard){pump();lever=1;keyboard=true;}if(code==='ArrowUp'&&on||code==='ArrowDown'&&!on){keyboard=false;lever=0;}},
    tick(dt){pressure=Math.max(0,pressure-cfg.jackLeak*dt);if(Math.abs(pressure-.78)<=cfg.jackBand/2){streak+=dt;stable=Math.max(stable,streak);}else streak=0;},
    result:()=>({stable,strokes,seconds:cfg.roundSeconds}),
    draw(){
      const carY=255-Math.min(1,pressure)*85;
      g.fillStyle='#d94a3b';g.fillRect(35,carY-30,160,35);g.fillStyle='#111';g.fillRect(50,carY-15,25,32);g.fillRect(155,carY-15,25,32);
      line([{x:110,y:285},{x:110,y:carY+9}],'#a8bbd4',12);g.fillStyle='#647c9b';g.fillRect(75,280,75,14);
      line([{x:250,y:285},{x:320,y:123+lever*130}],'#ffd166',9);
      g.fillStyle='#26364a';g.fillRect(205,90,23,200);
      const top=290-(.78+cfg.jackBand/2)*160, height=cfg.jackBand*160;
      g.fillStyle='#258963';g.fillRect(200,top,33,height);
      g.fillStyle='#f5f8ff';g.fillRect(201,290-pressure*160-2,31,4);
      label('↕',325,90,28,'#ffd166');label(Math.round(stable/cfg.jackHold*100)+'%',110,325,23,stable>=cfg.jackHold?'#70edb4':'#edf3ff');
    }
  };
}

const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy),0,1);return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
// Route a replacement wire through a protected channel in a damaged panel.
// Every elbow must be visited in order; shortcuts and shorts are measured.
function repair(a,index) {
  const {g,cfg,label,line,circle}=a;
  const x=135+Math.random()*100,y=110+Math.random()*50;
  const path=index%2 ? [{x:45,y:260},{x,y:260},{x,y},{x:355,y}] : [{x:45,y:110},{x,y:110},{x,y:250},{x:355,y:250}];
  let held=false,connected=false,visited=0,trace=[],deviation=0,travel=0,faults=0,seconds=5,cursor={...path[0]},keys={};
  function feed(p){
    if(!held||connected)return;
    const prev=trace[trace.length-1];const dist=Math.hypot(p.x-prev.x,p.y-prev.y);
    // Integrate along the segment, including between sparse mobile events.
    const steps=Math.max(1,Math.ceil(dist/4));
    for(let i=1;i<=steps;i++){
      const q={x:prev.x+(p.x-prev.x)*i/steps,y:prev.y+(p.y-prev.y)*i/steps};
      const d=Math.min(...path.slice(1).map((end,j)=>segmentDistance(q,path[j],end)));
      deviation+=Math.max(0,d-cfg.wireWidth*.35)*dist/steps;travel+=dist/steps;
      if(d>cfg.wireWidth)faults+=dist/steps/40;
      if(visited<path.length&&Math.hypot(q.x-path[visited].x,q.y-path[visited].y)<cfg.wireWidth)visited++;
    }
    trace.push({...p});cursor={...p};
    if(visited===path.length&&Math.hypot(p.x-path.at(-1).x,p.y-path.at(-1).y)<24){connected=true;seconds=a.clock();held=false;}
  }
  const begin=()=>{if(connected)return;held=true;visited=1;trace=[{...path[0]}];deviation=0;travel=0;};
  return {
    down(p,e){if(!connected&&Math.hypot(p.x-path[0].x,p.y-path[0].y)<32){begin();a.capture(e);}},
    move:feed,up(){if(held){held=false;faults++;}},cancel(){held=false;keys={};},
    key(code,on,repeat){if(code.startsWith('Arrow'))keys[code]=on;if((code==='Space'||code==='Enter')&&on&&!repeat){cursor={...path[0]};begin();}},
    tick(dt){if(!held)return;const p={x:clamp(cursor.x+((keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0))*160*dt,20,380),y:clamp(cursor.y+((keys.ArrowDown?1:0)-(keys.ArrowUp?1:0))*160*dt,75,290)};if(p.x!==cursor.x||p.y!==cursor.y)feed(p);},
    result:()=>({connected,deviation:travel?deviation/travel:999,faults,seconds}),
    draw(){
      g.fillStyle='#243548';g.fillRect(20,75,360,220);
      line(path,'#0a121e',cfg.wireWidth*2+9);line(path,'#39735f',cfg.wireWidth*2);line(path,'#8eb1a2',2);
      if(trace.length>1)line(trace,'#ffd166',6);
      circle(path[0].x,path[0].y,19,'#3d86c6');circle(path.at(-1).x,path.at(-1).y,19,connected?'#2aba83':'#3d86c6');
      label('A',path[0].x,path[0].y);label('B',path.at(-1).x,path.at(-1).y);
      label(connected?'✓':'A → B',200,322,24,connected?'#70edb4':'#dceaff');
    }
  };
}

// Judge wheel crew readiness AND live pit-lane traffic. Cars keep moving;
// releasing simply because the mechanics are ready can cause a collision.
function release(a) {
  const {g,cfg,label,circle}=a;
  const readyAt=[1.3+Math.random()*.45,1.4+Math.random()*.45,1.2+Math.random()*.5,1.5+Math.random()*.4];
  const allReady=Math.max(...readyAt), safeStart=allReady+.12;
  const arrivals=[.6,1.1,safeStart-cfg.releaseGap,safeStart+cfg.releaseWindow+cfg.releaseGap,4.9];
  let pressed=false,ready=false,gap=0,delay=0,seconds=5;
  const gapAt=t=>Math.min(...arrivals.map(at=>Math.abs(t-at)));
  const press=()=>{if(pressed)return;pressed=true;seconds=a.clock();ready=seconds>=allReady;gap=gapAt(seconds);delay=seconds-safeStart;};
  return {
    down(p){if(p.y>210)press();},key(code,on,repeat){if(on&&!repeat&&(code==='Space'||code==='Enter'))press();},
    result:()=>({ready,gap,delay,seconds}),
    draw(){
      const t=a.clock(),safe=t>=safeStart&&gapAt(t)>=cfg.releaseGap;
      g.fillStyle='#344255';g.fillRect(0,98,400,86);g.strokeStyle='#bdc9da';g.lineWidth=2;g.setLineDash([14,14]);g.beginPath();g.moveTo(0,140);g.lineTo(400,140);g.stroke();g.setLineDash([]);
      for(const at of arrivals){const x=200+(t-at)*190;g.fillStyle='#5bb8ef';g.fillRect(x-28,116,56,25);g.fillStyle='#060b12';g.fillRect(x-20,110,12,9);g.fillRect(x+10,138,12,9);}
      g.strokeStyle='#ffd166';g.lineWidth=3;g.beginPath();g.moveTo(200,180);g.lineTo(200,238);g.stroke();
      g.fillStyle=pressed&&ready&&gap>=cfg.releaseGap&&delay>=0?'#36ba8e':'#e34e42';g.fillRect(180,235,40,65);
      readyAt.forEach((at,i)=>{const x=i%2?238:162,y=i<2?244:285;circle(x,y,12,t>=at?'#5be8a8':'#627289');label(t>=at?'✓':'…',x,y,14,'#101b29');});
      label(pressed?(ready&&gap>=cfg.releaseGap&&delay>=0?'✓':'✕'):(safe?'↑':'⏸'),200,326,25,pressed?'#ffd166':safe?'#75e9b1':'#f0c793');
    }
  };
}
