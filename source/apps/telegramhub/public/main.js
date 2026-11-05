// mvmOS App: Telegram Hub
const t = window.t || (k => k);
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + '?_=' + Date.now();
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
function _loadTelegramHubI18n() {
  return window.TELEGRAMHUB_I18N ? Promise.resolve() : _loadScript('/apps/telegramhub/i18n.js');
}

mvmOS.registerApp({
  id: 'telegramhub',
  name: 'Telegram Hub',
  icon: '✈️',
  category: 'Communication',
  launch() {
    mvmOS.createWindow({
      id: 'telegramhub',
      title: '✈️ Telegram Hub',
      width: 480,
      height: 460,
      onMount(body) {
        body.style.cssText = 'padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden';
        _loadTelegramHubI18n().then(() => _mount(body));
      },
    });
  },
});

function _mount(body) {
  body.innerHTML = '<div id="th-body" style="flex:1;overflow-y:auto"></div>';
  const c = body.querySelector('#th-body');

  async function render() {
    c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
    const r = await fetch('/api/telegramhub/config').catch(() => null);
    const cfg = r?.ok ? await r.json() : {};

    c.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px;max-width:420px">
        <div style="font-size:.8rem;color:var(--text-dim)">${t('tgh_admin_intro')}</div>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">${t('tgh_public_base_url')}</span>
          <input class="s-inp" id="th-base" value="${_esc(cfg.public_base_url || location.origin)}" placeholder="${t('tgh_public_base_url_ph')}">
          <span style="font-size:.72rem;color:var(--text-dim)">${t('tgh_public_base_url_hint')}</span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
          <input type="checkbox" id="th-custom" ${cfg.custom_enabled ? 'checked' : ''} style="width:16px;height:16px;margin-top:2px;cursor:pointer">
          <span>
            <span style="font-size:.85rem">${t('tgh_custom')}</span><br>
            <span style="font-size:.72rem;color:var(--text-dim)">${t('tgh_custom_hint')}</span>
          </span>
        </label>
        <div style="display:flex;gap:8px">
          <button class="s-btn" id="th-save" style="background:var(--accent);color:var(--on-accent,var(--surface,var(--surface1,#1e1e2e)));font-weight:600">${t('tgh_save')}</button>
          <a class="s-btn" href="/pub/telegramhub/" target="_blank" style="text-decoration:none">${t('tgh_open_page')}</a>
        </div>
        <div id="th-msg" style="font-size:.8rem;min-height:16px"></div>
        <div style="border-top:1px solid var(--border);padding-top:12px;font-size:.82rem;color:var(--text-dim)">
          ${t('tgh_bots_count')} <b style="color:var(--text)">${cfg.bots || 0}</b>
          · ${t('tgh_bots_linked')} <b style="color:var(--text)">${cfg.linked || 0}</b>
        </div>
      </div>`;

    const msg = c.querySelector('#th-msg');
    const custom = c.querySelector('#th-custom');
    // Without a licence the checkbox stays visible and opens the premium prompt.
    window.mvmOS.premiumGate(custom, t('tgh_custom_premium'));

    c.querySelector('#th-save').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = t('tgh_saving');
      const res = await fetch('/api/telegramhub/config', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          public_base_url: c.querySelector('#th-base').value.trim(),
          custom_enabled: custom.checked,
        }),
      }).catch(() => null);
      if (res?.status === 402) custom.checked = false;
      msg.style.color = res?.ok ? 'color-mix(in srgb,#a6e3a1 35%,var(--text))' : 'color-mix(in srgb,#f38ba8 35%,var(--text))';
      msg.textContent = res?.ok ? t('tgh_saved') : t('tgh_save_failed');
      if (res?.ok) render();
    };
  }

  render();
}
