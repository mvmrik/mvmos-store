// mvmOS App: Telegram Hub v1.0.0
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
    { id: 'config', label: '⚙️ Bot' },
    { id: 'apps',   label: '🔲 Apps' },
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
          Create a bot with <a href="https://t.me/BotFather" target="_blank" style="color:var(--accent)">@BotFather</a>,
          paste its token below, then register the webhook.
        </div>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">Bot token</span>
          <input class="s-inp" id="th-token" placeholder="${cfg.bot_token_set ? cfg.bot_token_preview + ' (set — leave blank to keep)' : '123456:ABC-...'}">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">Bot username (without @, shown on the public page)</span>
          <input class="s-inp" id="th-username" value="${_esc(cfg.bot_username||'')}" placeholder="my_mvmos_bot">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="font-size:.78rem;color:var(--text-dim)">Public base URL</span>
          <input class="s-inp" id="th-base" value="${_esc(cfg.public_base_url || location.origin)}" placeholder="https://your-domain.com">
          <span style="font-size:.72rem;color:var(--text-dim)">Must be a public HTTPS address (Telegram requires HTTPS for webhooks).</span>
        </label>
        <div style="display:flex;gap:8px">
          <button class="s-btn" id="th-save" style="background:var(--accent);color:#1e1e2e;font-weight:600">Save</button>
          <button class="s-btn" id="th-reg">Register webhook</button>
          <button class="s-btn" id="th-unreg">Unregister</button>
        </div>
        <div id="th-msg" style="font-size:.8rem;min-height:16px"></div>
        <div style="border-top:1px solid var(--border);padding-top:12px;font-size:.82rem;color:var(--text-dim)">
          Linked Telegram chats: <b style="color:var(--text)">${stats.linked_chats}</b>
        </div>
      </div>`;

    const msg = c.querySelector('#th-msg');
    c.querySelector('#th-save').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = 'Saving…';
      const token    = c.querySelector('#th-token').value.trim();
      const username = c.querySelector('#th-username').value.trim();
      const base     = c.querySelector('#th-base').value.trim();
      const r = await fetch('/api/telegramhub/config', {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ bot_token: token || undefined, bot_username: username, public_base_url: base }),
      }).catch(()=>null);
      msg.style.color = r?.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = r?.ok ? 'Saved.' : 'Failed to save.';
      if (r?.ok) renderConfig(c);
    };
    c.querySelector('#th-reg').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = 'Registering…';
      const r = await fetch('/api/telegramhub/webhook/register', { method: 'POST' }).catch(()=>null);
      const d = r ? await r.json().catch(()=>({})) : {};
      msg.style.color = d.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = d.ok ? 'Webhook registered.' : (d.detail || d.description || 'Failed to register webhook.');
    };
    c.querySelector('#th-unreg').onclick = async () => {
      msg.style.color = 'var(--text-dim)'; msg.textContent = 'Unregistering…';
      const r = await fetch('/api/telegramhub/webhook/unregister', { method: 'POST' }).catch(()=>null);
      const d = r ? await r.json().catch(()=>({})) : {};
      msg.style.color = d.ok ? '#a6e3a1' : '#f38ba8';
      msg.textContent = d.ok ? 'Webhook removed.' : 'Failed to unregister webhook.';
    };
  }

  // ── Apps tab ────────────────────────────────────────────────
  async function renderApps(c) {
    c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">…</div>';
    const [r, sortR] = await Promise.all([
      fetch('/api/telegramhub/apps').catch(()=>null),
      fetch('/api/telegramhub/apps-sort').catch(()=>null),
    ]);
    if (!r?.ok) { c.innerHTML = '<div style="padding:20px;color:#f38ba8;font-size:.85rem">Error loading apps</div>'; return; }
    const apps = await r.json();
    const sortMode = sortR?.ok ? (await sortR.json()).mode : 'alpha';
    if (!apps.length) {
      c.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem;text-align:center">No apps with a telegram.py adapter detected yet.</div>';
      return;
    }
    c.innerHTML = `
      <div style="padding:12px 16px;font-size:.78rem;color:var(--text-dim);border-bottom:1px solid var(--border)">
        Apps with a <code>telegram.py</code> adapter are detected automatically. Toggle to show them in the bot's menu.
      </div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:10px 16px 0">
        <span style="font-size:.78rem;color:var(--text-dim)">Order shown in bot menu</span>
        <select class="s-inp" id="th-apps-sort" style="width:auto;padding:5px 10px;font-size:.8rem">
          <option value="alpha"${sortMode==='alpha'?' selected':''}>Alphabetical</option>
          <option value="recent"${sortMode==='recent'?' selected':''}>Recently used</option>
          <option value="frequent"${sortMode==='frequent'?' selected':''}>Most used</option>
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
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0" title="Only visible to Telegram accounts linked to an Apps Hub admin profile">
            <input type="checkbox" class="th-admin-only" data-id="${a.id}" ${a.admin_only?'checked':''} style="width:15px;height:15px;cursor:pointer">
            <span style="font-size:.78rem;color:${a.admin_only?'var(--accent)':'var(--text-dim)'}">Admin only</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
            <input type="checkbox" class="th-enabled" data-id="${a.id}" ${a.enabled?'checked':''} style="width:16px;height:16px;cursor:pointer">
            <span style="font-size:.8rem;color:${a.enabled?'var(--accent)':'var(--text-dim)'}">${a.enabled?'Enabled':'Disabled'}</span>
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
