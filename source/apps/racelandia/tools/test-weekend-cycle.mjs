// Start test-ui-server.py first. Exercises real APIs against its temporary DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = async file => import('data:text/javascript;base64,' + fs.readFileSync(new URL('../public/'+file,import.meta.url)).toString('base64'));
const S=await load('sim.js'),R=await load('race.js');
const catalog=JSON.parse(fs.readFileSync(new URL('../public/tracks.json',import.meta.url)));
const base=process.env.UI_TEST_URL||'http://127.0.0.1:2187';
const get=async path=>{const r=await fetch(base+path,{headers:{Connection:'close'}});assert.equal(r.status,200,path);return r.json()};
const post=async(path,body)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify(body)});assert.equal(r.status,200,path+': '+await r.clone().text());return r.json()};
const send=async msg=>{const messages=await post('/test/message',msg);assert.ok(!messages.some(m=>m.type==='ap_err'),JSON.stringify(messages));return messages};
const choose=sets=>sets.find(t=>t.compound==='M'&&Math.max(...t.wear)<.8)||sets.find(t=>Math.max(...t.wear)<.8);
const report=r=>({duration:r.finishT?r.finishT-r.lightsOut:r.t-r.lightsOut,laps:r.laps.map(l=>({time:l.time,valid:l.valid,out:l.out,sectors:l.sectors,pen:l.pen,pit:l.pit,invalidated:r.events.some(e=>e.lap===l.n&&['limits','crash','recovering','recovery','fuel'].includes(e.type))})),dnf:r.dnf,impact:r.impact,failed:r.failed,spins:r.spins,bottoming:r.bottomT,race_time:r.raceTime(),pits:r.pits.map(p=>({compound:p.compound,tyres:p.tyres})),final_setup:r.setup,damage_parts:r.partDamage,swap_log:r.swaps,tyre_log:r.tyreLogNow()});
async function drive(payload){
 if(payload.race_config){
  const commands=[],asked=new Set(),race=new R.Race(payload.race_config);
  while(!race.done&&race.t<payload.race_config.max_time+1){
   for(const c of race.cars.filter(c=>c.e.mine))if(c.laps>=Math.floor(payload.laps*.45)&&!asked.has(c.e.id)&&!c.dnf){
    const set=payload.entries[c.e.id].tyres.find(t=>t.compound==='H'&&t.id!==payload.entries[c.e.id].tyre_set.id);
    if(set){const t=Math.round(race.t*10)/10,command={t,compound:set.compound,set:set.id,...(c.e.id!=='player'?{car:c.e.id}:{})};
     const ack=(await send({type:'ap_pit',at:t,compound:set.compound,set:set.id,car:c.e.id})).find(m=>m.type==='ap_pit_ok');assert.ok(ack?.ok,'Paid pit choice rejected');
     commands.push(command);race.commands.push(command);asked.add(c.e.id);
    }
   }
   race.step();
  }
  assert.ok(race.done,'Race did not finish');
  return {race_commands:commands,duration:race.t-payload.race_config.lights,classification:race.result().classification};
 }
 const track=S.buildTrack(catalog[payload.track]);
 const entries=[payload,...(payload.other?[{...payload,...payload.other}]:[])];
 const runs=entries.map(m=>new S.Run({track,setup:m.setup,skills:m.skills,forecast:payload.forecast,startHour:payload.hour_frac??payload.hour,laps:payload.laps,compound:m.compound,seed:m.seed,mods:m.mods,character:m.character,tyreSet:m.tyre_set,energy:m.start_energy,energyCost:payload.energy,duration:payload.duration,parts:m.parts,fail:m.fail,crash:m.crash,lazy:true}));
 const group=new S.RunGroup(runs);while(runs.some(r=>!r.done)&&runs[0].t<Math.max(2400,(payload.duration||0)+600)){for(const r of runs){if(r.waiting==='decide')r.resolve();if(r.waiting==='service')r.service({fuel:30})}group.step();}
 assert.ok(runs.every(r=>r.done),'Practice/qualifying failed to complete');
 return {...report(runs[0]),...(runs[1]?{other:report(runs[1])}:{})};
}
let g=await get('/test/fixture');const setup={...g.tracks[0].setup,fuel:90};
// A standalone practice uses independent cars and independent warehouse sets.
await post('/pub/racelandia/team/select-car',{id:g.team.cars[0].id});
await send({type:'ap_cfg',laps:2,hour:12});
const sets=g.warehouse.tyres.filter(t=>t.compound==='M');
const practiceStarted=Date.now();
let payload=(await send({type:'ap_run',kind:'practice',track:'baku',setup,setup2:{...setup,fuel:80},compound:'M',tyre_set:sets[0].id,tyre_set2:sets[1].id,both:true})).find(m=>m.type==='ap_go');
assert.ok(payload?.other,'Both cars must start practice');
const practiceReport=await drive(payload);
await new Promise(resolve=>setTimeout(resolve,Math.max(0,(practiceReport.laps.reduce((sum,l)=>sum+l.time,0)/90-1.8)*1000-(Date.now()-practiceStarted))));
let result=(await send({type:'ap_result',session:payload.session,...practiceReport})).find(m=>m.type==='ap_summary');
assert.ok(result&&!result.cheat,'Practice results failed validation');console.log('PASS: both practice cars complete and settle into the real backend');
await post('/test/recover',{});await send({type:'ap_division_enter'});
for(const phase of ['fp1','fp2','fp3','qualifying','race']){
 // Practice/qualifying slots can advance separately; finish both before the race.
 for(let attempt=0;attempt<2;attempt++){
  await post('/test/recover',{});g=await get('/test/fixture');assert.equal(g.division.phase,phase);
  const slot=g.division.slots.find(s=>s.stage===g.division.stage);assert.ok(slot);
  await post('/pub/racelandia/team/select-car',{id:slot.car_id});g=await get('/test/fixture');
  const a=choose(g.division.tyres),b=choose(g.division.slots.find(s=>s.key!==g.division.slot).tyres);
  await post('/pub/racelandia/setup',{track:g.division.calendar[g.division.round-1].track,setup});
  payload=(await send({type:'ap_run',kind:'d5_'+phase,setup,compound:a.compound,tyre_set:a.id,tyre_set2:b.id,track:g.division.calendar[g.division.round-1].track})).find(m=>m.type==='ap_go');assert.ok(payload,'No session payload');
  const driven=await drive(payload);result=(await send({type:'ap_result',session:payload.session,...driven})).find(m=>m.type==='ap_summary');
  assert.ok(result&&!result.cheat,phase+': result failed validation');
  const after=await get('/test/fixture');
  console.log('PASS:',phase,'car results:',Object.keys(result.cars||{}).join(',')||g.division.slot,'round',after.division.round,'next',after.division.phase);
  if(after.division.round>1||after.division.phase!==phase)break;
 }
}
g=await get('/test/fixture');assert.equal(g.division.round,2);assert.equal(g.division.results[0].classification.length,20);assert.equal(g.career.active_session,null);
console.log('PASS: complete two-car practice, three weekend practices, qualifying, 20-car race and next-round persistence');
