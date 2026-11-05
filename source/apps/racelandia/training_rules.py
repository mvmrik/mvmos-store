"""Training progression and skill effects shared by server-owned sessions."""
import math

CYCLE_LIMIT = 10
ENERGY = 30
DAY = 86400


def difficulty(level):
    # Same rule as the pilot games: the current skill alone sets the challenge, from the easiest at
    # skill 1 to 1.0 at skill 100. There is no final level: it keeps rising beyond 100.
    return round(max(0.0, (level-1.0)/99.0), 4)


def capped(before, step, floor=0.0, top=100.0):
    """A skill after a step: never above 100; a value already above it can only lose, and not below 100."""
    if before > top:
        return max(top, before+min(0.0, step))
    return min(top, max(floor, before+step))


def gain(skill, aptitude, weight, performance, threshold=.4):
    if performance < threshold:
        return -.35*weight*(threshold-performance)/threshold
    effort = ((performance-threshold)/(1-threshold))**1.2
    return 1.4*weight*effort*(.65+.35*min(100,max(0,aptitude))/100)/(1+(skill/100)**2)


def effective_skill(value):
    """Physical effects approach an elite ceiling smoothly; stored skills stay uncapped."""
    value = max(0, value)
    return value if value <= 80 else 80+20*(1-math.exp(-(value-80)/20))


def start_delay(reaction, energy=100):
    return .12+.95*(1-effective_skill(reaction)/100)**1.8+max(0,1-energy/100)*.18


def schema(conn):
    conn.execute('CREATE TABLE IF NOT EXISTS training_hall_state (player_id TEXT PRIMARY KEY, used INTEGER NOT NULL, reset_at REAL NOT NULL)')


def hall(conn, player_id, now):
    row=conn.execute('SELECT used,reset_at FROM training_hall_state WHERE player_id=?',(player_id,)).fetchone()
    if row:
        used,reset_at=row['used'],row['reset_at']
    else:
        # Preserve the current career's attempts when moving from calendar days
        # to cycles. This is read-only until the next successful start.
        used,reset_at=0,0
        for r in conn.execute('SELECT started FROM training WHERE player_id=? ORDER BY started,tid',(player_id,)):
            at=r['started']
            if reset_at:
                if at<reset_at:continue
                used,reset_at=0,0
            used+=1
            if used==CYCLE_LIMIT:reset_at=at+DAY
    if reset_at and now>=reset_at:used,reset_at=0,0
    return dict(limit=CYCLE_LIMIT,used=used,remaining=max(0,CYCLE_LIMIT-used),reset_at=reset_at,server_time=now)


def consume(conn,player_id,now):
    """Called under the same write lock as energy debit and session creation."""
    state=hall(conn,player_id,now)
    if not state['remaining']:return False
    used=state['used']+1
    reset_at=now+DAY if used==CYCLE_LIMIT else 0
    conn.execute('INSERT INTO training_hall_state VALUES(?,?,?) ON CONFLICT(player_id) DO UPDATE SET used=excluded.used,reset_at=excluded.reset_at',(player_id,used,reset_at))
    return True


def minimum_seconds(game, level, default):
    q=level*level
    if game=='catch':return max(.5, 28*1.2/(1+3*q)*.45)
    if game in ('brake','lights'):return max(.5, default/(1+2*q))
    if game=='pit':return max(.1, default/(1+7*q))
    return default


def driving_energy(base, fitness):
    return round(base*(1.2-.7*effective_skill(fitness)/100),2)
