function _dplLoad(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
var _dplVer=null;
function _dplVersion(){
  if(_dplVer)return _dplVer;
  _dplVer=fetch('/pub/deepl/assets').then(function(r){return r.json()}).then(function(d){return d.version||''}).catch(function(){return String(Date.now())});
  return _dplVer;
}
function _dplScript(file,global){
  return _dplVersion().then(function(v){
    if(window[global]&&window._dplBuild===v)return;
    return _dplLoad('/apps/deepl/'+file+'?v='+v).then(function(){window._dplBuild=v});
  });
}
mvmOS.registerApp({id:'deepl',name:'DeepL Translator',icon:'🌐',category:'Utilities',requires_apphub:true,launch:function(){mvmOS.createWindow({id:'deepl',title:'🌐 DeepL Translator',width:640,height:560,onMount:function(body){body.style.padding='0';var root=document.createElement('div');root.style.height='100%';body.appendChild(root);_dplScript('i18n.js','DEEPL_I18N').then(function(){return _dplScript('widget.js','DeepLWidget')}).then(function(){DeepLWidget.mount(root,{})})}})}});
