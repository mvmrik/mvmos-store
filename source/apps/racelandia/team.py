"""Owned cars, employed drivers, candidate market and the team's financial ledger.

The existing driver row remains the active car/driver projection used by the
race engine. Only this module swaps projections, inside a write transaction.
Inactive assets are retained independently; money, research and stock are shared.
"""
import json
import math
import random
import re
import time
import uuid

CAR_FIELDS = ('car_id', 'car_level', 'parts', 'fitted', 'setup', 'setups')
PILOT_FIELDS = ('pilot_id', 'name', 'age', 'age_origin', 'age_checked', 'recruited_at',
                'skills', 'potential', 'character', 'energy', 'energy_ts', 'trainings')
D = None


def bind(context):
    global D
    D = context


def schema(conn):
    cols = {r[1] for r in conn.execute('PRAGMA table_info(driver)')}
    for key, spec in {'staff_ts':'REAL NOT NULL DEFAULT 0', 'finance_category':"TEXT NOT NULL DEFAULT 'adjustment'", 'finance_detail':"TEXT NOT NULL DEFAULT '{}'"}.items():
        if key not in cols:
            conn.execute(f'ALTER TABLE driver ADD COLUMN {key} {spec}')
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS team_car (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, number INTEGER NOT NULL,
      profile TEXT NOT NULL, pilot_id TEXT, created REAL NOT NULL,
      UNIQUE(player_id,number));
    CREATE INDEX IF NOT EXISTS idx_team_car_owner ON team_car(player_id);
    CREATE TABLE IF NOT EXISTS team_pilot (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, profile TEXT NOT NULL,
      payroll_at REAL NOT NULL, created REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_team_pilot_owner ON team_pilot(player_id);
    CREATE TABLE IF NOT EXISTS team_offer (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, slot INTEGER NOT NULL,
      week INTEGER NOT NULL, profile TEXT NOT NULL, UNIQUE(player_id,slot));
    CREATE TABLE IF NOT EXISTS finance_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, at REAL NOT NULL,
      category TEXT NOT NULL, detail TEXT NOT NULL, amount INTEGER NOT NULL, balance INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_finance_owner ON finance_ledger(player_id,id);
    CREATE TRIGGER IF NOT EXISTS apex_budget_ledger AFTER UPDATE OF budget ON driver
    WHEN NEW.budget != OLD.budget BEGIN
      INSERT INTO finance_ledger(player_id,at,category,detail,amount,balance)
      VALUES(NEW.player_id,(julianday('now')-2440587.5)*86400,NEW.finance_category,NEW.finance_detail,NEW.budget-OLD.budget,NEW.budget);
      UPDATE driver SET finance_category='adjustment',finance_detail='{}' WHERE player_id=NEW.player_id;
    END;
    """)
    if 'livery' not in {r[1] for r in conn.execute('PRAGMA table_info(team_car)')}:
        conn.execute("ALTER TABLE team_car ADD COLUMN livery TEXT NOT NULL DEFAULT '{}'")
    D['crew'].schema(conn)
    D['specialists'].schema(conn)
    D['rivals'].schema(conn)


def note(conn, pid, category, detail=None):
    conn.execute('UPDATE driver SET finance_category=?,finance_detail=? WHERE player_id=?',
                 (category, json.dumps(detail or {}), pid))


def write_projection(conn, pid, fields):
    conn.execute('UPDATE driver SET '+','.join(k+'=?' for k in fields)+' WHERE player_id=?',
                 [json.dumps(v) if isinstance(v,(dict,list)) else v for v in fields.values()]+[pid])


def snapshot(d, fields):
    return {k:d[k] for k in fields}


def sync(conn, d):
    """Save the active projection, including changes made by existing game actions."""
    pid, now = d['player_id'], time.time()
    if not conn.execute('SELECT 1 FROM finance_ledger WHERE player_id=? LIMIT 1',(pid,)).fetchone():
        conn.execute('INSERT INTO finance_ledger(player_id,at,category,detail,amount,balance) VALUES(?,?,?,?,?,?)',
                     (pid,now,'opening','{}',d['budget'],d['budget']))
    if not d['staff_ts']:
        conn.execute('UPDATE driver SET staff_ts=? WHERE player_id=?',(now,pid));d['staff_ts']=now
    if d['has_driver']:
        conn.execute('INSERT INTO team_pilot VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile',
                     (d['pilot_id'],pid,json.dumps(snapshot(d,PILOT_FIELDS)),now,now))
    if d['has_car']:
        number=conn.execute('SELECT COALESCE(MAX(number),0)+1 FROM team_car WHERE player_id=?',(pid,)).fetchone()[0]
        # Legacy cars keep their existing driver; newly purchased cars explicitly start unassigned.
        conn.execute('INSERT INTO team_car(id,player_id,number,profile,pilot_id,created) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile',
                     (d['car_id'],pid,number,json.dumps(snapshot(d,CAR_FIELDS)),d['pilot_id'] if d['has_driver'] else None,now))


def pilot_at(profile, now, regen=None):
    p=dict(profile);p['skills']=dict(p['skills']);p['potential']=dict(p['potential'])
    age=17+max(0,now-p['age_origin'])/D['AGE_YEAR_SECONDS']
    before=17+max(0,(p['age_checked'] or now)-p['age_origin'])/D['AGE_YEAR_SECONDS']
    for key in D['SKILLS']:
        loss=max(0,D['_age_penalty'](age,key)-D['_age_penalty'](before,key))
        p['skills'][key]=max(D['SKILL_FLOOR'],p['skills'][key]-loss)
        p['potential'][key]=max(D['SKILL_FLOOR'],p['potential'][key]-loss)
    p.update(age=int(age),age_checked=max(now,p['age_checked']),
             energy=min(100,p['energy']+max(0,now-p['energy_ts'])*(D['ENERGY_REGEN'] if regen is None else regen)),energy_ts=max(now,p['energy_ts']))
    return p


def salary(p):
    overall=sum(p['skills'].values())/len(D['SKILLS'])
    return int(round((150+1.2*overall**2)/50)*50)


def roster(conn, d):
    now=time.time();pid=d['player_id'];regen=D['specialists'].regen(conn,pid)
    cars=[dict(id=r['id'],number=r['number'],key=SLOT_KEYS[min(i,len(SLOT_KEYS)-1)],pilot_id=r['pilot_id'],level=json.loads(r['profile'])['car_level'],parts=json.loads(r['profile'])['parts'],livery=json.loads(r['livery']))
          for i,r in enumerate(conn.execute('SELECT * FROM team_car WHERE player_id=? ORDER BY number',(pid,)))]
    pilots=[]
    for r in conn.execute('SELECT * FROM team_pilot WHERE player_id=? ORDER BY created,id',(pid,)):
        p=pilot_at(json.loads(r['profile']),now,regen)
        pilots.append(dict(id=r['id'],name=p['name'],age=p['age'],overall=round(sum(p['skills'].values())/len(D['SKILLS']),1),
                           energy=p['energy'],salary=salary(p),stars=round(min(5,max(1,2+(sum(p["potential"].values())/len(D["SKILLS"])-70)/8)),1)))
    return dict(cars=cars,pilots=pilots,active_car=d['car_id'],active_pilot=d['pilot_id'],team_name=d.get('team_name',''))


SLOT_KEYS=('player','player2')
MAX_CARS=2


def slots(conn,d):
    """The two entries of the team in a championship: the cars numbered first and second, each with its driver."""
    now=time.time();pid=d['player_id'];out=[];regen=D['specialists'].regen(conn,pid)
    for i,r in enumerate(conn.execute('SELECT * FROM team_car WHERE player_id=? ORDER BY number LIMIT ?',(pid,MAX_CARS)).fetchall()):
        car=snapshot(d,CAR_FIELDS) if r['id']==d['car_id'] else json.loads(r['profile'])
        pilot=None
        if r['pilot_id']:
            if r['pilot_id']==d['pilot_id'] and d['has_driver']:pilot=snapshot(d,PILOT_FIELDS)
            else:
                row=conn.execute('SELECT profile FROM team_pilot WHERE id=? AND player_id=?',(r['pilot_id'],pid)).fetchone()
                pilot=pilot_at(json.loads(row['profile']),now,regen) if row else None
        out.append(dict(key=SLOT_KEYS[i],car_id=r['id'],number=r['number'],car=car,pilot_id=r['pilot_id'] if pilot else None,pilot=pilot))
    return out


def slot_of(conn,d):
    """The entry key of the car that is open now ('player' or 'player2'), or None when it is not one of the two."""
    return next((s['key'] for s in slots(conn,d) if s['car_id']==d['car_id']),None)


def slot_view(d,slot):
    """The driver row as it would be if this entry's car and driver were the open ones."""
    if slot['car_id']==d['car_id'] and slot['pilot_id']==d['pilot_id']:return d
    v=dict(d);v.update(slot['car']);v.update(slot['pilot'] or {});v.update(has_car=1,has_driver=1,car_id=slot['car_id'],pilot_id=slot['pilot_id'])
    return v


def switch(conn,d,car_id,pilot_id):
    """Open another car and driver inside a running transaction (no lock checks: only for settling a session)."""
    sync(conn,d)
    row=conn.execute('SELECT * FROM team_car WHERE id=? AND player_id=?',(car_id,d['player_id'])).fetchone()
    p=json.loads(row['profile']);write_projection(conn,d['player_id'],dict(p,has_car=1));d.update(p,has_car=1)
    if pilot_id:return activate_pilot(conn,d,pilot_id)
    return None


def spend_energy(conn,d,pilot_id,amount):
    """Take energy from a driver, whether they are the open one or one in the team's list."""
    now=time.time()
    if pilot_id==d['pilot_id']:
        conn.execute('UPDATE driver SET energy=MAX(0,energy-?),energy_ts=? WHERE player_id=?',(amount,now,d['player_id']));return
    row=conn.execute('SELECT profile FROM team_pilot WHERE id=? AND player_id=?',(pilot_id,d['player_id'])).fetchone()
    if not row:return
    p=pilot_at(json.loads(row['profile']),now,D['specialists'].regen(conn,d['player_id']));p['energy']=max(0,p['energy']-amount);p['energy_ts']=now
    conn.execute('UPDATE team_pilot SET profile=? WHERE id=?',(json.dumps(p),pilot_id))


def locked(conn,d,selecting=False):
    """Why the team cannot be rearranged now. Looking at another car or driver is allowed between sessions
    (the two cars of a weekend are used in turn); giving a driver another car is not, once a car has qualified."""
    if D['_busy'](conn,d['player_id']): return 'busy'
    if selecting: return None
    state=D['season'].ensure(conn,d)
    if any(state['slots'][k]['locked_setup'] for k in SLOT_KEYS): return 'parc_ferme'
    return None


def activate_pilot(conn,d,pilot_id):
    row=conn.execute('SELECT * FROM team_pilot WHERE id=? AND player_id=?',(pilot_id,d['player_id'])).fetchone()
    if not row:return 'driver'
    p=pilot_at(json.loads(row['profile']),time.time(),D['specialists'].regen(conn,d['player_id']))
    write_projection(conn,d['player_id'],dict(p,has_driver=1));d.update(p,has_driver=1)
    return None


def select(conn,d,kind,ident):
    same=(d['car_id'] if kind=='car' else d['pilot_id'])==ident
    error=locked(conn,d,True)
    if error and not same:return error
    sync(conn,d)
    if kind=='pilot':
        return activate_pilot(conn,d,ident)
    row=conn.execute('SELECT * FROM team_car WHERE id=? AND player_id=?',(ident,d['player_id'])).fetchone()
    if not row:return 'car'
    p=json.loads(row['profile']);write_projection(conn,d['player_id'],dict(p,has_car=1));d.update(p,has_car=1)
    if row['pilot_id'] and row['pilot_id']!=d['pilot_id']:
        if error:return error
        return activate_pilot(conn,d,row['pilot_id'])
    return None


def assign(conn,d,car_id,pilot_id):
    error=locked(conn,d)
    if error:return error
    car=conn.execute('SELECT id FROM team_car WHERE id=? AND player_id=?',(car_id,d['player_id'])).fetchone()
    if not car:return 'car'
    if pilot_id and not conn.execute('SELECT 1 FROM team_pilot WHERE id=? AND player_id=?',(pilot_id,d['player_id'])).fetchone():return 'driver'
    sync(conn,d)
    # A driver has one seat. Moving them explicitly frees their previous car.
    if pilot_id:conn.execute('UPDATE team_car SET pilot_id=NULL WHERE player_id=? AND pilot_id=?',(d['player_id'],pilot_id))
    conn.execute('UPDATE team_car SET pilot_id=? WHERE id=? AND player_id=?',(pilot_id,car_id,d['player_id']))
    if car_id==d['car_id'] and pilot_id:return activate_pilot(conn,d,pilot_id)
    return None


def race_driver(conn,d):
    row=conn.execute('SELECT pilot_id FROM team_car WHERE id=? AND player_id=?',(d['car_id'],d['player_id'])).fetchone()
    if not row or not row['pilot_id']:return 'assignment'
    if row['pilot_id']!=d['pilot_id']:
        sync(conn,d)
        return activate_pilot(conn,d,row['pilot_id'])
    return None


def new_offer(pid,cap=98):
    """A young driver on the market. `cap` is the best potential the team's scout can find."""
    rnd=random.SystemRandom();ceiling=rnd.uniform(min(cap,max(40,cap-35)),cap)
    age=17;potential={k:round(min(cap,max(min(cap,40),ceiling+rnd.gauss(0,5))),2) for k in D['SKILLS']}
    skills={k:min(rnd.randint(40,50),int(potential[k])) for k in D['SKILLS']}
    overall=sum(skills.values())/len(skills);headroom=sum(potential[k]-skills[k] for k in skills)/len(skills)
    first=rnd.choice(['Alex','Jamie','Robin','Sam','Casey','Jordan','Riley','Taylor','Drew','Avery','Logan','Morgan','Sasha','Noah','Nico','Mika','Luca','Emil','Kai','Toni'])
    last=rnd.choice(['Morgan','Taylor','Blake','Bennett','Brooks','Hayes','Adams','Reid','Quinn','Parker','Scott','Ellis','Silva','Moreau','Keller','Costa','Sato','Novak','Rossi','Lind'])
    ident=uuid.uuid4().hex
    return dict(id=ident,youth_version=1,cap=int(cap//5*5),name=first+' '+last,age=age,skills=skills,potential=potential,
                character={k:rnd.randint(0,100) for k in ('aggression','defence','patience')},
                overall=round(overall,1),stars=round(min(5,max(1,2+(sum(potential.values())/len(potential)-70)/8)),1),
                price=int(round((20000+overall**2*45+headroom*2500)/1000)*1000),salary=salary({'skills':skills}))


def ensure_offers(conn,pid,now):
    week=int(now//D['RECRUIT_INTERVAL'])
    conn.execute('DELETE FROM team_offer WHERE player_id=? AND week!=?',(pid,week))
    # Replace old market offers once; employed drivers and current youth offers stay intact.
    # A scout who joins or leaves changes what can be found, so the offers made for another reach are made again.
    cap=D['specialists'].scout_cap(conn,pid)
    for row in conn.execute('SELECT id,profile FROM team_offer WHERE player_id=?',(pid,)).fetchall():
        offer=json.loads(row['profile'])
        if offer.get('youth_version')!=1 or offer.get('cap')!=int(cap//5*5):
            conn.execute('DELETE FROM team_offer WHERE id=? AND player_id=?',(row['id'],pid))
    taken={r[0] for r in conn.execute('SELECT slot FROM team_offer WHERE player_id=?',(pid,))}
    for slot in range(4):
        if slot not in taken:
            o=new_offer(pid,cap)
            conn.execute('INSERT INTO team_offer VALUES(?,?,?,?,?)',(o['id'],pid,slot,week,json.dumps(o)))
    return [json.loads(r['profile']) for r in conn.execute('SELECT profile FROM team_offer WHERE player_id=? ORDER BY slot',(pid,))]


def accrue(conn,d,force_staff=False):
    """Settle completed real-day payroll periods, including offline periods.

    A staff-count change settles the preceding partial period before its rate changes.
    """
    pid=d['player_id'];now=time.time()
    for row in conn.execute('SELECT * FROM team_pilot WHERE player_id=? ORDER BY created,id',(pid,)).fetchall():
        p=pilot_at(json.loads(row['profile']),now);rate=salary(p)
        days=int(max(0,now-row['payroll_at'])//86400)
        due=days*rate
        if due:
            note(conn,pid,'driver_salary',{'name':p['name'],'pilot':row['id'],'daily':rate,'days':days})
            conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?',(due,pid));d['budget']-=due
            conn.execute('UPDATE team_pilot SET payroll_at=? WHERE id=?',(row['payroll_at']+days*86400,row['id']))
    D['crew'].accrue(conn,d,now)
    D['specialists'].accrue(conn,d,now)
    count=conn.execute('SELECT COUNT(*) FROM team_car WHERE player_id=?',(pid,)).fetchone()[0]
    rate=count*2400
    elapsed=max(0,now-d['staff_ts']);days=int(elapsed//86400)
    due=int(elapsed*rate/86400) if force_staff else days*rate
    checkpoint=now if force_staff else d['staff_ts']+days*86400
    if due:
        note(conn,pid,'staff_salary',{'mechanics':count*2,'engineers':count,'daily':rate})
        conn.execute('UPDATE driver SET budget=budget-?,staff_ts=? WHERE player_id=?',(due,checkpoint,pid));d.update(budget=d['budget']-due,staff_ts=checkpoint)
    elif not count or force_staff:
        conn.execute('UPDATE driver SET staff_ts=? WHERE player_id=?',(now,pid));d['staff_ts']=now


def finances(conn,d,before=None,category=None):
    pid=d['player_id'];conditions=['player_id=?'];args=[pid]
    if before:conditions.append('id<?');args.append(before)
    if category and category in FINANCE_CATEGORIES:conditions.append('category=?');args.append(category)
    rows=[dict(r) for r in conn.execute('SELECT * FROM finance_ledger WHERE '+' AND '.join(conditions)+' ORDER BY id DESC LIMIT 51',args)]
    more=len(rows)>50;rows=rows[:50]
    for r in rows:r['detail']=json.loads(r['detail'])
    totals=conn.execute("SELECT COALESCE(SUM(CASE WHEN amount>0 AND category!='opening' THEN amount ELSE 0 END),0),COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) FROM finance_ledger WHERE player_id=?",(pid,)).fetchone()
    team=roster(conn,d);cars=len(team['cars'])
    return dict(balance=d['budget'],income=totals[0],expenses=totals[1],ledger=rows,next_before=rows[-1]['id'] if more else None,
                pilots=team['pilots'],daily_drivers=sum(p['salary'] for p in team['pilots']),daily_staff=cars*2400,daily_crew=D['crew'].daily_cost(conn,pid),daily_specialists=D['specialists'].daily_cost(conn,pid),
                mechanics=cars*2,engineers=cars,daily_track=D['tracks'].maintenance_per_day(d['own']) if d['own'] else 0,
                tracking_since=conn.execute('SELECT MIN(at) FROM finance_ledger WHERE player_id=?',(pid,)).fetchone()[0],
                categories=FINANCE_CATEGORIES)


FINANCE_CATEGORIES=['opening','sponsor','track_maintenance','driver_salary','crew_salary','staff_salary','car_purchase','driver_recruitment','crew_recruitment','specialist_salary','specialist_recruitment','tyres','research','production','repair','session','pit','prize','sponsor_bonus','refund','hosting','track_build','grandstands','adjustment']


LIVERY_PARTS = frozenset(('body', 'nose', 'engineCover', 'sidepods', 'accents', 'frontWing',
                          'rearWing', 'floor', 'suspension', 'mirrors', 'halo', 'rims', 'helmet'))


def livery_of(conn, pid, car_id):
    row = conn.execute('SELECT livery FROM team_car WHERE id=? AND player_id=?', (car_id, pid)).fetchone()
    return json.loads(row['livery']) if row else {}


def paint(conn, d, car_id, colors):
    # A complete replacement is deliberate: an empty object restores the original materials.
    if not isinstance(colors, dict) or not set(colors).issubset(LIVERY_PARTS): return 'livery'
    if any(not isinstance(v, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', v) for v in colors.values()): return 'livery'
    row = conn.execute('SELECT id FROM team_car WHERE id=? AND player_id=?', (car_id, d['player_id'])).fetchone()
    if not row: return 'car'
    if D['_busy'](conn, d['player_id']): return 'busy'
    conn.execute('UPDATE team_car SET livery=? WHERE id=? AND player_id=?',
                 (json.dumps({k:v.lower() for k,v in colors.items()}), car_id, d['player_id']))
    return None
