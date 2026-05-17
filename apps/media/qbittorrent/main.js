// mvmOS App: qBittorrent v1.0.0
const _qbi18n = {
  en: {
    title: 'qBittorrent', add: '+ Add', resume: '▶ Resume', pause: '⏸ Pause',
    delete: '🗑 Delete', delete_files: 'Also delete files',
    resume_all: '▶ All', pause_all: '⏸ All',
    all: 'All', downloading: 'Downloading', seeding: 'Seeding',
    paused: 'Paused', completed: 'Completed', active: 'Active', error: 'Error',
    info: 'Info', files: 'Files', peers: 'Peers',
    name: 'Name', size: 'Size', status: 'Status', progress: 'Progress',
    dl_speed: '↓ Speed', ul_speed: '↑ Speed', eta: 'ETA', ratio: 'Ratio',
    seeds: 'Seeds', peers_lbl: 'Peers', added: 'Added', save_path: 'Save path',
    hash: 'Hash', tracker: 'Tracker', category: 'Category',
    magnet_or_url: 'Magnet link or torrent URL',
    or_file: 'Or select a .torrent file:',
    save_path_label: 'Save to (optional)',
    remember_path: 'Remember this path',
    category_label: 'Category (optional)',
    add_btn: 'Add', cancel: 'Cancel',
    connecting: 'Connecting…', no_conn: 'Cannot connect to qBittorrent.',
    no_conn_hint: 'Make sure qBittorrent is running, then click Auto-detect.',
    discover_btn: 'Auto-detect', settings_btn: '⚙ Settings',
    setup_title: 'qBittorrent not found',
    setup_step1: 'Install qBittorrent:',
    setup_step2: 'Enable Web UI and allow local connections:',
    setup_step2b: 'Tools → Options → Web UI → enable "Bypass auth for localhost"',
    setup_step3: 'Click Auto-detect below when ready.',
    setup_step3_start: 'Start qBittorrent in background:',
    setup_note: 'Default credentials: admin / adminadmin — change them after first login!',
    no_torrents: 'No torrents', delete_confirm: 'Remove torrent?',
    total_dl: '↓', total_ul: '↑', free_space: 'Free',
    unknown: 'Unknown', never: 'Never',
    file_name: 'Name', file_size: 'Size', file_progress: 'Progress', file_prio: 'Priority',
    peer_ip: 'IP', peer_client: 'Client', peer_dl: '↓', peer_ul: '↑', peer_progress: '%',
  },
  bg: {
    title: 'qBittorrent', add: '+ Добави', resume: '▶ Стартирай', pause: '⏸ Пауза',
    delete: '🗑 Изтрий', delete_files: 'Изтрий и файловете',
    resume_all: '▶ Всички', pause_all: '⏸ Всички',
    all: 'Всички', downloading: 'Сваляне', seeding: 'Разпращане',
    paused: 'На пауза', completed: 'Завършени', active: 'Активни', error: 'Грешка',
    info: 'Инфо', files: 'Файлове', peers: 'Пиъри',
    name: 'Име', size: 'Размер', status: 'Статус', progress: 'Прогрес',
    dl_speed: '↓ Скорост', ul_speed: '↑ Скорост', eta: 'ETA', ratio: 'Рацио',
    seeds: 'Сийди', peers_lbl: 'Пиъри', added: 'Добавен', save_path: 'Папка',
    hash: 'Hash', tracker: 'Тракер', category: 'Категория',
    magnet_or_url: 'Magnet линк или URL към .torrent',
    or_file: 'Или избери .torrent файл:',
    save_path_label: 'Запази в (незадължително)',
    remember_path: 'Запомни пътя',
    category_label: 'Категория (незадължително)',
    add_btn: 'Добави', cancel: 'Отказ',
    connecting: 'Свързване…', no_conn: 'Няма връзка с qBittorrent.',
    no_conn_hint: 'Увери се, че qBittorrent е стартиран, след което натисни Автодетект.',
    discover_btn: 'Автодетект', settings_btn: '⚙ Настройки',
    setup_title: 'qBittorrent не е открит',
    setup_step1: 'Инсталирай qBittorrent:',
    setup_step2: 'Включи Web UI и разреши локални връзки:',
    setup_step2b: 'Tools → Options → Web UI → отметни "Bypass auth for localhost"',
    setup_step3: 'Натисни Автодетект когато е готово.',
    setup_step3_start: 'Стартирай qBittorrent в background:',
    setup_note: 'По подразбиране: admin / adminadmin — смени паролата след първото влизане!',
    no_torrents: 'Няма торенти', delete_confirm: 'Премахни торента?',
    total_dl: '↓', total_ul: '↑', free_space: 'Свободно',
    unknown: 'Неизвестно', never: 'Никога',
    file_name: 'Файл', file_size: 'Размер', file_progress: 'Прогрес', file_prio: 'Приоритет',
    peer_ip: 'IP', peer_client: 'Клиент', peer_dl: '↓', peer_ul: '↑', peer_progress: '%',
  },
};
function _qbt(key) { const lang = window.mvmOS?.lang || 'en'; return (_qbi18n[lang] || _qbi18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'qbittorrent',
  name: _qbt('title'),
  icon: '🌊',
  category: 'Media',
  settings: [
    { key: 'host',              label: 'Host',                                    type: 'text',     default: 'localhost' },
    { key: 'port',              label: 'Port',                                    type: 'number',   default: 8080, min: 1, max: 65535 },
    { key: 'username',          label: 'Username',                                type: 'text',     default: 'admin' },
    { key: 'password',          label: 'Password',                                type: 'password', default: '' },
    { key: 'auto_delete_ratio', label: 'Auto-delete at ratio (0 = off)',          type: 'number',   default: 0, min: 0, step: 0.1 },
    { key: 'auto_delete_hours', label: 'Auto-delete after hours seeding (0 = off)', type: 'number', default: 0, min: 0, step: 0.5 },
    { key: 'delete_files',      label: 'Delete files on auto-delete',             type: 'checkbox', default: false },
    { key: 'dl_limit',          label: 'Download limit KB/s (0 = unlimited)',     type: 'number',   default: 0, min: 0 },
    { key: 'ul_limit',          label: 'Upload limit KB/s (0 = unlimited)',       type: 'number',   default: 0, min: 0 },
  ],
  launch() {
    mvmOS.createWindow({
      id: 'qbittorrent',
      title: '🌊 ' + _qbt('title'),
      width: 960,
      height: 600,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'qbittorrent' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => QB.mount(body));
      },
    });
  },
});

