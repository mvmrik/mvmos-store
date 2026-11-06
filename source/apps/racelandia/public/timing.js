// Playback-time timing only: future simulated laps must never leak into the HUD.
// Sector colours are always relative to the bests that exist right now: purple belongs to
// the single fastest sector of the whole session (the player and the field), green to the
// driver's own best sector, and a faster time later takes the colour away from the older one.
function overallBests(field, ownMarks, time, offset = 0) {
  const out = [null, null, null];
  const consider = (i, value, at, who, key) => {
    if (!(value > 0) || at > time + 1e-6) return;
    const b = out[i];
    if (!b || value < b.time - 1e-9 || (Math.abs(value - b.time) <= 1e-9 && at < b.at)) out[i] = { time: value, at, who, key };
  };
  for (const m of ownMarks) if (m.valid) consider(m.sec, m.time, m.t, 'player', m.lap);
  for (const r of field || []) for (const l of r.laps) if (l.valid && Array.isArray(l.sectors)) {
    let at = (l.start ?? l.at - l.time) + offset;
    l.sectors.forEach((v, i) => { at += v; consider(i, v, at, r.id, l.at); });
  }
  return out;
}

// A personal practice is judged against the driver's best sectors ever set on this circuit (`own`, from before the
// session): purple is a new best of all, green is level with it or within this much of it, yellow is slower.
const OWN_CLOSE = 0.005;
const withOwn = (overall, own) => own ? overall.map((o, i) => Number.isFinite(own[i]) && own[i] > 0 && (!o || own[i] <= o.time + 1e-9) ? { time: own[i], at: -Infinity, who: 'own', key: 'own' } : o) : overall;

export function qualifyingTiming(run, time, lap, baseline = {}) {
  const events = run.events.filter(e => e.t <= time + 1e-6);
  const completed = run.laps.filter(l => l.t0 + l.time <= time + 1e-6);
  const clean = l => l.valid && !l.out && !l.pit && !l.pen;
  const invalidTypes = ['limits', 'crash', 'pit-in', 'recovering', 'recovery', 'fuel'];
  const invalidAt = (n, at) => (!run.race && n === 0) || events.some(e => e.lap === n && e.t <= at && invalidTypes.includes(e.type));
  const bestLap = completed.filter(clean).reduce((best, l) => best == null ? l.time : Math.min(best, l.time), null);
  const marks = [];
  for (const e of events.filter(e => e.type === 'sector')) {
    const finished = completed.find(l => l.n === e.lap);
    const valid = !invalidAt(e.lap, time) && !(finished && !clean(finished));
    marks.push({ ...e, valid });
  }
  const own = baseline.own || null;
  const overall = withOwn(overallBests(baseline.field, marks, time, baseline.offset || 0), own);
  const personal = [0, 1, 2].map(i => marks.filter(m => m.valid && m.sec === i).reduce((b, m) => !b || m.time < b.time - 1e-9 || (Math.abs(m.time - b.time) <= 1e-9 && m.t < b.t) ? m : b, null));
  const colors = {};
  for (const m of marks) {
    let color = 'grey';
    if (m.valid) {
      const o = overall[m.sec], p = personal[m.sec];
      color = o && o.who === 'player' && o.key === m.lap ? 'purple'
        : own && Number.isFinite(own[m.sec]) ? (o && m.time <= o.time * (1 + OWN_CLOSE) ? 'green' : 'yellow')
        : p && p.lap === m.lap ? 'green' : 'yellow';
    }
    m.color = color; colors[m.lap + ':' + m.sec] = color;
    const o = overall[m.sec];
    // the distance to the best sector that stood when this one was set, never to itself
    const others = [o && !(o.who === 'player' && o.key === m.lap) ? o.time : null,
      ...marks.filter(x => x.valid && x.sec === m.sec && x.lap !== m.lap && x.t <= m.t).map(x => x.time)].filter(x => Number.isFinite(x));
    m.delta = others.length ? m.time - Math.min(...others) : null;
  }
  const finished = completed.find(l => l.n === lap);
  const personalBests = [0, 1, 2].map(i => personal[i] ? personal[i].time : null);
  return { completed, bestLap, personalBests, overallBests: overall.map(o => o && o.time), colors, invalid: invalidAt(lap, time) || !!(finished && !clean(finished)),
    cells: [0, 1, 2].map(i => marks.findLast(e => e.lap === lap && e.sec === i) || null),
    latest: marks.findLast(e => e.lap === lap) || null, marks };
}

// The colours of finished laps (summary, statistics) with every time already known.
export function finalSectorColours(laps, field, own = null) {
  const marks = [];
  laps.forEach((l, n) => { if (!l.valid || l.out || l.pit || l.pen) return; (l.sectors || []).forEach((v, i) => marks.push({ lap: n, sec: i, time: v, t: n * 1000 + i, valid: true })); });
  const overall = withOwn(overallBests(field, marks, Infinity), own);
  const personal = [0, 1, 2].map(i => marks.filter(m => m.sec === i).reduce((b, m) => !b || m.time < b.time - 1e-9 ? m : b, null));
  const out = {};
  for (const m of marks) {
    const o = overall[m.sec];
    out[m.lap + ':' + m.sec] = o && o.who === 'player' && o.key === m.lap ? 'purple'
      : own && Number.isFinite(own[m.sec]) ? (o && m.time <= o.time * (1 + OWN_CLOSE) ? 'green' : 'yellow')
      : personal[m.sec] && personal[m.sec].lap === m.lap ? 'green' : 'yellow';
  }
  return out;
}

