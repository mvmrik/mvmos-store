// mvmOS App: Cron Manager v1.2.0
{const s=document.createElement('style');s.textContent='.cm-tab{background:none;border:none;padding:5px 12px;font-size:.82rem;color:var(--text-dim);border-radius:6px;cursor:pointer;transition:background .15s}.cm-tab:hover{background:var(--surface2)}.cm-tab-active{background:var(--surface2)!important;color:var(--text)!important;font-weight:600}';document.head.appendChild(s);}
const _cm18n = {
  en: {
    title: 'Cron Manager', add_job: '+ Add Job', loading: 'Loading…',
    scheduler_section: 'mvmOS Scheduler', scheduler_enable: 'Enable Scheduler',
    scheduler_disable: 'Disable Scheduler', scheduler_enabled: 'Scheduler is active',
    scheduler_disabled: 'Scheduler is inactive — click Enable to install the system cron',
    scheduler_no_apps: 'No apps with scheduler registered.',
    scheduler_file_missing: '⚠ file missing',
    backup_sched_daily: 'Daily ({time})', backup_sched_weekly: 'Weekly (Sun {time})', backup_sched_monthly: 'Monthly (1st, {time})',
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
    tab_jobs: 'Jobs', tab_scheduler: 'Scheduler',
    sudo_title: 'Sudo — confirm identity', sudo_msg: 'Enter your password to modify {user}\'s crontab.',
    sudo_placeholder: 'Your password', sudo_confirm: 'Confirm', sudo_wrong_pw: 'Incorrect password.',
  },
  bg: {
    title: 'Планировчик', add_job: '+ Добави задача', loading: 'Зареждане…',
    scheduler_section: 'mvmOS Планировчик', scheduler_enable: 'Активирай',
    scheduler_disable: 'Деактивирай', scheduler_enabled: 'Планировчикът е активен',
    scheduler_disabled: 'Планировчикът е неактивен — натисни Активирай за да инсталираш системния крон',
    scheduler_no_apps: 'Няма апове с регистриран планировчик.',
    scheduler_file_missing: '⚠ файлът липсва',
    backup_sched_daily: 'Ежедневно ({time})', backup_sched_weekly: 'Седмично (нед. {time})', backup_sched_monthly: 'Месечно (1-во, {time})',
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
    tab_jobs: 'Задачи', tab_scheduler: 'Планировчик',
    sudo_title: 'Sudo — потвърди самоличността си', sudo_msg: 'Въведи паролата си за да промениш crontab на {user}.',
    sudo_placeholder: 'Твоята парола', sudo_confirm: 'Потвърди', sudo_wrong_pw: 'Грешна парола.',
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
  let _body = null, _data = null, _me = null, _targetUser = null;
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

  let _activeTab = 'jobs';

  function init(body) {
    _body = body;
    body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column;height:100%';
    body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--border);flex-shrink:0;gap:12px">
        <div style="display:flex;gap:4px">
          <button class="cm-tab ${_activeTab==='jobs'?'cm-tab-active':''}" data-tab="jobs">${_cmt('tab_jobs')}</button>
          <button class="cm-tab ${_activeTab==='scheduler'?'cm-tab-active':''}" data-tab="scheduler">${_cmt('tab_scheduler')}</button>
        </div>
        <div id="cm-jobs-toolbar" style="display:${_activeTab==='jobs'?'flex':'none'};align-items:center;gap:8px">
          <span style="font-size:.82rem;color:var(--text-dim)">${_cmt('crontab_for')}</span>
          <select id="cm-user-sel" style="font-size:.82rem;background:var(--surface2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:3px 6px;cursor:pointer"></select>
          <button class="s-btn" id="cm-add-btn">${_cmt('add_job')}</button>
        </div>
      </div>
      <div id="cm-content" style="flex:1;overflow-y:auto"></div>
    `;
    body.querySelectorAll('.cm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        body.querySelectorAll('.cm-tab').forEach(b => b.classList.toggle('cm-tab-active', b.dataset.tab === _activeTab));
        body.querySelector('#cm-jobs-toolbar').style.display = _activeTab === 'jobs' ? 'flex' : 'none';
        if (_activeTab === 'jobs') { _load(); }
        else { _renderSchedulerTab(); }
      });
    });
    fetch('/api/cron/users').then(r => r.json()).then(users => {
      const sel = body.querySelector('#cm-user-sel');
      users.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u; opt.textContent = u;
        sel.appendChild(opt);
      });
      if (_targetUser && users.includes(_targetUser)) sel.value = _targetUser;
      sel.addEventListener('change', () => { _targetUser = sel.value; _load(); });
    });
    body.querySelector('#cm-add-btn').addEventListener('click', () => _showForm(null));
    if (_activeTab === 'jobs') _load();
    else _renderSchedulerTab();
    window.mvmOS?.onLangChange(() => init(body));
  }

  async function _renderSchedulerTab() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.83rem">${_cmt('loading')}</div>`;
    const statusData = await fetch('/api/scheduler/status').then(r => r.json());
    const isEnabled = !!statusData.cron_installed;
    const apps = statusData.apps || [];
    const systemApps = statusData.system_apps || [];
    const _bkTime = (() => { const h12 = (window._vosSettings?.time_format || '24') === '12'; return new Date(2000,0,1,3,0).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:h12}); })();
    const schedLabels = { disabled: '—', every_minute: _cmt('every_minute'), daily: _cmt('backup_sched_daily').replace('{time}',_bkTime), weekly: _cmt('backup_sched_weekly').replace('{time}',_bkTime), monthly: _cmt('backup_sched_monthly').replace('{time}',_bkTime) };
    const allRows = [
      ...apps.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:${a.file_exists?'#a6e3a1':'#f38ba8'}">${a.file_exists ? '✓' : '⚠'}</span>
          <span style="flex:1">${a.name}</span>
          <span style="font-family:var(--mono);font-size:.72rem;color:var(--text-dim)">${a.scheduler}${!a.file_exists?' <span style="color:#f38ba8">'+_cmt('scheduler_file_missing')+'</span>':''}</span>
        </div>`),
      ...systemApps.map(a => `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:.82rem">
          <span style="color:#a6e3a1">✓</span>
          <span style="flex:1">${a.name}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">${schedLabels[a.config?.schedule] || '—'}</span>
        </div>`),
    ];
    content.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:.82rem;color:${isEnabled?'#a6e3a1':'var(--text-dim)'}">
          ${isEnabled ? '● ' + _cmt('scheduler_enabled') : '○ ' + _cmt('scheduler_disabled')}
        </span>
        <button class="s-btn s-btn-sm" id="cm-sched-toggle">${isEnabled ? _cmt('scheduler_disable') : _cmt('scheduler_enable')}</button>
      </div>
      ${allRows.length ? allRows.join('') : `<div style="padding:24px 16px;font-size:.83rem;color:var(--text-dim)">${_cmt('scheduler_no_apps')}</div>`}
    `;
    content.querySelector('#cm-sched-toggle').addEventListener('click', () => _toggleScheduler(isEnabled));
  }

  async function _toggleScheduler(currentlyEnabled) {
    if (currentlyEnabled) {
      const data = await fetch('/api/cron?user=root').then(r => r.json());
      const entry = (data.entries || []).find(e => e.command && e.command.includes('/api/scheduler/tick'));
      if (entry) {
        await fetch('/api/cron', { method: 'DELETE', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ raw: entry.raw, target_user: 'root', sudo_password: '' }) });
      }
    } else {
      await fetch('/api/cron', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ minute: '*', hour: '*', day: '*', month: '*', weekday: '*',
          command: `curl -s http://localhost:${location.port || 80}/api/scheduler/tick > /dev/null 2>&1`,
          target_user: 'root', sudo_password: '' }) });
    }
    _renderSchedulerTab();
  }

  async function _load() {
    const content = _body.querySelector('#cm-content');
    content.innerHTML = `<div style="padding:24px;color:var(--text-dim);font-size:.83rem">${_cmt('loading')}</div>`;
    const url = _targetUser ? `/api/cron?user=${encodeURIComponent(_targetUser)}` : '/api/cron';
    const res = await fetch(url);
    _data = await res.json();
    _me = _data.me;
    if (!_targetUser) { _targetUser = _me; }
    const sel = _body.querySelector('#cm-user-sel');
    if (sel && sel.value !== _data.user) sel.value = _data.user;
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
    const newEnabled = entry.enabled === false;
    _withSudo(async (pwd, showErr) => {
      const res = await fetch('/api/cron/toggle', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ raw: entry.raw, enabled: newEnabled, target_user: _targetUser, sudo_password: pwd }) });
      const d = await res.json();
      if (res.ok) _load();
      else showErr(d.detail || _cmt('sudo_wrong_pw'));
    });
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

  function _withSudo(callback) {
    if (!_targetUser || _targetUser === _me) {
      callback('', () => {});
      return;
    }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:110';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:20px;width:340px;max-width:90%';
    box.innerHTML = `
      <div style="font-size:.9rem;font-weight:600;margin-bottom:8px;color:var(--text)">${_cmt('sudo_title')}</div>
      <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:14px">${_cmt('sudo_msg').replace('{user}', _targetUser)}</div>
      <input id="sudo-pw" type="password" placeholder="${_cmt('sudo_placeholder')}" autocomplete="current-password"
        style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.85rem;box-sizing:border-box;margin-bottom:8px">
      <div id="sudo-err" style="color:#f38ba8;font-size:.78rem;margin-bottom:8px;min-height:1.2em"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px">
        <button class="s-btn-sm" id="sudo-cancel">${_cmt('cancel')}</button>
        <button class="s-btn" id="sudo-ok">${_cmt('sudo_confirm')}</button>
      </div>
    `;
    const doConfirm = async () => {
      const pw = box.querySelector('#sudo-pw').value;
      const errEl = box.querySelector('#sudo-err');
      const okBtn = box.querySelector('#sudo-ok');
      errEl.textContent = '';
      okBtn.disabled = true;
      await callback(pw, (msg) => {
        errEl.textContent = msg;
        okBtn.disabled = false;
        box.querySelector('#sudo-pw').value = '';
        box.querySelector('#sudo-pw').focus();
      });
      if (!box.querySelector('#sudo-err').textContent) overlay.remove();
      else okBtn.disabled = false;
    };
    box.querySelector('#sudo-ok').addEventListener('click', doConfirm);
    box.querySelector('#sudo-pw').addEventListener('keydown', e => { if (e.key === 'Enter') doConfirm(); });
    box.querySelector('#sudo-cancel').addEventListener('click', () => overlay.remove());
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
    setTimeout(() => box.querySelector('#sudo-pw').focus(), 50);
  }

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
        <textarea id="cf-command" rows="3" placeholder="/path/to/script.sh >> /dev/null 2>&1"
          style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;font-family:var(--mono);box-sizing:border-box;resize:vertical;line-height:1.5">${isEdit ? entry.command.replace(/&/g,'&amp;').replace(/</g,'&lt;') : ''}</textarea>
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
      body_data.target_user = _targetUser;
      if (isEdit) body_data.old_raw = entry.raw;
      _withSudo(async (pwd, showErr) => {
        body_data.sudo_password = pwd;
        const res = await fetch('/api/cron', { method: isEdit ? 'PUT' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body_data) });
        const d = await res.json();
        if (res.ok) { overlay.remove(); _load(); }
        else if (res.status === 403) showErr(d.detail || _cmt('sudo_wrong_pw'));
        else { err.textContent = d.detail || 'Error'; err.style.display = ''; }
      });
    });
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _body.appendChild(overlay);
    box.querySelector('#cf-command').focus();
  }

  async function _delete(entry) {
    if (!confirm(`${_cmt('delete_confirm')}\n\n${entry.raw}`)) return;
    _withSudo(async (pwd, showErr) => {
      const res = await fetch('/api/cron', { method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ raw: entry.raw, target_user: _targetUser, sudo_password: pwd }) });
      const d = await res.json();
      if (res.ok) _load();
      else showErr(d.detail || _cmt('sudo_wrong_pw'));
    });
  }

  return { init };
})();
