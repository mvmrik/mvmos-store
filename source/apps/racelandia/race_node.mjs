// Server helper: runs the race model of public/race.js (the code the browser plays) over a configuration and
// the pit calls, reading {cfg, commands} from standard input and printing the result. The server uses it to
// settle a race: a full-distance race is slow to replay in Python and fast here, and it is the same engine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
// beside public/ in a development tree, inside public/ when installed from the Store
const dir = fs.existsSync(path.join(here, 'public', 'sim.js')) ? path.join(here, 'public') : here;
const { Race } = await import('data:text/javascript;base64,' + fs.readFileSync(path.join(dir, 'race.js')).toString('base64'));
const { cfg, commands } = JSON.parse(fs.readFileSync(0, 'utf8'));
const race = new Race(cfg, commands);
while (!race.done) race.step();
process.stdout.write(JSON.stringify(race.result()));
