// Racelandia - the physics of the car, the track and the driver.
//
// One self-contained ES module (the browser imports it for the 3D view and
// the run, and it is plain enough to run in Node for tests). Nothing in here
// touches the page. A run is computed completely, ahead of the replay: the
// player never steers, so the lap is a pure function of the setup, the driver's
// skills, the weather and a seed. The replay then plays the recorded
// telemetry from any camera.
//
// Units are SI (m, s, kg, N, rad) unless a name says otherwise.

const G = 9.81;
// Tyre wear per unit of slip energy. A set lasts roughly 12 laps (soft), 24 (medium) or 40 (hard) on the test circuit.
const WEAR_SCALE = 50;
// The rear tyres carry the drive and the weight, so they wear faster than the front ones - but by about half again, not
// twice: the share of each axle keeps the average wear of a set as it was.
const AXLE_WEAR = { front: 1.4, rear: 0.83 };
// A used set goes on the way a mechanic would fit it: when the rears are the more worn pair, the axles swap places.
const mounted = w => { const a = Array.from(w, Number); while (a.length < 4) a.push(0); return a[2] + a[3] > a[0] + a[1] ? [a[2], a[3], a[0], a[1], ...a.slice(4)].slice(0, 4) : a.slice(0, 4); };
const TAU = Math.PI * 2;

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(TAU * r()); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

// ── The track ────────────────────────────────────────────────────────────────
// Designed with a turtle: straights and arcs. Two straights are left open
// ('A' east, 'B' north) and solved so that the loop closes exactly.

export const TRACKS = {
  test: {
    id: 'test',
    width: 13,
    runoff: 18,
    cmds: [
      ['A'], ['arc', 90, 82],            // main straight, turn 1
      ['B'], ['arc', -42, 60], ['str', 22], ['arc', 42, 60], ['str', 90],
      ['arc', 90, 150],                  // long fast left
      ['str', 230], ['arc', 90, 52],
      ['str', 120], ['arc', 90, 78], ['str', 80],
      ['arc', -90, 42], ['str', 90], ['arc', -90, 64],
      ['str', 210], ['arc', -18, 380], ['arc', 18, 380], ['str', 160],
      ['arc', 90, 58], ['str', 12], ['arc', 90, 58],
    ],
    sectors: [0.34, 0.68],
    start: 110,
  },
};

function fromCommands(def, DS) {
  // 1. Turtle: collect pieces with a length each; solve A and B afterwards.
  const pieces = def.cmds.map(c => ({ k: c[0], a: c[1], r: c[2] }));
  function walk(lenA, lenB, fn) {
    let x = 0, y = 0, h = 0;
    for (const p of pieces) {
      if (p.k === 'A' || p.k === 'B' || p.k === 'str') {
        const L = p.k === 'A' ? lenA : p.k === 'B' ? lenB : p.a;
        fn(x, y, h, 0, L);
        x += Math.cos(h) * L; y += Math.sin(h) * L;
      } else {
        const ang = p.a * Math.PI / 180, R = p.r, L = Math.abs(ang) * R;
        fn(x, y, h, Math.sign(ang) / R, L);
        const cx = x - Math.sin(h) * R * Math.sign(ang), cy = y + Math.cos(h) * R * Math.sign(ang);
        h += ang;
        x = cx + Math.sin(h) * R * Math.sign(ang); y = cy - Math.cos(h) * R * Math.sign(ang);
      }
    }
    return [x, y, h];
  }
  const e0 = walk(0, 0, () => {});
  const lenA = -e0[0], lenB = -e0[1];
  // 2. Curvature as a function of distance, softened into clothoid-like entries.
  const kap = [];
  walk(lenA, lenB, (x, y, h, k, L) => {
    const n = Math.max(1, Math.round(L / 0.5));
    for (let i = 0; i < n; i++) kap.push(k);
  });
  const total = kap.length * 0.5;
  const win = 24;                                  // metres of softening
  const w = Math.round(win / 0.5);
  const soft = new Float64Array(kap.length);
  for (let i = 0; i < kap.length; i++) {
    let s = 0;
    for (let j = -w; j <= w; j++) s += kap[(i + j + kap.length) % kap.length];
    soft[i] = s / (2 * w + 1);
  }
  // 3. Integrate the softened curvature, then close the small gap.
  const N = Math.round(total / DS);
  const ds = total / N;
  const x = new Float64Array(N), y = new Float64Array(N), psi = new Float64Array(N);
  let px = 0, py = 0, ph = 0;
  for (let i = 0; i < N; i++) {
    x[i] = px; y[i] = py; psi[i] = ph;
    const m = soft[Math.min(soft.length - 1, Math.round((i + 0.5) * ds / 0.5))];
    ph += m * ds * 0.5; px += Math.cos(ph) * ds; py += Math.sin(ph) * ds; ph += m * ds * 0.5;
  }
  const ex = px - x[0], ey = py - y[0];
  for (let i = 0; i < N; i++) { x[i] -= ex * i / N; y[i] -= ey * i / N; }
  const eh = wrap(ph - psi[0]);
  return { N, ds, x, y, psi, ex, ey, eh };
}

// A circuit given as measured centre-line points [x, y] in metres (a real circuit) is
// resampled evenly and closed; one given as turtle commands is integrated.
function resamplePoints(points, DS) {
  const n = points.length;
  let total = 0;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { const b = (i + 1) % n; total += Math.hypot(points[b][0] - points[i][0], points[b][1] - points[i][1]); cum[i + 1] = total; }
  const N = Math.round(total / DS), ds = total / N;
  const x = new Float64Array(N), y = new Float64Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const s = i * ds;
    while (cum[seg + 1] < s && seg < n - 1) seg++;
    const a = points[seg], b = points[(seg + 1) % n], u = (s - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    x[i] = a[0] + (b[0] - a[0]) * u; y[i] = a[1] + (b[1] - a[1]) * u;
  }
  // the raw points are a few metres apart: smooth them lightly so the curvature is not noise
  for (let pass = 0; pass < 6; pass++) {
    const tx = new Float64Array(x), ty = new Float64Array(y);
    for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; x[i] = (tx[a] + 2 * tx[i] + tx[b]) / 4; y[i] = (ty[a] + 2 * ty[i] + ty[b]) / 4; }
  }
  return { N, ds, x, y };
}

export function buildTrack(def) {
  const DS = 3;
  let N, ds, x, y, psi, ex = 0, ey = 0, eh = 0;
  if (def.points) {
    ({ N, ds, x, y } = resamplePoints(def.points, DS));
    psi = new Float64Array(N);
  } else {
    ({ N, ds, x, y, psi, ex, ey, eh } = fromCommands(def, DS));
  }
  // 4. Headings and curvature from the final points.
  const nx = new Float64Array(N), ny = new Float64Array(N), kappa = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    psi[i] = Math.atan2(y[b] - y[a], x[b] - x[a]);
    nx[i] = -Math.sin(psi[i]); ny[i] = Math.cos(psi[i]);
  }
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    kappa[i] = wrap(psi[b] - psi[a]) / (2 * ds);
  }
  for (let pass = 0; pass < 3; pass++) {
    const t = new Float64Array(kappa);
    for (let i = 0; i < N; i++) kappa[i] = (t[(i + N - 1) % N] + 2 * t[i] + t[(i + 1) % N]) / 4;
  }
  const rot = a => { const o = new Float64Array(N), k = def.start || 0; for (let i = 0; i < N; i++) o[i] = a[(i + k) % N]; return o; };
  const T = {
    id: def.id, grandstands: def.grandstands || [], N, ds, len: N * ds, width: def.width, half: def.width / 2, runoff: def.runoff,
    x: rot(x), y: rot(y), psi: rot(psi), nx: rot(nx), ny: rot(ny), kappa: rot(kappa), closureErr: Math.hypot(ex, ey), headErr: eh,
    sectors: def.sectors,
  };
  T.line = racingLine(T);
  buildPit(T);
  return T;
}

// The pit lane: a lane beside the main straight that the car leaves the racing
// line for. Indices are counted back from the start/finish line.
function buildPit(T) {
  const N = T.N, D = 3 / T.ds;
  const at = k => ((k % N) + N) % N;
  const P = {
    decide: at(N - Math.round(125 * D)),      // where the driver must have been told
    inA: N - Math.round(90 * D), inB: N - Math.round(60 * D),
    outA: Math.round(40 * D), outB: Math.round(75 * D),
    box: at(N - Math.round(18 * D)),
    limit: 22,                                 // m/s, the pit lane limiter (about 80 km/h)
    centre: -(T.half + 6),
    lane: 1.6, halfWidth: 3.6,
  };
  const off = new Float64Array(N), px = new Float64Array(N), py = new Float64Array(N), blend = new Float64Array(N);
  const ramp = (x, a, b) => { const u = clamp((x - a) / Math.max(1, b - a), 0, 1); return 0.5 - 0.5 * Math.cos(Math.PI * u); };
  for (let i = 0; i < N; i++) {
    const k = i >= N / 2 ? i - N : i;                // negative before the line
    let w = 0;
    const a = P.inA - N, b = P.inB - N;
    if (k >= a && k < b) w = ramp(k, a, b);
    else if (k >= b && k <= P.outA) w = 1;
    else if (k > P.outA && k < P.outB) w = 1 - ramp(k, P.outA, P.outB);
    off[i] = T.line.off[i] + (P.centre - T.line.off[i]) * w;
    blend[i] = w;
    px[i] = T.x[i] + off[i] * T.nx[i]; py[i] = T.y[i] + off[i] * T.ny[i];
  }
  P.line = lineFromPoints(T, px, py, off);
  P.boxes = Array.from({ length: 10 }, (_, n) => at(P.box + Math.round((n - 5) * 12 / T.ds)));
  const route = service => {
    const x = new Float64Array(N), y = new Float64Array(N), offsets = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const distance = (at(i - P.box + N / 2) - N / 2) * T.ds;
      const turn = service ? ramp(distance, -55, -14) * (1 - ramp(distance, 9, 50)) : 0;
      const lane = P.lane * (1 - 2 * turn) * blend[i];
      x[i] = px[i] + T.nx[i] * lane; y[i] = py[i] + T.ny[i] * lane; offsets[i] = off[i] + lane;
    }
    return lineFromPoints(T, x, y, offsets);
  };
  P.fastLine = route(false); P.serviceLine = route(true);
  P.inLane = i => { const k = i >= N / 2 ? i - N : i; return k >= P.inA - N && k <= P.outB; };
  P.inLimit = i => { const k = i >= N / 2 ? i - N : i; return k >= P.inB - N - 6 && k <= P.outA + 6; };
  T.pit = P;
}

