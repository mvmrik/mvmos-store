// YourSQL — MySQL Manager for mvmOS v1.0.0

mvmOS.registerApp({
  id: 'yoursql',
  name: 'YourSQL',
  icon: '🗄️',
  category: 'Administration',
  width: 1100,
  height: 680,
  minWidth: 700,
  minHeight: 400,

  launch() {
    mvmOS.createWindow({
      id: 'yoursql',
      title: 'YourSQL',
      icon: '🗄️',
      width: 1100,
      height: 680,
      minWidth: 700,
      minHeight: 400,
      onMount: (body) => {
        body.innerHTML = '<div style="padding:20px">YourSQL loading...</div>';
        _ysqlInit(body);
      }
    });
  }
});

function _ysqlInit(container) {
  const BASE = '/apps/yoursql/';
  const MODULES = ['state.js', 'ui.js', 'dbtype.js', 'connections.js', 'sidebar.js', 'browse.js', 'filters.js', 'row-edit.js', 'structure.js', 'create-table.js', 'manage-tables.js', 'query.js', 'tabs.js'];

  MODULES.reduce(function(p, mod) {
    return p.then(function() {
      return new Promise(function(resolve, reject) {
        if (document.querySelector('script[data-ysql="' + mod + '"]')) { resolve(); return; }
        var s = document.createElement('script');
        s.src = BASE + mod + '?_=' + Date.now();
        s.dataset.ysql = mod;
        s.onload = resolve;
        s.onerror = function() { reject(new Error('Failed: ' + mod)); };
        document.head.appendChild(s);
      });
    });
  }, Promise.resolve()).then(function() {
    window.YS = window.YS || {};
    _ysqlRenderApp(container);
  }).catch(function(e) {
    container.innerHTML = '<div style="padding:20px;color:red">Error: ' + e.message + '</div>';
  });
}

