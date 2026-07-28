// YourSQL — Connection management

const _ysqlConnT = window.t || (k => k);

YS.connections = (() => {

  async function load(container) {
    const res = await YS.api('/connections').catch(() => []);
    YS.state.connections = Array.isArray(res) ? res : [];
    renderList(container);
  }

  function renderList(container) {
    const list = container.querySelector('#ysql-conn-list');
    if (!list) return;
    list.innerHTML = '';

    if (!YS.state.connections.length) {
      list.innerHTML = `<div style="padding:16px;color:var(--text-dim);font-size:.82rem;text-align:center">${_ysqlConnT('ysql_no_connections_yet')}</div>`;
      return;
    }

    const active = YS.state.connections.find(c => c.id === YS.state.activeConn?.id) || null;

    if (!active) {
      // No active connection — show all
      YS.state.connections.forEach(c => {
        const isB = !!c.builtin;
        const item = document.createElement('div');
        item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border)';
        item.innerHTML = `
          <span style="font-size:1rem">${isB ? '📦' : '🔌'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
            <div style="font-size:.75rem;color:var(--text-dim)">${isB ? _ysqlConnT('ysql_sqlite_local_apps') : YS.dbtype.labelOf(c.db_type) + ' · ' + c.db_user + '@' + c.host + ':' + c.port}</div>
          </div>
          ${isB ? '' : `<button class="s-btn s-btn-sm ysql-edit-conn" style="font-size:.7rem;padding:2px 6px">✎</button>`}
        `;
        item.addEventListener('click', e => {
          if (e.target.classList.contains('ysql-edit-conn')) return;
          connect(container, c);
        });
        if (!isB) {
          item.querySelector('.ysql-edit-conn').addEventListener('click', e => {
            e.stopPropagation();
            openDialog(container, c);
          });
        }
        list.appendChild(item);
      });
      return;
    }

    // Active connection — show only it + dropdown to switch
    const isBuiltin = !!active.builtin;
    const activeRow = document.createElement('div');
    activeRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border);background:var(--accent-dim,rgba(99,102,241,.15));user-select:none';
    activeRow.innerHTML = `
      <span style="font-size:1rem">${isBuiltin ? '📦' : '🔌'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${active.name}</div>
        <div style="font-size:.75rem;color:var(--text-dim)">${isBuiltin ? _ysqlConnT('ysql_sqlite_local_apps') : YS.dbtype.labelOf(active.db_type) + ' · ' + active.db_user + '@' + active.host + ':' + active.port}</div>
      </div>
      <span id="ysql-conn-chevron" style="font-size:.65rem;color:var(--text-dim)">▾</span>
      ${isBuiltin ? '' : `<button class="s-btn s-btn-sm ysql-create-db" title="${_ysqlConnT('ysql_new_database')}" style="font-size:.7rem;padding:2px 6px">＋</button>`}
      ${isBuiltin ? '' : `<button class="s-btn s-btn-sm ysql-edit-conn" style="font-size:.7rem;padding:2px 6px">✎</button>`}
    `;
    if (!isBuiltin) {
      activeRow.querySelector('.ysql-create-db').addEventListener('click', e => {
        e.stopPropagation();
        createDatabase(container, active);
      });
      activeRow.querySelector('.ysql-edit-conn').addEventListener('click', e => {
        e.stopPropagation();
        openDialog(container, active);
      });
    }

    const dropdown = document.createElement('div');
    dropdown.style.cssText = 'display:none;border-bottom:1px solid var(--border)';
    YS.state.connections.filter(c => c.id !== active.id).forEach(c => {
      const isB = !!c.builtin;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px 7px 14px;cursor:pointer;font-size:.83rem';
      row.innerHTML = `
        <span>${isB ? '📦' : '🔌'}</span>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name}</div>
        ${isB ? '' : `<button class="s-btn s-btn-sm ysql-edit-conn" style="font-size:.7rem;padding:2px 6px">✎</button>`}
      `;
      row.addEventListener('mouseenter', () => row.style.background = 'var(--hover,rgba(255,255,255,.05))');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', e => {
        if (e.target.classList.contains('ysql-edit-conn')) return;
        dropdown.style.display = 'none';
        connect(container, c);
      });
      if (!isB) {
        row.querySelector('.ysql-edit-conn').addEventListener('click', e => {
          e.stopPropagation();
          dropdown.style.display = 'none';
          openDialog(container, c);
        });
      }
      dropdown.appendChild(row);
    });

    activeRow.addEventListener('click', e => {
      if (e.target.classList.contains('ysql-edit-conn')) return;
      const open = dropdown.style.display !== 'none';
      dropdown.style.display = open ? 'none' : 'block';
      activeRow.querySelector('#ysql-conn-chevron').textContent = open ? '▾' : '▴';
    });

    list.appendChild(activeRow);
    list.appendChild(dropdown);
  }

  async function connect(container, c) {
    YS.state.activeConn = c;
    YS.state.activeDb = c.database || null;
    YS.state.activeTable = null;
    renderList(container);

    const dbSection = container.querySelector('#ysql-db-section');
    const bc = container.querySelector('#ysql-breadcrumb');
    if (bc) bc.textContent = c.name;

    if (c.builtin) {
      const ok = await mvmOS.requireRoot('YourSQL', _ysqlConnT('ysql_root_required_system_db'));
      if (!ok) { YS.state.activeConn = null; renderList(container); return; }
      if (dbSection) dbSection.style.display = 'none';
      let dbs = [];
      try { dbs = await YS.api(`/databases?conn_id=${c.id}`); } catch(e) {}
      await _loadDbsAsFolders(container, c, Array.isArray(dbs) ? dbs : []);
      YS.browse.showWelcome(container);
      return;
    }

    if (dbSection) dbSection.style.display = 'none';

    let dbs = [];
    try {
      dbs = await YS.api(`/databases?conn_id=${c.id}`);
    } catch(e) {
      alert(_ysqlConnT('ysql_cannot_connect', { msg: (e?.message || e) }));
      return;
    }

    await _loadDbsAsFolders(container, c, Array.isArray(dbs) ? dbs : []);
    YS.browse.showWelcome(container);
  }

  async function _loadDbsAsFolders(container, c, dbs) {
    container.querySelectorAll('.ysql-table-item').forEach(e => e.remove());
    if (!dbs.length) return;
    const list = container.querySelector('#ysql-conn-list');

    for (const db of dbs) {
      const header = document.createElement('div');
      header.className = 'ysql-table-item';
      header.style.cssText = 'padding:6px 10px;font-size:.78rem;font-weight:500;color:var(--text-dim);border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none';
      header.innerHTML = `<span class="ysql-folder-arrow" style="font-size:.65rem;transition:transform .15s">▶</span><span>📂 ${db}</span>`;
      list.appendChild(header);

      const tablesWrap = document.createElement('div');
      tablesWrap.className = 'ysql-table-item';
      tablesWrap.style.display = 'none';
      list.appendChild(tablesWrap);

      header.addEventListener('contextmenu', e => {
        e.preventDefault();
        _showDbContextMenu(container, c, db, e.clientX, e.clientY);
      });

      header.addEventListener('click', async () => {
        const isOpen = tablesWrap.style.display !== 'none';
        if (isOpen) {
          tablesWrap.style.display = 'none';
          header.querySelector('.ysql-folder-arrow').style.transform = '';
          return;
        }
        header.querySelector('.ysql-folder-arrow').style.transform = 'rotate(90deg)';
        tablesWrap.style.display = 'block';
        YS.state.activeDb = db;
        YS.state.activeTable = null;
        if (YS.updateTopToolbar) YS.updateTopToolbar(container);
        if (tablesWrap.dataset.loaded) return;
        tablesWrap.dataset.loaded = '1';
        let tables = [];
        try { tables = await YS.api(`/tables?conn_id=${c.id}&database=${encodeURIComponent(db)}`); } catch(e) {}

        tablesWrap.innerHTML = '';
        (Array.isArray(tables) ? tables : []).forEach(t => {
          const row = document.createElement('div');
          row.className = 'ys-table-item';
          row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px 5px 28px;cursor:pointer;font-size:.82rem';
          row.innerHTML = `<span style="color:var(--text-dim)">▤</span><span>${t}</span>`;
          row.dataset.table = t;
          row.dataset.db = db;
          row.addEventListener('click', () => {
            YS.state.activeDb = db;
            YS.state.activeTable = t;
            const bc = container.querySelector('#ysql-breadcrumb');
            if (bc) bc.textContent = c.name + ' › ' + db + ' › ' + t;
            const sidebar = container.querySelector('.as-sidebar');
            if (sidebar && sidebar.classList.contains('mobile-open')) {
              sidebar.classList.remove('mobile-open');
              container.querySelector('.as-sidebar-overlay')?.remove();
            }
            if (YS.updateTopToolbar) YS.updateTopToolbar(container);
            if (YS.tabs) YS.tabs.open('browse', db, t);
            else YS.browse.show(container);
          });
          tablesWrap.appendChild(row);
        });
      });
    }
  }

  async function _loadMvmApps(container, c) {
    // Remove old table items
    container.querySelectorAll('.ysql-table-item').forEach(e => e.remove());

    let dbs = [];
    try { dbs = await YS.api(`/databases?conn_id=${c.id}`); } catch(e) {}
    if (!Array.isArray(dbs) || !dbs.length) return;

    const list = container.querySelector('#ysql-conn-list');

    for (const db of dbs) {
      // App header row (folder, clickable to expand)
      const header = document.createElement('div');
      header.className = 'ysql-table-item';
      header.style.cssText = 'padding:6px 10px;font-size:.78rem;font-weight:500;color:var(--text-dim);border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none';
      header.dataset.mvmDb = db;
      header.innerHTML = `<span class="ysql-folder-arrow" style="font-size:.65rem;transition:transform .15s">▶</span><span>📂 ${db}</span>`;
      list.appendChild(header);

      // Tables container (hidden by default)
      const tablesWrap = document.createElement('div');
      tablesWrap.className = 'ysql-table-item';
      tablesWrap.dataset.mvmDbTables = db;
      tablesWrap.style.display = 'none';
      list.appendChild(tablesWrap);

      header.addEventListener('click', async () => {
        const isOpen = tablesWrap.style.display !== 'none';
        if (isOpen) {
          tablesWrap.style.display = 'none';
          header.querySelector('.ysql-folder-arrow').style.transform = '';
          return;
        }
        header.querySelector('.ysql-folder-arrow').style.transform = 'rotate(90deg)';
        tablesWrap.style.display = 'block';
        if (tablesWrap.dataset.loaded) return;
        tablesWrap.dataset.loaded = '1';

        let tables = [];
        try { tables = await YS.api(`/tables?conn_id=${c.id}&database=${encodeURIComponent(db)}`); } catch(e) {}

        tablesWrap.innerHTML = '';
        (Array.isArray(tables) ? tables : []).forEach(t => {
          const row = document.createElement('div');
          row.className = 'ys-table-item';
          row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px 5px 28px;cursor:pointer;font-size:.82rem';
          row.innerHTML = `<span style="color:var(--text-dim)">▤</span><span>${t}</span>`;
          row.dataset.table = t;
          row.dataset.db = db;
          row.addEventListener('click', () => {
            YS.state.activeDb = db;
            YS.state.activeTable = t;
            const bc = container.querySelector('#ysql-breadcrumb');
            if (bc) bc.textContent = c.name + ' › ' + db + ' › ' + t;
            if (YS.updateTopToolbar) YS.updateTopToolbar(container);
            if (YS.tabs) YS.tabs.open('browse', db, t);
            else YS.browse.show(container);
          });
          tablesWrap.appendChild(row);
        });
      });
    }
  }

  function _showDbContextMenu(container, c, db, x, y) {
    document.querySelectorAll('.ysql-ctx-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ysql-ctx-menu';
    menu.style.cssText = `position:fixed;z-index:99999;left:${x}px;top:${y}px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.35);min-width:150px;padding:4px 0;font-size:.83rem`;
    menu.innerHTML = `<div class="ysql-ctx-drop" style="padding:7px 14px;cursor:pointer;color:#f38ba8">${_ysqlConnT('ysql_delete_database_ctx')}</div>`;
    document.body.appendChild(menu);
    const close = () => menu.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    menu.querySelector('.ysql-ctx-drop').addEventListener('click', () => { close(); dropDatabase(container, c, db); });
  }

  function createDatabase(container, c) {
    const modal = YS.modal(container, `
      <div style="font-weight:600;font-size:.95rem">${_ysqlConnT('ysql_new_database_title')}</div>
      <input class="s-input" id="ys-newdb-name" placeholder="${_ysqlConnT('ysql_database_name_ph')}" autofocus>
      <div id="ys-newdb-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="s-btn" id="ys-newdb-cancel">${_ysqlConnT('ysql_cancel')}</button>
        <button class="s-btn" id="ys-newdb-ok" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_ysqlConnT('ysql_create')}</button>
      </div>
    `);
    modal.querySelector('#ys-newdb-cancel').addEventListener('click', () => modal.close());
    const inp = modal.querySelector('#ys-newdb-name');
    const save = async () => {
      const name = inp.value.trim();
      if (!name) return;
      try {
        const r = await YS.api('/create-database', { method: 'POST', json: { conn_id: c.id, name } });
        if (r.ok) { modal.close(); connect(container, c); }
        else throw new Error(r.detail || 'Error');
      } catch(e) {
        const err = modal.querySelector('#ys-newdb-err');
        err.textContent = e.message; err.style.display = 'block';
      }
    };
    modal.querySelector('#ys-newdb-ok').addEventListener('click', save);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  }

  async function dropDatabase(container, c, db) {
    const modal = YS.modal(container, `
      <div style="font-weight:600;font-size:.95rem">${_ysqlConnT('ysql_delete_database_title')}</div>
      <div style="font-size:.88rem">${_ysqlConnT('ysql_delete_database_confirm', { db: '<strong>' + db + '</strong>' })}</div>
      <div id="ys-dropdb-err" style="color:#f38ba8;font-size:.82rem;display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="s-btn" id="ys-dropdb-cancel">${_ysqlConnT('ysql_cancel')}</button>
        <button class="s-btn" id="ys-dropdb-ok" style="background:#f38ba8;color:#1e1e2e;border-color:#f38ba8">${_ysqlConnT('ysql_delete')}</button>
      </div>
    `);
    modal.querySelector('#ys-dropdb-cancel').addEventListener('click', () => modal.close());
    modal.querySelector('#ys-dropdb-ok').addEventListener('click', async () => {
      try {
        const r = await YS.api('/drop-database', { method: 'POST', json: { conn_id: c.id, name: db } });
        if (r.ok) {
          modal.close();
          if (YS.state.activeDb === db) { YS.state.activeDb = null; YS.state.activeTable = null; }
          connect(container, c);
        } else throw new Error(r.detail || 'Error');
      } catch(e) {
        const err = modal.querySelector('#ys-dropdb-err');
        err.textContent = e.message; err.style.display = 'block';
      }
    });
  }

  function openDialog(container, existing = null) {
    const dbType = existing?.db_type || 'mysql';
    const dbTypeOptions = YS.dbtype.DB_TYPES.map(t =>
      `<option value="${t.id}"${t.id === dbType ? ' selected' : ''}>${t.label}</option>`
    ).join('');

    const modal = YS.modal(container, `
      <div style="font-weight:600;font-size:.95rem">${existing ? _ysqlConnT('ysql_edit_connection') : _ysqlConnT('ysql_new_connection')}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input class="s-input" id="yc-name" placeholder="${_ysqlConnT('ysql_name_ph')}" value="${existing?.name || ''}">
        <select class="s-input" id="yc-dbtype">${dbTypeOptions}</select>
        <div id="yc-driver-status" style="display:none;font-size:.8rem;padding:6px 8px;border-radius:4px;align-items:center;gap:8px"></div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:6px">
          <input class="s-input" id="yc-host" placeholder="${_ysqlConnT('ysql_host_ph')}" value="${existing?.host || 'localhost'}">
          <input class="s-input" id="yc-port" placeholder="${_ysqlConnT('ysql_port_ph')}" value="${existing?.port || YS.dbtype.defaultPort(dbType)}" style="width:70px">
        </div>
        <input class="s-input" id="yc-user" placeholder="${_ysqlConnT('ysql_username_ph')}" value="${existing?.db_user || ''}">
        <input class="s-input" id="yc-pass" type="password" placeholder="${_ysqlConnT('ysql_password_ph')}">
        <input class="s-input" id="yc-db" placeholder="${_ysqlConnT('ysql_default_database_ph')}" value="${existing?.database || ''}">
      </div>
      <div id="yc-error" style="color:#f38ba8;font-size:.82rem;display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        ${existing ? `<button class="s-btn" id="yc-delete" style="margin-right:auto;color:#f38ba8">${_ysqlConnT('ysql_delete')}</button>` : ''}
        <button class="s-btn" id="yc-cancel">${_ysqlConnT('ysql_cancel')}</button>
        <button class="s-btn" id="yc-save" style="background:var(--accent);color:#fff;border-color:var(--accent)">${_ysqlConnT('ysql_save')}</button>
      </div>
    `);

    modal.querySelector('#yc-cancel').addEventListener('click', () => modal.close());

    if (existing) {
      modal.querySelector('#yc-delete').addEventListener('click', async () => {
        await YS.api(`/connections/${existing.id}`, { method: 'DELETE' });
        if (YS.state.activeConn?.id === existing.id) {
          YS.state.activeConn = null;
          YS.state.activeDb = null;
        }
        modal.close();
        load(container);
      });
    }

    const dbTypeSel = modal.querySelector('#yc-dbtype');
    const portInp = modal.querySelector('#yc-port');
    _checkDriverStatus(modal, dbTypeSel.value);
    dbTypeSel.addEventListener('change', () => {
      portInp.value = YS.dbtype.defaultPort(dbTypeSel.value);
      _checkDriverStatus(modal, dbTypeSel.value);
    });

    modal.querySelector('#yc-save').addEventListener('click', async () => {
      const body = {
        id: existing?.id,
        name: modal.querySelector('#yc-name').value.trim(),
        db_type: dbTypeSel.value,
        host: modal.querySelector('#yc-host').value.trim(),
        port: parseInt(modal.querySelector('#yc-port').value) || YS.dbtype.defaultPort(dbTypeSel.value),
        user: modal.querySelector('#yc-user').value.trim(),
        password: modal.querySelector('#yc-pass').value,
        database: modal.querySelector('#yc-db').value.trim(),
      };
      if (!body.name || !body.host || !body.user) {
        const err = modal.querySelector('#yc-error');
        err.textContent = _ysqlConnT('ysql_name_host_user_required');
        err.style.display = 'block';
        return;
      }
      // if editing and no password entered, send empty string → backend keeps existing
      const r = await YS.api('/connections', { method: 'POST', json: body });
      if (r.ok) { modal.close(); load(container); }
    });
  }

  async function _checkDriverStatus(modal, dbType) {
    const box = modal.querySelector('#yc-driver-status');
    if (!box) return;
    box.style.display = 'flex';
    box.style.background = 'var(--surface)';
    box.style.color = 'var(--text-dim)';
    box.innerHTML = _ysqlConnT('ysql_checking_driver');
    let res;
    try {
      res = await YS.api('/driver-status?db_type=' + encodeURIComponent(dbType));
    } catch (e) {
      box.style.display = 'none';
      return;
    }
    if (res && res.available) {
      box.style.display = 'none';
      return;
    }
    box.style.background = 'rgba(243,139,168,.12)';
    box.style.color = '#f38ba8';
    box.innerHTML = `<span style="flex:1">${_ysqlConnT('ysql_driver_not_installed', { package: res.package })}</span>` +
      `<button class="s-btn s-btn-sm" id="yc-install-driver" style="padding:2px 10px">${_ysqlConnT('ysql_install')}</button>`;
    box.querySelector('#yc-install-driver').addEventListener('click', async function() {
      const btn = this;
      const ok = await mvmOS.requireRoot('YourSQL', _ysqlConnT('ysql_root_required_driver'));
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = _ysqlConnT('ysql_installing');
      try {
        await YS.api('/install-driver', { method: 'POST', json: { db_type: dbType } });
        YS.toast && YS.toast(_ysqlConnT('ysql_driver_installed'), 'success');
        _checkDriverStatus(modal, dbType);
      } catch (e) {
        YS.toast ? YS.toast(_ysqlConnT('ysql_install_failed', { msg: e.message }), 'error') : alert(_ysqlConnT('ysql_install_failed', { msg: e.message }));
        btn.disabled = false;
        btn.textContent = _ysqlConnT('ysql_install');
      }
    });
  }

  return { load, renderList, connect, openDialog };
})();
