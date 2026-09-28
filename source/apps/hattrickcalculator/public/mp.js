/*
 * Hattrick Calculator — runs on Game Hub's generic play page (NOT inside mvmOS).
 *
 * There is no game here: the room only gives the page an Apps Hub account.
 * Everything is calculated in the browser. The squad (every player with their
 * skills and the dates their skills went up) and the team settings (training,
 * lineup choices, arena) are kept on the manager's profile through this app's
 * own api.py at /pub/hattrickcalculator.
 *
 * Nothing here is Hattrick's own match engine or training formula; those are
 * not public. The ratings are an estimate that is good for comparing lineups,
 * and the training forecast starts from a rough model that the manager's own
 * recorded skill-ups then correct, player by player.
 */
(function () {
  if (!window.GameHub || !window.GameHub.mp) return;
  const mp = window.GameHub.mp;

  const GAME_ID = 'hattrickcalculator';
  const API = '/pub/hattrickcalculator';
  const HUB_URL = '/pub/gamehub/?game=' + GAME_ID;

  function tr(k, vars) {
    let s = window.t ? window.t(k) : k;
    if (vars) Object.keys(vars).forEach(n => { s = String(s).split('{' + n + '}').join(vars[n]); });
    return s;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const lang = () => (window.mvmOS && window.mvmOS.lang) || 'en';
  function numFmt(v, dec) {
    try { return Number(v).toLocaleString(lang(), { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
    catch (_) { return Number(v).toFixed(dec || 0); }
  }
  function clampInt(v, lo, hi, def) {
    const n = parseInt(v, 10);
    return isNaN(n) ? def : Math.min(hi, Math.max(lo, n));
  }
  function clampNum(v, lo, hi, def) {
    const n = parseFloat(v);
    return isNaN(n) ? def : Math.min(hi, Math.max(lo, n));
  }

  // ── Dates and Hattrick age ─────────────────────────────────────────────────
  // A Hattrick year is 112 days, and a player gets one day older every real day.
  const HT_YEAR = 112;
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  function dayNo(iso) {
    const m = DATE_RE.exec(iso || '');
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
  }
  function isoOf(day) {
    const d = new Date(day * 86400000);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const validDate = iso => (dayNo(iso) != null ? iso : null);
  function fmtDate(iso) {
    const m = DATE_RE.exec(iso || '');
    if (!m) return iso || '';
    try {
      return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (_) { return iso; }
  }
  // Age in days on a given date, from the age the manager typed and when.
  function ageDays(p, iso) {
    const from = dayNo(p.age.on), at = dayNo(iso || today());
    return p.age.y * HT_YEAR + p.age.d + Math.max(0, (at ?? 0) - (from ?? 0));
  }
  function ageLabel(p) {
    const a = ageDays(p);
    return tr('htc_age_fmt', { y: Math.floor(a / HT_YEAR), d: a % HT_YEAR });
  }

  // ── Fixed data ─────────────────────────────────────────────────────────────
  const SKILLS = ['kp', 'df', 'pm', 'wi', 'ps', 'sc', 'sp'];
  const MAX_LEVEL = 20;
  const levelName = n => tr('htc_lv_' + Math.max(0, Math.min(MAX_LEVEL, n)));
  const levelOpt = (n, sel) => '<option value="' + n + '"' + (n === sel ? ' selected' : '') + '>' + n + ' · ' + esc(levelName(n)) + '</option>';
  function levelOptions(lo, hi, sel) {
    let s = '';
    for (let n = lo; n <= hi; n++) s += levelOpt(n, sel);
    return s;
  }
  const SPECS = ['technical', 'quick', 'powerful', 'unpredictable', 'head', 'resilient', 'support'];
  const SPEC_ICON = { technical: '🔧', quick: '⚡', powerful: '💪', unpredictable: '🎲', head: '🎯', resilient: '🛡️', support: '🤝' };

  // Positions and what each skill adds to each part of the pitch, in normal
  // behaviour. Sectors: m midfield, dc/ac central defence/attack, ds/as the
  // defence/attack on the player's own side. A central player splits his side
  // share evenly between both sides. Approximate, for comparing lineups only.
  const POSITIONS = ['GK', 'WB', 'CD', 'W', 'IM', 'FW'];
  const CONTRIB = {
    GK: [['kp', 'dc', 0.87], ['kp', 'ds', 1.22], ['df', 'dc', 0.35], ['df', 'ds', 0.5]],
    CD: [['df', 'dc', 1.0], ['df', 'ds', 0.52], ['pm', 'm', 0.25]],
    WB: [['df', 'ds', 0.92], ['df', 'dc', 0.38], ['wi', 'as', 0.45], ['pm', 'm', 0.15]],
    IM: [['pm', 'm', 1.0], ['df', 'dc', 0.4], ['df', 'ds', 0.19], ['ps', 'ac', 0.33], ['ps', 'as', 0.26]],
    W:  [['wi', 'as', 0.86], ['pm', 'm', 0.45], ['df', 'ds', 0.35], ['df', 'dc', 0.2], ['ps', 'as', 0.26], ['ps', 'ac', 0.11]],
    FW: [['sc', 'ac', 1.0], ['sc', 'as', 0.54], ['ps', 'ac', 0.33], ['ps', 'as', 0.28], ['wi', 'as', 0.24], ['pm', 'm', 0.33]],
  };
  // More players in the same central line get in each other's way.
  const CROWD = {
    CD: [1, 1, 0.964, 0.9],
    IM: [1, 1, 0.935, 0.825],
    FW: [1, 1, 0.945, 0.865],
  };
  const SECTORS = ['m', 'dr', 'dc', 'dl', 'ar', 'ac', 'al'];
  const FOCUS = {
    balanced: { m: 3, d: 1, a: 1 },
    attack:   { m: 3, d: 0.7, a: 1.4 },
    defense:  { m: 3, d: 1.4, a: 0.7 },
  };
  const FORMATIONS = ['5-5-0', '5-4-1', '5-3-2', '5-2-3', '4-5-1', '4-4-2', '4-3-3', '3-5-2', '3-4-3', '2-5-3'];

  // Hattrick training types: the skill they train and how much of the full
  // training each position gets.
  const TRAININGS = {
    keeper:     { skill: 'kp', pos: { GK: 1 } },
    defending:  { skill: 'df', pos: { CD: 1, WB: 1 } },
    defpos:     { skill: 'df', pos: { GK: 0.5, WB: 0.5, CD: 0.5, W: 0.5, IM: 0.5 } },
    playmaking: { skill: 'pm', pos: { IM: 1, W: 0.5 } },
    winger:     { skill: 'wi', pos: { W: 1, WB: 0.5 } },
    wingatt:    { skill: 'wi', pos: { W: 0.6, FW: 0.6 } },
    passing:    { skill: 'ps', pos: { IM: 1, W: 1, FW: 1 } },
    through:    { skill: 'ps', pos: { WB: 0.85, CD: 0.85, IM: 0.85, W: 0.85 } },
    scoring:    { skill: 'sc', pos: { FW: 1 } },
    // Shooting gives Scoring training to outfield players. It also gives a
    // slower Set pieces effect to every player, which is not forecast here
    // because this calculator tracks one trained skill at a time.
    shooting:   { skill: 'sc', pos: { WB: 0.6, CD: 0.6, W: 0.6, IM: 0.6, FW: 0.6 } },
    setpieces:  { skill: 'sp', pos: { GK: 1, WB: 1, CD: 1, W: 1, IM: 1, FW: 1 } },
  };
  const TRAINING_KEYS = Object.keys(TRAININGS);
  // Relative speeds calibrated to Hattrick's published training table:
  // a 17-year-old from solid to excellent, solid coach, 100% intensity,
  // 15% stamina share and two level-5 assistant coaches.  The game does not
  // publish its exact formula, so these remain an estimate between skill-ups.
  const TRAINING_SPEED = {
    keeper: 0.58, defending: 0.96, defpos: 0.96,
    playmaking: 0.77, winger: 0.58, wingatt: 0.58,
    passing: 0.77, through: 0.82, scoring: 0.77,
    shooting: 0.81, setpieces: 0.19,
  };
  // Coach levels on the skill scale: weak (4) to excellent (8).
  const COACH = { 4: 1.7, 5: 1.45, 6: 1.27, 7: 1.12, 8: 1 };

  // The league match trains one group of players, the cup or friendly match
  // of the same week another.
  const MATCHES = ['league', 'cup', 'friendly'];
  const GROUP_OF_MATCH = { league: 'trainees', cup: 'cup', friendly: 'cup' };
  const MATCH_ICON = { league: '🏟️', cup: '🏆', friendly: '🤝' };
  const GROUP_ICON = { trainees: MATCH_ICON.league, cup: MATCH_ICON.cup };

  const SEATS = ['terraces', 'basic', 'roof', 'vip'];
  const SEAT_ICON = { terraces: '🧍', basic: '🪑', roof: '⛱️', vip: '🥂' };

  function trainingSnapshot(t) {
    if (!t || !TRAININGS[t.type]) return null;
    return {
      type: t.type,
      coach: clampInt(t.coach, 4, 8, 7),
      // Hattrick has two assistant slots, with up to five training-skill
      // levels each. We store their combined level, not their headcount.
      assistants: clampInt(t.assistants, 0, 10, 0),
      intensity: clampInt(t.intensity, 0, 100, 100),
      stamina: clampInt(t.stamina, 10, 100, 10),
    };
  }
  function sameTraining(a, b) {
    return !!a && !!b && a.type === b.type && a.coach === b.coach
      && a.assistants === b.assistants && a.intensity === b.intensity && a.stamina === b.stamina;
  }

  // ── Players ────────────────────────────────────────────────────────────────
  function normPlayer(r) {
    const d = (r && r.data) || {};
    const a = d.age || {};
    const sk = d.skills || {};
    return {
      id: r ? r.id : null,
      name: String(d.name || ''),
      // The player's id in Hattrick, set by an import and used to find him
      // again the next time, whatever he was renamed to here.
      htid: /^\d{1,12}$/.test(String(d.htid || '')) ? String(d.htid) : '',
      age: { y: clampInt(a.y, 15, 45, 17), d: clampInt(a.d, 0, HT_YEAR - 1, 0), on: validDate(a.on) || today() },
      spec: SPECS.includes(d.spec) ? d.spec : '',
      skills: Object.fromEntries(SKILLS.map(s => [s, clampInt(sk[s], 0, MAX_LEVEL, 0)])),
      form: clampInt(d.form, 1, 8, 6),
      stamina: clampInt(d.stamina, 1, 9, 6),
      xp: clampInt(d.xp, 0, 20, 2),
      lead: clampInt(d.lead, 1, 8, 3),
      loyalty: clampInt(d.loyalty, 1, 20, 1),
      homegrown: d.homegrown === true,
      out: d.out === true,
      // A light injury: he can still play.
      bruised: d.bruised === true,
      // Yellow cards: the next one at two means a suspension.
      cards: clampInt(d.cards, 0, 2, 0),
      tsi: d.tsi == null || d.tsi === '' ? null : clampInt(d.tsi, 0, 1e9, null),
      wage: d.wage == null || d.wage === '' ? null : clampNum(d.wage, 0, 1e9, null),
      notes: typeof d.notes === 'string' ? d.notes.slice(0, 500) : '',
      added: validDate(d.added) || validDate(r && r.created_at && r.created_at.slice(0, 10)) || today(),
      history: (Array.isArray(d.history) ? d.history : [])
        .filter(h => h && SKILLS.includes(h.skill) && validDate(h.date))
        .map(h => ({ date: h.date, skill: h.skill, from: clampInt(h.from, 0, MAX_LEVEL, 0), to: clampInt(h.to, 0, MAX_LEVEL, 0), training: trainingSnapshot(h.training) }))
        .slice(-300),
    };
  }
  function playerData(p) {
    const o = Object.assign({}, p);
    delete o.id;
    return o;
  }
  function newPlayer() {
    const p = normPlayer(null);
    p.added = today();
    return p;
  }

  // Form, stamina, loyalty and experience turned into one multiplier on a
  // skill. Rough, but in the direction and size the game shows.
  function effSkill(p, sk) {
    const bonus = p.homegrown ? 1.5 : p.loyalty / 20;
    const form = Math.pow(Math.max(0.1, (p.form - 0.5) / 7), 0.45);
    const stam = 0.85 + 0.15 * (p.stamina / 9);
    const xp = 1 + 0.01 * p.xp;
    return (p.skills[sk] + bonus) * form * stam * xp;
  }

  // What a player adds to every sector in one slot.
  function contrib(p, pos, side, crowd) {
    const out = { m: 0, dr: 0, dc: 0, dl: 0, ar: 0, ac: 0, al: 0 };
    CONTRIB[pos].forEach(([sk, sec, w]) => {
      const v = effSkill(p, sk) * w * crowd;
      if (sec === 'm' || sec === 'dc' || sec === 'ac') out[sec] += v;
      else {
        const line = sec[0];
        if (side === 'R') out[line + 'r'] += v;
        else if (side === 'L') out[line + 'l'] += v;
        else { out[line + 'r'] += v / 2; out[line + 'l'] += v / 2; }
      }
    });
    return out;
  }
  function weigh(c, focus) {
    const f = FOCUS[focus] || FOCUS.balanced;
    return c.m * f.m + (c.dr + c.dc + c.dl) * f.d + (c.ar + c.ac + c.al) * f.a;
  }
  // A player's best position on his own, for the squad list. Each position is
  // measured against what it adds at most per skill level, otherwise the
  // triple-weighted midfield would make everyone an inner midfielder.
  const POS_SCALE = Object.fromEntries(Object.keys(CONTRIB).map(pos => {
    const f = FOCUS.balanced;
    return [pos, CONTRIB[pos].reduce((sum, [, sec, w]) => sum + w * (sec === 'm' ? f.m : sec[0] === 'd' ? f.d : f.a), 0)];
  }));
  function bestPos(p) {
    let best = null, bv = -1;
    POSITIONS.forEach(pos => {
      const v = weigh(contrib(p, pos, 'C', 1), 'balanced') / POS_SCALE[pos];
      if (v > bv) { bv = v; best = pos; }
    });
    return best;
  }

  // ── Lineup optimiser ───────────────────────────────────────────────────────
  const SIDES = { 1: ['C'], 2: ['R', 'L'], 3: ['R', 'C', 'L'] };
  function structures(name) {
    const [d, m, f] = name.split('-').map(Number);
    const out = [];
    [0, 2].forEach(wb => {
      const cd = d - wb;
      if (cd < 1 || cd > 3) return;
      [0, 2].forEach(w => {
        const im = m - w;
        if (im > 3 || (im < 1 && m > 0)) return;
        if (f > 3) return;
        out.push({ name, wb, cd, w, im: Math.max(0, im), fw: f });
      });
    });
    return out;
  }
  function slotsOf(st) {
    const s = [{ pos: 'GK', side: 'C' }];
    if (st.wb) s.push({ pos: 'WB', side: 'R' }, { pos: 'WB', side: 'L' });
    (SIDES[st.cd] || []).forEach(side => s.push({ pos: 'CD', side }));
    if (st.w) s.push({ pos: 'W', side: 'R' }, { pos: 'W', side: 'L' });
    (SIDES[st.im] || []).forEach(side => s.push({ pos: 'IM', side }));
    (SIDES[st.fw] || []).forEach(side => s.push({ pos: 'FW', side }));
    s.forEach(x => {
      x.id = x.pos + '-' + x.side;
      x.crowd = CROWD[x.pos] ? CROWD[x.pos][st[x.pos.toLowerCase()]] : 1;
    });
    return s;
  }

  // Hungarian algorithm: the cheapest one-to-one assignment of n rows to
  // m >= n columns.
  function hungarian(a) {
    const n = a.length, m = a[0].length, INF = 1e18;
    const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0);
    const p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(INF), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = INF, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const ans = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j]) ans[p[j] - 1] = j - 1;
    return ans;
  }

  const TRAINEE_BONUS = 10000;
  // The best lineup for one formation shape, keeping every locked slot.
  function solve(st, pool, opts) {
    const slots = slotsOf(st);
    const assigned = {};
    const lockedIds = new Set();
    slots.forEach(s => {
      const pid = opts.locks[s.id];
      const pl = pid != null ? pool.find(p => p.id === pid) : null;
      if (pl && !lockedIds.has(pl.id)) { assigned[s.id] = pl; lockedIds.add(pl.id); }
    });
    const open = slots.filter(s => !assigned[s.id]);
    const free = pool.filter(p => !lockedIds.has(p.id));
    const training = TRAININGS[opts.training] || null;
    const isTrainee = p => opts.useTrainees && opts.trainees.has(p.id);
    if (open.length) {
      // Empty "players" fill the gap when the squad is short.
      const cols = free.concat(new Array(Math.max(0, open.length - free.length)).fill(null));
      const cost = open.map(s => cols.map(p => {
        if (!p) return 0;
        let v = weigh(contrib(p, s.pos, s.side, s.crowd), opts.focus);
        if (training && isTrainee(p) && training.pos[s.pos]) v += TRAINEE_BONUS * training.pos[s.pos];
        return -v;
      }));
      hungarian(cost).forEach((j, i) => { if (j >= 0 && cols[j]) assigned[open[i].id] = cols[j]; });
    }
    const total = { m: 0, dr: 0, dc: 0, dl: 0, ar: 0, ac: 0, al: 0 };
    let trained = 0;
    slots.forEach(s => {
      const p = assigned[s.id];
      if (!p) return;
      const c = contrib(p, s.pos, s.side, s.crowd);
      SECTORS.forEach(k => { total[k] += c[k]; });
      if (training && isTrainee(p) && training.pos[s.pos]) trained++;
    });
    return { st, slots, assigned, ratings: total, score: weigh(total, opts.focus), trained };
  }

  function bestLineups(opts, playerPool) {
    const pool = playerPool || players.filter(p => !p.out);
    const names = opts.formation === 'auto' ? FORMATIONS : [opts.formation];
    const results = [];
    names.forEach(n => {
      let best = null;
      structures(n).forEach(st => {
        const r = solve(st, pool, opts);
        if (!best || r.trained > best.trained || (r.trained === best.trained && r.score > best.score)) best = r;
      });
      if (best) results.push(best);
    });
    results.sort((a, b) => (b.trained - a.trained) || (b.score - a.score));
    return results;
  }

  // Hattrick's bench: one substitute for each position, then an extra one.
  const BENCH = ['GK', 'CD', 'WB', 'IM', 'W', 'FW'];
  // The best substitutes for a lineup from the players left out of it, each
  // on one place only, with the starter he would replace: the weakest one
  // in that position.
  function benchFor(best, focus, pool) {
    const used = new Set(Object.values(best.assigned).map(p => p.id));
    const free = (pool || players).filter(p => !p.out && !used.has(p.id));
    const value = (p, pos) => weigh(contrib(p, pos, 'C', 1), focus);
    const subs = [];
    if (free.length) {
      const cols = free.concat(new Array(Math.max(0, BENCH.length - free.length)).fill(null));
      hungarian(BENCH.map(pos => cols.map(p => p ? -value(p, pos) : 0))).forEach((j, i) => {
        if (j >= 0 && cols[j]) subs.push({ pos: BENCH[i], player: cols[j] });
      });
    }
    // The extra one: whoever is left who is closest to his best, measured
    // the same way as a player's best position.
    const taken = new Set(subs.map(x => x.player.id));
    let extra = null;
    free.filter(p => !taken.has(p.id)).forEach(p => BENCH.forEach(pos => {
      const v = value(p, pos) / POS_SCALE[pos];
      if (!extra || v > extra.v) extra = { pos, player: p, v, extra: true };
    }));
    if (extra) subs.push(extra);
    subs.forEach(x => {
      const starters = best.slots.filter(s => s.pos === x.pos && best.assigned[s.id]).map(s => best.assigned[s.id]);
      x.replaces = starters.sort((a, b) => value(a, x.pos) - value(b, x.pos))[0] || null;
    });
    subs.sort((a, b) => (a.extra ? 1 : 0) - (b.extra ? 1 : 0) || BENCH.indexOf(a.pos) - BENCH.indexOf(b.pos));
    return subs;
  }

  // ── Training forecast ──────────────────────────────────────────────────────
  // Weeks for one level. The baseline and relative speeds follow Hattrick's
  // published training table; individual hidden progress can still move a
  // real skill-up by roughly a week either way.
  function modelWeeks(level, ageInDays, skill, t, share) {
    if (!share) return Infinity;
    const base = 2 + 0.45 * level + 0.02 * level * level;
    // Hattrick's public rule of thumb is about four percent per year over 17.
    const age = Math.pow(1.04, Math.max(0, ageInDays / HT_YEAR - 17));
    const coach = COACH[t.coach] || 1;
    // Ten combined assistant levels changes the published example from about
    // seven to about five weeks: roughly a 40% training-speed bonus.
    const assist = 1 + 0.04 * clampInt(t.assistants, 0, 10, 0);
    const intensity = Math.max(0.1, t.intensity / 100);
    const stamina = Math.max(0.1, (100 - t.stamina) / 90);
    const speed = TRAINING_SPEED[t.type] || 1;
    return base * speed * age * coach / assist / intensity / stamina / share;
  }
  // Consecutive skill-ups of one skill: how long they really took against
  // the model. Their median is the correction for what comes next.
  function popRatios(p, skill, t) {
    const ups = p.history.filter(h => h.skill === skill && h.to === h.from + 1)
      .sort((a, b) => dayNo(a.date) - dayNo(b.date));
    const current = trainingSnapshot(t);
    const out = [];
    for (let i = 1; i < ups.length; i++) {
      if (ups[i].from !== ups[i - 1].to) continue;
      // A recorded interval is comparable only when the same training setup
      // was in use at both ends. Older entries without a setup are estimates,
      // not evidence for the current forecast.
      if (!sameTraining(ups[i - 1].training, current) || !sameTraining(ups[i].training, current)) continue;
      const weeks = (dayNo(ups[i].date) - dayNo(ups[i - 1].date)) / 7;
      const model = modelWeeks(ups[i].from, ageDays(p, ups[i - 1].date), skill, t, 1);
      if (weeks > 0 && isFinite(model)) out.push(Math.min(3, Math.max(0.3, weeks / model)));
    }
    return out;
  }
  function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }
  function teamFactor(t) {
    const all = [];
    players.forEach(p => SKILLS.forEach(sk => all.push(...popRatios(p, sk, t))));
    return { factor: median(all), n: all.length };
  }
  function lastChange(p, skill) {
    const h = p.history.filter(x => x.skill === skill).sort((a, b) => dayNo(b.date) - dayNo(a.date))[0];
    return h ? h.date : p.added;
  }
  function forecast(p, t, team, bonus) {
    const tt = TRAININGS[t.type];
    const skill = tt.skill;
    const share = Math.max(...POSITIONS.map(pos => tt.pos[pos] || 0)) * (bonus || 1);
    const own = popRatios(p, skill, t).slice(-4);
    const factor = t.type === 'setpieces' ? 1 : (own.length ? median(own) : (team.factor || 1));
    const level = p.skills[skill];
    const since = lastChange(p, skill);
    const weeks = level >= MAX_LEVEL ? Infinity : modelWeeks(level, ageDays(p, since), skill, t, share) * factor;
    const elapsed = Math.max(0, (dayNo(today()) - dayNo(since)) / 7);
    // Levels over the next season (16 weeks), stepping level by level.
    let gained = 0, at = dayNo(since), lvl = level;
    const end = dayNo(today()) + 16 * 7;
    let projected = level;
    while (lvl < MAX_LEVEL && gained < 10) {
      const w = modelWeeks(lvl, ageDays(p, isoOf(at)), skill, t, share) * factor;
      if (!isFinite(w)) break;
      if (at + w * 7 > end) { projected = lvl + (end - at) / (w * 7); break; }
      at += w * 7; lvl++; gained++;
      projected = lvl;
    }
    return {
      skill, level, since, weeks, elapsed, own: own.length, factor, projected,
      next: isFinite(weeks) ? isoOf(Math.round(dayNo(since) + weeks * 7)) : null,
      season: gained,
    };
  }

  // ── Arena ──────────────────────────────────────────────────────────────────
  function defaultArena() {
    return {
      seats: { terraces: 0, basic: 0, roof: 0, vip: 0 },
      fans: null, perFan: 15, target: null, homeGames: 8, currency: '€',
      ratio: { terraces: 60, basic: 23.5, roof: 14, vip: 2.5 },
      price: { terraces: 7, basic: 10, roof: 19, vip: 35 },
      build: { terraces: 45, basic: 75, roof: 90, vip: 300 },
      upkeep: { terraces: 0.5, basic: 0.7, roof: 1, vip: 2.5 },
      demolish: 6, fixed: 10000,
    };
  }
  function arenaPlan(a) {
    const current = SEATS.reduce((s, k) => s + a.seats[k], 0);
    const demand = a.target != null ? a.target : (a.fans != null ? Math.round(a.fans * a.perFan) : current);
    const ratioSum = SEATS.reduce((s, k) => s + a.ratio[k], 0) || 1;
    const want = {}, delta = {}, raw = {};
    SEATS.forEach(k => {
      raw[k] = demand * a.ratio[k] / ratioSum;
      want[k] = Math.floor(raw[k]);
    });
    // Keep the individual seat groups and the displayed total in agreement.
    // The largest fractional remainders receive the few unassigned seats.
    SEATS.slice().sort((a, b) => (raw[b] - want[b]) - (raw[a] - want[a])).slice(0,
      demand - SEATS.reduce((s, k) => s + want[k], 0)).forEach(k => { want[k]++; });
    SEATS.forEach(k => {
      delta[k] = want[k] - a.seats[k];
    });
    let cost = 0;
    SEATS.forEach(k => { cost += delta[k] > 0 ? delta[k] * a.build[k] : -delta[k] * a.demolish; });
    if (SEATS.some(k => delta[k])) cost += a.fixed;
    // Attendance per seat type is capped by the seats and by how many of the
    // expected spectators want that type.
    const income = seats => SEATS.reduce((s, k) => s + Math.min(seats[k], demand * a.ratio[k] / ratioSum) * a.price[k], 0);
    const upkeep = seats => SEATS.reduce((s, k) => s + seats[k] * a.upkeep[k], 0);
    const curIncome = income(a.seats), newIncome = income(want);
    const curUpkeep = upkeep(a.seats), newUpkeep = upkeep(want);
    const seasonGain = (newIncome - curIncome) * a.homeGames - (newUpkeep - curUpkeep) * 16;
    return {
      current, demand, want, delta, cost, curIncome, newIncome, curUpkeep, newUpkeep, seasonGain,
      payback: seasonGain > 0 && cost > 0 ? cost / seasonGain : null,
    };
  }

  // ── Team settings ──────────────────────────────────────────────────────────
  function normTeam(d) {
    d = d || {};
    const t = d.training || {}, l = d.lineup || {}, a = d.arena || {};
    const ar = defaultArena();
    const ids = v => Array.isArray(v) ? [...new Set(v.filter(x => Number.isInteger(x)))] : [];
    const mapNum = (src, def, lo, hi) => Object.fromEntries(SEATS.map(k => [k, clampNum(src && src[k], lo, hi, def[k])]));
    return {
      training: {
        type: TRAININGS[t.type] ? t.type : 'playmaking',
        coach: clampInt(t.coach, 4, 8, 7),
        assistants: clampInt(t.assistants, 0, 10, 0),
        intensity: clampInt(t.intensity, 0, 100, 100),
        stamina: clampInt(t.stamina, 10, 100, 10),
        // Trainees of the league match and of the cup or friendly match: a
        // player trains in one of them, never in both.
        trainees: ids(t.trainees),
        cup: ids(t.cup).filter(x => !ids(t.trainees).includes(x)),
      },
      lineup: {
        formation: l.formation === 'auto' || FORMATIONS.includes(l.formation) ? l.formation : 'auto',
        focus: FOCUS[l.focus] ? l.focus : 'balanced',
        match: MATCHES.includes(l.match) ? l.match : 'league',
        useTrainees: l.useTrainees !== false,
        useStrongest: l.useStrongest === true,
        setTaker: Number.isInteger(l.setTaker) ? l.setTaker : null,
        // The lineup is fully automatic; old manually locked positions are
        // intentionally discarded so they cannot affect future suggestions.
        locks: {},
      },
      youth: {
        formation: d.youth && FORMATIONS.includes(d.youth.formation) ? d.youth.formation : 'auto',
      },
      arena: {
        seats: mapNum(a.seats, ar.seats, 0, 200000),
        fans: a.fans == null || a.fans === '' ? null : clampInt(a.fans, 0, 1e6, null),
        perFan: clampNum(a.perFan, 1, 100, ar.perFan),
        target: a.target == null || a.target === '' ? null : clampInt(a.target, 0, 200000, null),
        homeGames: clampInt(a.homeGames, 1, 30, ar.homeGames),
        currency: typeof a.currency === 'string' && a.currency.trim() ? a.currency.trim().slice(0, 6) : ar.currency,
        ratio: mapNum(a.ratio, ar.ratio, 0, 100),
        price: mapNum(a.price, ar.price, 0, 1e5),
        build: mapNum(a.build, ar.build, 0, 1e6),
        upkeep: mapNum(a.upkeep, ar.upkeep, 0, 1e4),
        demolish: clampNum(a.demolish, 0, 1e5, ar.demolish),
        fixed: clampNum(a.fixed, 0, 1e8, ar.fixed),
      },
    };
  }

  // ── Server ─────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const token = window.GameHub.getToken() || '';
    const r = await fetch(API + path, {
      method,
      headers: Object.assign({ 'X-Pub-Token': token }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'error'), { status: r.status });
    return data;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  let root = null;
  let players = [];
  let team = normTeam({});
  let pages = {};             // the latest read of each Hattrick page, by kind
  let loadError = false;
  let view = 'squad';         // squad | lineup | training | arena | player
  let tabView = 'squad';      // the tab the player form returns to
  let draft = null;           // the player being edited
  let draftOrig = null;
  let draftGroup = '';        // the match the edited player trains in
  let changeDate = today();   // the date skill changes in the form are recorded under
  let banner = null;
  let saving = false;
  let sortKey = 'name';

  const playerById = id => players.find(p => p.id === id) || null;
  function sortPlayers() { players.sort((a, b) => a.name.localeCompare(b.name, lang())); }

  // A removed player out of the squad, the trainees and the locked lineup.
  function dropPlayer(id) {
    players = players.filter(x => x.id !== id);
    setGroup(id, '');
    Object.keys(team.lineup.locks).forEach(k => { if (team.lineup.locks[k] === id) delete team.lineup.locks[k]; });
    if (team.lineup.setTaker === id) team.lineup.setTaker = null;
    saveTeamSoon();
  }

  // Which match a player trains in: 'trainees' (league), 'cup' or ''.
  function groupOf(id) {
    const t = team.training;
    return t.trainees.includes(id) ? 'trainees' : t.cup.includes(id) ? 'cup' : '';
  }
  function setGroup(id, group) {
    const t = team.training;
    t.trainees = t.trainees.filter(x => x !== id);
    t.cup = t.cup.filter(x => x !== id);
    if (group) t[group].push(id);
  }
  const matchGroup = () => team.training[GROUP_OF_MATCH[team.lineup.match]];

  let teamTimer = null;
  function saveTeamSoon() {
    clearTimeout(teamTimer);
    teamTimer = setTimeout(() => {
      api('POST', '/team', { data: team }).catch(() => {
        banner = { kind: 'warn', text: tr('htc_save_error') };
        render();
      });
    }, 600);
  }

  async function savePlayer(p) {
    const body = { data: playerData(p) };
    if (p.id) body.id = p.id;
    const res = await api('POST', '/players', body);
    const saved = normPlayer(res.player);
    players = players.filter(x => x.id !== saved.id);
    players.push(saved);
    sortPlayers();
    return saved;
  }

  // ── Views ──────────────────────────────────────────────────────────────────
  let shownView = null;
  const scrollMemo = {};
  function render() {
    if (!root) return;
    const before = root.querySelector('.htc-page');
    if (before && shownView) scrollMemo[shownView] = before.scrollTop;
    const keep = view === shownView || view !== 'player';
    draw();
    shownView = view;
    const page = root.querySelector('.htc-page');
    if (page) page.scrollTop = keep ? (scrollMemo[view] || 0) : 0;
  }

  function draw() {
    if (view === 'player') return renderPlayerForm();
    let body;
    if (importPlan && !loadError) body = importPreviewHtml();
    else if (loadError) body = '<div class="htc-empty htc-warn">' + esc(tr('htc_load_error')) + '</div>';
    else if (view === 'lineup') body = lineupHtml();
    else if (view === 'training') body = trainingHtml();
    else if (view === 'arena') body = arenaHtml();
    else if (view === 'youth') body = youthHtml();
    else body = squadHtml();

    const tabs = ['squad', 'lineup', 'training', 'youth', 'arena'];
    const icons = { squad: '👥', lineup: '📋', training: '📈', youth: '🌱', arena: '🏟️' };
    root.innerHTML = '<div class="htc-page"><div class="htc-wrap">'
      + '<div class="htc-top">'
      + '<button class="htc-btn htc-ghost" id="htc-exit">‹ ' + esc(tr('htc_close')) + '</button>'
      + '<div class="htc-top-title">⚽ ' + esc(tr('htc_title')) + '</div>'
      + (inExtension() ? importButton() : addButton(true))
      + '</div>'
      + '<nav class="htc-tabs">' + tabs.map(k => '<button class="htc-tab' + (view === k ? ' on' : '') + '" data-tab="' + k + '">'
        + '<i class="htc-tab-ico">' + icons[k] + ' </i><span>' + esc(tr('htc_tab_' + k)) + '</span></button>').join('') + '</nav>'
      + bannerHtml()
      + (loadError ? '' : importPagesHtml())
      + body
      + '</div></div>';

    root.querySelector('#htc-exit').onclick = exit;
    const add = root.querySelector('#htc-add');
    if (add) add.onclick = () => openPlayer(null);
    root.querySelectorAll('.htc-tab').forEach(b => {
      b.onclick = () => { view = tabView = b.dataset.tab; banner = null; importPlan = null; if (!importing) importPages = null; render(); };
    });
    bindBanner();
    if (loadError) return;
    if (importPlan) return bindImportPreview();
    const all = root.querySelector('#htc-import-all');
    if (all) all.onclick = importAll;
    if (view === 'lineup') bindLineup();
    else if (view === 'training') bindTraining();
    else if (view === 'arena') bindArena();
    else if (view === 'youth') bindYouth();
    else bindSquad();
  }

  function bannerHtml() {
    return banner ? '<div class="htc-banner htc-banner-' + banner.kind + '"><span>' + esc(banner.text)
      + '</span><button class="htc-x" id="htc-banner-x" aria-label="×">×</button></div>' : '';
  }
  function bindBanner() {
    const x = root.querySelector('#htc-banner-x');
    if (x) x.onclick = () => { banner = null; if (!importing) importPages = null; render(); };
  }

  // Why a player may miss a match or should be careful in it.
  function statusHtml(p) {
    const mark = (icon, title) => '<span class="htc-status" title="' + esc(title) + '">' + icon + '</span> ';
    return (p.out ? mark('🚑', tr('htc_f_out')) : '')
      + (p.bruised ? mark('🩹', tr('htc_bruised')) : '')
      + (p.cards ? mark('🟨'.repeat(p.cards), tr(p.cards > 1 ? 'htc_cards_risk' : 'htc_cards_one')) : '');
  }
  function specHtml(p) {
    return p.spec ? '<span class="htc-spec" title="' + esc(tr('htc_spec_' + p.spec)) + '">' + SPEC_ICON[p.spec] + '</span>' : '';
  }
  const posShort = pos => tr('htc_pos_' + pos);

  // Squad advice ─────────────────────────────────────────────────────────────
  // Who holds his place, who is due to be replaced and what to buy instead.
  // Judged on skills alone: form is taken as the same for everyone and the
  // injured count, because neither says anything about next season. The
  // numbers below are judgement, not the game.
  const SENIOR_OLD = 30;         // from this age skills start to drop and training barely moves
  const SENIOR_WEAK = 0.85;      // a starter below this share of the team's level is a weak spot
  const SENIOR_YOUNG = 21;       // up to this age a player outside the lineup is left to grow
  // Three budgets: the cheapest a little better (or as good, only younger),
  // a better one who may be older and so costs less, and the best one.
  const BUY_AGE = { cheap: [21, 31], younger: [21, 27], mid: [27, 31], best: [21, 27] };
  const TRAIN_SLOW = 1;          // fewer levels a season than this: training no longer pays
  const TRAIN_OLD = 27;          // from this age training takes well over twice as long as at 17
  const TRAINEE_AGE = [17, 19];  // the age to buy a player to train
  const POS_MAIN = { GK: ['kp', 'df'], CD: ['df', 'pm'], WB: ['df', 'wi'], IM: ['pm', 'ps'], W: ['wi', 'pm'], FW: ['sc', 'ps'] };
  const ADVICE_ICON = { core: '✅', youth: '🌱', veteran: '🧓', old: '🚨', weak: '🚨', backup: '🔁', train: '📈', develop: '🐣', sell: '💰' };

  const posFull = pos => tr('htc_pos_full_' + pos);
  const ageYears = p => Math.floor(ageDays(p) / HT_YEAR);
  // A player's level in one position, on the same scale as his skills.
  const posLevel = (p, pos) => weigh(contrib(p, pos, 'C', 1), 'balanced') / POS_SCALE[pos];

  function squadAdvice() {
    const pool = players.map(p => Object.assign({}, p, { form: 6 }));
    const opts = { locks: {}, focus: 'balanced', training: null, trainees: new Set(), useTrainees: false };
    let best = null;
    FORMATIONS.forEach(n => structures(n).forEach(st => {
      const r = solve(st, pool, opts);
      if (!best || r.score > best.score) best = r;
    }));
    const byId = {};
    const starters = [];
    best.slots.forEach(s => {
      const p = best.assigned[s.id];
      if (p) { starters.push({ p, pos: s.pos, v: posLevel(p, s.pos) }); byId[p.id] = starters[starters.length - 1]; }
    });
    const level = median(starters.map(x => x.v));
    // The substitutes: one per bench position from the players left out.
    const free = pool.filter(p => !byId[p.id]);
    const backup = {};
    if (free.length) {
      const cols = free.concat(new Array(Math.max(0, BENCH.length - free.length)).fill(null));
      hungarian(BENCH.map(pos => cols.map(p => p ? -posLevel(p, pos) : 0))).forEach((j, i) => {
        if (j >= 0 && cols[j]) backup[cols[j].id] = BENCH[i];
      });
    }
    // Youths already at least as good as a starter in his position, each
    // against the one he outdoes by the most.
    const youthFor = {};
    youthPlayers().forEach(y => {
      const now = youthAs(y, s => s.cur != null ? s.cur : 0);
      let pick = null;
      starters.forEach(x => {
        const r = posLevel(now, x.pos) / x.v;
        if (r >= 1 && (!pick || r > pick.r)) pick = { x, r };
      });
      if (pick && (!youthFor[pick.x.p.id] || pick.r > youthFor[pick.x.p.id].r)) youthFor[pick.x.p.id] = { y, r: pick.r };
    });
    const trainees = new Set(team.training.trainees.concat(team.training.cup));
    const advice = {};
    players.forEach(p => {
      const st = byId[p.id], age = ageYears(p);
      let a;
      if (st) {
        const vars = { pos: posFull(st.pos), age };
        const y = youthFor[p.id];
        const weak = level && st.v < level * SENIOR_WEAK;
        const pct = weak ? Math.round((1 - st.v / level) * 100) : 0;
        // A player who is already weak needs replacing regardless of age.
        // Age by itself is a warning only while he still performs at the
        // team's level.
        if (weak && age >= SENIOR_OLD) {
          a = { v: 'old', text: tr('htc_advr_old', Object.assign(vars, { pct })) };
        } else if (weak) {
          a = { v: 'weak', text: tr(age <= SENIOR_YOUNG ? 'htc_advr_weak_young' : 'htc_advr_weak', Object.assign(vars, { pct })) };
        } else if (y) {
          a = { v: 'youth', text: tr(y.y.promote === 0 ? 'htc_advr_youth_now' : 'htc_advr_youth_later',
            { youth: String(y.y.name || ''), pos: vars.pos, days: y.y.promote }) };
        } else if (age >= SENIOR_OLD) a = { v: 'veteran', text: tr('htc_advr_veteran', vars) };
        else a = { v: 'core', text: tr('htc_advr_core', vars) };
        a.pos = st.pos;
      } else if (trainees.has(p.id)) a = { v: 'train', text: tr('htc_advr_train') };
      else if (backup[p.id]) a = { v: 'backup', text: tr('htc_advr_backup', { pos: posFull(backup[p.id]) }) };
      else if (age <= SENIOR_YOUNG) a = { v: 'develop', text: tr('htc_advr_develop') };
      else a = { v: 'sell', text: tr('htc_advr_sell') };
      advice[p.id] = a;
    });
    // What to buy: for every starter due to go, and every place nobody fills.
    const mains = k => median(starters.map(x => x.p.skills[POS_MAIN[x.pos][k]]));
    const weakest = weakestStarters();
    const prospects = youthPlayers().map(y => ({ y, v: youthVerdict(y, weakest) })).filter(x => x.v.v === 'prospect');
    const shop = [];
    best.slots.forEach(s => {
      const p = best.assigned[s.id];
      const a = p && advice[p.id];
      if (p && a.v !== 'old' && a.v !== 'weak') return;
      const [m1, m2] = POS_MAIN[s.pos];
      const t1 = Math.max(Math.round(mains(0)), p ? p.skills[m1] + 1 : 1);
      const t2 = Math.max(Math.round(mains(1)), p ? p.skills[m2] : 1);
      const opt = (k, l1, l2, age) => ({ k, need: [[m1, Math.max(1, Math.min(t1, l1))], [m2, Math.max(1, Math.min(t2, l2))]], age });
      const c1 = p && p.skills[m1], c2 = p && p.skills[m2];
      const options = p
        ? [a.v === 'old' ? opt('cheap', c1, c2, BUY_AGE.younger) : opt('cheap', c1 + 1, c2, BUY_AGE.cheap),
          opt('mid', Math.max(c1 + 1, Math.round((c1 + t1) / 2)), Math.round((c2 + t2) / 2), BUY_AGE.mid)]
        : [opt('cheap', t1 - 2, t2 - 2, BUY_AGE.cheap), opt('mid', t1 - 1, t2 - 1, BUY_AGE.mid)];
      options.push(opt('best', t1, t2, BUY_AGE.best));
      // Budgets that ask for the same skills are one budget.
      const same = (x, y) => x.need.every(([, n], i) => n === y.need[i][1]);
      const uniq = options.filter((o, i) => !(o.k === 'mid' && (same(o, options[0]) || same(o, options[2]))));
      shop.push({ pos: s.pos, p, why: a ? a.v : null, options: uniq, prospect: prospects.find(x => x.v.pos === s.pos) });
    });
    return { advice, shop, tips: trainingTips(starters, byId, advice, backup, trainees) };
  }

  // What the training says about the squad: who no longer grows enough to
  // be worth a place in it, who is about to outgrow a starter, and who
  // could take a slot in the training instead.
  function trainingTips(starters, byId, advice, backup, trainees) {
    const t = team.training, tt = TRAININGS[t.type];
    const list = [...trainees].map(playerById).filter(Boolean);
    if (!tt || !list.length) return null;
    const sk = tt.skill;
    const factor = teamFactor(t).factor || 1;
    const gain = p => { const f = forecast(p, t, { factor }); return { f, n: Math.max(0, f.projected - f.level) }; };
    const used = new Set(list.map(p => p.id));
    const usedYouth = new Set(), taken = new Set();
    const tips = [];
    list.sort((a, b) => ageDays(b) - ageDays(a)).forEach(p => {
      const g = gain(p), st = byId[p.id], lines = [];
      let icon = null, rising = false;
      // About to take a starter's place: now, or with this season's training.
      if (!st) {
        const now = Object.assign({}, p, { form: 6 });
        const after = Object.assign({}, now, { skills: Object.assign({}, p.skills, { [sk]: Math.min(MAX_LEVEL, Math.floor(g.f.projected)) }) });
        const rank = x => (['old', 'weak'].includes(advice[x.p.id].v) ? 0 : 1) * 1000 + x.v;
        const fits = starters.filter(x => tt.pos[x.pos] && x.p.id !== p.id && !taken.has(x.p.id)).sort((a, b) => rank(a) - rank(b));
        const x = fits.find(x => posLevel(now, x.pos) >= x.v) || fits.find(x => posLevel(after, x.pos) >= x.v);
        if (x) {
          const ready = posLevel(now, x.pos) >= x.v;
          icon = '⬆️';
          rising = true;
          taken.add(x.p.id);
          lines.push(tr(ready ? 'htc_tp_ready_now' : 'htc_tp_ready_season', {
            name: p.name, starter: x.p.name, pos: posFull(x.pos), skill: tr('htc_sk_' + sk), level: after.skills[sk] + ' · ' + levelName(after.skills[sk]),
          }));
          if (['old', 'weak'].includes(advice[x.p.id].v) || (trainees.has(x.p.id) && gain(x.p).n < TRAIN_SLOW)) {
            lines.push(tr('htc_tp_then_sell', { starter: x.p.name }));
          }
        }
      }
      if (g.n < TRAIN_SLOW || ageYears(p) >= TRAIN_OLD) {
        icon = icon || '🐢';
        const lvl = Math.min(MAX_LEVEL - 1, p.skills[sk]);
        const x = modelWeeks(lvl, ageDays(p), sk, t, 1) / modelWeeks(lvl, 17 * HT_YEAR, sk, t, 1);
        lines.push(tr('htc_tp_slow', { name: p.name, x: numFmt(x, 1), n: numFmt(g.n, 1), skill: tr('htc_sk_' + sk), age: ageYears(p) }));
        if (st) lines.push(tr('htc_tp_keep_starter'));
        else if (!rising && !backup[p.id]) lines.push(tr('htc_tp_sell'));
        // Who could use his place in the training better.
        const other = players.filter(o => !used.has(o.id) && ageYears(o) < Math.min(TRAIN_OLD, ageYears(p)) && o.skills[sk] >= 3)
          .map(o => ({ o, n: gain(o).n })).filter(x => x.n >= Math.max(TRAIN_SLOW, g.n * 1.5)).sort((a, b) => b.n - a.n)[0];
        const score = y => { const s = ySkill(y, sk); return Math.max(s.cur || 0, s.cap || 0); };
        const youth = youthPlayers().filter(y => !usedYouth.has(y.htid) && score(y) >= YOUTH_RELEASE)
          .sort((a, b) => (a.promote === 0 ? 0 : 1) - (b.promote === 0 ? 0 : 1) || score(b) - score(a))[0];
        if (other) { used.add(other.o.id); lines.push(tr('htc_tp_swap_senior', { other: other.o.name, n: numFmt(other.n, 1) })); }
        else if (youth) {
          usedYouth.add(youth.htid);
          lines.push(tr(youth.promote === 0 ? 'htc_tp_swap_youth_now' : 'htc_tp_swap_youth_later', { youth: String(youth.name || ''), days: youth.promote }));
        } else lines.push(tr('htc_tp_swap_buy', { from: TRAINEE_AGE[0], to: TRAINEE_AGE[1] }));
      }
      if (lines.length) tips.push({ icon, p, lines });
    });
    return tips;
  }

  function adviceHtml(a) {
    return '<span class="htc-adv htc-adv-' + a.v + '" title="' + esc(a.text) + '">' + ADVICE_ICON[a.v] + ' ' + esc(tr('htc_adv_' + a.v)) + '</span>';
  }
  function shopHtml(shop) {
    const rows = shop.map(x => '<div class="htc-shop-row"><div class="htc-shop-head"><b>' + esc(posFull(x.pos)) + '</b> '
      + (x.p ? '<span class="htc-adv htc-adv-' + x.why + '">' + ADVICE_ICON[x.why] + ' ' + esc(tr('htc_adv_' + x.why)) + '</span> '
        + '<span class="htc-dim">' + esc(tr('htc_shop_replaces', { name: x.p.name })) + '</span>'
        : '<span class="htc-dim">' + esc(tr('htc_shop_missing')) + '</span>') + '</div>'
      + x.options.map(o => '<div class="htc-shop-opt"><span class="htc-shop-k">' + SHOP_ICON[o.k] + ' ' + esc(tr('htc_shop_' + o.k)) + '</span> '
        + esc(tr('htc_shop_look', {
          skills: o.need.map(([k, n]) => tr('htc_sk_' + k) + ' ' + n + '+ (' + levelName(n) + ')').join(' · '),
          from: o.age[0], to: o.age[1],
        })) + '</div>').join('')
      + (x.prospect ? '<div class="htc-dim">🌱 ' + esc(tr('htc_shop_youth', { name: String(x.prospect.y.name || '') })) + '</div>' : '')
      + '</div>').join('');
    return '<div class="htc-card htc-shop"><h3>🛒 ' + esc(tr('htc_shop_title')) + '</h3>'
      + (rows || '<p class="htc-dim">' + esc(tr('htc_shop_none')) + '</p>')
      + '<p class="htc-note">' + esc(tr(rows ? 'htc_shop_budget' : 'htc_shop_note')) + (rows ? ' ' + esc(tr('htc_shop_note')) : '') + '</p></div>';
  }
  const SHOP_ICON = { cheap: '💰', mid: '⚖️', best: '⭐' };
  function tipsHtml(tips) {
    if (!tips) return '';
    const rows = tips.map(x => '<div class="htc-shop-row"><div class="htc-shop-head"><b>' + x.icon + ' ' + esc(x.p.name) + '</b></div>'
      + x.lines.map(l => '<div>' + esc(l) + '</div>').join('') + '</div>').join('');
    return '<div class="htc-card htc-shop"><h3>📈 ' + esc(tr('htc_tp_title', { training: tr('htc_tr_' + team.training.type) })) + '</h3>'
      + (rows || '<p class="htc-dim">' + esc(tr('htc_tp_none')) + '</p>')
      + '<p class="htc-note">' + esc(tr('htc_tp_note')) + '</p></div>';
  }

  // Squad ────────────────────────────────────────────────────────────────────
  function squadHtml() {
    if (!players.length) {
      return '<div class="htc-empty"><div class="htc-empty-icon">⚽</div>' + esc(tr('htc_no_players')) + '</div>' + addRow();
    }
    const avail = players.filter(p => !p.out);
    const avgAge = players.reduce((s, p) => s + ageDays(p), 0) / players.length / HT_YEAR;
    const wages = players.reduce((s, p) => s + (p.wage || 0), 0);
    const tsi = players.reduce((s, p) => s + (p.tsi || 0), 0);
    const cur = team.arena.currency;
    const { advice, shop, tips } = squadAdvice();
    const list = players.slice();
    if (sortKey === 'age') list.sort((a, b) => ageDays(a) - ageDays(b));
    else if (sortKey === 'tsi') list.sort((a, b) => (b.tsi || 0) - (a.tsi || 0));
    else if (SKILLS.includes(sortKey)) list.sort((a, b) => b.skills[sortKey] - a.skills[sortKey]);
    const th = (k, label, title) => '<th class="htc-sortable' + (sortKey === k ? ' on' : '') + '" data-sort="' + k + '"'
      + (title ? ' title="' + esc(title) + '"' : '') + '>' + esc(label) + '</th>';
    return '<div class="htc-stats">'
      + stat(players.length + (avail.length !== players.length ? ' · 🚑 ' + (players.length - avail.length) : ''), tr('htc_st_players'))
      + stat(numFmt(avgAge, 1), tr('htc_st_avg_age'))
      + stat(wages ? numFmt(wages) + ' ' + cur : '—', tr('htc_st_wages'))
      + stat(tsi ? numFmt(tsi) : '—', tr('htc_st_tsi'))
      + '</div>'
      + '<div class="htc-card htc-table-card"><div class="htc-table-wrap"><table class="htc-table">'
      + '<thead><tr>' + th('name', tr('htc_f_name')) + th('age', tr('htc_f_age'))
      + '<th>' + esc(tr('htc_best_pos')) + '</th>'
      + '<th title="' + esc(tr('htc_f_form')) + '">' + esc(tr('htc_abbr_form')) + '</th>'
      + '<th title="' + esc(tr('htc_f_stamina')) + '">' + esc(tr('htc_abbr_stamina')) + '</th>'
      + SKILLS.map(s => th(s, tr('htc_abbr_' + s), tr('htc_sk_' + s))).join('')
      + th('tsi', tr('htc_f_tsi'))
      + '</tr></thead><tbody>'
      + list.map(p => '<tr class="htc-row' + (p.out ? ' out' : '') + '" data-id="' + p.id + '">'
        + '<td class="htc-name">' + statusHtml(p) + esc(p.name) + ' ' + specHtml(p) + (p.homegrown ? ' <span class="htc-hg" title="' + esc(tr('htc_f_homegrown')) + '">🏠</span>' : '') + '</td>'
        + '<td class="htc-nowrap">' + esc(ageLabel(p)) + '<br>' + adviceHtml(advice[p.id]) + '</td>'
        + '<td><span class="htc-pos">' + esc(posShort(bestPos(p))) + '</span></td>'
        + '<td title="' + esc(levelName(p.form)) + '">' + p.form + '</td>'
        + '<td title="' + esc(levelName(p.stamina)) + '">' + p.stamina + '</td>'
        + SKILLS.map(s => '<td class="htc-lv htc-lv-' + Math.min(4, Math.floor(p.skills[s] / 4)) + '" title="' + esc(tr('htc_sk_' + s) + ': ' + levelName(p.skills[s])) + '">' + p.skills[s] + '</td>').join('')
        + '<td class="htc-nowrap">' + (p.tsi != null ? numFmt(p.tsi) : '') + '</td>'
        + '</tr>').join('')
      + '</tbody></table></div></div>'
      + addRow()
      + shopHtml(shop)
      + tipsHtml(tips)
      + '<p class="htc-note">' + esc(tr('htc_squad_note')) + '</p>';
  }
  // Inside the mvmOS Apps browser extension the calculator reads the squad
  // from Hattrick, so importing takes the main button and adding a player by
  // hand, needed only for the odd case, moves below the squad.
  function inExtension() {
    const ext = window.mvmOS && window.mvmOS.extension;
    return !!(ext && ext.active);
  }
  function onHattrick() {
    return inExtension() && /(^|\.)hattrick\.org$/.test(window.mvmOS.extension.context.hostname);
  }
  function importButton() {
    return '<button class="htc-btn htc-primary" id="htc-import-all"' + (importing ? ' disabled' : '') + '>⚡ '
      + esc(tr(importing ? 'htc_import_reading_all' : 'htc_import_all')) + '</button>';
  }
  function addButton(primary) {
    return '<button class="htc-btn ' + (primary ? 'htc-primary' : 'htc-ghost') + '" id="htc-add">＋ ' + esc(tr('htc_add_player')) + '</button>';
  }
  function addRow() {
    return inExtension() ? '<div class="htc-add-row">' + addButton(false) + '</div>' : '';
  }
  function stat(v, label) {
    return '<div class="htc-stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }
  function bindSquad() {
    root.querySelectorAll('.htc-row').forEach(r => {
      r.onclick = () => openPlayer(playerById(+r.dataset.id));
    });
    root.querySelectorAll('.htc-sortable').forEach(h => {
      h.onclick = () => { sortKey = h.dataset.sort; render(); };
    });
  }

  // Import ───────────────────────────────────────────────────────────────────
  // Reads the manager's Hattrick pages — the one open in the tab, or all of
  // them at once — shows what would change and saves only what the manager
  // keeps ticked. Pages are read by their structure and numbers alone — ids,
  // classes, levels, links, the data Hattrick embeds for its own scripts —
  // never by their words, because Hattrick shows them in the manager's
  // language. Everything a page holds is also kept as it was read (see
  // api.py), whether the calculator uses it yet or not.
  let importing = false;
  let importPlan = null;      // { items: [{ kind, player, changes, on }], rows, full, found }
  // What became of each page of the last import: [{ kind, state }], state
  // being queued, reading, read, ok, failed or missing.
  let importPages = null;
  // Every Hattrick page links the manager's own pages in its menu, with the
  // right team and stadium ids. A page the calculator reads is one row here
  // and one reader in readHattrickPage.
  const CLUB_PAGES = [
    { kind: 'players', link: /^\/Club\/Players\/\?TeamID=\d+$/i },
    { kind: 'training', link: /^\/Club\/Training\/(?:Training\.aspx)?\?teamId=\d+$/i },
    { kind: 'stadium', link: /^\/Club\/Stadium\/\?stadiumId=\d+$/i },
    { kind: 'fans', link: /^\/Club\/Fans\/\?teamId=\d+$/i },
    // Only a club with a youth academy links these.
    { kind: 'youth', link: /^\/Club\/Players\/YouthPlayers\.aspx\?YouthTeamID=\d+$/i, optional: true },
    { kind: 'youthtraining', link: /^\/Club\/Training\/YouthTraining\.aspx\?YouthTeamID=\d+$/i, optional: true },
  ];
  function clubPages(html) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (_) { return []; }
    const hrefs = Array.from(doc.querySelectorAll('a[href]')).map(a => {
      try { const u = new URL(a.getAttribute('href'), 'https://www.hattrick.org/'); return u.pathname + u.search; } catch (_) { return ''; }
    });
    return CLUB_PAGES.map(p => ({ kind: p.kind, path: hrefs.find(h => p.link.test(h)) || '', optional: !!p.optional }));
  }
  // A page counts as read only when it is the page asked for.
  function readAs(page, kind) {
    const read = page && typeof page.html === 'string' ? readHattrickPage(page.html, page.url) : null;
    return read && read.kind === kind ? read : null;
  }
  async function readAll(targets) {
    targets.forEach(t => { t.state = 'queued'; });
    const shown = () => {
      importing = { done: importPages.filter(p => p.state !== 'queued' && p.state !== 'reading').length, total: importPages.length };
      render();
    };
    targets[0].state = 'reading';
    shown();
    const pages = await window.mvmOS.extension.readPages(targets.map(t => t.path), done => {
      targets.forEach((t, i) => { t.state = i < done ? 'read' : i === done ? 'reading' : 'queued'; });
      shown();
    });
    if (!pages) return false;
    targets.forEach((t, i) => {
      t.read = readAs(pages[i], t.kind);
      t.state = t.read ? 'ok' : 'failed';
    });
    return true;
  }
  async function importAll() {
    if (importing) return;
    if (!onHattrick()) {
      banner = { kind: 'info', text: tr('htc_import_open_ht') };
      return render();
    }
    importing = { done: 0, total: 0 };
    banner = null;
    importPages = null;
    render();
    const here = await window.mvmOS.extension.readPage();
    const all = (here && typeof here.html === 'string' ? clubPages(here.html) : []).filter(p => p.path || !p.optional);
    const targets = all.filter(p => p.path);
    if (!targets.length) {
      importing = false;
      banner = { kind: 'warn', text: tr(!here ? 'htc_import_error' : 'htc_import_unknown') };
      return render();
    }
    all.forEach(p => { if (!p.path) p.state = 'missing'; });
    importPages = all;
    let ok = await readAll(targets);
    // A page not ready in time is read once more.
    const again = targets.filter(t => t.state === 'failed');
    if (ok && again.length) await readAll(again);
    importing = false;
    if (!ok) {
      importPages = null;
      banner = { kind: 'warn', text: tr('htc_import_all_error') };
      return render();
    }
    const reads = targets.map(t => t.read).filter(Boolean);
    if (!reads.length) {
      banner = { kind: 'warn', text: tr('htc_import_none_read') };
      return render();
    }
    planFrom(reads);
  }
  function importPagesHtml() {
    if (!importPages) return '';
    const icon = { queued: '⏸️', reading: '⏳', read: '📄', ok: '✅', failed: '⚠️', missing: '➖' };
    const bad = importPages.some(p => p.state === 'failed' || p.state === 'missing');
    return '<div class="htc-card htc-imp-pages"><div class="htc-card-head"><h3>' + esc(tr('htc_import_pages')) + '</h3>'
      + (importing && importing.total ? '<span class="htc-dim">' + importing.done + ' / ' + importing.total + '</span>' : '') + '</div>'
      + (importing && importing.total ? '<div class="htc-progress"><i style="width:' + Math.round(100 * importing.done / importing.total) + '%"></i></div>' : '')
      + importPages.map(p => '<div class="htc-imp-page htc-imp-' + p.state + '">' + icon[p.state] + ' <b>' + esc(tr('htc_page_' + p.kind)) + '</b>'
        + ' <span class="htc-dim">' + esc(tr('htc_page_state_' + p.state)) + '</span></div>').join('')
      + (!importing && bad ? '<p class="htc-dim">' + esc(tr('htc_import_pages_hint')) + '</p>' : '')
      + '</div>';
  }

  function planFrom(reads) {
    reads.forEach(r => {
      if (!r.data) return;
      pages[r.kind] = { data: r.data, updated_at: new Date().toISOString() };
      api('POST', '/pages/' + r.kind, { data: r.data }).catch(() => {});
    });
    const squad = reads.find(r => r.players);
    const plan = squad ? planImport(squad) : { items: [], full: false, found: 0 };
    const youth = reads.find(r => r.kind === 'youth');
    plan.youth = youth ? youth.data.players.length : 0;
    // Each page lists only some coming matches (the stadium its home games,
    // the fans no friendlies), so the next match is the earliest of them all.
    const lists = reads.map(r => r.data && r.data.upcoming).filter(Array.isArray);
    const training = reads.find(r => r.kind === 'training');
    const dateFormat = training && training.data.dateFormat;
    const next = lists.length > 1 ? nextMatchRow(lists.flat().map((m, i) => ({ m, i, at: dateKey(m.date, dateFormat) }))
      .sort((x, y) => (x.at || Infinity) - (y.at || Infinity) || x.i - y.i).map(x => x.m)) : null;
    // Otherwise two pages saying the same thing: the first one read wins.
    const seen = new Set();
    plan.rows = [];
    if (next) {
      seen.add(next.key);
      if (next.changed) plan.rows.push(Object.assign({ on: true }, next));
    }
    reads.forEach(r => (r.rows || []).forEach(row => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      if (row.changed) plan.rows.push(Object.assign({ on: true }, row));
    }));
    importPlan = plan;
    if (!plan.rows.length && !plan.items.some(it => it.kind !== 'same')) return applyImport();
    render();
  }

  const HT_SPEC = { 1: 'technical', 2: 'quick', 3: 'powerful', 4: 'unpredictable', 5: 'head', 6: 'resilient', 8: 'support' };
  const HT_SKILL_ROW = { Keeper: 'kp', Defender: 'df', Playmaker: 'pm', Winger: 'wi', Passer: 'ps', Scorer: 'sc', Kicker: 'sp' };
  // "3 600", "2 740 lv/week", "1.872 €": the first number, whatever groups it.
  function htNumber(text) {
    const m = /\d[\d\s  .,']*/.exec(text || '');
    return m ? parseInt(m[0].replace(/\D/g, ''), 10) : null;
  }
  // Each page is recognised by elements only that page has, and gives what
  // it would change here (rows, or players) and all it holds (data).
  function readHattrickPage(html, url) {
    let doc;
    try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch (_) { return null; }
    const squad = parsePlayersPage(doc, url);
    if (squad) return Object.assign({ kind: 'players', data: { url: url || '', read: new Date().toISOString(), players: squad.players } }, squad);
    for (const [kind, read] of [['training', readTraining], ['stadium', readStadium], ['fans', readFans],
      ['youth', readYouthPlayers], ['youthtraining', readYouthTraining]]) {
      const got = read(doc);
      if (got) return { kind, rows: got.rows, data: Object.assign({ url: url || '', read: new Date().toISOString() }, got.data) };
    }
    return null;
  }

  // Data Hattrick hands its own scripts on the page: `name = {…};`.
  function scriptJson(doc, name) {
    const key = name + ' = ';
    for (const el of doc.querySelectorAll('script:not([src])')) {
      const text = el.textContent;
      const at = text.indexOf(key);
      if (at < 0) continue;
      const start = at + key.length, end = jsonEnd(text, start);
      if (end < 0) return null;
      try { return JSON.parse(text.slice(start, end)); } catch (_) { return null; }
    }
    return null;
  }
  function jsonEnd(text, i) {
    if (text[i] !== '{' && text[i] !== '[') return -1;
    let depth = 0, str = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) return j + 1;
    }
    return -1;
  }
  function scriptString(doc, name) {
    const re = new RegExp(name.replace(/\./g, '\\.') + ' = "([^"]*)"');
    for (const el of doc.querySelectorAll('script:not([src])')) {
      const m = re.exec(el.textContent);
      if (m) return m[1];
    }
    return null;
  }

  // The sortable list on the same page has a column for injuries and one
  // for cards, found by their header icons. Their sort value is the number:
  // weeks out (0 a bruise the player can play with) and yellow cards (3 a
  // suspension).
  function playerStatus(doc) {
    const out = {};
    doc.querySelectorAll('table').forEach(table => {
      const heads = Array.from(table.querySelectorAll('thead th'));
      const col = sel => heads.findIndex(th => th.querySelector(sel));
      const inj = col('i.icon-injury'), card = col('i.icon-yellow-card');
      if (inj < 0 && card < 0) return;
      table.querySelectorAll('tbody tr').forEach(tr => {
        const pl = tr.querySelector('hattrick-player[player-id]');
        const id = pl && pl.getAttribute('player-id');
        if (!/^\d{1,12}$/.test(id || '')) return;
        const cell = i => {
          const td = i >= 0 ? tr.children[i] : null;
          const v = td ? parseInt(td.getAttribute('data-sortvalue'), 10) : NaN;
          return isNaN(v) ? null : v;
        };
        out[id] = { injury: cell(inj), cards: cell(card) };
      });
    });
    return out;
  }

  // The team's Players page: one .teamphoto-player box per player.
  function parsePlayersPage(doc, url) {
    const found = [];
    const status = playerStatus(doc);
    doc.querySelectorAll('.teamphoto-player').forEach(box => {
      const link = box.querySelector('h3 a[href*="playerId="]');
      const id = link && /[?&]playerId=(\d{1,12})\b/i.exec(link.getAttribute('href') || '');
      const name = link && (link.getAttribute('title') || link.textContent || '').trim();
      if (!id || !name) return;
      const bar = row => {
        const el = box.querySelector('tr[id$="_tr' + row + '"] .ht-bar[level]');
        const v = el ? parseInt(el.getAttribute('level'), 10) : NaN;
        return isNaN(v) ? null : v;
      };
      // Skills are shown only for the manager's own players.
      const skills = {};
      for (const row of Object.keys(HT_SKILL_ROW)) {
        const v = bar(row);
        if (v == null) return;
        skills[HT_SKILL_ROW[row]] = v;
      }
      // Denomination links carry the level: experience and loyalty are "skill"
      // levels in that order, leadership its own.
      const levels = { skill: [], leadership: [] };
      box.querySelectorAll('a[href*="lt="]').forEach(a => {
        const m = /[?&]lt=(\w+)&ll=(\d+)/.exec(a.getAttribute('href') || '');
        if (m && levels[m[1]]) levels[m[1]].push(+m[2]);
      });
      // Age, TSI and wage are the rows without an id, in that order.
      const info = Array.from(box.querySelectorAll('.transferPlayerInformation tr:not([id])'))
        .map(tr => { const td = tr.querySelectorAll('td'); return td.length ? td[td.length - 1].textContent : ''; });
      const age = (info[0] || '').match(/\d+/g) || [];
      const spec = box.querySelector('tr[id$="_trSpeciality"] i[class*="icon-speciality-"]');
      const specNo = spec && /icon-speciality-(\d+)/.exec(spec.className);
      const h3 = box.querySelector('h3');
      // Kept, not used yet: nationality, the other icons by the name
      // (transfer list…), the suggested position's colour and the last match.
      // Without the list, the icons by the name tell injury and cards too.
      const st = status[id[1]] || {};
      const injury = st.injury != null ? st.injury : h3.querySelector('i.icon-injury') ? 1 : null;
      const cards = st.cards != null ? st.cards
        : h3.querySelector('i.icon-red-card') ? 3 : h3.querySelectorAll('i.icon-yellow-card').length;
      const flag = box.querySelector('a[href*="LeagueID="]');
      const rating = box.querySelector('hattrick-rating[rating]');
      const last = rating && rating.parentElement.querySelector('a[href*="matchID="]');
      const category = box.querySelector('.player-category');
      const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
      found.push({
        htid: id[1],
        name,
        age: age.length >= 2 ? { y: +age[0], d: +age[1] } : null,
        tsi: htNumber(info[1]),
        wage: htNumber(info[2]),
        spec: specNo ? HT_SPEC[specNo[1]] || '' : '',
        form: bar('Form'),
        stamina: bar('Stamina'),
        xp: levels.skill[0],
        loyalty: levels.skill[1],
        lead: levels.leadership[0],
        homegrown: !!h3.querySelector('i.icon-mother-club'),
        out: injury > 0 || cards >= 3,
        bruised: injury === 0,
        cards: cards >= 3 ? 0 : Math.max(0, cards),
        skills,
        league: flag ? +(/LeagueID=(\d+)/i.exec(flag.getAttribute('href')) || [])[1] || null : null,
        icons: Array.from(h3.querySelectorAll('i[class*="icon-"]')).map(i => i.className.trim()),
        category: category ? category.style.backgroundColor || '' : '',
        last: rating ? {
          rating: num(rating.getAttribute('rating')),
          stamina: num(rating.getAttribute('stamina')),
          match: last ? +(/matchID=(\d+)/i.exec(last.getAttribute('href')) || [])[1] || null : null,
          date: last ? last.textContent.trim() : '',
        } : null,
      });
    });
    if (!found.length) return null;
    let path = '';
    try { path = new URL(url).pathname; } catch (_) {}
    // Only the whole list tells who has left; a single player's page does not.
    return { players: found, full: /^\/Club\/Players\/?$/i.test(path) };
  }

  // Hattrick's own training numbers.
  const HT_TRAINING = {
    9: 'keeper', 3: 'defending', 11: 'defpos', 8: 'playmaking', 5: 'winger', 12: 'wingatt',
    7: 'passing', 10: 'through', 4: 'scoring', 6: 'shooting', 2: 'setpieces',
  };
  const attrNum = (el, name) => { const v = el ? parseInt(el.getAttribute(name), 10) : NaN; return isNaN(v) ? null : v; };
  // One setting the page would change: shown as before → after, applied to
  // the team when ticked. `shown` replaces the plain after value on screen;
  // `key` says which setting it is when two pages both have it.
  const teamRow = (key, label, from, to, apply, shown) => ({
    key, label, from: String(from), shown: shown || String(to), changed: String(from) !== String(to), apply,
  });

  // Training page: the chosen type, the stamina share, intensity, head coach
  // and assistant levels. The page as the manager sees it has them in its
  // controls; the page as the server sends it only in the data for its
  // scripts, which also holds the rest of what the page shows.
  function readTraining(doc) {
    const json = scriptJson(doc, 'ngTraining.data.training');
    const select = doc.querySelector('.training-dropdown select');
    if (!select && !json) return null;
    const v = {};
    if (select) {
      const opt = select.querySelector('option[selected]');
      v.type = opt && HT_TRAINING[opt.getAttribute('value')];
      const ranges = Array.from(doc.querySelectorAll('input[type="range"]'));
      const at = ranges.findIndex(r => attrNum(r, 'max') === 90);
      if (at >= 0) {
        const share = attrNum(ranges[at], 'value');
        if (share != null) v.stamina = 100 - share;
        v.intensity = attrNum(ranges[at + 1], 'value');
      }
      v.coach = attrNum(doc.querySelector('.tr-head-coach input[type="range"]'), 'value');
      v.assistants = attrNum(doc.querySelector('.tr-assistant-coach input[type="range"]'), 'value');
    }
    if (json) {
      const n = x => Number.isFinite(x) ? x : null;
      if (!v.type) v.type = HT_TRAINING[json.trainingType];
      if (v.stamina == null) v.stamina = n(json.trainingLevelStamina);
      if (v.intensity == null) v.intensity = n(json.trainingLevelNew) != null ? json.trainingLevelNew : n(json.trainingLevel);
      if (v.coach == null) v.coach = json.trainer ? n(json.trainer.trainerSkill) : null;
      if (v.assistants == null && Array.isArray(json.assistantTrainerLevels)) {
        v.assistants = json.assistantTrainerLevels.reduce((a, b) => a + (+b || 0), 0);
      }
    }
    const t = team.training, rows = [];
    if (v.type) rows.push(teamRow('training.type', tr('htc_training_type'), tr('htc_tr_' + t.type), tr('htc_tr_' + v.type), x => { x.training.type = v.type; }));
    if (v.stamina != null) {
      const stamina = clampInt(v.stamina, 10, 100, t.stamina);
      rows.push(teamRow('training.stamina', tr('htc_stamina_share'), t.stamina + '%', stamina + '%', x => { x.training.stamina = stamina; }));
    }
    if (v.intensity != null) {
      const intensity = clampInt(v.intensity, 0, 100, t.intensity);
      rows.push(teamRow('training.intensity', tr('htc_intensity'), t.intensity + '%', intensity + '%', x => { x.training.intensity = intensity; }));
    }
    if (v.coach != null) {
      const coach = clampInt(v.coach, 4, 8, t.coach);
      rows.push(teamRow('training.coach', tr('htc_coach'), levelName(t.coach), levelName(coach), x => { x.training.coach = coach; }));
    }
    if (v.assistants != null) {
      const assistants = clampInt(v.assistants, 0, 10, t.assistants);
      rows.push(teamRow('training.assistants', tr('htc_assistants'), t.assistants, assistants, x => { x.training.assistants = assistants; }));
    }
    // The manager's account (e-mail, sign-in token) is never kept, only what
    // it says about the teams and how dates are written.
    const user = scriptJson(doc, 'ngTraining.data.user');
    const u = user && user.user;
    const training = json ? Object.assign({}, json) : null;
    if (training && training.trainer) training.trainer = Object.assign({}, training.trainer, { avatar: undefined });
    return {
      rows,
      data: {
        values: v,
        training,
        teamPlayers: scriptJson(doc, 'ngTraining.data.teamPlayers'),
        nextTraining: scriptString(doc, 'ngTraining.nextTraining'),
        nextDrop: scriptString(doc, 'ngTraining.nextDrop'),
        nextIntensityUpdate: scriptString(doc, 'ngTraining.nextIntensityUpdate'),
        teams: u && Array.isArray(u.teams) ? u.teams : null,
        dateFormat: u ? u.dateFormat || null : null,
        timeFormat: u ? u.timeFormat || null : null,
      },
    };
  }

  // Cell values of a Hattrick info table, last cell of every row.
  const cellValues = table => Array.from(table ? table.querySelectorAll('tr') : [])
    .map(tr => { const td = tr.querySelectorAll('td'); return td.length ? td[td.length - 1].textContent.replace(/[\s  ]+/g, ' ').trim() : ''; });
  const PLAIN_NUMBER = /^-?\d[\d .,']*$/;
  const signedNumber = text => { const n = htNumber(text); return n == null ? null : (/^-/.test(text.trim()) ? -n : n); };
  const cellText = el => (el ? el.textContent : '').replace(/[\s  ]+/g, ' ').trim();
  const DATE_TEXT = /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}(?:\s+\d{1,2}[.:]\d{2})?/;
  const denomination = (el, kind) => {
    const a = el && el.querySelector('a[href*="lt=' + kind + '&"], a[href*="lt=' + kind + '&amp;"]');
    const m = a && /[?&]ll=(\d+)/.exec(a.getAttribute('href'));
    return m ? +m[1] : null;
  };

  // A row of any of Hattrick's match lists: which match, when (as the
  // manager's date format writes it), what kind, between whom, and the
  // numbers the row shows.
  function matchRow(tr) {
    const a = tr.querySelector('a[href*="matchID="]');
    const id = a && /matchID=(\d+)/i.exec(a.getAttribute('href'));
    if (!id) return null;
    const icon = tr.querySelector('[class*="match-type-"]');
    const type = icon && /\bmatch-type-(?!svg\b)([\w-]+)/.exec(icon.getAttribute('class'));
    const date = DATE_TEXT.exec(cellText(tr));
    const score = tr.querySelector('strong');
    const scoreNums = score ? (cellText(score).match(/\d+/g) || []).map(Number) : [];
    const result = tr.querySelector('.won, .lost, .draw');
    return {
      id: +id[1],
      type: type ? type[1] : '',
      date: date ? date[0] : '',
      title: (a.getAttribute('title') || cellText(a)).trim(),
      score: scoreNums.length === 2 ? scoreNums : null,
      result: result ? (/\b(won|lost|draw)\b/.exec(result.className) || [])[1] || '' : '',
      // Cells of plain figures: not the date, the teams, the score or a
      // denomination.
      numbers: Array.from(tr.querySelectorAll('td')).filter(td => !td.matches('.date') && !td.querySelector('a, img, strong, .date'))
        .map(cellText).filter(v => /\d/.test(v)).map(signedNumber),
    };
  }
  const matchRows = rows => Array.from(rows).map(matchRow).filter(Boolean);

  // A match date as a number that orders dates. Which figure is the day and
  // which the month is the manager's date format when known (dd.MM.yyyy,
  // MM/dd/yyyy…), else a figure over 12 is the day, else the day comes first
  // (after the year, the month does).
  function dateKey(text, format) {
    const n = (text || '').match(/\d+/g);
    if (!n || n.length < 3) return null;
    const date = n.slice(0, 3).map(Number), time = n.slice(3, 5).map(Number);
    let y = date.findIndex((v, i) => n[i].length === 4);
    if (y < 0) y = 2;
    const rest = [0, 1, 2].filter(i => i !== y);
    const order = (format || '').replace(/[^dMy]/g, '').replace(/(.)\1+/g, '$1');
    let d, m;
    if (order.length === 3 && order.indexOf('y') === y) [d, m] = [order.indexOf('d'), order.indexOf('M')];
    else if (date[rest[1]] > 12) [m, d] = rest;
    else [d, m] = y === 0 ? [rest[1], rest[0]] : rest;
    return ((date[y] * 100 + date[m]) * 100 + date[d]) * 10000 + (time[0] || 0) * 100 + (time[1] || 0);
  }

  // The next match's kind picks the lineup's match, when it is one the
  // calculator plans for.
  function nextMatchRow(upcoming) {
    const next = upcoming.find(m => MATCHES.includes(m.type));
    if (!next) return null;
    return teamRow('lineup.match', tr('htc_next_match'), tr('htc_match_' + team.lineup.match), tr('htc_match_' + next.type),
      x => { x.lineup.match = next.type; }, tr('htc_match_' + next.type) + (next.date ? ' · ' + next.date : ''));
  }

  // Stadium page: the arena's capacity row is followed by the terraces,
  // basic, roof and VIP seats; the first amount after them is the most a full
  // stadium earns, which gives the currency and its rate. A stadium under
  // construction also has a table of the seats being changed.
  function readStadium(doc) {
    const info = doc.querySelector('.arenaInfo table.thin');
    const arena = doc.querySelector('hattrick-arena[capacity]');
    const capacity = attrNum(arena, 'capacity');
    if (!info || capacity == null) return null;
    const a = team.arena, rows = [];
    const values = cellValues(info);
    const at = values.findIndex(v => PLAIN_NUMBER.test(v) && htNumber(v) === capacity);
    const nums = values.slice(at + 1, at + 5).map(v => PLAIN_NUMBER.test(v) ? htNumber(v) : null);
    if (at < 0 || nums.length < 4 || nums.some(n => n == null) || nums.reduce((x, y) => x + y, 0) !== capacity) return null;
    const seats = { terraces: nums[0], basic: nums[1], roof: nums[2], vip: nums[3] };
    // Seats being built count already: the plan is about the stadium as it
    // will be.
    const building = Array.from(doc.querySelectorAll('table.thin')).find(tb => !tb.closest('.arenaInfo')
      && cellValues(tb).length === 4 && cellValues(tb).every(v => PLAIN_NUMBER.test(v)));
    const add = building ? cellValues(building).map(signedNumber) : [0, 0, 0, 0];
    SEATS.forEach((k, i) => {
      const to = Math.max(0, seats[k] + add[i]);
      rows.push(teamRow('seats.' + k, SEAT_ICON[k] + ' ' + tr('htc_seat_' + k), numFmt(a.seats[k]), numFmt(to), x => { x.arena.seats[k] = to; },
        numFmt(to) + (add[i] ? ' (🏗️ ' + (add[i] > 0 ? '+' : '') + numFmt(add[i]) + ')' : '')));
    });
    const moneys = values.slice(at + 5).filter(v => /\d/.test(v) && !PLAIN_NUMBER.test(v));
    const money = moneys[0];
    const symbol = money && money.replace(/[\d\s.,'-]+/g, ' ').trim().slice(0, 6);
    const perMatch = money && htNumber(money);
    const d = defaultArena();
    const euros = SEATS.reduce((sum, k) => sum + seats[k] * d.price[k], 0);
    const rate = symbol && perMatch && euros ? +(perMatch / euros).toPrecision(3) : null;
    if (rate) {
      const now = +(a.price.terraces / d.price.terraces).toPrecision(3);
      if (symbol !== a.currency || rate !== now) {
        rows.push(teamRow('currency', tr('htc_currency'), a.currency, symbol, x => {
          x.arena.currency = symbol;
          ['price', 'build', 'upkeep'].forEach(g => SEATS.forEach(k => { x.arena[g][k] = +(d[g][k] * rate).toFixed(2); }));
          x.arena.demolish = +(d.demolish * rate).toFixed(2);
          x.arena.fixed = Math.round(d.fixed * rate);
        }, symbol + ' (1 € = ' + numFmt(rate, rate < 10 ? 2 : 0) + ' ' + symbol + ')'));
        // The same currency at another rate is a change too.
        rows[rows.length - 1].changed = true;
      }
    }
    // The played list comes before the upcoming one, in tbodies of one table.
    const lists = Array.from(doc.querySelectorAll('table')).filter(tb => tb.querySelector('a[href*="matchID="]'));
    const rowsOf = sel => lists.flatMap(tb => Array.from(tb.querySelectorAll(sel)));
    const played = matchRows(rowsOf('tr'));
    const upcoming = matchRows(rowsOf('[id*="repMatches_"]').map(el => el.closest('tr')));
    const upcomingIds = new Set(upcoming.map(m => m.id));
    const next = nextMatchRow(upcoming);
    if (next) rows.push(next);
    const byline = doc.querySelector('.byline');
    const h1 = doc.querySelector('#mainBody h1') || doc.querySelector('h1');
    const youth = Array.from(doc.querySelectorAll('.arenaInfo table.thin')).slice(1)
      .map(tb => cellValues(tb).filter(v => PLAIN_NUMBER.test(v)).map(htNumber).pop()).find(n => n != null);
    const until = building && building.previousElementSibling && DATE_TEXT.exec(cellText(building.previousElementSibling));
    return {
      rows,
      data: {
        arenaId: attrNum(arena, 'arena-id'),
        name: h1 ? cellText(h1).replace(/\s*\(\d+\)\s*$/, '') : '',
        league: byline && byline.querySelector('a[href*="LeagueID="]') ? +/LeagueID=(\d+)/i.exec(byline.querySelector('a[href*="LeagueID="]').getAttribute('href'))[1] : null,
        region: byline && byline.querySelector('a[href*="RegionID="]') ? +/RegionID=(\d+)/i.exec(byline.querySelector('a[href*="RegionID="]').getAttribute('href'))[1] : null,
        weather: attrNum(arena, 'weather'),
        capacity,
        seats,
        building: building ? { seats: Object.fromEntries(SEATS.map((k, i) => [k, add[i]])), until: until ? until[0] : '' } : null,
        currency: symbol || '',
        rate,
        maxIncome: perMatch || null,
        upkeep: moneys[1] ? htNumber(moneys[1]) : null,
        youthCapacity: youth == null ? null : youth,
        // numbers: sold seats, then income.
        played: played.filter(m => !upcomingIds.has(m.id)),
        upcoming,
      },
    };
  }

  // Fans page: the fan club members open the table with the fans' mood and
  // the season's expectations; below are the fans' expectations for the
  // coming matches and how the played ones moved their mood.
  function readFans(doc) {
    const mood = doc.querySelector('table.thin a[href*="lt=FanMood"]');
    if (!mood) return null;
    const table = mood.closest('table');
    const fans = htNumber(cellValues(table)[0]);
    const a = team.arena;
    const rows = fans == null ? [] : [teamRow('fans', tr('htc_fans'), a.fans == null ? '—' : numFmt(a.fans), numFmt(fans), x => { x.arena.fans = fans; })];
    const withFans = id => Array.from(doc.querySelectorAll('#' + id + ' tr')).map(tr => {
      const m = matchRow(tr);
      if (!m) return null;
      const cells = tr.querySelectorAll('td');
      m.expectation = denomination(tr, 'FanMatch');
      if (id === 'played') m.moodChange = signedNumber(cellText(cells[cells.length - 1])) || 0;
      delete m.numbers;
      return m;
    }).filter(Boolean);
    const upcoming = withFans('upcoming');
    const next = nextMatchRow(upcoming);
    if (next) rows.push(next);
    return {
      rows,
      data: {
        members: fans,
        mood: denomination(table, 'FanMood'),
        season: denomination(table, 'FanSeason'),
        upcoming,
        played: withFans('played'),
      },
    };
  }

  // The youth academy's players: one .teamphoto-player box each, with the
  // skills as current level and potential, either of them maybe unknown.
  const YOUTH_SKILL_ROW = { Keeper: 'kp', Defender: 'df', Playmaking: 'pm', Winger: 'wi', Passer: 'ps', Scoring: 'sc', Kicker: 'sp' };
  const youthIdOf = a => { const m = a && /[?&]YouthPlayerID=(\d{1,12})\b/i.exec(a.getAttribute('href') || ''); return m ? m[1] : null; };
  function youthSkill(tr) {
    if (!tr) return { cur: null, cap: null, maxed: false };
    const bar = tr.querySelector('.ht-bar[level]');
    const cells = tr.querySelectorAll('td');
    // "3/3", "?/4", "5/?": what the page shows where a bar is hidden.
    const text = /(\d+|\?)\s*\/\s*(\d+|\?)/.exec(cells.length ? cells[cells.length - 1].textContent : '') || [];
    const known = v => { const n = parseInt(v, 10); return isNaN(n) || n < 0 ? null : n; };
    const cur = bar ? known(bar.getAttribute('level')) : known(text[1]);
    const cap = bar ? known(bar.getAttribute('cap')) : known(text[2]);
    const maxed = bar ? bar.getAttribute('is-cap') === '-1' || !!bar.querySelector('.maxed') : cur != null && cur === cap;
    return { cur: maxed && cur == null ? cap : cur, cap: maxed && cap == null ? cur : cap, maxed };
  }
  // The sortable list on the same page: the age cell's sort value is years
  // × 1000 + days, and the next cell with a sort value the days until he
  // can be promoted.
  function youthTable(doc) {
    const out = {};
    doc.querySelectorAll('table tbody tr').forEach(tr => {
      const id = youthIdOf(tr.querySelector('a[href*="YouthPlayerID="]'));
      if (!id) return;
      const sorted = Array.from(tr.querySelectorAll('td[data-sortvalue]'));
      const at = sorted.findIndex(td => { const v = +td.getAttribute('data-sortvalue'); return v >= 14000 && v < 22000 && v % 1000 < HT_YEAR; });
      if (at < 0) return;
      const age = +sorted[at].getAttribute('data-sortvalue');
      const days = parseInt(sorted[at + 1] && sorted[at + 1].getAttribute('data-sortvalue'), 10);
      out[id] = { age: { y: Math.floor(age / 1000), d: age % 1000 }, promote: isNaN(days) ? null : days };
    });
    return out;
  }
  function readYouthPlayers(doc) {
    const table = youthTable(doc);
    const found = [];
    doc.querySelectorAll('.teamphoto-player').forEach(box => {
      const link = box.querySelector('h3 a[href*="YouthPlayerID="]');
      const id = youthIdOf(link);
      const name = link && (link.getAttribute('title') || link.textContent || '').replace(/\s+/g, ' ').trim();
      if (!id || !name) return;
      const skills = {};
      Object.keys(YOUTH_SKILL_ROW).forEach(row => { skills[YOUTH_SKILL_ROW[row]] = youthSkill(box.querySelector('tr[id$="_tr' + row + '"]')); });
      // Without the list, the line under the name: age years, days, and the
      // days until promotion when he cannot be promoted yet.
      const nums = ((box.querySelector('p') || {}).textContent || '').match(/\d+/g) || [];
      const row = table[id] || {
        age: nums.length >= 2 ? { y: +nums[0], d: +nums[1] } : null,
        promote: nums.length >= 2 ? (nums.length >= 3 ? +nums[2] : 0) : null,
      };
      const spec = box.querySelector('tr[id$="_trSpeciality"] i[class*="icon-speciality-"]');
      const specNo = spec && /icon-speciality-(\d+)/.exec(spec.className);
      const rating = box.querySelector('hattrick-rating[rating]');
      const r = rating ? parseFloat(rating.getAttribute('rating')) : NaN;
      found.push({
        htid: id,
        name,
        age: row.age,
        promote: row.promote,
        spec: specNo ? HT_SPEC[specNo[1]] || '' : '',
        skills,
        rating: isNaN(r) ? null : r,
      });
    });
    return found.length ? { rows: [], data: { players: found } } : null;
  }

  // The academy's training page: its two trainings and how well the team
  // knows each formation (0–10).
  function readYouthTraining(doc) {
    const pick = id => { const o = doc.querySelector('select[id$="' + id + '"] option[selected]'); return o ? o.getAttribute('value') : null; };
    const primary = pick('ddlPrimary'), secondary = pick('ddlSecondary');
    if (primary == null || secondary == null) return null;
    const formations = {};
    doc.querySelectorAll('.formationExperience tr').forEach(tr => {
      const f = (tr.querySelector('td') || {}).textContent;
      const bar = tr.querySelector('.ht-bar[level]');
      const name = (f || '').trim();
      if (FORMATIONS.includes(name) && bar) formations[name] = attrNum(bar, 'level');
    });
    // An individual training (13) trains each player by his own plan.
    const kind = v => v === '13' ? 'individual' : HT_TRAINING[v] || null;
    return { rows: [], data: { primary: kind(primary), secondary: kind(secondary), formations } };
  }

  function planImport(parsed) {
    const key = s => s.trim().toLocaleLowerCase();
    const used = new Set();
    const items = parsed.players.map(h => {
      let p = players.find(x => x.htid === h.htid)
        || players.find(x => !x.htid && !used.has(x.id) && key(x.name) === key(h.name));
      if (p) used.add(p.id);
      const next = p ? normPlayer({ id: p.id, data: JSON.parse(JSON.stringify(playerData(p))) }) : newPlayer();
      if (p) next.id = p.id;
      else next.name = h.name;
      const before = JSON.stringify(playerData(next));
      next.htid = h.htid;
      if (h.age && ageDays(next) !== h.age.y * HT_YEAR + h.age.d) {
        next.age = { y: clampInt(h.age.y, 15, 45, 17), d: clampInt(h.age.d, 0, HT_YEAR - 1, 0), on: today() };
      }
      const changes = [];
      SKILLS.forEach(sk => {
        const to = clampInt(h.skills[sk], 0, MAX_LEVEL, 0);
        if (to === next.skills[sk]) return;
        if (p) {
          changes.push({ skill: sk, from: next.skills[sk], to });
          next.history.push({ date: today(), skill: sk, from: next.skills[sk], to });
        }
        next.skills[sk] = to;
      });
      next.spec = h.spec;
      if (h.form != null) next.form = clampInt(h.form, 1, 8, next.form);
      if (h.stamina != null) next.stamina = clampInt(h.stamina, 1, 9, next.stamina);
      if (h.xp != null) next.xp = clampInt(h.xp, 0, 20, next.xp);
      if (h.lead != null) next.lead = clampInt(h.lead, 1, 8, next.lead);
      if (h.loyalty != null) next.loyalty = clampInt(h.loyalty, 1, 20, next.loyalty);
      next.homegrown = h.homegrown;
      next.out = h.out;
      next.bruised = h.bruised;
      next.cards = h.cards;
      if (h.tsi != null) next.tsi = h.tsi;
      if (h.wage != null) next.wage = h.wage;
      const after = JSON.stringify(Object.assign(playerData(next), { htid: p ? p.htid : '' }));
      // A player matched by name only gains his Hattrick id: saved, not shown.
      const kind = !p ? 'new' : after !== before ? 'update' : 'same';
      return { kind, player: next, changes, on: true, save: kind !== 'same' || p.htid !== h.htid };
    });
    if (parsed.full) {
      players.filter(p => !used.has(p.id)).forEach(p => items.push({ kind: 'missing', player: p, changes: [], on: false }));
    }
    return { items, full: parsed.full, found: parsed.players.length };
  }

  function importPreviewHtml() {
    const plan = importPlan;
    const section = (kind, title, hint) => {
      const rows = plan.items.map((it, i) => ({ it, i })).filter(x => x.it.kind === kind);
      if (!rows.length) return '';
      return '<div class="htc-imp-sec"><h4>' + esc(title) + ' · ' + rows.length + '</h4>'
        + (hint ? '<p class="htc-dim">' + esc(hint) + '</p>' : '')
        + rows.map(({ it, i }) => '<label class="htc-check htc-imp-row"><input type="checkbox" data-imp="' + i + '"' + (it.on ? ' checked' : '') + '>'
          + '<span class="htc-imp-name">' + statusHtml(it.player) + esc(it.player.name) + ' ' + specHtml(it.player) + '</span>'
          + (kind === 'update' ? '<span class="htc-imp-changes">' + (it.changes.length
            ? it.changes.map(c => '<span class="' + (c.to > c.from ? 'htc-up' : 'htc-down') + '">' + esc(tr('htc_sk_' + c.skill)) + ' ' + c.from + ' → ' + c.to + '</span>').join(' ')
            : '<span class="htc-dim">' + esc(tr('htc_import_details')) + '</span>') + '</span>' : '')
          + '</label>').join('')
        + '</div>';
    };
    const same = plan.items.filter(it => it.kind === 'same').length;
    return '<div class="htc-card htc-imp">'
      + '<div class="htc-card-head"><h3>📥 ' + esc(tr('htc_import_title')) + '</h3>'
      + (plan.found ? '<span class="htc-dim">' + esc(tr('htc_import_found', { n: plan.found })) + '</span>' : '') + '</div>'
      + section('new', tr('htc_import_new'))
      + section('update', tr('htc_import_changed'))
      + section('missing', tr('htc_import_missing'), tr('htc_import_missing_hint'))
      + (same ? '<p class="htc-dim">' + esc(tr('htc_import_same', { n: same })) + '</p>' : '')
      + (plan.found && !plan.full ? '<p class="htc-dim">' + esc(tr('htc_import_partial')) + '</p>' : '')
      + (plan.rows.length ? '<div class="htc-imp-sec"><h4>' + esc(tr('htc_import_settings')) + ' · ' + plan.rows.length + '</h4>'
        + plan.rows.map((r, i) => '<label class="htc-check htc-imp-row"><input type="checkbox" data-row="' + i + '"' + (r.on ? ' checked' : '') + '>'
          + '<span class="htc-imp-name">' + esc(r.label) + '</span>'
          + '<span class="htc-imp-changes">' + (r.from ? '<span class="htc-dim">' + esc(r.from) + '</span> → ' : '') + '<b>' + esc(r.shown) + '</b></span>'
          + '</label>').join('')
        + '</div>' : '')
      + '<div class="htc-imp-actions">'
      + '<button class="htc-btn" id="htc-imp-cancel"' + (saving ? ' disabled' : '') + '>' + esc(tr('htc_import_cancel')) + '</button>'
      + '<button class="htc-btn htc-primary" id="htc-imp-apply"' + (saving ? ' disabled' : '') + '>' + esc(tr(saving ? 'htc_saving' : 'htc_import_apply')) + '</button>'
      + '</div></div>';
  }
  function bindImportPreview() {
    root.querySelectorAll('[data-imp]').forEach(cb => {
      cb.onchange = () => { importPlan.items[+cb.dataset.imp].on = cb.checked; };
    });
    root.querySelectorAll('[data-row]').forEach(cb => {
      cb.onchange = () => { importPlan.rows[+cb.dataset.row].on = cb.checked; };
    });
    root.querySelector('#htc-imp-cancel').onclick = () => { importPlan = null; importPages = null; render(); };
    root.querySelector('#htc-imp-apply').onclick = applyImport;
  }

  async function applyImport() {
    if (saving || !importPlan) return;
    saving = true;
    render();
    const plan = importPlan;
    const rows = plan.rows.filter(r => r.on);
    rows.forEach(r => r.apply(team));
    if (rows.length) saveTeamSoon();
    let added = 0, updated = 0, removed = 0, failed = false;
    for (const it of plan.items) {
      if (!it.on) continue;
      try {
        if (it.kind === 'missing') {
          await api('DELETE', '/players/' + it.player.id);
          dropPlayer(it.player.id);
          removed++;
        } else if (it.save) {
          await savePlayer(it.player);
          if (it.kind === 'new') added++;
          else if (it.kind === 'update') updated++;
        }
      } catch (_) { failed = true; }
    }
    saving = false;
    importPlan = null;
    const done = [];
    if (added + updated + removed) done.push(tr('htc_import_done', { added, updated, removed }));
    if (rows.length) done.push(tr('htc_import_team_done', { n: rows.length }));
    if (plan.youth) done.push(tr('htc_import_youth_done', { n: plan.youth }));
    banner = failed ? { kind: 'warn', text: tr('htc_save_error') }
      : done.length ? { kind: 'ok', text: done.join(' ') }
      : { kind: 'info', text: tr('htc_import_all_nothing') };
    render();
  }

  // Player form ──────────────────────────────────────────────────────────────
  function openPlayer(p) {
    draft = p ? normPlayer({ id: p.id, data: JSON.parse(JSON.stringify(playerData(p))) }) : newPlayer();
    if (p) draft.id = p.id;
    draftOrig = JSON.stringify(playerData(draft));
    draftGroup = p ? groupOf(p.id) : '';
    changeDate = today();
    banner = null;
    if (view !== 'player') tabView = view;
    view = 'player';
    render();
  }
  function closePlayer() {
    draft = null; view = tabView; render();
  }

  function renderPlayerForm() {
    const p = draft;
    const field = (label, inner, cls) => '<label class="htc-field' + (cls ? ' ' + cls : '') + '"><span>' + esc(tr(label)) + '</span>' + inner + '</label>';
    const sel = (id, lo, hi, v) => '<select class="htc-input" id="' + id + '">' + levelOptions(lo, hi, v) + '</select>';
    const hist = p.history.slice().sort((a, b) => dayNo(b.date) - dayNo(a.date));
    root.innerHTML = '<div class="htc-page"><div class="htc-wrap">'
      + '<div class="htc-top htc-sticky">'
      + '<button class="htc-btn htc-ghost" id="htc-back">‹ ' + esc(tr('htc_back')) + '</button>'
      + '<div class="htc-top-title">' + esc(p.id ? p.name : tr('htc_new_player')) + '</div>'
      + '<button class="htc-btn htc-primary" id="htc-save"' + (saving ? ' disabled' : '') + '>' + esc(tr(saving ? 'htc_saving' : 'htc_save')) + '</button>'
      + '</div>'
      + bannerHtml()
      + '<div class="htc-cols">'
      + '<section class="htc-card"><h3>' + esc(tr('htc_player')) + '</h3><div class="htc-grid">'
      + field('htc_f_name', '<input class="htc-input" id="htc-name" maxlength="60" value="' + esc(p.name) + '">', 'htc-span-all')
      + field('htc_f_age_y', '<input class="htc-input" type="number" inputmode="numeric" min="15" max="45" id="htc-age-y" value="' + ageFloor(p) + '">')
      + field('htc_f_age_d', '<input class="htc-input" type="number" inputmode="numeric" min="0" max="111" id="htc-age-d" value="' + (ageDays(p) % HT_YEAR) + '">')
      + field('htc_f_spec', '<select class="htc-input" id="htc-spec"><option value="">' + esc(tr('htc_spec_none')) + '</option>'
        + SPECS.map(s => '<option value="' + s + '"' + (p.spec === s ? ' selected' : '') + '>' + SPEC_ICON[s] + ' ' + esc(tr('htc_spec_' + s)) + '</option>').join('') + '</select>')
      + field('htc_f_tsi', '<input class="htc-input" type="number" inputmode="numeric" min="0" id="htc-tsi" value="' + (p.tsi ?? '') + '">')
      + field('htc_f_wage', '<input class="htc-input" type="number" inputmode="decimal" min="0" id="htc-wage" value="' + (p.wage ?? '') + '">')
      + field('htc_f_form', sel('htc-form', 1, 8, p.form))
      + field('htc_f_stamina', sel('htc-stamina', 1, 9, p.stamina))
      + field('htc_f_xp', sel('htc-xp', 0, 20, p.xp))
      + field('htc_f_lead', sel('htc-lead', 1, 8, p.lead))
      + field('htc_f_loyalty', sel('htc-loyalty', 1, 20, p.loyalty))
      + field('htc_f_group', '<select class="htc-input" id="htc-group">' + groupOptions(draftGroup) + '</select>')
      + field('htc_f_cards', '<select class="htc-input" id="htc-cards">' + [0, 1, 2].map(n => '<option value="' + n + '"' + (p.cards === n ? ' selected' : '') + '>' + (n ? '🟨'.repeat(n) : '—') + '</option>').join('') + '</select>')
      + '<label class="htc-check"><input type="checkbox" id="htc-hg"' + (p.homegrown ? ' checked' : '') + '> 🏠 ' + esc(tr('htc_f_homegrown')) + '</label>'
      + '<label class="htc-check"><input type="checkbox" id="htc-out"' + (p.out ? ' checked' : '') + '> 🚑 ' + esc(tr('htc_f_out')) + '</label>'
      + '<label class="htc-check"><input type="checkbox" id="htc-bruised"' + (p.bruised ? ' checked' : '') + '> 🩹 ' + esc(tr('htc_bruised')) + '</label>'
      + field('htc_f_notes', '<input class="htc-input" id="htc-notes" maxlength="500" value="' + esc(p.notes) + '">', 'htc-span-all')
      + '</div></section>'

      + '<div class="htc-col">'
      + '<section class="htc-card"><h3>' + esc(tr('htc_skills')) + '</h3>'
      + '<div class="htc-skills">' + SKILLS.map(s => '<div class="htc-skill" data-skill="' + s + '">'
        + '<span class="htc-skill-name">' + esc(tr('htc_sk_' + s)) + '</span>'
        + '<button class="htc-step" data-dir="-1" aria-label="−">−</button>'
        + '<select class="htc-input" data-skill="' + s + '">' + levelOptions(0, MAX_LEVEL, p.skills[s]) + '</select>'
        + '<button class="htc-step" data-dir="1" aria-label="+">+</button>'
        + '</div>').join('') + '</div>'
      + (p.id ? '<label class="htc-field htc-change-date"><span>' + esc(tr('htc_change_date')) + '</span><input class="htc-input" type="date" id="htc-change-date" value="' + esc(changeDate) + '"></label>'
        + '<p class="htc-note">' + esc(tr('htc_change_note')) + '</p>' : '')
      + '</section>'
      + (p.id ? '<section class="htc-card"><h3>' + esc(tr('htc_history')) + '</h3>'
        + (hist.length ? '<div class="htc-hist">' + hist.map(h => {
          const i = p.history.indexOf(h);
          return '<div class="htc-hist-row"><span class="htc-dim">' + esc(fmtDate(h.date)) + '</span>'
            + '<span>' + esc(tr('htc_sk_' + h.skill)) + '</span>'
            + '<span class="' + (h.to > h.from ? 'htc-up' : 'htc-down') + '">' + h.from + ' → ' + h.to + '</span>'
            + '<button class="htc-x" data-hist="' + i + '" aria-label="×" title="' + esc(tr('htc_hist_remove')) + '">×</button></div>';
        }).join('') + '</div>' : '<p class="htc-dim">' + esc(tr('htc_no_history')) + '</p>')
        + '</section>' : '')
      + '</div></div>'
      + (p.id ? '<div class="htc-foot"><button class="htc-btn htc-danger-btn" id="htc-remove">🗑 ' + esc(tr('htc_remove_player')) + '</button></div>' : '')
      + '</div></div>';

    root.querySelector('#htc-back').onclick = () => {
      if (formDirty() && !confirm(tr('htc_discard'))) return;
      closePlayer();
    };
    root.querySelector('#htc-save').onclick = submitPlayer;
    bindBanner();
    root.querySelectorAll('.htc-skill').forEach(row => {
      const s = row.dataset.skill;
      const select = row.querySelector('select');
      select.onchange = () => { draft.skills[s] = +select.value; };
      row.querySelectorAll('.htc-step').forEach(b => {
        b.onclick = () => {
          draft.skills[s] = Math.max(0, Math.min(MAX_LEVEL, draft.skills[s] + +b.dataset.dir));
          select.value = draft.skills[s];
        };
      });
    });
    const cd = root.querySelector('#htc-change-date');
    if (cd) cd.onchange = () => { changeDate = validDate(cd.value) || today(); };
    root.querySelectorAll('[data-hist]').forEach(b => {
      b.onclick = () => {
        readForm();
        draft.history.splice(+b.dataset.hist, 1);
        renderPlayerForm();
      };
    });
    const rm = root.querySelector('#htc-remove');
    if (rm) rm.onclick = async () => {
      if (!confirm(tr('htc_remove_confirm', { name: draft.name }))) return;
      try {
        await api('DELETE', '/players/' + draft.id);
        dropPlayer(draft.id);
        banner = { kind: 'ok', text: tr('htc_removed', { name: draft.name }) };
        closePlayer();
      } catch (_) { alert(tr('htc_save_error')); }
    };
  }
  const ageFloor = p => Math.floor(ageDays(p) / HT_YEAR);

  // The form's fields into the draft; the age is re-anchored on today only
  // when the manager actually changed it.
  function readForm() {
    const q = id => root.querySelector('#' + id);
    if (!q('htc-name')) return;
    draft.name = q('htc-name').value.trim();
    const y = clampInt(q('htc-age-y').value, 15, 45, ageFloor(draft));
    const d = clampInt(q('htc-age-d').value, 0, HT_YEAR - 1, ageDays(draft) % HT_YEAR);
    if (y !== ageFloor(draft) || d !== ageDays(draft) % HT_YEAR) draft.age = { y, d, on: today() };
    draft.spec = q('htc-spec').value;
    draft.tsi = q('htc-tsi').value === '' ? null : clampInt(q('htc-tsi').value, 0, 1e9, null);
    draft.wage = q('htc-wage').value === '' ? null : clampNum(q('htc-wage').value, 0, 1e9, null);
    draft.form = +q('htc-form').value;
    draft.stamina = +q('htc-stamina').value;
    draft.xp = +q('htc-xp').value;
    draft.lead = +q('htc-lead').value;
    draft.loyalty = +q('htc-loyalty').value;
    draft.homegrown = q('htc-hg').checked;
    draft.out = q('htc-out').checked;
    draft.bruised = q('htc-bruised').checked;
    draft.cards = +q('htc-cards').value;
    draft.notes = q('htc-notes').value.trim();
    draftGroup = q('htc-group').value;
  }
  function formDirty() {
    readForm();
    return JSON.stringify(playerData(draft)) !== draftOrig || draftGroup !== (draft.id ? groupOf(draft.id) : '');
  }

  async function submitPlayer() {
    if (saving) return;
    readForm();
    if (!draft.name) { alert(tr('htc_name_required')); return; }
    // Every skill that moved since the player was last saved goes into the
    // history under the chosen date, so training can learn from it.
    if (draft.id) {
      const before = playerById(draft.id);
      if (before) SKILLS.forEach(s => {
        if (before.skills[s] !== draft.skills[s]) {
          draft.history.push({ date: changeDate, skill: s, from: before.skills[s], to: draft.skills[s], training: trainingSnapshot(team.training) });
        }
      });
    }
    saving = true;
    renderPlayerForm();
    try {
      const saved = await savePlayer(draft);
      if (draftGroup !== groupOf(saved.id)) { setGroup(saved.id, draftGroup); saveTeamSoon(); }
      banner = { kind: 'ok', text: tr('htc_saved', { name: saved.name }) };
      saving = false;
      draft = null;
      view = tabView;
      render();
    } catch (_) {
      saving = false;
      banner = { kind: 'warn', text: tr('htc_save_error') };
      renderPlayerForm();
    }
  }

  // Lineup ───────────────────────────────────────────────────────────────────
  function lineupOpts() {
    const l = team.lineup;
    return {
      formation: l.formation, focus: l.focus, locks: {},
      training: team.training.type, trainees: new Set(matchGroup()), useTrainees: l.useTrainees,
      match: l.match, useStrongest: l.useStrongest,
    };
  }
  // Cup and friendly lineups normally preserve the players who make the
  // strongest league lineup. Trainees remain available so they can still get
  // their minutes. A manager can opt into the strongest XI for an important
  // cup match.
  function matchPool(opts) {
    const available = players.filter(p => !p.out);
    if (opts.match === 'league' || opts.useStrongest) return available;
    const leagueOpts = Object.assign({}, opts, { locks: {}, trainees: new Set(), useTrainees: false, match: 'league', useStrongest: true });
    const league = bestLineups(leagueOpts)[0];
    if (!league) return available;
    const leagueIds = new Set(Object.values(league.assigned).map(p => p.id));
    const pool = available.filter(p => !leagueIds.has(p.id) || opts.trainees.has(p.id));
    // A small squad may not have a full separate eleven. Only then reuse the
    // minimum number of league starters, beginning with the least valuable.
    if (pool.length < 11) {
      const value = p => weigh(contrib(p, bestPos(p), 'C', 1), 'balanced') / POS_SCALE[bestPos(p)];
      available.filter(p => leagueIds.has(p.id) && !pool.includes(p)).sort((a, b) => value(a) - value(b))
        .slice(0, 11 - pool.length).forEach(p => pool.push(p));
    }
    return pool;
  }
  function matchLineups(opts) {
    return bestLineups(opts, matchPool(opts));
  }
  function setPieceBonuses() {
    if (team.training.type !== 'setpieces') return new Map();
    const best = matchLineups(lineupOpts())[0];
    if (!best) return new Map();
    const inTeam = Object.values(best.assigned);
    const suggested = inTeam.slice().sort((a, b) => effSkill(b, 'sp') - effSkill(a, 'sp'))[0];
    const taker = inTeam.find(p => p.id === team.lineup.setTaker) || suggested;
    const bonuses = new Map();
    const keeper = best.assigned['GK-C'];
    if (keeper) bonuses.set(keeper.id, 1.25);
    if (taker) bonuses.set(taker.id, 1.25);
    return bonuses;
  }
  function lineupHtml() {
    if (!players.some(p => !p.out)) return '<div class="htc-empty"><div class="htc-empty-icon">📋</div>' + esc(tr('htc_lineup_empty')) + '</div>';
    const l = team.lineup;
    const opts = lineupOpts();
    const avail = matchPool(opts);
    const all = matchLineups(Object.assign({}, opts, { formation: 'auto' }));
    const best = l.formation === 'auto' ? all[0] : matchLineups(opts)[0];
    const hasTrainees = matchGroup().some(id => playerById(id));
    const subs = benchFor(best, l.focus, avail);
    const used = new Set(Object.values(best.assigned).concat(subs.map(x => x.player)).map(p => p.id));
    const rest = avail.filter(p => !used.has(p.id));
    const inTeam = Object.values(best.assigned);
    const captain = inTeam.slice().sort((a, b) => (b.lead * 2 + b.xp) - (a.lead * 2 + a.xp))[0];
    const suggestedTaker = inTeam.slice().sort((a, b) => effSkill(b, 'sp') - effSkill(a, 'sp'))[0];
    const setTaker = inTeam.find(p => p.id === l.setTaker) || suggestedTaker;
    const maxR = Math.max(1, ...SECTORS.map(k => best.ratings[k]));

    const slotHtml = s => {
      const p = best.assigned[s.id];
      const tt = TRAININGS[team.training.type];
      const trainee = p && l.useTrainees && opts.trainees.has(p.id) && tt.pos[s.pos];
      return '<div class="htc-slot' + (trainee ? ' trainee' : '') + '">'
        + '<span class="htc-slot-pos">' + esc(posShort(s.pos)) + (p ? ' ' + statusHtml(p) : '') + '</span>'
        + '<b class="htc-slot-name" title="' + esc(p ? p.name : '') + '">' + esc(p ? p.name : '—') + '</b>'
        + (p ? '<span class="htc-slot-sk">' + slotSkills(p, s.pos) + '</span>' : '')
        + '</div>';
    };
    const line = (slots) => '<div class="htc-line">' + slots.map(slotHtml).join('') + '</div>';
    // Left on the left: the left wide player, the central ones left to
    // right, then the right wide player.
    const SIDE_ORDER = { L: 0, C: 1, R: 2 };
    const orderLine = list => {
      const wide = s => s.pos === 'W' || s.pos === 'WB';
      return list.filter(s => wide(s) && s.side === 'L')
        .concat(list.filter(s => !wide(s)).sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]),
          list.filter(s => wide(s) && s.side === 'R'));
    };
    const bar = k => '<div class="htc-rating"><span>' + esc(tr('htc_sec_' + k)) + '</span>'
      + '<div class="htc-rbar"><div style="width:' + (best.ratings[k] / maxR * 100).toFixed(1) + '%"></div></div>'
      + '<b>' + numFmt(best.ratings[k], 1) + '</b></div>';
    const traineeCheck = hasTrainees ? '<label class="htc-check"><input type="checkbox" id="htc-use-trainees"' + (l.useTrainees ? ' checked' : '') + '> 📈 ' + esc(tr('htc_use_trainees', { training: tr('htc_tr_' + team.training.type) })) + '</label>' : '';
    const strongestCheck = l.match !== 'league' ? '<label class="htc-check"><input type="checkbox" id="htc-use-strongest"' + (l.useStrongest ? ' checked' : '') + '> 💪 ' + esc(tr('htc_use_strongest')) + '</label>' : '';
    const checkRow = traineeCheck || strongestCheck ? '<div class="htc-lineup-checks htc-span-all">' + traineeCheck + strongestCheck + '</div>' : '';
    const traineeNotice = hasTrainees ? '' : '<p class="htc-dim htc-span-all">' + esc(tr('htc_no_group_trainees', { group: tr('htc_group_' + GROUP_OF_MATCH[l.match]) })) + '</p>';

    return '<section class="htc-card"><div class="htc-grid htc-grid-lineup">'
      + '<label class="htc-field"><span>' + esc(tr('htc_match')) + '</span><select class="htc-input" id="htc-match">'
      + MATCHES.map(m => '<option value="' + m + '"' + (l.match === m ? ' selected' : '') + '>' + MATCH_ICON[m] + ' ' + esc(tr('htc_match_' + m)) + '</option>').join('')
      + '</select></label>'
      + '<label class="htc-field"><span>' + esc(tr('htc_formation')) + '</span><select class="htc-input" id="htc-formation">'
      + '<option value="auto"' + (l.formation === 'auto' ? ' selected' : '') + '>' + esc(tr('htc_formation_auto')) + '</option>'
      + FORMATIONS.map(f => '<option value="' + f + '"' + (l.formation === f ? ' selected' : '') + '>' + f + '</option>').join('')
      + '</select></label>'
      + '<label class="htc-field"><span>' + esc(tr('htc_focus')) + '</span><select class="htc-input" id="htc-focus">'
      + Object.keys(FOCUS).map(f => '<option value="' + f + '"' + (l.focus === f ? ' selected' : '') + '>' + esc(tr('htc_focus_' + f)) + '</option>').join('')
      + '</select></label>'
      + checkRow + traineeNotice
      + '</div></section>'

      + '<div class="htc-cols">'
      + '<section class="htc-card"><div class="htc-card-head"><h3>' + esc(tr('htc_lineup_for', { f: best.st.name })) + '</h3>'
      + '<span class="htc-score">' + esc(tr('htc_score')) + ' <b>' + numFmt(best.score, 1) + '</b></span></div>'
      + '<div class="htc-pitch">'
      + line(best.slots.filter(s => s.pos === 'GK'))
      + line(orderLine(best.slots.filter(s => s.pos === 'WB' || s.pos === 'CD')))
      + line(orderLine(best.slots.filter(s => s.pos === 'W' || s.pos === 'IM')))
      + line(orderLine(best.slots.filter(s => s.pos === 'FW')))
      + '</div>'
      + '<div class="htc-roles">'
      + (captain ? '<span>©️ ' + esc(tr('htc_captain')) + ': <b>' + esc(captain.name) + '</b></span>' : '')
      + (setTaker ? '<label>🎯 ' + esc(tr('htc_set_taker')) + ': <select class="htc-role-sel" id="htc-set-taker">'
        + '<option value=""' + (l.setTaker == null ? ' selected' : '') + '>' + esc(tr('htc_auto')) + ': ' + esc(suggestedTaker.name) + '</option>'
        + inTeam.map(p => '<option value="' + p.id + '"' + (l.setTaker === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('')
        + '</select></label>' : '')
      + '</div>'
      + (subs.length ? '<div class="htc-subs-wrap"><h4>🔁 ' + esc(tr('htc_bench')) + '</h4>'
        + '<p class="htc-dim">' + esc(tr('htc_bench_hint')) + '</p>'
        + '<div class="htc-subs">' + subs.map(x => '<div class="htc-sub">'
          + '<span class="htc-sub-pos" title="' + esc(x.extra ? tr('htc_bench_extra') : tr('htc_pos_full_' + x.pos)) + '">' + esc((x.extra ? '+' : '') + posShort(x.pos)) + '</span>'
          + '<span class="htc-sub-name">' + statusHtml(x.player) + esc(x.player.name) + ' ' + specHtml(x.player) + '</span>'
          + '<span class="htc-slot-sk">' + slotSkills(x.player, x.pos) + '</span>'
          + (x.replaces ? '<span class="htc-sub-for htc-dim">↔ ' + esc(x.replaces.name) + '</span>' : '')
          + '</div>').join('') + '</div></div>' : '')
      + (rest.length ? '<div class="htc-bench"><span class="htc-dim">' + esc(tr('htc_not_used')) + ':</span> '
        + rest.map(p => '<span class="htc-chip' + (p.out ? ' out' : '') + '">' + statusHtml(p) + esc(p.name) + '</span>').join('') + '</div>' : '')
      + '</section>'

      + '<div class="htc-col">'
      + '<section class="htc-card"><h3>' + esc(tr('htc_ratings')) + '</h3>'
      + bar('m')
      + '<div class="htc-rgroup">' + ['dr', 'dc', 'dl'].map(bar).join('') + '</div>'
      + '<div class="htc-rgroup">' + ['ar', 'ac', 'al'].map(bar).join('') + '</div>'
      + '<p class="htc-note">' + esc(tr('htc_ratings_note')) + '</p></section>'
      + '<section class="htc-card"><h3>' + esc(tr('htc_formations')) + '</h3>'
      + '<div class="htc-forms">' + all.map((r, i) => '<button class="htc-form-row' + (r.st.name === best.st.name ? ' on' : '') + '" data-f="' + r.st.name + '">'
        + '<span class="htc-form-name">' + (i === 0 ? '★ ' : '') + r.st.name + '</span>'
        + '<div class="htc-rbar"><div style="width:' + (r.score / all[0].score * 100).toFixed(1) + '%"></div></div>'
        + '<b>' + numFmt(r.score, 1) + '</b></button>').join('') + '</div>'
      + '</section>'
      + '</div></div>';
  }
  // The skills that matter in a position, shortest form.
  function slotSkills(p, pos) {
    const keys = [...new Set(CONTRIB[pos].map(c => c[0]))].slice(0, 3);
    return keys.map(k => esc(tr('htc_abbr_' + k)) + ' ' + p.skills[k]).join(' · ');
  }
  function bindLineup() {
    const l = team.lineup;
    const on = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.onchange = () => { fn(el); saveTeamSoon(); render(); }; };
    on('htc-match', el => { l.match = el.value; });
    on('htc-formation', el => { l.formation = el.value; });
    on('htc-focus', el => { l.focus = el.value; });
    on('htc-use-trainees', el => { l.useTrainees = el.checked; });
    on('htc-use-strongest', el => { l.useStrongest = el.checked; });
    on('htc-set-taker', el => { l.setTaker = el.value ? +el.value : null; });
    root.querySelectorAll('.htc-form-row').forEach(b => {
      b.onclick = () => { l.formation = b.dataset.f; saveTeamSoon(); render(); };
    });
  }

  // Training ─────────────────────────────────────────────────────────────────
  function trainingHtml() {
    const t = team.training;
    const tt = TRAININGS[t.type];
    const full = POSITIONS.filter(p => tt.pos[p] === 1);
    const part = POSITIONS.filter(p => tt.pos[p] && tt.pos[p] < 1);
    const tf = teamFactor(t);
    const GROUP_RANK = { trainees: 2, cup: 1, '': 0 };
    const setPieceBonusByPlayer = setPieceBonuses();
    const rows = players.map(p => ({ p, f: forecast(p, t, tf, setPieceBonusByPlayer.get(p.id)), group: groupOf(p.id) }));
    rows.sort((a, b) => (GROUP_RANK[b.group] - GROUP_RANK[a.group]) || (a.f.weeks - b.f.weeks) || a.p.name.localeCompare(b.p.name));
    const slots = trainedSlots(t.type);
    const field = (label, inner) => '<label class="htc-field"><span>' + esc(tr(label)) + '</span>' + inner + '</label>';
    const numIn = (id, lo, hi, v) => '<input class="htc-input" type="number" inputmode="numeric" min="' + lo + '" max="' + hi + '" id="' + id + '" value="' + v + '">';
    const posList = (list, share) => list.map(p => esc(tr('htc_pos_full_' + p)) + (share ? ' ' + Math.round(tt.pos[p] * 100) + '%' : '')).join(', ');

    return '<section class="htc-card"><h3>' + esc(tr('htc_training')) + '</h3><div class="htc-grid">'
      + field('htc_training_type', '<select class="htc-input" id="htc-t-type">' + TRAINING_KEYS.map(k => '<option value="' + k + '"' + (t.type === k ? ' selected' : '') + '>'
        + esc(tr('htc_tr_' + k)) + (!tr('htc_tr_' + k).startsWith(tr('htc_sk_' + TRAININGS[k].skill)) ? ' · ' + esc(tr('htc_sk_' + TRAININGS[k].skill)) : '') + '</option>').join('') + '</select>')
      + field('htc_coach', '<select class="htc-input" id="htc-t-coach">' + [8, 7, 6, 5, 4].map(n => levelOpt(n, t.coach)).join('') + '</select>')
      + field('htc_assistants', numIn('htc-t-assist', 0, 10, t.assistants))
      + field('htc_intensity', numIn('htc-t-int', 0, 100, t.intensity))
      + field('htc_stamina_share', numIn('htc-t-stam', 10, 100, t.stamina))
      + '</div>'
      + '<p class="htc-trained">'
      + (full.length ? '<span>✅ ' + esc(tr('htc_full_training')) + ': <b>' + posList(full) + '</b></span>' : '')
      + (part.length ? '<span>🔸 ' + esc(tr('htc_part_training')) + ': <b>' + posList(part, true) + '</b></span>' : '')
      + '</p></section>'

      + (players.length ? '<section class="htc-card"><div class="htc-card-head"><h3>' + esc(tr('htc_forecast', { skill: tr('htc_sk_' + tt.skill) })) + '</h3>'
        + '<span class="htc-dim">' + esc(tf.n ? tr('htc_learned_team', { n: tf.n }) : tr('htc_learned_none')) + '</span></div>'
        + '<div class="htc-groups">'
        + ['trainees', 'cup'].map(g => '<span class="htc-chip htc-group-' + g + '">' + GROUP_ICON[g] + ' ' + esc(tr('htc_group_' + g)) + ': <b>'
          + t[g].filter(id => playerById(id)).length + ' / ' + slots + '</b></span>').join('')
        + '<button class="htc-btn" id="htc-split">⚖️ ' + esc(tr('htc_split')) + '</button></div>'
        + '<div class="htc-trows">' + rows.map(({ p, f, group }) => {
          const trainee = !!group;
          const pct = isFinite(f.weeks) ? Math.min(100, f.elapsed / f.weeks * 100) : 0;
          const remain = isFinite(f.weeks) ? Math.max(0, f.weeks - f.elapsed) : null;
          return '<div class="htc-trow' + (trainee ? ' on htc-group-' + group : '') + (p.out ? ' out' : '') + '">'
            + '<select class="htc-input htc-trainee" data-group="' + p.id + '" title="' + esc(tr('htc_trainee')) + '" aria-label="' + esc(tr('htc_trainee')) + '">'
            + groupOptions(group, true) + '</select>'
            + '<div class="htc-tmain">'
            + '<div class="htc-tname"><b>' + esc(p.name) + '</b> ' + specHtml(p) + '<span class="htc-dim">' + esc(ageLabel(p)) + '</span></div>'
            + '<div class="htc-tlevel">' + esc(tr('htc_sk_' + f.skill)) + ': <b>' + f.level + ' · ' + esc(levelName(f.level)) + '</b></div>'
            + (trainee && isFinite(f.weeks)
              ? '<div class="htc-bar"><div style="width:' + pct.toFixed(1) + '%"></div></div>'
                + '<div class="htc-tinfo">' + esc(remain < 0.5 ? tr('htc_pop_due') : tr('htc_pop_in', { w: numFmt(remain, 1), date: fmtDate(f.next) }))
                + ' · ' + esc(tr('htc_per_level', { w: numFmt(f.weeks, 1) }))
                + (f.season ? ' · ' + esc(tr('htc_season_gain', { n: f.season })) : '') + '</div>'
              : '<div class="htc-tinfo htc-dim">' + (isFinite(f.weeks) ? esc(tr('htc_per_level', { w: numFmt(f.weeks, 1) })) : esc(tr('htc_max_level'))) + '</div>')
            + (f.own ? '<div class="htc-tinfo htc-learned">' + esc(tr('htc_learned_own', { n: f.own, pct: Math.round((f.factor - 1) * 100) > 0 ? '+' + Math.round((f.factor - 1) * 100) : Math.round((f.factor - 1) * 100) })) + '</div>' : '')
            + '</div>'
            + '</div>';
        }).join('') + '</div>'
        + '<p class="htc-note">' + esc(tr('htc_training_note')) + '</p></section>'
        + bestTrainingHtml(tf)
        : '<div class="htc-empty"><div class="htc-empty-icon">📈</div>' + esc(tr('htc_no_players')) + '</div>');
  }
  function groupOptions(group, short) {
    return ['', 'trainees', 'cup'].map(g => '<option value="' + g + '"' + (group === g ? ' selected' : '') + '>'
      + (g ? GROUP_ICON[g] + (short ? '' : ' ' + esc(tr('htc_group_' + g))) : (short ? '—' : esc(tr('htc_group_none')))) + '</option>').join('');
  }
  // The most players one match can train fully: every formation's slots in
  // the positions the training gives its full effect.
  function trainedSlots(type) {
    const tt = TRAININGS[type];
    const top = Math.max(...POSITIONS.map(pos => tt.pos[pos] || 0));
    let most = 0;
    FORMATIONS.forEach(n => structures(n).forEach(st => {
      most = Math.max(most, slotsOf(st).filter(x => tt.pos[x.pos] === top).length);
    }));
    return most;
  }
  // The players a training would take furthest, highest level after a season
  // first; the skill they already have counts as much as how fast they learn.
  function bestFor(type, tf) {
    const tk = Object.assign({}, team.training, { type });
    return players.map(p => ({ p, f: forecast(p, tk, tf) }))
      .filter(x => isFinite(x.f.weeks))
      .sort((a, b) => (b.f.projected - a.f.projected) || (a.f.weeks - b.f.weeks));
  }
  // The best of the current training: the first ones train in the league
  // match, the next ones in the cup or friendly.
  function splitTrainees() {
    const t = team.training;
    const n = trainedSlots(t.type);
    const order = bestFor(t.type, teamFactor(t)).map(x => x.p.id);
    t.trainees = order.slice(0, n);
    t.cup = order.slice(n, 2 * n);
  }
  // Every training type with the players it would take furthest.
  const BEST_SHOWN = 3;
  function bestTrainingHtml(tf) {
    const t = team.training;
    const rows = TRAINING_KEYS.map(k => ({ k, list: bestFor(k, tf).slice(0, BEST_SHOWN) }));
    return '<section class="htc-card"><div class="htc-card-head"><h3>🏅 ' + esc(tr('htc_best_title')) + '</h3></div>'
      + '<p class="htc-dim">' + esc(tr('htc_best_hint')) + '</p>'
      + '<div class="htc-best">' + rows.map(({ k, list }) => '<div class="htc-best-row' + (k === t.type ? ' on' : '') + '">'
        + '<span class="htc-best-type">' + esc(tr('htc_tr_' + k)) + (!tr('htc_tr_' + k).startsWith(tr('htc_sk_' + TRAININGS[k].skill)) ? ' <span class="htc-dim">· ' + esc(tr('htc_sk_' + TRAININGS[k].skill)) + '</span>' : '') + '</span>'
        + '<span class="htc-best-list">' + (list.length ? list.map(({ p, f }) => {
          const g = groupOf(p.id);
          return '<span class="htc-chip' + (p.out ? ' out' : '') + '" title="' + esc(tr('htc_sk_' + TRAININGS[k].skill) + ': ' + levelName(p.skills[TRAININGS[k].skill])) + '">'
            + (g && k === t.type ? GROUP_ICON[g] + ' ' : '') + esc(p.name) + ' <span class="htc-dim">' + f.level + ' →</span> <b>' + numFmt(f.projected, 1) + '</b></span>';
        }).join('') : '<span class="htc-dim">—</span>') + '</span></div>').join('') + '</div>'
      + '<p class="htc-note">' + esc(tr('htc_best_note')) + '</p></section>';
  }
  function bindTraining() {
    const t = team.training;
    const on = (id, fn) => {
      const el = root.querySelector('#' + id);
      if (el) el.onchange = () => { fn(el); saveTeamSoon(); render(); };
    };
    on('htc-t-type', el => { t.type = el.value; });
    on('htc-t-coach', el => { t.coach = +el.value; });
    on('htc-t-assist', el => { t.assistants = clampInt(el.value, 0, 10, 0); });
    on('htc-t-int', el => { t.intensity = clampInt(el.value, 0, 100, 100); });
    on('htc-t-stam', el => { t.stamina = clampInt(el.value, 10, 100, 10); });
    root.querySelectorAll('[data-group]').forEach(sel => {
      sel.onchange = () => {
        setGroup(+sel.dataset.group, sel.value);
        saveTeamSoon();
        render();
      };
    });
    const split = root.querySelector('#htc-split');
    if (split) split.onclick = () => {
      if (t.trainees.length + t.cup.length && !confirm(tr('htc_split_confirm'))) return;
      splitTrainees();
      banner = { kind: 'ok', text: tr('htc_split_done') };
      saveTeamSoon();
      render();
    };
  }

  // Youth academy ────────────────────────────────────────────────────────────
  // A guide, not the game: the academy's lineup is chosen for its training,
  // and each youth gets a plain verdict. The numbers below are judgement.
  const YOUTH_SECONDARY = 2 / 3; // the secondary training gives two-thirds
  const YOUTH_STRENGTH = 0.15;   // how much playing well matters next to training
  const YOUTH_FORMATION_XP = 0.3; // per level of formation experience (0–10)
  const YOUTH_SELL = 6;          // a skill this good sells once promoted
  const YOUTH_PROSPECT = 7;      // a potential this high is worth the wait
  const YOUTH_RELEASE = 5;       // nothing known above this: the place is better used
  const YOUTH_SQUAD = 11;

  const youthPlayers = () => ((pages.youth && pages.youth.data && pages.youth.data.players) || [])
    .filter(y => y && y.skills && /^\d{1,12}$/.test(String(y.htid || '')));
  const youthTraining = () => (pages.youthtraining && pages.youthtraining.data) || null;
  const ySkill = (y, k) => {
    const s = y.skills[k] || {};
    const n = v => Number.isInteger(v) && v >= 0 && v <= MAX_LEVEL ? v : null;
    return { cur: n(s.cur), cap: n(s.cap), maxed: s.maxed === true };
  };
  // An unknown current level is taken as two below a known potential.
  const yNow = s => s.cur != null ? s.cur : s.cap != null ? Math.max(0, s.cap - 2) : 0;
  // What he can reach for sure: the potential, else what he already has.
  const yPot = s => s.cap != null ? s.cap : s.cur != null ? s.cur : 0;
  // A youth as a player of the squad, for the same lineup maths.
  function youthAs(y, level) {
    return {
      id: 'y' + y.htid, name: String(y.name || ''), spec: SPECS.includes(y.spec) ? y.spec : '',
      skills: Object.fromEntries(SKILLS.map(k => [k, level(ySkill(y, k))])),
      form: 6, stamina: 6, xp: 0, lead: 1, loyalty: 1, homegrown: true,
    };
  }
  // What a week of training in one skill is worth to him: growth towards a
  // high potential, or the chance to learn a potential still unknown.
  function youthGain(s, reveal) {
    if (s.maxed || (s.cur != null && s.cap != null && s.cur >= s.cap)) return { v: 0, why: 'done' };
    // The primary report reveals a current level; the secondary report
    // reveals a potential. Keep those two priorities distinct.
    if (reveal === 'current' && s.cur == null) return { v: 3.5 + (s.cap || 0) * 0.1, why: 'reveal-current' };
    if (reveal === 'potential' && s.cap == null) return { v: 3.5 + (s.cur || 0) * 0.1, why: 'reveal' };
    if (s.cap == null) return { v: 1 + (s.cur || 0) * 0.1, why: 'none' };
    const room = s.cap - yNow(s);
    return { v: Math.min(room, 4) * s.cap / 5 + (s.cur == null ? 0.3 : 0), why: 'grow' };
  }
  function youthSlotValue(y, as, slot, tt) {
    let train = 0, why = null, skill = null;
    let whyWeight = -1;
    tt.forEach(([t, w, reveal]) => {
      const share = t && TRAININGS[t] ? TRAININGS[t].pos[slot.pos] || 0 : 0;
      if (!share) return;
      const sk = TRAININGS[t].skill, g = youthGain(ySkill(y, sk), reveal);
      train += g.v * share * w;
      if (!why || w > whyWeight) { why = g.why; skill = sk; whyWeight = w; }
    });
    const strength = weigh(contrib(as, slot.pos, slot.side, slot.crowd), 'balanced') / POS_SCALE[slot.pos];
    return { v: train + YOUTH_STRENGTH * strength, why, skill };
  }
  function youthLineups(list) {
    const yt = youthTraining();
    const tt = yt ? [[yt.primary, 1, 'current'], [yt.secondary !== yt.primary ? yt.secondary : null, YOUTH_SECONDARY, 'potential']] : [];
    const xp = (yt && yt.formations) || {};
    const pool = list.map(y => ({ y, as: youthAs(y, yNow) }));
    const results = [];
    FORMATIONS.forEach(name => {
      let best = null;
      structures(name).forEach(st => {
        const slots = slotsOf(st);
        const cols = pool.concat(new Array(Math.max(0, slots.length - pool.length)).fill(null));
        const vals = slots.map(s => cols.map(c => c ? youthSlotValue(c.y, c.as, s, tt) : { v: 0 }));
        const assigned = {};
        let score = 0;
        hungarian(vals.map(row => row.map(x => -x.v))).forEach((j, i) => {
          if (j < 0 || !cols[j]) return;
          assigned[slots[i].id] = Object.assign({ y: cols[j].y }, vals[i][j]);
          score += vals[i][j].v;
        });
        const x = Number.isInteger(xp[name]) ? xp[name] : null;
        score += YOUTH_FORMATION_XP * (x || 0);
        if (!best || score > best.score) best = { st, slots, assigned, score, xp: x };
      });
      if (best) results.push(best);
    });
    results.sort((a, b) => b.score - a.score);
    return results;
  }
  // One representative type per skill prevents the advice from repeating
  // alternate training types for the same skill while others remain hidden.
  const YOUTH_REVEAL_TYPES = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setpieces'];
  function youthTrainingSuggestion(list) {
    const score = (type, reveal) => list.reduce((sum, y) => sum + youthGain(ySkill(y, TRAININGS[type].skill), reveal).v, 0);
    let best = null;
    YOUTH_REVEAL_TYPES.forEach(primary => YOUTH_REVEAL_TYPES.forEach(secondary => {
      if (primary === secondary) return;
      const value = score(primary, 'current') + YOUTH_SECONDARY * score(secondary, 'potential');
      if (!best || value > best.value) best = { primary, secondary, value };
    }));
    return best;
  }

  // The weakest starter of the first team's best lineup in each position.
  function weakestStarters() {
    const avail = players.filter(p => !p.out);
    if (!avail.length) return {};
    const best = bestLineups(Object.assign({}, lineupOpts(), { formation: 'auto', useTrainees: false, locks: {} }))[0];
    const out = {};
    best.slots.forEach(s => {
      const p = best.assigned[s.id];
      if (!p) return;
      const v = weigh(contrib(p, s.pos, 'C', 1), 'balanced');
      if (!out[s.pos] || v < out[s.pos].v) out[s.pos] = { p, v };
    });
    return out;
  }
  function youthVerdict(y, weakest) {
    const sk = SKILLS.map(k => ({ k, s: ySkill(y, k) }));
    const now = youthAs(y, s => s.cur != null ? s.cur : 0);
    const pos = bestPos(youthAs(y, yPot));
    const ready = y.promote === 0;
    const top = sk.reduce((a, b) => (b.s.cur || 0) > (a.s.cur || 0) ? b : a);
    const w = weakest[bestPos(now)];
    if (ready && w && weigh(contrib(now, bestPos(now), 'C', 1), 'balanced') >= w.v) {
      return { v: 'first', pos, text: tr('htc_vr_first', { name: w.p.name, pos: tr('htc_pos_full_' + bestPos(now)) }) };
    }
    const high = sk.filter(x => x.s.cap != null && x.s.cap >= YOUTH_PROSPECT).sort((a, b) => b.s.cap - a.s.cap)[0];
    if (high) return { v: 'prospect', pos, text: tr('htc_vr_prospect_cap', { skill: tr('htc_sk_' + high.k), level: high.s.cap + ' · ' + levelName(high.s.cap) }) };
    const open = sk.filter(x => x.s.cap == null && x.s.cur != null && x.s.cur >= YOUTH_RELEASE).sort((a, b) => b.s.cur - a.s.cur)[0];
    if (open) return { v: 'prospect', pos, text: tr('htc_vr_prospect_open', { skill: tr('htc_sk_' + open.k), level: open.s.cur + ' · ' + levelName(open.s.cur) }) };
    if (ready && (top.s.cur || 0) >= YOUTH_SELL) {
      return { v: 'sell', pos, text: tr('htc_vr_sell', { skill: tr('htc_sk_' + top.k), level: top.s.cur + ' · ' + levelName(top.s.cur) }) };
    }
    // A skill already seen but with its potential still hidden is worth
    // waiting for when it is good already or the academy trains it; a skill
    // never seen at all is no reason to keep anyone.
    const yt = youthTraining();
    const trained = new Set([yt && yt.primary, yt && yt.secondary].filter(t => t && TRAININGS[t]).map(t => TRAININGS[t].skill));
    const pending = sk.filter(x => x.s.cap == null && x.s.cur != null && (x.s.cur >= YOUTH_RELEASE - 1 || trained.has(x.k)));
    const seen = sk.filter(x => x.s.cur != null || x.s.cap != null);
    const bestKnown = Math.max(...sk.map(x => yPot(x.s)));
    if (seen.length && bestKnown <= YOUTH_RELEASE && !pending.length) {
      return { v: 'release', pos, text: tr('htc_vr_release', { level: bestKnown + ' · ' + levelName(bestKnown) }) };
    }
    const find = (pending.length ? pending : sk.filter(x => x.s.cap == null)).map(x => tr('htc_sk_' + x.k)).join(', ');
    return { v: 'keep', pos, text: tr('htc_vr_keep', { skills: find || '—' }) };
  }

  const VERDICT_ICON = { first: '⭐', prospect: '💎', sell: '💰', keep: '🔍', release: '👋' };
  const VERDICT_ORDER = ['first', 'prospect', 'sell', 'keep', 'release'];
  function ySkillHtml(s) {
    const t = (s.cur != null ? s.cur : '?') + '/' + (s.cap != null ? s.cap : '?');
    if (s.cur == null && s.cap == null) return '<td class="htc-dim htc-ysk">·</td>';
    const lv = yPot(s);
    return '<td class="htc-ysk' + (lv >= YOUTH_SELL ? ' good' : '') + (s.maxed ? ' maxed' : '') + '">' + t + (s.maxed ? '✔' : '') + '</td>';
  }
  function youthHtml() {
    const list = youthPlayers();
    if (!list.length) return '<div class="htc-empty"><div class="htc-empty-icon">🌱</div>' + esc(tr('htc_youth_empty')) + '</div>';
    const yt = youthTraining();
    const trName = t => t ? tr('htc_tr_' + t) : '—';
    const nextTraining = youthTrainingSuggestion(list);
    const all = youthLineups(list);
    const f = team.youth.formation;
    const best = (f !== 'auto' && all.find(r => r.st.name === f)) || all[0];
    const weakest = weakestStarters();
    const rows = list.map(y => ({ y, v: youthVerdict(y, weakest) }))
      .sort((a, b) => VERDICT_ORDER.indexOf(a.v.v) - VERDICT_ORDER.indexOf(b.v.v) || String(a.y.name).localeCompare(String(b.y.name), lang()));
    const going = rows.filter(r => r.v.v === 'release').length;
    const SIDE_ORDER = { L: 0, C: 1, R: 2 };
    const orderLine = l => {
      const wide = s => s.pos === 'W' || s.pos === 'WB';
      return l.filter(s => wide(s) && s.side === 'L')
        .concat(l.filter(s => !wide(s)).sort((a, b) => SIDE_ORDER[a.side] - SIDE_ORDER[b.side]), l.filter(s => wide(s) && s.side === 'R'));
    };
    const slotHtml = s => {
      const a = best.assigned[s.id];
      if (!a) return '<div class="htc-slot"><span class="htc-slot-pos">' + esc(posShort(s.pos)) + '</span><b>—</b></div>';
      // Where he is not trained, the skill that matters most there.
      const shown = a.skill || CONTRIB[s.pos][0][0];
      const sk = ySkill(a.y, shown);
      const icon = { grow: '📈', reveal: '🔍', 'reveal-current': '🔍', done: '✔' }[a.why] || '';
      const why = a.why === 'grow' ? tr('htc_youth_why_grow', { skill: tr('htc_sk_' + a.skill), cur: sk.cur != null ? sk.cur : '?', cap: sk.cap })
        : a.why === 'reveal-current' ? tr('htc_youth_why_reveal_current', { skill: tr('htc_sk_' + a.skill) })
        : a.why === 'reveal' ? tr('htc_youth_why_reveal', { skill: tr('htc_sk_' + a.skill) })
        : a.why === 'done' ? tr('htc_youth_why_done', { skill: tr('htc_sk_' + a.skill) })
        : tr('htc_youth_why_none');
      return '<div class="htc-slot' + (a.why === 'grow' || a.why === 'reveal' || a.why === 'reveal-current' ? ' trainee' : '') + '">'
        + '<span class="htc-slot-pos">' + esc(posShort(s.pos)) + '</span>'
        + '<b class="htc-yname">' + esc(a.y.name) + '</b>'
        + '<span class="htc-slot-sk" title="' + esc(why) + '">' + (icon ? icon + ' ' : '') + esc(tr('htc_abbr_' + shown) + ' ' + (sk.cur != null ? sk.cur : '?') + '/' + (sk.cap != null ? sk.cap : '?')) + '</span>'
        + '</div>';
    };
    const line = l => '<div class="htc-line">' + orderLine(l).map(slotHtml).join('') + '</div>';
    const inTeam = new Set(Object.values(best.assigned).map(a => a.y.htid));
    const out = list.filter(y => !inTeam.has(y.htid));

    return '<section class="htc-card"><div class="htc-grid htc-grid-lineup">'
      + '<div class="htc-field"><span>' + esc(tr('htc_youth_training')) + '</span><b>' + esc(trName(yt && yt.primary)) + '</b></div>'
      + '<div class="htc-field"><span>' + esc(tr('htc_youth_secondary')) + '</span><b>' + esc(trName(yt && yt.secondary)) + '</b></div>'
      + '<label class="htc-field"><span>' + esc(tr('htc_formation')) + '</span><select class="htc-input" id="htc-y-formation">'
      + '<option value="auto"' + (f === 'auto' ? ' selected' : '') + '>' + esc(tr('htc_formation_auto')) + '</option>'
      + FORMATIONS.map(n => '<option value="' + n + '"' + (f === n ? ' selected' : '') + '>' + n + '</option>').join('')
      + '</select></label>'
      + (nextTraining ? '<p class="htc-note htc-span-all">💡 ' + esc(tr('htc_youth_next_training', { primary: trName(nextTraining.primary), secondary: trName(nextTraining.secondary) })) + '</p>' : '')
      + (yt ? '' : '<p class="htc-dim htc-span-all">' + esc(tr('htc_youth_notrain')) + '</p>')
      + '</div></section>'

      + '<div class="htc-cols">'
      + '<section class="htc-card"><div class="htc-card-head"><h3>' + esc(tr('htc_youth_lineup', { f: best.st.name })) + '</h3>'
      + (best.xp != null ? '<span class="htc-score">' + esc(tr('htc_formation_xp', { n: best.xp })) + '</span>' : '') + '</div>'
      + '<p class="htc-dim htc-yhint">' + esc(tr('htc_youth_lineup_hint')) + '</p>'
      + '<div class="htc-pitch">'
      + line(best.slots.filter(s => s.pos === 'GK'))
      + line(best.slots.filter(s => s.pos === 'WB' || s.pos === 'CD'))
      + line(best.slots.filter(s => s.pos === 'W' || s.pos === 'IM'))
      + line(best.slots.filter(s => s.pos === 'FW'))
      + '</div>'
      + '<p class="htc-ylegend htc-dim">📈 ' + esc(tr('htc_youth_leg_grow')) + ' · 🔍 ' + esc(tr('htc_youth_leg_reveal')) + ' · ✔ ' + esc(tr('htc_youth_leg_done')) + '</p>'
      + (out.length ? '<div class="htc-bench"><span class="htc-dim">' + esc(tr('htc_not_used')) + ':</span> '
        + out.map(y => '<span class="htc-chip">' + esc(y.name) + '</span>').join('') + '</div>' : '')
      + '</section>'
      + '<div class="htc-col"><section class="htc-card"><h3>' + esc(tr('htc_formations')) + '</h3>'
      + '<div class="htc-forms">' + all.map((r, i) => '<button class="htc-form-row htc-y-form' + (r.st.name === best.st.name ? ' on' : '') + '" data-f="' + r.st.name + '">'
        + '<span class="htc-form-name">' + (i === 0 ? '★ ' : '') + r.st.name + '</span>'
        + '<div class="htc-rbar"><div style="width:' + Math.max(0, r.score / all[0].score * 100).toFixed(1) + '%"></div></div>'
        + '<b>' + (r.xp != null ? r.xp + '/10' : '') + '</b></button>').join('') + '</div>'
      + '<p class="htc-note">' + esc(tr('htc_youth_forms_note')) + '</p>'
      + '</section></div></div>'

      + '<section class="htc-card htc-table-card"><div class="htc-table-wrap"><table class="htc-table htc-ytable">'
      + '<thead><tr><th>' + esc(tr('htc_f_name')) + '</th>'
      + SKILLS.map(k => '<th title="' + esc(tr('htc_sk_' + k)) + '">' + esc(tr('htc_abbr_' + k)) + '</th>').join('')
      + '<th>' + esc(tr('htc_youth_potential')) + '</th><th>' + esc(tr('htc_youth_verdict')) + '</th></tr></thead><tbody>'
      + rows.map(({ y, v }) => '<tr>'
        + '<td class="htc-name">' + esc(y.name) + ' ' + specHtml({ spec: SPECS.includes(y.spec) ? y.spec : '' })
        + '<span class="htc-yage htc-dim">' + esc([y.age ? tr('htc_age_fmt', { y: y.age.y, d: y.age.d }) : '',
          y.promote === 0 ? tr('htc_youth_promote_now') : y.promote > 0 ? tr('htc_youth_promote_in', { n: y.promote }) : ''].filter(Boolean).join(' · ')) + '</span></td>'
        + SKILLS.map(k => ySkillHtml(ySkill(y, k))).join('')
        + '<td><span class="htc-pos">' + esc(posShort(v.pos)) + '</span></td>'
        + '<td class="htc-verdict"><b class="htc-v htc-v-' + v.v + '">' + VERDICT_ICON[v.v] + ' ' + esc(tr('htc_v_' + v.v)) + '</b><br><span class="htc-dim">' + esc(v.text) + '</span></td>'
        + '</tr>').join('')
      + '</tbody></table></div></section>'
      + '<p class="htc-note">' + esc(tr('htc_youth_legend')) + '</p>'
      + (going && list.length - going < YOUTH_SQUAD ? '<p class="htc-note htc-warn">' + esc(tr('htc_youth_min', { n: list.length, m: YOUTH_SQUAD })) + '</p>' : '')
      + '<p class="htc-note">' + esc(tr('htc_youth_note')) + '</p>';
  }
  function bindYouth() {
    const set = v => { team.youth.formation = v; saveTeamSoon(); render(); };
    const sel = root.querySelector('#htc-y-formation');
    if (sel) sel.onchange = () => set(sel.value);
    root.querySelectorAll('.htc-y-form').forEach(b => { b.onclick = () => set(b.dataset.f); });
  }

  // Arena ────────────────────────────────────────────────────────────────────
  function arenaHtml() {
    const a = team.arena;
    const plan = arenaPlan(a);
    const cur = a.currency;
    const money = v => numFmt(Math.round(v)) + ' ' + cur;
    const numIn = (id, v, step) => '<input class="htc-input" type="number" inputmode="decimal" min="0" step="' + (step || 1) + '" id="' + id + '" value="' + (v ?? '') + '">';
    const field = (label, inner) => '<label class="htc-field"><span>' + esc(tr(label)) + '</span>' + inner + '</label>';
    const signed = n => (n > 0 ? '+' : '') + numFmt(n);
    return '<div class="htc-cols">'
      + '<section class="htc-card"><h3>' + esc(tr('htc_arena_now')) + '</h3><div class="htc-grid">'
      + SEATS.map(k => field('htc_seat_' + k, numIn('htc-a-seat-' + k, a.seats[k]))).join('')
      + field('htc_fans', numIn('htc-a-fans', a.fans))
      + field('htc_per_fan', numIn('htc-a-perfan', a.perFan, 0.5))
      + field('htc_target', '<input class="htc-input" type="number" inputmode="numeric" min="0" id="htc-a-target" placeholder="' + esc(numFmt(plan.demand)) + '" value="' + (a.target ?? '') + '">')
      + field('htc_home_games', numIn('htc-a-home', a.homeGames))
      + '</div><p class="htc-note">' + esc(tr('htc_arena_note')) + '</p>'
      + '<details class="htc-details"><summary>' + esc(tr('htc_arena_prices')) + '</summary>'
      + '<div class="htc-price-grid"><span></span><span>' + esc(tr('htc_ratio')) + '</span><span>' + esc(tr('htc_ticket')) + '</span><span>' + esc(tr('htc_build')) + '</span><span>' + esc(tr('htc_upkeep')) + '</span>'
      + SEATS.map(k => '<span class="htc-price-name">' + SEAT_ICON[k] + ' ' + esc(tr('htc_seat_' + k)) + '</span>'
        + ['ratio', 'price', 'build', 'upkeep'].map(g => '<input class="htc-input" type="number" inputmode="decimal" min="0" step="0.1" data-g="' + g + '" data-k="' + k + '" value="' + a[g][k] + '">').join('')).join('')
      + '</div><div class="htc-grid">'
      + field('htc_demolish', numIn('htc-a-demolish', a.demolish, 0.5))
      + field('htc_fixed', numIn('htc-a-fixed', a.fixed, 100))
      + field('htc_currency', '<input class="htc-input" id="htc-a-currency" maxlength="6" value="' + esc(a.currency) + '">')
      + '</div><button class="htc-link" id="htc-a-defaults">' + esc(tr('htc_arena_defaults')) + '</button></details>'
      + '</section>'

      + '<section class="htc-card"><h3>' + esc(tr('htc_arena_plan', { n: numFmt(plan.demand) })) + '</h3>'
      + '<div class="htc-seat-rows">' + SEATS.map(k => '<div class="htc-seat-row">'
        + '<span class="htc-seat-name">' + SEAT_ICON[k] + ' ' + esc(tr('htc_seat_' + k)) + '</span>'
        + '<span class="htc-dim">' + numFmt(a.seats[k]) + ' →</span><b>' + numFmt(plan.want[k]) + '</b>'
        + '<span class="' + (plan.delta[k] > 0 ? 'htc-up' : plan.delta[k] < 0 ? 'htc-down' : 'htc-dim') + '">' + (plan.delta[k] ? signed(plan.delta[k]) : '=') + '</span></div>').join('')
      + '<div class="htc-seat-row htc-seat-total"><span class="htc-seat-name">' + esc(tr('htc_total')) + '</span><span class="htc-dim">' + numFmt(plan.current) + ' →</span><b>' + numFmt(plan.demand) + '</b>'
      + '<span>' + (plan.demand - plan.current ? signed(plan.demand - plan.current) : '=') + '</span></div></div>'
      + '<div class="htc-stats htc-stats-2">'
      + stat(money(plan.cost), tr('htc_cost'))
      + stat(money(plan.newIncome - plan.curIncome), tr('htc_match_gain'))
      + stat(money(plan.newUpkeep - plan.curUpkeep), tr('htc_upkeep_change'))
      + stat(money(plan.seasonGain), tr('htc_season_net'))
      + '</div>'
      + '<p class="htc-payback">' + esc(plan.cost === 0 ? tr('htc_no_change')
        : plan.payback != null ? tr('htc_payback', { n: numFmt(plan.payback, 1) }) : tr('htc_no_payback')) + '</p>'
      + '<div class="htc-kv"><span>' + esc(tr('htc_match_income')) + '</span><b>' + money(plan.curIncome) + ' → ' + money(plan.newIncome) + '</b></div>'
      + '<div class="htc-kv"><span>' + esc(tr('htc_week_upkeep')) + '</span><b>' + money(plan.curUpkeep) + ' → ' + money(plan.newUpkeep) + '</b></div>'
      + '</section></div>';
  }
  function bindArena() {
    const a = team.arena;
    const on = (id, fn) => {
      const el = root.querySelector('#' + id);
      if (el) el.onchange = () => { fn(el); saveTeamSoon(); render(); };
    };
    SEATS.forEach(k => on('htc-a-seat-' + k, el => { a.seats[k] = clampInt(el.value, 0, 200000, 0); }));
    on('htc-a-fans', el => { a.fans = el.value === '' ? null : clampInt(el.value, 0, 1e6, null); });
    on('htc-a-perfan', el => { a.perFan = clampNum(el.value, 1, 100, 15); });
    on('htc-a-target', el => { a.target = el.value === '' ? null : clampInt(el.value, 0, 200000, null); });
    on('htc-a-home', el => { a.homeGames = clampInt(el.value, 1, 30, 8); });
    on('htc-a-demolish', el => { a.demolish = clampNum(el.value, 0, 1e5, 6); });
    on('htc-a-fixed', el => { a.fixed = clampNum(el.value, 0, 1e8, 10000); });
    on('htc-a-currency', el => { a.currency = el.value.trim().slice(0, 6) || '€'; });
    root.querySelectorAll('[data-g]').forEach(el => {
      el.onchange = () => {
        a[el.dataset.g][el.dataset.k] = clampNum(el.value, 0, 1e6, 0);
        saveTeamSoon();
        render();
      };
    });
    // Reopen the price table after a re-render if it was open.
    const det = root.querySelector('.htc-details');
    if (det) {
      det.open = arenaDetailsOpen;
      det.ontoggle = () => { arenaDetailsOpen = det.open; };
    }
    const def = root.querySelector('#htc-a-defaults');
    if (def) def.onclick = () => {
      const d = defaultArena();
      ['ratio', 'price', 'build', 'upkeep', 'demolish', 'fixed', 'currency'].forEach(k => { a[k] = d[k]; });
      saveTeamSoon();
      render();
    };
  }
  let arenaDetailsOpen = false;

  // ── Game Hub ───────────────────────────────────────────────────────────────
  function exit() {
    mp.send({ type: 'htc_exit' });
    // room_closed normally takes us there; this is the fallback.
    setTimeout(() => { location.href = HUB_URL; }, 800);
  }

  async function load() {
    try {
      const [d, pg] = await Promise.all([api('GET', '/state'), api('GET', '/pages').catch(() => ({}))]);
      pages = pg && typeof pg === 'object' ? pg : {};
      players = (d.players || []).map(normPlayer);
      sortPlayers();
      team = normTeam(d.team);
      loadError = false;
    } catch (_) {
      loadError = true;
    }
  }

  // Nothing to set up and nobody to wait for, so the lobby is skipped: the
  // host's own start request goes out as soon as the lobby shows.
  let starting = false;
  function renderSetup(box) {
    box.innerHTML = '<div class="htc-opening">' + esc(tr('htc_opening')) + '</div>';
    if (!starting) {
      starting = true;
      fetch('/api/pub/gamehub/mp/rooms/' + encodeURIComponent(mp.roomId()) + '/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gh_token: window.GameHub.getToken(), settings: {} }),
      }).catch(() => { starting = false; });
    }
    return () => ({});
  }

  async function renderGame(box) {
    root = box;
    root.classList.add('htc-root');
    root.innerHTML = '<div class="htc-page"><div class="htc-opening">' + esc(tr('htc_opening')) + '</div></div>';
    await load();
    render();
  }

  mp.on('room_closed', () => { location.href = HUB_URL; });

  window.addEventListener('beforeunload', e => {
    if (view === 'player' && draft && formDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // The extension says which site it was opened on shortly after the page
  // loads; the squad view then shows or hides the Hattrick import.
  if (window.mvmOS && window.mvmOS.extension) {
    window.mvmOS.extension.onContext(() => { if (view === 'squad') render(); });
  }

  mp.registerGame({
    id: GAME_ID,
    name: 'Hattrick Calculator',
    renderSetup,
    renderGame,
    exitButton: false,
    saveable: false,
  });
})();
