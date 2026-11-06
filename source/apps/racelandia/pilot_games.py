"""The pilot's training games: one small game for each skill, all scored by one rule.

Every game reports one number. The skill alone decides how exact that number must be: a
tolerance that is loose at skill 1 and tight at skill 100 (TOLERANCE below, straight between
the two). Dead on is +100%, the edge of the tolerance is +1%, a small miss outside it is -20%
and a whole tolerance further out is -100%. The skill then moves by that percentage in
hundredths of a point: +100% is +1 point, -100% takes 1 point away. There are no other
references, no neutral result and no difference between the games.

The start lights are the one exception: the reference is the reaction time of the current skill (REACTION_MS at skill
50, shorter as the skill grows) and the window is a quarter of it each way. Equal to the reference is 0, 25% quicker is
+100%, 25% slower is -100%, and in between it is straight, so +-12.5% gives +-50%.
"""
import math

SKILL_FLOOR = 25.0
REACTION_MS = 400.0         # the average reaction time of a pilot with skill 50
REACTION_EXPONENT = .6      # how quickly it shortens with the skill
REACTION_WINDOW = .25       # a quarter of the reference each way is the whole +-100%

# game id == skill id.  minimum = seconds a real session takes at least.
GAMES = {
    'reaction':    dict(kind='ratio', low=True,  unit='ms',  minimum=10),
    'reflexes':    dict(kind='ratio', low=True,  unit='',    minimum=10),
    'pace':        dict(kind='ratio', low=False, unit='',    minimum=15),
    'braking':     dict(kind='ratio', low=True,  unit='m',   minimum=10),
    'cornering':   dict(kind='ratio', low=True,  unit='',    minimum=20),
    'traction':    dict(kind='ratio', low=True,  unit='',    minimum=20),
    'consistency': dict(kind='ratio', low=True,  unit='s',   minimum=20),
    'focus':       dict(kind='ratio', low=True,  unit='',    minimum=20),
    'composure':   dict(kind='ratio', low=True,  unit='s',   minimum=15),
    'tyreCare':    dict(kind='ratio', low=True,  unit='',    minimum=20),
    'wet':         dict(kind='ratio', low=True,  unit='m',   minimum=12),
    'fitness':     dict(kind='ratio', low=False, unit='/s',  minimum=60),
    'feedback':    dict(kind='ratio', low=True,  unit='',    minimum=15),
}

# (tolerance at skill 1, tolerance at skill 100), in the unit of the game's number
TOLERANCE = {
    'reflexes':    (2.0, .5),       # average distance from the centre, in ball radii
    'pace':        (.60, .15),      # share of the balls that may be missed
    'braking':     (16.0, 4.0),
    'cornering':   (.60, .15),
    'traction':    (.40, .10),
    'consistency': (1.0, .5),
    'focus':       (.48, .12),
    'composure':   (2.4, .6),
    'tyreCare':    (.70, .18),
    'wet':         (36.0, 9.0),
    'fitness':     (1.7, 5.5),      # taps per second needed, rising with the skill
    'feedback':    (.14, .035),
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
    """The games themselves no longer change with the skill: only the tolerance above does."""
    return 0.0


def reference(game, skill):
    """How exact the number must be for this skill (the edge of the +1% zone). Skill 1..100, held at 100 beyond."""
    if game == 'reaction':
        return REACTION_MS * (50.0 / max(SKILL_FLOOR, float(skill))) ** REACTION_EXPONENT
    if game not in TOLERANCE:
        return GAMES[game].get('ref', 0.0)      # reflexes has no skill tolerance
    t1, t100 = TOLERANCE[game]
    return t1 + (t100 - t1) * min(1.0, max(0.0, (float(skill) - 1.0) / 99.0))


def metric(game, res):
    """The one number of the session from the raw numbers the browser measured, or None when the data is unusable."""
    res = res if isinstance(res, dict) else {}
    if game == 'reaction':
        times = _list(res, 'times', 5, -1, 5000, -1)
        return None if times is None else times
    if game == 'reflexes':
        errs = _list(res, 'errors', 8, 0, 50, 50)
        return None if errs is None else sum(errs) / len(errs)    # in ball radii
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
        goal = _num(res.get('goal'), 1500, 3000, 1500)           # a random target of 1.5-3 s for each game
        return min(abs(x - goal) for x in stops) / 1000.0        # the best stop counts, in seconds off target
    if game == 'composure':
        times = _list(res, 'times', 6, 0, 6, 6)
        return None if times is None else sum(times) / len(times)
    if game == 'fitness':
        taps = _list(res, 'buckets', 6, 0, 1000, 0)
        return None if taps is None else sum(taps) / 60.0         # taps per second over the whole minute
    return None


def curve(x):
    """x = miss / tolerance: 0 is +100%, 1 is +1%, then -20% and down to -100% a whole tolerance further."""
    return 1 - .99 * x if x <= 1 else -min(1.0, .2 + .8 * (x - 1))


def percent(game, skill, res):
    """(p, result, reference): p is -1..+1, the share of a whole skill point this session earned."""
    ref = reference(game, skill)
    m = metric(game, res)
    if m is None:
        return 0.0, None, ref
    if game == 'reaction':
        # a false start or no press counts as the reference time itself; fewer than two real presses is the worst result
        timed = [t if t >= 110 else ref for t in m]
        m = sum(timed) / 5
        if sum(1 for t in [t for t in (res.get('times') or [])][:5] if t >= 110) < 2:
            return -1.0, m, ref
        return max(-1.0, min(1.0, (ref - m) / (REACTION_WINDOW * ref))), m, ref
    if game == 'pace':
        x = (1 - m) / ref
    elif game == 'fitness':
        x = max(0.0, (1.5 * ref - m) / (.5 * ref))
    else:
        x = m / ref
    return max(-1.0, min(1.0, curve(x))), m, ref
