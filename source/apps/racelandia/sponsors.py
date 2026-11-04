"""Server-owned, fixed-term sponsorship offers, accrual and result bonuses."""
import hashlib
import json
import time
import uuid

DAY = 86400
TERM = 30 * DAY
BRANDS = ('Northstar Tools', 'Vertex Energy', 'Summit Logistics', 'Orbit Telecom', 'Pioneer Motors', 'Cobalt Systems', 'Atlas Components', 'Horizon Labs', 'Momentum Sports')
D = None


def bind(context):
    global D
    D = context


def schema(conn):
    conn.executescript('''
    CREATE TABLE IF NOT EXISTS sponsor_contract (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, profile TEXT NOT NULL,
      started REAL NOT NULL, expires REAL NOT NULL, paid_at REAL NOT NULL, bonus_at REAL NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS sponsor_owner ON sponsor_contract(player_id);
    CREATE TABLE IF NOT EXISTS sponsor_event (
      player_id TEXT NOT NULL, token TEXT NOT NULL, finished INTEGER NOT NULL, points INTEGER NOT NULL,
      podium INTEGER NOT NULL, PRIMARY KEY(player_id,token));
    ''')


def reputation(conn, d):
    stats = conn.execute('SELECT COALESCE(SUM(finished),0),COALESCE(SUM(points),0),COALESCE(SUM(podium),0) FROM sponsor_event WHERE player_id=?', (d['player_id'],)).fetchone()
    races, points, podiums = stats
    tier = 3 if races >= 15 and podiums >= 3 else 2 if races >= 5 and points >= 10 else 1 if d['license_unlocked'] else 0
    return dict(tier=tier, slots=min(3, 1+tier), races=races, points=points, podiums=podiums)


def accrue(conn, d, now):
    for r in conn.execute('SELECT * FROM sponsor_contract WHERE player_id=?', (d['player_id'],)).fetchall():
        p = json.loads(r['profile'])
        days = int(max(0, min(now, r['expires'])-r['paid_at']) // DAY)
        if not days:
            continue
        amount = days*p['daily']
        D['team'].note(conn, d['player_id'], 'sponsor', dict(name=p['name'], days=days, daily=p['daily']))
        conn.execute('UPDATE driver SET budget=budget+? WHERE player_id=?', (amount, d['player_id']))
        conn.execute('UPDATE sponsor_contract SET paid_at=paid_at+? WHERE id=?', (days*DAY, r['id']))
        d['budget'] += amount


def offers(conn, d, now):
    rep = reputation(conn, d)
    week = int(now // (7*DAY))
    factor = D['specialists'].sponsor_factor(conn, d['player_id'])      # the manager negotiates higher sums
    out = []
    for slot in range(rep['slots']):
        # Side sponsors have smaller budgets; reputation raises the available guarantees.
        scale = (1, 1.6, 2.4, 3.5)[rep['tier']] * (1, .45, .3)[slot]
        for variant, (daily, advance, bonus, goal) in enumerate(((30000, 0, 40000, 'finish'), (22000, 240000, 60000, 'points'), (16000, 0, 180000, 'top10'))):
            ident = hashlib.sha256(f"{d['player_id']}:{d['created']}:{week}:{rep['tier']}:{slot}:{variant}".encode()).hexdigest()[:32]
            out.append(dict(id=ident, slot=slot, variant=variant, name=BRANDS[slot*3+variant], daily=int(daily*scale*factor), advance=int(advance*scale*factor), bonus=int(bonus*scale*factor), goal=goal, days=30))
    return out


def state(conn, d, now=None):
    now = time.time() if now is None else now
    active = [dict(json.loads(r['profile']), started=r['started'], expires=r['expires']) for r in conn.execute('SELECT * FROM sponsor_contract WHERE player_id=? AND expires>? ORDER BY started', (d['player_id'], now))]
    rep = reputation(conn, d)
    used = {p['slot'] for p in active}
    people = D['team'].roster(conn, d)
    expenses = sum(p['salary'] for p in people['pilots']) + len(people['cars'])*2400 + D['crew'].daily_cost(conn, d['player_id']) + D['specialists'].daily_cost(conn, d['player_id']) + (D['tracks'].maintenance_per_day(d['own']) if d['own'] else 0)
    daily = sum(p['daily'] for p in active)
    net = daily-expenses
    return dict(manager=round((D['specialists'].sponsor_factor(conn, d['player_id'])-1)*100, 1), active=active, offers=[p for p in offers(conn, d, now) if p['slot'] not in used], refresh_at=(int(now//(7*DAY))+1)*7*DAY, reputation=rep, daily=daily, expenses=expenses, net=net, balance=d['budget'], runway_days=round(max(0,d['budget'])/-net,1) if net<0 else None)


def sign(conn, d, ident, now):
    if D['_busy'](conn, d['player_id']):
        return 'busy'
    p = next((p for p in offers(conn, d, now) if p['id']==ident), None)
    if not p:
        return 'offer'
    if any(json.loads(r[0])['slot']==p['slot'] for r in conn.execute('SELECT profile FROM sponsor_contract WHERE player_id=? AND expires>?', (d['player_id'], now))):
        return 'offer'
    # Accrue old agreements before a renewal. Expired terms are retained for audit.
    accrue(conn, d, now)
    conn.execute('INSERT INTO sponsor_contract(id,player_id,profile,started,expires,paid_at) VALUES(?,?,?,?,?,?)', (uuid.uuid4().hex, d['player_id'], json.dumps(p), now, now+TERM, now))
    if p['advance']:
        D['team'].note(conn, d['player_id'], 'sponsor', dict(name=p['name'], advance=True))
        conn.execute('UPDATE driver SET budget=budget+? WHERE player_id=?', (p['advance'], d['player_id']))
    return None


def result(conn, d, token, kind, car, medal, cheat, now):
    """One verified team event, with at most one bonus per contract per real day."""
    race = kind == 'd5_race'
    if not race and not medal or cheat:
        return 0
    finished = bool(race and car and not car.get('dnf'))
    points = car.get('points',0) if finished else 0
    podium = bool(finished and car['position'] <= 3)
    inserted = conn.execute('INSERT OR IGNORE INTO sponsor_event VALUES(?,?,?,?,?)', (d['player_id'], token, int(finished), points, int(podium))).rowcount
    if not inserted:
        return 0
    total = 0
    for r in conn.execute('SELECT * FROM sponsor_contract WHERE player_id=? AND started<=? AND expires>?', (d['player_id'], now, now)).fetchall():
        p=json.loads(r['profile'])
        success = (finished or bool(medal)) if p['goal']=='finish' else points>0 if p['goal']=='points' else finished and car['position']<=10
        if success and (not r['bonus_at'] or now-r['bonus_at']>=DAY):
            total += p['bonus']
            conn.execute('UPDATE sponsor_contract SET bonus_at=? WHERE id=?', (now,r['id']))
    return total
