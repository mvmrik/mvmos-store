const { render, on } = window.RacelandiaUI;
// Physical spectator facilities; the server validates space, derives capacity and prices the draft.
const TYPES=['seated','free','vip'];
export const sizeOf=s=>({depth:s.rows*({seated:.85,free:1,vip:4}[s.kind])+(s.kind==='seated'?3:0),capacity:s.kind==='seated'?Math.floor(s.length/.5)*s.rows:s.kind==='free'?Math.floor(s.length*s.rows*2):Math.floor(s.length/2)*s.rows});
export function openVenueEditor({host,G,api,t,esc,money,onDone,onCancel}){
 const own=G.own,land=own.venue_bounds;
 let layout=(own.grandstands||[]).map(s=>({...s})),selected=null,mode='select',kind='seated',drag=null,dead=false,saving=false,dirty=false,quote=null,timer=0,revision=0;
 let cx=0,cy=0,scale=1;
 render(host, `<div class="ap-garage ap-venue"><div class="ap-col"><div class="ap-card"><div class="ap-bar"><h2>${esc(t('ap_venue_title'))}</h2><button class="ap-btn ap-ghost" data-venue-cancel>${esc(t('ap_cancel'))}</button></div><p class="ap-hint">${esc(t('ap_venue_hint'))}</p>
 <div class="ap-venue-tools"><button class="ap-btn ap-sm" data-mode="select">${esc(t('ap_venue_select'))}</button><button class="ap-btn ap-sm ap-ghost" data-mode="pan">${esc(t('ap_venue_pan'))}</button><button class="ap-btn ap-sm ap-ghost" data-fit>${esc(t('ap_venue_fit'))}</button><button class="ap-btn ap-sm ap-ghost" data-zoom=".8" aria-label="${esc(t('ap_venue_zoom_out'))}">−</button><button class="ap-btn ap-sm ap-ghost" data-zoom="1.25" aria-label="${esc(t('ap_venue_zoom_in'))}">+</button></div>
 <canvas class="ap-venue-map" aria-label="${esc(t('ap_venue_title'))}" tabindex="0"></canvas><p class="ap-hint" data-venue-status role="status" aria-live="polite"></p></div></div>
 <div class="ap-col"><div class="ap-card"><h2>${esc(t('ap_tb_stands'))}</h2><div class="ap-venue-tools">${TYPES.map(k=>`<button class="ap-btn ap-sm ap-ghost" data-kind="${k}">${esc(t('ap_tb_'+k))}</button>`).join('')}</div><p class="ap-hint">${esc(t('ap_venue_add_hint'))}</p><div data-venue-selection></div></div>
 <div class="ap-card"><h2>${esc(t('ap_venue_plan'))}</h2><div data-venue-quote></div><p class="ap-hint">${esc(t('ap_venue_economy'))}</p>${!('grandstands' in own)&&Object.values(own.seats||{}).some(v=>v>0)?`<p class="ap-hint">${esc(t('ap_venue_legacy'))}</p>`:''}<button class="ap-btn ap-venue-save" data-venue-save disabled>${esc(t('ap_venue_save'))}</button></div></div></div>`);
 const canvas=host.querySelector('canvas'),ctx=canvas.getContext('2d'),status=host.querySelector('[data-venue-status]'),details=host.querySelector('[data-venue-selection]'),totals=host.querySelector('[data-venue-quote]'),save=host.querySelector('[data-venue-save]');
 const world=(x,y)=>[cx+(x-canvas.clientWidth/2)/scale,cy-(y-canvas.clientHeight/2)/scale];
 const screen=(x,y)=>[(x-cx)*scale+canvas.clientWidth/2,(cy-y)*scale+canvas.clientHeight/2];
 const rect=(s,fill,stroke)=>{const d=sizeOf(s).depth;ctx.save();const[x,y]=screen(s.x,s.y);ctx.translate(x,y);ctx.rotate(-s.angle);ctx.fillStyle=fill;ctx.strokeStyle=stroke;ctx.lineWidth=s.id===selected?3:1.5;ctx.fillRect(-s.length*scale/2,-d*scale/2,s.length*scale,d*scale);ctx.strokeRect(-s.length*scale/2,-d*scale/2,s.length*scale,d*scale);if(s.kind==='seated'){ctx.beginPath();for(let i=1;i<Math.min(s.rows,30);i++){const py=-d*scale/2+i*d*scale/Math.min(s.rows,30);ctx.moveTo(-s.length*scale/2,py);ctx.lineTo(s.length*scale/2,py);}ctx.stroke();}ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-Math.min(16,d*scale/2+8));ctx.stroke();ctx.restore();};
 function draw(){
  if(dead)return;const w=canvas.clientWidth,h=canvas.clientHeight,dpr=Math.min(2,devicePixelRatio||1);canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);
  const cs=getComputedStyle(host),fg=cs.getPropertyValue('--fg').trim()||'#edf1f8';ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(80,140,80,.12)';ctx.fillRect(0,0,w,h);
  const spacing=Math.pow(10,Math.ceil(Math.log10(60/scale))),[left,bottom]=world(0,h),[right,top]=world(w,0);ctx.strokeStyle='#8883';ctx.lineWidth=1;ctx.beginPath();
  for(let x=Math.ceil(left/spacing)*spacing;x<=right;x+=spacing){const[sx]=screen(x,0);ctx.moveTo(sx,0);ctx.lineTo(sx,h);}for(let y=Math.ceil(bottom/spacing)*spacing;y<=top;y+=spacing){const[,sy]=screen(0,y);ctx.moveTo(0,sy);ctx.lineTo(w,sy);}ctx.stroke();
  if(land){const[a,b]=screen(land.min_x,land.max_y),[c,d]=screen(land.max_x,land.min_y);ctx.strokeStyle=fg;ctx.setLineDash([6,5]);ctx.lineWidth=2;ctx.strokeRect(a,b,c-a,d-b);ctx.setLineDash([]);}
  const line=(color,width)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.beginPath();own.points.forEach((p,i)=>{const[x,y]=screen(...p);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();ctx.stroke();};
  line('#8884',(own.width+2*((own.runoff||18)+3))*scale);line('#424b55',Math.max(2,own.width*scale));
  const pi=Math.round((own.start||0)*own.points.length/Math.max(1,Math.round(own.length/3)))%own.points.length,a=own.points[(pi+own.points.length-5)%own.points.length],b=own.points[(pi+5)%own.points.length];
  const pit={id:'pit',kind:'free',x:own.points[pi][0],y:own.points[pi][1],angle:Math.atan2(b[1]-a[1],b[0]-a[0]),length:750,rows:150};rect(pit,'#ad7d2820','#ad7d2866');
  for(const s of layout)rect(s,{seated:'#3281b699',free:'#5d9c6599',vip:'#b7823899'}[s.kind],s.id===selected?(quote?.ok===false?'#df4c4c':fg):'#526577');
  const metres=Math.pow(10,Math.floor(Math.log10(100/scale)));ctx.fillStyle=fg;ctx.fillRect(12,h-16,metres*scale,3);ctx.font='11px sans-serif';ctx.fillText(metres.toLocaleString()+' m',12,h-22);
 }
 function fit(){const pts=own.points.concat(land?[[land.min_x,land.min_y],[land.max_x,land.max_y]]:[]).concat(layout.flatMap(s=>{const r=Math.hypot(s.length,sizeOf(s).depth)/2;return [[s.x-r,s.y-r],[s.x+r,s.y+r]];}));const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);cx=(x0+x1)/2;cy=(y0+y1)/2;scale=Math.min(canvas.clientWidth/(x1-x0+250),canvas.clientHeight/(y1-y0+250));draw();}
 function picked(x,y){return [...layout].reverse().find(s=>{const dx=x-s.x,dy=y-s.y,c=Math.cos(s.angle),n=Math.sin(s.angle);return Math.abs(dx*c+dy*n)<=s.length/2+6/scale&&Math.abs(-dx*n+dy*c)<=sizeOf(s).depth/2+6/scale;});}
 function setMode(next){mode=next;host.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('ap-ghost',b.dataset.mode!==mode));host.querySelectorAll('[data-kind]').forEach(b=>b.classList.toggle('ap-ghost',mode!=='add'||b.dataset.kind!==kind));canvas.style.cursor=mode==='pan'?'grab':mode==='add'?'crosshair':'default';status.textContent=t(mode==='add'?'ap_venue_place':mode==='pan'?'ap_venue_pan_hint':'ap_venue_hint');}
 function selection(){
  const s=layout.find(s=>s.id===selected);if(!s){render(details, `<p class="ap-hint">${esc(t('ap_venue_none'))}</p>`);return;}
  render(details, `<b>${esc(t('ap_tb_'+s.kind))}</b><div class="ap-venue-fields">${[['length','ap_venue_length',s.length,4,.5],['rows',s.kind==='free'?'ap_venue_depth':'ap_venue_rows',s.rows,1,1],['angle','ap_venue_angle',Math.round(s.angle*180/Math.PI),null,1]].map(([k,label,v,min,step])=>`<label><span>${esc(t(label))}</span><input type="number" data-field="${k}" ${min===null?'':`min="${min}"`} step="${step}" value="${v}"></label>`).join('')}</div><p class="ap-hint" data-footprint></p><div class="ap-venue-tools"><button class="ap-btn ap-sm ap-ghost" data-copy>${esc(t('ap_venue_copy'))}</button><button class="ap-btn ap-sm ap-ghost" data-remove>${esc(t('ap_venue_remove'))}</button></div>`);
  details.querySelectorAll('[data-field]').forEach(input=>input.oninput=()=>{const v=Number(input.value);if(!Number.isFinite(v))return;s[input.dataset.field]=input.dataset.field==='angle'?v*Math.PI/180:Math.max(input.dataset.field==='rows'?1:4,input.dataset.field==='rows'?Math.floor(v):v);footprint();changed();});
  details.querySelector('[data-remove]').onclick=()=>{layout=layout.filter(x=>x!==s);selected=null;selection();changed();};
  details.querySelector('[data-copy]').onclick=()=>{const copy={...s,id:uid(),x:s.x+Math.cos(s.angle)*(s.length+4),y:s.y+Math.sin(s.angle)*(s.length+4)};layout.push(copy);selected=copy.id;selection();changed();};footprint();
 }
 function footprint(){const s=layout.find(s=>s.id===selected),el=details.querySelector('[data-footprint]');if(s&&el){const d=sizeOf(s);el.textContent=t('ap_venue_capacity',{n:d.capacity.toLocaleString(),w:s.length.toLocaleString(),d:d.depth.toLocaleString()});}}
 function paintQuote(){
  if(!quote){render(totals, `<p class="ap-hint">${esc(t('ap_venue_checking'))}</p>`);save.disabled=true;return;}
  if(!quote.ok){render(totals, `<p class="ap-warn">${esc(t('ap_venue_err_'+quote.error))}</p>`);save.disabled=true;return;}
  const rows=[...TYPES.map(k=>[t('ap_tb_'+k),quote.seats[k].toLocaleString()]),[t('ap_venue_build_cost'),money(quote.price)],[t('ap_tb_upkeep'),money(quote.upkeep)],[t('ap_tb_income'),money(quote.host.income.total)]];
  render(totals, `<div class="ap-cond">${rows.map(([a,b])=>`<div><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('')}</div>${quote.price>G.driver.budget?`<p class="ap-warn">${esc(t('ap_no_budget'))}</p>`:''}`);
  save.disabled=saving||!dirty||quote.price>G.driver.budget;
 }
 const uid=()=> 'stand-'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
 function changed(){dirty=true;quote=null;revision++;clearTimeout(timer);paintQuote();draw();timer=setTimeout(check,180);}
 async function check(){const seq=revision;try{const r=await api('/track/stands/quote',{grandstands:layout});if(dead||seq!==revision)return;quote=r.ok?r.d:{ok:false,error:'stand_invalid'};}catch(_){if(dead||seq!==revision)return;quote={ok:false,error:'stand_invalid'};}paintQuote();draw();}
 const point=e=>{const r=canvas.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
 canvas.onpointerdown=e=>{if(saving)return;canvas.focus({preventScroll:true});const p=point(e),w=world(...p);if(mode==='add'){const s={id:uid(),kind,x:w[0],y:w[1],angle:0,length:40,rows:kind==='vip'?2:10};layout.push(s);selected=s.id;setMode('select');selection();changed();return;}if(mode==='pan'){drag={pan:true,x:p[0],y:p[1],cx,cy};}else{const s=picked(...w);selected=s?.id||null;selection();draw();if(s)drag={id:s.id,x:w[0],y:w[1],ox:s.x,oy:s.y};}if(drag)canvas.setPointerCapture(e.pointerId);};
 canvas.onpointermove=e=>{if(!drag||saving)return;const p=point(e);if(drag.pan){cx=drag.cx-(p[0]-drag.x)/scale;cy=drag.cy+(p[1]-drag.y)/scale;draw();}else{const s=layout.find(s=>s.id===drag.id),w=world(...p);s.x=drag.ox+w[0]-drag.x;s.y=drag.oy+w[1]-drag.y;changed();}};
 canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
 canvas.onwheel=e=>{e.preventDefault();const p=point(e),before=world(...p);scale=Math.max(1e-5,Math.min(20,scale*(e.deltaY<0?1.15:1/1.15)));const after=world(...p);cx+=before[0]-after[0];cy+=before[1]-after[1];draw();};
 host.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));host.querySelectorAll('[data-kind]').forEach(b=>b.onclick=()=>{kind=b.dataset.kind;setMode('add');});
 host.querySelector('[data-fit]').onclick=fit;host.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{scale=Math.max(1e-5,Math.min(20,scale*+b.dataset.zoom));draw();});
 host.querySelector('[data-venue-cancel]').onclick=()=>{if(!saving)onCancel();};
 save.onclick=async()=>{if(save.disabled||!quote?.ok)return;saving=true;host.querySelectorAll('button,input').forEach(e=>e.disabled=true);try{const r=await api('/track/stands',{grandstands:layout});if(r.ok){onDone(r.d);return;}if(!dead)status.textContent=t(r.d.error==='budget'?'ap_no_budget':r.d.error==='busy'?'ap_active_run_hint':'ap_venue_err_'+r.d.error);}catch(_){if(!dead)status.textContent=t('ap_venue_err_stand_invalid');}finally{saving=false;if(!dead){host.querySelectorAll('button,input').forEach(e=>e.disabled=false);paintQuote();}}};
 const observer=new ResizeObserver(draw);observer.observe(canvas);setMode('select');selection();requestAnimationFrame(()=>{if(!dead){fit();check();}});
 return {destroy(){dead=true;clearTimeout(timer);observer.disconnect();}};
}
