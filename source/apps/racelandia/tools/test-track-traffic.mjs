// Run with: node apps/racelandia/tools/test-track-traffic.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async file => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/' + file, import.meta.url)).toString('base64'));
const S = await load('sim.js');
const definitions = { test: S.TRACKS.test, ...JSON.parse(fs.readFileSync(new URL('../public/tracks.json', import.meta.url))) };
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
  assert.ok(close / Math.max(1, onTrack) < 0.02, id + ': cars drive through each other');
}
console.log('PASS');
