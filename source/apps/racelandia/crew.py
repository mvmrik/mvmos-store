"""The pit crew: one crew per car, one person for every position.

A pit stop is made by people with skills, trained one by one, and the time of the
stop is the sum of what the slowest hands need. A fresh crew is slow (six seconds
and more); a crew at its limit changes four tyres in a little under two seconds.
The same model prices the computer teams' stops, so everybody is measured alike.
"""
import json
import math
import random
import time
import uuid

D = None


def bind(context):
    global D
    D = context


SKILLS = ('speed', 'precision', 'reaction', 'strength', 'focus')
START_SKILL = 30.0
POTENTIAL_MAX = 100.0
# position -> (group, {skill: weight}); the group decides which trainings and which part of the stop it belongs to
POSITIONS = {
    'front_left': ('wheel', {'speed': .45, 'precision': .25, 'strength': .15, 'focus': .15, 'reaction': .05}),
    'front_right': ('wheel', {'speed': .45, 'precision': .25, 'strength': .15, 'focus': .15, 'reaction': .05}),
    'rear_left': ('wheel', {'speed': .45, 'precision': .25, 'strength': .15, 'focus': .15, 'reaction': .05}),
    'rear_right': ('wheel', {'speed': .45, 'precision': .25, 'strength': .15, 'focus': .15, 'reaction': .05}),
    'jack_front': ('jack', {'strength': .3, 'reaction': .3, 'precision': .2, 'speed': .2, 'focus': .1}),
    'jack_rear': ('jack', {'strength': .3, 'reaction': .3, 'precision': .2, 'speed': .2, 'focus': .1}),
    'repair': ('repair', {'precision': .4, 'speed': .3, 'focus': .3, 'strength': .05, 'reaction': .05}),
    'release': ('release', {'reaction': .5, 'focus': .4, 'precision': .1, 'speed': .05, 'strength': .025}),
}
ORDER = tuple(POSITIONS)
# the four training exercises of the crew: group -> (skills with weights, the simulator that plays it)
TRAINING = {
    'crew_wheel': ('wheel', {'speed': .65, 'precision': .4, 'strength': .2, 'focus': .15, 'reaction': .1}, 'wheel_service'),
    'crew_jack': ('jack', {'strength': .45, 'reaction': .4, 'precision': .35, 'speed': .2, 'focus': .1}, 'jack_balance'),
    'crew_repair': ('repair', {'precision': .6, 'speed': .45, 'focus': .3, 'strength': .1, 'reaction': .05}, 'repair_wiring'),
    'crew_release': ('release', {'reaction': .7, 'focus': .5, 'precision': .15, 'speed': .1, 'strength': .05}, 'release_gap'),
}
# Preserve the award rules of exercises already started before the new mechanics.
LEGACY_TRAINING = {
    'crew_wheel': ('pit', {'speed': 1.0, 'precision': .5}),
    'crew_jack': ('brake', {'precision': 1.0, 'strength': .5}),
    'crew_repair': ('rhythm', {'speed': 1.0, 'focus': .4}),
    'crew_release': ('lights', {'reaction': 1.0, 'focus': .5}),
}

OFFERS_PER_POSITION = 3
SALARY_BASE = 40
TRAIN_ENERGY = 30
STOPS_PREDICTED = 14

# the best a task can be and the worst, in seconds; the skill level 0..1 moves it along a curve
LIFT = (.30, 1.6)
WHEEL = (1.05, 5.2)
DROP = (.25, 1.3)
RELEASE = (.25, 1.0)
REPAIR = (1.9, 8.9)
SPAN = 1.5


def level(profile, position):
    """The skill of a person for the position they stand at, 0..1."""
    weights = POSITIONS[position][1]
    skills = (profile or {}).get('skills') or {}
    raw=sum(D['training_rules'].effective_skill(float(skills.get(k,0)))*w for k,w in weights.items())/sum(weights.values())/100
    return raw*(.65+.35*(profile or {}).get('energy',100)/100)


def task(span, lv):
    return span[0] + (span[1] - span[0]) * (1 - lv) ** SPAN


def levels(crew):
    """Level of every position of a crew ({position: profile or None})."""
    out={p:level((crew or {}).get(p),p) for p in ORDER}
    for key in ('focus','precision'):
        out['_'+key]=sum(D['training_rules'].effective_skill((crew or {}).get(p,{}).get('skills',{}).get(key,0))*(.65+.35*(crew or {}).get(p,{}).get('energy',100)/100)/100 for p in ORDER if (crew or {}).get(p))/len(ORDER)
    return out


