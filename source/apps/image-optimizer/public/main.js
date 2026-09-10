(function () {
  var names = {
    en: 'Image Optimizer', bg: 'Оптимизатор за изображения', de: 'Bildoptimierer',
    es: 'Optimizador de imágenes', fr: "Optimiseur d’images", ja: '画像オプティマイザー',
    'pt-BR': 'Otimizador de imagens', ru: 'Оптимизатор изображений', 'zh-CN': '图像优化器'
  };
  function title() {
    var lang = (window.mvmOS && window.mvmOS.lang) || 'en';
    return names[lang] || names[lang.split('-')[0]] || names.en;
  }
  function load(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src + '?v=' + Date.now();
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  function t(key) { return (window.t && window.t(key)) || (window._i18n && window._i18n[key]) || key; }
  mvmOS.registerApp({
    id: 'image-optimizer',
    name: title(),
    icon: '🖼️',
    category: 'Utilities',
    requires_apphub: true,
    appSettings: true,
    settings: [],
    onAppSettings: function () { AppStore.openWindow({ section: 'my-apps', appId: 'image-optimizer' }); },
    renderSettingsExtra: async function (wrap) {
      await load('/apps/image-optimizer/i18n.js', 'IMAGE_OPTIMIZER_I18N');
      var data = await fetch('/api/apps/image-optimizer/admin/settings').then(function (r) { return r.json(); }).catch(function () { return { premium: false }; });
      wrap.style.cssText = 'position:relative;display:flex;flex-direction:column;gap:10px';
      wrap.innerHTML = '<div style="font-size:.82rem;font-weight:700">' + t('io_admin_title') + '</div><div style="font-size:.75rem;color:var(--text-dim);line-height:1.5">' + t('io_admin_hint') + '</div>' +
        ['archive_upload','resize','bulk_rename','preserve_transparency'].map(function (key) {
          return '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem"><input type="checkbox" data-io-public="' + key + '" ' + (data[key] ? 'checked' : '') + (data.premium ? '' : ' disabled') + '> ' + t('io_admin_' + key) + '</label>';
        }).join('');
      if (!data.premium && window.mvmOS && window.mvmOS.premiumGate) window.mvmOS.premiumGate(wrap, t('io_premium_required'));
    },
    saveSettingsExtra: async function (panel) {
      var values = {};
      panel.querySelectorAll('[data-io-public]').forEach(function (element) { values[element.dataset.ioPublic] = element.checked; });
      if (!Object.keys(values).length) return;
      var response = await fetch('/api/apps/image-optimizer/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      if (!response.ok) throw new Error('premium_required');
    },
    launch: function () {
      mvmOS.createWindow({
        id: 'image-optimizer',
        title: '🖼️ ' + title(),
        width: 980,
        height: 680,
        appSettings: true,
        onAppSettings: function () { AppStore.openWindow({ section: 'my-apps', appId: 'image-optimizer' }); },
        onMount: function (body) {
          body.style.padding = '0';
          var root = document.createElement('div');
          root.style.height = '100%';
          body.appendChild(root);
          var handle = null;
          Promise.all([
            load('/apps/image-optimizer/i18n.js', 'IMAGE_OPTIMIZER_I18N'),
            load('/apps/image-optimizer/image-optimizer.js', 'ImageOptimizer')
          ]).then(function () {
            handle = window.ImageOptimizer.mount(root, {});
          });
          var observer = new MutationObserver(function () {
            if (!document.body.contains(root)) {
              if (handle) handle.destroy();
              observer.disconnect();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }
      });
    }
  });
})();
