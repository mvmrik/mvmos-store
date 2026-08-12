/* mvmShare — the whole interface, mounted the same way in a desktop window and
 * on the public page, so there is one implementation of the form, the list and
 * the unlock screen rather than three that drift apart.
 *
 * Everything to do with the actual content happens in here, in the browser:
 * a fresh AES-GCM key per share, encryption before the upload, decryption
 * after the download. The key is put in the fragment of the share link — the
 * part after `#`, which browsers never send to a server — so what leaves this
 * file is ciphertext and what arrives at api.py stays ciphertext.
 *
 * The owner's own copy of each key is kept in this browser's localStorage, and
 * that is a convenience, not the security model: it is what lets "My shares"
 * offer the link again later. On another browser the keys are simply absent and
 * the app says so, because there is nowhere else they could be found.
 */
window.MvmShare = (function () {
  var API = '/pub/mvmshare';
  var TOKEN_KEY = 'apphub_token';
  var KEYS_KEY = 'msh_keys';

  function t(k, vars) { return window.t ? window.t(k, vars) : k; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function headers(extra) {
    var token = localStorage.getItem(TOKEN_KEY);
    return Object.assign(token ? { 'X-Pub-Token': token } : {}, extra || {});
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: headers(opts.body ? { 'Content-Type': 'application/json' } : {}) };
    if (opts.body) init.body = JSON.stringify(opts.body);
    var res = await fetch(API + path, init);
    var data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data: data };
  }

  // ── crypto ─────────────────────────────────────────────────────────

  function b64(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = '';
    // Chunked, because fromCharCode.apply on a whole file overflows the stack.
    for (var i = 0; i < arr.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  function unb64(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function b64url(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64url(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return unb64(s);
  }

  async function newKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  }

  async function exportKey(key) {
    return b64url(await crypto.subtle.exportKey('raw', key));
  }

  async function importKey(str) {
    return crypto.subtle.importKey('raw', unb64url(str), { name: 'AES-GCM' }, false, ['decrypt']);
  }

  async function encrypt(key, bytes) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes);
    return { iv: b64(iv), data: b64(out) };
  }

  async function decrypt(key, ivB64, cipherBytes) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, cipherBytes);
  }

  async function encryptJson(key, obj) {
    return encrypt(key, new TextEncoder().encode(JSON.stringify(obj)));
  }

  async function decryptJson(key, ivB64, b64str) {
    var plain = await decrypt(key, ivB64, unb64(b64str));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ── the owner's local key ring ─────────────────────────────────────

  function loadKeys() {
    try { return JSON.parse(localStorage.getItem(KEYS_KEY) || '{}') || {}; } catch (e) { return {}; }
  }

  function rememberKey(id, key) {
    var all = loadKeys();
    all[id] = key;
    try { localStorage.setItem(KEYS_KEY, JSON.stringify(all)); } catch (e) {}
  }

  function forgetKey(id) {
    var all = loadKeys();
    delete all[id];
    try { localStorage.setItem(KEYS_KEY, JSON.stringify(all)); } catch (e) {}
  }

  function sharePath(id, key) { return '/pub/mvmshare/s/' + id + '#' + key; }
  function shareUrl(id, key) { return location.origin + sharePath(id, key); }

  // URL shares must leave this origin through the web, never execute a URL
  // scheme in the recipient's mvmOS page. This check runs again on opening so
  // a crafted encrypted payload cannot bypass the create form.
  function safeExternalUrl(value) {
    try {
      var url = new URL(String(value));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch (e) { return null; }
  }

  function fileCategory(file) {
    var type = String(file.type || '').toLowerCase();
    var name = String(file.name || '').toLowerCase();
    var ext = (name.match(/\.([a-z0-9]{1,12})$/) || [])[1] || '';
    if (type.indexOf('image/') === 0 || /^(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(ext)) return 'images';
    if (type.indexOf('video/') === 0 || /^(mp4|webm|mov|m4v|ogv)$/i.test(ext)) return 'videos';
    if (/^(zip|rar|7z|tar|gz|bz2|xz)$/i.test(ext) || /^(application\/(zip|x-7z-compressed|x-rar-compressed|x-tar|gzip))/.test(type)) return 'archives';
    if (/^(pdf|txt|rtf|csv|md|docx?|xlsx?|pptx?|odt|ods|odp)$/i.test(ext) ||
        /^(text\/|application\/(pdf|msword|vnd\.openxmlformats-officedocument|vnd\.oasis\.opendocument))/.test(type)) return 'documents';
    return '';
  }

  function allowedFile(file, categories) {
    var category = fileCategory(file);
    return !!(category && categories && categories[category]);
  }

  function fileId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return b64url(crypto.getRandomValues(new Uint8Array(16)));
  }

  // A small standards-compliant ZIP writer for "download all". It stores
  // entries without recompressing them: image/video formats are already
  // compressed, and this keeps all plaintext work in the recipient browser.
  var _crcTable = null;
  function crc32(bytes) {
    if (!_crcTable) {
      _crcTable = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        _crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = _crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function put16(out, at, value) { out[at] = value & 255; out[at + 1] = (value >>> 8) & 255; }
  function put32(out, at, value) {
    out[at] = value & 255; out[at + 1] = (value >>> 8) & 255;
    out[at + 2] = (value >>> 16) & 255; out[at + 3] = (value >>> 24) & 255;
  }
  function zipName(name, index) {
    var clean = String(name || '').replace(/[\\/]+/g, '_').replace(/[\0-\x1f]/g, '').trim();
    return clean || ('file-' + (index + 1));
  }
  async function zipFiles(entries) {
    var encoder = new TextEncoder();
    var rows = [];
    var localLength = 0, centralLength = 0;
    for (var i = 0; i < entries.length; i++) {
      var data = new Uint8Array(await entries[i].blob.arrayBuffer());
      var name = encoder.encode(zipName(entries[i].name, i));
      var row = { data: data, name: name, crc: crc32(data), offset: localLength };
      rows.push(row);
      localLength += 30 + name.length + data.length;
      centralLength += 46 + name.length;
    }
    var out = new Uint8Array(localLength + centralLength + 22), at = 0;
    rows.forEach(function (row) {
      put32(out, at, 0x04034b50); put16(out, at + 4, 20); put16(out, at + 6, 0x0800);
      put16(out, at + 8, 0); put32(out, at + 14, row.crc); put32(out, at + 18, row.data.length);
      put32(out, at + 22, row.data.length); put16(out, at + 26, row.name.length); put16(out, at + 28, 0);
      out.set(row.name, at + 30); out.set(row.data, at + 30 + row.name.length); at += 30 + row.name.length + row.data.length;
    });
    var centralAt = at;
    rows.forEach(function (row) {
      put32(out, at, 0x02014b50); put16(out, at + 4, 20); put16(out, at + 6, 20); put16(out, at + 8, 0x0800);
      put16(out, at + 10, 0); put32(out, at + 16, row.crc); put32(out, at + 20, row.data.length);
      put32(out, at + 24, row.data.length); put16(out, at + 28, row.name.length); put16(out, at + 30, 0);
      put16(out, at + 32, 0); put16(out, at + 34, 0); put16(out, at + 36, 0); put32(out, at + 38, 0);
      put32(out, at + 42, row.offset); out.set(row.name, at + 46); at += 46 + row.name.length;
    });
    put32(out, at, 0x06054b50); put16(out, at + 4, 0); put16(out, at + 6, 0);
    put16(out, at + 8, rows.length); put16(out, at + 10, rows.length); put32(out, at + 12, centralLength);
    put32(out, at + 16, centralAt); put16(out, at + 20, 0);
    return new Blob([out], { type: 'application/zip' });
  }

  // ── small helpers ──────────────────────────────────────────────────

  function fmtSize(n) {
    if (!n) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)) + ' ' + units[i];
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var lang = (window.mvmOS && window.mvmOS.lang) || undefined;
    return new Date(iso).toLocaleString(lang, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  var KIND_ICON = { url: '🔗', note: '📝', file: '📎' };

  // Shown/hidden is done with an inline style rather than the `hidden`
  // attribute, which is only a `display:none` in the browser's own stylesheet
  // and loses to any author rule that sets a display — and every panel here
  // sets `flex`. An inline style outranks both, and unlike a stylesheet fix it
  // cannot be defeated by a cached style.css.
  function show(el, visible) {
    if (el) el.style.display = visible ? '' : 'none';
  }

  function shown(el) {
    return !!el && el.style.display !== 'none';
  }

  function toast(el, message, bad) {
    el.textContent = message;
    el.className = 'msh-msg' + (bad ? ' msh-msg-bad' : ' msh-msg-ok');
    el.style.display = message ? 'block' : 'none';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Clipboard access is refused outside a secure context and in some
      // embedded views, so fall back rather than leaving the button dead.
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) {}
      ta.remove();
      return ok;
    }
  }

  // ── the manager: create + my shares ────────────────────────────────

  var EXPIRY_OPTIONS = [
    ['0', 'msh_exp_never'], ['60', 'msh_exp_1h'], ['360', 'msh_exp_6h'],
    ['1440', 'msh_exp_24h'], ['4320', 'msh_exp_3d'], ['10080', 'msh_exp_7d'],
    ['43200', 'msh_exp_30d'],
  ];

  async function mountManager(root) {
    root.innerHTML = '<div class="msh"><div class="msh-loading">…</div></div>';
    var wrap = root.querySelector('.msh');

    var cfg = (await api('/api/config')).data || {};
    if (!cfg.signed_in) {
      wrap.innerHTML =
        '<div class="msh-empty"><div class="msh-empty-icon">🔗</div>' +
        '<div class="msh-empty-title">' + esc(t('msh_signin_required')) + '</div>' +
        '<div class="msh-empty-sub">' + esc(t('msh_signin_hint')) + '</div></div>';
      return;
    }

      wrap.innerHTML =
        '<div class="msh-tabs">' +
        '<button class="msh-tab msh-tab-on" data-tab="new">' + esc(t('msh_tab_new')) + '</button>' +
        '<button class="msh-tab" data-tab="mine">' + esc(t('msh_tab_mine')) + '</button>' +
        '<button class="msh-tab" data-tab="how">' + esc(t('msh_tab_how')) + '</button>' +
      '</div><div class="msh-body"></div>';

    var body = wrap.querySelector('.msh-body');
    wrap.querySelectorAll('.msh-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        wrap.querySelectorAll('.msh-tab').forEach(function (b) { b.classList.toggle('msh-tab-on', b === btn); });
        if (btn.dataset.tab === 'new') renderForm();
        else if (btn.dataset.tab === 'mine') renderList();
        else renderHowItWorks();
      });
    });

    function goTab(name) {
      wrap.querySelectorAll('.msh-tab').forEach(function (b) { b.classList.toggle('msh-tab-on', b.dataset.tab === name); });
      if (name === 'new') renderForm();
      else if (name === 'mine') renderList();
      else renderHowItWorks();
    }

    function renderHowItWorks() {
      var sections = [
        ['msh_how_key_title', 'msh_how_key_body', '🔑'],
        ['msh_how_server_title', 'msh_how_server_body', '🗄️'],
        ['msh_how_browser_title', 'msh_how_browser_body', '🌐'],
        ['msh_how_external_title', 'msh_how_external_body', '🔗'],
        ['msh_how_notify_title', 'msh_how_notify_body', '🔔'],
        ['msh_how_password_title', 'msh_how_password_body', '🔒'],
        ['msh_how_loss_title', 'msh_how_loss_body', '🧩'],
      ];
      body.innerHTML = '<div class="msh-how"><h2>' + esc(t('msh_how_title')) + '</h2>' +
        sections.map(function (section) {
          return '<section class="msh-how-section"><div class="msh-how-icon">' + section[2] + '</div><div>' +
            '<h3>' + esc(t(section[0])) + '</h3><p>' + esc(t(section[1])) + '</p></div></section>';
        }).join('') + '</div>';
    }

    // ── the create form ──────────────────────────────────────────────

    function renderForm() {
      var kind = 'note';
      var files = [];
      // Premium belongs to the server owner, never to an Apps Hub visitor.
      // The desktop may name and sell it because it has the subscription
      // dialog; a public page merely receives the server's available options.
      var IS_DESKTOP = !!(window.mvmOS && window.mvmOS.premiumGate);
      var SHOW_PREMIUM_BLOCK = cfg.premium || IS_DESKTOP;

      body.innerHTML =
        '<div class="msh-form">' +
          '<div class="msh-kinds">' +
            ['note', 'file', 'url'].map(function (k) {
              return '<button class="msh-kind' + (k === 'note' ? ' msh-kind-on' : '') + '" data-kind="' + k + '">' +
                KIND_ICON[k] + ' ' + esc(t('msh_kind_' + k)) + '</button>';
            }).join('') +
          '</div>' +

          '<div class="msh-field" data-for="url" style="display:none">' +
            '<label>' + esc(t('msh_label_url')) + '</label>' +
            '<input type="url" class="msh-input" id="msh-url" placeholder="' + esc(t('msh_ph_url')) + '">' +
          '</div>' +

          '<div class="msh-field" data-for="note">' +
            '<label>' + esc(t('msh_label_note')) + '</label>' +
            '<textarea class="msh-input msh-area" id="msh-note" rows="6" placeholder="' + esc(t('msh_ph_note')) + '"></textarea>' +
          '</div>' +

          '<div class="msh-field" data-for="file" style="display:none">' +
            '<label>' + esc(t('msh_label_file')) + '</label>' +
            '<div class="msh-drop" id="msh-drop">' +
              '<button type="button" class="msh-btn msh-btn-ghost" id="msh-pick">' + esc(t('msh_pick_file')) + '</button>' +
              '<span class="msh-drop-hint">' + esc(t('msh_drop_hint')) + '</span>' +
              '<div class="msh-drop-name" id="msh-fname"></div>' +
              '<div class="msh-file-queue" id="msh-file-queue"></div>' +
            '</div>' +
            '<input type="file" id="msh-file" hidden multiple>' +
          '</div>' +

          '<div class="msh-field">' +
            '<label>' + esc(t('msh_label_title')) + '</label>' +
            '<input type="text" class="msh-input" id="msh-title" maxlength="120" placeholder="' + esc(t('msh_ph_title')) + '">' +
            '<div class="msh-hint">' + esc(t('msh_title_hint')) + '</div>' +
          '</div>' +

          '<div class="msh-row">' +
            '<div class="msh-field">' +
              '<label>' + esc(t('msh_label_expiry')) + '</label>' +
              '<select class="msh-input" id="msh-expiry">' +
                EXPIRY_OPTIONS.map(function (o) {
                  return '<option value="' + o[0] + '">' + esc(t(o[1])) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
            '<div class="msh-field">' +
              '<label>' + esc(t('msh_label_password')) + '</label>' +
              '<input type="password" class="msh-input" id="msh-pass" autocomplete="new-password" placeholder="' + esc(t('msh_ph_password')) + '">' +
            '</div>' +
          '</div>' +
          '<div class="msh-hint">' + esc(t('msh_password_hint')) + '</div>' +

          // View limits and automatic deletion are two independent premium
          // features (not a single choice), so each gets its own field with
          // its own label rather than sharing one row. `cfg.premium` reflects
          // this mvmOS install's own licence, never a per-user purchase — a
          // visitor on the public page is never asked to pay for anything.
          //
          // Desktop (window.mvmOS present, running inside mvmOS itself): the
          // block always renders, locked with mvmOS.premiumGate() when
          // unlicensed, exactly like every other app's premium controls —
          // the owner can see the feature exists and open the subscription
          // dialog from it.
          // Bare public page (no window.mvmOS, e.g. opened straight from a
          // browser bookmark on an unlicensed install): the block is skipped
          // entirely rather than shown locked, since there is no subscription
          // dialog to send that visitor to.
          (SHOW_PREMIUM_BLOCK ?
          '<div class="msh-premium" id="msh-premium-block">' +
            (IS_DESKTOP ? '<div class="msh-premium-hd">' +
              '<span class="msh-badge-prem">★ ' + esc(t('msh_premium')) + '</span>' +
              (cfg.premium ? '' : '<span class="msh-hint">' + esc(t('msh_premium_limits')) + '</span>') +
            '</div>' : '') +
            '<div class="msh-field">' +
              '<label>' + esc(t('msh_label_max_views')) + '</label>' +
              '<input type="number" min="1" class="msh-input" id="msh-views" placeholder="' + esc(t('msh_ph_max_views')) + '"' + (cfg.premium ? '' : ' disabled') + '>' +
            '</div>' +
            '<div class="msh-field">' +
              '<label>' + esc(t('msh_label_expire_mode')) + '</label>' +
              '<select class="msh-input" id="msh-mode"' + (cfg.premium ? '' : ' disabled') + '>' +
                '<option value="lock">' + esc(t('msh_expire_lock')) + '</option>' +
                '<option value="delete">' + esc(t('msh_expire_delete')) + '</option>' +
              '</select>' +
              '<div class="msh-hint">' + esc(t('msh_expire_hint')) + '</div>' +
            '</div>' +
          '</div>' : '') +

          '<div class="msh-msg" id="msh-msg" style="display:none"></div>' +
          '<button class="msh-btn msh-btn-main" id="msh-create">' + esc(t('msh_create')) + '</button>' +
        '</div>';

      var msg = body.querySelector('#msh-msg');

      // Same lock every other app's premium controls use: a dim overlay plus
      // a click-through to Settings → Subscription. Only wired up when the
      // block was actually drawn unlicensed — a licensed install has nothing
      // to lock, and a bare public page never rendered the block at all.
      if (!cfg.premium && SHOW_PREMIUM_BLOCK && window.mvmOS && window.mvmOS.premiumGate) {
        window.mvmOS.premiumGate(body.querySelector('#msh-premium-block'), t('msh_premium_limits'));
      }

      body.querySelectorAll('.msh-kind').forEach(function (btn) {
        btn.addEventListener('click', function () {
          kind = btn.dataset.kind;
          body.querySelectorAll('.msh-kind').forEach(function (b) { b.classList.toggle('msh-kind-on', b === btn); });
          body.querySelectorAll('.msh-field[data-for]').forEach(function (f) {
            show(f, f.dataset.for === kind);
          });
          toast(msg, '');
        });
      });

      var fileInput = body.querySelector('#msh-file');
      var fname = body.querySelector('#msh-fname');
      var fileQueue = body.querySelector('#msh-file-queue');
      var drop = body.querySelector('#msh-drop');

      function renderFiles() {
        fname.textContent = files.length ? t('msh_files_selected', { n: files.length }) : '';
        fileQueue.innerHTML = files.map(function (f, index) {
          return '<div class="msh-file-queued"><span>📄 ' + esc(f.name) + ' · ' + esc(fmtSize(f.size)) + '</span>' +
            '<button type="button" class="msh-file-remove" data-index="' + index + '" aria-label="' + esc(t('msh_remove_file')) + '">×</button></div>';
        }).join('');
        fileQueue.querySelectorAll('[data-index]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            files.splice(Number(btn.dataset.index), 1);
            renderFiles();
          });
        });
      }

      function takeFiles(picked) {
        var incoming = [].slice.call(picked || []);
        if (!incoming.length) return;
        if (files.length + incoming.length > (cfg.max_files || 1)) {
          return toast(msg, t('msh_file_too_many', { max: cfg.max_files || 1 }), true);
        }
        for (var i = 0; i < incoming.length; i++) {
          var f = incoming[i];
          if (cfg.max_bytes && f.size > cfg.max_bytes) return toast(msg, t('msh_file_too_large', { max: fmtSize(cfg.max_bytes) }), true);
          if (!allowedFile(f, cfg.file_categories || {})) return toast(msg, t('msh_file_type_blocked'), true);
        }
        files = files.concat(incoming);
        renderFiles();
        toast(msg, '');
      }

      body.querySelector('#msh-pick').addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () { takeFiles(fileInput.files); fileInput.value = ''; });
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('msh-drop-on'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('msh-drop-on'); });
      });
      drop.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files.length) takeFiles(e.dataTransfer.files);
      });

      body.querySelector('#msh-create').addEventListener('click', async function () {
        var btn = this;
        var payload = { kind: kind };
        var meta;

        if (kind === 'url') {
          var url = body.querySelector('#msh-url').value.trim();
          if (!url) return toast(msg, t('msh_err_required'), true);
          if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
          url = safeExternalUrl(url);
          if (!url) return toast(msg, t('msh_err_generic'), true);
          meta = { url: url };
        } else if (kind === 'note') {
          var text = body.querySelector('#msh-note').value;
          if (!text.trim()) return toast(msg, t('msh_err_required'), true);
          meta = { text: text };
        } else {
          if (!files.length) return toast(msg, t('msh_err_required'), true);
          meta = { files: files.map(function (f) {
            return { id: fileId(), name: f.name, type: f.type || 'application/octet-stream', size: f.size };
          }) };
        }

        btn.disabled = true;
        btn.textContent = t('msh_creating');
        try {
          var key = await newKey();
          var metaEnc = await encryptJson(key, meta);
          payload.meta_iv = metaEnc.iv;
          payload.meta = metaEnc.data;

          if (kind === 'file') {
            payload.files = [];
            for (var fileIndex = 0; fileIndex < files.length; fileIndex++) {
              var bytes = await files[fileIndex].arrayBuffer();
              var dataEnc = await encrypt(key, bytes);
              payload.files.push({ id: meta.files[fileIndex].id, data_iv: dataEnc.iv, data: dataEnc.data });
            }
          }

          payload.title = body.querySelector('#msh-title').value.trim();
          var minutes = parseInt(body.querySelector('#msh-expiry').value, 10);
          payload.expires_in_minutes = minutes > 0 ? minutes : null;
          payload.password = body.querySelector('#msh-pass').value;
          if (cfg.premium) {
            var views = parseInt(body.querySelector('#msh-views').value, 10);
            payload.max_views = views > 0 ? views : null;
            payload.expire_mode = body.querySelector('#msh-mode').value;
          }

          var res = await api('/api/create', { method: 'POST', body: payload });
          if (!res.ok) {
            toast(msg, res.status === 413 ? t('msh_err_too_large') : t('msh_err_generic'), true);
            return;
          }
          var exported = await exportKey(key);
          rememberKey(res.data.id, exported);
          renderResult(res.data, exported);
        } catch (e) {
          toast(msg, window.crypto && window.crypto.subtle ? t('msh_err_generic') : t('msh_err_insecure'), true);
        } finally {
          btn.disabled = false;
          btn.textContent = t('msh_create');
        }
      });
    }

    // ── the finished share ───────────────────────────────────────────

    function renderResult(share, key) {
      var url = shareUrl(share.id, key);
      body.innerHTML =
        '<div class="msh-result">' +
          '<div class="msh-result-icon">✅</div>' +
          '<div class="msh-result-title">' + esc(t('msh_created_title')) + '</div>' +
          '<div class="msh-linkbox"><input class="msh-input" id="msh-link" readonly value="' + esc(url) + '"></div>' +
          '<div class="msh-actions">' +
            '<button class="msh-btn msh-btn-main" id="msh-copy">' + esc(t('msh_copy')) + '</button>' +
            '<button class="msh-btn msh-btn-ghost" id="msh-notify">' + esc(t('msh_send')) + '</button>' +
            '<button class="msh-btn msh-btn-ghost" id="msh-again">' + esc(t('msh_new_another')) + '</button>' +
          '</div>' +
          '<div class="msh-hint">' + esc(t('msh_created_hint')) + '</div>' +
          '<div class="msh-send" id="msh-send" style="display:none"></div>' +
        '</div>';

      body.querySelector('#msh-link').addEventListener('focus', function () { this.select(); });
      body.querySelector('#msh-copy').addEventListener('click', async function () {
        var btn = this;
        if (await copyText(url)) {
          btn.textContent = t('msh_copied');
          setTimeout(function () { btn.textContent = t('msh_copy'); }, 1600);
        }
      });
      body.querySelector('#msh-again').addEventListener('click', renderForm);
      body.querySelector('#msh-notify').addEventListener('click', function () {
        var panel = body.querySelector('#msh-send');
        show(panel, !shown(panel));
        if (shown(panel)) renderSend(panel, share, key);
      });
    }

    // ── notifying favourites ─────────────────────────────────────────

    async function renderSend(panel, share, key) {
      panel.innerHTML = '<div class="msh-loading">…</div>';
      var res = await fetch('/api/pub/apphub/favourites', { headers: headers() }).catch(function () { return null; });
      var favs = res && res.ok ? await res.json() : [];

      if (!favs.length) {
        panel.innerHTML = '<div class="msh-hint">' + esc(t('msh_favourites_empty')) + '</div>';
        return;
      }

      panel.innerHTML =
        '<div class="msh-send-title">' + esc(t('msh_send_title')) + '</div>' +
        '<div class="msh-hint">' + esc(t('msh_send_hint')) + '</div>' +
        '<div class="msh-favs">' +
          favs.map(function (f) {
            var avatar = window.GHAvatar && window.GHAvatar.renderAvatar
              ? window.GHAvatar.renderAvatar(f, 26)
              : '<span class="msh-fav-dot" style="background:' + esc(f.avatar_color || '#89b4fa') + '"></span>';
            return '<label class="msh-fav"><input type="checkbox" value="' + esc(f.id) + '">' +
              '<span class="msh-fav-avatar">' + avatar + '</span>' +
              '<span>' + esc(f.display_name || f.username) + '</span></label>';
          }).join('') +
        '</div>' +
        '<div class="msh-hint msh-hint-warn">' + esc(t('msh_send_warning')) + '</div>' +
        '<div class="msh-msg" id="msh-send-msg" style="display:none"></div>' +
        '<button class="msh-btn msh-btn-main" id="msh-send-go">' + esc(t('msh_send')) + '</button>';

      var msg = panel.querySelector('#msh-send-msg');
      panel.querySelector('#msh-send-go').addEventListener('click', async function () {
        var picked = [].slice.call(panel.querySelectorAll('input:checked')).map(function (i) { return i.value; });
        if (!picked.length) return toast(msg, t('msh_send_none'), true);
        this.disabled = true;
        var out = await api('/api/' + encodeURIComponent(share.id) + '/send', {
          method: 'POST',
          body: { link: sharePath(share.id, key), recipients: picked },
        });
        this.disabled = false;
        if (out.ok) toast(msg, t('msh_send_done', { n: out.data.sent }));
        else toast(msg, t('msh_err_generic'), true);
      });
    }

    // ── my shares ────────────────────────────────────────────────────

    async function renderList() {
      body.innerHTML = '<div class="msh-loading">…</div>';
      var res = await api('/api/mine');
      var rows = res.ok ? res.data : [];
      if (!rows.length) {
        body.innerHTML = '<div class="msh-empty"><div class="msh-empty-icon">📭</div>' +
          '<div class="msh-empty-title">' + esc(t('msh_mine_empty')) + '</div></div>';
        return;
      }

      var keys = loadKeys();
      body.innerHTML = '<div class="msh-list">' + rows.map(function (s) {
        var views = s.max_views
          ? t('msh_views_of', { n: s.views, max: s.max_views })
          : t('msh_views_count', { n: s.views });
        return '<div class="msh-card" data-id="' + esc(s.id) + '">' +
          '<div class="msh-card-hd">' +
            '<span class="msh-card-icon">' + KIND_ICON[s.kind] + '</span>' +
            '<span class="msh-card-title">' + esc(s.title || t('msh_kind_' + s.kind)) + '</span>' +
            '<span class="msh-state msh-state-' + esc(s.state) + '">' + esc(t('msh_state_' + s.state)) + '</span>' +
          '</div>' +
          '<div class="msh-card-meta">' +
            '<span>' + esc(views) + '</span>' +
            '<span>' + esc(s.expires_at ? t('msh_expires_at', { date: fmtDate(s.expires_at) }) : t('msh_no_expiry')) + '</span>' +
            (s.needs_password ? '<span>🔒 ' + esc(t('msh_has_password')) + '</span>' : '') +
            (s.size_bytes && s.kind === 'file' ? '<span>' + esc(fmtSize(s.size_bytes)) + '</span>' : '') +
          '</div>' +
          '<div class="msh-card-actions">' +
            (keys[s.id]
              ? '<button class="msh-btn msh-btn-sm" data-act="copy">' + esc(t('msh_copy')) + '</button>' +
                '<button class="msh-btn msh-btn-sm msh-btn-ghost" data-act="notify">' + esc(t('msh_send')) + '</button>'
              : '<span class="msh-hint msh-hint-inline">' + esc(t('msh_link_lost')) + '</span>') +
            '<button class="msh-btn msh-btn-sm msh-btn-ghost" data-act="edit">' + esc(t('msh_edit')) + '</button>' +
            '<button class="msh-btn msh-btn-sm msh-btn-danger" data-act="delete">' + esc(t('msh_delete')) + '</button>' +
          '</div>' +
          '<div class="msh-card-panel" style="display:none"></div>' +
        '</div>';
      }).join('') + '</div>';

      body.querySelectorAll('.msh-card').forEach(function (card) {
        var share = rows.find(function (r) { return r.id === card.dataset.id; });
        var panel = card.querySelector('.msh-card-panel');

        card.querySelectorAll('[data-act]').forEach(function (btn) {
          btn.addEventListener('click', async function () {
            var act = btn.dataset.act;

            if (act === 'copy') {
              if (await copyText(shareUrl(share.id, keys[share.id]))) {
                btn.textContent = t('msh_copied');
                setTimeout(function () { btn.textContent = t('msh_copy'); }, 1600);
              }
            } else if (act === 'notify') {
              show(panel, !shown(panel));
              if (shown(panel)) renderSend(panel, share, keys[share.id]);
            } else if (act === 'edit') {
              show(panel, !shown(panel));
              if (shown(panel)) renderEdit(panel, share, keys[share.id]);
            } else if (act === 'delete') {
              var ok = window.mvmOS && window.mvmOS.confirm
                ? await window.mvmOS.confirm(t('msh_delete_confirm'))
                : window.confirm(t('msh_delete_confirm'));
              if (!ok) return;
              await api('/api/' + encodeURIComponent(share.id), { method: 'DELETE' });
              forgetKey(share.id);
              renderList();
            }
          });
        });
      });
    }

    // ── changing a share after the fact ──────────────────────────────

    function renderEdit(panel, share, keyStr) {
      var IS_DESKTOP = !!(window.mvmOS && window.mvmOS.premiumGate);
      var SHOW_PREMIUM_BLOCK = cfg.premium || IS_DESKTOP;
      panel.innerHTML =
        '<div class="msh-row">' +
          '<div class="msh-field">' +
            '<label>' + esc(t('msh_label_expiry')) + '</label>' +
            '<select class="msh-input" data-f="expiry">' +
              EXPIRY_OPTIONS.map(function (o) {
                return '<option value="' + o[0] + '">' + esc(t(o[1])) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="msh-field">' +
            '<label>' + esc(t('msh_label_password')) + '</label>' +
            '<select class="msh-input" data-f="passmode">' +
              '<option value="keep">' + esc(t('msh_password_keep')) + '</option>' +
              '<option value="set">' + esc(t('msh_password_set')) + '</option>' +
              (share.needs_password ? '<option value="clear">' + esc(t('msh_password_clear')) + '</option>' : '') +
            '</select>' +
            '<input type="password" class="msh-input" data-f="pass" autocomplete="new-password" style="display:none">' +
          '</div>' +
        '</div>' +
        (SHOW_PREMIUM_BLOCK
          ? '<div class="msh-premium" id="msh-edit-premium">' +
              (IS_DESKTOP ? '<div class="msh-premium-hd"><span class="msh-badge-prem">★ ' + esc(t('msh_premium')) + '</span>' +
                (cfg.premium ? '' : '<span class="msh-hint">' + esc(t('msh_premium_limits')) + '</span>') + '</div>' : '') +
              '<div class="msh-row">' +
                '<div class="msh-field"><label>' + esc(t('msh_label_max_views')) + '</label>' +
                  '<input type="number" min="1" class="msh-input" data-f="views" placeholder="' + esc(t('msh_ph_max_views')) + '" value="' + (share.max_views || '') + '"' + (cfg.premium ? '' : ' disabled') + '></div>' +
                '<div class="msh-field"><label>' + esc(t('msh_label_expire_mode')) + '</label>' +
                  '<select class="msh-input" data-f="mode"' + (cfg.premium ? '' : ' disabled') + '>' +
                    '<option value="lock"' + (share.expire_mode === 'lock' ? ' selected' : '') + '>' + esc(t('msh_expire_lock')) + '</option>' +
                    '<option value="delete"' + (share.expire_mode === 'delete' ? ' selected' : '') + '>' + esc(t('msh_expire_delete')) + '</option>' +
                  '</select></div>' +
              '</div>' +
              '<label class="msh-check"><input type="checkbox" data-f="reset"' + (cfg.premium ? '' : ' disabled') + '> ' + esc(t('msh_reset_views')) + '</label>' +
            '</div>'
          : '') +
        (share.kind === 'file' && keyStr
          ? '<div class="msh-edit-files" data-f="files">…</div>'
          : '') +
        '<div class="msh-msg" data-f="msg" style="display:none"></div>' +
        '<div class="msh-actions">' +
          '<button class="msh-btn msh-btn-main" data-f="save">' + esc(t('msh_save')) + '</button>' +
          '<button class="msh-btn msh-btn-ghost" data-f="cancel">' + esc(t('msh_cancel')) + '</button>' +
        '</div>';

      if (!cfg.premium && window.mvmOS && window.mvmOS.premiumGate) {
        var editPremEl = panel.querySelector('#msh-edit-premium');
        if (editPremEl) window.mvmOS.premiumGate(editPremEl, t('msh_premium_limits'));
      }

      var passMode = panel.querySelector('[data-f="passmode"]');
      var passInput = panel.querySelector('[data-f="pass"]');
      passMode.addEventListener('change', function () { show(passInput, passMode.value === 'set'); });

      var filesPanel = panel.querySelector('[data-f="files"]');
      if (filesPanel) {
        (async function () {
          var content = await api('/api/' + encodeURIComponent(share.id) + '/files');
          if (!content.ok) { filesPanel.textContent = t('msh_err_generic'); return; }
          var key;
          var meta;
          try {
            key = await importKey(keyStr);
            meta = await decryptJson(key, content.data.meta_iv, content.data.meta);
          } catch (e) { filesPanel.textContent = t('msh_decrypt_error'); return; }
          var managed = Array.isArray(meta.files) && meta.files.length
            ? meta.files
            : [{ id: 'legacy', name: meta.name || 'file', type: meta.type || '', size: meta.size || share.size_bytes }];
          filesPanel.innerHTML = '<div class="msh-send-title">' + esc(t('msh_manage_files')) + '</div>' +
            '<div class="msh-manage-files">' + managed.map(function (f) {
              return '<label class="msh-check"><input type="checkbox" value="' + esc(f.id) + '"> ' + esc(f.name || 'file') + ' · ' + esc(fmtSize(f.size || 0)) + '</label>';
            }).join('') + '</div>' +
            '<button class="msh-btn msh-btn-sm msh-btn-danger" data-f="remove-files">' + esc(t('msh_delete_files')) + '</button>';
          filesPanel.querySelector('[data-f="remove-files"]').addEventListener('click', async function () {
            var ids = [].slice.call(filesPanel.querySelectorAll('input:checked')).map(function (el) { return el.value; });
            if (!ids.length) return;
            var ok = window.mvmOS && window.mvmOS.confirm
              ? await window.mvmOS.confirm(t('msh_delete_files_confirm'))
              : window.confirm(t('msh_delete_files_confirm'));
            if (!ok) return;
            var nextMeta = Object.assign({}, meta);
            if (Array.isArray(meta.files)) nextMeta.files = meta.files.filter(function (f) { return ids.indexOf(f.id) < 0; });
            var encrypted = await encryptJson(key, nextMeta);
            this.disabled = true;
            var result = await api('/api/' + encodeURIComponent(share.id) + '/files/remove', {
              method: 'POST', body: { file_ids: ids, meta_iv: encrypted.iv, meta: encrypted.data }
            });
            if (result.ok) renderList();
            else { this.disabled = false; toast(panel.querySelector('[data-f="msg"]'), t('msh_err_generic'), true); }
          });
        })();
      }

      panel.querySelector('[data-f="cancel"]').addEventListener('click', function () { show(panel, false); });
      panel.querySelector('[data-f="save"]').addEventListener('click', async function () {
        var payload = {};
        var minutes = parseInt(panel.querySelector('[data-f="expiry"]').value, 10);
        payload.expires_in_minutes = minutes > 0 ? minutes : null;

        if (passMode.value === 'set') payload.password = passInput.value;
        else if (passMode.value === 'clear') payload.password = '';

        if (cfg.premium) {
          var views = parseInt(panel.querySelector('[data-f="views"]').value, 10);
          payload.max_views = views > 0 ? views : null;
          payload.expire_mode = panel.querySelector('[data-f="mode"]').value;
          if (panel.querySelector('[data-f="reset"]').checked) payload.reset_views = true;
        }

        this.disabled = true;
        var res = await api('/api/' + encodeURIComponent(share.id) + '/update', { method: 'POST', body: payload });
        this.disabled = false;
        if (res.ok) renderList();
        else toast(panel.querySelector('[data-f="msg"]'), t('msh_err_generic'), true);
      });
    }

    renderForm();
    return { refresh: function () { goTab('mine'); } };
  }

  // ── the opener: what someone with the link sees ────────────────────

  async function mountOpener(root, shareId) {
    // URL shares leave this page immediately after client-side decryption.
    // Do not flash a public-app loading screen in that interval.
    root.innerHTML = '<div class="msh msh-open" aria-busy="true"></div>';
    var wrap = root.querySelector('.msh-open');

    function fail(key) {
      wrap.innerHTML = '<div class="msh-empty"><div class="msh-empty-icon">🚫</div>' +
        '<div class="msh-empty-title">' + esc(t(key)) + '</div></div>';
    }

    var keyStr = location.hash.replace(/^#/, '');
    var probe = await api('/api/s/' + encodeURIComponent(shareId));
    if (!probe.ok) return fail('msh_open_notfound');

    var info = probe.data;
    if (info.state === 'expired') return fail('msh_open_expired');
    if (info.state === 'exhausted') return fail('msh_open_exhausted');
    if (!keyStr) return fail('msh_key_missing');

    var key;
    try { key = await importKey(keyStr); } catch (e) { return fail('msh_decrypt_error'); }

    function shell(inner) {
      wrap.innerHTML =
        '<div class="msh-open-card">' +
          '<div class="msh-open-icon">' + KIND_ICON[info.kind] + '</div>' +
          '<div class="msh-open-title">' + esc(t('msh_open_' + info.kind)) + '</div>' +
          (info.title ? '<div class="msh-open-label">' + esc(info.title) + '</div>' : '') +
          inner +
        '</div>';
    }

    function askPassword(errorKey) {
      shell(
        '<div class="msh-open-lock">🔒 ' + esc(t('msh_open_locked')) + '</div>' +
        '<input type="password" class="msh-input" id="msh-op" placeholder="' + esc(t('msh_open_password_ph')) + '" autocomplete="off">' +
        (errorKey ? '<div class="msh-msg msh-msg-bad">' + esc(t(errorKey)) + '</div>' : '') +
        '<button class="msh-btn msh-btn-main" id="msh-og">' + esc(t('msh_unlock')) + '</button>'
      );
      var input = wrap.querySelector('#msh-op');
      input.focus();
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(input.value); });
      wrap.querySelector('#msh-og').addEventListener('click', function () { open(input.value); });
    }

    async function open(password) {
      wrap.innerHTML = '';
      wrap.setAttribute('aria-busy', 'true');
      var res = await api('/api/s/' + encodeURIComponent(shareId) + '/open', {
        method: 'POST', body: { password: password || '' },
      });

      if (!res.ok) {
        if (res.status === 401) return askPassword(null);
        if (res.status === 403) return askPassword('msh_password_wrong');
        if (res.status === 410) return fail('msh_open_' + (res.data && res.data.error === 'exhausted' ? 'exhausted' : 'expired'));
        return fail('msh_err_generic');
      }

      var share = res.data;
      var meta;
      try {
        meta = await decryptJson(key, share.meta_iv, share.meta);
      } catch (e) {
        return fail('msh_decrypt_error');
      }

      var left = share.views_left;
      var note = left === 0 ? t('msh_last_view') : (left > 0 ? t('msh_views_left', { n: left }) : '');
      var footer = note ? '<div class="msh-hint">' + esc(note) + '</div>' : '';

      if (share.kind === 'url') {
        var targetUrl = safeExternalUrl(meta.url);
        if (!targetUrl) return fail('msh_decrypt_error');
        location.replace(targetUrl);
        return;
      }

      if (share.kind === 'note') {
        shell(
          '<pre class="msh-note">' + esc(meta.text) + '</pre>' +
          '<button class="msh-btn msh-btn-ghost" id="msh-notecopy">' + esc(t('msh_note_copy')) + '</button>' + footer
        );
        wrap.querySelector('#msh-notecopy').addEventListener('click', async function () {
          var btn = this;
          if (await copyText(meta.text)) {
            btn.textContent = t('msh_copied');
            setTimeout(function () { btn.textContent = t('msh_note_copy'); }, 1600);
          }
        });
        return;
      }

      // Older links have one file directly in metadata. Newer links keep an
      // encrypted manifest of files, while the server sees only opaque ids.
      var sharedFiles = Array.isArray(meta.files) && meta.files.length
        ? meta.files
        : [{ id: 'legacy', name: meta.name || 'file', type: meta.type || 'application/octet-stream', size: meta.size || share.size_bytes }];
      var manifest = {};
      (share.file_manifest || []).forEach(function (entry) { manifest[entry.id] = entry; });
      var loaded = {};

      async function plainFile(item) {
        if (loaded[item.id]) return loaded[item.id];
        var entry = manifest[item.id] || { id: item.id, data_iv: share.data_iv };
        var url = API + '/api/s/' + encodeURIComponent(shareId) + '/data?t=' +
          encodeURIComponent(share.download_token) + '&f=' + encodeURIComponent(entry.id || 'legacy');
        var r = await fetch(url);
        if (!r.ok) throw new Error('http');
        var cipher = await r.arrayBuffer();
        var plain = await decrypt(key, entry.data_iv, cipher);
        var blob = new Blob([plain], { type: item.type || 'application/octet-stream' });
        loaded[item.id] = blob;
        return blob;
      }

      function download(item) {
        return plainFile(item).then(function (blob) {
          var href = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = href;
          a.download = item.name || 'file';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
        });
      }

      var imageIndexes = sharedFiles.map(function (f, i) { return /^image\//i.test(f.type || '') ? i : -1; }).filter(function (i) { return i >= 0; });
      function openImage(index) {
        var position = imageIndexes.indexOf(index);
        if (position < 0) return;
        var overlay = document.createElement('div');
        overlay.className = 'msh-lightbox';
        document.body.appendChild(overlay);
        function renderImage() {
          var item = sharedFiles[imageIndexes[position]];
          overlay.innerHTML = '<button class="msh-lightbox-close" data-act="close" aria-label="' + esc(t('msh_close')) + '">×</button>' +
            '<button class="msh-lightbox-nav msh-lightbox-prev" data-act="prev" aria-label="' + esc(t('msh_prev_image')) + '">‹</button>' +
            '<div class="msh-lightbox-image">…</div>' +
            '<button class="msh-lightbox-nav msh-lightbox-next" data-act="next" aria-label="' + esc(t('msh_next_image')) + '">›</button>';
          plainFile(item).then(function (blob) {
            var href = URL.createObjectURL(blob);
            var box = overlay.querySelector('.msh-lightbox-image');
            box.innerHTML = '<img alt="' + esc(item.name || '') + '" src="' + href + '"><div>' + esc(item.name || '') + '</div>';
            overlay._href = href;
          }).catch(function () { overlay.querySelector('.msh-lightbox-image').textContent = t('msh_decrypt_error'); });
          overlay.querySelectorAll('[data-act]').forEach(function (btn) {
            btn.onclick = function () {
              if (overlay._href) { URL.revokeObjectURL(overlay._href); overlay._href = null; }
              if (btn.dataset.act === 'close') { overlay.remove(); return; }
              position = (position + (btn.dataset.act === 'next' ? 1 : -1) + imageIndexes.length) % imageIndexes.length;
              renderImage();
            };
          });
        }
        renderImage();
      }

      shell(
        '<div class="msh-file-grid">' + sharedFiles.map(function (item, index) {
          var image = /^image\//i.test(item.type || '');
          return '<div class="msh-file-card">' +
            (image ? '<button class="msh-file-thumb" data-image="' + index + '">🖼️</button>' : '<div class="msh-file-icon">📄</div>') +
            '<div class="msh-file-name" title="' + esc(item.name || '') + '">' + esc(item.name || 'file') + '</div>' +
            '<div class="msh-hint">' + esc(fmtSize(item.size || 0)) + '</div>' +
            '<button class="msh-btn msh-btn-sm msh-btn-ghost" data-download="' + index + '">' + esc(t('msh_download_file')) + '</button>' +
          '</div>';
        }).join('') + '</div>' +
        (sharedFiles.length > 1 ? '<button class="msh-btn msh-btn-main" id="msh-dl-all">' + esc(t('msh_download_all')) + '</button>' : '') +
        '<div class="msh-msg" id="msh-dlmsg" style="display:none"></div>' + footer
      );

      wrap.querySelectorAll('[data-download]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          this.disabled = true; this.textContent = t('msh_downloading');
          try { await download(sharedFiles[Number(this.dataset.download)]); }
          catch (e) { toast(wrap.querySelector('#msh-dlmsg'), t('msh_decrypt_error'), true); }
          finally { this.disabled = false; this.textContent = t('msh_download_file'); }
        });
      });
      wrap.querySelectorAll('[data-image]').forEach(function (btn) {
        btn.addEventListener('click', function () { openImage(Number(this.dataset.image)); });
      });
      var allButton = wrap.querySelector('#msh-dl-all');
      if (allButton) allButton.addEventListener('click', async function () {
        this.disabled = true;
        this.textContent = t('msh_downloading');
        try {
          var entries = [];
          for (var i = 0; i < sharedFiles.length; i++) {
            entries.push({ name: sharedFiles[i].name, blob: await plainFile(sharedFiles[i]) });
          }
          var archive = await zipFiles(entries);
          var href = URL.createObjectURL(archive);
          var a = document.createElement('a');
          a.href = href;
          a.download = zipName(share.title || 'mvmshare-files', 0).replace(/\.[^.]+$/, '') + '.zip';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
        }
        catch (e) { toast(wrap.querySelector('#msh-dlmsg'), t('msh_decrypt_error'), true); }
        finally { this.disabled = false; this.textContent = t('msh_download_all'); }
      });

      // Fetch image bytes in the background to replace their icon with actual
      // thumbnails. Nothing is exposed before decryption in this browser.
      sharedFiles.forEach(function (item, index) {
        if (!/^image\//i.test(item.type || '')) return;
        plainFile(item).then(function (blob) {
          var btn = wrap.querySelector('[data-image="' + index + '"]');
          if (!btn) return;
          var href = URL.createObjectURL(blob);
          btn.innerHTML = '<img alt="' + esc(item.name || '') + '" src="' + href + '">';
        }).catch(function () {});
      });
    }

    if (info.needs_password) askPassword(null);
    else open('');
  }

  return {
    mountManager: mountManager,
    mountOpener: mountOpener,
    shareUrl: shareUrl,
  };
})();
