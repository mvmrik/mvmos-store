/* Fixed-step solo field model. Keep the arithmetic in sync with race_engine.py. */
const PIT_LANE=1.6;   // the fast lane of the pit lane is this far from its centre on one side, the working lane at the garages on the other
const DT=.1, TYRES={S:[1.018,.000015],M:[1,.000009],H:[.986,.000005],I:[.91,.000011],W:[.86,.000008]};
// Water on the track: speed is scaled by 1/sqrt(1+(water/WD)^1.2). Keep in sync with race_engine.py.
const WD={S:.7,M:.7,H:.7,I:2.2,W:4.5};
export function waterAt(cfg,t){const w=cfg.weather||{},u=Math.min(1,Math.max(0,(t-cfg.lights)/Math.max(1,w.span??840)));return (w.w0||0)+((w.w1||0)-(w.w0||0))*u;}
const waterFactor=(c,w)=>w>0?1/Math.sqrt(1+(w/WD[c])**1.2):1;
// The time a car stands in its box: the stop of its crew, fixed in advance for every stop it can make. Keep in sync with race_engine.py.
// What it takes the crew to fit one spare part, in seconds (mirrored in race_engine.py and sim.js).
export const SWAP_SECONDS={frontWing:4,rearWing:4,floor:10,suspension:10,brakes:8,battery:8,engine:15,gearbox:15};
export const serviceSeconds=service=>Object.keys(service||{}).reduce((a,p)=>a+(SWAP_SECONDS[p]??10),0);
export function pitDuration(e,stops,tyres,wing,service){const table=e.pit_times,hasTable=table&&table.length;if(service&&Object.keys(service).length){if(!hasTable)return (tyres?2.8:.8)+serviceSeconds(service);const row=table[Math.min(stops,table.length-1)];return (tyres?row.tyre:.8)+serviceSeconds(service);}if(!hasTable)return (tyres?2.8:.8)+(wing?6:0);const row=table[Math.min(stops,table.length-1)];return tyres&&wing?row.both:tyres?row.tyre:row.repair;}
const mod=(a,b)=>((a%b)+b)%b,round=(a,n=4)=>Math.round((a+Number.EPSILON)*10**n)/10**n;
export function raceGap(leader,car,length){
  const distance=Math.max(0,leader.p-car.p);
  return {laps:Math.floor(distance/length+1e-9),seconds:distance/Math.max(20,leader.v)};
}
// Stable passing intentions and following distances in track coordinates.
// Keep this arithmetic mirrored in race_engine.py.
// How far either side of the racing line a car may be, so that it stays inside the track.
function laneLimits(P,frac){
  const lo=P.off?P.off[Math.min(P.off.length-1,Math.trunc(frac*P.off.length))]:0,room=(P.half||6)-1.3;
  return [-room-lo,room-lo];
}
// How much of the straight is left before the speed plan drops for a corner: a pass needs that much room.
function passRoom(P,frac,L){
  const n=P.speeds.length,i0=Math.trunc(frac*n)%n,v0=P.speeds[i0],seg=L/n;
  // no passing in the slow part of the lap: a pass is made on the fast stretches
  const vmax=P._vmax||(P._vmax=Math.max(...P.speeds));
  if(v0<.6*vmax)return 0;
  for(let k=1;k*seg<700;k++)if(P.speeds[(i0+k)%n]<.8*v0)return k*seg;
  return 700;
}
// A repeatable pseudo-random number from a text (the same in the browser and on the server).
// The recovery truck is a calculation, not something seen on the track (mirrored in race_engine.py): it leaves the pit box,
// drives to the car at 50 km/h by the shorter way round, hooks it and brings it back. Meanwhile the field runs behind the
// safety car; if that has gone a lap and the car is still on the track, the race is stopped (red flag), the cars line up
// at the pit lane and, when the truck is back, restart behind the safety car to the finish line.
const TOW_SPEED=50/3.6,TOW_DISPATCH=10,TOW_HOOK=20,SC_SPEED=26;
function hash01(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}h^=h>>>13;h=Math.imul(h,1274126177);h^=h>>>16;return (h>>>0)/4294967296;}
function trafficPlan(c,states,L,target,base,neutral,launch,personal=false,room=1e9,lim=[-99,99]){
  const ch=c.e.character||{},attack=(ch.aggression??50)/100,defence=(ch.defence??50)/100,patience=(ch.patience??50)/100,craft=Math.max(0,Math.min(1,c.e.racecraft??.5));
  const own=c.e.id,peers=states.filter(a=>a.id!==own&&!a.dnf&&a.finish===null&&a.pit===c.pit);
  const longitudinal=a=>mod(a.p-c.p+L/2,L)-L/2;
  const safe=lane=>peers.every(a=>{
    const d=longitudinal(a),room=(c.pit?5.8:8)+Math.abs(c.v-a.v)*.3;
    return Math.abs(d)>=room||a.lane<Math.min(c.lane,lane)-2.2||a.lane>Math.max(c.lane,lane)+2.2;
  });
  let yielding=null;
  if(personal&&!neutral&&!c.pit){
    yielding=peers.find(a=>a.id===c.blue_for&&a.p-c.p>L*.5&&longitudinal(a)>-180&&longitudinal(a)<12)||null;
    if(!yielding)yielding=peers.filter(a=>a.p-c.p>L*.5&&longitudinal(a)<0&&longitudinal(a)>-140&&a.v>=c.v-.3).sort((a,b)=>Math.abs(longitudinal(a))-Math.abs(longitudinal(b)))[0]||null;
  }
  if(personal){if(yielding&&c.blue_for!==yielding.id)c.yield_lane=yielding.lane>.5?-2.8:2.8;c.blue_for=yielding?.id||null;}
  let lane=launch?(c.e.grid%2===0?-1.4:1.4):0;
  if(c.pit){lane=c.pit_lane??0;c.pass_id=null;if(Math.abs(lane-c.lane)>.1&&!safe(lane)){lane=c.lane;if(c.serviced)target=0;}}
  else if(neutral){c.pass_id=null;if(!safe(lane))lane=c.lane;}
  else if(yielding){
    c.pass_id=null;c.defend_id=null;
    lane=c.yield_lane;
    if(!safe(lane))lane=c.lane;
    target*=.82;
  }
  else {
    // Every car drives its racing line. It leaves it only to pass, and only if it judges the pass can work: the car
    // ahead is clearly slower, there is enough straight left to get by, and the side is free and inside the track.
    // How it judges is his own: a bold driver accepts less room, a patient one more, and the less racecraft he has the
    // worse his estimate. The judgement can be wrong, and then the pass fails and he drops back in line.
    const reach=personal?30+attack*25:45;
    const judge=a=>{
      const closing=target-a.kp*base;   // against what the other car could do here, not what a car in front of it lets it do now
      if(!(base>30)||closing<=(personal?1.2-.5*attack*craft+.2*patience:.4))return false;
      const needed=(longitudinal(a)+14)*target/closing,error=(hash01(own+'>'+a.id+':'+Math.floor(c.p/L))-.5)*1.2*(1-craft);
      return needed*(1.15-.5*(attack-.5)-.2*(patience-.5))*(1+error)<=room;
    };
    const passed=peers.find(a=>a.id===c.pass_id);
    if(passed){
      const d=longitudinal(passed);
      if(d<=-10){
        // clear of that car: if the next one ahead looks passable too, he goes on without returning to the line
        const next=peers.filter(a=>a.id!==passed.id&&longitudinal(a)>0&&longitudinal(a)<reach+15&&Math.abs(a.lane-c.pass_lane)>=2.4).sort((a,b)=>(Math.round(longitudinal(a)*1e6)-Math.round(longitudinal(b)*1e6))||(a.id<b.id?-1:a.id>b.id?1:0))[0];
        if(personal&&next&&judge(next)&&safe(c.pass_lane)){c.pass_id=next.id;lane=c.pass_lane;}
        else c.pass_id=null;
      }
      // carry on while level or behind the other car and still quicker than it; if not, back to the line
      else if(Math.abs(d)<70&&(d<6||target>passed.kp*base+.2))lane=c.pass_lane;
      else c.pass_id=null;
    }
    if(!c.pass_id){
      const obstructing=peers.filter(a=>longitudinal(a)>0&&longitudinal(a)<reach&&Math.abs(a.lane-c.lane)<2.2).sort((a,b)=>(Math.round(longitudinal(a)*1e6)-Math.round(longitudinal(b)*1e6))||(a.id<b.id?-1:a.id>b.id?1:0))[0];
      if(obstructing&&judge(obstructing)){
        const preferred=personal&&obstructing.blue_for===own?-obstructing.yield_lane:c.lane;
        const choices=[-2.8,2.8].filter(v=>v>=lim[0]&&v<=lim[1]).sort((a,b)=>Math.abs(a-preferred)-Math.abs(b-preferred));
        const choice=choices.find(v=>Math.abs(v-obstructing.lane)>=2.4&&safe(v));
        if(choice!==undefined){c.pass_id=obstructing.id;c.pass_lane=choice;lane=choice;}
      }
    }
    // A car that is being chased keeps to its line: it neither gives way nor moves across to block.
    // Back to the line is always allowed; a car only holds its lane when the lane it wants is blocked.
    if(lane!==0&&!safe(lane))lane=c.lane;
  }
  lane=Math.max(lim[0],Math.min(lim[1],lane));
  // Limit sideways speed and keep an existing passing lane until fully clear.
  // The car stays on the tarmac: a lane is measured from the racing line, which itself is not always in the middle.
  const step=c.pit&&c.pit_lane!=null?.45:.15;   // a car turns into its box and back into the lane quickly
  const next=c.lane+Math.max(-step,Math.min(step,(lane-c.lane)*DT*(step>.2?5:1.4)));
  let ahead=null,gap=1e9;
  for(const a of peers){const d=mod(a.p-c.p,L);if(d>1e-6&&d<L-1e-6&&d<gap&&((neutral&&!c.pit)||Math.min(Math.abs(a.lane-c.lane),Math.abs(a.lane-next))<2.2)){ahead=a;gap=d;}}
  if(ahead){
    const desired=(neutral&&!c.pit?12:6)+c.v*(personal?.25+.2*patience:.35)+Math.max(0,c.v-ahead.v)*.8;
    target=Math.min(target,Math.max(0,ahead.v+(gap-desired)*.7));
  }
  return {lane:next,ahead,gap,target};
}
// The tyre rule of a race: two different dry compounds must be used, unless rain tyres (intermediate or wet) are used.
// A car that finishes without it is disqualified.
export function tyreRuleMet(used){
  const u=new Set(used);
  return u.has('I')||u.has('W')||['S','M','H'].filter(x=>u.has(x)).length>=2;
}
export function skillSpeed(e,base,upcoming,water,t,distance,length,fatigue){
  const sk=e.driver_skills;if(!sk)return 1;
  const bend=Math.max(0,Math.min(1,(65-base)/45)),braking=upcoming<base-2?1:0;
  const variation=.5+.5*Math.sin(t*.7+e.grid),lapse=Math.max(0,Math.sin((t+e.grid*1.37)*.33))**16;
  let factor=(1+.18*(sk.cornering-.5)*bend)*(1+.14*(sk.braking-.5)*braking);
  factor*=1-.04*(1-sk.consistency)*variation;
  factor*=1-.18*(1-sk.focus)*lapse;
  factor*=1-.20*Math.min(1,water/.6)*(1-sk.wet);
  factor*=1-.015*(1-sk.feedback)*Math.exp(-Math.max(0,distance)/(length*3));
  factor*=1-.08*fatigue*bend*(1+(1-sk.fitness));   // a tired driver loses time in the bends, never on the straights
  return factor;
}

