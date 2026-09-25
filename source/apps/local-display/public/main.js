(function () {
  var API = '/api/local-display';
  var COMMANDS = [
    ['sudo mvmos-display start', 'ld_cmd_start'],
    ['sudo mvmos-display stop', 'ld_cmd_stop'],
    ['sudo mvmos-display enable', 'ld_cmd_enable'],
    ['sudo mvmos-display disable', 'ld_cmd_disable'],
  ];

  function t(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function loadI18n() {
    if (window.LOCAL_DISPLAY_I18N) return Promise.resolve();
    return new Promise(function (ok) {
      var s = document.createElement('script');
      s.src = '/apps/local-display/i18n.js?v=' + Date.now();
      s.onload = ok; s.onerror = ok;
      document.head.appendChild(s);
    });
  }

  var CSS = '.ld{padding:18px;display:flex;flex-direction:column;gap:14px;font-size:.88rem;overflow:auto;height:100%;box-sizing:border-box}' +
    '.ld-intro{color:var(--text-dim);line-height:1.5}' +
    '.ld-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius,6px);padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.ld-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}' +
    '.ld-label{font-weight:600}' +
    '.ld-dim{color:var(--text-dim);font-size:.8rem;line-height:1.45}' +
    '.ld-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;vertical-align:middle}' +
    '.ld-warn{color:#f9e2af}' +
    '.ld-cmd{display:flex;align-items:center;gap:8px}' +
    '.ld-cmd code{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:6px 9px;font-family:monospace;font-size:.8rem;white-space:nowrap;overflow:auto}' +
    '.ld-log{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:8px;font-family:monospace;font-size:.74rem;max-height:180px;overflow:auto;white-space:pre-wrap;margin:0}' +
    '.ld-switch{display:flex;align-items:center;gap:8px;cursor:pointer}' +
    '.ld-switch input{width:16px;height:16px;cursor:pointer}';

  // navigator.clipboard only exists over https or on localhost.
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
    if (!sudo.ok) { await mvmOS.requireRoot(t('ld_title')); return null; }
    return mvmOS.confirmPassword(t('ld_title'), t('ld_password'));
  }

  function mount(root) {
    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    var el = document.createElement('div');
    el.className = 'ld';
    root.appendChild(el);

    var state = null, error = '', timer = null;

    function schedule() {
      clearTimeout(timer);
      if (!el.isConnected) return;
      timer = setTimeout(refresh, state && state.job.running ? 1500 : 5000);
    }

    async function refresh() {
      try {
        var r = await fetch(API + '/status');
        if (r.ok) state = await r.json();
      } catch (e) {}
      render();
      schedule();
    }

    async function act(action) {
      var pw = await password();
      if (pw === null) return;
      error = '';
      var r = await fetch(API + '/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, password: pw }),
      }).catch(function () { return null; });
      if (!r || !r.ok) {
        var d = r ? await r.json().catch(function () { return {}; }) : {};
        error = d.detail === 'busy' ? t('ld_busy') : (d.detail && d.detail !== 'not_ready' ? d.detail : t('ld_failed'));
      }
      refresh();
    }

    function render() {
      if (!state) { el.innerHTML = '<div class="ld-dim">' + esc(t('ld_working')) + '</div>'; return; }
      var s = state, job = s.job || {}, busy = job.running;
      var blocked = !s.supported || s.desktop;
      var jobText = busy ? t('ld_working') : (job.ok === false ? t('ld_failed') : '');
      var html = '<div class="ld-intro">' + esc(t('ld_intro')) + '</div>';

      if (!s.supported) html += '<div class="ld-card ld-warn">' + esc(t('ld_unsupported')) + '</div>';
      else if (s.desktop) html += '<div class="ld-card ld-warn">' + esc(t('ld_desktop')) + '</div>';

      html += '<div class="ld-card">' +
        '<div class="ld-row"><span class="ld-label">' + esc(t('ld_screen')) + '</span>' +
        (s.screens.length
          ? '<span><span class="ld-dot" style="background:#a6e3a1"></span>' + esc(t('ld_screen_found', { names: s.screens.join(', ') })) + '</span>'
          : '<span class="ld-warn">' + esc(t('ld_screen_none_short')) + '</span>') + '</div>' +
        (s.screens.length ? '' : '<div class="ld-dim">' + esc(t('ld_screen_none')) + '</div>') +
        '<div class="ld-row"><span><span class="ld-dot" style="background:' + (s.running ? '#a6e3a1' : 'var(--text-dim)') + '"></span>' +
        esc(s.running ? t('ld_state_on') : t('ld_state_off')) + '</span>' +
        '<button class="s-btn s-btn-sm" data-act="' + (s.running ? 'stop' : 'start') + '"' + (busy || (blocked && !s.running) ? ' disabled' : '') + '>' +
        esc(s.running ? t('ld_stop') : t('ld_show')) + '</button></div>' +
        '<label class="ld-switch"><input type="checkbox" data-auto' + (s.enabled ? ' checked' : '') + (busy || blocked ? ' disabled' : '') + '>' +
        '<span class="ld-label">' + esc(t('ld_autostart')) + '</span></label>' +
        '<div class="ld-dim">' + esc(t('ld_autostart_desc')) + '</div>' +
        (s.cage && s.browser ? '' : '<div class="ld-dim">' + esc(t('ld_first_time')) + '</div>') +
        '<div class="ld-dim">' + esc(t('ld_login_hint')) + ' ' + esc(t('ld_console_hint')) + '</div>' +
        (jobText ? '<div class="ld-label' + (job.ok === false ? ' ld-warn' : '') + '">' + esc(jobText) + '</div>' : '') +
        (error ? '<div class="ld-warn">' + esc(error) + '</div>' : '') +
        (job.log && (busy || job.ok === false) ? '<pre class="ld-log">' + esc(job.log) + '</pre>' : '') +
        '</div>';

      html += '<div class="ld-card"><span class="ld-label">' + esc(t('ld_commands')) + '</span>' +
        '<div class="ld-dim">' + esc(t('ld_commands_desc')) + '</div>';
      COMMANDS.forEach(function (c) {
        html += '<div class="ld-dim">' + esc(t(c[1])) + '</div>' +
          '<div class="ld-cmd"><code>' + esc(c[0]) + '</code>' +
          '<button class="s-btn s-btn-sm" data-copy="' + esc(c[0]) + '">' + esc(t('ld_copy')) + '</button></div>';
      });
      html += '</div>';

      var log = el.querySelector('.ld-log'), scrolled = log && log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
      el.innerHTML = html;
      log = el.querySelector('.ld-log');
      if (log && (scrolled || busy)) log.scrollTop = log.scrollHeight;
    }

    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (b) { act(b.getAttribute('data-act')); return; }
      var c = e.target.closest('[data-copy]');
      if (c) copy(c.getAttribute('data-copy')).then(function () {
        c.textContent = t('ld_copied');
        setTimeout(function () { c.textContent = t('ld_copy'); }, 1500);
      }).catch(function () {});
    });
    el.addEventListener('change', function (e) {
      if (!e.target.matches('[data-auto]')) return;
      var on = e.target.checked;
      e.target.checked = !on;  // shows the real state once the server confirms it
      act(on ? 'enable' : 'disable');
    });

    refresh();
  }

  mvmOS.registerApp({
    id: 'local-display', name: 'Local Display', icon: '📺', category: 'System & Administration',
    launch: function () {
      mvmOS.createWindow({
        id: 'local-display', title: '📺 Local Display', width: 560, height: 620,
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
