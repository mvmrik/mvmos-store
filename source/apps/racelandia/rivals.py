"""The computer teams of every division, alive in the database.

At the start of a career every division gets nine teams of two drivers (eighteen
rivals), each with a car, a pit crew and two drivers. They start at the lowest
level their division allows and train a little every real day, each at its own
pace and with a good deal of luck, so that by the time the player reaches a
division its teams have grown too. Nothing runs in the background: when the
game is opened, the days that have passed are applied one by one, from a
seed, so the result does not depend on when or how often the player looks.
"""
import hashlib
import json
import random
import time

DIVISIONS = (5, 4, 3, 2, 1)
TEAMS = 9
# the lowest level of a rival in each division: driver mean, car level, crew level
FLOOR = {5: (49, 20, 30), 4: (59, 40, 44), 3: (69, 60, 58), 2: (77, 80, 72), 1: (85, 95, 84)}
# a rival's yearly ceiling is far away; the daily gain of a skill is a fraction of what a diligent human can train
DAILY_SKILL = (.04, .36)
DAILY_CAR = (.02, .17)
DAILY_CREW = (.05, .42)
CEILING = 97.0
CAR_RANGE = 45          # how far above its division's floor a rival's car can be developed
MAX_CATCH_UP_DAYS = 730


D = None


def bind(context):
    global D
    D = context


def schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS rival_field (
      player_id TEXT PRIMARY KEY, career_started REAL NOT NULL, day INTEGER NOT NULL, updated REAL NOT NULL, state TEXT NOT NULL);
    """)


def _seed(player_id, career_started):
    return int(hashlib.sha256(f'rivals-v1:{player_id}:{career_started}'.encode()).hexdigest()[:12], 16)


def _crew(rnd, base):
    """A rival's crew: eight people near one level, as a human team grows its own."""
    from_crew = D['crew']
    crew = {}
    for p in from_crew.ORDER:
        person = from_crew.person(rnd, name='', base=base + rnd.uniform(-5, 5), spread=4, ceiling=rnd.uniform(max(75, base + 12), 99))
        crew[p] = dict(skills=person['skills'], potential=person['potential'])
    return crew


def make_division(rnd, division, skill_keys):
    driver_floor, car_floor, crew_floor = FLOOR[division]
    # Identity generation has its own random stream, separate from race development.
    names_rng = random.Random(rnd.getrandbits(128))
    people = D['name_source'].generate(count=2 * TEAMS, rng=names_rng)
    teams = D['name_source'].generate(country='teams', count=TEAMS, rng=names_rng)
    entries = []
    for t in range(TEAMS):
        # each team has its own appetite for development, fixed for the whole career
        drive = round(rnd.uniform(.55, 1.45), 3)
        team_start = rnd.uniform(0, 8)
        for k in range(2):
            i = t * 2 + k
            base = driver_floor + team_start * .6 + rnd.uniform(0, 5)
            ceiling = rnd.uniform(max(80, base + 14), CEILING)
            potential = {s: round(min(99, ceiling + rnd.gauss(0, 3)), 2) for s in skill_keys}
            skills = {s: round(min(potential[s], max(driver_floor - 2, base + rnd.gauss(0, 3.5))), 2) for s in skill_keys}
            ident = f'd{division}-{i}'
            entries.append(dict(id=ident, name=people[i]['latin'], name_identity=people[i], country=people[i]['country'],
                                gender=people[i]['gender'], team=teams[t]['latin'], team_index=t, age=rnd.randint(18, 34),
                                car=round(car_floor + team_start * .9 + rnd.uniform(0, 3), 2), car_cap=car_floor + CAR_RANGE, potential=potential, skills=skills, drive=drive,
                                luck=round(rnd.uniform(.8, 1.2), 3), col=1 + t % 7,
                                crew=_crew(rnd, crew_floor + team_start * .8 + rnd.uniform(0, 3))))
    return entries


