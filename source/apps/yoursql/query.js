// YourSQL — SQL Query editor (standalone tab)

const _ysqlQT = window.t || (k => k);

YS.query = (() => {

  var _colors = {
    kw:      'color:#bd93f9',
    str:     'color:#f1fa8c',
    col:     'color:#8be9fd',
    num:     'color:#ffb86c',
    comment: 'color:#6272a4;font-style:italic',
    plain:   'color:var(--text)',
  };

  function _highlight(sql) {
    var esc = YS.escHtml;
    var parts = [];
    var re = /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.)*')|(`[^`]*`)|(\b\d+\.?\d*\b)|(ORDER\s+BY|GROUP\s+BY)|(\b(?:SELECT|FROM|WHERE|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|CREATE|DROP|ALTER|TABLE|INDEX|DATABASE|USE|SHOW|DESCRIBE|EXPLAIN|UNION|ALL|EXISTS)\b)/gi;
    var last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(sql)) !== null) {
      if (m.index > last) parts.push({ t: 'plain', v: sql.slice(last, m.index) });
      if      (m[1] || m[2]) parts.push({ t: 'comment', v: m[0] });
      else if (m[3])          parts.push({ t: 'str',     v: m[0] });
      else if (m[4])          parts.push({ t: 'col',     v: m[0] });
      else if (m[5])          parts.push({ t: 'num',     v: m[0] });
      else if (m[6] || m[7]) parts.push({ t: 'kw',      v: m[0] });
      last = m.index + m[0].length;
    }
    if (last < sql.length) parts.push({ t: 'plain', v: sql.slice(last) });
    return parts.map(function(p) {
      return '<span style="' + _colors[p.t] + '">' + esc(p.v) + '</span>';
    }).join('');
  }

  function show(container) {
    if (!YS.state.activeConn) return;
    var content = container.querySelector('#ysql-content');
    if (!content) return;

    var prevSql = YS.state._querySql || '';

    content.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden';

    // ── Editor with syntax highlight overlay ──
    var taHeight = document.createElement('div');
    taHeight.style.cssText = 'position:relative;height:160px;flex-shrink:0;border-bottom:1px solid var(--border)';

    var hlDiv = document.createElement('div');
    hlDiv.style.cssText = [
      'position:absolute;inset:0;padding:10px',
      'font-family:monospace;font-size:.85rem;line-height:1.55',
      'white-space:pre;overflow:hidden;pointer-events:none',
      'background:var(--bg)',
    ].join(';');

    var ta = document.createElement('textarea');
    ta.id = 'ysql-sql-editor';
    ta.spellcheck = false;
    ta.value = prevSql;
    ta.placeholder = _ysqlQT('ysql_query_placeholder');
    ta.style.cssText = [
      'position:absolute;inset:0;width:100%;height:100%',
      'padding:10px;box-sizing:border-box',
      'font-family:monospace;font-size:.85rem;line-height:1.55',
      'border:none;background:transparent;color:transparent;caret-color:var(--text)',
      'outline:none;resize:none;white-space:pre;overflow-x:auto',
    ].join(';');

    taHeight.appendChild(hlDiv);
    taHeight.appendChild(ta);

    function _sync() {
      YS.state._querySql = ta.value;
      hlDiv.innerHTML = _highlight(ta.value) + '​';
      hlDiv.scrollLeft = ta.scrollLeft;
      hlDiv.scrollTop = ta.scrollTop;
    }

    ta.addEventListener('input', _sync);
    ta.addEventListener('scroll', function() {
      hlDiv.scrollLeft = ta.scrollLeft;
      hlDiv.scrollTop = ta.scrollTop;
    });
    ta.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        _run(container, resultDiv);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        var s = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.substring(0, s) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = s + 2;
        _sync();
      }
    });

    // ── Toolbar ──
    var toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface)';
    toolbar.innerHTML =
      '<span style="font-size:.78rem;color:var(--text-dim)">' + _ysqlQT('ysql_ctrl_enter_hint') + '</span>' +
      '<span style="flex:1"></span>' +
      '<button class="s-btn s-btn-sm" id="ysql-q-clear">' + _ysqlQT('ysql_clear') + '</button>' +
      '<button class="s-btn s-btn-sm" id="ysql-q-run" style="background:var(--accent);color:#fff;border-color:var(--accent)">' + _ysqlQT('ysql_run') + '</button>';

    // ── Result container ──
    // browse.showWithSql renders directly into this div
    var resultDiv = document.createElement('div');
    resultDiv.style.cssText = 'flex:1;overflow:hidden;display:flex;min-height:0';

    toolbar.querySelector('#ysql-q-run').addEventListener('click', function() {
      _run(container, resultDiv);
    });
    toolbar.querySelector('#ysql-q-clear').addEventListener('click', function() {
      ta.value = '';
      YS.state._querySql = '';
      YS.state._customSql = null;
      hlDiv.innerHTML = '';
      resultDiv.innerHTML = '';
    });

    wrap.appendChild(taHeight);
    wrap.appendChild(toolbar);
    wrap.appendChild(resultDiv);
    content.appendChild(wrap);

    _sync();
    ta.focus();

    // Re-run previous query if coming back to this tab
    var prevQuery = YS.state._querySql;
    if (prevQuery) {
      _run(container, resultDiv);
    }
  }

  async function _run(container, resultDiv) {
    var content = container.querySelector('#ysql-content');
    if (!content) return;
    var ta = content.querySelector('#ysql-sql-editor');
    if (!ta) return;
    var sql = ta.value.trim();
    if (!sql) return;
    YS.state._querySql = sql;

    // Try full browse (simple single-table SELECT)
    var handled = await YS.browse.showWithSql(container, sql, resultDiv);
    if (handled) return;

    // Complex SQL (JOIN, subquery, non-SELECT) — simple read-only table
    resultDiv.innerHTML = '<div style="padding:14px;color:var(--text-dim);display:flex;align-items:center;gap:8px"><div style="width:14px;height:14px;border:2px solid var(--accent);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></div> ' + _ysqlQT('ysql_running_dots') + '</div>';
    YS.state._customSql = sql;
    YS.state._customSqlOverride = null;

    var r = await YS.api('/query', { method: 'POST', json: {
      conn_id: YS.state.activeConn.id,
      database: YS.state.activeDb || '',
      sql: sql
    }}).catch(function(e) { return { error: e.message }; });

    if (r.error || r.detail) {
      resultDiv.innerHTML = '<div style="padding:14px;color:#f38ba8;font-family:monospace;font-size:.82rem;white-space:pre-wrap">' + YS.escHtml(r.error || r.detail) + '</div>';
      return;
    }
    if (r.affected !== null && r.affected !== undefined) {
      resultDiv.innerHTML = '<div style="padding:14px;color:#50fa7b;font-size:.85rem">' + _ysqlQT('ysql_query_ok_affected', { n: r.affected }) + '</div>';
      return;
    }
    if (!r.columns || !r.columns.length) {
      resultDiv.innerHTML = '<div style="padding:14px;color:var(--text-dim)">' + _ysqlQT('ysql_no_results') + '</div>';
      return;
    }

    _renderReadOnly(resultDiv, r.columns, r.rows || []);
  }

  function _renderReadOnly(resultDiv, columns, rows) {
    var esc = YS.escHtml;
    resultDiv.innerHTML = '';

    var info = document.createElement('div');
    info.style.cssText = 'padding:4px 10px;font-size:.75rem;color:var(--text-dim);flex-shrink:0';
    info.textContent = _ysqlQT('ysql_n_rows_paren', { n: rows.length });

    var wrap = document.createElement('div');
    wrap.style.cssText = 'overflow:auto;flex:1';

    var table = document.createElement('table');
    table.style.cssText = 'border-collapse:collapse;width:100%;font-size:.82rem;white-space:nowrap';

    var thead = '<thead><tr style="position:sticky;top:0;background:var(--surface);z-index:1">' +
      columns.map(function(c) {
        return '<th style="padding:8px 10px;border-bottom:2px solid var(--border);text-align:left">' + esc(c) + '</th>';
      }).join('') + '</tr></thead>';

    var tbody = '<tbody>' + rows.map(function(row) {
      return '<tr style="border-bottom:1px solid var(--border)">' +
        columns.map(function(col) {
          var v = row[col];
          if (v === null || v === undefined) return '<td style="padding:5px 10px;color:var(--text-dim);font-style:italic">' + _ysqlQT('ysql_null_placeholder') + '</td>';
          var s = String(v);
          var style = 'padding:5px 10px;max-width:300px;overflow:hidden;text-overflow:ellipsis';
          if (/^-?\d+(\.\d+)?$/.test(s)) style += ';color:var(--color-num,#8be9fd)';
          else if (/^\d{4}-\d{2}-\d{2}/.test(s)) style += ';color:var(--color-date,#f1fa8c)';
          return '<td style="' + style + '" title="' + esc(s) + '">' + esc(s) + '</td>';
        }).join('') + '</tr>';
    }).join('') + '</tbody>';

    table.innerHTML = thead + tbody;
    wrap.appendChild(table);

    var inner = document.createElement('div');
    inner.style.cssText = 'display:flex;flex-direction:column;height:100%';
    inner.appendChild(info);
    inner.appendChild(wrap);
    resultDiv.appendChild(inner);
  }

  return { show };
})();
