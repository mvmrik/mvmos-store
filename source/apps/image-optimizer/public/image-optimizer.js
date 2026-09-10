(function () {
  if (window.ImageOptimizer) return;

  var SUPPORTED = ['image/jpeg', 'image/png', 'image/webp'];
  var DEFAULTS = {
    format: 'webp', quality: 90, prefix: '', suffix: '', caseMode: 'keep', spaceMode: 'keep',
    findText: '', replaceText: '', renameOnly: false, preserveTransparency: true,
    resizeEnabled: false, width: '', height: '', keepAspect: true
  };

  function tr(key, vars) {
    var text = (window.t && window.t(key)) || (window._i18n && window._i18n[key]) || key;
    Object.keys(vars || {}).forEach(function (name) { text = text.replaceAll('{' + name + '}', vars[name]); });
    return text;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function size(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(2) + ' MB';
  }
  function basename(path) { return String(path || '').replace(/\\/g, '/').split('/').pop(); }
  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function baseName(name) { var pos = name.lastIndexOf('.'); return pos > 0 ? name.slice(0, pos) : name; }
  function extForMime(mime) { return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'; }
  function outputName(file, format) { return format === 'webp' ? baseName(file.name) + '.webp' : baseName(file.name) + extForMime(file.type); }
  function imageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); }; image.src = url;
    });
  }
  function canvasBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('encode')); }, mime, quality);
    });
  }
  async function convertFree(file, format, qualityPercent) {
    var mime = format === 'webp' ? 'image/webp' : file.type;
    var name = outputName(file, format);
    if (mime === 'image/png' && qualityPercent === 100) return { name: name, blob: file, passthrough: true };
    var image = await imageFromFile(file);
    var canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    var context = canvas.getContext('2d', { alpha: mime !== 'image/jpeg' });
    if (!context) throw new Error('canvas');
    if (mime === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
    context.drawImage(image, 0, 0);
    if (mime === 'image/png' && qualityPercent < 100) {
      var bits = Math.max(1, Math.round(qualityPercent / 12.5)); var levels = Math.pow(2, bits); var step = 256 / levels;
      var imageData = context.getImageData(0, 0, canvas.width, canvas.height); var data = imageData.data;
      for (var i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.floor(data[i] / step) * step);
        data[i + 1] = Math.min(255, Math.floor(data[i + 1] / step) * step);
        data[i + 2] = Math.min(255, Math.floor(data[i + 2] / step) * step);
      }
      context.putImageData(imageData, 0, 0);
    }
    return { name: name, blob: await canvasBlob(canvas, mime, qualityPercent / 100), passthrough: false };
  }

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n++) { var value = n; for (var k = 0; k < 8; k++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1); crcTable[n] = value >>> 0; }
    }
    var crc = 0xffffffff; for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function put16(view, offset, value) { view.setUint16(offset, value, true); }
  function put32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }
  function dosStamp(date) {
    var year = Math.max(1980, date.getFullYear());
    return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
  }
  async function makeZip(items) {
    var encoder = new TextEncoder(), chunks = [], central = [], offset = 0, stamp = dosStamp(new Date());
    for (var i = 0; i < items.length; i++) {
      var name = encoder.encode(items[i].name), bytes = new Uint8Array(await items[i].blob.arrayBuffer()), crc = crc32(bytes);
      var localBuffer = new ArrayBuffer(30 + name.length), local = new DataView(localBuffer);
      put32(local, 0, 0x04034b50); put16(local, 4, 20); put16(local, 6, 0x0800); put16(local, 8, 0); put16(local, 10, stamp.time); put16(local, 12, stamp.date); put32(local, 14, crc); put32(local, 18, bytes.length); put32(local, 22, bytes.length); put16(local, 26, name.length); put16(local, 28, 0); new Uint8Array(localBuffer, 30).set(name); chunks.push(localBuffer, bytes);
      var centralBuffer = new ArrayBuffer(46 + name.length), header = new DataView(centralBuffer);
      put32(header, 0, 0x02014b50); put16(header, 4, 20); put16(header, 6, 20); put16(header, 8, 0x0800); put16(header, 10, 0); put16(header, 12, stamp.time); put16(header, 14, stamp.date); put32(header, 16, crc); put32(header, 20, bytes.length); put32(header, 24, bytes.length); put16(header, 28, name.length); put16(header, 30, 0); put16(header, 32, 0); put16(header, 34, 0); put16(header, 36, 0); put32(header, 38, 0); put32(header, 42, offset); new Uint8Array(centralBuffer, 46).set(name); central.push(centralBuffer); offset += localBuffer.byteLength + bytes.byteLength;
    }
    var centralSize = central.reduce(function (sum, chunk) { return sum + chunk.byteLength; }, 0), endBuffer = new ArrayBuffer(22), end = new DataView(endBuffer);
    put32(end, 0, 0x06054b50); put16(end, 4, 0); put16(end, 6, 0); put16(end, 8, items.length); put16(end, 10, items.length); put32(end, 12, centralSize); put32(end, 16, offset); put16(end, 20, 0);
    return new Blob(chunks.concat(central, [endBuffer]), { type: 'application/zip' });
  }

  async function fetchJson(url, token, options) {
    options = options || {}; options.headers = Object.assign({}, options.headers || {}, token ? { 'X-Pub-Token': token } : {});
    var response = await fetch(url, options); if (!response.ok) throw new Error(String(response.status)); return response.json();
  }
  async function loadScriptText(url, token) {
    var response = await fetch(url, { headers: token ? { 'X-Pub-Token': token } : {}, cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    var script = document.createElement('script'); script.textContent = await response.text(); document.head.appendChild(script); script.remove();
  }

  function injectStyles() {
    if (document.getElementById('io-styles')) return;
    var style = document.createElement('style'); style.id = 'io-styles';
    style.textContent = `
      .io-app{height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:var(--pub-bg,var(--bg,#1e1e2e));color:var(--pub-fg,var(--fg,#cdd6f4));font:14px/1.45 var(--font,system-ui,sans-serif)}
      .io-head{padding:18px 20px 14px;border-bottom:1px solid var(--pub-border,var(--border,#45475a));flex:0 0 auto}.io-head h1{font-size:20px;line-height:1.2;margin:0 0 4px}.io-head p{margin:0;color:var(--pub-fg2,var(--fg2,#a6adc8));font-size:13px}.io-scroll{flex:1;overflow:auto;padding:18px 20px 24px}
      .io-controls{display:grid;grid-template-columns:minmax(260px,1fr) 250px;gap:16px;margin-bottom:12px}.io-drop{min-height:180px;border:2px dashed var(--pub-border,var(--border,#585b70));border-radius:14px;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;box-sizing:border-box;cursor:pointer;background:var(--pub-surface,var(--surface,#181825));transition:.16s border-color,.16s background,.16s transform;position:relative;overflow:hidden}.io-drop:hover,.io-drop:focus,.io-drop.drag{border-color:var(--pub-accent,var(--accent,#89b4fa));background:color-mix(in srgb,var(--pub-accent,var(--accent,#89b4fa)) 9%,var(--pub-surface,var(--surface,#181825)));outline:none}.io-drop.drag{transform:scale(.995)}.io-drop-icon{font-size:34px;margin-bottom:7px}.io-drop-title{font-size:16px;font-weight:700}.io-drop-hint{font-size:12px;color:var(--pub-fg2,var(--fg2,#a6adc8));margin-top:4px}.io-progress-track{height:4px;background:var(--pub-surface2,var(--surface2,#313244));position:absolute;inset:auto 0 0}.io-progress{height:100%;width:0;background:var(--pub-accent,var(--accent,#89b4fa));transition:width .2s}
      .io-panel,.io-premium{border:1px solid var(--pub-border,var(--border,#45475a));border-radius:14px;background:var(--pub-surface,var(--surface,#181825));padding:15px}.io-panel{display:flex;flex-direction:column;gap:12px}.io-field{display:flex;flex-direction:column;gap:5px}.io-field label,.io-label{font-size:12px;color:var(--pub-fg2,var(--fg2,#a6adc8));font-weight:600}.io-field select,.io-field input[type=text],.io-field input[type=number]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--pub-border,var(--border,#45475a));border-radius:8px;background:var(--pub-surface2,var(--surface2,#313244));color:inherit;font:inherit}.io-quality-row{display:grid;grid-template-columns:1fr 44px;gap:9px;align-items:center}.io-quality-row input{accent-color:var(--pub-accent,var(--accent,#89b4fa));width:100%}.io-quality-value{text-align:right;font-weight:700}.io-actions{display:flex;flex-direction:column;gap:7px;margin-top:auto}
      .io-btn{border:1px solid var(--pub-border,var(--border,#45475a));border-radius:8px;background:var(--pub-surface2,var(--surface2,#313244));color:inherit;padding:8px 11px;cursor:pointer;font:inherit;font-weight:600}.io-btn:hover{filter:brightness(1.12)}.io-btn:disabled{opacity:.45;cursor:not-allowed}.io-primary{border-color:transparent;background:var(--pub-accent,var(--accent,#89b4fa));color:var(--pub-bg,var(--bg,#1e1e2e))}.io-privacy{display:flex;gap:7px;align-items:center;color:var(--pub-fg2,var(--fg2,#a6adc8));font-size:12px;margin:0 0 14px}
      .io-premium{margin:0 0 14px;position:relative;padding:0;overflow:hidden}.io-premium-accordion>summary{list-style:none;cursor:pointer;padding:15px;user-select:none}.io-premium-accordion>summary::-webkit-details-marker{display:none}.io-premium-head{display:flex;align-items:center;gap:10px;margin:0}.io-premium-head:before{content:'›';font-size:22px;line-height:1;color:var(--pub-fg2,var(--fg2,#a6adc8));transition:transform .16s}.io-premium-accordion[open] .io-premium-head:before{transform:rotate(90deg)}.io-premium-head h2{font-size:15px;margin:0}.io-premium-head p{font-size:12px;color:var(--pub-fg2,var(--fg2,#a6adc8));margin:2px 0 0}.io-active-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:999px;background:var(--pub-accent,var(--accent,#89b4fa));color:var(--pub-bg,var(--bg,#1e1e2e));font-size:11px;font-weight:800}.io-premium-badge{margin-left:auto;color:var(--pub-warning,var(--warning,#f9e2af));font-size:12px;font-weight:700;white-space:nowrap}.io-premium-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;padding:0 15px 15px}.io-tool{border:1px solid var(--pub-border,var(--border,#45475a));border-radius:10px;padding:12px;background:var(--pub-surface2,var(--surface2,#313244));display:flex;flex-direction:column;gap:9px}.io-tool h3{font-size:13px;margin:0}.io-row{display:flex;align-items:center;gap:8px}.io-row>label{font-size:12px}.io-row .io-field{flex:1}.io-check{display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer}.io-check input{accent-color:var(--pub-accent,var(--accent,#89b4fa))}.io-disabled{opacity:.5;pointer-events:none}
      .io-errors{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}.io-error{border:1px solid color-mix(in srgb,var(--pub-red,var(--red,#f38ba8)) 45%,transparent);background:color-mix(in srgb,var(--pub-red,var(--red,#f38ba8)) 10%,transparent);color:var(--pub-red,var(--red,#f38ba8));border-radius:8px;padding:8px 10px;font-size:12px}.io-results{border:1px solid var(--pub-border,var(--border,#45475a));border-radius:14px;background:var(--pub-surface,var(--surface,#181825));overflow:hidden}.io-empty{text-align:center;padding:38px 16px;color:var(--pub-fg2,var(--fg2,#a6adc8))}.io-table-wrap{overflow-x:auto}.io-table{width:100%;border-collapse:collapse;min-width:720px}.io-table th{padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,var(--fg2,#a6adc8));background:var(--pub-surface2,var(--surface2,#313244))}.io-table td{padding:10px 12px;border-top:1px solid var(--pub-border,var(--border,#45475a));vertical-align:middle}.io-thumb{width:52px;height:52px;object-fit:cover;border-radius:8px;display:block;background:#111;cursor:pointer}.io-name{max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.io-sub{font-size:11px;color:var(--pub-fg2,var(--fg2,#a6adc8));font-weight:400}.io-saving{font-weight:700;color:var(--pub-green,var(--green,#a6e3a1))}.io-saving.grew{color:var(--pub-warning,var(--warning,#f9e2af))}.io-status{font-size:12px;color:var(--pub-fg2,var(--fg2,#a6adc8));margin:0 0 9px}.io-hidden{display:none!important}
      @media(max-width:760px){.io-controls{grid-template-columns:1fr}.io-premium-grid{grid-template-columns:1fr}}
      @media(max-width:520px){.io-head{padding:14px 14px 12px}.io-scroll{padding:12px 12px 20px}.io-drop{min-height:150px}.io-panel{display:grid;grid-template-columns:1fr}.io-actions{display:grid;grid-template-columns:1fr 1fr}.io-table{min-width:640px}}
    `;
    document.head.appendChild(style);
  }

  function mount(root, options) {
    options = options || {}; injectStyles();
    var token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = '<div class="io-app"><div class="io-empty">' + esc(tr('io_login')) + '</div></div>';
      if (options.onNeedLogin) options.onNeedLogin(root); return { destroy: function () {} };
    }
    var destroyed = false, items = [], errors = [], processing = false, done = 0, total = 0, archiveContext = null;
    var settings = Object.assign({}, DEFAULTS), allowed = {}, adminSettings = {}, premiumActive = false, desktop = !!(window.mvmOS && window.mvmOS.premiumGate);
    var prefsKey = null;

    function destroy() { destroyed = true; items.forEach(function (item) { URL.revokeObjectURL(item.url); }); items = []; root.innerHTML = ''; }
    async function boot() {
      var publicConfig = await fetchJson('/pub/image-optimizer/api/config', token).catch(function () { return { premium: false, features: {} }; });
      prefsKey = publicConfig.profile_id ? 'image_optimizer_settings_v1:' + publicConfig.profile_id : null;
      if (desktop) {
        adminSettings = await fetchJson('/api/apps/image-optimizer/admin/settings', null).catch(function () { return { premium: false }; });
        allowed = { archive_upload: true, resize: true, bulk_rename: true, preserve_transparency: true };
        premiumActive = !!adminSettings.premium;
      } else {
        allowed = publicConfig.features || {};
        premiumActive = !!publicConfig.premium && Object.keys(allowed).some(function (key) { return allowed[key]; });
      }
      if (premiumActive && prefsKey) {
        try { settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(prefsKey) || '{}')); } catch (_) {}
      }
      if (premiumActive) {
        var assetBase = desktop ? '/api/apps/image-optimizer/admin/premium/' : '/pub/image-optimizer/api/premium/';
        try {
          if (desktop || allowed.archive_upload) await loadScriptText(assetBase + 'jszip.min.js', desktop ? null : token);
          await loadScriptText(assetBase + 'features.js', desktop ? null : token);
        } catch (_) { premiumActive = false; }
      }
      if (!destroyed) renderShell();
    }

    function premiumPanel() {
      var show = desktop || allowed.resize || allowed.bulk_rename || allowed.preserve_transparency;
      if (!show) return '';
      var resize = allowed.resize, rename = allowed.bulk_rename, transparency = allowed.preserve_transparency;
      return '<section class="io-premium" id="io-premium-panel"><details class="io-premium-accordion"><summary><div class="io-premium-head"><div><h2>' + esc(desktop ? tr('io_premium_title') : tr('io_advanced_title')) + '</h2><p>' + esc(tr('io_advanced_hint')) + '</p></div><span class="io-active-count io-hidden" aria-label="0">0</span>' + (desktop ? '<span class="io-premium-badge">★ Premium</span>' : '') + '</div></summary><div class="io-premium-grid">' +
        (resize ? '<div class="io-tool"><h3>' + esc(tr('io_resize_title')) + '</h3><label class="io-check"><input data-setting="resizeEnabled" type="checkbox"> ' + esc(tr('io_resize_enable')) + '</label><div class="io-row"><div class="io-field"><label>' + esc(tr('io_width')) + '</label><input data-setting="width" type="number" min="1" placeholder="px"></div><div class="io-field"><label>' + esc(tr('io_height')) + '</label><input data-setting="height" type="number" min="1" placeholder="px"></div></div><label class="io-check"><input data-setting="keepAspect" type="checkbox"> ' + esc(tr('io_keep_aspect')) + '</label></div>' : '') +
        (rename ? '<div class="io-tool"><h3>' + esc(tr('io_rename_title')) + '</h3><div class="io-row"><div class="io-field"><label>' + esc(tr('io_prefix')) + '</label><input data-setting="prefix" type="text"></div><div class="io-field"><label>' + esc(tr('io_suffix')) + '</label><input data-setting="suffix" type="text"></div></div><div class="io-row"><div class="io-field"><label>' + esc(tr('io_case')) + '</label><select data-setting="caseMode"><option value="keep">' + esc(tr('io_keep')) + '</option><option value="lower">' + esc(tr('io_lowercase')) + '</option><option value="upper">' + esc(tr('io_uppercase')) + '</option></select></div><div class="io-field"><label>' + esc(tr('io_spaces')) + '</label><select data-setting="spaceMode"><option value="keep">' + esc(tr('io_keep')) + '</option><option value="hyphen">' + esc(tr('io_hyphens')) + '</option><option value="underscore">' + esc(tr('io_underscores')) + '</option></select></div></div><div class="io-row"><div class="io-field"><label>' + esc(tr('io_find')) + '</label><input data-setting="findText" type="text"></div><div class="io-field"><label>' + esc(tr('io_replace')) + '</label><input data-setting="replaceText" type="text"></div></div><label class="io-check"><input data-setting="renameOnly" type="checkbox"> ' + esc(tr('io_rename_only')) + '</label></div>' : '') +
        (transparency ? '<div class="io-tool"><h3>' + esc(tr('io_transparency_title')) + '</h3><label class="io-check"><input data-setting="preserveTransparency" type="checkbox"> ' + esc(tr('io_preserve_transparency')) + '</label><p class="io-drop-hint">' + esc(tr('io_transparency_hint')) + '</p></div>' : '') +
        '<div class="io-tool"><h3>' + esc(tr('io_preferences_title')) + '</h3><p class="io-drop-hint">' + esc(tr('io_preferences_hint')) + '</p><button class="io-btn" data-action="reset-settings">' + esc(tr('io_reset_settings')) + '</button></div>' +
        '</div></details></section>';
    }

    function renderShell() {
      var canArchive = premiumActive && allowed.archive_upload;
      root.innerHTML = '<div class="io-app"><header class="io-head"><h1>🖼️ ' + esc(tr('io_title')) + '</h1><p>' + esc(tr('io_subtitle')) + '</p></header><div class="io-scroll"><div class="io-controls"><div class="io-drop" role="button" tabindex="0" aria-label="' + esc(tr('io_select_files')) + '"><div><div class="io-drop-icon">⇧</div><div class="io-drop-title">' + esc(tr('io_drop_title')) + '</div><div class="io-drop-hint">' + esc(tr(canArchive ? 'io_drop_hint_zip' : 'io_drop_hint')) + '</div></div><div class="io-progress-track io-hidden"><div class="io-progress"></div></div></div><div class="io-panel"><div class="io-field"><label for="io-format">' + esc(tr('io_format')) + '</label><select id="io-format"><option value="webp">' + esc(tr('io_format_webp')) + '</option><option value="original">' + esc(tr('io_format_original')) + '</option></select></div><div class="io-field"><label for="io-quality">' + esc(tr('io_quality')) + '</label><div class="io-quality-row"><input id="io-quality" type="range" min="10" max="100" step="5"><output class="io-quality-value"></output></div></div><div class="io-actions"><button class="io-btn io-primary" data-action="zip" disabled>' + esc(tr('io_download_all')) + '</button><button class="io-btn" data-action="clear" disabled>' + esc(tr('io_clear')) + '</button></div></div></div><input class="io-file io-hidden" type="file" multiple accept="' + (canArchive ? '.zip,application/zip,' : '') + 'image/jpeg,image/png,image/webp"><p class="io-privacy">🔒 <span>' + esc(tr('io_privacy')) + '</span></p>' + premiumPanel() + '<div class="io-status io-hidden"></div><div class="io-errors"></div><div class="io-results"><div class="io-empty">' + esc(tr('io_no_results')) + '</div></div></div></div>';
      bind(); applySettings(); render();
      if (desktop && !premiumActive && root.querySelector('#io-premium-panel')) window.mvmOS.premiumGate(root.querySelector('#io-premium-panel'), tr('io_premium_required'));
    }

    var fileInput, drop, formatSelect, qualityInput, qualityValue, progressTrack, progress, status, errorBox, results, zipButton, clearButton;
    function bind() {
      fileInput = root.querySelector('.io-file'); drop = root.querySelector('.io-drop'); formatSelect = root.querySelector('#io-format'); qualityInput = root.querySelector('#io-quality'); qualityValue = root.querySelector('.io-quality-value'); progressTrack = root.querySelector('.io-progress-track'); progress = root.querySelector('.io-progress'); status = root.querySelector('.io-status'); errorBox = root.querySelector('.io-errors'); results = root.querySelector('.io-results'); zipButton = root.querySelector('[data-action="zip"]'); clearButton = root.querySelector('[data-action="clear"]');
      drop.onclick = function () { if (!processing) fileInput.click(); };
      drop.onkeydown = function (event) { if (!processing && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInput.click(); } };
      ['dragenter','dragover'].forEach(function (name) { drop.addEventListener(name, function (event) { event.preventDefault(); if (!processing) drop.classList.add('drag'); }); });
      ['dragleave','drop'].forEach(function (name) { drop.addEventListener(name, function (event) { event.preventDefault(); drop.classList.remove('drag'); }); });
      drop.addEventListener('drop', function (event) { handleUpload(event.dataTransfer.files); });
      fileInput.onchange = function () { handleUpload(fileInput.files); fileInput.value = ''; };
      root.querySelectorAll('[data-setting]').forEach(function (element) { element.addEventListener(element.type === 'text' || element.type === 'number' ? 'input' : 'change', function () { readSettings(); savePrefs(); updateControlStates(); updateAdvancedCount(); }); });
      formatSelect.onchange = function () { settings.format = formatSelect.value; savePrefs(); };
      qualityInput.oninput = function () { settings.quality = Number(qualityInput.value); qualityValue.textContent = settings.quality + '%'; savePrefs(); };
      root.addEventListener('click', actionClick); results.addEventListener('click', resultClick);
    }
    function applySettings() {
      formatSelect.value = settings.format; qualityInput.value = settings.quality; qualityValue.textContent = settings.quality + '%';
      root.querySelectorAll('[data-setting]').forEach(function (element) { var value = settings[element.dataset.setting]; if (element.type === 'checkbox') element.checked = !!value; else element.value = value == null ? '' : value; });
      updateControlStates(); updateAdvancedCount();
    }
    function readSettings() {
      root.querySelectorAll('[data-setting]').forEach(function (element) { settings[element.dataset.setting] = element.type === 'checkbox' ? element.checked : element.value; });
      settings.format = formatSelect.value; settings.quality = Number(qualityInput.value);
    }
    function savePrefs() { if (premiumActive && prefsKey) localStorage.setItem(prefsKey, JSON.stringify(settings)); }
    function resetPrefs() { if (prefsKey) localStorage.removeItem(prefsKey); settings = Object.assign({}, DEFAULTS); applySettings(); }
    function activeAdvancedCount() {
      var count = 0;
      if (allowed.resize && settings.resizeEnabled) count++;
      if (allowed.bulk_rename) {
        if (String(settings.prefix || '').trim()) count++;
        if (String(settings.suffix || '').trim()) count++;
        if (settings.caseMode && settings.caseMode !== 'keep') count++;
        if (settings.spaceMode && settings.spaceMode !== 'keep') count++;
        if (String(settings.findText || '')) count++;
        if (settings.renameOnly) count++;
      }
      if (allowed.preserve_transparency && settings.preserveTransparency !== DEFAULTS.preserveTransparency) count++;
      return count;
    }
    function updateAdvancedCount() {
      var badge = root.querySelector('.io-active-count'); if (!badge) return;
      var count = activeAdvancedCount(); badge.textContent = count || ''; badge.setAttribute('aria-label', String(count)); badge.classList.toggle('io-hidden', !count);
    }
    function collapseAdvanced() {
      var accordion = root.querySelector('.io-premium-accordion'); if (accordion) accordion.open = false;
    }
    function updateControlStates() {
      var renameOnly = !!(allowed.bulk_rename && settings.renameOnly);
      formatSelect.disabled = processing || renameOnly; qualityInput.disabled = processing || renameOnly;
      root.querySelectorAll('[data-setting="width"],[data-setting="height"],[data-setting="keepAspect"]').forEach(function (element) { element.disabled = processing || renameOnly || !settings.resizeEnabled; });
    }
    function setProcessing(value) {
      processing = value; drop.setAttribute('aria-disabled', value ? 'true' : 'false'); root.querySelectorAll('button,input,select').forEach(function (element) { element.disabled = value || element.disabled; });
      if (!value) { root.querySelectorAll('button,input,select').forEach(function (element) { element.disabled = false; }); updateControlStates(); }
    }
    function render() {
      if (destroyed || !results) return;
      errorBox.innerHTML = errors.map(function (message) { return '<div class="io-error">' + esc(message) + '</div>'; }).join('');
      zipButton.disabled = processing || !items.length; clearButton.disabled = processing || (!items.length && !errors.length);
      results.classList.toggle('io-hidden', !!archiveContext);
      if (archiveContext) return;
      if (!items.length) { results.innerHTML = '<div class="io-empty">' + esc(tr('io_no_results')) + '</div>'; return; }
      results.innerHTML = '<div class="io-table-wrap"><table class="io-table"><thead><tr><th>' + esc(tr('io_preview')) + '</th><th>' + esc(tr('io_file')) + '</th><th>' + esc(tr('io_before')) + '</th><th>' + esc(tr('io_after')) + '</th><th>' + esc(tr('io_savings')) + '</th><th>' + esc(tr('io_action')) + '</th></tr></thead><tbody>' + items.map(function (item, index) {
        var saving = ((item.originalSize - item.blob.size) / item.originalSize) * 100, savingText = (saving >= 0 ? '-' : '+') + Math.abs(saving).toFixed(1) + '%';
        return '<tr><td><img class="io-thumb" src="' + esc(item.url) + '" alt="' + esc(item.name) + '" data-result-action="preview" data-index="' + index + '" title="' + esc(tr('io_open_preview', { name: item.name })) + '"></td><td><div class="io-name" title="' + esc(item.name) + '">' + esc(item.name) + '</div><div class="io-sub">' + item.quality + '%' + (item.passthrough ? ' · ' + esc(tr('io_passthrough')) : '') + '</div></td><td>' + esc(size(item.originalSize)) + '</td><td>' + esc(size(item.blob.size)) + '</td><td><span class="io-saving' + (saving < 0 ? ' grew' : '') + '">' + savingText + '</span></td><td><button class="io-btn io-primary" data-result-action="download" data-index="' + index + '">' + esc(tr('io_download')) + '</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    function clear() {
      items.forEach(function (item) { URL.revokeObjectURL(item.url); }); items = []; errors = []; archiveContext = null; done = 0; total = 0;
      status.classList.add('io-hidden'); progressTrack.classList.add('io-hidden'); progress.style.width = '0%'; render();
    }
    async function processFiles(list, paths) {
      if (processing || destroyed || !list.length) return;
      readSettings(); setProcessing(true); done = 0; total = list.length; errors = []; progressTrack.classList.remove('io-hidden'); status.classList.remove('io-hidden'); render();
      for (var i = 0; i < list.length; i++) {
        var file = list[i], sourcePath = paths ? paths[i] : file.name;
        if (!SUPPORTED.includes(file.type)) errors.push(tr('io_unsupported', { name: sourcePath }));
        else {
          try {
            var result = premiumActive && window.ImageOptimizerPremium ? await window.ImageOptimizerPremium.processImage(file, sourcePath, settings.format, settings.quality, settings, allowed) : await convertFree(file, settings.format, settings.quality);
            if (items.some(function (item) { return item.name === result.name; })) errors.push(tr('io_duplicate', { name: result.name }));
            else items.unshift({ name: result.name, blob: result.blob, url: URL.createObjectURL(result.blob), originalSize: file.size, quality: settings.renameOnly && allowed.bulk_rename ? '—' : settings.quality, passthrough: result.passthrough, sourcePath: sourcePath });
          } catch (_) { errors.push(tr('io_error', { name: sourcePath })); }
        }
        done++; progress.style.width = Math.round(done / total * 100) + '%'; status.textContent = tr('io_processing', { done: done, total: total }); render();
      }
      setProcessing(false); status.textContent = tr('io_ready'); collapseAdvanced(); render();
    }
    function handleRegular(files) { if (archiveContext) clear(); processFiles(Array.from(files || [])); }
    function isArchive(file) { return !!file && (file.type === 'application/zip' || /\.zip$/i.test(file.name || '')); }
    function handleUpload(files) {
      var list = Array.from(files || []), archive = list.find(isArchive);
      if (!archive) { handleRegular(list); return; }
      if (premiumActive && allowed.archive_upload && window.ImageOptimizerPremium) handleArchive(archive);
      else { errors.push(tr('io_unsupported', { name: archive.name })); render(); }
    }
    async function handleArchive(file) {
      if (!premiumActive || !allowed.archive_upload || !window.ImageOptimizerPremium) return;
      clear(); setProcessing(true); status.classList.remove('io-hidden'); status.textContent = tr('io_archive_reading');
      try {
        archiveContext = await window.ImageOptimizerPremium.loadArchive(file);
        if (!archiveContext.images.length) { errors.push(tr('io_archive_empty')); setProcessing(false); render(); return; }
        setProcessing(false); await processFiles(archiveContext.images.map(function (item) { return item.file; }), archiveContext.images.map(function (item) { return item.path; }));
      } catch (_) { setProcessing(false); errors.push(tr('io_archive_error')); render(); }
    }
    async function actionClick(event) {
      var target = event.target.closest('[data-action]'); if (!target) return; var action = target.dataset.action;
      if (action === 'clear') clear();
      if (action === 'reset-settings') resetPrefs();
      if (action === 'zip' && items.length && !processing) {
        target.disabled = true;
        try {
          var blob, name;
          if (archiveContext && window.ImageOptimizerPremium) { blob = await window.ImageOptimizerPremium.buildArchive(archiveContext, items); name = window.ImageOptimizerPremium.archiveOutputName(archiveContext.name); }
          else { blob = await makeZip(items); name = 'optimised_images.zip'; }
          download(blob, name); clear();
        } catch (_) { errors.push(tr('io_zip_error')); render(); }
      }
    }
    function resultClick(event) {
      var target = event.target.closest('[data-result-action]'); if (!target) return; var item = items[Number(target.dataset.index)]; if (!item) return;
      if (target.dataset.resultAction === 'download') download(item.blob, basename(item.name));
      if (target.dataset.resultAction === 'preview') window.open(item.url, '_blank', 'noopener');
    }
    boot(); return { destroy: destroy };
  }

  window.ImageOptimizer = { mount: mount };
})();
