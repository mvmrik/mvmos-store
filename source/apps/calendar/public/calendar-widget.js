// Calendar — shared widget used by the desktop app window, the standalone
// Apps Hub public page, and the Telegram mini-app (same three-surface
// pattern as apps/chat/chat-widget.js).
(function () {
  if (window.CalendarWidget) return;

  const API = '/pub/calendar';

  const _i18n = {
    en: {
      today: 'Today', month: 'Month', week: 'Week', day: 'Day', add: '+ Add',
      login_needed: 'Log in to Apps Hub to use Calendar',
      title: 'Title', description: 'Description', date: 'Date', time: 'Time',
      start_time: 'Start time', end_time: 'End time', all_day: 'All day',
      save: 'Save', cancel: 'Cancel', delete: 'Delete', more: 'more', edit: 'Edit',
      confirm_delete: 'Delete this event?', title_required: 'Title is required',
      date_required: 'A valid date is required', no_events: 'No events',
      save_failed: 'Could not save. Please try again.',
      mark_done: 'Mark as done', mark_undone: 'Mark as not done', completed: 'Completed',
      repeat: 'Repeat', repeat_none: 'Does not repeat', repeat_daily: 'Daily',
      repeat_weekly: 'Weekly', repeat_monthly: 'Monthly', repeat_until: 'Repeat until',
      repeat_until_required: 'An end date for the repeat is required',
      repeat_days_required: 'Choose at least one day of the week',
      recurring_note: 'This is a recurring event.',
      recurring: 'Recurring event',
      scope_title: 'Recurring event',
      scope_edit_question: 'Apply this change to just this occurrence, this and the following ones, or every upcoming occurrence?',
      scope_delete_question: 'Delete just this occurrence, this and the following ones, or every upcoming occurrence?',
      scope_this: 'Only this one',
      scope_future: 'This and following',
      scope_all: 'All upcoming',
    },
    bg: {
      today: 'Днес', month: 'Месец', week: 'Седмица', day: 'Ден', add: '+ Добави',
      login_needed: 'Влез в Apps Hub, за да ползваш календара',
      title: 'Заглавие', description: 'Описание', date: 'Дата', time: 'Час',
      start_time: 'Начален час', end_time: 'Краен час', all_day: 'Цял ден',
      save: 'Запази', cancel: 'Отказ', delete: 'Изтрий', more: 'още', edit: 'Редакция',
      confirm_delete: 'Да се изтрие ли събитието?', title_required: 'Заглавието е задължително',
      date_required: 'Нужна е валидна дата', no_events: 'Няма събития',
      save_failed: 'Неуспешен запис. Опитай отново.',
      mark_done: 'Отбележи като изпълнено', mark_undone: 'Отбележи като неизпълнено', completed: 'Изпълнено',
      repeat: 'Повторение', repeat_none: 'Не се повтаря', repeat_daily: 'Всеки ден',
      repeat_weekly: 'Всяка седмица', repeat_monthly: 'Всеки месец', repeat_until: 'Повтаряй до',
      repeat_until_required: 'Нужна е крайна дата за повторението',
      repeat_days_required: 'Избери поне един ден от седмицата',
      recurring_note: 'Това е повтарящо се събитие.',
      recurring: 'Повтарящо се събитие',
      scope_title: 'Повтарящо се събитие',
      scope_edit_question: 'Промяната да важи само за това събитие, за него и следващите, или за всички предстоящи?',
      scope_delete_question: 'Да се изтрие ли само това събитие, то и следващите, или всички предстоящи?',
      scope_this: 'Само това',
      scope_future: 'Това и следващите',
      scope_all: 'Всички предстоящи',
    },
  };
  function t(key) {
    const lang = window.mvmOS?.lang || 'en';
    return (_i18n[lang] || _i18n.en)[key] || key;
  }

  function monthlyHint(dayNum) {
    const lang = window.mvmOS?.lang || 'en';
    return lang === 'bg' ? `Повтаря се на ${dayNum}-о число всеки месец` : `Repeats monthly on day ${dayNum}`;
  }

  // Asks which occurrences of a recurring series an edit/delete should
  // apply to. Resolves to 'this', 'future', 'all', or null if the user
  // backs out.
  function askScope(widgetEl, question) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'cal-overlay';
      overlay.innerHTML = `
        <div class="cal-dialog cal-scope-dialog">
          <h3>${esc(t('scope_title'))}</h3>
          <p>${esc(question)}</p>
          <div class="cal-dialog-actions cal-scope-actions">
            <button class="cal-btn cal-btn-secondary" id="cal-scope-cancel">${esc(t('cancel'))}</button>
            <button class="cal-btn cal-btn-secondary" id="cal-scope-this">${esc(t('scope_this'))}</button>
            <button class="cal-btn cal-btn-secondary" id="cal-scope-future">${esc(t('scope_future'))}</button>
            <button class="cal-btn cal-btn-primary" id="cal-scope-all">${esc(t('scope_all'))}</button>
          </div>
        </div>`;
      widgetEl.appendChild(overlay);
      const finish = val => { overlay.remove(); resolve(val); };
      overlay.querySelector('#cal-scope-cancel').onclick = () => finish(null);
      overlay.querySelector('#cal-scope-this').onclick = () => finish('this');
      overlay.querySelector('#cal-scope-future').onclick = () => finish('future');
      overlay.querySelector('#cal-scope-all').onclick = () => finish('all');
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_LABELS_MON = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const DAY_LABELS_SUN = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function weekdayIndex(d, weekStarts) {
    return weekStarts === 'sunday' ? d.getDay() : (d.getDay() + 6) % 7;
  }
  function weekdayOrder(weekStarts) {
    return weekStarts === 'sunday' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  }
  function isoWeekNumber(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const diff = date - firstThursday;
    return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  }

  let _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .cal-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);
        font-family:system-ui,sans-serif;font-size:.85rem;overflow:hidden}
      .cal-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2, #a6adc8);
        font-family:system-ui,sans-serif;font-size:.9rem;text-align:center;padding:20px}
      .cal-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0;flex-wrap:wrap}
      .cal-nav,.cal-today,.cal-views button,.cal-add{background:var(--pub-surface2, #313244);color:var(--pub-fg, #cdd6f4);border:none;border-radius:6px;
        padding:6px 10px;cursor:pointer;font-size:.82rem}
      .cal-nav:hover,.cal-today:hover,.cal-views button:hover,.cal-add:hover{background:var(--pub-border, #45475a)}
      .cal-views{display:flex;gap:4px;margin-left:auto}
      .cal-views button.active{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .cal-add{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .cal-title{font-weight:700;font-size:.95rem;white-space:nowrap}
      .cal-body{flex:1;overflow:auto;padding:10px}
      .cal-month-grid{display:grid;grid-template-columns:24px repeat(7,1fr);gap:4px;height:100%}
      .cal-dow{text-align:center;font-size:.72rem;color:var(--pub-fg2, #a6adc8);padding:4px 0;font-weight:600;cursor:pointer}
      .cal-dow:hover{color:var(--pub-accent, #89b4fa)}
      .cal-dow-corner{}
      .cal-week-num{display:flex;align-items:center;justify-content:center;font-size:.66rem;
        color:var(--pub-dim, #6c7086);cursor:pointer;border-radius:4px}
      .cal-week-num:hover{background:var(--pub-surface2, #313244);color:var(--pub-accent, #89b4fa)}
      .cal-weekday-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px}
      .cal-cell{background:var(--pub-surface1, #181825);border-radius:6px;padding:5px;min-height:70px;cursor:pointer;
        display:flex;flex-direction:column;gap:2px;border:1px solid transparent}
      .cal-cell:hover{border-color:var(--pub-border, #45475a)}
      .cal-cell.cal-today{border-color:var(--pub-accent, #89b4fa)}
      .cal-cell.cal-outside{opacity:.35}
      .cal-cell-num{font-size:.78rem;color:var(--pub-fg2, #a6adc8);font-weight:600}
      .cal-chip{background:var(--pub-surface2, #313244);border-radius:4px;padding:1px 5px;font-size:.68rem;overflow:hidden;
        text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
      .cal-chip:hover{background:var(--pub-border, #45475a)}
      .cal-chip.reminder{border-left:2px solid var(--pub-yellow, #f9e2af)}
      .cal-chip.allday{border-left:2px solid var(--pub-green, #a6e3a1)}
      .cal-chip.completed{opacity:.5;text-decoration:line-through}
      .cal-more{font-size:.68rem;color:var(--pub-fg2, #a6adc8);padding-left:3px}
      .cal-week-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;height:100%}
      .cal-week-col{background:var(--pub-surface1, #181825);border-radius:6px;padding:6px;display:flex;flex-direction:column;gap:4px;min-height:200px}
      .cal-week-col.cal-today{outline:1px solid var(--pub-accent, #89b4fa)}
      .cal-week-head{font-size:.72rem;color:var(--pub-fg2, #a6adc8);font-weight:600;text-align:center;margin-bottom:2px}
      .cal-day-list{display:flex;flex-direction:column;gap:6px;max-width:640px}
      .cal-day-item{background:var(--pub-surface1, #181825);border-radius:8px;padding:10px 12px;cursor:pointer;display:flex;flex-direction:column;gap:2px}
      .cal-day-item:hover{background:#232336}
      .cal-day-item .cal-ev-time{font-size:.72rem;color:var(--pub-yellow, #f9e2af);font-weight:600}
      .cal-day-item.allday .cal-ev-time{color:var(--pub-green, #a6e3a1)}
      .cal-day-item.completed{opacity:.55}
      .cal-day-item.completed .cal-ev-title{text-decoration:line-through}
      .cal-ev-title{font-weight:600}
      .cal-ev-desc{font-size:.78rem;color:var(--pub-fg2, #a6adc8);white-space:pre-wrap}
      .cal-empty{color:var(--pub-dim, #6c7086);text-align:center;padding:24px}
      .cal-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;
        justify-content:center;z-index:20}
      .cal-dialog{background:var(--pub-bg, #1e1e2e);border:1px solid var(--pub-surface2, #313244);border-radius:10px;padding:18px;width:min(360px,90%);
        display:flex;flex-direction:column;gap:10px}
      .cal-dialog h3{margin:0 0 4px}
      .cal-scope-dialog p{margin:0;font-size:.85rem;color:var(--pub-fg, #cdd6f4)}
      .cal-view-row{font-size:.85rem;color:var(--pub-fg, #cdd6f4)}
      .cal-view-row strong{color:var(--pub-fg2, #a6adc8);font-weight:600;margin-right:4px}
      .cal-view-desc{font-size:.82rem;color:var(--pub-fg, #cdd6f4);white-space:pre-wrap;border-top:1px solid var(--pub-surface2, #313244);padding-top:8px}
      .cal-view-completed{color:var(--pub-green, #a6e3a1);font-weight:600}
      .cal-view-recurring{color:var(--pub-accent, #89b4fa);font-weight:600}
      .cal-recurring-note{font-size:.76rem;color:var(--pub-yellow, #f9e2af);background:var(--pub-surface2, #313244);border-radius:6px;padding:6px 8px}
      .cal-field label{display:block;font-size:.72rem;color:var(--pub-fg2, #a6adc8);margin-bottom:3px}
      .cal-field input[type=text],.cal-field textarea,.cal-field input[type=date],.cal-field select{
        width:100%;box-sizing:border-box;background:var(--pub-crust, #11111b);border:1px solid var(--pub-surface2, #313244);border-radius:6px;
        color:var(--pub-fg, #cdd6f4);padding:6px 8px;font-size:.82rem;font-family:inherit}
      .cal-field textarea{resize:vertical;min-height:50px}
      .cal-weekday-picker{display:flex;gap:4px;margin-bottom:8px;flex-wrap:wrap}
      .cal-wd-btn{background:var(--pub-crust, #11111b);border:1px solid var(--pub-surface2, #313244);border-radius:6px;color:var(--pub-fg2, #a6adc8);
        padding:5px 8px;font-size:.72rem;cursor:pointer}
      .cal-wd-btn.selected{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);border-color:var(--pub-accent, #89b4fa);font-weight:600}
      .cal-hint{font-size:.74rem;color:var(--pub-fg2, #a6adc8);margin-bottom:6px}
      .cal-time-input{display:flex;align-items:center;gap:4px}
      .cal-time-input input[type=number]{width:44px;box-sizing:border-box;background:var(--pub-crust, #11111b);border:1px solid var(--pub-surface2, #313244);
        border-radius:6px;color:var(--pub-fg, #cdd6f4);padding:6px 4px;font-size:.82rem;font-family:inherit;text-align:center;-moz-appearance:textfield}
      .cal-time-input input[type=number]::-webkit-inner-spin-button,
      .cal-time-input input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      .cal-time-input input[type=number]:disabled,.cal-time-input select:disabled{opacity:.4}
      .cal-time-input select{background:var(--pub-crust, #11111b);border:1px solid var(--pub-surface2, #313244);border-radius:6px;color:var(--pub-fg, #cdd6f4);
        padding:6px 4px;font-size:.78rem;font-family:inherit}
      .cal-row2{display:flex;gap:8px}
      .cal-row2 .cal-field{flex:1}
      .cal-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px;flex-wrap:wrap}
      .cal-scope-actions{justify-content:flex-end}
      .cal-btn{border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:.82rem}
      .cal-btn-primary{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .cal-btn-secondary{background:var(--pub-surface2, #313244);color:var(--pub-fg, #cdd6f4)}
      .cal-btn-danger{background:var(--pub-red, #f38ba8);color:var(--pub-bg, #1e1e2e);font-weight:600;margin-right:auto}
      .cal-widget{position:relative}
    `;
    document.head.appendChild(style);
  }

  async function loadDisplaySettings() {
    if (window._vosSettings && window._vosSettings.time_format) {
      return {
        time_format: window._vosSettings.time_format,
        date_format: window._vosSettings.date_format || 'DD/MM/YYYY',
        week_starts: window._vosSettings.week_starts || 'monday',
      };
    }
    try {
      const r = await fetch('/api/settings/display');
      if (r.ok) return await r.json();
    } catch (_) {}
    return { time_format: '24', date_format: 'DD/MM/YYYY', week_starts: 'monday' };
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = `<div class="cal-login">${esc(t('login_needed'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    let destroyed = false;
    let settings = { time_format: '24', date_format: 'DD/MM/YYYY', week_starts: 'monday' };
    let view = 'month';
    let anchor = new Date(); anchor.setHours(0, 0, 0, 0);
    let events = [];
    let weekdayFilter = anchor.getDay();

    root.innerHTML = `<div class="cal-widget"><div class="cal-toolbar"></div><div class="cal-body"></div></div>`;
    const widgetEl = root.querySelector('.cal-widget');
    const toolbarEl = root.querySelector('.cal-toolbar');
    const bodyEl = root.querySelector('.cal-body');

    async function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      const r = await fetch(API + path, Object.assign({}, o, { headers }));
      if (!r.ok) throw new Error('http_' + r.status);
      return r.status === 204 ? null : r.json();
    }

    function markNotifRead(eventId) {
      fetch('/api/notifications/read-by-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
        body: JSON.stringify({ source: 'calendar', ref: String(eventId) }),
      }).then(() => window.mvmOS?._refreshNotifs?.()).catch(() => {});
    }

    function formatTimeDisplay(hhmm) {
      if (!hhmm) return '';
      const [h, m] = hhmm.split(':').map(Number);
      if (settings.time_format === '12') {
        const period = h < 12 ? 'AM' : 'PM';
        let h12 = h % 12; if (h12 === 0) h12 = 12;
        return `${h12}:${pad2(m)} ${period}`;
      }
      return hhmm;
    }

    // Native <input type=time> renders in whatever format the browser's own
    // locale prefers (Chrome ignores our setting entirely) — build our own
    // so the displayed format always matches mvmOS's time_format setting.
    function makeTimeInput(initial24) {
      const is12 = settings.time_format === '12';
      const wrap = document.createElement('div');
      wrap.className = 'cal-time-input';

      const hInput = document.createElement('input');
      hInput.type = 'number';
      hInput.min = is12 ? '1' : '0';
      hInput.max = is12 ? '12' : '23';
      hInput.placeholder = 'HH';

      const mInput = document.createElement('input');
      mInput.type = 'number';
      mInput.min = '0';
      mInput.max = '59';
      mInput.placeholder = 'MM';

      let ampmSel = null;
      if (is12) {
        ampmSel = document.createElement('select');
        ampmSel.innerHTML = '<option value="AM">AM</option><option value="PM">PM</option>';
      }

      wrap.appendChild(hInput);
      wrap.appendChild(document.createTextNode(':'));
      wrap.appendChild(mInput);
      if (ampmSel) wrap.appendChild(ampmSel);

      hInput.addEventListener('input', () => {
        if (hInput.value !== '' && mInput.value === '') mInput.value = '00';
      });

      function setValue(v) {
        if (!v) { hInput.value = ''; mInput.value = ''; if (ampmSel) ampmSel.value = 'AM'; return; }
        const [hh, mm] = v.split(':').map(Number);
        if (is12) {
          const period = hh < 12 ? 'AM' : 'PM';
          let h12 = hh % 12; if (h12 === 0) h12 = 12;
          hInput.value = h12;
          ampmSel.value = period;
        } else {
          hInput.value = hh;
        }
        mInput.value = pad2(mm);
      }
      setValue(initial24);

      Object.defineProperty(wrap, 'value', {
        get() {
          if (hInput.value === '' || mInput.value === '') return '';
          let hh = parseInt(hInput.value, 10) || 0;
          const mm = Math.min(59, Math.max(0, parseInt(mInput.value, 10) || 0));
          if (is12) {
            hh = Math.min(12, Math.max(1, hh));
            hh = hh % 12;
            if (ampmSel.value === 'PM') hh += 12;
          } else {
            hh = Math.min(23, Math.max(0, hh));
          }
          return `${pad2(hh)}:${pad2(mm)}`;
        },
        set: setValue,
      });

      wrap.setDisabled = (disabled) => {
        hInput.disabled = disabled;
        mInput.disabled = disabled;
        if (ampmSel) ampmSel.disabled = disabled;
      };
      wrap.onChange = (fn) => {
        hInput.addEventListener('input', fn);
        mInput.addEventListener('input', fn);
        if (ampmSel) ampmSel.addEventListener('change', fn);
      };
      return wrap;
    }

    // Same reasoning as makeTimeInput — native <input type=date> also
    // displays in the browser's own locale format, not ours.
    function makeDateInput(initialISO) {
      const wrap = document.createElement('div');
      wrap.className = 'cal-time-input';

      const dInput = document.createElement('input');
      dInput.type = 'number'; dInput.min = '1'; dInput.max = '31'; dInput.placeholder = 'DD';
      const mInput = document.createElement('input');
      mInput.type = 'number'; mInput.min = '1'; mInput.max = '12'; mInput.placeholder = 'MM';
      const yInput = document.createElement('input');
      yInput.type = 'number'; yInput.min = '1970'; yInput.max = '9999'; yInput.placeholder = 'YYYY';
      yInput.style.width = '64px';

      const fmt = settings.date_format;
      const sep = fmt === 'YYYY-MM-DD' ? '-' : '/';
      const order = fmt === 'MM/DD/YYYY' ? [mInput, dInput, yInput]
        : fmt === 'YYYY-MM-DD' ? [yInput, mInput, dInput]
        : [dInput, mInput, yInput];
      order.forEach((el, i) => {
        wrap.appendChild(el);
        if (i < order.length - 1) wrap.appendChild(document.createTextNode(sep));
      });

      function setValue(iso) {
        if (!iso) { dInput.value = ''; mInput.value = ''; yInput.value = ''; return; }
        const [y, m, d] = iso.split('-').map(Number);
        dInput.value = d; mInput.value = m; yInput.value = y;
      }
      setValue(initialISO);

      Object.defineProperty(wrap, 'value', {
        get() {
          if (!dInput.value || !mInput.value || !yInput.value) return '';
          const d = Math.min(31, Math.max(1, parseInt(dInput.value, 10) || 1));
          const m = Math.min(12, Math.max(1, parseInt(mInput.value, 10) || 1));
          const y = parseInt(yInput.value, 10) || new Date().getFullYear();
          return `${y}-${pad2(m)}-${pad2(d)}`;
        },
        set: setValue,
      });
      wrap.onChange = (fn) => {
        dInput.addEventListener('input', fn);
        mInput.addEventListener('input', fn);
        yInput.addEventListener('input', fn);
      };
      return wrap;
    }

    function formatDMY(d) {
      const dd = pad2(d.getDate()), mm = pad2(d.getMonth() + 1), yyyy = d.getFullYear();
      if (settings.date_format === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
      if (settings.date_format === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
      return `${dd}/${mm}/${yyyy}`;
    }

    function rangeForView() {
      if (view === 'month') {
        const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
        const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
        const gridStart = addDays(first, -weekdayIndex(first, settings.week_starts));
        const gridEnd = addDays(last, 6 - weekdayIndex(last, settings.week_starts));
        return [gridStart, gridEnd];
      }
      if (view === 'week') {
        const start = addDays(anchor, -weekdayIndex(anchor, settings.week_starts));
        return [start, addDays(start, 6)];
      }
      if (view === 'weekday') {
        return [new Date(anchor.getFullYear(), 0, 1), new Date(anchor.getFullYear(), 11, 31)];
      }
      return [anchor, anchor];
    }

    async function loadEvents() {
      const [start, end] = rangeForView();
      try {
        events = await api(`/events?start=${fmtDate(start)}&end=${fmtDate(end)}`);
      } catch (_) { events = []; }
      events.filter(e => e.notified).forEach(e => markNotifRead(e.id));
    }

    function eventsOn(date) {
      const ds = fmtDate(date);
      return events.filter(e => e.date === ds)
        .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    }

    function renderToolbar() {
      const [start, end] = rangeForView();
      let titleText;
      if (view === 'month') titleText = `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
      else if (view === 'week') titleText = `${formatDMY(start)} – ${formatDMY(end)}`;
      else if (view === 'weekday') titleText = `${WEEKDAY_NAMES[weekdayFilter]}s — ${anchor.getFullYear()}`;
      else titleText = formatDMY(anchor);

      toolbarEl.innerHTML = `
        <button class="cal-nav" data-nav="prev">‹</button>
        <button class="cal-today">${esc(t('today'))}</button>
        <button class="cal-nav" data-nav="next">›</button>
        <div class="cal-title">${esc(titleText)}</div>
        <div class="cal-views">
          <button data-view="month" class="${view === 'month' ? 'active' : ''}">${esc(t('month'))}</button>
          <button data-view="week" class="${view === 'week' ? 'active' : ''}">${esc(t('week'))}</button>
          <button data-view="day" class="${view === 'day' ? 'active' : ''}">${esc(t('day'))}</button>
        </div>
        <button class="cal-add">${esc(t('add'))}</button>
      `;
      toolbarEl.querySelector('[data-nav="prev"]').onclick = () => nav(-1);
      toolbarEl.querySelector('[data-nav="next"]').onclick = () => nav(1);
      toolbarEl.querySelector('.cal-today').onclick = () => { anchor = new Date(); anchor.setHours(0, 0, 0, 0); refresh(); };
      toolbarEl.querySelectorAll('[data-view]').forEach(b => {
        b.onclick = () => { view = b.dataset.view; refresh(); };
      });
      toolbarEl.querySelector('.cal-add').onclick = () => openEditDialog(null, anchor);
    }

    function nav(dir) {
      if (view === 'month') anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
      else if (view === 'week') anchor = addDays(anchor, dir * 7);
      else if (view === 'weekday') anchor = new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1);
      else anchor = addDays(anchor, dir);
      refresh();
    }

    function chipHtml(e) {
      const cls = (e.all_day ? 'allday' : (e.reminder ? 'reminder' : '')) + (e.completed ? ' completed' : '');
      const label = e.all_day ? esc(e.title) : `${esc(formatTimeDisplay(e.start_time))} ${esc(e.title)}`;
      const mark = (e.completed ? '✓ ' : '') + (e.recurring ? '🔁 ' : '');
      return `<div class="cal-chip ${cls}" data-id="${esc(e.id)}">${mark}${label}</div>`;
    }

    function renderMonth() {
      const dayLabels = settings.week_starts === 'sunday' ? DAY_LABELS_SUN : DAY_LABELS_MON;
      const order = weekdayOrder(settings.week_starts);
      const [gridStart] = rangeForView();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let rowsHtml = '';
      for (let w = 0; w < 6; w++) {
        const weekStart = addDays(gridStart, w * 7);
        rowsHtml += `<span class="cal-week-num" data-date="${fmtDate(weekStart)}">${isoWeekNumber(weekStart)}</span>`;
        for (let i = 0; i < 7; i++) {
          const d = addDays(weekStart, i);
          const dayEvents = eventsOn(d);
          const shown = dayEvents.slice(0, 3);
          const extra = dayEvents.length - shown.length;
          const outside = d.getMonth() !== anchor.getMonth();
          rowsHtml += `
            <div class="cal-cell${sameDay(d, today) ? ' cal-today' : ''}${outside ? ' cal-outside' : ''}" data-date="${fmtDate(d)}">
              <div class="cal-cell-num">${d.getDate()}</div>
              ${shown.map(chipHtml).join('')}
              ${extra > 0 ? `<div class="cal-more">+${extra} ${esc(t('more'))}</div>` : ''}
            </div>`;
        }
      }
      bodyEl.innerHTML = `<div class="cal-month-grid">
        <span class="cal-dow-corner"></span>
        ${dayLabels.map((l, i) => `<span class="cal-dow" data-weekday="${order[i]}">${esc(l)}</span>`).join('')}
        ${rowsHtml}
      </div>`;
      bodyEl.querySelectorAll('.cal-week-num').forEach(el => {
        el.addEventListener('click', () => {
          anchor = new Date(el.dataset.date + 'T00:00:00');
          view = 'week';
          refresh();
        });
      });
      bodyEl.querySelectorAll('.cal-dow').forEach(el => {
        el.addEventListener('click', () => {
          weekdayFilter = parseInt(el.dataset.weekday, 10);
          view = 'weekday';
          refresh();
        });
      });
      bodyEl.querySelectorAll('.cal-chip').forEach(el => {
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          const e = events.find(x => x.id === el.dataset.id);
          if (e) openViewDialog(e);
        });
      });
      bodyEl.querySelectorAll('.cal-cell').forEach(el => {
        el.addEventListener('click', () => {
          anchor = new Date(el.dataset.date + 'T00:00:00');
          view = 'day';
          refresh();
        });
      });
    }

    function renderWeekdayYear() {
      const year = anchor.getFullYear();
      const dates = [];
      const d = new Date(year, 0, 1);
      while (d.getDay() !== weekdayFilter) d.setDate(d.getDate() + 1);
      while (d.getFullYear() === year) {
        dates.push(new Date(d));
        d.setDate(d.getDate() + 7);
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cellsHtml = dates.map(dt => {
        const dayEvents = eventsOn(dt);
        const shown = dayEvents.slice(0, 3);
        const extra = dayEvents.length - shown.length;
        return `
          <div class="cal-cell cal-weekday-cell${sameDay(dt, today) ? ' cal-today' : ''}" data-date="${fmtDate(dt)}">
            <div class="cal-cell-num">${dt.getDate()} ${MONTH_NAMES[dt.getMonth()].slice(0, 3)}</div>
            ${shown.map(chipHtml).join('')}
            ${extra > 0 ? `<div class="cal-more">+${extra} ${esc(t('more'))}</div>` : ''}
          </div>`;
      }).join('');
      bodyEl.innerHTML = `<div class="cal-weekday-grid">${cellsHtml}</div>`;
      bodyEl.querySelectorAll('.cal-chip').forEach(el => {
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          const e = events.find(x => x.id === el.dataset.id);
          if (e) openViewDialog(e);
        });
      });
      bodyEl.querySelectorAll('.cal-weekday-cell').forEach(el => {
        el.addEventListener('click', () => {
          anchor = new Date(el.dataset.date + 'T00:00:00');
          view = 'day';
          refresh();
        });
      });
    }

    function renderWeek() {
      const [start] = rangeForView();
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let colsHtml = '';
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        const dayEvents = eventsOn(d);
        colsHtml += `
          <div class="cal-week-col${sameDay(d, today) ? ' cal-today' : ''}" data-date="${fmtDate(d)}">
            <div class="cal-week-head">${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}</div>
            ${dayEvents.map(chipHtml).join('') || ''}
          </div>`;
      }
      bodyEl.innerHTML = `<div class="cal-week-grid">${colsHtml}</div>`;
      bodyEl.querySelectorAll('.cal-chip').forEach(el => {
        el.addEventListener('click', ev => {
          ev.stopPropagation();
          const e = events.find(x => x.id === el.dataset.id);
          if (e) openViewDialog(e);
        });
      });
      bodyEl.querySelectorAll('.cal-week-col').forEach(el => {
        el.addEventListener('click', e => {
          if (e.target.closest('.cal-chip')) return;
          anchor = new Date(el.dataset.date + 'T00:00:00');
          view = 'day';
          refresh();
        });
      });
    }

    function renderDay() {
      const dayEvents = eventsOn(anchor);
      if (!dayEvents.length) {
        bodyEl.innerHTML = `<div class="cal-empty">${esc(t('no_events'))}</div>`;
        return;
      }
      bodyEl.innerHTML = `<div class="cal-day-list">${dayEvents.map(e => `
        <div class="cal-day-item${e.all_day ? ' allday' : ''}${e.completed ? ' completed' : ''}" data-id="${esc(e.id)}">
          <div class="cal-ev-time">${e.completed ? '✓ ' : ''}${e.all_day ? esc(t('all_day')) : (e.end_time ? `${esc(formatTimeDisplay(e.start_time))} – ${esc(formatTimeDisplay(e.end_time))}` : esc(formatTimeDisplay(e.start_time)))}</div>
          <div class="cal-ev-title">${esc(e.title)}</div>
          ${e.description ? `<div class="cal-ev-desc">${esc(e.description)}</div>` : ''}
        </div>`).join('')}</div>`;
      bodyEl.querySelectorAll('.cal-day-item').forEach(el => {
        el.addEventListener('click', () => {
          const e = events.find(x => x.id === el.dataset.id);
          if (e) openViewDialog(e);
        });
      });
    }

    function renderBody() {
      if (view === 'month') renderMonth();
      else if (view === 'week') renderWeek();
      else if (view === 'weekday') renderWeekdayYear();
      else renderDay();
    }

    function openViewDialog(event) {
      const timeText = event.all_day ? t('all_day')
        : (event.end_time ? `${formatTimeDisplay(event.start_time)} – ${formatTimeDisplay(event.end_time)}` : formatTimeDisplay(event.start_time));
      const overlay = document.createElement('div');
      overlay.className = 'cal-overlay';
      overlay.innerHTML = `
        <div class="cal-dialog">
          <h3>${esc(event.title)}</h3>
          <div class="cal-view-row"><strong>${esc(t('date'))}:</strong>${esc(formatDMY(new Date(event.date + 'T00:00:00')))}</div>
          <div class="cal-view-row"><strong>${esc(t('time'))}:</strong>${esc(timeText)}</div>
          ${event.completed ? `<div class="cal-view-row cal-view-completed">✓ ${esc(t('completed'))}</div>` : ''}
          ${event.recurring ? `<div class="cal-view-row cal-view-recurring">🔁 ${esc(t('recurring'))}</div>` : ''}
          ${event.description ? `<div class="cal-view-desc">${esc(event.description)}</div>` : ''}
          <div class="cal-dialog-actions">
            <button class="cal-btn cal-btn-secondary" id="cal-v-close">${esc(t('cancel'))}</button>
            <button class="cal-btn cal-btn-secondary" id="cal-v-done">${esc(event.completed ? t('mark_undone') : t('mark_done'))}</button>
            <button class="cal-btn cal-btn-primary" id="cal-v-edit">${esc(t('edit'))}</button>
          </div>
        </div>`;
      widgetEl.appendChild(overlay);
      overlay.querySelector('#cal-v-close').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
      overlay.querySelector('#cal-v-edit').onclick = () => { overlay.remove(); openEditDialog(event); };
      overlay.querySelector('#cal-v-done').onclick = async () => {
        try {
          await api(`/events/${event.id}/complete`, {
            method: 'PATCH',
            body: JSON.stringify({ completed: !event.completed }),
          });
        } catch (err) {
          alert(t('save_failed'));
          return;
        }
        overlay.remove();
        refresh();
      };
    }

    function openEditDialog(existing, defaultDate) {
      const d = existing ? new Date(existing.date + 'T00:00:00') : (defaultDate || anchor);
      const overlay = document.createElement('div');
      overlay.className = 'cal-overlay';
      overlay.innerHTML = `
        <div class="cal-dialog">
          <h3>${existing ? esc(t('edit')) : esc(t('add'))}</h3>
          ${existing && existing.recurring ? `<div class="cal-recurring-note">🔁 ${esc(t('recurring_note'))}</div>` : ''}
          <div class="cal-field">
            <label>${esc(t('title'))}</label>
            <input type="text" id="cal-f-title" value="${esc(existing ? existing.title : '')}">
          </div>
          <div class="cal-field">
            <label>${esc(t('description'))}</label>
            <textarea id="cal-f-desc">${esc(existing ? existing.description : '')}</textarea>
          </div>
          <div class="cal-field">
            <label>${esc(t('date'))}</label>
            <div id="cal-f-date-slot"></div>
          </div>
          <div class="cal-row2">
            <div class="cal-field">
              <label>${esc(t('start_time'))}</label>
              <div id="cal-f-start-slot"></div>
            </div>
            <div class="cal-field">
              <label>${esc(t('end_time'))}</label>
              <div id="cal-f-end-slot"></div>
            </div>
          </div>
          <div class="cal-field">
            <label>${esc(t('repeat'))}</label>
            <select id="cal-f-repeat">
              <option value="">${esc(t('repeat_none'))}</option>
              <option value="daily">${esc(t('repeat_daily'))}</option>
              <option value="weekly">${esc(t('repeat_weekly'))}</option>
              <option value="monthly">${esc(t('repeat_monthly'))}</option>
            </select>
          </div>
          <div class="cal-field" id="cal-f-repeat-extra" style="display:none">
            <div class="cal-weekday-picker" id="cal-f-weekdays" style="display:none"></div>
            <div class="cal-hint" id="cal-f-monthly-hint" style="display:none"></div>
            <label>${esc(t('repeat_until'))}</label>
            <div id="cal-f-until-slot"></div>
          </div>
          <div class="cal-dialog-actions">
            ${existing ? `<button class="cal-btn cal-btn-danger" id="cal-f-delete">${esc(t('delete'))}</button>` : ''}
            <button class="cal-btn cal-btn-secondary" id="cal-f-cancel">${esc(t('cancel'))}</button>
            <button class="cal-btn cal-btn-primary" id="cal-f-save">${esc(t('save'))}</button>
          </div>
        </div>`;
      widgetEl.appendChild(overlay);

      const dateInput = makeDateInput(fmtDate(d));
      overlay.querySelector('#cal-f-date-slot').appendChild(dateInput);

      const startInput = makeTimeInput(existing && existing.start_time ? existing.start_time : '');
      const endInput = makeTimeInput(existing && existing.end_time ? existing.end_time : '');
      overlay.querySelector('#cal-f-start-slot').appendChild(startInput);
      overlay.querySelector('#cal-f-end-slot').appendChild(endInput);
      function syncEndDisabled() {
        const has = !!startInput.value;
        endInput.setDisabled(!has);
        if (!has) endInput.value = '';
      }
      startInput.onChange(syncEndDisabled);
      syncEndDisabled();

      const untilInput = makeDateInput(existing && existing.recur_until ? existing.recur_until : fmtDate(d));
      overlay.querySelector('#cal-f-until-slot').appendChild(untilInput);

      const repeatSel = overlay.querySelector('#cal-f-repeat');
      repeatSel.value = existing && existing.recur_type ? existing.recur_type : '';

      const order = weekdayOrder(settings.week_starts);
      const dayLabels = settings.week_starts === 'sunday' ? DAY_LABELS_SUN : DAY_LABELS_MON;
      const selectedDays = new Set(existing && existing.recur_days ? existing.recur_days : [d.getDay()]);
      const weekdaysEl = overlay.querySelector('#cal-f-weekdays');
      weekdaysEl.innerHTML = dayLabels.map((l, i) => {
        const wd = order[i];
        return `<button type="button" class="cal-wd-btn${selectedDays.has(wd) ? ' selected' : ''}" data-wd="${wd}">${esc(l)}</button>`;
      }).join('');
      weekdaysEl.querySelectorAll('.cal-wd-btn').forEach(btn => {
        btn.onclick = () => {
          const wd = parseInt(btn.dataset.wd, 10);
          if (selectedDays.has(wd)) { selectedDays.delete(wd); btn.classList.remove('selected'); }
          else { selectedDays.add(wd); btn.classList.add('selected'); }
        };
      });

      const extraEl = overlay.querySelector('#cal-f-repeat-extra');
      const monthlyHintEl = overlay.querySelector('#cal-f-monthly-hint');
      function syncRepeatUI() {
        const val = repeatSel.value;
        extraEl.style.display = val ? '' : 'none';
        weekdaysEl.style.display = val === 'weekly' ? 'flex' : 'none';
        monthlyHintEl.style.display = val === 'monthly' ? '' : 'none';
        if (val === 'monthly') {
          const dd = dateInput.value ? parseInt(dateInput.value.split('-')[2], 10) : d.getDate();
          monthlyHintEl.textContent = monthlyHint(dd);
        }
      }
      repeatSel.onchange = syncRepeatUI;
      dateInput.onChange(syncRepeatUI);
      syncRepeatUI();

      overlay.querySelector('#cal-f-cancel').onclick = () => overlay.remove();
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

      if (existing) {
        overlay.querySelector('#cal-f-delete').onclick = async () => {
          let scope = 'this';
          if (existing.recurring) {
            scope = await askScope(widgetEl, t('scope_delete_question'));
            if (!scope) return;
          } else if (!confirm(t('confirm_delete'))) {
            return;
          }
          try {
            await api(`/events/${existing.id}?scope=${scope}`, { method: 'DELETE' });
          } catch (err) {
            alert(t('save_failed'));
            return;
          }
          overlay.remove();
          refresh();
        };
      }

      overlay.querySelector('#cal-f-save').onclick = async () => {
        const title = overlay.querySelector('#cal-f-title').value.trim();
        if (!title) { alert(t('title_required')); return; }
        if (!dateInput.value) { alert(t('date_required')); return; }
        const recurType = repeatSel.value || null;
        if (recurType) {
          if (!untilInput.value) { alert(t('repeat_until_required')); return; }
          if (recurType === 'weekly' && selectedDays.size === 0) { alert(t('repeat_days_required')); return; }
        }
        let scope = 'this';
        if (existing && existing.recurring) {
          scope = await askScope(widgetEl, t('scope_edit_question'));
          if (!scope) return;
        }
        const body = {
          title,
          description: overlay.querySelector('#cal-f-desc').value.trim(),
          date: dateInput.value,
          start_time: startInput.value || null,
          end_time: endInput.value || null,
          recur_type: recurType,
          recur_days: recurType === 'weekly' ? Array.from(selectedDays) : null,
          recur_until: recurType ? untilInput.value : null,
        };
        try {
          if (existing) await api(`/events/${existing.id}?scope=${scope}`, { method: 'PUT', body: JSON.stringify(body) });
          else await api('/events', { method: 'POST', body: JSON.stringify(body) });
        } catch (err) {
          alert(t('save_failed'));
          return;
        }
        overlay.remove();
        refresh();
      };
    }

    async function refresh() {
      if (destroyed) return;
      renderToolbar();
      await loadEvents();
      if (destroyed) return;
      renderBody();
    }

    async function start() {
      settings = await loadDisplaySettings();
      await refresh();
      if (opts.openEvent) {
        const e = events.find(x => x.id === opts.openEvent);
        if (e) { anchor = new Date(e.date + 'T00:00:00'); view = 'day'; await refresh(); openViewDialog(e); }
      }
    }
    start();

    return { destroy() { destroyed = true; } };
  }

  window.CalendarWidget = { mount };
})();
