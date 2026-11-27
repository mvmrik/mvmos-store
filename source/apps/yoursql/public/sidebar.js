// YourSQL — Sidebar: database selector + table list

YS.sidebar = (() => {

  // Refreshes the open database in the tree; the other databases stay untouched.
  async function loadTables(container, db) {
    return YS.connections.refreshActive(container, db);
  }

  function setDbSpinner(container, db, active) {
    const list = container?.querySelector('#ysql-conn-list');
    if (!list) return;
    const header = [...list.querySelectorAll('[data-db-folder]')].find(el => el.dataset.dbFolder === db);
    const arrow = header?.querySelector('.ysql-folder-arrow');
    if (!arrow) return;
    if (active) {
      arrow.textContent = '⏳';
      arrow.style.transform = '';
      arrow.style.animation = 'ysql-spin 1s linear infinite';
    } else {
      // Back to the arrow of the folder's real state, open or closed.
      const open = header.nextElementSibling?.style.display !== 'none';
      arrow.textContent = '▶';
      arrow.style.transform = open ? 'rotate(90deg)' : '';
      arrow.style.animation = '';
    }
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