// ── Core ──────────────────────────────────────────────────────────────────────
const QB = (() => {
  const _db = mvmOS.db('qbittorrent');

  let _cfg = {
    host: 'localhost', port: 8080, username: 'admin', password: '',
    auto_delete_ratio: '', auto_delete_hours: '',
    delete_files: false,
    dl_limit: 0, ul_limit: 0,
  };
  let _torrents = [];
  let _filter = 'all';
  let _selected = null;
  let _detailTab = 'info';
  let _pollTimer = null;
  let _connected = false;
  let _pollCount = 0;
  let _root = null;

  // ── Settings DB ──
  async function _initDb() {
    await _db.run(`CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)`);
  }
  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    rows.forEach(r => { try { _cfg[r.key] = JSON.parse(r.value); } catch(_) { _cfg[r.key] = r.value; } });
  }
  async function _saveCfg(key, val) {
    await _db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [key, JSON.stringify(val)]);
    _cfg[key] = val;
  }

  // ── API proxy ──
  async function _api(path, method = 'GET', data = null) {
    const res = await fetch('/api/qbit/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: _cfg.host, port: _cfg.port, username: _cfg.username, password: _cfg.password, path, method, data }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
  }

  // ── Formatters ──
  function _fmtSize(bytes) {
    if (!bytes || bytes < 0) return '—';
    const u = ['B','KB','MB','GB','TB'];
    let i = 0; let v = bytes;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i > 0 ? 1 : 0) + ' ' + u[i];
  }
  function _fmtSpeed(bps) {
    if (!bps || bps <= 0) return '—';
    return _fmtSize(bps) + '/s';
  }
  function _fmtEta(sec) {
    if (!sec || sec <= 0 || sec > 8640000) return '—';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }
  function _fmtDate(ts) {
    if (!ts || ts <= 0) return _qbt('never');
    return new Date(ts * 1000).toLocaleDateString();
  }
  function _fmtRatio(r) {
    if (r == null || r < 0) return '—';
    return parseFloat(r).toFixed(2);
  }
  function _stateClass(state) {
    if (['downloading','metaDL','forcedDL'].includes(state)) return 'downloading';
    if (['uploading','forcedUP','stalledUP'].includes(state)) return 'seeding';
    if (['pausedDL','pausedUP'].includes(state)) return 'paused';
    if (state === 'error' || state === 'missingFiles') return 'error';
    if (['checkingUP','checkingDL','checkingResumeData'].includes(state)) return 'checking';
    if (['queuedDL','queuedUP'].includes(state)) return 'queued';
    if (state === 'uploading' || state === 'stalledUP') return 'seeding';
    return 'complete';
  }
  function _stateLabel(state) {
    const map = {
      downloading: _qbt('downloading'), metaDL: 'Fetching metadata', forcedDL: 'Forced download',
      uploading: _qbt('seeding'), forcedUP: 'Forced seeding', stalledUP: 'Stalled (seeding)',
      stalledDL: 'Stalled', pausedDL: _qbt('paused'), pausedUP: _qbt('paused'),
      error: 'Error', missingFiles: 'Missing files',
      checkingUP: 'Checking', checkingDL: 'Checking', checkingResumeData: 'Resuming',
      queuedDL: 'Queued', queuedUP: 'Queued',
      allocating: 'Allocating', moving: 'Moving',
    };
    return map[state] || state;
  }

  // ── Filter ──
  function _filtered() {
    switch (_filter) {
      case 'downloading': return _torrents.filter(t => ['downloading','metaDL','forcedDL','stalledDL'].includes(t.state));
      case 'seeding':     return _torrents.filter(t => ['uploading','forcedUP','stalledUP'].includes(t.state));
      case 'paused':      return _torrents.filter(t => t.state.startsWith('paused'));
      case 'completed':   return _torrents.filter(t => t.progress >= 1 || t.state.includes('UP'));
      case 'active':      return _torrents.filter(t => (t.dlspeed > 0 || t.upspeed > 0));
      case 'error':       return _torrents.filter(t => t.state === 'error' || t.state === 'missingFiles');
      default:            return _torrents;
    }
  }
  function _count(cat) {
    const tmp = _filter; _filter = cat; const n = _filtered().length; _filter = tmp; return n;
  }

  // ── Speed limits ──
  async function _applySpeedLimits() {
    const dl = parseInt(_cfg.dl_limit) || 0;
    const ul = parseInt(_cfg.ul_limit) || 0;
    try {
      await _api('/api/v2/transfer/setDownloadLimit', 'POST', `limit=${dl * 1024}`);
      await _api('/api/v2/transfer/setUploadLimit',   'POST', `limit=${ul * 1024}`);
    } catch(_) {}
  }

  // ── Auto-delete ──
  async function _autoDelete() {
    const ratio = parseFloat(_cfg.auto_delete_ratio);
    const hours = parseFloat(_cfg.auto_delete_hours);
    if (!ratio && !hours) return;
    const now = Date.now() / 1000;
    for (const t of _torrents) {
      const seedingDone = ['uploading', 'forcedUP', 'stalledUP'].includes(t.state);
      if (!seedingDone) continue;
      const ratioHit = ratio > 0 && t.ratio >= ratio;
      const timeHit  = hours > 0 && t.seeding_time >= hours * 3600;
      if (ratioHit || timeHit) {
        await _api('/api/v2/torrents/delete', 'POST',
          `hashes=${t.hash}&deleteFiles=${_cfg.delete_files ? 'true' : 'false'}`);
      }
    }
  }

  // ── Poll ──
  async function _poll() {
    _pollCount++;
    try {
      const list = await _api('/api/v2/torrents/info');
      _torrents = Array.isArray(list) ? list : [];
      _connected = true;
      await _autoDelete();
      _renderAll();
    } catch(e) {
      _connected = false;
      _renderAll();
    }
  }
  function _startPoll() {
    clearInterval(_pollTimer);
    _pollCount = 0;
    _pollTimer = setInterval(_poll, 3000);
    _poll();
  }

  // ── Mount ──
  async function mount(body) {
    _root = body;
    await _initDb();
    await _loadCfg();

    body.innerHTML = `<div class="qb-root" id="qb-root"></div>`;
    const root = body.querySelector('#qb-root');

    // try auto-discover if no password saved
    if (!_cfg.password) {
      const disc = await fetch('/api/qbit/discover').then(r => r.json()).catch(() => ({}));
      if (disc.found) {
        _cfg.host = disc.host;
        _cfg.port = disc.port;
      }
    }

    _renderAll();
    _startPoll();
    window.mvmOS?.onLangChange(() => _renderAll());
    window.addEventListener('settings-changed', e => {
      if (e.detail?.app === 'qbittorrent') {
        _loadCfg().then(() => {
          _renderAll();
          _startPoll();
          _applySpeedLimits();
        });
      }
    });
  }

  // ── Render ──
  function _renderAll() {
    const root = _root?.querySelector('#qb-root');
    if (!root) return;
    if (root.querySelector('.qb-dialog-overlay')) return;

    if (!_connected && _torrents.length === 0) {
      if (_pollCount < 2) {
        root.innerHTML = `<div class="qb-root"><div class="qb-empty" style="flex-direction:column;gap:8px"><div style="font-size:1.4rem">🌊</div><div>${_qbt('connecting')}</div></div></div>`;
      } else {
        _renderConnect(root);
      }
      return;
    }

    const filtered = _filtered();
    const sel = filtered.find(t => t.hash === _selected);

    root.innerHTML = `
      <div class="qb-toolbar">
        <button id="qb-add">${_qbt('add')}</button>
        <button id="qb-resume" ${!sel ? 'disabled' : ''}>${_qbt('resume')}</button>
        <button id="qb-pause" ${!sel ? 'disabled' : ''}>${_qbt('pause')}</button>
        <button id="qb-delete" ${!sel ? 'disabled' : ''}>${_qbt('delete')}</button>
        <button id="qb-resume-all">${_qbt('resume_all')}</button>
        <button id="qb-pause-all">${_qbt('pause_all')}</button>
        <div class="qb-sep"></div>
        <div class="qb-speeds" id="qb-speeds"></div>
      </div>
      <div class="qb-body">
        <div class="qb-sidebar" id="qb-sidebar"></div>
        <div class="qb-list" id="qb-list"></div>
        ${sel ? '<div class="qb-detail" id="qb-detail"></div>' : ''}
      </div>
      <div class="qb-statusbar" id="qb-statusbar"></div>
    `;

    _renderSidebar(root);
    _renderList(root, filtered, sel);
    if (sel) _renderDetail(root, sel);
    _renderStatusBar(root);
    _bindToolbar(root, sel);
  }

  function _runInTerminal(cmd) {
    // Open mvmOS terminal and run command
    mvmOS.createWindow({
      id: 'terminal-qbit-' + Date.now(),
      title: '🖥 Terminal',
      width: 600,
      height: 340,
      onMount(body) {
        body.style.padding = '0';
        // Dispatch terminal open event with pre-filled command
        window.dispatchEvent(new CustomEvent('terminal-run', { detail: { cmd } }));
        body.innerHTML = `<div style="padding:16px;font-family:monospace;font-size:.82rem;color:var(--text)">
          <div style="color:var(--text-dim);margin-bottom:8px">Run this command in your terminal:</div>
          <code style="display:block;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 12px;user-select:all">${cmd}</code>
          <div style="margin-top:12px;color:var(--text-dim);font-size:.75rem">Or open a Terminal app and paste it there.</div>
        </div>`;
      }
    });
  }

  function _renderConnect(root) {
    root.innerHTML = `
      <div class="qb-root" style="overflow-y:auto">
        <div class="qb-connect-screen" style="max-width:460px;margin:auto;text-align:left;gap:0;padding:20px">
          <div style="font-size:2rem;text-align:center;width:100%;margin-bottom:10px">🌊</div>
          <div style="font-size:.95rem;font-weight:600;text-align:center;margin-bottom:16px">${_qbt('setup_title')}</div>

          <div style="display:flex;flex-direction:column;gap:10px;font-size:.81rem">

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
              <div style="font-weight:600;margin-bottom:6px">1. ${_qbt('setup_step1')}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <code style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:.78rem">sudo apt install qbittorrent-nox</code>
                <button class="s-btn s-btn-sm qb-run-cmd" data-cmd="sudo apt install qbittorrent-nox" title="Run in terminal">▶</button>
              </div>
            </div>

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
              <div style="font-weight:600;margin-bottom:6px">2. ${_qbt('setup_step3_start')}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <code style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:.78rem">qbittorrent-nox --daemon</code>
                <button class="s-btn s-btn-sm qb-run-cmd" data-cmd="qbittorrent-nox --daemon" title="Run in terminal">▶</button>
              </div>
            </div>

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
              <div style="font-weight:600;margin-bottom:6px">3. ${_qbt('setup_step2')}</div>
              <div style="color:var(--text-dim);font-size:.76rem;margin-bottom:6px">${_qbt('setup_step2b')}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <code style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:.78rem">http://localhost:8090</code>
                <button class="s-btn s-btn-sm" id="qb-open-webui" title="Open in browser">🌐</button>
              </div>
            </div>

            <div style="background:#f1fa8c18;border:1px solid #f1fa8c44;border-radius:6px;padding:8px 12px;font-size:.74rem;color:#f1fa8c">
              ⚠️ ${_qbt('setup_note')}
            </div>

            <div style="display:flex;gap:8px;justify-content:center;padding-top:4px">
              <button class="s-btn" id="qb-disc-btn">${_qbt('discover_btn')}</button>
              <button class="s-btn" id="qb-settings-btn">${_qbt('settings_btn')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll('.qb-run-cmd').forEach(btn => {
      btn.addEventListener('click', () => _runInTerminal(btn.dataset.cmd));
    });
    root.querySelector('#qb-open-webui')?.addEventListener('click', () => {
      window.open(`http://${_cfg.host || 'localhost'}:${_cfg.port || 8090}`, '_blank');
    });
    root.querySelector('#qb-disc-btn')?.addEventListener('click', async () => {
      const btn = root.querySelector('#qb-disc-btn');
      btn.disabled = true; btn.textContent = '…';
      const disc = await fetch('/api/qbit/discover').then(r => r.json()).catch(() => ({}));
      if (disc.found) {
        await _saveCfg('host', disc.host);
        await _saveCfg('port', disc.port);
        _startPoll();
      } else {
        btn.disabled = false; btn.textContent = _qbt('discover_btn');
        _renderConnect(root);
      }
    });
    root.querySelector('#qb-settings-btn')?.addEventListener('click', () => {
      mvmOS.openSettings?.('apps');
    });
  }

  function _renderSidebar(root) {
    const sidebar = root.querySelector('#qb-sidebar');
    const cats = [
      { id: 'all', label: _qbt('all') },
      { id: 'downloading', label: _qbt('downloading') },
      { id: 'seeding', label: _qbt('seeding') },
      { id: 'paused', label: _qbt('paused') },
      { id: 'completed', label: _qbt('completed') },
      { id: 'active', label: _qbt('active') },
      { id: 'error', label: _qbt('error') },
    ];
    sidebar.innerHTML = cats.map(c => `
      <div class="qb-sidebar-item ${_filter === c.id ? 'active' : ''}" data-cat="${c.id}">
        ${c.label}
        <span class="qb-count">${_count(c.id)}</span>
      </div>
    `).join('');
    sidebar.querySelectorAll('.qb-sidebar-item').forEach(el => {
      el.addEventListener('click', () => {
        _filter = el.dataset.cat;
        _renderAll();
      });
    });
  }

  function _renderList(root, filtered, sel) {
    const list = root.querySelector('#qb-list');
    if (!filtered.length) {
      list.innerHTML = `<div class="qb-empty">${_connected ? _qbt('no_torrents') : _qbt('connecting')}</div>`;
      return;
    }
    list.innerHTML = filtered.map(t => {
      const sc = _stateClass(t.state);
      const pct = Math.round((t.progress || 0) * 100);
      return `
        <div class="qb-item ${t.hash === _selected ? 'selected' : ''}" data-hash="${t.hash}">
          <div class="qb-item-top">
            <span class="qb-item-name" title="${t.name}">${t.name}</span>
            <span class="qb-item-size">${_fmtSize(t.size)}</span>
          </div>
          <div class="qb-item-bar">
            <div class="qb-item-bar-fill qb-bar-${sc}" style="width:${pct}%"></div>
          </div>
          <div class="qb-item-bottom">
            <span class="qb-item-status qb-st-${sc}">${_stateLabel(t.state)}</span>
            <span>${pct}%</span>
            ${t.dlspeed > 0 ? `<span>↓ ${_fmtSpeed(t.dlspeed)}</span>` : ''}
            ${t.upspeed > 0 ? `<span>↑ ${_fmtSpeed(t.upspeed)}</span>` : ''}
            ${t.dlspeed > 0 ? `<span class="qb-spacer"></span><span>ETA ${_fmtEta(t.eta)}</span>` : '<span class="qb-spacer"></span>'}
            <span>⇅ ${_fmtRatio(t.ratio)}</span>
          </div>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.qb-item').forEach(el => {
      el.addEventListener('click', () => {
        _selected = el.dataset.hash === _selected ? null : el.dataset.hash;
        _detailTab = 'info';
        _renderAll();
      });
    });
  }

  function _renderDetail(root, t) {
    const detail = root.querySelector('#qb-detail');
    if (!detail) return;
    const tabs = ['info', 'files', 'peers'];
    detail.innerHTML = `
      <div class="qb-detail-tabs">
        ${tabs.map(tb => `<div class="qb-detail-tab ${_detailTab === tb ? 'active' : ''}" data-tab="${tb}">${_qbt(tb)}</div>`).join('')}
      </div>
      <div class="qb-detail-body" id="qb-detail-body"></div>
    `;
    detail.querySelectorAll('.qb-detail-tab').forEach(el => {
      el.addEventListener('click', () => { _detailTab = el.dataset.tab; _renderDetail(root, t); });
    });
    const body = detail.querySelector('#qb-detail-body');
    if (_detailTab === 'info') {
      const rows = [
        [_qbt('status'), _stateLabel(t.state)],
        [_qbt('size'), _fmtSize(t.size)],
        [_qbt('progress'), Math.round((t.progress || 0) * 100) + '%'],
        [_qbt('dl_speed'), _fmtSpeed(t.dlspeed)],
        [_qbt('ul_speed'), _fmtSpeed(t.upspeed)],
        [_qbt('eta'), _fmtEta(t.eta)],
        [_qbt('ratio'), _fmtRatio(t.ratio)],
        [_qbt('seeds'), t.num_seeds ?? '—'],
        [_qbt('peers_lbl'), t.num_leechs ?? '—'],
        [_qbt('added'), _fmtDate(t.added_on)],
        [_qbt('save_path'), t.save_path || '—'],
        [_qbt('category'), t.category || '—'],
        [_qbt('hash'), (t.hash || '').slice(0, 16) + '…'],
      ];
      body.innerHTML = rows.map(([l, v]) => `
        <div class="qb-detail-row">
          <span class="qb-detail-label">${l}</span>
          <span class="qb-detail-val" title="${v}">${v}</span>
        </div>
      `).join('');
    } else if (_detailTab === 'files') {
      body.innerHTML = `<div style="color:var(--text-dim);font-size:.75rem;padding:8px">${_qbt('connecting')}</div>`;
      _api(`/api/v2/torrents/files?hash=${t.hash}`).then(files => {
        if (!Array.isArray(files) || !files.length) { body.innerHTML = `<div style="padding:8px;color:var(--text-dim)">${_qbt('no_torrents')}</div>`; return; }
        body.innerHTML = files.map(f => `
          <div class="qb-detail-row" style="flex-direction:column;gap:2px;align-items:flex-start">
            <span class="qb-detail-label" style="max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.name}">${f.name.split('/').pop()}</span>
            <span style="font-size:.7rem;color:var(--text-dim)">${_fmtSize(f.size)} · ${Math.round((f.progress || 0) * 100)}%</span>
          </div>
        `).join('');
      }).catch(() => { body.innerHTML = `<div style="padding:8px;color:#ff5555">Error loading files</div>`; });
    } else if (_detailTab === 'peers') {
      body.innerHTML = `<div style="color:var(--text-dim);font-size:.75rem;padding:8px">${_qbt('connecting')}</div>`;
      _api(`/api/v2/sync/torrentPeers?hash=${t.hash}`).then(data => {
        const peers = data?.peers ? Object.values(data.peers) : [];
        if (!peers.length) { body.innerHTML = `<div style="padding:8px;color:var(--text-dim)">No peers</div>`; return; }
        body.innerHTML = peers.map(p => `
          <div class="qb-detail-row">
            <span class="qb-detail-label">${p.ip}:${p.port}</span>
            <span class="qb-detail-val" style="font-size:.68rem">${p.client || '?'} · ↓${_fmtSpeed(p.dl_speed)} ↑${_fmtSpeed(p.up_speed)}</span>
          </div>
        `).join('');
      }).catch(() => { body.innerHTML = `<div style="padding:8px;color:#ff5555">Error loading peers</div>`; });
    }
  }

  function _renderStatusBar(root) {
    const bar = root.querySelector('#qb-statusbar');
    if (!bar) return;
    const dl = _torrents.reduce((s, t) => s + (t.dlspeed || 0), 0);
    const ul = _torrents.reduce((s, t) => s + (t.upspeed || 0), 0);
    bar.innerHTML = `
      <span>${_torrents.length} torrents</span>
      <span>${_qbt('total_dl')} ${_fmtSpeed(dl)}</span>
      <span>${_qbt('total_ul')} ${_fmtSpeed(ul)}</span>
      <span style="margin-left:auto;color:${_connected ? 'var(--text-dim)' : '#ff5555'}">${_connected ? '● Connected' : '● Disconnected'}</span>
    `;
  }

  function _bindToolbar(root, sel) {
    root.querySelector('#qb-add')?.addEventListener('click', () => _showAddDialog(root));
    root.querySelector('#qb-resume')?.addEventListener('click', () => sel && _api('/api/v2/torrents/resume', 'POST', { hashes: sel.hash }).then(() => _poll()));
    root.querySelector('#qb-pause')?.addEventListener('click', () => sel && _api('/api/v2/torrents/pause', 'POST', { hashes: sel.hash }).then(() => _poll()));
    root.querySelector('#qb-delete')?.addEventListener('click', () => sel && _confirmDelete(root, sel));
    root.querySelector('#qb-resume-all')?.addEventListener('click', () => _api('/api/v2/torrents/resume', 'POST', { hashes: 'all' }).then(() => _poll()));
    root.querySelector('#qb-pause-all')?.addEventListener('click', () => _api('/api/v2/torrents/pause', 'POST', { hashes: 'all' }).then(() => _poll()));
  }

  function _showAddDialog(root) {
    const savedPath = _cfg.saved_dl_path || '';
    const rememberChecked = !!_cfg.remember_dl_path;
    const ov = document.createElement('div');
    ov.className = 'qb-dialog-overlay';
    ov.innerHTML = `
      <div class="qb-dialog">
        <h3>${_qbt('add')}</h3>
        <label>${_qbt('magnet_or_url')}</label>
        <input id="qb-add-url" type="text" placeholder="magnet:?xt=..." autofocus>
        <label>${_qbt('or_file')}</label>
        <input id="qb-add-file" type="file" accept=".torrent" style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.82rem;width:100%;box-sizing:border-box">
        <label>${_qbt('save_path_label')}</label>
        <input id="qb-add-path" type="text" placeholder="~/Downloads" value="${savedPath}">
        <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-dim);cursor:pointer">
          <input type="checkbox" id="qb-remember-path" ${rememberChecked ? 'checked' : ''}>
          ${_qbt('remember_path')}
        </label>
        <label>${_qbt('category_label')}</label>
        <input id="qb-add-cat" type="text" placeholder="">
        <div class="qb-dialog-btns">
          <button id="qb-add-cancel">${_qbt('cancel')}</button>
          <button id="qb-add-ok" class="primary">${_qbt('add_btn')}</button>
        </div>
      </div>
    `;
    root.style.position = 'relative';
    root.appendChild(ov);
    ov.querySelector('#qb-add-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#qb-add-ok').addEventListener('click', async () => {
      const url = ov.querySelector('#qb-add-url').value.trim();
      const file = ov.querySelector('#qb-add-file').files[0];
      const path = ov.querySelector('#qb-add-path').value.trim();
      const remember = ov.querySelector('#qb-remember-path').checked;
      const cat = ov.querySelector('#qb-add-cat').value.trim();
      // save/clear remembered path
      if (remember && path) {
        await _saveCfg('saved_dl_path', path);
        await _saveCfg('remember_dl_path', true);
      } else if (!remember) {
        await _saveCfg('remember_dl_path', false);
        await _saveCfg('saved_dl_path', '');
      }
      if (!url && !file) return;
      const btn = ov.querySelector('#qb-add-ok');
      btn.disabled = true; btn.textContent = '…';
      try {
        if (file) {
          // Upload .torrent file via multipart proxy
          const fd = new FormData();
          fd.append('host', _cfg.host || 'localhost');
          fd.append('port', String(_cfg.port || 8080));
          fd.append('username', _cfg.username || '');
          fd.append('password', _cfg.password || '');
          if (path) fd.append('savepath', path);
          if (cat) fd.append('category', cat);
          fd.append('torrents', file, file.name);
          await fetch('/api/qbit/upload', { method: 'POST', body: fd });
        } else {
          const data = { urls: url };
          if (path) data.savepath = path;
          if (cat) data.category = cat;
          await _api('/api/v2/torrents/add', 'POST', data);
        }
      } catch(_) {}
      ov.remove();
      setTimeout(_poll, 500);
    });
    ov.querySelector('.qb-dialog').addEventListener('click', e => e.stopPropagation());
    ov.addEventListener('click', () => ov.remove());
    ov.querySelector('#qb-add-url').focus();
  }

  function _confirmDelete(root, t) {
    const ov = document.createElement('div');
    ov.className = 'qb-dialog-overlay';
    ov.innerHTML = `
      <div class="qb-dialog">
        <h3>${_qbt('delete_confirm')}</h3>
        <p style="margin:0;font-size:.82rem;color:var(--text-dim)">${t.name}</p>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
          <input type="checkbox" id="qb-del-files"> ${_qbt('delete_files')}
        </label>
        <div class="qb-dialog-btns">
          <button id="qb-del-cancel">${_qbt('cancel')}</button>
          <button id="qb-del-ok" class="primary" style="background:#ff5555">${_qbt('delete')}</button>
        </div>
      </div>
    `;
    root.style.position = 'relative';
    root.appendChild(ov);
    ov.querySelector('#qb-del-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#qb-del-ok').addEventListener('click', async () => {
      const delFiles = ov.querySelector('#qb-del-files').checked;
      await _api('/api/v2/torrents/delete', 'POST', { hashes: t.hash, deleteFiles: delFiles }).catch(() => {});
      _selected = null;
      ov.remove();
      setTimeout(_poll, 500);
    });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  }

  return { mount };
})();
