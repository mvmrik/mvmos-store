(function(){
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);});
  let ready;
  const assets=()=>ready||(ready=Promise.all([load('/apps/classifieds/i18n.js?v=1.0.0'),load('/apps/classifieds/widget.js?v=1.0.0')]).catch(e=>{ready=null;throw e;}));
  const css=document.createElement('link');css.rel='stylesheet';css.href='/apps/classifieds/style.css?v=1.0.0';document.head.appendChild(css);
  mvmOS.registerApp({id:'classifieds',name:'Classifieds',icon:'🏷️',category:'Business',requires_apphub:true,launch(){
    mvmOS.createWindow({id:'classifieds',title:'🏷️ Classifieds',width:1100,height:740,onMount(body){
      body.style.padding='0';let handle,closed=false;
      const observer=new MutationObserver(()=>{if(!document.body.contains(body)){closed=true;handle?.destroy();observer.disconnect();}});observer.observe(document.body,{childList:true,subtree:true});
      assets().then(()=>{if(!closed)handle=window.Classifieds.mount(body,{desktop:true});}).catch(()=>{body.textContent='⚠';});
    }});
  }});
})();
