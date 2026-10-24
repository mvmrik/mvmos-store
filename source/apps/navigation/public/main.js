// mvmOS App: Navigation
function _nvLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // window.asset() exists from mvmOS 1.10.0; an older core loads the bare path.
    s.src = window.asset ? window.asset(src) : src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadNavigationAssets() {
  const p = [];
  if (!window.NAVIGATION_I18N) p.push(_nvLoadScript('/apps/navigation/i18n.js'));
  if (!window.NavigationWidget) p.push(_nvLoadScript('/apps/navigation/navigation-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'navigation',
  name: 'Navigation',
  icon: '🧭',
  category: 'Utilities',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'navigation' }); },
  launch() {
    mvmOS.createWindow({
      id: 'navigation',
      title: '🧭 Navigation',
      width: 980,
      height: 680,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'navigation' }); },
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="navigation-root" style="height:100%"></div>`;
        const root = body.querySelector('#navigation-root');
        let handle = null;

        _loadNavigationAssets().then(() => {
          handle = window.NavigationWidget.mount(root, {});
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
