(function () {
  var API = '/api/apps/domains';

  function t(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function loadI18n() {
    if (window.DOMAINS_I18N) return Promise.resolve();
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = window.asset ? window.asset('/apps/domains/i18n.js') : '/apps/domains/i18n.js';
      s.onload = ok; s.onerror = ok;
      document.head.appendChild(s);
    });
  }

  var CSS = '.dm{padding:18px;display:flex;flex-direction:column;gap:14px;font-size:.88rem;overflow:auto;height:100%;box-sizing:border-box}' +
    '.dm-intro{color:var(--text-dim);line-height:1.5}' +
    '.dm-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius,6px);padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.dm-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}' +
    '.dm-label{font-weight:600}' +
    '.dm-dim{color:var(--text-dim);font-size:.8rem;line-height:1.45}' +
    '.dm-ok{color:color-mix(in srgb,#2ea043 45%,var(--text,#c9d1d9))}' +
    '.dm-warn{color:color-mix(in srgb,#d29922 50%,var(--text,#c9d1d9))}' +
    '.dm-spin{background:none;border:2px solid var(--text-dim);border-top-color:var(--accent);box-sizing:border-box;animation:dm-rot .8s linear infinite}' +
    '@keyframes dm-rot{to{transform:rotate(360deg)}}' +
    '.dm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}' +
    '.dm-form{display:flex;gap:8px;flex-wrap:wrap}' +
    '.dm-form select{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:7px 9px;color:var(--text);font:inherit;max-width:100%}' +
    '.dm-form input{flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:7px 9px;color:var(--text);font:inherit}' +
    '.dm-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}' +
    '.dm-steps li{display:flex;gap:8px;align-items:center}' +
    '.dm-mark{width:1.2em;text-align:center}' +
    '.dm-log{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px;font-family:monospace;font-size:.74rem;max-height:160px;overflow:auto;white-space:pre-wrap;margin:0}' +
    '.dm-domain{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border)}' +
    '.dm-domain:first-of-type{border-top:0}' +
    '.dm-actions{display:flex;gap:6px;flex-wrap:wrap}' +
    '.dm-link{text-decoration:none;display:inline-block}' +
    '.dm-card summary{cursor:pointer;font-weight:600}';

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = document.execCommand('copy');
    ta.remove();
    return ok ? Promise.resolve() : Promise.reject();
  }

  // The user's sudo password, or '' for root. null when there is none to give.
  async function password() {
    var sudo = await fetch('/api/auth/can-sudo').then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
    if (sudo.is_root) return '';
    if (!sudo.ok) { await mvmOS.requireRoot(t('dm_title')); return null; }
    return mvmOS.confirmPassword(t('dm_title'), t('dm_password'));
  }

  function mount(root) {
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    var el = document.createElement('div');
    el.className = 'dm';
    root.appendChild(el);

    var state = null, error = '', denied = false, timer = null, checking = {};

    function schedule() {
      clearTimeout(timer);
      if (!el.isConnected) return;
      timer = setTimeout(refresh, state && state.job.running ? 1500 : 6000);
    }

    async function refresh() {
      try {
        var r = await fetch(API + '/status');
        if (r.status === 403) denied = true;
        else if (r.ok) { denied = false; state = await r.json(); }
      } catch (e) {}
      // Keep typing in the form: only redraw when the form is not in use.
      if (!(document.activeElement && el.contains(document.activeElement) && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT'))) render();
      schedule();
    }

    async function post(path, body, failKey) {
      var pw = await password();
      if (pw === null) return false;
      error = '';
      body = Object.assign({ password: pw }, body || {});
      var r = await fetch(API + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).catch(function () { return null; });
      if (!r || !r.ok) {
        var d = r ? await r.json().catch(function () { return {}; }) : {};
        var key = 'dm_err_' + d.detail;
        error = d.detail && t(key) !== key ? t(key) : (d.detail && d.detail.length < 160 ? d.detail : t(failKey || 'dm_failed'));
        render();
        return false;
      }
      refresh();
      return true;
    }

    function errText(code) {
      var key = 'dm_err_' + code;
      return t(key) !== key ? t(key) : t('dm_failed');
    }

    function targetName(id) {
      if (!id || id === 'all') return t('dm_target_all');
      if (id === 'apphub') return t('dm_target_hub');
      var f = ((state && state.targets) || []).filter(function (x) { return x.id === id; })[0];
      return f ? f.name : id;
    }

    function domainInput(label) {
      var opts = '<option value="all">' + esc(t('dm_target_all')) + '</option><option value="apphub">' + esc(t('dm_target_hub')) + '</option>';
      ((state && state.targets) || []).forEach(function (x) {
        opts += '<option value="' + esc(x.id) + '">' + esc((x.icon ? x.icon + ' ' : '') + x.name) + '</option>';
      });
      return '<div class="dm-form"><input type="text" data-host placeholder="' + esc(t('dm_domain_ph')) + '" autocomplete="off" spellcheck="false">' +
        '<select data-target>' + opts + '</select>' +
        '<button class="s-btn" data-connect>' + esc(label) + '</button></div>' +
        '<div class="dm-dim" style="margin-top:6px">' + esc(t('dm_target_hint')) + '</div>';
    }

    function jobCard(s) {
      var job = s.job, html = '<div class="dm-card"><div class="dm-label">' + esc(job.host) + '</div><ul class="dm-steps">';
      s.steps.forEach(function (id) {
        var done = job.done.indexOf(id) !== -1, now = job.step === id;
        if (id === 'login' && !done && !now) return;
        html += '<li><span class="dm-mark">' + (done ? '✓' : (now ? '⟳' : '·')) + '</span><span' + (done ? ' class="dm-ok"' : '') + '>' + esc(t('dm_step_' + id)) + '</span></li>';
      });
      html += '</ul>';
      if (job.login_url) {
        html += '<div class="dm-dim">' + esc(t('dm_login_help')) + '</div>' +
          '<div class="dm-actions"><a class="s-btn dm-link" href="' + esc(job.login_url) + '" target="_blank" rel="noopener noreferrer">' + esc(t('dm_open_cf')) + '</a>' +
          '<button class="s-btn" data-copy="' + esc(job.login_url) + '">' + esc(t('dm_copy_link')) + '</button></div>';
      }
      html += '<div class="dm-actions"><button class="s-btn s-btn-sm" data-cancel>' + esc(t('dm_cancel')) + '</button></div></div>';
      return html;
    }

    function resultCard(job) {
      if (job.ok === false && job.error !== 'cancelled') {
        return '<div class="dm-card"><div class="dm-warn dm-label">' + esc(t('dm_failed')) + ' ' + esc(errText(job.error)) + '</div>' +
          (job.detail ? '<details><summary class="dm-dim">' + esc(t('dm_details')) + '</summary><pre class="dm-log">' + esc(job.detail) + '</pre></details>' : '') + '</div>';
      }
      if (job.ok === true) {
        return '<div class="dm-card"><div class="dm-ok dm-label">✓ ' + esc(t('dm_ready')) + '</div>' +
          '<div><a class="s-btn dm-link" href="https://' + esc(job.host) + '/" target="_blank" rel="noopener noreferrer">' + esc(t('dm_open')) + ' ' + esc(job.host) + '</a></div></div>';
      }
      return '';
    }

    function render() {
      if (denied) { el.innerHTML = '<div class="dm-card dm-warn">' + esc(t('dm_not_admin')) + '</div>'; return; }
      if (!state) { el.innerHTML = '<div class="dm-dim">' + esc(t('dm_working')) + '</div>'; return; }
      var s = state, job = s.job, html = '<div class="dm-intro">' + esc(t('dm_intro')) + '</div>';

      if (!s.supported) { el.innerHTML = html + '<div class="dm-card dm-warn">' + esc(t('dm_unsupported')) + '</div>'; return; }
      if (s.foreign) html += '<div class="dm-dim">' + esc(t('dm_foreign')) + '</div>';
      if (error) html += '<div class="dm-warn">' + esc(error) + '</div>';

      if (job.running) html += jobCard(s);
      else html += resultCard(job);

      if (s.mode === 'token') {
        html += '<div class="dm-card"><div class="dm-row"><span><span class="dm-dot" style="background:' + (s.running ? '#2ea043' : 'var(--text-dim)') + '"></span>' +
          esc(s.running ? t('dm_tunnel_running') : t('dm_tunnel_stopped')) + '</span>' +
          '<span class="dm-actions"><button class="s-btn s-btn-sm" data-restart>' + esc(t('dm_restart')) + '</button>' +
          '<button class="s-btn s-btn-sm" data-disconnect>' + esc(t('dm_disconnect')) + '</button></span></div>' +
          '<div class="dm-dim">' + esc(t('dm_token_mode')) + '</div></div>';
      } else if (s.domains.length) {
        html += '<div class="dm-card"><div class="dm-row"><span><span class="dm-dot" style="background:' + (s.running ? '#2ea043' : 'var(--text-dim)') + '"></span>' +
          esc(s.running ? t('dm_tunnel_running') : t('dm_tunnel_stopped')) + '</span>' +
          '<span class="dm-actions"><button class="s-btn s-btn-sm" data-restart>' + esc(t('dm_restart')) + '</button>' +
          '<button class="s-btn s-btn-sm" data-disconnect>' + esc(t('dm_disconnect')) + '</button></span></div>';
        s.domains.forEach(function (d) {
          html += '<div class="dm-domain"><span><span class="dm-dot' + (checking[d.host] ? ' dm-spin' : '') + '" style="' + (checking[d.host] ? '' : 'background:' + (d.online ? '#2ea043' : 'var(--text-dim)')) + '"></span><b>' + esc(d.host) + '</b>' + (d.target && d.target !== 'all' ? ' <span class="dm-dim">· ' + esc(targetName(d.target)) + '</span>' : '') + '</span>' +
            '<span class="dm-actions"><a class="s-btn s-btn-sm dm-link" href="https://' + esc(d.host) + '/" target="_blank" rel="noopener noreferrer">' + esc(t('dm_open')) + '</a>' +
            '<button class="s-btn s-btn-sm" data-check="' + esc(d.host) + '"' + (checking[d.host] ? ' disabled' : '') + '>' + esc(t('dm_check')) + '</button>' +
            '<button class="s-btn s-btn-sm" data-remove="' + esc(d.host) + '">' + esc(t('dm_remove')) + '</button></span></div>';
        });
        html += '</div>';
        if (!job.running) html += '<div class="dm-card"><div class="dm-label">' + esc(t('dm_add_another')) + '</div>' + domainInput(t('dm_add')) + '</div>';
        html += '<div class="dm-dim">' + esc(t('dm_security')) + '</div>';
      } else if (!job.running) {
        html += '<div class="dm-card"><div class="dm-label">' + esc(t('dm_domain')) + '</div>' + domainInput(t('dm_connect')) +
          '<div class="dm-dim">' + esc(t('dm_need')) + '</div><div class="dm-dim">' + esc(t('dm_security')) + '</div></div>';
      }

      if (!s.mode && !job.running) {
        html += '<details class="dm-card"><summary>' + esc(t('dm_other_way')) + '</summary><div class="dm-dim" style="margin:8px 0">' + esc(t('dm_token_desc')) + '</div>' +
          '<div class="dm-form"><input type="password" data-token placeholder="' + esc(t('dm_token_label')) + '" autocomplete="off">' +
          '<button class="s-btn" data-usetoken>' + esc(t('dm_token_connect')) + '</button></div></details>';
      }
      html += '<div class="dm-dim">' + esc(t('dm_disclaimer')) + '</div>';
      el.innerHTML = html;
    }

    el.addEventListener('click', async function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-connect')) {
        var host = b.parentNode.querySelector('[data-host]').value.trim();
        if (!host) return;
        post('/connect', { domain: host, target: b.parentNode.querySelector('[data-target]').value });
      } else if (b.hasAttribute('data-cancel')) {
        fetch(API + '/cancel', { method: 'POST' }).then(refresh);
      } else if (b.hasAttribute('data-copy')) {
        copy(b.getAttribute('data-copy')).then(function () {
          b.textContent = t('dm_copied');
          setTimeout(function () { b.textContent = t('dm_copy_link'); }, 1500);
        }).catch(function () {});
      } else if (b.hasAttribute('data-check')) {
        var ch = b.getAttribute('data-check');
        if (checking[ch]) return;
        checking[ch] = true;
        render();
        await fetch(API + '/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: ch }) }).catch(function () {});
        delete checking[ch];
        await refresh();
      } else if (b.hasAttribute('data-remove')) {
        var h = b.getAttribute('data-remove');
        if (await mvmOS.confirm(t('dm_remove_confirm', { host: h }), { ok: t('dm_remove'), cancel: t('dm_cancel'), danger: true })) post('/remove', { domain: h });
      } else if (b.hasAttribute('data-restart')) {
        post('/restart');
      } else if (b.hasAttribute('data-disconnect')) {
        if (await mvmOS.confirm(t('dm_disconnect_confirm'), { ok: t('dm_disconnect'), cancel: t('dm_cancel'), danger: true })) post('/disconnect');
      } else if (b.hasAttribute('data-usetoken')) {
        var tok = el.querySelector('[data-token]').value.trim();
        if (tok) post('/token', { token: tok }, 'dm_err_bad_token');
      }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('[data-host]')) e.target.parentNode.querySelector('[data-connect]').click();
    });

    refresh();
  }

  mvmOS.registerApp({
    id: 'domains', name: 'Domains', icon: '🌐', category: 'System & Administration',
    launch: function () {
      mvmOS.createWindow({
        id: 'domains', title: '🌐 Domains', width: 600, height: 640,
        onMount: function (body) {
          body.style.padding = '0';
          var root = document.createElement('div');
          root.style.height = '100%';
          body.appendChild(root);
          loadI18n().then(function () { mount(root); });
        },
      });
    },
  });
})();
