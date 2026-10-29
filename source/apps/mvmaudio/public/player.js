(function(){
'use strict';
if(window.MvmAudio)return;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={home:'⌂',music:'♫',books:'▤',radio:'◉',favorites:'♡',history:'◷',playlists:'☷'};
const fmt=n=>{n=Math.max(0,Math.floor(Number(n)||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
const mb=n=>(Number(n)/1048576).toLocaleString(undefined,{maximumFractionDigits:1});
function mount(host,options={}){
 host.classList.add('ma-host');
 let lang=window.mvmOS?.lang||document.documentElement.lang||'en';
 let dict=window.MA_I18N[lang]||window.MA_I18N.en;
 const t=k=>dict[k]||window.MA_I18N.en[k]||k;
 const s={items:[],playlists:[],tab:'home',q:'',category:'',status:'all',sort:'recent',scope:'all',admin:null,manage:false,stats:null,statsView:'books',statsUser:'',statsFilter:'all',statsSort:'size',importBatch:[],importError:'',importKind:'music',limit:0,used:0,queue:[],current:null,track:null,shuffle:false,repeat:'off',sleep:0,sleepChapter:false,dead:false,loadId:0};
 let saveChain=Promise.resolve(),lastSave=0,modal=null,toastTimer,activeRequest=null,switching=false,pendingPosition=null;
 const token=()=>localStorage.getItem('apphub_token')||'';
 const coverCache=new Map();let coverRequests=0;
 const root=document.createElement('div');root.className='ma'+(options.desktop?' in-os':'');host.appendChild(root);
 root.innerHTML=`<aside class="ma-side"><div class="ma-brand"><span>♫</span>mvmAudio</div><small>${esc(t('library'))}</small><nav class="ma-nav">${Object.keys(icons).map(k=>`<button data-tab="${k}" class="${k==='home'?'active':''}"><i>${icons[k]}</i>${esc(t(k))}</button>`).join('')}</nav></aside><section class="ma-work"><header class="ma-top"><input class="ma-search" type="search" aria-label="${esc(t('search'))}" placeholder="${esc(t('search'))}"><div class="ma-top-actions"></div></header><main class="ma-main"></main></section><footer class="ma-player"></footer>`;
 const main=root.querySelector('.ma-main'),footer=root.querySelector('.ma-player');
 const audio=document.createElement('audio');audio.preload='metadata';audio.setAttribute('playsinline','');root.appendChild(audio);
 const localFields=['title','creator','category','album','description','narrator'];
 const languages=()=>s.languages||Object.keys(window.MA_I18N);
 const languageName=code=>{try{return new Intl.DisplayNames([lang],{type:'language'}).of(code)}catch{return code}};
 function translations(item){
   if(item?.translations&&Object.keys(item.translations).length)return structuredClone(item.translations);
   const entry=Object.fromEntries(localFields.map(k=>[k,item?.[k]||'']));
   const data={[languages().includes(item?.language)?item.language:lang]:entry};
   if(item?.original_title||item?.original_creator){data.en={...entry,title:item.original_title||entry.title,creator:item.original_creator||entry.creator};}
   return data;
 }
 function localized(item){
   const data=item.translations||{},choice=data[lang]||data.en||Object.values(data)[0];
   return {...item,...choice};
 }
 function toast(message){root.querySelector('.ma-toast')?.remove();const e=document.createElement('div');e.className='ma-toast';e.setAttribute('role','status');e.textContent=message;root.appendChild(e);clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.remove(),5000)}
 function explain(code){return t(typeof code==='string'&&window.MA_I18N.en[code]?code:'failed')}
 async function api(path,method='GET',body,admin=false,extra={}){
   const headers={'X-Pub-Token':token(),...extra.headers};
   if(body!==undefined)headers['Content-Type']='application/json';
   const res=await fetch((admin?'/api/apps/mvmaudio':'/pub/mvmaudio')+path,{...extra,method,headers,body:body===undefined?undefined:JSON.stringify(body)});
   if(!res.ok){let d={};try{d=await res.json()}catch{}if(res.status===401&&!admin){audio.pause();options.onNeedLogin?.();}const e=new Error(explain(d.detail||d.error));e.status=res.status;throw e;}
   return res.json();
 }
 const run=fn=>Promise.resolve().then(fn).catch(e=>{if(!s.dead)toast(e.message||t('failed'))});
 function button(key,attrs='',cls='ma-btn'){return `<button type="button" class="${cls}" ${attrs}>${esc(t(key))}</button>`}
 function icon(symbol,key,attrs=''){return `<button type="button" class="ma-icon" title="${esc(t(key))}" aria-label="${esc(t(key))}" ${attrs}>${symbol}</button>`}
 function field(key,value='',type='text',attrs='',label=key){return `<label class="ma-field">${esc(t(label))}<input name="${key}" type="${type}" value="${esc(value)}" ${attrs}></label>`}
 const mediaLabel=(kind,key)=>({music:{creator:'musicArtist',album:'musicAlbum'},books:{creator:'bookAuthor',album:'bookSeries'},radio:{title:'stationName'}}[kind]?.[key]||key);
 function closeModal(){if(!modal)return;const previous=modal._previous;modal.remove();modal=null;if(previous?.isConnected)previous.focus();}
 function dialog(title,content){
   closeModal();const el=document.createElement('div');el.className='ma-modal';el._previous=document.activeElement;
   el.innerHTML=`<section class="ma-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ma-dialog-head"><h2>${esc(title)}</h2></div>${icon('×','close','data-close="true" class="ma-dialog-close"')}<div class="ma-dialog-content">${content}</div></section>`;
   root.appendChild(el);modal=el;el.querySelector('[data-close]').classList.add('ma-dialog-close');el.querySelector('[data-close]').onclick=closeModal;
   el.onpointerdown=e=>{if(e.target===el&&!el._busy)closeModal()};
   el.onkeydown=e=>{if(e.key==='Escape'&&!el._busy){e.stopPropagation();closeModal();}if(e.key==='Tab'){const focus=[...el.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]')].filter(x=>x.offsetParent!==null);if(!focus.length){e.preventDefault();return;}const first=focus[0],last=focus.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===el.querySelector('.ma-dialog'))){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
   el.querySelector('.ma-dialog').focus();return el;
 }
 function artwork(item){return item.has_cover?`<img class="ma-cover-image" data-cover-id="${item.id}" data-cover-revision="${esc(item.cover_revision)}" data-cover-remote="${esc(item.cover_url)}" alt="" referrerpolicy="no-referrer">`:''}
 function hydrateCovers(){
   if(s.dead)return;
   for(const img of root.querySelectorAll('[data-cover-id]:not([data-cover-loaded])')){
     if(coverRequests>=4)break;
     img.dataset.coverLoaded='1';const id=img.dataset.coverId,rev=img.dataset.coverRevision,remote=img.dataset.coverRemote;
     const key=(s.manage?'admin':'user')+':'+id+':'+rev;
     for(const [k,record]of coverCache)if(record.id===id&&record.rev!==rev){if(record.url?.startsWith('blob:'))URL.revokeObjectURL(record.url);coverCache.delete(k)}
     if(!coverCache.has(key)){
       const record={id,rev,url:''};coverCache.set(key,record);
       record.promise=(async()=>{
         if(remote&&/^https:\/\/covers\.openlibrary\.org\/b\/id\/[0-9]+-L\.jpg\?default=false$/.test(remote))return record.url=window.asset(remote);
         const r=await fetch((s.manage?'/api/apps/mvmaudio':'/pub/mvmaudio')+'/media/'+id+'/cover',{headers:{'X-Pub-Token':token()}});
         if(!r.ok)return '';
         const url=URL.createObjectURL(await r.blob());if(s.dead||coverCache.get(key)!==record){URL.revokeObjectURL(url);return '';}return record.url=url;
       })().catch(()=>'');
     }
     coverRequests++;
     coverCache.get(key).promise.then(url=>{if(!url||!img.isConnected||s.dead)return;img.onload=()=>{img.parentElement?.classList.add('has-art');if(s.current?.id===id)mediaSession()};img.onerror=()=>img.remove();img.src=window.asset(url);}).finally(()=>{coverRequests--;hydrateCovers()});
   }
 }
 const artObserver=new MutationObserver(hydrateCovers);artObserver.observe(root,{childList:true,subtree:true});
 function cover(item,attrs=''){
   let hue=0;for(const c of item.id)hue=(hue*31+c.charCodeAt(0))%360;
   return `<button class="ma-cover ${item.kind}" style="--h:${hue}" ${attrs} aria-label="${esc(t(s.manage?'edit':'open')+': '+item.title)}">${artwork(item)}<small>${esc(item.creator||t(item.kind))}</small><strong>${esc(item.title)}</strong><small>${esc(item.category||item.album||'mvmAudio')}</small></button>`;
 }
 const percent=value=>Math.max(0,Math.min(100,Number(value)||0)).toLocaleString(lang,{maximumFractionDigits:1})+'%';
 function card(item){const st=item.state;return `<article class="ma-card">${cover(item,`data-detail="${item.id}"`)}<div class="ma-card-heading"><button class="ma-titlebtn" data-detail="${item.id}">${esc(item.title)}</button>${icon(st.favorite?'♥':'♡','favorites',`data-favorite="${item.id}"`)}</div><div class="ma-meta">${esc(item.creator||item.album||t(item.kind))}</div>${item.kind==='books'?`<div class="ma-progress"><span style="width:${item.percent}%"></span></div><div class="ma-card-progress"><span>${st.completed?'✓ '+esc(t('completed')):percent(item.percent)}</span><span>${fmt((item.duration-item.elapsed)/(st.speed||1))} ${esc(t('left'))}</span></div>`:''}</article>`}
 function filterItems(){let items=s.manage?s.admin.items:s.items;const q=s.q.toLocaleLowerCase();items=items.filter(i=>
   (!['music','books','radio'].includes(s.tab)||i.kind===s.tab)&&
   (s.tab!=='favorites'||i.state.favorite)&&(s.tab!=='history'||i.state.last_played)&&
   (!q||[i.title,i.creator,i.category,i.album,...Object.values(i.translations||{}).flatMap(v=>[v.title,v.creator])].some(x=>(x||'').toLocaleLowerCase().includes(q)))&&
   (!s.category||i.category===s.category)&&(s.scope==='all'||s.scope==='shared'&&i.shared||s.scope==='mine'&&i.mine)&&
   (s.status==='all'||s.status==='completed'&&i.state.completed||s.status==='unread'&&!i.state.completed&&!i.elapsed||s.status==='started'&&!i.state.completed&&i.elapsed>0));
   return [...items].sort((a,b)=>s.sort==='title'?a.title.localeCompare(b.title,lang):s.sort==='creator'?a.creator.localeCompare(b.creator,lang):s.tab==='history'?b.state.last_played-a.state.last_played:b.created-a.created);
 }
 function renderTop(){root.querySelector('.ma-top-actions').innerHTML=`${options.desktop&&s.admin?`<button type="button" class="ma-btn" data-manage title="${esc(t(s.manage?'listen':'manage'))}" aria-label="${esc(t(s.manage?'listen':'manage'))}">▦ <span>${esc(t(s.manage?'listen':'manage'))}</span></button>` :''}${s.manage?`<button type="button" class="ma-btn" data-statistics title="${esc(t('statistics'))}" aria-label="${esc(t('statistics'))}">▥ <span>${esc(t('statistics'))}</span></button>`:''}${s.manage||s.limit>0?button('add','data-add','ma-btn primary'):''}${icon('☷','queue','data-queue')}${icon('⚙','settings','data-settings')}`;}
 function render(){
   if(s.dead)return;
   renderTop();root.querySelectorAll('[data-tab]').forEach(b=>{b.classList.toggle('active',b.dataset.tab===s.tab);b.innerHTML=`<i>${icons[b.dataset.tab]}</i>${esc(t(b.dataset.tab))}`});root.querySelector('.ma-search').placeholder=t('search');root.querySelector('.ma-search').setAttribute('aria-label',t('search'));root.querySelector('.ma-side small').textContent=t('library');
   if(s.tab==='imports'){renderImports();return;}
   if(s.tab==='statistics'&&s.manage){renderStatistics();return;}
   if(s.tab==='home'&&!s.q&&!s.manage){
     const continuing=s.items.filter(i=>i.kind==='books'&&i.elapsed>0&&!i.state.completed).sort((a,b)=>b.state.last_played-a.state.last_played).slice(0,5);
     main.innerHTML=`<div class="ma-hero"><div class="ma-eyebrow">${esc(t('yourSpace'))}</div><h1>${esc(t('welcome'))}</h1><p>${esc(t('subtitle'))}</p><div class="ma-actions">${button('books','data-go="books"','ma-btn primary')}${button('music','data-go="music"')}</div></div>${continuing.length?`<h2>${esc(t('continue'))}</h2><div class="ma-grid">${continuing.map(card).join('')}</div>`:''}<h2>${esc(t('recent'))}</h2><div class="ma-grid">${s.items.slice(0,10).map(card).join('')}</div>${!s.items.length?empty():''}`;return;
   }
   if(s.tab==='playlists'){
     const lists=s.manage?s.admin.playlists:s.playlists;
     main.innerHTML=`<div class="ma-heading"><h1>${esc(t('playlists'))}</h1>${button('newPlaylist','data-new-playlist','ma-btn primary')}</div><p class="ma-muted">${esc(t(s.manage?'sharedPlaylists':'playlistHint'))}</p><div class="ma-list">${lists.map(p=>`<div class="ma-row"><span class="ma-thumb">☷</span><div class="ma-grow"><strong>${esc(p.title)}</strong><span class="ma-meta">${p.items.length} · ${esc(t(p.shared||s.manage?'shared':p.mine?'mine':'sharedWithMe'))}</span></div>${icon('▶','play',`data-playlist-play="${p.id}"`)}${button('open',`data-playlist="${p.id}"`)}</div>`).join('')}</div>${!lists.length?empty():''}`;return;
   }
   const items=filterItems();const categories=[...new Set((s.manage?s.admin.items:s.items).filter(i=>!['music','books','radio'].includes(s.tab)||i.kind===s.tab).map(i=>i.category).filter(Boolean))].sort();
   main.innerHTML=`<div class="ma-heading"><div><div class="ma-eyebrow">${esc(t(s.manage?'commonLibrary':'library'))}</div><h1>${esc(t(s.tab))}</h1></div><select data-sort aria-label="${esc(t('sort'))}">${['recent','title','creator'].map(k=>`<option value="${k}" ${s.sort===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select></div><div class="ma-chips">${['all',...categories].map(c=>`<button class="ma-chip ${(c==='all'?!s.category:s.category===c)?'active':''}" data-category="${esc(c==='all'?'':c)}">${esc(c==='all'?t('all'):c)}</button>`).join('')}</div><div class="ma-chips">${!s.manage?['all','shared','mine'].map(k=>`<button class="ma-chip ${s.scope===k?'active':''}" data-scope="${k}">${esc(t(k))}</button>`).join(''):''}${s.tab==='books'?`<select data-status aria-label="${esc(t('status'))}">${['all','started','unread','completed'].map(k=>`<option value="${k}" ${s.status===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select>`:''}</div><div class="ma-grid">${items.map(card).join('')}</div>${!items.length?empty():''}`;
 }
 function empty(){return `<div class="ma-empty"><b>${esc(t('empty'))}</b>${esc(t(s.manage?'emptyAdmin':'emptyHint'))}</div>`}
 async function refresh(){
   await persist();
   const data=await api('/library');if(s.dead)return;
   s.languages=data.languages||Object.keys(window.MA_I18N);
   if(!options.desktop&&data.user_language&&data.user_language!=='auto'&&languages().includes(data.user_language)){lang=data.user_language;dict=window.MA_I18N[lang]||window.MA_I18N.en;}
   s.items=data.items.map(localized);s.playlists=data.playlists;s.limit=data.upload_limit_mb;s.used=data.used_bytes;s.uid=data.user_id;
   if(options.desktop){try{s.admin=await api('/admin','GET',undefined,true);s.admin.items=s.admin.items.map(localized)}catch{s.admin=null;s.manage=false}}
   if(s.current){const fresh=s.items.find(i=>i.id===s.current.id);if(fresh){fresh.state={...fresh.state,...s.current.state};s.current=fresh}else{audio.pause();s.current=null;s.track=null;s.queue=[];audio.removeAttribute('src');audio.load();}}
   if(s.admin)for(const item of s.admin.items){const personal=s.items.find(i=>i.id===item.id);if(personal){item.state=personal.state;item.elapsed=personal.elapsed;item.percent=personal.percent;}}
   render();paintPlayer();
 }
 function paintPlayer(){
   if(s.dead)return;const i=s.current;
   footer.innerHTML=`<div class="ma-playing"><button class="ma-thumb ma-icon" data-now aria-label="${esc(t('nowPlaying'))}">${i?(i.has_cover?artwork(i):icons[i.kind]):'♫'}</button><div style="min-width:0"><strong>${esc(i?.title||t('nothingPlaying'))}</strong><div class="ma-meta">${esc(i?(s.track?.title||i.creator||t(i.kind)):t('chooseAudio'))}</div></div></div><div class="ma-player-center"><div class="ma-controls">${icon('⤨','shuffle',`data-shuffle class="${s.shuffle?'active':''}"`)}${icon('◀','previous','data-previous')}${icon('−15','rewind','data-rewind')}<button class="ma-play" data-toggle aria-label="${esc(t(audio.paused?'play':'pause'))}">${audio.paused?'▶':'Ⅱ'}</button>${icon('+30','forward','data-forward')}${icon('▶','next','data-next')}${icon(s.repeat==='one'?'↻¹':'↻','repeat',`data-repeat`)}</div><div class="ma-timeline"><span data-time>00:00</span><input data-seek type="range" min="0" max="100" value="0" step="0.1" aria-label="${esc(t('seek'))}"><span data-duration>00:00</span></div></div><div class="ma-player-right"><select data-speed aria-label="${esc(t('speed'))}">${[.5,.75,1,1.25,1.5,1.75,2,2.5,3].map(n=>`<option value="${n}" ${n===(i?.state.speed||1)?'selected':''}>${n}×</option>`).join('')}</select>${icon('◷','sleep','data-sleep')}${icon('☷','queue','data-queue')}<input type="range" data-volume min="0" max="1" step="0.05" value="${audio.volume}" aria-label="${esc(t('volume'))}"></div>`;
   footer.querySelector('[data-shuffle]').classList.toggle('active',s.shuffle);footer.querySelector('[data-repeat]').classList.toggle('active',s.repeat!=='off');tick();
 }
 function snapshot(played=false){if(!s.current||switching||pendingPosition!==null||(s.track&&audio.readyState<1))return null;const d={speed:audio.playbackRate,played};if(s.track){d.track_id=s.track.id;d.seconds=audio.currentTime||0;}return {id:s.current.id,body:d};}
 function persist(played=false){if(switching||s.dead)return Promise.resolve();const data=snapshot(played);if(!data)return Promise.resolve();lastSave=Date.now();
   if(s.track){s.current.state.track_id=s.track.id;s.current.state.seconds=data.body.seconds;}
   s.current.state.speed=data.body.speed;if(played)s.current.state.last_played=Date.now()/1000;
   saveChain=saveChain.catch(()=>{}).then(()=>api('/media/'+data.id+'/state','PUT',data.body));
   saveChain.catch(()=>{});return saveChain;
 }
 async function stateChange(i,body){await api('/media/'+i.id+'/state','PUT',body);Object.assign(i.state,body);}
 async function play(mid,trackId=null,seconds=null,queue=null,autoplay=true){
   const i=s.items.find(i=>i.id===mid);if(!i){throw Error(t('not_found'));}
   const load=++s.loadId;await persist();if(load!==s.loadId||s.dead)return;switching=true;audio.pause();
   if(queue)s.queue=queue.filter(id=>s.items.some(i=>i.id===id));
   else if(!s.queue.includes(mid))s.queue=i.kind==='music'?filterItems().filter(x=>x.kind==='music').map(x=>x.id):[mid];
   if(!s.queue.includes(mid))s.queue=[mid];
   s.current=i;
   const resumed=i.kind==='books'&&!i.state.completed;
   s.track=i.kind==='radio'?null:i.tracks.find(t=>t.id===(trackId||(resumed?i.state.track_id:'')))||i.tracks[0];
   if(i.kind!=='radio'&&!s.track){switching=false;s.current=null;paintPlayer();throw Error(t('noTracks'));}
   const pos=seconds!==null?seconds:resumed&&s.track.id===i.state.track_id?i.state.seconds:0;
   const rate=i.kind==='radio'?1:(i.kind==='books'?i.state.speed||1:1);audio.defaultPlaybackRate=rate;audio.playbackRate=rate;
   let url=i.url;
   if(s.track){try{url=(await api('/tracks/'+s.track.id+'/ticket','POST')).url}catch(e){switching=false;throw e}}
   if(load!==s.loadId||s.dead)return;
   if(autoplay&&i.state.completed&&i.kind==='books'){await stateChange(i,{completed:false,track_id:s.track.id,seconds:pos});}
   pendingPosition=s.track?Math.max(0,Math.min(pos,Math.max(0,s.track.duration-.25))):null;
   audio.src=window.asset(url);audio.playbackRate=rate;
   paintPlayer();
   if(!autoplay){switching=false;return;}
   try{await audio.play();if(load!==s.loadId)return;switching=false;await persist(true)}catch(e){switching=false;if(e.name!=='AbortError'){paintPlayer();throw Error(t('playFailed'))}}
 }
 async function startPlayback(){
   if(!s.current||switching)return;
   if(s.current.kind==='books'&&s.current.state.completed&&s.track)await stateChange(s.current,{completed:false,track_id:s.track.id,seconds:audio.currentTime||0});
   await audio.play();await persist(true);
 }
 async function next(direction=1,automatic=false){
   if(!s.current)return;const i=s.current;
   if(s.track&&direction===-1&&audio.currentTime>3){audio.currentTime=0;return;}
   if(automatic&&s.repeat==='one'){await play(i.id,s.track?.id,0);return;}
   if(s.track){const n=i.tracks.findIndex(t=>t.id===s.track.id)+direction;
     if(n>=0&&n<i.tracks.length){await play(i.id,i.tracks[n].id,0);return;}
   }
   if(automatic&&i.kind==='books'){await stateChange(i,{completed:true});i.elapsed=i.duration;i.percent=100;render();}
   let n=s.queue.indexOf(i.id)+direction;
   if(s.shuffle&&i.kind==='music'&&s.queue.length>1){const candidates=s.queue.filter(id=>id!==i.id);n=s.queue.indexOf(candidates[Math.floor(Math.random()*candidates.length)]);}
   if((n<0||n>=s.queue.length)&&s.repeat==='all')n=(n+s.queue.length)%s.queue.length;
   if(n>=0&&n<s.queue.length)await play(s.queue[n],null,null,s.queue);
   else {audio.pause();paintPlayer();}
 }
 function tick(){
   if(s.sleep&&Date.now()>=s.sleep){s.sleep=0;audio.pause();toast(t('sleepDone'));}
   const i=s.current,duration=Number.isFinite(audio.duration)?audio.duration:s.track?.duration||0,pos=audio.currentTime||0;
   const seek=footer.querySelector('[data-seek]');if(!seek)return;
   seek.disabled=!s.track;seek.max=duration||100;seek.value=pos;footer.querySelector('[data-time]').textContent=i?.kind==='radio'?t('live'):fmt(pos);footer.querySelector('[data-duration]').textContent=i?.kind==='radio'?'◉':fmt(duration);
   if(i&&s.track&&!i.state.completed&&!switching&&pendingPosition===null&&audio.readyState>=1){const before=i.tracks.slice(0,i.tracks.findIndex(x=>x.id===s.track.id)).reduce((n,t)=>n+t.duration,0);i.elapsed=before+pos;i.percent=i.duration?Math.min(100,i.elapsed/i.duration*100):0;}
   if('mediaSession'in navigator&&s.track&&duration>0){try{navigator.mediaSession.setPositionState({duration,playbackRate:audio.playbackRate,position:Math.min(pos,duration)})}catch{}}
 }
 function mediaSession(){
   if(s.dead||!('mediaSession'in navigator)||!s.current)return;
   const m=navigator.mediaSession,i=s.current;
   const art=[...coverCache.values()].find(x=>x.id===i.id&&x.rev===i.cover_revision&&x.url)?.url||i.cover_url;
   if(window.MediaMetadata)m.metadata=new MediaMetadata({title:i.title,artist:i.creator,album:i.album||t(i.kind),artwork:art?[{src:art}]:[]});
   if(!s.track)try{m.setPositionState()}catch{}
   m.playbackState=audio.paused?'paused':'playing';
   const actions={play:()=>run(startPlayback),pause:()=>audio.pause(),previoustrack:()=>run(()=>next(-1)),nexttrack:()=>run(()=>next()),seekbackward:d=>seekBy(-(d.seekOffset||15)),seekforward:d=>seekBy(d.seekOffset||30),seekto:d=>{if(s.track&&Number.isFinite(d.seekTime))audio.currentTime=Math.min(d.seekTime,s.track.duration)},stop:()=>{audio.pause();}};
   for(const [name,fn]of Object.entries(actions))try{m.setActionHandler(name,fn)}catch{}
 }
 function seekBy(delta){if(s.track)audio.currentTime=Math.max(0,Math.min(s.track.duration,audio.currentTime+delta));}
 audio.addEventListener('timeupdate',()=>{tick();if(!audio.paused&&Date.now()-lastSave>10000)persist().catch(()=>toast(t('saveFailed')))});
 audio.addEventListener('play',()=>{paintPlayer();mediaSession()});
 audio.addEventListener('pause',()=>{paintPlayer();mediaSession();persist().catch(()=>{})});
 audio.addEventListener('seeked',()=>{persist().catch(()=>{});tick()});
 audio.addEventListener('ratechange',()=>{persist().catch(()=>{});tick()});
 audio.addEventListener('ended',()=>run(async()=>{await persist();if(s.sleepChapter){s.sleepChapter=false;if(s.current?.kind==='books'&&s.current.tracks.at(-1)?.id===s.track?.id)await stateChange(s.current,{completed:true});toast(t('sleepDone'));paintPlayer();return;}await next(1,true)}));
 audio.addEventListener('error',()=>{if(s.current&&!s.dead){paintPlayer();toast(t(s.current.kind==='radio'?'radioFailed':'playFailed'))}});
 audio.addEventListener('loadedmetadata',()=>{if(pendingPosition!==null){const pos=pendingPosition;audio.currentTime=pos;pendingPosition=null;}tick()});
 function flush(){const d=snapshot();if(d)fetch('/pub/mvmaudio/media/'+d.id+'/state',{method:'PUT',headers:{'Content-Type':'application/json','X-Pub-Token':token()},body:JSON.stringify(d.body),keepalive:true}).catch(()=>{});}
 function visibility(){if(document.hidden)persist().catch(()=>{});else run(refresh)}
 document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',flush);
 async function detail(mid){
   const i=(s.manage?s.admin.items:s.items).find(i=>i.id===mid);if(!i)return;
   if(!s.manage&&i.kind==='books'&&i.tracks.length&&s.current?.id!==mid)await play(mid,null,null,null,false);
   const editable=s.manage||i.mine;
   const box=dialog(i.title,`<div class="ma-detail-top"><div class="ma-detail-cover">${cover(i)}</div><div><p>${esc(i.creator)}</p><p>${esc(i.category)}${i.album?' · '+esc(i.album):''}</p><p>${i.kind==='radio'?esc(t('live')):fmt(i.duration)}</p><span class="ma-scope">${esc(t(i.shared?'shared':i.mine?'mine':'sharedWithMe'))}</span></div></div>${i.description?`<p style="white-space:pre-wrap">${esc(i.description)}</p>`:''}${[i.year,i.narrator,i.language,i.isbn].filter(Boolean).length?`<p class="ma-hint">${[i.year,i.narrator,i.language,i.isbn].filter(Boolean).map(esc).join(' · ')}</p>`:''}${i.metadata_url?`<p class="ma-hint">${esc(t('source'))}: <a href="${esc(i.metadata_url)}" target="_blank" rel="noopener noreferrer">${esc(i.metadata_source)}</a></p>`:''}<div class="ma-actions">${!s.manage&&i.kind!=='books'?button('play',`data-detail-play="${i.id}"`,'ma-btn primary'):''}${!s.manage?button('addToPlaylist','data-add-to-playlist'):''}${!s.manage?button('share','data-share-item'):''}${editable?button('edit','data-edit-item'):''}${editable&&i.kind!=='radio'?button('metadata','data-metadata'):''}${i.kind==='books'&&!s.manage?button(i.state.completed?'markUnread':'markRead','data-complete'):''}${editable?button('delete','data-delete-item','ma-btn danger'):''}</div>${i.kind==='books'?`<div class="ma-progress"><span style="width:${i.percent}%"></span></div><p class="ma-muted">${percent(i.percent)} · ${fmt((i.duration-i.elapsed)/(i.state.speed||1))} ${esc(t('left'))}</p>`:''}${i.tracks.length?`<h3>${esc(t('chapters'))}</h3><div class="ma-list">${i.tracks.map((track,n)=>`<div class="ma-row"><span class="ma-queue-number">${n+1}</span><div class="ma-grow"><strong>${esc(track.title)}</strong><span class="ma-meta">${fmt(track.duration)}</span></div>${!s.manage?icon(i.kind==='books'?'↳':'▶',i.kind==='books'?'open':'play',`data-chapter="${track.id}"`):''}${editable?icon('↑','moveUp',`data-up="${n}" ${n===0?'disabled':''}`)+icon('↓','moveDown',`data-down="${n}" ${n===i.tracks.length-1?'disabled':''}`)+icon('×','delete',`data-remove-track="${track.id}"`):''}</div>`).join('')}</div>`:''}${editable&&i.kind!=='radio'?`<div class="ma-actions">${button('addChapters','data-add-chapters')}</div>`:''}${i.kind==='books'&&!s.manage?`<h3>${esc(t('bookmarks'))}</h3><div data-bookmarks></div>`:''}`);
   box.querySelector('.ma-detail-cover').onclick=null;
   box.querySelector('[data-detail-play]')?.addEventListener('click',()=>run(()=>play(i.id)));
   box.querySelector('[data-edit-item]')?.addEventListener('click',()=>editMedia(i));
   box.querySelector('[data-metadata]')?.addEventListener('click',()=>run(()=>metadataDialog(i)));
   box.querySelector('[data-delete-item]')?.addEventListener('click',()=>confirmDelete(()=>api('/media/'+i.id,'DELETE',undefined,s.manage).then(()=>{closeModal();return refresh()})));
   box.querySelector('[data-complete]')?.addEventListener('click',()=>run(async()=>{await stateChange(i,{completed:!i.state.completed});await refresh();await detail(mid)}));
   box.querySelector('[data-add-to-playlist]')?.addEventListener('click',()=>addToPlaylist(i));
   box.querySelector('[data-share-item]')?.addEventListener('click',()=>run(async()=>{const p=await api('/playlists','POST',{title:i.title,items:[i.id]});await refresh();await sharing(p.id)}));
   box.querySelector('[data-add-chapters]')?.addEventListener('click',()=>uploadDialog(i));
   box.querySelectorAll('[data-chapter]').forEach(b=>b.onclick=()=>run(()=>play(mid,b.dataset.chapter,0,null,i.kind!=='books')));
   const reorder=(n,delta)=>run(async()=>{const ids=i.tracks.map(t=>t.id);[ids[n],ids[n+delta]]=[ids[n+delta],ids[n]];await api('/media/'+mid+'/tracks/order','PUT',{ids},s.manage);await refresh();await detail(mid)});
   box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>reorder(Number(b.dataset.up),-1));box.querySelectorAll('[data-down]').forEach(b=>b.onclick=()=>reorder(Number(b.dataset.down),1));
   box.querySelectorAll('[data-remove-track]').forEach(b=>b.onclick=()=>confirmDelete(async()=>{await api('/media/'+mid+'/tracks/'+b.dataset.removeTrack,'DELETE',undefined,s.manage);await refresh();await detail(mid)}));
   if(box.querySelector('[data-bookmarks]')){
     const marks=await api('/media/'+mid+'/bookmarks');if(!box.isConnected)return;
     box.querySelector('[data-bookmarks]').innerHTML=marks.map(b=>`<div class="ma-row"><div class="ma-grow">${esc(b.title)}<div class="ma-meta">${fmt(b.seconds)}</div></div>${icon('▶','play',`data-mark="${b.id}"`)}${icon('×','delete',`data-delete-mark="${b.id}"`)}</div>`).join('')||`<p class="ma-hint">${esc(t('bookmarkHint'))}</p>`;
     box.querySelectorAll('[data-mark]').forEach(b=>b.onclick=()=>run(()=>{const mark=marks.find(m=>m.id===b.dataset.mark);return play(mid,mark.track_id,mark.seconds,null,false)}));
     box.querySelectorAll('[data-delete-mark]').forEach(b=>b.onclick=()=>run(async()=>{await api('/bookmarks/'+b.dataset.deleteMark,'DELETE');await detail(mid)}));
   }
 }
 function confirmDelete(fn){const box=dialog(t('delete'),`<p>${esc(t('deleteConfirm'))}</p><div class="ma-actions">${button('delete','data-confirm','ma-btn danger')}${button('cancel','data-cancel')}</div>`);box.querySelector('[data-confirm]').onclick=()=>run(fn);box.querySelector('[data-cancel]').onclick=closeModal;}
 function editMedia(item=null,initialKind=null){
   const kind=item?.kind||initialKind||(['music','books','radio'].includes(s.tab)?s.tab:'music');
   const entries=translations(item);
   const box=dialog(t(item?'edit':'add'),`<form class="ma-form two"><label class="ma-field">${esc(t('type'))}<select name="kind" ${item?'disabled':''}>${['music','books','radio'].map(k=>`<option value="${k}" ${k===kind?'selected':''}>${esc(t(k))}</option>`).join('')}</select></label>${field('url',item?.url||'','url','placeholder="https://…"')}<div class="wide" data-variants></div><div class="ma-actions wide"><select data-new-lang aria-label="${esc(t('language'))}"></select>${button('addLanguage','data-add-language')}</div>${field('year',item?.year||'','text','maxlength="20"')}${field('language',item?.language||'','text','maxlength="40"','audioLanguage')}${field('isbn',item?.isbn||'','text','maxlength="32"')}<p class="ma-hint wide">${esc(t('mediaHint'))}</p><div class="ma-actions wide"><button class="ma-btn primary" type="submit">${esc(t('save'))}</button>${button('cancel','data-cancel')}${item&&kind!=='radio'?button('metadata','data-edit-metadata')+button('addChapters','data-edit-upload')+button('chapters','data-edit-chapters'):''}${item&&kind==='books'&&s.manage?button('statistics','data-edit-statistics'):''}${item?button('delete','data-edit-delete','ma-btn danger'):''}</div><div class="ma-error wide" role="alert"></div></form>`);
   const form=box.querySelector('form'),holder=box.querySelector('[data-variants]');
   let syncFields=()=>{};
   const read=()=>Object.fromEntries([...holder.querySelectorAll('[data-variant]')].map(el=>[el.querySelector('[data-variant-lang]').value,Object.fromEntries(localFields.map(k=>[k,el.querySelector(`[name="${k}"]`).value.trim()]))]));
   const updateOptions=()=>{const used=[...holder.querySelectorAll('[data-variant-lang]')].map(el=>el.value);const available=languages().filter(code=>!used.includes(code));box.querySelector('[data-new-lang]').innerHTML=available.map(code=>`<option value="${code}">${esc(languageName(code))}</option>`).join('');box.querySelector('[data-add-language]').disabled=!available.length;holder.querySelectorAll('[data-remove-language]').forEach(b=>b.disabled=used.length===1);};
   const add=(code,entry={})=>{
     const group=document.createElement('fieldset');group.className='ma-language-block ma-form two';group.dataset.variant='';
     group.innerHTML=`<div class="ma-actions wide"><label class="ma-field ma-grow">${esc(t('language'))}<select data-variant-lang>${languages().map(l=>`<option value="${l}" ${l===code?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label>${button('removeLanguage','data-remove-language')}</div>${localFields.map(k=>k==='description'?`<label class="ma-field wide">${esc(t(k))}<textarea name="description" maxlength="4000">${esc(entry[k]||'')}</textarea></label>`:field(k,entry[k]||'','text',`maxlength="${k==='category'?100:200}" ${k==='title'?'required':''}`)).join('')}`;
     holder.appendChild(group);let previous=code;
     group.querySelector('[data-variant-lang]').onchange=e=>{if([...holder.querySelectorAll('[data-variant-lang]')].some(el=>el!==e.target&&el.value===e.target.value)){e.target.value=previous;return;}previous=e.target.value;updateOptions()};
     group.querySelector('[data-remove-language]').onclick=()=>{group.remove();updateOptions()};updateOptions();syncFields();
   };
   const ordered=Object.keys(entries);if(ordered.includes(lang))ordered.splice(0,0,...ordered.splice(ordered.indexOf(lang),1));ordered.forEach(code=>add(code,entries[code]));
   box.querySelector('[data-add-language]').onclick=()=>add(box.querySelector('[data-new-lang]').value);
   box.querySelector('[data-cancel]').onclick=closeModal;
   box.querySelector('[data-edit-statistics]')?.addEventListener('click',()=>run(async()=>{await loadStatistics();statsBook(item.id)}));
   box.querySelector('[data-edit-upload]')?.addEventListener('click',()=>uploadDialog(item));
   box.querySelector('[data-edit-delete]')?.addEventListener('click',()=>confirmDelete(async()=>{await api('/media/'+item.id,'DELETE',undefined,s.manage);closeModal();await refresh()}));
   box.querySelector('[data-edit-metadata]')?.addEventListener('click',()=>run(()=>metadataDialog(item)));
   box.querySelector('[data-edit-chapters]')?.addEventListener('click',()=>run(()=>detail(item.id)));
   const url=form.elements.url.closest('label');
   const change=()=>{
     const selected=form.elements.kind.value;
     form.elements.isbn.closest('label').hidden=selected!=='books';
     for(const key of ['year','language'])form.elements[key].closest('label').hidden=selected==='radio';
     url.hidden=selected!=='radio';form.elements.url.required=!url.hidden;
     for(const group of holder.querySelectorAll('[data-variant]'))for(const key of localFields){
       const input=group.querySelector(`[name="${key}"]`),label=input.closest('label');
       label.hidden=key==='narrator'?selected!=='books':selected==='radio'&&['creator','album'].includes(key);
       label.firstChild.nodeValue=t(mediaLabel(selected,key));
     }
   };syncFields=change;change();form.elements.kind.onchange=change;
   form.onsubmit=async e=>{e.preventDefault();const save=form.querySelector('[type=submit]');save.disabled=true;try{const names=read(),body=Object.fromEntries(new FormData(form));Object.assign(body,Object.values(names)[0]);body.translations=names;body.kind=form.elements.kind.value;const d=await api('/media'+(item?'/'+item.id:''),item?'PUT':'POST',body,s.manage);await refresh();if(item&&s.tab==='statistics')await loadStatistics();if(!item&&body.kind!=='radio')uploadDialog((s.manage?s.admin.items:s.items).find(i=>i.id===d.id));else closeModal()}catch(e){box.querySelector('.ma-error').textContent=e.message}finally{save.disabled=false}};
 }
 async function metadataDialog(item,initialResults=null){
   const admin=s.manage,entries=translations(item),codes=Object.keys(entries);
   if(!Object.keys(item.translations||{}).length){await api('/media/'+item.id,'PUT',{...item,translations:entries},admin);item.translations=entries;await refresh();}
   let lookupLang=codes.includes(lang)?lang:codes.includes('en')?'en':codes[0];
   const entry=()=>entries[lookupLang];
   const box=dialog(t('metadata'),`<p class="ma-hint">${esc(t('metadataHint'))}</p>${item.kind==='books'?`<p class="ma-hint">${esc(t('bookLookupHint'))}</p>`:''}<form class="ma-form two" data-meta-form>${codes.length>1?`<label class="ma-field wide">${esc(t('searchLanguage'))}<select data-lookup-lang>${codes.map(l=>`<option value="${l}" ${l===lookupLang?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label>`:''}${field('title',entry().title,'text','required maxlength="200"')}${field('creator',entry().creator,'text','maxlength="200"')}${item.kind==='music'?field('album',entry().album,'text','maxlength="200"'):field('isbn',item.isbn||'','text','maxlength="32"')}<div class="ma-actions wide"><button class="ma-btn primary" type="submit">${esc(t('searchOnline'))}</button>${button('readTags','data-read-tags')}</div></form><label class="ma-field" style="margin-top:18px"><input type="checkbox" data-overwrite> ${esc(t('overwriteMetadata'))}</label><div class="ma-error" role="alert"></div><div data-meta-results></div><div data-meta-preview></div><h3>${esc(t('cover'))}</h3><p class="ma-hint">${esc(t('coverHint'))}</p><input data-cover-file type="file" accept="image/png,image/jpeg,image/webp" aria-label="${esc(t('cover'))}"><div class="ma-actions">${button('uploadCover','data-cover-upload')}${item.has_cover?button('removeCover','data-cover-remove'):''}</div>`);
   const error=box.querySelector('.ma-error'),form=box.querySelector('[data-meta-form]');let chosen=null;
   for(const key of ['title','creator','album']){const input=form.elements[key];if(input)input.closest('label').firstChild.nodeValue=t(mediaLabel(item.kind,key));}
   const overwrite=()=>box.querySelector('[data-overwrite]').checked;
   function preview(){
     if(!chosen)return;
     const keys=['title','creator','album','category','year','language','isbn','narrator','description','cover'].filter(k=>k==='cover'?chosen.cover_url:chosen[k]);
     box.querySelector('[data-meta-preview]').innerHTML=`<h3>${esc(t('previewMetadata'))}</h3><div class="ma-checklist">${keys.map(k=>{const locked=!!(k==='cover'?item.has_cover:(localFields.includes(k)?entry()[k]:item[k]))&&!overwrite();return `<label><input type="checkbox" data-meta-field="${k}" ${locked?'':'checked'}><span><strong>${esc(t(mediaLabel(item.kind,k)))}</strong><span class="ma-meta-value">${k==='cover'?esc(t('cover')):esc(chosen[k])}</span>${locked?`<small class="ma-muted">${esc(t('keepExisting'))}</small>`:''}</span></label>`}).join('')}</div><p class="ma-hint"><a href="${esc(chosen.url)}" target="_blank" rel="noopener noreferrer">${esc(chosen.provider)}</a></p><div class="ma-actions">${button('applyMetadata','data-meta-apply','ma-btn primary')}</div>`;
     const apply=box.querySelector('[data-meta-apply]'),update=()=>{apply.disabled=!box.querySelector('[data-meta-field]:checked');box.querySelectorAll('[data-meta-field]').forEach(el=>{const hint=el.closest('label').querySelector('small');if(hint)hint.hidden=el.checked})};box.querySelectorAll('[data-meta-field]').forEach(el=>el.onchange=update);update();
     box.querySelector('[data-meta-apply]').onclick=async()=>{const b=box.querySelector('[data-meta-apply]');b.disabled=true;error.textContent='';try{const fields=[...box.querySelectorAll('[data-meta-field]:checked')].map(x=>x.dataset.metaField);const r=await api('/media/'+item.id+'/metadata/apply','POST',{candidate_id:chosen.id,fields,overwrite:true,lang:lookupLang},admin);s.importBatch.filter(row=>row.id===item.id).forEach(row=>{row.candidates=null;row.lookupFailed=false});await refresh();await detail(item.id);toast(t(r.cover_missing?'coverUnavailable':'saved'))}catch(e){error.textContent=e.message;b.disabled=false}};
   }
   box.querySelector('[data-overwrite]').onchange=preview;
   box.querySelector('[data-lookup-lang]')?.addEventListener('change',e=>{lookupLang=e.target.value;for(const key of ['title','creator','album'])if(form.elements[key])form.elements[key].value=entry()[key]||'';chosen=null;box.querySelector('[data-meta-results]').innerHTML='';box.querySelector('[data-meta-preview]').innerHTML='';});
   function showMatches(r){
     box.querySelector('[data-meta-results]').innerHTML=`<h3>${esc(t('matches'))}</h3>${r.results.length?r.results.map((x,n)=>`<button class="ma-match" data-candidate="${n}">${x.cover_url?`<img src="${esc(window.asset(x.cover_url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`:'<span class="ma-match-placeholder">♫</span>'}<span><strong>${esc(x.title)}</strong><span>${esc([x.creator,x.album,x.year].filter(Boolean).join(' · '))}</span><small>${esc(x.provider)}</small></span></button>`).join(''):`<p class="ma-hint">${esc(t('noMatches'))}</p>`}`;
     box.querySelectorAll('[data-candidate]').forEach(b=>b.onclick=()=>{chosen=r.results[Number(b.dataset.candidate)];box.querySelectorAll('[data-candidate]').forEach(x=>x.classList.toggle('active',x===b));preview();box.querySelector('[data-meta-preview]').scrollIntoView({block:'nearest',behavior:'smooth'})});
     box.querySelectorAll('.ma-match img').forEach(img=>img.onerror=()=>img.style.visibility='hidden');
   }
   if(initialResults)showMatches(initialResults);
   form.onsubmit=async e=>{e.preventDefault();const queryLang=lookupLang;const b=form.querySelector('[type=submit]');b.disabled=true;error.textContent='';chosen=null;box.querySelector('[data-meta-preview]').innerHTML='';box.querySelector('[data-meta-results]').textContent=t('loading');try{
     const r=await api('/media/'+item.id+'/metadata/search','POST',Object.fromEntries(new FormData(form)),admin);
     if(!box.isConnected||lookupLang!==queryLang)return;
     showMatches(r);
   }catch(e){box.querySelector('[data-meta-results]').textContent='';error.textContent=e.message}finally{b.disabled=false}};
   box.querySelector('[data-read-tags]').onclick=async()=>{const b=box.querySelector('[data-read-tags]');b.disabled=true;error.textContent='';try{const r=await api('/media/'+item.id+'/metadata/tags','POST',{overwrite:overwrite(),lang:lookupLang},admin);await refresh();await detail(item.id);toast(t(r.found?'saved':'noTags'))}catch(e){error.textContent=e.message;b.disabled=false}};
   box.querySelector('[data-cover-upload]').onclick=async()=>{const file=box.querySelector('[data-cover-file]').files[0];if(!file)return;const b=box.querySelector('[data-cover-upload]');b.disabled=true;error.textContent='';try{
     if(file.size>2*1024*1024)throw Error(t('coverInvalid'));
     const r=await fetch((admin?'/api/apps/mvmaudio':'/pub/mvmaudio')+'/media/'+item.id+'/cover',{method:'PUT',headers:{'X-Pub-Token':token(),'Content-Type':file.type||'application/octet-stream'},body:file});if(!r.ok){let d={};try{d=await r.json()}catch{}throw Error(explain(d.detail))}await refresh();await detail(item.id);toast(t('saved'));
   }catch(e){error.textContent=e.message;b.disabled=false}};
   box.querySelector('[data-cover-remove]')?.addEventListener('click',()=>run(async()=>{await api('/media/'+item.id+'/cover','DELETE',undefined,admin);await refresh();await detail(item.id)}));
 }
 async function transferAudio(target,file,isAdmin,callbacks){
   const cancelled=()=>callbacks.cancelled()||s.dead;
   const retry=async fn=>{for(let n=0;;n++){if(cancelled())throw Error(t('cancelled'));try{return await fn()}catch(e){if(cancelled()||n>=2||(e.status&&e.status<500&&![408,429].includes(e.status)))throw e;await new Promise(ok=>setTimeout(ok,400*(n+1)));}}};
   const created=await api('/media/'+target+'/uploads','POST',{filename:file.name,bytes:file.size},isAdmin),session=created.id;callbacks.session(session);
   const partSize=Math.min(created.chunk_bytes,8*1024*1024);
   for(let offset=0;offset<file.size;offset+=partSize){await retry(()=>new Promise((resolve,reject)=>{
     const xhr=new XMLHttpRequest();activeRequest=xhr;xhr.open('PUT',(isAdmin?'/api/apps/mvmaudio':'/pub/mvmaudio')+'/uploads/'+session+'?offset='+offset);xhr.setRequestHeader('X-Pub-Token',token());xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.timeout=180000;
     xhr.upload.onprogress=e=>callbacks.progress(offset+e.loaded,file);
     const error=code=>{const e=new Error(t(code));e.status=0;reject(e)};
     xhr.onload=()=>{activeRequest=null;let data={};try{data=JSON.parse(xhr.responseText)}catch{}if(xhr.status>=200&&xhr.status<300)resolve(data);else{const e=new Error(xhr.status===413?t('uploadTooLarge'):explain(data.detail));e.status=xhr.status;reject(e)}};
     xhr.onerror=()=>{activeRequest=null;error('uploadConnection')};xhr.ontimeout=()=>{activeRequest=null;error('uploadConnection')};xhr.onabort=()=>{activeRequest=null;error('cancelled')};xhr.send(file.slice(offset,offset+partSize));
   }));}
   if(cancelled())throw Error(t('cancelled'));
   callbacks.finishing(true);
   try{await retry(()=>api('/uploads/'+session+'/finish','POST',undefined,isAdmin));callbacks.session(null);}finally{callbacks.finishing(false);}
 }
 function inferredNames(file,kind){
   let title=file.name.replace(/\.[^.]+$/,'').replace(/^\d{1,3}[ ._-]+/,'').trim()||file.name;let creator='';
   if(kind==='music'){const parts=title.split(/\s+[-–—]\s+/);if(parts.length>1){creator=parts.shift();title=parts.join(' — ');}}
   return {title:title.slice(0,200),creator:creator.slice(0,200)};
 }
 function renderImports(){
   const source=s.manage?s.admin.items:s.items,byId=new Map(),failures=s.importBatch.filter(r=>!r.saved);
   for(const row of s.importBatch.filter(r=>r.saved)){if(!byId.has(row.id))byId.set(row.id,{...row,files:0});byId.get(row.id).files++;}
   main.innerHTML=`<div class="ma-heading"><div><div class="ma-eyebrow">${esc(t('library'))}</div><h1>${esc(t('importReview'))}</h1></div>${s.manage||s.limit>0?button('importMore','data-add','ma-btn primary'):''}</div><p class="ma-muted">${s.importBatch.filter(r=>r.saved).length} / ${s.importBatch.length} · ${esc(t('filesSaved'))}</p><p class="ma-hint">${esc(t('importReviewHint'))}</p>${s.importError?`<p class="ma-error">${esc(s.importError)}</p>${button('refreshStats','data-import-refresh')}`:''}<div class="ma-import-results">${[...byId.values()].map(row=>{const item=source.find(i=>i.id===row.id);if(!item)return '';const needs=!item.creator||!item.has_cover;return `<article class="ma-import-result"><div class="ma-import-art">${cover(item,`data-import-edit="${item.id}"`)}</div><div class="ma-grow"><strong>${esc(item.title)}</strong><div class="ma-meta">${esc(item.creator)}</div><p class="ma-hint ma-import-filename">${esc(row.filename)}</p><p class="ma-hint">${row.files} · ${esc(t('files'))} · ${esc(storage(item.bytes))}</p><span class="ma-stat-badge ${needs?'':'done'}">${esc(t(row.candidates?.results.length?'importMatches':needs?'importNeedsDetails':'importTagged'))}</span>${row.lookupFailed?`<p class="ma-hint">${esc(t('metadataUnavailable'))}</p>`:''}<div class="ma-actions">${button('edit',`data-import-edit="${item.id}"`)}${button(row.candidates?.results.length?'importMatches':'metadata',`data-import-metadata="${item.id}"`)}</div></div></article>`}).join('')}${failures.map(row=>`<article class="ma-import-result"><div class="ma-grow"><strong>${esc(row.filename)}</strong><p class="ma-error">${esc(row.error||t('cancelled'))}</p></div></article>`).join('')}</div>`;
 }
 function importDialog(){
   const admin=s.manage,kind=['books','music'].includes(s.tab)?s.tab:s.tab==='imports'?s.importKind:'music';
   const box=dialog(t('upload'),`<p class="ma-hint">${esc(t('importHint'))}</p><div class="ma-form two"><label class="ma-field">${esc(t('type'))}<select data-import-kind>${['music','books'].map(k=>`<option value="${k}" ${k===kind?'selected':''}>${esc(t(k))}</option>`).join('')}</select></label><label class="ma-field">${esc(t('language'))}<select data-import-lang>${languages().map(l=>`<option value="${l}" ${l===lang?'selected':''}>${esc(languageName(l))}</option>`).join('')}</select></label><label class="ma-field wide" data-import-group-label>${esc(t('importGrouping'))}<select data-import-group><option value="files">${esc(t('importSeparateBooks'))}</option><option value="chapters">${esc(t('importBookChapters'))}</option></select></label></div><input type="file" multiple accept=".mp3,.m4a,.m4b,.aac,.ogg,.opus,.flac,.wav,.webm" aria-label="${esc(t('files'))}"><p class="ma-hint" data-import-count></p><label class="ma-import-online"><input type="checkbox" data-import-online checked> ${esc(t('importOnline'))}</label><p class="ma-hint">${esc(t('importOnlineHint'))}</p>${!admin?`<p class="ma-hint">${mb(s.used)} / ${s.limit} MB</p>`:''}<div class="ma-actions">${button('upload','data-import-upload','ma-btn primary')}${button('manualEntry','data-manual-entry')}${button('cancel','data-cancel')}</div><p class="ma-hint" data-import-status></p><progress class="ma-upload-progress" max="100" value="0" hidden></progress><div class="ma-error" role="alert"></div>`);
   const input=box.querySelector('[type=file]'),kindSelect=box.querySelector('[data-import-kind]'),progress=box.querySelector('progress'),status=box.querySelector('[data-import-status]');
   kindSelect.onchange=()=>{box.querySelector('[data-import-group-label]').hidden=kindSelect.value!=='books';};kindSelect.onchange();
   input.onchange=()=>{box.querySelector('[data-import-count]').textContent=input.files.length+' · '+t('files')+' · '+storage([...input.files].reduce((n,f)=>n+f.size,0));};
   box.querySelector('[data-manual-entry]').onclick=()=>editMedia(null,kindSelect.value);
   let aborted=false,session=null,finishing=false;
   box.querySelector('[data-cancel]').onclick=()=>{if(finishing)return;aborted=true;activeRequest?.abort();if(!box._busy)closeModal();};
   box.querySelector('[data-import-upload]').onclick=async()=>{
     const files=[...input.files].sort((a,b)=>a.name.localeCompare(b.name,lang,{numeric:true}));if(!files.length)return;if(files.length>200){box.querySelector('.ma-error').textContent=t('importTooMany');return;}
     const type=kindSelect.value,entryLang=box.querySelector('[data-import-lang]').value,group=type==='books'&&box.querySelector('[data-import-group]').value==='chapters',online=box.querySelector('[data-import-online]').checked;
     const results=[];s.importError='';s.importKind=type;let groupId=null;box._busy=true;aborted=false;box.querySelector('.ma-error').textContent='';box.querySelectorAll('button,input,select').forEach(el=>el.disabled=true);box.querySelector('[data-cancel]').disabled=false;
     try{
       for(let n=0;n<files.length;n++){
         if(aborted||s.dead)break;
         const file=files[n],row={filename:file.name,saved:false};results.push(row);let target=null;
         try{
           if(!file.size||file.size>4*1024**3)throw Error(t('quota'));
           const names=inferredNames(file,type);
           target=groupId;
           if(!target){target=(await api('/media','POST',{kind:type,...names,translations:{[entryLang]:names},import_mode:group?'chapters':'files'},admin)).id;if(group)groupId=target;}
           row.id=target;progress.hidden=false;progress.max=file.size;progress.value=0;status.textContent=`${n+1} / ${files.length} · ${file.name}`;
           await transferAudio(target,file,admin,{cancelled:()=>aborted,session:value=>session=value,progress:sent=>{progress.value=Math.min(file.size,sent);status.textContent=t('uploadSending').replace('{name}',file.name).replace('{percent}',Math.floor(100*Math.min(file.size,sent)/file.size));},finishing:value=>{finishing=value;box.querySelector('[data-cancel]').disabled=value;if(value){status.textContent=t('uploadVerifying');progress.removeAttribute('value');}}});
           row.saved=true;
         }catch(e){
           row.error=e.message;
           const uncertainTrack=session;
           if(session){try{await api('/uploads/'+session,'DELETE',undefined,admin)}catch{}session=null;}
           if(target){try{const empty=await api('/imports/'+target,'DELETE',undefined,admin);if(empty.removed&&group)groupId=null;else if(!empty.removed&&uncertainTrack){const library=await api(admin?'/admin':'/library','GET',undefined,admin);if(library.items.find(i=>i.id===target)?.tracks.some(t=>t.id===uncertainTrack)){row.saved=true;row.error='';}}}catch{}}
         }
       }
       for(const file of files.slice(results.length))results.push({filename:file.name,saved:false,error:t('cancelled')});
       s.importBatch=results;s.tab='imports';await refresh();
       if(online&&!aborted&&!s.dead){
         const ids=[...new Set(results.filter(r=>r.saved).map(r=>r.id))];
         for(let n=0;n<ids.length;n++){
           if(aborted||s.dead)break;
           const item=(admin?s.admin.items:s.items).find(i=>i.id===ids[n]);if(!item)continue;
           const entry=item.translations?.[entryLang]||item;if(!/\p{L}{3}/u.test(entry.title))continue;
           status.textContent=`${t('searchOnline')} · ${n+1} / ${ids.length} · ${entry.title}`;
           try{const candidates=await api('/media/'+item.id+'/metadata/search','POST',{title:entry.title,creator:entry.creator,album:type==='music'?entry.album||'':''},admin);results.filter(r=>r.id===item.id).forEach(r=>r.candidates=candidates);}catch{results.filter(r=>r.id===item.id).forEach(r=>r.lookupFailed=true);}
         }
       }
     }catch(e){s.importError=e.message;}
     finally{
       box._busy=false;activeRequest=null;finishing=false;
       if(s.dead)return;
       s.importBatch=results;s.tab='imports';closeModal();render();toast(t('uploadSaved').replace('{count}',results.filter(r=>r.saved).length));
     }
   };
 }
 function uploadDialog(item){
   const isAdmin=s.manage;
   const box=dialog(t('upload'),`<p>${esc(item.title)}</p><p class="ma-hint">${esc(t('uploadHint'))}</p>${!isAdmin?`<p class="ma-hint">${mb(s.used)} / ${s.limit} MB</p>`:''}${item.kind==='music'&&!item.tracks.length?`<label class="ma-field"><input type="checkbox" data-separate checked> ${esc(t('separateSongs'))}</label>`:''}<input type="file" accept=".mp3,.m4a,.m4b,.aac,.ogg,.opus,.flac,.wav,.webm" multiple aria-label="${esc(t('files'))}"><div class="ma-actions">${button('upload','data-upload','ma-btn primary')}${button('cancel','data-cancel')}</div><p class="ma-hint" data-upload-status></p><progress class="ma-upload-progress" value="0" max="100" hidden></progress><div class="ma-error" role="alert"></div>`);
   let abort=false,session=null,finishing=false;
   const progress=box.querySelector('progress'),status=box.querySelector('[data-upload-status]');
   box.querySelector('[data-cancel]').onclick=()=>{if(finishing)return;abort=true;activeRequest?.abort();if(!box._busy)closeModal()};
   box.querySelector('[data-upload]').onclick=async()=>{
     const files=[...box.querySelector('[type=file]').files].sort((a,b)=>a.name.localeCompare(b.name,lang,{numeric:true}));if(!files.length)return;
     abort=false;box._busy=true;box.querySelector('.ma-error').textContent='';
     box.querySelector('[data-upload]').disabled=true;box.querySelector('[data-close]').disabled=true;box.querySelector('[type=file]').disabled=true;
     let failed=false,saved=0;
     try{
       for(let n=0;n<files.length;n++){
         if(abort||s.dead)throw Error(t('cancelled'));
         const file=files[n];if(!file.size||file.size>4*1024**3)throw Error(t('quota'));
         let target=item.id;if(n>0&&box.querySelector('[data-separate]')?.checked){target=(await api('/media','POST',{kind:'music',title:file.name.replace(/\.[^.]+$/,''),creator:item.creator,category:item.category,album:item.album,description:''},isAdmin)).id;}
         progress.hidden=false;progress.max=file.size;progress.value=0;status.textContent=`${n+1} / ${files.length} · ${file.name}`;
         await transferAudio(target,file,isAdmin,{cancelled:()=>abort,session:value=>session=value,progress:sent=>{progress.hidden=false;progress.max=file.size;progress.value=Math.min(file.size,sent);status.textContent=t('uploadSending').replace('{name}',file.name).replace('{percent}',Math.floor(100*Math.min(file.size,sent)/file.size));},finishing:value=>{finishing=value;box.querySelector('[data-cancel]').disabled=value;if(value){status.textContent=t('uploadVerifying');progress.removeAttribute('value');}}});
         saved++;

       }
     }catch(e){failed=true;box.querySelector('.ma-error').textContent=e.message}
     finally{
       activeRequest=null;finishing=false;
       if(session){try{await api('/uploads/'+session,'DELETE',undefined,isAdmin)}catch{}session=null;}
       box._busy=false;if(s.dead)return;
       try{await refresh()}catch(e){box.querySelector('.ma-error').textContent=e.message;failed=true;}
       if(!failed&&!abort){await detail(item.id);toast(t('uploadSaved').replace('{count}',saved))}
       else{box.querySelector('[data-upload]').disabled=false;box.querySelector('[data-close]').disabled=false;box.querySelector('[type=file]').disabled=false;box.querySelector('[data-cancel]').disabled=false;progress.hidden=true;status.textContent=saved?t('uploadPartial'):t('uploadNoneSaved');}
     }
   };
 }
 function lists(){return s.manage?s.admin.playlists:s.playlists}
 async function playlistView(pid){
   const p=lists().find(p=>p.id===pid);if(!p)return;const editable=s.manage||p.mine;
   const source=s.manage?s.admin.items:s.items;
   const box=dialog(p.title,`<div class="ma-actions">${button('play','data-list-play','ma-btn primary')}${editable?button('edit','data-list-edit'):''}${!s.manage&&p.mine?button('share','data-list-share'):''}${editable?button('delete','data-list-delete','ma-btn danger'):''}</div><div class="ma-list" style="margin-top:20px">${p.items.map(id=>source.find(i=>i.id===id)).filter(Boolean).map((i,n)=>`<div class="ma-row"><span class="ma-queue-number">${n+1}</span><div class="ma-grow"><strong>${esc(i.title)}</strong><span class="ma-meta">${esc(i.creator||t(i.kind))}</span></div>${icon('▶','play',`data-list-item="${i.id}"`)}</div>`).join('')}</div>`);
   box.querySelector('[data-list-play]').onclick=()=>run(()=>play(p.items[0],null,null,p.items));
   box.querySelector('[data-list-edit]')?.addEventListener('click',()=>playlistEditor(p));
   box.querySelector('[data-list-share]')?.addEventListener('click',()=>run(()=>sharing(pid)));
   box.querySelector('[data-list-delete]')?.addEventListener('click',()=>confirmDelete(async()=>{await api('/playlists/'+pid,'DELETE',undefined,s.manage);closeModal();await refresh()}));
   box.querySelectorAll('[data-list-item]').forEach(b=>b.onclick=()=>run(()=>play(b.dataset.listItem,null,null,p.items)));
 }
 function playlistEditor(p=null,initial=[]){
   const selected=[...(p?.items||initial)];const available=(s.manage?s.admin.items:s.items).filter(i=>i.shared||i.mine);
   const box=dialog(t(p?'edit':'newPlaylist'),`<form class="ma-form">${field('title',p?.title||'','text','required maxlength="200"')}<div data-order></div><input class="ma-search" data-picker-search placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}"><div class="ma-checklist">${available.map(i=>`<label data-picker-label="${esc((i.title+' '+i.creator).toLocaleLowerCase())}"><input type="checkbox" value="${i.id}" ${selected.includes(i.id)?'checked':''}><span>${esc(i.title)}<span class="ma-meta"> · ${esc(t(i.kind))}</span></span></label>`).join('')}</div><div class="ma-actions"><button class="ma-btn primary" type="submit">${esc(t('save'))}</button>${button('cancel','data-cancel')}</div><div class="ma-error" role="alert"></div></form>`);
   function drawOrder(){box.querySelector('[data-order]').innerHTML=selected.map((id,n)=>`<div class="ma-row"><span class="ma-grow">${esc(available.find(i=>i.id===id)?.title||id)}</span>${icon('↑','moveUp',`data-move="${n}" ${n===0?'disabled':''}`)}${icon('↓','moveDown',`data-move-down="${n}" ${n===selected.length-1?'disabled':''}`)}</div>`).join('');box.querySelectorAll('[data-move],[data-move-down]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.move??b.dataset.moveDown),next=n+(b.hasAttribute('data-move')?-1:1);[selected[n],selected[next]]=[selected[next],selected[n]];drawOrder()})}
   drawOrder();box.querySelector('[data-picker-search]').oninput=e=>box.querySelectorAll('[data-picker-label]').forEach(l=>l.hidden=!l.dataset.pickerLabel.includes(e.target.value.toLocaleLowerCase()));
   box.querySelectorAll('[type=checkbox]').forEach(c=>c.onchange=()=>{if(c.checked)selected.push(c.value);else selected.splice(selected.indexOf(c.value),1);drawOrder()});
   box.querySelector('[data-cancel]').onclick=closeModal;
   box.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=box.querySelector('[type=submit]');b.disabled=true;try{const r=await api('/playlists'+(p?'/'+p.id:''),p?'PUT':'POST',{title:box.querySelector('[name=title]').value,items:selected},s.manage);await refresh();await playlistView(r.id)}catch(e){box.querySelector('.ma-error').textContent=e.message;b.disabled=false}};
 }
 function addToPlaylist(i){
   const own=s.playlists.filter(p=>p.mine);const box=dialog(t('addToPlaylist'),`<div class="ma-list">${own.map(p=>`<div class="ma-row"><span class="ma-grow">${esc(p.title)}</span>${button('add',`data-choose-list="${p.id}"`)}</div>`).join('')}</div><div class="ma-actions">${button('newPlaylist','data-create')}</div>`);
   box.querySelector('[data-create]').onclick=()=>playlistEditor(null,[i.id]);box.querySelectorAll('[data-choose-list]').forEach(b=>b.onclick=()=>run(async()=>{const p=own.find(p=>p.id===b.dataset.chooseList);await api('/playlists/'+p.id,'PUT',{title:p.title,items:[...new Set([...p.items,i.id])]});await refresh();closeModal();toast(t('saved'))}));
 }
 async function sharing(pid){
   const members=await api('/playlists/'+pid+'/members');
   const box=dialog(t('share'),`<p class="ma-hint">${esc(t('shareHint'))}</p><div class="ma-list">${members.map(u=>`<div class="ma-row"><span class="ma-grow">${esc(u.display_name||u.username)}</span>${button('remove',`data-remove-member="${u.id}"`)}</div>`).join('')}</div><input class="ma-search" data-user-search placeholder="${esc(t('findUser'))}" aria-label="${esc(t('findUser'))}" style="margin-top:18px"><div data-user-results></div>`);
   let seq=0;box.querySelector('[data-user-search]').oninput=()=>run(async()=>{const id=++seq;const q=box.querySelector('[data-user-search]').value.trim();if(q.length<2){box.querySelector('[data-user-results]').innerHTML='';return;}const users=await api('/users?q='+encodeURIComponent(q));if(!box.isConnected||id!==seq)return;box.querySelector('[data-user-results]').innerHTML=users.filter(u=>!members.some(m=>m.id===u.id)).map(u=>`<div class="ma-row"><span class="ma-grow">${esc(u.display_name||u.username)}</span>${button('share',`data-member="${u.id}"`)}</div>`).join('');box.querySelectorAll('[data-member]').forEach(b=>b.onclick=()=>run(async()=>{await api('/playlists/'+pid+'/members','POST',{user_id:b.dataset.member});await sharing(pid)}))});
   box.querySelectorAll('[data-remove-member]').forEach(b=>b.onclick=()=>run(async()=>{await api('/playlists/'+pid+'/members/'+b.dataset.removeMember,'DELETE');await sharing(pid)}));
 }
 function queueDialog(){
   const box=dialog(t('queue'),`<p class="ma-hint">${esc(t('queueHint'))}</p><div class="ma-list">${s.queue.map((id,n)=>s.items.find(i=>i.id===id)).filter(Boolean).map((i,n)=>`<div class="ma-row"><span>${s.current?.id===i.id?'♫':n+1}</span><div class="ma-grow">${esc(i.title)}</div>${icon('▶','play',`data-q-play="${i.id}"`)}${icon('↑','moveUp',`data-q-up="${n}" ${n===0?'disabled':''}`)}${icon('×','remove',`data-q-remove="${i.id}"`)}</div>`).join('')}</div><div class="ma-actions">${button('shuffle','data-q-shuffle')}${button('repeat','data-q-repeat')}</div><p class="ma-hint">${esc(t('repeat'))}: ${esc(t(s.repeat==='off'?'off':s.repeat==='all'?'all':'one'))}</p>`);
   box.querySelectorAll('[data-q-play]').forEach(b=>b.onclick=()=>run(()=>play(b.dataset.qPlay,null,null,s.queue)));
   box.querySelectorAll('[data-q-up]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.qUp);[s.queue[n],s.queue[n-1]]=[s.queue[n-1],s.queue[n]];queueDialog()});
   box.querySelectorAll('[data-q-remove]').forEach(b=>b.onclick=()=>{s.queue=s.queue.filter(id=>id!==b.dataset.qRemove);queueDialog()});
   box.querySelector('[data-q-shuffle]').onclick=()=>{s.shuffle=!s.shuffle;paintPlayer();toast(t('shuffle')+': '+t(s.shuffle?'on':'off'))};
   box.querySelector('[data-q-repeat]').onclick=()=>{s.repeat={off:'all',all:'one',one:'off'}[s.repeat];paintPlayer();queueDialog()};
 }
 function nowPlaying(){
   if(!s.current)return;const i=s.current;
   const box=dialog(t('nowPlaying'),`<div class="ma-detail-top"><div class="ma-detail-cover">${cover(i)}</div><div><h2>${esc(i.title)}</h2><p>${esc(i.creator)}</p><p>${esc(s.track?.title||t('live'))}</p></div></div><div class="ma-actions">${button(audio.paused?'play':'pause','data-now-toggle','ma-btn primary')}${button('previous','data-now-previous')}${button('next','data-now-next')}${button('sleep','data-now-sleep')}${button('open','data-now-detail')}${s.track?button('bookmark','data-bookmark'):''}</div>${i.kind!=='radio'?`<label class="ma-field" style="margin-top:20px">${esc(t('speed'))}<select data-now-speed>${[.5,.75,1,1.25,1.5,1.75,2,2.5,3].map(n=>`<option value="${n}" ${audio.playbackRate===n?'selected':''}>${n}×</option>`).join('')}</select></label>`:''}`);
   box.querySelector('[data-now-toggle]').onclick=()=>run(async()=>{if(audio.paused)await startPlayback();else audio.pause();nowPlaying()});box.querySelector('[data-now-previous]').onclick=()=>run(async()=>{await next(-1);nowPlaying()});box.querySelector('[data-now-next]').onclick=()=>run(async()=>{await next();nowPlaying()});box.querySelector('[data-now-sleep]').onclick=sleepDialog;box.querySelector('[data-now-detail]').onclick=()=>run(()=>detail(i.id));
   box.querySelector('[data-now-speed]')?.addEventListener('change',e=>{audio.playbackRate=Number(e.target.value);paintPlayer()});
   box.querySelector('[data-bookmark]')?.addEventListener('click',()=>{const mark=snapshot();const b=dialog(t('bookmark'),`<form class="ma-form">${field('title',fmt(mark.body.seconds),'text','required maxlength="200"')}<button class="ma-btn primary" type="submit">${esc(t('save'))}</button></form>`);b.querySelector('form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('/media/'+mark.id+'/bookmarks','POST',{track_id:mark.body.track_id,seconds:mark.body.seconds,title:b.querySelector('input').value});closeModal();toast(t('saved'))})}});
 }
 function sleepDialog(){const box=dialog(t('sleep'),`<p class="ma-hint">${s.sleep?fmt((s.sleep-Date.now())/1000):esc(t('off'))}</p><div class="ma-actions">${[15,30,45,60,90].map(n=>`<button class="ma-btn" data-minutes="${n}">${n} ${esc(t('minutes'))}</button>`).join('')}${button('endChapter','data-end-chapter')}${button('off','data-no-sleep')}</div>`);box.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=()=>{s.sleep=Date.now()+Number(b.dataset.minutes)*60000;s.sleepChapter=false;closeModal();toast(t('sleepSet'))});box.querySelector('[data-end-chapter]').onclick=()=>{s.sleep=0;s.sleepChapter=true;closeModal();toast(t('sleepSet'))};box.querySelector('[data-no-sleep]').onclick=()=>{s.sleep=0;s.sleepChapter=false;closeModal()};}
 const storage=bytes=>bytes>0&&bytes<1048576?(bytes/1024).toLocaleString(lang,{maximumFractionDigits:1})+' KB':bytes>=1073741824?(bytes/1073741824).toLocaleString(lang,{maximumFractionDigits:2})+' GB':mb(bytes)+' MB';
 const dateTime=stamp=>stamp?new Date(stamp*1000).toLocaleString(lang,{dateStyle:'medium',timeStyle:'short'}):'—';
 const profileName=user=>user?.deleted?t('deletedProfile'):user?.display_name||user?.username||t('deletedProfile');
 const statPerson=id=>s.stats.people.find(p=>p.id===id);
 const statItem=id=>localized(s.stats.items.find(i=>i.id===id));
 async function loadStatistics(){
   if(!s.manage||!s.admin)return;
   await persist();const data=await api('/statistics','GET',undefined,true);if(s.dead)return;
   s.stats=data;s.tab='statistics';render();
 }
 function readingStatus(r){return r?.completed?'completed':r?.active?'started':'unread'}
 function renderStatistics(){
   if(!s.stats){main.innerHTML=empty();return;}
   const data=s.stats,summary=data.summary,q=s.q.toLocaleLowerCase();
   const kpis=[['books',summary.books],['listeners',summary.listeners],['activeWeek',summary.active_week],['finishedBooks',summary.completed],['unfinishedBooks',summary.in_progress],['reclaimable',storage(summary.ready_bytes)]];
   main.innerHTML=`<div class="ma-heading"><div><div class="ma-eyebrow">${esc(t('commonLibrary'))}</div><h1>${esc(t('statistics'))}</h1></div>${button('refreshStats','data-stats-refresh')}</div><p class="ma-muted">${esc(t('statsHint'))}</p><div class="ma-stat-kpis">${kpis.map(([key,value])=>`<div><strong>${esc(value)}</strong><span>${esc(t(key))}</span></div>`).join('')}</div><div class="ma-chips">${[['books','bookReports'],['people','listenerReports'],['activity','recentActivity']].map(([key,label])=>`<button class="ma-chip ${s.statsView===key?'active':''}" data-stats-view="${key}">${esc(t(label))}</button>`).join('')}</div><div class="ma-stat-filters"><label class="ma-field">${esc(t('listeners'))}<select data-stats-user><option value="">${esc(t('allListeners'))}</option>${data.people.map(p=>`<option value="${p.id}" ${s.statsUser===p.id?'selected':''}>${esc(profileName(p))}</option>`).join('')}</select></label>${s.statsView==='books'?`<label class="ma-field">${esc(t('status'))}<select data-stats-filter>${['all','started','readyReview','unread'].map(k=>`<option value="${k}" ${s.statsFilter===k?'selected':''}>${esc(t(k))}</option>`).join('')}</select></label><label class="ma-field">${esc(t('sort'))}<select data-stats-sort>${[['size','largestFirst'],['recent','recent'],['title','title']].map(([k,label])=>`<option value="${k}" ${s.statsSort===k?'selected':''}>${esc(t(label))}</option>`).join('')}</select></label>`:''}</div><div data-stats-content></div><p class="ma-hint">${esc(t('completionHint'))}</p>`;
   const content=main.querySelector('[data-stats-content]');
   if(s.statsView==='books'){
     let books=data.items.filter(i=>i.kind==='books').map(localized).filter(i=>!q||[i.title,i.creator].some(v=>v.toLocaleLowerCase().includes(q)));
     if(s.statsUser)books=books.filter(i=>i.readers.some(r=>r.user_id===s.statsUser)||i.tracked_user_ids.includes(s.statsUser));
     books=books.filter(i=>s.statsFilter==='all'||s.statsFilter==='readyReview'&&i.ready||s.statsFilter==='started'&&i.in_progress>0||s.statsFilter==='unread'&&!i.listener_count);
     books.sort((a,b)=>s.statsSort==='size'?b.bytes-a.bytes:s.statsSort==='recent'?b.last_played-a.last_played:a.title.localeCompare(b.title,lang));
     content.innerHTML=books.length?`<div class="ma-stat-books">${books.map(i=>{const reading=s.statsUser?i.readers.find(r=>r.user_id===s.statsUser):null;return `<button class="ma-stat-book" data-stats-book="${i.id}"><div class="ma-stat-book-title"><strong>${esc(i.title)}</strong><span class="ma-meta">${esc(i.creator)}</span><span class="ma-stat-badge ${i.ready?'done':''}">${esc(t(i.ready?'readyReview':i.in_progress?'started':'unread'))}</span></div><div class="ma-stat-book-values"><span><b>${i.cohort_completed} / ${i.cohort_count}</b> ${esc(t('groupCompleted'))}</span><span>${esc(t(i.tracked_user_ids.length?'trackedReaders':'allStartedReaders'))}</span><div class="ma-progress"><span style="width:${reading?reading.percent:i.average_percent}%"></span></div><span>${esc(t(reading?'progress':'avgProgress'))}: ${esc(percent(reading?reading.percent:i.average_percent))}</span><span>${esc(t('lastListened'))}: ${esc(dateTime(i.last_played))}</span></div><strong class="ma-stat-size">${esc(storage(i.bytes))}</strong></button>`}).join('')}</div>`:`<p class="ma-muted">${esc(t('noListening'))}</p>`;
   }else if(s.statsView==='people'){
     const people=data.people.filter(p=>(!s.statsUser||p.id===s.statsUser)&&(!q||profileName(p).toLocaleLowerCase().includes(q)));
     content.innerHTML=people.length?`<div class="ma-stat-people">${people.map(p=>{const rows=data.activity.filter(r=>r.user_id===p.id),books=rows.filter(r=>statItem(r.media_id).kind==='books');return `<button class="ma-stat-person" data-stats-person="${p.id}"><strong>${esc(profileName(p))}</strong><span>${rows.length} ${esc(t('titlesPlayed'))}</span><span>${books.filter(r=>r.completed).length} ${esc(t('finishedBooks'))} · ${books.filter(r=>!r.completed).length} ${esc(t('unfinishedBooks'))}</span><small>${esc(dateTime(Math.max(0,...rows.map(r=>r.last_played))))}</small></button>`}).join('')}</div>`:`<p class="ma-muted">${esc(t('noListening'))}</p>`;
   }else{
     const rows=data.activity.filter(r=>!s.statsUser||r.user_id===s.statsUser).filter(r=>{const i=statItem(r.media_id);return !q||[i.title,i.creator,profileName(statPerson(r.user_id))].some(v=>v.toLocaleLowerCase().includes(q))});
     content.innerHTML=rows.length?`<div class="ma-stat-table-wrap"><table class="ma-stat-table"><thead><tr>${['listeners','title','type','progress','lastListened'].map(k=>`<th>${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>{const i=statItem(r.media_id);return `<tr><td>${esc(profileName(statPerson(r.user_id)))}</td><td>${i.kind==='books'?`<button class="ma-titlebtn" data-stats-book="${i.id}">${esc(i.title)}</button>`:esc(i.title)}</td><td>${esc(t(i.kind))}</td><td>${i.kind==='books'?esc(r.completed?t('completed'):percent(r.percent)):'—'}</td><td>${esc(dateTime(r.last_played))}</td></tr>`}).join('')}</tbody></table></div>`:`<p class="ma-muted">${esc(t('noListening'))}</p>`;
   }
   for(const [selector,key]of [['user','statsUser'],['filter','statsFilter'],['sort','statsSort']])main.querySelector(`[data-stats-${selector}]`)?.addEventListener('change',e=>{s[key]=e.target.value;render()});
 }
 function statsBook(mid){
   const item=statItem(mid);if(!item)return;
   const selected=new Set(item.tracked_user_ids),people=new Map(s.stats.people.map(p=>[p.id,p]));
   const box=dialog(item.title,`<p class="ma-muted">${esc(item.creator)} · ${esc(storage(item.bytes))} · ${fmt(item.duration)}</p><div class="ma-stat-summary"><strong>${item.cohort_completed} / ${item.cohort_count} ${esc(t('groupCompleted'))}</strong><span class="ma-stat-badge ${item.ready?'done':''}">${esc(t(item.ready?'readyReview':'unfinishedBooks'))}</span></div><h3>${esc(t('readingGroup'))}</h3><p class="ma-hint">${esc(t('groupHint'))}</p><div class="ma-stat-selected" data-selected-readers></div><input class="ma-search" data-reader-search placeholder="${esc(t('chooseReaders'))}" aria-label="${esc(t('chooseReaders'))}"><div data-reader-results></div><div class="ma-actions">${button('save','data-readers-save')}</div><div class="ma-error" role="alert"></div><h3>${esc(t('bookReports'))}</h3><div data-reader-report></div><p class="ma-hint">${esc(t('completionHint'))}</p><div class="ma-actions">${button('edit','data-stats-edit')}${button('delete','data-stats-delete','ma-btn danger')}</div>`);
   function draw(){
     box.querySelector('[data-selected-readers]').innerHTML=[...selected].map(id=>`<button class="ma-chip" data-untrack="${id}">${esc(profileName(people.get(id)))} ×</button>`).join('')||`<span class="ma-muted">${esc(t('allStartedReaders'))}</span>`;
     box.querySelectorAll('[data-untrack]').forEach(b=>b.onclick=()=>{selected.delete(b.dataset.untrack);draw()});
     const ids=selected.size?[...selected]:item.readers.filter(r=>r.active).map(r=>r.user_id);
     box.querySelector('[data-reader-report]').innerHTML=ids.length?`<div class="ma-stat-table-wrap"><table class="ma-stat-table"><thead><tr>${['listeners','status','progress','left','chapters','lastListened'].map(k=>`<th>${esc(t(k))}</th>`).join('')}</tr></thead><tbody>${ids.map(id=>{const r=item.readers.find(r=>r.user_id===id);return `<tr><td>${esc(profileName(people.get(id)))}</td><td><span class="ma-stat-badge ${r?.completed?'done':''}">${esc(t(readingStatus(r)))}</span></td><td>${esc(percent(r?.percent||0))}</td><td>${fmt(r?.remaining??item.duration)}</td><td>${r?.chapter||'—'} / ${r?.chapter_count||s.admin.items.find(i=>i.id===mid)?.tracks.length||0}</td><td>${esc(dateTime(r?.last_played))}</td></tr>`}).join('')}</tbody></table></div>`:`<p class="ma-muted">${esc(t('noListening'))}</p>`;
   }
   draw();let searchId=0;
   box.querySelector('[data-reader-search]').oninput=()=>run(async()=>{const query=box.querySelector('[data-reader-search]').value.trim(),version=++searchId;if(query.length<2){box.querySelector('[data-reader-results]').innerHTML='';return;}const users=await api('/statistics/users?q='+encodeURIComponent(query),'GET',undefined,true);if(!box.isConnected||version!==searchId)return;box.querySelector('[data-reader-results]').innerHTML=users.filter(u=>!selected.has(u.id)).map(u=>`<div class="ma-row"><span class="ma-grow">${esc(profileName(u))}</span>${button('add',`data-track-reader="${u.id}"`)}</div>`).join('');users.forEach(u=>people.set(u.id,u));box.querySelectorAll('[data-track-reader]').forEach(b=>b.onclick=()=>{selected.add(b.dataset.trackReader);b.closest('.ma-row').remove();draw()})});
   box.querySelector('[data-readers-save]').onclick=async()=>{const b=box.querySelector('[data-readers-save]');b.disabled=true;try{await api('/statistics/media/'+mid+'/readers','PUT',{user_ids:[...selected]},true);await loadStatistics();statsBook(mid);toast(t('saved'))}catch(e){box.querySelector('.ma-error').textContent=e.message;b.disabled=false}};
   box.querySelector('[data-stats-edit]').onclick=()=>editMedia(s.admin.items.find(i=>i.id===mid));
   box.querySelector('[data-stats-delete]').onclick=()=>{
     const confirm=dialog(t('delete'),`<p>${esc(item.title)} · <strong>${esc(storage(item.bytes))}</strong></p><p>${item.cohort_completed} / ${item.cohort_count} ${esc(t('groupCompleted'))}</p><p>${item.in_progress} ${esc(t('unfinishedBooks'))}</p><p class="ma-hint">${esc(t('statsDeleteHint'))}</p><p>${esc(t('deleteConfirm'))}</p><div class="ma-actions">${button('delete','data-confirm-stat-delete','ma-btn danger')}${button('cancel','data-cancel')}</div><div class="ma-error" role="alert"></div>`);
     confirm.querySelector('[data-cancel]').onclick=()=>statsBook(mid);
     confirm.querySelector('[data-confirm-stat-delete]').onclick=async()=>{const b=confirm.querySelector('[data-confirm-stat-delete]');b.disabled=true;try{await api('/media/'+mid,'DELETE',undefined,true);closeModal();await refresh();await loadStatistics()}catch(e){confirm.querySelector('.ma-error').textContent=e.message;b.disabled=false}};
   };
 }
 function settingsDialog(){
   const box=dialog(t('settings'),`${s.admin?`<h3>${esc(t('personalUploads'))}</h3><p class="ma-hint">${esc(t('quotaHint'))}</p><div data-premium-policy>${field('upload_limit_mb',s.admin.upload_limit_mb,'number','min="0" max="1048576" step="1"')}<div class="ma-actions">${button('save','data-policy-save','ma-btn primary')}</div></div><div class="ma-error" role="alert"></div>`:''}${s.limit>0?`<p class="ma-hint">${esc(t('storage'))}: ${mb(s.used)} / ${s.limit} MB</p>`:''}<h3>${esc(t('background'))}</h3><p class="ma-hint">${esc(t('backgroundHelp'))}</p><h3>${esc(t('radio'))}</h3><p class="ma-hint">${esc(t('radioHelp'))}</p>`);
   if(s.admin){const policy=box.querySelector('[data-premium-policy]');if(!s.admin.premium&&window.mvmOS?.premiumGate)window.mvmOS.premiumGate(policy,t('personalUploads'));
     box.querySelector('[data-policy-save]').onclick=()=>run(async()=>{try{await api('/settings','PUT',{upload_limit_mb:Number(box.querySelector('[name=upload_limit_mb]').value)},true);await refresh();closeModal();toast(t('saved'))}catch(e){box.querySelector('.ma-error').textContent=e.message}});
   }
 }
 root.addEventListener('click',e=>{
   if(modal&&modal.contains(e.target))return;
   const b=e.target.closest('button');if(!b)return;
   if(b.hasAttribute('data-statistics')||b.hasAttribute('data-stats-refresh'))run(loadStatistics);
   else if(b.dataset.statsView){s.statsView=b.dataset.statsView;render()}
   else if(b.dataset.statsBook)statsBook(b.dataset.statsBook);
   else if(b.dataset.statsPerson){s.statsUser=b.dataset.statsPerson;s.statsView='activity';s.q='';root.querySelector('.ma-search').value='';render()}
   else if(b.dataset.tab){s.tab=b.dataset.tab;s.category='';s.status='all';render()}
   else if(b.dataset.go){s.tab=b.dataset.go;render()}
   else if(b.hasAttribute('data-manage')){s.manage=!s.manage;s.tab='music';s.category='';s.scope='all';s.status='all';render()}
   else if(b.hasAttribute('data-settings'))settingsDialog();
   else if(b.hasAttribute('data-add')){if(s.tab==='radio')editMedia();else importDialog();}
   else if(b.hasAttribute('data-import-refresh'))run(async()=>{await refresh();s.importError='';render()});
   else if(b.dataset.importEdit){const item=(s.manage?s.admin.items:s.items).find(i=>i.id===b.dataset.importEdit);if(item)editMedia(item);}
   else if(b.dataset.importMetadata){const item=(s.manage?s.admin.items:s.items).find(i=>i.id===b.dataset.importMetadata);const row=s.importBatch.find(r=>r.id===b.dataset.importMetadata&&r.candidates);if(item)run(()=>metadataDialog(item,row?.candidates));}
   else if(b.hasAttribute('data-category')){s.category=b.dataset.category;render()}
   else if(b.hasAttribute('data-scope')){s.scope=b.dataset.scope;render()}
   else if(b.dataset.play)run(()=>play(b.dataset.play));
   else if(b.dataset.detail)run(()=>{const item=(s.manage?s.admin.items:s.items).find(i=>i.id===b.dataset.detail);return s.manage?editMedia(item):detail(b.dataset.detail)});
   else if(b.dataset.favorite)run(async()=>{const i=s.items.find(i=>i.id===b.dataset.favorite);if(i){await stateChange(i,{favorite:!i.state.favorite});render()}});
   else if(b.hasAttribute('data-toggle'))run(async()=>{if(!s.current)return;if(audio.paused)await startPlayback();else audio.pause()});
   else if(b.hasAttribute('data-previous'))run(()=>next(-1));
   else if(b.hasAttribute('data-next'))run(()=>next());
   else if(b.hasAttribute('data-rewind'))seekBy(-15);
   else if(b.hasAttribute('data-forward'))seekBy(30);
   else if(b.hasAttribute('data-shuffle')){s.shuffle=!s.shuffle;paintPlayer()}
   else if(b.hasAttribute('data-repeat')){s.repeat={off:'all',all:'one',one:'off'}[s.repeat];paintPlayer();toast(t('repeat')+': '+t(s.repeat==='off'?'off':s.repeat==='all'?'all':'one'))}
   else if(b.hasAttribute('data-now'))nowPlaying();
   else if(b.hasAttribute('data-queue'))queueDialog();
   else if(b.hasAttribute('data-sleep'))sleepDialog();
   else if(b.hasAttribute('data-new-playlist'))playlistEditor();
   else if(b.dataset.playlist)run(()=>playlistView(b.dataset.playlist));
   else if(b.dataset.playlistPlay)run(()=>{const p=lists().find(p=>p.id===b.dataset.playlistPlay);return play(p.items[0],null,null,p.items)});
 });
 root.querySelector('.ma-search').oninput=e=>{s.q=e.target.value;render()};
 root.addEventListener('change',e=>{const el=e.target;if(el.hasAttribute('data-sort')){s.sort=el.value;render()}if(el.hasAttribute('data-status')){s.status=el.value;render()}if(el.hasAttribute('data-speed'))audio.playbackRate=Number(el.value);if(el.hasAttribute('data-seek')){audio.currentTime=Number(el.value);tick()}if(el.hasAttribute('data-volume'))audio.volume=Number(el.value)});
 const clock=setInterval(()=>{if(s.sleep)tick()},1000);
 paintPlayer();main.innerHTML=`<div class="ma-empty" role="status">${esc(t('loading'))}</div>`;run(refresh);
 return {destroy(){if(s.dead)return;flush();s.dead=true;s.loadId++;activeRequest?.abort();audio.pause();audio.removeAttribute('src');audio.load();clearInterval(clock);clearTimeout(toastTimer);artObserver.disconnect();for(const record of coverCache.values())if(record.url?.startsWith('blob:'))URL.revokeObjectURL(record.url);coverCache.clear();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',flush);closeModal();if('mediaSession'in navigator){navigator.mediaSession.metadata=null;for(const k of ['play','pause','previoustrack','nexttrack','seekbackward','seekforward','seekto','stop'])try{navigator.mediaSession.setActionHandler(k,null)}catch{}}root.remove();host.classList.remove('ma-host');}};
}
window.MvmAudio={mount};
})();
