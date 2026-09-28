// mvmWarehouse — the whole app UI, shared by the desktop window (main.js) and
// the Apps Hub public page (index.html). Both identify with the Apps Hub
// token, so they are the same program with the same rights; what a person
// sees is decided by their permissions in the company, which the server
// enforces anyway — hiding a tab here is only tidiness.
(function () {
  if (window.MvmWarehouse) return;

  const API = '/pub/mvmwarehouse';

  // Strings live in public/i18n.js (merged into window._i18n) so they travel
  // inside the store archive; this only looks them up and fills {vars}.
  function t(key, vars) {
    const table = window._i18n || {};
    const s = table[key] != null ? String(table[key]) : key;
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : m));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  const enc = encodeURIComponent;
  function lang() { return (window.mvmOS && window.mvmOS.lang) || document.documentElement.lang || 'en'; }
  function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
  // Half up, like the server — Math.round(x*100)/100 gets 1.005 wrong.
  function round2(n) { return Math.round((n + Math.sign(n) * 1e-9) * 100) / 100; }
  function today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  const AREAS = ['catalog', 'pricelists', 'partners', 'stock', 'orders', 'invoices', 'payments', 'reports', 'settings'];
  const ROLES = ['admin', 'manager', 'sales', 'storekeeper', 'accountant', 'viewer', 'custom'];
  const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CNY', 'TRY', 'UAH', 'PLN', 'RON', 'CZK', 'HUF',
    'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'RUB', 'INR', 'BGN'];
  const PAY_METHODS = ['bank', 'cash', 'card', 'cod', 'other'];
  const DOC_KINDS = ['receipt', 'writeoff', 'transfer', 'inventory', 'return'];

  const VIEWS = [
    ['dashboard', '📊', () => true],
    ['products', '🏷️', c => c('catalog') || c('stock')],
    ['stock', '📦', c => c('stock')],
    ['pricelists', '💲', c => c('pricelists')],
    ['partners', '👥', c => c('partners')],
    ['orders', '🛒', c => c('orders')],
    ['invoices', '🧾', c => c('invoices')],
    ['payments', '💳', c => c('payments')],
    ['reports', '📈', c => c('reports')],
    ['settings', '⚙️', c => c('settings')],
  ];

  let _styles = false;
  function injectStyles() {
    if (_styles) return;
    _styles = true;
    const st = document.createElement('style');
    st.textContent = `
.whw{position:relative;height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:.86rem;overflow:hidden;container-type:inline-size}
.whw *{box-sizing:border-box}
.whw-top{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--pub-surface2,#313244);flex-shrink:0}
.whw-company{background:none;border:none;color:inherit;font:inherit;font-weight:700;font-size:.95rem;cursor:pointer;padding:4px 6px;border-radius:6px;
  max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.whw-company:hover{background:var(--pub-surface2,#313244)}
.whw-grow{flex:1}
.whw-role{font-size:.72rem;color:var(--pub-fg2,#a6adc8);background:var(--pub-surface2,#313244);padding:2px 8px;border-radius:10px;white-space:nowrap}
.whw-main{flex:1;display:flex;min-height:0}
.whw-nav{width:172px;flex-shrink:0;border-right:1px solid var(--pub-surface2,#313244);overflow-y:auto;padding:6px}
.whw-nav button{display:flex;gap:8px;align-items:center;width:100%;background:none;border:none;color:var(--pub-fg2,#a6adc8);font:inherit;
  padding:8px 10px;border-radius:7px;cursor:pointer;text-align:left}
.whw-nav button:hover{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4)}
.whw-nav button.on{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
.whw-view{flex:1;overflow:auto;padding:14px;min-width:0}
@container (max-width: 720px){
  .whw-main{flex-direction:column}
  .whw-nav{width:auto;display:flex;overflow-x:auto;overflow-y:hidden;border-right:none;border-bottom:1px solid var(--pub-surface2,#313244);padding:4px;flex-shrink:0}
  .whw-nav button{width:auto;white-space:nowrap;flex-shrink:0}
  .whw-view{padding:10px}
}
.whw-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.whw-h h2{margin:0;font-size:1.05rem;flex:1;min-width:120px}
.whw-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.whw-bar>*{flex:0 1 auto}
.whw-bar input[type=search]{flex:1 1 180px;min-width:0}
.whw input,.whw select,.whw textarea{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);
  border-radius:6px;padding:6px 8px;font:inherit;max-width:100%}
.whw textarea{width:100%;min-height:60px;resize:vertical}
.whw input:focus,.whw select:focus,.whw textarea:focus{outline:none;border-color:var(--pub-accent,#89b4fa)}
.whw input:disabled,.whw select:disabled,.whw textarea:disabled{opacity:.7}
.whw-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid transparent;border-radius:6px;padding:6px 11px;cursor:pointer;
  font:inherit;white-space:nowrap}
.whw-btn:hover{background:var(--pub-border,#45475a)}
.whw-btn:disabled{opacity:.5;cursor:default}
.whw-btn.pri{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
.whw-btn.pri:hover{background:var(--pub-accent-hover,#a6c8ff)}
.whw-btn.dan{background:none;border-color:var(--pub-red,#f38ba8);color:var(--pub-red,#f38ba8)}
.whw-btn.dan:hover{background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e)}
.whw-btn.sm{padding:3px 8px;font-size:.78rem}
.whw-tabs{display:flex;gap:4px;margin-bottom:12px;overflow-x:auto;border-bottom:1px solid var(--pub-surface2,#313244)}
.whw-tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--pub-fg2,#a6adc8);font:inherit;padding:7px 10px;cursor:pointer;white-space:nowrap}
.whw-tabs button.on{color:var(--pub-fg,#cdd6f4);border-bottom-color:var(--pub-accent,#89b4fa);font-weight:600}
.whw-tablewrap{overflow-x:auto;border:1px solid var(--pub-surface2,#313244);border-radius:8px}
.whw-t{width:100%;border-collapse:collapse}
.whw-t th,.whw-t td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--pub-surface2,#313244);vertical-align:middle}
.whw-t th{font-size:.74rem;color:var(--pub-fg2,#a6adc8);font-weight:600;white-space:nowrap;background:var(--pub-surface1,rgba(0,0,0,.08))}
.whw-t tr:last-child td{border-bottom:none}
.whw-t tbody tr[data-id]{cursor:pointer}
.whw-t tbody tr[data-id]:hover{background:var(--pub-surface2,#313244)}
.whw-t .num{text-align:right;white-space:nowrap}
.whw-t td small,.whw-dim{color:var(--pub-dim,#6c7086)}
.whw-t .neg{color:var(--pub-red,#f38ba8)}
.whw-t .pos{color:var(--pub-green,#a6e3a1)}
.whw-thumb{width:34px;height:34px;border-radius:6px;object-fit:cover;background:var(--pub-surface2,#313244);display:block}
.whw-empty{color:var(--pub-dim,#6c7086);text-align:center;padding:36px 12px}
.whw-loading{color:var(--pub-dim,#6c7086);padding:24px;text-align:center}
.whw-error{color:var(--pub-red,#f38ba8);padding:12px}
.whw-badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:600;background:var(--pub-surface2,#313244);white-space:nowrap}
.whw-badge.draft{color:var(--pub-fg2,#a6adc8)}
.whw-badge.confirmed,.whw-badge.partial,.whw-badge.proforma{color:var(--pub-yellow,#f9e2af)}
.whw-badge.shipped,.whw-badge.posted,.whw-badge.paid{color:var(--pub-green,#a6e3a1)}
.whw-badge.cancelled,.whw-badge.credited,.whw-badge.credit_note{color:var(--pub-dim,#6c7086)}
.whw-badge.overdue,.whw-badge.unpaid{color:var(--pub-red,#f38ba8)}
.whw-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:14px}
.whw-card{background:var(--pub-surface2,#313244);border-radius:10px;padding:12px}
.whw-card .l{font-size:.74rem;color:var(--pub-fg2,#a6adc8)}
.whw-card .v{font-size:1.25rem;font-weight:700;margin-top:4px;word-break:break-word}
.whw-card .s{font-size:.74rem;color:var(--pub-dim,#6c7086);margin-top:2px}
.whw-card .v.bad{color:var(--pub-red,#f38ba8)}
.whw-sec{margin:18px 0 8px;font-size:.9rem;font-weight:700}
.whw-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}
.whw-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 12px}
.whw-f{display:flex;flex-direction:column;gap:4px;min-width:0}
.whw-f>span{font-size:.74rem;color:var(--pub-fg2,#a6adc8)}
.whw-f.wide{grid-column:1/-1}
.whw-f input,.whw-f select{width:100%}
.whw-chk{display:flex;align-items:center;gap:8px;cursor:pointer;align-self:end;padding:6px 0}
.whw-chk input{width:auto}
.whw-hint{font-size:.74rem;color:var(--pub-dim,#6c7086);margin-top:2px}
.whw-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;justify-content:flex-end}
.whw-actions .l{margin-right:auto}
.whw-ov{position:absolute;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:12px}
.whw-modal{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:12px;width:560px;max-width:100%;max-height:100%;
  display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.whw-modal.wide{width:980px}
.whw-mh{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--pub-surface2,#313244)}
.whw-mh b{flex:1;font-size:.98rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.whw-x{background:none;border:none;color:var(--pub-fg2,#a6adc8);font-size:1rem;cursor:pointer;padding:4px 8px;border-radius:6px}
.whw-x:hover{background:var(--pub-surface2,#313244)}
.whw-mb{padding:14px;overflow:auto}
.whw-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);background:var(--pub-surface2,#313244);border:1px solid var(--pub-border,#45475a);
  padding:8px 14px;border-radius:8px;z-index:60;max-width:90%;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.whw-toast.bad{border-color:var(--pub-red,#f38ba8);color:var(--pub-red,#f38ba8)}
.whw-picker{position:relative;flex:1 1 220px;min-width:0}
.whw-picker input{width:100%}
.whw-pick-list{position:absolute;left:0;right:0;top:100%;margin-top:2px;background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);
  border-radius:8px;max-height:260px;overflow:auto;z-index:5;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.whw-pick-list button{display:flex;flex-direction:column;align-items:flex-start;width:100%;background:none;border:none;color:inherit;font:inherit;
  padding:6px 10px;cursor:pointer;text-align:left}
.whw-pick-list button:hover{background:var(--pub-surface2,#313244)}
.whw-pick-list small{color:var(--pub-dim,#6c7086)}
.whw-pick-list .whw-dim{padding:8px 10px}
.whw-lineadd{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.whw-lines input{width:84px;padding:4px 6px}
.whw-lines input.name{width:100%;min-width:160px}
.whw-totals{margin-top:10px;margin-left:auto;max-width:320px}
.whw-totals div{display:flex;justify-content:space-between;gap:16px;padding:2px 0}
.whw-totals .g{font-weight:700;font-size:1rem;border-top:1px solid var(--pub-border,#45475a);padding-top:5px;margin-top:3px}
.whw-photos{display:flex;flex-wrap:wrap;gap:8px}
.whw-photo{position:relative;width:96px}
.whw-photo img{width:96px;height:96px;object-fit:cover;border-radius:8px;display:block;background:var(--pub-surface2,#313244)}
.whw-photo div{display:flex;justify-content:space-between;margin-top:2px}
.whw-photo button{background:none;border:none;color:var(--pub-fg2,#a6adc8);cursor:pointer;padding:2px 5px;border-radius:4px}
.whw-photo button:hover{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4)}
.whw-bars{display:flex;align-items:flex-end;gap:4px;height:150px;padding:8px 0}
.whw-bars>div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.whw-bars i{display:block;width:100%;max-width:34px;background:var(--pub-accent,#89b4fa);border-radius:4px 4px 0 0;min-height:1px}
.whw-bars span{font-size:.64rem;color:var(--pub-dim,#6c7086);margin-top:3px;white-space:nowrap}
.whw-list{display:flex;flex-direction:column;gap:8px}
.whw-item{display:flex;align-items:center;gap:10px;background:var(--pub-surface2,#313244);border-radius:10px;padding:10px 12px}
.whw-item .n{flex:1;min-width:0}
.whw-item .n b{display:block;overflow:hidden;text-overflow:ellipsis}
.whw-item .n small{color:var(--pub-fg2,#a6adc8)}
.whw-item.click{cursor:pointer}
.whw-item.click:hover{outline:1px solid var(--pub-accent,#89b4fa)}
.whw-av{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#1e1e2e;flex-shrink:0}
.whw-key{font-family:ui-monospace,monospace;background:var(--pub-surface2,#313244);padding:10px;border-radius:8px;word-break:break-all;user-select:all}
.whw-perms td{padding:4px 8px}
.whw-perms select{padding:3px 6px}
.whw-center{max-width:620px;margin:0 auto;padding:20px 14px}
.whw-center h1{font-size:1.3rem;margin:0 0 4px}
.whw-paper{background:#fff;color:#1a1a1a;border-radius:6px;padding:28px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:13px;line-height:1.45}
.whw-paper h1{font-size:22px;margin:0 0 2px;color:#1a1a1a}
.whw-paper .muted{color:#666}
.whw-paper .hd{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
.whw-paper .parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px}
.whw-paper .parties div{border:1px solid #ddd;border-radius:6px;padding:10px}
.whw-paper .parties b.t{display:block;font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
.whw-paper table{width:100%;border-collapse:collapse}
.whw-paper th,.whw-paper td{border-bottom:1px solid #e3e3e3;padding:6px;text-align:left}
.whw-paper th{font-size:11px;color:#555;background:#f5f5f5}
.whw-paper .num{text-align:right;white-space:nowrap}
.whw-paper .tot{margin-left:auto;margin-top:12px;width:300px;max-width:100%}
.whw-paper .tot div{display:flex;justify-content:space-between;padding:3px 0}
.whw-paper .tot .g{font-weight:700;font-size:15px;border-top:2px solid #1a1a1a;margin-top:4px;padding-top:6px}
.whw-paper .foot{margin-top:20px;font-size:12px;color:#444}
@container (max-width: 520px){ .whw-paper{padding:14px} .whw-paper .parties{grid-template-columns:1fr} }
`;
    document.head.appendChild(st);
  }

  // The printed invoice uses the same rules without the .whw container.
  const PRINT_CSS = `body{margin:0;background:#fff}@page{margin:14mm}.whw-paper{padding:0!important}` ;

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    root.innerHTML = '<div class="whw"></div>';
    const W = root.firstChild;
    const S = { companies: [], info: null, view: lsGet('mvmwarehouse_view') || 'dashboard', destroyed: false, refresh: null, sub: {} };

    // ── plumbing ───────────────────────────────────────────────
    function token() { return lsGet('apphub_token'); }
    function needLogin() {
      if (opts.onNeedLogin) { opts.onNeedLogin(); return; }
      W.innerHTML = `<div class="whw-empty">${esc(t('wh_login_needed'))}</div>`;
    }
    async function api(method, path, body, isForm) {
      const headers = { 'X-Pub-Token': token() || '' };
      let payload;
      if (isForm) payload = body;
      else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      let res;
      try { res = await fetch(API + path, { method, headers, body: payload }); }
      catch (_) { throw { error: 'network' }; }
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (res.status === 401) { needLogin(); throw { error: 'unauthorized' }; }
      if (!res.ok) throw Object.assign({ error: 'generic' }, data);
      return data;
    }
    const capi = (m, p, b, f) => api(m, `/c/${S.info.company.id}${p}`, b, f);
    function errText(e) {
      const code = (e && e.error) || 'generic';
      const vars = Object.assign({}, e);
      if (vars.field) vars.field = fieldLabel(vars.field);
      if (vars.area) vars.area = t('wh_nav_' + (vars.area === 'catalog' ? 'products' : vars.area));
      if (vars.available != null) vars.available = qtyf(vars.available);
      if (vars.needed != null) vars.needed = qtyf(vars.needed);
      if (vars.status) vars.status = t('wh_status_' + vars.status);
      const key = 'wh_err_' + code + (code === 'forbidden' && vars.area ? '_area' : '');
      const s = t(key, vars);
      return s === key ? t('wh_err_generic') : s;
    }
    function fieldLabel(f) {
      const k = 'wh_f_' + f;
      const s = t(k);
      return s === k ? f : s;
    }
    function can(area, lvl) { return !!S.info && (S.info.perms[area] || 0) >= (lvl || 1); }
    function cur() { return S.info.company.currency; }
    function money(n, c) {
      try { return new Intl.NumberFormat(lang(), { style: 'currency', currency: c || cur() }).format(n || 0); }
      catch (_) { return (n || 0).toFixed(2) + ' ' + (c || cur()); }
    }
    function qtyf(n) { return new Intl.NumberFormat(lang(), { maximumFractionDigits: 4 }).format(n || 0); }
    function fdate(s) {
      if (!s) return '';
      try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(s.length === 10 ? s + 'T00:00:00' : s)); }
      catch (_) { return s; }
    }
    function fdatetime(s) {
      if (!s) return '';
      try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'short', timeStyle: 'short' }).format(new Date(s)); }
      catch (_) { return s; }
    }
    const loading = () => `<div class="whw-loading">${esc(t('wh_loading'))}</div>`;
    const empty = (k) => `<div class="whw-empty">${esc(t(k || 'wh_nothing_here'))}</div>`;
    const badge = (cls, label) => `<span class="whw-badge ${esc(cls)}">${esc(label)}</span>`;
    function whName(id) { const w = S.info.warehouses.find(x => x.id === id); return w ? w.name : ''; }
    function defaultWh() { const w = S.info.warehouses.find(x => x.is_default) || S.info.warehouses[0]; return w ? w.id : ''; }
    function activeWhs() { return S.info.warehouses.filter(w => !w.archived); }
    function whOptions(sel, withAll) {
      return (withAll ? `<option value="">${esc(t('wh_all_warehouses'))}</option>` : '') +
        activeWhs().map(w => `<option value="${esc(w.id)}" ${w.id === sel ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    }
    function plOptions(sel, emptyLabel) {
      return `<option value="">${esc(emptyLabel || t('wh_base_prices'))}</option>` +
        S.info.price_lists.filter(p => p.active || p.id === sel)
          .map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }
    function catOptions(sel, emptyLabel) {
      const cats = S.info.categories;
      const byParent = {};
      cats.forEach(c => { (byParent[c.parent_id || ''] = byParent[c.parent_id || ''] || []).push(c); });
      const out = [];
      (function walk(pid, depth) {
        (byParent[pid] || []).forEach(c => {
          out.push(`<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${'  '.repeat(depth)}${esc(c.name)}</option>`);
          walk(c.id, depth + 1);
        });
      })('', 0);
      return `<option value="">${esc(emptyLabel || t('wh_no_category'))}</option>` + out.join('');
    }
    function opts2(values, sel, prefix) {
      return values.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(prefix ? t(prefix + v) : v)}</option>`).join('');
    }
    function readForm(scope) {
      const o = {};
      scope.querySelectorAll('[name]').forEach(el => {
        if (el.closest('[data-skip]')) return;
        o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      });
      return o;
    }
    function f(label, input, cls) { return `<label class="whw-f ${cls || ''}"><span>${esc(label)}</span>${input}</label>`; }
    function chk(name, label, on, dis) {
      return `<label class="whw-chk"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}><span>${esc(label)}</span></label>`;
    }
    function inp(name, val, extra) { return `<input name="${name}" value="${esc(val == null ? '' : val)}" ${extra || ''}>`; }

    function toast(msg, bad) {
      const d = document.createElement('div');
      d.className = 'whw-toast' + (bad ? ' bad' : '');
      d.textContent = msg;
      W.appendChild(d);
      setTimeout(() => d.remove(), bad ? 5000 : 2500);
    }
    function fail(e) { toast(errText(e), true); }
    function modal(title, html, wide) {
      const ov = document.createElement('div');
      ov.className = 'whw-ov';
      ov.innerHTML = `<div class="whw-modal ${wide ? 'wide' : ''}"><div class="whw-mh"><b>${esc(title)}</b>` +
        `<button class="whw-x" data-x title="${esc(t('wh_close'))}">✕</button></div><div class="whw-mb">${html}</div></div>`;
      W.appendChild(ov);
      const m = ov.querySelector('.whw-modal');
      m.close = () => ov.remove();
      m.body = ov.querySelector('.whw-mb');
      m.setTitle = s => { ov.querySelector('.whw-mh b').textContent = s; };
      ov.querySelector('[data-x]').onclick = m.close;
      ov.addEventListener('mousedown', e => { if (e.target === ov) m.close(); });
      return m;
    }
    function ask(msg, okLabel, danger) {
      return new Promise(resolve => {
        const m = modal(t('wh_confirm'), `<p style="margin:0">${esc(msg)}</p><div class="whw-actions">` +
          `<button class="whw-btn" data-no>${esc(t('wh_cancel'))}</button>` +
          `<button class="whw-btn ${danger ? 'dan' : 'pri'}" data-yes>${esc(okLabel || t('wh_ok'))}</button></div>`);
        const done = v => { m.close(); resolve(v); };
        m.querySelector('[data-no]').onclick = () => done(false);
        m.querySelector('[data-yes]').onclick = () => done(true);
        m.parentNode.addEventListener('mousedown', e => { if (e.target === m.parentNode) resolve(false); });
        m.querySelector('[data-x]').addEventListener('click', () => resolve(false));
      });
    }
    // Run an action with its button disabled, so a double click is one request.
    async function busy(btn, fn) {
      if (btn) btn.disabled = true;
      try { return await fn(); }
      catch (e) { fail(e); return undefined; }
      finally { if (btn && btn.isConnected) btn.disabled = false; }
    }
    function refreshView() { if (S.refresh) S.refresh(); }

    // A search box with a drop-down of products; Enter takes the first hit,
    // which is also what a barcode scanner typing into it does.
    function productPicker(host, getProducts, onPick, placeholder) {
      host.innerHTML = `<div class="whw-picker"><input type="search" placeholder="${esc(placeholder || t('wh_add_product'))}">` +
        `<div class="whw-pick-list" hidden></div></div>`;
      const input = host.querySelector('input');
      const list = host.querySelector('.whw-pick-list');
      let hits = [];
      function show() {
        const q = input.value.trim().toLowerCase();
        const products = getProducts();
        hits = products.filter(p => !q || p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) ||
          (p.barcode && p.barcode === input.value.trim())).slice(0, 40);
        list.innerHTML = hits.map((p, i) => {
          const avail = p.available != null ? ` · ${esc(t('wh_available_short', { n: qtyf(p.available) }))} ${esc(p.unit || '')}` : '';
          const price = p.list_price != null ? ` · ${money(p.list_price)}` : '';
          return `<button type="button" data-i="${i}"><span>${esc(p.name)}</span><small>${esc(p.sku || '')}${price}${avail}</small></button>`;
        }).join('') || `<div class="whw-dim">${esc(t('wh_nothing_found'))}</div>`;
        list.hidden = false;
      }
      function pick(i) { const p = hits[i]; if (!p) return; onPick(p); input.value = ''; list.hidden = true; input.focus(); }
      input.addEventListener('input', show);
      input.addEventListener('focus', show);
      input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); show(); pick(0); }
        if (e.key === 'Escape') { list.hidden = true; }
      });
      list.addEventListener('mousedown', e => {
        const b = e.target.closest('button');
        if (!b) return;
        e.preventDefault();
        pick(+b.dataset.i);
      });
    }

    // Order / invoice lines with live totals. Net per line, VAT per rate on
    // that rate's net — the same arithmetic the server stores.
    function salesLines(host, lines, editable, getProducts) {
      const st = lines.map(l => ({ product_id: l.product_id || null, name: l.name || '', sku: l.sku || '', unit: l.unit || '',
        qty: l.qty != null ? l.qty : 1, unit_price: l.unit_price != null ? l.unit_price : 0, discount: l.discount || 0,
        vat_rate: l.vat_rate != null ? l.vat_rate : 0 }));
      const vatOn = !!S.info.company.vat_registered;
      const lineNet = l => round2(num(l.qty) * num(l.unit_price) * (1 - num(l.discount) / 100));
      function totals() {
        let sub = 0; const byRate = {};
        st.forEach(l => { const n = lineNet(l); sub += n; byRate[num(l.vat_rate)] = (byRate[num(l.vat_rate)] || 0) + n; });
        let vat = 0; const rates = [];
        Object.keys(byRate).sort((a, b) => a - b).forEach(r => { const v = round2(byRate[r] * r / 100); vat += v; if (+r) rates.push([r, v]); });
        sub = round2(sub); vat = round2(vat);
        return { sub, vat, total: round2(sub + vat), rates };
      }
      function drawTotals() {
        const tt = totals();
        host.querySelector('.whw-totals').innerHTML =
          `<div><span>${esc(t('wh_subtotal'))}</span><span>${money(tt.sub)}</span></div>` +
          (vatOn ? tt.rates.map(([r, v]) => `<div><span>${esc(t('wh_vat_at', { rate: qtyf(+r) }))}</span><span>${money(v)}</span></div>`).join('') : '') +
          `<div class="g"><span>${esc(t('wh_total'))}</span><span>${money(tt.total)}</span></div>`;
        host.querySelectorAll('[data-net]').forEach(td => { td.textContent = money(lineNet(st[+td.dataset.net])); });
      }
      function draw() {
        const n = (i, k, extra) => editable
          ? `<input data-i="${i}" data-k="${k}" value="${esc(st[i][k])}" inputmode="decimal" ${extra || ''}>`
          : esc(k === 'unit_price' ? money(st[i][k]) : qtyf(st[i][k]) + (k === 'discount' || k === 'vat_rate' ? '%' : ''));
        const rows = st.map((l, i) => `<tr>
          <td>${editable && !l.product_id ? `<input class="name" data-i="${i}" data-k="name" value="${esc(l.name)}" placeholder="${esc(t('wh_line_name'))}">`
            : `${esc(l.name)}${l.sku ? ` <small>${esc(l.sku)}</small>` : ''}`}</td>
          <td class="num">${n(i, 'qty')} <small>${esc(l.unit || '')}</small></td>
          <td class="num">${n(i, 'unit_price')}</td>
          <td class="num">${n(i, 'discount')}</td>
          ${vatOn ? `<td class="num">${n(i, 'vat_rate')}</td>` : ''}
          <td class="num" data-net="${i}"></td>
          ${editable ? `<td><button class="whw-btn sm" data-del="${i}" title="${esc(t('wh_remove'))}">✕</button></td>` : ''}
        </tr>`).join('');
        host.innerHTML = `<div class="whw-tablewrap"><table class="whw-t whw-lines"><thead><tr>
            <th>${esc(t('wh_col_item'))}</th><th class="num">${esc(t('wh_col_qty'))}</th><th class="num">${esc(t('wh_col_price'))}</th>
            <th class="num">${esc(t('wh_col_discount'))}</th>${vatOn ? `<th class="num">${esc(t('wh_col_vat'))}</th>` : ''}
            <th class="num">${esc(t('wh_col_net'))}</th>${editable ? '<th></th>' : ''}</tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="whw-dim">${esc(t('wh_no_lines'))}</td></tr>`}</tbody></table></div>
          ${editable ? `<div class="whw-lineadd"><div class="pk" style="flex:1 1 220px;display:flex"></div>
            <button class="whw-btn" data-free>${esc(t('wh_free_line'))}</button></div>` : ''}
          <div class="whw-totals"></div>`;
        if (editable) {
          productPicker(host.querySelector('.pk'), getProducts, p => {
            const same = st.find(l => l.product_id === p.id);
            if (same) same.qty = num(same.qty) + 1;
            else st.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1,
              unit_price: p.list_price != null ? p.list_price : p.price, discount: 0, vat_rate: vatOn ? p.vat_rate : 0 });
            draw();
          });
          host.querySelector('[data-free]').onclick = () => {
            st.push({ product_id: null, name: '', sku: '', unit: '', qty: 1, unit_price: 0, discount: 0,
              vat_rate: vatOn ? S.info.company.default_vat : 0 });
            draw();
            const last = host.querySelectorAll('input.name');
            if (last.length) last[last.length - 1].focus();
          };
          host.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { st.splice(+b.dataset.del, 1); draw(); }; });
          host.querySelectorAll('input[data-k]').forEach(el => {
            el.addEventListener('input', () => { st[+el.dataset.i][el.dataset.k] = el.value; drawTotals(); });
          });
        }
        drawTotals();
      }
      draw();
      return {
        get: () => st.map(l => ({ product_id: l.product_id, name: l.name, unit: l.unit, qty: num(l.qty),
          unit_price: num(l.unit_price), discount: num(l.discount), vat_rate: num(l.vat_rate) })),
        reprice(products) {
          st.forEach(l => {
            const p = l.product_id && products.find(x => x.id === l.product_id);
            if (p) l.unit_price = p.list_price != null ? p.list_price : p.price;
          });
          draw();
        },
        count: () => st.length,
      };
    }

    // ── start & companies ──────────────────────────────────────
    async function start() {
      if (!token()) { needLogin(); return; }
      W.innerHTML = loading();
      try {
        const r = await api('GET', '/companies');
        S.companies = r.companies;
      } catch (e) {
        if (e.error !== 'unauthorized') W.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`;
        return;
      }
      const saved = lsGet('mvmwarehouse_company');
      const pick = S.companies.find(c => c.id === saved) || (S.companies.length === 1 ? S.companies[0] : null);
      if (pick) openCompany(pick.id);
      else renderCompanies();
    }
    async function openCompany(id) {
      W.innerHTML = loading();
      try {
        S.info = await api('GET', `/c/${id}/info`);
      } catch (e) {
        S.info = null;
        if (e.error === 'unauthorized') return;
        lsSet('mvmwarehouse_company', '');
        const r = await api('GET', '/companies').catch(() => ({ companies: [] }));
        S.companies = r.companies;
        renderCompanies();
        toast(errText(e), true);
        return;
      }
      lsSet('mvmwarehouse_company', id);
      render();
    }
    async function reloadInfo() { S.info = await capi('GET', '/info'); }

    function renderCompanies() {
      const back = S.info ? `<button class="whw-btn" data-back>← ${esc(S.info.company.name)}</button>` : '';
      W.innerHTML = `<div style="overflow:auto;height:100%"><div class="whw-center">
        <div class="whw-h"><h2>📦 ${esc(t('wh_companies'))}</h2>${back}</div>
        <p class="whw-dim" style="margin-top:0">${esc(t('wh_companies_intro'))}</p>
        <div class="whw-list">${S.companies.map(c => `<div class="whw-item click" data-open="${esc(c.id)}">
            <div class="n"><b>🏢 ${esc(c.name)}</b><small>${esc(t('wh_role_' + c.role))} · ${esc(c.currency)}</small></div>
            ${c.role !== 'owner' ? `<button class="whw-btn sm dan" data-leave="${esc(c.id)}">${esc(t('wh_leave'))}</button>` : ''}
          </div>`).join('') || empty('wh_no_companies')}</div>
        <div class="whw-sec">${esc(t('wh_new_company'))}</div>
        <div class="whw-form" data-new>
          ${f(t('wh_f_name'), inp('name', '', `placeholder="${esc(t('wh_company_name_ph'))}"`))}
          ${f(t('wh_f_currency'), `<select name="currency">${opts2(CURRENCIES, 'EUR')}</select>`)}
          ${f(t('wh_f_default_vat'), inp('default_vat', '20', 'inputmode="decimal"'))}
          ${chk('vat_registered', t('wh_f_vat_registered'), true)}
        </div>
        <div class="whw-actions"><button class="whw-btn pri" data-create>${esc(t('wh_create_company'))}</button></div>
      </div></div>`;
      const bb = W.querySelector('[data-back]');
      if (bb) bb.onclick = render;
      W.querySelectorAll('[data-open]').forEach(el => {
        el.onclick = e => { if (e.target.closest('[data-leave]')) return; openCompany(el.dataset.open); };
      });
      W.querySelectorAll('[data-leave]').forEach(b => {
        b.onclick = async () => {
          const c = S.companies.find(x => x.id === b.dataset.leave);
          if (!await ask(t('wh_leave_confirm', { name: c.name }), t('wh_leave'), true)) return;
          await busy(b, async () => {
            const me = await api('GET', '/companies');
            await api('DELETE', `/c/${c.id}/members/${enc(me.me)}`);
            if (S.info && S.info.company.id === c.id) S.info = null;
            S.companies = (await api('GET', '/companies')).companies;
            renderCompanies();
          });
        };
      });
      W.querySelector('[data-create]').onclick = e => busy(e.target, async () => {
        const body = readForm(W.querySelector('[data-new]'));
        body.warehouse_name = t('wh_main_warehouse');
        const r = await api('POST', '/companies', body);
        S.companies = (await api('GET', '/companies')).companies;
        S.view = 'settings';
        await openCompany(r.id);
      });
    }

    // ── shell ──────────────────────────────────────────────────
    function render() {
      if (S.destroyed) return;
      if (!S.info) { renderCompanies(); return; }
      const views = VIEWS.filter(v => v[2](can));
      if (!views.find(v => v[0] === S.view)) S.view = 'dashboard';
      W.innerHTML = `<div class="whw-top">
          <button class="whw-company" data-companies title="${esc(t('wh_switch_company'))}">🏢 ${esc(S.info.company.name)} ▾</button>
          <div class="whw-grow"></div><span class="whw-role">${esc(t('wh_role_' + S.info.role))}</span></div>
        <div class="whw-main"><nav class="whw-nav">${views.map(v =>
          `<button data-view="${v[0]}" class="${v[0] === S.view ? 'on' : ''}"><span>${v[1]}</span><span>${esc(t('wh_nav_' + v[0]))}</span></button>`).join('')}
        </nav><section class="whw-view"></section></div>`;
      W.querySelector('[data-companies]').onclick = async () => {
        S.companies = (await api('GET', '/companies').catch(() => ({ companies: S.companies }))).companies;
        renderCompanies();
      };
      W.querySelectorAll('[data-view]').forEach(b => {
        b.onclick = () => { S.view = b.dataset.view; lsSet('mvmwarehouse_view', S.view); render(); };
      });
      // On a phone the nav is a horizontal strip; keep the open view in sight.
      const nav = W.querySelector('.whw-nav');
      const on = nav.querySelector('.on');
      if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2;
      const el = W.querySelector('.whw-view');
      S.refresh = () => VIEW_FNS[S.view](el);
      S.refresh();
    }
    async function guard(el, fn) {
      el.innerHTML = loading();
      try { await fn(); }
      catch (e) { if (e && e.error === 'unauthorized') return; el.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
    }
    function head(title, buttons) { return `<div class="whw-h"><h2>${esc(title)}</h2>${buttons || ''}</div>`; }
    function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }

    // ── dashboard ──────────────────────────────────────────────
    function viewDashboard(el) {
      return guard(el, async () => {
        const d = await capi('GET', '/dashboard');
        const cards = [];
        if (d.orders) {
          cards.push(card(t('wh_open_orders'), String((d.orders.draft || 0) + (d.orders.confirmed || 0)),
            t('wh_open_orders_sub', { draft: d.orders.draft || 0, confirmed: d.orders.confirmed || 0 })));
        }
        if (d.receivables) {
          cards.push(card(t('wh_receivables'), money(d.receivables.open), t('wh_n_invoices', { n: d.receivables.open_count })));
          cards.push(card(t('wh_overdue'), money(d.receivables.overdue), t('wh_n_invoices', { n: d.receivables.overdue_count }),
            d.receivables.overdue > 0));
        }
        if (d.month_sales) cards.push(card(t('wh_month_sales'), money(d.month_sales.net), t('wh_without_vat')));
        if (d.stock_value != null) cards.push(card(t('wh_stock_value'), money(d.stock_value), t('wh_at_cost')));
        let html = head(t('wh_nav_dashboard'));
        html += cards.length ? `<div class="whw-cards">${cards.join('')}</div>` : '';
        const cols = [];
        if (d.recent_orders) {
          cols.push(`<div><div class="whw-sec">${esc(t('wh_recent_orders'))}</div>${d.recent_orders.length ? `<div class="whw-tablewrap"><table class="whw-t"><tbody>
            ${d.recent_orders.map(o => `<tr data-id="${esc(o.id)}" data-kind="order"><td>${esc(o.number)}<br><small>${esc(o.partner_name || '')}</small></td>
              <td>${badge(o.status, t('wh_status_' + o.status))}</td><td class="num">${money(o.total, o.currency)}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_orders')}</div>`);
        }
        if (d.low_stock) {
          cols.push(`<div><div class="whw-sec">${esc(t('wh_low_stock'))}</div>${d.low_stock.length ? `<div class="whw-tablewrap"><table class="whw-t">
            <thead><tr><th>${esc(t('wh_col_product'))}</th><th class="num">${esc(t('wh_col_on_hand'))}</th><th class="num">${esc(t('wh_col_min'))}</th></tr></thead><tbody>
            ${d.low_stock.map(p => `<tr data-id="${esc(p.id)}" data-kind="product"><td>${esc(p.name)} <small>${esc(p.sku || '')}</small></td>
              <td class="num neg">${qtyf(p.on_hand)} ${esc(p.unit || '')}</td><td class="num">${qtyf(p.min_stock)}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_stock_ok')}</div>`);
        }
        html += cols.length ? `<div class="whw-cols">${cols.join('')}</div>` : '';
        if (!cards.length && !cols.length) html += empty('wh_nothing_for_role');
        el.innerHTML = html;
        el.querySelectorAll('tr[data-id]').forEach(tr => {
          tr.onclick = () => (tr.dataset.kind === 'order' ? openOrder(tr.dataset.id) : openProduct(tr.dataset.id));
        });
      });
    }
    function card(label, value, sub, bad) {
      return `<div class="whw-card"><div class="l">${esc(label)}</div><div class="v ${bad ? 'bad' : ''}">${esc(value)}</div>` +
        (sub ? `<div class="s">${esc(sub)}</div>` : '') + '</div>';
    }

    // ── products ───────────────────────────────────────────────
    function viewProducts(el) {
      const F = S.sub.products = S.sub.products || { q: '', cat: '', active: '1', online: false, wh: '' };
      el.innerHTML = head(t('wh_nav_products'),
        (can('catalog', 2) ? `<button class="whw-btn" data-cats>${esc(t('wh_categories'))}</button>
          <button class="whw-btn pri" data-new>${esc(t('wh_new_product'))}</button>` : '')) +
        `<div class="whw-bar">
          <input type="search" data-q value="${esc(F.q)}" placeholder="${esc(t('wh_search_products'))}">
          <select data-cat>${catOptions(F.cat, t('wh_all_categories'))}</select>
          ${can('stock') ? `<select data-wh>${whOptions(F.wh, true)}</select>` : ''}
          <select data-active><option value="1" ${F.active === '1' ? 'selected' : ''}>${esc(t('wh_active'))}</option>
            <option value="0" ${F.active === '0' ? 'selected' : ''}>${esc(t('wh_archived'))}</option></select>
          ${chk('online', t('wh_online_only'), F.online)}
        </div><div data-list></div>`;
      const list = el.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const qs = `?limit=1000&q=${enc(F.q)}&category_id=${enc(F.cat)}&active=${F.active}&warehouse_id=${enc(F.wh)}` +
            (F.online ? '&online=1' : '');
          const r = await capi('GET', '/products' + qs);
          const stock = can('stock');
          const cats = Object.fromEntries(S.info.categories.map(c => [c.id, c.name]));
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr>
              <th></th><th>${esc(t('wh_col_product'))}</th><th>${esc(t('wh_col_category'))}</th><th class="num">${esc(t('wh_col_price'))}</th>
              ${stock ? `<th class="num">${esc(t('wh_col_on_hand'))}</th><th class="num">${esc(t('wh_col_available'))}</th>` : ''}
              <th>${esc(t('wh_col_online'))}</th></tr></thead><tbody>
            ${r.items.map(p => `<tr data-id="${esc(p.id)}">
              <td>${p.images[0] ? `<img class="whw-thumb" src="${esc(p.images[0])}" alt="" loading="lazy">` : '<span class="whw-thumb"></span>'}</td>
              <td>${esc(p.name)}<br><small>${esc(p.sku || '')}${p.is_service ? ' · ' + esc(t('wh_service')) : ''}</small></td>
              <td>${esc(cats[p.category_id] || '')}</td>
              <td class="num">${money(p.price)}<br><small>${esc(p.unit || '')}</small></td>
              ${stock ? (p.on_hand != null ? `<td class="num ${p.min_stock && p.on_hand <= p.min_stock ? 'neg' : ''}">${qtyf(p.on_hand)}</td>
                <td class="num">${qtyf(p.available)}</td>` : '<td></td><td></td>') : ''}
              <td>${p.online ? '🌐' : ''}</td></tr>`).join('')}
            </tbody></table></div>
            <div class="whw-hint">${esc(t('wh_n_of_total', { n: r.items.length, total: r.total }))}</div>` : empty('wh_no_products');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openProduct(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      el.querySelector('[data-q]').addEventListener('input', debounce(e => { F.q = e.target.value; load(); }, 250));
      el.querySelector('[data-cat]').onchange = e => { F.cat = e.target.value; load(); };
      el.querySelector('[data-active]').onchange = e => { F.active = e.target.value; load(); };
      el.querySelector('[name=online]').onchange = e => { F.online = e.target.checked; load(); };
      const whs = el.querySelector('[data-wh]');
      if (whs) whs.onchange = e => { F.wh = e.target.value; load(); };
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = () => openProduct(null);
      const cb = el.querySelector('[data-cats]');
      if (cb) cb.onclick = openCategories;
      return load();
    }

    async function openProduct(id) {
      const m = modal(id ? t('wh_product') : t('wh_new_product'), loading(), true);
      let p;
      try {
        p = id ? await capi('GET', `/products/${id}`) : { name: '', sku: '', barcode: '', unit: t('wh_default_unit'), category_id: '',
          is_service: 0, vat_rate: S.info.company.vat_registered ? S.info.company.default_vat : 0, price: 0, cost_price: 0,
          min_stock: 0, active: 1, online: 0, web_description: '', description: '', images: [] };
      } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      const ed = can('catalog', 2);
      const dis = ed ? '' : 'disabled';
      if (id) m.setTitle(p.name);
      m.body.innerHTML = `<div class="whw-form" data-main>
          ${f(t('wh_f_name'), inp('name', p.name, dis), 'wide')}
          ${f(t('wh_f_sku'), inp('sku', p.sku, dis))}
          ${f(t('wh_f_barcode'), inp('barcode', p.barcode, dis))}
          ${f(t('wh_f_unit'), inp('unit', p.unit, dis))}
          ${f(t('wh_f_category'), `<select name="category_id" ${dis}>${catOptions(p.category_id)}</select>`)}
          ${f(t('wh_f_price'), inp('price', p.price, `inputmode="decimal" ${dis}`))}
          ${S.info.company.vat_registered ? f(t('wh_f_vat_rate'), inp('vat_rate', p.vat_rate, `inputmode="decimal" ${dis}`)) : ''}
          ${can('costs') ? f(t('wh_f_cost_price'), inp('cost_price', p.cost_price, `inputmode="decimal" ${dis}`)) : ''}
          ${f(t('wh_f_min_stock'), inp('min_stock', p.min_stock, `inputmode="decimal" ${dis}`))}
          ${chk('is_service', t('wh_f_is_service'), p.is_service, !ed)}
          ${chk('active', t('wh_f_active'), p.active, !ed)}
          ${f(t('wh_f_description'), `<textarea name="description" ${dis}>${esc(p.description)}</textarea>`, 'wide')}
        </div>
        <div class="whw-sec">🌐 ${esc(t('wh_online_shop'))}</div>
        <div class="whw-form" data-web>
          ${chk('online', t('wh_f_online'), p.online, !ed)}
          ${f(t('wh_f_web_description'), `<textarea name="web_description" style="min-height:90px" ${dis}>${esc(p.web_description)}</textarea>`, 'wide')}
        </div>
        <div class="whw-hint">${esc(t('wh_online_hint'))}</div>
        <div class="whw-sec">${esc(t('wh_photos'))}</div>
        <div data-photos></div>
        ${p.stock ? `<div class="whw-sec">${esc(t('wh_stock_by_warehouse'))}</div><div class="whw-tablewrap"><table class="whw-t"><thead><tr>
            <th>${esc(t('wh_col_warehouse'))}</th><th class="num">${esc(t('wh_col_on_hand'))}</th><th class="num">${esc(t('wh_col_reserved'))}</th>
            <th class="num">${esc(t('wh_col_available'))}</th></tr></thead><tbody>
          ${p.stock.map(s => `<tr><td>${esc(s.name)}</td><td class="num">${qtyf(s.on_hand)}</td><td class="num">${qtyf(s.reserved)}</td>
            <td class="num">${qtyf(s.available)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${p.prices && p.prices.length ? `<div class="whw-sec">${esc(t('wh_prices_by_list'))}</div><div class="whw-tablewrap"><table class="whw-t"><tbody>
          ${p.prices.map(x => `<tr><td>${esc(x.name)}</td><td class="num">${money(x.price)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${p.movements && p.movements.length ? `<div class="whw-sec">${esc(t('wh_recent_movements'))}</div>${movementsTable(p.movements, false)}` : ''}
        <div class="whw-actions">
          ${id && ed ? `<button class="whw-btn dan l" data-del>${esc(t('wh_delete'))}</button>` : ''}
          <button class="whw-btn" data-x2>${esc(t('wh_close'))}</button>
          ${ed ? `<button class="whw-btn pri" data-save>${esc(t('wh_save'))}</button>` : ''}
        </div>`;
      m.querySelector('[data-x2]').onclick = m.close;
      const photos = m.querySelector('[data-photos]');
      function drawPhotos() {
        if (!id) { photos.innerHTML = `<div class="whw-hint">${esc(t('wh_photos_after_save'))}</div>`; return; }
        photos.innerHTML = `<div class="whw-photos">${p.images.map((u, i) => `<div class="whw-photo"><img src="${esc(u)}" alt="">
            ${ed ? `<div><button data-mv="${i}" data-d="-1" title="${esc(t('wh_move_left'))}">◀</button>
              <button data-rm="${i}" title="${esc(t('wh_remove'))}">🗑</button>
              <button data-mv="${i}" data-d="1" title="${esc(t('wh_move_right'))}">▶</button></div>` : ''}</div>`).join('')}
          </div>${!p.images.length ? `<div class="whw-hint">${esc(t('wh_no_photos'))}</div>` : ''}
          ${ed && p.images.length < 10 ? `<label class="whw-btn" style="display:inline-block;margin-top:8px">${esc(t('wh_add_photos'))}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></label>` : ''}`;
        photos.querySelectorAll('[data-rm]').forEach(b => {
          b.onclick = () => busy(b, async () => {
            if (!await ask(t('wh_remove_photo_confirm'), t('wh_remove'), true)) return;
            const name = p.images[+b.dataset.rm].split('/').pop();
            p = Object.assign(p, await capi('DELETE', `/products/${id}/images/${enc(name)}`));
            drawPhotos(); refreshView();
          });
        });
        photos.querySelectorAll('[data-mv]').forEach(b => {
          b.onclick = () => busy(b, async () => {
            const i = +b.dataset.mv, j = i + +b.dataset.d;
            if (j < 0 || j >= p.images.length) return;
            const imgs = p.images.slice();
            [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
            p = Object.assign(p, await capi('PUT', `/products/${id}`, { images: imgs }));
            drawPhotos(); refreshView();
          });
        });
        const file = photos.querySelector('input[type=file]');
        if (file) file.onchange = async () => {
          const files = Array.from(file.files || []);
          for (const fl of files) {
            const fd = new FormData();
            fd.append('file', fl);
            try { p = Object.assign(p, await capi('POST', `/products/${id}/images`, fd, true)); }
            catch (e) { fail(e); break; }
          }
          drawPhotos(); refreshView();
        };
      }
      drawPhotos();
      const save = m.querySelector('[data-save]');
      if (save) save.onclick = () => busy(save, async () => {
        const body = Object.assign(readForm(m.querySelector('[data-main]')), readForm(m.querySelector('[data-web]')));
        if (id) await capi('PUT', `/products/${id}`, body);
        else {
          const r = await capi('POST', '/products', body);
          m.close();
          refreshView();
          toast(t('wh_saved'));
          openProduct(r.id);
          return;
        }
        toast(t('wh_saved'));
        m.close();
        refreshView();
      });
      const del = m.querySelector('[data-del]');
      if (del) del.onclick = () => busy(del, async () => {
        if (!await ask(t('wh_delete_product_confirm', { name: p.name }), t('wh_delete'), true)) return;
        const r = await capi('DELETE', `/products/${id}`);
        toast(r.archived ? t('wh_archived_instead') : t('wh_deleted'));
        m.close();
        refreshView();
      });
    }

    function openCategories() {
      const m = modal(t('wh_categories'), '');
      function draw() {
        const cats = S.info.categories;
        m.body.innerHTML = `<div class="whw-list">${cats.length ? cats.map(c => `<div class="whw-item">
            <div class="n"><b>${esc(c.name)}</b>${c.parent_id ? `<small>${esc((cats.find(x => x.id === c.parent_id) || {}).name || '')}</small>` : ''}</div>
            <button class="whw-btn sm" data-edit="${esc(c.id)}">${esc(t('wh_edit'))}</button>
            <button class="whw-btn sm dan" data-del="${esc(c.id)}">✕</button></div>`).join('') : empty('wh_no_categories')}</div>
          <div class="whw-sec" data-formtitle>${esc(t('wh_new_category'))}</div>
          <div class="whw-form" data-form>${f(t('wh_f_name'), inp('name', ''))}
            ${f(t('wh_f_parent'), `<select name="parent_id">${catOptions('', t('wh_top_level'))}</select>`)}</div>
          <div class="whw-actions"><button class="whw-btn pri" data-save>${esc(t('wh_save'))}</button></div>`;
        let editing = null;
        m.querySelectorAll('[data-edit]').forEach(b => {
          b.onclick = () => {
            const c = cats.find(x => x.id === b.dataset.edit);
            editing = c.id;
            m.querySelector('[data-formtitle]').textContent = t('wh_edit_category');
            m.querySelector('[name=name]').value = c.name;
            m.querySelector('[name=parent_id]').value = c.parent_id || '';
            m.querySelector('[name=name]').focus();
          };
        });
        m.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = () => busy(b, async () => {
            if (!await ask(t('wh_delete_category_confirm'), t('wh_delete'), true)) return;
            await capi('DELETE', `/categories/${b.dataset.del}`);
            await reloadInfo(); draw(); refreshView();
          });
        });
        const sv = m.querySelector('[data-save]');
        sv.onclick = () => busy(sv, async () => {
          const body = readForm(m.querySelector('[data-form]'));
          if (editing) await capi('PUT', `/categories/${editing}`, body);
          else await capi('POST', '/categories', body);
          await reloadInfo(); draw(); refreshView();
        });
      }
      draw();
    }

    // ── stock ──────────────────────────────────────────────────
    function viewStock(el) {
      const F = S.sub.stock = S.sub.stock || { tab: 'levels', wh: '', q: '', low: false, kind: '' };
      const tabs = ['levels', 'documents', 'movements'];
      el.innerHTML = head(t('wh_nav_stock'), can('stock', 2)
        ? `<select data-newdoc><option value="">${esc(t('wh_new_document'))}</option>${opts2(DOC_KINDS, '', 'wh_doc_')}</select>` : '') +
        `<div class="whw-tabs">${tabs.map(x => `<button data-tab="${x}" class="${x === F.tab ? 'on' : ''}">${esc(t('wh_tab_' + x))}</button>`).join('')}</div>
        <div data-body></div>`;
      el.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { F.tab = b.dataset.tab; viewStock(el); }; });
      const nd = el.querySelector('[data-newdoc]');
      if (nd) nd.onchange = () => { const k = nd.value; nd.value = ''; if (k) openDoc(null, k); };
      const body = el.querySelector('[data-body]');
      if (F.tab === 'levels') return stockLevels(body, F);
      if (F.tab === 'documents') return stockDocs(body, F);
      return stockMovements(body, F);
    }
    function stockLevels(body, F) {
      body.innerHTML = `<div class="whw-bar"><input type="search" data-q value="${esc(F.q)}" placeholder="${esc(t('wh_search_products'))}">
          <select data-wh>${whOptions(F.wh, true)}</select>${chk('low', t('wh_low_only'), F.low)}</div><div data-list></div>`;
      const list = body.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/products?limit=5000&services=0&q=${enc(F.q)}&warehouse_id=${enc(F.wh)}${F.low ? '&low=1' : ''}`);
          const costs = can('costs');
          let value = 0;
          r.items.forEach(p => { if (costs && p.on_hand > 0) value += p.on_hand * (p.cost_price || 0); });
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr>
              <th>${esc(t('wh_col_product'))}</th><th class="num">${esc(t('wh_col_on_hand'))}</th><th class="num">${esc(t('wh_col_reserved'))}</th>
              <th class="num">${esc(t('wh_col_available'))}</th><th class="num">${esc(t('wh_col_min'))}</th>
              ${costs ? `<th class="num">${esc(t('wh_col_cost'))}</th><th class="num">${esc(t('wh_col_value'))}</th>` : ''}</tr></thead><tbody>
            ${r.items.map(p => `<tr data-id="${esc(p.id)}"><td>${esc(p.name)}<br><small>${esc(p.sku || '')}</small></td>
              <td class="num ${p.min_stock && p.on_hand <= p.min_stock ? 'neg' : ''}">${qtyf(p.on_hand)} <small>${esc(p.unit || '')}</small></td>
              <td class="num">${qtyf(p.reserved)}</td><td class="num">${qtyf(p.available)}</td><td class="num">${p.min_stock ? qtyf(p.min_stock) : ''}</td>
              ${costs ? `<td class="num">${money(p.cost_price)}</td><td class="num">${money(Math.max(0, p.on_hand) * p.cost_price)}</td>` : ''}</tr>`).join('')}
            </tbody></table></div>${costs ? `<div class="whw-totals"><div class="g"><span>${esc(t('wh_stock_value'))}</span><span>${money(value)}</span></div></div>` : ''}`
            : empty('wh_no_products');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openProduct(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      body.querySelector('[data-q]').addEventListener('input', debounce(e => { F.q = e.target.value; load(); }, 250));
      body.querySelector('[data-wh]').onchange = e => { F.wh = e.target.value; load(); };
      body.querySelector('[name=low]').onchange = e => { F.low = e.target.checked; load(); };
      return load();
    }
    function stockDocs(body, F) {
      body.innerHTML = `<div class="whw-bar"><select data-kind><option value="">${esc(t('wh_all_kinds'))}</option>${opts2(DOC_KINDS, F.kind, 'wh_doc_')}</select></div>
        <div data-list></div>`;
      const list = body.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/stockdocs?kind=${enc(F.kind)}`);
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr>
              <th>${esc(t('wh_col_number'))}</th><th>${esc(t('wh_col_kind'))}</th><th>${esc(t('wh_col_date'))}</th>
              <th>${esc(t('wh_col_warehouse'))}</th><th>${esc(t('wh_col_partner'))}</th><th>${esc(t('wh_col_status'))}</th></tr></thead><tbody>
            ${r.items.map(d => `<tr data-id="${esc(d.id)}"><td>${esc(d.number)}</td><td>${esc(t('wh_doc_' + d.kind))}</td><td>${fdate(d.doc_date)}</td>
              <td>${esc(whName(d.warehouse_id))}${d.to_warehouse_id ? ' → ' + esc(whName(d.to_warehouse_id)) : ''}</td>
              <td>${esc(d.partner_name || '')}</td><td>${badge(d.status, t('wh_status_' + d.status))}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_documents');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openDoc(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      body.querySelector('[data-kind]').onchange = e => { F.kind = e.target.value; load(); };
      return load();
    }
    function movementsTable(items, withProduct) {
      return `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_col_date'))}</th>
          ${withProduct ? `<th>${esc(t('wh_col_product'))}</th>` : ''}<th>${esc(t('wh_col_warehouse'))}</th><th>${esc(t('wh_col_kind'))}</th>
          <th>${esc(t('wh_col_document'))}</th><th class="num">${esc(t('wh_col_qty'))}</th></tr></thead><tbody>
        ${items.map(mv => `<tr><td>${fdatetime(mv.created_at)}</td>
          ${withProduct ? `<td>${esc(mv.product_name || '')} <small>${esc(mv.sku || '')}</small></td>` : ''}
          <td>${esc(mv.warehouse_name || whName(mv.warehouse_id))}</td><td>${esc(t('wh_mv_' + mv.kind))}</td><td>${esc(mv.ref_number || '')}</td>
          <td class="num ${mv.qty < 0 ? 'neg' : 'pos'}">${mv.qty > 0 ? '+' : ''}${qtyf(mv.qty)}</td></tr>`).join('')}
        </tbody></table></div>`;
    }
    function stockMovements(body, F) {
      body.innerHTML = `<div class="whw-bar"><select data-wh>${whOptions(F.wh, true)}</select></div><div data-list></div>`;
      const list = body.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/movements?limit=500&warehouse_id=${enc(F.wh)}`);
          list.innerHTML = r.items.length ? movementsTable(r.items, true) : empty('wh_no_movements');
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      body.querySelector('[data-wh]').onchange = e => { F.wh = e.target.value; load(); };
      return load();
    }

    async function openDoc(id, kind) {
      const m = modal(id ? t('wh_document') : t('wh_doc_' + kind), loading(), true);
      let d, products, partners = [];
      try {
        d = id ? await capi('GET', `/stockdocs/${id}`) : { kind, status: 'draft', warehouse_id: defaultWh(), to_warehouse_id: '',
          partner_id: '', doc_date: today(), reference: '', note: '', lines: [] };
        kind = d.kind;
        const wantsPartner = kind === 'receipt' || kind === 'return';
        [products, partners] = await Promise.all([
          capi('GET', `/products?limit=5000&services=0&warehouse_id=${enc(d.warehouse_id)}`).then(r => r.items),
          wantsPartner && (can('partners') || can('orders') || can('invoices') || can('stock'))
            ? capi('GET', `/partners?limit=5000&kind=${kind === 'receipt' ? 'supplier' : 'customer'}`).then(r => r.items) : [],
        ]);
      } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      if (id) m.setTitle(`${t('wh_doc_' + kind)} ${d.number}`);
      const ed = can('stock', 2) && d.status === 'draft';
      const dis = ed ? '' : 'disabled';
      const withCost = (kind === 'receipt' || kind === 'return') && can('costs');
      const lines = d.lines.map(l => ({ product_id: l.product_id, name: l.name, sku: l.sku, unit: l.unit, qty: l.qty,
        unit_cost: l.unit_cost != null ? l.unit_cost : '', delta: l.delta }));
      const hasPartner = kind === 'receipt' || kind === 'return';
      m.body.innerHTML = `<div class="whw-form" data-head>
          ${f(kind === 'transfer' ? t('wh_f_from_warehouse') : t('wh_f_warehouse'), `<select name="warehouse_id" ${dis}>${whOptions(d.warehouse_id)}</select>`)}
          ${kind === 'transfer' ? f(t('wh_f_to_warehouse'), `<select name="to_warehouse_id" ${dis}><option value=""></option>${whOptions(d.to_warehouse_id)}</select>`) : ''}
          ${hasPartner ? f(kind === 'receipt' ? t('wh_f_supplier') : t('wh_f_customer'), `<select name="partner_id" ${dis}><option value=""></option>
            ${partners.map(p => `<option value="${esc(p.id)}" ${p.id === d.partner_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`) : ''}
          ${f(t('wh_f_date'), `<input type="date" name="doc_date" value="${esc(d.doc_date)}" ${dis}>`)}
          ${f(t('wh_f_reference'), inp('reference', d.reference, `placeholder="${esc(t('wh_reference_ph'))}" ${dis}`))}
          ${f(t('wh_f_note'), inp('note', d.note, dis), 'wide')}
        </div>
        ${kind === 'inventory' ? `<div class="whw-hint">${esc(t('wh_inventory_hint'))}</div>` : ''}
        <div class="whw-sec">${esc(t('wh_lines'))}</div><div data-lines></div>
        <div class="whw-actions" data-acts></div>`;
      const host = m.querySelector('[data-lines]');
      function drawLines() {
        host.innerHTML = `<div class="whw-tablewrap"><table class="whw-t whw-lines"><thead><tr><th>${esc(t('wh_col_product'))}</th>
            <th class="num">${esc(kind === 'inventory' ? t('wh_col_counted') : t('wh_col_qty'))}</th>
            ${withCost ? `<th class="num">${esc(t('wh_col_unit_cost'))}</th>` : ''}
            ${kind === 'inventory' && d.status !== 'draft' ? `<th class="num">${esc(t('wh_col_difference'))}</th>` : ''}
            ${ed ? '<th></th>' : ''}</tr></thead><tbody>
          ${lines.map((l, i) => `<tr><td>${esc(l.name)} <small>${esc(l.sku || '')}</small></td>
            <td class="num">${ed ? `<input data-i="${i}" data-k="qty" value="${esc(l.qty)}" inputmode="decimal">` : qtyf(l.qty)} <small>${esc(l.unit || '')}</small></td>
            ${withCost ? `<td class="num">${ed ? `<input data-i="${i}" data-k="unit_cost" value="${esc(l.unit_cost)}" inputmode="decimal">` : money(l.unit_cost)}</td>` : ''}
            ${kind === 'inventory' && d.status !== 'draft' ? `<td class="num ${l.delta < 0 ? 'neg' : 'pos'}">${l.delta > 0 ? '+' : ''}${qtyf(l.delta || 0)}</td>` : ''}
            ${ed ? `<td><button class="whw-btn sm" data-del="${i}">✕</button></td>` : ''}</tr>`).join('') ||
            `<tr><td colspan="5" class="whw-dim">${esc(t('wh_no_lines'))}</td></tr>`}
          </tbody></table></div>${ed ? '<div class="whw-lineadd"><div class="pk" style="flex:1;display:flex"></div></div>' : ''}`;
        if (!ed) return;
        productPicker(host.querySelector('.pk'), () => products, p => {
          const same = lines.find(l => l.product_id === p.id);
          if (same) same.qty = num(same.qty) + 1;
          else lines.push({ product_id: p.id, name: p.name, sku: p.sku, unit: p.unit,
            qty: kind === 'inventory' ? (p.on_hand || 0) : 1, unit_cost: withCost ? (p.cost_price || 0) : '' });
          drawLines();
        });
        host.querySelectorAll('input[data-k]').forEach(x => { x.oninput = () => { lines[+x.dataset.i][x.dataset.k] = x.value; }; });
        host.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { lines.splice(+b.dataset.del, 1); drawLines(); }; });
      }
      drawLines();
      const whSel = m.querySelector('[name=warehouse_id]');
      if (whSel && ed) whSel.onchange = async () => {
        products = (await capi('GET', `/products?limit=5000&services=0&warehouse_id=${enc(whSel.value)}`).catch(() => ({ items: products }))).items;
      };
      const acts = m.querySelector('[data-acts]');
      const btns = [];
      if (id && can('stock', 2) && d.status !== 'posted') btns.push(`<button class="whw-btn dan l" data-a="delete">${esc(t('wh_delete'))}</button>`);
      if (id && can('stock', 2) && d.status === 'posted') btns.push(`<button class="whw-btn dan l" data-a="cancel">${esc(t('wh_reverse_document'))}</button>`);
      btns.push(`<button class="whw-btn" data-a="close">${esc(t('wh_close'))}</button>`);
      if (ed) {
        btns.push(`<button class="whw-btn" data-a="save">${esc(t('wh_save_draft'))}</button>`);
        btns.push(`<button class="whw-btn pri" data-a="post">${esc(t('wh_post'))}</button>`);
      }
      acts.innerHTML = btns.join('');
      const payload = post => Object.assign(readForm(m.querySelector('[data-head]')), {
        kind, post, lines: lines.map(l => ({ product_id: l.product_id, qty: num(l.qty), unit_cost: l.unit_cost === '' ? null : num(l.unit_cost) })),
      });
      acts.querySelectorAll('[data-a]').forEach(b => {
        b.onclick = () => busy(b, async () => {
          const a = b.dataset.a;
          if (a === 'close') { m.close(); return; }
          if (a === 'delete') {
            if (!await ask(t('wh_delete_document_confirm'), t('wh_delete'), true)) return;
            await capi('DELETE', `/stockdocs/${id}`);
          } else if (a === 'cancel') {
            if (!await ask(t('wh_reverse_confirm'), t('wh_reverse_document'), true)) return;
            await capi('POST', `/stockdocs/${id}/cancel`);
          } else if (a === 'post' && !await ask(t('wh_post_confirm'), t('wh_post'))) {
            return;
          } else {
            if (id) await capi('PUT', `/stockdocs/${id}`, payload(a === 'post'));
            else await capi('POST', '/stockdocs', payload(a === 'post'));
          }
          toast(t('wh_saved'));
          m.close();
          refreshView();
        });
      });
    }

    // ── price lists ────────────────────────────────────────────
    function viewPricelists(el) {
      return guard(el, async () => {
        const r = await capi('GET', '/pricelists');
        el.innerHTML = head(t('wh_nav_pricelists'), can('pricelists', 2) ? `<button class="whw-btn pri" data-new>${esc(t('wh_new_pricelist'))}</button>` : '') +
          `<p class="whw-dim" style="margin-top:0">${esc(t('wh_pricelists_intro'))}</p>` +
          (r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_f_name'))}</th>
              <th class="num">${esc(t('wh_f_discount'))}</th><th class="num">${esc(t('wh_own_prices'))}</th><th></th></tr></thead><tbody>
            ${r.items.map(p => `<tr data-id="${esc(p.id)}"><td>${esc(p.name)}</td><td class="num">${qtyf(p.discount)}%</td>
              <td class="num">${p.item_count}</td><td>${p.active ? '' : badge('cancelled', t('wh_archived'))}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_pricelists'));
        const nb = el.querySelector('[data-new]');
        if (nb) nb.onclick = () => openPricelist(null);
        el.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openPricelist(tr.dataset.id); });
      });
    }
    async function openPricelist(id) {
      const m = modal(id ? t('wh_pricelist') : t('wh_new_pricelist'), loading(), !!id);
      const ed = can('pricelists', 2);
      const dis = ed ? '' : 'disabled';
      let pl = { name: '', discount: 0, active: 1 }, items = [];
      if (id) {
        try { const r = await capi('GET', `/pricelists/${id}/items`); pl = r.price_list; items = r.items; }
        catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
        m.setTitle(pl.name);
      }
      m.body.innerHTML = `<div class="whw-form" data-head>${f(t('wh_f_name'), inp('name', pl.name, dis))}
          ${f(t('wh_f_discount_pct'), inp('discount', pl.discount, `inputmode="decimal" ${dis}`))}${chk('active', t('wh_f_active'), pl.active, !ed)}</div>
        <div class="whw-hint">${esc(t('wh_discount_hint'))}</div>
        ${id ? `<div class="whw-sec">${esc(t('wh_own_prices'))}</div><div class="whw-bar"><input type="search" data-q placeholder="${esc(t('wh_search_products'))}"></div>
          <div class="whw-tablewrap"><table class="whw-t whw-lines"><thead><tr><th>${esc(t('wh_col_product'))}</th>
            <th class="num">${esc(t('wh_col_base_price'))}</th><th class="num">${esc(t('wh_col_list_price'))}</th><th class="num">${esc(t('wh_col_result'))}</th></tr></thead>
            <tbody>${items.map((it, i) => `<tr data-row="${i}" data-s="${esc((it.name + ' ' + (it.sku || '')).toLowerCase())}">
              <td>${esc(it.name)} <small>${esc(it.sku || '')}</small></td><td class="num">${money(it.base_price)}</td>
              <td class="num"><input data-i="${i}" value="${it.price == null ? '' : esc(it.price)}" placeholder="—" inputmode="decimal" ${dis}></td>
              <td class="num" data-eff="${i}">${money(it.effective)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="whw-actions">${id && ed ? `<button class="whw-btn dan l" data-del>${esc(t('wh_delete'))}</button>` : ''}
          <button class="whw-btn" data-close>${esc(t('wh_close'))}</button>${ed ? `<button class="whw-btn pri" data-save>${esc(t('wh_save'))}</button>` : ''}</div>`;
      m.querySelector('[data-close]').onclick = m.close;
      const q = m.querySelector('[data-q]');
      if (q) q.oninput = () => {
        const s = q.value.trim().toLowerCase();
        m.querySelectorAll('tr[data-row]').forEach(tr => { tr.hidden = !!s && !tr.dataset.s.includes(s); });
      };
      const disc = () => num(m.querySelector('[name=discount]').value);
      m.querySelectorAll('input[data-i]').forEach(x => {
        x.oninput = () => {
          const it = items[+x.dataset.i];
          const v = x.value.trim();
          m.querySelector(`[data-eff="${x.dataset.i}"]`).textContent = money(v === '' ? round2(it.base_price * (1 - disc() / 100)) : num(v));
        };
      });
      const sv = m.querySelector('[data-save]');
      if (sv) sv.onclick = () => busy(sv, async () => {
        const body = readForm(m.querySelector('[data-head]'));
        if (!id) {
          const r = await capi('POST', '/pricelists', body);
          await reloadInfo(); m.close(); refreshView(); openPricelist(r.id);
          return;
        }
        await capi('PUT', `/pricelists/${id}`, body);
        const changed = [];
        m.querySelectorAll('input[data-i]').forEach(x => {
          const it = items[+x.dataset.i];
          const v = x.value.trim();
          const old = it.price == null ? '' : String(it.price);
          if (v !== old && !(v !== '' && old !== '' && num(v) === num(old))) changed.push({ product_id: it.product_id, price: v === '' ? null : num(v) });
        });
        if (changed.length) await capi('PUT', `/pricelists/${id}/items`, { items: changed });
        await reloadInfo(); toast(t('wh_saved')); m.close(); refreshView();
      });
      const del = m.querySelector('[data-del]');
      if (del) del.onclick = () => busy(del, async () => {
        if (!await ask(t('wh_delete_pricelist_confirm', { name: pl.name }), t('wh_delete'), true)) return;
        await capi('DELETE', `/pricelists/${id}`);
        await reloadInfo(); m.close(); refreshView();
      });
    }

    // ── partners ───────────────────────────────────────────────
    function viewPartners(el) {
      const F = S.sub.partners = S.sub.partners || { q: '', kind: '' };
      el.innerHTML = head(t('wh_nav_partners'), can('partners', 2) ? `<button class="whw-btn pri" data-new>${esc(t('wh_new_partner'))}</button>` : '') +
        `<div class="whw-bar"><input type="search" data-q value="${esc(F.q)}" placeholder="${esc(t('wh_search_partners'))}">
          <select data-kind><option value="">${esc(t('wh_all_partners'))}</option><option value="customer" ${F.kind === 'customer' ? 'selected' : ''}>${esc(t('wh_customers'))}</option>
          <option value="supplier" ${F.kind === 'supplier' ? 'selected' : ''}>${esc(t('wh_suppliers'))}</option></select></div><div data-list></div>`;
      const list = el.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/partners?limit=2000&q=${enc(F.q)}&kind=${enc(F.kind)}`);
          const bal = r.items.length && r.items[0].balance !== undefined;
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_f_name'))}</th>
              <th>${esc(t('wh_col_kind'))}</th><th>${esc(t('wh_f_vat_number'))}</th><th>${esc(t('wh_col_contact'))}</th>
              ${bal ? `<th class="num">${esc(t('wh_col_balance'))}</th>` : ''}</tr></thead><tbody>
            ${r.items.map(p => `<tr data-id="${esc(p.id)}"><td>${esc(p.name)}<br><small>${esc(p.city || '')}</small></td>
              <td>${esc(t('wh_pk_' + p.kind))}</td><td>${esc(p.vat_number || p.reg_number || '')}</td>
              <td>${esc(p.email || '')}<br><small>${esc(p.phone || '')}</small></td>
              ${bal ? `<td class="num ${p.balance > 0.005 ? 'neg' : ''}">${money(p.balance)}</td>` : ''}</tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_partners');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openPartner(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      el.querySelector('[data-q]').addEventListener('input', debounce(e => { F.q = e.target.value; load(); }, 250));
      el.querySelector('[data-kind]').onchange = e => { F.kind = e.target.value; load(); };
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = () => openPartner(null);
      return load();
    }
    async function openPartner(id, onCreated) {
      const m = modal(id ? t('wh_partner') : t('wh_new_partner'), loading());
      let p = { kind: 'customer', name: '', vat_number: '', reg_number: '', manager_name: '', email: '', phone: '', address: '', city: '',
        country: '', price_list_id: '', payment_terms: '', notes: '', active: 1 };
      if (id) {
        try { p = await capi('GET', `/partners/${id}`); } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
        m.setTitle(p.name);
      }
      const ed = can('partners', 2);
      const dis = ed ? '' : 'disabled';
      m.body.innerHTML = `<div class="whw-form" data-form>
          ${f(t('wh_f_name'), inp('name', p.name, dis), 'wide')}
          ${f(t('wh_col_kind'), `<select name="kind" ${dis}>${opts2(['customer', 'supplier', 'both'], p.kind, 'wh_pk_')}</select>`)}
          ${f(t('wh_f_vat_number'), inp('vat_number', p.vat_number, dis))}
          ${f(t('wh_f_reg_number'), inp('reg_number', p.reg_number, dis))}
          ${f(t('wh_f_manager_name'), inp('manager_name', p.manager_name, dis))}
          ${f(t('wh_f_email'), inp('email', p.email, `type="email" ${dis}`))}
          ${f(t('wh_f_phone'), inp('phone', p.phone, dis))}
          ${f(t('wh_f_address'), inp('address', p.address, dis), 'wide')}
          ${f(t('wh_f_city'), inp('city', p.city, dis))}
          ${f(t('wh_f_country'), inp('country', p.country, dis))}
          ${f(t('wh_f_price_list'), `<select name="price_list_id" ${dis}>${plOptions(p.price_list_id)}</select>`)}
          ${f(t('wh_f_payment_terms'), inp('payment_terms', p.payment_terms == null ? '' : p.payment_terms,
            `inputmode="numeric" placeholder="${esc(String(S.info.company.payment_terms))}" ${dis}`))}
          ${chk('active', t('wh_f_active'), p.active, !ed)}
          ${f(t('wh_f_notes'), `<textarea name="notes" ${dis}>${esc(p.notes)}</textarea>`, 'wide')}
        </div>
        ${p.balance !== undefined && id ? `<div class="whw-totals"><div class="g"><span>${esc(t('wh_col_balance'))}</span><span>${money(p.balance)}</span></div></div>` : ''}
        <div class="whw-actions">${id && ed ? `<button class="whw-btn dan l" data-del>${esc(t('wh_delete'))}</button>` : ''}
          <button class="whw-btn" data-close>${esc(t('wh_close'))}</button>${ed ? `<button class="whw-btn pri" data-save>${esc(t('wh_save'))}</button>` : ''}</div>`;
      m.querySelector('[data-close]').onclick = m.close;
      const sv = m.querySelector('[data-save]');
      if (sv) sv.onclick = () => busy(sv, async () => {
        const body = readForm(m.querySelector('[data-form]'));
        if (id) await capi('PUT', `/partners/${id}`, body);
        else { const r = await capi('POST', '/partners', body); if (onCreated) onCreated(r.id); }
        toast(t('wh_saved')); m.close(); if (!onCreated) refreshView();
      });
      const del = m.querySelector('[data-del]');
      if (del) del.onclick = () => busy(del, async () => {
        if (!await ask(t('wh_delete_partner_confirm', { name: p.name }), t('wh_delete'), true)) return;
        const r = await capi('DELETE', `/partners/${id}`);
        toast(r.archived ? t('wh_archived_instead') : t('wh_deleted'));
        m.close(); refreshView();
      });
    }

    // ── orders ─────────────────────────────────────────────────
    function viewOrders(el) {
      const F = S.sub.orders = S.sub.orders || { q: '', status: 'open' };
      el.innerHTML = head(t('wh_nav_orders'), can('orders', 2) ? `<button class="whw-btn pri" data-new>${esc(t('wh_new_order'))}</button>` : '') +
        `<div class="whw-bar"><input type="search" data-q value="${esc(F.q)}" placeholder="${esc(t('wh_search_orders'))}">
          <select data-status><option value="">${esc(t('wh_all'))}</option>${opts2(['open', 'draft', 'confirmed', 'shipped', 'cancelled'], F.status, 'wh_status_')}</select>
        </div><div data-list></div>`;
      const list = el.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/orders?limit=500&q=${enc(F.q)}&status=${enc(F.status)}`);
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_col_number'))}</th>
              <th>${esc(t('wh_col_date'))}</th><th>${esc(t('wh_col_customer'))}</th><th>${esc(t('wh_col_status'))}</th>
              <th class="num">${esc(t('wh_total'))}</th><th class="num">${esc(t('wh_col_paid'))}</th><th>${esc(t('wh_col_invoice'))}</th></tr></thead><tbody>
            ${r.items.map(o => `<tr data-id="${esc(o.id)}"><td>${esc(o.number)}${o.external_ref ? `<br><small>${esc(o.source)} · ${esc(o.external_ref)}</small>` : ''}</td>
              <td>${fdate(o.order_date)}</td><td>${esc(o.partner_name || '—')}</td><td>${badge(o.status, t('wh_status_' + o.status))}</td>
              <td class="num">${money(o.total, o.currency)}</td><td class="num">${o.paid ? money(o.paid, o.currency) : ''}</td>
              <td>${esc(o.invoice_number || '')}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_orders');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openOrder(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      el.querySelector('[data-q]').addEventListener('input', debounce(e => { F.q = e.target.value; load(); }, 250));
      el.querySelector('[data-status]').onchange = e => { F.status = e.target.value; load(); };
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = () => openOrder(null);
      return load();
    }

    async function openOrder(id) {
      const m = modal(id ? t('wh_order') : t('wh_new_order'), loading(), true);
      let o, partners, products = [];
      try {
        o = id ? await capi('GET', `/orders/${id}`) : { status: 'draft', lines: [], order_date: today(), warehouse_id: defaultWh(),
          partner_id: '', price_list_id: '', ship_to: '', note: '', paid: 0, total: 0 };
        partners = (await capi('GET', '/partners?limit=5000&kind=customer')).items;
      } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      if (id) m.setTitle(`${t('wh_order')} ${o.number}`);
      const ed = can('orders', 2) && o.status === 'draft';
      const dis = ed ? '' : 'disabled';
      async function loadProducts(pl, wh) {
        products = (await capi('GET', `/products?limit=5000&price_list_id=${enc(pl || '')}&warehouse_id=${enc(wh || '')}`)).items;
      }
      if (ed) await loadProducts(o.price_list_id, o.warehouse_id).catch(() => {});
      const partnerOpts = sel => `<option value="">${esc(t('wh_no_customer'))}</option>` +
        partners.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
      m.body.innerHTML = `
        ${id ? `<div class="whw-bar">${badge(o.status, t('wh_status_' + o.status))}
          ${o.source && o.source !== 'manual' ? `<span class="whw-dim">${esc(t('wh_from_source', { source: o.source }))}${o.external_ref ? ' · ' + esc(o.external_ref) : ''}</span>` : ''}
          ${o.invoice_number ? `<button class="whw-btn sm" data-openinv>🧾 ${esc(o.invoice_number)}</button>` : ''}</div>` : ''}
        <div class="whw-form" data-head>
          ${f(t('wh_f_customer'), `<div style="display:flex;gap:6px"><select name="partner_id" style="flex:1;min-width:0" ${dis}>${partnerOpts(o.partner_id)}</select>
            ${ed && can('partners', 2) ? `<button class="whw-btn" data-newpartner title="${esc(t('wh_new_partner'))}">+</button>` : ''}</div>`)}
          ${f(t('wh_f_warehouse'), `<select name="warehouse_id" ${dis}>${whOptions(o.warehouse_id)}</select>`)}
          ${f(t('wh_f_price_list'), `<select name="price_list_id" ${dis}>${plOptions(o.price_list_id)}</select>`)}
          ${f(t('wh_f_date'), `<input type="date" name="order_date" value="${esc(o.order_date)}" ${dis}>`)}
          ${f(t('wh_f_ship_to'), `<textarea name="ship_to" ${dis}>${esc(o.ship_to)}</textarea>`, 'wide')}
          ${f(t('wh_f_note'), inp('note', o.note, dis), 'wide')}
        </div>
        <div class="whw-sec">${esc(t('wh_lines'))}</div><div data-lines></div>
        ${o.payments && o.payments.length ? `<div class="whw-sec">${esc(t('wh_nav_payments'))}</div>${paymentsMini(o.payments)}` : ''}
        <div class="whw-actions" data-acts></div>`;
      const lines = salesLines(m.querySelector('[data-lines]'), o.lines, ed, () => products);
      const head2 = m.querySelector('[data-head]');
      if (ed) {
        const pSel = head2.querySelector('[name=partner_id]');
        const plSel = head2.querySelector('[name=price_list_id]');
        const whSel = head2.querySelector('[name=warehouse_id]');
        const reload = async () => { await loadProducts(plSel.value, whSel.value).catch(() => {}); };
        pSel.onchange = async () => {
          const p = partners.find(x => x.id === pSel.value);
          const pl = p && p.price_list_id ? p.price_list_id : '';
          if (plSel.value !== pl) { plSel.value = pl; await reload(); lines.reprice(products); }
          if (p && !head2.querySelector('[name=ship_to]').value.trim()) {
            head2.querySelector('[name=ship_to]').value = [p.name, p.address, [p.city, p.country].filter(Boolean).join(', ')].filter(Boolean).join('\n');
          }
        };
        plSel.onchange = async () => { await reload(); lines.reprice(products); };
        whSel.onchange = reload;
        const np = head2.querySelector('[data-newpartner]');
        if (np) np.onclick = () => openPartner(null, async newId => {
          partners = (await capi('GET', '/partners?limit=5000&kind=customer')).items;
          pSel.innerHTML = partnerOpts(newId);
          pSel.onchange();
        });
      }
      const oi = m.querySelector('[data-openinv]');
      if (oi) oi.onclick = () => openInvoice(o.invoice_id);

      const acts = [];
      const st = o.status;
      if (can('orders', 2)) {
        if (id && (st === 'draft' || st === 'cancelled') && !o.invoice_id && !o.paid) acts.push(['delete', 'wh_delete', 'dan l']);
        if (id && (st === 'draft' || st === 'confirmed')) acts.push(['cancelled', 'wh_cancel_order', 'dan' + (acts.length ? '' : ' l')]);
        if (id && (st === 'confirmed' || st === 'cancelled')) acts.push(['draft', 'wh_back_to_draft', '']);
      }
      if (id && st !== 'cancelled' && can('payments', 2) && o.paid < o.total - 0.005) acts.push(['pay', 'wh_add_payment', '']);
      if (id && st !== 'cancelled' && can('invoices', 2) && !o.invoice_id) {
        acts.push(['proforma', 'wh_make_proforma', '']);
        acts.push(['invoice', 'wh_make_invoice', '']);
      }
      if (can('orders', 2) && ed) acts.push(['save', id ? 'wh_save' : 'wh_save_draft', '']);
      if (can('orders', 2) && st === 'draft') acts.push(['confirmed', 'wh_confirm_order', 'pri']);
      if (id && st === 'confirmed' && can('orders', 2) && can('stock', 2)) acts.push(['shipped', 'wh_ship', 'pri']);
      const box = m.querySelector('[data-acts]');
      box.innerHTML = acts.map(([a, k, c]) => `<button class="whw-btn ${c}" data-a="${a}">${esc(t(k))}</button>`).join('') ||
        `<button class="whw-btn" data-a="close">${esc(t('wh_close'))}</button>`;
      const body = () => Object.assign(readForm(head2), { lines: lines.get() });
      box.querySelectorAll('[data-a]').forEach(b => {
        b.onclick = () => busy(b, async () => {
          const a = b.dataset.a;
          let oid = id;
          if (a === 'close') { m.close(); return; }
          if (a === 'delete') {
            if (!await ask(t('wh_delete_order_confirm'), t('wh_delete'), true)) return;
            await capi('DELETE', `/orders/${id}`);
            m.close(); refreshView(); return;
          }
          if (a === 'pay') { openPaymentDialog({ order_id: id, partner_id: o.partner_id, amount: round2(o.total - o.paid) }, () => { m.close(); openOrder(id); refreshView(); }); return; }
          if (a === 'invoice' || a === 'proforma') { openInvoiceFromOrder(id, a, () => m.close()); return; }
          if (ed && (a === 'save' || a === 'confirmed')) {
            if (!lines.count()) { toast(t('wh_err_lines_required'), true); return; }
            if (id) await capi('PUT', `/orders/${id}`, body());
            else oid = (await capi('POST', '/orders', Object.assign(body(), a === 'confirmed' ? { status: 'confirmed' } : {}))).id;
            if (a === 'confirmed' && id) await capi('POST', `/orders/${id}/status`, { status: 'confirmed' });
          } else if (['confirmed', 'shipped', 'cancelled', 'draft'].includes(a)) {
            if (a === 'shipped' && !await ask(t('wh_ship_confirm'), t('wh_ship'))) return;
            if (a === 'cancelled' && !await ask(t('wh_cancel_order_confirm'), t('wh_cancel_order'), true)) return;
            await capi('POST', `/orders/${id}/status`, { status: a });
          }
          toast(t('wh_saved'));
          m.close();
          refreshView();
          openOrder(oid);
        });
      });
    }
    function paymentsMini(items) {
      return `<div class="whw-tablewrap"><table class="whw-t"><tbody>${items.map(p => `<tr><td>${fdate(p.pay_date)}</td>
        <td>${esc(t('wh_pay_' + p.method))}</td><td>${esc(p.reference || '')}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>`;
    }

    // ── invoices ───────────────────────────────────────────────
    function viewInvoices(el) {
      const F = S.sub.invoices = S.sub.invoices || { q: '', kind: '', state: '' };
      el.innerHTML = head(t('wh_nav_invoices'), can('invoices', 2) ? `<button class="whw-btn pri" data-new>${esc(t('wh_new_invoice'))}</button>` : '') +
        `<div class="whw-bar"><input type="search" data-q value="${esc(F.q)}" placeholder="${esc(t('wh_search_invoices'))}">
          <select data-kind><option value="">${esc(t('wh_all_kinds'))}</option>${opts2(['invoice', 'proforma', 'credit_note'], F.kind, 'wh_inv_')}</select>
          <select data-state><option value="">${esc(t('wh_all'))}</option>${opts2(['open', 'unpaid', 'partial', 'overdue', 'paid', 'cancelled'], F.state, 'wh_state_')}</select>
        </div><div data-list></div>`;
      const list = el.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/invoices?limit=1000&q=${enc(F.q)}&kind=${enc(F.kind)}&state=${enc(F.state)}`);
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_col_number'))}</th>
              <th>${esc(t('wh_col_date'))}</th><th>${esc(t('wh_col_customer'))}</th><th class="num">${esc(t('wh_total'))}</th>
              <th class="num">${esc(t('wh_col_paid'))}</th><th>${esc(t('wh_col_status'))}</th></tr></thead><tbody>
            ${r.items.map(i => `<tr data-id="${esc(i.id)}"><td>${esc(i.number)}<br><small>${esc(t('wh_inv_' + i.kind))}</small></td>
              <td>${fdate(i.issue_date)}<br><small>${i.kind === 'invoice' ? esc(t('wh_due', { date: fdate(i.due_date) })) : ''}</small></td>
              <td>${esc(i.recipient.name || '')}</td>
              <td class="num">${i.kind === 'credit_note' ? '−' : ''}${money(i.total, i.currency)}</td>
              <td class="num">${i.paid ? money(i.paid, i.currency) : ''}</td><td>${badge(i.pay_state, t('wh_state_' + i.pay_state))}</td></tr>`).join('')}
            </tbody></table></div>` : empty('wh_no_invoices');
          list.querySelectorAll('tr[data-id]').forEach(tr => { tr.onclick = () => openInvoice(tr.dataset.id); });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      el.querySelector('[data-q]').addEventListener('input', debounce(e => { F.q = e.target.value; load(); }, 250));
      el.querySelector('[data-kind]').onchange = e => { F.kind = e.target.value; load(); };
      el.querySelector('[data-state]').onchange = e => { F.state = e.target.value; load(); };
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = openNewInvoice;
      return load();
    }

    function invoiceHtml(inv) {
      const party = (p, title) => `<div><b class="t">${esc(title)}</b><b>${esc(p.legal_name || p.name || '')}</b><br>
        ${p.address ? esc(p.address) + '<br>' : ''}${[p.city, p.country].filter(Boolean).map(esc).join(', ')}${p.city || p.country ? '<br>' : ''}
        ${p.vat_number ? esc(t('wh_f_vat_number')) + ': ' + esc(p.vat_number) + '<br>' : ''}
        ${p.reg_number ? esc(t('wh_f_reg_number')) + ': ' + esc(p.reg_number) + '<br>' : ''}
        ${p.manager_name ? esc(t('wh_f_manager_name')) + ': ' + esc(p.manager_name) + '<br>' : ''}
        ${p.email ? esc(p.email) + '<br>' : ''}${p.phone ? esc(p.phone) : ''}</div>`;
      const c = inv.currency;
      const vatOn = inv.lines.some(l => l.vat_rate) || inv.vat_total;
      const byRate = {};
      inv.lines.forEach(l => { byRate[l.vat_rate] = (byRate[l.vat_rate] || 0) + l.net; });
      const title = inv.kind === 'credit_note' ? t('wh_inv_credit_note') : inv.kind === 'proforma' ? t('wh_inv_proforma') : t('wh_inv_invoice');
      return `<div class="whw-paper">
        <div class="hd"><div><h1>${esc(title)}</h1><div class="muted">№ ${esc(inv.number)}</div>
          ${inv.status === 'cancelled' ? `<div style="color:#c0392b;font-weight:700">${esc(t('wh_state_cancelled'))}</div>` : ''}</div>
          <div>${esc(t('wh_f_issue_date'))}: <b>${fdate(inv.issue_date)}</b><br>
            ${inv.kind !== 'proforma' ? `${esc(t('wh_f_tax_date'))}: ${fdate(inv.tax_date)}<br>` : ''}
            ${inv.kind === 'invoice' || inv.kind === 'proforma' ? `${esc(t('wh_f_due_date'))}: ${fdate(inv.due_date)}<br>` : ''}
            ${inv.related_number ? `${esc(t('wh_to_invoice', { number: inv.related_number }))}<br>` : ''}
            ${inv.order_number ? `${esc(t('wh_order'))}: ${esc(inv.order_number)}` : ''}</div></div>
        <div class="parties">${party(inv.supplier, t('wh_supplier_party'))}${party(inv.recipient, t('wh_recipient_party'))}</div>
        <table><thead><tr><th>#</th><th>${esc(t('wh_col_item'))}</th><th class="num">${esc(t('wh_col_qty'))}</th>
          <th class="num">${esc(t('wh_col_price'))}</th>${inv.lines.some(l => l.discount) ? `<th class="num">${esc(t('wh_col_discount'))}</th>` : ''}
          ${vatOn ? `<th class="num">${esc(t('wh_col_vat'))}</th>` : ''}<th class="num">${esc(t('wh_col_net'))}</th></tr></thead><tbody>
          ${inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}${l.sku ? ` <span class="muted">${esc(l.sku)}</span>` : ''}</td>
            <td class="num">${qtyf(l.qty)} ${esc(l.unit || '')}</td><td class="num">${money(l.unit_price, c)}</td>
            ${inv.lines.some(x => x.discount) ? `<td class="num">${l.discount ? qtyf(l.discount) + '%' : ''}</td>` : ''}
            ${vatOn ? `<td class="num">${qtyf(l.vat_rate)}%</td>` : ''}<td class="num">${money(l.net, c)}</td></tr>`).join('')}
        </tbody></table>
        <div class="tot"><div><span>${esc(t('wh_subtotal'))}</span><span>${money(inv.subtotal, c)}</span></div>
          ${vatOn ? Object.keys(byRate).filter(r => +r).map(r => `<div><span>${esc(t('wh_vat_at', { rate: qtyf(+r) }))}</span>
            <span>${money(round2(byRate[r] * r / 100), c)}</span></div>`).join('') : ''}
          <div class="g"><span>${esc(t('wh_total'))}</span><span>${money(inv.total, c)}</span></div></div>
        <div class="foot">${esc(t('wh_f_payment_method'))}: ${esc(t('wh_pay_' + inv.payment_method))}
          ${inv.payment_method === 'bank' && inv.supplier.iban ? `<br>${esc(inv.supplier.bank_name || '')} IBAN: <b>${esc(inv.supplier.iban)}</b>
            ${inv.supplier.bic ? ' BIC: ' + esc(inv.supplier.bic) : ''}` : ''}
          ${!inv.vat_total && inv.kind !== 'proforma' && !S.info.company.vat_registered ? `<br>${esc(t('wh_no_vat_note'))}` : ''}
          ${inv.note ? `<br><br>${esc(inv.note).replace(/\n/g, '<br>')}` : ''}</div>
      </div>`;
    }
    function printInvoice(inv) {
      const w = window.open('', '_blank');
      if (!w) { toast(t('wh_popup_blocked'), true); return; }
      const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent).filter(x => x.includes('.whw-paper')).join('\n');
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>` +
        `<style>${css}${PRINT_CSS}</style></head><body>${invoiceHtml(inv)}</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 250);
    }
    async function openInvoice(id) {
      const m = modal(t('wh_inv_invoice'), loading(), true);
      let inv;
      try { inv = await capi('GET', `/invoices/${id}`); } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      m.setTitle(`${t('wh_inv_' + inv.kind)} ${inv.number}`);
      const acts = [];
      if (can('invoices', 2) && inv.status === 'issued' && !(inv.credit_notes || []).length) acts.push(['cancel', 'wh_cancel_invoice', 'dan l']);
      if (can('invoices', 2) && inv.kind === 'invoice' && inv.status === 'issued' && !(inv.credit_notes || []).length) acts.push(['credit', 'wh_make_credit_note', '']);
      if (inv.order_id && can('orders')) acts.push(['order', 'wh_open_order', '']);
      if (can('payments', 2) && inv.kind === 'invoice' && inv.status === 'issued' && ['unpaid', 'partial', 'overdue'].includes(inv.pay_state)) acts.push(['pay', 'wh_add_payment', '']);
      acts.push(['print', 'wh_print', 'pri']);
      m.body.innerHTML = `<div class="whw-bar">${badge(inv.pay_state, t('wh_state_' + inv.pay_state))}
          ${inv.kind === 'invoice' ? `<span class="whw-dim">${esc(t('wh_paid_of', { paid: money(inv.paid, inv.currency), total: money(inv.total, inv.currency) }))}</span>` : ''}
          ${(inv.credit_notes || []).map(c => `<button class="whw-btn sm" data-inv="${esc(c.id)}">${esc(t('wh_inv_credit_note'))} ${esc(c.number)}</button>`).join('')}
          ${inv.related_id ? `<button class="whw-btn sm" data-inv="${esc(inv.related_id)}">${esc(t('wh_inv_invoice'))} ${esc(inv.related_number)}</button>` : ''}</div>
        ${invoiceHtml(inv)}
        ${inv.payments && inv.payments.length ? `<div class="whw-sec">${esc(t('wh_nav_payments'))}</div>${paymentsMini(inv.payments)}` : ''}
        <div class="whw-actions">${acts.map(([a, k, c]) => `<button class="whw-btn ${c}" data-a="${a}">${esc(t(k))}</button>`).join('')}</div>`;
      m.querySelectorAll('[data-inv]').forEach(b => { b.onclick = () => { m.close(); openInvoice(b.dataset.inv); }; });
      m.querySelectorAll('[data-a]').forEach(b => {
        b.onclick = () => busy(b, async () => {
          const a = b.dataset.a;
          if (a === 'print') { printInvoice(inv); return; }
          if (a === 'order') { m.close(); openOrder(inv.order_id); return; }
          if (a === 'pay') {
            openPaymentDialog({ invoice_id: id, partner_id: inv.partner_id, amount: round2(inv.total - inv.paid) },
              () => { m.close(); openInvoice(id); refreshView(); });
            return;
          }
          if (a === 'cancel') {
            if (!await ask(t('wh_cancel_invoice_confirm'), t('wh_cancel_invoice'), true)) return;
            await capi('POST', `/invoices/${id}/cancel`);
            m.close(); refreshView(); openInvoice(id); return;
          }
          if (a === 'credit') {
            if (!await ask(t('wh_credit_confirm'), t('wh_make_credit_note'))) return;
            const cn = await capi('POST', `/invoices/${id}/credit`, {});
            m.close(); refreshView(); openInvoice(cn.id);
          }
        });
      });
    }
    function invoiceHeadFields(kind) {
      return `${f(t('wh_f_issue_date'), `<input type="date" name="issue_date" value="${today()}">`)}
        ${f(t('wh_f_due_date'), `<input type="date" name="due_date">`)}
        ${f(t('wh_f_payment_method'), `<select name="payment_method">${opts2(PAY_METHODS, 'bank', 'wh_pay_')}</select>`)}
        ${f(t('wh_f_note'), inp('note', '', `placeholder="${esc(S.info.company.invoice_note || '')}"`), 'wide')}
        <input type="hidden" name="kind" value="${kind}">`;
    }
    function openInvoiceFromOrder(orderId, kind, done) {
      const m = modal(kind === 'proforma' ? t('wh_make_proforma') : t('wh_make_invoice'),
        `<div class="whw-form" data-form>${invoiceHeadFields(kind)}</div><div class="whw-hint">${esc(t('wh_due_hint'))}</div>
        <div class="whw-actions"><button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button>
        <button class="whw-btn pri" data-go>${esc(t('wh_issue'))}</button></div>`);
      m.querySelector('[data-close]').onclick = m.close;
      const go = m.querySelector('[data-go]');
      go.onclick = () => busy(go, async () => {
        const body = Object.assign(readForm(m.querySelector('[data-form]')), { order_id: orderId });
        const inv = await capi('POST', '/invoices', body);
        m.close(); if (done) done(); refreshView(); openInvoice(inv.id);
      });
    }
    async function openNewInvoice() {
      const m = modal(t('wh_new_invoice'), loading(), true);
      let partners, products = [];
      try { partners = (await capi('GET', '/partners?limit=5000&kind=customer')).items; }
      catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      const loadProducts = async pl => {
        if (!(can('catalog') || can('orders') || can('stock') || can('pricelists'))) return;
        products = (await capi('GET', `/products?limit=5000&price_list_id=${enc(pl || '')}`).catch(() => ({ items: [] }))).items;
      };
      await loadProducts('');
      m.body.innerHTML = `<div class="whw-form" data-form>
          ${f(t('wh_f_customer'), `<select name="partner_id"><option value=""></option>${partners.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`)}
          ${f(t('wh_col_kind'), `<select name="kind">${opts2(['invoice', 'proforma'], 'invoice', 'wh_inv_')}</select>`)}
          ${invoiceHeadFields('invoice').replace(/<input type="hidden" name="kind"[^>]*>/, '')}
        </div><div class="whw-hint">${esc(t('wh_standalone_invoice_hint'))}</div>
        <div class="whw-sec">${esc(t('wh_lines'))}</div><div data-lines></div>
        <div class="whw-actions"><button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button>
          <button class="whw-btn pri" data-go>${esc(t('wh_issue'))}</button></div>`;
      const lines = salesLines(m.querySelector('[data-lines]'), [], true, () => products);
      const pSel = m.querySelector('[name=partner_id]');
      pSel.onchange = async () => {
        const p = partners.find(x => x.id === pSel.value);
        await loadProducts(p && p.price_list_id);
        lines.reprice(products);
      };
      m.querySelector('[data-close]').onclick = m.close;
      const go = m.querySelector('[data-go]');
      go.onclick = () => busy(go, async () => {
        const body = Object.assign(readForm(m.querySelector('[data-form]')), { lines: lines.get() });
        if (!body.partner_id) { toast(t('wh_err_partner_required'), true); return; }
        if (!body.lines.length) { toast(t('wh_err_lines_required'), true); return; }
        const inv = await capi('POST', '/invoices', body);
        m.close(); refreshView(); openInvoice(inv.id);
      });
    }

    // ── payments ───────────────────────────────────────────────
    function viewPayments(el) {
      const d = new Date();
      const F = S.sub.payments = S.sub.payments || { from: new Date(d.getFullYear(), d.getMonth(), 1, 12).toISOString().slice(0, 10), to: today() };
      el.innerHTML = head(t('wh_nav_payments'), can('payments', 2) ? `<button class="whw-btn pri" data-new>${esc(t('wh_add_payment'))}</button>` : '') +
        `<div class="whw-bar"><input type="date" data-from value="${esc(F.from)}"><span>—</span><input type="date" data-to value="${esc(F.to)}"></div><div data-list></div>`;
      const list = el.querySelector('[data-list]');
      async function load() {
        list.innerHTML = loading();
        try {
          const r = await capi('GET', `/payments?limit=2000&from=${enc(F.from)}&to=${enc(F.to)}`);
          list.innerHTML = r.items.length ? `<div class="whw-tablewrap"><table class="whw-t"><thead><tr><th>${esc(t('wh_col_date'))}</th>
              <th>${esc(t('wh_col_partner'))}</th><th>${esc(t('wh_col_for'))}</th><th>${esc(t('wh_f_method'))}</th>
              <th>${esc(t('wh_f_reference'))}</th><th class="num">${esc(t('wh_f_amount'))}</th>${can('payments', 2) ? '<th></th>' : ''}</tr></thead><tbody>
            ${r.items.map(p => `<tr><td>${fdate(p.pay_date)}</td><td>${esc(p.partner_name || '')}</td>
              <td>${esc(p.invoice_number || p.order_number || '')}</td><td>${esc(t('wh_pay_' + p.method))}</td><td>${esc(p.reference || '')}</td>
              <td class="num ${p.amount < 0 ? 'neg' : ''}">${money(p.amount)}</td>
              ${can('payments', 2) ? `<td><button class="whw-btn sm" data-del="${esc(p.id)}">✕</button></td>` : ''}</tr>`).join('')}
            </tbody></table></div><div class="whw-totals"><div class="g"><span>${esc(t('wh_total'))}</span><span>${money(r.sum)}</span></div></div>`
            : empty('wh_no_payments');
          list.querySelectorAll('[data-del]').forEach(b => {
            b.onclick = () => busy(b, async () => {
              if (!await ask(t('wh_delete_payment_confirm'), t('wh_delete'), true)) return;
              await capi('DELETE', `/payments/${b.dataset.del}`);
              load();
            });
          });
        } catch (e) { list.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; }
      }
      el.querySelector('[data-from]').onchange = e => { F.from = e.target.value; load(); };
      el.querySelector('[data-to]').onchange = e => { F.to = e.target.value; load(); };
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = () => openPaymentDialog({}, refreshView);
      return load();
    }
    async function openPaymentDialog(pre, done) {
      const fixed = !!(pre.order_id || pre.invoice_id);
      const m = modal(t('wh_add_payment'), loading());
      let partners = [], invoices = [];
      if (!fixed) {
        try {
          [partners, invoices] = await Promise.all([
            capi('GET', '/partners?limit=5000').then(r => r.items),
            can('invoices') ? capi('GET', '/invoices?state=open&kind=invoice&limit=1000').then(r => r.items) : [],
          ]);
        } catch (e) { m.body.innerHTML = `<div class="whw-error">${esc(errText(e))}</div>`; return; }
      }
      m.body.innerHTML = `<div class="whw-form" data-form>
          ${f(t('wh_f_amount'), inp('amount', pre.amount != null ? pre.amount : '', 'inputmode="decimal"'))}
          ${f(t('wh_f_method'), `<select name="method">${opts2(PAY_METHODS, 'bank', 'wh_pay_')}</select>`)}
          ${f(t('wh_f_date'), `<input type="date" name="pay_date" value="${today()}">`)}
          ${f(t('wh_f_reference'), inp('reference', ''))}
          ${fixed ? '' : f(t('wh_col_partner'), `<select name="partner_id"><option value=""></option>${partners.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select>`)}
          ${fixed || !invoices.length ? '' : f(t('wh_col_invoice'), `<select name="invoice_id"><option value="">${esc(t('wh_no_invoice'))}</option>
            ${invoices.map(i => `<option value="${esc(i.id)}" data-p="${esc(i.partner_id || '')}" data-rest="${round2(i.total - i.paid)}">${esc(i.number)} · ${esc(i.recipient.name || '')} · ${money(round2(i.total - i.paid))}</option>`).join('')}</select>`, 'wide')}
          ${f(t('wh_f_note'), inp('note', ''), 'wide')}
        </div><div class="whw-hint">${esc(t('wh_payment_hint'))}</div>
        <div class="whw-actions"><button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button><button class="whw-btn pri" data-go>${esc(t('wh_save'))}</button></div>`;
      m.querySelector('[data-close]').onclick = m.close;
      const invSel = m.querySelector('[name=invoice_id]');
      if (invSel) invSel.onchange = () => {
        const o = invSel.selectedOptions[0];
        if (o && o.value) {
          m.querySelector('[name=amount]').value = o.dataset.rest;
          if (o.dataset.p) m.querySelector('[name=partner_id]').value = o.dataset.p;
        }
      };
      const go = m.querySelector('[data-go]');
      go.onclick = () => busy(go, async () => {
        const body = Object.assign({}, pre, readForm(m.querySelector('[data-form]')));
        delete body.amount_pre;
        await capi('POST', '/payments', body);
        toast(t('wh_saved')); m.close(); if (done) done();
      });
    }

    // ── reports ────────────────────────────────────────────────
    function viewReports(el) {
      const d = new Date();
      const F = S.sub.reports = S.sub.reports || { from: new Date(d.getFullYear(), d.getMonth(), 1, 12).toISOString().slice(0, 10), to: today() };
      return guard(el, async () => {
        const r = await capi('GET', `/reports/summary?from=${enc(F.from)}&to=${enc(F.to)}`);
        const max = Math.max(1, ...r.monthly.map(x => Math.abs(x.net)));
        const monthLabel = k => { try { return new Intl.DateTimeFormat(lang(), { month: 'short' }).format(new Date(k + '-15T12:00:00')); } catch (_) { return k.slice(5); } };
        const cards = [card(t('wh_sales_net'), money(r.sales.net), t('wh_n_invoices', { n: r.sales.count })),
          card(t('wh_sales_gross'), money(r.sales.gross), t('wh_with_vat')),
          card(t('wh_payments_in'), money(r.payments_in)),
          card(t('wh_receivables'), money(r.receivables.open), t('wh_overdue_sub', { amount: money(r.receivables.overdue) }), r.receivables.overdue > 0)];
        if (r.cogs != null) {
          cards.push(card(t('wh_cogs'), money(r.cogs), t('wh_cogs_sub')));
          cards.push(card(t('wh_gross_margin'), money(round2(r.sales.net - r.cogs)),
            r.sales.net ? qtyf(Math.round((r.sales.net - r.cogs) / r.sales.net * 1000) / 10) + '%' : ''));
        }
        el.innerHTML = head(t('wh_nav_reports')) +
          `<div class="whw-bar"><input type="date" data-from value="${esc(r.from)}"><span>—</span><input type="date" data-to value="${esc(r.to)}"></div>
          <div class="whw-cards">${cards.join('')}</div>
          <div class="whw-sec">${esc(t('wh_sales_by_month'))}</div>
          <div class="whw-bars">${r.monthly.map(x => `<div title="${esc(x.month)}: ${esc(money(x.net))}"><i style="height:${Math.max(0, x.net) / max * 100}%"></i>
            <span>${esc(monthLabel(x.month))}</span></div>`).join('')}</div>
          <div class="whw-cols">
            <div><div class="whw-sec">${esc(t('wh_top_products'))}</div>${r.top_products.length ? `<div class="whw-tablewrap"><table class="whw-t"><tbody>
              ${r.top_products.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${qtyf(p.qty)} ${esc(p.unit || '')}</td><td class="num">${money(p.net)}</td></tr>`).join('')}
              </tbody></table></div>` : empty('wh_no_sales')}</div>
            <div><div class="whw-sec">${esc(t('wh_top_customers'))}</div>${r.top_customers.length ? `<div class="whw-tablewrap"><table class="whw-t"><tbody>
              ${r.top_customers.map(p => `<tr><td>${esc(p.name || '—')}</td><td class="num">${money(p.net)}</td></tr>`).join('')}
              </tbody></table></div>` : empty('wh_no_sales')}</div>
            ${r.stock_value ? `<div><div class="whw-sec">${esc(t('wh_stock_value'))}</div><div class="whw-tablewrap"><table class="whw-t"><tbody>
              ${r.stock_value.map(w => `<tr><td>${esc(w.name)}</td><td class="num">${money(w.value)}</td></tr>`).join('')}
              </tbody></table></div></div>` : ''}
            <div><div class="whw-sec">${esc(t('wh_low_stock'))}</div>${r.low_stock.length ? `<div class="whw-tablewrap"><table class="whw-t"><tbody>
              ${r.low_stock.map(p => `<tr><td>${esc(p.name)}</td><td class="num neg">${qtyf(p.on_hand)} / ${qtyf(p.min_stock)} ${esc(p.unit || '')}</td></tr>`).join('')}
              </tbody></table></div>` : empty('wh_stock_ok')}</div>
          </div>`;
        el.querySelector('[data-from]').onchange = e => { F.from = e.target.value; viewReports(el); };
        el.querySelector('[data-to]').onchange = e => { F.to = e.target.value; viewReports(el); };
      });
    }

    // ── settings ───────────────────────────────────────────────
    function viewSettings(el) {
      const F = S.sub.settings = S.sub.settings || { tab: 'company' };
      const tabs = ['company', 'warehouses', 'team', 'apikeys'];
      if (S.info.role === 'owner') tabs.push('danger');
      el.innerHTML = head(t('wh_nav_settings')) +
        `<div class="whw-tabs">${tabs.map(x => `<button data-tab="${x}" class="${x === F.tab ? 'on' : ''}">${esc(t('wh_set_' + x))}</button>`).join('')}</div><div data-body></div>`;
      el.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { F.tab = b.dataset.tab; viewSettings(el); }; });
      const body = el.querySelector('[data-body]');
      return ({ company: setCompany, warehouses: setWarehouses, team: setTeam, apikeys: setKeys, danger: setDanger }[F.tab] || setCompany)(body);
    }
    function setCompany(el) {
      const c = S.info.company;
      const ed = can('settings', 2);
      const dis = ed ? '' : 'disabled';
      const txt = (k, extra, cls) => f(t('wh_f_' + k), inp(k, c[k], `${extra || ''} ${dis}`), cls);
      el.innerHTML = `<div class="whw-sec" style="margin-top:0">${esc(t('wh_company_details'))}</div><div class="whw-form" data-form>
          ${txt('name')}${txt('legal_name')}${txt('vat_number')}${txt('reg_number')}${txt('manager_name')}
          ${txt('address', '', 'wide')}${txt('city')}${txt('country')}${txt('email', 'type="email"')}${txt('phone')}
          ${txt('bank_name')}${txt('iban')}${txt('bic')}
        </div>
        <div class="whw-sec">${esc(t('wh_sales_settings'))}</div><div class="whw-form" data-form2>
          ${f(t('wh_f_currency'), `<select name="currency" ${dis}>${opts2(CURRENCIES, c.currency)}</select>`)}
          ${chk('vat_registered', t('wh_f_vat_registered'), c.vat_registered, !ed)}
          ${f(t('wh_f_default_vat'), inp('default_vat', c.default_vat, `inputmode="decimal" ${dis}`))}
          ${f(t('wh_f_payment_terms'), inp('payment_terms', c.payment_terms, `inputmode="numeric" ${dis}`))}
          ${txt('invoice_prefix')}
          ${f(t('wh_f_invoice_digits'), inp('invoice_digits', c.invoice_digits, `inputmode="numeric" ${dis}`))}
          ${f(t('wh_f_invoice_next'), inp('invoice_next', S.info.invoice_next, `inputmode="numeric" ${dis}`))}
          ${txt('order_prefix')}
          ${chk('allow_negative', t('wh_f_allow_negative'), c.allow_negative, !ed)}
          ${f(t('wh_f_invoice_note'), `<textarea name="invoice_note" ${dis}>${esc(c.invoice_note)}</textarea>`, 'wide')}
        </div>
        <div class="whw-hint">${esc(t('wh_invoice_numbering_hint'))}</div>
        ${ed ? `<div class="whw-actions"><button class="whw-btn pri" data-save>${esc(t('wh_save'))}</button></div>` : ''}`;
      const sv = el.querySelector('[data-save]');
      if (sv) sv.onclick = () => busy(sv, async () => {
        const body = Object.assign(readForm(el.querySelector('[data-form]')), readForm(el.querySelector('[data-form2]')));
        if (String(body.invoice_next) === String(S.info.invoice_next)) delete body.invoice_next;
        await capi('PUT', '/settings', body);
        await reloadInfo();
        toast(t('wh_saved'));
        render();
      });
    }
    function setWarehouses(el) {
      const ed = can('settings', 2);
      el.innerHTML = `<div class="whw-list">${S.info.warehouses.map(w => `<div class="whw-item">
          <div class="n"><b>${esc(w.name)} ${w.is_default ? badge('posted', t('wh_default')) : ''} ${w.archived ? badge('cancelled', t('wh_archived')) : ''}</b>
            <small>${esc(w.address || '')}</small></div>
          ${ed ? `${!w.is_default && !w.archived ? `<button class="whw-btn sm" data-def="${esc(w.id)}">${esc(t('wh_make_default'))}</button>` : ''}
            ${w.archived ? `<button class="whw-btn sm" data-unarch="${esc(w.id)}">${esc(t('wh_restore'))}</button>` : ''}
            <button class="whw-btn sm" data-edit="${esc(w.id)}">${esc(t('wh_edit'))}</button>
            ${!w.is_default && !w.archived ? `<button class="whw-btn sm dan" data-del="${esc(w.id)}">✕</button>` : ''}` : ''}
        </div>`).join('')}</div>
        ${ed ? `<div class="whw-actions"><button class="whw-btn pri" data-new>${esc(t('wh_new_warehouse'))}</button></div>` : ''}`;
      const after = async () => { await reloadInfo(); setWarehouses(el); };
      el.querySelectorAll('[data-def]').forEach(b => { b.onclick = () => busy(b, async () => { await capi('PUT', `/warehouses/${b.dataset.def}`, { is_default: true }); await after(); }); });
      el.querySelectorAll('[data-unarch]').forEach(b => { b.onclick = () => busy(b, async () => { await capi('PUT', `/warehouses/${b.dataset.unarch}`, { archived: false }); await after(); }); });
      el.querySelectorAll('[data-del]').forEach(b => {
        b.onclick = () => busy(b, async () => {
          if (!await ask(t('wh_delete_warehouse_confirm'), t('wh_delete'), true)) return;
          const r = await capi('DELETE', `/warehouses/${b.dataset.del}`);
          toast(r.archived ? t('wh_archived_instead') : t('wh_deleted'));
          await after();
        });
      });
      const form = (w) => {
        const m = modal(w ? t('wh_edit') : t('wh_new_warehouse'), `<div class="whw-form" data-form>${f(t('wh_f_name'), inp('name', w ? w.name : ''))}
          ${f(t('wh_f_address'), inp('address', w ? w.address : ''), 'wide')}</div>
          <div class="whw-actions"><button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button><button class="whw-btn pri" data-go>${esc(t('wh_save'))}</button></div>`);
        m.querySelector('[data-close]').onclick = m.close;
        const go = m.querySelector('[data-go]');
        go.onclick = () => busy(go, async () => {
          const body = readForm(m.querySelector('[data-form]'));
          if (w) await capi('PUT', `/warehouses/${w.id}`, body); else await capi('POST', '/warehouses', body);
          m.close(); await after();
        });
      };
      el.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => form(S.info.warehouses.find(w => w.id === b.dataset.edit)); });
      const nb = el.querySelector('[data-new]');
      if (nb) nb.onclick = () => form(null);
    }
    function permsGrid(perms, dis) {
      return `<div class="whw-tablewrap"><table class="whw-t whw-perms"><tbody>${AREAS.map(a => `<tr><td>${esc(t('wh_area_' + a))}</td>
          <td><select data-area="${a}" ${dis ? 'disabled' : ''}>${[0, 1, 2].map(l => `<option value="${l}" ${(perms[a] || 0) === l ? 'selected' : ''}>${esc(t('wh_level_' + l))}</option>`).join('')}</select></td></tr>`).join('')}
        <tr><td>${esc(t('wh_area_costs'))}</td><td><label class="whw-chk" style="padding:0"><input type="checkbox" data-costs ${perms.costs ? 'checked' : ''} ${dis ? 'disabled' : ''}>
          <span>${esc(t('wh_costs_visible'))}</span></label></td></tr></tbody></table></div>`;
    }
    function readPerms(scope) {
      const p = {};
      scope.querySelectorAll('[data-area]').forEach(s => { p[s.dataset.area] = +s.value; });
      p.costs = scope.querySelector('[data-costs]').checked ? 1 : 0;
      return p;
    }
    function avatar(u) {
      const name = u.display_name || u.username || '?';
      return `<div class="whw-av" style="background:${esc(u.avatar_color || '#89b4fa')}">${esc(name.trim().charAt(0).toUpperCase())}</div>`;
    }
    function setTeam(el) {
      return guard(el, async () => {
        const r = await capi('GET', '/members');
        const ed = can('settings', 2);
        el.innerHTML = `<p class="whw-dim" style="margin-top:0">${esc(t('wh_team_intro'))}</p>
          <div class="whw-list">${r.members.map(u => `<div class="whw-item ${ed && u.role !== 'owner' ? 'click' : ''}" data-uid="${esc(u.user_id)}">
            ${avatar(u)}<div class="n"><b>${esc(u.display_name || u.username || '?')}</b><small>@${esc(u.username || '')} · ${esc(t('wh_role_' + u.role))}</small></div>
          </div>`).join('')}</div>
          ${ed ? `<div class="whw-actions"><button class="whw-btn pri" data-add>${esc(t('wh_add_member'))}</button></div>` : ''}`;
        el.querySelectorAll('.whw-item.click').forEach(it => {
          it.onclick = () => memberDialog(r.members.find(u => u.user_id === it.dataset.uid), r.presets, () => setTeam(el));
        });
        const ab = el.querySelector('[data-add]');
        if (ab) ab.onclick = () => busy(ab, async () => {
          const c = await capi('GET', '/candidates');
          if (!c.candidates.length) { toast(t('wh_no_candidates'), true); return; }
          memberDialog(null, r.presets, () => setTeam(el), c.candidates);
        });
      });
    }
    function memberDialog(u, presets, done, candidates) {
      const role = u ? u.role : 'sales';
      const m = modal(u ? (u.display_name || u.username) : t('wh_add_member'), `
        ${candidates ? f(t('wh_f_person'), `<select name="user_id">${candidates.map(c => `<option value="${esc(c.user_id)}">${esc(c.display_name || c.username)} (@${esc(c.username || '')})</option>`).join('')}</select>`) : ''}
        <div class="whw-hint" style="margin:6px 0 10px">${candidates ? esc(t('wh_candidates_hint')) : ''}</div>
        ${f(t('wh_f_role'), `<select name="role">${ROLES.map(x => `<option value="${x}" ${x === role ? 'selected' : ''}>${esc(t('wh_role_' + x))}</option>`).join('')}</select>`)}
        <div class="whw-hint" data-rolehint></div>
        <div data-perms style="margin-top:10px"></div>
        <div class="whw-actions">${u ? `<button class="whw-btn dan l" data-rm>${esc(t('wh_remove_member'))}</button>` : ''}
          <button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button><button class="whw-btn pri" data-go>${esc(t('wh_save'))}</button></div>`);
      const roleSel = m.querySelector('[name=role]');
      const permsBox = m.querySelector('[data-perms]');
      function drawPerms() {
        const r = roleSel.value;
        const perms = r === 'custom' ? (u && u.role === 'custom' ? u.perms : (presets.sales)) : presets[r];
        permsBox.innerHTML = permsGrid(perms, r !== 'custom');
        m.querySelector('[data-rolehint]').textContent = r === 'custom' ? t('wh_custom_hint') : t('wh_role_hint_' + r);
      }
      roleSel.onchange = drawPerms;
      drawPerms();
      m.querySelector('[data-close]').onclick = m.close;
      const go = m.querySelector('[data-go]');
      go.onclick = () => busy(go, async () => {
        const body = { role: roleSel.value, perms: readPerms(permsBox) };
        if (u) await capi('PUT', `/members/${enc(u.user_id)}`, body);
        else await capi('POST', '/members', Object.assign(body, { user_id: m.querySelector('[name=user_id]').value }));
        m.close(); done();
      });
      const rm = m.querySelector('[data-rm]');
      if (rm) rm.onclick = () => busy(rm, async () => {
        if (!await ask(t('wh_remove_member_confirm', { name: u.display_name || u.username }), t('wh_remove_member'), true)) return;
        await capi('DELETE', `/members/${enc(u.user_id)}`);
        m.close(); done();
      });
    }
    function setKeys(el) {
      return guard(el, async () => {
        if (!can('settings', 2)) { el.innerHTML = empty('wh_err_forbidden'); return; }
        const r = await capi('GET', '/apikeys');
        const base = location.origin + API + '/api/v1';
        el.innerHTML = `<p class="whw-dim" style="margin-top:0">${esc(t('wh_api_intro'))}</p>
          <div class="whw-hint" style="margin-bottom:10px">${esc(t('wh_api_base'))} <code>${esc(base)}</code> ·
            <a href="${esc(API + '/api/v1')}" target="_blank" rel="noopener" style="color:var(--pub-accent,#89b4fa)">${esc(t('wh_api_routes'))}</a></div>
          <div class="whw-list">${r.keys.map(k => `<div class="whw-item"><div class="n"><b>🔑 ${esc(k.name)}</b>
              <small>${esc(k.prefix)}… · ${esc(t('wh_created_on', { date: fdate(k.created_at) }))} ·
              ${k.last_used_at ? esc(t('wh_last_used', { date: fdatetime(k.last_used_at) })) : esc(t('wh_never_used'))}</small></div>
              <button class="whw-btn sm dan" data-del="${esc(k.id)}">${esc(t('wh_revoke'))}</button></div>`).join('') || empty('wh_no_keys')}</div>
          <div class="whw-actions"><button class="whw-btn pri" data-new>${esc(t('wh_new_key'))}</button></div>`;
        el.querySelectorAll('[data-del]').forEach(b => {
          b.onclick = () => busy(b, async () => {
            if (!await ask(t('wh_revoke_confirm'), t('wh_revoke'), true)) return;
            await capi('DELETE', `/apikeys/${b.dataset.del}`);
            setKeys(el);
          });
        });
        el.querySelector('[data-new]').onclick = () => {
          const m = modal(t('wh_new_key'), `${f(t('wh_f_name'), inp('name', '', `placeholder="${esc(t('wh_key_name_ph'))}"`))}
            <div class="whw-sec">${esc(t('wh_key_perms'))}</div>
            ${permsGrid({ catalog: 1, stock: 1, pricelists: 1, orders: 2, payments: 2, partners: 1 }, false).replace(/<tr><td>[^<]*<\/td>\s*<td><select data-area="settings"[\s\S]*?<\/tr>/, '')}
            <div class="whw-actions"><button class="whw-btn" data-close>${esc(t('wh_cancel'))}</button><button class="whw-btn pri" data-go>${esc(t('wh_create'))}</button></div>`);
          m.querySelector('[data-close]').onclick = m.close;
          const go = m.querySelector('[data-go]');
          go.onclick = () => busy(go, async () => {
            const k = await capi('POST', '/apikeys', { name: m.querySelector('[name=name]').value, perms: readPerms(m) });
            m.body.innerHTML = `<p style="margin-top:0">${esc(t('wh_key_once'))}</p><div class="whw-key">${esc(k.key)}</div>
              <div class="whw-hint" style="margin-top:8px">Authorization: Bearer ${esc(k.key.slice(0, 10))}…</div>
              <div class="whw-actions"><button class="whw-btn" data-copy>${esc(t('wh_copy'))}</button><button class="whw-btn pri" data-done>${esc(t('wh_done'))}</button></div>`;
            m.querySelector('[data-copy]').onclick = () => {
              (navigator.clipboard ? navigator.clipboard.writeText(k.key) : Promise.reject()).then(() => toast(t('wh_copied')), () => {});
            };
            m.querySelector('[data-done]').onclick = () => { m.close(); setKeys(el); };
            m.querySelector('[data-x]').addEventListener('click', () => setKeys(el));
          });
        };
      });
    }
    function setDanger(el) {
      const name = S.info.company.name;
      el.innerHTML = `<div class="whw-card" style="border:1px solid var(--pub-red,#f38ba8)"><b>${esc(t('wh_delete_company'))}</b>
        <p class="whw-dim">${esc(t('wh_delete_company_text'))}</p>
        ${f(t('wh_type_name_to_confirm', { name }), inp('confirm', ''))}
        <div class="whw-actions"><button class="whw-btn dan" data-go disabled>${esc(t('wh_delete_company'))}</button></div></div>`;
      const input = el.querySelector('[name=confirm]');
      const go = el.querySelector('[data-go]');
      input.oninput = () => { go.disabled = input.value.trim() !== name; };
      go.onclick = () => busy(go, async () => {
        await api('DELETE', `/c/${S.info.company.id}?confirm=${enc(input.value.trim())}`);
        lsSet('mvmwarehouse_company', '');
        S.info = null;
        S.companies = (await api('GET', '/companies')).companies;
        renderCompanies();
        toast(t('wh_deleted'));
      });
    }

    const VIEW_FNS = {
      dashboard: viewDashboard, products: viewProducts, stock: viewStock, pricelists: viewPricelists, partners: viewPartners,
      orders: viewOrders, invoices: viewInvoices, payments: viewPayments, reports: viewReports, settings: viewSettings,
    };

    if (window.mvmOS && window.mvmOS.onLangChange) {
      window.mvmOS.onLangChange(() => { if (!S.destroyed && document.body.contains(W)) (S.info ? render() : renderCompanies()); });
    }
    start();
    return {
      destroy() { S.destroyed = true; root.innerHTML = ''; },
    };
  }

  window.MvmWarehouse = { mount };
})();
