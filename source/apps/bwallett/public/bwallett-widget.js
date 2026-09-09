(function(){
  if(window.BwalletTWidget)return;
  var API='/pub/bwallett',ITERATIONS=600000,MIN_PASSWORD=10,SATS=100000000;

  function t(k,v){return(window.t||function(x){return x})(k,v)}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function b64(value){var s='';new Uint8Array(value).forEach(function(x){s+=String.fromCharCode(x)});return btoa(s)}
  function bytes(value){var raw=atob(value),out=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
  function fmtSats(value){return(Number(value||0)/SATS).toFixed(8)+' BTC'}
  function short(value,n){value=String(value||'');n=n||8;return value.length>n*2+3?value.slice(0,n)+'…'+value.slice(-n):value}
  function fmtTime(seconds){if(!seconds)return'';try{return new Date(seconds*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}catch(_){return''}}
  function satsFromBtc(value,allowZero){
    var s=String(value||'').trim();
    if(!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(s))return null;
    var parts=s.split('.'),whole=BigInt(parts[0]),frac=(parts[1]||'').padEnd(8,'0');
    var result=whole*100000000n+BigInt(frac||'0');
    return result>=(allowZero?0n:1n)&&result<=BigInt(Number.MAX_SAFE_INTEGER)?Number(result):null;
  }

  async function deriveKey(password,salt,iterations){
    var material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function encryptDoc(key,doc){
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key,new TextEncoder().encode(JSON.stringify(doc)));
    return{iv:b64(iv),ciphertext:b64(ct)};
  }
  async function decryptDoc(key,iv,ciphertext){
    var plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},key,bytes(ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  var styled=false;
  function addStyles(){
    if(styled)return;styled=true;
    var s=document.createElement('style');
    s.textContent='.bw,.bw *,.bw-overlay,.bw-overlay *{box-sizing:border-box}.bw{height:100%;display:flex;flex-direction:column;position:relative;overflow:hidden;background:var(--pub-bg,#07111f);color:var(--pub-fg,#e8f0fa);font-family:Inter,system-ui,sans-serif}.bw button,.bw input,.bw textarea,.bw select,.bw-overlay button,.bw-overlay input,.bw-overlay textarea{font:inherit}.bw button,.bw-overlay button{border:0;border-radius:10px;padding:.62rem .85rem;font-size:.8rem;font-weight:700;cursor:pointer;background:var(--pub-surface2,#14243a);color:var(--pub-fg,#e8f0fa)}.bw button:hover,.bw-overlay button:hover{filter:brightness(1.15)}.bw button:disabled,.bw-overlay button:disabled{opacity:.5;cursor:not-allowed}.bw .primary,.bw-overlay .primary{background:var(--pub-accent,#f59e0b);color:#111827}.bw .danger,.bw-overlay .danger{background:#7f1d1d;color:#fee2e2}.bw input,.bw textarea,.bw select,.bw-overlay input,.bw-overlay textarea{width:100%;border:1px solid var(--pub-border,#29415f);border-radius:10px;background:var(--pub-surface,#0d1b2d);color:var(--pub-fg,#e8f0fa);padding:.7rem .75rem;outline:none}.bw input:focus,.bw textarea:focus,.bw select:focus,.bw-overlay input:focus,.bw-overlay textarea:focus{border-color:var(--pub-accent,#f59e0b)}.bw label,.bw-overlay label{display:block;margin:.75rem 0 .28rem;font-size:.73rem;font-weight:800;color:var(--pub-fg2,#9fb1c8)}.bw-header{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 1rem;border-bottom:1px solid var(--pub-border,#203650);background:linear-gradient(120deg,var(--pub-surface,#0d1b2d),var(--pub-bg,#07111f))}.bw-brand{display:flex;align-items:center;gap:.58rem;font-weight:900;cursor:pointer}.bw-logo{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:#f59e0b;color:#111827;font-size:1.18rem}.bw-head-actions{display:flex;gap:.38rem}.bw-icon{width:34px;height:34px;padding:0!important;display:grid;place-items:center}.bw-nav{display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--pub-border,#203650);background:var(--pub-surface,#0d1b2d);order:3}.bw-nav button{background:transparent;border-radius:0;padding:.65rem .25rem;color:var(--pub-fg2,#9fb1c8);font-size:.69rem}.bw-nav button.active{color:var(--pub-accent,#f59e0b);box-shadow:inset 0 2px var(--pub-accent,#f59e0b)}.bw-main{flex:1;min-height:0;overflow:auto;padding:1rem}.bw-center{height:100%;display:grid;place-items:center;padding:1rem}.bw-panel{width:100%;max-width:420px;border:1px solid var(--pub-border,#203650);border-radius:20px;padding:1.35rem;background:var(--pub-surface,#0d1b2d);box-shadow:0 20px 55px rgba(0,0,0,.25)}.bw-panel h2{font-size:1.2rem;margin:0 0 .45rem}.bw-panel p{font-size:.82rem;line-height:1.55;color:var(--pub-fg2,#9fb1c8)}.bw-actions{display:flex;gap:.55rem;flex-wrap:wrap;margin-top:1rem}.bw-actions>*{flex:1}.bw-error{min-height:1.15rem;margin-top:.45rem;color:#fb7185;font-size:.76rem}.bw-balance{background:radial-gradient(circle at 90% 10%,rgba(245,158,11,.23),transparent 40%),linear-gradient(135deg,#132842,#0b1828);border:1px solid #29415f;border-radius:20px;padding:1.2rem;margin-bottom:.9rem}.bw-balance-label{font-size:.74rem;color:#9fb1c8;font-weight:700}.bw-balance-value{font-size:1.8rem;font-weight:900;margin:.2rem 0 .6rem;letter-spacing:-.04em}.bw-balance-meta{display:flex;gap:1rem;font-size:.72rem;color:#9fb1c8}.bw-balance-meta b{display:block;color:#e8f0fa;font-size:.8rem;margin-top:.1rem}.bw-quick{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-bottom:1rem}.bw-quick button{padding:.8rem}.bw-section-title{display:flex;align-items:center;justify-content:space-between;margin:.2rem 0 .6rem;font-size:.84rem;font-weight:900}.bw-card{border:1px solid var(--pub-border,#203650);border-radius:14px;background:var(--pub-surface,#0d1b2d);padding:.8rem;margin-bottom:.55rem}.bw-row{display:flex;justify-content:space-between;align-items:center;gap:.7rem}.bw-muted{color:var(--pub-fg2,#9fb1c8);font-size:.74rem}.bw-mono{font-family:ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.bw-empty{text-align:center;padding:2rem 1rem;color:var(--pub-fg2,#9fb1c8);font-size:.82rem}.bw-status{font-size:.67rem;font-weight:800;border-radius:99px;padding:.2rem .42rem;background:#163c33;color:#6ee7b7}.bw-status.pending{background:#4a3412;color:#fcd34d}.bw-amount{font-weight:900}.bw-amount.in{color:#6ee7b7}.bw-amount.out{color:#fda4af}.bw-address-box{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.8rem;line-height:1.5;overflow-wrap:anywhere;border:1px dashed var(--pub-border,#29415f);border-radius:12px;padding:.75rem;background:var(--pub-bg,#07111f)}.bw-qr{display:block;width:210px;height:210px;max-width:100%;margin:1rem auto;border-radius:12px;background:white;padding:7px}.bw-form{max-width:480px;margin:0 auto}.bw-fees{display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem;margin:.35rem 0}.bw-fees button{padding:.58rem .25rem;font-size:.7rem}.bw-fees button.active{outline:2px solid var(--pub-accent,#f59e0b)}.bw-note{font-size:.72rem;line-height:1.45;color:var(--pub-fg2,#9fb1c8);border-left:3px solid var(--pub-accent,#f59e0b);padding-left:.6rem;margin:.8rem 0}.bw-overlay{position:absolute;inset:0;z-index:20;display:grid;place-items:center;padding:1rem;background:rgba(1,7,15,.76);color:var(--pub-fg,#e8f0fa);font-family:Inter,system-ui,sans-serif;overflow:auto}.bw-dialog{width:100%;max-width:440px;max-height:100%;overflow:auto;border:1px solid var(--pub-border,#29415f);border-radius:18px;padding:1.15rem;background:var(--pub-bg,#07111f);box-shadow:0 24px 70px rgba(0,0,0,.55)}.bw-dialog h3{margin:0 0 .4rem}.bw-dialog p{font-size:.8rem;line-height:1.5;color:var(--pub-fg2,#9fb1c8)}.bw-phrase{font-family:ui-monospace,SFMono-Regular,monospace;line-height:1.8;border:1px solid var(--pub-border,#29415f);background:var(--pub-surface,#0d1b2d);border-radius:12px;padding:.85rem;overflow-wrap:anywhere;filter:blur(5px);user-select:none}.bw-phrase.show{filter:none;user-select:text}.bw-check{display:flex!important;align-items:flex-start;gap:.5rem;font-weight:600!important;line-height:1.35}.bw-check input{width:auto!important;margin-top:.15rem}.bw-toast{position:absolute;z-index:40;left:50%;bottom:4rem;transform:translateX(-50%);padding:.6rem .9rem;border:1px solid var(--pub-border,#29415f);border-radius:10px;background:var(--pub-surface2,#14243a);font-size:.76rem;box-shadow:0 10px 30px rgba(0,0,0,.4)}.bw-search{display:flex;gap:.45rem}.bw-search input{margin:0}.bw-search button{flex:0 0 auto}.bw-kv{display:grid;grid-template-columns:auto 1fr;gap:.45rem .8rem;font-size:.76rem;margin-top:.7rem}.bw-kv span:nth-child(odd){color:var(--pub-fg2,#9fb1c8)}@media(min-width:700px){.bw-nav{order:0;border-top:0;border-bottom:1px solid var(--pub-border,#203650)}.bw-main{padding:1.25rem}}';
    document.head.appendChild(s);
  }

  function mount(root,opts){
    opts=opts||{};addStyles();
    var token=localStorage.getItem('apphub_token');
    if(!token){root.innerHTML='<div class="bw"><div class="bw-empty">'+esc(t('tw_login'))+'</div></div>';if(opts.onNeedLogin)opts.onNeedLogin();return{destroy:function(){}}}
    var state={remote:null,key:null,doc:null,view:'home',sync:null,fees:null,policy:{min_send_sats:0,max_send_sats:0},busy:false,destroyed:false};
    root.style.position='relative';root.innerHTML='<div class="bw"></div>';var shell=root.querySelector('.bw');

    function api(path,options){
      options=options||{};
      var headers=Object.assign({'X-Pub-Token':token,'Content-Type':'application/json'},options.headers||{});
      return fetch(API+path,Object.assign({},options,{headers:headers})).then(async function(r){
        var data=await r.json().catch(function(){return{}});
        if(r.status===401&&opts.onNeedLogin)opts.onNeedLogin();
        if(!r.ok){var e=new Error(data.error||'error');e.code=data.error;e.detail=data.detail;e.limit_sats=data.limit_sats;throw e}
        return data;
      });
    }
    function toast(message){var el=document.createElement('div');el.className='bw-toast';el.textContent=message;shell.appendChild(el);setTimeout(function(){if(el.parentNode)el.remove()},2400)}
    function modal(html){var o=document.createElement('div');o.className='bw-overlay';o.innerHTML='<div class="bw-dialog">'+html+'</div>';shell.appendChild(o);return o}
    function closeModal(o){if(o&&o.parentNode)o.remove()}
    function copy(value){if(navigator.clipboard)navigator.clipboard.writeText(value).then(function(){toast(t('tw_copied'))})}
    function allAddressRefs(doc){
      var refs=[],i;
      for(i=0;i<=doc.receive_index;i++)refs.push({address:BwalletTCrypto.deriveAddress(doc.mnemonic,0,i),branch:0,address_index:i});
      for(i=0;i<=doc.change_index;i++)refs.push({address:BwalletTCrypto.deriveAddress(doc.mnemonic,1,i),branch:1,address_index:i});
      return refs;
    }
    function currentReceiveAddress(){return BwalletTCrypto.deriveAddress(state.doc.mnemonic,0,state.doc.receive_index)}

    async function load(){
      shell.innerHTML='<div class="bw-empty">'+esc(t('tw_loading'))+'</div>';
      try{var loaded=await Promise.all([api('/wallet'),api('/send-policy')]);state.remote=loaded[0];state.policy=loaded[1];renderGate()}catch(_){shell.innerHTML='<div class="bw-center"><div class="bw-panel"><h2>'+esc(t('tw_load_error'))+'</h2><button class="primary bw-retry">'+esc(t('tw_retry'))+'</button></div></div>';shell.querySelector('.bw-retry').onclick=load}
    }
    function renderGate(){
      if(!state.remote.exists){
        shell.innerHTML='<div class="bw-center"><div class="bw-panel"><div class="bw-logo">₿</div><h2>'+esc(t('tw_create_title'))+'</h2><p>'+esc(t('tw_create_body'))+'</p><div class="bw-note">'+esc(t('tw_security_note'))+'</div><div class="bw-actions"><button class="primary bw-create">'+esc(t('tw_create'))+'</button><button class="bw-restore">'+esc(t('tw_restore'))+'</button></div></div></div>';
        shell.querySelector('.bw-create').onclick=openCreate;shell.querySelector('.bw-restore').onclick=openRestore;return;
      }
      shell.innerHTML='<div class="bw-center"><form class="bw-panel bw-unlock"><div class="bw-logo">₿</div><h2>'+esc(t('tw_unlock_title'))+'</h2><p>'+esc(t('tw_unlock_body'))+'</p><label>'+esc(t('tw_password'))+'</label><input class="bw-pw" type="password" autocomplete="current-password"><div class="bw-error"></div><button class="primary" type="submit">'+esc(t('tw_unlock'))+'</button></form></div>';
      var form=shell.querySelector('.bw-unlock');setTimeout(function(){form.querySelector('.bw-pw').focus()},30);
      form.onsubmit=async function(e){e.preventDefault();var err=form.querySelector('.bw-error'),btn=form.querySelector('button');err.textContent='';btn.disabled=true;try{var key=await deriveKey(form.querySelector('.bw-pw').value,state.remote.salt,state.remote.iterations);var doc=await decryptDoc(key,state.remote.iv,state.remote.ciphertext);if(!doc||!BwalletTCrypto.validateMnemonic(doc.mnemonic))throw new Error('bad');doc.network=doc.network||'testnet3';state.key=key;state.doc=doc;renderApp();if(doc.discover)await discoverWallet();else await refreshWallet()}catch(_){err.textContent=t('tw_unlock_error');btn.disabled=false}};
    }

    function validatePasswords(a,b,err){if(a.length<MIN_PASSWORD){err.textContent=t('tw_password_short',{n:MIN_PASSWORD});return false}if(a!==b){err.textContent=t('tw_passwords_differ');return false}return true}
    function openCreate(){
      var phrase=BwalletTCrypto.generateMnemonic();
      var o=modal('<h3>'+esc(t('tw_generated_title'))+'</h3><p>'+esc(t('tw_generated_body'))+'</p><div class="bw-phrase show">'+esc(phrase)+'</div><label>'+esc(t('tw_password'))+'</label><input class="p1" type="password" autocomplete="new-password"><label>'+esc(t('tw_password_confirm'))+'</label><input class="p2" type="password" autocomplete="new-password"><div class="bw-note">'+esc(t('tw_password_hint'))+'</div><label class="bw-check"><input class="ok" type="checkbox"><span>'+esc(t('tw_backup_confirm'))+'</span></label><div class="bw-error"></div><div class="bw-actions"><button class="primary save">'+esc(t('tw_finish_create'))+'</button><button class="cancel">'+esc(t('tw_cancel'))+'</button></div>');
      o.querySelector('.cancel').onclick=function(){closeModal(o)};
      o.querySelector('.save').onclick=async function(){var err=o.querySelector('.bw-error'),p1=o.querySelector('.p1').value,p2=o.querySelector('.p2').value;err.textContent='';if(!validatePasswords(p1,p2,err))return;if(!o.querySelector('.ok').checked){err.textContent=t('tw_backup_confirm');return}await createWallet(phrase,p1,false,o,err)};
    }
    function openRestore(){
      var o=modal('<h3>'+esc(t('tw_restore_title'))+'</h3><p>'+esc(t('tw_restore_body'))+'</p><label>'+esc(t('tw_phrase'))+'</label><textarea class="phrase" rows="4" placeholder="'+esc(t('tw_phrase_placeholder'))+'" autocomplete="off"></textarea><label>'+esc(t('tw_password'))+'</label><input class="p1" type="password" autocomplete="new-password"><label>'+esc(t('tw_password_confirm'))+'</label><input class="p2" type="password" autocomplete="new-password"><div class="bw-error"></div><div class="bw-actions"><button class="primary save">'+esc(t('tw_restore'))+'</button><button class="cancel">'+esc(t('tw_cancel'))+'</button></div>');
      o.querySelector('.cancel').onclick=function(){closeModal(o)};
      o.querySelector('.save').onclick=async function(){var err=o.querySelector('.bw-error'),phrase=BwalletTCrypto.normalizeMnemonic(o.querySelector('.phrase').value),p1=o.querySelector('.p1').value,p2=o.querySelector('.p2').value;err.textContent='';if(!BwalletTCrypto.validateMnemonic(phrase)){err.textContent=t('tw_phrase_invalid');return}if(!validatePasswords(p1,p2,err))return;await createWallet(phrase,p1,true,o,err)};
    }
    async function createWallet(phrase,password,discover,o,err){
      var button=o.querySelector('.save');button.disabled=true;
      try{
        var salt=b64(crypto.getRandomValues(new Uint8Array(16))),key=await deriveKey(password,salt,ITERATIONS);
        var doc={version:1,network:'testnet3',mnemonic:BwalletTCrypto.normalizeMnemonic(phrase),receive_index:0,change_index:-1,created_at:Date.now(),discover:!!discover};
        var encrypted=await encryptDoc(key,doc);
        var saved=await api('/wallet',{method:'POST',body:JSON.stringify({salt:salt,iterations:ITERATIONS,iv:encrypted.iv,ciphertext:encrypted.ciphertext})});
        state.remote={exists:true,salt:salt,iterations:ITERATIONS,iv:encrypted.iv,ciphertext:encrypted.ciphertext,revision:saved.revision};state.key=key;state.doc=doc;closeModal(o);renderApp();
        if(discover)await discoverWallet();else await refreshWallet();
      }catch(_){err.textContent=t('tw_load_error');button.disabled=false}
    }

    async function persistWith(key,salt,iterations){
      var enc=await encryptDoc(key,state.doc);
      try{
        var result=await api('/wallet',{method:'PUT',body:JSON.stringify({salt:salt,iterations:iterations,iv:enc.iv,ciphertext:enc.ciphertext,revision:state.remote.revision})});
        state.remote.salt=salt;state.remote.iterations=iterations;state.remote.iv=enc.iv;state.remote.ciphertext=enc.ciphertext;state.remote.revision=result.revision;state.key=key;
      }catch(e){if(e.code==='wallet_changed')toast(t('tw_save_error'));throw e}
    }
    function persist(){return persistWith(state.key,state.remote.salt,state.remote.iterations)}
    async function discoverWallet(){
      state.busy=true;renderApp();
      try{
        async function scanBranch(branch){
          var highest=-1,start=0;
          while(start<200){
            var refs=[];for(var i=start;i<start+20;i++)refs.push({address:BwalletTCrypto.deriveAddress(state.doc.mnemonic,branch,i),branch:branch,address_index:i});
            var result=await api('/network/sync',{method:'POST',body:JSON.stringify({network:state.doc.network,addresses:refs})}),used=false;
            result.addresses.forEach(function(row){var c=row.chain_stats||{},m=row.mempool_stats||{};if((c.tx_count||0)+(m.tx_count||0)>0){used=true;highest=Math.max(highest,row.address_index)}});
            if(!used)break;start+=20;
          }
          return highest;
        }
        var maxReceive=await scanBranch(0),maxChange=await scanBranch(1);
        maxReceive=Math.max(0,maxReceive+1);
        state.doc.receive_index=maxReceive;state.doc.change_index=maxChange;state.doc.discover=false;await persist();state.sync=null;await refreshWallet();
      }catch(_){state.busy=false;renderApp();toast(t('tw_network_error'))}
    }
    async function refreshWallet(){
      if(!state.doc)return;state.busy=true;renderApp();
      try{
        var refs=allAddressRefs(state.doc);
        var results=await Promise.all([api('/network/sync',{method:'POST',body:JSON.stringify({network:state.doc.network,addresses:refs})}),api('/network/fees?network='+encodeURIComponent(state.doc.network))]);
        state.sync=results[0];state.fees=results[1];
        var current=state.sync.addresses.find(function(row){return row.branch===0&&row.address_index===state.doc.receive_index});
        var chain=current&&current.chain_stats||{},mempool=current&&current.mempool_stats||{};
        if(current&&(chain.tx_count||0)+(mempool.tx_count||0)>0){
          state.doc.receive_index++;
          try{await persist()}catch(_){state.doc.receive_index--;state.busy=false;renderApp();return}
          state.busy=false;return refreshWallet();
        }
        state.busy=false;renderApp();
      }catch(_){state.busy=false;renderApp();toast(t('tw_network_error'))}
    }
    function walletNumbers(){
      var confirmed=0,pending=0;
      (state.sync&&state.sync.addresses||[]).forEach(function(row){var c=row.chain_stats||{},m=row.mempool_stats||{};confirmed+=(c.funded_txo_sum||0)-(c.spent_txo_sum||0);pending+=(m.funded_txo_sum||0)-(m.spent_txo_sum||0)});
      return{confirmed:confirmed,pending:pending,total:confirmed+pending};
    }
    function walletTransactions(){
      var set=new Set(allAddressRefs(state.doc).map(function(r){return r.address}));
      return(state.sync&&state.sync.transactions||[]).map(function(tx){var received=0,spent=0;(tx.vout||[]).forEach(function(o){if(set.has(o.scriptpubkey_address))received+=o.value||0});(tx.vin||[]).forEach(function(i){if(i.prevout&&set.has(i.prevout.scriptpubkey_address))spent+=i.prevout.value||0});return{tx:tx,net:received-spent}}).sort(function(a,b){return(b.tx.status&&b.tx.status.block_time||Number.MAX_SAFE_INTEGER)-(a.tx.status&&a.tx.status.block_time||Number.MAX_SAFE_INTEGER)})
    }

    function renderApp(){
      if(!state.doc){renderGate();return}
      var nav=['receive','send','activity','explorer'];
      shell.innerHTML='<header class="bw-header"><div class="bw-brand"><span class="bw-logo">₿</span><span>BwalletT</span></div><div class="bw-head-actions"><button class="bw-icon refresh" title="'+esc(t('tw_refresh'))+'">↻</button><button class="bw-icon settings" title="'+esc(t('tw_settings'))+'">⚙</button></div></header><main class="bw-main"></main><nav class="bw-nav">'+nav.map(function(v){return'<button data-view="'+v+'" class="'+(state.view===v?'active':'')+'">'+esc(t('tw_'+v))+'</button>'}).join('')+'</nav>';
      shell.querySelector('.bw-brand').onclick=function(){state.view='home';renderApp()};shell.querySelector('.refresh').onclick=refreshWallet;shell.querySelector('.settings').onclick=function(){state.view='settings';renderApp()};
      shell.querySelectorAll('.bw-nav button').forEach(function(b){b.onclick=function(){state.view=b.dataset.view;renderApp()}});
      var main=shell.querySelector('.bw-main');
      if(state.busy&&!state.sync){main.innerHTML='<div class="bw-empty">'+esc(state.doc.discover?t('tw_discovering'):t('tw_refreshing'))+'</div>';return}
      if(state.view==='home')renderHome(main);else if(state.view==='receive')renderReceive(main);else if(state.view==='send')renderSend(main);else if(state.view==='activity')renderActivity(main);else if(state.view==='explorer')renderExplorer(main);else renderSettings(main);
    }
    function renderHome(main){
      var n=walletNumbers(),recent=walletTransactions().slice(0,4);
      main.innerHTML='<section class="bw-balance"><div class="bw-balance-label">'+esc(t('tw_balance'))+'</div><div class="bw-balance-value">'+fmtSats(n.total)+'</div><div class="bw-balance-meta"><span>'+esc(t('tw_available'))+'<b>'+fmtSats(n.confirmed)+'</b></span><span>'+esc(t('tw_pending'))+'<b>'+fmtSats(n.pending)+'</b></span></div></section><div class="bw-quick"><button class="primary receive">↓ '+esc(t('tw_receive'))+'</button><button class="send">↑ '+esc(t('tw_send'))+'</button></div><div class="bw-section-title"><span>'+esc(t('tw_activity'))+'</span><span class="bw-muted">'+(state.busy?esc(t('tw_refreshing')):'')+'</span></div><div class="recent"></div>';
      main.querySelector('.receive').onclick=function(){state.view='receive';renderApp()};main.querySelector('.send').onclick=function(){state.view='send';renderApp()};renderTxList(main.querySelector('.recent'),recent);
      if(!n.total&&!recent.length)main.querySelector('.recent').innerHTML='<div class="bw-empty">'+esc(t('tw_empty_balance'))+'</div>';
    }
    function renderTxList(box,rows){
      if(!rows.length){box.innerHTML='<div class="bw-empty">'+esc(t('tw_no_activity'))+'</div>';return}
      box.innerHTML=rows.map(function(row){var st=row.tx.status||{},incoming=row.net>=0;return'<div class="bw-card tx" data-txid="'+esc(row.tx.txid)+'"><div class="bw-row"><div><div style="font-weight:800">'+esc(t(incoming?'tw_received':'tw_sent'))+'</div><div class="bw-muted bw-mono">'+esc(short(row.tx.txid,7))+'</div></div><div style="text-align:right"><div class="bw-amount '+(incoming?'in':'out')+'">'+(incoming?'+':'−')+fmtSats(Math.abs(row.net))+'</div><span class="bw-status '+(st.confirmed?'':'pending')+'">'+esc(t(st.confirmed?'tw_confirmed':'tw_unconfirmed'))+'</span></div></div><div class="bw-muted" style="margin-top:.35rem">'+esc(st.confirmed?fmtTime(st.block_time):'')+'</div></div>'}).join('');
      box.querySelectorAll('.tx').forEach(function(el){el.onclick=function(){state.view='explorer';renderApp();searchExplorer(el.dataset.txid)}});
    }
    function renderReceive(main){
      var address=currentReceiveAddress();
      main.innerHTML='<div class="bw-form"><div class="bw-section-title">'+esc(t('tw_receive'))+'</div><p class="bw-muted">'+esc(t('tw_receive_body'))+'</p><img class="bw-qr" alt="QR"><label>'+esc(t('tw_address'))+'</label><div class="bw-address-box">'+esc(address)+'</div><div class="bw-actions"><button class="primary copy">'+esc(t('tw_copy'))+'</button></div></div>';
      BwalletTCrypto.qrDataUrl('bitcoin:'+address).then(function(url){var img=main.querySelector('.bw-qr');if(img)img.src=url});main.querySelector('.copy').onclick=function(){copy(address)};
    }
    function selectedFee(name){var f=state.fees||{};if(name==='fast')return Math.max(1,Math.ceil(f.fastestFee||2));if(name==='economy')return Math.max(1,Math.ceil(f.economyFee||f.hourFee||1));return Math.max(1,Math.ceil(f.halfHourFee||f.hourFee||1))}
    function spendableUtxos(){var out=[];(state.sync&&state.sync.addresses||[]).forEach(function(row){(row.utxos||[]).forEach(function(u){out.push({txid:u.txid,vout:u.vout,value:u.value,branch:row.branch,address_index:row.address_index})})});return out}
    function policyError(amount){var p=state.policy||{};if(p.min_send_sats&&amount<p.min_send_sats)return t('tw_below_minimum',{amount:fmtSats(p.min_send_sats)});if(p.max_send_sats&&amount>p.max_send_sats)return t('tw_above_maximum',{amount:fmtSats(p.max_send_sats)});return''}
    function requestError(e){if(e.code==='send_below_minimum')return t('tw_below_minimum',{amount:fmtSats(e.limit_sats)});if(e.code==='send_above_maximum')return t('tw_above_maximum',{amount:fmtSats(e.limit_sats)});return e.detail||t('tw_broadcast_error')}
    function renderSend(main){
      var n=walletNumbers();main.innerHTML='<form class="bw-form"><div class="bw-section-title"><span>'+esc(t('tw_send'))+'</span><span class="bw-muted">'+esc(t('tw_available'))+': '+fmtSats(n.total)+'</span></div><label>'+esc(t('tw_recipient'))+'</label><input class="to bw-mono" autocomplete="off"><label>'+esc(t('tw_amount'))+'</label><input class="amount" inputmode="decimal" placeholder="0.00000000"><label>'+esc(t('tw_fee'))+'</label><div class="bw-fees"><button type="button" data-fee="fast">'+esc(t('tw_fee_fast'))+'</button><button type="button" data-fee="normal" class="active">'+esc(t('tw_fee_normal'))+'</button><button type="button" data-fee="economy">'+esc(t('tw_fee_economy'))+'</button></div><div class="bw-error"></div><button class="primary review" type="submit">'+esc(t('tw_review'))+'</button></form>';
      var form=main.querySelector('form'),feeName='normal';form.querySelectorAll('.bw-fees button').forEach(function(b){b.onclick=function(){feeName=b.dataset.fee;form.querySelectorAll('.bw-fees button').forEach(function(x){x.classList.toggle('active',x===b)})}});
      form.onsubmit=async function(e){e.preventDefault();var err=form.querySelector('.bw-error'),to=form.querySelector('.to').value.trim(),amount=satsFromBtc(form.querySelector('.amount').value);err.textContent='';if(!BwalletTCrypto.isValidAddress(to)){err.textContent=t('tw_invalid_address');return}if(!amount){err.textContent=t('tw_invalid_amount');return}var blocked=policyError(amount);if(blocked){err.textContent=blocked;return}var nextChange=state.doc.change_index+1,preview;try{preview=BwalletTCrypto.buildTransaction(state.doc.mnemonic,spendableUtxos(),to,amount,selectedFee(feeName),nextChange);preview.change_index=nextChange}catch(ex){err.textContent=t(ex.message==='insufficient_funds'?'tw_insufficient':ex.message==='invalid_address'?'tw_invalid_address':'tw_broadcast_error');return}confirmPayment(to,amount,preview)};
    }
    function confirmPayment(to,amount,tx){
      var o=modal('<h3>'+esc(t('tw_payment_title'))+'</h3><div class="bw-kv"><span>'+esc(t('tw_payment_to'))+'</span><b class="bw-mono">'+esc(short(to,10))+'</b><span>'+esc(t('tw_payment_amount'))+'</span><b>'+fmtSats(amount)+'</b><span>'+esc(t('tw_payment_fee'))+'</span><b>'+fmtSats(tx.fee)+'</b><span>'+esc(t('tw_payment_total'))+'</span><b>'+fmtSats(amount+tx.fee)+'</b></div><div class="bw-error"></div><div class="bw-actions"><button class="primary send">'+esc(t('tw_confirm_send'))+'</button><button class="cancel">'+esc(t('tw_cancel'))+'</button></div>');
      o.querySelector('.cancel').onclick=function(){closeModal(o)};o.querySelector('.send').onclick=async function(){var btn=o.querySelector('.send'),err=o.querySelector('.bw-error');btn.disabled=true;btn.textContent=t('tw_sending');try{if(tx.change_address&&state.doc.change_index<tx.change_index){state.doc.change_index=tx.change_index;await persist()}var result=await api('/network/broadcast',{method:'POST',body:JSON.stringify({network:state.doc.network,raw_tx:tx.hex,recipient:to,amount_sats:amount})});closeModal(o);await refreshWallet();showSent(result.txid)}catch(e){err.textContent=requestError(e);btn.disabled=false;btn.textContent=t('tw_confirm_send')}};
    }
    function showSent(txid){var o=modal('<h3>'+esc(t('tw_sent_title'))+'</h3><label>'+esc(t('tw_txid'))+'</label><div class="bw-address-box">'+esc(txid)+'</div><div class="bw-actions"><button class="copy">'+esc(t('tw_copy'))+'</button><button class="primary close">'+esc(t('tw_close'))+'</button></div>');o.querySelector('.copy').onclick=function(){copy(txid)};o.querySelector('.close').onclick=function(){closeModal(o);state.view='activity';renderApp()}}
    function renderActivity(main){main.innerHTML='<div class="bw-section-title"><span>'+esc(t('tw_activity'))+'</span><span class="bw-muted">'+(state.busy?esc(t('tw_refreshing')):'')+'</span></div><div class="list"></div>';renderTxList(main.querySelector('.list'),walletTransactions())}
    function renderExplorer(main){
      main.innerHTML='<div class="bw-search"><input class="query bw-mono" placeholder="'+esc(t('tw_explorer_placeholder'))+'"><button class="primary go">'+esc(t('tw_search'))+'</button></div><div class="bw-error"></div><div class="result"></div>';
      var go=function(){searchExplorer(main.querySelector('.query').value.trim())};main.querySelector('.go').onclick=go;main.querySelector('.query').onkeydown=function(e){if(e.key==='Enter')go()};
    }
    async function searchExplorer(query){
      if(state.view!=='explorer'){state.view='explorer';renderApp()}
      var main=shell.querySelector('.bw-main'),err=main.querySelector('.bw-error'),box=main.querySelector('.result');main.querySelector('.query').value=query;err.textContent='';box.innerHTML='<div class="bw-empty">'+esc(t('tw_loading'))+'</div>';
      var path;if(/^[0-9a-fA-F]{64}$/.test(query))path='/explorer/tx/'+query;else if(BwalletTCrypto.isValidAddress(query))path='/explorer/address/'+encodeURIComponent(query);else{box.innerHTML='';err.textContent=t('tw_explorer_invalid');return}
      try{var data=await api(path+'?network='+encodeURIComponent(state.doc.network));if(data.type==='address')renderAddressResult(box,data);else renderTxResult(box,data)}catch(_){box.innerHTML='';err.textContent=t('tw_explorer_invalid')}
    }
    function renderAddressResult(box,data){var c=data.status.chain_stats||{},m=data.status.mempool_stats||{},balance=(c.funded_txo_sum||0)-(c.spent_txo_sum||0)+(m.funded_txo_sum||0)-(m.spent_txo_sum||0);box.innerHTML='<div class="bw-card" style="margin-top:.8rem"><div class="bw-address-box">'+esc(data.address)+'</div><div class="bw-kv"><span>'+esc(t('tw_explorer_balance'))+'</span><b>'+fmtSats(balance)+'</b><span>'+esc(t('tw_total_received'))+'</span><b>'+fmtSats((c.funded_txo_sum||0)+(m.funded_txo_sum||0))+'</b><span>'+esc(t('tw_transactions'))+'</span><b>'+((c.tx_count||0)+(m.tx_count||0))+'</b></div></div><div class="bw-section-title">'+esc(t('tw_transactions'))+'</div><div class="txs"></div>';var rows=(data.transactions||[]).map(function(tx){return{tx:tx,net:0}});renderTxList(box.querySelector('.txs'),rows)}
    function renderTxResult(box,data){var tx=data.transaction,st=tx.status||{},input=(tx.vin||[]).reduce(function(a,v){return a+(v.prevout?v.prevout.value||0:0)},0),output=(tx.vout||[]).reduce(function(a,v){return a+(v.value||0)},0);box.innerHTML='<div class="bw-card" style="margin-top:.8rem"><div class="bw-address-box">'+esc(tx.txid)+'</div><div class="bw-kv"><span>'+esc(t('tw_confirmed'))+'</span><b>'+esc(t(st.confirmed?'tw_confirmed':'tw_unconfirmed'))+'</b>'+(st.confirmed?'<span>'+esc(t('tw_block',{n:st.block_height}))+'</span><b>'+esc(fmtTime(st.block_time))+'</b>':'')+'<span>'+esc(t('tw_fee_value'))+'</span><b>'+fmtSats(tx.fee||Math.max(0,input-output))+'</b><span>'+esc(t('tw_size'))+'</span><b>'+Number(tx.size||0).toLocaleString()+' B</b><span>'+esc(t('tw_inputs'))+'</span><b>'+Number((tx.vin||[]).length).toLocaleString()+'</b><span>'+esc(t('tw_outputs'))+'</span><b>'+Number((tx.vout||[]).length).toLocaleString()+'</b></div></div>'}
    function renderSettings(main){
      main.innerHTML='<div class="bw-form"><div class="bw-section-title">'+esc(t('tw_settings'))+'</div>'+(opts.desktop?'<div class="bw-card send-policy"><div style="font-weight:800">'+esc(t('tw_send_policy_title'))+' <span style="color:#f59e0b">◆</span></div><p class="bw-muted">'+esc(t('tw_send_policy_body'))+'</p><div class="policy-fields">'+esc(t('tw_loading'))+'</div></div>':'')+'<div class="bw-card"><div style="font-weight:800">'+esc(t('tw_reveal_phrase'))+'</div><p class="bw-muted">'+esc(t('tw_reveal_warning'))+'</p><button class="reveal">'+esc(t('tw_reveal_phrase'))+'</button></div><div class="bw-card"><div style="font-weight:800">'+esc(t('tw_change_password'))+'</div><button class="change" style="margin-top:.65rem">'+esc(t('tw_change_password'))+'</button></div><div class="bw-card"><button class="danger lock">'+esc(t('tw_lock'))+'</button></div></div>';
      main.querySelector('.reveal').onclick=revealPhrase;main.querySelector('.change').onclick=changePassword;main.querySelector('.lock').onclick=lock;
      if(opts.desktop)renderSendPolicy(main.querySelector('.send-policy'));
    }
    async function renderSendPolicy(card){
      try{
        var p=await api('/admin/send-policy'),fields=card.querySelector('.policy-fields');
        fields.innerHTML='<label>'+esc(t('tw_min_send'))+'</label><input class="min" inputmode="decimal" value="'+(Number(p.min_send_sats||0)/SATS).toFixed(8)+'"><label>'+esc(t('tw_max_send'))+'</label><input class="max" inputmode="decimal" value="'+(Number(p.max_send_sats||0)/SATS).toFixed(8)+'"><div class="bw-note">'+esc(t('tw_no_limit'))+'</div><div class="bw-error"></div><button class="primary save-policy">'+esc(t('tw_save_policy'))+'</button>';
        fields.querySelector('.save-policy').onclick=async function(){var err=fields.querySelector('.bw-error'),minimum=satsFromBtc(fields.querySelector('.min').value,true),maximum=satsFromBtc(fields.querySelector('.max').value,true);err.textContent='';if(minimum===null||maximum===null||(maximum&&maximum<minimum)){err.textContent=t('tw_policy_invalid_range');return}try{var saved=await api('/admin/send-policy',{method:'PUT',body:JSON.stringify({min_send_sats:minimum,max_send_sats:maximum})});state.policy={min_send_sats:saved.min_send_sats,max_send_sats:saved.max_send_sats};toast(t('tw_policy_saved'))}catch(e){err.textContent=t(e.code==='invalid_send_policy'?'tw_policy_invalid_range':'tw_broadcast_error')}};
        if(!p.premium&&window.mvmOS)window.mvmOS.premiumStatus='free';
        if(window.mvmOS&&window.mvmOS.premiumGate)window.mvmOS.premiumGate(card,t('tw_policy_premium_info'));
      }catch(_){card.querySelector('.policy-fields').textContent=t('tw_load_error')}
    }
    async function verifyPassword(password){var key=await deriveKey(password,state.remote.salt,state.remote.iterations);var doc=await decryptDoc(key,state.remote.iv,state.remote.ciphertext);if(!doc||doc.mnemonic!==state.doc.mnemonic)throw new Error('bad');return{key:key,doc:doc}}
    function revealPhrase(){
      var o=modal('<h3>'+esc(t('tw_reveal_phrase'))+'</h3><p>'+esc(t('tw_reveal_warning'))+'</p><label>'+esc(t('tw_password'))+'</label><input class="pw" type="password" autocomplete="current-password"><div class="bw-error"></div><div class="phrase-wrap"></div><div class="bw-actions"><button class="primary show">'+esc(t('tw_show'))+'</button><button class="close">'+esc(t('tw_close'))+'</button></div>');var revealed=false;o.querySelector('.close').onclick=function(){closeModal(o)};o.querySelector('.show').onclick=async function(){var err=o.querySelector('.bw-error');if(!revealed){try{await verifyPassword(o.querySelector('.pw').value);o.querySelector('.phrase-wrap').innerHTML='<div class="bw-phrase show">'+esc(state.doc.mnemonic)+'</div>';o.querySelector('.pw').style.display='none';o.querySelector('label').style.display='none';o.querySelector('.show').textContent=t('tw_hide');revealed=true}catch(_){err.textContent=t('tw_unlock_error')}}else{o.querySelector('.phrase-wrap').innerHTML='';o.querySelector('.show').textContent=t('tw_show');revealed=false}};
    }
    function changePassword(){
      var o=modal('<h3>'+esc(t('tw_change_password'))+'</h3><label>'+esc(t('tw_current_password'))+'</label><input class="old" type="password" autocomplete="current-password"><label>'+esc(t('tw_new_password'))+'</label><input class="p1" type="password" autocomplete="new-password"><label>'+esc(t('tw_password_confirm'))+'</label><input class="p2" type="password" autocomplete="new-password"><div class="bw-error"></div><div class="bw-actions"><button class="primary save">'+esc(t('tw_change'))+'</button><button class="cancel">'+esc(t('tw_cancel'))+'</button></div>');o.querySelector('.cancel').onclick=function(){closeModal(o)};o.querySelector('.save').onclick=async function(){var err=o.querySelector('.bw-error'),p1=o.querySelector('.p1').value,p2=o.querySelector('.p2').value;err.textContent='';if(!validatePasswords(p1,p2,err))return;try{await verifyPassword(o.querySelector('.old').value);var salt=b64(crypto.getRandomValues(new Uint8Array(16))),key=await deriveKey(p1,salt,ITERATIONS);await persistWith(key,salt,ITERATIONS);closeModal(o);toast(t('tw_password_changed'))}catch(_){err.textContent=t('tw_unlock_error')}};
    }
    function lock(){state.key=null;state.doc=null;state.sync=null;state.fees=null;state.view='home';renderGate()}
    load();
    return{destroy:function(){state.destroyed=true;state.key=null;state.doc=null;root.innerHTML=''}};
  }
  window.BwalletTWidget={mount:mount};
})();
