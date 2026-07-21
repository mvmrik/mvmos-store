// Shopping List — shared widget used by both the desktop app window and the
// standalone Apps Hub public page (same three-file pattern as
// apps/tasks/tasks-widget.js / apps/budget/budget-widget.js).
(function () {
  if (window.ShoppingListWidget) return;

  const API = '/pub/shoppinglist';

  function t(key, vars) { return (window.t || (k => k))(key, vars); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const CURRENCY_SYMBOLS = {
    EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥', CNY: '¥', TRY: '₺',
    UAH: '₴', PLN: 'zł', RON: 'lei', CZK: 'Kč', HUF: 'Ft', CAD: '$', AUD: '$',
    SEK: 'kr', NOK: 'kr', DKK: 'kr', RUB: '₽', INR: '₹',
  };
  function currencySymbol(code) {
    return CURRENCY_SYMBOLS[code] || code || '';
  }
  function fmtQty(n) {
    n = Number(n) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  function pad2(n) { return String(n).padStart(2, '0'); }

  // mvmOS lets each user pick a date format in Settings (DD/MM/YYYY,
  // MM/DD/YYYY, YYYY-MM-DD) — same pattern as apps/calendar/calendar-widget.js.
  // toLocaleDateString() would use the browser's own locale instead, which
  // doesn't track that setting, so this loads/caches it via the same
  // no-session-auth endpoint calendar uses.
  let _dateFmt = 'DD/MM/YYYY';
  async function loadDateFormat() {
    if (window._vosSettings && window._vosSettings.date_format) {
      _dateFmt = window._vosSettings.date_format;
      return;
    }
    try {
      const r = await fetch('/api/settings/display');
      if (r.ok) { const s = await r.json(); _dateFmt = s.date_format || 'DD/MM/YYYY'; }
    } catch (e) {}
  }
  function fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const dd = pad2(d.getDate()), mm = pad2(d.getMonth() + 1), yyyy = d.getFullYear();
      if (_dateFmt === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
      if (_dateFmt === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
      return `${dd}/${mm}/${yyyy}`;
    } catch (e) { return iso; }
  }
  // Segmented D/M/Y number-input triplet, ordered per _dateFmt — same
  // reasoning as calendar-widget.js's makeDateInput: a native
  // <input type=date> renders in the browser's locale format, not ours.
  function makeDateInput(initialDateOnly) {
    const wrap = document.createElement('div');
    wrap.className = 'sl-date-input';
    const dInput = document.createElement('input');
    dInput.type = 'number'; dInput.min = '1'; dInput.max = '31'; dInput.placeholder = 'DD';
    const mInput = document.createElement('input');
    mInput.type = 'number'; mInput.min = '1'; mInput.max = '12'; mInput.placeholder = 'MM';
    const yInput = document.createElement('input');
    yInput.type = 'number'; yInput.min = '1970'; yInput.max = '9999'; yInput.placeholder = 'YYYY';
    yInput.style.width = '64px';

    const sep = _dateFmt === 'YYYY-MM-DD' ? '-' : '/';
    const order = _dateFmt === 'MM/DD/YYYY' ? [mInput, dInput, yInput]
      : _dateFmt === 'YYYY-MM-DD' ? [yInput, mInput, dInput]
      : [dInput, mInput, yInput];
    order.forEach((el, i) => {
      wrap.appendChild(el);
      if (i < order.length - 1) wrap.appendChild(document.createTextNode(sep));
    });

    function setValue(dateOnly) {
      if (!dateOnly) { dInput.value = ''; mInput.value = ''; yInput.value = ''; return; }
      const [y, m, d] = dateOnly.split('-').map(Number);
      dInput.value = d; mInput.value = m; yInput.value = y;
    }
    setValue(initialDateOnly);

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
    return wrap;
  }
  function warrantyClass(w) {
    if (w.expired) return 'sl-warranty-expired';
    if (w.remaining_days <= 60) return 'sl-warranty-warn';
    return '';
  }
  function fmtRemaining(w) {
    if (w.expired) return t('sl_warranty_expired');
    const days = w.remaining_days;
    if (days < 60) return t('sl_warranty_days_left', { days });
    const years = Math.floor(days / 365);
    const months = Math.round((days % 365) / 30);
    if (years > 0) return t('sl_warranty_years_months_left', { years, months });
    return t('sl_warranty_months_left', { months: Math.max(1, months) });
  }
  function renderWarrantyBar(w) {
    const cls = warrantyClass(w);
    const pct = w.expired ? 100 : w.progress_pct;
    return `<div class="sl-warranty-line">
      <div class="sl-warranty-progress"><div class="sl-warranty-progress-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="sl-warranty-remaining ${cls}">🛡️ ${esc(fmtRemaining(w))}</span>
    </div>`;
  }

  let _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .sl-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg, #1e1e2e);color:var(--pub-fg, #cdd6f4);
        font-family:system-ui,sans-serif;font-size:.85rem;overflow:hidden}
      .sl-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2, #a6adc8);
        font-family:system-ui,sans-serif;font-size:.9rem;text-align:center;padding:20px}
      .sl-toolbar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0;flex-wrap:wrap}
      .sl-toolbar h2{margin:0;font-size:1rem;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sl-btn{background:var(--pub-surface2, #313244);color:var(--pub-fg, #cdd6f4);border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:.82rem;white-space:nowrap}
      .sl-btn:hover{background:var(--pub-border, #45475a)}
      .sl-btn-primary{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);font-weight:600}
      .sl-btn-primary:hover{background:var(--pub-accent-hover, #a6c8ff)}
      .sl-btn-icon{background:none;border:none;color:var(--pub-fg2, #a6adc8);cursor:pointer;font-size:.9rem;padding:4px 6px;border-radius:4px}
      .sl-btn-icon:hover{background:var(--pub-border, #45475a);color:var(--pub-fg, #cdd6f4)}
      .sl-body{flex:1;overflow-y:auto;padding:14px}
      .sl-empty{color:var(--pub-dim, #6c7086);text-align:center;padding:40px 16px}
      .sl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
      .sl-card{background:var(--pub-surface2, #313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px;cursor:pointer}
      .sl-card:hover{background:var(--pub-border, #45475a)}
      .sl-card-head{display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap}
      .sl-card-title{font-weight:700;font-size:.95rem;word-break:break-word;flex:1;min-width:0}
      .sl-card-actions{display:flex;gap:2px;flex-wrap:wrap}
      .sl-badges{display:flex;gap:6px;flex-wrap:wrap}
      .sl-badge{font-size:.7rem;padding:2px 8px;border-radius:10px;background:var(--pub-border, #45475a);color:var(--pub-fg2, #a6adc8);white-space:nowrap}
      .sl-item-list{display:flex;flex-direction:column;gap:6px}
      .sl-item-row{display:flex;align-items:center;gap:10px;background:var(--pub-surface2, #313244);border-radius:8px;padding:8px 10px;flex-wrap:wrap}
      .sl-item-row.sl-item-bought{opacity:.55}
      .sl-item-row.sl-item-bought .sl-item-name{text-decoration:line-through}
      .sl-item-check{width:18px;height:18px;flex-shrink:0}
      .sl-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .sl-item-name{font-weight:600;font-size:.88rem;word-break:break-word}
      .sl-item-meta{font-size:.74rem;color:var(--pub-fg2, #a6adc8);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .sl-item-actions{display:flex;gap:2px;flex-shrink:0}
      .sl-total-row{margin-top:10px;padding-top:10px;border-top:1px solid var(--pub-border, #45475a);
        display:flex;flex-direction:column;gap:2px;align-items:flex-end;text-align:right;font-size:.85rem;color:var(--pub-fg2, #a6adc8)}
      .sl-total-row div:first-child{font-size:.92rem;color:var(--pub-fg, #cdd6f4)}
      .sl-overlay{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
      .sl-dialog{background:var(--pub-bg, #1e1e2e);border-radius:10px;padding:18px;width:100%;max-width:440px;max-height:88%;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
      .sl-dialog h3{margin:0 0 4px}
      .sl-field label{display:block;font-size:.78rem;color:var(--pub-fg2, #a6adc8);margin-bottom:4px}
      .sl-field-row{display:flex;gap:8px;flex-wrap:wrap}
      .sl-field-row .sl-field{flex:1;min-width:120px}
      .sl-field input[type=text],.sl-field input[type=number],.sl-field select{
        width:100%;box-sizing:border-box;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);border-radius:6px;
        color:var(--pub-fg, #cdd6f4);padding:7px 9px;font-family:inherit;font-size:.85rem}
      .sl-error{color:var(--pub-red, #f38ba8);font-size:.78rem}
      .sl-toggle-row{display:flex;align-items:center;gap:8px}
      .sl-toggle-row input{width:16px;height:16px;flex-shrink:0}
      .sl-field-hint{font-size:.76rem;color:var(--pub-dim, #6c7086)}
      .sl-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}
      .sl-section-label{font-size:.78rem;color:var(--pub-fg2, #a6adc8);font-weight:600;margin-top:4px}
      .sl-member-row{display:flex;align-items:center;gap:8px;padding:5px 0}
      .sl-member-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .sl-member-role{font-size:.72rem;color:var(--pub-dim, #6c7086)}
      .sl-toast{position:absolute;left:50%;top:12px;transform:translateX(-50%);background:var(--pub-surface2, #313244);
        border:1px solid var(--pub-border, #45475a);border-radius:8px;padding:8px 14px;font-size:.82rem;z-index:80;
        box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;transition:opacity .2s}
      .sl-toast.show{opacity:1}
      .sl-toast-good{border-color:var(--pub-green, #a6e3a1)}
      .sl-toast-bad{border-color:var(--pub-red, #f38ba8)}
      .sl-warranty-line{display:flex;align-items:center;gap:6px;margin-top:2px}
      .sl-warranty-progress{flex:1;height:6px;border-radius:3px;background:var(--pub-border, #45475a);overflow:hidden;min-width:50px}
      .sl-warranty-progress-fill{height:100%;background:var(--pub-green, #a6e3a1);transition:width .2s}
      .sl-warranty-progress-fill.sl-warranty-warn{background:var(--pub-yellow, #f9e2af)}
      .sl-warranty-progress-fill.sl-warranty-expired{background:var(--pub-red, #f38ba8)}
      .sl-warranty-remaining{font-size:.72rem;color:var(--pub-fg2, #a6adc8);white-space:nowrap}
      .sl-warranty-remaining.sl-warranty-warn{color:var(--pub-yellow, #f9e2af)}
      .sl-warranty-remaining.sl-warranty-expired{color:var(--pub-red, #f38ba8)}
      .sl-warranty-info{display:flex;flex-direction:column;gap:4px;font-size:.82rem;color:var(--pub-fg2, #a6adc8)}
      .sl-warranty-photos{display:flex;flex-wrap:wrap;gap:8px}
      .sl-warranty-photo{position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;flex-shrink:0}
      .sl-warranty-photo img{width:100%;height:100%;object-fit:cover;display:block;cursor:pointer}
      .sl-warranty-photo button{position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;
        border-radius:50%;width:18px;height:18px;font-size:.68rem;cursor:pointer;line-height:1;padding:0}
      .sl-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;
        z-index:10000;cursor:zoom-out;padding:24px;box-sizing:border-box}
      .sl-lightbox img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px}
      .sl-warranty-photo-add{display:flex;align-items:center;justify-content:center;background:var(--pub-surface2, #313244);
        border:1px dashed var(--pub-border, #45475a);border-radius:6px;cursor:pointer;font-size:1.3rem;color:var(--pub-fg2, #a6adc8)}
      .sl-warranty-overview-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pub-border, #45475a);cursor:pointer}
      .sl-warranty-overview-row:last-child{border-bottom:none}
      .sl-warranty-overview-main{flex:1;min-width:0}
      .sl-warranty-overview-name{font-weight:600;font-size:.88rem;word-break:break-word}
      .sl-warranty-overview-list{font-size:.72rem;color:var(--pub-dim, #6c7086);margin-bottom:3px}
      .sl-date-input{display:flex;align-items:center;gap:4px}
      .sl-date-input input{width:38px;box-sizing:border-box;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);
        border-radius:6px;color:var(--pub-fg, #cdd6f4);padding:6px 4px;font-size:.85rem;font-family:inherit;text-align:center;-moz-appearance:textfield}
      .sl-date-input input::-webkit-inner-spin-button,.sl-date-input input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
      @media (max-width:520px){
        .sl-grid{grid-template-columns:1fr}
        .sl-toolbar{flex-wrap:wrap}
        .sl-toolbar h2{flex:1 1 100%}
        .sl-dialog{max-width:100%}
      }
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    if (!token) {
      root.innerHTML = `<div class="sl-login">${esc(t('sl_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    let destroyed = false;
    let lists = [];
    let items = [];
    let currentList = null;
    let settings = { budget_integration: false };
    let budgetCategories = { available: false, categories: [], currency: null };
    let lastCategoryId = null;

    function fmtMoney(n) {
      n = Number(n) || 0;
      const s = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
      return budgetCategories.currency ? s + ' ' + currencySymbol(budgetCategories.currency) : s;
    }

    root.style.position = 'relative';
    root.innerHTML = `<div class="sl-widget">
      <div class="sl-toolbar" id="sl-toolbar-main">
        <h2>🛒 ${esc(t('sl_title'))}</h2>
        <button class="sl-btn-icon" id="sl-settings-btn" title="${esc(t('sl_settings'))}">⚙</button>
        <button class="sl-btn-icon" id="sl-warranties-btn" title="${esc(t('sl_warranties'))}">🛡️</button>
        <button class="sl-btn-icon" id="sl-history-btn" title="${esc(t('sl_history'))}">🕓</button>
        <button class="sl-btn sl-btn-primary" id="sl-add-list-btn">${esc(t('sl_add_list'))}</button>
      </div>
      <div class="sl-toolbar" id="sl-toolbar-items" style="display:none">
        <button class="sl-btn-icon" id="sl-back-btn">←</button>
        <h2 id="sl-items-title"></h2>
        <button class="sl-btn-icon" id="sl-share-btn" title="${esc(t('sl_share'))}">👥</button>
        <button class="sl-btn sl-btn-primary" id="sl-add-item-btn">${esc(t('sl_add_item'))}</button>
      </div>
      <div class="sl-body">
        <div class="sl-grid" id="sl-lists-grid"></div>
        <div id="sl-items-view" style="display:none"></div>
      </div>
    </div>`;
    const widgetEl = root.querySelector('.sl-widget');
    const toolbarMain = root.querySelector('#sl-toolbar-main');
    const toolbarItems = root.querySelector('#sl-toolbar-items');
    const listsGridEl = root.querySelector('#sl-lists-grid');
    const itemsViewEl = root.querySelector('#sl-items-view');
    const itemsTitleEl = root.querySelector('#sl-items-title');
    const shareBtn = root.querySelector('#sl-share-btn');
    const addListBtn = root.querySelector('#sl-add-list-btn');
    const settingsBtn = root.querySelector('#sl-settings-btn');
    const warrantiesBtn = root.querySelector('#sl-warranties-btn');
    const historyBtn = root.querySelector('#sl-history-btn');
    const addItemBtn = root.querySelector('#sl-add-item-btn');
    const backBtn = root.querySelector('#sl-back-btn');

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('http_' + r.status));
        return data;
      });
    }
    async function favApi(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      const r = await fetch('/api/pub/apphub' + path, Object.assign({}, o, { headers }));
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('http_' + r.status));
      return data;
    }

    function overlay(contentHtml) {
      const ov = document.createElement('div');
      ov.className = 'sl-overlay';
      ov.innerHTML = contentHtml;
      widgetEl.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
      return ov;
    }

    function toast(msg, kind) {
      const el = document.createElement('div');
      el.className = 'sl-toast' + (kind === 'good' ? ' sl-toast-good' : kind === 'bad' ? ' sl-toast-bad' : '');
      el.textContent = msg;
      widgetEl.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); }, 2600);
    }

    function categoryTitle(id) {
      const c = budgetCategories.categories.find(x => x.id === id);
      return c ? c.title : null;
    }

    // ── Lists view ─────────────────────────────────────────────

    function renderListCard(l) {
      return `<div class="sl-card" data-id="${esc(l.id)}">
        <div class="sl-card-head">
          <div class="sl-card-title">${esc(l.title)}</div>
          ${l.role === 'owner' ? `<div class="sl-card-actions">
            <button class="sl-btn-icon" data-action="share" title="${esc(t('sl_share'))}">👥</button>
            <button class="sl-btn-icon" data-action="edit" title="${esc(t('sl_edit'))}">✎</button>
            <button class="sl-btn-icon" data-action="delete" title="${esc(t('sl_delete'))}">🗑</button>
          </div>` : ''}
        </div>
        <div class="sl-badges">
          <span class="sl-badge">${esc(t('sl_items_progress', { bought: l.bought_count, total: l.item_count }))}</span>
          ${l.member_count > 1 ? `<span class="sl-badge">👥 ${l.member_count}</span>` : ''}
        </div>
      </div>`;
    }

    function renderLists() {
      if (!lists.length) {
        listsGridEl.innerHTML = `<div class="sl-empty" style="grid-column:1/-1">${esc(t('sl_no_lists'))}</div>`;
        return;
      }
      listsGridEl.innerHTML = lists.map(renderListCard).join('');
      listsGridEl.querySelectorAll('.sl-card').forEach(card => {
        const id = card.dataset.id;
        const list = lists.find(x => x.id === id);
        card.addEventListener('click', e => { if (!e.target.closest('.sl-card-actions')) openList(list); });
        const shareBtnEl = card.querySelector('[data-action="share"]');
        if (shareBtnEl) shareBtnEl.onclick = e => { e.stopPropagation(); openShareList(list); };
        const editBtn = card.querySelector('[data-action="edit"]');
        if (editBtn) editBtn.onclick = e => { e.stopPropagation(); openListForm(list); };
        const delBtn = card.querySelector('[data-action="delete"]');
        if (delBtn) delBtn.onclick = e => { e.stopPropagation(); deleteList(list); };
      });
    }

    async function refreshLists() {
      try { lists = await api('/lists'); } catch (e) { lists = []; }
      if (destroyed) return;
      renderLists();
    }

    function showLists() {
      currentList = null;
      toolbarMain.style.display = '';
      toolbarItems.style.display = 'none';
      listsGridEl.style.display = '';
      itemsViewEl.style.display = 'none';
      refreshLists();
    }

    async function openList(list) {
      currentList = list;
      toolbarMain.style.display = 'none';
      toolbarItems.style.display = '';
      listsGridEl.style.display = 'none';
      itemsViewEl.style.display = '';
      itemsTitleEl.textContent = list.title;
      shareBtn.style.display = list.role === 'owner' ? '' : 'none';
      await refreshItems();
    }

    function openListForm(existing) {
      const isEdit = !!existing;
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(isEdit ? t('sl_edit_list') : t('sl_new_list'))}</h3>
        <div class="sl-field">
          <input type="text" id="sl-f-title" maxlength="200" placeholder="${esc(t('sl_list_title_ph'))}" value="${existing ? esc(existing.title) : ''}"></div>
        <div class="sl-error" id="sl-f-error" style="display:none"></div>
        <div class="sl-dialog-actions">
          <button class="sl-btn" id="sl-f-cancel">${esc(t('sl_cancel'))}</button>
          <button class="sl-btn sl-btn-primary" id="sl-f-save">${esc(t('sl_save'))}</button>
        </div>
      </div>`);
      const errEl = ov.querySelector('#sl-f-error');
      ov.querySelector('#sl-f-cancel').onclick = () => ov.remove();
      ov.querySelector('#sl-f-save').onclick = async () => {
        const title = ov.querySelector('#sl-f-title').value.trim();
        if (!title) { errEl.textContent = t('sl_title_required'); errEl.style.display = 'block'; return; }
        try {
          if (isEdit) await api(`/lists/${existing.id}`, { method: 'PUT', body: JSON.stringify({ title }) });
          else await api('/lists', { method: 'POST', body: JSON.stringify({ title }) });
          ov.remove();
          await refreshLists();
        } catch (e) {
          errEl.textContent = e.message || t('sl_error');
          errEl.style.display = 'block';
        }
      };
    }

    async function deleteList(list) {
      if (!confirm(t('sl_confirm_delete_list', { title: list.title }))) return;
      try { await api(`/lists/${list.id}`, { method: 'DELETE' }); await refreshLists(); }
      catch (e) { toast(e.message || t('sl_error'), 'bad'); }
    }

    async function openShareList(list) {
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(t('sl_share_title'))} — ${esc(list.title)}</h3>
        <div class="sl-section-label">${esc(t('sl_current_members'))}</div>
        <div id="sl-share-members"><div class="sl-empty">…</div></div>
        <div class="sl-section-label">${esc(t('sl_add_from_favourites'))}</div>
        <div id="sl-share-favs"><div class="sl-empty">…</div></div>
        <div class="sl-error" id="sl-share-error" style="display:none"></div>
        <div class="sl-dialog-actions"><button class="sl-btn" id="sl-share-close">${esc(t('sl_close'))}</button></div>
      </div>`);
      const shareErrEl = ov.querySelector('#sl-share-error');
      ov.querySelector('#sl-share-close').onclick = () => { ov.remove(); refreshLists(); };

      async function loadMembers() {
        const members = await api(`/lists/${list.id}/members`);
        const el = ov.querySelector('#sl-share-members');
        el.innerHTML = members.map(m => `
          <div class="sl-member-row" data-uid="${esc(m.user_id)}">
            <span class="sl-member-name">${esc(m.display_name || m.username || m.user_id)}</span>
            <span class="sl-member-role">${esc(m.role === 'owner' ? t('sl_owner') : '')}</span>
            ${m.role !== 'owner' ? `<button class="sl-btn-icon" data-action="remove-member">✕</button>` : ''}
          </div>`).join('');
        el.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('sl_confirm_remove_member'))) return;
            const uid = btn.closest('.sl-member-row').dataset.uid;
            await api(`/lists/${list.id}/members/${uid}`, { method: 'DELETE' });
            loadMembers();
          };
        });
        return members.map(m => m.user_id);
      }

      async function loadFavourites() {
        const memberIds = await loadMembers();
        const favs = await favApi('/favourites');
        const el = ov.querySelector('#sl-share-favs');
        const available = favs.filter(f => !memberIds.includes(f.id));
        if (!available.length) { el.innerHTML = `<div class="sl-empty">${esc(t('sl_no_favourites'))}</div>`; return; }
        el.innerHTML = available.map(f => `
          <div class="sl-member-row" data-uid="${esc(f.id)}">
            <span class="sl-member-name">${esc(f.display_name || f.username)}</span>
            <button class="sl-btn" data-action="add-member">${esc(t('sl_share'))}</button>
          </div>`).join('');
        el.querySelectorAll('[data-action="add-member"]').forEach(btn => {
          btn.onclick = async () => {
            const uid = btn.closest('.sl-member-row').dataset.uid;
            shareErrEl.style.display = 'none';
            try { await api(`/lists/${list.id}/members`, { method: 'POST', body: JSON.stringify({ user_id: uid }) }); }
            catch (e) { shareErrEl.textContent = e.message || t('sl_save_failed'); shareErrEl.style.display = 'block'; return; }
            loadFavourites();
          };
        });
      }
      loadFavourites();
    }

    // ── Items view ───────────────────────────────────────────────

    function renderItemRow(item) {
      const bought = !!item.bought_at;
      const total = item.price != null ? item.price * item.quantity : null;
      const catTitle = item.category_id ? categoryTitle(item.category_id) : null;
      return `<div class="sl-item-row ${bought ? 'sl-item-bought' : ''}" data-id="${esc(item.id)}">
        <input type="checkbox" class="sl-item-check" ${bought ? 'checked' : ''}>
        <div class="sl-item-main">
          <div class="sl-item-name">${esc(item.name)}</div>
          <div class="sl-item-meta">
            <span>${esc(fmtQty(item.quantity))}${item.price != null ? ' × ' + fmtMoney(item.price) + ' = ' + fmtMoney(total) : ''}</span>
            ${catTitle ? `<span class="sl-badge">${esc(catTitle)}</span>` : ''}
          </div>
          ${item.warranty ? renderWarrantyBar(item.warranty) : ''}
        </div>
        <div class="sl-item-actions">
          <button class="sl-btn-icon" data-action="warranty" title="${esc(t('sl_warranty'))}">🛡️</button>
          ${!bought ? `<button class="sl-btn-icon" data-action="edit" title="${esc(t('sl_edit'))}">✎</button>` : ''}
          <button class="sl-btn-icon" data-action="delete" title="${esc(t('sl_delete'))}">🗑</button>
        </div>
      </div>`;
    }

    function renderItems() {
      if (!items.length) {
        itemsViewEl.innerHTML = `<div class="sl-empty">${esc(t('sl_no_items'))}</div>`;
        return;
      }
      const itemValue = it => it.price != null ? it.price * it.quantity : 0;
      const total = items.reduce((sum, it) => sum + itemValue(it), 0);
      const boughtTotal = items.filter(it => it.bought_at).reduce((sum, it) => sum + itemValue(it), 0);
      const remainingTotal = total - boughtTotal;
      const hasPriced = items.some(it => it.price != null);
      itemsViewEl.innerHTML = `<div class="sl-item-list">${items.map(renderItemRow).join('')}</div>`
        + (hasPriced ? `<div class="sl-total-row">
            <div>${esc(t('sl_total'))}: <strong>${esc(fmtMoney(total))}</strong></div>
            <div>${esc(t('sl_total_bought'))}: <strong>${esc(fmtMoney(boughtTotal))}</strong></div>
            <div>${esc(t('sl_total_remaining'))}: <strong>${esc(fmtMoney(remainingTotal))}</strong></div>
          </div>` : '');
      itemsViewEl.querySelectorAll('.sl-item-row').forEach(row => {
        const id = row.dataset.id;
        const item = items.find(x => x.id === id);
        const checkbox = row.querySelector('.sl-item-check');
        checkbox.onchange = () => checkbox.checked ? buyItem(item, checkbox) : unbuyItem(item, checkbox);
        const editBtn = row.querySelector('[data-action="edit"]');
        if (editBtn) editBtn.onclick = () => openItemForm(item);
        const delBtn = row.querySelector('[data-action="delete"]');
        if (delBtn) delBtn.onclick = () => deleteItem(item);
        const warrantyBtn = row.querySelector('[data-action="warranty"]');
        if (warrantyBtn) warrantyBtn.onclick = () => openWarrantyDialog(item);
      });
    }

    async function refreshItems() {
      if (!currentList) return;
      try { items = await api(`/lists/${currentList.id}/items`); } catch (e) { items = []; }
      if (destroyed) return;
      renderItems();
    }

    async function buyItem(item, checkbox) {
      try {
        const result = await api(`/items/${item.id}/buy`, { method: 'POST' });
        if (item.category_id && item.price != null) {
          toast(result.budget_ok ? t('sl_budget_applied') : t('sl_budget_failed'), result.budget_ok ? 'good' : 'bad');
        }
        await refreshItems();
        await refreshLists();
      } catch (e) {
        checkbox.checked = false;
        toast(e.message || t('sl_error'), 'bad');
      }
    }

    async function unbuyItem(item, checkbox) {
      try {
        const result = await api(`/items/${item.id}/unbuy`, { method: 'POST' });
        if (item.budget_applied) {
          toast(result.budget_ok ? t('sl_budget_reverted') : t('sl_budget_failed'), result.budget_ok ? 'good' : 'bad');
        }
        await refreshItems();
        await refreshLists();
      } catch (e) {
        checkbox.checked = true;
        toast(e.message || t('sl_error'), 'bad');
      }
    }

    async function deleteItem(item) {
      if (!confirm(t('sl_confirm_delete_item', { name: item.name }))) return;
      try { await api(`/items/${item.id}`, { method: 'DELETE' }); await refreshItems(); await refreshLists(); }
      catch (e) { toast(e.message || t('sl_error'), 'bad'); }
    }

    function openItemForm(existing, onUpdate) {
      const isEdit = !!existing;
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(isEdit ? t('sl_edit_item') : t('sl_new_item'))}</h3>
        <div class="sl-field">
          <input type="text" id="sl-f-name" maxlength="200" placeholder="${esc(t('sl_name_ph'))}" value="${existing ? esc(existing.name) : ''}"
            ${!isEdit ? 'list="sl-name-datalist" autocomplete="off"' : ''}>
          ${!isEdit ? '<datalist id="sl-name-datalist"></datalist>' : ''}
        </div>
        <div class="sl-field-row">
          <div class="sl-field"><label>${esc(t('sl_quantity'))}</label>
            <input type="number" id="sl-f-qty" min="0.01" step="0.01" value="${existing ? existing.quantity : 1}"></div>
          <div class="sl-field"><label>${esc(t('sl_price'))}</label>
            <input type="number" id="sl-f-price" min="0" step="0.01" value="${existing && existing.price != null ? existing.price : ''}"></div>
        </div>
        ${budgetCategories.available ? `
        <div class="sl-field"><label>${esc(t('sl_category'))}</label>
          <select id="sl-f-category">
            <option value="">${esc(t('sl_category_none'))}</option>
            ${budgetCategories.categories.map(c => {
              const selected = existing ? existing.category_id === c.id : lastCategoryId === c.id;
              return `<option value="${esc(c.id)}" ${selected ? 'selected' : ''}>${esc(c.title)}</option>`;
            }).join('')}
          </select>
        </div>` : ''}
        <div class="sl-error" id="sl-f-error" style="display:none"></div>
        <div class="sl-dialog-actions">
          <button class="sl-btn" id="sl-f-cancel">${esc(t('sl_cancel'))}</button>
          <button class="sl-btn sl-btn-primary" id="sl-f-save">${esc(t('sl_save'))}</button>
        </div>
      </div>`);
      if (!isEdit) {
        api('/item-suggestions').then(names => {
          const dl = ov.querySelector('#sl-name-datalist');
          if (dl) dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
        }).catch(() => {});
      }
      const errEl = ov.querySelector('#sl-f-error');
      ov.querySelector('#sl-f-cancel').onclick = () => ov.remove();
      ov.querySelector('#sl-f-save').onclick = async () => {
        const name = ov.querySelector('#sl-f-name').value.trim();
        if (!name) { errEl.textContent = t('sl_name_required'); errEl.style.display = 'block'; return; }
        const qty = parseFloat(ov.querySelector('#sl-f-qty').value);
        if (isNaN(qty) || qty <= 0) { errEl.textContent = t('sl_quantity'); errEl.style.display = 'block'; return; }
        const priceRaw = ov.querySelector('#sl-f-price').value;
        const price = priceRaw === '' ? null : parseFloat(priceRaw);
        if (price !== null && (isNaN(price) || price < 0)) { errEl.textContent = t('sl_price'); errEl.style.display = 'block'; return; }
        const catSelect = ov.querySelector('#sl-f-category');
        const category_id = catSelect && catSelect.value ? catSelect.value : null;
        const body = { name, quantity: qty, price, category_id };
        try {
          if (isEdit) await api(`/items/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
          else await api(`/lists/${currentList.id}/items`, { method: 'POST', body: JSON.stringify(body) });
          lastCategoryId = category_id;
          ov.remove();
          await refreshItems();
          await refreshLists();
          if (onUpdate) await onUpdate();
        } catch (e) {
          errEl.textContent = e.message || t('sl_error');
          errEl.style.display = 'block';
        }
      };
    }

    function openSettings() {
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(t('sl_settings'))}</h3>
        <div class="sl-toggle-row">
          <input type="checkbox" id="sl-s-budget" ${settings.budget_integration ? 'checked' : ''}>
          <label for="sl-s-budget">${esc(t('sl_budget_integration'))}</label>
        </div>
        <div class="sl-field-hint">${esc(t('sl_budget_integration_hint'))}</div>
        <div class="sl-dialog-actions"><button class="sl-btn" id="sl-settings-close">${esc(t('sl_close'))}</button></div>
      </div>`);
      ov.querySelector('#sl-settings-close').onclick = () => ov.remove();
      ov.querySelector('#sl-s-budget').onchange = async e => {
        const enabled = e.target.checked;
        try {
          await api('/me/settings', { method: 'PUT', body: JSON.stringify({ budget_integration: enabled }) });
          settings.budget_integration = enabled;
          await ensureBudgetCategories();
        } catch (err) {
          e.target.checked = !enabled;
          toast(t('sl_error'), 'bad');
        }
      };
    }

    async function uploadWarrantyPhoto(itemId, file) {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(API + `/items/${itemId}/warranty/photos`, {
        method: 'POST', headers: { 'X-Pub-Token': token }, body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || t('sl_warranty_upload_failed'));
      return data;
    }

    function openPhotoLightbox(url) {
      const box = document.createElement('div');
      box.className = 'sl-lightbox';
      box.innerHTML = `<img src="${esc(url)}">`;
      box.onclick = () => box.remove();
      document.body.appendChild(box);
    }

    function openWarrantyDialog(item, onUpdate) {
      let current = item;
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(t('sl_warranty'))} — ${esc(item.name)}</h3>
        <div id="sl-warranty-body"></div>
        <div class="sl-error" id="sl-w-error" style="display:none"></div>
        <div class="sl-dialog-actions"><button class="sl-btn" id="sl-warranty-close">${esc(t('sl_close'))}</button></div>
      </div>`);
      const errEl = ov.querySelector('#sl-w-error');
      ov.querySelector('#sl-warranty-close').onclick = () => { ov.remove(); refreshItems(); if (onUpdate) onUpdate(); };
      const bodyEl = ov.querySelector('#sl-warranty-body');

      function todayPlusYears(n) {
        const d = new Date();
        d.setFullYear(d.getFullYear() + n);
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      }

      function showError(e) {
        errEl.textContent = e.message || t('sl_error');
        errEl.style.display = 'block';
      }

      function renderBody() {
        errEl.style.display = 'none';
        const w = current.warranty;
        const photos = current.warranty_photos || [];
        if (!w) {
          bodyEl.innerHTML = `
            <div class="sl-field-row">
              <div class="sl-field"><label>${esc(t('sl_warranty_start_date'))}</label><div id="sl-w-start-new"></div></div>
              <div class="sl-field"><label>${esc(t('sl_warranty_end_date'))}</label><div id="sl-w-end-new"></div></div>
            </div>
            <div class="sl-field"><label>${esc(t('sl_warranty_photos'))}</label>
              <input type="file" id="sl-w-photos-new" accept="image/*" capture="environment" multiple>
            </div>
            <button class="sl-btn sl-btn-primary" id="sl-w-set">${esc(t('sl_warranty_set'))}</button>`;
          const startInput = makeDateInput(todayPlusYears(0));
          const endInput = makeDateInput(todayPlusYears(2));
          bodyEl.querySelector('#sl-w-start-new').appendChild(startInput);
          bodyEl.querySelector('#sl-w-end-new').appendChild(endInput);
          bodyEl.querySelector('#sl-w-set').onclick = async () => {
            const start_date = startInput.value, end_date = endInput.value;
            if (!start_date || !end_date || end_date <= start_date) { showError({ message: t('sl_warranty_date_invalid') }); return; }
            const files = Array.from(bodyEl.querySelector('#sl-w-photos-new').files || []);
            try {
              current = await api(`/items/${item.id}/warranty`, { method: 'PUT', body: JSON.stringify({ start_date, end_date }) });
              for (const file of files) current = await uploadWarrantyPhoto(item.id, file);
              renderBody();
              refreshItems();
            } catch (e) { showError(e); }
          };
          return;
        }
        bodyEl.innerHTML = `
          <div class="sl-warranty-info">
            <div>${esc(t('sl_warranty_started', { date: fmtDate(w.start) }))}</div>
            <div>${esc(t('sl_warranty_expires', { date: fmtDate(w.expires_at) }))}</div>
            <div class="sl-warranty-progress"><div class="sl-warranty-progress-fill ${warrantyClass(w)}" style="width:${w.expired ? 100 : w.progress_pct}%"></div></div>
            <div class="${warrantyClass(w)}">${esc(fmtRemaining(w))}</div>
          </div>
          <div class="sl-field-row">
            <div class="sl-field"><label>${esc(t('sl_warranty_start_date'))}</label><div id="sl-w-start"></div></div>
            <div class="sl-field"><label>${esc(t('sl_warranty_end_date'))}</label><div id="sl-w-end"></div></div>
          </div>
          <div style="display:flex;justify-content:flex-end"><button class="sl-btn" id="sl-w-update">${esc(t('sl_save'))}</button></div>
          <div class="sl-section-label">${esc(t('sl_warranty_photos'))}</div>
          <div class="sl-warranty-photos">
            ${photos.map(p => `
              <div class="sl-warranty-photo" data-id="${esc(p.id)}">
                <img src="${esc(p.url)}" data-action="view-photo">
                <button data-action="del-photo">✕</button>
              </div>`).join('')}
            <label class="sl-warranty-photo sl-warranty-photo-add">
              +<input type="file" id="sl-w-photo-add" accept="image/*" capture="environment" multiple style="display:none">
            </label>
          </div>
          ${!photos.length ? `<div class="sl-field-hint">${esc(t('sl_warranty_no_photos'))}</div>` : ''}
          <button class="sl-btn" id="sl-w-remove" style="color:var(--pub-red, #f38ba8)">${esc(t('sl_warranty_remove'))}</button>`;

        const startInput = makeDateInput(w.start.slice(0, 10));
        const endInput = makeDateInput(w.expires_at.slice(0, 10));
        bodyEl.querySelector('#sl-w-start').appendChild(startInput);
        bodyEl.querySelector('#sl-w-end').appendChild(endInput);
        bodyEl.querySelector('#sl-w-update').onclick = async () => {
          const start_date = startInput.value, end_date = endInput.value;
          if (!start_date || !end_date || end_date <= start_date) { showError({ message: t('sl_warranty_date_invalid') }); return; }
          try {
            current = await api(`/items/${item.id}/warranty`, { method: 'PUT', body: JSON.stringify({ start_date, end_date }) });
            renderBody();
            refreshItems();
          } catch (e) { showError(e); }
        };
        bodyEl.querySelector('#sl-w-remove').onclick = async () => {
          if (!confirm(t('sl_warranty_confirm_remove', { name: item.name }))) return;
          try {
            await api(`/items/${item.id}/warranty`, { method: 'DELETE' });
            ov.remove();
            await refreshItems();
          } catch (e) { showError(e); }
        };
        const addInput = bodyEl.querySelector('#sl-w-photo-add');
        addInput.onchange = async () => {
          const files = Array.from(addInput.files || []);
          try {
            for (const file of files) current = await uploadWarrantyPhoto(item.id, file);
            renderBody();
            refreshItems();
          } catch (e) { showError(e); }
        };
        bodyEl.querySelectorAll('[data-action="view-photo"]').forEach(img => {
          img.onclick = () => openPhotoLightbox(img.src);
        });
        bodyEl.querySelectorAll('[data-action="del-photo"]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm(t('sl_photo_delete_confirm'))) return;
            const pid = btn.closest('.sl-warranty-photo').dataset.id;
            try {
              current = await api(`/items/${item.id}/warranty/photos/${pid}`, { method: 'DELETE' });
              renderBody();
              refreshItems();
            } catch (e) { showError(e); }
          };
        });
      }
      renderBody();
    }

    async function openWarrantiesOverview() {
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(t('sl_warranties'))}</h3>
        <div id="sl-warranties-list"><div class="sl-empty">…</div></div>
        <div class="sl-dialog-actions"><button class="sl-btn" id="sl-warranties-close">${esc(t('sl_close'))}</button></div>
      </div>`);
      ov.querySelector('#sl-warranties-close').onclick = () => { ov.remove(); refreshItems(); };
      const listEl = ov.querySelector('#sl-warranties-list');

      async function load() {
        try {
          const rows = await api('/warranties');
          if (!rows.length) {
            listEl.innerHTML = `<div class="sl-empty">${esc(t('sl_no_warranties'))}</div>`;
            return;
          }
          listEl.innerHTML = rows.map(it => {
            const w = it.warranty;
            const cls = warrantyClass(w);
            return `<div class="sl-warranty-overview-row" data-id="${esc(it.id)}">
              <div class="sl-warranty-overview-main">
                <div class="sl-warranty-overview-name">${esc(it.name)}</div>
                <div class="sl-warranty-overview-list">${it.list_id ? '' : '🕓 '}${esc(it.list_title || '')}</div>
                <div class="sl-warranty-progress"><div class="sl-warranty-progress-fill ${cls}" style="width:${w.expired ? 100 : w.progress_pct}%"></div></div>
              </div>
              <div class="sl-warranty-remaining ${cls}">${esc(fmtRemaining(w))}</div>
            </div>`;
          }).join('');
          listEl.querySelectorAll('.sl-warranty-overview-row').forEach(row => {
            const id = row.dataset.id;
            const item = rows.find(x => x.id === id);
            row.onclick = () => openWarrantyDialog(item, load);
          });
        } catch (e) {
          listEl.innerHTML = `<div class="sl-empty">${esc(t('sl_error'))}</div>`;
        }
      }
      load();
    }

    function renderHistoryRow(item) {
      const bought = !!item.bought_at;
      const total = item.price != null ? item.price * item.quantity : null;
      return `<div class="sl-item-row ${bought ? 'sl-item-bought' : ''}" data-id="${esc(item.id)}">
        <div class="sl-item-main">
          <div class="sl-item-name">${esc(item.name)}</div>
          <div class="sl-item-meta">
            <span>${esc(fmtQty(item.quantity))}${item.price != null ? ' × ' + fmtMoney(item.price) + ' = ' + fmtMoney(total) : ''}</span>
            ${item.list_title_snapshot ? `<span class="sl-badge">${esc(item.list_title_snapshot)}</span>` : ''}
            ${bought ? `<span class="sl-badge">${esc(t('sl_total_bought'))}</span>` : ''}
          </div>
          ${item.warranty ? renderWarrantyBar(item.warranty) : ''}
        </div>
        <div class="sl-item-actions">
          <button class="sl-btn-icon" data-action="warranty" title="${esc(t('sl_warranty'))}">🛡️</button>
          ${!bought ? `<button class="sl-btn-icon" data-action="edit" title="${esc(t('sl_edit'))}">✎</button>` : ''}
          <button class="sl-btn-icon" data-action="delete" title="${esc(t('sl_delete'))}">🗑</button>
        </div>
      </div>`;
    }

    async function openHistoryDialog() {
      const ov = overlay(`<div class="sl-dialog">
        <h3>${esc(t('sl_history'))}</h3>
        <div id="sl-history-list"><div class="sl-empty">…</div></div>
        <div class="sl-dialog-actions"><button class="sl-btn" id="sl-history-close">${esc(t('sl_close'))}</button></div>
      </div>`);
      ov.querySelector('#sl-history-close').onclick = () => ov.remove();
      const listEl = ov.querySelector('#sl-history-list');

      async function load() {
        try {
          const rows = await api('/history');
          if (!rows.length) {
            listEl.innerHTML = `<div class="sl-empty">${esc(t('sl_no_history'))}</div>`;
            return;
          }
          listEl.innerHTML = `<div class="sl-item-list">${rows.map(renderHistoryRow).join('')}</div>`;
          listEl.querySelectorAll('.sl-item-row').forEach(row => {
            const id = row.dataset.id;
            const item = rows.find(x => x.id === id);
            row.querySelector('[data-action="delete"]').onclick = async () => {
              if (!confirm(t('sl_history_confirm_delete', { name: item.name }))) return;
              try { await api(`/items/${item.id}`, { method: 'DELETE' }); await load(); }
              catch (e) { toast(e.message || t('sl_error'), 'bad'); }
            };
            row.querySelector('[data-action="warranty"]').onclick = () => openWarrantyDialog(item, load);
            const editBtn = row.querySelector('[data-action="edit"]');
            if (editBtn) editBtn.onclick = () => openItemForm(item, load);
          });
        } catch (e) {
          listEl.innerHTML = `<div class="sl-empty">${esc(t('sl_error'))}</div>`;
        }
      }
      load();
    }

    backBtn.onclick = () => showLists();
    addListBtn.onclick = () => openListForm(null);
    addItemBtn.onclick = () => openItemForm(null);
    shareBtn.onclick = () => { if (currentList) openShareList(currentList); };
    settingsBtn.onclick = () => openSettings();
    warrantiesBtn.onclick = () => openWarrantiesOverview();
    historyBtn.onclick = () => openHistoryDialog();

    async function ensureBudgetCategories() {
      if (!settings.budget_integration) { budgetCategories = { available: false, categories: [], currency: null }; return; }
      try { budgetCategories = await api('/budget-categories'); }
      catch (e) { budgetCategories = { available: false, categories: [], currency: null }; }
    }

    async function init() {
      await loadDateFormat();
      if (destroyed) return;
      try { settings = await api('/me'); } catch (e) { settings = { budget_integration: false }; }
      if (destroyed) return;
      await ensureBudgetCategories();
      if (destroyed) return;
      await refreshLists();
    }
    init();

    return {
      destroy() {
        destroyed = true;
      },
    };
  }

  window.ShoppingListWidget = { mount };
})();
