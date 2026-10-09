function cardboxScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = window.asset(src); s.onload = resolve; s.onerror = reject; document.head.appendChild(s); });
}
mvmOS.registerApp({
  id: 'cardbox', name: 'Cardbox', icon: '🎟️', category: 'Productivity', requires_apphub: true,
  async launch() {
    if (!window.CARDBOX_I18N) await cardboxScript('/apps/cardbox/i18n.js');
    const lang = window.mvmOS?.lang || 'en';
    const title = window.CARDBOX_I18N[lang]?.title || window.CARDBOX_I18N.en.title;
    mvmOS.createWindow({
      id: 'cardbox', title: '🎟️ ' + title, width: 970, height: 700,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = '<div class="cardbox-root" style="height:100%"></div>';
        const root = body.firstElementChild;
        cardboxScript('/apps/cardbox/qrcode.js')
          .then(() => cardboxScript('/apps/cardbox/jsbarcode.js'))
          .then(() => cardboxScript('/apps/cardbox/widget.js'))
          .then(() => window.CardboxWidget.mount(root));
      }
    });
  }
});
