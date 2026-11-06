// Racelandia - what the levels of the team's specialists change in what the browser shows.
// The server keeps the levels (G.specialists.levels, null = nobody in the role) and everything that
// is paid for or worth money; these helpers only decide how much of the information the team gets.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hash = s => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

// ── meteorologist ─────────────────────────────────────────────────────────
// null: no forecast. Otherwise the half-width of the rain-chance range in points: 30 at level 50 (a 50% chance is shown
// as 20-80%), 0 at level 100. Below 50 only the hourly forecasts are shown; above it the short ones as well.
export const wxHalf = level => (level == null ? null : Math.round(clamp(1.2 * (100 - level), 0, 100) / 2));
export const wxShortOn = half => half != null && half < 30;
export const wxExact = half => half != null && half <= 2;
// The range around a chance: the real value is inside but not always in the middle.
export function wxRange(pct, key, half) {
  if (half == null) return null;
  if (wxExact(half)) return { lo: pct, hi: pct, exact: true };
  const centre = pct + (hash(key) - .5) * half * .6, r5 = v => clamp(Math.round(v / 5) * 5, 0, 100);
  return { lo: r5(centre - half), hi: r5(centre + half), exact: false, mid: clamp(centre, 0, 100) };
}
export const wxText = (pct, key, half) => { const r = wxRange(pct, key, half); return !r ? '—' : r.exact ? r.lo + '%' : r.lo + '–' + r.hi + '%'; };

// ── strategist ────────────────────────────────────────────────────────────
// The relative error of a tyre forecast: 40% without skill, none at level 100. null: no tyre forecast.
export const tyreErr = level => (level == null ? null : .4 * Math.max(0, 100 - level) / 100);
// laps a set lasts until the cliff, as the strategist can tell from the laps driven on it
export function lapsToCliff(note, cliff, err, key) {
  const per = note.wear / note.laps, real = Math.max(1, cliff / Math.max(per, 1e-4));
  const bias = (hash(key) - .5) * 2 * err;
  const centre = real * (1 + bias);
  return { mid: Math.max(1, Math.round(centre)), lo: Math.max(1, Math.floor(centre * (1 - err))), hi: Math.max(1, Math.ceil(centre * (1 + err))) };
}
const PACE = { S: 0, M: .6, H: 1.1 }, PIT = 20;
// The cheapest way to cover the race with the compounds the practice has data for: {compound, laps} in racing order.
export function strategyPlan(notes, raceLaps, cliff, err) {
  const life = {};
  for (const c of ['S', 'M', 'H']) if (notes[c] && notes[c].laps >= 2) life[c] = Math.max(2, Math.floor(lapsToCliff(notes[c], cliff, err, 'plan' + c).mid * .95));
  const kinds = Object.keys(life);
  if (!kinds.length) return null;
  let best = null;
  const tryPlan = seq => {
    if (seq.length > 1 && kinds.length > 1 && new Set(seq).size < 2) return;       // two different compounds, as in the rules
    const total = seq.reduce((a, c) => a + life[c], 0);
    if (total < raceLaps) return;
    // the fastest compounds take as many laps as they can hold, every stint gets at least a few laps
    const order = seq.map((c, i) => ({ c, i })).sort((a, b) => PACE[a.c] - PACE[b.c]);
    const least = 3, laps = seq.map(() => least);
    let remaining = raceLaps - seq.length * least;
    if (remaining < 0) return;
    for (const o of order) { const take = Math.max(0, Math.min(life[o.c] - least, remaining)); laps[o.i] += take; remaining -= take; }
    if (remaining > 0) return;
    const cost = (seq.length - 1) * PIT + seq.reduce((a, c, i) => a + laps[i] * PACE[c], 0);
    if (!best || cost < best.cost) best = { cost, stints: seq.map((c, i) => ({ compound: c, laps: laps[i] })) };
  };
  for (const a of kinds) { tryPlan([a]); for (const b of kinds) { tryPlan([a, b]); for (const c of kinds) tryPlan([a, b, c]); } }
  return best && best.stints;
}

// ── chief mechanic ────────────────────────────────────────────────────────
// null: the research sliders have no coloured zones; otherwise the zone edges are off by up to this share of the slider.
export const zoneErr = level => (level == null ? null : .3 * Math.max(0, 100 - level) / 100);
export const zoneShift = (key, err) => (hash(key) - .5) * 2 * err;

// ── race engineer ─────────────────────────────────────────────────────────
// The suggested ranges of the setup: without an engineer they are twice as wide as the data alone would give, and only a
// very good engineer narrows them well below that (the effect grows quickly above level 50).
export const rangeFactor = level => (level == null ? 2 : 2 - 1.55 * Math.pow(clamp(level, 0, 100) / 100, 2.5));
