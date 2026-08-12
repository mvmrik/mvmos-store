// Shared mvm2factor widget used by the desktop window and public page.
(function () {
  if (window.Mvm2FactorWidget) return;

  var API = '/pub/mvm2factor';
  var CIRC = 2 * Math.PI * 18;

  function t(key, vars) {
    return (window.t || function (k) { return k; })(key, vars);
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
    });
  }

  function color(name) {
    var palette = ['#89b4fa','#a6e3a1','#fab387','#f38ba8','#cba6f7','#94e2d5','#f9e2af','#74c7ec'];
    var hash = 0;
    for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent = `
      .m2f-widget,.m2f-widget *{box-sizing:border-box}
      .m2f-widget{height:100%;width:100%;max-width:100%;min-width:0;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);
        color:var(--pub-fg,#cdd6f4);font-family:system-ui,sans-serif;overflow:hidden}
      .m2f-login,.m2f-error,.m2f-empty{display:flex;align-items:center;justify-content:center;height:100%;
        width:100%;max-width:100%;min-width:0;color:var(--pub-fg2,#a6adc8);text-align:center;padding:1.25rem;overflow-wrap:anywhere}
      .m2f-toolbar{display:flex;align-items:center;gap:.5rem;padding:.75rem .875rem .5rem;flex-wrap:wrap;flex-shrink:0;width:100%;max-width:100%;min-width:0}
      .m2f-toolbar-title{font-size:.78rem;font-weight:700;color:var(--pub-dim,#6c7086);
        text-transform:uppercase;letter-spacing:.09em;white-space:nowrap}
      .m2f-sort{flex:1 1 9rem;width:0;max-width:100%;min-width:9rem;background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);
        border:1px solid var(--pub-border,#45475a);border-radius:.4rem;padding:.35rem .5rem;font-size:.8rem;outline:none}
      .m2f-add{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border:0;border-radius:50%;
        width:1.8rem;height:1.8rem;cursor:pointer;font-size:1.15rem;font-weight:800;display:flex;align-items:center;justify-content:center}
      .m2f-transfer{position:relative}.m2f-tools{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);border:0;border-radius:.4rem;
        width:1.8rem;height:1.8rem;cursor:pointer;font-size:1rem}.m2f-transfer-menu{position:absolute;right:0;top:calc(100% + .3rem);z-index:10;
        min-width:12rem;padding:.35rem;background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);border-radius:.45rem;box-shadow:0 .5rem 1.4rem rgba(0,0,0,.35)}
      .m2f-transfer-menu[hidden]{display:none}.m2f-transfer-menu button{display:block;width:100%;border:0;background:none;color:var(--pub-fg,#cdd6f4);padding:.45rem;text-align:left;cursor:pointer;font:inherit;font-size:.8rem;border-radius:.3rem}.m2f-transfer-menu button:hover{background:var(--pub-border,#45475a)}
      /* min-height:0 is not optional here: a flex item refuses to shrink below
         its content by default, so without it the list grows past the widget
         instead of scrolling inside it, and the last cards are cut off by the
         window rather than reachable. */
      .m2f-list{flex:1;min-height:0;width:100%;max-width:100%;min-width:0;overflow-x:hidden;overflow-y:auto;padding:0 .875rem .875rem}
      .m2f-card{background:var(--pub-surface2,#313244);border-radius:.65rem;padding:.8rem .9rem .7rem;
        margin-bottom:.5rem;position:relative;border:1px solid transparent}
      .m2f-card:hover{border-color:var(--pub-border,#45475a)}
      .m2f-card-head{display:flex;align-items:center;gap:.65rem;margin-bottom:.7rem;padding-right:1.5rem}
      .m2f-avatar{width:2.25rem;height:2.25rem;border-radius:.5rem;border:1.5px solid currentColor;
        display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0}
      .m2f-name-wrap{min-width:0}.m2f-name{font-weight:600;font-size:.93rem;overflow-wrap:anywhere}
      .m2f-issuer{font-size:.75rem;color:var(--pub-dim,#6c7086);overflow-wrap:anywhere;margin-top:.1rem}
      .m2f-site{font-size:.7rem;color:var(--pub-accent,#89b4fa);overflow-wrap:anywhere;margin-top:.15rem}
      .m2f-context{width:100%;font-size:.72rem;color:var(--pub-fg2,#a6adc8);overflow-wrap:anywhere}
      .m2f-delete{position:absolute;top:.55rem;right:.65rem;background:none;border:0;color:var(--pub-dim,#6c7086);
        cursor:pointer;font-size:.85rem;padding:.2rem .3rem;border-radius:.25rem}
      .m2f-delete:hover{color:var(--pub-red,#f38ba8);background:rgba(243,139,168,.12)}
      .m2f-card-body{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
      .m2f-code{font-size:1.75rem;font-weight:700;letter-spacing:.14em;font-family:monospace;cursor:pointer;
        user-select:all;line-height:1;white-space:nowrap}
      .m2f-code.refreshed{animation:m2f-pop .35s ease}
      @keyframes m2f-pop{0%{transform:scale(.96);opacity:.5}60%{transform:scale(1.03)}100%{transform:scale(1);opacity:1}}
      .m2f-copy{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);border:0;border-radius:.35rem;
        padding:.3rem .7rem;font-size:.78rem;cursor:pointer;margin-top:.45rem}
      .m2f-copy.ok{background:var(--pub-green,#a6e3a1);color:var(--pub-bg,#1e1e2e)}
      .m2f-fill{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border:0;border-radius:.35rem;
        padding:.3rem .7rem;font-size:.78rem;cursor:pointer;margin-top:.45rem;margin-left:.3rem;font-weight:700}
      .m2f-timer{display:flex;flex-direction:column;align-items:center;gap:.2rem}
      .m2f-timer span{font-size:.7rem;color:var(--pub-dim,#6c7086);font-variant-numeric:tabular-nums;font-weight:600}
      /* overflow:auto on the overlay and the max-height/overflow pair on the
         dialog are what keep a tall dialog reachable. Without them the dialog
         is free to grow past the window, and because a centred box that has not
         overflowed its parent produces no scrollbar anywhere, its lower half —
         including the action buttons — simply ends up off-screen with no way to
         reach it. That is unnoticeable in a desktop window and fatal in a
         browser popup, which is only ~560px tall. */
      .m2f-overlay{position:absolute;inset:0;background:rgba(0,0,0,.6);z-index:100;display:flex;
        align-items:center;justify-content:center;padding:1rem;overflow:auto}
      .m2f-dialog{background:var(--pub-surface2,#313244);border-radius:.75rem;padding:1.3rem;width:100%;max-width:22rem;
        max-height:100%;min-height:0;overflow:auto;flex:0 1 auto;
        box-shadow:0 .75rem 2.5rem rgba(0,0,0,.45)}
      .m2f-dialog h3{font-size:1rem;margin:0 0 1rem}
      .m2f-input{box-sizing:border-box;width:100%;background:var(--pub-bg,#1e1e2e);
        border:1.5px solid var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);border-radius:.45rem;
        padding:.6rem .7rem;font-size:.9rem;outline:none;font-family:inherit;margin-bottom:.55rem}
      .m2f-input:focus{border-color:var(--pub-accent,#89b4fa)}.m2f-input.mono{font-family:monospace;letter-spacing:.07em}
      .m2f-dialog-error{color:var(--pub-red,#f38ba8);font-size:.8rem;min-height:1.25rem;margin-bottom:.6rem}
      .m2f-actions{display:flex;gap:.5rem;flex-wrap:wrap}.m2f-btn{flex:1;border:0;border-radius:.45rem;padding:.6rem;
        cursor:pointer;font-size:.9rem;font-weight:600;white-space:nowrap}
      .m2f-btn-secondary{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}
      .m2f-btn-primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e)}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    var token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = '<div class="m2f-login">' + esc(t('m2f_login_required')) + '</div>';
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy: function () {} };
    }

    var destroyed = false;
    var accounts = [];
    var sortBy = 'newest';
    var lastStep = -1;
    var frame = null;
    var extensionContext = null;
    var extensionSettings = {};
    var extensionParentOrigin = '';
    var canTransfer = window.parent === window;

    root.style.position = 'relative';
    root.innerHTML = `<div class="m2f-widget">
      <div class="m2f-toolbar">
        <span class="m2f-toolbar-title">${esc(t('m2f_accounts'))}</span>
        <select class="m2f-sort">
          <option value="newest">${esc(t('m2f_sort_newest'))}</option>
          <option value="last_used">${esc(t('m2f_sort_used'))}</option>
        </select>
        <button class="m2f-add" title="${esc(t('m2f_add_account'))}">+</button>
        ${canTransfer ? `<div class="m2f-transfer"><button class="m2f-tools" title="${esc(t('m2f_transfer'))}" aria-label="${esc(t('m2f_transfer'))}">⋮</button><div class="m2f-transfer-menu" hidden><button data-transfer="backup">${esc(t('m2f_export_backup'))}</button><button data-transfer="csv">${esc(t('m2f_export_csv'))}</button><button data-transfer="import">${esc(t('m2f_import'))}</button></div></div>` : ''}
        <div class="m2f-context" style="display:none"></div>
      </div>
      <div class="m2f-list"></div>
    </div>`;

    var listEl = root.querySelector('.m2f-list');
    var sortEl = root.querySelector('.m2f-sort');
    var contextEl = root.querySelector('.m2f-context');

    function hostMatches(currentHost, accountHost) {
      currentHost = String(currentHost || '').toLowerCase().replace(/^www\./, '');
      accountHost = String(accountHost || '').toLowerCase().replace(/^www\./, '');
      return Boolean(accountHost) && (
        currentHost === accountHost || currentHost.endsWith('.' + accountHost)
      );
    }

    function extensionFiltered() {
      return extensionContext && extensionSettings.filter_mode === 'matching';
    }

    function visibleAccounts() {
      var result = accounts.slice();
      if (extensionFiltered()) {
        result = result.filter(function (account) {
          return hostMatches(extensionContext.hostname, account.website_host);
        });
      }
      return result;
    }

    function api(path, options) {
      options = options || {};
      var headers = Object.assign(
        {'X-Pub-Token': token, 'Content-Type': 'application/json'},
        options.headers || {}
      );
      return fetch(API + path, Object.assign({}, options, {headers: headers})).then(async function (response) {
        var data = await response.json().catch(function () { return {}; });
        if (response.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        if (!response.ok) throw new Error(data.error || ('http_' + response.status));
        return data;
      });
    }

    function sortedAccounts() {
      var result = visibleAccounts();
      if (sortBy === 'last_used') {
        result.sort(function (a, b) { return (b.last_used || 0) - (a.last_used || 0); });
      } else {
        result.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
      }
      return result;
    }

    function arc(accountId) {
      return `<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="18" fill="none" stroke="var(--pub-crust,#2a2a3d)" stroke-width="3.5"/>
        <circle id="m2f-arc-${esc(accountId)}" cx="22" cy="22" r="18" fill="none"
          stroke="var(--pub-accent,#89b4fa)" stroke-width="3.5" stroke-dasharray="${CIRC.toFixed(3)}"
          stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90 22 22)"/>
      </svg>`;
    }

    function render() {
      var sorted = sortedAccounts();
      if (!sorted.length) {
        var emptyKey = extensionFiltered()
          ? (extensionContext.hostname ? 'm2f_no_matching_accounts' : 'm2f_no_current_website')
          : 'm2f_no_accounts';
        listEl.innerHTML = '<div class="m2f-empty">' + esc(t(emptyKey, {
          host: extensionContext ? extensionContext.hostname : ''
        })) + '</div>';
        return;
      }
      listEl.innerHTML = sorted.map(function (account) {
        var accountColor = color(account.name);
        var initial = (account.name.trim()[0] || '?').toUpperCase();
        var code = account.code || '------';
        var formatted = code.slice(0, 3) + ' ' + code.slice(3);
        return `<div class="m2f-card" data-account-id="${esc(account.id)}">
          <button class="m2f-delete" data-delete="${esc(account.id)}" title="${esc(t('m2f_delete'))}">✕</button>
          <div class="m2f-card-head">
            <div class="m2f-avatar" style="color:${accountColor};background:${accountColor}1a">${esc(initial)}</div>
            <div class="m2f-name-wrap">
              <div class="m2f-name">${esc(account.name)}</div>
              ${account.issuer ? `<div class="m2f-issuer">${esc(account.issuer)}</div>` : ''}
              ${account.website_host ? `<div class="m2f-site">🌐 ${esc(account.website_host)}</div>` : ''}
            </div>
          </div>
          <div class="m2f-card-body">
            <div>
              <div class="m2f-code" style="color:${accountColor}">${esc(formatted)}</div>
              <button class="m2f-copy" data-copy="${esc(account.id)}">${esc(t('m2f_copy'))}</button>
              ${extensionContext ? `<button class="m2f-fill" data-fill="${esc(account.id)}">${esc(t('m2f_fill'))}</button>` : ''}
            </div>
            <div class="m2f-timer">${arc(account.id)}<span id="m2f-seconds-${esc(account.id)}">30${esc(t('m2f_seconds'))}</span></div>
          </div>
        </div>`;
      }).join('');
    }

    async function load(showError) {
      try {
        var values = await Promise.all([api('/accounts'), api('/prefs')]);
        accounts = values[0];
        sortBy = values[1].sort_by || 'newest';
        sortEl.value = sortBy;
        render();
      } catch (error) {
        if (showError !== false) listEl.innerHTML = '<div class="m2f-error">' + esc(t('m2f_error_loading')) + '</div>';
      }
    }

    function tick() {
      if (destroyed) return;
      var now = Date.now();
      var step = Math.floor(now / 30000);
      var millisecondsLeft = 30000 - (now % 30000);
      var secondsLeft = Math.ceil(millisecondsLeft / 1000);
      var offset = (CIRC * (1 - millisecondsLeft / 30000)).toFixed(3);
      var timerColor = secondsLeft <= 5 ? 'var(--pub-red,#f38ba8)' :
        secondsLeft <= 10 ? 'var(--pub-warning,#fab387)' : 'var(--pub-accent,#89b4fa)';
      accounts.forEach(function (account) {
        var arcEl = root.querySelector('#m2f-arc-' + CSS.escape(account.id));
        var secondsEl = root.querySelector('#m2f-seconds-' + CSS.escape(account.id));
        if (arcEl) {
          arcEl.setAttribute('stroke-dashoffset', offset);
          arcEl.setAttribute('stroke', timerColor);
        }
        if (secondsEl) {
          secondsEl.textContent = secondsLeft + t('m2f_seconds');
          secondsEl.style.color = timerColor;
        }
      });
      if (lastStep !== -1 && step !== lastStep) load(false);
      lastStep = step;
      frame = requestAnimationFrame(tick);
    }

    function openDialog() {
      var overlay = document.createElement('div');
      overlay.className = 'm2f-overlay';
      overlay.innerHTML = `<div class="m2f-dialog">
        <h3>${esc(t('m2f_add_account'))}</h3>
        <input class="m2f-input m2f-name-input" placeholder="${esc(t('m2f_account_name'))}">
        <input class="m2f-input m2f-issuer-input" placeholder="${esc(t('m2f_issuer'))}">
        <input class="m2f-input m2f-website-input" placeholder="${esc(t('m2f_website'))}">
        <input class="m2f-input mono m2f-secret-input" placeholder="${esc(t('m2f_secret'))}">
        <div class="m2f-dialog-error"></div>
        <div class="m2f-actions">
          <button class="m2f-btn m2f-btn-secondary m2f-cancel">${esc(t('m2f_cancel'))}</button>
          <button class="m2f-btn m2f-btn-primary m2f-save">${esc(t('m2f_save'))}</button>
        </div>
      </div>`;
      root.querySelector('.m2f-widget').appendChild(overlay);
      var nameInput = overlay.querySelector('.m2f-name-input');
      var issuerInput = overlay.querySelector('.m2f-issuer-input');
      var websiteInput = overlay.querySelector('.m2f-website-input');
      var secretInput = overlay.querySelector('.m2f-secret-input');
      var errorEl = overlay.querySelector('.m2f-dialog-error');
      var saveEl = overlay.querySelector('.m2f-save');
      if (extensionContext && extensionContext.url) {
        try { websiteInput.value = new URL(extensionContext.url).origin; } catch (_) {}
      }

      function close() { overlay.remove(); }
      overlay.querySelector('.m2f-cancel').onclick = close;
      overlay.addEventListener('click', function (event) { if (event.target === overlay) close(); });
      saveEl.onclick = async function () {
        var name = nameInput.value.trim();
        var issuer = issuerInput.value.trim();
        var websiteUrl = websiteInput.value.trim();
        var secret = secretInput.value.trim().toUpperCase().replace(/[\\s=]/g, '');
        errorEl.textContent = '';
        if (!name) { errorEl.textContent = t('m2f_name_required'); return; }
        if (!secret) { errorEl.textContent = t('m2f_secret_required'); return; }
        if (!/^[A-Z2-7]+$/.test(secret)) { errorEl.textContent = t('m2f_invalid_secret'); return; }
        saveEl.disabled = true;
        try {
          await api('/accounts', {
            method: 'POST',
            body: JSON.stringify({name: name, issuer: issuer, secret: secret, website_url: websiteUrl})
          });
          close();
          await load();
        } catch (error) {
          errorEl.textContent = error.message === 'invalid_secret' ? t('m2f_invalid_secret') :
            error.message === 'invalid_website' ? t('m2f_invalid_website') : t('m2f_error_saving');
        } finally {
          saveEl.disabled = false;
        }
      };
      [nameInput, issuerInput, websiteInput, secretInput].forEach(function (input) {
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') saveEl.click();
        });
      });
      setTimeout(function () { nameInput.focus(); }, 50);
    }

    async function copyAccount(account, button) {
      if (!account || !account.code) return;
      await navigator.clipboard.writeText(account.code).catch(function () {});
      api('/accounts/' + encodeURIComponent(account.id) + '/use', {method: 'POST'}).catch(function () {});
      account.last_used = Math.floor(Date.now() / 1000);
      if (button) {
        button.textContent = t('m2f_copied');
        button.classList.add('ok');
        setTimeout(function () {
          button.textContent = t('m2f_copy');
          button.classList.remove('ok');
        }, 1600);
      }
    }

    function download(filename, text, type) {
      var blob = new Blob([text], {type: type});
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    }

    function csv(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }
    function csvRows(text) {
      var rows = [], row = [], value = '', quoted = false;
      for (var i = 0; i < text.length; i++) {
        var char = text[i];
        if (quoted) { if (char === '"') { if (text[i + 1] === '"') { value += char; i++; } else quoted = false; } else value += char; }
        else if (char === '"') quoted = true;
        else if (char === ',' || char === ';' || char === '\t') { row.push(value); value = ''; }
        else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.length > 1 || row[0]) rows.push(row); row = []; value = ''; }
        else value += char;
      }
      row.push(value); if (row.length > 1 || row[0]) rows.push(row);
      return rows;
    }

    function parseTransfer(text, filename) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
      if (parsed && parsed.format === 'mvm2factor-backup' && parsed.version === 1 && Array.isArray(parsed.accounts)) {
        return {accounts: parsed.accounts, preferences: parsed.preferences || {}};
      }
      if (Array.isArray(parsed)) return {accounts: parsed, preferences: {}};
      var rows = csvRows(text), header = (rows.shift() || []).map(function (x) { return String(x).trim().toLowerCase(); });
      function col(names) { for (var i = 0; i < names.length; i++) { var index = header.indexOf(names[i]); if (index >= 0) return index; } return -1; }
      var secret = col(['secret', 'secret key', 'seed', 'token']), name = col(['name', 'account', 'label']), issuer = col(['issuer', 'username', 'email']), website = col(['website', 'url', 'site']);
      if (secret < 0 || (name < 0 && issuer < 0)) return null;
      return {accounts: rows.map(function (row) { return {name: String(row[name] || row[issuer] || '').trim(), issuer: issuer < 0 ? '' : String(row[issuer] || '').trim(), secret: String(row[secret] || '').trim(), website_url: website < 0 ? '' : String(row[website] || '').trim()}; }), preferences: {}};
    }

    async function exportBackup() {
      if (!confirm(t('m2f_backup_warning'))) return;
      var backup = await api('/backup');
      download('mvm2factor-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup, null, 2), 'application/json');
    }

    async function exportCsv() {
      if (!confirm(t('m2f_csv_warning'))) return;
      var backup = await api('/backup');
      var lines = ['name,issuer,secret,website'];
      backup.accounts.forEach(function (account) { lines.push([account.name, account.issuer, account.secret, account.website_url].map(csv).join(',')); });
      download('mvm2factor-export-' + new Date().toISOString().slice(0, 10) + '.csv', lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    }

    function importAccounts() {
      var input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.csv,text/csv,application/json';
      input.onchange = function () {
        var file = input.files && input.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = async function () {
          var data = parseTransfer(String(reader.result || ''), file.name);
          if (!data || !data.accounts.length) { alert(t('m2f_import_invalid')); return; }
          if (!confirm(t('m2f_import_warning', {n: data.accounts.length}))) return;
          var saved = 0;
          for (var i = 0; i < data.accounts.length; i++) {
            var account = data.accounts[i] || {};
            try { await api('/accounts', {method: 'POST', body: JSON.stringify({name: account.name || account.issuer || '', issuer: account.issuer || '', secret: account.secret || '', website_url: account.website_url || account.website || ''})}); saved++; } catch (_) {}
          }
          if (data.preferences.sort_by === 'newest' || data.preferences.sort_by === 'last_used') { sortBy = data.preferences.sort_by; await api('/prefs', {method: 'POST', body: JSON.stringify({sort_by: sortBy})}); }
          await load(); alert(t('m2f_import_done', {n: saved}));
        };
        reader.readAsText(file);
      };
      input.click();
    }

    root.querySelector('.m2f-add').onclick = openDialog;
    var transfer = root.querySelector('.m2f-transfer');
    if (transfer) {
      var transferMenu = transfer.querySelector('.m2f-transfer-menu');
      transfer.querySelector('.m2f-tools').onclick = function (event) { event.stopPropagation(); transferMenu.hidden = !transferMenu.hidden; };
      transfer.onclick = function (event) {
        var action = event.target.dataset.transfer; if (!action) return;
        transferMenu.hidden = true;
        if (action === 'backup') exportBackup().catch(function () { alert(t('m2f_error_loading')); });
        else if (action === 'csv') exportCsv().catch(function () { alert(t('m2f_error_loading')); });
        else importAccounts();
      };
      document.addEventListener('click', function () { transferMenu.hidden = true; });
    }
    sortEl.onchange = function () {
      sortBy = sortEl.value;
      render();
      api('/prefs', {method: 'POST', body: JSON.stringify({sort_by: sortBy})}).catch(function () {});
    };
    listEl.addEventListener('click', async function (event) {
      var fillButton = event.target.closest('[data-fill]');
      if (fillButton) {
        var fillAccount = accounts.find(function (item) { return item.id === fillButton.dataset.fill; });
        if (fillAccount && extensionParentOrigin) {
          window.parent.postMessage({
            source: 'mvmos-public-app',
            appId: 'mvm2factor',
            action: 'autofill',
            code: fillAccount.code
          }, extensionParentOrigin);
          api('/accounts/' + encodeURIComponent(fillAccount.id) + '/use', {method: 'POST'}).catch(function () {});
        }
        return;
      }
      var copyButton = event.target.closest('[data-copy]');
      if (copyButton) {
        await copyAccount(accounts.find(function (item) { return item.id === copyButton.dataset.copy; }), copyButton);
        return;
      }
      var codeEl = event.target.closest('.m2f-code');
      if (codeEl) {
        var card = codeEl.closest('[data-account-id]');
        await copyAccount(accounts.find(function (item) { return item.id === card.dataset.accountId; }));
        return;
      }
      var deleteButton = event.target.closest('[data-delete]');
      if (deleteButton) {
        var account = accounts.find(function (item) { return item.id === deleteButton.dataset.delete; });
        if (account && confirm(t('m2f_delete_confirm', {name: account.name}))) {
          await api('/accounts/' + encodeURIComponent(account.id), {method: 'DELETE'});
          await load();
        }
      }
    });

    function onExtensionMessage(event) {
      if (event.source !== window.parent || window.parent === window) return;
      if (!/^chrome-extension:\/\/|^moz-extension:\/\//.test(event.origin)) return;
      var message = event.data || {};
      if (
        message.source !== 'mvmos-extension' ||
        message.appId !== 'mvm2factor' ||
        message.type !== 'context'
      ) return;
      extensionParentOrigin = event.origin;
      extensionContext = message.context || {};
      extensionSettings = message.settings || {};
      if (extensionContext.hostname) {
        contextEl.style.display = '';
        contextEl.textContent = extensionFiltered()
          ? t('m2f_matching_site', {host: extensionContext.hostname})
          : t('m2f_current_site', {host: extensionContext.hostname});
      }
      render();
    }
    window.addEventListener('message', onExtensionMessage);
    if (window.parent !== window) {
      window.parent.postMessage({
        source: 'mvmos-public-app',
        appId: 'mvm2factor',
        action: 'ready'
      }, '*');
    }

    load().then(function () {
      if (!frame) frame = requestAnimationFrame(tick);
    });

    return {
      destroy: function () {
        destroyed = true;
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('message', onExtensionMessage);
      }
    };
  }

  window.Mvm2FactorWidget = {mount: mount};
})();
