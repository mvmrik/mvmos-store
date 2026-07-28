// mvmOS App: Shopping List v1.0.0
const _slti18n = {
  en: { title: 'Shopping List' },
  bg: { title: 'Списък за пазаруване' },
};
function _slt(key) { const lang = window.mvmOS?.lang || 'en'; return (_slti18n[lang] || _slti18n.en)[key] || key; }

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadShoppingListAssets() {
  const p = [];
  if (!window.SHOPPINGLIST_I18N) p.push(_loadScript('/apps/shoppinglist/i18n.js'));
  if (!window.ShoppingListWidget) p.push(_loadScript('/apps/shoppinglist/shoppinglist-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'shoppinglist',
  name: _slt('title'),
  icon: '🛒',
  category: 'Productivity',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'shoppinglist',
      title: '🛒 ' + _slt('title'),
      width: 900,
      height: 640,
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="shoppinglist-root" style="height:100%"></div>`;
        const root = body.querySelector('#shoppinglist-root');
        let handle = null;

        _loadShoppingListAssets().then(() => {
          handle = window.ShoppingListWidget.mount(root, {});
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
