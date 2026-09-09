// mvmOS App: Server Manager v1.4.0
const _sm18n = {
  en: {
    title: 'Server Manager', sudo_msg: '⚠️ Root password required', sudo_ph: 'sudo password…',
    ok: 'OK', cancel: 'Cancel', detected: 'Detected system services',
    refresh: '↺ Refresh', loading: 'Loading…', no_services: 'No known services detected.',
    restart: '↺', stop: '■ Stop', start: '▶ Start', settings: '⚙ Settings',
    svc_error: 'Service error', auth_failed: 'Authentication failed', wrong_sudo: 'Incorrect sudo password.',
    back: '← Back', save: 'Save', saved: 'Saved!', save_error: 'Save failed', save_error_403: 'Permission denied — insufficient privileges.', restart_required: 'Restart required to apply changes.',
    php_settings: 'PHP Settings', php_ini_path: 'Config file',
    php_memory_limit: 'Memory limit', php_max_execution_time: 'Max execution time (s)',
    php_max_input_time: 'Max input time (s)', php_max_input_vars: 'Max input vars',
    php_upload_max_filesize: 'Max upload size', php_post_max_size: 'Max POST size',
    php_file_uploads: 'File uploads', php_display_errors: 'Display errors',
    php_error_reporting: 'Error reporting', php_default_charset: 'Default charset',
    php_date_timezone: 'Timezone', php_session_gc_maxlifetime: 'Session lifetime (s)',
    php_opcache_enable: 'OPcache',
    grp_memory: 'Memory & Limits', grp_uploads: 'File Uploads', grp_errors: 'Errors', grp_misc: 'Miscellaneous',
    mysql_settings: 'MySQL Settings', mysql_cnf_path: 'Config file',
    mysql_max_connections: 'Max connections', mysql_bind_address: 'Bind address',
    mysql_max_allowed_packet: 'Max allowed packet', mysql_innodb_buffer_pool_size: 'InnoDB buffer pool',
    mysql_key_buffer_size: 'Key buffer size', mysql_tmp_table_size: 'Tmp table size',
    mysql_innodb_flush_log_at_trx_commit: 'InnoDB flush log', mysql_slow_query_log: 'Slow query log',
    mysql_long_query_time: 'Long query time (s)', mysql_character_set_server: 'Character set',
    mysql_collation_server: 'Collation',
    grp_mysql_conn: 'Connections', grp_mysql_mem: 'Memory', grp_mysql_perf: 'Performance', grp_mysql_charset: 'Character Set',
    nginx_settings: 'Nginx Settings', nginx_edit_config: '📄 Edit Config', nginx_cnf_path: 'Config file', nginx_edit_restart_hint: 'After editing the config file, restart the service to apply changes.',
    nginx_worker_processes: 'Worker processes', nginx_worker_connections: 'Worker connections',
    nginx_keepalive_timeout: 'Keepalive timeout (s)', nginx_client_max_body_size: 'Max body size',
    nginx_gzip: 'Gzip', nginx_gzip_comp_level: 'Gzip level (1-9)',
    nginx_sendfile: 'Sendfile', nginx_tcp_nopush: 'TCP nopush',
    nginx_access_log: 'Access log', nginx_error_log: 'Error log',
    grp_nginx_perf: 'Performance', grp_nginx_compression: 'Compression', grp_nginx_logging: 'Logging',
    ssh_settings: 'SSH Settings', ssh_edit_config: '📄 Edit Config', ssh_cnf_path: 'Config file',
    ssh_edit_restart_hint: 'After editing the config file, restart the service to apply changes.',
    ssh_Port: 'Port', ssh_PermitRootLogin: 'Permit root login', ssh_PasswordAuthentication: 'Password auth',
    ssh_PubkeyAuthentication: 'Pubkey auth', ssh_MaxAuthTries: 'Max auth tries',
    ssh_LoginGraceTime: 'Login grace time (s)', ssh_AllowUsers: 'Allow users',
    ssh_AllowGroups: 'Allow groups', ssh_X11Forwarding: 'X11 forwarding', ssh_UsePAM: 'Use PAM',
    grp_ssh_access: 'Access', grp_ssh_auth: 'Authentication', grp_ssh_misc: 'Miscellaneous',
    ufw_settings: 'Firewall (UFW)', ufw_enabled: 'Firewall enabled', ufw_disabled: 'Firewall disabled',
    ufw_enable: 'Enable', ufw_disable: 'Disable', ufw_rules: 'Rules', ufw_no_rules: 'No rules defined.',
    ufw_add_rule: 'Add rule', ufw_rule_ph: 'e.g. 22/tcp or 80 or 443', ufw_add: 'Allow',
    ufw_delete: 'Delete', ufw_to: 'To', ufw_action: 'Action', ufw_from: 'From',
  },
  bg: {
    title: 'Мениджър на услуги', sudo_msg: '⚠️ Необходима е root парола', sudo_ph: 'sudo парола…',
    ok: 'OK', cancel: 'Отказ', detected: 'Открити системни услуги',
    refresh: '↺ Обнови', loading: 'Зареждане…', no_services: 'Няма открити известни услуги.',
    restart: '↺', stop: '■ Спри', start: '▶ Стартирай', settings: '⚙ Настройки',
    svc_error: 'Грешка на услугата', auth_failed: 'Грешка при автентикация', wrong_sudo: 'Грешна sudo парола.',
    back: '← Назад', save: 'Запази', saved: 'Запазено!', save_error: 'Грешка при запазване', save_error_403: 'Недостатъчни права за тази операция.', restart_required: 'Необходим е рестарт за прилагане на промените.',
    php_settings: 'PHP Настройки', php_ini_path: 'Конфигурационен файл',
    php_memory_limit: 'Лимит памет', php_max_execution_time: 'Макс. време за изпълнение (с)',
    php_max_input_time: 'Макс. вр. за вход (с)', php_max_input_vars: 'Макс. входни променливи',
    php_upload_max_filesize: 'Макс. размер за качване', php_post_max_size: 'Макс. POST размер',
    php_file_uploads: 'Качване на файлове', php_display_errors: 'Показвай грешки',
    php_error_reporting: 'Отчитане на грешки', php_default_charset: 'Кодиране по подразбиране',
    php_date_timezone: 'Часова зона', php_session_gc_maxlifetime: 'Живот на сесия (с)',
    php_opcache_enable: 'OPcache',
    grp_memory: 'Памет и лимити', grp_uploads: 'Качване на файлове', grp_errors: 'Грешки', grp_misc: 'Разни',
    mysql_settings: 'MySQL Настройки', mysql_cnf_path: 'Конфигурационен файл',
    mysql_max_connections: 'Макс. връзки', mysql_bind_address: 'Bind адрес',
    mysql_max_allowed_packet: 'Макс. пакет', mysql_innodb_buffer_pool_size: 'InnoDB буфер',
    mysql_key_buffer_size: 'Key буфер', mysql_tmp_table_size: 'Tmp таблица',
    mysql_innodb_flush_log_at_trx_commit: 'InnoDB flush log', mysql_slow_query_log: 'Бавни заявки лог',
    mysql_long_query_time: 'Бавна заявка (с)', mysql_character_set_server: 'Символен набор',
    mysql_collation_server: 'Collation',
    grp_mysql_conn: 'Връзки', grp_mysql_mem: 'Памет', grp_mysql_perf: 'Производителност', grp_mysql_charset: 'Символен набор',
    nginx_settings: 'Nginx Настройки', nginx_edit_config: '📄 Редактирай конфиг', nginx_cnf_path: 'Конфигурационен файл', nginx_edit_restart_hint: 'След промени в конфиг файла рестартирайте услугата за да влязат в сила.',
    nginx_worker_processes: 'Worker процеси', nginx_worker_connections: 'Worker връзки',
    nginx_keepalive_timeout: 'Keepalive timeout (с)', nginx_client_max_body_size: 'Макс. размер на заявка',
    nginx_gzip: 'Gzip', nginx_gzip_comp_level: 'Gzip ниво (1-9)',
    nginx_sendfile: 'Sendfile', nginx_tcp_nopush: 'TCP nopush',
    nginx_access_log: 'Access лог', nginx_error_log: 'Error лог',
    grp_nginx_perf: 'Производителност', grp_nginx_compression: 'Компресия', grp_nginx_logging: 'Логове',
    ssh_settings: 'SSH Настройки', ssh_edit_config: '📄 Редактирай конфиг', ssh_cnf_path: 'Конфигурационен файл',
    ssh_edit_restart_hint: 'След промени в конфиг файла рестартирайте услугата за да влязат в сила.',
    ssh_Port: 'Порт', ssh_PermitRootLogin: 'Разреши root вход', ssh_PasswordAuthentication: 'Вход с парола',
    ssh_PubkeyAuthentication: 'Вход с ключ', ssh_MaxAuthTries: 'Макс. опити',
    ssh_LoginGraceTime: 'Гратис за вход (с)', ssh_AllowUsers: 'Позволени потребители',
    ssh_AllowGroups: 'Позволени групи', ssh_X11Forwarding: 'X11 пренасочване', ssh_UsePAM: 'Използвай PAM',
    grp_ssh_access: 'Достъп', grp_ssh_auth: 'Автентикация', grp_ssh_misc: 'Разни',
    ufw_settings: 'Защитна стена (UFW)', ufw_enabled: 'Защитната стена е активна', ufw_disabled: 'Защитната стена е изключена',
    ufw_enable: 'Включи', ufw_disable: 'Изключи', ufw_rules: 'Правила', ufw_no_rules: 'Няма дефинирани правила.',
    ufw_add_rule: 'Добави правило', ufw_rule_ph: 'напр. 22/tcp или 80 или 443', ufw_add: 'Разреши',
    ufw_delete: 'Изтрий', ufw_to: 'До', ufw_action: 'Действие', ufw_from: 'От',
  },
};
function _smt(key) { const lang = window.mvmOS?.lang || 'en'; return (_sm18n[lang] || _sm18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'server-manager', name: _smt('title'), icon: '🖧', category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'server-manager', title: '🖧 ' + _smt('title'), width: 620, height: 480,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => SM.render(body)); },
    });
  }
});

