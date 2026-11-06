// Racelandia - the engineers' view of a run: what the car did lap by lap and where
// the setup could move. It reads only what the simulation measured, so the advice is
// a range, not a number, and the range narrows with every lap of data.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const CLIFF = 0.72;                       // the wear after which grip falls away quickly

// How a lap looks to the engineers.
export function lapRows(run) {
  const rows = [];
  let prevWear = [0, 0, 0, 0], prevFuel = null;
  for (const l of run.laps) {
    const wearNow = l.wear || [0, 0, 0, 0];
    const fresh = l.pit && l.compound !== undefined && wearNow.some((w, i) => w < prevWear[i] - 0.02);
    const delta = wearNow.map((w, i) => fresh ? w : Math.max(0, w - prevWear[i]));
    rows.push({
      n: l.n, time: l.time, valid: !!l.valid, out: !!l.out, pit: !!l.pit, sectors: l.sectors, compound: l.compound,
      m: l.m || null, wear: wearNow, wearDelta: delta, tyreT: l.tyreT, top: (l.topSpeed || 0) * 3.6,
      fuelUsed: prevFuel == null ? null : Math.max(0, prevFuel - l.fuel), fuel: l.fuel,
    });
    prevWear = wearNow; prevFuel = l.fuel;
  }
  return rows;
}

// One principle for every session (test, qualifying, race): the team looks at everything this driver has done on
// the circuit - the best laps count most, laps in similar weather count more, and so do laps with the same car (same
// parts) and driver; another car, another version of a part or another driver count less.
// With little data the ranges are wide and centred on the standard setup; with every lap they narrow around the
// best setups found. `cond` is the weather now, so the advice follows the track as it changes.
// How alike two cars and two drivers are: the car by what its fitted parts do to it (a new part version simply makes
// it a little different), the driver by who it is and how good they were then.
function likeness(r, me) {
  const p = r.profile;
  if (!p || !me) return r.mine ? 0.6 : 0.2;                      // runs from before this was recorded
  let d = Math.abs((p.mods?.mass || 0) - (me.mods?.mass || 0)) / 100;
  for (const k in (me.mods || {})) if (k !== 'mass' && typeof me.mods[k] === 'number') d += Math.abs((p.mods?.[k] ?? me.mods[k]) - me.mods[k]);
  const car = Math.exp(-d / 0.08) * (p.car === me.car ? 1 : 0.5);
  const skill = Math.exp(-Math.abs((p.overall || 0) - (me.overall || 0)) / 20);
  return car * skill * (p.pilot === me.pilot ? 1 : 0.35);
}

export function advise(pool, cond, defs, me, modeF) {
  const runs = (pool || []).filter(r => r && r.setup && r.best > 0);
  const near = runs.map(r => ({ r, c: Math.exp(-Math.abs((r.water || 0) - (cond.water || 0)) / 0.8) * Math.exp(-Math.abs((r.air || 0) - (cond.air || 0)) / 15)
    * Math.exp(-Math.abs((r.asphalt || 0) - (cond.track || 0)) / 20) * likeness(r, me) }));
  const close = near.filter(x => x.c > 0.2), ref = Math.min(...(close.length ? close : near).map(x => x.r.best));
  const w = near.map(x => ({ r: x.r, w: x.c * Math.exp(-(x.r.best / ref - 1) / 0.012) }));
  const wsum = w.reduce((a, x) => a + x.w, 0);
  const n = near.reduce((a, x) => a + x.c * Math.min(x.r.laps || 0, 8), 0);
  const prior = {};
  for (const d of defs) prior[d.key] = wsum > 1e-6 ? w.reduce((a, x) => a + x.w * (x.r.setup[d.key] ?? d.def), 0) / wsum : d.def;
  // fuel burnt per lap by the runs here, scaled to the standard engine mode (the engine mode multiplies the burn)
  let fw = 0, fs = 0;
  for (const x of near) if (x.r.fuelLap > 0 && x.c > 1e-6) { const k = modeF?.[x.r.setup.engine] || 1; fw += x.c; fs += x.c * x.r.fuelLap / k; }
  return { prior, fuelLap: fw > 1e-6 ? fs / fw : null, fuelRuns: near.filter(x => x.r.fuelLap > 0).length, n, scale: 0.45 + 2.6 / (1 + n / 5), weight: 2 + Math.min(6, n / 6), laps: runs.filter(r => r.mine).reduce((a, r) => a + (r.laps || 0), 0) };
}

// The state of the tyres now and how long they should last, from the laps driven on them.
export function tyreStats(rows, run) {
  const useful = rows.filter(r => !r.out && !r.pit && r.m).slice(-5);
  const perLap = [0, 1, 2, 3].map(i => avg(useful.map(r => r.wearDelta[i])));
  const now = rows.length ? rows[rows.length - 1].wear : [0, 0, 0, 0];
  const mean = avg(perLap);
  const left = mean > 0.0005 ? Math.max(0, (CLIFF - avg(now)) / mean) : null;
  return { compound: run.compoundNow, wear: now, perLap, mean, lapsLeft: left, samples: useful.length, cliff: CLIFF };
}

const WIDTH = { frontWing: 3, rearWing: 3, arbF: 3, arbR: 3, camberF: 1.0, camberR: 1.0, brakeBias: 5, diff: 20, rideF: 5, rideR: 6, springF: 50, springR: 50, pressF: 1.8, pressR: 1.8, gearing: 2, engine: 1 };

// Where each slider could move, as a range that gets narrower with more laps. The team starts from
// what worked best before on this circuit with this driver (`prior`, the advice shown before the run) and
// leans on the measurements more with every lap, so the ranges keep following the current conditions.
const PRIOR_WEIGHT = 2;

