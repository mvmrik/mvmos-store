function _bwLoad(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
var _bwVer=null;
function _bwVersion(){
  if(_bwVer)return _bwVer;
  _bwVer=fetch('/pub/bwallett/assets').then(function(r){return r.json()}).then(function(d){return d.version||''}).catch(function(){return String(Date.now())});
  return _bwVer;
}
function _bwScript(file,global){
  return _bwVersion().then(function(v){
    if(window[global]&&window._bwBuild===v)return;
    return _bwLoad('/apps/bwallett/'+file+'?v='+v).then(function(){window._bwBuild=v});
  });
}
mvmOS.registerApp({
  id:'bwallett',
  name:'BwalletT',
  icon:'₿',
  category:'Finance',
  requires_apphub:true,
  launch:function(){
    mvmOS.createWindow({
      id:'bwallett',
      title:'₿ BwalletT',
      width:560,
      height:720,
      onMount:function(body){
        body.style.padding='0';
        var root=document.createElement('div');
        root.style.height='100%';
        body.appendChild(root);
        _bwScript('i18n.js','BWALLETT_I18N')
          .then(function(){return _bwScript('bwallett-crypto.js','BwalletTCrypto')})
          .then(function(){return _bwScript('bwallett-widget.js','BwalletTWidget')})
          .then(function(){BwalletTWidget.mount(root,{desktop:true})});
      }
    });
  }
});
