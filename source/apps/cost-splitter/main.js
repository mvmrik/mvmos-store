// mvmOS App: Cost Splitter v1.0.0
const _csi18n = {
  en: {
    title: 'Cost Splitter',
    add_member: '+ Member', add_payment: '+ Payment', charge_all: '⚡ Charge All',
    members: 'Members', no_members: 'No members yet — add one to get started.',
    no_transactions: 'No transactions yet.',
    balance: 'Balance', monthly_cost: 'Monthly cost', per_member: 'Per member', total_members: 'Members',
    payments: 'Payments', charges: 'Charges', transactions: 'Transactions',
    name: 'Name', email: 'Email (for notifications)', amount: 'Amount', note: 'Note (optional)',
    cancel: 'Cancel', save: 'Save', add: 'Add', delete: 'Delete',
    edit_member: 'Edit Member', new_member: 'New Member',
    add_payment_title: 'Add Payment', charge_title: 'Monthly Charge',
    charge_confirm: 'Charge each member their share for this month?',
    delete_member_confirm: 'Delete this member and all their transactions?',
    delete_tx_confirm: 'Delete this transaction?',
    name_required: 'Name is required.',
    amount_required: 'Amount is required.',
    no_cost_set: 'Set a total monthly cost in Settings first.',
    charged: 'Monthly charge',
    settings_hint: '⚙ Configure total cost and email settings in App Settings.',
    custom_share: 'Custom share (leave empty for auto)',
    share: 'Share', auto: 'auto', mail_log: 'Email log',
    mail_sent: 'Sent', mail_failed: 'Failed', no_mail_log: 'No emails sent yet.',
    test_email: 'Test email', test_email_ok: 'Test email sent!', test_email_fail: 'Failed to send:',
  },
  bg: {
    title: 'Cost Splitter',
    add_member: '+ Член', add_payment: '+ Плащане', charge_all: '⚡ Начисли всички',
    members: 'Членове', no_members: 'Няма членове — добави първия.',
    no_transactions: 'Няма транзакции.',
    balance: 'Баланс', monthly_cost: 'Месечна цена', per_member: 'На човек', total_members: 'Членове',
    payments: 'Плащания', charges: 'Начисления', transactions: 'Транзакции',
    name: 'Име', email: 'Имейл (за известия)', amount: 'Сума', note: 'Бележка (незадължително)',
    cancel: 'Отказ', save: 'Запази', add: 'Добави', delete: 'Изтрий',
    edit_member: 'Редактирай член', new_member: 'Нов член',
    add_payment_title: 'Добави плащане', charge_title: 'Месечно начисление',
    charge_confirm: 'Начисли дела на всеки член за този месец?',
    delete_member_confirm: 'Изтрий този член и всичките му транзакции?',
    delete_tx_confirm: 'Изтрий тази транзакция?',
    name_required: 'Името е задължително.',
    amount_required: 'Сумата е задължителна.',
    no_cost_set: 'Настрой месечна цена в Настройките.',
    charged: 'Месечно начисление',
    custom_share: 'Персонален дял (остави празно за автоматично)',
    share: 'Дял', auto: 'авто', mail_log: 'Лог на имейли',
    mail_sent: 'Изпратен', mail_failed: 'Неуспешен', no_mail_log: 'Няма изпратени имейли.',
    settings_hint: '⚙ Настрой месечната цена и имейл настройките в App Settings.',
    test_email: 'Тест имейл', test_email_ok: 'Тест имейлът е изпратен!', test_email_fail: 'Грешка:',
  },
};
function _cst(key) { const lang = window.mvmOS?.lang || 'en'; return (_csi18n[lang] || _csi18n.en)[key] || key; }

