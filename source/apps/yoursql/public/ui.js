// YourSQL — shared UI helpers

const _ysqlT = window.t || (k => k);

YS.modal = function(container, html, opts) {
  opts = opts || {};
  const ov = document.createElement('div');
  ov.style.cssText = 'position:absolute;inset:0;z-index:999;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center';
  const modal = document.createElement('div');
  const w = opts.width || 'min(460px,96%)';
  modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:' + w + ';' +
    (opts.maxHeight ? 'max-height:' + opts.maxHeight + ';overflow-y:auto;' : '') +
    'padding:20px;display:flex;flex-direction:column;gap:12px;box-shadow:var(--shadow)';
  modal.innerHTML = html;
  ov.appendChild(modal);
  container.style.position = 'relative';
  container.appendChild(ov);
  if (!opts.noBackdropClose) {
    ov.addEventListener('click', function(e) { if (e.target === ov) ov.remove(); });
  }
  modal.close = function() { ov.remove(); };
  modal.overlay = ov;
  return modal;
};

YS.escHtml = function(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

YS.toast = function(msg, type, opts) {
  type = type || 'info';
  opts = opts || {};
  var container = document.getElementById('ysql-toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ysql-toasts';
    container.style.cssText = 'position:fixed;bottom:60px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none';
    document.body.appendChild(container);
  }
  var t = document.createElement('div');
  var colors = { success:'#50fa7b', error:'#f38ba8', info:'var(--accent)' };
  t.style.cssText = 'background:var(--surface);border:1px solid ' + (colors[type]||colors.info) + ';color:var(--text);padding:8px 14px;border-radius:var(--radius);font-size:.83rem;box-shadow:var(--shadow);pointer-events:auto;max-width:300px;display:flex;align-items:center;gap:8px';
  if (opts.spinner) {
    var sp = document.createElement('span');
    sp.style.cssText = 'width:12px;height:12px;border:2px solid ' + (colors[type]||colors.info) + ';border-top-color:transparent;border-radius:50%;display:inline-block;flex:none;animation:ysql-toast-spin .7s linear infinite';
    t.appendChild(sp);
    if (!document.getElementById('ysql-toast-spin-kf')) {
      var style = document.createElement('style');
      style.id = 'ysql-toast-spin-kf';
      style.textContent = '@keyframes ysql-toast-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
  }
  var label = document.createElement('span');
  label.textContent = msg;
  t.appendChild(label);
  container.appendChild(t);
  var close = function() { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(function(){t.remove();},300); };
  if (!opts.sticky) setTimeout(close, 3000);
  return { close: close, el: t };
};

YS.api = async function(path, opts) {
  opts = opts || {};
  const method = opts.method || 'GET';
  const headers = {};
  let body;
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const r = await fetch('/api/apps/yoursql' + path, { method, headers, body });
  if (r.status === 413) throw new Error(_ysqlT('ysql_file_too_large'));
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e) {
    console.error('[YourSQL] non-JSON response:', r.status, text.slice(0,200));
    throw new Error(_ysqlT('ysql_server_error', { status: r.status }));
  }
  if (!r.ok) {
    let msg = data?.detail || data?.error || data;
    if (msg && typeof msg === 'object') {
      msg = msg.error === 'driver_missing'
        ? _ysqlT('ysql_driver_missing', { package: msg.package, family: msg.family })
        : JSON.stringify(msg);
    }
    throw new Error(msg);
  }
  return data;
};

// Parse column meta from table-structure response
YS.parseColMeta = function(structCols) {
  var meta = {};
  (structCols || []).forEach(function(c) {
    var type = (c.Type || '').toLowerCase();
    var base = type.replace(/\(.*/, '').trim().toUpperCase();
    var enumMatch = type.match(/^enum\((.+)\)$/i);
    meta[c.Field] = {
      baseType: base,
      key: c.Key || '',
      allowNull: c.Null === 'YES',
      autoIncrement: (c.Extra || '').indexOf('auto_increment') !== -1,
      enumValues: enumMatch ? enumMatch[1] : '',
      length: (type.match(/\((\d+)/) || [])[1] || '',
      extra: c.Extra || '',
      comment: c.Comment || '',
    };
  });
  return meta;
};

YS.isNumericType = function(base) {
  var b = base.replace(/\s+(UN)?SIGNED$/,'');
  return ['TINYINT','SMALLINT','MEDIUMINT','INT','BIGINT','FLOAT','DOUBLE','REAL','DECIMAL','NUMERIC','BIT'].indexOf(b) !== -1;
};
YS.isDateType = function(base) {
  return ['DATE','DATETIME','TIMESTAMP','TIME','YEAR'].indexOf(base) !== -1;
};
YS.isTextType = function(base) {
  return ['CHAR','VARCHAR','TINYTEXT','TEXT','MEDIUMTEXT','LONGTEXT','ENUM','SET'].indexOf(base) !== -1;
};

// A date, time or timestamp cell is chosen with the shared mvmOS calendar and clock, in the regional format.
// The element keeps the interface of an input: value (the database text, 'YYYY-MM-DD', 'HH:MM:SS' or
// 'YYYY-MM-DD HH:MM:SS'), focus() (opens the calendar), disabled, and bubbling 'change' events. The calendar
// has no seconds, so the seconds of the stored value are kept; a value it cannot show (a zero date, a time
// past 24 hours) is returned as it was until the person picks another.
YS.buildDatePicker = function(base, strVal) {
  var P = window.mvmOS && window.mvmOS.dateTimePicker;
  if (!P) return null;
  var type = base === 'DATE' ? 'date' : base === 'TIME' ? 'time' : 'datetime';
  var m = type === 'date' ? /^(\d{4}-\d{2}-\d{2})$/.exec(strVal)
    : type === 'time' ? /^(\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(strVal)
    : /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(strVal);
  var seconds = '00', canonical = '';
  if (m) {
    if (type === 'date') canonical = m[1];
    else if (type === 'time') { canonical = m[1]; seconds = m[2] || '00'; }
    else { canonical = m[1] + 'T' + m[2]; seconds = m[3] || '00'; }
  }
  var touched = false, field;
  var wrap = document.createElement('span');
  wrap.className = 's-input'; wrap.style.display = 'inline-flex';
  var o = { type: type, label: base };
  try { field = P.create(wrap, Object.assign({}, o, { value: canonical })); } catch (e) { field = P.create(wrap, o); }
  // Listening on the hidden field itself, so it is known as changed before anything above it hears the event.
  field.input.addEventListener('change', function() { touched = true; });
  Object.defineProperty(wrap, 'value', {
    get: function() {
      if (!touched) return strVal;
      var v = field.value;
      if (!v) return '';
      return type === 'date' ? v : type === 'time' ? v + ':' + seconds : v.replace('T', ' ') + ':' + seconds;
    },
    set: function(v) { strVal = v == null ? '' : String(v); touched = false; }
  });
  Object.defineProperty(wrap, 'disabled', { get: function() { return field.button.disabled; }, set: function(v) { field.button.disabled = !!v; } });
  wrap.focus = function() { field.open(); };
  wrap.isPicker = true; wrap.picker = field;
  return wrap;
};

// Build smart input for a cell
YS.buildCellInput = function(meta, val, inline) {
  meta = meta || {};
  var base = (meta.baseType || 'VARCHAR').toUpperCase();
  var strVal = val === null || val === undefined ? '' : String(val);

  if (!inline && ['TEXT','TINYTEXT','MEDIUMTEXT','LONGTEXT'].indexOf(base) !== -1) {
    var ta = document.createElement('textarea');
    ta.className = 's-input'; ta.value = strVal;
    ta.style.cssText = 'width:100%;min-height:80px;font-family:monospace;font-size:.82rem;resize:vertical';
    return ta;
  }
  if (base === 'DATE' || base === 'DATETIME' || base === 'TIMESTAMP' || base === 'TIME') {
    var picked = YS.buildDatePicker(base, strVal);
    if (picked) return picked;
  }
  if (base === 'DATE') {
    var inp = document.createElement('input');
    inp.type = 'date'; inp.className = 's-input'; inp.value = strVal; return inp;
  }
  if (base === 'DATETIME' || base === 'TIMESTAMP') {
    var inp = document.createElement('input');
    inp.type = 'datetime-local'; inp.step = '1'; inp.className = 's-input';
    inp.value = strVal.replace(' ','T'); return inp;
  }
  if (base === 'TIME') {
    var inp = document.createElement('input');
    inp.type = 'time'; inp.step = '1'; inp.className = 's-input'; inp.value = strVal; return inp;
  }
  if (base === 'ENUM' && meta.enumValues) {
    var sel = document.createElement('select'); sel.className = 's-input';
    meta.enumValues.replace(/^'|'$/g,'').split("','").forEach(function(v) {
      var opt = document.createElement('option'); opt.value = v; opt.textContent = v;
      if (v === strVal) opt.selected = true; sel.appendChild(opt);
    });
    return sel;
  }
  if (YS.isNumericType(base)) {
    var inp = document.createElement('input');
    inp.type = 'number'; inp.step = base === 'INT'||base === 'BIGINT' ? '1' : 'any';
    inp.className = 's-input'; inp.value = strVal; return inp;
  }
  var inp = document.createElement('input');
  inp.type = 'text'; inp.className = 's-input'; inp.value = strVal; return inp;
};

YS.getCellInputValue = function(input, meta) {
  meta = meta || {};
  var base = (meta.baseType || '').toUpperCase();
  var raw = input.value;
  if (input.type === 'datetime-local' && raw) return raw.replace('T',' ');
  if (raw === '' && YS.isNumericType(base)) return null;
  return raw;
};

YS.buildWhereFromRow = function(row, colMeta) {
  var pkCols = Object.keys(colMeta || {}).filter(function(c){ return colMeta[c].key === 'PRI'; });
  var useCols = pkCols.length ? pkCols : Object.keys(row);
  var where = {};
  useCols.forEach(function(c){ where[c] = row[c]; });
  return where;
};
