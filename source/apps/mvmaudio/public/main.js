(function(){
  function load(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=window.asset(src);s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})}
  // The open window's player, so a file opened from File Manager plays in it instead of a second window.
  let current=null;
  async function openWindow(path){
    if(!window.MA_I18N)await load('/apps/mvmaudio/i18n.js');
    if(!window.MvmAudio)await load('/apps/mvmaudio/player.js');
    if(current&&current.root.isConnected){
      mvmOS.createWindow({id:'mvmaudio'});
      if(path)current.player.playFile(path);
      return;
    }
    let player;
    mvmOS.createWindow({id:'mvmaudio',title:'🎧 mvmAudio',width:1180,height:800,
      onMount(body){body.style.padding='0';body.style.overflow='hidden';player=window.MvmAudio.mount(body,{desktop:true});current={player,root:body};if(path)player.playFile(path);},
      onClose(){player?.destroy();if(current?.player===player)current=null;}});
  }
  mvmOS.registerApp({id:'mvmaudio',name:'mvmAudio',icon:'🎧',category:'Media',requires_apphub:true,
    file_types:['mp3','m4a','m4b','aac','ogg','opus','flac','wav','webm'],
    launch(){return openWindow(null)},
    openFile(path){return openWindow(path)}
  });
})();
