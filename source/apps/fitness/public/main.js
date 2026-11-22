// mvmOS App: Fitness
const _fii18n = {
  en: { title: 'Fitness' },
  bg: { title: 'Фитнес' },
  de: { title: 'Fitness' },
  es: { title: 'Fitness' },
  fr: { title: 'Fitness' },
  ja: { title: 'フィットネス' },
  'pt-BR': { title: 'Fitness' },
  ru: { title: 'Фитнес' },
  'zh-CN': { title: '健身' },
};
function _fit(key) { const lang = window.mvmOS?.lang || 'en'; return (_fii18n[lang] || _fii18n.en)[key] || key; }

function _fiLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // window.asset() exists from mvmOS 1.10.0; an older core loads the bare path.
    s.src = window.asset ? window.asset(src) : src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadFitnessAssets() {
  const p = [];
  if (!window.FITNESS_I18N) p.push(_fiLoadScript('/apps/fitness/i18n.js'));
  if (!window.FitnessWidget) p.push(_fiLoadScript('/apps/fitness/fitness-widget.js'));
  return Promise.all(p);
}

mvmOS.registerApp({
  id: 'fitness',
  name: _fit('title'),
  icon: '🏋️',
  category: 'Health & Fitness',
  requires_apphub: true,
  appSettings: true,
  onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'fitness' }); },
  async renderSettingsExtra(container) {
    // The switch is the owner's, stored server-side (shared by every profile).
    // Without Premium it stays visible but locked, and a click opens the
    // Premium dialog.
    try { await _fiLoadScript('/apps/fitness/i18n.js'); } catch {}
    const tt = (k) => (window.t ? window.t(k) : k);
    let live = {};
    try { live = await (await fetch('/api/apps/fitness/settings')).json(); } catch {}
    container.innerHTML = `
      <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">${tt('fi_owner_section')}</div>
        <label id="fi-se-ai-row" style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="fi-se-ai" ${live.ai_enabled ? 'checked' : ''}>
          <span style="font-size:.84rem">${tt('fi_owner_ai')}</span>
        </label>
        <div style="font-size:.72rem;color:var(--text-dim);margin-top:6px;margin-left:24px">${tt('fi_owner_ai_hint')}</div>
      </div>`;
    const row = container.querySelector('#fi-se-ai-row');
    const box = container.querySelector('#fi-se-ai');
    window.mvmOS?.premiumGate?.(row, tt('fi_owner_ai_hint'));
    box.onchange = async () => {
      try {
        const r = await fetch('/api/apps/fitness/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_enabled: box.checked }),
        });
        if (!r.ok) throw new Error(r.statusText);
      } catch (e) {
        box.checked = !box.checked;
        window.mvmOS?.notify?.(_fit('title'), tt('fi_owner_error'));
      }
    };
  },
  launch() {
    mvmOS.createWindow({
      id: 'fitness',
      title: '🏋️ ' + _fit('title'),
      width: 520,
      height: 700,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'fitness' }); },
      onMount(body) {
        body.style.padding = '0';
        body.innerHTML = `<div id="fitness-root" style="height:100%"></div>`;
        const root = body.querySelector('#fitness-root');
        let handle = null;

        _loadFitnessAssets().then(() => {
          handle = window.FitnessWidget.mount(root, {});
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
