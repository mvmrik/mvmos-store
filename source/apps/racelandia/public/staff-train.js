// Racelandia - the mini games of the team's specialists (doctor, coach, race engineer, strategist,
// meteorologist, chief mechanic, scout, manager). Each game is six short rounds; a round ends with one
// number between 0 and 1. The server turns the mean of the six into a percentage and moves the specialist's
// level by that many points, so the browser only reports what happened: {version:1, rounds:[six numbers]}.
// `opts.difficulty` makes the rounds harder as the level grows (0 at level 50).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const W = 400, H = 300, ROUNDS = 6, FLASH = .8;
const rnd = (a, b) => a + Math.random() * (b - a);
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return (s - 3) / .707; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// Every game: limit (seconds a round may take), init(d, tr) -> state, tick(s, dt) -> value|undefined,
// click(s, p) -> value|undefined, end(s) -> value when the time is up, draw(g, s, u) with the helpers u.
const GAMES = { staff_doctor: doctor(), staff_coach: coach(), staff_engineer: engineer(), staff_strategist: strategist(),
  staff_meteorologist: meteorologist(), staff_mechanic: mechanic(), staff_scout: scout(), staff_manager: manager() };

export function run(game, box, tr, done, opts = {}) {
  const G = GAMES[game];
  if (!G) throw new Error('Unknown specialist game');
  const d = Math.max(0, Number(opts.difficulty) || 0);
  box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'ap-tg-wrap ap-crew-drill';
  const canvas = document.createElement('canvas'); canvas.className = 'ap-tg-canvas'; canvas.style.touchAction = 'none'; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', tr('ap_trd_' + game));
  const start = document.createElement('button'); start.className = 'ap-btn'; start.textContent = tr('ap_train');
  wrap.append(canvas, start); box.append(wrap);
  const g = canvas.getContext('2d');
  const fit = () => { const w = Math.min(wrap.clientWidth || 400, 520), dpr = Math.min(2, window.devicePixelRatio || 1); canvas.style.width = w + 'px'; canvas.style.height = w * H / W + 'px'; canvas.width = w * dpr; canvas.height = w * H / W * dpr; };
  fit(); const resize = new ResizeObserver(fit); resize.observe(wrap);
  const u = {
    text(s, x, y, size = 14, color = '#ecf2fc', align = 'center') { g.font = `600 ${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color; g.fillText(String(s), x, y); },
    rect(x, y, w, h, color, r = 0) { g.beginPath(); if (r) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); g.fillStyle = color; g.fill(); },
    circle(x, y, r, color) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = color; g.fill(); },
    line(pts, color, width = 2) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); },
    button(x, y, w, h, label, on = false) { u.rect(x, y, w, h, on ? '#3a77c9' : '#27405f', 8); u.text(label, x + w / 2, y + h / 2, 13); },
    hit: (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h,
    tr,
  };
  let raf = 0, dead = false, started = false, finished = false, round = 0, s = null, flash = 0, flashValue = 0, previous = performance.now();
  const values = [];
  const begin = () => { s = G.init(d, tr); s.t = 0; };
  begin();
  const finishRound = v => {
    if (flash > 0 || v == null) return;
    flashValue = clamp(v, 0, 1); values.push(flashValue); flash = FLASH;
  };
  const point = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  const active = () => started && !finished && flash <= 0 && !document.querySelector('dialog.ap-message[open]');
  const onDown = e => { if (!active()) return; e.preventDefault(); const p = point(e); finishRound(G.click?.(s, p, u)); };
  const onMove = e => { if (active()) G.move?.(s, point(e), u); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  start.onclick = () => { if (started) return; started = true; start.remove(); canvas.focus(); previous = performance.now(); };
  const frame = now => {
    if (dead) return;
    const dt = Math.min(.05, Math.max(0, (now - previous) / 1000)); previous = now;
    if (active()) {
      s.t += dt;
      finishRound(G.tick?.(s, dt));
      if (s.t >= G.limit) finishRound(G.end(s));
    } else if (flash > 0 && !finished) {
      flash -= dt;
      if (flash <= 0) {
        round++;
        if (round >= ROUNDS) { finished = true; done({ version: 1, rounds: values.slice() }); if (dead) return; }
        else begin();
      }
    }
    g.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    u.rect(0, 0, W, H, '#111c2a');
    u.rect(20, 14, 360, 6, '#26364a', 3); u.rect(20, 14, 360 * clamp(round / ROUNDS + (s && started ? Math.min(1, s.t / G.limit) / ROUNDS : 0), 0, 1), 6, '#5cbdff', 3);
    u.text(tr('ap_crew_drill_round', { n: Math.min(round + 1, ROUNDS), total: ROUNDS }), 200, 36, 13, '#bdcce0');
    if (s) G.draw(g, s, u);
    if (flash > 0) {
      u.rect(0, 52, W, H - 52, '#0d1622c0');
      u.text(Math.round(flashValue * 100) + '%', 200, 150, 52, flashValue > .66 ? '#4fd18b' : flashValue > .33 ? '#f2c230' : '#ff5a5a');
    }
    if (!started) { u.rect(0, 52, W, H - 52, '#111c2abf'); u.text(tr('ap_tr_' + game), 200, 140, 18, '#ecf2fc'); }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { destroy() { if (dead) return; dead = true; cancelAnimationFrame(raf); resize.disconnect(); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); } };
}

// Doctor: three vital signs drift out of their green zones; tap a bar on the side you want it to move.
function doctor() {
  const names = ['pulse', 'hydration', 'fatigue'];
  return {
    limit: 7,
    init(d) { return { zone: .14 / (1 + .9 * d), push: .13 * (1 + .4 * d), bars: names.map(() => ({ v: rnd(.35, .65), vel: rnd(-.05, .05) })), inside: 0, time: 0, drift: .22 * (1 + .7 * d) }; },
    tick(s, dt) {
      s.time += dt;
      s.bars.forEach(b => { b.vel = clamp(b.vel + gauss() * 1.1 * dt, -s.drift, s.drift); b.v = clamp(b.v + b.vel * dt, 0, 1); if (b.v <= 0 || b.v >= 1) b.vel *= -.5; if (Math.abs(b.v - .5) <= s.zone) s.inside += dt / s.bars.length; });
    },
    click(s, p) { names.forEach((n, i) => { const y = 78 + i * 62; if (p.y >= y - 8 && p.y <= y + 42) s.bars[i].v = clamp(s.bars[i].v + (p.x < 200 ? -s.push : s.push), 0, 1); }); },
    end(s) { return s.inside / Math.max(.1, s.time); },
    draw(g, s, u) {
      names.forEach((n, i) => {
        const y = 78 + i * 62, b = s.bars[i], ok = Math.abs(b.v - .5) <= s.zone;
        u.text(u.tr('ap_stg_v_' + n), 24, y - 6, 12, '#bdcce0', 'left');
        u.rect(20, y + 6, 360, 26, '#26364a', 6); u.rect(20 + 360 * (.5 - s.zone), y + 6, 360 * 2 * s.zone, 26, '#1f6b4a', 4);
        u.rect(20 + 360 * b.v - 4, y + 2, 8, 34, ok ? '#4fd18b' : '#ff5a5a', 3);
        u.text('◀', 36, y + 19, 12, '#7f97b8'); u.text('▶', 364, y + 19, 12, '#7f97b8');
      });
      u.text(u.tr('ap_stg_doctor_hint'), 200, 276, 12, '#9fb2cc');
    },
  };
}

// Coach: two lap traces; click where the driver lost time against the reference.
function coach() {
  return {
    limit: 9,
    init(d) {
      const x0 = rnd(90, 310), width = 36 / (1 + .3 * d), depth = 36 / (1 + .55 * d), tol = 70 / (1 + .8 * d);
      const base = Array.from({ length: 41 }, (_, i) => 150 - 55 * Math.sin(i / 41 * Math.PI * 3) + gauss() * 2);
      const driver = base.map((v, i) => { const x = 20 + i * 9; return v + gauss() * 3 + depth * Math.exp(-Math.pow((x - x0) / (width / 2), 2)); });
      return { base, driver, x0, tol, wait: 2.2 };
    },
    click(s, p) { if (s.t < s.wait || p.y < 70) return; return 1 - Math.abs(p.x - s.x0) / s.tol; },
    end() { return 0; },
    draw(g, s, u) {
      const pts = a => a.map((v, i) => [20 + i * 9, 70 + v * .85]);
      u.line(pts(s.base), '#5cbdff', 2); u.line(pts(s.driver), '#ffb347', 2);
      u.text(u.tr('ap_stg_ref'), 40, 276, 12, '#5cbdff', 'left'); u.text(u.tr('ap_stg_driver'), 150, 276, 12, '#ffb347', 'left');
      u.text(u.tr(s.t < s.wait ? 'ap_stg_analysing' : 'ap_stg_coach_hint'), 200, 256, 12, '#9fb2cc');
    },
  };
}

// Race engineer: one of four gauges goes red; click it, then send the matching radio call.
function engineer() {
  const gauges = ['tyres', 'fuel', 'engine', 'brakes'];
  return {
    limit: 8,
    init(d) { return { bad: Math.floor(Math.random() * 4), at: rnd(1.6, 3), stage: 0, got: 0, window: 3.2 / (1 + .9 * d), order: shuffle(gauges), swing: [0, 0, 0, 0].map(() => rnd(0, 6)) }; },
    click(s, p) {
      if (s.t < s.at) return;
      if (s.stage === 0) {
        gauges.forEach((n, i) => { if (u_hit(p, 20 + i * 92, 60, 84, 84)) { s.pickedAt = s.t; s.picked = i; } });
        if (s.picked == null) return;
        s.stage = 1; s.gaugeOk = s.picked === s.bad; s.speed = clamp(1 - (s.pickedAt - s.at) / s.window, .35, 1);
        return;
      }
      s.order.forEach((n, i) => { if (u_hit(p, 20 + (i % 2) * 185, 176 + Math.floor(i / 2) * 50, 175, 42)) s.call = n; });
      if (s.call == null) return;
      return ((s.gaugeOk ? .5 : 0) + (s.call === gauges[s.bad] ? .5 : 0)) * s.speed;
    },
    end() { return 0; },
    draw(g, s, u) {
      gauges.forEach((n, i) => {
        const x = 20 + i * 92, bad = s.t >= s.at && i === s.bad, v = bad ? .94 : .45 + .06 * Math.sin(s.t * 2 + s.swing[i]);
        u.rect(x, 60, 84, 84, bad ? '#4a1f2a' : '#1d2c40', 10);
        const cx = x + 42, cy = 118, a = Math.PI * (1 + v * .999);
        u.line([[cx, cy], [cx + 30 * Math.cos(a), cy + 30 * Math.sin(a)]], bad ? '#ff5a5a' : '#4fd18b', 3);
        u.text(u.tr('ap_stg_g_' + n), cx, 76, 11, '#bdcce0');
      });
      if (s.stage === 1 || s.t >= s.at) {
        if (s.stage === 1) s.order.forEach((n, i) => u.button(20 + (i % 2) * 185, 176 + Math.floor(i / 2) * 50, 175, 42, u.tr('ap_stg_m_' + n)));
      }
      u.text(u.tr(s.stage === 1 ? 'ap_stg_call' : s.t < s.at ? 'ap_stg_watch' : 'ap_stg_find'), 200, 160, 12, '#9fb2cc');
    },
  };
}
function u_hit(p, x, y, w, h) { return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h; }

// Strategist: the wear of a tyre is plotted for a few laps; click the lap where it will reach the cliff line.
function strategist() {
  const X0 = 30, DX = 8.6, Y0 = 250, SC = 190;
  return {
    limit: 10,
    init(d) {
      const rate = rnd(.012, .03), cliff = .72, lap = Math.round(cliff / rate), shown = Math.max(4, Math.round(lap * rnd(.35, .5)));
      return { rate, lap, shown, tol: 5 / (1 + .8 * d), noise: .012 * (1 + .5 * d), dots: Array.from({ length: shown }, (_, i) => (i + 1) * rate + gauss() * .012 * (1 + .5 * d)), wait: 2 };
    },
    click(s, p) { if (s.t < s.wait || p.y < 60) return; const lap = Math.round((p.x - X0) / DX); s.guess = lap; return 1 - Math.abs(lap - s.lap) / s.tol; },
    end() { return 0; },
    draw(g, s, u) {
      u.rect(X0, Y0 - SC, 342, SC, '#16263a');
      u.line([[X0, Y0 - .72 * SC], [X0 + 342, Y0 - .72 * SC]], '#ff5a5a', 1.5);
      u.text(u.tr('ap_stg_cliff'), X0 + 4, Y0 - .72 * SC - 8, 11, '#ff5a5a', 'left');
      s.dots.forEach((v, i) => u.circle(X0 + (i + 1) * DX, Y0 - clamp(v, 0, 1) * SC, 3.5, '#5cbdff'));
      u.text(u.tr('ap_stg_lap'), 200, 270, 11, '#7f97b8');
      for (let l = 10; l <= 40; l += 10) u.text(l, X0 + l * DX, 261, 10, '#7f97b8');
      u.text(u.tr(s.t < s.wait ? 'ap_stg_analysing' : 'ap_stg_strat_hint'), 200, 56, 12, '#9fb2cc');
    },
  };
}

// Meteorologist: a radar picture is shown briefly; then say how much of the area was raining.
function meteorologist() {
  const N = 10, CS = 20, X0 = 20, Y0 = 62;
  return {
    limit: 9,
    init(d) {
      const cover = rnd(.1, .9), cells = Array.from({ length: N * N }, () => Math.random() < cover);
      const real = cells.filter(Boolean).length / (N * N);
      return { real, cells, show: 1.8 / (1 + .6 * d), tol: .34 / (1 + .9 * d), guess: .5, locked: false };
    },
    click(s, p) {
      if (s.t < s.show + .3) return;
      if (u_hit(p, 290, 112, 90, 40)) return 1 - Math.abs(s.guess - s.real) / s.tol;
      if (u_hit(p, 240, 214, 140, 28)) s.guess = clamp((p.x - 240) / 140, 0, 1);
    },
    end() { return 0; },
    draw(g, s, u) {
      const visible = s.t < s.show;
      u.rect(X0 - 2, Y0 - 2, N * CS + 4, N * CS + 4, '#16263a', 6);
      s.cells.forEach((c, i) => { const x = X0 + (i % N) * CS, y = Y0 + Math.floor(i / N) * CS; u.rect(x + 1, y + 1, CS - 2, CS - 2, visible ? (c ? '#3a7be0' : '#243752') : '#1b2a3e', 3); });
      if (!visible) {
        u.text(u.tr('ap_stg_cover') + ': ' + Math.round(s.guess * 100) + '%', 310, 82, 13);
        u.button(290, 112, 90, 40, u.tr('ap_stg_ok'));
        u.rect(240, 222, 140, 8, '#26364a', 4); u.rect(240, 222, 140 * s.guess, 8, '#3a7be0', 4); u.circle(240 + 140 * s.guess, 226, 8, '#ecf2fc');
        u.text(u.tr('ap_stg_radar_hint'), 200, 276, 11, '#9fb2cc');
      } else u.text(u.tr('ap_stg_watch'), 200, 276, 12, '#9fb2cc');
    },
  };
}

// Chief mechanic: five parts of the car are shown by colour only; click the most worn.
function mechanic() {
  const parts = ['engine', 'gearbox', 'brakes', 'suspension', 'floor'];
  const color = w => `hsl(${Math.round(120 * (1 - w))} 68% 46%)`;
  return {
    limit: 8,
    init(d) {
      const base = rnd(.15, .55), gap = .16 / (1 + .9 * d);
      const worst = Math.floor(Math.random() * 5);
      const wear = parts.map((_, i) => i === worst ? base + gap : base + rnd(-.1, .6) * gap);
      return { wear, worst, wait: 1.8 };
    },
    click(s, p) {
      if (s.t < s.wait) return;
      for (let i = 0; i < 5; i++) if (u_hit(p, 20 + i * 72, 100, 66, 100)) {
        const order = s.wear.map((w, j) => [w, j]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
        return [1, .4, .15, 0, 0][order.indexOf(i)];
      }
    },
    end() { return 0; },
    draw(g, s, u) {
      parts.forEach((n, i) => { u.rect(20 + i * 72, 100, 66, 100, color(s.wear[i]), 10); u.text(u.tr('ap_part_' + n), 53 + i * 72, 222, 10, '#bdcce0'); });
      u.text(u.tr(s.t < s.wait ? 'ap_stg_analysing' : 'ap_stg_mech_hint'), 200, 270, 12, '#9fb2cc');
    },
  };
}

// Scout: four prospects' readings flicker; pick the one with the best real figures.
function scout() {
  return {
    limit: 9,
    init(d) {
      const prospects = Array.from({ length: 4 }, () => ({ pace: rnd(.25, .85), stamina: rnd(.25, .85) }));
      const total = prospects.map(p => p.pace + p.stamina), best = total.indexOf(Math.max(...total));
      return { prospects, total, best, noise: .14 * (1 + .8 * d), show: 2.6 / (1 + .5 * d), shown: prospects.map(() => ({ pace: .5, stamina: .5 })) };
    },
    tick(s) { s.prospects.forEach((p, i) => { if (s.t < s.show) s.shown[i] = { pace: clamp(p.pace + gauss() * s.noise, 0, 1), stamina: clamp(p.stamina + gauss() * s.noise, 0, 1) }; }); },
    click(s, p) {
      if (s.t < s.show) return;
      for (let i = 0; i < 4; i++) if (u_hit(p, 14 + i * 94, 66, 86, 170)) {
        const order = s.total.map((v, j) => [v, j]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
        return [1, .5, .15, 0][order.indexOf(i)];
      }
    },
    end() { return 0; },
    draw(g, s, u) {
      s.prospects.forEach((p, i) => {
        const x = 14 + i * 94, sh = s.shown[i];
        u.rect(x, 66, 86, 170, '#1d2c40', 10); u.text('ABCD'[i], x + 43, 82, 14);
        [['pace', sh.pace, '#5cbdff'], ['stamina', sh.stamina, '#ffb347']].forEach(([k, v, c], j) => {
          u.rect(x + 12 + j * 34, 100, 18, 100, '#26364a', 4); u.rect(x + 12 + j * 34, 200 - 100 * v, 18, 100 * v, c, 4);
          u.text(u.tr(k === 'pace' ? 'ap_stg_pace' : 'ap_stg_stamina'), x + 21 + j * 34, 214, 8, '#bdcce0');
        });
      });
      u.text(u.tr(s.t < s.show ? 'ap_stg_watch' : 'ap_stg_scout_hint'), 200, 262, 12, '#9fb2cc');
    },
  };
}

// Manager: the sponsor has a hidden budget; ask for as much as you dare, but not more than they have.
function manager() {
  return {
    limit: 9,
    init(d) { const budget = rnd(45, 100); return { budget, ask: 50, hint: budget + gauss() * 12 * (1 + .7 * d), wait: 1.6 }; },
    click(s, p) {
      if (s.t < s.wait) return;
      if (u_hit(p, 290, 150, 90, 40)) {
        if (s.ask <= s.budget) return s.ask / s.budget;
        return Math.max(0, 1 - (s.ask - s.budget) / (.22 * s.budget)) * .45;
      }
      if (u_hit(p, 20, 120, 360, 26)) s.ask = clamp(Math.round((p.x - 20) / 360 * 100), 1, 100);
    },
    end() { return 0; },
    draw(g, s, u) {
      u.text(u.tr('ap_stg_budget_hint'), 200, 74, 12, '#bdcce0');
      u.rect(20, 86, 360, 8, '#26364a', 4); u.circle(20 + 360 * clamp(s.hint, 0, 100) / 100, 90, 9, '#f2c230');
      u.rect(20, 120, 360, 26, '#26364a', 6); u.rect(20, 120, 360 * s.ask / 100, 26, '#3a77c9', 6);
      u.text(u.tr('ap_stg_ask') + ': ' + s.ask, 120, 168, 14);
      u.button(290, 150, 90, 40, u.tr('ap_stg_ok'));
      u.text(u.tr(s.t < s.wait ? 'ap_stg_analysing' : 'ap_stg_neg_hint'), 200, 250, 12, '#9fb2cc');
    },
  };
}
