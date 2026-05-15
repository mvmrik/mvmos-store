// mvmOS App: Cron Manager v1.1.0
const _cm18n = {
  en: {
    title: 'Cron Manager', add_job: '+ Add Job', loading: 'Loading…',
    crontab_for: 'Crontab for: ', no_jobs: 'No cron jobs yet. Click "+ Add Job" to create one.',
    sys_jobs: '/etc/cron.d/ — System Jobs (read-only)',
    at_reboot: 'At reboot', every_hour: 'Every hour', every_day: 'Every day',
    every_week: 'Every week', every_month: 'Every month', every_year: 'Every year',
    every_minute: 'Every minute', daily_at: 'Daily at ',
    run_now: 'Run now', enable: 'Enable', disable: 'Disable',
    run_output: 'Run Now — Output', exit_code: 'Exit code: ', close: 'Close',
    edit_job: 'Edit Cron Job', new_job: 'New Cron Job',
    schedule: 'Schedule', custom: 'Custom (5-field)',
    minute: 'Minute', hour: 'Hour', day: 'Day', month: 'Month', weekday: 'Weekday',
    command: 'Command', cmd_required: 'Command is required.',
    cancel: 'Cancel', save: 'Save', add: 'Add', delete_confirm: 'Delete this job?',
  },
  bg: {
    title: 'Планировчик', add_job: '+ Добави задача', loading: 'Зареждане…',
    crontab_for: 'Crontab на: ', no_jobs: 'Няма задачи. Натисни "+ Добави задача".',
    sys_jobs: '/etc/cron.d/ — Системни задачи (само четене)',
    at_reboot: 'При рестарт', every_hour: 'Всеки час', every_day: 'Всеки ден',
    every_week: 'Всяка седмица', every_month: 'Всеки месец', every_year: 'Всяка година',
    every_minute: 'Всяка минута', daily_at: 'Всеки ден в ',
    run_now: 'Изпълни сега', enable: 'Активирай', disable: 'Деактивирай',
    run_output: 'Изпълни сега — Изход', exit_code: 'Код на изход: ', close: 'Затвори',
    edit_job: 'Редактирай задача', new_job: 'Нова задача',
    schedule: 'Разписание', custom: 'По избор (5 полета)',
    minute: 'Минута', hour: 'Час', day: 'Ден', month: 'Месец', weekday: 'Ден от седм.',
    command: 'Команда', cmd_required: 'Командата е задължителна.',
    cancel: 'Отказ', save: 'Запази', add: 'Добави', delete_confirm: 'Изтрий тази задача?',
  },
};
function _cmt(key) { const lang = window.mvmOS?.lang || 'en'; return (_cm18n[lang] || _cm18n.en)[key] || key; }

mvmOS.registerApp({
  id: 'cron-manager', name: _cmt('title'), icon: '⏰', category: 'Administration',
  launch() {
    mvmOS.createWindow({
      id: 'cron-manager', title: '⏰ ' + _cmt('title'), width: 820, height: 520,
      onMount(body) { (window.mvmOS?.i18nReady || Promise.resolve()).then(() => CronManager.init(body)); },
    });
  }
});

