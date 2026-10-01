// Health — widget shared by the desktop app window and the standalone Apps Hub
// public page (same pattern as apps/hydration). Charts are plain SVG, so
// nothing is loaded from outside.
(function () {
  if (window.HealthWidget) return;

  const API = '/pub/health';
  const LB_PER_KG = 2.2046226218;
  const OZ_ML = 29.5735295625;
  const RANGES = [7, 30, 90, 365];
  // Sections are built from the server's metric list, grouped by what the
  // numbers describe (body, intake, ...), never by the app that sends them.
  // A metric or group the server adds later shows up with no change here.
  const ICON = { weight: '⚖️', bp: '🩺', water: '💧', caffeine: '☕', alcohol: '🍷' };
  const COLOR = { weight: '#89b4fa', bp: '#f38ba8', water: '#74c7ec', caffeine: '#fab387', alcohol: '#cba6f7' };
  const FALLBACK = ['#a6e3a1', '#f9e2af', '#94e2d5', '#eba0ac', '#b4befe'];
  const iconOf = id => ICON[id] || '📈';
  const colorOf = id => COLOR[id] || FALLBACK[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK.length];
  const BP_COLOR = { normal: '#a6e3a1', elevated: '#f9e2af', stage1: '#fab387', stage2: '#f38ba8', crisis: '#eb4d6d' };

  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dayMs(day) { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  function atMs(at) { return new Date(at).getTime(); }
  function shiftDay(day, delta) { const [y, m, d] = day.split('-').map(Number); return ymd(new Date(y, m - 1, d + delta)); }
  function rnd(v, d) { const k = Math.pow(10, d || 0); return Math.round(v * k) / k; }

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
  function fmtShort(day) {
    const [, m, d] = day.split('-');
    if (regional.date_format === 'MM/DD/YYYY') return `${m}/${d}`;
    if (regional.date_format === 'YYYY-MM-DD') return `${m}-${d}`;
    return `${d}/${m}`;
  }
  function fmtTime(at) {
    const d = new Date(at);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString(window.mvmOS?.lang || undefined,
      { hour: '2-digit', minute: '2-digit', hour12: regional.time_format === '12' });
  }

  function injectStyles() {
    if (document.getElementById('hl-styles')) return;
    const style = document.createElement('style');
    style.id = 'hl-styles';
    style.textContent = `
      .hl-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);
        font-family:system-ui,sans-serif;position:relative;box-sizing:border-box}
      .hl-widget *{box-sizing:border-box}
      .hl-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2,#a6adc8)}
      .hl-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2,#313244);flex-shrink:0}
      .hl-tabs{display:flex;gap:3px;flex:1;overflow-x:auto;scrollbar-width:none}
      .hl-tabs::-webkit-scrollbar{display:none}
      .hl-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:none;border-radius:6px;padding:8px 10px;min-height:38px;cursor:pointer;font-size:.82rem;white-space:nowrap}
      .hl-btn:hover{background:var(--pub-border,#45475a)}
      .hl-btn.on{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
      .hl-primary{background:var(--pub-accent,#89b4fa);color:var(--pub-bg,#1e1e2e);font-weight:600}
      .hl-body{flex:1;overflow-y:auto;padding:14px 14px 28px;display:flex;flex-direction:column;gap:16px}
      .hl-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
      .hl-chips{display:flex;gap:6px;flex-wrap:wrap}
      .hl-chip{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:2px solid transparent;border-radius:20px;padding:7px 13px;min-height:38px;cursor:pointer;font-size:.85rem}
      .hl-chip.sel{border-color:var(--pub-accent,#89b4fa)}
      .hl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}
      .hl-card{background:var(--pub-surface2,#313244);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:6px;min-width:0}
      .hl-mcard{cursor:pointer;border:2px solid transparent;text-align:left;color:inherit;font:inherit}
      .hl-mcard:hover{border-color:var(--pub-border,#45475a)}
      .hl-mname{font-size:.8rem;color:var(--pub-fg2,#a6adc8);display:flex;align-items:center;gap:6px}
      .hl-mval{font-size:1.6rem;font-weight:700;line-height:1.1}
      .hl-mval small{font-size:.85rem;font-weight:500;color:var(--pub-fg2,#a6adc8);margin-left:3px}
      .hl-msub{font-size:.76rem;color:var(--pub-fg2,#a6adc8);min-height:1em}
      .hl-spark{height:34px;width:100%;margin-top:4px}
      .hl-hero{display:flex;flex-direction:column;gap:2px}
      .hl-hero-val{font-size:2.1rem;font-weight:700;line-height:1.1}
      .hl-hero-val small{font-size:1rem;font-weight:500;color:var(--pub-fg2,#a6adc8);margin-left:4px}
      .hl-hero-sub{font-size:.8rem;color:var(--pub-fg2,#a6adc8)}
      .hl-chart{width:100%;height:auto;display:block;touch-action:manipulation}
      .hl-grid-line{stroke:var(--pub-border,#45475a);stroke-opacity:.5;stroke-width:1}
      .hl-axis{fill:var(--pub-fg2,#a6adc8);font-size:16px}
      .hl-tip{cursor:pointer}
      .hl-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
      .hl-stat{background:var(--pub-surface2,#313244);border-radius:10px;padding:10px 12px}
      .hl-stat-l{font-size:.74rem;color:var(--pub-fg2,#a6adc8)}
      .hl-stat-v{font-size:1.05rem;font-weight:600;margin-top:2px}
      .hl-h{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,#a6adc8)}
      .hl-list{display:flex;flex-direction:column;gap:6px}
      .hl-item{display:flex;align-items:center;gap:8px;background:var(--pub-surface2,#313244);border-radius:8px;padding:8px 10px}
      .hl-item-main{flex:1;min-width:0}
      .hl-item-v{font-weight:600}
      .hl-item-m{font-size:.75rem;color:var(--pub-fg2,#a6adc8);overflow-wrap:anywhere}
      .hl-ico{background:var(--pub-bg,#1e1e2e);border:none;color:var(--pub-fg2,#a6adc8);cursor:pointer;font-size:1.05rem;width:42px;height:42px;border-radius:8px;flex-shrink:0}
      .hl-ico:hover{background:var(--pub-border,#45475a);color:var(--pub-fg,#cdd6f4)}
      .hl-empty{color:var(--pub-dim,#6c7086);text-align:center;padding:22px 12px;font-size:.9rem}
      .hl-code{font-size:.7rem;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg2,#a6adc8);border-radius:4px;padding:1px 6px;margin-left:4px;white-space:nowrap}
      .hl-badge{display:inline-block;border-radius:12px;padding:3px 10px;font-size:.78rem;font-weight:600;color:#1e1e2e}
      .hl-dist{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--pub-bg,#1e1e2e)}
      .hl-legend{display:flex;flex-wrap:wrap;gap:4px 12px;font-size:.75rem;color:var(--pub-fg2,#a6adc8)}
      .hl-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
      .hl-hint{font-size:.75rem;color:var(--pub-dim,#6c7086)}
      .hl-err{color:var(--pub-red,#f38ba8);font-size:.82rem;min-height:1em}
      .hl-overlay{position:absolute;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:14px;z-index:5}
      .hl-dialog{background:var(--pub-bg,#1e1e2e);border:1px solid var(--pub-border,#45475a);border-radius:10px;padding:18px;width:100%;max-width:400px;max-height:100%;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
      .hl-dialog h3{margin:0;font-size:1.05rem}
      .hl-imp{background:var(--pub-surface2,#313244);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
      .hl-imp-check{border:1px dashed var(--pub-border,#45475a)}
      .hl-imp-top{display:flex;gap:8px;align-items:center}.hl-imp-top select{flex:1;min-width:0}
      .hl-imp input[type=checkbox]{width:20px;height:20px;flex-shrink:0}
      .hl-imp-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
      .hl-imp .hl-input{background:var(--pub-bg,#1e1e2e)}
      .hl-imp-list{display:flex;flex-direction:column;gap:8px}
      .hl-lform{display:flex;flex-direction:column;gap:12px}
      .hl-lform:empty,.hl-sug:empty{display:none}
      .hl-field label{display:block;font-size:.78rem;color:var(--pub-fg2,#a6adc8);margin-bottom:4px}
      .hl-input{background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:9px 10px;font-size:.95rem;width:100%;min-height:42px}
      .hl-dialog .hl-input{background:var(--pub-surface2,#313244)}
      .hl-two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .hl-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
      .hl-actions .hl-del{margin-right:auto;background:var(--pub-red,#f38ba8);color:var(--pub-bg,#1e1e2e);font-weight:600}
    `;
    document.head.appendChild(style);
  }

  // ── Chart helpers ────────────────────────────────────────────────
  function niceScale(min, max, n) {
    if (!(max > min)) { const p = Math.abs(min) * 0.1 || 1; min -= p; max += p; }
    const raw = (max - min) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(s => s >= raw) || raw;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(rnd(v, 6));
    return { lo, hi, ticks };
  }
  function tickLabel(v) { return Math.abs(v) >= 1000 ? rnd(v / 1000, 2) + 'k' : String(rnd(v, 2)); }

  const CW = 640, CH = 260, ML = 52, MR = 12, MT = 12, MB = 26;

  // A chart frame: y grid + labels and x labels. `x(v)`/`y(v)` map data to pixels.
  function frame(ys, xs) {
    const sc = niceScale(ys.min, ys.max, 4);
    const y = v => MT + (CH - MT - MB) * (1 - (v - sc.lo) / (sc.hi - sc.lo));
    const x = v => ML + (CW - ML - MR) * ((v - xs.min) / ((xs.max - xs.min) || 1));
    let g = '';
    sc.ticks.forEach(tk => {
      g += `<line class="hl-grid-line" x1="${ML}" x2="${CW - MR}" y1="${y(tk).toFixed(1)}" y2="${y(tk).toFixed(1)}"/>` +
           `<text class="hl-axis" x="${ML - 6}" y="${(y(tk) + 4).toFixed(1)}" text-anchor="end">${esc(tickLabel(tk))}</text>`;
    });
    const nx = 4;
    for (let i = 0; i <= nx; i++) {
      const ms = xs.min + (xs.max - xs.min) * i / nx;
      const anchor = i === 0 ? 'start' : i === nx ? 'end' : 'middle';
      g += `<text class="hl-axis" x="${x(ms).toFixed(1)}" y="${CH - 6}" text-anchor="${anchor}">${esc(fmtShort(ymd(new Date(ms))))}</text>`;
    }
    return { g, x, y, sc };
  }

  function lineChart(lines, xs, opts) {
    opts = opts || {};
    const all = lines.flatMap(l => l.pts.map(p => p.y)).concat(opts.extra || []);
    if (!all.length) return '';
    const f = frame({ min: Math.min(...all), max: Math.max(...all) }, xs);
    let out = `<svg class="hl-chart" viewBox="0 0 ${CW} ${CH}" role="img">${f.g}`;
    if (opts.band) {
      const y1 = f.y(Math.min(opts.band[1] == null ? Infinity : opts.band[1], f.sc.hi)), y2 = f.y(Math.max(opts.band[0] == null ? -Infinity : opts.band[0], f.sc.lo));
      out += `<rect x="${ML}" width="${CW - ML - MR}" y="${y1.toFixed(1)}" height="${Math.max(0, y2 - y1).toFixed(1)}" fill="${opts.bandColor || '#a6e3a1'}" opacity=".10"/>`;
    }
    if (opts.avg != null) {
      out += `<line x1="${ML}" x2="${CW - MR}" y1="${f.y(opts.avg).toFixed(1)}" y2="${f.y(opts.avg).toFixed(1)}" stroke="${lines[0].color}" stroke-width="1.5" stroke-dasharray="5 5" opacity=".7"/>`;
    }
    lines.forEach((l, li) => {
      const d = l.pts.map((p, i) => (i ? 'L' : 'M') + f.x(p.x).toFixed(1) + ' ' + f.y(p.y).toFixed(1)).join(' ');
      if (l.area && l.pts.length > 1) {
        out += `<path d="${d} L${f.x(l.pts[l.pts.length - 1].x).toFixed(1)} ${f.y(f.sc.lo).toFixed(1)} L${f.x(l.pts[0].x).toFixed(1)} ${f.y(f.sc.lo).toFixed(1)} Z" fill="${l.color}" opacity=".13"/>`;
      }
      if (l.pts.length > 1) out += `<path d="${d}" fill="none" stroke="${l.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      const r = l.pts.length > 60 ? 2 : 4;
      l.pts.forEach((p, i) => {
        const sel = opts.sel === i;
        out += `<circle cx="${f.x(p.x).toFixed(1)}" cy="${f.y(p.y).toFixed(1)}" r="${sel ? r + 2.5 : r}" fill="${sel ? '#fff' : (p.c || l.color)}" stroke="${p.c || l.color}" stroke-width="${sel ? 3 : 0}"/>`;
        if (li === 0) out += `<circle class="hl-tip" data-act="pt" data-i="${i}" cx="${f.x(p.x).toFixed(1)}" cy="${f.y(p.y).toFixed(1)}" r="14" fill="transparent"/>`;
      });
    });
    return out + '</svg>';
  }

  function barChart(days, color, xs, sel, avg, unit) {
    // days: [{day,total}] sparse; every day of the range gets a slot.
    const n = Math.round((xs.max - xs.min) / 86400000) + 1;
    const vals = days.map(d => d.total);
    const f = frame({ min: 0, max: Math.max(...vals, 1) }, { min: xs.min, max: xs.max });
    const slot = (CW - ML - MR) / n, bw = Math.max(1.5, Math.min(slot * 0.72, 26));
    let out = `<svg class="hl-chart" viewBox="0 0 ${CW} ${CH}" role="img">${f.g}`;
    if (avg != null) out += `<line x1="${ML}" x2="${CW - MR}" y1="${f.y(avg).toFixed(1)}" y2="${f.y(avg).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5 5" opacity=".8"/>`;
    days.forEach((d, i) => {
      const cx = ML + slot * (Math.round((dayMs(d.day) - xs.min) / 86400000) + 0.5);
      const y = f.y(d.total), base = f.y(0);
      out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, base - y).toFixed(1)}" rx="${bw > 5 ? 3 : 0}" fill="${color}" opacity="${sel === i ? 1 : 0.72}"/>` +
             `<rect class="hl-tip" data-act="pt" data-i="${i}" x="${(cx - Math.max(bw, 10) / 2).toFixed(1)}" y="${MT}" width="${Math.max(bw, 10).toFixed(1)}" height="${(CH - MT - MB).toFixed(1)}" fill="transparent"/>`;
    });
    return out + '</svg>';
  }

  function spark(pts, color, xs) {
    if (!pts.length) return '';
    const W = 200, H = 34, ys = pts.map(p => p.y), lo = Math.min(...ys), hi = Math.max(...ys);
    const x = v => 2 + (W - 4) * ((v - xs.min) / ((xs.max - xs.min) || 1));
    const y = v => H - 3 - (H - 8) * ((v - lo) / ((hi - lo) || 1));
    const d = pts.map((p, i) => (i ? 'L' : 'M') + x(p.x).toFixed(1) + ' ' + (hi === lo ? H / 2 : y(p.y)).toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="hl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
           `<circle cx="${x(last.x).toFixed(1)}" cy="${(hi === lo ? H / 2 : y(last.y)).toFixed(1)}" r="3" fill="${color}"/></svg>`;
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="hl-widget"></div>';
    const w = root.firstChild;
    if (!token) {
      w.innerHTML = `<div class="hl-login">${esc(t('hb_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    const st = {
      tab: 'overview', sub: null, groups: [], labs: { catalog: [], ov: null, test: null, detail: null }, range: 30, today: ymd(new Date()),
      settings: { weight_unit: 'kg', volume_unit: 'ml' }, overview: null, series: null, sel: null,
      ready: false, loading: false, error: '',
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

    // Values are stored in kg and ml; pounds and ounces are only how they are
    // shown and typed.
    const lb = () => st.settings.weight_unit === 'lb', oz = () => st.settings.volume_unit === 'oz';
    function dispVal(metric, v) {
      if (metric === 'weight' && lb()) return v * LB_PER_KG;
      if (metric === 'water' && oz()) return v / OZ_ML;
      return v;
    }
    function fromDisp(metric, v) {
      if (metric === 'weight' && lb()) return v / LB_PER_KG;
      if (metric === 'water' && oz()) return v * OZ_ML;
      return v;
    }
    function unitOf(metric) {
      if (metric === 'weight') return lb() ? 'lb' : 'kg';
      if (metric === 'water') return oz() ? 'oz' : 'ml';
      return { bp: 'mmHg', caffeine: 'mg', alcohol: 'g' }[metric];
    }
    function num(metric, v, forceUnit) {
      let d = dispVal(metric, v), s;
      if (metric === 'water' && !oz()) s = String(Math.round(d));
      else if (metric === 'weight') s = String(rnd(d, 1));
      else s = String(rnd(d, metric === 'water' ? 1 : 1));
      return forceUnit === false ? s : s + ' ' + unitOf(metric);
    }
    function signed(metric, v) { const d = rnd(dispVal(metric, v), 1); return (d > 0 ? '+' : '') + d + ' ' + unitOf(metric); }
    function bpText(v) { return Math.round(v[0]) + '/' + Math.round(v[1]); }
    function bigVal(metric, v) {
      return `<span>${esc(num(metric, v, false))}</span><small>${esc(unitOf(metric))}</small>`;
    }

    function curMetric() { return st.sub; }
    function groupOf(id) { return st.groups.find(g => g.metrics.includes(id)); }
    function openTab(tab, metric) {
      st.tab = tab; st.series = null; st.sel = null;
      const g = st.groups.find(x => x.id === tab);
      st.sub = g ? (metric && g.metrics.includes(metric) ? metric : g.metrics[0]) : null;
    }

    async function loadOverview() {
      st.overview = await api('/overview?end=' + encodeURIComponent(st.today));
      const lo = await api('/labs/overview');
      st.labs.ov = lo; st.labs.catalog = lo.catalog;
    }
    async function loadLabs() {
      if (st.labs.test) {
        st.labs.detail = await api('/labs/results?test=' + encodeURIComponent(st.labs.test));
        const lo = await api('/labs/overview'); st.labs.ov = lo; st.labs.catalog = lo.catalog;
      } else {
        const lo = await api('/labs/overview'); st.labs.ov = lo; st.labs.catalog = lo.catalog; st.labs.detail = null;
      }
      st.sel = null;
    }
    async function loadSeries() {
      st.series = await api('/series?metric=' + curMetric() + '&days=' + st.range + '&end=' + encodeURIComponent(st.today));
      st.sel = null;
    }
    async function refresh() {
      try {
        if (st.tab === 'overview') await loadOverview(); else if (st.tab === 'labs') await loadLabs(); else await loadSeries();
        st.error = '';
      } catch (e) { st.error = t('hb_error'); }
      render();
    }

    // ── Views ──────────────────────────────────────────────────────
    function overviewView() {
      const ov = st.overview;
      if (!ov) return '';
      const xs = { min: dayMs(shiftDay(st.today, -29)), max: dayMs(st.today) };
      const any = Object.values(ov.metrics).some(m => m.points.length);
      const card = id => {
        const m = ov.metrics[id];
        let val = `<span class="hl-mval" style="color:var(--pub-fg2,#a6adc8);font-size:1.1rem">—</span>`, sub = '', sp = '';
        if (m.kind === 'reading' && m.latest) {
          val = id === 'bp'
            ? `<span class="hl-mval">${esc(bpText(m.latest.v))}<small>mmHg</small></span>`
            : `<span class="hl-mval">${bigVal(id, m.latest.v[0])}</span>`;
          sub = id === 'bp' ? t('hb_bpc_' + m.category) : t('hb_on_date', { d: fmtDate(m.latest.day) });
          sp = spark(m.points.map(p => ({ x: atMs(p.at), y: p.v[0] })), colorOf(id), xs);
        } else if (m.kind === 'daily' && m.latest) {
          val = `<span class="hl-mval">${bigVal(id, m.latest.total)}</span>`;
          sub = (m.latest.day === st.today ? t('hb_today') : fmtDate(m.latest.day)) + (m.week_avg != null ? ' · ' + t('hb_week_avg', { v: num(id, m.week_avg) }) : '');
          sp = spark(m.points.map(p => ({ x: dayMs(p.day), y: p.total })), colorOf(id), xs);
        }
        return `<button class="hl-card hl-mcard" data-act="open" data-m="${id}">
          <div class="hl-mname"><span>${iconOf(id)}</span>${esc(t('hb_m_' + id))}</div>${val}<div class="hl-msub">${esc(sub)}</div>${sp}</button>`;
      };
      const cards = st.groups.map(g => `<div class="hl-h">${esc(t('hb_group_' + g.id))}</div><div class="hl-grid">${g.metrics.filter(id => ov.metrics[id]).map(card).join('')}</div>`).join('');
      const lab = st.labs.ov && st.labs.ov.tests.length
        ? `<div class="hl-h">${esc(t('hb_group_labs'))}</div><div class="hl-grid">${st.labs.ov.tests.slice(0, 6).map(labCard).join('')}</div>` : '';
      return `${cards}${lab}${any || lab ? '' : `<div class="hl-empty">${esc(t('hb_empty_hint'))}</div>`}`;
    }

    function stat(label, value) { return `<div class="hl-stat"><div class="hl-stat-l">${esc(label)}</div><div class="hl-stat-v">${value}</div></div>`; }

    function readoutFor(s, sel) {
      const m = s.metric;
      if (s.kind === 'reading') {
        const p = sel != null ? s.points[sel] : s.points[s.points.length - 1];
        if (!p) return '';
        const v = m === 'bp' ? `<span>${esc(bpText(p.v))}</span><small>mmHg${p.v[2] != null ? ' · ' + Math.round(p.v[2]) + ' bpm' : ''}</small>` : bigVal(m, p.v[0]);
        return `<div class="hl-hero"><div class="hl-hero-val">${v}</div><div class="hl-hero-sub">${esc(fmtDate(p.day) + ' · ' + fmtTime(p.at))}</div></div>`;
      }
      const p = sel != null ? s.points[sel] : s.points[s.points.length - 1];
      if (!p) return '';
      return `<div class="hl-hero"><div class="hl-hero-val">${bigVal(m, p.total)}</div><div class="hl-hero-sub">${esc(fmtDate(p.day))}</div></div>`;
    }

    function chartFor(s) {
      const m = s.metric, xs = { min: dayMs(s.start), max: dayMs(s.end) };
      if (s.kind === 'daily') {
        if (!s.points.length) return '';
        return barChart(s.points.map(p => ({ day: p.day, total: dispVal(m, p.total) })), colorOf(m), xs, st.sel,
          s.stats ? dispVal(m, s.stats.avg) : null);
      }
      if (!s.points.length) return '';
      if (m === 'bp') {
        return lineChart([
          { color: COLOR.bp, pts: s.points.map(p => ({ x: atMs(p.at), y: p.v[0] })) },
          { color: '#74c7ec', pts: s.points.map(p => ({ x: atMs(p.at), y: p.v[1] })) },
        ], xs, { sel: st.sel, band: [80, 120], bandColor: BP_COLOR.normal, extra: [60, 140] });
      }
      return lineChart([{ color: colorOf(m), area: true, pts: s.points.map(p => ({ x: atMs(p.at), y: dispVal(m, p.v[0]) })) }],
        xs, { sel: st.sel, avg: s.stats[0] ? dispVal(m, s.stats[0].avg) : null });
    }

    function statsFor(s) {
      const m = s.metric;
      if (s.kind === 'daily') {
        const x = s.stats; if (!x) return '';
        return stat(t('hb_avg_per_day'), esc(num(m, x.avg))) + stat(t('hb_total'), esc(num(m, x.total))) +
          stat(t('hb_best_day'), esc(num(m, x.max)) + `<div class="hl-stat-l">${esc(fmtDate(x.max_day))}</div>`) +
          stat(t('hb_lowest'), esc(num(m, x.min))) + stat(t('hb_days_with_data'), x.count);
      }
      if (m === 'bp') {
        const [a, b, c] = s.stats; if (!a) return '';
        return stat(t('hb_average'), Math.round(a.avg) + '/' + Math.round(b.avg)) +
          stat(t('hb_highest'), Math.round(a.max) + '/' + Math.round(b.max)) +
          stat(t('hb_lowest'), Math.round(a.min) + '/' + Math.round(b.min)) +
          (c ? stat(t('hb_pulse'), Math.round(c.avg) + ' bpm') : '') + stat(t('hb_count'), a.count);
      }
      const x = s.stats[0]; if (!x) return '';
      return stat(t('hb_average'), esc(num(m, x.avg))) + stat(t('hb_lowest'), esc(num(m, x.min))) + stat(t('hb_highest'), esc(num(m, x.max))) +
        stat(t('hb_change'), esc(signed(m, x.change))) + stat(t('hb_count'), x.count);
    }

    function bpExtra(s) {
      if (!s.categories) return '';
      const order = ['normal', 'elevated', 'stage1', 'stage2', 'crisis'], total = order.reduce((a, k) => a + (s.categories[k] || 0), 0);
      const bar = order.filter(k => s.categories[k]).map(k => `<div style="width:${(s.categories[k] / total * 100).toFixed(1)}%;background:${BP_COLOR[k]}"></div>`).join('');
      const legend = order.filter(k => s.categories[k]).map(k => `<span><i style="background:${BP_COLOR[k]}"></i>${esc(t('hb_bpc_' + k))} · ${s.categories[k]}</span>`).join('');
      return `<div class="hl-card"><div class="hl-row"><div class="hl-h">${esc(t('hb_bp_dist'))}</div>
        <span class="hl-badge" style="background:${BP_COLOR[s.category]}">${esc(t('hb_bpc_' + s.category))}</span></div>
        <div class="hl-dist">${bar}</div><div class="hl-legend">${legend}</div><div class="hl-hint">${esc(t('hb_bp_disclaimer'))}</div></div>`;
    }

    function listFor(s) {
      const m = s.metric;
      if (!s.points.length) return `<div class="hl-empty">${esc(t('hb_no_points'))}</div>`;
      if (s.kind === 'reading') {
        return `<div class="hl-list">${s.points.slice().reverse().map(p => {
          const v = m === 'bp' ? esc(bpText(p.v)) + ' mmHg' + (p.v[2] != null ? ' · ' + Math.round(p.v[2]) + ' bpm' : '') : esc(num(m, p.v[0]));
          const meta = [fmtDate(p.day) + ' ' + fmtTime(p.at)];
          if (p.source !== 'manual' && p.source_name) meta.push(t('hb_from', { name: p.source_name }));
          if (p.note) meta.push(p.note);
          return `<div class="hl-item"><div class="hl-item-main"><div class="hl-item-v">${v}</div><div class="hl-item-m">${esc(meta.join(' · '))}</div></div>
            <button class="hl-ico" data-act="editreading" data-id="${esc(p.id)}" title="${esc(t('hb_edit'))}">✎</button></div>`;
        }).join('')}</div>`;
      }
      return `<div class="hl-list">${s.points.slice().reverse().map(p => {
        const src = p.sources.map(x => (x.source === 'manual' ? t('hb_source_manual') : x.name || x.source) + ' ' + num(m, x.value)).join(' · ');
        return `<div class="hl-item"><div class="hl-item-main"><div class="hl-item-v">${esc(num(m, p.total))}</div><div class="hl-item-m">${esc(fmtDate(p.day) + ' · ' + src)}</div></div>
          <button class="hl-ico" data-act="editday" data-day="${esc(p.day)}" title="${esc(t('hb_edit'))}">✎</button></div>`;
      }).join('')}</div>`;
    }

    function detailView() {
      const s = st.series, tab = st.groups.find(x => x.id === st.tab);
      if (!s) return '';
      const sub = tab.metrics.length > 1
        ? `<div class="hl-chips">${tab.metrics.map(id => `<button class="hl-chip${st.sub === id ? ' sel' : ''}" data-act="sub" data-m="${id}">${iconOf(id)} ${esc(t('hb_m_' + id))}</button>`).join('')}</div>` : '';
      const ranges = `<div class="hl-chips">${RANGES.map(r => `<button class="hl-chip${st.range === r ? ' sel' : ''}" data-act="range" data-n="${r}">${esc(r === 365 ? t('hb_range_year') : t('hb_range_days', { n: r }))}</button>`).join('')}</div>`;
      const chart = chartFor(s);
      return `${sub}
        <div class="hl-row">${ranges}<button class="hl-btn hl-primary" data-act="add">＋ ${esc(t('hb_add'))}</button></div>
        ${chart ? `<div class="hl-card">${readoutFor(s, st.sel)}${chart}</div>` : `<div class="hl-card"><div class="hl-empty">${esc(t('hb_no_points'))}</div></div>`}
        ${chart ? `<div class="hl-stats">${statsFor(s)}</div>` : ''}
        ${s.metric === 'bp' ? bpExtra(s) : ''}
        <div class="hl-h">${esc(t('hb_entries'))}</div>
        ${s.kind === 'daily' ? `<div class="hl-hint">${esc(t('hb_daily_hint'))}</div>` : ''}
        ${listFor(s)}`;
    }

    // ── Laboratory tests ───────────────────────────────────────────
    const STATUS_COLOR = { ok: '#a6e3a1', low: '#89b4fa', high: '#f38ba8' };
    function tname(test) {
      const n = test.names || {}, lang = (window.mvmOS && window.mvmOS.lang) || 'en';
      return n[lang] || n[lang.split('-')[0]] || n.en || Object.values(n)[0] || test.key;
    }
    function norm(x) { return String(x || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
    function testHay(test) {
      return [test.code, test.catalog_code].concat(Object.values(test.names || {}), test.aliases || []).map(norm).join('|');
    }
    function findTests(q) {
      const n = norm(q);
      return st.labs.catalog.filter(x => !n || testHay(x).includes(n))
        .sort((a, b) => tname(a).localeCompare(tname(b))).slice(0, 8);
    }
    // Labs already used in earlier results, offered as a list when typing
    function labList(id) {
      return `<datalist id="${id}">${((st.labs.ov && st.labs.ov.labs) || []).map(l => `<option value="${esc(l)}">`).join('')}</datalist>`;
    }
    function labStatus(r) { return r.status ? `<span class="hl-badge" style="background:${STATUS_COLOR[r.status]}">${esc(t('hb_status_' + r.status))}</span>` : ''; }
    function labNum(v, unit) { return esc(String(rnd(v, 3))) + ' ' + esc(unit); }
    function rangeText(r) {
      if (r.low == null && r.high == null) return '';
      return r.low != null && r.high != null ? `${rnd(r.low, 3)}–${rnd(r.high, 3)}` : r.low != null ? `≥ ${rnd(r.low, 3)}` : `≤ ${rnd(r.high, 3)}`;
    }
    function testByKey(k) { return st.labs.catalog.find(x => x.key === k); }

    function labCard(o) {
      const l = o.latest, test = o.test;
      const xs = { min: Math.min(...o.points.map(p => dayMs(p.day))), max: Math.max(...o.points.map(p => dayMs(p.day))) };
      const sp = o.points.length > 1 ? spark(o.points.map(p => ({ x: dayMs(p.day), y: p.value })), STATUS_COLOR[l.status] || '#89b4fa', xs) : '';
      return `<button class="hl-card hl-mcard" data-act="labopen" data-k="${esc(test.key)}">
        <div class="hl-mname"><span>🧪</span>${esc(tname(test))}${test.code ? ` <span class="hl-code">${esc(test.code)}</span>` : ''}</div>
        <span class="hl-mval">${esc(String(rnd(l.value, 3)))}<small>${esc(l.unit)}</small></span>
        <div class="hl-msub">${labStatus(l)} ${esc(fmtDate(l.day))}${rangeText(l) ? ' · ' + esc(rangeText(l)) : ''}</div>${sp}</button>`;
    }

    function labsView() {
      const L = st.labs;
      if (!L.ov) return '';
      if (L.test && L.detail) return labDetailView();
      const cards = L.ov.tests.map(labCard).join('');
      return `<div class="hl-row"><div class="hl-hint">${esc(t('hb_labs_disclaimer'))}</div></div>
        <div class="hl-row"><button class="hl-btn hl-primary" data-act="labadd">＋ ${esc(t('hb_labs_add'))}</button>
        <button class="hl-btn" data-act="labimport">${esc(t('hb_labs_import'))}</button>
        <button class="hl-btn" data-act="labtest">${esc(t('hb_labs_own_test'))}</button></div>
        ${cards ? `<div class="hl-grid">${cards}</div>` : `<div class="hl-empty">${esc(t('hb_labs_empty'))}</div>`}`;
    }

    function labDetailView() {
      const d = st.labs.detail, test = d.test, res = d.results, last = res[res.length - 1];
      const ymd0 = res.length ? dayMs(res[0].day) : dayMs(st.today), ymd1 = res.length ? dayMs(last.day) : dayMs(st.today);
      const span = Math.max(ymd1 - ymd0, 6 * 86400000), pad = res.length > 1 ? 0 : 3 * 86400000;
      const xs = { min: ymd0 - pad, max: ymd0 + span + pad };
      const vals = res.map(r => r.value);
      const band = last && (last.low != null || last.high != null) ? [last.low, last.high] : null;
      const chart = res.length ? lineChart([{ color: '#89b4fa', area: true, pts: res.map(r => ({ x: dayMs(r.day), y: r.value, c: STATUS_COLOR[r.status] })) }],
        xs, { sel: st.sel, band, bandColor: STATUS_COLOR.ok, extra: band ? band.filter(x => x != null) : [] }).replace(/data-act="pt"/g, 'data-act="labpt"') : '';
      const sel = st.sel != null ? res[st.sel] : last;
      const hero = sel ? `<div class="hl-hero"><div class="hl-hero-val">${esc(String(rnd(sel.value, 3)))}<small>${esc(sel.unit)}</small></div>
        <div class="hl-hero-sub">${labStatus(sel)} ${esc(fmtDate(sel.day))}${sel.lab ? ' · ' + esc(sel.lab) : ''}${rangeText(sel) ? ' · ' + esc(t('hb_labs_ref')) + ' ' + esc(rangeText(sel)) : ''}</div></div>` : '';
      const stats = res.length ? stat(t('hb_labs_latest'), labNum(last.value, last.unit)) +
        stat(t('hb_lowest'), labNum(Math.min(...vals), last.unit)) + stat(t('hb_highest'), labNum(Math.max(...vals), last.unit)) +
        stat(t('hb_average'), labNum(vals.reduce((a, b) => a + b, 0) / vals.length, last.unit)) +
        (res.length > 1 ? stat(t('hb_change'), esc((vals[vals.length - 1] - vals[0] > 0 ? '+' : '') + rnd(vals[vals.length - 1] - vals[0], 3) + ' ' + last.unit)) : '') +
        stat(t('hb_count'), res.length) : '';
      const known = [tname(test)].concat(Object.values(test.names).filter(n => n !== tname(test)), test.aliases)
        .filter((n, i, a) => a.findIndex(x => norm(x) === norm(n)) === i).slice(1);
      const list = res.slice().reverse().map(r => {
        const meta = [fmtDate(r.day)];
        if (r.lab) meta.push(r.lab);
        if (rangeText(r)) meta.push(t('hb_labs_ref') + ' ' + rangeText(r));
        if (r.orig_unit !== r.unit) meta.push(t('hb_labs_as_written') + ' ' + rnd(r.orig_value, 3) + ' ' + r.orig_unit);
        if (r.written_name && norm(r.written_name) !== norm(tname(test))) meta.push('“' + r.written_name + '”');
        if (r.source !== 'manual' && r.source_name) meta.push(t('hb_from', { name: r.source_name }));
        if (r.note) meta.push(r.note);
        return `<div class="hl-item"><div class="hl-item-main"><div class="hl-item-v">${labNum(r.value, r.unit)} ${labStatus(r)}</div>
          <div class="hl-item-m">${esc(meta.join(' · '))}</div></div><button class="hl-ico" data-act="labedit" data-id="${esc(r.id)}" title="${esc(t('hb_edit'))}">✎</button></div>`;
      }).join('');
      return `<div class="hl-row"><button class="hl-btn" data-act="labback">← ${esc(t('hb_labs_all'))}</button>
          <button class="hl-btn" data-act="labtest" data-k="${esc(test.key)}">⚙ ${esc(t('hb_labs_edit_test'))}</button></div>
        <div class="hl-card"><div class="hl-mname" style="font-size:1rem;color:var(--pub-fg,#cdd6f4)">🧪 ${esc(tname(test))}${test.code ? ` <span class="hl-code">${esc(test.code)}</span>` : ''}</div>
          ${known.length ? `<div class="hl-hint">${esc(t('hb_labs_also'))}: ${esc(known.slice(0, 5).join(', '))}${known.length > 5 ? ' +' + (known.length - 5) : ''}</div>` : ''}</div>
        <div class="hl-row"><span></span><button class="hl-btn hl-primary" data-act="labadd" data-k="${esc(test.key)}">＋ ${esc(t('hb_labs_add'))}</button></div>
        ${chart ? `<div class="hl-card">${hero}${chart}</div><div class="hl-stats">${stats}</div>` : `<div class="hl-card"><div class="hl-empty">${esc(t('hb_no_points'))}</div></div>`}
        <div class="hl-h">${esc(t('hb_entries'))}</div>${list ? `<div class="hl-list">${list}</div>` : ''}
        <div class="hl-hint">${esc(t('hb_labs_disclaimer'))}</div>`;
    }

    // Add or edit a result. The test is found by typing any name, code or alias;
    // a name that matches nothing can become a test of the person's own.
    function labResultDialog(existing, key) {
      let test = key ? testByKey(key) : null;
      const r = existing || {};
      const lastRange = () => {
        if (!test) return {};
        const o = st.labs.ov.tests.find(x => x.test.key === test.key);
        if (o && o.latest && (o.latest.low != null || o.latest.high != null)) return { low: o.latest.low, high: o.latest.high, unit: o.latest.unit };
        return test.hint && !test.custom ? { low: test.hint[0], high: test.hint[1], unit: test.base_unit, hint: true } : {};
      };
      const units = () => test ? [test.base_unit].concat(Object.keys(test.units || {})) : [];
      const inp = (id, label, v, type, extra) => `<div class="hl-field"><label>${esc(label)}</label><input class="hl-input" id="${id}" type="${type || 'text'}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${v == null ? '' : esc(v)}" ${extra || ''}></div>`;
      dialog(`<h3>🧪 ${esc(t('hb_labs_test'))}</h3>
        <div class="hl-field"><label>${esc(t('hb_labs_test'))}</label>
          <input class="hl-input" id="hl-lq" autocomplete="off" placeholder="${esc(t('hb_labs_search'))}" value="${test ? esc(tname(test)) : ''}" ${existing ? 'disabled' : ''}>
          <div class="hl-list hl-sug" id="hl-lsug" style="margin-top:8px"></div></div>
        <div id="hl-lform" class="hl-lform"></div><div class="hl-err"></div>
        <div class="hl-actions">${existing ? `<button class="hl-btn hl-del" id="hl-del">${esc(t('hb_delete'))}</button>` : ''}<button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ok">${esc(t('hb_save'))}</button></div>`,
      ov => {
        const q = ov.querySelector('#hl-lq'), sug = ov.querySelector('#hl-lsug'), form = ov.querySelector('#hl-lform');
        let typed = r.written_name || '';
        function drawForm() {
          if (!test) { form.innerHTML = ''; return; }
          const rg = existing ? { low: r.low, high: r.high, unit: r.unit } : lastRange();
          const du = existing ? r.unit : (rg.unit && units().includes(rg.unit) ? rg.unit : test.display_unit);
          form.innerHTML = `<div class="hl-hint">${test.code ? esc(t('hb_labs_code')) + ': ' + esc(test.code) : ''}</div>
            <div class="hl-two">${inp('hl-lv', t('hb_labs_value'), existing ? r.value : '', 'number')}
              <div class="hl-field"><label>${esc(t('hb_labs_unit'))}</label><select class="hl-input" id="hl-lu">${units().map(u => `<option${u === du ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></div></div>
            <div class="hl-two">${inp('hl-llo', t('hb_labs_ref_low'), rg.low, 'number')}${inp('hl-lhi', t('hb_labs_ref_high'), rg.high, 'number')}</div>
            <div class="hl-hint" style="margin-top:-6px">${esc(t(rg.hint ? 'hb_labs_ref_hint' : 'hb_labs_ref_form'))}</div>
            ${inp('hl-ld', t('hb_date'), existing ? r.day : st.today, 'date')}${inp('hl-llab', t('hb_labs_lab'), r.lab || '', 'text', 'list="hl-labs" autocomplete="off"')}${labList('hl-labs')}${inp('hl-lnote', t('hb_note'), r.note || '')}`;
          form.querySelector('#hl-lu').addEventListener('change', e => {
            // Ranges typed in the old unit follow the chosen unit
            const from = du, to = e.target.value;
            if (from !== to) { /* left as typed: the range on a form is in the unit of its value */ }
          });
        }
        function drawSug() {
          if (existing) { sug.innerHTML = ''; return; }
          const found = findTests(q.value);
          sug.innerHTML = found.map(x => `<button class="hl-item" style="border:none;color:inherit;text-align:left;cursor:pointer;font:inherit" data-pick="${esc(x.key)}"><div class="hl-item-main"><div class="hl-item-v">${esc(tname(x))}</div>
            <div class="hl-item-m">${esc([x.code].concat(x.aliases.slice(0, 3)).filter(Boolean).join(' · '))}</div></div></button>`).join('') +
            (q.value.trim() && !found.length ? `<div class="hl-hint">${esc(t('hb_labs_no_match'))}</div>` : '') +
            (q.value.trim() && !(test && norm(tname(test)) === norm(q.value)) ? `<button class="hl-btn" data-newtest="1">＋ ${esc(t('hb_labs_create_own', { name: q.value.trim() }))}</button>` : '');
        }
        q.addEventListener('input', () => { typed = q.value; test = null; drawForm(); drawSug(); });
        sug.addEventListener('click', e => {
          const pick = e.target.closest('[data-pick]');
          if (pick) { test = testByKey(pick.dataset.pick); q.value = tname(test); sug.innerHTML = ''; drawForm(); }
          else if (e.target.closest('[data-newtest]')) { const name = q.value.trim(); closeDialog(); labTestDialog(null, name, () => { }); }
        });
        if (test) { drawForm(); } else drawSug();
        ov.querySelector('#hl-ok').addEventListener('click', async () => {
          if (!test) { ov.querySelector('.hl-err').textContent = t('hb_labs_pick_test'); return; }
          const g = id => ov.querySelector(id).value, n = id => g(id) === '' ? null : Number(g(id));
          if (g('#hl-lv') === '' || !g('#hl-ld')) { ov.querySelector('.hl-err').textContent = t('hb_e_invalid_value'); return; }
          const body = JSON.stringify({ test: test.key, value: n('#hl-lv'), unit: g('#hl-lu'), day: g('#hl-ld'), low: n('#hl-llo'), high: n('#hl-lhi'),
            lab: g('#hl-llab'), note: g('#hl-lnote'), written_name: existing ? (r.written_name || '') : (typed && norm(typed) !== norm(tname(test)) ? typed : '') });
          try {
            if (existing) await api('/labs/results/' + existing.id, { method: 'PUT', body }); else await api('/labs/results', { method: 'POST', body });
            closeDialog(); st.tab = 'labs'; st.labs.test = test.key; await refresh();
          } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hl-del')?.addEventListener('click', async () => {
          if (!confirm(t('hb_confirm_delete'))) return;
          try { await api('/labs/results/' + existing.id, { method: 'DELETE' }); closeDialog(); refresh(); } catch (e) { fail(ov, e); }
        });
      });
    }

    // Edit how a test is written for this person: the code shown, the unit
    // results are shown in and every other name it answers to. Tests made by
    // the person also get their own name for each language.
    function labTestDialog(key, prefillName) {
      const test = key ? testByKey(key) : null;
      const custom = !test || test.custom;
      const names = test ? test.names : {};
      const cur = (window.mvmOS && window.mvmOS.lang) || 'en';
      // Only the active language plus the languages that already hold a name are offered
      const langs = Object.keys(names).filter(l => l !== cur && names[l]);
      langs.unshift(cur);
      dialog(`<h3>🧪 ${esc(test ? tname(test) : t('hb_labs_own_test'))}</h3>
        <div class="hl-field"><label>${esc(t('hb_labs_code'))}</label><input class="hl-input" id="hl-tc" maxlength="30" value="${esc(test ? test.code : '')}"><div class="hl-hint">${esc(t('hb_labs_code_hint'))}</div></div>
        ${custom ? `<div class="hl-field"><label>${esc(t('hb_labs_own_unit'))}</label><input class="hl-input" id="hl-tu" maxlength="20" value="${esc(test ? test.base_unit : '')}"></div>
          <div class="hl-field"><label>${esc(t('hb_labs_names'))}</label><div class="hl-hint" style="margin-bottom:6px">${esc(t('hb_labs_names_hint'))}</div>
          ${langs.map(l => `<div class="hl-two" style="grid-template-columns:64px 1fr;margin-bottom:4px;align-items:center"><span class="hl-hint">${l}</span><input class="hl-input" data-nm="${l}" maxlength="80" value="${esc(names[l] || (l === cur && !test ? prefillName || '' : ''))}"></div>`).join('')}</div>`
          : `<div class="hl-field"><label>${esc(t('hb_labs_display_unit'))}</label><select class="hl-input" id="hl-tdu">${[test.base_unit].concat(Object.keys(test.units)).map(u => `<option${u === test.display_unit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select></div>`}
        <div class="hl-field"><label>${esc(t('hb_labs_aliases'))}</label><textarea class="hl-input" id="hl-ta" rows="3" placeholder="${esc(t('hb_labs_aliases_hint'))}">${esc(test ? test.user_aliases.join('\n') : '')}</textarea>
          ${test && !test.custom ? `<div class="hl-hint">${esc(t('hb_labs_builtin_names'))}: ${esc(Object.values(test.names).concat(test.aliases.filter(a => !test.user_aliases.includes(a))).filter((n, i, a) => a.indexOf(n) === i).join(', '))}</div>` : ''}</div>
        <div class="hl-err"></div>
        <div class="hl-actions">${test && test.custom ? `<button class="hl-btn hl-del" id="hl-del">${esc(t('hb_delete'))}</button>` : ''}<button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ok">${esc(t('hb_save'))}</button></div>`,
      ov => {
        const g = id => ov.querySelector(id)?.value;
        ov.querySelector('#hl-ok').addEventListener('click', async () => {
          const aliases = (g('#hl-ta') || '').split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
          const body = { code: g('#hl-tc'), aliases };
          if (custom) {
            body.unit = g('#hl-tu'); body.names = {};
            ov.querySelectorAll('[data-nm]').forEach(i => { if (i.value.trim()) body.names[i.dataset.nm] = i.value.trim(); });
          } else body.unit = g('#hl-tdu');
          try {
            const saved = await api(test ? '/labs/tests/' + test.key : '/labs/tests', { method: test ? 'PUT' : 'POST', body: JSON.stringify(body) });
            closeDialog(); st.tab = 'labs'; st.labs.test = saved.key; await refresh();
          } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hl-del')?.addEventListener('click', async () => {
          if (!confirm(t('hb_labs_confirm_delete_test'))) return;
          try { await api('/labs/tests/' + test.key, { method: 'DELETE' }); closeDialog(); st.labs.test = null; await refresh(); } catch (e) { fail(ov, e); }
        });
      });
    }


    // ── Reading a lab report from a PDF, entirely in the browser ──────────
    // The file never leaves the device: its text is read with pdf.js, every
    // line is matched against the names, abbreviations and codes of the tests,
    // and what was found is shown for confirmation. Lines that look like a
    // result but match no test are listed too, to be fixed by hand.
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    let pdfLib = null;
    function loadPdfJs() {
      if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(window.pdfjsLib); }
      if (pdfLib) return pdfLib;
      pdfLib = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = PDFJS; sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; res(window.pdfjsLib); };
        sc.onerror = () => { pdfLib = null; rej(new Error('pdf_library')); };
        document.head.appendChild(sc);
      });
      return pdfLib;
    }
    async function pdfLines(file) {
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      const lines = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const items = (await (await doc.getPage(n)).getTextContent()).items.filter(i => i.str && i.str.trim());
        const rows = [];
        items.forEach(i => {
          const y = i.transform[5], row = rows.find(r => Math.abs(r.y - y) < 3);
          if (row) row.items.push(i); else rows.push({ y, items: [i] });
        });
        rows.sort((a, b) => b.y - a.y).forEach(r => {
          r.items.sort((a, b) => a.transform[4] - b.transform[4]);
          let out = '', end = null;
          r.items.forEach(i => {
            const x = i.transform[4];
            if (end !== null && x - end > 1) out += ' ';
            out += i.str; end = x + (i.width || 0);
          });
          lines.push(out.replace(/\s+/g, ' ').trim());
        });
      }
      return lines;
    }
    const SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9 };
    function unitKey(u) {
      return String(u || '').toLowerCase().replace(/[µμ]/g, 'u').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, c => SUP[c])
        .replace(/[\s^*]/g, '').replace(/^[x×]/, '').replace(/^10e/, '10').replace(/тыс|thou/g, '10');
    }
    function findUnit(test, raw) {
      const k = unitKey(raw);
      if (!k) return null;
      return [test.base_unit].concat(Object.keys(test.units || {})).find(u => unitKey(u) === k) || null;
    }
    const NUM = '\\d+(?:[.,]\\d+)?';
    const toNum = x => Number(String(x).replace(',', '.'));
    function candidates() {
      const out = [];
      st.labs.catalog.forEach(test => {
        [test.code].concat(Object.values(test.names || {}), test.aliases || []).forEach(n => {
          if (!n) return;
          const add = x => { const k = norm(x); if (k.length >= 2 && !/^\d/.test(k)) out.push({ test, k }); };
          add(n); add(String(n).replace(/\s*\([^)]*\)\s*$/, ''));
        });
      });
      return out.sort((a, b) => b.k.length - a.k.length);
    }
    // Index in the raw line just after a leading name, or -1
    function eatName(raw, k) {
      let acc = '';
      for (let i = 0; i < raw.length; i++) {
        acc += norm(raw[i]);
        if (acc === k) { const nx = raw[i + 1]; return nx && /\p{L}/u.test(nx) && /\p{L}/u.test(raw[i]) ? -1 : i + 1; }
        if (acc.length > k.length || !k.startsWith(acc)) return -1;
      }
      return -1;
    }
    function parseValues(rest) {
      const m = new RegExp('(?<![\\p{L}\\d.,])([<>≤≥]?)\\s*(' + NUM + ')', 'u').exec(rest);
      if (!m) return null;
      const skipped = rest.slice(0, m.index);
      if (skipped.length > 40 || /\d/.test(skipped)) return null;
      let after = rest.slice(m.index + m[0].length);
      const um = /^\s*(\S+(?:\s?\/\s?\S+)?)/.exec(after);
      let unit = '', consumed = 0;
      if (um && (/[\p{L}%µμ]/u.test(um[1]) || /^[x×]?10/i.test(um[1])) && !/^(H|L|HH|LL|High|Low|\*+)$/i.test(um[1])) { unit = um[1]; consumed = um[0].length; }
      let tail = after.slice(consumed), low = null, high = null;
      const r = new RegExp('(' + NUM + ')\\s*(?:-|–|—|÷|to|до)\\s*(' + NUM + ')', 'iu').exec(tail);
      if (r) { low = toNum(r[1]); high = toNum(r[2]); }
      else {
        const hi = new RegExp('[<≤]\\s*(' + NUM + ')', 'u').exec(tail), lo = new RegExp('[>≥]\\s*(' + NUM + ')', 'u').exec(tail);
        if (hi) high = toNum(hi[1]); else if (lo) low = toNum(lo[1]);
      }
      return { value: toNum(m[2]), unit, low, high };
    }
    function findDate(lines) {
      const now = new Date().getFullYear();
      for (const l of lines) {
        let m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(l), y, mo, d;
        if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
        else if ((m = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)\b/.exec(l))) {
          y = +m[3]; d = +m[1]; mo = +m[2];
          if (String(regional.date_format).indexOf('MM') === 0 && d <= 12) { const x = d; d = mo; mo = x; }
        } else continue;
        if (y <= now && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      }
      return null;
    }
    function parseReport(lines) {
      const cands = candidates(), rows = [];
      const allUnits = new Set(st.labs.catalog.flatMap(x => [x.base_unit].concat(Object.keys(x.units || {}))).map(unitKey));
      lines.forEach(line => {
        const raw = line.replace(/^[^\p{L}\p{N}]+/u, '');
        let hit = null;
        for (const c of cands) { const e = eatName(raw, c.k); if (e > 0) { hit = { test: c.test, end: e }; break; } }
        if (hit) {
          if (raw[hit.end] === ')') hit.end++;
          const rest = raw.slice(hit.end).replace(/^\s*\([^)]*\)/, '');
          const v = parseValues(rest);
          if (v) rows.push({ test: hit.test.key, written: raw.slice(0, hit.end).trim(), ...v, found: true });
          return;
        }
        const v = parseValues(raw.replace(/^(\D{2,60}?)(?=\s[<>≤≥]?\d)/u, '$1'));
        const lm = /^(\D{2,60}?)\s+[<>≤≥]?\d/u.exec(raw);
        if (!lm || !/\p{L}/u.test(lm[1]) || /\d{3,}/.test(lm[1]) || !v) return;
        const rest = raw.slice(lm[1].length), pv = parseValues(rest);
        if (!pv || !(pv.low != null || pv.high != null || (pv.unit && (allUnits.has(unitKey(pv.unit)) || /[\/%]/.test(pv.unit))))) return;
        if (rows.filter(r => !r.found).length < 40) rows.push({ test: '', written: lm[1].trim(), ...pv, found: false });
      });
      return rows;
    }
    // Entry point: a PDF file, or text the person got back from an AI
    function importMenu() {
      dialog(`<h3>📄 ${esc(t('hb_labs_import'))}</h3>
        <button class="hl-btn hl-primary" id="hl-ipdf">${esc(t('hb_labs_import_pdf'))}</button>
        <div class="hl-hint">${esc(t('hb_labs_import_or'))}</div>
        <div class="hl-field"><label>${esc(t('hb_labs_import_prompt_label'))}</label>
          <textarea class="hl-input" id="hl-ipr" rows="6" readonly>${esc(t('hb_labs_import_prompt'))}</textarea>
          <button class="hl-btn" id="hl-icp" style="margin-top:6px">${esc(t('hb_labs_import_copy'))}</button></div>
        <div class="hl-field"><label>${esc(t('hb_labs_import_paste'))}</label>
          <textarea class="hl-input" id="hl-itx" rows="6" placeholder="${esc(t('hb_labs_import_paste_ph'))}"></textarea></div>
        <div class="hl-err"></div>
        <div class="hl-actions"><button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ird">${esc(t('hb_labs_import_read'))}</button></div>`,
      ov => {
        ov.querySelector('#hl-ipdf').addEventListener('click', () => pickPdf());
        ov.querySelector('#hl-icp').addEventListener('click', async e => {
          const txt = t('hb_labs_import_prompt');
          try { await navigator.clipboard.writeText(txt); }
          catch (x) { const a = ov.querySelector('#hl-ipr'); a.select(); document.execCommand('copy'); }
          e.target.textContent = t('hb_labs_import_copied');
        });
        ov.querySelector('#hl-ird').addEventListener('click', () => {
          const lines = ov.querySelector('#hl-itx').value.split(/\r?\n/).map(x => x.replace(/[|*`#]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
          const rows = parseReport(lines);
          if (!rows.length) { ov.querySelector('.hl-err').textContent = t('hb_labs_import_none_text'); return; }
          importDialog(rows, findDate(lines) || st.today);
        });
      });
    }
    function pickPdf() {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/pdf,.pdf';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        dialog(`<h3>📄 ${esc(t('hb_labs_import'))}</h3><div class="hl-hint">${esc(t('hb_labs_import_reading'))}</div>`, () => { });
        try {
          const lines = await pdfLines(f), rows = parseReport(lines);
          if (!rows.length) {
            dialog(`<h3>📄 ${esc(t('hb_labs_import'))}</h3><div class="hl-empty">${esc(t('hb_labs_import_none'))}</div>
              <div class="hl-actions"><button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button></div>`, () => { });
            return;
          }
          importDialog(rows, findDate(lines) || st.today);
        } catch (e) {
          dialog(`<h3>📄 ${esc(t('hb_labs_import'))}</h3><div class="hl-empty">${esc(t('hb_labs_import_failed'))}</div>
            <div class="hl-actions"><button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button></div>`, () => { });
        }
      };
      inp.click();
    }
    function importDialog(rows, day) {
      const tests = st.labs.catalog.slice().sort((a, b) => tname(a).localeCompare(tname(b)));
      const unitsOf = k => { const x = testByKey(k); return x ? [x.base_unit].concat(Object.keys(x.units || {})) : []; };
      const nRec = rows.filter(r => r.found).length;
      rows.forEach(r => {
        const x = testByKey(r.test);
        r.on = r.found; r.u = x ? (findUnit(x, r.unit) || x.display_unit) : '';
        r.badUnit = !!(x && r.unit && !findUnit(x, r.unit));
      });
      const rowHtml = (r, i) => `<div class="hl-imp${r.found ? '' : ' hl-imp-check'}" data-i="${i}">
        <div class="hl-imp-top"><input type="checkbox" data-f="on" ${r.on ? 'checked' : ''}>
          <select class="hl-input" data-f="test"><option value="">${esc(t('hb_labs_import_choose'))}</option>${tests.map(x => `<option value="${esc(x.key)}"${x.key === r.test ? ' selected' : ''}>${esc(tname(x))}</option>`).join('')}</select></div>
        <div class="hl-hint">${esc(t('hb_labs_import_line'))}: ${esc(r.written)}${r.badUnit ? ' · ' + esc(t('hb_labs_import_unit_unknown', { unit: r.unit })) : ''}</div>
        <div class="hl-imp-grid"><input class="hl-input" data-f="value" type="number" step="any" inputmode="decimal" value="${r.value}">
          <select class="hl-input" data-f="unit">${unitsOf(r.test).map(u => `<option${u === r.u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
          <input class="hl-input" data-f="low" type="number" step="any" inputmode="decimal" placeholder="${esc(t('hb_labs_ref_low'))}" value="${r.low == null ? '' : r.low}">
          <input class="hl-input" data-f="high" type="number" step="any" inputmode="decimal" placeholder="${esc(t('hb_labs_ref_high'))}" value="${r.high == null ? '' : r.high}"></div></div>`;
      dialog(`<h3>📄 ${esc(t('hb_labs_import'))}</h3>
        <div class="hl-hint">${esc(t('hb_labs_import_found', { n: nRec, m: rows.length - nRec }))}</div>
        <div class="hl-two"><div class="hl-field"><label>${esc(t('hb_date'))}</label><input class="hl-input" id="hl-id" type="date" value="${esc(day)}"></div>
          <div class="hl-field"><label>${esc(t('hb_labs_lab'))}</label><input class="hl-input" id="hl-il" list="hl-ilabs" autocomplete="off">${labList('hl-ilabs')}</div></div>
        <div class="hl-hint">${esc(t('hb_labs_import_hint'))}</div>
        <div class="hl-imp-list">${rows.map(rowHtml).join('')}</div><div class="hl-err"></div>
        <div class="hl-actions"><button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ok"></button></div>`,
      ov => {
        const dlg = ov.querySelector('.hl-dialog'); dlg.style.maxWidth = '520px';
        const btn = ov.querySelector('#hl-ok');
        const count = () => { const n = rows.filter(r => r.on && r.test).length; btn.textContent = t('hb_labs_import_save', { n }); btn.disabled = !n; };
        count();
        ov.querySelector('.hl-imp-list').addEventListener('change', e => {
          const box = e.target.closest('.hl-imp'); if (!box) return;
          const r = rows[+box.dataset.i], f = e.target.dataset.f, val = e.target.value;
          if (f === 'on') r.on = e.target.checked;
          else if (f === 'test') {
            r.test = val; const x = testByKey(val);
            r.u = x ? (findUnit(x, r.unit) || x.display_unit) : ''; r.badUnit = !!(x && r.unit && !findUnit(x, r.unit));
            if (x) r.on = true;
            box.outerHTML = rowHtml(r, +box.dataset.i);
          } else if (f === 'unit') r.u = val;
          else r[f] = val === '' ? null : Number(val);
          count();
        });
        btn.addEventListener('click', async () => {
          const d = ov.querySelector('#hl-id').value, lab = ov.querySelector('#hl-il').value;
          if (!d) { ov.querySelector('.hl-err').textContent = t('hb_e_invalid_day'); return; }
          btn.disabled = true; let bad = 0, last = '';
          for (const r of rows.filter(x => x.on && x.test)) {
            try {
              await api('/labs/results', { method: 'POST', body: JSON.stringify({ test: r.test, value: r.value, unit: r.u, day: d, low: r.low, high: r.high, lab,
                written_name: norm(r.written) === norm(tname(testByKey(r.test))) ? '' : r.written }) });
              last = r.test;
            } catch (e) { bad++; r.on = true; }
          }
          if (bad) { ov.querySelector('.hl-err').textContent = t('hb_labs_import_partial', { n: bad }); btn.disabled = false; }
          else { closeDialog(); st.tab = 'labs'; st.labs.test = null; await refresh(); }
        });
      });
    }


    function render() {
      const scroll = w.querySelector('.hl-body')?.scrollTop || 0;
      w.innerHTML = `
        <div class="hl-bar"><div class="hl-tabs">${[{ id: 'overview' }].concat(st.groups, [{ id: 'labs' }]).map(x => `<button class="hl-btn${st.tab === x.id ? ' on' : ''}" data-act="tab" data-tab="${x.id}">${esc(t(x.id === 'overview' ? 'hb_overview' : 'hb_group_' + x.id))}</button>`).join('')}</div>
          <button class="hl-btn" data-act="settings" title="${esc(t('hb_settings'))}">⚙</button></div>
        <div class="hl-body">${st.error ? `<div class="hl-err">${esc(st.error)}</div>` : ''}${st.ready ? (st.tab === 'overview' ? overviewView() : st.tab === 'labs' ? labsView() : detailView()) : ''}</div>`;
      const b = w.querySelector('.hl-body'); if (b) b.scrollTop = scroll;
    }

    // ── Dialogs ────────────────────────────────────────────────────
    function dialog(html, onMount) {
      closeDialog();
      const ov = document.createElement('div');
      ov.className = 'hl-overlay';
      ov.innerHTML = `<div class="hl-dialog">${html}</div>`;
      ov.addEventListener('mousedown', e => { if (e.target === ov) closeDialog(); });
      w.appendChild(ov);
      ov.querySelector('[data-close]')?.addEventListener('click', closeDialog);
      onMount(ov);
      ov.querySelector('input')?.focus();
    }
    function closeDialog() { w.querySelector('.hl-overlay')?.remove(); }
    function fail(ov, e) {
      const k = e && e.message && t('hb_e_' + e.message) !== 'hb_e_' + e.message ? 'hb_e_' + e.message : 'hb_error';
      ov.querySelector('.hl-err').textContent = t(k);
    }
    const val = (ov, id) => ov.querySelector(id).value;

    function readingDialog(existing) {
      const m = existing ? existing.metric : curMetric(), now = new Date();
      const at = existing ? existing.at : ymd(now) + 'T' + hm(now);
      const v = existing ? existing.v : [null, null, null];
      const one = (id, label, x) => `<div class="hl-field"><label>${esc(label)}</label><input class="hl-input" id="${id}" type="number" step="any" inputmode="decimal" value="${x == null ? '' : esc(x)}"></div>`;
      const fields = m === 'bp'
        ? `<div class="hl-two">${one('hl-v1', t('hb_systolic') + ' (mmHg)', v[0])}${one('hl-v2', t('hb_diastolic') + ' (mmHg)', v[1])}</div>${one('hl-v3', t('hb_pulse') + ' (bpm) · ' + t('hb_optional'), v[2])}`
        : one('hl-v1', t('hb_m_weight') + ' (' + unitOf('weight') + ')', v[0] == null ? null : rnd(dispVal('weight', v[0]), 1));
      dialog(`<h3>${iconOf(m)} ${esc(t('hb_m_' + m))}</h3>${fields}
        <div class="hl-two"><div class="hl-field"><label>${esc(t('hb_date'))}</label><input class="hl-input" id="hl-d" type="date" value="${esc(at.slice(0, 10))}"></div>
        <div class="hl-field"><label>${esc(t('hb_time'))}</label><input class="hl-input" id="hl-tm" type="time" value="${esc(at.slice(11, 16))}"></div></div>
        <div class="hl-field"><label>${esc(t('hb_note'))}</label><input class="hl-input" id="hl-note" maxlength="500" value="${esc(existing ? existing.note : '')}"></div>
        <div class="hl-err"></div>
        <div class="hl-actions">${existing ? `<button class="hl-btn hl-del" id="hl-del">${esc(t('hb_delete'))}</button>` : ''}<button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ok">${esc(t('hb_save'))}</button></div>`,
      ov => {
        ov.querySelector('#hl-ok').addEventListener('click', async () => {
          const nums = ['#hl-v1', '#hl-v2', '#hl-v3'].map(id => ov.querySelector(id)).filter(Boolean).map(el => el.value === '' ? null : Number(el.value));
          if (m === 'weight' && nums[0] != null) nums[0] = rnd(fromDisp('weight', nums[0]), 2);
          const day = val(ov, '#hl-d'), time = val(ov, '#hl-tm');
          if (!day || !time) { ov.querySelector('.hl-err').textContent = t('hb_e_invalid_time'); return; }
          const body = JSON.stringify({ metric: m, values: nums, at: day + 'T' + time, note: val(ov, '#hl-note') });
          try {
            if (existing) await api('/readings/' + existing.id, { method: 'PUT', body }); else await api('/readings', { method: 'POST', body });
            closeDialog(); refresh();
          } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hl-del')?.addEventListener('click', async () => {
          if (!confirm(t('hb_confirm_delete'))) return;
          try { await api('/readings/' + existing.id, { method: 'DELETE' }); closeDialog(); refresh(); } catch (e) { fail(ov, e); }
        });
      });
    }

    function dayDialog(day) {
      const m = curMetric(), p = st.series.points.find(x => x.day === day);
      const manual = p ? p.sources.find(x => x.source === 'manual') : null;
      const others = p ? p.sources.filter(x => x.source !== 'manual') : [];
      const digits = m === 'water' && oz() ? 1 : 0;
      dialog(`<h3>${iconOf(m)} ${esc(t('hb_m_' + m))}</h3>
        <div class="hl-field"><label>${esc(t('hb_date'))}</label><input class="hl-input" id="hl-d" type="date" value="${esc(day || st.today)}" max="${esc(st.today)}"></div>
        ${others.length ? `<div class="hl-hint">${esc(others.map(x => (x.name || x.source) + ' ' + num(m, x.value)).join(' · '))}</div>` : ''}
        <div class="hl-field"><label>${esc(t('hb_amount_by_hand'))} (${esc(unitOf(m))})</label><input class="hl-input" id="hl-v1" type="number" min="0" step="any" inputmode="decimal" value="${manual ? rnd(dispVal(m, manual.value), digits + 1) : ''}"></div>
        <div class="hl-hint">${esc(t('hb_daily_hint'))}</div><div class="hl-err"></div>
        <div class="hl-actions">${manual ? `<button class="hl-btn hl-del" id="hl-del">${esc(t('hb_delete'))}</button>` : ''}<button class="hl-btn" data-close>${esc(t('hb_cancel'))}</button><button class="hl-btn hl-primary" id="hl-ok">${esc(t('hb_save'))}</button></div>`,
      ov => {
        ov.querySelector('#hl-ok').addEventListener('click', async () => {
          const d = val(ov, '#hl-d'), n = Number(val(ov, '#hl-v1'));
          if (!d || !(n > 0)) { ov.querySelector('.hl-err').textContent = t('hb_e_invalid_value'); return; }
          try {
            await api('/daily', { method: 'PUT', body: JSON.stringify({ metric: m, day: d, value: rnd(fromDisp(m, n), 2) }) });
            closeDialog(); refresh();
          } catch (e) { fail(ov, e); }
        });
        ov.querySelector('#hl-del')?.addEventListener('click', async () => {
          if (!confirm(t('hb_confirm_delete'))) return;
          try { await api('/daily?metric=' + m + '&day=' + encodeURIComponent(day), { method: 'DELETE' }); closeDialog(); refresh(); } catch (e) { fail(ov, e); }
        });
      });
    }

    function settingsDialog() {
      const sel = (id, label, opts2, cur) => `<div class="hl-field"><label>${esc(label)}</label><select class="hl-input" id="${id}">${opts2.map(o => `<option value="${o}"${cur === o ? ' selected' : ''}>${o}</option>`).join('')}</select></div>`;
      dialog(`<h3>${esc(t('hb_settings'))}</h3>${sel('hl-wu', t('hb_weight_unit'), ['kg', 'lb'], st.settings.weight_unit)}${sel('hl-vu', t('hb_volume_unit'), ['ml', 'oz'], st.settings.volume_unit)}
        <div class="hl-err"></div><div class="hl-actions"><button class="hl-btn" data-close>${esc(t('hb_close'))}</button></div>`,
      ov => {
        const save = async () => {
          try {
            st.settings = await api('/settings', { method: 'PUT', body: JSON.stringify({ weight_unit: val(ov, '#hl-wu'), volume_unit: val(ov, '#hl-vu') }) });
            render(); w.querySelector('.hl-overlay') || 0;
          } catch (e) { fail(ov, e); }
        };
        ov.querySelector('#hl-wu').addEventListener('change', async () => { await save(); settingsDialog(); });
        ov.querySelector('#hl-vu').addEventListener('change', async () => { await save(); settingsDialog(); });
      });
    }

    // ── Events ─────────────────────────────────────────────────────
    w.addEventListener('click', async e => {
      const el = e.target.closest('[data-act]');
      if (!el || !w.contains(el)) return;
      const act = el.dataset.act;
      if (act === 'tab') { st.labs.test = null; openTab(el.dataset.tab); await refresh(); }
      else if (act === 'labopen') { st.tab = 'labs'; st.labs.test = el.dataset.k; st.series = null; st.sel = null; await refresh(); }
      else if (act === 'labback') { st.labs.test = null; await refresh(); }
      else if (act === 'labadd') labResultDialog(null, el.dataset.k || (st.labs.test || ''));
      else if (act === 'labedit') { const r = st.labs.detail.results.find(x => x.id === el.dataset.id); if (r) labResultDialog(r, r.test); }
      else if (act === 'labimport') importMenu();
      else if (act === 'labtest') labTestDialog(el.dataset.k || null);
      else if (act === 'labpt') { st.sel = Number(el.dataset.i); render(); }
      else if (act === 'open') {
        const id = el.dataset.m;
        openTab(groupOf(id).id, id); await refresh();
      }
      else if (act === 'sub') { openTab(st.tab, el.dataset.m); await refresh(); }
      else if (act === 'range') { st.range = Number(el.dataset.n); await refresh(); }
      else if (act === 'pt') { st.sel = Number(el.dataset.i); render(); }
      else if (act === 'add') { if (st.series.kind === 'reading') readingDialog(); else dayDialog(null); }
      else if (act === 'editreading') { const p = st.series.points.find(x => x.id === el.dataset.id); if (p) readingDialog(p); }
      else if (act === 'editday') dayDialog(el.dataset.day);
      else if (act === 'settings') settingsDialog();
    });

    // A new calendar day starts by itself when the page is left open overnight.
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      st.today = ymd(new Date());
      if (st.ready && !w.querySelector('.hl-overlay')) refresh();
    }
    document.addEventListener('visibilitychange', onVisible);
    const onLang = () => render();
    if (window.mvmOS && window.mvmOS.onLangChange) window.mvmOS.onLangChange(onLang);

    (async () => {
      try {
        const [, me] = await Promise.all([loadRegional(token), api('/me')]);
        st.settings = me.settings; st.ready = true;
        (me.metrics || []).forEach(m => {
          let g = st.groups.find(x => x.id === m.group);
          if (!g) st.groups.push(g = { id: m.group, metrics: [] });
          g.metrics.push(m.id);
        });
        await loadOverview();
      } catch (e) { st.error = t('hb_error'); }
      render();
    })();

    return { destroy() { document.removeEventListener('visibilitychange', onVisible); } };
  }

  window.HealthWidget = { mount };
})();
