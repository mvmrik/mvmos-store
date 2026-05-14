// mvmOS App: Cron Manager v1.0.0
mvmOS.registerApp({
  id: 'cron-manager',
  name: 'Cron Manager',
  icon: '⏰',
  category: 'Administration',

  launch() {
    mvmOS.createWindow({
      id: 'cron-manager',
      title: '⏰ Cron Manager',
      width: 780,
      height: 500,
      onMount(body) { CronManager.init(body); },
    });
  }
});

const CronManager = (() => {
  let _body = null;
  let _data = null;

  const SHORTCUTS = ['@reboot', '@hourly', '@daily', '@weekly', '@monthly', '@yearly'];

  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _humanSchedule(e) {
    if (e.schedule) {
      const map = {
        '@reboot': 'At reboot', '@hourly': 'Every hour',
        '@daily': 'Every day', '@weekly': 'Every week',
        '@monthly': 'Every month', '@yearly': 'Every year',
      };
      return map[e.schedule] || e.schedule;
    }
    const m = e.minute, h = e.hour, dom = e.day, mon = e.month, dow = e.weekday;
    if (m==='*' && h==='*' && dom==='*' && mon==='*' && dow==='*') return 'Every minute';
    if (dom==='*' && mon==='*' && dow==='*') {
      if (m==='0' && h==='*') return 'Every hour';
      if (m!=='*' && h!=='*') return `Daily at ${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
    }
    return `${m} ${h} ${dom} ${mon} ${dow}`;
  }

  function init(body) {
    _body = body;
    body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%';
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-size:.82rem;color:var(--text-dim)" id="cm-user"></span>
        <button class="s-btn" id="cm-add-btn">+ Add Job</button>
      </div>
      <div id="cm-content" style="flex:1;overflow-y:auto"></div>
    `;
    body.querySelector('#cm-add-btn').addEventListener('click', () => _showForm(null));
    _load();
  }

  async function _load() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = '<div style="padding:24px;color:var(--text-dim);font-size:.83rem">Loading…</div>';
    const res = await fetch('/api/cron');
    _data = await res.json();
    _body.querySelector('#cm-user').textContent = `Crontab for: ${_data.user}`;
    _render();
  }

  function _render() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = '';

    // User crontab
    const section = document.createElement('div');
    section.style.cssText = 'padding:0 0 16px 0';

    if (!_data.entries.length) {
      section.innerHTML = '<div style="padding:24px 16px;color:var(--text-dim);font-size:.83rem">No cron jobs yet. Click "+ Add Job" to create one.</div>';
    } else {
      const table = _makeTable(_data.entries, true);
      section.appendChild(table);
    }
    content.appendChild(section);

    // /etc/cron.d/ (root only, read-only)
    if (_data.cron_d && _data.cron_d.length) {
      const header = document.createElement('div');
      header.style.cssText = 'padding:8px 16px;border-top:1px solid var(--border);font-size:.75rem;font-weight:700;color:var(--text-dim);letter-spacing:.05em';
      header.textContent = '/etc/cron.d/ — System Jobs (read-only)';
      content.appendChild(header);
      _data.cron_d.forEach(f => {
        if (!f.entries.length) return;
        const flabel = document.createElement('div');
        flabel.style.cssText = 'padding:4px 16px 2px;font-size:.75rem;color:var(--text-dim)';
        flabel.textContent = f.file;
        content.appendChild(flabel);
        content.appendChild(_makeTable(f.entries, false));
      });
    }
  }

  function _makeTable(entries, editable) {
    const wrap = document.createElement('div');
    entries.forEach(e => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--border);font-size:.8rem';
      row.innerHTML = `
        <div style="flex:0 0 130px;color:var(--accent);font-family:var(--mono);font-size:.75rem">${_humanSchedule(e)}</div>
        <div style="flex:1;color:var(--text);font-family:var(--mono);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.command}">${e.command}</div>
        ${editable ? `
          <button class="s-btn s-btn-sm cm-edit" style="flex-shrink:0">✏️</button>
          <button class="s-btn-sm s-btn-danger cm-del" style="flex-shrink:0">✕</button>
        ` : ''}
      `;
      if (editable) {
        row.querySelector('.cm-edit').addEventListener('click', () => _showForm(e));
        row.querySelector('.cm-del').addEventListener('click', () => _delete(e));
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  function _showForm(entry) {
    const isEdit = !!entry;
    const isShortcut = isEdit && !!entry.schedule;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:480px;max-width:90%';
    box.innerHTML = `
      <div style="font-size:.9rem;font-weight:600;margin-bottom:16px;color:var(--text)">${isEdit ? 'Edit' : 'New'} Cron Job</div>

      <div style="margin-bottom:12px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">Schedule</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <select id="cf-shortcut" style="flex:1;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem">
            <option value="">Custom (5-field)</option>
            ${SHORTCUTS.map(s => `<option value="${s}" ${isShortcut && entry.schedule===s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div id="cf-fields" style="display:${isShortcut ? 'none' : 'grid'};grid-template-columns:repeat(5,1fr);gap:6px">
          ${['Minute','Hour','Day','Month','Weekday'].map((label, i) => {
            const keys = ['minute','hour','day','month','weekday'];
            const val = isEdit && !isShortcut ? entry[keys[i]] : '*';
            return `<div>
              <div style="font-size:.68rem;color:var(--text-dim);margin-bottom:2px">${label}</div>
              <input class="cf-field" data-field="${keys[i]}" value="${val}" style="width:100%;padding:5px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box">
            </div>`;
          }).join('')}
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">Command</label>
        <input id="cf-command" value="${isEdit ? entry.command.replace(/"/g,'&quot;') : ''}" placeholder="/path/to/script.sh >> /dev/null 2>&1"
          style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box">
      </div>

      <div id="cf-err" style="color:#f38ba8;font-size:.78rem;margin-bottom:8px;display:none"></div>

      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="s-btn-sm" id="cf-cancel">Cancel</button>
        <button class="s-btn" id="cf-save">${isEdit ? 'Save' : 'Add'}</button>
      </div>
    `;

    const shortcutSel = box.querySelector('#cf-shortcut');
    const fieldsDiv   = box.querySelector('#cf-fields');
    shortcutSel.addEventListener('change', () => {
      fieldsDiv.style.display = shortcutSel.value ? 'none' : 'grid';
    });

    box.querySelector('#cf-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#cf-save').addEventListener('click', async () => {
      const cmd = box.querySelector('#cf-command').value.trim();
      const err = box.querySelector('#cf-err');
      if (!cmd) { err.textContent = 'Command is required.'; err.style.display = ''; return; }

      const shortcut = shortcutSel.value;
      const body_data = { command: cmd };
      if (shortcut) {
        body_data.schedule = shortcut;
      } else {
        box.querySelectorAll('.cf-field').forEach(f => { body_data[f.dataset.field] = f.value.trim() || '*'; });
      }

      let res;
      if (isEdit) {
        body_data.old_raw = entry.raw;
        res = await fetch('/api/cron', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) });
      } else {
        res = await fetch('/api/cron', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) });
      }
      const d = await res.json();
      if (d.ok) { overlay.remove(); _load(); }
      else { err.textContent = d.detail || 'Error'; err.style.display = ''; }
    });

    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
    box.querySelector('#cf-command').focus();
  }

  async function _delete(entry) {
    if (!confirm(`Delete this job?\n\n${entry.raw}`)) return;
    const res = await fetch('/api/cron', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ raw: entry.raw }) });
    const d = await res.json();
    if (d.ok) _load();
  }

  return { init };
})();