// The fuel to load: what the laps ahead burn at the consumption seen on this circuit with the engine mode set now, plus a
// reserve that is wide while there is little data and narrows with more runs and a better engineer. Nothing without a measured run.
function fuelItem(opts, defs, s) {
  const f = opts.fuel, d = defs.find(x => x.key === 'fuel');
  if (!f || !d || !(f.perLap > 0)) return null;
  const burn = f.perLap * (f.modeF?.[s.engine] || 1), need = burn * f.laps, k = opts.scale / 3;
  const snap = v => clamp(Math.ceil(v / d.step - 1e-9) * d.step, d.min, d.max);
  const lo = snap(need + burn * 0.25 * k), hi = Math.max(lo, snap(need + burn * 1.2 * k)), mid = (lo + hi) / 2, cur = s.fuel;
  return { key: 'fuel', cur, lo, hi, move: mid - cur, prior: null, inRange: cur >= lo - 1e-9 && cur <= hi + 1e-9, min: d.min, max: d.max, unit: d.unit, step: d.step, fuelOnly: true };
}
export function suggestions(run, rows, defs, prior, opts = {}) {
  const scale = (opts.scale || 1) * (opts.narrow || 1), priorWeight = opts.weight || PRIOR_WEIGHT;
  const every = rows.filter(r => !r.out && !r.pit && r.m);
  const useful = every.slice(-5);                       // the figures come from the latest laps...
  const n = every.length;                               // ...and the range keeps narrowing with all of them
  const s = run.setup, Topt = run.P.comp.Topt;
  if (!n) {
    if (!prior) return { n: 0, items: [] };
    const items = [];
    for (const key of Object.keys(WIDTH)) {
      const d = defs.find(x => x.key === key); if (!d || prior[key] == null) continue;
      const snap = v => clamp(Math.round((v - d.min) / d.step) * d.step + d.min, d.min, d.max);
      const half = WIDTH[key] * scale / 2, lo = snap(prior[key] - half), hi = snap(prior[key] + half), cur = s[key];
      items.push({ key, cur, lo, hi, move: prior[key] - cur, inRange: cur >= lo - 1e-9 && cur <= hi + 1e-9, min: d.min, max: d.max, unit: d.unit, step: d.step, prior: prior[key] });
    }
    const fuel = fuelItem({ ...opts, scale, narrow: 1 }, defs, s);
    if (fuel) items.push(fuel);
    items.sort((a, b) => Math.abs(b.move / (WIDTH[b.key] || 5)) - Math.abs(a.move / (WIDTH[a.key] || 5)));
    return { n: 0, items, fromPrior: true };
  }
  const us = avg(useful.map(r => r.m.us)), lockF = avg(useful.map(r => r.m.lockF)), lockR = avg(useful.map(r => r.m.lockR));
  const spin = avg(useful.map(r => r.m.spin)), bottom = avg(useful.map(r => r.m.bottom));
  const tMaxF = avg(useful.map(r => Math.max(r.m.tMax[0], r.m.tMax[1]))), tMaxR = avg(useful.map(r => Math.max(r.m.tMax[2], r.m.tMax[3])));
  const top = Math.max(...useful.map(r => r.top)), vmax = (80 + 3.4 * s.gearing) * 3.6;
  const bal = clamp(us / 0.03, -2, 2);                            // + understeer, - oversteer
  const press = t => (t > Topt + 14 ? -0.6 * clamp((t - Topt - 14) / 10, 0, 2) : t < Topt - 28 ? 0.6 * clamp((Topt - 28 - t) / 10, 0, 2) : 0);
  const raw = {
    frontWing: 1.5 * bal, rearWing: -1.0 * bal, arbF: -1.2 * bal, arbR: 1.0 * bal, camberF: -0.3 * bal,
    brakeBias: -2.0 * clamp(lockF / 1.5, 0, 2) + 2.0 * clamp(lockR / 0.8, 0, 2),
    diff: -10 * clamp(spin / 4, 0, 2),
    rideF: bottom > 0.5 ? 2 * clamp(bottom / 1.5, 0, 2) : n >= 3 && bottom === 0 ? -1 : 0,
    pressF: press(tMaxF), pressR: press(tMaxR),
    gearing: top >= 0.985 * vmax ? 1 : top < 0.9 * vmax ? -1 : 0,
  };
  const items = [];
  for (const key of Object.keys(WIDTH)) {
    const d = defs.find(x => x.key === key); if (!d) continue;
    const cur = s[key], w = (WIDTH[key] || 2) * scale / Math.sqrt(n);
    let c = cur + (raw[key] || 0);
    const pv = prior && prior[key] != null ? prior[key] : null;
    if (pv != null) c = (priorWeight * pv + n * c) / (priorWeight + n);
    c = clamp(c, d.min, d.max);
    const snap = v => clamp(Math.round((v - d.min) / d.step) * d.step + d.min, d.min, d.max);
    const lo = snap(c - w / 2), hi = snap(c + w / 2);
    items.push({ key, cur, lo: Math.min(lo, hi), hi: Math.max(lo, hi), move: c - cur, prior: pv, inRange: cur >= Math.min(lo, hi) - 1e-9 && cur <= Math.max(lo, hi) + 1e-9, min: d.min, max: d.max, unit: d.unit, step: d.step });
  }
  // the moves that matter first
  items.sort((a, b) => Math.abs(b.move / (WIDTH[b.key] || 2)) - Math.abs(a.move / (WIDTH[a.key] || 2)));
  return { n, items, balance: us, lockF, lockR, spin, bottom, tMaxF, tMaxR, top, vmax };
}
