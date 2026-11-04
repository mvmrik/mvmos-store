"""Lightweight shared-field race model, mirrored in public/race.js.

A fixed 10 Hz step models acceleration, the circuit speed envelope, traffic,
tyre degradation, fuel, pit travel and neutralisation. The server replays the
paid pit commands and owns the final classification and championship points.
"""
import json
import math
import os
import random
import subprocess

DT=.1
PIT_LANE=1.6           # the fast lane of the pit lane is this far from its centre on one side, the working lane at the garages on the other
BOX_SPACING=12
TYRES={'S':(1.018,.000015),'M':(1.0,.000009),'H':(.986,.000005),'I':(.91,.000011),'W':(.86,.000008)}
# How much water on the track each compound can take: speed is scaled by 1/sqrt(1+(water/WD)^1.2).
WD={'S':.7,'M':.7,'H':.7,'I':2.2,'W':4.5}


def _node_helper(name):
    """A Store install puts everything but .py files into public/, so look there as well as beside this file."""
    here=os.path.dirname(os.path.realpath(__file__))
    for folder in (here,os.path.join(here,'public')):
        p=os.path.join(folder,name)
        if os.path.isfile(p):return p
    return os.path.join(here,name)


def water_at(cfg,t):
    w=cfg.get('weather') or {}
    u=min(1,max(0,(t-cfg['lights'])/max(1,w.get('span',840))))
    return w.get('w0',0)+(w.get('w1',0)-w.get('w0',0))*u


def water_factor(compound,water):
    return 1/math.sqrt(1+(water/WD[compound])**1.2) if water>0 else 1


# Stable passing intentions and following distances; mirrored in public/race.js.
def pass_room(P,frac,L):
    """How much of the straight is left before the speed plan drops for a corner: a pass needs that much room."""
    sp=P['speeds'];n=len(sp);i0=int(frac*n)%n;v0=sp[i0];seg=L/n;k=1
    # no passing in the slow part of the lap: a pass is made on the fast stretches
    vmax=P.get('_vmax')
    if vmax is None:vmax=P['_vmax']=max(sp)
    if v0<.6*vmax:return 0
    while k*seg<700:
        if sp[(i0+k)%n]<.8*v0:return k*seg
        k+=1
    return 700


def lane_limits(P,frac):
    """How far either side of the racing line a car may be, so that it stays inside the track."""
    off=P.get('off')
    lo=off[min(len(off)-1,int(frac*len(off)))] if off else 0
    room=P.get('half',6)-1.3
    return (-room-lo,room-lo)


# The recovery truck is a calculation, not something seen on the track: it leaves the pit box, drives to the car at 50 km/h
# (by the shorter way round), hooks it and brings it back. Meanwhile the field runs behind the safety car; if that has gone
# a lap and the car is still not off the track, the race is stopped (red flag), the cars line up at the pit lane and, when the
# truck is back, restart behind the safety car to the finish line.
TOW_SPEED=50/3.6
TOW_DISPATCH=10
TOW_HOOK=20
SC_SPEED=26


def hash01(s):
    """A repeatable pseudo-random number from a text (the same in the browser and on the server)."""
    h=2166136261
    for ch in s:
        h^=ord(ch);h=(h*16777619)&0xFFFFFFFF
    h^=h>>13;h=(h*1274126177)&0xFFFFFFFF;h^=h>>16
    return h/4294967296