def _skill_step(rnd, value, ceiling, span, scale):
    gain = rnd.uniform(*span) * scale * max(0.0, 1 - value / ceiling) ** .7
    return min(ceiling, value + gain)


def advance_day(entries, rnd):
    """One real day of development for every entry: a minimum anyone can train, never the maximum, with chance on top."""
    for e in entries:
        scale = e['drive'] * e['luck'] * rnd.uniform(.35, 1.65)
        for s in e['skills']:
            if rnd.random() < .85:
                e['skills'][s] = round(_skill_step(rnd, e['skills'][s], e['potential'][s], DAILY_SKILL, scale), 3)
        e['car'] = round(min(e['car_cap'], e['car'] + rnd.uniform(*DAILY_CAR) * e['drive'] * rnd.uniform(.3, 1.7)), 3)
        for member in e['crew'].values():
            for s in member['skills']:
                if rnd.random() < .8:
                    member['skills'][s] = round(_skill_step(rnd, member['skills'][s], member['potential'][s], DAILY_CREW, e['drive'] * rnd.uniform(.35, 1.65)), 3)


def _day(started, now):
    return int(max(0, now - started) // 86400)


def ensure(conn, player_id, career_started, skill_keys, now=None):
    """Create the field of a new career if it is missing and apply the days that have passed. -> state"""
    now = now or time.time()
    row = conn.execute('SELECT * FROM rival_field WHERE player_id=?', (player_id,)).fetchone()
    if row and row['career_started'] != career_started:
        row = None
    today = _day(career_started, now)
    if row and row['day'] >= today:
        return json.loads(row['state'])
    seed = _seed(player_id, career_started)
    if row:
        state, day = json.loads(row['state']), row['day']
    else:
        rnd = random.Random(seed)
        state = {'divisions': {str(div): make_division(rnd, div, skill_keys) for div in DIVISIONS}}
        day = 0
    for n in range(day + 1, min(today, day + MAX_CATCH_UP_DAYS) + 1):
        rnd = random.Random(f'{seed}:{n}')
        for entries in state['divisions'].values():
            advance_day(entries, rnd)
    conn.execute('INSERT INTO rival_field(player_id,career_started,day,updated,state) VALUES(?,?,?,?,?) '
                 'ON CONFLICT(player_id) DO UPDATE SET career_started=excluded.career_started,day=excluded.day,updated=excluded.updated,state=excluded.state',
                 (player_id, career_started, max(day, min(today, day + MAX_CATCH_UP_DAYS)), now, json.dumps(state)))
    return state


def forget(conn, player_id):
    conn.execute('DELETE FROM rival_field WHERE player_id=?', (player_id,))


def roster(conn, d, division=5, now=None):
    """The rivals of a division in the shape the race and the timetable read: skills, car, character, crew levels."""
    state = ensure(conn, d['player_id'], d['created'], D['SKILLS'], now)
    out = []
    for e in state['divisions'][str(division)]:
        out.append(dict(id=e['id'], name=e['name'], name_identity=e.get('name_identity'), country=e.get('country'), gender=e.get('gender'), team=e['team'], age=e['age'], car=round(e['car'], 2), skills={k: round(v, 2) for k, v in e['skills'].items()},
                        col=e['col'], crew={p: dict(skills={k: round(v, 2) for k, v in m['skills'].items()}) for p, m in e['crew'].items()}))
    return out


def summary(conn, d, division=5):
    """What the player may see of the rivals: names, teams and rough levels, never the exact skills."""
    out = []
    crew = D['crew']
    for r in roster(conn, d, division):
        lv = crew.levels(r['crew'])
        out.append(dict(id=r['id'], name=r['name'], name_identity=r.get('name_identity'), country=r.get('country'), gender=r.get('gender'), team=r['team'], age=r['age'], car=r['car'],
                        overall=round(sum(r['skills'].values()) / len(r['skills']), 1), pit=crew.typical(lv)['tyre']))
    return out