// Fixed list — symbol-only display, never real FX conversion. Kept in sync
// manually with frontend/settings.js's own copy (this app can't import core JS).
const _csCurrencies = [
  { value: 'EUR', symbol: '€' }, { value: 'USD', symbol: '$' }, { value: 'GBP', symbol: '£' },
  { value: 'CHF', symbol: 'CHF' }, { value: 'JPY', symbol: '¥' }, { value: 'CNY', symbol: '¥' },
  { value: 'TRY', symbol: '₺' }, { value: 'UAH', symbol: '₴' }, { value: 'PLN', symbol: 'zł' },
  { value: 'RON', symbol: 'lei' }, { value: 'CZK', symbol: 'Kč' }, { value: 'HUF', symbol: 'Ft' },
  { value: 'CAD', symbol: '$' }, { value: 'AUD', symbol: '$' }, { value: 'SEK', symbol: 'kr' },
  { value: 'NOK', symbol: 'kr' }, { value: 'DKK', symbol: 'kr' }, { value: 'RUB', symbol: '₽' },
  { value: 'INR', symbol: '₹' },
];
function _csCurrencySymbol(code) {
  return (_csCurrencies.find(c => c.value === code) || {}).symbol || code || '€';
}

mvmOS.registerApp({
  id: 'cost-splitter',
  name: 'Cost Splitter',
  icon: '💸',
  category: 'Utilities',
  trayable: false,
  settings: [
    { key: 'currency', label: 'Currency', type: 'select', options: [
        {value:'',label:'System default'},
        {value:'EUR',label:'€ EUR'}, {value:'USD',label:'$ USD'}, {value:'GBP',label:'£ GBP'},
        {value:'CHF',label:'CHF'}, {value:'JPY',label:'¥ JPY'}, {value:'CNY',label:'¥ CNY'},
        {value:'TRY',label:'₺ TRY'}, {value:'UAH',label:'₴ UAH'}, {value:'PLN',label:'zł PLN'},
        {value:'RON',label:'lei RON'}, {value:'CZK',label:'Kč CZK'}, {value:'HUF',label:'Ft HUF'},
        {value:'CAD',label:'$ CAD'}, {value:'AUD',label:'$ AUD'}, {value:'SEK',label:'kr SEK'},
        {value:'NOK',label:'kr NOK'}, {value:'DKK',label:'kr DKK'}, {value:'RUB',label:'₽ RUB'},
        {value:'INR',label:'₹ INR'},
      ], default: '' },
    { key: 'total_cost',      label: 'Total monthly cost',           type: 'number',   default: 0, min: 0 },
    { key: 'mail_language',   label: 'Email language',               type: 'select',   options: [{value:'en',label:'English'},{value:'bg',label:'Български'}], default: 'en' },
    { key: 'mail_provider',   label: 'Email provider',               type: 'select',   options: [{value:'mailjet',label:'Mailjet'},{value:'brevo',label:'Brevo'}], default: 'mailjet' },
    { key: 'mail_api_key',    label: 'API Key',                      type: 'password', default: '' },
    { key: 'mail_api_secret', label: 'API Secret (Mailjet only)',    type: 'password', default: '' },
    { key: 'mail_from',       label: 'From email',                   type: 'text',     default: '' },
    { key: 'mail_subject',    label: 'Email subject',                type: 'text',     default: 'Monthly cost summary' },
    { key: 'sched_day',    label: 'Send on day of month (1-28)', type: 'number', default: 1, min: 1, max: 28 },
    { key: 'sched_hour',   label: 'Send at hour (0-23)',         type: 'number', default: 9, min: 0, max: 23 },
    { key: 'sched_minute', label: 'Send at minute (0-59)',       type: 'number', default: 0, min: 0, max: 59 },
  ],
  async renderSettingsExtra(wrap, saved) {
    const val = saved.mail_body || 'Hi {name}, your share of {share} has been charged. Previous balance: {old_balance}, current balance: {new_balance}.';
    const chk = (key, def=true) => saved[key] !== undefined ? saved[key] : def;
    wrap.innerHTML = `
      <div style="border-top:1px solid var(--border);margin-top:8px;padding-top:12px;display:flex;flex-direction:column;gap:8px">
        <label style="font-size:.8rem;color:var(--text-dim)">Email body</label>
        <textarea id="cs-mail-body" rows="3" style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;resize:vertical;box-sizing:border-box;font-family:inherit">${val}</textarea>
        <div style="font-size:.72rem;color:var(--text-dim);line-height:1.5">
          Variables: <code>{name}</code> &nbsp;·&nbsp; <code>{share}</code> &nbsp;·&nbsp;
          <code>{old_balance}</code> &nbsp;·&nbsp; <code>{new_balance}</code> &nbsp;·&nbsp; <code>{charged}</code>
        </div>
        <label style="font-size:.8rem;color:var(--text-dim);margin-top:4px">Charge note <span style="opacity:.6">(shown in transaction history — leave empty for none)</span></label>
        <input id="cs-charge-note" type="text" placeholder="e.g. Monthly rent, Utilities…" value="${saved.charge_note || ''}" style="width:100%;padding:6px 8px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);font-size:.8rem;box-sizing:border-box">
        <div style="border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:.8rem;color:var(--text-dim);margin-bottom:6px">Show in email summary table:</div>
          <div style="display:flex;flex-direction:column;gap:4px;font-size:.85rem">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-show-total"    ${chk('show_total')    ? 'checked' : ''}> Total amount</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-show-prev"     ${chk('show_prev')     ? 'checked' : ''}> Previous balance</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-show-share"    ${chk('show_share')    ? 'checked' : ''}> Amount due</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-show-balance"  ${chk('show_balance')  ? 'checked' : ''}> Current balance</label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="cs-show-history"  ${chk('show_history')  ? 'checked' : ''}> Transaction history</label>
          </div>
        </div>
      </div>
    `;
  },
  async saveSettingsExtra(panel) {
    const db = mvmOS.db('cost-splitter');
    await db.run('CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)');
    const ta = panel.querySelector('#cs-mail-body');
    if (ta) await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['mail_body', JSON.stringify(ta.value)]);
    const cn = panel.querySelector('#cs-charge-note');
    if (cn) await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', ['charge_note', JSON.stringify(cn.value.trim())]);
    for (const key of ['show_total','show_prev','show_share','show_balance','show_history']) {
      const el = panel.querySelector(`#cs-${key.replace('_','-')}`);
      if (el) await db.run('INSERT OR REPLACE INTO cfg (key,value) VALUES (?,?)', [key, JSON.stringify(el.checked)]);
    }
  },
  launch() {
    mvmOS.createWindow({
      id: 'cost-splitter',
      title: '💸 ' + _cst('title'),
      icon: '💸',
      width: 820,
      height: 560,
      appSettings: true,
      onAppSettings() { AppStore.openWindow({ section: 'my-apps', appId: 'cost-splitter' }); },
      onMount(body) {
        body.style.padding = '0';
        body.style.overflow = 'hidden';
        (window.mvmOS?.i18nReady || Promise.resolve()).then(() => CS.mount(body));
      },
    });
  },
});

