(function(){
  function script(src){return new Promise(function(ok,bad){var s=document.createElement('script');s.src=src+'?v='+Date.now();s.onload=ok;s.onerror=bad;document.head.appendChild(s)})}
  function load(){return Promise.all([script('/apps/mvmcloud/i18n.js'),script('/apps/mvmcloud/widget.js')])}
  mvmOS.registerApp({id:'mvmcloud',name:'mvmCloud',icon:'☁️',category:'Productivity',requires_apphub:true,launch:function(){mvmOS.createWindow({id:'mvmcloud',title:'☁️ mvmCloud',width:760,height:620,onMount:function(body){body.style.padding='0';var root=document.createElement('div');root.style.height='100%';body.appendChild(root);load().then(function(){MvmCloud.mount(root,{desktop:true})})}})}});
})();
