// Cache-busting matters more here than the HTTP headers do. These files are
// served with Cache-Control: no-cache, so a request for them is revalidated —
// but the loader below skips the request entirely once the script has defined
// its global, and window outlives the app window. A desktop session that loaded
// an old build therefore keeps it until the whole desktop is reloaded, which is
// how an edit can be live on the public page and invisible in the app. Asking
// the server for the current asset version and pinning it in the URL makes the
// two agree: same version means the cached script is correct to reuse, a new
// one forces a genuine reload.
function _mcLoad(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
var _mcVer=null;
function _mcVersion(){
  if(_mcVer)return _mcVer;
  _mcVer=fetch('/pub/mvmcrypto/assets').then(function(r){return r.json()}).then(function(d){return d.version||''}).catch(function(){return String(Date.now())});
  return _mcVer;
}
// Reloads a script when the build it came from is not the one now on the server.
function _mcScript(file,global){
  return _mcVersion().then(function(v){
    if(window[global]&&window._mcBuild===v)return;
    return _mcLoad('/apps/mvmcrypto/'+file+'?v='+v).then(function(){window._mcBuild=v});
  });
}
mvmOS.registerApp({
  id:'mvmcrypto',
  name:'mvmCrypto',
  icon:'🪙',
  category:'Finance',
  requires_apphub:true,
  launch:function(){
    mvmOS.createWindow({
      id:'mvmcrypto',
      title:'🪙 mvmCrypto',
      width:520,
      height:700,
      onMount:function(body){
        body.style.padding='0';
        var root=document.createElement('div');
        root.style.height='100%';
        body.appendChild(root);
        Promise.all([
          _mcScript('i18n.js','MVM_CRYPTO_I18N'),
          _mcScript('mvmcrypto-widget.js','MvmCryptoWidget')
        ]).then(function(){MvmCryptoWidget.mount(root,{})});
      }
    });
  }
});
