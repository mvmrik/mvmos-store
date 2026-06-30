// YourSQL — Row edit modal & Insert row modal

YS.rowEdit = (() => {

  function open(row, columns, colMeta, content) {
    close();
    var esc = YS.escHtml;
    var snapConn = YS.state.activeConn;
    var snapDb = YS.state.activeDb;
    var snapTable = YS.state.activeTable;
    var container = content.closest('[style*="position:relative"]') || document.body;

    var overlay = document.createElement('div');
    overlay.id = 'ysql-row-edit-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:900;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(480px,100%);max-height:85vh;display:flex;flex-direction:column;box-shadow:var(--shadow)';
    modal.innerHTML =
      '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<span style="font-weight:600;font-size:.9rem;flex:1">Edit Row — ' + esc(YS.state.activeTable) + '</span>' +
        '<button id="ysql-rem-close" class="s-btn s-btn-sm" style="font-size:.8rem">✕</button>' +
      '</div>' +
      '<div id="ysql-rem-body" style="overflow-y:auto;flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:8px"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0">' +
        '<button id="ysql-rem-delete" class="s-btn s-btn-sm" style="color:#f38ba8">Delete</button>' +
        '<span style="flex:1"></span>' +
        '<button id="ysql-rem-cancel" class="s-btn s-btn-sm">Cancel</button>' +
        '<button id="ysql-rem-save" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">Save</button>' +
      '</div>';

    overlay.appendChild(modal);
    container.style.position = 'relative';
    container.appendChild(overlay);

    var body = modal.querySelector('#ysql-rem-body');
    var fields = [];

    columns.forEach(function(col) {
      var val = row[col];
      var meta = colMeta[col] || {};
      var input = YS.buildCellInput(meta, val, false);
      input.style.cssText += ';width:100%;box-sizing:border-box';
      input.dataset.col = col;

      var field = document.createElement('div');
      field.style.cssText = 'display:flex;flex-direction:column;gap:3px';

      var labelRow = document.createElement('div');
      labelRow.style.cssText = 'display:flex;align-items:center;gap:6px';
      labelRow.innerHTML =
        '<label style="font-size:.78rem;color:var(--text-dim);font-weight:500">' + esc(col) + '</label>' +
        '<span style="font-size:.68rem;color:var(--text-dim);background:var(--surface2,var(--border));padding:1px 5px;border-radius:3px">' + esc(meta.baseType || '') + '</span>' +
        (meta.key === 'PRI' ? '<span style="font-size:.65rem;color:var(--accent)">PK</span>' : '') +
        (meta.allowNull ? '<label style="margin-left:auto;font-size:.75rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="ysql-null-cb" data-col="' + esc(col) + '"' + (val === null ? ' checked' : '') + '> NULL</label>' : '');

      if (meta.allowNull) {
        var cb = labelRow.querySelector('.ysql-null-cb');
        if (val === null) input.disabled = true;
        cb.addEventListener('change', function() {
          input.disabled = cb.checked;
          input.style.opacity = cb.checked ? '.4' : '';
        });
      }

      field.appendChild(labelRow);
      field.appendChild(input);
      body.appendChild(field);
      fields.push({ col: col, input: input, meta: meta });
    });

    function doClose() { overlay.remove(); }
    overlay.addEventListener('click', function(e){ if(e.target===overlay) doClose(); });
    modal.querySelector('#ysql-rem-close').addEventListener('click', doClose);
    modal.querySelector('#ysql-rem-cancel').addEventListener('click', doClose);

    // Delete
    modal.querySelector('#ysql-rem-delete').addEventListener('click', async function() {
      if (!confirm('Delete this row?')) return;
      var btn = this; btn.disabled = true; btn.textContent = 'Deleting…';
      var where = YS.buildWhereFromRow(row, colMeta);
      var r = await YS.api('/delete-row', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, where: where
      }}).catch(function(){return {};});
      if (r.ok) {
        YS.toast('Row deleted', 'success'); if (YS.tabs) YS.tabs.markDirty();
        doClose();
        YS.browse._reload(null, content);
      } else {
        YS.toast('Error: ' + (r.detail || r.error || 'failed'), 'error');
        btn.disabled = false; btn.textContent = 'Delete';
      }
    });

    // Save
    modal.querySelector('#ysql-rem-save').addEventListener('click', async function() {
      var updates = {};
      fields.forEach(function(f) {
        var nullCb = modal.querySelector('.ysql-null-cb[data-col="' + f.col + '"]');
        if (nullCb && nullCb.checked) { updates[f.col] = null; }
        else { updates[f.col] = YS.getCellInputValue(f.input, f.meta); }
      });
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      var where = YS.buildWhereFromRow(row, colMeta);
      var r = await YS.api('/update-row', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, updates: updates, where: where
      }}).catch(function(){return {};});
      if (r.ok) {
        YS.toast('Row updated', 'success'); if (YS.tabs) YS.tabs.markDirty();
        doClose();
        YS.browse._reload(null, content);
      } else {
        YS.toast('Error: ' + (r.detail || r.error || 'failed'), 'error');
        btn.disabled = false; btn.textContent = 'Save';
      }
    });

    // focus first non-PK input
    setTimeout(function() {
      var first = body.querySelector('input:not([disabled]),textarea:not([disabled]),select:not([disabled])');
      if (first) first.focus();
    }, 50);
  }

  function close() {
    var el = document.getElementById('ysql-row-edit-overlay');
    if (el) el.remove();
  }

  return { open, close };
})();


