// Telegram Hub — the page where an Apps Hub profile connects and manages its own bots.
(function () {
  var token = localStorage.getItem('apphub_token');
  if (!token) { location.replace('/pub/apphub/?return=' + encodeURIComponent(location.href)); return; }

  var t = function (k, v) { return window.t ? window.t(k, v) : k; };
  var root = document.getElementById('app');
  var state = null, apps = [], catalog = null;
  var editing = null;   // {bot, button, draft} while a custom bot's button is open
  var lang = function () { return (window.mvmOS && window.mvmOS.lang) || 'en'; };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  };

  function api(method, path, body) {
    return fetch('/api/pub/telegramhub' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      if (r.status === 401) { location.replace('/pub/apphub/?return=' + encodeURIComponent(location.href)); }
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, data: d }; });
    });
  }
  function appName(a) { return (a.name_i18n && a.name_i18n[lang()]) || a.name || a.id; }
  function appById(id) { return apps.filter(function (a) { return a.id === id; })[0]; }
  function errText(r) {
    var code = r.data && r.data.detail;
    return t('tgh_err_' + code) !== 'tgh_err_' + code ? t('tgh_err_' + code) : t('tgh_err_generic');
  }
  function botApps() {
    return apps.filter(function (a) { return a.id !== 'apphub' && a.id !== 'telegramhub'; });
  }

  var CSS = '<style>' +
    '.th-card{background:var(--pub-surface1,#313244);border:1px solid var(--pub-border,#45475a);border-radius:12px;padding:14px;margin-bottom:14px}' +
    '.th-h{font-size:1rem;font-weight:700;margin:0 0 8px}' +
    '.th-dim{font-size:.82rem;color:var(--pub-fg2,#a6adc8);line-height:1.5}' +
    '.th-inp{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid var(--pub-border,#45475a);' +
      'background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);font:inherit;font-size:.9rem}' +
    '.th-btn{border:1px solid var(--pub-border,#45475a);background:var(--pub-surface2,#3b3d52);color:var(--pub-fg,#cdd6f4);' +
      'padding:8px 14px;border-radius:8px;font:inherit;font-size:.85rem;cursor:pointer;text-decoration:none;display:inline-block}' +
    '.th-btn.main{background:var(--pub-accent,#89b4fa);border-color:var(--pub-accent,#89b4fa);color:var(--on-accent,#1e1e2e);font-weight:600}' +
    '.th-btn[disabled]{opacity:.5;cursor:default}' +
    '.th-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--pub-border,#45475a)}' +
    '.th-err{font-size:.82rem;min-height:18px;color:color-mix(in srgb,var(--pub-red,#f38ba8) 35%,var(--pub-fg,#cdd6f4))}' +
    '.th-ok{color:color-mix(in srgb,var(--pub-green,#a6e3a1) 35%,var(--pub-fg,#cdd6f4))}' +
    '.th-steps{margin:8px 0 12px;padding-left:20px;font-size:.85rem;line-height:1.6}' +
    '.th-label{display:block;font-size:.78rem;color:var(--pub-fg2,#a6adc8);margin:10px 0 4px}' +
    '.th-badge{display:inline-block;font-size:.72rem;padding:2px 8px;border-radius:99px;border:1px solid var(--pub-border,#45475a);' +
      'color:var(--pub-fg2,#a6adc8);margin-bottom:4px}' +
    '.th-type{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1px solid var(--pub-border,#45475a);border-radius:10px;' +
      'margin-bottom:8px;cursor:pointer}' +
    '.th-type.on{border-color:var(--pub-accent,#89b4fa);background:color-mix(in srgb,var(--pub-accent,#89b4fa) 12%,transparent)}' +
    '.th-type.off{opacity:.5;cursor:default}' +
    '.th-chip{border:1px solid var(--pub-border,#45475a);background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);' +
      'border-radius:99px;padding:3px 10px;font:inherit;font-size:.78rem;cursor:pointer;margin:0 6px 6px 0}' +
    '.th-sum{cursor:pointer;font-size:.88rem;font-weight:600;padding:6px 0}' +
    '</style>';

  // ── Bot list ──────────────────────────────────────────────────

  function typeTitle(b) {
    if (b.mode === 'hub') return t('tgh_type_hub');
    if (b.mode === 'app') return t('tgh_type_app') + ' · ' + esc(appById(b.app_id) ? appName(appById(b.app_id)) : b.app_id);
    return t('tgh_type_custom');
  }

  function notifBlock(b) {
    var muted = b.muted || [];
    var sources = [{ id: 'apphub', label: t('tgh_src_apphub'), icon: '🏠' }].concat(botApps().map(function (a) {
      return { id: a.id, label: appName(a), icon: a.icon || '📦' };
    }));
    var on = sources.filter(function (s) { return muted.indexOf(s.id) < 0; }).length;
    return '<details style="margin-top:10px"><summary class="th-sum">' +
      t('tgh_pub_notifs_count', { on: on, total: sources.length }) + '</summary>' +
      '<div class="th-dim" style="margin-bottom:4px">' + t('tgh_pub_notifs_hint') + '</div>' +
      sources.map(function (s) {
        return '<label class="th-row" style="cursor:pointer"><span style="font-size:1.2rem">' + esc(s.icon) + '</span>' +
          '<span style="flex:1;font-size:.88rem">' + esc(s.label) + '</span>' +
          '<input type="checkbox" data-mute="' + esc(s.id) + '"' + (muted.indexOf(s.id) < 0 ? ' checked' : '') +
          ' style="width:18px;height:18px;cursor:pointer"></label>';
      }).join('') + '</details>';
  }

  function buttonsBlock(b) {
    if (!b.usable) return '<div class="th-err" style="margin-top:10px">' + t('tgh_pub_custom_off') + '</div>';
    var rows = (b.buttons || []).map(function (btn) {
      var app = appById(btn.app_id) || {};
      return '<div class="th-row"><span style="font-size:1.2rem">' + esc(app.icon || '📦') + '</span>' +
        '<span style="flex:1;font-size:.88rem">' + esc(btn.name) + '</span>' +
        '<button class="th-btn" data-edit="' + btn.id + '">' + t('tgh_pub_edit') + '</button></div>';
    }).join('');
    return '<div style="margin-top:12px"><div class="th-h" style="font-size:.9rem">' + t('tgh_pub_buttons') + '</div>' +
      (rows || '<div class="th-dim">' + t('tgh_pub_no_buttons') + '</div>') +
      '<div style="margin-top:10px"><button class="th-btn main" data-act="addbutton">' + t('tgh_pub_add_button') + '</button></div></div>';
  }

  function botCard(b) {
    var what = b.mode === 'hub' ? t('tgh_pub_opens_hub')
      : b.mode === 'app' ? t('tgh_pub_opens_app', { app: esc(appById(b.app_id) ? appName(appById(b.app_id)) : b.app_id) })
      : t('tgh_pub_custom_what');
    var status = b.linked
      ? '<span class="th-ok">● ' + t('tgh_pub_connected') + '</span>'
      : '<span class="th-dim">○ ' + t('tgh_pub_waiting') + '</span>';
    return '<div class="th-card" data-bot="' + esc(b.id) + '">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:160px"><span class="th-badge">' + typeTitle(b) + '</span>' +
      '<div class="th-h" style="margin:0">@' + esc(b.username) + '</div>' +
      '<div class="th-dim">' + what + '</div><div style="font-size:.82rem;margin-top:2px">' + status + '</div></div>' +
      (b.pair_url ? '<a class="th-btn main" target="_blank" rel="noopener" href="' + esc(b.pair_url) + '">' + t('tgh_pub_open_telegram') + '</a>' : '') +
      '<button class="th-btn" data-act="reconnect">' + t('tgh_pub_reconnect') + '</button>' +
      '<button class="th-btn" data-act="delete">' + t('tgh_pub_delete') + '</button></div>' +
      (b.mode === 'hub' ? notifBlock(b) : '') + (b.mode === 'custom' ? buttonsBlock(b) : '') + '</div>';
  }

  var addType = null;

  function typeChoices() {
    var hasHub = state.bots.some(function (b) { return b.mode === 'hub'; });
    var list = [
      { id: 'hub', off: hasHub },
      { id: 'app', off: !botApps().length },
    ];
    if (state.custom) list.push({ id: 'custom', off: false });
    return list;
  }

  function addForm() {
    var choices = typeChoices();
    var free = choices.filter(function (c) { return !c.off; });
    if (!free.length) return '';
    if (!addType || !free.some(function (c) { return c.id === addType; })) addType = free[0].id;
    var picker = choices.map(function (c) {
      return '<label class="th-type' + (c.id === addType ? ' on' : '') + (c.off ? ' off' : '') + '">' +
        '<input type="radio" name="th-type" value="' + c.id + '"' + (c.id === addType ? ' checked' : '') + (c.off ? ' disabled' : '') + ' style="margin-top:3px">' +
        '<span><b style="font-size:.9rem">' + t('tgh_type_' + c.id) + '</b><br><span class="th-dim">' + t('tgh_type_' + c.id + '_d') + '</span></span></label>';
    }).join('');
    var appHtml = '<div id="th-app-wrap"' + (addType === 'app' ? '' : ' style="display:none"') + '>' +
      '<label class="th-label">' + t('tgh_pub_app') + '</label><select class="th-inp" id="th-app">' +
      botApps().map(function (a) { return '<option value="' + esc(a.id) + '">' + esc(appName(a)) + '</option>'; }).join('') + '</select></div>';
    return '<div class="th-card"><div class="th-h">' + t('tgh_pub_add_title') + '</div>' +
      '<div class="th-label" style="margin-top:0">' + t('tgh_pub_choose_type') + '</div>' + picker + appHtml +
      '<ol class="th-steps"><li>' + t('tgh_pub_step1', { botfather: '<a href="https://t.me/BotFather" target="_blank" rel="noopener" style="color:var(--pub-accent,#89b4fa)">@BotFather</a>' }) + '</li>' +
      '<li>' + t('tgh_pub_step2') + '</li><li>' + t('tgh_pub_step3') + '</li><li>' + t('tgh_pub_step4') + '</li></ol>' +
      '<label class="th-label">' + t('tgh_pub_token') + '</label>' +
      '<input class="th-inp" id="th-token" placeholder="123456:ABC-..." autocomplete="off" spellcheck="false">' +
      '<div style="margin-top:12px"><button class="th-btn main" id="th-connect"' + (state.configured ? '' : ' disabled') + '>' + t('tgh_pub_connect') + '</button></div>' +
      '<div class="th-err" id="th-msg" style="margin-top:8px"></div></div>';
  }

  function renderList() {
    root.innerHTML = CSS +
      '<div style="text-align:center;margin-bottom:16px"><div style="font-size:2.4rem">✈️</div>' +
      '<h1 style="font-size:1.2rem;margin:4px 0 6px">Telegram Hub</h1><div class="th-dim">' + t('tgh_pub_intro') + '</div></div>' +
      (state.configured ? '' : '<div class="th-card th-err">' + t('tgh_pub_no_url') + '</div>') +
      state.bots.map(botCard).join('') + addForm();

    root.querySelectorAll('input[name="th-type"]').forEach(function (r) {
      r.onchange = function () {
        addType = r.value;
        root.querySelectorAll('.th-type').forEach(function (l) {
          l.classList.toggle('on', l.querySelector('input').value === addType);
        });
        root.querySelector('#th-app-wrap').style.display = addType === 'app' ? '' : 'none';
      };
    });
    var connect = root.querySelector('#th-connect');
    if (connect) connect.onclick = function () {
      var msg = root.querySelector('#th-msg'), a = root.querySelector('#th-app');
      msg.textContent = t('tgh_pub_connecting');
      connect.disabled = true;
      api('POST', '/bots', { token: root.querySelector('#th-token').value, mode: addType, app_id: addType === 'app' && a ? a.value : null })
        .then(function (r) {
          if (r.ok) { load(); return; }
          connect.disabled = false;
          msg.textContent = errText(r);
        });
    };
    root.querySelectorAll('.th-card[data-bot]').forEach(function (card) {
      var id = card.getAttribute('data-bot');
      var bot = state.bots.filter(function (b) { return b.id === id; })[0];
      card.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var act = btn.getAttribute('data-act');
          if (act === 'delete' && confirm(t('tgh_pub_delete_confirm'))) api('DELETE', '/bots/' + id).then(load);
          if (act === 'reconnect' && confirm(t('tgh_pub_reconnect_confirm'))) api('POST', '/bots/' + id + '/reconnect').then(load);
          if (act === 'addbutton') openEditor(bot, null);
        };
      });
      card.querySelectorAll('[data-edit]').forEach(function (btn) {
        btn.onclick = function () {
          var bid = Number(btn.getAttribute('data-edit'));
          openEditor(bot, bot.buttons.filter(function (x) { return x.id === bid; })[0]);
        };
      });
      card.querySelectorAll('[data-mute]').forEach(function (cb) {
        cb.onchange = function () {
          api('PUT', '/bots/' + id + '/muted', { source: cb.getAttribute('data-mute'), muted: !cb.checked });
        };
      });
    });
  }

  // ── Button editor (custom menu bot) ────────────────────────────

  function openEditor(bot, button) {
    var open = function () {
      editing = {
        bot: bot, button: button,
        d: button ? JSON.parse(JSON.stringify(button)) : { name: '', app_id: '', fn: '', params: [], reply: '' },
        options: {},
      };
      renderEditor();
    };
    if (catalog) { open(); return; }
    api('GET', '/catalog').then(function (r) { catalog = r.ok ? r.data.apps : []; open(); });
  }

  function currentApp() {
    return catalog.filter(function (a) { return a.id === editing.d.app_id; })[0];
  }
  function currentFn() {
    var a = currentApp();
    if (!a) return null;
    var found = a.actions.filter(function (f) { return f.id === editing.d.fn; })[0];
    if (found) return { kind: 'action', spec: found };
    found = a.reads.filter(function (f) { return f.id === editing.d.fn; })[0];
    return found ? { kind: 'read', spec: found } : null;
  }
  function paramCfg(id, required) {
    var p = editing.d.params.filter(function (x) { return x.id === id; })[0];
    if (!p) { p = { id: id, mode: required ? 'ask' : 'skip', value: '', prompt: '' }; editing.d.params.push(p); }
    return p;
  }

  function optionsFor(param) {
    var key = editing.d.app_id + '/' + editing.d.fn + '/' + param.id;
    if (editing.options[key]) return Promise.resolve(editing.options[key]);
    return api('GET', '/options?app=' + encodeURIComponent(editing.d.app_id) + '&fn=' + encodeURIComponent(editing.d.fn) +
      '&param=' + encodeURIComponent(param.id)).then(function (r) {
      editing.options[key] = r.ok ? r.data.options : [];
      return editing.options[key];
    });
  }

  function valueRows(fn) {
    if (!fn || fn.kind === 'read' || !fn.spec.params.length) return '<div class="th-dim">' + t('tgh_ed_no_values') + '</div>';
    return fn.spec.params.map(function (p) {
      var cfg = paramCfg(p.id, p.required);
      var modes = [['ask', t('tgh_ed_ask')], ['fixed', t('tgh_ed_fixed')]];
      if (!p.required) modes.push(['skip', t('tgh_ed_skip')]);
      var fixed = p.pick
        ? '<select class="th-inp" data-fixed="' + esc(p.id) + '"></select>'
        : '<input class="th-inp" data-fixed="' + esc(p.id) + '" value="' + esc(cfg.value) + '">';
      return '<div class="th-card" style="margin-bottom:8px;padding:10px" data-param="' + esc(p.id) + '">' +
        '<div style="font-size:.88rem;font-weight:600">' + esc(p.label) + '</div>' +
        '<select class="th-inp" data-mode style="margin-top:6px">' + modes.map(function (m) {
          return '<option value="' + m[0] + '"' + (cfg.mode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>';
        }).join('') + '</select>' +
        '<div data-box="fixed" style="' + (cfg.mode === 'fixed' ? '' : 'display:none') + '"><label class="th-label">' + t('tgh_ed_value') + '</label>' + fixed + '</div>' +
        '<div data-box="ask" style="' + (cfg.mode === 'ask' ? '' : 'display:none') + '"><label class="th-label">' + t('tgh_ed_prompt') + '</label>' +
        '<input class="th-inp" data-prompt placeholder="' + esc(t('tgh_ed_prompt_ph')) + '" value="' + esc(cfg.prompt) + '"></div></div>';
    }).join('');
  }

  function chips(fn) {
    var out = [];
    if (fn && fn.kind === 'action') fn.spec.params.forEach(function (p) { out.push([p.id, p.label]); });
    out.push(['result', t('tgh_ed_var_result')]);
    return out.map(function (c) {
      return '<button type="button" class="th-chip" data-var="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
    }).join('');
  }

  function renderEditor() {
    var d = editing.d, app = currentApp(), fn = currentFn();
    var appSel = '<select class="th-inp" id="ed-app"><option value="">' + t('tgh_ed_pick_app') + '</option>' +
      catalog.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === d.app_id ? ' selected' : '') + '>' + esc(appName(a)) + '</option>';
      }).join('') + '</select>';
    var fnSel = '';
    if (app) {
      var opt = function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === d.fn ? ' selected' : '') + '>' + esc(f.label) + '</option>'; };
      fnSel = '<label class="th-label">' + t('tgh_ed_fn') + '</label><select class="th-inp" id="ed-fn">' +
        '<option value="">' + t('tgh_ed_pick_fn') + '</option>' +
        (app.actions.length ? '<optgroup label="' + esc(t('tgh_ed_group_do')) + '">' + app.actions.map(opt).join('') + '</optgroup>' : '') +
        (app.reads.length ? '<optgroup label="' + esc(t('tgh_ed_group_read')) + '">' + app.reads.map(opt).join('') + '</optgroup>' : '') +
        '</select>' + (fn && fn.spec.summary ? '<div class="th-dim" style="margin-top:4px">' + esc(fn.spec.summary.length > 140 ? fn.spec.summary.slice(0, 140).replace(/\s+\S*$/, '') + '…' : fn.spec.summary) + '</div>' : '');
    }
    root.innerHTML = CSS +
      '<div style="margin-bottom:12px"><button class="th-btn" id="ed-back">← ' + t('tgh_ed_back') + '</button></div>' +
      '<div class="th-card"><div class="th-h">' + t(editing.button ? 'tgh_ed_edit' : 'tgh_ed_new') + ' · @' + esc(editing.bot.username) + '</div>' +
      '<label class="th-label">' + t('tgh_ed_name') + '</label>' +
      '<input class="th-inp" id="ed-name" maxlength="40" placeholder="' + esc(t('tgh_ed_name_ph')) + '" value="' + esc(d.name) + '">' +
      '<label class="th-label">' + t('tgh_ed_app') + '</label>' +
      (catalog.length ? appSel : '<div class="th-dim">' + t('tgh_ed_no_apps') + '</div>') + fnSel +
      (fn ? '<div class="th-h" style="font-size:.9rem;margin-top:16px">' + t('tgh_ed_values') + '</div>' +
        (fn.kind === 'action' && fn.spec.params.length ? '<div class="th-dim" style="margin-bottom:6px">' + t('tgh_ed_values_hint') + '</div>' : '') +
        valueRows(fn) +
        '<div class="th-h" style="font-size:.9rem;margin-top:16px">' + t('tgh_ed_reply') + '</div>' +
        '<div class="th-dim" style="margin-bottom:6px">' + t('tgh_ed_reply_hint') + '</div>' +
        '<div>' + chips(fn) + '</div>' +
        '<textarea class="th-inp" id="ed-reply" rows="4" maxlength="800">' + esc(d.reply) + '</textarea>' +
        '<div class="th-dim" style="margin-top:4px">' + t('tgh_ed_result_note') + '</div>' : '') +
      '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="th-btn main" id="ed-save"' + (fn ? '' : ' disabled') + '>' + t('tgh_save') + '</button>' +
      (editing.button ? '<button class="th-btn" id="ed-del">' + t('tgh_pub_delete') + '</button>' : '') + '</div>' +
      '<div class="th-err" id="ed-msg" style="margin-top:8px"></div></div>';

    var name = root.querySelector('#ed-name');
    name.oninput = function () { d.name = name.value; };
    root.querySelector('#ed-back').onclick = function () { editing = null; renderList(); };
    var appEl = root.querySelector('#ed-app');
    if (appEl) appEl.onchange = function () { d.app_id = appEl.value; d.fn = ''; d.params = []; renderEditor(); };
    var fnEl = root.querySelector('#ed-fn');
    if (fnEl) fnEl.onchange = function () { d.fn = fnEl.value; d.params = []; renderEditor(); };
    var reply = root.querySelector('#ed-reply');
    if (reply) reply.oninput = function () { d.reply = reply.value; };
    root.querySelectorAll('[data-var]').forEach(function (chip) {
      chip.onclick = function () {
        var at = reply.selectionStart == null ? reply.value.length : reply.selectionStart;
        var add = '{' + chip.getAttribute('data-var') + '}';
        reply.value = reply.value.slice(0, at) + add + reply.value.slice(reply.selectionEnd == null ? at : reply.selectionEnd);
        d.reply = reply.value;
        reply.focus();
        reply.setSelectionRange(at + add.length, at + add.length);
      };
    });
    root.querySelectorAll('[data-param]').forEach(function (box) {
      var id = box.getAttribute('data-param'), spec = fn.spec.params.filter(function (p) { return p.id === id; })[0], cfg = paramCfg(id, spec.required);
      box.querySelector('[data-mode]').onchange = function (e) {
        cfg.mode = e.target.value;
        box.querySelector('[data-box="fixed"]').style.display = cfg.mode === 'fixed' ? '' : 'none';
        box.querySelector('[data-box="ask"]').style.display = cfg.mode === 'ask' ? '' : 'none';
      };
      box.querySelector('[data-prompt]').oninput = function (e) { cfg.prompt = e.target.value; };
      var fixed = box.querySelector('[data-fixed]');
      fixed.onchange = fixed.oninput = function () { cfg.value = fixed.value; };
      if (spec.pick) {
        optionsFor(spec).then(function (list) {
          fixed.innerHTML = list.map(function (o) {
            return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(cfg.value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          }).join('');
          if (!cfg.value && list[0]) cfg.value = String(list[0].value);
        });
      }
    });
    var save = root.querySelector('#ed-save');
    if (save) save.onclick = function () {
      var msg = root.querySelector('#ed-msg');
      save.disabled = true;
      var path = '/bots/' + editing.bot.id + '/buttons' + (editing.button ? '/' + editing.button.id : '');
      api(editing.button ? 'PUT' : 'POST', path, d).then(function (r) {
        if (r.ok) { editing = null; load(); return; }
        save.disabled = false;
        msg.textContent = errText(r);
      });
    };
    var del = root.querySelector('#ed-del');
    if (del) del.onclick = function () {
      if (!confirm(t('tgh_ed_delete_confirm'))) return;
      api('DELETE', '/bots/' + editing.bot.id + '/buttons/' + editing.button.id).then(function () { editing = null; load(); });
    };
  }

  function render() { if (editing) renderEditor(); else renderList(); }

  function load() {
    return Promise.all([
      api('GET', '/state'),
      fetch('/api/pub/apphub/apps', { headers: { 'X-Pub-Token': token } }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    ]).then(function (res) {
      state = res[0].data;
      apps = res[1] || [];
      renderList();
    });
  }
  load();
  if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(function () { if (state) render(); });
})();
