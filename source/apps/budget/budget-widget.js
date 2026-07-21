// Budget — shared widget used by the desktop app window, the standalone
// Apps Hub public page, and the Telegram mini-app (same three-surface
// pattern as apps/calendar/calendar-widget.js / apps/chat/chat-widget.js).
(function () {
  if (window.BudgetWidget) return;

  const API = '/pub/budget';

  const _i18n = {
    en: {
      title: 'Budget', add_category: '+ Category', mass_add: 'Mass add',
      login_needed: 'Log in to Apps Hub to use Budget',
      no_categories: 'No categories yet. Create your first one.',
      cat_title: 'Title', description: 'Description', allocation: 'Allocation',
      percent: 'Percent of total', fixed: 'Fixed amount', goal: 'Goal (optional)',
      save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', share: 'Share',
      history: 'History', close: 'Close', owner: 'owner', members: 'members',
      confirm_delete_category: 'Delete this category and all its transactions? This cannot be undone.',
      confirm_delete_tx: 'Delete this transaction?',
      title_required: 'Title is required', invalid_allocation: 'Enter a valid allocation value',
      save_failed: 'Could not save. Please try again.',
      amount: 'Amount', note: 'Note (optional)',
      no_transactions: 'No transactions yet.',
      mass_add_title: 'Mass add', total_amount: 'Total amount', mass_add_hint: 'Adjust any category before saving.',
      mass_add_save: 'Save transactions', mass_add_failed: 'Could not save. Please try again.',
      share_title: 'Share category', current_members: 'Current members', add_from_favourites: 'Add from favourites',
      no_favourites: 'No favourites yet. Add someone as a favourite first.',
      already_member: 'Already a member', leave: 'Leave', remove: 'Remove',
      confirm_leave: 'Leave this shared category?', confirm_remove_member: 'Remove this member?',
      new_category: 'New category', edit_category: 'Edit category',
      currency: 'Currency', change_currency: 'Change currency', system_default: 'System default',
      currency_mismatch_error: "Can't share — that person uses a different currency.",
      added_by: 'Added by', removed_by: 'Removed by', leave_category: 'Leave category',
      settings: 'Settings', default_sign: 'Default sign for new amounts', deposit: 'Deposit (+)', withdrawal: 'Withdrawal (-)',
      sources_section: 'Entries from other apps',
      sources_hint: 'Off by default per app — hides that app\'s entries from history lists so manual entries stay easy to scroll through. They always count toward balances and stats either way.',
      total_balance: 'Total balance (all categories, incl. subcategories)',
      subcategories: 'Subcategories', add_subcategory: '+ Subcategory', no_subcategories: 'No subcategories yet.',
      new_subcategory: 'New subcategory', confirm_delete_subcategory: 'Delete this subcategory and all its transactions? This cannot be undone.',
      manage_subcategories: 'Subcategories',
      parent_has_own_tx: "Can't add subcategories — this category already has its own transactions.",
      is_parent_category: 'Main category (holds subcategories, no amounts of its own)',
      parent_locked_hint: 'This category has subcategories — delete them first to change this.',
      menu: 'Menu', categories: 'Categories', full_history: 'History', back: 'Back',
      no_history: 'No transactions yet.',
      stats: 'Statistics', stats_period_week: 'Weekly', stats_period_month: 'Monthly', stats_period_year: 'Yearly',
      stats_income: 'Income', stats_expense: 'Expense', stats_net: 'Net', no_stats: 'No data for this period yet.',
      stats_by_category: 'By category',
    },
    bg: {
      title: 'Бюджет', add_category: '+ Категория', mass_add: 'Разпредели сума',
      login_needed: 'Влез в Apps Hub, за да ползваш бюджета',
      no_categories: 'Все още няма категории. Създай първата.',
      cat_title: 'Заглавие', description: 'Описание', allocation: 'Разпределение',
      percent: 'Процент от сумата', fixed: 'Фиксирана сума', goal: 'Цел (по избор)',
      save: 'Запази', cancel: 'Отказ', delete: 'Изтрий', edit: 'Редакция', share: 'Сподели',
      history: 'История', close: 'Затвори', owner: 'собственик', members: 'участници',
      confirm_delete_category: 'Да се изтрие ли категорията заедно с всички транзакции? Не може да се отмени.',
      confirm_delete_tx: 'Да се изтрие ли транзакцията?',
      title_required: 'Заглавието е задължително', invalid_allocation: 'Въведи валидна стойност за разпределение',
      save_failed: 'Неуспешен запис. Опитай отново.',
      amount: 'Сума', note: 'Бележка (по избор)',
      no_transactions: 'Все още няма транзакции.',
      mass_add_title: 'Разпредели сума', total_amount: 'Обща сума', mass_add_hint: 'Можеш да коригираш всяка категория преди запис.',
      mass_add_save: 'Запази транзакциите', mass_add_failed: 'Неуспешен запис. Опитай отново.',
      share_title: 'Сподели категория', current_members: 'Текущи участници', add_from_favourites: 'Добави от любими',
      no_favourites: 'Все още няма любими. Добави някого в любими първо.',
      already_member: 'Вече е участник', leave: 'Напусни', remove: 'Премахни',
      confirm_leave: 'Да се напусне ли споделената категория?', confirm_remove_member: 'Да се премахне ли този участник?',
      new_category: 'Нова категория', edit_category: 'Редакция на категория',
      currency: 'Валута', change_currency: 'Смени валута', system_default: 'Системна по подразбиране',
      currency_mismatch_error: 'Не може да споделиш — човекът ползва друга валута.',
      added_by: 'Добавено от', removed_by: 'Премахнато от', leave_category: 'Напусни категорията',
      settings: 'Настройки', default_sign: 'Знак по подразбиране за нови суми', deposit: 'Внасяне (+)', withdrawal: 'Теглене (-)',
      sources_section: 'Записи от други приложения',
      sources_hint: 'По подразбиране е изключено за всяко приложение — скрива неговите записи от хронологията, за да е лесно да се преглеждат ръчно добавените. Те винаги се броят в баланса и справките, независимо от настройката.',
      total_balance: 'Общ баланс (всички категории, вкл. подкатегории)',
      subcategories: 'Подкатегории', add_subcategory: '+ Подкатегория', no_subcategories: 'Все още няма подкатегории.',
      new_subcategory: 'Нова подкатегория', confirm_delete_subcategory: 'Да се изтрие ли подкатегорията заедно с всички транзакции? Не може да се отмени.',
      manage_subcategories: 'Подкатегории',
      parent_has_own_tx: 'Не може да добавиш подкатегории — тази категория вече има собствени транзакции.',
      is_parent_category: 'Главна категория (съдържа подкатегории, без собствени суми)',
      parent_locked_hint: 'Тази категория има подкатегории — първо ги изтрий, за да смениш това.',
      menu: 'Меню', categories: 'Категории', full_history: 'История', back: 'Назад',
      no_history: 'Все още няма транзакции.',
      stats: 'Статистики', stats_period_week: 'Седмично', stats_period_month: 'Месечно', stats_period_year: 'Годишно',
      stats_income: 'Приходи', stats_expense: 'Разходи', stats_net: 'Нето', no_stats: 'Все още няма данни за този период.',
      stats_by_category: 'По категории',
    },
  };
  function t(key) {
    const lang = window.mvmOS?.lang || 'en';
    return (_i18n[lang] || _i18n.en)[key] || key;
  }
  // Fixed list — symbol-only display, never real FX conversion. Kept in
  // sync manually with frontend/settings.js and backend/apps/budget/public.py's
  // own copies, since public/Telegram surfaces never load core desktop JS.
  const CURRENCIES = [
    { value: 'EUR', symbol: '€' }, { value: 'USD', symbol: '$' },
    { value: 'GBP', symbol: '£' },
    { value: 'CHF', symbol: 'CHF' }, { value: 'JPY', symbol: '¥' },
    { value: 'CNY', symbol: '¥' }, { value: 'TRY', symbol: '₺' },
    { value: 'UAH', symbol: '₴' }, { value: 'PLN', symbol: 'zł' },
    { value: 'RON', symbol: 'lei' }, { value: 'CZK', symbol: 'Kč' },
    { value: 'HUF', symbol: 'Ft' }, { value: 'CAD', symbol: '$' },
    { value: 'AUD', symbol: '$' }, { value: 'SEK', symbol: 'kr' },
    { value: 'NOK', symbol: 'kr' }, { value: 'DKK', symbol: 'kr' },
    { value: 'RUB', symbol: '₽' }, { value: 'INR', symbol: '₹' },
  ];
  let _currencySymbol = '€';
  function currencySymbol(code) {
    return (CURRENCIES.find(c => c.value === code) || {}).symbol || code || '€';
  }
  function fmtMoney(n) {
    return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2) + ' ' + _currencySymbol;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function contribution(cat, total) {
    return cat.alloc_type === 'percent' ? (total * cat.alloc_value / 100) : cat.alloc_value;
  }

  let _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .bw-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);
        font-family:system-ui,sans-serif;font-size:.85rem;overflow:hidden}
      .bw-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2, #a6adc8);
        font-family:system-ui,sans-serif;font-size:.9rem;text-align:center;padding:20px}
      .bw-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0}
      .bw-toolbar h2{margin:0;font-size:1rem;flex:1}
      .bw-btn{background:var(--pub-surface2, #313244);color:var(--pub-fg, #cdd6f4);border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.82rem}
      .bw-btn:hover{background:var(--pub-border, #45475a)}
      .bw-btn-primary{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .bw-btn-primary:hover{background:var(--pub-accent-hover, #a6c8ff)}
      .bw-btn-danger{background:var(--pub-red, #f38ba8);color:var(--pub-bg, #1e1e2e)}
      .bw-btn-icon{background:none;border:none;color:var(--pub-fg2, #a6adc8);cursor:pointer;font-size:.9rem;padding:4px 6px;border-radius:4px}
      .bw-btn-icon:hover{background:var(--pub-border, #45475a);color:var(--pub-fg, #cdd6f4)}
      .bw-body{flex:1;overflow-y:auto;padding:14px}
      .bw-empty{color:var(--pub-dim, #6c7086);text-align:center;padding:40px 16px}
      .bw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
      .bw-card{background:var(--pub-surface2, #313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}
      .bw-card-head{display:flex;flex-direction:column;gap:4px}
      .bw-card-title{font-weight:700;font-size:.95rem;word-break:break-word}
      .bw-card-actions{display:flex;gap:2px}
      .bw-btn-icon.bw-btn-owner{background:rgba(166,227,161,.22)}
      .bw-btn-icon.bw-btn-owner:hover{background:rgba(166,227,161,.35)}
      .bw-card-desc{color:var(--pub-fg2, #a6adc8);font-size:.78rem;word-break:break-word}
      .bw-card-balance{font-size:1.2rem;font-weight:700;cursor:pointer}
      .bw-card-balance:hover{color:var(--pub-accent, #89b4fa)}
      .bw-progress{height:6px;border-radius:3px;background:var(--pub-border, #45475a);overflow:hidden}
      .bw-progress-bar{height:100%;background:var(--pub-green, #a6e3a1);border-radius:3px}
      .bw-progress-label{font-size:.72rem;color:var(--pub-fg2, #a6adc8)}
      .bw-card-meta{font-size:.72rem;color:var(--pub-dim, #6c7086)}
      .bw-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
      .bw-dialog{background:var(--pub-bg, #1e1e2e);border-radius:10px;padding:18px;width:100%;max-width:420px;max-height:88%;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
      .bw-dialog h3{margin:0 0 4px}
      .bw-field label{display:block;font-size:.78rem;color:var(--pub-fg2, #a6adc8);margin-bottom:4px}
      .bw-field-hint{font-size:.72rem;color:var(--pub-warning, #f9a825);margin-top:4px}
      .bw-field input[type=text],.bw-field input[type=number],.bw-field textarea{
        width:100%;box-sizing:border-box;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);border-radius:6px;
        color:var(--pub-fg, #cdd6f4);padding:7px 9px;font-family:inherit;font-size:.85rem}
      .bw-field textarea{resize:vertical;min-height:50px}
      .bw-radio-row{display:flex;gap:14px;align-items:center}
      .bw-radio-row label{display:flex;align-items:center;gap:5px;font-size:.82rem;color:var(--pub-fg, #cdd6f4)}
      .bw-error{color:var(--pub-red, #f38ba8);font-size:.78rem}
      .bw-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
      .bw-tx-list{display:flex;flex-direction:column;gap:6px;max-height:220px;overflow-y:auto}
      .bw-tx-row{display:flex;flex-direction:column;gap:2px;background:var(--pub-surface2, #313244);border-radius:6px;padding:6px 9px}
      .bw-tx-row-top{display:flex;align-items:center;gap:8px}
      .bw-tx-amount{font-weight:700;flex:0 0 auto;white-space:nowrap}
      .bw-tx-pos{color:var(--pub-green, #a6e3a1)}
      .bw-tx-neg{color:var(--pub-red, #f38ba8)}
      .bw-tx-note{flex:1;min-width:0;color:var(--pub-fg2, #a6adc8);font-size:.78rem;word-break:break-word}
      .bw-tx-row-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .bw-tx-meta{font-size:.68rem;color:var(--pub-dim, #6c7086);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-tx-date{font-size:.68rem;color:var(--pub-dim, #6c7086);white-space:nowrap;flex:0 0 auto}
      .bw-tx-deleted{opacity:.5}
      .bw-tx-deleted .bw-tx-amount,.bw-tx-deleted .bw-tx-note{text-decoration:line-through}
      .bw-add-row{display:flex;gap:6px;align-items:flex-end}
      .bw-add-row .bw-field{flex:1}
      .bw-amount-group{display:flex;gap:4px}
      .bw-amount-group select{background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);border-radius:6px;color:var(--pub-fg, #cdd6f4);
        padding:7px 4px;font-family:inherit;font-size:.85rem;flex:0 0 46px}
      .bw-amount-group input{flex:1}
      .bw-total-balance{font-size:1.3rem;font-weight:700}
      .bw-mass-row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--pub-surface2, #313244)}
      .bw-mass-row-info{flex:1;min-width:0}
      .bw-mass-row-title{font-weight:600;font-size:.82rem}
      .bw-mass-row-alloc{font-size:.7rem;color:var(--pub-dim, #6c7086)}
      .bw-mass-row input{width:100px}
      .bw-member-row{display:flex;align-items:center;gap:8px;padding:5px 0}
      .bw-member-name{flex:1;font-size:.82rem}
      .bw-member-role{font-size:.68rem;color:var(--pub-fg2, #a6adc8)}
      .bw-section-label{font-size:.72rem;color:var(--pub-fg2, #a6adc8);text-transform:uppercase;letter-spacing:.4px;margin-top:6px}
      .bw-menu-wrap{position:relative}
      .bw-menu-dropdown{position:absolute;top:calc(100% + 4px);left:0;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);
        border-radius:8px;padding:4px;min-width:170px;box-shadow:0 4px 16px rgba(0,0,0,.35);z-index:60}
      .bw-menu-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:6px;cursor:pointer;font-size:.85rem;color:var(--pub-fg, #cdd6f4)}
      .bw-menu-item:hover{background:var(--pub-border, #45475a)}
      .bw-menu-item.active{color:var(--pub-accent, #89b4fa)}
      .bw-history-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0}
      .bw-history-toolbar h2{margin:0;font-size:1rem;flex:1}
      .bw-history-list{display:flex;flex-direction:column;gap:6px}
      .bw-htx-row{display:flex;flex-direction:column;gap:2px;background:var(--pub-surface2, #313244);border-radius:8px;padding:8px 10px}
      .bw-htx-row-top{display:flex;align-items:center;gap:8px}
      .bw-htx-cat{font-weight:600;font-size:.82rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-htx-row-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .bw-stats-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0;flex-wrap:wrap}
      .bw-stats-toolbar h2{margin:0;font-size:1rem;flex:1}
      .bw-period-tabs{display:flex;gap:4px;background:var(--pub-surface2, #313244);border-radius:6px;padding:2px}
      .bw-period-tab{background:none;border:none;color:var(--pub-fg2, #a6adc8);padding:5px 10px;border-radius:5px;cursor:pointer;font-size:.78rem}
      .bw-period-tab.active{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .bw-chart-wrap{background:var(--pub-surface2, #313244);border-radius:10px;padding:14px;margin-bottom:14px}
      .bw-chart-legend{display:flex;gap:14px;margin-bottom:10px;font-size:.75rem}
      .bw-legend-item{display:flex;align-items:center;gap:5px}
      .bw-legend-dot{width:9px;height:9px;border-radius:2px;display:inline-block}
      .bw-bars{display:flex;align-items:flex-end;gap:10px;height:150px;overflow-x:auto;padding-top:6px}
      .bw-bar-col{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;min-width:44px;height:100%;justify-content:flex-end}
      .bw-bar-pair{display:flex;align-items:flex-end;gap:2px;height:100%;width:100%;justify-content:center}
      .bw-bar{width:14px;border-radius:3px 3px 0 0;min-height:2px}
      .bw-bar-income{background:var(--pub-green, #a6e3a1)}
      .bw-bar-expense{background:var(--pub-red, #f38ba8)}
      .bw-bar-label{font-size:.66rem;color:var(--pub-dim, #6c7086);white-space:nowrap}
      .bw-cat-stat-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--pub-surface2, #313244);font-size:.82rem}
      .bw-cat-stat-row:last-child{border-bottom:none}
      @media (max-width:520px){
        .bw-grid{grid-template-columns:1fr}
        .bw-toolbar,.bw-history-toolbar{flex-wrap:wrap}
        .bw-toolbar h2,.bw-history-toolbar h2{flex:1 1 100%}
        .bw-dialog{max-width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = `<div class="bw-login">${esc(t('login_needed'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    let destroyed = false;
    let categories = [];

    root.style.position = 'relative';
    root.innerHTML = `<div class="bw-widget">
      <div class="bw-toolbar">
        <div class="bw-menu-wrap">
          <button class="bw-btn-icon" id="bw-menu-btn" title="${esc(t('menu'))}">☰</button>
        </div>
        <h2>💰 ${esc(t('title'))}</h2>
        <button class="bw-btn-icon" id="bw-settings-btn" title="${esc(t('settings'))}">⚙️</button>
        <button class="bw-btn" id="bw-mass-add">${esc(t('mass_add'))}</button>
        <button class="bw-btn bw-btn-primary" id="bw-add-cat">${esc(t('add_category'))}</button>
      </div>
      <div class="bw-body">
        <div class="bw-grid" id="bw-grid"></div>
        <div id="bw-history-view" style="display:none"></div>
        <div id="bw-stats-view" style="display:none"></div>
      </div>
    </div>`;
    const widgetEl = root.querySelector('.bw-widget');
    const gridEl = root.querySelector('#bw-grid');
    const historyViewEl = root.querySelector('#bw-history-view');
    const statsViewEl = root.querySelector('#bw-stats-view');
    const addCatBtn = root.querySelector('#bw-add-cat');
    const massAddBtn = root.querySelector('#bw-mass-add');

    function _showView(name) {
      gridEl.style.display = name === 'categories' ? '' : 'none';
      historyViewEl.style.display = name === 'history' ? '' : 'none';
      statsViewEl.style.display = name === 'stats' ? '' : 'none';
      addCatBtn.style.display = name === 'categories' ? '' : 'none';
      massAddBtn.style.display = name === 'categories' ? '' : 'none';
    }

    function showCategoriesView() { _showView('categories'); refresh(); }
    function showHistoryView() { _showView('history'); loadFullHistory(); }
    function showStatsView() { _showView('stats'); loadStats(statsPeriod); }

    function _htxWho(p) { return p && (p.display_name || p.username) || ''; }
    function _htxDate(iso) {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    async function loadFullHistory() {
      historyViewEl.innerHTML = `<div class="bw-empty">…</div>`;
      let rows;
      try { rows = await api('/history'); } catch (e) { rows = []; }
      if (!rows.length) { historyViewEl.innerHTML = `<div class="bw-empty">${esc(t('no_history'))}</div>`; return; }
      historyViewEl.innerHTML = `<div class="bw-history-list">${rows.map(r => {
        const who = _htxWho(r.added_by);
        const deletedWho = r.deleted_by_user ? _htxWho(r.deleted_by_user) : '';
        const catLabel = r.parent_title ? `${r.parent_title} / ${r.category_title}` : r.category_title;
        const mine = r.user_id === myId;
        return `
        <div class="bw-htx-row ${r.deleted_at ? 'bw-tx-deleted' : ''}" data-id="${esc(r.id)}">
          <div class="bw-htx-row-top">
            <span class="bw-htx-cat">${esc(catLabel)}</span>
            <span class="bw-tx-amount ${r.amount >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${r.amount >= 0 ? '+' : ''}${fmtMoney(r.amount)}</span>
            ${(!r.deleted_at && mine) ? `<button class="bw-btn-icon" data-action="edit-htx">✎</button>` : ''}
            ${(!r.deleted_at && mine) ? `<button class="bw-btn-icon" data-action="del-htx">🗑</button>` : ''}
          </div>
          ${r.note ? `<div class="bw-tx-note">${esc(r.note)}</div>` : ''}
          <div class="bw-htx-row-bottom">
            <span class="bw-tx-meta">
              ${who ? esc(who) : ''}
              ${r.deleted_at ? ` · ${esc(deletedWho || '?')}` : ''}
            </span>
            <span class="bw-tx-date">${esc(_htxDate(r.created_at))}</span>
          </div>
        </div>`;
      }).join('')}</div>`;

      historyViewEl.querySelectorAll('[data-action="del-htx"]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm(t('confirm_delete_tx'))) return;
          const id = btn.closest('.bw-htx-row').dataset.id;
          await api(`/transactions/${id}`, { method: 'DELETE' });
          loadFullHistory();
        };
      });
      historyViewEl.querySelectorAll('[data-action="edit-htx"]').forEach(btn => {
        btn.onclick = () => {
          const id = btn.closest('.bw-htx-row').dataset.id;
          const row = rows.find(r => r.id === id);
          openEditTxGeneric(row, () => loadFullHistory());
        };
      });
    }

    let statsPeriod = 'month';

    function _periodLabel(p, period) {
      if (period === 'year') return p;
      if (period === 'week') {
        const [y, w] = p.split('-W');
        return 'W' + w + " '" + y.slice(2);
      }
      const [y, m] = p.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }

    async function loadStats(period) {
      statsPeriod = period;
      statsViewEl.innerHTML = `
        <div class="bw-stats-toolbar">
          <h2>📊 ${esc(t('stats'))}</h2>
          <div class="bw-period-tabs" id="bw-period-tabs">
            <button class="bw-period-tab ${period === 'week' ? 'active' : ''}" data-p="week">${esc(t('stats_period_week'))}</button>
            <button class="bw-period-tab ${period === 'month' ? 'active' : ''}" data-p="month">${esc(t('stats_period_month'))}</button>
            <button class="bw-period-tab ${period === 'year' ? 'active' : ''}" data-p="year">${esc(t('stats_period_year'))}</button>
          </div>
        </div>
        <div style="padding:14px" id="bw-stats-body"><div class="bw-empty">…</div></div>
      `;
      statsViewEl.querySelectorAll('.bw-period-tab').forEach(btn => {
        btn.onclick = () => loadStats(btn.dataset.p);
      });

      const count = period === 'week' ? 8 : period === 'year' ? 6 : 6;
      let data;
      try { data = await api(`/stats?period=${period}&count=${count}`); } catch (e) { data = { periods: [], by_category: [] }; }
      const bodyEl = statsViewEl.querySelector('#bw-stats-body');
      if (!data.periods.length) { bodyEl.innerHTML = `<div class="bw-empty">${esc(t('no_stats'))}</div>`; return; }

      const maxVal = Math.max(1, ...data.periods.map(p => Math.max(p.income, p.expense)));
      const bars = data.periods.map(p => {
        const incH = Math.round((p.income / maxVal) * 130);
        const expH = Math.round((p.expense / maxVal) * 130);
        return `<div class="bw-bar-col">
          <div class="bw-bar-pair">
            <div class="bw-bar bw-bar-income" style="height:${incH}px" title="${esc(t('stats_income'))}: ${fmtMoney(p.income)}"></div>
            <div class="bw-bar bw-bar-expense" style="height:${expH}px" title="${esc(t('stats_expense'))}: ${fmtMoney(p.expense)}"></div>
          </div>
          <div class="bw-bar-label">${esc(_periodLabel(p.period, period))}</div>
        </div>`;
      }).join('');

      const totalIncome = data.periods.reduce((s, p) => s + p.income, 0);
      const totalExpense = data.periods.reduce((s, p) => s + p.expense, 0);
      const totalNet = totalIncome - totalExpense;

      const catRows = data.by_category.slice(0, 12).map(c => `
        <div class="bw-cat-stat-row">
          <span>${esc(c.title)}</span>
          <span class="${c.net >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${c.net >= 0 ? '+' : ''}${fmtMoney(c.net)}</span>
        </div>`).join('');

      bodyEl.innerHTML = `
        <div class="bw-chart-wrap">
          <div class="bw-chart-legend">
            <span class="bw-legend-item"><span class="bw-legend-dot" style="background:#a6e3a1"></span>${esc(t('stats_income'))}: ${fmtMoney(totalIncome)}</span>
            <span class="bw-legend-item"><span class="bw-legend-dot" style="background:#f38ba8"></span>${esc(t('stats_expense'))}: ${fmtMoney(totalExpense)}</span>
            <span class="bw-legend-item">${esc(t('stats_net'))}: <span class="${totalNet >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${totalNet >= 0 ? '+' : ''}${fmtMoney(totalNet)}</span></span>
          </div>
          <div class="bw-bars">${bars}</div>
        </div>
        <div class="bw-section-label">${esc(t('stats_by_category'))}</div>
        ${catRows || `<div class="bw-empty">${esc(t('no_stats'))}</div>`}
      `;
    }

    async function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      const r = await fetch(API + path, Object.assign({}, o, { headers }));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('http_' + r.status));
      return data;
    }
    async function favApi(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      const r = await fetch('/api/pub/apphub' + path, Object.assign({}, o, { headers }));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('http_' + r.status));
      return data;
    }
    function markNotifRead(categoryId) {
      fetch('/api/notifications/read-by-ref', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Pub-Token': token },
        body: JSON.stringify({ source: 'budget', ref: String(categoryId) }),
      }).then(() => window.mvmOS?._refreshNotifs?.()).catch(() => {});
    }

    function overlay(contentHtml) {
      const ov = document.createElement('div');
      ov.className = 'bw-overlay';
      ov.innerHTML = contentHtml;
      widgetEl.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
      return ov;
    }

    let myCurrency = null; // override code, or null = system default
    let myId = null;
    let myDefaultSign = 1;

    async function loadMyCurrency() {
      const me = await api('/me');
      myId = me.id;
      myCurrency = me.currency;
      myDefaultSign = me.default_sign === -1 ? -1 : 1;
      _currencySymbol = currencySymbol(me.effective_currency);
    }

    async function openSettingsModal() {
      const freshCategories = await api('/categories');
      const total = freshCategories.reduce((sum, c) => sum + c.balance, 0);
      let sources = [];
      try { sources = await api('/me/sources'); } catch (e) { sources = []; }
      const sourcesRows = sources.map(s => `
        <label style="display:flex;align-items:center;gap:6px;padding:3px 0">
          <input type="checkbox" data-source-app="${esc(s.source_app)}" ${s.visible ? 'checked' : ''}>
          ${esc(s.source_app_name)}
        </label>`).join('');
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(t('settings'))}</h3>
        <div class="bw-field"><label>${esc(t('total_balance'))}</label>
          <div class="bw-total-balance ${total >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${total >= 0 ? '+' : ''}${fmtMoney(total)}</div>
        </div>
        <div class="bw-field"><label>${esc(t('currency'))}</label>
          <select id="bw-cur-select">
            <option value="">${esc(t('system_default'))}</option>
            ${CURRENCIES.map(c => `<option value="${c.value}" ${myCurrency === c.value ? 'selected' : ''}>${c.symbol} ${c.value}</option>`).join('')}
          </select>
        </div>
        <div class="bw-field"><label>${esc(t('default_sign'))}</label>
          <select id="bw-sign-select">
            <option value="1" ${myDefaultSign === 1 ? 'selected' : ''}>${esc(t('deposit'))}</option>
            <option value="-1" ${myDefaultSign === -1 ? 'selected' : ''}>${esc(t('withdrawal'))}</option>
          </select>
        </div>
        ${sources.length ? `<div class="bw-field">
          <label>${esc(t('sources_section'))}</label>
          <div class="bw-field-hint">${esc(t('sources_hint'))}</div>
          ${sourcesRows}
        </div>` : ''}
        <div class="bw-dialog-actions">
          <button class="bw-btn" id="bw-cur-cancel">${esc(t('cancel'))}</button>
          <button class="bw-btn bw-btn-primary" id="bw-cur-save">${esc(t('save'))}</button>
        </div>
      </div>`);
      ov.querySelectorAll('[data-source-app]').forEach(chk => {
        chk.onchange = () => {
          const visible = chk.checked;
          api(`/me/sources/${encodeURIComponent(chk.dataset.sourceApp)}`, {
            method: 'PUT', body: JSON.stringify({ visible }),
          }).catch(() => { chk.checked = !visible; });
        };
      });
      ov.querySelector('#bw-cur-cancel').onclick = () => ov.remove();
      ov.querySelector('#bw-cur-save').onclick = async () => {
        const val = ov.querySelector('#bw-cur-select').value || null;
        const sign = parseInt(ov.querySelector('#bw-sign-select').value, 10);
        await api('/me/settings', { method: 'PUT', body: JSON.stringify({ currency: val, default_sign: sign }) });
        ov.remove();
        await loadMyCurrency();
        await refresh();
      };
    }

    function renderCards() {
      if (!categories.length) {
        gridEl.innerHTML = `<div class="bw-empty" style="grid-column:1/-1">${esc(t('no_categories'))}</div>`;
        return;
      }
      gridEl.innerHTML = categories.map(c => {
        const isOwner = c.role === 'owner';
        const canHoldSubcats = !c.alloc_value;
        const allocLabel = c.alloc_type === 'percent' ? `${c.alloc_value}%` : fmtMoney(c.alloc_value);
        const goalBlock = c.goal ? `
          <div class="bw-progress"><div class="bw-progress-bar" style="width:${Math.max(0, Math.min(100, c.progress_pct || 0))}%"></div></div>
          <div class="bw-progress-label">${fmtMoney(c.balance)} / ${fmtMoney(c.goal)} (${c.progress_pct || 0}%)</div>
        ` : '';
        return `<div class="bw-card" data-id="${esc(c.id)}">
          <div class="bw-card-head">
            <div class="bw-card-title">${esc(c.title)}</div>
            <div class="bw-card-actions">
              ${isOwner ? `${canHoldSubcats ? `<button class="bw-btn-icon" data-action="subcats" title="${esc(t('manage_subcategories'))}">📂</button>` : ''}
                           <button class="bw-btn-icon bw-btn-owner" data-action="share" title="${esc(t('owner'))} · ${esc(t('share'))}">🤝</button>
                           <button class="bw-btn-icon" data-action="edit" title="${esc(t('edit'))}">✎</button>
                           <button class="bw-btn-icon" data-action="delete" title="${esc(t('delete'))}">🗑</button>`
                        : `<button class="bw-btn-icon" data-action="leave" title="${esc(t('leave_category'))}">🚪</button>`}
            </div>
          </div>
          ${c.description ? `<div class="bw-card-desc">${esc(c.description)}</div>` : ''}
          <div class="bw-card-balance" data-action="history">${fmtMoney(c.balance)}</div>
          ${goalBlock}
          <div class="bw-card-meta">${c.has_children ? esc(t('subcategories')) : esc(allocLabel)}${c.member_count > 1 ? ` · ${c.member_count} ${esc(t('members'))}` : ''}</div>
        </div>`;
      }).join('');

      gridEl.querySelectorAll('.bw-card').forEach(card => {
        const id = card.dataset.id;
        const cat = categories.find(c => c.id === id);
        card.querySelector('[data-action="history"]').onclick = () => cat.has_children ? openSubcategories(cat) : openHistory(cat);
        const subcatsBtn = card.querySelector('[data-action="subcats"]');
        if (subcatsBtn) subcatsBtn.onclick = () => openSubcategories(cat);
        const editBtn = card.querySelector('[data-action="edit"]');
        if (editBtn) editBtn.onclick = () => openCategoryForm(cat);
        const shareBtn = card.querySelector('[data-action="share"]');
        if (shareBtn) shareBtn.onclick = () => openShare(cat);
        const delBtn = card.querySelector('[data-action="delete"]');
        if (delBtn) delBtn.onclick = () => deleteCategory(cat);
        const leaveBtn = card.querySelector('[data-action="leave"]');
        if (leaveBtn) leaveBtn.onclick = () => leaveCategory(cat);
      });
    }

    async function refresh() {
      categories = await api('/categories');
      if (destroyed) return;
      renderCards();
    }

    function openCategoryForm(existing) {
      const isEdit = !!existing;
      const isParentByValue = isEdit && !existing.alloc_value;
      const isLocked = isEdit && existing.has_children;
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(isEdit ? t('edit_category') : t('new_category'))}</h3>
        <div class="bw-field"><label>${esc(t('cat_title'))}</label>
          <input type="text" id="bw-f-title" maxlength="200" value="${esc(existing ? existing.title : '')}"></div>
        <div class="bw-field"><label>${esc(t('description'))}</label>
          <textarea id="bw-f-desc" maxlength="1000">${esc(existing ? existing.description : '')}</textarea></div>
        <div class="bw-field">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="bw-f-is-parent" ${isParentByValue ? 'checked' : ''} ${isLocked ? 'disabled' : ''}>
            ${esc(t('is_parent_category'))}
          </label>
          ${isLocked ? `<div class="bw-field-hint">${esc(t('parent_locked_hint'))}</div>` : ''}
        </div>
        <div id="bw-f-alloc-wrap" style="${isParentByValue ? 'display:none' : ''}">
          <div class="bw-field"><label>${esc(t('allocation'))}</label>
            <div class="bw-radio-row">
              <label><input type="radio" name="bw-f-alloc-type" value="percent" ${(!existing || existing.alloc_type === 'percent') ? 'checked' : ''}> ${esc(t('percent'))}</label>
              <label><input type="radio" name="bw-f-alloc-type" value="fixed" ${(existing && existing.alloc_type === 'fixed') ? 'checked' : ''}> ${esc(t('fixed'))}</label>
            </div>
            <input type="number" id="bw-f-alloc-value" step="0.01" min="0" style="margin-top:6px"
              value="${existing ? existing.alloc_value : ''}"></div>
        </div>
        <div class="bw-field"><label>${esc(t('goal'))}</label>
          <input type="number" id="bw-f-goal" step="0.01" min="0" value="${existing && existing.goal != null ? existing.goal : ''}"></div>
        <div class="bw-error" id="bw-f-error" style="display:none"></div>
        <div class="bw-dialog-actions">
          <button class="bw-btn" id="bw-f-cancel">${esc(t('cancel'))}</button>
          <button class="bw-btn bw-btn-primary" id="bw-f-save">${esc(t('save'))}</button>
        </div>
      </div>`);
      const errEl = ov.querySelector('#bw-f-error');
      const allocWrap = ov.querySelector('#bw-f-alloc-wrap');
      const isParentChk = ov.querySelector('#bw-f-is-parent');
      isParentChk.onchange = () => { allocWrap.style.display = isParentChk.checked ? 'none' : ''; };
      ov.querySelector('#bw-f-cancel').onclick = () => ov.remove();
      ov.querySelector('#bw-f-save').onclick = async () => {
        const title = ov.querySelector('#bw-f-title').value.trim();
        if (!title) { errEl.textContent = t('title_required'); errEl.style.display = 'block'; return; }
        const isParent = isParentChk.checked;
        const goalRaw = ov.querySelector('#bw-f-goal').value.trim();
        const goal = goalRaw ? parseFloat(goalRaw) : null;
        let body;
        if (isParent) {
          body = { title, description: ov.querySelector('#bw-f-desc').value.trim(), alloc_type: 'fixed', alloc_value: 0, goal };
        } else {
          const allocType = ov.querySelector('input[name="bw-f-alloc-type"]:checked').value;
          const allocValue = parseFloat(ov.querySelector('#bw-f-alloc-value').value);
          if (isNaN(allocValue) || allocValue < 0 || (allocType === 'percent' && allocValue > 100)) {
            errEl.textContent = t('invalid_allocation'); errEl.style.display = 'block'; return;
          }
          body = {
            title, description: ov.querySelector('#bw-f-desc').value.trim(),
            alloc_type: allocType, alloc_value: allocValue, goal,
          };
        }
        try {
          if (isEdit) await api(`/categories/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
          else await api('/categories', { method: 'POST', body: JSON.stringify(body) });
          ov.remove();
          await refresh();
        } catch (e) {
          errEl.textContent = t('save_failed'); errEl.style.display = 'block';
        }
      };
    }

    async function deleteCategory(cat) {
      if (!confirm(t('confirm_delete_category'))) return;
      try { await api(`/categories/${cat.id}`, { method: 'DELETE' }); await refresh(); }
      catch (e) { alert(t('save_failed')); }
    }

    async function leaveCategory(cat) {
      if (!confirm(t('confirm_leave'))) return;
      try { await api(`/categories/${cat.id}/members/${myId}`, { method: 'DELETE' }); await refresh(); }
      catch (e) { alert(t('save_failed')); }
    }

    function openEditTxGeneric(row, onSaved) {
      const sign = row.amount >= 0 ? 1 : -1;
      const eov = overlay(`<div class="bw-dialog">
        <h3>${esc(t('edit'))}</h3>
        <div class="bw-add-row">
          <div class="bw-field"><label>${esc(t('amount'))}</label>
            <div class="bw-amount-group">
              <select id="bw-edit-sign">
                <option value="1" ${sign === 1 ? 'selected' : ''}>+</option>
                <option value="-1" ${sign === -1 ? 'selected' : ''}>−</option>
              </select>
              <input type="number" id="bw-edit-amount" step="0.01" min="0" value="${Math.abs(row.amount)}">
            </div>
          </div>
          <div class="bw-field"><label>${esc(t('note'))}</label>
            <input type="text" id="bw-edit-note" maxlength="300" value="${esc(row.note || '')}"></div>
        </div>
        <div class="bw-error" id="bw-edit-err" style="display:none"></div>
        <div class="bw-dialog-actions">
          <button class="bw-btn" id="bw-edit-cancel">${esc(t('cancel'))}</button>
          <button class="bw-btn bw-btn-primary" id="bw-edit-save">${esc(t('save'))}</button>
        </div>
      </div>`);
      const errEl2 = eov.querySelector('#bw-edit-err');
      eov.querySelector('#bw-edit-cancel').onclick = () => eov.remove();
      eov.querySelector('#bw-edit-save').onclick = async () => {
        const raw = parseFloat(eov.querySelector('#bw-edit-amount').value);
        const s = parseInt(eov.querySelector('#bw-edit-sign').value, 10);
        if (isNaN(raw) || raw <= 0) { errEl2.textContent = t('invalid_allocation'); errEl2.style.display = 'block'; return; }
        const note = eov.querySelector('#bw-edit-note').value.trim();
        try {
          await api(`/transactions/${row.id}`, { method: 'PUT', body: JSON.stringify({ amount: raw * s, note }) });
          eov.remove();
          onSaved();
        } catch (e) {
          errEl2.textContent = e.message || t('mass_add_failed');
          errEl2.style.display = 'block';
        }
      };
    }

    async function openHistory(cat, onClose) {
      markNotifRead(cat.id);
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(cat.title)}</h3>
        <div class="bw-card-balance">${fmtMoney(cat.balance)}</div>
        <div class="bw-add-row">
          <div class="bw-field"><label>${esc(t('amount'))}</label>
            <div class="bw-amount-group">
              <select id="bw-tx-sign">
                <option value="1" ${myDefaultSign === 1 ? 'selected' : ''}>+</option>
                <option value="-1" ${myDefaultSign === -1 ? 'selected' : ''}>−</option>
              </select>
              <input type="number" id="bw-tx-amount" step="0.01" min="0">
            </div>
          </div>
          <div class="bw-field"><label>${esc(t('note'))}</label><input type="text" id="bw-tx-note" maxlength="300"></div>
          <button class="bw-btn bw-btn-primary" id="bw-tx-add">${esc(t('save'))}</button>
        </div>
        <div class="bw-error" id="bw-tx-error" style="display:none"></div>
        <div class="bw-section-label">${esc(t('history'))}</div>
        <div class="bw-tx-list" id="bw-tx-list"><div class="bw-empty">${esc(t('no_transactions'))}</div></div>
        <div class="bw-dialog-actions"><button class="bw-btn" id="bw-tx-close">${esc(t('close'))}</button></div>
      </div>`);
      const errEl = ov.querySelector('#bw-tx-error');
      ov.querySelector('#bw-tx-close').onclick = () => { ov.remove(); if (onClose) onClose(); else refresh(); };

      async function fetchFreshBalance() {
        const list = cat.parent_id ? await api(`/categories/${cat.parent_id}/children`) : await api('/categories');
        return list.find(c => c.id === cat.id)?.balance;
      }

      function _txWho(p) { return p && (p.display_name || p.username) || ''; }

      function _txDate(iso) {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' }) +
          ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
      }

      async function loadTx() {
        const rows = await api(`/categories/${cat.id}/transactions`);
        const listEl = ov.querySelector('#bw-tx-list');
        if (!rows.length) { listEl.innerHTML = `<div class="bw-empty">${esc(t('no_transactions'))}</div>`; return; }
        listEl.innerHTML = rows.map(r => {
          const who = _txWho(r.added_by);
          const deletedWho = r.deleted_by_user ? _txWho(r.deleted_by_user) : '';
          const mine = r.user_id === myId;
          return `
          <div class="bw-tx-row ${r.deleted_at ? 'bw-tx-deleted' : ''}" data-id="${esc(r.id)}">
            <div class="bw-tx-row-top">
              <span class="bw-tx-amount ${r.amount >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${r.amount >= 0 ? '+' : ''}${fmtMoney(r.amount)}</span>
              <span class="bw-tx-note">${esc(r.note)}</span>
              ${(!r.deleted_at && mine) ? `<button class="bw-btn-icon" data-action="edit-tx">✎</button>` : ''}
              ${(!r.deleted_at && mine) ? `<button class="bw-btn-icon" data-action="del-tx">🗑</button>` : ''}
            </div>
            <div class="bw-tx-row-bottom">
              <span class="bw-tx-meta">
                ${who ? esc(who) : ''}
                ${r.deleted_at ? ` · ${esc(deletedWho || '?')}` : ''}
              </span>
              <span class="bw-tx-date">${esc(_txDate(r.created_at))}</span>
            </div>
          </div>`;
        }).join('');
        listEl.querySelectorAll('[data-action="del-tx"]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('confirm_delete_tx'))) return;
            const id = btn.closest('.bw-tx-row').dataset.id;
            await api(`/transactions/${id}`, { method: 'DELETE' });
            cat.balance = (await fetchFreshBalance()) ?? cat.balance;
            ov.querySelector('.bw-card-balance').textContent = fmtMoney(cat.balance);
            loadTx();
          };
        });
        listEl.querySelectorAll('[data-action="edit-tx"]').forEach(btn => {
          btn.onclick = () => {
            const id = btn.closest('.bw-tx-row').dataset.id;
            const row = rows.find(r => r.id === id);
            openEditTxGeneric(row, async () => {
              cat.balance = (await fetchFreshBalance()) ?? cat.balance;
              ov.querySelector('.bw-card-balance').textContent = fmtMoney(cat.balance);
              loadTx();
            });
          };
        });
      }
      loadTx();

      async function submitTx() {
        const raw = parseFloat(ov.querySelector('#bw-tx-amount').value);
        const sign = parseInt(ov.querySelector('#bw-tx-sign').value, 10);
        if (isNaN(raw) || raw <= 0) { errEl.textContent = t('invalid_allocation'); errEl.style.display = 'block'; return; }
        const note = ov.querySelector('#bw-tx-note').value.trim();
        try {
          await api(`/categories/${cat.id}/transactions`, {
            method: 'POST', body: JSON.stringify({ amount: raw * sign, note }),
          });
          ov.querySelector('#bw-tx-amount').value = '';
          ov.querySelector('#bw-tx-note').value = '';
          ov.querySelector('#bw-tx-sign').value = String(myDefaultSign);
          errEl.style.display = 'none';
          const freshBalance = await fetchFreshBalance();
          if (freshBalance !== undefined) { cat.balance = freshBalance; ov.querySelector('.bw-card-balance').textContent = fmtMoney(cat.balance); }
          loadTx();
        } catch (e) { errEl.textContent = t('save_failed'); errEl.style.display = 'block'; }
      }
      ov.querySelector('#bw-tx-add').onclick = () => submitTx();
    }

    async function deleteSubcategory(sub) {
      if (!confirm(t('confirm_delete_subcategory'))) return;
      try { await api(`/categories/${sub.id}`, { method: 'DELETE' }); }
      catch (e) { alert(t('save_failed')); }
    }

    async function openSubcategories(cat) {
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(cat.title)}</h3>
        <div class="bw-card-balance">${fmtMoney(cat.balance)}</div>
        <div class="bw-dialog-actions" style="justify-content:flex-start">
          <button class="bw-btn bw-btn-primary" id="bw-sub-add">${esc(t('add_subcategory'))}</button>
        </div>
        <div class="bw-section-label">${esc(t('subcategories'))}</div>
        <div id="bw-sub-list"><div class="bw-empty">${esc(t('no_subcategories'))}</div></div>
        <div class="bw-dialog-actions"><button class="bw-btn" id="bw-sub-close">${esc(t('close'))}</button></div>
      </div>`);
      const listEl = ov.querySelector('#bw-sub-list');
      ov.querySelector('#bw-sub-close').onclick = () => { ov.remove(); refresh(); };

      async function loadSubs() {
        const subs = await api(`/categories/${cat.id}/children`);
        cat.balance = subs.reduce((s, c) => s + c.balance, 0);
        ov.querySelector('.bw-card-balance').textContent = fmtMoney(cat.balance);
        if (!subs.length) { listEl.innerHTML = `<div class="bw-empty">${esc(t('no_subcategories'))}</div>`; return; }
        listEl.innerHTML = subs.map(s => `
          <div class="bw-member-row" data-id="${esc(s.id)}">
            <span class="bw-member-name" data-action="open">${esc(s.title)}</span>
            <span class="${s.balance >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${s.balance >= 0 ? '+' : ''}${fmtMoney(s.balance)}</span>
            <button class="bw-btn-icon" data-action="delete-sub" title="${esc(t('delete'))}">🗑</button>
          </div>`).join('');
        listEl.querySelectorAll('.bw-member-row').forEach(row => {
          const sub = subs.find(s => s.id === row.dataset.id);
          const openBtn = row.querySelector('[data-action="open"]');
          openBtn.style.cursor = 'pointer';
          openBtn.onclick = () => openHistory(sub, loadSubs);
          row.querySelector('[data-action="delete-sub"]').onclick = async () => {
            await deleteSubcategory(sub);
            loadSubs();
          };
        });
      }
      ov.querySelector('#bw-sub-add').onclick = () => openSubcategoryForm(cat, loadSubs);
      loadSubs();
    }

    function openSubcategoryForm(parent, after) {
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(t('new_subcategory'))}</h3>
        <div class="bw-field"><label>${esc(t('cat_title'))}</label>
          <input type="text" id="bw-sf-title" maxlength="200"></div>
        <div class="bw-field"><label>${esc(t('description'))}</label>
          <textarea id="bw-sf-desc" maxlength="1000"></textarea></div>
        <div class="bw-error" id="bw-sf-error" style="display:none"></div>
        <div class="bw-dialog-actions">
          <button class="bw-btn" id="bw-sf-cancel">${esc(t('cancel'))}</button>
          <button class="bw-btn bw-btn-primary" id="bw-sf-save">${esc(t('save'))}</button>
        </div>
      </div>`);
      const errEl = ov.querySelector('#bw-sf-error');
      ov.querySelector('#bw-sf-cancel').onclick = () => ov.remove();
      ov.querySelector('#bw-sf-save').onclick = async () => {
        const title = ov.querySelector('#bw-sf-title').value.trim();
        if (!title) { errEl.textContent = t('title_required'); errEl.style.display = 'block'; return; }
        const body = { title, description: ov.querySelector('#bw-sf-desc').value.trim(), parent_id: parent.id };
        try {
          await api('/categories', { method: 'POST', body: JSON.stringify(body) });
          ov.remove();
          after();
        } catch (e) {
          errEl.textContent = e.message === 'parent has own transactions' ? t('parent_has_own_tx') : t('save_failed');
          errEl.style.display = 'block';
        }
      };
    }

    function openMassAdd() {
      const massCategories = categories.filter(c => !c.has_children);
      if (!massCategories.length) return;
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(t('mass_add_title'))}</h3>
        <div class="bw-field"><label>${esc(t('total_amount'))}</label><input type="number" id="bw-mass-total" step="0.01"></div>
        <div class="bw-section-label">${esc(t('mass_add_hint'))}</div>
        <div id="bw-mass-list"></div>
        <div class="bw-error" id="bw-mass-error" style="display:none"></div>
        <div class="bw-dialog-actions">
          <button class="bw-btn" id="bw-mass-cancel">${esc(t('cancel'))}</button>
          <button class="bw-btn bw-btn-primary" id="bw-mass-save">${esc(t('mass_add_save'))}</button>
        </div>
      </div>`);
      const listEl = ov.querySelector('#bw-mass-list');
      const totalEl = ov.querySelector('#bw-mass-total');
      const errEl = ov.querySelector('#bw-mass-error');
      const touched = new Set();

      listEl.innerHTML = massCategories.map(c => `
        <div class="bw-mass-row" data-id="${esc(c.id)}">
          <div class="bw-mass-row-info">
            <div class="bw-mass-row-title">${esc(c.title)}</div>
            <div class="bw-mass-row-alloc">${c.alloc_type === 'percent' ? c.alloc_value + '%' : fmtMoney(c.alloc_value)}</div>
          </div>
          <input type="number" step="0.01" data-cid="${esc(c.id)}" value="0">
        </div>`).join('');

      listEl.querySelectorAll('input[data-cid]').forEach(inp => {
        inp.addEventListener('input', () => touched.add(inp.dataset.cid));
      });
      totalEl.addEventListener('input', () => {
        const total = parseFloat(totalEl.value) || 0;
        massCategories.forEach(c => {
          if (touched.has(c.id)) return;
          const inp = listEl.querySelector(`input[data-cid="${c.id}"]`);
          inp.value = (Math.round((contribution(c, total) + Number.EPSILON) * 100) / 100);
        });
      });

      ov.querySelector('#bw-mass-cancel').onclick = () => ov.remove();
      ov.querySelector('#bw-mass-save').onclick = async () => {
        const entries = [];
        listEl.querySelectorAll('input[data-cid]').forEach(inp => {
          const amount = parseFloat(inp.value);
          if (!isNaN(amount) && amount !== 0) entries.push({ category_id: inp.dataset.cid, amount });
        });
        if (!entries.length) { errEl.textContent = t('mass_add_failed'); errEl.style.display = 'block'; return; }
        try {
          await api('/mass-add', { method: 'POST', body: JSON.stringify({ entries }) });
          ov.remove();
          await refresh();
        } catch (e) { errEl.textContent = t('mass_add_failed'); errEl.style.display = 'block'; }
      };
    }

    async function openShare(cat) {
      const ov = overlay(`<div class="bw-dialog">
        <h3>${esc(t('share_title'))} — ${esc(cat.title)}</h3>
        <div class="bw-section-label">${esc(t('current_members'))}</div>
        <div id="bw-share-members"><div class="bw-empty">…</div></div>
        <div class="bw-section-label">${esc(t('add_from_favourites'))}</div>
        <div id="bw-share-favs"><div class="bw-empty">…</div></div>
        <div class="bw-error" id="bw-share-error" style="display:none"></div>
        <div class="bw-dialog-actions"><button class="bw-btn" id="bw-share-close">${esc(t('close'))}</button></div>
      </div>`);
      const shareErrEl = ov.querySelector('#bw-share-error');
      ov.querySelector('#bw-share-close').onclick = () => { ov.remove(); refresh(); };

      async function loadMembers() {
        const members = await api(`/categories/${cat.id}/members`);
        const el = ov.querySelector('#bw-share-members');
        el.innerHTML = members.map(m => `
          <div class="bw-member-row" data-uid="${esc(m.user_id)}">
            <span class="bw-member-name">${esc(m.display_name || m.username || m.user_id)}</span>
            <span class="bw-member-role">${esc(m.role === 'owner' ? t('owner') : '')}</span>
            ${m.role !== 'owner' ? `<button class="bw-btn-icon" data-action="remove-member">✕</button>` : ''}
          </div>`).join('');
        el.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('confirm_remove_member'))) return;
            const uid = btn.closest('.bw-member-row').dataset.uid;
            await api(`/categories/${cat.id}/members/${uid}`, { method: 'DELETE' });
            loadMembers();
          };
        });
        return members.map(m => m.user_id);
      }

      async function loadFavourites() {
        const memberIds = await loadMembers();
        const favs = await favApi('/favourites');
        const el = ov.querySelector('#bw-share-favs');
        const available = favs.filter(f => !memberIds.includes(f.id));
        if (!available.length) { el.innerHTML = `<div class="bw-empty">${esc(t('no_favourites'))}</div>`; return; }
        el.innerHTML = available.map(f => `
          <div class="bw-member-row" data-uid="${esc(f.id)}">
            <span class="bw-member-name">${esc(f.display_name || f.username)}</span>
            <button class="bw-btn" data-action="add-member">${esc(t('share'))}</button>
          </div>`).join('');
        el.querySelectorAll('[data-action="add-member"]').forEach(btn => {
          btn.onclick = async () => {
            const uid = btn.closest('.bw-member-row').dataset.uid;
            shareErrEl.style.display = 'none';
            try { await api(`/categories/${cat.id}/members`, { method: 'POST', body: JSON.stringify({ user_id: uid }) }); }
            catch (e) {
              shareErrEl.textContent = e.message === 'currency_mismatch' ? t('currency_mismatch_error') : t('save_failed');
              shareErrEl.style.display = 'block';
              return;
            }
            loadFavourites();
          };
        });
      }
      loadFavourites();
    }

    root.querySelector('#bw-add-cat').onclick = () => openCategoryForm(null);
    root.querySelector('#bw-mass-add').onclick = () => openMassAdd();
    root.querySelector('#bw-settings-btn').onclick = () => openSettingsModal();

    let currentView = 'categories';
    const menuWrap = root.querySelector('.bw-menu-wrap');
    root.querySelector('#bw-menu-btn').onclick = (e) => {
      e.stopPropagation();
      const existing = menuWrap.querySelector('.bw-menu-dropdown');
      if (existing) { existing.remove(); return; }
      const dd = document.createElement('div');
      dd.className = 'bw-menu-dropdown';
      dd.innerHTML = `
        <div class="bw-menu-item ${currentView === 'categories' ? 'active' : ''}" data-view="categories">📁 ${esc(t('categories'))}</div>
        <div class="bw-menu-item ${currentView === 'history' ? 'active' : ''}" data-view="history">🕘 ${esc(t('full_history'))}</div>
        <div class="bw-menu-item ${currentView === 'stats' ? 'active' : ''}" data-view="stats">📊 ${esc(t('stats'))}</div>
      `;
      dd.querySelector('[data-view="categories"]').onclick = () => { dd.remove(); currentView = 'categories'; showCategoriesView(); };
      dd.querySelector('[data-view="history"]').onclick = () => { dd.remove(); currentView = 'history'; showHistoryView(); };
      dd.querySelector('[data-view="stats"]').onclick = () => { dd.remove(); currentView = 'stats'; showStatsView(); };
      menuWrap.appendChild(dd);
      const closeOnOutside = (ev) => { if (!menuWrap.contains(ev.target)) { dd.remove(); document.removeEventListener('click', closeOnOutside); } };
      setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
    };

    loadMyCurrency().then(() => refresh()).then(() => {
      if (opts.openCategory) {
        const cat = categories.find(c => c.id === opts.openCategory);
        if (cat) openHistory(cat);
      }
    });

    return { destroy() { destroyed = true; } };
  }

  window.BudgetWidget = { mount };
})();
