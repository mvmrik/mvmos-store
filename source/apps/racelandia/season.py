"""Persistent solo divisions and race weekends; all times are real UTC seconds.

A team enters two cars. Each car goes through the sessions of a weekend on its own (its own setup,
tyres and driver) and both race together; the rivals are the computer teams of rivals.py."""
import hashlib
import json
import random
import time

D = None
STATE_VERSION = 3
KEYS = ('player', 'player2')


def bind(context):
    global D
    D = context

DIVISIONS = [dict(level=i, car=120-20*i if i>1 else 95, driver=105-10*i if i>1 else 95, available=i==5) for i in range(5,0,-1)]
PHASES = ('fp1','fp2','fp3','qualifying','race')
ENERGY = (15,15,15,20,30)
POINTS = (25,18,15,12,10,8,6,4,2,1)
RACE_LAPS = 12
PRACTICE_SECONDS = 1800
QUALIFY_SECONDS = 2700
DURATIONS = (PRACTICE_SECONDS,PRACTICE_SECONDS,PRACTICE_SECONDS,QUALIFY_SECONDS,None)
# A timed session is capped by its clock, not by its laps; this is only the reserve the sim may use.
def session_laps(seconds): return int(seconds/55)+2


# The tyres of a weekend: a fixed allocation for all five sessions, paid once.
SETS = (('S',6),('M',4),('H',3),('I',4),('W',3))
TYRE_FEE = 120000
HOURS = (10,14,11,15,14)


def allocation():
    out=[]
    for compound,count in SETS:
        for i in range(count):out.append(dict(id=f'{compound}{i+1}',compound=compound,wear=[0,0,0,0],laps=0,runs=0))
    return out


def new_slot():
    return dict(stage=0,locked_setup=None,locked_pilot=None,tyres=allocation(),tyre_notes={},tyre_paid=False,times={})


def is_mine(ident):
    return ident in KEYS


def _round_slots(state):
    """A new round brings a new allocation of tyres to each car; returns True when the state changed."""
    if state.get('slot_round')==state['round'] and 'slots' in state:return False
    state['slots']={k:new_slot() for k in KEYS};state['slot_round']=state['round'];state['trip_paid']=False;state['ai_grid']=[]
    return True


def team_stage(state):
    return min(state['slots'][k]['stage'] for k in KEYS)


def driver_character(identity):
    """Permanent temperament, independent of training, age and current skills."""
    digest=hashlib.sha256(('apex-character-v1:'+str(identity)).encode()).digest()
    return {key:15+int.from_bytes(digest[i*2:i*2+2],'big')%71 for i,key in enumerate(('aggression','defence','patience'))}


def _refresh_roster(conn,driver,state):
    """The eighteen rivals of the division as they are today (they train every real day)."""
    new=D['rivals'].roster(conn,driver,5)
    old={r['id']:r for r in state.get('roster',[])}
    for r in new:r['character']=(old.get(r['id']) or {}).get('character') or driver_character(f"division:{state['seed']}:{r['id']}")
    if new!=state.get('roster'):
        state['roster']=new;return True
    return False


def ensure(conn, driver):
    row=conn.execute('SELECT state FROM division_season WHERE player_id=?',(driver['player_id'],)).fetchone()
    if row:
        state=json.loads(row[0])
        if state.get('v')==STATE_VERSION and state['career_started']==driver['created']:
            changed=_round_slots(state)
            if _refresh_roster(conn,driver,state):changed=True
            if changed:save(conn,driver['player_id'],state)
            return state
    seed=int(hashlib.sha256(f"division5:{driver['player_id']}:{driver['created']}".encode()).hexdigest()[:8],16)
    state=dict(v=STATE_VERSION,career_started=driver['created'],seed=seed,roster=[],entered=False,round=1,ready_at=0,calendar=[],points={},wins={},grid=[],results=[])
    _round_slots(state);_refresh_roster(conn,driver,state)
    save(conn,driver['player_id'],state)
    return state


