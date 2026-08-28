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
        color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}
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
      .mvmai-sidebar-head{padding:.7rem;border-bottom:1px solid var(--pub-border,#45475a);flex-shrink:0}
      .mvmai-new-chat{width:100%;padding:.5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.84rem;
        font-weight:600}
      .mvmai-sidebar-list{flex:1;overflow-y:auto;padding:.4rem}
      .mvmai-session-row{display:flex;align-items:center;gap:.2rem;padding:.5rem .55rem;border-radius:.4rem;
        cursor:pointer;font-size:.82rem}
      .mvmai-session-row:hover,.mvmai-session-row.active{background:var(--pub-surface2,#313244)}
      .mvmai-session-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mvmai-session-row .mvmai-s-btn{opacity:.55;background:none;border:0;color:inherit;cursor:pointer;
        font-size:.82rem;padding:.15rem .3rem;flex-shrink:0}
      .mvmai-session-row .mvmai-s-btn:hover{opacity:1}
      .mvmai-no-sessions{color:var(--pub-dim,#6c7086);font-size:.78rem;padding:.7rem .5rem;text-align:center}
      .mvmai-exec-wrap{position:relative;margin-top:.5rem}
      .mvmai-exec-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:.35rem;
        padding:.4rem .5rem;border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:.78rem}
      .mvmai-exec-btn.on{border-color:var(--pub-accent,#89b4fa);color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-btn.auto{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border-color:var(--pub-accent,#89b4fa)}
      .mvmai-exec-menu{position:absolute;top:calc(100% + .4rem);left:0;right:0;z-index:6;
        background:var(--pub-surface,#181825);border:1px solid var(--pub-border,#45475a);border-radius:.5rem;
        padding:.6rem;display:flex;flex-direction:column;gap:.5rem;font-size:.78rem}
      .mvmai-exec-menu[hidden]{display:none}
      .mvmai-exec-row{display:flex;align-items:flex-start;gap:.4rem;cursor:pointer;line-height:1.35}
      .mvmai-exec-row input{margin-top:.15rem;flex-shrink:0;cursor:pointer}
      .mvmai-exec-mode-wrap{display:flex;flex-direction:column;gap:.4rem;padding-top:.4rem;
        border-top:1px solid var(--pub-border,#45475a)}
      .mvmai-exec-mode-wrap[hidden]{display:none}
      .mvmai-exec-mode-label{font-size:.72rem;color:var(--pub-dim,#6c7086)}
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

    var me = null;
    var history = [];       // {role, content, tool_calls?, tool_call_id?}
    var sending = false;
    var sessionId = null;

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
      root.innerHTML = `<div class="mvmai-widget">
        <div class="mvmai-sidebar-backdrop"></div>
        <div class="mvmai-sidebar">
          <div class="mvmai-sidebar-head">
            <button class="mvmai-new-chat">+ ${esc(t('mvmai_pub_new_chat'))}</button>
            ${me.is_admin ? `<div class="mvmai-exec-wrap">
              <button class="mvmai-exec-btn" type="button"><span>⚡</span><span class="mvmai-exec-state"></span></button>
              <div class="mvmai-exec-menu" hidden>
                <label class="mvmai-exec-row"><input type="checkbox" class="mvmai-exec-enabled-chk"> ${esc(t('mvmai_pub_exec_enable_label'))}</label>
                <div class="mvmai-exec-mode-wrap" hidden>
                  <div class="mvmai-exec-mode-label">${esc(t('mvmai_pub_exec_mode_label'))}</div>
                  <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="confirm"> ${esc(t('mvmai_pub_exec_mode_confirm'))}</label>
                  <label class="mvmai-exec-row"><input type="radio" name="mvmai-pub-exec-mode" value="auto"> ${esc(t('mvmai_pub_exec_mode_auto'))}</label>
                </div>
              </div>
            </div>` : ''}
          </div>
          <div class="mvmai-sidebar-list"></div>
        </div>
        <div class="mvmai-header">
          <button class="mvmai-hist-btn" title="${esc(t('mvmai_pub_history'))}">🕘</button>
          <span class="mvmai-header-title">🤖 ${esc(t('mvmai_pub_title'))}</span>
          ${me.is_admin ? '<span class="mvmai-badge">' + esc(t('mvmai_pub_admin_badge')) + '</span>' : ''}
          ${priceHint}
        </div>
        <div class="mvmai-list"></div>
        <div class="mvmai-inputbar">
          <textarea class="mvmai-input" rows="1" placeholder="${esc(t('mvmai_pub_placeholder'))}"></textarea>
          <button class="mvmai-send">${esc(t('mvmai_pub_send'))}</button>
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
        var execChk = root.querySelector('.mvmai-exec-enabled-chk');
        var execModeWrap = root.querySelector('.mvmai-exec-mode-wrap');
        var execState = { enabled: false, auto: false };

        function renderExecBtn() {
          execBtn.classList.toggle('on', execState.enabled && !execState.auto);
          execBtn.classList.toggle('auto', execState.enabled && execState.auto);
          execBtn.querySelector('.mvmai-exec-state').textContent = !execState.enabled
            ? t('mvmai_pub_exec_off') : (execState.auto ? t('mvmai_pub_exec_auto_short') : t('mvmai_pub_exec_confirm'));
          execChk.checked = execState.enabled;
          execModeWrap.hidden = !execState.enabled;
          var radio = execMenu.querySelector('input[name="mvmai-pub-exec-mode"][value="' + (execState.auto ? 'auto' : 'confirm') + '"]');
          if (radio) radio.checked = true;
        }

        function saveExecState(patch) {
          Object.assign(execState, patch);
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
        execChk.addEventListener('change', function (e) { saveExecState({enabled: e.target.checked}); });
        execMenu.querySelectorAll('input[name="mvmai-pub-exec-mode"]').forEach(function (r) {
          r.addEventListener('change', function (e) { if (e.target.checked) saveExecState({auto: e.target.value === 'auto'}); });
        });
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
          var sessions = data.sessions || [];
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
            row.querySelector('.mvmai-session-title').onclick = function () { openSession(s.id); };
            row.querySelector('.mvmai-s-rename').onclick = function (e) {
              e.stopPropagation();
              var next = prompt(t('mvmai_pub_rename'), s.title || '');
              if (next == null) return;
              next = next.trim();
              if (!next) return;
              api('/sessions/' + s.id, {method: 'PATCH', body: JSON.stringify({title: next})})
                .then(function () { refreshSessionList(); });
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
          return api('/exec', {method: 'POST', body: JSON.stringify({command: args.command, confirmed: confirmed})});
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
          api('/chat', {method: 'POST', body: JSON.stringify({messages: history, session_id: sessionId})}).then(function (data) {
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

    return { destroy: function () {} };
  }

  window.MvmaiWidget = { mount: mount };
})();
