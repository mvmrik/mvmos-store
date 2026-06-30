// YourSQL — Sidebar: database selector + table list

YS.sidebar = (() => {

  async function loadTables(container) {
    container.querySelectorAll('.ysql-table-item').forEach(e => e.remove());
    if (!YS.state.activeConn || !YS.state.activeDb) return;

    const db = YS.state.activeDb;
    const tables = await YS.api(`/tables?conn_id=${YS.state.activeConn.id}&database=${encodeURIComponent(db)}`).catch(() => []);
    const list = container.querySelector('#ysql-conn-list');

    // Folder header
    const header = document.createElement('div');
    header.className = 'ysql-table-item';
    header.style.cssText = 'padding:6px 10px;font-size:.78rem;font-weight:500;color:var(--text-dim);border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer;display:flex;align-items:center;gap:5px;user-select:none';
    header.innerHTML = `<span class="ysql-folder-arrow" style="font-size:.65rem;transform:rotate(90deg);transition:transform .15s">▶</span><span>📂 ${db}</span>`;
    list.appendChild(header);

    // Tables wrapper — visible by default (auto-expanded)
    const tablesWrap = document.createElement('div');
    tablesWrap.className = 'ysql-table-item';
    list.appendChild(tablesWrap);

    header.addEventListener('click', () => {
      const open = tablesWrap.style.display !== 'none';
      tablesWrap.style.display = open ? 'none' : 'block';
      header.querySelector('.ysql-folder-arrow').style.transform = open ? '' : 'rotate(90deg)';
    });

    (Array.isArray(tables) ? tables : []).forEach(t => {
      const row = document.createElement('div');
      row.className = 'ys-table-item';
      const isActive = YS.state.activeTable === t;
      row.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 10px 5px 28px;cursor:pointer;font-size:.82rem;background:${isActive ? 'var(--accent)' : ''}; color:${isActive ? '#fff' : ''}`;
      row.innerHTML = `<span style="color:${isActive ? '#fff' : 'var(--text-dim)'}">▤</span><span>${t}</span>`;
      row.dataset.table = t;
      row.dataset.db = db;
      row.addEventListener('click', () => {
        const bc = container.querySelector('#ysql-breadcrumb');
        if (bc) bc.textContent = (YS.state.activeConn?.name || '') + ' › ' + db + ' › ' + t;

        const sidebar = container.querySelector('.as-sidebar');
        if (sidebar && sidebar.classList.contains('mobile-open')) {
          sidebar.classList.remove('mobile-open');
          container.querySelector('.as-sidebar-overlay')?.remove();
        }

        YS.state.activeTable = t;
        if (YS.updateTopToolbar) YS.updateTopToolbar(container);
        if (YS.tabs) {
          YS.tabs.open('browse', db, t);
        } else {
          YS.browse.show(container);
        }
      });
      tablesWrap.appendChild(row);
    });
  }

  function setDbSpinner(container, db, active) {
    const list = container?.querySelector('#ysql-conn-list');
    if (!list) return;
    list.querySelectorAll('.ysql-table-item').forEach(el => {
      const span = el.querySelector('span:last-child');
      if (!span || !span.textContent.includes(db)) return;
      const arrow = el.querySelector('.ysql-folder-arrow');
      if (!arrow) return;
      if (active) {
        arrow.textContent = '⏳';
        arrow.style.transform = '';
        arrow.style.animation = 'ysql-spin 1s linear infinite';
      } else {
        arrow.textContent = '▶';
        arrow.style.transform = 'rotate(90deg)';
        arrow.style.animation = '';
      }
    });
  }

  // inject keyframe once
  if (!document.getElementById('ysql-spin-style')) {
    const s = document.createElement('style');
    s.id = 'ysql-spin-style';
    s.textContent = '@keyframes ysql-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }

  return { loadTables, setDbSpinner };
})();