def save(conn,player,state):
    conn.execute('INSERT INTO division_season(player_id,state) VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET state=excluded.state',(player,json.dumps(state)))


def parc_ferme(state,key):
    return bool(key and state['slots'].get(key,{}).get('locked_setup'))


def _latent(state):
    """The weekend's real weather: five sessions with a rain level at the start and at the end."""
    r=random.Random(f"weather:{state['seed']}:{state['round']}")
    front=r.random()<.38
    centre=r.uniform(.2,4.8);half=r.uniform(.7,1.9);power=r.uniform(.4,1.0)
    shower=r.random()<.22;at=r.uniform(0,5);sh=r.uniform(.3,.7)
    base=r.uniform(13,27)
    def rain(x):
        v=0.
        if front:v=max(v,power*max(0,1-abs(x-centre)/half))
        if shower:v=max(v,sh*max(0,1-abs(x-at)/.5))
        return round(min(1,v),3)
    out=[];prev=0.
    for k in range(5):
        r0,r1=rain(k+.1),rain(k+.9)
        hour=HOURS[k];sun=max(0,min(1,(hour-6)/6.0)) if hour<12 else max(0,min(1,(20-hour)/8.0))
        cloud=round(max(0,min(1,.15+.85*max(r0,r1)+r.gauss(0,.05))),2)
        air=round(base+3*sun-3*max(r0,r1)+r.gauss(0,.4),1)
        w0=round(prev*.55,2);w1=round(min(6,w0*.5+3.4*max(r0,r1)),2)
        track0=air+18*sun*(1-.75*cloud);track=lambda w:round(air+1 if w>.3 else air+.4*(track0-air) if w>.05 else track0,1)
        out.append(dict(phase=PHASES[k],hour=hour,rain0=r0,rain1=r1,water0=w0,water1=w1,air=air,cloud=cloud,sun=round(sun,2),track0=track(w0),track1=track(w1)))
        prev=w1
    return out


def weather_state(state,k):
    """The conditions of session k as the simulation reads them: an hourly table where the
    session's hour holds the start and the next hour the end."""
    w=_latent(state)[k];fc=[]
    for h in range(24):
        sun=max(0,min(1,(h-6)/6.0)) if h<12 else max(0,min(1,(20-h)/8.0))
        fc.append(dict(air=round(w['air']-3+3*sun,1),track=round(w['air']+18*sun*.8,1),cloud=.2,rain=0.0,water=0.0,sun=round(sun,2),hum=45,rubber=.975))
    for i,(rn,wt,tk) in enumerate(((w['rain0'],w['water0'],w['track0']),(w['rain1'],w['water1'],w['track1']))):
        h=w['hour']+i
        if h<24:fc[h]=dict(air=w['air'],track=tk,cloud=w['cloud'],rain=rn,water=wt,sun=w['sun'],hum=round(40+40*w['cloud']+20*rn),rubber=round(.975-.02*min(1,wt),3))
    return fc,w


def forecast(state,real=None):
    """What the team is told. Every session has a chance of rain that is only an estimate: the
    further away the session, the less it can be trusted, and each finished session improves it."""
    if real:
        # the real forecast of the place, as if the sessions were driven one after another from now
        table=real['table'];base=real['hour'];out=[]
        for k in range(5):
            hour=min(20,base+max(0,k-state['stage']))
            out.append(dict(phase=PHASES[k],hour=hour,chance=weather_chance(table,hour),lead=0,air=round(table[hour]['air']),done=k<state['stage']))
        return out
    out=[]
    for k,w in enumerate(_latent(state)):
        lead=max(0,k-state['stage']) if state['round']<=20 else k
        rr=random.Random(f"forecast:{state['seed']}:{state['round']}:{k}:{state['stage']}")
        p=.05+.92*max(w['rain0'],w['rain1'])+rr.gauss(0,.04+.10*lead)
        p=round(max(.02,min(.98,p))*20)/20
        out.append(dict(phase=w['phase'],hour=w['hour'],chance=p,lead=lead,air=round(w['air']+rr.gauss(0,.6+.5*lead)),done=k<state['stage']))
    return out


