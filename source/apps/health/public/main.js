// mvmOS App: Health v1.0.0
const _hli18n = {
  en: { title: 'Health' },
  bg: { title: 'Здраве' },
};
function _hlt(key) { const lang = window.mvmOS?.lang || 'en'; return (_hli18n[lang] || _hli18n.en)[key] || key; }

function _hlLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadHealthAssets() {
  const p = [];
  if (!window.HEALTH_I18N) p.push(_hlLoadScript('/apps/health/i18n.js'));
  if (!window.HealthWidget) p.push(_hlLoadScript('/apps/health/health-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'health',
  name: _hlt('title'),
  icon: '❤️',
  category: 'Health & Fitness',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'health',
      title: '❤️ ' + _hlt('title'),
      width: 520,
      height: 680,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="health-root" style="height:100%"></div>`;
        const root = body.querySelector('#health-root');
        let handle = null;

        _loadHealthAssets().then(() => {
          handle = window.HealthWidget.mount(root, {});
        });

        const observer = new MutationObserver(() => {
          if (!document.body.contains(root)) {
            if (handle) handle.destroy();
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
      },
    });
  },
});
