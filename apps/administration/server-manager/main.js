// mvmOS App: Server Manager v1.0.0
const _sm18n = {
  en: {
    title: 'Server Manager', sudo_msg: '⚠️ Root password required', sudo_ph: 'sudo password…',
    ok: 'OK', cancel: 'Cancel', detected: 'Detected system services',
    refresh: '↺ Refresh', loading: 'Loading…', no_services: 'No known services detected.',
    restart: '↺', stop: '■ Stop', start: '▶ Start',
    svc_error: 'Service error', auth_failed: 'Authentication failed', wrong_sudo: 'Incorrect sudo password.',
  },
  bg: {
    title: 'Мениджър на услуги', sudo_msg: '⚠️ Необходима е root парола', sudo_ph: 'sudo парола…',
    ok: 'OK', cancel: 'Отказ', detected: 'Открити системни услуги',
    refresh: '↺ Обнови', loading: 'Зареждане…', no_services: 'Няма открити известни услуги.',
    restart: '↺', stop: '■ Спри', start: '▶ Стартирай',
    svc_error: 'Грешка на услугата', auth_failed: 'Грешка при автентикация', wrong_sudo: 'Грешна sudo парола.',
  },
};
function _smt(key) { const lang = window.mvmOS?.lang || 'en'; return (_sm18n[lang] || _sm18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'server-manager', name: _smt('title'), icon: '🖧', category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'server-manager', title: '🖧 ' + _smt('title'), width: 620, height: 460,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => SM.render(body)); },
    });
  }
});

