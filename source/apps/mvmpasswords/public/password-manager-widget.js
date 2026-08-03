(function(){
  if(window.MvmPasswordManagerWidget)return;
  var API='/pub/mvmpasswords';
  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function b64(bytes){var s='';new Uint8Array(bytes).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(s){var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  function host(url){try{return new URL(url.indexOf('://')<0?'https://'+url:url).hostname.replace(/^www\./,'').toLowerCase()}catch(_){return ''}}
  // One login often lives at several addresses — a production database and its
  // copy on localhost, a service and its admin panel. They share the password,
  // so they are one entry with a list of addresses rather than duplicates that
  // then drift apart when the password is changed on only one of them.
  //
  // The list is stored in the same `website` string, one address per line, so
  // an entry written before this existed is simply a list of one and no vault
  // needs converting. Every read goes through here.
  function websites(item){return String((item&&item.website)||'').split('\n').map(function(v){return v.trim()}).filter(Boolean)}
  function sameHost(current,item){var a=String(current||'').replace(/^www\./,'');return websites(item).some(function(site){var b=host(site);return b&&(a===b||a.endsWith('.'+b))})}
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
  // Note for editors: this is one single-quoted string, so no comment or line
  // break may go inside it — put the reasoning here instead.
  //
  // Two rules in it exist because the popup is a fixed-height window that the
  // dialog can outgrow now that an entry holds an unbounded list of addresses:
  // .pm-dialog .pm-actions is sticky, so Save/Cancel/Delete stay reachable
  // instead of being pushed off the bottom, and .pm-web-list scrolls on its own
  // so the fields under it stay visible. .pm is position:relative because the
  // overlay is absolute and would otherwise anchor to an ancestor outside the
  // widget, which is what let the dialog overflow the popup in the first place.
  function style(){if(styled)return;styled=true;var s=document.createElement('style');s.textContent='.pm,.pm *,.pm-overlay,.pm-overlay *{box-sizing:border-box}.pm{height:100%;display:flex;flex-direction:column;position:relative;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}.pm-bar{display:flex;gap:.5rem;align-items:center;padding:.7rem .8rem;border-bottom:1px solid var(--pub-border,#45475a);flex-wrap:wrap}.pm-bar-head{width:100%;display:flex;align-items:center;gap:.5rem;min-width:0}.pm-bar-tools{width:100%;display:flex;align-items:center;gap:.4rem;min-width:0}.pm-title{font-weight:700;font-size:.9rem}.pm-search{flex:1;min-width:8rem}.pm-list{overflow:auto;flex:1;min-height:0;padding:.75rem}.pm-card{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.75rem;margin-bottom:.55rem}.pm-head{display:flex;gap:.6rem;align-items:center}.pm-avatar{width:2rem;height:2rem;border-radius:.5rem;display:grid;place-items:center;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:800}.pm-name{font-weight:700}.pm-sub{font-size:.76rem;color:var(--pub-dim,#a6adc8);margin-top:.1rem;overflow-wrap:anywhere}.pm-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.pm-card .pm-actions{gap:.35rem;flex-wrap:nowrap}.pm-icon-btn{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm-card .pm-actions .pm-icon-btn{flex:1 1 0;min-width:0}.pm-icon-btn.pm-danger:hover{border-color:var(--pub-red,#f38ba8)}.pm-icon-btn.pm-copied{border-color:var(--pub-green,#a6e3a1)}.pm-bar-tools .pm-search{flex:1 1 auto;min-width:0}.pm-bar-tools button{flex:0 0 auto;padding:.42rem 0;width:2.35rem;min-width:2.35rem;font-size:1rem;line-height:1.15;text-align:center}.pm button,.pm-btn,.pm-overlay button{border:0;border-radius:.45rem;padding:.48rem .75rem;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);transition:filter .15s,transform .15s}.pm button:hover,.pm-overlay button:hover{filter:brightness(1.12)}.pm button:active,.pm-overlay button:active{transform:translateY(1px)}.pm .primary,.pm-overlay .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}.pm input,.pm textarea,.pm select,.pm-overlay input,.pm-overlay textarea,.pm-overlay select{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.6rem .7rem;font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}.pm input:focus,.pm textarea:focus,.pm select:focus,.pm-overlay input:focus,.pm-overlay textarea:focus,.pm-overlay select:focus{border-color:var(--pub-accent,#89b4fa);box-shadow:0 0 0 3px color-mix(in srgb,var(--pub-accent,#89b4fa) 18%,transparent)}.pm-duration{margin:.3rem 0 .7rem}.pm-empty,.pm-unlock{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8)}.pm-unlock>div{width:100%;max-width:23rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}.pm-unlock h2{font-size:1.05rem;color:var(--pub-fg,#cdd6f4)}.pm-unlock p{font-size:.82rem;line-height:1.45}.pm-unlock input{margin:.35rem 0}.pm-error{min-height:1.3rem;color:var(--pub-red,#f38ba8);font-size:.8rem}.pm-overlay{position:absolute;inset:0;background:rgba(0,0,0,.64);z-index:5;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto;color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif}.pm-dialog{width:100%;max-width:27rem;max-height:100%;min-height:0;overflow:auto;flex:0 1 auto;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.75rem;padding:1.2rem;box-shadow:0 1.2rem 3rem rgba(0,0,0,.45)}.pm-dialog .pm-actions{position:sticky;bottom:calc(-1.2rem - 1px);margin:.8rem -1.2rem -1.2rem;padding:.8rem 1.2rem;background:var(--pub-bg,#1e1e2e);border-top:1px solid var(--pub-border,#45475a)}.pm-dialog h3{margin:0 0 .35rem;font-size:1.05rem;color:var(--pub-fg,#cdd6f4)}.pm-dialog label{display:block;font-size:.76rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.72rem 0 .28rem}.pm-dialog textarea{resize:vertical;min-height:5.25rem}.pm-context{font-size:.72rem;color:var(--pub-dim,#a6adc8);width:100%}.pm-match-badge{display:inline-flex;align-items:center;gap:.25rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-accent,#89b4fa) 20%,transparent);color:var(--pub-accent,#89b4fa);font-size:.65rem;vertical-align:middle}.pm-match-badge img{width:.78rem;height:.78rem;border-radius:.18rem}.pm-passkey-badge{display:inline-flex;align-items:center;gap:.2rem;margin-left:.4rem;padding:.12rem .36rem;border-radius:.6rem;background:color-mix(in srgb,var(--pub-green,#a6e3a1) 22%,transparent);color:var(--pub-green,#a6e3a1);font-size:.65rem;white-space:nowrap;vertical-align:middle}.pm-passkey-row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}.pm-passkey-info{flex:1;min-width:8rem;font-size:.8rem;overflow-wrap:anywhere}.pm-show-all{width:100%;margin:.15rem 0 .8rem}.pm-import-info{font-size:.8rem;opacity:.85;margin:.1rem 0 .7rem;line-height:1.45}.pm-import-drop{text-align:center;padding:.9rem;border:1px dashed var(--pub-border,#45475a);border-radius:.5rem;margin-bottom:.6rem}.pm-import-formats{font-size:.72rem;opacity:.7;margin-top:.45rem}.pm-import-status{font-size:.82rem;margin-bottom:.5rem}.pm-import-note{opacity:.8;font-size:.76rem;margin-top:.2rem}.pm-import-bulk{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}.pm-import-bulk button{padding:.3rem .55rem;font-size:.74rem}.pm-import-list{max-height:min(46vh,20rem);overflow:auto;margin-bottom:.5rem}.pm-import-row{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;padding:.35rem .2rem;border-bottom:1px solid var(--pub-border,#45475a);font-size:.8rem}.pm-import-row input{flex:0 0 auto;margin:0}.pm-import-name{flex:1;min-width:6rem;overflow-wrap:anywhere}.pm-import-sub{opacity:.7;font-size:.74rem;overflow-wrap:anywhere}.pm-import-dupe{flex:0 0 auto;white-space:nowrap;font-size:.68rem;padding:.1rem .4rem;border-radius:.6rem;background:var(--pub-border,#45475a);opacity:.9}.pm-menu{position:absolute;top:3.4rem;right:.8rem;z-index:6;display:flex;flex-direction:column;gap:.3rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.4rem;box-shadow:0 .6rem 1.6rem rgba(0,0,0,.35);min-width:9rem}.pm-menu[hidden]{display:none}.pm-menu button{text-align:left;width:100%}.pm-head-click{cursor:pointer}.pm-icon-spacer{visibility:hidden;pointer-events:none}.pm-list-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(14rem,1fr));gap:.55rem;align-content:start}.pm-list-grid .pm-card{margin-bottom:0}.pm-list-grid .pm-show-all{grid-column:1/-1}.pm-view-value{background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;padding:.6rem .7rem;font-size:.85rem;overflow-wrap:anywhere;min-height:1.3rem;color:var(--pub-fg,#cdd6f4)}.pm-view-notes{white-space:pre-wrap}.pm-dialog .pm-actions .pm-danger{background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);margin-left:auto}.pm-web-row{display:flex;gap:.4rem;align-items:center;margin-bottom:.35rem}.pm-web-row .f-web{flex:1;min-width:0}.pm-web-del{flex:0 0 auto;padding:.5rem .6rem;line-height:1}.pm-web-del:hover{border-color:var(--pub-red,#f38ba8);color:var(--pub-red,#f38ba8)}.pm-web-add{width:100%;margin-top:.1rem}.pm-web-list{max-height:11rem;overflow-y:auto}.pm-password-field{display:flex;gap:.45rem;align-items:center}.pm-password-field>:first-child{flex:1;min-width:0}.pm-password-field .f-toggle{flex:0 0 auto;padding:.55rem .65rem;font-size:1rem}.pm-view-value+.pm-view-value{margin-top:.3rem}';document.head.appendChild(s)}
  function mount(root,opts){
    opts=opts||{};style();var token=localStorage.getItem('apphub_token');if(!token){root.innerHTML='<div class="pm-empty">'+esc(t('pm_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var key=null,entries=[],context=null,extensionSettings={},showAll=false,parentOrigin='',destroyed=false,autoLockTimer=0,APP_ID='mvmpasswords',passkeyBusy=false,outsideClickHandler=null;
    // Whether this server offers the 2FA integration — one flag, answered by the
    // server and never decided here. It is on only when the administrator has
    // enabled it in the app's settings *and* the installation is licensed, and
    // those are both facts about the machine, not about whoever is looking at
    // the vault. A visitor cannot turn it on, and flipping this in a console
    // unlocks nothing: an unlicensed install was never sent the code that talks
    // to mvm2factor, so the routes simply answer that it is unavailable.
    // `totpAccounts` is the account list, fetched lazily when a picker opens.
    var totpOn=false,totpAccounts=null;
    function totpReady(){return totpOn}
    // The dialog overlay is absolutely positioned against this element, so its
    // height is the only thing standing between a dialog and the visible area.
    // A host that sizes the mount by content — an extension popup, an embed —
    // would otherwise let root grow past the window, and inset:0 would stretch
    // the overlay along with it, putting the action buttons below the fold with
    // no viewport left to scroll them back. Pinning it to the host's own height
    // here makes that impossible regardless of the page's stylesheet.
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
    // Both calls below reach mvm2factor through the Apps Hub app-to-app API, and
    // both are triggered by a click and nothing else. Fetching a code while the
    // list renders would add a cross-app round trip to every vault open and hand
    // out digits that expire within seconds of being drawn; the account list is
    // cheaper but just as pointless until a picker is actually on screen.
    async function totpFetchAccounts(){if(totpAccounts)return totpAccounts;
      var data=await api('/totp/accounts');totpAccounts=data.accounts||[];return totpAccounts}
    async function totpFetchCode(accountId){return api('/totp/code/'+encodeURIComponent(accountId))}
    async function loadEntries(){var data=await api('/vault');var out=[];for(var i=0;i<(data.entries||[]).length;i++)out.push(await decrypt(data.entries[i]));entries=out;return out}
    async function saveEntry(id,value){var encrypted=await encrypt(value);return id?api('/entries/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify(encrypted)}):api('/entries',{method:'POST',body:JSON.stringify(encrypted)})}
    function unlockScreen(vault,error){if(passkeyBusy)return;var creating=!vault,duration=localStorage.getItem('mvm_pm_unlock_duration')||'session';root.innerHTML='<div class="pm pm-unlock"><div><h2>'+esc(t(creating?'pm_create_title':'pm_unlock'))+'</h2><p>'+esc(t(creating?'pm_create_info':'pm_unlock_info'))+'</p><input class="pm-master" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_master'))+'">'+(creating?'<input class="pm-confirm" type="password" autocomplete="new-password" placeholder="'+esc(t('pm_confirm_master'))+'">':'')+'<label class="pm-duration-label">'+esc(t('pm_unlock_for'))+'</label><select class="pm-duration"><option value="5">'+esc(t('pm_minutes',{n:5}))+'</option><option value="15">'+esc(t('pm_minutes',{n:15}))+'</option><option value="60">'+esc(t('pm_hour'))+'</option><option value="session">'+esc(t('pm_until_closed'))+'</option></select><div class="pm-error">'+esc(error||'')+'</div><button class="primary pm-go">'+esc(t(creating?'pm_create':'pm_unlock'))+'</button></div></div>';var select=root.querySelector('.pm-duration');select.value=duration;var input=root.querySelector('.pm-master');root.querySelector('.pm-go').onclick=async function(){var pass=input.value;
      // The length rule guards the choice of a new master password, so it applies
      // only when creating a vault. Enforcing it on unlock would lock a user out
      // of a vault whose password predates the rule — the password is already
      // chosen by then, and a wrong one fails at decryption anyway.
      if(creating&&pass.length<MIN_MASTER){unlockScreen(vault,t('pm_password_short',{n:MIN_MASTER}));return}
      if(!creating&&!pass){unlockScreen(vault,t('pm_unlock_failed'));return}if(creating&&pass!==root.querySelector('.pm-confirm').value){unlockScreen(vault,t('pm_passwords_differ'));return}try{if(creating){var salt=b64(crypto.getRandomValues(new Uint8Array(32)));await api('/vault',{method:'POST',body:JSON.stringify({salt:salt,iterations:600000})});vault={salt:salt,iterations:600000}}key=await derive(pass,vault.salt,vault.iterations);await cacheKey(select.value);await load(creating);}catch(_){key=null;unlockScreen(vault,t('pm_unlock_failed'))}};setTimeout(function(){input.focus()},30)}
    // An entry matches when any one of its addresses matches: the rule is the
    // same for all of them, but each is tested on its own, so a single bad
    // regex line cannot silently disqualify the addresses beside it.
    function matchesEntry(ctx,item){if(!ctx||!ctx.hostname)return true;var mode=item.match_mode&&item.match_mode!=='default'?item.match_mode:(extensionSettings.matching_mode||'domain');
      if(mode==='exact')return websites(item).some(function(site){return normalUrl(ctx.url)===normalUrl(site)});
      if(mode==='regex')return websites(item).some(function(site){try{return new RegExp(site,'i').test(ctx.url||'')}catch(_){return false}});
      return sameHost(ctx.hostname,item)}
    // A search is a search of the whole vault. Narrowing to the current site is
    // a convenience for the untyped state only: the moment something is typed,
    // the site filter is dropped, otherwise an entry that exists but does not
    // match the open page is unfindable — you get "1 match" and no way to reach
    // the second one you know is there.
    function visible(){var q=((root.querySelector('.pm-search')||{}).value||'').trim().toLowerCase();
      if(q)return entries.filter(function(x){return JSON.stringify(x).toLowerCase().indexOf(q)>=0});
      return entries.filter(function(x){return showAll||matchesEntry(context,x)})}
    // The bar (with the search input) is built once per unlock and never
    // replaced afterwards. Rebuilding it on every keystroke — the old
    // behaviour — destroyed and recreated the <input>, which is what threw
    // focus and the cursor position away after the very first character.
    function renderShell(){if(!key||passkeyBusy)return;root.innerHTML='<div class="pm"><div class="pm-bar"><div class="pm-bar-head"><span class="pm-title">🛡️ '+esc(t('pm_title'))+'</span></div><div class="pm-bar-tools"><input class="pm-search" placeholder="'+esc(t('pm_search'))+'"><button class="pm-menu-btn" title="'+esc(t('pm_menu'))+'" aria-label="'+esc(t('pm_menu'))+'">☰</button></div><span class="pm-context"></span></div><div class="pm-menu" hidden><button class="pm-add">'+esc(t('pm_add'))+'</button>'+(parentOrigin?'':'<button class="pm-import">'+esc(t('pm_import_title'))+'</button>')+'<button class="pm-lock">'+esc(t('pm_lock'))+'</button></div><div class="pm-list"></div></div>';
      var search=root.querySelector('.pm-search');search.oninput=renderList;
      var menuBtn=root.querySelector('.pm-menu-btn'),menu=root.querySelector('.pm-menu');
      menuBtn.onclick=function(e){e.stopPropagation();menu.hidden=!menu.hidden};
      // renderShell() replaces the whole subtree on every unlock, so the previous
      // outside-click listener (closing over now-detached elements) is removed
      // first — otherwise each unlock/lock cycle would leak one more of these.
      if(outsideClickHandler)document.removeEventListener('click',outsideClickHandler);
      outsideClickHandler=function(e){if(!menu.hidden&&!menu.contains(e.target)&&e.target!==menuBtn)menu.hidden=true};
      document.addEventListener('click',outsideClickHandler);
      root.querySelector('.pm-add').onclick=function(){menu.hidden=true;dialog()};
      var importButton=root.querySelector('.pm-import');if(importButton)importButton.onclick=function(){menu.hidden=true;importDialog()};
      root.querySelector('.pm-lock').onclick=function(){menu.hidden=true;lockNow()};
      renderList();
    }
    function renderList(){if(!key||passkeyBusy)return;var list=visible(),hasContext=context&&context.hostname,matchCount=hasContext?entries.filter(function(x){return matchesEntry(context,x)}).length:0;if(parentOrigin&&hasContext)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'password-match-count',count:matchCount},parentOrigin);
      // While a search is active the site filter is off (see visible()), so the
      // context line and the "show all" button must not claim otherwise.
      var searching=!!((root.querySelector('.pm-search')||{}).value||'').trim();
      var ctx=root.querySelector('.pm-context');if(ctx)ctx.textContent=hasContext&&!showAll&&!searching?t('pm_matching',{host:context.hostname}):t('pm_all');
      // No pagination: the grid is just as many auto-sized columns as the
      // width allows (CSS, not JS), and the list keeps growing downward with
      // a scrollbar — a phone-width container falls back to one column,
      // which is the same single stacked list it always was.
      var el=root.querySelector('.pm-list');
      el.className='pm-list pm-list-grid';
      el.innerHTML=(list.length?list.map(card).join(''):'<div class="pm-empty">'+esc(t('pm_empty'))+'</div>')+(hasContext&&!showAll&&!searching?'<button class="pm-show-all">'+esc(t('pm_show_all'))+'</button>':'');
      var all=el.querySelector('.pm-show-all');if(all)all.onclick=function(){showAll=true;renderList()};
      el.onclick=onClick;
    }
    // load() re-fetches after every save/delete/import while the shell is
    // already on screen; re-running renderShell() there would blow away the
    // search input (and any text mid-typed into it) for no reason, so it only
    // (re)builds the shell the first time, then always refreshes just the list.
    function render(){root.querySelector('.pm-bar')?renderList():renderShell()}
    function card(x){var matched=context&&context.hostname&&matchesEntry(context,x),badge=matched?'<span class="pm-match-badge"><img src="/apps/mvmpasswords/extension-icon.png" alt="">'+esc(t('pm_match'))+'</span>':'',keyBadge=x.passkey?'<span class="pm-passkey-badge">🔑 '+esc(t('pm_passkey_field'))+'</span>':'';// Icon-only buttons keep one card's actions on a single row on a phone, but an
    // icon alone names nothing — so each carries its label as both title and
    // aria-label, which is also what a screen reader reads out.
    function action(attr,id,label,icon,extra){return'<button '+attr+'="'+esc(id)+'" class="pm-icon-btn'+(extra?' '+extra:'')+'" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+icon+'</button>'}
    // Delete moved into the edit dialog to free up a slot here; a card with no
    // website still needs that slot to hold its layout, so the open-link
    // button only renders when there is somewhere to send the click.
    var openBtn=websites(x).length?action('data-open',x.id,t('pm_open_url'),'↗️'):'<span class="pm-icon-btn pm-icon-spacer"></span>';
    return'<div class="pm-card" data-id="'+esc(x.id)+'"><div class="pm-head pm-head-click" data-view="'+esc(x.id)+'"><div class="pm-avatar">'+esc((x.name||'?')[0].toUpperCase())+'</div><div><div class="pm-name">'+esc(x.name)+badge+keyBadge+'</div><div class="pm-sub">'+esc(host(websites(x)[0]||'')||x.username)+'</div></div></div><div class="pm-actions">'+(parentOrigin?action('data-fill',x.id,t('pm_fill'),'✒️','primary'):'')+action('data-cu',x.id,t('pm_copy_username'),'👤')+action('data-cp',x.id,t('pm_copy_password'),'🔑')+(totpReady()&&x.totp_id?action('data-ct',x.id,t('pm_copy_totp'),'🔢'):'')+action('data-edit',x.id,t('pm_edit'),'✏️')+openBtn+'</div></div>'}
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
        // An import file gives one address per row, but an entry already in the
        // vault may cover several — so the row is a duplicate if that account
        // already lists this site anywhere, not only as its first address.
        var site=host(candidate.website),user=(candidate.username||'').toLowerCase();
        return entries.some(function(existing){
          return (existing.username||'').toLowerCase()===user&&(site||user)&&
            (site?websites(existing).some(function(v){return host(v)===site}):!websites(existing).length);
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
        await load(true);
      };
    }
    // Failure here is routine, not exceptional: the App API can be switched off,
    // mvm2factor can be uninstalled, the linked account can be deleted. None of
    // that is the vault's problem, so the button reports it on itself and the
    // rest of the entry keeps working exactly as before.
    async function totpCopy(el,accountId){
      var label=el.textContent;el.textContent='⏳';
      try{var data=await totpFetchCode(accountId);
        // Not swallowed: a refused clipboard write is the one failure the user
        // would otherwise discover by pasting nothing into a login form.
        await navigator.clipboard.writeText(data.code);
        el.classList.add('pm-copied');el.textContent='✅'}
      catch(_){el.textContent='⚠️';el.title=t('pm_totp_unavailable')}
      setTimeout(function(){el.textContent=label;render()},1200);
    }
    async function onClick(e){
      var head=e.target.closest('[data-view]');
      if(head&&!e.target.closest('button')){viewDialog(find(head.dataset.view));return}
      var el=e.target.closest('button');if(!el)return;
      var id=el.dataset.fill||el.dataset.cu||el.dataset.cp||el.dataset.ct||el.dataset.edit||el.dataset.open,item=find(id);if(!item)return;
      if(el.dataset.fill){
        // Filling a login that has 2FA leaves the user one field short, and the
        // code is the one thing autofill cannot type for them — the field is on
        // the next screen. So the code lands in the clipboard instead, ready to
        // paste. Fetched on the click and not earlier: it is valid for seconds.
        //
        // Order matters and is the whole reason this is not one line. Autofill
        // focuses the password field in the tab, which takes focus away from the
        // popup and lets the browser close it — and a clipboard write is refused
        // from a document that is not focused. So the code is fetched and copied
        // while this document still has focus, and the fill is sent only once
        // that is done. Sending the fill first silently copies nothing, which is
        // exactly how this read as "the button works but fill does not".
        var doFill=function(){window.parent.postMessage({source:'mvmos-public-app',appId:'mvmpasswords',action:'autofill-login',credentials:{username:item.username||'',password:item.password||''}},parentOrigin)};
        if(totpReady()&&item.totp_id)totpCopy(el,item.totp_id).then(doFill,doFill);
        else doFill()}
      else if(el.dataset.ct){await totpCopy(el,item.totp_id)}
      else if(el.dataset.cu||el.dataset.cp){await navigator.clipboard.writeText(el.dataset.cu?item.username:item.password).catch(function(){});
      // The button no longer has a text label to replace, so confirmation is a
      // brief checkmark on the icon itself; without it a tap gives no feedback.
      el.classList.add('pm-copied');el.textContent='✅';setTimeout(function(){render()},900)}
      else if(el.dataset.edit)dialog(item);
      // The first address is the entry's own; the rest are there so the popup
      // recognises the other places the same login is used, and opening one of
      // those instead would be a surprise.
      else if(el.dataset.open){var target=websites(item)[0]||'';if(target)window.open(target.indexOf('://')<0?'https://'+target:target,'_blank','noopener')}
    }
    // Quick view mirrors the edit dialog's visual shape but shows read-only
    // text instead of inputs, except the password keeps its show/hide toggle —
    // the one field where "read-only" still needs an explicit action to reveal.
    function viewDialog(item){if(!item)return;var overlay=document.createElement('div');overlay.className='pm-overlay';
      var passkeyBlock=item.passkey?'<label>'+esc(t('pm_passkey_field'))+'</label><div class="pm-view-value">🔑 '+esc(item.passkey.userDisplayName||item.passkey.userName||item.passkey.rpId||'')+'</div>':'';
      overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(item.name||'')+'</h3>'+
        '<label>'+esc(t('pm_website'))+'</label>'+(websites(item).length?websites(item).map(function(site){return'<div class="pm-view-value">'+esc(site)+'</div>'}).join(''):'<div class="pm-view-value">—</div>')+
        '<label>'+esc(t('pm_username'))+'</label><div class="pm-view-value">'+esc(item.username||'—')+'</div>'+
        '<label>'+esc(t('pm_password'))+'</label><div class="pm-password-field"><div class="pm-view-value f-pass-view">••••••••</div><button type="button" class="f-toggle" title="'+esc(t('pm_show_password'))+'">👁</button></div>'+
        (totpReady()&&item.totp_id?'<label>'+esc(t('pm_totp_field'))+'</label><div class="pm-password-field"><div class="pm-view-value f-totp-view">••••••</div><button type="button" class="f-totp-copy" title="'+esc(t('pm_copy_totp'))+'">🔢</button></div>':'')+
        (item.notes?'<label>'+esc(t('pm_notes'))+'</label><div class="pm-view-value pm-view-notes">'+esc(item.notes)+'</div>':'')+
        passkeyBlock+
        '<div class="pm-actions"><button class="primary f-edit">'+esc(t('pm_edit'))+'</button><button class="f-close">'+esc(t('pm_cancel'))+'</button></div></div>';
      root.appendChild(overlay);
      var passView=overlay.querySelector('.f-pass-view'),toggle=overlay.querySelector('.f-toggle'),shown=false;
      toggle.onclick=function(){shown=!shown;passView.textContent=shown?(item.password||''):'••••••••';toggle.textContent=shown?'🙈':'👁';toggle.title=t(shown?'pm_hide_password':'pm_show_password')};
      // The code is shown as well as copied here, because this dialog is where
      // someone looks at an entry rather than acting on it — and it is fetched
      // on this click alone, like everywhere else.
      var totpCopyBtn=overlay.querySelector('.f-totp-copy');
      if(totpCopyBtn)totpCopyBtn.onclick=async function(){
        var view=overlay.querySelector('.f-totp-view');totpCopyBtn.textContent='⏳';
        try{var data=await totpFetchCode(item.totp_id);
          view.textContent=data.code;
          await navigator.clipboard.writeText(data.code).catch(function(){});
          totpCopyBtn.textContent='✅'}
        catch(_){view.textContent=t('pm_totp_unavailable');totpCopyBtn.textContent='⚠️'}
        setTimeout(function(){totpCopyBtn.textContent='🔢'},1200)};
      overlay.querySelector('.f-close').onclick=function(){overlay.remove()};
      overlay.querySelector('.f-edit').onclick=function(){overlay.remove();dialog(item)};
    }
    function dialog(item){item=item||{};var overlay=document.createElement('div');overlay.className='pm-overlay';overlay.innerHTML='<div class="pm-dialog"><h3>'+esc(t(item.id?'pm_edit_entry':'pm_new_entry'))+'</h3><label>'+esc(t('pm_name'))+'</label><input class="f-name" value="'+esc(item.name)+'"><label>'+esc(t('pm_website'))+'</label><div class="pm-web-list"></div><button type="button" class="pm-web-add">+ '+esc(t('pm_add_website'))+'</button><label>'+esc(t('pm_match_mode'))+'</label><select class="f-match"><option value="default">'+esc(t('pm_match_default'))+'</option><option value="domain">'+esc(t('pm_match_domain'))+'</option><option value="exact">'+esc(t('pm_match_exact'))+'</option><option value="regex">'+esc(t('pm_match_regex'))+'</option></select><label>'+esc(t('pm_username'))+'</label><input class="f-user" value="'+esc(item.username)+'"><label>'+esc(t('pm_password'))+'</label><div class="pm-password-field"><input class="f-pass" type="password" value="'+esc(item.password)+'"><button type="button" class="f-toggle" title="'+esc(t('pm_show_password'))+'">👁</button></div>'+(totpReady()?'<label>'+esc(t('pm_totp_field'))+'</label><select class="f-totp"><option value="">'+esc(t('pm_totp_none'))+'</option></select>':'')+'<label>'+esc(t('pm_notes'))+'</label><textarea class="f-notes">'+esc(item.notes)+'</textarea>'+(item.passkey?'<div class="pm-passkey-block"><label>'+esc(t('pm_passkey_field'))+'</label><div class="pm-passkey-row"><span class="pm-passkey-info">🔑 '+esc(item.passkey.userDisplayName||item.passkey.userName||item.passkey.rpId||'')+'</span><button type="button" class="f-passkey-del">'+esc(t('pm_passkey_remove'))+'</button></div></div>':'')+'<div class="pm-error"></div><div class="pm-actions"><button class="primary f-save">'+esc(t('pm_save'))+'</button><button class="f-cancel">'+esc(t('pm_cancel'))+'</button>'+(item.id?'<button class="pm-danger f-delete">'+esc(t('pm_delete'))+'</button>':'')+'</div></div>';root.appendChild(overlay);var pass=overlay.querySelector('.f-pass'),toggle=overlay.querySelector('.f-toggle'),match=overlay.querySelector('.f-match');match.value=item.match_mode||'default';
      // The address rows are built here rather than in the markup above because
      // there is no fixed number of them. A row can always be removed, including
      // the last one — an entry with no address at all is legitimate (a database
      // login, a wifi password), it simply never matches an open page.
      var webList=overlay.querySelector('.pm-web-list');
      function addWebRow(value){var row=document.createElement('div');row.className='pm-web-row';
        row.innerHTML='<input class="f-web" value="'+esc(value||'')+'" placeholder="'+esc(t('pm_website_placeholder'))+'"><button type="button" class="pm-web-del" title="'+esc(t('pm_remove_website'))+'" aria-label="'+esc(t('pm_remove_website'))+'">✕</button>';
        row.querySelector('.pm-web-del').onclick=function(){row.remove()};
        webList.appendChild(row);return row}
      // A brand-new entry still opens with one empty row, so the common case —
      // one address, typed straight in — needs no extra click.
      var existingSites=websites(item);if(!existingSites.length)existingSites=[''];existingSites.forEach(addWebRow);
      // Filled in after the dialog is already visible, never before it: this is
      // a hop into another app and making the editor wait for it would make
      // every edit feel slower for the sake of one optional field. Until the
      // list arrives the select holds the current value and nothing else, so a
      // save that happens first keeps the existing link rather than clearing it.
      var totpSelect=overlay.querySelector('.f-totp');
      if(totpSelect){
        if(item.totp_id)totpSelect.insertAdjacentHTML('beforeend','<option value="'+esc(item.totp_id)+'" selected>'+esc(t('pm_totp_loading'))+'</option>');
        totpFetchAccounts().then(function(list){
          if(!totpSelect.isConnected)return;
          var current=totpSelect.value;
          totpSelect.innerHTML='<option value="">'+esc(t('pm_totp_none'))+'</option>'+list.map(function(a){
            var label=a.issuer&&a.issuer!==a.name?a.issuer+' — '+a.name:a.name;
            return '<option value="'+esc(a.id)+'">'+esc(label)+'</option>'}).join('');
          // The linked account may have been deleted in mvm2factor since. Saying
          // so beats silently unlinking an entry the user never touched.
          if(current&&!list.some(function(a){return a.id===current}))
            totpSelect.insertAdjacentHTML('beforeend','<option value="'+esc(current)+'">'+esc(t('pm_totp_missing'))+'</option>');
          totpSelect.value=current;
        }).catch(function(){
          if(totpSelect.isConnected)totpSelect.insertAdjacentHTML('beforeend','<option value="" disabled>'+esc(t('pm_totp_unavailable'))+'</option>');
        });
      }
      overlay.querySelector('.pm-web-add').onclick=function(){addWebRow('').querySelector('.f-web').focus()};var keepPasskey=item.passkey||null,passkeyDel=overlay.querySelector('.f-passkey-del');if(passkeyDel)passkeyDel.onclick=function(){keepPasskey=null;overlay.querySelector('.pm-passkey-block').remove()};toggle.onclick=function(){var showing=pass.type==='text';pass.type=showing?'password':'text';toggle.textContent=showing?'👁':'🙈';toggle.title=t(showing?'pm_show_password':'pm_hide_password')};overlay.querySelector('.f-cancel').onclick=function(){overlay.remove()};var delBtn=overlay.querySelector('.f-delete');if(delBtn)delBtn.onclick=async function(){if(!confirm(t('pm_delete_confirm',{name:item.name})))return;try{await api('/entries/'+encodeURIComponent(item.id),{method:'DELETE'});overlay.remove();await load(true)}catch(_){overlay.querySelector('.pm-error').textContent=t('pm_error')}};overlay.querySelector('.f-save').onclick=async function(){var value={name:overlay.querySelector('.f-name').value.trim(),website:Array.prototype.map.call(overlay.querySelectorAll('.f-web'),function(el){return el.value.trim()}).filter(Boolean).join('\n'),match_mode:match.value,username:overlay.querySelector('.f-user').value.trim(),password:pass.value,notes:overlay.querySelector('.f-notes').value};if(keepPasskey)value.passkey=keepPasskey;
        // Kept inside the encrypted blob like every other field, so the server
        // never learns which entry has 2FA. When the picker is absent — no
        // subscription, or the integration switched off — the existing link is
        // carried over untouched rather than dropped: turning the feature off
        // must not quietly destroy what turning it back on would restore.
        if(totpSelect){if(totpSelect.value)value.totp_id=totpSelect.value}else if(item.totp_id)value.totp_id=item.totp_id;if(!value.name||(!value.password&&!value.passkey)){overlay.querySelector('.pm-error').textContent=t('pm_required');return}try{var out=await saveEntry(item.id,value);if(!item.id)value.id=out.id;overlay.remove();await load(true)}catch(_){overlay.querySelector('.pm-error').textContent=t('pm_error')}};setTimeout(function(){overlay.querySelector('.f-name').focus()},20)}
    // In the extension the key arrives from the parent only after a full
    // iframe->ready->vault-session round trip, and load() used to start its
    // /vault request from scratch afterwards — so the request queued behind the
    // handshake instead of running alongside it, and the popup sat blank for it.
    // The fetch is fired once at mount and both callers await the same promise.
    var vaultPromise=null;
    function fetchVault(force){if(force||!vaultPromise)vaultPromise=api('/vault').catch(function(e){vaultPromise=null;throw e});return vaultPromise}
    async function load(force){try{var payload=await fetchVault(force);if(!payload.vault){unlockScreen(null);return}
      // Carried by the vault response, so every surface — desktop window, public
      // page, extension — learns it at the same moment it learns everything else
      // and none of them pays for an extra round trip to find out.
      totpOn=!!payload.totp;if(!key&&!parentOrigin)await restoreLocalKey();if(!key){unlockScreen(payload.vault);return}
      // Every record is independent, so they decrypt concurrently. Sequential
      // awaits made this O(n) round trips through the crypto engine.
      entries=await Promise.all((payload.entries||[]).map(decrypt));render()}catch(_){if(key)unlockScreen(null,t('pm_unlock_failed'));else root.innerHTML='<div class="pm-empty">'+esc(t('pm_error'))+'</div>'}}
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
    // Fire the vault request before announcing readiness, so it travels while
    // the extension is still deciding to send the key back instead of starting
    // only once it has: in the popup that round trip was the whole visible wait.
    fetchVault().catch(function(){});
    window.addEventListener('message',onMessage);if(window.parent!==window)window.parent.postMessage({source:'mvmos-public-app',appId:APP_ID,action:'ready'},'*');load();return{destroy:function(){destroyed=true;clearTimeout(autoLockTimer);key=null;entries=[];window.removeEventListener('message',onMessage);if(outsideClickHandler)document.removeEventListener('click',outsideClickHandler)}}
  }
  window.MvmPasswordManagerWidget={mount:mount};
})();
