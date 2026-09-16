// Cache-busting matters more here than the HTTP headers do. These files are
// served with Cache-Control: no-cache, so a request for them is revalidated —
// but the loader below skips the request entirely once the script has defined
// its global, and window outlives the app window. A desktop session that loaded
// an old build therefore keeps it until the whole desktop is reloaded, which is
// how an edit can be live on the public page and invisible in the app. Asking
// the server for the current asset version and pinning it in the URL makes the
// two agree: same version means the cached script is correct to reuse, a new
// one forces a genuine reload.
function _nosLoad(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
var _nosVer=null;
function _nosVersion(){
  if(_nosVer)return _nosVer;
  _nosVer=fetch('/pub/nostradamus/assets').then(function(r){return r.json()}).then(function(d){return d.version||''}).catch(function(){return String(Date.now())});
  return _nosVer;
}
// Reloads a script when the build it came from is not the one now on the server.
function _nosScript(file,global){
  return _nosVersion().then(function(v){
    if(window[global]&&window._nosBuild===v)return;
    return _nosLoad('/apps/nostradamus/'+file+'?v='+v).then(function(){window._nosBuild=v});
  });
}
function _nosT(k){return _nosScript('i18n.js','NOSTRADAMUS_I18N').then(function(){return(window.t||function(x){return x})(k)})}
mvmOS.registerApp({
  id:'nostradamus',name:'Nostradamus',icon:'🔮',category:'Communication',requires_apphub:true,
  async renderSettingsExtra(container){
    var live={};
    try{live=await(await fetch('/api/apps/nostradamus/settings')).json()}catch(_){}
    var enabled=live.deepl_enabled==='1';
    var lbl=await _nosT('nos_deepl_enable_lbl'),hint=await _nosT('nos_deepl_needs_app');
    container.innerHTML='<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">'+
      '<label id="nos-se-deepl-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">'+
      '<input type="checkbox" id="nos-se-deepl"'+(enabled?' checked':'')+'>'+
      '<span style="font-size:.84rem">'+lbl+'</span></label>'+
      '<div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;margin-left:24px">'+hint+'</div></div>';
    var row=container.querySelector('#nos-se-deepl-row'),cb=container.querySelector('#nos-se-deepl');
    window.mvmOS?.premiumGate?.(row,hint);
    cb.onchange=async function(){
      var val=cb.checked?'1':'0';
      try{
        var r=await fetch('/api/apps/nostradamus/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deepl_enabled:val})});
        if(!r.ok)throw new Error(await r.text().catch(function(){return r.statusText}));
        live.deepl_enabled=val;
      }catch(_){
        cb.checked=!cb.checked;
        window.mvmOS?.notify?.('Nostradamus',await _nosT('nos_translate_error'));
      }
    };
  },
  launch:function(){mvmOS.createWindow({id:'nostradamus',title:'🔮 Nostradamus',width:520,height:700,appSettings:true,onAppSettings:function(){AppStore.openWindow({section:'my-apps',appId:'nostradamus'})},onMount:function(body){body.style.padding='0';var root=document.createElement('div');root.style.height='100%';body.appendChild(root);_nosScript('i18n.js','NOSTRADAMUS_I18N').then(function(){return _nosScript('vendor/noble-secp256k1.js','NostrCrypto')}).then(function(){return _nosScript('nostr-widget.js','NostradamusWidget')}).then(function(){NostradamusWidget.mount(root,{isDesktop:true})})}})}
});