YS.rowInsert = (() => {

  function show(container, content) {
    var columns = Object.keys(YS.state.colMeta);
    if (!columns.length) return;
    var esc = YS.escHtml;
    var snapConn = YS.state.activeConn;
    var snapDb = YS.state.activeDb;
    var snapTable = YS.state.activeTable;

    var overlay = document.createElement('div');
    overlay.id = 'ysql-row-insert-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:900;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(480px,100%);max-height:85vh;display:flex;flex-direction:column;box-shadow:var(--shadow)';
    modal.innerHTML =
      '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<span style="font-weight:600;font-size:.9rem;flex:1">Insert Row — ' + esc(YS.state.activeTable) + '</span>' +
        '<button id="ysql-ins-close" class="s-btn s-btn-sm">✕</button>' +
      '</div>' +
      '<div id="ysql-ins-body" style="overflow-y:auto;flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:8px"></div>' +
      '<div id="ysql-ins-error" style="display:none;padding:6px 16px;color:#f38ba8;font-size:.82rem"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0">' +
        '<button id="ysql-ins-cancel" class="s-btn s-btn-sm">Cancel</button>' +
        '<button id="ysql-ins-save" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">Insert</button>' +
      '</div>';

    overlay.appendChild(modal);
    container.style.position = 'relative';
    container.appendChild(overlay);

    var body = modal.querySelector('#ysql-ins-body');
    var fields = [];
    var colMeta = YS.state.colMeta;

    columns.forEach(function(col) {
      var meta = colMeta[col] || {};
      var isAI = meta.key === 'PRI' && meta.autoIncrement;
      var field = document.createElement('div');
      field.style.cssText = 'display:flex;flex-direction:column;gap:3px';
      field.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<label style="font-size:.78rem;color:var(--text-dim);font-weight:500">' + esc(col) + '</label>' +
          '<span style="font-size:.68rem;color:var(--text-dim);background:var(--surface2,var(--border));padding:1px 5px;border-radius:3px">' + esc(meta.baseType || '') + '</span>' +
          (isAI ? '<span style="font-size:.65rem;color:var(--text-dim)">auto</span>' : '') +
        '</div>';

      if (!isAI) {
        var input = YS.buildCellInput(meta, null, false);
        input.style.cssText += ';width:100%;box-sizing:border-box';
        input.dataset.col = col;
        input.placeholder = meta.allowNull ? 'NULL' : '';
        field.appendChild(input);
        fields.push({ col: col, input: input, meta: meta });
      }
      body.appendChild(field);
    });

    function doClose() { overlay.remove(); }
    overlay.addEventListener('click', function(e){ if(e.target===overlay) doClose(); });
    modal.querySelector('#ysql-ins-close').addEventListener('click', doClose);
    modal.querySelector('#ysql-ins-cancel').addEventListener('click', doClose);

    modal.querySelector('#ysql-ins-save').addEventListener('click', async function() {
      var values = {};
      fields.forEach(function(f) {
        var v = YS.getCellInputValue(f.input, f.meta);
        values[f.col] = (v === '' && f.meta.allowNull) ? null : v;
      });
      var btn = this; btn.disabled = true; btn.textContent = 'Inserting…';
      var r = await YS.api('/insert-row', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, values: values
      }}).catch(function(){return {};});
      if (r.ok) {
        YS.toast('Row inserted', 'success'); if (YS.tabs) YS.tabs.markDirty();
        doClose();
        YS.browse._reload(null, content);
      } else {
        var err = modal.querySelector('#ysql-ins-error');
        err.textContent = r.detail || r.error || 'Insert failed';
        err.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Insert';
      }
    });

    setTimeout(function() {
      var first = body.querySelector('input,textarea,select');
      if (first) first.focus();
    }, 50);
  }

  return { show };
})();


