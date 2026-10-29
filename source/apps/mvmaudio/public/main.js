(function(){
  function load(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=window.asset(src);s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})}
  mvmOS.registerApp({id:'mvmaudio',name:'mvmAudio',icon:'🎧',category:'Media',requires_apphub:true,
    async launch(){
      if(!window.MA_I18N)await load('/apps/mvmaudio/i18n.js');
      if(!window.MvmAudio)await load('/apps/mvmaudio/player.js');
      let player;
      mvmOS.createWindow({id:'mvmaudio',title:'🎧 mvmAudio',width:1180,height:800,
        onMount(body){body.style.padding='0';body.style.overflow='hidden';player=window.MvmAudio.mount(body,{desktop:true});},
        onClose(){player?.destroy();}});
    }
  });
})();
