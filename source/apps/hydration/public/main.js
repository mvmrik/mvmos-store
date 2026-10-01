// mvmOS App: Hydration v1.0.0
const _hyi18n = {
  en: { title: 'Hydration' },
  bg: { title: 'Хидратация' },
};
function _hyt(key) { const lang = window.mvmOS?.lang || 'en'; return (_hyi18n[lang] || _hyi18n.en)[key] || key; }

function _hyLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadHydrationAssets() {
  const p = [];
  if (!window.HYDRATION_I18N) p.push(_hyLoadScript('/apps/hydration/i18n.js'));
  if (!window.HydrationWidget) p.push(_hyLoadScript('/apps/hydration/hydration-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'hydration',
  name: _hyt('title'),
  icon: '💧',
  category: 'Health & Fitness',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'hydration' }); },
  async renderSettingsExtra(container) {
    // The switch is the owner's, stored server-side (shared by every profile);
    // profiles choose their own amount and categories in the public page.
    // Without Premium it stays visible but locked, and a click opens the
    // Premium dialog.
    try { await _hyLoadScript('/apps/hydration/i18n.js'); } catch {}
    const tt = (k) => (window.t ? window.t(k) : k);
    // The manifest checkbox only makes the settings button appear; the real
    // switch is server-side and drawn below, so the generic row is hidden.
    container.parentNode?.querySelector('input[data-key="budget_reward"]')?.closest('div')?.style.setProperty('display', 'none');
    let live = {};
    try { live = await (await fetch('/api/apps/hydration/settings')).json(); } catch {}
    container.innerHTML = `
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">${tt('hy_owner_section')}</div>
        <label id="hy-se-budget-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="hy-se-budget" ${live.budget_enabled ? 'checked' : ''}>
          <span style="font-size:.84rem">${tt('hy_owner_budget')}</span>
        </label>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;margin-left:24px">${tt('hy_owner_budget_hint')}</div>
      </div>`;
    const row = container.querySelector('#hy-se-budget-row');
    const cb = container.querySelector('#hy-se-budget');
    window.mvmOS?.premiumGate?.(row, tt('hy_owner_budget_hint'));
    cb.onchange = async () => {
      try {
        const r = await fetch('/api/apps/hydration/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budget_enabled: cb.checked }),
        });
        if (!r.ok) throw new Error(r.statusText);
      } catch (e) {
        cb.checked = !cb.checked;
        window.mvmOS?.notify?.(_hyt('title'), tt('hy_owner_error'));
      }
    };
  },
  launch() {
    mvmOS.createWindow({
      id: 'hydration',
      title: '💧 ' + _hyt('title'),
      width: 520,
      height: 680,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'hydration' }); },
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="hydration-root" style="height:100%"></div>`;
        const root = body.querySelector('#hydration-root');
        let handle = null;

        _loadHydrationAssets().then(() => {
          handle = window.HydrationWidget.mount(root, {});
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
