// YourSQL — Create Table

const _ysqlCtT = window.t || (k => k);

YS.createTable = (() => {

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

  var ENGINES = ['InnoDB','MyISAM','MEMORY','CSV','ARCHIVE','BLACKHOLE','FEDERATED'];
  var COLLATIONS = ['Default','utf8mb4_general_ci','utf8mb4_unicode_ci','utf8mb4_0900_ai_ci',
                    'utf8_general_ci','utf8_unicode_ci','latin1_swedish_ci'];

  function show(container) {
    var content = container.querySelector('#ysql-content');
    if (!content) return;

    var family = YS.dbtype.familyForConn(YS.state.activeConn);
    _applyMeta(family);

    var cols = [
      { name: 'id',   type: META.defaultIntType,    length: '11', decimals: '', enumValues: '', unsigned: family === 'mysql',  allowNull: false, defaultType: 'NULL', defaultValue: '', autoIncrement: true,  primary: true,  collation: '' },
      { name: 'name', type: META.defaultStringType, length: '255', decimals: '', enumValues: '', unsigned: false, allowNull: true,  defaultType: 'NULL', defaultValue: '', autoIncrement: false, primary: false, collation: '' },
    ];

    content.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:auto;padding:20px;box-sizing:border-box;gap:16px';

    // Header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
    header.innerHTML = '<h2 style="margin:0;font-size:1rem;font-weight:600">' + _ysqlCtT('ysql_create_table_title', { db: YS.escHtml(YS.state.activeDb) }) + '</h2>';
    var saveBtn = document.createElement('button');
    saveBtn.className = 's-btn s-btn-sm';
    saveBtn.style.cssText = 'background:var(--accent);color:#fff;border-color:var(--accent);padding:5px 18px;font-size:.85rem';
    saveBtn.textContent = _ysqlCtT('ysql_save');
    header.appendChild(saveBtn);
    wrap.appendChild(header);

    // Table options
    var optBox = document.createElement('div');
    optBox.style.cssText = 'display:grid;grid-template-columns:repeat(' + (META.hasEngine ? 4 : 2) + ',1fr);gap:12px;padding:14px;border:1px solid var(--border);border-radius:4px;flex-shrink:0';
    optBox.innerHTML =
      '<div><div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + _ysqlCtT('ysql_table_name') + '</div>' +
        '<input id="ysql-ct-name" class="s-input" style="width:100%;font-size:.85rem" placeholder="' + _ysqlCtT('ysql_table_name_ph') + '"></div>' +
      (META.hasEngine ?
      '<div><div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + _ysqlCtT('ysql_engine') + '</div>' +
        '<select id="ysql-ct-engine" class="s-input" style="width:100%;font-size:.85rem">' +
          ENGINES.map(function(e){ return '<option' + (e==='InnoDB'?' selected':'') + '>' + e + '</option>'; }).join('') +
        '</select></div>' +
      '<div><div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + _ysqlCtT('ysql_collation_upper') + '</div>' +
        '<select id="ysql-ct-collation" class="s-input" style="width:100%;font-size:.85rem">' +
          COLLATIONS.map(function(c){ return '<option>' + c + '</option>'; }).join('') +
        '</select></div>' : '') +
      '<div><div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">' + _ysqlCtT('ysql_comment_upper') + '</div>' +
        '<input id="ysql-ct-comment" class="s-input" style="width:100%;font-size:.85rem" placeholder="' + _ysqlCtT('ysql_comment_optional_ph') + '"></div>';
    wrap.appendChild(optBox);

    // Columns table
    var colWrap = document.createElement('div');
    colWrap.style.cssText = 'border:1px solid var(--border);border-radius:4px;overflow:hidden;flex-shrink:0';

    var thead = document.createElement('div');
    thead.style.cssText = 'display:grid;grid-template-columns:28px 1fr 120px 100px 130px 70px 80px 80px 40px 60px 36px;gap:0;background:var(--surface);border-bottom:1px solid var(--border);font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em';
    ['',_ysqlCtT('ysql_th_field'),_ysqlCtT('ysql_th_type'),_ysqlCtT('ysql_th_length_values'),_ysqlCtT('ysql_th_collation'),_ysqlCtT('ysql_th_unsigned'),_ysqlCtT('ysql_th_allow_null'),_ysqlCtT('ysql_th_default'),_ysqlCtT('ysql_th_ai'),_ysqlCtT('ysql_th_primary'),''].forEach(function(h) {
      var cell = document.createElement('div');
      cell.style.cssText = 'padding:7px 8px;text-align:center';
      cell.textContent = h;
      thead.appendChild(cell);
    });
    colWrap.appendChild(thead);

    var tbody = document.createElement('div');
    tbody.id = 'ysql-ct-rows';
    colWrap.appendChild(tbody);
    wrap.appendChild(colWrap);

    // Add column button
    var addBtn = document.createElement('button');
    addBtn.className = 's-btn s-btn-sm';
    addBtn.textContent = _ysqlCtT('ysql_add_column');
    addBtn.style.cssText = 'align-self:flex-start;font-size:.82rem';
    addBtn.addEventListener('click', function() {
      cols.push({ name: '', type: META.defaultStringType, length: '255', decimals: '', enumValues: '', unsigned: false, allowNull: true, defaultType: 'NULL', defaultValue: '', autoIncrement: false, primary: false, collation: '' });
      _renderRows(tbody, cols);
    });
    wrap.appendChild(addBtn);

    content.appendChild(wrap);
    _renderRows(tbody, cols);

    saveBtn.addEventListener('click', function() {
      _save(container, content, cols);
    });
  }

  function _renderRows(tbody, cols) {
    tbody.innerHTML = '';
    cols.forEach(function(col, i) {
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:28px 1fr 120px 100px 130px 70px 80px 80px 40px 60px 36px;gap:0;border-bottom:1px solid var(--border);align-items:center';
      row.dataset.idx = i;

      // Drag handle
      var drag = document.createElement('div');
      drag.style.cssText = 'text-align:center;color:var(--text-dim);cursor:grab;font-size:.85rem;padding:4px';
      drag.textContent = '⠿';
      row.appendChild(drag);

      // Field name
      var nameInp = document.createElement('input');
      nameInp.className = 's-input';
      nameInp.style.cssText = 'font-size:.82rem;margin:3px 4px;padding:3px 6px';
      nameInp.value = col.name;
      nameInp.placeholder = _ysqlCtT('ysql_column_name_ph');
      nameInp.addEventListener('input', function() { col.name = this.value; });
      row.appendChild(nameInp);

      // Type select
      var typeWrap = document.createElement('div');
      typeWrap.style.cssText = 'margin:3px 4px';
      var typeSel = document.createElement('select');
      typeSel.className = 's-input';
      typeSel.style.cssText = 'font-size:.82rem;width:100%;padding:3px 4px';
      Object.keys(TYPE_GROUPS).forEach(function(g) {
        var og = document.createElement('optgroup');
        og.label = g;
        TYPE_GROUPS[g].forEach(function(t) {
          var o = document.createElement('option');
          o.value = t; o.textContent = t;
          if (t === col.type) o.selected = true;
          og.appendChild(o);
        });
        typeSel.appendChild(og);
      });
      typeSel.addEventListener('change', function() {
        col.type = this.value;
        _renderRows(tbody, cols);
      });
      typeWrap.appendChild(typeSel);
      row.appendChild(typeWrap);

      // Length / Values
      var lenWrap = document.createElement('div');
      lenWrap.style.cssText = 'margin:3px 4px';
      var base = col.type.toUpperCase();
      if (NEEDS_ENUM.has(base)) {
        var enumInp = document.createElement('input');
        enumInp.className = 's-input';
        enumInp.style.cssText = 'font-size:.82rem;width:100%;padding:3px 6px';
        enumInp.value = col.enumValues || '';
        enumInp.placeholder = "'a','b'";
        enumInp.addEventListener('input', function() { col.enumValues = this.value; });
        lenWrap.appendChild(enumInp);
      } else if (NEEDS_DECIMALS.has(base)) {
        var lenInp = document.createElement('input');
        lenInp.className = 's-input';
        lenInp.style.cssText = 'font-size:.82rem;width:45%;padding:3px 6px;margin-right:2px';
        lenInp.value = col.length || '';
        lenInp.placeholder = 'len';
        lenInp.addEventListener('input', function() { col.length = this.value; });
        var decInp = document.createElement('input');
        decInp.className = 's-input';
        decInp.style.cssText = 'font-size:.82rem;width:45%;padding:3px 6px';
        decInp.value = col.decimals || '';
        decInp.placeholder = 'dec';
        decInp.addEventListener('input', function() { col.decimals = this.value; });
        lenWrap.appendChild(lenInp);
        lenWrap.appendChild(decInp);
      } else if (NEEDS_LENGTH.has(base)) {
        var lInp = document.createElement('input');
        lInp.className = 's-input';
        lInp.style.cssText = 'font-size:.82rem;width:100%;padding:3px 6px';
        lInp.value = col.length || '';
        lInp.addEventListener('input', function() { col.length = this.value; });
        lenWrap.appendChild(lInp);
      }
      row.appendChild(lenWrap);

      // Collation
      var colWrapEl = document.createElement('div');
      colWrapEl.style.cssText = 'margin:3px 4px';
      if (HAS_COLLATION.has(base)) {
        var collSel = document.createElement('select');
        collSel.className = 's-input';
        collSel.style.cssText = 'font-size:.75rem;width:100%;padding:3px 2px';
        [_ysqlCtT('ysql_inherit')].concat(COLLATIONS.slice(1)).forEach(function(c) {
          var o = document.createElement('option');
          o.value = c === _ysqlCtT('ysql_inherit') ? '' : c;
          o.textContent = c;
          if ((col.collation || '') === o.value) o.selected = true;
          collSel.appendChild(o);
        });
        collSel.addEventListener('change', function() { col.collation = this.value; });
        colWrapEl.appendChild(collSel);
      }
      row.appendChild(colWrapEl);

      // Unsigned
      var unsCel = document.createElement('div');
      unsCel.style.cssText = 'text-align:center';
      if (CAN_UNSIGNED.has(base)) {
        var unsCk = document.createElement('input');
        unsCk.type = 'checkbox';
        unsCk.checked = !!col.unsigned;
        unsCk.addEventListener('change', function() { col.unsigned = this.checked; });
        unsCel.appendChild(unsCk);
      }
      row.appendChild(unsCel);

      // Allow Null
      var nullCel = document.createElement('div');
      nullCel.style.cssText = 'text-align:center';
      var nullCk = document.createElement('input');
      nullCk.type = 'checkbox';
      nullCk.checked = !!col.allowNull;
      nullCk.addEventListener('change', function() { col.allowNull = this.checked; });
      nullCel.appendChild(nullCk);
      row.appendChild(nullCel);

      // Default
      var defWrap = document.createElement('div');
      defWrap.style.cssText = 'margin:3px 4px;display:flex;gap:3px';
      if (!NO_DEFAULT.has(base)) {
        var defSel = document.createElement('select');
        defSel.className = 's-input';
        defSel.style.cssText = 'font-size:.75rem;padding:2px 2px;flex-shrink:0;width:70px';
        ['NULL','VALUE','EMPTY','CURRENT_TIMESTAMP'].forEach(function(d) {
          var o = document.createElement('option');
          o.value = d; o.textContent = d;
          if (col.defaultType === d) o.selected = true;
          defSel.appendChild(o);
        });
        var defInp = document.createElement('input');
        defInp.className = 's-input';
        defInp.style.cssText = 'font-size:.75rem;padding:2px 4px;min-width:0;flex:1;display:' + (col.defaultType === 'VALUE' ? 'block' : 'none');
        defInp.value = col.defaultValue || '';
        defSel.addEventListener('change', function() {
          col.defaultType = this.value;
          defInp.style.display = this.value === 'VALUE' ? 'block' : 'none';
        });
        defInp.addEventListener('input', function() { col.defaultValue = this.value; });
        defWrap.appendChild(defSel);
        defWrap.appendChild(defInp);
      }
      row.appendChild(defWrap);

      // Auto Increment
      var aiCel = document.createElement('div');
      aiCel.style.cssText = 'text-align:center';
      if (AUTO_INC_TYPES.has(base)) {
        var aiCk = document.createElement('input');
        aiCk.type = 'checkbox';
        aiCk.checked = !!col.autoIncrement;
        aiCk.addEventListener('change', function() { col.autoIncrement = this.checked; });
        aiCel.appendChild(aiCk);
      }
      row.appendChild(aiCel);

      // Primary
      var priCel = document.createElement('div');
      priCel.style.cssText = 'text-align:center';
      var priCk = document.createElement('input');
      priCk.type = 'checkbox';
      priCk.checked = !!col.primary;
      priCk.addEventListener('change', function() { col.primary = this.checked; });
      priCel.appendChild(priCk);
      row.appendChild(priCel);

      // Delete
      var delCel = document.createElement('div');
      delCel.style.cssText = 'text-align:center';
      var delBtn = document.createElement('button');
      delBtn.className = 's-btn s-btn-sm';
      delBtn.style.cssText = 'padding:2px 6px;background:#f38ba820;border-color:#f38ba8;color:#f38ba8;font-size:.75rem';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', function() {
        cols.splice(i, 1);
        _renderRows(tbody, cols);
      });
      delCel.appendChild(delBtn);
      row.appendChild(delCel);

      tbody.appendChild(row);
    });
  }

  async function _save(container, content, cols) {
    var nameInp = content.querySelector('#ysql-ct-name');
    var tableName = (nameInp ? nameInp.value.trim() : '');
    if (!tableName) { YS.toast(_ysqlCtT('ysql_table_name_required'), 'error'); nameInp && nameInp.focus(); return; }
    if (!cols.length) { YS.toast(_ysqlCtT('ysql_add_at_least_one_column'), 'error'); return; }

    var engine = content.querySelector('#ysql-ct-engine')?.value || 'InnoDB';
    var collation = content.querySelector('#ysql-ct-collation')?.value || '';
    var comment = content.querySelector('#ysql-ct-comment')?.value || '';

    var r = await YS.api('/create-table', { method: 'POST', json: {
      conn_id: YS.state.activeConn.id,
      database: YS.state.activeDb,
      table: tableName,
      engine: engine,
      collation: collation === 'Default' ? '' : collation,
      comment: comment,
      columns: cols,
    }}).catch(function(e){ return { error: e.message }; });

    if (r.error || r.detail) { YS.toast(r.error || r.detail, 'error'); return; }

    YS.toast(_ysqlCtT('ysql_table_created', { table: tableName }), 'success');
    // Reload sidebar tables and open browse
    await YS.sidebar.loadTables(container);
    YS.state.activeTable = tableName;
    if (YS.tabs) YS.tabs.open('browse', YS.state.activeDb, tableName);
    else YS.browse.show(container);
  }

  return { show };
})();