def traffic_plan(c,states,L,target,base,neutral,launch,personal=False,room=1e9,lim=(-99,99)):
    ch=c['e'].get('character') or {};attack=ch.get('aggression',50)/100;defence=ch.get('defence',50)/100;patience=ch.get('patience',50)/100;craft=max(0,min(1,c['e'].get('racecraft',.5)))
    own=c['e']['id']
    peers=[a for a in states if a['id']!=c['e']['id'] and not a['dnf'] and a['finish'] is None and a['pit']==c['pit']]
    def longitudinal(a):return (a['p']-c['p']+L/2)%L-L/2
    def safe(lane):
        for a in peers:
            d=longitudinal(a);room=(5.8 if c['pit'] else 8)+abs(c['v']-a['v'])*.3
            if abs(d)<room and min(c['lane'],lane)-2.2<=a['lane']<=max(c['lane'],lane)+2.2:return False
        return True
    yielding=None
    if personal and not neutral and not c['pit']:
        yielding=next((a for a in peers if a['id']==c['blue_for'] and a['p']-c['p']>L*.5 and -180<longitudinal(a)<12),None)
        if not yielding:
            approaching=sorted([a for a in peers if a['p']-c['p']>L*.5 and -140<longitudinal(a)<0 and a['v']>=c['v']-.3],key=lambda a:abs(longitudinal(a)))
            yielding=approaching[0] if approaching else None
    if personal:
        if yielding and c['blue_for']!=yielding['id']:c['yield_lane']=-2.8 if yielding['lane']>.5 else 2.8
        c['blue_for']=yielding['id'] if yielding else None
    lane=(-1.4 if c['e']['grid']%2==0 else 1.4) if launch else 0
    if c['pit']:
        lane=c.get('pit_lane',0);c['pass_id']=None
        if abs(lane-c['lane'])>.1 and not safe(lane):
            lane=c['lane']
            if c['serviced']:target=0
    elif neutral:
        c['pass_id']=None
        if not safe(lane):lane=c['lane']
    elif yielding:
        c['pass_id']=None;c['defend_id']=None;lane=c['yield_lane']
        if not safe(lane):lane=c['lane']
        target*=.82
    else:
        # Every car drives its racing line. It leaves it only to pass, and only if it judges the pass can work: the car
        # ahead is clearly slower, there is enough straight left to get by, and the side is free and inside the track.
        # How it judges is his own: a bold driver accepts less room, a patient one more, and the less racecraft he has the
        # worse his estimate. The judgement can be wrong, and then the pass fails and he drops back in line.
        reach=30+attack*25 if personal else 45
        def judge(a):
            closing=target-a['kp']*base   # against what the other car could do here, not what a car in front of it lets it do now
            if not base>30 or closing<=(1.2-.5*attack*craft+.2*patience if personal else .4):return False
            needed=(longitudinal(a)+14)*target/closing;error=(hash01(own+'>'+a['id']+':'+str(math.floor(c['p']/L)))-.5)*1.2*(1-craft)
            return needed*(1.15-.5*(attack-.5)-.2*(patience-.5))*(1+error)<=room
        passed=next((a for a in peers if a['id']==c['pass_id']),None)
        if passed:
            d=longitudinal(passed)
            if d<=-10:
                # clear of that car: if the next one ahead looks passable too, he goes on without returning to the line
                cands=sorted([a for a in peers if a['id']!=passed['id'] and 0<longitudinal(a)<reach+15 and abs(a['lane']-c['pass_lane'])>=2.4],key=lambda a:(round(longitudinal(a)*1e6),a['id']))
                nxt=cands[0] if cands else None
                if personal and nxt and judge(nxt) and safe(c['pass_lane']):c['pass_id']=nxt['id'];lane=c['pass_lane']
                else:c['pass_id']=None
            # carry on while level or behind the other car and still quicker than it; if not, back to the line
            elif abs(d)<70 and (d<6 or target>passed['kp']*base+.2):lane=c['pass_lane']
            else:c['pass_id']=None
        if not c['pass_id']:
            obstruction=sorted([a for a in peers if 0<longitudinal(a)<reach and abs(a['lane']-c['lane'])<2.2],key=lambda a:(round(longitudinal(a)*1e6),a['id']))
            ahead=obstruction[0] if obstruction else None
            if ahead and judge(ahead):
                preferred=-ahead['yield_lane'] if personal and ahead.get('blue_for')==c['e']['id'] else c['lane']
                choices=sorted([v for v in (-2.8,2.8) if lim[0]<=v<=lim[1]],key=lambda v:abs(v-preferred))
                choice=next((v for v in choices if abs(v-ahead['lane'])>=2.4 and safe(v)),None)
                if choice is not None:c['pass_id']=ahead['id'];c['pass_lane']=choice;lane=choice
        # A car that is being chased keeps to its line: it neither gives way nor moves across to block.
        # Back to the line is always allowed; a car only holds its lane when the lane it wants is blocked.
        if lane!=0 and not safe(lane):lane=c['lane']
    lane=max(lim[0],min(lim[1],lane))
    step=.45 if c['pit'] and c.get('pit_lane') is not None else .15       # a car turns into its box and back into the lane quickly
    lane=c['lane']+max(-step,min(step,(lane-c['lane'])*DT*(5 if step>.2 else 1.4)))
    ahead=None;gap=1e9
    for a in peers:
        d=(a['p']-c['p'])%L
        if 1e-6<d<L-1e-6 and d<gap and ((neutral and not c['pit']) or min(abs(a['lane']-c['lane']),abs(a['lane']-lane))<2.2):ahead=a;gap=d
    if ahead:
        desired=(12 if neutral and not c['pit'] else 6)+c['v']*(.25+.2*patience if personal else .35)+max(0,c['v']-ahead['v'])*.8
        target=min(target,max(0,ahead['v']+(gap-desired)*.7))
    return dict(lane=lane,ahead=ahead,gap=gap,target=target)

def ai_strategy(rnd,laps,ai_start,pit_tyre):
    """The starting tyre and the stops a computer driver plans for a full-distance race: always two different compounds."""
    if ai_start:          # a damp or wet race: one stop, to the tyre for the conditions
        return ai_start,[dict(lap=round(laps*rnd.uniform(.35,.55)),tyre=pit_tyre)]
    pick=rnd.random()
    if pick<.45:return 'M',[dict(lap=round(laps*rnd.uniform(.34,.44)),tyre='H')]
    if pick<.70:return 'S',[dict(lap=round(laps*rnd.uniform(.17,.23)),tyre='M'),dict(lap=round(laps*rnd.uniform(.50,.60)),tyre='H')]
    return 'H',[dict(lap=round(laps*rnd.uniform(.50,.58)),tyre='M')]


crew = None


def bind(crew_module, rules=None):
    """The pit crew model, shared with the garage so that one set of formulas prices every stop."""
    global crew, driver_rules
    crew = crew_module
    driver_rules = rules or crew_module.D["training_rules"]


