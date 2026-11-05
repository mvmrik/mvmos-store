// Racelandia - the pilot's training games: one small game for each skill.
//
// None of them is the real car on a real circuit. Each one measures a single number and
// hands the raw numbers to the garage; the server compares them with the reference of the
// pilot's current skill and decides how much the skill moves (pilot_games.py).
//
// run(skill, box, tr, done, { difficulty }) -> { destroy() }
import { run as runLegacy, stage, loop, text, panel, beep, clamp } from './train.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const keysOf = () => {
  const k = {};
  const dn = e => { k[e.code] = true; }, up = e => { k[e.code] = false; };
  window.addEventListener('keydown', dn); window.addEventListener('keyup', up);
  return { k, off() { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); } };
};
const axis = k => (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);

// ── reflexes: a ball falls down the middle, hit it exactly on the centre line ────────────────────────
function reflexes(box, tr, done, d) {
  const S = stage(box, 1.0), { g, W, H } = S;
  const N = 8, R = 26 / (1 + .5 * d), V = 230 * (1 + .8 * d);
  let n = 0, ball = null, wait = .8, errors = [], note = '', noteT = 0, finished = false;
  const spawn = () => { ball = { x: W / 2, y: -R, hit: false }; };
  function hitAt() {
    if (!ball || ball.hit || finished) return;
    const err = Math.min(50, Math.abs(H / 2 - ball.y) / R);
    ball.hit = true; errors.push(Math.round(err * 1000) / 1000);
    const pct = err <= 1 ? Math.round(100 - 99 * err) : -Math.round(Math.min(100, 20 + 80 * (err - 1)));
    note = (pct > 0 ? '+' : '') + pct + '%'; noteT = 1; beep(pct > 0 ? 400 + pct * 3 : 180, .08, .05);
  }
  const press = () => hitAt();
  const key = e => { if (e.code !== 'Space') return; e.preventDefault(); if (!e.repeat) hitAt(); };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    noteT = Math.max(0, noteT - dt);
    if (!ball) { wait -= dt; if (wait <= 0 && n < N) { n++; spawn(); } }
    else {
      ball.y += V * dt;
      if (ball.y > H + R) { if (!ball.hit) { errors.push(50); note = '−100%'; noteT = 1; } ball = null; wait = .7; if (errors.length >= N && !finished) { finished = true; done({ errors }); } }
    }
    S.scale(); panel(g, W, H);
    g.strokeStyle = '#26324a'; g.lineWidth = 1; for (let y = 40; y < H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.strokeStyle = '#ffffff55'; g.lineWidth = 2; g.setLineDash([8, 6]); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);
    if (ball) { g.fillStyle = ball.hit ? '#7bf0a8' : '#ffd166'; g.beginPath(); g.arc(ball.x, ball.y, R, 0, 7); g.fill(); g.strokeStyle = '#0008'; g.lineWidth = 2; g.stroke(); }

    text(g, Math.min(n, N) + ' / ' + N, 40, 22, 16, '#e8ecf4');
    if (noteT) text(g, note, W / 2, 60, 30, note.startsWith('+') ? '#7bf0a8' : '#ff8a5e');
    text(g, tr('ap_tg_rf_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); S.c.removeEventListener('pointerdown', press); window.removeEventListener('keydown', key); } };
}

// ── pace: catch the falling balls, the grip meter shows how it goes ──────────
function pace(box, tr, done, d) {
  const S = stage(box, 1.18), { g, W, H } = S;
  const TOTAL = 24, HALF = 44 / (1 + .35 * d), SPEED = 1 + 1.1 * d;
  let bx = W / 2, balls = [], spawned = 0, resolved = 0, caught = 0, timer = .6, grip = 100, finished = false;
  const move = e => { bx = clamp(S.pt(e).x, 28, W - 28); };
  S.c.addEventListener('pointermove', move); S.c.addEventListener('pointerdown', move);
  const K = keysOf();
  const stop = loop(dt => {
    const dir = axis(K.k); if (dir) bx = clamp(bx + dir * 360 * dt, 28, W - 28);
    timer -= dt;
    if (timer <= 0 && spawned < TOTAL) { spawned++; timer = .9; balls.push({ x: rnd(24, W - 24), y: -10, v: (150 + spawned * 3 + rnd(0, 55)) * SPEED }); }
    for (const b of balls) {
      b.y += b.v * dt;
      if (!b.done && b.y >= H - 54) {
        b.done = true; resolved++;
        if (Math.abs(b.x - bx) < HALF) { caught++; b.hit = true; grip = Math.min(100, grip + 10); beep(520 + caught * 6, .08, .04); }
        else { grip = Math.max(0, grip - 10); beep(170, .12, .05); }
      }
    }
    balls = balls.filter(b => b.y < H + 20);
    if (resolved >= TOTAL && !finished) { finished = true; done({ caught, total: TOTAL }); }
    S.scale(); panel(g, W, H);
    for (const b of balls) { g.fillStyle = b.hit ? '#7bf0a8' : b.done ? '#ff6b5e' : '#ffd166'; g.beginPath(); g.arc(b.x, b.y, 11, 0, 7); g.fill(); g.strokeStyle = '#0006'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = '#4da3ff'; g.fillRect(bx - HALF, H - 46, HALF * 2, 12); g.fillStyle = '#2c6fbb'; g.fillRect(bx - HALF - 6, H - 40, HALF * 2 + 12, 8);
    g.fillStyle = '#1b2434'; g.fillRect(W - 120, 12, 100, 10); g.fillStyle = grip > 60 ? '#7bf0a8' : grip > 30 ? '#ffd166' : '#ff6b5e'; g.fillRect(W - 120, 12, grip, 10);
    text(g, tr('ap_tg_grip') + ' ' + grip + '%', W - 70, 36, 12, '#aab4c8'); text(g, resolved + ' / ' + TOTAL, 44, 22, 16, '#e8ecf4');
    text(g, tr('ap_tg_catch_hint'), W / 2, 22, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); K.off(); } };
}

// ── cornering: stay on the road through six bends, a little faster each time ─
// The camera stays on the road's straight reference, so the road never swings across the
// screen: it bulges to one side and back, and the car sits in the middle of the view. Every
// click turns the wheel one notch, which sets the car's heading; the road's heading changes
// through the bend, so you turn in, follow it, and turn back out.
function cornering(box, tr, done, d = 0) {
  const S = stage(box, 1.15), { g, W, H } = S;
  const HALFW = 6 / (1 + .3 * d), AHEAD = 150, PX = 6, STEER = 1.2, STEP = .1;
  const bends = [[40, 1], [130, -1], [220, 1], [310, -1], [400, 1], [490, -1]].map(([s, dir], i) => ({ s, dir, len: 80, amp: 6 + (i % 3) }));
  const END = 600;
  // lateral position of the road centre and its heading (the slope) along the distance s
  const bend = s => { for (const b of bends) { if (s >= b.s && s < b.s + b.len) return { b, u: (s - b.s) / b.len }; } return null; };
  const lat = s => { let x = 0; for (const b of bends) { const u = clamp((s - b.s) / b.len, 0, 1); x += b.dir * b.amp * (1 - Math.cos(2 * Math.PI * u)) / 2; } return x; };
  const head = s => { const k = bend(s); return k ? k.b.dir * k.b.amp * Math.PI / k.b.len * Math.sin(2 * Math.PI * k.u) : 0; };
  let s = 0, e = 0, psi = 0, want = 0, sum = 0, time = 0, finished = false;
  // every click or key press turns the wheel one notch and it stays there until you turn it back
  const nudge = dir => { want = clamp(Math.round((want + dir * STEP) * 100) / 100, -1, 1); };
  const press = ev => { nudge(S.pt(ev).x < W / 2 ? -1 : 1); };
  const key = ev => {
    const dir = ev.code === 'ArrowLeft' || ev.code === 'KeyA' ? -1 : ev.code === 'ArrowRight' || ev.code === 'KeyD' ? 1 : 0;
    if (!dir) return; ev.preventDefault(); if (!ev.repeat) nudge(dir);
  };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    if (!finished) {
      const v = (20 + 10 * Math.min(1, s / END)) * (1 + .45 * d);
      psi += (want * STEER - psi) * Math.min(1, dt / .14);
      e = clamp(e + v * (psi - head(s)) * dt, -4 * HALFW, 4 * HALFW); s += v * dt; time += dt;
      sum += Math.min(2, Math.abs(e) / HALFW) * dt;
      if (s >= END) { finished = true; done({ error: sum / time }); }
    }
    S.scale(); panel(g, W, H);
    // the road ahead, relative to the car
    const line = []; for (let a = 0; a <= AHEAD; a += 4) line.push([lat(s + a) - lat(s) - e, a]);
    const toX = v => W / 2 + v * PX, toY = a => H - 70 - a * 1.9;
    g.fillStyle = '#2a2f3a'; g.beginPath();
    line.forEach(([px, a], i) => { const X = toX(px - HALFW), Y = toY(a); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    for (let i = line.length - 1; i >= 0; i--) g.lineTo(toX(line[i][0] + HALFW), toY(line[i][1]));
    g.closePath(); g.fill();
    g.strokeStyle = '#4ce0a0'; g.lineWidth = 2; g.setLineDash([8, 8]); g.beginPath(); line.forEach(([px, a], i) => { const X = toX(px), Y = toY(a); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(W / 2, H - 70); g.rotate(psi); g.fillStyle = '#ff5a4d'; g.fillRect(-9, -16, 18, 32); g.fillStyle = '#fff'; g.fillRect(-4, -8, 8, 8); g.restore();
    g.fillStyle = '#1b2434'; g.fillRect(20, 14, W - 40, 8); g.fillStyle = '#4da3ff'; g.fillRect(20, 14, (W - 40) * Math.min(1, s / END), 8);
    // the wheel: the notch you have dialled in, left or right of centre
    const WX = W / 2, WY = H - 34, WW = Math.min(180, W / 2 - 30);
    g.fillStyle = '#1b2434'; g.fillRect(WX - WW, WY - 5, WW * 2, 10);
    g.fillStyle = '#8a95ab'; g.fillRect(WX - 1, WY - 9, 2, 18);
    g.fillStyle = '#4da3ff'; g.fillRect(Math.min(WX, WX + want * WW), WY - 5, Math.abs(want) * WW, 10);
    g.fillStyle = '#e8ecf4'; g.beginPath(); g.arc(WX + want * WW, WY, 7, 0, 7); g.fill();
    text(g, tr('ap_tg_corner_hint'), W / 2, H - 12, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); S.c.removeEventListener('pointerdown', press); window.removeEventListener('keydown', key); } };
}

// ── traction: hold the pedal where the green band is ─────────────────────────
function traction(box, tr, done, d = 0) {
  const S = stage(box, 1.0), { g, W, H } = S;
  const DUR = 20, ph = [rnd(0, 6), rnd(0, 6)], BAND = .12 / (1 + .6 * d), FQ = 1 + .5 * d;
  let t = 0, level = .1, hold = false, sum = 0, finished = false;
  const dn = () => { hold = true; }, up = () => { hold = false; };
  S.c.addEventListener('pointerdown', dn); window.addEventListener('pointerup', up);
  const kd = e => { if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); hold = true; } }, ku = e => { if (e.code === 'Space' || e.code === 'ArrowUp') hold = false; };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  const target = x => .5 + .3 * Math.sin(.6 * FQ * x + ph[0]) + .1 * Math.sin(1.8 * FQ * x + ph[1]);
  const stop = loop(dt => {
    t += dt;
    level = clamp(level + (hold ? .95 : -1.15) * dt, 0, 1);
    const tg = target(t); sum += Math.abs(level - tg) * dt;
    S.scale(); panel(g, W, H);
    const bx = W / 2 - 40, bw = 80, top = 40, hgt = H - 80;
    g.fillStyle = '#0a0e15'; g.fillRect(bx, top, bw, hgt); g.strokeStyle = '#2b3447'; g.strokeRect(bx, top, bw, hgt);
    // what is coming: the target a moment ahead, drawn as a faint trail beside the pedal
    g.strokeStyle = 'rgba(80,200,140,.35)'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 30; i++) { const y = top + (1 - target(t + i * .1)) * hgt, x = bx + bw + 14 + i * 5; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = 'rgba(80,200,140,.3)'; g.fillRect(bx - 8, top + (1 - tg - BAND / 2) * hgt, bw + 16, BAND * hgt);
    g.strokeStyle = '#4ce0a0'; g.strokeRect(bx - 8, top + (1 - tg - BAND / 2) * hgt, bw + 16, BAND * hgt);
    g.fillStyle = Math.abs(level - tg) < BAND / 2 ? '#7bf0a8' : '#ff8a5e'; g.fillRect(bx + 6, top + (1 - level) * hgt - 4, bw - 12, 8);
    g.fillStyle = '#4da3ff'; g.fillRect(bx + 6, top + (1 - level) * hgt, bw - 12, level * hgt);
    g.fillStyle = '#1b2434'; g.fillRect(20, 14, W - 40, 8); g.fillStyle = '#4da3ff'; g.fillRect(20, 14, (W - 40) * Math.min(1, t / DUR), 8);
    text(g, tr('ap_tg_throttle_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
    if (t >= DUR && !finished) { finished = true; done({ error: sum / DUR }); }
  });
  return { destroy() { stop(); S.c.removeEventListener('pointerdown', dn); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); } };
}

// ── consistency: stop the clock on a random target time, ten tries, the best one counts ──────────────────
function consistency(box, tr, done, d = 0) {
  const S = stage(box, .7), { g, W, H } = S;
  const GOAL = Math.round(rnd(1500, 3000) / 100) * 100, N = 10;   // one random target for the whole game
  let state = 'idle', started = 0, stops = [], msg = '', hold = 0, shownAt = 0, finished = false;
  function press() {
    if (finished) return;
    const now = performance.now();
    if (state === 'idle') { state = 'run'; started = now; msg = ''; beep(500, .05, .04); }
    else if (state === 'run') {
      const ms = Math.round(now - started); stops.push(ms); state = 'show'; hold = now + 1100;
      const dev = ms - GOAL; msg = (dev > 0 ? '+' : '−') + Math.abs(dev) + ' ms'; beep(Math.abs(dev) < 40 ? 700 : 300, .08, .05);
    }
  }
  const key = e => { if (!e.repeat && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); press(); } };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(() => {
    const now = performance.now();
    if (state === 'show' && now >= hold) { if (stops.length >= N) { if (!finished) { finished = true; done({ stops, goal: GOAL }); } } else state = 'idle'; }
    const el = state === 'run' ? now - started : 0;
    S.scale(); panel(g, W, H);
    text(g, tr('ap_tg_cons_goal', { n: (GOAL / 1000).toFixed(1) }), W / 2, 42, 22, '#e8ecf4');
    text(g, Math.min(stops.length + (state === 'idle' ? 1 : 0), N) + ' / ' + N, W / 2, 76, 14, '#aab4c8');
    // the bar is visible only at the beginning of each try; after that the player has to feel the time
    g.fillStyle = '#1b2434'; g.fillRect(40, 120, W - 80, 16);
    if (state === 'run') { const vis = el < 450 / (1 + 1.5 * d) ? 1 : 0; g.fillStyle = `rgba(77,163,255,${vis})`; g.fillRect(40, 120, (W - 80) * Math.min(1, el / GOAL), 16); if (!vis) text(g, '…', W / 2, 128, 22, '#8a95ab'); }
    g.fillStyle = '#ffd166'; g.fillRect(40 + (W - 80) - 2, 112, 4, 32);
    text(g, msg, W / 2, 185, 34, Math.abs(parseInt(msg.replace('−', '-')) || 999) < 40 ? '#7bf0a8' : '#ffb27a');
    text(g, tr(state === 'idle' ? 'ap_tg_cons_start' : state === 'run' ? 'ap_tg_cons_stop' : 'ap_tg_cons_wait'), W / 2, H - 22, 14, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// ── focus: follow the moving zone while signals demand attention ─────────────
function focus(box, tr, done, d = 0) {
  const S = stage(box, .75), { g, W, H } = S;
  const DUR = 22, ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6)], BAND = 90 / (1 + .5 * d), FQ = 1 + .5 * d, WIN = 1.4 / (1 + .4 * d);
  const flashes = [3, 7, 11.5, 15.5, 19].map(x => x + rnd(-.8, .8));
  if (d > .5) flashes.push(5, 9.5, 13.5, 17.5, 21);
  flashes.sort((a, b) => a - b);
  let t = 0, x = W / 2, sum = 0, fi = 0, active = null, missed = 0, hits = 0, finished = false, note = '', noteT = 0;
  const K = keysOf();
  // the marker moves with the keys or while the left or right side is held, so the pointer never has to leave the screen sides to answer a signal
  let hold = 0;
  function tap() { if (active) { hits++; active = null; note = '✓'; noteT = .6; beep(620, .06, .04); } }
  const onDown = e => { const p = S.pt(e); if (p.y < 90) tap(); else hold = p.x < W / 2 ? -1 : 1; };
  const onUp = () => { hold = 0; };
  S.c.addEventListener('pointerdown', onDown); window.addEventListener('pointerup', onUp);
  const sp = e => { if (e.code === 'Space') { e.preventDefault(); tap(); } };
  window.addEventListener('keydown', sp);
  const target = tt => 200 + 120 * Math.sin(.55 * FQ * tt + ph[0]) + 55 * Math.sin(1.45 * FQ * tt + ph[1]) + 25 * Math.sin(2.7 * FQ * tt + ph[2]);
  const stop = loop(dt => {
    t += dt; noteT = Math.max(0, noteT - dt);
    const dir = axis(K.k) || hold; if (dir) x = clamp(x + dir * 300 * dt, 20, W - 20);
    const tg = target(t); sum += Math.min(1, Math.abs(x - tg) / 200) * dt;
    if (fi < flashes.length && t >= flashes[fi]) { active = { until: t + WIN }; fi++; }
    if (active && t > active.until) { active = null; missed++; note = '✗'; noteT = .6; beep(170, .12, .05); }
    S.scale(); panel(g, W, H);
    g.fillStyle = 'rgba(80,200,140,0.25)'; g.fillRect(tg - BAND / 2, 100, BAND, H - 140); g.strokeStyle = '#4ce0a0'; g.lineWidth = 2; g.strokeRect(tg - BAND / 2, 100, BAND, H - 140);
    g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(x, H - 36); g.lineTo(x - 14, H - 8); g.lineTo(x + 14, H - 8); g.fill();
    g.fillStyle = '#ffd16655'; g.fillRect(x - 2, 100, 4, H - 140);
    if (active) { g.fillStyle = '#ff9f1c'; g.beginPath(); g.arc(W / 2, 54, 28, 0, 7); g.fill(); text(g, '!', W / 2, 55, 32, '#1b1100', 'center', '900'); }
    else { g.fillStyle = '#2a3140'; g.beginPath(); g.arc(W / 2, 54, 28, 0, 7); g.fill(); }
    if (noteT) text(g, note, W / 2 + 60, 54, 26, note === '✓' ? '#7bf0a8' : '#ff8a5e');
    g.fillStyle = '#1b2434'; g.fillRect(20, 12, W - 40, 6); g.fillStyle = '#4da3ff'; g.fillRect(20, 12, (W - 40) * Math.min(1, t / DUR), 6);
    text(g, tr('ap_tg_focus_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
    if (t >= DUR && !finished) { finished = true; done({ error: sum / DUR + .04 * missed }); }
  });
  return { destroy() { stop(); K.off(); S.c.removeEventListener('pointerdown', onDown); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', sp); } };
}

// ── composure: the car steps out, counter-steer and settle it ────────────────
function composure(box, tr, done, d = 0) {
  const S = stage(box, .85), { g, W, H } = S;
  const N = 6, LIMIT = 3;
  let th = 0, om = 0, ptr = 0, wait = 1.4, evT = -1, calm = 0, times = [], note = '', noteT = 0, finished = false;
  const K = keysOf();
  // steer by holding the side the nose should turn towards: ← → or the left or right half of the screen
  const down = e => { ptr = S.pt(e).x < W / 2 ? -1 : 1; }, up = () => { ptr = 0; };
  S.c.addEventListener('pointerdown', down); window.addEventListener('pointerup', up);
  const stop = loop(dt => {
    const u = axis(K.k) || ptr;
    om += (150 * u + 1.6 * th - 2.2 * om) * dt; th += om * dt;
    noteT = Math.max(0, noteT - dt);
    if (evT < 0) {
      wait -= dt;
      if (wait <= 0 && times.length < N) { evT = 0; calm = 0; om += (Math.random() < .5 ? -1 : 1) * rnd(55, 95) * (1 + .5 * d); }
    } else {
      evT += dt;
      if (Math.abs(th) < 6 / (1 + .4 * d) && Math.abs(om) < 14 / (1 + .4 * d)) calm += dt; else calm = 0;
      if (calm >= .35 || evT >= LIMIT) {
        const took = calm >= .35 ? Math.max(.2, evT - calm) : LIMIT;
        times.push(Math.round(took * 100) / 100); note = took >= LIMIT ? '✗' : took.toFixed(2) + ' s'; noteT = 1.1; evT = -1; wait = rnd(1.2, 2.2);
        beep(took < 1.5 ? 650 : 250, .08, .05);
        if (times.length >= N && !finished) { finished = true; done({ times }); }
      }
    }
    th = clamp(th, -75, 75);
    S.scale(); panel(g, W, H);
    g.fillStyle = '#2a2f3a'; g.fillRect(W / 2 - 70, 0, 140, H);
    g.strokeStyle = '#cfd5df'; g.setLineDash([16, 16]); g.lineDashOffset = -performance.now() / 12; g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(W / 2, H * .55); g.rotate(th * Math.PI / 180); g.fillStyle = evT >= 0 ? '#ff8a5e' : '#ff5a4d'; g.fillRect(-14, -30, 28, 60); g.fillStyle = '#fff'; g.fillRect(-6, -14, 12, 14); g.restore();
    text(g, times.length + ' / ' + N, 40, 22, 16, '#e8ecf4');
    if (noteT) text(g, note, W / 2, 50, 30, note === '✗' ? '#ff8a5e' : '#7bf0a8');
    text(g, tr('ap_tg_slide_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); K.off(); S.c.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); } };
}

// ── tyre care: keep the tyre temperature in the window ───────────────────────
function tyreCare(box, tr, done, d = 0) {
  const S = stage(box, 1.0), { g, W, H } = S;
  const DUR = 22, LOW = 60, HIGH = 130, C = 95, HALF = 4 / (1 + .5 * d), ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6)];
  let t = 0, T = C + rnd(-8, 8), dir = 0, sum = 0, finished = false;
  const K = keysOf();
  const zone = e => { const p = S.pt(e); dir = p.y < H / 2 ? 1 : -1; };
  const rel = () => { dir = 0; };
  S.c.addEventListener('pointerdown', zone); window.addEventListener('pointerup', rel);
  const stop = loop(dt => {
    t += dt;
    const key = (K.k.ArrowUp || K.k.KeyW ? 1 : 0) - (K.k.ArrowDown || K.k.KeyS ? 1 : 0), u = key || dir;
    const drift = 1.6 * (1 + .6 * d) * (7 * Math.sin(.7 * t + ph[0]) + 5 * Math.sin(1.9 * t + ph[1]) + 3 * Math.sin(3.3 * t + ph[2]));
    T = clamp(T + (drift + u * 18) * dt, LOW, HIGH);
    sum += Math.min(1.5, Math.max(0, Math.abs(T - C) - HALF) / HALF) * dt;
    S.scale(); panel(g, W, H);
    const gx = W / 2 - 34, gw = 68, top = 36, hgt = H - 86, yOf = v => top + (1 - (v - LOW) / (HIGH - LOW)) * hgt;
    g.fillStyle = '#0a0e15'; g.fillRect(gx, top, gw, hgt); g.strokeStyle = '#2b3447'; g.strokeRect(gx, top, gw, hgt);
    g.fillStyle = 'rgba(80,200,140,.28)'; g.fillRect(gx - 10, yOf(C + HALF), gw + 20, yOf(C - HALF) - yOf(C + HALF)); g.strokeStyle = '#4ce0a0'; g.strokeRect(gx - 10, yOf(C + HALF), gw + 20, yOf(C - HALF) - yOf(C + HALF));
    const hot = T > C + HALF, cold = T < C - HALF;
    g.fillStyle = hot ? '#ff6b5e' : cold ? '#4da3ff' : '#7bf0a8'; g.fillRect(gx + 4, yOf(T), gw - 8, top + hgt - yOf(T));
    text(g, Math.round(T) + '°C', W / 2, yOf(T) - 12, 18, '#e8ecf4');
    text(g, '▲', 52, top + 28, 40, K.k.ArrowUp ? '#ffd166' : '#6b7790'); text(g, '▼', 52, top + hgt - 28, 40, K.k.ArrowDown ? '#ffd166' : '#6b7790');
    text(g, '▲', W - 52, top + 28, 40, '#6b7790'); text(g, '▼', W - 52, top + hgt - 28, 40, '#6b7790');
    g.fillStyle = '#1b2434'; g.fillRect(20, 14, W - 40, 8); g.fillStyle = '#4da3ff'; g.fillRect(20, 14, (W - 40) * Math.min(1, t / DUR), 8);
    text(g, tr('ap_tg_tyre_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
    if (t >= DUR && !finished) { finished = true; done({ error: sum / DUR }); }
  });
  return { destroy() { stop(); K.off(); S.c.removeEventListener('pointerdown', zone); window.removeEventListener('pointerup', rel); } };
}

// ── wet: five practice stops, the sixth counts ───────────────────────────────
function wet(box, tr, done, d = 0) {
  const S = stage(box, .62), { g, W, H } = S;
  const V = 60 * (1 + .25 * d), D0 = 560, TS = 2, MPX = .56, CARX = 60;
  const rains = [6, 28, 14, 36, 20, Math.round(24 + 22 * Math.min(1, d))];                     // the last, decisive run is in the middle of what was practised
  const decel = rain => 10 / (1 + .03 * rain);
  let k = 0, phase = 'run', pos = 0, vel = V, braking = false, errors = [], msg = '', hold = 0, finished = false;
  const end = () => { const stopAt = pos; return Math.round((stopAt - D0) * 10) / 10; };
  function press() { if (phase === 'run' && !braking) braking = true; }
  const key = e => { if (!e.repeat && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); press(); } };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    dt *= TS;
    if (phase === 'run') {
      if (braking) vel = Math.max(0, vel - decel(rains[k]) * dt);
      pos += vel * dt;
      if (braking && vel <= 0 || pos > D0 + 60) {
        const err = braking ? end() : 400; errors.push(err);
        msg = !braking ? tr('ap_tg_brake_late') : err > 0 ? tr('ap_tg_wet_long', { n: err.toFixed(1) }) : tr('ap_tg_wet_short', { n: Math.abs(err).toFixed(1) });
        phase = 'show'; hold = 1.8 * TS; beep(Math.abs(err) < 8 ? 700 : 300, .1);
      }
    } else {
      hold -= dt;
      if (hold <= 0) {
        k++; if (k >= rains.length) { if (!finished) { finished = true; done({ errors, rains }); } return; }
        phase = 'run'; pos = 0; vel = V; braking = false; msg = '';
      }
    }
    const kk = Math.min(k, rains.length - 1), rain = rains[kk];
    S.scale(); panel(g, W, H);
    const roadY = 150, gap = D0 - pos, boardX = CARX + 50 + gap * MPX;
    g.fillStyle = '#2a2f3a'; g.fillRect(0, roadY - 34, W, 68);
    for (let i = -2; i < 20; i++) { const x = ((i * 40 - (pos * MPX) % 40) + 400) % 440 - 20; g.fillStyle = '#cfd5df'; g.fillRect(x, roadY - 2, 20, 4); }
    for (let m = 100; m <= 500; m += 100) { const x = boardX + m * MPX; if (x < W + 10) { g.fillStyle = '#6b7790'; g.fillRect(x - 1, roadY + 36, 2, 10); text(g, m + '', x, roadY + 56, 10, '#6b7790', 'center', '500'); } }
    g.fillStyle = '#e8c547'; g.fillRect(boardX - 3, roadY - 70, 6, 36); g.fillStyle = '#fff'; g.fillRect(boardX - 20, roadY - 90, 40, 24); text(g, 'STOP', boardX, roadY - 78, 10, '#111', 'center', '800');
    g.fillStyle = '#ff5a4d'; g.fillRect(CARX, roadY - 11, 46, 22); g.fillStyle = '#fff'; g.fillRect(CARX + 30, roadY - 5, 10, 10);
    g.strokeStyle = 'rgba(160,200,255,.55)'; g.lineWidth = 1; const drops = Math.round(rain * 2.2); for (let i = 0; i < drops; i++) { const x = (i * 53.7 + performance.now() * .35) % W, y = (i * 97.3 + performance.now() * .9) % H; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 3, y + 9); g.stroke(); }
    text(g, tr('ap_tg_wet_rain', { n: rain }), 80, 22, 16, '#bcd7ff');
    text(g, k < 5 ? tr('ap_tg_wet_practice', { n: k + 1 }) : tr('ap_tg_wet_final'), W - 90, 22, 14, k < 5 ? '#aab4c8' : '#ffd166');
    text(g, msg, W / 2, 232, 26, '#e8ecf4');
    text(g, tr('ap_tg_wet_hint'), W / 2, 262, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// ── feedback: find the right setup from short runs; the ranges close in ──────
function feedback(box, tr, done, d = 0) {
  const names = ['frontWing', 'rearWing', 'rideF', 'brakeBias'], ROUNDS = Math.max(3, 6 - Math.round(2 * Math.min(d, 1.5))), TOL = 2 / (1 + d);
  const target = names.map(() => Math.round(rnd(20 - 10 * Math.min(d, 1), 80 + 10 * Math.min(d, 1))));
  let round = 0, val = names.map(() => 50), last = null, finished = false;
  const tried = names.map(() => []);                             // every earlier choice with the arrow it got, so you know where you have been
  box.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'ap-fb';
  box.appendChild(wrap);
  function paint() {
    wrap.innerHTML = `<div class="ap-fb-top"><b>${tr('ap_tg_fb_round', { n: Math.min(round + 1, ROUNDS), m: ROUNDS })}</b><span>${last ? tr('ap_tg_fb_lap', { n: last.lap.toFixed(2) }) : ''}</span></div>
      ${names.map((k, i) => `<div class="ap-fb-item"><div class="ap-fb-row"><span>${tr('ap_s_' + k)}</span><button type="button" class="ap-nudge" data-d="-1" aria-label="−">−</button><input type="range" min="0" max="100" step="1" value="${val[i]}" data-i="${i}"><button type="button" class="ap-nudge" data-d="1" aria-label="+">+</button><output>${val[i]}</output></div>
        <div class="ap-fb-tried">${tried[i].map(x => `<i class="${x.h === '✓' ? 'ok' : ''}">${x.v} ${x.h}</i>`).join('')}</div></div>`).join('')}
      <button class="ap-btn" data-run>${tr('ap_tg_fb_run')}</button><p class="ap-hint">${tr('ap_tg_fb_hint')}</p>`;
    wrap.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => { val[+r.dataset.i] = +r.value; r.parentNode.querySelector('output').textContent = r.value; }));
    wrap.querySelectorAll('.ap-nudge').forEach(b => b.addEventListener('click', () => { const r = b.parentNode.querySelector('input'); r.value = clamp(+r.value + +b.dataset.d, 0, 100); r.dispatchEvent(new Event('input')); }));
    wrap.querySelector('[data-run]').onclick = run;
  }
  function run() {
    if (finished) return;
    const err = val.map((v, i) => v - target[i]);                // positive: too much
    const hint = err.map(e => Math.abs(e) < TOL ? '✓' : e > 0 ? '▼' : '▲');
    const lap = 88 + .02 * Math.sqrt(err.reduce((a, e) => a + e * e, 0));
    last = { hint, lap };
    val.forEach((v, i) => tried[i].push({ v, h: hint[i] }));
    round++;
    if (round >= ROUNDS) {
      finished = true;
      const mean = err.reduce((a, e) => a + Math.abs(e), 0) / err.length / 100;
      paint();
      wrap.querySelectorAll('input,button').forEach(x => { x.disabled = true; });
      done({ error: mean });
      return;
    }
    paint();
  }
  paint();
  return { destroy() { wrap.remove(); } };
}

const OWN = { reflexes, pace, cornering, traction, consistency, focus, composure, tyreCare, wet, feedback };
const LEGACY = { reaction: 'lights', braking: 'brake', fitness: 'endurance' };

export function run(skill, box, tr, done, opts = {}) {
  const d = Math.max(0, Number.isFinite(opts.difficulty) ? opts.difficulty : 0);
  if (LEGACY[skill]) return runLegacy(LEGACY[skill], box, tr, done, { difficulty: 0 });
  const make = OWN[skill];
  if (!make) { done({}); return { destroy() {} }; }
  return make(box, tr, done, d);
}