def stop(crew_levels, focus, precision, rnd):
    """One simulated pit stop -> (tyres only, repair only, tyres and repair) in seconds."""
    noise = .03 + .10 * (1 - focus)
    fumble = .004 + .12 * (1 - precision) ** 2

    def hand(span, lv):
        t = task(span, lv) * max(.88, min(1.5, 1 + rnd.gauss(0, noise)))
        if rnd.random() < fumble:
            t += rnd.uniform(.8, 2.0)
        return t
    lift = max(hand(LIFT, crew_levels['jack_front']), hand(LIFT, crew_levels['jack_rear']))
    drop = max(hand(DROP, crew_levels['jack_front']), hand(DROP, crew_levels['jack_rear']))
    wheels = max(hand(WHEEL, crew_levels[p]) for p in ('front_left', 'front_right', 'rear_left', 'rear_right'))
    repair = hand(REPAIR, crew_levels['repair'])
    release = hand(RELEASE, crew_levels['release'])
    tyres = lift + wheels + drop + release
    both = lift + max(wheels, repair) + drop + release
    only = repair + release
    return round(tyres, 2), round(only, 2), round(both, 2)


def typical(crew_levels):
    """The stop a crew makes on an average day: no luck either way."""
    lv = crew_levels
    wheels = max(task(WHEEL, lv[p]) for p in ('front_left', 'front_right', 'rear_left', 'rear_right'))
    lift = max(task(LIFT, lv['jack_front']), task(LIFT, lv['jack_rear']))
    drop = max(task(DROP, lv['jack_front']), task(DROP, lv['jack_rear']))
    release = task(RELEASE, lv['release'])
    repair = task(REPAIR, lv['repair'])
    return dict(tyre=round(lift + wheels + drop + release, 2), repair=round(repair + release, 2),
                both=round(lift + max(wheels, repair) + drop + release, 2))


def team_factors(crew_levels):
    """How steady the crew is as a whole: its focus and its precision (for the size of the mistakes)."""
    mean=sum(crew_levels[p] for p in ORDER)/len(ORDER)
    return crew_levels.get('_focus',mean),crew_levels.get('_precision',mean)


def stop_table(crew_levels, seed):
    """The durations of the stops a car will make, fixed in advance from the race seed so that the browser
    and the server replay exactly the same pit lane."""
    rnd = random.Random(seed)
    focus, precision = team_factors(crew_levels)
    return [dict(zip(('tyre', 'repair', 'both'), stop(crew_levels, focus, precision, rnd))) for _ in range(STOPS_PREDICTED)]


def salary(profile):
    skills = profile['skills']
    overall = sum(skills.values()) / len(skills)
    return int(round((SALARY_BASE + .2 * overall ** 2) / 10) * 10)


def overall(profile):
    return round(sum(profile['skills'].values()) / len(profile['skills']), 1)


def hire_price(profile):
    o = sum(profile['skills'].values()) / len(profile['skills'])
    headroom = sum(profile['potential'][k] - profile['skills'][k] for k in profile['skills']) / len(profile['skills'])
    return int(round((4000 + o ** 2 * 7 + headroom * 250) / 500) * 500)


def person(rnd, base=None, spread=None, ceiling=None, name=None):
    """A crew member with skills around `base`; each skill has its own ceiling to be trained to."""
    base = rnd.uniform(18, 62) if base is None else base
    spread = 7 if spread is None else spread
    ceiling = rnd.uniform(max(60, base + 10), 99) if ceiling is None else ceiling
    potential = {k: round(min(POTENTIAL_MAX, max(45, ceiling + rnd.gauss(0, 4))), 2) for k in SKILLS}
    skills = {k: round(min(potential[k], max(10, base + rnd.gauss(0, spread))), 2) for k in SKILLS}
    return dict(**(D['name_source'].person(rnd) if name is None else {'name':name}), age=rnd.randint(19, 45), skills=skills, potential=potential)


def schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS crew_member (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, car_id TEXT NOT NULL, position TEXT NOT NULL,
      profile TEXT NOT NULL, payroll_at REAL NOT NULL, created REAL NOT NULL, UNIQUE(car_id, position));
    CREATE INDEX IF NOT EXISTS idx_crew_owner ON crew_member(player_id);
    CREATE TABLE IF NOT EXISTS crew_offer (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, position TEXT NOT NULL, slot INTEGER NOT NULL,
      week INTEGER NOT NULL, profile TEXT NOT NULL, UNIQUE(player_id, position, slot));
    """)


def new_offer(position):
    rnd = random.SystemRandom()
    p = person(rnd)
    p['id'] = uuid.uuid4().hex
    p['position'] = position
    p['price'] = hire_price(p)
    p['salary'] = salary(p)
    p['overall'] = overall(p)
    p['level'] = round(level(p, position) * 100, 1)
    return p


def ensure_offers(conn, pid, now):
    week = int(now // D['RECRUIT_INTERVAL'])
    conn.execute('DELETE FROM crew_offer WHERE player_id=? AND week!=?', (pid, week))
    have = {(r[0], r[1]) for r in conn.execute('SELECT position,slot FROM crew_offer WHERE player_id=?', (pid,))}
    for position in ORDER:
        for slot in range(OFFERS_PER_POSITION):
            if (position, slot) not in have:
                o = new_offer(position)
                conn.execute('INSERT INTO crew_offer VALUES(?,?,?,?,?,?)', (o['id'], pid, position, slot, week, json.dumps(o)))
    out = {p: [] for p in ORDER}
    for r in conn.execute('SELECT position,profile FROM crew_offer WHERE player_id=? ORDER BY position,slot', (pid,)):
        o = json.loads(r['profile'])
        out[r['position']].append({k: v for k, v in o.items() if k != 'potential'} | {'stars': stars(o)})
    return out


def stars(profile):
    pot = sum(profile['potential'].values()) / len(profile['potential'])
    return round(min(5, max(1, 2 + (pot - 70) / 8)), 1)


def member_at(profile, now, regen=None):
    """The energy of a member comes back with time, like a driver's."""
    p = dict(profile)
    p['energy'] = min(100, p.get('energy', 100) + max(0, now - p.get('energy_ts', now)) * (D['ENERGY_REGEN'] if regen is None else regen))
    p['energy_ts'] = max(now, p.get('energy_ts', now))
    return p


def crew_of(conn, car_id, now=None):
    """{position: profile with id} of one car."""
    now = now or time.time()
    out = {p: None for p in ORDER}
    owner = conn.execute('SELECT player_id FROM team_car WHERE id=?', (car_id,)).fetchone()
    regen = D['specialists'].regen(conn, owner[0]) if owner else None
    for r in conn.execute('SELECT id,position,profile FROM crew_member WHERE car_id=?', (car_id,)):
        out[r['position']] = dict(member_at(json.loads(r['profile']), now, regen), id=r['id'])
    return out


def public_member(p, position):
    return dict(**D['name_source'].public(p), id=p['id'], name=p['name'], age=p['age'], skills={k: round(v, 1) for k, v in p['skills'].items()}, overall=overall(p),
                level=round(level(p, position) * 100, 1), energy=math.floor(p['energy'] * 100) / 100, salary=salary(p), stars=stars(p),
                headroom=round(sum(p['potential'][k] - p['skills'][k] for k in p['skills']) / len(p['skills']), 1),
                training_levels=training_levels(p))