export class Race {
  constructor(cfg,commands=[]){
    this.cfg=cfg;this.commands=commands.slice();this.command_index=0;this.t=0;this.sc_until=0;this.safety_cars=[];this.triggered=new Set();this.done=false;this.events=[];this.contact_damage={};this.rolled=new Set();this.flag='green';this.sc_ref=0;this.red_at=0;this.leader=null;this.restart_p=0;this.tow_free_at=0;this.extra=0;this.red_flags=[];
    this.laps_by={};for(const e of cfg.entries)if(e.mine)this.laps_by[e.id]=[];this.player_laps=this.laps_by.player||[];this.length=cfg.profile.length;
    this.cars=cfg.entries.map(e=>({e,parts:{...(e.parts||{})},hold:null,clear_at:null,pen_due:0,stop_pen:0,stall_until:0,p:-8-e.grid*7,v:0,lane:e.grid%2===0?-1.4:1.4,pass_id:null,pass_lane:0,blue_for:null,yield_lane:0,defend_id:null,defend_lane:0,compound:e.compound,wear:e.wear0||0,request_set:null,request_tyres:true,request_wing:false,wing:e.front_wing_wear||0,wing_stops:[],fuel:e.fuel,pit:false,box:null,stop_until:0,serviced:false,request:null,stops:0,used:[e.compound],dnf:null,finish:null,penalty:0,lap_start:cfg.lights,sector_start:cfg.lights,sectors:[],lap_pit:false,laps:0}));
    this.by_id={};for(const c of this.cars)this.by_id[c.e.id]=c;
  }
  order(){return this.cars.slice().sort((a,b)=>Number(!!a.dnf)-Number(!!b.dnf)||Number(a.finish===null)-Number(b.finish===null)||((a.finish!==null?a.finish+a.penalty:-a.p)-(b.finish!==null?b.finish+b.penalty:-b.p))||a.e.id.localeCompare(b.e.id));}
  // The chance that one of the team's own cars crashes on the lap it is starting: what the parts have worn to by now
  // (they wear as the race goes) and how tired the driver is. Changing a part at the box lowers it from then on.
  crashChance(c,L){
    const cfg=this.cfg,e=c.e,km=c.p/1000/cfg.wear_km;
    const worst=Math.max(0,...Object.entries(cfg.wear_rates).map(([k,r])=>Math.min(1,(c.parts[k]||0)+r*km)));
    const total=.03+worst*.04+(1-(e.energy??100)/100)*.10;      // over the stretch of the race in which crashes can happen
    const window=Math.max(1,Math.floor(cfg.laps*7/12+.5));
    return 1-Math.pow(1-total,1/window);
  }
  // The chance that a pass ends in contact when two cars are alongside: how well the attacker judges it (racecraft, nerve, how
  // bold he is and how tired), how quickly the defender reacts, and how wet the track is.
  contactChance(a,d,t){
    const ea=a.e,ska=ea.driver_skills||{},skd=d.e.driver_skills||{};
    const attack=((ea.character||{}).aggression??50)/100,craft=Math.max(0,Math.min(1,ea.racecraft??.5));
    const water=waterAt(this.cfg,t),rain=.012*Math.min(1,water/3);   // the more water on the track, the more likely
    // dry tyres in the wet (the attacker's and, less, the defender's) and wet tyres on a dry track slide much more
    const wrong=(a.compound!=='I'&&a.compound!=='W'&&water>.3?.02*Math.min(1,water/1.5):0)+(d.compound!=='I'&&d.compound!=='W'&&water>.3?.01*Math.min(1,water/1.5):0)+((a.compound==='I'||a.compound==='W')&&water<.05?.005:0);
    return .004+.03*(1-craft)*(.4+attack)+.02*(1-(ska.composure??.5))+.012*(1-(skd.reflexes??.5))+rain+wrong+.02*(1-(ea.energy??100)/100);
  }
  checkContacts(t,L){
    if(!this.cfg.wear_rates||this.flag!=='green')return;
    for(const a of this.cars){
      if(a.dnf||a.finish!==null||a.pit||!a.pass_id)continue;
      const d=this.by_id[a.pass_id];
      if(!d||d.dnf||d.finish!==null||d.pit)continue;
      if(Math.abs(mod(d.p-a.p+L/2,L)-L/2)>7)continue;               // not alongside
      const key=`${a.e.id}>${d.e.id}:${Math.floor(a.p/L)}`;
      if(this.rolled.has(key))continue;
      this.rolled.add(key);
      if(hash01(`${this.cfg.seed}:contact:${key}`)<this.contactChance(a,d,t)){this.contact(a,d,key,t,L);if(this.flag!=='green')break;}
    }
  }
  // Two cars touch. How hard is rolled; so is who is to blame: usually the one who attacked, sometimes the one who closed the door.
  contact(a,d,key,t,L){
    const seed=this.cfg.seed,u=hash01(`${seed}:tier:${key}`),tier=u<.62?'touch':u<.90?'spin':'crash';
    const [guilty,victim]=hash01(`${seed}:fault:${key}`)<.72?[a,d]:[d,a];
    this.events.push({t:round(t,2),type:'contact',id:guilty.e.id,other:victim.e.id,tier});
    const hit=tier==='touch'?.08:.12;
    for(const x of [a,d]){x.wing=Math.min(1,x.wing+hit);if(x.e.mine)this.contact_damage[x.e.id]=round((this.contact_damage[x.e.id]||0)+hit,4);}
    if(tier==='touch'){a.v*=.9;d.v*=.9;this.penalise(guilty,5,victim,t);}
    else if(tier==='spin'){victim.v=0;victim.stall_until=t+6;guilty.v*=.8;this.penalise(guilty,10,victim,t);}
    else{this.crashCar(victim,t,L);if(hash01(`${seed}:both:${key}`)<.5)this.crashCar(guilty,t,L);else this.penalise(guilty,10,victim,t);}
  }
  // A time penalty: served in the next stop, which is that much longer, or added to the finishing time.
  penalise(c,seconds,other,t){c.pen_due+=seconds;this.events.push({t:round(t,2),type:'penalty',id:c.e.id,other:other.e.id,secs:seconds});}
  // The same for the computer's cars: what the driver is good at and how good the car is.
  rivalChance(e){
    const sk=e.driver_skills,s=(sk.focus+sk.composure+sk.consistency+sk.cornering)/4;
    const total=.015+.05*(1-s)+.02*(1-Math.min(1,(e.car_level??20)/50));
    const window=Math.max(1,Math.floor(this.cfg.laps*7/12+.5));
    return 1-Math.pow(1-total,1/window);
  }
  rollCrashes(t,L){
    const cfg=this.cfg;
    if(!cfg.wear_rates)return;                                    // a race configured before crashes were rolled lap by lap
    if(this.flag!=='green'){for(const c of this.cars)c.crash_at=null;return;}   // no new crash while the track is neutral
    for(const c of this.cars){
      const e=c.e;
      if(c.dnf||c.finish!==null)continue;
      if(c.crash_at!=null){
        if(c.p>=c.crash_at){c.crash_at=null;this.crashCar(c,t,L);if(this.flag!=='green')break;}
        continue;
      }
      const lap=Math.floor(c.p/L);
      if(lap<1||lap<=(c.risk_lap||0))continue;
      c.risk_lap=lap;
      if(!(cfg.laps*3/12<=lap&&lap<=cfg.laps*10/12))continue;
      const chance=e.mine?this.crashChance(c,L):this.rivalChance(e);
      if(hash01(`${cfg.seed}:crash:${e.id}:${lap}`)<chance)c.crash_at=(lap+.04+.9*hash01(`${cfg.seed}:crashat:${e.id}:${lap}`))*L;   // it happens somewhere on this lap
    }
  }
  // The car stops where it is; the truck is on its way. The track is neutral until the last car is off it.
  crashCar(c,t,L){
    c.dnf='crash';c.v=0;
    const delta=mod(c.p-this.cfg.profile.pitBox*L,L),distance=Math.min(delta,L-delta);
    const clear=round(Math.max(t+TOW_DISPATCH,this.tow_free_at)+2*distance/TOW_SPEED+TOW_HOOK,3);
    this.extra+=clear-t;this.tow_free_at=clear;c.clear_at=clear;
    this.sc_until=Math.max(this.sc_until,clear);this.safety_cars.push({t,end:clear,id:c.e.id});
    if(this.flag==='green'){this.flag='sc';const runners=this.cars.filter(x=>!x.dnf&&x.finish===null).map(x=>x.p);this.sc_ref=runners.length?Math.max(...runners):c.p;
      // The lap the leader is on does not count. The two laps after it do, and the field comes in at the pit entry of the
      // second one, before it crosses the line again, if the track is still not clear by then.
      this.red_at=(Math.floor(this.sc_ref/L)+2)*L+this.cfg.profile.pitIn*L;}
  }
  updateFlag(t,L){
    const f=this.flag;
    if(f==='green')return;
    const runners=this.cars.filter(c=>!c.dnf&&c.finish===null),lead=runners.length?Math.max(...runners.map(c=>c.p)):0;
    if(f==='sc'){
      if(t>=this.sc_until)this.flag='green';
      else if(lead>=this.red_at)this.startRed(t,L);               // two laps behind the safety car and the track is still not clear
    }else if(f==='red'){
      if(t>=this.sc_until)this.startRestart(L,lead);
    }else if(f==='restart'){
      if(lead>=this.restart_p)this.flag='green';
    }
  }
  startRed(t,L){
    this.flag='red';this.red_flags.push(round(t,2));const box=this.cfg.profile.pitBox*L;
    for(const c of this.cars){
      if(c.dnf||c.finish!==null)continue;
      c.hold=box+L*Math.ceil((c.p+25-box)/L);                      // the pit lane ahead of it, where it waits
      c.pit=false;c.box=null;c.serviced=false;c.stop_until=0;c.lap_pit=true;
    }
  }
  startRestart(L,lead){
    this.flag='restart';this.restart_p=(Math.floor(lead/L)+1)*L;
    if(this.restart_p<lead+20)this.restart_p+=L;
    for(const c of this.cars)c.hold=null;
  }
  step(){
    if(this.done)return;
    this.t=round(this.t+DT);const t=this.t,L=this.length,P=this.cfg.profile;
    while(this.command_index<this.commands.length&&this.commands[this.command_index].t<=t+.00001){const cmd=this.commands[this.command_index];this.command_index++;const player=this.by_id[cmd.car||'player'];if(!player||!player.e.mine)continue;player.request=cmd.compound||player.compound;player.request_pass=cmd.pass===true;player.request_set=cmd.set??null;player.request_tyres=!!cmd.compound;player.request_wing=cmd.wing===true;player.request_wing_unit=cmd.wing_unit??null;player.request_service=cmd.service||{};}
    this.cfg.incidents.forEach((event,i)=>{if(this.triggered.has(i))return;const c=this.cars.find(c=>c.e.id===event.id);if(c.p>=event.distance*L&&c.finish===null){this.triggered.add(i);c.dnf='crash';c.v=0;const end=t+event.clearance;this.sc_until=Math.max(this.sc_until,end);this.safety_cars.push({t,end,id:event.id});}});
    this.rollCrashes(t,L);this.updateFlag(t,L);this.checkContacts(t,L);{const running=this.cars.filter(x=>!x.dnf&&x.finish===null);let lead=null;for(const x of running){if(!lead||Math.round(x.p*1e6)>Math.round(lead.p*1e6)||(Math.round(x.p*1e6)===Math.round(lead.p*1e6)&&x.e.grid<lead.e.grid))lead=x;}this.leader=lead?lead.e.id:null;}
    const modern=(this.cfg.traffic_version||0)>=2&&t>(this.cfg.traffic_from||0)+.00001;
    const boxes=!!this.cfg.pit_boxes,neutral=t<this.sc_until||this.flag!=='green',ordered=this.cars.slice().sort((a,b)=>(Math.round(b.p*1e6)-Math.round(a.p*1e6))||(a.e.grid-b.e.grid)),snapshot=new Map(this.cars.map(c=>[c.e.id,{id:c.e.id,blue_for:c.blue_for,yield_lane:c.yield_lane,p:c.p,v:c.v,kp:c.kp??1,lane:c.lane,pit:c.pit,dnf:c.dnf,finish:c.finish}]));
    for(const c of ordered){
      const e=c.e,old=c.p;if(c.dnf||c.finish!==null||t<this.cfg.lights+e.reaction)continue;if(t<c.stall_until){c.v=0;continue;}   // spun and facing the wrong way for a few seconds
      
      const lap=Math.max(0,Math.trunc(old/L)),frac=mod(old,L)/L;
      if(!e.mine){
        const plan=e.pit_plan;                                    // the stops a computer driver has planned: the lap and the tyre for each
        if(plan){if(c.stops<plan.length&&lap>=plan[c.stops].lap)c.request=plan[c.stops].tyre;}
        else if(e.pit_lap&&lap>=e.pit_lap&&c.stops===0)c.request=e.pit_tyre||'H';
      }
      if(c.request&&!c.pit&&frac>=P.pitIn&&frac<P.pitIn+.025&&old>0){c.pit=true;c.box=Math.floor(old/L)*L+P.pitBox*L+(boxes?(e.box_off||0):0);c.serviced=!!c.request_pass;c.pass_through=!!c.request_pass;c.request_pass=false;if(c.pass_through)c.request=null;c.lap_pit=true;if(boxes){c.exit=(Math.floor(old/L)+1+P.pitOut)*L;c.ready_at=null;}}
      if(c.pit&&c.serviced&&old>=(c.exit!=null?c.exit:c.box+(1-P.pitBox+P.pitOut)*L)){c.pit=false;c.box=null;c.serviced=false;c.exit=null;c.ready_at=null;c.pass_through=false;}
      const [grip,wear_rate]=TYRES[c.compound],base=P.speeds[Math.min(P.speeds.length-1,Math.trunc(frac*P.speeds.length))];
      let target=base*65/e.target*grip*waterFactor(c.compound,waterAt(this.cfg,t))*(1-Math.min(.30,c.wear*.32))*(1-c.fuel*(this.cfg.fuel_k??.0007));
      const fatigue=1-Math.max(0,(e.energy??100)-(e.energy_cost??0)*Math.min(1,Math.max(0,old)/(this.cfg.laps*L)))/100;
      target*=(1+.08*((e.front_wing_wear||0)-c.wing));
      const upcoming=P.speeds[Math.trunc(mod(frac+.012,1)*P.speeds.length)];
      target*=skillSpeed(e,base,upcoming,waterAt(this.cfg,t),t,old,L,fatigue);
      if(neutral&&(this.flag==='green'||c.e.id===this.leader))target=Math.min(target,SC_SPEED);   // only the leader sets the pace; the others close up on the car ahead
      if(this.flag==='red'&&c.hold!==null)target=Math.min(target,22.22,Math.sqrt(2*9*Math.max(0,c.hold-old)));
      if(c.pit){target=Math.min(target,22.22);
        const busy=boxes&&this.cars.some(o=>o!==c&&o.pit&&!o.dnf&&o.finish===null&&!o.pass_through&&o.box!=null&&Math.abs(mod(o.box-c.box+L/2,L)-L/2)<1&&
          (o.stop_until>0||o.serviced&&o.p<o.box+12||!o.serviced&&(o.p-o.box>old-c.box+.001||Math.abs(o.p-o.box-(old-c.box))<.001&&o.e.grid<e.grid)));
        if(busy&&!c.serviced)target=Math.min(target,Math.sqrt(2*9*Math.max(0,c.box-6-old)));
        if(!c.serviced&&!busy&&old>=c.box-1&&(!boxes||!modern||c.lane<-PIT_LANE+.35)){if(c.stop_until===0){c.stop_until=t+pitDuration(e,c.stops,c.request_tyres,c.request_wing,c.request_service)+c.pen_due;c.stop_pen=c.pen_due;c.v=0;}if(t<c.stop_until)continue;{const rs=c.request_set;if(c.request_tyres){c.compound=c.request||c.compound;c.used.push(c.compound);c.wear=(this.cfg.tyre_sets||{})[rs]||0;}{const spares=this.cfg.spares||{},stop=round(c.p,4),swapped={};if(c.request_wing)swapped.frontWing=c.request_wing_unit;Object.assign(swapped,c.request_service||{});if('frontWing' in swapped){c.wing=spares[swapped.frontWing]||0;c.wing_stops.push(stop);}for(const part in swapped)if(swapped[part] in spares)c.parts[part]=spares[swapped[part]];if(Object.keys(swapped).length)(c.service_stops=c.service_stops||[]).push({p:stop,swap:swapped});c.request_wing_unit=null;c.request_service={};if(c.stop_pen){this.events.push({t:round(t,2),type:'served',id:e.id,secs:c.stop_pen});c.pen_due=Math.max(0,c.pen_due-c.stop_pen);c.stop_pen=0;}}c.request=null;c.request_set=null;c.request_wing=false;c.serviced=true;c.stops++;c.stop_until=0;}}else if(!c.serviced)target=Math.min(target,Math.sqrt(2*9*Math.max(0,c.box-old)));
        if(boxes){
          // The working lane holds a queued teammate; passing traffic has
          // priority. There is no timeout that can force an unsafe release.
          if(c.serviced&&!c.pass_through&&old<c.box+12){
            if(c.ready_at==null)c.ready_at=t;
            const blocked=this.cars.some(o=>{
              if(o===c||!o.pit||o.dnf||o.finish!==null)return false;
              const d=mod(o.p-old+L/2,L)-L/2;
              if(o.lane>0&&d>-Math.max(20,o.v*2.5+8)&&d<20)return true;
              return o.serviced&&!o.pass_through&&o.p<o.box+12&&Math.abs(d)<24&&o.ready_at!=null&&(o.ready_at<c.ready_at||o.ready_at===c.ready_at&&o.e.grid<e.grid);
            });
            if(blocked){c.v=0;continue;}
          }
          c.pit_lane=!c.serviced&&c.box-old<(busy?18:12)?-PIT_LANE:PIT_LANE;
        }}
      let lane=0,ahead=null,gap=1e9;
      c.kp=base>0?target/base:1;   // how quick this car is compared with the speed plan of the place it is at
      if(modern){const plan=trafficPlan(c,[...snapshot.values()],L,target,base,neutral,t<this.cfg.lights+5||old<80,(this.cfg.traffic_version||0)>=3&&t>(this.cfg.character_from||0)+.00001,passRoom(P,frac,L),c.pit?[-PIT_LANE,PIT_LANE]:laneLimits(P,frac));c.lane=plan.lane;ahead=plan.ahead;gap=plan.gap;target=plan.target;}
      else {
        for(const other of this.cars){const a=snapshot.get(other.e.id);if(other===c||a.dnf||a.finish!==null||a.pit!==c.pit)continue;const delta=mod(a.p-old,L);if(delta>0&&delta<gap){ahead=a;gap=delta;}}
        if(c.pit)lane=0;
        else if(neutral){if(ahead&&gap<35)target=Math.min(target,Math.max(0,ahead.v+(gap-12)*.8));}
        else if(ahead&&gap<32){if(target>ahead.v+.35&&base>34)lane=ahead.lane<=0?2.6:-2.6;else if(gap<12)target=Math.min(target,Math.max(0,ahead.v+(gap-8)*.9));}
        c.lane+=(lane-c.lane)*Math.min(1,DT*2);
      }
      const sk=e.driver_skills;
      if(sk&&ahead&&gap<30&&!neutral&&!c.pit)target*=1-.08*(1-sk.composure)-.05*(1-sk.reflexes);
      const acc=target>c.v?(sk?7*(.7+.6*sk.traction):7):(sk?18*(.8+.4*sk.braking):18);c.v+=Math.max(-acc*DT,Math.min(acc*DT,target-c.v));
      let move=Math.max(0,c.v*DT);if(ahead&&((neutral&&!c.pit)||Math.abs(c.lane-ahead.lane)<(modern?2.2:1.9))){const advance=modern?Math.max(0,this.cars.find(o=>o.e.id===ahead.id).p-ahead.p):0;move=Math.min(move,Math.max(0,gap-(modern?5.8:6)+advance));}
      if(modern)c.v=move/DT;
      c.p+=move;c.fuel=Math.max(0,c.fuel-move*(this.cfg.fuel_rate??.00055));c.wear=Math.min(1,c.wear+move*wear_rate*(this.cfg.wear_scale??1)*(1.3-.5*e.care));if(c.fuel<=0){c.dnf='fuel';c.v=0;}
      for(let lap_index=Math.floor(Math.max(0,old)/L);lap_index<=Math.floor(Math.max(0,c.p)/L);lap_index++){
        [...P.sectors,1].forEach((cut,sector_index)=>{const boundary=(lap_index+cut)*L;if(!(old<boundary&&boundary<=c.p))return;
          c.sectors.push(round(t-c.sector_start,3));c.sector_start=t;
          if(sector_index===2){c.laps=lap_index+1;if(e.mine)this.laps_by[e.id].push({time:round(t-c.lap_start,3),sectors:c.sectors.slice(-3),valid:!c.lap_pit,out:false,pit:c.lap_pit,pen:0});c.lap_start=t;c.lap_pit=c.pit;}
        });
      }
      if(c.p>=this.cfg.laps*L){c.finish=t-this.cfg.lights;c.v=0;c.penalty+=c.pen_due;c.pen_due=0;if(!tyreRuleMet(c.used))c.dnf='dsq';}
    }
    if(this.cars.every(c=>c.dnf||c.finish!==null)||t>(this.cfg.max_time??3500)+this.extra)this.done=true;
  }
  result(){return {classification:this.order().map((c,i)=>({id:c.e.id,name:c.e.name,position:i+1,time:c.finish!==null?round(c.finish+c.penalty,3):null,laps:c.laps,dnf:c.dnf||(c.finish===null?'recovery':null),stops:c.stops,pen_due:c.pen_due,penalty:c.penalty})),laps:this.player_laps,laps_by:this.laps_by,duration:round(this.t-this.cfg.lights,3),safety_cars:this.safety_cars,red_flags:this.red_flags,events:this.events,contact_damage:this.contact_damage,wing_replacements:Object.fromEntries(this.cars.filter(c=>c.e.mine).map(c=>[c.e.id,c.wing_stops])),service_stops:Object.fromEntries(this.cars.filter(c=>c.e.mine).map(c=>[c.e.id,c.service_stops||[]]))};}
}
