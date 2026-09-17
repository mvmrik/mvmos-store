// Budget — shared widget used by the desktop app window, the standalone
// Apps Hub public page, and the Telegram mini-app (same three-surface
// pattern as apps/calendar/calendar-widget.js / apps/chat/chat-widget.js).
(function () {
  if (window.BudgetWidget) return;

  const API = '/pub/budget';

  // Strings live in public/i18n.js so they travel inside the store archive and
  // so all three surfaces share one table; every surface loads that file before
  // this one. The fallback keeps the widget usable — showing key names rather
  // than nothing — if it ever fails to load.
  const _i18n = window.BUDGET_I18N || { en: {} };
  function t(key) {
    const lang = window.mvmOS?.lang || 'en';
    return (_i18n[lang] || _i18n.en || {})[key] || key;
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
    { value: 'BTC', symbol: '₿' },
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
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  // Fixed amounts are decided in advance, so they are taken off the top and the
  // percentages divide only what is left. Percentages are used exactly as they
  // were entered and never rescaled to 100: someone who deliberately allocates
  // 80% wants the remaining fifth to stay unspent, and the dialog reports the
  // gap instead of quietly closing it.
  function allocate(cats, total) {
    const percent = cats.filter(c => c.alloc_type === 'percent');
    const fixedSum = cats.reduce((a, c) => a + (c.alloc_type === 'percent' ? 0 : (c.alloc_value || 0)), 0);
    // A negative remainder would hand out negative amounts, which is not a plan
    // anyone meant; the percent rows fall to zero and the summary shows that the
    // fixed amounts alone already overshoot.
    const remainder = Math.max(0, total - fixedSum);
    const out = {};
    cats.forEach(c => {
      out[c.id] = round2(c.alloc_type === 'percent' ? remainder * (c.alloc_value || 0) / 100 : (c.alloc_value || 0));
    });
    // Rounding each row to two decimals can leave the plan a cent away from what
    // the percentages actually come to. The largest share absorbs that cent, so
    // a plan that is meant to balance exactly does balance exactly.
    if (percent.length) {
      const pctSum = percent.reduce((a, c) => a + (c.alloc_value || 0), 0);
      const exact = fixedSum + remainder * pctSum / 100;
      const drift = round2(exact - cats.reduce((a, c) => a + out[c.id], 0));
      if (drift && Math.abs(drift) <= 0.01 * percent.length) {
        const biggest = percent.reduce((a, c) => ((c.alloc_value || 0) > (a.alloc_value || 0) ? c : a));
        out[biggest.id] = round2(out[biggest.id] + drift);
      }
    }
    return out;
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
      .bw-toolbar-break{display:none}
      .bw-body{flex:1;overflow-y:auto;padding:14px}
      .bw-empty{color:var(--pub-dim, #6c7086);text-align:center;padding:40px 16px}
      .bw-loading{display:flex;justify-content:center;align-items:center;padding:22px 0}
      .bw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
      .bw-card{background:var(--pub-surface2, #313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:6px}
      .bw-card-head{display:block}
      .bw-card-title{font-weight:700;font-size:.95rem;word-break:break-word;min-width:0}
      .bw-card-actions{display:flex;justify-content:flex-end;gap:2px;align-items:center;margin-top:2px}
      .bw-btn-icon.bw-btn-owner{background:rgba(166,227,161,.22)}
      .bw-btn-icon.bw-btn-owner:hover{background:rgba(166,227,161,.35)}
      .bw-card-desc{color:var(--pub-fg2, #a6adc8);font-size:.78rem;word-break:break-word}
      .bw-card-balance{font-size:1.2rem;font-weight:700;cursor:pointer}
      .bw-card-balance.bw-balance-positive{color:var(--pub-green, #a6e3a1)}
      .bw-card-balance.bw-balance-negative{color:var(--pub-red, #f38ba8)}
      .bw-card-balance:hover{color:var(--pub-accent, #89b4fa)}
      .bw-progress{height:6px;border-radius:3px;background:var(--pub-border, #45475a);overflow:hidden}
      .bw-progress-bar{height:100%;background:var(--pub-green, #a6e3a1);border-radius:3px}
      .bw-progress-bar.bw-progress-low{background:var(--pub-red, #f38ba8)}
      .bw-progress-bar.bw-progress-mid{background:var(--pub-warning, #f9e2af)}
      .bw-progress-bar.bw-progress-high{background:var(--pub-green, #a6e3a1)}
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
      .bw-add-stack{display:flex;flex-direction:column;gap:8px}
      .bw-add-stack .bw-amount-group input{flex:1;min-width:0}
      .bw-note-group{display:flex;gap:6px}
      .bw-note-group input{flex:1;min-width:0}
      .bw-note-group .bw-btn{flex-shrink:0}
      /* The suggestions live behind the round button next to the note, the way a
         chat keeps its emoji, and the panel is positioned out of flow — so an
         answer that arrives while an amount is being typed cannot move anything
         underneath it, and the picker takes no room at all when it is shut. */
      .bw-suggest-btn{flex:0 0 auto;align-self:center;width:32px;height:32px;padding:0;
        border-radius:50%;border:1px solid var(--pub-border, #45475a);
        background:var(--pub-surface2, #313244);color:var(--pub-fg2, #a6adc8);
        font-size:.95rem;line-height:1;cursor:pointer}
      .bw-suggest-btn:hover{background:var(--pub-border, #45475a)}
      .bw-suggest-btn.bw-suggest-open{background:var(--pub-accent, #89b4fa);border-color:transparent}
      .bw-suggest-pop{position:absolute;z-index:60;width:min(320px, calc(100% - 32px));
        box-sizing:border-box;background:var(--pub-surface1, #181825);
        border:1px solid var(--pub-border, #45475a);border-radius:9px;
        box-shadow:0 10px 26px rgba(0,0,0,.45);padding:9px}
      .bw-suggest-pop-head{font-size:.7rem;text-transform:uppercase;letter-spacing:.4px;
        color:var(--pub-dim, #6c7086);margin-bottom:7px}
      .bw-suggest{display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;
        max-height:160px;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin;
        scrollbar-color:var(--pub-border, #45475a) transparent}
      .bw-suggest::-webkit-scrollbar{width:6px}
      .bw-suggest::-webkit-scrollbar-thumb{background:var(--pub-border, #45475a);border-radius:3px}
      .bw-suggest::-webkit-scrollbar-track{background:transparent}
      .bw-suggest-empty{color:var(--pub-dim, #6c7086);font-size:.74rem}
      .bw-spin{display:inline-block;flex:0 0 auto;width:14px;height:14px;border-radius:50%;
        border:2px solid var(--pub-border, #45475a);border-top-color:var(--pub-accent, #89b4fa);
        animation:bw-spin .7s linear infinite}
      @keyframes bw-spin{to{transform:rotate(360deg)}}
      .bw-btn-wide{width:100%;text-align:center;margin-top:8px}
      .bw-suggest-chip{flex:0 1 auto;background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);
        color:var(--pub-fg2, #a6adc8);border-radius:999px;padding:4px 11px;font-size:.76rem;font-family:inherit;
        line-height:1.35;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-suggest-chip:hover{background:var(--pub-border, #45475a);color:var(--pub-fg, #cdd6f4)}
      .bw-suggest-chip.bw-suggest-on{background:var(--pub-accent, #89b4fa);color:var(--pub-bg, #1e1e2e);
        border-color:transparent;font-weight:600}
      .bw-amount-group{display:flex;gap:4px}
      .bw-amount-group select{background:var(--pub-surface2, #313244);border:1px solid var(--pub-border, #45475a);border-radius:6px;color:var(--pub-fg, #cdd6f4);
        padding:7px 4px;font-family:inherit;font-size:.85rem;flex:0 0 46px}
      .bw-amount-group input{flex:1}
      .bw-total-balance{font-size:1.3rem;font-weight:700}
      .bw-mass-row{display:flex;align-items:center;gap:8px;padding:6px 0 6px 7px;
        border-bottom:1px solid var(--pub-surface2, #313244);border-left:3px solid transparent}
      .bw-mass-row.bw-mass-ok{border-left-color:var(--pub-green, #a6e3a1)}
      .bw-mass-row.bw-mass-ok input{border:1px solid var(--pub-green, #a6e3a1)}
      .bw-mass-row.bw-mass-off{border-left-color:var(--pub-red, #f38ba8)}
      .bw-mass-row.bw-mass-off input{border:1px solid var(--pub-red, #f38ba8)}
      .bw-mass-summary{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;
        margin-top:8px;padding:7px 10px;border-radius:7px;font-size:.78rem;
        background:var(--pub-surface2, #313244);color:var(--pub-fg2, #a6adc8)}
      .bw-mass-summary strong{font-weight:700}
      .bw-mass-summary.bw-mass-ok{background:rgba(166,227,161,.15);color:var(--pub-green, #a6e3a1)}
      .bw-mass-summary.bw-mass-off{background:rgba(243,139,168,.15);color:var(--pub-red, #f38ba8)}
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
      .bw-toolbar-label{font-size:.68rem;color:var(--pub-fg2, #a6adc8);text-transform:uppercase;letter-spacing:.4px}
      .bw-stats-filters{display:flex;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--pub-surface2, #313244);flex-shrink:0}
      .bw-filter{display:flex;flex-direction:column;gap:3px;font-size:.68rem;color:var(--pub-fg2, #a6adc8);min-width:0}
      .bw-filter select,.bw-filter input{background:var(--pub-surface2, #313244);border:1px solid transparent;color:var(--pub-fg, #cdd6f4);border-radius:6px;padding:5px 8px;font-size:.8rem;font-family:inherit;max-width:100%}
      .bw-filter select:focus,.bw-filter input:focus{outline:none;border-color:var(--pub-accent, #89b4fa)}
      .bw-filter-cat{flex:1 1 180px}
      .bw-stats-body{padding:14px}
      .bw-stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}
      .bw-stat-card{background:var(--pub-surface2, #313244);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:2px;min-width:0}
      .bw-stat-card span{font-size:.68rem;color:var(--pub-fg2, #a6adc8);text-transform:uppercase;letter-spacing:.4px}
      .bw-stat-card b{font-size:1.02rem;overflow:hidden;text-overflow:ellipsis}
      .bw-stat-card small{font-size:.66rem;color:var(--pub-dim, #6c7086)}
      .bw-chart-title{font-size:.78rem;font-weight:600;margin-bottom:10px}
      .bw-chart-note{font-size:.7rem;color:var(--pub-dim, #6c7086);margin-top:8px;display:flex;justify-content:space-between;gap:8px}
      .bw-donut-wrap{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
      .bw-donut{flex:0 0 140px}
      .bw-donut-total{font-size:.72rem;fill:var(--pub-fg2, #a6adc8)}
      .bw-donut-sum{font-size:.8rem;font-weight:600;fill:var(--pub-fg, #cdd6f4)}
      .bw-donut-legend{flex:1 1 180px;display:flex;flex-direction:column;gap:5px;font-size:.75rem;min-width:0}
      .bw-donut-legend div{display:flex;align-items:center;gap:6px;min-width:0}
      .bw-donut-legend .bw-dl-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-donut-legend .bw-dl-pct{color:var(--pub-dim, #6c7086);flex-shrink:0}
      .bw-line{width:100%;height:130px;display:block}
      .bw-cat-stat{padding:8px 0;border-bottom:1px solid var(--pub-surface2, #313244)}
      .bw-cat-stat:last-child{border-bottom:none}
      .bw-cat-stat-head{display:flex;align-items:center;gap:7px;font-size:.84rem}
      .bw-cat-stat-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-cat-stat-bar{display:flex;gap:2px;height:6px;margin:5px 0 4px}
      .bw-cat-stat-bar i{display:block;border-radius:3px;min-width:0}
      .bw-cat-bar-income{background:var(--pub-green, #a6e3a1)}
      .bw-cat-bar-expense{background:var(--pub-red, #f38ba8)}
      .bw-cat-stat-meta{display:flex;gap:10px;font-size:.7rem;color:var(--pub-dim, #6c7086);flex-wrap:wrap}
      .bw-top-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--pub-surface2, #313244);font-size:.8rem}
      .bw-top-row:last-child{border-bottom:none}
      .bw-top-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
      .bw-top-cat{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bw-top-when{font-size:.68rem;color:var(--pub-dim, #6c7086)}
      @media (max-width:520px){
        .bw-grid{grid-template-columns:1fr}
        .bw-toolbar,.bw-history-toolbar{flex-wrap:wrap}
        /* The title shares the row with the icons and gives way with an
           ellipsis; only the two wide buttons drop to a line of their own,
           where they split it evenly. Letting the title claim a full row of
           its own is what pushed every icon onto a line by itself. */
        .bw-toolbar h2,.bw-history-toolbar h2{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bw-toolbar-break{display:block;flex-basis:100%;height:0}
        .bw-toolbar .bw-btn{flex:1 1 0;min-width:0;padding:7px 8px}
        /* A finger needs more than the 24px square a mouse pointer was happy
           with; only the header icons grow, not the ones inside list rows. */
        .bw-toolbar .bw-btn-icon{font-size:1.1rem;padding:7px 9px}
        .bw-dialog{max-width:100%}
        .bw-stats-toolbar h2{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .bw-period-tabs{flex:1 1 100%}
        .bw-period-tab{flex:1;text-align:center;padding:6px 4px}
        .bw-filter{flex:1 1 calc(50% - 5px)}
        .bw-filter-cat{flex:1 1 100%}
        .bw-stats-body{padding:12px}
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
    // The account's own saved date/time display choice (Apps Hub profile,
    // Settings there) — falls back to nothing (this visitor's own browser
    // decides) until it loads, same as before this existed.
    let _prefs = {};
    fetch('/api/pub/apphub/me', {headers:{'X-Pub-Token':token}}).then(r=>r.ok?r.json():{}).then(p=>{_prefs=p;}).catch(()=>{});
    function _fmtDateTime(d) {
      let dateStr = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' });
      if (_prefs.date_format) {
        const v = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
        dateStr = _prefs.date_format==='MM/DD/YYYY' ? `${v.month}/${v.day}/${v.year.slice(2)}` : _prefs.date_format==='YYYY-MM-DD' ? `${v.year}-${v.month}-${v.day}` : `${v.day}/${v.month}/${v.year.slice(2)}`;
      }
      const timeStr = _prefs.time_format ? d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:_prefs.time_format==='12'}) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return dateStr + ' ' + timeStr;
    }

    root.style.position = 'relative';
    root.innerHTML = `<div class="bw-widget">
      <div class="bw-toolbar">
        <div class="bw-menu-wrap">
          <button class="bw-btn-icon" id="bw-menu-btn" title="${esc(t('menu'))}">☰</button>
        </div>
        <h2>💰 ${esc(t('title'))}</h2>
        <button class="bw-btn-icon" id="bw-settings-btn" title="${esc(t('settings'))}">⚙️</button>
        <span class="bw-toolbar-break" id="bw-toolbar-break"></span>
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
    const toolbarBreak = root.querySelector('#bw-toolbar-break');

    function _showView(name) {
      gridEl.style.display = name === 'categories' ? '' : 'none';
      historyViewEl.style.display = name === 'history' ? '' : 'none';
      statsViewEl.style.display = name === 'stats' ? '' : 'none';
      addCatBtn.style.display = name === 'categories' ? '' : 'none';
      massAddBtn.style.display = name === 'categories' ? '' : 'none';
      // Nothing to break to once those two are gone, and an empty second row
      // would still cost the toolbar a gap.
      toolbarBreak.style.display = name === 'categories' ? '' : 'none';
    }

    function showCategoriesView() { _showView('categories'); refresh(); }
    function showHistoryView() { _showView('history'); loadFullHistory(); }
    function showStatsView() { _showView('stats'); renderStatsView(); }

    function _htxWho(p) { return p && (p.display_name || p.username) || ''; }
    function _htxDate(iso) {
      return _fmtDateTime(new Date(iso));
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

    // ---- Statistics ---------------------------------------------------
    // Drawn in two halves: the toolbar is built once when the view opens and
    // only the body under it is redrawn as the selection changes. Rebuilding
    // the whole thing would pull the focus out of a date field mid-edit, which
    // is the one moment a date field is actually in use.

    const STAT_COLORS = ['#89b4fa', '#f38ba8', '#a6e3a1', '#fab387', '#cba6f7',
                         '#94e2d5', '#f9e2af', '#eba0ac', '#74c7ec', '#b4befe'];
    const STAT_PRESETS = ['this_month', 'last_month', '3m', '6m', '12m', 'this_year', 'custom'];

    function _statColor(i) {
      // Past the hand-picked palette the wheel is walked in large steps, so a
      // long category list never hands two entries the same colour — which in a
      // legend reads as one of them being mislabelled.
      return i < STAT_COLORS.length ? STAT_COLORS[i] : `hsl(${(i * 47) % 360} 55% 68%)`;
    }

    let statsPeriod = 'month';
    let statsPreset = '6m';
    let statsCategory = 'all';
    let statsFrom = '';
    let statsTo = '';
    let statsCats = null;   // the category tree, as the last answer described it
    let statsSeq = 0;       // guards against a slow answer overwriting a newer one

    function _isoDay(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
             '-' + String(d.getDate()).padStart(2, '0');
    }

    function _presetRange(preset) {
      const now = new Date(), y = now.getFullYear(), m = now.getMonth();
      if (preset === 'this_month') return [_isoDay(new Date(y, m, 1)), _isoDay(now)];
      // Day 0 of this month is the last day of the previous one.
      if (preset === 'last_month') return [_isoDay(new Date(y, m - 1, 1)), _isoDay(new Date(y, m, 0))];
      if (preset === 'this_year') return [_isoDay(new Date(y, 0, 1)), _isoDay(now)];
      const months = preset === '3m' ? 3 : preset === '12m' ? 12 : 6;
      return [_isoDay(new Date(y, m - months + 1, 1)), _isoDay(now)];
    }

    function _periodLabel(p, period) {
      if (period === 'year') return p;
      if (period === 'week') {
        const [y, w] = p.split('-W');
        return 'W' + w + " '" + y.slice(2);
      }
      const parts = p.split('-');
      if (period === 'day') {
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      }
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
      return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }

    function _catOptions() {
      // Subcategories are offered too, indented under their parent. Picking the
      // parent means the parent and everything filed under it, which is what
      // the server answers for it.
      let html = `<option value="all"${statsCategory === 'all' ? ' selected' : ''}>${esc(t('stats_all_categories'))}</option>`;
      (statsCats || []).forEach(c => {
        html += `<option value="${esc(c.id)}"${statsCategory === c.id ? ' selected' : ''}>${esc(c.title)}</option>`;
        (c.children || []).forEach(k => {
          html += `<option value="${esc(k.id)}"${statsCategory === k.id ? ' selected' : ''}>  ↳ ${esc(k.title)}</option>`;
        });
      });
      return html;
    }

    function renderStatsView() {
      if (!statsFrom || !statsTo) {
        const r = _presetRange(statsPreset);
        statsFrom = r[0]; statsTo = r[1];
      }
      statsViewEl.innerHTML = `
        <div class="bw-stats-toolbar">
          <h2>📊 ${esc(t('stats'))}</h2>
          <span class="bw-toolbar-label">${esc(t('stats_grouping'))}</span>
          <div class="bw-period-tabs" id="bw-period-tabs">
            ${['day', 'week', 'month', 'year'].map(p =>
              `<button class="bw-period-tab${statsPeriod === p ? ' active' : ''}" data-p="${p}">${esc(t('stats_period_' + p))}</button>`
            ).join('')}
          </div>
        </div>
        <div class="bw-stats-filters">
          <label class="bw-filter bw-filter-cat"><span>${esc(t('stats_category'))}</span>
            <select id="bw-stats-cat">${_catOptions()}</select></label>
          <label class="bw-filter"><span>${esc(t('stats_range'))}</span>
            <select id="bw-stats-preset">${STAT_PRESETS.map(k =>
              `<option value="${k}"${statsPreset === k ? ' selected' : ''}>${esc(t('stats_preset_' + k))}</option>`
            ).join('')}</select></label>
          <label class="bw-filter"><span>${esc(t('stats_from'))}</span>
            <input type="date" id="bw-stats-from" value="${esc(statsFrom)}"></label>
          <label class="bw-filter"><span>${esc(t('stats_to'))}</span>
            <input type="date" id="bw-stats-to" value="${esc(statsTo)}"></label>
        </div>
        <div class="bw-stats-body" id="bw-stats-body"><div class="bw-empty">…</div></div>`;

      statsViewEl.querySelectorAll('.bw-period-tab').forEach(btn => {
        btn.onclick = () => {
          statsPeriod = btn.dataset.p;
          _markPeriodTab();
          loadStats();
        };
      });
      statsViewEl.querySelector('#bw-stats-cat').onchange = e => {
        statsCategory = e.target.value; loadStats();
      };
      const presetEl = statsViewEl.querySelector('#bw-stats-preset');
      const fromEl = statsViewEl.querySelector('#bw-stats-from');
      const toEl = statsViewEl.querySelector('#bw-stats-to');
      presetEl.onchange = () => {
        statsPreset = presetEl.value;
        if (statsPreset !== 'custom') {
          const r = _presetRange(statsPreset);
          statsFrom = fromEl.value = r[0];
          statsTo = toEl.value = r[1];
        }
        loadStats();
      };
      // Typing a date is the same statement as picking a preset, so the preset
      // follows the dates rather than contradicting them.
      [fromEl, toEl].forEach(el => {
        el.onchange = () => {
          if (!fromEl.value || !toEl.value) return;
          statsFrom = fromEl.value; statsTo = toEl.value;
          statsPreset = presetEl.value = 'custom';
          loadStats();
        };
      });
      loadStats();
    }

    function _markPeriodTab() {
      statsViewEl.querySelectorAll('.bw-period-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.p === statsPeriod));
    }

    function _flowChart(periods) {
      const maxVal = Math.max(1, ...periods.map(p => Math.max(p.income, p.expense)));
      // Past a dozen or so columns the labels stop fitting under them, so only
      // every Nth is written out; the bars themselves all stay.
      const every = Math.max(1, Math.ceil(periods.length / 12));
      const bars = periods.map((p, i) => {
        const incH = Math.round((p.income / maxVal) * 130);
        const expH = Math.round((p.expense / maxVal) * 130);
        const label = _periodLabel(p.period, statsPeriod);
        const tip = `${label} · ${t('stats_income')} ${fmtMoney(p.income)} · ${t('stats_expense')} ${fmtMoney(p.expense)}`;
        return `<div class="bw-bar-col" title="${esc(tip)}">
          <div class="bw-bar-pair">
            <div class="bw-bar bw-bar-income" style="height:${incH}px"></div>
            <div class="bw-bar bw-bar-expense" style="height:${expH}px"></div>
          </div>
          <div class="bw-bar-label">${i % every === 0 ? esc(label) : ''}</div>
        </div>`;
      }).join('');
      return `<div class="bw-chart-wrap">
        <div class="bw-chart-title">${esc(t('stats_chart_flow'))}</div>
        <div class="bw-chart-legend">
          <span class="bw-legend-item"><span class="bw-legend-dot" style="background:#a6e3a1"></span>${esc(t('stats_income'))}</span>
          <span class="bw-legend-item"><span class="bw-legend-dot" style="background:#f38ba8"></span>${esc(t('stats_expense'))}</span>
        </div>
        <div class="bw-bars">${bars}</div>
      </div>`;
    }

    function _shareChart(byCategory) {
      const exp = byCategory.filter(c => c.expense > 0).sort((a, b) => b.expense - a.expense);
      if (!exp.length) {
        return `<div class="bw-chart-wrap">
          <div class="bw-chart-title">${esc(t('stats_chart_share'))}</div>
          <div class="bw-empty">${esc(t('stats_no_expenses'))}</div>
        </div>`;
      }
      const sum = exp.reduce((s, c) => s + c.expense, 0);
      const R = 52, C = 2 * Math.PI * R;
      let off = 0;
      const segs = exp.map((c, i) => {
        const len = (c.expense / sum) * C;
        const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${_statColor(i)}"
          stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
          stroke-dashoffset="${(-off).toFixed(2)}"></circle>`;
        off += len;
        return seg;
      }).join('');
      const legend = exp.map((c, i) => `<div>
        <span class="bw-legend-dot" style="background:${_statColor(i)}"></span>
        <span class="bw-dl-name">${esc(c.title)}</span>
        <span class="bw-dl-pct">${Math.round((c.expense / sum) * 100)}%</span>
        <span>${fmtMoney(c.expense)}</span>
      </div>`).join('');
      return `<div class="bw-chart-wrap">
        <div class="bw-chart-title">${esc(t('stats_chart_share'))}</div>
        <div class="bw-donut-wrap">
          <svg class="bw-donut" viewBox="0 0 140 140" role="img" aria-label="${esc(t('stats_chart_share'))}">
            <g transform="rotate(-90 70 70)">${segs}</g>
            <text class="bw-donut-total" x="70" y="66" text-anchor="middle">${esc(t('stats_expense'))}</text>
            <text class="bw-donut-sum" x="70" y="82" text-anchor="middle">${esc(fmtMoney(sum))}</text>
          </svg>
          <div class="bw-donut-legend">${legend}</div>
        </div>
      </div>`;
    }

    function _balanceChart(periods) {
      // The running total, not the per-period net: what the whole range did to
      // the money, period by period.
      let run = 0;
      const cum = periods.map(p => (run += p.net));
      const W = 300, H = 120, pad = 6;
      const hi = Math.max(0, ...cum), lo = Math.min(0, ...cum);
      const spanV = (hi - lo) || 1;
      const x = i => cum.length > 1 ? pad + i * (W - 2 * pad) / (cum.length - 1) : W / 2;
      const y = v => pad + (hi - v) * (H - 2 * pad) / spanV;
      const pts = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const base = y(0).toFixed(1);
      const last = cum.length ? cum[cum.length - 1] : 0;
      const stroke = last >= 0 ? '#a6e3a1' : '#f38ba8';
      return `<div class="bw-chart-wrap">
        <div class="bw-chart-title">${esc(t('stats_chart_balance'))}</div>
        <svg class="bw-line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(t('stats_chart_balance'))}">
          <polygon points="${x(0).toFixed(1)},${base} ${pts} ${x(cum.length - 1).toFixed(1)},${base}"
            fill="${stroke}" opacity="0.14"></polygon>
          <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="currentColor" opacity="0.28"
            stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>
          <polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2"
            stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>
        </svg>
        <div class="bw-chart-note">
          <span>${periods.length ? esc(_periodLabel(periods[0].period, statsPeriod)) : ''}</span>
          <span>${last >= 0 ? '+' : ''}${fmtMoney(last)}</span>
          <span>${periods.length ? esc(_periodLabel(periods[periods.length - 1].period, statsPeriod)) : ''}</span>
        </div>
      </div>`;
    }

    async function loadStats() {
      const bodyEl = statsViewEl.querySelector('#bw-stats-body');
      if (!bodyEl) return;
      const seq = ++statsSeq;
      const qs = `?period=${statsPeriod}&from=${encodeURIComponent(statsFrom)}` +
                 `&to=${encodeURIComponent(statsTo)}&category=${encodeURIComponent(statsCategory)}`;
      let data = null;
      try { data = await api('/stats' + qs); } catch (e) { data = null; }
      if (seq !== statsSeq) return;   // a newer selection already went out

      if (!data && statsCategory !== 'all') {
        // The chosen category is gone — deleted, or unshared while the view was
        // left open. Falling back to everything beats an empty screen that
        // reads as there being no money in the app at all.
        statsCategory = 'all';
        const sel = statsViewEl.querySelector('#bw-stats-cat');
        if (sel) sel.value = 'all';
        return loadStats();
      }
      if (!data) { bodyEl.innerHTML = `<div class="bw-empty">${esc(t('no_stats'))}</div>`; return; }
      if (data.categories) {
        // Refreshed from every answer, not just the first, so a category added
        // in another view shows up in the picker without reopening statistics.
        statsCats = data.categories;
        const sel = statsViewEl.querySelector('#bw-stats-cat');
        const opts = _catOptions();
        if (sel && sel.innerHTML !== opts) sel.innerHTML = opts;
      }
      if (data.period && data.period !== statsPeriod) {
        // A range too long to draw day by day comes back grouped more coarsely.
        // The tabs follow it, so the chart and its label never disagree.
        statsPeriod = data.period;
        _markPeriodTab();
      }

      const tot = data.totals || { income: 0, expense: 0, net: 0, count: 0 };
      if (!tot.count) { bodyEl.innerHTML = `<div class="bw-empty">${esc(t('no_stats'))}</div>`; return; }

      const periods = data.periods || [];
      const byCat = data.by_category || [];
      const avg = periods.length ? tot.net / periods.length : 0;
      const maxCat = Math.max(1, ...byCat.map(c => c.income + c.expense));

      const cards = `<div class="bw-stat-cards">
        <div class="bw-stat-card"><span>${esc(t('stats_income'))}</span>
          <b class="bw-tx-pos">${fmtMoney(tot.income)}</b></div>
        <div class="bw-stat-card"><span>${esc(t('stats_expense'))}</span>
          <b class="bw-tx-neg">${fmtMoney(tot.expense)}</b></div>
        <div class="bw-stat-card"><span>${esc(t('stats_net'))}</span>
          <b class="${tot.net >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${tot.net >= 0 ? '+' : ''}${fmtMoney(tot.net)}</b></div>
        <div class="bw-stat-card"><span>${esc(t('stats_entries'))}</span><b>${tot.count}</b>
          <small>${esc(t('stats_avg_period'))}: ${avg >= 0 ? '+' : ''}${fmtMoney(avg)}</small></div>
      </div>`;

      const catRows = byCat.map((c, i) => `<div class="bw-cat-stat">
        <div class="bw-cat-stat-head">
          <span class="bw-legend-dot" style="background:${_statColor(i)}"></span>
          <span class="bw-cat-stat-name">${esc(c.title)}</span>
          <span class="${c.net >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${c.net >= 0 ? '+' : ''}${fmtMoney(c.net)}</span>
        </div>
        <div class="bw-cat-stat-bar">
          <i class="bw-cat-bar-income" style="width:${(c.income / maxCat * 100).toFixed(1)}%"></i>
          <i class="bw-cat-bar-expense" style="width:${(c.expense / maxCat * 100).toFixed(1)}%"></i>
        </div>
        <div class="bw-cat-stat-meta">
          <span class="bw-tx-pos">+${fmtMoney(c.income)}</span>
          <span class="bw-tx-neg">-${fmtMoney(c.expense)}</span>
          <span>${esc(t('stats_entries'))}: ${c.count}</span>
          <span>${esc(t('stats_share'))}: ${tot.expense > 0 ? Math.round(c.expense / tot.expense * 100) : 0}%</span>
        </div>
      </div>`).join('');

      const topRows = (data.top || []).map(r => `<div class="bw-top-row">
        <span class="bw-top-main">
          <span class="bw-top-cat">${esc(r.category)}${r.note ? ' — ' + esc(r.note) : ''}</span>
          <span class="bw-top-when">${esc(_htxDate(r.created_at))}</span>
        </span>
        <span class="${r.amount >= 0 ? 'bw-tx-pos' : 'bw-tx-neg'}">${r.amount >= 0 ? '+' : ''}${fmtMoney(r.amount)}</span>
      </div>`).join('');

      bodyEl.innerHTML = cards + _flowChart(periods) + _shareChart(byCat) + _balanceChart(periods) +
        `<div class="bw-section-label">${esc(t('stats_by_category'))}</div>${catRows}` +
        (topRows ? `<div class="bw-section-label">${esc(t('stats_top'))}</div>${topRows}` : '');
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
        const balanceClass = c.balance > 0 ? 'bw-balance-positive' : c.balance < 0 ? 'bw-balance-negative' : '';
        const progressPct = Math.max(0, Math.min(100, c.progress_pct || 0));
        const progressClass = progressPct >= 80 ? 'bw-progress-high' : progressPct >= 50 ? 'bw-progress-mid' : 'bw-progress-low';
        const goalBlock = c.goal ? `
          <div class="bw-progress"><div class="bw-progress-bar ${progressClass}" style="width:${progressPct}%"></div></div>
          <div class="bw-progress-label">${fmtMoney(c.balance)} / ${fmtMoney(c.goal)} (${c.progress_pct || 0}%)</div>
        ` : '';
        return `<div class="bw-card" data-id="${esc(c.id)}">
          <div class="bw-card-head">
            <div class="bw-card-title">${esc(c.title)}</div>
          </div>
          ${c.description ? `<div class="bw-card-desc">${esc(c.description)}</div>` : ''}
          <div class="bw-card-balance ${balanceClass}" data-action="history">${fmtMoney(c.balance)}</div>
          ${goalBlock}
          <div class="bw-card-meta">${c.has_children ? esc(t('subcategories')) : esc(allocLabel)}${c.member_count > 1 ? ` · ${c.member_count} ${esc(t('members'))}` : ''}</div>
          <div class="bw-card-actions">
            ${isOwner ? `${canHoldSubcats ? `<button class="bw-btn-icon" data-action="subcats" title="${esc(t('manage_subcategories'))}">📂</button>` : ''}
                         <button class="bw-btn-icon bw-btn-owner" data-action="share" title="${esc(t('owner'))} · ${esc(t('share'))}">🤝</button>
                         <button class="bw-btn-icon" data-action="edit" title="${esc(t('edit'))}">✎</button>
                         <button class="bw-btn-icon" data-action="delete" title="${esc(t('delete'))}">🗑</button>`
                      : `<button class="bw-btn-icon" data-action="leave" title="${esc(t('leave_category'))}">🚪</button>`}
          </div>
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
        <div class="bw-add-stack">
          <div class="bw-field"><label>${esc(t('amount'))}</label>
            <div class="bw-amount-group">
              <select id="bw-tx-sign">
                <option value="1" ${myDefaultSign === 1 ? 'selected' : ''}>+</option>
                <option value="-1" ${myDefaultSign === -1 ? 'selected' : ''}>−</option>
              </select>
              <input type="number" id="bw-tx-amount" step="0.01" min="0">
            </div>
          </div>
          <div class="bw-field"><label>${esc(t('note'))}</label>
            <div class="bw-note-group">
              <input type="text" id="bw-tx-note" maxlength="300">
              <button type="button" class="bw-suggest-btn" id="bw-tx-suggest-btn"
                title="${esc(t('frequent_notes'))}" aria-label="${esc(t('frequent_notes'))}">💬</button>
              <button class="bw-btn bw-btn-primary" id="bw-tx-add">${esc(t('save'))}</button>
            </div>
          </div>
        </div>
        <div class="bw-error" id="bw-tx-error" style="display:none"></div>
        <button class="bw-btn bw-btn-wide" id="bw-tx-history-toggle">${esc(t('show_history'))}</button>
        <div class="bw-tx-list" id="bw-tx-list" style="display:none"></div>
        <div class="bw-dialog-actions"><button class="bw-btn" id="bw-tx-close">${esc(t('close'))}</button></div>
      </div>
      <!-- Outside the dialog on purpose: the dialog scrolls its own overflow, so
           a panel nested inside it would be clipped at the dialog's edge and
           scroll away with the content. -->
      <div class="bw-suggest-pop" id="bw-tx-suggest-pop" hidden>
        <div class="bw-suggest-pop-head">${esc(t('frequent_notes'))}</div>
        <div class="bw-suggest" id="bw-tx-suggest"><div class="bw-loading"><span class="bw-spin"></span></div></div>
      </div>`);
      const errEl = ov.querySelector('#bw-tx-error');
      ov.querySelector('#bw-tx-close').onclick = () => { ov.remove(); if (onClose) onClose(); else refresh(); };

      async function fetchFreshBalance() {
        const list = cat.parent_id ? await api(`/categories/${cat.parent_id}/children`) : await api('/categories');
        return list.find(c => c.id === cat.id)?.balance;
      }

      function _txWho(p) { return p && (p.display_name || p.username) || ''; }

      function _txDate(iso) {
        return _fmtDateTime(new Date(iso));
      }

      // The history is the slowest thing in this dialog and most visits here are
      // to add one amount, so it is fetched only when it is actually asked for
      // and refreshed afterwards only while it is on screen.
      const historyBtn = ov.querySelector('#bw-tx-history-toggle');
      const listEl0 = ov.querySelector('#bw-tx-list');
      let historyOpen = false;
      historyBtn.onclick = () => {
        historyOpen = !historyOpen;
        listEl0.style.display = historyOpen ? '' : 'none';
        historyBtn.textContent = t(historyOpen ? 'hide_history' : 'show_history');
        if (historyOpen) {
          listEl0.innerHTML = `<div class="bw-loading"><span class="bw-spin"></span></div>`;
          loadTx();
        }
      };

      async function loadTx() {
        if (!historyOpen) return;
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

      // The wordings this person types into this category often enough that
      // retyping them is busywork. Tapping one adds it to the note; tapping it
      // again takes it back out, so a wrong tap costs one more tap and not a
      // trip into the text field.
      let suggestNotes = [];
      function _noteParts() {
        const raw = ov.querySelector('#bw-tx-note').value.split(',').map(x => x.trim()).filter(Boolean);
        // A suggestion may itself contain a comma, so neighbouring pieces are
        // put back together whenever they spell out one; otherwise such a chip
        // could never recognise its own text and a second tap would duplicate it.
        const out = [];
        for (let i = 0; i < raw.length; i++) {
          let merged = null;
          for (let j = raw.length; j > i + 1; j--) {
            const joined = raw.slice(i, j).join(', ');
            if (suggestNotes.includes(joined)) { merged = joined; i = j - 1; break; }
          }
          out.push(merged || raw[i]);
        }
        return out;
      }
      function _markSuggestions() {
        const parts = _noteParts();
        ov.querySelectorAll('#bw-tx-suggest .bw-suggest-chip').forEach(chip => {
          chip.classList.toggle('bw-suggest-on', parts.includes(chip.dataset.note));
        });
      }
      function _toggleSuggestion(note) {
        const input = ov.querySelector('#bw-tx-note');
        const parts = _noteParts();
        const at = parts.indexOf(note);
        if (at >= 0) parts.splice(at, 1); else parts.push(note);
        input.value = parts.join(', ');
        _markSuggestions();
        // Straight to the amount when it is still empty: the note is usually
        // the second thing typed, so after a tap there is nothing else to do.
        const amountEl = ov.querySelector('#bw-tx-amount');
        if (!amountEl.value) amountEl.focus();
      }
      const suggestBtn = ov.querySelector('#bw-tx-suggest-btn');
      const suggestPop = ov.querySelector('#bw-tx-suggest-pop');
      let suggestLoaded = false;
      function closeSuggest() { suggestPop.hidden = true; suggestBtn.classList.remove('bw-suggest-open'); }
      // Anchored to the button by measurement rather than by nesting: under it
      // normally, above it when there is no room below, and pushed back inside
      // when the widget is too short for either.
      function placeSuggest() {
        if (suggestPop.hidden) return;
        const b = suggestBtn.getBoundingClientRect();
        const o = ov.getBoundingClientRect();
        const h = suggestPop.offsetHeight;
        suggestPop.style.right = Math.max(8, o.right - b.right) + 'px';
        let top = b.bottom - o.top + 6;
        if (top + h > o.height - 8) {
          const above = b.top - o.top - 6 - h;
          top = above >= 8 ? above : Math.max(8, o.height - 8 - h);
        }
        suggestPop.style.top = top + 'px';
      }
      function openSuggest() {
        suggestPop.hidden = false;
        suggestBtn.classList.add('bw-suggest-open');
        placeSuggest();
        // Nothing is fetched until the picker is actually opened, so the usual
        // visit — type an amount, save, leave — costs one request less.
        if (!suggestLoaded) loadSuggestions();
      }
      suggestBtn.onclick = e => { e.stopPropagation(); suggestPop.hidden ? openSuggest() : closeSuggest(); };
      suggestPop.addEventListener('click', e => e.stopPropagation());
      ov.addEventListener('click', () => { if (!suggestPop.hidden) closeSuggest(); });
      ov.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !suggestPop.hidden) { e.stopPropagation(); closeSuggest(); }
      });

      async function loadSuggestions() {
        const wrapEl = ov.querySelector('#bw-tx-suggest');
        if (!wrapEl) return;
        wrapEl.innerHTML = `<div class="bw-loading"><span class="bw-spin"></span></div>`;
        let rows;
        try { rows = await api(`/categories/${cat.id}/note-suggestions`); }
        catch (e) { rows = []; }
        if (!Array.isArray(rows)) rows = [];
        suggestLoaded = true;
        suggestNotes = rows.map(r => r.note);
        if (!rows.length) {
          wrapEl.innerHTML = `<span class="bw-suggest-empty">${esc(t('no_frequent_notes'))}</span>`;
          placeSuggest();
          return;
        }
        wrapEl.innerHTML = rows.map(r =>
          `<button type="button" class="bw-suggest-chip" data-note="${esc(r.note)}" title="${esc(r.note)} · ${r.uses}\u00d7">${esc(r.note)}</button>`
        ).join('');
        wrapEl.querySelectorAll('.bw-suggest-chip').forEach(chip => {
          chip.onclick = () => _toggleSuggestion(chip.dataset.note);
        });
        _markSuggestions();
        placeSuggest();
      }
      ov.querySelector('#bw-tx-note').addEventListener('input', _markSuggestions);

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
          // A wording used for the second time only becomes a suggestion now, so
          // what was fetched is stale: refreshed at once while the picker is
          // open, and otherwise left for whenever it is next opened.
          suggestLoaded = false;
          if (!suggestPop.hidden) loadSuggestions();
        } catch (e) { errEl.textContent = t('save_failed'); errEl.style.display = 'block'; }
      }
      ov.querySelector('#bw-tx-add').onclick = () => submitTx();
      ov.querySelector('#bw-tx-note').addEventListener('keydown', e => { if (e.key === 'Enter') submitTx(); });
      ov.querySelector('#bw-tx-amount').addEventListener('keydown', e => { if (e.key === 'Enter') submitTx(); });
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
        <div class="bw-mass-summary" id="bw-mass-summary"></div>
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

      const summaryEl = ov.querySelector('#bw-mass-summary');

      // Nothing here refuses a plan that does not add up — a total can genuinely
      // be mistyped, and correcting it by hand has to stay possible. The dialog
      // only says, while the numbers are being typed, how far off the plan is.
      function markBalance() {
        const total = parseFloat(totalEl.value) || 0;
        let sum = 0;
        listEl.querySelectorAll('input[data-cid]').forEach(inp => { sum += parseFloat(inp.value) || 0; });
        sum = round2(sum);
        const diff = round2(sum - total);
        const neutral = !total && !sum;
        const ok = !neutral && diff === 0;
        summaryEl.classList.toggle('bw-mass-ok', ok);
        summaryEl.classList.toggle('bw-mass-off', !neutral && !ok);
        listEl.querySelectorAll('.bw-mass-row').forEach(row => {
          row.classList.toggle('bw-mass-ok', ok);
          row.classList.toggle('bw-mass-off', !neutral && !ok);
        });
        const state = neutral ? '' : ok ? esc(t('mass_exact'))
          : `${esc(diff > 0 ? t('mass_over') : t('mass_short'))} <strong>${fmtMoney(Math.abs(diff))}</strong>`;
        summaryEl.innerHTML =
          `<span>${esc(t('mass_allocated'))} <strong>${fmtMoney(sum)}</strong> / ${fmtMoney(total)}</span><span>${state}</span>`;
      }

      function recompute() {
        const plan = allocate(massCategories, parseFloat(totalEl.value) || 0);
        massCategories.forEach(c => {
          if (touched.has(c.id)) return;
          listEl.querySelector(`input[data-cid="${c.id}"]`).value = plan[c.id];
        });
        markBalance();
      }

      listEl.querySelectorAll('input[data-cid]').forEach(inp => {
        inp.addEventListener('input', () => { touched.add(inp.dataset.cid); markBalance(); });
      });
      totalEl.addEventListener('input', recompute);
      markBalance();

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
