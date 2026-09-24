// mvmOS App: qBit Dashboard v1.0.9
// The app name is a brand and reads the same in every language, so registerApp()
// can use it before public/i18n.js (every other string) has loaded.
function _qbt(key, vars) {
  const lang = window.mvmOS?.lang || 'en';
  const all = window.QBIT_I18N || {};
  let s = (all[lang] || {})[key] ?? (all.en || {})[key];
  if (s == null) s = key === 'title' ? 'qBit Dashboard' : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}
let _qbI18nReady = null;
function _qbLoadI18n() {
  if (window.QBIT_I18N) return Promise.resolve();
  if (_qbI18nReady) return _qbI18nReady;
  _qbI18nReady = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = '/apps/qbit-dashboard/i18n.js?_=' + Date.now();
    s.onload = resolve;
    s.onerror = () => { _qbI18nReady = null; resolve(); };
    document.head.appendChild(s);
  });
  return _qbI18nReady;
}

mvmOS.registerApp({
  id: 'qbit-dashboard',
  name: _qbt('title'),
  icon: '🌊',
  category: 'Media',
  trayable: true,
  settings: [
    { key: 'host',         label: 'Host',                  type: 'text',     default: 'localhost' },
    { key: 'port',         label: 'Port',                  type: 'number',   default: 8080, min: 1, max: 65535 },
    { key: 'username',     label: 'Username',              type: 'text',     default: 'admin' },
    { key: 'password',     label: 'Password',              type: 'password', default: '' },
    { key: 'ipt_uid',    label: 'IPTorrents Cookie: uid',    type: 'text', default: '' },
    { key: 'ipt_pass',   label: 'IPTorrents Cookie: pass',   type: 'text', default: '' },
    { key: 'ipt_togtem', label: 'IPTorrents Cookie: togTem', type: 'text', default: '' },
  ],
  async renderSettingsExtra(wrap, saved) {
    this._lastSaved = saved;
    await _qbLoadI18n();
    wrap.innerHTML = `<div style="font-size:.75rem;color:var(--text-dim);margin-top:4px">${_qbt('opts_loading')}</div>`;
    try {
      // read all connection params from DB to avoid stale/empty 'saved' values
      const db = mvmOS.db('qbit-dashboard');
      const rows = await db.query('SELECT key, value FROM cfg');
      const cfg = {};
      rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch(_) { cfg[r.key] = r.value; } });
      const host = cfg.host || saved.host || 'localhost';
      const port = cfg.port || saved.port || 8080;
      const username = cfg.username || saved.username || '';
      const password = cfg.password || saved.password || '';
      const res = await fetch('/api/qbit/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, username, password, path: '/api/v2/app/preferences', method: 'GET' }),
      });
      const prefs = await res.json();
      wrap.innerHTML = `
        <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:12px">
          <div style="font-size:.8rem;font-weight:600;color:var(--text-dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">${_qbt('opts_title')}</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="dht" ${prefs.dht ? 'checked' : ''}> ${_qbt('opts_dht')}
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="pex" ${prefs.pex ? 'checked' : ''}> ${_qbt('opts_pex')}
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="lsd" ${prefs.lsd ? 'checked' : ''}> ${_qbt('opts_lsd')}
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="anonymous_mode" ${prefs.anonymous_mode ? 'checked' : ''}> ${_qbt('opts_anonymous')}
            </label>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_encryption')}</label>
              <select data-qbpref="encryption" class="s-input">
                <option value="0" ${prefs.encryption===0?'selected':''}>${_qbt('opts_encryption_prefer')}</option>
                <option value="1" ${prefs.encryption===1?'selected':''}>${_qbt('opts_encryption_force')}</option>
                <option value="2" ${prefs.encryption===2?'selected':''}>${_qbt('opts_encryption_disable')}</option>
              </select>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="max_ratio_enabled" ${prefs.max_ratio_enabled ? 'checked' : ''}> ${_qbt('opts_max_ratio_enabled')}
            </label>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_max_ratio')}</label>
              <input type="number" data-qbpref="max_ratio" class="s-input" value="${prefs.max_ratio ?? 1}" step="0.1" min="0">
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.85rem">
              <input type="checkbox" data-qbpref="max_seeding_time_enabled" ${prefs.max_seeding_time_enabled ? 'checked' : ''}> ${_qbt('opts_max_seeding_time_enabled')}
            </label>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_max_seeding_time')}</label>
              <input type="number" data-qbpref="max_seeding_time" class="s-input" value="${prefs.max_seeding_time ?? 0}" min="0">
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_max_ratio_act')}</label>
              <select data-qbpref="max_ratio_act" class="s-input">
                <option value="0" ${(prefs.max_ratio_act??0)===0?'selected':''}>${_qbt('opts_action_pause')}</option>
                <option value="1" ${prefs.max_ratio_act===1?'selected':''}>${_qbt('opts_action_remove')}</option>
                <option value="3" ${prefs.max_ratio_act===3?'selected':''}>${_qbt('opts_action_remove_files')}</option>
              </select>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_dl_limit')}</label>
              <input type="number" data-qbpref="dl_limit" class="s-input" value="${Math.round((prefs.dl_limit || 0) / 1024)}" min="0">
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <label style="font-size:.8rem;color:var(--text-dim)">${_qbt('opts_ul_limit')}</label>
              <input type="number" data-qbpref="ul_limit" class="s-input" value="${Math.round((prefs.up_limit || 0) / 1024)}" min="0">
            </div>
          </div>
        </div>
      `;
    } catch(err) {
      wrap.innerHTML = `<div style="font-size:.75rem;color:var(--text-dim);margin-top:8px;border-top:1px solid var(--border);padding-top:8px">${_qbt('opts_unavailable')} (${err.message || _qbt('opts_not_connected')})</div>`;
    }
  },

  async saveSettingsExtra(panel) {
    const prefs = {};
    panel.querySelectorAll('[data-qbpref]').forEach(el => {
      const key = el.dataset.qbpref;
      if (el.type === 'checkbox') prefs[key] = el.checked;
      else if (key === 'dl_limit') prefs[key] = Number(el.value) * 1024;
      else if (key === 'ul_limit') prefs[key] = Number(el.value) * 1024;
      else if (el.tagName === 'SELECT' || el.type === 'number') prefs[key] = Number(el.value);
      else prefs[key] = el.value;
    });
    if (!Object.keys(prefs).length) return;
    try {
      const host = panel.querySelector('[data-key="host"]')?.value || this._lastSaved?.host || 'localhost';
      const port = Number(panel.querySelector('[data-key="port"]')?.value) || this._lastSaved?.port || 8080;
      const username = panel.querySelector('[data-key="username"]')?.value || this._lastSaved?.username || '';
      const password = panel.querySelector('[data-key="password"]')?.value || this._lastSaved?.password || '';
      await fetch('/api/qbit/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, username, password, path: '/api/v2/app/setPreferences', method: 'POST', data: { json: JSON.stringify(prefs) } }),
      });
    } catch(_) {}
  },

  launch() {
    mvmOS.createWindow({
      id: 'qbit-dashboard',
      title: '🌊 ' + _qbt('title'),
      icon: '🌊',
      width: 960,
      height: 600,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'qbit-dashboard' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        Promise.all([window.mvmOS?.i18nReady, _qbLoadI18n()]).then(() => QB.mount(body));
      },
    });
  },
});