YS.bulkEdit = (() => {

  function open(container, content) {
    var sel = YS.state.selection;
    var columns = Object.keys(YS.state.colMeta);
    var colMeta = YS.state.colMeta;
    var count = sel.mode === 'all' ? YS.state.totalRows : sel.pageRows.length;
    var snapConn = YS.state.activeConn;
    var snapDb = YS.state.activeDb;
    var snapTable = YS.state.activeTable;
    if (!count) return;
    var esc = YS.escHtml;

    var overlay = document.createElement('div');
    overlay.id = 'ysql-bulk-overlay';
    overlay.style.cssText = 'position:absolute;inset:0;z-index:900;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:16px';

    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(480px,100%);max-height:85vh;display:flex;flex-direction:column;box-shadow:var(--shadow)';
    modal.innerHTML =
      '<div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">' +
        '<span style="font-weight:600;font-size:.9rem;flex:1">Edit ' + count + ' row' + (count!==1?'s':'') + '</span>' +
        '<button id="ysql-bem-close" class="s-btn s-btn-sm">✕</button>' +
      '</div>' +
      '<div id="ysql-bem-body" style="overflow-y:auto;flex:1;padding:12px 16px;display:flex;flex-direction:column;gap:6px"></div>' +
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--border);flex-shrink:0">' +
        '<button id="ysql-bem-delete" class="s-btn s-btn-sm" style="color:#f38ba8">Delete ' + count + ' row' + (count!==1?'s':'') + '</button>' +
        '<span style="flex:1"></span>' +
        '<button id="ysql-bem-cancel" class="s-btn s-btn-sm">Cancel</button>' +
        '<button id="ysql-bem-save" class="s-btn s-btn-sm" style="background:var(--accent);color:#fff;border-color:var(--accent)">Apply</button>' +
      '</div>';

    overlay.appendChild(modal);
    container.style.position = 'relative';
    container.appendChild(overlay);

    var body = modal.querySelector('#ysql-bem-body');

    columns.forEach(function(col) {
      var meta = colMeta[col] || {};
      var isPK = meta.key === 'PRI';
      var isNum = YS.isNumericType(meta.baseType || '');

      var field = document.createElement('div');
      field.style.cssText = 'display:flex;flex-direction:column;gap:3px';
      field.dataset.col = col;

      field.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:.78rem;color:var(--text-dim);font-weight:500">' + esc(col) + '</span>' +
          '<span style="font-size:.68rem;color:var(--text-dim);background:var(--surface2,var(--border));padding:1px 5px;border-radius:3px">' + esc(meta.baseType||'') + '</span>' +
          (isPK ? '<span style="font-size:.65rem;color:var(--text-dim)">PK — skip</span>' : '') +
        '</div>';

      if (!isPK) {
        var opts = '<option value="original">— keep original —</option>' +
          '<option value="set">Set value</option>' +
          (isNum ? '<option value="inc">Increment +</option><option value="dec">Decrement −</option>' : '') +
          (meta.allowNull ? '<option value="null">Set NULL</option>' : '');
        var modeEl = Object.assign(document.createElement('select'), { className: 's-input bulk-mode', innerHTML: opts });
        modeEl.style.cssText = 'font-size:.8rem;margin-bottom:3px';

        var valWrap = document.createElement('div');
        modeEl.addEventListener('change', function() {
          valWrap.innerHTML = '';
          if (modeEl.value === 'set') {
            var inp = YS.buildCellInput(meta, null, false);
            inp.style.cssText += ';width:100%;box-sizing:border-box';
            inp.className += ' bulk-val-input';
            valWrap.appendChild(inp);
          } else if (modeEl.value === 'inc' || modeEl.value === 'dec') {
            valWrap.innerHTML = '<input type="number" min="0" step="any" value="1" class="s-input bulk-val-input" style="width:100px">';
          }
        });

        field.appendChild(modeEl);
        field.appendChild(valWrap);
      }

      body.appendChild(field);
    });

    function doClose() { overlay.remove(); }
    overlay.addEventListener('click', function(e){ if(e.target===overlay) doClose(); });
    modal.querySelector('#ysql-bem-close').addEventListener('click', doClose);
    modal.querySelector('#ysql-bem-cancel').addEventListener('click', doClose);

    // Bulk delete
    modal.querySelector('#ysql-bem-delete').addEventListener('click', async function() {
      if (!confirm('Delete ' + count + ' rows? This cannot be undone.')) return;
      var btn = this; btn.disabled = true; btn.textContent = 'Deleting…';
      var r = await YS.api('/bulk-delete', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, mode: sel.mode,
        where_rows: sel.mode === 'page' ? sel.pageRows.map(function(row){ return YS.buildWhereFromRow(row, colMeta); }) : null
      }}).catch(function(){return {};});
      if (r.ok) {
        YS.toast('Deleted ' + (r.affected||count) + ' rows', 'success');
        if (YS.tabs) YS.tabs.markDirty();
        doClose();
        YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
        YS.browse._reload(null, content);
      } else {
        YS.toast('Error: ' + (r.detail||r.error||'failed'), 'error');
        btn.disabled = false; btn.textContent = 'Delete ' + count + ' rows';
      }
    });

    // Bulk save
    modal.querySelector('#ysql-bem-save').addEventListener('click', async function() {
      var updates = {};
      var hasChanges = false;
      body.querySelectorAll('[data-col]').forEach(function(field) {
        var col = field.dataset.col;
        var mode = (field.querySelector('.bulk-mode') || {}).value;
        if (!mode || mode === 'original') return;
        hasChanges = true;
        var inp = field.querySelector('.bulk-val-input');
        if (mode === 'null') updates[col] = { op: 'set', value: null };
        else if (mode === 'inc') updates[col] = { op: 'increment', value: parseFloat(inp && inp.value || '1') };
        else if (mode === 'dec') updates[col] = { op: 'decrement', value: parseFloat(inp && inp.value || '1') };
        else updates[col] = { op: 'set', value: inp ? YS.getCellInputValue(inp, colMeta[col]||{}) : '' };
      });
      if (!hasChanges) { YS.toast('No changes to apply', 'error'); return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      var r = await YS.api('/bulk-update', { method: 'POST', json: {
        conn_id: snapConn.id, database: snapDb,
        table: snapTable, updates: updates, mode: sel.mode,
        where_rows: sel.mode === 'page' ? sel.pageRows.map(function(row){ return YS.buildWhereFromRow(row, colMeta); }) : null
      }}).catch(function(){return {};});
      if (r.ok) {
        YS.toast('Updated ' + (r.affected||'') + ' rows', 'success');
        if (YS.tabs) YS.tabs.markDirty();
        doClose();
        YS.state.selection = { mode: 'none', pageRows: [], indexSet: new Set() };
        YS.browse._reload(null, content);
      } else {
        YS.toast('Error: ' + (r.detail||r.error||'failed'), 'error');
        btn.disabled = false; btn.textContent = 'Apply';
      }
    });
  }

  return { open };
})();
