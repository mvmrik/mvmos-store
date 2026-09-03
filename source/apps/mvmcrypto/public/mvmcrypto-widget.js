(function(){
  if(window.MvmCryptoWidget)return;
  var API='/pub/mvmcrypto';
  var ITERATIONS=600000;
  var MIN_MASTER=10;
  var MIN_ENTRY_PW=8;

  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function b64(bytesArr){var s='';new Uint8Array(bytesArr).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(s){var bin=atob(s),out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out}
  function concatBytes(a,b){var out=new Uint8Array(a.length+b.length);out.set(a,0);out.set(b,a.length);return out}
  function fmtBtc(n){if(n==null)return t('mc_balance_unknown');return (Math.round(n*1e8)/1e8).toFixed(8).replace(/0+$/,'').replace(/\.$/,'.0')}
  // Generic version of fmtBtc for any network's amount — display never
  // needs more than 8 decimal places even for an 18-decimal ETH/BNB/MATIC
  // value, so this always rounds to at most 8 regardless of the asset's
  // own on-chain decimals.
  function fmtAmount(n){if(n==null)return t('mc_balance_unknown');return (Math.round(n*1e8)/1e8).toFixed(8).replace(/0+$/,'').replace(/\.$/,'.0')}
  function fmtUsd(n){if(n==null)return t('mc_price_unavailable');try{return n.toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2})}catch(_){return '$'+n.toFixed(2)}}
  // hour12 explicitly false, same as budget-widget.js's timestamp formatter —
  // plain toLocaleString() defaults to whatever the browser's own locale
  // picks, which for many (e.g. en-US) means AM/PM regardless of the
  // system's actual regional 24h/12h setting.
  function fmtTime(sec){
    if(!sec)return '';
    try{
      var d=new Date(sec*1000);
      return d.toLocaleDateString(undefined,{day:'2-digit',month:'2-digit',year:'2-digit'})
        +' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false});
    }catch(_){return ''}
  }

  // ---- crypto primitives -----------------------------------------------
  // Same PBKDF2(SHA-256) -> AES-256-GCM primitives as mvmpasswords. The vault
  // envelope adds one more derivation on top: an entry's key is derived not
  // from a password string but from 64 fixed bytes — the raw dataKey
  // followed by SHA-256(entryPassword) — so combining a 32-byte key and a
  // variable-length password can never be ambiguous the way naive string
  // concatenation would be.
  async function sha256(strOrBytes){
    var data=typeof strOrBytes==='string'?new TextEncoder().encode(strOrBytes):strOrBytes;
    return new Uint8Array(await crypto.subtle.digest('SHA-256',data));
  }
  async function deriveVaultKey(password,saltB64,iterations){
    var raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(saltB64),iterations:iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  }
  async function deriveEntryKey(dataKeyBytes,entryPassword,saltB64,iterations){
    var pwHash=await sha256(entryPassword);
    var combined=concatBytes(dataKeyBytes,pwHash);
    var raw=await crypto.subtle.importKey('raw',combined,'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(saltB64),iterations:iterations,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  }
  async function importRawAesKey(rawB64){return crypto.subtle.importKey('raw',bytes(rawB64),{name:'AES-GCM'},true,['encrypt','decrypt'])}
  async function encryptJSON(key,value){
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var data=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(value)));
    return{iv:b64(iv),ciphertext:b64(data)};
  }
  async function decryptJSON(key,ivB64,ctB64){
    var out=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(ivB64)},key,bytes(ctB64));
    return JSON.parse(new TextDecoder().decode(out));
  }

  var styled=false;
  function style(){
    if(styled)return;styled=true;
    var s=document.createElement('style');
    s.textContent='.mc,.mc *,.mc-overlay,.mc-overlay *{box-sizing:border-box}'
      +'.mc{height:100%;display:flex;flex-direction:column;position:relative;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}'
      +'.mc-tabs{display:flex;border-bottom:1px solid var(--pub-border,#45475a)}'
      +'.mc-tab{flex:1;text-align:center;padding:.7rem;cursor:pointer;font-weight:700;font-size:.85rem;color:var(--pub-fg2,#a6adc8);border-bottom:2px solid transparent}'
      +'.mc-tab.active{color:var(--pub-accent,#89b4fa);border-color:var(--pub-accent,#89b4fa)}'
      +'.mc-bar{display:flex;align-items:center;justify-content:space-between;padding:.5rem .8rem;gap:.4rem}'
      +'.mc-bar-title{font-weight:700;font-size:.85rem;opacity:.85}'
      +'.mc-bar-icons{display:flex;gap:.3rem}'
      +'.mc-icon-btn{flex:0 0 auto;width:2.1rem;height:2.1rem;padding:0;font-size:1rem;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:.45rem;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);cursor:pointer}'
      +'.mc-icon-btn:hover{filter:brightness(1.15)}'
      +'.mc-body{flex:1;min-height:0;overflow:auto;padding:.8rem}'
      +'.mc-empty{display:flex;flex:1;align-items:center;justify-content:center;text-align:center;padding:1.5rem;color:var(--pub-fg2,#a6adc8)}'
      +'.mc-center{display:flex;flex:1;align-items:center;justify-content:center;padding:1rem}'
      +'.mc-center>div{width:100%;max-width:24rem;background:var(--pub-surface2,#313244);padding:1.2rem;border-radius:.7rem}'
      +'.mc-center h2{font-size:1.05rem;margin:0 0 .4rem}'
      +'.mc-center p{font-size:.82rem;line-height:1.5;color:var(--pub-fg2,#a6adc8)}'
      +'.mc input,.mc textarea,.mc select,.mc-overlay input,.mc-overlay textarea,.mc-overlay select{width:100%;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;color:var(--pub-fg,#cdd6f4);padding:.55rem .65rem;font:inherit;outline:none;margin:.25rem 0 .55rem}'
      +'.mc input:focus,.mc textarea:focus,.mc select:focus,.mc-overlay input:focus,.mc-overlay textarea:focus,.mc-overlay select:focus{border-color:var(--pub-accent,#89b4fa)}'
      +'.mc textarea,.mc-overlay textarea{min-height:4.5rem;resize:vertical;font-family:ui-monospace,monospace}'
      +'.mc label{display:block;font-size:.74rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.5rem 0 .1rem}'
      +'.mc button,.mc-overlay button{border:0;border-radius:.45rem;padding:.5rem .8rem;cursor:pointer;font:inherit;font-size:.8rem;font-weight:600;background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}'
      +'.mc button:hover,.mc-overlay button:hover{filter:brightness(1.12)}'
      +'.mc .primary,.mc-overlay .primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}'
      +'.mc .mc-danger,.mc-overlay .mc-danger{background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e)}'
      +'.mc-error{min-height:1.2rem;color:var(--pub-red,#f38ba8);font-size:.78rem;margin:.2rem 0}'
      +'.mc-hint{font-size:.72rem;color:var(--pub-fg2,#a6adc8);line-height:1.4;margin:.1rem 0 .5rem}'
      +'.mc-intro{border:1px solid var(--pub-accent,#89b4fa);border-radius:.6rem;padding:.7rem .8rem;margin-bottom:.8rem;font-size:.8rem;line-height:1.5}'
      +'.mc-intro h3{margin:0 0 .3rem;font-size:.88rem}'
      +'.mc-intro button{margin-top:.5rem}'
      +'.mc-card{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#313244);border-radius:.6rem;padding:.65rem .75rem;margin-bottom:.5rem}'
      +'.mc-card-head{display:flex;align-items:center;justify-content:space-between;gap:.5rem}'
      +'.mc-card-title{font-weight:700;font-size:.85rem;display:flex;align-items:center;gap:.35rem;overflow-wrap:anywhere}'
      +'.mc-card-sub{font-size:.74rem;color:var(--pub-fg2,#a6adc8);margin-top:.15rem}'
      +'.mc-card-actions{display:flex;gap:.3rem;margin-top:.5rem;flex-wrap:wrap}'
      +'.mc-card-actions button{flex:0 0 auto;padding:.35rem .6rem;font-size:.74rem}'
      +'.mc-add-btn-row{width:100%;margin-bottom:.7rem}'
      +'.mc-overlay{position:absolute;inset:0;background:rgba(0,0,0,.64);z-index:5;display:flex;align-items:center;justify-content:center;padding:1rem;overflow:auto;color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif}'
      +'.mc-dialog{width:100%;max-width:26rem;max-height:100%;overflow:auto;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:.75rem;padding:1.1rem;box-shadow:0 1.2rem 3rem rgba(0,0,0,.45)}'
      +'.mc-dialog h3{margin:0 0 .3rem;font-size:1rem}'
      +'.mc-dialog p{font-size:.8rem;line-height:1.45;color:var(--pub-fg2,#a6adc8);margin:.2rem 0 .5rem}'
      +'.mc-actions{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.7rem}'
      +'.mc-actions .mc-danger{margin-left:auto}'
      +'.mc-toggle-label{display:flex!important;align-items:center;gap:.4rem;font-weight:400!important;cursor:pointer;margin:.6rem 0!important}'
      +'.mc-toggle-label input{width:auto!important;flex:0 0 auto;margin:0!important}'
      +'.mc-reveal-value{background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;padding:.7rem;font-family:ui-monospace,monospace;font-size:.9rem;line-height:1.6;overflow-wrap:anywhere;user-select:none;filter:blur(5px)}'
      +'.mc-reveal-value.mc-shown{filter:none;user-select:text}'
      +'.mc-reveal-warning{font-size:.76rem;color:var(--pub-red,#f38ba8);margin:.5rem 0;line-height:1.4}'
      +'.mc-lock{opacity:.6;font-size:.9rem;margin-right:.15rem}'
      +'.mc-totals{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap;padding:.6rem .7rem;border:1px solid var(--pub-border,#45475a);border-radius:.6rem;margin-bottom:.7rem;font-size:.82rem}'
      +'.mc-totals b{font-size:.95rem}'
      +'.mc-totals .mc-refresh-btn{margin-left:auto}'
      +'.mc-toast{position:absolute;left:50%;bottom:1rem;transform:translateX(-50%);background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;padding:.5rem .9rem;font-size:.8rem;z-index:9;box-shadow:0 .4rem 1.2rem rgba(0,0,0,.35)}';
    document.head.appendChild(s);
  }

  function mount(root,opts){
    opts=opts||{};
    style();
    var token=localStorage.getItem('apphub_token');
    if(!token){root.innerHTML='<div class="mc-empty">'+esc(t('mc_login'))+'</div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}

    var SESSION_KEY='mvm_mc_vault_session',DATAKEY_SESSION_KEY='mvm_mc_datakey_session',
        DURATION_KEY='mvm_mc_unlock_duration',CONVENIENCE_KEY='mvm_mc_reveal_convenience',
        INTRO_KEY='mvm_mc_intro_dismissed';

    var state={
      tab:'vault',
      vaultStatus:null,   // {exists,salt,iterations,wrap_iv,wrap_ciphertext} | {exists:false}
      vaultKey:null,      // CryptoKey, cached across a session per DURATION_KEY
      dataKey:null,       // Uint8Array(32), in-memory only unless convenience is on
      entries:[],         // decrypted meta list
      pendingShares:[],   // incoming transfers awaiting accept (id,created_at,source_owner)
      portfolio:null,
      // query: text currently in the search box. result: {type:'address',...}
      // or {type:'tx',...} from the API. fromAddress: the address a tx
      // drill-down was opened from, for the "back to address" button.
      explorer:{query:'',result:null,loading:false,error:'',fromAddress:null},
      convenience:localStorage.getItem(CONVENIENCE_KEY)==='1',
      autoLockTimer:0,
      destroyed:false
    };
    root.style.position='relative';
    root.innerHTML='<div class="mc"></div>';
    var shell=root.querySelector('.mc');

    function api(path,options){
      options=options||{};
      var headers=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});
      return fetch(API+path,Object.assign({},options,{headers:headers})).then(async function(r){
        var d=await r.json().catch(function(){return{}});
        if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();
        if(!r.ok){var e=new Error(d.error||'error');e.code=d.error;throw e}
        return d;
      });
    }
    // Apps Hub's favourites list — the same "add someone you already trust"
    // pool every app on this platform shares (see budget-widget.js's
    // identical favApi). Picking a share recipient is done from this list,
    // never a free-text lookup.
    function favApi(path,options){
      options=options||{};
      var headers=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});
      return fetch('/api/pub/apphub'+path,Object.assign({},options,{headers:headers})).then(async function(r){
        var d=await r.json().catch(function(){return{}});
        if(!r.ok){var e=new Error(d.error||'error');e.code=d.error;throw e}
        return d;
      });
    }

    function toast(msg){
      var el=document.createElement('div');
      el.className='mc-toast';el.textContent=msg;
      shell.appendChild(el);
      setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el)},2600);
    }

    // ---- session cache (vaultKey only by default; see cacheDataKey for the
    // opt-in convenience path) ------------------------------------------
    function minutesOf(value){return value==='session'?0:Number(value)||0}
    function expiry(minutes){return minutes?Date.now()+minutes*60000:0}
    function storeFor(minutes){return minutes?localStorage:sessionStorage}
    function scheduleAutoLock(expires){
      clearTimeout(state.autoLockTimer);
      if(!expires)return;
      var remaining=expires-Date.now();
      if(remaining<=0){lockNow();return}
      state.autoLockTimer=setTimeout(lockNow,remaining);
    }
    async function cacheVaultKey(durationValue){
      var minutes=minutesOf(durationValue);
      var saved={key:b64(await crypto.subtle.exportKey('raw',state.vaultKey)),expires:expiry(minutes),minutes:minutes};
      sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY);
      try{storeFor(minutes).setItem(SESSION_KEY,JSON.stringify(saved))}catch(_){}
      localStorage.setItem(DURATION_KEY,durationValue);
      scheduleAutoLock(saved.expires);
    }
    function readVaultSession(){
      var found=null;
      [localStorage,sessionStorage].forEach(function(where){
        if(found)return;
        var raw=null;
        try{raw=JSON.parse(where.getItem(SESSION_KEY)||'null')}catch(_){}
        if(raw&&(!raw.expires||raw.expires>Date.now()))found=raw;else if(raw)where.removeItem(SESSION_KEY);
      });
      return found;
    }
    async function restoreVaultKey(){
      var saved=readVaultSession();
      if(!saved)return false;
      try{
        state.vaultKey=await importRawAesKey(saved.key);
        if(saved.minutes){saved.expires=expiry(saved.minutes);try{storeFor(saved.minutes).setItem(SESSION_KEY,JSON.stringify(saved))}catch(_){}}
        scheduleAutoLock(saved.expires);
        return true;
      }catch(_){sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY);return false}
    }
    function clearVaultSession(){sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(SESSION_KEY)}

    // dataKey is only ever written to storage when the user has explicitly
    // opted into the "keep fully unlocked for reveals" convenience toggle —
    // see ensureDataKey(). Default behaviour never calls these.
    async function cacheDataKeySession(){
      if(!state.dataKey)return;
      var durationValue=localStorage.getItem(DURATION_KEY)||'session';
      var minutes=minutesOf(durationValue);
      var saved={key:b64(state.dataKey),expires:expiry(minutes),minutes:minutes};
      sessionStorage.removeItem(DATAKEY_SESSION_KEY);localStorage.removeItem(DATAKEY_SESSION_KEY);
      try{storeFor(minutes).setItem(DATAKEY_SESSION_KEY,JSON.stringify(saved))}catch(_){}
    }
    function restoreDataKeySession(){
      if(!state.convenience)return false;
      var found=null;
      [localStorage,sessionStorage].forEach(function(where){
        if(found)return;
        var raw=null;
        try{raw=JSON.parse(where.getItem(DATAKEY_SESSION_KEY)||'null')}catch(_){}
        if(raw&&(!raw.expires||raw.expires>Date.now()))found=raw;else if(raw)where.removeItem(DATAKEY_SESSION_KEY);
      });
      if(!found)return false;
      try{state.dataKey=bytes(found.key);return true}catch(_){return false}
    }
    function clearDataKeyCache(){sessionStorage.removeItem(DATAKEY_SESSION_KEY);localStorage.removeItem(DATAKEY_SESSION_KEY)}

    function lockNow(){
      clearTimeout(state.autoLockTimer);state.autoLockTimer=0;
      state.vaultKey=null;state.dataKey=null;state.entries=[];state.pendingShares=[];state.portfolio=null;
      clearVaultSession();clearDataKeyCache();
      render();
    }

    // ---- generic modal helpers --------------------------------------------
    function openModal(html){
      var overlay=document.createElement('div');
      overlay.className='mc-overlay';
      overlay.innerHTML='<div class="mc-dialog">'+html+'</div>';
      shell.appendChild(overlay);
      return overlay;
    }
    function closeModal(overlay){if(overlay&&overlay.parentNode)overlay.parentNode.removeChild(overlay)}

    // A single-field password prompt whose `validate` callback resolves to
    // whatever the caller wants on success, or throws {mcMessage} to show an
    // inline error and let the user try again without losing the dialog.
    function promptPassword(title,info,validate){
      return new Promise(function(resolve){
        var overlay=openModal('<h3>'+esc(title)+'</h3>'+(info?'<p>'+esc(info)+'</p>':'')
          +'<input type="password" class="mc-prompt-input" autocomplete="current-password">'
          +'<div class="mc-error"></div>'
          +'<div class="mc-actions"><button class="primary mc-go">'+esc(t('mc_unlock_btn'))+'</button><button class="mc-cancel">'+esc(t('mc_cancel'))+'</button></div>');
        var input=overlay.querySelector('.mc-prompt-input'),err=overlay.querySelector('.mc-error'),busy=false;
        function cancel(){closeModal(overlay);resolve(null)}
        async function go(){
          if(busy)return;busy=true;err.textContent='';
          try{
            var result=await validate(input.value);
            closeModal(overlay);resolve(result);
          }catch(e){
            err.textContent=(e&&e.mcMessage)||t('mc_error_generic');
            busy=false;
          }
        }
        overlay.querySelector('.mc-cancel').onclick=cancel;
        overlay.querySelector('.mc-go').onclick=go;
        input.addEventListener('keydown',function(e){if(e.key==='Enter')go()});
        setTimeout(function(){input.focus()},30);
      });
    }

    // Returns the 32-byte dataKey, prompting for the master password unless
    // the convenience opt-in is on and a cached copy is still valid. By
    // default this is called fresh on every reveal/create/edit and the
    // result is NOT kept afterwards — see revealEntry() and friends.
    async function ensureDataKey(){
      if(state.convenience&&!state.dataKey)restoreDataKeySession();
      if(state.dataKey)return state.dataKey;
      var status=state.vaultStatus;
      var result=await promptPassword(t('mc_reveal_master_title'),'',async function(pw){
        if(!pw)throw{mcMessage:t('mc_unlock_failed')};
        var vk=await deriveVaultKey(pw,status.salt,status.iterations);
        var dkBuf;
        try{dkBuf=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(status.wrap_iv)},vk,bytes(status.wrap_ciphertext))}
        catch(_){throw{mcMessage:t('mc_unlock_failed')}}
        return{vaultKey:vk,dataKey:new Uint8Array(dkBuf)};
      });
      if(!result)return null;
      if(!state.vaultKey){state.vaultKey=result.vaultKey;await cacheVaultKey(localStorage.getItem(DURATION_KEY)||'session')}
      if(state.convenience){state.dataKey=result.dataKey;await cacheDataKeySession()}
      return result.dataKey;
    }

    // ---- vault: setup / unlock -------------------------------------------
    async function loadVaultStatus(){state.vaultStatus=await api('/vault-status')}

    async function loadEntries(){
      // Every row here is fully owned by the caller and decryptable with
      // their own vaultKey — a recipient's accepted transfer is a
      // completely normal entry, indistinguishable from one they typed in
      // themselves. `shares` (who the owner shared this with, each flagged
      // accepted/pending) rides along for the "shared with: ..." indicator.
      var rows=await api('/seed-entries');
      var out=[];
      for(var i=0;i<rows.length;i++){
        var row=rows[i];
        try{
          var meta=await decryptJSON(state.vaultKey,row.iv_meta,row.ciphertext_meta);
          out.push({id:row.id,label:meta.label||'',notes:meta.notes||'',word_count:meta.word_count||0,
            created_at:row.created_at,updated_at:row.updated_at,shares:row.shares||[]});
        }catch(_){/* skip entries this vaultKey cannot open */}
      }
      out.sort(function(a,b){return b.updated_at-a.updated_at});
      state.entries=out;
    }

    async function loadPendingShares(){
      try{state.pendingShares=await api('/shares/pending')}catch(_){state.pendingShares=[]}
    }

    async function doVaultSetup(password){
      var saltBytes=crypto.getRandomValues(new Uint8Array(16));
      var salt=b64(saltBytes);
      var dataKeyBytes=crypto.getRandomValues(new Uint8Array(32));
      var vaultKey=await deriveVaultKey(password,salt,ITERATIONS);
      var wrapIv=crypto.getRandomValues(new Uint8Array(12));
      var wrapCt=await crypto.subtle.encrypt({name:'AES-GCM',iv:wrapIv},vaultKey,dataKeyBytes);
      await api('/vault-setup',{method:'POST',body:JSON.stringify({salt:salt,iterations:ITERATIONS,wrap_iv:b64(wrapIv),wrap_ciphertext:b64(wrapCt)})});
      state.vaultStatus={exists:true,salt:salt,iterations:ITERATIONS,wrap_iv:b64(wrapIv),wrap_ciphertext:b64(wrapCt)};
      state.vaultKey=vaultKey;
      state.entries=[];
      state.portfolio={addresses:[],custom_assets:[],prices:{},total_usd:null};
    }

    async function doUnlock(password){
      var status=state.vaultStatus;
      var vaultKey=await deriveVaultKey(password,status.salt,status.iterations);
      try{await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(status.wrap_iv)},vaultKey,bytes(status.wrap_ciphertext))}
      catch(_){throw new Error('wrong_password')}
      state.vaultKey=vaultKey;
      await loadEntries();
      await loadPendingShares();
      // Portfolio/custom-asset data is vaultKey-encrypted too now — nothing
      // in it can be shown or refreshed before this point, unlike before
      // encryption landed when Portfolio worked without unlocking anything.
      await loadPortfolio();
    }

    // ---- seed entry writes -------------------------------------------------
    async function createEntry(label,phrase,passphrase,notes,entryPassword,dataKeyBytes){
      var wordCount=phrase.trim().split(/\s+/).filter(Boolean).length;
      var meta=await encryptJSON(state.vaultKey,{label:label,notes:notes,word_count:wordCount});
      var entrySalt=b64(crypto.getRandomValues(new Uint8Array(16)));
      var entryKey=await deriveEntryKey(dataKeyBytes,entryPassword,entrySalt,ITERATIONS);
      var secret=await encryptJSON(entryKey,{phrase:phrase,passphrase:passphrase||''});
      return api('/seed-entries',{method:'POST',body:JSON.stringify({
        iv_meta:meta.iv,ciphertext_meta:meta.ciphertext,
        entry_salt:entrySalt,iv_secret:secret.iv,ciphertext_secret:secret.ciphertext
      })});
    }
    // ---- sharing: one-time secure transfer ---------------------------------
    // "Shared password" == the entry's own password (deliberately the same
    // concept as a personal entry's password — see the module docstring).
    // transferKey = PBKDF2(sharedPassword, transfer_salt) is a PASSWORD-ONLY
    // derivation, so deriveVaultKey(...) (which already does exactly that —
    // no dataKey mixed in) is reused as-is rather than adding a third
    // derivation function.
    async function encryptTransfer(sharedPassword,payload){
      var transferSalt=b64(crypto.getRandomValues(new Uint8Array(16)));
      var transferKey=await deriveVaultKey(sharedPassword,transferSalt,ITERATIONS);
      var enc=await encryptJSON(transferKey,payload);
      return{transfer_salt:transferSalt,iv:enc.iv,ciphertext:enc.ciphertext};
    }
    // Sends (or re-sends, for an edit-triggered refresh) one entry's full
    // plaintext to one recipient. label/notes/phrase/passphrase are all
    // included now — unlike a permanent live-shared row, this is a one-time
    // plaintext handoff moment, so there is no reason to withhold the label.
    async function shareEntryWithRecipient(sourceEntryId,recipientId,label,notes,wordCount,phrase,passphrase,sharedPassword){
      var payload={label:label,notes:notes,word_count:wordCount,phrase:phrase,passphrase:passphrase||''};
      var enc=await encryptTransfer(sharedPassword,payload);
      return api('/shares',{method:'POST',body:JSON.stringify({
        recipient_owner_id:recipientId,source_entry_id:sourceEntryId,
        transfer_salt:enc.transfer_salt,iv:enc.iv,ciphertext:enc.ciphertext
      })});
    }
    // Edit-triggered re-share: every active recipient — accepted OR still
    // pending — gets their current derived copy (and any stale pending
    // transfer) deleted outright first, via the exact same "stop sharing"
    // mechanism, THEN a completely fresh transfer with the just-edited
    // content. This is deliberate, per the module docstring: an edit does
    // not layer a new transfer on top of an old accepted copy — the old
    // copy is gone and the recipient must accept the new version, no
    // partial-update case, no risk of two versions of the same entry
    // existing in the recipient's vault at once.
    async function reshareToAll(entryId,shares,label,notes,wordCount,phrase,passphrase,sharedPassword){
      for(var i=0;i<shares.length;i++){
        try{
          await stopSharing(entryId,shares[i].user_id);
          await shareEntryWithRecipient(entryId,shares[i].user_id,label,notes,wordCount,phrase,passphrase,sharedPassword);
        }catch(_){/* one recipient failing must not block the others or the save itself */}
      }
    }
    // Recipient side: decrypts a pending transfer, then hands the plaintext
    // straight to createEntry() — the SAME path any personal entry goes
    // through — using the shared password as this new entry's own password
    // too, so the result is a normal, independent, dual-protected entry.
    async function acceptShare(shareId,sharedPassword,dataKeyBytes){
      var share=await api('/shares/pending/'+shareId);
      var transferKey=await deriveVaultKey(sharedPassword,share.transfer_salt,ITERATIONS);
      var payload;
      try{payload=await decryptJSON(transferKey,share.iv,share.ciphertext)}
      catch(_){throw new Error('wrong_password')}
      var created=await createEntry(payload.label||'',payload.phrase,payload.passphrase||'',payload.notes||'',sharedPassword,dataKeyBytes);
      await api('/shares/pending/'+shareId+'/accept',{method:'POST',body:JSON.stringify({created_entry_id:created.id})});
      return created.id;
    }
    async function stopSharing(entryId,recipientId){
      return api('/seed-entries/'+entryId+'/share/'+recipientId,{method:'DELETE'});
    }

    async function updateEntryMetaOnly(id,label,notes,wordCount){
      var meta=await encryptJSON(state.vaultKey,{label:label,notes:notes,word_count:wordCount||0});
      return api('/seed-entries/'+id,{method:'PUT',body:JSON.stringify({iv_meta:meta.iv,ciphertext_meta:meta.ciphertext})});
    }
    // Replaces the phrase/passphrase, keeping the entry's password unchanged.
    // The entered "current" password is verified by successfully decrypting
    // the existing secret before anything is overwritten, so a typo here
    // fails loudly instead of silently locking the entry forever.
    async function updateEntryPhrase(id,label,notes,newPhrase,newPassphrase,currentPassword,dataKeyBytes){
      var existing=await api('/seed-entries/'+id+'/secret');
      var key=await deriveEntryKey(dataKeyBytes,currentPassword,existing.entry_salt,ITERATIONS);
      try{await decryptJSON(key,existing.iv_secret,existing.ciphertext_secret)}
      catch(_){throw new Error('wrong_password')}
      var wordCount=newPhrase.trim().split(/\s+/).filter(Boolean).length;
      var meta=await encryptJSON(state.vaultKey,{label:label,notes:notes,word_count:wordCount});
      var secret=await encryptJSON(key,{phrase:newPhrase,passphrase:newPassphrase||''});
      return api('/seed-entries/'+id,{method:'PUT',body:JSON.stringify({
        iv_meta:meta.iv,ciphertext_meta:meta.ciphertext,
        entry_salt:existing.entry_salt,iv_secret:secret.iv,ciphertext_secret:secret.ciphertext
      })});
    }
    // Returns the decrypted {phrase,passphrase} on success — the caller
    // needs it to re-share under the new password when this entry has
    // active recipients (see changeEntryPasswordDialog below).
    async function changeEntryPassword(id,oldPassword,newPassword,dataKeyBytes){
      var existing=await api('/seed-entries/'+id+'/secret');
      var oldKey=await deriveEntryKey(dataKeyBytes,oldPassword,existing.entry_salt,ITERATIONS);
      var data;
      try{data=await decryptJSON(oldKey,existing.iv_secret,existing.ciphertext_secret)}
      catch(_){throw new Error('wrong_password')}
      var newSalt=b64(crypto.getRandomValues(new Uint8Array(16)));
      var newKey=await deriveEntryKey(dataKeyBytes,newPassword,newSalt,ITERATIONS);
      var secret=await encryptJSON(newKey,data);
      await api('/seed-entries/'+id,{method:'PUT',body:JSON.stringify({entry_salt:newSalt,iv_secret:secret.iv,ciphertext_secret:secret.ciphertext})});
      return data;
    }

    async function revealEntry(entryId){
      // Every entry — the owner's own and a recipient's accepted transfer
      // alike — is a normal personal dual-protected entry now, so there is
      // only ever this one reveal path (dataKey + this entry's password).
      var dataKeyBytes;
      try{dataKeyBytes=await ensureDataKey()}catch(_){toast(t('mc_error_generic'));return}
      if(!dataKeyBytes)return; // cancelled
      var data=await promptPassword(t('mc_reveal_entry_title'),t('mc_reveal_entry_info'),async function(pw){
        if(!pw)throw{mcMessage:t('mc_reveal_wrong')};
        var secret;
        try{secret=await api('/seed-entries/'+entryId+'/secret')}
        catch(_){throw{mcMessage:t('mc_error_generic')}}
        var entryKey=await deriveEntryKey(dataKeyBytes,pw,secret.entry_salt,ITERATIONS);
        try{return await decryptJSON(entryKey,secret.iv_secret,secret.ciphertext_secret)}
        catch(_){throw{mcMessage:t('mc_reveal_wrong')}}
      });
      if(!state.convenience)state.dataKey=null; // discarded again — see ensureDataKey()
      if(!data)return;
      showRevealResult(data);
    }

    function showRevealResult(data){
      var html='<h3>'+esc(t('mc_reveal_title'))+'</h3>'
        +'<div class="mc-reveal-warning">⚠ '+esc(t('mc_reveal_warning'))+'</div>'
        +'<div class="mc-reveal-value mc-phrase">'+esc(data.phrase)+'</div>';
      if(data.passphrase)html+='<label>'+esc(t('mc_passphrase_field'))+'</label><div class="mc-reveal-value mc-shown">'+esc(data.passphrase)+'</div>';
      html+='<div class="mc-actions"><button class="mc-toggle-show">'+esc(t('mc_show'))+'</button><button class="mc-copy-btn">'+esc(t('mc_copy'))+'</button><button class="primary mc-close-btn">'+esc(t('mc_close'))+'</button></div>';
      var overlay=openModal(html);
      var phraseEl=overlay.querySelector('.mc-phrase'),toggleBtn=overlay.querySelector('.mc-toggle-show');
      var shown=false;
      toggleBtn.onclick=function(){
        shown=!shown;
        phraseEl.classList.toggle('mc-shown',shown);
        toggleBtn.textContent=t(shown?'mc_hide':'mc_show');
      };
      overlay.querySelector('.mc-copy-btn').onclick=function(){
        var text=data.phrase+(data.passphrase?'\n'+data.passphrase:'');
        navigator.clipboard&&navigator.clipboard.writeText(text).then(function(){toast(t('mc_copied'))});
      };
      overlay.querySelector('.mc-close-btn').onclick=function(){closeModal(overlay)};
      // Re-mask on blur/idle: this is sensitive, fund-controlling text.
      var reHide=function(){shown=false;phraseEl.classList.remove('mc-shown');toggleBtn.textContent=t('mc_show')};
      window.addEventListener('blur',reHide,{once:true});
    }

    // ---- entry dialogs ------------------------------------------------------
    function entryDialog(existing){
      return new Promise(function(resolve){
        var isEdit=!!existing;
        var shares=(isEdit&&existing.shares)||[];
        var hasShares=shares.length>0;
        var recipientNames=shares.map(function(s){return s.display_name||s.username||s.user_id}).join(', ');
        var html='<h3>'+esc(t(isEdit?'mc_edit_entry_title':'mc_new_entry_title'))+'</h3>'
          +'<label>'+esc(t('mc_label_field'))+'</label><input class="mc-f-label" placeholder="'+esc(t('mc_label_placeholder'))+'" value="'+esc(isEdit?existing.label:'')+'">'
          +'<label>'+esc(t('mc_notes_field'))+'</label><textarea class="mc-f-notes">'+esc(isEdit?existing.notes:'')+'</textarea>';
        if(!isEdit){
          html+='<label>'+esc(t('mc_phrase_field'))+'</label><textarea class="mc-f-phrase" placeholder="'+esc(t('mc_phrase_placeholder'))+'" autocomplete="off"></textarea>'
            +'<label>'+esc(t('mc_passphrase_field'))+'</label><input class="mc-f-passphrase" type="password" autocomplete="new-password">'
            +'<label>'+esc(t('mc_entry_password_field'))+'</label><input class="mc-f-epass" type="password" autocomplete="new-password">'
            +'<div class="mc-hint">'+esc(t('mc_entry_password_hint'))+'</div>'
            +'<label>'+esc(t('mc_confirm_entry_password_field'))+'</label><input class="mc-f-epass2" type="password" autocomplete="new-password">';
        }else{
          if(hasShares)html+='<div class="mc-hint mc-reshare-notice">'+esc(t('mc_reshare_notice',{names:recipientNames}))+'</div>';
          html+='<label class="mc-toggle-label"><input type="checkbox" class="mc-f-change-phrase"> '+esc(t('mc_change_phrase_toggle'))+'</label>'
            +'<div class="mc-change-phrase-block" hidden>'
            +'<div class="mc-hint">'+esc(t('mc_change_phrase_hint'))+'</div>'
            +'<label>'+esc(t('mc_current_entry_password_field'))+'</label><input class="mc-f-cur-epass" type="password" autocomplete="current-password">'
            +'<label>'+esc(t('mc_phrase_field'))+'</label><textarea class="mc-f-phrase" placeholder="'+esc(t('mc_phrase_placeholder'))+'" autocomplete="off"></textarea>'
            +'<label>'+esc(t('mc_passphrase_field'))+'</label><input class="mc-f-passphrase" type="password" autocomplete="new-password">'
            +'</div>';
          if(hasShares)html+='<div class="mc-reshare-epass-block">'
            +'<label>'+esc(t('mc_current_entry_password_field'))+'</label><input class="mc-f-reshare-epass" type="password" autocomplete="current-password">'
            +'<div class="mc-hint">'+esc(t('mc_reshare_password_hint'))+'</div>'
            +'</div>';
        }
        html+='<div class="mc-error"></div><div class="mc-actions"><button class="primary mc-save">'+esc(t('mc_save'))+'</button><button class="mc-cancel">'+esc(t('mc_cancel'))+'</button>'
          +(isEdit?'<button class="mc-danger mc-delete">'+esc(t('mc_delete'))+'</button>':'')+'</div>';
        var overlay=openModal(html);
        var err=overlay.querySelector('.mc-error');
        overlay.querySelector('.mc-cancel').onclick=function(){closeModal(overlay);resolve(null)};
        if(isEdit){
          overlay.querySelector('.mc-delete').onclick=function(){
            if(!window.confirm(t('mc_delete_entry_confirm',{name:existing.label})))return;
            api('/seed-entries/'+existing.id,{method:'DELETE'}).then(function(){closeModal(overlay);resolve('deleted')}).catch(function(){err.textContent=t('mc_error_generic')});
          };
        }
        var toggle=overlay.querySelector('.mc-f-change-phrase'),block=overlay.querySelector('.mc-change-phrase-block');
        var reshareBlock=overlay.querySelector('.mc-reshare-epass-block');
        // The dedicated "current entry password" field only exists to
        // decrypt the secret for a meta-only re-share; once the phrase is
        // being replaced anyway, the toggle block's own password field
        // already does that job, so hide the duplicate.
        if(toggle)toggle.onchange=function(){
          block.hidden=!toggle.checked;
          if(reshareBlock)reshareBlock.hidden=toggle.checked;
        };
        overlay.querySelector('.mc-save').onclick=async function(){
          err.textContent='';
          var label=overlay.querySelector('.mc-f-label').value.trim();
          var notes=overlay.querySelector('.mc-f-notes').value.trim();
          if(!label){err.textContent=t('mc_entry_required');return}
          try{
            if(!isEdit){
              var phrase=overlay.querySelector('.mc-f-phrase').value.trim();
              var passphrase=overlay.querySelector('.mc-f-passphrase').value;
              var epass=overlay.querySelector('.mc-f-epass').value;
              var epass2=overlay.querySelector('.mc-f-epass2').value;
              if(!phrase||!epass){err.textContent=t('mc_entry_required');return}
              if(epass!==epass2){err.textContent=t('mc_passwords_differ');return}
              if(epass.length<MIN_ENTRY_PW){err.textContent=t('mc_password_short',{n:MIN_ENTRY_PW});return}
              var dataKeyBytes=await ensureDataKey();
              if(!dataKeyBytes)return;
              var created=await createEntry(label,phrase,passphrase,notes,epass,dataKeyBytes);
              if(!state.convenience)state.dataKey=null;
              closeModal(overlay);resolve({id:created.id,label:label});
              return;
            }else if(toggle&&toggle.checked){
              var newPhrase=overlay.querySelector('.mc-f-phrase').value.trim();
              var newPassphrase=overlay.querySelector('.mc-f-passphrase').value;
              var curPw=overlay.querySelector('.mc-f-cur-epass').value;
              if(!newPhrase||!curPw){err.textContent=t('mc_entry_required');return}
              var dk=await ensureDataKey();
              if(!dk)return;
              try{await updateEntryPhrase(existing.id,label,notes,newPhrase,newPassphrase,curPw,dk)}
              catch(e){if(!state.convenience)state.dataKey=null;err.textContent=t('mc_reveal_wrong');return}
              if(!state.convenience)state.dataKey=null;
              if(hasShares){
                var wc=newPhrase.split(/\s+/).filter(Boolean).length;
                await reshareToAll(existing.id,shares,label,notes,wc,newPhrase,newPassphrase,curPw);
              }
            }else if(hasShares){
              // Meta-only edit of a shared entry: the label/notes still
              // need to reach every recipient's next transfer, so the
              // current secret has to be decrypted here too — see the
              // module docstring on why every edit to a shared entry
              // triggers a full re-share, not just phrase changes.
              var reshareEpass=overlay.querySelector('.mc-f-reshare-epass').value;
              if(!reshareEpass){err.textContent=t('mc_entry_required');return}
              var rdk=await ensureDataKey();
              if(!rdk)return;
              var secret,plain;
              try{
                secret=await api('/seed-entries/'+existing.id+'/secret');
                var key=await deriveEntryKey(rdk,reshareEpass,secret.entry_salt,ITERATIONS);
                plain=await decryptJSON(key,secret.iv_secret,secret.ciphertext_secret);
              }catch(e){if(!state.convenience)state.dataKey=null;err.textContent=t('mc_reveal_wrong');return}
              await updateEntryMetaOnly(existing.id,label,notes,existing.word_count);
              if(!state.convenience)state.dataKey=null;
              await reshareToAll(existing.id,shares,label,notes,existing.word_count,plain.phrase,plain.passphrase,reshareEpass);
            }else{
              await updateEntryMetaOnly(existing.id,label,notes,existing.word_count);
            }
            closeModal(overlay);resolve(true);
          }catch(e){
            err.textContent=t('mc_error_generic');
          }
        };
        setTimeout(function(){overlay.querySelector('.mc-f-label').focus()},30);
      });
    }

    function changeEntryPasswordDialog(entry){
      return new Promise(function(resolve){
        var shares=entry.shares||[];
        var html='<h3>'+esc(t('mc_change_entry_password_title'))+'</h3>'
          +(shares.length?'<div class="mc-hint mc-reshare-notice">'+esc(t('mc_reshare_notice',{names:shares.map(function(s){return s.display_name||s.username||s.user_id}).join(', ')}))+'</div>':'')
          +'<label>'+esc(t('mc_old_entry_password_field'))+'</label><input class="mc-f-old" type="password" autocomplete="current-password">'
          +'<label>'+esc(t('mc_new_entry_password_field'))+'</label><input class="mc-f-new" type="password" autocomplete="new-password">'
          +'<label>'+esc(t('mc_confirm_new_entry_password_field'))+'</label><input class="mc-f-new2" type="password" autocomplete="new-password">'
          +'<div class="mc-error"></div><div class="mc-actions"><button class="primary mc-save">'+esc(t('mc_change_entry_password_btn'))+'</button><button class="mc-cancel">'+esc(t('mc_cancel'))+'</button></div>';
        var overlay=openModal(html);
        var err=overlay.querySelector('.mc-error');
        overlay.querySelector('.mc-cancel').onclick=function(){closeModal(overlay);resolve(false)};
        overlay.querySelector('.mc-save').onclick=async function(){
          err.textContent='';
          var oldPw=overlay.querySelector('.mc-f-old').value;
          var newPw=overlay.querySelector('.mc-f-new').value;
          var newPw2=overlay.querySelector('.mc-f-new2').value;
          if(newPw!==newPw2){err.textContent=t('mc_passwords_differ');return}
          if(newPw.length<MIN_ENTRY_PW){err.textContent=t('mc_password_short',{n:MIN_ENTRY_PW});return}
          var dk=await ensureDataKey();
          if(!dk)return;
          try{
            var data=await changeEntryPassword(entry.id,oldPw,newPw,dk);
            if(!state.convenience)state.dataKey=null;
            if(shares.length)await reshareToAll(entry.id,shares,entry.label,entry.notes,entry.word_count,data.phrase,data.passphrase,newPw);
            closeModal(overlay);resolve(true);
          }catch(_){
            if(!state.convenience)state.dataKey=null;
            err.textContent=t('mc_change_entry_password_failed');
          }
        };
        setTimeout(function(){overlay.querySelector('.mc-f-old').focus()},30);
      });
    }

    // Recipient management for a shared entry — mirrors budget-widget.js's
    // openShare(cat) pattern: "current recipients" (each flagged pending or
    // active, with a "stop sharing" button) above "add from favourites"
    // (an add button per favourite not already a recipient), applying
    // immediately on click rather than being deferred to a form Save.
    //
    // Adding a NEW recipient needs the entry's current plaintext to build
    // the transfer payload, so the first "Share" click in a dialog session
    // prompts for the master + entry password (same decrypt path as
    // Reveal); the result is cached in `unlocked` for the rest of this
    // dialog's lifetime so adding several people in one sitting only
    // prompts once.
    function manageSharingDialog(entry){
      var overlay=openModal(
        '<h3>'+esc(t('mc_share_dialog_title',{name:entry.label}))+'</h3>'
        +'<label>'+esc(t('mc_current_recipients'))+'</label>'
        +'<div class="mc-share-current"><div class="mc-empty">…</div></div>'
        +'<label>'+esc(t('mc_add_from_favourites'))+'</label>'
        +'<div class="mc-share-favs"><div class="mc-empty">…</div></div>'
        +'<div class="mc-error"></div>'
        +'<div class="mc-actions"><button class="primary mc-close">'+esc(t('mc_close'))+'</button></div>'
      );
      var err=overlay.querySelector('.mc-error');
      var unlocked=null; // {password,data:{phrase,passphrase}} — cached after the first successful decrypt this session
      var changed=false;
      overlay.querySelector('.mc-close').onclick=function(){
        closeModal(overlay);
        // The "shared with: ..." indicator on the card behind this dialog
        // may now be stale — refresh it if anything actually changed.
        if(changed)loadEntries().then(render);
      };

      function memberRow(uid,name,statusText,removable){
        var row=document.createElement('div');
        row.className='mc-card';row.dataset.uid=uid;
        row.style.display='flex';row.style.alignItems='center';row.style.justifyContent='space-between';row.style.gap='.5rem';
        row.innerHTML='<span style="overflow-wrap:anywhere">'+esc(name)+(statusText?' <span class="mc-card-sub">('+esc(statusText)+')</span>':'')+'</span>';
        var btn=document.createElement('button');
        btn.textContent=removable?t('mc_stop_sharing'):t('mc_share');
        btn.className=removable?'mc-danger':'';
        row.appendChild(btn);
        return{row:row,btn:btn};
      }

      async function ensureUnlocked(){
        if(unlocked)return unlocked;
        var dataKeyBytes=await ensureDataKey();
        if(!dataKeyBytes)return null;
        var result=await promptPassword(t('mc_reveal_entry_title'),t('mc_share_entry_password_hint'),async function(pw){
          if(!pw)throw{mcMessage:t('mc_reveal_wrong')};
          var secret;
          try{secret=await api('/seed-entries/'+entry.id+'/secret')}
          catch(_){throw{mcMessage:t('mc_error_generic')}}
          var key=await deriveEntryKey(dataKeyBytes,pw,secret.entry_salt,ITERATIONS);
          try{return{password:pw,data:await decryptJSON(key,secret.iv_secret,secret.ciphertext_secret)}}
          catch(_){throw{mcMessage:t('mc_reveal_wrong')}}
        });
        if(!state.convenience)state.dataKey=null;
        if(result)unlocked=result;
        return unlocked;
      }

      async function loadCurrent(){
        var rows=[];
        try{rows=await api('/seed-entries/'+entry.id+'/shares')}catch(_){/* not owner anymore, etc. */}
        var box=overlay.querySelector('.mc-share-current');
        box.innerHTML='';
        if(!rows.length){var empty=document.createElement('div');empty.className='mc-empty';empty.textContent=t('mc_no_recipients');box.appendChild(empty)}
        rows.forEach(function(m){
          var status=t(m.accepted?'mc_share_status_active':'mc_share_status_pending');
          var r=memberRow(m.user_id,m.display_name||m.username||m.user_id,status,true);
          r.btn.onclick=async function(){
            if(!window.confirm(t('mc_confirm_stop_sharing')))return;
            try{await stopSharing(entry.id,m.user_id)}catch(_){err.textContent=t('mc_error_generic');return}
            changed=true;
            loadAll();
          };
          box.appendChild(r.row);
        });
        return rows.map(function(m){return m.user_id});
      }

      async function loadAll(){
        err.textContent='';
        var memberIds=await loadCurrent();
        var favs=[];
        try{favs=await favApi('/favourites')}catch(_){/* ignore */}
        var box=overlay.querySelector('.mc-share-favs');
        var available=favs.filter(function(f){return memberIds.indexOf(f.id)===-1});
        box.innerHTML='';
        if(!available.length){var empty=document.createElement('div');empty.className='mc-empty';empty.textContent=t('mc_no_favourites_share');box.appendChild(empty);return}
        available.forEach(function(f){
          var r=memberRow(f.id,f.display_name||f.username,null,false);
          r.btn.onclick=async function(){
            err.textContent='';
            var u=await ensureUnlocked();
            if(!u)return;
            try{await shareEntryWithRecipient(entry.id,f.id,entry.label,entry.notes,entry.word_count,u.data.phrase,u.data.passphrase,u.password)}
            catch(_){err.textContent=t('mc_share_failed');return}
            changed=true;
            toast(t('mc_share_added'));
            loadAll();
          };
          box.appendChild(r.row);
        });
      }
      loadAll();
    }

    function changeMasterDialog(){
      return new Promise(function(resolve){
        var html='<h3>'+esc(t('mc_change_master_title'))+'</h3>'
          +'<label>'+esc(t('mc_current_master_password_field'))+'</label><input class="mc-f-cur" type="password" autocomplete="current-password">'
          +'<label>'+esc(t('mc_new_master_password_field'))+'</label><input class="mc-f-new" type="password" autocomplete="new-password">'
          +'<label>'+esc(t('mc_confirm_new_master_password_field'))+'</label><input class="mc-f-new2" type="password" autocomplete="new-password">'
          +'<div class="mc-error"></div><div class="mc-actions"><button class="primary mc-save">'+esc(t('mc_change_master_btn'))+'</button><button class="mc-cancel">'+esc(t('mc_cancel'))+'</button></div>';
        var overlay=openModal(html);
        var err=overlay.querySelector('.mc-error');
        overlay.querySelector('.mc-cancel').onclick=function(){closeModal(overlay);resolve(false)};
        overlay.querySelector('.mc-save').onclick=async function(){
          err.textContent='';
          var curPw=overlay.querySelector('.mc-f-cur').value;
          var newPw=overlay.querySelector('.mc-f-new').value;
          var newPw2=overlay.querySelector('.mc-f-new2').value;
          if(newPw!==newPw2){err.textContent=t('mc_passwords_differ');return}
          if(newPw.length<MIN_MASTER){err.textContent=t('mc_password_short',{n:MIN_MASTER});return}
          try{
            var status=await api('/vault-status');
            var oldVaultKey=await deriveVaultKey(curPw,status.salt,status.iterations);
            var dataKeyBuf;
            try{dataKeyBuf=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(status.wrap_iv)},oldVaultKey,bytes(status.wrap_ciphertext))}
            catch(_){err.textContent=t('mc_change_master_failed');return}
            var dataKeyBytes=new Uint8Array(dataKeyBuf);
            var rows=await api('/seed-entries');
            var newSalt=b64(crypto.getRandomValues(new Uint8Array(16)));
            var newVaultKey=await deriveVaultKey(newPw,newSalt,ITERATIONS);
            var newEntries=[];
            for(var i=0;i<rows.length;i++){
              var row=rows[i];
              var meta=await decryptJSON(oldVaultKey,row.iv_meta,row.ciphertext_meta);
              var reenc=await encryptJSON(newVaultKey,meta);
              newEntries.push({id:row.id,iv_meta:reenc.iv,ciphertext_meta:reenc.ciphertext});
            }
            var newWrapIv=crypto.getRandomValues(new Uint8Array(12));
            var newWrapCt=await crypto.subtle.encrypt({name:'AES-GCM',iv:newWrapIv},newVaultKey,dataKeyBytes);
            await api('/vault-rekey',{method:'POST',body:JSON.stringify({salt:newSalt,iterations:ITERATIONS,wrap_iv:b64(newWrapIv),wrap_ciphertext:b64(newWrapCt),entries:newEntries})});
            state.vaultStatus={exists:true,salt:newSalt,iterations:ITERATIONS,wrap_iv:b64(newWrapIv),wrap_ciphertext:b64(newWrapCt)};
            state.vaultKey=newVaultKey;
            await cacheVaultKey(localStorage.getItem(DURATION_KEY)||'session');
            if(state.convenience){state.dataKey=dataKeyBytes;await cacheDataKeySession()}else{state.dataKey=null;clearDataKeyCache()}
            closeModal(overlay);resolve(true);
          }catch(_){err.textContent=t('mc_change_master_failed')}
        };
        setTimeout(function(){overlay.querySelector('.mc-f-cur').focus()},30);
      });
    }

    function settingsDialog(){
      return new Promise(function(resolve){
        var duration=localStorage.getItem(DURATION_KEY)||'session';
        var html='<h3>'+esc(t('mc_settings'))+'</h3>'
          +'<label>'+esc(t('mc_settings_autolock'))+'</label>'
          +'<select class="mc-f-duration">'
          +'<option value="1">'+esc(t('mc_minutes',{n:1}))+'</option>'
          +'<option value="5">'+esc(t('mc_minutes',{n:5}))+'</option>'
          +'<option value="15">'+esc(t('mc_minutes',{n:15}))+'</option>'
          +'<option value="60">'+esc(t('mc_hour'))+'</option>'
          +'<option value="session">'+esc(t('mc_until_closed'))+'</option>'
          +'</select>'
          +'<label class="mc-toggle-label"><input type="checkbox" class="mc-f-convenience"'+(state.convenience?' checked':'')+'> '+esc(t('mc_settings_convenience'))+'</label>'
          +'<div class="mc-hint">'+esc(t('mc_settings_convenience_hint'))+'</div>'
          +'<div class="mc-actions"><button class="primary mc-save">'+esc(t('mc_save'))+'</button><button class="mc-cancel">'+esc(t('mc_cancel'))+'</button></div>'
          +'<div class="mc-actions"><button class="mc-change-master-btn" style="width:100%">'+esc(t('mc_change_master_title'))+'</button></div>'
          +'<div class="mc-actions"><button class="mc-lock-btn" style="width:100%">'+esc(t('mc_lock_now'))+'</button></div>';
        var overlay=openModal(html);
        overlay.querySelector('.mc-f-duration').value=duration;
        overlay.querySelector('.mc-cancel').onclick=function(){closeModal(overlay);resolve(false)};
        overlay.querySelector('.mc-save').onclick=async function(){
          var newDuration=overlay.querySelector('.mc-f-duration').value;
          var convenience=overlay.querySelector('.mc-f-convenience').checked;
          state.convenience=convenience;
          localStorage.setItem(CONVENIENCE_KEY,convenience?'1':'0');
          if(state.vaultKey)await cacheVaultKey(newDuration);else localStorage.setItem(DURATION_KEY,newDuration);
          if(!convenience){state.dataKey=null;clearDataKeyCache()}
          closeModal(overlay);resolve(true);
        };
        overlay.querySelector('.mc-change-master-btn').onclick=async function(){
          closeModal(overlay);
          var ok=await changeMasterDialog();
          if(ok)toast(t('mc_change_master_done'));
          resolve(true);
        };
        overlay.querySelector('.mc-lock-btn').onclick=function(){closeModal(overlay);lockNow();resolve(true)};
      });
    }

    // ---- portfolio ------------------------------------------------------
    //
    // Zero-knowledge: every network call that used to be a server-side
    // round trip (balance, token metadata, token price) now happens right
    // here in the browser, straight against each network's own public API
    // — confirmed CORS-open (Access-Control-Allow-Origin: *) for all of
    // them. That means the request comes from this visitor's own IP, not
    // the shared server's, and the server itself never sees a decrypted
    // address to look anything up for in the first place.
    var _EVM_RPC={ETH:'https://ethereum-rpc.publicnode.com',BNB:'https://bsc-rpc.publicnode.com',MATIC:'https://polygon-bor-rpc.publicnode.com'};
    var _ESPLORA_BASES=['https://blockstream.info/api','https://mempool.space/api'];

    async function fetchJsonGet(url){
      var r=await fetch(url);
      if(!r.ok)throw new Error('http_'+r.status);
      return r.json();
    }
    async function esploraGet(path){
      var lastErr;
      for(var i=0;i<_ESPLORA_BASES.length;i++){
        try{return await fetchJsonGet(_ESPLORA_BASES[i]+path)}catch(e){lastErr=e}
      }
      throw lastErr;
    }
    async function fetchBtcBalanceSat(address){
      var data=await esploraGet('/address/'+address);
      var chain=data.chain_stats||{},mempool=data.mempool_stats||{};
      return ((chain.funded_txo_sum||0)+(mempool.funded_txo_sum||0))-((chain.spent_txo_sum||0)+(mempool.spent_txo_sum||0));
    }
    async function evmRpc(network,method,params){
      var r=await fetch(_EVM_RPC[network],{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:method,params:params,id:1})});
      var data=await r.json();
      if(data.error)throw new Error('rpc_error');
      return data.result;
    }
    async function fetchEvmNativeBalance(network,address){return parseInt(await evmRpc(network,'eth_getBalance',[address,'latest']),16)}
    async function evmCall(network,to,dataHex){return evmRpc(network,'eth_call',[{to:to,data:dataHex},'latest'])}
    async function fetchEvmTokenBalance(network,contract,holder){
      var padded=holder.toLowerCase().replace('0x','').padStart(64,'0');
      var result=await evmCall(network,contract,'0x70a08231'+padded);
      return (result&&result!=='0x')?parseInt(result,16):0;
    }
    function hexToBytes(hex){var out=[];for(var i=0;i<hex.length;i+=2)out.push(parseInt(hex.substr(i,2),16));return out}
    function bytesToUint(arr){var n=0;for(var i=0;i<arr.length;i++)n=n*256+arr[i];return n}
    // ABI dynamic `string` decode (offset+length+data), with a fallback to a
    // plain fixed bytes32 read for older non-compliant tokens (e.g. the
    // original MKR) that return the symbol as raw bytes32 instead — same
    // two-step decode the server used to do in Python.
    function decodeEvmString(hexResult){
      var raw=hexToBytes((hexResult||'').slice(2));
      try{
        var length=bytesToUint(raw.slice(32,64));
        var decoded=new TextDecoder('utf-8').decode(new Uint8Array(raw.slice(64,64+length))).replace(/\x00+$/,'');
        if(decoded)return decoded;
      }catch(_){}
      try{
        var decoded2=new TextDecoder('utf-8').decode(new Uint8Array(raw.slice(0,32))).replace(/\x00+$/,'');
        return decoded2||null;
      }catch(_){return null}
    }
    async function fetchEvmTokenMetadata(network,contract){
      try{
        var decimals=parseInt(await evmCall(network,contract,'0x313ce567'),16);
        var symbol=decodeEvmString(await evmCall(network,contract,'0x95d89b41'));
        return symbol?{symbol:symbol,decimals:decimals}:null;
      }catch(_){return null}
    }
    async function fetchBlockcypherBalance(chain,address){
      var data=await fetchJsonGet('https://api.blockcypher.com/v1/'+chain+'/main/addrs/'+address+'/balance');
      return data.final_balance||0;
    }
    async function fetchTrxBalanceSun(address){
      var data=await fetchJsonGet('https://api.trongrid.io/v1/accounts/'+address);
      var rows=data.data||[];
      return rows.length?(rows[0].balance||0):0;
    }
    async function fetchTokenPriceUsd(platform,contract){
      try{
        var data=await fetchJsonGet('https://api.coingecko.com/api/v3/simple/token_price/'+platform+'?contract_addresses='+contract+'&vs_currencies=usd');
        var key=Object.keys(data)[0];
        return key?data[key].usd:null;
      }catch(_){return null}
    }

    function isBtcAddr(a){a=(a||'').trim();return a.length>=26&&a.length<=90&&/^[A-Za-z0-9]+$/.test(a)&&(a.charAt(0)==='1'||a.charAt(0)==='3'||a.toLowerCase().indexOf('bc1')===0)}
    function isEvmAddr(a){return /^0x[0-9a-fA-F]{40}$/.test((a||'').trim())}
    function isLtcAddr(a){a=(a||'').trim();if(a.toLowerCase().indexOf('ltc1')===0)return a.length>=14&&a.length<=74&&/^[A-Za-z0-9]+$/.test(a);return a.length>=25&&a.length<=40&&/^[A-Za-z0-9]+$/.test(a)&&(a.charAt(0)==='L'||a.charAt(0)==='M')}
    function isDogeAddr(a){a=(a||'').trim();return a.length>=26&&a.length<=40&&/^[A-Za-z0-9]+$/.test(a)&&a.charAt(0)==='D'}
    function isTrxAddr(a){a=(a||'').trim();return a.length===34&&/^[A-Za-z0-9]+$/.test(a)&&a.charAt(0)==='T'}

    // One registry drives validation, balance fetching and formatting for
    // every network — adding one later is one entry here, mirroring the
    // (now-removed) server-side _NETWORKS this replaces.
    var _NETWORKS={
      BTC:{decimals:8,valid:isBtcAddr,fetchNative:fetchBtcBalanceSat,evm:false},
      ETH:{decimals:18,valid:isEvmAddr,fetchNative:function(a){return fetchEvmNativeBalance('ETH',a)},evm:true,platform:'ethereum'},
      BNB:{decimals:18,valid:isEvmAddr,fetchNative:function(a){return fetchEvmNativeBalance('BNB',a)},evm:true,platform:'binance-smart-chain'},
      MATIC:{decimals:18,valid:isEvmAddr,fetchNative:function(a){return fetchEvmNativeBalance('MATIC',a)},evm:true,platform:'polygon-pos'},
      LTC:{decimals:8,valid:isLtcAddr,fetchNative:function(a){return fetchBlockcypherBalance('ltc',a)},evm:false},
      DOGE:{decimals:8,valid:isDogeAddr,fetchNative:function(a){return fetchBlockcypherBalance('doge',a)},evm:false},
      TRX:{decimals:6,valid:isTrxAddr,fetchNative:fetchTrxBalanceSun,evm:false}
    };
    var _EVM_NETWORKS={ETH:1,BNB:1,MATIC:1};
    var _NETWORK_LABELS={BTC:'₿ Bitcoin',ETH:'Ξ Ethereum',BNB:'BNB Smart Chain',MATIC:'Polygon',LTC:'Ł Litecoin',DOGE:'Ð Dogecoin',TRX:'TRON'};
    // Just format hints (address prefixes), not translated content — same
    // reasoning as leaving "0x…" etc. unlocalized anywhere else in crypto UIs.
    var _ADDR_PLACEHOLDERS={ETH:'0x…',BNB:'0x…',MATIC:'0x…',LTC:'L…, M…, ltc1…',DOGE:'D…',TRX:'T…'};
    var _EXPLORER_URLS={
      BTC:function(a){return 'https://mempool.space/address/'+a},
      ETH:function(a){return 'https://etherscan.io/address/'+a},
      BNB:function(a){return 'https://bscscan.com/address/'+a},
      MATIC:function(a){return 'https://polygonscan.com/address/'+a},
      LTC:function(a){return 'https://blockchair.com/litecoin/address/'+a},
      DOGE:function(a){return 'https://dogechain.info/address/'+a},
      TRX:function(a){return 'https://tronscan.org/#/address/'+a}
    };

    // A legacy row (address/label/etc still plaintext columns, from before
    // encryption landed) is encrypted exactly once, here, the moment it is
    // first decrypted — after the PUT below it is a normal row like any
    // other and this path is never taken for it again.
    async function migrateLegacyAddress(row){
      var plain={address:row.address,label:row.label||'',coin:row.coin||'BTC',
        token_contract:row.token_contract||null,token_symbol:row.token_symbol||null,
        token_decimals:row.token_decimals!=null?row.token_decimals:null,
        balance_units:row.balance_sat,last_updated:row.last_updated};
      try{
        var enc=await encryptJSON(state.vaultKey,plain);
        await api('/addresses/'+row.id,{method:'PUT',body:JSON.stringify(enc)});
      }catch(_){/* still usable this session even if the write-back failed */}
      return plain;
    }
    async function migrateLegacyCustomAsset(row){
      var plain={name:row.name||''};
      try{
        var enc=await encryptJSON(state.vaultKey,plain);
        await api('/custom-assets/'+row.id,{method:'PUT',body:JSON.stringify(enc)});
      }catch(_){}
      return plain;
    }
    async function migrateLegacyTxn(assetId,row){
      var plain={amount_usd:row.amount_usd,note:row.note||''};
      try{
        var enc=await encryptJSON(state.vaultKey,plain);
        await api('/custom-assets/'+assetId+'/transactions/'+row.id,{method:'PUT',body:JSON.stringify(enc)});
      }catch(_){}
      return plain;
    }

    async function loadPortfolio(){
      var data=await api('/addresses');
      var addresses=[];
      for(var i=0;i<data.addresses.length;i++){
        var row=data.addresses[i];
        try{
          var plain=row.legacy?await migrateLegacyAddress(row):await decryptJSON(state.vaultKey,row.iv,row.ciphertext);
          var entry={id:row.id,address:plain.address,label:plain.label||'',coin:plain.coin||'BTC',
            token_contract:plain.token_contract||null,token_symbol:plain.token_symbol||null,
            token_decimals:plain.token_decimals,balance_units:plain.balance_units,last_updated:plain.last_updated,
            tokenPriceUsd:null};
          // Token price by contract address is a per-holding lookup — kept
          // client-side just like the balance, since the server would
          // otherwise learn which contract this address holds a position in.
          if(entry.token_contract&&_NETWORKS[entry.coin]){
            try{entry.tokenPriceUsd=await fetchTokenPriceUsd(_NETWORKS[entry.coin].platform,entry.token_contract)}catch(_){}
          }
          addresses.push(entry);
        }catch(_){/* skip rows this vaultKey cannot open */}
      }
      var customAssets=[];
      for(var j=0;j<(data.custom_assets||[]).length;j++){
        var assetRow=data.custom_assets[j];
        try{
          var assetPlain=assetRow.legacy?await migrateLegacyCustomAsset(assetRow):await decryptJSON(state.vaultKey,assetRow.iv,assetRow.ciphertext);
          var txnRows=await api('/custom-assets/'+assetRow.id+'/transactions');
          var balance=0,txnCount=0;
          for(var k=0;k<txnRows.length;k++){
            var txnRow=txnRows[k];
            try{
              var txnPlain=txnRow.legacy?await migrateLegacyTxn(assetRow.id,txnRow):await decryptJSON(state.vaultKey,txnRow.iv,txnRow.ciphertext);
              balance+=Number(txnPlain.amount_usd)||0;
              txnCount++;
            }catch(_){/* skip */}
          }
          customAssets.push({id:assetRow.id,name:assetPlain.name||'',balance_usd:balance,txn_count:txnCount});
        }catch(_){/* skip */}
      }
      state.portfolio={addresses:addresses,customAssets:customAssets,prices:data.prices||{},
        custom_assets_enabled:!!data.custom_assets_enabled,price_updated_at:data.price_updated_at};
    }

    async function addAddress(address,label,coin,tokenContract){
      var network=_NETWORKS[coin];
      if(!network)return{ok:false,error:t('mc_invalid_network')};
      address=(address||'').trim();
      if(!network.valid(address))return{ok:false,error:t('mc_invalid_address')};
      var tokenSymbol=null,tokenDecimals=null;
      tokenContract=(tokenContract||'').trim();
      if(tokenContract){
        if(!network.evm)return{ok:false,error:t('mc_tokens_not_supported')};
        if(!isEvmAddr(tokenContract))return{ok:false,error:t('mc_invalid_token_contract')};
        var meta=await fetchEvmTokenMetadata(coin,tokenContract);
        if(!meta)return{ok:false,error:t('mc_invalid_token_contract')};
        tokenSymbol=meta.symbol;tokenDecimals=meta.decimals;
      }else{
        tokenContract=null;
      }
      // Duplicate check moved client-side — the server can no longer see
      // what any row holds to enforce this itself.
      var dup=(state.portfolio&&state.portfolio.addresses||[]).some(function(a){
        return a.address===address&&a.coin===coin&&(a.token_contract||null)===tokenContract;
      });
      if(dup)return{ok:false,error:t('mc_duplicate_address')};
      var plain={address:address,label:(label||'').trim(),coin:coin,token_contract:tokenContract,
        token_symbol:tokenSymbol,token_decimals:tokenDecimals,balance_units:null,last_updated:null};
      try{
        var enc=await encryptJSON(state.vaultKey,plain);
        await api('/addresses',{method:'POST',body:JSON.stringify(enc)});
        return{ok:true};
      }catch(_){
        return{ok:false,error:t('mc_error_generic')};
      }
    }

    async function refreshPortfolio(){
      var addresses=(state.portfolio&&state.portfolio.addresses)||[];
      for(var i=0;i<addresses.length;i++){
        var entry=addresses[i];
        var network=_NETWORKS[entry.coin];
        if(!network)continue;
        try{
          var units=entry.token_contract?await fetchEvmTokenBalance(entry.coin,entry.token_contract,entry.address):await network.fetchNative(entry.address);
          entry.balance_units=units;
          entry.last_updated=Math.floor(Date.now()/1000);
          if(entry.token_contract){
            try{entry.tokenPriceUsd=await fetchTokenPriceUsd(network.platform,entry.token_contract)}catch(_){}
          }
          var plain={address:entry.address,label:entry.label,coin:entry.coin,token_contract:entry.token_contract,
            token_symbol:entry.token_symbol,token_decimals:entry.token_decimals,
            balance_units:entry.balance_units,last_updated:entry.last_updated};
          var enc=await encryptJSON(state.vaultKey,plain);
          await api('/addresses/'+entry.id,{method:'PUT',body:JSON.stringify(enc)});
        }catch(_){
          // One address failing (rate limit, network hiccup) must not abort
          // the others — it simply keeps its last known balance.
        }
      }
      var prices=(state.portfolio&&state.portfolio.prices)||{};
      try{
        var priceData=await api('/addresses');
        prices=priceData.prices||prices;
      }catch(_){}
      if(state.portfolio)state.portfolio.prices=prices;
    }

    function portfolioTotalUsd(){
      if(!state.portfolio)return null;
      var total=0,known=false;
      state.portfolio.addresses.forEach(function(a){
        if(a.balance_units==null)return;
        var decimals=a.token_contract?(a.token_decimals!=null?a.token_decimals:18):(_NETWORKS[a.coin]?_NETWORKS[a.coin].decimals:8);
        var amount=a.balance_units/Math.pow(10,decimals);
        var price=a.token_contract?a.tokenPriceUsd:state.portfolio.prices[a.coin];
        if(price!=null){total+=amount*price;known=true}
      });
      state.portfolio.customAssets.forEach(function(c){total+=c.balance_usd;known=true});
      return known?total:null;
    }

    // ---- rendering --------------------------------------------------------
    function render(){
      if(state.destroyed)return;
      var html='<div class="mc-tabs">'
        +'<div class="mc-tab'+(state.tab==='vault'?' active':'')+'" data-tab="vault">🔐 '+esc(t('mc_tab_vault'))+'</div>'
        +'<div class="mc-tab'+(state.tab==='portfolio'?' active':'')+'" data-tab="portfolio">🪙 '+esc(t('mc_tab_portfolio'))+'</div>'
        +'<div class="mc-tab'+(state.tab==='explorer'?' active':'')+'" data-tab="explorer">🔍 '+esc(t('mc_tab_explorer'))+'</div>'
        +'</div>'
        +'<div class="mc-bar"><span class="mc-bar-title">'+esc(t('mc_title'))+'</span><span class="mc-bar-icons"></span></div>'
        +'<div class="mc-body"></div>';
      shell.innerHTML=html;
      shell.querySelectorAll('.mc-tab').forEach(function(el){
        el.onclick=function(){state.tab=el.dataset.tab;render()};
      });
      var icons=shell.querySelector('.mc-bar-icons');
      var body=shell.querySelector('.mc-body');
      // Both Vault and Portfolio sit behind the same master password now, so
      // the lock/settings icons belong to either tab whenever unlocked, not
      // just Vault.
      if((state.tab==='vault'||state.tab==='portfolio')&&state.vaultKey){
        var settingsBtn=document.createElement('button');
        settingsBtn.className='mc-icon-btn';settingsBtn.title=t('mc_settings');settingsBtn.textContent='⚙';
        settingsBtn.onclick=function(){settingsDialog().then(render)};
        var lockBtn=document.createElement('button');
        lockBtn.className='mc-icon-btn';lockBtn.title=t('mc_lock_now');lockBtn.textContent='🔒';
        lockBtn.onclick=lockNow;
        icons.appendChild(settingsBtn);icons.appendChild(lockBtn);
      }
      if(state.tab==='vault'){
        renderVaultGate(body,renderEntryList);
      }else if(state.tab==='portfolio'){
        renderVaultGate(body,renderPortfolioContent);
      }else{
        renderExplorer(body);
      }
    }

    function introBlock(){
      if(localStorage.getItem(INTRO_KEY)==='1')return'';
      return '<div class="mc-intro"><h3>'+esc(t('mc_intro_title'))+'</h3><p style="margin:0">'+esc(t('mc_intro_body'))+'</p>'
        +'<button class="mc-intro-dismiss">'+esc(t('mc_intro_dismiss'))+'</button></div>';
    }
    function wireIntro(container){
      var btn=container.querySelector('.mc-intro-dismiss');
      if(btn)btn.onclick=function(){localStorage.setItem(INTRO_KEY,'1');render()};
    }

    // Shared by both Vault and Portfolio tabs — same master password, same
    // three states (no vault yet / locked / unlocked). Portfolio's own
    // content is zero-knowledge now too, so it needs the exact same gate
    // instead of being reachable without unlocking anything.
    function renderVaultGate(body,contentFn){
      if(!state.vaultStatus){body.innerHTML='<div class="mc-empty">'+esc(t('mc_loading'))+'</div>';return}
      if(!state.vaultStatus.exists){renderSetup(body);return}
      if(!state.vaultKey){renderUnlock(body);return}
      contentFn(body);
    }

    function renderSetup(body,error){
      body.innerHTML=introBlock()
        +'<div class="mc-center"><div>'
        +'<h2>'+esc(t('mc_vault_create_title'))+'</h2><p>'+esc(t('mc_vault_create_info'))+'</p>'
        +'<label>'+esc(t('mc_master_password'))+'</label><input type="password" class="mc-f-pw" autocomplete="new-password">'
        +'<label>'+esc(t('mc_confirm_master_password'))+'</label><input type="password" class="mc-f-pw2" autocomplete="new-password">'
        +'<div class="mc-error">'+esc(error||'')+'</div>'
        +'<button class="primary mc-go">'+esc(t('mc_vault_create_btn'))+'</button>'
        +'</div></div>';
      wireIntro(body);
      var pw=body.querySelector('.mc-f-pw'),pw2=body.querySelector('.mc-f-pw2'),err=body.querySelector('.mc-error');
      body.querySelector('.mc-go').onclick=async function(){
        if(pw.value.length<MIN_MASTER){renderSetup(body,t('mc_password_short',{n:MIN_MASTER}));return}
        if(pw.value!==pw2.value){renderSetup(body,t('mc_passwords_differ'));return}
        try{
          await doVaultSetup(pw.value);
          await cacheVaultKey(localStorage.getItem(DURATION_KEY)||'session');
          render();
        }catch(_){renderSetup(body,t('mc_error_generic'))}
      };
      setTimeout(function(){pw.focus()},30);
    }

    function renderUnlock(body,error){
      var duration=localStorage.getItem(DURATION_KEY)||'session';
      body.innerHTML=introBlock()
        +'<div class="mc-center"><div>'
        +'<h2>'+esc(t('mc_vault_unlock_title'))+'</h2><p>'+esc(t('mc_vault_unlock_info'))+'</p>'
        +'<label>'+esc(t('mc_master_password'))+'</label><input type="password" class="mc-f-pw" autocomplete="current-password">'
        +'<label>'+esc(t('mc_unlock_for'))+'</label>'
        +'<select class="mc-f-duration">'
        +'<option value="1">'+esc(t('mc_minutes',{n:1}))+'</option>'
        +'<option value="5">'+esc(t('mc_minutes',{n:5}))+'</option>'
        +'<option value="15">'+esc(t('mc_minutes',{n:15}))+'</option>'
        +'<option value="60">'+esc(t('mc_hour'))+'</option>'
        +'<option value="session">'+esc(t('mc_until_closed'))+'</option>'
        +'</select>'
        +'<div class="mc-error">'+esc(error||'')+'</div>'
        +'<button class="primary mc-go">'+esc(t('mc_unlock_btn'))+'</button>'
        +'</div></div>';
      wireIntro(body);
      body.querySelector('.mc-f-duration').value=duration;
      var pw=body.querySelector('.mc-f-pw'),select=body.querySelector('.mc-f-duration');
      body.querySelector('.mc-go').onclick=async function(){
        try{
          await doUnlock(pw.value);
          await cacheVaultKey(select.value);
          render();
        }catch(_){renderUnlock(body,t('mc_unlock_failed'))}
      };
      setTimeout(function(){pw.focus()},30);
    }

    // ---- pending shares (incoming transfers awaiting accept) --------------
    async function acceptShareFlow(share){
      var dataKeyBytes;
      try{dataKeyBytes=await ensureDataKey()}catch(_){toast(t('mc_error_generic'));return}
      if(!dataKeyBytes)return; // cancelled
      var ok=await promptPassword(t('mc_accept_share_password_title'),t('mc_accept_share_password_hint'),async function(pw){
        if(!pw)throw{mcMessage:t('mc_reveal_wrong')};
        try{await acceptShare(share.id,pw,dataKeyBytes)}
        catch(_){throw{mcMessage:t('mc_reveal_wrong')}}
        return true;
      });
      if(!state.convenience)state.dataKey=null;
      if(!ok)return;
      toast(t('mc_share_accepted'));
      await loadPendingShares();
      await loadEntries();
      render();
    }

    function pendingSharesBlock(){
      if(!state.pendingShares.length)return document.createTextNode('');
      var wrap=document.createElement('div');
      wrap.className='mc-card';
      var html='<div class="mc-card-title">📥 '+esc(t('mc_pending_shares_title'))+'</div>';
      html+=state.pendingShares.map(function(s){
        var name=(s.source_owner&&(s.source_owner.display_name||s.source_owner.username))||'?';
        return '<div class="mc-card-sub" data-id="'+esc(s.id)+'" style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin-top:.4rem">'
          +'<span>'+esc(t('mc_pending_share_row',{name:name}))+'</span>'
          +'<button class="primary mc-accept-btn" data-id="'+esc(s.id)+'">'+esc(t('mc_accept'))+'</button></div>';
      }).join('');
      wrap.innerHTML=html;
      wrap.querySelectorAll('.mc-accept-btn').forEach(function(btn){
        btn.onclick=function(){
          var share=state.pendingShares.filter(function(s){return s.id===btn.dataset.id})[0];
          if(share)acceptShareFlow(share);
        };
      });
      return wrap;
    }

    function renderEntryList(body){
      body.innerHTML='';
      body.appendChild(htmlToNode(introBlock()));
      wireIntro(body);
      body.appendChild(pendingSharesBlock());
      var addBtn=document.createElement('button');
      addBtn.className='primary mc-add-btn-row';addBtn.textContent=t('mc_add_entry');
      addBtn.onclick=function(){
        entryDialog(null).then(function(res){
          if(!res)return;
          toast(t('mc_save'));
          loadEntries().then(render);
        });
      };
      body.appendChild(addBtn);
      if(!state.entries.length){
        var empty=document.createElement('div');empty.className='mc-empty';empty.textContent=t('mc_entries_empty');
        body.appendChild(empty);
        return;
      }
      state.entries.forEach(function(entry){
        var card=document.createElement('div');card.className='mc-card';
        var badge='<span class="mc-lock" title="'+esc(t('mc_locked_hint'))+'">🔒</span>';
        var sub=t('mc_words_count',{n:entry.word_count});
        if(entry.shares&&entry.shares.length){
          var names=entry.shares.map(function(s){return s.display_name||s.username||s.user_id}).join(', ');
          sub+=' · '+t('mc_shared_with_label',{names:names});
        }
        var actions='<button class="mc-reveal-btn">'+esc(t('mc_reveal'))+'</button>'
          +'<button class="mc-edit-btn">'+esc(t('mc_edit'))+'</button>'
          +'<button class="mc-pw-btn">'+esc(t('mc_change_entry_password_title'))+'</button>'
          +'<button class="mc-share-btn">'+esc(t('mc_manage_sharing'))+'</button>';
        card.innerHTML='<div class="mc-card-head"><span class="mc-card-title">'+badge+esc(entry.label)+'</span></div>'
          +'<div class="mc-card-sub">'+esc(sub)+'</div>'
          +'<div class="mc-card-actions">'+actions+'</div>';
        card.querySelector('.mc-reveal-btn').onclick=function(){revealEntry(entry.id)};
        card.querySelector('.mc-edit-btn').onclick=function(){
          entryDialog(entry).then(function(res){
            if(!res)return;
            loadEntries().then(render);
          });
        };
        card.querySelector('.mc-pw-btn').onclick=function(){changeEntryPasswordDialog(entry).then(function(ok){if(ok){toast(t('mc_change_entry_password_done'));loadEntries().then(render)}})};
        card.querySelector('.mc-share-btn').onclick=function(){manageSharingDialog(entry)};
        body.appendChild(card);
      });
    }

    function htmlToNode(html){var d=document.createElement('div');d.innerHTML=html;return d.firstElementChild||document.createTextNode('')}

    function renderPortfolioContent(body){
      var p=state.portfolio;
      if(!p){body.innerHTML='<div class="mc-empty">'+esc(t('mc_loading'))+'</div>';return}
      var networkOptions=Object.keys(_NETWORK_LABELS).map(function(code){
        return '<option value="'+esc(code)+'">'+esc(_NETWORK_LABELS[code])+'</option>';
      }).join('');
      var totalUsd=portfolioTotalUsd();
      var html='<div class="mc-card">'
        +'<label>'+esc(t('mc_network_field'))+'</label><select class="mc-network-select">'+networkOptions+'</select>'
        +'<label>'+esc(t('mc_address_field'))+'</label><input class="mc-addr-input" placeholder="'+esc(t('mc_address_placeholder'))+'">'
        +'<div class="mc-token-block" hidden>'
        +'<label>'+esc(t('mc_token_contract_field'))+'</label><input class="mc-token-input" placeholder="'+esc(t('mc_token_contract_placeholder'))+'">'
        +'</div>'
        +'<label>'+esc(t('mc_portfolio_label_field'))+'</label><input class="mc-label-input" placeholder="'+esc(t('mc_portfolio_label_placeholder'))+'">'
        +'<div class="mc-error mc-add-error"></div>'
        +'<button class="primary mc-add-btn" style="width:100%">'+esc(t('mc_add_address'))+'</button>'
        +'</div>'
        +'<div class="mc-totals">'
        +'<div>'+esc(t('mc_total_usd'))+': <b>'+(totalUsd!=null?esc(fmtUsd(totalUsd)):esc(t('mc_price_unavailable')))+'</b></div>'
        +'<button class="mc-refresh-btn">'+esc(t('mc_refresh'))+'</button>'
        +'</div>';
      // Premium: custom assets outside the supported networks. The desktop
      // SDK's premiumGate is the only reliable "is this really the desktop"
      // signal (a public page also gets a window.mvmOS, just without this
      // one function) — see password-manager-widget.js for the identical
      // pattern. Desktop always shows the button (unlicensed, the click
      // opens the subscription modal instead of doing anything); anywhere
      // else it only appears when this installation is actually licensed —
      // there is nothing to sell a public-page visitor.
      var isDesktop=!!(window.mvmOS&&window.mvmOS.premiumGate);
      if(isDesktop||p.custom_assets_enabled){
        html+='<button class="mc-custom-asset-add" style="width:100%;margin-bottom:.7rem">'+esc(t('mc_custom_assets_add'))+'</button>';
      }
      if(!p.addresses.length&&!p.customAssets.length){
        html+='<div class="mc-empty">'+esc(t('mc_portfolio_empty'))+'</div>';
      }else{
        html+=p.customAssets.map(function(a){
          return '<div class="mc-card" data-id="'+esc(a.id)+'" data-custom="1" data-name="'+esc(a.name)+'">'
            +'<div class="mc-card-head"><span class="mc-card-title">💼 '+esc(a.name)+'</span>'
            +'<span style="display:flex;gap:.3rem">'
            +'<button class="mc-icon-btn mc-custom-ledger-btn" title="'+esc(t('mc_custom_ledger_open_title'))+'">🔍</button>'
            +'<button class="mc-icon-btn mc-addr-del" title="'+esc(t('mc_delete'))+'">🗑</button>'
            +'</span></div>'
            +'<div class="mc-card-sub"><b>'+esc(fmtUsd(a.balance_usd))+'</b></div>'
            +'</div>';
        }).join('');
        html+=p.addresses.map(function(a){
          var network=_NETWORKS[a.coin];
          var decimals=a.token_contract?(a.token_decimals!=null?a.token_decimals:18):(network?network.decimals:8);
          var symbol=a.token_symbol||a.coin;
          var amount=a.balance_units!=null?a.balance_units/Math.pow(10,decimals):null;
          var price=a.token_contract?a.tokenPriceUsd:p.prices[a.coin];
          var usd=(amount!=null&&price!=null)?amount*price:null;
          var balanceText=amount!=null?fmtAmount(amount)+' '+symbol:t('mc_balance_unknown');
          var usdText=usd!=null?' ('+fmtUsd(usd)+')':'';
          var updatedText=a.last_updated?t('mc_last_updated',{time:fmtTime(a.last_updated)}):t('mc_never_updated');
          var networkBadge='<span class="mc-hint" style="margin-right:.3rem">'+esc(_NETWORK_LABELS[a.coin]||a.coin)+'</span>';
          return '<div class="mc-card" data-id="'+esc(a.id)+'" data-address="'+esc(a.address)+'" data-network="'+esc(a.coin)+'">'
            +'<div class="mc-card-head"><span class="mc-card-title">'+esc(a.label||a.address)+'</span>'
            +'<span style="display:flex;gap:.3rem">'
            +'<button class="mc-icon-btn mc-addr-explore" title="'+esc(t('mc_explorer_open_title'))+'">🔍</button>'
            +'<button class="mc-icon-btn mc-addr-del" title="'+esc(t('mc_delete'))+'">🗑</button>'
            +'</span></div>'
            +'<div class="mc-card-sub">'+networkBadge+'<span style="overflow-wrap:anywhere">'+esc(a.address)+'</span></div>'
            +'<div class="mc-card-sub"><b>'+esc(balanceText)+'</b>'+esc(usdText)+'</div>'
            +'<div class="mc-card-sub">'+esc(updatedText)+'</div>'
            +'</div>';
        }).join('');
      }
      body.innerHTML=html;
      var networkSelect=body.querySelector('.mc-network-select'),tokenBlock=body.querySelector('.mc-token-block'),
          tokenInput=body.querySelector('.mc-token-input'),
          addrInput=body.querySelector('.mc-addr-input'),labelInput=body.querySelector('.mc-label-input'),addErr=body.querySelector('.mc-add-error');
      function syncNetworkFields(){
        var net=networkSelect.value;
        tokenBlock.hidden=!_EVM_NETWORKS[net];
        if(tokenBlock.hidden)tokenInput.value='';
        addrInput.placeholder=net==='BTC'?t('mc_address_placeholder'):(_ADDR_PLACEHOLDERS[net]||'');
      }
      networkSelect.onchange=syncNetworkFields;
      syncNetworkFields();
      body.querySelector('.mc-add-btn').onclick=async function(){
        addErr.textContent='';
        var addBtn=body.querySelector('.mc-add-btn');
        addBtn.disabled=true;
        var result=await addAddress(addrInput.value.trim(),labelInput.value.trim(),networkSelect.value,tokenInput.value.trim());
        if(!result.ok){addBtn.disabled=false;addErr.textContent=result.error;return}
        addBtn.textContent=t('mc_refreshing');
        // Fetch the new address's balance right away instead of leaving it
        // at 0 until the user hits Refresh manually.
        await loadPortfolio();
        await refreshPortfolio();
        render();
      };
      body.querySelector('.mc-refresh-btn').onclick=async function(){
        var btn=body.querySelector('.mc-refresh-btn');
        btn.disabled=true;btn.textContent=t('mc_refreshing');
        try{await refreshPortfolio()}catch(_){toast(t('mc_error_generic'))}
        render();
      };
      var customAddBtn=body.querySelector('.mc-custom-asset-add');
      if(customAddBtn){
        customAddBtn.onclick=function(){openCustomAssetDialog()};
        // Re-checked live on every click by premiumGate itself, so this stays
        // correct even if the licence changed since this tab was drawn.
        if(isDesktop)window.mvmOS.premiumGate(customAddBtn,t('mc_custom_assets_premium_info'));
      }
      body.querySelectorAll('.mc-addr-del').forEach(function(delBtn){
        delBtn.onclick=async function(){
          var card=delBtn.closest('.mc-card');
          if(card.dataset.custom){
            if(!window.confirm(t('mc_custom_asset_delete_confirm')))return;
            try{await api('/custom-assets/'+card.dataset.id,{method:'DELETE'});await loadPortfolio();render()}catch(_){toast(t('mc_error_generic'))}
            return;
          }
          if(!window.confirm(t('mc_delete_address_confirm')))return;
          try{await api('/addresses/'+card.dataset.id,{method:'DELETE'});await loadPortfolio();render()}catch(_){toast(t('mc_error_generic'))}
        };
      });
      body.querySelectorAll('.mc-addr-explore').forEach(function(exploreBtn){
        exploreBtn.onclick=function(){
          var card=exploreBtn.closest('.mc-card'),address=card.dataset.address,network=card.dataset.network;
          // Only a plain BTC row (no token) gets the in-app Explorer tab —
          // everything else opens that network's own public explorer.
          if(network==='BTC'){
            state.tab='explorer';
            state.explorer={query:address,result:null,loading:true,error:'',fromAddress:null};
            render();
            runExplorerSearch(address);
          }else{
            var urlFn=_EXPLORER_URLS[network];
            if(urlFn)window.open(urlFn(address),'_blank');
          }
        };
      });
      body.querySelectorAll('.mc-custom-ledger-btn').forEach(function(btn){
        btn.onclick=function(){
          var card=btn.closest('.mc-card');
          openCustomLedger(card.dataset.id,card.dataset.name);
        };
      });
    }

    // ---- custom assets (premium) --------------------------------------------
    function openCustomAssetDialog(){
      var overlay=openModal(
        '<h3>'+esc(t('mc_custom_assets_add'))+'</h3>'
        +'<label>'+esc(t('mc_custom_asset_name_field'))+'</label><input class="mc-custom-name-input">'
        +'<div class="mc-error mc-custom-name-error"></div>'
        +'<div class="mc-actions">'
        +'<button class="primary mc-custom-name-save">'+esc(t('mc_custom_asset_create'))+'</button>'
        +'<button class="mc-custom-name-cancel">'+esc(t('mc_cancel'))+'</button>'
        +'</div>'
      );
      var input=overlay.querySelector('.mc-custom-name-input'),err=overlay.querySelector('.mc-custom-name-error');
      overlay.querySelector('.mc-custom-name-cancel').onclick=function(){closeModal(overlay)};
      overlay.querySelector('.mc-custom-name-save').onclick=async function(){
        var name=input.value.trim();
        if(!name){err.textContent=t('mc_entry_required');return}
        try{
          var enc=await encryptJSON(state.vaultKey,{name:name});
          await api('/custom-assets',{method:'POST',body:JSON.stringify(enc)});
          closeModal(overlay);
          await loadPortfolio();render();
        }catch(_){err.textContent=t('mc_error_generic')}
      };
    }

    function fmtSignedUsd(n){return (n>=0?'+':'')+fmtUsd(n)}

    async function openCustomLedger(assetId,assetName){
      var overlay=openModal(
        '<h3>'+esc(t('mc_custom_ledger_title',{name:assetName}))+'</h3>'
        +'<div class="mc-custom-txn-list"><div class="mc-empty">'+esc(t('mc_loading'))+'</div></div>'
        +'<div class="mc-card">'
        +'<label>'+esc(t('mc_custom_txn_amount_field'))+'</label><input class="mc-txn-amount-input" type="number" step="0.01" placeholder="10 / -5">'
        +'<label>'+esc(t('mc_custom_txn_note_field'))+'</label><input class="mc-txn-note-input">'
        +'<div class="mc-error mc-txn-error"></div>'
        +'<button class="primary mc-txn-add-btn" style="width:100%">'+esc(t('mc_custom_txn_add'))+'</button>'
        +'</div>'
        +'<div class="mc-actions"><button class="mc-ledger-close">'+esc(t('mc_close'))+'</button></div>'
      );
      var listBox=overlay.querySelector('.mc-custom-txn-list');
      overlay.querySelector('.mc-ledger-close').onclick=async function(){closeModal(overlay);await loadPortfolio();render()};
      async function refreshList(){
        var rows;
        try{rows=await api('/custom-assets/'+assetId+'/transactions')}catch(_){listBox.innerHTML='<div class="mc-empty">'+esc(t('mc_error_generic'))+'</div>';return}
        var txns=[];
        for(var i=0;i<rows.length;i++){
          var row=rows[i];
          try{
            var plain=row.legacy?await migrateLegacyTxn(assetId,row):await decryptJSON(state.vaultKey,row.iv,row.ciphertext);
            txns.push({id:row.id,amount_usd:Number(plain.amount_usd)||0,note:plain.note||'',created_at:row.created_at});
          }catch(_){/* skip rows this vaultKey cannot open */}
        }
        if(!txns.length){listBox.innerHTML='<div class="mc-empty">'+esc(t('mc_custom_txn_empty'))+'</div>';return}
        listBox.innerHTML=txns.map(function(txn){
          var color=txn.amount_usd>=0?'var(--pub-green,#a6e3a1)':'var(--pub-red,#f38ba8)';
          return '<div class="mc-card mc-txn-row" data-id="'+esc(txn.id)+'" data-amount="'+esc(txn.amount_usd)+'" data-note="'+esc(txn.note)+'">'
            +'<div class="mc-card-head"><span class="mc-card-title" style="color:'+color+'">'+esc(fmtSignedUsd(txn.amount_usd))+'</span>'
            +'<span style="display:flex;gap:.3rem">'
            +'<button class="mc-icon-btn mc-txn-edit" title="'+esc(t('mc_custom_txn_edit'))+'">✏️</button>'
            +'<button class="mc-icon-btn mc-txn-delete" title="'+esc(t('mc_delete'))+'">🗑</button>'
            +'</span></div>'
            +(txn.note?'<div class="mc-card-sub">'+esc(txn.note)+'</div>':'')
            +'<div class="mc-card-sub">'+esc(fmtTime(txn.created_at))+'</div>'
            +'</div>';
        }).join('');
        listBox.querySelectorAll('.mc-txn-delete').forEach(function(delBtn){
          delBtn.onclick=async function(){
            if(!window.confirm(t('mc_custom_txn_delete_confirm')))return;
            var id=delBtn.closest('.mc-txn-row').dataset.id;
            try{await api('/custom-assets/'+assetId+'/transactions/'+id,{method:'DELETE'});await refreshList()}catch(_){toast(t('mc_error_generic'))}
          };
        });
        listBox.querySelectorAll('.mc-txn-edit').forEach(function(editBtn){
          editBtn.onclick=function(){
            var row=editBtn.closest('.mc-txn-row'),id=row.dataset.id;
            row.innerHTML='<label>'+esc(t('mc_custom_txn_amount_field'))+'</label><input class="mc-edit-amount" type="number" step="0.01" value="'+esc(row.dataset.amount)+'">'
              +'<label>'+esc(t('mc_custom_txn_note_field'))+'</label><input class="mc-edit-note" value="'+esc(row.dataset.note)+'">'
              +'<div class="mc-error mc-edit-error"></div>'
              +'<div class="mc-actions">'
              +'<button class="primary mc-edit-save">'+esc(t('mc_save'))+'</button>'
              +'<button class="mc-edit-cancel">'+esc(t('mc_cancel'))+'</button>'
              +'</div>';
            row.querySelector('.mc-edit-cancel').onclick=refreshList;
            row.querySelector('.mc-edit-save').onclick=async function(){
              var amount=parseFloat(row.querySelector('.mc-edit-amount').value);
              var note=row.querySelector('.mc-edit-note').value.trim();
              if(!isFinite(amount)){row.querySelector('.mc-edit-error').textContent=t('mc_entry_required');return}
              try{
                var enc=await encryptJSON(state.vaultKey,{amount_usd:amount,note:note});
                await api('/custom-assets/'+assetId+'/transactions/'+id,{method:'PUT',body:JSON.stringify(enc)});
                await refreshList();
              }catch(_){row.querySelector('.mc-edit-error').textContent=t('mc_error_generic')}
            };
          };
        });
      }
      overlay.querySelector('.mc-txn-add-btn').onclick=async function(){
        var amountInput=overlay.querySelector('.mc-txn-amount-input'),noteInput=overlay.querySelector('.mc-txn-note-input'),err=overlay.querySelector('.mc-txn-error');
        var amount=parseFloat(amountInput.value);
        if(!isFinite(amount)){err.textContent=t('mc_entry_required');return}
        err.textContent='';
        try{
          var enc=await encryptJSON(state.vaultKey,{amount_usd:amount,note:noteInput.value.trim()});
          await api('/custom-assets/'+assetId+'/transactions',{method:'POST',body:JSON.stringify(enc)});
          amountInput.value='';noteInput.value='';
          await refreshList();
        }catch(_){err.textContent=t('mc_error_generic')}
      };
      await refreshList();
    }

    // ---- explorer -----------------------------------------------------------
    // Public blockchain lookup — any address or txid, not just ones saved to
    // the portfolio. No vault/unlock gate, same as Portfolio: nothing here
    // is a secret.
    function looksLikeAddress(v){
      var a=(v||'').trim();
      return a.length>=26&&a.length<=90&&/^[A-Za-z0-9]+$/.test(a)&&(a.charAt(0)==='1'||a.charAt(0)==='3'||a.toLowerCase().indexOf('bc1')===0);
    }
    function looksLikeTxid(v){return /^[0-9a-fA-F]{64}$/.test((v||'').trim())}
    function truncMiddle(s,head,tail){s=s||'';return s.length<=head+tail+1?s:s.slice(0,head)+'…'+s.slice(-tail)}
    function fmtSat(sat){return sat==null?t('mc_balance_unknown'):fmtBtc(sat/1e8)+' BTC'}

    async function runExplorerSearch(query){
      query=(query||'').trim();
      if(!query){return}
      state.explorer.query=query;state.explorer.loading=true;state.explorer.error='';state.explorer.fromAddress=null;
      renderExplorerBody();
      try{
        if(looksLikeTxid(query)){
          var tx=await api('/explorer/tx/'+query);
          state.explorer.result={type:'tx',data:tx};
        }else if(looksLikeAddress(query)){
          var addr=await api('/explorer/address/'+query);
          state.explorer.result={type:'address',data:addr};
        }else{
          state.explorer.error=t('mc_explorer_invalid_input');state.explorer.result=null;
        }
      }catch(_){
        state.explorer.error=t('mc_error_generic');state.explorer.result=null;
      }
      state.explorer.loading=false;
      renderExplorerBody();
    }

    async function openExplorerTx(txid,fromAddress){
      state.explorer.loading=true;state.explorer.error='';
      renderExplorerBody();
      try{
        var tx=await api('/explorer/tx/'+txid);
        state.explorer.result={type:'tx',data:tx};
        state.explorer.fromAddress=fromAddress||null;
      }catch(_){
        state.explorer.error=t('mc_error_generic');
      }
      state.explorer.loading=false;
      renderExplorerBody();
    }

    async function loadMoreExplorerTxs(address,beforeTxid){
      var box=shell.querySelector('.mc-explorer-loadmore');
      if(box){box.disabled=true;box.textContent=t('mc_refreshing')}
      try{
        var more=await api('/explorer/address/'+address+'/txs?before='+beforeTxid);
        state.explorer.result.data.txs=state.explorer.result.data.txs.concat(more.txs);
        state.explorer.result.data.has_more=more.has_more;
      }catch(_){toast(t('mc_error_generic'))}
      renderExplorerBody();
    }

    function explorerTxRow(row,address){
      var sign=row.delta_sat>0?'+':'';
      var color=row.delta_sat>0?'var(--pub-green,#a6e3a1)':'var(--pub-red,#f38ba8)';
      var statusText=row.confirmed?t('mc_explorer_confirmed'):t('mc_explorer_unconfirmed');
      return '<div class="mc-card mc-explorer-tx-row" data-txid="'+esc(row.txid)+'" style="cursor:pointer">'
        +'<div class="mc-card-head"><span class="mc-card-title">'+(row.delta_sat>0?'⬇️':'⬆️')+' <span style="color:'+color+'">'+esc(sign+fmtBtc(row.delta_sat/1e8))+' BTC</span></span>'
        +'<span class="mc-card-sub">'+esc(statusText)+'</span></div>'
        +'<div class="mc-card-sub" style="overflow-wrap:anywhere">'+esc(truncMiddle(row.txid,10,10))+'</div>'
        +'<div class="mc-card-sub">'+esc(row.block_time?fmtTime(row.block_time):'')+'</div>'
        +'</div>';
    }

    function explorerAddressResultHtml(data){
      var html='<div class="mc-card">'
        +'<div class="mc-card-sub" style="overflow-wrap:anywhere">'+esc(data.address)+'</div>'
        +'<div class="mc-totals" style="margin:.5rem 0 0">'
        +'<div>'+esc(t('mc_explorer_balance'))+': <b>'+esc(fmtSat(data.balance_sat))+'</b></div>'
        +'</div>'
        +'<div class="mc-card-sub">'+esc(t('mc_explorer_received'))+': '+esc(fmtSat(data.total_received_sat))+'</div>'
        +'<div class="mc-card-sub">'+esc(t('mc_explorer_sent'))+': '+esc(fmtSat(data.total_sent_sat))+'</div>'
        +'<div class="mc-card-sub">'+esc(t('mc_explorer_tx_count'))+': '+esc(data.tx_count)+'</div>'
        +'</div>';
      if(!data.txs.length){
        html+='<div class="mc-empty">'+esc(t('mc_explorer_no_txs'))+'</div>';
      }else{
        html+=data.txs.map(function(row){return explorerTxRow(row,data.address)}).join('');
        if(data.has_more)html+='<button class="mc-explorer-loadmore" style="width:100%">'+esc(t('mc_explorer_load_more'))+'</button>';
      }
      return html;
    }

    function explorerTxResultHtml(data,fromAddress){
      var statusText=data.confirmed?t('mc_explorer_confirmed')+(data.block_height?' · '+t('mc_explorer_block',{n:data.block_height}):''):t('mc_explorer_unconfirmed');
      var html='';
      if(fromAddress)html+='<button class="mc-explorer-back" style="margin-bottom:.5rem">← '+esc(t('mc_explorer_back_to_address'))+'</button>';
      html+='<div class="mc-card">'
        +'<div class="mc-card-sub" style="overflow-wrap:anywhere"><b>'+esc(truncMiddle(data.txid,14,14))+'</b></div>'
        +'<div class="mc-card-sub">'+esc(statusText)+(data.block_time?' · '+esc(fmtTime(data.block_time)):'')+'</div>'
        +'<div class="mc-card-sub">'+esc(t('mc_explorer_fee'))+': '+esc(fmtSat(data.fee_sat))+' · '+esc(t('mc_explorer_size'))+': '+esc(data.size)+' B</div>'
        +'</div>';
      function side(title,list){
        var rows=list.map(function(v){
          var label=v.coinbase?t('mc_explorer_coinbase'):esc(truncMiddle(v.address||'',8,8));
          return '<div class="mc-card-sub" style="display:flex;justify-content:space-between;gap:.5rem;overflow-wrap:anywhere">'
            +'<span>'+label+'</span><span>'+esc(fmtSat(v.value_sat))+'</span></div>';
        }).join('');
        return '<div class="mc-card"><div class="mc-card-title" style="margin-bottom:.3rem">'+esc(title)+'</div>'+rows+'</div>';
      }
      html+=side(t('mc_explorer_inputs'),data.vin);
      html+=side(t('mc_explorer_outputs'),data.vout);
      return html;
    }

    function renderExplorerBody(){
      var body=shell.querySelector('.mc-body');
      if(!body)return;
      var e=state.explorer;
      var html='<div class="mc-card">'
        +'<label>'+esc(t('mc_explorer_placeholder'))+'</label>'
        +'<input class="mc-explorer-input" value="'+esc(e.query)+'" placeholder="'+esc(t('mc_explorer_placeholder'))+'">'
        +'<div class="mc-error mc-explorer-error">'+esc(e.error)+'</div>'
        +'<button class="primary mc-explorer-search" style="width:100%">'+esc(t('mc_explorer_search'))+'</button>'
        +'</div>';
      if(e.loading){
        html+='<div class="mc-empty">'+esc(t('mc_loading'))+'</div>';
      }else if(e.result&&e.result.type==='address'){
        html+=explorerAddressResultHtml(e.result.data);
      }else if(e.result&&e.result.type==='tx'){
        html+=explorerTxResultHtml(e.result.data,e.fromAddress);
      }
      body.innerHTML=html;
      var input=body.querySelector('.mc-explorer-input');
      function doSearch(){runExplorerSearch(input.value)}
      body.querySelector('.mc-explorer-search').onclick=doSearch;
      input.onkeydown=function(ev){if(ev.key==='Enter')doSearch()};
      body.querySelectorAll('.mc-explorer-tx-row').forEach(function(row){
        row.onclick=function(){
          var addr=(e.result&&e.result.type==='address')?e.result.data.address:null;
          openExplorerTx(row.dataset.txid,addr);
        };
      });
      var backBtn=body.querySelector('.mc-explorer-back');
      if(backBtn)backBtn.onclick=function(){runExplorerSearch(e.fromAddress)};
      var loadMoreBtn=body.querySelector('.mc-explorer-loadmore');
      if(loadMoreBtn){
        loadMoreBtn.onclick=function(){
          var txs=e.result.data.txs;
          loadMoreExplorerTxs(e.result.data.address,txs[txs.length-1].txid);
        };
      }
    }

    function renderExplorer(body){
      renderExplorerBody();
    }

    // ---- boot ---------------------------------------------------------------
    function onVisible(){if(document.hidden||!state.vaultKey)return;var saved=readVaultSession();if(saved&&saved.minutes)scheduleAutoLock(expiry(saved.minutes))}
    document.addEventListener('visibilitychange',onVisible);

    async function boot(){
      shell.innerHTML='<div class="mc-empty">'+esc(t('mc_loading'))+'</div>';
      try{
        await restoreVaultKey();
        await loadVaultStatus();
        if(state.vaultKey){
          try{await loadEntries()}catch(_){state.vaultKey=null}
          if(state.vaultKey){
            await loadPendingShares();
            // Portfolio is vaultKey-encrypted now too — nothing to load
            // before the vault unlocks (a session already unlocked earlier
            // gets it right away instead of waiting for the Portfolio tab).
            await loadPortfolio();
          }
        }
      }catch(_){
        shell.innerHTML='<div class="mc-empty">'+esc(t('mc_load_error'))+'</div>';
        return;
      }
      render();
    }
    boot();

    return{
      destroy:function(){
        state.destroyed=true;
        clearTimeout(state.autoLockTimer);
        document.removeEventListener('visibilitychange',onVisible);
      }
    };
  }

  window.MvmCryptoWidget={mount:mount};
})();
