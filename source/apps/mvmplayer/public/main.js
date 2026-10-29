(function(){
 const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=window.asset(src);script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
 mvmOS.registerApp({id:'mvmplayer',name:'mvmPlayer',icon:'▶️',category:'Media',requires_apphub:true,
  async launch(){
   if(!window.MP_I18N)await load('/apps/mvmplayer/i18n.js');
   if(!window.MvmPlayer)await load('/apps/mvmplayer/player.js');
   let player;
   mvmOS.createWindow({id:'mvmplayer',title:'▶️ mvmPlayer',width:1180,height:820,
    onMount(body){body.style.padding='0';body.style.overflow='hidden';player=window.MvmPlayer.mount(body,{desktop:true})},
    onClose(){player?.destroy()}});
  }
 });
})();
