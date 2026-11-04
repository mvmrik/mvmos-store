// Run with: node apps/racelandia/tools/test-driving-inputs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async name => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/' + name, import.meta.url)).toString('base64'));
const S = await load('sim.js');
const { updateDrivingMeters } = await load('division.js');
const track = S.buildTrack(S.TRACKS.test);

function command(speed, acceleration = 0, usage = 0, rounds = 1) {
  const run = new S.Run({ track, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
    forecast: S.dryDay(), startHour: 12, laps: 2, compound: 'M', seed: 1 });
  const i = track.N - 80, line = track.line;
  run.path = line; run.pitState = null; run.state = 'going'; run.idx = i;
  run.x = line.x[i]; run.y = line.y[i]; run.psi = line.psi[i]; run.u = speed;
  run.prof.fill(40);
  const ahead = speed * (run.drv.react * (1 - run.drv.ant) + .05);
  const ja = (i + Math.round(ahead / (line.len / track.N))) % track.N;
  for (let n = -8; n <= 8; n++) {
    run.prof[(ja + n + track.N) % track.N] = Math.sqrt(Math.max(0, 1600 + 2 * acceleration * n * line.len / track.N));
  }
  run.usage.fill(usage);
  let result;
  for (let n = 0; n < rounds; n++) result = run._control(run.condNow);
  return result;
}

// Matching today's speed on an accelerating profile still needs power.
const steady = command(40), accelerating = command(40, 3);
assert.ok(accelerating[0] > steady[0] + .1, 'Acceleration demand must reach the throttle at the target speed');
assert.equal(accelerating[1], 0);
assert.ok(command(40.4, 3)[0] > 0, 'A rising target must not trigger a brake jab');
assert.equal(command(40.4, 3)[1], 0);
assert.ok(command(40, -3)[1] > .01, 'A falling speed profile requires braking');
assert.ok(command(40, -3, 2)[1] >= command(40, -3)[1] * .99, 'ABS wheel-pressure cuts must not appear as pedal movement');
assert.equal(command(0, -100)[1], 0, 'A future braking zone must not hold a stationary car below its target speed');
assert.ok(command(0, 0, 1, 120)[0] > .99, 'Normal full tyre utilization must not ratchet the throttle down');

// Crossing the old speed-band boundaries must not jump between pedal modes.
for (const boundary of [39.85, 40.35]) {
  const left = command(boundary - .001), right = command(boundary + .001);
  assert.ok(Math.abs(left[0] - right[0]) < .005, 'Throttle demand must be continuous');
  assert.ok(Math.abs(left[1] - right[1]) < .005, 'Brake demand must be continuous');
}
console.log('PASS: continuous throttle/brake demand, acceleration and deceleration');

const torque = new S.Run({ track, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
  forecast: S.dryDay(), startHour: 12, laps: 2, compound: 'M', seed: 1 });
torque.driveGrip = 2000;
assert.equal(torque._fDrive(5, .5), 1000, 'Half pedal requests half the usable torque, including at low speed');
torque.shiftUntil = 1;
assert.equal(torque._fDrive(5, 1, true), 2000, 'Gear torque cuts do not change the driver demand');
assert.equal(torque._fDrive(5, 1), 360, 'The drivetrain still cuts delivered torque during a shift');
console.log('PASS: traction-limited pedal/torque mapping and separate gear torque cuts');

// Reusing the HUD after pause, seek or switching cars must show that sample,
// without retaining a filtered value from a different moment or driver.
const nodes = new Map();
const host = { querySelector(selector) {
  if (!nodes.has(selector)) nodes.set(selector, { style: {}, textContent: '' });
  return nodes.get(selector);
} };
for (const [thr, brk] of [[1, 0], [0, 1], [.42, .18], [0, 0], [1, 1], [2, -1]]) {
  updateDrivingMeters(host, { rpm: 12400, thr, brk });
  for (const [name, input] of [['throttle', thr], ['brake', brk]]) {
    const value = Math.max(0, Math.min(1, input)) * 100;
    assert.equal(nodes.get('[data-hud-' + name + ']').style.width, value + '%');
    assert.equal(nodes.get('[data-hud-' + name + '-value]').textContent, Math.round(value) + '%');
  }
}
updateDrivingMeters(host, { rpm: 12400, thr: 0, brk: 0 });
assert.equal(nodes.get('[data-hud-throttle]').style.width, '0%', 'RPM must not substitute for pedal travel');
console.log('PASS: direct independent 0–100% pedal telemetry, pause/seek/car switches and clamping');

// Run the physics, not just the meter formatter. The old controller passed
// static gauge checks while pumping the brake on every approach to a corner.
for (const water of [0, 5.2]) {
  const run = new S.Run({ track, setup: { ...S.DEFAULT_SETUP }, skills: S.DEFAULT_SKILLS,
    forecast: S.dryDay({ water }), startHour: 12, laps: 5,
    compound: water ? 'W' : 'M', seed: 290444083, lazy: true });
  const samples = []; let next = 0;
  while (!run.done && run.t < 400) {
    if (run.waiting === 'decide') run.resolve();
    run.step();
    if (run.t >= next) {
      next += .1;
      if (run.t > 10 && !run.pitState && !run.sub) samples.push({ thr: run.thr, brk: run.brk, ax: run.ax, speed: Math.hypot(run.u, run.v) });
    }
  }
  const reversals = key => {
    const delta = samples.slice(1).map((s, i) => s[key] - samples[i][key]);
    return delta.slice(1).filter((v, i) => v * delta[i] < 0 && Math.abs(v) > .015 && Math.abs(delta[i]) > .015).length;
  };
  assert.ok(run.laps.length >= 2 && !run.dnf, 'Both wet and dry sessions must keep driving');
  // the racing line turns in earlier and more gently than the old shortest path, so the pedals are modulated a little more
  assert.ok(reversals('brk') <= 80, 'Repeated brake pumping must not return');
  assert.ok(reversals('thr') <= 50, 'Repeated throttle pumping must not return');
  const accelerating = samples.filter(s => s.ax > 1 && s.speed > 8 && s.brk < .01);
  const mean = accelerating.reduce((sum, s) => sum + s.thr, 0) / accelerating.length;
  assert.ok(mean > .5, 'Sustained acceleration must not be represented by near-zero pedal travel');
  if (water) assert.ok(run.fuel > 26, 'Traction-limited full pedal must not consume full-power fuel');
  for (let i = 0; i < run.frames.length; i += run.FRAME) {
    assert.ok(run.frames[i + 8] >= 0 && run.frames[i + 8] <= 1);
    assert.ok(run.frames[i + 9] >= 0 && run.frames[i + 9] <= 1);
  }
  console.log(`PASS: 400s ${water ? 'wet' : 'dry'} driving, ${reversals('brk')} brake reversals, ${(mean * 100).toFixed(0)}% mean accelerating pedal`);
}
