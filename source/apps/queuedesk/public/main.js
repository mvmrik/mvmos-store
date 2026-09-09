// mvmOS App: QueueDesk v1.0.0

const _qdi18n = {
  en: {
    title:             'QueueDesk',
    settings:          '⚙ Settings',
    share:             '🔗 Share',
    tab_bookings:      'Bookings',
    tab_rules:         'Weekly Hours',
    tab_overrides:     'Days Off',
    tab_today:         'Today',
    tab_history:       'History',
    mode_label:        'Mode',
    mode_schedule:     'Appointment schedule',
    mode_queue:        'Walk-in number queue',
    business_name:     'Business name',
    public_lang:       'Public page language',
    public_page_enabled:'Enable the direct public page',
    site_widgets:      'Offer this public page as a site widget',
    site_widgets_error:'Could not connect the widget. Enable mvmSiteBuilder App API in Apps Hub first.',
    save_settings:     'Save Settings',
    settings_saved:    'Settings saved.',
    slug_label:        'Public page address',
    slug_save:         'Save',
    slug_saved:        'Address saved.',
    slug_taken:        'That address is already taken.',
    slug_invalid:      'Invalid address.',
    weekdays:          ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    add_rule:          '+ Add',
    start_time:        'Start',
    end_time:          'End',
    slot_minutes:      'Slot (min)',
    no_rules:          'No weekly hours set yet.',
    del_rule:          'Remove',
    add_override:      '+ Add',
    override_date:     'Date',
    override_note:     'Note (optional)',
    no_overrides:      'No days off scheduled.',
    del_override:      'Remove',
    date_from:         'From',
    date_to:           'To',
    no_bookings:       'No bookings in this range.',
    client_col:        'Client',
    time_col:          'When',
    status_col:        'Status',
    cancel_booking:    'Cancel',
    confirm_cancel_booking: 'Cancel this booking?',
    phone_label:       'Phone',
    email_label:       'Email',
    message_label:     'Message',
    current_number:    'Now serving',
    call_next:         'Call Next',
    reset_queue:       'Reset Queue',
    confirm_reset:     'Reset today\'s queue? All of today\'s tickets will be cleared and numbering will start over from 1.',
    waiting_list:      'Waiting',
    no_tickets:        'No tickets yet today.',
    serving_none:      'No one is being served right now.',
    limit_label:       'Remaining capacity',
    limit_unlimited:   'No limit',
    limit_left:        'left',
    limit_placeholder: 'e.g. 5',
    limit_set:         'Set',
    limit_clear:       'Clear',
    cancel_ticket:     'Cancel',
    confirm_cancel_ticket: 'Cancel this ticket?',
    verify_code_label: 'Verification code',
    history_date:      'Date',
    no_history:        'No tickets for this date.',
    share_title:       'Share your public page',
    share_link_label:  'Public link',
    share_copy:        'Copy',
    share_copied:      'Copied!',
    share_hint:        'Clients use this link to book an appointment or pull a number, with no account needed.',
    close:             'Close',
    status_booked:     'Booked',
    status_cancelled:  'Cancelled',
    status_waiting:    'Waiting',
    status_called:     'Called',
    status_served:     'Served',
    new_booking:       'New booking from',
    new_ticket:        'New ticket #',
    from_client:       'from',
    weekday_full:      ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'],
  },
  bg: {
    title:             'QueueDesk',
    settings:          '⚙ Настройки',
    share:             '🔗 Сподели',
    tab_bookings:      'Резервации',
    tab_rules:         'Седмичен график',
    tab_overrides:     'Почивни дни',
    tab_today:         'Днес',
    tab_history:       'История',
    mode_label:        'Режим',
    mode_schedule:     'График с часове',
    mode_queue:        'Номерца на място',
    business_name:     'Име на бизнеса',
    public_lang:       'Език на публичната страница',
    public_page_enabled:'Разреши директната публична страница',
    site_widgets:      'Предлагай публичната страница като уиджет за сайт',
    site_widgets_error:'Уиджетът не можа да се свърже. Първо активирай App API за mvmSiteBuilder в Apps Hub.',
    save_settings:     'Запази настройките',
    settings_saved:    'Настройките са запазени.',
    slug_label:        'Адрес на публичната страница',
    slug_save:         'Запази',
    slug_saved:        'Адресът е запазен.',
    slug_taken:        'Този адрес вече е зает.',
    slug_invalid:      'Невалиден адрес.',
    weekdays:          ['Пон','Вт','Ср','Чет','Пет','Съб','Нед'],
    add_rule:          '+ Добави',
    start_time:        'Начало',
    end_time:          'Край',
    slot_minutes:      'Слот (мин)',
    no_rules:          'Няма зададен седмичен график.',
    del_rule:          'Премахни',
    add_override:      '+ Добави',
    override_date:     'Дата',
    override_note:     'Бележка (незадължително)',
    no_overrides:      'Няма зададени почивни дни.',
    del_override:      'Премахни',
    date_from:         'От',
    date_to:           'До',
    no_bookings:       'Няма резервации в този период.',
    client_col:        'Клиент',
    time_col:          'Кога',
    status_col:        'Статус',
    cancel_booking:    'Откажи',
    confirm_cancel_booking: 'Да се откаже ли тази резервация?',
    phone_label:       'Телефон',
    email_label:       'Имейл',
    message_label:     'Съобщение',
    current_number:    'Текущ номер',
    call_next:         'Следващ номер',
    reset_queue:       'Нулирай опашката',
    confirm_reset:     'Да се нулира ли днешната опашка? Всички номера за днес ще бъдат изтрити и номерацията ще започне отначало от 1.',
    waiting_list:      'Чакащи',
    no_tickets:        'Няма номера засега.',
    serving_none:      'В момента никой не се обслужва.',
    limit_label:       'Оставащ капацитет',
    limit_unlimited:   'Без ограничение',
    limit_left:        'остават',
    limit_placeholder: 'напр. 5',
    limit_set:         'Задай',
    limit_clear:       'Изчисти',
    cancel_ticket:     'Откажи',
    confirm_cancel_ticket: 'Да се откаже ли този номер?',
    verify_code_label: 'Код за проверка',
    history_date:      'Дата',
    no_history:        'Няма номера за тази дата.',
    share_title:       'Сподели публичната си страница',
    share_link_label:  'Публичен линк',
    share_copy:        'Копирай',
    share_copied:      'Копирано!',
    share_hint:        'Клиентите ползват този линк, за да запазят час или изтеглят номер, без профил.',
    close:             'Затвори',
    status_booked:     'Запазено',
    status_cancelled:  'Отказано',
    status_waiting:    'Чака',
    status_called:     'Извикан',
    status_served:     'Обслужен',
    new_booking:       'Нова резервация от',
    new_ticket:        'Нов номер #',
    from_client:       'от',
    weekday_full:      ['Понеделник','Вторник','Сряда','Четвъртък','Петък','Събота','Неделя'],
  },
};
function _qdt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_qdi18n[lang] || _qdi18n.en)[key] || key;
}

