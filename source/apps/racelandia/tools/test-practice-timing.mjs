// Run with: node apps/racelandia/tools/test-practice-timing.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(process.argv[2] || new URL('../public/mp.js', import.meta.url), 'utf8');
const timing = await import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/timing.js', import.meta.url)).toString('base64'));
const functions = source.slice(source.indexOf('  function mateRows()'), source.indexOf('  function lapStartOf('));
const host = {innerHTML:''};
const lap = (n, t0, time, extra = {}) => ({n,t0,time,valid:true,...extra});
const make = (key,name,laps) => ({key,name,msg:{compound:'M'},run:{laps,pits:[],events:[],frames:[0,1],FRAME:1}});
const cars = [make('player','Driver A',[lap(1,10,110),lap(2,120,60),lap(3,180,70,{valid:false})]),make('player2','Driver B',[lap(1,10,100)])];
const ctx = vm.createContext({cars,carIdx:0,pb:{t:130,msg:{pid:'room-player'}},board:[{pid:'room-player',best:80}],multi:false,peers:{},simMod:{FRAME_FIELDS:['lap']},
  G:{driver:{name:'Driver A'}},mods:{DIVISION:{focusClassification(){}}},$:()=>host,esc:String,lapStr:x=>x==null?'—':x.toFixed(3),_t:x=>x});
vm.runInContext(functions,ctx);
const render = (i,t) => {
  ctx.carIdx=i;ctx.pb.t=t;
  ctx.pb.msg={pid:'room-player',...cars[i].msg};
  const best=timing.qualifyingTiming(cars[i].run,t,1).bestLap;
  ctx.paintOrder(best);
  return [...host.innerHTML.matchAll(/<b>(\d+)<\/b><span>(.*?)<\/span><strong>(.*?)<\/strong>/g)].map(m=>[Number(m[1]),m[2],m[3]]);
};
for (const t of [0,115,130,179,180,250]) {
  const first=render(0,t);
  for (let i=0;i<10;i++) assert.deepEqual(render(i%2,t),first,'switching cars changes times/order at '+t);
}
assert.deepEqual(render(0,130),[[1,'Driver B','100.000'],[2,'Driver A','110.000']]);
assert.deepEqual(render(1,180),[[1,'Driver A','60.000'],[2,'Driver B','100.000']]);
assert.deepEqual(render(0,0),[[1,'Driver A','—'],[2,'Driver B','—']]);
ctx.multi=true;ctx.board.push({pid:'remote',name:'Remote driver',best:105});
assert.deepEqual(render(1,130),[[1,'Driver B','100.000'],[2,'Remote driver','105.000'],[3,'Driver A','110.000']]);
// A practice payload can omit the lead key, including when the second slot leads.
const initializer=source.slice(source.indexOf('    const mates = [{'),source.indexOf('\n    if (msg.other) mates.push'));
for (const otherKey of ['player','player2']) {
  const lead=vm.runInNewContext(initializer+'; mates[0]',{msg:{other:{key:otherKey},driver:{name:'Lead'}},G:{driver:{name:'Lead'}}});
  assert.notEqual(lead.key,otherKey,'both cars received the same key');
}
console.log('PASS: switching cars preserves times and order; empty/tied times, future/deleted laps, room history, multiplayer and either lead slot');
