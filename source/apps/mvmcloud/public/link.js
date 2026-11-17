/* Public mvmCloud link: opens a shared file or folder without an account, behind an optional password. */
(function () {
  var lang = (navigator.language || 'en'), map = {bg: 'bg', de: 'de', es: 'es', fr: 'fr', ja: 'ja', ru: 'ru', pt: 'pt-BR', zh: 'zh-CN'};
  window.mvmOS = window.mvmOS || {};
  if (!window.mvmOS.lang) window.mvmOS.lang = map[lang.slice(0, 2).toLowerCase()] || 'en';
  var id = (location.pathname.match(/\/p\/([^\/?#]+)/) || [])[1] || '';
  var API = '/pub/mvmcloud/pl/' + encodeURIComponent(id);
  var app = document.getElementById('app'), ticket = '', path = '', info = null;
  function tr(k, v) { return window.MvmCloudT ? window.MvmCloudT(k, v) : k; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function fmt(n) { if (n < 1024) return n + ' B'; var u = ['KB', 'MB', 'GB', 'TB'], i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < 3); return n.toFixed(n < 10 && i ? 1 : 0) + ' ' + u[i]; }
  var css = document.createElement('style');
  css.textContent = '.pl{max-width:680px;margin:0 auto;padding:24px 16px}.pl h1{font-size:18px;margin:0 0 4px;overflow-wrap:anywhere}.pl .sub{color:#a6adc8;margin-bottom:18px;font-size:13px}.pl .card{background:#313244;border-radius:12px;padding:18px}.pl input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #45475a;background:#1e1e2e;color:inherit;font:inherit;margin:8px 0}.pl button,.pl a.btn{display:inline-block;border:0;border-radius:8px;padding:10px 16px;background:#89b4fa;color:#1e1e2e;font:inherit;font-weight:700;cursor:pointer;text-decoration:none}.pl .err{color:#f38ba8;margin-top:6px;min-height:18px}.pl .row{display:flex;gap:12px;align-items:center;padding:12px 4px;border-top:1px solid #45475a;cursor:pointer}.pl .row:hover{background:#3b3d52}.pl .row .name{flex:1;overflow-wrap:anywhere}.pl small{color:#a6adc8}.pl .crumbs{margin:8px 0 12px;color:#a6adc8;font-size:13px}.pl .crumbs a{color:#89b4fa;cursor:pointer}.pl .brand{margin-top:26px;text-align:center;font-size:12px;color:#6c7086}';
  document.head.appendChild(css);
  function shell(inner) { app.innerHTML = '<div class="pl">' + inner + '<div class="brand">☁️ mvmCloud</div></div>'; }
  function fail(msg) { shell('<div class="card"><h1>' + esc(tr('mc_pl_unavailable')) + '</h1><div class="sub">' + esc(msg || '') + '</div></div>'); }
  function get(url) { return fetch(url).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) { var e = Error(typeof d.detail === 'string' ? d.detail : tr('mc_request_failed')); e.status = r.status; throw e; } return d; }); }); }
  function fileUrl(p, dl) { return API + '/file?a=' + encodeURIComponent(ticket) + '&path=' + encodeURIComponent(p || '') + (dl ? '' : '&dl=0'); }
  function unlock(password) {
    return fetch(API + '/unlock', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: password || ''})}).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw Error(r.status === 403 ? tr('mc_pl_wrong') : r.status === 429 ? tr('mc_pl_many') : tr('mc_pl_unavailable')); ticket = d.ticket; });
    });
  }
  function askPassword() {
    shell('<div class="card"><h1>🔒 ' + esc(info.name) + '</h1><div class="sub">' + esc(tr('mc_pl_needs_password')) + '</div><form><input type="password" autocomplete="current-password" placeholder="' + esc(tr('mc_pl_password')) + '" autofocus><div class="err"></div><button>' + esc(tr('mc_pl_open')) + '</button></form></div>');
    app.querySelector('form').onsubmit = function (e) { e.preventDefault(); unlock(app.querySelector('input').value).then(show).catch(function (x) { app.querySelector('.err').textContent = x.message; }); };
  }
  function show() {
    if (!info.is_dir) {
      shell('<div class="card"><h1>📄 ' + esc(info.name) + '</h1><div class="sub">' + esc(fmt(info.size)) + '</div><a class="btn" href="' + fileUrl('', true) + '">⬇ ' + esc(tr('mc_download')) + '</a></div>');
      return;
    }
    get(API + '/list?a=' + encodeURIComponent(ticket) + '&path=' + encodeURIComponent(path)).then(function (d) {
      var parts = path ? path.split('/') : [], crumbs = '<a data-p="">' + esc(info.name) + '</a>';
      parts.forEach(function (p, i) { crumbs += ' / ' + (i < parts.length - 1 ? '<a data-p="' + esc(parts.slice(0, i + 1).join('/')) + '">' + esc(p) + '</a>' : '<span>' + esc(p) + '</span>'); });
      var rows = d.entries.map(function (e) { return '<div class="row" data-n="' + esc(e.name) + '" data-t="' + e.type + '"><span>' + (e.type === 'folder' ? '📁' : '📄') + '</span><span class="name">' + esc(e.name) + '</span><small>' + (e.type === 'file' ? esc(fmt(e.size)) : '') + '</small></div>'; }).join('') || '<div class="sub" style="padding:14px">' + esc(tr('mc_empty')) + '</div>';
      shell('<h1>📁 ' + esc(info.name) + '</h1><div class="crumbs">' + crumbs + '</div><div class="card" style="padding:6px 14px">' + rows + '</div>');
      app.querySelectorAll('[data-p]').forEach(function (a) { a.onclick = function () { path = a.dataset.p; show(); }; });
      app.querySelectorAll('.row').forEach(function (r) { r.onclick = function () { var next = path ? path + '/' + r.dataset.n : r.dataset.n; if (r.dataset.t === 'folder') { path = next; show(); } else location.href = fileUrl(next, true); }; });
    }).catch(function (e) { if (e.status === 401) askPassword(); else fail(e.message); });
  }
  function boot() {
    get(API + '/info').then(function (d) { info = d; if (d.needs_password) askPassword(); else unlock('').then(show).catch(function (e) { fail(e.message); }); }).catch(function (e) { fail(e.message); });
  }
  var s = document.createElement('script'); s.src = window.asset('/apps/mvmcloud/i18n.js'); s.onload = boot; s.onerror = boot; document.head.appendChild(s);
})();
