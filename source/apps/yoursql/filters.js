// YourSQL — Filter & Sort bar

YS.filters = (() => {

  const OPS_STR  = ['=','!=','LIKE','NOT LIKE','LIKE %%','REGEXP','IS NULL','IS NOT NULL'];
  const OPS_NUM  = ['=','!=','<','>','<=','>=','IS NULL','IS NOT NULL'];
  const OPS_DATE = ['=','!=','<','>','<=','>=','IS NULL','IS NOT NULL'];
  const OPS_NO_VAL = new Set(['IS NULL','IS NOT NULL']);

  function _opsForCol(col) {
    var meta = (YS.state.colMeta || {})[col] || {};
    var base = (meta.baseType || '').toUpperCase();
    if (YS.isNumericType(base)) return OPS_NUM;
    if (YS.isDateType(base)) return OPS_DATE;
    return OPS_STR;
  }

  function _inputTypeForCol(col) {
    var meta = (YS.state.colMeta || {})[col] || {};
    var base = (meta.baseType || '').toUpperCase();
    if (YS.isNumericType(base)) return 'number';
    if (base === 'DATE') return 'date';
    if (base === 'DATETIME' || base === 'TIMESTAMP') return 'datetime-local';
    return 'text';
  }

  // Called from browse.js header click — opens filter bar pre-filled for that column
  function openForColumn(container, content, col, meta) {
    var bar = content.querySelector('#ysql-filter-bar');
    if (!bar) return;

    // Save any already-typed values before touching state
    var filterRows = bar.querySelector('#ysql-filter-rows');
    if (filterRows) _readFiltersFromDOM(filterRows);
    var sortRows = bar.querySelector('#ysql-sort-rows');
    if (sortRows) _readSortFromDOM(sortRows);

    // If there's already a filter for this col, just show bar
    var existing = YS.state.filters.find(function(f){ return f.col === col; });
    if (!existing) {
      var base = ((meta || {}).baseType || '').toUpperCase();
      var defaultOp = YS.isTextType(base) ? 'LIKE %%' : '=';
      YS.state.filters.push({ col: col, op: defaultOp, val: '' });
    }
    bar.dataset.open = '1';
    render(container, content);

    // Focus the value input for this col
    setTimeout(function() {
      var rows = bar.querySelectorAll('[data-filter-idx]');
      rows.forEach(function(row) {
        if (row.querySelector('select').value === col) {
          var inp = row.querySelector('input');
          if (inp && !inp.disabled) inp.focus();
        }
      });
    }, 50);
  }

  function toggle(container, content) {
    var bar = content.querySelector('#ysql-filter-bar');
    if (!bar) return;
    if (bar.dataset.open === '1') {
      bar.dataset.open = '';
      bar.innerHTML = '';
    } else {
      bar.dataset.open = '1';
      render(container, content);
    }
  }

  function render(container, content) {
    var bar = content.querySelector('#ysql-filter-bar');
    if (!bar) return;
    var columns = Object.keys(YS.state.colMeta || {});
    if (!columns.length) {
      content.querySelectorAll('#ysql-thead th[data-col]').forEach(function(th){ columns.push(th.dataset.col); });
    }

    bar.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:6px 8px;border-bottom:1px solid var(--border);background:var(--surface2,var(--surface));display:flex;flex-direction:column;gap:4px';

    // ── Filter rows ──────────────────────────────────────────────────────
    var filterRows = document.createElement('div');
    filterRows.id = 'ysql-filter-rows';
    wrap.appendChild(filterRows);
    _renderFilterRows(filterRows, columns, container, content);

    // ── Sort row ─────────────────────────────────────────────────────────
    var sortWrap = document.createElement('div');
    sortWrap.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:2px';

    var sortLabel = document.createElement('span');
    sortLabel.style.cssText = 'font-size:.75rem;color:var(--text-dim);min-width:34px;flex-shrink:0';
    sortLabel.textContent = 'SORT';
    sortWrap.appendChild(sortLabel);

    var sortTags = document.createElement('div');
    sortTags.id = 'ysql-sort-rows';
    sortTags.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;flex:1';
    sortWrap.appendChild(sortTags);

    var addSortBtn = document.createElement('button');
    addSortBtn.className = 's-btn s-btn-sm';
    addSortBtn.textContent = '+ add sort';
    addSortBtn.style.cssText = 'font-size:.75rem';
    addSortBtn.addEventListener('click', function() {
      _readFiltersFromDOM(filterRows);
      _readSortFromDOM(sortTags);
      var existing = YS.state.sort.map(function(s){ return s.col; });
      var next = columns.find(function(c){ return !existing.includes(c); }) || columns[0];
      if (next) { YS.state.sort.push({ col: next, dir: 'ASC' }); }
      _renderSortRows(sortTags, columns, container, content);
    });
    sortWrap.appendChild(addSortBtn);
    wrap.appendChild(sortWrap);
    _renderSortRows(sortTags, columns, container, content);

    // ── Action buttons ────────────────────────────────────────────────────
    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:2px;align-items:center';

    var addFilterBtn = document.createElement('button');
    addFilterBtn.className = 's-btn s-btn-sm';
    addFilterBtn.textContent = '+ Filter';
    addFilterBtn.addEventListener('click', function() {
      _readFiltersFromDOM(filterRows);
      _readSortFromDOM(sortTags);
      YS.state.filters.push({ col: columns[0] || '', op: '=', val: '' });
      _renderFilterRows(filterRows, columns, container, content);
    });

    var limitLabel = document.createElement('span');
    limitLabel.style.cssText = 'font-size:.75rem;color:var(--text-dim);margin-left:8px';
    limitLabel.textContent = 'LIMIT';
    var limitInp = document.createElement('input');
    limitInp.type = 'number'; limitInp.className = 's-input';
    limitInp.style.cssText = 'width:64px;font-size:.8rem;padding:2px 6px';
    limitInp.value = YS.state.pageSize || 50;
    limitInp.min = 1; limitInp.max = 10000;

    var spacer = document.createElement('span'); spacer.style.flex = '1';

    var resetBtn = document.createElement('button');
    resetBtn.className = 's-btn s-btn-sm';
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = '';
    resetBtn.addEventListener('click', function() {
      YS.state.filters = []; YS.state.sort = []; YS.state.page = 1;
      bar.dataset.open = ''; bar.innerHTML = '';
      _reload(container, content);
    });

    var searchBtn = document.createElement('button');
    searchBtn.className = 's-btn s-btn-sm';
    searchBtn.textContent = 'Search';
    searchBtn.style.cssText = 'background:var(--accent);color:#fff;border-color:var(--accent)';
    searchBtn.addEventListener('click', function() {
      _readFiltersFromDOM(filterRows);
      _readSortFromDOM(sortTags);
      var newLimit = parseInt(limitInp.value) || 50;
      YS.state.pageSize = newLimit;
      YS.state.page = 1;
      if (YS.tabs && YS.state.filters.length) YS.tabs.markDirty();
      _reload(container, content);
    });

    // Enter on any filter input → search
    wrap.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') searchBtn.click();
    });

    btns.append(addFilterBtn, limitLabel, limitInp, spacer, resetBtn, searchBtn);
    wrap.appendChild(btns);
    bar.appendChild(wrap);
  }

  function _renderFilterRows(container, columns, outerContainer, content) {
    container.innerHTML = '';
    if (!YS.state.filters.length) {
      container.innerHTML = '<div style="font-size:.78rem;color:var(--text-dim);padding:2px 0">No filters — click "+ Filter" or a column header to add one</div>';
      return;
    }
    YS.state.filters.forEach(function(f, idx) {
      var row = document.createElement('div');
      row.dataset.filterIdx = idx;
      row.style.cssText = 'display:flex;align-items:center;gap:4px;flex-wrap:nowrap';

      // Column select
      var colSel = document.createElement('select');
      colSel.className = 's-input';
      colSel.style.cssText = 'width:130px;font-size:.8rem';
      columns.forEach(function(c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        if (c === f.col) o.selected = true;
        colSel.appendChild(o);
      });

      // Op select — depends on col type
      var opSel = document.createElement('select');
      opSel.className = 's-input';
      opSel.style.cssText = 'width:120px;font-size:.8rem';
      function _fillOps(col, currentOp) {
        opSel.innerHTML = '';
        _opsForCol(col).forEach(function(op) {
          var o = document.createElement('option'); o.value = op; o.textContent = op;
          if (op === currentOp) o.selected = true;
          opSel.appendChild(o);
        });
      }
      _fillOps(f.col, f.op);

      // Value input — type depends on col
      var valInp = document.createElement('input');
      valInp.className = 's-input';
      valInp.style.cssText = 'flex:1;min-width:80px;font-size:.8rem';
      valInp.type = _inputTypeForCol(f.col);
      valInp.value = f.val || '';
      valInp.placeholder = 'value';
      if (OPS_NO_VAL.has(f.op)) { valInp.style.display = 'none'; valInp.disabled = true; }

      colSel.addEventListener('change', function() {
        var newCol = colSel.value;
        _fillOps(newCol, opSel.value);
        valInp.type = _inputTypeForCol(newCol);
      });
      opSel.addEventListener('change', function() {
        var noVal = OPS_NO_VAL.has(opSel.value);
        valInp.style.display = noVal ? 'none' : '';
        valInp.disabled = noVal;
      });

      var rmBtn = document.createElement('button');
      rmBtn.className = 's-btn s-btn-sm';
      rmBtn.innerHTML = '&times;';
      rmBtn.style.cssText = 'color:#f38ba8;padding:2px 7px;flex-shrink:0';
      rmBtn.addEventListener('click', function() {
        _readFiltersFromDOM(container);
        YS.state.filters.splice(idx, 1);
        _renderFilterRows(container, columns, outerContainer, content);
      });

      row.append(colSel, opSel, valInp, rmBtn);
      container.appendChild(row);
    });
  }

  function _renderSortRows(container, columns, outerContainer, content) {
    container.innerHTML = '';
    YS.state.sort.forEach(function(s, idx) {
      var tag = document.createElement('div');
      tag.dataset.sortIdx = idx;
      tag.style.cssText = 'display:flex;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;font-size:.78rem';

      // Index badge
      var badge = document.createElement('span');
      badge.style.cssText = 'padding:3px 5px;background:var(--border);color:var(--text-dim);font-size:.7rem;flex-shrink:0';
      badge.textContent = idx + 1;

      // Column select
      var colSel = document.createElement('select');
      colSel.style.cssText = 'border:none;background:transparent;color:var(--text);font-size:.78rem;padding:3px 4px;cursor:pointer;outline:none;max-width:110px';
      columns.forEach(function(c) {
        var o = document.createElement('option'); o.value = c; o.textContent = c;
        if (c === s.col) o.selected = true;
        colSel.appendChild(o);
      });
      colSel.addEventListener('change', function() { s.col = colSel.value; });

      // Dir button
      var dirBtn = document.createElement('button');
      dirBtn.className = 's-btn s-btn-sm';
      dirBtn.style.cssText = 'border:none;border-left:1px solid var(--border);border-radius:0;padding:3px 7px;font-size:.75rem;background:transparent';
      dirBtn.textContent = s.dir === 'ASC' ? '▴ ASC' : '▾ DESC';
      dirBtn.addEventListener('click', function() {
        s.dir = s.dir === 'ASC' ? 'DESC' : 'ASC';
        dirBtn.textContent = s.dir === 'ASC' ? '▴ ASC' : '▾ DESC';
      });

      // Remove
      var rmBtn = document.createElement('button');
      rmBtn.className = 's-btn s-btn-sm';
      rmBtn.innerHTML = '&times;';
      rmBtn.style.cssText = 'border:none;border-left:1px solid var(--border);border-radius:0;padding:3px 6px;color:#f38ba8;background:transparent;font-size:.8rem';
      rmBtn.addEventListener('click', function() {
        YS.state.sort.splice(idx, 1);
        _renderSortRows(container, columns, outerContainer, content);
      });

      tag.append(badge, colSel, dirBtn, rmBtn);
      container.appendChild(tag);
    });
  }

  function _readFiltersFromDOM(container) {
    var rows = container.querySelectorAll('[data-filter-idx]');
    YS.state.filters = [];
    rows.forEach(function(row) {
      var col = row.querySelector('select').value;
      var op = row.querySelectorAll('select')[1] ? row.querySelectorAll('select')[1].value : '=';
      var inp = row.querySelector('input');
      var val = (inp && !inp.disabled) ? inp.value : '';
      YS.state.filters.push({ col, op, val });
    });
  }

  function _readSortFromDOM(container) {
    var tags = container.querySelectorAll('[data-sort-idx]');
    YS.state.sort = [];
    tags.forEach(function(tag) {
      var col = tag.querySelector('select').value;
      var dir = tag.querySelector('button').textContent.includes('ASC') ? 'ASC' : 'DESC';
      YS.state.sort.push({ col, dir });
    });
  }

  function _reload(container, content) {
    var c2 = content ? (content.closest('[style*="overflow:hidden"]') || content.parentElement) : null;
    YS.browse._reload(c2, content);
  }

  return { toggle, render, openForColumn };
})();
