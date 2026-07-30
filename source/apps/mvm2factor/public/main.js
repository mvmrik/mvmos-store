// mvmOS App: mvm2factor
const _m2fTitleStrings = {
  en: { title: 'mvm2factor' },
  bg: { title: 'mvm2factor' },
};
function _m2fTitle(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_m2fTitleStrings[lang] || _m2fTitleStrings.en)[key] || key;
}

function _m2fLoadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src + '?_=' + Date.now();
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function _m2fLoadAssets() {
  const pending = [];
  if (!window.MVM2FACTOR_I18N) pending.push(_m2fLoadScript('/apps/mvm2factor/i18n.js'));
  if (!window.Mvm2FactorWidget) pending.push(_m2fLoadScript('/apps/mvm2factor/mvm2factor-widget.js'));
  return Promise.all(pending);
}

mvmOS.registerApp({
  id: 'mvm2factor',
  name: _m2fTitle('title'),
  icon: '🔐',
  category: 'Security & Privacy',
  requires_apphub: true,

  launch() {
    mvmOS.createWindow({
      id: 'mvm2factor',
      title: '🔐 ' + _m2fTitle('title'),
      width: 430,
      height: 620,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = '<div id="m2f-root" style="height:100%"></div>';
        const root = body.querySelector('#m2f-root');
        let handle = null;

        _m2fLoadAssets().then(() => {
          handle = window.Mvm2FactorWidget.mount(root, {});
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
