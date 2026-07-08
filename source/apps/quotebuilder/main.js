// mvmOS App: QuoteBuilder v2.0.0

const _qbi18n = {
  en: {
    title:               'QuoteBuilder',
    settings:            '⚙ Settings',
    new_project:         '+ New Project',
    no_projects:         'No projects yet — create one to get started.',
    h_total:             'h total',
    discount_label:      'discount',
    deposit_label:       'Deposit',
    back:                '← Back',
    add_service:         '+ Add Service',
    share:               '🔗 Share',
    hourly_rate:         'Hourly rate',
    global_hint:         'global',
    deposit_pct:         'Deposit %',
    discount_pct:        'Discount %',
    no_services:         'No services yet — add one above.',
    service_col:         'Service',
    hours_col:           'Hours',
    cost_col:            'Cost',
    summary:             'Summary',
    total_hours:         'Total hours',
    rate:                'Rate',
    subtotal:            'Subtotal',
    discount_row:        'Discount',
    total:               'Total',
    deposit_row:         'Deposit',
    remaining:           'Remaining after deposit',
    add_service_title:   'Add Service',
    from_templates:      'From templates',
    custom:              'Custom',
    service_name_ph:     'Service name',
    hours_label:         'hours',
    cancel:              'Cancel',
    add:                 'Add',
    global_settings:     'Global Settings',
    default_rate:        'Default hourly rate',
    currency_hint:       'Currency',
    system_default:      'System default',
    default_deposit:     'Default deposit %',
    save_settings:       'Save Settings',
    service_templates:   'Service Templates',
    add_template:        '+ Add Template',
    no_templates:        'No templates yet.',
    settings_saved:      'Settings saved.',
    project_name_prompt: 'Project name:',
    del_project:         'Delete project',
    del_service:         'Remove service',
    del_template:        'Delete template',
    template_name:       'Template name:',
    default_hours:       'Default hours:',
    description_ph:      'Description (optional)',
    min_label:           'min',
    fixed_price:         'Fixed price',
    by_time:             'By time',
    time_col:            'Time / Price',
    fixed_label:         'fixed',
    share_title:         'Share project',
    share_link_label:    'Public link',
    share_copy:          'Copy',
    share_copied:        'Copied!',
    share_show_hours:    'Show hours per service',
    share_show_rate:     'Show hourly rate',
    share_hint:          'Your client will see a live view of this project. Changes you make will reflect immediately.',
    share_lang:          'Quote language',
    close:               'Close',
    category:            'Category',
    uncategorized:       'Other',
    no_category_opt:     '— No category —',
    categories:          'Categories',
    add_category:        '+ Add',
    category_name_ph:    'New category name',
    no_categories:       'No categories yet — add one to organize your templates.',
    del_category:        'Delete category',
  },
  bg: {
    title:               'QuoteBuilder',
    settings:            '⚙ Настройки',
    new_project:         '+ Нов проект',
    no_projects:         'Няма проекти — създай първия.',
    h_total:             'ч общо',
    discount_label:      'отстъпка',
    deposit_label:       'Капаро',
    back:                '← Назад',
    add_service:         '+ Добави услуга',
    share:               '🔗 Сподели',
    hourly_rate:         'Цена на час',
    global_hint:         'глобално',
    deposit_pct:         'Капаро %',
    discount_pct:        'Отстъпка %',
    no_services:         'Няма услуги — добави една по-горе.',
    service_col:         'Услуга',
    hours_col:           'Часове',
    cost_col:            'Цена',
    summary:             'Разбивка',
    total_hours:         'Общо часове',
    rate:                'Цена на час',
    subtotal:            'Сума',
    discount_row:        'Отстъпка',
    total:               'Общо',
    deposit_row:         'Капаро',
    remaining:           'Остатък след капарото',
    add_service_title:   'Добави услуга',
    from_templates:      'От шаблони',
    custom:              'Персонална',
    service_name_ph:     'Име на услугата',
    hours_label:         'часа',
    cancel:              'Отказ',
    add:                 'Добави',
    global_settings:     'Общи настройки',
    default_rate:        'Цена на час по подразбиране',
    currency_hint:       'Валута',
    system_default:      'Системна по подразбиране',
    default_deposit:     'Капаро % по подразбиране',
    save_settings:       'Запази настройките',
    service_templates:   'Шаблони за услуги',
    add_template:        '+ Добави шаблон',
    no_templates:        'Няма шаблони.',
    settings_saved:      'Настройките са запазени.',
    project_name_prompt: 'Име на проекта:',
    del_project:         'Изтрий проект',
    del_service:         'Премахни услуга',
    del_template:        'Изтрий шаблон',
    template_name:       'Име на шаблона:',
    default_hours:       'Часове по подразбиране:',
    description_ph:      'Описание (незадължително)',
    min_label:           'мин',
    fixed_price:         'Фикс. цена',
    by_time:             'По часове',
    time_col:            'Час / Цена',
    fixed_label:         'фикс.',
    share_title:         'Споделяне на проекта',
    share_link_label:    'Публичен линк',
    share_copy:          'Копирай',
    share_copied:        'Копирано!',
    share_show_hours:    'Покажи часове за услуга',
    share_show_rate:     'Покажи цена на час',
    share_hint:          'Клиентът вижда оферта в реално време — всяна промяна се отразява веднага.',
    share_lang:          'Език на офертата',
    close:               'Затвори',
    category:            'Категория',
    uncategorized:       'Други',
    no_category_opt:     '— Без категория —',
    categories:          'Категории',
    add_category:        '+ Добави',
    category_name_ph:    'Име на нова категория',
    no_categories:       'Все още няма категории — добави, за да организираш шаблоните си.',
    del_category:        'Изтрий категория',
  },
};
function _qbt(key) {
  const lang = window.mvmOS?.lang || 'en';
  return (_qbi18n[lang] || _qbi18n.en)[key] || key;
}

mvmOS.registerApp({
  id: 'quotebuilder',
  name: 'QuoteBuilder',
  icon: '💰',
  category: 'Utilities',
  requires_apphub: true,
  launch() {
    mvmOS.createWindow({
      id: 'quotebuilder',
      title: '💰 QuoteBuilder',
      width: 760,
      height: 580,
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        PC.mount(body);
      },
    });
  },
});

