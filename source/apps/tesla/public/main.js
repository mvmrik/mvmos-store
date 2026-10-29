// mvmOS App: Tesla
function _tslLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // window.asset() exists from mvmOS 1.10.0; an older core loads the bare path.
    s.src = window.asset ? window.asset(src) : src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadTeslaAssets() {
  const first = window.TESLA_I18N ? Promise.resolve() : _tslLoadScript('/apps/tesla/i18n.js');
  return first
    .then(() => window.mvmOS.dateTimePicker ? null : _tslLoadScript('/datetime-picker.js'))
    .then(() => window.TeslaViz ? null : _tslLoadScript('/apps/tesla/tesla-viz.js'))
    .then(() => window.TeslaWidget ? null : _tslLoadScript('/apps/tesla/tesla-widget.js'));
}

mvmOS.registerApp({
  id: 'tesla',
  name: 'Tesla',
  icon: '🚗',
  category: 'Utilities',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'tesla' }); },
  async renderSettingsExtra(container) {
    await _loadTeslaAssets();
    if (!window.TeslaServerSettings) await _tslLoadScript('/apps/tesla/tesla-server.js');
    await window.TeslaServerSettings(container);
  },
  launch() {
    mvmOS.createWindow({
      id: 'tesla',
      title: mvmOS.iconHTML ? mvmOS.iconHTML(mvmOS._apps?.tesla || {icon: '🚗'}) + ' Tesla' : '🚗 Tesla',
      width: 1040,
      height: 720,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'tesla' }); },
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="tesla-root" style="height:100%"></div>`;
        const root = body.querySelector('#tesla-root');
        let handle = null;

        _loadTeslaAssets().then(() => {
          handle = window.TeslaWidget.mount(root, {desktop: true});
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
