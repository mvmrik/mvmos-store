// node apps/racelandia/tools/test-tyres-and-straights.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const S = await import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/sim.js', import.meta.url)).toString('base64'));
const T = S.buildTrack(S.TRACKS.test);
const make = extra => new S.Run({ track: T, setup: { ...S.DEFAULT_SETUP, fuel: 60 }, skills: S.DEFAULT_SKILLS,
  forecast: S.dryDay(), startHour: 12, laps: 6, compound: 'M', seed: 1, lazy: true, ...extra });
for (const wear of [[.13,.14,.73,.72],[.73,.72,.13,.14]]) {
  const r = make({ tyreSet: { id: 'used', wear } });
  assert.deepEqual([...r.wear], wear, 'Fitting a used set must not swap its axles');
  r.service({ set: { id: 'pit-used', compound: 'M', wear } });
  assert.deepEqual([...r.wear], wear, 'A pit stop must preserve each tyre position');
}
for (const compound of ['S','M','H','I','W']) {
  const water = compound === 'I' ? .6 : compound === 'W' ? 3 : 0;
  const r = make({ compound, forecast: S.dryDay({ water }) });
  while (!r.done && r.t < 800) { if (r.waiting) r.resolve(); r.step(); }
  assert.ok(r.laps.length >= 4 && !r.crashes, compound + ': session must keep driving');
  const values = [...r.wear], mean = values.reduce((a,b) => a+b,0)/4;
  assert.ok(Math.max(...values) / Math.min(...values) < 2.34, compound + ': runaway wheel wear');
  assert.ok(mean > .01 && mean < .7, compound + ': unreasonable set lifetime');
  console.log(compound, 'wear after', r.laps.length, 'laps:', values.map(v => (v*100).toFixed(1)+'%').join(' / '));
}
const r = make();
r.path = T.line; r.pitState = null;
const targets = [];
for (const lap of [0,1,2]) {
  r.lap = lap; r._newLapPlan(lap); r._profile(r.condNow);
  targets.push([-60,-30,0,30,60].map(m => r.prof[(T.N + Math.round(m/T.ds)) % T.N]));
}
for (let i=0;i<5;i++) assert.ok(Math.abs(targets[0][i]-targets[1][i]) < .2, 'Finish line must not remove an out-lap straight speed limit');
for (const target of targets) assert.ok(Math.max(...target)-Math.min(...target)<.2, 'Clear finish straight must have a continuous speed target');
console.log('PASS: used tyre positions, compound lifetime, balanced wear, continuous finish-straight pace');
