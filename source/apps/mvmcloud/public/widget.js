/* Browser filesystem for mvmCloud. Encryption happens before upload. */
(function(){
  if(window.MvmCloud)return;
  var API='/pub/mvmcloud', INDEX='.__mvmcloud_index';
  function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function tr(key,values){return window.t?window.t(key,values):key}
  function fmt(n){if(n<1024)return n+' B';var u=['KB','MB','GB','TB'],i=-1;do{n/=1024;i++}while(n>=1024&&i<3);return n.toFixed(n<10&&i?'1':'0')+' '+u[i]}
  function bytes(n){var a=new Uint8Array(n);crypto.getRandomValues(a);return a}
  function b64(a){return btoa(String.fromCharCode.apply(null,new Uint8Array(a)))}
  function ub64(s){return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0)})}
  async function key(password,salt){return crypto.subtle.deriveKey({name:'PBKDF2',salt:ub64(salt),iterations:250000,hash:'SHA-256'},await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
  async function crypt(k,data){var iv=bytes(12),out=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},k,data),all=new Uint8Array(12+out.byteLength);all.set(iv);all.set(new Uint8Array(out),12);return all}
  async function decrypt(k,data){data=new Uint8Array(data);return crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)},k,data.slice(12))}
  // ── Gallery helpers (image / video previews) ─────────────────────────────
  var PAGE=200;   // entries per request; the next page loads while the user scrolls
  var MEDIA={jpg:['image','image/jpeg'],jpeg:['image','image/jpeg'],png:['image','image/png'],gif:['image','image/gif'],webp:['image','image/webp'],avif:['image','image/avif'],bmp:['image','image/bmp'],mp4:['video','video/mp4'],m4v:['video','video/mp4'],webm:['video','video/webm'],mov:['video','video/quicktime'],ogv:['video','video/ogg']};
  function mediaInfo(name){var m=/\.([a-z0-9]+)$/i.exec(name||'');return m&&MEDIA[m[1].toLowerCase()]||null}
  function clock(s){s=Math.round(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
  function natural(a,b){return String(a.real).localeCompare(String(b.real),undefined,{numeric:true,sensitivity:'base'})}
  // Thumbnails are made in the browser (no server image tools are needed) and
  // kept per browser, so a folder is only downloaded in full the first time.
  var idbReady=null;
  function idb(){return idbReady||(idbReady=new Promise(function(ok){try{var r=indexedDB.open('mvmcloud-thumbs',1);r.onupgradeneeded=function(){var s=r.result.createObjectStore('t');s.createIndex('at','at')};r.onsuccess=function(){ok(r.result)};r.onerror=function(){ok(null)}}catch(e){ok(null)}}))}
  function idbGet(k){return idb().then(function(db){return db?new Promise(function(ok){try{var q=db.transaction('t').objectStore('t').get(k);q.onsuccess=function(){ok(q.result||null)};q.onerror=function(){ok(null)}}catch(e){ok(null)}}):null})}
  function idbPut(k,v){idb().then(function(db){if(!db)return;try{var s=db.transaction('t','readwrite').objectStore('t');s.put(v,k);var c=s.count();c.onsuccess=function(){if(c.result<=4000)return;var n=c.result-3500,q=s.index('at').openKeyCursor();q.onsuccess=function(){var cur=q.result;if(cur&&n-->0){s.delete(cur.primaryKey);cur.continue()}}}}catch(e){}})}
  function toThumb(source,w,h){var s=Math.min(1,360/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));var g=c.getContext('2d');g.fillStyle='#222';g.fillRect(0,0,c.width,c.height);g.drawImage(source,0,0,c.width,c.height);return new Promise(function(ok){c.toBlob(ok,'image/jpeg',.8)})}
  function imageThumb(blob){
    var decode=window.createImageBitmap?createImageBitmap(blob):Promise.reject();
    return decode.catch(function(){return new Promise(function(ok,bad){var u=URL.createObjectURL(blob),i=new Image();i.onload=function(){URL.revokeObjectURL(u);ok(i)};i.onerror=function(){URL.revokeObjectURL(u);bad(Error('image'))};i.src=u})}).then(function(src){
      var w=src.naturalWidth||src.width,h=src.naturalHeight||src.height;
      return toThumb(src,w,h).then(function(b){if(src.close)src.close();if(!b)throw Error('thumb');return {blob:b}})})}
  function videoThumb(url){return new Promise(function(ok,bad){
    var v=document.createElement('video'),done=false,timer=setTimeout(function(){fail(Error('timeout'))},20000);
    function end(){clearTimeout(timer);v.onerror=v.onloadeddata=v.onseeked=null;v.removeAttribute('src');v.load()}
    function fail(e){if(done)return;done=true;end();bad(e)}
    function grab(){if(done)return;done=true;var w=v.videoWidth,h=v.videoHeight,d=v.duration;if(!w||!h){end();return bad(Error('frame'))}toThumb(v,w,h).then(function(b){end();b?ok({blob:b,dur:isFinite(d)?d:0}):bad(Error('thumb'))},function(e){end();bad(e)})}
    v.muted=true;v.preload='auto';v.playsInline=true;v.onerror=function(){fail(Error('video'))};
    v.onloadeddata=function(){var d=isFinite(v.duration)?v.duration:0,at=d?Math.min(1,d/10):0;if(!at)return grab();v.onseeked=grab;v.currentTime=at};
    v.src=url})}
  function mount(root,opts){
    opts=opts||{};var token=localStorage.getItem('apphub_token'),state={path:'',me:null,vault:null,index:{files:{}},space:'',perms:null,remote:false,spaces:[]};
    root.innerHTML='<div class="mc"><header><b>☁️ mvmCloud</b><span class="mc-usage"></span><select class="mc-space" hidden></select><button data-act="up" title="'+esc(tr('mc_upload'))+'" aria-label="'+esc(tr('mc_upload'))+'">↑</button><button data-act="folder" title="'+esc(tr('mc_folder'))+'" aria-label="'+esc(tr('mc_folder'))+'">＋</button><button data-act="share" title="'+esc(tr('mc_share'))+'" aria-label="'+esc(tr('mc_share'))+'">🔗</button><button data-act="vault" title="'+esc(tr('mc_encrypted_folder'))+'" aria-label="'+esc(tr('mc_encrypted_folder'))+'" hidden>🔒</button>'+(!opts.desktop?'<button data-act="user-api" title="'+esc(tr('mc_user_api'))+'" aria-label="'+esc(tr('mc_user_api'))+'" hidden>⌘</button>':'')+(opts.desktop?'<button data-act="admin" title="'+esc(tr('mc_admin'))+'" aria-label="'+esc(tr('mc_admin'))+'">⚙</button>':'')+'</header><div class="mc-path"></div><main class="mc-list"></main><input class="mc-file" type="file" multiple hidden><div class="mc-modal" hidden></div></div>';
    var $=function(s){return root.querySelector(s)},list=$('.mc-list'),modal=$('.mc-modal'),vaultButton=root.querySelector('[data-act="vault"]'),userApiButton=root.querySelector('[data-act="user-api"]');
    var style=document.createElement('style');style.textContent='.mc{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font:14px system-ui}.mc header{display:flex;gap:8px;align-items:center;padding:12px;border-bottom:1px solid var(--pub-border,#45475a);flex-wrap:wrap}.mc header b{margin-right:auto}.mc button{border:0;border-radius:6px;padding:7px 10px;background:var(--pub-surface2,#313244);color:inherit;cursor:pointer}.mc button:hover{filter:brightness(1.15)}.mc-path{padding:9px 14px;color:var(--pub-fg2,#a6adc8);font-family:monospace}.mc-list{overflow:auto;flex:1}.mc-row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--pub-border,#45475a);cursor:pointer}.mc-row:hover{background:var(--pub-surface2,#313244)}.mc-row .name{flex:1;overflow-wrap:anywhere}.mc-row small{color:var(--pub-fg2,#a6adc8)}.mc-empty{padding:28px;text-align:center;color:var(--pub-fg2,#a6adc8)}.mc-modal{position:absolute;inset:0;background:#0009;z-index:3;padding:24px;overflow:auto}.mc-dialog{background:var(--pub-surface1,#313244);max-width:760px;margin:5vh auto;border:1px solid var(--pub-border,#45475a);border-radius:12px;padding:24px;box-shadow:0 20px 60px #0008}.mc-dialog input{box-sizing:border-box;width:100%;margin:6px 0 12px;padding:9px 10px;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);color:inherit;border-radius:6px}.mc-dialog table{width:100%;border-collapse:collapse}.mc-dialog td,.mc-dialog th{padding:11px 8px;text-align:left;border-bottom:1px solid var(--pub-border,#45475a)}.mc-admin h3{margin:0;font-size:18px}.mc-admin-lead{margin:7px 0 20px;color:var(--pub-fg2,#a6adc8);line-height:1.45}.mc-admin-section{margin-top:20px;border:1px solid var(--pub-border,#45475a);border-radius:9px;overflow:hidden}.mc-admin-section h4{margin:0;padding:11px 14px;background:var(--pub-surface2,#313244);font-size:13px}.mc-admin-actions{display:flex;gap:9px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px}.mc .mc-btn{padding:9px 13px;border:1px solid var(--pub-border,#45475a);font-weight:650}.mc .mc-btn-primary{background:var(--pub-accent,#89b4fa);color:var(--on-accent,var(--pub-bg,#1e1e2e));border-color:transparent}.mc .mc-btn-danger{background:rgba(243,139,168,.15);color:var(--pub-red,#f38ba8);border-color:rgba(243,139,168,.35)}.mc .mc-btn-subtle{background:transparent}.mc-admin-empty{padding:18px;color:var(--pub-fg2,#a6adc8);text-align:center}';document.head.appendChild(style);
    root.querySelector('.mc').classList.add('mc-cloud-compact');
    style.textContent += '.mc-cloud-compact header{flex-wrap:nowrap}.mc-cloud-compact header b{display:none}.mc-cloud-compact .mc-usage{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mc-cloud-compact header button{flex:0 0 36px;width:36px;height:36px;padding:0;font-size:1.1rem}';
    style.textContent += '.mc .mc-modal{z-index:6}.mc header select.mc-space{max-width:42%;min-width:0;background:var(--pub-surface2,#313244);color:inherit;border:0;border-radius:6px;padding:7px 8px}.mc-share-row{padding:10px 0;border-bottom:1px solid var(--pub-border,#45475a)}.mc-share-row:last-child{border-bottom:0}.mc-rights{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0}.mc-rights label{display:flex;align-items:center;gap:6px;font-size:13px}.mc-found{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;max-height:110px;overflow:auto}.mc-usage{font-size:13px;color:var(--pub-fg2,#a6adc8)}';
    function spq(p){return state.space?(p.indexOf('?')<0?'?':'&')+'space='+encodeURIComponent(state.space):''}
    function can(p){return !state.perms||state.perms.indexOf(p)>=0}
    function api(path,o){o=o||{};o.headers=Object.assign({'X-Pub-Token':token},o.headers||{});return fetch(API+path+(/^\/(files|folders|upload(?:-ticket)?|move|thumb)(\?|$)/.test(path)?spq(path):''),o).then(async function(r){var d=await r.json().catch(function(){return {}});if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:(d.error||tr('mc_request_failed')));return d})}
    function dialog(html,bind){modal.hidden=false;modal.innerHTML='<div class="mc-dialog">'+html+'</div>';bind&&bind(modal);modal.querySelectorAll('[data-close]').forEach(function(b){b.onclick=function(){modal.hidden=true}})}
    // mvmCloud draws its own dialogs. The browser's confirm/prompt/alert can be blocked or missing (desktop shells,
    // extension popups, phones), and a native prompt would show an encrypted-folder password as plain text.
    function ask(text,o){
      o=o||{};
      return new Promise(function(done){
        var box=document.createElement('div'),input;
        box.className='mc-modal mc-ask';
        box.innerHTML='<div class="mc-dialog"><p class="mc-ask-text"></p>'+(o.input?'<input class="mc-ask-in" type="'+(o.secret?'password':'text')+'" autocomplete="off">':'')+'<div class="mc-admin-actions">'+(o.info?'':'<button class="mc-btn mc-btn-subtle" data-no></button>')+'<button class="mc-btn '+(o.danger?'mc-btn-danger':'mc-btn-primary')+'" data-yes></button></div></div>';
        box.querySelector('.mc-ask-text').textContent=text;
        box.querySelector('[data-yes]').textContent=o.yes||tr('mc_ok');
        if(!o.info)box.querySelector('[data-no]').textContent=tr('mc_cancel');
        input=box.querySelector('.mc-ask-in');
        function end(v){box.remove();done(v)}
        function yes(){end(o.input?input.value:(o.info?undefined:true))}
        function no(){end(o.input?null:(o.info?undefined:false))}
        box.querySelector('[data-yes]').onclick=yes;
        if(!o.info)box.querySelector('[data-no]').onclick=no;
        box.onclick=function(e){if(e.target===box)no()};
        box.onkeydown=function(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();no()}else if(e.key==='Enter'&&e.target.tagName!=='BUTTON'){e.preventDefault();yes()}};
        root.querySelector('.mc').appendChild(box);
        (input||box.querySelector('[data-yes]')).focus();
      });
    }
    function askText(text,o){o=o||{};o.input=true;return ask(text,o)}
    function notice(text){return ask(text,{info:true})}
    // Right click (long press on some phones) on a row: a small menu instead of an immediate delete question.
    var ctx=null;
    function closeCtx(){if(ctx){ctx.remove();ctx=null;document.removeEventListener('pointerdown',ctxOff,true)}}
    function ctxOff(e){if(ctx&&!ctx.contains(e.target))closeCtx()}
    function ctxMenu(e,name,type){
      e.preventDefault();closeCtx();
      var m=ctx=document.createElement('div'),frame=root.querySelector('.mc'),r=frame.getBoundingClientRect();
      m.className='mc-ctx';
      m.innerHTML=(type==='file'&&can('read')?'<button data-a="dl">⬇ '+esc(tr('mc_download'))+'</button>':'')+(!state.space?'<button data-a="share">🔗 '+esc(tr('mc_share_item'))+'</button>':'')+(can('delete')?'<button data-a="del">🗑 '+esc(tr('mc_delete'))+'</button>':'');if(!m.innerHTML){m.remove();ctx=null;return}
      m.style.left=Math.max(0,Math.min(e.clientX-r.left,r.width-170))+'px';m.style.top=Math.max(0,Math.min(e.clientY-r.top,r.height-100))+'px';
      m.onclick=function(ev){var b=ev.target.closest('[data-a]');if(!b)return;closeCtx();if(b.dataset.a==='dl')downloadFile(name);else if(b.dataset.a==='share')shareDialog(name,type);else removeItem(name)};
      frame.appendChild(m);
      document.addEventListener('pointerdown',ctxOff,true);
    }

    // ── Places, rights and free space ───────────────────────────────────────
    var RIGHTS=['view','read','write','delete'];
    function rightsText(list){return RIGHTS.filter(function(r){return list.indexOf(r)>=0}).map(function(r){return tr('mc_perm_'+r)}).join(', ')}
    function showUsage(){
      var m=state.me,el=$('.mc-usage');if(!m)return;
      if(state.space){var cur=state.spaces.find(function(x){return x.id===state.space});el.textContent=cur?tr('mc_rights_line',{rights:rightsText(cur.permissions)}):'';el.title=el.textContent;return}
      var q=m.policy&&m.policy.quota_bytes,free=m.free_bytes==null?null:m.free_bytes,text;
      if(q!=null){var left=Math.max(0,q-m.usage_bytes);if(free!=null)left=Math.min(left,free);text=tr('mc_free_of',{free:fmt(left),total:fmt(q)})}
      else text=free==null?fmt(m.usage_bytes):tr('mc_free_server',{used:fmt(m.usage_bytes),free:fmt(free)});
      el.textContent=text;el.title=tr('mc_used_line',{used:fmt(m.usage_bytes)})+(q!=null?' · '+tr('mc_quota_line',{total:fmt(q)}):'')+(free!=null?' · '+tr('mc_server_free_line',{free:fmt(free)}):'');
    }
    function fillSpaces(){
      var sel=$('.mc-space');sel.hidden=!state.spaces.length;if(!state.spaces.length){state.space='';state.perms=null;return}
      if(state.space&&!state.spaces.some(function(x){return x.id===state.space}))state.space='';
      sel.innerHTML='<option value="">'+esc(tr('mc_my_files'))+'</option>'+state.spaces.map(function(x){return '<option value="'+esc(x.id)+'">'+esc((x.kind==='share'?'👥 ':'📂 ')+x.name+(x.owner?' · '+x.owner:''))+'</option>'}).join('');
      sel.value=state.space;
      sel.onchange=function(){state.space=sel.value;state.path='';browse('').catch(function(e){notice(e.message)})};
    }
    function applyRights(){
      var cur=state.space?state.spaces.find(function(x){return x.id===state.space}):null;
      state.perms=cur?cur.permissions:null;state.remote=!!(cur&&cur.remote);
      root.querySelector('[data-act="up"]').hidden=!can('write');root.querySelector('[data-act="folder"]').hidden=!can('write');
      var sh=root.querySelector('[data-act="share"]');if(sh)sh.hidden=!!state.space;
      vaultButton.hidden=!!state.space||!(state.me&&state.me.policy.encryption_allowed);
      showUsage();
    }
    function rightBoxes(current,allowed){
      return '<div class="mc-rights">'+RIGHTS.map(function(r){var on=current.indexOf(r)>=0||r==='view',off=allowed&&allowed.indexOf(r)<0;return '<label title="'+esc(tr('mc_perm_'+r+'_hint'))+'"><input type="checkbox" data-right="'+r+'" '+(on?'checked ':'')+(off||r==='view'?'disabled':'')+' style="width:auto"> '+esc(tr('mc_perm_'+r))+'</label>'}).join('')+'</div>'
    }
    function readRights(box){var out=[];box.querySelectorAll('[data-right]').forEach(function(c){if(c.checked)out.push(c.dataset.right)});if(out.indexOf('view')<0)out.push('view');return out}
    function personPicker(host,onPick){
      host.innerHTML='<input data-q placeholder="'+esc(tr('mc_share_search_ph'))+'" autocomplete="off"><div class="mc-found"></div>';
      var q=host.querySelector('[data-q]'),out=host.querySelector('.mc-found'),timer=null;
      function search(){api('/share-users?q='+enc(q.value.trim())).then(function(d){out.innerHTML=(d.users||[]).map(function(u){return '<button class="mc-btn mc-btn-subtle" data-id="'+esc(u.id)+'" data-name="'+esc(u.display_name||u.username||u.id)+'">'+esc(u.display_name||u.username||u.id)+'</button>'}).join('');out.querySelectorAll('[data-id]').forEach(function(b){b.onclick=function(){onPick({id:b.dataset.id,name:b.dataset.name})}})}).catch(function(){})}
      q.oninput=function(){clearTimeout(timer);timer=setTimeout(search,250)};search();
    }
    // Sharing a file or folder of mine: with chosen people, or as a public link (optionally with a password).
    function shareDialog(name,type){
      var rel=name!=null?pathOf(name):(state.path||''),isFile=type==='file',mode='people',allowed=isFile?['view','read']:null;var label='/'+rel;
      function draw(){
        Promise.all([api('/shares/mine'),api('/links')]).then(function(res){
          var shares=res[0].shares||[],links=res[1],link=(links.links||[]).find(function(l){return l.path===rel}),url=link?location.origin+API+'/p/'+link.id:'';
          if(!links.enabled&&mode==='public')mode='people';
          var rows=shares.map(function(x){var who=(x.recipient&&(x.recipient.display_name||x.recipient.username))||x.recipient_id;return '<div class="mc-share-row" data-id="'+esc(x.id)+'"><div><b>'+esc(who)+'</b> · '+esc('/'+x.path)+'</div>'+rightBoxes(x.permissions,allowed&&x.path===rel?allowed:null)+'<div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-save>'+esc(tr('mc_save_policy'))+'</button><button class="mc-btn mc-btn-danger" data-stop>'+esc(tr('mc_stop_sharing'))+'</button></div></div>'}).join('')||'<div class="mc-admin-empty">'+esc(tr('mc_none_shared'))+'</div>';
          var people='<div class="mc-admin-section" data-new><h4>'+esc(tr('mc_share_new'))+'</h4><div style="padding:14px"><div data-people></div><div class="mc-picked" style="margin:8px 0;font-weight:700"></div>'+rightBoxes(['view','read'],allowed)+'<div data-error style="color:var(--pub-red,#f38ba8);font-size:12px"></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-share disabled>'+esc(tr('mc_share_button'))+'</button></div></div></div><div class="mc-admin-section"><h4>'+esc(tr('mc_shared_by_me'))+'</h4><div style="padding:8px 14px">'+rows+'</div></div>';
          var pub=link?'<div class="mc-admin-section"><h4>'+esc(tr('mc_pl_link'))+'</h4><div style="padding:14px"><input readonly data-url value="'+esc(url)+'"><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);margin:6px 0">'+esc(tr(link.has_password?'mc_pl_has_password':'mc_pl_no_password'))+'</div><div class="mc-admin-actions" style="justify-content:flex-start"><button class="mc-btn mc-btn-primary" data-copy>'+esc(tr('mc_copy_link'))+'</button><button class="mc-btn mc-btn-danger" data-unlink>'+esc(tr('mc_pl_stop'))+'</button></div></div></div><div class="mc-admin-section"><h4>'+esc(tr('mc_pl_password'))+'</h4><div style="padding:14px"><input type="password" data-pass autocomplete="new-password" placeholder="'+esc(tr('mc_pl_new_password'))+'"><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px"></div><div class="mc-admin-actions" style="justify-content:flex-start"><button class="mc-btn" data-setpass>'+esc(tr('mc_pl_set_password'))+'</button>'+(link.has_password?'<button class="mc-btn mc-btn-subtle" data-nopass>'+esc(tr('mc_pl_remove_password'))+'</button>':'')+'</div></div></div>'
            :'<div class="mc-admin-section"><h4>'+esc(tr('mc_pl_make'))+'</h4><div style="padding:14px"><p style="margin:0 0 8px;line-height:1.5">'+esc(tr('mc_pl_intro'))+'</p><input type="password" data-pass autocomplete="new-password" placeholder="'+esc(tr('mc_pl_optional_password'))+'"><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px"></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-make>'+esc(tr('mc_pl_create'))+'</button></div></div></div>';
          dialog('<section class="mc-admin"><h3>🔗 '+esc(tr(isFile?'mc_share_file_title':'mc_share_title'))+'</h3><p class="mc-admin-lead">'+esc(tr('mc_share_intro',{folder:label}))+'</p><div class="mc-admin-actions" style="justify-content:flex-start;padding:0 14px 8px"><button class="mc-btn '+(mode==='people'?'mc-btn-primary':'mc-btn-subtle')+'" data-mode="people">👥 '+esc(tr('mc_share_people'))+'</button>'+(links.enabled?'<button class="mc-btn '+(mode==='public'?'mc-btn-primary':'mc-btn-subtle')+'" data-mode="public">🌐 '+esc(tr('mc_share_public'))+'</button>':'')+'</div>'+(mode==='people'?people:pub)+'<div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+esc(tr('mc_close'))+'</button></div></section>',function(box){
            box.querySelectorAll('[data-mode]').forEach(function(b){b.onclick=function(){mode=b.dataset.mode;draw()}});
            var err=function(t){var e=box.querySelector('[data-error]');if(e)e.textContent=t};
            if(mode==='people'){
              var picked=null,btn=box.querySelector('[data-share]');
              personPicker(box.querySelector('[data-people]'),function(u){picked=u;box.querySelector('.mc-picked').textContent=u.name;btn.disabled=false});
              btn.onclick=function(){btn.disabled=true;api('/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_id:picked.id,path:rel,permissions:readRights(box.querySelector('[data-new]'))})}).then(draw).catch(function(e){err(e.message);btn.disabled=false})};
              box.querySelectorAll('.mc-share-row').forEach(function(r){
                r.querySelector('[data-save]').onclick=function(){api('/shares/'+enc(r.dataset.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:readRights(r)})}).then(draw).catch(function(e){notice(e.message)})};
                r.querySelector('[data-stop]').onclick=function(){api('/shares/'+enc(r.dataset.id),{method:'DELETE'}).then(draw).catch(function(e){notice(e.message)})};
              });
            }else if(link){
              box.querySelector('[data-copy]').onclick=function(){var i=box.querySelector('[data-url]');i.select();try{navigator.clipboard.writeText(url)}catch(e){document.execCommand('copy')}box.querySelector('[data-copy]').textContent=tr('mc_copied')};
              box.querySelector('[data-unlink]').onclick=function(){api('/links/'+enc(link.id),{method:'DELETE'}).then(draw).catch(function(e){notice(e.message)})};
              function setPass(v){api('/links/'+enc(link.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:v})}).then(draw).catch(function(e){err(e.message)})}
              box.querySelector('[data-setpass]').onclick=function(){var v=box.querySelector('[data-pass]').value;if(!v)return err(tr('mc_pl_password_empty'));setPass(v)};
              var np=box.querySelector('[data-nopass]');if(np)np.onclick=function(){setPass('')};
            }else{
              box.querySelector('[data-make]').onclick=function(){api('/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:rel,password:box.querySelector('[data-pass]').value||null})}).then(draw).catch(function(e){err(e.message)})};
            }
          });
        }).catch(function(e){notice(e.message)});
      }
      draw();
    }
    // Quota in MB or GB (stored in bytes).
    var MB=1048576,GB=1073741824;
    function quotaField(bytes){var gb=bytes!=null&&bytes>0&&bytes%GB===0,val=bytes==null?'':(gb?bytes/GB:Math.round(bytes/MB*100)/100);return '<div style="display:flex;gap:8px"><input data-qn type="number" min="0" step="any" value="'+val+'" placeholder="'+esc(tr('mc_no_quota'))+'"><select data-qu style="width:auto"><option value="mb"'+(gb?'':' selected')+'>'+esc(tr('mc_unit_mb'))+'</option><option value="gb"'+(gb?' selected':'')+'>'+esc(tr('mc_unit_gb'))+'</option></select></div><div style="font-size:12px;color:var(--pub-fg2,#a6adc8)">'+esc(tr('mc_quota_hint'))+'</div>'}
    function readQuota(box){var raw=box.querySelector('[data-qn]').value.trim();if(raw==='')return null;var n=Number(raw);if(!isFinite(n)||n<0)return null;return Math.round(n*(box.querySelector('[data-qu]').value==='gb'?GB:MB))}
    // Folders the administrator offers to profiles.
    async function mounts(){
      try{
        var d=await fetch('/api/apps/mvmcloud/admin/mounts').then(function(r){if(!r.ok)throw Error();return r.json()});
        var rows=(d.mounts||[]).map(function(m){var who=m.grants.map(function(g){return (g.recipient==='*'?tr('mc_mount_everyone'):g.name)+' ('+rightsText(g.permissions)+')'}).join('; ')||tr('mc_mount_nobody');return '<div class="mc-share-row" data-id="'+esc(m.id)+'"><div><b>'+esc(m.name)+'</b> · '+esc(m.kind==='server'?tr('mc_mount_server'):tr('mc_mount_remote'))+(m.available?'':' ⚠ '+esc(tr('mc_mount_unavailable')))+'</div><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);overflow-wrap:anywhere">'+esc(m.kind==='server'?m.path:'/'+m.path)+' — '+esc(who)+'</div><div class="mc-admin-actions"><button class="mc-btn" data-edit>'+esc(tr('mc_mount_edit'))+'</button><button class="mc-btn mc-btn-danger" data-remove>'+esc(tr('mc_mount_remove'))+'</button></div></div>'}).join('')||'<div class="mc-admin-empty">'+esc(tr('mc_mount_none'))+'</div>';
        dialog('<section class="mc-admin"><h3>📂 '+esc(tr('mc_mounts_title'))+'</h3><p class="mc-admin-lead">'+esc(tr('mc_mounts_intro'))+'</p><div class="mc-admin-section"><h4>'+esc(tr('mc_mounts'))+'</h4><div style="padding:8px 14px">'+rows+'</div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-add>'+esc(tr('mc_mount_add'))+'</button><button class="mc-btn mc-btn-subtle" data-back>'+esc(tr('mc_close'))+'</button></div></section>',function(box){
          box.querySelector('[data-back]').onclick=function(){admin()};
          box.querySelector('[data-add]').onclick=addMount;
          box.querySelectorAll('.mc-share-row').forEach(function(r){
            var m=d.mounts.find(function(x){return x.id===r.dataset.id});
            r.querySelector('[data-edit]').onclick=function(){editMount(m)};
            r.querySelector('[data-remove]').onclick=async function(){if(await ask(tr('mc_mount_remove_confirm'),{danger:true,yes:tr('mc_mount_remove')}))fetch('/api/apps/mvmcloud/admin/mounts/'+enc(m.id),{method:'DELETE'}).then(mounts)};
          });
        });
      }catch(e){notice(tr('mc_admin_required'))}
    }
    async function addMount(){
      if(!window.mvmOS||!mvmOS.filePicker){notice(tr('mc_picker_missing'));return}
      await mvmOS.filePicker.ready();
      var r=await mvmOS.filePicker.open({mode:'directory',sources:['server','shared'],server:{roots:['~'],start:'~'},shared:{permission:'read'}});
      if(!r||!r.folder)return;
      var body=r.source==='shared'?{kind:'remote',folder_id:r.folder.shared.folderId,path:r.folder.shared.path||'',name:r.folder.shared.folderName||r.folder.name}:{kind:'server',path:r.folder.path,name:r.folder.name};
      body.name=(body.name||'mvmCloud').slice(0,80);
      var res=await fetch('/api/apps/mvmcloud/admin/mounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),x=await res.json().catch(function(){return {}});
      if(!res.ok){await notice(typeof x.detail==='string'?x.detail:tr('mc_request_failed'));return mounts()}
      var list=await fetch('/api/apps/mvmcloud/admin/mounts').then(function(q){return q.json()});
      editMount(list.mounts.find(function(m){return m.id===x.id}))
    }
    function editMount(m){
      var grants=m.grants.map(function(g){return {recipient:g.recipient,name:g.name,permissions:g.permissions.slice()}});
      function start(){return ['view','read'].filter(function(x){return m.ceiling.indexOf(x)>=0})}
      function draw(){
        var everyone=grants.find(function(g){return g.recipient==='*'}),people=grants.filter(function(g){return g.recipient!=='*'});
        dialog('<section class="mc-admin"><h3>📂 '+esc(tr('mc_mount_edit'))+'</h3><p class="mc-admin-lead">'+esc(tr('mc_mount_ceiling',{list:rightsText(m.ceiling)||'—'}))+'</p><div class="mc-admin-section"><div style="padding:14px"><label>'+esc(tr('mc_mount_name'))+'</label><input data-name maxlength="80" value="'+esc(m.name)+'"></div></div><div class="mc-admin-section"><h4>'+esc(tr('mc_mount_everyone'))+'</h4><div style="padding:14px"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-every '+(everyone?'checked':'')+' style="width:auto"> '+esc(tr('mc_mount_everyone_on'))+'</label><div data-every-rights>'+(everyone?rightBoxes(everyone.permissions,m.ceiling):'')+'</div></div></div><div class="mc-admin-section"><h4>'+esc(tr('mc_mount_people'))+'</h4><div style="padding:14px">'+(people.map(function(g,i){return '<div class="mc-share-row" data-i="'+i+'"><div><b>'+esc(g.name)+'</b></div>'+rightBoxes(g.permissions,m.ceiling)+'<div class="mc-admin-actions"><button class="mc-btn mc-btn-danger" data-del>'+esc(tr('mc_mount_remove'))+'</button></div></div>'}).join('')||'<div class="mc-admin-empty">'+esc(tr('mc_mount_nobody'))+'</div>')+'<h4 style="margin:14px 0 6px">'+esc(tr('mc_mount_add_person'))+'</h4><div data-people></div></div></div><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px;padding:0 14px"></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-save>'+esc(tr('mc_save_policy'))+'</button><button class="mc-btn mc-btn-subtle" data-back>'+esc(tr('mc_cancel'))+'</button></div></section>',function(box){
          var name=box.querySelector('[data-name]');
          function sync(){
            m.name=name.value.trim()||m.name;
            var ev=box.querySelector('[data-every-rights]');if(everyone&&ev.firstChild)everyone.permissions=readRights(ev);
            box.querySelectorAll('.mc-share-row').forEach(function(r){people[+r.dataset.i].permissions=readRights(r)});
          }
          box.querySelector('[data-every]').onchange=function(e){sync();if(e.target.checked)grants.push({recipient:'*',name:'*',permissions:start()});else grants=grants.filter(function(g){return g.recipient!=='*'});draw()};
          box.querySelectorAll('.mc-share-row [data-del]').forEach(function(b){b.onclick=function(){sync();var g=people[+b.closest('.mc-share-row').dataset.i];grants=grants.filter(function(x){return x!==g});draw()}});
          personPicker(box.querySelector('[data-people]'),function(u){sync();if(!grants.some(function(g){return g.recipient===u.id}))grants.push({recipient:u.id,name:u.name,permissions:start()});draw()});
          box.querySelector('[data-back]').onclick=mounts;
          box.querySelector('[data-save]').onclick=function(){sync();fetch('/api/apps/mvmcloud/admin/mounts/'+enc(m.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:m.name,grants:grants.map(function(g){return {recipient:g.recipient,permissions:g.permissions}})})}).then(async function(r){if(!r.ok){var x=await r.json().catch(function(){return {}});throw Error(typeof x.detail==='string'?x.detail:tr('mc_request_failed'))}mounts()}).catch(function(e){box.querySelector('[data-error]').textContent=e.message})};
        });
      }
      draw();
    }
    async function load(){state.me=await api('/me');showUsage();var sp=await api('/spaces').catch(function(){return {spaces:[]}});state.spaces=sp.spaces||[];fillSpaces();vaultButton.hidden=!!state.space||!state.me.policy.encryption_allowed;if(userApiButton){var keys=await api('/api-keys').catch(function(){return {available:false}});state.userApiOffer=keys;userApiButton.hidden=!keys.available}await refreshTicket();await browse(state.path)}
    async function browse(path){applyRights();state.path=path||'';state.vault=null;state.index={files:{}};var data=await api('/files?path='+encodeURIComponent(state.path)+'&limit='+PAGE);render(data.entries,data)}
    function vaultFor(name){return(state.me.vaults||[]).find(function(v){return v.path===((state.path?state.path+'/':'')+name)})}
    // ── Gallery: media links, thumbnails, viewer ───────────────────────────
    var ticket='',urls=[],queue=[],active=0,gen=0,observer=null,moreObs=null,viewer=null,stage=null,view={i:-1,seq:0,url:''};
    state.items=[];
    function enc(x){return encodeURIComponent(x)}
    function pathOf(name){return (state.path?state.path+'/':'')+name}
    function streamUrl(path,dl){return API+'/stream?path='+enc(path)+'&t='+enc(ticket)+(dl?'&dl=1':'')+(state.space?'&space='+enc(state.space):'')}
    async function refreshTicket(){try{ticket=(await api('/media-ticket')).ticket}catch(e){}}
    var ticketTimer=setInterval(function(){if(!root.isConnected)return clearInterval(ticketTimer);refreshTicket()},30*60*1000);
    if(!document.getElementById('mc-gallery-css')){var gcss=document.createElement('style');gcss.id='mc-gallery-css';gcss.textContent='.mc{position:relative}.mc-more{height:1px}.mc-ask{z-index:20;display:flex;align-items:center;justify-content:center}.mc-ask .mc-dialog{margin:0;width:100%;max-width:420px}.mc-ask-text{margin:0 0 8px;line-height:1.5;overflow-wrap:anywhere}.mc .mc-ctx{position:absolute;z-index:15;min-width:150px;padding:4px;background:var(--pub-surface1,#313244);border:1px solid var(--pub-border,#45475a);border-radius:8px;box-shadow:0 8px 24px #0008}.mc-ctx button{display:block;width:100%;text-align:left;padding:9px 12px}.mc-crumb{cursor:pointer;color:var(--pub-accent,#89b4fa)}.mc-crumb:hover{text-decoration:underline}.mc-up .name{color:var(--pub-fg2,#a6adc8)}.mc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:6px;padding:8px}.mc .mc-tile{position:relative;aspect-ratio:1;padding:0;border-radius:8px;overflow:hidden;background:var(--pub-surface2,#313244)}.mc-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.mc-ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;font-size:28px;opacity:.6}.mc-ph small{font-size:11px;max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}.mc-play{position:absolute;right:5px;bottom:5px;background:#000b;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px}.mc-viewer{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:#000f;color:#fff}.mc-viewer[hidden]{display:none}.mc-vbar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0009}.mc-vtitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mc-vcount{opacity:.7;font-size:12px}.mc .mc-vbar button,.mc .mc-vnav{background:#ffffff26;color:#fff;font-size:18px;min-width:40px;min-height:40px}.mc-vstage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}.mc-vstage img,.mc-vstage video{max-width:100%;max-height:100%;object-fit:contain;display:block}.mc-vstage video{width:100%;height:100%;background:#000}.mc .mc-vnav{position:absolute;top:50%;margin-top:-28px;width:48px;height:56px;border-radius:24px;font-size:32px;line-height:1;padding:0;z-index:1}.mc .mc-vprev{left:8px}.mc .mc-vnext{right:8px}.mc .mc-vnav[hidden]{display:none}.mc-vmsg{padding:24px;text-align:center;line-height:1.5}.mc-vmsg button{margin-top:12px}';document.head.appendChild(gcss)}
    function releaseThumbs(){urls.forEach(function(u){URL.revokeObjectURL(u)});urls=[];queue=[];if(observer){observer.disconnect();observer=null}if(moreObs){moreObs.disconnect();moreObs=null}}
    async function fetchBlob(it){var r=await fetch(API+'/download?path='+enc(it.path)+(state.space?'&space='+enc(state.space):''),{headers:{'X-Pub-Token':token}});if(!r.ok)throw Error(tr('mc_download_failed'));var buf=await r.arrayBuffer();return new Blob([state.vault?await decrypt(state.vault.key,buf):buf],{type:it.mime||''})}
    // The small copy is made once (at upload, or the first time an older file is
    // shown) and kept on the server, so other devices only fetch a few KB.
    function pushThumb(path,res){var f=new FormData();f.append('path',path);f.append('dur',Math.round(res.dur||0));f.append('file',res.blob,'t.jpg');return api('/thumb',{method:'POST',body:f,headers:{}}).catch(function(){})}
    async function thumbFor(it){
      var plain=!state.vault,key=plain?state.me.id+'|'+it.path+'|'+it.size+'|'+it.modified:null;
      if(key){var hit=await idbGet(key);if(hit&&hit.blob)return hit}
      var res=null;
      if(plain){
        if(!ticket)return null;
        if(it.thumb){try{var sr=await fetch(API+'/thumb?path='+enc(it.path)+'&t='+enc(ticket)+(state.space?'&space='+enc(state.space):''));if(sr.ok)res={blob:await sr.blob(),dur:it.dur||0}}catch(e){}}
        if(!res){
          if(it.kind==='image'){var r=await fetch(streamUrl(it.path));if(!r.ok)throw Error('fetch');res=await imageThumb(await r.blob())}
          else res=await videoThumb(streamUrl(it.path));
          pushThumb(it.path,res);
        }
      }else{
        // An encrypted folder is decrypted in memory only; nothing readable is stored on disk.
        if(it.kind!=='image'||it.size>30*1048576)return null;
        res=await imageThumb(await fetchBlob(it));
      }
      if(key)idbPut(key,{blob:res.blob,dur:res.dur||0,at:Date.now()});
      return res;
    }
    function pump(){while(active<3&&queue.length){var job=queue.shift();active++;job().catch(function(){}).then(function(){active--;pump()})}}
    function watchTiles(tiles){
      var mine=gen;tiles=tiles||list.querySelectorAll('.mc-tile');
      function want(tile){
        var it=state.items[+tile.dataset.i];
        queue.push(function(){return thumbFor(it).then(function(res){
          if(mine!==gen||!res||!tile.isConnected)return;
          var u=URL.createObjectURL(res.blob);urls.push(u);
          var img=new Image();img.alt='';img.src=u;tile.insertBefore(img,tile.firstChild);
          var ph=tile.querySelector('.mc-ph');if(ph)ph.remove();
          var badge=tile.querySelector('.mc-play');if(badge&&res.dur)badge.textContent='▶ '+clock(res.dur);
        })});
        pump();
      }
      if(!window.IntersectionObserver){tiles.forEach(want);return}
      observer=observer||new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;observer.unobserve(e.target);want(e.target)})},{root:list,rootMargin:'300px'});
      tiles.forEach(function(t){observer.observe(t)});
    }
    function renderPath(){
      var parts=state.path?state.path.split('/'):[],h='<a class="mc-crumb" data-p="">'+esc(tr('mc_root'))+'</a>';
      parts.forEach(function(p,i){h+=' / '+(i<parts.length-1?'<a class="mc-crumb" data-p="'+esc(parts.slice(0,i+1).join('/'))+'">'+esc(p)+'</a>':'<span>'+esc(p)+'</span>')});
      if(state.vault)h+='  🔒 '+esc(tr('mc_encrypted'));
      var bar=$('.mc-path');bar.innerHTML=h;
      bar.querySelectorAll('[data-p]').forEach(function(a){a.onclick=function(){browse(a.dataset.p).catch(function(e){notice(e.message)})}});
    }
    function build(rows){
      var g={folders:[],files:[],items:[]};
      rows.forEach(function(r){
        if(state.vault&&r.name===INDEX)return;
        var meta=state.vault&&state.index.files[r.name],e={name:r.name,real:meta?meta.name:r.name,type:r.type,size:r.size,modified:r.modified,thumb:r.thumb,dur:r.dur,path:pathOf(r.name)},info=r.type==='file'&&!state.remote&&mediaInfo(e.real);
        if(info){e.kind=info[0];e.mime=info[1];g.items.push(e)}else if(r.type==='folder')g.folders.push(e);else g.files.push(e);
      });
      return g;
    }
    function rowHtml(e){
      var vault=e.type==='folder'&&vaultFor(e.name),display=vault?'🔒 '+tr('mc_encrypted_folder'):(e.type==='folder'?'📁 ':'📄 ')+e.real;
      return '<div class="mc-row" data-name="'+esc(e.name)+'" data-type="'+e.type+'"><span class="name">'+esc(display)+'</span><small>'+esc(e.type==='file'?fmt(e.size):tr('mc_folder_type'))+'</small></div>';
    }
    function tileHtml(e,i){
      return '<button class="mc-tile" data-i="'+i+'" data-name="'+esc(e.name)+'" data-type="file" title="'+esc(e.real)+'"><span class="mc-ph">'+(e.kind==='video'?'🎬':'🖼️')+'<small>'+esc(e.real)+'</small></span>'+(e.kind==='video'?'<span class="mc-play">▶</span>':'')+'</button>';
    }
    function bindRows(){
      list.querySelectorAll('[data-name]').forEach(function(el){
        if(el.dataset.bound)return;el.dataset.bound='1';
        el.onclick=function(){open(el.dataset.name,el.dataset.type,vaultFor(el.dataset.name))};
        el.oncontextmenu=function(e){ctxMenu(e,el.dataset.name,el.dataset.type)};
      });
    }
    function render(rows,page){
      gen++;releaseThumbs();renderPath();
      var g=build(rows);
      // A page arrives already in order; only an encrypted folder is sorted here (real names are inside the index).
      if(state.vault){g.folders.sort(natural);g.files.sort(natural);g.items.sort(natural)}
      state.items=g.items;state.more=!!(page&&page.next!=null);state.next=state.more?page.next:0;state.media=page&&page.media_total||0;
      var html=state.path?'<div class="mc-row mc-up" data-up><span class="name">↩ '+esc(tr('mc_up'))+'</span></div>':'';
      html+=g.folders.concat(g.files).map(rowHtml).join('');
      if(g.items.length)html+='<div class="mc-grid">'+g.items.map(tileHtml).join('')+'</div>';
      if(!g.folders.length&&!g.files.length&&!g.items.length)html+='<div class="mc-empty">'+esc(tr('mc_empty'))+'</div>';
      list.innerHTML=html+'<div class="mc-more"></div>';
      var up=list.querySelector('[data-up]');
      if(up)up.onclick=function(){browse(state.path.split('/').slice(0,-1).join('/')).catch(function(e){notice(e.message)})};
      bindRows();watchTiles();watchMore();
    }
    // Big folders arrive page by page: when the end of the list gets near, the next page is added.
    function watchMore(){
      if(moreObs){moreObs.disconnect();moreObs=null}
      var end=list.querySelector('.mc-more');if(!state.more||!end)return;
      if(!window.IntersectionObserver){loadMore();return}
      moreObs=new IntersectionObserver(function(es){if(es[0].isIntersecting)loadMore()},{root:list,rootMargin:'600px'});
      moreObs.observe(end);
    }
    function loadMore(){
      if(!state.more||state.vault)return Promise.resolve();
      return state.loadP||(state.loadP=loadPage().finally(function(){state.loadP=null}));
    }
    async function loadPage(){
      var mine=gen;
      try{
        var page=await api('/files?path='+enc(state.path)+'&offset='+state.next+'&limit='+PAGE);
        if(mine!==gen)return;
        var g=build(page.entries),end=list.querySelector('.mc-more'),grid=list.querySelector('.mc-grid'),rows=g.folders.concat(g.files).map(rowHtml).join('');
        if(rows)(grid||end).insertAdjacentHTML('beforebegin',rows);
        if(g.items.length){
          if(!grid){end.insertAdjacentHTML('beforebegin','<div class="mc-grid"></div>');grid=list.querySelector('.mc-grid')}
          var from=state.items.length;state.items=state.items.concat(g.items);
          grid.insertAdjacentHTML('beforeend',g.items.map(function(e,k){return tileHtml(e,from+k)}).join(''));
          watchTiles(Array.prototype.filter.call(grid.querySelectorAll('.mc-tile'),function(t){return +t.dataset.i>=from}));
        }
        state.more=page.next!=null;state.next=state.more?page.next:0;
        bindRows();watchMore();
      }catch(e){setTimeout(function(){if(mine===gen)watchMore()},3000)}
    }
    // After a delete the list is edited in place, so the scroll position and the loaded pages stay as they are.
    function dropLocal(name){
      var i=state.items.findIndex(function(x){return x.name===name});
      if(i>=0){state.items.splice(i,1);if(state.media)state.media--}
      if(state.next)state.next--;
      list.querySelectorAll('[data-name]').forEach(function(el){if(el.dataset.name===name)el.remove()});
      list.querySelectorAll('.mc-tile').forEach(function(t,k){t.dataset.i=k});
      if(!list.querySelector('.mc-row:not(.mc-up),.mc-tile')&&!state.more&&!list.querySelector('.mc-empty'))list.insertAdjacentHTML('afterbegin','<div class="mc-empty">'+esc(tr('mc_empty'))+'</div>');
      return api('/me').then(function(m){state.me=m;showUsage()}).catch(function(){});
    }
    async function removeItem(name){
      if(!await ask(tr('mc_delete_confirm'),{danger:true,yes:tr('mc_delete')}))return false;
      try{
        await api('/files?path='+enc(pathOf(name)),{method:'DELETE'});
        if(state.vault&&state.index.files[name]){delete state.index.files[name];await uploadBlob(INDEX,new Blob([await crypt(state.vault.key,new TextEncoder().encode(JSON.stringify(state.index)))]),state.path)}
        if(state.vault)render((await api('/files?path='+enc(state.path))).entries);else await dropLocal(name);
        return true;
      }catch(x){notice(x.message);return false}
    }
    async function downloadFile(name){
      var path=pathOf(name),real=state.vault&&state.index.files[name]?state.index.files[name].name:name,a=document.createElement('a'),temp='';
      try{
        a.download=real;
        if(!state.vault&&ticket)a.href=streamUrl(path,true);   // the browser streams it straight to disk
        else{a.href=temp=URL.createObjectURL(await fetchBlob({path:path}))}
        root.appendChild(a);a.click();a.remove();
        if(temp)setTimeout(function(){URL.revokeObjectURL(temp)},1000);
      }catch(e){notice(e.message)}
    }
    async function open(name,type,vault){
      var path=pathOf(name);if(vault)return unlockVault(path,vault);if(type==='folder')return browse(path);
      var i=state.items.findIndex(function(x){return x.name===name});
      return i>=0?openViewer(i):downloadFile(name);
    }
    function buildViewer(){
      if(viewer)return;
      root.querySelector('.mc').insertAdjacentHTML('beforeend','<div class="mc-viewer" hidden><div class="mc-vbar"><span class="mc-vtitle"></span><span class="mc-vcount"></span><button data-v="share" title="'+esc(tr('mc_share_item'))+'" aria-label="'+esc(tr('mc_share_item'))+'"'+(state.space||state.vault?' hidden':'')+'>🔗</button><button data-v="dl" title="'+esc(tr('mc_download'))+'" aria-label="'+esc(tr('mc_download'))+'">⬇</button><button data-v="del" title="'+esc(tr('mc_delete'))+'" aria-label="'+esc(tr('mc_delete'))+'">🗑</button><button data-v="close" title="'+esc(tr('mc_close'))+'" aria-label="'+esc(tr('mc_close'))+'">✕</button></div><div class="mc-vstage"></div><button class="mc-vnav mc-vprev" data-v="prev" title="'+esc(tr('mc_prev'))+'" aria-label="'+esc(tr('mc_prev'))+'">‹</button><button class="mc-vnav mc-vnext" data-v="next" title="'+esc(tr('mc_next'))+'" aria-label="'+esc(tr('mc_next'))+'">›</button></div>');
      viewer=root.querySelector('.mc-viewer');stage=viewer.querySelector('.mc-vstage');
      viewer.onclick=async function(e){
        var b=e.target.closest('[data-v]'),act=b?b.dataset.v:(e.target===stage?'close':'');
        if(act==='close')closeViewer();else if(act==='prev')step(-1);else if(act==='next')step(1);
        else if(act==='share'){var si=state.items[view.i];if(si)shareDialog(si.name,'file')}
        else if(act==='dl'){var it=state.items[view.i];if(it)downloadFile(it.name)}
        else if(act==='del'){var cur=state.items[view.i];if(cur&&await removeItem(cur.name)){if(state.items.length)show(Math.min(view.i,state.items.length-1));else closeViewer()}}
      };
      var tx=0,ty=0,tracking=false;
      viewer.addEventListener('touchstart',function(e){tracking=e.target.tagName!=='VIDEO'&&e.touches.length===1;if(tracking){tx=e.touches[0].clientX;ty=e.touches[0].clientY}},{passive:true});
      viewer.addEventListener('touchend',function(e){if(!tracking)return;tracking=false;var t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;if(Math.abs(dx)>60&&Math.abs(dy)<Math.abs(dx)*.6)step(dx<0?1:-1)},{passive:true});
    }
    function onKey(e){
      if(!viewer||viewer.hidden||root.querySelector('.mc-ask'))return;
      if(!viewer.isConnected){document.removeEventListener('keydown',onKey,true);return}
      if(e.key==='Escape'){e.preventDefault();closeViewer()}
      else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&e.target.tagName!=='VIDEO'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1)}
    }
    function clearStage(){var m=stage.firstChild;if(m&&m.tagName==='VIDEO'){m.pause();m.removeAttribute('src');m.load()}if(view.url){URL.revokeObjectURL(view.url);view.url=''}stage.textContent=''}
    function closeViewer(){if(!viewer||viewer.hidden)return;view.seq++;clearStage();viewer.hidden=true;document.removeEventListener('keydown',onKey,true)}
    async function step(d){var n=view.i+d;if(n>=state.items.length&&state.more)await loadMore();if(n>=0&&n<state.items.length)show(n)}
    function openViewer(i){buildViewer();viewer.hidden=false;document.addEventListener('keydown',onKey,true);show(i)}
    function message(text){stage.innerHTML='<div class="mc-vmsg">'+esc(text)+'<br><button data-v="dl">⬇ '+esc(tr('mc_download'))+'</button></div>'}
    async function show(i){
      var it=state.items[i],seq=++view.seq;if(!it)return closeViewer();
      view.i=i;clearStage();
      viewer.querySelector('.mc-vtitle').textContent=it.real;viewer.querySelector('[data-v="share"]').hidden=!!state.space||!!state.vault;viewer.querySelector('.mc-vcount').textContent=(i+1)+' / '+Math.max(state.media||0,state.items.length);
      viewer.querySelector('.mc-vprev').hidden=i===0;viewer.querySelector('.mc-vnext').hidden=i===state.items.length-1&&!state.more;if(state.more&&i>=state.items.length-4)loadMore();
      stage.innerHTML='<div class="mc-vmsg">'+esc(tr('mc_loading'))+'</div>';
      try{
        var src;
        if(!state.vault&&ticket)src=streamUrl(it.path);
        else{
          if(state.vault&&it.size>(it.kind==='video'?300:60)*1048576)throw Error(tr('mc_preview_too_big'));
          var blob=await fetchBlob(it);if(seq!==view.seq)return;src=view.url=URL.createObjectURL(blob);
        }
        var el=document.createElement(it.kind==='video'?'video':'img');
        el.onerror=function(){if(seq===view.seq)message(tr('mc_preview_failed'))};
        if(it.kind==='video'){el.controls=true;el.autoplay=true;el.playsInline=true;el.preload='metadata'}else{el.alt=it.real}
        el.src=src;stage.textContent='';stage.appendChild(el);
        [state.items[i-1],state.items[i+1]].forEach(function(n){if(n&&n.kind==='image'&&!state.vault&&ticket)new Image().src=streamUrl(n.path)});
      }catch(e){if(seq===view.seq)message(e.message||tr('mc_preview_failed'))}
    }
    async function unlockVault(path,vault){var pass=await askText(tr('mc_unlock_prompt'),{secret:true});if(!pass)return;try{var k=await key(pass,vault.salt),raw=await fetch(API+'/download?path='+encodeURIComponent(path+'/'+INDEX),{headers:{'X-Pub-Token':token}}),index={files:{}};if(raw.ok)index=JSON.parse(new TextDecoder().decode(await decrypt(k,await raw.arrayBuffer())));state.path=path;state.vault={key:k,salt:vault.salt};state.index=index;var data=await api('/files?path='+encodeURIComponent(path));render(data.entries)}catch(e){notice(tr('mc_unlock_failed'))}}
    // A folder shared from another mvmOS takes the file straight from this browser (a signed one-file ticket, so the
    // folder key never reaches the browser and the bytes do not pass through our server). false = use the normal upload.
    async function uploadDirect(name,blob,path){
      var t;try{t=await api('/upload-ticket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path,name:name,size:blob.size})})}catch(e){return false}
      var h={'X-Upload-Ticket':t.ticket},start;
      try{var r=await fetch(t.base+'/uploads',{method:'POST',credentials:'omit',headers:Object.assign({'Content-Type':'application/json'},h),body:JSON.stringify({path:t.path,size:blob.size})});if(!r.ok)return false;start=await r.json()}catch(e){return false}
      var chunk=Math.min(start.chunk_size||4194304,4194304),off=0;
      try{do{var part=blob.slice(off,off+chunk),r2=await fetch(t.base+'/uploads/'+start.id,{method:'PUT',credentials:'omit',headers:Object.assign({'X-Upload-Offset':String(off),'Content-Type':'application/octet-stream'},h),body:part});if(!r2.ok){var d=await r2.json().catch(function(){return {}});throw Error(typeof d.detail==='string'?d.detail:tr('mc_request_failed'))}off+=part.size}while(off<blob.size)}
      catch(e){fetch(t.base+'/uploads/'+start.id,{method:'DELETE',credentials:'omit',headers:h}).catch(function(){});throw e}
      return true;
    }
    async function uploadBlob(name,blob,path){if(state.remote&&!state.vault&&await uploadDirect(name,blob,path))return {ok:true};var f=new FormData();f.append('path',path);f.append('file',blob,name);return api('/upload',{method:'POST',body:f,headers:{}})}
    async function uploadThumb(f){
      var info=mediaInfo(f.name);if(!info)return;
      try{
        var res,u;
        if(info[0]==='image')res=await imageThumb(f);
        else{u=URL.createObjectURL(f);try{res=await videoThumb(u)}finally{URL.revokeObjectURL(u)}}
        await pushThumb(pathOf(f.name),res);
      }catch(e){}
    }
    async function upload(files){for(var i=0;i<files.length;i++){var f=files[i];if(state.vault){var opaque=b64(bytes(18)).replace(/[+/=]/g,'');state.index.files[opaque]={name:f.name,size:f.size};await uploadBlob(opaque,new Blob([await crypt(state.vault.key,await f.arrayBuffer())]),state.path)}else{await uploadBlob(f.name,f,state.path);await uploadThumb(f)}}if(state.vault){var data=await crypt(state.vault.key,new TextEncoder().encode(JSON.stringify(state.index)));await uploadBlob(INDEX,new Blob([data]),state.path)}await load()}
    $('.mc-file').onchange=function(){upload(this.files).catch(function(e){notice(e.message)});this.value=''};root.querySelector('[data-act="up"]').onclick=function(){$('.mc-file').click()};root.querySelector('[data-act="folder"]').onclick=async function(){if(state.vault)return notice(tr('mc_vault_inside'));var n=await askText(tr('mc_folder_prompt'));if(n)api('/folders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:(state.path?state.path+'/':'')+n})}).then(load).catch(function(e){notice(e.message)})};
    var shareBtn=root.querySelector('[data-act="share"]');if(shareBtn)shareBtn.onclick=function(){shareDialog()};
    vaultButton.onclick=async function(){var offer=await api('/credit-features/encrypted_folder').catch(function(){return {available:false,price:0}});if(!offer.available)return;var price=offer.price||0,balance=offer.balance||0;dialog('<h3>🔒 '+tr('mc_create_vault')+'</h3><p class="mc-admin-lead">'+tr('mc_vault_intro')+'</p>'+(price?'<div class="mc-admin-section"><h4>'+tr('mc_credit_confirmation')+'</h4><div style="padding:14px;line-height:1.5">'+tr('mc_credit_cost',{price:price,balance:balance})+'</div></div>':'')+'<label>'+tr('mc_password_label')+'</label><input data-vault-pass type="password" autocomplete="new-password" placeholder="'+esc(tr('mc_password_placeholder'))+'"><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button><button class="mc-btn mc-btn-primary" data-create '+(price>balance?'disabled':'')+'>'+tr(price?'mc_confirm_create':'mc_create_vault')+'</button></div>',function(box){box.querySelector('[data-create]').onclick=function(){var pass=box.querySelector('[data-vault-pass]').value;if(!pass)return;var salt=b64(bytes(16)),name=b64(bytes(16)).replace(/[+/=]/g,''),requestId=crypto.randomUUID?crypto.randomUUID():b64(bytes(18));box.querySelector('[data-create]').disabled=true;api('/vaults',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:(state.path?state.path+'/':'')+name,salt:salt,credit_confirmed:!!price,confirmed_price:price,credit_request_id:requestId})}).then(function(){modal.hidden=true;load()}).catch(function(e){box.querySelector('[data-create]').disabled=false;notice(e.message)})}})};
    async function userApiKeys(){
      var d=await api('/api-keys'),rows=(d.keys||[]).map(function(k){return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--pub-border,#45475a)"><span style="font-size:20px">⌘</span><div style="flex:1;min-width:0"><strong>'+esc(k.label)+'</strong><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);margin-top:3px">/'+esc(k.root_path||'')+'</div><div style="font-size:11px;color:var(--pub-fg2,#a6adc8);margin-top:4px">'+esc(k.permissions.join(' · '))+'</div></div><button class="mc-btn" data-user-perms="'+esc(k.id)+'" data-current="'+esc(k.permissions.join(','))+'">'+tr('mc_edit_permissions')+'</button><button class="mc-btn mc-btn-danger" data-user-revoke="'+esc(k.id)+'">'+tr('mc_revoke')+'</button></div>'}).join('');
      dialog('<section class="mc-admin"><h3>⌘ '+tr('mc_user_api_title')+'</h3><p class="mc-admin-lead">'+tr('mc_user_api_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_active_keys')+'</h4>'+(rows||'<div class="mc-admin-empty">'+tr('mc_no_keys')+'</div>')+'</div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button><button class="mc-btn mc-btn-primary" data-new-user-key>＋ '+tr('mc_create_key')+'</button></div></section>',function(box){box.querySelector('[data-new-user-key]').onclick=function(){createUserApiKey(d)};box.querySelectorAll('[data-user-perms]').forEach(function(b){b.onclick=function(){editUserApiPermissions(b.dataset.userPerms,b.dataset.current.split(',').filter(Boolean))}});box.querySelectorAll('[data-user-revoke]').forEach(function(b){b.onclick=async function(){if(await ask(tr('mc_revoke_confirm'),{danger:true,yes:tr('mc_revoke')}))api('/api-keys/'+encodeURIComponent(b.dataset.userRevoke),{method:'DELETE'}).then(userApiKeys)}})})
    }
    function userKeyFormValues(box){var p=[];if(box.querySelector('[data-read]').checked)p.push('read');if(box.querySelector('[data-write]').checked)p.push('write');if(box.querySelector('[data-delete]').checked)p.push('delete');return p}
    function editUserApiPermissions(id,current){function checked(name){return current.indexOf(name)>=0?' checked':''}dialog('<section class="mc-admin"><h3>🔐 '+tr('mc_edit_permissions')+'</h3><p class="mc-admin-lead">'+tr('mc_edit_permissions_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_permissions')+'</h4><div style="padding:16px"><label style="display:flex;align-items:center;gap:8px"><input data-read type="checkbox"'+checked('read')+' style="width:auto"> '+tr('mc_permission_read')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-write type="checkbox"'+checked('write')+' style="width:auto"> '+tr('mc_permission_write')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-delete type="checkbox"'+checked('delete')+' style="width:auto"> '+tr('mc_permission_delete')+'</label><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px;margin-top:8px"></div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button><button class="mc-btn mc-btn-primary" data-save>'+tr('mc_save_permissions')+'</button></div></section>',function(box){box.querySelector('[data-save]').onclick=function(){var permissions=userKeyFormValues(box);if(!permissions.length){box.querySelector('[data-error]').textContent=tr('mc_key_form_required');return}api('/api-keys/'+encodeURIComponent(id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:permissions})}).then(userApiKeys).catch(function(e){box.querySelector('[data-error]').textContent=e.message})}})}
    function createUserApiKey(offer){dialog('<section class="mc-admin"><h3>⌘ '+tr('mc_create_key')+'</h3><p class="mc-admin-lead">'+tr('mc_user_api_create_intro')+'</p>'+(offer.price?'<div class="mc-admin-section"><h4>'+tr('mc_credit_confirmation')+'</h4><div style="padding:14px;line-height:1.5">'+tr('mc_credit_cost',{price:offer.price,balance:offer.balance})+'</div></div>':'')+'<div class="mc-admin-section"><h4>'+tr('mc_folder_access')+'</h4><div style="padding:16px"><label>'+tr('mc_key_label')+'</label><input data-label placeholder="'+esc(tr('mc_user_api_default_label'))+'"><label>'+tr('mc_user_api_path')+'</label><input data-path placeholder="'+esc(state.path||'/')+'"><div style="margin-top:10px;font-size:13px;color:var(--pub-fg2,#a6adc8)">'+tr('mc_permissions')+'</div><label style="display:flex;align-items:center;gap:8px"><input data-read type="checkbox" checked style="width:auto"> '+tr('mc_permission_read')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-write type="checkbox" style="width:auto"> '+tr('mc_permission_write')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-delete type="checkbox" style="width:auto"> '+tr('mc_permission_delete')+'</label><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px;margin-top:8px"></div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button><button class="mc-btn mc-btn-primary" data-save '+(offer.price>offer.balance?'disabled':'')+'>'+tr(offer.price?'mc_confirm_create':'mc_create_key')+'</button></div></section>',function(box){box.querySelector('[data-save]').onclick=function(){var permissions=userKeyFormValues(box),path=box.querySelector('[data-path]').value.trim();if(!permissions.length){box.querySelector('[data-error]').textContent=tr('mc_key_form_required');return}var requestId=crypto.randomUUID?crypto.randomUUID():b64(bytes(18));box.querySelector('[data-save]').disabled=true;api('/api-keys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:box.querySelector('[data-label]').value.trim()||tr('mc_user_api_default_label'),path:path,permissions:permissions,credit_confirmed:!!offer.price,confirmed_price:offer.price||0,credit_request_id:requestId})}).then(function(x){var help=location.origin+x.help_url;dialog('<section class="mc-admin"><h3>✓ '+tr('mc_key_created')+'</h3><p class="mc-admin-lead">'+tr('mc_user_api_key_created_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_api_key')+'</h4><div style="padding:14px"><input readonly value="'+esc(x.token)+'"><div style="font-size:12px;color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_key_hint')+'</div><button class="mc-btn" data-copy style="margin-top:8px">'+tr('mc_copy')+'</button></div></div><div class="mc-admin-section"><h4>'+tr('mc_api_start')+'</h4><div style="padding:14px"><input readonly value="'+esc(help)+'"></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button></div></section>',function(done){done.querySelector('[data-copy]').onclick=function(){navigator.clipboard.writeText(x.token);done.querySelector('[data-copy]').textContent=tr('mc_copied')}})}).catch(function(e){box.querySelector('[data-error]').textContent=e.message;box.querySelector('[data-save]').disabled=false})}})}
    if(userApiButton)userApiButton.onclick=userApiKeys;
    if(opts.desktop)root.querySelector('[data-act="admin"]').onclick=admin;
    async function admin(){try{var d=await fetch('/api/apps/mvmcloud/admin/users').then(function(r){return r.json()}),rows=(d.users||[]).map(function(u){return '<tr><td><strong>'+esc(u.display_name||u.username)+'</strong></td><td>'+fmt(u.usage_bytes)+(u.rule&&u.rule.quota_bytes!=null?' / '+fmt(u.rule.quota_bytes):'')+'</td><td><button class="mc-btn mc-btn-subtle" data-user="'+esc(u.id)+'">'+tr('mc_individual_rules')+'</button> <button class="mc-btn mc-btn-danger" data-del="'+esc(u.id)+'">'+tr('mc_delete_files')+'</button></td></tr>'}).join('')||'<tr><td colspan="3" class="mc-admin-empty">'+tr('mc_no_users')+'</td></tr>';dialog('<section class="mc-admin"><h3>'+tr('mc_admin_title')+'</h3><p class="mc-admin-lead">'+tr('mc_admin_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_users')+'</h4><table><tr><th>'+tr('mc_user')+'</th><th>'+tr('mc_used')+'</th><th>'+tr('mc_actions')+'</th></tr>'+rows+'</table></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-settings>⚙ '+tr('mc_global_settings')+' '+(d.premium?'':'🔒')+'</button><button class="mc-btn" data-mounts>'+tr('mc_mounts')+'</button><button class="mc-btn" data-tokens>'+tr('mc_external_keys')+'</button><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button></div></section>',function(box){function gate(el){if(!d.premium&&window.mvmOS&&window.mvmOS.premiumGate){window.mvmOS.premiumStatus='free';window.mvmOS.premiumGate(el,tr('mc_premium_policy'))}}box.querySelectorAll('[data-del]').forEach(function(b){b.onclick=async function(){if(await ask(tr('mc_delete_user'),{danger:true,yes:tr('mc_delete')}))fetch('/api/apps/mvmcloud/admin/users/'+b.dataset.del,{method:'DELETE'}).then(admin)}});box.querySelectorAll('[data-user]').forEach(function(b){b.onclick=function(){var u=(d.users||[]).find(function(x){return x.id===b.dataset.user})||{},rule=u.rule||{};dialog('<section class="mc-admin"><h3>'+esc(tr('mc_individual_title',{name:u.display_name||u.username||''}))+'</h3><div class="mc-admin-section"><div style="padding:16px"><label>'+esc(tr('mc_individual_quota'))+'</label>'+quotaField(rule.quota_bytes==null?null:rule.quota_bytes)+'<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" data-enc '+(rule.encryption_allowed===0?'':'checked')+' style="width:auto"> '+esc(tr('mc_allow_encryption'))+'</label></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-save>'+esc(tr('mc_save_policy'))+'</button><button class="mc-btn mc-btn-subtle" data-back>'+esc(tr('mc_cancel'))+'</button></div></section>',function(f){f.querySelector('[data-back]').onclick=admin;f.querySelector('[data-save]').onclick=function(){fetch('/api/apps/mvmcloud/admin/users/'+b.dataset.user+'/rule',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({quota_bytes:readQuota(f),encryption_allowed:f.querySelector('[data-enc]').checked})}).then(function(r){if(!r.ok)throw Error();admin()}).catch(function(){notice(tr('mc_premium_required'))})}})}});box.querySelector('[data-settings]').onclick=settings;box.querySelector('[data-tokens]').onclick=tokens;box.querySelector('[data-mounts]').onclick=mounts;gate(box.querySelector('[data-settings]'));box.querySelectorAll('[data-user]').forEach(gate)})}catch(e){notice(tr('mc_admin_required'))}}
    async function settings(){var s=await fetch('/api/apps/mvmcloud/admin/settings').then(function(r){return r.json()});dialog('<section class="mc-admin"><h3>'+tr('mc_global_title')+'</h3><p class="mc-admin-lead">'+tr('mc_global_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_default_policy')+'</h4><div style="padding:16px"><label>'+tr('mc_default_quota')+'</label>'+quotaField(s.default_quota_bytes)+'<label style="display:flex;gap:8px;align-items:center"><input data-encryption type="checkbox" '+(s.encryption_enabled?'checked':'')+' style="width:auto;margin:0"> '+tr('mc_allow_encryption_users')+'</label><label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input data-user-api type="checkbox" '+(s.user_api_enabled?'checked':'')+' style="width:auto;margin:0"> '+tr('mc_allow_user_api_keys')+'</label><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);margin-left:24px">'+tr('mc_allow_user_api_keys_hint')+'</div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-primary" data-save>'+tr('mc_save_policy')+'</button><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button></div></section>',function(form){form.querySelector('[data-save]').onclick=function(){var quota=readQuota(form);fetch('/api/apps/mvmcloud/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({default_quota_bytes:quota,encryption_enabled:form.querySelector('[data-encryption]').checked,user_api_enabled:form.querySelector('[data-user-api]').checked})}).then(function(r){if(!r.ok)throw Error();return r.json()}).then(admin).catch(function(){notice(tr('mc_premium_required'))})}})}
    async function tokens(){
      var d=await fetch('/api/apps/mvmcloud/admin/external-tokens').then(function(r){return r.json()}),rows=(d.tokens||[]).map(function(t){return '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--pub-border,#45475a)"><span style="font-size:20px">🔑</span><div style="flex:1;min-width:0"><strong>'+esc(t.label)+'</strong><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);margin-top:3px;overflow-wrap:anywhere">'+esc(t.root_path)+'</div><div style="font-size:11px;color:var(--pub-fg2,#a6adc8);margin-top:4px">'+esc(t.permissions.join(' · '))+'</div></div><button class="mc-btn" data-perms="'+esc(t.id)+'" data-current="'+esc(t.permissions.join(','))+'">'+tr('mc_edit_permissions')+'</button><button class="mc-btn mc-btn-danger" data-revoke="'+esc(t.id)+'">'+tr('mc_revoke')+'</button></div>'}).join('');
      dialog('<section class="mc-admin"><h3>🔑 '+tr('mc_keys_title')+'</h3><p class="mc-admin-lead">'+tr('mc_keys_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_active_keys')+'</h4>'+ (rows||'<div class="mc-admin-empty">'+tr('mc_no_keys')+'</div>')+'</div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-help>？ '+tr('mc_api_help')+'</button><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button><button class="mc-btn mc-btn-primary" data-new>＋ '+tr('mc_create_key')+'</button></div></section>',function(box){box.querySelector('[data-new]').onclick=createToken;box.querySelector('[data-help]').onclick=apiHelp;box.querySelectorAll('[data-perms]').forEach(function(b){b.onclick=function(){editPermissions(b.dataset.perms,b.dataset.current.split(',').filter(Boolean))}});box.querySelectorAll('[data-revoke]').forEach(function(b){b.onclick=async function(){if(await ask(tr('mc_revoke_confirm'),{danger:true,yes:tr('mc_revoke')}))fetch('/api/apps/mvmcloud/admin/external-tokens/'+b.dataset.revoke,{method:'DELETE'}).then(tokens)}})})
    }
    function apiHelp(){var base=location.origin+'/pub/mvmcloud/api',header='Authorization: Bearer YOUR_API_KEY';dialog('<section class="mc-admin"><h3>？ '+tr('mc_api_help_title')+'</h3><p class="mc-admin-lead">'+tr('mc_api_help_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_api_start')+'</h4><div style="padding:14px"><div style="font-size:12px;color:var(--pub-fg2,#a6adc8);margin-bottom:6px">'+tr('mc_api_help_endpoint')+'</div><input readonly value="'+esc(base+'/help')+'"><div style="font-size:12px;color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_help_auth')+' <code>'+esc(header)+'</code></div></div></div><div class="mc-admin-section"><h4>'+tr('mc_api_commands')+'</h4><div style="padding:14px;display:flex;flex-direction:column;gap:12px;font-size:13px"><div><strong>GET /list?path=</strong><br><span style="color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_list')+'</span></div><div><strong>POST /folders</strong><br><span style="color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_mkdir')+' <code>{"path":"new-folder"}</code></span></div><div><strong>POST /upload</strong><br><span style="color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_upload')+'</span></div><div><strong>GET /download?path=…</strong><br><span style="color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_download')+'</span></div><div><strong>DELETE /files?path=…</strong><br><span style="color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_delete')+'</span></div></div></div><div class="mc-admin-section"><h4>curl</h4><div style="padding:14px"><code style="display:block;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--pub-fg2,#a6adc8)">curl -H "'+esc(header)+'" "'+esc(base)+'/help"</code></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button></div></section>')}
    function editPermissions(id,current){function checked(name){return current.indexOf(name)>=0?' checked':''}dialog('<section class="mc-admin"><h3>🔐 '+tr('mc_edit_permissions')+'</h3><p class="mc-admin-lead">'+tr('mc_edit_permissions_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_permissions')+'</h4><div style="padding:16px"><label style="display:flex;align-items:center;gap:8px"><input data-read type="checkbox"'+checked('read')+' style="width:auto"> '+tr('mc_permission_read')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-write type="checkbox"'+checked('write')+' style="width:auto"> '+tr('mc_permission_write')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-delete type="checkbox"'+checked('delete')+' style="width:auto"> '+tr('mc_permission_delete')+'</label><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px;margin-top:8px"></div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button><button class="mc-btn mc-btn-primary" data-save>'+tr('mc_save_permissions')+'</button></div></section>',function(box){box.querySelector('[data-save]').onclick=function(){var permissions=[];if(box.querySelector('[data-read]').checked)permissions.push('read');if(box.querySelector('[data-write]').checked)permissions.push('write');if(box.querySelector('[data-delete]').checked)permissions.push('delete');if(!permissions.length){box.querySelector('[data-error]').textContent=tr('mc_key_form_required');return}fetch('/api/apps/mvmcloud/admin/external-tokens/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({permissions:permissions})}).then(function(r){if(!r.ok)throw Error(tr('mc_request_failed'));return r.json()}).then(tokens).catch(function(e){box.querySelector('[data-error]').textContent=e.message})}})}
    function createToken(){dialog('<section class="mc-admin"><h3>🔑 '+tr('mc_create_key')+'</h3><p class="mc-admin-lead">'+tr('mc_key_form_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_folder_access')+'</h4><div style="padding:16px"><label>'+tr('mc_key_label')+'</label><input data-label placeholder="'+esc(tr('mc_external_folder'))+'"><label>'+tr('mc_key_path')+'</label><input data-path placeholder="/home/.../folder"><div style="margin-top:10px;font-size:13px;color:var(--pub-fg2,#a6adc8)">'+tr('mc_permissions')+'</div><label style="display:flex;align-items:center;gap:8px"><input data-read type="checkbox" checked style="width:auto"> '+tr('mc_permission_read')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-write type="checkbox" style="width:auto"> '+tr('mc_permission_write')+'</label><label style="display:flex;align-items:center;gap:8px"><input data-delete type="checkbox" style="width:auto"> '+tr('mc_permission_delete')+'</label><div data-error style="color:var(--pub-red,#f38ba8);font-size:12px;margin-top:8px"></div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_cancel')+'</button><button class="mc-btn mc-btn-primary" data-save>'+tr('mc_create_key')+'</button></div></section>',function(box){box.querySelector('[data-save]').onclick=function(){var label=box.querySelector('[data-label]').value.trim()||tr('mc_external_folder'),path=box.querySelector('[data-path]').value.trim(),perms=[];if(box.querySelector('[data-read]').checked)perms.push('read');if(box.querySelector('[data-write]').checked)perms.push('write');if(box.querySelector('[data-delete]').checked)perms.push('delete');if(!path||!perms.length){box.querySelector('[data-error]').textContent=tr('mc_key_form_required');return}box.querySelector('[data-save]').disabled=true;fetch('/api/apps/mvmcloud/admin/external-tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:label,path:path,permissions:perms})}).then(function(r){return r.json()}).then(function(x){if(!x.token||!x.external_url)throw Error(x.detail||tr('mc_key_create_failed'));var link=location.origin+x.external_url;dialog('<section class="mc-admin"><h3>✓ '+tr('mc_key_created')+'</h3><p class="mc-admin-lead">'+tr('mc_key_created_intro')+'</p><div class="mc-admin-section"><h4>'+tr('mc_browser_link')+'</h4><div style="padding:14px"><input readonly value="'+esc(link)+'"><div class="mc-admin-actions" style="margin-top:6px"><button class="mc-btn" data-copy-link>'+tr('mc_copy_link')+'</button><button class="mc-btn mc-btn-primary" data-open>'+tr('mc_open_folder')+'</button></div></div></div><div class="mc-admin-section"><h4>'+tr('mc_api_key')+'</h4><div style="padding:14px"><input readonly value="'+esc(x.token)+'"><div style="font-size:12px;color:var(--pub-fg2,#a6adc8)">'+tr('mc_api_key_hint')+'</div></div></div><div class="mc-admin-actions"><button class="mc-btn mc-btn-subtle" data-close>'+tr('mc_close')+'</button></div></section>',function(done){done.querySelector('[data-copy-link]').onclick=function(){navigator.clipboard.writeText(link);done.querySelector('[data-copy-link]').textContent=tr('mc_copied')};done.querySelector('[data-open]').onclick=function(){window.open(link,'_blank','noopener')}})}).catch(function(e){box.querySelector('[data-error]').textContent=e.message;box.querySelector('[data-save]').disabled=false})}})}
    load().catch(function(e){list.innerHTML='<div class="mc-empty">'+esc(e.message)+'</div>'});return {destroy:function(){clearInterval(ticketTimer);releaseThumbs();closeViewer();root.innerHTML=''}};
  }
  window.MvmCloud={mount:mount};
})();
