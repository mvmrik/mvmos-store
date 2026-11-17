// Nutrition — widget shared by the desktop app window and the standalone
// Apps Hub public page (same pattern as apps/hydration).
(function () {
  if (window.NutritionWidget) return;

  const API = '/pub/nutrition';
  const MEAL_ICONS = ['🌅', '☀️', '🌙', '🍎', '🥐', '🥪', '🍲', '🥗', '☕', '🍪', '🥛', '🍽️'];
  const GOALS = ['lose_weight', 'maintain', 'gain_muscle', 'healthier', 'high_protein', 'low_carb', 'custom'];
  const ACTIVITY = [1.2, 1.375, 1.55, 1.725, 1.9];
  const NUT = ['kcal', 'protein', 'carbs', 'sugar', 'fat', 'sat_fat', 'fiber', 'salt', 'water'];
  // Only what a food or a day actually has: energy always, the rest when it is not zero.
  const nutShow = o => NUT.filter(k => k === 'kcal' || (Number(o[k]) || 0) > 0);
  const nutDec = k => (k === 'salt' ? 2 : 1);
  // Rows of the day's breakdown: the key, its colour, the goal key and whether the goal is a floor or a ceiling.
  const ROWS = [['protein', '#43a047', 'protein_min', 'min'], ['carbs', '#f2b705', 'carbs_max', 'max'],
    ['sugar', '#ec407a', 'sugar_max', 'max'], ['fat', '#ff7043', '', ''], ['sat_fat', '#c0702a', '', ''],
    ['fiber', '#7986cb', 'fiber_min', 'min'], ['salt', '#90a4ae', 'salt_max', 'max'], ['water', '#4fc3f7', '', '']];
  const ALLERGENS = ['gluten', 'milk', 'eggs', 'peanuts', 'tree_nuts', 'soy', 'fish', 'shellfish', 'sesame',
    'mustard', 'celery', 'lupin', 'molluscs', 'sulphites'];

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
  const rnd = (v, d) => { const k = Math.pow(10, d || 0); return Math.round((Number(v) || 0) * k) / k; };

  // Dates follow the regional settings: the Apps Hub profile's own choice
  // when it has one, otherwise the mvmOS system setting.
  let regional = { date_format: 'DD/MM/YYYY' };
  async function loadRegional(token) {
    let s = null;
    try {
      const r = await fetch('/api/pub/apphub/me', { headers: { 'X-Pub-Token': token } });
      if (r.ok) s = await r.json();
    } catch (e) {}
    let sys = window._vosSettings || null;
    if (!sys || !sys.date_format) {
      try {
        const r = await fetch('/api/settings/display');
        if (r.ok) sys = await r.json();
      } catch (e) {}
    }
    regional = { date_format: (s && s.date_format) || (sys && sys.date_format) || 'DD/MM/YYYY' };
  }
  function fmtDate(day) {
    const [y, m, d] = day.split('-');
    if (regional.date_format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
    if (regional.date_format === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    return `${d}/${m}/${y}`;
  }

  function injectStyles() {
    if (document.getElementById('nu-styles')) return;
    const style = document.createElement('style');
    style.id = 'nu-styles';
    style.textContent = `
      .nu-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);
        font-family:system-ui,sans-serif;position:relative;box-sizing:border-box}
      .nu-widget *{box-sizing:border-box}
      .nu-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2,#a6adc8)}
      .nu-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2,#313244);flex-shrink:0}
      .nu-tabs{display:flex;gap:4px;flex:1;flex-wrap:wrap}
      .nu-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:.85rem;min-height:34px}
      .nu-btn:hover{background:var(--pub-border,#45475a)}
      .nu-btn:disabled{opacity:.4;cursor:default}
      .nu-btn.on,.nu-btn.main{background:var(--pub-accent,#89b4fa);color:var(--on-accent,var(--pub-bg,#1e1e2e));font-weight:600}
      .nu-btn.danger{color:var(--pub-red,#f38ba8)}
      .nu-body{flex:1;overflow-y:auto;padding:14px 14px 28px;display:flex;flex-direction:column;gap:14px}
      .nu-days{display:flex;align-items:center;justify-content:center;gap:12px}
      .nu-daylabel{min-width:130px;text-align:center;font-weight:600}
      .nu-card{background:var(--pub-surface2,#313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}
      .nu-card .nu-input{background:var(--pub-bg,#1e1e2e)}
      .nu-h{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,#a6adc8)}
      .nu-hint{font-size:.8rem;color:var(--pub-fg2,#a6adc8);line-height:1.35}
      .nu-err{color:var(--pub-red,#f38ba8);font-size:.82rem}
      .nu-ok{color:var(--pub-green,#a6e3a1)}
      .nu-big{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
      .nu-big b{font-size:2.3rem;line-height:1.1}
      .nu-track{position:relative;height:14px;border-radius:7px;background:var(--pub-bg,#1e1e2e);overflow:hidden}
      .nu-fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px}
      .nu-band{position:absolute;top:0;bottom:0;background:var(--pub-green,#a6e3a1);opacity:.3}
      .nu-row{display:flex;align-items:center;gap:10px;font-size:.88rem}
      .nu-row .nu-n{flex:1;min-width:0}
      .nu-row b{white-space:nowrap}
      .nu-mini{height:6px;border-radius:3px;background:var(--pub-bg,#1e1e2e);overflow:hidden;margin-top:4px}
      .nu-mini i{display:block;height:100%}
      .nu-meal{display:flex;flex-direction:column;gap:6px}
      .nu-mealhead{display:flex;align-items:center;gap:8px}
      .nu-mealhead .nu-title{flex:1;font-weight:600}
      .nu-entry{display:flex;align-items:center;gap:10px;background:var(--pub-surface2,#313244);border-radius:8px;padding:9px 11px;cursor:pointer;min-height:44px}
      .nu-entry:hover{background:var(--pub-border,#45475a)}
      .nu-entry .nu-main{flex:1;min-width:0}
      .nu-entry .nu-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nu-entry .nu-sub{font-size:.76rem;color:var(--pub-fg2,#a6adc8)}
      .nu-warn{color:var(--pub-yellow,#f9e2af)}
      .nu-input{width:100%;background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:9px 10px;font-size:.92rem;min-height:40px;font-family:inherit}
      textarea.nu-input{min-height:64px;resize:vertical}
      .nu-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
      .nu-field>label{font-size:.78rem;color:var(--pub-fg2,#a6adc8)}
      .nu-fields{display:flex;flex-wrap:wrap;gap:8px}
      .nu-fields .nu-field{flex:1 1 90px}
      .nu-chips{display:flex;flex-wrap:wrap;gap:6px}
      .nu-chip{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:2px solid transparent;border-radius:20px;padding:7px 13px;min-height:38px;cursor:pointer;font-size:.85rem;display:inline-flex;align-items:center;gap:6px}
      .nu-chip:hover{background:var(--pub-border,#45475a)}
      .nu-chip.sel{border-color:var(--pub-accent,#89b4fa)}
      .nu-card .nu-chip{background:var(--pub-bg,#1e1e2e)}
      .nu-check{display:flex;align-items:center;gap:10px;font-size:.9rem;min-height:38px;cursor:pointer}
      .nu-check input{width:20px;height:20px}
      .nu-food{display:flex;align-items:center;gap:10px;background:var(--pub-surface2,#313244);border-radius:8px;padding:9px 11px;cursor:pointer;min-height:48px;width:100%;text-align:left;border:none;color:inherit;font:inherit}
      .nu-food:hover{background:var(--pub-border,#45475a)}
      .nu-ico{font-size:1.4rem;width:34px;text-align:center;flex-shrink:0}
      .nu-verdict{border-radius:8px;padding:10px 12px;font-size:.88rem;display:flex;flex-direction:column;gap:6px;border-left:4px solid var(--pub-green,#a6e3a1);background:var(--pub-surface2,#313244)}
      .nu-verdict.caution{border-left-color:var(--pub-yellow,#f9e2af)}
      .nu-verdict.avoid{border-left-color:var(--pub-red,#f38ba8)}
      .nu-verdict b{font-size:.95rem}
      .nu-scan{position:absolute;inset:0;background:rgba(0,0,0,.85);z-index:5;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px}
      .nu-scan video{width:100%;max-width:420px;border-radius:10px;background:#000}
      .nu-scan .nu-hint{color:#ddd}
      .nu-ing{display:flex;align-items:center;gap:8px}
      .nu-ing .nu-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nu-ing .nu-input{width:84px}
      .nu-ringwrap{display:flex;justify-content:center}
      .nu-ring{position:relative;width:min(270px,74vw);aspect-ratio:1;flex-shrink:0;cursor:pointer;border:none;background:none;padding:0;color:inherit;font:inherit;border-radius:50%}
      .nu-ring:focus-visible{outline:2px solid var(--pub-accent,#89b4fa);outline-offset:4px}
      .nu-ring svg{width:100%;height:100%;transform:rotate(-90deg);display:block}
      .nu-ring-track{stroke:var(--pub-surface2,#313244)}
      .nu-ring-txt{position:absolute;inset:22%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:2px}
      .nu-ring-pct{font-size:2.5rem;font-weight:700;line-height:1.1}
      .nu-ring-sub{font-size:.82rem;color:var(--pub-fg2,#a6adc8)}
      .nu-ring-left{font-size:.82rem;font-weight:600;color:var(--pub-accent,#89b4fa)}
      .nu-ring-left.done{color:var(--pub-green,#a6e3a1)}
      .nu-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px;z-index:5}
      .nu-dialog{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:10px;padding:18px;width:100%;max-width:400px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
      .nu-dialog h3{margin:0;font-size:1.05rem}
      .nu-legend{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;font-size:.76rem;color:var(--pub-fg2,#a6adc8)}
      .nu-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px}
      .nu-chart{position:relative;display:flex;align-items:flex-end;gap:6px;height:110px;padding-top:6px}
      .nu-col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;cursor:pointer;background:none;border:none;color:inherit;font:inherit;padding:0}
      .nu-col .nu-cbar{width:100%;max-width:34px;border-radius:5px 5px 2px 2px;min-height:2px}
      .nu-col .nu-d{font-size:.68rem;color:var(--pub-fg2,#a6adc8)}
      .nu-col.sel .nu-d{color:var(--pub-fg,#cdd6f4);font-weight:700}
      .nu-plot{position:relative;flex:1;display:flex;align-items:flex-end;gap:6px;height:100%}
      .nu-line{position:absolute;left:0;right:0;border-top:1px dashed var(--pub-fg2,#a6adc8);opacity:.45;pointer-events:none}
      .nu-other{display:flex;flex-direction:column;gap:6px}
      .nu-top{display:flex;align-items:center;gap:8px}
      .nu-top .nu-title{flex:1;font-weight:600;font-size:1rem}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="nu-widget"></div>';
    const w = root.firstChild;
    if (!token) {
      w.innerHTML = `<div class="nu-login">${esc(t('nu_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    const st = {
      tab: 'today', view: 'main', details: false, today: ymd(new Date()), day: ymd(new Date()), dayEnd: 0, ready: false, error: '', notice: '',
      settings: null, restrictions: [], entries: [], other: null, hist: [], totals: null, warnings: {}, goals: null, openEntry: null,
      add: null, form: null, recipe: null, myFoods: null, goalForm: null, goalMsg: '', calcMsg: '',
      health: { loaded: false, enabled: false, available: false, msg: '' },
      rewardOffered: false, reward: { enabled: false, amount: 0, to_categories: [], from_category: '' },
      cats: { loaded: false, available: false, categories: [], currency: null }, rewardMsg: '',
      scan: null, meals: [], mealForm: null,
    };
    let mealPicker = null;
    // Meals are the person's own: renamed, re-timed, added or removed in Settings.
    function mealLabel(m) { return m.name || t('nu_meal_' + m.id); }
    function mealById(id) { return st.meals.find(m => m.id === id) || null; }
    function mealName(id) { const m = mealById(id); return m ? mealLabel(m) : t('nu_meal_other'); }
    function clock(v) {
      const P = window.mvmOS && window.mvmOS.dateTimePicker;
      return (P && P.format(v, { type: 'time' })) || v;
    }
    function defaultMealId() {
      const now = pad2(new Date().getHours()) + ':' + pad2(new Date().getMinutes());
      const passed = st.meals.filter(m => m.time && m.time <= now);
      return (passed.length ? passed[passed.length - 1] : st.meals[0] || { id: '' }).id;
    }
    const mealOptions = cur => st.meals.map(m => `<option value="${esc(m.id)}"${cur === m.id ? ' selected' : ''}>${esc(m.icon + ' ' + mealLabel(m))}</option>`).join('')
      + (cur && !mealById(cur) ? `<option value="${esc(cur)}" selected>${esc(t('nu_meal_other'))}</option>` : '');
    let searchTimer = null;
    let stream = null, scanTimer = null;

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        if (r.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(data.error || ('http_' + r.status)); e.status = r.status; throw e; }
        return data;
      });
    }
    const lang = () => window.mvmOS?.lang || 'en';

    function foodName(f) { if (f.kind !== 'ready') return f.name; const k = 'nu_f_' + f.id, v = t(k); return v && v !== k ? v : f.name; }
    function unitOf(u) { return u === 'ml' ? 'ml' : 'g'; }
    function fmtAmt(a, u) { return rnd(a, 1) + ' ' + unitOf(u); }
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
    const per = (f, amount) => { const o = {}; NUT.forEach(k => { o[k] = (f[k] || 0) * amount / 100; }); return o; };

    function warnText(h) {
      const who = h.key ? t('nu_al_' + h.key) : h.label;
      return t('nu_warn_' + h.type, { x: who });
    }
    function problemText(wn) {
      if (wn.type === 'allergy' || wn.type === 'intolerance' || wn.type === 'avoid')
        return t('nu_warn_' + wn.type, { x: wn.key ? t('nu_al_' + wn.key) : wn.label });
      return t('nu_warn_' + wn.type, { x: rnd(wn.over != null ? wn.over : wn.per_100, 1) });
    }

    // ── Today ────────────────────────────────────────────────────
    async function loadDay() {
      const d = await api('/day?day=' + encodeURIComponent(st.day));
      st.entries = d.entries; st.totals = d.totals; st.warnings = d.warnings || {}; st.goals = d.goals; st.other = d.other || null;
      loadHist();
    }
    async function loadHist() {
      try { st.hist = (await api('/history?end=' + encodeURIComponent(st.today) + '&days=7')).days; } catch (e) { st.hist = st.hist || []; }
      if (st.view === 'main' && st.tab === 'today') render(true);
    }
    async function refresh() {
      try { await loadDay(); st.error = ''; } catch (e) { st.error = t('nu_error'); }
      render();
    }

    // The day as two rings: the outer one is the energy against the goal,
    // the inner one splits the energy between protein, carbohydrates and fat.
    function arc(r, wd, color, len, start, C) {
      if (len <= 0) return '';
      return `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${color}" stroke-width="${wd}" stroke-linecap="butt"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}"/>`;
    }
    // The energy of the day as a ring: the outer one is the energy against the goal
    // (red under the lowest figure, green inside the range, red above it), the inner
    // one splits the energy between protein, carbohydrates and fat. A tap opens details.
    function ringData() {
      const tot = st.totals || {}, g = st.goals || {};
      const kcal = tot.kcal || 0, lo = g.cal_min || 0, hi = g.cal_max || 0;
      const parts = [['protein', '#43a047', (tot.protein || 0) * 4], ['carbs', '#f2b705', (tot.carbs || 0) * 4], ['fat', '#ff7043', (tot.fat || 0) * 9]].filter(p => p[2] > 0);
      return { tot, kcal, lo, hi, parts, sum: parts.reduce((a, p) => a + p[2], 0) };
    }
    function calorieCard() {
      const { kcal, lo, hi, parts, sum } = ringData();
      const R = 86, W = 18, R2 = 71, W2 = 10, C = 2 * Math.PI * R, C2 = 2 * Math.PI * R2;
      const color = kcal > hi ? 'var(--pub-red,#f38ba8)' : kcal >= lo ? 'var(--pub-green,#a6e3a1)' : 'var(--pub-red,#f38ba8)';
      const outer = hi ? arc(R, W, color, Math.min(kcal / hi, 1) * C, 0, C) : '';
      let inner = '', pos = 0;
      const gap = parts.length > 1 ? 1.2 : 0;
      parts.forEach(p => { const len = p[2] / sum * C2; inner += arc(R2, W2, p[1], len - gap, pos, C2); pos += len; });
      const done = hi && kcal >= hi;
      const txt = hi
        ? `<span class="nu-ring-pct">${Math.round(kcal / hi * 100)}%</span><span class="nu-ring-sub">${rnd(kcal)} / ${rnd(hi)} kcal</span>
          <span class="nu-ring-left${done ? ' done' : ''}">${esc(done ? '✓ ' + t('nu_goal_done') : t('nu_left', { v: rnd(hi - kcal) }))}</span>`
        : `<span class="nu-ring-pct">${rnd(kcal)}</span><span class="nu-ring-sub">kcal</span>`;
      return `<div class="nu-ringwrap"><button class="nu-ring" data-act="details" title="${esc(t('nu_ring_title'))}" aria-label="${esc(t('nu_ring_title'))}">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="nu-ring-track" cx="100" cy="100" r="${R}" fill="none" stroke-width="${W}"/>
          <circle class="nu-ring-track" cx="100" cy="100" r="${R2}" fill="none" stroke-width="${W2}" opacity=".6"/>
          ${outer}${inner}</svg>
        <span class="nu-ring-txt">${txt}</span></button></div>`;
    }
    // Everything the ring sums up.
    function detailsDialog() {
      const { kcal, lo, hi, parts, sum } = ringData();
      let status = '';
      if (hi) status = kcal < lo ? t('nu_below', { v: rnd(lo - kcal) }) : kcal <= hi ? t('nu_within') : t('nu_above', { v: rnd(kcal - hi) });
      const split = parts.map(p => `<span><i style="background:${p[1]}"></i>${esc(t('nu_n_' + p[0]))} ${Math.round(p[2] / sum * 100)}%</span>`).join('');
      return `<div class="nu-overlay" data-act="details-close"><div class="nu-dialog">
        <h3>${st.day === st.today ? esc(t('nu_today')) + ' · ' : ''}${esc(fmtDate(st.day))}</h3>
        <div class="nu-hint">${esc(hi ? t('nu_range', { lo: rnd(lo), hi: rnd(hi) }) : t('nu_no_goal'))}</div>
        ${hi ? `<div class="nu-hint"><b>${esc(t('nu_pct_goal', { p: Math.round(kcal / hi * 100) }))}</b> · ${esc(status)}</div>` : ''}
        ${split ? `<div class="nu-legend">${split}</div>` : ''}
        ${macroCard()}
        <div class="nu-fields"><button class="nu-btn main" data-act="details-close">${esc(t('nu_close'))}</button></div></div></div>`;
    }
    function macroCard() {
      const tot = st.totals || {}, g = st.goals || {};
      const rows = ROWS.filter(([k]) => (tot[k] || 0) > 0).map(([k, color, gk, mode]) => {
        const v = tot[k] || 0, goal = gk ? (g[gk] || 0) : 0;
        const pct = goal ? Math.min(100, v / goal * 100) : 0;
        const over = goal && mode === 'max' && v > goal;
        const goalTxt = goal ? ` / ${rnd(goal)} g` : '';
        return `<div><div class="nu-row"><span class="nu-n">${esc(t('nu_n_' + k))}</span>
          <b${over ? ' class="nu-warn"' : ''}>${k === 'water' ? esc(rnd(v) + ' ml') : rnd(v, nutDec(k)) + ' g' + goalTxt}</b></div>
          ${goal ? `<div class="nu-mini"><i style="width:${pct}%;background:${over ? 'var(--pub-red,#f38ba8)' : color}"></i></div>` : ''}</div>`;
      }).join('');
      return rows ? `<div class="nu-card">${rows}</div>` : '';
    }
    // What other apps sent Health for the day (when the person asked for it), by app.
    function otherCard() {
      const o = st.other;
      if (!o || !o.sources || !o.sources.length) return '';
      const rows = o.sources.map(s => {
        const parts = NUT.filter(k => (s[k] || 0) > 0).map(k => k === 'kcal' ? rnd(s[k]) + ' kcal' : k === 'water' ? rnd(s[k]) + ' ml ' + t('nu_n_water').toLowerCase()
          : t('nu_n_' + k).toLowerCase() + ' ' + rnd(s[k], nutDec(k)) + ' g');
        return `<div><div class="nu-name">${esc(s.name)}</div><div class="nu-hint">${esc(parts.join(' · '))}</div></div>`;
      }).join('');
      return `<div class="nu-card nu-other"><div class="nu-h">${esc(t('nu_other_title'))}</div>${rows}</div>`;
    }
    // The last seven days of energy against the range; a tap opens that day.
    function weekChart() {
      const h = st.hist || [], g = st.goals || {};
      if (!h.length || !h.some(d => d.kcal > 0)) return '';
      const hi = g.cal_max || 0;
      const max = Math.max(hi, ...h.map(d => d.kcal), 1) * 1.08;
      const bars = h.map(d => {
        const c = hi && d.kcal > hi ? 'var(--pub-red,#f38ba8)' : hi && d.kcal >= hi ? 'var(--pub-green,#a6e3a1)' : 'var(--pub-accent,#89b4fa)';
        const [y, m, dd] = d.day.split('-').map(Number);
        const wd = new Date(y, m - 1, dd).toLocaleDateString(lang(), { weekday: 'short' });
        return `<button class="nu-col${d.day === st.day ? ' sel' : ''}" data-act="goday" data-day="${d.day}" title="${esc(fmtDate(d.day) + ' · ' + rnd(d.kcal) + ' kcal')}">
          <i class="nu-cbar" style="height:${(d.kcal / max * 100).toFixed(1)}%;background:${c}"></i><span class="nu-d">${esc(wd)}</span></button>`;
      }).join('');
      const lines = hi ? `<div class="nu-line" style="bottom:calc(${(hi / max * 100).toFixed(1)}% * .86 + 18px)"></div>` : '';
      return `<div class="nu-card"><div class="nu-h">${esc(t('nu_chart_title'))}</div><div class="nu-chart">${lines}${bars}</div></div>`;
    }
    function entryRow(e) {
      const wn = st.warnings[e.id];
      return `<div class="nu-entry" data-act="open-entry" data-id="${esc(e.id)}">
        <div class="nu-main"><div class="nu-name">${wn ? '<span class="nu-warn">⚠ </span>' : ''}${esc(e.name)}</div>
        <div class="nu-sub">${esc(fmtAmt(e.amount, e.unit))}</div></div><b>${rnd(e.kcal)} kcal</b></div>
        ${st.openEntry === e.id ? entryEditor(e, wn) : ''}`;
    }
    function entryEditor(e, wn) {
      return `<div class="nu-card">
        ${wn ? `<div class="nu-verdict caution"><b>${esc(t('nu_conflicts'))}</b>${wn.map(h => `<div>${esc(warnText(h))}</div>`).join('')}</div>` : ''}
        <div class="nu-fields">
          <div class="nu-field"><label>${esc(t('nu_amount'))} (${unitOf(e.unit)})</label><input class="nu-input" id="nu-e-amount" type="number" min="0" step="any" value="${esc(rnd(e.amount, 1))}"></div>
          <div class="nu-field"><label>${esc(t('nu_meal'))}</label><select class="nu-input" id="nu-e-meal">${mealOptions(e.meal)}</select></div>
        </div>
        <div class="nu-hint">${nutShow(e).map(k => esc(t('nu_n_' + k)) + ' ' + rnd(e[k], nutDec(k))).join(' · ')}</div>
        <div class="nu-fields"><button class="nu-btn main" data-act="save-entry" data-id="${esc(e.id)}">${esc(t('nu_save'))}</button>
        <button class="nu-btn danger" data-act="del-entry" data-id="${esc(e.id)}">${esc(t('nu_delete'))}</button></div></div>`;
    }
    function todayView() {
      const known = new Set(st.meals.map(m => m.id));
      const other = st.entries.filter(e => !known.has(e.meal));
      const group = (m, list) => {
        const sum = list.reduce((s, e) => s + e.kcal, 0);
        return `<div class="nu-meal"><div class="nu-mealhead"><span>${esc(m ? m.icon : '🍽️')}</span><span class="nu-title">${esc(m ? mealLabel(m) : t('nu_meal_other'))}${m && m.time ? ` <span class="nu-hint">${esc(clock(m.time))}</span>` : ''}</span>
          <span class="nu-hint">${list.length ? rnd(sum) + ' kcal' : ''}</span>
          ${m ? `<button class="nu-btn" data-act="add" data-meal="${esc(m.id)}">＋ ${esc(t('nu_add'))}</button>` : ''}</div>
          ${list.map(entryRow).join('')}</div>`;
      };
      const meals = st.meals.map(m => group(m, st.entries.filter(e => e.meal === m.id))).join('') + (other.length ? group(null, other) : '');
      const bad = Object.keys(st.warnings).length;
      return `
        <div class="nu-days"><button class="nu-btn" data-act="prev">‹</button>
          <div class="nu-daylabel">${st.day === st.today ? esc(t('nu_today')) + ' · ' : ''}${esc(fmtDate(st.day))}</div>
          <button class="nu-btn" data-act="next"${st.day >= st.today ? ' disabled' : ''}>›</button></div>
        ${st.notice ? `<div class="nu-card nu-ok">${esc(st.notice)}</div>` : ''}
        ${calorieCard()}
        ${bad ? `<div class="nu-verdict caution"><b>⚠ ${esc(t('nu_day_conflicts', { n: bad }))}</b></div>` : ''}
        ${otherCard()}${weekChart()}${meals}`;
    }

    // ── Add food ─────────────────────────────────────────────────
    function openAdd(meal) {
      st.add = { meal: meal || defaultMealId(), forMeal: false, q: '', foods: [], recent: true, online: [], onlineMsg: '', pick: null, amount: '', check: null, busy: false, msg: '' };
      st.view = 'add'; render(); runSearch();
    }
    async function runSearch() {
      const a = st.add; if (!a) return;
      try {
        const d = await api('/search?q=' + encodeURIComponent(a.q) + '&lang=' + encodeURIComponent(lang()) + '&meal=' + encodeURIComponent(a.meal));
        if (st.add !== a) return;
        a.foods = d.foods; a.recent = !!d.recent; a.forMeal = !!d.for_meal;
      } catch (e) {}
      if (st.add === a && !a.pick) render(true);
    }
    async function searchOnline() {
      const a = st.add; if (!a || a.q.trim().length < 2) return;
      a.onlineMsg = '…'; a.online = []; render(true);
      try { const d = await api('/online?q=' + encodeURIComponent(a.q.trim())); a.online = d.foods; a.onlineMsg = d.foods.length ? '' : t('nu_none_found'); }
      catch (e) { a.onlineMsg = t('nu_offline'); }
      if (st.add === a) render(true);
    }
    async function lookupBarcode(code) {
      const a = st.add; if (!a) return;
      a.msg = '…'; render(true);
      try { const f = await api('/barcode/' + encodeURIComponent(code) + '?lang=' + encodeURIComponent(lang())); a.msg = ''; pickFood(f); }
      catch (e) { a.msg = t(e.message === 'not_found' ? 'nu_barcode_unknown' : e.message === 'offline' ? 'nu_offline' : 'nu_barcode_invalid'); render(true); }
    }
    function pickFood(f) {
      const a = st.add; a.pick = f; a.check = null;
      a.amount = String(rnd(f.last_amount || (f.portions && f.portions[0]) || f.portion || 100, 1));
      render(); runCheck();
    }
    async function runCheck() {
      const a = st.add; if (!a || !a.pick) return;
      const amt = Number(a.amount);
      if (!(amt > 0)) { a.check = null; render(true); return; }
      const f = a.pick;
      const body = { amount: amt, day: st.day, lang: lang() };
      if (f.ref) body.ref = f.ref; else body.food = foodBody(f);
      try { const c = await api('/check', { method: 'POST', body: JSON.stringify(body) }); if (st.add && st.add.pick === f) { a.check = c; render(true); } } catch (e) {}
    }
    function foodBody(f) {
      const o = { name: f.name, unit: f.unit, allergens: f.allergens || [], ingredients: f.ingredients || '', barcode: f.barcode || null, brand: f.brand || null };
      NUT.forEach(k => { o[k] = f[k] || 0; });
      return o;
    }
    async function confirmAdd() {
      const a = st.add; if (!a || !a.pick || a.busy) return;
      const amt = Number(a.amount);
      if (!(amt > 0)) return;
      a.busy = true;
      try {
        const body = { day: st.day, amount: amt, meal: a.meal, lang: lang() };
        if (a.pick.ref) body.ref = a.pick.ref;
        else {
          const kept = await api('/remember', { method: 'POST', body: JSON.stringify(foodBody(a.pick)) });
          body.ref = kept.ref;
        }
        await api('/entries', { method: 'POST', body: JSON.stringify(body) });
        st.add = null; st.view = 'main'; st.tab = 'today'; st.myFoods = null;
        await loadDay(); st.error = '';
      } catch (e) { a.busy = false; a.msg = t('nu_error'); }
      render();
    }
    function foodLine(f, act, i) {
      const sub = (f.brand ? f.brand + ' · ' : '') + rnd(f.kcal) + ' kcal / 100 ' + unitOf(f.unit);
      return `<button class="nu-food" data-act="${act}" data-i="${i}"><span class="nu-ico">${esc(f.icon || '🍽️')}</span>
        <span style="flex:1;min-width:0"><div>${esc(foodName(f))}</div><div class="nu-sub nu-hint">${esc(sub)}</div></span></button>`;
    }
    function verdictBox(c) {
      if (!c) return '';
      const ttl = t('nu_verdict_' + c.verdict);
      const list = c.warnings.map(wn => `<div>• ${esc(problemText(wn))}</div>`).join('');
      return `<div class="nu-verdict ${esc(c.verdict)}"><b>${c.verdict === 'ok' ? '✅' : c.verdict === 'avoid' ? '⛔' : '⚠️'} ${esc(ttl)}</b>${list}
        ${c.goals && c.goals.cal_max ? `<div class="nu-hint">${esc(t('nu_after', { v: rnd(c.day_before.kcal + c.this.kcal), hi: rnd(c.goals.cal_max) }))}</div>` : ''}</div>`;
    }
    function pickView() {
      const a = st.add, f = a.pick, amt = Number(a.amount) || 0, v = per(f, amt);
      const portions = (f.portions || []).concat([50, 100, 200]).filter((x, i, arr) => x && arr.indexOf(x) === i);
      return `<div class="nu-top"><button class="nu-btn" data-act="pick-back">‹</button><div class="nu-title">${esc(foodName(f))}</div></div>
        <div class="nu-card">
          <div class="nu-hint">${nutShow(f).map(k => esc(t('nu_n_' + k)) + ' ' + rnd(f[k], nutDec(k))).join(' · ')} — ${esc(t('nu_per100', { u: unitOf(f.unit) }))}</div>
          <div class="nu-fields">
            <div class="nu-field"><label>${esc(t('nu_amount'))} (${unitOf(f.unit)})</label><input class="nu-input" id="nu-amount" type="number" min="0" step="any" value="${esc(a.amount)}"></div>
            <div class="nu-field"><label>${esc(t('nu_meal'))}</label><select class="nu-input" id="nu-meal">${mealOptions(a.meal)}</select></div>
          </div>
          ${f.ref ? '' : `<div class="nu-field"><label>${esc(t('nu_n_water'))} (${unitOf(f.unit)} / 100)</label><input class="nu-input" id="nu-water" type="number" min="0" max="100" step="any" value="${esc(f.water || '')}"><div class="nu-hint">${esc(t('nu_water_note'))}</div></div>`}
          <div class="nu-chips">${portions.map(p => `<button class="nu-chip" data-act="portion" data-v="${p}">${p} ${unitOf(f.unit)}</button>`).join('')}</div>
          <div class="nu-big"><b>${rnd(v.kcal)}</b><span>kcal</span></div>
          <div class="nu-hint">${nutShow(v).slice(1).map(k => esc(t('nu_n_' + k)) + ' ' + rnd(v[k], nutDec(k)) + ' g').join(' · ')}</div>
        </div>
        ${verdictBox(a.check)}
        ${a.msg ? `<div class="nu-err">${esc(a.msg)}</div>` : ''}
        <button class="nu-btn main" data-act="confirm-add"${a.busy || !(amt > 0) ? ' disabled' : ''}>${esc(t('nu_add_to', { m: mealName(a.meal) }))}</button>`;
    }
    function addView() {
      const a = st.add;
      if (a.pick) return pickView();
      const list = a.foods.map((f, i) => foodLine(f, 'pick', i)).join('');
      const online = a.online.map((f, i) => foodLine(f, 'pick-online', i)).join('');
      return `<div class="nu-top"><button class="nu-btn" data-act="add-back">‹</button><div class="nu-title">${esc(t('nu_add_food'))}</div></div>
        <div class="nu-chips">${st.meals.map(m => `<button class="nu-chip${a.meal === m.id ? ' sel' : ''}" data-act="set-meal" data-m="${esc(m.id)}">${esc(m.icon)} ${esc(mealLabel(m))}</button>`).join('')}</div>
        <div class="nu-fields" style="flex-wrap:nowrap"><input class="nu-input" id="nu-q" type="search" placeholder="${esc(t('nu_search_ph'))}" value="${esc(a.q)}" autocomplete="off">
          <button class="nu-btn" data-act="scan" title="${esc(t('nu_scan'))}">📷</button></div>
        <div class="nu-fields" style="flex-wrap:nowrap"><input class="nu-input" id="nu-code" inputmode="numeric" placeholder="${esc(t('nu_code_ph'))}"><button class="nu-btn" data-act="code-go">${esc(t('nu_find'))}</button></div>
        ${a.msg ? `<div class="nu-hint">${esc(a.msg)}</div>` : ''}
        <div class="nu-h">${esc(a.recent ? (a.forMeal ? t('nu_recent_meal', { m: mealName(a.meal) }) : t('nu_recent')) : t('nu_results'))}</div>
        ${list || `<div class="nu-hint">${esc(a.recent ? t('nu_recent_empty') : t('nu_none_found'))}</div>`}
        ${a.q.trim().length >= 2 ? `<button class="nu-btn" data-act="online">🌐 ${esc(t('nu_search_online'))}</button>` : ''}
        ${a.onlineMsg ? `<div class="nu-hint">${esc(a.onlineMsg)}</div>` : ''}${online}
        <button class="nu-btn" data-act="new-food-from-add">＋ ${esc(t('nu_new_food'))}</button>`;
    }

    // ── Barcode scanner ──────────────────────────────────────────
    function stopScan() {
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      if (stream) { stream.getTracks().forEach(tr => tr.stop()); stream = null; }
      st.scan = null;
    }
    async function startScan() {
      st.scan = { msg: '' };
      render(true);
      if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) { st.scan.msg = t('nu_scan_unsupported'); render(true); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch (e) { st.scan.msg = t('nu_scan_denied'); render(true); return; }
      const video = w.querySelector('#nu-video');
      if (!video) { stopScan(); return; }
      video.srcObject = stream; await video.play().catch(() => {});
      const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      scanTimer = setInterval(async () => {
        try {
          const r = await det.detect(video);
          if (r && r[0] && r[0].rawValue) { const code = r[0].rawValue; stopScan(); render(true); lookupBarcode(code); }
        } catch (e) {}
      }, 300);
    }
    function scanOverlay() {
      if (!st.scan) return '';
      return `<div class="nu-scan"><video id="nu-video" playsinline muted></video>
        <div class="nu-hint">${esc(st.scan.msg || t('nu_scan_hint'))}</div>
        <button class="nu-btn" data-act="scan-close">${esc(t('nu_close'))}</button></div>`;
    }

    // ── My foods and recipes ─────────────────────────────────────
    async function loadMyFoods() {
      try { st.myFoods = (await api('/foods')).foods; } catch (e) { st.myFoods = []; }
      if (st.tab === 'foods' && st.view === 'main') render();
    }
    function blankForm(f) {
      f = f || {};
      return { id: f.id || null, name: f.name || '', unit: f.unit || 'g', allergens: (f.allergens || []).slice(), ingredients: f.ingredients || '',
        barcode: f.barcode || '', portion: f.portion || '', kcal: f.kcal || '', protein: f.protein || '', carbs: f.carbs || '', sugar: f.sugar || '',
        fat: f.fat || '', sat_fat: f.sat_fat || '', fiber: f.fiber || '', salt: f.salt || '', water: f.water || '', msg: '', back: 'foods' };
    }
    function foodForm() {
      const f = st.form;
      const num = k => `<div class="nu-field"><label>${esc(t('nu_n_' + k))}${k === 'kcal' ? '' : ' (g)'}</label><input class="nu-input" data-f="${k}" type="number" min="0" step="any" value="${esc(f[k])}"></div>`;
      return `<div class="nu-top"><button class="nu-btn" data-act="form-back">‹</button><div class="nu-title">${esc(f.id ? t('nu_edit_food') : t('nu_new_food'))}</div></div>
        <div class="nu-card">
          <div class="nu-fields"><div class="nu-field" style="flex:3 1 160px"><label>${esc(t('nu_name'))}</label><input class="nu-input" data-f="name" value="${esc(f.name)}" maxlength="80"></div>
          <div class="nu-field"><label>${esc(t('nu_unit'))}</label><select class="nu-input" data-f="unit"><option value="g"${f.unit === 'g' ? ' selected' : ''}>${esc(t('nu_unit_g'))}</option><option value="ml"${f.unit === 'ml' ? ' selected' : ''}>${esc(t('nu_unit_ml'))}</option></select></div></div>
          <div class="nu-hint">${esc(t('nu_per100', { u: unitOf(f.unit) }))}</div>
          <div class="nu-fields">${['kcal', 'protein', 'carbs', 'sugar'].map(num).join('')}</div>
          <div class="nu-fields">${['fat', 'sat_fat', 'fiber', 'salt', 'water'].map(num).join('')}</div>
          <div class="nu-hint">${esc(t('nu_water_note'))}</div>
          <div class="nu-fields"><div class="nu-field"><label>${esc(t('nu_portion'))} (${unitOf(f.unit)})</label><input class="nu-input" data-f="portion" type="number" min="0" step="any" value="${esc(f.portion)}"></div>
          <div class="nu-field"><label>${esc(t('nu_barcode'))}</label><input class="nu-input" data-f="barcode" inputmode="numeric" value="${esc(f.barcode)}"></div></div>
          <div class="nu-field"><label>${esc(t('nu_contains'))}</label><div class="nu-chips">${ALLERGENS.map(a => `<button class="nu-chip${f.allergens.includes(a) ? ' sel' : ''}" data-act="form-allergen" data-a="${a}">${esc(t('nu_al_' + a))}</button>`).join('')}</div></div>
          <div class="nu-field"><label>${esc(t('nu_ingredients'))}</label><textarea class="nu-input" data-f="ingredients">${esc(f.ingredients)}</textarea></div>
          ${f.msg ? `<div class="nu-err">${esc(f.msg)}</div>` : ''}
          <button class="nu-btn main" data-act="form-save">${esc(t('nu_save'))}</button></div>`;
    }
    async function saveForm() {
      const f = st.form;
      const body = { name: f.name, unit: f.unit, allergens: f.allergens, ingredients: f.ingredients, barcode: f.barcode || null, portion: Number(f.portion) || null };
      NUT.forEach(k => { body[k] = Number(f[k]) || 0; });
      if (!f.name.trim()) { f.msg = t('nu_name_needed'); render(true); return; }
      try {
        const saved = f.id ? await api('/foods/' + encodeURIComponent(f.id), { method: 'PUT', body: JSON.stringify(body) })
          : await api('/foods', { method: 'POST', body: JSON.stringify(body) });
        const back = f.back; st.form = null; st.myFoods = null; st.view = back === 'add' ? 'add' : 'main'; st.tab = back === 'add' ? st.tab : 'foods';
        if (back === 'add' && st.add) pickFood(saved); else { render(); loadMyFoods(); }
      } catch (e) { f.msg = t('nu_error'); render(true); }
    }

    function recipeView() {
      const r = st.recipe;
      const sums = {}; NUT.forEach(k => { sums[k] = 0; });
      let weight = 0;
      r.items.forEach(it => { weight += it.amount; NUT.forEach(k => { sums[k] += (it.food[k] || 0) * it.amount / 100; }); });
      const total = Number(r.total) > 0 ? Number(r.total) : weight;
      const portions = Math.max(1, Number(r.portions) || 1);
      const p100 = k => total ? sums[k] / total * 100 : 0;
      const results = r.q.trim() ? r.results.map((f, i) => foodLine(f, 'rec-pick', i)).join('') : '';
      return `<div class="nu-top"><button class="nu-btn" data-act="form-back">‹</button><div class="nu-title">${esc(t('nu_new_recipe'))}</div></div>
        <div class="nu-card">
          <div class="nu-field"><label>${esc(t('nu_name'))}</label><input class="nu-input" data-r="name" value="${esc(r.name)}" maxlength="80"></div>
          <div class="nu-fields"><div class="nu-field"><label>${esc(t('nu_portions'))}</label><input class="nu-input" data-r="portions" type="number" min="1" step="1" value="${esc(r.portions)}"></div>
          <div class="nu-field"><label>${esc(t('nu_total_weight'))} (g)</label><input class="nu-input" data-r="total" type="number" min="0" step="any" placeholder="${rnd(weight)}" value="${esc(r.total)}"></div></div>
          <div class="nu-hint">${esc(t('nu_total_hint'))}</div>
          <div class="nu-h">${esc(t('nu_ingredients'))}</div>
          ${r.items.map((it, i) => `<div class="nu-ing"><span class="nu-name">${esc(foodName(it.food))}</span>
            <input class="nu-input" data-ri="${i}" type="number" min="0" step="any" value="${esc(it.amount)}"><span class="nu-hint">${unitOf(it.food.unit)}</span>
            <button class="nu-btn danger" data-act="rec-del" data-i="${i}">✕</button></div>`).join('') || `<div class="nu-hint">${esc(t('nu_no_ingredients'))}</div>`}
          <input class="nu-input" id="nu-rq" type="search" placeholder="${esc(t('nu_add_ingredient'))}" value="${esc(r.q)}" autocomplete="off">
          ${results}
          <div class="nu-card" style="background:var(--pub-bg,#1e1e2e)"><div class="nu-hint">${esc(t('nu_recipe_result'))}</div>
            <div class="nu-big"><b>${rnd(sums.kcal / portions)}</b><span>kcal / ${esc(t('nu_portion_word'))} (${rnd(total / portions)} g)</span></div>
            <div class="nu-hint">${NUT.filter(k => k === 'kcal' || p100(k) > 0).map(k => esc(t('nu_n_' + k)) + ' ' + rnd(p100(k), nutDec(k))).join(' · ')} — ${esc(t('nu_per100', { u: 'g' }))}</div></div>
          ${r.msg ? `<div class="nu-err">${esc(r.msg)}</div>` : ''}
          <button class="nu-btn main" data-act="rec-save">${esc(t('nu_save'))}</button></div>`;
    }
    async function recipeSearch() {
      const r = st.recipe; if (!r) return;
      try { const d = await api('/search?q=' + encodeURIComponent(r.q) + '&lang=' + encodeURIComponent(lang())); if (st.recipe === r) { r.results = d.foods.filter(f => f.kind !== 'recipe'); render(true); } } catch (e) {}
    }
    async function saveRecipe() {
      const r = st.recipe;
      if (!r.name.trim() || !r.items.length) { r.msg = t('nu_recipe_needed'); render(true); return; }
      try {
        await api('/recipes', { method: 'POST', body: JSON.stringify({ name: r.name, portions: Number(r.portions) || 1, total_g: Number(r.total) > 0 ? Number(r.total) : null,
          items: r.items.map(it => ({ food: it.food.ref, amount: it.amount })), lang: lang() }) });
        st.recipe = null; st.view = 'main'; st.tab = 'foods'; st.myFoods = null; render(); loadMyFoods();
      } catch (e) { r.msg = t('nu_error'); render(true); }
    }
    function foodsView() {
      if (st.myFoods == null) return `<div class="nu-hint">…</div>`;
      const list = st.myFoods.map((f, i) => `<div class="nu-entry" data-act="edit-food" data-i="${i}"><span class="nu-ico">${f.kind === 'recipe' ? '🍲' : '🍴'}</span>
        <div class="nu-main"><div class="nu-name">${esc(f.name)}</div><div class="nu-sub">${rnd(f.kcal)} kcal / 100 ${unitOf(f.unit)}${f.kind === 'recipe' && f.portion ? ' · ' + esc(t('nu_portion_is', { v: rnd(f.portion) })) : ''}</div></div>
        <button class="nu-btn danger" data-act="del-food" data-i="${i}">✕</button></div>`).join('');
      return `<div class="nu-fields"><button class="nu-btn main" data-act="new-food">＋ ${esc(t('nu_new_food'))}</button><button class="nu-btn main" data-act="new-recipe">＋ ${esc(t('nu_new_recipe'))}</button></div>
        <div class="nu-hint">${esc(t('nu_foods_hint'))}</div>${list || `<div class="nu-hint">${esc(t('nu_foods_empty'))}</div>`}`;
    }

    // ── Goals ────────────────────────────────────────────────────
    function goalDraft() {
      const s = st.settings;
      return { goal_type: s.goal_type, cal_min: s.cal_min || '', cal_max: s.cal_max || '', protein_min: s.protein_min || '', carbs_max: s.carbs_max || '',
        sugar_max: s.sugar_max || '', fiber_min: s.fiber_min || '', salt_max: s.salt_max || '', sex: s.sex || 'm', age: s.age || '', height_cm: s.height_cm || '',
        weight_kg: s.weight_kg || '', target_weight_kg: s.target_weight_kg || '', activity: s.activity || 1.375 };
    }
    function goalsView() {
      const g = st.goalForm || (st.goalForm = goalDraft());
      // With the body data taken from Health the four values are Health's and read-only here.
      const locked = !!(st.settings.health_read && st.settings.health_ok);
      const inp = (k, lab, unit, lock) => `<div class="nu-field"><label>${esc(lab)}${unit ? ' (' + unit + ')' : ''}</label><input class="nu-input" data-g="${k}" type="number" min="0" step="any" value="${esc(g[k])}"${lock && locked ? ' disabled' : ''}></div>`;
      const missing = locked && (!st.settings.sex || !st.settings.age || !st.settings.height_cm || !st.settings.weight_kg);
      const restr = st.restrictions.map(r => `<div class="nu-entry" style="cursor:default"><div class="nu-main"><div class="nu-name">${esc(r.key ? t('nu_al_' + r.key) : r.label)}</div>
        <div class="nu-sub">${esc(t('nu_kind_' + r.kind))}</div></div><button class="nu-btn danger" data-act="del-restr" data-id="${esc(r.id)}">✕</button></div>`).join('');
      return `<div class="nu-h">${esc(t('nu_goal_title'))}</div>
        <div class="nu-card"><div class="nu-chips">${GOALS.map(x => `<button class="nu-chip${g.goal_type === x ? ' sel' : ''}" data-act="goal-type" data-v="${x}">${esc(t('nu_goal_' + x))}</button>`).join('')}</div>
          <div class="nu-hint">${esc(t('nu_goal_hint_' + g.goal_type))}</div>
          <div class="nu-fields">${inp('cal_min', t('nu_cal_min'), 'kcal')}${inp('cal_max', t('nu_cal_max'), 'kcal')}</div>
          <div class="nu-hint">${esc(t('nu_range_hint'))}</div>
          <div class="nu-fields">${inp('protein_min', t('nu_protein_min'), 'g')}${inp('fiber_min', t('nu_fiber_min'), 'g')}</div>
          <div class="nu-fields">${inp('carbs_max', t('nu_carbs_max'), 'g')}${inp('sugar_max', t('nu_sugar_max'), 'g')}${inp('salt_max', t('nu_salt_max'), 'g')}</div>
          ${st.goalMsg ? `<div class="nu-hint nu-ok">${esc(st.goalMsg)}</div>` : ''}
          <button class="nu-btn main" data-act="goal-save">${esc(t('nu_save'))}</button></div>
        <details class="nu-card"${st.calcOpen ? ' open' : ''}><summary style="cursor:pointer;font-weight:600">${esc(t('nu_calc_title'))}</summary>
          <div class="nu-hint">${esc(t('nu_calc_hint'))}</div>
          <div class="nu-fields"><div class="nu-field"><label>${esc(t('nu_sex'))}</label><select class="nu-input" data-g="sex"${locked ? ' disabled' : ''}>${locked && !g.sex ? '<option value="" selected>—</option>' : ''}<option value="m"${g.sex !== 'f' && !(locked && !g.sex) ? ' selected' : ''}>${esc(t('nu_sex_m'))}</option><option value="f"${g.sex === 'f' ? ' selected' : ''}>${esc(t('nu_sex_f'))}</option></select></div>
          ${inp('age', t('nu_age'), '', true)}</div>
          <div class="nu-fields">${inp('height_cm', t('nu_height'), 'cm', true)}${inp('weight_kg', t('nu_weight'), 'kg', true)}${inp('target_weight_kg', t('nu_target_weight'), 'kg')}</div>
          ${locked ? `<div class="nu-hint">${esc(t(missing ? 'nu_from_health_missing' : 'nu_from_health'))}</div>` : ''}
          <div class="nu-field"><label>${esc(t('nu_activity'))}</label><select class="nu-input" data-g="activity">${ACTIVITY.map((a, i) => `<option value="${a}"${Number(g.activity) === a ? ' selected' : ''}>${esc(t('nu_activity_' + i))}</option>`).join('')}</select></div>
          ${st.calcMsg ? `<div class="nu-hint">${esc(st.calcMsg)}</div>` : ''}
          <button class="nu-btn" data-act="calc">${esc(t('nu_calc_btn'))}</button></details>
        <div class="nu-h">${esc(t('nu_restr_title'))}</div>
        <div class="nu-card"><div class="nu-hint">${esc(t('nu_restr_hint'))}</div>${restr}
          <div class="nu-fields"><div class="nu-field"><label>${esc(t('nu_kind'))}</label><select class="nu-input" id="nu-r-kind">${['allergy', 'intolerance', 'avoid'].map(k => `<option value="${k}">${esc(t('nu_kind_' + k))}</option>`).join('')}</select></div>
          <div class="nu-field"><label>${esc(t('nu_what'))}</label><select class="nu-input" id="nu-r-key"><option value="">${esc(t('nu_other_word'))}</option>${ALLERGENS.map(a => `<option value="${a}">${esc(t('nu_al_' + a))}</option>`).join('')}</select></div></div>
          <div class="nu-field"><label>${esc(t('nu_word'))}</label><input class="nu-input" id="nu-r-label" maxlength="60" placeholder="${esc(t('nu_word_ph'))}"></div>
          ${st.restrMsg ? `<div class="nu-err">${esc(st.restrMsg)}</div>` : ''}
          <button class="nu-btn" data-act="restr-add">＋ ${esc(t('nu_restr_add'))}</button></div>
        <div class="nu-hint">${esc(t('nu_disclaimer'))}</div>`;
    }

    // ── Settings ─────────────────────────────────────────────────
    function curLabel() { return typeof st.cats.currency === 'string' ? st.cats.currency : ''; }
    function rewardCard() {
      if (!st.rewardOffered) return '';
      const r = st.reward, cats = st.cats.categories;
      const picked = new Set(r.to_categories || []);
      const checks = cats.filter(c => !c.has_children).map(c => `<label class="nu-check"><input type="checkbox" class="nu-rw-to" value="${esc(c.id)}"${picked.has(c.id) ? ' checked' : ''}> ${esc(c.title)}</label>`).join('');
      const from = `<option value="">${esc(t('nu_reward_none'))}</option>` + cats.map(c => `<option value="${esc(c.id)}"${c.has_children ? ' disabled' : ''}${r.from_category === c.id ? ' selected' : ''}>${esc(c.title)}</option>`).join('');
      let body;
      if (!st.cats.loaded) body = `<div class="nu-hint">…</div>`;
      else if (!st.cats.available) body = `<div class="nu-hint">${esc(t('nu_reward_unavailable'))}</div>`;
      else if (!cats.length) body = `<div class="nu-hint">${esc(t('nu_reward_no_categories'))}</div>`;
      else body = `
        <label class="nu-check"><input type="checkbox" id="nu-rw-on"${r.enabled ? ' checked' : ''}> ${esc(t('nu_reward_enable'))}</label>
        <div class="nu-field"><label>${esc(t('nu_reward_amount'))}${curLabel() ? ' (' + esc(curLabel()) + ')' : ''}</label><input class="nu-input" id="nu-rw-amount" type="number" min="0" step="any" value="${r.amount ? esc(String(r.amount)) : ''}"></div>
        <div class="nu-field"><label>${esc(t('nu_reward_to'))}</label><div id="nu-rw-to">${checks}</div><div class="nu-hint">${esc(t('nu_reward_to_hint'))}</div></div>
        <div class="nu-field"><label>${esc(t('nu_reward_from'))}</label><select class="nu-input" id="nu-rw-from">${from}</select></div>
        <div class="nu-hint">${esc(t('nu_reward_from_hint'))}</div>
        ${st.rewardMsg ? `<div class="nu-hint">${esc(st.rewardMsg)}</div>` : ''}`;
      return `<div class="nu-h">${esc(t('nu_reward_title'))}</div><div class="nu-card"><div class="nu-hint">${esc(t('nu_reward_hint'))}</div>${body}</div>`;
    }
    async function saveReward() {
      const g = id => w.querySelector(id);
      const body = { enabled: g('#nu-rw-on').checked, amount: Number(g('#nu-rw-amount').value || 0),
        to_categories: Array.from(w.querySelectorAll('.nu-rw-to:checked')).map(x => x.value), from_category: g('#nu-rw-from').value || null };
      try {
        st.reward = await api('/reward', { method: 'PUT', body: JSON.stringify(body) });
        st.rewardMsg = st.reward.enabled ? t('nu_reward_saved') : t('nu_reward_off');
      } catch (er) {
        st.rewardMsg = t(er.message === 'same_category' ? 'nu_reward_same' : er.message === 'invalid_reward' ? 'nu_reward_invalid' : 'nu_error');
        st.reward = Object.assign({}, st.reward, { enabled: body.enabled, amount: body.amount, to_categories: body.to_categories, from_category: body.from_category || '' });
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

    // ── Meals (Settings) ─────────────────────────────────────────
    function mealsCard() {
      const f = st.mealForm;
      const list = st.meals.map(m => `<div class="nu-entry" style="cursor:default"><span class="nu-ico">${esc(m.icon)}</span>
        <div class="nu-main"><div class="nu-name">${esc(mealLabel(m))}</div><div class="nu-sub">${m.time ? esc(clock(m.time)) : esc(t('nu_meal_no_time'))}</div></div>
        <button class="nu-btn" data-act="meal-edit" data-id="${esc(m.id)}" title="${esc(t('nu_edit'))}">✎</button>
        <button class="nu-btn danger" data-act="meal-del" data-id="${esc(m.id)}"${st.meals.length <= 1 ? ' disabled' : ''}>✕</button></div>`).join('');
      const form = f ? `<div class="nu-card">
        <div class="nu-field"><label>${esc(t('nu_meal_name'))}</label><input class="nu-input" data-mf="name" maxlength="40" value="${esc(f.name)}" placeholder="${esc(f.id && mealById(f.id) && mealById(f.id).default ? t('nu_meal_' + f.id) : '')}"></div>
        <div class="nu-field"><label>${esc(t('nu_meal_time'))}</label><div id="nu-mf-time"></div></div>
        <div class="nu-chips">${MEAL_ICONS.map(ic => `<button class="nu-chip${f.icon === ic ? ' sel' : ''}" data-act="meal-icon" data-v="${ic}">${ic}</button>`).join('')}</div>
        ${f.msg ? `<div class="nu-err">${esc(f.msg)}</div>` : ''}
        <div class="nu-fields"><button class="nu-btn main" data-act="meal-save">${esc(t('nu_save'))}</button><button class="nu-btn" data-act="meal-cancel">${esc(t('nu_cancel'))}</button></div></div>` : '';
      return `<div class="nu-h">${esc(t('nu_meals_title'))}</div>
        <div class="nu-card"><div class="nu-hint">${esc(t('nu_meals_hint'))}</div>${list}
          ${f ? '' : (st.meals.length < 12 ? `<button class="nu-btn main" data-act="meal-new">＋ ${esc(t('nu_meal_add'))}</button>` : `<div class="nu-hint">${esc(t('nu_meal_limit'))}</div>`)}</div>${form}`;
    }
    function mountMealPicker() {
      const P = window.mvmOS && window.mvmOS.dateTimePicker, host = w.querySelector('#nu-mf-time');
      if (!P || !host || !st.mealForm) return;
      mealPicker = P.create(host, { type: 'time', required: false, label: t('nu_meal_time'), placeholder: t('nu_meal_no_time'), value: st.mealForm.time || '' });
    }
    async function saveMeal() {
      const f = st.mealForm;
      if (mealPicker) f.time = mealPicker.input.value || '';
      const body = { name: f.name.trim(), icon: f.icon, time: f.time };
      try {
        await api(f.id ? '/meals/' + encodeURIComponent(f.id) : '/meals', { method: f.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
        st.mealForm = null; await reloadMe(); await loadDay();
      } catch (e) { f.msg = t(e.message === 'invalid_name' ? 'nu_meal_name_needed' : e.message === 'too_many_meals' ? 'nu_meal_limit' : 'nu_error'); }
      render();
    }

    function settingsView() {
      const h = st.health;
      const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(x => `<option value="${x}"${st.dayEnd === x ? ' selected' : ''}>${pad2(x)}:00</option>`).join('');
      const health = !h.loaded ? `<div class="nu-hint">…</div>` : !h.available
        ? `<div class="nu-hint">${esc(t('nu_health_unavailable'))}</div>`
        : `<label class="nu-check"><input type="checkbox" id="nu-health"${h.enabled ? ' checked' : ''}> ${esc(t('nu_health_enable'))}</label>${h.msg ? `<div class="nu-hint">${esc(h.msg)}</div>` : ''}
        <label class="nu-check"><input type="checkbox" id="nu-health-read"${h.read ? ' checked' : ''}> ${esc(t('nu_health_read'))}</label><div class="nu-hint">${esc(t(h.read && st.settings.health_ok === false ? 'nu_health_read_fail' : 'nu_health_read_hint'))}</div>
        <label class="nu-check"><input type="checkbox" id="nu-health-other"${h.read_other ? ' checked' : ''}> ${esc(t('nu_health_read_other'))}</label><div class="nu-hint">${esc(t('nu_health_read_other_hint'))}</div>`;
      return `<div class="nu-top"><button class="nu-btn" data-act="settings-back">‹</button><div class="nu-title">${esc(t('nu_settings'))}</div></div>
        ${mealsCard()}
        <div class="nu-h">${esc(t('nu_dayend'))}</div>
        <div class="nu-card"><select class="nu-input" id="nu-dayend">${hours}</select><div class="nu-hint">${esc(t('nu_dayend_hint'))}</div></div>
        <div class="nu-h">${esc(t('nu_health_title'))}</div>
        <div class="nu-card"><div class="nu-hint">${esc(t('nu_health_hint'))}</div>${health}</div>
        ${rewardCard()}`;
    }

    // ── Shell ────────────────────────────────────────────────────
    function render(keepFocus) {
      if (mealPicker) { if (st.mealForm) st.mealForm.time = mealPicker.input.value || ''; mealPicker.destroy(); mealPicker = null; }
      const active = keepFocus ? document.activeElement : null;
      const aid = active && active.id && w.contains(active) ? active.id : null;
      const pos = aid && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null;
      const sc = w.querySelector('.nu-body')?.scrollTop || 0;
      let body;
      if (!st.ready) body = st.error ? `<div class="nu-err">${esc(st.error)}</div>` : '<div class="nu-hint">…</div>';
      else if (st.view === 'add') body = addView();
      else if (st.view === 'form') body = st.recipe ? recipeView() : foodForm();
      else if (st.view === 'settings') body = settingsView();
      else body = (st.tab === 'today' ? todayView() : st.tab === 'foods' ? foodsView() : goalsView());
      const main = st.view === 'main';
      const bar = main ? `<div class="nu-bar"><div class="nu-tabs">
        ${[['today', '🍽️'], ['foods', '🍲'], ['goals', '🎯']].map(([k, ic]) => `<button class="nu-btn${st.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${ic} ${esc(t('nu_tab_' + k))}</button>`).join('')}</div>
        <button class="nu-btn" data-act="settings" title="${esc(t('nu_settings'))}">⚙️</button></div>` : '';
      w.innerHTML = `${bar}<div class="nu-body">${st.error && st.ready ? `<div class="nu-err">${esc(st.error)}</div>` : ''}${body}</div>${scanOverlay()}${st.details && st.view === 'main' ? detailsDialog() : ''}`;
      const nb = w.querySelector('.nu-body'); if (nb) nb.scrollTop = sc;
      if (st.view === 'settings' && st.mealForm) mountMealPicker();
      if (aid) {
        const el = w.querySelector('#' + aid);
        if (el) { el.focus(); if (pos && el.setSelectionRange) try { el.setSelectionRange(pos[0], pos[1]); } catch (e) {} }
      }
    }

    w.addEventListener('click', async ev => {
      const el = ev.target.closest('[data-act]'); if (!el) return;
      const act = el.dataset.act;
      if (act === 'tab') {
        st.tab = el.dataset.tab; st.openEntry = null; st.notice = '';
        if (st.tab === 'foods' && st.myFoods == null) loadMyFoods();
        if (st.tab === 'goals') { st.goalForm = null; st.goalMsg = ''; }
        render();
      }
      else if (act === 'details') { st.details = true; render(); }
      else if (act === 'details-close') { if (ev.target === el) { st.details = false; render(); } }
      else if (act === 'goday') { st.day = el.dataset.day; st.openEntry = null; await refresh(); }
      else if (act === 'prev') { st.day = shiftDay(st.day, -1); st.openEntry = null; await refresh(); }
      else if (act === 'next') { if (st.day < st.today) { st.day = shiftDay(st.day, 1); st.openEntry = null; await refresh(); } }
      else if (act === 'add') openAdd(el.dataset.meal);
      else if (act === 'add-back') { stopScan(); st.add = null; st.view = 'main'; render(); }
      else if (act === 'pick-back') { st.add.pick = null; st.add.check = null; render(); }
      else if (act === 'set-meal') { st.add.meal = el.dataset.m; render(true); if (!st.add.q.trim()) runSearch(); }
      else if (act === 'pick') pickFood(st.add.foods[Number(el.dataset.i)]);
      else if (act === 'pick-online') pickFood(st.add.online[Number(el.dataset.i)]);
      else if (act === 'portion') { st.add.amount = el.dataset.v; render(); runCheck(); }
      else if (act === 'online') searchOnline();
      else if (act === 'code-go') { const c = (w.querySelector('#nu-code')?.value || '').trim(); if (c) lookupBarcode(c); }
      else if (act === 'scan') startScan();
      else if (act === 'scan-close') { stopScan(); render(true); }
      else if (act === 'confirm-add') confirmAdd();
      else if (act === 'new-food-from-add') { st.form = blankForm(); st.form.back = 'add'; st.form.name = st.add.q; st.view = 'form'; render(); }
      else if (act === 'open-entry') { st.openEntry = st.openEntry === el.dataset.id ? null : el.dataset.id; render(); }
      else if (act === 'save-entry') {
        const amount = Number(w.querySelector('#nu-e-amount').value), meal = w.querySelector('#nu-e-meal').value;
        if (!(amount > 0)) return;
        try { await api('/entries/' + encodeURIComponent(el.dataset.id), { method: 'PUT', body: JSON.stringify({ amount, meal }) }); st.openEntry = null; await loadDay(); st.error = ''; } catch (e) { st.error = t('nu_error'); }
        render();
      }
      else if (act === 'del-entry') {
        try { await api('/entries/' + encodeURIComponent(el.dataset.id), { method: 'DELETE' }); st.openEntry = null; await loadDay(); st.error = ''; } catch (e) { st.error = t('nu_error'); }
        render();
      }
      else if (act === 'new-food') { st.form = blankForm(); st.view = 'form'; render(); }
      else if (act === 'new-recipe') { st.recipe = { name: '', portions: 1, total: '', items: [], q: '', results: [], msg: '' }; st.view = 'form'; render(); }
      else if (act === 'edit-food') { if (ev.target.closest('[data-act="del-food"]')) return; const f = st.myFoods[Number(el.dataset.i)]; if (f.kind === 'recipe') return; st.form = blankForm(f); st.view = 'form'; render(); }
      else if (act === 'del-food') {
        const f = st.myFoods[Number(el.dataset.i)];
        if (!confirm(t('nu_confirm_delete', { n: f.name }))) return;
        try { await api('/foods/' + encodeURIComponent(f.id), { method: 'DELETE' }); st.myFoods = null; loadMyFoods(); } catch (e) { st.error = t('nu_error'); render(); }
      }
      else if (act === 'form-back') { st.form = null; st.recipe = null; st.view = (st.add ? 'add' : 'main'); render(); }
      else if (act === 'form-allergen') { const a = el.dataset.a, l = st.form.allergens, i = l.indexOf(a); if (i < 0) l.push(a); else l.splice(i, 1); render(true); }
      else if (act === 'form-save') saveForm();
      else if (act === 'rec-pick') { const r = st.recipe, f = r.results[Number(el.dataset.i)]; r.items.push({ food: f, amount: (f.portions && f.portions[0]) || 100 }); r.q = ''; r.results = []; render(); }
      else if (act === 'rec-del') { st.recipe.items.splice(Number(el.dataset.i), 1); render(true); }
      else if (act === 'rec-save') saveRecipe();
      else if (act === 'goal-type') {
        st.goalForm.goal_type = el.dataset.v; render(true);
      }
      else if (act === 'goal-save') {
        const g = st.goalForm, body = {};
        ['cal_min', 'cal_max', 'protein_min', 'carbs_max', 'sugar_max', 'fiber_min', 'salt_max', 'age', 'height_cm', 'weight_kg', 'target_weight_kg'].forEach(k => { body[k] = Number(g[k]) || 0; });
        body.goal_type = g.goal_type; body.sex = g.sex; body.activity = Number(g.activity) || 1.375;
        try { st.settings = await api('/settings', { method: 'PUT', body: JSON.stringify(body) }); st.goalForm = goalDraft(); st.goalMsg = t('nu_saved'); loadDay().then(() => render()); }
        catch (e) { st.goalMsg = e.message === 'invalid_calorie_range' ? t('nu_range_invalid') : t('nu_error'); }
        render();
      }
      else if (act === 'calc') {
        const g = st.goalForm; st.calcOpen = true;
        try {
          const r = await api('/suggest', { method: 'POST', body: JSON.stringify({ sex: g.sex, age: Number(g.age), height_cm: Number(g.height_cm), weight_kg: Number(g.weight_kg), activity: Number(g.activity), goal_type: g.goal_type, target_weight_kg: Number(g.target_weight_kg) || 0 }) });
          ['cal_min', 'cal_max', 'protein_min', 'carbs_max', 'sugar_max', 'fiber_min', 'salt_max'].forEach(k => { g[k] = r[k] || ''; });
          st.calcMsg = t('nu_calc_done', { a: r.cal_min, b: r.cal_max }) + (r.weeks ? ' ' + t('nu_calc_weeks', { n: r.weeks }) : '');
        } catch (e) { st.calcMsg = t('nu_calc_invalid'); }
        render();
      }
      else if (act === 'restr-add') {
        const kind = w.querySelector('#nu-r-kind').value, key = w.querySelector('#nu-r-key').value, label = w.querySelector('#nu-r-label').value.trim();
        if (!key && !label) { st.restrMsg = t('nu_restr_needed'); render(); return; }
        try { await api('/restrictions', { method: 'POST', body: JSON.stringify({ kind, key, label: key ? '' : label }) }); st.restrMsg = ''; await reloadMe(); await loadDay(); } catch (e) { st.restrMsg = t('nu_error'); }
        render();
      }
      else if (act === 'del-restr') { try { await api('/restrictions/' + encodeURIComponent(el.dataset.id), { method: 'DELETE' }); await reloadMe(); await loadDay(); } catch (e) { st.error = t('nu_error'); } render(); }
      else if (act === 'settings') { st.view = 'settings'; st.rewardMsg = ''; render(); loadRewardCats(); }
      else if (act === 'settings-back') { st.view = 'main'; st.mealForm = null; render(); }
      else if (act === 'meal-new') { st.mealForm = { id: null, name: '', icon: '🍽️', time: '', msg: '' }; render(); }
      else if (act === 'meal-edit') { const m = mealById(el.dataset.id); if (m) { st.mealForm = { id: m.id, name: m.name, icon: m.icon, time: m.time, msg: '' }; render(); } }
      else if (act === 'meal-cancel') { st.mealForm = null; render(); }
      else if (act === 'meal-icon') { st.mealForm.icon = el.dataset.v; render(true); }
      else if (act === 'meal-save') saveMeal();
      else if (act === 'meal-del') {
        const m = mealById(el.dataset.id);
        if (!m || !confirm(t('nu_meal_confirm_delete', { n: mealLabel(m) }))) return;
        try { await api('/meals/' + encodeURIComponent(m.id), { method: 'DELETE' }); await reloadMe(); await loadDay(); } catch (e) { st.error = t('nu_error'); }
        render();
      }
    });

    w.addEventListener('input', ev => {
      const e = ev.target;
      if (e.id === 'nu-q' && st.add) { st.add.q = e.value; st.add.online = []; st.add.onlineMsg = ''; clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 200); }
      else if (e.id === 'nu-water' && st.add && st.add.pick) { st.add.pick.water = Math.max(0, Math.min(100, Number(e.value) || 0)); render(true); }
      else if (e.id === 'nu-amount' && st.add) { st.add.amount = e.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => { render(true); runCheck(); }, 250); }
      else if (e.id === 'nu-rq' && st.recipe) { st.recipe.q = e.value; clearTimeout(searchTimer); searchTimer = setTimeout(recipeSearch, 200); }
      else if (e.dataset.mf && st.mealForm) { st.mealForm[e.dataset.mf] = e.value; }
      else if (e.dataset.f && st.form) { st.form[e.dataset.f] = e.value; }
      else if (e.dataset.g && st.goalForm) { st.goalForm[e.dataset.g] = e.value; }
      else if (e.dataset.r && st.recipe) { st.recipe[e.dataset.r] = e.value; clearTimeout(searchTimer); searchTimer = setTimeout(() => render(true), 300); }
      else if (e.dataset.ri != null && st.recipe) { st.recipe.items[Number(e.dataset.ri)].amount = Number(e.value) || 0; clearTimeout(searchTimer); searchTimer = setTimeout(() => render(true), 300); }
    });
    w.addEventListener('change', e => {
      const x = e.target;
      if (x.id === 'nu-meal' && st.add) { st.add.meal = x.value; if (!st.add.q.trim() && !st.add.pick) runSearch(); }
      else if (x.dataset.f === 'unit' && st.form) { st.form.unit = x.value; render(true); }
      else if (x.dataset.g === 'sex' || x.dataset.g === 'activity') { st.goalForm[x.dataset.g] = x.value; }
      else if (x.id === 'nu-dayend') {
        const h = Number(x.value);
        api('/settings', { method: 'PUT', body: JSON.stringify({ day_end_hour: h }) }).then(s => { st.settings = s; st.dayEnd = s.day_end_hour; rollDay(); return loadDay(); }).then(render).catch(() => { st.error = t('nu_error'); render(); });
      }
      else if (x.id === 'nu-health') {
        const on = x.checked;
        api('/health', { method: 'PUT', body: JSON.stringify({ enabled: on }) }).then(r => {
          st.health = Object.assign(st.health, { enabled: r.enabled, available: r.available, msg: r.enabled ? t('nu_health_on', { n: r.synced_days }) : t('nu_health_off') });
          render();
        }).catch(() => { st.health.msg = t('nu_error'); x.checked = !on; render(); });
      }
      else if (x.id === 'nu-health-read') {
        const on = x.checked;
        api('/health', { method: 'PUT', body: JSON.stringify({ read: on }) }).then(r => {
          st.health = Object.assign(st.health, { read: r.read, available: r.available });
          st.goalForm = null; st.calcMsg = '';
          return reloadMe();
        }).then(render).catch(() => { x.checked = !on; st.health.msg = t('nu_error'); render(); });
      }
      else if (x.id === 'nu-health-other') {
        const on = x.checked;
        api('/health', { method: 'PUT', body: JSON.stringify({ read_other: on }) }).then(r => {
          st.health = Object.assign(st.health, { read_other: r.read_other, available: r.available });
          return loadDay();
        }).then(render).catch(() => { x.checked = !on; st.health.msg = t('nu_error'); render(); });
      }
      else if (['nu-rw-on', 'nu-rw-amount', 'nu-rw-from'].includes(x.id) || x.classList?.contains('nu-rw-to')) saveReward();
    });

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      rollDay();
      reloadMe().then(refresh);
    }
    document.addEventListener('visibilitychange', onVisible);
    const onLang = () => render();
    if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(onLang);

    async function reloadMe() {
      const me = await api('/me');
      st.meals = me.meals || st.meals; st.settings = me.settings; st.dayEnd = me.settings.day_end_hour || 0; st.restrictions = me.restrictions;
      st.rewardOffered = !!me.reward_offered; if (me.reward) st.reward = me.reward;
      if (me.rewarded && me.rewarded.length) {
        const sum = me.rewarded.reduce((s, r) => s + r.amount, 0), cur = me.rewarded[0].currency;
        st.notice = t('nu_reward_added', { v: rnd(sum, 2) + (typeof cur === 'string' && cur ? ' ' + cur : '') });
      }
    }

    (async () => {
      try {
        await Promise.all([loadRegional(token), reloadMe(), window.mvmOS && window.mvmOS.dateTimePicker ? window.mvmOS.dateTimePicker.ready() : null]);
        st.ready = true;
        rollDay();
        await loadDay();
      } catch (e) { st.error = t('nu_error'); }
      render();
      api('/health').then(h => { st.health = Object.assign(st.health, h, { loaded: true }); if (st.view === 'settings') render(); }).catch(() => {});
    })();

    return { destroy() { if (mealPicker) { mealPicker.destroy(); mealPicker = null; } stopScan(); clearTimeout(searchTimer); document.removeEventListener('visibilitychange', onVisible); } };
  }

  window.NutritionWidget = { mount };
})();