const CS = (() => {
  const _db = mvmOS.db('cost-splitter');
  let _root = null;
  let _members = [];
  let _selectedId = null;
  let _cfg = {};

  async function _loadCfg() {
    const rows = await _db.query('SELECT key, value FROM cfg');
    const saved = {};
    rows.forEach(r => { try { saved[r.key] = JSON.parse(r.value); } catch(_) { saved[r.key] = r.value; } });
    _cfg = {
      currency:        saved.currency || (window._vosSettings?.currency || 'EUR'),
      total_cost:      parseFloat(saved.total_cost) || 0,
      mail_provider:   saved.mail_provider || 'mailjet',
      mail_api_key:    saved.mail_api_key || '',
      mail_api_secret: saved.mail_api_secret || '',
      mail_from:       saved.mail_from || '',
      mail_language:   saved.mail_language || 'en',
      mail_subject:    saved.mail_subject || 'Monthly cost summary',
      mail_body:       saved.mail_body || 'Hi {name}, your monthly share of {share} has been charged. Previous balance: {old_balance}, current balance: {new_balance}.',
      charge_note:     saved.charge_note ?? '',
      sched_minute:    parseInt(saved.sched_minute) || 0,
      sched_day:       parseInt(saved.sched_day) || 1,
      sched_hour:      parseInt(saved.sched_hour) || 9,
    };
  }

  function _fmt(amount) {
    const val = Math.abs(amount).toFixed(2);
    return val + ' ' + _csCurrencySymbol(_cfg.currency);
  }

  function _fmtSigned(amount) {
    const sign = amount >= 0 ? '+' : '-';
    return sign + _fmt(Math.abs(amount));
  }

  async function _loadMembers() {
    _members = await _db.query('SELECT * FROM members ORDER BY name');
    for (const m of _members) {
      const rows = await _db.query('SELECT COALESCE(SUM(amount),0) as bal FROM transactions WHERE member_id=?', [m.id]);
      m.balance = rows[0]?.bal ?? 0;
    }
    // calculate effective share for each member
    const customTotal = _members.reduce((s, m) => s + (m.custom_share != null ? m.custom_share : 0), 0);
    const autoMembers = _members.filter(m => m.custom_share == null);
    const remaining = Math.max(0, _cfg.total_cost - customTotal);
    const autoShare = autoMembers.length > 0 ? remaining / autoMembers.length : 0;
    for (const m of _members) {
      m.effective_share = m.custom_share != null ? m.custom_share : autoShare;
    }
  }

  async function mount(body) {
    _root = body;
    await _initDb();
    await _loadCfg();
    await _loadMembers();
    _render();
    window.mvmOS?.onLangChange(() => _render());
    window.addEventListener('settings-changed', async e => {
      if (e.detail?.app === 'cost-splitter') {
        await _loadCfg();
        await _loadMembers();
        _render();
      }
    });
  }

  async function _initDb() {
    await _db.run(`CREATE TABLE IF NOT EXISTS members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT DEFAULT '', created_at TEXT)`);
    await _db.run(`CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, member_id INTEGER, amount REAL, note TEXT DEFAULT '', created_at TEXT)`);
  }

  function _render() {
    if (!_root) return;
    const memberCount = _members.length;
    const perMember = memberCount > 0 && _cfg.total_cost > 0 ? _cfg.total_cost / memberCount : 0;

    _root.innerHTML = `
      <div class="cs-root">
        <div class="cs-toolbar">
          <h2>💸 ${_cst('title')}</h2>
          <button class="s-btn s-btn-sm" id="cs-add-member">${_cst('add_member')}</button>
          ${_selectedId ? `<button class="s-btn s-btn-sm" id="cs-add-payment">${_cst('add_payment')}</button>` : ''}
          ${memberCount > 0 ? `<button class="s-btn s-btn-sm" id="cs-charge-all">${_cst('charge_all')}</button>` : ''}
        </div>
        <div class="cs-body">
          <div class="cs-sidebar as-sidebar" id="cs-sidebar"></div>
          <div class="cs-main" id="cs-main"></div>
        </div>
        <div class="cs-statusbar">
          <span>${_cst('total_members')}: <strong>${memberCount}</strong></span>
          <span>${_cst('monthly_cost')}: <strong>${_fmt(_cfg.total_cost)}</strong></span>
          ${perMember > 0 ? `<span>${_cst('per_member')}: <strong>${_fmt(perMember)}</strong></span>` : ''}
          ${!_cfg.total_cost ? `<span style="color:var(--accent)">${_cst('settings_hint')}</span>` : ''}
        </div>
      </div>
    `;

    _renderSidebar();
    _renderMain();
    _bindToolbar();
    mvmOS.initMobileSidebar(_root);
  }

  function _renderSidebar() {
    const sidebar = _root.querySelector('#cs-sidebar');
    if (!_members.length) {
      sidebar.innerHTML = `<div style="padding:16px;font-size:.78rem;color:var(--text-dim)">${_cst('no_members')}</div>`;
      return;
    }
    sidebar.innerHTML = _members.map(m => {
      const balClass = m.balance > 0 ? 'pos' : m.balance < 0 ? 'neg' : '';
      const shareLabel = m.custom_share != null ? _fmt(m.custom_share) : _cst('auto');
      return `
        <div class="cs-member-item ${_selectedId === m.id ? 'active' : ''}" data-id="${m.id}">
          <div style="flex:1;overflow:hidden">
            <div class="cs-member-name">${_esc(m.name)}</div>
            <div style="font-size:.68rem;opacity:.7">${_cst('share')}: ${shareLabel}</div>
          </div>
          <span class="cs-balance ${balClass}">${_fmtSigned(m.balance)}</span>
        </div>
      `;
    }).join('');
    sidebar.querySelectorAll('.cs-member-item').forEach(el => {
      el.addEventListener('click', () => {
        _selectedId = parseInt(el.dataset.id);
        _render();
      });
    });
  }

  function _renderMain() {
    const main = _root.querySelector('#cs-main');
    const member = _members.find(m => m.id === _selectedId);
    if (!member) {
      main.innerHTML = `<div class="cs-empty">${_members.length ? '← ' + _cst('members') : _cst('no_members')}</div>`;
      return;
    }
    const memberCount = _members.length;
    const perMember = memberCount > 0 && _cfg.total_cost > 0 ? _cfg.total_cost / memberCount : 0;
    const balClass = member.balance > 0 ? 'pos' : member.balance < 0 ? 'neg' : '';

    const shareLabel = member.custom_share != null
      ? `${_fmt(member.custom_share)} ★`
      : `${_fmt(member.effective_share)} (${_cst('auto')})`;

    main.innerHTML = `
      <div class="cs-overview">
        <div class="cs-card">
          <div class="cs-card-label">${_cst('balance')}</div>
          <div class="cs-card-val ${balClass}">${_fmtSigned(member.balance)}</div>
        </div>
        <div class="cs-card">
          <div class="cs-card-label">${_cst('share')}</div>
          <div class="cs-card-val" style="font-size:.85rem">${shareLabel}</div>
        </div>
        ${member.email ? `<div class="cs-card">
          <div class="cs-card-label">Email</div>
          <div class="cs-card-val" style="font-size:.75rem;font-weight:400">${_esc(member.email)}</div>
        </div>` : ''}
      </div>

      <div class="cs-section-title">
        ${_cst('transactions')}
        <button class="s-btn s-btn-sm" id="cs-edit-member">✏️</button>
        ${member.email ? `<button class="s-btn s-btn-sm" id="cs-test-email">✉️ ${_cst('test_email')}</button>` : ''}
        <button class="s-btn s-btn-sm s-btn-danger" id="cs-del-member" style="margin-left:auto">✕</button>
      </div>
      <div class="cs-tx-list" id="cs-tx-list">
        <div style="color:var(--text-dim);font-size:.78rem">${_cst('no_transactions')}</div>
      </div>

      <div class="cs-section-title" style="margin-top:12px">${_cst('mail_log')}</div>
      <div class="cs-tx-list" id="cs-mail-log">
        <div style="color:var(--text-dim);font-size:.78rem">${_cst('no_mail_log')}</div>
      </div>
    `;

    _loadTransactions(member);
    _loadMailLog(member);

    main.querySelector('#cs-edit-member').addEventListener('click', () => _showMemberForm(member));
    main.querySelector('#cs-del-member').addEventListener('click', () => _deleteMember(member));
    main.querySelector('#cs-test-email')?.addEventListener('click', async () => {
      const btn = main.querySelector('#cs-test-email');
      btn.disabled = true; btn.textContent = '⏳...';
      const res = await fetch('/api/apps/cost-splitter/test-email', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ member_id: member.id }),
      });
      btn.disabled = false; btn.textContent = '✉️ ' + _cst('test_email');
      if (res.ok) mvmOS.notify('Cost Splitter', _cst('test_email_ok'));
      else { const err = await res.json().catch(() => ({})); mvmOS.notify('Cost Splitter', _cst('test_email_fail') + ' ' + (err.detail || '')); }
    });
  }

  async function _loadTransactions(member) {
    const rows = await _db.query('SELECT * FROM transactions WHERE member_id=? ORDER BY created_at DESC', [member.id]);
    const list = _root.querySelector('#cs-tx-list');
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = `<div class="cs-empty">${_cst('no_transactions')}</div>`;
      return;
    }
    list.innerHTML = rows.map(tx => {
      const amtClass = tx.amount >= 0 ? 'pos' : 'neg';
      const date = tx.created_at ? tx.created_at.slice(0, 10) : '';
      return `
        <div class="cs-tx-row" data-txid="${tx.id}">
          <span class="cs-tx-date">${date}</span>
          <span class="cs-tx-note">${_esc(tx.note || '')}</span>
          <span class="cs-tx-amount ${amtClass}">${_fmtSigned(tx.amount)}</span>
          <button class="cs-tx-del" data-txid="${tx.id}" title="${_cst('delete')}">✕</button>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.cs-tx-del').forEach(btn => {
      btn.addEventListener('click', () => _deleteTransaction(parseInt(btn.dataset.txid), member));
    });
  }

  async function _loadMailLog(member) {
    const rows = await _db.query('SELECT * FROM mail_log WHERE member_id=? ORDER BY sent_at DESC LIMIT 20', [member.id]);
    const el = _root.querySelector('#cs-mail-log');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="cs-empty">${_cst('no_mail_log')}</div>`;
      return;
    }
    el.innerHTML = rows.map(r => {
      const ok = r.status === 'success';
      return `<div class="cs-tx-row">
        <span class="cs-tx-date">${(r.sent_at || '').slice(0, 16).replace('T', ' ')}</span>
        <span class="cs-tx-note">${r.error || ''}</span>
        <span class="cs-tx-amount ${ok ? 'pos' : 'neg'}">${ok ? '✓ ' + _cst('mail_sent') : '✗ ' + _cst('mail_failed')}</span>
      </div>`;
    }).join('');
  }

  function _bindToolbar() {
    _root.querySelector('#cs-add-member')?.addEventListener('click', () => _showMemberForm(null));
    _root.querySelector('#cs-add-payment')?.addEventListener('click', () => _showPaymentForm());
    _root.querySelector('#cs-charge-all')?.addEventListener('click', () => _chargeAll());
  }

  function _showMemberForm(member) {
    const isEdit = !!member;
    const customVal = isEdit && member.custom_share != null ? member.custom_share : '';
    const ov = _overlay(`
      <h3>${isEdit ? _cst('edit_member') : _cst('new_member')}</h3>
      <div><label>${_cst('name')}</label><input id="cs-f-name" value="${isEdit ? _esc(member.name) : ''}"></div>
      <div><label>${_cst('email')}</label><input id="cs-f-email" type="email" value="${isEdit ? _esc(member.email || '') : ''}"></div>
      <div><label>${_cst('custom_share')}</label><input id="cs-f-share" type="number" step="0.01" min="0" value="${customVal}" placeholder="${_cst('auto')}"></div>
      <div id="cs-f-err" style="color:#f38ba8;font-size:.75rem;display:none"></div>
      <div class="cs-dialog-btns">
        <button class="s-btn s-btn-sm" id="cs-f-cancel">${_cst('cancel')}</button>
        <button class="s-btn" id="cs-f-save">${isEdit ? _cst('save') : _cst('add')}</button>
      </div>
    `);
    ov.querySelector('#cs-f-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#cs-f-save').addEventListener('click', async () => {
      const name = ov.querySelector('#cs-f-name').value.trim();
      const email = ov.querySelector('#cs-f-email').value.trim();
      const shareRaw = ov.querySelector('#cs-f-share').value.trim();
      const customShare = shareRaw !== '' ? parseFloat(shareRaw) : null;
      const err = ov.querySelector('#cs-f-err');
      if (!name) { err.textContent = _cst('name_required'); err.style.display = ''; return; }
      if (isEdit) {
        await _db.run('UPDATE members SET name=?, email=?, custom_share=? WHERE id=?', [name, email, customShare, member.id]);
      } else {
        await _db.run('INSERT INTO members (name, email, custom_share, created_at) VALUES (?,?,?,?)', [name, email, customShare, new Date().toISOString()]);
      }
      ov.remove();
      await _loadMembers();
      if (!isEdit) _selectedId = _members[_members.length - 1]?.id ?? null;
      _render();
    });
  }

  function _showPaymentForm() {
    const member = _members.find(m => m.id === _selectedId);
    if (!member) return;
    const ov = _overlay(`
      <h3>${_cst('add_payment_title')} — ${_esc(member.name)}</h3>
      <div><label>${_cst('amount')}</label><input id="cs-p-amount" type="number" step="0.01" placeholder="0.00"></div>
      <div><label>${_cst('note')}</label><input id="cs-p-note" type="text"></div>
      <div id="cs-p-err" style="color:#f38ba8;font-size:.75rem;display:none"></div>
      <div class="cs-dialog-btns">
        <button class="s-btn s-btn-sm" id="cs-p-cancel">${_cst('cancel')}</button>
        <button class="s-btn" id="cs-p-save">${_cst('add')}</button>
      </div>
    `);
    ov.querySelector('#cs-p-cancel').addEventListener('click', () => ov.remove());
    ov.querySelector('#cs-p-save').addEventListener('click', async () => {
      const amount = parseFloat(ov.querySelector('#cs-p-amount').value);
      const note = ov.querySelector('#cs-p-note').value.trim();
      const err = ov.querySelector('#cs-p-err');
      if (!amount || isNaN(amount)) { err.textContent = _cst('amount_required'); err.style.display = ''; return; }
      await _db.run('INSERT INTO transactions (member_id, amount, note, created_at) VALUES (?,?,?,?)',
        [_selectedId, amount, note, new Date().toISOString()]);
      ov.remove();
      await _loadMembers();
      _render();
    });
  }

  async function _chargeAll() {
    if (!_cfg.total_cost) { mvmOS.notify('Cost Splitter', _cst('no_cost_set')); return; }
    if (!await mvmOS.confirm(_cst('charge_confirm'))) return;
    const now = new Date().toISOString();
    for (const m of _members) {
      await _db.run('INSERT INTO transactions (member_id, amount, note, created_at) VALUES (?,?,?,?)',
        [m.id, -m.effective_share, _cfg.charge_note || null, now]);
    }
    await _loadMembers();
    _render();
  }

  async function _deleteMember(member) {
    if (!await mvmOS.confirm(_cst('delete_member_confirm'))) return;
    await _db.run('DELETE FROM transactions WHERE member_id=?', [member.id]);
    await _db.run('DELETE FROM members WHERE id=?', [member.id]);
    _selectedId = null;
    await _loadMembers();
    _render();
  }

  async function _deleteTransaction(txId, member) {
    if (!await mvmOS.confirm(_cst('delete_tx_confirm'))) return;
    await _db.run('DELETE FROM transactions WHERE id=?', [txId]);
    await _loadMembers();
    _render();
  }

  function _overlay(html) {
    const ov = document.createElement('div');
    ov.className = 'cs-dialog-overlay';
    ov.innerHTML = `<div class="cs-dialog">${html}</div>`;
    _root.querySelector('.cs-root').appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    setTimeout(() => ov.querySelector('input')?.focus(), 50);
    return ov;
  }

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  return { mount };
})();
