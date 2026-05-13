// mvmOS App: Process Manager v1.0.0
mvmOS.registerApp({
  id: 'process-manager',
  name: 'Process Manager',
  icon: '📊',
  category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'process-manager',
      title: '📊 Process Manager',
      width: 780,
      height: 520,
      onMount(body) { PM.init(body); },
    });
  }
});

const PM = (() => {
  let _timer = null;
  let _sortCol = 'cpu';
  let _sortAsc = false;
  let _filter = '';
  let _sudoPassword = '';
  let _pendingKill = null;
  let _procs = [];

  function init(body) {
    body.style.padding = '0';
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;background:var(--surface);font-size:.82rem">

        <!-- Resource bars -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-bottom:1px solid var(--border)">
          ${['cpu','mem','disk'].map(k => `
            <div style="background:var(--surface2);padding:10px 14px">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px">
                <span style="font-weight:600;color:var(--text)">${k === 'cpu' ? '⚡ CPU' : k === 'mem' ? '🧠 Memory' : '💾 Disk'}</span>
                <span class="pm-${k}-pct" style="color:var(--text-dim)">—</span>
              </div>
              <div style="height:6px;background:var(--surface);border-radius:3px;overflow:hidden">
                <div class="pm-${k}-bar" style="height:100%;width:0%;border-radius:3px;transition:width .4s;background:${k==='cpu'?'#89b4fa':k==='mem'?'#a6e3a1':'#f9e2af'}"></div>
              </div>
            </div>
          `).join('')}
        </div>

        <!-- sudo bar -->
        <div id="pm-sudo-bar" style="display:none;align-items:center;gap:8px;padding:6px 14px;background:var(--surface2);border-bottom:1px solid var(--border)">
          <span style="color:#f1fa8c;font-size:.8rem">⚠️ Root password required to kill this process</span>
          <input id="pm-sudo-input" type="password" placeholder="sudo password…"
            style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:3px 8px;color:var(--text);font-size:.8rem">
          <button class="s-btn s-btn-sm" id="pm-sudo-ok">OK</button>
          <button class="s-btn s-btn-sm" id="pm-sudo-cancel" style="opacity:.6">Cancel</button>
        </div>

        <!-- toolbar -->
        <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--border)">
          <input id="pm-filter" placeholder="Filter processes…" style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.8rem">
          <span id="pm-count" style="color:var(--text-dim);white-space:nowrap"></span>
          <button class="s-btn s-btn-sm" id="pm-refresh">↺</button>
        </div>

        <!-- table -->
        <div style="flex:1;overflow:auto">
          <table id="pm-table" style="width:100%;border-collapse:collapse;font-size:.8rem">
            <thead>
              <tr style="position:sticky;top:0;background:var(--surface2);z-index:1">
                ${[['pid','PID',50],['user','User',80],['cpu','CPU%',65],['mem','MEM%',65],['rss','RSS',70],['stat','Stat',50],['command','Command','auto']].map(([col,label,w]) => `
                  <th class="pm-th" data-col="${col}" style="padding:6px 8px;text-align:${col==='command'?'left':'right'};width:${w==='auto'?'auto':w+'px'};cursor:pointer;user-select:none;color:var(--text-dim);font-weight:600;border-bottom:1px solid var(--border);white-space:nowrap">
                    ${label} <span class="pm-sort-ind" data-col="${col}"></span>
                  </th>`).join('')}
                <th style="padding:6px 8px;width:60px;border-bottom:1px solid var(--border)"></th>
              </tr>
            </thead>
            <tbody id="pm-body"></tbody>
          </table>
        </div>
      </div>
    `;

    // sort headers
    body.querySelectorAll('.pm-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (_sortCol === col) _sortAsc = !_sortAsc;
        else { _sortCol = col; _sortAsc = col === 'command' || col === 'user'; }
        renderProcs(body);
        updateSortIndicators(body);
      });
    });

    body.querySelector('#pm-filter').addEventListener('input', e => {
      _filter = e.target.value.toLowerCase();
      renderProcs(body);
    });

    body.querySelector('#pm-refresh').addEventListener('click', () => fetchAll(body));

    body.querySelector('#pm-sudo-ok').addEventListener('click', () => confirmSudo(body));
    body.querySelector('#pm-sudo-cancel').addEventListener('click', () => hideSudo(body));
    body.querySelector('#pm-sudo-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmSudo(body);
    });

    updateSortIndicators(body);
    fetchAll(body);
    _timer = setInterval(() => fetchAll(body), 3000);

    // stop polling when window closes
    const observer = new MutationObserver(() => {
      if (!document.contains(body)) { clearInterval(_timer); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function fetchAll(body) {
    const [resR, resP] = await Promise.all([
      fetch('/api/system/resources'),
      fetch('/api/system/processes'),
    ]);
    const resources = await resR.json();
    const procs     = await resP.json();

    // update bars
    updateBar(body, 'cpu', resources.cpu_pct, 100);
    updateBar(body, 'mem', resources.mem_used, resources.mem_total, true);
    updateBar(body, 'disk', resources.disk_used, resources.disk_total, true);

    _procs = procs;
    renderProcs(body);
  }

  function updateBar(body, key, used, total, bytes = false) {
    const pct = total > 0 ? Math.round(used / total * 100) : 0;
    const bar  = body.querySelector(`.pm-${key}-bar`);
    const label = body.querySelector(`.pm-${key}-pct`);
    if (!bar || !label) return;
    bar.style.width = pct + '%';
    bar.style.background = pct > 85 ? '#f38ba8' : pct > 60 ? '#f9e2af' :
      key === 'cpu' ? '#89b4fa' : key === 'mem' ? '#a6e3a1' : '#f9e2af';
    label.textContent = bytes
      ? `${fmtBytes(used)} / ${fmtBytes(total)} (${pct}%)`
      : `${pct}%`;
  }

  function fmtBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576)    return (b / 1048576).toFixed(0) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
  }

  function renderProcs(body) {
    const filtered = _filter
      ? _procs.filter(p => p.command.toLowerCase().includes(_filter) || String(p.pid).includes(_filter) || p.user.toLowerCase().includes(_filter))
      : _procs;

    const sorted = [...filtered].sort((a, b) => {
      let av = a[_sortCol], bv = b[_sortCol];
      if (typeof av === 'string') av = av.toLowerCase(), bv = bv.toLowerCase();
      return _sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });

    const tbody = body.querySelector('#pm-body');
    tbody.innerHTML = '';
    sorted.forEach(p => {
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom:1px solid var(--border);cursor:default';
      tr.innerHTML = `
        <td style="padding:4px 8px;text-align:right;color:var(--text-dim);font-family:monospace">${p.pid}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--text-dim);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.user}</td>
        <td style="padding:4px 8px;text-align:right;color:${p.cpu>50?'#f38ba8':p.cpu>20?'#f9e2af':'var(--text)'};font-weight:${p.cpu>10?'600':'400'}">${p.cpu.toFixed(1)}</td>
        <td style="padding:4px 8px;text-align:right;color:${p.mem>10?'#f9e2af':'var(--text)'}">${p.mem.toFixed(1)}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--text-dim)">${fmtBytes(p.rss * 1024)}</td>
        <td style="padding:4px 8px;text-align:right;color:var(--text-dim);font-family:monospace">${p.stat}</td>
        <td style="padding:4px 8px;color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.command}">${p.command}</td>
        <td style="padding:4px 6px;text-align:center">
          <button class="pm-kill s-btn-sm" data-pid="${p.pid}" style="background:#f38ba820;border:1px solid #f38ba850;color:#f38ba8;border-radius:3px;padding:2px 7px;cursor:pointer;font-size:.75rem">✕</button>
        </td>
      `;
      tr.addEventListener('mouseenter', () => tr.style.background = 'var(--surface2)');
      tr.addEventListener('mouseleave', () => tr.style.background = '');
      tr.querySelector('.pm-kill').addEventListener('click', e => {
        e.stopPropagation();
        doKill(body, parseInt(e.target.dataset.pid), 'TERM');
      });
      tbody.appendChild(tr);
    });

    body.querySelector('#pm-count').textContent = `${sorted.length} / ${_procs.length} processes`;
  }

  function updateSortIndicators(body) {
    body.querySelectorAll('.pm-sort-ind').forEach(el => {
      el.textContent = el.dataset.col === _sortCol ? (_sortAsc ? ' ↑' : ' ↓') : '';
    });
  }

  async function doKill(body, pid, sig, sudoPwd = '') {
    const res = await fetch('/api/system/processes/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid, signal: sig, sudo_password: sudoPwd }),
    });
    const data = await res.json();
    if (res.status === 403 || data.error === 'permission_denied') {
      _pendingKill = { body, pid, sig };
      showSudo(body);
      return;
    }
    if (data.error) { mvmOS.notify('Kill failed', data.error); return; }
    // refresh after short delay
    setTimeout(() => fetchAll(body), 600);
  }

  function showSudo(body) {
    const bar = body.querySelector('#pm-sudo-bar');
    bar.style.display = 'flex';
    body.querySelector('#pm-sudo-input').value = '';
    body.querySelector('#pm-sudo-input').focus();
  }

  function hideSudo(body) {
    body.querySelector('#pm-sudo-bar').style.display = 'none';
    _pendingKill = null;
  }

  async function confirmSudo(body) {
    const pwd = body.querySelector('#pm-sudo-input').value;
    if (!pwd || !_pendingKill) return;
    _sudoPassword = pwd;
    hideSudo(body);
    const { pid, sig } = _pendingKill;
    _pendingKill = null;
    await doKill(body, pid, sig, _sudoPassword);
  }

  return { init };
})();
