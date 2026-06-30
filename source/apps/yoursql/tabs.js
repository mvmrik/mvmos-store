// YourSQL — Tab manager

YS.tabs = (() => {

  // Each tab: { id, label, type, db, table, dirty, pinned, state }
  // dirty = user has done something (edit, filter, sort, structure edit)
  // pinned = user clicked on the tab label to keep it

  var _tabs = [];
  var _active = null;
  var _container = null;

  function init(container) {
    _container = container;
    _tabs = [];
    _active = null;
    _renderBar();
  }

  function _uid() {
    return Math.random().toString(36).slice(2, 8);
  }

  // Open a standalone SQL Editor tab (not tied to a table).
  function openQuery(container, sql) {
    var existing = _tabs.find(function(t) { return t.type === 'query'; });
    if (existing) {
      _activate(existing.id);
      if (sql && container) {
        var ed = container.querySelector('#ysql-sql-editor');
        if (ed) { ed.value = sql; ed.focus(); }
      }
      return existing.id;
    }
    var tab = { id: _uid(), label: '⌨ SQL', type: 'query', db: null, table: null, dirty: false, pinned: true };
    _tabs.push(tab);
    _activate(tab.id);
    if (sql && container) {
      setTimeout(function() {
        var ed = container && container.querySelector('#ysql-sql-editor');
        if (ed) { ed.value = sql; ed.focus(); }
      }, 50);
    }
    return tab.id;
  }

  // Open a browse or structure tab for the given table.
  // If current tab is clean (not dirty, not pinned) — reuse it.
  // Returns the tab id.
  function open(type, db, table, opts) {
    opts = opts || {};
    var label = type === 'structure' ? '⚙ ' + table : table;

    // Try to find existing tab for same type+db+table
    var existing = _tabs.find(function(t) {
      return t.type === type && t.db === db && t.table === table;
    });
    if (existing) {
      _activate(existing.id);
      return existing.id;
    }

    // Reuse current tab if clean
    if (_active) {
      var cur = _tabs.find(function(t) { return t.id === _active; });
      if (cur && !cur.dirty && !cur.pinned) {
        cur.type = type;
        cur.db = db;
        cur.table = table;
        cur.label = label;
        _renderBar();
        _renderContent();
        return cur.id;
      }
    }

    // New tab
    var tab = { id: _uid(), label: label, type: type, db: db, table: table, dirty: false, pinned: false };
    _tabs.push(tab);
    _activate(tab.id);
    return tab.id;
  }

  function _activate(id) {
    // Save current tab's browse state before switching
    var prev = _activeTab();
    if (prev && prev.type === 'browse') {
      prev.browseState = {
        filters: YS.state.filters,
        sort: YS.state.sort,
        page: YS.state.page,
        pageSize: YS.state.pageSize,
        colMeta: YS.state.colMeta,
      };
    }
    _active = id;
    _renderBar();
    _renderContent();
  }

  function close(id) {
    var idx = _tabs.findIndex(function(t) { return t.id === id; });
    if (idx === -1) return;
    _tabs.splice(idx, 1);
    if (_active === id) {
      var next = _tabs[Math.min(idx, _tabs.length - 1)];
      if (next) {
        _active = next.id;
        _renderContent();
      } else {
        _active = null;
        var content = _container.querySelector('#ysql-content');
        if (content) YS.browse.showWelcome(_container);
      }
    }
    _renderBar();
  }

  // Mark active tab as dirty (user did something)
  function markDirty() {
    var tab = _activeTab();
    if (tab && !tab.pinned) {
      tab.dirty = true;
      tab.pinned = true;
      _renderBar();
    }
  }

  // Pin active tab (keep it even if clean)
  function pin(id) {
    var tab = _tabs.find(function(t) { return t.id === id; });
    if (tab && !tab.pinned) {
      tab.pinned = true;
      _renderBar();
    }
  }

  function _activeTab() {
    return _tabs.find(function(t) { return t.id === _active; }) || null;
  }

  function activeTab() { return _activeTab(); }

  function _renderBar() {
    var bar = _container.querySelector('#ysql-tabbar');
    if (!bar) return;

    if (!_tabs.length) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = '';

    _tabs.forEach(function(tab) {
      var isActive = tab.id === _active;
      var isUnsaved = !tab.pinned; // italic when not pinned

      var el = document.createElement('div');
      el.dataset.tabid = tab.id;
      el.style.cssText = [
        'display:flex;align-items:center;gap:4px;padding:4px 10px 4px 8px',
        'border-right:1px solid var(--border)',
        'cursor:pointer;user-select:none;font-size:.8rem;white-space:nowrap',
        'max-width:160px;overflow:hidden',
        isActive
          ? 'background:var(--bg);border-bottom:2px solid var(--accent);color:var(--text)'
          : 'background:var(--surface);border-bottom:2px solid transparent;color:var(--text-dim)',
      ].join(';');

      var nameEl = document.createElement('span');
      nameEl.textContent = tab.label;
      nameEl.title = (tab.db ? tab.db + '.' : '') + tab.table + (isUnsaved ? ' (click to keep)' : '');
      nameEl.style.cssText = [
        'overflow:hidden;text-overflow:ellipsis;flex:1',
        isUnsaved ? 'font-style:italic' : '',
      ].filter(Boolean).join(';');

      // Click on name = activate OR pin if already active
      nameEl.addEventListener('click', function(e) {
        e.stopPropagation();
        if (isActive) {
          pin(tab.id);
        } else {
          _activate(tab.id);
        }
      });

      var closeBtn = document.createElement('span');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'font-size:.7rem;opacity:.5;padding:1px 2px;border-radius:2px;flex-shrink:0';
      closeBtn.addEventListener('mouseenter', function() { this.style.opacity = '1'; });
      closeBtn.addEventListener('mouseleave', function() { this.style.opacity = '.5'; });
      closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        close(tab.id);
      });

      el.appendChild(nameEl);
      el.appendChild(closeBtn);

      if (!isActive) {
        el.addEventListener('click', function() { _activate(tab.id); });
      }

      bar.appendChild(el);
    });
  }

  function _renderContent() {
    if (!_container) return;
    var tab = _activeTab();
    if (!tab) return;

    // Sync global state (query tabs don't override active db/table)
    if (tab.type !== 'query') {
      YS.state.activeDb = tab.db;
      YS.state.activeTable = tab.table;
      YS.state._customSql = null;
      YS.state._customSqlOverride = null;
    }

    // Update sidebar selection
    var sidebar = _container.querySelector('#ysql-sidebar');
    if (sidebar) {
      sidebar.querySelectorAll('.ys-table-item').forEach(function(el) {
        var active = el.dataset.table === tab.table && el.dataset.db === tab.db;
        el.style.background = active ? 'var(--accent)' : '';
        el.style.color = active ? '#fff' : '';
      });
    }

    var content = _container.querySelector('#ysql-content');
    if (!content) return;

    if (tab.type === 'query') {
      YS.query.show(_container);
    } else if (tab.type === 'structure') {
      YS.structure.show(_container, content);
    } else {
      YS.browse.show(_container, tab.browseState);
    }

    if (YS.updateTopToolbar) YS.updateTopToolbar(_container);
  }

  return { init, open, openQuery, close, markDirty, pin, activeTab };
})();
