"""The team's specialists: one doctor, coach, race engineer, strategist, meteorologist, chief mechanic,
scout and manager at most. They belong to the team, not to a car.

Every specialist has one level (0..100). It is raised only by the specialist's own mini game,
by up to one point per session (an unfinished or too quick session changes nothing). What the level
does is decided here for the server-owned parts (energy, training points, the market, sponsors) and
sent to the browser for the parts that only show information (forecasts, hints, colours).

People are hired from weekly offers like the pit crew, are paid every real day and retire at a
known age: an old specialist is cheap and soon gone, a young one with a high ceiling is expensive.
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


ROLES = ('doctor', 'coach', 'engineer', 'strategist', 'meteorologist', 'mechanic', 'scout', 'manager')
GAME = {r: 'staff_' + r for r in ROLES}
ROLE_OF_GAME = {g: r for r, g in GAME.items()}
OFFERS_PER_ROLE = 3
TRAIN_ENERGY = 30
MIN_SECONDS = 12
ROUNDS = 6
SKILL_MIN = 10.0
RETIRE_AGES = (62, 68)
NO_SCOUT_CAP = 45.0          # the best potential a pilot can have on the market without a scout
SALARY_BASE = 60

def schema(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS staff_member (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, role TEXT NOT NULL, profile TEXT NOT NULL,
      payroll_at REAL NOT NULL, created REAL NOT NULL, UNIQUE(player_id, role));
    CREATE TABLE IF NOT EXISTS staff_offer (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, role TEXT NOT NULL, slot INTEGER NOT NULL,
      week INTEGER NOT NULL, profile TEXT NOT NULL, UNIQUE(player_id, role, slot));
    CREATE TABLE IF NOT EXISTS staff_retired (
      id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, at REAL NOT NULL);
    """)
    if 'name_identity' not in {r[1] for r in conn.execute('PRAGMA table_info(staff_retired)')}:
        conn.execute("ALTER TABLE staff_retired ADD COLUMN name_identity TEXT NOT NULL DEFAULT '{}'")


# ── people ──────────────────────────────────────────────────────────────────

def age_of(profile, now):
    """Years, counted like the pilots' (a game year is a few real days)."""
    return profile['age'] + max(0.0, now - profile['age_at']) / D['AGE_YEAR_SECONDS']


def years_left(profile, now):
    return max(0.0, profile['retire'] - age_of(profile, now))


def worth(profile, now):
    """What the person is worth to the team: the level now plus the part of the ceiling they will still reach while they work."""
    reach = min(1.0, years_left(profile, now) / 30.0) * .5
    return profile['level'] + max(0.0, profile['potential'] - profile['level']) * reach


def salary(profile, now):
    w = worth(profile, now)
    return int(round((SALARY_BASE + .3 * w * w) / 10) * 10)


def price(profile, now):
    w = worth(profile, now)
    return int(round((6000 + w * w * 10 + years_left(profile, now) * 450) / 500) * 500)


def stars(profile, now):
    return round(min(5, max(1, 1 + worth(profile, now) / 25)), 1)


def person(rnd, now):
    level = rnd.uniform(18, 70)
    ceiling = min(99.0, max(level, level + rnd.uniform(0, 45)))
    # an experienced specialist is old and has little left; a young one has a long career and a ceiling to reach
    age = rnd.randint(24, 60)
    retire = rnd.randint(*RETIRE_AGES)
    if age >= retire - 1:
        age = retire - rnd.randint(1, 3)
    if age > 45:
        level = min(99.0, level + (age - 45) * 1.2)
        ceiling = max(level, ceiling - (age - 45))
    return dict(**D['name_source'].person(rnd), age=age, age_at=now, retire=retire, level=round(level, 1),
                potential=round(ceiling, 1), energy=100, energy_ts=now, trainings=0)


def _public_offer(o, now):
    return dict(**D['name_source'].public(o), id=o['id'], role=o['role'], name=o['name'], age=int(age_of(o, now)), retire=o['retire'], level=round(o['level'], 1),
                stars=stars(o, now), salary=salary(o, now), price=price(o, now), years=round(years_left(o, now), 1))


