// YourSQL — Table browser

const _ysqlBrT = window.t || (k => k);

YS.browse = (() => {

  function showWelcome(container) {
    const content = container.querySelector('#ysql-content');
    if (!content) return;
    if (!YS.state.activeDb) {
      content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);flex-direction:column;gap:8px"><div style="font-size:2rem">🗄️</div><div>' + _ysqlBrT('ysql_select_db_to_start') + '</div></div>';
      return;
    }
    content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim);flex-direction:column;gap:8px"><div style="font-size:2rem">📋</div><div>' + _ysqlBrT('ysql_select_table_from_sidebar') + '</div></div>';
  }

  async function show(container, savedState) {
    const content = container.querySelector('#ysql-content');
    if (!content || !YS.state.activeConn || !YS.state.activeDb || !YS.state.activeTable) return;

    if (savedState) {
      YS.state.filters = savedState.filters;
      YS.state.sort    = savedState.sort;
      YS.state.page    = savedState.page;
      YS.state.pageSize = savedState.pageSize;
      YS.state.colMeta = savedState.colMeta;
      YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
    } else {
      YS.state.page = 1;
      YS.state.filters = [];
      YS.state.sort = [];
      YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };

      content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim)">' + _ysqlBrT('ysql_loading_dots') + '</div>';
      try {
        const struct = await YS.api('/table-structure?conn_id=' + YS.state.activeConn.id +
          '&database=' + encodeURIComponent(YS.state.activeDb) +
          '&table=' + encodeURIComponent(YS.state.activeTable));
        YS.state.colMeta = YS.parseColMeta(struct.columns || []);
      } catch(e) { YS.state.colMeta = {}; }
    }

    _renderBrowse(container, content);
    await _loadData(container, content);

    if (savedState) {
      var wrap = content.querySelector('#ysql-table-wrap');
      if (wrap) {
        wrap.scrollLeft = savedState.scrollLeft || 0;
        wrap.scrollTop = savedState.scrollTop || 0;
      }
    }
  }

  function _renderBrowse(container, content) {
    content.innerHTML =
      '<div style="display:flex;flex-direction:column;width:100%;overflow:hidden">' +
        '<div id="ysql-browse-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap"></div>' +
        '<div id="ysql-sql-panel" style="display:none;flex-shrink:0;border-bottom:1px solid var(--border)">' +
          '<div id="ysql-sql-bar" contenteditable="true" spellcheck="false" style="width:100%;box-sizing:border-box;padding:6px 10px;font-family:monospace;font-size:.78rem;background:var(--surface);white-space:pre;overflow-x:auto;line-height:1.5;outline:none"></div>' +
          '<div style="padding:4px 10px 6px;background:var(--surface)"><button class="s-btn s-btn-sm" id="ysql-btn-run-sql">' + _ysqlBrT('ysql_run') + '</button></div>' +
        '</div>' +
        '<div id="ysql-filter-bar" style="flex-shrink:0"></div>' +
        '<div style="overflow:auto;flex:1" id="ysql-table-wrap">' +
          '<table id="ysql-table" style="border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap">' +
            '<thead id="ysql-thead"></thead>' +
            '<tbody id="ysql-tbody"></tbody>' +
          '</table>' +
        '</div>' +
        '<div id="ysql-pagination" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--border);font-size:.8rem;color:var(--text-dim);flex-shrink:0"></div>' +
      '</div>';

    _renderToolbar(container, content);
  }

  function _renderToolbar(container, content) {
    var tb = content.querySelector('#ysql-browse-toolbar');
    tb.innerHTML =
      '<button class="s-btn s-btn-sm" id="ysql-btn-filter" style="flex-shrink:0">' + _ysqlBrT('ysql_filter') + '</button>' +
      '<button class="s-btn s-btn-sm" id="ysql-btn-sql" style="flex-shrink:0">' + _ysqlBrT('ysql_sql') + '</button>' +
      '<button class="s-btn s-btn-sm" id="ysql-btn-refresh" style="flex-shrink:0" title="' + _ysqlBrT('ysql_refresh_tt') + '">↻</button>' +
      '<span style="flex:1"></span>' +
      '<span id="ysql-selection-info" style="font-size:.78rem;color:var(--text-dim);flex-shrink:0"></span>' +
      '<button class="s-btn s-btn-sm" id="ysql-btn-bulk" style="display:none;flex-shrink:0">' + _ysqlBrT('ysql_edit_selected') + '</button>';

    var refreshBtn = tb.querySelector('#ysql-btn-refresh');
    var _autoTimer = null;

    function _setAutoRefresh(sec) {
      if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
      if (sec) {
        _autoTimer = setInterval(function() { _loadData(container, content); }, sec * 1000);
        refreshBtn.style.background = 'var(--accent)';
        refreshBtn.style.color = '#fff';
        refreshBtn.style.borderColor = 'var(--accent)';
      } else {
        refreshBtn.style.background = '';
        refreshBtn.style.color = '';
        refreshBtn.style.borderColor = '';
      }
    }

    function _showRefreshMenu(e) {
      e.preventDefault();
      var existing = document.querySelector('#ysql-refresh-menu');
      if (existing) existing.remove();

      var isActive = !!_autoTimer;
      var menu = document.createElement('div');
      menu.id = 'ysql-refresh-menu';
      menu.style.cssText = 'position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,4px);box-shadow:var(--shadow);padding:4px 0;min-width:140px;font-size:.82rem';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      var items = isActive
        ? [{ label: _ysqlBrT('ysql_stop'), sec: 0 }]
        : [{ label: _ysqlBrT('ysql_1_second'), sec: 1 }, { label: _ysqlBrT('ysql_n_seconds', { n: 5 }), sec: 5 }, { label: _ysqlBrT('ysql_n_seconds', { n: 30 }), sec: 30 }, { label: _ysqlBrT('ysql_n_seconds', { n: 60 }), sec: 60 }];

      items.forEach(function(item) {
        var el = document.createElement('div');
        el.textContent = item.label;
        el.style.cssText = 'padding:7px 14px;cursor:pointer;color:var(--text)';
        el.addEventListener('mouseenter', function() { el.style.background = 'var(--hover,rgba(255,255,255,.06))'; });
        el.addEventListener('mouseleave', function() { el.style.background = ''; });
        el.addEventListener('click', function() {
          menu.remove();
          _setAutoRefresh(item.sec);
        });
        menu.appendChild(el);
      });

      document.body.appendChild(menu);
      setTimeout(function() {
        document.addEventListener('click', function rm() {
          menu.remove();
          document.removeEventListener('click', rm);
        });
      }, 0);
    }

    refreshBtn.addEventListener('click', function() { _loadData(container, content); });
    refreshBtn.addEventListener('contextmenu', _showRefreshMenu);
    tb.querySelector('#ysql-btn-filter').addEventListener('click', function() { YS.filters.toggle(container, content); });
    tb.querySelector('#ysql-btn-bulk').addEventListener('click', function() { YS.bulkEdit.open(container, content); });

    tb.querySelector('#ysql-btn-sql').addEventListener('click', function() {
      var panel = content.querySelector('#ysql-sql-panel');
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    content.querySelector('#ysql-btn-run-sql').addEventListener('click', function() {
      _runSqlBar(container, content);
    });
  }

  async function _loadData(container, content) {
    const tbody = content.querySelector('#ysql-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="99" style="padding:20px;text-align:center;color:var(--text-dim)">' + _ysqlBrT('ysql_loading_dots') + '</td></tr>';

    var res;

    if (YS.state._customSqlOverride) {
      // Simple single-table SQL — send to /query but with full colMeta already loaded.
      // Sort and filter are applied server-side by re-running the query wrapped.
      // We build a wrapper query that applies current sort/filters on top.
      var baseSql = YS.state._customSqlOverride;
      // Strip trailing semicolon
      baseSql = baseSql.replace(/;\s*$/, '');
      // Build ORDER BY from YS.state.sort
      var orderParts = (YS.state.sort || []).map(function(s) { return '`' + s.col + '` ' + s.dir; });
      // Build WHERE from YS.state.filters
      var whereParts = (YS.state.filters || []).map(function(f) {
        var col = '`' + f.col + '`';
        if (f.op === 'IS NULL') return col + ' IS NULL';
        if (f.op === 'IS NOT NULL') return col + ' IS NOT NULL';
        return col + ' ' + f.op + ' \'' + String(f.val).replace(/'/g, "\\'") + '\'';
      });
      var wrapped = 'SELECT * FROM (' + baseSql + ') AS _q';
      if (whereParts.length) wrapped += ' WHERE ' + whereParts.join(' AND ');
      if (orderParts.length) wrapped += ' ORDER BY ' + orderParts.join(', ');
      wrapped += ' LIMIT ' + YS.state.pageSize + ' OFFSET ' + ((YS.state.page - 1) * YS.state.pageSize);

      // Also get total count
      var countSql = 'SELECT COUNT(*) AS _total FROM (' + baseSql + ') AS _q';
      if (whereParts.length) countSql += ' WHERE ' + whereParts.join(' AND ');

      var countRes = await YS.api('/query', { method: 'POST', json: {
        conn_id: YS.state.activeConn.id,
        database: YS.state.activeDb || '',
        sql: countSql
      }}).catch(function() { return { rows: [{ _total: 0 }] }; });

      YS.state.totalRows = (countRes.rows && countRes.rows[0]) ? (countRes.rows[0]._total || 0) : 0;

      res = await YS.api('/query', { method: 'POST', json: {
        conn_id: YS.state.activeConn.id,
        database: YS.state.activeDb || '',
        sql: wrapped
      }}).catch(function(e) { return { error: e.message }; });

      if (res.error || res.detail) {
        tbody.innerHTML = '<tr><td colspan="99" style="padding:20px;color:#f38ba8">' + YS.escHtml(res.error || res.detail) + '</td></tr>';
        return;
      }
      _renderTable(content, res.columns || [], res.rows || []);
      _renderPagination(container, content);
      _updateSqlBar(content);
      return;
    }

    const body = {
      conn_id: YS.state.activeConn.id,
      database: YS.state.activeDb,
      table: YS.state.activeTable,
      limit: YS.state.pageSize,
      offset: (YS.state.page - 1) * YS.state.pageSize,
      filters: YS.state.filters,
      sort: YS.state.sort,
    };

    res = await YS.api('/table-data', { method: 'POST', json: body }).catch(function(e) { return { error: e.message }; });

    if (res.error || res.detail) {
      tbody.innerHTML = '<tr><td colspan="99" style="padding:20px;color:#f38ba8">' + YS.escHtml(res.error || res.detail) + '</td></tr>';
      return;
    }

    YS.state.totalRows = res.total;
    _renderTable(content, res.columns, res.rows);
    _renderPagination(container, content);
    _updateSqlBar(content);
  }

  function _renderTable(content, columns, rows) {
    const esc = YS.escHtml;
    const colMeta = YS.state.colMeta;

    // thead
    const thead = content.querySelector('#ysql-thead');
    const sortMap = {};
    YS.state.sort.forEach(function(s) { sortMap[s.col] = s.dir; });

    thead.innerHTML = '';
    const tr = document.createElement('tr');
    tr.style.cssText = 'position:sticky;top:0;background:var(--surface);z-index:1';

    // checkbox col
    const thCk = document.createElement('th');
    thCk.style.cssText = 'padding:6px 8px;border-bottom:2px solid var(--border);width:32px';
    const selAllCk = document.createElement('input');
    selAllCk.type = 'checkbox';
    selAllCk.id = 'ysql-sel-all';
    selAllCk.title = _ysqlBrT('ysql_select');
    thCk.appendChild(selAllCk);
    tr.appendChild(thCk);

    // "+" / duplicate col header
    const thAdd = document.createElement('th');
    thAdd.id = 'ysql-th-add';
    thAdd.style.cssText = 'padding:4px 6px;border-bottom:2px solid var(--border);width:24px';
    const addBtn = document.createElement('button');
    addBtn.id = 'ysql-add-btn';
    addBtn.textContent = '+';
    addBtn.title = _ysqlBrT('ysql_insert_row');
    addBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.95rem;padding:0 2px;line-height:1';
    addBtn.addEventListener('click', function() {
      var sel = YS.state.selection;
      if (sel.mode !== 'none' && sel.pageRows.length) {
        _duplicateRows(content, sel.pageRows, columns, colMeta);
      } else {
        YS.rowInsert.show(content.closest('[id]'), content);
      }
    });
    addBtn.addEventListener('mouseenter', function() { addBtn.style.color = 'var(--accent)'; });
    addBtn.addEventListener('mouseleave', function() { addBtn.style.color = 'var(--text-dim)'; });
    thAdd.appendChild(addBtn);
    tr.appendChild(thAdd);

    columns.forEach(function(c) {
      const th = document.createElement('th');
      th.style.cssText = 'padding:0;border-bottom:2px solid var(--border);text-align:left;white-space:nowrap;user-select:none';
      var sortIdx = YS.state.sort.findIndex(function(s){ return s.col === c; });
      var sortDir = sortIdx >= 0 ? YS.state.sort[sortIdx].dir : null;
      var meta = colMeta[c] || {};
      var pkBadge = meta.key === 'PRI' ? '<span style="font-size:.6rem;color:var(--accent);margin-left:3px;vertical-align:middle">PK</span>' : '';

      // Sort indicator area (right side, click to toggle sort)
      var sortPart = '';
      if (sortDir) {
        var num = YS.state.sort.length > 1 ? '<sup style="font-size:.6rem">' + (sortIdx + 1) + '</sup>' : '';
        sortPart = '<span class="ys-th-sort" style="padding:8px 8px 8px 4px;color:var(--accent);cursor:pointer;display:inline-flex;align-items:center;gap:1px">' +
          (sortDir === 'ASC' ? '▴' : '▾') + num + '</span>';
      } else {
        sortPart = '<span class="ys-th-sort" style="padding:8px 8px 8px 4px;color:var(--border);cursor:pointer;opacity:.4">⇅</span>';
      }

      th.innerHTML =
        '<span class="ys-th-name" style="padding:8px 4px 8px 10px;cursor:pointer;display:inline-block">' +
          esc(c) + pkBadge +
        '</span>' + sortPart;

      // Click on column name → open filter bar for this column
      th.querySelector('.ys-th-name').addEventListener('click', function(e) {
        e.stopPropagation();
        var container = content.closest('[id]');
        var bar = content.querySelector('#ysql-filter-bar');
        if (bar) bar.dataset.open = '1';
        YS.filters.openForColumn(container, content, c, meta);
      });

      // Click on sort indicator → toggle sort
      th.querySelector('.ys-th-sort').addEventListener('click', function(e) {
        e.stopPropagation();
        var cur = sortDir;
        YS.state.sort = YS.state.sort.filter(function(s){ return s.col !== c; });
        if (!cur) YS.state.sort.push({ col: c, dir: 'ASC' });
        else if (cur === 'ASC') YS.state.sort.push({ col: c, dir: 'DESC' });
        // DESC → remove (toggle off)
        YS.state.page = 1;
        if (YS.tabs) YS.tabs.markDirty();
        var container = content.closest('[id]');
        // Re-render filter bar if open
        var bar = content.querySelector('#ysql-filter-bar');
        if (bar && bar.dataset.open === '1') YS.filters.render(container, content);
        _loadData(container, content);
      });

      tr.appendChild(th);
    });
    thead.appendChild(tr);

    // select-all checkbox — show context menu
    selAllCk.addEventListener('click', function(e) {
      e.preventDefault();
      _showSelectMenu(e, selAllCk, rows, content, content.closest('[id]'));
    });

    // tbody
    const tbody = content.querySelector('#ysql-tbody');
    tbody.innerHTML = '';

    if (!rows.length) {
      selAllCk.style.display = 'none';
      addBtn.style.display = 'none';
      tbody.innerHTML = '<tr><td colspan="' + (columns.length + 2) + '" style="padding:20px;text-align:center;color:var(--text-dim)">' + _ysqlBrT('ysql_no_rows') + '</td></tr>';
      return;
    }

    rows.forEach(function(row, rowIdx) {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border)';
      tr.dataset.rowIdx = rowIdx;
      tr.addEventListener('mouseenter', function() { if (!tr.dataset.selected) tr.style.background = 'var(--hover)'; });
      tr.addEventListener('mouseleave', function() { if (!tr.dataset.selected) tr.style.background = ''; });

      // checkbox
      const tdCk = document.createElement('td');
      tdCk.style.cssText = 'padding:4px 8px;';
      const ck = document.createElement('input');
      ck.type = 'checkbox';
      ck.dataset.rowIdx = rowIdx;
      ck.addEventListener('change', function() {
        var sel = YS.state.selection;
        if (ck.checked) {
          sel.indexSet.add(rowIdx);
          if (!sel.pageRows.find(function(r){return r===row;})) sel.pageRows.push(row);
        } else {
          sel.indexSet.delete(rowIdx);
          sel.pageRows = sel.pageRows.filter(function(r){return r!==row;});
        }
        sel.mode = sel.indexSet.size ? 'page' : 'none';
        tr.dataset.selected = ck.checked ? '1' : '';
        tr.style.background = ck.checked ? 'var(--accent-dim,rgba(99,102,241,.12))' : '';
        _updateSelectionUI(content);
      });
      tdCk.appendChild(ck);
      tr.appendChild(tdCk);

      // edit pencil
      const tdEdit = document.createElement('td');
      tdEdit.style.cssText = 'padding:2px 4px;width:24px';
      const editBtn = document.createElement('button');
      editBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.82rem;padding:1px 3px;transition:color .1s';
      editBtn.textContent = '✎';
      editBtn.title = _ysqlBrT('ysql_edit_row_tt');
      editBtn.addEventListener('click', function() { YS.rowEdit.open(row, columns, colMeta, content); });
      editBtn.addEventListener('mouseenter', function() { editBtn.style.color = 'var(--accent)'; });
      editBtn.addEventListener('mouseleave', function() { editBtn.style.color = 'var(--text-dim)'; });
      tdEdit.appendChild(editBtn);
      tr.appendChild(tdEdit);

      columns.forEach(function(col) {
        const td = document.createElement('td');
        td.style.cssText = 'padding:5px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;cursor:pointer';
        td.dataset.col = col;
        var val = row[col];
        _renderCellValue(td, val, colMeta[col]);
        td.addEventListener('dblclick', function() {
          _editCellInline(td, row, col, colMeta[col], content);
        });
        tr.appendChild(td);
      });


      tbody.appendChild(tr);
    });
  }

  function _renderCellValue(td, val, meta) {
    meta = meta || {};
    if (val === null || val === undefined) {
      td.innerHTML = '<span style="color:var(--text-dim);font-style:italic">NULL</span>';
      td.dataset.origVal = '\x00NULL';
      return;
    }
    var s = String(val);
    td.dataset.origVal = s;
    var base = (meta.baseType || '').toUpperCase();
    if (YS.isNumericType(base)) {
      td.style.color = 'var(--color-num, #8be9fd)';
    } else if (YS.isDateType(base)) {
      td.style.color = 'var(--color-date, #f1fa8c)';
    }
    // Some columns hold text with real embedded newlines (e.g. pasted-in
    // multi-line values) — left as-is a <td> just wraps onto extra visual
    // rows that look like separate table rows. Collapse to one line for
    // display only; title/edit still see the real, unmodified value.
    td.textContent = /[\r\n]/.test(s) ? s.replace(/\r\n|\r|\n/g, ' ↵ ') : s;
    td.title = s;
  }

  function _editCellInline(td, row, col, meta, content) {
    var orig = td.dataset.origVal;
    var isNull = orig === '\x00NULL';
    var input = YS.buildCellInput(meta || {}, isNull ? null : orig, true);
    input.style.cssText = 'width:100%;font-size:.82rem;padding:2px 4px;box-sizing:border-box';
    td.innerHTML = '';
    td.appendChild(input);
    input.focus();

    // snapshot state at open time — prevents stale closure if user navigates away before blur
    var snapConn = YS.state.activeConn;
    var snapDb = YS.state.activeDb;
    var snapTable = YS.state.activeTable;
    var snapColMeta = YS.state.colMeta;

    async function save() {
      var val = YS.getCellInputValue(input, meta || {});
      _renderCellValue(td, val, meta);
      var where = YS.buildWhereFromRow(row, snapColMeta);
      var r = await YS.api('/update-cell', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, where: where, column: col, value: val
      }}).catch(function(){return {};});
      if (!r.ok) { _renderCellValue(td, isNull ? null : orig, meta); YS.toast(_ysqlBrT('ysql_update_failed'), 'error'); }
      else { row[col] = val; if (YS.tabs) YS.tabs.markDirty(); }
    }

    input.addEventListener('blur', save);
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { _renderCellValue(td, isNull ? null : orig, meta); }
    });
  }

  function _showSelectMenu(e, selAllCk, rows, content, container) {
    var existing = document.querySelector('#ysql-select-menu');
    if (existing) { existing.remove(); return; }

    var menu = document.createElement('div');
    menu.id = 'ysql-select-menu';
    menu.style.cssText = 'position:fixed;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,4px);box-shadow:var(--shadow);padding:4px 0;min-width:180px;font-size:.82rem';

    var rect = selAllCk.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 4) + 'px';

    var total = YS.state.totalRows;
    var pageCount = rows.length;

    var items = [
      { label: _ysqlBrT('ysql_select_this_page'), action: function() {
        var idxSet = new Set(); rows.forEach(function(_, i){ idxSet.add(i); });
        YS.state.selection = { mode: 'page', pageRows: rows.slice(), indexSet: idxSet };
        _updateSelectionUI(content);
      }},
      { label: _ysqlBrT('ysql_deselect_all'), action: function() {
        YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
        _updateSelectionUI(content);
      }},
    ];
    if (total > pageCount) {
      items.push({ label: _ysqlBrT('ysql_select_whole_result', { n: total }), action: function() {
        var idxSet = new Set(); rows.forEach(function(_, i){ idxSet.add(i); });
        YS.state.selection = { mode: 'all', pageRows: rows.slice(), indexSet: idxSet };
        _updateSelectionUI(content);
      }});
    }

    items.forEach(function(item) {
      var el = document.createElement('div');
      el.textContent = item.label;
      el.style.cssText = 'padding:7px 14px;cursor:pointer;color:var(--text)';
      el.addEventListener('mouseenter', function() { el.style.background = 'var(--hover,rgba(255,255,255,.06))'; });
      el.addEventListener('mouseleave', function() { el.style.background = ''; });
      el.addEventListener('click', function() { menu.remove(); item.action(); });
      menu.appendChild(el);
    });

    document.body.appendChild(menu);
    setTimeout(function() {
      document.addEventListener('click', function rm() {
        menu.remove();
        document.removeEventListener('click', rm);
      });
    }, 0);
  }

  function _updateSelectionUI(content) {
    const tb = content.querySelector('#ysql-browse-toolbar');
    if (!tb) return;
    const sel = YS.state.selection;
    const info = tb.querySelector('#ysql-selection-info');
    const bulkBtn = tb.querySelector('#ysql-btn-bulk');
    const selAll = content.querySelector('#ysql-sel-all');

    var addBtn = content.querySelector('#ysql-add-btn');
    if (sel.mode === 'none') {
      info.textContent = '';
      bulkBtn.style.display = 'none';
      if (selAll) selAll.checked = false;
      if (selAll) selAll.indeterminate = false;
      if (addBtn) { addBtn.textContent = '+'; addBtn.title = _ysqlBrT('ysql_insert_row'); }
    } else if (sel.mode === 'page') {
      info.textContent = _ysqlBrT('ysql_n_selected', { n: sel.pageRows.length });
      bulkBtn.style.display = '';
      if (selAll) selAll.indeterminate = true;
      if (selAll) selAll.checked = false;
      if (addBtn) { addBtn.textContent = '⧉'; addBtn.title = _ysqlBrT('ysql_duplicate_selected_rows'); }
    } else {
      info.textContent = _ysqlBrT('ysql_all_n_rows_selected', { n: YS.state.totalRows });
      bulkBtn.style.display = '';
      if (selAll) selAll.checked = true;
      if (selAll) selAll.indeterminate = false;
      if (addBtn) { addBtn.textContent = '⧉'; addBtn.title = _ysqlBrT('ysql_duplicate_selected_rows'); }
    }

    // sync row checkboxes and highlight
    content.querySelectorAll('#ysql-tbody tr').forEach(function(tr) {
      var ck = tr.querySelector('input[type=checkbox]');
      if (!ck) return;
      var idx = parseInt(tr.dataset.rowIdx);
      var isSelected = sel.mode === 'all' || (sel.mode === 'page' && sel.indexSet && sel.indexSet.has(idx));
      ck.checked = isSelected;
      tr.dataset.selected = isSelected ? '1' : '';
      tr.style.background = isSelected ? 'var(--accent-dim,rgba(99,102,241,.12))' : '';
    });
  }

  function _renderPagination(container, content) {
    const pag = content.querySelector('#ysql-pagination');
    if (!pag) return;
    var total = YS.state.totalRows, page = YS.state.page, ps = YS.state.pageSize;
    var from = (page-1)*ps+1, to = Math.min(page*ps, total);
    var pages = Math.ceil(total / ps);

    pag.innerHTML =
      '<button class="s-btn s-btn-sm" id="ysql-prev"' + (page<=1?' disabled':'') + '>‹</button>' +
      '<span>' + _ysqlBrT('ysql_page') + ' <input id="ysql-page-inp" type="number" min="1" max="' + pages + '" value="' + page + '" style="width:46px;text-align:center" class="s-input"> ' + _ysqlBrT('ysql_of') + ' ' + pages + '</span>' +
      '<button class="s-btn s-btn-sm" id="ysql-next"' + (to>=total?' disabled':'') + '>›</button>' +
      '<span style="flex:1"></span>' +
      '<span>' + (total ? from+'–'+to+' '+_ysqlBrT('ysql_of')+' '+total : _ysqlBrT('ysql_no_rows')) + '</span>' +
      (YS.state.selection.mode !== 'none' && pages > 1 ?
        '<button class="s-btn s-btn-sm" id="ysql-sel-all-pages">' + _ysqlBrT('ysql_select_all_n_rows', { n: total }) + '</button>' : '');

    pag.querySelector('#ysql-prev').addEventListener('click', function() {
      YS.state.page--; _loadData(container, content);
    });
    pag.querySelector('#ysql-next').addEventListener('click', function() {
      YS.state.page++; _loadData(container, content);
    });
    var pageInp = pag.querySelector('#ysql-page-inp');
    pageInp.addEventListener('change', function() {
      var p = Math.max(1, Math.min(pages, parseInt(this.value)||1));
      YS.state.page = p; _loadData(container, content);
    });
    var selAllPages = pag.querySelector('#ysql-sel-all-pages');
    if (selAllPages) {
      selAllPages.addEventListener('click', function() {
        YS.state.selection.mode = 'all';
        _updateSelectionUI(content);
      });
    }
  }

  async function _runSqlBar(container, content) {
    var bar = content.querySelector('#ysql-sql-bar');
    if (!bar) return;
    var sql = bar.innerText.trim();
    if (!sql || !YS.state.activeConn) return;
    var r = await YS.api('/query', { method: 'POST', json: {
      conn_id: YS.state.activeConn.id,
      database: YS.state.activeDb || '',
      sql: sql
    }}).catch(function(e) { return { error: e.message }; });
    if (r.error || r.detail) { YS.toast(r.error || r.detail, 'error'); return; }
    if (r.affected !== null && r.affected !== undefined) {
      YS.toast(_ysqlBrT('ysql_ok_n_rows_affected', { n: r.affected }), 'success');
      _loadData(container, content);
      return;
    }
    if (r.columns) {
      _renderTable(content, r.columns, r.rows || []);
      YS.state.totalRows = (r.rows || []).length;
      _renderPagination(container, content);
    }
  }

  function _updateSqlBar(content) {
    var el = content.querySelector('#ysql-sql-bar');
    if (!el) return;
    if (document.activeElement === el) return;
    var parts = [];
    parts.push({ t: 'kw', v: 'SELECT' });
    parts.push({ t: 'plain', v: ' * ' });
    parts.push({ t: 'kw', v: 'FROM' });
    parts.push({ t: 'plain', v: ' ' });
    parts.push({ t: 'tbl', v: '`' + YS.state.activeTable + '`' });
    if (YS.state.filters && YS.state.filters.length) {
      parts.push({ t: 'plain', v: ' ' });
      parts.push({ t: 'kw', v: 'WHERE' });
      parts.push({ t: 'plain', v: ' ' });
      YS.state.filters.forEach(function(f, i) {
        if (i) parts.push({ t: 'kw', v: ' AND ' });
        parts.push({ t: 'col', v: '`' + f.col + '`' });
        parts.push({ t: 'op', v: ' ' + f.op });
        if (f.op !== 'IS NULL' && f.op !== 'IS NOT NULL') {
          parts.push({ t: 'plain', v: ' ' });
          parts.push({ t: 'str', v: "'" + String(f.val).replace(/'/g, "\\'") + "'" });
        }
      });
    }
    if (YS.state.sort && YS.state.sort.length) {
      parts.push({ t: 'plain', v: ' ' });
      parts.push({ t: 'kw', v: 'ORDER BY' });
      parts.push({ t: 'plain', v: ' ' });
      YS.state.sort.forEach(function(s, i) {
        if (i) parts.push({ t: 'plain', v: ', ' });
        parts.push({ t: 'col', v: '`' + s.col + '`' });
        parts.push({ t: 'kw', v: ' ' + s.dir });
      });
    }
    parts.push({ t: 'plain', v: ' ' });
    parts.push({ t: 'kw', v: 'LIMIT' });
    parts.push({ t: 'num', v: ' ' + YS.state.pageSize });
    parts.push({ t: 'plain', v: ' ' });
    parts.push({ t: 'kw', v: 'OFFSET' });
    parts.push({ t: 'num', v: ' ' + ((YS.state.page - 1) * YS.state.pageSize) });

    var colors = {
      kw:    'color:#bd93f9',
      tbl:   'color:#50fa7b',
      col:   'color:#8be9fd',
      str:   'color:#f1fa8c',
      num:   'color:#ffb86c',
      op:    'color:#ff79c6',
      plain: 'color:var(--text-dim)',
    };
    el.innerHTML = parts.map(function(p) {
      return '<span style="' + colors[p.t] + '">' + YS.escHtml(p.v) + '</span>';
    }).join('');
  }

  function _exportTable(format) {
    var url = '/api/apps/yoursql/export?conn_id=' + YS.state.activeConn.id +
      '&database=' + encodeURIComponent(YS.state.activeDb) +
      '&table=' + encodeURIComponent(YS.state.activeTable) +
      '&format=' + format;
    var a = document.createElement('a');
    a.href = url; a.download = YS.state.activeTable + '.' + format;
    a.click();
  }

  async function _importFile(e, container, content) {
    var file = e.target.files[0];
    if (!file) return;
    var fd = new FormData();
    fd.append('conn_id', YS.state.activeConn.id);
    fd.append('database', YS.state.activeDb);
    fd.append('file', file);
    var r = await YS.api('/import', { method: 'POST', form: fd }).catch(function(e){return{error:e.message};});
    if (r.ok) {
      YS.toast(_ysqlBrT('ysql_imported_n_rows', { n: r.affected, errors: (r.errors && r.errors.length ? _ysqlBrT('ysql_n_errors', { n: r.errors.length }) : '') }), 'success');
      _loadData(container, content);
    } else {
      YS.toast(_ysqlBrT('ysql_import_failed_detail', { msg: r.detail || r.error }), 'error');
    }
    e.target.value = '';
  }

  function _duplicateRows(content, sourceRows, columns, colMeta) {
    var tbody = content.querySelector('#ysql-tbody');
    if (!tbody) return;

    // remove any existing duplicate editor
    var existing = tbody.parentElement.querySelector('.ysql-dup-section');
    if (existing) existing.remove();

    var section = document.createElement('tbody');
    section.className = 'ysql-dup-section';

    var pendingRows = sourceRows.map(function(src) {
      var vals = {};
      columns.forEach(function(col) {
        var meta = colMeta[col] || {};
        if (meta.key === 'PRI' && meta.autoIncrement) vals[col] = null;
        else vals[col] = src[col] !== undefined ? src[col] : null;
      });
      return vals;
    });

    function _renderDupRows() {
      section.innerHTML = '';

      // separator row
      var sepTr = document.createElement('tr');
      sepTr.innerHTML = '<td colspan="99" style="padding:3px 10px;background:var(--accent-dim,rgba(99,102,241,.12));font-size:.72rem;color:var(--accent);font-weight:600;letter-spacing:.05em">' + _ysqlBrT('ysql_new_rows_duplicate') + '</td>';
      section.appendChild(sepTr);

      pendingRows.forEach(function(vals, ri) {
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--border);background:var(--surface)';

        // × remove this row
        var tdX = document.createElement('td');
        tdX.style.cssText = 'padding:3px 6px;width:24px';
        var xBtn = document.createElement('button');
        xBtn.textContent = '×';
        xBtn.style.cssText = 'background:none;border:none;cursor:pointer;color:#f38ba8;font-size:1rem;padding:0 2px';
        xBtn.addEventListener('click', function() {
          pendingRows.splice(ri, 1);
          if (!pendingRows.length) { section.remove(); return; }
          _renderDupRows();
        });
        tdX.appendChild(xBtn);
        tr.appendChild(tdX);

        // lock icon (placeholder for pencil col alignment)
        var tdLock = document.createElement('td');
        tdLock.style.cssText = 'padding:3px 6px;width:24px;color:var(--accent);font-size:.8rem';
        tdLock.textContent = '🔒';
        tr.appendChild(tdLock);

        columns.forEach(function(col) {
          var meta = colMeta[col] || {};
          var isAI = meta.key === 'PRI' && meta.autoIncrement;
          var td = document.createElement('td');
          td.style.cssText = 'padding:2px 4px;max-width:200px';

          if (isAI) {
            td.style.cssText += ';color:var(--text-dim);font-size:.78rem;font-style:italic;padding:5px 10px';
            td.textContent = _ysqlBrT('ysql_auto');
          } else {
            var inp = YS.buildCellInput(meta, vals[col], false);
            inp.style.cssText += ';width:100%;min-width:80px;box-sizing:border-box;font-size:.8rem';
            inp.addEventListener('input', function() {
              vals[col] = YS.getCellInputValue(inp, meta);
            });
            inp.addEventListener('change', function() {
              vals[col] = YS.getCellInputValue(inp, meta);
            });
            td.appendChild(inp);
          }
          tr.appendChild(td);
        });

        section.appendChild(tr);
      });

      // footer row: Cancel all / Save all
      var footTr = document.createElement('tr');
      footTr.style.cssText = 'background:var(--surface2,var(--surface))';
      var footTd = document.createElement('td');
      footTd.colSpan = 999;
      footTd.style.cssText = 'padding:6px 10px;text-align:left;border-top:1px solid var(--border)';

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 's-btn s-btn-sm';
      cancelBtn.textContent = _ysqlBrT('ysql_cancel_all');
      cancelBtn.style.cssText = 'margin-right:8px';
      cancelBtn.addEventListener('click', function() {
        section.remove();
        YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
        _updateSelectionUI(content);
      });

      var saveBtn = document.createElement('button');
      saveBtn.className = 's-btn s-btn-sm';
      saveBtn.textContent = _ysqlBrT('ysql_save_all');
      saveBtn.style.cssText = 'background:var(--accent);color:#fff;border-color:var(--accent)';
      saveBtn.addEventListener('click', async function() {
        saveBtn.disabled = true; saveBtn.textContent = _ysqlBrT('ysql_saving');
        var errors = 0;
        for (var i = 0; i < pendingRows.length; i++) {
          var values = {};
          columns.forEach(function(col) {
            var meta = colMeta[col] || {};
            if (meta.key === 'PRI' && meta.autoIncrement) return;
            var v = pendingRows[i][col];
            values[col] = (v === '' && meta.allowNull) ? null : v;
          });
          var r = await YS.api('/insert-row', { method: 'POST', json: {
            conn_id: YS.state.activeConn.id, database: YS.state.activeDb,
            table: YS.state.activeTable, values: values
          }}).catch(function(){ return {}; });
          if (!r.ok) errors++;
        }
        if (errors) YS.toast(_ysqlBrT('ysql_n_rows_failed_insert', { n: errors }), 'error');
        else YS.toast(_ysqlBrT('ysql_inserted_n_rows', { n: pendingRows.length }), 'success');
        if (YS.tabs) YS.tabs.markDirty();
        section.remove();
        YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
        _updateSelectionUI(content);
        _loadData(content.closest('[id]'), content);
      });

      footTd.appendChild(cancelBtn);
      footTd.appendChild(saveBtn);
      footTr.appendChild(footTd);
      section.appendChild(footTr);
    }

    _renderDupRows();
    tbody.parentElement.insertBefore(section, tbody);

    // scroll to new rows
    setTimeout(function() {
      var first = section.querySelector('input,select');
      if (first) first.focus();
    }, 50);
  }

  // Called from SQL editor tab — renders full browse for simple single-table SQL.
  // Returns false if the SQL is complex (JOIN etc.) — caller handles that case.
  async function showWithSql(container, sql, contentEl) {
    const content = contentEl || container.querySelector('#ysql-content');
    if (!content || !YS.state.activeConn) return false;

    // Detect single table (no JOIN)
    var tableMatch = sql.match(/\bFROM\s+`?(\w+)`?(?:\s|$|;)/i);
    var detectedTable = tableMatch ? tableMatch[1] : null;
    var isSimple = detectedTable && !/\bJOIN\b/i.test(sql);

    if (!isSimple || !YS.state.activeDb) return false;

    YS.state._customSql = null;
    YS.state._customSqlOverride = sql;
    YS.state.activeTable = detectedTable;
    YS.state.page = 1;
    YS.state.filters = [];
    YS.state.sort = [];
    YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };

    try {
      var struct = await YS.api('/table-structure?conn_id=' + YS.state.activeConn.id +
        '&database=' + encodeURIComponent(YS.state.activeDb) +
        '&table=' + encodeURIComponent(detectedTable));
      YS.state.colMeta = YS.parseColMeta(struct.columns || []);
    } catch(e) { YS.state.colMeta = {}; }

    _renderBrowse(container, content);
    await _loadData(container, content);
    return true;
  }

  // Public reload — called from row-edit, filters etc.
  function _reload(container, content) {
    if (!content) {
      // find content from active window
      var win = document.querySelector('.window.focused #ysql-content');
      if (win) content = win;
      else return;
    }
    if (!container) container = content.closest('[style*="position:relative"]') || content.parentElement;
    _loadData(container, content);
  }

  return { show, showWelcome, showWithSql, _reload };
})();
