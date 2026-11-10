(function(){
'use strict';
if(window.MvmPlayer)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>{n=Math.max(0,Math.floor(Number(n)||0));return(n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
function mount(host,options={}){
 host.classList.add('mp-host');
 let lang=window.mvmOS?.lang||document.documentElement.lang||'en';
 const t=k=>(window.MP_I18N[lang]||window.MP_I18N.en)[k]||window.MP_I18N.en[k]||k;
 const token=()=>localStorage.getItem('apphub_token')||'';
 const base='/pub/mvmplayer',adminBase='/api/apps/mvmplayer';
 const s={items:[],collections:[],tab:'home',query:'',category:'',status:'all',sort:'recent',manage:false,admin:false,current:null,ready:false,played:false,load:0,dead:false,autoNext:false,collection:''};
 let modal=null,toastTimer,lastSave=0,saveChain=Promise.resolve(),subtitleUrl='',tempSubtitleUrl='',lastFocus=null,selectedSubtitle='';
 const root=document.createElement('div');root.className='mp'+(options.desktop?' in-os':'');host.appendChild(root);
 const navs=['home','movies','series','videos','favorites','history','collections'];
 const glyphs={home:'⌂',movies:'▣',series:'▤',videos:'▷',favorites:'♡',history:'◷',collections:'☷'};
 root.innerHTML=`<aside class="mp-side"><div class="mp-brand"><span>▶</span>mvmPlayer</div><small data-library-label></small><nav>${navs.map(k=>`<button data-tab="${k}"><i>${glyphs[k]}</i><span>${esc(t(k))}</span></button>`).join('')}</nav><div class="mp-side-note">${esc(t('directHint'))}</div></aside><section class="mp-work"><header class="mp-top"><input type="search" data-search placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}"><div data-top-actions></div></header><section class="mp-stage" hidden><div class="mp-now"><div><strong data-now-title></strong><span data-now-meta></span></div><button data-close-player aria-label="${esc(t('closePlayer'))}">✕</button></div><div class="mp-screen"><video controls playsinline preload="metadata"></video><p class="mp-video-error" role="alert" hidden></p></div><div class="mp-tools"><button data-back-ten title="${esc(t('backTen'))}">−10 s</button><button data-forward-ten title="${esc(t('forwardTen'))}">+10 s</button><label>${esc(t('speed'))}<select data-speed>${[0.5,0.75,1,1.25,1.5,1.75,2].map(n=>`<option value="${n}" ${n===1?'selected':''}>${n}×</option>`).join('')}</select></label><label>${esc(t('subtitles'))}<select data-subtitles><option value="">${esc(t('off'))}</option></select></label><button data-pip class="mp-icon" title="${esc(t('pip'))}" aria-label="${esc(t('pip'))}">⧉</button><button data-fullscreen class="mp-icon" title="${esc(t('fullscreen'))}" aria-label="${esc(t('fullscreen'))}">⛶</button><label class="mp-check"><input type="checkbox" data-auto-next>${esc(t('autoNext'))}</label><button data-next>${esc(t('next'))} →</button></div></section><main class="mp-main" tabindex="-1"></main></section><div class="mp-toast" role="status" hidden></div>`;
 const main=root.querySelector('main'),stage=root.querySelector('.mp-stage'),video=root.querySelector('video'),toastNode=root.querySelector('.mp-toast');
 const coverCache=new Map();let coverCount=0,subtitleGeneration=0;
 const pct=value=>Number(value||0).toLocaleString(lang,{maximumFractionDigits:1})+'%';
 const bytes=value=>value>=1073741824?(value/1073741824).toLocaleString(lang,{maximumFractionDigits:2})+' GB':(value/1048576).toLocaleString(lang,{maximumFractionDigits:1})+' MB';
 const languageName=code=>{try{return new Intl.DisplayNames([lang],{type:'language'}).of(code)}catch{return code}};
 const button=(key,attrs='',cls='')=>`<button type="button" class="mp-btn ${cls}" ${attrs}>${esc(t(key))}</button>`;
 const subtitleMeta=i=>[i.kind==='episode'?`${i.series} · S${String(i.season).padStart(2,'0')}E${String(i.episode).padStart(2,'0')}`:t(i.kind==='movie'?'movie':'video'),i.year,i.category].filter(Boolean).join(' · ');
 const itemById=id=>s.items.find(i=>i.id===id);
 function toast(message){toastNode.textContent=message;toastNode.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastNode.hidden=true,4500)}
 function explain(detail){return typeof detail==='string'&&window.MP_I18N.en[detail]?t(detail):t('error')}
 async function api(path,method='GET',body,admin=false){
  const r=await fetch((admin?adminBase:base)+path,{method,headers:{'X-Pub-Token':token(),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok){let d={};try{d=await r.json()}catch{}if(r.status===401&&!admin)options.onNeedLogin?.();throw Error(explain(d.detail))}
  return r.json();
 }
 async function raw(path,file,admin=true,method='PUT'){
  const r=await fetch((admin?adminBase:base)+path,{method,headers:{'X-Pub-Token':token(),'Content-Type':file.type||'application/octet-stream'},body:file});
  if(!r.ok){let d={};try{d=await r.json()}catch{}throw Error(explain(d.detail))}return r.json();
 }
 const run=fn=>Promise.resolve().then(fn).catch(e=>{if(!s.dead)toast(e.message||t('error'))});
 function closeModal(force=false){if(modal?._busy&&!force)return;modal?.remove();modal=null;lastFocus?.isConnected&&lastFocus.focus()}
 function dialog(title,body){
  closeModal(true);lastFocus=document.activeElement;
  const el=document.createElement('div');el.className='mp-modal';
  el.innerHTML=`<section class="mp-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><header><h2>${esc(title)}</h2><button data-close aria-label="${esc(t('close'))}">✕</button></header><div class="mp-dialog-body">${body}</div></section>`;
  root.appendChild(el);modal=el;el.querySelector('[data-close]').onclick=()=>closeModal();el.onpointerdown=e=>{if(e.target===el)closeModal()};
  el.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();closeModal()}if(e.key==='Tab'){const all=[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(x=>x.offsetParent!==null);if(!all.length){e.preventDefault();return}const first=all[0],last=all.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===el.querySelector('section'))){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};el.querySelector('section').focus();return el;
 }
 function art(i){return `<span class="mp-art ${i.kind}" style="--h:${parseInt(i.id.slice(0,4),16)%360}">${i.has_cover?`<img data-cover="${i.id}" data-revision="${esc(i.cover_revision)}" alt="" referrerpolicy="no-referrer">`:''}<span class="mp-art-icon">${i.kind==='episode'?'▤':'▷'}</span><span class="mp-art-caption">${esc(i.kind==='episode'?i.series:i.title)}</span></span>`}
 function hydrateCovers(){
  if(s.dead)return;
  for(const img of root.querySelectorAll('[data-cover]:not([data-loaded])')){
   if(coverCount>=4)break;
   const id=img.dataset.cover,revision=img.dataset.revision,key=id+':'+revision;img.dataset.loaded='1';
   for(const [k,r]of coverCache)if(r.id===id&&r.revision!==revision){if(r.url)URL.revokeObjectURL(r.url);coverCache.delete(k)}
   if(!coverCache.has(key)){
    const record={id,revision,url:''};coverCache.set(key,record);
    record.promise=(async()=>{const r=await fetch(base+'/media/'+id+'/cover',{headers:{'X-Pub-Token':token()}});if(!r.ok)return '';const url=URL.createObjectURL(await r.blob());if(s.dead||coverCache.get(key)!==record){URL.revokeObjectURL(url);return ''}record.url=url;return url})().catch(()=>'');
   }
   coverCount++;
   coverCache.get(key).promise.then(url=>{if(url&&img.isConnected){img.src=window.asset(url);img.parentElement.classList.add('mp-has-art')}}).finally(()=>{coverCount--;hydrateCovers()});
  }
 }
 const observer=new MutationObserver(hydrateCovers);observer.observe(root,{childList:true,subtree:true});
 function card(i){return `<article class="mp-card"><button class="mp-poster" data-open="${i.id}" aria-label="${esc(t('open')+': '+i.title)}">${art(i)}${i.state.completed?`<span class="mp-badge">✓ ${esc(t('watched'))}</span>`:''}</button><div class="mp-card-title"><button data-open="${i.id}">${esc(i.title)}</button>${true?`<button data-favorite="${i.id}" aria-label="${esc(t('favorites'))}" aria-pressed="${!!i.state.favorite}">${i.state.favorite?'♥':'♡'}</button>`:''}</div><div class="mp-meta">${esc(subtitleMeta(i))}</div>${i.state.duration?`<div class="mp-progress"><span style="width:${i.percent}%"></span></div><div class="mp-progress-text"><span>${pct(i.percent)}</span><span>${fmt(i.state.completed?0:Math.max(0,i.state.duration-i.state.seconds))} ${esc(t('left'))}</span></div>`:''}</article>`}
 function groups(items=s.items){const map=new Map();for(const i of items.filter(i=>i.kind==='episode')){const key=i.series||t('unknownSeries');if(!map.has(key))map.set(key,[]);map.get(key).push(i)}return [...map].sort((a,b)=>a[0].localeCompare(b[0],lang))}
 function groupCard(name,items){const i=items.find(i=>i.has_cover)||items[0],n=new Set(items.map(i=>i.season)).size;return `<article class="mp-card"><button class="mp-poster" data-series="${esc(name)}">${art({...i,title:name})}<span class="mp-badge">${items.length} ${esc(t('episodes'))}</span></button><div class="mp-card-title"><button data-series="${esc(name)}">${esc(name)}</button></div><div class="mp-meta">${n} ${esc(t('seasons'))} · ${items.filter(i=>i.state.completed).length}/${items.length} ${esc(t('watched'))}</div></article>`}
 function filtered(){
  let items=s.items.filter(i=>s.tab!=='movies'||i.kind==='movie').filter(i=>s.tab!=='videos'||i.kind==='video');
  if(s.tab==='favorites')items=items.filter(i=>i.state.favorite);
  if(s.tab==='history')items=items.filter(i=>i.state.last_played);
  if(s.tab==='collection')items=(s.collections.find(p=>p.id===s.collection)?.items||[]).map(itemById).filter(Boolean);
  if(s.query){const q=s.query.toLocaleLowerCase();items=items.filter(i=>[i.title,i.series,i.category,i.original].join(' ').toLocaleLowerCase().includes(q))}
  if(s.category)items=items.filter(i=>i.category===s.category);
  if(s.status==='watched')items=items.filter(i=>i.state.completed);
  if(s.status==='unwatched')items=items.filter(i=>!i.state.completed);
  if(s.status==='started')items=items.filter(i=>i.state.seconds>0&&!i.state.completed);
  return [...items].sort((a,b)=>s.sort==='title'?a.title.localeCompare(b.title,lang):s.sort==='episode'?a.series.localeCompare(b.series,lang)||a.season-b.season||a.episode-b.episode:s.tab==='history'?b.state.last_played-a.state.last_played:b.created-a.created);
 }
 function render(){
  if(s.dead)return;
  root.lang=lang;
  const search=root.querySelector('[data-search]');search.placeholder=t('search');search.setAttribute('aria-label',t('search'));
  root.querySelector('.mp-side-note').textContent=t('directHint');
  for(const [selector,key]of [['[data-pip]','pip'],['[data-fullscreen]','fullscreen']]){const b=root.querySelector(selector);b.title=t(key);b.setAttribute('aria-label',t(key))}
  root.querySelector('[data-speed]').parentElement.firstChild.nodeValue=t('speed');
  root.querySelector('[data-subtitles]').parentElement.firstChild.nodeValue=t('subtitles');
  root.querySelector('[data-auto-next]').parentElement.lastChild.nodeValue=t('autoNext');
  root.querySelector('[data-close-player]').setAttribute('aria-label',t('closePlayer'));
  root.querySelector('[data-back-ten]').title=t('backTen');root.querySelector('[data-forward-ten]').title=t('forwardTen');
  const off=root.querySelector('[data-subtitles] option[value=""]');if(off)off.textContent=t('off');
  root.querySelector('[data-next]').textContent=t('next')+' →';
  root.querySelector('[data-library-label]').textContent=t('library');
  root.querySelector('[data-top-actions]').innerHTML=`${s.admin?button('libraryFolders','data-sources'):''}${button('help','data-help')}`;
  const navBox=root.querySelector('.mp-side nav'),simklBtn=navBox.querySelector('[data-tab="simkl"]');
  if(s.simkl?.enabled&&!simklBtn)navBox.insertAdjacentHTML('beforeend','<button data-tab="simkl"><i>★</i><span></span></button>');
  else if(!s.simkl?.enabled&&simklBtn){simklBtn.remove();if(s.tab==='simkl')s.tab='home'}
  root.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===s.tab);b.querySelector('span').textContent=t(b.dataset.tab)});
  if(s.tab==='simkl'){renderSimkl();return}
  if(s.tab==='collections'){
   main.innerHTML=`<div class="mp-heading"><div><small>${esc(t('personal'))}</small><h1>${esc(t('collections'))}</h1></div>${button('newCollection','data-new-collection','primary')}</div>${`<div class="mp-collection-grid">${s.collections.map(p=>`<article class="mp-collection"><span>☷</span><h2>${esc(p.title)}</h2><p>${p.items.length} ${esc(t('videos'))}</p>${button('open',`data-collection="${p.id}"`)}${button('edit',`data-edit-collection="${p.id}"`)}</article>`).join('')}</div>`}`;return;
  }
  if(s.tab==='home'&&!s.query){
   const continuing=s.items.filter(i=>i.state.seconds>0&&!i.state.completed).sort((a,b)=>b.state.last_played-a.state.last_played).slice(0,6);
   main.innerHTML=`${continuing.length?`<h2>${esc(t('continue'))}</h2><div class="mp-grid">${continuing.map(card).join('')}</div>`:''}<div class="mp-heading"><h2>${esc(t('recent'))}</h2><span class="mp-muted">${s.items.length} ${esc(t('videos'))}</span></div><div class="mp-grid">${s.items.slice(0,12).map(card).join('')}</div>${!s.items.length?empty():''}`;return;
  }
  const items=filtered(),categories=[...new Set(s.items.map(i=>i.category).filter(Boolean))].sort();
  main.innerHTML=`<div class="mp-heading"><div><small>${esc(t('library'))}</small><h1>${esc(s.tab==='collection'?s.collections.find(p=>p.id===s.collection)?.title||t('collections'):t(s.tab))}</h1></div><select data-sort aria-label="${esc(t('sort'))}">${['recent','title','episode'].map(k=>`<option value="${k}" ${s.sort===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select></div><div class="mp-filters"><select data-status aria-label="${esc(t('status'))}">${['all','started','unwatched','watched'].map(k=>`<option value="${k}" ${s.status===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select><select data-category aria-label="${esc(t('category'))}"><option value="">${esc(t('allCategories'))}</option>${categories.map(c=>`<option ${s.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><div class="mp-grid">${s.tab==='series'?groups(items).map(([name,list])=>groupCard(name,list)).join(''):items.map(card).join('')}</div>${!items.length||s.tab==='series'&&!groups(items).length?empty():''}`;
 }
 function empty(){return `<div class="mp-empty"><span>▷</span><h2>${esc(t('empty'))}</h2><p>${esc(t(s.admin?'emptyAdmin':'emptyHint'))}</p>${s.admin?button('libraryFolders','data-sources','primary'):''}</div>`}
 async function refresh(){
  await saveProgress(true);
  const data=await api('/library');if(s.dead)return;
  s.items=data.items;s.collections=data.collections;s.languages=data.languages;s.translation=!!data.translation;
  try{s.simkl=await api('/simkl')}catch{s.simkl={enabled:false,history:false}}
  const preferred=!options.desktop&&data.user_language&&data.user_language!=='auto'?data.user_language:window.mvmOS?.lang;
  if(preferred&&window.MP_I18N[preferred])lang=preferred;
  if(options.desktop){try{await api('/admin','GET',undefined,true);s.admin=true}catch{s.admin=false}}
  if(s.current&&!s.current.temp&&!itemById(s.current.id)){await stopPlayer();}
  if(s.current&&!s.current.temp)s.current=itemById(s.current.id)||s.current;
  render();
  if(!options.desktop&&location.hash==='#connect-simkl'){history.replaceState(null,'',location.pathname+location.search);if(s.simkl.enabled)run(simklConnect);else toast(t('simklOff'))}
 }
 async function patchState(i,values){await api('/media/'+i.id+'/state','PUT',values);Object.assign(i.state,values);i.percent=i.state.completed?100:i.state.duration?Math.round(1000*i.state.seconds/i.state.duration)/10:0;render()}
 function snapshot(){
  if(!s.current||s.current.temp||!s.ready||!s.played||!Number.isFinite(video.duration)||video.duration<=0)return null;
  return {id:s.current.id,auth:token(),body:{seconds:video.currentTime,duration:video.duration,speed:video.playbackRate,played:true,...(video.ended?{completed:true}:{})}};
 }
 function saveProgress(final=false){
  const snap=snapshot();if(!snap)return saveChain;
  if(!final&&Date.now()-lastSave<5000)return saveChain;lastSave=Date.now();
  const i=itemById(snap.id);if(i){Object.assign(i.state,snap.body);i.percent=i.state.completed?100:Math.min(100,100*i.state.seconds/i.state.duration)}
  saveChain=saveChain.catch(()=>{}).then(async()=>{const r=await fetch(base+'/media/'+snap.id+'/state',{method:'PUT',headers:{'X-Pub-Token':snap.auth,'Content-Type':'application/json'},body:JSON.stringify(snap.body),keepalive:final});if(!r.ok)throw Error(t('progressError'))}).catch(e=>{if(!s.dead)toast(e.message)});
  return saveChain;
 }
 function clearSubtitle(){subtitleGeneration++;for(const track of video.textTracks)track.mode='disabled';video.querySelectorAll('track').forEach(n=>n.remove());if(subtitleUrl){URL.revokeObjectURL(subtitleUrl);subtitleUrl=''}}
 async function stopPlayer(){
  const saved=saveProgress(true);s.load++;s.ready=false;s.played=false;video.pause();video.removeAttribute('src');video.load();clearSubtitle();if(tempSubtitleUrl){URL.revokeObjectURL(tempSubtitleUrl);tempSubtitleUrl=''}selectedSubtitle='';s.current=null;stage.hidden=true;render();await saved;
 }
 function nextItem(){
  if(!s.current)return null;const i=s.current;
  if(i.kind==='episode'){const list=s.items.filter(x=>x.kind==='episode'&&x.series===i.series).sort((a,b)=>a.season-b.season||a.episode-b.episode||a.original.localeCompare(b.original));return list[list.findIndex(x=>x.id===i.id)+1]||null}
  if(s.tab==='collection'){const list=s.collections.find(p=>p.id===s.collection)?.items||[];return itemById(list[list.indexOf(i.id)+1])||null}return null;
 }
 function updateNow(){
  const i=s.current;if(!i)return;root.querySelector('[data-now-title]').textContent=i.title;root.querySelector('[data-now-meta]').textContent=subtitleMeta(i);
  const sub=root.querySelector('[data-subtitles]');sub.innerHTML=`<option value="">${esc(t('off'))}</option>${i.subtitles.map(st=>`<option value="${st.id}">${esc(st.title)} · ${esc(languageName(st.language))}</option>`).join('')}${tempSubtitleUrl?`<option value="local">${esc(t('localSubtitle'))}</option>`:''}<option disabled>──────────</option>${s.translation?`<option value="@translate">✨ ${esc(t('aiTranslateOption'))}</option>`:''}<option value="@file">${esc(t('openSubtitle'))}…</option>`;sub.value=selectedSubtitle;
  root.querySelector('[data-next]').disabled=!nextItem();root.querySelector('[data-speed]').value=String(video.playbackRate);
 }
 function preferredSubtitle(i){
  // The subtitles in the language the person uses, when the video has them; a person's own file before an AI one.
  const base=c=>String(c||'').split('-')[0].toLowerCase();
  const list=i.subtitles.filter(st=>st.language===lang||base(st.language)===base(lang));
  const pick=list.find(st=>st.language===lang&&st.title!=='AI translation')||list.find(st=>st.title!=='AI translation')||list[0];
  return pick?pick.id:'';
 }
 async function loadVideo(i,play=false){
  saveProgress(true);const generation=++s.load;s.ready=false;s.played=false;video.pause();clearSubtitle();if(tempSubtitleUrl){URL.revokeObjectURL(tempSubtitleUrl);tempSubtitleUrl=''}selectedSubtitle='';
  s.current=i;stage.hidden=false;video.removeAttribute('src');video.load();root.querySelector('.mp-video-error').hidden=true;
  const auto=preferredSubtitle(i);if(auto)selectedSubtitle=auto;updateNow();if(auto)run(()=>setSubtitle(auto));
  const info=i.temp?{url:i.direct}:await api('/media/'+i.id+'/ticket','POST');if(s.dead||generation!==s.load)return;
  video.src=window.asset(info.url);
  const speed=i.state.speed||1;video.defaultPlaybackRate=speed;
  const position=i.state.completed?0:i.state.seconds||0;
  video.onloadedmetadata=()=>{
   if(generation!==s.load||!s.current)return;
   video.playbackRate=speed;root.querySelector('[data-speed]').value=String(speed);
   if(Number.isFinite(video.duration)&&video.duration>0){video.currentTime=Math.min(position,Math.max(0,video.duration-0.1));s.ready=true}
   if(play)video.play().catch(()=>toast(t('pressPlay')));
  };
  video.load();stage.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 async function setSubtitle(value){
  const generation=s.load;selectedSubtitle=value;clearSubtitle();if(!value)return;
  const choice=subtitleGeneration;
  let url=tempSubtitleUrl;
  if(value!=='local'){
   const r=await fetch(base+'/media/'+s.current.id+'/subtitles/'+value,{headers:{'X-Pub-Token':token()}});if(!r.ok)throw Error(t('error'));
   const blob=await r.blob();if(generation!==s.load||choice!==subtitleGeneration||s.dead)return;url=subtitleUrl=URL.createObjectURL(blob);
  }
  if(generation!==s.load||choice!==subtitleGeneration)return;
  const track=document.createElement('track');track.kind='subtitles';track.label=t('subtitles');track.srclang='en';track.src=window.asset(url);track.default=true;video.appendChild(track);track.addEventListener('load',()=>track.track.mode='showing');track.track.mode='showing';
 }
 function convertSubtitle(text){
  text=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');const blocks=[];
  for(const block of text.split(/\n\s*\n/)){const lines=block.split('\n'),n=lines.findIndex((l,i)=>i<2&&/^\s*(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3}\s*-->/.test(l));if(n<0)continue;const timing=lines[n].match(/^\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{3})/);if(!timing)continue;const body=lines.slice(n+1).join('\n').replace(/<[^>]*>/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');if(body.trim())blocks.push(timing[1].replace(',','.')+' --> '+timing[2].replace(',','.')+'\n'+body)}
  if(!blocks.length)throw Error(t('invalidSubtitle'));return 'WEBVTT\n\n'+blocks.join('\n\n')+'\n';
 }
 function pickFile(accept,handler){const input=document.createElement('input');input.type='file';input.accept=accept;input.onchange=()=>{if(input.files[0])run(()=>handler(input.files[0]))};input.click()}
 async function settingsDialog(){
  const st=await api('/translation','GET',undefined,true);
  const note=!st.mvmai.installed?'aiMvmaiNotInstalled':!st.mvmai.api?'aiMvmaiApiOff':'aiMvmaiOk';
  const box=dialog(t('settingsTitle'),`<div class="mp-form"><label class="mp-check wide" data-ai-toggle style="display:flex;align-items:center;justify-content:flex-start;gap:10px;text-align:left"><input type="checkbox" ${st.enabled?'checked':''}><span>${esc(t('aiTranslateEnable'))}</span></label><p class="mp-muted wide">${esc(t('aiTranslateHint'))}</p><p class="${note==='aiMvmaiOk'?'mp-muted':'mp-error'} wide">${esc(t(note))}</p><h3 class="wide">Simkl</h3><p class="mp-muted wide">${esc(t('simklAdminHint'))}</p><p class="mp-error wide" role="alert"></p></div>`);
  const label=box.querySelector('[data-ai-toggle]'),input=label.querySelector('input');
  if(!st.premium&&window.mvmOS?.premiumGate)window.mvmOS.premiumGate(label,t('aiPremiumNeeded'));
  input.onchange=()=>run(async()=>{try{await api('/translation','PUT',{enabled:input.checked},true);box.querySelector('.mp-error').textContent='';await refresh()}catch(e){input.checked=!input.checked;box.querySelector('.mp-error').textContent=e.message}});
 }
 async function translateDialog(){
  const i=s.current;if(!i)return;const adm=!!options.desktop,call=(path,method,body)=>api(path,method,body,adm);
  const list=(await call('/media/'+i.id+'/translate/sources','GET')).sources.filter(x=>!x.unsupported);
  if(!list.length){toast(t('aiNoSource'));return}
  const two=c=>({eng:'en',bul:'bg',fre:'fr',fra:'fr',ger:'de',deu:'de',spa:'es',jpn:'ja',por:'pt',rus:'ru',chi:'zh',zho:'zh'}[c]||String(c).slice(0,2).toLowerCase());
  const target=l=>{const from=two(list[0].language);return (s.languages||[]).find(x=>x===lang&&two(x)!==from)||(s.languages||[]).find(x=>two(x)!==from)||lang};
  const name=x=>`${x.kind==='embedded'?t('aiEmbedded')+' · ':''}${x.title} · ${languageName(x.language)}`;
  const box=dialog(t('aiTranslateTitle'),`<form class="mp-form"><label>${esc(t('aiFrom'))}<select name="source">${list.map(x=>`<option value="${esc(x.id)}">${esc(name(x))}</option>`).join('')}</select></label><label>${esc(t('aiTo'))}<select name="language">${(s.languages||[]).map(l=>`<option value="${l}" ${l===target()?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label><p class="mp-muted wide" data-quote role="status"></p><p class="mp-muted wide">${esc(t('aiNote'))}</p><progress max="100" value="0" hidden class="wide"></progress><p class="mp-error wide" role="alert"></p><div class="mp-actions wide"><button class="mp-btn primary" type="submit" data-go disabled>${esc(t('aiStart'))}</button><button class="mp-btn" type="button" data-stop hidden>${esc(t('aiStop'))}</button></div></form>`);
  const form=box.querySelector('form'),quote=box.querySelector('[data-quote]'),go=box.querySelector('[data-go]'),stop=box.querySelector('[data-stop]'),bar=box.querySelector('progress'),err=box.querySelector('.mp-error');
  let job='',gen=0;const body=()=>({source:form.elements.source.value,language:form.elements.language.value});
  const fill=(text,n)=>Object.entries(n).reduce((a,[k,v])=>a.replace('{'+k+'}',v),text);
  async function price(){
   const g=++gen;go.disabled=true;err.textContent='';quote.textContent='…';
   try{const q=await call('/media/'+i.id+'/translate/quote','POST',body());if(g!==gen||s.dead)return;
    const lines=fill(t('aiQuote'),{lines:q.cues,segments:q.segments});
    if(!q.price_each){quote.textContent=lines+' · '+t('aiFree');go.disabled=false}
    else{const enough=q.balance>=q.total;quote.textContent=lines+' · '+fill(t('aiPrice'),{total:q.total,each:q.price_each,balance:q.balance});go.disabled=!enough;if(!enough)err.textContent=t('noCredits')}
   }catch(e){if(g===gen){quote.textContent='';err.textContent=e.message}}
  }
  form.elements.source.onchange=form.elements.language.onchange=price;price();
  async function poll(){
   while(!s.dead&&modal===box.closest('.mp-modal')){
    await new Promise(r=>setTimeout(r,1500));
    const st=await call('/translate/'+job,'GET');bar.value=100*st.done/st.total;quote.textContent=progressText(st.done,st.total);
    if(st.status==='running')continue;
    modal._busy=false;stop.hidden=true;bar.hidden=true;
    if(st.status==='done'){quote.textContent=t('aiDone');if(st.error==='noWriteAccess')err.textContent=t('aiNotBeside');await refresh();const cur=itemById(i.id);if(cur&&s.current?.id===i.id){s.current=cur;selectedSubtitle=st.subtitle_id;updateNow();await setSubtitle(st.subtitle_id)}}
    else if(st.status==='cancelled')quote.textContent=t('aiCancelled');
    else{quote.textContent='';err.textContent=explainCode(st.error)}
    return;
   }
  }
  let startedAt=0;
  const progressText=(done,total)=>{
   const pct=Math.round(100*done/total);let eta=t('aiEtaWait');
   if(done>0&&done<total){const left=Math.round((Date.now()-startedAt)/done*(total-done)/1000);eta=fill(t('aiEta'),{time:Math.floor(left/60)+':'+String(left%60).padStart(2,'0')})}
   return fill(t('aiProgress'),{percent:pct,done,total})+' · '+eta;
  };
  const explainCode=c=>window.MP_I18N.en[c]?t(c):t('error');
  form.onsubmit=e=>{e.preventDefault();run(async()=>{err.textContent='';go.disabled=true;form.elements.source.disabled=form.elements.language.disabled=true;
   try{job=(await call('/media/'+i.id+'/translate','POST',body())).id}catch(x){form.elements.source.disabled=form.elements.language.disabled=false;err.textContent=x.message;price();return}
   modal._busy=true;bar.hidden=false;stop.hidden=false;startedAt=Date.now();quote.textContent=progressText(0,1);await poll()})};
  stop.onclick=()=>run(async()=>{stop.disabled=true;await call('/translate/'+job+'/cancel','POST')});
 }
 function openLocalSubtitle(){pickFile('.srt,.vtt',async file=>{if(file.size>5*1024**2)throw Error(t('tooLarge'));const generation=s.load,data=await file.arrayBuffer();if(generation!==s.load||s.dead)return;const head=new Uint8Array(data);let text=new TextDecoder(head[0]===255&&head[1]===254?'utf-16le':head[0]===254&&head[1]===255?'utf-16be':'utf-8').decode(data);if(text.includes('\ufffd'))text=new TextDecoder('windows-1251').decode(data);const vtt=convertSubtitle(text);if(tempSubtitleUrl)URL.revokeObjectURL(tempSubtitleUrl);tempSubtitleUrl=URL.createObjectURL(new Blob([vtt],{type:'text/vtt'}));selectedSubtitle='local';updateNow();await setSubtitle('local')});}
 async function addToSource(x,mode){
  const picker=window.mvmOS?.filePicker,uploader=window.mvmOS?.uploader;if(!picker||!uploader)throw Error(t('error'));
  const accept=['.mp4','.m4v','.mov','.webm','.mkv','.ogv','.avi','.srt','.vtt'];
  const r=await picker.open({mode,sources:['device'],accept,maxFiles:1000});
  if(!r?.files?.length)return;
  const destination=x.kind==='shared'?{type:'shared',folderId:x.folder_id,path:x.path,name:x.name}:{type:'server',path:x.path};
  uploader.upload({files:r.files,destination,
   onDone(){run(async()=>{await api('/sources/'+x.id+'/scan','POST',{},true);await refresh();render()})},
   onError(){toast(t('error'))}});
  toast(t('uploadStarted'));
 }
 async function sourcesDialog(){
  const dp=window.mvmOS?.dateTimePicker;if(dp)await dp.ready();
  const when=ts=>!ts?t('never'):dp?dp.format(dp.fromEpoch(ts)):new Date(ts*1000).toLocaleString(lang);
  const minutes=[0,15,60,360,1440];
  let timer=0,box=null,st={sources:[]};
  const row=x=>`<div class="mp-folder" data-source="${x.id}"><div><strong>${esc(x.name)}</strong><p class="mp-meta mp-filename">${x.kind==='shared'?esc(t('sharedFolder'))+' · ':''}${esc(x.path||'/')}</p><p class="${x.state==='failed'?'mp-error':'mp-muted'}">${esc(x.state==='running'?t('scanning'):x.state==='failed'?(window.MP_I18N.en[x.error]?t(x.error):t('sourceUnreadable')):fill(t('sourceSummary'),{videos:x.videos,time:when(x.last_scan)}))}${x.missing?' · '+esc(fill(t('sourceMissing'),{n:x.missing})):''}</p></div><label>${esc(t('autoScan'))}<select data-auto>${minutes.map(n=>`<option value="${n}" ${n===x.auto?'selected':''}>${esc(t('auto'+n))}</option>`).join('')}</select></label><div class="mp-actions">${button('addFiles','data-add-files')}${button('addFolderFromComputer','data-add-dir')}${button('scanNow','data-scan')}${button('removeSource','data-remove','danger')}</div></div>`;
  const fill=(text,n)=>Object.entries(n).reduce((a,[k,v])=>a.replace('{'+k+'}',v),text);
  async function load(){st=await api('/sources','GET',undefined,true);if(!box?.isConnected)return;
   box.querySelector('[data-list]').innerHTML=st.sources.length?st.sources.map(row).join(''):`<p class="mp-muted">${esc(t('noSources'))}</p>`;
   clearTimeout(timer);if(st.sources.some(x=>x.state==='running')||!st.sources.length||true)timer=setTimeout(()=>{if(box?.isConnected&&!s.dead)load().catch(()=>{})},st.sources.some(x=>x.state==='running')?2000:15000);
  }
  box=dialog(t('libraryFolders'),`<p class="mp-muted">${esc(t('sourcesHint'))}</p><div class="mp-folder-list" data-list></div><div class="mp-actions">${button('addFolder','data-add-folder','primary')}</div><p class="mp-error" role="alert"></p>`);
  const err=box.querySelector('.mp-error');
  box.querySelector('[data-add-folder]').onclick=()=>run(async()=>{
   const picker=window.mvmOS?.filePicker;if(!picker)throw Error(t('error'));
   const r=await picker.open({mode:'directory',sources:['server','shared'],server:{roots:['/'],start:'~'},shared:{permission:'read'},labels:{title_directory:t('pickLibraryTitle'),where_directory:t('pickLibraryWhere'),use_here:t('pickLibraryUse'),use_folder:t('pickLibraryUse')}});
   if(!r?.folder)return;err.textContent='';
   const shared=r.folder.shared,body=shared?{kind:'shared',folder_id:shared.folderId,path:shared.path||'',name:r.folder.name||shared.folderName,auto:0}:{path:r.folder.path,name:r.folder.name,auto:0};
   if(!shared&&!r.folder.path)return;
   try{await api('/sources','POST',body,true);await refresh();await load()}catch(e){err.textContent=e.message}
  });
  box.addEventListener('change',e=>{const el=e.target.closest('[data-source]');if(!el||!e.target.matches('[data-auto]'))return;const x=st.sources.find(v=>v.id===el.dataset.source);run(async()=>{await api('/sources/'+x.id,'PUT',{name:x.name,auto:Number(e.target.value)},true);await load()})});
  box.addEventListener('click',e=>{const el=e.target.closest('[data-source]'),b=e.target.closest('button');if(!el||!b)return;const x=st.sources.find(v=>v.id===el.dataset.source);
   if(b.hasAttribute('data-scan'))run(async()=>{err.textContent='';await api('/sources/'+x.id+'/scan','POST',{},true);await load()});
   else if(b.hasAttribute('data-add-files')||b.hasAttribute('data-add-dir'))run(()=>addToSource(x,b.hasAttribute('data-add-dir')?'folder':'files'));
   else if(b.hasAttribute('data-remove')&&confirm(fill(t('removeSourceConfirm'),{name:x.name})))run(async()=>{await api('/sources/'+x.id,'DELETE',undefined,true);await refresh();await load()});
  });
  box.querySelector('[data-close]')?.addEventListener('click',()=>{clearTimeout(timer);refresh().then(render).catch(()=>{})});
  await load();
 }
 function openDetail(id){
  const i=itemById(id);if(!i)return;
  const box=dialog(i.title,`<div class="mp-detail"><div class="mp-detail-art">${art(i)}</div><div><p class="mp-eyebrow">${esc(subtitleMeta(i))}</p><h2>${esc(i.title)}</h2><p class="mp-description">${esc(i.description||t('noDescription'))}</p><p class="mp-muted">${i.state.completed?esc(t('watched')):i.state.duration?`${pct(i.percent)} · ${fmt(i.state.seconds)} / ${fmt(i.state.duration)}`:esc(t('notStarted'))}</p><div class="mp-actions">${button(i.state.seconds&&!i.state.completed?'resume':'play','data-detail-play','primary')}${button(i.state.completed?'markUnwatched':'markWatched','data-completed')}${button('addCollection','data-add-collection')}${s.simkl?.enabled?button('simkl','data-simkl-details'):''}${s.admin?button('edit','data-edit-item'):''}</div><div data-simkl-slot></div>${i.rating?`<p class="mp-rating">★ ${esc(i.rating.toFixed(1))}/10 · ${esc(i.source)}</p>`:''}${i.source_url?`<p class="mp-source"><a href="${esc(i.source_url)}" target="_blank" rel="noopener noreferrer">${esc(i.source)}</a>${i.source==='TVmaze'?' · CC BY-SA':i.source==='Wikipedia'?' · CC BY-SA':''}</p>`:''}<p class="mp-muted mp-filename">${esc(i.original)} · ${bytes(i.bytes)}</p></div></div>`);
  box.querySelector('[data-detail-play]').onclick=()=>{closeModal();run(()=>loadVideo(i,true))};
  box.querySelector('[data-completed]').onclick=()=>run(async()=>{await patchState(i,{completed:!i.state.completed});openDetail(i.id)});
  box.querySelector('[data-add-collection]').onclick=()=>chooseCollection(i);
  box.querySelector('[data-edit-item]')?.addEventListener('click',()=>editDialog(i));
  box.querySelector('[data-simkl-details]')?.addEventListener('click',()=>simklDetails(i,box));
 }
 async function seriesDialog(name){
  const list=s.items.filter(i=>i.kind==='episode'&&i.series===name).sort((a,b)=>a.season-b.season||a.episode-b.episode);
  const first=list.find(i=>i.show_id)||list[0];if(!first)return;
  const box=dialog(name,`<div class="mp-series-head"><div>${art(first)}</div><section><p class="mp-eyebrow">${esc(t('series'))}</p><h2>${esc(name)}</h2><p class="mp-description">${esc(first.description||'')}</p><p>${list.length} ${esc(t('availableEpisodes'))} · ${list.filter(i=>i.state.completed).length} ${esc(t('watched'))}</p><p data-series-status class="mp-muted">${esc(t('loading'))}</p></section></div><div data-season-tabs class="mp-chips"></div><div data-episode-list></div>`);
  let remote={seasons:[],episodes:[]};
  try{remote=await api('/series/'+first.id,'GET')}catch(e){if(box.isConnected)box.querySelector('[data-series-status]').textContent=e.message}
  if(!box.isConnected)return;
  const numbers=[...new Set([...list.map(i=>i.season),...remote.seasons.map(i=>i.number),...remote.episodes.map(i=>i.season)].filter(n=>n!==null))].sort((a,b)=>a-b);
  const status=box.querySelector('[data-series-status]');if(remote.source){status.textContent=numbers.length+' '+t('seasons')+' · TVmaze · CC BY-SA';const a=document.createElement('a');a.href=remote.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t('source');status.append(' · ',a)}else status.textContent=t('localSeasons');
  function season(number){
   box.querySelectorAll('[data-season]').forEach(b=>b.classList.toggle('active',Number(b.dataset.season)===number));
   const known=remote.episodes.filter(e=>e.season===number&&e.number!==null),local=list.filter(i=>i.season===number);const rows=known.length?known.map(e=>({...e,file:local.find(i=>i.episode===e.number)})):local.map(i=>({title:i.title,number:i.episode,file:i}));
   const knownNumbers=new Set(rows.map(e=>e.number));for(const i of local)if(!knownNumbers.has(i.episode))rows.push({title:i.title,number:i.episode,file:i});rows.sort((a,b)=>a.number-b.number);
   box.querySelector('[data-episode-list]').innerHTML=rows.map(e=>`<article class="mp-episode ${e.file?'':'unavailable'}"><span class="mp-episode-number">${esc(e.number)}</span><div><strong>${esc(e.title)}</strong><p class="mp-meta">${e.file?`${e.file.state.completed?'✓ '+t('watched'):pct(e.file.percent)} · ${t('available')}`:esc(t('noFile'))}${e.airdate?' · '+esc(e.airdate):''}</p>${e.file?.state.duration?`<div class="mp-progress"><span style="width:${e.file.percent}%"></span></div>`:''}</div>${e.file?button('open',`data-episode-open="${e.file.id}"`):''}</article>`).join('');
   box.querySelectorAll('[data-episode-open]').forEach(b=>b.onclick=()=>openDetail(b.dataset.episodeOpen));
  }
  box.querySelector('[data-season-tabs]').innerHTML=numbers.map(n=>`<button data-season="${n}">${esc(t('season'))} ${n}</button>`).join('');box.querySelectorAll('[data-season]').forEach(b=>b.onclick=()=>season(Number(b.dataset.season)));season(list.find(i=>!i.state.completed)?.season??numbers[0]);
 }
 function editDialog(i){
  const keys=['title','series','season','episode','year','category'];
  const box=dialog(t('edit'),`<form class="mp-form"><label>${esc(t('type'))}<select name="kind">${['video','movie','episode'].map(k=>`<option value="${k}" ${i.kind===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select></label>${keys.map(k=>`<label>${esc(t(k))}<input name="${k}" ${['season','episode'].includes(k)?'type="number" min="0" max="'+(k==='season'?999:9999)+'"':'type="text" maxlength="250"'} value="${esc(i[k])}" ${k==='title'?'required':''}></label>`).join('')}<label class="wide">${esc(t('description'))}<textarea name="description" rows="5" maxlength="10000">${esc(i.description)}</textarea></label><div class="mp-actions wide"><button class="mp-btn primary" type="submit">${esc(t('save'))}</button>${button('lookup','data-lookup')}${i.source_id?'':button('delete','data-delete','danger')}</div><p class="mp-error wide" role="alert"></p></form><hr><div class="mp-actions">${button('uploadCover','data-upload-cover')}${i.has_cover?button('removeCover','data-remove-cover'):''}${button('uploadSubtitle','data-upload-subtitle')}</div><div class="mp-sub-list">${i.subtitles.map(st=>`<div><span>${esc(st.title)} · ${esc(languageName(st.language))}</span>${button('delete',`data-delete-subtitle="${st.id}"`)}</div>`).join('')}</div><p class="mp-muted mp-filename">${esc(i.original)} · ${bytes(i.bytes)}</p>`);
  const form=box.querySelector('form');form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('[type=submit]');b.disabled=true;try{const d=Object.fromEntries(new FormData(form));d.season=Number(d.season);d.episode=Number(d.episode);await api('/media/'+i.id,'PUT',d,true);await refresh();closeModal();updateNow();toast(t('saved'))}catch(err){box.querySelector('.mp-error').textContent=err.message}finally{b.disabled=false}};
  box.querySelector('[data-lookup]').onclick=()=>lookupDialog(i,form.elements[i.kind==='episode'?'series':'title'].value);
  box.querySelector('[data-delete]')?.addEventListener('click',()=>confirmDelete(i));
  box.querySelector('[data-upload-cover]').onclick=()=>pickFile('image/png,image/jpeg,image/webp',async file=>{if(file.size>3*1024**2)throw Error(t('tooLarge'));await raw('/media/'+i.id+'/cover',file);await refresh();editDialog(itemById(i.id))});
  box.querySelector('[data-remove-cover]')?.addEventListener('click',()=>run(async()=>{await api('/media/'+i.id+'/cover','DELETE',undefined,true);await refresh();editDialog(itemById(i.id))}));
  box.querySelector('[data-upload-subtitle]').onclick=()=>subtitleDialog(i);
  box.querySelectorAll('[data-delete-subtitle]').forEach(b=>b.onclick=()=>run(async()=>{await api('/media/'+i.id+'/subtitles/'+b.dataset.deleteSubtitle,'DELETE',undefined,true);await refresh();editDialog(itemById(i.id))}));
 }
 function subtitleDialog(i){
  const box=dialog(t('uploadSubtitle'),`<form class="mp-form"><label>${esc(t('title'))}<input name="title" maxlength="200"></label><label>${esc(t('language'))}<select name="language">${(s.languages||Object.keys(window.MP_I18N)).map(l=>`<option value="${l}" ${l===lang?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label><label class="wide">${esc(t('subtitleFile'))}<input type="file" accept=".srt,.vtt" required></label><p class="mp-muted wide">${esc(t('subtitleHint'))}</p><div class="mp-actions wide"><button class="mp-btn primary" type="submit">${esc(t('uploadFile'))}</button></div><p class="mp-error wide" role="alert"></p></form>`);
  box.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.target,file=form.querySelector('[type=file]').files[0],b=form.querySelector('[type=submit]');b.disabled=true;try{if(file.size>5*1024**2)throw Error(t('tooLarge'));await raw('/media/'+i.id+'/subtitles?title='+encodeURIComponent(form.elements.title.value||file.name)+'&language='+encodeURIComponent(form.elements.language.value),file,true,'POST');await refresh();editDialog(itemById(i.id));if(s.current?.id===i.id)updateNow()}catch(err){box.querySelector('.mp-error').textContent=err.message;b.disabled=false}};
 }
 function confirmDelete(i){const box=dialog(t('delete'),`<p>${esc(t('deleteHint'))}</p><strong>${esc(i.title)}</strong><div class="mp-actions">${button('delete','data-confirm-delete','danger')}${button('cancel','data-cancel')}</div><p class="mp-error" role="alert"></p>`);box.querySelector('[data-cancel]').onclick=()=>closeModal();box.querySelector('[data-confirm-delete]').onclick=()=>run(async()=>{if(s.current?.id===i.id)await stopPlayer();await api('/media/'+i.id,'DELETE',undefined,true);await refresh();closeModal()})}
 function lookupDialog(i,query=''){
  const episodeCode='S'+String(i.season).padStart(2,'0')+'E'+String(i.episode).padStart(2,'0');
  const box=dialog(t('lookup'),`<p class="mp-muted">${esc(t(i.kind==='episode'?'lookupSeriesHint':'lookupMovieHint'))}</p>${i.kind==='episode'?`<p class="mp-lookup-context">${esc(i.series)} · ${esc(episodeCode)}</p>`:''}<form class="mp-form"><label>${esc(t('searchOnline'))}<input name="query" value="${esc(query||i.series||i.title)}" maxlength="250" required></label><label>${esc(t('language'))}<select name="language">${(s.languages||Object.keys(window.MP_I18N)).map(l=>`<option value="${l}" ${l===lang?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label><div class="wide">${button('searchOnline','data-lookup-search','primary')}</div></form><p class="mp-error" role="alert"></p><div data-lookup-results></div><div data-lookup-fields></div>`);
  let chosen=null;
  function episodePreview(r){
   if(i.kind!=='episode')return '';
   const e=r.episode||{},status=e.status||'unavailable';
   return `<span class="mp-match-${status}" data-match-status="${status}"><strong>${esc(episodeCode)} · ${esc(t(status==='found'?'episodeFound':status==='missing'?'episodeMissing':'episodeUnverified'))}</strong>${status==='found'?`<span>${esc(e.title)}</span>${e.airdate?`<small>${esc(t('episodeAirdate'))}: ${esc(e.airdate)}</small>`:''}`:''}</span>`;
  }
  function seriesIdentity(r){return i.kind==='episode'?`<small>${r.rating?'★ '+esc(r.rating.toFixed(1))+' · ':''}${esc(t('seriesPremiere'))}: ${esc(r.premiered||r.year||'—')}${r.ended?' – '+esc(r.ended):''} · ${esc([r.country,r.network,r.language].filter(Boolean).join(' · '))}</small>`:''}

  const search=async()=>{const b=box.querySelector('[data-lookup-search]');b.disabled=true;box.querySelector('.mp-error').textContent='';try{const form=box.querySelector('form');const data=await api('/media/'+i.id+'/lookup','POST',{query:form.elements.query.value,language:form.elements.language.value},true);if(!box.isConnected)return;chosen=null;box.querySelector('[data-lookup-fields]').innerHTML='';const results=box.querySelector('[data-lookup-results]');results.innerHTML=data.results.length?data.results.map((r,n)=>`<button class="mp-result" data-result="${n}"><strong>${esc(r.title)} ${esc(r.year)}</strong>${seriesIdentity(r)}${episodePreview(r)}<span>${esc((r.episode?.status==='found'&&r.episode.description||r.description).slice(0,220))}</span><small>${esc(r.source)}</small></button>`).join(''):`<p class="mp-muted">${esc(t('noResults'))}</p>`;results.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{chosen=data.results[Number(b.dataset.result)];results.querySelectorAll('button').forEach(el=>el.classList.toggle('active',el===b));preview()})}catch(e){box.querySelector('.mp-error').textContent=e.message}finally{b.disabled=false}};
  function preview(){
   const exact=chosen.episode?.status==='found'?chosen.episode:null;
   const values={...chosen,series:chosen.title,episode_title:exact?.title||'',episode_description:exact?.description||''};
   const keys=[i.kind==='episode'?'series':'title',...(i.kind==='episode'?['episode_title','episode_description']:[]),'description','category','year','cover'].filter(k=>!!values[k]);
   box.querySelector('[data-lookup-fields]').innerHTML=`${episodePreview(chosen)}<h3>${esc(t('chooseFields'))}</h3><div class="mp-checklist">${keys.map(k=>`<label><input type="checkbox" data-field="${k}" ${k==='description'&&exact?.description?'':'checked'}><span><strong>${esc(t(k==='description'&&i.kind==='episode'?'seriesDescription':k))}</strong><small>${esc(k==='cover'?t('cover'):String(values[k]).slice(0,350))}</small></span></label>`).join('')}</div>${i.kind==='episode'?`<label class="mp-check"><input type="checkbox" data-series-group checked>${esc(t('applySeries'))}</label><p class="mp-muted">${esc(t('episodeApplyHint'))}</p>`:''}<p><a href="${esc(chosen.url)}" target="_blank" rel="noopener noreferrer">${esc(chosen.source)}</a> · CC BY-SA</p>${button('apply','data-apply','primary')}`;
   box.querySelector('[data-apply]').onclick=async()=>{const b=box.querySelector('[data-apply]');b.disabled=true;try{const fields=[...box.querySelectorAll('[data-field]:checked')].map(el=>el.dataset.field);if(!fields.length)throw Error(t('chooseFields'));const r=await api('/media/'+i.id+'/lookup/apply','POST',{candidate:chosen.id,fields,series_group:!!box.querySelector('[data-series-group]')?.checked},true);await refresh();editDialog(itemById(i.id));toast(t(r.cover_missing?'coverMissing':'saved'))}catch(e){box.querySelector('.mp-error').textContent=e.message;b.disabled=false}};
  }
  box.querySelector('form').onsubmit=e=>{e.preventDefault();search()};box.querySelector('[data-lookup-search]').onclick=search;
 }
 function collectionDialog(p=null,initial=[]){
  const selected=new Set(p?.items||initial),box=dialog(t(p?'editCollection':'newCollection'),`<form><label class="mp-field">${esc(t('title'))}<input name="title" value="${esc(p?.title||'')}" required maxlength="200"></label><div class="mp-checklist">${s.items.map(i=>`<label><input type="checkbox" value="${i.id}" ${selected.has(i.id)?'checked':''}><span><strong>${esc(i.title)}</strong><small>${esc(subtitleMeta(i))}</small></span></label>`).join('')}</div><div class="mp-actions"><button class="mp-btn primary" type="submit">${esc(t('save'))}</button>${p?button('delete','data-delete-collection','danger'):''}</div><p class="mp-error" role="alert"></p></form>`);
  box.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{const data=await api('/collections'+(p?'/'+p.id:''),p?'PUT':'POST',{title:e.target.elements.title.value,items:[...box.querySelectorAll('[type=checkbox]:checked')].map(el=>el.value)});await refresh();s.tab='collection';s.collection=data.id;render();closeModal()}catch(err){box.querySelector('.mp-error').textContent=err.message;b.disabled=false}};
  box.querySelector('[data-delete-collection]')?.addEventListener('click',()=>run(async()=>{await api('/collections/'+p.id,'DELETE');await refresh();s.tab='collections';render();closeModal()}));
 }
 function chooseCollection(i){const box=dialog(t('addCollection'),`<div class="mp-list">${s.collections.map(p=>button(p.title,'data-choose-collection="'+p.id+'"')).join('')}</div>${button('newCollection','data-create-collection','primary')}`);box.querySelectorAll('[data-choose-collection]').forEach(b=>{const p=s.collections.find(p=>p.id===b.dataset.chooseCollection);b.textContent=p.title;b.onclick=()=>run(async()=>{await api('/collections/'+p.id,'PUT',{title:p.title,items:[...new Set([...p.items,i.id])]});await refresh();closeModal();toast(t('saved'))})});box.querySelector('[data-create-collection]').onclick=()=>collectionDialog(null,[i.id])}
 const simklCache={};
 const simklRating=r=>[r?.simkl?`Simkl ★ ${r.simkl.toFixed(1)}`:'',r?.imdb?`IMDb ★ ${r.imdb.toFixed(1)}`:''].filter(Boolean).join(' · ');
 function simklRow(x,extra=''){
  const link=x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(t('simklOpen'))}</a>`:'';
  const own=x.library_id?button('simklInLibrary',`data-open="${esc(x.library_id)}"`):'';
  const show=x.kind==='show'&&x.simkl_id,id=show?`data-simkl-show="${esc(x.simkl_id)}"`:'';
  const label=`${x.rank&&s.simklView!=='history'?'#'+esc(x.rank)+' ':''}${esc(x.title)} ${esc(x.year)}`;
  const own2=show?button('simklSeasons',id):'';
  return `<article class="mp-simkl-row">${x.poster?`<img src="${esc(x.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<span class="mp-simkl-noimg">▣</span>'}<div>${show?`<button type="button" class="mp-simkl-title" ${id}>${label}</button>`:`<strong>${label}</strong>`}${extra}${simklRating(x.ratings)?`<small>${esc(simklRating(x.ratings))}</small>`:''}${x.overview?`<span>${esc(x.overview.slice(0,220))}</span>`:''}<p>${own2}${link}${own}</p></div></article>`;
 }
 async function renderSimkl(){
  const view=s.simklView||(s.simkl.history?'history':'movies');s.simklView=view;
  const views=[...(s.simkl.history?['history','plan']:[]),'movies','tv'];
  const names={history:'simklHistory',plan:'simklPlan',movies:'simklTrendingMovies',tv:'simklTrendingSeries'};
  const head=`<div class="mp-heading"><div><small>Simkl</small><h1>${esc(t(names[view]))}</h1></div></div><div class="mp-chips">${views.map(v=>`<button data-simkl-view="${v}" class="${v===view?'active':''}">${esc(t(names[v]))}</button>`).join('')}</div>${s.simkl.history?`<p class="mp-simkl-account"><span>${esc(t('simklConnected'))}</span>${button('simklDisconnect','data-simkl-disconnect')}</p>`:`<div class="mp-simkl-connect"><p>${esc(t('simklNoToken'))}</p>${button('simklConnect','data-simkl-connect','primary')}</div>`}`;
  main.innerHTML=head+`<p class="mp-muted">${esc(t('loading'))}</p>`;
  const wanted=view;
  try{
   const data=simklCache[view]&&Date.now()-simklCache[view].at<120000?simklCache[view].data:await api(view==='history'||view==='plan'?'/simkl/history':'/simkl/trending?kind='+view);
   simklCache[view]={at:Date.now(),data};if(view==='plan')simklCache.history=simklCache[view];if(view==='history')simklCache.plan=simklCache[view];
   if(s.dead||s.tab!=='simkl'||s.simklView!==wanted)return;
   let body;
   if(view==='history'){
    const shows=data.shows.map(x=>simklRow(x,`<small>${esc(t('simklProgress').replace('{done}',x.watched).replace('{total}',x.total||'?'))}${x.next?' · '+esc(t('simklNext').replace('{ep}',x.next)):''}</small>`)).join('');
    const movies=data.movies.map(x=>simklRow(x)).join('');
    body=`<h2>${esc(t('simklShows'))}</h2>${shows||`<p class="mp-muted">${esc(t('simklEmpty'))}</p>`}<h2>${esc(t('simklMovies'))}</h2>${movies||`<p class="mp-muted">${esc(t('simklEmpty'))}</p>`}`;
   }else if(view==='plan'){
    const plan=(data.plan||[]).map(x=>simklRow(x)).join('');
    body=plan||`<p class="mp-muted">${esc(t('simklPlanEmpty'))}</p>`;
   }else body=data.items.length?data.items.map(x=>simklRow(x)).join(''):`<p class="mp-muted">${esc(t('simklEmpty'))}</p>`;
   main.innerHTML=head+`<div class="mp-simkl">${body}</div>`;
  }catch(e){if(!s.dead&&s.tab==='simkl'&&s.simklView===wanted)main.innerHTML=head+`<p class="mp-error">${esc(e.message)}</p>`}
 }
 function simklShowDialog(sid){
  const box=dialog(t('simklSeasons'),`<p class="mp-muted">${esc(t('loading'))}</p>`);
  const body=box.querySelector('.mp-dialog-body'),opened=new Set();let data=null,busy=false,error='';
  const count=n=>t('simklCount').replace('{done}',n.done).replace('{total}',n.total);
  const tally=eps=>({done:eps.filter(e=>e.watched).length,total:eps.length});
  const name=n=>n===0?t('simklSpecials'):t('simklSeasonName').replace('{n}',n);
  function draw(){
   const sh=data.show,all=data.seasons.flatMap(x=>x.episodes),sum=tally(all);
   if(!opened.size&&data.seasons.length){const next=data.seasons.find(x=>x.episodes.some(e=>!e.watched&&e.aired))||data.seasons.find(x=>x.number>0)||data.seasons[0];opened.add(next.number)}
   const plan=data.status==='plantowatch'&&!data.watched?button('simklPlanRemove','data-plan="0"'):!data.tracked?button('simklPlanAdd','data-plan="1"','primary'):'';
   const meta=[simklRating(sh.ratings),sh.status,(sh.genres||[]).join(', ')].filter(Boolean).map(esc).join(' · ');
   const seasons=data.seasons.map(x=>{const n=tally(x.episodes),full=n.done===n.total;
    return `<details class="mp-simkl-season" data-season-box="${x.number}" ${opened.has(x.number)?'open':''}><summary><strong>${esc(name(x.number))}</strong><small>${esc(count(n))}</small></summary><p class="mp-actions">${button(full?'simklUnmarkSeason':'simklMarkSeason',`data-mark="${x.number}" data-to="${full?0:1}"`)}</p>${x.episodes.map(e=>`<article class="mp-episode ${e.watched?'mp-seen':''}"><span class="mp-episode-number">${e.number}</span><div><strong>${esc(e.title||'')}</strong><p class="mp-meta">${e.watched?'✓ '+esc(t('watched')):e.aired?'':esc(t('simklNotAired'))}${e.date?(e.watched||!e.aired?' · ':'')+esc(e.date):''}</p></div>${e.library_id?button('play',`data-episode-open="${esc(e.library_id)}"`):''}<button type="button" class="mp-tick ${e.watched?'on':''}" role="switch" aria-checked="${e.watched}" aria-label="${esc(t(e.watched?'simklUnmarkEpisode':'simklMarkEpisode'))}" title="${esc(t(e.watched?'simklUnmarkEpisode':'simklMarkEpisode'))}" data-mark="${x.number}:${e.number}" data-to="${e.watched?0:1}"><svg viewBox="0 0 24 24" aria-hidden="true">${e.watched?'<path d="M5 12.5l4.5 4.5L19 7.5"/>':'<path d="M12 6v12M6 12h12"/>'}</svg></button></article>`).join('')}</details>`}).join('');
   body.innerHTML=`<div class="mp-simkl-head">${sh.poster?`<img src="${esc(sh.poster)}" alt="" referrerpolicy="no-referrer">`:''}<div><h2>${esc(sh.title)} ${esc(sh.year)}</h2>${meta?`<p class="mp-muted">${meta}</p>`:''}<p class="mp-muted">${esc(count(sum))}</p>${sh.overview?`<p class="mp-description">${esc(sh.overview)}</p>`:''}<p class="mp-actions">${plan}${data.seasons.length?button(sum.done===sum.total?'simklUnmarkAll':'simklMarkAll',`data-mark="all" data-to="${sum.done===sum.total?0:1}"`):''}${sh.url?`<a href="${esc(sh.url)}" target="_blank" rel="noopener noreferrer">${esc(t('simklOpen'))}</a>`:''}</p></div></div>${error?`<p class="mp-error" role="alert">${esc(error)}</p>`:''}${seasons||`<p class="mp-muted">${esc(t('simklEmpty'))}</p>`}`;
   body.querySelectorAll('details').forEach(d=>d.ontoggle=()=>{const n=Number(d.dataset.seasonBox);d.open?opened.add(n):opened.delete(n)});
  }
  async function change(path,payload){
   if(busy)return;busy=true;error='';body.classList.add('mp-busy');
   try{data=await api(path,'POST',payload);delete simklCache.history;delete simklCache.plan;if(s.tab==='simkl'&&['history','plan'].includes(s.simklView))renderSimkl()}catch(e){error=e.message||t('simklChanged')}
   busy=false;body.classList.remove('mp-busy');if(box.isConnected)draw();
  }
  body.addEventListener('click',e=>{
   const b=e.target.closest('button');if(!b||b.disabled||!data)return;
   if(b.dataset.episodeOpen){openDetail(b.dataset.episodeOpen);return}
   const base='/simkl/show/'+sid;
   if(b.dataset.plan!==undefined)change(base+'/plan',{on:b.dataset.plan==='1'});
   else if(b.dataset.mark!==undefined){
    const to=b.dataset.to==='1',m=b.dataset.mark;
    const payload=m==='all'?{watched:to}:m.includes(':')?{watched:to,season:Number(m.split(':')[0]),episode:Number(m.split(':')[1])}:{watched:to,season:Number(m)};
    change(base+'/watched',payload);
   }
  });
  api('/simkl/show/'+sid).then(r=>{if(!box.isConnected)return;data=r;draw()}).catch(e=>{if(box.isConnected)body.innerHTML=`<p class="mp-error">${esc(e.message)}</p>`});
 }
 async function simklConnect(){
  const pin=await api('/simkl/pin','POST',{});
  let stopped=false;
  const box=dialog(t('simklConnect'),`<div class="mp-form"><p class="wide">${esc(t('simklApprove'))}</p><p class="mp-simkl-code wide">${esc(pin.code)}</p><p class="wide"><a href="${esc(pin.url)}" target="_blank" rel="noopener noreferrer">${esc(t('simklOpenPin'))}</a></p><p class="mp-muted wide" data-pin-state>${esc(t('simklWaiting'))}</p></div>`);
  const state=box.querySelector('[data-pin-state]'),end=Date.now()+pin.expires*1000;
  const observer=new MutationObserver(()=>{if(!box.isConnected){stopped=true;observer.disconnect()}});observer.observe(document.body,{childList:true,subtree:true});
  while(!stopped&&!s.dead){
   await new Promise(r=>setTimeout(r,pin.interval*1000));
   if(stopped||s.dead||!box.isConnected)break;
   if(Date.now()>end){state.textContent=t('simklExpired');break}
   let done=false;try{done=(await api('/simkl/pin/'+encodeURIComponent(pin.device))).connected}catch(e){state.textContent=e.message;break}
   if(done){observer.disconnect();closeModal(true);delete simklCache.history;s.simkl=await api('/simkl');s.simklView='history';if(s.tab==='simkl')renderSimkl();else render();return}
  }
  observer.disconnect();
 }
 async function simklDisconnect(){
  await api('/simkl/connection','DELETE');
  for(const k of Object.keys(simklCache))delete simklCache[k];
  s.simkl=await api('/simkl');s.simklView='movies';renderSimkl();
 }
 function simklDetails(i,box){
  const slot=box.querySelector('[data-simkl-slot]');if(!slot)return;
  slot.innerHTML=`<p class="mp-muted">${esc(t('loading'))}</p>`;
  api('/simkl/info/'+i.id).then(r=>{
   if(!box.isConnected)return;const x=r.info;
   if(!x){slot.innerHTML=`<p class="mp-muted">${esc(t('simklNotFound'))}</p>`;return}
   const bits=[simklRating(x.ratings),x.runtime,(x.genres||[]).join(', '),x.status].filter(Boolean).map(esc).join(' · ');
   slot.innerHTML=`<div class="mp-simkl-info"><strong>Simkl</strong>${bits?`<p>${bits}</p>`:''}${x.overview?`<p class="mp-description">${esc(x.overview)}</p>`:''}<p>${x.url?`<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(t('simklOpen'))}</a>`:''}${x.imdb_url?` · <a href="${esc(x.imdb_url)}" target="_blank" rel="noopener noreferrer">IMDb</a>`:''}</p></div>`;
  }).catch(e=>{if(box.isConnected)slot.innerHTML=`<p class="mp-error">${esc(e.message)}</p>`});
 }
 function help(){dialog(t('help'),`<h3>${esc(t('compatibility'))}</h3><p>${esc(t('compatibilityHint'))}</p><h3>${esc(t('subtitles'))}</h3><p>${esc(t('subtitleHint'))}</p><h3>${esc(t('recognition'))}</h3><p>${esc(t('recognitionHint'))}</p><p class="mp-code">Series.Name/Season 02/Series.Name.S02E05.mp4<br>Movie.Name.2024.mp4</p><h3>Jellyfin</h3><p>${esc(t('jellyfinLater'))}</p>`)}
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.tab||b.dataset.go){s.tab=b.dataset.tab||b.dataset.go;s.category='';s.status='all';render()}
  else if(b.dataset.open)openDetail(b.dataset.open);
  else if(b.dataset.simklShow)run(()=>simklShowDialog(Number(b.dataset.simklShow)));
  else if(b.dataset.simklView){s.simklView=b.dataset.simklView;render()}
  else if(b.hasAttribute('data-simkl-connect'))run(simklConnect);
  else if(b.hasAttribute('data-simkl-disconnect'))run(simklDisconnect);
  else if(b.dataset.series)run(()=>seriesDialog(b.dataset.series));
  else if(b.dataset.favorite)run(()=>patchState(itemById(b.dataset.favorite),{favorite:!itemById(b.dataset.favorite).state.favorite}));
  else if(b.hasAttribute('data-sources'))run(sourcesDialog);
  else if(b.dataset.lookupId)lookupDialog(itemById(b.dataset.lookupId));
  else if(b.hasAttribute('data-help'))help();
  else if(b.hasAttribute('data-close-player'))run(stopPlayer);
  else if(b.hasAttribute('data-back-ten'))video.currentTime=Math.max(0,video.currentTime-10);
  else if(b.hasAttribute('data-forward-ten')&&Number.isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+10);
  else if(b.hasAttribute('data-fullscreen'))run(()=>document.fullscreenElement?document.exitFullscreen():stage.requestFullscreen?stage.requestFullscreen():video.webkitEnterFullscreen?.());
  else if(b.hasAttribute('data-pip'))run(async()=>{if(document.pictureInPictureElement)await document.exitPictureInPicture();else if(video.requestPictureInPicture)await video.requestPictureInPicture();else toast(t('pipUnavailable'))});
  else if(b.hasAttribute('data-next')){const next=nextItem();if(next)run(()=>loadVideo(next,true))}
  else if(b.hasAttribute('data-new-collection'))collectionDialog();
  else if(b.dataset.collection){s.tab='collection';s.collection=b.dataset.collection;render()}
  else if(b.dataset.editCollection)collectionDialog(s.collections.find(p=>p.id===b.dataset.editCollection));
 });
 root.addEventListener('change',e=>{
  if(e.target.matches('[data-speed]')){video.playbackRate=Number(e.target.value);saveProgress(true)}
  else if(e.target.matches('[data-subtitles]')){const v=e.target.value;if(v==='@translate'||v==='@file'){e.target.value=selectedSubtitle;run(v==='@file'?async()=>openLocalSubtitle():translateDialog)}else run(()=>setSubtitle(v))}
  else if(e.target.matches('[data-auto-next]'))s.autoNext=e.target.checked;
  else if(e.target.matches('[data-sort]')){s.sort=e.target.value;render()}
  else if(e.target.matches('[data-status]')){s.status=e.target.value;render()}
  else if(e.target.matches('[data-category]')){s.category=e.target.value;render()}
 });
 root.querySelector('[data-search]').oninput=e=>{s.query=e.target.value;render()};
 video.addEventListener('playing',()=>{if(!s.ready)return;s.played=true;if(s.current?.state.completed){s.current.state.completed=false;run(()=>patchState(s.current,{completed:false}))}saveProgress(true)});
 video.addEventListener('timeupdate',()=>saveProgress());
 video.addEventListener('pause',()=>{saveProgress(true);render()});
 video.addEventListener('seeked',()=>saveProgress(true));
 video.addEventListener('ended',()=>{saveProgress(true);render();const next=nextItem();if(next&&s.autoNext)run(()=>loadVideo(next,true))});
 video.addEventListener('error',()=>{if(!s.current||!video.getAttribute('src'))return;const el=root.querySelector('.mp-video-error');el.hidden=false;el.textContent=t('playbackError')});
 const onHide=()=>{if(document.hidden)saveProgress(true)};
 const onPageHide=()=>saveProgress(true);
 const onStorage=e=>{if(e.key==='apphub_token'){s.ready=false;run(stopPlayer);options.onNeedLogin?.()}};
 document.addEventListener('visibilitychange',onHide);window.addEventListener('pagehide',onPageHide);window.addEventListener('storage',onStorage);
 main.innerHTML=`<div class="mp-empty" role="status">${esc(t('loading'))}</div>`;const firstLoad=run(refresh);
 // A file opened from the file manager ("Open with"): it plays in this same player without joining the library.
 async function playFile(path){
  await firstLoad;if(s.dead)return;
  const name=path.split('/').pop();
  await loadVideo({id:'file:'+path,temp:true,kind:'video',title:name.replace(/\.[^.]+$/,'')||name,series:'',season:0,episode:0,year:0,original:name,subtitles:[],has_cover:false,percent:0,
   state:{seconds:0,duration:0,speed:1,completed:false,favorite:false,last_played:0},direct:'/api/apps/mvmplayer/file?path='+encodeURIComponent(path)},true);
 }
 return {playFile,openSettings(){run(settingsDialog)},destroy(){if(s.dead)return;saveProgress(true);s.dead=true;s.ready=false;s.played=false;s.load++;video.pause();video.removeAttribute('src');video.load();clearSubtitle();if(tempSubtitleUrl)URL.revokeObjectURL(tempSubtitleUrl);observer.disconnect();for(const r of coverCache.values())if(r.url)URL.revokeObjectURL(r.url);coverCache.clear();clearTimeout(toastTimer);document.removeEventListener('visibilitychange',onHide);window.removeEventListener('pagehide',onPageHide);window.removeEventListener('storage',onStorage);root.remove();host.classList.remove('mp-host')}};
}
window.MvmPlayer={mount};
})();
