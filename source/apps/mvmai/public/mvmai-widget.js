// mvmAI public chat page.
(function () {
  if (window.MvmaiWidget) return;

  var API = '/pub/mvmai';

  function t(key, vars) {
    var s = (window.t || function (k) { return k; })(key);
    if (vars) {
      for (var k in vars) s = s.replace('{' + k + '}', vars[k]);
    }
    return s;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  function nl2br(value) {
    return esc(value).replace(/\n/g, '<br>');
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = `
      .mvmai-widget,.mvmai-widget *{box-sizing:border-box}
      .mvmai-widget{height:100%;width:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);
        color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden;position:relative}
      .mvmai-chat-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
      /* Desktop mvmOS window: persistent side-by-side sidebar, never an off-canvas
         overlay — unlike the public page, which stays a mobile-style slide-over. */
      .mvmai-widget.mvmai-desktop{flex-direction:row}
      .mvmai-widget.mvmai-desktop .mvmai-sidebar-backdrop{display:none}
      .mvmai-widget.mvmai-desktop .mvmai-hist-btn{display:none}
      .mvmai-widget.mvmai-desktop .mvmai-sidebar{
        position:relative!important;top:auto;left:auto;bottom:auto;width:240px;max-width:240px;
        transform:none!important;box-shadow:none;border-right:1px solid var(--pub-border,#45475a)}
      .mvmai-login,.mvmai-error{display:flex;align-items:center;justify-content:center;height:100%;
        color:var(--pub-fg2,#a6adc8);text-align:center;padding:1.25rem}
      .mvmai-header{display:flex;align-items:center;gap:.6rem;padding:.75rem .9rem;flex-shrink:0;
        border-bottom:1px solid var(--pub-border,#45475a)}
      .mvmai-header-title{font-weight:700;font-size:1rem}
      .mvmai-badge{font-size:.68rem;font-weight:700;padding:.15rem .5rem;border-radius:1rem;
        background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);white-space:nowrap}
      .mvmai-price{margin-left:auto;font-size:.72rem;color:var(--pub-dim,#6c7086);white-space:nowrap}
      .mvmai-list{flex:1;min-height:0;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.7rem}
      .mvmai-welcome{color:var(--pub-fg2,#a6adc8);font-size:.85rem;text-align:center;margin:auto;padding:1rem}
      .mvmai-msg{max-width:85%;padding:.55rem .75rem;border-radius:.7rem;font-size:.88rem;line-height:1.45;
        overflow-wrap:anywhere;white-space:normal}
      .mvmai-msg.user{align-self:flex-end;background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
      .mvmai-msg.assistant{align-self:flex-start;background:var(--pub-surface2,#313244)}
      .mvmai-provider-label{margin-top:.45rem;padding-top:.35rem;border-top:1px solid rgba(255,255,255,.09);
        color:var(--pub-dim,#6c7086);font-size:.68rem;line-height:1.2}
      .mvmai-msg.system-note{align-self:center;background:none;color:var(--pub-dim,#6c7086);font-size:.78rem;
        text-align:center;max-width:100%}
      .mvmai-tool-card{align-self:flex-start;max-width:90%;background:var(--pub-crust,#2a2a3d);
        border:1px solid var(--pub-border,#45475a);border-radius:.6rem;padding:.6rem .75rem;font-size:.8rem}
      .mvmai-tool-card .mvmai-tool-head{font-weight:600;margin-bottom:.3rem;display:flex;gap:.4rem;align-items:center}
      .mvmai-tool-card .mvmai-tool-cmd{font-family:monospace;background:var(--pub-surface2,#313244);
        padding:.3rem .45rem;border-radius:.35rem;overflow-wrap:anywhere;margin-bottom:.3rem}
      .mvmai-tool-card .mvmai-tool-out{font-family:monospace;font-size:.74rem;white-space:pre-wrap;
        overflow-wrap:anywhere;max-height:14rem;overflow-y:auto;color:var(--pub-fg2,#a6adc8)}
      .mvmai-tool-card .mvmai-dangerous{color:var(--pub-red,#f38ba8)}
      .mvmai-confirm-row{display:flex;gap:.5rem;margin-top:.4rem}
      .mvmai-confirm-row button{border:0;border-radius:.4rem;padding:.35rem .8rem;font-size:.8rem;
        font-weight:600;cursor:pointer}
      .mvmai-confirm-yes{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
      .mvmai-confirm-no{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}
      .mvmai-inputbar{display:flex;gap:.5rem;padding:.75rem .9rem;flex-shrink:0;
        border-top:1px solid var(--pub-border,#45475a)}
      .mvmai-input{flex:1;resize:none;min-height:2.3rem;max-height:8rem;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.5rem .65rem;font:inherit;font-size:.88rem;outline:none}
      .mvmai-send{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border:0;border-radius:.5rem;
        padding:0 1rem;font-weight:700;cursor:pointer;font-size:.88rem}
      .mvmai-send:disabled{opacity:.5;cursor:default}
      .mvmai-typing{align-self:flex-start;color:var(--pub-dim,#6c7086);font-size:.82rem}
      .mvmai-hist-btn{background:none;border:0;color:inherit;font-size:1.15rem;cursor:pointer;padding:.15rem .35rem;
        border-radius:.4rem;line-height:1}
      .mvmai-hist-btn:hover{background:var(--pub-surface2,#313244)}
      .mvmai-sidebar-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.4);z-index:4;
        opacity:0;pointer-events:none;transition:opacity .18s ease}
      .mvmai-sidebar-backdrop.open{opacity:1;pointer-events:auto}
      .mvmai-sidebar{position:absolute;top:0;left:0;bottom:0;width:80%;max-width:280px;
        background:var(--pub-surface,#181825);border-right:1px solid var(--pub-border,#45475a);
        transform:translateX(-100%);transition:transform .18s ease;z-index:5;display:flex;flex-direction:column;
        overflow:hidden}
      .mvmai-sidebar.open{transform:translateX(0)}
      .mvmai-sidebar-head{padding:.7rem;border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0;
        display:flex;align-items:center;gap:.5rem}
      .mvmai-new-chat{flex:1;min-width:0;padding:.5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.84rem;
        font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-sidebar-list{flex:1;overflow-y:auto;padding:.4rem}
      .mvmai-session-row{display:flex;align-items:center;gap:.2rem;padding:.5rem .55rem;border-radius:.4rem;
        cursor:pointer;font-size:.82rem}
      .mvmai-session-row:hover,.mvmai-session-row.active{background:var(--pub-surface2,#313244)}
      .mvmai-session-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-session-edit{flex:1;min-width:0;padding:.28rem .4rem;border:1px solid var(--pub-accent,#89b4fa);
        border-radius:.3rem;background:var(--pub-bg,#1e1e2e);color:inherit;font:inherit;outline:none}
      .mvmai-session-row .mvmai-s-btn{opacity:.55;background:none;border:0;color:inherit;cursor:pointer;
        font-size:.82rem;padding:.15rem .3rem;flex-shrink:0}
      .mvmai-session-row .mvmai-s-btn:hover{opacity:1}
      .mvmai-no-sessions{color:var(--pub-dim,#6c7086);font-size:.78rem;padding:.7rem .5rem;text-align:center}
      .mvmai-exec-wrap{position:relative;flex:1;min-width:0}
      .mvmai-exec-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:.35rem;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;
        padding:.4rem .5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.78rem}
      .mvmai-exec-btn.on{border-color:var(--pub-accent,#89b4fa);color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-btn.auto{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border-color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-menu{position:absolute;top:calc(100% + .4rem);right:0;width:220px;max-width:80vw;z-index:6;
        background:var(--pub-surface,#181825);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.6rem;display:flex;flex-direction:column;gap:.5rem;font-size:.78rem}
      .mvmai-exec-menu[hidden]{display:none}
      .mvmai-exec-row{display:flex;align-items:flex-start;gap:.4rem;cursor:pointer;line-height:1.35}
      .mvmai-exec-row input{margin-top:.15rem;flex-shrink:0;cursor:pointer}
      .mvmai-exec-mode-wrap{display:flex;flex-direction:column;gap:.4rem;padding-top:.4rem;
        border-top:1px solid var(--pub-border,#45475a)}
      .mvmai-exec-mode-wrap[hidden]{display:none}
      .mvmai-exec-mode-label{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-projects-section{border-top:1px solid var(--pub-border,#45475a);padding-top:.4rem;margin-top:.4rem}
      .mvmai-projects-head{display:flex;align-items:center;justify-content:space-between;padding:.3rem .5rem;
        font-size:.68rem;font-weight:700;color:var(--pub-dim,#6c7086);text-transform:uppercase;letter-spacing:.05em}
      .mvmai-project-new-btn{background:none;border:0;color:inherit;font-size:1rem;cursor:pointer;padding:0 .3rem}
      .mvmai-project-row{display:flex;align-items:center;gap:.3rem;padding:.5rem .55rem;border-radius:.4rem;
        cursor:pointer;font-size:.82rem}
      .mvmai-project-row:hover,.mvmai-project-row.active{background:var(--pub-surface2,#313244)}
      .mvmai-project-row-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-project-row .mvmai-s-btn{opacity:.55;background:none;border:0;color:inherit;cursor:pointer;
        font-size:.82rem;padding:.15rem .3rem;flex-shrink:0}
      .mvmai-project-row .mvmai-s-btn:hover{opacity:1}
      .mvmai-project-badge{margin-left:auto;font-size:.68rem;color:var(--pub-dim,#6c7086);white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;max-width:40%}
      .mvmai-sidebar-project-header{display:flex;flex-direction:column;gap:.3rem;padding:.5rem .5rem .4rem;
        border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-sidebar-project-header[hidden]{display:none}
      .mvmai-sidebar-back{align-self:flex-start;background:none;border:0;color:var(--pub-accent,#89b4fa);
        cursor:pointer;font-size:.78rem;padding:.15rem .2rem}
      .mvmai-sidebar-project-title{font-size:.85rem;font-weight:700;padding:0 .2rem;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap}
      .mvmai-sidebar-filetree{flex-shrink:0;max-height:38%;overflow-y:auto;border-top:1px solid var(--pub-border,#45475a);
        padding:.4rem}
      .mvmai-sidebar-filetree:empty{display:none;border-top:none;padding:0}
      .mvmai-sidebar-filetree-branch{font-size:.7rem;color:var(--pub-dim,#6c7086);padding:.1rem .4rem .3rem;
        display:block;text-decoration:none}
      a.mvmai-sidebar-filetree-branch-link{color:var(--pub-accent,#89b4fa);cursor:pointer}
      a.mvmai-sidebar-filetree-branch-link:hover{text-decoration:underline}
      .mvmai-sidebar-filetree-hint{font-size:.66rem;color:var(--pub-dim,#6c7086);opacity:.75;
        padding:0 .4rem .3rem;font-style:italic}
      .mvmai-ft-dir,.mvmai-ft-file{display:flex;align-items:center;gap:.3rem;padding:.3rem .4rem;border-radius:.35rem;
        font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .mvmai-ft-dir{cursor:pointer}
      .mvmai-ft-dir:hover{background:var(--pub-surface2,#313244)}
      .mvmai-ft-name{flex:1;overflow:hidden;text-overflow:ellipsis}
      .mvmai-ft-children{padding-left:.7rem}
      .mvmai-ft-badge{font-size:.62rem;font-weight:700;padding:0 .3rem;border-radius:.3rem;flex-shrink:0}
      .mvmai-ft-badge.mvmai-ft-M{background:rgba(224,160,0,.2);color:#e0a000}
      .mvmai-ft-badge.mvmai-ft-A{background:rgba(76,174,90,.2);color:#4cae5a}
      .mvmai-ft-badge.mvmai-ft-D{background:rgba(226,85,85,.2);color:#e25555}
      .mvmai-ft-badge.mvmai-ft-U{background:rgba(127,127,127,.2);color:var(--pub-dim,#6c7086)}
      .mvmai-ft-badge.mvmai-ft-dir-badge{background:rgba(224,160,0,.25);color:#e0a000;border-radius:1rem;
        min-width:1.1em;text-align:center}
      .mvmai-browse-row{padding:.5rem .55rem;cursor:pointer;font-size:.82rem;border-radius:.4rem}
      .mvmai-browse-row:hover{background:var(--pub-surface2,#313244)}
      .mvmai-pub-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:20;display:flex;
        align-items:center;justify-content:center}
      .mvmai-pub-dialog{background:var(--pub-surface,#181825);border:1px solid var(--pub-border,#45475a);
        border-radius:.6rem;padding:1rem;width:88%;max-width:340px;max-height:75%;display:flex;flex-direction:column;
        gap:.6rem;overflow:hidden}
      .mvmai-pub-dialog-title{font-weight:700;font-size:.92rem}
      .mvmai-pub-dialog input,.mvmai-pub-dialog textarea{width:100%;box-sizing:border-box;background:var(--pub-surface2,#313244);
        color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:.4rem;
        padding:.4rem .55rem;font:inherit;font-size:.84rem}
      .mvmai-pub-dialog textarea{resize:vertical}
      .mvmai-pub-dialog-list{flex:1;overflow-y:auto;min-height:120px;border:1px solid var(--pub-border,#45475a);
        border-radius:.4rem}
      .mvmai-pub-dialog-path{font-size:.72rem;color:var(--pub-dim,#6c7086);font-family:monospace;overflow-wrap:anywhere}
      .mvmai-pub-dialog-hint{font-size:.72rem;color:var(--pub-dim,#6c7086)}
      .mvmai-pub-dialog-err{color:var(--pub-red,#f38ba8);font-size:.78rem}
      .mvmai-pub-dialog-actions{display:flex;gap:.5rem;justify-content:flex-end}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    var token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = '<div class="mvmai-login">' + esc(t('mvmai_pub_login_required')) + '</div>';
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy: function () {} };
    }

    var isDesktop = !!opts.isDesktopApp;
    var me = null;
    var history = [];       // {role, content, tool_calls?, tool_call_id?}
    var sending = false;
    var sessionId = null;
    var projects = [];
    var activeProject = null;   // {id, name, path} — fixed at session creation
    var sessionsCache = [];
    var projectPoll = null;

    function api(path, options) {
      options = options || {};
      var headers = Object.assign(
        {'X-Pub-Token': token, 'Content-Type': 'application/json'},
        options.headers || {}
      );
      return fetch(API + path, Object.assign({}, options, {headers: headers})).then(async function (response) {
        var data = await response.json().catch(function () { return {}; });
        if (response.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        data.__status = response.status;
        return data;
      });
    }

    root.innerHTML = '<div class="mvmai-error">' + esc(t('mvmai_pub_thinking')) + '</div>';

    api('/me').then(function (data) {
      if (data.__status !== 200) {
        root.innerHTML = '<div class="mvmai-error">' + esc(t('mvmai_pub_unauthorized')) + '</div>';
        return;
      }
      me = data;
      renderShell();
    });

    function renderShell() {
      var priceHint = '';
      if (me.credit_price) {
        priceHint = '<div class="mvmai-price">' + esc(t('mvmai_pub_price_hint', {
          price: me.credit_price, balance: me.credit_balance
        })) + '</div>';
      }
      root.innerHTML = `<div class="mvmai-widget${isDesktop ? ' mvmai-desktop' : ''}">
        <div class="mvmai-sidebar-backdrop"></div>
        <div class="mvmai-sidebar">
          <div class="mvmai-sidebar-head">
            <button class="mvmai-new-chat">+ ${esc(t('mvmai_pub_new_chat'))}</button>
            ${me.is_admin ? `<div class="mvmai-exec-wrap">
              <button class="mvmai-exec-btn" type="button"><span>⚡</span><span class="mvmai-exec-state"></span></button>
              <div class="mvmai-exec-menu" hidden>
                <div class="mvmai-exec-mode-label">${esc(t('mvmai_pub_exec_mode_label'))}</div>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="readonly"> ${esc(t('mvmai_pub_exec_off'))}</label>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="confirm"> ${esc(t('mvmai_pub_exec_mode_confirm'))}</label>
                <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="auto"> ${esc(t('mvmai_pub_exec_mode_auto'))}</label>
              </div>
            </div>` : ''}
          </div>
          <div class="mvmai-sidebar-project-header" hidden>
            <button class="mvmai-sidebar-back" type="button">← ${esc(t('mvmai_pub_all_chats'))}</button>
            <span class="mvmai-sidebar-project-title"></span>
          </div>
          <div class="mvmai-sidebar-list"></div>
          <div class="mvmai-sidebar-filetree"></div>
          ${me.is_admin ? `<div class="mvmai-projects-section">
            <div class="mvmai-projects-head">
              <span>${esc(t('mvmai_pub_projects_title'))}</span>
              <button class="mvmai-project-new-btn" type="button" title="${esc(t('mvmai_pub_new_project'))}">+</button>
            </div>
            <div class="mvmai-projects-list"></div>
          </div>` : ''}
        </div>
        <div class="mvmai-chat-col">
          <div class="mvmai-header">
            <button class="mvmai-hist-btn" title="${esc(t('mvmai_pub_history'))}">🕘</button>
            <span class="mvmai-header-title">🤖 ${esc(t('mvmai_pub_title'))}</span>
            ${me.is_admin ? '<span class="mvmai-badge">' + esc(t('mvmai_pub_admin_badge')) + '</span>' : ''}
            <span class="mvmai-project-badge" hidden></span>
            ${priceHint}
          </div>
          <div class="mvmai-list"></div>
          <div class="mvmai-inputbar">
            <textarea class="mvmai-input" rows="1" placeholder="${esc(t('mvmai_pub_placeholder'))}"></textarea>
            <button class="mvmai-send">${esc(t('mvmai_pub_send'))}</button>
          </div>
        </div>
      </div>`;

      var listEl = root.querySelector('.mvmai-list');
      var inputEl = root.querySelector('.mvmai-input');
      var sendEl = root.querySelector('.mvmai-send');
      var sidebarEl = root.querySelector('.mvmai-sidebar');
      var backdropEl = root.querySelector('.mvmai-sidebar-backdrop');
      var sidebarListEl = root.querySelector('.mvmai-sidebar-list');
      var histBtn = root.querySelector('.mvmai-hist-btn');
      var newChatBtn = root.querySelector('.mvmai-new-chat');

      if (me.is_admin) {
        var execWrap = root.querySelector('.mvmai-exec-wrap');
        var execBtn = root.querySelector('.mvmai-exec-btn');
        var execMenu = root.querySelector('.mvmai-exec-menu');
        var execState = { enabled: false, auto: false };

        function renderExecBtn() {
          execBtn.classList.toggle('on', execState.enabled && !execState.auto);
          execBtn.classList.toggle('auto', execState.enabled && execState.auto);
          execBtn.querySelector('.mvmai-exec-state').textContent = !execState.enabled
            ? t('mvmai_pub_exec_off') : (execState.auto ? t('mvmai_pub_exec_auto_short') : t('mvmai_pub_exec_confirm'));
          var mode = !execState.enabled ? 'readonly' : (execState.auto ? 'auto' : 'confirm');
          var radio = execMenu.querySelector('input[name="mvmai-pub-exec-mode"][value="' + mode + '"]');
          if (radio) radio.checked = true;
        }

        function saveExecMode(mode) {
          execState.enabled = mode !== 'readonly';
          execState.auto = mode === 'auto';
          renderExecBtn();
          api('/exec-settings', {method: 'POST', body: JSON.stringify({enabled: execState.enabled, auto: execState.auto})});
        }

        api('/exec-settings').then(function (data) {
          if (data.__status !== 200) return;
          execState.enabled = !!data.enabled;
          execState.auto = !!data.auto;
          renderExecBtn();
        });

        execBtn.onclick = function (e) { e.stopPropagation(); execMenu.hidden = !execMenu.hidden; };
        document.addEventListener('click', function (e) { if (!execWrap.contains(e.target)) execMenu.hidden = true; });
        execMenu.querySelectorAll('input[name="mvmai-pub-exec-mode"]').forEach(function (r) {
          r.addEventListener('change', function (e) { if (e.target.checked) saveExecMode(e.target.value); });
        });
      }

      var projectsListEl = root.querySelector('.mvmai-projects-list');
      var projectBadgeEl = root.querySelector('.mvmai-project-badge');
      var newProjectBtn = root.querySelector('.mvmai-project-new-btn');

      var sidebarProjectHeaderEl = root.querySelector('.mvmai-sidebar-project-header');
      var sidebarFiletreeEl = root.querySelector('.mvmai-sidebar-filetree');
      var projectsSectionEl = root.querySelector('.mvmai-projects-section');

      function updateProjectBadge() {
        if (!projectBadgeEl) return;
        if (!activeProject) { projectBadgeEl.hidden = true; return; }
        projectBadgeEl.hidden = false;
        projectBadgeEl.textContent = '📁 ' + activeProject.name;
      }

      function renderProjects() {
        if (!projectsListEl) return;
        if (!projects.length) {
          projectsListEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_projects')) + '</div>';
          return;
        }
        projectsListEl.innerHTML = '';
        projects.forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'mvmai-project-row';
          row.innerHTML =
            '<span class="mvmai-project-row-title"></span>' +
            '<button class="mvmai-s-btn mvmai-project-edit-btn" title="' + esc(t('mvmai_pub_edit')) + '">✎</button>' +
            '<button class="mvmai-s-btn mvmai-project-del-btn" title="' + esc(t('mvmai_pub_delete')) + '">🗑</button>';
          row.querySelector('.mvmai-project-row-title').textContent = p.name;
          row.onclick = function () { enterProjectView(p); };
          row.querySelector('.mvmai-project-edit-btn').onclick = function (e) {
            e.stopPropagation();
            showEditProjectDialog(p);
          };
          row.querySelector('.mvmai-project-del-btn').onclick = function (e) {
            e.stopPropagation();
            if (!confirm(t('mvmai_pub_project_del_confirm'))) return;
            api('/projects/' + p.id, {method: 'DELETE'}).then(function () {
              if (activeProject && activeProject.id === p.id) exitProjectView();
              loadProjects();
            });
          };
          projectsListEl.appendChild(row);
        });
      }

      function loadProjects() {
        return api('/projects').then(function (data) {
          if (data.__status !== 200) return;
          projects = data.projects || [];
          renderProjects();
        });
      }

      function enterProjectView(p) {
        activeProject = p;
        sidebarProjectHeaderEl.hidden = false;
        sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + p.name;
        if (projectsSectionEl) projectsSectionEl.hidden = true;
        updateProjectBadge();
        refreshSessionList();
        renderInlineFileTree();
      }

      function exitProjectView() {
        activeProject = null;
        sidebarProjectHeaderEl.hidden = true;
        if (projectsSectionEl) projectsSectionEl.hidden = false;
        if (sidebarFiletreeEl) sidebarFiletreeEl.innerHTML = '';
        updateProjectBadge();
        refreshSessionList();
      }

      sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-back').onclick = exitProjectView;

      function fillDir(dirPath, container, statusMap, rootPath) {
        fetch('/api/files?path=' + encodeURIComponent(dirPath), {headers: {'X-Pub-Token': token}})
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var entries = (data.entries || data.files || data || []).filter(function (f) { return f.name.indexOf('.') !== 0; });
            entries.sort(function (a, b) {
              if ((a.type === 'dir') !== (b.type === 'dir')) return a.type === 'dir' ? -1 : 1;
              return a.name.localeCompare(b.name);
            });
            container.innerHTML = '';
            entries.forEach(function (f) {
              var full = dirPath.replace(/\/$/, '') + '/' + f.name;
              var rel = full.slice(rootPath.length + 1);
              var row = document.createElement('div');
              row.className = f.type === 'dir' ? 'mvmai-ft-dir' : 'mvmai-ft-file';
              var badge = '';
              if (f.type === 'dir') {
                var prefix = rel + '/';
                var changeCount = Object.keys(statusMap).filter(function (k) { return k.indexOf(prefix) === 0; }).length;
                if (changeCount) badge = '<span class="mvmai-ft-badge mvmai-ft-dir-badge" title="' + changeCount + '">' + changeCount + '</span>';
              } else if (statusMap[rel]) {
                badge = '<span class="mvmai-ft-badge mvmai-ft-' + statusMap[rel] + '">' + statusMap[rel] + '</span>';
              }
              row.innerHTML = '<span class="mvmai-ft-name">' + (f.type === 'dir' ? '📁' : '📄') + ' ' + esc(f.name) + '</span>' + badge;
              if (f.type === 'dir') {
                row.addEventListener('click', function () {
                  var next = row.nextElementSibling;
                  if (next && next.classList.contains('mvmai-ft-children')) { next.remove(); return; }
                  var sub = document.createElement('div');
                  sub.className = 'mvmai-ft-children';
                  row.after(sub);
                  fillDir(full, sub, statusMap, rootPath);
                });
              } else if (typeof CodeEditor !== 'undefined') {
                // Only present inside the mvmOS desktop shell — the public
                // page never loads codeeditor.js, so this stays read-only there.
                row.style.cursor = 'pointer';
                row.addEventListener('click', function () { CodeEditor.openFile(full); });
              }
              container.appendChild(row);
            });
            if (!entries.length) container.innerHTML = '<div class="mvmai-no-sessions">∅</div>';
          });
      }

      var lastGitSignature = '';
      var gitPending = false;
      projectPoll = setInterval(function () {
        if (!root.isConnected) { clearInterval(projectPoll); return; }
        if (!document.hidden && activeProject && !gitPending) renderInlineFileTree(true);
      }, 5000);

      function renderInlineFileTree(quiet) {
        if (!sidebarFiletreeEl) return;
        if (!activeProject || !activeProject.path) { sidebarFiletreeEl.innerHTML = ''; return; }
        var project = activeProject;
        if (!quiet) sidebarFiletreeEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_loading')) + '</div>';
        gitPending = true;
        api('/projects/' + project.id + '/git-status').then(function (git) {
          if (!activeProject || activeProject.id !== project.id || !root.isConnected) return;
          var signature = project.id + JSON.stringify(git);
          if (quiet && signature === lastGitSignature) return;
          lastGitSignature = signature;
          var statusMap = {};
          ((git && git.added) || []).forEach(function (f) { statusMap[f] = 'A'; });
          ((git && git.modified) || []).forEach(function (f) { statusMap[f] = 'M'; });
          ((git && git.deleted) || []).forEach(function (f) { statusMap[f] = 'D'; });
          ((git && git.untracked) || []).forEach(function (f) { statusMap[f] = 'U'; });
          var branchLabel = git.error ? t('mvmai_pub_git_error') : git && git.is_repo ? ('⎇ ' + git.branch) : t('mvmai_pub_git_not_repo');
          var hasGitManager = typeof GitManager !== 'undefined';
          var canOpenGitManager = git && git.is_repo && hasGitManager;
          var showInstallHint = git && git.is_repo && !hasGitManager;
          sidebarFiletreeEl.innerHTML =
            (canOpenGitManager
              ? '<a href="#" class="mvmai-sidebar-filetree-branch mvmai-sidebar-filetree-branch-link">' + esc(branchLabel) + '</a>'
              : '<div class="mvmai-sidebar-filetree-branch">' + esc(branchLabel) + '</div>') +
            (showInstallHint ? '<div class="mvmai-sidebar-filetree-hint">' + esc(t('mvmai_pub_install_git_manager_hint')) + '</div>' : '') +
            '<div class="mvmai-sidebar-filetree-body"></div>';
          if (canOpenGitManager) {
            var branchLink = sidebarFiletreeEl.querySelector('.mvmai-sidebar-filetree-branch-link');
            var repoPath = activeProject.path;
            branchLink.addEventListener('click', function (e) {
              e.preventDefault();
              GitManager.openRepo(repoPath);
            });
          }
          fillDir(project.path, sidebarFiletreeEl.querySelector('.mvmai-sidebar-filetree-body'), statusMap, project.path);
        }).catch(function () { lastGitSignature = ''; }).finally(function () { gitPending = false; });
      }

      function showFolderPicker(startPath, onSelect) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_browse_title')) + '</div>' +
          '<div class="mvmai-pub-dialog-path"></div>' +
          '<div class="mvmai-pub-dialog-list"></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes">' + esc(t('mvmai_pub_browse_select')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var pathEl = backdrop.querySelector('.mvmai-pub-dialog-path');
        var listEl2 = backdrop.querySelector('.mvmai-pub-dialog-list');
        var current = startPath || '/';

        function load(path) {
          api('/browse?path=' + encodeURIComponent(path)).then(function (data) {
            if (data.__status !== 200) return;
            current = data.path;
            pathEl.textContent = current;
            listEl2.innerHTML = '';
            if (data.parent) {
              var up = document.createElement('div');
              up.className = 'mvmai-browse-row';
              up.textContent = t('mvmai_pub_browse_up');
              up.onclick = function () { load(data.parent); };
              listEl2.appendChild(up);
            }
            (data.dirs || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📁 ' + name;
              row.onclick = function () { load(current.replace(/\/$/, '') + '/' + name); };
              listEl2.appendChild(row);
            });
          });
        }
        load(current);

        backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-confirm-yes').onclick = function () { onSelect(current); backdrop.remove(); };
      }

      // Same browse endpoint, but files are selectable too (used for picking
      // an instructions file such as CLAUDE.md) — folders are only for navigating.
      function showFilePicker(startPath, onSelect) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_browse_title')) + '</div>' +
          '<div class="mvmai-pub-dialog-path"></div>' +
          '<div class="mvmai-pub-dialog-list"></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var pathEl = backdrop.querySelector('.mvmai-pub-dialog-path');
        var listEl2 = backdrop.querySelector('.mvmai-pub-dialog-list');
        var current = startPath || '/';

        function load(path) {
          api('/browse?path=' + encodeURIComponent(path)).then(function (data) {
            if (data.__status !== 200) return;
            current = data.path;
            pathEl.textContent = current;
            listEl2.innerHTML = '';
            if (data.parent) {
              var up = document.createElement('div');
              up.className = 'mvmai-browse-row';
              up.textContent = t('mvmai_pub_browse_up');
              up.onclick = function () { load(data.parent); };
              listEl2.appendChild(up);
            }
            (data.dirs || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📁 ' + name;
              row.onclick = function () { load(current.replace(/\/$/, '') + '/' + name); };
              listEl2.appendChild(row);
            });
            (data.files || []).forEach(function (name) {
              var row = document.createElement('div');
              row.className = 'mvmai-browse-row';
              row.textContent = '📄 ' + name;
              row.onclick = function () {
                onSelect(current.replace(/\/$/, '') + '/' + name);
                backdrop.remove();
              };
              listEl2.appendChild(row);
            });
          });
        }
        load(current);

        backdrop.querySelector('.mvmai-confirm-no').onclick = function () { backdrop.remove(); };
      }

      function showNewProjectDialog() {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_new_project')) + '</div>' +
          '<input class="mvmai-proj-name-input" placeholder="' + esc(t('mvmai_pub_project_name_label')) + '">' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-path-input" placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '" readonly style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '</div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_project_path_hint')) + '</div>' +
          '<div class="mvmai-pub-dialog-err" hidden></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no mvmai-proj-cancel-btn">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes mvmai-proj-create-btn">' + esc(t('mvmai_pub_project_create')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var nameInput = backdrop.querySelector('.mvmai-proj-name-input');
        var pathInput = backdrop.querySelector('.mvmai-proj-path-input');
        var errEl = backdrop.querySelector('.mvmai-pub-dialog-err');
        backdrop.querySelector('.mvmai-proj-cancel-btn').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-proj-browse-btn').onclick = function () {
          showFolderPicker(pathInput.value || '/', function (chosen) { pathInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-create-btn').onclick = function () {
          var name = nameInput.value.trim();
          var path = pathInput.value.trim();
          if (!name) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_project_name_required'); return; }
          this.disabled = true; this.textContent = t('mvmai_pub_project_creating');
          var btn = this;
          api('/projects', {method: 'POST', body: JSON.stringify({name: name, path: path})}).then(function (data) {
            if (data.__status !== 200) {
              errEl.hidden = false; errEl.textContent = data.error || 'Error';
              btn.disabled = false; btn.textContent = t('mvmai_pub_project_create');
              return;
            }
            backdrop.remove();
            loadProjects();
          });
        };
      }

      function showEditProjectDialog(p) {
        var backdrop = document.createElement('div');
        backdrop.className = 'mvmai-pub-dialog-backdrop';
        backdrop.innerHTML =
          '<div class="mvmai-pub-dialog" style="max-width:400px">' +
          '<div class="mvmai-pub-dialog-title">' + esc(t('mvmai_pub_edit_project')) + '</div>' +
          '<input class="mvmai-proj-name-input" placeholder="' + esc(t('mvmai_pub_project_name_label')) + '">' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-path-input" placeholder="' + esc(t('mvmai_pub_project_path_optional')) + '" readonly style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button class="mvmai-confirm-no mvmai-proj-path-clear-btn" title="' + esc(t('mvmai_pub_clear')) + '" style="flex-shrink:0">✕</button>' +
          '</div>' +
          '<textarea class="mvmai-proj-instructions-input" rows="4" placeholder="' + esc(t('mvmai_pub_instructions_label')) + '"></textarea>' +
          '<div style="display:flex;gap:.4rem">' +
          '<input class="mvmai-proj-instr-file-input" placeholder="' + esc(t('mvmai_pub_instructions_file_label')) + '" readonly style="flex:1">' +
          '<button class="mvmai-confirm-no mvmai-proj-file-browse-btn" style="flex-shrink:0">' + esc(t('mvmai_pub_project_browse')) + '</button>' +
          '<button class="mvmai-confirm-no mvmai-proj-file-clear-btn" title="' + esc(t('mvmai_pub_clear')) + '" style="flex-shrink:0">✕</button>' +
          '</div>' +
          '<div class="mvmai-pub-dialog-hint">' + esc(t('mvmai_pub_instructions_hint')) + '</div>' +
          '<div class="mvmai-pub-dialog-err" hidden></div>' +
          '<div class="mvmai-pub-dialog-actions">' +
          '<button class="mvmai-confirm-no mvmai-proj-cancel-btn">' + esc(t('mvmai_pub_cancel')) + '</button>' +
          '<button class="mvmai-confirm-yes mvmai-proj-save-btn">' + esc(t('mvmai_pub_save')) + '</button>' +
          '</div></div>';
        document.body.appendChild(backdrop);
        var nameInput = backdrop.querySelector('.mvmai-proj-name-input');
        var pathInput = backdrop.querySelector('.mvmai-proj-path-input');
        var instrInput = backdrop.querySelector('.mvmai-proj-instructions-input');
        var fileInput = backdrop.querySelector('.mvmai-proj-instr-file-input');
        var errEl = backdrop.querySelector('.mvmai-pub-dialog-err');
        nameInput.value = p.name || '';
        pathInput.value = p.path || '';
        instrInput.value = p.instructions || '';
        fileInput.value = p.instructions_file || '';

        backdrop.querySelector('.mvmai-proj-cancel-btn').onclick = function () { backdrop.remove(); };
        backdrop.querySelector('.mvmai-proj-browse-btn').onclick = function () {
          showFolderPicker(pathInput.value || '/', function (chosen) { pathInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-path-clear-btn').onclick = function () { pathInput.value = ''; };
        backdrop.querySelector('.mvmai-proj-file-browse-btn').onclick = function () {
          showFilePicker(pathInput.value || '/', function (chosen) { fileInput.value = chosen; });
        };
        backdrop.querySelector('.mvmai-proj-file-clear-btn').onclick = function () { fileInput.value = ''; };
        backdrop.querySelector('.mvmai-proj-save-btn').onclick = function () {
          var name = nameInput.value.trim();
          if (!name) { errEl.hidden = false; errEl.textContent = t('mvmai_pub_project_name_required'); return; }
          this.disabled = true; this.textContent = t('mvmai_pub_project_creating');
          var btn = this;
          api('/projects/' + p.id, {method: 'PATCH', body: JSON.stringify({
            name: name, path: pathInput.value.trim(),
            instructions: instrInput.value, instructions_file: fileInput.value.trim(),
          })}).then(function (data) {
            if (data.__status !== 200) {
              errEl.hidden = false; errEl.textContent = data.error || 'Error';
              btn.disabled = false; btn.textContent = t('mvmai_pub_save');
              return;
            }
            backdrop.remove();
            if (activeProject && activeProject.id === p.id) {
              activeProject = data.project;
              sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + data.project.name;
              renderInlineFileTree();
              updateProjectBadge();
            }
            loadProjects();
          });
        };
      }

      if (me.is_admin && newProjectBtn) {
        newProjectBtn.onclick = showNewProjectDialog;
        loadProjects();
      }

      function showWelcome() {
        var welcomeKey = me.is_admin ? 'mvmai_pub_welcome_admin'
          : (me.has_api_bridge ? 'mvmai_pub_welcome_user_bridge' : 'mvmai_pub_welcome_user_plain');
        listEl.innerHTML = '<div class="mvmai-welcome">' + esc(t(welcomeKey)) + '</div>';
      }
      showWelcome();

      function scrollDown() { listEl.scrollTop = listEl.scrollHeight; }

      function openSidebar() { sidebarEl.classList.add('open'); backdropEl.classList.add('open'); }
      function closeSidebar() { sidebarEl.classList.remove('open'); backdropEl.classList.remove('open'); }
      histBtn.onclick = function () { openSidebar(); refreshSessionList(); };
      backdropEl.onclick = closeSidebar;

      function refreshSessionList() {
        return api('/sessions').then(function (data) {
          if (data.__status !== 200) return;
          sessionsCache = data.sessions || [];
          var sessions = activeProject
            ? sessionsCache.filter(function (s) { return s.project_id === activeProject.id; })
            : sessionsCache;
          if (!sessions.length) {
            sidebarListEl.innerHTML = '<div class="mvmai-no-sessions">' + esc(t('mvmai_pub_no_sessions')) + '</div>';
            return;
          }
          sidebarListEl.innerHTML = '';
          sessions.forEach(function (s) {
            var row = document.createElement('div');
            row.className = 'mvmai-session-row' + (s.id === sessionId ? ' active' : '');
            row.innerHTML =
              '<span class="mvmai-session-title"></span>' +
              '<button class="mvmai-s-btn mvmai-s-rename" title="' + esc(t('mvmai_pub_rename')) + '">✎</button>' +
              '<button class="mvmai-s-btn mvmai-s-delete" title="' + esc(t('mvmai_pub_delete')) + '">🗑</button>';
            row.querySelector('.mvmai-session-title').textContent = s.title || t('mvmai_pub_new_chat');
            row.onclick = function () { openSession(s.id); };
            row.querySelector('.mvmai-s-rename').onclick = function (e) {
              e.stopPropagation();
              var titleEl = row.querySelector('.mvmai-session-title');
              var input = document.createElement('input');
              var finished = false;
              input.className = 'mvmai-session-edit';
              input.type = 'text';
              input.maxLength = 120;
              input.value = s.title || '';
              input.setAttribute('aria-label', t('mvmai_pub_rename'));
              titleEl.replaceWith(input);
              input.focus();
              input.select();

              function finish(save) {
                if (finished) return;
                finished = true;
                var next = input.value.trim();
                if (!save || !next || next === (s.title || '')) {
                  refreshSessionList();
                  return;
                }
                api('/sessions/' + encodeURIComponent(s.id), {
                  method: 'PATCH',
                  body: JSON.stringify({title: next})
                }).then(function () { refreshSessionList(); });
              }

              input.addEventListener('click', function (event) { event.stopPropagation(); });
              input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  finish(true);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  finish(false);
                }
              });
              input.addEventListener('blur', function () { finish(true); });
            };
            row.querySelector('.mvmai-s-delete').onclick = function (e) {
              e.stopPropagation();
              if (!confirm(t('mvmai_pub_delete_confirm'))) return;
              api('/sessions/' + s.id, {method: 'DELETE'}).then(function () {
                if (s.id === sessionId) { sessionId = null; history = []; showWelcome(); }
                refreshSessionList();
              });
            };
            sidebarListEl.appendChild(row);
          });
        });
      }

      function openSession(id) {
        api('/sessions/' + id + '/messages').then(function (data) {
          if (data.__status !== 200) return;
          sessionId = id;
          var row = sessionsCache.filter(function (s) { return s.id === id; })[0];
          var pid = row && row.project_id;
          activeProject = pid ? (projects.filter(function (p) { return p.id === pid; })[0] || {id: pid, name: pid, path: ''}) : null;
          if (activeProject) {
            sidebarProjectHeaderEl.hidden = false;
            sidebarProjectHeaderEl.querySelector('.mvmai-sidebar-project-title').textContent = '📁 ' + activeProject.name;
            if (projectsSectionEl) projectsSectionEl.hidden = true;
            renderInlineFileTree();
          } else {
            sidebarProjectHeaderEl.hidden = true;
            if (projectsSectionEl) projectsSectionEl.hidden = false;
            if (sidebarFiletreeEl) sidebarFiletreeEl.innerHTML = '';
          }
          updateProjectBadge();
          history = data.messages || [];
          listEl.innerHTML = '';
          var any = false;
          history.forEach(function (m) {
            if ((m.role === 'user' || m.role === 'assistant') && m.content) {
              addBubble(m.role, m.content);
              any = true;
            }
          });
          if (!any) showWelcome();
          closeSidebar();
          refreshSessionList();
        });
      }

      newChatBtn.onclick = function () {
        sessionId = null;
        history = [];
        showWelcome();
        closeSidebar();
        refreshSessionList();
      };

      refreshSessionList();

      function addBubble(role, content) {
        var el = document.createElement('div');
        el.className = 'mvmai-msg ' + role;
        el.innerHTML = nl2br(content);
        if (role === 'assistant' && me.is_admin && me.provider_label) {
          var providerEl = document.createElement('div');
          providerEl.className = 'mvmai-provider-label';
          providerEl.textContent = me.provider_label;
          el.appendChild(providerEl);
        }
        listEl.appendChild(el);
        scrollDown();
        return el;
      }

      function addNote(text) {
        var el = document.createElement('div');
        el.className = 'mvmai-msg system-note';
        el.textContent = text;
        listEl.appendChild(el);
        scrollDown();
      }

      function addTyping() {
        var el = document.createElement('div');
        el.className = 'mvmai-typing';
        el.textContent = t('mvmai_pub_thinking');
        listEl.appendChild(el);
        scrollDown();
        return el;
      }

      function parseArgs(raw) {
        try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
      }

      function runToolCall(call) {
        var name = call.function && call.function.name;
        var args = parseArgs(call.function && call.function.arguments);

        if (name === 'run_command') {
          return runCommandCall(args).then(function (resultText) {
            return {role: 'tool', tool_call_id: call.id, content: resultText};
          });
        }

        if (name === 'inspect_server') {
          return inspectServerCall(args).then(function (resultText) {
            return {role: 'tool', tool_call_id: call.id, content: resultText};
          });
        }

        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        card.innerHTML = '<div class="mvmai-tool-head">🔧 ' + esc(t('mvmai_pub_using_tool', {name: name})) + '</div>';
        listEl.appendChild(card);
        scrollDown();

        return api('/tool-call', {method: 'POST', body: JSON.stringify({name: name, arguments: args})})
          .then(function (data) {
            var content;
            if (data.__status === 200) {
              content = JSON.stringify(data.result);
            } else {
              content = JSON.stringify({error: data.error || t('mvmai_pub_not_available')});
              var out = document.createElement('div');
              out.className = 'mvmai-tool-out';
              out.textContent = data.error === 'not_available' ? t('mvmai_pub_not_available') : (data.error || '');
              card.appendChild(out);
            }
            return {role: 'tool', tool_call_id: call.id, content: content};
          });
      }

      function inspectServerCall(args) {
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        card.innerHTML =
          '<div class="mvmai-tool-head">🔎 ' + esc(t('mvmai_pub_using_tool', {name: 'inspect_server'})) + '</div>' +
          '<div class="mvmai-tool-cmd">' + esc(args.command || '') + '</div>';
        listEl.appendChild(card);
        scrollDown();
        return api('/inspect', {method: 'POST', body: JSON.stringify({
          command: args.command || '', reason: args.reason || '', project_id: activeProject ? activeProject.id : null
        })}).then(function (data) {
          var content = data.__status === 200 ? JSON.stringify(data.result) : JSON.stringify({error: data.error || 'forbidden'});
          var out = document.createElement('div');
          out.className = 'mvmai-tool-out';
          out.textContent = data.__status === 200 ? JSON.stringify(data.result, null, 2) : (data.error || 'forbidden');
          card.appendChild(out);
          scrollDown();
          return content;
        });
      }

      function runCommandCall(args) {
        var card = document.createElement('div');
        card.className = 'mvmai-tool-card';
        card.innerHTML =
          '<div class="mvmai-tool-head">▶ ' + esc(t('mvmai_pub_cmd_label')) + '</div>' +
          '<div class="mvmai-tool-cmd">' + esc(args.command || '') + '</div>' +
          (args.reason ? '<div style="color:var(--pub-dim,#6c7086);font-size:.76rem;margin-bottom:.3rem">' +
            esc(t('mvmai_pub_reason_label')) + ': ' + esc(args.reason) + '</div>' : '');
        listEl.appendChild(card);
        scrollDown();

        function exec(confirmed) {
          return api('/exec', {method: 'POST', body: JSON.stringify({command: args.command, confirmed: confirmed, project_id: activeProject ? activeProject.id : null})});
        }

        function renderResult(data) {
          if (data.blocked) {
            var b = document.createElement('div');
            b.className = 'mvmai-dangerous';
            b.textContent = t('mvmai_pub_blocked') + ': ' + (data.reason || '');
            card.appendChild(b);
            return t('mvmai_pub_blocked') + ': ' + (data.reason || '');
          }
          var out = document.createElement('div');
          out.className = 'mvmai-tool-out';
          out.textContent =
            (data.stdout || '') + (data.stderr ? '\n' + data.stderr : '') +
            '\n[' + t('mvmai_pub_exit_code') + ' ' + data.code + ']';
          card.appendChild(out);
          return JSON.stringify({stdout: data.stdout, stderr: data.stderr, code: data.code});
        }

        return exec(false).then(function (data) {
          if (data.pending) {
            return new Promise(function (resolve) {
              var row = document.createElement('div');
              row.className = 'mvmai-confirm-row';
              if (data.is_dangerous) {
                var warn = document.createElement('div');
                warn.className = 'mvmai-dangerous';
                warn.textContent = t('mvmai_pub_dangerous');
                card.appendChild(warn);
              }
              var q = document.createElement('div');
              q.textContent = t('mvmai_pub_run_q');
              card.appendChild(q);
              var yes = document.createElement('button');
              yes.className = 'mvmai-confirm-yes';
              yes.textContent = t('mvmai_pub_run_yes');
              var no = document.createElement('button');
              no.className = 'mvmai-confirm-no';
              no.textContent = t('mvmai_pub_run_no');
              row.appendChild(yes);
              row.appendChild(no);
              card.appendChild(row);
              scrollDown();
              yes.onclick = function () {
                row.remove();
                exec(true).then(function (result) { resolve(renderResult(result)); });
              };
              no.onclick = function () {
                row.remove();
                var cancelled = document.createElement('div');
                cancelled.textContent = t('mvmai_pub_cancelled');
                card.appendChild(cancelled);
                resolve(t('mvmai_pub_cancelled'));
              };
            });
          }
          return renderResult(data);
        });
      }

      // ── history compaction ─────────────────────────────────────────────────────
      // Once a chat grows past COMPACT_THRESHOLD messages, fold everything except
      // the most recent 20 into a single running summary, so token cost per
      // message stays bounded instead of re-sending the whole conversation
      // forever. no_persist:true keeps this maintenance call off the visible
      // history, off credit charging, and off the session it belongs to.
      var COMPACT_THRESHOLD = 40;

      function maybeCompact() {
        var nonSummary = history.filter(function (m) { return m.role !== 'summary'; });
        if (nonSummary.length < COMPACT_THRESHOLD) return;
        var toSummarize = nonSummary.slice(0, nonSummary.length - 20);
        if (!toSummarize.length) return;

        var prevSummary = history.filter(function (m) { return m.role === 'summary'; })[0];
        var prevText = prevSummary ? prevSummary.content : null;
        var historyLines = toSummarize
          .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
          .map(function (m) { return (m.role === 'user' ? 'User' : 'Assistant') + ': ' + (m.content || ''); })
          .join('\n');
        var compactInstruction = prevText
          ? 'Here is the previous summary:\n' + prevText + '\n\nHere is the new conversation to add to it:\n' + historyLines + '\n\nWrite an updated single summary covering everything. Be concise but include key topics, decisions, and context.'
          : 'Summarize this conversation concisely. Include key topics, decisions, and important context:\n' + historyLines;

        api('/chat', {method: 'POST', body: JSON.stringify({
          messages: [{role: 'user', content: compactInstruction}],
          no_persist: true,
        })}).then(function (data) {
          if (data.__status !== 200 || !data.message || !data.message.content) return;
          var recent = nonSummary.slice(nonSummary.length - 20);
          history = [{role: 'summary', content: data.message.content}].concat(recent);
          // Match what's actually stored from here on -- the summarized bubbles
          // are gone from the persisted history the moment the next real
          // message is sent, so keep the screen in sync now rather than lie.
          listEl.innerHTML = '';
          addNote(t('mvmai_pub_compacted_note'));
          recent.forEach(function (m) {
            if ((m.role === 'user' || m.role === 'assistant') && m.content) addBubble(m.role, m.content);
          });
          scrollDown();
        }).catch(function () {});
      }

      function send() {
        var text = inputEl.value.trim();
        if (!text || sending) return;
        sending = true;
        sendEl.disabled = true;
        inputEl.value = '';
        inputEl.style.height = 'auto';

        addBubble('user', text);
        history.push({role: 'user', content: text});

        function step() {
          var typing = addTyping();
          api('/chat', {method: 'POST', body: JSON.stringify({messages: history, session_id: sessionId, project_id: activeProject ? activeProject.id : null})}).then(function (data) {
            typing.remove();
            if (data.__status !== 200) {
              var key = data.error === 'insufficient_credits' ? 'mvmai_pub_insufficient_credits'
                : (data.__status === 401 ? 'mvmai_pub_unauthorized' : null);
              addNote((key ? t(key) : (t('mvmai_pub_err') + ': ' + (data.error || data.__status))));
              sending = false;
              sendEl.disabled = false;
              return;
            }
            if (data.session_id) sessionId = data.session_id;
            var msg = data.message;
            history.push(msg);
            if (msg.content) addBubble('assistant', msg.content);

            if (msg.tool_calls && msg.tool_calls.length) {
              Promise.all(msg.tool_calls.map(runToolCall)).then(function (toolMsgs) {
                toolMsgs.forEach(function (tm) { history.push(tm); });
                step();
              });
            } else {
              sending = false;
              sendEl.disabled = false;
              refreshSessionList();
              maybeCompact();
            }
          });
        }
        step();
      }

      sendEl.onclick = send;
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      inputEl.addEventListener('input', function () {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 128) + 'px';
      });
    }

    return { destroy: function () { clearInterval(projectPoll); } };
  }

  window.MvmaiWidget = { mount: mount };
})();