def weather_chance(table,hour):
    span=table[hour:min(24,hour+2)]
    return round(max((e['pp'] for e in span),default=0.0)*20)/20


def real_state(real,k,stage):
    """Session k from the real table: its hour holds the start and the next hour the end."""
    hour=min(20,real['hour']+max(0,k-stage));t=real['table']
    fc=[{x:v for x,v in e.items() if x not in ('pp','hour')} for e in t]
    a,b=t[hour],t[hour+1]
    w=dict(phase=PHASES[k],hour=hour,rain0=a['rain'],rain1=b['rain'],water0=a['water'],water1=b['water'],air=a['air'],cloud=a['cloud'],sun=a['sun'],track0=a['track'],track1=b['track'])
    return fc,w


def eligible(slots):
    """Two cars with two different drivers, as strong as the division asks for."""
    if len(slots)<2 or any(not s['pilot'] for s in slots):return False
    if slots[0]['pilot_id']==slots[1]['pilot_id']:return False
    return all(s['car']['car_level']>=20 and sum(s['pilot']['skills'].values())/len(s['pilot']['skills'])>=55 for s in slots)


def _names(state,mine):
    names={r['id']:r['name'] for r in state['roster']}
    for m in mine:names[m['key']]=m['name']
    return names


def public(conn,d,real=None,laps_of=None,mine=(),key=None):
    s=ensure(conn,d);mine=list(mine)
    names=_names(s,mine)
    standings=[dict(id=k,name=v,points=s['points'].get(k,0),wins=s['wins'].get(k,0),mine=is_mine(k)) for k,v in names.items()]
    standings.sort(key=lambda r:(-r['points'],-r['wins'],r['id']))
    team_of={r['id']:r.get('team','') for r in s['roster']}
    for m in mine:team_of[m['key']]=m.get('team','')
    totals={}
    for ident,team in team_of.items():
        t=totals.setdefault(team,dict(name=team,points=0,wins=0,mine=False))
        t['points']+=s['points'].get(ident,0);t['wins']+=s['wins'].get(ident,0);t['mine']=t['mine'] or is_mine(ident)
    team_standings=sorted(totals.values(),key=lambda t:(-t['points'],-t['wins'],t['name']))
    for r in standings:r['team']=team_of.get(r['id'],'')
    slot=s['slots'].get(key) or s['slots']['player'];stage=slot['stage']
    characters={x['id']:x.get('character') for x in s['roster']}
    slot_info=[dict(key=m['key'],car_id=m['car_id'],number=m['number'],pilot_id=m['pilot_id'],name=m['name'],stage=s['slots'][m['key']]['stage'],
                    phase=PHASES[s['slots'][m['key']]['stage']] if s['round']<=20 else None,locked_setup=bool(s['slots'][m['key']]['locked_setup']),
                    times=s['slots'][m['key']]['times'],tyres=s['slots'][m['key']]['tyres'],tyre_fee=0 if s['slots'][m['key']]['tyre_paid'] else TYRE_FEE) for m in mine]
    return dict(divisions=DIVISIONS,eligible=eligible(mine),entered=s['entered'],round=s['round'],stage=stage,team_stage=team_stage(s),
                phase=PHASES[stage] if s['round']<=20 else None,remaining=0,slot=key,slots=slot_info,
                calendar=s['calendar'],standings=standings,team_standings=team_standings,roster=[dict(r,character=characters.get(r['id'])) for r in D['rivals'].summary(conn,d,5)],
                results=s['results'],grid=s['grid'],locked_setup=slot['locked_setup'],race_laps=(laps_of(s['calendar'][s['round']-1].get('track','zandvoort')) if laps_of and s['calendar'] and s['round']<=20 else RACE_LAPS),energy=D['training_rules'].driving_energy(ENERGY[stage],d['skills']['fitness']),
                tyres=slot['tyres'],tyre_notes=slot.get('tyre_notes',{}),tyre_fee=0 if slot.get('tyre_paid') else TYRE_FEE,forecast=forecast(dict(s,stage=stage),real) if s['round']<=20 else [],durations=DURATIONS,
                regen_hour=15,recovery_multiplier=1)


