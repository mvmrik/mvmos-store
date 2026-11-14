(function () {
  let handle, pending;
  const load = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = window.asset(src);
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  async function assets() {
    if (!pending)
      pending = (async () => {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = window.asset('/apps/mvmdesign/design.css');
        document.head.appendChild(css);
        for (const [key, file] of [
          ['MvmDesignI18n', 'i18n.js'],
          ['MvmDesignModel', 'model.js'],
          ['MvmDesignRender', 'render.js'],
          ['MvmDesignExport', 'export.js'],
          ['MvmDesignProjects', 'projects.js'],
          ['MvmDesignAI', 'ai.js'],
          ['MvmDesign', 'editor.js'],
        ]) {
          if (!window[key]) await load('/apps/mvmdesign/' + file);
        }
      })().catch((e) => {
        pending = null;
        throw e;
      });
    return pending;
  }
  function open(path) {
    if (handle && document.body.contains(handle.root)) {
      mvmOS.createWindow({ id: 'mvmdesign' });
      if (path) handle.openPath(path).catch((e) => handle.error(e));
      return;
    }
    mvmOS.createWindow({
      id: 'mvmdesign',
      title: '✨ mvmDesign',
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'mvmdesign' }); },
      width: 1380,
      height: 870,
      onMount(body) {
        body.style.padding = '0';
        const root = document.createElement('div');
        root.style.height = '100%';
        body.appendChild(root);
        assets()
          .then(async () => {
            if (root.isConnected) {
              handle = new window.MvmDesign.Editor(root);
              const editor = handle;
              await editor.ready;
              if (!root.isConnected) return;
              if (path) await editor.openPath(path);
              else await editor.projectDialog();
            }
          })
          .catch((e) => {
            root.textContent = String(e.message);
          });
        const obs = new MutationObserver(() => {
          if (!root.isConnected) {
            if (handle?.root === root) {
              handle.destroy();
              handle = null;
            }
            obs.disconnect();
          }
        });
        obs.observe(document.body, { subtree: true, childList: true });
      },
    });
  }
  mvmOS.registerApp({
    id: 'mvmdesign',
    name: 'mvmDesign',
    icon: '✨',
    iconImage: window.asset('/apps/mvmdesign/icon.svg'),
    category: 'Creative',
    requires_apphub: true,
    appSettings: true,
    settings: [],
    onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'mvmdesign' }); },
    async renderSettingsExtra(wrap) {
      await assets();
      const t = k => (window.MvmDesignI18n[window.mvmOS?.lang || 'en'] || window.MvmDesignI18n.en)[k] || window.MvmDesignI18n.en[k];
      const response = await fetch('/api/apps/mvmdesign/admin/settings', { cache: 'no-store' });
      if (!response.ok) throw Error(t('accessDenied'));
      const data = await response.json();
      wrap.replaceChildren();
      const heading = document.createElement('strong'); heading.textContent = t('aiSettings'); wrap.appendChild(heading);
      const hint = document.createElement('p'); hint.textContent = t('aiAdminHint'); wrap.appendChild(hint);
      for (const key of ['assistant', 'images', 'public']) {
        const label = document.createElement('label'); label.style.cssText = 'display:flex;align-items:center;gap:10px;margin:10px 0';
        const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.designAi = key;
        input.disabled = !data.premium; input.checked = !!data[key];
        const text = document.createElement('span'); text.textContent = t('aiSetting_' + key); label.append(input, text); wrap.appendChild(label);
      }
      if (!data.premium) window.mvmOS?.premiumGate?.(wrap, t('aiPremium'));
    },
    async saveSettingsExtra(panel) {
      const inputs = [...panel.querySelectorAll('[data-design-ai]')];
      if (!inputs.length || inputs.every(el => el.disabled)) return;
      const values = Object.fromEntries(inputs.map(el => [el.dataset.designAi, el.checked]));
      const response = await fetch('/api/apps/mvmdesign/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-MvmDesign': '1' }, body: JSON.stringify(values) });
      if (!response.ok) throw Error('aiUnavailable');
    },
    file_types: ['mvmdesign'],
    launch() {
      open();
    },
    openFile: open,
  });
})();
