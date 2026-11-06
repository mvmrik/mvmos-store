"""Role-specific crew exercises: server settings and scoring of raw measurements."""
import math

MECHANICS = ('wheel_service', 'jack_balance', 'repair_wiring', 'release_gap')
ROUNDS = 6
ROUND_SECONDS = 5


def settings(difficulty):
    d = max(0, float(difficulty)); q = d*(1+d)/2
    return dict(rounds=ROUNDS, roundSeconds=ROUND_SECONDS,
                wheelNuts=4 if d < .34 else 5 if d < .67 else 6, wheelFault=.08+.1*min(d, 1),
                jackBand=.34/(1+3*q), jackLeak=.10+.12*q,
                jackCharge=.22/(1+3*q), jackHold=min(3.6, 1.8*(1+.5*d)), wireWidth=30/(1+5*q),
                wireTime=4.8/(1+3*q), releaseGap=.65*(1+.4*d),
                releaseWindow=1.65/(1+7*q), releaseTime=1.6/(1+4*q))


def _number(value, default=0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (ValueError, TypeError, OverflowError):
        return default


def score(game, result, difficulty):
    if game not in MECHANICS or not isinstance(result, dict): return 0.0
    rows = result.get('rounds')
    if result.get('version') != 1 or not isinstance(rows, list) or len(rows) != ROUNDS: return 0.0
    cfg = settings(difficulty)
    def cap(v): return min(1.0, max(0.0, v))
    total = 0.0
    for row in rows:
        if not isinstance(row, dict): continue
        seconds = _number(row.get('seconds'), 99)
        if seconds < .15 or seconds > ROUND_SECONDS+.1: continue
        if game == 'wheel_service':
            # Every nut is taken off and put back: two steps per nut, wrong taps cost a little.
            steps = max(0, _number(row.get('steps')))
            faults = max(0, _number(row.get('faults'), 99))
            total += cap(min(steps, 2*cfg['wheelNuts'])/(2*cfg['wheelNuts'])-cfg['wheelFault']*faults)
        elif game == 'jack_balance':
            held = max(0, min(seconds, _number(row.get('stable'))))
            strokes = max(0, _number(row.get('strokes')))
            total += cap(held/cfg['jackHold'])*min(1,strokes/3)
        elif game == 'repair_wiring':
            if row.get('connected') is not True: continue
            deviation = max(0, _number(row.get('deviation'), 999))
            faults = max(0, _number(row.get('faults'), 99))
            total += cap(1-deviation/cfg['wireWidth'])*cap(1-.15*faults)*min(1,cfg['wireTime']/seconds)
        else:
            if row.get('ready') is not True: continue
            gap = _number(row.get('gap'))
            delay = _number(row.get('delay'), 99)
            if gap < cfg['releaseGap'] or delay < 0: continue
            total += cap(cfg['releaseTime']/max(.1,delay))
    return total/ROUNDS