def skill_speed(e, base, upcoming, water, t, distance, length, fatigue):
    """Local, observable driver effects; legacy saved entries retain their original model."""
    sk=e.get('driver_skills')
    if not sk:return 1.0
    bend=max(0,min(1,(65-base)/45))
    braking=1 if upcoming<base-2 else 0
    variation=.5+.5*math.sin(t*.7+e['grid'])
    lapse=max(0,math.sin((t+e['grid']*1.37)*.33))**16
    factor=(1+.18*(sk['cornering']-.5)*bend)*(1+.14*(sk['braking']-.5)*braking)
    factor*=1-.04*(1-sk['consistency'])*variation
    factor*=1-.18*(1-sk['focus'])*lapse
    factor*=1-.20*min(1,water/.6)*(1-sk['wet'])
    factor*=1-.015*(1-sk['feedback'])*math.exp(-max(0,distance)/(length*3))
    factor*=1-.08*fatigue*(1-sk['fitness'])
    return factor


# What it takes the crew to fit one spare part, in seconds (mirrored in public/race.js and public/sim.js).
SWAP_SECONDS={'frontWing':4,'rearWing':4,'floor':10,'suspension':10,'brakes':8,'battery':8,'engine':15,'gearbox':15}


def service_seconds(service):
    return sum(SWAP_SECONDS.get(part,10) for part in (service or {}))


def pit_duration(e,stops,tyres,wing,service=None):
    """How long a car stands in its box: the stop of the crew it has, fixed in advance for every stop it can make.
    A long stop (`service`: parts swapped for spares) is the tyre stop, or a short one, plus the work on every part."""
    table=e.get('pit_times')
    if service:
        if not table:return (2.8 if tyres else .8)+service_seconds(service)
        row=table[min(stops,len(table)-1)]
        return (row['tyre'] if tyres else .8)+service_seconds(service)
    if not table:return (2.8 if tyres else .8)+(6 if wing else 0)
    row=table[min(stops,len(table)-1)]
    return row['both'] if tyres and wing else row['tyre'] if tyres else row['repair']


def config(cars,meta,directory):
    """`cars` are the team's entries: dicts with key, view (the driver row of that car and driver), setup, compound,
    tyre_set and crew ({position: profile}). The rivals come from meta['roster']."""
    rnd=random.Random(meta['seed'])
    profile=meta.get('profile')
    if not profile:
        with open(os.path.join(directory,'public','race-profile.json')) as f:profile=json.load(f)
    laps=int(meta.get('laps',12));race_m=laps*profile['length']
    long_race=race_m>60000
    # A full-distance race: the fuel is loaded for it (and burns more slowly than in a short test), tyres last a
    # realistic part of the race, so that stops are needed, and the computer drivers plan them.
    fuel_rate,fuel_k=(.00033,.0004) if long_race else (.00055,.0007)
    wear_scale=min(1.0,63000/(.4*race_m))
    fuel_load=round(race_m*fuel_rate*1.03+1.5,1)
    weather=meta.get('weather') or dict(w0=0,w1=0)
    wet=max(weather['w0'],weather['w1'])
    sets={t['id']:round(sum(t['wear'])/4,4) for car in cars for t in car['tyres']}
    ai_start='W' if wet>1.5 else 'I' if wet>.15 else None
    pit_tyre='W' if wet>1.5 else 'I' if wet>.15 else 'H'
    grid={r['id']:i for i,r in enumerate(meta['grid'])}
    total=len(cars)+len(meta['roster'])
    entries=[]
    rows=[dict(car,mine=True) for car in cars]+[dict(row,mine=False) for row in meta['roster']]
    teams=[]
    for row in rows:
        mine=row['mine']
        if mine:
            d=row['view'];setup=row['setup'];skills=d['skills'];car_level=d['car_level'];name=d['name'];ident=row['key'];character=d.get('character',{});col=0
        else:
            skills=row['skills'];car_level=row['car'];name=row['name'];ident=row['id'];character=row.get('character') or {};col=row['col']
        skills={k:driver_rules.effective_skill(v) for k,v in skills.items()}
        mean=skills['pace']
        energy=d['energy'] if mine else 100
        target=68-.24*(mean-50)-.12*(car_level-20)
        if mine:
            target*=1+sum(d['parts'].values())/len(d['parts'])*.07
            target/=1+d.get('car_mods',{}).get('pace',0)
            target*=1+abs(setup['frontWing']-setup['rearWing'])*.002+(3-setup['engine'])*.007
        if mine:start,plan,pit_lap=row['compound'],None,0
        elif long_race:start,plan=ai_strategy(rnd,laps,ai_start,pit_tyre);pit_lap=0
        else:start,plan=(ai_start or rnd.choice(['S','M'])),None;pit_lap=rnd.randint(4,7)
        crew_levels=crew.levels(row['crew'] if mine else {p:m for p,m in (row.get('crew') or {}).items()})
        pit_times=crew.stop_table(crew_levels,f"stops:{meta['seed']}:{ident}")
        team=row.get('team') or ident if not mine else 'mine'
        if team not in teams:teams.append(team)
        entries.append(dict(team=team,box_off=(min(9,teams.index(team))-5)*BOX_SPACING,livery=row.get('livery',{}) if mine else {},mine=mine,car_level=car_level,character=dict(character),racecraft=(skills['cornering']+skills['reflexes']+skills['composure'])/300,id=ident,name=name,col=col,grid=grid.get(ident,total-1),target=round(target*meta.get('pace',1),6),
                            care=skills['tyreCare']/100,reaction=driver_rules.start_delay(row['view']['skills']['reaction'] if mine else row['skills']['reaction'],energy),
                            driver_skills={k:v/100 for k,v in skills.items()},
                            compound=start,pit_tyre=pit_tyre,pit_plan=plan,wear0=sets.get((row.get('tyre_set') or {}).get('id'),0) if mine else 0,fuel=fuel_load if long_race else (setup['fuel'] if mine else 30),
                            front_wing_wear=d['parts'].get('frontWing',0) if mine else 0,parts=dict(d['parts']) if mine else {},energy=energy,energy_cost=driver_rules.driving_energy(meta.get('energy_base',meta.get('energy',30)),row['view']['skills']['fitness'] if mine else row['skills']['fitness']),pit_lap=pit_lap,
                            pit_times=pit_times,pit_typical=crew.typical(crew_levels)))
    # Recoveries take 2–3 minutes of simulated race time, often multiple slow laps.
    incidents=[]
    rivals=[e for e in entries if not e['mine']]
    est_lap=68*meta.get('pace',1)*1.08
    return dict(pit_boxes=True,traffic_version=3,traffic_from=0,character_from=0,entries=entries,incidents=incidents,seed=meta['seed'],profile=profile,laps=laps,lights=6,weather=dict(w0=weather['w0'],w1=weather['w1'],span=laps*est_lap),wet=wet>.3,tyre_sets=sets,
                fuel_rate=fuel_rate,fuel_k=fuel_k,wear_scale=round(wear_scale,5),max_time=round(laps*est_lap*2+900))