def enter(conn,d,slots,circuits=('zandvoort',)):
    s=ensure(conn,d)
    if s['entered']:return None
    if not eligible(slots):return 'division_requirements'
    s['entered']=True
    s['calendar']=[dict(round=i,track=circuits[i-1],status='ready' if i==1 else 'pending') for i in range(1,21)]
    save(conn,d['player_id'],s)
    return None


def _usable_set(slot,set_id):
    chosen=next((t for t in slot['tyres'] if t['id']==set_id),None)
    if not chosen or max(chosen['wear'])>=.98:return None
    return chosen


def prepare(conn,d,kind,setup,key,mine,set_id=None,set_ids=None,trip=None,usable=None,real=None,race_laps=None,other_setups=None):
    """A session of the weekend. Both cars of the team take part together: `set_ids` names the tyre set of each and
    `other_setups` the setup of the car that is not the open one."""
    s=ensure(conn,d)
    if not s['entered'] or s['round']>20:return None,'division_requirements'
    if key not in KEYS or len(mine)<2:return None,'division_requirements'
    slot=s['slots'][key];stage=slot['stage']
    if kind!='d5_'+PHASES[stage]:return None,'weekend_order'
    if any(s['slots'][m['key']]['stage']!=stage for m in mine):return None,'weekend_order'
    race=stage==4
    if race and any(s['slots'][m['key']]['locked_pilot']!=m['pilot_id'] for m in mine):return None,'parc_ferme'
    tid=s['calendar'][s['round']-1].get('track','zandvoort')
    if usable and not usable(tid):return None,'track_requirements'
    setups={key:dict(slot['locked_setup'] or setup)}
    for m in mine:
        if m['key']!=key:setups[m['key']]=dict(s['slots'][m['key']]['locked_setup'] or (other_setups or {}).get(m['key']) or setup)
    chosen={m['key']:_usable_set(s['slots'][m['key']],(set_ids or {}).get(m['key'])) for m in mine}
    if any(not v for v in chosen.values()):return None,'tyre_set'
    fee=0
    for k in chosen:
        if not s['slots'][k].get('tyre_paid'):fee+=TYRE_FEE;s['slots'][k]['tyre_paid']=True
    trip_fee=0
    if not s.get('trip_paid'):trip_fee=trip(tid) if trip else 0;s['trip_paid']=True
    if stage==3:
        for m in mine:
            s['slots'][m['key']]['locked_setup']=dict(setups[m['key']]);s['slots'][m['key']]['locked_pilot']=m['pilot_id']
    save(conn,d['player_id'],s)
    fc,w=real_state(real,stage,stage) if real else weather_state(s,stage)
    meta=dict(forecast=fc,hour=w['hour'],weather=dict(w0=w['water0'],w1=w['water1'],rain0=w['rain0'],rain1=w['rain1']),tyre_set=chosen[key],tyres=slot['tyres'],tyre_fee=fee,track=tid,trip_fee=trip_fee,round=s['round'],phase=PHASES[stage],stage=stage,energy=ENERGY[stage],
              setup=setups[key],laps=((race_laps(tid) if race_laps else RACE_LAPS) if race else session_laps(DURATIONS[stage])),duration=DURATIONS[stage],roster=s['roster'],grid=s['grid'],seed=s['seed']+s['round']*997,key=key,
              mine=[dict(key=m['key'],name=m['name'],team=m.get('team',''),car_id=m['car_id'],pilot_id=m['pilot_id']) for m in mine])
    meta['entries']={k:dict(tyre_set=chosen[k],tyres=s['slots'][k]['tyres'],setup=setups[k]) for k in chosen}
    return meta,None