// The line a driver aims for: the one with the gentlest bends the corridor allows, not the shortest
// path (which hugs the inside of every bend, even on the way in). It enters a corner from the outside,
// touches the inside at the apex and leaves on the outside, so the corner has the widest arc it can.
// Solved on a coarser grid of offsets across the track (every ~12 m) by relaxing the second difference
// of the path with the limits of the track, then spread back to every point.
const FINE = 150;
function racingLine(T) {
  const N = T.N, lim = T.half - 1.7;
  const step = Math.max(1, Math.round(12 / T.ds)), M = Math.ceil(N / step);
  const at = j => ((j % M) + M) % M;
  const cx = new Float64Array(M), cy = new Float64Array(M), nx = new Float64Array(M), ny = new Float64Array(M);
  for (let j = 0; j < M; j++) { const i = Math.min(N - 1, Math.round(j * N / M)); cx[j] = T.x[i]; cy[j] = T.y[i]; nx[j] = T.nx[i]; ny[j] = T.ny[i]; }
  const o = new Float64Array(M);
  const px = new Float64Array(M), py = new Float64Array(M);
  for (let j = 0; j < M; j++) { px[j] = cx[j]; py[j] = cy[j]; }
  // the shortest path first: a good start, with no crossing over the middle of a bend
  for (let it = 0; it < 400; it++) {
    for (let j = 0; j < M; j++) {
      const a = at(j - 1), b = at(j + 1);
      const t = ((px[a] + px[b]) * 0.5 - cx[j]) * nx[j] + ((py[a] + py[b]) * 0.5 - cy[j]) * ny[j];
      o[j] = clamp(o[j] + (t - o[j]) * 0.6, -lim, lim);
      px[j] = cx[j] + o[j] * nx[j]; py[j] = cy[j] + o[j] * ny[j];
    }
  }
  // then the gentlest bends: Gauss-Seidel on the second difference, over-relaxed, kept inside the track
  for (let it = 0; it < 6000; it++) {
    let moved = 0;
    for (let j = 0; j < M; j++) {
      const a = at(j - 1), b = at(j + 1), c = at(j - 2), d = at(j + 2);
      const tx = (4 * (px[a] + px[b]) - px[c] - px[d]) / 6, ty = (4 * (py[a] + py[b]) - py[c] - py[d]) / 6;
      const t = (tx - cx[j]) * nx[j] + (ty - cy[j]) * ny[j];
      const n = clamp(o[j] + (t - o[j]) * 1.6, -lim, lim);
      moved = Math.max(moved, Math.abs(n - o[j]));
      o[j] = n; px[j] = cx[j] + n * nx[j]; py[j] = cy[j] + n * ny[j];
    }
    if (moved < 0.002) break;
  }
  const off = new Float64Array(N), qx = new Float64Array(N), qy = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    // cubic (Catmull-Rom) blend between the solved offsets: no kinks in the heading at the grid points
    const f = i * M / N, j = Math.floor(f), u = f - j;
    const p0 = o[at(j - 1)], p1 = o[at(j)], p2 = o[at(j + 1)], p3 = o[at(j + 2)];
    off[i] = 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
  }
  // the same relaxation at full resolution: the curvature of the line varies smoothly, so the speed the
  // driver aims for has no ripple (the coarse grid alone leaves a faint one every 12 m)
  {
    const px = new Float64Array(N), py = new Float64Array(N);
    for (let i = 0; i < N; i++) { px[i] = T.x[i] + off[i] * T.nx[i]; py[i] = T.y[i] + off[i] * T.ny[i]; }
    for (let it = 0; it < FINE; it++) {
      for (let i = 0; i < N; i++) {
        const a = (i + N - 1) % N, b = (i + 1) % N, c = (i + N - 2) % N, d = (i + 2) % N;
        const tx = (4 * (px[a] + px[b]) - px[c] - px[d]) / 6, ty = (4 * (py[a] + py[b]) - py[c] - py[d]) / 6;
        const t = (tx - T.x[i]) * T.nx[i] + (ty - T.y[i]) * T.ny[i];
        off[i] = clamp(off[i] + (t - off[i]) * 1.6, -lim, lim);
        px[i] = T.x[i] + off[i] * T.nx[i]; py[i] = T.y[i] + off[i] * T.ny[i];
      }
    }
  }
  for (let i = 0; i < N; i++) {
    off[i] = clamp(off[i], -lim, lim);
    qx[i] = T.x[i] + off[i] * T.nx[i]; qy[i] = T.y[i] + off[i] * T.ny[i];
  }
  return lineFromPoints(T, qx, qy, off);
}

// A path through the circuit given as points, with its heading, curvature,
// distance along it and the corners it contains.
function lineFromPoints(T, px, py, off) {
  const N = T.N;
  const ls = new Float64Array(N), kap = new Float64Array(N), psi = new Float64Array(N);
  let s = 0;
  for (let i = 0; i < N; i++) {
    ls[i] = s;
    const b = (i + 1) % N;
    s += Math.hypot(px[b] - px[i], py[b] - py[i]);
  }
  const len = s;
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    psi[i] = Math.atan2(py[b] - py[a], px[b] - px[a]);
  }
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const d = Math.hypot(px[b] - px[a], py[b] - py[a]) || 1;
    kap[i] = wrap(psi[b] - psi[a]) / d;
  }
  for (let pass = 0; pass < 6; pass++) {
    const t = new Float64Array(kap);
    for (let i = 0; i < N; i++) kap[i] = (t[(i + N - 1) % N] + 2 * t[i] + t[(i + 1) % N]) / 4;
  }
  // corners = runs where the line really bends
  const corners = [];
  const thr = 1 / 520;
  let i0 = -1;
  for (let i = 0; i < N * 2; i++) {
    const k = Math.abs(kap[i % N]);
    if (k > thr && i0 < 0) i0 = i;
    if ((k <= thr || i === N * 2 - 1) && i0 >= 0) { corners.push([i0, i - 1]); i0 = -1; }
  }
  // fold the second pass back, merge neighbours that are almost touching
  const seen = [];
  for (const c of corners) {
    if (c[0] >= N) continue;
    seen.push([c[0], Math.min(c[1], c[0] + N - 1)]);
  }
  const merged = [];
  for (const c of seen) {
    const last = merged[merged.length - 1];
    if (last && c[0] - last[1] < 14) last[1] = Math.max(last[1], c[1]); else merged.push([c[0], c[1]]);
  }
  return { x: px, y: py, psi, kap, ls, len, off, corners: merged };
}

// ── Weather ──────────────────────────────────────────────────────────────────
// The server owns the forecast (one entry per hour). The sim only reads it.

export function dryDay(over) {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const sun = Math.max(0, Math.sin((h - 6) / 14 * Math.PI));
    const air = 17 + 9 * Math.max(0, Math.sin((h - 8) / 14 * Math.PI));
    hours.push(Object.assign({ air, track: air + 18 * sun * 0.85, cloud: 0.15, rain: 0, water: 0, sun, hum: 45, rubber: 0.975 }, over || {}));
  }
  return hours;
}

// How much one crash hurts each part at full strength; the server uses the same split when it settles a run.
// What the crew needs to fit one spare part, in seconds (mirrored in race.js and race_engine.py).
const SWAP_SECONDS = { frontWing: 4, rearWing: 4, floor: 10, suspension: 10, brakes: 8, battery: 8, engine: 15, gearbox: 15 };
const CRASH_SPLIT = { frontWing: .7, floor: .4, suspension: .35, rearWing: .35, brakes: .1, engine: .08 };

export function condAt(forecast, hour) {
  const h = ((hour % 24) + 24) % 24, i = Math.floor(h), f = h - i;
  const a = forecast[i], b = forecast[(i + 1) % 24];
  const o = {};
  for (const k in a) o[k] = typeof a[k] === 'number' ? lerp(a[k], b[k], f) : a[k];
  return o;
}

// ── Tyres ────────────────────────────────────────────────────────────────────

export const COMPOUNDS = {
  S: { mu: 2.14, Topt: 98, Wd: 19, B: 17.5, wear: 1.9, heat: 0.82, d: 0.7, start: 84 },
  M: { mu: 2.03, Topt: 100, Wd: 22, B: 17.0, wear: 1.0, heat: 1.0, d: 0.7, start: 84 },
  H: { mu: 1.93, Topt: 104, Wd: 28, B: 16.5, wear: 0.55, heat: 0.92, d: 0.7, start: 84 },
  I: { mu: 1.66, Topt: 72, Wd: 30, B: 15.5, wear: 1.3, heat: 1.15, d: 2.2, start: 62 },
  W: { mu: 1.46, Topt: 58, Wd: 34, B: 14.5, wear: 0.9, heat: 0.85, d: 4.5, start: 52 },
};

// ── The car ──────────────────────────────────────────────────────────────────

const CAR = {
  mass: 798, L: 3.6, wf: 0.445, tf: 1.60, tr: 1.54, h: 0.30, Iz: 1100,
  pIce: 560e3, pErs: 120e3, ersMax: 4e6, ersHarvLap: 2e6, ersDepLap: 4e6,
  fuelMax: 110, fuelFlow: 0.0275,
  Fz0: 2500,
};
const MODE_P = [0, 0.93, 0.965, 1.0, 1.025, 1.045];
export const MODE_F = [0, 0.86, 0.93, 1.0, 1.08, 1.17];

function prep(setup, comp, hp, mods) {
  const s = setup, c = COMPOUNDS[comp];
  hp = hp || {};
  const w = k => clamp(+hp[k] || 0, 0, 1);
  const P = { comp: c, compKey: comp };
  P.fw = 0.5 + 0.075 * s.frontWing;                       // front wing lift term (CL*A)
  P.rw = 0.4 + 0.12 * s.rearWing;
  P.cdw = 0.62 + 0.018 * s.frontWing + 0.040 * s.rearWing;
  P.kF = s.springF * 2; P.kR = s.springR * 2;             // N/mm per axle
  P.rideF = s.rideF; P.rideR = s.rideR;
  const Kf = 14 + 4.0 * s.arbF + 0.04 * s.springF, Kr = 13 + 4.0 * s.arbR + 0.04 * s.springR;
  P.df = Kf / (Kf + Kr) + 0.0;                            // share of lateral transfer carried by the front
  P.camF = s.camberF; P.camR = s.camberR;
  P.pF = s.pressF; P.pR = s.pressR;
  P.bias = s.brakeBias / 100;
  P.lock = s.diff / 100;
  P.vmax = 80 + 3.4 * s.gearing;
  P.mode = Math.round(s.engine);
  P.pIce = CAR.pIce * MODE_P[P.mode];
  P.fuelK = MODE_F[P.mode];
  P.fuel0 = s.fuel;
  // worn parts: how much of the performance is left
  P.fw *= 1 - 0.10 * w('frontWing'); P.rw *= 1 - 0.10 * w('rearWing');
  P.pIce *= 1 - 0.14 * Math.pow(w('engine'), 1.6);
  P.floorK = 1 - 0.12 * w('floor');
  P.brakeK = 1 - 0.22 * Math.pow(w('brakes'), 1.5) * ((mods && mods.brakeWear) || 1);
  P.suspK = 1 - 0.04 * w('suspension');
  P.gearK = 1 - 0.04 * w('gearbox');
  P.ersK = 1 - 0.5 * w('battery'); P.ersPK = 1 - 0.3 * w('battery');
  // the designs fitted to the car (the server works them out; stock parts change nothing)
  const m = mods || {}, k = key => (m[key] == null ? 1 : +m[key]);
  P.pIce *= k('pIce'); P.fuelK *= k('fuelK'); P.vmax *= k('vmax'); P.gearK *= k('gearK');
  P.ersPK *= k('ersPK'); P.ersK *= k('ersK'); P.brakeK *= k('brakeK'); P.suspK *= k('suspK'); P.floorK *= k('floorK');
  P.fw *= k('fw'); P.rw *= k('rw'); P.cdw *= k('cdw');
  P.mass = CAR.mass + (+m.mass || 0);
  return P;
}

function muLoad(Fz) { return Math.max(0.55, 1 - 0.10 * (Fz / CAR.Fz0 - 1)); }

// ── The driver ───────────────────────────────────────────────────────────────

const GEAR_RATIOS = [.15,.22,.31,.41,.52,.65,.80,1];

function driverFrom(sk) {
  const g = k => {const v=Math.max(0,sk[k]??50);return (v<=80?v:80+20*(1-Math.exp(-(v-80)/20)))/100;};
  return {
    launchDelay:.12+.95*(1-g('reaction'))**1.8,
    react: 0.26 - 0.18 * g('reaction'),                  // s of delay
    ant: 0.55 + 0.40 * g('reflexes'),                    // how much of the delay he anticipates
    pace: 0.905 + 0.095 * Math.pow(g('pace'), 1.15),
    brakeF: 0.88 + 0.115 * g('braking'), brakeSkill: g('braking'),
    corner: g('cornering'), trac: g('traction'),
    noise: 0.010 + 0.034 * (1 - g('consistency')),
    mistake: 0.03 + 0.22 * (1 - g('focus')),
    compo: g('composure'), care: g('tyreCare'), wet: g('wet'), fit: g('fitness'), fb: g('feedback'),
    reflex: g('reflexes'), shift: (g('reaction') + g('reflexes') + g('feedback')) / 3,
  };
}

// ── The run ──────────────────────────────────────────────────────────────────

