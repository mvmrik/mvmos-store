(function () {
  function load(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = window.asset(src);
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  mvmOS.registerApp({
    id: 'mvmfonts', name: 'mvmFonts', icon: '🔤', category: 'Productivity',
    async launch() {
      if (!window.MVMFONTS_I18N) await load('/apps/mvmfonts/i18n.js');
      if (!window.MvmFonts) await load('/apps/mvmfonts/fonts.js');
      let handle;
      mvmOS.createWindow({
        id: 'mvmfonts', title: '🔤 mvmFonts', width: 980, height: 700,
        onMount(body) { body.style.padding = '0'; handle = window.MvmFonts.mount(body); },
        onClose() { if (handle) handle.destroy(); },
      });
    },
  });
})();