def apply_tyres(conn,d,run,msg,rows):
    """What the session did to the sets that were on the car: wear never goes back, and a set
    cannot wear faster than the laps it did allow. The wear per lap of each compound is kept for the
    later sessions of the weekend."""
    s=ensure(conn,d);slot=s['slots'][run['weekend']['key']]
    sets={t['id']:t for t in slot['tyres']}
    allowed={run['tyre_set']['id']}|set(run.get('mounted',[]))
    log=msg.get('tyre_log') if isinstance(msg.get('tyre_log'),list) else []
    for e in log[:10]:
        if not isinstance(e,dict):continue
        t=sets.get(e.get('set'))
        if not t or t['id'] not in allowed or not isinstance(e.get('wear'),list) or len(e['wear'])<4:continue
        try:wear=[min(1.,max(0.,float(x))) for x in e['wear'][:4]];laps=int(min(80,max(0,float(e.get('laps',0)))))
        except (TypeError,ValueError,OverflowError):continue
        old=list(t['wear'])
        new=[round(min(1.,max(o,min(w,o+.07*laps+.05))),4) for o,w in zip(old,wear)]
        t['wear']=new;t['laps']+=laps;t['runs']+=1
        if laps>=2:
            n=slot.setdefault('tyre_notes',{}).setdefault(t['compound'],dict(laps=0,wear=0.0))
            n['laps']+=laps;n['wear']=round(n['wear']+(sum(new)-sum(old))/4,5)
    save(conn,d['player_id'],s)


def _grid(s,mine):
    grid=[dict(r) for r in s.get('ai_grid',[])]
    for m in mine:grid.append(dict(id=m['key'],name=m['name'],team=m.get('team',''),time=s['slots'][m['key']]['times'].get('qualifying')))
    grid.sort(key=lambda r:(r['time'] is None,r['time'] or 999,r['id']))
    return grid


def settle(conn,d,run,rows,dnf,cheat,energy_regen):
    s=ensure(conn,d);meta=run['weekend'];key=meta['key'];mine=meta['mine'];slot=s['slots'][key]
    if s['round']!=meta['round'] or slot['stage']!=meta['stage']:raise ValueError('stale weekend')
    phase=meta['phase'];out=dict(round=s['round'],phase=phase,classification=[],points=0,prize=0,key=key)
    if phase!='race':
        clean=[r['time'] for r in rows if r['valid'] and not r['out'] and not r['pit']]
        best=min(clean) if clean else None
        slot['times'][phase]=min(best,slot['times'].get(phase) or best) if best is not None else slot['times'].get(phase)
        field=run.get('timing_field') or timing_field(meta)
        team_of={r['id']:r.get('team','') for r in s['roster']}
        ai=[dict(id=r['id'],name=r['name'],team=team_of.get(r['id'],''),time=min((l['time'] for l in r['laps'] if l['valid']),default=None)) for r in field]
        grid=[dict(r) for r in ai]
        for m in mine:grid.append(dict(id=m['key'],name=m['name'],team=m.get('team',''),time=s['slots'][m['key']]['times'].get(phase)))
        grid.sort(key=lambda r:(r['time'] is None,r['time'] or 999,r['id']))
        if phase=='qualifying':s['ai_grid']=ai;s['grid']=_grid(s,mine)
        out['classification']=grid
    if phase=='race':
        classification=run['race_result']['classification']
        cars={};team_of={r['id']:r.get('team','') for r in s['roster']};team_of.update({m['key']:m.get('team','') for m in mine})
        for i,r in enumerate(classification):
            r['team']=team_of.get(r['id'],'')
            score=POINTS[i] if i<len(POINTS) and r['laps']>=meta.get('laps',RACE_LAPS)*.9 else 0
            r['points']=score;s['points'][r['id']]=s['points'].get(r['id'],0)+score
            if i==0 and not r['dnf']:s['wins'][r['id']]=s['wins'].get(r['id'],0)+1
            if is_mine(r['id']):
                prize=0 if r['dnf'] or cheat else max(100000,420000-(r['position']-1)*16000)
                cars[r['id']]=dict(position=r['position'],points=score,prize=prize,dnf=r['dnf'],time=r['time'])
        out.update(classification=classification,points=sum(c['points'] for c in cars.values()),prize=sum(c['prize'] for c in cars.values()),cars=cars,safety_cars=run['race_result']['safety_cars'])
        s['results'].append(out)
        best=min(cars.values(),key=lambda c:c['position'])
        s['calendar'][s['round']-1].update(status='complete',position=best['position'],points=out['points'],prize=out['prize'],positions=[cars[m['key']]['position'] for m in mine if m['key'] in cars])
        s['round']+=1;s['grid']=[];s['ai_grid']=[]
        _round_slots(s)
        if s['round']<=20:s['calendar'][s['round']-1]['status']='ready'
    else:slot['stage']+=1
    # The selected driver's energy is the only recovery gate. Ignore legacy
    # ready_at/rest_seconds values, including already-paid pending sessions.
    s['ready_at']=0
    out['rest_seconds']=0
    save(conn,d['player_id'],s)
    return out


