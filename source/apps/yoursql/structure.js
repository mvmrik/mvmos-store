// YourSQL — Table structure view with edit support

YS.structure = (() => {

  var TYPE_GROUPS, ALL_TYPES, NEEDS_LENGTH, NEEDS_DECIMALS, NEEDS_ENUM, CAN_UNSIGNED, NO_DEFAULT, HAS_COLLATION, AUTO_INC_TYPES, META;

  function _applyMeta(family) {
    META = YS.dbtype.meta(family);
    TYPE_GROUPS = META.typeGroups;
    ALL_TYPES = Object.values(TYPE_GROUPS).flat();
    NEEDS_LENGTH = new Set(META.needsLength);
    NEEDS_DECIMALS = new Set(META.needsDecimals);
    NEEDS_ENUM = new Set(META.needsEnum);
    CAN_UNSIGNED = new Set(META.canUnsigned);
    NO_DEFAULT = new Set(META.noDefault);
    HAS_COLLATION = new Set(META.hasCollation);
    AUTO_INC_TYPES = new Set(META.autoIncrementTypes);
  }

  var _collations = null;
  async function _getCollations(cfg) {
    if (_collations) return _collations;
    try {
      var rows = await YS.api('/table-structure?conn_id=' + cfg.id + '&database=information_schema&table=COLLATIONS');
      // fallback: query directly
    } catch(e) {}
    // Use a hardcoded common list as fallback — full list comes from SHOW COLLATION
    _collations = ['utf8mb4_general_ci','utf8mb4_unicode_ci','utf8mb4_0900_ai_ci',
                   'utf8_general_ci','utf8_unicode_ci','latin1_swedish_ci',
                   'latin1_general_ci','ascii_general_ci'];
    try {
      var res = await YS.api('/query', {method:'POST', json:{
        conn_id: YS.state.activeConn.id, database: 'information_schema',
        sql: 'SHOW COLLATION ORDER BY Charset, Collation'
      }});
      if (res && res.rows) _collations = res.rows.map(function(r){ return r.Collation||r.collation; });
    } catch(e) {}
    return _collations;
  }

  // Parse type string like "int(11) unsigned" or "varchar(255)" into parts
  function _parseType(typeStr) {
    if (!typeStr) return { base:'VARCHAR', length:'', decimals:'', enumValues:'', unsigned:false };
    var s = typeStr.trim();
    var unsigned = /unsigned/i.test(s);
    s = s.replace(/unsigned/i,'').trim();
    var base = s.replace(/\(.*$/,'').trim().toUpperCase();
    var m = s.match(/\(([^)]*)\)/);
    var inner = m ? m[1] : '';
    var length = '', decimals = '', enumValues = '';
    if (NEEDS_ENUM.has(base)) {
      enumValues = inner;
    } else if (NEEDS_DECIMALS.has(base) && inner.includes(',')) {
      var parts = inner.split(',');
      length = parts[0].trim();
      decimals = parts[1].trim();
    } else {
      length = inner;
    }
    return { base, length, decimals, enumValues, unsigned };
  }

  // Parse column row from SHOW FULL COLUMNS
  function _parseCol(row) {
    var t = _parseType(row.Type || row.type || '');
    var nullable = (row.Null||row.null||'') === 'YES';
    var defRaw = row.Default != null ? row.Default : (row.default != null ? row.default : null);
    var defaultType = 'NONE', defaultValue = '';
    if (t.base === 'TIMESTAMP' || t.base === 'DATETIME') {
      if (defRaw === 'CURRENT_TIMESTAMP' || defRaw === 'current_timestamp()') {
        defaultType = 'CURRENT_TIMESTAMP';
      } else if (defRaw === null && !nullable) {
        defaultType = 'NONE';
      } else if (defRaw === null) {
        defaultType = 'NULL';
      } else {
        defaultType = 'VALUE'; defaultValue = defRaw;
      }
    } else if (defRaw === null) {
      defaultType = nullable ? 'NULL' : 'NONE';
    } else if (defRaw === '') {
      defaultType = 'EMPTY';
    } else {
      defaultType = 'VALUE'; defaultValue = defRaw;
    }
    return {
      originalName: row.Field || row.field || '',
      name: row.Field || row.field || '',
      baseType: t.base,
      length: t.length,
      decimals: t.decimals,
      enumValues: t.enumValues,
      unsigned: t.unsigned,
      allowNull: nullable,
      defaultType,
      defaultValue,
      autoIncrement: /auto_increment/i.test(row.Extra || row.extra || ''),
      isPK: (row.Key || row.key || '') === 'PRI',
      collation: row.Collation || row.collation || '',
      comment: row.Comment || row.comment || '',
    };
  }

  var _state = {};

  async function show(container, content) {
    content.innerHTML = '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-dim)">Loading structure…</div>';
    var esc = YS.escHtml;

    _applyMeta(YS.dbtype.familyForConn(YS.state.activeConn));

    var data = await YS.api('/table-structure?conn_id=' + YS.state.activeConn.id +
      '&database=' + encodeURIComponent(YS.state.activeDb) +
      '&table=' + encodeURIComponent(YS.state.activeTable)).catch(function(){ return {}; });

    var rawCols = data.columns || [];
    var indexes = data.indexes || [];
    var foreignKeys = data.foreign_keys || [];

    _state = { cols: rawCols.map(_parseCol), editMode: false };

    _render(container, content, indexes, foreignKeys);
  }

  function _render(container, content, indexes, foreignKeys) {
    var esc = YS.escHtml;
    content.innerHTML =
      '<div style="display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<span style="font-size:.82rem;font-weight:500">⚙ Structure — ' + esc(YS.state.activeTable) + '</span>' +
          '<span style="flex:1"></span>' +
          '<button class="s-btn s-btn-sm" id="ys-struct-edit" style="background:var(--accent);color:#fff;border-color:var(--accent)">✎ Edit</button>' +
          '<button class="s-btn s-btn-sm" id="ys-struct-back">← Back to Data</button>' +
        '</div>' +
        '<div style="display:flex;gap:0;border-bottom:1px solid var(--border);flex-shrink:0">' +
          '<button class="s-btn s-btn-sm ys-stab active" data-tab="cols" style="border-radius:0;border:none;border-bottom:2px solid var(--accent)">Columns</button>' +
          '<button class="s-btn s-btn-sm ys-stab" data-tab="idx" style="border-radius:0;border:none;border-bottom:2px solid transparent">Indexes</button>' +
          '<button class="s-btn s-btn-sm ys-stab" data-tab="fk" style="border-radius:0;border:none;border-bottom:2px solid transparent">Foreign Keys</button>' +
        '</div>' +
        '<div id="ys-struct-body" style="overflow:auto;flex:1;padding:8px 10px"></div>' +
      '</div>';

    content.querySelector('#ys-struct-back').addEventListener('click', function() {
      YS.browse.show(container);
    });

    content.querySelector('#ys-struct-edit').addEventListener('click', function() {
      _state.editMode = !_state.editMode;
      this.textContent = _state.editMode ? '✕ Cancel' : '✎ Edit';
      this.style.background = _state.editMode ? 'var(--danger,#e74c3c)' : 'var(--accent)';
      this.style.borderColor = _state.editMode ? 'var(--danger,#e74c3c)' : 'var(--accent)';
      var activeTab = content.querySelector('.ys-stab.active');
      if (activeTab && activeTab.dataset.tab === 'cols') {
        _renderColsTab(content, _state.cols, _state.editMode);
      }
    });

    var tabs = content.querySelectorAll('.ys-stab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t){ t.style.borderBottomColor='transparent'; t.classList.remove('active'); });
        tab.style.borderBottomColor = 'var(--accent)'; tab.classList.add('active');
        if (tab.dataset.tab === 'cols') _renderColsTab(content, _state.cols, _state.editMode);
        else if (tab.dataset.tab === 'idx') _renderIndexesTab(content, indexes, _state.cols);
        else _renderFKTab(content, foreignKeys, _state.cols);
      });
    });

    _renderColsTab(content, _state.cols, false);
  }

  // ── Columns tab ──────────────────────────────────────────────────────────

  function _renderColsTab(content, cols, editMode) {
    var body = content.querySelector('#ys-struct-body');
    var esc = YS.escHtml;
    if (editMode) {
      _renderColsEditor(body, cols);
    } else {
      if (!cols.length) { body.innerHTML = '<div style="color:var(--text-dim);padding:10px">No columns</div>'; return; }
      var html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap">' +
        '<thead><tr style="background:var(--surface)">' +
        ['Field','Type','Null','Key','Default','Extra','Collation','Comment'].map(function(h){
          return '<th style="padding:6px 10px;border-bottom:2px solid var(--border);text-align:left">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
      cols.forEach(function(c) {
        var isPK = c.isPK;
        var typeDisp = c.baseType + (c.length ? '(' + c.length + (c.decimals ? ',' + c.decimals : '') + ')' : '') + (c.enumValues ? '(' + c.enumValues + ')' : '') + (c.unsigned ? ' unsigned' : '');
        html += '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:5px 10px;font-weight:' + (isPK?'600':'400') + ';color:' + (isPK?'var(--accent)':'') + '">' + esc(c.name) + '</td>' +
          '<td style="padding:5px 10px;color:var(--color-num,#8be9fd)">' + esc(typeDisp) + '</td>' +
          '<td style="padding:5px 10px">' + (c.allowNull ? 'YES' : 'NO') + '</td>' +
          '<td style="padding:5px 10px">' + (isPK ? '<span style="color:var(--accent);font-size:.75rem">PRI</span>' : esc(c.isPK ? 'PRI' : '')) + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim)">' + esc(c.defaultType === 'NULL' ? 'NULL' : c.defaultType === 'EMPTY' ? '\'\'' : c.defaultType === 'CURRENT_TIMESTAMP' ? 'CURRENT_TIMESTAMP' : c.defaultValue || '') + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim)">' + esc(c.autoIncrement ? 'AUTO_INCREMENT' : '') + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim);font-size:.78rem">' + esc(c.collation || '') + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim)">' + esc(c.comment || '') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      body.innerHTML = html;
    }
  }

  function _buildTypeSelect(current) {
    var html = '<select class="ys-col-type" style="width:100%;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem">';
    Object.entries(TYPE_GROUPS).forEach(function(entry) {
      html += '<optgroup label="' + entry[0] + '">';
      entry[1].forEach(function(t) {
        html += '<option value="' + t + '"' + (t === current ? ' selected' : '') + '>' + t + '</option>';
      });
      html += '</optgroup>';
    });
    html += '</select>';
    return html;
  }

  function _defaultOptions(col) {
    var opts = ['NONE','NULL','EMPTY','VALUE'];
    if (col.baseType === 'TIMESTAMP' || col.baseType === 'DATETIME') opts.push('CURRENT_TIMESTAMP');
    var html = '<select class="ys-col-deftype" style="padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem;width:100%">';
    opts.forEach(function(o) {
      html += '<option value="' + o + '"' + (o === col.defaultType ? ' selected' : '') + '>' + o + '</option>';
    });
    html += '</select>';
    return html;
  }

  function _renderColsEditor(body, cols) {
    var esc = YS.escHtml;
    var rowsHtml = '';
    cols.forEach(function(c, i) {
      rowsHtml += _editorRow(c, i);
    });

    body.innerHTML =
      '<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap">' +
        '<button class="s-btn s-btn-sm" id="ys-col-add" style="background:var(--accent);color:#fff;border-color:var(--accent)">+ Add Column</button>' +
        '<button class="s-btn s-btn-sm" id="ys-col-save" style="background:#27ae60;color:#fff;border-color:#27ae60">✓ Save Structure</button>' +
      '</div>' +
      '<div style="overflow-x:auto">' +
      '<table id="ys-col-table" style="border-collapse:collapse;width:100%;font-size:.8rem">' +
      '<thead><tr style="background:var(--surface)">' +
        ['','Name','Type','Length','Dec','Enum/Set','Unsigned','Null','Default','Def.Value','AI','Collation','Comment',''].map(function(h){
          return '<th style="padding:4px 6px;border-bottom:2px solid var(--border);text-align:left;white-space:nowrap;font-weight:500">' + h + '</th>';
        }).join('') +
      '</tr></thead>' +
      '<tbody id="ys-col-tbody">' + rowsHtml + '</tbody>' +
      '</table></div>';

    _wireEditorEvents(body, cols);
  }

  function _editorRow(col, i) {
    var esc = YS.escHtml;
    return '<tr data-idx="' + i + '" style="border-bottom:1px solid var(--border)">' +
      '<td style="padding:3px 4px;cursor:grab;color:var(--text-dim)" title="Drag to reorder">⠿</td>' +
      '<td style="padding:3px 4px"><input class="ys-col-name" value="' + esc(col.name) + '" style="width:90px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem"></td>' +
      '<td style="padding:3px 4px;min-width:110px">' + _buildTypeSelect(col.baseType) + '</td>' +
      '<td style="padding:3px 4px"><input class="ys-col-len" value="' + esc(col.length) + '" style="width:50px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem" ' + (NEEDS_LENGTH.has(col.baseType) ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px"><input class="ys-col-dec" value="' + esc(col.decimals) + '" style="width:40px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem" ' + (NEEDS_DECIMALS.has(col.baseType) ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px"><input class="ys-col-enum" value="' + esc(col.enumValues) + '" placeholder="\'a\',\'b\'" style="width:80px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem" ' + (NEEDS_ENUM.has(col.baseType) ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px;text-align:center"><input type="checkbox" class="ys-col-unsigned" ' + (col.unsigned ? 'checked' : '') + ' ' + (CAN_UNSIGNED.has(col.baseType) ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px;text-align:center"><input type="checkbox" class="ys-col-null" ' + (col.allowNull ? 'checked' : '') + '></td>' +
      '<td style="padding:3px 4px;min-width:100px">' + _defaultOptions(col) + '</td>' +
      '<td style="padding:3px 4px"><input class="ys-col-defval" value="' + esc(col.defaultValue) + '" style="width:70px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem" ' + (col.defaultType === 'VALUE' ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px;text-align:center"><input type="checkbox" class="ys-col-ai" ' + (col.autoIncrement ? 'checked' : '') + '></td>' +
      '<td style="padding:3px 4px"><input class="ys-col-coll" value="' + esc(col.collation || '') + '" style="width:100px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem" ' + (HAS_COLLATION.has(col.baseType) ? '' : 'disabled') + '></td>' +
      '<td style="padding:3px 4px"><input class="ys-col-comment" value="' + esc(col.comment || '') + '" style="width:90px;padding:3px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.8rem"></td>' +
      '<td style="padding:3px 4px">' +
        '<button class="s-btn s-btn-sm ys-col-del" style="padding:2px 6px;color:var(--danger,#e74c3c);border-color:var(--danger,#e74c3c);background:transparent" data-orig="' + esc(col.originalName) + '" title="Delete column">✕</button>' +
      '</td>' +
      '</tr>';
  }

  function _wireEditorEvents(body, cols) {
    var tbody = body.querySelector('#ys-col-tbody');

    // Type change → update dependent fields
    tbody.addEventListener('change', function(e) {
      var tr = e.target.closest('tr');
      if (!tr) return;
      if (e.target.classList.contains('ys-col-type')) {
        var base = e.target.value;
        tr.querySelector('.ys-col-len').disabled = !NEEDS_LENGTH.has(base);
        tr.querySelector('.ys-col-dec').disabled = !NEEDS_DECIMALS.has(base);
        tr.querySelector('.ys-col-enum').disabled = !NEEDS_ENUM.has(base);
        tr.querySelector('.ys-col-unsigned').disabled = !CAN_UNSIGNED.has(base);
        tr.querySelector('.ys-col-coll').disabled = !HAS_COLLATION.has(base);
      }
      if (e.target.classList.contains('ys-col-deftype')) {
        tr.querySelector('.ys-col-defval').disabled = e.target.value !== 'VALUE';
      }
    });

    // Delete row
    tbody.addEventListener('click', function(e) {
      if (e.target.classList.contains('ys-col-del')) {
        var tr = e.target.closest('tr');
        var origName = e.target.dataset.orig;
        if (origName && !confirm('Drop column "' + origName + '"?')) return;
        tr.remove();
      }
    });

    // Add column
    body.querySelector('#ys-col-add').addEventListener('click', function() {
      var newCol = {
        originalName: '', name: '', baseType: 'VARCHAR', length: '255', decimals: '',
        enumValues: '', unsigned: false, allowNull: true, defaultType: 'NULL',
        defaultValue: '', autoIncrement: false, isPK: false, collation: '', comment: ''
      };
      var idx = tbody.querySelectorAll('tr').length;
      tbody.insertAdjacentHTML('beforeend', _editorRow(newCol, idx));
    });

    // Drag to reorder
    var dragSrc = null;
    tbody.addEventListener('dragstart', function(e) {
      dragSrc = e.target.closest('tr');
      if (dragSrc) { dragSrc.style.opacity = '0.4'; e.dataTransfer.effectAllowed = 'move'; }
    });
    tbody.addEventListener('dragend', function(e) {
      if (dragSrc) { dragSrc.style.opacity = ''; dragSrc = null; }
    });
    tbody.addEventListener('dragover', function(e) { e.preventDefault(); });
    tbody.addEventListener('drop', function(e) {
      e.preventDefault();
      var target = e.target.closest('tr');
      if (!target || target === dragSrc) return;
      tbody.insertBefore(dragSrc, target.nextSibling);
    });
    tbody.querySelectorAll('tr').forEach(function(tr) { tr.draggable = true; });

    // Save
    body.querySelector('#ys-col-save').addEventListener('click', async function() {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Saving…';
      var rows = tbody.querySelectorAll('tr');
      var columns = [];
      rows.forEach(function(tr, i) {
        var orig = tr.querySelector('.ys-col-del') ? tr.querySelector('.ys-col-del').dataset.orig : '';
        columns.push({
          originalName: orig || '',
          name: tr.querySelector('.ys-col-name').value.trim(),
          baseType: tr.querySelector('.ys-col-type').value,
          length: tr.querySelector('.ys-col-len').value.trim(),
          decimals: tr.querySelector('.ys-col-dec').value.trim(),
          enumValues: tr.querySelector('.ys-col-enum').value.trim(),
          unsigned: tr.querySelector('.ys-col-unsigned').checked,
          allowNull: tr.querySelector('.ys-col-null').checked,
          defaultType: tr.querySelector('.ys-col-deftype').value,
          defaultValue: tr.querySelector('.ys-col-defval').value,
          autoIncrement: tr.querySelector('.ys-col-ai').checked,
          collation: tr.querySelector('.ys-col-coll').value.trim(),
          comment: tr.querySelector('.ys-col-comment').value.trim(),
        });
      });
      try {
        var res = await YS.api('/alter-table', { method:'POST', json:{
          conn_id: YS.state.activeConn.id,
          database: YS.state.activeDb,
          table: YS.state.activeTable,
          columns: columns,
        }});
        if (res && res.success) {
          YS.toast && YS.toast('Structure saved', 'success');
          if (YS.tabs) { YS.tabs.markDirty(); YS.tabs.pin(YS.tabs.activeTab() && YS.tabs.activeTab().id); }
          var contentEl = document.querySelector('.window.focused #ysql-content') || document.querySelector('#ysql-content');
          var containerEl = contentEl ? contentEl.closest('[style*="position:relative"]') || contentEl.parentElement : document.body;
          show(containerEl, contentEl || containerEl);
        } else {
          alert('Error: ' + (res && res.error ? res.error : 'Unknown error'));
          btn.disabled = false; btn.textContent = '✓ Save Structure';
        }
      } catch(e) {
        alert('Error: ' + e.message);
        btn.disabled = false; btn.textContent = '✓ Save Structure';
      }
    });
  }

  // ── Indexes tab ──────────────────────────────────────────────────────────

  function _renderIndexesTab(content, indexes, cols) {
    var body = content.querySelector('#ys-struct-body');
    var esc = YS.escHtml;

    // Group by Key_name
    var groups = {};
    indexes.forEach(function(ix) {
      var name = ix.Key_name || ix.key_name || '';
      if (!groups[name]) groups[name] = [];
      groups[name].push(ix);
    });

    var tableHtml = '';
    if (Object.keys(groups).length) {
      tableHtml = '<div style="overflow-x:auto;margin-bottom:16px"><table style="border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap">' +
        '<thead><tr style="background:var(--surface)">' +
        ['Name','Type','Column(s)','Unique',''].map(function(h){
          return '<th style="padding:6px 10px;border-bottom:2px solid var(--border);text-align:left">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
      Object.keys(groups).forEach(function(name) {
        var rows = groups[name];
        var first = rows[0];
        var colNames = rows.map(function(r){ return r.Column_name || r.column_name || ''; }).join(', ');
        var isPK = name === 'PRIMARY';
        var isUniq = first.Non_unique == 0 || first.non_unique == 0;
        tableHtml += '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:5px 10px;color:' + (isPK?'var(--accent)':'') + '">' + esc(name) + '</td>' +
          '<td style="padding:5px 10px;font-size:.78rem">' + esc(first.Index_type || first.index_type || 'BTREE') + '</td>' +
          '<td style="padding:5px 10px">' + esc(colNames) + '</td>' +
          '<td style="padding:5px 10px">' + (isUniq ? '<span style="color:#50fa7b">✓</span>' : '') + '</td>' +
          '<td style="padding:5px 10px">' + (isPK ? '' : '<button class="s-btn s-btn-sm ys-idx-drop" data-name="' + esc(name) + '" style="color:var(--danger,#e74c3c);border-color:var(--danger,#e74c3c);background:transparent;padding:2px 6px">Drop</button>') + '</td>' +
          '</tr>';
      });
      tableHtml += '</tbody></table></div>';
    } else {
      tableHtml = '<div style="color:var(--text-dim);padding:8px 0;margin-bottom:12px">No indexes</div>';
    }

    var colOptions = cols.map(function(c){ return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');

    body.innerHTML = tableHtml +
      '<div style="border:1px solid var(--border);border-radius:4px;padding:10px;max-width:420px">' +
        '<div style="font-size:.82rem;font-weight:500;margin-bottom:8px">Add Index</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Name (optional)</div>' +
            '<input id="ys-idx-name" style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Type</div>' +
            '<select id="ys-idx-type" style="width:100%;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem">' +
              '<option>INDEX</option><option>UNIQUE</option><option>PRIMARY</option>' + (META.hasFulltext ? '<option>FULLTEXT</option>' : '') +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:8px">' +
          '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Columns</div>' +
          '<select id="ys-idx-cols" multiple style="width:100%;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;height:80px">' + colOptions + '</select>' +
        '</div>' +
        '<button class="s-btn s-btn-sm" id="ys-idx-add-btn" style="background:var(--accent);color:#fff;border-color:var(--accent)">Add Index</button>' +
        '<span id="ys-idx-msg" style="font-size:.78rem;margin-left:8px;color:var(--text-dim)"></span>' +
      '</div>';

    body.querySelectorAll('.ys-idx-drop').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var name = this.dataset.name;
        if (!confirm('Drop index "' + name + '"?')) return;
        try {
          var res = await YS.api('/indexes', { method:'POST', json:{
            conn_id: YS.state.activeConn.id, database: YS.state.activeDb,
            table: YS.state.activeTable, action: 'drop', name: name
          }});
          if (res && res.success) { _reloadTab(content, 'idx'); }
          else alert(res && res.error ? res.error : 'Error');
        } catch(e) { alert(e.message); }
      });
    });

    body.querySelector('#ys-idx-add-btn').addEventListener('click', async function() {
      var name = body.querySelector('#ys-idx-name').value.trim();
      var type = body.querySelector('#ys-idx-type').value;
      var sel = body.querySelector('#ys-idx-cols');
      var selectedCols = Array.from(sel.selectedOptions).map(function(o){ return o.value; });
      if (!selectedCols.length) { body.querySelector('#ys-idx-msg').textContent = 'Select at least one column'; return; }
      try {
        var res = await YS.api('/indexes', { method:'POST', json:{
          conn_id: YS.state.activeConn.id, database: YS.state.activeDb,
          table: YS.state.activeTable, action: 'add', name: name, type: type, columns: selectedCols
        }});
        if (res && res.success) { _reloadTab(content, 'idx'); }
        else { body.querySelector('#ys-idx-msg').textContent = res && res.error ? res.error : 'Error'; }
      } catch(e) { body.querySelector('#ys-idx-msg').textContent = e.message; }
    });
  }

  // ── Foreign Keys tab ─────────────────────────────────────────────────────

  function _renderFKTab(content, fks, cols) {
    var body = content.querySelector('#ys-struct-body');
    var esc = YS.escHtml;

    var tableHtml = '';
    if (fks.length) {
      tableHtml = '<div style="overflow-x:auto;margin-bottom:16px"><table style="border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap">' +
        '<thead><tr style="background:var(--surface)">' +
        ['Name','Column(s)','References','On Update','On Delete',''].map(function(h){
          return '<th style="padding:6px 10px;border-bottom:2px solid var(--border);text-align:left">' + h + '</th>';
        }).join('') + '</tr></thead><tbody>';
      fks.forEach(function(fk) {
        tableHtml += '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:5px 10px">' + esc(fk.name) + '</td>' +
          '<td style="padding:5px 10px">' + esc((fk.columns || []).join(', ')) + '</td>' +
          '<td style="padding:5px 10px">' + esc((fk.ref_db || '') + '.' + (fk.ref_table || '') + ' (' + (fk.ref_cols || []).join(', ') + ')') + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim)">' + esc(fk.on_update || '') + '</td>' +
          '<td style="padding:5px 10px;color:var(--text-dim)">' + esc(fk.on_delete || '') + '</td>' +
          '<td style="padding:5px 10px"><button class="s-btn s-btn-sm ys-fk-drop" data-name="' + esc(fk.name) + '" style="color:var(--danger,#e74c3c);border-color:var(--danger,#e74c3c);background:transparent;padding:2px 6px">Drop</button></td>' +
          '</tr>';
      });
      tableHtml += '</tbody></table></div>';
    } else {
      tableHtml = '<div style="color:var(--text-dim);padding:8px 0;margin-bottom:12px">No foreign keys</div>';
    }

    var colOptions = cols.map(function(c){ return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>'; }).join('');
    var ruleOpts = ['RESTRICT','CASCADE','SET NULL','NO ACTION'].map(function(r){ return '<option>' + r + '</option>'; }).join('');

    body.innerHTML = tableHtml +
      '<div style="border:1px solid var(--border);border-radius:4px;padding:10px;max-width:500px">' +
        '<div style="font-size:.82rem;font-weight:500;margin-bottom:8px">Add Foreign Key</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Constraint name (optional)</div>' +
            '<input id="ys-fk-name" style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Ref. database</div>' +
            '<input id="ys-fk-refdb" value="' + esc(YS.state.activeDb) + '" style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Columns</div>' +
            '<select id="ys-fk-cols" multiple style="width:100%;height:70px;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem">' + colOptions + '</select>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Ref. table</div>' +
            '<input id="ys-fk-reftbl" style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;box-sizing:border-box;margin-bottom:4px" placeholder="table name">' +
            '<div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">Ref. columns (comma-sep.)</div>' +
            '<input id="ys-fk-refcols" style="width:100%;padding:4px 6px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem;box-sizing:border-box" placeholder="id">' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">' +
          '<div><div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">On Update</div><select id="ys-fk-onupd" style="width:100%;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem">' + ruleOpts + '</select></div>' +
          '<div><div style="font-size:.78rem;color:var(--text-dim);margin-bottom:2px">On Delete</div><select id="ys-fk-ondel" style="width:100%;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:3px;font-size:.82rem">' + ruleOpts + '</select></div>' +
        '</div>' +
        '<button class="s-btn s-btn-sm" id="ys-fk-add-btn" style="background:var(--accent);color:#fff;border-color:var(--accent)">Add Foreign Key</button>' +
        '<span id="ys-fk-msg" style="font-size:.78rem;margin-left:8px;color:var(--text-dim)"></span>' +
      '</div>';

    body.querySelectorAll('.ys-fk-drop').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var name = this.dataset.name;
        if (!confirm('Drop foreign key "' + name + '"?')) return;
        try {
          var res = await YS.api('/foreign-keys', { method:'POST', json:{
            conn_id: YS.state.activeConn.id, database: YS.state.activeDb,
            table: YS.state.activeTable, action: 'drop', name: name
          }});
          if (res && res.success) { _reloadTab(content, 'fk'); }
          else alert(res && res.error ? res.error : 'Error');
        } catch(e) { alert(e.message); }
      });
    });

    body.querySelector('#ys-fk-add-btn').addEventListener('click', async function() {
      var msg = body.querySelector('#ys-fk-msg');
      var name = body.querySelector('#ys-fk-name').value.trim();
      var refDb = body.querySelector('#ys-fk-refdb').value.trim();
      var refTbl = body.querySelector('#ys-fk-reftbl').value.trim();
      var refColsRaw = body.querySelector('#ys-fk-refcols').value.trim();
      var refCols = refColsRaw.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
      var sel = body.querySelector('#ys-fk-cols');
      var selCols = Array.from(sel.selectedOptions).map(function(o){ return o.value; });
      if (!selCols.length || !refTbl || !refCols.length) {
        msg.textContent = 'Fill columns, ref. table and ref. columns'; return;
      }
      try {
        var res = await YS.api('/foreign-keys', { method:'POST', json:{
          conn_id: YS.state.activeConn.id, database: YS.state.activeDb,
          table: YS.state.activeTable, action: 'add',
          name: name, columns: selCols, ref_db: refDb, ref_table: refTbl, ref_cols: refCols,
          on_update: body.querySelector('#ys-fk-onupd').value,
          on_delete: body.querySelector('#ys-fk-ondel').value,
        }});
        if (res && res.success) { _reloadTab(content, 'fk'); }
        else { msg.textContent = res && res.error ? res.error : 'Error'; }
      } catch(e) { msg.textContent = e.message; }
    });
  }

  // ── Reload helper ─────────────────────────────────────────────────────────

  async function _reloadTab(content, tab) {
    var data = await YS.api('/table-structure?conn_id=' + YS.state.activeConn.id +
      '&database=' + encodeURIComponent(YS.state.activeDb) +
      '&table=' + encodeURIComponent(YS.state.activeTable)).catch(function(){ return {}; });
    var rawCols = data.columns || [];
    var indexes = data.indexes || [];
    var foreignKeys = data.foreign_keys || [];
    _state.cols = rawCols.map(_parseCol);
    content.querySelectorAll('.ys-stab').forEach(function(t){
      var active = t.dataset.tab === tab;
      t.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
      t.classList.toggle('active', active);
    });
    if (tab === 'cols') {
      _state.editMode = false;
      var editBtn = content.querySelector('#ys-struct-edit');
      if (editBtn) { editBtn.textContent = '✎ Edit'; editBtn.style.background = 'var(--accent)'; editBtn.style.borderColor = 'var(--accent)'; }
      _renderColsTab(content, _state.cols, false);
    }
    else if (tab === 'idx') _renderIndexesTab(content, indexes, _state.cols);
    else _renderFKTab(content, foreignKeys, _state.cols);
  }

  return { show };
})();
