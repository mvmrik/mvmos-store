// Git Manager — Repo detail view
/* global window */
var GM = window.GM;
var t = window.t || function(k) { return k; };

GM.repoView = (function() {

  var _current = null;
  var _tab = 'status'; // 'status' | 'log'

  function show(container, repo) {
    _current = repo;
    _tab = 'status';
    _render(container, repo);
    _loadStatus(container, repo);
  }

  function _render(container, repo) {
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${repo.name}</div>
          <div style="font-size:.72rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px" id="gm-remote-label">${repo.remote || ''}</div>
        </div>
        <span id="gm-branch-badge" style="font-size:.75rem;background:var(--surface2,#313244);border-radius:12px;padding:2px 9px;white-space:nowrap;flex-shrink:0">🌿 ${repo.branch}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0">
        <button id="gm-pull" class="s-btn s-btn-sm">⬇ ${t('gm_pull')}</button>
        <button id="gm-push" class="s-btn s-btn-sm">⬆ ${t('gm_push')}</button>
        <button id="gm-fetch" class="s-btn s-btn-sm">⟳ ${t('gm_fetch')}</button>
        <div id="gm-sync-info" style="font-size:.75rem;color:var(--text-dim);margin-left:4px"></div>
        <div style="flex:1"></div>
        <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <button id="gm-tab-status" style="border:none;padding:3px 10px;cursor:pointer;font-size:.78rem;background:var(--accent);color:#fff">${t('gm_status')}</button>
          <button id="gm-tab-log" style="border:none;padding:3px 10px;cursor:pointer;font-size:.78rem;background:none;color:var(--text-dim)">${t('gm_log')}</button>
        </div>
      </div>
      <div id="gm-tab-content" style="flex:1;overflow-y:auto;padding:12px 14px"></div>
      <div id="gm-action-output" style="display:none;padding:8px 14px;font-size:.78rem;font-family:monospace;background:var(--surface);border-top:1px solid var(--border);max-height:100px;overflow-y:auto;white-space:pre-wrap"></div>
    `;
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    container.querySelector('#gm-pull').addEventListener('click', () => _doAction(container, repo, 'pull'));
    container.querySelector('#gm-push').addEventListener('click', () => _doAction(container, repo, 'push'));
    container.querySelector('#gm-fetch').addEventListener('click', () => _doAction(container, repo, 'fetch'));
    container.querySelector('#gm-tab-status').addEventListener('click', () => _switchTab(container, repo, 'status'));
    container.querySelector('#gm-tab-log').addEventListener('click', () => _switchTab(container, repo, 'log'));
  }

  function _switchTab(container, repo, tab) {
    _tab = tab;
    const sBtn = container.querySelector('#gm-tab-status');
    const lBtn = container.querySelector('#gm-tab-log');
    sBtn.style.background = tab === 'status' ? 'var(--accent)' : 'none';
    sBtn.style.color = tab === 'status' ? '#fff' : 'var(--text-dim)';
    lBtn.style.background = tab === 'log' ? 'var(--accent)' : 'none';
    lBtn.style.color = tab === 'log' ? '#fff' : 'var(--text-dim)';
    if (tab === 'status') _loadStatus(container, repo);
    else _loadLog(container, repo);
  }

  async function _loadStatus(container, repo) {
    const tc = container.querySelector('#gm-tab-content');
    if (!tc) return;
    tc.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">${t('gm_loading')}</div>`;
    try {
      const s = await GM.api('/repo/status?path=' + encodeURIComponent(repo.path));

      const syncInfo = container.querySelector('#gm-sync-info');
      if (syncInfo) {
        const parts = [];
        if (s.ahead > 0) parts.push(`↑ ${t('gm_ahead', { n: s.ahead })}`);
        if (s.behind > 0) parts.push(`↓ ${t('gm_behind', { n: s.behind })}`);
        syncInfo.textContent = parts.join('  ');
        syncInfo.style.color = s.behind > 0 ? '#f38ba8' : 'var(--text-dim)';
      }

      if (!s.files.length) {
        tc.innerHTML = `
          <div style="color:var(--text-dim);font-size:.82rem;opacity:.7;padding:20px 0;text-align:center">${t('gm_nothing_to_commit')}</div>
          ${_commitArea(repo, true)}
        `;
      } else {
        tc.innerHTML = `
          <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:8px">${t('gm_changed_files', { n: s.files.length, s: s.files.length !== 1 ? 's' : '' })}</div>
          <div id="gm-file-list" style="display:flex;flex-direction:column;gap:2px;margin-bottom:14px"></div>
          ${_commitArea(repo, false)}
        `;
        const fl = tc.querySelector('#gm-file-list');
        s.files.forEach(function(f) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:4px;font-size:.8rem;font-family:monospace';
          const code = f.code.trim();
          const color = code === 'M' || code === 'MM' ? '#fab387'
            : code === '??' ? 'var(--text-dim)'
            : code === 'A' ? '#a6e3a1'
            : code === 'D' ? '#f38ba8' : 'var(--text)';
          row.innerHTML = `<span style="color:${color};width:20px;flex-shrink:0">${f.code}</span><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.file}</span>`;
          fl.appendChild(row);
        });
      }

      // Commit area events
      const commitBtn = tc.querySelector('#gm-commit-btn');
      const msgInput = tc.querySelector('#gm-commit-msg');
      if (commitBtn && msgInput) {
        commitBtn.addEventListener('click', () => _doCommit(container, repo, msgInput));
        msgInput.addEventListener('keydown', function(e) {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') _doCommit(container, repo, msgInput);
        });
      }
    } catch(e) {
      tc.innerHTML = `<div style="color:#f38ba8;font-size:.82rem">${e.message}</div>`;
    }
  }

  function _commitArea(repo, clean) {
    return `
      <div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px">
        <div style="font-size:.75rem;color:var(--text-dim)">${t('gm_commit_message')} <span style="opacity:.6">${t('gm_ctrl_enter')}</span></div>
        <textarea id="gm-commit-msg" class="s-input" rows="4" placeholder="${t('gm_describe_changes')}" style="resize:vertical;flex:none;max-width:none;min-height:80px;font-family:inherit;font-size:.83rem;width:100%;box-sizing:border-box"></textarea>
        <div>
          <button id="gm-commit-btn" class="s-btn s-btn-sm" ${clean ? 'disabled' : ''} style="${clean ? '' : 'background:var(--accent);color:#fff;border-color:var(--accent)'}">
            ✓ ${t('gm_commit_all')}
          </button>
        </div>
      </div>
    `;
  }

  async function _loadLog(container, repo) {
    const tc = container.querySelector('#gm-tab-content');
    if (!tc) return;
    tc.innerHTML = `<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">${t('gm_loading')}</div>`;
    try {
      const entries = await GM.api('/repo/log?path=' + encodeURIComponent(repo.path));
      if (!entries.length) {
        tc.innerHTML = `<div style="color:var(--text-dim);font-size:.82rem;opacity:.7;padding:20px 0;text-align:center">${t('gm_no_commits')}</div>`;
        return;
      }
      tc.innerHTML = '';
      entries.forEach(function(e) {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:52px 1fr 90px 100px;gap:8px;align-items:baseline;padding:5px 4px;border-bottom:1px solid var(--border);font-size:.79rem';
        row.innerHTML = `
          <span style="font-family:monospace;color:var(--accent);opacity:.8">${e.hash}</span>
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.message}</span>
          <span style="color:var(--text-dim);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.author}</span>
          <span style="color:var(--text-dim);font-size:.72rem;text-align:right;white-space:nowrap">${e.date}</span>
        `;
        tc.appendChild(row);
      });
    } catch(e) {
      tc.innerHTML = `<div style="color:#f38ba8;font-size:.82rem">${e.message}</div>`;
    }
  }

  const _ACTION_ING_KEYS = { pull: 'gm_pulling', push: 'gm_pushing', fetch: 'gm_fetching' };

  async function _doAction(container, repo, action) {
    const btn = container.querySelector('#gm-' + action);
    const out = container.querySelector('#gm-action-output');
    if (!btn || !out) return;
    btn.disabled = true;
    btn.style.opacity = '.5';
    out.style.display = 'block';
    out.style.color = 'var(--text-dim)';
    out.textContent = t(_ACTION_ING_KEYS[action] || action);
    try {
      const r = await GM.api('/repo/' + action, { method: 'POST', json: { path: repo.path } });
      out.textContent = r.output || t('gm_done');
      out.style.color = '#a6e3a1';
      if (action === 'pull' || action === 'fetch' || action === 'push') {
        _loadStatus(container, repo);
        GM.loadRepos();
      }
    } catch(e) {
      out.textContent = e.message;
      out.style.color = '#f38ba8';
    } finally {
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  async function _doCommit(container, repo, msgInput) {
    const msg = msgInput.value.trim();
    if (!msg) { msgInput.focus(); return; }
    const btn = container.querySelector('#gm-commit-btn');
    const out = container.querySelector('#gm-action-output');
    btn.disabled = true;
    if (out) { out.style.display = 'block'; out.textContent = t('gm_committing'); out.style.color = 'var(--text-dim)'; }
    try {
      const r = await GM.api('/repo/commit', { method: 'POST', json: { path: repo.path, message: msg } });
      msgInput.value = '';
      if (out) { out.textContent = r.output; out.style.color = '#a6e3a1'; }
      _loadStatus(container, repo);
      GM.loadRepos();
    } catch(e) {
      if (out) { out.textContent = e.message; out.style.color = '#f38ba8'; }
      btn.disabled = false;
    }
  }

  return { show };
})();