def public_crew(conn, d, cars, now=None):
    """What the browser may know: the crews of the cars, their typical stop times and the market."""
    now = now or time.time()
    market = ensure_offers(conn, d['player_id'], now)
    out = {}
    for car in cars:
        crew = crew_of(conn, car['id'], now)
        lv = levels(crew)
        out[car['id']] = dict(members={p: (public_member(m, p) if m else None) for p, m in crew.items()}, times=typical(lv),
                              daily=sum(salary(m) for m in crew.values() if m))
    return dict(positions=[dict(id=p, group=POSITIONS[p][0], weights=POSITIONS[p][1]) for p in ORDER], skills=list(SKILLS),
                trainings={k: dict(group=g, skills=w, game=mech) for k, (g, w, mech) in TRAINING.items()},
                cars=out, market=market, train_energy=TRAIN_ENERGY, offers_refresh_at=(int(now // D['RECRUIT_INTERVAL']) + 1) * D['RECRUIT_INTERVAL'])


def hire(conn, d, car_id, position, offer_id):
    """-> error or None. The person stands at the position from now on and is paid every real day."""
    if position not in POSITIONS:
        return 'position'
    if not conn.execute('SELECT 1 FROM team_car WHERE id=? AND player_id=?', (car_id, d['player_id'])).fetchone():
        return 'car'
    if conn.execute('SELECT 1 FROM crew_member WHERE car_id=? AND position=?', (car_id, position)).fetchone():
        return 'occupied'
    now = time.time()
    ensure_offers(conn, d['player_id'], now)
    row = conn.execute('SELECT profile FROM crew_offer WHERE id=? AND player_id=? AND position=?', (offer_id, d['player_id'], position)).fetchone()
    if not row:
        return 'offer'
    offer = json.loads(row['profile'])
    if d['budget'] < offer['price']:
        return 'budget'
    p = dict(name=offer['name'], name_identity=offer['name_identity'], age=offer['age'], skills=offer['skills'], potential=offer['potential'], energy=100, energy_ts=now, trainings=0)
    ident = uuid.uuid4().hex
    conn.execute('INSERT INTO crew_member VALUES(?,?,?,?,?,?,?)', (ident, d['player_id'], car_id, position, json.dumps(p), now, now))
    D['team'].note(conn, d['player_id'], 'crew_recruitment', {'name': p['name'], 'position': position, 'car': car_id})
    conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?', (offer['price'], d['player_id']))
    d['budget'] -= offer['price']
    conn.execute('DELETE FROM crew_offer WHERE id=?', (offer_id,))
    return None


def dismiss(conn, d, member_id):
    row = conn.execute('SELECT 1 FROM crew_member WHERE id=? AND player_id=?', (member_id, d['player_id'])).fetchone()
    if not row:
        return 'member'
    conn.execute('DELETE FROM crew_member WHERE id=?', (member_id,))
    return None


def accrue(conn, d, now):
    """Salaries of the crew for the whole real days since they were last paid, including time offline."""
    for r in conn.execute('SELECT * FROM crew_member WHERE player_id=?', (d['player_id'],)).fetchall():
        p = json.loads(r['profile'])
        days = int(max(0, now - r['payroll_at']) // 86400)
        due = days * salary(p)
        if due:
            D['team'].note(conn, d['player_id'], 'crew_salary', {'name': p['name'], 'position': r['position'], 'daily': salary(p), 'days': days})
            conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?', (due, d['player_id']))
            d['budget'] -= due
            conn.execute('UPDATE crew_member SET payroll_at=? WHERE id=?', (r['payroll_at'] + days * 86400, r['id']))


def daily_cost(conn, player_id):
    return sum(salary(json.loads(r[0])) for r in conn.execute('SELECT profile FROM crew_member WHERE player_id=?', (player_id,)))


def member_row(conn, player_id, member_id):
    r = conn.execute('SELECT * FROM crew_member WHERE id=? AND player_id=?', (member_id, player_id)).fetchone()
    return r


def difficulty(profile, training):
    """An uncapped challenge from the skills the exercise trains."""
    _, weights, _ = TRAINING[training]
    lv = sum(float(profile['skills'].get(k, 30)) * w for k, w in weights.items()) / sum(weights.values())
    return D['training_rules'].difficulty(lv)


def training_levels(profile):
    return {t: difficulty(profile, t) for t in TRAINING}


def apply_training(profile, training, perf, legacy=False, valid=True):
    """New skills of a member after a scored exercise -> gains.

    The drill's own score (0..1) becomes a percentage between -100% and +100% (half the score
    is neutral) and the skills move by that many points in total, shared out by the weights of
    the position's exercise: a perfect drill adds one point, a failed one takes one away."""
    weights = LEGACY_TRAINING[training][1] if legacy else TRAINING[training][1]
    p = max(-1.0, min(1.0, 2.0*perf-1.0)) if valid else 0.0
    total = sum(weights.values())
    gains = {}
    for k, w in weights.items():
        before = profile['skills'][k]
        profile['skills'][k] = D['training_rules'].capped(before, p*w/total, D['SKILL_FLOOR']*.4)
        if profile['skills'][k] != before:
            gains[k] = round(profile['skills'][k]-before, 3)
    profile['trainings'] = profile.get('trainings', 0) + 1
    return gains