export class Run {
  // opts: { track, setup, skills, forecast, startHour, laps (timed), compound, seed, rate }
  constructor(o) {
    this.T = o.track;
    this.setup = o.setup;
    this.hp = o.parts || {};
    this.mods = o.mods || null;
    this.P = prep(o.setup, o.compound, this.hp, this.mods);
    this.race = !!o.race;
    this.startEnergy=clamp(Number(o.energy??100),0,100);
    this.energyCost=Math.max(0,Number(o.energyCost)||0);
    this.lockedSetup = !!o.lockedSetup;
    this.sessionDuration = Math.max(0,Number(o.duration) || 0);
    this.lazy = !!o.lazy;
    this.failPlan = o.fail || null; this.crashPlan = o.crash || null; this.pitPlan = o.pitPlan || [];
    this.compoundNow = o.compound;
    this.drv = driverFrom(o.skills);
    if(o.character){
      const ch=o.character,attack=((ch.aggression??50)-50)/100,patience=((ch.patience??50)-50)/100;
      this.drv.pace*=1+(attack*.012-patience*.008)*(.35+.65*this.drv.corner);
      this.drv.mistake*=1+(attack-patience)*.4*(1-.5*this.drv.compo);
    }
    this.sk = o.skills;
    this.forecast = o.forecast;
    this.startHour = o.startHour;
    this.pushLaps = o.race ? Math.max(0, o.laps - 1) : o.laps;
    this.rand = rng(o.seed || 1);
    this.dt = 1 / 240;
    this.rec = 1 / 30;
    this.recAcc = 0;
    this.t = 0;
    this.frames = [];                    // flat array of Float32 rows
    this.FRAME = 36;
    this.laps = [];                      // finished laps
    this.events = [];                    // {t, type, ...}
    this.done = false;
    this.path = this.T.line; this.pitState = null; this.waiting = null; this.pitChecked = -9;
    this.pitRequest = false; this.decisionReady = false; this.pits = [];
    // what the player decided, so a reloaded page can run the same session again up to where it stopped
    this.inputs = []; this.replay = null;
    this.dnf = null; this.impact = 0; this.failed = null; this.endAt = 0; this.errored = false; this.errorCorner = -1;
    this.penalty = 0; this.lapPen = 0; this.lapPenalised = false; this.lapPitted = false; this.finishT = 0;
    this.serviceEnd = 0;
    this.caution = 0; this.crashes = 0; this.spins = 0; this.sub = null; this.spinT = 0;
    this.metrics = { us: 0, os: 0, usN: 0, lockF: 0, lockR: 0, spin: 0, bottom: 0, cold: 0, hot: 0, maxT: 0, minT: 999 };
    const T = this.T, c0 = condAt(this.forecast, this.startHour);
    // state: start standing 120 m before the line, on the racing line
    this.startIdx = (T.N - Math.round(120 / T.ds) + T.N) % T.N;
    // a race starts on the grid; practice and qualifying leave the pit box and the lane
    const i = this.race ? this.startIdx : T.pit.box;
    if (!this.race) { this.path = T.pit.line; this.pitState = 'out'; }
    if (!this.race) this.path = T.pit.serviceLine;
    const L0 = this.path;
    this.x = L0.x[i]; this.y = L0.y[i]; this.psi = L0.psi[i];
    this.u = 0; this.v = 0; this.r = 0; this.delta = 0;
    this.thr = 0; this.brk = 0;
    this.idx = i;                         // nearest racing-line index
    this.Tt = new Float64Array(4).fill(COMPOUNDS[o.compound].start);
    this.wear = new Float64Array(4);
    // the set on the car, so the wear of each set of a weekend can be handed back
    this.tyreLog = []; this.mount = null;
    if (o.tyreSet) { this.wear.set(mounted(o.tyreSet.wear || [0, 0, 0, 0])); this.mount = { id: o.tyreSet.id, lapAt: 0 }; }
    this.fuel = Math.min(CAR.fuelMax, this.P.fuel0);
    this.ersMax = CAR.ersMax * this.P.ersK; this.pErs = CAR.pErs * this.P.ersPK;
    this.ers = this.ersMax; this.ersDep = 0; this.ersHarv = 0;
    this.ax = 0; this.ay = 0;
    this.dfF = 0; this.dfR = 0;
    this.hF = this.P.rideF; this.hR = this.P.rideR;
    this.fcap = 30000;
    this.usage = [0, 0, 0, 0];
    this.state = 'grid';                  // grid → going → done
    this.lightsOut = this.race ? 5.2 + this.rand() * 1.6 : 2 + this.rand() * 0.5;
    this.launchAt = this.lightsOut + this.drv.launchDelay + (1-this.startEnergy/100)*.18;
    this.lap = -1;                        // -1 pre-lap, 0 out lap, 1..N push laps
    this.lapStart = 0; this.lapValid = true; this.lapMaxN = 0;
    this.sectorT = [0, 0, 0]; this.sectorMark = 0;
    this.prevS = this.sOf(i);
    this.tCross = 0;
    this.kc = new Float64Array(T.line.corners.length).fill(0.95);
    this.cornerDev = new Float64Array(T.line.corners.length);
    this.kbrk = 1;
    this.feel = 1; this.uSm = 0;      // how far the driver trusts the grip right now (1 = fully)
    this.brkAchieved = 0;
    this.ctlAcc = 0;
    this.q = [];                          // command delay line
    this.mistakeAt = -1; this.mistakeAmt = 0;
    this.lapNoise = new Float64Array(T.line.corners.length);
    this.profAt = -99;
    this.damage = 0; this.partDamage = {}; this.swaps = [];   // what a crash did to each part, until the box repairs it
    this.lastLapFlags = {};
    this.bottomT = 0;
    this.lapAcc = { tSum: [0, 0, 0, 0], tMax: [0, 0, 0, 0], n: 0, base: { us: 0, usN: 0, lockF: 0, lockR: 0, spin: 0, bottom: 0 } };
    this._newLapPlan(0);
    this._profile(c0);
    this.condNow = c0;
    this.stuck = 0;
    this.sNow = this.sOf(i);
  }

  sOf(i) { return i * this.T.ds; }

  pitPosition() {
    const T = this.T, i = this.idx, L = T.pit.line;
    const dx = this.x - L.x[i], dy = this.y - L.y[i];
    return { id: this.pitId ?? 0, p: (((i - T.pit.box + T.N * 1.5) % T.N) - T.N / 2) * T.ds + dx * Math.cos(T.psi[i]) + dy * Math.sin(T.psi[i]),
      lane: dx * T.nx[i] + dy * T.ny[i], v: Math.hypot(this.u, this.v), pit: this.pitState, sub: this.sub, done: this.done,
      idx: i, off: (this.x - T.x[i]) * T.nx[i] + (this.y - T.y[i]) * T.ny[i] };
  }
  pitPeers() { return (this.pitSnapshot || []).filter(p => p.id !== (this.pitId ?? 0) && p.pit && !p.done); }
  pitBoxFree() { return !this.pitPeers().some(p => p.sub === 'service' || p.pit === 'out' && p.p > -8 && p.p < 14); }
  pitExitClear() {
    const own = this.pitPosition();
    return !this.pitPeers().some(p => p.lane > -.3 && p.p - own.p > -Math.max(20, p.v * 4 + 8) && p.p - own.p < 24);
  }
  pitSpeedLimit() {
    if (!this.pitState) return Infinity;
    const own = this.pitPosition(); let limit = Infinity;
    for (const p of this.pitPeers()) {
      const gap = p.p - own.p;
      if (gap > 0 && Math.abs(p.lane - own.lane) < 2.4) limit = Math.min(limit, Math.sqrt(p.v * p.v + 8 * Math.max(0, gap - 7)), Math.max(0, p.v + (gap - 7) * .7));
    }
    if (this.pitState === 'out' && own.p < 9 && !this.pitExitClear()) limit = Math.min(limit, Math.sqrt(8 * Math.max(0, 7 - own.p)));
    return limit;
  }

  // Other cars of the group on the track: a driver closing on a slower car moves off the line to
  // pass it on the freer side, and holds back when there is no room, so cars race instead of
  // driving through each other.
  _traffic(bi, V, dt) {
    const T = this.T, N = T.N, me = this.pitId ?? 0, L = this.path, half = T.half - 1.3;
    let want = null, cap = Infinity;
    if (!this.pitState && this.state !== 'grid') for (const p of this.trafficSnap || []) {
      if (p.id === me || p.pit || p.done || p.sub) continue;
      const gap = (((p.idx - bi + N * 1.5) % N) - N / 2) * T.ds;
      if (gap < -7 || gap > 55 || (gap > 0 && p.v > V + 4 && gap > 14)) { if (this.passId === p.id) this.passId = null; continue; }
      if (this.passId !== p.id) { this.passId = p.id; this.passSide = p.off >= L.off[bi] + this.lineErr ? -1 : 1; }
      let side = this.passSide;
      const room = s => s > 0 ? half - L.off[bi] : half + L.off[bi];
      if (room(side) < 2) side = -side;
      const k = Math.abs(L.kap[bi]), ease = 1 / (1 + 150 * k);
      const target = clamp(p.off + side * 2.7 - L.off[bi], -(half + L.off[bi]), half - L.off[bi]) * ease;
      if (want === null || Math.abs(target) > Math.abs(want)) want = target;
      if (gap > 0 && Math.abs(p.off - (L.off[bi] + this.lineErr)) < 2.3) cap = Math.min(cap, Math.max(2, p.v + (gap - 6) * .5));
    }
    const step = 1.8 * dt, to = want ?? 0;
    this.passOff = (this.passOff || 0) + clamp(to - (this.passOff || 0), -step, step);
    return cap;
  }

  // ── the plan for one lap: noise per corner, the odd mistake ──
  fatigue() {
    const progress=this.sessionDuration ? Math.max(0,this.t-this.lightsOut)/this.sessionDuration : Math.max(0,this.lap+this.idx/this.T.N)/(this.pushLaps+1);
    return 1-clamp((this.startEnergy-this.energyCost*clamp(progress,0,1))/100,0,1);
  }

  _newLapPlan(lap) {
    const d = this.drv, n = this.kc.length;
    const push = this.race || lap >= 1;
    this.errored = false;
    const cp = this.crashPlan;
    this.errorCorner = cp && cp.lap === lap && n ? Math.min(n - 1, Math.floor(cp.at * n)) : -1;
    for (let c = 0; c < n; c++) this.lapNoise[c] = gauss(this.rand) * d.noise * (1+.6*this.fatigue());
    this.mistakeAt = -1; this.mistakeAmt = 0;
    if (push) {
      const pressure = (this.race ? (lap === this.pushLaps ? 0.9 : 0.5) : (lap === this.pushLaps ? 0.6 : 0.2)) + (this.crashes ? 0.5 : 0);
      const fat = Math.max(0, lap - (5 + 8 * d.fit)) * 0.04;
      const p = 0.75 * d.mistake * (0.6 + 0.8 * pressure * (1 - 0.75 * d.compo)) + fat + this.fatigue()*.10;
      if (this.rand() < p) { this.mistakeAt = Math.floor(this.rand() * n); this.mistakeAmt = 0.03 + 0.06 * this.rand(); }
    }
    this.lapPaceMul = push ? 1 - Math.max(0, lap - (6 + 8 * d.fit)) * 0.0025 : 0.86;
    if (this.race && lap === 0) this.lapPaceMul = 0.95;
    this.lapPen = 0; this.lapPenalised = false; this.lapPitted = false;
  }

