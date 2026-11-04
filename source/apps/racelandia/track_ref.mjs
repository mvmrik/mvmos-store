// Server helper: node track_ref.mjs def.json
// Builds a circuit with the same code the browser uses and measures it: where the start line is
// (the straightest stretch, with room for the pit lane), the best lap a perfect driver manages
// (the reference for lap points and for the cheat floor) and the speed profile the shared race model uses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
// beside public/ in a development tree, inside public/ when installed from the Store
const dir = fs.existsSync(path.join(here, 'public', 'sim.js')) ? path.join(here, 'public') : here;
const S = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(dir, 'sim.js')).toString('base64'));
const def = JSON.parse(fs.readFileSync(process.argv[2]));
if (def.points && def.start == null) {
  const T0 = S.buildTrack({ ...def, start: 0 }), k = Array.from(T0.kappa, Math.abs), N = T0.N;
  const before = Math.round(150 / T0.ds), after = Math.round(90 / T0.ds);
  let best = 1e9, at = 0;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -before; j <= after; j++) s += k[(i + j + N) % N];
    if (s < best) { best = s; at = i; }
  }
  def.start = at;
}
const T = S.buildTrack(def);
const skills = Object.fromEntries(Object.keys(S.DEFAULT_SKILLS).map(x => [x, 100]));
const forecast = S.dryDay();
let bestLap = 1e9;
const crashes = [];
for (const seed of [1, 2, 3, 4]) {
  const run = new S.Run({ track: T, setup: Object.assign({}, S.DEFAULT_SETUP), skills, forecast, startHour: 14, laps: 5, compound: 'M', seed });
  run.advance(1e9);
  for (const l of run.laps) if (l.valid && l.time < bestLap) bestLap = l.time;
  const hit = run.events.find(e => e.type === 'crash');
  if (hit) crashes.push(hit.i / T.N);
}
// the profile is of the racing line: a race starts on the grid, not in the pit lane whose speed limit would otherwise be in it
const run = new S.Run({ track: T, setup: Object.assign({}, S.DEFAULT_SETUP), skills, forecast, startHour: 12, laps: 12, compound: 'M', seed: 1, race: true });
const speeds = Array.from({ length: 180 }, (_, i) => Math.round(run.prof[Math.floor(i * T.N / 180)] * 1000) / 1000);
const lap = speeds.reduce((a, v) => a + T.line.len / 180 / v, 0);
const profile = { length: T.line.len, speeds: speeds.map(v => v * lap / 65), pitIn: T.pit.inA / T.N, pitOut: T.pit.outB / T.N, pitBox: T.pit.box / T.N, sectors: def.sectors || [.34, .68],
  // where the racing line lies across the track and how wide the track is: the race model keeps its cars on the tarmac
  off: Array.from({ length: 180 }, (_, i) => Math.round(T.line.off[Math.floor(i * T.N / 180)] * 100) / 100), half: T.half };
console.log(JSON.stringify({ start: def.start, length: T.len, best: bestLap < 1e8 ? bestLap : null, crash: crashes.length ? crashes.sort((a, b) => a - b)[crashes.length >> 1] : null, profile }));