const SM = (() => {
  let _sudoPassword = '', _sudoNeeded = false;

  function render(body) {
    body.style.padding = '0';
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:var(--surface)">
        <div id="sm-sudo-bar" style="display:none;align-items:center;gap:8px;padding:8px 14px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:#f1fa8c">${_smt('sudo_msg')}</span>
          <input id="sm-sudo-input" type="password" placeholder="${_smt('sudo_ph')}"
            style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.82rem">
          <button class="s-btn s-btn-sm" id="sm-sudo-ok">${_smt('ok')}</button>
          <button class="s-btn s-btn-sm" id="sm-sudo-cancel" style="opacity:.6">${_smt('cancel')}</button>
        </div>
        <div style="display:flex;align-items:center;padding:10px 14px;gap:8px;border-bottom:1px solid var(--border)">
          <span style="font-size:.8rem;color:var(--text-dim);flex:1">${_smt('detected')}</span>
          <button class="s-btn s-btn-sm" id="sm-refresh">${_smt('refresh')}</button>
        </div>
        <div id="sm-list" style="flex:1;overflow-y:auto;padding:8px 0">
          <div style="padding:20px;color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
        </div>
      </div>
    `;
    body.querySelector('#sm-refresh').addEventListener('click', () => loadServices(body));
    body.querySelector('#sm-sudo-ok').addEventListener('click', () => confirmSudo(body));
    body.querySelector('#sm-sudo-cancel').addEventListener('click', () => hideSudoBar(body));
    body.querySelector('#sm-sudo-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSudo(body); });
    loadServices(body);
    window.mvmOS?.onLangChange(() => render(body));
  }

  async function loadServices(body) {
    const list = body.querySelector('#sm-list');
    list.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>`;
    const services = await mvmOS.system.services();
    if (!services.length) { list.innerHTML = `<div style="padding:20px;color:var(--text-dim);font-size:.85rem">${_smt('no_services')}</div>`; return; }
    list.innerHTML = '';
    services.forEach(svc => {
      const row = document.createElement('div');
      row.dataset.name = svc.name;
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border);font-size:.85rem';
      const isActive = svc.status === 'active', isFailed = svc.status === 'failed';
      row.innerHTML = `
        <span style="font-size:1.1rem;width:24px;text-align:center">${svc.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:var(--text)">${svc.label}</div>
          <div style="font-size:.75rem;color:var(--text-dim);font-family:monospace">${svc.name}</div>
        </div>
        <span class="sm-status-badge" style="font-size:.72rem;padding:2px 8px;border-radius:3px;font-weight:600;
          ${isActive ? 'color:#50fa7b;background:rgba(80,250,123,.12);border:1px solid rgba(80,250,123,.3)'
                     : isFailed ? 'color:#ff5555;background:rgba(255,85,85,.12);border:1px solid rgba(255,85,85,.3)'
                     : 'color:#6272a4;background:rgba(98,114,164,.1);border:1px solid rgba(98,114,164,.25)'}">${svc.status}</span>
        <div style="display:flex;gap:4px">
          ${isActive
            ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${svc.name}" title="Restart">${_smt('restart')}</button>
               <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${svc.name}">${_smt('stop')}</button>`
            : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${svc.name}">${_smt('start')}</button>`}
        </div>`;
      row.querySelectorAll('.sm-action').forEach(btn => { btn.addEventListener('click', () => doAction(body, svc.name, btn.dataset.action, row)); });
      list.appendChild(row);
    });
  }

  let _pendingAction = null;

  async function doAction(body, name, action, row) {
    const res = await callAction(body, name, action);
    if (res === 'sudo_needed') { _pendingAction = { body, name, action, row }; showSudoBar(body); return; }
    if (res?.ok) updateRow(row, res.status);
  }

  async function callAction(body, name, action, sudoPassword = '') {
    const data = await mvmOS.system.serviceAction(name, action, sudoPassword);
    if (data.error === 'permission_denied') return 'sudo_needed';
    if (data.error) { mvmOS.notify(_smt('svc_error'), data.detail || data.error); return null; }
    if (data.error === 'permission_denied') return 'sudo_needed';
    return data;
  }

  function showSudoBar(body) { _sudoNeeded = true; const bar = body.querySelector('#sm-sudo-bar'); bar.style.display = 'flex'; body.querySelector('#sm-sudo-input').value = ''; body.querySelector('#sm-sudo-input').focus(); }
  function hideSudoBar(body) { body.querySelector('#sm-sudo-bar').style.display = 'none'; _sudoNeeded = false; _pendingAction = null; }

  async function confirmSudo(body) {
    const pwd = body.querySelector('#sm-sudo-input').value;
    if (!pwd || !_pendingAction) return;
    _sudoPassword = pwd; hideSudoBar(body);
    const { name, action, row } = _pendingAction; _pendingAction = null;
    const res = await callAction(body, name, action, _sudoPassword);
    if (res === 'sudo_needed') { mvmOS.notify(_smt('auth_failed'), _smt('wrong_sudo')); _sudoPassword = ''; return; }
    if (res?.ok) updateRow(row, res.status);
  }

  function updateRow(row, status) {
    const isActive = status === 'active', isFailed = status === 'failed';
    const badge = row.querySelector('.sm-status-badge');
    if (badge) {
      badge.textContent = status;
      badge.style.cssText = `font-size:.72rem;padding:2px 8px;border-radius:3px;font-weight:600;
        ${isActive ? 'color:#50fa7b;background:rgba(80,250,123,.12);border:1px solid rgba(80,250,123,.3)'
                   : isFailed ? 'color:#ff5555;background:rgba(255,85,85,.12);border:1px solid rgba(255,85,85,.3)'
                   : 'color:#6272a4;background:rgba(98,114,164,.1);border:1px solid rgba(98,114,164,.25)'}`;
    }
    const btns = row.querySelector('div[style*="gap:4px"]');
    if (btns) {
      const name = row.dataset.name;
      btns.innerHTML = isActive
        ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${name}">${_smt('restart')}</button>
           <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${name}">${_smt('stop')}</button>`
        : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${name}">${_smt('start')}</button>`;
      btns.querySelectorAll('.sm-action').forEach(btn => {
        btn.addEventListener('click', () => doAction(row.closest('[style*="flex:1"]')?.closest('[style*="flex-direction"]')?.closest('.window-body') || document.body, name, btn.dataset.action, row));
      });
    }
  }

  return { render };
})();
