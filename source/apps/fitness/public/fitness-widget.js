// Fitness — widget shared by the desktop app window and the standalone
// Apps Hub public page (same pattern as apps/nutrition).
(function () {
  if (window.FitnessWidget) return;

  const API = '/pub/fitness';
  const TYPES = ['weight_reps', 'reps', 'time', 'distance', 'cardio'];
  const MUSCLES = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'quads', 'hamstrings', 'glutes', 'calves', 'full_body', 'cardio'];
  const EQUIP = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'bands', 'cardio_machine', 'none'];
  const MUSCLE_COLOR = { chest: '#f38ba8', back: '#89b4fa', shoulders: '#fab387', biceps: '#a6e3a1', triceps: '#94e2d5', forearms: '#b4befe',
    abs: '#f9e2af', quads: '#cba6f7', hamstrings: '#f5c2e7', glutes: '#eba0ac', calves: '#74c7ec', full_body: '#fab387', cardio: '#a6e3a1' };
  const KG_LB = 2.20462262, KM_MI = 0.621371192;
  // Regions that measure in pounds and miles: the United States and its
  // territories, Liberia and Myanmar. Read from the mvmOS time zone.
  const IMPERIAL_TZ = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Adak|Detroit|Boise|Juneau|Sitka|Nome|Yakutat|Metlakatla|Menominee|Indiana\/.*|Kentucky\/.*|North_Dakota\/.*|Puerto_Rico|St_Thomas|Virgin)|Pacific\/(Honolulu|Guam|Saipan|Pago_Pago)|US\/.*|Africa\/Monrovia|Asia\/Yangon|Asia\/Rangoon|EST|MST|HST|EST5EDT|CST6CDT|MST7MDT|PST8PDT)$/;
  const GOALS = { general: 'general fitness', strength: 'get stronger', muscle: 'build muscle', fatloss: 'lose fat', endurance: 'improve endurance' };

  function t(key, vars) { return (window.t || (k => k))(key, vars); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const pad2 = n => String(n).padStart(2, '0');
  const rnd = (v, d) => { const k = Math.pow(10, d || 0); return Math.round((Number(v) || 0) * k) / k; };
  const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; };
  const P = () => (window.mvmOS && window.mvmOS.dateTimePicker) || null;

  // ── Regional formats: units, dates, clock, week start ──────────
  function pickerSettings() { const p = P(); try { return (p && p.settings && p.settings()) || {}; } catch (e) { return {}; } }
  function imperial() {
    const tz = pickerSettings().timeZone || (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
    return IMPERIAL_TZ.test(tz);
  }
  const wd = kg => (imperial() ? kg * KG_LB : kg);
  const wk = v => rnd(imperial() ? v / KG_LB : v, 3);
  const dd = km => (imperial() ? km * KM_MI : km);
  const dk = v => rnd(imperial() ? v / KM_MI : v, 4);
  const wU = () => (imperial() ? 'lb' : 'kg');
  const dU = () => (imperial() ? 'mi' : 'km');
  const fnum = (v, d) => String(rnd(v, d == null ? 1 : d));
  const fW = kg => fnum(wd(kg), 1) + ' ' + wU();
  const fDist = km => fnum(dd(km), 2) + ' ' + dU();
  const fBig = v => Math.round(v).toLocaleString(window.mvmOS && window.mvmOS.lang || 'en');
  const fVol = kg => fBig(wd(kg)) + ' ' + wU();
  function fDur(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`;
  }
  function fDurLong(s) {
    const m = Math.round((Number(s) || 0) / 60);
    return m >= 60 ? `${Math.floor(m / 60)} ${t('fi_h')} ${m % 60} ${t('fi_min')}` : `${m} ${t('fi_min')}`;
  }
  function parseDur(v, type) {
    v = String(v == null ? '' : v).trim();
    if (!v) return 0;
    if (v.indexOf(':') >= 0) {
      const p = v.split(':').map(num);
      return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    }
    return num(v) * (type === 'time' ? 1 : 60);
  }
  function fPace(secPerKm) {
    if (!secPerKm) return '–';
    const per = imperial() ? secPerKm / KM_MI : secPerKm;
    return fDur(per) + '/' + dU();
  }
  function nowStr() {
    const p = P();
    if (p) { try { const v = p.fromEpoch(Date.now() / 1000, { type: 'datetime' }); if (v) return v; } catch (e) {} }
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const todayStr = () => nowStr().slice(0, 10);
  function fDate(day) {
    const p = P();
    return (p && p.format(day, { type: 'date' })) || day;
  }
  function fClock(v) {
    const p = P();
    return (p && p.format(v, { type: 'time' })) || String(v).slice(11, 16);
  }
  function shiftDay(day, delta) {
    const [y, m, d] = day.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d + delta));
    return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
  }
  const weekdayOf = day => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const weekStartsMonday = () => (pickerSettings().weekStarts || 'monday') !== 'sunday';
  function weekdayName(i) {
    return new Intl.DateTimeFormat(window.mvmOS && window.mvmOS.lang || 'en', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + i)));
  }
  // The weekday numbers (0 = Sunday) in the order the week is shown.
  const weekOrder = () => (weekStartsMonday() ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]);
  function monthLabel(day) {
    const [y, m] = day.split('-').map(Number);
    return new Intl.DateTimeFormat(window.mvmOS && window.mvmOS.lang || 'en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  }

  function beep() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.35);
      setTimeout(() => ctx.close && ctx.close(), 600);
    } catch (e) {}
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
  }

  function injectStyles() {
    if (document.getElementById('fi-styles')) return;
    const style = document.createElement('style');
    style.id = 'fi-styles';
    style.textContent = `
      .fi-widget{height:100%;display:flex;flex-direction:column;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);
        font-family:system-ui,sans-serif;position:relative;box-sizing:border-box}
      .fi-widget *{box-sizing:border-box}
      .fi-login{display:flex;align-items:center;justify-content:center;height:100%;color:var(--pub-fg2,#a6adc8)}
      .fi-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--pub-surface2,#313244);flex-shrink:0}
      .fi-tabs{display:flex;gap:4px;flex:1;flex-wrap:wrap}
      .fi-btn{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:none;border-radius:6px;padding:7px 12px;cursor:pointer;font-size:.85rem;min-height:34px;font-family:inherit}
      .fi-btn:hover{background:var(--pub-border,#45475a)}
      .fi-tabs .fi-btn{flex:1 1 0;padding:7px 4px;white-space:nowrap;font-size:.8rem;min-width:0;overflow:hidden;text-overflow:ellipsis}
      .fi-btn:disabled{opacity:.4;cursor:default}
      .fi-btn.on,.fi-btn.main{background:var(--pub-accent,#89b4fa);color:var(--on-accent,var(--pub-bg,#1e1e2e));font-weight:600}
      .fi-btn.danger{color:var(--pub-red,#f38ba8)}
      .fi-btn.big{min-height:46px;font-size:1rem;padding:10px 18px}
      .fi-body{flex:1;overflow-y:auto;padding:14px 14px 90px;display:flex;flex-direction:column;gap:14px}
      .fi-card{background:var(--pub-surface2,#313244);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px}
      .fi-exercise-3d{width:100%;max-width:480px;aspect-ratio:6/5;align-self:center;background:#192533;border-radius:10px;overflow:hidden;touch-action:pan-y;cursor:grab}
      .fi-exercise-3d canvas{display:block;width:100%;height:100%}
      .fi-3d-unavailable{display:none}
      .fi-card .fi-in{background:var(--pub-bg,#1e1e2e)}
      .fi-h{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--pub-fg2,#a6adc8)}
      .fi-hint{font-size:.8rem;color:var(--pub-fg2,#a6adc8);line-height:1.35}
      .fi-err{color:var(--pub-red,#f38ba8);font-size:.82rem}
      .fi-ok{color:var(--pub-green,#a6e3a1)}
      .fi-top{display:flex;align-items:center;gap:10px}
      .fi-title{flex:1;min-width:0;font-weight:600;font-size:1.05rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .fi-row{display:flex;align-items:center;gap:10px}
      .fi-grow{flex:1;min-width:0}
      .fi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
      .fi-stat{background:var(--pub-surface2,#313244);border-radius:10px;padding:10px 12px}
      .fi-stat b{display:block;font-size:1.35rem;line-height:1.2}
      .fi-stat span{font-size:.74rem;color:var(--pub-fg2,#a6adc8)}
      .fi-input,.fi-in{width:100%;background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:9px 10px;font-size:.92rem;min-height:40px;font-family:inherit}
      textarea.fi-in{min-height:64px;resize:vertical}
      .fi-field{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
      .fi-field>label{font-size:.78rem;color:var(--pub-fg2,#a6adc8)}
      .fi-field>label::first-letter{text-transform:uppercase}
      .fi-fields{display:flex;flex-wrap:wrap;gap:8px}
      .fi-fields .fi-field{flex:1 1 90px}
      .fi-chips{display:flex;flex-wrap:wrap;gap:6px}
      .fi-chip{background:var(--pub-surface2,#313244);color:var(--pub-fg,#cdd6f4);border:2px solid transparent;border-radius:20px;padding:6px 12px;min-height:34px;cursor:pointer;font-size:.84rem;font-family:inherit}
      .fi-chip:hover{background:var(--pub-border,#45475a)}
      .fi-chip.sel{border-color:var(--pub-accent,#89b4fa)}
      .fi-card .fi-chip{background:var(--pub-bg,#1e1e2e)}
      .fi-check{display:flex;align-items:center;gap:10px;font-size:.9rem;min-height:38px;cursor:pointer}
      .fi-check input{width:20px;height:20px}
      .fi-item{display:flex;align-items:center;gap:10px;background:var(--pub-surface2,#313244);border-radius:8px;padding:10px 12px;cursor:pointer;min-height:48px;width:100%;text-align:left;border:none;color:inherit;font:inherit}
      .fi-item:hover{background:var(--pub-border,#45475a)}
      .fi-item .fi-sub{font-size:.76rem;color:var(--pub-fg2,#a6adc8)}
      .fi-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
      .fi-pr{display:inline-flex;align-items:center;gap:3px;font-size:.72rem;padding:1px 7px;border-radius:9px;background:var(--pub-yellow,#f9e2af);color:#1e1e2e;font-weight:600;white-space:nowrap}
      .fi-badge{font-size:.7rem;padding:1px 7px;border-radius:9px;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg2,#a6adc8)}
      .fi-week{display:flex;gap:6px;justify-content:space-between}
      .fi-wd{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:.72rem;color:var(--pub-fg2,#a6adc8)}
      .fi-wd i{width:26px;height:26px;border-radius:50%;border:2px solid var(--pub-border,#45475a);display:flex;align-items:center;justify-content:center;font-style:normal;font-size:.8rem}
      .fi-wd.plan i{border-color:var(--pub-accent,#89b4fa)}
      .fi-wd.done i{background:var(--pub-green,#a6e3a1);border-color:var(--pub-green,#a6e3a1);color:#1e1e2e}
      .fi-wd.today b{color:var(--pub-fg,#cdd6f4)}
      .fi-track{position:relative;height:10px;border-radius:5px;background:var(--pub-bg,#1e1e2e);overflow:hidden}
      .fi-fill{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:var(--pub-accent,#89b4fa)}
      .fi-ex{background:var(--pub-surface2,#313244);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px}
      .fi-exhead{display:flex;align-items:center;gap:8px}
      .fi-exname{flex:1;min-width:0;font-weight:600;cursor:pointer}
      .fi-last{font-size:.76rem;color:var(--pub-fg2,#a6adc8)}
      .fi-set{display:flex;align-items:center;gap:6px;padding:4px 0;border-radius:8px}
      .fi-set.cur{background:color-mix(in srgb,var(--pub-accent,#89b4fa) 14%,transparent);outline:1px solid color-mix(in srgb,var(--pub-accent,#89b4fa) 50%,transparent)}
      .fi-set.done{opacity:.85}
      .fi-kind{width:34px;height:34px;border-radius:50%;border:none;background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);cursor:pointer;font-weight:600;flex-shrink:0;font-family:inherit}
      .fi-set .fi-cell{flex:1;min-width:0;display:flex;flex-direction:column}
      .fi-set .fi-cell input{background:var(--pub-bg,#1e1e2e);color:var(--pub-fg,#cdd6f4);border:1px solid var(--pub-border,#45475a);border-radius:6px;padding:7px 6px;min-height:38px;width:100%;text-align:center;font-size:.95rem;font-family:inherit}
      .fi-set .fi-cell small{font-size:.66rem;color:var(--pub-fg2,#a6adc8);text-align:center}
      .fi-tick{width:38px;height:38px;border-radius:8px;border:2px solid var(--pub-border,#45475a);background:none;color:var(--pub-fg,#cdd6f4);cursor:pointer;font-size:1.1rem;flex-shrink:0}
      .fi-set.done .fi-tick{background:var(--pub-green,#a6e3a1);border-color:var(--pub-green,#a6e3a1);color:#1e1e2e}
      .fi-x{background:none;border:none;color:var(--pub-fg2,#a6adc8);cursor:pointer;font-size:1.1rem;width:26px;flex-shrink:0}
      .fi-bottom{position:absolute;left:0;right:0;bottom:0;background:var(--pub-surface2,#313244);border-top:1px solid var(--pub-border,#45475a);padding:10px 12px;display:flex;align-items:center;gap:10px;z-index:3}
      .fi-bottom b{font-size:1.5rem;min-width:70px}
      .fi-modal{position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:6;display:flex;align-items:flex-end;justify-content:center}
      .fi-sheet{background:var(--pub-bg,#1e1e2e);width:100%;max-width:560px;max-height:92%;overflow-y:auto;border-radius:14px 14px 0 0;padding:14px;display:flex;flex-direction:column;gap:12px}
      .fi-toast{position:absolute;left:12px;right:12px;top:58px;z-index:7;background:var(--pub-yellow,#f9e2af);color:#1e1e2e;border-radius:10px;padding:10px 12px;font-weight:600;font-size:.9rem}
      .fi-chart{width:100%;height:auto;display:block}
      .fi-chart text{fill:var(--pub-fg2,#a6adc8);font-size:10px}
      .fi-pill{display:inline-flex;gap:6px;flex-wrap:wrap}
      .fi-tbl{width:100%;border-collapse:collapse;font-size:.86rem}
      .fi-tbl td,.fi-tbl th{padding:5px 6px;text-align:left;border-bottom:1px solid var(--pub-border,#45475a)}
      .fi-tbl th{font-weight:500;color:var(--pub-fg2,#a6adc8);font-size:.76rem}
      .fi-heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,1fr);gap:3px}
      .fi-heat i{width:100%;aspect-ratio:1;border-radius:3px;background:var(--pub-bg,#1e1e2e)}
      .fi-heat i.on{background:var(--pub-green,#a6e3a1)}
      .fi-heat i.fut{visibility:hidden}
    `;
    document.head.appendChild(style);
  }

  function mount(root, opts) {
    opts = opts || {};
    injectStyles();
    const token = localStorage.getItem('apphub_token');
    root.innerHTML = '<div class="fi-widget"></div>';
    const w = root.firstChild;
    if (!token) {
      w.innerHTML = `<div class="fi-login">${esc(t('fi_login_required'))}</div>`;
      if (opts.onNeedLogin) opts.onNeedLogin(root);
      return { destroy() {} };
    }

    const st = {
      tab: 'today', view: 'main', sub: 'overview', ready: false, error: '', toast: '',
      me: null, ready_ex: [], exMap: {}, active: null, stats: null, statsDays: 90, chartMetric: 'sessions',
      history: null, records: null, detail: null, exDetail: null, exChart: 'e1rm', exFilter: { q: '', muscle: '', equip: '' },
      tpl: null, picker: null, exForm: null, finish: null, summary: null, timer: null, aiPlan: null, aiReview: null, msg: '', today: null,
      others: null,
    };
    let tick = null, dead = false, pickerHandle = null, toastTimer = null, disposeExercise3D = null;

    function api(path, o) {
      o = o || {};
      const headers = Object.assign({ 'X-Pub-Token': token, 'Content-Type': 'application/json' }, o.headers || {});
      return fetch(API + path, Object.assign({}, o, { headers })).then(async r => {
        if (r.status === 401 && opts.onNeedLogin) opts.onNeedLogin(root);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error(data.error || ('http_' + r.status)); e.status = r.status; e.data = data; throw e; }
        return data;
      });
    }
    const send = (method, path, body) => api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const lang = () => window.mvmOS && window.mvmOS.lang || 'en';
    const errText = e => { const k = 'fi_err_' + (e && e.message); const v = t(k); return v && v !== k ? v : t('fi_error'); };

    // ── Exercises ────────────────────────────────────────────────
    function indexExercises() {
      st.exMap = {};
      st.ready_ex.concat(st.me ? st.me.custom : []).forEach(e => { st.exMap[e.ref] = e; });
    }
    function exName(refOrEx, fallback) {
      const e = typeof refOrEx === 'string' ? st.exMap[refOrEx] : refOrEx;
      const ref = typeof refOrEx === 'string' ? refOrEx : (e && e.ref);
      if (ref && ref.startsWith('r:')) { const k = 'fi_x_' + ref.slice(2), v = t(k); if (v && v !== k) return v; }
      return (e && e.name) || fallback || ref || '';
    }
    const exOf = ref => st.exMap[ref] || { ref, name: ref, type: 'weight_reps', muscle: 'full_body', equip: 'none' };
    const typeOf = ref => exOf(ref).type;
    const mTxt = m => t('fi_m_' + m);

    // ── Showing one set's numbers ────────────────────────────────
    function setText(type, s) {
      if (type === 'weight_reps') return (s.weight ? fnum(wd(s.weight), 1) : '–') + '×' + fnum(s.reps, 0);
      if (type === 'reps') return fnum(s.reps, 0) + '×';
      if (type === 'time') return fDur(s.secs);
      if (type === 'distance') return fnum(dd(s.dist), 2) + ' ' + dU() + ' · ' + fDur(s.secs);
      return fDur(s.secs) + (s.dist ? ' · ' + fnum(dd(s.dist), 2) + ' ' + dU() : '');
    }
    const prLabel = k => t('fi_rec_' + k);
    const prBadges = prs => (prs && prs.length ? `<span class="fi-pr" title="${esc(prs.map(prLabel).join(', '))}">🏆 ${esc(prs.map(prLabel).join(', '))}</span>` : '');

    // ── Data loading ─────────────────────────────────────────────
    async function loadStats(days) {
      st.statsDays = days || st.statsDays;
      st.stats = await api(`/stats?days=${st.statsDays}&today=${todayStr()}&week_start=${weekStartsMonday() ? 1 : 0}`);
    }
    async function loadActive() {
      const r = await api('/sessions/active');
      st.active = r.session;
    }
    async function loadDay() {
      st.today = todayStr();
      const r = await api(`/sessions?start=${st.today}&end=${st.today}`);
      st.daySessions = r.sessions;
      st.others = r.other && r.other[st.today] ? r.other[st.today] : null;
    }
    async function init() {
      try {
        const pk = P();
        if (pk && pk.ready) await pk.ready();
        const [me, cat] = await Promise.all([api('/me'), api('/catalog')]);
        st.me = me; st.ready_ex = cat.ready; indexExercises();
        await Promise.all([loadActive(), loadStats(90).catch(() => {}), loadDay()]);
        st.ready = true;
        if (st.active) { st.view = 'workout'; }
      } catch (e) { st.error = errText(e); st.ready = true; }
      render();
    }

    // ── Rendering helpers ────────────────────────────────────────
    function exerciseLine(e) {
      return `${esc(exName(e))} <span class="fi-sub">· ${esc(mTxt(e.muscle))} · ${esc(t('fi_type_' + e.type))}</span>`;
    }
    function targetText(it) {
      const ty = it.type || typeOf(it.ex_ref);
      const parts = [`${it.sets}×`];
      if (ty === 'weight_reps') parts.push(`${fnum(it.reps, 0) || '?'}${it.weight ? ' @ ' + fW(it.weight) : ''}`);
      else if (ty === 'reps') parts.push(`${fnum(it.reps, 0) || '?'}`);
      else if (ty === 'time') parts.push(fDur(it.secs));
      else if (ty === 'distance') parts.push(`${it.dist ? fnum(dd(it.dist), 2) + ' ' + dU() : ''} ${it.secs ? fDur(it.secs) : ''}`.trim());
      else parts.push(`${it.secs ? fDur(it.secs) : ''}${it.dist ? ' ' + fnum(dd(it.dist), 2) + ' ' + dU() : ''}`.trim());
      return parts.join(' ');
    }
    function shortRec(r) {
      const b = r.best || {};
      if (r.type === 'weight_reps') return b.weight ? `${fW(b.weight.value)} · 1RM ≈ ${fW(b.e1rm ? b.e1rm.value : b.weight.value)}` : '';
      if (r.type === 'reps') return b.reps ? `${fnum(b.reps.value, 0)} ${t('fi_reps')}` : '';
      if (r.type === 'time') return b.time ? fDur(b.time.value) : '';
      return [b.dist ? fDist(b.dist.value) : '', b.pace ? fPace(b.pace.value) : '', b.time ? fDur(b.time.value) : ''].filter(Boolean).join(' · ');
    }

    // Charts ------------------------------------------------------
    function lineChart(points, fmt) {
      // points: [{label, value}]
      if (points.length < 2) return `<div class="fi-hint">${esc(t('fi_chart_more'))}</div>`;
      const W = 320, H = 130, pl = 8, pr = 8, pt = 14, pb = 22;
      const vals = points.map(p => p.value), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      const span = hi - lo || 1;
      const x = i => pl + (W - pl - pr) * (points.length === 1 ? 0.5 : i / (points.length - 1));
      const y = v => pt + (H - pt - pb) * (1 - (v - lo) / span);
      const path = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1)).join(' ');
      const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="var(--pub-accent,#89b4fa)"/>`).join('');
      const bi = vals.indexOf(hi);
      return `<svg class="fi-chart" viewBox="0 0 ${W} ${H}"><path d="${path}" fill="none" stroke="var(--pub-accent,#89b4fa)" stroke-width="2"/>${dots}
        <text x="${Math.min(W - 40, Math.max(4, x(bi) - 14))}" y="${Math.max(10, y(hi) - 6)}">${esc(fmt(hi))}</text>
        <text x="${pl}" y="${H - 6}">${esc(points[0].label)}</text><text x="${W - pr}" y="${H - 6}" text-anchor="end">${esc(points[points.length - 1].label)}</text></svg>`;
    }
    function barChart(items, fmt) {
      // items: [{label, value}]
      if (!items.length) return `<div class="fi-hint">${esc(t('fi_chart_more'))}</div>`;
      const W = 320, H = 130, pl = 6, pb = 22, pt = 14, n = items.length;
      const hi = Math.max.apply(null, items.map(i => i.value)) || 1;
      const bw = (W - pl * 2) / n;
      const bars = items.map((it, i) => {
        const h = (H - pt - pb) * (it.value / hi);
        const x = pl + i * bw;
        return `<rect x="${(x + bw * 0.15).toFixed(1)}" y="${(H - pb - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}" rx="2" fill="var(--pub-accent,#89b4fa)"/>`;
      }).join('');
      return `<svg class="fi-chart" viewBox="0 0 ${W} ${H}">${bars}
        <text x="${pl}" y="${H - 6}">${esc(items[0].label)}</text><text x="${W - pl}" y="${H - 6}" text-anchor="end">${esc(items[n - 1].label)}</text>
        <text x="${W - pl}" y="10" text-anchor="end">${esc(fmt(hi))}</text></svg>`;
    }
    function shortDay(day) {
      const [y, m, d] = day.split('-');
      const f = (pickerSettings().dateFormat || 'DD/MM/YYYY');
      return f.indexOf('MM/DD') === 0 ? `${m}/${d}` : f.indexOf('YYYY') === 0 ? `${m}-${d}` : `${d}/${m}`;
    }

    // ── Top bar ──────────────────────────────────────────────────
    function topbar() {
      const tabs = [['today', 'fi_tab_today'], ['workouts', 'fi_tab_workouts'], ['exercises', 'fi_tab_exercises'], ['progress', 'fi_tab_progress'], ['settings', 'fi_tab_settings']];
      return `<div class="fi-bar"><div class="fi-tabs">${tabs.map(([k, l]) =>
        `<button class="fi-btn${st.tab === k && st.view === 'main' ? ' on' : ''}" data-act="tab" data-tab="${k}">${esc(t(l))}</button>`).join('')}</div></div>`;
    }

    // ── Today ────────────────────────────────────────────────────
    function weekStrip() {
      const s = st.stats; if (!s) return '';
      const days = new Set(s.session_days || []);
      const today = todayStr(), wdToday = weekdayOf(today);
      const order = weekOrder();
      const startOff = order.indexOf(wdToday);
      const plan = new Set();
      st.me.templates.forEach(tp => tp.days.forEach(d => plan.add(d)));
      return `<div class="fi-week">${order.map((d, i) => {
        const day = shiftDay(today, i - startOff);
        const done = days.has(day) || (day === today && (st.daySessions || []).length);
        return `<div class="fi-wd${done ? ' done' : ''}${plan.has(d) ? ' plan' : ''}${day === today ? ' today' : ''}"><b>${esc(weekdayName(d))}</b><i>${done ? '✓' : ''}</i></div>`;
      }).join('')}</div>`;
    }
    function viewToday() {
      const s = st.stats, tp = st.me.templates, wdToday = weekdayOf(todayStr());
      const planned = tp.filter(x => x.days.includes(wdToday));
      const doneToday = st.daySessions || [];
      let out = '';
      if (st.active) {
        out += `<div class="fi-card"><div class="fi-h">${esc(t('fi_active'))}</div>
          <div class="fi-row"><div class="fi-grow"><b>${esc(st.active.name || t('fi_workout'))}</b><div class="fi-hint">${st.active.done_sets}/${st.active.sets.length} ${esc(t('fi_sets'))}</div></div>
          <button class="fi-btn main big" data-act="resume">${esc(t('fi_continue'))}</button></div></div>`;
      }
      if (s) {
        const pct = Math.min(100, Math.round(100 * s.week_sessions / (s.week_goal || 1)));
        out += `<div class="fi-card"><div class="fi-row"><div class="fi-grow"><b>${esc(t('fi_week_goal', { n: s.week_sessions, goal: s.week_goal }))}</b></div>
          <span class="fi-badge">🔥 ${s.streak_weeks} ${esc(t('fi_weeks'))} · ${s.streak_days} ${esc(t('fi_days'))}</span></div>
          <div class="fi-track"><div class="fi-fill" style="width:${pct}%"></div></div>${weekStrip()}</div>`;
      }
      if (!st.active) {
        if (planned.length) {
          out += `<div class="fi-h">${esc(t('fi_planned_today'))}</div>` + planned.map(x => `<div class="fi-card"><div class="fi-row"><div class="fi-grow"><b>${esc(x.name)}</b>
            <div class="fi-hint">${x.items.length} ${esc(t('fi_exercises_n'))} · ${esc(x.items.slice(0, 3).map(i => exName(i.ex_ref, i.name)).join(', '))}${x.items.length > 3 ? '…' : ''}</div></div>
            <button class="fi-btn main" data-act="start-tpl" data-id="${esc(x.id)}">${esc(t('fi_start'))}</button></div></div>`).join('');
        }
        out += `<div class="fi-row"><button class="fi-btn main big fi-grow" data-act="start-empty">＋ ${esc(t('fi_start_empty'))}</button></div>`;
        const others = tp.filter(x => !planned.includes(x));
        if (others.length) {
          out += `<div class="fi-h">${esc(t('fi_my_workouts'))}</div>` + others.map(x => `<button class="fi-item" data-act="start-tpl" data-id="${esc(x.id)}"><div class="fi-grow"><b>${esc(x.name)}</b>
            <div class="fi-sub">${x.items.length} ${esc(t('fi_exercises_n'))}</div></div><span class="fi-badge">${esc(t('fi_start'))}</span></button>`).join('');
        } else if (!planned.length) {
          out += `<div class="fi-hint">${esc(t('fi_no_workouts_hint'))}</div>`;
        }
      }
      if (doneToday.length) {
        out += `<div class="fi-h">${esc(t('fi_done_today'))}</div>` + doneToday.map(sessionRow).join('');
      }
      if (st.others && (st.others.minutes || st.others.kcal)) {
        out += `<div class="fi-card"><div class="fi-h">${esc(t('fi_from_other'))}</div>` + st.others.sources.map(o =>
          `<div class="fi-row"><div class="fi-grow">${esc(o.name)}</div><b>${fnum(o.minutes || 0, 0)} ${esc(t('fi_min'))}${o.kcal ? ' · ' + fnum(o.kcal, 0) + ' kcal' : ''}</b></div>`).join('') + '</div>';
      }
      return out;
    }
    function sessionRow(x) {
      const names = x.exercises.slice(0, 3).map(e => exName(e.ex_ref, e.name)).join(', ') + (x.exercises.length > 3 ? '…' : '');
      return `<button class="fi-item" data-act="open-session" data-id="${esc(x.id)}"><div class="fi-grow"><b>${esc(x.name || t('fi_workout'))}</b> ${x.prs ? `<span class="fi-pr">🏆 ${x.prs}</span>` : ''}
        <div class="fi-sub">${esc(fDate(x.day))}${x.started_at ? ' · ' + esc(fClock(x.started_at)) : ''} · ${esc(fDurLong(x.duration_s))} · ~${fnum(x.kcal, 0)} kcal${x.volume ? ' · ' + esc(fVol(x.volume)) : ''}</div>
        <div class="fi-sub">${esc(names)}</div></div><span>›</span></button>`;
    }

    // ── Workout in progress ──────────────────────────────────────
    function groupSets(sets) {
      const order = [], map = {};
      sets.forEach(s => { if (!map[s.ex_ref]) { map[s.ex_ref] = []; order.push(s.ex_ref); } map[s.ex_ref].push(s); });
      return order.map(ref => ({ ref, sets: map[ref] }));
    }
    function inputsFor(type, s, prevSet) {
      const ph = k => { const v = prevSet && prevSet[k] || s['t_' + k]; return v ? ` placeholder="${esc(k === 'weight' ? fnum(wd(v), 1) : k === 'dist' ? fnum(dd(v), 2) : k === 'secs' ? fDur(v) : fnum(v, 0))}"` : ''; };
      const val = k => (s[k] ? esc(k === 'weight' ? fnum(wd(s[k]), 2) : k === 'dist' ? fnum(dd(s[k]), 3) : k === 'secs' ? fDur(s[k]) : fnum(s[k], 2)) : '');
      const cell = (k, label, mode) => `<div class="fi-cell"><input data-f="${k}" inputmode="${mode || 'decimal'}" value="${val(k)}"${ph(k)}><small>${esc(label)}</small></div>`;
      if (type === 'weight_reps') return cell('weight', wU()) + cell('reps', t('fi_reps'), 'numeric');
      if (type === 'reps') return cell('reps', t('fi_reps'), 'numeric');
      if (type === 'time') return cell('secs', t('fi_time'), 'text');
      if (type === 'distance') return cell('dist', dU()) + cell('secs', t('fi_time'), 'text');
      return cell('secs', t('fi_time'), 'text') + cell('dist', dU() + ' ' + t('fi_optional'));
    }
    function setRow(s, idx, ex, prevSets, cur, finished) {
      const kind = s.kind === 'warmup' ? 'W' : s.kind === 'failure' ? 'F' : String(s.set_no);
      const nIdx = ex.sets.slice(0, idx).filter(x => x.kind !== 'warmup').length;
      const prevSet = s.kind === 'warmup' ? null : (prevSets && prevSets[nIdx]) || (prevSets && prevSets[prevSets.length - 1]) || null;
      const timerBtn = !finished && (s.ex_type === 'time' || s.ex_type === 'cardio' || s.ex_type === 'distance') && !s.done
        ? `<button class="fi-x" data-act="set-timer" data-sid="${esc(s.id)}" title="${esc(t('fi_timer'))}">⏱️</button>` : '';
      return `<div class="fi-set${s.done ? ' done' : ''}${cur === s.id ? ' cur' : ''}" data-sid="${esc(s.id)}">
        <button class="fi-kind" data-act="kind" data-sid="${esc(s.id)}" title="${esc(t('fi_kind_hint'))}">${esc(kind)}</button>
        ${inputsFor(s.ex_type, s, prevSet)}${timerBtn}
        <button class="fi-tick" data-act="${finished ? 'noop' : 'done'}" data-sid="${esc(s.id)}"${finished ? ' style="display:none"' : ''}>✓</button>
        <button class="fi-x" data-act="del-set" data-sid="${esc(s.id)}" title="${esc(t('fi_delete'))}">×</button>
      </div>${s.prs && s.prs.length ? `<div style="padding:0 0 4px 40px">${prBadges(s.prs)}</div>` : ''}`;
    }
    function exCard(g, sess, cur, finished) {
      const e = exOf(g.ref), last = sess.prev && sess.prev[g.ref];
      const nm = exName(g.ref, g.sets[0].ex_name);
      const grp = g.sets[0].group_no ? ` <span class="fi-badge">${esc(t('fi_superset'))} ${String.fromCharCode(64 + g.sets[0].group_no)}</span>` : '';
      const lastTxt = last ? `${esc(t('fi_last_time'))} (${esc(shortDay(last.day))}): ${esc(last.sets.map(x => setText(e.type, x)).join(', '))}` : '';
      return `<div class="fi-ex"><div class="fi-exhead"><div class="fi-exname" data-act="open-ex" data-ref="${esc(g.ref)}">${esc(nm)}${grp}</div>
        ${finished ? '' : `<button class="fi-x" data-act="rm-ex" data-ref="${esc(g.ref)}" title="${esc(t('fi_remove'))}">🗑</button>`}</div>
        ${lastTxt ? `<div class="fi-last">${lastTxt}</div>` : ''}
        ${g.sets.map((s, i) => setRow(s, i, g, last && last.sets, cur, finished)).join('')}
        ${finished ? '' : `<div class="fi-row"><button class="fi-btn" data-act="add-set" data-ref="${esc(g.ref)}">＋ ${esc(t('fi_add_set'))}</button>
        ${e.type === 'weight_reps' ? `<button class="fi-btn" data-act="add-warm" data-ref="${esc(g.ref)}">＋ ${esc(t('fi_add_warmup'))}</button>` : ''}</div>`}</div>`;
    }
    function viewWorkout() {
      const a = st.active; if (!a) { return ''; }
      const cur = (a.sets.find(s => !s.done) || {}).id;
      const next = a.sets.find(s => !s.done);
      return `<div class="fi-top"><button class="fi-btn" data-act="back-main">‹</button><div class="fi-title">${esc(a.name || t('fi_workout'))}</div>
          <span class="fi-badge" id="fi-elapsed">0:00</span><button class="fi-btn main" data-act="finish">${esc(t('fi_finish'))}</button></div>
        ${a.mode !== 'standard' ? `<div class="fi-hint">${esc(t('fi_mode_' + a.mode))}${a.mode === 'interval' && a.work_s ? ` · ${fDur(a.work_s)} / ${fDur(a.rest_s)}` : ''}</div>` : ''}
        ${next ? `<div class="fi-hint">${esc(t('fi_next_up'))}: <b>${esc(exName(next.ex_ref, next.ex_name))}</b> · ${esc(t('fi_set'))} ${next.set_no}</div>` : ''}
        ${groupSets(a.sets).map(g => exCard(g, a, cur, false)).join('')}
        <div class="fi-row"><button class="fi-btn big fi-grow" data-act="add-ex">＋ ${esc(t('fi_add_exercise'))}</button></div>
        <div class="fi-row"><button class="fi-btn danger" data-act="discard">${esc(t('fi_discard'))}</button></div>`;
    }
    function bottomBar() {
      const tm = st.timer;
      if (!tm) return '';
      if (tm.kind === 'rest') {
        return `<div class="fi-bottom"><div class="fi-grow"><div class="fi-hint">${esc(t('fi_rest'))}</div><b id="fi-timer">${fDur(Math.max(0, Math.ceil((tm.end - Date.now()) / 1000)))}</b></div>
          <button class="fi-btn" data-act="rest-add" data-n="-15">−15</button><button class="fi-btn" data-act="rest-add" data-n="15">+15</button><button class="fi-btn main" data-act="rest-skip">${esc(t('fi_skip'))}</button></div>`;
      }
      return `<div class="fi-bottom"><div class="fi-grow"><div class="fi-hint">${esc(t('fi_timing'))}${tm.target ? ' · ' + esc(t('fi_target')) + ' ' + fDur(tm.target) : ''}</div><b id="fi-timer">0:00</b></div>
        <button class="fi-btn main" data-act="timer-stop">${esc(t('fi_stop_save'))}</button><button class="fi-btn" data-act="timer-cancel">${esc(t('fi_cancel'))}</button></div>`;
    }

    // ── Finished session (details and edit) ──────────────────────
    function viewSession() {
      const s = st.detail; if (!s) return '';
      const e = st.detailEdit;
      return `<div class="fi-top"><button class="fi-btn" data-act="back-main">‹</button><div class="fi-title">${esc(s.name || t('fi_workout'))}</div>
          <button class="fi-btn" data-act="sess-edit">✏️</button></div>
        <div class="fi-hint">${esc(fDate(s.day))}${s.started_at ? ' · ' + esc(fClock(s.started_at)) : ''}</div>
        <div class="fi-grid"><div class="fi-stat"><b>${esc(fDurLong(s.duration_s))}</b><span>${esc(t('fi_duration'))}</span></div>
          <div class="fi-stat"><b>~${fnum(s.kcal, 0)}</b><span>${esc(t('fi_kcal_est'))}</span></div>
          <div class="fi-stat"><b>${s.done_sets}</b><span>${esc(t('fi_sets'))}</span></div>
          ${s.sets.some(x => x.ex_type === 'weight_reps') ? `<div class="fi-stat"><b>${esc(fVol(s.sets.filter(x => x.ex_type === 'weight_reps' && x.kind !== 'warmup').reduce((a, x) => a + x.reps * x.weight, 0)))}</b><span>${esc(t('fi_volume'))}</span></div>` : ''}</div>
        ${s.notes ? `<div class="fi-card"><div class="fi-hint">${esc(s.notes)}</div></div>` : ''}
        ${e ? `<div class="fi-card"><div class="fi-field"><label>${esc(t('fi_name'))}</label><input class="fi-in" id="fi-sn" value="${esc(e.name)}"></div>
          <div class="fi-field"><label>${esc(t('fi_date'))}</label><div id="fi-sday"></div></div>
          <div class="fi-field"><label>${esc(t('fi_duration_min'))}</label><input class="fi-in" id="fi-sdur" inputmode="numeric" value="${esc(e.duration_min)}"></div>
          <div class="fi-field"><label>${esc(t('fi_notes'))}</label><textarea class="fi-in" id="fi-snotes">${esc(e.notes)}</textarea></div>
          <div class="fi-row"><button class="fi-btn main" data-act="sess-save">${esc(t('fi_save'))}</button><button class="fi-btn" data-act="sess-edit">${esc(t('fi_cancel'))}</button></div></div>` : ''}
        ${groupSets(s.sets).map(g => exCard(g, s, null, true)).join('')}
        <div class="fi-row">${!st.detail.template_id && st.detail.mode === 'standard' ? `<button class="fi-btn" data-act="sess-template">${esc(t('fi_save_as_workout'))}</button>` : ''}
          <button class="fi-btn danger" data-act="sess-delete">${esc(t('fi_delete'))}</button></div>`;
    }

    // ── Summary after finishing ──────────────────────────────────
    function viewSummary() {
      const x = st.summary; if (!x) return '';
      const recs = x.records || [];
      return `<div class="fi-top"><div class="fi-title">🎉 ${esc(t('fi_well_done'))}</div></div>
        <div class="fi-grid"><div class="fi-stat"><b>${esc(fDurLong(x.duration_s))}</b><span>${esc(t('fi_duration'))}</span></div>
          <div class="fi-stat"><b>~${fnum(x.kcal, 0)}</b><span>${esc(t('fi_kcal_est'))}</span></div>
          <div class="fi-stat"><b>${x.done_sets}</b><span>${esc(t('fi_sets'))}</span></div>
          ${x.volume ? `<div class="fi-stat"><b>${esc(fVol(x.volume))}</b><span>${esc(t('fi_volume'))}</span></div>` : ''}</div>
        ${recs.length ? `<div class="fi-card"><div class="fi-h">🏆 ${esc(t('fi_new_records'))}</div>${recs.map(r => `<div class="fi-row"><div class="fi-grow">${esc(exName(r.ex_ref, r.name))}</div><span class="fi-pr">${esc(prLabel(r.kind))}</span></div>`).join('')}</div>`
          : `<div class="fi-hint">${esc(t('fi_no_records'))}</div>`}
        <div class="fi-hint">${esc(t('fi_kcal_note'))}</div>
        <div class="fi-row"><button class="fi-btn main big fi-grow" data-act="summary-close">${esc(t('fi_close'))}</button></div>`;
    }

    // ── Workouts (templates) ─────────────────────────────────────
    function viewWorkouts() {
      const tp = st.me.templates;
      const order = weekOrder();
      const plan = `<div class="fi-card"><div class="fi-h">${esc(t('fi_week_plan'))}</div>${order.map(d => {
        const names = tp.filter(x => x.days.includes(d)).map(x => x.name);
        return `<div class="fi-row"><b style="width:46px">${esc(weekdayName(d))}</b><div class="fi-grow fi-hint">${names.length ? esc(names.join(', ')) : '–'}</div></div>`;
      }).join('')}</div>`;
      const list = tp.map(x => `<div class="fi-card"><div class="fi-row"><div class="fi-grow"><b>${esc(x.name)}</b>
        <div class="fi-hint">${x.mode !== 'standard' ? esc(t('fi_mode_' + x.mode)) + ' · ' : ''}${x.items.length} ${esc(t('fi_exercises_n'))}${x.days.length ? ' · ' + esc(x.days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(weekdayName).join(', ')) : ''}</div></div>
        <button class="fi-btn" data-act="edit-tpl" data-id="${esc(x.id)}">✏️</button><button class="fi-btn main" data-act="start-tpl" data-id="${esc(x.id)}">${esc(t('fi_start'))}</button></div>
        <div class="fi-hint">${esc(x.items.map(i => `${exName(i.ex_ref, i.name)} ${targetText(i)}`).join(' · '))}</div></div>`).join('');
      return `<div class="fi-row"><button class="fi-btn main big fi-grow" data-act="new-tpl">＋ ${esc(t('fi_new_workout'))}</button>
        ${aiOn() ? `<button class="fi-btn big" data-act="ai-plan">✨ ${esc(t('fi_ai_plan'))}</button>` : ''}</div>
        ${tp.length ? plan + list : `<div class="fi-hint">${esc(t('fi_no_workouts_hint'))}</div>`}`;
    }
    function newTpl() {
      return { id: null, name: '', notes: '', mode: 'standard', rounds: 3, work_s: 40, rest_s: 20, days: [], items: [] };
    }
    function itemEditor(it, i, n) {
      const ty = typeOf(it.ex_ref);
      const f = (k, label, val, mode) => `<div class="fi-field"><label>${esc(label)}</label><input class="fi-in" data-i="${i}" data-k="${k}" inputmode="${mode || 'decimal'}" value="${esc(val)}"></div>`;
      let fields = f('sets', t('fi_sets'), it.sets, 'numeric');
      if (ty === 'weight_reps') fields += f('reps', t('fi_reps'), it.reps || '', 'numeric') + f('weight', wU(), it.weight ? fnum(wd(it.weight), 2) : '');
      else if (ty === 'reps') fields += f('reps', t('fi_reps'), it.reps || '', 'numeric');
      else if (ty === 'time') fields += f('secs', t('fi_time'), it.secs ? fDur(it.secs) : '', 'text');
      else if (ty === 'distance') fields += f('dist', dU(), it.dist ? fnum(dd(it.dist), 2) : '') + f('secs', t('fi_time_min'), it.secs ? fDur(it.secs) : '', 'text');
      else fields += f('secs', t('fi_time_min'), it.secs ? fDur(it.secs) : '', 'text') + f('dist', dU(), it.dist ? fnum(dd(it.dist), 2) : '');
      fields += f('rest_s', t('fi_rest_s'), it.rest_s || '', 'numeric');
      return `<div class="fi-card"><div class="fi-row"><div class="fi-grow"><b>${esc(exName(it.ex_ref, it.name))}</b></div>
        <button class="fi-x" data-act="tpl-up" data-i="${i}"${i ? '' : ' disabled'}>▲</button><button class="fi-x" data-act="tpl-down" data-i="${i}"${i < n - 1 ? '' : ' disabled'}>▼</button>
        <button class="fi-x" data-act="tpl-rm" data-i="${i}">×</button></div>
        <div class="fi-fields">${fields}</div>
        ${st.tpl.mode === 'standard' ? `<div class="fi-field"><label>${esc(t('fi_superset'))}</label><select class="fi-in" data-i="${i}" data-k="group_no">${[0, 1, 2, 3, 4, 5].map(g =>
          `<option value="${g}"${(it.group_no || 0) === g ? ' selected' : ''}>${g ? String.fromCharCode(64 + g) : '—'}</option>`).join('')}</select></div>` : ''}</div>`;
    }
    function viewTpl() {
      const f = st.tpl;
      const order = weekOrder();
      return `<div class="fi-top"><button class="fi-btn" data-act="tpl-back">‹</button><div class="fi-title">${esc(f.id ? t('fi_edit_workout') : t('fi_new_workout'))}</div></div>
        <div class="fi-card">
          <div class="fi-field"><label>${esc(t('fi_name'))}</label><input class="fi-in" id="fi-tn" maxlength="80" value="${esc(f.name)}"></div>
          <div class="fi-field"><label>${esc(t('fi_mode'))}</label><select class="fi-in" id="fi-tm">${['standard', 'circuit', 'interval'].map(m =>
            `<option value="${m}"${f.mode === m ? ' selected' : ''}>${esc(t('fi_mode_' + m))}</option>`).join('')}</select></div>
          ${f.mode !== 'standard' ? `<div class="fi-fields"><div class="fi-field"><label>${esc(t('fi_rounds'))}</label><input class="fi-in" id="fi-tr" inputmode="numeric" value="${esc(f.rounds)}"></div>
            ${f.mode === 'interval' ? `<div class="fi-field"><label>${esc(t('fi_work_s'))}</label><input class="fi-in" id="fi-tw" inputmode="numeric" value="${esc(f.work_s)}"></div>` : ''}
            <div class="fi-field"><label>${esc(t('fi_rest_s'))}</label><input class="fi-in" id="fi-trest" inputmode="numeric" value="${esc(f.rest_s)}"></div></div>
            <div class="fi-hint">${esc(t('fi_mode_' + f.mode + '_hint'))}</div>` : ''}
          <div><div class="fi-h">${esc(t('fi_days_plan'))}</div><div class="fi-chips">${order.map(d =>
            `<button class="fi-chip${f.days.includes(d) ? ' sel' : ''}" data-act="tpl-day" data-d="${d}">${esc(weekdayName(d))}</button>`).join('')}</div></div>
          <div class="fi-field"><label>${esc(t('fi_notes'))}</label><textarea class="fi-in" id="fi-tnotes" maxlength="1000">${esc(f.notes)}</textarea></div></div>
        <div class="fi-h">${esc(t('fi_exercises'))}</div>
        ${f.items.map((it, i) => itemEditor(it, i, f.items.length)).join('')}
        <button class="fi-btn big" data-act="tpl-add">＋ ${esc(t('fi_add_exercise'))}</button>
        ${st.msg ? `<div class="fi-err">${esc(st.msg)}</div>` : ''}
        <div class="fi-row"><button class="fi-btn main big fi-grow" data-act="tpl-save">${esc(t('fi_save'))}</button>
          ${f.id ? `<button class="fi-btn danger" data-act="tpl-delete">${esc(t('fi_delete'))}</button>` : ''}</div>`;
    }
    function syncTplFromDom() {
      const f = st.tpl; if (!f) return;
      const g = id => w.querySelector('#' + id);
      if (g('fi-tn')) f.name = g('fi-tn').value;
      if (g('fi-tnotes')) f.notes = g('fi-tnotes').value;
      if (g('fi-tr')) f.rounds = Math.max(1, Math.round(num(g('fi-tr').value)) || 1);
      if (g('fi-tw')) f.work_s = Math.max(0, Math.round(num(g('fi-tw').value)));
      if (g('fi-trest')) f.rest_s = Math.max(0, Math.round(num(g('fi-trest').value)));
      w.querySelectorAll('[data-k]').forEach(inp => {
        const it = f.items[+inp.dataset.i]; if (!it) return;
        const k = inp.dataset.k, ty = typeOf(it.ex_ref);
        if (k === 'weight') it.weight = wk(num(inp.value));
        else if (k === 'dist') it.dist = dk(num(inp.value));
        else if (k === 'secs') it.secs = parseDur(inp.value, ty);
        else it[k] = Math.round(num(inp.value) * 100) / 100;
      });
    }

    // ── Exercises ────────────────────────────────────────────────
    function filteredExercises() {
      const q = st.exFilter.q.trim().toLowerCase(), m = st.exFilter.muscle, equip = st.exFilter.equip;
      return st.ready_ex.concat(st.me.custom).filter(e => (!m || e.muscle === m) && (!equip || e.equip === equip) && (!q || exName(e).toLowerCase().includes(q)))
        .sort((a, b) => exName(a).localeCompare(exName(b), lang()));
    }
    function exerciseList(act) {
      const list = filteredExercises();
      return `<div class="fi-field"><input class="fi-in" id="fi-exq" placeholder="${esc(t('fi_search'))}" value="${esc(st.exFilter.q)}"></div>
        <div class="fi-chips"><button class="fi-chip${st.exFilter.muscle ? '' : ' sel'}" data-act="ex-muscle" data-m="">${esc(t('fi_all'))}</button>${MUSCLES.map(m =>
          `<button class="fi-chip${st.exFilter.muscle === m ? ' sel' : ''}" data-act="ex-muscle" data-m="${m}">${esc(mTxt(m))}</button>`).join('')}</div>
        <div class="fi-field"><label for="fi-equip-filter">${esc(t('fi_equipment'))}</label><select id="fi-equip-filter" class="fi-in"><option value="">${esc(t('fi_all'))}</option>${EQUIP.map(eq => `<option value="${eq}"${st.exFilter.equip === eq ? ' selected' : ''}>${esc(t('fi_e_' + eq))}</option>`).join('')}</select></div>
        <div id="fi-exlist" style="display:flex;flex-direction:column;gap:6px">${list.length ? list.map(e => `<button class="fi-item" data-act="${act}" data-ref="${esc(e.ref)}">
          <span class="fi-dot" style="background:${MUSCLE_COLOR[e.muscle] || '#888'}"></span><div class="fi-grow">${esc(exName(e))}${e.custom ? ' ⭐' : ''}
          <div class="fi-sub">${esc(mTxt(e.muscle))} · ${esc(t('fi_type_' + e.type))} · ${esc(t('fi_e_' + e.equip))}</div></div><span>›</span></button>`).join('') : `<div class="fi-hint">${esc(t('fi_nothing'))}</div>`}</div>`;
    }
    function viewExercises() {
      return `<div class="fi-row"><button class="fi-btn big fi-grow" data-act="ex-new">＋ ${esc(t('fi_new_exercise'))}</button></div>${exerciseList('open-ex')}`;
    }
    function viewExForm() {
      const f = st.exForm;
      const sel = (id, opts, cur, lab) => `<div class="fi-field"><label>${esc(t(lab))}</label><select class="fi-in" id="${id}">${opts.map(o =>
        `<option value="${o}"${cur === o ? ' selected' : ''}>${esc(id === 'fi-xt' ? t('fi_type_' + o) : id === 'fi-xm' ? mTxt(o) : t('fi_e_' + o))}</option>`).join('')}</select></div>`;
      const used = f.id && st.exDetail && st.exDetail.sessions > 0;
      return `<div class="fi-top"><button class="fi-btn" data-act="exform-back">‹</button><div class="fi-title">${esc(f.id ? t('fi_edit_exercise') : t('fi_new_exercise'))}</div></div>
        <div class="fi-card"><div class="fi-field"><label>${esc(t('fi_name'))}</label><input class="fi-in" id="fi-xn" maxlength="80" value="${esc(f.name)}"></div>
          ${sel('fi-xt', TYPES, f.type, 'fi_type')}
          ${used ? `<div class="fi-hint">${esc(t('fi_type_locked'))}</div>` : ''}
          <div class="fi-hint">${esc(t('fi_type_help_' + f.type))}</div>
          ${sel('fi-xm', MUSCLES, f.muscle, 'fi_muscle')}${sel('fi-xe', EQUIP, f.equip, 'fi_equipment')}
          ${st.msg ? `<div class="fi-err">${esc(st.msg)}</div>` : ''}
          <div class="fi-row"><button class="fi-btn main" data-act="exform-save">${esc(t('fi_save'))}</button>
          ${f.id ? `<button class="fi-btn danger" data-act="exform-delete">${esc(t('fi_delete'))}</button>` : ''}</div></div>`;
    }
    function viewExDetail() {
      const d = st.exDetail; if (!d) return '';
      const e = d.exercise, r = d.records, b = (r && r.best) || {};
      const rec = (label, v) => `<div class="fi-stat"><b>${v}</b><span>${esc(label)}</span></div>`;
      let recs = '';
      if (e.type === 'weight_reps') {
        if (b.weight) recs += rec(t('fi_rec_weight'), fW(b.weight.value));
        if (b.e1rm) recs += rec(t('fi_rec_e1rm'), '≈ ' + fW(b.e1rm.value));
        if (b.volume) recs += rec(t('fi_rec_volume'), fVol(b.volume.value));
        if (b.session_volume) recs += rec(t('fi_rec_session_volume'), fVol(b.session_volume.value));
        if (b.reps) recs += rec(t('fi_rec_reps'), fnum(b.reps.value, 0));
      } else if (e.type === 'reps') { if (b.reps) recs += rec(t('fi_rec_reps'), fnum(b.reps.value, 0)); }
      else {
        if (b.time) recs += rec(t('fi_rec_time'), fDur(b.time.value));
        if (b.dist) recs += rec(t('fi_rec_dist'), fDist(b.dist.value));
        if (b.pace) recs += rec(t('fi_rec_pace'), fPace(b.pace.value));
      }
      const metrics = e.type === 'weight_reps' ? ['e1rm', 'top_weight', 'volume', 'reps'] : e.type === 'reps' ? ['reps', 'total_reps'] : e.type === 'time' ? ['secs', 'total_secs'] : ['dist', 'total_secs'];
      if (!metrics.includes(st.exChart)) st.exChart = metrics[0];
      const val = (p) => st.exChart === 'e1rm' || st.exChart === 'top_weight' ? rnd(wd(p[st.exChart]), 1) : st.exChart === 'volume' ? rnd(wd(p.volume), 0) : st.exChart === 'dist' ? rnd(dd(p.dist), 2) : p[st.exChart];
      const fmt = v => (st.exChart === 'secs' || st.exChart === 'total_secs') ? fDur(v) : fnum(v, 1);
      const pts = d.series.filter(p => val(p) > 0).map(p => ({ label: shortDay(p.day), value: val(p) }));
      const byReps = r && r.by_reps && Object.keys(r.by_reps).length
        ? `<div class="fi-card"><div class="fi-h">${esc(t('fi_best_by_reps'))}</div><table class="fi-tbl"><tr><th>${esc(t('fi_reps'))}</th><th>${esc(t('fi_weight'))}</th><th>${esc(t('fi_date'))}</th></tr>${Object.keys(r.by_reps).sort((a, b) => a - b).map(k =>
          `<tr><td>${k}</td><td>${esc(fW(r.by_reps[k].weight))}</td><td>${esc(fDate(r.by_reps[k].day))}</td></tr>`).join('')}</table></div>` : '';
      const hist = d.history.map((h, i) => {
        const older = d.history[i + 1];
        let delta = '';
        if (older && e.type === 'weight_reps') {
          const vol = x => x.sets.reduce((a, s) => a + s.reps * s.weight, 0);
          const dv = vol(h) - vol(older);
          delta = dv ? ` <span class="${dv > 0 ? 'fi-ok' : 'fi-err'}">${dv > 0 ? '▲' : '▼'} ${esc(fVol(Math.abs(dv)))}</span>` : '';
        }
        return `<div class="fi-card"><div class="fi-row"><b class="fi-grow">${esc(fDate(h.day))}</b>${delta}</div>
          <div class="fi-hint" style="font-size:.88rem">${h.sets.map(s => `${esc(setText(e.type, s))}${s.prs && s.prs.length ? ' 🏆' : ''}`).join(' · ')}</div></div>`;
      }).join('');
      return `<div class="fi-top"><button class="fi-btn" data-act="exdetail-back">‹</button><div class="fi-title">${esc(exName(e))}</div>
          ${e.custom ? `<button class="fi-btn" data-act="ex-edit" data-ref="${esc(e.ref)}">✏️</button>` : ''}</div>
        <div class="fi-hint"><span class="fi-dot" style="background:${MUSCLE_COLOR[e.muscle]};display:inline-block"></span> ${esc(mTxt(e.muscle))} · ${esc(t('fi_type_' + e.type))} · ${esc(t('fi_e_' + e.equip))}</div>
        ${e.ref.startsWith('r:') && e.equip === 'dumbbell' ? `<div class="fi-card"><div class="fi-exercise-3d" data-exercise="${esc(e.ref.slice(2))}" aria-label="${esc(exName(e))}"></div>${e.ref === 'r:arnold_press' ? `<div>${esc(t('fi_3d_description'))}</div>` : ''}<div class="fi-hint">${esc(t('fi_3d_rotate'))}</div></div>` : ''}
        ${d.sessions ? `<div class="fi-grid">${recs}</div>
        <div class="fi-card"><div class="fi-chips">${metrics.map(m => `<button class="fi-chip${st.exChart === m ? ' sel' : ''}" data-act="ex-chart" data-m="${m}">${esc(t('fi_chart_' + m))}</button>`).join('')}</div>${lineChart(pts, fmt)}</div>
        ${byReps}<div class="fi-h">${esc(t('fi_history'))}</div>${hist}` : `<div class="fi-hint">${esc(t('fi_ex_no_history'))}</div>`}`;
    }

    // ── Progress ─────────────────────────────────────────────────
    function viewProgress() {
      const subs = [['overview', 'fi_sub_overview'], ['history', 'fi_sub_history'], ['records', 'fi_sub_records']];
      let inner = '';
      if (st.sub === 'overview') inner = progressOverview();
      else if (st.sub === 'history') inner = progressHistory();
      else inner = progressRecords();
      return `<div class="fi-chips">${subs.map(([k, l]) => `<button class="fi-chip${st.sub === k ? ' sel' : ''}" data-act="sub" data-sub="${k}">${esc(t(l))}</button>`).join('')}</div>${inner}`;
    }
    function heatmap(s) {
      const days = new Set(s.session_days || []);
      const today = todayStr(), order = weekOrder(), off = order.indexOf(weekdayOf(today));
      const cols = 16, cells = [];
      for (let c = 0; c < cols; c++) for (let r = 0; r < 7; r++) {
        const day = shiftDay(today, (c - (cols - 1)) * 7 + (r - off));
        cells.push(day > today ? '<i class="fut"></i>' : `<i class="${days.has(day) ? 'on' : ''}" title="${esc(fDate(day))}"></i>`);
      }
      return `<div class="fi-heat" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
    }
    function progressOverview() {
      const s = st.stats; if (!s) return `<div class="fi-hint">${esc(t('fi_nothing'))}</div>`;
      const T = s.totals;
      const metric = st.chartMetric;
      const items = s.weeks.map(x => ({ label: shortDay(x.week), value: metric === 'volume' ? rnd(wd(x.volume), 0) : x[metric] }));
      const unit = metric === 'volume' ? wU() : metric === 'minutes' ? t('fi_min') : metric === 'kcal' ? 'kcal' : '';
      const musTot = Object.values(s.muscles).reduce((a, b) => a + b, 0) || 1;
      const mus = Object.keys(s.muscles).sort((a, b) => s.muscles[b] - s.muscles[a]).map(m =>
        `<div class="fi-row"><div style="width:96px;font-size:.84rem">${esc(mTxt(m))}</div><div class="fi-grow fi-track"><div class="fi-fill" style="width:${Math.round(100 * s.muscles[m] / musTot)}%;background:${MUSCLE_COLOR[m] || '#89b4fa'}"></div></div><span class="fi-hint" style="width:34px;text-align:right">${s.muscles[m]}</span></div>`).join('');
      const recent = s.recent_records.map(r => `<div class="fi-row"><div class="fi-grow">${esc(exName(r.ex_ref, r.name))}</div><span class="fi-pr">${esc(prLabel(r.kind))}</span><span class="fi-hint">${esc(shortDay(r.day))}</span></div>`).join('');
      return `<div class="fi-chips">${[30, 90, 365].map(n => `<button class="fi-chip${st.statsDays === n ? ' sel' : ''}" data-act="range" data-n="${n}">${n === 365 ? esc(t('fi_year')) : n + ' ' + esc(t('fi_days'))}</button>`).join('')}</div>
        <div class="fi-grid"><div class="fi-stat"><b>${T.sessions}</b><span>${esc(t('fi_workouts_n'))}</span></div><div class="fi-stat"><b>${esc(fDurLong(T.minutes * 60))}</b><span>${esc(t('fi_total_time'))}</span></div>
          <div class="fi-stat"><b>${fBig(T.kcal)}</b><span>${esc(t('fi_kcal_est'))}</span></div>
          ${T.volume ? `<div class="fi-stat"><b>${esc(fVol(T.volume))}</b><span>${esc(t('fi_volume'))}</span></div>` : ''}
          ${T.dist ? `<div class="fi-stat"><b>${esc(fDist(T.dist))}</b><span>${esc(t('fi_distance'))}</span></div>` : ''}
          <div class="fi-stat"><b>${T.sets}</b><span>${esc(t('fi_sets'))}</span></div>
          <div class="fi-stat"><b>🔥 ${s.streak_weeks}</b><span>${esc(t('fi_streak_weeks'))}</span></div></div>
        <div class="fi-card"><div class="fi-h">${esc(t('fi_per_week'))}</div>
          <div class="fi-chips">${['sessions', 'minutes', 'volume', 'kcal'].map(m => `<button class="fi-chip${metric === m ? ' sel' : ''}" data-act="chart-metric" data-m="${m}">${esc(t('fi_cm_' + m))}</button>`).join('')}</div>
          ${barChart(items, v => fBig(v) + (unit ? ' ' + unit : ''))}</div>
        <div class="fi-card"><div class="fi-h">${esc(t('fi_activity'))}</div>${heatmap(s)}</div>
        ${mus ? `<div class="fi-card"><div class="fi-h">${esc(t('fi_muscles'))}</div>${mus}</div>` : ''}
        ${recent ? `<div class="fi-card"><div class="fi-h">🏆 ${esc(t('fi_recent_records'))}</div>${recent}</div>` : ''}
        ${aiOn() ? aiReviewCard() : ''}`;
    }
    function progressHistory() {
      if (!st.history) return `<div class="fi-hint">…</div>`;
      if (!st.history.length) return `<div class="fi-hint">${esc(t('fi_no_history'))}</div>`;
      let out = '', cur = '';
      st.history.forEach(x => {
        const m = x.day.slice(0, 7);
        if (m !== cur) { cur = m; out += `<div class="fi-h">${esc(monthLabel(x.day))}</div>`; }
        out += sessionRow(x);
      });
      return out;
    }
    function progressRecords() {
      if (!st.records) return `<div class="fi-hint">…</div>`;
      if (!st.records.length) return `<div class="fi-hint">${esc(t('fi_no_records_yet'))}</div>`;
      return st.records.map(r => `<button class="fi-item" data-act="open-ex" data-ref="${esc(r.ex_ref)}"><span class="fi-dot" style="background:${MUSCLE_COLOR[r.muscle] || '#888'}"></span>
        <div class="fi-grow">${esc(exName(r.ex_ref, r.name))}<div class="fi-sub">${esc(shortRec(r))}</div></div><span class="fi-badge">${r.sets} ${esc(t('fi_sets'))}</span></button>`).join('');
    }

    // ── AI (premium; only when the owner switched it on) ─────────
    function aiOn() { return !!(st.me && st.me.ai && st.me.ai.offered && st.me.ai.ready); }
    function aiCredits() {
      const c = st.me.ai && st.me.ai.credits;
      return c && c.price ? `<div class="fi-hint">💳 ${esc(String(c.balance))} · ${esc(t('fi_ai_price', { n: c.price }))}</div>` : '';
    }
    function aiNote(r) { if (r && r.balance != null && st.me.ai.credits) st.me.ai.credits.balance = r.balance; }
    function aiError(e) { return t(e.message === 'no_credits' ? 'fi_ai_no_credits' : e.message === 'no_data' ? 'fi_ai_no_data' : 'fi_ai_failed'); }
    function aiReviewCard() {
      const a = st.aiReview || {};
      let inner;
      if (a.result) {
        const list = (title, arr) => arr && arr.length ? `<div class="fi-h">${esc(t(title))}</div>${arr.map(x => `<div>• ${esc(x)}</div>`).join('')}` : '';
        inner = `<div>${esc(a.result.summary)}</div>${list('fi_ai_improving', a.result.improving)}${list('fi_ai_attention', a.result.attention)}${list('fi_ai_next', a.result.next)}`;
      } else inner = `<div class="fi-hint">${esc(t('fi_ai_review_hint'))}</div>`;
      return `<div class="fi-card"><div class="fi-h">✨ ${esc(t('fi_ai_review'))}</div>${inner}${a.error ? `<div class="fi-err">${esc(a.error)}</div>` : ''}
        <button class="fi-btn main" data-act="ai-review"${a.busy ? ' disabled' : ''}>${a.busy ? '…' : '✨ ' + esc(t('fi_ai_review_btn'))}</button>${aiCredits()}<div class="fi-hint">${esc(t('fi_ai_disclaimer'))}</div></div>`;
    }
    function viewAiPlan() {
      const a = st.aiPlan;
      let inner;
      if (a.result) {
        inner = `<div class="fi-hint"><b>${esc(t('fi_ai_found'))}</b> ${esc(a.result.summary)}</div>` + a.result.workouts.map((x, i) => `<div class="fi-card"><label class="fi-check"><input type="checkbox" data-ai-pick="${i}" checked><b>${esc(x.name)}</b></label>
          ${x.notes ? `<div class="fi-hint">${esc(x.notes)}</div>` : ''}${x.days.length ? `<div class="fi-hint">${esc(x.days.map(weekdayName).join(', '))}</div>` : ''}
          <div class="fi-hint">${esc(x.items.map(it => `${exName(it.ex_ref, it.name)} ${targetText(it)}`).join(' · '))}</div></div>`).join('') +
          `<div class="fi-row"><button class="fi-btn main" data-act="aiplan-save"${a.busy ? ' disabled' : ''}>${esc(t('fi_ai_save'))}</button><button class="fi-btn" data-act="aiplan-cancel">${esc(t('fi_ai_discard'))}</button></div>`;
      } else {
        const opt = (id, opts, cur, lab) => `<div class="fi-field"><label>${esc(t(lab))}</label><select class="fi-in" id="${id}">${opts.map(([v, l]) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
        inner = `<div class="fi-hint">${esc(t('fi_ai_plan_hint'))}</div>
          ${opt('fi-ag', Object.keys(GOALS).map(k => [k, t('fi_goal_' + k)]), a.goal, 'fi_goal')}
          <div class="fi-fields">${opt('fi-ad', [1, 2, 3, 4, 5, 6, 7].map(n => [n, String(n)]), a.days, 'fi_days_week')}${opt('fi-am', [20, 30, 45, 60, 75, 90].map(n => [n, n + ' ' + t('fi_min')]), a.minutes, 'fi_minutes')}
          ${opt('fi-al', ['beginner', 'intermediate', 'advanced'].map(k => [k, t('fi_level_' + k)]), a.level, 'fi_level')}</div>
          <div class="fi-field"><label>${esc(t('fi_equipment'))}</label><input class="fi-in" id="fi-aeq" maxlength="200" placeholder="${esc(t('fi_ai_equip_ph'))}" value="${esc(a.equipment)}"></div>
          <div class="fi-field"><label>${esc(t('fi_ai_note'))}</label><textarea class="fi-in" id="fi-anote" maxlength="600" placeholder="${esc(t('fi_ai_note_ph'))}">${esc(a.note)}</textarea></div>
          ${a.error ? `<div class="fi-err">${esc(a.error)}</div>` : ''}
          <button class="fi-btn main" data-act="aiplan-go"${a.busy ? ' disabled' : ''}>${a.busy ? '…' : '✨ ' + esc(t('fi_ai_ask'))}</button>`;
      }
      return `<div class="fi-top"><button class="fi-btn" data-act="aiplan-cancel">‹</button><div class="fi-title">✨ ${esc(t('fi_ai_plan'))}</div></div><div class="fi-card">${inner}</div>${aiCredits()}<div class="fi-hint">${esc(t('fi_ai_disclaimer'))}</div>`;
    }

    // ── Settings ─────────────────────────────────────────────────
    function viewSettings() {
      const s = st.me.settings, h = st.me.health, ro = s.health_read && s.health_ok;
      const inp = (id, label, val, extra) => `<div class="fi-field"><label>${esc(label)}</label><input class="fi-in" id="${id}" inputmode="decimal" value="${esc(val)}"${ro && extra === 'body' ? ' disabled' : ''}></div>`;
      return `<div class="fi-card"><div class="fi-h">${esc(t('fi_body'))}</div>
          ${ro ? `<div class="fi-hint">${esc(t('fi_body_from_health'))}</div>` : `<div class="fi-hint">${esc(t('fi_body_hint'))}</div>`}
          <div class="fi-fields">${inp('fi-sw', `${t('fi_weight')} (${wU()})`, s.weight_kg ? fnum(wd(s.weight_kg), 1) : '', 'body')}
          <div class="fi-field"><label>${esc(t('fi_sex'))}</label><select class="fi-in" id="fi-ssex"${ro ? ' disabled' : ''}><option value=""${s.sex ? '' : ' selected'}>–</option>
            <option value="m"${s.sex === 'm' ? ' selected' : ''}>${esc(t('fi_sex_m'))}</option><option value="f"${s.sex === 'f' ? ' selected' : ''}>${esc(t('fi_sex_f'))}</option></select></div>
          ${inp('fi-sage', t('fi_age'), s.age || '', 'body')}</div></div>
        <div class="fi-card"><div class="fi-h">${esc(t('fi_training'))}</div><div class="fi-fields">
          ${inp('fi-srest', t('fi_default_rest'), s.rest_s)}${inp('fi-sgoal', t('fi_week_goal_set'), s.week_goal)}</div>
          <div class="fi-hint">${esc(t('fi_units_note', { w: wU(), d: dU() }))}</div>
          <button class="fi-btn main" data-act="settings-save">${esc(t('fi_save'))}</button>${st.msg ? `<div class="${st.msgOk ? 'fi-ok' : 'fi-err'}">${esc(st.msg)}</div>` : ''}</div>
        <div class="fi-card"><div class="fi-h">${esc(t('fi_health'))}</div>
          ${h.available ? '' : `<div class="fi-hint">${esc(t('fi_health_unavailable'))}</div>`}
          <label class="fi-check"><input type="checkbox" id="fi-hsend"${h.enabled ? ' checked' : ''}${h.available ? '' : ' disabled'}> ${esc(t('fi_health_send'))}</label>
          <label class="fi-check"><input type="checkbox" id="fi-hread"${h.read ? ' checked' : ''}${h.available ? '' : ' disabled'}> ${esc(t('fi_health_read'))}</label>
          <label class="fi-check"><input type="checkbox" id="fi-hother"${h.read_other ? ' checked' : ''}${h.available ? '' : ' disabled'}> ${esc(t('fi_health_other'))}</label>
          <div class="fi-hint">${esc(t('fi_health_hint'))}</div></div>`;
    }

    // ── Modals ───────────────────────────────────────────────────
    function modal() {
      if (st.picker) {
        return `<div class="fi-modal"><div class="fi-sheet"><div class="fi-top"><div class="fi-title">${esc(t('fi_pick_exercise'))}</div><button class="fi-btn" data-act="picker-close">✕</button></div>
          ${exerciseList('picker-pick')}<button class="fi-btn" data-act="picker-new">＋ ${esc(t('fi_new_exercise'))}</button></div></div>`;
      }
      if (st.finish) {
        const f = st.finish;
        return `<div class="fi-modal"><div class="fi-sheet"><div class="fi-top"><div class="fi-title">${esc(t('fi_finish'))}</div></div>
          <div class="fi-hint">${esc(t('fi_finish_hint'))}</div>
          <div class="fi-field"><label>${esc(t('fi_duration_min'))}</label><input class="fi-in" id="fi-fdur" inputmode="numeric" value="${esc(f.duration_min)}"></div>
          <div class="fi-field"><label>${esc(t('fi_date'))}</label><div id="fi-fday"></div></div>
          <div class="fi-field"><label>${esc(t('fi_notes'))}</label><textarea class="fi-in" id="fi-fnotes" maxlength="1000">${esc(f.notes)}</textarea></div>
          ${f.skipped ? `<div class="fi-hint">${esc(t('fi_unfinished_dropped', { n: f.skipped }))}</div>` : ''}
          ${st.msg ? `<div class="fi-err">${esc(st.msg)}</div>` : ''}
          <div class="fi-row"><button class="fi-btn main big fi-grow" data-act="finish-save">${esc(t('fi_save'))}</button><button class="fi-btn big" data-act="finish-cancel">${esc(t('fi_cancel'))}</button></div></div></div>`;
      }
      return '';
    }

    // ── Render ───────────────────────────────────────────────────
    function destroyPicker() { if (pickerHandle) { try { pickerHandle.destroy(); } catch (e) {} pickerHandle = null; } }
    function mountPickers() {
      destroyPicker();
      const pk = P(); if (!pk) return;
      let host = w.querySelector('#fi-fday'), cur = st.finish && st.finish.day;
      if (host && st.finish) { pickerHandle = pk.create(host, { type: 'date', value: cur, max: todayStr(), required: true, onChange: v => { st.finish.day = v; } }); return; }
      host = w.querySelector('#fi-sday');
      if (host && st.detailEdit) pickerHandle = pk.create(host, { type: 'date', value: st.detailEdit.day, max: todayStr(), required: true, onChange: v => { st.detailEdit.day = v; } });
    }
    function render() {
      if (dead) return;
      let body = '';
      if (!st.ready) body = `<div class="fi-login">…</div>`;
      else if (st.error && !st.me) body = `<div class="fi-login">${esc(st.error)}</div>`;
      else {
        const v = st.view;
        let content = '';
        if (v === 'workout') content = viewWorkout();
        else if (v === 'summary') content = viewSummary();
        else if (v === 'session') content = viewSession();
        else if (v === 'tpl') content = viewTpl();
        else if (v === 'exdetail') content = viewExDetail();
        else if (v === 'exform') content = viewExForm();
        else if (v === 'aiplan') content = viewAiPlan();
        else if (st.tab === 'today') content = viewToday();
        else if (st.tab === 'workouts') content = viewWorkouts();
        else if (st.tab === 'exercises') content = viewExercises();
        else if (st.tab === 'progress') content = viewProgress();
        else content = viewSettings();
        body = `${v === 'main' ? topbar() : ''}<div class="fi-body" id="fi-scroll">${content}${st.error ? `<div class="fi-err">${esc(st.error)}</div>` : ''}</div>${v === 'workout' ? bottomBar() : ''}${modal()}${st.toast ? `<div class="fi-toast">${esc(st.toast)}</div>` : ''}`;
      }
      const sc = w.querySelector('#fi-scroll'), top = sc ? sc.scrollTop : 0;
      if (disposeExercise3D) { disposeExercise3D(); disposeExercise3D = null; }
      w.innerHTML = body;
      const demo3d = w.querySelector('.fi-exercise-3d');
      if (demo3d) {
        const url = '/apps/fitness/exercise-3d.js';
        import(window.asset ? window.asset(url) : url).then(m => m.mountExercise3D(demo3d, demo3d.dataset.exercise)).then(dispose => {
          if (!demo3d.isConnected || dead) dispose(); else disposeExercise3D = dispose;
        }).catch(() => { demo3d.classList.add('fi-3d-unavailable'); });
      }
      const sc2 = w.querySelector('#fi-scroll'); if (sc2 && sc) sc2.scrollTop = top;
      mountPickers();
      updateTimers();
    }

    // ── Timers ───────────────────────────────────────────────────
    function updateTimers() {
      const a = st.active, el = w.querySelector('#fi-elapsed');
      if (el && a) el.textContent = fDur(Math.max(0, Date.now() / 1000 - a.started_ts));
      const tm = st.timer, te = w.querySelector('#fi-timer');
      if (tm && te) {
        if (tm.kind === 'rest') {
          const left = Math.ceil((tm.end - Date.now()) / 1000);
          if (left <= 0) { st.timer = null; beep(); const bar = w.querySelector('.fi-bottom'); if (bar) bar.remove(); return; }
          te.textContent = fDur(left);
        } else {
          const el2 = (Date.now() - tm.start) / 1000;
          te.textContent = fDur(el2);
          if (tm.target && !tm.warned && el2 >= tm.target) { tm.warned = true; beep(); }
        }
      }
    }
    tick = setInterval(updateTimers, 500);
    function startRest(sec) {
      if (!sec) { st.timer = null; return; }
      st.timer = { kind: 'rest', end: Date.now() + sec * 1000 };
    }
    function showToast(msg) {
      st.toast = msg; render();
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { st.toast = ''; render(); }, 4500);
    }

    // ── Reading a set row ────────────────────────────────────────
    function readRow(sid) {
      const row = w.querySelector(`.fi-set[data-sid="${sid}"]`); if (!row) return {};
      const sess = st.view === 'session' ? st.detail : st.active;
      const s = sess && sess.sets.find(x => x.id === sid);
      const ty = s ? s.ex_type : 'weight_reps', out = {};
      row.querySelectorAll('input[data-f]').forEach(inp => {
        const k = inp.dataset.f, raw = inp.value;
        if (raw === '') { out[k] = 0; return; }
        if (k === 'weight') out[k] = wk(num(raw));
        else if (k === 'dist') out[k] = dk(num(raw));
        else if (k === 'secs') out[k] = parseDur(raw, ty);
        else out[k] = num(raw);
      });
      return out;
    }
    function applySet(list, set) { const i = list.findIndex(x => x.id === set.id); if (i >= 0) list[i] = Object.assign(list[i], set); }

    // ── Actions ──────────────────────────────────────────────────
    async function refreshAfterChange() {
      await Promise.all([loadStats().catch(() => {}), loadDay().catch(() => {})]);
    }
    async function startSession(tid) {
      try {
        const sess = await send('POST', '/sessions', { day: todayStr(), template_id: tid || null, started_at: nowStr() });
        st.active = sess; st.me.active = sess.id; st.view = 'workout'; st.error = '';
      } catch (e) {
        if (e.status === 409 && e.data && e.data.session_id) { await loadActive(); st.view = 'workout'; }
        else st.error = errText(e);
      }
      render();
    }
    async function markDone(sid) {
      const a = st.active, s = a.sets.find(x => x.id === sid); if (!s) return;
      const vals = readRow(sid);
      const done = !s.done;
      try {
        const r = await send('PUT', `/sessions/${a.id}/sets/${sid}`, Object.assign({}, vals, { done, done_at: nowStr() }));
        applySet(a.sets, r);
        a.done_sets = a.sets.filter(x => x.done).length;
        if (done) {
          if (r.prs && r.prs.length) { beep(); showToast('🏆 ' + exName(r.ex_ref, r.ex_name) + ': ' + r.prs.map(prLabel).join(', ')); }
          // An interval workout rests exactly as planned; otherwise the set's own rest or the person's default.
          const rest = a.mode === 'interval' ? r.rest_s : (r.rest_s || st.me.settings.rest_s);
          // After the last set nothing is waited for.
          if (a.sets.some(x => !x.done) && rest > 0) startRest(rest); else st.timer = null;
        }
      } catch (e) { st.error = errText(e); }
      render();
    }
    async function saveRowQuiet(inp) {
      const row = inp.closest('.fi-set'); if (!row) return;
      const sid = row.dataset.sid, sess = st.view === 'session' ? st.detail : st.active; if (!sess) return;
      const s = sess.sets.find(x => x.id === sid); if (!s) return;
      const vals = readRow(sid);
      Object.assign(s, vals);
      try { const r = await send('PUT', `/sessions/${sess.id}/sets/${sid}`, vals); applySet(sess.sets, r); } catch (e) { st.error = errText(e); }
    }
    async function openExercise(ref) {
      try { st.exDetail = await api('/exercise/' + encodeURIComponent(ref)); if (st.view !== 'exdetail') st.exBack = st.view; st.view = 'exdetail'; st.error = ''; }
      catch (e) { st.error = errText(e); }
      render();
    }
    async function openSession(id) {
      try { st.detail = await api('/sessions/' + id); st.detailEdit = null; st.view = 'session'; st.error = ''; }
      catch (e) { st.error = errText(e); }
      render();
    }
    // The exercise created from the picker is handed back to whoever asked.
    function pickExercise(cb) { st.picker = { cb }; st.pendingPick = cb; st.exFilter = { q: '', muscle: '', equip: '' }; render(); }

    async function handle(act, el) {
      const d = el.dataset;
      switch (act) {
        case 'noop': return;
        case 'tab':
          st.tab = d.tab; st.view = 'main'; st.msg = ''; st.error = '';
          if (st.tab === 'today') { await Promise.all([loadActive(), refreshAfterChange()]).catch(() => {}); }
          if (st.tab === 'progress') { if (!st.stats) await loadStats().catch(() => {}); }
          return render();
        case 'sub':
          st.sub = d.sub;
          if (st.sub === 'history' && !st.history) { render(); const e = todayStr(); st.history = (await api(`/sessions?start=${shiftDay(e, -400)}&end=${e}`)).sessions; }
          if (st.sub === 'records' && !st.records) { render(); st.records = (await api('/records')).records; }
          return render();
        case 'range': await loadStats(+d.n); return render();
        case 'chart-metric': st.chartMetric = d.m; return render();
        case 'back-main': st.view = 'main'; st.error = ''; if (st.tab === 'today') await refreshAfterChange().catch(() => {}); return render();
        case 'resume': st.view = 'workout'; return render();
        case 'start-empty': return startSession(null);
        case 'start-tpl': return startSession(d.id);
        case 'open-session': return openSession(d.id);
        case 'open-ex': return openExercise(d.ref);
        case 'exdetail-back': st.view = st.exBack === 'workout' && st.active ? 'workout' : (st.exBack === 'session' && st.detail ? 'session' : 'main'); return render();
        case 'ex-chart': st.exChart = d.m; return render();
        case 'ex-muscle': st.exFilter.muscle = d.m; return render();
        // set rows
        case 'done': return markDone(d.sid);
        case 'kind': {
          const sess = st.view === 'session' ? st.detail : st.active, s = sess.sets.find(x => x.id === d.sid);
          const nk = s.kind === 'normal' ? 'warmup' : s.kind === 'warmup' ? 'failure' : 'normal';
          try { const r = await send('PUT', `/sessions/${sess.id}/sets/${d.sid}`, Object.assign(readRow(d.sid), { kind: nk })); applySet(sess.sets, r); } catch (e) { st.error = errText(e); }
          return render();
        }
        case 'del-set': {
          const sess = st.view === 'session' ? st.detail : st.active;
          try {
            if (st.view === 'session') { await send('DELETE', `/sessions/${sess.id}/sets/${d.sid}`); st.detail = await api('/sessions/' + sess.id); }
            else st.active = await send('DELETE', `/sessions/${sess.id}/sets/${d.sid}`);
          } catch (e) { st.error = errText(e); }
          return render();
        }
        case 'add-set': case 'add-warm':
          try { st.active = await send('POST', `/sessions/${st.active.id}/sets`, { ex_ref: d.ref, kind: act === 'add-warm' ? 'warmup' : 'normal' }); } catch (e) { st.error = errText(e); }
          return render();
        case 'rm-ex':
          try { st.active = await send('DELETE', `/sessions/${st.active.id}/exercise/${encodeURIComponent(d.ref)}`); } catch (e) { st.error = errText(e); }
          return render();
        case 'add-ex':
          return pickExercise(async ref => {
            try { st.active = await send('POST', `/sessions/${st.active.id}/sets`, { ex_ref: ref, sets: 3 }); } catch (e) { st.error = errText(e); }
            render();
          });
        case 'picker-pick': { const cb = st.picker && st.picker.cb; st.picker = null; if (cb) await cb(d.ref); return; }
        case 'picker-close': st.picker = null; return render();
        case 'picker-new': st.picker = null; return openExForm(null, true);
        // timers
        case 'rest-add': if (st.timer && st.timer.kind === 'rest') st.timer.end = Math.max(Date.now() + 1000, st.timer.end + (+d.n) * 1000); return render();
        case 'rest-skip': st.timer = null; return render();
        case 'set-timer': {
          const s = st.active.sets.find(x => x.id === d.sid);
          st.timer = { kind: 'work', sid: d.sid, start: Date.now(), target: s.t_secs || 0 };
          return render();
        }
        case 'timer-cancel': st.timer = null; return render();
        case 'timer-stop': {
          const tm = st.timer; st.timer = null;
          const s = st.active.sets.find(x => x.id === tm.sid);
          const secs = Math.round((Date.now() - tm.start) / 1000);
          const row = w.querySelector(`.fi-set[data-sid="${tm.sid}"] input[data-f="secs"]`);
          if (row) row.value = fDur(secs);
          if (s) s.secs = secs;
          await markDone(tm.sid); return;
        }
        // finishing
        case 'finish': {
          const a = st.active, dur = Math.max(1, Math.round((Date.now() / 1000 - a.started_ts) / 60));
          if (!a.sets.some(x => x.done)) { st.error = t('fi_err_nothing_done'); return render(); }
          st.timer = null; st.error = '';
          st.finish = { duration_min: dur > 480 ? '' : dur, notes: a.notes || '', day: a.day, skipped: a.sets.filter(x => !x.done).length }; st.msg = '';
          return render();
        }
        case 'finish-cancel': st.finish = null; st.msg = ''; return render();
        case 'finish-save': {
          const f = st.finish, a = st.active;
          const dur = w.querySelector('#fi-fdur').value, notes = w.querySelector('#fi-fnotes').value;
          try {
            const r = await send('POST', `/sessions/${a.id}/finish`, { notes, duration_min: dur === '' ? null : num(dur), day: f.day });
            st.summary = r; st.active = null; st.finish = null; st.timer = null; st.view = 'summary'; st.history = null; st.records = null; st.msg = '';
            await refreshAfterChange().catch(() => {});
          } catch (e) { st.msg = errText(e); }
          return render();
        }
        case 'summary-close': st.view = 'main'; st.tab = 'today'; st.summary = null; return render();
        case 'discard':
          if (!confirm(t('fi_discard_confirm'))) return;
          try { await send('DELETE', `/sessions/${st.active.id}`); st.active = null; st.timer = null; st.view = 'main'; } catch (e) { st.error = errText(e); }
          return render();
        // finished session
        case 'sess-edit':
          if (st.detailEdit) st.detailEdit = null;
          else st.detailEdit = { name: st.detail.name, notes: st.detail.notes, day: st.detail.day, duration_min: Math.round(st.detail.duration_s / 60) };
          return render();
        case 'sess-save': {
          try {
            st.detail = await send('PUT', `/sessions/${st.detail.id}`, { name: w.querySelector('#fi-sn').value, notes: w.querySelector('#fi-snotes').value,
              day: st.detailEdit.day, duration_min: num(w.querySelector('#fi-sdur').value) || null });
            st.detailEdit = null; st.history = null; st.records = null; await refreshAfterChange().catch(() => {});
          } catch (e) { st.error = errText(e); }
          return render();
        }
        case 'sess-delete':
          if (!confirm(t('fi_delete_confirm'))) return;
          try { await send('DELETE', `/sessions/${st.detail.id}`); st.history = null; st.records = null; st.view = 'main'; await refreshAfterChange().catch(() => {}); } catch (e) { st.error = errText(e); }
          return render();
        case 'sess-template':
          try { const tp = await send('POST', `/templates/from-session/${st.detail.id}`); st.me.templates.push(tp); showToast(t('fi_saved')); } catch (e) { st.error = errText(e); render(); }
          return;
        // workouts
        case 'new-tpl': st.tpl = newTpl(); st.view = 'tpl'; st.msg = ''; return render();
        case 'edit-tpl': st.tpl = JSON.parse(JSON.stringify(st.me.templates.find(x => x.id === d.id))); st.view = 'tpl'; st.msg = ''; return render();
        case 'tpl-back': st.tpl = null; st.view = 'main'; return render();
        case 'tpl-day': syncTplFromDom(); { const n = +d.d, i = st.tpl.days.indexOf(n); if (i >= 0) st.tpl.days.splice(i, 1); else st.tpl.days.push(n); } return render();
        case 'tpl-add': syncTplFromDom(); return pickExercise(ref => { st.tpl.items.push({ ex_ref: ref, sets: 3, reps: 0, weight: 0, secs: 0, dist: 0, rest_s: 0, group_no: 0 }); render(); });
        case 'tpl-rm': syncTplFromDom(); st.tpl.items.splice(+d.i, 1); return render();
        case 'tpl-up': case 'tpl-down': {
          syncTplFromDom();
          const i = +d.i, j = act === 'tpl-up' ? i - 1 : i + 1, it = st.tpl.items;
          if (j >= 0 && j < it.length) { const x = it[i]; it[i] = it[j]; it[j] = x; }
          return render();
        }
        case 'tpl-save': {
          syncTplFromDom();
          const f = st.tpl;
          if (!f.name.trim()) { st.msg = t('fi_err_invalid_name'); return render(); }
          if (!f.items.length) { st.msg = t('fi_err_invalid_items'); return render(); }
          try {
            const r = f.id ? await send('PUT', '/templates/' + f.id, f) : await send('POST', '/templates', f);
            const i = st.me.templates.findIndex(x => x.id === r.id);
            if (i >= 0) st.me.templates[i] = r; else st.me.templates.push(r);
            st.tpl = null; st.view = 'main'; st.msg = '';
          } catch (e) { st.msg = errText(e); }
          return render();
        }
        case 'tpl-delete':
          if (!confirm(t('fi_delete_confirm'))) return;
          try { await send('DELETE', '/templates/' + st.tpl.id); st.me.templates = st.me.templates.filter(x => x.id !== st.tpl.id); st.tpl = null; st.view = 'main'; } catch (e) { st.msg = errText(e); }
          return render();
        // own exercises
        case 'ex-new': return openExForm(null, false);
        case 'ex-edit': return openExForm(st.me.custom.find(x => x.ref === d.ref), false);
        case 'exform-back': st.exForm = null; st.view = st.exFormBack || 'main'; return render();
        case 'exform-save': {
          const f = st.exForm;
          f.name = w.querySelector('#fi-xn').value; f.type = w.querySelector('#fi-xt').value; f.muscle = w.querySelector('#fi-xm').value; f.equip = w.querySelector('#fi-xe').value;
          try {
            const r = f.id ? await send('PUT', '/exercises/' + f.id, f) : await send('POST', '/exercises', f);
            const i = st.me.custom.findIndex(x => x.ref === r.ref);
            if (i >= 0) st.me.custom[i] = r; else st.me.custom.push(r);
            indexExercises();
            const back = st.exFormCb, was = st.exFormBack; st.exForm = null; st.view = was || 'main'; st.msg = '';
            if (was === 'exdetail') { await openExercise(r.ref); return; }
            render();
            if (back) await back(r.ref);
            return;
          } catch (e) { st.msg = errText(e); }
          return render();
        }
        case 'exform-delete':
          if (!confirm(t('fi_delete_confirm'))) return;
          try { await send('DELETE', '/exercises/' + st.exForm.id); st.me.custom = st.me.custom.filter(x => x.id !== st.exForm.id); indexExercises(); st.exForm = null; st.view = 'main'; st.tab = 'exercises'; } catch (e) { st.msg = errText(e); }
          return render();
        // settings
        case 'settings-save': {
          const g = id => w.querySelector('#' + id);
          const body = { rest_s: Math.round(num(g('fi-srest').value)) || 90, week_goal: Math.round(num(g('fi-sgoal').value)) || 3 };
          if (!st.me.settings.health_read) {
            body.weight_kg = g('fi-sw').value === '' ? 0 : wk(num(g('fi-sw').value)); body.age = Math.round(num(g('fi-sage').value)); body.sex = g('fi-ssex').value;
          }
          try { st.me.settings = await send('PUT', '/settings', body); st.msg = t('fi_saved'); st.msgOk = true; await loadStats().catch(() => {}); } catch (e) { st.msg = errText(e); st.msgOk = false; }
          return render();
        }
        // AI
        case 'ai-plan': st.aiPlan = { goal: 'general', days: 3, minutes: 45, level: 'beginner', equipment: '', note: '', busy: false, error: '', result: null }; st.view = 'aiplan'; return render();
        case 'aiplan-cancel': st.aiPlan = null; st.view = 'main'; return render();
        case 'aiplan-go': {
          const a = st.aiPlan, g = id => w.querySelector('#' + id);
          a.goal = g('fi-ag').value; a.days = +g('fi-ad').value; a.minutes = +g('fi-am').value; a.level = g('fi-al').value; a.equipment = g('fi-aeq').value; a.note = g('fi-anote').value;
          a.busy = true; a.error = ''; render();
          try {
            const r = await send('POST', '/ai/plan', { goal: GOALS[a.goal], days: a.days, minutes: a.minutes, level: a.level, equipment: a.equipment, note: a.note, lang: lang() });
            a.result = r; aiNote(r);
          } catch (e) { a.error = aiError(e); }
          a.busy = false; return render();
        }
        case 'aiplan-save': {
          const a = st.aiPlan, picks = [...w.querySelectorAll('[data-ai-pick]')].filter(x => x.checked).map(x => a.result.workouts[+x.dataset.aiPick]);
          a.busy = true; render();
          try {
            for (const wk2 of picks) { const r = await send('POST', '/templates', Object.assign({ mode: 'standard' }, wk2)); st.me.templates.push(r); }
            st.aiPlan = null; st.view = 'main'; st.tab = 'workouts';
          } catch (e) { a.error = errText(e); a.busy = false; }
          return render();
        }
        case 'ai-review': {
          st.aiReview = { busy: true }; render();
          try { const r = await send('POST', '/ai/review', { lang: lang() }); aiNote(r); st.aiReview = { result: r }; } catch (e) { st.aiReview = { error: aiError(e) }; }
          return render();
        }
      }
    }
    function openExForm(ex, fromPicker) {
      st.exForm = ex ? Object.assign({}, ex) : { id: null, name: '', type: 'weight_reps', muscle: 'chest', equip: 'dumbbell' };
      if (ex) st.exForm.id = ex.id;
      st.exFormBack = fromPicker ? st.view : (st.view === 'exdetail' ? 'exdetail' : 'main');
      st.exFormCb = fromPicker ? (st.pendingPick || null) : null;
      st.msg = ''; st.view = 'exform';
      return render();
    }

    // Events -------------------------------------------------------
    w.addEventListener('click', e => {
      const el = e.target.closest('[data-act]');
      if (!el || !w.contains(el)) return;
      handle(el.dataset.act, el).catch(err => { st.error = errText(err); render(); });
    });
    w.addEventListener('change', e => {
      const el = e.target;
      if (el.id === 'fi-equip-filter') { st.exFilter.equip = el.value; render(); return; }
      if (el.matches('.fi-set input[data-f]')) { saveRowQuiet(el); return; }
      if (el.id === 'fi-tm') { syncTplFromDom(); st.tpl.mode = el.value; render(); return; }
      if (el.matches('[data-k="group_no"]')) { syncTplFromDom(); return; }
      if (el.id === 'fi-hsend' || el.id === 'fi-hread' || el.id === 'fi-hother') {
        const body = el.id === 'fi-hsend' ? { enabled: el.checked } : el.id === 'fi-hread' ? { read: el.checked } : { read_other: el.checked };
        send('PUT', '/health', body).then(async () => { st.me = Object.assign(st.me, await api('/me')); render(); }).catch(err => { st.error = errText(err); render(); });
      }
    });
    w.addEventListener('input', e => {
      const el = e.target;
      if (el.id === 'fi-exq') {
        st.exFilter.q = el.value;
        const box = w.querySelector('#fi-exlist');
        if (box) { const tmp = document.createElement('div'); tmp.innerHTML = exerciseList(st.picker ? 'picker-pick' : 'open-ex'); box.innerHTML = tmp.querySelector('#fi-exlist').innerHTML; }
      }
    });

    init();
    return {
      destroy() { dead = true; if (disposeExercise3D) disposeExercise3D(); clearInterval(tick); clearTimeout(toastTimer); destroyPicker(); }
    };
  }

  window.FitnessWidget = { mount };
})();
