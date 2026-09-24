// Tasks — shared widget used by both the desktop app window and the
// standalone Apps Hub public page (same three-file pattern as
// apps/budget/budget-widget.js: manifest + widget + main.js/public page).
(function () {
  if (window.TasksWidget) return;

  const API = '/pub/tasks';
  // The account's own saved date/time display choice (Apps Hub profile).
  let _tkPrefs = {};
  (() => { const tok = localStorage.getItem('apphub_token'); if (tok) fetch('/api/pub/apphub/me',{headers:{'X-Pub-Token':tok}}).then(r=>r.ok?r.json():{}).then(p=>{_tkPrefs=p}).catch(()=>{}); })();

  function t(key, vars) { return (window.t || (k => k))(key, vars); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const CURRENCY_SYMBOLS = {
    EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥', CNY: '¥', TRY: '₺',
    UAH: '₴', PLN: 'zł', RON: 'lei', CZK: 'Kč', HUF: 'Ft', CAD: '$', AUD: '$',
    SEK: 'kr', NOK: 'kr', DKK: 'kr', RUB: '₽', INR: '₹', BTC: '₿',
  };
  function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code || '';
  }
  function fmtAmount(n, currency) {
    n = Number(n) || 0;
    const sign = (n >= 0 ? '+' : '') + (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
    return currency ? sign + ' ' + currencySymbol(currency) : sign;
  }
  // The full amount is applied to EACH selected category (never split), so with
  // more than one category the real Budget total is amount × count. Spell the
  // maths out — "0.16" alone reads as if a single category got 0.16.
  function fmtAmountBreakdown(perCategory, count, currency) {
    const total = fmtAmount(perCategory * count, currency);
    if (!count || count < 2) return total;
    const per = (Math.round((Math.abs(perCategory) + Number.EPSILON) * 100) / 100).toFixed(2);
    return `${count}×${per} = ${total}`;
  }
  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    let dateStr = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
    if (_tkPrefs.date_format) {
      const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
      dateStr = _tkPrefs.date_format==='MM/DD/YYYY' ? `${v.month}/${v.day}/${v.year.slice(2)}` : _tkPrefs.date_format==='YYYY-MM-DD' ? `${v.year}-${v.month}-${v.day}` : `${v.day}/${v.month}/${v.year.slice(2)}`;
    }
    const timeStr = _tkPrefs.time_format ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:_tkPrefs.time_format==='12'}) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return dateStr + ' ' + timeStr;
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
      .tk-acc-section{border:1px solid var(--pub-surface2, #313244);border-radius:10px;margin-bottom:12px;padding:0 12px 12px}
      .tk-acc-section[open]{padding-bottom:12px}
      .tk-acc-section:not([open]){padding-bottom:0}
      .tk-acc-header{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;padding:12px 0;font-weight:700;font-size:.9rem}
      .tk-acc-header::-webkit-details-marker{display:none}
      .tk-acc-header::before{content:'▸';display:inline-block;transition:transform .15s;color:var(--pub-fg2, #a6adc8)}
      .tk-acc-section[open]>.tk-acc-header::before{transform:rotate(90deg)}
      .tk-acc-title{flex:1}
      .tk-acc-add{background:none;border:none;color:var(--pub-fg2, #a6adc8);cursor:pointer;font-size:1rem;line-height:1;padding:2px 7px;border-radius:5px}
      .tk-acc-add:hover{background:var(--pub-border, #45475a);color:var(--pub-fg, #cdd6f4)}
      .tk-acc-section .tk-acc-section{margin:12px 0 0;background:rgba(255,255,255,.02)}
      .tk-acc-section .tk-acc-section .tk-acc-header{font-size:.85rem}
      .tk-acc-count{font-size:.72rem;font-weight:400;color:var(--pub-dim, #6c7086);background:var(--pub-surface2, #313244);border-radius:10px;padding:1px 8px}
      .tk-acc-count.tk-active{color:#fff;background:var(--pub-accent, #89b4fa);font-weight:700}
      .tk-todo-list{display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto}
      .tk-todo-item{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid var(--pub-surface2, #313244)}
      .tk-todo-item-title{flex:1;min-width:0;word-break:break-word;font-size:.85rem}
      .tk-todo-item.done .tk-todo-item-title{text-decoration:line-through;color:var(--pub-dim, #6c7086)}
      .tk-todo-item-meta{font-size:.68rem;color:var(--pub-dim, #6c7086);white-space:nowrap}
      .tk-todo-add-row{display:flex;gap:6px;margin-top:6px}
      .tk-todo-add-row input{flex:1}
      .tk-proj-row{display:flex;align-items:center;gap:6px;padding:4px 0}
      .tk-proj-title{flex:1;font-size:.85rem}
      .tk-proj-sub-add{display:flex;gap:6px;padding:4px 0}
      .tk-proj-sub-add input{flex:1}
      .tk-btn-icon[disabled]{opacity:.3;cursor:default}
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
      .tk-cat-list{max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;
        border:1px solid var(--pub-border, #45475a);border-radius:6px;padding:6px 8px;background:var(--pub-bg, #1e1e2e)}
      .tk-cat-item{display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer}
      .tk-error{color:var(--pub-red, #f38ba8);font-size:.78rem}
      .tk-stop-summary{display:flex;flex-direction:column;gap:6px;background:var(--pub-surface2, #313244);
        border-radius:8px;padding:10px 12px}
      .tk-stop-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .tk-stop-row > span:first-child{color:var(--pub-fg2, #a6adc8);font-size:.8rem;white-space:nowrap}
      .tk-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap}
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
    let projects = [];
    let settings = { budget_integration: false };
    let budgetCategories = { available: false, categories: [] };
    let timerInterval = null;
    let currentTab = 'tasks';
    // Which accordion sections are expanded, keyed by project id ('' = the
    // trailing "Other" section for tasks with no project). Whichever project
    // is first (lowest position) is seeded open; re-seeded after a manual
    // reorder so the user sees the effect right away, but otherwise left
    // alone — re-rendering after an unrelated action must never re-collapse
    // what the user opened themselves.
    const expandedSections = {};
    let expandedSeeded = false;
    function seedExpandedSections() {
      if (expandedSeeded) return;
      expandedSeeded = true;
      rootProjects().forEach((p, i) => { expandedSections[p.id] = i === 0; });
      expandedSections[''] = false;
    }

    // Projects form a tree through parent_id. A project whose parent is gone
    // is treated as top-level so it never disappears from view.
    function rootProjects() {
      return projects.filter(p => !p.parent_id || !projects.some(q => q.id === p.parent_id));
    }
    function childProjects(id) {
      return projects.filter(p => p.parent_id === id);
    }
    function projectTree() {
      const out = [];
      const walk = (list, depth) => list.forEach(p => { out.push({ p, depth }); walk(childProjects(p.id), depth + 1); });
      walk(rootProjects(), 0);
      return out;
    }

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
        <div id="tk-grid"></div>
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
      if (!result || !result.category_ids || !result.category_ids.length) {
        toast(t('tk_task_completed_toast'), 'good');
        return;
      }
      const reward = result.reward || {};
      if (reward.budget_ok) {
        const applied = (reward.categories || []).filter(r => r.budget_ok);
        const perCategory = applied.length ? (Number(applied[0].amount) || 0) : reward.amount;
        const amount = fmtAmountBreakdown(perCategory, applied.length, budgetCategories.currency);
        toast(reward.amount >= 0
          ? t('tk_reward_applied_amount', { amount })
          : t('tk_penalty_applied_amount', { amount }), reward.amount >= 0 ? 'good' : 'bad');
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
    gridEl.addEventListener('click', e => {
      const btn = e.target.closest('.tk-acc-add');
      if (!btn) return;
      // The button sits inside <summary>; keep the section from toggling.
      e.preventDefault();
      e.stopPropagation();
      openTaskForm(null, btn.dataset.project);
    });

    function typeLabel(type) {
      return type === 'persistent' ? t('tk_type_persistent') : type === 'onetime' ? t('tk_type_onetime')
        : type === 'todo' ? t('tk_type_todo') : t('tk_type_periodic');
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
            footHtml = `<span class="tk-timer" data-timer="${esc(task.id)}" data-started="${esc(task.timer_started_at)}" data-base="${esc(task.timer_elapsed_seconds || 0)}">${fmtDuration(task.elapsed_seconds || 0)}</span>
              <button class="tk-btn tk-btn-primary" data-action="stop-timer">${esc(t('tk_stop_timer'))}</button>`;
          } else if (task.timer_paused) {
            badges.push(`<span class="tk-badge tk-badge-warn">${esc(t('tk_timer_paused'))}</span>`);
            footHtml = `<span class="tk-timer">${fmtDuration(task.elapsed_seconds || 0)}</span>
              <button class="tk-btn tk-btn-primary" data-action="stop-timer">${esc(t('tk_resume_timer'))}</button>`;
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
      } else if (task.type === 'todo') {
        const total = task.todo_total || 0;
        const done = task.todo_done || 0;
        badges.push(`<span class="tk-badge ${total && done === total ? 'tk-badge-good' : ''}">${esc(t('tk_todo_progress', { done, total }))}</span>`);
        footHtml = `<span></span><button class="tk-btn tk-btn-primary" data-action="open-todo">${esc(t('tk_open'))}</button>`;
      }

      const rewardHint = (task.category_ids && task.category_ids.length && task.reward_amount != null)
        ? `<span class="tk-amount ${task.reward_amount >= 0 ? 'tk-amount-pos' : 'tk-amount-neg'}">${fmtAmount(task.reward_amount, budgetCategories.currency)}${task.reward_mode === 'hourly' ? '/h' : ''}</span>`
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

    function tasksGridHtml(list) {
      return `<div class="tk-grid">${list.map(renderTaskCard).join('')}</div>`;
    }

    function renderTasks() {
      stopTimerTicker();
      if (!tasks.length) {
        gridEl.innerHTML = `<div class="tk-empty">${esc(t('tk_no_tasks'))}</div>`;
        wireTaskCards();
        return;
      }
      if (!projects.length) {
        gridEl.innerHTML = tasksGridHtml(tasks);
        wireTaskCards();
        startTimerTicker();
        return;
      }
      const byProject = {};
      tasks.forEach(task => {
        const key = projects.some(p => p.id === task.project_id) ? task.project_id : '';
        (byProject[key] = byProject[key] || []).push(task);
      });
      // A section's count and "timer running" mark cover its subprojects too,
      // so a collapsed parent still shows what is going on inside it.
      function subtreeTasks(id) {
        return (byProject[id] || []).concat(...childProjects(id).map(c => subtreeTasks(c.id)));
      }
      function sectionHtml(id, title, own, all, children) {
        const active = all.some(x => x.timer_running);
        const inner = (own.length ? tasksGridHtml(own) : '') + children.map(projectSectionHtml).join('');
        return `
        <details class="tk-acc-section" data-project="${esc(id)}" ${expandedSections[id] ? 'open' : ''}>
          <summary class="tk-acc-header">
            <span class="tk-acc-title">${esc(title)}</span>
            ${id ? `<button class="tk-acc-add" data-project="${esc(id)}" title="${esc(t('tk_add_task_to_project'))}">＋</button>` : ''}
            <span class="tk-acc-count${active ? ' tk-active' : ''}">${all.length}</span>
          </summary>
          ${inner || `<div class="tk-empty">${esc(t('tk_no_tasks'))}</div>`}
        </details>`;
      }
      function projectSectionHtml(p) {
        return sectionHtml(p.id, p.title, byProject[p.id] || [], subtreeTasks(p.id), childProjects(p.id));
      }

      const other = byProject[''] || [];
      gridEl.innerHTML = rootProjects().map(projectSectionHtml).join('')
        + (other.length ? sectionHtml('', t('tk_project_other'), other, other, []) : '');

      gridEl.querySelectorAll('.tk-acc-section').forEach(sec => {
        sec.addEventListener('toggle', e => {
          if (e.target !== sec) return;
          expandedSections[sec.dataset.project] = sec.open;
        });
      });
      wireTaskCards();
      startTimerTicker();
    }

    function wireTaskCards() {
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
        const openBtn = card.querySelector('[data-action="open-todo"]');
        if (openBtn) openBtn.onclick = () => openTodoDialog(task);
      });
    }

    function startTimerTicker() {
      stopTimerTicker();
      const running = gridEl.querySelectorAll('[data-timer]');
      if (!running.length) return;
      timerInterval = setInterval(() => {
        gridEl.querySelectorAll('[data-timer]').forEach(el => {
          const started = new Date(el.dataset.started).getTime();
          el.textContent = fmtDuration((Number(el.dataset.base) || 0) + (Date.now() - started) / 1000);
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
    // Stop pauses the timer first (so no time accrues while the user decides),
    // then asks what to do with the tracked time: resume, throw it away, or save it.
    async function stopTimer(task) {
      let paused = task;
      if (task.timer_running) {
        try {
          paused = await api(`/tasks/${task.id}/timer/pause`, { method: 'POST' });
        } catch (e) { toast(e.message || t('tk_error'), 'bad'); return; }
      }
      await refreshTasks();
      openStopDialog(tasks.find(x => x.id === task.id) || paused);
    }

    function openStopDialog(task) {
      const elapsed = task.elapsed_seconds || 0;
      const catCount = (task.category_ids || []).length;
      const hasAmount = catCount && task.reward_amount != null;
      const accrued = hasAmount ? task.reward_amount * (elapsed / 3600) : null;

      const ov = overlay(`<div class="tk-dialog">
        <h3>${esc(t('tk_stop_title'))}</h3>
        <div class="tk-card-desc">${esc(task.title)}</div>
        <div class="tk-stop-summary">
          <div class="tk-stop-row">
            <span>${esc(t('tk_elapsed'))}</span>
            <span class="tk-timer">${fmtDuration(elapsed)}</span>
          </div>
          ${accrued == null ? '' : `<div class="tk-stop-row">
            <span>${esc(t('tk_stop_accrued'))}</span>
            <span class="tk-amount ${accrued >= 0 ? 'tk-amount-pos' : 'tk-amount-neg'}">${esc(fmtAmountBreakdown(accrued, catCount, budgetCategories.currency))}</span>
          </div>`}
        </div>
        <div class="tk-field-hint">${esc(t('tk_stop_hint'))}</div>
        <div class="tk-dialog-actions">
          <button class="tk-btn tk-btn-danger" id="tk-stop-discard">${esc(t('tk_stop_discard'))}</button>
          <button class="tk-btn" id="tk-stop-continue">${esc(t('tk_resume_timer'))}</button>
          <button class="tk-btn tk-btn-primary" id="tk-stop-save">${esc(t('tk_save'))}</button>
        </div>
      </div>`);

      ov.querySelector('#tk-stop-continue').onclick = async () => {
        ov.remove();
        await startTimer(task);
      };
      ov.querySelector('#tk-stop-discard').onclick = async () => {
        if (!confirm(t('tk_stop_discard_confirm'))) return;
        ov.remove();
        await discardTimer(task);
      };
      ov.querySelector('#tk-stop-save').onclick = async () => {
        ov.remove();
        await completeTimer(task);
      };
    }

    async function discardTimer(task) {
      try {
        await api(`/tasks/${task.id}/timer/discard`, { method: 'POST' });
        toast(t('tk_stop_discarded'));
        await refreshTasks();
      } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }
    async function completeTimer(task) {
      try {
        const result = await api(`/tasks/${task.id}/timer/complete`, { method: 'POST' });
        showRewardToast(result);
        await refreshTasks();
      } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }
    async function deleteTask(task) {
      if (!confirm(t('tk_confirm_delete', { title: task.title }))) return;
      try { await api(`/tasks/${task.id}`, { method: 'DELETE' }); await refreshTasks(); }
      catch (e) { toast(e.message || t('tk_error'), 'bad'); }
    }

    function renderTodoItem(item) {
      const done = !!item.completed_at;
      return `<div class="tk-todo-item ${done ? 'done' : ''}" data-id="${esc(item.id)}">
        <input type="checkbox" data-action="toggle" ${done ? 'checked' : ''}>
        <span class="tk-todo-item-title">${esc(item.title)}</span>
        ${done ? `<span class="tk-todo-item-meta">${esc(fmtDate(item.completed_at))}</span>` : ''}
        <button class="tk-btn-icon" data-action="delete-item" title="${esc(t('tk_delete'))}">🗑</button>
      </div>`;
    }

    async function openTodoDialog(task) {
      const ov = overlay(`<div class="tk-dialog">
        <h3>${esc(task.title)}</h3>
        <div class="tk-todo-list" id="tk-todo-list"><div class="tk-empty">…</div></div>
        <div class="tk-todo-add-row">
          <input type="text" id="tk-todo-add-input" maxlength="2000" placeholder="${esc(t('tk_todo_add_item_ph'))}">
          <button class="tk-btn tk-btn-primary" id="tk-todo-add-btn">${esc(t('tk_add_item'))}</button>
        </div>
        <div class="tk-dialog-actions">
          <button class="tk-btn" id="tk-todo-copy">${esc(t('tk_todo_copy'))}</button>
          <button class="tk-btn" id="tk-todo-close">${esc(t('tk_close'))}</button>
        </div>
      </div>`);
      const listEl = ov.querySelector('#tk-todo-list');
      const input = ov.querySelector('#tk-todo-add-input');
      let currentItems = [];

      async function reload() {
        let items;
        try { items = await api(`/tasks/${task.id}/items`); } catch (e) { items = []; }
        if (!ov.isConnected) return;
        currentItems = items;
        listEl.innerHTML = items.length ? items.map(renderTodoItem).join('') : `<div class="tk-empty">${esc(t('tk_todo_no_items'))}</div>`;
        listEl.querySelectorAll('.tk-todo-item').forEach(row => {
          const id = row.dataset.id;
          row.querySelector('[data-action="toggle"]').onchange = async e => {
            try {
              await api(`/tasks/${task.id}/items/${id}`, { method: 'PUT', body: JSON.stringify({ completed: e.target.checked }) });
              await reload();
              await refreshTasks();
            } catch (err) { toast(err.message || t('tk_error'), 'bad'); }
          };
          row.querySelector('[data-action="delete-item"]').onclick = async () => {
            try {
              await api(`/tasks/${task.id}/items/${id}`, { method: 'DELETE' });
              await reload();
              await refreshTasks();
            } catch (err) { toast(err.message || t('tk_error'), 'bad'); }
          };
        });
      }
      await reload();

      async function addItem() {
        const title = input.value.trim();
        if (!title) return;
        try {
          await api(`/tasks/${task.id}/items`, { method: 'POST', body: JSON.stringify({ title }) });
          input.value = '';
          await reload();
          await refreshTasks();
        } catch (err) { toast(err.message || t('tk_error'), 'bad'); }
      }
      ov.querySelector('#tk-todo-add-btn').onclick = addItem;
      input.addEventListener('keydown', e => { if (e.key === 'Enter') addItem(); });
      ov.querySelector('#tk-todo-close').onclick = () => ov.remove();
      ov.querySelector('#tk-todo-copy').onclick = async () => {
        // Plain text has no strike-through, so checked items get a combining
        // long stroke (U+0336) after every character — it survives pasting
        // into chats, notes and mail.
        const text = currentItems.map((item, i) => {
          const title = item.completed_at ? Array.from(item.title).map(ch => ch + '\u0336').join('') : item.title;
          return `${i + 1}. ${title}`;
        }).join('\n');
        if (await copyText(text)) toast(t('tk_todo_copied'));
        else toast(t('tk_error'), 'bad');
      };
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) {
        // navigator.clipboard needs a secure context; fall back for plain http.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        ta.remove();
        return ok;
      }
    }

    async function ensureBudgetCategories() {
      if (!settings.budget_integration) { budgetCategories = { available: false, categories: [] }; return; }
      try { budgetCategories = await api('/budget-categories'); }
      catch (e) { budgetCategories = { available: false, categories: [] }; }
    }

    function openTaskForm(existing, presetProjectId) {
      const isEdit = !!existing;
      const selectedProject = existing ? existing.project_id : (presetProjectId || '');
      const type = existing ? existing.type : 'persistent';
      const rewardMode = existing ? existing.reward_mode : 'fixed';
      const existingCatIds = (existing && existing.category_ids) || [];
      const hasCategory = existingCatIds.length > 0;

      const catItems = budgetCategories.categories.map(c => `
        <label class="tk-cat-item">
          <input type="checkbox" class="tk-f-cat-cb" value="${esc(c.id)}" ${existingCatIds.includes(c.id) ? 'checked' : ''}>
          <span>${esc(c.title)}</span>
        </label>`
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
            <option value="todo" ${type === 'todo' ? 'selected' : ''}>${esc(t('tk_type_todo'))}</option>
          </select>
        </div>
        <div class="tk-field"><label>${esc(t('tk_project'))}</label>
          <select id="tk-f-project">
            <option value="">${esc(t('tk_project_none'))}</option>
            ${projectTree().map(({ p, depth }) => `<option value="${esc(p.id)}" ${selectedProject === p.id ? 'selected' : ''}>${'\u00a0\u00a0\u00a0'.repeat(depth)}${esc(p.title)}</option>`).join('')}
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
            <div class="tk-cat-list" id="tk-f-category-list">${catItems}</div>
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
      const catListEl = ov.querySelector('#tk-f-category-list');
      const amountWrap = ov.querySelector('#tk-f-amount-wrap');
      const amountHint = ov.querySelector('#tk-f-amount-hint');

      function checkedCatIds() {
        return catListEl ? Array.from(catListEl.querySelectorAll('.tk-f-cat-cb:checked')).map(cb => cb.value) : [];
      }

      const budgetWrap = ov.querySelector('#tk-f-budget-wrap');
      function syncTypeFields() {
        const val = typeSelect.value;
        persistentWrap.style.display = val === 'persistent' ? '' : 'none';
        onetimeWrap.style.display = val === 'onetime' ? '' : 'none';
        periodicWrap.style.display = val === 'periodic' ? '' : 'none';
        if (budgetWrap) budgetWrap.style.display = (val !== 'todo' && settings.budget_integration) ? '' : 'none';
        if (amountHint) {
          const base = (val === 'persistent' && rewardModeSelect.value === 'hourly')
            ? t('tk_amount_hourly_hint') : t('tk_amount_hint');
          amountHint.textContent = budgetCategories.currency ? base + ' (' + currencySymbol(budgetCategories.currency) + ')' : base;
        }
      }
      typeSelect.onchange = syncTypeFields;
      rewardModeSelect.onchange = syncTypeFields;
      if (catListEl) catListEl.addEventListener('change', () => { amountWrap.style.display = checkedCatIds().length ? '' : 'none'; });
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
          category_ids: [],
          due_at: null,
          period: null,
          project_id: ov.querySelector('#tk-f-project').value || null,
        };
        if (selType === 'onetime') {
          body.due_at = fromLocalInputValue(ov.querySelector('#tk-f-due-at').value);
          if (!body.due_at) { errEl.textContent = t('tk_due_at'); errEl.style.display = 'block'; return; }
        } else if (selType === 'periodic') {
          body.period = ov.querySelector('#tk-f-period').value;
        }
        if (selType !== 'todo') {
          const catIds = checkedCatIds();
          if (catIds.length) {
            const amtRaw = ov.querySelector('#tk-f-amount').value;
            const amt = parseFloat(amtRaw);
            if (isNaN(amt) || amt === 0) { errEl.textContent = t('tk_amount'); errEl.style.display = 'block'; return; }
            body.category_ids = catIds;
            body.reward_amount = amt;
          }
        }
        try {
          let saved;
          if (isEdit) saved = await api(`/tasks/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
          else saved = await api('/tasks', { method: 'POST', body: JSON.stringify(body) });
          ov.remove();
          await refreshTasks();
          if (!isEdit && selType === 'todo') openTodoDialog(saved);
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
            <span class="tk-amount ${r.amount >= 0 ? 'tk-amount-pos' : 'tk-amount-neg'}">${esc(fmtAmountBreakdown(r.amount, (r.categories || []).length, budgetCategories.currency))}</span>
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

    // Arrows move a project among its siblings only; subprojects travel with
    // their parent.
    function projectSiblings(p) {
      return projects.some(q => q.id === p.parent_id) ? childProjects(p.parent_id) : rootProjects();
    }
    function projectRowHtml(p, depth) {
      const sib = projectSiblings(p);
      const idx = sib.indexOf(p);
      return `<div class="tk-proj-row" data-id="${esc(p.id)}" style="padding-left:${depth * 18}px">
        <button class="tk-btn-icon" data-action="proj-up" title="${esc(t('tk_move_up'))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="tk-btn-icon" data-action="proj-down" title="${esc(t('tk_move_down'))}" ${idx === sib.length - 1 ? 'disabled' : ''}>▼</button>
        <span class="tk-proj-title">${esc(p.title)}</span>
        <button class="tk-btn-icon" data-action="proj-sub" title="${esc(t('tk_subproject_add'))}">＋</button>
        <button class="tk-btn-icon" data-action="proj-rename" title="${esc(t('tk_edit'))}">✎</button>
        <button class="tk-btn-icon" data-action="proj-delete" title="${esc(t('tk_delete'))}">🗑</button>
      </div>`;
    }

    function startRenameProject(row, project) {
      const titleEl = row.querySelector('.tk-proj-title');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 100;
      input.value = project.title;
      input.style.flex = '1';
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      let settled = false;
      async function save() {
        if (settled) return;
        settled = true;
        const val = input.value.trim();
        if (val && val !== project.title) {
          try { await api(`/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ title: val }) }); }
          catch (e) { toast(e.message || t('tk_error'), 'bad'); }
        }
        await loadProjects();
        renderSettings();
        renderTasks();
      }
      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') { settled = true; renderSettings(); }
      });
    }

    function startAddSubproject(row, parent) {
      settingsViewEl.querySelectorAll('.tk-proj-sub-add').forEach(el => el.remove());
      const wrap = document.createElement('div');
      wrap.className = 'tk-proj-sub-add';
      wrap.style.paddingLeft = (parseInt(row.style.paddingLeft) || 0) + 18 + 'px';
      wrap.innerHTML = `<input type="text" maxlength="100" placeholder="${esc(t('tk_subproject_new_ph', { title: parent.title }))}">
        <button class="tk-btn tk-btn-primary">${esc(t('tk_project_add'))}</button>`;
      row.after(wrap);
      const input = wrap.querySelector('input');
      input.focus();
      async function add() {
        const title = input.value.trim();
        if (!title) return;
        try {
          await api('/projects', { method: 'POST', body: JSON.stringify({ title, parent_id: parent.id }) });
          // Open the parent so the new subproject is visible in the Tasks tab.
          expandedSections[parent.id] = true;
          await loadProjects();
          renderSettings();
          renderTasks();
        } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
      }
      wrap.querySelector('button').onclick = add;
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') add();
        else if (e.key === 'Escape') wrap.remove();
      });
    }

    async function renderSettings() {
      settingsViewEl.innerHTML = `<div class="tk-settings-block">
        <div class="tk-toggle-row">
          <input type="checkbox" id="tk-s-budget" ${settings.budget_integration ? 'checked' : ''}>
          <label for="tk-s-budget">${esc(t('tk_budget_integration'))}</label>
        </div>
        <div class="tk-field-hint">${esc(t('tk_budget_integration_hint'))}</div>
      </div>
      <div class="tk-settings-block" style="margin-top:18px">
        <label>${esc(t('tk_projects'))}</label>
        <div class="tk-field-hint">${esc(t('tk_projects_hint'))}</div>
        <div id="tk-proj-list">${projectTree().map(({ p, depth }) => projectRowHtml(p, depth)).join('')}</div>
        <div class="tk-todo-add-row">
          <input type="text" id="tk-proj-add-input" maxlength="100" placeholder="${esc(t('tk_project_new_ph'))}">
          <button class="tk-btn tk-btn-primary" id="tk-proj-add-btn">${esc(t('tk_project_add'))}</button>
        </div>
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

      settingsViewEl.querySelectorAll('.tk-proj-row').forEach(row => {
        const id = row.dataset.id;
        const project = projects.find(p => p.id === id);
        const moveProject = async delta => {
          const sib = projectSiblings(project);
          const k = sib.indexOf(project);
          const other = sib[k + delta];
          if (!other) return;
          const order = projects.map(p => p.id);
          const a = order.indexOf(project.id), b = order.indexOf(other.id);
          [order[a], order[b]] = [order[b], order[a]];
          try {
            projects = await api('/projects/reorder', { method: 'PUT', body: JSON.stringify({ order }) });
            expandedSeeded = false;
            seedExpandedSections();
            renderSettings();
            renderTasks();
          } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
        };
        const upBtn = row.querySelector('[data-action="proj-up"]');
        const downBtn = row.querySelector('[data-action="proj-down"]');
        if (upBtn) upBtn.onclick = () => moveProject(-1);
        if (downBtn) downBtn.onclick = () => moveProject(1);
        row.querySelector('[data-action="proj-rename"]').onclick = () => startRenameProject(row, project);
        row.querySelector('[data-action="proj-sub"]').onclick = () => startAddSubproject(row, project);
        row.querySelector('[data-action="proj-delete"]').onclick = async () => {
          if (!confirm(t('tk_project_delete_confirm', { title: project.title }))) return;
          try {
            await api(`/projects/${id}`, { method: 'DELETE' });
            await loadProjects();
            renderSettings();
            await refreshTasks();
          } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
        };
      });

      const addInput = settingsViewEl.querySelector('#tk-proj-add-input');
      async function addProject() {
        const title = addInput.value.trim();
        if (!title) return;
        try {
          await api('/projects', { method: 'POST', body: JSON.stringify({ title }) });
          await loadProjects();
          renderSettings();
          renderTasks();
        } catch (e) { toast(e.message || t('tk_error'), 'bad'); }
      }
      settingsViewEl.querySelector('#tk-proj-add-btn').onclick = addProject;
      addInput.addEventListener('keydown', e => { if (e.key === 'Enter') addProject(); });
    }

    async function loadProjects() {
      try { projects = await api('/projects'); } catch (e) { projects = []; }
      seedExpandedSections();
    }

    async function init() {
      try { settings = await api('/me'); } catch (e) { settings = { budget_integration: false }; }
      if (destroyed) return;
      await ensureBudgetCategories();
      if (destroyed) return;
      await loadProjects();
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