  // ── speed profile along the racing line, for the grip the driver feels now ──
  _profile(c) {
    const T = this.T, L = this.path, N = T.N, P = this.P, d = this.drv;
    const m = this.P.mass + this.fuel;
    const rho = 101325 / (287.05 * (273.15 + c.air)) * (1 - 0.0004 * c.hum);
    const kk = 0.5 * rho * this._cla0() / m;                 // downforce per mass per v²
    const cd = 0.5 * rho * this._cda0() / m;
    // felt grip: tyre now × track × water
    // the weaker axle sets the limit, so a driver on overheated rears slows down
    const mt = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) mt[i] = this._muTyre(this.Tt[i], this.wear[i], i < 2 ? P.pF : P.pR, i < 2 ? P.camF : P.camR, c, 0, 0);
    const muT = Math.min((mt[0] + mt[1]) / 2, (mt[2] + mt[3]) / 2) * 0.5 + (mt[0] + mt[1] + mt[2] + mt[3]) / 8;
    // What the driver believes the tyres can do: always a margin below the real limit, a wider one for
    // a less skilled driver, and more on cold tyres (an out lap is driven carefully).
    const Tavg = (this.Tt[0] + this.Tt[1] + this.Tt[2] + this.Tt[3]) / 4;
    const cold = clamp((P.comp.Topt - 25 - Tavg) / (P.comp.Wd * 1.5), 0, 1);
    const mu = muT * (0.82 + 0.07 * d.corner) * (1 - 0.12 * cold);
    const vTop = Math.min(P.vmax, this._vEq(rho, m));
    const vlat = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const k = Math.abs(L.kap[i]);
      let v = vTop;
      if (k > 1e-5) {
        let vv = 40;
        for (let it = 0; it < 4; it++) {
          const Fz = (m * G + kk * m * vv * vv) / 4;
          const mm = mu * muLoad(Fz) / muLoad(0.5 * m * G / 4 * 2.2);
          const den = k - mm * kk;
          vv = den <= 1e-6 ? vTop : Math.sqrt(mm * G / den);
          vv = Math.min(vv, vTop);
        }
        v = vv;
      }
      vlat[i] = v;
    }
    // per-corner confidence × noise × mistake
    // on a wet or damp track a driver gives away a margin that his wet-weather skill earns back
    const gw = 1 / (1 + Math.pow(c.water / P.comp.d, 1.2));
    const base = d.pace * (.80 + .20*d.corner**3) * this.lapPaceMul * (1 - (1 - gw) * 0.20 * (1.0 - 0.55 * d.wet));
    for (let ci = 0; ci < T.line.corners.length; ci++) {
      const [a, b] = T.line.corners[ci];
      let f = base * (1-.08*this.fatigue()) * this.kc[ci] * (1 + this.lapNoise[ci]);
      if (ci === this.mistakeAt) f *= 1 + this.mistakeAmt;
      for (let i = a - 8; i <= b + 6; i++) {
        const j = ((i % N) + N) % N;
        vlat[j] = Math.min(vlat[j] * f, vTop);
      }
    }
    for (let i = 0; i < N; i++) if (!this._inCorner(i)) vlat[i] = Math.min(vTop, vlat[i] * Math.min(1, base * 1.04));
    const v = Float64Array.from(vlat);
    const ds = L.len / N;
    if (this.pitState) {
      for (let i = 0; i < N; i++) if (T.pit.inLimit(i)) v[i] = Math.min(v[i], T.pit.limit);
      if (this.pitState === 'in') {
        // brake for the box at a comfortable rate and stop on it
        for (let k = 0; k < 40; k++) { const i = ((T.pit.box - k) % N + N) % N; v[i] = Math.min(v[i], Math.sqrt(2 * 7 * Math.max(0, k - 0.25) * ds)); }
      }
    }
    const bias = P.bias;
    // braking capability the driver trusts
    const aBrk = (vv, ay) => {
      const Fz = (m * G + kk * m * vv * vv);
      const mmu = mu * muLoad(Fz / 4) / muLoad(0.5 * m * G / 4 * 2.2) * 1.0;
      const dyn = bias > 0.60 || bias < 0.50 ? 0.93 : 1;
      const lim = mmu * (G + kk * vv * vv);
      const use = Math.min(1, ay / Math.max(lim, 1));
      return (lim * Math.sqrt(1 - use * use) * 0.97 * dyn + cd * vv * vv) * d.brakeF * this.kbrk;
    };
    const aAcc = (vv, ay) => {
      const Fz = (m * G + kk * m * vv * vv);
      const mmu = mu * muLoad(Fz / 4) / muLoad(0.5 * m * G / 4 * 2.2);
      const lim = mmu * (G * 0.55 + kk * vv * vv * 0.60) * 0.92;
      const use = Math.min(1, ay / Math.max(mmu * (G + kk * vv * vv), 1));
      const trac = lim * Math.sqrt(1 - use * use);
      const pw = ((P.pIce + this.pErs * 0.8) / Math.max(vv, 12)) / m;
      return Math.min(trac, pw) - cd * vv * vv - 0.015 * G;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 2 * N - 1; k >= 0; k--) {
        const i = k % N, j = (i + 1) % N;
        const ay = v[j] * v[j] * Math.abs(L.kap[j]);
        const vb = Math.sqrt(v[j] * v[j] + 2 * aBrk(v[j], ay) * ds);
        if (vb < v[i]) v[i] = vb;
      }
      for (let k = 0; k < 2 * N; k++) {
        const i = k % N, j = (i + 1) % N;
        const ay = v[i] * v[i] * Math.abs(L.kap[i]);
        const va = Math.sqrt(v[i] * v[i] + 2 * Math.max(aAcc(v[i], ay), 0.05) * ds);
        if (va < v[j]) v[j] = va;
      }
    }
    this.prof = v;
    this.profTop = vTop;
    this.profAt = this.t;
    this.profMu = mu;
  }

  _inCorner(i) {
    const cs = this.T.line.corners;
    for (let c = 0; c < cs.length; c++) { const [a, b] = cs[c]; if (i >= a - 8 && i <= b + 6) return true; }
    return false;
  }

  _cornerAt(i) {
    const cs = this.T.line.corners, N = this.T.N;
    for (let c = 0; c < cs.length; c++) {
      const [a, b] = cs[c];
      const j = i < a - 12 ? i + N : i;
      if (j >= a - 12 && j <= b + 8) return c;
    }
    return -1;
  }

  _cla0() { return this._claNow || 4.6; }
  _cda0() { return this._cdaNow || 1.1; }
  _vEq(rho, m) {
    let v = 80;
    for (let i = 0; i < 20; i++) {
      const drag = 0.5 * rho * this._cda0() * v * v + 0.015 * m * G;
      v = Math.cbrt(((this.P.pIce + this.pErs * 0.7) * 0.97) / (0.5 * rho * this._cda0()) + 0) * 0.995;
      if (drag > 0) break;
    }
    return v;
  }

  // grip of one tyre in the conditions (everything but the instantaneous slip)
  _muTyre(T, wear, press, cam, c, Fz, surfN) {
    const k = this.P.comp;
    const dT = (T - k.Topt) / k.Wd;
    const gT = 0.78 + 0.22 * Math.exp(-dT * dT);
    const gW = 1 - 0.10 * wear - 0.30 * Math.max(0, (wear - 0.72) / 0.28) ** 2;
    const pHot = press * (273 + T) / (273 + 60);
    const gP = 1 - 0.0016 * (pHot - 25.5) ** 2;
    const camOpt = -3.2;
    const gC = 1 - 0.006 * (cam - (cam === this.P.camR ? camOpt + 1.4 : camOpt)) ** 2;
    const water = c.water;
    const gWater = 1 / (1 + Math.pow(water / k.d, 1.2));
    const g = k.mu * gT * gW * gP * gC * c.rubber * gWater;
    return g;
  }

  // ── the driver's three pedals, 60 times a second ──
  _control(c) {
    const T = this.T, L = this.path, N = T.N, d = this.drv, dt = this.dt;
    // nearest racing-line point to the car
    let best = 1e18, bi = this.idx;
    for (let k = -6; k <= 14; k++) {
      const i = (this.idx + k + N) % N;
      const dx = L.x[i] - this.x, dy = L.y[i] - this.y, dd = dx * dx + dy * dy;
      if (dd < best) { best = dd; bi = i; }
    }
    this.idx = bi;
    const V = Math.hypot(this.u, this.v);
    const lsi = L.len / N;
    // a driver error: the braking point passes and the car goes straight on
    if (this.errorCorner >= 0 && !this.errored && !this.sub && this.state === 'going') {
      const a = T.line.corners[this.errorCorner][0], rel = ((a - bi) % N + N) % N;
      if (rel > 6 && rel < 15) { this.errored = true; this.sub = 'error'; this.events.push({ t: this.t, type: 'error', lap: this.lap, i: bi }); }
    }
    // the pit call: the driver must know before the lane opens
    if (this.path === T.line && !this.pitState && !this.sub && this.state === 'going' && this.lap < this.pushLaps && this.pitChecked !== this.lap) {
      const rel = ((bi - T.pit.decide) % N + N) % N;
      if (rel < 12) {
        if (this.lazy && !this.decisionReady) { this.waiting = 'decide'; return this.cmd || [0, 0, 0]; }
        this.pitChecked = this.lap; this.decisionReady = false;
        const yes = this.lazy ? (this.replay ? this.replay.pit[this.lap] || false : this.pitRequest) : this.pitPlan.includes(this.lap);
        if (this.lazy && yes) this.inputs.push({ k: 'pit', lap: this.lap, ...(yes === 'pass' ? { pass: true } : {}) });
        this.pitRequest = false;
        if (yes) { this.path = yes === 'pass' ? T.pit.fastLine : T.pit.serviceLine; this.pitState = yes === 'pass' ? 'through' : 'in'; this.lapPitted = true; this.events.push({ t: this.t, type: 'pit-in', lap: this.lap }); this._profile(this.condNow); return this.cmd || [0, 0, 0]; }
      }
    }
    if ((this.pitState === 'out' || this.pitState === 'through') && this.path !== T.line && (((bi - T.pit.outB) % N + N) % N) < 12 && ((bi - T.pit.outB) % N + N) % N > 0) {
      this.path = T.line; this.pitState = null; this._profile(this.condNow);
    }
    // the line's offset of the car (signed, left +)
    const ex = this.x - L.x[bi], ey = this.y - L.y[bi];
    const err = -ex * Math.sin(L.psi[bi]) + ey * Math.cos(L.psi[bi]);
    this.lineErr = err;
    // longitudinal: where should the speed be, a little ahead
    const ahead = V * (d.react * (1+.45*this.fatigue()) * (1 - d.ant) + 0.05);
    // Interpolate along the road, rather than jumping to the next 3 m sample.
    // Average the profile gradient over a short distance as well: a single
    // curvature sample must not make the driver stab either pedal.
    const along = ex * Math.cos(L.psi[bi]) + ey * Math.sin(L.psi[bi]);
    const preview = bi + (ahead + along) / lsi, baseIndex = Math.floor(preview);
    const ja = ((baseIndex % N) + N) % N, mix = preview - baseIndex;
    // a car that is sliding gets less commitment from the driver
    {
      const beta = Math.abs(Math.atan2(this.v, Math.max(this.u, 5)));
      const thrB = 0.075 + 0.05 * d.corner;
      if (beta > thrB) this.caution = Math.min(0.22, this.caution + (beta - thrB) * 0.5);
      else this.caution = Math.max(0, this.caution - 0.0035);
    }
    // A driver who feels the tyres beyond their limit (understeer under braking, a loose rear) backs
    // off at once and trusts the grip again once they are comfortable.
    {
      const uu = Math.max(this.usage[0], this.usage[1], this.usage[2], this.usage[3]);
      this.uSm += (uu - this.uSm) * 0.2;
      const gain = 0.6 + 0.8 * d.fb;
      if (V > 12 && this.uSm > 1.12) this.feel = Math.max(0.75, this.feel - (this.uSm - 1.12) * 1.6 * gain * dt);
      else if (this.uSm < 1.12) this.feel = Math.min(1, this.feel + 0.1 * dt);
    }
    let vt = lerp(this.prof[ja], this.prof[(ja + 1) % N], mix) * (1 - this.caution) * this.feel;
    const jb = (ja + 1) % N;
    const gradient = i => (this.prof[(i + 2) % N] ** 2 - this.prof[(i + N - 2) % N] ** 2) / (8 * lsi);
    let aff = lerp(gradient(ja), gradient(jb), mix);
    const pitLimit = this.pitSpeedLimit();
    if (pitLimit < vt) { vt = pitLimit; aff = Math.min(0, aff); }
    const trafficCap = this._traffic(bi, V, dt);
    if (trafficCap < vt) { vt = trafficCap; aff = Math.min(0, aff); }
    let thr = 0, brk = 0;
    const startPhase = this.state === 'grid';
    if (this.sub === 'error') return [0, 0, 0];
    if (this.sub === 'wreck' || this.sub === 'service') return [0, 1, 0];
    if (this.sub === 'spun') return [0, 0.7, 0];
    if (this.sub === 'recovering' || this.sub === 'towed') return [0, 1, 0];
    if (startPhase) { thr = 0; brk = 1; }
    else {
      const m = this.P.mass + this.fuel;
      // Ask for a continuous wheel force: the profile's acceleration plus
      // speed correction and the force needed to overcome drag. Switching
      // between separate speed bands made the driver pump the pedals even
      // with a steady target speed.
      const resistance = 0.5 * (this._rho || 1.2) * (this._cdaNow || 1.1) * V * V + 0.015 * m * G;
      // Profile acceleration assumes travel at the target speed. Reduce its
      // contribution when slower, so an approaching braking zone cannot hold
      // a stationary car on the brakes below its target speed.
      const profileAcc = aff * ((1 - this.caution) * this.feel) ** 2 * Math.min(1, V / Math.max(vt, 1));
      const force = resistance + m * (profileAcc + 1.4 * (vt - V));
      if (force >= 0) thr = clamp(force / Math.max(this._fDrive(V, 1, true), 1), 0, 1);
      else brk = clamp(-force / Math.max(this.fcap * this.P.brakeK, 3000), 0, 1);
    }
    // These are the driver's pedal positions. Tyre torque limits and ABS act
    // on wheel forces in step(), not on the recorded pedal or engine voice.
    // steering: pure pursuit + yaw-rate feedback
    const Ld = 6 + 0.21 * V;
    const jl = (bi + Math.round(Ld / lsi)) % N;
    // Lower skill produces a small, smooth apex placement error, never a teleport.
    const offset = this.pitState ? 0 : .55 * (1-d.corner+this.fatigue()*.35) * Math.sin(bi*.023 + this.lap*.7) + (this.passOff || 0);
    const dx = L.x[jl] - Math.sin(L.psi[jl])*offset - this.x, dy = L.y[jl] + Math.cos(L.psi[jl])*offset - this.y;
    const eta = wrap(Math.atan2(dy, dx) - this.psi);
    let del = Math.atan2(2 * CAR.L * Math.sin(eta), Math.max(Ld, 1));
    const jm = (bi + Math.round(0.5 * Ld / lsi)) % N;
    const rdes = V * L.kap[jm];
    const kr = 0.30 + 0.55 * d.reflex;
    del += kr * (rdes - this.r) * CAR.L / Math.max(V, 12);
    {
      // a loose rear: steer into the slide before it becomes a spin (a quicker driver does it more firmly)
      const ar = Math.atan2(this.v - CAR.L * CAR.wf * this.r, Math.max(this.u, 4)), thrA = 0.11;
      if (Math.abs(ar) > thrA) del += (0.45 + 0.75 * d.reflex) * (ar - Math.sign(ar) * thrA);
    }
    // do not over-steer the fronts past their peak
    const bf = Math.atan2(this.v + (CAR.L * (1 - CAR.wf)) * this.r, Math.max(this.u, 4));
    const aPk = 0.15 * (1.08 + 0.35 * (1 - d.corner));
    del = clamp(del, bf - aPk, bf + aPk);
    del = clamp(del, -0.34, 0.34);
    // The box is a stop, not a speed-profile minimum to accelerate past. In
    // low grip the car can reach it still rolling; keep braking through the
    // final approach until service takes over, regardless of preview speed.
    if (this.pitState === 'in' && !this.sub && this.pitPosition().p >= -1.5) { thr = 0; brk = 1; }
    if (pitLimit < .1) { thr = 0; brk = Math.max(brk, .7); }
    if (this.sub === 'dead') return [0, Math.max(brk, V > 10 ? 0.1 : 0.6), del];
    return [thr, brk, del];
  }

  _fDrive(V, thr, steady = false) {
    const P = this.P;
    if(this.fuel<=0)return 0;
    const pw = P.pIce + (this.ers > 0 && thr > 0.95 && V > 18 && this.ersDep < CAR.ersDepLap ? this.pErs : 0);
    const long = Math.max(0, this.setup.gearing) / 5;
    const engine = Math.min(pw * (1 - 0.12 * long * clamp(1 - V / (0.8 * P.vmax), 0, 1)) * P.gearK / Math.max(V, 6), 27000);
    // Map pedal travel to the usable drive torque. Apply the traction ceiling
    // before pedal travel, and cut torque during a shift without lifting the
    // driver's foot. The inverse used by _control is now the same mapping.
    return Math.min(engine, this.driveGrip ?? engine) * thr * (!steady && this.t < (this.shiftUntil || 0) ? .18 : 1);
  }

  // ── one physics step ──
  step() {
    const dt = this.dt, T = this.T, P = this.P, k = P.comp, m = this.P.mass + this.fuel;
    const hour = this.startHour + this.t / 3600;
    if (((this.t * 4) | 0) !== this._ct) { this._ct = (this.t * 4) | 0; this.condNow = condAt(this.forecast, hour); }
    const c = this.condNow;
    // Shift selection runs once per physics step; force queries remain pure.
    const speed = Math.hypot(this.u,this.v), limits=GEAR_RATIOS;
    this.gear = this.gear || 1;
    const up=this.gear<8 && speed>limits[this.gear-1]*this.P.vmax*.97;
    const down=this.gear>1 && speed<limits[this.gear-2]*this.P.vmax*.90;
    if(up || down){
      if(this.shiftRequested==null)this.shiftRequested=this.t;
      if(this.t-this.shiftRequested>.025+.10*(1-this.drv.shift)+.035*this.fatigue()){
        this.gear+=up?1:-1;this.shiftRequested=null;
        this.shiftUntil=this.t+.025+.045*(1-this.drv.shift);
      }
    }else this.shiftRequested=null;
    if (this.sub === 'recovering' || this.sub === 'towed') { this._recoveryStep(); return; }
    const rho = 101325 / (287.05 * (273.15 + c.air)) * (1 - 0.0004 * c.hum);
    this._rho = rho;
    const V = Math.hypot(this.u, this.v);
    // ── pedals
    this.ctlAcc += dt;
    if (this.ctlAcc >= 1 / 60) {
      this.ctlAcc -= 1 / 60;
      if (this.t - this.profAt > 6) this._profile(c);
      const cmd = this._control(c);
      this.q.push(cmd);
      const dl = Math.max(1, Math.round(this.drv.react * (1+.45*this.fatigue()) * 60 * 0.55));
      const out = this.q.length > dl ? this.q.shift() : this.q[0];
      this.cmd = out;
    }
    const cmd = this.cmd || [0, 1, 0];
    // actuators with their own speed
    const dthr = cmd[0] - this.thr; this.thr += clamp(dthr, -4 * dt, 2.5 * dt);
    const dbrk = cmd[1] - this.brk; this.brk += clamp(dbrk, -4 * dt, 6 * dt);
    const dstr = cmd[2] - this.delta; this.delta += clamp(dstr, -2.4 * dt, 2.4 * dt);
    if (this.state === 'grid') {
      if (this.t >= this.lightsOut && this.t < this.launchAt) { /* reacting */ }
      if (this.t >= this.launchAt) { this.state = 'going'; this.q.length = 0; this.cmd = [0.9, 0, 0]; }
    }
    const thr = this.state === 'grid' ? 0 : this.thr;
    const brk = this.state === 'grid' ? 1 : this.brk;

    // ── aero
    const q = 0.5 * rho * V * V;
    const s = this.setup;
    const hF = Math.max(4, P.rideF - this.dfF / P.kF), hR = Math.max(6, P.rideR - this.dfR / P.kR);
    let ge = 1 + 0.012 * (24 - hF);
    ge = clamp(ge, 0.85, 1.20);
    if (hF < 10) { ge *= Math.max(0.55, 1 - 0.09 * (10 - hF)); if (V > 40) this.bottomT += dt; }
    ge *= 1 + clamp(0.0012 * ((hR - hF) - 40), -0.06, 0.06);
    ge *= (1 - this.damage * 0.08) * P.floorK;
    const floor = 2.55 * ge;
    this._claNow = floor + P.fw + P.rw;
    this._cdaNow = P.cdw + 0.12 * (ge - 1) + 0.0;
    const dfF = q * (floor * 0.38 + P.fw), dfR = q * (floor * 0.62 + P.rw);
    this.dfF += (dfF - this.dfF) * Math.min(1, dt * 14); this.dfR += (dfR - this.dfR) * Math.min(1, dt * 14);
    this.hF = hF; this.hR = hR;
    const drag = q * this._cdaNow;

    // ── vertical loads
    const a = CAR.L * CAR.wf;                   // CG to the rear axle (front axle carries a/L of the weight)
    const b = CAR.L - a;
    const FzF = m * G * (a / CAR.L) + dfF - m * this.ax * CAR.h / CAR.L;
    const FzR = m * G * (b / CAR.L) + dfR + m * this.ax * CAR.h / CAR.L;
    const dLat = m * this.ay * CAR.h / ((CAR.tf + CAR.tr) / 2);
    const Fz = [0, 0, 0, 0];
    Fz[0] = Math.max(60, FzF * 0.5 - P.df * dLat); Fz[1] = Math.max(60, FzF * 0.5 + P.df * dLat);
    Fz[2] = Math.max(60, FzR * 0.5 - (1 - P.df) * dLat); Fz[3] = Math.max(60, FzR * 0.5 + (1 - P.df) * dLat);
    // wheel positions (x forward from CG, y left)
    const wx = [b, b, -a, -a], wy = [CAR.tf / 2, -CAR.tf / 2, CAR.tr / 2, -CAR.tr / 2];

    // ── surface under each wheel
    const ci = this.idx;
    const thT = wrap(this.psi - T.psi[ci]);
    const cx = this.x - T.x[ci], cy = this.y - T.y[ci];
    const nC = cx * T.nx[ci] + cy * T.ny[ci];
    this.nC = nC;
    const cth = Math.cos(thT), sth = Math.sin(thT);
    const surf = [1, 1, 1, 1];
    let outN = 0;
    const inPit = !!this.pitState && T.pit.inLane(this.idx);
    for (let i = 0; i < 4; i++) {
      const nw = nC + wx[i] * sth + wy[i] * cth;
      const an = Math.abs(nw);
      if (inPit && nw < -T.half - 0.5 && nw > -T.half - 11.5) surf[i] = 1;
      else if (an <= T.half) surf[i] = 1;
      else if (an <= T.half + 1.3) surf[i] = 0.93;
      else if (an <= T.half + 14) { surf[i] = c.water > 0.3 ? 0.30 : 0.50; outN++; }
      else { surf[i] = 0.40; outN++; }
    }
    const an0 = Math.abs(nC);
    const outside = an0 - 0.9 > T.half && !(inPit && nC < 0 && an0 < T.half + 11.5);
    if (outside && this.state === 'going' && (this.race || this.lap >= 1)) {
      this.lapValid = false;
      if (this.race) { if (!this.lapPenalised) { this.lapPenalised = true; this.lapPen += 5; this.penalty += 5; this.events.push({ t: this.t, type: 'limits', lap: this.lap, i: this.idx }); } }
      else if (!this.lapLimits) { this.lapLimits = true; this.events.push({ t: this.t, type: 'limits', lap: this.lap, i: this.idx }); }
    }
    const drag2 = outside ? (an0 > T.half + 14 ? 0.45 : 0.18) * m * G : 0;
    if (an0 > T.half + T.runoff && this.sub !== 'wreck') { this._crash(an0); this.t += dt; return; }

    // ── tyres
    const sd = Math.sin(this.delta), cd = Math.cos(this.delta);
    const brakeUse = Math.max(...this.usage), lockLimit = 1 + .04 * (1 - this.drv.brakeSkill);
    const abs = brakeUse > lockLimit ? clamp((lockLimit / brakeUse) ** 3, .25, 1) : 1;
    const brkF = brk * this.fcap * P.brakeK * abs;    // ABS modulates wheel pressure, never pedal travel
    const dLock = P.lock;
    let Fxb = 0, Fyb = 0, Mz = 0;
    const FX = [0, 0, 0, 0], FY = [0, 0, 0, 0], D = [0, 0, 0, 0];
    const dem = [0, 0, 0, 0];
    const eb = (thr < 0.02 && brk < 0.02 && V > 20) ? 2600 * Math.min(1, V / 60) : 0;
    const fb0 = brkF * P.bias * 0.5, fr0 = brkF * (1 - P.bias) * 0.5;
    const dir = this.u >= 0 ? 1 : -1;
    const Tair = c.air, Ttr = c.track;
    let maxUse = 0;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const vwx = this.u - this.r * wy[i], vwy = this.v + this.r * wx[i];
      let lon = vwx, lat = vwy;
      if (front) { lon = vwx * cd + vwy * sd; lat = -vwx * sd + vwy * cd; }
      const alpha = Math.atan2(lat, Math.max(Math.abs(lon), 3));
      const mu0 = this._muTyre(this.Tt[i], this.wear[i], front ? P.pF : P.pR, front ? P.camF : P.camR, c, Fz[i], 0);
      let mu = mu0 * muLoad(Fz[i]) * surf[i] * P.suspK;
      // aquaplaning: a film of water and speed
      if (c.water > 1.0 && V > 55) mu *= 1 - clamp((V - 55) / 90, 0, 0.35) * Math.min(1, c.water / 4);
      const Dn = mu * Fz[i];
      D[i] = Dn;
      const Bf = k.B * (1 - 0.18 * this.wear[i]);
      const Ba = Bf * alpha;
      const fy = -Dn * Math.sin(1.45 * Math.atan(Ba - (-0.3) * (Ba - Math.atan(Ba))));
      FY[i] = fy * Math.min(1, V / 6);
    }
    // The electronic accelerator requests a share of usable rear-axle
    // torque. On a wet road, 100% pedal still obeys the tyre friction budget;
    // traction intervention does not pretend the driver released the pedal.
    const rearBudget = i => Math.sqrt(Math.max(0, D[i] ** 2 - FY[i] ** 2));
    const rearL = rearBudget(2), rearR = rearBudget(3);
    const grip = Math.max(.05 * (D[2] + D[3]), 2 * Math.min(rearL, rearR) * (1 - dLock) + (rearL + rearR) * dLock);
    this.driveGrip = this.driveGrip == null ? grip : lerp(this.driveGrip, grip, Math.min(1, dt / .12));
    const fd = this._fDrive(V, thr);
    dem[0] = -fb0 * dir; dem[1] = -fb0 * dir;
    dem[2] = fd * .5 - (fr0 + eb * .5) * dir; dem[3] = fd * .5 - (fr0 + eb * .5) * dir;
    for (let i = 0; i < 4; i++) FX[i] = dem[i];
    // rear axle: the diff shares what the weaker wheel can take
    {
      const capL = D[2], capR = D[3];
      if (FX[2] + FX[3] > 0) {
        const want = FX[2] + FX[3];
        const wl = capL * (dLock) + Math.min(capL, capR) * (1 - dLock);
        const wr = capR * (dLock) + Math.min(capL, capR) * (1 - dLock);
        const sum = wl + wr;
        const ratio = want > sum ? 1 : want / sum;
        const out = this.r > 0 ? 1 : -1;
        let fl = want * 0.5, fr = want * 0.5;
        // a locked diff passes more of the push to the wheel that can take it
        const sh = dLock * 0.18 * out * clamp(Math.abs(this.r) * 6, 0, 1);
        fl = want * (0.5 - sh); fr = want * (0.5 + sh);
        FX[2] = Math.min(fl, wl) * (want > sum ? 1 : 1); FX[3] = Math.min(fr, wr);
        void ratio;
      }
    }
    for (let i = 0; i < 4; i++) {
      const Dn = D[i];
      let fx = FX[i];
      this.usage[i] = Dn > 1 ? Math.hypot(fx, FY[i]) / Dn : 0;
      if (Math.abs(fx) > Dn) fx = Math.sign(fx) * Dn;
      const use = Dn > 1 ? Math.abs(fx) / Dn : 0;
      const fy = FY[i] * Math.sqrt(Math.max(0, 1 - use * use));
      FX[i] = fx; FY[i] = fy;
      const front = i < 2;
      const fxb = front ? fx * cd - fy * sd : fx;
      const fyb = front ? fx * sd + fy * cd : fy;
      Fxb += fxb; Fyb += fyb;
      Mz += wx[i] * fyb - wy[i] * fxb;
    }
    // bookkeeping for the driver's brake feel (peak capacity of the weaker axle)
    {
      const cf = (D[0] + D[1]) / Math.max(P.bias, 0.2), cr = (D[2] + D[3]) / Math.max(1 - P.bias, 0.2);
      this.fcap += (Math.min(cf * 0.97, cr * 0.86) - this.fcap) * Math.min(1, dt * 60);
    }
    // ── body
    const tot = Fxb - (drag + 0.015 * m * G + drag2) * dir;
    const du = tot / m + this.r * this.v;
    let dvv = Fyb / m - this.r * this.u;
    const dr = (Mz - 900 * this.r * (1 + V * 0.02)) / CAR.Iz;
    this.ax += ((tot / m) - this.ax) * Math.min(1, dt * 18);
    this.ay += ((Fyb / m) - this.ay) * Math.min(1, dt * 18);
    this.u += du * dt; this.v += dvv * dt; this.r += dr * dt;
    if (V < 2.5 && thr < 0.05) { this.v *= 0.9; this.r *= 0.9; }
    this.psi += this.r * dt;
    this.x += (this.u * Math.cos(this.psi) - this.v * Math.sin(this.psi)) * dt;
    this.y += (this.u * Math.sin(this.psi) + this.v * Math.cos(this.psi)) * dt;

    // a part gives up
    if (this.failPlan && !this.failed && this.state === 'going' && this.lap === this.failPlan.lap && this.idx / T.N >= this.failPlan.at) {
      const part = this.failPlan.part; this.failed = part;
      this.events.push({ t: this.t, type: 'failure', part, lap: this.lap, i: this.idx });
      if (part === 'engine' || part === 'gearbox') { this.sub = 'dead'; this.q.length = 0; this.cmd = [0, 0.25, 0]; }
      else if (part === 'brakes') this.P.brakeK = Math.min(this.P.brakeK, 0.3);
      else if (part === 'battery') { this.pErs = 0; this.ers = 0; }
      else if (part === 'suspension') this.P.suspK *= 0.86;
      else this.P.floorK *= 0.8;
    }
    if (this.sub === 'dead' && V < 2.5) this._endRun(this.fuelEmpty?'fuel':'failure');
    if (this.sub === 'error' && V < 4) this.sub = 'spun';
    // arriving at the box, and leaving it
    if (this.pitState === 'in' && !this.sub && V < 0.45) {
      const p = this.pitPosition().p;
      if (p >= -2.5 && p <= 6 && this.pitBoxFree()) { this.sub = 'service'; this.q.length = 0; this.cmd = [0, 1, 0]; this.serviceEnd = 0; this.events.push({ t: this.t, type: 'pit-stop', lap: this.lap }); if (this.lazy) this.waiting = 'service'; else this.service({}); }
    }
    if (this.sub === 'service' && this.serviceEnd && this.t >= this.serviceEnd && this.pitExitClear()) {
      this.sub = null; this.pitState = 'out'; this.q.length = 0; this.cmd = [0.9, 0, 0]; this._profile(this.condNow);
      this.events.push({ t: this.t, type: 'pit-out', lap: this.lap });
    }
    if (this.endAt && this.t >= this.endAt) { const reason=this.dnf; this.dnf=null; this.endAt=0; this._tow(); this.tow.reason=reason; }
    // a car that has turned sideways is spinning; it ends up stopped, then rejoins
    const beta = Math.abs(Math.atan2(this.v, Math.max(Math.abs(this.u), 1)));
    if (!this.sub && this.state === 'going' && V > 6 && (beta > 1.15 || this.u < -3)) {
      this.spinT += dt;
      if (this.spinT > 0.25) { this.sub = 'spun'; this.spins++; this.events.push({ t: this.t, type: 'spin', lap: this.lap, i: this.idx }); this.q.length = 0; this.cmd = [0, 0.7, 0];
        const c = this._cornerAt(this.idx); if (c >= 0) this.kc[c] = Math.max(0.6, this.kc[c] * 0.86); }
    } else if (!this.sub) this.spinT = Math.max(0, this.spinT - dt);
    if (this.sub === 'spun' && V < .6) this._rejoin();
    // A car stranded in gravel also needs a manoeuvre or recovery, even without a spin.
    if (!this.sub && !this.pitState && this.state === 'going' && V < 1) this.stuck += dt;
    else this.stuck = 0;
    if (this.stuck > (outside ? 6 : 12)) this._rejoin();
    // ── thermal, wear, fuel, ERS
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const vwx = this.u - this.r * wy[i], vwy = this.v + this.r * wx[i];
      let lon = vwx, lat = vwy;
      if (front) { lon = vwx * cd + vwy * sd; lat = -vwx * sd + vwy * cd; }
      const slipP = Math.abs(FY[i] * lat) + Math.abs(FX[i]) * Math.abs(lon) * Math.min(0.14, Math.abs(FX[i]) / Math.max(D[i], 1) * 0.12);
      const roll = 0.0016 * Fz[i] * V;
      const pHot = (front ? P.pF : P.pR) * (273 + this.Tt[i]) / 333;
      const heat = (slipP * 0.30 + roll * 3.5) * (front ? 1.55 : 0.98) * k.heat * (1 + 0.035 * (25.5 - pHot));
      const wet = 1 + 2.2 * Math.min(1, c.water / 1.5);
      const cool = (22 + 0.55 * V) * (this.Tt[i] - Tair) * wet + 55 * (this.Tt[i] - Ttr);
      this.Tt[i] += (heat - cool) / 5200 * dt;
      const over = Math.max(0, (this.Tt[i] - k.Topt - 12) / 22);
      const camW = 1 + 0.06 * (Math.abs((front ? P.camF : P.camR)) - 2.5) ** 2 * 0.2;
      const careF = 1.12 - 0.22 * this.drv.care;
      this.wear[i] += slipP * 1.0e-9 * WEAR_SCALE * k.wear * (front ? AXLE_WEAR.front : AXLE_WEAR.rear) * (1 + 2.5 * over * over) * camW * careF * (c.water > 0.5 && P.compKey !== 'I' && P.compKey !== 'W' ? 1.3 : 1) * dt * 240 / 240;
      if (this.wear[i] > 1) this.wear[i] = 1;
      this.lapAcc.tSum[i] += this.Tt[i]; if (this.Tt[i] > this.lapAcc.tMax[i]) this.lapAcc.tMax[i] = this.Tt[i];
      this.metrics.maxT = Math.max(this.metrics.maxT, this.Tt[i]);
      this.metrics.minT = Math.min(this.metrics.minT, this.Tt[i]);
    }
    this.lapAcc.n++;
    if (this.state === 'going') {
      // Fuel and electrical energy follow delivered power, not pedal travel:
      // full pedal on a traction-limited wet road is not full engine power.
      const power = fd * Math.max(V, 6);
      const boost = thr > .95 && V > 18 && this.ers > 0 && this.ersDep < CAR.ersDepLap
        ? Math.min(this.pErs, Math.max(0, power - P.pIce)) : 0;
      const pw = clamp((power - boost) / Math.max(P.pIce, 1), 0, 1);
      this.fuel = Math.max(0, this.fuel - CAR.fuelFlow * pw * P.fuelK * dt * (this.pIceRatio || 1));
      if(this.fuel<=0 && !this.fuelEmpty && this.sub!=='service'){
        this.fuelEmpty=true;this.lapValid=false;this.sub='dead';this.q.length=0;this.cmd=[0,.25,0];
        this.events.push({t:this.t,type:'fuel',lap:this.lap});
      }
      // ERS: harvest on the brakes, deploy flat out
      if (brk > 0.1 && this.ersHarv < CAR.ersHarvLap && V > 25) {
        const hp = Math.min(this.pErs, brk * 200e3) * dt;
        this.ers = Math.min(this.ersMax, this.ers + hp); this.ersHarv += hp;
      } else if (boost > 0) {
        this.ers = Math.max(0, this.ers - boost * dt); this.ersDep += boost * dt;
      }
    }
    // ── driving-feel statistics for the driver's report
    if (this.state === 'going' && V > 25 && Math.abs(this.ay) > 12) {
      const af = Math.atan2(this.v + b * this.r, Math.max(this.u, 4)) - this.delta * 0;
      const slipF = Math.abs(Math.atan2(this.v + b * this.r, Math.max(this.u, 4)) - this.delta);
      const slipR = Math.abs(Math.atan2(this.v - a * this.r, Math.max(this.u, 4)));
      this.metrics.us += slipF - slipR; this.metrics.usN++;
      void af;
    }
    if (this.state === 'going' && brk > 0.6) {
      if ((this.usage[0] + this.usage[1]) * 0.5 > 1.0) this.metrics.lockF += dt;
      if ((this.usage[2] + this.usage[3]) * 0.5 > 1.0) this.metrics.lockR += dt;
    }
    if (this.state === 'going' && thr > 0.6 && Math.max(this.usage[2], this.usage[3]) > 1.0 && V < 70) this.metrics.spin += dt;
    this.sNow = this.idx * T.ds;

    // ── laps and sectors
    this._timing(V);
    this.t += dt;
    this.recAcc += dt;
    if (this.recAcc >= this.rec) { this.recAcc -= this.rec; this._record(V, thr, brk); }
  }

  _timing(V) {
    const T = this.T, N = T.N;
    const i = this.idx;
    const s = i * T.ds;
    const forward = ((s-this.prevS+T.len)%T.len) < T.ds*30;
    const wrapped = forward && s < this.prevS - T.len * 0.5;
    if (this.state === 'going') {
      const frac = s / T.len;
      if (this.lap >= 0) {
        const sec = frac < T.sectors[0] ? 0 : frac < T.sectors[1] ? 1 : 2;
        if (forward && sec === this.sectorMark+1) {
          this.sectorT[this.sectorMark] = this.t - this.sectorStart;
          this.events.push({ t: this.t, type: 'sector', lap: this.lap, sec: this.sectorMark, time: this.sectorT[this.sectorMark] });
          this.sectorStart = this.t;
          this.sectorMark = sec;
        }
      }
      if (wrapped) this._cross();
    }
    this.prevS = s;
  }

  // What the car did during the lap that has just ended, for the engineers' analysis.
  _lapMetrics() {
    const a = this.lapAcc, m = this.metrics, b = a.base, n = Math.max(1, a.n);
    const out = {
      us: (m.us - b.us) / Math.max(1, m.usN - b.usN), lockF: m.lockF - b.lockF, lockR: m.lockR - b.lockR, spin: m.spin - b.spin, bottom: this.bottomT - b.bottom,
      tAvg: a.tSum.map(x => x / n), tMax: a.tMax.slice(),
    };
    a.tSum = [0, 0, 0, 0]; a.tMax = [0, 0, 0, 0]; a.n = 0;
    b.us = m.us; b.usN = m.usN; b.lockF = m.lockF; b.lockR = m.lockR; b.spin = m.spin; b.bottom = this.bottomT;
    return out;
  }

  _cross() {
    const t = this.t;
    if (this.lap >= 0) {
      this.sectorT[this.sectorMark] = t - this.sectorStart;
      this.events.push({ t, type: 'sector', lap: this.lap, sec: this.sectorMark, time: this.sectorT[this.sectorMark] });
      const time = t - this.lapStart;
      let mean = 0, maxT = 0, wear = 0;
      for (let k = 0; k < 4; k++) { mean += this.Tt[k] / 4; wear += this.wear[k] / 4; maxT = Math.max(maxT, this.Tt[k]); }
      this.laps.push({
        n: this.lap, time, t0: this.lapStart, sectors: this.sectorT.slice(),
        valid: this.lapValid && (this.race || this.lap >= 1) && !this.lapPitted && !this.lapPen, pen: this.lapPen, pit: this.lapPitted, compound: this.compoundNow,
        out: !this.race && this.lap === 0, tyreT: Array.from(this.Tt), wear: Array.from(this.wear),
        fuel: this.fuel, from: this.lapStartFrame, to: this.frames.length / this.FRAME,
        topSpeed: this.lapTop || 0, m: this._lapMetrics(),
      });
      this._learn();
    }
    this.lap++;
    this.lapStart = t; this.sectorStart = t; this.sectorMark = 0; this.sectorT = [0, 0, 0];
    this.lapValid = true; this.lapTop = 0;
    this.lapPen = 0; this.lapPenalised = false; this.lapPitted = false; this.lapLimits = false;
    this.lapStartFrame = this.frames.length / this.FRAME;
    this.ersDep = 0; this.ersHarv = 0;
    this.cornerDev.fill(0);
    if (this.lap > this.pushLaps || this.sessionDuration && t >= this.lightsOut + this.sessionDuration) { this.state = 'done'; this.finishT = t; this.done = true; return; }
    this._newLapPlan(this.lap);
    this._profile(this.condNow);
    this.events.push({ t, type: 'lap', lap: this.lap });
  }

  // after a lap the driver adjusts: slower where he ran wide, braver where clean
  _learn() {
    const d = this.drv;
    const rate = 0.6 + 0.8 * d.fb;
    for (let c = 0; c < this.kc.length; c++) {
      const dev = this.cornerDev[c];
      if (dev > 3.2) this.kc[c] = Math.max(0.6, this.kc[c] * (1 - 0.045 * rate * Math.min(2, dev / 3.2)));
      else if (dev < 1.6) this.kc[c] = Math.min(1, this.kc[c] * (1 + 0.012 * rate));
    }
    if (this.brkAchieved > 0) {
      this.kbrk = clamp(this.kbrk + (this.brkAchieved - 1) * 0.5 * rate, 0.75, 1.02);
    }
  }

  _endRun(reason) {
    if (this.dnf) return;
    this.dnf = reason;
    if(this.race){this.done=true;this.u=0;this.v=0;return;}
    this.endAt = this.t + (reason === 'crash' ? 3.0 : 2.0);
    if (reason === 'failure') this.sub = 'wreck';
  }

  // The player decided about the pit call (or ran out of time to): go on.
  resolve() { this.decisionReady = true; if (this.waiting === 'decide') this.waiting = null; }

  // Work at the box: new tyres, wings, brake bias and so on. Returns how long
  // the car stands there.
  service(ch) {
    ch = ch || {};
    if(this.lockedSetup)ch={...(ch.set?{set:ch.set}:ch.compound?{compound:ch.compound}:ch.newTyres?{newTyres:true}:{}),fuel:ch.fuel,swap:ch.swap,mods:ch.mods};
    const added=this.race?0:Math.min(Math.max(0,Number(ch.fuel)||0),CAR.fuelMax-this.fuel);
    if(this.fuel+added<=0)return 0;
    this.fuel+=added;this.fuelEmpty=false;
    const s = Object.assign({}, this.setup);
    let dur = 0.5, tyres = false, wings = 0, bars = 0;
    if (ch.set) { tyres = true; this.compoundNow = ch.set.compound; } else if (ch.compound) { tyres = true; this.compoundNow = ch.compound; } else if (ch.newTyres) tyres = true;
    for (const k of ['frontWing', 'rearWing']) if (ch[k] != null && +ch[k] !== s[k]) { s[k] = +ch[k]; wings++; }
    for (const k of ['brakeBias', 'diff', 'engine']) if (ch[k] != null) s[k] = +ch[k];
    for (const k of ['arbF', 'arbR']) if (ch[k] != null && +ch[k] !== s[k]) { s[k] = +ch[k]; bars++; }
    if (tyres) for (const k of ['pressF', 'pressR', 'camberF', 'camberR']) if (ch[k] != null) s[k] = +ch[k];
    if(ch.swap&&typeof ch.swap==='object'){
      // spare parts of the team's warehouse go on, one by one: a new part is not hurt; the car is as hurt as what is left
      const total=()=>Object.values(this.partDamage).reduce((a,b)=>a+b,0),before=total();
      for(const part in ch.swap){
        const spare=ch.swap[part];dur+=SWAP_SECONDS[part]??10;
        this.swaps.push({part,unit:spare.unit,at:this.laps.length,dmg:Math.round((this.partDamage[part]||0)*1000)/1000});
        delete this.partDamage[part];this.hp={...this.hp,[part]:spare.wear};
      }
      this.damage=before>0?this.damage*total()/before:0;
      if(ch.mods)this.mods=ch.mods;
    }
    dur += (tyres ? 2.0 : 0) + wings * 1.6 + bars * 0.8 + added/2;
    this.setup = s;
    this.P = prep(s, this.compoundNow, this.hp, this.mods);
    if (this.failed === 'brakes') this.P.brakeK = Math.min(this.P.brakeK, 0.3);
    if (this.failed === 'suspension') this.P.suspK *= 0.86;
    if (this.failed === 'battery') this.pErs = 0;
    if (tyres) {
      this.Tt.fill(COMPOUNDS[this.compoundNow].start - 12);
      this._closeMount();
      if (ch.set) { this.wear.set(mounted(ch.set.wear || [0, 0, 0, 0])); this.mount = { id: ch.set.id, lapAt: this.laps.length }; } else this.wear.fill(0);
    }
    this.pits.push({ t: this.t, lap: this.lap, compound: this.compoundNow, tyres, fuel:added, changes: ch });
    if (this.lazy) this.inputs.push({ k: 'svc', t: this.t, ch });
    this.serviceEnd = this.t + dur; this.waiting = null;
    return dur;
  }

  _mountEntry() { return { set: this.mount.id, wear: Array.from(this.wear), laps: this.laps.filter((l, i) => i >= this.mount.lapAt && !l.out).length }; }
  _closeMount() { if (this.mount) { this.tyreLog.push(this._mountEntry()); this.mount = null; } }
  // wear of every set that was on the car, for the weekend's allocation
  tyreLogNow() { return this.mount ? [...this.tyreLog, this._mountEntry()] : this.tyreLog.slice(); }

  raceTime() { return this.finishT ? this.finishT - this.lightsOut + this.penalty : null; }

  // Plan a slow forward or reverse manoeuvre from the actual stopped pose.
  // Reject routes that need an impossible turning radius or cross a barrier.
  _rejoin() {
    this.lapValid = false;
    const T = this.T, N = T.N, origin = { x:this.x,y:this.y,psi:this.psi,prefix:[] };
    const starts=[origin];
    // A turned-around car needs room for a real U-turn before aiming at the
    // racing line. Sample both sides and use only arcs inside the run-off.
    const angle=wrap(T.line.psi[this.idx]-this.psi);
    if (Math.abs(angle) > .8) for (const turn of [angle,angle-Math.sign(angle)*Math.PI*2]) {
      if (Math.abs(turn)>Math.PI*1.4) continue;
      const radius=6.5,sign=Math.sign(turn),prefix=[];let safe=true;
      for(let n=0;n<=48;n++) {
        const a=this.psi+turn*n/48;
        const x=this.x+(Math.sin(a)-Math.sin(this.psi))*radius/sign;
        const y=this.y-(Math.cos(a)-Math.cos(this.psi))*radius/sign;
        let distance=Infinity,idx=this.idx;
        for(let k=-30;k<=40;k++) { const i=(this.idx+k+N)%N,d=Math.hypot(T.x[i]-x,T.y[i]-y);if(d<distance){distance=d;idx=i;} }
        if(distance>T.half+T.runoff-2){safe=false;break;}
        prefix.push({x,y,psi:a,curvature:sign/radius,idx,s:Math.abs(turn)*radius*n/48});
      }
      if(safe){const end=prefix[prefix.length-1];starts.push({...end,prefix});}
    }
    let route = null;
    if (this.damage < .5 && this.fuel > 0 && !['engine', 'gearbox', 'suspension'].includes(this.failed)) {
      for (const start of starts) for (const direction of (start.prefix.length ? [1] : [1,-1])) for (const ahead of [4, 8, 14, 22]) for (const handle of [6, 11, 18]) {
        const i = (this.idx + ahead) % N, heading = T.line.psi[i];
        const end = { x: T.line.x[i], y: T.line.y[i] };
        const a = { x: start.x + Math.cos(start.psi) * handle * direction, y: start.y + Math.sin(start.psi) * handle * direction };
        const b = { x: end.x - Math.cos(heading) * handle * direction, y: end.y - Math.sin(heading) * handle * direction };
        const points = start.prefix.slice(); let length = points.at(-1)?.s || 0, previous = points.at(-1) || null, safe = true;
        for (let n = 0; n <= 100; n++) {
          const u = n / 100, v = 1 - u;
          const x = v*v*v*start.x + 3*v*v*u*a.x + 3*v*u*u*b.x + u*u*u*end.x;
          const y = v*v*v*start.y + 3*v*v*u*a.y + 3*v*u*u*b.y + u*u*u*end.y;
          const dx = 3*v*v*(a.x-start.x) + 6*v*u*(b.x-a.x) + 3*u*u*(end.x-b.x);
          const dy = 3*v*v*(a.y-start.y) + 6*v*u*(b.y-a.y) + 3*u*u*(end.y-b.y);
          const ddx = 6*v*(b.x-2*a.x+start.x) + 6*u*(end.x-2*b.x+a.x);
          const ddy = 6*v*(b.y-2*a.y+start.y) + 6*u*(end.y-2*b.y+a.y);
          const curvature = (dx*ddy-dy*ddx) / Math.max(.001, Math.hypot(dx,dy)**3);
          let nearest = this.idx, distance = Infinity;
          for (let k = -24; k <= 50; k++) {
            const j = (this.idx+k+N)%N, d = Math.hypot(T.x[j]-x,T.y[j]-y);
            if (d < distance) { distance = d; nearest = j; }
          }
          if (Math.abs(curvature) > 1/5.5 || distance > T.half+T.runoff-2 || Math.hypot(dx,dy) < .3) { safe = false; break; }
          if (previous) length += Math.hypot(x-previous.x,y-previous.y);
          const p = { x,y,psi:wrap(Math.atan2(dy,dx)+(direction < 0 ? Math.PI : 0)),curvature,idx:nearest,s:length };
          points.push(p); previous = p;
        }
        if (safe && length > 1 && (!route || length < route.length)) route = { points,length,direction };
      }
    }
    this.q.length = 0; this.cmd = [0,1,0]; this.u = 0; this.v = 0; this.r = 0;
    if (!route) { this._tow(); return; }
    this.sub = 'recovering'; this.recovery = { ...route,s:0,speed:0,cursor:0 };
    this.events.push({ t:this.t,type:'recovering',lap:this.lap });
  }

  _tow() {
    if (this.sub === 'towed') return;
    this.lapValid = false; this.sub = 'towed'; this.waiting = null;
    this.tow = { t:this.t,x:this.x,y:this.y,psi:this.psi,arrived:false };
    this.u = 0; this.v = 0; this.r = 0; this.ax = 0; this.ay = 0; this.thr = 0; this.brk = 1;
    this.events.push({ t:this.t,type:'recovery',lap:this.lap });
  }

  _recoveryStep() {
    const dt = this.dt, T = this.T;
    if (this.sub === 'towed') {
      const elapsed = this.t-this.tow.t;
      if (elapsed >= 15 && !this.tow.arrived) {
        const i=T.pit.box;
        this.x=T.pit.serviceLine.x[i]; this.y=T.pit.serviceLine.y[i]; this.psi=T.pit.serviceLine.psi[i]; this.idx=i;
        this.tow.arrived=true;
        this.events.push({t:this.t,type:'garage',lap:this.lap});
      } else if (elapsed > 9 && elapsed < 14) {
        this.x += Math.cos(this.psi)*3*dt; this.y += Math.sin(this.psi)*3*dt;
      }
      this.u = elapsed > 9 && elapsed < 14 ? 3 : 0;
      if (elapsed >= 18) {
        if(!this.race && !this.aborted && this.tow.reason!=='failure' && !['engine','gearbox','suspension'].includes(this.failed) && !(this.sessionDuration && this.t>=this.lightsOut+this.sessionDuration)){
          this.path=T.pit.serviceLine;this.pitState='in';this.sub='service';this.serviceEnd=0;
          this.lapPitted=true;this.lapValid=false;this.dnf=null;this.endAt=0;this.u=0;this.v=0;this.r=0;
          this.prevS=this.idx*T.ds;this.q.length=0;this.cmd=[0,1,0];this.spinT=0;this.stuck=0;
          this.waiting='service';this.events.push({t:this.t,type:'pit-stop',lap:this.lap});
        }else{this.dnf=this.tow.reason || 'recovery';this.done=true;}
      }
    } else {
      const r=this.recovery;
      const speed=Math.min(2.5,Math.sqrt(Math.max(0,2*(r.length-r.s))));
      r.speed=Math.min(speed,r.speed+dt); r.s=Math.min(r.length,r.s+r.speed*dt);
      while (r.cursor < r.points.length-2 && r.points[r.cursor+1].s < r.s) r.cursor++;
      const a=r.points[r.cursor],b=r.points[r.cursor+1],k=clamp((r.s-a.s)/Math.max(.001,b.s-a.s),0,1);
      this.x=a.x+(b.x-a.x)*k; this.y=a.y+(b.y-a.y)*k; this.psi=a.psi+wrap(b.psi-a.psi)*k;
      this.idx=a.idx; this.u=r.speed*r.direction; this.v=0; this.r=r.speed*a.curvature;
      this.delta=clamp(Math.atan(CAR.L*a.curvature*r.direction),-.5,.5); this.thr=.15; this.brk=0;
      this.lapValid=false; this.fuel=Math.max(0,this.fuel-.001*dt);
      this._timing(r.speed);
      if (r.s >= r.length-.01) {
        this.sub=null; this.spinT=0; this.stuck=0; this.q.length=0; this.cmd=[.3,0,0];
        this.u=0; this.v=0; this.r=0; this.thr=0; this.brk=0;
        this.events.push({t:this.t,type:'rejoined',lap:this.lap});
      }
    }
    const i=this.idx; this.nC=-(this.x-T.x[i])*Math.sin(T.psi[i])+(this.y-T.y[i])*Math.cos(T.psi[i]);
    this.ax=0; this.ay=0; this.t+=dt; this.recAcc+=dt;
    if (this.recAcc >= this.rec) { this.recAcc-=this.rec; this._record(Math.abs(this.u),this.thr,this.brk); }
  }

  _crash(an) {
    const T=this.T;
    // Wall-normal velocity measures the impact; forward speed alone turns a
    // glancing scrape into a terminal crash at ordinary driving speeds.
    const vx=this.u*Math.cos(this.psi)-this.v*Math.sin(this.psi),vy=this.u*Math.sin(this.psi)+this.v*Math.cos(this.psi);
    const normal=Math.abs(vx*T.nx[this.idx]+vy*T.ny[this.idx]);
    this.crashes++;this.impact=Math.max(this.impact,normal);this.lapValid=false;
    this.damage=Math.min(1,this.damage+.12+.65*(normal/40)**2);
    { const k=clamp(normal/32,.12,1); for (const p in CRASH_SPLIT) this.partDamage[p]=Math.min(1,(this.partDamage[p]||0)+CRASH_SPLIT[p]*k); }
    const terminal=normal>32||this.damage>=.85||['engine','gearbox','suspension'].includes(this.failed);
    this.events.push({t:this.t,type:'crash',lap:this.lap,i:this.idx,heavy:terminal,impact:normal});
    this.q.length=0;this.cmd=[0,1,0];
    if(terminal){
      this.damage=Math.max(.85,this.damage);
      this.u=0;this.v=0;this.r=0;this.thr=0;this.brk=1;this.ax=0;this.ay=0;this.sub='wreck';this._endRun('crash');return;
    }
    // A race ends when outside assistance is necessary. Test and qualifying
    // sessions can recover a repairable car to the garage and send it out again.
    this._rejoin();
  }

  _record(V, thr, brk) {
    const T = this.T;
    const f = this.frames;
    const ci = this.idx;
    // lap bookkeeping needing the pose (corner deviation, top speed, braking achieved)
    const cidx = this._cornerAt(ci);
    if (cidx >= 0 && this.lap >= 0) this.cornerDev[cidx] = Math.max(this.cornerDev[cidx], Math.abs(this.lineErr || 0) + (Math.abs(this.nC) > T.half ? 3 : 0));
    this.lapTop = Math.max(this.lapTop || 0, V);
    if (brk > 0.7 && this.state === 'going') {
      const want = this.prof[ci] ;
      void want;
      const cap = this.fcap / (this.P.mass + this.fuel);
      const got = -this.ax;
      this.brkAchieved = this.brkAchieved ? this.brkAchieved * 0.995 + 0.005 * clamp(got / Math.max(cap, 1), 0.5, 1.2) : 1;
    }
    // gear and revs from speed
    const lim = GEAR_RATIOS;
    const g = (this.gear || 1)-1;
    const rpm = 4200 + 8200 * clamp(V / (lim[g]*this.P.vmax), 0.2, 1) ** 1.1;
    f.push(
      this.t, this.x, this.y, this.psi, this.u, this.v, this.r, this.delta, thr, brk,
      this.sub === 'recovering' && this.recovery.direction < 0 ? -1 : g + 1, rpm, this.Tt[0], this.Tt[1], this.Tt[2], this.Tt[3],
      (this.wear[0] + this.wear[1] + this.wear[2] + this.wear[3]) / 4, this.fuel, this.ers / this.ersMax,
      this.ax, this.ay, this.lap, this.idx, Math.abs(this.nC) > T.half + 0.9 && !this.pitState ? 1 : 0,
      this.hF, this.hR, Math.max(this.usage[0], this.usage[1]), Math.max(this.usage[2], this.usage[3]),
      this.condNow.water, this.dfF + this.dfR, this.sub === 'towed' ? 3 : this.sub === 'service' ? 2 : this.pitState ? 1 : 0, this.sectorMark,
      this.wear[0], this.wear[1], this.wear[2], this.wear[3]
    );
  }

  // run until `ms` of wall clock are used or the run is finished
  advance(ms, until) {
    const now = () => (typeof performance !== 'undefined' ? performance : Date).now();
    const t0 = now();
    while (!this.done && !this.waiting && !(until != null && this.t >= until)) {
      for (let k = 0; k < 120 && !this.done && !this.waiting; k++) this.step();
      if (now() - t0 > ms) break;
      if ((this.t > (this.pushLaps + 1) * 170 + 90 + this.pits.length * 60 || this.sessionDuration && this.t>this.lightsOut+this.sessionDuration+180) && this.sub !== 'towed' && !this.dnf) { this.aborted=true; this._tow(); }
    }
    return this.done;
  }

  // Run a stored session again, with the player's decisions, up to `until` seconds.
  // restoreStep() works for `ms` milliseconds at a time and returns true when it has caught up.
  restoreBegin(inputs, until, armed) {
    const pit = {}, svc = [];
    for (const x of inputs || []) { if (x.k === 'pit') pit[x.lap] = x.pass ? 'pass' : true; else if (x.k === 'svc') svc.push(x); }
    this.replay = { pit }; this._rs = { svc, until, armed: armed === 'pass' ? 'pass' : !!armed, guard: 0 };
  }
  restoreStep(ms) {
    const R = this._rs; if (!R) return true;
    const now = () => (typeof performance !== 'undefined' ? performance : Date).now(), t0 = now(), until = R.until;
    let finished = false;
    while (!this.done && R.guard++ < 1e7) {
      if (now() - t0 > ms) return false;
      if (this.waiting === 'decide') { if (until != null && this.t >= until - 1e-9) { finished = true; break; } this.resolve(); continue; }
      if (this.waiting === 'service') {
        const x = R.svc.shift(); if (!x) { finished = true; break; }
        while (!this.done && this.t < x.t - 1e-9) this.step();
        if (this.done) break;
        this.service(x.ch); continue;
      }
      if (until != null && this.t >= until - 1e-9 && !R.svc.length) { finished = true; break; }
      for (let k = 0; k < 240 && !this.done && !this.waiting && !(until != null && this.t >= until - 1e-9 && !R.svc.length); k++) this.step();
    }
    this.replay = null; this.pitRequest = R.armed; this._rs = null;
    return true;
  }

  progress() { return clamp((this.lap + (this.idx / this.T.N)) / (this.pushLaps + 1), 0, 1); }

  // what the driver would tell the engineers
  report() {
    const m = this.metrics;
    const us = m.usN ? m.us / m.usN : 0;
    const out = { dnf: this.dnf, impact: this.impact, failed: this.failed, pits: this.pits.length, penalty: this.penalty, understeer: us, lockF: m.lockF, lockR: m.lockR, spin: m.spin, bottoming: this.bottomT, maxT: m.maxT, minT: m.minT, crashes: this.crashes, fuelLeft: this.fuel, wear: Math.max(...this.wear) };
    return out;
  }
}

