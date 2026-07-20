// Tasks — shared widget used by both the desktop app window and the
// standalone Apps Hub public page (same three-file pattern as
// apps/budget/budget-widget.js: manifest + widget + main.js/public page).
(function () {
  if (window.TasksWidget) return;

  const API = '/pub/tasks';

  function t(key, vars) { return (window.t || (k => k))(key, vars); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtAmount(n) {
    n = Number(n) || 0;
    return (n >= 0 ? '+' : '') + (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
  }
  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function toLocalInputValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocalInputValue(val) {
    if (!val) return null;
    return new Date(val).toISOString();
  }

  let _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .tk-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);
        font-family:system-ui,sans-serif;font-size:.85rem;overflow:hidden}
      .tk-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2, #a6adc8);
        font-family:system-ui,sans-serif;font-size:.9rem;text-align:center;padding:20px}
      .tk-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0;flex-wrap:wrap}
      .tk-toolbar h2{margin:0;font-size:1rem;flex:1}
      .tk-tabs{display:flex;gap:4px;background:var(--pub-surface2, #313244);border-radius:6px;padding:2px}
      .tk-tab{background:none;border:none;color:var(--pub-fg2, #a6adc8);padding:5px 10px;border-radius:5px;cursor:pointer;font-size:.78rem;white-space:nowrap}
      .tk-tab.active{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .tk-btn{background:var(--pub-surface2, #313244);color:var(--pub-fg, #cdd6f4);border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.82rem;white-space:nowrap}
      .tk-btn:hover{background:var(--pub-border, #45475a)}
      .tk-btn-primary{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .tk-btn-primary:hover{background:var(--pub-accent-hover, #a6c8ff)}
      .tk-btn-danger{background:var(--pub-red, #f38ba8);color:var(--pub-bg, #1e1e2e)}
      .tk-btn-icon{background:none;border:none;color:var(--pub-fg2, #a6adc8);cursor:pointer;font-size:.9rem;padding:4px 6px;border-radius:4px}
      .tk-btn-icon:hover{background:var(--pub-border, #45475a);color:var(--pub-fg, #cdd6f4)}
      .tk-body{flex:1;overflow-y:auto;padding:14px}
      .tk-empty{color:var(--pub-dim, #6c7086);text-align:center;padding:40px 16px}
      .tk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
      .tk-card{background:var(--pub-surface2, #313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}
      .tk-card-head{display:flex;align-items:flex-start;gap:6px}
      .tk-card-title{font-weight:700;font-size:.95rem;word-break:break-word;flex:1;min-width:0}
      .tk-card-actions{display:flex;gap:2px;flex-wrap:wrap}
      .tk-card-desc{color:var(--pub-fg2, #a6adc8);font-size:.78rem;word-break:break-word}
      .tk-badges{display:flex;gap:6px;flex-wrap:wrap}
      .tk-badge{font-size:.7rem;padding:2px 8px;border-radius:10px;background:var(--pub-border, #45475a);color:var(--pub-fg2, #a6adc8);white-space:nowrap}
      .tk-badge-good{background:rgba(166,227,161,.22);color:var(--pub-green, #a6e3a1)}
      .tk-badge-bad{background:rgba(243,139,168,.22);color:var(--pub-red, #f38ba8)}
      .tk-badge-warn{background:rgba(249,168,37,.22);color:var(--pub-warning, #f9a825)}
      .tk-card-meta{font-size:.72rem;color:var(--pub-dim, #6c7086)}
      .tk-card-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:4px}
      .tk-timer{font-variant-numeric:tabular-nums;font-weight:700;font-size:.9rem}
      .tk-amount{font-weight:700;white-space:nowrap}
      .tk-amount-pos{color:var(--pub-green, #a6e3a1)}
      .tk-amount-neg{color:var(--pub-red, #f38ba8)}
      .tk-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
      .tk-dialog{background:var(--pub-bg, #1e1e2e);border-radius:10px;padding:18px;width:100%;max-width:440px;max-height:88%;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
      .tk-dialog h3{margin:0 0 4px}
      .tk-field label{display:block;font-size:.78rem;color:var(--pub-fg2, #a6adc8);margin-bottom:4px}
      .tk-field-hint{font-size:.72rem;color:var(--pub-dim, #6c7086);margin-top:4px}
      .tk-field input[type=text],.tk-field input[type=number],.tk-field input[type=datetime-local],
      .tk-field textarea,.tk-field select{
        width:100%;box-sizing:border-box;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);border-radius:6px;
        color:var(--pub-fg, #cdd6f4);padding:7px 9px;font-family:inherit;font-size:.85rem}
      .tk-field textarea{resize:vertical;min-height:50px}
      .tk-error{color:var(--pub-red, #f38ba8);font-size:.78rem}
      .tk-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
      .tk-toggle-row{display:flex;align-items:center;gap:8px}
      .tk-toggle-row label{font-size:.85rem}
      .tk-settings-block{max-width:420px;display:flex;flex-direction:column;gap:6px}
      .tk-history-list{display:flex;flex-direction:column;gap:6px}
      .tk-htx-row{display:flex;flex-direction:column;gap:2px;background:var(--pub-surface2, #313244);border-radius:8px;padding:8px 10px}
      .tk-htx-row-top{display:flex;align-items:center;gap:8px}
      .tk-htx-title{font-weight:600;font-size:.82rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .tk-htx-row-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .tk-htx-meta{font-size:.68rem;color:var(--pub-dim, #6c7086)}
      .tk-toast{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:var(--pub-surface2, #313244);
        border:1px solid var(--pub-border, #45475a);border-radius:8px;padding:8px 14px;font-size:.82rem;z-index:80;
        box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;transition:opacity .2s}
      .tk-toast.show{opacity:1}
      .tk-toast-good{border-color:var(--pub-green, #a6e3a1)}
      .tk-toast-bad{border-color:var(--pub-red, #f38ba8)}
      @media (max-width:520px){
        .tk-grid{grid-template-columns:1fr}
        .tk-toolbar{flex-wrap:wrap}
        .tk-toolbar h2{flex:1 1 100%}
        .tk-dialog{max-width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = `<div class="tk-login">${esc(t('tk_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    let destroyed = false;
    let tasks = [];
    let settings = { budget_integration: false };
    let budgetCategories = { available: false, categories: [] };
    let timerInterval = null;
    let currentTab = 'tasks';

    root.style.position = 'relative';
    root.innerHTML = `<div class="tk-widget">
      <div class="tk-toolbar">
        <h2>✅ ${esc(t('tk_title'))}</h2>
        <div class="tk-tabs" id="tk-tabs">
          <button class="tk-tab active" data-tab="tasks">${esc(t('tk_tab_tasks'))}</button>
          <button class="tk-tab" data-tab="history">${esc(t('tk_tab_history'))}</button>
          <button class="tk-tab" data-tab="settings">${esc(t('tk_tab_settings'))}</button>
        </div>
        <button class="tk-btn tk-btn-primary" id="tk-add-btn">${esc(t('tk_add'))}</button>
      </div>
      <div class="tk-body">
        <div class="tk-grid" id="tk-grid"></div>
        <div id="tk-history-view" style="display:none"></div>
        <div id="tk-settings-view" style="display:none"></div>
      </div>
    </div>`;
    const widgetEl = root.querySelector('.tk-widget');
    const gridEl = root.querySelector('#tk-grid');
    const historyViewEl = root.querySelector('#tk-history-view');
    const settingsViewEl = root.querySelector('#tk-settings-view');
    const addBtn = root.querySelector('#tk-add-btn');

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('http_' + r.status));
        return data;
      });
    }

    function overlay(contentHtml) {
      const ov = document.createElement('div');
      ov.className = 'tk-overlay';
      ov.innerHTML = contentHtml;
      widgetEl.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
      return ov;
    }

    function toast(msg, kind) {
      const el = document.createElement('div');
      el.className = 'tk-toast' + (kind === 'good' ? ' tk-toast-good' : kind === 'bad' ? ' tk-toast-bad' : '');
      el.textContent = msg;
      widgetEl.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2600);
    }

    function showRewardToast(result) {
      if (!result || !result.category_id) return;
      const reward = result.reward || {};
      if (reward.budget_ok) {
        toast(reward.amount >= 0 ? t('tk_reward_applied') : t('tk_penalty_applied'), reward.amount >= 0 ? 'good' : 'bad');
      } else {
        toast(t('tk_reward_failed'), 'bad');
      }
    }

    function setTab(tab) {
      currentTab = tab;
      root.querySelectorAll('.tk-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
      gridEl.style.display = tab === 'tasks' ? '' : 'none';
      historyViewEl.style.display = tab === 'history' ? '' : 'none';
      settingsViewEl.style.display = tab === 'settings' ? '' : 'none';
      addBtn.style.display = tab === 'tasks' ? '' : 'none';
      if (tab === 'tasks') refreshTasks();
      else if (tab === 'history') loadHistory();
      else if (tab === 'settings') renderSettings();
    }
    root.querySelectorAll('.tk-tab').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
    addBtn.onclick = () => openTaskForm(null);

    function typeLabel(type) {
      return type === 'persistent' ? t('tk_type_persistent') : type === 'onetime' ? t('tk_type_onetime') : t('tk_type_periodic');
    }
    function periodLabel(period) {
      return period === 'daily' ? t('tk_period_daily') : period === 'weekly' ? t('tk_period_weekly') : t('tk_period_monthly');
    }

    function renderTaskCard(task) {
      const badges = [`<span class="tk-badge">${esc(typeLabel(task.type))}</span>`];
      let footHtml = '';

      if (task.type === 'persistent') {
        if (task.reward_mode === 'hourly') {
          if (task.timer_running) {
            badges.push(`<span class="tk-badge tk-badge-good">${esc(t('tk_timer_running'))}</span>`);
            footHtml = `<span class="tk-timer" data-timer="${esc(task.id)}" data-started="${esc(task.timer_started_at)}">${fmtDuration(task.elapsed_seconds || 0)}</span>
              <button class="tk-btn tk-btn-danger" data-action="stop-timer">${esc(t('tk_stop_timer'))}</button>`;
          } else {
            footHtml = `<span></span><button class="tk-btn tk-btn-primary" data-action="start-timer">${esc(t('tk_start_timer'))}</button>`;
          }
        } else {
          footHtml = `<span></span><button class="tk-btn tk-btn-primary" data-action="complete">${esc(t('tk_complete'))}</button>`;
        }
      } else if (task.type === 'onetime') {
        if (task.completed) badges.push(`<span class="tk-badge tk-badge-good">${esc(t('tk_completed'))}</span>`);
        else if (task.overdue) badges.push(`<span class="tk-badge tk-badge-bad">${esc(t('tk_overdue'))}</span>`);
        const dueHtml = task.due_at ? `<span class="tk-card-meta">${esc(t('tk_due'))}: ${esc(fmtDate(task.due_at))}</span>` : '<span></span>';
        footHtml = task.completed ? `${dueHtml}<span></span>` :
          `${dueHtml}<button class="tk-btn tk-btn-primary" data-action="complete">${esc(t('tk_complete'))}</button>`;
      } else if (task.type === 'periodic') {
        badges.push(`<span class="tk-badge">${esc(periodLabel(task.period))}</span>`);
        if (task.done_this_period) {
          badges.push(`<span class="tk-badge tk-badge-good">${esc(t('tk_done_this_period'))}</span>`);
          footHtml = `<span></span><span></span>`;
        } else {
          badges.push(`<span class="tk-badge tk-badge-warn">${esc(t('tk_not_done_this_period'))}</span>`);
          footHtml = `<span></span><button class="tk-btn tk-btn-primary" data-action="complete">${esc(t('tk_complete'))}</button>`;
        }
      }

      const rewardHint = (task.category_id && task.reward_amount != null)
        ? `<span class="tk-amount ${task.reward_amount >= 0 ? 'tk-amount-pos' : 'tk-amount-neg'}">${fmtAmount(task.reward_amount)}${task.reward_mode === 'hourly' ? '/h' : ''}</span>`
        : '';

      return `<div class="tk-card" data-id="${esc(task.id)}">
        <div class="tk-card-head">
          <div class="tk-card-title">${esc(task.title)}</div>
          ${rewardHint}
          <div class="tk-card-actions">
            <button class="tk-btn-icon" data-action="edit" title="${esc(t('tk_edit'))}">✎</button>
            <button class="tk-btn-icon" data-action="delete" title="${esc(t('tk_delete'))}">🗑</button>
          </div>
        </div>
        ${task.description ? `<div class="tk-card-desc">${esc(task.description)}</div>` : ''}
        <div class="tk-badges">${badges.join('')}</div>
        <div class="tk-card-foot">${footHtml}</div>
      </div>`;
    }

    function renderTasks() {
      stopTimerTicker();
      if (!tasks.length) {
        gridEl.innerHTML = `<div class="tk-empty" style="grid-column:1/-1">${esc(t('tk_no_tasks'))}</div>`;
        return;
      }
      gridEl.innerHTML = tasks.map(renderTaskCard).join('');
      gridEl.querySelectorAll('.tk-card').forEach(card => {
        const id = card.dataset.id;
        const task = tasks.find(x => x.id === id);
        const editBtn = card.querySelector('[data-action="edit"]');
        if (editBtn) editBtn.onclick = () => openTaskForm(task);
        const delBtn = card.querySelector('[data-action="delete"]');
        if (delBtn) delBtn.onclick = () => deleteTask(task);
        const completeBtn = card.querySelector('[data-action="complete"]');
        if (completeBtn) completeBtn.onclick = () => completeTask(task);
        const startBtn = card.querySelector('[data-action="start-timer"]');
        if (startBtn) startBtn.onclick = () => startTimer(task);
        const stopBtn = card.querySelector('[data-action="stop-timer"]');
        if (stopBtn) stopBtn.onclick = () => stopTimer(task);
      });
      startTimerTicker();
    }

    function startTimerTicker() {
      stopTimerTicker();
      const running = gridEl.querySelectorAll('[data-timer]');
      if (!running.length) return;
      timerInterval = setInterval(() => {
        gridEl.querySelectorAll('[data-timer]').forEach(el => {
          const started = new Date(el.dataset.started).getTime();
          el.textContent = fmtDuration((Date.now() - started) / 1000);
        });
      }, 1000);
    }
    function stopTimerTicker() {
      if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    }

    async function refreshTasks() {
      try { tasks = await api('/tasks'); } catch (e) { tasks = []; }
      if (destroyed) return;
      renderTasks();
    }

    async function completeTask(task) {
      try {
        const result = await api(`/tasks/${task.id}/complete`, { method: 'POST' });
        showRewardToast(result);
        await refreshTasks();
      } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }
    async function startTimer(task) {
      try { await api(`/tasks/${task.id}/timer/start`, { method: 'POST' }); await refreshTasks(); }
      catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }
    async function stopTimer(task) {
      try {
        const result = await api(`/tasks/${task.id}/timer/stop`, { method: 'POST' });
        showRewardToast(result);
        await refreshTasks();
      } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }
    async function deleteTask(task) {
      if (!confirm(t('tk_confirm_delete', { title: task.title }))) return;
      try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); await refreshTasks(); }
      catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }

    async function ensureBudgetCategories() {
      if (!settings.budget_integration) { budgetCategories = { available: false, categories: [] }; return; }
      try { budgetCategories = await api('/budget-categories'); }
      catch (e) { budgetCategories = { available: false, categories: [] }; }
    }

    function openTaskForm(existing) {
      const isEdit = !!existing;
      const type = existing ? existing.type : 'persistent';
      const rewardMode = existing ? existing.reward_mode : 'fixed';
      const hasCategory = !!(existing && existing.category_id);

      const catOptions = budgetCategories.categories.map(c =>
        `<option value="${esc(c.id)}" ${existing && existing.category_id === c.id ? 'selected' : ''}>${esc(c.title)}</option>`
      ).join('');

      const ov = overlay(`<div class="tk-dialog">
        <h3>${esc(isEdit ? t('tk_edit_task') : t('tk_new_task'))}</h3>
        <div class="tk-field">
          <input type="text" id="tk-f-title" maxlength="200" placeholder="${esc(t('tk_task_title_ph'))}" value="${esc(existing ? existing.title : '')}"></div>
        <div class="tk-field">
          <textarea id="tk-f-desc" maxlength="1000" placeholder="${esc(t('tk_description_ph'))}">${esc(existing ? existing.description : '')}</textarea></div>
        <div class="tk-field"><label>${esc(t('tk_type'))}</label>
          <select id="tk-f-type" ${isEdit ? 'disabled' : ''}>
            <option value="persistent" ${type === 'persistent' ? 'selected' : ''}>${esc(t('tk_type_persistent'))}</option>
            <option value="onetime" ${type === 'onetime' ? 'selected' : ''}>${esc(t('tk_type_onetime'))}</option>
            <option value="periodic" ${type === 'periodic' ? 'selected' : ''}>${esc(t('tk_type_periodic'))}</option>
          </select>
        </div>
        <div id="tk-f-persistent-wrap" style="display:none">
          <div class="tk-field"><label>${esc(t('tk_reward_mode'))}</label>
            <select id="tk-f-reward-mode">
              <option value="fixed" ${rewardMode === 'fixed' ? 'selected' : ''}>${esc(t('tk_reward_mode_fixed'))}</option>
              <option value="hourly" ${rewardMode === 'hourly' ? 'selected' : ''}>${esc(t('tk_reward_mode_hourly'))}</option>
            </select>
          </div>
        </div>
        <div id="tk-f-onetime-wrap" style="display:none">
          <div class="tk-field"><label>${esc(t('tk_due_at'))}</label>
            <input type="datetime-local" id="tk-f-due-at" value="${existing && existing.due_at ? toLocalInputValue(existing.due_at) : ''}"></div>
        </div>
        <div id="tk-f-periodic-wrap" style="display:none">
          <div class="tk-field"><label>${esc(t('tk_period'))}</label>
            <select id="tk-f-period">
              <option value="daily" ${existing && existing.period === 'daily' ? 'selected' : ''}>${esc(t('tk_period_daily'))}</option>
              <option value="weekly" ${existing && existing.period === 'weekly' ? 'selected' : ''}>${esc(t('tk_period_weekly'))}</option>
              <option value="monthly" ${existing && existing.period === 'monthly' ? 'selected' : ''}>${esc(t('tk_period_monthly'))}</option>
            </select>
          </div>
        </div>
        <div id="tk-f-budget-wrap" style="display:${settings.budget_integration ? '' : 'none'}">
          ${!settings.budget_integration ? '' : !budgetCategories.available ? `
          <div class="tk-field-hint">${esc(t('tk_budget_unavailable'))}</div>` : `
          <div class="tk-field"><label>${esc(t('tk_category'))}</label>
            <select id="tk-f-category">
              <option value="">${esc(t('tk_category_none'))}</option>
              ${catOptions}
            </select>
            <div class="tk-field-hint">${esc(budgetCategories.categories.length ? t('tk_reward_optional_hint') : t('tk_no_categories'))}</div>
          </div>
          <div class="tk-field" id="tk-f-amount-wrap" style="display:${hasCategory ? '' : 'none'}">
            <label>${esc(t('tk_amount'))}</label>
            <input type="number" id="tk-f-amount" step="0.01" value="${existing && existing.reward_amount != null ? existing.reward_amount : ''}">
            <div class="tk-field-hint" id="tk-f-amount-hint"></div>
          </div>`}
        </div>
        <div class="tk-error" id="tk-f-error" style="display:none"></div>
        <div class="tk-dialog-actions">
          <button class="tk-btn" id="tk-f-cancel">${esc(t('tk_cancel'))}</button>
          <button class="tk-btn tk-btn-primary" id="tk-f-save">${esc(t('tk_save'))}</button>
        </div>
      </div>`);

      const errEl = ov.querySelector('#tk-f-error');
      const typeSelect = ov.querySelector('#tk-f-type');
      const rewardModeSelect = ov.querySelector('#tk-f-reward-mode');
      const persistentWrap = ov.querySelector('#tk-f-persistent-wrap');
      const onetimeWrap = ov.querySelector('#tk-f-onetime-wrap');
      const periodicWrap = ov.querySelector('#tk-f-periodic-wrap');
      const categorySelect = ov.querySelector('#tk-f-category');
      const amountWrap = ov.querySelector('#tk-f-amount-wrap');
      const amountHint = ov.querySelector('#tk-f-amount-hint');

      function syncTypeFields() {
        const val = typeSelect.value;
        persistentWrap.style.display = val === 'persistent' ? '' : 'none';
        onetimeWrap.style.display = val === 'onetime' ? '' : 'none';
        periodicWrap.style.display = val === 'periodic' ? '' : 'none';
        if (amountHint) {
          amountHint.textContent = (val === 'persistent' && rewardModeSelect.value === 'hourly')
            ? t('tk_amount_hourly_hint') : t('tk_amount_hint');
        }
      }
      typeSelect.onchange = syncTypeFields;
      rewardModeSelect.onchange = syncTypeFields;
      if (categorySelect) categorySelect.onchange = () => { amountWrap.style.display = categorySelect.value ? '' : 'none'; };
      syncTypeFields();

      ov.querySelector('#tk-f-cancel').onclick = () => ov.remove();
      ov.querySelector('#tk-f-save').onclick = async () => {
        const title = ov.querySelector('#tk-f-title').value.trim();
        if (!title) { errEl.textContent = t('tk_error'); errEl.style.display = 'block'; return; }
        const selType = typeSelect.value;
        const body = {
          title,
          description: ov.querySelector('#tk-f-desc').value.trim(),
          type: selType,
          reward_mode: selType === 'persistent' ? rewardModeSelect.value : 'fixed',
          reward_amount: null,
          category_id: null,
          due_at: null,
          period: null,
        };
        if (selType === 'onetime') {
          body.due_at = fromLocalInputValue(ov.querySelector('#tk-f-due-at').value);
          if (!body.due_at) { errEl.textContent = t('tk_due_at'); errEl.style.display = 'block'; return; }
        } else if (selType === 'periodic') {
          body.period = ov.querySelector('#tk-f-period').value;
        }
        const catVal = categorySelect.value;
        if (catVal) {
          const amtRaw = ov.querySelector('#tk-f-amount').value;
          const amt = parseFloat(amtRaw);
          if (isNaN(amt) || amt === 0) { errEl.textContent = t('tk_amount'); errEl.style.display = 'block'; return; }
          body.category_id = catVal;
          body.reward_amount = amt;
        }
        try {
          if (isEdit) await api(`/tasks/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
          else await api('/tasks', { method: 'POST', body: JSON.stringify(body) });
          ov.remove();
          await refreshTasks();
        } catch (e) {
          errEl.textContent = e.message || t('tk_error');
          errEl.style.display = 'block';
        }
      };
    }

    async function loadHistory() {
      historyViewEl.innerHTML = `<div class="tk-empty">…</div>`;
      let rows;
      try { rows = await api('/history'); } catch (e) { rows = []; }
      if (destroyed) return;
      if (!rows.length) { historyViewEl.innerHTML = `<div class="tk-empty">${esc(t('tk_no_history'))}</div>`; return; }
      historyViewEl.innerHTML = `<div class="tk-history-list">${rows.map(r => `
        <div class="tk-htx-row">
          <div class="tk-htx-row-top">
            <span class="tk-htx-title">${esc(r.task_title)}</span>
            <span class="tk-amount ${r.amount >= 0 ? 'tk-amount-pos' : 'tk-amount-neg'}">${fmtAmount(r.amount)}</span>
          </div>
          <div class="tk-htx-row-bottom">
            <span class="tk-htx-meta">
              ${r.duration_hours != null ? `${r.duration_hours.toFixed(2)}h · ` : ''}
              ${r.budget_ok ? esc(t('tk_reward_applied')) : ''}
            </span>
            <span class="tk-htx-meta">${esc(fmtDate(r.created_at))}</span>
          </div>
        </div>`).join('')}</div>`;
    }

    async function renderSettings() {
      settingsViewEl.innerHTML = `<div class="tk-settings-block">
        <div class="tk-toggle-row">
          <input type="checkbox" id="tk-s-budget" ${settings.budget_integration ? 'checked' : ''}>
          <label for="tk-s-budget">${esc(t('tk_budget_integration'))}</label>
        </div>
        <div class="tk-field-hint">${esc(t('tk_budget_integration_hint'))}</div>
      </div>`;
      settingsViewEl.querySelector('#tk-s-budget').onchange = async e => {
        const enabled = e.target.checked;
        try {
          await api('/me/settings', { method: 'PUT', body: JSON.stringify({ budget_integration: enabled }) });
          settings.budget_integration = enabled;
          await ensureBudgetCategories();
        } catch (err) {
          e.target.checked = !enabled;
          toast(t('tk_error'), 'bad');
        }
      };
    }

    async function init() {
      try { settings = await api('/me'); } catch (e) { settings = { budget_integration: false }; }
      if (destroyed) return;
      await ensureBudgetCategories();
      if (destroyed) return;
      await refreshTasks();
    }
    init();

    return {
      destroy() {
        destroyed = true;
        stopTimerTicker();
      },
    };
  }

  window.TasksWidget = { mount };
})();