const SM = (() => {
  let _sudoPassword = '', _pendingAction = null;

  // ── Main service list ───────────────────────────────────────────────────────
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
      </div>`;
    body.querySelector('#sm-refresh').addEventListener('click', () => loadServices(body));
    body.querySelector('#sm-sudo-ok').addEventListener('click', () => confirmSudo(body));
    body.querySelector('#sm-sudo-cancel').addEventListener('click', () => hideSudoBar(body));
    body.querySelector('#sm-sudo-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmSudo(body); });
    loadServices(body);
    window.mvmOS?.onLangChange(() => render(body));
  }

  const PHP_SERVICES = new Set(['php8.3-fpm', 'php8.2-fpm', 'php8.1-fpm', 'php-fpm']);
  const MYSQL_SERVICES = new Set(['mysql', 'mariadb']);
  const NGINX_SERVICES = new Set(['nginx']);
  const DOCKER_SERVICES = new Set(['docker']);
  const SSH_SERVICES = new Set(['ssh', 'sshd']);
  const UFW_SERVICES = new Set(['ufw']);

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
      const hasSettings = PHP_SERVICES.has(svc.name) || MYSQL_SERVICES.has(svc.name) || NGINX_SERVICES.has(svc.name) || DOCKER_SERVICES.has(svc.name) || SSH_SERVICES.has(svc.name) || UFW_SERVICES.has(svc.name);
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
          ${hasSettings ? `<button class="s-btn s-btn-sm sm-settings" data-name="${svc.name}">${_smt('settings')}</button>` : ''}
          ${isActive
            ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${svc.name}" title="Restart">${_smt('restart')}</button>
               <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${svc.name}">${_smt('stop')}</button>`
            : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${svc.name}">${_smt('start')}</button>`}
        </div>`;
      row.querySelectorAll('.sm-action').forEach(btn => btn.addEventListener('click', () => doAction(body, svc.name, btn.dataset.action, row)));
      row.querySelectorAll('.sm-settings').forEach(btn => btn.addEventListener('click', () => {
        if (PHP_SERVICES.has(svc.name)) renderPhpSettings(body, svc.name);
        else if (MYSQL_SERVICES.has(svc.name)) renderMysqlSettings(body, svc.name);
        else if (NGINX_SERVICES.has(svc.name)) renderNginxSettings(body, svc.name);
        else if (DOCKER_SERVICES.has(svc.name)) openDockerConfig();
        else if (SSH_SERVICES.has(svc.name)) renderSshSettings(body, svc.name);
        else if (UFW_SERVICES.has(svc.name)) renderUfwSettings(body);
      }));
      list.appendChild(row);
    });
  }

  // ── Service actions ─────────────────────────────────────────────────────────
  async function doAction(body, name, action, row) {
    const res = await callAction(body, name, action);
    if (res === 'sudo_needed') { _pendingAction = { body, name, action, row }; showSudoBar(body); return; }
    if (res?.ok) updateRow(row, res.status);
  }

  async function callAction(body, name, action, sudoPassword = '') {
    const data = await mvmOS.system.serviceAction(name, action, sudoPassword);
    if (data.error === 'permission_denied') return 'sudo_needed';
    if (data.error) { mvmOS.notify(_smt('svc_error'), data.detail || data.error); return null; }
    return data;
  }

  function showSudoBar(body) {
    const bar = body.querySelector('#sm-sudo-bar');
    bar.style.display = 'flex';
    body.querySelector('#sm-sudo-input').value = '';
    body.querySelector('#sm-sudo-input').focus();
  }
  function hideSudoBar(body) { body.querySelector('#sm-sudo-bar').style.display = 'none'; _pendingAction = null; }

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
      const hasSettings = PHP_SERVICES.has(name) || MYSQL_SERVICES.has(name) || NGINX_SERVICES.has(name) || DOCKER_SERVICES.has(name) || SSH_SERVICES.has(name) || UFW_SERVICES.has(name);
      btns.innerHTML = `
        ${hasSettings ? `<button class="s-btn s-btn-sm sm-settings" data-name="${name}">${_smt('settings')}</button>` : ''}
        ${isActive
          ? `<button class="s-btn s-btn-sm sm-action" data-action="restart" data-name="${name}">${_smt('restart')}</button>
             <button class="s-btn s-btn-sm s-btn-danger sm-action" data-action="stop" data-name="${name}">${_smt('stop')}</button>`
          : `<button class="s-btn s-btn-sm sm-action" data-action="start" data-name="${name}">${_smt('start')}</button>`}`;
      const body2 = row.closest('.window-body') || document.body;
      btns.querySelectorAll('.sm-action').forEach(btn => btn.addEventListener('click', () => doAction(body2, name, btn.dataset.action, row)));
      btns.querySelectorAll('.sm-settings').forEach(btn => btn.addEventListener('click', () => {
        if (PHP_SERVICES.has(name)) renderPhpSettings(body2, name);
        else if (MYSQL_SERVICES.has(name)) renderMysqlSettings(body2, name);
        else if (NGINX_SERVICES.has(name)) renderNginxSettings(body2, name);
        else if (DOCKER_SERVICES.has(name)) openDockerConfig();
        else if (SSH_SERVICES.has(name)) renderSshSettings(body2, name);
        else if (UFW_SERVICES.has(name)) renderUfwSettings(body2);
      }));
    }
  }

  // ── Docker config ───────────────────────────────────────────────────────────
  async function openDockerConfig() {
    const path = '/etc/docker/daemon.json';
    const check = await fetch(`/api/files/raw?path=${encodeURIComponent(path)}`);
    if (!check.ok) {
      await fetch('/api/files/write', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ path, content: '{}\n' }) });
    }
    CodeEditor.openFile(path);
  }

  // ── PHP Settings screen ─────────────────────────────────────────────────────
  const PHP_GROUPS = [
    { key: 'grp_memory', fields: ['memory_limit','max_execution_time','max_input_time','max_input_vars'] },
    { key: 'grp_uploads', fields: ['upload_max_filesize','post_max_size','file_uploads'] },
    { key: 'grp_errors', fields: ['display_errors','error_reporting'] },
    { key: 'grp_misc', fields: ['default_charset','date.timezone','session.gc_maxlifetime','opcache.enable'] },
  ];
  const TOGGLE_FIELDS = new Set(['file_uploads','display_errors','opcache.enable']);
  const FIELD_KEY = k => 'php_' + k.replace('.','_');

  const ERROR_CONSTANTS = ['E_ERROR','E_WARNING','E_PARSE','E_NOTICE','E_DEPRECATED','E_STRICT'];

  function parseErrorReporting(val) {
    const active = new Set();
    if (!val) return active;
    const str = val.replace(/\s/g, '');
    if (str === '0') return active;
    // if E_ALL is present, start with all enabled
    const hasAll = /(?:^|[|&])E_ALL(?:[|&]|$)/.test(str);
    if (hasAll) {
      ERROR_CONSTANTS.forEach(c => active.add(c));
    }
    // add explicitly included constants
    for (const c of ERROR_CONSTANTS) {
      if (new RegExp('(?<![~A-Z_])' + c + '(?![A-Z_])').test(str)) active.add(c);
    }
    // remove negated constants (~E_XXX)
    for (const c of ERROR_CONSTANTS) {
      if (new RegExp('~' + c + '(?![A-Z_])').test(str)) active.delete(c);
    }
    return active;
  }

  function buildErrorReporting(checks) {
    const on = ERROR_CONSTANTS.filter(c => checks.get(c));
    if (on.length === 0) return '0';
    return on.join(' | ');
  }

  async function renderPhpSettings(body, svcName) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <button class="s-btn s-btn-sm" id="sm-back">${_smt('back')}</button>
        <span style="font-weight:600;font-size:.9rem;flex:1">${_smt('php_settings')}</span>
        <button class="s-btn s-btn-sm" id="sm-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_smt('save')}</button>
      </div>
      <div id="sm-saved-bar" style="display:none;align-items:center;gap:10px;padding:8px 14px;background:rgba(80,250,123,.1);border-bottom:1px solid rgba(80,250,123,.3);font-size:.82rem">
        <span style="color:#50fa7b;flex:1">✓ ${_smt('saved')} — ${_smt('restart_required')}</span>
        <button class="s-btn s-btn-sm" id="sm-restart-svc" style="color:#50fa7b;border-color:#50fa7b">${_smt('restart')}</button>
      </div>
      <div id="sm-error-bar" style="display:none;padding:8px 14px;background:rgba(255,85,85,.1);border-bottom:1px solid rgba(255,85,85,.3);font-size:.82rem;color:#ff5555"></div>
      <div id="sm-php-content" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
      </div>
    </div>`;

    body.querySelector('#sm-back').addEventListener('click', () => render(body));
    body.querySelector('#sm-save').addEventListener('click', () => savePhpSettings(body, svcName));

    const res = await fetch('/api/system/php-ini');
    const data = await res.json();
    const values = data.values || {};
    const content = body.querySelector('#sm-php-content');

    let html = `<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:14px;font-family:monospace">${_smt('php_ini_path')}: ${data.path || '—'}</div>`;

    for (const grp of PHP_GROUPS) {
      html += `<div style="font-size:.78rem;font-weight:700;color:var(--accent);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em">${_smt(grp.key)}</div>`;
      for (const field of grp.fields) {
        const val = values[field] ?? '';
        const label = _smt(FIELD_KEY(field));
        if (field === 'error_reporting') {
          const active = parseErrorReporting(val);
          html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:.83rem;margin-bottom:8px">${label}</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px 14px">
              ${ERROR_CONSTANTS.map(c => `
                <label style="display:flex;align-items:center;gap:5px;font-size:.8rem;cursor:pointer">
                  <input type="checkbox" class="sm-err-flag" data-const="${c}" ${active.has(c) ? 'checked' : ''} style="accent-color:var(--accent)">
                  ${c}
                </label>`).join('')}
            </div>
          </div>`;
        } else if (TOGGLE_FIELDS.has(field)) {
          const checked = val.toLowerCase() === 'on' || val === '1' ? 'checked' : '';
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="checkbox" class="sm-php-field" data-key="${field}" ${checked} style="width:16px;height:16px;accent-color:var(--accent)">
          </div>`;
        } else {
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="text" class="sm-php-field s-input" data-key="${field}" value="${val}"
              style="width:150px;font-size:.82rem;padding:3px 7px">
          </div>`;
        }
      }
    }
    content.innerHTML = html;

  }

  async function savePhpSettings(body, svcName) {
    const fields = body.querySelectorAll('.sm-php-field');
    const values = {};
    fields.forEach(f => {
      if (f.type === 'checkbox') values[f.dataset.key] = f.checked ? 'On' : 'Off';
      else values[f.dataset.key] = f.value.trim();
    });
    // build error_reporting from checkboxes
    const errFlags = body.querySelectorAll('.sm-err-flag');
    if (errFlags.length) {
      const checks = new Map();
      errFlags.forEach(f => checks.set(f.dataset.const, f.checked));
      values['error_reporting'] = buildErrorReporting(checks);
    }

    const saveBtn = body.querySelector('#sm-save');
    saveBtn.disabled = true;

    const res = await fetch('/api/system/php-ini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, sudo_password: _sudoPassword }),
    });
    const data = await res.json();

    if (res.status === 403) {
      // need sudo password
      _pendingAction = { type: 'php-save', body, svcName };
      showSudoBar(body);
      saveBtn.disabled = false;
      return;
    }

    saveBtn.disabled = false;
    if (data.ok) _showSavedBar(body, svcName);
    else _showErrorBar(body, res.status);
  }

  function _showSavedBar(body, svcName) {
    const savedBar = body.querySelector('#sm-saved-bar');
    savedBar.style.display = 'flex';
    body.querySelector('#sm-error-bar').style.display = 'none';
    const btn = body.querySelector('#sm-restart-svc');
    const newBtn = btn.cloneNode(true); // remove old listeners
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async () => {
      newBtn.disabled = true;
      newBtn.textContent = '⟳ …';
      try { await mvmOS.system.serviceAction(svcName, 'restart', _sudoPassword); } catch (_) {}
      savedBar.style.display = 'none';
      newBtn.disabled = false;
      newBtn.textContent = _smt('restart');
    });
  }

  function _showErrorBar(body, status) {
    const errBar = body.querySelector('#sm-error-bar');
    errBar.textContent = '✗ ' + (status === 403 ? _smt('save_error_403') : _smt('save_error'));
    errBar.style.display = 'block';
    body.querySelector('#sm-saved-bar').style.display = 'none';
  }

  // ── MySQL Settings screen ───────────────────────────────────────────────────
  const MYSQL_GROUPS = [
    { key: 'grp_mysql_conn',    fields: ['max_connections', 'bind-address'] },
    { key: 'grp_mysql_mem',     fields: ['innodb_buffer_pool_size', 'key_buffer_size', 'max_allowed_packet', 'tmp_table_size'] },
    { key: 'grp_mysql_perf',    fields: ['innodb_flush_log_at_trx_commit', 'slow_query_log', 'long_query_time'] },
    { key: 'grp_mysql_charset', fields: ['character-set-server', 'collation-server'] },
  ];
  const MYSQL_TOGGLE_FIELDS = new Set(['slow_query_log']);
  const MYSQL_FIELD_KEY = k => 'mysql_' + k.replace(/[-]/g, '_');

  async function renderMysqlSettings(body, svcName) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <button class="s-btn s-btn-sm" id="sm-back">${_smt('back')}</button>
        <span style="font-weight:600;font-size:.9rem;flex:1">${_smt('mysql_settings')}</span>
        <button class="s-btn s-btn-sm" id="sm-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_smt('save')}</button>
      </div>
      <div id="sm-saved-bar" style="display:none;align-items:center;gap:10px;padding:8px 14px;background:rgba(80,250,123,.1);border-bottom:1px solid rgba(80,250,123,.3);font-size:.82rem">
        <span style="color:#50fa7b;flex:1">✓ ${_smt('saved')} — ${_smt('restart_required')}</span>
        <button class="s-btn s-btn-sm" id="sm-restart-svc" style="color:#50fa7b;border-color:#50fa7b">${_smt('restart')}</button>
      </div>
      <div id="sm-error-bar" style="display:none;padding:8px 14px;background:rgba(255,85,85,.1);border-bottom:1px solid rgba(255,85,85,.3);font-size:.82rem;color:#ff5555"></div>
      <div id="sm-mysql-content" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
      </div>
    </div>`;

    body.querySelector('#sm-back').addEventListener('click', () => render(body));
    body.querySelector('#sm-save').addEventListener('click', () => saveMysqlSettings(body, svcName));

    const res = await fetch('/api/system/mysql-cnf');
    const data = await res.json();
    const values = data.values || {};
    const content = body.querySelector('#sm-mysql-content');

    let html = `<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:14px;font-family:monospace">${_smt('mysql_cnf_path')}: ${data.path || '—'}</div>`;

    for (const grp of MYSQL_GROUPS) {
      html += `<div style="font-size:.78rem;font-weight:700;color:var(--accent);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em">${_smt(grp.key)}</div>`;
      for (const field of grp.fields) {
        const val = values[field] ?? '';
        const label = _smt(MYSQL_FIELD_KEY(field));
        if (MYSQL_TOGGLE_FIELDS.has(field)) {
          const checked = val.toLowerCase() === 'on' || val === '1' ? 'checked' : '';
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="checkbox" class="sm-mysql-field" data-key="${field}" ${checked} style="width:16px;height:16px;accent-color:var(--accent)">
          </div>`;
        } else {
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="text" class="sm-mysql-field s-input" data-key="${field}" value="${val}"
              style="width:150px;font-size:.82rem;padding:3px 7px">
          </div>`;
        }
      }
    }
    content.innerHTML = html;
  }

  async function saveMysqlSettings(body, svcName) {
    const fields = body.querySelectorAll('.sm-mysql-field');
    const values = {};
    fields.forEach(f => {
      if (f.type === 'checkbox') values[f.dataset.key] = f.checked ? 'ON' : 'OFF';
      else if (f.value.trim()) values[f.dataset.key] = f.value.trim();
    });

    const saveBtn = body.querySelector('#sm-save');
    saveBtn.disabled = true;

    const res = await fetch('/api/system/mysql-cnf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, sudo_password: _sudoPassword }),
    });
    const data = await res.json();
    saveBtn.disabled = false;

    if (data.ok) _showSavedBar(body, svcName);
    else _showErrorBar(body, res.status);
  }

  // ── Nginx Settings screen ───────────────────────────────────────────────────
  const NGINX_GROUPS = [
    { key: 'grp_nginx_perf',        fields: ['worker_processes','worker_connections','keepalive_timeout','client_max_body_size','sendfile','tcp_nopush'] },
    { key: 'grp_nginx_compression', fields: ['gzip','gzip_comp_level'] },
    { key: 'grp_nginx_logging',     fields: ['access_log','error_log'] },
  ];
  const NGINX_TOGGLE_FIELDS = new Set(['gzip','sendfile','tcp_nopush']);
  const NGINX_FIELD_KEY = k => 'nginx_' + k.replace(/[-]/g, '_');

  async function renderNginxSettings(body, svcName) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <button class="s-btn s-btn-sm" id="sm-back">${_smt('back')}</button>
        <span style="font-weight:600;font-size:.9rem;flex:1">${_smt('nginx_settings')}</span>
        <button class="s-btn s-btn-sm" id="sm-edit-cfg">${_smt('nginx_edit_config')}</button>
        <button class="s-btn s-btn-sm" id="sm-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_smt('save')}</button>
      </div>
      <div id="sm-saved-bar" style="display:none;align-items:center;gap:10px;padding:8px 14px;background:rgba(80,250,123,.1);border-bottom:1px solid rgba(80,250,123,.3);font-size:.82rem">
        <span style="color:#50fa7b;flex:1">✓ ${_smt('saved')} — ${_smt('restart_required')}</span>
        <button class="s-btn s-btn-sm" id="sm-restart-svc" style="color:#50fa7b;border-color:#50fa7b">${_smt('restart')}</button>
      </div>
      <div id="sm-error-bar" style="display:none;padding:8px 14px;background:rgba(255,85,85,.1);border-bottom:1px solid rgba(255,85,85,.3);font-size:.82rem;color:#ff5555"></div>
      <div id="sm-nginx-content" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
      </div>
    </div>`;

    body.querySelector('#sm-back').addEventListener('click', () => render(body));
    body.querySelector('#sm-save').addEventListener('click', () => saveNginxSettings(body, svcName));
    body.querySelector('#sm-edit-cfg').addEventListener('click', () => {
      CodeEditor.openFile('/etc/nginx/nginx.conf');
      const savedBar = body.querySelector('#sm-saved-bar');
      savedBar.querySelector('span').textContent = 'ℹ️ ' + _smt('nginx_edit_restart_hint');
      _showSavedBar(body, svcName);
    });

    const res = await fetch('/api/system/nginx-conf');
    const data = await res.json();
    const values = data.values || {};
    const content = body.querySelector('#sm-nginx-content');

    let html = `<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:14px;font-family:monospace">${_smt('nginx_cnf_path')}: ${data.path || '—'}</div>`;

    for (const grp of NGINX_GROUPS) {
      html += `<div style="font-size:.78rem;font-weight:700;color:var(--accent);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em">${_smt(grp.key)}</div>`;
      for (const field of grp.fields) {
        const val = values[field] ?? '';
        const label = _smt(NGINX_FIELD_KEY(field));
        if (NGINX_TOGGLE_FIELDS.has(field)) {
          const checked = val.toLowerCase() === 'on' ? 'checked' : '';
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="checkbox" class="sm-nginx-field" data-key="${field}" ${checked} style="width:16px;height:16px;accent-color:var(--accent)">
          </div>`;
        } else {
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="text" class="sm-nginx-field s-input" data-key="${field}" value="${val}"
              style="width:150px;font-size:.82rem;padding:3px 7px">
          </div>`;
        }
      }
    }
    content.innerHTML = html;
  }

  async function saveNginxSettings(body, svcName) {
    const fields = body.querySelectorAll('.sm-nginx-field');
    const values = {};
    fields.forEach(f => {
      if (f.type === 'checkbox') values[f.dataset.key] = f.checked ? 'on' : 'off';
      else if (f.value.trim()) values[f.dataset.key] = f.value.trim();
    });

    const saveBtn = body.querySelector('#sm-save');
    saveBtn.disabled = true;

    const res = await fetch('/api/system/nginx-conf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values, sudo_password: _sudoPassword }),
    });
    const data = await res.json();
    saveBtn.disabled = false;

    if (data.ok) {
      // test nginx config before allowing restart
      const testRes = await fetch('/api/system/nginx-test', { method: 'POST' });
      const testData = await testRes.json();
      if (testData.ok) {
        _showSavedBar(body, svcName);
      } else {
        const errBar = body.querySelector('#sm-error-bar');
        errBar.innerHTML = `✗ nginx -t failed:<br><pre style="margin:4px 0 0;font-size:.75rem;white-space:pre-wrap">${testData.output}</pre>`;
        errBar.style.display = 'block';
        body.querySelector('#sm-saved-bar').style.display = 'none';
      }
    } else {
      _showErrorBar(body, res.status);
    }
  }

  // ── SSH Settings screen ─────────────────────────────────────────────────────
  const SSH_GROUPS = [
    { key: 'grp_ssh_access',  fields: ['Port', 'AllowUsers', 'AllowGroups'] },
    { key: 'grp_ssh_auth',    fields: ['PermitRootLogin', 'PasswordAuthentication', 'PubkeyAuthentication', 'MaxAuthTries', 'LoginGraceTime'] },
    { key: 'grp_ssh_misc',    fields: ['X11Forwarding', 'UsePAM'] },
  ];
  const SSH_TOGGLE_FIELDS = new Set(['PasswordAuthentication', 'PubkeyAuthentication', 'X11Forwarding', 'UsePAM']);
  const SSH_YES_NO_FIELDS = new Set(['PermitRootLogin']);

  async function renderSshSettings(body, svcName) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <button class="s-btn s-btn-sm" id="sm-back">${_smt('back')}</button>
        <span style="font-weight:600;font-size:.9rem;flex:1">${_smt('ssh_settings')}</span>
        <button class="s-btn s-btn-sm" id="sm-edit-cfg">${_smt('ssh_edit_config')}</button>
        <button class="s-btn s-btn-sm" id="sm-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_smt('save')}</button>
      </div>
      <div id="sm-saved-bar" style="display:none;align-items:center;gap:10px;padding:8px 14px;background:rgba(80,250,123,.1);border-bottom:1px solid rgba(80,250,123,.3);font-size:.82rem">
        <span style="color:#50fa7b;flex:1">✓ ${_smt('saved')} — ${_smt('restart_required')}</span>
        <button class="s-btn s-btn-sm" id="sm-restart-svc" style="color:#50fa7b;border-color:#50fa7b">${_smt('restart')}</button>
      </div>
      <div id="sm-error-bar" style="display:none;padding:8px 14px;background:rgba(255,85,85,.1);border-bottom:1px solid rgba(255,85,85,.3);font-size:.82rem;color:#ff5555"></div>
      <div id="sm-ssh-content" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
      </div>
    </div>`;

    body.querySelector('#sm-back').addEventListener('click', () => render(body));
    body.querySelector('#sm-save').addEventListener('click', () => saveSshSettings(body, svcName));
    body.querySelector('#sm-edit-cfg').addEventListener('click', () => {
      CodeEditor.openFile('/etc/ssh/sshd_config');
      const savedBar = body.querySelector('#sm-saved-bar');
      savedBar.querySelector('span').textContent = 'ℹ️ ' + _smt('ssh_edit_restart_hint');
      _showSavedBar(body, svcName);
    });

    const res = await fetch('/api/system/sshd-conf');
    const data = await res.json();
    const values = data.values || {};
    const content = body.querySelector('#sm-ssh-content');

    let html = `<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:14px;font-family:monospace">${_smt('ssh_cnf_path')}: ${data.path || '—'}</div>`;

    for (const grp of SSH_GROUPS) {
      html += `<div style="font-size:.78rem;font-weight:700;color:var(--accent);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em">${_smt(grp.key)}</div>`;
      for (const field of grp.fields) {
        const val = values[field] ?? '';
        const label = _smt('ssh_' + field);
        if (SSH_TOGGLE_FIELDS.has(field)) {
          const checked = val.toLowerCase() === 'yes' ? 'checked' : '';
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="checkbox" class="sm-ssh-field" data-key="${field}" data-type="yesno" ${checked} style="width:16px;height:16px;accent-color:var(--accent)">
          </div>`;
        } else if (SSH_YES_NO_FIELDS.has(field)) {
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <select class="sm-ssh-field s-input" data-key="${field}" style="width:150px;font-size:.82rem;padding:3px 7px">
              <option value="yes" ${val==='yes'?'selected':''}>yes</option>
              <option value="no" ${val==='no'?'selected':''}>no</option>
              <option value="prohibit-password" ${val==='prohibit-password'?'selected':''}>prohibit-password</option>
            </select>
          </div>`;
        } else {
          html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">
            <label style="flex:1;font-size:.83rem">${label}</label>
            <input type="text" class="sm-ssh-field s-input" data-key="${field}" value="${val}"
              style="width:150px;font-size:.82rem;padding:3px 7px">
          </div>`;
        }
      }
    }
    content.innerHTML = html;
  }

  async function saveSshSettings(body, svcName) {
    const fields = body.querySelectorAll('.sm-ssh-field');
    const values = {};
    fields.forEach(f => {
      if (f.type === 'checkbox') values[f.dataset.key] = f.checked ? 'yes' : 'no';
      else if (f.value.trim()) values[f.dataset.key] = f.value.trim();
    });

    const saveBtn = body.querySelector('#sm-save');
    saveBtn.disabled = true;

    const res = await fetch('/api/system/sshd-conf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    });
    const data = await res.json();
    saveBtn.disabled = false;

    if (data.ok) {
      const testRes = await fetch('/api/system/sshd-test', { method: 'POST' });
      const testData = await testRes.json();
      if (testData.ok) {
        _showSavedBar(body, svcName);
      } else {
        const errBar = body.querySelector('#sm-error-bar');
        errBar.innerHTML = `✗ sshd -t failed:<br><pre style="margin:4px 0 0;font-size:.75rem;white-space:pre-wrap">${testData.output}</pre>`;
        errBar.style.display = 'block';
        body.querySelector('#sm-saved-bar').style.display = 'none';
      }
    } else {
      _showErrorBar(body, res.status);
    }
  }

  // ── UFW Firewall screen ─────────────────────────────────────────────────────
  async function renderUfwSettings(body) {
    body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px">
        <button class="s-btn s-btn-sm" id="sm-back">${_smt('back')}</button>
        <span style="font-weight:600;font-size:.9rem;flex:1">${_smt('ufw_settings')}</span>
        <button class="s-btn s-btn-sm" id="sm-ufw-toggle"></button>
      </div>
      <div id="sm-ufw-content" style="flex:1;overflow-y:auto;padding:12px 16px">
        <div style="color:var(--text-dim);font-size:.85rem">${_smt('loading')}</div>
      </div>
    </div>`;

    body.querySelector('#sm-back').addEventListener('click', () => render(body));
    await loadUfwStatus(body);
  }

  async function loadUfwStatus(body) {
    const res = await fetch('/api/system/ufw-status');
    const data = await res.json();
    const content = body.querySelector('#sm-ufw-content');
    const toggleBtn = body.querySelector('#sm-ufw-toggle');

    if (data.enabled) {
      toggleBtn.textContent = _smt('ufw_disable');
      toggleBtn.style.cssText = 'color:#ff5555;border-color:#ff5555';
    } else {
      toggleBtn.textContent = _smt('ufw_enable');
      toggleBtn.style.cssText = 'color:#50fa7b;border-color:#50fa7b';
    }

    const newToggle = toggleBtn.cloneNode(true);
    toggleBtn.replaceWith(newToggle);
    newToggle.addEventListener('click', async () => {
      newToggle.disabled = true;
      await fetch('/api/system/ufw-toggle', { method: 'POST' });
      await loadUfwStatus(body);
    });

    const statusColor = data.enabled ? '#50fa7b' : '#6272a4';
    const statusText = data.enabled ? _smt('ufw_enabled') : _smt('ufw_disabled');

    let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;border-radius:6px;background:var(--surface2)">
      <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0"></span>
      <span style="font-size:.85rem;color:${statusColor}">${statusText}</span>
    </div>`;

    html += `<div style="font-size:.78rem;font-weight:700;color:var(--accent);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">${_smt('ufw_rules')}</div>`;

    if (!data.rules.length) {
      html += `<div style="font-size:.83rem;color:var(--text-dim);padding:8px 0">${_smt('ufw_no_rules')}</div>`;
    } else {
      html += `<table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="color:var(--text-dim);font-size:.75rem">
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">#</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">${_smt('ufw_to')}</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">${_smt('ufw_action')}</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--border)">${_smt('ufw_from')}</th>
          <th style="padding:4px 8px;border-bottom:1px solid var(--border)"></th>
        </tr></thead><tbody>`;
      for (const r of data.rules) {
        html += `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:var(--text-dim)">${r.num}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:monospace">${r.to}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);color:#50fa7b">${r.action}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);font-family:monospace">${r.from}</td>
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);text-align:right">
            <button class="s-btn s-btn-sm s-btn-danger sm-ufw-del" data-num="${r.num}" data-rule="${r.to}">${_smt('ufw_delete')}</button>
          </td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    html += `<div style="display:flex;gap:8px;margin-top:16px;align-items:center">
      <input type="text" id="sm-ufw-rule" class="s-input" placeholder="${_smt('ufw_rule_ph')}"
        style="flex:1;font-size:.82rem;padding:4px 8px">
      <button class="s-btn s-btn-sm" id="sm-ufw-add" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_smt('ufw_add')}</button>
    </div>`;

    content.innerHTML = html;

    content.querySelectorAll('.sm-ufw-del').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      await fetch('/api/system/ufw-delete', { method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ num: parseInt(btn.dataset.num), rule: btn.dataset.rule }) });
      await loadUfwStatus(body);
    }));

    content.querySelector('#sm-ufw-add').addEventListener('click', async () => {
      const rule = content.querySelector('#sm-ufw-rule').value.trim();
      if (!rule) return;
      const res = await fetch('/api/system/ufw-allow', { method: 'POST',
        headers: {'Content-Type':'application/json'}, body: JSON.stringify({ rule }) });
      const d = await res.json();
      if (d.error) { mvmOS.notify('UFW', d.error); return; }
      await loadUfwStatus(body);
    });

    content.querySelector('#sm-ufw-rule').addEventListener('keydown', e => {
      if (e.key === 'Enter') content.querySelector('#sm-ufw-add').click();
    });
  }

  return { render };
})();