// Team practices share one physics clock. No car can simulate through a box
// occupied by a teammate, including while restoring a saved session.
export class RunGroup {
  constructor(runs) {
    this.runs = runs;
    runs.forEach((r, n) => {
      r.pitId = n;
      if (n && r.t === 0 && !r.race) {
        const T = r.T, i = (T.pit.box - Math.round(n * 12 / T.ds) + T.N) % T.N, L = T.pit.serviceLine;
        r.idx = i; r.x = L.x[i]; r.y = L.y[i]; r.psi = L.psi[i]; r.prevS = r.sNow = r.sOf(i);
      }
    });
  }
  step() {
    if (this.runs.some(r => !r.done && r.waiting === 'decide')) return false;
    const snapshot = this.runs.map(r => r.pitPosition());
    for (const r of this.runs) r.pitSnapshot = r.trafficSnap = snapshot;
    for (const r of this.runs) if (!r.done) r.step();
    return true;
  }
  advance(ms, until) {
    const now = () => performance.now(), start = now();
    while (this.runs.some(r => !r.done)) {
      if (this.runs.some(r => !r.done && r.waiting)) break;
      if (until != null && this.runs.filter(r => !r.done).every(r => r.t >= until)) break;
      this.step();
      if (now() - start >= ms) break;
    }
  }
  restoreBegin(records) {
    this.records = this.runs.map((r, i) => {
      const saved = records[i] || { t: 0, inputs: [] };
      r.restoreBegin(saved.inputs || [], saved.t, saved.pass ? 'pass' : saved.armed);
      return r._rs;
    });
    this.until = Math.max(0, ...this.records.map(r => r.until || 0));
  }
  restoreStep(ms) {
    const start = performance.now(); let finished = false;
    while (this.runs.some(r => !r.done)) {
      for (const [i, r] of this.runs.entries()) {
        if (r.waiting === 'decide') r.resolve();
        if (r.waiting === 'service') {
          const next = this.records[i].svc[0];
          if (!next) { finished = true; break; }
          if (r.t >= next.t - 1e-9) { this.records[i].svc.shift(); r.service(next.ch); }
        }
      }
      if (finished || this.runs.filter(r => !r.done).every(r => r.t >= this.until - 1e-9)) break;
      this.step();
      if (performance.now() - start >= ms) return false;
    }
    for (const [i, r] of this.runs.entries()) { r.pitRequest = this.records[i].armed; r.replay = null; r._rs = null; }
    this.records = null; return true;
  }
}

export const FRAME_FIELDS = ['t', 'x', 'y', 'psi', 'u', 'v', 'r', 'delta', 'thr', 'brk', 'gear', 'rpm', 'tFL', 'tFR', 'tRL', 'tRR',
  'wear', 'fuel', 'ers', 'ax', 'ay', 'lap', 'idx', 'off', 'hF', 'hR', 'useF', 'useR', 'water', 'down'];

export const DEFAULT_SETUP = {
  frontWing: 6, rearWing: 6, rideF: 32, rideR: 68, springF: 240, springR: 200, arbF: 5, arbR: 5,
  camberF: -3.2, camberR: -1.8, pressF: 21.5, pressR: 20.5, brakeBias: 59, diff: 40, gearing: 2, engine: 3, fuel: 28,
};

export const DEFAULT_SKILLS = {
  reaction: 62, reflexes: 60, pace: 64, braking: 58, cornering: 62, traction: 56, consistency: 52,
  focus: 55, composure: 50, tyreCare: 55, wet: 50, fitness: 60, feedback: 48,
};