const PC = (() => {
  let _root = null;
  let _view = 'projects';
  let _gs = { hourly_rate: 50, currency: null, deposit_percent: 30 };

  // Fixed list — symbol-only display, never real FX conversion. Kept in sync
  // manually with frontend/settings.js's own copy (this app can't import core JS).
  const _qbCurrencies = [
    { value: 'EUR', symbol: '€' }, { value: 'USD', symbol: '$' }, { value: 'GBP', symbol: '£' },
    { value: 'CHF', symbol: 'CHF' }, { value: 'JPY', symbol: '¥' }, { value: 'CNY', symbol: '¥' },
    { value: 'TRY', symbol: '₺' }, { value: 'UAH', symbol: '₴' }, { value: 'PLN', symbol: 'zł' },
    { value: 'RON', symbol: 'lei' }, { value: 'CZK', symbol: 'Kč' }, { value: 'HUF', symbol: 'Ft' },
    { value: 'CAD', symbol: '$' }, { value: 'AUD', symbol: '$' }, { value: 'SEK', symbol: 'kr' },
    { value: 'NOK', symbol: 'kr' }, { value: 'DKK', symbol: 'kr' }, { value: 'RUB', symbol: '₽' },
    { value: 'INR', symbol: '₹' },
  ];
  function _qbCurrencySymbol(code) {
    return (_qbCurrencies.find(c => c.value === code) || {}).symbol || code || '€';
  }
  let _baseServices = [];
  let _categories = [];
  let _projects = [];
  let _proj = null;
  let _svcs = [];
  let _pubUser = null;
  let _tplFilterCat = null;

  // ── API ───────────────────────────────────────────────────────────────────────

  async function _api(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const token = typeof AppHub !== 'undefined' ? AppHub.getToken() : null;
    if (token) opts.headers['X-Pub-Token'] = token;
    const r = await fetch(`/api/apps/quotebuilder${path}`, opts);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(txt || r.statusText);
    }
    return r.json();
  }

  // ── Data loaders ──────────────────────────────────────────────────────────────

  async function _loadSettings() {
    const raw = await _api('GET', '/settings');
    _gs = {
      hourly_rate:     raw.hourly_rate     !== undefined ? parseFloat(raw.hourly_rate)     : 50,
      currency:        raw.currency ? raw.currency : null,
      deposit_percent: raw.deposit_percent !== undefined ? parseFloat(raw.deposit_percent) : 30,
    };
  }

  async function _loadBaseServices() {
    _baseServices = await _api('GET', '/templates');
  }

  async function _loadCategories() {
    _categories = await _api('GET', '/categories');
  }

  async function _loadProjects() {
    const list = await _api('GET', '/projects');
    for (const p of list) {
      const rows = await _api('GET', `/projects/${p.id}/services`);
      const c    = _calcSummary(p, rows);
      p._hours = c.totalHours;
      p._total = c.total;
    }
    _projects = list;
  }

  async function _loadProject(id) {
    _proj = await _api('GET', `/projects/${id}`).catch(() => null);
    _svcs = _proj ? await _api('GET', `/projects/${id}/services`) : [];
  }

  // ── Calculation ───────────────────────────────────────────────────────────────

  function _calcSummary(proj, svcs) {
    const rate        = (proj.hourly_rate     != null) ? proj.hourly_rate     : _gs.hourly_rate;
    const depositPct  = (proj.deposit_percent != null) ? proj.deposit_percent : _gs.deposit_percent;
    const discountPct = proj.discount_percent || 0;
    const totalHours  = svcs.filter(sv => sv.fixed_price == null).reduce((s, sv) => s + sv.hours, 0);
    const fixedTotal  = svcs.filter(sv => sv.fixed_price != null).reduce((s, sv) => s + sv.fixed_price, 0);
    const subtotal    = totalHours * rate + fixedTotal;
    const discountAmt = subtotal * (discountPct / 100);
    const total       = subtotal - discountAmt;
    const depositAmt  = total * (depositPct / 100);
    const remainder   = total - depositAmt;
    return { rate, depositPct, discountPct, totalHours, fixedTotal, subtotal, discountAmt, total, depositAmt, remainder };
  }

  function _splitH(hours) {
    const h = Math.floor(hours || 0);
    const m = Math.min(Math.round(((hours || 0) - h) * 60 / 10) * 10, 50);
    return { h, m };
  }
  function _joinH(h, m) { return parseInt(h || 0) + parseInt(m || 0) / 60; }
  function _minsHtml(sel) {
    return [0,10,20,30,40,50].map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${String(v).padStart(2,'0')}</option>`).join('');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const _t   = _qbt;
  function _cur()      { return _qbCurrencySymbol(_gs.currency || window._vosSettings?.currency || 'EUR'); }
  function _fmtAmt(n)  { return n.toFixed(2) + ' ' + _cur(); }
  function _esc(str)   { return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _iStyle(ex) { return `padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.85rem;outline:none;${ex||''}`; }
  function _btnStyle(type) {
    const b = 'padding:5px 12px;border-radius:4px;cursor:pointer;font-size:.82rem;font-family:inherit;';
    if (type === 'primary') return b + 'border:none;background:var(--accent);color:#fff;';
    if (type === 'ghost')   return b + 'border:1px solid var(--border);background:transparent;color:var(--text-dim);';
    return b + 'border:1px solid var(--border);background:var(--surface);color:var(--text);';
  }
  function _lblStyle() { return 'display:flex;flex-direction:column;gap:4px;font-size:.82rem;'; }
  function _row()      { return 'display:flex;justify-content:space-between;align-items:center;'; }

  // ── Mount ─────────────────────────────────────────────────────────────────────

  function _showStartError(e) {
    const w = _wrap();
    if (w) w.innerHTML = `<div style="padding:20px;color:var(--text-dim)">${String(e)}</div>`;
  }

  function mount(root) {
    _root = root;
    root.innerHTML = `<div id="pc-wrap" style="display:flex;flex-direction:column;height:100%;background:var(--bg);color:var(--text);font-family:inherit"></div>`;

    const _start = async () => {
      if (typeof AppHub !== 'undefined') {
        const t = AppHub.getToken();
        if (t) {
          _pubUser = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': t } })
            .then(r => r.ok ? r.json() : null).catch(() => null);
        }
      }
      await Promise.all([_loadSettings(), _loadBaseServices(), _loadCategories(), _loadProjects()]);
      _render();
    };

    _start().catch(e => {
      if (String(e).includes('login_required') && typeof AppHub !== 'undefined') {
        AppHub.requireLogin(() => _start().catch(_showStartError));
        return;
      }
      _showStartError(e);
    });
  }

  function _wrap() { return _root?.querySelector('#pc-wrap'); }
  function _render() {
    const w = _wrap();
    if (!w) return;
    if      (_view === 'project')  _renderProject(w);
    else if (_view === 'settings') _renderSettings(w);
    else                           _renderProjects(w);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // VIEW: PROJECTS LIST
  // ══════════════════════════════════════════════════════════════════════════════

  function _renderProjects(w) {
    const userName = _pubUser?.display_name || '';
    w.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <span style="font-weight:600;font-size:.97rem">💰 ${_t('title')}</span>
        <div style="display:flex;gap:10px;align-items:center">
          ${userName ? `<span style="font-size:.78rem;color:var(--text-dim);white-space:nowrap">${_esc(userName)}</span>` : ''}
          <button id="pc-btn-gs"  style="${_btnStyle('secondary')}">${_t('settings')}</button>
          <button id="pc-btn-new" style="${_btnStyle('primary')}">${_t('new_project')}</button>
        </div>
      </div>
      <div id="pc-list" style="flex:1;overflow-y:auto;padding:14px 16px"></div>
    `;
    w.querySelector('#pc-btn-gs').onclick  = () => { _view = 'settings'; _render(); };
    w.querySelector('#pc-btn-new').onclick = _newProject;
    _renderList(w.querySelector('#pc-list'));
  }

  function _renderList(el) {
    if (_projects.length === 0) {
      el.innerHTML = `<div style="text-align:center;color:var(--text-dim);margin-top:60px;font-size:.88rem">${_t('no_projects')}</div>`;
      return;
    }
    el.innerHTML = _projects.map(p => {
      const rate        = p.hourly_rate     != null ? p.hourly_rate     : _gs.hourly_rate;
      const depositPct  = p.deposit_percent != null ? p.deposit_percent : _gs.deposit_percent;
      const discountPct = p.discount_percent || 0;
      return `
        <div class="pc-card" data-id="${p.id}" style="padding:13px 15px;border:1px solid var(--border);border-radius:6px;margin-bottom:9px;cursor:pointer;background:var(--surface);transition:border-color .15s">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="font-weight:600;font-size:.92rem">${_esc(p.name)}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:.92rem;font-weight:600;color:var(--accent)">${_fmtAmt(p._total)}</span>
              <button class="pc-del-proj" data-id="${p.id}" style="${_btnStyle('ghost')} font-size:.72rem;padding:1px 7px">✕</button>
            </div>
          </div>
          <div style="margin-top:5px;font-size:.76rem;color:var(--text-dim);display:flex;gap:14px;flex-wrap:wrap">
            <span>${p._hours.toFixed(1)} ${_t('h_total')}</span>
            <span>${rate.toFixed(2)} ${_cur()}/h</span>
            ${discountPct > 0 ? `<span>−${discountPct}% ${_t('discount_label')}</span>` : ''}
            <span>${_t('deposit_label')} ${depositPct}%</span>
          </div>
        </div>`;
    }).join('');

    el.querySelectorAll('.pc-card').forEach(card => {
      card.addEventListener('mouseenter', () => card.style.borderColor = 'var(--accent)');
      card.addEventListener('mouseleave', () => card.style.borderColor = 'var(--border)');
      card.onclick = async e => {
        if (e.target.closest('.pc-del-proj')) return;
        await _loadProject(parseInt(card.dataset.id));
        _view = 'project';
        _render();
      };
    });
    el.querySelectorAll('.pc-del-proj').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        const p  = _projects.find(x => x.id === id);
        if (!await mvmOS.confirm(`${_t('del_project')} "${p?.name}"?`)) return;
        await _api('DELETE', `/projects/${id}`);
        await _loadProjects();
        _renderList(el);
      };
    });
  }

  async function _newProject() {
    const name = await mvmOS.prompt(_t('project_name_prompt'), '');
    if (!name?.trim()) return;
    const proj = await _api('POST', '/projects', { name: name.trim() });
    await _loadProjects();
    _proj = proj;
    _svcs = [];
    _view = 'project';
    _render();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // VIEW: PROJECT DETAIL
  // ══════════════════════════════════════════════════════════════════════════════

  function _renderProject(w) {
    if (!_proj) { _view = 'projects'; _render(); return; }
    const p = _proj;

    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <button id="pc-back"    style="${_btnStyle('secondary')}">${_t('back')}</button>
        <input id="pc-proj-name" value="${_esc(p.name)}" style="flex:1;background:transparent;border:none;border-bottom:1px solid transparent;font-size:.97rem;font-weight:600;color:var(--text);padding:2px 0;outline:none;transition:border-color .15s" />
        <button id="pc-share"   style="${_btnStyle('secondary')}">${_t('share')}</button>
        <button id="pc-add-svc" style="${_btnStyle('primary')}">${_t('add_service')}</button>
      </div>

      <div style="display:flex;gap:18px;padding:9px 16px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;flex-wrap:wrap;align-items:flex-end">
        <label style="${_lblStyle()}">
          <span>${_t('hourly_rate')} <span style="color:var(--text-dim);font-size:.7rem">(${_t('global_hint')}: ${_gs.hourly_rate} ${_cur()})</span></span>
          <div style="display:flex;gap:5px;align-items:center">
            <input id="pc-ov-rate" type="number" min="0" step="0.01"
              value="${p.hourly_rate != null ? p.hourly_rate : ''}"
              placeholder="${_gs.hourly_rate}"
              style="${_iStyle('width:80px')}">
            <span style="font-size:.75rem;color:var(--text-dim)">${_cur()}/h</span>
          </div>
        </label>
        <label style="${_lblStyle()}">
          <span>${_t('deposit_pct')} <span style="color:var(--text-dim);font-size:.7rem">(${_t('global_hint')}: ${_gs.deposit_percent}%)</span></span>
          <input id="pc-ov-dep" type="number" min="0" max="100" step="1"
            value="${p.deposit_percent != null ? p.deposit_percent : ''}"
            placeholder="${_gs.deposit_percent}"
            style="${_iStyle('width:70px')}">
        </label>
        <label style="${_lblStyle()}">
          <span>${_t('discount_pct')}</span>
          <input id="pc-ov-disc" type="number" min="0" max="100" step="0.1"
            value="${p.discount_percent || ''}"
            placeholder="0"
            style="${_iStyle('width:70px')}">
        </label>
      </div>

      <div style="flex:1;overflow-y:auto;padding:0 16px 16px;display:flex;flex-direction:column;gap:14px">
        <div id="pc-svc-list" style="margin-top:12px"></div>
        <div id="pc-breakdown"></div>
      </div>
    `;

    const nameInput = w.querySelector('#pc-proj-name');
    nameInput.addEventListener('focus', () => nameInput.style.borderBottomColor = 'var(--accent)');
    nameInput.addEventListener('blur', async () => {
      nameInput.style.borderBottomColor = 'transparent';
      const v = nameInput.value.trim();
      if (v && v !== p.name) {
        await _api('PUT', `/projects/${p.id}`, { name: v });
        p.name = v;
      }
    });

    w.querySelector('#pc-back').onclick = async () => {
      _view = 'projects';
      await _loadProjects();
      _render();
    };

    w.querySelector('#pc-share').onclick = () => _showShareModal();
    w.querySelector('#pc-add-svc').onclick = _showAddModal;

    const _bindOv = (inputId, field, parse) => {
      const el = w.querySelector('#' + inputId);
      if (!el) return;
      el.addEventListener('change', async () => {
        const raw = el.value.trim();
        const val = raw === '' ? null : parse(raw);
        await _api('PUT', `/projects/${p.id}`, { [field]: val });
        p[field] = val;
        _refreshBreakdown();
        _refreshSvcCosts();
      });
    };
    _bindOv('pc-ov-rate',  'hourly_rate',      v => parseFloat(v) || 0);
    _bindOv('pc-ov-dep',   'deposit_percent',  v => parseFloat(v) || 0);
    _bindOv('pc-ov-disc',  'discount_percent', v => parseFloat(v) || 0);

    _renderSvcList(w.querySelector('#pc-svc-list'));
    _renderBreakdown(w.querySelector('#pc-breakdown'));
  }

  // ── Services list ─────────────────────────────────────────────────────────────

  const _toggleStyle = `background:none;border:none;cursor:pointer;font-size:.72rem;color:var(--accent);padding:0;text-align:left;`;

  function _svRowHtml(sv, rate) {
    const isFixed = sv.fixed_price != null;
    const cost    = isFixed ? sv.fixed_price : sv.hours * rate;
    const { h, m } = _splitH(sv.hours);
    const timeCell = isFixed
      ? `<div style="display:flex;flex-direction:column;gap:2px">
           <input class="pc-sv-fixed" type="number" min="0" step="0.01" value="${sv.fixed_price}"
             style="${_iStyle('width:100%;box-sizing:border-box')}">
           <button class="pc-sv-toggle" style="${_toggleStyle}">⏱ ${_t('by_time')}</button>
         </div>`
      : `<div style="display:flex;flex-direction:column;gap:2px">
           <div style="display:flex;align-items:center;gap:3px">
             <input class="pc-sv-h" type="number" min="0" step="1" value="${h}"
               style="${_iStyle('width:80px;text-align:center')}">
             <span style="font-size:.72rem;color:var(--text-dim)">h</span>
             <select class="pc-sv-m" style="${_iStyle('width:52px;padding-right:2px')}">
               ${_minsHtml(m)}
             </select>
             <span style="font-size:.72rem;color:var(--text-dim)">${_t('min_label')}</span>
           </div>
           <button class="pc-sv-toggle" style="${_toggleStyle}">💰 ${_t('fixed_price')}</button>
         </div>`;
    return `
      <div class="pc-sv" data-id="${sv.id}" data-mode="${isFixed ? 'fixed' : 'hours'}"
           style="display:grid;grid-template-columns:1fr 180px 82px 28px;gap:6px;align-items:start;margin-bottom:6px">
        <div style="display:flex;flex-direction:column;gap:3px">
          <input class="pc-sv-name" value="${_esc(sv.name)}" style="${_iStyle('')}">
          <input class="pc-sv-desc" value="${_esc(sv.description || '')}" placeholder="${_t('description_ph')}"
            style="${_iStyle('font-size:.76rem;color:var(--text-dim)')}">
        </div>
        ${timeCell}
        <div class="pc-sv-cost" style="font-size:.85rem;color:var(--text-dim);text-align:right;padding-right:2px;padding-top:8px">${_fmtAmt(cost)}</div>
        <button class="pc-sv-del" style="${_btnStyle('ghost')} width:24px;height:24px;padding:0;font-size:.78rem;display:flex;align-items:center;justify-content:center;margin-top:4px">✕</button>
      </div>`;
  }

  function _renderSvcList(el) {
    if (!el) return;
    if (_svcs.length === 0) {
      el.innerHTML = `<div style="color:var(--text-dim);font-size:.85rem;text-align:center;padding:24px">${_t('no_services')}</div>`;
      return;
    }
    const rate = _proj.hourly_rate != null ? _proj.hourly_rate : _gs.hourly_rate;
    const showCats = _svcs.some(sv => sv.category);
    let rows = '', lastCat;
    for (const sv of _svcs) {
      const cat = sv.category || '';
      if (showCats && cat !== lastCat) {
        lastCat = cat;
        rows += `<div class="pc-sv-cat" style="font-size:.7rem;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin:${rows ? '14px' : '0'} 0 6px;padding:0 2px">${_esc(cat || _t('uncategorized'))}</div>`;
      }
      rows += _svRowHtml(sv, rate);
    }
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 180px 82px 28px;gap:6px;align-items:center;margin-bottom:5px;padding:0 2px">
        <span style="font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${_t('service_col')}</span>
        <span style="font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${_t('time_col')}</span>
        <span style="font-size:.7rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;text-align:right">${_t('cost_col')}</span>
        <span></span>
      </div>
      ${rows}
    `;
    _bindSvcRows(el);
  }

  function _bindSvcRows(el) {
    el.querySelectorAll('.pc-sv').forEach(row => {
      const id   = parseInt(row.dataset.id);
      const sv   = _svcs.find(x => x.id === id);
      const name = row.querySelector('.pc-sv-name');
      const desc = row.querySelector('.pc-sv-desc');
      const cost = row.querySelector('.pc-sv-cost');
      const rate = _proj.hourly_rate != null ? _proj.hourly_rate : _gs.hourly_rate;

      name.addEventListener('blur', async () => {
        const v = name.value.trim();
        if (v && v !== sv.name) {
          await _api('PUT', `/projects/${_proj.id}/services/${id}`, { name: v });
          sv.name = v;
        }
      });
      desc.addEventListener('blur', async () => {
        const v = desc.value.trim();
        if (v !== (sv.description || '')) {
          await _api('PUT', `/projects/${_proj.id}/services/${id}`, { description: v });
          sv.description = v;
        }
      });

      const hEl = row.querySelector('.pc-sv-h');
      const mEl = row.querySelector('.pc-sv-m');
      if (hEl && mEl) {
        const _updateHours = async (save) => {
          const total = _joinH(hEl.value, mEl.value);
          cost.textContent = _fmtAmt(total * rate);
          if (save) {
            await _api('PUT', `/projects/${_proj.id}/services/${id}`, { hours: total });
            sv.hours = total;
            _refreshBreakdown();
          }
        };
        hEl.addEventListener('input',  () => _updateHours(false));
        hEl.addEventListener('change', () => _updateHours(true));
        mEl.addEventListener('change', () => _updateHours(true));
      }

      const fixedEl = row.querySelector('.pc-sv-fixed');
      if (fixedEl) {
        fixedEl.addEventListener('input', () => {
          cost.textContent = _fmtAmt(parseFloat(fixedEl.value) || 0);
        });
        fixedEl.addEventListener('change', async () => {
          const v = parseFloat(fixedEl.value) || 0;
          await _api('PUT', `/projects/${_proj.id}/services/${id}`, { fixed_price: v });
          sv.fixed_price = v;
          _refreshBreakdown();
        });
      }

      row.querySelector('.pc-sv-toggle').onclick = async () => {
        const goFixed = row.dataset.mode === 'hours';
        if (goFixed) {
          const curH    = _joinH(hEl?.value ?? sv.hours, mEl?.value ?? 0);
          const curCost = Math.round(curH * rate * 100) / 100;
          await _api('PUT', `/projects/${_proj.id}/services/${id}`, { fixed_price: curCost });
          sv.fixed_price = curCost;
        } else {
          await _api('PUT', `/projects/${_proj.id}/services/${id}`, { fixed_price: null });
          sv.fixed_price = null;
        }
        _svcs = await _api('GET', `/projects/${_proj.id}/services`);
        _renderSvcList(el);
        _refreshBreakdown();
      };

      row.querySelector('.pc-sv-del').onclick = async () => {
        if (!await mvmOS.confirm(`${_t('del_service')} "${sv.name}"?`)) return;
        await _api('DELETE', `/projects/${_proj.id}/services/${id}`);
        _svcs = _svcs.filter(x => x.id !== id);
        _renderSvcList(el);
        _refreshBreakdown();
      };
    });
  }

  function _refreshSvcCosts() {
    const rate = _proj.hourly_rate != null ? _proj.hourly_rate : _gs.hourly_rate;
    _wrap()?.querySelectorAll('.pc-sv').forEach(row => {
      const id = parseInt(row.dataset.id);
      const sv = _svcs.find(x => x.id === id);
      const c  = row.querySelector('.pc-sv-cost');
      if (!c || !sv) return;
      if (sv.fixed_price != null) {
        c.textContent = _fmtAmt(sv.fixed_price);
      } else {
        const total = _joinH(row.querySelector('.pc-sv-h')?.value ?? sv.hours, row.querySelector('.pc-sv-m')?.value ?? 0);
        c.textContent = _fmtAmt(total * rate);
      }
    });
  }

  function _refreshBreakdown() {
    _renderBreakdown(_wrap()?.querySelector('#pc-breakdown'));
  }

  // ── Breakdown ─────────────────────────────────────────────────────────────────

  function _renderBreakdown(el) {
    if (!el || !_proj) return;
    const c = _calcSummary(_proj, _svcs);
    el.innerHTML = `
      <div style="padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
        <div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:10px">${_t('summary')}</div>
        <div style="display:flex;flex-direction:column;gap:7px;font-size:.86rem">
          ${c.totalHours > 0 ? `
          <div style="${_row()}">
            <span style="color:var(--text-dim)">${_t('total_hours')}</span>
            <strong>${c.totalHours.toFixed(2)} h</strong>
          </div>
          <div style="${_row()}">
            <span style="color:var(--text-dim)">${_t('rate')}</span>
            <span>${c.rate.toFixed(2)} ${_cur()}/h</span>
          </div>` : ''}
          <div style="${_row()}">
            <span style="color:var(--text-dim)">${_t('subtotal')}</span>
            <span>${_fmtAmt(c.subtotal)}</span>
          </div>
          ${c.discountPct > 0 ? `
          <div style="${_row()}color:#f38ba8">
            <span>${_t('discount_row')} (${c.discountPct}%)</span>
            <span>−${_fmtAmt(c.discountAmt)}</span>
          </div>` : ''}
          <div style="${_row()}border-top:1px solid var(--border);padding-top:8px;font-weight:600;font-size:.92rem">
            <span>${_t('total')}</span>
            <span style="color:var(--accent)">${_fmtAmt(c.total)}</span>
          </div>
          ${c.depositPct > 0 ? `
          <div style="${_row()}color:#a6e3a1">
            <span>${_t('deposit_row')} (${c.depositPct}%)</span>
            <span>${_fmtAmt(c.depositAmt)}</span>
          </div>
          <div style="${_row()}color:var(--text-dim)">
            <span>${_t('remaining')}</span>
            <span style="color:var(--text)">${_fmtAmt(c.remainder)}</span>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Share modal ───────────────────────────────────────────────────────────────

  async function _showShareModal() {
    if (!_proj) return;

    // ensure token exists (server-generated)
    if (!_proj.public_token) {
      const sysLang = window.mvmOS?.lang || 'en';
      const r = await _api('POST', `/projects/${_proj.id}/share-token`, { lang: sysLang });
      _proj.public_token = r.public_token;
      _proj.public_lang  = r.public_lang;
    }

    const pubUrl    = `${location.origin}/pub/quotebuilder/${_proj.public_token}`;
    const showHours = _proj.show_hours !== 0;
    const showRate  = _proj.show_rate  !== 0;
    const pubLang   = _proj.public_lang || window.mvmOS?.lang || 'en';

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
          <input id="sh-url" readonly value="${_esc(pubUrl)}" style="${_iStyle('flex:1;cursor:text')}">
          <button id="sh-copy" style="${_btnStyle('secondary')}">${_t('share_copy')}</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:.85rem">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="sh-hours" ${showHours ? 'checked' : ''}>
          <span>${_t('share_show_hours')}</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="sh-rate" ${showRate ? 'checked' : ''}>
          <span>${_t('share_show_rate')}</span>
        </label>
        <label style="${_lblStyle()} margin-top:4px">
          <span style="color:var(--text-dim)">${_t('share_lang')}</span>
          <select id="sh-lang" style="${_iStyle('')}">
            <option value="en" ${pubLang === 'en' ? 'selected' : ''}>English</option>
            <option value="bg" ${pubLang === 'bg' ? 'selected' : ''}>Български</option>
          </select>
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button id="sh-close" style="${_btnStyle('secondary')}">${_t('close')}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // copy button
    box.querySelector('#sh-copy').onclick = async () => {
      await navigator.clipboard.writeText(pubUrl).catch(() => {});
      const btn = box.querySelector('#sh-copy');
      const orig = btn.textContent;
      btn.textContent = _t('share_copied');
      setTimeout(() => btn.textContent = orig, 1800);
    };

    // save all visibility settings on change
    const _saveVis = async () => {
      const sh   = box.querySelector('#sh-hours').checked ? 1 : 0;
      const sr   = box.querySelector('#sh-rate').checked  ? 1 : 0;
      const lang = box.querySelector('#sh-lang').value;
      await _api('PUT', `/projects/${_proj.id}`, { show_hours: sh, show_rate: sr, public_lang: lang });
      _proj.show_hours  = sh;
      _proj.show_rate   = sr;
      _proj.public_lang = lang;
    };
    box.querySelector('#sh-hours').addEventListener('change', _saveVis);
    box.querySelector('#sh-rate').addEventListener('change',  _saveVis);
    box.querySelector('#sh-lang').addEventListener('change',  _saveVis);

    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    box.querySelector('#sh-close').onclick = () => overlay.remove();
  }

  // ── Add service modal ─────────────────────────────────────────────────────────

  function _tplItemHtml(bs) {
    const isFixed = bs.fixed_price != null;
    const timeTag = isFixed
      ? `<span style="color:var(--text-dim)">${_fmtAmt(bs.fixed_price)} <span style="font-size:.7rem">${_t('fixed_label')}</span></span>`
      : `<span style="color:var(--text-dim)">${bs.hours} h</span>`;
    return `<div class="pc-tpl"
      data-name="${_esc(bs.name)}"
      data-hours="${bs.hours}"
      data-desc="${_esc(bs.description || '')}"
      data-fixed="${bs.fixed_price != null ? bs.fixed_price : ''}"
      data-cat="${_esc(bs.category || '')}"
      data-sort="${bs.sort_order || 0}"
      style="padding:8px 12px;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:.85rem;transition:border-color .12s">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>${_esc(bs.name)}</span>
        ${timeTag}
      </div>
      ${bs.description ? `<div style="font-size:.76rem;color:var(--text-dim);margin-top:2px">${_esc(bs.description)}</div>` : ''}
    </div>`;
  }

  async function _showAddModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:10000;display:flex;align-items:center;justify-content:center';

    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:20px;width:360px;max-height:82vh;overflow-y:auto;display:flex;flex-direction:column;gap:10px';

    const cats = _categories.map(c => c.name).filter(name => _baseServices.some(bs => bs.category === name));
    const hasUncat = _baseServices.some(bs => !bs.category || !cats.includes(bs.category));
    const chipCats = hasUncat ? [...cats, ''] : cats;
    let _selCat = chipCats.length > 0 ? chipCats[0] : null;
    let _pickedCat = '', _pickedSort = 0;

    function chipsHtml() {
      if (cats.length === 0) return '';
      return `<div id="pc-tpl-cats" style="display:flex;gap:5px;flex-wrap:wrap">
        ${chipCats.map(c => {
          const sel = c === _selCat;
          const base = 'border-radius:20px;padding:3px 11px;font-size:.76rem;cursor:pointer;white-space:nowrap;border:1px solid;font-family:inherit;';
          const style = sel
            ? base + 'background:var(--accent);color:#1e1e2e;border-color:var(--accent);font-weight:600'
            : base + 'background:transparent;color:var(--text-dim);border-color:var(--border)';
          return `<button class="pc-tpl-cat" data-cat="${_esc(c)}" style="${style}">${_esc(c || _t('uncategorized'))}</button>`;
        }).join('')}
      </div>`;
    }

    function tplListHtml() {
      if (_baseServices.length === 0) return '';
      const visible = cats.length > 0
        ? _baseServices.filter(bs => (bs.category || '') === (_selCat || ''))
        : _baseServices;
      return `
        <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em">${_t('from_templates')}</div>
        ${chipsHtml()}
        <div id="pc-tpl-items" style="display:flex;flex-direction:column;gap:5px">
          ${visible.map(_tplItemHtml).join('')}
        </div>
        <div style="font-size:.72rem;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-top:4px">${_t('custom')}</div>
      `;
    }

    box.innerHTML = `
      <div style="font-weight:600;font-size:.95rem">${_t('add_service_title')}</div>
      <div id="pc-tpl-block">${tplListHtml()}</div>
      <input id="pc-new-name" placeholder="${_t('service_name_ph')}" style="${_iStyle('width:100%;box-sizing:border-box')}">
      <input id="pc-new-desc" placeholder="${_t('description_ph')}" style="${_iStyle('width:100%;box-sizing:border-box;font-size:.82rem')}">
      <div id="pc-new-cat-wrap">${_catSelectHtml('', _pickedCat)}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <div id="pc-new-time-mode" style="display:flex;align-items:center;gap:3px">
          <input id="pc-new-h" type="number" min="0" step="1" value="1" style="${_iStyle('width:80px;text-align:center')}">
          <span style="font-size:.82rem;color:var(--text-dim)">h</span>
          <select id="pc-new-m" style="${_iStyle('width:58px;padding-right:2px')}">
            ${_minsHtml(0)}
          </select>
          <span style="font-size:.82rem;color:var(--text-dim)">${_t('min_label')}</span>
        </div>
        <div id="pc-new-fixed-mode" style="display:none;align-items:center;gap:5px">
          <input id="pc-new-fixed" type="number" min="0" step="0.01" placeholder="0.00" style="${_iStyle('width:100px')}">
          <span style="font-size:.82rem;color:var(--text-dim)">${_cur()}</span>
        </div>
        <button id="pc-new-toggle" style="${_toggleStyle} margin-left:4px;font-size:.78rem">💰 ${_t('fixed_price')}</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
        <button id="pc-modal-cancel" style="${_btnStyle('secondary')}">${_t('cancel')}</button>
        <button id="pc-modal-add"    style="${_btnStyle('primary')}">${_t('add')}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const nameEl   = box.querySelector('#pc-new-name');
    const descEl   = box.querySelector('#pc-new-desc');
    const catEl    = box.querySelector('#pc-new-cat-wrap select');
    const hEl      = box.querySelector('#pc-new-h');
    const mEl      = box.querySelector('#pc-new-m');
    const fixedEl  = box.querySelector('#pc-new-fixed');
    const timeDiv  = box.querySelector('#pc-new-time-mode');
    const fixedDiv = box.querySelector('#pc-new-fixed-mode');
    const togBtn   = box.querySelector('#pc-new-toggle');
    let   _fixedMode = false;

    // Manually picking a category (rather than clicking a template) appends
    // the custom service after the automatic ones already in that category.
    catEl.addEventListener('change', () => {
      _pickedCat  = catEl.value;
      _pickedSort = 999999;
    });

    togBtn.onclick = () => {
      _fixedMode = !_fixedMode;
      timeDiv.style.display  = _fixedMode ? 'none'  : 'flex';
      fixedDiv.style.display = _fixedMode ? 'flex'  : 'none';
      togBtn.textContent     = _fixedMode ? `⏱ ${_t('by_time')}` : `💰 ${_t('fixed_price')}`;
    };

    function bindTplItems() {
      box.querySelectorAll('.pc-tpl').forEach(t => {
        t.addEventListener('mouseenter', () => t.style.borderColor = 'var(--accent)');
        t.addEventListener('mouseleave', () => t.style.borderColor = 'var(--border)');
        t.onclick = () => {
          nameEl.value = t.dataset.name;
          descEl.value = t.dataset.desc || '';
          _pickedCat  = t.dataset.cat || '';
          _pickedSort = parseInt(t.dataset.sort) || 0;
          catEl.value = _pickedCat;
          const tFixed = t.dataset.fixed !== '' ? parseFloat(t.dataset.fixed) : null;
          if (tFixed != null) {
            if (!_fixedMode) togBtn.onclick();
            fixedEl.value = tFixed;
          } else {
            if (_fixedMode) togBtn.onclick();
            const { h, m } = _splitH(parseFloat(t.dataset.hours) || 0);
            hEl.value = h;
            Array.from(mEl.options).forEach(o => o.selected = parseInt(o.value) === m);
          }
          nameEl.focus();
        };
      });
    }

    function bindCatChips() {
      box.querySelectorAll('.pc-tpl-cat').forEach(ch => {
        ch.onclick = () => {
          _selCat = ch.dataset.cat;
          box.querySelector('#pc-tpl-block').innerHTML = tplListHtml();
          bindTplItems();
          bindCatChips();
        };
      });
    }

    bindTplItems();
    bindCatChips();

    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    box.querySelector('#pc-modal-cancel').onclick = () => overlay.remove();
    box.querySelector('#pc-modal-add').onclick = async () => {
      const name = nameEl.value.trim();
      const desc = descEl.value.trim() || '';
      if (!name) { nameEl.style.borderColor = 'var(--error, #f38ba8)'; nameEl.focus(); return; }
      if (_fixedMode) {
        const fp = parseFloat(fixedEl.value) || 0;
        await _api('POST', `/projects/${_proj.id}/services`, { name, description: desc, hours: 0, fixed_price: fp, category: _pickedCat, sort_order: _pickedSort });
      } else {
        const hrs = _joinH(hEl.value, mEl.value);
        await _api('POST', `/projects/${_proj.id}/services`, { name, description: desc, hours: hrs, category: _pickedCat, sort_order: _pickedSort });
      }
      _svcs = await _api('GET', `/projects/${_proj.id}/services`);
      overlay.remove();
      _renderSvcList(_wrap()?.querySelector('#pc-svc-list'));
      _refreshBreakdown();
    };

    nameEl.focus();
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // VIEW: GLOBAL SETTINGS
  // ══════════════════════════════════════════════════════════════════════════════

  function _renderSettings(w) {
    w.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0">
        <button id="pc-gs-back" style="${_btnStyle('secondary')}">${_t('back')}</button>
        <span style="font-weight:600;font-size:.95rem">${_t('global_settings')}</span>
      </div>
      <div style="flex:1;overflow-y:auto;padding:18px 16px">
        <div style="display:flex;flex-direction:column;gap:13px;max-width:380px">
          <label style="${_lblStyle()}">
            <span style="color:var(--text-dim)">${_t('default_rate')}</span>
            <input id="gs-rate" type="number" min="0" step="0.01" value="${_gs.hourly_rate ?? 50}" style="${_iStyle('')}">
          </label>
          <label style="${_lblStyle()}">
            <span style="color:var(--text-dim)">${_t('currency_hint')}</span>
            <select id="gs-cur" style="${_iStyle('')}">
              <option value="">${_t('system_default')}</option>
              ${_qbCurrencies.map(c => `<option value="${c.value}" ${_gs.currency === c.value ? 'selected' : ''}>${c.symbol} ${c.value}</option>`).join('')}
            </select>
          </label>
          <label style="${_lblStyle()}">
            <span style="color:var(--text-dim)">${_t('default_deposit')}</span>
            <input id="gs-dep" type="number" min="0" max="100" step="1" value="${_gs.deposit_percent ?? 30}" style="${_iStyle('')}">
          </label>
          <button id="gs-save" style="${_btnStyle('primary')} align-self:flex-start">${_t('save_settings')}</button>
        </div>

        <div style="margin-top:26px;border-top:1px solid var(--border);padding-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div style="font-weight:600;font-size:.9rem">${_t('categories')}</div>
            <button id="gs-add-cat" style="${_btnStyle('primary')} font-size:.78rem;padding:4px 10px">${_t('add_category')}</button>
          </div>
          <div id="gs-cat-list"></div>
        </div>

        <div style="margin-top:26px;border-top:1px solid var(--border);padding-top:20px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div style="font-weight:600;font-size:.9rem">${_t('service_templates')}</div>
            <button id="gs-add-tpl" style="${_btnStyle('primary')} font-size:.78rem;padding:4px 10px">${_t('add_template')}</button>
          </div>
          <div id="gs-tpl-list"></div>
        </div>
      </div>
    `;

    w.querySelector('#pc-gs-back').onclick = () => { _view = 'projects'; _render(); };

    w.querySelector('#gs-save').onclick = async () => {
      const hourly_rate     = parseFloat(w.querySelector('#gs-rate').value) || 50;
      const currency        = w.querySelector('#gs-cur').value || null;
      const deposit_percent = parseFloat(w.querySelector('#gs-dep').value) || 0;
      await _api('PUT', '/settings', { hourly_rate, currency, deposit_percent });
      _gs = { hourly_rate, currency, deposit_percent };
      mvmOS.notify('QuoteBuilder', _t('settings_saved'));
    };

    w.querySelector('#gs-add-cat').onclick = async () => {
      const name = await mvmOS.prompt(_t('category_name_ph'), '');
      if (!name?.trim()) return;
      await _api('POST', '/categories', { name: name.trim() });
      await _loadCategories();
      _renderCatList(w.querySelector('#gs-cat-list'));
    };

    w.querySelector('#gs-add-tpl').onclick = () => _showAddTplModal(w.querySelector('#gs-tpl-list'));

    _renderCatList(w.querySelector('#gs-cat-list'));
    _renderTplList(w.querySelector('#gs-tpl-list'));
  }

  function _renderCatList(el) {
    if (!el) return;
    if (_categories.length === 0) {
      el.innerHTML = `<div style="color:var(--text-dim);font-size:.83rem">${_t('no_categories')}</div>`;
      return;
    }
    el.innerHTML = `<div style="display:flex;flex-direction:column;gap:5px">${
      _categories.map((c, i) => `
        <div class="gs-cat-row" data-id="${c.id}" style="display:flex;align-items:center;gap:4px;border:1px solid var(--border);border-radius:6px;padding:5px 6px 5px 12px;font-size:.83rem;color:var(--text)">
          <span style="flex:1">${_esc(c.name)}</span>
          <button class="gs-cat-up"   style="${_btnStyle('ghost')} font-size:.7rem;padding:1px 6px;border:none;${i === 0 ? 'opacity:.3;cursor:default' : ''}" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="gs-cat-down" style="${_btnStyle('ghost')} font-size:.7rem;padding:1px 6px;border:none;${i === _categories.length - 1 ? 'opacity:.3;cursor:default' : ''}" ${i === _categories.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="gs-cat-del"  style="${_btnStyle('ghost')} font-size:.7rem;padding:1px 6px;border:none">✕</button>
        </div>`).join('')
    }</div>`;

    const _moveCat = async (id, dir) => {
      const idx = _categories.findIndex(x => x.id === id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= _categories.length) return;
      [_categories[idx], _categories[swapIdx]] = [_categories[swapIdx], _categories[idx]];
      await _api('POST', '/categories/reorder', { order: _categories.map(c => c.id) });
      _renderCatList(el);
    };

    el.querySelectorAll('.gs-cat-row').forEach(row => {
      const id = parseInt(row.dataset.id);
      row.querySelector('.gs-cat-up').onclick   = () => _moveCat(id, -1);
      row.querySelector('.gs-cat-down').onclick = () => _moveCat(id, 1);
      row.querySelector('.gs-cat-del').onclick = async () => {
        const c = _categories.find(x => x.id === id);
        if (!await mvmOS.confirm(`${_t('del_category')} "${c.name}"?`)) return;
        await _api('DELETE', `/categories/${id}`);
        await _loadCategories();
        _renderCatList(el);
      };
    });
  }

  function _tplTimeHtml(bs) {
    if (bs.fixed_price != null) {
      return `<div style="display:flex;align-items:center;gap:4px">
        <input class="gs-tpl-fixed" type="number" min="0" step="0.01" value="${bs.fixed_price}" style="width:80px;${_iStyle('')}">
        <span style="font-size:.75rem;color:var(--text-dim)">${_cur()}</span>
        <button class="gs-tpl-toggle" style="${_toggleStyle} font-size:.72rem">⏱</button>
      </div>`;
    }
    const { h, m } = _splitH(bs.hours);
    return `<div style="display:flex;align-items:center;gap:3px">
      <input class="gs-tpl-h" type="number" min="0" step="1" value="${h}" style="width:80px;${_iStyle('text-align:center')}">
      <span style="font-size:.75rem;color:var(--text-dim)">h</span>
      <select class="gs-tpl-m" style="width:50px;${_iStyle('padding-right:2px')}">${_minsHtml(m)}</select>
      <button class="gs-tpl-toggle" style="${_toggleStyle} font-size:.72rem">💰</button>
    </div>`;
  }

  function _catSelectHtml(cls, selected) {
    return `<select class="${cls}" style="${_iStyle('width:100%;font-size:.78rem;color:var(--text-dim)')}">
      <option value="">${_t('no_category_opt')}</option>
      ${_categories.map(c => `<option value="${_esc(c.name)}" ${c.name === selected ? 'selected' : ''}>${_esc(c.name)}</option>`).join('')}
    </select>`;
  }

  function _tplRowHtml(bs, idx, len) {
    return `
      <div class="gs-tpl-row" data-id="${bs.id}" style="padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <input class="gs-tpl-name" value="${_esc(bs.name)}" style="flex:1;background:transparent;border:none;color:var(--text);font-size:.85rem;outline:none">
          ${_tplTimeHtml(bs)}
          <button class="gs-tpl-up"   style="${_btnStyle('ghost')} font-size:.7rem;padding:1px 6px;${idx === 0 ? 'opacity:.3;cursor:default' : ''}" ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="gs-tpl-down" style="${_btnStyle('ghost')} font-size:.7rem;padding:1px 6px;${idx === len - 1 ? 'opacity:.3;cursor:default' : ''}" ${idx === len - 1 ? 'disabled' : ''}>↓</button>
          <button class="gs-tpl-del" style="${_btnStyle('ghost')} font-size:.73rem;padding:2px 7px">✕</button>
        </div>
        <input class="gs-tpl-desc" value="${_esc(bs.description || '')}" placeholder="${_t('description_ph')}"
          style="margin-top:5px;width:100%;background:transparent;border:none;border-top:1px solid var(--border);padding-top:5px;color:var(--text-dim);font-size:.78rem;outline:none;font-family:inherit">
        <div style="margin-top:5px;border-top:1px solid var(--border);padding-top:5px">
          ${_catSelectHtml('gs-tpl-cat', bs.category || '')}
        </div>
      </div>`;
  }

  function _tplFilterOptions() {
    const cats = _categories.map(c => c.name);
    const hasUncat = _baseServices.some(bs => !bs.category || !cats.includes(bs.category));
    return hasUncat ? [...cats, ''] : cats;
  }

  function _renderTplList(el) {
    if (!el) return;
    if (_baseServices.length === 0) {
      el.innerHTML = `<div style="color:var(--text-dim);font-size:.83rem">${_t('no_templates')}</div>`;
      return;
    }

    const opts = _tplFilterOptions();
    if (_tplFilterCat === null || !opts.includes(_tplFilterCat)) _tplFilterCat = opts[0] ?? '';

    const filterHtml = opts.length > 1
      ? `<select id="gs-tpl-cat-filter" style="${_iStyle('margin-bottom:10px;width:100%')}">
          ${opts.map(c => `<option value="${_esc(c)}" ${c === _tplFilterCat ? 'selected' : ''}>${_esc(c || _t('uncategorized'))}</option>`).join('')}
        </select>`
      : '';

    const items = _baseServices.filter(bs => (bs.category || '') === _tplFilterCat);

    el.innerHTML = filterHtml + (items.length === 0
      ? `<div style="color:var(--text-dim);font-size:.83rem;padding:6px 0">${_t('no_templates')}</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">${items.map((bs, i) => _tplRowHtml(bs, i, items.length)).join('')}</div>`);

    el.querySelector('#gs-tpl-cat-filter')?.addEventListener('change', e => {
      _tplFilterCat = e.target.value;
      _renderTplList(el);
    });

    _bindTplRows(el, items);
  }

  function _bindTplRows(el, items) {
    const _moveTpl = async (id, dir) => {
      const idx = items.findIndex(x => x.id === id);
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= items.length) return;
      [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
      await _api('POST', '/templates/reorder', { order: items.map(x => x.id) });
      await _loadBaseServices();
      _renderTplList(el);
    };

    el.querySelectorAll('.gs-tpl-row').forEach(row => {
      const id   = parseInt(row.dataset.id);
      const bs   = _baseServices.find(x => x.id === id);
      const name = row.querySelector('.gs-tpl-name');
      const desc = row.querySelector('.gs-tpl-desc');
      const cat  = row.querySelector('.gs-tpl-cat');

      name.addEventListener('blur', async () => {
        const v = name.value.trim();
        if (v && v !== bs.name) {
          await _api('PUT', `/templates/${id}`, { name: v });
          bs.name = v;
        }
      });
      desc.addEventListener('blur', async () => {
        const v = desc.value.trim();
        if (v !== (bs.description || '')) {
          await _api('PUT', `/templates/${id}`, { description: v });
          bs.description = v;
        }
      });
      cat.addEventListener('change', async () => {
        const v = cat.value;
        if (v !== (bs.category || '')) {
          await _api('PUT', `/templates/${id}`, { category: v });
          bs.category = v;
          _renderTplList(el);
        }
      });

      row.querySelector('.gs-tpl-up').onclick   = () => _moveTpl(id, -1);
      row.querySelector('.gs-tpl-down').onclick = () => _moveTpl(id, 1);

      const hEl    = row.querySelector('.gs-tpl-h');
      const mEl    = row.querySelector('.gs-tpl-m');
      const fixedEl = row.querySelector('.gs-tpl-fixed');

      if (hEl && mEl) {
        const _save = async () => {
          const total = _joinH(hEl.value, mEl.value);
          await _api('PUT', `/templates/${id}`, { hours: total });
          bs.hours = total;
        };
        hEl.addEventListener('change', _save);
        mEl.addEventListener('change', _save);
      }
      if (fixedEl) {
        fixedEl.addEventListener('change', async () => {
          const v = parseFloat(fixedEl.value) || 0;
          await _api('PUT', `/templates/${id}`, { fixed_price: v });
          bs.fixed_price = v;
        });
      }

      row.querySelector('.gs-tpl-toggle').onclick = async () => {
        if (bs.fixed_price != null) {
          await _api('PUT', `/templates/${id}`, { fixed_price: null });
        } else {
          const curRate = _gs.hourly_rate || 50;
          const fp      = Math.round(bs.hours * curRate * 100) / 100;
          await _api('PUT', `/templates/${id}`, { fixed_price: fp });
        }
        await _loadBaseServices();
        _renderTplList(el);
      };

      row.querySelector('.gs-tpl-del').onclick = async () => {
        if (!await mvmOS.confirm(`${_t('del_template')} "${bs.name}"?`)) return;
        await _api('DELETE', `/templates/${id}`);
        await _loadBaseServices();
        _renderTplList(el);
      };
    });
  }

  async function _showAddTplModal(listEl) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:10000;display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:18px;width:320px;display:flex;flex-direction:column;gap:10px';
    box.innerHTML = `
      <div style="font-weight:600;font-size:.93rem">${_t('add_template')}</div>
      <input id="tpl-name" placeholder="${_t('template_name')}" style="${_iStyle('width:100%;box-sizing:border-box')}">
      <input id="tpl-desc" placeholder="${_t('description_ph')}" style="${_iStyle('width:100%;box-sizing:border-box;font-size:.82rem')}">
      <div id="tpl-cat-wrap">${_catSelectHtml('', _tplFilterCat || '')}</div>
      <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">
        <div id="tpl-time-mode" style="display:flex;align-items:center;gap:3px">
          <input id="tpl-h" type="number" min="0" step="1" value="1" style="${_iStyle('width:80px;text-align:center')}">
          <span style="font-size:.82rem;color:var(--text-dim)">h</span>
          <select id="tpl-m" style="${_iStyle('width:58px;padding-right:2px')}">${_minsHtml(0)}</select>
          <span style="font-size:.82rem;color:var(--text-dim)">${_t('min_label')}</span>
        </div>
        <div id="tpl-fixed-mode" style="display:none;align-items:center;gap:5px">
          <input id="tpl-fixed" type="number" min="0" step="0.01" placeholder="0.00" style="${_iStyle('width:90px')}">
          <span style="font-size:.82rem;color:var(--text-dim)">${_cur()}</span>
        </div>
        <button id="tpl-toggle" style="${_toggleStyle} font-size:.78rem">💰 ${_t('fixed_price')}</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="tpl-cancel" style="${_btnStyle('secondary')}">${_t('cancel')}</button>
        <button id="tpl-add"    style="${_btnStyle('primary')}">${_t('add')}</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const nameEl   = box.querySelector('#tpl-name');
    const timeDiv  = box.querySelector('#tpl-time-mode');
    const fixedDiv = box.querySelector('#tpl-fixed-mode');
    const togBtn   = box.querySelector('#tpl-toggle');
    let   _fixedMode = false;

    togBtn.onclick = () => {
      _fixedMode = !_fixedMode;
      timeDiv.style.display  = _fixedMode ? 'none' : 'flex';
      fixedDiv.style.display = _fixedMode ? 'flex' : 'none';
      togBtn.textContent     = _fixedMode ? `⏱ ${_t('by_time')}` : `💰 ${_t('fixed_price')}`;
    };

    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    box.querySelector('#tpl-cancel').onclick = () => overlay.remove();
    box.querySelector('#tpl-add').onclick = async () => {
      const name = nameEl.value.trim();
      const desc = box.querySelector('#tpl-desc').value.trim();
      const cat  = box.querySelector('#tpl-cat-wrap select').value;
      if (!name) { nameEl.style.borderColor = 'var(--error, #f38ba8)'; nameEl.focus(); return; }
      if (_fixedMode) {
        const fp = parseFloat(box.querySelector('#tpl-fixed').value) || 0;
        await _api('POST', '/templates', { name, description: desc, hours: 0, fixed_price: fp, category: cat });
      } else {
        const hrs = _joinH(box.querySelector('#tpl-h').value, box.querySelector('#tpl-m').value);
        await _api('POST', '/templates', { name, description: desc, hours: hrs, category: cat });
      }
      await _loadBaseServices();
      overlay.remove();
      _renderTplList(listEl);
    };
    nameEl.focus();
  }

  return { mount };
})();
