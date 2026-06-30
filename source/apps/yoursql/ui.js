// YourSQL — shared UI helpers

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

YS.toast = function(msg, type) {
  type = type || 'info';
  var container = document.getElementById('ysql-toasts');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ysql-toasts';
    container.style.cssText = 'position:fixed;bottom:60px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none';
    document.body.appendChild(container);
  }
  var t = document.createElement('div');
  var colors = { success:'#50fa7b', error:'#f38ba8', info:'var(--accent)' };
  t.style.cssText = 'background:var(--surface);border:1px solid ' + (colors[type]||colors.info) + ';color:var(--text);padding:8px 14px;border-radius:var(--radius);font-size:.83rem;box-shadow:var(--shadow);pointer-events:auto;max-width:300px';
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(function() { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(function(){t.remove();},300); }, 3000);
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
  if (r.status === 413) throw new Error('Файлът е твърде голям — намали го или го раздели на части.');
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch(e) {
    console.error('[YourSQL] non-JSON response:', r.status, text.slice(0,200));
    throw new Error('Server error ' + r.status);
  }
  if (!r.ok) {
    const msg = data?.detail || data?.error || JSON.stringify(data);
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
