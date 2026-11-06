// Run with: node apps/racelandia/tools/test-track-traffic.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async file => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/' + file, import.meta.url)).toString('base64'));
const S = await load('sim.js');
const definitions = { test: S.TRACKS.test, ...JSON.parse(fs.readFileSync(new URL('../public/tracks.json', import.meta.url))) };

// A faster teammate must get past on an open straight. Order changes at the
// start/finish wrap alone are not evidence that an overtake succeeded.
{
  const T = S.buildTrack(S.TRACKS.test);
  const runs = [0, 1].map(n => {
    const r = new S.Run({ track: T, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
      forecast: S.dryDay(), startHour: 12, laps: 3, compound: 'M', seed: n + 1 });
    const i = T.N - 60 - n * 8, L = T.line;
    Object.assign(r, { t: 10, lap: 1, path: L, pitState: null, state: 'going', idx: i,
      x: L.x[i], y: L.y[i], psi: L.psi[i], u: n ? 50 : 40, v: 0, r: 0, prevS: r.sOf(i) });
    r.Tt.fill(100);
    r.P.vmax = n ? 75 : 45;
    r._newLapPlan(1); r._profile(r.condNow);
    return r;
  });
  const group = new S.RunGroup(runs), [leader, follower] = runs;
  // A car behind the leader must not make the leader start a pass.
  leader.trafficSnap = runs.map(r => r.pitPosition());
  leader._traffic(leader.idx, leader.u, 1 / 60);
  assert.equal(leader.passId, undefined, 'The leader must hold its line for a car behind');
  assert.equal(leader.passOff, 0, 'The leader must not copy the passing car');
  let passed = false;
  for (let k = 0; k < 240 * 10; k++) {
    group.step();
    const gap = (((leader.idx - follower.idx + T.N * 1.5) % T.N) - T.N / 2) * T.ds;
    if (gap < -12 && Math.hypot(leader.x - follower.x, leader.y - follower.y) > 12) passed = true;
  }
  assert.ok(passed, 'A faster teammate must complete a pass on a clear straight');
  assert.ok(runs.every(r => !r.crashes && !r.dnf), 'The pass must finish without a collision');
  console.log('PASS: faster teammate overtakes across the finish line while the leader holds its line');
}
const only = process.argv[2];
for (const [id, def] of Object.entries(definitions)) {
  if (only && id !== only) continue;
  const T = S.buildTrack(def);
  const make = (n, pace) => new S.Run({ track: T, setup: { ...S.DEFAULT_SETUP }, skills: { ...S.DEFAULT_SKILLS, pace, cornering: pace, braking: pace }, forecast: S.dryDay(), startHour: 12, laps: 6, compound: 'M', seed: n + 1, lazy: true });
  const runs = [make(0, 40), make(1, 85)], group = new S.RunGroup(runs);
  let minGap = 1e9, close = 0, swaps = 0, last = 0, onTrack = 0;
  for (let k = 0; k < 240 * 420 && runs.some(r => !r.done); k++) {
    if (!group.step()) { for (const r of runs) if (r.waiting === 'decide') r.resolve(); continue; }
    if (k % 24) continue;
    const [a, b] = runs;
    if (a.pitState || b.pitState || a.done || b.done || a.t < 10) continue;
    onTrack++;
    const d = Math.hypot(a.x - b.x, a.y - b.y); minGap = Math.min(minGap, d); if (d < 2.2) close++;
    const ahead = (((a.idx - b.idx + T.N * 1.5) % T.N) - T.N / 2) > 0 ? 1 : -1;
    if (last && ahead !== last) swaps++; last = ahead;
  }
  console.log(id.padEnd(14), 'min gap', minGap.toFixed(1), 'm; samples <2.2m:', close, '/', onTrack, '; order swaps:', swaps);
  assert.ok(minGap >= 2.19, id + ': car bodies overlap');
  assert.equal(close, 0, id + ': cars drive through each other');
}
console.log('PASS');
