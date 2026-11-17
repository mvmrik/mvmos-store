// mvmOS App: Nutrition
const _nui18n = {
  en: { title: 'Nutrition' },
  bg: { title: 'Хранене' },
  de: { title: 'Ernährung' },
  es: { title: 'Alimentación' },
  fr: { title: 'Alimentation' },
  ja: { title: '食事管理' },
  'pt-BR': { title: 'Alimentação' },
  ru: { title: 'Питание' },
  'zh-CN': { title: '饮食' },
};
function _nut(key) { const lang = window.mvmOS?.lang || 'en'; return (_nui18n[lang] || _nui18n.en)[key] || key; }

function _nuLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // window.asset() exists from mvmOS 1.10.0; an older core loads the bare path.
    s.src = window.asset ? window.asset(src) : src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadNutritionAssets() {
  const p = [];
  if (!window.NUTRITION_I18N) p.push(_nuLoadScript('/apps/nutrition/i18n.js'));
  if (!window.NutritionWidget) p.push(_nuLoadScript('/apps/nutrition/nutrition-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'nutrition',
  name: _nut('title'),
  icon: '🥗',
  category: 'Health & Fitness',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'nutrition' }); },
  async renderSettingsExtra(container) {
    // The switch is the owner's, stored server-side (shared by every profile);
    // profiles choose their own amount and categories in the public page.
    // Without Premium it stays visible but locked, and a click opens the
    // Premium dialog.
    try { await _nuLoadScript('/apps/nutrition/i18n.js'); } catch {}
    const tt = (k) => (window.t ? window.t(k) : k);
    // The manifest checkbox only makes the settings button appear; the real
    // switch is server-side and drawn below, so the generic row is hidden.
    container.parentNode?.querySelector('input[data-key="budget_reward"]')?.closest('div')?.style.setProperty('display', 'none');
    let live = {};
    try { live = await (await fetch('/api/apps/nutrition/settings')).json(); } catch {}
    container.innerHTML = `
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">${tt('nu_owner_section')}</div>
        <label id="nu-se-budget-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="nu-se-budget" ${live.budget_enabled ? 'checked' : ''}>
          <span style="font-size:.84rem">${tt('nu_owner_budget')}</span>
        </label>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;margin-left:24px">${tt('nu_owner_budget_hint')}</div>
      </div>`;
    const row = container.querySelector('#nu-se-budget-row');
    const cb = container.querySelector('#nu-se-budget');
    window.mvmOS?.premiumGate?.(row, tt('nu_owner_budget_hint'));
    cb.onchange = async () => {
      try {
        const r = await fetch('/api/apps/nutrition/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budget_enabled: cb.checked }),
        });
        if (!r.ok) throw new Error(r.statusText);
      } catch (e) {
        cb.checked = !cb.checked;
        window.mvmOS?.notify?.(_nut('title'), tt('nu_owner_error'));
      }
    };
  },
  launch() {
    mvmOS.createWindow({
      id: 'nutrition',
      title: '🥗 ' + _nut('title'),
      width: 520,
      height: 680,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'nutrition' }); },
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="nutrition-root" style="height:100%"></div>`;
        const root = body.querySelector('#nutrition-root');
        let handle = null;

        _loadNutritionAssets().then(() => {
          handle = window.NutritionWidget.mount(root, {});
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
