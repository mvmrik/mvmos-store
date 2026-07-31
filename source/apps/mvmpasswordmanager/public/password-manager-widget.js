(function(){
  if(window.MvmPasswordManagerWidget)return;
  var API='/pub/mvmpasswordmanager';
  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function b64(bytes){var s='';new Uint8Array(bytes).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(s){var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  function host(url){try{return new URL(url.indexOf('://')<0?'https://'+url:url).hostname.replace(/^www\./,'').toLowerCase()}catch(_){return ''}}
  function sameHost(current,item){var a=String(current||'').replace(/^www\./,''),b=host(item.website||'');return b&&(a===b||a.endsWith('.'+b))}
  function normalUrl(value){try{var u=new URL(String(value).indexOf('://')<0?'https://'+value:value),path=u.pathname.replace(/\/$/,'')||'/';return u.protocol.toLowerCase()+'//'+u.hostname.replace(/^www\./,'').toLowerCase()+path}catch(_){return ''}}
  // passkey-page.js wraps every ArrayBuffer in the WebAuthn options as
  // {__buf:'<base64url>'} so it survives postMessage. Nothing unwrapped it here,
  // so the challenge reached the credential builder as an object and atob threw
  // before a key was ever generated.
  function unwrapBufs(value){if(value==null||typeof value!=='object')return value;if(typeof value.__buf==='string')return value.__buf;if(Array.isArray(value))return value.map(unwrapBufs);var out={};Object.keys(value).forEach(function(k){out[k]=unwrapBufs(value[k])});return out}
  // ---- import: reading another manager's export ----------------------------
  // Every manager exports the same five fields under its own column names, so
  // the parser recognises columns by synonym rather than by product. That is
  // what lets a file from a manager nobody thought of still import cleanly.
  // Minimum length for a *new* master password. Only the creation screen
  // consults it; see unlockScreen for why unlocking must not.
  var MIN_MASTER=10;
  var IMPORT_FIELDS={
    name:['name','title','account','item','entry','display name','account name','login name'],
    website:['url','uri','website','site','login_uri','login uri','urls','web site','hostname','host','link','address','web address','login_url'],
    username:['username','user','login','login_username','login username','user name','email','e-mail','email address','account','user_name','userid','user id'],
    password:['password','pass','login_password','login password','pwd','passwd','secret'],
    notes:['notes','note','comment','comments','extra','description','memo','free text']
  };
  // The importer must never mistake a header for data, so a file whose first
  // row is not recognisable as a header is treated as unreadable rather than
  // imported with a password in the name column.
  function csvRows(text){
    var rows=[],row=[],field='',quoted=false,i=0;
    text=String(text).replace(/^﻿/,'');
    // A hand-written scanner, because splitting on commas corrupts any entry
    // whose notes contain a comma or a line break — which real exports do.
    for(;i<text.length;i++){
      var c=text[i];
      if(quoted){
        if(c==='"'){ if(text[i+1]==='"'){field+='"';i++} else quoted=false }
        else field+=c;
      } else if(c==='"'){ quoted=true }
      else if(c===','||c===';'||c==='\t'){ row.push(field);field='' }
      else if(c==='\n'||c==='\r'){
        if(c==='\r'&&text[i+1]==='\n')i++;
        row.push(field);field='';
        if(row.length>1||row[0]!=='')rows.push(row);
        row=[];
      } else field+=c;
    }
    row.push(field);
    if(row.length>1||row[0]!=='')rows.push(row);
    return rows;
  }
  function headerMap(header){
    var map={},used={};
    header.forEach(function(raw,index){
      var name=String(raw||'').trim().toLowerCase().replace(/^"|"$/g,'');
      Object.keys(IMPORT_FIELDS).forEach(function(field){
        if(map[field]!==undefined||used[index])return;
        if(IMPORT_FIELDS[field].indexOf(name)>=0){map[field]=index;used[index]=true}
      });
    });
    return map;
  }
  function pickUrl(value){
    // Bitwarden and Chrome can both list several addresses for one login; the
    // vault stores one, and the first is the one the user actually signs in on.
    if(Array.isArray(value))return pickUrl(value[0]);
    if(value&&typeof value==='object')return String(value.uri||value.url||value.href||'');
    return String(value==null?'':value).split(/[\n,]/)[0].trim();
  }
  function fromCsv(text){
    var rows=csvRows(text);
    if(rows.length<2)return null;
    var map=headerMap(rows[0]);
    // A password column alone is not enough: without something to identify the
    // login by, an imported vault is a list of anonymous secrets.
    if(map.password===undefined||(map.name===undefined&&map.website===undefined&&map.username===undefined))return null;
    return rows.slice(1).map(function(row){
      function at(field){return map[field]===undefined?'':String(row[map[field]]==null?'':row[map[field]]).trim()}
      return {name:at('name'),website:pickUrl(at('website')),username:at('username'),password:at('password'),notes:at('notes')};
    });
  }
  function fromJson(text){
    var data;
    try{data=JSON.parse(text)}catch(_){return null}
    // A Bitwarden export made with a password is itself ciphertext; importing
    // it would silently store unusable rows, so it is reported, not parsed.
    if(data&&data.encrypted===true)return 'encrypted';
    var items=Array.isArray(data)?data:(data&&(data.items||data.logins||data.entries||data.accounts));
    if(!Array.isArray(items))return null;
    var out=items.map(function(item){
      if(!item||typeof item!=='object')return null;
      var login=(item.login&&typeof item.login==='object')?item.login:item;
      function pick(field){
        var names=IMPORT_FIELDS[field];
        for(var source=0;source<2;source++){
          var target=source?item:login;
          for(var i=0;i<names.length;i++){
            var keys=Object.keys(target);
            for(var k=0;k<keys.length;k++){
              if(keys[k].toLowerCase().replace(/_/g,' ')===names[i]){
                var value=target[keys[k]];
                if(value!=null&&value!=='')return value;
              }
            }
          }
        }
        return '';
      }
      var website=pickUrl(login.uris||login.uri||pick('website'));
      return {name:String(item.name||pick('name')||'').trim(),website:website,
        username:String(pick('username')||'').trim(),password:String(pick('password')||''),
        notes:String(item.notes||pick('notes')||'')};
    }).filter(Boolean);
    return out.length?out:null;
  }
  function parseImport(text,filename){
    var trimmed=String(text||'').trim();
    if(!trimmed)return null;
    var json=/\.json$/i.test(filename||'')||trimmed[0]==='{'||trimmed[0]==='[';
    // Extension and content can disagree — a .txt holding JSON, a .json that is
    // really CSV — so a failed first guess falls through to the other parser.
    var parsed=json?fromJson(trimmed):fromCsv(trimmed);
    if(parsed==='encrypted')return 'encrypted';
    if(!parsed)parsed=json?fromCsv(trimmed):fromJson(trimmed);
    if(parsed==='encrypted')return 'encrypted';
    if(!parsed)return null;
    // A row with no password and no username carries nothing worth storing;
    // secure notes and folder markers in an export land here.
    return parsed.filter(function(x){return x&&(x.password||x.username)});
  }
  window.MvmPasswordManagerImport={parse:parseImport,csvRows:csvRows};

  var styled=false;
  function style(){if(styled)return;styled=true;var s=document.createElement('style');s.textContent='.pm,.pm *,.pm-overlay,.pm-overlay *{box-sizing:border-box}.pm{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}.pm-bar{display:flex;gap:.5rem;align-items:center;padding:.7rem .8rem;border-bottom:1px solid var(--pub-border,#45475a);flex-wrap:wrap}.pm-bar-head{width:100%;display:flex;align-items:center;gap:.5rem;min-width:0}.pm-bar-tools{width:100%;display:flex;align-items:center;gap:.4rem;min-width:0}.pm-title{font-weight:700;font-size:.9rem}.pm-search{flex:1;min-width:8rem}.pm-list{overflow:auto;flex:1;padding:.75rem}.pm-card{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.75rem;margin-bottom:.55rem}.pm-head{display:flex;gap:.6rem;align-items:center}.pm-avatar{width:2rem;height:2rem;border-radius:.5rem;display:grid;place-items:center;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:800}.pm-name{font-weight:700}.pm-sub{font-size:.76rem;color:var(--pub-dim,#a6adc8);margin-top:.1rem;overflow-wrap:anywhere}.pm-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.pm-card .pm-actions{gap:.35rem;flex-wrap:nowrap}.pm-icon-btn{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm-card .pm-actions .pm-icon-btn{flex:1 1 0;min-width:0}.pm-icon-btn.pm-danger:hover{border-color:var(--pub-red,#f38ba8)}.pm-icon-btn.pm-copied{border-color:var(--pub-green,#a6e3a1)}.pm-bar-tools .pm-search{flex:1 1 auto;min-width:0}.pm-bar-tools button{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm button,.pm-btn,.pm-overlay button{border:0;border-radius:.45rem;padding:.48rem .75rem;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);transition:filter .15s,transform .15s}.pm button:hover,.pm-overlay button:hover{filter:brightness(1.12)}.pm button:active,.pm-overlay button:active{transform:translateY(1px)}.pm .primary,.pm-overlay .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.pm input,.pm textarea,.pm select,.pm-overlay input,.pm-overlay textarea,.pm-overlay select{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.6rem .7rem;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}.pm input:focus,.pm textarea:focus,.pm select:focus,.pm-overlay input:focus,.pm-overlay textarea:focus,.pm-overlay select:focus{border-color:var(--pub-accent,#89b4fa);box-shadow:0 0 0 3px color-mix(in srgb,var(--pub-accent,#89b4fa) 18%,transparent)}.pm-duration{margin:.3rem 0 .7rem}.pm-empty,.pm-unlock{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8)}.pm-unlock>div{width:100%;max-width:23rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}.pm-unlock h2{font-size:1.05rem;color:var(--pub-fg,#cdd6f4)}.pm-unlock p{font-size:.82rem;line-height:1.45}.pm-unlock input{margin:.35rem 0}.pm-error{min-height:1.3rem;color:var(--pub-red,#f38ba8);font-size:.8rem}.pm-overlay{position:absolute;inset:0;background:rgba(0,0,0,.64);z-index:5;display:grid;place-items:center;padding:1rem}.pm-dialog{width:100%;max-width:27rem;max-height:calc(100% - 2rem);overflow:auto;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.75rem;padding:1.2rem;box-shadow:0 1.2rem 3rem rgba(0,0,0,.45)}.pm-dialog h3{margin:0 0:.35rem;font-size:1.05rem}.pm-dialog label{display:block;font-size:.76rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.72rem 0 .28rem}.pm-dialog textarea{resize:vertical;min-height:5.25rem}.pm-context{font-size:.72rem;color:var(--pub-dim,#a6adc8);width:100%}.pm-match-badge{display:inline-flex;align-items:center;gap:.25rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-accent,#89b4fa) 20%,transparent);color:var(--pub-accent,#89b4fa);font-size:.65rem;vertical-align:middle}.pm-match-badge img{width:.78rem;height:.78rem;border-radius:.18rem}.pm-passkey-badge{display:inline-flex;align-items:center;gap:.2rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-green,#a6e3a1) 22%,transparent);color:var(--pub-green,#a6e3a1);font-size:.65rem;white-space:nowrap;vertical-align:middle}.pm-passkey-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.pm-passkey-info{flex:1;min-width:8rem;font-size:.8rem;overflow-wrap:anywhere}.pm-show-all{width:100%;margin:.15rem 0 .8rem}.pm-import-info{font-size:.8rem;opacity:.85;margin:.1rem 0 .7rem;line-height:1.45}.pm-import-drop{text-align:center;padding:.9rem;border:1px dashed var(--pub-border,#45475a);border-radius:.5rem;margin-bottom:.6rem}.pm-import-formats{font-size:.72rem;opacity:.7;margin-top:.45rem}.pm-import-status{font-size:.82rem;margin-bottom:.5rem}.pm-import-note{opacity:.8;font-size:.76rem;margin-top:.2rem}.pm-import-bulk{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}.pm-import-bulk button{padding:.3rem .55rem;font-size:.74rem}.pm-import-list{max-height:min(46vh,20rem);overflow:auto;margin-bottom:.5rem}.pm-import-row{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;padding:.35rem .2rem;border-bottom:1px solid var(--pub-border,#313244);font-size:.8rem}.pm-import-row input{flex:0 0 auto;margin:0}.pm-import-name{flex:1;min-width:6rem;overflow-wrap:anywhere}.pm-import-sub{opacity:.7;font-size:.74rem;overflow-wrap:anywhere}.pm-import-dupe{flex:0 0 auto;white-space:nowrap;font-size:.68rem;padding:.1rem .4rem;border-radius:.6rem;background:var(--pub-border,#45475a);opacity:.9}';document.head.appendChild(s)}
  function mount(root,opts){
    opts=opts||{};style();var token=localStorage.getItem('apphub_token');if(!token){root.innerHTML='<div class="pm-empty">'+esc(t('pm_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var key=null,entries=[],context=null,extensionSettings={},showAll=false,parentOrigin='',destroyed=false,autoLockTimer=0,APP_ID='mvmpasswordmanager',passkeyBusy=false;
    root.style.position='relative';
    function api(path,options){options=options||{};var h=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});return fetch(API+path,Object.assign({},options,{headers:h})).then(async function(r){var d=await r.json().catch(function(){return{}});if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();if(!r.ok)throw new Error(d.error||'error');return d})}
    async function derive(password,salt,iterations){var raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt'])}
    async function importKey(raw){return crypto.subtle.importKey('raw',bytes(raw),{name:'AES-GCM'},true,['encrypt','decrypt'])}
    function expiry(value){return value==='session'?0:Date.now()+Number(value)*60000}
    function scheduleAutoLock(expires){clearTimeout(autoLockTimer);if(!expires)return;var remaining=expires-Date.now();if(remaining<=0){lockNow();return}autoLockTimer=setTimeout(lockNow,remaining)}
    async function cacheKey(value){var saved={key:b64(await crypto.subtle.exportKey('raw',key)),expires:expiry(value)};scheduleAutoLock(saved.expires);localStorage.setItem('mvm_pm_unlock_duration',value);if(parentOrigin)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'vault-session-save',session:saved},parentOrigin);else sessionStorage.setItem('mvm_pm_vault_session',JSON.stringify(saved))}
    async function restoreLocalKey(){try{var saved=JSON.parse(sessionStorage.getItem('mvm_pm_vault_session')||'null');if(!saved||(saved.expires&&saved.expires<Date.now()))throw new Error();key=await importKey(saved.key);scheduleAutoLock(saved.expires);return true}catch(_){sessionStorage.removeItem('mvm_pm_vault_session');return false}}
    function clearCachedKey(){sessionStorage.removeItem('mvm_pm_vault_session');if(parentOrigin)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'vault-session-clear'},parentOrigin)}
    function lockNow(){clearTimeout(autoLockTimer);autoLockTimer=0;key=null;entries=[];clearCachedKey();load()}
    async function encrypt(value){var iv=crypto.getRandomValues(new Uint8Array(12));var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(value)));return{iv:b64(iv),ciphertext:b64(data)}}
    async function decrypt(row){var out=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(row.iv)},key,bytes(row.ciphertext));var item=JSON.parse(new TextDecoder().decode(out));item.id=row.id;return item}
    function withoutId(item){var out=Object.assign({},item);delete out.id;return out}
    async function loadEntries(){var data=await api('/vault');var out=[];for(var i=0;i<(data.entries||[]).length;i++)out.push(await decrypt(data.entries[i]));entries=out;return out}
    async function saveEntry(id,value){var encrypted=await encrypt(value);return id?api('/entries/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(encrypted)}):api('/entries',{method:'POST',body:JSON.stringify(encrypted)})}
    function unlockScreen(vault,error){if(passkeyBusy)return;var creating=!vault,duration=localStorage.getItem('mvm_pm_unlock_duration')||'session';root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t(creating?'pm_create_title':'pm_unlock'))+'</h2><p>'+esc(t(creating?'pm_create_info':'pm_unlock_info'))+'</p><input class="pm-master" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_master'))+'">'+(creating?'<input class="pm-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_confirm_master'))+'">':'')+'<label class="pm-duration-label">'+esc(t('pm_unlock_for'))+'</label><select class="pm-duration"><option value="5">'+esc(t('pm_minutes',{n:5}))+'</option><option value="15">'+esc(t('pm_minutes',{n:15}))+'</option><option value="60">'+esc(t('pm_hour'))+'</option><option value="session">'+esc(t('pm_until_closed'))+'</option></select><div class="pm-error">'+esc(error||'')+'</div><button class="primary pm-go">'+esc(t(creating?'pm_create':'pm_unlock'))+'</button></div></div>';var select=root.querySelector('.pm-duration');select.value=duration;var input=root.querySelector('.pm-master');root.querySelector('.pm-go').onclick=async function(){var pass=input.value;
      // The length rule guards the choice of a new master password, so it applies
      // only when creating a vault. Enforcing it on unlock would lock a user out
      // of a vault whose password predates the rule — the password is already
      // chosen by then, and a wrong one fails at decryption anyway.
      if(creating&&pass.length<MIN_MASTER){unlockScreen(vault,t('pm_password_short',{n:MIN_MASTER}));return}
      if(!creating&&!pass){unlockScreen(vault,t('pm_unlock_failed'));return}if(creating&&pass!==root.querySelector('.pm-confirm').value){unlockScreen(vault,t('pm_passwords_differ'));return}try{if(creating){var salt=b64(crypto.getRandomValues(new Uint8Array(32)));await api('/vault',{method:'POST',body:JSON.stringify({salt:salt,iterations:600000})});vault={salt:salt,iterations:600000}}key=await derive(pass,vault.salt,vault.iterations);await cacheKey(select.value);await load();}catch(_){key=null;unlockScreen(vault,t('pm_unlock_failed'))}};setTimeout(function(){input.focus()},30)}
    function matchesEntry(ctx,item){if(!ctx||!ctx.hostname)return true;var mode=item.match_mode&&item.match_mode!=='default'?item.match_mode:(extensionSettings.matching_mode||'domain');if(mode==='exact')return normalUrl(ctx.url)===normalUrl(item.website);if(mode==='regex'){try{return new RegExp(item.website,'i').test(ctx.url||'')}catch(_){return false}}return sameHost(ctx.hostname,item)}
    function visible(){var q=(root.querySelector('.pm-search')||{}).value||'';q=q.toLowerCase();return entries.filter(function(x){return(showAll||matchesEntry(context,x))&&JSON.stringify(x).toLowerCase().indexOf(q)>=0})}
    function render(){if(!key||passkeyBusy)return;var list=visible(),hasContext=context&&context.hostname,matchCount=hasContext?entries.filter(function(x){return matchesEntry(context,x)}).length:0;if(parentOrigin&&hasContext)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'password-match-count',count:matchCount},parentOrigin);root.innerHTML='<div class="pm"><div class="pm-bar"><div class="pm-bar-head"><span class="pm-title">🛡️ '+esc(t('pm_title'))+'</span></div><div class="pm-bar-tools"><input class="pm-search" placeholder="'+esc(t('pm_search'))+'"><button class="primary pm-add" title="'+esc(t('pm_add'))+'" aria-label="'+esc(t('pm_add'))+'">+</button>'+(parentOrigin?'':'<button class="pm-import" title="'+esc(t('pm_import_title'))+'" aria-label="'+esc(t('pm_import_title'))+'">📥</button>')+'<button class="pm-lock" title="'+esc(t('pm_lock'))+'" aria-label="'+esc(t('pm_lock'))+'">🔒</button></div><span class="pm-context">'+esc(hasContext&&!showAll?t('pm_matching',{host:context.hostname}):t('pm_all'))+'</span></div><div class="pm-list">'+(list.length?list.map(card).join(''):'<div class="pm-empty">'+esc(t('pm_empty'))+'</div>')+(hasContext&&!showAll?'<button class="pm-show-all">'+esc(t('pm_show_all'))+'</button>':'')+'</div></div>';var search=root.querySelector('.pm-search');search.oninput=render;root.querySelector('.pm-add').onclick=function(){dialog()};var importButton=root.querySelector('.pm-import');if(importButton)importButton.onclick=function(){importDialog()};root.querySelector('.pm-lock').onclick=lockNow;var all=root.querySelector('.pm-show-all');if(all)all.onclick=function(){showAll=true;render()};root.querySelector('.pm-list').onclick=onClick}
    function card(x){var matched=context&&context.hostname&&matchesEntry(context,x),badge=matched?'<span class="pm-match-badge"><img src="/apps/mvmpasswordmanager/extension-icon.png" alt="">'+esc(t('pm_match'))+'</span>':'',keyBadge=x.passkey?'<span class="pm-passkey-badge">🔑 '+esc(t('pm_passkey_field'))+'</span>':'';// Icon-only buttons keep one card's actions on a single row on a phone, but an
    // icon alone names nothing — so each carries its label as both title and
    // aria-label, which is also what a screen reader reads out.
    function action(attr,id,label,icon,extra){return'<button '+attr+'="'+esc(id)+'" class="pm-icon-btn'+(extra?' '+extra:'')+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+icon+'</button>'}
    return'<div class="pm-card" data-id="'+esc(x.id)+'"><div class="pm-head"><div class="pm-avatar">'+esc((x.name||'?')[0].toUpperCase())+'</div><div><div class="pm-name">'+esc(x.name)+badge+keyBadge+'</div><div class="pm-sub">'+esc(host(x.website)||x.username)+'</div></div></div><div class="pm-actions">'+(parentOrigin?action('data-fill',x.id,t('pm_fill'),'✒️','primary'):'')+action('data-cu',x.id,t('pm_copy_username'),'👤')+action('data-cp',x.id,t('pm_copy_password'),'🔑')+action('data-edit',x.id,t('pm_edit'),'✏️')+action('data-del',x.id,t('pm_delete'),'🗑️','pm-danger')+'</div></div>'}
    function find(id){return entries.find(function(x){return x.id===id})}

    // ---- import -----------------------------------------------------------
    // The file is read by FileReader and encrypted here with the key already in
    // memory; only {iv, ciphertext} is ever sent, over the same POST /entries
    // the manual form uses. The server has no endpoint that accepts a readable
    // login, so an import cannot leak one even by mistake.
    function importDialog(){
      var overlay=document.createElement('div');overlay.className='pm-overlay';
      overlay.innerHTML='<div class="pm-dialog pm-import"><h3>'+esc(t('pm_import_title'))+'</h3>'+
        '<p class="pm-import-info">'+esc(t('pm_import_info'))+'</p>'+
        '<div class="pm-import-drop"><button type="button" class="primary f-pick">'+esc(t('pm_import_pick'))+'</button>'+
        '<div class="pm-import-formats">'+esc(t('pm_import_formats'))+'</div></div>'+
        '<input type="file" class="f-file" accept=".json,.csv,.txt,application/json,text/csv,text/plain" hidden>'+
        '<div class="pm-import-status"></div><div class="pm-import-list"></div>'+
        '<div class="pm-error"></div><div class="pm-actions"><button class="primary f-go" hidden></button>'+
        '<button class="f-cancel">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      var file=overlay.querySelector('.f-file'),status=overlay.querySelector('.pm-import-status'),
          list=overlay.querySelector('.pm-import-list'),go=overlay.querySelector('.f-go'),
          error=overlay.querySelector('.pm-error'),cancel=overlay.querySelector('.f-cancel'),
          found=[],busy=false;
      function close(){if(!busy)overlay.remove()}
      overlay.querySelector('.f-pick').onclick=function(){file.click()};
      cancel.onclick=close;

      function duplicate(candidate){
        // Same account on the same site is the only safe definition of a
        // duplicate: same name alone would collide across a "Google" entry the
        // user keeps twice on purpose, for two different accounts.
        var site=host(candidate.website),user=(candidate.username||'').toLowerCase();
        return entries.some(function(existing){
          return host(existing.website)===site&&(existing.username||'').toLowerCase()===user&&
            (site||user);
        });
      }
      function renderList(){
        list.innerHTML=found.map(function(item,index){
          return '<label class="pm-import-row"><input type="checkbox" data-i="'+index+'"'+(item._take?' checked':'')+'>'+
            '<span class="pm-import-name">'+esc(item.name||t('pm_import_no_name'))+'</span>'+
            '<span class="pm-import-sub">'+esc(host(item.website)||item.username||'')+'</span>'+
            (item._dupe?'<span class="pm-import-dupe">'+esc(t('pm_import_dupe'))+'</span>':'')+'</label>';
        }).join('');
        list.onchange=function(e){var box=e.target.closest('input[type=checkbox]');if(!box)return;
          found[Number(box.dataset.i)]._take=box.checked;updateGo()};
        updateGo();
      }
      function updateGo(){
        var n=found.filter(function(x){return x._take}).length;
        go.hidden=!found.length;go.textContent=t('pm_import_go',{n:n});go.disabled=!n;
      }
      function handle(text,filename){
        var parsed;
        try{parsed=window.MvmPasswordManagerImport.parse(text,filename)}catch(_){parsed=null}
        if(parsed==='encrypted'){status.textContent='';error.textContent=t('pm_import_encrypted');return}
        if(!parsed){status.textContent='';error.textContent=t('pm_import_unreadable');return}
        if(!parsed.length){status.textContent='';error.textContent=t('pm_import_empty');return}
        error.textContent='';
        found=parsed.map(function(item){
          var dupe=duplicate(item);
          // Duplicates arrive unticked rather than hidden: the user may well
          // want the second copy, but should have to say so.
          return Object.assign({},item,{_dupe:dupe,_take:!dupe});
        });
        var dupes=found.filter(function(x){return x._dupe}).length;
        status.innerHTML='<div>'+esc(t('pm_import_found',{n:found.length}))+'</div>'+
          (dupes?'<div class="pm-import-note">'+esc(t('pm_import_dupes',{n:dupes}))+'</div>':'')+
          '<div class="pm-import-bulk"><button type="button" class="f-all">'+esc(t('pm_import_select_all'))+'</button>'+
          '<button type="button" class="f-none">'+esc(t('pm_import_select_none'))+'</button></div>';
        status.querySelector('.f-all').onclick=function(){found.forEach(function(x){x._take=true});renderList()};
        status.querySelector('.f-none').onclick=function(){found.forEach(function(x){x._take=false});renderList()};
        renderList();
      }
      file.onchange=function(){
        var chosen=file.files&&file.files[0];if(!chosen)return;
        error.textContent='';status.textContent=t('pm_import_reading');list.innerHTML='';go.hidden=true;found=[];
        var reader=new FileReader();
        reader.onload=function(){handle(String(reader.result||''),chosen.name)};
        reader.onerror=function(){status.textContent='';error.textContent=t('pm_import_unreadable')};
        reader.readAsText(chosen);
      };

      go.onclick=async function(){
        var take=found.filter(function(x){return x._take});
        if(!take.length){error.textContent=t('pm_import_nothing');return}
        busy=true;error.textContent='';list.innerHTML='';go.disabled=true;cancel.disabled=true;
        var saved=0,failed=0;
        for(var i=0;i<take.length;i++){
          status.textContent=t('pm_import_working',{done:i+1,total:take.length});
          var item=take[i];
          try{
            await saveEntry(null,{name:item.name||host(item.website)||item.username||t('pm_import_no_name'),
              website:item.website||'',match_mode:'default',username:item.username||'',
              password:item.password||'',notes:item.notes||''});
            saved++;
          }catch(_){failed++}
        }
        busy=false;
        status.textContent=t('pm_import_done',{n:saved})+(failed?' '+t('pm_import_failed',{n:failed}):'');
        go.hidden=true;cancel.disabled=false;cancel.textContent=t('pm_import_close');
        await load();
      };
    }
    async function onClick(e){var el=e.target.closest('button');if(!el)return;var id=el.dataset.fill||el.dataset.cu||el.dataset.cp||el.dataset.edit||el.dataset.del,item=find(id);if(!item)return;if(el.dataset.fill){window.parent.postMessage({source:'mvmos-public-app',appId:'mvmpasswordmanager',action:'autofill-login',credentials:{username:item.username||'',password:item.password||''}},parentOrigin)}else if(el.dataset.cu||el.dataset.cp){await navigator.clipboard.writeText(el.dataset.cu?item.username:item.password).catch(function(){});
      // The button no longer has a text label to replace, so confirmation is a
      // brief checkmark on the icon itself; without it a tap gives no feedback.
      el.classList.add('pm-copied');el.textContent='✅';setTimeout(function(){render()},900)}else if(el.dataset.edit)dialog(item);else if(el.dataset.del&&confirm(t('pm_delete_confirm',{name:item.name}))){await api('/entries/'+encodeURIComponent(item.id),{method:'DELETE'});await load()}}
    function dialog(item){item=item||{};var overlay=document.createElement('div');overlay.className='pm-overlay';overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t(item.id?'pm_edit_entry':'pm_new_entry'))+'</h3><label>'+esc(t('pm_name'))+'</label><input class="f-name" value="'+esc(item.name)+'"><label>'+esc(t('pm_website'))+'</label><input class="f-web" value="'+esc(item.website)+'"><label>'+esc(t('pm_match_mode'))+'</label><select class="f-match"><option value="default">'+esc(t('pm_match_default'))+'</option><option value="domain">'+esc(t('pm_match_domain'))+'</option><option value="exact">'+esc(t('pm_match_exact'))+'</option><option value="regex">'+esc(t('pm_match_regex'))+'</option></select><label>'+esc(t('pm_username'))+'</label><input class="f-user" value="'+esc(item.username)+'"><label>'+esc(t('pm_password'))+'</label><div class="pm-password-field"><input class="f-pass" type="password" value="'+esc(item.password)+'"><button type="button" class="f-toggle" title="'+esc(t('pm_show_password'))+'">👁</button></div><label>'+esc(t('pm_notes'))+'</label><textarea class="f-notes">'+esc(item.notes)+'</textarea>'+(item.passkey?'<div class="pm-passkey-block"><label>'+esc(t('pm_passkey_field'))+'</label><div class="pm-passkey-row"><span class="pm-passkey-info">🔑 '+esc(item.passkey.userDisplayName||item.passkey.userName||item.passkey.rpId||'')+'</span><button type="button" class="f-passkey-del">'+esc(t('pm_passkey_remove'))+'</button></div></div>':'')+'<div class="pm-error"></div><div class="pm-actions"><button class="primary f-save">'+esc(t('pm_save'))+'</button><button class="f-cancel">'+esc(t('pm_cancel'))+'</button></div></div>';root.appendChild(overlay);var pass=overlay.querySelector('.f-pass'),toggle=overlay.querySelector('.f-toggle'),passWrap=overlay.querySelector('.pm-password-field'),match=overlay.querySelector('.f-match');match.value=item.match_mode||'default';var keepPasskey=item.passkey||null,passkeyDel=overlay.querySelector('.f-passkey-del');if(passkeyDel)passkeyDel.onclick=function(){keepPasskey=null;overlay.querySelector('.pm-passkey-block').remove()};passWrap.style.cssText='display:flex;gap:.45rem;align-items:center';pass.style.flex='1';toggle.style.cssText='flex:0 0 auto;padding:.55rem .65rem;font-size:1rem';toggle.onclick=function(){var showing=pass.type==='text';pass.type=showing?'password':'text';toggle.textContent=showing?'👁':'🙈';toggle.title=t(showing?'pm_show_password':'pm_hide_password')};overlay.querySelector('.f-cancel').onclick=function(){overlay.remove()};overlay.querySelector('.f-save').onclick=async function(){var value={name:overlay.querySelector('.f-name').value.trim(),website:overlay.querySelector('.f-web').value.trim(),match_mode:match.value,username:overlay.querySelector('.f-user').value.trim(),password:pass.value,notes:overlay.querySelector('.f-notes').value};if(keepPasskey)value.passkey=keepPasskey;if(!value.name||(!value.password&&!value.passkey)){overlay.querySelector('.pm-error').textContent=t('pm_required');return}try{var out=await saveEntry(item.id,value);if(!item.id)value.id=out.id;overlay.remove();await load()}catch(_){overlay.querySelector('.pm-error').textContent=t('pm_error')}};setTimeout(function(){overlay.querySelector('.f-name').focus()},20)}
    async function load(){try{var payload=await api('/vault');if(!payload.vault){unlockScreen(null);return}if(!key&&!parentOrigin)await restoreLocalKey();if(!key){unlockScreen(payload.vault);return}entries=[];for(var i=0;i<payload.entries.length;i++)entries.push(await decrypt(payload.entries[i]));render()}catch(_){if(key)unlockScreen(null,t('pm_unlock_failed'));else root.innerHTML='<div class="pm-empty">'+esc(t('pm_error'))+'</div>'}}
    function pk(){return window.MvmPasswordManagerPasskey}
    function replyPasskey(reqId,result,error){passkeyBusy=false;if(parentOrigin)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'passkey-result',reqId:reqId,result:result,error:error},parentOrigin)}
    // A passkey is a field of an ordinary login, the way Bitwarden stores one, so
    // it is encrypted inside the entry itself and found by the same matching rule
    // the entry already uses for passwords. The rp id is kept as a fallback so a
    // passkey stays usable even if its login's website field is later edited.
    function passkeyOwners(rpId,origin,allow){return entries.filter(function(x){if(!x.passkey)return false;if(allow.length&&allow.indexOf(x.passkey.credentialId)<0)return false;return matchesEntry({hostname:rpId,url:origin},x)||String(x.passkey.rpId||'').toLowerCase()===rpId})}
    function passkeyLabel(x){return x.passkey&&(x.passkey.userDisplayName||x.passkey.userName)||x.name}
    function passkeyUnlockGate(job){return new Promise(function(resolve){if(key){resolve();return}root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_unlock_title'))+'</h2><p>'+esc(t('pm_unlock_info'))+'</p><input class="pm-master" type="password" autocomplete="current-password" placeholder="'+esc(t('pm_master'))+'"><div class="pm-error"></div><button class="primary pm-go">'+esc(t('pm_unlock'))+'</button></div></div>';var input=root.querySelector('.pm-master'),err=root.querySelector('.pm-error');root.querySelector('.pm-go').onclick=async function(){try{var payload=await api('/vault');if(!payload.vault)throw new Error('vault_missing');key=await derive(input.value,payload.vault.salt,payload.vault.iterations);await cacheKey(localStorage.getItem('mvm_pm_unlock_duration')||'session');resolve()}catch(_){err.textContent=t('pm_unlock_failed')}};setTimeout(function(){input.focus()},30)})}
    async function runPasskeyCreate(job){await passkeyUnlockGate(job);var opts=Object.assign({},unwrapBufs(job.options),{__origin:job.origin});var rpId=String((opts.rp&&opts.rp.id)||new URL(job.origin).hostname).toLowerCase();try{await loadEntries()}catch(_){}var targets=entries.filter(function(x){return !x.passkey&&matchesEntry({hostname:rpId,url:job.origin},x)});var account=(opts.user&&(opts.user.displayName||opts.user.name))||rpId;return new Promise(function(resolve){root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_create_title'))+'</h2><p>'+esc(t('pm_passkey_create_info',{host:rpId}))+'</p>'+'<label class="pm-duration-label">'+esc(t('pm_passkey_save_to'))+'</label><select class="pm-duration pm-passkey-target"><option value="">'+esc(t('pm_passkey_new_login'))+'</option>'+targets.map(function(x,i){return'<option value="'+i+'">'+esc(x.name)+'</option>'}).join('')+'</select>'+'<label class="pm-duration-label">'+esc(t('pm_passkey_name'))+'</label><input class="pm-passkey-name" value="'+esc(account)+'">'+'<div class="pm-error"></div><div class="pm-actions"><button class="primary pm-go">'+esc(t('pm_passkey_save'))+'</button><button class="pm-cancel">'+esc(t('pm_cancel'))+'</button></div></div></div>';var nameInput=root.querySelector('.pm-passkey-name'),target=root.querySelector('.pm-passkey-target'),err=root.querySelector('.pm-error');root.querySelector('.pm-cancel').onclick=function(){replyPasskey(job.reqId,null,'The operation was cancelled.');resolve()};root.querySelector('.pm-go').onclick=async function(){try{var result=await pk().createCredential(opts);var record=result.vaultRecord;record.userDisplayName=nameInput.value.trim()||record.userDisplayName||record.userName;record.signCount=1;if(target.value===''){await saveEntry(null,{name:record.rpName||rpId,website:rpId,match_mode:'default',username:record.userName||record.userDisplayName||'',password:'',notes:'',passkey:record})}else{var item=targets[Number(target.value)],value=withoutId(item);value.passkey=record;await saveEntry(item.id,value)}replyPasskey(job.reqId,{credentialId:result.credentialId,clientDataJSON:result.clientDataJSON,attestationObject:result.attestationObject,publicKeySpki:result.publicKeySpki});resolve()}catch(_){err.textContent=t('pm_error')}}})}
    async function runPasskeyGet(job){await passkeyUnlockGate(job);var opts=Object.assign({},unwrapBufs(job.options),{__origin:job.origin});var rpId=String(opts.rpId||new URL(job.origin).hostname).toLowerCase();try{await loadEntries()}catch(_){}var allow=(opts.allowCredentials||[]).map(function(c){return c&&c.id}).filter(Boolean);var candidates=passkeyOwners(rpId,job.origin,allow);if(!candidates.length){replyPasskey(job.reqId,null,'No matching passkey.');return}return new Promise(function(resolve){function pick(item){root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t('pm_passkey_confirm_title'))+'</h2><p>'+esc(t('pm_passkey_confirm_info',{name:passkeyLabel(item)}))+'</p><div class="pm-error"></div><div class="pm-actions"><button class="primary pm-go">'+esc(t('pm_passkey_use'))+'</button><button class="pm-cancel">'+esc(t('pm_cancel'))+'</button></div></div></div>';var err=root.querySelector('.pm-error');root.querySelector('.pm-cancel').onclick=function(){replyPasskey(job.reqId,null,'The operation was cancelled.');resolve()};root.querySelector('.pm-go').onclick=async function(){try{var assertion=await pk().getAssertion(opts,item.passkey);var value=withoutId(item);value.passkey=Object.assign({},item.passkey,{signCount:(item.passkey.signCount||0)+1});await saveEntry(item.id,value).catch(function(){});replyPasskey(job.reqId,assertion);resolve()}catch(_){err.textContent=t('pm_error')}}}if(candidates.length===1){pick(candidates[0]);return}root.innerHTML='<div class="pm"><div class="pm-bar"><span class="pm-title">🔑 '+esc(t('pm_passkey_pick_title'))+'</span></div><div class="pm-list">'+candidates.map(function(c,idx){return'<div class="pm-card"><div class="pm-head"><div class="pm-avatar">'+esc((passkeyLabel(c)||'?')[0].toUpperCase())+'</div><div><div class="pm-name">'+esc(passkeyLabel(c))+'</div><div class="pm-sub">'+esc(c.name)+' · '+esc(rpId)+'</div></div></div><div class="pm-actions"><button class="primary" data-pick="'+idx+'">'+esc(t('pm_passkey_use'))+'</button></div></div>'}).join('')+'</div></div>';root.querySelector('.pm-list').onclick=function(e){var el=e.target.closest('[data-pick]');if(!el)return;pick(candidates[Number(el.dataset.pick)])}})}
    function onMessage(e){if(e.source!==window.parent||!/^chrome-extension:\/\/|^moz-extension:\/\//.test(e.origin))return;var m=e.data||{};if(m.source!=='mvmos-extension'||m.appId!==APP_ID)return;if(m.type==='context'){parentOrigin=e.origin;extensionSettings=m.settings||{};if(passkeyBusy)return;context=m.context||{};showAll=false;render();return}if(m.type==='vault-session'&&m.session&&(!m.session.expires||m.session.expires>Date.now()))importKey(m.session.key).then(function(v){key=v;scheduleAutoLock(m.session.expires);load()}).catch(function(){});if(m.type==='passkey-job'&&m.job&&pk()){passkeyBusy=true;try{context={hostname:new URL(m.job.origin).hostname.toLowerCase(),url:m.job.origin}}catch(_){}if(m.job.op==='create')runPasskeyCreate(m.job);else if(m.job.op==='get')runPasskeyGet(m.job);return}}
    window.addEventListener('message',onMessage);if(window.parent!==window)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'ready'},'*');load();return{destroy:function(){destroyed=true;clearTimeout(autoLockTimer);key=null;entries=[];window.removeEventListener('message',onMessage)}}
  }
  window.MvmPasswordManagerWidget={mount:mount};
})();
