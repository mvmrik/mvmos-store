// mvmOS App: mvmWarehouse v1.0.0
const _mwhi18n = {
  en: { title: 'mvmWarehouse' },
  bg: { title: 'mvmWarehouse' },
  de: { title: 'mvmWarehouse' },
  es: { title: 'mvmWarehouse' },
  fr: { title: 'mvmWarehouse' },
  ja: { title: 'mvmWarehouse' },
  'pt-BR': { title: 'mvmWarehouse' },
  ru: { title: 'mvmWarehouse' },
  'zh-CN': { title: 'mvmWarehouse' },
};
function _mwht(key) { const lang = window.mvmOS?.lang || 'en'; return (_mwhi18n[lang] || _mwhi18n.en)[key] || key; }

function _mwhLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
async function _loadMvmWarehouseAssets() {
  const files = [
    ['MVMWAREHOUSE_I18N', 'i18n.js'],
    ['MvmWarehouse', 'mvmwarehouse-widget.js'],
  ];
  for (const [global, file] of files) {
    if (!window[global]) await _mwhLoadScript('/apps/mvmwarehouse/' + file);
  }
}

function _mwhOpenWindow() {
  mvmOS.createWindow({
    id: 'mvmwarehouse',
    title: '📦 ' + _mwht('title'),
    width: 1180,
    height: 780,
    onMount(body) {
      body.style.padding = '0';
      body.innerHTML = `<div class="mvmwarehouse-root" style="height:100%"></div>`;
      const root = body.querySelector('.mvmwarehouse-root');
      let handle = null;

      _loadMvmWarehouseAssets().then(() => {
        if (document.body.contains(root)) handle = window.MvmWarehouse.mount(root, { desktop: true });
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
}

mvmOS.registerApp({
  id: 'mvmwarehouse',
  name: _mwht('title'),
  icon: '📦',
  category: 'Business',
  requires_apphub: true,
  launch() { _mwhOpenWindow(); },
});
