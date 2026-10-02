(function(){
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
  // window.asset() exists from mvmOS 1.10.0; an older core loads the bare path.
  const asset=url=>window.asset?window.asset(url):url;
  let ready;
  const assets=()=>ready||(ready=Promise.all([load(asset('/apps/classifieds/i18n.js')),load(asset('/apps/classifieds/widget.js'))]).catch(e=>{ready=null;throw e;}));
  const css=document.createElement('link');css.rel='stylesheet';css.href=asset('/apps/classifieds/style.css');document.head.appendChild(css);
  mvmOS.registerApp({id:'classifieds',name:'Classifieds',icon:'🏷️',category:'Business',requires_apphub:true,launch(){
    mvmOS.createWindow({id:'classifieds',title:'🏷️ Classifieds',width:1100,height:740,onMount(body){
      // The app scrolls its own root; mounted on the window body itself, a phone's
      // fullscreen window forces that body to overflow:hidden and nothing scrolls.
      body.style.padding='0';const host=document.createElement('div');host.style.cssText='flex:1;min-height:0';body.appendChild(host);let handle,closed=false;
      const observer=new MutationObserver(()=>{if(!document.body.contains(body)){closed=true;handle?.destroy();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
      assets().then(()=>{if(!closed)handle=window.Classifieds.mount(host,{desktop:true});}).catch(()=>{host.textContent='⚠';});
    }});
  }});
})();
