// Racelandia - manual training simulators.
//
// Each one is a short game played with the mouse, the finger or the keyboard.
// It measures raw numbers (reaction times, hits, distances) and hands them to
// the garage, which sends them to the server; the server alone scores them and
// decides how much the driver learns. The texts come from the caller: this
// file has none of its own.
//
// run(game, box, tr, done, { difficulty }) -> { destroy() }
//   tr(key) translates; done(result) is called once with the raw numbers.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// The server snapshots difficulty at session start and scores that same level.
// Input speed stays responsive; challenge comes from the exercise itself.
export function trainingSettings(difficulty = 0) {
  const d=Math.max(0,Number.isFinite(difficulty) ? difficulty : 0), q=d*(1+d)/2;
  return {
    difficulty:d, lightInterval:850/(1+.7*q), lightDeadline:1800/(1+5*q),
    catchSpeed:.65+3.4*q, catchInterval:1.2/(1+3*q), basketHalf:48/(1+2.5*q),
    followSpeed:.6+2.8*q, trackingWidth:120/(1+4*q), throttleWidth:.46/(1+5*q),
    brakeSpeed:.65+1.8*q, rhythmGoal:Math.round(50+180*q), rhythmInterval:18/(50+180*q),
    pitRadius:46/(1+2*q), pitDeadline:34/(1+7*q),
  };
}

function stage(box, aspect) {
  box.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap-tg-wrap';
  const c = document.createElement('canvas');
  c.className = 'ap-tg-canvas';
  c.style.touchAction = 'none';
  wrap.appendChild(c); box.appendChild(wrap);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = 400, H = Math.round(400 * aspect);
  const fit = () => {
    const w = Math.min(wrap.clientWidth || 400, 560);
    c.style.width = w + 'px'; c.style.height = Math.round(w * aspect) + 'px';
    c.width = Math.round(w * dpr); c.height = Math.round(w * aspect * dpr);
  };
  fit();
  const g = c.getContext('2d');
  const scale = () => { g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0); };
  const pt = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }; };
  return { c, g, W, H, scale, pt, fit };
}

function loop(fn) {
  let raf = 0, last = performance.now(), dead = false;
  const f = now => { if (dead) return; raf = requestAnimationFrame(f); const dt = Math.min(0.05, (now - last) / 1000); last = now; fn(dt, now); };
  raf = requestAnimationFrame(f);
  return () => { dead = true; cancelAnimationFrame(raf); };
}

