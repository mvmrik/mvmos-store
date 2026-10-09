// Hydration — widget shared by the desktop app window and the standalone
// Apps Hub public page (same pattern as apps/shoppinglist).
(function () {
  if (window.HydrationWidget) return;

  const API = '/pub/hydration';
  const OZ_ML = 29.5735295625;
  // Offered when a drink's colour is chosen; any other colour can be picked too.
  const PALETTE = ['#4ea8ff', '#00bfa5', '#6a9f2e', '#c6e600', '#f2b705', '#ffa726', '#ff7043', '#ef5350',
    '#8c1d18', '#ec407a', '#8e244d', '#ab47bc', '#7986cb', '#8b5a2b', '#e8dfc8', '#90a4ae'];
  // Icons for custom drinks: drinks first, then foods that hold water.
  const EMOJIS = ['💧', '🚰', '🧊', '🥛', '🍼', '☕', '🍵', '🫖', '🧉', '🧋', '🥤', '🧃', '🍺', '🍻', '🍷', '🥂',
    '🍸', '🍹', '🍾', '🥃', '🍶', '🫗', '🥥', '🍋', '🍊', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🫐', '🍇', '🍉',
    '🍈', '🍍', '🥭', '🍌', '🥝', '🍅', '🥒', '🥕', '🥬', '🌿', '🍃', '🌱', '🍯', '🍫', '🍲', '🥣', '🍜', '🥗',
    '🍦', '🍨', '🧪', '⚡', '💪', '🏃', '❄️', '🔥', '🌶️', '⭐'];
  // The parts of what was drunk, in the order the inner ring draws them.
  const PARTS = [['water', '#4ea8ff'], ['caffeine', '#8b5a2b'], ['alcohol', '#b03a74'], ['sugar', '#f2b705'],
    ['protein', '#43a047']];
  const ZERO = { amount_ml: 0, water_ml: 0, caffeine_mg: 0, alcohol_g: 0, calories_kcal: 0, sugar_g: 0, protein_g: 0 };
  const col = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#89b4fa';

  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function shiftDay(day, delta) {
    const [y, m, d] = day.split('-').map(Number);
    return ymd(new Date(y, m - 1, d + delta));
  }

  // Date and time follow the regional settings: the Apps Hub profile's own
  // choice when it has one, otherwise the mvmOS system setting.
  let regional = { time_format: '24', date_format: 'DD/MM/YYYY' };
  async function loadRegional(token) {
    let s = null;
    try {
      const r = await fetch('/pub/apphub/me', { headers: { 'X-Pub-Token': token } });
      if (r.ok) s = await r.json();
    } catch (e) {}
    let sys = window._vosSettings || null;
    if (!sys || !sys.time_format) {
      try {
        const r = await fetch('/api/settings/display');
        if (r.ok) sys = await r.json();
      } catch (e) {}
    }
    regional = {
      time_format: (s && s.time_format) || (sys && sys.time_format) || '24',
      date_format: (s && s.date_format) || (sys && sys.date_format) || 'DD/MM/YYYY',
    };
  }
  function fmtDate(day) {
    const [y, m, d] = day.split('-');
    if (regional.date_format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
    if (regional.date_format === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    return `${d}/${m}/${y}`;
  }
  function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString(window.mvmOS?.lang || undefined,
      { hour: '2-digit', minute: '2-digit', hour12: regional.time_format === '12' });
  }

  function injectStyles() {
    if (document.getElementById('hy-styles')) return;
    const style = document.createElement('style');
    style.id = 'hy-styles';
    style.textContent = `
      .hy-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);
        font-family:system-ui,sans-serif;position:relative;box-sizing:border-box}
      .hy-widget *{box-sizing:border-box}
      .hy-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2,#a6adc8)}
      .hy-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2,#313244);flex-shrink:0}
      .hy-tabs{display:flex;gap:4px;flex:1}
      .hy-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:.85rem;white-space:nowrap}
      .hy-btn:hover{background:var(--pub-border,#45475a)}
      .hy-btn:disabled{opacity:.4;cursor:default}
      .hy-btn.on{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
      .hy-bar .hy-settings-btn{flex:0 0 34px;width:34px;height:34px;padding:0;font-size:1.05rem}
      .hy-body{flex:1;overflow-y:auto;padding:14px 14px 24px;display:flex;flex-direction:column;gap:16px}
      .hy-days{display:flex;align-items:center;justify-content:center;gap:12px}
      .hy-daylabel{min-width:130px;text-align:center;font-weight:600}
      .hy-hero{display:flex;justify-content:center}
      .hy-ring{position:relative;width:min(270px,74vw);aspect-ratio:1;flex-shrink:0;cursor:pointer;border:none;background:none;padding:0;color:inherit;font:inherit;border-radius:50%}
      .hy-ring:focus-visible{outline:2px solid var(--pub-accent,#89b4fa);outline-offset:4px}
      .hy-ring svg{width:100%;height:100%;transform:rotate(-90deg);display:block}
      .hy-ring-track{stroke:var(--pub-surface2,#313244)}
      .hy-ring-txt{position:absolute;inset:22%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px}
      .hy-ring-pct{font-size:2.5rem;font-weight:700;line-height:1.1}
      .hy-ring-sub{font-size:.82rem;color:var(--pub-fg2,#a6adc8)}
      .hy-ring-left{font-size:.82rem;font-weight:600;color:var(--pub-accent,#89b4fa)}
      .hy-ring-left.done{color:var(--pub-green,#a6e3a1)}
      .hy-stat{display:flex;align-items:center;gap:10px;font-size:.9rem;background:var(--pub-surface2,#313244);border-radius:8px;padding:8px 12px}
      .hy-sn{flex:1;min-width:0;color:var(--pub-fg2,#a6adc8)}
      .hy-stat b{white-space:nowrap}
      .hy-stat i{font-style:normal;font-size:.78rem;color:var(--pub-fg2,#a6adc8);min-width:46px;text-align:right}
      .hy-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
      .hy-badge{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:1.15rem;flex-shrink:0;border-left:4px solid transparent}
      .hy-swatches{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      .hy-sw{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
      .hy-sw.sel{border-color:var(--pub-fg,#cdd6f4);box-shadow:0 0 0 2px var(--pub-bg,#1e1e2e) inset}
      .hy-swatches input[type=color]{width:38px;height:32px;border:none;background:none;padding:0;cursor:pointer}
      .hy-emojis{display:grid;grid-template-columns:repeat(auto-fill,minmax(40px,1fr));gap:4px;max-height:176px;overflow-y:auto;padding:2px}
      .hy-emo{font-size:1.35rem;height:40px;border-radius:8px;border:2px solid transparent;background:var(--pub-surface2,#313244);cursor:pointer;padding:0}
      .hy-emo.sel{border-color:var(--pub-accent,#89b4fa)}
      .hy-h{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,#a6adc8)}
      .hy-headrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      .hy-headrow .hy-btn{padding:9px 14px;min-height:40px;max-width:60%;overflow:hidden;text-overflow:ellipsis}
      .hy-chips{display:flex;flex-wrap:wrap;gap:6px}
      .hy-chip{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:2px solid transparent;border-radius:20px;padding:8px 14px;min-height:40px;cursor:pointer;font-size:.85rem;display:inline-flex;align-items:center;gap:6px}
      .hy-chip:hover{background:var(--pub-border,#45475a)}
      .hy-chip.sel{border-color:var(--pub-accent,#89b4fa)}
      .hy-title{flex:1;font-weight:600;font-size:1rem}
      .hy-card{background:var(--pub-surface2,#313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:12px}
      .hy-card .hy-input{background:var(--pub-bg,#1e1e2e)}
      details.hy-card>*:not(summary){margin-top:12px}
      details.hy-card>summary{font-size:.9rem;font-weight:600}
      .hy-row.off .hy-row-main,.hy-row.off .hy-badge{opacity:.5}
      .hy-row-main[data-act]{cursor:pointer;min-height:42px;display:flex;flex-direction:column;justify-content:center}
      .hy-switch{position:relative;width:52px;height:30px;border-radius:15px;border:none;background:var(--pub-border,#45475a);cursor:pointer;flex-shrink:0;padding:0;margin:6px 4px}
      .hy-switch i{position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:var(--pub-fg,#cdd6f4);transition:left .15s}
      .hy-switch.on{background:var(--pub-accent,#89b4fa)}
      .hy-switch.on i{left:25px;background:var(--pub-bg,#1e1e2e)}
      .hy-check{display:flex;align-items:center;gap:10px;font-size:.9rem;min-height:40px;cursor:pointer}
      .hy-check input{width:20px;height:20px}
      .hy-addsrv{display:flex;gap:6px;margin-top:8px}
      .hy-chip .hy-x{opacity:.7}
      .hy-amounts{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
      .hy-amt{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);border:none;border-radius:8px;padding:11px 16px;min-height:42px;font-weight:600;cursor:pointer;font-size:.9rem}
      .hy-amt:hover{background:var(--pub-accent-hover,#a6c8ff)}
      .hy-input{background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:8px 10px;font-size:.9rem;width:100%}
      .hy-custom{display:flex;gap:6px;width:170px}
      .hy-list{display:flex;flex-direction:column;gap:6px}
      .hy-row{display:flex;align-items:center;gap:8px;background:var(--pub-surface2,#313244);border-radius:8px;padding:8px 10px}
      .hy-row-main{flex:1;min-width:0}
      .hy-row-name{font-size:.92rem}
      .hy-row-meta{font-size:.74rem;color:var(--pub-fg2,#a6adc8)}
      .hy-row-amt{font-weight:600;white-space:nowrap}
      .hy-ico{background:var(--pub-bg,#1e1e2e);border:none;color:var(--pub-fg2,#a6adc8);cursor:pointer;font-size:1.05rem;width:42px;height:42px;border-radius:8px;flex-shrink:0}
      .hy-ico:hover{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}
      .hy-empty{color:var(--pub-dim,#6c7086);text-align:center;padding:20px 12px}
      .hy-hrow{display:grid;grid-template-columns:82px 1fr auto;gap:10px;align-items:center;cursor:pointer;padding:5px 4px;border-radius:6px}
      .hy-hrow:hover{background:var(--pub-surface2,#313244)}
      .hy-hbar{height:14px;background:var(--pub-surface2,#313244);border-radius:7px;overflow:hidden;display:flex}
      .hy-hrow:hover .hy-hbar{background:var(--pub-border,#45475a)}
      .hy-hseg{height:100%;flex-shrink:0}
      .hy-hseg+.hy-hseg{border-left:1px solid var(--pub-bg,#1e1e2e)}
      .hy-hval.done{color:var(--pub-green,#a6e3a1)}
      .hy-hval{font-size:.8rem;color:var(--pub-fg2,#a6adc8);text-align:right;min-width:120px}
      .hy-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px;z-index:5}
      .hy-dialog{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:10px;padding:18px;width:100%;max-width:400px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
      .hy-dialog h3{margin:0;font-size:1.05rem}
      .hy-field label{display:block;font-size:.78rem;color:var(--pub-fg2,#a6adc8);margin-bottom:4px}
      .hy-hint{font-size:.75rem;color:var(--pub-dim,#6c7086)}
      .hy-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .hy-actions .hy-del{margin-right:auto;background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);font-weight:600}
      .hy-primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
      .hy-check{display:flex;align-items:center;gap:8px;min-height:32px;cursor:pointer;font-size:.9rem}
      .hy-note{background:var(--pub-surface2,#313244);border-left:4px solid var(--pub-green,#a6e3a1);border-radius:8px;padding:10px 12px;font-size:.88rem}
      .hy-err{color:var(--pub-red,#f38ba8);font-size:.82rem;min-height:1em}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="hy-widget"></div>';
    const w = root.firstChild;
    if (!token) {
      w.innerHTML = `<div class="hy-login">${esc(t('hy_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    const st = {
      tab: 'today', today: ymd(new Date()), day: ymd(new Date()),
      calc: { sex: 'm', age: '', weight: '', note: '', open: false }, view: 'main', unit: 'ml', target: 2000, dayEnd: 0, drinks: [], sel: null, picked: false, hm: null, hday: null, hentries: [],
      entries: [], totals: null, history: [], ready: false, error: '',
      health: { loaded: false, enabled: false, available: false, msg: '' },
      rewardOffered: false, reward: { enabled: false, amount: 0, to_category: '', from_category: '' },
      cats: { loaded: false, available: false, categories: [], currency: null }, rewardMsg: '', notice: '',
    };

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        if (r.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || ('http_' + r.status));
        return data;
      });
    }

    // Values are stored in ml; ounces are only how they are shown and typed.
    const toDisp = ml => st.unit === 'oz' ? ml / OZ_ML : ml;
    const fromDisp = v => st.unit === 'oz' ? v * OZ_ML : v;
    function fmtVol(ml) {
      if (st.unit === 'oz') return (Math.round(ml / OZ_ML * 10) / 10) + ' oz';
      return ml >= 1000 ? (Math.round(ml / 10) / 100) + ' L' : Math.round(ml) + ' ml';
    }
    function num(n, d) { return String(Math.round(n * (d || 1)) / (d || 1)); }

    function label(d) { return d.kind === 'ready' ? (d.name || t('hy_p_' + d.id)) : d.name; }
    function drinkName(id, name) {
      const d = st.drinks.find(x => x.id === id);
      return d && d.kind === 'ready' ? label(d) : name;
    }
    // How a logged drink looks: as the drink looks now, or as it was saved
    // when the drink no longer exists.
    function look(x) {
      const d = st.drinks.find(y => y.id === x.product_id);
      return { icon: (d && d.icon) || x.icon || '🧪', color: col((d && d.color) || x.color) };
    }
    function badge(lk) {
      return `<span class="hy-badge" style="background:${lk.color}33;border-left-color:${lk.color}">${esc(lk.icon)}</span>`;
    }
    // Before the hour the user chose as the end of their day, it is still yesterday.
    function logicalToday() {
      const d = new Date();
      if (d.getHours() < st.dayEnd) d.setDate(d.getDate() - 1);
      return ymd(d);
    }
    function rollDay() {
      const now = logicalToday();
      if (now === st.today) return false;
      if (st.day === st.today) st.day = now;
      st.today = now;
      return true;
    }
    function fmtServ(ml) {
      return st.unit === 'oz' ? (Math.round(ml / OZ_ML * 10) / 10) + ' oz' : (Math.round(ml * 10) / 10) + ' ml';
    }
    // Most recently used first; never used ones keep their natural order.
    function byRecent(list, used, tie) {
      return list.map((x, i) => [x, i]).sort((a, b) => {
        const ua = used(a[0]), ub = used(b[0]);
        if (ua && ub && ua !== ub) return ua < ub ? 1 : -1;
        if (!ua !== !ub) return ua ? -1 : 1;
        return tie ? tie(a[0], b[0]) : a[1] - b[1];
      }).map(x => x[0]);
    }
    function homeDrinks() { return byRecent(st.drinks.filter(d => d.active), d => d.last_used); }
    function curDrink() {
      const list = homeDrinks();
      return list.find(d => d.id === st.sel) || list[0] || null;
    }
    function servingsRecent(d) { return byRecent(d.servings, s => s.last_used, (a, b) => a.ml - b.ml); }

    function goalOf(day, kept) { return (day >= st.today ? st.target : kept) || st.target; }

    async function loadDay() {
      const d = await api('/day?day=' + encodeURIComponent(st.day));
      st.entries = d.entries; st.totals = d.totals; st.dayTarget = d.target_ml;
    }
    // The history shows one calendar month at a time (never beyond today).
    function monthOf(day) { const [y, m] = day.split('-').map(Number); return { y, m }; }
    function monthEnd(hm) {
      const last = ymd(new Date(hm.y, hm.m, 0));
      return last < st.today ? last : st.today;
    }
    function monthLabel(hm) {
      const lang = (window.mvmOS && window.mvmOS.lang) || navigator.language || 'en';
      try { return new Date(hm.y, hm.m - 1, 1).toLocaleDateString(lang, { month: 'long', year: 'numeric' }); }
      catch (e) { return hm.y + '-' + pad2(hm.m); }
    }
    function shiftMonth(hm, delta) {
      const d = new Date(hm.y, hm.m - 1 + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() + 1 };
    }
    async function loadHistory() {
      if (!st.hm) st.hm = monthOf(st.today);
      const end = monthEnd(st.hm);
      const days = Number(end.slice(8));
      const d = await api('/history?days=' + days + '&end=' + encodeURIComponent(end));
      st.history = d.days;
    }
    async function loadHistDay() {
      const d = await api('/day?day=' + encodeURIComponent(st.hday));
      st.hentries = d.entries;
    }
    async function refresh() {
      try {
        if (st.tab === 'today') await loadDay(); else if (st.hday) await loadHistDay(); else await loadHistory();
        st.error = '';
      } catch (e) { st.error = t('hy_error'); }
      render();
    }

    // The parts the app knows of, by weight (a millilitre of water counted as a
    // gram), compared only with each other: fat, salts and the rest are left out.
    function composition(tt) {
      const g = {
        water: tt.water_ml, caffeine: tt.caffeine_mg / 1000, alcohol: tt.alcohol_g,
        sugar: tt.sugar_g, protein: tt.protein_g,
      };
      return PARTS.map(([key, color]) => ({ key, color, g: g[key] || 0 }));
    }
    function pctText(part, total) {
      const p = part / total * 100;
      return p < 0.1 ? '<0.1%' : (p < 10 ? Math.round(p * 10) / 10 : Math.round(p)) + '%';
    }
    function arc(R, w, color, len, pos, C) {
      return `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${color}" stroke-width="${w}"
        stroke-dasharray="${Math.max(len, 0.5).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-pos).toFixed(2)}"/>`;
    }

    // The outer ring is the water towards the goal, one piece per drink in the
    // order they were had and in that drink's colour; the inner ring, touching
    // it, is what everything drunk today was made of, water included.
    function ring() {
      // Today follows the goal setting; a day that is over keeps the goal it had.
      const tt = st.totals || ZERO, water = tt.water_ml, target = goalOf(st.day, st.dayTarget);
      const R = 86, W = 18, C = 2 * Math.PI * R, R2 = 71, W2 = 10, C2 = 2 * Math.PI * R2;
      const list = st.entries.filter(e => e.water_ml > 0).reverse();
      const gap = list.length > 1 ? 1.4 : 0;
      let pos = 0, outer = '';
      for (const e of list) {
        if (pos >= C) break;
        const len = Math.min(e.water_ml / target * C, C - pos);
        outer += arc(R, W, look(e).color, len - gap, pos, C);
        pos += len;
      }
      // Tiny parts, such as caffeine, would be invisible at their true size,
      // so each one is drawn at least 2% of the ring, taken from the largest.
      const comp = composition(tt).filter(p => p.g > 0), total = comp.reduce((a, p) => a + p.g, 0);
      let inner = '';
      if (total > 0) {
        const MIN = 0.02;
        let extra = 0;
        const fr = comp.map(p => { const f = p.g / total; if (f < MIN) { extra += MIN - f; return MIN; } return f; });
        fr[fr.indexOf(Math.max(...fr))] -= extra;
        const gap2 = comp.length > 1 ? 1.2 : 0;
        let p2 = 0;
        comp.forEach((p, i) => { inner += arc(R2, W2, p.color, fr[i] * C2 - gap2, p2, C2); p2 += fr[i] * C2; });
      }
      const done = water >= target;
      return `<button class="hy-ring" data-act="details" title="${esc(t('hy_ring_title'))}" aria-label="${esc(t('hy_ring_title'))}">
          <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="hy-ring-track" cx="100" cy="100" r="${R}" fill="none" stroke-width="${W}"/>
          <circle class="hy-ring-track" cx="100" cy="100" r="${R2}" fill="none" stroke-width="${W2}" opacity=".6"/>
          ${outer}${inner}</svg>
          <span class="hy-ring-txt"><span class="hy-ring-pct">${Math.round(water / target * 100)}%</span>
          <span class="hy-ring-sub">${esc(t('hy_progress', { a: fmtVol(water), b: fmtVol(target) }))}</span>
          <span class="hy-ring-left${done ? ' done' : ''}">${esc(done ? '✓ ' + t('hy_goal_done') : t('hy_left', { v: fmtVol(target - water) }))}</span></span></button>`;
    }

    function statRow(color, name, value, pct) {
      return `<div class="hy-stat">${color ? `<span class="hy-dot" style="background:${color}"></span>` : ''}<span class="hy-sn">${esc(name)}</span>
        <b>${esc(value)}</b>${pct != null ? `<i>${esc(pct)}</i>` : ''}</div>`;
    }
    // Everything the ring sums up, only what there is any of.
    function detailsDialog() {
      const tt = st.totals || ZERO;
      const comp = composition(tt), total = comp.reduce((a, p) => a + p.g, 0);
      const names = { water: t('hy_water'), caffeine: t('hy_caffeine'), alcohol: t('hy_alcohol'), sugar: t('hy_sugar'),
        protein: t('hy_protein') };
      const value = p => p.key === 'water' ? fmtVol(p.g) : p.key === 'caffeine' ? num(tt.caffeine_mg) + ' mg' : num(p.g, 10) + ' g';
      const parts = comp.filter(p => p.g > 0).map(p => statRow(p.color, names[p.key], value(p), pctText(p.g, total))).join('');
      const per = {};
      st.entries.slice().reverse().forEach(e => {
        const x = per[e.product_id] || (per[e.product_id] = { e, amount: 0, water: 0 });
        x.amount += e.amount_ml; x.water += e.water_ml;
      });
      const drinks = Object.values(per).map(x => `<div class="hy-stat">${badge(look(x.e))}<span class="hy-sn">${esc(drinkName(x.e.product_id, x.e.name))}</span>
        <b>${esc(fmtVol(x.amount))}</b></div>`).join('');
      dialog(`<h3>${esc(t('hy_today'))} · ${esc(fmtDate(st.day))}</h3>
        ${total > 0 ? `${statRow('', t('hy_drunk'), fmtVol(tt.amount_ml))}
          ${tt.calories_kcal > 0 ? statRow('', t('hy_energy'), num(tt.calories_kcal) + ' kcal') : ''}
          <div class="hy-h">${esc(t('hy_composition'))}</div>${parts}
          <div class="hy-hint">${esc(t('hy_composition_hint'))}</div>
          <div class="hy-h">${esc(t('hy_by_drink'))}</div>${drinks}`
        : `<div class="hy-empty">${esc(t('hy_no_entries'))}</div>`}
        <div class="hy-actions"><button class="hy-btn hy-primary" data-close>${esc(t('hy_close'))}</button></div>`, () => {});
    }

    function entryRows(list) {
      return list.map(e => {
        const meta = [t('hy_meta_water', { v: fmtVol(e.water_ml) })];
        if (e.caffeine_mg > 0) meta.push(t('hy_meta_caf', { v: num(e.caffeine_mg) }));
        if (e.alcohol_g > 0) meta.push(t('hy_meta_alc', { v: num(e.alcohol_g, 10) }));
        if (e.calories_kcal > 0) meta.push(t('hy_meta_kcal', { v: num(e.calories_kcal) }));
        if (e.sugar_g > 0) meta.push(t('hy_meta_sugar', { v: num(e.sugar_g, 10) }));
        if (e.protein_g > 0) meta.push(t('hy_meta_protein', { v: num(e.protein_g, 10) }));
        return `<div class="hy-row">${badge(look(e))}<div class="hy-row-main"><div class="hy-row-name">${esc(drinkName(e.product_id, e.name))} · ${esc(fmtTime(e.recorded_at))}</div>
            <div class="hy-row-meta">${esc(meta.join(' · '))}</div></div>
            <div class="hy-row-amt">${esc(fmtVol(e.amount_ml))}</div>
            <button class="hy-ico" data-act="editentry" data-id="${esc(e.id)}" title="${esc(t('hy_edit'))}">✎</button>
            <button class="hy-ico" data-act="delentry" data-id="${esc(e.id)}" title="${esc(t('hy_delete'))}">✕</button></div>`;
      }).join('');
    }

    function todayView() {
      const cur = curDrink();
      // Choosing a drink collapses the list to that one chip and reveals its
      // servings; clicking the chip opens the full list again.
      const showAmounts = !!(cur && st.picked);
      const chips = (showAmounts ? [cur] : homeDrinks()).map(d => {
        const c = col(d.color);
        return `<span class="hy-chip${showAmounts ? ' sel' : ''}" style="border-color:${c}${showAmounts ? '' : '66'};${showAmounts ? `background:${c}33` : ''}"
          data-act="${showAmounts ? 'unpick' : 'pick'}" data-id="${esc(d.id)}">
          <span>${esc(d.icon || '🧪')}</span><span>${esc(label(d))}</span>${showAmounts ? '<span>▾</span>' : ''}</span>`;
      }).join('');
      const quick = showAmounts ? servingsRecent(cur).map(v => `<button class="hy-amt" data-act="quick" data-ml="${v.ml}">+${esc(fmtServ(v.ml))}</button>`).join('') : '';
      // Only today is listed here; a picked drink narrows the list to itself.
      const rows = entryRows(showAmounts ? st.entries.filter(e => e.product_id === cur.id) : st.entries);
      const picker = cur ? `
        <div><div class="hy-h" style="margin-bottom:8px">${esc(t('hy_choose_drink'))}</div><div class="hy-chips">${chips}</div></div>
        ${showAmounts ? `<div><div class="hy-h" style="margin-bottom:8px">${esc(t('hy_amount'))}</div><div class="hy-amounts">${quick}
          <div class="hy-custom"><input class="hy-input" id="hy-amt" type="number" min="1" step="any" placeholder="${st.unit === 'oz' ? 'oz' : 'ml'}">
          <button class="hy-amt" data-act="addcustom">${esc(t('hy_add'))}</button></div></div></div>` : ''}`
        : `<div class="hy-empty">${esc(t('hy_no_visible'))}<br><br><button class="hy-btn hy-primary" data-act="settings">${esc(t('hy_open_settings'))}</button></div>`;
      return `
        <div class="hy-hero">${ring()}</div>
        ${picker}
        <div class="hy-list">${rows || `<div class="hy-empty">${esc(t('hy_no_entries'))}</div>`}</div>`;
    }

    function historyView() {
      if (st.hday) {
        return `<div class="hy-days"><button class="hy-btn" data-act="histback">‹</button>
          <div class="hy-daylabel">${esc(fmtDate(st.hday))}</div></div>
          <div class="hy-list">${entryRows(st.hentries) || `<div class="hy-empty">${esc(t('hy_no_entries'))}</div>`}</div>`;
      }
      const hm = st.hm || monthOf(st.today), cur = monthOf(st.today);
      const after = (a, b) => a.y > b.y || (a.y === b.y && a.m > b.m);
      const atNow = hm.y === cur.y && hm.m === cur.m;
      const nav = `<div class="hy-days"><button class="hy-btn" data-act="hmove" data-d="-12">«</button>
          <button class="hy-btn" data-act="hmove" data-d="-1">‹</button>
          <div class="hy-daylabel" style="text-transform:capitalize">${esc(monthLabel(hm))}</div>
          <button class="hy-btn" data-act="hmove" data-d="1" ${atNow ? 'disabled' : ''}>›</button>
          <button class="hy-btn" data-act="hmove" data-d="12" ${after(shiftMonth(hm, 12), cur) ? 'disabled' : ''}>»</button></div>`;
      const max = Math.max(...st.history.map(d => Math.max(goalOf(d.day, d.target_ml), d.water_ml)), 1);
      return nav + `<div class="hy-list">` + st.history.slice().reverse().map(d => {
        const done = d.water_ml >= goalOf(d.day, d.target_ml);
        const extra = [];
        if (d.caffeine_mg > 0) extra.push(num(d.caffeine_mg) + ' mg');
        if (d.alcohol_g > 0) extra.push(num(d.alcohol_g, 10) + ' g');
        // The bar is built from each drink's water in that drink's colour.
        const segs = (d.drinks || []).filter(x => x.water_ml > 0).map(x =>
          `<div class="hy-hseg" style="width:${(x.water_ml / max * 100).toFixed(2)}%;background:${look(x).color}"></div>`).join('');
        return `<div class="hy-hrow" data-act="goday" data-day="${d.day}"><div>${esc(fmtDate(d.day))}</div>
          <div class="hy-hbar">${segs}</div>
          <div class="hy-hval${done ? ' done' : ''}">${done ? '✓ ' : ''}${esc(fmtVol(d.water_ml))}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</div></div>`;
      }).join('') + `</div>`;
    }

    function drinkRow(d) {
      const meta = ['💧 ' + num(d.water_percent, 10) + '%'];
      if (d.caffeine_mg_100 > 0) meta.push('☕ ' + num(d.caffeine_mg_100, 10) + ' mg');
      if (d.alcohol_percent > 0) meta.push(num(d.alcohol_percent, 10) + '% vol');
      if (d.calories_kcal_100 > 0) meta.push(num(d.calories_kcal_100) + ' kcal');
      if (d.protein_g_100 > 0) meta.push(num(d.protein_g_100, 10) + ' g ' + t('hy_protein').toLowerCase());
      const srv = d.servings.length ? d.servings.map(s => fmtServ(s.ml).replace(/ (ml|oz)$/, '')).join(' · ') + (st.unit === 'oz' ? ' oz' : ' ml') : '–';
      return `<div class="hy-row${d.active ? '' : ' off'}">${badge({ icon: d.icon || '🧪', color: col(d.color) })}
        <div class="hy-row-main" data-act="editdrink" data-id="${esc(d.id)}"><div class="hy-row-name">${esc(label(d))}</div>
          <div class="hy-row-meta">${esc(meta.join(' · '))}</div>
          <div class="hy-row-meta">${esc(t('hy_servings'))}: ${esc(srv)}</div></div>
        <button class="hy-switch${d.active ? ' on' : ''}" role="switch" aria-checked="${d.active}" data-act="toggle" data-id="${esc(d.id)}"
          title="${esc(t(d.active ? 'hy_hide_drink' : 'hy_show_drink'))}"><i></i></button>
        <button class="hy-ico" data-act="editdrink" data-id="${esc(d.id)}" title="${esc(t('hy_edit'))}">✎</button></div>`;
    }

    function healthCard() {
      const h = st.health;
      if (!h.loaded) return '';
      const body = !h.available && !h.enabled
        ? `<div class="hy-hint">${esc(t('hy_health_unavailable'))}</div>`
        : `<label class="hy-check"><input type="checkbox" id="hy-health"${h.enabled ? ' checked' : ''}> ${esc(t('hy_health_enable'))}</label>
           ${!h.available ? `<div class="hy-hint">${esc(t('hy_health_unavailable'))}</div>` : ''}
           ${h.msg ? `<div class="hy-hint">${esc(h.msg)}</div>` : ''}`;
      return `<div class="hy-h">${esc(t('hy_health_title'))}</div><div class="hy-card"><div class="hy-hint">${esc(t('hy_health_hint'))}</div>${body}</div>`;
    }

    function curLabel() { return typeof st.cats.currency === 'string' ? st.cats.currency : ''; }
    function rewardAmountText(v, cur) { cur = typeof cur === 'string' && cur ? cur : curLabel(); return (Math.round(v * 100) / 100) + (cur ? ' ' + cur : ''); }
    function rewardCard() {
      if (!st.rewardOffered) return '';
      const r = st.reward, cats = st.cats.categories;
      const opts = (sel, none) => (none ? `<option value="">${esc(t('hy_reward_none'))}</option>` : `<option value="">${esc(t('hy_reward_choose'))}</option>`) +
        cats.map(c => `<option value="${esc(c.id)}"${c.has_children ? ' disabled' : ''}${sel === c.id ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
      let body;
      if (!st.cats.loaded) body = `<div class="hy-hint">…</div>`;
      else if (!st.cats.available) body = `<div class="hy-hint">${esc(t('hy_reward_unavailable'))}</div>`;
      else if (!cats.length) body = `<div class="hy-hint">${esc(t('hy_reward_no_categories'))}</div>`;
      else body = `
        <label class="hy-check"><input type="checkbox" id="hy-rw-on"${r.enabled ? ' checked' : ''}> ${esc(t('hy_reward_enable'))}</label>
        <div class="hy-field"><label>${esc(t('hy_reward_amount'))}${curLabel() ? ' (' + esc(curLabel()) + ')' : ''}</label>
          <input class="hy-input" id="hy-rw-amount" type="number" min="0" step="any" value="${r.amount ? esc(String(r.amount)) : ''}"></div>
        <div class="hy-field"><label>${esc(t('hy_reward_to'))}</label><select class="hy-input" id="hy-rw-to">${opts(r.to_category, false)}</select></div>
        <div class="hy-field"><label>${esc(t('hy_reward_from'))}</label><select class="hy-input" id="hy-rw-from">${opts(r.from_category, true)}</select></div>
        <div class="hy-hint">${esc(t('hy_reward_from_hint'))}</div>
        ${st.rewardMsg ? `<div class="hy-hint">${esc(st.rewardMsg)}</div>` : ''}`;
      return `<div class="hy-h">${esc(t('hy_reward_title'))}</div><div class="hy-card"><div class="hy-hint">${esc(t('hy_reward_hint'))}</div>${body}</div>`;
    }

    // Saved as soon as a field changes, like the other settings.
    async function saveReward() {
      const g = id => w.querySelector(id);
      const body = { enabled: g('#hy-rw-on').checked, amount: Number(g('#hy-rw-amount').value || 0),
        to_category: g('#hy-rw-to').value || null, from_category: g('#hy-rw-from').value || null };
      try {
        st.reward = await api('/reward', { method: 'PUT', body: JSON.stringify(body) });
        st.rewardMsg = st.reward.enabled ? t('hy_reward_saved') : t('hy_reward_off'); st.error = '';
      } catch (er) {
        st.rewardMsg = t(er.message === 'same_category' ? 'hy_reward_same' : er.message === 'invalid_reward' ? 'hy_reward_invalid' : 'hy_error');
        st.reward = Object.assign({}, st.reward, { enabled: body.enabled, amount: body.amount, to_category: body.to_category || '', from_category: body.from_category || '' });
      }
      render();
    }

    async function loadRewardCats() {
      if (!st.rewardOffered || st.cats.loaded) return;
      try {
        const d = await api('/reward');
        st.cats = { loaded: true, available: !!d.available, categories: d.categories || [], currency: d.currency || null };
        st.reward = d.reward || st.reward;
      } catch (e) { st.cats = { loaded: true, available: false, categories: [], currency: null }; }
      if (st.view === 'settings') render();
    }

    function settingsView() {
      const ready = st.drinks.filter(d => d.kind === 'ready'), mine = st.drinks.filter(d => d.kind === 'custom');
      const unitLbl = st.unit === 'oz' ? 'oz' : 'ml';
      return `
        <div class="hy-bar"><button class="hy-btn" data-act="back">‹ ${esc(t('hy_back'))}</button><div class="hy-title">${esc(t('hy_settings'))}</div></div>
        <div class="hy-body">${st.error ? `<div class="hy-err">${esc(st.error)}</div>` : ''}
          <div class="hy-h">${esc(t('hy_general'))}</div>
          <div class="hy-card">
            <div class="hy-field"><label>${esc(t('hy_unit'))}</label><select class="hy-input" id="hy-unit">
              <option value="ml"${st.unit === 'ml' ? ' selected' : ''}>${esc(t('hy_unit_ml'))}</option>
              <option value="oz"${st.unit === 'oz' ? ' selected' : ''}>${esc(t('hy_unit_oz'))}</option></select></div>
            <div class="hy-field"><label>${esc(t('hy_target'))} (${unitLbl})</label>
              <input class="hy-input" id="hy-target" type="number" min="1" step="any" value="${num(toDisp(st.target), 10)}"></div>
            <div class="hy-field"><label>${esc(t('hy_day_end'))}</label><select class="hy-input" id="hy-dayend">
              ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(h => `<option value="${h}"${st.dayEnd === h ? ' selected' : ''}>${esc(h ? fmtTime(new Date(2000, 0, 1, h).toISOString()) : t('hy_day_end_midnight'))}</option>`).join('')}</select>
              <div class="hy-hint" style="margin-top:6px">${esc(t('hy_day_end_hint'))}</div></div></div>
          <details class="hy-card" id="hy-calc"${st.calc.open ? ' open' : ''}><summary style="cursor:pointer;min-height:32px;display:flex;align-items:center">${esc(t('hy_calc_title'))}</summary>
            <div class="hy-hint">${esc(t('hy_calc_hint'))}</div>
            <div class="hy-field"><label>${esc(t('hy_sex'))}</label><select class="hy-input" id="hy-sex">
              <option value="m"${st.calc.sex === 'm' ? ' selected' : ''}>${esc(t('hy_male'))}</option>
              <option value="f"${st.calc.sex === 'f' ? ' selected' : ''}>${esc(t('hy_female'))}</option></select></div>
            <div class="hy-field"><label>${esc(t('hy_age'))}</label><input class="hy-input" id="hy-age" type="number" min="1" max="120" step="1" value="${esc(st.calc.age)}"></div>
            <div class="hy-field"><label>${esc(t('hy_weight'))} (${st.unit === 'oz' ? 'lb' : 'kg'})</label><input class="hy-input" id="hy-weight" type="number" min="1" step="any" value="${esc(st.calc.weight)}"></div>
            <button class="hy-btn hy-primary" data-act="calc">${esc(t('hy_calc_btn'))}</button>
            ${st.calc.note ? `<div class="hy-hint">${esc(st.calc.note)}</div>` : ''}</details>
          ${healthCard()}
          ${rewardCard()}
          <div class="hy-headrow" style="margin:6px 0 0"><div class="hy-h">${esc(t('hy_drinks'))}</div>
            <button class="hy-btn hy-primary" data-act="newdrink">＋ ${esc(t('hy_add_drink'))}</button></div>
          <div class="hy-hint">${esc(t('hy_drinks_hint'))}</div>
          <div class="hy-h">${esc(t('hy_ready_made'))}</div>
          <div class="hy-list">${ready.map(drinkRow).join('')}</div>
          <div class="hy-h">${esc(t('hy_my_drinks'))}</div>
          <div class="hy-list">${mine.map(drinkRow).join('') || `<div class="hy-empty">${esc(t('hy_no_my_drinks'))}</div>`}</div>
        </div>`;
    }

    function render() {
      if (st.view === 'settings') { w.innerHTML = settingsView(); return; }
      w.innerHTML = `
        <div class="hy-bar"><div class="hy-tabs">
          <button class="hy-btn${st.tab === 'today' ? ' on' : ''}" data-act="tab" data-tab="today">${esc(t('hy_today'))}</button>
          <button class="hy-btn${st.tab === 'history' ? ' on' : ''}" data-act="tab" data-tab="history">${esc(t('hy_history'))}</button></div>
          <button class="hy-btn hy-settings-btn" data-act="settings" type="button" title="${esc(t('hy_settings'))}" aria-label="${esc(t('hy_settings'))}">⚙</button></div>
        <div class="hy-body">${st.error ? `<div class="hy-err">${esc(st.error)}</div>` : ''}${st.notice ? `<div class="hy-note">💰 ${esc(st.notice)}</div>` : ''}${st.ready ? (st.tab === 'today' ? todayView() : historyView()) : ''}</div>`;
    }

    function dialog(html, onMount) {
      closeDialog();
      const ov = document.createElement('div');
      ov.className = 'hy-overlay';
      ov.innerHTML = `<div class="hy-dialog">${html}</div>`;
      ov.addEventListener('mousedown', e => { if (e.target === ov) closeDialog(); });
      w.appendChild(ov);
      ov.querySelector('[data-close]')?.addEventListener('click', closeDialog);
      onMount(ov);
      ov.querySelector('input')?.focus();
    }
    function closeDialog() { w.querySelector('.hy-overlay')?.remove(); }
    function fail(ov, e) { ov.querySelector('.hy-err').textContent = e && e.message === 'name_required' ? t('hy_name_required') : t('hy_error'); }

    function drinkDialog(d) {
      const ready = !!d && d.kind === 'ready';
      d = d || { name: '', water_percent: 100, caffeine_mg_100: 0, alcohol_percent: 0, calories_kcal_100: 0, sugar_g_100: 0, protein_g_100: 0, active: true,
        servings: [150, 250, 500].map(ml => ({ ml })), icon: '🥤', color: PALETTE[st.drinks.filter(x => x.kind === 'custom').length % PALETTE.length] };
      let srv = d.servings.map(s => s.ml);
      let color = col(d.color), icon = d.icon || '🧪';
      const unitLbl = st.unit === 'oz' ? 'oz' : 'ml';
      const f = (id, lbl, val, max) => `<div class="hy-field"><label>${esc(lbl)}</label>
        <input class="hy-input" id="${id}" type="number" min="0" max="${max}" step="any" value="${esc(val)}"></div>`;
      dialog(`<h3>${esc(t(ready ? 'hy_edit_ready' : d.id ? 'hy_edit_drink' : 'hy_new_drink'))}</h3>
        <div class="hy-field"><label>${esc(t('hy_name'))}</label><input class="hy-input" id="hy-name" maxlength="60" value="${esc(d.name)}"${ready ? ` placeholder="${esc(t('hy_p_' + d.id))}"` : ''}></div>
        ${ready ? '' : `<div class="hy-field"><label>${esc(t('hy_icon'))}</label><div class="hy-emojis" id="hy-emojis">
          ${(EMOJIS.includes(icon) ? EMOJIS : [icon].concat(EMOJIS)).map(e => `<button type="button" class="hy-emo${e === icon ? ' sel' : ''}" data-e="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>`}
        <div class="hy-field"><label>${esc(t('hy_color'))}</label><div class="hy-swatches" id="hy-swatches">
          ${PALETTE.map(c => `<button type="button" class="hy-sw" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
          <input type="color" id="hy-color" value="${color}" title="${esc(t('hy_color'))}"></div></div>
        ${f('hy-water', t('hy_water_percent'), d.water_percent, 100)}
        ${f('hy-caf', t('hy_caffeine_100'), d.caffeine_mg_100, 1000)}
        ${f('hy-alc', t('hy_alcohol_percent'), d.alcohol_percent, 100)}
        ${f('hy-kcal', t('hy_calories_100'), d.calories_kcal_100 || 0, 900)}
        ${f('hy-sugar', t('hy_sugar_100'), d.sugar_g_100 || 0, 100)}
        ${f('hy-protein', t('hy_protein_100'), d.protein_g_100 || 0, 100)}
        <div class="hy-hint">${esc(t('hy_values_hint'))}</div>
        <div class="hy-field"><label>${esc(t('hy_servings'))} (${unitLbl})</label><div class="hy-chips" id="hy-srv"></div>
          <div class="hy-addsrv"><input class="hy-input" id="hy-newsrv" type="number" min="0" step="any" placeholder="${unitLbl}">
            <button class="hy-btn" id="hy-addsrv">${esc(t('hy_add_serving'))}</button></div>
          <div class="hy-hint" style="margin-top:6px">${esc(t('hy_servings_hint'))}</div></div>
        <label class="hy-check"><input type="checkbox" id="hy-active"${d.active ? ' checked' : ''}><span>${esc(t('hy_shown'))}</span></label>
        <div class="hy-err"></div>
        <div class="hy-actions">${ready ? `<button class="hy-btn hy-del" id="hy-reset">${esc(t('hy_reset'))}</button>`
          : d.id ? `<button class="hy-btn hy-del" id="hy-rm">${esc(t('hy_delete'))}</button>` : ''}
          <button class="hy-btn" data-close>${esc(t('hy_cancel'))}</button><button class="hy-btn hy-primary" id="hy-ok">${esc(t('hy_save'))}</button></div>`,
      ov => {
        const box = ov.querySelector('#hy-srv'), inp = ov.querySelector('#hy-newsrv');
        const drawSrv = () => {
          box.innerHTML = srv.length ? srv.map((ml, i) => `<button class="hy-chip" data-i="${i}" title="${esc(t('hy_remove'))}">${esc(fmtServ(ml))} <span class="hy-x">✕</span></button>`).join('')
            : `<div class="hy-hint">${esc(t('hy_no_servings'))}</div>`;
        };
        // Returns false when the typed value is not a usable new serving.
        const addSrv = () => {
          const v = Number(inp.value);
          if (!inp.value) return true;
          const ml = Math.round(fromDisp(v) * 10) / 10;
          if (!(ml >= 1 && ml <= 5000) || srv.length >= 12) { fail(ov); return false; }
          if (!srv.includes(ml)) srv.push(ml);
          srv.sort((a, b) => a - b); inp.value = ''; drawSrv(); return true;
        };
        drawSrv();
        const swatches = ov.querySelector('#hy-swatches'), picker = ov.querySelector('#hy-color');
        const drawColor = () => swatches.querySelectorAll('.hy-sw').forEach(b => b.classList.toggle('sel', b.dataset.c === color));
        drawColor();
        swatches.addEventListener('click', e => {
          const b = e.target.closest('[data-c]'); if (!b) return;
          color = b.dataset.c; picker.value = color; drawColor();
        });
        picker.addEventListener('input', () => { color = col(picker.value); drawColor(); });
        ov.querySelector('#hy-emojis')?.addEventListener('click', e => {
          const b = e.target.closest('[data-e]'); if (!b) return;
          icon = b.dataset.e;
          ov.querySelectorAll('.hy-emo').forEach(x => x.classList.toggle('sel', x === b));
        });
        box.addEventListener('click', e => {
          const b = e.target.closest('[data-i]'); if (!b) return;
          srv.splice(Number(b.dataset.i), 1); drawSrv();
        });
        ov.querySelector('#hy-addsrv').addEventListener('click', addSrv);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addSrv(); } });
        const store = r => {
          if (st.drinks.some(x => x.id === r.id)) st.drinks = st.drinks.map(x => x.id === r.id ? r : x); else st.drinks.push(r);
          closeDialog(); render();
        };
        ov.querySelector('#hy-ok').addEventListener('click', async () => {
          if (!addSrv()) return;
          const body = JSON.stringify({
            name: ov.querySelector('#hy-name').value,
            water_percent: Number(ov.querySelector('#hy-water').value),
            caffeine_mg_100: Number(ov.querySelector('#hy-caf').value || 0),
            alcohol_percent: Number(ov.querySelector('#hy-alc').value || 0),
            calories_kcal_100: Number(ov.querySelector('#hy-kcal').value || 0),
            sugar_g_100: Number(ov.querySelector('#hy-sugar').value || 0),
            protein_g_100: Number(ov.querySelector('#hy-protein').value || 0),
            servings: srv, active: ov.querySelector('#hy-active').checked,
            color, ...(ready ? {} : { icon }),
          });
          try {
            if (ready) store(await api('/presets/' + d.id, { method: 'PUT', body }));
            else store(await api(d.id ? '/products/' + d.id : '/products', { method: d.id ? 'PUT' : 'POST', body }));
          } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hy-reset')?.addEventListener('click', async () => {
          try { store(await api('/presets/' + d.id, { method: 'DELETE' })); } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hy-rm')?.addEventListener('click', async () => {
          if (!confirm(t('hy_confirm_delete_drink', { name: d.name }))) return;
          try {
            await api('/products/' + d.id, { method: 'DELETE' });
            st.drinks = st.drinks.filter(x => x.id !== d.id); closeDialog(); render();
          } catch (e) { fail(ov, e); }
        });
      });
    }

    function amountDialog(entry) {
      dialog(`<h3>${esc(t('hy_edit_amount'))}</h3>
        <div class="hy-field"><label>${esc(drinkName(entry.product_id, entry.name))} (${st.unit === 'oz' ? 'oz' : 'ml'})</label>
          <input class="hy-input" id="hy-a" type="number" min="1" step="any" value="${num(toDisp(entry.amount_ml), 10)}"></div>
        <div class="hy-err"></div>
        <div class="hy-actions"><button class="hy-btn" data-close>${esc(t('hy_cancel'))}</button><button class="hy-btn hy-primary" id="hy-ok">${esc(t('hy_save'))}</button></div>`,
      ov => {
        ov.querySelector('#hy-ok').addEventListener('click', async () => {
          try {
            showReward(await api('/entries/' + entry.id, { method: 'PUT', body: JSON.stringify({ amount_ml: fromDisp(Number(ov.querySelector('#hy-a').value)) }) }));
            closeDialog(); refresh();
          } catch (e) { fail(ov, e); }
        });
      });
    }

    function showReward(entry) {
      st.notice = entry && entry.reward ? t('hy_reward_added', { v: rewardAmountText(entry.reward.amount, entry.reward.currency) }) : '';
    }

    async function addAmount(ml) {
      const cur = curDrink();
      if (!cur || !(ml > 0)) return;
      rollDay();
      try {
        const added = await api('/entries', { method: 'POST', body: JSON.stringify({ day: st.day, amount_ml: ml, product_id: cur.id }) });
        showReward(added);
        const now = new Date().toISOString(), r = Math.round(ml * 10) / 10;
        cur.last_used = now;
        const sv = cur.servings.find(x => x.ml === r); if (sv) sv.last_used = now;
        st.sel = cur.id;
        await loadDay(); st.error = '';
      } catch (e) { st.error = t('hy_error'); }
      render();
    }

    // A rough guide from weight, adjusted a little for age and sex, rounded to
    // 50 ml. Only fills the target field; the user can always type their own.
    function calcTarget() {
      const c = st.calc, age = Number(c.age);
      const kg = st.unit === 'oz' ? Number(c.weight) * 0.45359237 : Number(c.weight);
      if (!(age >= 1 && age <= 120) || !(kg >= 10 && kg <= 400)) return null;
      let ml = kg * (age < 30 ? 35 : age <= 55 ? 33 : 30);
      if (c.sex === 'f') ml *= 0.9;
      return Math.min(6000, Math.max(1000, Math.round(ml / 50) * 50));
    }

    async function savePrefs(unit, targetMl, dayEnd) {
      try {
        const r = await api('/settings', { method: 'PUT', body: JSON.stringify({ unit, target_ml: targetMl, day_end_hour: dayEnd == null ? st.dayEnd : dayEnd }) });
        st.unit = r.unit; st.target = r.target_ml; st.dayEnd = r.day_end_hour || 0; st.error = '';
        rollDay();
      } catch (e) { st.error = t('hy_error'); }
      render();
    }

    w.addEventListener('click', async e => {
      const el = e.target.closest('[data-act]');
      if (!el || !w.contains(el)) return;
      const act = el.dataset.act;
      if (act === 'tab') { st.tab = el.dataset.tab; st.hday = null; st.notice = ''; await refresh(); }
      else if (act === 'settings') { st.view = 'settings'; st.error = ''; st.notice = ''; st.rewardMsg = ''; render(); loadRewardCats(); w.querySelector('.hy-body')?.scrollTo(0, 0); }
      else if (act === 'calc') {
        const ml = calcTarget();
        st.calc.open = true;
        if (ml == null) { st.calc.note = t('hy_calc_invalid'); render(); return; }
        st.calc.note = t('hy_calc_done', { v: fmtVol(ml) });
        await savePrefs(st.unit, ml);
      }
      else if (act === 'back') { st.view = 'main'; st.error = ''; await refresh(); }
      else if (act === 'toggle') {
        const d = st.drinks.find(x => x.id === el.dataset.id); if (!d) return;
        try { const r = await api('/drinks/' + d.id, { method: 'PUT', body: JSON.stringify({ active: !d.active }) }); Object.assign(d, r); st.error = ''; }
        catch (er) { st.error = t('hy_error'); }
        render();
      }
      else if (act === 'goday') { st.hday = el.dataset.day; st.hentries = []; render(); await refresh(); }
      else if (act === 'histback') { st.hday = null; await refresh(); }
      else if (act === 'hmove') {
        let hm = shiftMonth(st.hm || monthOf(st.today), Number(el.dataset.d));
        const cur = monthOf(st.today);
        if (hm.y > cur.y || (hm.y === cur.y && hm.m > cur.m)) hm = cur;
        st.hm = hm; await refresh();
      }
      else if (act === 'details') detailsDialog();
      else if (act === 'pick') { st.sel = el.dataset.id; st.picked = true; render(); }
      else if (act === 'unpick') { st.picked = false; render(); }
      else if (act === 'editdrink') { const d = st.drinks.find(x => x.id === el.dataset.id); if (d) drinkDialog(d); }
      else if (act === 'newdrink') drinkDialog();
      else if (act === 'quick') addAmount(Number(el.dataset.ml));
      else if (act === 'addcustom') { const i = w.querySelector('#hy-amt'); if (i) addAmount(fromDisp(Number(i.value))); }
      else if (act === 'editentry') { const en = st.entries.concat(st.hentries).find(x => x.id === el.dataset.id); if (en) amountDialog(en); }
      else if (act === 'delentry') {
        if (!confirm(t('hy_confirm_delete_entry'))) return;
        try { await api('/entries/' + el.dataset.id, { method: 'DELETE' }); st.notice = ''; await (st.tab === 'today' ? loadDay() : loadHistDay()); } catch (er) { st.error = t('hy_error'); }
        render();
      }
    });
    w.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'hy-amt') addAmount(fromDisp(Number(e.target.value)));
    });
    w.addEventListener('input', e => {
      if (e.target.id === 'hy-age') st.calc.age = e.target.value;
      else if (e.target.id === 'hy-weight') st.calc.weight = e.target.value;
    });
    w.addEventListener('toggle', e => { if (e.target.id === 'hy-calc') st.calc.open = e.target.open; }, true);
    w.addEventListener('change', e => {
      if (e.target.id === 'hy-health') {
        const on = e.target.checked;
        api('/health', { method: 'PUT', body: JSON.stringify({ enabled: on }) }).then(r => {
          st.health = Object.assign(st.health, { enabled: r.enabled, available: r.available, msg: r.enabled ? t('hy_health_on', { n: r.synced_days }) : t('hy_health_off') });
          render();
        }).catch(() => { st.health.msg = t('hy_error'); e.target.checked = !on; render(); });
      }
      else if (['hy-rw-on', 'hy-rw-amount', 'hy-rw-to', 'hy-rw-from'].includes(e.target.id)) saveReward();
      else if (e.target.id === 'hy-sex') st.calc.sex = e.target.value;
      else if (e.target.id === 'hy-dayend') savePrefs(st.unit, st.target, Number(e.target.value));
      else if (e.target.id === 'hy-unit') savePrefs(e.target.value === 'oz' ? 'oz' : 'ml', st.target);
      else if (e.target.id === 'hy-target') {
        const ml = fromDisp(Number(e.target.value));
        if (ml >= 100 && ml <= 20000) savePrefs(st.unit, ml); else { st.error = t('hy_error'); render(); }
      }
    });

    // A new day starts by itself when the page is left open overnight.
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      rollDay();
      refresh();
    }
    document.addEventListener('visibilitychange', onVisible);

    const onLang = () => render();
    if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(onLang);

    (async () => {
      try {
        const [, me] = await Promise.all([loadRegional(token), api('/me')]);
        st.unit = me.settings.unit; st.target = me.settings.target_ml; st.dayEnd = me.settings.day_end_hour || 0;
        st.drinks = me.drinks; st.ready = true;
        rollDay();
        st.rewardOffered = !!me.reward_offered; if (me.reward) st.reward = me.reward;
        await loadDay();
      } catch (e) { st.error = t('hy_error'); }
      render();
      loadRewardCats();
      api('/health').then(h => { st.health = Object.assign(st.health, h, { loaded: true }); if (st.view === 'settings') render(); }).catch(() => {});
    })();

    return { destroy() { document.removeEventListener('visibilitychange', onVisible); } };
  }

  window.HydrationWidget = { mount };
})();
