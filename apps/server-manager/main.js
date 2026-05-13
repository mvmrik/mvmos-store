// mvmOS App: Server Manager v1.0.0
mvmOS.registerApp({
  id: 'server-manager',
  name: 'Server Manager',
  icon: '🖧',
  category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'server-manager',
      title: '🖧 Server Manager',
      width: 620,
      height: 460,
      onMount(body) { SM.render(body); }
    });
  }
});

const SM = (() => {
  let _sudoPassword = '';
  let _sudoNeeded = false;

  function render(body) {
    body.style.padding = '0';
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:var(--surface)">

        <!-- sudo bar -->
        <div id="sm-sudo-bar" style="display:none;align-items:center;gap:8px;padding:8px 14px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:#f1fa8c">⚠️ Root password required</span>
          <input id="sm-sudo-input" type="password" placeholder="sudo password…"
            style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.82rem">
          <button class="s-btn s-btn-sm" id="sm-sudo-ok">OK</button>
          <button class="s-btn s-btn-sm" id="sm-sudo-cancel" style="opacity:.6">Cancel</button>
        </div>

        <!-- toolbar -->
        <div style="display:flex;align-items:center;padding:10px 14px;gap:8px;border-bottom:1px solid var(--border)">
          <span style="font-size:.8rem;color:var(--text-dim);flex:1">Detected system services</span>
          <button class="s-btn s-btn-sm" id="sm-refresh">↺ Refresh</button>
        </div>

        <!-- service list -->
        <div id="sm-list" style="flex:1;overflow-y:auto;padding:8px 0">
          <div style="padding:20px;color:var(--text-dim);font-size:.85rem">Loading…</div>
        </div>

      </div>
    `;

    body.querySelector('#sm-refresh').addEventListener('click', () => loadServices(body));
    body.querySelector('#sm-sudo-ok').addEventListener('click', () => confirmSudo(body));
    body.querySelector('#sm-sudo-cancel').addEventListener('click', () => hideSudoBar(body));
    body.querySelector('#sm-sudo-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmSudo(body);
    });

    loadServices(body);
  }

  async function loadServices(body) {
    const list = body.querySelector('#sm-list');
    list.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">Loading…</div>';
    const res = await fetch('/api/system/services');
    const services = await res.json();

    if (!services.length) {
      list.innerHTML = '<div style="padding:20px;color:var(--text-dim);font-size:.85rem">No known services detected.</div>';
      return;
    }

    list.innerHTML = '';
    services.forEach(svc => {
      const row = document.createElement('div');
      row.dataset.name = svc.name;
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:.85rem';

      const isActive = svc.status === 'active';
      const isFailed = svc.status === 'failed';

      row.innerHTML = `
        <span style="font-size:1.1rem;width:24px;text-align:center">${svc.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:var(--text)">${svc.label}</div>
          <div style="font-size:.75rem;color:var(--text-dim);font-family:monospace">${svc.name}</div>
        </div>
        <span class="sm-status-badge" style="font-size:.72rem;padding:2px 8px;border-radius:3px;font-weight:600;
          ${isActive ? 'color:#50fa7b;background:rgba(80,250,123,.12);border:1px solid rgba(80,250,123,.3)'
                     : isFailed ? 'color:#ff5555;background:rgba(255,85,85,.12);border:1px solid rgba(255,85,85,.3)'
                     : 'color:#6272a4;background:rgba(98,114,164,.1);border:1px solid rgba(98,114,164,.25)'}">
          ${svc.status}
        </span>
        <div style="display:flex;gap:4px">
          ${isActive
            ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${svc.name}" title="Restart">↺</button>
               <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${svc.name}" title="Stop">■ Stop</button>`
            : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${svc.name}" title="Start">▶ Start</button>`
          }
        </div>
      `;

      row.querySelectorAll('.sm-action').forEach(btn => {
        btn.addEventListener('click', () => doAction(body, svc.name, btn.dataset.action, row));
      });

      list.appendChild(row);
    });
  }

  let _pendingAction = null;

  async function doAction(body, name, action, row) {
    const res = await callAction(body, name, action);
    if (res === 'sudo_needed') {
      _pendingAction = { body, name, action, row };
      showSudoBar(body);
      return;
    }
    if (res?.ok) updateRow(row, res.status);
  }

  async function callAction(body, name, action, sudoPassword = '') {
    const r = await fetch('/api/system/services/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, action, sudo_password: sudoPassword }),
    });
    if (r.status === 403) return 'sudo_needed';
    const data = await r.json();
    if (data.error && data.error !== 'permission_denied') {
      mvmOS.notify('Service error', data.detail || data.error);
      return null;
    }
    if (data.error === 'permission_denied') return 'sudo_needed';
    return data;
  }

  function showSudoBar(body) {
    _sudoNeeded = true;
    const bar = body.querySelector('#sm-sudo-bar');
    bar.style.display = 'flex';
    body.querySelector('#sm-sudo-input').value = '';
    body.querySelector('#sm-sudo-input').focus();
  }

  function hideSudoBar(body) {
    body.querySelector('#sm-sudo-bar').style.display = 'none';
    _sudoNeeded = false;
    _pendingAction = null;
  }

  async function confirmSudo(body) {
    const pwd = body.querySelector('#sm-sudo-input').value;
    if (!pwd || !_pendingAction) return;
    _sudoPassword = pwd;
    hideSudoBar(body);
    const { name, action, row } = _pendingAction;
    _pendingAction = null;
    const res = await callAction(body, name, action, _sudoPassword);
    if (res === 'sudo_needed') {
      mvmOS.notify('Authentication failed', 'Incorrect sudo password.');
      _sudoPassword = '';
      return;
    }
    if (res?.ok) updateRow(row, res.status);
  }

  function updateRow(row, status) {
    const isActive = status === 'active';
    const isFailed = status === 'failed';
    const badge = row.querySelector('.sm-status-badge');
    if (badge) {
      badge.textContent = status;
      badge.style.cssText = `font-size:.72rem;padding:2px 8px;border-radius:3px;font-weight:600;
        ${isActive ? 'color:#50fa7b;background:rgba(80,250,123,.12);border:1px solid rgba(80,250,123,.3)'
                   : isFailed ? 'color:#ff5555;background:rgba(255,85,85,.12);border:1px solid rgba(255,85,85,.3)'
                   : 'color:#6272a4;background:rgba(98,114,164,.1);border:1px solid rgba(98,114,164,.25)'}`;
    }
    // refresh buttons
    const btns = row.querySelector('div[style*="gap:4px"]');
    if (btns) {
      const name = row.dataset.name;
      btns.innerHTML = isActive
        ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${name}" title="Restart">↺</button>
           <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${name}" title="Stop">■ Stop</button>`
        : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${name}" title="Start">▶ Start</button>`;
      btns.querySelectorAll('.sm-action').forEach(btn => {
        btn.addEventListener('click', () => doAction(row.closest('[style*="flex:1"]')?.closest('[style*="flex-direction"]')?.closest('.window-body') || document.body, name, btn.dataset.action, row));
      });
    }
  }

  return { render };
})();
