// Cache-busting matters more here than the HTTP headers do. These files are
// served with Cache-Control: no-cache, so a request for them is revalidated —
// but the loader below skips the request entirely once the script has defined
// its global, and window outlives the app window. A desktop session that loaded
// an old build therefore keeps it until the whole desktop is reloaded, which is
// how an edit can be live on the public page and invisible in the app. Asking
// the server for the current asset version and pinning it in the URL makes the
// two agree: same version means the cached script is correct to reuse, a new
// one forces a genuine reload.
function _pmLoad(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
var _pmVer=null;
function _pmVersion(){
  if(_pmVer)return _pmVer;
  _pmVer=fetch('/pub/mvmpasswords/assets').then(function(r){return r.json()}).then(function(d){return d.version||''}).catch(function(){return String(Date.now())});
  return _pmVer;
}
// Reloads a script when the build it came from is not the one now on the server.
function _pmScript(file,global){
  return _pmVersion().then(function(v){
    if(window[global]&&window._pmBuild===v)return;
    return _pmLoad('/apps/mvmpasswords/'+file+'?v='+v).then(function(){window._pmBuild=v});
  });
}
mvmOS.registerApp({id:'mvmpasswords',name:'mvmPasswords',icon:'🔑',category:'Security & Privacy',requires_apphub:true,appSettings:true,onAppSettings:function(){AppStore.openWindow({section:'my-apps',appId:'mvmpasswords'})},renderSettingsExtra:function(wrap){_pmScript('i18n.js','MVM_PASSWORD_I18N').then(function(){var t=window.t||function(k){return k};var content=wrap.parentNode;var box=content&&content.querySelector('input[data-key="totp_integration"]');if(!box)return;var row=box.closest('div');var note=document.createElement('div');note.style.cssText='font-size:.74rem;color:var(--text-dim);margin-left:24px;line-height:1.45';note.textContent=t('pm_totp_setting_hint');row.appendChild(note);if(mvmOS.premiumStatus!=='premium'){box.disabled=true;var need=document.createElement('div');need.style.cssText='font-size:.74rem;color:var(--warning,#f9e2af);margin-left:24px;line-height:1.45';need.textContent='🔒 '+t('pm_totp_premium_required');row.appendChild(need);}mvmOS.premiumGate(row,t('pm_totp_premium_required'));});},launch:function(){mvmOS.createWindow({id:'mvmpasswords',title:'🔑 mvmPasswords',width:500,height:680,appSettings:true,onAppSettings:function(){AppStore.openWindow({section:'my-apps',appId:'mvmpasswords'})},onMount:function(body){body.style.padding='0';var root=document.createElement('div');root.style.height='100%';body.appendChild(root);Promise.all([_pmScript('i18n.js','MVM_PASSWORD_I18N'),_pmScript('passkey-webauthn.js','MvmPasswordManagerPasskey'),_pmScript('password-manager-widget.js','MvmPasswordManagerWidget')]).then(function(){MvmPasswordManagerWidget.mount(root,{})})}})}});
