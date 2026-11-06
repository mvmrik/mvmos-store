// Racelandia - the driver's radio. While a run is played back, the driver reports what happens, in short messages:
// laps and sectors, the balance of the car, the tyres, the fuel, the weather and every incident. It reads only what the
// simulation already recorded (frames, events and finished laps), so it can follow a replay, a skip and a reload alike.
// Each message is a key plus parameters; the text (with one or two variants) lives in i18n.js as ap_rd_<key>[_<n>].
const FR = 36;                                    // numbers per recorded frame
const DT = 1 / 30;
const RAIN_UP = [0.08, 0.35], RAIN_DOWN = [0.04, 0.25];
const WEAR_STEPS = [['wear_mid', 0.40], ['wear_high', 0.65]];

// How urgent a message is: 2 jumps the queue and is never dropped, 1 waits a little, 0 may be dropped when it is old.
export function createRadio() {
  let s;
  const init = (mute = false) => {
    s = {
      mute, t: 0, fi: 0, ev: 0, lp: 0, last: -99, queue: [], cool: {}, count: {},
      started: false, ready: false, best: 0, valid: 0, secBest: [0, 0, 0], topBest: 0, fuelEnd: null, tyreStop: -Infinity, wearStep: 0, rearSaid: false,
      lockF: 0, lockR: 0, hotT: 0, coldT: 0, ty: '', ers: false, rain: null, track: null, fuelSaid: false, plenty: false,
      wetSaid: -999, drySaid: -999, wetN: 0, dryN: 0, timeUp: false, finished: false, burn: [],
    };
  };
  init();

  function update(c) {
    const { run, t } = c;
    if (!run) return [];
    if (t + 0.5 < s.t) init();
    s.t = t;
    const say = (key, params = {}, o = {}) => {
      if (o.cool && s.cool[key] != null && t - s.cool[key] < o.cool) return;
      s.cool[key] = t;
      const n = s.count[key] = (s.count[key] || 0) + 1;
      s.queue.push({ key, params, variant: n, tone: o.tone || 'info', prio: o.prio || 0, at: t });
    };

    // ── incidents, sectors and the start of laps: the events the simulation recorded ──
    const E = run.events || [];
    while (s.ev < E.length && E[s.ev].t <= t) {
      const e = E[s.ev++];
      if (e.type === 'sector') {
        if (!(e.lap >= 1 || run.race) || !(e.time > 0)) continue;
        if (E.some(x => x.lap === e.lap && x.t <= t && ['limits','crash','pit-in','recovering','recovery','fuel'].includes(x.type))) continue;
        const ref = [s.secBest[e.sec], c.refSectors?.[e.sec]].filter(x => x > 0), best = ref.length ? Math.min(...ref) : 0;
        if (best && e.time < best - 0.0005) say('sector_best', { n: e.sec + 1, time: (c.fmtS || c.fmt)(e.time), delta: c.fmtD(best - e.time) }, { tone: 'best', cool: 5 });
        if (!(s.secBest[e.sec] > 0) || e.time < s.secBest[e.sec]) s.secBest[e.sec] = e.time;
      }
      else if (e.type === 'limits') say(run.race ? 'limits_race' : 'limits', {}, { tone: 'bad', cool: 6, prio: 1 });
      else if (e.type === 'spin') say('spin', {}, { tone: 'bad', prio: 2 });
      else if (e.type === 'crash') say('crash', {}, { tone: 'bad', prio: 2 });
      else if (e.type === 'error') say('error', {}, { tone: 'bad', prio: 2 });
      else if (e.type === 'failure') say('failure', { part: c.part(e.part) }, { tone: 'bad', prio: 2 });
      else if (e.type === 'fuel') say('fuel_out', {}, { tone: 'bad', prio: 2 });
      else if (e.type === 'pit-in') say('pit_in', {}, { prio: 1 });
      else if (e.type === 'pit-out') say('pit_out', {}, { prio: 1 });
      else if (e.type === 'lap') {
        if (!run.race && e.lap === 1 && run.pushLaps > 1) say('push', {}, { tone: 'good' });
        if (!(c.duration || run.sessionDuration) && e.lap === run.pushLaps && run.pushLaps >= 2) say('last_lap', {}, { prio: 1 });
      }
    }

    // ── a finished lap: time, the balance of the car, tyres and fuel ──
    const L = run.laps || [];
    while (s.lp < L.length && L[s.lp].t0 + L[s.lp].time <= t) lap(L[s.lp++], run, c, say);

    // ── the frames in between: tyre temperatures, brakes, battery and weather ──
    const F = run.frames, n = Math.min(Math.floor(c.fr / FR), F.length / FR - 1);
    for (; s.fi <= n; s.fi++) {
      const o = s.fi * FR, ft = F[o], lapNo = F[o + 21], flying = !F[o + 30] && (lapNo >= 1 || run.race), v = Math.hypot(F[o + 4], F[o + 5]) * 3.6;
      const tyre = run.pits?.findLast(p => p.t <= ft)?.compound || c.initialCompound || run.laps?.[0]?.compound || run.compoundNow;
      const Topt = c.compounds?.[tyre]?.Topt || run.P?.comp?.Topt || 100;
      const tyreStop = run.pits?.findLast(p => p.tyres && p.t <= ft)?.t ?? -Infinity;
      if (s.compound !== tyre || s.frameTyreStop !== tyreStop) { s.compound = tyre; s.frameTyreStop = tyreStop; s.hotT = 0; s.coldT = 0; s.ty = ''; s.ready = false; }
      if (!s.started && ft >= (run.lightsOut || 0) + (run.race ? 0.4 : 1.5)) {
        s.started = true;
        say(run.race ? 'start_race' : 'start', {}, { tone: 'good', prio: 1 });
      }
      const water = F[o + 28];
      if (s.rain == null) s.rain = 0;
      if (s.rain < 2 && water >= RAIN_UP[1]) { s.rain = 2; say('rain_heavy', {}, { tone: 'warn', prio: 1 }); }
      else if (s.rain < 1 && water >= RAIN_UP[0]) { s.rain = 1; say('rain_start', {}, { tone: 'warn', prio: 1 }); }
      else if (s.rain === 2 && water < RAIN_DOWN[1]) s.rain = 1;
      else if (s.rain === 1 && water < RAIN_DOWN[0]) { s.rain = 0; say('rain_over', {}, { tone: 'good', prio: 1 }); }
      if (flying && water > 0.2 && tyre !== 'I' && tyre !== 'W' && ft - s.wetSaid > 150 && s.wetN < 2) { s.wetSaid = ft; s.wetN++; say('wrong_wet', {}, { tone: 'warn', prio: 1 }); }
      if (flying && water < 0.03 && (tyre === 'I' || tyre === 'W') && ft - s.drySaid > 150 && s.dryN < 2) { s.drySaid = ft; s.dryN++; say('wrong_dry', {}, { tone: 'warn', prio: 1 }); }

      const temps = [F[o + 12], F[o + 13], F[o + 14], F[o + 15]], hot = Math.max(...temps), cold = Math.min(...temps);
      if (!run.race && !s.ready && lapNo === 0 && s.started && cold > Topt - 14 && hot < Topt + 16) { s.ready = true; say('tyres_ready', {}, { tone: 'good' }); }
      if (flying && hot > Topt + 16) s.hotT += DT; else s.hotT = Math.max(0, s.hotT - DT);
      if (flying && cold < Topt - 28 && v > 60) s.coldT += DT; else s.coldT = Math.max(0, s.coldT - DT);
      if (s.hotT > 2.5 && s.ty !== 'hot') { s.ty = 'hot'; say('tyres_hot', { n: Math.round(hot) }, { tone: 'warn', cool: 60, prio: 1 }); }
      else if (s.coldT > 3 && s.ty !== 'cold' && s.ty !== 'hot') { s.ty = 'cold'; say('tyres_cold', {}, { tone: 'warn', cool: 60 }); }
      else if (s.ty && hot < Topt + 8 && cold > Topt - 20) { s.ty = ''; say('tyres_back', {}, { tone: 'good', cool: 30 }); }

      if (F[o + 9] > 0.6) {
        s.lockF = F[o + 26] > 1.12 ? s.lockF + DT : Math.max(0, s.lockF - DT);
        s.lockR = F[o + 27] > 1.12 ? s.lockR + DT : Math.max(0, s.lockR - DT);
        if (flying && s.lockF > 0.35) { s.lockF = 0; say('lock_front', {}, { tone: 'warn', cool: 75 }); }
        if (flying && s.lockR > 0.35) { s.lockR = 0; say('lock_rear', {}, { tone: 'warn', cool: 75 }); }
      }

      const ers = F[o + 18];
      if (ers > 0.6) s.ers = true;
      else if (s.ers && ers < 0.04 && v > 100) { s.ers = false; say('ers_empty', {}, { cool: 60 }); }
    }

    // ── the weather around the car and the clock of the session ──
    if (c.cond && s.started) {
      if (s.track == null) s.track = c.cond.track;
      else if (Math.abs(c.cond.track - s.track) >= 6) { say('track_temp', { n: Math.round(c.cond.track) }, { cool: 120 }); s.track = c.cond.track; }
    }
    if (c.duration && !s.timeUp && t - (run.lightsOut || 0) >= c.duration) { s.timeUp = true; say('time_up', {}, { prio: 1 }); }
    if (run.done && !s.finished && F.length / FR - 1 <= s.fi + 1 && !run.dnf) { s.finished = true; say('finish', {}, { tone: 'good', prio: 1 }); }

    // ── one message at a time: urgent first, old ones are dropped ──
    if (c.quiet || s.mute) { s.queue.length = 0; s.last = t; if (!c.quiet) s.mute = false; return []; }
    const out = [];
    s.queue = s.queue.filter(m => m.prio >= 2 || t - m.at < (m.prio ? 25 : 14));
    for (;;) {
      if (!s.queue.length) break;
      const i = s.queue.reduce((b, m, k) => (m.prio > s.queue[b].prio ? k : b), 0), m = s.queue[i];
      if (m.prio < 2 && t - s.last < 3.2) break;
      s.queue.splice(i, 1); s.last = t; out.push(m);
      if (m.prio < 2) break;
    }
    return out;
  }

  function lap(l, run, c, say) {
    if (l.out) return;
    const tyreStop = run.pits?.findLast(p => p.tyres && p.t <= l.t0 + l.time)?.t ?? -Infinity;
    if (tyreStop !== s.tyreStop) { s.tyreStop = tyreStop; s.wearStep = 0; s.rearSaid = false; }
    const m = l.m || {}, k = 1 - 0.35 * (c.fb || 0);
    if (l.valid) {
      s.valid++;
      if (s.valid === 1) say('lap_first', { time: c.fmt(l.time) }, { tone: 'info', prio: 1 });
      else if (l.time < s.best - 1e-4) say('lap_best', { time: c.fmt(l.time), delta: c.fmtD(s.best - l.time) }, { tone: 'best', prio: 1 });
      else if (l.time > s.best * 1.012) say('lap_slow', { delta: c.fmtD(l.time - s.best) }, { tone: 'warn' });
      if (!(s.best > 0) || l.time < s.best) s.best = l.time;
      const top = (l.topSpeed || 0) * 3.6;
      if (s.topBest > 0 && top > s.topBest + 3) say('top_speed', { n: Math.round(top) }, { cool: 20 });
      s.topBest = Math.max(s.topBest, top);
    }
    if (m.us > 0.012 * k + 0.008) say('under', {}, { tone: 'warn', cool: 45 });
    else if (m.us < -0.012 * k - 0.008) say('over', {}, { tone: 'warn', cool: 45 });
    if (m.spin > 2.2 * k) say('wheelspin', {}, { tone: 'warn', cool: 60 });
    if (m.bottom > 0.5 * k) say('bottom', {}, { tone: 'warn', cool: 60 });

    // the tyres: each step of wear is mentioned once, and when the rears wear much faster than the fronts
    const w = l.wear || [0, 0, 0, 0], worst = Math.max(...w), front = (w[0] + w[1]) / 2, rear = (w[2] + w[3]) / 2;
    while (s.wearStep < WEAR_STEPS.length && worst >= WEAR_STEPS[s.wearStep][1]) {
      say(WEAR_STEPS[s.wearStep][0], { n: Math.round(worst * 100) }, { tone: 'warn', prio: 1 }); s.wearStep++;
    }
    if (!s.rearSaid && rear > 0.08 && rear > front * 1.7) { s.rearSaid = true; say('wear_rear', {}, { tone: 'warn' }); }

    // the fuel: the burn of the laps so far against the laps that are left
    if (!l.pit && l.from != null) {
      const F = run.frames, start = F[l.from * FR + 17];
      if (start > l.fuel && l.fuel >= 0) {
        s.burn.push(start - l.fuel);
        const per = s.burn.reduce((a, b) => a + b, 0) / s.burn.length, left = per > 0 ? l.fuel / per : 99;
        const duration = c.duration ?? run.sessionDuration;
        const need = duration > 0 ? Math.max(0, (duration - (l.t0 + l.time - (run.lightsOut || 0))) / l.time) : Math.max(0, run.pushLaps - l.n);
        if (left < need + 0.3 && need > 0 && !run.dnf) say('fuel_tight', { n: Math.max(0, left).toFixed(1) }, { tone: 'warn', cool: 80, prio: 1 });
        else if (!s.plenty && !run.race && s.burn.length >= 2 && left > need + 3) { s.plenty = true; say('fuel_plenty', { n: left.toFixed(1) }, {}); }
      }
    }
  }

  return { update, reset: mute => init(mute) };
}