// ── Core ──────────────────────────────────────────────────────────────────────
const QB = (() => {
  const _db = mvmOS.db('qbit-dashboard');

  let _cfg = {
    host: 'localhost', port: 8080, username: 'admin', password: '',
  };
  let _torrents = [];
  let _filter = 'all';
  let _sortBy = 'added_on';
  let _sortDir = 'desc';
  let _selected = null;
  let _detailTab = 'info';
  let _props = { hash: null, at: 0, data: null }; // torrents/properties of the selected torrent
  let _pollTimer = null;
  let _connected = false;
  let _pollCount = 0;
  let _root = null;
  let _view = 'list';          // 'list' | 'stats'
  let _server = {};            // qBittorrent's server_state, kept current via sync/maindata
  let _rid = 0;
  let _speedHist = [];         // { t, dl, ul } per poll, last _SPEED_WINDOW ms
  let _hourly = [];            // stats_hourly rows { hour, dl, ul }, oldest first
  let _lastSnap = 0;
  const _SPEED_WINDOW = 10 * 60 * 1000;
  const _SNAP_EVERY = 60 * 1000;

  // ── Settings DB ──
  async function _initDb() {
    await _db.run(`CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)`);
    await _db.run(`CREATE TABLE IF NOT EXISTS stats_hourly (hour INTEGER PRIMARY KEY, dl INTEGER, ul INTEGER)`);
  }
  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    rows.forEach(r => { try { _cfg[r.key] = JSON.parse(r.value); } catch(_) { _cfg[r.key] = r.value; } });
    // apply defaults for missing keys
    const defaults = { host: 'localhost', port: 8080, username: 'admin', password: '', sort_by: 'added_on', sort_dir: 'desc', ipt_uid: '', ipt_pass: '', ipt_togtem: '' };
    for (const [k, v] of Object.entries(defaults)) {
      if (_cfg[k] === undefined) await _saveCfg(k, v);
    }
    _sortBy = _cfg.sort_by || 'added_on';
    _sortDir = _cfg.sort_dir || 'desc';
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
    if (!res.ok && res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text) throw new Error('Empty response from proxy');
    const j = JSON.parse(text);
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
    if (!sec || sec <= 0 || sec >= 8640000) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (d > 0) return `${d}d ${h}h`;
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
      downloading: _qbt('downloading'), metaDL: _qbt('state_metadl'), forcedMetaDL: _qbt('state_metadl'),
      forcedDL: _qbt('state_forceddl'),
      uploading: _qbt('seeding'), forcedUP: _qbt('state_forcedup'), stalledUP: _qbt('state_stalledup'),
      stalledDL: _qbt('state_stalled'), pausedDL: _qbt('paused'), pausedUP: _qbt('paused'),
      stoppedDL: _qbt('paused'), stoppedUP: _qbt('paused'),
      error: _qbt('error'), missingFiles: _qbt('state_missing'),
      checkingUP: _qbt('state_checking'), checkingDL: _qbt('state_checking'), checkingResumeData: _qbt('state_resuming'),
      queuedDL: _qbt('state_queued'), queuedUP: _qbt('state_queued'),
      allocating: _qbt('state_allocating'), moving: _qbt('state_moving'),
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
    _pollCount++;
    try {
      const list = await _api(`/api/v2/torrents/info?sort=${_sortBy}&reverse=${_sortDir === 'desc'}`);
      _torrents = Array.isArray(list) ? list : [];
      _connected = true;
      await _pollServer().catch(() => {});
      _recordSpeed();
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

    body.innerHTML = `
      <div class="qb-root" id="qb-root" style="display:flex;flex-direction:column;height:100%">
        <div class="qb-toolbar-wrap" id="qb-toolbar-wrap"></div>
        <div class="qb-body" style="flex:1;overflow:hidden;display:flex">
          <div class="qb-sidebar as-sidebar" id="qb-sidebar"></div>
          <div style="flex:1;overflow:hidden;display:flex;flex-direction:column">
            <div id="qb-main-area" style="flex:1;overflow:hidden;display:flex;position:relative"></div>
            <div class="qb-statusbar" id="qb-statusbar"></div>
          </div>
        </div>
      </div>`;
    const root = body.querySelector('#qb-root');
    mvmOS.initMobileSidebar?.(body);


    _renderAll();
    _startPoll();
    window.mvmOS?.onLangChange(() => _renderAll());
    window.addEventListener('settings-changed', e => {
      if (e.detail?.app === 'qbit-dashboard') {
        _loadCfg().then(() => {
          _connected = false;
          _renderAll();
          _startPoll();
        });
      }
    });
  }

  // ── Render ──
  function _renderAll() {
    const root = _root?.querySelector('#qb-root');
    if (!root) return;
    if (root.querySelector('.qb-dialog-overlay')) return;

    const mainArea = root.querySelector('#qb-main-area');
    const toolbarWrap = root.querySelector('#qb-toolbar-wrap');

    if (!_connected && _torrents.length === 0) {
      if (toolbarWrap) toolbarWrap.innerHTML = '';
      if (mainArea) {
        if (_pollCount < 2) {
          mainArea.innerHTML = `<div class="qb-empty" style="flex:1;flex-direction:column;gap:8px"><div style="font-size:1.4rem">🌊</div><div>${_qbt('connecting')}</div></div>`;
        } else {
          _renderConnect(mainArea);
        }
      }
      root.querySelector('#qb-statusbar').innerHTML = '';
      return;
    }

    const filtered = _filtered();
    const sel = filtered.find(t => t.hash === _selected);

    toolbarWrap.innerHTML = `
      <div class="qb-toolbar">
        <button id="qb-add">${_qbt('add')}</button>
        <button id="qb-resume-all">${_qbt('resume_all_label')}</button>
        <button id="qb-pause-all">${_qbt('pause_all_label')}</button>
        <div class="qb-sep"></div>
        <div class="qb-speeds" id="qb-speeds"></div>
      </div>`;

    const _sortSel = root.querySelector('#qb-sort-select');
    const _dirSel = root.querySelector('#qb-sort-dir');
    if (!_sortSel?._open && !_dirSel?._open) _renderSidebar(root);

    if (_view === 'stats') {
      _renderStats(mainArea);
    } else {
      if (!mainArea.querySelector('#qb-list')) {
        mainArea.innerHTML = `
          <div class="qb-list" id="qb-list"></div>
          <div class="qb-detail" id="qb-detail" style="display:none"></div>`;
      }
      const detail = mainArea.querySelector('#qb-detail');
      if (detail) detail.style.display = sel ? '' : 'none';
      _renderList(root, filtered, sel);
      if (sel) _renderDetail(root, sel);
    }
    _renderStatusBar(root);
    _bindToolbar(root);
  }

  function _runInTerminal(cmd) {
    // Open mvmOS terminal and run command
    mvmOS.createWindow({
      id: 'terminal-qbit-' + Date.now(),
      title: '🖥 ' + _qbt('terminal_title'),
      width: 600,
      height: 340,
      onMount(body) {
        body.style.padding = '0';
        // Dispatch terminal open event with pre-filled command
        window.dispatchEvent(new CustomEvent('terminal-run', { detail: { cmd } }));
        body.innerHTML = `<div style="padding:16px;font-family:monospace;font-size:.82rem;color:var(--text)">
          <div style="color:var(--text-dim);margin-bottom:8px">${_qbt('terminal_run_hint')}</div>
          <code style="display:block;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 12px;user-select:all">${cmd}</code>
          <div style="margin-top:12px;color:var(--text-dim);font-size:.75rem">${_qbt('terminal_paste_hint')}</div>
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
                <button class="s-btn s-btn-sm qb-run-cmd" data-cmd="sudo apt install qbittorrent-nox" title="${_qbt('run_in_terminal')}">▶</button>
              </div>
            </div>

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
              <div style="font-weight:600;margin-bottom:6px">2. ${_qbt('setup_step3_start')}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <code style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:5px 10px;font-size:.78rem">qbittorrent-nox --daemon</code>
                <button class="s-btn s-btn-sm qb-run-cmd" data-cmd="qbittorrent-nox --daemon" title="${_qbt('run_in_terminal')}">▶</button>
              </div>
            </div>

            <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:10px 14px">
              <div style="font-weight:600;margin-bottom:6px">3. ${_qbt('setup_step2')}</div>
              <button class="s-btn" id="qb-autoconfig-btn" style="width:100%;margin-top:4px">⚙️ ${_qbt('autoconfig_btn')}</button>
              <div id="qb-autoconfig-status" style="font-size:.75rem;margin-top:6px;display:none"></div>
            </div>

            <div style="background:#f1fa8c18;border:1px solid #f1fa8c44;border-radius:6px;padding:8px 12px;font-size:.74rem;color:#f1fa8c">
              ⚠️ ${_qbt('setup_note')}
            </div>

            <div style="display:flex;gap:8px;justify-content:center;padding-top:4px">
              <button class="s-btn" id="qb-settings-btn">${_qbt('settings_btn')}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll('.qb-run-cmd').forEach(btn => {
      btn.addEventListener('click', () => _runInTerminal(btn.dataset.cmd));
    });
    root.querySelector('#qb-autoconfig-btn')?.addEventListener('click', async function() {
      const btn = this;
      const status = root.querySelector('#qb-autoconfig-status');
      btn.disabled = true;
      btn.textContent = '⏳ ...';
      status.style.display = 'none';
      try {
        const r = await fetch('/api/plugins/qbit-dashboard/configure-localhost', { method: 'POST' });
        const d = await r.json();
        status.style.display = 'block';
        if (d.ok) {
          status.style.color = 'var(--accent)';
          status.textContent = d.already ? _qbt('autoconfig_already') : _qbt('autoconfig_ok');
        } else {
          status.style.color = '#ff5555';
          status.textContent = _qbt('autoconfig_err') + (d.error || '');
        }
      } catch(e) {
        status.style.display = 'block';
        status.style.color = '#ff5555';
        status.textContent = _qbt('autoconfig_err') + e.message;
      }
      btn.disabled = false;
      btn.textContent = '⚙️ ' + _qbt('autoconfig_btn');
    });
    root.querySelector('#qb-settings-btn')?.addEventListener('click', () => {
      mvmOS.openSettings?.('apps');
    });
  }

  function _renderSidebar(root) {
    const sidebar = root.querySelector('#qb-sidebar');
    const sortOptions = [
      { val: 'added_on',      label: _qbt('sort_added') },
      { val: 'name',          label: _qbt('sort_name') },
      { val: 'size',          label: _qbt('sort_size') },
      { val: 'progress',      label: _qbt('sort_progress') },
      { val: 'dlspeed',       label: _qbt('sort_dlspeed') },
      { val: 'upspeed',       label: _qbt('sort_upspeed') },
      { val: 'ratio',         label: _qbt('sort_ratio') },
      { val: 'eta',           label: _qbt('sort_eta') },
      { val: 'num_seeds',     label: _qbt('sort_seeds') },
      { val: 'num_leechs',    label: _qbt('sort_peers') },
      { val: 'priority',      label: _qbt('sort_priority') },
      { val: 'completion_on', label: _qbt('sort_completion') },
    ];
    const cats = [
      { id: 'all', label: _qbt('all') },
      { id: 'downloading', label: _qbt('downloading') },
      { id: 'seeding', label: _qbt('seeding') },
      { id: 'paused', label: _qbt('paused') },
      { id: 'completed', label: _qbt('completed') },
      { id: 'active', label: _qbt('active') },
      { id: 'error', label: _qbt('error') },
    ];
    sidebar.innerHTML = `
      <div class="qb-sort-wrap" style="padding:8px 10px 6px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <select id="qb-sort-select" style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.75rem;padding:4px 6px;cursor:pointer;width:100%">
          ${sortOptions.map(o => `<option value="${o.val}" ${_sortBy === o.val ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>
        <select id="qb-sort-dir" style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.75rem;padding:4px 6px;cursor:pointer;width:100%">
          <option value="desc" ${_sortDir === 'desc' ? 'selected' : ''}>${_qbt('sort_desc_label')}</option>
          <option value="asc"  ${_sortDir === 'asc'  ? 'selected' : ''}>${_qbt('sort_asc_label')}</option>
        </select>
      </div>
      ${cats.map(c => `
        <div class="qb-sidebar-item ${_view === 'list' && _filter === c.id ? 'active' : ''}" data-cat="${c.id}">
          ${c.label}
          <span class="qb-count">${_count(c.id)}</span>
        </div>
      `).join('')}
      <div class="qb-sidebar-item qb-sidebar-stats ${_view === 'stats' ? 'active' : ''}" id="qb-stats-btn">📊 ${_qbt('stats')}</div>
    `;
    const sel = sidebar.querySelector('#qb-sort-select');
    sel.addEventListener('mousedown', () => { sel._open = true; });
    sel.addEventListener('change', async e => {
      sel._open = false;
      _sortBy = e.target.value;
      await _saveCfg('sort_by', _sortBy);
      await _poll();
    });
    sel.addEventListener('blur', () => { sel._open = false; });

    const dirSel = sidebar.querySelector('#qb-sort-dir');
    dirSel.addEventListener('mousedown', () => { dirSel._open = true; });
    dirSel.addEventListener('change', async e => {
      dirSel._open = false;
      _sortDir = e.target.value;
      await _saveCfg('sort_dir', _sortDir);
      await _poll();
    });
    dirSel.addEventListener('blur', () => { dirSel._open = false; });
    sidebar.querySelectorAll('.qb-sidebar-item').forEach(el => {
      el.addEventListener('click', () => {
        if (!el.dataset.cat) return;
        _filter = el.dataset.cat;
        _view = 'list';
        _renderAll();
      });
    });
    sidebar.querySelector('#qb-stats-btn')?.addEventListener('click', () => {
      if (_view === 'stats') return;
      _view = 'stats';
      _loadDaily().finally(_renderAll);
    });

    if (_cfg.ipt_uid && _cfg.ipt_pass) {
      const iptBtn = document.createElement('div');
      iptBtn.className = 'qb-sidebar-item';
      iptBtn.style.cssText = 'margin-top:8px;border-top:1px solid var(--border);padding-top:8px;color:var(--accent)';
      iptBtn.textContent = '🔍 ' + _qbt('ipt_sidebar');
      iptBtn.addEventListener('click', () => _openIptSearch());
      sidebar.appendChild(iptBtn);
    }
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
            <span class="qb-spacer"></span>
            ${_fmtEta(t.eta) !== '—' ? `<span>ETA ${_fmtEta(t.eta)}</span>` : ''}
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
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        document.querySelectorAll('.qb-ctx-menu').forEach(m => m.remove());
        const hash = el.dataset.hash;
        const t = _torrents.find(x => x.hash === hash);
        const menu = document.createElement('div');
        menu.className = 'qb-ctx-menu';
        menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:var(--shadow)`;
        const isPaused = t?.state?.startsWith('paused');
        const items = [
          { label: _qbt('ctx_resume'), action: () => _api('/api/v2/torrents/resume', 'POST', { hashes: hash }).then(() => _poll()) },
          { label: _qbt('ctx_pause'), action: () => _api('/api/v2/torrents/pause', 'POST', { hashes: hash }).then(() => _poll()) },
          { label: _qbt('ctx_delete'), action: () => _confirmDelete(list.closest('#qb-root'), t), danger: true },
        ];
        items.forEach(({ label, action, danger }) => {
          const item = document.createElement('div');
          item.textContent = label;
          item.style.cssText = `padding:6px 14px;font-size:.82rem;cursor:pointer;color:${danger ? '#ff5555' : 'var(--text)'}`;
          item.onmouseenter = () => item.style.background = danger ? '#ff555522' : 'var(--surface3, rgba(255,255,255,.07))';
          item.onmouseleave = () => item.style.background = '';
          item.addEventListener('click', () => { menu.remove(); action(); });
          menu.appendChild(item);
        });
        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
      });
    });
  }

  function _renderDetail(root, t, force = false) {
    const detail = root.querySelector('#qb-detail');
    if (!detail) return;
    const tabs = ['info', 'files', 'peers'];
    const isNew = !detail.querySelector('#qb-detail-body');
    if (isNew) {
      detail.innerHTML = `
        <div class="qb-detail-header">
          <div class="qb-detail-tabs">
            ${tabs.map(tb => `<div class="qb-detail-tab ${_detailTab === tb ? 'active' : ''}" data-tab="${tb}">${_qbt(tb)}</div>`).join('')}
          </div>
          <button class="qb-detail-close" id="qb-detail-close">✕</button>
        </div>
        <div class="qb-detail-body" id="qb-detail-body"></div>
      `;
      detail.querySelectorAll('.qb-detail-tab').forEach(el => {
        el.addEventListener('click', () => { _detailTab = el.dataset.tab; _renderDetail(root, t, true); });
      });
      detail.querySelector('#qb-detail-close')?.addEventListener('click', () => {
        _selected = null;
        _renderAll();
      });
    } else {
      // update active tab indicator
      detail.querySelectorAll('.qb-detail-tab').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === _detailTab);
      });
      // on poll, only refresh info tab silently — skip files/peers to avoid flicker
      if (!force && _detailTab !== 'info') return;
    }
    const body = detail.querySelector('#qb-detail-body');
    if (_detailTab === 'info') {
      const p = _props.hash === t.hash ? _props.data : null;
      _loadProps(root, t);
      const rows = [
        [_qbt('status'), _stateLabel(t.state)],
        [_qbt('size'), _fmtSize(t.size)],
        [_qbt('progress'), Math.round((t.progress || 0) * 100) + '%'],
        [_qbt('st_downloaded'), _withSession(t.downloaded, t.downloaded_session)],
        [_qbt('st_uploaded'), _withSession(t.uploaded, t.uploaded_session)],
        [_qbt('ratio'), _fmtRatio(t.ratio)],
        t.amount_left > 0 ? [_qbt('det_remaining'), _sz(t.amount_left)] : null,
        [_qbt('dl_speed'), _fmtSpeed(t.dlspeed)],
        [_qbt('ul_speed'), _fmtSpeed(t.upspeed)],
        [_qbt('eta'), _fmtEta(t.eta)],
        [_qbt('seeds'), _withSwarm(t.num_seeds, t.num_complete)],
        [_qbt('peers_lbl'), _withSwarm(t.num_leechs, t.num_incomplete)],
        t.availability >= 0 && t.progress < 1 ? [_qbt('det_availability'), Number(t.availability).toFixed(2)] : null,
        p && p.nb_connections != null ? [_qbt('det_connections'), p.nb_connections_limit > 0 ? `${p.nb_connections} / ${p.nb_connections_limit}` : p.nb_connections] : null,
        p && (p.dl_speed_avg > 0 || p.up_speed_avg > 0) ? [_qbt('det_avg_speed'), `↓ ${_fmtSpeed(p.dl_speed_avg)} &nbsp; ↑ ${_fmtSpeed(p.up_speed_avg)}`] : null,
        p && p.total_wasted > 0 ? [_qbt('st_wasted'), _sz(p.total_wasted)] : null,
        p && p.pieces_num > 0 ? [_qbt('det_pieces'), `${_fmtNum(p.pieces_have)} / ${_fmtNum(p.pieces_num)} × ${_sz(p.piece_size)}`] : null,
        t.dl_limit > 0 || t.up_limit > 0 ? [_qbt('det_limits'), `↓ ${t.dl_limit > 0 ? _fmtSpeed(t.dl_limit) : '∞'} &nbsp; ↑ ${t.up_limit > 0 ? _fmtSpeed(t.up_limit) : '∞'}`] : null,
        [_qbt('added'), _fmtDate(t.added_on)],
        t.completion_on > 0 ? [_qbt('det_completed_on'), _fmtDate(t.completion_on)] : null,
        [_qbt('det_time_active'), _fmtDuration(t.time_active)],
        [_qbt('det_seeding_time'), _fmtDuration(t.seeding_time)],
        t.last_activity > 0 ? [_qbt('det_last_activity'), _esc(new Date(t.last_activity * 1000).toLocaleString(window.mvmOS?.lang || 'en'))] : null,
        t.progress < 1 && t.seen_complete > 0 ? [_qbt('det_seen_complete'), _fmtDate(t.seen_complete)] : null,
        [_qbt('save_path'), `<span style="flex:1">${t.save_path || '—'}</span><button class="qb-move-btn s-btn s-btn-sm" data-hash="${t.hash}" style="margin-left:6px;flex-shrink:0">📁</button>`],
        [_qbt('category'), t.category || '—'],
        t.tags ? [_qbt('det_tags'), _esc(t.tags)] : null,
        [_qbt('st_col_tracker'), _esc(_trackerHost(t)) || '—'],
        _isPrivate(t, p) != null ? [_qbt('det_private'), _isPrivate(t, p) ? _qbt('det_yes') : _qbt('det_no')] : null,
        p && p.creation_date > 0 ? [_qbt('det_created'), _esc(_fmtDate(p.creation_date) + (p.created_by ? ' · ' + p.created_by : ''))] : null,
        p && p.comment ? [_qbt('det_comment'), `<span title="${_esc(p.comment)}">${_esc(p.comment)}</span>`] : null,
        [_qbt('hash'), (t.hash || '').slice(0, 16) + '…'],
      ];
      body.innerHTML = rows.filter(Boolean).map(([l, v]) => `
        <div class="qb-detail-row">
          <span class="qb-detail-label">${l}</span>
          <span class="qb-detail-val" style="display:flex;align-items:center">${v}</span>
        </div>
      `).join('');
      body.querySelectorAll('.qb-move-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          fetch('/api/files').then(r => r.json()).then(d => {
            FolderPicker.open({
              root: d.home || '/',
              onSelect: async (path) => {
                await fetch('/api/qbit/proxy', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ host: _cfg.host, port: _cfg.port, username: _cfg.username, password: _cfg.password, path: '/api/v2/torrents/setLocation', method: 'POST', data: { hashes: btn.dataset.hash, location: path } }),
                });
                _renderDetail(root, t, true);
              },
            });
          });
        });
      });
    } else if (_detailTab === 'files') {
      body.innerHTML = `<div style="color:var(--text-dim);font-size:.75rem;padding:8px">${_qbt('connecting')}</div>`;
      _api(`/api/v2/torrents/files?hash=${t.hash}`).then(files => {
        if (!Array.isArray(files) || !files.length) { body.innerHTML = `<div style="padding:8px;color:var(--text-dim)">${_qbt('no_files')}</div>`; return; }
        const prioLabel = { 0: _qbt('prio_skip'), 1: _qbt('prio_normal'), 6: _qbt('prio_high'), 7: _qbt('prio_max') };
        body.innerHTML = files.map((f, i) => `
          <div class="qb-detail-row qb-file-row" data-idx="${i}" data-hash="${t.hash}" style="gap:6px;align-items:center">
            <input type="checkbox" data-idx="${i}" data-hash="${t.hash}" ${f.priority !== 0 ? 'checked' : ''} style="flex-shrink:0;cursor:pointer">
            <div style="flex:1;overflow:hidden">
              <div class="qb-detail-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.name}">${f.name.split('/').pop()}</div>
              <div style="font-size:.7rem;color:var(--text-dim)">${_fmtSize(f.size)} · ${Math.round((f.progress || 0) * 100)}% · <span class="qb-file-prio">${prioLabel[f.priority] ?? _qbt('prio_normal')}</span></div>
            </div>
          </div>
        `).join('');
        body.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.addEventListener('change', () => {
            const prio = cb.checked ? 1 : 0;
            _api('/api/v2/torrents/filePrio', 'POST', { hash: cb.dataset.hash, id: cb.dataset.idx, priority: prio }).then(() => {
              cb.closest('.qb-file-row').querySelector('.qb-file-prio').textContent = { 0: _qbt('prio_skip'), 1: _qbt('prio_normal') }[prio];
            }).catch(() => {});
          });
        });
        body.querySelectorAll('.qb-file-row').forEach(row => {
          row.addEventListener('contextmenu', e => {
            e.preventDefault();
            document.querySelectorAll('.qb-ctx-menu').forEach(m => m.remove());
            const menu = document.createElement('div');
            menu.className = 'qb-ctx-menu';
            menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 0;z-index:9999;min-width:140px;box-shadow:var(--shadow)`;
            [0, 1, 6, 7].forEach(prio => {
              const item = document.createElement('div');
              item.textContent = prioLabel[prio];
              item.style.cssText = 'padding:6px 14px;font-size:.82rem;cursor:pointer;color:var(--text)';
              item.onmouseenter = () => item.style.background = 'var(--accent)';
              item.onmouseleave = () => item.style.background = '';
              item.addEventListener('click', () => {
                _api('/api/v2/torrents/filePrio', 'POST', { hash: row.dataset.hash, id: row.dataset.idx, priority: prio }).then(() => {
                  row.querySelector('.qb-file-prio').textContent = prioLabel[prio];
                  const cb = row.querySelector('input[type=checkbox]');
                  if (cb) cb.checked = prio !== 0;
                }).catch(() => {});
                menu.remove();
              });
              menu.appendChild(item);
            });
            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
          });
        });
      }).catch(() => { body.innerHTML = `<div style="padding:8px;color:#ff5555">${_qbt('err_files')}</div>`; });
    } else if (_detailTab === 'peers') {
      body.innerHTML = `<div style="color:var(--text-dim);font-size:.75rem;padding:8px">${_qbt('connecting')}</div>`;
      _api(`/api/v2/sync/torrentPeers?hash=${t.hash}`).then(data => {
        const peers = data?.peers ? Object.values(data.peers) : [];
        if (!peers.length) { body.innerHTML = `<div style="padding:8px;color:var(--text-dim)">${_qbt('no_peers')}</div>`; return; }
        body.innerHTML = peers.map(p => `
          <div class="qb-detail-row">
            <span class="qb-detail-label">${p.ip}:${p.port}</span>
            <span class="qb-detail-val" style="font-size:.68rem">${p.client || '?'} · ↓${_fmtSpeed(p.dl_speed)} ↑${_fmtSpeed(p.up_speed)}</span>
          </div>
        `).join('');
      }).catch(() => { body.innerHTML = `<div style="padding:8px;color:#ff5555">${_qbt('err_peers')}</div>`; });
    }
  }

  // ── Statistics ──
  function _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _localDay(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function _fmtDuration(sec) {
    if (!sec || sec <= 0) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d > 0) return _qbt('dur_dh', { d, h });
    if (h > 0) return _qbt('dur_hm', { h, m });
    return _qbt('dur_m', { m });
  }
  function _sz(b) { return b > 0 ? _fmtSize(b) : '0 B'; }
  function _withSwarm(connected, swarm) {
    const c = connected ?? '—';
    return swarm >= 0 ? `${c}<span class="qb-detail-sub">${_esc(_qbt('det_in_swarm', { n: _fmtNum(swarm) }))}</span>` : c;
  }
  function _isPrivate(t, p) {
    if (p && typeof p.is_private === 'boolean') return p.is_private;
    if (typeof t.private === 'boolean') return t.private;
    return null; // older qBittorrent does not report it
  }
  // Extra details come from a second call; it is refreshed at most every
  // few seconds and redraws the info tab once it arrives.
  async function _loadProps(root, t) {
    const now = Date.now();
    if (_props.hash === t.hash && now - _props.at < 5000) return;
    const stale = _props.hash !== t.hash;
    _props = { hash: t.hash, at: now, data: stale ? null : _props.data };
    try {
      const data = await _api(`/api/v2/torrents/properties?hash=${encodeURIComponent(t.hash)}`);
      if (_props.hash !== t.hash) return;
      _props.data = data;
      if (stale && _selected === t.hash && _detailTab === 'info') _renderDetail(root, t, true);
    } catch(_) {}
  }
  function _withSession(total, session) {
    return _sz(total) + (session > 0 ? `<span class="qb-detail-sub">${_esc(_qbt('det_session', { v: _sz(session) }))}</span>` : '');
  }
  function _fmtNum(n) { return Number(n || 0).toLocaleString(window.mvmOS?.lang || 'en'); }
  function _ratioOf(ul, dl) {
    if (dl > 0) return (ul / dl).toFixed(2);
    return ul > 0 ? '∞' : '—';
  }

  // qBittorrent's all-time totals only exist in sync/maindata; the rid keeps
  // every poll after the first down to the fields that actually changed.
  async function _pollServer() {
    const d = await _api(`/api/v2/sync/maindata?rid=${_rid}`);
    if (d.full_update) _server = {};
    if (d.server_state) Object.assign(_server, d.server_state);
    _rid = d.rid || 0;
    await _snapshot();
  }
  function _recordSpeed() {
    const now = Date.now();
    const dl = _server.dl_info_speed ?? _torrents.reduce((s, t) => s + (t.dlspeed || 0), 0);
    const ul = _server.up_info_speed ?? _torrents.reduce((s, t) => s + (t.upspeed || 0), 0);
    _speedHist.push({ t: now, dl, ul });
    while (_speedHist.length && _speedHist[0].t < now - _SPEED_WINDOW) _speedHist.shift();
  }
  // The server samples the all-time counters every few minutes into one row
  // per hour, even while the app is closed. The open app writes the same rows
  // too, so the history keeps going if that background service is switched off.
  async function _snapshot() {
    const dl = Number(_server.alltime_dl), ul = Number(_server.alltime_ul);
    if (!Number.isFinite(dl) || !Number.isFinite(ul)) return;
    const now = Date.now();
    if (now - _lastSnap < _SNAP_EVERY) return;
    _lastSnap = now;
    const sec = Math.floor(now / 1000);
    await _db.run('INSERT OR REPLACE INTO stats_hourly (hour, dl, ul) VALUES (?,?,?)', [sec - sec % 3600, dl, ul]);
    if (_view === 'stats') await _loadDaily();
  }
  async function _loadDaily() {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - 29);
    const since = Math.floor(from.getTime() / 1000);
    try {
      // The last reading before the window is the base for its first day.
      _hourly = await _db.query(
        'SELECT hour, dl, ul FROM stats_hourly WHERE hour >= (SELECT COALESCE(MAX(hour), 0) FROM stats_hourly WHERE hour < ?) ORDER BY hour',
        [since]);
    } catch(_) {}
  }
  // Each step between two readings belongs to the local day of the later one.
  function _dailyDeltas() {
    const pts = _hourly.map(r => ({ t: r.hour * 1000, dl: Number(r.dl), ul: Number(r.ul) }));
    const dl = Number(_server.alltime_dl), ul = Number(_server.alltime_ul);
    if (Number.isFinite(dl) && Number.isFinite(ul)) pts.push({ t: Date.now(), dl, ul });
    const out = new Map();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // A counter lower than before means qBittorrent's statistics were reset.
      const incDl = b.dl >= a.dl ? b.dl - a.dl : b.dl;
      const incUl = b.ul >= a.ul ? b.ul - a.ul : b.ul;
      const day = _localDay(new Date(b.t));
      const cur = out.get(day) || { dl: 0, ul: 0 };
      out.set(day, { dl: cur.dl + incDl, ul: cur.ul + incUl });
    }
    return out;
  }
  function _niceMax(v) {
    if (!v || v <= 0) return 1024;
    const p = Math.pow(1024, Math.floor(Math.log(v) / Math.log(1024)));
    const n = v / p;
    return ([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(x => x >= n) || 1024) * p;
  }
  function _stateGroup(state) {
    if (['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL'].includes(state)) return 'downloading';
    if (['uploading', 'forcedUP'].includes(state)) return 'seeding';
    if (['stalledDL', 'stalledUP'].includes(state)) return 'stalled';
    if (/^(paused|stopped)/.test(state)) return 'paused';
    if (['queuedDL', 'queuedUP'].includes(state)) return 'queued';
    if (['error', 'missingFiles'].includes(state)) return 'error';
    if (/^checking|allocating|moving/.test(state)) return 'checking';
    return 'other';
  }
  function _trackerHost(t) {
    if (!t.tracker) return '';
    try { return new URL(t.tracker).hostname.replace(/^www\./, ''); } catch(_) { return t.tracker; }
  }
  function _groupBy(keyFn) {
    const m = new Map();
    for (const t of _torrents) {
      const k = keyFn(t);
      const g = m.get(k) || { key: k, n: 0, size: 0, dl: 0, ul: 0 };
      g.n++; g.size += t.size || 0; g.dl += t.downloaded || 0; g.ul += t.uploaded || 0;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.ul - a.ul || b.n - a.n);
  }

  function _tile(label, value, sub) {
    return `<div class="qb-tile"><div class="qb-tile-label">${label}</div><div class="qb-tile-val">${value}</div>${sub ? `<div class="qb-tile-sub">${sub}</div>` : ''}</div>`;
  }
  function _legend(extra = '') {
    return `<div class="qb-legend"><span><i class="qb-key qb-key-dl"></i>${_qbt('st_download')}</span><span><i class="qb-key qb-key-ul"></i>${_qbt('st_upload')}</span>${extra}</div>`;
  }

  function _renderStats(mainArea) {
    const lang = window.mvmOS?.lang || 'en';
    let wrap = mainArea.querySelector('#qb-stats');
    if (!wrap || wrap.dataset.lang !== lang) {
      mainArea.innerHTML = `
        <div class="qb-stats" id="qb-stats" data-lang="${lang}">
          <div class="qb-stats-section" id="qb-st-tiles"></div>
          <div class="qb-card">
            <div class="qb-card-title">${_qbt('st_speed')}</div>
            ${_legend('<span class="qb-legend-now" id="qb-speed-now"></span>')}
            <div class="qb-speed-plot" id="qb-speed-plot">
              <span class="qb-speed-lbl" id="qb-speed-max" style="top:0"></span>
              <span class="qb-speed-lbl" id="qb-speed-mid" style="top:50%"></span>
              <svg viewBox="0 0 600 140" preserveAspectRatio="none">
                <line x1="0" y1="70" x2="600" y2="70" class="qb-grid" vector-effect="non-scaling-stroke"/>
                <line x1="0" y1="140" x2="600" y2="140" class="qb-axis" vector-effect="non-scaling-stroke"/>
                <path id="qb-speed-dl" class="qb-line qb-line-dl" vector-effect="non-scaling-stroke"/>
                <path id="qb-speed-ul" class="qb-line qb-line-ul" vector-effect="non-scaling-stroke"/>
              </svg>
              <div class="qb-cross" id="qb-speed-cross"></div>
              <div class="qb-speed-wait" id="qb-speed-wait">${_qbt('st_speed_wait')}</div>
            </div>
            <div class="qb-axis-x"><span>${_qbt('st_10min_ago')}</span><span>${_qbt('st_now')}</span></div>
          </div>
          <div class="qb-card" id="qb-st-daily"></div>
          <div class="qb-card-row">
            <div class="qb-card" id="qb-st-states"></div>
            <div class="qb-card" id="qb-st-added"></div>
          </div>
          <div class="qb-card" id="qb-st-trackers"></div>
          <div class="qb-card" id="qb-st-cats"></div>
          <div class="qb-card-row">
            <div class="qb-card" id="qb-st-top"></div>
            <div class="qb-card" id="qb-st-seed"></div>
          </div>
        </div>
        <div class="qb-tip" id="qb-tip"></div>`;
      wrap = mainArea.querySelector('#qb-stats');
      _bindStatsHover(mainArea);
    }
    _renderStatTiles(wrap);
    _renderSpeedChart(wrap);
    _renderDaily(wrap);
    _renderStates(wrap);
    _renderAdded(wrap, lang);
    _renderGroup(wrap.querySelector('#qb-st-trackers'), _qbt('st_trackers'), _qbt('st_col_tracker'), _groupBy(_trackerHost), _qbt('st_no_tracker'));
    _renderGroup(wrap.querySelector('#qb-st-cats'), _qbt('st_categories'), _qbt('category'), _groupBy(t => t.category || ''), _qbt('st_uncategorized'));
    _renderTopLists(wrap);
  }

  function _renderStatTiles(wrap) {
    const el = wrap.querySelector('#qb-st-tiles');
    const S = _server;
    const has = S.alltime_dl != null;
    const sum = k => _torrents.reduce((s, t) => s + (t[k] || 0), 0);
    const done = _torrents.filter(t => t.progress >= 1);
    const avgRatio = done.length ? (done.reduce((s, t) => s + Math.max(0, t.ratio || 0), 0) / done.length).toFixed(2) : '—';
    const active = _torrents.filter(t => t.dlspeed > 0 || t.upspeed > 0).length;
    el.innerHTML = `
      ${has ? `
        <div class="qb-card-title">${_qbt('st_alltime')}</div>
        <div class="qb-tiles">
          ${_tile('↓ ' + _qbt('st_downloaded'), _sz(S.alltime_dl))}
          ${_tile('↑ ' + _qbt('st_uploaded'), _sz(S.alltime_ul))}
          ${_tile(_qbt('ratio'), _esc(S.global_ratio ?? _ratioOf(S.alltime_ul, S.alltime_dl)))}
          ${_tile(_qbt('st_free'), _sz(S.free_space_on_disk))}
        </div>
        <div class="qb-card-title">${_qbt('st_session')}</div>
        <div class="qb-tiles">
          ${_tile('↓ ' + _qbt('st_downloaded'), _sz(S.dl_info_data))}
          ${_tile('↑ ' + _qbt('st_uploaded'), _sz(S.up_info_data))}
          ${_tile(_qbt('st_wasted'), _sz(S.total_wasted_session))}
          ${_tile(_qbt('st_connections'), _fmtNum(S.total_peer_connections))}
          ${_tile(_qbt('st_dht'), _fmtNum(S.dht_nodes))}
        </div>` : ''}
      <div class="qb-card-title">${_qbt('st_library')}</div>
      <div class="qb-tiles">
        ${_tile(_qbt('st_torrents'), _fmtNum(_torrents.length), _qbt('st_completed_n', { n: _fmtNum(done.length) }))}
        ${_tile(_qbt('st_total_size'), _sz(sum('size')))}
        ${_tile('↓ ' + _qbt('st_downloaded'), _sz(sum('downloaded')))}
        ${_tile('↑ ' + _qbt('st_uploaded'), _sz(sum('uploaded')))}
        ${_tile(_qbt('ratio'), _ratioOf(sum('uploaded'), sum('downloaded')), _qbt('st_avg_ratio', { r: avgRatio }))}
        ${_tile(_qbt('st_seeding_time'), _fmtDuration(sum('seeding_time')))}
        ${_tile(_qbt('st_active_now'), _fmtNum(active))}
      </div>`;
  }

  function _renderSpeedChart(wrap) {
    const pts = _speedHist;
    const now = Date.now();
    const max = _niceMax(Math.max(0, ...pts.map(p => Math.max(p.dl, p.ul))));
    const x = t => Math.max(0, (t - (now - _SPEED_WINDOW)) / _SPEED_WINDOW * 600);
    const y = v => 140 - Math.min(1, v / max) * 138;
    const path = k => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const enough = pts.length >= 2;
    wrap.querySelector('#qb-speed-dl').setAttribute('d', enough ? path('dl') : '');
    wrap.querySelector('#qb-speed-ul').setAttribute('d', enough ? path('ul') : '');
    wrap.querySelector('#qb-speed-wait').style.display = enough ? 'none' : '';
    wrap.querySelector('#qb-speed-max').textContent = _sz(max) + '/s';
    wrap.querySelector('#qb-speed-mid').textContent = _sz(max / 2) + '/s';
    const last = pts[pts.length - 1];
    wrap.querySelector('#qb-speed-now').textContent = last ? `↓ ${_fmtSpeed(last.dl)}   ↑ ${_fmtSpeed(last.ul)}` : '';
  }

  function _renderDaily(wrap) {
    const el = wrap.querySelector('#qb-st-daily');
    const deltas = _dailyDeltas();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = _localDay(d);
      days.push({ key, date: d, v: deltas.get(key) });
    }
    const tot = days.reduce((a, d) => ({ dl: a.dl + (d.v?.dl || 0), ul: a.ul + (d.v?.ul || 0) }), { dl: 0, ul: 0 });
    const max = Math.max(1, ...days.map(d => Math.max(d.v?.dl || 0, d.v?.ul || 0)));
    const h = v => v > 0 ? Math.max(2, v / max * 100) : 0;
    const fmtDay = d => d.toLocaleDateString(window.mvmOS?.lang || 'en', { day: 'numeric', month: 'short' });
    const hasAny = days.some(d => d.v);
    el.innerHTML = `
      <div class="qb-card-title">${_qbt('st_daily')}</div>
      ${_legend(hasAny ? `<span class="qb-legend-now">${_qbt('st_daily_total', { dl: _sz(tot.dl), ul: _sz(tot.ul) })}</span>` : '')}
      ${hasAny ? `
        <div class="qb-bars">
          ${days.map(d => `
            <div class="qb-bar-group" data-tip="${_esc(fmtDay(d.date) + '\n' + (d.v ? `↓ ${_sz(d.v.dl)}\n↑ ${_sz(d.v.ul)}` : _qbt('st_no_data')))}">
              <div class="qb-bar qb-bar-dl" style="height:${h(d.v?.dl)}%"></div>
              <div class="qb-bar qb-bar-ul" style="height:${h(d.v?.ul)}%"></div>
            </div>`).join('')}
        </div>
        <div class="qb-axis-x"><span>${_esc(fmtDay(days[0].date))}</span><span>${_esc(fmtDay(days[29].date))}</span></div>
      ` : `<div class="qb-stats-empty">${_qbt('st_daily_empty')}</div>`}
      <div class="qb-note">${_qbt('st_daily_note')}</div>`;
  }

  function _renderStates(wrap) {
    const el = wrap.querySelector('#qb-st-states');
    const order = ['downloading', 'seeding', 'stalled', 'paused', 'queued', 'checking', 'error', 'other'];
    const labels = {
      downloading: _qbt('downloading'), seeding: _qbt('seeding'), stalled: _qbt('state_stalled'),
      paused: _qbt('paused'), queued: _qbt('state_queued'), checking: _qbt('state_checking'),
      error: _qbt('error'), other: _qbt('st_other'),
    };
    const counts = {};
    _torrents.forEach(t => { const g = _stateGroup(t.state); counts[g] = (counts[g] || 0) + 1; });
    const rows = order.filter(k => counts[k]);
    const max = Math.max(1, ...rows.map(k => counts[k]));
    el.innerHTML = `
      <div class="qb-card-title">${_qbt('st_states')}</div>
      ${rows.length ? rows.map(k => `
        <div class="qb-hrow">
          <span class="qb-hrow-label">${labels[k]}</span>
          <span class="qb-hrow-track"><span class="qb-hrow-fill" style="width:${counts[k] / max * 100}%"></span></span>
          <span class="qb-hrow-val">${_fmtNum(counts[k])}</span>
        </div>`).join('') : `<div class="qb-stats-empty">${_qbt('no_torrents')}</div>`}`;
  }

  function _renderAdded(wrap, lang) {
    const el = wrap.querySelector('#qb-st-added');
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), date: d, n: 0, size: 0 });
    }
    _torrents.forEach(t => {
      if (!t.added_on) return;
      const d = new Date(t.added_on * 1000);
      const b = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
      if (b) { b.n++; b.size += t.size || 0; }
    });
    const max = Math.max(1, ...months.map(b => b.n));
    el.innerHTML = `
      <div class="qb-card-title">${_qbt('st_added')}</div>
      <div class="qb-bars qb-bars-months">
        ${months.map(b => `
          <div class="qb-bar-group" data-tip="${_esc(b.date.toLocaleDateString(lang, { month: 'long', year: 'numeric' }) + '\n' + _qbt('st_added_tip', { n: _fmtNum(b.n), size: _sz(b.size) }))}">
            <div class="qb-bar qb-bar-acc" style="height:${b.n ? Math.max(2, b.n / max * 100) : 0}%"></div>
          </div>`).join('')}
      </div>
      <div class="qb-axis-months">${months.map(b => `<span>${_esc(b.date.toLocaleDateString(lang, { month: 'narrow' }))}</span>`).join('')}</div>`;
  }

  function _renderGroup(el, title, head, groups, emptyLabel) {
    if (groups.length > 8) {
      const rest = groups.slice(7).reduce((a, g) => ({ key: null, n: a.n + g.n, size: a.size + g.size, dl: a.dl + g.dl, ul: a.ul + g.ul }), { key: null, n: 0, size: 0, dl: 0, ul: 0 });
      groups = [...groups.slice(0, 7), rest];
    }
    const max = Math.max(1, ...groups.map(g => Math.max(g.dl, g.ul)));
    const label = g => g.key === null ? _qbt('st_other') : (g.key ? _esc(g.key) : `<span class="qb-dim">${emptyLabel}</span>`);
    el.innerHTML = `
      <div class="qb-card-title">${title}</div>
      ${groups.length ? `
        <div class="qb-table-wrap"><table class="qb-table">
          <thead><tr>
            <th>${head}</th><th class="num">${_qbt('st_torrents')}</th><th class="num">${_qbt('size')}</th>
            <th>↓ ${_qbt('st_downloaded')}</th><th>↑ ${_qbt('st_uploaded')}</th><th class="num">${_qbt('ratio')}</th>
          </tr></thead>
          <tbody>${groups.map(g => `
            <tr>
              <td class="qb-td-name">${label(g)}</td>
              <td class="num">${_fmtNum(g.n)}</td>
              <td class="num">${_sz(g.size)}</td>
              <td><div class="qb-cell-bar"><span>${_sz(g.dl)}</span><i class="qb-bar-dl" style="width:${g.dl / max * 100}%"></i></div></td>
              <td><div class="qb-cell-bar"><span>${_sz(g.ul)}</span><i class="qb-bar-ul" style="width:${g.ul / max * 100}%"></i></div></td>
              <td class="num">${_ratioOf(g.ul, g.dl)}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>` : `<div class="qb-stats-empty">${_qbt('no_torrents')}</div>`}`;
  }

  function _renderTopLists(wrap) {
    const top = _torrents.filter(t => t.uploaded > 0).sort((a, b) => b.uploaded - a.uploaded).slice(0, 8);
    const seed = _torrents.filter(t => t.progress >= 1 && t.ratio >= 0 && t.ratio < 1).sort((a, b) => a.ratio - b.ratio).slice(0, 8);
    const row = (t, val, sub) => `
      <div class="qb-top-row" data-hash="${_esc(t.hash)}" title="${_esc(t.name)}">
        <span class="qb-top-name">${_esc(t.name)}</span>
        <span class="qb-top-sub">${sub}</span>
        <span class="qb-top-val">${val}</span>
      </div>`;
    wrap.querySelector('#qb-st-top').innerHTML = `
      <div class="qb-card-title">${_qbt('st_top_up')}</div>
      ${top.length ? top.map(t => row(t, '↑ ' + _sz(t.uploaded), '⇅ ' + _fmtRatio(t.ratio))).join('') : `<div class="qb-stats-empty">${_qbt('st_no_data')}</div>`}`;
    wrap.querySelector('#qb-st-seed').innerHTML = `
      <div class="qb-card-title">${_qbt('st_needs_seed')}</div>
      ${seed.length ? seed.map(t => row(t, '⇅ ' + _fmtRatio(t.ratio), _qbt('st_seeded_for', { t: _fmtDuration(t.seeding_time) }))).join('') : `<div class="qb-stats-empty">${_torrents.length ? _qbt('st_all_seeded') : _qbt('no_torrents')}</div>`}`;
  }

  function _bindStatsHover(mainArea) {
    const tip = mainArea.querySelector('#qb-tip');
    const show = (text, e) => {
      const r = mainArea.getBoundingClientRect();
      tip.textContent = text;
      tip.style.display = 'block';
      const tx = Math.min(e.clientX - r.left + 12, r.width - tip.offsetWidth - 6);
      const ty = e.clientY - r.top - tip.offsetHeight - 10;
      tip.style.left = Math.max(6, tx) + 'px';
      tip.style.top = (ty < 4 ? e.clientY - r.top + 16 : ty) + 'px';
    };
    const hide = () => { tip.style.display = 'none'; };
    const stats = mainArea.querySelector('#qb-stats');
    stats.addEventListener('mousemove', e => {
      const el = e.target.closest('[data-tip]');
      if (el) show(el.dataset.tip, e);
      else if (!e.target.closest('#qb-speed-plot')) hide();
    });
    stats.addEventListener('mouseleave', hide);
    stats.addEventListener('scroll', hide);
    stats.addEventListener('click', e => {
      const row = e.target.closest('.qb-top-row');
      if (!row) return;
      _view = 'list';
      _filter = 'all';
      _selected = row.dataset.hash;
      _detailTab = 'info';
      _renderAll();
    });

    const plot = mainArea.querySelector('#qb-speed-plot');
    const cross = mainArea.querySelector('#qb-speed-cross');
    plot.addEventListener('mousemove', e => {
      if (_speedHist.length < 2) return;
      const r = plot.getBoundingClientRect();
      const now = Date.now();
      const at = now - _SPEED_WINDOW * (1 - (e.clientX - r.left) / r.width);
      const p = _speedHist.reduce((b, q) => Math.abs(q.t - at) < Math.abs(b.t - at) ? q : b);
      cross.style.display = 'block';
      cross.style.left = Math.max(0, (p.t - (now - _SPEED_WINDOW)) / _SPEED_WINDOW * 100) + '%';
      show(`${new Date(p.t).toLocaleTimeString(window.mvmOS?.lang || 'en')}\n↓ ${_fmtSpeed(p.dl)}\n↑ ${_fmtSpeed(p.ul)}`, e);
    });
    plot.addEventListener('mouseleave', () => { cross.style.display = 'none'; hide(); });
  }

  function _renderStatusBar(root) {
    const bar = root.querySelector('#qb-statusbar');
    if (!bar) return;
    const dl = _torrents.reduce((s, t) => s + (t.dlspeed || 0), 0);
    const ul = _torrents.reduce((s, t) => s + (t.upspeed || 0), 0);
    bar.innerHTML = `
      <span>${_qbt('torrents_count', { n: _torrents.length })}</span>
      <span>${_qbt('total_dl')} ${_fmtSpeed(dl)}</span>
      <span>${_qbt('total_ul')} ${_fmtSpeed(ul)}</span>
      <span style="margin-left:auto;color:${_connected ? 'var(--text-dim)' : '#ff5555'}">● ${_connected ? _qbt('connected') : _qbt('disconnected')}</span>
    `;
  }

  function _bindToolbar(root) {
    root.querySelector('#qb-add')?.addEventListener('click', () => _showAddDialog(root));
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
        <div style="display:flex;gap:6px">
          <input id="qb-add-path" type="text" placeholder="~/Downloads" value="${savedPath}" style="flex:1">
          <button id="qb-browse-path" type="button" style="padding:0 10px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;font-size:.85rem;white-space:nowrap">📁 ${_qbt('browse')}</button>
        </div>
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
    ov.style.position = 'fixed';
    ov.style.zIndex = '99990';
    document.body.appendChild(ov);
    ov.querySelector('#qb-add-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#qb-browse-path').addEventListener('click', () => {
      const pathInput = ov.querySelector('#qb-add-path');
      fetch('/api/files').then(r => r.json()).then(d => {
        FolderPicker.open({
          root: d.home || '/',
          onSelect: (path) => { pathInput.value = path; },
        });
      }).catch(() => {
        FolderPicker.open({
          root: '/',
          asRoot: true,
          onSelect: (path) => { pathInput.value = path; },
        });
      });
    });
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

  // ── IPT Search history (localStorage) ──
  const _IPT_HISTORY_KEY = 'ipt_search_history';
  function _iptHistoryLoad() {
    try { return JSON.parse(localStorage.getItem(_IPT_HISTORY_KEY) || '[]'); } catch(_) { return []; }
  }
  function _iptHistorySave(entry) {
    let h = _iptHistoryLoad();
    // remove duplicate query
    h = h.filter(e => e.query !== entry.query || e.desc_filter !== entry.desc_filter);
    h.unshift(entry);
    if (h.length > 20) h = h.slice(0, 20);
    localStorage.setItem(_IPT_HISTORY_KEY, JSON.stringify(h));
  }
  function _iptHistoryDelete(idx) {
    const h = _iptHistoryLoad();
    h.splice(idx, 1);
    localStorage.setItem(_IPT_HISTORY_KEY, JSON.stringify(h));
  }

  function _openIptSearch() {
    mvmOS.createWindow({
      id: 'ipt-search',
      title: '🔍 ' + _qbt('ipt_title'),
      width: 860,
      height: 580,
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.innerHTML = `
          <div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px;flex-shrink:0">
            <div style="display:flex;gap:8px">
              <input id="ipt-q" type="text" placeholder="${_qbt('ipt_q_ph')}" class="s-input" style="flex:1">
              <input id="ipt-filter" type="text" placeholder="${_qbt('ipt_filter_ph')}" class="s-input" style="width:200px">
              <button id="ipt-search-btn" class="s-btn" style="background:var(--accent);color:#fff;padding:0 16px">${_qbt('ipt_search')}</button>
            </div>
            <div id="ipt-local-filter-row" style="display:none;align-items:center;gap:8px">
              <input id="ipt-local-filter" type="text" placeholder="${_qbt('ipt_local_ph')}" class="s-input" style="flex:1">
              <div id="ipt-status" style="font-size:.75rem;color:var(--text-dim);text-align:right;min-width:180px"></div>
            </div>
            <div id="ipt-status-main" style="font-size:.75rem;color:var(--text-dim);min-height:16px"></div>
          </div>
          <div style="flex:1;overflow:hidden;display:flex">
            <div id="ipt-history-panel" style="width:200px;border-right:1px solid var(--border);overflow-y:auto;flex-shrink:0"></div>
            <div id="ipt-results" style="flex:1;overflow-y:auto;padding:4px 0"></div>
          </div>
        `;

        const qInput = body.querySelector('#ipt-q');
        const filterInput = body.querySelector('#ipt-filter');
        const localFilter = body.querySelector('#ipt-local-filter');
        const localFilterRow = body.querySelector('#ipt-local-filter-row');
        const searchBtn = body.querySelector('#ipt-search-btn');
        const status = body.querySelector('#ipt-status');
        const statusMain = body.querySelector('#ipt-status-main');
        const results = body.querySelector('#ipt-results');
        const histPanel = body.querySelector('#ipt-history-panel');

        let _currentList = [];  // full cached result list for local filtering
        // per-torrent cached descriptions: id → text
        const _descCache = {};

        function _renderHistory() {
          const h = _iptHistoryLoad();
          if (!h.length) {
            histPanel.innerHTML = `<div style="padding:10px;font-size:.74rem;color:var(--text-dim)">${_qbt('ipt_no_history')}</div>`;
            return;
          }
          histPanel.innerHTML = `<div style="padding:6px 10px 4px;font-size:.7rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${_qbt('ipt_history')}</div>` +
            h.map((e, i) => `
              <div class="ipt-hist-item" data-idx="${i}" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border);position:relative">
                <div style="font-size:.78rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:16px" title="${e.query}">${e.query}</div>
                ${e.desc_filter ? `<div style="font-size:.68rem;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">🔎 ${e.desc_filter}</div>` : ''}
                <div style="font-size:.66rem;color:var(--text-dim)">${_qbt('ipt_results', { n: e.results.length })}</div>
                <button class="ipt-hist-del" data-idx="${i}" style="position:absolute;top:4px;right:4px;background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:.7rem;padding:2px 4px" onclick="event.stopPropagation()">✕</button>
              </div>
            `).join('');

          histPanel.querySelectorAll('.ipt-hist-item').forEach(el => {
            el.addEventListener('click', () => {
              const entry = _iptHistoryLoad()[+el.dataset.idx];
              if (!entry) return;
              qInput.value = entry.query;
              filterInput.value = entry.desc_filter || '';
              localFilter.value = '';
              _loadResults(entry.results, entry.query, entry.desc_filter, true);
            });
            el.addEventListener('mouseenter', () => el.style.background = 'var(--surface2)');
            el.addEventListener('mouseleave', () => el.style.background = '');
          });
          histPanel.querySelectorAll('.ipt-hist-del').forEach(btn => {
            btn.addEventListener('click', () => {
              _iptHistoryDelete(+btn.dataset.idx);
              _renderHistory();
            });
          });
        }

        function _renderRows(list, localQ) {
          const q = (localQ || '').toLowerCase();
          const visible = q ? list.filter(t => {
            if (t.title.toLowerCase().includes(q)) return true;
            const desc = _descCache[t.id] || t.description_snippet || '';
            return desc.toLowerCase().includes(q);
          }) : list;

          const statusEl = localFilterRow.style.display !== 'none' ? status : statusMain;
          statusEl.textContent = q
            ? _qbt('ipt_results_of', { n: visible.length, total: list.length })
            : _qbt('ipt_results', { n: list.length });

          if (!visible.length) {
            results.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim)">${q ? _qbt('ipt_no_matches') : _qbt('ipt_no_results')}</div>`;
            return;
          }

          visible.forEach(t => { if (t.description_snippet && !_descCache[t.id]) _descCache[t.id] = t.description_snippet; });
          results.innerHTML = visible.map(t => `
            <div class="ipt-row" data-id="${t.id}" style="border-bottom:1px solid var(--border)">
              <div class="ipt-row-head" style="display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer">
                <div style="flex:1;overflow:hidden">
                  <div style="font-size:.84rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${t.title}">${t.title}</div>
                  <div style="font-size:.71rem;color:var(--text-dim);margin-top:1px">
                    ${t.category ? `<span style="margin-right:8px">${t.category}</span>` : ''}
                    ${t.size ? `<span style="margin-right:8px">📦 ${t.size}</span>` : ''}
                    ${t.seeds ? `<span style="margin-right:6px;color:#50fa7b">↑${t.seeds}</span>` : ''}
                    ${t.peers ? `<span style="color:#ff79c6">↓${t.peers}</span>` : ''}
                    ${t.subtitle ? `<span style="margin-left:8px">${t.subtitle}</span>` : ''}
                  </div>
                </div>
                <div style="display:flex;gap:5px;flex-shrink:0">
                  <a href="https://iptorrents.com${t.link}" target="_blank" class="s-btn s-btn-sm" title="${_qbt('ipt_open')}" onclick="event.stopPropagation()">🔗</a>
                  ${t.download ? `<button class="s-btn s-btn-sm ipt-add-btn" data-download="${t.download}" style="background:var(--accent);color:#fff" onclick="event.stopPropagation()">⬇ ${_qbt('add_btn')}</button>` : ''}
                </div>
              </div>
            </div>
          `).join('');

          results.querySelectorAll('.ipt-row-head').forEach(head => {
            head.addEventListener('click', async () => {
              const row = head.closest('.ipt-row');
              const tid = row.dataset.id;
              const title = row.querySelector('[title]')?.getAttribute('title') || '';

              // Show modal overlay on document.body — no overflow constraints
              const existing = document.getElementById('ipt-desc-modal');
              if (existing) existing.remove();

              const modal = document.createElement('div');
              modal.id = 'ipt-desc-modal';
              modal.style.cssText = 'position:fixed;inset:0;z-index:99991;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center';
              modal.innerHTML = `
                <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,8px);width:min(640px,90vw);max-height:80vh;display:flex;flex-direction:column;box-shadow:var(--shadow)">
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
                    <div style="font-size:.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:10px">${title}</div>
                    <button id="ipt-desc-close" style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:1rem;padding:0 4px">✕</button>
                  </div>
                  <div id="ipt-desc-content" style="padding:14px 16px;overflow-y:auto;font-size:.8rem;color:var(--text-dim);white-space:pre-wrap;line-height:1.6">⏳ ${_qbt('ipt_loading')}</div>
                </div>
              `;
              document.body.appendChild(modal);
              modal.querySelector('#ipt-desc-close').addEventListener('click', () => modal.remove());
              modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

              const content = modal.querySelector('#ipt-desc-content');
              if (_descCache[tid]) {
                content.textContent = _descCache[tid];
              } else {
                try {
                  const r = await fetch('/api/qbit/ipt-desc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uid: _cfg.ipt_uid||'', pass: _cfg.ipt_pass||'', togtem: _cfg.ipt_togtem||'', id: tid }),
                  });
                  const d = await r.json();
                  const text = d.description || _qbt('ipt_no_desc');
                  _descCache[tid] = text;
                  content.textContent = text;
                } catch(e) { content.textContent = '❌ ' + e.message; }
              }
            });
          });

          results.querySelectorAll('.ipt-add-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
              btn.disabled = true; btn.textContent = '…';
              let torrentBlob = null;
              let torrentFilename = '';
              try {
                const res = await fetch('/api/qbit/ipt-download', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    uid: _cfg.ipt_uid || '', pass: _cfg.ipt_pass || '',
                    togtem: _cfg.ipt_togtem || '', download_path: btn.dataset.download,
                  }),
                });
                if (!res.ok) throw new Error(_qbt('ipt_dl_failed', { status: res.status }));
                torrentBlob = await res.blob();
                torrentFilename = btn.dataset.download.split('/').pop();
              } catch(e) {
                btn.textContent = '❌'; btn.title = e.message; btn.disabled = false; return;
              }

              // Show Add dialog without magnet/file inputs — just filename + save path + category
              const savedPath = _cfg.saved_dl_path || '';
              const rememberChecked = !!_cfg.remember_dl_path;
              const ov = document.createElement('div');
              ov.className = 'qb-dialog-overlay';
              ov.style.cssText = 'position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
              ov.innerHTML = `
                <div class="qb-dialog">
                  <h3>${_qbt('add')}</h3>
                  <label style="color:var(--text-dim);font-size:.78rem">${_qbt('file_lbl')}</label>
                  <div style="padding:6px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;font-size:.8rem;color:var(--text-dim);word-break:break-all">${torrentFilename}</div>
                  <label>${_qbt('save_path_label')}</label>
                  <div style="display:flex;gap:6px">
                    <input id="ipt-add-path" type="text" placeholder="~/Downloads" value="${savedPath}" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text);font-size:.82rem">
                    <button id="ipt-browse-path" type="button" style="padding:0 10px;background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer;font-size:.85rem;white-space:nowrap">📁 ${_qbt('browse')}</button>
                  </div>
                  <label style="display:flex;align-items:center;gap:6px;font-size:.8rem;color:var(--text-dim);cursor:pointer">
                    <input type="checkbox" id="ipt-remember-path" ${rememberChecked ? 'checked' : ''}>
                    ${_qbt('remember_path')}
                  </label>
                  <label>${_qbt('category_label')}</label>
                  <input id="ipt-add-cat" type="text" placeholder="" style="background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text);font-size:.82rem;width:100%;box-sizing:border-box">
                  <div class="qb-dialog-btns">
                    <button id="ipt-add-cancel">${_qbt('cancel')}</button>
                    <button id="ipt-add-ok" class="primary">${_qbt('add_btn')}</button>
                  </div>
                </div>
              `;
              document.body.appendChild(ov);

              ov.querySelector('#ipt-add-cancel').addEventListener('click', () => { ov.remove(); btn.textContent = '⬇ ' + _qbt('add_btn'); btn.disabled = false; });
              ov.querySelector('#ipt-browse-path').addEventListener('click', () => {
                const pathInput = ov.querySelector('#ipt-add-path');
                fetch('/api/files').then(r => r.json()).then(d => {
                  FolderPicker.open({ root: d.home || '/', onSelect: p => { pathInput.value = p; } });
                });
              });

              ov.querySelector('#ipt-add-ok').addEventListener('click', async () => {
                const savepath = ov.querySelector('#ipt-add-path').value.trim();
                const category = ov.querySelector('#ipt-add-cat').value.trim();
                const remember = ov.querySelector('#ipt-remember-path').checked;
                if (remember && savepath) { _cfg.saved_dl_path = savepath; _cfg.remember_dl_path = true; _saveCfg(); }

                const okBtn = ov.querySelector('#ipt-add-ok');
                okBtn.disabled = true; okBtn.textContent = '…';
                try {
                  const fd = new FormData();
                  fd.append('host', _cfg.host); fd.append('port', String(_cfg.port));
                  fd.append('username', _cfg.username); fd.append('password', _cfg.password);
                  if (savepath) fd.append('savepath', savepath);
                  if (category) fd.append('category', category);
                  fd.append('torrents', new File([torrentBlob], torrentFilename, { type: 'application/x-bittorrent' }));
                  const r = await fetch('/api/qbit/upload', { method: 'POST', body: fd });
                  const d = await r.json();
                  if (d.error) throw new Error(d.error);
                  ov.remove();
                  btn.textContent = '✓'; btn.style.background = '#50fa7b'; btn.style.color = '#000';
                } catch(e) { okBtn.textContent = _qbt('add_btn'); okBtn.disabled = false; mvmOS.notify(_qbt('error'), e.message); }
              });
            });
          });
        }

        function _loadResults(list, query, descFilter, fromCache) {
          _currentList = list;
          localFilter.value = '';
          if (fromCache) {
            localFilterRow.style.display = 'flex';
            statusMain.style.display = 'none';
            status.textContent = '📂 ' + _qbt('ipt_cached', { n: list.length });
          } else {
            localFilterRow.style.display = 'none';
            statusMain.style.display = '';
            const label = descFilter
              ? _qbt('ipt_found_desc', { n: list.length, q: descFilter })
              : _qbt('ipt_found', { n: list.length });
            statusMain.textContent = label;
            status.textContent = label;
          }
          _renderRows(list, '');
        }

        async function doSearch() {
          const q = qInput.value.trim();
          if (!q) return;
          searchBtn.disabled = true;
          localFilter.value = '';
          localFilterRow.style.display = 'none';
          statusMain.style.display = '';
          const descF = filterInput.value.trim();
          statusMain.textContent = descF ? _qbt('ipt_scanning') : _qbt('ipt_searching');
          results.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim)">⏳ ${_qbt('ipt_loading')}</div>`;
          try {
            const res = await fetch('/api/qbit/ipt-search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uid: _cfg.ipt_uid||'', pass: _cfg.ipt_pass||'', togtem: _cfg.ipt_togtem||'', query: q, desc_filter: descF }),
            });
            const data = await res.json();
            if (data.error) { statusMain.textContent = '❌ ' + data.error; results.innerHTML = ''; return; }
            const list = data.results || [];
            _iptHistorySave({ query: q, desc_filter: descF, results: list, ts: Date.now() });
            _renderHistory();
            _loadResults(list, q, descF, false);
          } catch(e) {
            statusMain.textContent = '❌ ' + e.message;
            results.innerHTML = '';
          } finally {
            searchBtn.disabled = false;
          }
        }

        // Local filter — debounced
        let _localFilterTimer = null;
        localFilter.addEventListener('input', () => {
          clearTimeout(_localFilterTimer);
          _localFilterTimer = setTimeout(() => _renderRows(_currentList, localFilter.value), 200);
        });

        searchBtn.addEventListener('click', doSearch);
        qInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
        filterInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

        _renderHistory();
        qInput.focus();
      },
    });
  }

  return { mount };
})();
