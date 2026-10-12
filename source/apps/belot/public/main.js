mvmOS.registerApp({
  id: 'belot', name: 'Belot', icon: '🃏', category: 'Games',
  launch() {
    if (!window.GameLauncher) {
      mvmOS.notify('Belot', 'This game needs a newer mvmOS core.');
      return;
    }
    window.GameLauncher.open({id:'belot',name:()=>t('bl_title'),icon:'🃏',tagline:()=>t('bl_tagline')});
  }
});
