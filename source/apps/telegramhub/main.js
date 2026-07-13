// mvmOS App: Telegram Hub v1.0.0
const t = window.t || (k => k);
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'); }

mvmOS.registerApp({
  id: 'telegramhub',
  name: 'Telegram Hub',
  icon: '✈️',
  category: 'Social',
  launch() {
    mvmOS.createWindow({
      id: 'telegramhub',
      title: '✈️ Telegram Hub',
      width: 520,
      height: 560,
      onMount(body) {
        body.style.cssText = 'padding:0;display:flex;flex-direction:column;height:100%;overflow:hidden';
        _mount(body);
      },
    });
  },
});

function _mount(body) {
  const tabs = [
    { id: 'config', label: t('tgh_tab_bot') },
    { id: 'apps',   label: t('tgh_tab_apps') },
  ];

  body.innerHTML = `
    <div style="display:flex;border-bottom:1px solid var(--border);flex-shrink:0">
      ${tabs.map(t => `<button class="th-tab" data-t="${t.id}"
        style="background:none;border:none;border-bottom:2px solid transparent;padding:10px 14px;font-size:.85rem;color:var(--text-dim);cursor:pointer;font-family:inherit;white-space:nowrap"
        >${t.label}</button>`).join('')}
    </div>
    <div id="th-body" style="flex:1;overflow-y:auto"></div>`;

  function setTab(id) {
    body.querySelectorAll('.th-tab').forEach(t => {
      const active = t.dataset.t === id;
      t.style.color       = active ? 'var(--accent)' : 'var(--text-dim)';
      t.style.borderColor = active ? 'var(--accent)' : 'transparent';
    });
    const c = body.querySelector('#th-body');
    if (id === 'config') renderConfig(c);
    else if (id === 'apps') renderApps(c);
  }

  body.querySelectorAll('.th-tab').forEach(t => { t.onclick = () => setTab(t.dataset.t); });

  // ── Bot config tab ──────────────────────────────────────────
  async function renderConfig(c) {
    c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
    const [cfgR, statsR] = await Promise.all([
      fetch('/api/telegramhub/config').catch(()=>null),
      fetch('/api/telegramhub/stats').catch(()=>null),
    ]);
    const cfg   = cfgR?.ok ? await cfgR.json() : {};
    const stats = statsR?.ok ? await statsR.json() : { linked_chats: 0 };

    c.innerHTML = `
      <div style="padding:16px;display:flex;flex-direction:column;gap:14px;max-width:420px">
        <div style="font-size:.8rem;color:var(--text-dim)">
          ${t('tgh_config_intro', { botfather: '<a href="https://t.me/BotFather" target="_blank" style="color:var(--accent)">@BotFather</a>' })}
        </div>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">${t('tgh_bot_token')}</span>
          <input class="s-inp" id="th-token" placeholder="${cfg.bot_token_set ? t('tgh_bot_token_set_ph', { preview: cfg.bot_token_preview }) : t('tgh_bot_token_ph')}">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">${t('tgh_bot_username')}</span>
          <input class="s-inp" id="th-username" value="${_esc(cfg.bot_username||'')}" placeholder="${t('tgh_bot_username_ph')}">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">${t('tgh_public_base_url')}</span>
          <input class="s-inp" id="th-base" value="${_esc(cfg.public_base_url || location.origin)}" placeholder="${t('tgh_public_base_url_ph')}">
          <span style="font-size:.72rem;color:var(--text-dim)">${t('tgh_public_base_url_hint')}</span>
        </label>
        <div style="display:flex;gap:8px">
          <button class="s-btn" id="th-save" style="background:var(--accent);color:#1e1e2e;font-weight:600">${t('tgh_save')}</button>
          <button class="s-btn" id="th-reg">${t('tgh_register_webhook')}</button>
          <button class="s-btn" id="th-unreg">${t('tgh_unregister')}</button>
        </div>
        <div id="th-msg" style="font-size:.8rem;min-height:16px"></div>
        <div style="border-top:1px solid var(--border);padding-top:12px;font-size:.82rem;color:var(--text-dim)">
          ${t('tgh_linked_chats')} <b style="color:var(--text)">${stats.linked_chats}</b>
        </div>
      </div>`;

    const msg = c.querySelector('#th-msg');
    c.querySelector('#th-save').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = t('tgh_saving');
      const token    = c.querySelector('#th-token').value.trim();
      const username = c.querySelector('#th-username').value.trim();
      const base     = c.querySelector('#th-base').value.trim();
      const r = await fetch('/api/telegramhub/config', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ bot_token: token || undefined, bot_username: username, public_base_url: base }),
      }).catch(()=>null);
      msg.style.color = r?.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = r?.ok ? t('tgh_saved') : t('tgh_save_failed');
      if (r?.ok) renderConfig(c);
    };
    c.querySelector('#th-reg').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = t('tgh_registering');
      const r = await fetch('/api/telegramhub/webhook/register', { method: 'POST' }).catch(()=>null);
      const d = r ? await r.json().catch(()=>({})) : {};
      msg.style.color = d.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = d.ok ? t('tgh_webhook_registered') : (d.detail || d.description || t('tgh_webhook_register_failed'));
    };
    c.querySelector('#th-unreg').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = t('tgh_unregistering');
      const r = await fetch('/api/telegramhub/webhook/unregister', { method: 'POST' }).catch(()=>null);
      const d = r ? await r.json().catch(()=>({})) : {};
      msg.style.color = d.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = d.ok ? t('tgh_webhook_removed') : t('tgh_webhook_unregister_failed');
    };
  }

  // ── Apps tab ────────────────────────────────────────────────
  async function renderApps(c) {
    c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
    const [r, sortR] = await Promise.all([
      fetch('/api/telegramhub/apps').catch(()=>null),
      fetch('/api/telegramhub/apps-sort').catch(()=>null),
    ]);
    if (!r?.ok) { c.innerHTML = `<div style="padding:20px;color:#f38ba8;font-size:.85rem">${t('tgh_error_loading_apps')}</div>`; return; }
    const apps = await r.json();
    const sortMode = sortR?.ok ? (await sortR.json()).mode : 'alpha';
    if (!apps.length) {
      c.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">${t('tgh_no_apps_detected')}</div>`;
      return;
    }
    c.innerHTML = `
      <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
        ${t('tgh_apps_intro', { code: '<code>telegram.py</code>' })}
      </div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px 0">
        <span style="font-size:.78rem;color:var(--text-dim)">${t('tgh_apps_order')}</span>
        <select class="s-inp" id="th-apps-sort" style="width:auto;padding:5px 10px;font-size:.8rem">
          <option value="alpha"${sortMode==='alpha'?' selected':''}>${t('tgh_sort_alpha')}</option>
          <option value="recent"${sortMode==='recent'?' selected':''}>${t('tgh_sort_recent')}</option>
          <option value="frequent"${sortMode==='frequent'?' selected':''}>${t('tgh_sort_frequent')}</option>
        </select>
      </div>
      <div id="th-apps-list"></div>`;

    c.querySelector('#th-apps-sort').onchange = async (e) => {
      await fetch('/api/telegramhub/apps-sort', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ mode: e.target.value }),
      });
    };

    function render(list) {
      list.innerHTML = apps.map(a => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
          <span style="font-size:1.4rem">${_esc(a.icon)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.88rem;font-weight:500">${_esc(a.name)}</div>
          </div>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0" title="${t('tgh_admin_only_title')}">
            <input type="checkbox" class="th-admin-only" data-id="${a.id}" ${a.admin_only?'checked':''} style="width:15px;height:15px;cursor:pointer">
            <span style="font-size:.78rem;color:${a.admin_only?'var(--accent)':'var(--text-dim)'}">${t('tgh_admin_only')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
            <input type="checkbox" class="th-enabled" data-id="${a.id}" ${a.enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
            <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?t('tgh_enabled'):t('tgh_disabled')}</span>
          </label>
        </div>`).join('');

      async function push(app) {
        await fetch(`/api/telegramhub/apps/${app.id}`, {
          method: 'PUT',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({enabled: app.enabled, admin_only: app.admin_only}),
        });
      }

      list.querySelectorAll('.th-enabled').forEach(cb => {
        cb.onchange = async () => {
          const app = apps.find(x => x.id === cb.dataset.id);
          if (!app) return;
          app.enabled = cb.checked;
          await push(app);
          render(list);
        };
      });
      list.querySelectorAll('.th-admin-only').forEach(cb => {
        cb.onchange = async () => {
          const app = apps.find(x => x.id === cb.dataset.id);
          if (!app) return;
          app.admin_only = cb.checked;
          await push(app);
          render(list);
        };
      });
    }
    render(c.querySelector('#th-apps-list'));
  }

  setTab('config');
}
