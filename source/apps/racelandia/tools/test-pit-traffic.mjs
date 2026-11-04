// Run with: node apps/racelandia/tools/test-pit-traffic.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const load = async file => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/' + file, import.meta.url)).toString('base64'));
const S = await load('sim.js'), { Race } = await load('race.js');
const definitions = { test: S.TRACKS.test, ...JSON.parse(fs.readFileSync(new URL('../public/tracks.json', import.meta.url))) };
for (const [id, definition] of Object.entries(definitions)) {
  const T = S.buildTrack(definition), P = T.pit, i = P.box;
  const lateral = line => (line.x[i] - P.line.x[i]) * T.nx[i] + (line.y[i] - P.line.y[i]) * T.ny[i];
  assert.ok(lateral(P.fastLine) > 1.5 && lateral(P.serviceLine) < -1.5, id + ': separate passing/service routes');
  assert.ok(P.halfWidth - P.lane >= 1.5, id + ': space around a two-metre-wide car');
  for (const box of P.boxes) assert.ok(P.inLimit(box), id + ': boxes remain inside the pit apron');
  for (const line of [P.fastLine, P.serviceLine]) {
    assert.ok([...line.x, ...line.y, ...line.kap].every(Number.isFinite), id);
    for (const j of [(P.inA - 5 + T.N) % T.N, (P.outB + 5) % T.N]) {
      assert.ok(Math.hypot(line.x[j] - T.line.x[j], line.y[j] - T.line.y[j]) < 1e-8, id + ': smooth common entry/exit');
    }
  }
  const run = new S.Run({ track: T, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
    forecast: S.dryDay(), startHour: 12, laps: 5, compound: 'M', seed: 1, lazy: true });
  const j = (P.inB + 5) % T.N;
  run.path = P.serviceLine; run.pitState = 'in'; run.idx = j;
  run.x = run.path.x[j]; run.y = run.path.y[j]; run.psi = run.path.psi[j]; run.u = 8;
  run.state = 'going'; run.lap = 0; run.t = 10; run.prevS = run.sNow = run.sOf(j); run._profile(run.condNow);
  while (!run.done && run.t < 180 && run.waiting !== 'service') run.step();
  assert.equal(run.waiting, 'service', id + ': drive into the actual service bay');
  run.service({ compound: 'H' });
  while (!run.done && run.t < 220 && run.pitState !== null) run.step();
  assert.equal(run.pitState, null, id + ': leave the bay and rejoin the track');
}
console.log(`PASS: passing lane, service route, apron clearance and entry/exit on all ${Object.keys(definitions).length} shipped circuits`);

const T = S.buildTrack(S.TRACKS.test);
const make = n => new S.Run({ track: T, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
  forecast: S.dryDay(), startHour: 12, laps: 5, compound: 'M', seed: n + 1, lazy: true });
const runs = [0, 1, 2].map(make), group = new S.RunGroup(runs);
let firstStop = null, queued = false, passed = false, through = false, complete = false;
for (let k = 0; k < 240 * 500; k++) {
  for (const [i, r] of runs.entries()) {
    if (r.waiting === 'decide') { r.pitRequest = i === 2 ? 'pass' : true; r.resolve(); }
    if (r.waiting === 'service') {
      if (i === 0 && firstStop == null) firstStop = r.t;
      if (i !== 0 || r.t > firstStop + 20) r.service({ compound: 'H' });
    }
  }
  assert.ok(group.step());
  assert.ok(runs.every(r => Math.abs(r.t - runs[0].t) < 1e-9), 'One shared session clock');
  if (runs[0].sub === 'service' && runs[1].pitState === 'in' && runs[1].pitPosition().p > -20) {
    queued = true; assert.notEqual(runs[1].waiting, 'service', 'A teammate cannot use an occupied box');
  }
  if (runs[2].pitState === 'through') through = true;
  if (through && runs[2].pitState === null) passed = true;
  const pit = runs.filter(r => r.pitState && T.pit.inLimit(r.idx)).map(r => r.pitPosition());
  for (let a = 0; a < pit.length; a++) for (let b = a + 1; b < pit.length; b++) {
    assert.ok(Math.abs(pit[a].p - pit[b].p) > 5.5 || Math.abs(pit[a].lane - pit[b].lane) > 2.1, 'Practice cars must not overlap in the pit lane');
  }
  if (runs[0].pits.length && runs[1].pits.length && runs.every(r => r.pitState === null)) { complete = true; break; }
}
assert.ok(complete && queued && passed);
assert.equal(runs[2].pits.length, 0, 'A drive-through never performs service');
const restored = [0, 1, 2].map(make), replay = new S.RunGroup(restored);
replay.restoreBegin(runs.map(r => ({ t: r.t, inputs: JSON.parse(JSON.stringify(r.inputs)), armed: false })));
while (!replay.restoreStep(100)) {}
for (let i = 0; i < runs.length; i++) {
  assert.ok(Math.hypot(restored[i].x - runs[i].x, restored[i].y - runs[i].y) < .001, 'Joint replay must reproduce traffic decisions');
  assert.equal(restored[i].pits.length, runs[i].pits.length);
}
console.log('PASS: teammate queue, passing car, separate service, safe rejoin and deterministic joint reload');