function _ysqlRenderApp(container) {
  if (!window.YS) { container.innerHTML = '<div style="padding:20px;color:red">YS modules not loaded</div>'; return; }
  YS.state.activeConn = null;
  YS.state.activeDb = null;
  YS.state.activeTable = null;

  container.innerHTML = [
    '<div style="display:flex;height:100%;overflow:hidden;position:relative">',
    '  <div id="ysql-sidebar" class="as-sidebar" style="width:220px;min-width:180px;max-width:300px;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0">',
    '    <div style="padding:8px;border-bottom:1px solid var(--border);display:flex;gap:6px">',
    '      <button class="s-btn s-btn-sm" id="ysql-add-conn" style="flex:1">＋ Connection</button>',
    '    </div>',
    '    <div id="ysql-conn-list" style="overflow-y:auto;flex:1"></div>',
    '    <div id="ysql-db-section" style="border-top:1px solid var(--border);padding:8px;flex-shrink:0;display:none">',
    '      <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Database</div>',
    '      <select id="ysql-db-select" class="s-input" style="width:100%;font-size:.82rem"><option value="">— select —</option></select>',
    '    </div>',
    '  </div>',
    '  <div id="ysql-main" style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0">',
    '    <div id="ysql-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border);flex-shrink:0">',
    '      <span id="ysql-breadcrumb" style="font-size:.82rem;color:var(--text-dim);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0"></span>',
    '      <div id="ysql-db-actions" style="display:none;align-items:center;gap:4px">',
    '        <div style="position:relative">',
    '          <button class="s-btn s-btn-sm" id="ysql-btn-actions">Actions ▾</button>',
    '          <div id="ysql-actions-menu" style="display:none;position:absolute;right:0;top:100%;margin-top:2px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,4px);box-shadow:var(--shadow);z-index:200;min-width:160px;padding:4px 0">',
    '            <div class="ys-action-item" id="ysql-action-create-table">Create Table</div>',
    '            <div class="ys-action-item" id="ysql-action-import">Import</div>',
    '            <div class="ys-action-item" id="ysql-action-export">Export</div>',
    '            <div class="ys-action-item" id="ysql-action-manage-tables">Manage Tables</div>',
    '            <div class="ys-action-item" id="ysql-action-sql-editor">SQL Editor</div>',
    '          </div>',
    '        </div>',
    '        <label class="s-btn s-btn-sm" style="display:none"><input type="file" id="ysql-import-file-top" accept=".csv,.sql" style="display:none"></label>',
    '      </div>',
    '      <div id="ysql-table-actions" style="display:none;align-items:center;gap:4px">',
    '        <button class="s-btn s-btn-sm" id="ysql-btn-structure-top">Structure</button>',
    '      </div>',
    '    </div>',
    '    <div id="ysql-tabbar" style="display:none;flex-shrink:0;overflow-x:auto;overflow-y:hidden;border-bottom:1px solid var(--border);background:var(--surface);flex-wrap:nowrap;align-items:stretch;min-height:30px"></div>',
    '    <div id="ysql-content" style="flex:1;overflow:hidden;display:flex"></div>',
    '  </div>',
    '</div>'
  ].join('');

  // Action menu item style
  var styleEl = document.createElement('style');
  styleEl.textContent = '.ys-action-item{padding:7px 14px;font-size:.82rem;cursor:pointer;white-space:nowrap;color:var(--text)}.ys-action-item:hover{background:var(--hover,rgba(255,255,255,.06))}';
  container.appendChild(styleEl);

  YS.tabs.init(container);
  YS.connections.load(container);

  container.querySelector('#ysql-add-conn').addEventListener('click', function() { YS.connections.openDialog(container); });

  container.querySelector('#ysql-db-select').addEventListener('change', function() {
    YS.state.activeDb = this.value || null;
    YS.state.activeTable = null;
    YS.sidebar.loadTables(container).then(function() {
      YS.browse.showWelcome(container);
      if (YS.updateTopToolbar) YS.updateTopToolbar(container);
    });
  });

  // Structure/Data toggle button
  container.querySelector('#ysql-btn-structure-top').addEventListener('click', function() {
    if (!YS.state.activeTable) return;
    if (this.textContent === 'Structure') {
      if (YS.tabs) YS.tabs.open('structure', YS.state.activeDb, YS.state.activeTable);
      else YS.structure.show(container, container.querySelector('#ysql-content'));
    } else {
      if (YS.tabs) YS.tabs.open('browse', YS.state.activeDb, YS.state.activeTable);
      else YS.browse.show(container);
    }
  });

  // Actions dropdown toggle
  var actionsBtn = container.querySelector('#ysql-btn-actions');
  var actionsMenu = container.querySelector('#ysql-actions-menu');
  actionsBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var open = actionsMenu.style.display === 'block';
    actionsMenu.style.display = open ? 'none' : 'block';
  });
  container.addEventListener('click', function(e) {
    if (!actionsBtn.contains(e.target)) actionsMenu.style.display = 'none';
  });

  // Actions menu items
  container.querySelector('#ysql-action-manage-tables').addEventListener('click', function() {
    actionsMenu.style.display = 'none';
    if (!YS.state.activeDb) return;
    YS.manageTables.show(container);
  });
  container.querySelector('#ysql-action-sql-editor').addEventListener('click', function() {
    actionsMenu.style.display = 'none';
    YS.tabs.openQuery(container);
  });
  container.querySelector('#ysql-action-create-table').addEventListener('click', function() {
    actionsMenu.style.display = 'none';
    if (!YS.state.activeDb) return;
    YS.createTable.show(container);
  });
  container.querySelector('#ysql-action-export').addEventListener('click', function() {
    actionsMenu.style.display = 'none';
    if (!YS.state.activeDb) return;
    _openExportDialog(container);
  });
  container.querySelector('#ysql-action-import').addEventListener('click', function() {
    actionsMenu.style.display = 'none';
    container.querySelector('#ysql-import-file-top').click();
  });
  container.querySelector('#ysql-import-file-top').addEventListener('change', function(e) {
    var file = e.target.files[0]; if (!file) return;
    var content = container.querySelector('#ysql-content');
    var connId = YS.state.activeConn.id;
    var database = YS.state.activeDb;
    mvmOS.upload.start({
      file: file,
      accept: ['.sql', '.csv'],
      chunkEndpoint: '/api/files/upload-chunk',
      cancelEndpoint: '/api/files/upload-chunk',
      fields: { path: '/tmp' },
      noFinalize: true,
      onDone: function(data) {
        mvmOS.upload.setStatus('⏳ Импортиране в базата...', true);
        YS.sidebar.setDbSpinner(container, database, true);
        fetch('/api/apps/yoursql/import-from-path', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conn_id: connId, database: database, tmp_path: data.tmp_path, filename: file.name }),
        }).then(function(r) { return r.json(); }).then(function(r) {
          if (!r.job_id) {
            mvmOS.upload.clearStatus();
            YS.sidebar.setDbSpinner(container, database, false);
            YS.toast('Import failed: no job', 'error'); return;
          }
          var poll = setInterval(function() {
            fetch('/api/apps/yoursql/import-status/' + r.job_id)
              .then(function(r2) { return r2.json(); })
              .then(function(job) {
                if (job.status === 'running') return;
                clearInterval(poll);
                mvmOS.upload.clearStatus();
                YS.sidebar.setDbSpinner(container, database, false);
                if (job.status === 'done') {
                  YS.toast('Imported ' + job.affected + ' statements', 'success');
                  YS.sidebar.loadTables(container);
                } else {
                  YS.toast('Import failed: ' + (job.detail || 'Unknown error'), 'error');
                }
              }).catch(function() {
                clearInterval(poll);
                mvmOS.upload.clearStatus();
                YS.sidebar.setDbSpinner(container, database, false);
              });
          }, 2000);
        }).catch(function(err) {
          mvmOS.upload.clearStatus();
          YS.sidebar.setDbSpinner(container, database, false);
          YS.toast('Import failed: ' + err.message, 'error');
        });
      },
      onError: function(msg) { YS.toast('Import failed: ' + msg, 'error'); },
      onCancel: function() { YS.toast('Import cancelled', 'info'); },
    });
    e.target.value = '';
  });

  async function _openExportDialog(container) {
    // Load table list for active db
    var tables = [];
    try { tables = await YS.api('/tables?conn_id=' + YS.state.activeConn.id + '&database=' + encodeURIComponent(YS.state.activeDb)); } catch(e) {}
    if (!Array.isArray(tables)) tables = [];

    var modal = YS.modal(container, '', { width: 'min(440px,96%)', maxHeight: '80vh' });
    var m = modal;
    m.style.minWidth = '340px';

    // Title
    var title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:.95rem';
    title.textContent = 'Export — ' + YS.state.activeDb;
    m.appendChild(title);

    // Mode
    var modeWrap = document.createElement('div');
    modeWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    var modeLabel = document.createElement('div');
    modeLabel.style.cssText = 'font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em';
    modeLabel.textContent = 'MODE';
    modeWrap.appendChild(modeLabel);
    var modes = [['structure_data','Structure + Data'],['structure','Structure only'],['data','Data only']];
    var modeVal = 'structure_data';
    modes.forEach(function(mo) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:.85rem;cursor:pointer';
      var rb = document.createElement('input');
      rb.type = 'radio'; rb.name = 'ysql-export-mode'; rb.value = mo[0];
      if (mo[0] === modeVal) rb.checked = true;
      rb.addEventListener('change', function() { modeVal = this.value; });
      lbl.appendChild(rb); lbl.appendChild(document.createTextNode(mo[1]));
      modeWrap.appendChild(lbl);
    });
    m.appendChild(modeWrap);

    // Tables
    var tblWrap = document.createElement('div');
    tblWrap.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    var tblHeader = document.createElement('div');
    tblHeader.style.cssText = 'display:flex;align-items:center;justify-content:space-between';
    var tblLabel = document.createElement('div');
    tblLabel.style.cssText = 'font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.06em';
    tblLabel.textContent = 'TABLES';
    var allLbl = document.createElement('label');
    allLbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer';
    var allCk = document.createElement('input'); allCk.type = 'checkbox'; allCk.checked = true;
    allLbl.appendChild(allCk); allLbl.appendChild(document.createTextNode('All tables'));
    tblHeader.appendChild(tblLabel); tblHeader.appendChild(allLbl);
    tblWrap.appendChild(tblHeader);

    var tblList = document.createElement('div');
    tblList.style.cssText = 'max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg)';
    var checkboxes = [];
    tables.forEach(function(t) {
      var lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:.83rem;cursor:pointer';
      var ck = document.createElement('input'); ck.type = 'checkbox'; ck.checked = true; ck.value = t;
      checkboxes.push(ck);
      lbl.appendChild(ck); lbl.appendChild(document.createTextNode(t));
      tblList.appendChild(lbl);
    });
    allCk.addEventListener('change', function() { checkboxes.forEach(function(c){ c.checked = allCk.checked; }); });
    tblWrap.appendChild(tblList);
    m.appendChild(tblWrap);

    // Bottom row: format select + zip checkbox + download button
    var bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px';

    var fmtSel = document.createElement('select');
    fmtSel.className = 's-input';
    fmtSel.style.cssText = 'font-size:.82rem;padding:4px 8px;width:80px';
    ['sql','csv'].forEach(function(f) {
      var o = document.createElement('option'); o.value = f; o.textContent = f.toUpperCase();
      fmtSel.appendChild(o);
    });
    bottomRow.appendChild(fmtSel);

    var zipLbl = document.createElement('label');
    zipLbl.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:.82rem;cursor:pointer';
    var zipCk = document.createElement('input'); zipCk.type = 'checkbox';
    zipLbl.appendChild(zipCk); zipLbl.appendChild(document.createTextNode('ZIP'));
    bottomRow.appendChild(zipLbl);

    var spacer = document.createElement('span'); spacer.style.flex = '1';
    bottomRow.appendChild(spacer);

    var dlBtn = document.createElement('button');
    dlBtn.className = 's-btn s-btn-sm';
    dlBtn.style.cssText = 'background:var(--accent);color:#fff;border-color:var(--accent);display:flex;align-items:center;gap:5px';
    dlBtn.innerHTML = '⬇ Download';
    dlBtn.addEventListener('click', function() {
      var selected = checkboxes.filter(function(c){ return c.checked; }).map(function(c){ return c.value; });
      if (!selected.length) { YS.toast('Select at least one table', 'error'); return; }
      var fmt = fmtSel.value;
      var zip = zipCk.checked;
      var url = '/api/apps/yoursql/export-multi?conn_id=' + YS.state.activeConn.id +
        '&database=' + encodeURIComponent(YS.state.activeDb) +
        '&tables=' + encodeURIComponent(selected.join(',')) +
        '&format=' + fmt + '&mode=' + modeVal + '&zip=' + (zip ? '1' : '0');
      var ext = zip ? 'zip' : fmt;
      var filename = YS.state.activeDb + '.' + ext;
      modal.close();
      fetch(url, { credentials: 'include' }).then(function(r) {
        if (!r.ok) { r.text().then(function(t){ YS.toast('Export failed: ' + t, 'error'); }); return; }
        return r.blob();
      }).then(function(blob) {
        if (!blob) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
      }).catch(function(e){ YS.toast('Export failed: ' + e.message, 'error'); });
    });
    bottomRow.appendChild(dlBtn);
    m.appendChild(bottomRow);
  }

  // Show/hide table actions and update Structure↔Data label
  YS.updateTopToolbar = function(container) {
    var dbActionsDiv = container.querySelector('#ysql-db-actions');
    var tableActionsDiv = container.querySelector('#ysql-table-actions');
    var structBtn = container.querySelector('#ysql-btn-structure-top');
    var exportItem = container.querySelector('#ysql-action-export');
    if (!dbActionsDiv || !tableActionsDiv || !structBtn) return;
    var activeTab = YS.tabs && YS.tabs.activeTab();
    var isQueryTab = activeTab && activeTab.type === 'query';
    var hasDb = !!(YS.state.activeDb) && !isQueryTab;
    var hasTable = !!(YS.state.activeTable) && !isQueryTab;
    dbActionsDiv.style.display = hasDb ? 'flex' : 'none';
    tableActionsDiv.style.display = hasTable ? 'flex' : 'none';

    var isStructure = false;
    if (YS.tabs) {
      var t = YS.tabs.activeTab();
      isStructure = t && t.type === 'structure';
    }
    structBtn.textContent = isStructure ? 'Data' : 'Structure';
  };

  // re-run desktop.js mobile sidebar init — our onMount is async so
  // the first call (at createWindow time) ran before .as-sidebar existed
  mvmOS.initMobileSidebar(container);

}