const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
function text(g, s, x, y, size, color, align, weight) {
  g.font = (weight || '600') + ' ' + size + 'px ' + FONT; g.fillStyle = color || '#e8ecf4'; g.textAlign = align || 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
function panel(g, W, H) {
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#10151f'); bg.addColorStop(1, '#1b2434');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
}

function beep(freq, dur, vol) {
  try {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return;
    beep.ac = beep.ac || new A();
    const o = beep.ac.createOscillator(), gn = beep.ac.createGain();
    o.frequency.value = freq; o.type = 'sine'; gn.gain.value = vol || 0.06;
    o.connect(gn); gn.connect(beep.ac.destination); o.start(); gn.gain.exponentialRampToValueAtTime(0.0001, beep.ac.currentTime + dur); o.stop(beep.ac.currentTime + dur);
  } catch (_) { /* audio is optional */ }
}

// 1 ── the start lights ───────────────────────────────────────────────────────
function lights(box, tr, done, cfg) {
  const S = stage(box, 0.62), { g, W, H } = S;
  let phase = 'ready', n = 0, lit = 0, outAt = 0, attempt = 0, t0 = performance.now(), msg = tr('ap_tg_lights_ready'), times = [], next = performance.now() + 1500, hold = 0, litAt = 0, finished = false;
  function begin() { phase = 'seq'; lit = 0; litAt = performance.now(); msg = ''; }
  function press() {
    const now = performance.now();
    if (phase === 'seq') { times.push(-1); msg = tr('ap_tg_jump'); phase = 'ready'; next = now + 1500; attempt++; lit = 0; beep(180, 0.25, 0.08); }
    else if (phase === 'go') { const ms = Math.round(now - outAt); times.push(ms); msg = ms + ' ms'; phase = 'ready'; next = now + 1500; attempt++; beep(660, 0.1); }
  }
  const key = e => { if (e.repeat) return; if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); press(); } };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(() => {
    const now = performance.now();
    if (phase === 'ready' && now >= next) {
      if (attempt >= 5) { if (!finished) { finished = true; done({ times }); } return; }
      begin(); hold = 450 + Math.random() * 2300;
    }
    if (phase === 'seq') {
      lit = Math.min(5, Math.floor((now - litAt) / cfg.lightInterval) + 1);
      if (lit === 5 && now - litAt >= cfg.lightInterval * 4 + hold) { phase = 'go'; outAt = now; lit = 0; }
    }
    if (phase === 'go' && now-outAt > cfg.lightDeadline) {
      times.push(-1); attempt++; phase='ready';next=now+1500;msg=tr('ap_tg_brake_late');
    }
    S.scale(); panel(g, W, S.H);
    text(g, tr('ap_tg_lights_title') + '  ' + Math.min(attempt + 1, 5) + '/5', W / 2, 30, 18, '#aab4c8');
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 70, y = 120;
      g.fillStyle = '#05070b'; g.beginPath(); g.arc(x, y, 30, 0, 7); g.fill();
      g.fillStyle = i < lit ? '#ff2a1f' : '#3a0d0d'; g.beginPath(); g.arc(x, y, 25, 0, 7); g.fill();
      if (i < lit) { g.fillStyle = 'rgba(255,60,40,0.25)'; g.beginPath(); g.arc(x, y, 38, 0, 7); g.fill(); }
    }
    text(g, msg, W / 2, 200, 32, phase === 'go' ? '#7bf0a8' : '#e8ecf4');
    text(g, phase === 'ready' && attempt < 5 && !msg ? tr('ap_tg_lights_ready') : tr('ap_tg_lights_hint'), W / 2, 232, 14, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// 2 ── catch the balls ───────────────────────────────────────────────────────
function catchBalls(box, tr, done, cfg) {
  const S = stage(box, 1.18), { g, W, H } = S;
  let bx = W / 2, vx = 0, balls = [], spawned = 0, caught = 0, resolved = 0, timer = 0.6, keys = {}, finished = false;
  const TOTAL = 28;
  const move = e => { bx = clamp(S.pt(e).x, 28, W - 28); };
  S.c.addEventListener('pointermove', move); S.c.addEventListener('pointerdown', move);
  const kd = e => { keys[e.code] = true; }, ku = e => { keys[e.code] = false; };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  const stop = loop(dt => {
    const dir = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    if (dir) bx = clamp(bx + dir * 340 * dt, 28, W - 28);
    timer -= dt;
    if (timer <= 0 && spawned < TOTAL) { spawned++; balls.push({ x: 20 + Math.random() * (W - 40), y: -10, v: (135 + spawned * 4 + Math.random() * 50) * cfg.catchSpeed, s: Math.random() < 0.5 ? 1 : 0 }); timer = Math.max(.025, cfg.catchInterval * (1-spawned*.008)); }
    for (const b of balls) {
      b.y += b.v * dt;
      if (!b.done && b.y >= H - 54) {
        b.done = true; resolved++;
        if (Math.abs(b.x - bx) < cfg.basketHalf) { caught++; b.hit = true; beep(520 + caught * 6, 0.08, 0.04); }
      }
    }
    balls = balls.filter(b => b.y < H + 20);
    if (resolved >= TOTAL && !finished) { finished = true; done({ caught, total: TOTAL }); }
    S.scale(); panel(g, W, H);
    for (const b of balls) { g.fillStyle = b.hit ? '#7bf0a8' : (b.s ? '#ff6b5e' : '#ffd166'); g.beginPath(); g.arc(b.x, b.y, 11, 0, 7); g.fill(); g.strokeStyle = '#0006'; g.lineWidth = 2; g.stroke(); }
    g.fillStyle = '#4da3ff'; g.fillRect(bx - cfg.basketHalf, H - 46, cfg.basketHalf*2, 12); g.fillStyle = '#2c6fbb'; g.fillRect(bx - cfg.basketHalf-6, H - 40, cfg.basketHalf*2+12, 8);
    text(g, caught + ' / ' + resolved, 54, 22, 18, '#e8ecf4', 'center'); text(g, tr('ap_tg_catch_hint'), W - 150, 22, 12, '#8a95ab', 'center', '500');
  });
  return { destroy() { stop(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); } };
}

// 3 + 4 ── keep the marker in the moving window (focus) / hold the pedal in the window (throttle)
function follow(kind) {
  return function (box, tr, done, cfg) {
    const S = stage(box, kind === 'tracking' ? 0.55 : 1.0), { g, W, H } = S;
    const DUR = 25, ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    let t = 0, inside = 0, time = 0, x = W / 2, level = 0.1, hold = false, keys = {}, finished = false;
    const move = e => { if (kind === 'tracking') x = clamp(S.pt(e).x, 20, W - 20); };
    const dn = e => { if (kind === 'throttle') hold = true; else move(e); };
    const up = () => { hold = false; };
    S.c.addEventListener('pointermove', move); S.c.addEventListener('pointerdown', dn); window.addEventListener('pointerup', up);
    const kd = e => { keys[e.code] = true; if (e.code === 'Space') { e.preventDefault(); hold = true; } };
    const ku = e => { keys[e.code] = false; if (e.code === 'Space') hold = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    const stop = loop(dt => {
      t += dt;
      let target, wid;
      const phaseTime=t*cfg.followSpeed;
      if (kind === 'tracking') {
        target = 200 + 120 * Math.sin(0.55 * phaseTime + ph[0]) + 55 * Math.sin(1.45 * phaseTime + ph[1]) + 25 * Math.sin(2.7 * phaseTime + ph[2]); wid = cfg.trackingWidth * (1-.1*t/DUR);
        const d = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0); if (d) x = clamp(x + d * 300 * dt, 20, W - 20);
        if (Math.abs(x - target) < wid / 2) inside += dt;
      } else {
        const hh = hold || keys.ArrowUp;
        level = clamp(level + (hh ? 0.95 : -1.15) * dt, 0, 1);
        target = 0.5 + 0.3 * Math.sin(0.6 * phaseTime + ph[0]) + 0.1 * Math.sin(1.8 * phaseTime + ph[1]); wid = cfg.throttleWidth * (1-.1*t/DUR);
        if (Math.abs(level - target) < wid / 2) inside += dt;
      }
      time += dt;
      S.scale(); panel(g, W, H);
      if (kind === 'tracking') {
        g.fillStyle = 'rgba(80,200,140,0.28)'; g.fillRect(target - wid / 2, 40, wid, H - 80);
        g.strokeStyle = '#4ce0a0'; g.lineWidth = 2; g.strokeRect(target - wid / 2, 40, wid, H - 80);
        g.fillStyle = '#ffd166'; g.beginPath(); g.moveTo(x, H - 36); g.lineTo(x - 14, H - 8); g.lineTo(x + 14, H - 8); g.fill();
        g.fillStyle = '#ffd16655'; g.fillRect(x - 2, 40, 4, H - 80);
      } else {
        const bx = W / 2 - 40, bw = 80, top = 40, hgt = H - 80;
        g.fillStyle = '#0a0e15'; g.fillRect(bx, top, bw, hgt); g.strokeStyle = '#2b3447'; g.strokeRect(bx, top, bw, hgt);
        g.fillStyle = 'rgba(80,200,140,0.3)'; g.fillRect(bx - 8, top + (1 - target - wid / 2) * hgt, bw + 16, wid * hgt);
        g.strokeStyle = '#4ce0a0'; g.strokeRect(bx - 8, top + (1 - target - wid / 2) * hgt, bw + 16, wid * hgt);
        const ok = Math.abs(level - target) < wid / 2;
        g.fillStyle = ok ? '#7bf0a8' : '#ff8a5e'; g.fillRect(bx + 6, top + (1 - level) * hgt - 4, bw - 12, 8);
        g.fillStyle = '#4da3ff'; g.fillRect(bx + 6, top + (1 - level) * hgt, bw - 12, (level) * hgt);
      }
      g.fillStyle = '#1b2434'; g.fillRect(20, 14, W - 40, 8); g.fillStyle = '#4da3ff'; g.fillRect(20, 14, (W - 40) * Math.min(1, time / DUR), 8);
      text(g, tr(kind === 'tracking' ? 'ap_tg_track_hint' : 'ap_tg_throttle_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
      if (time >= DUR && !finished) { finished = true; done({ inside: inside / DUR }); }
    });
    return { destroy() { stop(); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); } };
  };
}

// 5 ── the braking point ─────────────────────────────────────────────────────
function braking(box, tr, done, cfg) {
  const S = stage(box, 0.62), { g, W, H } = S;
  const speeds = [58, 66, 72, 80, 62, 76].map(v=>v*cfg.brakeSpeed), dists = [210, 250, 190, 270, 230, 205];
  let k = 0, t = 0, errs = [], phase = 'run', msg = '', hold = 0, pressed = false, finished = false;
  const MPX = 1.15;                                        // pixels per metre
  function press() {
    if (phase !== 'run') return;
    const v = speeds[k], gap = dists[k] - v * t;            // metres left to the board
    errs.push(Math.round(-gap * 10) / 10);
    msg = (gap > 0 ? '−' : '+') + Math.abs(gap).toFixed(1) + ' m'; phase = 'show'; hold = 1.4; beep(gap > -3 && gap < 3 ? 700 : 300, 0.1);
  }
  const key = e => { if (e.repeat) return; if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); press(); } };
  S.c.addEventListener('pointerdown', press); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    if (phase === 'run') { t += dt; if (speeds[k] * t > dists[k] + 40) { errs.push(40); msg = tr('ap_tg_brake_late'); phase = 'show'; hold = 1.4; } }
    else { hold -= dt; if (hold <= 0) { k++; t = 0; phase = 'run'; msg = ''; if (k >= speeds.length && !finished) { finished = true; done({ errors: errs }); } } }
    S.scale(); panel(g, W, H);
    const kk = Math.min(k, speeds.length - 1);
    const carX = 40 + Math.min(speeds[kk] * t, dists[kk] + 60) * MPX * 0.0 + (phase === 'show' ? (errs.length ? 0 : 0) : 0);
    // the road scrolls, the board comes toward the car
    const gap = dists[kk] - speeds[kk] * t;
    const roadY = 150;
    g.fillStyle = '#2a2f3a'; g.fillRect(0, roadY - 34, W, 68);
    for (let i = -2; i < 20; i++) { const x = ((i * 40 - (speeds[kk] * t * MPX) % 40) + 400) % 440 - 20; g.fillStyle = '#cfd5df'; g.fillRect(x, roadY - 2, 20, 4); }
    const boardX = 114 + gap * MPX;
    g.fillStyle = '#e8c547'; g.fillRect(boardX - 3, roadY - 70, 6, 36); g.fillStyle = '#fff'; g.fillRect(boardX - 20, roadY - 90, 40, 24); text(g, '50', boardX, roadY - 78, 14, '#111', 'center', '800');
    g.fillStyle = '#ff5a4d'; g.fillRect(70, roadY - 11, 46, 22); g.fillStyle = '#fff'; g.fillRect(100, roadY - 5, 10, 10);
    g.fillStyle = '#ff5a4d88'; g.fillRect(114, roadY - 20, 1, 40);
    text(g, tr('ap_tg_brake_title') + '  ' + Math.min(k + 1, speeds.length) + '/' + speeds.length, W / 2, 24, 16, '#aab4c8');
    text(g, msg, W / 2, 232, 30, Math.abs(errs[errs.length - 1] || 99) < 6 ? '#7bf0a8' : '#ffb27a');
    text(g, tr('ap_tg_brake_hint'), W / 2, 262, 13, '#8a95ab', 'center', '500');
    void carX;
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// 6 ── rhythm of effort (fitness) ────────────────────────────────────────────
function rhythm(box, tr, done, cfg) {
  const S = stage(box, 0.7), { g, W, H } = S;
  const DUR = 18;
  let t = 0, side = 0, taps = 0, last = 0, ivs = [], flash = [0, 0], finished = false, started = false;
  function tap(s) {
    if (s !== side) return;
    const now = performance.now();
    if (last) ivs.push(now - last);
    last = now; taps++; side = 1 - side; flash[s] = 1; started = true; beep(s ? 440 : 392, 0.04, 0.03);
  }
  const click = e => { const p = S.pt(e); tap(p.x < W / 2 ? 0 : 1); };
  const key = e => { if (e.repeat) return; if (e.code === 'ArrowLeft' || e.code === 'KeyA') tap(0); else if (e.code === 'ArrowRight' || e.code === 'KeyD') tap(1); };
  S.c.addEventListener('pointerdown', click); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    if (started) t += dt;
    flash[0] = Math.max(0, flash[0] - dt * 5); flash[1] = Math.max(0, flash[1] - dt * 5);
    S.scale(); panel(g, W, H);
    for (let s = 0; s < 2; s++) {
      const on = side === s;
      g.fillStyle = on ? '#2e6bd6' : '#1b2434'; g.fillRect(14 + s * (W / 2), 50, W / 2 - 28, H - 90);
      g.fillStyle = 'rgba(123,240,168,' + flash[s] * 0.6 + ')'; g.fillRect(14 + s * (W / 2), 50, W / 2 - 28, H - 90);
      text(g, s ? '▶' : '◀', W / 4 + s * (W / 2), H / 2 + 6, 54, on ? '#fff' : '#455068');
    }
    g.fillStyle = '#1b2434'; g.fillRect(20, 16, W - 40, 8); g.fillStyle = '#ff8a5e'; g.fillRect(20, 16, (W - 40) * Math.min(1, t / DUR), 8);
    text(g, taps + ' / ' + cfg.rhythmGoal, W / 2, 38, 18, '#e8ecf4');
    // A steady beat shows the target pace without accepting automatic key repeat.
    const pulse=started ? Math.max(0,1-(t%cfg.rhythmInterval)/.10) : 0;
    g.strokeStyle=`rgba(255,209,102,${pulse})`;g.lineWidth=4;g.strokeRect(18+side*(W/2),54,W/2-36,H-98);
    text(g, tr('ap_tg_rhythm_hint'), W / 2, H - 16, 12, '#8a95ab', 'center', '500');
    if (t >= DUR && !finished) {
      finished = true;
      const m = ivs.reduce((a, b) => a + b, 0) / Math.max(1, ivs.length), sd = Math.sqrt(ivs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, ivs.length));
      done({ taps, even: clamp(1 - (sd / Math.max(1, m)) * 1.6, 0, 1) });
    }
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// 7 ── the pit stop crew (composure under pressure) ──────────────────────────
function pit(box, tr, done, cfg) {
  const S = stage(box, 0.9), { g, W, H } = S;
  const STEPS = 12, spots = [[110, 120], [290, 120], [110, 250], [290, 250]];
  let step = 0, wrong = 0, target = Math.floor(Math.random() * 4), t = 0, flash = 0, finished = false, shake = 0;
  function press(i) {
    if (finished) return;
    if (i === target) { step++; beep(600 + step * 25, 0.05); let n = target; while (n === target) n = Math.floor(Math.random() * 4); target = n; if (step % 4 === 0) flash = 1; }
    else { wrong++; shake = 0.3; beep(170, 0.18, 0.08); }
    if (step >= STEPS && !finished) { finished = true; done({ steps: step, wrong, seconds: t }); }
  }
  const click = e => { const p = S.pt(e); let bi = -1, bd = 1e9; spots.forEach((s, i) => { const d = Math.hypot(s[0] - p.x, s[1] - p.y); if (d < bd) { bd = d; bi = i; } }); if (bd < cfg.pitRadius) press(bi); };
  const key = e => { if (e.repeat) return; const m = { KeyQ: 0, KeyE: 1, KeyA: 2, KeyD: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code]; if (m != null) press(m); };
  S.c.addEventListener('pointerdown', click); window.addEventListener('keydown', key);
  const stop = loop(dt => {
    if (!finished) t += dt;
    flash = Math.max(0, flash - dt * 1.6); shake = Math.max(0, shake - dt);
    S.scale(); panel(g, W, H);
    g.save(); if (shake) g.translate((Math.random() - 0.5) * 8, 0);
    g.fillStyle = '#2a3140'; g.fillRect(150, 70, 100, 230); g.fillStyle = '#d7263d'; g.fillRect(168, 40, 64, 290);
    spots.forEach((s, i) => { g.fillStyle = i === target ? '#ffd166' : '#151a24'; g.beginPath(); g.arc(s[0], s[1], cfg.pitRadius, 0, 7); g.fill(); g.strokeStyle = i === target ? '#fff' : '#3a4560'; g.lineWidth = 3; g.stroke(); text(g, ['↖', '↗', '↙', '↘'][i], s[0], s[1], 28, i === target ? '#111' : '#586482'); });
    g.restore();
    if (t >= cfg.pitDeadline && !finished) { finished=true;done({steps:step,wrong,seconds:t}); }
    const left = Math.max(0, 1 - t / cfg.pitDeadline);
    g.fillStyle = '#1b2434'; g.fillRect(20, 14, W - 40, 8); g.fillStyle = left < 0.3 ? '#ff5a4d' : '#ffb347'; g.fillRect(20, 14, (W - 40) * left, 8);
    text(g, step + ' / ' + STEPS, W / 2, 40, 16, '#e8ecf4'); text(g, tr('ap_tg_pit_hint'), W / 2, H - 14, 12, '#8a95ab', 'center', '500');
    if (flash > 0) { g.fillStyle = 'rgba(255,40,30,' + flash * 0.35 + ')'; g.fillRect(0, 0, W, H); }
  });
  return { destroy() { stop(); window.removeEventListener('keydown', key); } };
}

// 8 ── one minute of sustained effort, measuring the drop in tapping cadence.
function endurance(box,tr,done,cfg){
  const S=stage(box,.75),{g,W,H}=S,buckets=[0,0,0,0,0,0];
  let started=false,t=0,finished=false,flash=0,last=-1;
  const tap=()=>{if(finished)return;const now=performance.now();if(now-last<35)return;last=now;started=true;buckets[Math.min(5,Math.floor(t/10))]++;flash=1;};
  S.c.addEventListener('pointerdown',tap);
  const key=e=>{if(!e.repeat&&(e.code==='Space'||e.code==='Enter')){e.preventDefault();tap();}};
  window.addEventListener('keydown',key);
  const stop=loop(dt=>{
    if(started&&!finished)t+=dt;
    flash=Math.max(0,flash-dt*7);S.scale();panel(g,W,H);
    const total=buckets.reduce((a,b)=>a+b,0),elapsed=Math.min(60,t);
    text(g,tr('ap_endurance_timer',{n:Math.ceil(60-elapsed)}),W/2,30,22);
    g.fillStyle=flash?'#55b5ff':'#245da1';g.beginPath();g.arc(W/2,140,65,0,7);g.fill();
    text(g,String(total),W/2,140,42,'#fff');
    for(let i=0;i<6;i++){const h=Math.min(65,buckets[i]/(30+100*cfg.difficulty**2)*60);g.fillStyle=i===Math.min(5,Math.floor(t/10))?'#ffd166':'#65b9ff';g.fillRect(45+i*53,270-h,35,h);}
    text(g,tr(started?'ap_endurance_keep':'ap_endurance_begin'),W/2,285,12,'#c2ccdc');
    if(t>=60&&!finished){finished=true;done({buckets});}
  });
  return {destroy(){stop();window.removeEventListener('keydown',key);}};
}

export { stage, loop, text, panel, beep, clamp };
const GAMES = { lights, catch: catchBalls, tracking: follow('tracking'), throttle: follow('throttle'), brake: braking, rhythm, pit, endurance };

export function run(game, box, tr, done, opts = {}) {
  const make = GAMES[game];
  if (!make) { done({}); return { destroy() {} }; }
  return make(box, tr, done, trainingSettings(opts.difficulty));
}