def tyre_rule_met(used):
    """The tyre rule of a race: two different dry compounds must be used, unless rain tyres (intermediate or wet) are used.
    A car that finishes without it is disqualified."""
    u=set(used)
    return 'I' in u or 'W' in u or len([x for x in 'SMH' if x in u])>=2


class Race:
    def __init__(self,cfg,commands=()):
        self.cfg=cfg;self.commands=list(commands);self.command_index=0
        self.t=0;self.sc_until=0;self.safety_cars=[];self.triggered=set();self.done=False
        self.events=[];self.contact_damage={};self.rolled=set();self.flag='green';self.sc_ref=0;self.red_at=0;self.restart_p=0;self.tow_free_at=0;self.extra=0;self.red_flags=[]
        self.cars=[];self.laps_by={e['id']:[] for e in cfg['entries'] if e.get('mine')}
        self.length=cfg['profile']['length']
        for e in cfg['entries']:
            self.cars.append(dict(e=e,parts=dict(e.get('parts') or {}),p=-8-e['grid']*7,v=0,lane=-1.4 if e['grid']%2==0 else 1.4,pass_id=None,pass_lane=0,blue_for=None,yield_lane=0,defend_id=None,defend_lane=0,compound=e['compound'],wear=e.get('wear0',0),request_set=None,request_tyres=True,request_wing=False,wing=e.get('front_wing_wear',0),wing_stops=[],
                                  fuel=e['fuel'],pit=False,box=None,stop_until=0,serviced=False,request=None,stops=0,used=[e['compound']],
                                  hold=None,clear_at=None,pen_due=0,stop_pen=0,stall_until=0,dnf=None,finish=None,penalty=0,lap_start=cfg['lights'],sector_start=cfg['lights'],sectors=[],lap_pit=False,laps=0))
        self.by_id={c['e']['id']:c for c in self.cars}
    def order(self):
        return sorted(self.cars,key=lambda c:(bool(c['dnf']),c['finish'] is None,(c['finish'] or 0)+c['penalty'] if c['finish'] else -c['p'],c['e']['id']))
    def crash_chance(self,c,L):
        """The chance that one of the team's own cars crashes on the lap it is starting: what the parts have worn to by now
        (they wear as the race goes) and how tired the driver is. Changing a part at the box lowers it from then on."""
        cfg=self.cfg;e=c['e'];rates=cfg['wear_rates'];km=c['p']/1000.0/cfg['wear_km']
        worst=max([min(1.0,c['parts'].get(k,0)+r*km) for k,r in rates.items()] or [0])
        total=.03+worst*.04+(1-e.get('energy',100)/100)*.10          # over the stretch of the race in which crashes can happen
        window=max(1,int(cfg['laps']*7/12+.5))
        return 1-(1-total)**(1/window)

    def rival_chance(self,e):
        """The same for the computer's cars: what the driver is good at and how good the car is, over the stretch of the race in which crashes happen."""
        sk=e['driver_skills'];s=(sk['focus']+sk['composure']+sk['consistency']+sk['cornering'])/4
        total=.015+.05*(1-s)+.02*(1-min(1,e.get('car_level',20)/50))
        window=max(1,int(self.cfg['laps']*7/12+.5))
        return 1-(1-total)**(1/window)

    def roll_crashes(self,t,L):
        cfg=self.cfg
        if 'wear_rates' not in cfg:return                          # a race configured before crashes were rolled lap by lap
        if self.flag!='green':                                      # no new crash while the track is neutral
            for c in self.cars:c['crash_at']=None
            return
        for c in self.cars:
            e=c['e']
            if c['dnf'] or c['finish'] is not None:continue
            if c.get('crash_at') is not None:
                if c['p']>=c['crash_at']:
                    c['crash_at']=None;self.crash_car(c,t,L)
                    if self.flag!='green':break
                continue
            lap=math.floor(c['p']/L)
            if lap<1 or lap<=c.get('risk_lap',0):continue
            c['risk_lap']=lap
            if not cfg['laps']*3/12<=lap<=cfg['laps']*10/12:continue
            chance=self.crash_chance(c,L) if e.get('mine') else self.rival_chance(e)
            if hash01(f"{cfg['seed']}:crash:{e['id']}:{lap}")<chance:   # it happens somewhere on this lap
                c['crash_at']=(lap+.04+.9*hash01(f"{cfg['seed']}:crashat:{e['id']}:{lap}"))*L

    def contact_chance(self,a,d,t):
        """The chance that a pass ends in contact when two cars are alongside: how well the attacker judges it (racecraft, nerve, how bold he is
        and how tired), how quickly the defender reacts, and how wet the track is."""
        ea=a['e'];ska=ea.get('driver_skills') or {};skd=d['e'].get('driver_skills') or {}
        attack=(ea.get('character') or {}).get('aggression',50)/100;craft=max(0,min(1,ea.get('racecraft',.5)))
        water=water_at(self.cfg,t)
        rain=.012*min(1,water/3)                                      # the more water on the track, the more likely
        # dry tyres in the wet (the attacker's and, less, the defender's) and wet tyres on a dry track slide much more
        wrong=(.02*min(1,water/1.5) if a['compound'] in 'SMH' and water>.3 else 0)+(.01*min(1,water/1.5) if d['compound'] in 'SMH' and water>.3 else 0)+(.005 if a['compound'] in 'IW' and water<.05 else 0)
        return .004+.03*(1-craft)*(.4+attack)+.02*(1-ska.get('composure',.5))+.012*(1-skd.get('reflexes',.5))+rain+wrong+.02*(1-ea.get('energy',100)/100)

    def check_contacts(self,t,L):
        if 'wear_rates' not in self.cfg or self.flag!='green':return
        for a in self.cars:
            if a['dnf'] or a['finish'] is not None or a['pit'] or not a.get('pass_id'):continue
            d=self.by_id.get(a['pass_id'])
            if not d or d['dnf'] or d['finish'] is not None or d['pit']:continue
            if abs((d['p']-a['p']+L/2)%L-L/2)>7:continue                 # not alongside
            key=f"{a['e']['id']}>{d['e']['id']}:{math.floor(a['p']/L)}"
            if key in self.rolled:continue
            self.rolled.add(key)
            if hash01(f"{self.cfg['seed']}:contact:{key}")<self.contact_chance(a,d,t):
                self.contact(a,d,key,t,L)
                if self.flag!='green':break

    def contact(self,a,d,key,t,L):
        """Two cars touch. How hard is rolled; so is who is to blame: usually the one who attacked, sometimes the one who closed the door."""
        seed=self.cfg['seed'];u=hash01(f"{seed}:tier:{key}");tier='touch' if u<.62 else 'spin' if u<.90 else 'crash'
        guilty,victim=(a,d) if hash01(f"{seed}:fault:{key}")<.72 else (d,a)
        self.events.append(dict(t=round(t,2),type='contact',id=guilty['e']['id'],other=victim['e']['id'],tier=tier))
        hit=.08 if tier=='touch' else .12
        for x in (a,d):
            x['wing']=min(1,x['wing']+hit)
            if x['e'].get('mine'):self.contact_damage[x['e']['id']]=round(self.contact_damage.get(x['e']['id'],0)+hit,4)
        if tier=='touch':
            a['v']*=.9;d['v']*=.9;self.penalise(guilty,5,victim,t)
        elif tier=='spin':
            victim['v']=0;victim['stall_until']=t+6;guilty['v']*=.8;self.penalise(guilty,10,victim,t)
        else:
            self.crash_car(victim,t,L)
            if hash01(f"{seed}:both:{key}")<.5:self.crash_car(guilty,t,L)
            else:self.penalise(guilty,10,victim,t)

    def penalise(self,c,seconds,other,t):
        """A time penalty: served in the next stop, which is that much longer, or added to the finishing time."""
        c['pen_due']+=seconds
        self.events.append(dict(t=round(t,2),type='penalty',id=c['e']['id'],other=other['e']['id'],secs=seconds))

    def crash_car(self,c,t,L):
        """The car stops where it is; the truck is on its way. The track is neutral until the last car is off it."""
        c['dnf']='crash';c['v']=0
        delta=(c['p']-self.cfg['profile']['pitBox']*L)%L;distance=min(delta,L-delta)
        clear=round(max(t+TOW_DISPATCH,self.tow_free_at)+2*distance/TOW_SPEED+TOW_HOOK,3)
        self.extra+=clear-t;self.tow_free_at=clear;c['clear_at']=clear
        self.sc_until=max(self.sc_until,clear);self.safety_cars.append(dict(t=t,end=clear,id=c['e']['id']))
        if self.flag=='green':
            self.flag='sc';runners=[x['p'] for x in self.cars if not x['dnf'] and x['finish'] is None]
            self.sc_ref=max(runners) if runners else c['p']
            # The lap the leader is on does not count. The two laps after it do, and the field comes in at the pit entry of the
            # second one, before it crosses the line again, if the track is still not clear by then.
            self.red_at=(math.floor(self.sc_ref/L)+2)*L+self.cfg['profile']['pitIn']*L

    def update_flag(self,t,L):
        f=self.flag
        if f=='green':return
        runners=[c for c in self.cars if not c['dnf'] and c['finish'] is None]
        lead=max((c['p'] for c in runners),default=0)
        if f=='sc':
            if t>=self.sc_until:self.flag='green'
            elif lead>=self.red_at:self.start_red(t,L)          # two laps behind the safety car and the track is still not clear
        elif f=='red':
            if t>=self.sc_until:self.start_restart(L,lead)
        elif f=='restart':
            if lead>=self.restart_p:self.flag='green'

    def start_red(self,t,L):
        self.flag='red';self.red_flags.append(round(t,2));box=self.cfg['profile']['pitBox']*L
        for c in self.cars:
            if c['dnf'] or c['finish'] is not None:continue
            c['hold']=box+L*math.ceil((c['p']+25-box)/L)           # the pit lane ahead of it, where it waits
            c['pit']=False;c['box']=None;c['serviced']=False;c['stop_until']=0;c['lap_pit']=True

    def start_restart(self,L,lead):
        self.flag='restart';self.restart_p=(math.floor(lead/L)+1)*L
        if self.restart_p<lead+20:self.restart_p+=L
        for c in self.cars:c['hold']=None

    def step(self):
        if self.done:return
        self.t=round(self.t+DT,4);t=self.t;L=self.length;P=self.cfg['profile']
        while self.command_index<len(self.commands) and self.commands[self.command_index]['t']<=t+.00001:
            cmd=self.commands[self.command_index];self.command_index+=1
            player=self.by_id.get(cmd.get('car') or 'player')
            if not player or not player['e'].get('mine'):continue
            player['request']=cmd.get('compound') or player['compound'];player['request_pass']=cmd.get('pass') is True;player['request_set']=cmd.get('set');player['request_tyres']=bool(cmd.get('compound'));player['request_wing']=cmd.get('wing') is True;player['request_wing_unit']=cmd.get('wing_unit');player['request_service']=cmd.get('service') or {}
        for i,event in enumerate(self.cfg['incidents']):
            if i in self.triggered:continue
            c=next(c for c in self.cars if c['e']['id']==event['id'])
            if c['p']>=event['distance']*L and not c['finish']:
                self.triggered.add(i);c['dnf']='crash';c['v']=0
                end=t+event['clearance'];self.sc_until=max(self.sc_until,end)
                self.safety_cars.append(dict(t=t,end=end,id=event['id']))
        self.roll_crashes(t,L)
        self.update_flag(t,L)
        self.check_contacts(t,L)
        running=[x for x in self.cars if not x['dnf'] and x['finish'] is None]
        self.leader=max(running,key=lambda x:(round(x['p']*1e6),-x['e']['grid']))['e']['id'] if running else None
        modern=self.cfg.get('traffic_version',0)>=2 and t>self.cfg.get('traffic_from',0)+.00001
        neutral=t<self.sc_until or self.flag!='green'
        boxes=bool(self.cfg.get('pit_boxes'))
        ordered=sorted(self.cars,key=lambda c:(-round(c['p']*1e6),c['e']['grid']))
        snapshot={c['e']['id']:dict(id=c['e']['id'],blue_for=c['blue_for'],yield_lane=c['yield_lane'],p=c['p'],v=c['v'],kp=c.get('kp',1),lane=c['lane'],pit=c['pit'],dnf=c['dnf'],finish=c['finish']) for c in self.cars}
        for c in ordered:
            e=c['e'];old=c['p']
            if c['dnf'] or c['finish'] is not None or t<self.cfg['lights']+e['reaction']:continue
            if t<c['stall_until']:c['v']=0;continue                  # spun and facing the wrong way for a few seconds
            lap=max(0,int(old/L));frac=(old%L)/L
            if not e.get('mine'):
                plan=e.get('pit_plan')                                # the stops a computer driver has planned: the lap and the tyre for each
                if plan:
                    if c['stops']<len(plan) and lap>=plan[c['stops']]['lap']:c['request']=plan[c['stops']]['tyre']
                elif e['pit_lap'] and lap>=e['pit_lap'] and c['stops']==0:c['request']=e.get('pit_tyre','H')
            if c['request'] and not c['pit'] and frac>=P['pitIn'] and frac<P['pitIn']+.025 and old>0:
                c['pit']=True;c['box']=math.floor(old/L)*L+P['pitBox']*L+(e.get('box_off',0) if boxes else 0);c['serviced']=bool(c.get('request_pass'));c['pass_through']=bool(c.get('request_pass'));c['request_pass']=False;c['lap_pit']=True
                if c['pass_through']:c['request']=None
                if boxes:c['exit']=(math.floor(old/L)+1+P['pitOut'])*L;c['ready_at']=None
            if c['pit'] and c['serviced'] and old>=(c['exit'] if c.get('exit') is not None else c['box']+(1-P['pitBox']+P['pitOut'])*L):
                c['pit']=False;c['box']=None;c['serviced']=False;c['exit']=None;c['ready_at']=None;c['pass_through']=False
            grip,wear_rate=TYRES[c['compound']]
            base=P['speeds'][min(len(P['speeds'])-1,int(frac*len(P['speeds'])))]
            target=base*65/e['target']*grip*water_factor(c['compound'],water_at(self.cfg,t))*(1-min(.30,c['wear']*.32))*(1-c['fuel']*self.cfg.get('fuel_k',.0007))
            fatigue=1-max(0,e.get('energy',100)-e.get('energy_cost',0)*min(1,max(0,old)/(self.cfg['laps']*L)))/100
            target*=(1-.08*fatigue)*(1+.08*(e.get('front_wing_wear',0)-c['wing']))
            upcoming=P['speeds'][int((frac+.012)%1*len(P['speeds']))]
            target*=skill_speed(e,base,upcoming,water_at(self.cfg,t),t,old,L,fatigue)
            if neutral and (self.flag=='green' or c['e']['id']==self.leader):target=min(target,SC_SPEED)   # only the leader sets the pace; the others close up on the car ahead
            if self.flag=='red' and c['hold'] is not None:target=min(target,22.22,math.sqrt(2*9*max(0,c['hold']-old)))
            if c['pit']:
                target=min(target,22.22)
                busy=boxes and any(o is not c and o['pit'] and not o['dnf'] and o['finish'] is None and not o.get('pass_through') and o['box'] is not None and abs((o['box']-c['box']+L/2)%L-L/2)<1 and
                    (o['stop_until']>0 or o['serviced'] and o['p']<o['box']+12 or not o['serviced'] and (o['p']-o['box']>old-c['box']+.001 or abs(o['p']-o['box']-(old-c['box']))<.001 and o['e']['grid']<e['grid'])) for o in self.cars)
                if busy and not c['serviced']:target=min(target,math.sqrt(2*9*max(0,c['box']-6-old)))
                if not c['serviced'] and not busy and old>=c['box']-1 and (not boxes or not modern or c['lane']<-PIT_LANE+.35):
                    if c['stop_until']==0:c['stop_until']=t+pit_duration(e,c['stops'],c['request_tyres'],c['request_wing'],c.get('request_service'))+c['pen_due'];c['stop_pen']=c['pen_due'];c['v']=0
                    if t<c['stop_until']:continue
                    if c['request_tyres']:
                        c['compound']=c['request'] or c['compound'];c['used'].append(c['compound'])
                        c['wear']=self.cfg.get('tyre_sets',{}).get(c.get('request_set'),0)
                    spares=self.cfg.get('spares',{});stop=round(c['p'],4);swapped={}
                    if c['request_wing']:swapped['frontWing']=c.get('request_wing_unit')
                    swapped.update(c.get('request_service') or {})
                    if 'frontWing' in swapped:c['wing']=spares.get(swapped['frontWing'],0);c['wing_stops'].append(stop)
                    for part,unit in swapped.items():
                        if unit in spares:c['parts'][part]=spares[unit]
                    if swapped:c.setdefault('service_stops',[]).append(dict(p=stop,swap=swapped))
                    c['request_wing_unit']=None;c['request_service']={}
                    if c['stop_pen']:
                        self.events.append(dict(t=round(t,2),type='served',id=e['id'],secs=c['stop_pen']));c['pen_due']=max(0,c['pen_due']-c['stop_pen']);c['stop_pen']=0
                    c['request']=None;c['request_set']=None;c['request_wing']=False;c['serviced']=True;c['stops']+=1;c['stop_until']=0
                elif not c['serviced']:target=min(target,math.sqrt(2*9*max(0,c['box']-old)))
                if boxes:
                    # Passing traffic has priority; a teammate queues in the
                    # working lane. Never force a release after a timeout.
                    if c['serviced'] and not c.get('pass_through') and old<c['box']+12:
                        if c['ready_at'] is None:c['ready_at']=t
                        blocked=False
                        for o in self.cars:
                            if o is c or not o['pit'] or o['dnf'] or o['finish'] is not None:continue
                            d=(o['p']-old+L/2)%L-L/2
                            if o['lane']>0 and -max(20,o['v']*2.5+8)<d<20:blocked=True;break
                            if o['serviced'] and not o.get('pass_through') and o['p']<o['box']+12 and abs(d)<24 and o['ready_at'] is not None and (o['ready_at']<c['ready_at'] or o['ready_at']==c['ready_at'] and o['e']['grid']<e['grid']):blocked=True;break
                        if blocked:c['v']=0;continue
                    c['pit_lane']=-PIT_LANE if not c['serviced'] and c['box']-old<(18 if busy else 12) else PIT_LANE
            lane=0
            ahead=None;gap=1e9
            c['kp']=target/base if base>0 else 1   # how quick this car is compared with the speed plan of the place it is at
            if modern:
                plan=traffic_plan(c,list(snapshot.values()),L,target,base,neutral,t<self.cfg['lights']+5 or old<80,self.cfg.get('traffic_version',0)>=3 and t>self.cfg.get('character_from',0)+.00001,pass_room(P,frac,L),[-PIT_LANE,PIT_LANE] if c['pit'] else lane_limits(P,frac))
                c['lane']=plan['lane'];ahead=plan['ahead'];gap=plan['gap'];target=plan['target']
            else:
                for other in self.cars:
                    a=snapshot[other['e']['id']]
                    if other is c or a['dnf'] or a['finish'] is not None or a['pit']!=c['pit']:continue
                    delta=(a['p']-old)%L
                    if delta>0 and delta<gap:ahead=a;gap=delta
                if c['pit']:lane=0
                elif neutral:
                    if ahead and gap<35:target=min(target,max(0,ahead['v']+(gap-12)*.8))
                elif ahead and gap<32:
                    if target>ahead['v']+.35 and base>34:lane=2.6 if ahead['lane']<=0 else -2.6
                    elif gap<12:target=min(target,max(0,ahead['v']+(gap-8)*.9))
                c['lane']+=(lane-c['lane'])*min(1,DT*2)
            sk=e.get('driver_skills')
            if sk and ahead and gap<30 and not neutral and not c['pit']:
                target*=1-.08*(1-sk['composure'])-.05*(1-sk['reflexes'])
            previous_v=c['v'];acc=(7*(.7+.6*sk['traction']) if sk else 7) if target>c['v'] else (18*(.8+.4*sk['braking']) if sk else 18)
            c['v']+=max(-acc*DT,min(acc*DT,target-c['v']))
            move=max(0,c['v']*DT)
            if ahead and ((neutral and not c['pit']) or abs(c['lane']-ahead['lane'])<(2.2 if modern else 1.9)):
                advance=max(0,next(o for o in self.cars if o['e']['id']==ahead['id'])['p']-ahead['p']) if modern else 0
                move=min(move,max(0,gap-(5.8 if modern else 6)+advance))
            if modern:c['v']=move/DT
            c['p']+=move;c['fuel']=max(0,c['fuel']-move*self.cfg.get('fuel_rate',.00055));c['wear']=min(1,c['wear']+move*wear_rate*self.cfg.get('wear_scale',1)*(1.3-.5*e['care']))
            if c['fuel']<=0:c['dnf']='fuel';c['v']=0
            # Three sector boundaries per lap. A grid launch starts the first clock.
            for lap_index in range(math.floor(max(0,old)/L),math.floor(max(0,c['p'])/L)+1):
                for sector_index,cut in enumerate(P['sectors']+[1]):
                    boundary=(lap_index+cut)*L
                    if not old<boundary<=c['p']:continue
                    c['sectors'].append(round(t-c['sector_start'],3));c['sector_start']=t
                    if sector_index==2:
                        c['laps']=lap_index+1
                        if e.get('mine'):self.laps_by[e['id']].append(dict(time=round(t-c['lap_start'],3),sectors=c['sectors'][-3:],valid=not c['lap_pit'],out=False,pit=c['lap_pit'],pen=0))
                        c['lap_start']=t;c['lap_pit']=c['pit']
            if c['p']>=self.cfg['laps']*L:
                c['finish']=t-self.cfg['lights'];c['v']=0;c['penalty']+=c['pen_due'];c['pen_due']=0
                if not tyre_rule_met(c['used']):c['dnf']='dsq'
        if all(c['dnf'] or c['finish'] is not None for c in self.cars) or t>self.cfg.get('max_time',3500)+self.extra:self.done=True
    def result(self):
        classification=[]
        for i,c in enumerate(self.order()):
            classification.append(dict(id=c['e']['id'],name=c['e']['name'],position=i+1,time=round(c['finish']+c['penalty'],3) if c['finish'] is not None else None,
                                       laps=c['laps'],dnf=c['dnf'] or ('recovery' if c['finish'] is None else None),stops=c['stops'],pen_due=c['pen_due'],penalty=c['penalty']))
        return dict(classification=classification,laps=self.laps_by.get('player',[]),laps_by=self.laps_by,duration=round(self.t-self.cfg['lights'],3),safety_cars=self.safety_cars,red_flags=self.red_flags,events=self.events,contact_damage=self.contact_damage,
                    wing_replacements={i:c['wing_stops'] for i,c in self.by_id.items() if c['e'].get('mine')},
                    service_stops={i:c.get('service_stops',[]) for i,c in self.by_id.items() if c['e'].get('mine')})


def simulate_python(cfg,commands):
    race=Race(cfg,commands)
    while not race.done:race.step()
    return race.result()


def simulate(cfg,commands):
    """The result of a race. A full-distance race takes minutes in Python, so the same engine the browser runs
    (public/race.js) is run by node when it is there; Python is the fallback and gives the same result."""
    try:
        out=subprocess.run(['node',_node_helper('race_node.mjs')],input=json.dumps(dict(cfg=cfg,commands=list(commands))),
                           capture_output=True,text=True,timeout=300)
        if out.returncode==0 and out.stdout:return json.loads(out.stdout)
    except (OSError,ValueError,subprocess.TimeoutExpired):pass
    return simulate_python(cfg,commands)
