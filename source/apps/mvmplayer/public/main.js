(function(){
 const load=src=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=window.asset(src);script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});
 // The open window's player, so a file opened from File Manager plays in it instead of a second window.
 let current=null;
 async function openWindow(path){
  if(!window.MP_I18N)await load('/apps/mvmplayer/i18n.js');
  if(!window.MvmPlayer)await load('/apps/mvmplayer/player.js');
  if(current&&current.root.isConnected){
   mvmOS.createWindow({id:'mvmplayer'});
   if(path)current.player.playFile(path);
   return;
  }
  let player;
  mvmOS.createWindow({id:'mvmplayer',title:'▶️ mvmPlayer',width:1180,height:820,appSettings:true,onAppSettings(){player?.openSettings()},
   onMount(body){body.style.padding='0';body.style.overflow='hidden';player=window.MvmPlayer.mount(body,{desktop:true});current={player,root:body};if(path)player.playFile(path)},
   onClose(){player?.destroy();if(current?.player===player)current=null}});
 }
 mvmOS.registerApp({id:'mvmplayer',name:'mvmPlayer',icon:'▶️',category:'Media',requires_apphub:true,
  file_types:['mp4','m4v','mov','webm','mkv','ogv','avi'],
  launch(){return openWindow(null)},
  openFile(path){return openWindow(path)}
 });
})();
