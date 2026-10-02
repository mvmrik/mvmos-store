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

  // ---- crypto ------------------------------------------------------------
  // The same construction as mvmPasswords: PBKDF2-SHA256 stretches a password
  // the server never sees into an AES-GCM key, and every secret is stored as
  // its own iv + ciphertext. The check value is encrypted with the same key,
  // so a wrong password is caught even in a vault that has no accounts yet.
  var ITERATIONS = 600000;
  var MIN_PASSWORD = 10;
  var CHECK = 'mvm2factor';
  var SESSION_KEY = 'mvm_2fa_vault_session';
  var DURATION_KEY = 'mvm_2fa_unlock_duration';

  function b64(buffer) {
    var text = '';
    new Uint8Array(buffer).forEach(function (x) { text += String.fromCharCode(x); });
    return btoa(text);
  }

  function bytes(text) {
    var bin = atob(text), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function base32(secret) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var clean = String(secret || '').toUpperCase().replace(/[\s=]/g, '');
    if (!clean || !/^[A-Z2-7]+$/.test(clean)) throw new Error('invalid_secret');
    var bits = 0, value = 0, out = [];
    for (var i = 0; i < clean.length; i++) {
      value = (value << 5) | alphabet.indexOf(clean[i]);
      bits += 5;
      if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
    }
    if (!out.length) throw new Error('invalid_secret');
    return new Uint8Array(out);
  }

  async function totp(secret, step) {
    var hmac = await crypto.subtle.importKey('raw', base32(secret), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
    var counter = new DataView(new ArrayBuffer(8));
    counter.setUint32(0, Math.floor(step / 4294967296));
    counter.setUint32(4, step >>> 0);
    var digest = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, counter.buffer));
    var offset = digest[digest.length - 1] & 15;
    var number = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
    return String(number % 1000000).padStart(6, '0');
  }

  async function derive(password, salt, iterations) {
    var raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name: 'PBKDF2', salt: bytes(salt), iterations: iterations, hash: 'SHA-256'},
      raw, {name: 'AES-GCM', length: 256}, true, ['encrypt', 'decrypt']);
  }

  async function seal(key, value) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = await crypto.subtle.encrypt({name: 'AES-GCM', iv: iv}, key, new TextEncoder().encode(JSON.stringify(value)));
    return {iv: b64(iv), ciphertext: b64(data)};
  }

  async function open(key, iv, ciphertext) {
    var data = await crypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(iv)}, key, bytes(ciphertext));
    return JSON.parse(new TextDecoder().decode(data));
  }

  // Whether a key opens this vault. A wrong key fails the AES-GCM tag check.
  async function opensVault(key, vault) {
    try { return (await open(key, vault.check_iv, vault.check_ct)).check === CHECK; }
    catch (_) { return false; }
  }

  function isLightTheme() {
    var pref = localStorage.getItem('apphub_theme') || 'dark';
    if (pref === 'auto') return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    return pref === 'light';
  }

  function color(name) {
    // Two palettes so hash-based account colors stay readable in both
    // themes: the dark-theme pastels are too pale against a light card.
    var palette = isLightTheme()
      ? ['#1868c7','#1a7f37','#bc4b0f','#cf222e','#8250df','#0d8577','#9a6700','#0a6ebd']
      : ['#89b4fa','#a6e3a1','#fab387','#f38ba8','#cba6f7','#94e2d5','#f9e2af','#74c7ec'];
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
      .m2f-btn:disabled{opacity:.6;cursor:default}
      .m2f-lock{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4);border:0;border-radius:.4rem;
        width:1.8rem;height:1.8rem;cursor:pointer;font-size:.9rem}
      .m2f-unlock{display:flex;flex:1;align-items:center;justify-content:center;padding:1.25rem;overflow:auto;min-height:0}
      .m2f-unlock>div{width:100%;max-width:23rem;background:var(--pub-surface2,#313244);padding:1.25rem;border-radius:.7rem}
      .m2f-unlock h2{font-size:1.05rem;margin:0 0 .6rem}
      .m2f-unlock p{font-size:.82rem;line-height:1.45;color:var(--pub-fg2,#a6adc8);margin:0 0 .8rem}
      .m2f-unlock label{display:block;font-size:.76rem;font-weight:700;color:var(--pub-fg2,#a6adc8);margin:.2rem 0 .3rem}
      .m2f-unlock .m2f-btn{width:100%}
      .m2f-hint{font-size:.72rem;opacity:.75;margin:0 0 .7rem;line-height:1.35}
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
    var vault = null;
    var key = null;
    var autoLockTimer = 0;
    var lastStep = -1;
    var frame = null;
    var extensionContext = null;
    var extensionSettings = {};
    var extensionParentOrigin = '';
    var canTransfer = window.parent === window;
    var listEl = null, sortEl = null, contextEl = null, shown = false;

    root.style.position = 'relative';
    root.innerHTML = '<div class="m2f-widget"></div>';
    var widgetEl = root.querySelector('.m2f-widget');

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

    // ---- unlock session -----------------------------------------------------
    // Exactly how mvmPasswords keeps its unlocked key, and under a name of its
    // own: a timed unlock goes to localStorage so it outlives a closed tab, "until
    // closed" to sessionStorage, and every open pushes the deadline out by the
    // whole span again. The desktop window and the public page share an origin,
    // so they share this session. In the extension the popup keeps it instead,
    // because the page in its frame has no lasting storage of its own.
    function minutesOf(value) { return value === 'session' ? 0 : Number(value) || 0; }
    function expiry(minutes) { return minutes ? Date.now() + minutes * 60000 : 0; }
    function sessionStore(minutes) { return minutes ? localStorage : sessionStorage; }
    function scheduleAutoLock(expires) {
      clearTimeout(autoLockTimer);
      if (!expires) return;
      var remaining = expires - Date.now();
      if (remaining <= 0) { lockNow(); return; }
      autoLockTimer = setTimeout(lockNow, Math.min(remaining, 2147483647));
    }
    function saveSession(saved) {
      if (extensionParentOrigin) {
        window.parent.postMessage({source: 'mvmos-public-app', appId: 'mvm2factor', action: 'vault-session-save', session: saved}, extensionParentOrigin);
        return;
      }
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      try { sessionStore(saved.minutes).setItem(SESSION_KEY, JSON.stringify(saved)); } catch (_) {}
    }
    function renewSession(saved) {
      if (!saved || !saved.minutes) return saved;
      saved.expires = expiry(saved.minutes);
      saveSession(saved);
      return saved;
    }
    function readSession() {
      var found = null;
      [localStorage, sessionStorage].forEach(function (where) {
        if (found) return;
        var raw = null;
        try { raw = JSON.parse(where.getItem(SESSION_KEY) || 'null'); } catch (_) {}
        if (raw && (!raw.expires || raw.expires > Date.now())) found = raw;
        else if (raw) where.removeItem(SESSION_KEY);
      });
      return found;
    }
    async function cacheKey(duration) {
      var minutes = minutesOf(duration);
      var saved = {key: b64(await crypto.subtle.exportKey('raw', key)), expires: expiry(minutes), minutes: minutes};
      try { localStorage.setItem(DURATION_KEY, duration); } catch (_) {}
      scheduleAutoLock(saved.expires);
      saveSession(saved);
    }
    async function useSession(saved) {
      try {
        key = await crypto.subtle.importKey('raw', bytes(saved.key), {name: 'AES-GCM'}, true, ['encrypt', 'decrypt']);
      } catch (_) { key = null; return false; }
      scheduleAutoLock(renewSession(saved).expires);
      return true;
    }
    function clearCachedKey() {
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      if (extensionParentOrigin) {
        window.parent.postMessage({source: 'mvmos-public-app', appId: 'mvm2factor', action: 'vault-session-clear'}, extensionParentOrigin);
      }
    }
    function lockNow() {
      clearTimeout(autoLockTimer);
      autoLockTimer = 0;
      key = null;
      accounts = [];
      clearCachedKey();
      load();
    }
    // A page left in the background and opened again counts as opening it, the
    // way mvmPasswords renews on a resumed home-screen app.
    function onVisible() {
      if (document.hidden || !key || extensionParentOrigin) return;
      var saved = readSession();
      if (saved) scheduleAutoLock(renewSession(saved).expires);
      else lockNow();
    }

    // ---- screens ------------------------------------------------------------
    function durationSelect() {
      var current = localStorage.getItem(DURATION_KEY) || 'session';
      var options = [
        ['5', t('m2f_minutes', {n: 5})], ['15', t('m2f_minutes', {n: 15})], ['60', t('m2f_hour')],
        ['240', t('m2f_hours', {n: 4})], ['720', t('m2f_hours', {n: 12})], ['1440', t('m2f_hours', {n: 24})],
        ['10080', t('m2f_days', {n: 7})], ['session', t('m2f_until_closed')]
      ];
      return '<label>' + esc(t('m2f_unlock_for')) + '</label><select class="m2f-input m2f-duration">' +
        options.map(function (o) {
          return '<option value="' + o[0] + '"' + (o[0] === current ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select><div class="m2f-hint">' + esc(t('m2f_unlock_sliding')) + '</div>';
    }

    function lockScreen(html, onSubmit) {
      shown = false;
      widgetEl.innerHTML = '<div class="m2f-unlock"><div>' + html +
        '<div class="m2f-dialog-error"></div><button class="m2f-btn m2f-btn-primary m2f-go"></button></div></div>';
      var go = widgetEl.querySelector('.m2f-go');
      var errorEl = widgetEl.querySelector('.m2f-dialog-error');
      var inputs = widgetEl.querySelectorAll('input');
      async function submit() {
        if (go.disabled) return;
        errorEl.textContent = '';
        go.disabled = true;
        try { await onSubmit(errorEl); }
        finally { if (go.isConnected) go.disabled = false; }
      }
      go.onclick = submit;
      inputs.forEach(function (input) {
        input.addEventListener('keydown', function (event) { if (event.key === 'Enter') submit(); });
      });
      setTimeout(function () { if (inputs[0]) inputs[0].focus(); }, 30);
      return go;
    }

    // Shown once per profile, before the first account or on the first open
    // after this update. Accounts saved before it are encrypted here with the
    // password being chosen and the plaintext on the server is replaced in the
    // same request, so nothing is lost and nothing stays readable.
    function createScreen(legacy) {
      var go = lockScreen(
        '<h2>' + esc(t(legacy.length ? 'm2f_protect_title' : 'm2f_create_title')) + '</h2>' +
        '<p>' + esc(t(legacy.length ? 'm2f_protect_info' : 'm2f_create_info', {n: legacy.length})) + '</p>' +
        '<input class="m2f-input m2f-pass" type="password" autocomplete="new-password" placeholder="' + esc(t('m2f_password')) + '">' +
        '<input class="m2f-input m2f-confirm" type="password" autocomplete="new-password" placeholder="' + esc(t('m2f_confirm_password')) + '">' +
        durationSelect(),
        async function (errorEl) {
          var pass = widgetEl.querySelector('.m2f-pass').value;
          if (pass.length < MIN_PASSWORD) { errorEl.textContent = t('m2f_password_short', {n: MIN_PASSWORD}); return; }
          if (pass !== widgetEl.querySelector('.m2f-confirm').value) { errorEl.textContent = t('m2f_passwords_differ'); return; }
          var duration = widgetEl.querySelector('.m2f-duration').value;
          try {
            var salt = b64(crypto.getRandomValues(new Uint8Array(32)));
            var newKey = await derive(pass, salt, ITERATIONS);
            var check = await seal(newKey, {check: CHECK});
            var sealed = [];
            for (var i = 0; i < legacy.length; i++) {
              var box = await seal(newKey, {secret: legacy[i].secret});
              sealed.push({id: legacy[i].id, iv: box.iv, ciphertext: box.ciphertext});
            }
            await api('/vault', {method: 'POST', body: JSON.stringify({
              salt: salt, iterations: ITERATIONS, check_iv: check.iv, check_ct: check.ciphertext, accounts: sealed
            })});
            key = newKey;
            await cacheKey(duration);
            await load();
          } catch (error) {
            // Another window may have created the vault or added an account in
            // the meantime; start over from what the server has now.
            if (error.message === 'vault_exists' || error.message === 'accounts_changed') { await load(); return; }
            errorEl.textContent = t('m2f_error_saving');
          }
        }
      );
      go.textContent = t(legacy.length ? 'm2f_protect' : 'm2f_create');
    }

    function unlockScreen(error) {
      var go = lockScreen(
        '<h2>' + esc(t('m2f_unlock_title')) + '</h2><p>' + esc(t('m2f_unlock_info')) + '</p>' +
        '<input class="m2f-input m2f-pass" type="password" autocomplete="current-password" placeholder="' + esc(t('m2f_password')) + '">' +
        durationSelect(),
        async function (errorEl) {
          var pass = widgetEl.querySelector('.m2f-pass').value;
          var duration = widgetEl.querySelector('.m2f-duration').value;
          if (!pass) { errorEl.textContent = t('m2f_unlock_failed'); return; }
          var candidate = await derive(pass, vault.salt, vault.iterations);
          if (!(await opensVault(candidate, vault))) { errorEl.textContent = t('m2f_unlock_failed'); return; }
          key = candidate;
          await cacheKey(duration);
          await load();
        }
      );
      go.textContent = t('m2f_unlock');
      if (error) widgetEl.querySelector('.m2f-dialog-error').textContent = error;
    }

    function showMain() {
      if (shown) return;
      shown = true;
      widgetEl.innerHTML = `
      <div class="m2f-toolbar">
        <span class="m2f-toolbar-title">${esc(t('m2f_accounts'))}</span>
        <select class="m2f-sort">
          <option value="newest">${esc(t('m2f_sort_newest'))}</option>
          <option value="last_used">${esc(t('m2f_sort_used'))}</option>
        </select>
        <button class="m2f-add" title="${esc(t('m2f_add_account'))}">+</button>
        ${canTransfer ? `<div class="m2f-transfer"><button class="m2f-tools" title="${esc(t('m2f_transfer'))}" aria-label="${esc(t('m2f_transfer'))}">⋮</button><div class="m2f-transfer-menu" hidden><button data-transfer="backup">${esc(t('m2f_export_backup'))}</button><button data-transfer="csv">${esc(t('m2f_export_csv'))}</button><button data-transfer="import">${esc(t('m2f_import'))}</button></div></div>` : ''}
        <button class="m2f-lock" title="${esc(t('m2f_lock'))}" aria-label="${esc(t('m2f_lock'))}">🔒</button>
        <div class="m2f-context" style="display:none"></div>
      </div>
      <div class="m2f-list"></div>`;
      listEl = widgetEl.querySelector('.m2f-list');
      sortEl = widgetEl.querySelector('.m2f-sort');
      contextEl = widgetEl.querySelector('.m2f-context');
      sortEl.value = sortBy;
      widgetEl.querySelector('.m2f-add').onclick = openDialog;
      widgetEl.querySelector('.m2f-lock').onclick = lockNow;
      var transfer = widgetEl.querySelector('.m2f-transfer');
      if (transfer) {
        var transferMenu = transfer.querySelector('.m2f-transfer-menu');
        transfer.querySelector('.m2f-tools').onclick = function (event) { event.stopPropagation(); transferMenu.hidden = !transferMenu.hidden; };
        transfer.onclick = function (event) {
          var action = event.target.dataset.transfer; if (!action) return;
          transferMenu.hidden = true;
          if (action === 'backup') exportBackup();
          else if (action === 'csv') exportCsv();
          else importAccounts();
        };
      }
      sortEl.onchange = function () {
        sortBy = sortEl.value;
        render();
        api('/prefs', {method: 'POST', body: JSON.stringify({sort_by: sortBy})}).catch(function () {});
      };
      listEl.addEventListener('click', onListClick);
      showContext();
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
      if (!shown) return;
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

    // Codes are worked out here from the decrypted secrets; the server has
    // nothing left to compute them from.
    async function refreshCodes() {
      var step = Math.floor(Date.now() / 30000);
      await Promise.all(accounts.map(async function (account) {
        try { account.code = await totp(account.secret, step); } catch (_) { account.code = ''; }
      }));
    }

    async function load(showError) {
      try {
        var data = await api('/vault');
        vault = data.vault;
        sortBy = data.sort_by || 'newest';
        if (!vault) {
          key = null;
          createScreen((data.accounts || []).filter(function (account) { return account.secret; }));
          return;
        }
        if (!key && !extensionParentOrigin) {
          var saved = readSession();
          if (saved) await useSession(saved);
        }
        if (!key) { unlockScreen(); return; }
        if (!(await opensVault(key, vault))) {
          // A remembered key from a vault that is no longer this profile's.
          key = null;
          clearCachedKey();
          unlockScreen();
          return;
        }
        accounts = await Promise.all((data.accounts || []).map(async function (row) {
          var account = Object.assign({}, row);
          try { account.secret = (await open(key, row.iv, row.ciphertext)).secret; } catch (_) { account.secret = ''; }
          delete account.iv;
          delete account.ciphertext;
          return account;
        }));
        await refreshCodes();
        showMain();
        sortEl.value = sortBy;
        render();
      } catch (error) {
        if (showError !== false) {
          shown = false;
          widgetEl.innerHTML = '<div class="m2f-error">' + esc(t('m2f_error_loading')) + '</div>';
        }
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
      // Still a reload rather than only new digits, so an account added from
      // another device shows up within one period as before.
      if (lastStep !== -1 && step !== lastStep && key) load(false);
      lastStep = step;
      frame = requestAnimationFrame(tick);
    }

    async function addAccount(account) {
      var secret = String(account.secret || '').toUpperCase().replace(/[\s=]/g, '');
      base32(secret);
      var box = await seal(key, {secret: secret});
      return api('/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: account.name, issuer: account.issuer || '', website_url: account.website_url || '',
          iv: box.iv, ciphertext: box.ciphertext
        })
      });
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
      widgetEl.appendChild(overlay);
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
        var secret = secretInput.value.trim().toUpperCase().replace(/[\s=]/g, '');
        errorEl.textContent = '';
        if (!name) { errorEl.textContent = t('m2f_name_required'); return; }
        if (!secret) { errorEl.textContent = t('m2f_secret_required'); return; }
        try { base32(secret); } catch (_) { errorEl.textContent = t('m2f_invalid_secret'); return; }
        if (!key) { close(); load(); return; }
        saveEl.disabled = true;
        try {
          await addAccount({name: name, issuer: issuerInput.value.trim(), secret: secret, website_url: websiteInput.value.trim()});
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

    function markUsed(account) {
      api('/accounts/' + encodeURIComponent(account.id) + '/use', {method: 'POST'}).catch(function () {});
      account.last_used = Math.floor(Date.now() / 1000);
    }

    async function copyAccount(account, button) {
      if (!account || !account.code) return;
      await navigator.clipboard.writeText(account.code).catch(function () {});
      markUsed(account);
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

    function parseTransfer(text) {
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

    // Exports are made here from the decrypted accounts, since the server no
    // longer holds anything it could export. The files stay in the same
    // plaintext format as before, so an older backup imports unchanged.
    function exportBackup() {
      if (!confirm(t('m2f_backup_warning'))) return;
      var backup = {
        format: 'mvm2factor-backup',
        version: 1,
        exported_at: Math.floor(Date.now() / 1000),
        preferences: {sort_by: sortBy},
        accounts: accounts.slice().sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); }).map(function (account) {
          return {name: account.name, issuer: account.issuer, secret: account.secret, website_url: account.website_url};
        })
      };
      download('mvm2factor-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup, null, 2), 'application/json');
    }

    function exportCsv() {
      if (!confirm(t('m2f_csv_warning'))) return;
      var lines = ['name,issuer,secret,website'];
      accounts.forEach(function (account) { lines.push([account.name, account.issuer, account.secret, account.website_url].map(csv).join(',')); });
      download('mvm2factor-export-' + new Date().toISOString().slice(0, 10) + '.csv', lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    }

    function importAccounts() {
      var input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.csv,text/csv,application/json';
      input.onchange = function () {
        var file = input.files && input.files[0]; if (!file) return;
        var reader = new FileReader();
        reader.onload = async function () {
          var data = parseTransfer(String(reader.result || ''));
          if (!data || !data.accounts.length) { alert(t('m2f_import_invalid')); return; }
          if (!confirm(t('m2f_import_warning', {n: data.accounts.length}))) return;
          if (!key) { load(); return; }
          var saved = 0;
          for (var i = 0; i < data.accounts.length; i++) {
            var account = data.accounts[i] || {};
            var name = String(account.name || account.issuer || '').trim();
            if (!name) continue;
            try { await addAccount({name: name, issuer: account.issuer || '', secret: account.secret || '', website_url: account.website_url || account.website || ''}); saved++; } catch (_) {}
          }
          if (data.preferences.sort_by === 'newest' || data.preferences.sort_by === 'last_used') { sortBy = data.preferences.sort_by; await api('/prefs', {method: 'POST', body: JSON.stringify({sort_by: sortBy})}).catch(function () {}); }
          await load(); alert(t('m2f_import_done', {n: saved}));
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function closeTransferMenu() {
      var menu = root.querySelector('.m2f-transfer-menu');
      if (menu) menu.hidden = true;
    }
    document.addEventListener('click', closeTransferMenu);

    async function onListClick(event) {
      var fillButton = event.target.closest('[data-fill]');
      if (fillButton) {
        var fillAccount = accounts.find(function (item) { return item.id === fillButton.dataset.fill; });
        if (fillAccount && fillAccount.code && extensionParentOrigin) {
          window.parent.postMessage({
            source: 'mvmos-public-app',
            appId: 'mvm2factor',
            action: 'autofill',
            code: fillAccount.code
          }, extensionParentOrigin);
          markUsed(fillAccount);
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
    }

    function showContext() {
      if (!contextEl || !extensionContext || !extensionContext.hostname) return;
      contextEl.style.display = '';
      contextEl.textContent = extensionFiltered()
        ? t('m2f_matching_site', {host: extensionContext.hostname})
        : t('m2f_current_site', {host: extensionContext.hostname});
    }

    function onExtensionMessage(event) {
      if (event.source !== window.parent || window.parent === window) return;
      if (!/^chrome-extension:\/\/|^moz-extension:\/\//.test(event.origin)) return;
      var message = event.data || {};
      if (message.source !== 'mvmos-extension' || message.appId !== 'mvm2factor') return;
      if (message.type === 'context') {
        extensionParentOrigin = event.origin;
        extensionContext = message.context || {};
        extensionSettings = message.settings || {};
        showContext();
        render();
        return;
      }
      // The popup's own copy of the unlocked key, sent once the page is ready.
      if (message.type === 'vault-session' && message.session && !key &&
          (!message.session.expires || message.session.expires > Date.now())) {
        extensionParentOrigin = event.origin;
        useSession(message.session).then(function (ok) { if (ok) load(); });
      }
    }
    window.addEventListener('message', onExtensionMessage);
    document.addEventListener('visibilitychange', onVisible);
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
        clearTimeout(autoLockTimer);
        key = null;
        accounts = [];
        if (frame) cancelAnimationFrame(frame);
        window.removeEventListener('message', onExtensionMessage);
        document.removeEventListener('visibilitychange', onVisible);
        document.removeEventListener('click', closeTransferMenu);
      }
    };
  }

  window.Mvm2FactorWidget = {mount: mount};
})();
