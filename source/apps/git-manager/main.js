// Git Manager for mvmOS v1.0.0

(function() {

var t = window.t || function(k) { return k; };

var GM = {
  state: { repos: [], activeRepo: null, currentUser: '' },
  body: null,
  listEl: null,
  contentEl: null,
};

// ── API helper ────────────────────────────────────────────────────────────────

GM.api = async function(path, opts) {
  opts = opts || {};
  var res = await fetch('/api/apps/git-manager' + path, {
    method: opts.method || 'GET',
    headers: opts.json != null ? { 'Content-Type': 'application/json' } : {},
    body: opts.json != null ? JSON.stringify(opts.json) : undefined,
  });
  var data = await res.json().catch(function() { return {}; });
  if (!res.ok) throw new Error(data.detail || t('gm_error_status', { status: res.status }));
  return data;
};


// Write API — проверява owner преди заявката, пита requireRoot ако трябва
GM.writeApi = async function(path, json, repo) {
  if (repo && repo.owner && repo.owner !== GM.state.currentUser) {
    var ok = await mvmOS.requireRoot(
      t('gm_title'),
      t('gm_owned_by_msg', { name: repo.name, owner: repo.owner })
    );
    if (!ok) throw new Error('cancelled');
  }
  return await GM.api(path, { method: 'POST', json: json });
};

// ── Init ──────────────────────────────────────────────────────────────────────

GM.init = function(body) {
  GM.body = body;

  // Wrapper div вътре в body — height:100% наследява от window manager-а
  body.innerHTML = '<div id="gm-root" style="display:flex;height:100%;overflow:hidden;font-size:.85rem;position:relative">'
    + '<div id="gm-sidebar" class="as-sidebar" style="width:215px;min-width:180px;display:flex;flex-direction:column;border-right:1px solid var(--border);overflow:hidden;flex-shrink:0;background:var(--surface)">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px 8px 12px;border-bottom:1px solid var(--border);flex-shrink:0">'
        + '<span style="font-size:.72rem;font-weight:600;color:var(--text-dim);letter-spacing:.05em">' + t('gm_repositories') + '</span>'
        + '<button id="gm-refresh" title="' + t('gm_refresh') + '" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:1rem;line-height:1;padding:2px 4px;border-radius:4px">&#x27F3;</button>'
      + '</div>'
      + '<div id="gm-repo-list" style="flex:1;overflow-y:auto"></div>'
      + '<div style="display:flex;gap:6px;padding:8px;border-top:1px solid var(--border);flex-shrink:0">'
        + '<button id="gm-clone-btn" class="s-btn s-btn-sm" style="flex:1">&#x2295; ' + t('gm_clone') + '</button>'
        + '<button id="gm-init-btn" class="s-btn s-btn-sm" style="flex:1">&#x25CE; ' + t('gm_init') + '</button>'
        + '<button id="gm-ssh-btn" class="s-btn s-btn-sm" title="' + t('gm_ssh_keys') + '">&#x1F511;</button>'
      + '</div>'
    + '</div>'
    + '<div id="gm-content" style="flex:1;overflow:hidden;display:flex;flex-direction:column;position:relative;min-width:0">'
      + '<div id="gm-view" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-width:0"></div>'
    + '</div>'
    + '</div>';

  var sidebar = body.querySelector('#gm-sidebar');
  var content = body.querySelector('#gm-content');
  var view = body.querySelector('#gm-view');

  GM.listEl = sidebar.querySelector('#gm-repo-list');
  GM.contentEl = view;

  sidebar.querySelector('#gm-refresh').addEventListener('click', function() { GM.loadRepos(); });
  sidebar.querySelector('#gm-clone-btn').addEventListener('click', function() { GM.showClone(); });
  sidebar.querySelector('#gm-init-btn').addEventListener('click', function() { GM.showInit(); });
  sidebar.querySelector('#gm-ssh-btn').addEventListener('click', function() {
    GM.state.activeRepo = null;
    GM.renderSidebar();
    GM.showSSH(content);
  });

  mvmOS.initMobileSidebar(body);
  GM.showWelcome();
  GM.loadRepos();
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

GM.showWelcome = function() {
  GM.contentEl.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:10px;color:var(--text-dim)">'
    + '<div style="font-size:2.5rem;opacity:.4">&#x1F500;</div>'
    + '<div style="font-size:.85rem;opacity:.5">' + t('gm_select_repo') + '</div>'
    + '</div>';
};

GM.showLoading = function(msg) {
  GM.listEl.innerHTML = '<div style="padding:14px 10px;color:var(--text-dim);font-size:.8rem;text-align:center;opacity:.7">' + (msg || t('gm_scanning')) + '</div>';
};

GM.loadRepos = async function() {
  GM.showLoading(t('gm_scanning'));
  try {
    var _reposData = await GM.api('/repos');
    GM.state.currentUser = _reposData.current_user || '';
    GM.state.repos = _reposData.repos || _reposData;
    GM.renderSidebar();
    if (GM.state.activeRepo) {
      var still = GM.state.repos.filter(function(r) { return r.path === GM.state.activeRepo.path; })[0];
      if (still) GM.showRepoView(GM.contentEl, still);
    }
  } catch(e) {
    GM.listEl.innerHTML = '<div style="padding:14px 10px;color:#f38ba8;font-size:.8rem">' + e.message + '</div>';
  }
};

GM.renderSidebar = function() {
  var list = GM.listEl;
  list.innerHTML = '';
  if (!GM.state.repos.length) {
    list.innerHTML = '<div style="padding:14px 10px;color:var(--text-dim);font-size:.8rem;text-align:center;opacity:.7">' + t('gm_no_repos') + '</div>';
    return;
  }
  GM.state.repos.forEach(function(repo) {
    var active = GM.state.activeRepo && GM.state.activeRepo.path === repo.path;
    var item = document.createElement('div');
    item.style.cssText = 'padding:7px 10px 7px 12px;cursor:pointer;border-bottom:1px solid var(--border);' + (active ? 'background:var(--accent-dim,rgba(99,102,241,.15))' : '');
    item.dataset.gmPath = repo.path;
    item.innerHTML = '<div style="display:flex;align-items:center;gap:5px;pointer-events:none">'
      + '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;font-size:.83rem">' + repo.name + '</span>'
      + (repo.changes > 0 ? '<span style="font-size:.68rem;background:var(--accent);color:#fff;border-radius:10px;padding:1px 5px;flex-shrink:0">' + repo.changes + '</span>' : '')
      + '</div>'
      + '<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;pointer-events:none">&#x1F33F; ' + repo.branch + '</div>';
    list.appendChild(item);
  });

  // Event delegation — един listener на целия list
  list.onclick = function(e) {
    var item = e.target.closest('[data-gm-path]');
    if (!item) return;
    var repo = GM.state.repos.filter(function(r) { return r.path === item.dataset.gmPath; })[0];
    if (!repo) return;
    GM.state.activeRepo = repo;
    GM.renderSidebar();
    GM.showRepoView(GM.contentEl, repo);
  };
};

// ── Clone dialog ──────────────────────────────────────────────────────────────

GM.showClone = function() {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
  overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:380px;display:flex;flex-direction:column;gap:12px">'
    + '<div style="font-weight:600;font-size:.95rem">' + t('gm_clone_repo_title') + '</div>'
    + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_repo_url') + '</div>'
    + '<input class="s-input" id="gm-clone-url" placeholder="git@github.com:user/repo.git" style="width:100%;box-sizing:border-box"></div>'
    + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_dest_dir') + '</div>'
    + '<input class="s-input" id="gm-clone-dest" value="/var/www" style="width:100%;box-sizing:border-box"></div>'
    + '<div id="gm-clone-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    + '<button class="s-btn" id="gm-clone-cancel">' + t('gm_cancel') + '</button>'
    + '<button class="s-btn" id="gm-clone-ok" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_clone') + '</button>'
    + '</div></div>';
  GM.contentEl.appendChild(overlay);
  overlay.querySelector('#gm-clone-url').focus();
  overlay.querySelector('#gm-clone-cancel').addEventListener('click', function() { overlay.remove(); });

  var doClone = async function() {
    var url = overlay.querySelector('#gm-clone-url').value.trim();
    var dest = overlay.querySelector('#gm-clone-dest').value.trim();
    var errEl = overlay.querySelector('#gm-clone-err');
    var btn = overlay.querySelector('#gm-clone-ok');
    if (!url) { errEl.textContent = t('gm_url_required'); errEl.style.display = 'block'; return; }
    btn.textContent = t('gm_cloning'); btn.disabled = true;
    try {
      var r = await GM.api('/repo/clone', { method: 'POST', json: { url: url, dest: dest } });
      overlay.remove();
      GM.loadRepos();
      mvmOS.notify(t('gm_title'), r.output || t('gm_cloned_ok'));
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
      btn.textContent = t('gm_clone'); btn.disabled = false;
    }
  };

  overlay.querySelector('#gm-clone-ok').addEventListener('click', doClone);
  overlay.querySelector('#gm-clone-url').addEventListener('keydown', function(e) { if (e.key === 'Enter') doClone(); });
};

// ── Init dialog ───────────────────────────────────────────────────────────────

GM.showInit = function() {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
  overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:380px;display:flex;flex-direction:column;gap:12px">'
    + '<div style="font-weight:600;font-size:.95rem">&#x25CE; ' + t('gm_init_repo_title') + '</div>'
    + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_dir_path') + '</div>'
    + '<input class="s-input" id="gm-init-path" placeholder="/var/www/my-project" style="width:100%;box-sizing:border-box"></div>'
    + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_remote_url') + ' <span style="opacity:.6">' + t('gm_optional') + '</span></div>'
    + '<input class="s-input" id="gm-init-remote" placeholder="git@github.com:user/repo.git" style="width:100%;box-sizing:border-box"></div>'
    + '<div id="gm-init-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end">'
    + '<button class="s-btn" id="gm-init-cancel">' + t('gm_cancel') + '</button>'
    + '<button class="s-btn" id="gm-init-ok" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_init') + '</button>'
    + '</div></div>';
  GM.contentEl.appendChild(overlay);
  overlay.querySelector('#gm-init-path').focus();
  overlay.querySelector('#gm-init-cancel').addEventListener('click', function() { overlay.remove(); });

  var doInit = async function() {
    var path = overlay.querySelector('#gm-init-path').value.trim();
    var remote = overlay.querySelector('#gm-init-remote').value.trim();
    var errEl = overlay.querySelector('#gm-init-err');
    var btn = overlay.querySelector('#gm-init-ok');
    if (!path) { errEl.textContent = t('gm_dir_path_required'); errEl.style.display = 'block'; return; }
    btn.textContent = t('gm_initializing'); btn.disabled = true;
    try {
      var r = await GM.api('/repo/init', { method: 'POST', json: { path: path, remote: remote } });
      overlay.remove();
      GM.loadRepos();
      mvmOS.notify(t('gm_title'), r.output || t('gm_initialized_ok', { path: path }));
    } catch(e) {
      errEl.textContent = e.message; errEl.style.display = 'block';
      btn.textContent = t('gm_init'); btn.disabled = false;
    }
  };

  overlay.querySelector('#gm-init-ok').addEventListener('click', doInit);
  overlay.querySelector('#gm-init-path').addEventListener('keydown', function(e) { if (e.key === 'Enter') doInit(); });
};

// ── Repo view ─────────────────────────────────────────────────────────────────

GM.showRepoView = function(container, repo) {
  var tab = 'status';

  container.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">'
    + '<div style="flex:1;min-width:0">'
    + '<div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + repo.name + '</div>'
    + '<div style="font-size:.72rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">' + (repo.remote || '') + '</div>'
    + '</div>'
    + '<span id="gm-branch-btn" style="font-size:.75rem;background:var(--surface2,#313244);border-radius:12px;padding:2px 9px;white-space:nowrap;flex-shrink:0;cursor:pointer;user-select:none" title="' + t('gm_switch_branch') + '">&#x1F33F; ' + repo.branch + ' &#x25BE;</span>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0">'
    + '<button id="gm-pull" class="s-btn s-btn-sm">&#x2B07; ' + t('gm_pull') + '</button>'
    + '<button id="gm-push" class="s-btn s-btn-sm">&#x2B06; ' + t('gm_push') + '</button>'
    + '<button id="gm-fetch" class="s-btn s-btn-sm">&#x27F3; ' + t('gm_fetch') + '</button>'
    + '<div id="gm-sync-info" style="font-size:.75rem;color:var(--text-dim);margin-left:4px"></div>'
    + '<div style="flex:1"></div>'
    + '<div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">'
    + '<button id="gm-tab-status" style="border:none;padding:3px 10px;cursor:pointer;font-size:.78rem;background:var(--accent);color:#fff">' + t('gm_status') + '</button>'
    + '<button id="gm-tab-log" style="border:none;padding:3px 10px;cursor:pointer;font-size:.78rem;background:none;color:var(--text-dim)">' + t('gm_log') + '</button>'
    + '</div></div>'
    + '<div id="gm-tab-content" style="flex:1;overflow-y:auto;padding:12px 14px"></div>'
    + '<div id="gm-action-output" style="display:none;padding:8px 14px;font-size:.78rem;font-family:monospace;background:var(--surface);border-top:1px solid var(--border);max-height:100px;overflow-y:auto;white-space:pre-wrap"></div>';

  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  function switchTab(t) {
    tab = t;
    container.querySelector('#gm-tab-status').style.background = t === 'status' ? 'var(--accent)' : 'none';
    container.querySelector('#gm-tab-status').style.color = t === 'status' ? '#fff' : 'var(--text-dim)';
    container.querySelector('#gm-tab-log').style.background = t === 'log' ? 'var(--accent)' : 'none';
    container.querySelector('#gm-tab-log').style.color = t === 'log' ? '#fff' : 'var(--text-dim)';
    if (t === 'status') loadStatus();
    else loadLog();
  }

  var ACTION_ING_KEYS = { pull: 'gm_pulling', push: 'gm_pushing', fetch: 'gm_fetching' };

  async function doAction(action) {
    var btn = container.querySelector('#gm-' + action);
    var out = container.querySelector('#gm-action-output');
    btn.disabled = true; btn.style.opacity = '.5';
    out.style.display = 'block'; out.style.color = 'var(--text-dim)';
    out.textContent = t(ACTION_ING_KEYS[action] || action);
    try {
      var r = await GM.api('/repo/' + action, { method: 'POST', json: { path: repo.path } });
      out.textContent = r.output || t('gm_done');
      out.style.color = '#a6e3a1';
      if (action === 'pull' || action === 'fetch') { loadStatus(); GM.loadRepos(); }
    } catch(e) {
      out.textContent = e.message; out.style.color = '#f38ba8';
    } finally {
      btn.disabled = false; btn.style.opacity = '';
    }
  }

  async function doCommit(msgInput) {
    var msg = msgInput.value.trim();
    if (!msg) { msgInput.focus(); return; }
    var btn = container.querySelector('#gm-commit-btn');
    var out = container.querySelector('#gm-action-output');
    btn.disabled = true;
    if (out) { out.style.display = 'block'; out.textContent = t('gm_committing'); out.style.color = 'var(--text-dim)'; }
    try {
      var r = await GM.api('/repo/commit', { method: 'POST', json: { path: repo.path, message: msg } });
      msgInput.value = '';
      if (out) { out.textContent = r.output; out.style.color = '#a6e3a1'; }
      loadStatus(); GM.loadRepos();
    } catch(e) {
      if (out) { out.textContent = e.message; out.style.color = '#f38ba8'; }
      btn.disabled = false;
    }
  }

  async function loadStatus() {
    var tc = container.querySelector('#gm-tab-content');
    if (!tc) return;
    tc.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">' + t('gm_loading') + '</div>';
    try {
      var s = await GM.api('/repo/status?path=' + encodeURIComponent(repo.path));

      var syncInfo = container.querySelector('#gm-sync-info');
      if (syncInfo) {
        var parts = [];
        if (s.ahead > 0) parts.push('&#x2191; ' + t('gm_ahead', { n: s.ahead }));
        if (s.behind > 0) parts.push('&#x2193; ' + t('gm_behind', { n: s.behind }));
        syncInfo.innerHTML = parts.join('&nbsp;&nbsp;');
        syncInfo.style.color = s.behind > 0 ? '#f38ba8' : 'var(--text-dim)';
      }

      var commitHtml = '<div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px">'
        + '<div style="font-size:.75rem;color:var(--text-dim)">' + t('gm_commit_message') + ' <span style="opacity:.6">' + t('gm_ctrl_enter') + '</span></div>'
        + '<textarea id="gm-commit-msg" class="s-input" rows="2" placeholder="' + t('gm_describe_changes') + '" style="resize:vertical;font-family:inherit;font-size:.83rem;width:100%;box-sizing:border-box"></textarea>'
        + '<div><button id="gm-commit-btn" class="s-btn s-btn-sm" ' + (s.files.length ? 'style="background:var(--accent);color:#fff;border-color:var(--accent)"' : 'disabled') + '>&#x2713; ' + t('gm_commit_all') + '</button></div>'
        + '</div>';

      if (!s.files.length) {
        tc.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;opacity:.7;padding:20px 0;text-align:center">' + t('gm_nothing_to_commit') + '</div>' + commitHtml;
      } else {
        tc.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
          + '<span style="font-size:.75rem;color:var(--text-dim)">' + t('gm_changed_files', { n: s.files.length, s: s.files.length !== 1 ? 's' : '' }) + '</span>'
          + '<button id="gm-discard-all" class="s-btn s-btn-sm" style="font-size:.72rem;color:#f38ba8;border-color:#f38ba8">&#x21BA; ' + t('gm_discard_all') + '</button>'
          + '</div>'
          + '<div id="gm-file-list" style="display:flex;flex-direction:column;gap:2px;margin-bottom:14px"></div>'
          + commitHtml;

        tc.querySelector('#gm-discard-all').addEventListener('click', async function() {
          if (!await mvmOS.confirm(t('gm_discard_all_confirm', { name: repo.name }))) return;
          GM.writeApi('/repo/discard', { path: repo.path }, repo)
            .then(function() { loadStatus(); })
            .catch(function(e) { if (e.message !== 'cancelled') mvmOS.notify(t('gm_title'), e.message); });
        });

        var fl = tc.querySelector('#gm-file-list');
        s.files.forEach(function(f) {
          var code = f.code.trim();
          var color = code === 'M' || code === 'MM' ? '#fab387' : code === '??' ? 'var(--text-dim)' : code === 'A' ? '#a6e3a1' : code === 'D' ? '#f38ba8' : 'var(--text)';
          var canDiff = code !== '??';
          var canDiscard = code !== '??';

          var row = document.createElement('div');
          row.style.cssText = 'border-radius:4px;overflow:hidden;';

          var fileRow = document.createElement('div');
          fileRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:.8rem;font-family:monospace;'
            + (canDiff ? 'cursor:pointer;' : '');
          fileRow.innerHTML = '<span style="color:' + color + ';width:20px;flex-shrink:0">' + f.code + '</span>'
            + '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + f.file + '</span>'
            + (canDiscard ? '<button class="gm-discard-file s-btn s-btn-sm" style="font-size:.68rem;padding:1px 6px;opacity:.7" title="' + t('gm_discard') + '">&#x21BA;</button>' : '');

          if (canDiff) {
            fileRow.addEventListener('mouseenter', function() { this.style.background = 'var(--surface2,#313244)'; });
            fileRow.addEventListener('mouseleave', function() { this.style.background = ''; });
            fileRow.addEventListener('click', function(e) {
              if (e.target.classList.contains('gm-discard-file')) return;
              var existing = row.querySelector('.gm-diff-panel');
              if (existing) { existing.remove(); return; }
              var panel = document.createElement('div');
              panel.className = 'gm-diff-panel';
              panel.style.cssText = 'font-family:monospace;font-size:.74rem;padding:6px 8px;background:var(--bg,#1e1e2e);border-top:1px solid var(--border);max-height:260px;overflow-y:auto;white-space:pre';
              panel.textContent = t('gm_loading');
              row.appendChild(panel);
              GM.api('/repo/diff?path=' + encodeURIComponent(repo.path) + '&file=' + encodeURIComponent(f.file))
                .then(function(d) {
                  if (!d.diff) { panel.textContent = t('gm_no_diff'); return; }
                  panel.innerHTML = '';
                  d.diff.split('\n').forEach(function(line) {
                    var span = document.createElement('div');
                    span.textContent = line;
                    span.style.color = line.startsWith('+') && !line.startsWith('+++') ? '#a6e3a1'
                      : line.startsWith('-') && !line.startsWith('---') ? '#f38ba8'
                      : line.startsWith('@@') ? '#89dceb'
                      : 'var(--text-dim)';
                    panel.appendChild(span);
                  });
                })
                .catch(function(e) { panel.textContent = e.message; });
            });
          }

          if (canDiscard) {
            fileRow.querySelector('.gm-discard-file').addEventListener('click', async function(e) {
              e.stopPropagation();
              if (!await mvmOS.confirm(t('gm_discard_file_confirm', { file: f.file }))) return;
              GM.writeApi('/repo/discard', { path: repo.path, file: f.file }, repo)
                .then(function() { loadStatus(); })
                .catch(function(e) { if (e.message !== 'cancelled') mvmOS.notify(t('gm_title'), e.message); });
            });
          }

          row.appendChild(fileRow);
          fl.appendChild(row);
        });
      }

      var commitBtn = tc.querySelector('#gm-commit-btn');
      var msgInput = tc.querySelector('#gm-commit-msg');
      if (commitBtn && msgInput) {
        commitBtn.addEventListener('click', function() { doCommit(msgInput); });
        msgInput.addEventListener('keydown', function(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doCommit(msgInput); });
      }
    } catch(e) {
      tc.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + e.message + '</div>';
    }
  }

  async function loadLog() {
    var tc = container.querySelector('#gm-tab-content');
    if (!tc) return;
    tc.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">' + t('gm_loading') + '</div>';
    try {
      var entries = await GM.api('/repo/log?path=' + encodeURIComponent(repo.path));
      if (!entries.length) {
        tc.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;opacity:.7;padding:20px 0;text-align:center">' + t('gm_no_commits') + '</div>';
        return;
      }
      tc.innerHTML = '';
      entries.forEach(function(e) {
        var row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:52px 1fr 90px 100px;gap:8px;align-items:baseline;padding:5px 4px;border-bottom:1px solid var(--border);font-size:.79rem';
        row.innerHTML = '<span style="font-family:monospace;color:var(--accent);opacity:.8">' + e.hash + '</span>'
          + '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e.message + '</span>'
          + '<span style="color:var(--text-dim);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + e.author + '</span>'
          + '<span style="color:var(--text-dim);font-size:.72rem;text-align:right;white-space:nowrap">' + e.date + '</span>';
        tc.appendChild(row);
      });
    } catch(e) {
      tc.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + e.message + '</div>';
    }
  }

  container.querySelector('#gm-pull').addEventListener('click', function() { doAction('pull'); });
  container.querySelector('#gm-push').addEventListener('click', function() { doAction('push'); });
  container.querySelector('#gm-fetch').addEventListener('click', function() { doAction('fetch'); });
  container.querySelector('#gm-tab-status').addEventListener('click', function() { switchTab('status'); });
  container.querySelector('#gm-tab-log').addEventListener('click', function() { switchTab('log'); });

  container.querySelector('#gm-branch-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    var existing = document.getElementById('gm-branch-dropdown');
    if (existing) { existing.remove(); return; }

    var btn = container.querySelector('#gm-branch-btn');
    var rect = btn.getBoundingClientRect();

    var dd = document.createElement('div');
    dd.id = 'gm-branch-dropdown';
    dd.style.cssText = 'position:fixed;z-index:999;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:180px;overflow:hidden;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px';
    dd.innerHTML = '<div style="padding:6px 10px;font-size:.72rem;color:var(--text-dim);border-bottom:1px solid var(--border)">' + t('gm_loading_branches') + '</div>';
    document.body.appendChild(dd);

    GM.api('/repo/branches?path=' + encodeURIComponent(repo.path)).then(function(data) {
      dd.innerHTML = '';
      data.branches.forEach(function(b) {
        var isRemote = b.startsWith('origin/');
        var label = isRemote ? b.replace('origin/', '') + ' <span style="font-size:.68rem;opacity:.6">' + t('gm_remote_badge') + '</span>' : b;
        var row = document.createElement('div');
        var isCurrent = b === data.current || (isRemote && b.replace('origin/', '') === data.current);
        row.style.cssText = 'padding:7px 12px;cursor:pointer;font-size:.82rem;display:flex;align-items:center;gap:6px;'
          + (isCurrent ? 'background:var(--accent-dim,rgba(99,102,241,.15));font-weight:600' : '');
        row.innerHTML = (isCurrent ? '<span style="color:var(--accent)">&#x2713;</span> ' : '<span style="width:14px;display:inline-block"></span> ') + label;
        if (!isCurrent) {
          row.addEventListener('mouseenter', function() { this.style.background = 'var(--surface2,#313244)'; });
          row.addEventListener('mouseleave', function() { this.style.background = ''; });
          row.addEventListener('click', function() {
            dd.remove();
            var out = container.querySelector('#gm-action-output');
            if (out) { out.style.display = 'block'; out.style.color = 'var(--text-dim)'; out.textContent = t('gm_switching_to', { branch: b }); }
            GM.api('/repo/checkout', { method: 'POST', json: { path: repo.path, branch: b } }).then(function(r) {
              repo.branch = r.branch;
              btn.innerHTML = '&#x1F33F; ' + r.branch + ' &#x25BE;';
              if (out) { out.textContent = r.output || t('gm_switched_to', { branch: r.branch }); out.style.color = '#a6e3a1'; }
              GM.loadRepos();
              loadStatus();
            }).catch(function(e) {
              if (out) { out.style.display = 'block'; out.textContent = e.message; out.style.color = '#f38ba8'; }
            });
          });
        }
        dd.appendChild(row);
      });
    }).catch(function(e) {
      dd.innerHTML = '<div style="padding:8px 12px;color:#f38ba8;font-size:.82rem">' + e.message + '</div>';
    });

    var close = function() { dd.remove(); document.removeEventListener('click', close); };
    setTimeout(function() { document.addEventListener('click', close); }, 0);
  });

  loadStatus();
};

