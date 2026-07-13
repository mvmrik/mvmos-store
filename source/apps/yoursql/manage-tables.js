// YourSQL — Manage Tables

const _ysqlMtT = window.t || (k => k);

YS.manageTables = (() => {

  function _operationsFor(family) {
    var meta = YS.dbtype.meta(family);
    var maintenance = [
      { id: 'analyze',  icon: '📊', label: _ysqlMtT('ysql_op_analyze'),  desc: _ysqlMtT('ysql_op_analyze_desc'),       danger: false },
      { id: 'optimize', icon: '⚙',  label: meta.optimizeLabel, desc: meta.optimizeDesc,       danger: false },
    ];
    if (meta.hasCheckRepair) {
      maintenance.push(
        { id: 'check',    icon: '✔',  label: _ysqlMtT('ysql_op_check'),    desc: _ysqlMtT('ysql_op_check_desc'),       danger: false },
        { id: 'repair',   icon: '🔧', label: _ysqlMtT('ysql_op_repair'),   desc: _ysqlMtT('ysql_op_repair_desc'), danger: false }
      );
    }
    return [
      { group: _ysqlMtT('ysql_op_group_operation'), items: [
        { id: 'truncate', icon: '🗑', label: _ysqlMtT('ysql_op_truncate'), desc: _ysqlMtT('ysql_op_truncate_desc'), danger: true },
        { id: 'drop',     icon: '💥', label: _ysqlMtT('ysql_op_drop'),     desc: _ysqlMtT('ysql_op_drop_desc'),      danger: true },
      ]},
      { group: _ysqlMtT('ysql_op_group_maintenance'), items: maintenance },
    ];
  }

  async function show(container) {
    var content = container.querySelector('#ysql-content');
    if (!content || !YS.state.activeDb) return;

    var family = YS.dbtype.familyForConn(YS.state.activeConn);
    var OPERATIONS = _operationsFor(family);

    var tables = [];
    try { tables = await YS.api('/tables?conn_id=' + YS.state.activeConn.id + '&database=' + encodeURIComponent(YS.state.activeDb)); } catch(e) {}
    if (!Array.isArray(tables)) tables = [];

    content.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;width:100%;height:100%;overflow:hidden';

    // Left panel — operations
    var left = document.createElement('div');
    left.style.cssText = 'width:260px;flex-shrink:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px;border-right:1px solid var(--border)';

    var selectedOp = { id: 'truncate' };

    OPERATIONS.forEach(function(group) {
      var grpLabel = document.createElement('div');
      grpLabel.style.cssText = 'font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px';
      grpLabel.textContent = group.group;
      left.appendChild(grpLabel);

      group.items.forEach(function(op) {
        var card = document.createElement('div');
        card.dataset.opid = op.id;
        card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:6px;cursor:pointer;transition:background .1s';
        card.innerHTML =
          '<span style="font-size:1.1rem;flex-shrink:0">' + op.icon + '</span>' +
          '<div><div style="font-weight:500;font-size:.85rem">' + op.label + '</div>' +
          '<div style="font-size:.75rem;color:var(--text-dim);margin-top:1px">' + op.desc + '</div></div>';

        if (op.id === selectedOp.id) _selectCard(card, op);

        card.addEventListener('click', function() {
          left.querySelectorAll('[data-opid]').forEach(function(c) {
            c.style.background = '';
            c.style.borderColor = 'var(--border)';
          });
          selectedOp.id = op.id;
          _selectCard(card, op);
          _updateBtn(runBtn, op, selectedTables);
        });
        left.appendChild(card);
      });
    });

    wrap.appendChild(left);

    // Right panel — tables
    var right = document.createElement('div');
    right.style.cssText = 'flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px';

    var tblHeader = document.createElement('div');
    tblHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
    var tblLabel = document.createElement('div');
    tblLabel.style.cssText = 'font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em';
    tblLabel.textContent = _ysqlMtT('ysql_tables');
    var allLbl = document.createElement('label');
    allLbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer';
    var allCk = document.createElement('input'); allCk.type = 'checkbox';
    allLbl.appendChild(allCk); allLbl.appendChild(document.createTextNode(_ysqlMtT('ysql_all_tables')));
    tblHeader.appendChild(tblLabel); tblHeader.appendChild(allLbl);
    right.appendChild(tblHeader);

    var selectedTables = [];
    var checkboxes = [];

    tables.forEach(function(t) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:.85rem';
      var ck = document.createElement('input'); ck.type = 'checkbox'; ck.value = t;
      ck.addEventListener('change', function() {
        if (ck.checked) { if (!selectedTables.includes(t)) selectedTables.push(t); }
        else selectedTables = selectedTables.filter(function(x){ return x !== t; });
        allCk.checked = selectedTables.length === tables.length;
        _updateBtn(runBtn, OPERATIONS.flatMap(function(g){return g.items;}).find(function(o){return o.id===selectedOp.id;}), selectedTables);
      });
      checkboxes.push(ck);
      lbl.appendChild(ck); lbl.appendChild(document.createTextNode(t));
      lbl.addEventListener('mouseenter', function(){ lbl.style.background='var(--hover,rgba(255,255,255,.04))'; });
      lbl.addEventListener('mouseleave', function(){ lbl.style.background=''; });
      right.appendChild(lbl);
    });

    allCk.addEventListener('change', function() {
      checkboxes.forEach(function(c){ c.checked = allCk.checked; });
      selectedTables = allCk.checked ? tables.slice() : [];
      _updateBtn(runBtn, OPERATIONS.flatMap(function(g){return g.items;}).find(function(o){return o.id===selectedOp.id;}), selectedTables);
    });

    // Run button
    var footer = document.createElement('div');
    footer.style.cssText = 'position:sticky;bottom:0;padding:10px 16px;border-top:1px solid var(--border);background:var(--surface);display:flex;justify-content:flex-end;flex-shrink:0';
    var runBtn = document.createElement('button');
    runBtn.className = 's-btn s-btn-sm';
    runBtn.style.cssText = 'padding:5px 18px;font-size:.85rem';
    runBtn.textContent = _ysqlMtT('ysql_op_selected', { op: _ysqlMtT('ysql_op_truncate') });
    runBtn.disabled = true;
    runBtn.addEventListener('click', function() {
      var op = OPERATIONS.flatMap(function(g){return g.items;}).find(function(o){return o.id===selectedOp.id;});
      _run(container, op, selectedTables, runBtn);
    });
    footer.appendChild(runBtn);

    var rightWrap = document.createElement('div');
    rightWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';
    rightWrap.appendChild(right);
    rightWrap.appendChild(footer);
    wrap.appendChild(rightWrap);
    content.appendChild(wrap);

    // Select first op card visually
    var firstCard = left.querySelector('[data-opid="truncate"]');
    if (firstCard) _selectCard(firstCard, OPERATIONS[0].items[0]);
  }

  function _selectCard(card, op) {
    card.style.background = op.danger ? 'rgba(243,139,168,.1)' : 'var(--accent-dim,rgba(99,102,241,.12))';
    card.style.borderColor = op.danger ? '#f38ba8' : 'var(--accent)';
  }

  function _updateBtn(btn, op, selected) {
    if (!op) return;
    btn.disabled = selected.length === 0;
    btn.textContent = _ysqlMtT('ysql_op_selected', { op: op.label });
    btn.style.background = op.danger ? '#f38ba8' : 'var(--accent)';
    btn.style.color = '#fff';
    btn.style.borderColor = op.danger ? '#f38ba8' : 'var(--accent)';
  }

  async function _run(container, op, tables, btn) {
    if (!tables.length) return;

    var confirmMsg = op.id === 'drop'
      ? _ysqlMtT('ysql_drop_n_tables_confirm', { n: tables.length })
      : _ysqlMtT('ysql_op_n_tables_confirm', { op: op.label, n: tables.length });
    if (!confirm(confirmMsg)) return;

    btn.disabled = true;
    btn.textContent = _ysqlMtT('ysql_running');

    var r = await YS.api('/manage-tables', { method: 'POST', json: {
      conn_id: YS.state.activeConn.id,
      database: YS.state.activeDb,
      operation: op.id,
      tables: tables,
    }}).catch(function(e){ return { error: e.message }; });

    if (r.error || r.detail) {
      YS.toast((r.error || r.detail), 'error');
      btn.disabled = false;
      _updateBtn(btn, op, tables);
      return;
    }

    YS.toast(_ysqlMtT('ysql_op_completed', { op: op.label, n: tables.length }), 'success');

    if (op.id === 'drop') {
      await YS.sidebar.loadTables(container);
      YS.browse.showWelcome(container);
    } else {
      show(container);
    }
  }

  return { show };
})();