const CronManager = (() => {
  let _body = null, _data = null;
  const SHORTCUTS = ['@reboot','@hourly','@daily','@weekly','@monthly','@yearly'];
  const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _humanSchedule(e) {
    if (e.schedule) {
      const map = {
        '@reboot': _cmt('at_reboot'), '@hourly': _cmt('every_hour'),
        '@daily': _cmt('every_day'), '@weekly': _cmt('every_week'),
        '@monthly': _cmt('every_month'), '@yearly': _cmt('every_year'),
      };
      return map[e.schedule] || e.schedule;
    }
    const m = e.minute, h = e.hour, dom = e.day, mon = e.month, dow = e.weekday;
    if (m==='*' && h==='*' && dom==='*' && mon==='*' && dow==='*') return _cmt('every_minute');
    if (dom==='*' && mon==='*' && dow==='*') {
      if (m==='0' && h==='*') return _cmt('every_hour');
      if (m!=='*' && h!=='*') return _cmt('daily_at') + `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
    }
    return `${m} ${h} ${dom} ${mon} ${dow}`;
  }

  function init(body) {
    _body = body;
    body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%';
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-size:.82rem;color:var(--text-dim)" id="cm-user"></span>
        <button class="s-btn" id="cm-add-btn">${_cmt('add_job')}</button>
      </div>
      <div id="cm-content" style="flex:1;overflow-y:auto"></div>
    `;
    body.querySelector('#cm-add-btn').addEventListener('click', () => _showForm(null));
    _load();
    window.mvmOS?.onLangChange(() => init(body));
  }

  async function _load() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.83rem">${_cmt('loading')}</div>`;
    const res = await fetch('/api/cron');
    _data = await res.json();
    _body.querySelector('#cm-user').textContent = _cmt('crontab_for') + _data.user;
    _render();
  }

  function _render() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = '';
    const section = document.createElement('div');
    section.style.cssText = 'padding:0 0 16px 0';
    if (!_data.entries.length) {
      section.innerHTML = `<div style="padding:24px 16px;color:var(--text-dim);font-size:.83rem">${_cmt('no_jobs')}</div>`;
    } else {
      section.appendChild(_makeTable(_data.entries, true));
    }
    content.appendChild(section);
    if (_data.cron_d && _data.cron_d.length) {
      const header = document.createElement('div');
      header.style.cssText = 'padding:8px 16px;border-top:1px solid var(--border);font-size:.75rem;font-weight:700;color:var(--text-dim);letter-spacing:.05em';
      header.textContent = _cmt('sys_jobs');
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
      const disabled = e.enabled === false;
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 16px;border-bottom:1px solid var(--border);font-size:.8rem;${disabled ? 'opacity:.45' : ''}`;
      row.innerHTML = `
        <div style="flex:0 0 130px;color:var(--accent);font-family:var(--mono);font-size:.75rem">${_humanSchedule(e)}</div>
        <div style="flex:1;color:var(--text);font-family:var(--mono);font-size:.75rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${e.command}">${e.command}</div>
        ${editable ? `
          <button class="s-btn-sm cm-run" title="${_cmt('run_now')}" style="flex-shrink:0">▶</button>
          <button class="s-btn-sm ${disabled ? 's-btn' : ''} cm-toggle" title="${disabled ? _cmt('enable') : _cmt('disable')}" style="flex-shrink:0">${disabled ? '○' : '●'}</button>
          <button class="s-btn s-btn-sm cm-edit" style="flex-shrink:0">✏️</button>
          <button class="s-btn-sm s-btn-danger cm-del" style="flex-shrink:0">✕</button>
        ` : ''}
      `;
      if (editable) {
        row.querySelector('.cm-run').addEventListener('click', () => _runNow(e, row));
        row.querySelector('.cm-toggle').addEventListener('click', () => _toggle(e));
        row.querySelector('.cm-edit').addEventListener('click', () => _showForm(e));
        row.querySelector('.cm-del').addEventListener('click', () => _delete(e));
      }
      wrap.appendChild(row);
    });
    return wrap;
  }

  async function _toggle(entry) {
    const newEnabled = entry.enabled === false ? true : false;
    const res = await fetch('/api/cron/toggle', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ raw: entry.raw, enabled: newEnabled }) });
    if ((await res.json()).ok) _load();
  }

  async function _runNow(entry, row) {
    const btn = row.querySelector('.cm-run');
    btn.disabled = true; btn.textContent = '…';
    const res = await fetch('/api/cron/run', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ command: entry.command }) });
    const d = await res.json();
    btn.disabled = false; btn.textContent = '▶';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:100';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:520px;max-width:92%;display:flex;flex-direction:column;gap:10px';
    const output = d.output || '(no output)';
    box.innerHTML = `
      <div style="font-size:.85rem;font-weight:600;color:var(--text)">${_cmt('run_output')}</div>
      <div style="font-size:.73rem;color:var(--text-dim);font-family:var(--mono)">${entry.command}</div>
      <pre style="background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:10px;font-size:.75rem;color:${d.returncode===0?'var(--text)':'#f38ba8'};overflow:auto;max-height:220px;white-space:pre-wrap;margin:0">${_esc(output)}</pre>
      <div style="font-size:.75rem;color:var(--text-dim)">${_cmt('exit_code')}<span style="color:${d.returncode===0?'#a6e3a1':'#f38ba8'}">${d.returncode}</span></div>
      <div style="text-align:right"><button class="s-btn">${_cmt('close')}</button></div>
    `;
    box.querySelector('.s-btn').addEventListener('click', () => overlay.remove());
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
  }

  function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function _showForm(entry) {
    const isEdit = !!entry, isShortcut = isEdit && !!entry.schedule;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:100';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:480px;max-width:90%';
    box.innerHTML = `
      <div style="font-size:.9rem;font-weight:600;margin-bottom:16px;color:var(--text)">${isEdit ? _cmt('edit_job') : _cmt('new_job')}</div>
      <div style="margin-bottom:12px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">${_cmt('schedule')}</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
          <select id="cf-shortcut" style="flex:1;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem">
            <option value="">${_cmt('custom')}</option>
            ${SHORTCUTS.map(s => `<option value="${s}" ${isShortcut && entry.schedule===s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
        <div id="cf-fields" style="display:${isShortcut ? 'none' : 'grid'};grid-template-columns:repeat(5,1fr);gap:6px">
          ${[_cmt('minute'),_cmt('hour'),_cmt('day'),_cmt('month'),_cmt('weekday')].map((label, i) => {
            const keys = ['minute','hour','day','month','weekday'];
            const val = isEdit && !isShortcut ? entry[keys[i]] : '*';
            return `<div><div style="font-size:.68rem;color:var(--text-dim);margin-bottom:2px">${label}</div>
              <input class="cf-field" data-field="${keys[i]}" value="${val}" style="width:100%;padding:5px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box"></div>`;
          }).join('')}
        </div>
      </div>
      <div style="margin-bottom:16px">
        <label style="font-size:.75rem;color:var(--text-dim);display:block;margin-bottom:4px">${_cmt('command')}</label>
        <input id="cf-command" value="${isEdit ? entry.command.replace(/"/g,'&quot;') : ''}" placeholder="/path/to/script.sh >> /dev/null 2>&1"
          style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box">
      </div>
      <div id="cf-err" style="color:#f38ba8;font-size:.78rem;margin-bottom:8px;display:none"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="s-btn-sm" id="cf-cancel">${_cmt('cancel')}</button>
        <button class="s-btn" id="cf-save">${isEdit ? _cmt('save') : _cmt('add')}</button>
      </div>
    `;
    const shortcutSel = box.querySelector('#cf-shortcut'), fieldsDiv = box.querySelector('#cf-fields');
    shortcutSel.addEventListener('change', () => { fieldsDiv.style.display = shortcutSel.value ? 'none' : 'grid'; });
    box.querySelector('#cf-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#cf-save').addEventListener('click', async () => {
      const cmd = box.querySelector('#cf-command').value.trim();
      const err = box.querySelector('#cf-err');
      if (!cmd) { err.textContent = _cmt('cmd_required'); err.style.display = ''; return; }
      const shortcut = shortcutSel.value, body_data = { command: cmd };
      if (shortcut) { body_data.schedule = shortcut; }
      else { box.querySelectorAll('.cf-field').forEach(f => { body_data[f.dataset.field] = f.value.trim() || '*'; }); }
      let res;
      if (isEdit) { body_data.old_raw = entry.raw; res = await fetch('/api/cron', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) }); }
      else { res = await fetch('/api/cron', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) }); }
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
    if (!confirm(`${_cmt('delete_confirm')}\n\n${entry.raw}`)) return;
    const res = await fetch('/api/cron', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ raw: entry.raw }) });
    if ((await res.json()).ok) _load();
  }

  return { init };
})();