// A ready car must remain in its box during a prolonged blockage, then leave
// when the passing lane clears. No timer may override the safety check.
const held = [0, 1].map(make), hold = new S.RunGroup(held);
for (const [i, r] of held.entries()) {
  const line = i ? T.pit.fastLine : T.pit.serviceLine, j = T.pit.box;
  r.x = line.x[j]; r.y = line.y[j]; r.psi = line.psi[j]; r.idx = j;
  r.t = 5; r.state = 'going'; r.pitState = i ? 'through' : 'in'; r.path = line;
  r.sub = 'service'; r.cmd = [0, 1, 0]; r.serviceEnd = i ? 0 : 4;
}
for (let k = 0; k < 240 * 20; k++) hold.step();
assert.equal(held[0].sub, 'service');
held[1].sub = null; held[1].cmd = [.8, 0, 0];
for (let k = 0; k < 240 * 30 && held[0].sub === 'service'; k++) hold.step();
assert.equal(held[0].pitState, 'out');
console.log('PASS: prolonged blocked release and subsequent safe departure');

const entries = ['player', 'player2', 'passing'].map((id, grid) => ({ id, grid, mine: true, team: grid === 2 ? 'other' : 'own', box_off: grid === 2 ? 24 : 0,
  reaction: 0, compound: 'M', fuel: 100, target: 65, care: .5, pit_lap: 0, pit_times: [{ tyre: grid === 0 ? 20 : 3, repair: 3, both: 20 }] }));
const cfg = { entries, incidents: [], pit_boxes: true, traffic_version: 3, laps: 5, lights: 0, fuel_rate: 0, seed: 1,
  profile: { length: 3000, speeds: Array(200).fill(60), pitIn: .8, pitBox: .94, pitOut: .08, sectors: [.34, .68], half: 6 }, weather: { w0: 0, w1: 0, span: 1000 } };
const commands = [{ t: 0, car: 'player', compound: 'H' }, { t: 0, car: 'player2', compound: 'H' }, { t: 0, car: 'passing', pass: true }];
const race = new Race(cfg, commands), states = []; let raceQueue = false, racePass = false;
for (let n = 0; n < 1400; n++) {
  race.step();
  const [a, b, c] = race.cars;
  if (a.stop_until > race.t && b.pit && b.p > b.box - 30) { raceQueue = true; assert.equal(b.stop_until, 0); }
  if (a.stop_until > race.t && c.pit && c.p > a.p + 6) racePass = true;
  const inPit = race.cars.filter(c => c.pit);
  for (let i = 0; i < inPit.length; i++) for (let j = i + 1; j < inPit.length; j++) {
    const distance = Math.abs(((inPit[i].p - inPit[j].p + 4500) % 3000) - 1500);
    assert.ok(distance > 5.5 || Math.abs(inPit[i].lane - inPit[j].lane) > 2.1, 'Race cars must not overlap in the pit lane');
  }
  if (n % 10 === 0) states.push(race.cars.map(c => [c.p, c.v, c.lane, c.stops, c.pit]));
}
assert.ok(raceQueue && racePass, 'Race cars queue while others pass the occupied box');
assert.equal(race.cars[0].stops, 1); assert.equal(race.cars[1].stops, 1); assert.equal(race.cars[2].stops, 0);
const python = spawnSync('python3', ['-c', `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('engine',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
data=json.load(sys.stdin);r=m.Race(data['cfg'],data['commands']);out=[]
for n in range(1400):
 r.step()
 if n%10==0:out.append([[c['p'],c['v'],c['lane'],c['stops'],c['pit']] for c in r.cars])
json.dump(out,sys.stdout)`, fileURLToPath(new URL('../race_engine.py', import.meta.url))], { input: JSON.stringify({ cfg, commands }), encoding: 'utf8', maxBuffer: 10e6 });
assert.equal(python.status, 0, python.stderr);
const server = JSON.parse(python.stdout);
for (let i = 0; i < states.length; i++) for (let c = 0; c < entries.length; c++) for (let k = 0; k < 5; k++) {
  if (typeof states[i][c][k] === 'boolean') assert.equal(states[i][c][k], server[i][c][k]);
  else assert.ok(Math.abs(states[i][c][k] - server[i][c][k]) < 1e-6, `Browser/server parity at ${i}/${c}/${k}`);
}
console.log('PASS: race queue, drive-through, service and JavaScript/Python engine parity');

// A full field with ten shared team boxes: all twenty cars call on the same
// lap. Stopped neighbours and double stacks must not deadlock the fast lane.
const crowdedEntries = Array.from({ length: 20 }, (_, grid) => ({ ...entries[0], id: 'car' + grid, grid, team: 'team' + Math.floor(grid / 2),
  box_off: (Math.floor(grid / 2) - 5) * 12, pit_times: [{ tyre: grid % 2 ? 3 : 8, repair: 3, both: 8 }] }));
const crowded = new Race({ ...cfg, entries: crowdedEntries }, crowdedEntries.map(e => ({ t: 0, car: e.id, compound: 'H' })));
for (let n = 0; n < 3000 && !crowded.cars.every(c => c.stops === 1 && !c.pit); n++) {
  crowded.step();
  const pit = crowded.cars.filter(c => c.pit);
  for (let a = 0; a < pit.length; a++) for (let b = a + 1; b < pit.length; b++) {
    const distance = Math.abs(((pit[a].p - pit[b].p + 4500) % 3000) - 1500);
    assert.ok(distance > 5.5 || Math.abs(pit[a].lane - pit[b].lane) > 2.1, 'Twenty-car pit traffic must not overlap');
  }
}
assert.ok(crowded.cars.every(c => c.stops === 1 && !c.pit), 'All twenty cars must finish service and leave without deadlock');
console.log('PASS: twenty simultaneous pit calls, ten team boxes, neighbouring stops and double stacks');
