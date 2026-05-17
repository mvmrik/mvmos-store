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
    save_path_label: 'Save to (optional)',
    category_label: 'Category (optional)',
    add_btn: 'Add', cancel: 'Cancel',
    connecting: 'Connecting…', no_conn: 'Not connected to qBittorrent.',
    no_conn_hint: 'Configure host/port/credentials in Settings → qBittorrent.',
    discover_btn: 'Auto-detect', settings_btn: '⚙ Settings',
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
    save_path_label: 'Запази в (незадължително)',
    category_label: 'Категория (незадължително)',
    add_btn: 'Добави', cancel: 'Отказ',
    connecting: 'Свързване…', no_conn: 'Няма връзка с qBittorrent.',
    no_conn_hint: 'Настрой хост/порт/данни в Настройки → qBittorrent.',
    discover_btn: 'Автодетект', settings_btn: '⚙ Настройки',
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
    { key: 'host',     label: 'Host',     type: 'text',     default: 'localhost' },
    { key: 'port',     label: 'Port',     type: 'number',   default: 8080, min: 1, max: 65535 },
    { key: 'username', label: 'Username', type: 'text',     default: 'admin' },
    { key: 'password', label: 'Password', type: 'password', default: '' },
  ],
  launch() {
    mvmOS.createWindow({
      id: 'qbittorrent',
      title: '🌊 ' + _qbt('title'),
      width: 960,
      height: 600,
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

  let _cfg = { host: 'localhost', port: 8080, username: 'admin', password: '' };
  let _torrents = [];
  let _filter = 'all';
  let _selected = null;
  let _detailTab = 'info';
  let _pollTimer = null;
  let _connected = false;
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

  // ── Poll ──
  async function _poll() {
    try {
      const list = await _api('/api/v2/torrents/info');
      _torrents = Array.isArray(list) ? list : [];
      _connected = true;
      _renderAll();
    } catch(e) {
      _connected = false;
      _renderAll();
    }
  }
  function _startPoll() {
    clearInterval(_pollTimer);
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
      if (e.detail?.app === 'qbittorrent') { _loadCfg().then(() => { _renderAll(); _startPoll(); }); }
    });
  }

  // ── Render ──
  function _renderAll() {
    const root = _root?.querySelector('#qb-root');
    if (!root) return;

    if (!_connected && !_cfg.password && !_cfg.host) {
      _renderConnect(root);
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

  function _renderConnect(root) {
    root.innerHTML = `
      <div class="qb-root">
        <div class="qb-connect-screen">
          <div style="font-size:2.5rem">🌊</div>
          <p>${!_connected && _cfg.host ? '❌ ' + _qbt('no_conn') : _qbt('no_conn')}</p>
          <p>${_qbt('no_conn_hint')}</p>
          <div style="display:flex;gap:8px">
            <button class="s-btn" id="qb-disc-btn">${_qbt('discover_btn')}</button>
            <button class="s-btn" id="qb-settings-btn">${_qbt('settings_btn')}</button>
          </div>
        </div>
      </div>
    `;
    root.querySelector('#qb-disc-btn')?.addEventListener('click', async () => {
      const disc = await fetch('/api/qbit/discover').then(r => r.json()).catch(() => ({}));
      if (disc.found) {
        await _saveCfg('host', disc.host);
        await _saveCfg('port', disc.port);
        _startPoll();
      } else {
        alert('qBittorrent not found. Please configure manually in Settings.');
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
    const ov = document.createElement('div');
    ov.className = 'qb-dialog-overlay';
    ov.innerHTML = `
      <div class="qb-dialog">
        <h3>${_qbt('add')}</h3>
        <label>${_qbt('magnet_or_url')}</label>
        <input id="qb-add-url" type="text" placeholder="magnet:?xt=..." autofocus>
        <label>${_qbt('save_path_label')}</label>
        <input id="qb-add-path" type="text" placeholder="~/Downloads">
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
      const path = ov.querySelector('#qb-add-path').value.trim();
      const cat = ov.querySelector('#qb-add-cat').value.trim();
      if (!url) return;
      const data = { urls: url };
      if (path) data.savepath = path;
      if (cat) data.category = cat;
      await _api('/api/v2/torrents/add', 'POST', data).catch(() => {});
      ov.remove();
      setTimeout(_poll, 500);
    });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
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
