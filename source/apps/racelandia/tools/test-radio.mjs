// Run with: node apps/racelandia/tools/test-radio.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=n=>fs.readFileSync(new URL('../public/'+n,import.meta.url),'utf8');
const load=async n=>import('data:text/javascript;base64,'+Buffer.from(read(n)).toString('base64'));
const {createRadio}=await load('radio.js'),SIM=await load('sim.js');
function run({temp=98,compound='S',water=0,pit=0,wear=.2}={}){
 const frames=[];
 for(let i=0;i<=600;i++){
  const f=Array(36).fill(0);f[0]=i/30;f[4]=30;f[17]=20;f[18]=.5;f[21]=1;f[28]=water;f[30]=pit;
  for(let j=0;j<4;j++){f[12+j]=temp;f[32+j]=wear;}frames.push(...f);
 }
 return {frames,compoundNow:compound,P:{comp:SIM.COMPOUNDS[compound]},pits:[],events:[],laps:[],lightsOut:0,pushLaps:6};
}
function play(r,initial='S',duration){
 const radio=createRadio(),messages=[];
 for(let t=0;t<=20;t+=.5)messages.push(...radio.update({run:r,t,fr:Math.floor(t*30)*36,initialCompound:initial,compounds:SIM.COMPOUNDS,duration,fmt:String,fmtS:String,fmtD:String,part:String}));
 return messages;
}
// Future pit changes must not determine the compound, operating temperature or wet-tyre advice.
let r=run({compound:'W',temp:98,water:.3});r.pits=[{t:30,compound:'W',tyres:true}];
let m=play(r);assert(!m.some(x=>x.key==='tyres_hot'));assert(m.some(x=>x.key==='wrong_wet'));
r=run({compound:'S',temp:58});r.pits=[{t:30,compound:'S',tyres:true}];
m=play(r,'W');assert(!m.some(x=>x.key==='tyres_cold'));assert(m.some(x=>x.key==='wrong_dry'));
m=play(run({temp:50}));assert(m.some(x=>x.key==='tyres_cold'));
m=play(run({temp:50,pit:2,water:.3}));assert(!m.some(x=>['tyres_cold','wrong_wet','lock_front','lock_rear'].includes(x.key)));
const lap=(n,t0,wear,fuel=18)=>({n,t0,time:2,valid:true,wear:[wear,wear,wear,wear],fuel,from:0});
r=run();r.laps=[lap(1,0,.2),lap(2,2,.4),lap(3,4,.66)];
m=play(r);assert.deepEqual(m.filter(x=>x.key.startsWith('wear_')).map(x=>[x.key,x.params.n]),[['wear_mid',40],['wear_high',66]]);
r=run();r.laps=[lap(1,0,.66),lap(2,5,.05),lap(3,10,.4)];r.pits=[{t:4,tyres:true,compound:'S'}];
m=play(r);assert.equal(m.filter(x=>x.key==='wear_mid').length,2,'new tyre set should get its own wear thresholds');
r=run();r.pushLaps=50;r.sessionDuration=6;r.laps=[lap(1,0,.1,15),lap(2,2,.1,10)];
m=play(r);assert(!m.some(x=>x.key==='fuel_tight'),'fixed lap count used instead of remaining session time');
r=run();r.events=[{t:1,type:'sector',lap:1,sec:0,time:30},{t:2,type:'sector',lap:2,sec:0,time:29},{t:2,type:'limits',lap:2}];
m=play(r);assert(!m.some(x=>x.key==='sector_best'),'invalidated sector praised as a best');
for(const lang of ['en','bg','de','es','fr','ja','pt-BR','ru','zh-CN']){
 const window={mvmOS:{lang}};vm.runInNewContext(read('i18n.js'),{window});
 const texts=window._i18n;
 for(const key of ['ap_rd_tyres_cold_1','ap_rd_tyres_cold_2','ap_rd_fuel_plenty','ap_rd_wear_high_1'])assert(texts[key]);
 assert(texts.ap_rd_fuel_plenty.includes('{n}'));
}
console.log('PASS: playback compounds/temperatures, cold soft tyres, pit suppression, wear thresholds/new sets, timed-session fuel, invalid sectors and nine languages');