// A fresh session starts with empty times, never with a previous room best.
export function sessionClassification(field,elapsed,player,best,own=[],teammates=[],playerId='player'){
  const rows=field.map(r=>{
    const laps=r.laps.filter(l=>l.valid&&l.at<=elapsed+1e-6);
    return {pid:r.id,name:r.name,best:laps.length?Math.min(...laps.map(l=>l.time)):null,mine:false,...rivalTiming(r,field,elapsed,own)};
  });
  rows.push({pid:playerId,name:player,best:Number.isFinite(best)&&best>0?best:null,mine:true});
  // the team's other car stands in the garage: its best of this session so far, if it has run
  for(const t of teammates)rows.push({pid:t.id,name:t.name,best:Number.isFinite(t.best)&&t.best>0?t.best:null,mine:false,teammate:true,compound:t.compound,status:t.status||'pit',cells:[]});
  rows.sort((a,b)=>(a.best??Infinity)-(b.best??Infinity)||String(a.pid).localeCompare(String(b.pid)));
  const lead=rows.find(r=>r.best!=null)?.best;
  return rows.map((r,i)=>({...r,position:i+1,gap:lead!=null&&r.best!=null?r.best-lead:null,toPlayer:best!=null&&r.best!=null?r.best-best:null}));
}

// Sector results are revealed only after the timing line has been crossed.
export function rivalTiming(driver,field,time,own=[]){
  const segments=driver.segments || driver.laps.map(l=>({kind:'flying',start:l.at-l.time,end:l.at,compound:l.compound||'M'}));
  const segment=segments.find(s=>s.start<=time && time<s.end);
  const status=segment?.kind || 'pit',compound=segment?.compound || segments.findLast(s=>s.start<=time)?.compound || 'M';
  const lap=status==='flying'?driver.laps.find(l=>(l.start??l.at-l.time)<=time && time<l.at):null;
  const previous=driver.laps.filter(l=>l.valid && l.at<=time);
  const bests=[0,1,2].map(i=>{const a=previous.map(l=>l.sectors?.[i]).filter(Number.isFinite);return a.length?Math.min(...a):null;});
  const last=driver.laps.findLast(l=>l.at<=time);
  const shown=lap && time-(lap.start??lap.at-lap.time)>=2 ? lap : last || lap;
  let passed=0;
  const cells=[0,1,2].map(i=>{
    if(!shown?.sectors)return null;
    passed+=shown.sectors[i]; const at=(shown.start??shown.at-shown.time)+passed;
    if(at>time+1e-6)return null;
    // Colours are relative to what stands at this moment: one purple per sector in the whole session.
    const overall=overallBests(field,own,time);
    const holder=overall[i],prev=driver.laps.filter(l=>l.valid && l.at<=time && l!==shown).map(l=>l.sectors?.[i]).filter(Number.isFinite);
    const own_best=[...prev,shown.valid?shown.sectors[i]:Infinity].filter(Number.isFinite);
    const mine=own_best.length?Math.min(...own_best):null;
    const color=!shown.valid?'grey':holder&&holder.who===driver.id&&holder.key===shown.at?'purple':mine!=null&&shown.sectors[i]<=mine+.0005?'green':'yellow';
    return {time:shown.sectors[i],t:at,delta:prev.length?shown.sectors[i]-Math.min(...prev):null,color};
  });
  return {status,compound,cells,bests,lapStart:lap?.start??null,lapEnd:lap?.at??null};
}

// Where a rival is on the circuit at a given session time, as a fraction of the lap from the
// start/finish line. The rivals' laps are timetables, so a lap is placed by its sector times.
export function rivalPosition(driver, time, sectorCuts = [0.34, 0.68]) {
  const seg = (driver.segments || []).find(x => x.start <= time && time < x.end);
  if (!seg || seg.kind === 'pit') return null;
  const u = (time - seg.start) / Math.max(0.001, seg.end - seg.start);
  let frac = seg.kind === 'out' ? 0.03 + 0.97 * u : seg.kind === 'in' ? 0.9 * u : u;
  if (seg.kind === 'flying') {
    const lap = driver.laps.find(l => (l.start ?? l.at - l.time) <= time && time < l.at);
    if (lap && Array.isArray(lap.sectors) && lap.sectors.length === 3) {
      const t = time - (lap.start ?? lap.at - lap.time), cuts = [0, ...sectorCuts, 1];
      let acc = 0;
      for (let i = 0; i < 3; i++) {
        if (t <= acc + lap.sectors[i] || i === 2) { frac = cuts[i] + (cuts[i + 1] - cuts[i]) * Math.min(1, Math.max(0, (t - acc) / Math.max(0.001, lap.sectors[i]))); break; }
        acc += lap.sectors[i];
      }
    }
  }
  return { frac: Math.min(0.999, Math.max(0, frac)), kind: seg.kind };
}
