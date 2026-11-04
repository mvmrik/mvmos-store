"""The pilot's training games: one small game for each skill, scored as a share of that skill.

Every game reports one number. The server compares it with the reference of the pilot's
current skill and turns the difference into a percentage p between -1 and +1. The skill then
moves by p points: +10% on the reference is +0.1 on the skill, +100% is +1, and a worse
result takes the same amount away. There is no ceiling: the better the pilot gets, the
tighter the reference becomes.

Two kinds of game:
  ratio  the number has a unit (milliseconds, metres, seconds). Its reference follows the skill
         (b50 at skill 50, tighter as the skill grows), p = (reference - result) / reference.
  score  the number is a 0..1 share (or -1..1) and the exercise itself gets faster and
         smaller with the level; p is the distance from a fixed reference share.
"""
import math

EXPONENT = .6          # how quickly the reference tightens with the skill
SKILL_FLOOR = 25.0

# game id == skill id.  minimum = seconds a real session takes at least.
GAMES = {
    'reaction':    dict(kind='ratio', low=True,  b50=400.0, unit='ms',  minimum=10),
    'reflexes':    dict(kind='score', lo=-1.0, ref=0.0,  minimum=10),
    'pace':        dict(kind='score', lo=0.0,  ref=.62, minimum=15),
    'braking':     dict(kind='ratio', low=True,  b50=8.0,   unit='m',   minimum=10),
    'cornering':   dict(kind='ratio', low=True,  b50=.30,   unit='',    minimum=20),
    'traction':    dict(kind='ratio', low=True,  b50=.20,   unit='',    minimum=20),
    'consistency': dict(kind='ratio', low=True,  b50=90.0,  unit='ms',  minimum=20),
    'focus':       dict(kind='ratio', low=True,  b50=.24,   unit='',    minimum=20),
    'composure':   dict(kind='ratio', low=True,  b50=1.2,   unit='s',   minimum=15),
    'tyreCare':    dict(kind='ratio', low=True,  b50=.35,   unit='',    minimum=20),
    'wet':         dict(kind='ratio', low=True,  b50=18.0,  unit='m',   minimum=12),
    'fitness':     dict(kind='ratio', low=False, b50=3.4,   unit='/s',  minimum=60),
    'feedback':    dict(kind='ratio', low=True,  b50=.07,   unit='',    minimum=15),
}


def _num(v, lo, hi, default):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(v):
        return default
    return min(hi, max(lo, v))


def _list(res, key, count, lo, hi, default):
    v = res.get(key)
    if not isinstance(v, list) or len(v) < count:
        return None
    return [_num(x, lo, hi, default) for x in v[:count]]


def level(skill):
    """How far above the starting value the pilot is (0 at 50), for the games that speed up."""
    return round(max(0.0, (float(skill) - 50.0) / 50.0), 4)


def reference(game, skill):
    """The result that counts as 'as good as now' for a pilot with this skill."""
    g = GAMES[game]
    if g['kind'] == 'score':
        return g['ref']
    s = max(SKILL_FLOOR, float(skill))
    return g['b50'] * ((50.0 / s) ** EXPONENT if g['low'] else (s / 50.0) ** EXPONENT)


def metric(game, res):
    """The one number of the session from the raw numbers the browser measured, or None when the data is unusable."""
    res = res if isinstance(res, dict) else {}
    if game == 'reaction':
        times = _list(res, 'times', 5, -1, 5000, -1)
        return None if times is None else times
    if game == 'reflexes':
        errs = _list(res, 'errors', 8, 0, 50, 50)
        if errs is None:
            return None
        out = []
        for e in errs:
            if e <= 1:
                out.append(1 - .99 * e)                         # dead centre 100%, edge of the ball 1%
            else:
                out.append(-min(1.0, .2 + .8 * (e - 1)))        # a small miss -20%, a whole ball away -100%
        return sum(out) / len(out)
    if game == 'pace':
        total = int(_num(res.get('total'), 0, 200, 0))
        caught = int(_num(res.get('caught'), 0, 200, 0))
        if total < 20:
            return None
        return min(1.0, caught / total)
    if game == 'braking':
        errs = _list(res, 'errors', 6, -400, 400, 400)
        return None if errs is None else sum(abs(e) for e in errs) / len(errs)
    if game == 'wet':
        errs = _list(res, 'errors', 6, -400, 400, 400)
        return None if errs is None else abs(errs[5])           # five practice runs, the sixth counts
    if game in ('cornering', 'traction', 'focus', 'tyreCare', 'feedback'):
        value = res.get('error')
        if value is None:
            return None
        return _num(value, 0, 2, 2)
    if game == 'consistency':
        stops = _list(res, 'stops', 10, 0, 6000, 0)
        if stops is None:
            return None
        mean = sum(stops) / len(stops)
        return math.sqrt(sum((x - mean) ** 2 for x in stops) / (len(stops) - 1))
    if game == 'composure':
        times = _list(res, 'times', 6, 0, 6, 6)
        return None if times is None else sum(times) / len(times)
    if game == 'fitness':
        taps = _list(res, 'buckets', 6, 0, 1000, 0)
        return None if taps is None else sum(taps[-2:]) / 20.0   # taps per second over the last twenty seconds
    return None


def percent(game, skill, res):
    """(p, result, reference): p is -1..+1, the share of a whole 1% skill step this session earned."""
    g = GAMES[game]
    ref = reference(game, skill)
    m = metric(game, res)
    if m is None:
        return 0.0, None, ref
    if game == 'reaction':
        # a false start or no press counts twice the reference time
        valid = [t for t in m if t >= 110]
        timed = [t if t >= 110 else 2 * ref for t in m]
        if len(valid) < 2:
            return -1.0, round(sum(timed) / 5, 1), ref
        m = sum(timed) / 5
    if g['kind'] == 'score':
        lo, r = g['lo'], g['ref']
        p = (m - r) / (1 - r) if m >= r else (m - r) / (r - lo)
    elif g['low']:
        p = (ref - m) / ref
    else:
        p = (m - ref) / ref
    return max(-1.0, min(1.0, p)), m, ref
