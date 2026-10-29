(function () {
  const load = src => new Promise((ok,bad) => {const s=document.createElement('script');s.src=window.asset(src);s.onload=ok;s.onerror=bad;document.head.appendChild(s)});
  mvmOS.registerApp({id:'familytree',name:'Family Tree',icon:'🌳',category:'Productivity',requires_apphub:true,
    async launch(){
      if(!window.FAMILYTREE_I18N) await load('/apps/familytree/i18n.js');
      if(!window.FamilyTreeDates) await load('/apps/familytree/dates.js');
      if(!window.FamilyTreeKinship) await load('/apps/familytree/kinship.js');
      if(!window.FamilyTree) await load('/apps/familytree/widget.js');
      const lang=window.mvmOS?.lang||'en';
      mvmOS.createWindow({id:'familytree',title:'🌳 '+(window.FAMILYTREE_I18N[lang]||window.FAMILYTREE_I18N.en).title,width:1180,height:780,
        onMount(body){body.style.padding='0';window.FamilyTree.mount(body)}});
    }});
})();
