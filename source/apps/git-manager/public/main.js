// Git Manager for mvmOS v1.0.0

(function() {

function start() {

var t = window.t || function(k) { return k; };

var GM = {
  state: { repos: [], activeRepo: null, currentUser: '', foreignAccess: {} },
  body: null,
  listEl: null,
  contentEl: null,
};

GM.escape = function(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
};

// ── Markdown rendering (subset of GFM: headers, bold/italic, code, links,
//    quotes, lists, task lists) ─────────────────────────────────────────────────

GM.renderMarkdown = function(src, interactive) {
  var raw = String(src == null ? '' : src).replace(/\r\n/g, '\n');
  var lines = raw.split('\n');
  var out = [];
  var listStack = [];
  var checklistIndex = 0;
  var i = 0;

  function safeHref(url) {
    url = (url || '').trim();
    return /^(https?:|mailto:|#|\/)/i.test(url) ? url : '#';
  }

  function inline(s) {
    s = GM.escape(s);
    s = s.replace(/`([^`\n]+)`/g, function(m, code) { return '<code>' + code + '</code>'; });
    s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^\n]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, function(m, pre, txt) { return pre + '<em>' + txt + '</em>'; });
    s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, function(m, pre, txt) { return pre + '<em>' + txt + '</em>'; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(m, text, url) {
      return '<a href="' + GM.escape(safeHref(url)) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">' + text + '</a>';
    });
    return s;
  }

  function closeLists() {
    while (listStack.length) out.push(listStack.pop() === 'ul' ? '</ul>' : '</ol>');
  }

  while (i < lines.length) {
    var line = lines[i];

    if (/^```/.test(line)) {
      closeLists();
      var codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++;
      out.push('<pre style="background:var(--bg,#1e1e2e);border-radius:6px;padding:8px 10px;overflow-x:auto;font-size:.8rem"><code>' + GM.escape(codeLines.join('\n')) + '</code></pre>');
      continue;
    }

    if (!line.trim()) { closeLists(); i++; continue; }

    var h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      var level = h[1].length;
      out.push('<h' + level + ' style="margin:10px 0 6px;font-size:' + (1.15 - level * 0.08) + 'rem">' + inline(h[2]) + '</h' + level + '>');
      i++; continue;
    }

    if (/^>\s?/.test(line)) {
      closeLists();
      var quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quoteLines.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote style="margin:6px 0;padding:4px 12px;border-left:3px solid var(--border);color:var(--text-dim)">' + inline(quoteLines.join('<br>')) + '</blockquote>');
      continue;
    }

    var task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      closeLists();
      var idx = checklistIndex++;
      var checked = task[1].toLowerCase() === 'x';
      out.push('<div class="gm-task-item" style="display:flex;align-items:flex-start;gap:6px;margin:2px 0">'
        + '<input type="checkbox" class="gm-task-checkbox" data-task-index="' + idx + '" ' + (checked ? 'checked ' : '') + (interactive ? '' : 'disabled ') + 'style="margin-top:3px;' + (interactive ? 'cursor:pointer' : 'cursor:default') + '">'
        + '<span style="' + (checked ? 'text-decoration:line-through;opacity:.6' : '') + '">' + inline(task[2]) + '</span></div>');
      i++; continue;
    }

    var ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listStack[listStack.length - 1] !== 'ul') { closeLists(); out.push('<ul style="margin:4px 0;padding-left:22px">'); listStack.push('ul'); }
      out.push('<li>' + inline(ul[1]) + '</li>');
      i++; continue;
    }

    var ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listStack[listStack.length - 1] !== 'ol') { closeLists(); out.push('<ol style="margin:4px 0;padding-left:22px">'); listStack.push('ol'); }
      out.push('<li>' + inline(ol[1]) + '</li>');
      i++; continue;
    }

    closeLists();
    var paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^```/.test(lines[i]) && !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) {
      paraLines.push(lines[i]); i++;
    }
    out.push('<p style="margin:6px 0">' + inline(paraLines.join('<br>')) + '</p>');
  }
  closeLists();
  return out.join('\n');
};

// ── Markdown editor toolbar ──────────────────────────────────────────────────────

GM.mdToolbarHtml = function(targetId) {
  var btns = [
    { cmd: 'h', label: 'H', title: t('gm_md_heading') },
    { cmd: 'b', label: '<strong>B</strong>', title: t('gm_md_bold') },
    { cmd: 'i', label: '<em>I</em>', title: t('gm_md_italic') },
    { cmd: 'quote', label: '&#x275D;', title: t('gm_md_quote') },
    { cmd: 'code', label: '&lt;/&gt;', title: t('gm_md_code') },
    { cmd: 'link', label: '&#x1F517;', title: t('gm_md_link') },
    { cmd: 'ul', label: '&#x2022; &#x2261;', title: t('gm_md_bullet_list') },
    { cmd: 'ol', label: '1. &#x2261;', title: t('gm_md_numbered_list') },
    { cmd: 'task', label: '&#x2611;', title: t('gm_md_checklist') },
  ];
  var html = '<div class="gm-md-toolbar" data-target="' + targetId + '" style="display:flex;gap:2px;padding:4px;border:1px solid var(--border);border-bottom:none;border-radius:6px 6px 0 0;background:var(--surface2,#313244);flex-wrap:wrap">';
  btns.forEach(function(b) {
    html += '<button type="button" class="s-btn s-btn-sm gm-md-btn" data-cmd="' + b.cmd + '" title="' + b.title + '" style="padding:3px 9px;line-height:1.4">' + b.label + '</button>';
  });
  html += '</div>';
  return html;
};

GM.mdApply = function(ta, cmd) {
  function wrap(prefix, suffix, placeholder) {
    suffix = suffix == null ? prefix : suffix;
    var start = ta.selectionStart, end = ta.selectionEnd;
    var value = ta.value;
    var selected = value.slice(start, end) || placeholder || '';
    ta.value = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    var cs = start + prefix.length, ce = cs + selected.length;
    ta.focus(); ta.setSelectionRange(cs, ce);
  }
  function linePrefix(prefix) {
    var start = ta.selectionStart, end = ta.selectionEnd;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var lineEndIdx = value.indexOf('\n', end);
    var lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    var block = value.slice(lineStart, lineEnd);
    var newBlock = block.split('\n').map(function(l) { return prefix + l; }).join('\n');
    ta.value = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
    ta.focus(); ta.setSelectionRange(lineStart, lineStart + newBlock.length);
  }
  if (cmd === 'h') linePrefix('## ');
  else if (cmd === 'b') wrap('**', '**', t('gm_md_bold_placeholder'));
  else if (cmd === 'i') wrap('_', '_', t('gm_md_italic_placeholder'));
  else if (cmd === 'quote') linePrefix('> ');
  else if (cmd === 'code') {
    var hasNewline = ta.value.slice(ta.selectionStart, ta.selectionEnd).indexOf('\n') !== -1;
    if (hasNewline) wrap('```\n', '\n```', t('gm_md_code_placeholder'));
    else wrap('`', '`', t('gm_md_code_placeholder'));
  }
  else if (cmd === 'link') {
    var start = ta.selectionStart, end = ta.selectionEnd;
    var value = ta.value;
    var selected = value.slice(start, end) || t('gm_md_link_text');
    var insertion = '[' + selected + '](url)';
    ta.value = value.slice(0, start) + insertion + value.slice(end);
    var urlStart = start + 1 + selected.length + 2;
    ta.focus(); ta.setSelectionRange(urlStart, urlStart + 3);
  }
  else if (cmd === 'ul') linePrefix('- ');
  else if (cmd === 'ol') linePrefix('1. ');
  else if (cmd === 'task') linePrefix('- [ ] ');
  ta.dispatchEvent(new Event('input'));
};

GM.wireMdToolbar = function(container, textarea) {
  var toolbar = container.querySelector('.gm-md-toolbar[data-target="' + textarea.id + '"]');
  if (!toolbar) return;
  Array.prototype.forEach.call(toolbar.querySelectorAll('.gm-md-btn'), function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      GM.mdApply(textarea, btn.getAttribute('data-cmd'));
    });
  });
  GM.wireListContinuation(textarea);
};

// Pressing Enter inside a list line continues it (same bullet, next number,
// unchecked checkbox); pressing Enter on an empty list line clears the marker
// and exits the list instead of adding another empty item.
GM.wireListContinuation = function(ta) {
  ta.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    var start = ta.selectionStart, end = ta.selectionEnd;
    if (start !== end) return;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var line = value.slice(lineStart, start);

    var checklist = line.match(/^(\s*)([-*+])\s\[([ xX])\]\s?(.*)$/);
    var ordered = !checklist && line.match(/^(\s*)(\d+)([.)])\s(.*)$/);
    var bullet = !checklist && !ordered && line.match(/^(\s*)([-*+])\s(?!\[)(.*)$/);
    var match = checklist || ordered || bullet;
    if (!match) return;

    e.preventDefault();
    var content = checklist ? match[4] : (ordered ? match[4] : match[3]);
    if (!content.trim()) {
      ta.value = value.slice(0, lineStart) + value.slice(start);
      ta.setSelectionRange(lineStart, lineStart);
      ta.dispatchEvent(new Event('input'));
      return;
    }
    var indent = match[1], marker;
    if (checklist) marker = indent + match[2] + ' [ ] ';
    else if (ordered) marker = indent + (parseInt(match[2], 10) + 1) + match[3] + ' ';
    else marker = indent + match[2] + ' ';
    var insertion = '\n' + marker;
    ta.value = value.slice(0, start) + insertion + value.slice(end);
    var pos = start + insertion.length;
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  });
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
  var view = body.querySelector('#gm-view');

  GM.listEl = sidebar.querySelector('#gm-repo-list');
  GM.contentEl = view;

  sidebar.querySelector('#gm-refresh').addEventListener('click', function() { GM.loadRepos(); });
  sidebar.querySelector('#gm-clone-btn').addEventListener('click', function() { GM.showClone(); });
  sidebar.querySelector('#gm-init-btn').addEventListener('click', function() { GM.showInit(); });
  sidebar.querySelector('#gm-ssh-btn').addEventListener('click', function() {
    GM.state.activeRepo = null;
    GM.renderSidebar();
    GM.showSSH(GM.contentEl);
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
    GM.state.foreignAccess = _reposData.foreign_access || {};
    GM.state.repos = _reposData.repos || _reposData;
    GM.renderSidebar();
    if (GM.state.activeRepo) {
      var still = GM.state.repos.filter(function(r) { return r.path === GM.state.activeRepo.path; })[0];
      if (still) {
        GM.state.activeRepo = still;
        if (still.locked) GM.showLockedRepo(GM.contentEl, still);
        else GM.showRepoView(GM.contentEl, still);
      }
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
    item.style.cssText = 'padding:7px 10px 7px 12px;cursor:pointer;border-bottom:1px solid var(--border);'
      + (repo.locked ? 'opacity:.62;' : '')
      + (active ? 'background:var(--accent-dim,rgba(99,102,241,.15))' : '');
    item.dataset.gmPath = repo.path;
    item.innerHTML = '<div style="display:flex;align-items:center;gap:5px;pointer-events:none">'
      + '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;font-size:.83rem">' + repo.name + '</span>'
      + (repo.locked ? '<span style="font-size:.72rem;flex-shrink:0" title="' + t('gm_locked') + '">&#x1F512;</span>' : '')
      + (repo.changes > 0 ? '<span style="font-size:.68rem;background:var(--accent);color:#fff;border-radius:10px;padding:1px 5px;flex-shrink:0">' + repo.changes + '</span>' : '')
      + '</div>'
      + '<div style="font-size:.72rem;color:var(--text-dim);margin-top:2px;pointer-events:none">'
      + (repo.locked ? t('gm_owned_by', { owner: repo.owner }) : '&#x1F33F; ' + repo.branch) + '</div>';
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
    if (repo.locked) GM.showLockedRepo(GM.contentEl, repo);
    else GM.showRepoView(GM.contentEl, repo, true);
  };
};

GM.showLockedRepo = function(container, repo) {
  var access = GM.state.foreignAccess || {};
  container.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface)">'
    + '<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:.9rem">' + repo.name + '</div>'
    + '<div style="font-size:.72rem;color:var(--text-dim);margin-top:1px">' + t('gm_owned_by', { owner: repo.owner }) + '</div></div>'
    + '<span style="font-size:.75rem;background:var(--surface2,#313244);border-radius:12px;padding:3px 9px">&#x1F512; ' + t('gm_locked') + '</span></div>'
    + '<div style="flex:1;display:flex;align-items:center;justify-content:center;padding:24px">'
    + '<div style="max-width:480px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px">'
    + '<div style="font-size:2.8rem;opacity:.65">&#x1F512;</div>'
    + '<div style="font-size:1rem;font-weight:700">' + t('gm_foreign_locked_title') + '</div>'
    + '<div style="font-size:.84rem;line-height:1.55;color:var(--text-dim)">' + t('gm_foreign_locked_body', { owner: repo.owner }) + '</div>'
    + (access.premium ? '' : '<div style="font-size:.78rem;line-height:1.5;color:var(--text-dim);padding:8px 12px;background:var(--surface2,#313244);border-radius:7px">' + t('gm_foreign_switch_profile', { owner: repo.owner }) + '</div>')
    + '<div id="gm-unlock-error" style="font-size:.8rem;color:#f38ba8;min-height:18px"></div>'
    + '<button id="gm-unlock-all" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">'
    + (access.premium ? '&#x1F513; ' + t('gm_unlock_all') : '&#x1F48E; ' + t('gm_unlock_premium')) + '</button>'
    + '</div></div>';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  var btn = container.querySelector('#gm-unlock-all');
  var err = container.querySelector('#gm-unlock-error');
  if (!access.premium) {
    btn.addEventListener('click', function() {
      window.dispatchEvent(new CustomEvent('open-subscription-settings'));
    });
    if (window.mvmOS && window.mvmOS.premiumGate) {
      window.mvmOS.premiumGate(btn, t('gm_foreign_premium_info'));
    }
    return;
  }
  if (!access.can_unlock) {
    btn.disabled = true;
    btn.style.opacity = '.5';
    err.textContent = t('gm_unlock_no_sudo');
    return;
  }
  btn.addEventListener('click', async function() {
    var password = await mvmOS.confirmPassword(t('gm_unlock_title'), t('gm_unlock_password_info'));
    if (!password) return;
    btn.disabled = true;
    btn.textContent = t('gm_unlocking');
    err.textContent = '';
    try {
      await GM.api('/repo/unlock', { method: 'POST', json: { password: password } });
      mvmOS.notify(t('gm_title'), t('gm_unlocked_all'));
      await GM.loadRepos();
    } catch(e) {
      err.textContent = e.message;
      btn.disabled = false;
      btn.innerHTML = '&#x1F513; ' + t('gm_unlock_all');
    }
  });
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

GM.showRepoView = function(container, repo, autoFetch) {
  var tab = 'status';
  var lastStatusSignature = null;

  container.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)">'
    + '<div style="flex:1;min-width:0">'
    + '<div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + repo.name + '</div>'
    + '<div style="font-size:.72rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px">' + (repo.remote || '') + '</div>'
    + '</div>'
    + '<span id="gm-branch-btn" style="font-size:.75rem;background:var(--surface2,#313244);border-radius:12px;padding:2px 9px;white-space:nowrap;flex-shrink:0;cursor:pointer;user-select:none" title="' + t('gm_switch_branch') + '">&#x1F33F; ' + repo.branch + ' &#x25BE;</span>'
    + '<span id="gm-branch-local-badge" style="display:none;font-size:.68rem;background:#f9e2af;color:#1e1e2e;border-radius:10px;padding:1px 7px;flex-shrink:0;font-weight:600" title="' + t('gm_branch_local_only') + '">' + t('gm_branch_local_only') + '</span>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:6px;padding:8px 14px;border-bottom:1px solid var(--border);flex-shrink:0">'
    + '<button id="gm-pull" class="s-btn s-btn-sm">&#x2B07; ' + t('gm_pull') + '</button>'
    + '<button id="gm-push" class="s-btn s-btn-sm">&#x2B06; ' + t('gm_push') + '</button>'
    + '<button id="gm-fetch" class="s-btn s-btn-sm">&#x27F3; ' + t('gm_fetch') + '</button>'
    + '<button id="gm-new-branch" class="s-btn s-btn-sm">&#x2295; ' + t('gm_branch_new') + '</button>'
    + '<button id="gm-issues" class="s-btn s-btn-sm">'
    + ((GM.state.foreignAccess || {}).premium ? '&#x25C9; ' : '&#x1F48E; ') + t('gm_issues') + '</button>'
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
      if (action === 'fetch') loadStatus(true);
      else if (action === 'pull' || action === 'push') { loadStatus(); GM.loadRepos(); }
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

  async function loadStatus(onlyIfChanged) {
    var tc = container.querySelector('#gm-tab-content');
    if (!tc) return;
    if (!onlyIfChanged) tc.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">' + t('gm_loading') + '</div>';
    try {
      var s = await GM.api('/repo/status?path=' + encodeURIComponent(repo.path));
      var statusSignature = JSON.stringify(s);
      if (onlyIfChanged && statusSignature === lastStatusSignature) return;
      lastStatusSignature = statusSignature;

      var syncInfo = container.querySelector('#gm-sync-info');
      if (syncInfo) {
        var parts = [];
        if (s.ahead > 0) parts.push('&#x2191; ' + t('gm_ahead', { n: s.ahead }));
        if (s.behind > 0) parts.push('&#x2193; ' + t('gm_behind', { n: s.behind }));
        syncInfo.innerHTML = parts.join('&nbsp;&nbsp;');
        syncInfo.style.color = s.behind > 0 ? '#f38ba8' : 'var(--text-dim)';
      }
      var localBadge = container.querySelector('#gm-branch-local-badge');
      if (localBadge) localBadge.style.display = s.local_only ? 'inline-block' : 'none';

      var commitHtml = '<div style="border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:8px">'
        + '<div style="font-size:.75rem;color:var(--text-dim)">' + t('gm_commit_message') + ' <span style="opacity:.6">' + t('gm_ctrl_enter') + '</span></div>'
        + '<textarea id="gm-commit-msg" class="s-input" rows="4" placeholder="' + t('gm_describe_changes') + '" style="resize:vertical;flex:none;max-width:none;min-height:80px;font-family:inherit;font-size:.83rem;width:100%;box-sizing:border-box"></textarea>'
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

  function showIssues() {
    var tc = container.querySelector('#gm-tab-content');
    container.querySelector('#gm-tab-status').style.background = 'none';
    container.querySelector('#gm-tab-status').style.color = 'var(--text-dim)';
    container.querySelector('#gm-tab-log').style.background = 'none';
    container.querySelector('#gm-tab-log').style.color = 'var(--text-dim)';
    tc.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem;opacity:.7">' + t('gm_loading') + '</div>';
    GM.api('/repo/issues/status?path=' + encodeURIComponent(repo.path)).then(function(status) {
      if (!status.connected) {
        renderIssueSetup(tc, status);
        return;
      }
      renderIssueList(tc, 'open', status);
    }).catch(function(e) {
      tc.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + GM.escape(e.message) + '</div>';
    });
  }

  function renderIssueSetup(tc, status) {
    tc.innerHTML = '<div style="max-width:540px;margin:20px auto;background:var(--surface2,#313244);border-radius:9px;padding:18px;display:flex;flex-direction:column;gap:12px">'
      + '<div style="font-size:1rem;font-weight:700">' + t('gm_issues_connect_title') + '</div>'
      + '<div style="font-size:.82rem;line-height:1.5;color:var(--text-dim)">' + t('gm_issues_connect_body') + '</div>'
      + '<div style="font-size:.76rem;color:var(--text-dim)">' + (status.gh_installed ? t('gm_issues_gh_not_logged') : t('gm_issues_gh_missing')) + '</div>'
      + (status.error ? '<div style="font-size:.78rem;color:#f38ba8">' + GM.escape(status.error) + '</div>' : '')
      + '<input id="gm-issues-token" class="s-input" type="password" autocomplete="off" placeholder="' + t('gm_issues_token_placeholder') + '" style="width:100%;box-sizing:border-box">'
      + '<div id="gm-issues-token-error" style="display:none;color:#f38ba8;font-size:.78rem"></div>'
      + '<div><button id="gm-issues-token-save" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_issues_connect') + '</button></div>'
      + '</div>';
    tc.querySelector('#gm-issues-token-save').addEventListener('click', async function() {
      var token = tc.querySelector('#gm-issues-token').value.trim();
      var err = tc.querySelector('#gm-issues-token-error');
      if (!token) { err.textContent = t('gm_issues_token_required'); err.style.display = 'block'; return; }
      this.disabled = true; this.textContent = t('gm_issues_connecting'); err.style.display = 'none';
      try {
        await GM.api('/repo/issues/token', {method:'POST', json:{path:repo.path, token:token}});
        showIssues();
      } catch(e) {
        err.textContent = e.message; err.style.display = 'block';
        this.disabled = false; this.textContent = t('gm_issues_connect');
      }
    });
  }

  function renderIssueList(tc, state, status) {
    tc.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      + '<div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden">'
      + '<button id="gm-issues-open" class="s-btn s-btn-sm" style="border:0;border-radius:0">' + t('gm_issues_open') + '</button>'
      + '<button id="gm-issues-closed" class="s-btn s-btn-sm" style="border:0;border-radius:0">' + t('gm_issues_closed') + '</button></div>'
      + '<span style="font-size:.72rem;color:var(--text-dim)">' + GM.escape(status.repository || '') + '</span>'
      + '<div style="flex:1"></div>'
      + '<button id="gm-issues-new" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">+ ' + t('gm_issues_new') + '</button>'
      + '</div><div id="gm-issues-list"></div>';
    var openBtn = tc.querySelector('#gm-issues-open');
    var closedBtn = tc.querySelector('#gm-issues-closed');
    openBtn.style.background = state === 'open' ? 'var(--accent)' : 'none';
    openBtn.style.color = state === 'open' ? '#fff' : 'var(--text-dim)';
    closedBtn.style.background = state === 'closed' ? 'var(--accent)' : 'none';
    closedBtn.style.color = state === 'closed' ? '#fff' : 'var(--text-dim)';
    openBtn.onclick = function() { renderIssueList(tc, 'open', status); };
    closedBtn.onclick = function() { renderIssueList(tc, 'closed', status); };
    tc.querySelector('#gm-issues-new').onclick = function() { renderNewIssue(tc, status); };
    var list = tc.querySelector('#gm-issues-list');
    list.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem">' + t('gm_loading') + '</div>';
    GM.api('/repo/issues?path=' + encodeURIComponent(repo.path) + '&state=' + state).then(function(data) {
      var issues = data.issues || [];
      if (!issues.length) {
        list.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem;text-align:center;padding:28px">' + t(state === 'open' ? 'gm_issues_no_open' : 'gm_issues_no_closed') + '</div>';
        return;
      }
      list.innerHTML = '';
      issues.forEach(function(issue) {
        var row = document.createElement('button');
        row.className = 's-btn';
        row.style.cssText = 'width:100%;display:flex;align-items:flex-start;gap:10px;text-align:left;padding:9px 10px;margin-bottom:5px;background:var(--surface2,#313244);border-color:var(--border)';
        row.innerHTML = '<span style="color:' + (issue.state === 'open' ? '#a6e3a1' : '#a6adc8') + ';font-size:1rem">&#x25CF;</span>'
          + '<span style="flex:1;min-width:0"><span style="display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + GM.escape(issue.title) + '</span>'
          + '<span style="display:block;font-size:.7rem;color:var(--text-dim);margin-top:3px">#' + issue.number + ' · ' + GM.escape(issue.author) + ' · ' + t('gm_issues_comments', {n:issue.comments || 0}) + '</span></span>';
        row.onclick = function() { renderIssueDetail(tc, issue.number, status, state, true); };
        list.appendChild(row);
      });
    }).catch(function(e) {
      list.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + GM.escape(e.message) + '</div>';
    });
  }

  function renderNewIssue(tc, status) {
    tc.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button id="gm-issues-back" class="s-btn s-btn-sm">&#x2190; ' + t('gm_back') + '</button>'
      + '<strong>' + t('gm_issues_new') + '</strong></div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;max-width:700px">'
      + '<input id="gm-issue-title" class="s-input" placeholder="' + t('gm_issues_title_placeholder') + '">'
      + GM.mdToolbarHtml('gm-issue-body')
      + '<textarea id="gm-issue-body" class="s-input" rows="10" placeholder="' + t('gm_issues_body_placeholder') + '" style="resize:vertical;max-width:none;border-radius:0 0 6px 6px;margin-top:-1px"></textarea>'
      + '<div id="gm-issue-create-error" style="display:none;color:#f38ba8;font-size:.8rem"></div>'
      + '<div><button id="gm-issue-create" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_issues_create') + '</button></div></div>';
    tc.querySelector('#gm-issues-back').onclick = function() { renderIssueList(tc, 'open', status); };
    GM.wireMdToolbar(tc, tc.querySelector('#gm-issue-body'));
    tc.querySelector('#gm-issue-create').onclick = async function() {
      var title = tc.querySelector('#gm-issue-title').value.trim();
      var body = tc.querySelector('#gm-issue-body').value.trim();
      var err = tc.querySelector('#gm-issue-create-error');
      if (!title) { err.textContent = t('gm_issues_title_required'); err.style.display = 'block'; return; }
      this.disabled = true; this.textContent = t('gm_issues_creating');
      try {
        var data = await GM.api('/repo/issues', {method:'POST',json:{path:repo.path,title:title,body:body}});
        renderIssueDetail(tc, data.issue.number, status, 'open', true);
      } catch(e) {
        err.textContent = e.message; err.style.display = 'block'; this.disabled = false; this.textContent = t('gm_issues_create');
      }
    };
  }

  function issueBranchName(status, number) {
    var safe = (status.username || '').replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[.-]+/, '').replace(/[.-]+$/, '');
    return (safe || 'user') + '/issue' + number;
  }

  function updateIssueBranchButtons(tc, isOnBranch) {
    var prBtn = tc.querySelector('#gm-issue-pr');
    var brBtn = tc.querySelector('#gm-issue-branch');
    if (prBtn) prBtn.style.display = isOnBranch ? '' : 'none';
    if (brBtn) brBtn.style.display = isOnBranch ? 'none' : '';
  }

  function showPRResult(tc, r) {
    var actionResult = tc.querySelector('#gm-issue-action-result');
    if (!actionResult) return;
    actionResult.style.color = '#a6e3a1';
    actionResult.innerHTML = t(r.existing ? 'gm_pr_already_exists' : 'gm_pr_created', {number: r.number})
      + ' <a href="' + GM.escape(r.url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">' + t('gm_pr_open_link') + '</a>';
  }

  function showPRDialog(tc, issue, headBranch) {
    container.style.position = 'relative';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99';
    overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:20px;width:460px;max-width:90%;display:flex;flex-direction:column;gap:12px;max-height:85%;overflow-y:auto">'
      + '<div style="font-weight:600;font-size:.95rem">&#x1F500; ' + t('gm_pr_title_heading') + '</div>'
      + '<div id="gm-pr-existing" style="display:none;background:var(--surface2,#313244);border-radius:6px;padding:8px 10px"></div>'
      + '<div style="display:flex;gap:8px;align-items:center;font-size:.82rem">'
      + '<select id="gm-pr-head" class="s-input" style="flex:1"></select>'
      + '<span style="color:var(--text-dim)">&#x2192;</span>'
      + '<select id="gm-pr-base" class="s-input" style="flex:1"></select>'
      + '</div>'
      + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_pr_title_label') + '</div>'
      + '<input id="gm-pr-title" class="s-input" style="width:100%;box-sizing:border-box" value="' + GM.escape(issue.title || headBranch) + '"></div>'
      + '<div><div style="font-size:.75rem;color:var(--text-dim);margin-bottom:4px">' + t('gm_pr_body_label') + '</div>'
      + '<textarea id="gm-pr-body" class="s-input" rows="6" style="resize:vertical;max-width:none;width:100%;box-sizing:border-box">' + GM.escape(issue.body || '') + '</textarea></div>'
      + '<div id="gm-pr-error" style="color:#f38ba8;font-size:.82rem;display:none"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end">'
      + '<button class="s-btn" id="gm-pr-cancel">' + t('gm_cancel') + '</button>'
      + '<button class="s-btn" id="gm-pr-create" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_pr_create') + '</button>'
      + '</div></div>';
    container.appendChild(overlay);

    var headSel = overlay.querySelector('#gm-pr-head');
    var baseSel = overlay.querySelector('#gm-pr-base');
    headSel.innerHTML = '<option>' + t('gm_loading') + '</option>';
    baseSel.innerHTML = '<option>' + t('gm_loading') + '</option>';

    function fillSelect(sel, names, selected) {
      sel.innerHTML = '';
      names.forEach(function(name) {
        var opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        if (name === selected) opt.selected = true;
        sel.appendChild(opt);
      });
    }

    function loadExistingPRs(head) {
      var box = overlay.querySelector('#gm-pr-existing');
      if (!head) { box.style.display = 'none'; return; }
      GM.api('/repo/pr?path=' + encodeURIComponent(repo.path) + '&head=' + encodeURIComponent(head)).then(function(data) {
        var prs = data.prs || [];
        if (!prs.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        var colors = {open:'#a6e3a1', merged:'#cba6f7', closed:'#f38ba8'};
        box.style.display = 'block';
        box.innerHTML = '<div style="font-size:.75rem;color:var(--text-dim);margin-bottom:5px">' + t('gm_pr_existing_title') + '</div>'
          + prs.map(function(pr) {
              return '<div style="display:flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 0">'
                + '<span style="color:' + (colors[pr.state] || 'var(--text-dim)') + '">&#x25CF;</span>'
                + '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">#' + pr.number + ' ' + GM.escape(pr.title) + ' &#x2192; ' + GM.escape(pr.base) + '</span>'
                + '<a href="' + GM.escape(pr.url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent);flex-shrink:0;white-space:nowrap">' + t('gm_pr_open_link') + '</a></div>';
            }).join('');
      }).catch(function() { box.style.display = 'none'; });
    }
    loadExistingPRs(headBranch);
    headSel.addEventListener('change', function() { loadExistingPRs(headSel.value); });

    GM.api('/repo/branches?path=' + encodeURIComponent(repo.path)).then(function(data) {
      var names = [];
      var seen = {};
      (data.branches || []).forEach(function(b) {
        var name = b.indexOf('origin/') === 0 ? b.slice(7) : b;
        if (!name || name === 'HEAD' || seen[name]) return;
        seen[name] = true;
        names.push(name);
      });
      if (names.indexOf(headBranch) === -1) names.unshift(headBranch);
      fillSelect(headSel, names, headBranch);
      var fallbackBase = names.filter(function(n) { return n !== headBranch; })[0] || names[0];
      GM.api('/repo/status?path=' + encodeURIComponent(repo.path)).then(function(s) {
        var def = s.default_branch && names.indexOf(s.default_branch) !== -1 ? s.default_branch : fallbackBase;
        fillSelect(baseSel, names, def);
      }).catch(function() { fillSelect(baseSel, names, fallbackBase); });
    }).catch(function(e) {
      fillSelect(headSel, [headBranch], headBranch);
      fillSelect(baseSel, [headBranch], headBranch);
      overlay.querySelector('#gm-pr-error').textContent = e.message;
      overlay.querySelector('#gm-pr-error').style.display = 'block';
    });

    overlay.querySelector('#gm-pr-cancel').addEventListener('click', function() { overlay.remove(); });
    overlay.querySelector('#gm-pr-create').addEventListener('click', async function() {
      var head = headSel.value, base = baseSel.value;
      var title = overlay.querySelector('#gm-pr-title').value.trim();
      var body = overlay.querySelector('#gm-pr-body').value;
      var err = overlay.querySelector('#gm-pr-error');
      var btn = this;
      if (!head || !base) { err.textContent = t('gm_pr_branches_required'); err.style.display = 'block'; return; }
      if (head === base) { err.textContent = t('gm_pr_same_branch'); err.style.display = 'block'; return; }
      btn.disabled = true; btn.textContent = t('gm_issues_creating'); err.style.display = 'none';
      try {
        var r = await GM.api('/repo/pr', {method:'POST', json:{path:repo.path, head:head, base:base, title:title, body:body}});
        overlay.remove();
        showPRResult(tc, r);
      } catch(e) {
        err.textContent = e.message; err.style.display = 'block';
        btn.disabled = false; btn.textContent = t('gm_pr_create');
      }
    });
  }

  async function activateIssueBranch(tc, issue) {
    var result = tc.querySelector('#gm-issue-action-result');
    result.style.color = 'var(--text-dim)';
    result.textContent = t('gm_issues_switching_branch');
    var data = await GM.api('/repo/issues/' + issue.number + '/branch', {method:'POST',json:{path:repo.path}});
    repo.branch = data.branch;
    container.querySelector('#gm-branch-btn').innerHTML = '&#x1F33F; ' + GM.escape(data.branch) + ' &#x25BE;';
    GM.renderSidebar();
    loadStatus();
    result.style.color = '#a6e3a1';
    var msgKey = data.created_fresh ? 'gm_issues_branch_ready'
      : data.downloaded ? 'gm_issues_branch_downloaded'
      : data.pulled ? 'gm_issues_branch_synced'
      : 'gm_switched_to';
    result.textContent = t(msgKey, {branch:data.branch});
    return data;
  }

  function renderEditIssue(tc, issue, status, previousState) {
    tc.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button id="gm-issue-edit-cancel" class="s-btn s-btn-sm">&#x2190; ' + t('gm_cancel') + '</button>'
      + '<strong>' + t('gm_issues_edit') + ' #' + issue.number + '</strong></div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;max-width:700px">'
      + '<input id="gm-issue-edit-title" class="s-input" value="' + GM.escape(issue.title) + '">'
      + GM.mdToolbarHtml('gm-issue-edit-body')
      + '<textarea id="gm-issue-edit-body" class="s-input" rows="10" style="resize:vertical;max-width:none;border-radius:0 0 6px 6px;margin-top:-1px">' + GM.escape(issue.body || '') + '</textarea>'
      + '<div id="gm-issue-edit-error" style="display:none;color:#f38ba8;font-size:.8rem"></div>'
      + '<div style="display:flex;gap:8px"><button id="gm-issue-edit-save" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + t('gm_save') + '</button></div></div>';
    var ta = tc.querySelector('#gm-issue-edit-body');
    GM.wireMdToolbar(tc, ta);
    tc.querySelector('#gm-issue-edit-cancel').onclick = function() { renderIssueDetail(tc, issue.number, status, previousState, false); };
    tc.querySelector('#gm-issue-edit-save').onclick = async function() {
      var title = tc.querySelector('#gm-issue-edit-title').value.trim();
      var body = ta.value;
      var err = tc.querySelector('#gm-issue-edit-error');
      if (!title) { err.textContent = t('gm_issues_title_required'); err.style.display = 'block'; return; }
      this.disabled = true; this.textContent = t('gm_saving');
      try {
        await GM.api('/repo/issues/' + issue.number, {method:'PATCH',json:{path:repo.path,title:title,body:body}});
        renderIssueDetail(tc, issue.number, status, previousState, false, {ok:true, text:t('gm_issues_updated')});
      } catch(e) {
        err.textContent = e.message; err.style.display = 'block'; this.disabled = false; this.textContent = t('gm_save');
      }
    };
  }

  function renderIssueDetail(tc, number, status, previousState, autoBranch, notice) {
    tc.innerHTML = '<div style="color:var(--text-dim);font-size:.8rem">' + t('gm_loading') + '</div>';
    GM.api('/repo/issues/' + number + '?path=' + encodeURIComponent(repo.path)).then(function(data) {
      var issue = data.issue;
      var issueBranch = issueBranchName(status, issue.number);
      var onIssueBranch = repo.branch === issueBranch;
      tc.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
        + '<button id="gm-issues-back" class="s-btn s-btn-sm">&#x2190; ' + t('gm_back') + '</button><strong style="flex:1">#' + issue.number + ' ' + GM.escape(issue.title) + '</strong>'
        + '<button id="gm-issue-edit" class="s-btn s-btn-sm">&#x270E; ' + t('gm_issues_edit') + '</button>'
        + '<button id="gm-issue-pr" class="s-btn s-btn-sm" style="display:' + (onIssueBranch ? '' : 'none') + '">&#x1F500; ' + t('gm_issues_pull_request') + '</button>'
        + '<button id="gm-issue-branch" class="s-btn s-btn-sm" style="display:' + (onIssueBranch ? 'none' : '') + '">&#x1F33F; ' + t('gm_issues_create_branch') + '</button>'
        + '<button id="gm-issue-state" class="s-btn s-btn-sm">' + t(issue.state === 'open' ? 'gm_issues_close' : 'gm_issues_reopen') + '</button></div>'
        + '<div style="font-size:.74rem;color:var(--text-dim);margin-bottom:12px">' + GM.escape(issue.author) + ' · ' + GM.escape(issue.state) + '</div>'
        + '<div id="gm-issue-body-view" class="gm-md" style="line-height:1.5;background:var(--surface2,#313244);border-radius:8px;padding:12px;min-height:48px">'
        + (issue.body ? GM.renderMarkdown(issue.body, true) : '<span style="opacity:.6">' + t('gm_issues_no_description') + '</span>') + '</div>'
        + '<div id="gm-issue-action-result" style="font-size:.78rem;margin-top:10px"></div>'
        + '<div style="font-weight:600;margin:16px 0 8px">' + t('gm_issues_comments_title') + '</div><div id="gm-issue-comments"></div>';
      tc.querySelector('#gm-issues-back').onclick = function() { renderIssueList(tc, previousState || issue.state, status); };
      tc.querySelector('#gm-issue-edit').onclick = function() { renderEditIssue(tc, issue, status, previousState); };
      var actionResult = tc.querySelector('#gm-issue-action-result');
      if (notice) {
        actionResult.style.color = notice.ok ? '#a6e3a1' : '#f9e2af';
        actionResult.textContent = notice.text;
      }
      Array.prototype.forEach.call(tc.querySelectorAll('#gm-issue-body-view .gm-task-checkbox'), function(cb) {
        cb.addEventListener('change', async function() {
          var idx = parseInt(cb.getAttribute('data-task-index'), 10);
          var checked = cb.checked;
          cb.disabled = true;
          try {
            var data = await GM.api('/repo/issues/' + issue.number + '/checklist', {method:'PATCH',json:{path:repo.path,index:idx,checked:checked}});
            issue.body = data.issue.body;
            var span = cb.parentElement.querySelector('span');
            if (span) span.style.cssText = checked ? 'text-decoration:line-through;opacity:.6' : '';
            cb.disabled = false;
          } catch(e) {
            cb.checked = !checked;
            cb.disabled = false;
            mvmOS.notify(t('gm_title'), e.message);
          }
        });
      });
      var comments = tc.querySelector('#gm-issue-comments');
      if (!(issue.comments_list || []).length) comments.innerHTML = '<div style="font-size:.8rem;color:var(--text-dim)">' + t('gm_issues_no_comments') + '</div>';
      (issue.comments_list || []).forEach(function(comment) {
        var item = document.createElement('div');
        item.style.cssText = 'background:var(--surface2,#313244);border-radius:7px;padding:10px;margin-bottom:7px';
        item.innerHTML = '<div style="font-size:.7rem;color:var(--text-dim);margin-bottom:6px">' + GM.escape(comment.author) + '</div><div class="gm-md" style="line-height:1.45">' + GM.renderMarkdown(comment.body, false) + '</div>';
        comments.appendChild(item);
      });
      tc.querySelector('#gm-issue-state').onclick = async function() {
        var next = issue.state === 'open' ? 'closed' : 'open';
        this.disabled = true;
        try {
          await GM.api('/repo/issues/' + issue.number + '/state', {method:'PATCH',json:{path:repo.path,state:next}});
          renderIssueDetail(tc, issue.number, status, next, false);
        } catch(e) { this.disabled = false; tc.querySelector('#gm-issue-action-result').textContent = e.message; }
      };
      tc.querySelector('#gm-issue-pr').onclick = function() { showPRDialog(tc, issue, issueBranch); };
      tc.querySelector('#gm-issue-branch').onclick = async function() {
        var result = tc.querySelector('#gm-issue-action-result');
        this.disabled = true; this.textContent = t('gm_issues_creating_branch');
        try {
          await activateIssueBranch(tc, issue);
          this.textContent = '&#x1F33F; ' + t('gm_issues_create_branch'); this.disabled = false;
          updateIssueBranchButtons(tc, repo.branch === issueBranch);
        } catch(e) { result.style.color = '#f38ba8'; result.textContent = e.message; this.disabled = false; this.textContent = t('gm_issues_create_branch'); }
      };
      if (autoBranch) {
        actionResult.style.color = 'var(--text-dim)';
        actionResult.textContent = t('gm_issues_checking_branch');
        GM.api('/repo/issues/' + issue.number + '/branch/sync', {method:'POST',json:{path:repo.path}}).then(function(state) {
          if (state.fetch_error) {
            actionResult.style.color = '#f38ba8'; actionResult.textContent = state.fetch_error; return;
          }
          if (state.switched || state.redirected_default) {
            repo.branch = state.current;
            container.querySelector('#gm-branch-btn').innerHTML = '&#x1F33F; ' + GM.escape(state.current) + ' &#x25BE;';
            GM.renderSidebar();
            loadStatus();
            updateIssueBranchButtons(tc, repo.branch === issueBranch);
          }
          if (state.dirty) {
            actionResult.style.color = '#f9e2af'; actionResult.textContent = t('gm_issues_dirty_no_switch'); return;
          }
          if (state.local_exists) {
            actionResult.style.color = '#a6e3a1';
            actionResult.textContent = t(state.pulled ? 'gm_issues_branch_synced' : 'gm_switched_to', {branch: state.branch});
            return;
          }
          if (state.remote_exists) {
            actionResult.style.color = 'var(--text-dim)';
            actionResult.innerHTML = t('gm_issues_branch_available_remote', {branch: GM.escape(state.branch)})
              + ' <button id="gm-issue-download-branch" class="s-btn s-btn-sm" style="margin-left:6px">' + t('gm_issues_download_branch') + '</button>';
            actionResult.querySelector('#gm-issue-download-branch').addEventListener('click', async function() {
              var dlBtn = this;
              dlBtn.disabled = true; dlBtn.textContent = t('gm_issues_downloading_branch');
              try {
                var data = await GM.api('/repo/issues/' + issue.number + '/branch/download', {method:'POST',json:{path:repo.path}});
                repo.branch = data.branch;
                container.querySelector('#gm-branch-btn').innerHTML = '&#x1F33F; ' + GM.escape(data.branch) + ' &#x25BE;';
                GM.renderSidebar(); loadStatus();
                updateIssueBranchButtons(tc, repo.branch === issueBranch);
                actionResult.style.color = '#a6e3a1';
                actionResult.textContent = t('gm_issues_branch_downloaded', {branch:data.branch});
              } catch(e) {
                actionResult.style.color = '#f38ba8'; actionResult.textContent = e.message;
              }
            });
            return;
          }
          if (state.redirected_default) {
            actionResult.style.color = 'var(--text-dim)';
            actionResult.textContent = t('gm_issues_switched_default', {branch: state.redirected_default});
          } else {
            actionResult.textContent = '';
          }
        }).catch(function(e) {
          actionResult.style.color = '#f38ba8'; actionResult.textContent = e.message;
        });
      }
    }).catch(function(e) { tc.innerHTML = '<div style="color:#f38ba8;font-size:.82rem">' + GM.escape(e.message) + '</div>'; });
  }

  container.querySelector('#gm-pull').addEventListener('click', function() { doAction('pull'); });
  container.querySelector('#gm-push').addEventListener('click', function() { doAction('push'); });
  container.querySelector('#gm-fetch').addEventListener('click', function() { doAction('fetch'); });
  container.querySelector('#gm-new-branch').addEventListener('click', async function() {
    var name = await mvmOS.prompt(t('gm_branch_new_prompt'), '');
    if (!name) return;
    var out = container.querySelector('#gm-action-output');
    if (out) { out.style.display = 'block'; out.style.color = 'var(--text-dim)'; out.textContent = t('gm_branch_creating'); }
    try {
      var r = await GM.api('/repo/branch/create', { method: 'POST', json: { path: repo.path, name: name } });
      repo.branch = r.branch;
      container.querySelector('#gm-branch-btn').innerHTML = '&#x1F33F; ' + GM.escape(r.branch) + ' &#x25BE;';
      GM.renderSidebar(); loadStatus();
      if (out) {
        var msg = t('gm_branch_created', { branch: r.branch });
        if (r.local_only) msg += ' — ' + t('gm_branch_local_only');
        out.textContent = msg; out.style.color = '#a6e3a1';
      }
    } catch(e) {
      if (out) { out.style.display = 'block'; out.textContent = e.message; out.style.color = '#f38ba8'; }
    }
  });
  var issuesBtn = container.querySelector('#gm-issues');
  if (!(GM.state.foreignAccess || {}).premium) {
    issuesBtn.addEventListener('click', function() {
      window.dispatchEvent(new CustomEvent('open-subscription-settings'));
    });
    if (window.mvmOS && window.mvmOS.premiumGate) {
      window.mvmOS.premiumGate(issuesBtn, t('gm_issues_premium_info'));
    }
  } else {
    issuesBtn.addEventListener('click', showIssues);
  }
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
    dd.style.width = Math.min(300, window.innerWidth - 16) + 'px';
    dd.style.minWidth = '0';
    dd.style.left = Math.max(8, Math.min(rect.right - 300, window.innerWidth - 308)) + 'px';
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const height = Math.min(320, Math.max(below, above));
    dd.style.maxHeight = height + 'px';
    if (below < 200 && above > below) { dd.style.top = 'auto'; dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px'; }
    dd.style.display = 'flex'; dd.style.flexDirection = 'column';
    dd.addEventListener('click', function(event) { event.stopPropagation(); });
    dd.innerHTML = '<div style="padding:6px 10px;font-size:.72rem;color:var(--text-dim);border-bottom:1px solid var(--border)">' + t('gm_loading_branches') + '</div>';
    document.body.appendChild(dd);

    GM.api('/repo/branches?path=' + encodeURIComponent(repo.path)).then(function(data) {
      if (!dd.isConnected) return;
      dd.innerHTML = '';
      var search = document.createElement('input');
      search.type = 'search'; search.placeholder = t('gm_search_branches');
      search.setAttribute('aria-label', t('gm_search_branches'));
      search.style.cssText = 'box-sizing:border-box;width:calc(100% - 16px);margin:8px;padding:7px;flex-shrink:0;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:5px';
      var items = document.createElement('div');
      items.style.cssText = 'overflow-y:auto;min-height:0;overscroll-behavior:contain';
      dd.append(search, items);
      var empty = document.createElement('div');
      empty.textContent = t('gm_no_matching_branches'); empty.hidden = true;
      empty.style.cssText = 'padding:10px;font-size:.8rem;color:var(--text-dim)';
      dd.appendChild(empty);
      search.addEventListener('input', function() {
        var count = 0;
        items.querySelectorAll('[data-branch]').forEach(function(row) {
          var match = row.dataset.branch.toLowerCase().includes(search.value.trim().toLowerCase());
          row.style.display = match ? 'flex' : 'none'; if (match) count++;
        });
        empty.hidden = count > 0;
      });
      search.addEventListener('keydown', function(event) { if (event.key === 'Escape') { close(); btn.focus(); } });
      search.focus();
      data.branches.forEach(function(b) {
        var isRemote = b.startsWith('origin/');
        var label = isRemote ? GM.escape(b.replace('origin/', '')) + ' <span style="font-size:.68rem;opacity:.6">' + t('gm_remote_badge') + '</span>' : GM.escape(b);
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
              btn.innerHTML = '&#x1F33F; ' + GM.escape(r.branch) + ' &#x25BE;';
              if (out) { out.textContent = r.output || t('gm_switched_to', { branch: r.branch }); out.style.color = '#a6e3a1'; }
              GM.loadRepos();
              loadStatus();
            }).catch(function(e) {
              if (out) { out.style.display = 'block'; out.textContent = e.message; out.style.color = '#f38ba8'; }
            });
          });
        }
        row.dataset.branch = b;
        items.appendChild(row);
      });
    }).catch(function(e) {
      dd.innerHTML = '<div style="padding:8px 12px;color:#f38ba8;font-size:.82rem">' + e.message + '</div>';
    });

    var close = function() { dd.remove(); document.removeEventListener('click', close); };
    setTimeout(function() { document.addEventListener('click', close); }, 0);
  });

  var initialStatus = loadStatus();
  if (autoFetch) initialStatus.then(function() { doAction('fetch'); });
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
  category: 'Developer Tools',
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

// ── Public API for other apps (e.g. mvmAI's project file tree) to jump
//    straight into a specific repo, already selected and fetched ───────────
window.GitManager = {
  openRepo: function(path) {
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
    var tries = 0;
    var iv = setInterval(function() {
      tries++;
      var repo = (GM.state.repos || []).filter(function(r) { return r.path === path; })[0];
      if (repo) {
        clearInterval(iv);
        GM.state.activeRepo = repo;
        GM.renderSidebar();
        if (repo.locked) GM.showLockedRepo(GM.contentEl, repo);
        else GM.showRepoView(GM.contentEl, repo, true);
      } else if (tries > 40) {
        clearInterval(iv);
      }
    }, 50);
  }
};

}

if (window.GIT_MANAGER_I18N) {
  start();
} else {
  var i18nScript = document.createElement('script');
  i18nScript.src = '/apps/git-manager/i18n.js?_=' + Date.now();
  i18nScript.onload = start;
  i18nScript.onerror = start;
  document.head.appendChild(i18nScript);
}

})();