def ensure_offers(conn, pid, now):
    week = int(now // D['RECRUIT_INTERVAL'])
    conn.execute('DELETE FROM staff_offer WHERE player_id=? AND week!=?', (pid, week))
    have = {(r[0], r[1]) for r in conn.execute('SELECT role,slot FROM staff_offer WHERE player_id=?', (pid,))}
    rnd = random.SystemRandom()
    for role in ROLES:
        for slot in range(OFFERS_PER_ROLE):
            if (role, slot) not in have:
                o = person(rnd, now)
                o.update(id=uuid.uuid4().hex, role=role)
                conn.execute('INSERT INTO staff_offer VALUES(?,?,?,?,?,?)', (o['id'], pid, role, slot, week, json.dumps(o)))
    out = {r: [] for r in ROLES}
    for r in conn.execute('SELECT role,profile FROM staff_offer WHERE player_id=? ORDER BY role,slot', (pid,)):
        out[r['role']].append(_public_offer(json.loads(r['profile']), now))
    return out


def member_at(profile, now, regen):
    p = dict(profile)
    p['energy'] = min(100, p.get('energy', 100) + max(0, now - p.get('energy_ts', now)) * regen)
    p['energy_ts'] = max(now, p.get('energy_ts', now))
    return p


def _rows(conn, pid):
    return conn.execute('SELECT * FROM staff_member WHERE player_id=?', (pid,)).fetchall()


def retire_due(conn, pid, now):
    """Remove everybody who has reached the age of retirement and leave a note for the player."""
    for r in _rows(conn, pid):
        p = json.loads(r['profile'])
        if years_left(p, now) <= 0:
            pay(conn, pid, r, p, now)
            conn.execute('DELETE FROM staff_member WHERE id=?', (r['id'],))
            conn.execute('INSERT INTO staff_retired(player_id,role,name,at,name_identity) VALUES(?,?,?,?,?)', (pid, r['role'], p['name'], now, json.dumps(p.get('name_identity') or {})))


def alive(conn, pid, now=None):
    """{role: (row, profile)} of everybody still working."""
    now = now or time.time()
    out = {}
    for r in _rows(conn, pid):
        p = json.loads(r['profile'])
        if years_left(p, now) > 0:
            out[r['role']] = (r, p)
    return out


def level_of(conn, pid, role, now=None):
    """The level of the specialist or None when the team has nobody for the role."""
    got = alive(conn, pid, now).get(role)
    return None if not got else float(got[1]['level'])


def levels(conn, pid, now=None):
    return {role: float(p['level']) for role, (r, p) in alive(conn, pid, now).items()}


# ── what the levels do on the server ────────────────────────────────────────

def regen(conn, pid):
    """Energy per second: the doctor cuts the time to recover by up to half."""
    lv = level_of(conn, pid, 'doctor')
    return D['ENERGY_REGEN'] / (1 - lv / 200.0) if lv else D['ENERGY_REGEN']


def regen_pid(pid):
    conn = D['_connect']()
    try:
        return regen(conn, pid)
    finally:
        conn.close()


def coach_bonus(conn, pid):
    """Points added to every pilot training session: a coach of level 50 adds half a point."""
    lv = level_of(conn, pid, 'coach')
    return lv / 100.0 if lv else 0.0


def scout_cap(conn, pid):
    """The highest potential of the pilots on the market: the level of the scout, or the little a team finds alone."""
    lv = level_of(conn, pid, 'scout')
    return max(NO_SCOUT_CAP, lv) if lv else NO_SCOUT_CAP


def sponsor_factor(conn, pid):
    lv = level_of(conn, pid, 'manager')
    return 1.0 + lv / 100.0 if lv else 1.0


# ── hiring and pay ──────────────────────────────────────────────────────────

def hire(conn, d, role, offer_id):
    if role not in ROLES:
        return 'role'
    now = time.time()
    retire_due(conn, d['player_id'], now)
    if conn.execute('SELECT 1 FROM staff_member WHERE player_id=? AND role=?', (d['player_id'], role)).fetchone():
        return 'occupied'
    ensure_offers(conn, d['player_id'], now)
    row = conn.execute('SELECT profile FROM staff_offer WHERE id=? AND player_id=? AND role=?', (offer_id, d['player_id'], role)).fetchone()
    if not row:
        return 'offer'
    o = json.loads(row['profile'])
    cost = price(o, now)
    if d['budget'] < cost:
        return 'budget'
    p = {k: v for k, v in o.items() if k not in ('id', 'role')}
    p.update(energy=100, energy_ts=now, trainings=0)
    conn.execute('INSERT INTO staff_member VALUES(?,?,?,?,?,?)', (uuid.uuid4().hex, d['player_id'], role, json.dumps(p), now, now))
    D['team'].note(conn, d['player_id'], 'specialist_recruitment', {'name': p['name'], 'role': role})
    conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?', (cost, d['player_id']))
    d['budget'] -= cost
    conn.execute('DELETE FROM staff_offer WHERE id=?', (o['id'],))
    return None


def dismiss(conn, d, member_id):
    row = conn.execute('SELECT * FROM staff_member WHERE id=? AND player_id=?', (member_id, d['player_id'])).fetchone()
    if not row:
        return 'member'
    pay(conn, d['player_id'], row, json.loads(row['profile']), time.time())
    conn.execute('DELETE FROM staff_member WHERE id=?', (member_id,))
    d['budget'] = conn.execute('SELECT budget FROM driver WHERE player_id=?', (d['player_id'],)).fetchone()[0]
    return None


def pay(conn, pid, row, p, now):
    """Settle the whole real days since the last payment (stopping at retirement)."""
    end = min(now, p['age_at'] + (p['retire'] - p['age']) * D['AGE_YEAR_SECONDS'])      # nothing is paid after the retirement
    days = int(max(0, end - row['payroll_at']) // 86400)
    due = days * salary(p, now)
    if due:
        D['team'].note(conn, pid, 'specialist_salary', {'name': p['name'], 'role': row['role'], 'daily': salary(p, now), 'days': days})
        conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?', (due, pid))
    if days:
        conn.execute('UPDATE staff_member SET payroll_at=? WHERE id=?', (row['payroll_at'] + days * 86400, row['id']))
    return due


def accrue(conn, d, now):
    pid = d['player_id']
    for r in _rows(conn, pid):
        due = pay(conn, pid, r, json.loads(r['profile']), now)
        d['budget'] -= due
    retire_due(conn, pid, now)


def daily_cost(conn, pid):
    now = time.time()
    return sum(salary(p, now) for r, p in alive(conn, pid, now).values())


# ── what the browser may know ───────────────────────────────────────────────

def public_member(row, p, now, regen_rate):
    m = member_at(p, now, regen_rate)
    return dict(**D['name_source'].public(p), id=row['id'], role=row['role'], name=p['name'], age=int(age_of(p, now)), retire=p['retire'], years=round(years_left(p, now), 1),
                level=round(p['level'], 2), energy=math.floor(m['energy'] * 100) / 100, salary=salary(p, now), stars=stars(p, now),
                headroom=round(max(0.0, p['potential'] - p['level']), 1))


def public(conn, d, now=None):
    now = now or time.time()
    pid = d['player_id']
    market = ensure_offers(conn, pid, now)
    rate = regen(conn, pid)
    members = {r: None for r in ROLES}
    for role, (row, p) in alive(conn, pid, now).items():
        members[role] = public_member(row, p, now, rate)
    notes = [dict(**D['name_source'].public({'name_identity':json.loads(r['name_identity'])}),role=r['role'], name=r['name'], at=r['at']) for r in
             conn.execute('SELECT * FROM staff_retired WHERE player_id=? AND at>? ORDER BY id DESC LIMIT 8', (pid, now - 14 * 86400))]
    return dict(roles=list(ROLES), games={r: GAME[r] for r in ROLES}, members=members, market=market, retired=notes, train_energy=TRAIN_ENERGY,
                levels={r: (m['level'] if m else None) for r, m in members.items()}, daily=daily_cost(conn, pid),
                offers_refresh_at=(int(now // D['RECRUIT_INTERVAL']) + 1) * D['RECRUIT_INTERVAL'])


# ── training ────────────────────────────────────────────────────────────────

def difficulty(level):
    return D['training_rules'].difficulty(level)


def start(conn, d, game, member_id, now):
    """-> (member row, profile, difficulty) or an error string. The specialist's own energy pays for it."""
    role = ROLE_OF_GAME.get(game)
    if not role:
        return 'game'
    row = conn.execute('SELECT * FROM staff_member WHERE id=? AND player_id=?', (member_id, d['player_id'])).fetchone()
    if not row or row['role'] != role:
        return 'member'
    p = json.loads(row['profile'])
    if years_left(p, now) <= 0:
        return 'member'
    m = member_at(p, now, regen(conn, d['player_id']))
    if m['energy'] < TRAIN_ENERGY:
        return 'energy'
    return row, m


def score(result):
    """0..1 from the six round values the browser measured; anything else counts as nothing."""
    if not isinstance(result, dict) or result.get('version') != 1:
        return 0.0
    rounds = result.get('rounds')
    if not isinstance(rounds, list) or len(rounds) != ROUNDS:
        return 0.0
    total = 0.0
    for v in rounds:
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = 0.0
        total += min(1.0, max(0.0, v if math.isfinite(v) else 0.0))
    return total / ROUNDS


def apply_training(profile, perf, valid=True):
    """The score becomes a percentage between -100% and +100% (half is neutral) and the level moves by that many points."""
    p = max(-1.0, min(1.0, 2.0 * perf - 1.0)) if valid else 0.0
    before = profile['level']
    profile['level'] = round(D['training_rules'].capped(before, p, SKILL_MIN), 4)
    profile['trainings'] = profile.get('trainings', 0) + 1
    return p, round(profile['level'] - before, 3)