mvmOS.registerApp({
  id: 'queuedesk',
  name: 'QueueDesk',
  icon: '🎫',
  category: 'Utilities',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'queuedesk',
      title: '🎫 QueueDesk',
      width: 800,
      height: 600,
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        QD.mount(body);
      },
    });
  },
});

const QD = (() => {
  let _root = null;
  let _view = 'main';      // 'main' | 'settings'
  let _tab  = null;        // set once settings load, based on mode
  let _settings = { mode: 'schedule', business_name: '', public_lang: 'en', site_widgets_enabled: false, public_page_enabled: false };
  let _slug = '';
  let _pubUser = null;
  let _rules = [];
  let _overrides = [];
  let _bookings = [];
  let _bookFrom = '';
  let _bookTo = '';
  let _queueToday = { date: '', current_number: 0, tickets: [] };
  let _historyDate = '';
  let _history = [];
  let _lastEventsAt = null;
  let _pollTimer = null;

  const _t = _qdt;

  // ── API ───────────────────────────────────────────────────────────────────

  async function _api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    if (token) opts.headers['X-Pub-Token'] = token;
    const r = await fetch(`/api/apps/queuedesk${path}`, opts);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(txt || r.statusText);
    }
    return r.json();
  }

  async function _syncSiteWidget(enabled, businessName) {
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    if (!token) throw new Error('Apps Hub login required');
    if (!_slug) await _loadSlug();
    const widgets = enabled ? [{
      id: 'public-page', name: businessName || 'QueueDesk',
      description: _settings.mode === 'queue' ? 'Number queue' : 'Appointment schedule',
      embed_url: `/pub/queuedesk/${_slug}/embed`, height: 720,
    }] : [];
    const r = await fetch('/api/platform/apps/mvmsitebuilder/call', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
      body: JSON.stringify({ method: 'set_site_widgets', args: [], kwargs: { source: 'queuedesk', widgets } }),
    });
    if (!r.ok) throw new Error(await r.text());
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _esc(str) { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _iStyle(ex) { return `padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.85rem;outline:none;${ex||''}`; }
  function _btnStyle(type) {
    const b = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;';
    if (type === 'primary') return b + 'border:none;background:var(--accent);color:#fff;';
    if (type === 'danger')  return b + 'border:1px solid #e05252;background:transparent;color:#e05252;';
    if (type === 'ghost')   return b + 'border:1px solid var(--border);background:transparent;color:var(--text-dim);';
    return b + 'border:1px solid var(--border);background:var(--surface);color:var(--text);';
  }
  function _lblStyle() { return 'display:flex;flex-direction:column;gap:4px;font-size:.82rem;'; }
  function _statusLabel(s) { return _t('status_' + s) || s; }
  function _fmtSecs(s) {
    const m = Math.round(s / 60);
    return m + ' ' + (window.mvmOS?.lang === 'bg' ? 'мин' : 'min');
  }
  function _todayStr() { return new Date().toISOString().slice(0, 10); }
  function _fmtDate(dateStr) {
    if (!dateStr) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return dateStr;
    const [, y, mo, d] = m;
    const fmt = window._vosSettings?.date_format || 'DD/MM/YYYY';
    if (fmt === 'MM/DD/YYYY') return `${mo}/${d}/${y}`;
    if (fmt === 'YYYY-MM-DD') return `${y}-${mo}-${d}`;
    return `${d}/${mo}/${y}`;
  }
  function _plusDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  async function _loadSettings() {
    _settings = await _api('GET', '/settings');
    if (!_tab) _tab = _settings.mode === 'queue' ? 'today' : 'bookings';
  }
  async function _loadSlug() {
    const r = await _api('GET', '/public-slug');
    _slug = r.slug;
  }
  async function _loadRules() {
    _rules = await _api('GET', '/schedule/rules');
  }
  async function _loadOverrides() {
    _overrides = await _api('GET', '/schedule/overrides');
  }
  async function _loadBookings() {
    if (!_bookFrom) { _bookFrom = _todayStr(); _bookTo = _plusDays(_bookFrom, 30); }
    _bookings = await _api('GET', `/bookings?date_from=${_bookFrom}&date_to=${_bookTo}`);
  }
  async function _loadQueueToday() {
    _queueToday = await _api('GET', '/queue/today');
  }
  async function _loadHistory() {
    if (!_historyDate) _historyDate = _todayStr();
    _history = await _api('GET', `/queue/history?date=${_historyDate}`);
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function _showStartError(e) {
    const w = _wrap();
    if (w) w.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${String(e)}</div>`;
  }

  function mount(root) {
    _root = root;
    root.innerHTML = `<div id="qd-wrap" style="display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);font-family:inherit"></div>`;

    const _start = async () => {
      if (typeof AppHub !== 'undefined') {
        const t = AppHub.getToken();
        if (t) {
          _pubUser = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': t } })
            .then(r => r.ok ? r.json() : null).catch(() => null);
        }
      }
      await _loadSettings();
      await _loadTabData();
      _render();
      _lastEventsAt = new Date().toISOString();
      _startPolling();
    };

    _start().catch(e => {
      if (String(e).includes('login_required') && typeof AppHub !== 'undefined') {
        AppHub.requireLogin(() => _start().catch(_showStartError));
        return;
      }
      _showStartError(e);
    });
  }

  async function _loadTabData() {
    if (_settings.mode === 'schedule') {
      if (_tab === 'bookings') await _loadBookings();
      else if (_tab === 'rules') await _loadRules();
      else if (_tab === 'overrides') await _loadOverrides();
    } else {
      if (_tab === 'today') await _loadQueueToday();
      else if (_tab === 'history') await _loadHistory();
    }
  }

  function _startPolling() {
    _pollTimer = setInterval(async () => {
      if (!document.contains(_root)) { clearInterval(_pollTimer); return; }
      try {
        const data = await _api('GET', `/events?since=${encodeURIComponent(_lastEventsAt)}`);
        _lastEventsAt = data.now;
        data.bookings.forEach(b => {
          mvmOS.notify('QueueDesk', `${_t('new_booking')} ${b.client_name} — ${_fmtDate(b.date)} ${b.start_time}`);
        });
        data.tickets.forEach(tk => {
          mvmOS.notify('QueueDesk', `${_t('new_ticket')}${tk.number} ${_t('from_client')} ${tk.client_name}`);
        });
        if (data.bookings.length || data.tickets.length) {
          if (_view === 'main') { await _loadTabData(); _render(); }
        }
      } catch (e) { /* ignore transient poll errors */ }
    }, 8000);
  }

  function _wrap() { return _root?.querySelector('#qd-wrap'); }
  function _render() {
    const w = _wrap();
    if (!w) return;
    if (_view === 'settings') _renderSettings(w);
    else _renderMain(w);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ══════════════════════════════════════════════════════════════════════════

  function _renderHeader(w, tabs) {
    const userName = _pubUser?.display_name || '';
    const tabsHtml = tabs.map(([key, label]) => `
      <button class="qd-tab" data-tab="${key}" style="padding:7px 14px;border:none;background:transparent;
        border-bottom:2px solid ${_tab === key ? 'var(--accent)' : 'transparent'};
        color:${_tab === key ? 'var(--text)' : 'var(--text-dim)'};cursor:pointer;font-size:.85rem;font-family:inherit">${label}</button>
    `).join('');

    w.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-weight:600;font-size:.97rem">🎫 ${_t('title')}</span>
        <div style="display:flex;gap:10px;align-items:center">
          ${userName ? `<span style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">${_esc(userName)}</span>` : ''}
          <button id="qd-btn-share" style="${_btnStyle('secondary')}">${_t('share')}</button>
          <button id="qd-btn-settings" style="${_btnStyle('secondary')}">${_t('settings')}</button>
        </div>
      </div>
      <div style="display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--border);flex-shrink:0">${tabsHtml}</div>
      <div id="qd-body" style="flex:1;overflow-y:auto;padding:16px"></div>
    `;
    w.querySelector('#qd-btn-settings').onclick = () => { _view = 'settings'; _render(); };
    w.querySelector('#qd-btn-share').onclick = _showShareModal;
    w.querySelectorAll('.qd-tab').forEach(btn => {
      btn.onclick = async () => {
        _tab = btn.dataset.tab;
        await _loadTabData();
        _render();
      };
    });
    return w.querySelector('#qd-body');
  }

  function _renderMain(w) {
    if (_settings.mode === 'queue') {
      const body = _renderHeader(w, [['today', _t('tab_today')], ['history', _t('tab_history')]]);
      if (_tab === 'history') _renderHistoryTab(body);
      else _renderTodayTab(body);
    } else {
      const body = _renderHeader(w, [
        ['bookings', _t('tab_bookings')],
        ['rules', _t('tab_rules')],
        ['overrides', _t('tab_overrides')],
      ]);
      if (_tab === 'rules') _renderRulesTab(body);
      else if (_tab === 'overrides') _renderOverridesTab(body);
      else _renderBookingsTab(body);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHEDULE MODE: BOOKINGS TAB
  // ══════════════════════════════════════════════════════════════════════════

  function _renderBookingsTab(el) {
    el.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:14px;flex-wrap:wrap">
        <label style="${_lblStyle()}"><span>${_t('date_from')}</span>
          <input id="qd-bf" type="date" value="${_bookFrom}" style="${_iStyle()}"></label>
        <label style="${_lblStyle()}"><span>${_t('date_to')}</span>
          <input id="qd-bt" type="date" value="${_bookTo}" style="${_iStyle()}"></label>
      </div>
      <div id="qd-booking-list"></div>
    `;
    const reload = async () => {
      _bookFrom = el.querySelector('#qd-bf').value;
      _bookTo = el.querySelector('#qd-bt').value;
      await _loadBookings();
      _renderBookingList(el.querySelector('#qd-booking-list'));
    };
    el.querySelector('#qd-bf').onchange = reload;
    el.querySelector('#qd-bt').onchange = reload;
    _renderBookingList(el.querySelector('#qd-booking-list'));
  }

  function _renderBookingList(el) {
    if (_bookings.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:40px;font-size:.88rem">${_t('no_bookings')}</div>`;
      return;
    }
    el.innerHTML = _bookings.map(b => `
      <div style="padding:11px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:8px;background:var(--surface)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <div>
            <div style="font-weight:600;font-size:.9rem">${_esc(b.client_name)}</div>
            <div style="font-size:.78rem;color:var(--text-dim);margin-top:3px">${_esc(_fmtDate(b.date))} · ${_esc(b.start_time)}–${_esc(b.end_time)}</div>
            ${b.client_phone ? `<div style="font-size:.76rem;color:var(--text-dim)">${_t('phone_label')}: ${_esc(b.client_phone)}</div>` : ''}
            ${b.client_email ? `<div style="font-size:.76rem;color:var(--text-dim)">${_t('email_label')}: ${_esc(b.client_email)}</div>` : ''}
            ${b.message ? `<div style="font-size:.76rem;color:var(--text-dim);margin-top:3px">${_esc(b.message)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span style="font-size:.74rem;padding:2px 8px;border-radius:10px;background:var(--bg);color:${b.status === 'booked' ? 'var(--accent)' : 'var(--text-dim)'}">${_statusLabel(b.status)}</span>
            ${b.status === 'booked' ? `<button class="qd-cancel-booking" data-id="${b.id}" style="${_btnStyle('danger')}">${_t('cancel_booking')}</button>` : ''}
          </div>
        </div>
      </div>
    `).join('');
    el.querySelectorAll('.qd-cancel-booking').forEach(btn => {
      btn.onclick = async () => {
        if (!await mvmOS.confirm(_t('confirm_cancel_booking'))) return;
        await _api('POST', `/bookings/${btn.dataset.id}/cancel`);
        await _loadBookings();
        _renderBookingList(el);
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHEDULE MODE: RULES TAB
  // ══════════════════════════════════════════════════════════════════════════

  function _renderRulesTab(el) {
    const wd = _t('weekday_full');
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
        <label style="${_lblStyle()}"><span>${_t('mode_label')==='Mode'?'Day':'Ден'}</span>
          <select id="qd-r-wd" style="${_iStyle()}">${wd.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}</select></label>
        <label style="${_lblStyle()}"><span>${_t('start_time')}</span>
          <input id="qd-r-start" type="time" value="09:00" style="${_iStyle()}"></label>
        <label style="${_lblStyle()}"><span>${_t('end_time')}</span>
          <input id="qd-r-end" type="time" value="17:00" style="${_iStyle()}"></label>
        <label style="${_lblStyle()}"><span>${_t('slot_minutes')}</span>
          <input id="qd-r-slot" type="number" min="5" step="5" value="30" style="${_iStyle('width:70px')}"></label>
        <button id="qd-r-add" style="${_btnStyle('primary')}">${_t('add_rule')}</button>
      </div>
      <div id="qd-rules-list"></div>
    `;
    el.querySelector('#qd-r-add').onclick = async () => {
      const weekday = parseInt(el.querySelector('#qd-r-wd').value);
      const start_time = el.querySelector('#qd-r-start').value;
      const end_time = el.querySelector('#qd-r-end').value;
      const slot_minutes = parseInt(el.querySelector('#qd-r-slot').value) || 30;
      if (!start_time || !end_time || start_time >= end_time) return;
      await _api('POST', '/schedule/rules', { weekday, start_time, end_time, slot_minutes });
      await _loadRules();
      _renderRulesList(el.querySelector('#qd-rules-list'));
    };
    _renderRulesList(el.querySelector('#qd-rules-list'));
  }

  function _renderRulesList(el) {
    const wd = _t('weekday_full');
    if (_rules.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:20px;font-size:.88rem">${_t('no_rules')}</div>`;
      return;
    }
    el.innerHTML = _rules.map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:7px;background:var(--surface)">
        <span style="font-size:.85rem">${wd[r.weekday]} · ${r.start_time}–${r.end_time} · ${r.slot_minutes} min</span>
        <button class="qd-del-rule" data-id="${r.id}" style="${_btnStyle('ghost')} font-size:.75rem">${_t('del_rule')}</button>
      </div>
    `).join('');
    el.querySelectorAll('.qd-del-rule').forEach(btn => {
      btn.onclick = async () => {
        await _api('DELETE', `/schedule/rules/${btn.dataset.id}`);
        await _loadRules();
        _renderRulesList(el);
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHEDULE MODE: OVERRIDES (DAYS OFF) TAB
  // ══════════════════════════════════════════════════════════════════════════

  function _renderOverridesTab(el) {
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;padding:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface)">
        <label style="${_lblStyle()}"><span>${_t('override_date')}</span>
          <input id="qd-o-date" type="date" value="${_todayStr()}" style="${_iStyle()}"></label>
        <label style="${_lblStyle()}"><span>${_t('override_note')}</span>
          <input id="qd-o-note" style="${_iStyle('width:180px')}"></label>
        <button id="qd-o-add" style="${_btnStyle('primary')}">${_t('add_override')}</button>
      </div>
      <div id="qd-overrides-list"></div>
    `;
    el.querySelector('#qd-o-add').onclick = async () => {
      const date = el.querySelector('#qd-o-date').value;
      const note = el.querySelector('#qd-o-note').value.trim();
      if (!date) return;
      await _api('POST', '/schedule/overrides', { date, note });
      await _loadOverrides();
      _renderOverridesList(el.querySelector('#qd-overrides-list'));
    };
    _renderOverridesList(el.querySelector('#qd-overrides-list'));
  }

  function _renderOverridesList(el) {
    if (_overrides.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:20px;font-size:.88rem">${_t('no_overrides')}</div>`;
      return;
    }
    el.innerHTML = _overrides.map(o => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:7px;background:var(--surface)">
        <span style="font-size:.85rem">${_esc(_fmtDate(o.date))}${o.note ? ' · ' + _esc(o.note) : ''}</span>
        <button class="qd-del-override" data-id="${o.id}" style="${_btnStyle('ghost')} font-size:.75rem">${_t('del_override')}</button>
      </div>
    `).join('');
    el.querySelectorAll('.qd-del-override').forEach(btn => {
      btn.onclick = async () => {
        await _api('DELETE', `/schedule/overrides/${btn.dataset.id}`);
        await _loadOverrides();
        _renderOverridesList(el);
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QUEUE MODE: TODAY TAB
  // ══════════════════════════════════════════════════════════════════════════

  function _renderTodayTab(el) {
    const current = _queueToday.tickets.find(t => t.status === 'called');
    const waiting = _queueToday.tickets.filter(t => t.status === 'waiting');
    const limit = _queueToday.limit_remaining;
    el.innerHTML = `
      <div style="text-align:center;padding:18px 0 22px;border-bottom:1px solid var(--border);margin-bottom:16px">
        <div style="font-size:2.6rem;font-weight:800;color:var(--accent)">${_queueToday.current_number || '—'}</div>
        <div style="font-size:.8rem;color:var(--text-dim);margin-top:4px">${_t('current_number')} · ${_esc(_fmtDate(_queueToday.date))}</div>
        <div id="qd-serving-details" style="margin-top:12px"></div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:14px">
          <button id="qd-call-next" style="${_btnStyle('primary')}">${_t('call_next')}</button>
          <button id="qd-reset-queue" style="${_btnStyle('danger')}">${_t('reset_queue')}</button>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div style="font-size:.82rem;color:var(--text-dim)">${_t('waiting_list')} (${waiting.length})</div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:.78rem;color:var(--text-dim)">${_t('limit_label')}:</span>
          <span id="qd-limit-current" style="font-size:.78rem;font-weight:600">${limit === null || limit === undefined ? _t('limit_unlimited') : `${limit} ${_t('limit_left')}`}</span>
          <input id="qd-limit-input" type="number" min="0" placeholder="${_t('limit_placeholder')}" style="${_iStyle('width:70px')}">
          <button id="qd-limit-set" style="${_btnStyle('secondary')}">${_t('limit_set')}</button>
          <button id="qd-limit-clear" style="${_btnStyle('secondary')}">${_t('limit_clear')}</button>
        </div>
      </div>
      <div id="qd-ticket-list"></div>
    `;
    el.querySelector('#qd-call-next').onclick = async () => {
      const r = await _api('POST', '/queue/call-next');
      await _loadQueueToday();
      _renderTodayTab(el);
    };
    el.querySelector('#qd-reset-queue').onclick = async () => {
      if (!await mvmOS.confirm(_t('confirm_reset'))) return;
      await _api('POST', '/queue/reset');
      await _loadQueueToday();
      _renderTodayTab(el);
    };
    el.querySelector('#qd-limit-set').onclick = async () => {
      const v = el.querySelector('#qd-limit-input').value.trim();
      if (v === '') return;
      await _api('POST', '/queue/limit', { remaining: parseInt(v, 10) });
      await _loadQueueToday();
      _renderTodayTab(el);
    };
    el.querySelector('#qd-limit-clear').onclick = async () => {
      await _api('POST', '/queue/limit', { remaining: null });
      await _loadQueueToday();
      _renderTodayTab(el);
    };
    _renderServingDetails(el.querySelector('#qd-serving-details'), current);
    _renderTicketList(el.querySelector('#qd-ticket-list'), waiting);
  }

  function _renderServingDetails(el, tk) {
    if (!tk) {
      el.innerHTML = `<div style="font-size:.78rem;color:var(--text-dim)">${_t('serving_none')}</div>`;
      return;
    }
    el.innerHTML = `
      <div style="display:inline-block;text-align:left;padding:10px 14px;border:1px solid var(--accent);border-radius:6px;background:var(--surface)">
        <div style="font-weight:700;font-size:.95rem">${_esc(tk.client_name)}</div>
        ${tk.client_phone ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:3px">${_t('phone_label')}: ${_esc(tk.client_phone)}</div>` : ''}
        ${tk.client_email ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">${_t('email_label')}: ${_esc(tk.client_email)}</div>` : ''}
        ${tk.message ? `<div style="font-size:.78rem;color:var(--text-dim);margin-top:2px">${_t('message_label')}: ${_esc(tk.message)}</div>` : ''}
        ${tk.verify_code ? `<div style="font-size:.82rem;color:var(--accent);margin-top:6px;font-weight:700;letter-spacing:1px">${_t('verify_code_label')}: ${_esc(tk.verify_code)}</div>` : ''}
      </div>
    `;
  }

  function _renderTicketList(el, tickets) {
    if (tickets.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:20px;font-size:.88rem">${_t('no_tickets')}</div>`;
      return;
    }
    el.innerHTML = tickets.map(tk => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:7px;background:var(--surface)">
        <div>
          <span style="font-weight:700;font-size:.95rem">#${tk.number}</span>
          <span style="font-size:.85rem;margin-left:8px">${_esc(tk.client_name)}</span>
          <span style="font-size:.74rem;padding:2px 8px;border-radius:10px;background:var(--bg);color:${tk.status === 'called' ? 'var(--accent)' : 'var(--text-dim)'};margin-left:8px">${_statusLabel(tk.status)}</span>
          ${tk.client_phone ? `<div style="font-size:.75rem;color:var(--text-dim);margin-top:2px">${_t('phone_label')}: ${_esc(tk.client_phone)}</div>` : ''}
        </div>
        <button class="qd-cancel-ticket" data-id="${tk.id}" style="${_btnStyle('danger')}">${_t('cancel_ticket')}</button>
      </div>
    `).join('');
    el.querySelectorAll('.qd-cancel-ticket').forEach(btn => {
      btn.onclick = async () => {
        if (!await mvmOS.confirm(_t('confirm_cancel_ticket'))) return;
        await _api('POST', `/queue/tickets/${btn.dataset.id}/cancel`);
        await _loadQueueToday();
        const body = _wrap().querySelector('#qd-body');
        if (body) _renderTodayTab(body);
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QUEUE MODE: HISTORY TAB
  // ══════════════════════════════════════════════════════════════════════════

  function _renderHistoryTab(el) {
    el.innerHTML = `
      <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:14px">
        <label style="${_lblStyle()}"><span>${_t('history_date')}</span>
          <input id="qd-h-date" type="date" value="${_historyDate}" max="${_todayStr()}" style="${_iStyle()}"></label>
      </div>
      <div id="qd-history-list"></div>
    `;
    el.querySelector('#qd-h-date').onchange = async () => {
      _historyDate = el.querySelector('#qd-h-date').value;
      await _loadHistory();
      _renderHistoryList(el.querySelector('#qd-history-list'));
    };
    _renderHistoryList(el.querySelector('#qd-history-list'));
  }

  function _renderHistoryList(el) {
    if (_history.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:20px;font-size:.88rem">${_t('no_history')}</div>`;
      return;
    }
    el.innerHTML = _history.map(tk => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 14px;border:1px solid var(--border);border-radius:6px;margin-bottom:7px;background:var(--surface)">
        <span style="font-size:.85rem"><b>#${tk.number}</b> · ${_esc(tk.client_name)}</span>
        <span style="font-size:.74rem;padding:2px 8px;border-radius:10px;background:var(--bg);color:var(--text-dim)">${_statusLabel(tk.status)}</span>
      </div>
    `).join('');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS VIEW
  // ══════════════════════════════════════════════════════════════════════════

  async function _renderSettings(w) {
    if (!_slug) { try { await _loadSlug(); } catch (e) {} }
    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <button id="qd-back" style="${_btnStyle('secondary')}">← ${_t('close')}</button>
        <span style="font-weight:600;font-size:.92rem">${_t('settings')}</span>
      </div>
      <div style="flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:16px;max-width:460px">
        <label style="${_lblStyle()}">
          <span>${_t('mode_label')}</span>
          <select id="qd-s-mode" style="${_iStyle()}">
            <option value="schedule" ${_settings.mode === 'schedule' ? 'selected' : ''}>${_t('mode_schedule')}</option>
            <option value="queue" ${_settings.mode === 'queue' ? 'selected' : ''}>${_t('mode_queue')}</option>
          </select>
        </label>
        <label style="${_lblStyle()}">
          <span>${_t('business_name')}</span>
          <input id="qd-s-name" value="${_esc(_settings.business_name)}" style="${_iStyle()}">
        </label>
        <label style="${_lblStyle()}">
          <span>${_t('public_lang')}</span>
          <select id="qd-s-lang" style="${_iStyle()}">
            <option value="en" ${_settings.public_lang === 'en' ? 'selected' : ''}>English</option>
            <option value="bg" ${_settings.public_lang === 'bg' ? 'selected' : ''}>Български</option>
          </select>
        </label>
        <label style="${_lblStyle()}flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="qd-s-widgets" ${_settings.site_widgets_enabled ? 'checked' : ''}><span>${_t('site_widgets')}</span></label>
        <label style="${_lblStyle()}flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="qd-s-public-page" ${_settings.public_page_enabled ? 'checked' : ''}><span>${_t('public_page_enabled')}</span></label>
        <button id="qd-s-save" style="${_btnStyle('primary')} align-self:flex-start">${_t('save_settings')}</button>
        <div id="qd-s-saved" style="font-size:.8rem;color:var(--accent);display:none">${_t('settings_saved')}</div>

        <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:6px">
          <label style="${_lblStyle()}">
            <span>${_t('slug_label')}</span>
            <div style="display:flex;gap:6px;align-items:center">
              <span style="font-size:.78rem;color:var(--text-dim)">${location.origin}/pub/queuedesk/</span>
              <input id="qd-s-slug" value="${_esc(_slug)}" style="${_iStyle('flex:1')}">
              <button id="qd-s-slug-save" style="${_btnStyle('secondary')}">${_t('slug_save')}</button>
            </div>
          </label>
          <div id="qd-s-slug-msg" style="font-size:.8rem;margin-top:6px"></div>
        </div>
      </div>
    `;
    w.querySelector('#qd-back').onclick = () => { _view = 'main'; _render(); };
    w.querySelector('#qd-s-save').onclick = async () => {
      const mode = w.querySelector('#qd-s-mode').value;
      const business_name = w.querySelector('#qd-s-name').value.trim();
      const public_lang = w.querySelector('#qd-s-lang').value;
      const site_widgets_enabled = w.querySelector('#qd-s-widgets').checked;
      const public_page_enabled = w.querySelector('#qd-s-public-page').checked;
      await _api('POST', '/settings', { mode, business_name, public_lang, site_widgets_enabled, public_page_enabled });
      _settings = { mode, business_name, public_lang, site_widgets_enabled, public_page_enabled };
      try { await _syncSiteWidget(site_widgets_enabled, business_name); }
      catch (e) { mvmOS.notify('QueueDesk', _t('site_widgets_error')); }
      _tab = mode === 'queue' ? 'today' : 'bookings';
      const savedEl = w.querySelector('#qd-s-saved');
      savedEl.style.display = 'block';
      setTimeout(() => savedEl.style.display = 'none', 2000);
    };
    w.querySelector('#qd-s-slug-save').onclick = async () => {
      const msgEl = w.querySelector('#qd-s-slug-msg');
      const val = w.querySelector('#qd-s-slug').value.trim();
      try {
        const r = await _api('POST', '/public-slug', { slug: val });
        _slug = r.slug;
        w.querySelector('#qd-s-slug').value = _slug;
        msgEl.style.color = 'var(--accent)';
        msgEl.textContent = _t('slug_saved');
      } catch (e) {
        msgEl.style.color = '#e05252';
        msgEl.textContent = String(e).includes('409') || String(e).includes('slug_taken') ? _t('slug_taken') : _t('slug_invalid');
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARE MODAL
  // ══════════════════════════════════════════════════════════════════════════

  async function _showShareModal() {
    if (!_slug) { try { await _loadSlug(); } catch (e) {} }
    const pubUrl = `${location.origin}/pub/queuedesk/${_slug}`;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:10000;display:flex;align-items:center;justify-content:center';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:22px;width:420px;display:flex;flex-direction:column;gap:14px';
    box.innerHTML = `
      <div style="font-weight:600;font-size:.97rem">${_t('share_title')}</div>
      <div style="font-size:.8rem;color:var(--text-dim);line-height:1.5">${_t('share_hint')}</div>
      <div style="${_lblStyle()}">
        <span style="color:var(--text-dim)">${_t('share_link_label')}</span>
        <div style="display:flex;gap:6px">
          <input id="qd-sh-url" readonly value="${_esc(pubUrl)}" style="${_iStyle('flex:1;cursor:text')}">
          <button id="qd-sh-copy" style="${_btnStyle('secondary')}">${_t('share_copy')}</button>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button id="qd-sh-close" style="${_btnStyle('secondary')}">${_t('close')}</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#qd-sh-copy').onclick = async () => {
      await navigator.clipboard.writeText(pubUrl).catch(() => {});
      const btn = box.querySelector('#qd-sh-copy');
      const orig = btn.textContent;
      btn.textContent = _t('share_copied');
      setTimeout(() => btn.textContent = orig, 1800);
    };
    const closeModal = () => overlay.remove();
    box.querySelector('#qd-sh-close').onclick = closeModal;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  }

  return { mount };
})();
