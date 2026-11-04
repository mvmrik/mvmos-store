// Run with: node apps/racelandia/tools/test-pit-stop.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../public/sim.js', import.meta.url));
const S = await import('data:text/javascript;base64,' + source.toString('base64'));
const track = S.buildTrack(S.TRACKS.test);
const skills = Object.fromEntries(Object.keys(S.DEFAULT_SKILLS).map(k => [k, 40]));

function makeRun(water, lazy = true) {
  return new S.Run({
    track, setup: { ...S.DEFAULT_SETUP }, skills, forecast: S.dryDay({ water }),
    startHour: 12, laps: 5, compound: water ? 'I' : 'M', seed: 290444083,
    lazy, pitPlan: [0],
  });
}

function driveUntil(run, predicate, limit) {
  while (!predicate() && !run.done && run.t < limit) {
    if (run.waiting === 'decide') { run.pitRequest = true; run.resolve(); }
    run.step();
  }
  assert.ok(predicate(), `Expected pit state before ${limit}s; got ${run.pitState}/${run.sub} at ${run.t}s`);
}

for (const water of [0, 2, 4.6, 6]) {
  const run = makeRun(water);
  driveUntil(run, () => run.waiting === 'service', 600);
  const stopAt = run.t;
  assert.ok(run.events.some(e => e.type === 'pit-in'));
  assert.ok(Math.hypot(run.u, run.v) < .45, 'The service dialog requires a stopped car');
  const offset = ((run.idx - track.pit.box + track.N * 1.5) % track.N) - track.N / 2;
  assert.ok(offset > -3 && offset < 4, 'The car must stop within its box');

  // An old checkpoint may be past the missed stop, with no service decision.
  // It must now restore to the pending dialog rather than skip the pit stop.
  if (water === 4.6) {
    const pending = makeRun(water);
    pending.restoreBegin(run.inputs, stopAt + 400, false);
    while (!pending.restoreStep(100)) {}
    assert.equal(pending.waiting, 'service');
    assert.ok(Math.abs(pending.t - stopAt) < .01);
  }

  // Waiting in the service dialog must hold the car at the box.
  const x = run.x, y = run.y;
  for (let i = 0; i < 240 * 3; i++) run.step();
  assert.equal(run.waiting, 'service');
  assert.ok(Math.hypot(run.x - x, run.y - y) < .3);

  // Tyres and fuel can be changed, then the same run must leave the pit lane.
  const fuel = run.fuel;
  run.service({ compound: 'W', fuel: 4 });
  assert.equal(run.compoundNow, 'W');
  assert.ok(run.fuel > fuel + 3.9);
  driveUntil(run, () => run.pitState === null, run.t + 100);
  assert.equal(run.pits.length, 1);
  assert.ok(run.events.some(e => e.type === 'pit-out'));
  assert.ok(run.u > 1);

  // Reloading the session must replay both the stop and the service decision.
  const restored = makeRun(water);
  restored.restoreBegin(run.inputs, run.t, false);
  while (!restored.restoreStep(100)) {}
  assert.equal(restored.pits.length, 1);
  assert.equal(restored.compoundNow, 'W');
  assert.equal(restored.pitState, null);
  assert.ok(Math.abs(restored.x - run.x) < .1 && Math.abs(restored.y - run.y) < .1);
  console.log(`PASS: water=${water}, stop at ${stopAt.toFixed(2)}s, service, exit and reload`);
}

const automatic = makeRun(4.6, false);
driveUntil(automatic, () => automatic.pits.length === 1 && automatic.pitState === null, 600);
assert.ok(automatic.events.some(e => e.type === 'pit-stop'));
console.log('PASS: automated pit service and exit');