def timing_field(meta):
    """Deterministic independent stints; the official grid uses these exact laps.

    The lightweight timetable does not run nineteen extra vehicle simulations.
    Dry pace is calibrated against Run on the test circuit with fresh medium tyres.
    """
    phase=meta['phase']
    if phase not in PHASES[:4]:return []
    D=meta.get('duration') or (QUALIFY_SECONDS if phase=='qualifying' else PRACTICE_SECONDS)
    rnd=random.Random(f"timing-stints-v2:{meta['seed']}:{phase}")
    out=[]
    for r in meta['roster']:
        skill=sum(r['skills'].values())/len(r['skills'])
        # Updated from full-physics benchmarks; no blanket practice slowdown.
        base=(66.9-.30*(skill-50)-.08*(r['car']-24)+rnd.uniform(-.35,.35))*meta.get('time_factor',1)
        ch=r.get('character')
        if ch:base/=1+((ch['aggression']-50)*.00012-(ch['patience']-50)*.00008)*(.35+.65*r['skills']['cornering']/100)
        at=0.; laps=[]; segments=[]; compound='M'; stint=0
        def segment(kind,end,tyre):
            nonlocal at
            if end>at:segments.append(dict(kind=kind,start=round(at,3),end=round(min(end,D),3),compound=tyre))
            at=end
        segment('pit',rnd.uniform(3,90),compound)
        while at<D:
            compound=rnd.choice(['S','S','M'] if phase=='qualifying' else ['S','M','M','H'])
            segment('out',at+base*rnd.uniform(1.10,1.20),compound)
            for n in range(rnd.randint(1,2) if phase=='qualifying' else rnd.randint(2,3)):
                tm=round(base+{'S':-.65,'M':0,'H':.85}[compound]+max(0,.4-stint*.25)+n*.12+rnd.uniform(-.3,.45),3)
                if at+tm>D:break
                s1=round(tm*(.315+rnd.uniform(-.003,.003)),3)
                s2=round(tm*(.392+rnd.uniform(-.003,.003)),3)
                lap=dict(start=round(at,3),at=round(at+tm,3),time=tm,sectors=[s1,s2,round(tm-s1-s2,3)],compound=compound,valid=rnd.random()>.035)
                laps.append(lap);segment('flying',at+tm,compound)
            if at>=D:break
            if D-at<base*1.1:
                segment('in',D,compound);break
            segment('in',at+base*rnd.uniform(1.06,1.14),compound)
            segment('pit',at+rnd.uniform(30,85),compound)  # garage/setup work, not a synchronized pit wave
            stint+=1
        out.append(dict(id=r['id'],name=r['name'],laps=laps,segments=segments))
    return out