// ── SSH view ──────────────────────────────────────────────────────────────────

GM.showSSH = function(container) {
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">'
    + '<div style="font-weight:600;font-size:.9rem">' + t('gm_ssh_keys') + '</div>'
    + '<button id="gm-ssh-gen" class="s-btn s-btn-sm">&#xFF0B; ' + t('gm_generate_new_key') + '</button>'
    + '</div>'
    + '<div id="gm-ssh-content" style="flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:14px"></div>';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  container.querySelector('#gm-ssh-gen').addEventListener('click', function() { showGenerate(container); });
  loadKeys(container);

  function loadKeys(container) {
    var c = container.querySelector('#gm-ssh-content');
    c.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">' + t('gm_loading') + '</div>';
    GM.api('/ssh').then(function(keys) {
      c.innerHTML = '';
      if (!keys.length) {
        c.innerHTML = '<div style="color:var(--text-dim);font-size:.85rem;text-align:center;padding:24px 0;opacity:.7">' + t('gm_no_ssh_keys') + '</div>';
        return;
      }
      keys.forEach(function(key) {
        var parts = key.public_key.split(' ');
        var comment = parts[2] || '';
        var card = document.createElement('div');
        card.style.cssText = 'background:var(--surface2,#313244);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px';
        card.innerHTML = '<div style="display:flex;align-items:center;gap:8px">'
          + '<span style="font-size:1.1rem">&#x1F511;</span>'
          + '<div style="flex:1"><div style="font-weight:600;font-size:.85rem">' + key.type + '</div>'
          + (comment ? '<div style="font-size:.75rem;color:var(--text-dim)">' + comment + '</div>' : '')
          + '</div><span style="font-size:.7rem;background:#a6e3a1;color:#1e1e2e;border-radius:10px;padding:2px 8px;font-weight:600">' + t('gm_active') + '</span></div>'
          + '<div style="font-family:monospace;font-size:.72rem;color:var(--text-dim);background:var(--surface);border-radius:5px;padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          + key.public_key.substring(0, key.type.length + 49) + '...</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
          + '<button class="s-btn s-btn-sm gm-copy-key">&#x1F4CB; ' + t('gm_copy_public_key') + '</button>'
          + '<button class="s-btn s-btn-sm gm-test-gh">' + t('gm_test_github') + '</button>'
          + '<button class="s-btn s-btn-sm gm-test-gl">' + t('gm_test_gitlab') + '</button>'
          + '<button class="s-btn s-btn-sm gm-test-custom">' + t('gm_test_other') + '</button>'
          + '</div>'
          + '<div class="gm-test-result" style="display:none;font-size:.78rem;padding:6px 10px;border-radius:5px;font-family:monospace"></div>';

        card.querySelector('.gm-copy-key').addEventListener('click', function() {
          var btn = this;
          navigator.clipboard.writeText(key.public_key).then(function() {
            btn.textContent = '✓ ' + t('gm_copied');
            setTimeout(function() { btn.textContent = '📋 ' + t('gm_copy_public_key'); }, 2000);
          });
        });

        function testSSH(host) {
          var result = card.querySelector('.gm-test-result');
          result.style.display = 'block';
          result.style.background = 'var(--surface)';
          result.style.color = 'var(--text-dim)';
          result.textContent = t('gm_testing_host', { host: host });
          GM.api('/ssh/test', { method: 'POST', json: { host: host } }).then(function(r) {
            result.textContent = r.output || (r.ok ? t('gm_connection_ok') : t('gm_connection_failed'));
            result.style.color = r.ok ? '#a6e3a1' : '#f38ba8';
            result.style.background = r.ok ? 'rgba(166,227,161,.1)' : 'rgba(243,139,168,.1)';
          }).catch(function(e) {
            result.textContent = e.message; result.style.color = '#f38ba8';
          });
        }

        card.querySelector('.gm-test-gh').addEventListener('click', function() { testSSH('github.com'); });
        card.querySelector('.gm-test-gl').addEventListener('click', function() { testSSH('gitlab.com'); });
        card.querySelector('.gm-test-custom').addEventListener('click', async function() {
          var host = await mvmOS.prompt(t('gm_hostname_prompt'), t('gm_hostname_placeholder'));
          if (host) testSSH(host);
        });
        c.appendChild(card);
      });

      var note = document.createElement('div');
      note.style.cssText = 'font-size:.78rem;color:var(--text-dim);padding:4px 0;opacity:.8';
      note.innerHTML = t('gm_ssh_tip');
      c.appendChild(note);
    }).catch(function(e) {
      c.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + e.message + '</div>';
    });
  }

  function showGenerate(container) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:360px;display:flex;flex-direction:column;gap:12px">'
      + '<div style="font-weight:600;font-size:.95rem">' + t('gm_generate_ssh_key_title') + '</div>'
      + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_comment_optional') + '</div>'
      + '<input class="s-input" id="gm-gen-comment" placeholder="' + t('gm_comment_placeholder') + '" style="width:100%;box-sizing:border-box"></div>'
      + '<div style="font-size:.78rem;color:var(--text-dim);background:var(--surface2,#313244);border-radius:6px;padding:8px 10px">' + t('gm_gen_key_note') + '</div>'
      + '<div id="gm-gen-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="s-btn" id="gm-gen-cancel">' + t('gm_cancel') + '</button>'
      + '<button class="s-btn" id="gm-gen-ok" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_generate') + '</button>'
      + '</div></div>';
    container.style.position = 'relative';
    container.appendChild(overlay);
    overlay.querySelector('#gm-gen-comment').focus();
    overlay.querySelector('#gm-gen-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('#gm-gen-ok').addEventListener('click', function() {
      var comment = overlay.querySelector('#gm-gen-comment').value.trim();
      var errEl = overlay.querySelector('#gm-gen-err');
      var btn = overlay.querySelector('#gm-gen-ok');
      btn.textContent = t('gm_generating'); btn.disabled = true;
      GM.api('/ssh/generate', { method: 'POST', json: { comment: comment } }).then(function() {
        overlay.remove();
        loadKeys(container);
      }).catch(function(e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
        btn.textContent = t('gm_generate'); btn.disabled = false;
      });
    });
  }
};

// ── Register ──────────────────────────────────────────────────────────────────

mvmOS.registerApp({
  id: 'git-manager',
  name: t('gm_title'),
  icon: '🔀',
  category: 'Administration',
  width: 900,
  height: 580,

  launch: function() {
    mvmOS.createWindow({
      id: 'git-manager',
      title: '🔀 ' + t('gm_title'),
      icon: '🔀',
      width: 900,
      height: 580,
      minWidth: 640,
      minHeight: 400,
      onMount: function(body) {
        body.innerHTML = '';
        GM.init(body);
      }
    });
  }
});

})();
