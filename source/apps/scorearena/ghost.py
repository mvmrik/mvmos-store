"""Ghost opponent — a simulated rival for solo practice.

Not "vs the computer": this app stays a scorekeeper. A ghost is a virtual
presence in a solo run, turns alternating with the real player, so there is
someone to keep pace with instead of an empty table. It never becomes a real
Game Hub player — it has no id in the room roster, is never invited, never
shows up in anyone else's lobby, and never gets its own session row. The human
player's own solo session is what gets recorded, exactly as if they had played
alone.

How a ghost throws
------------------
The ghost plays on a real dartboard, measured in millimetres (standard board:
inner bull 6.35, outer bull 15.9, treble 99-107, double 162-170). For every
dart it first decides, like a player would, which spot to aim at — T20 at
501, the double that finishes, the next cricket number, and so on. The dart
then lands somewhere around that spot: a random point from a circular normal
spread whose width (`sigma`, in mm) is the ghost's whole skill. Whatever bed
that point falls in is the score, and the point itself is sent to the board
so everyone sees where the dart stuck.

Nothing else decides a hit. A small bed is harder simply because it is small,
a treble missed usually lands in the single around it or in the neighbouring
wedge on the real board, and a double missed can drop off the board — all of
it falls out of the geometry.

Skill and mood
--------------
`sigma` is taken once per match from the player's own recent results in the
same game (see `ghost_from_history`): the calibration tables below map the
game's headline stat to the sigma at which this very ghost, playing its own
strategy, averages that stat. So a ghost against a 45 three-dart average
throws a 45 average, and one against a 2.0 MPR cricket player marks about
2.0 a turn.

Mood is separate: it starts neutral and drifts with results *within* the match
(confidence rises on turns better than the player's own average, dips on worse
ones), tightening or widening the spread by up to MOOD_SWAY, so the ghost feels
a little streaky and human.
"""
import math
import random
from bisect import bisect_left
from functools import lru_cache

# Wedges clockwise from the top, the same order the board in mp.js draws.
BOARD_ORDER = (20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5)

R_INNER_BULL = 6.35
R_OUTER_BULL = 15.9
R_TREBLE_IN = 99.0
R_TREBLE_OUT = 107.0
R_DOUBLE_IN = 162.0
R_DOUBLE_OUT = 170.0

# Middle of each bed, where a player puts the dart when that bed is the target.
AIM_RADIUS = {
    "treble": (R_TREBLE_IN + R_TREBLE_OUT) / 2,
    "double": (R_DOUBLE_IN + R_DOUBLE_OUT) / 2,
    "single": (R_TREBLE_OUT + R_DOUBLE_IN) / 2,   # the big outer single
    "outer_bull": (R_INNER_BULL + R_OUTER_BULL) / 2,
}

# The ghost cannot be perfect nor hopeless: below SIGMA_MIN it would hit every
# treble, and SIGMA_MAX (about a 15 three-dart average, 1.2 MPR) is the
# weakest it ever gets, so it keeps landing darts even against a beginner.
SIGMA_MIN = 8.0
SIGMA_MAX = 55.0

# Spread when the player has no history in the game yet: a casual pub player.
DEFAULT_SIGMA = 24.0

# How much two matches against the same history can differ in spread, so the
# ghost is not the exact same thrower every time.
SIGMA_JITTER = 0.06

# Full confidence tightens the spread by this share, full dejection widens it.
MOOD_SWAY = 0.15

# Darts the ghost imagines when it weighs one spot against another.
PLAN_SAMPLES = 400

MOOD_STATES = ("cold", "steady", "hot")


# ── board geometry ─────────────────────────────────────────────────────────

def score_at(x: float, y: float):
    """The bed under a point on the board (mm from the centre, y downwards):
    (number, multiplier); (0, 0) off the board, (25, 1/2) for the bulls."""
    r = math.hypot(x, y)
    if r <= R_INNER_BULL:
        return 25, 2
    if r <= R_OUTER_BULL:
        return 25, 1
    if r > R_DOUBLE_OUT:
        return 0, 0
    angle = math.degrees(math.atan2(y, x))
    number = BOARD_ORDER[int(((angle + 99) % 360) // 18)]
    if R_TREBLE_IN < r <= R_TREBLE_OUT:
        return number, 3
    if r > R_DOUBLE_IN:
        return number, 2
    return number, 1


def spot(number: int, bed: str, radius: float = None):
    """Board point at the middle of `bed` ("single"/"double"/"treble") of
    `number`, or at `radius` along that wedge. Number 25 is the bull:
    "double" is the bullseye itself, anything else the outer bull ring."""
    if number == 25:
        return (0.0, 0.0) if bed == "double" else (0.0, -AIM_RADIUS["outer_bull"])
    r = radius if radius is not None else AIM_RADIUS[bed]
    a = math.radians(BOARD_ORDER.index(number) * 18 - 90)
    return r * math.cos(a), r * math.sin(a)


# ── 501 checkout planning ─────────────────────────────────────────────────
# Every throw the ghost can plan: (number, multiplier, points, effort). Effort
# is how awkward the throw is as a set-up dart — a single is easy, a treble or
# a bull is a gamble — so two finishes of equal length prefer the easier path.

_SETUPS = ([(n, 1, n, 1) for n in range(1, 21)] + [(n, 3, 3 * n, 3) for n in range(1, 21)]
           + [(n, 2, 2 * n, 4) for n in range(1, 21)] + [(25, 1, 25, 4), (25, 2, 50, 6)])

# Finishing doubles, favourite first: D20/D16 split into more doubles when
# missed, D1 or the bull are last resorts.
_DOUBLE_PREF = {20: 0, 16: 0, 8: 1, 10: 1, 18: 1, 12: 1, 4: 2, 14: 2, 6: 2, 2: 2}
_FINISHES = [(n, 2, 2 * n, _DOUBLE_PREF.get(n, 3 if n == 1 else 2)) for n in range(1, 21)] + [(25, 2, 50, 3)]


@lru_cache(maxsize=None)
def finish_plan(total: int, darts: int):
    """Cheapest way to check out `total` with at most `darts` darts, finishing
    on a double: (cost, ((number, multiplier), ...)) or None. Fewer darts
    always win; among those, easier set-ups and friendlier doubles."""
    best = None
    for n, m, value, pref in _FINISHES:
        if value == total:
            cand = (10 + pref, ((n, m),))
            if best is None or cand[0] < best[0]:
                best = cand
    if best is None and darts >= 2:
        for n, m, value, effort in _SETUPS:
            rest = total - value
            if rest < 2:
                continue
            sub = finish_plan(rest, darts - 1)
            if sub:
                cand = (10 + effort + sub[0], ((n, m),) + sub[1])
                if best is None or cand[0] < best[0]:
                    best = cand
    return best


def _leave_cost(left: int) -> float:
    """How bad it is to be left on `left` for the next turn."""
    if left <= 170:
        plan = finish_plan(left, 3)
        if plan:
            return plan[0]
    # No finish from here: every point still standing is a cost.
    return 40 + (left - 170) * 0.5 if left > 170 else 60


@lru_cache(maxsize=None)
def plan_501(remaining: int, darts_left: int):
    """(number, multiplier) the ghost aims at with `remaining` points left and
    `darts_left` darts in hand: the first dart of a checkout when one exists,
    otherwise the throw that leaves the best number for later (T20 while far
    away, a set-up that leaves a favourite double when close)."""
    if remaining <= 170:
        plan = finish_plan(remaining, darts_left)
        if plan:
            return plan[1][0]
    best = None
    for n, m, value, effort in _SETUPS:
        left = remaining - value
        if left < 2:
            continue
        cand = (effort + _leave_cost(left), -value, (n, m))
        if best is None or cand < best:
            best = cand
    return best[2] if best else (20, 1)


# ── the ghost ─────────────────────────────────────────────────────────────

class Ghost:
    def __init__(self, sigma: float, par: float = None, seed=None):
        self._rng = random.Random(seed)
        # Planning uses its own dice so imagining darts never shifts the real ones.
        self._think = random.Random(self._rng.random())
        self.base_sigma = max(SIGMA_MIN, min(SIGMA_MAX, sigma))
        self.sigma = max(SIGMA_MIN, min(SIGMA_MAX,
                         self.base_sigma * self._rng.uniform(1 - SIGMA_JITTER, 1 + SIGMA_JITTER)))
        # The player's own average in this game, what "a good turn" is measured against.
        self.par = par
        # Confidence walks in [-1, 1]. Neutral start: the ghost hasn't proven
        # anything yet this match. Streaks (react()) push it around.
        self.confidence = 0.0
        self._number_aims = {}

    # ── mood ──────────────────────────────────────────────────────────────
    def react(self, good: bool):
        """Call once per ghost turn with whether that turn went well (the game
        decides what "well" means, against `par`). Confidence has inertia so
        one great or terrible turn doesn't flip the mood outright — it takes a
        small streak to."""
        step = 0.22 if good else -0.28  # losing rattles it faster than winning settles it
        self.confidence = max(-1.0, min(1.0, self.confidence + step))

    def mood(self) -> str:
        if self.confidence >= 0.45:
            return "hot"
        if self.confidence <= -0.45:
            return "cold"
        return "steady"

    def spread(self) -> float:
        return self.sigma * (1 - MOOD_SWAY * self.confidence)

    # ── throwing ──────────────────────────────────────────────────────────
    def throw(self, aim) -> dict:
        """One dart at board point `aim`: it lands around it and scores
        whatever bed it hits. `checkout_attempt` is a human bookkeeping flag
        and never set for the ghost."""
        s = self.spread()
        x = aim[0] + self._rng.gauss(0, s)
        y = aim[1] + self._rng.gauss(0, s)
        number, multiplier = score_at(x, y)
        return {"number": number, "multiplier": multiplier, "checkout_attempt": False,
                "x": round(x, 1), "y": round(y, 1), "aim_x": round(aim[0], 1), "aim_y": round(aim[1], 1)}

    def _chance(self, aim, test) -> float:
        """How often a dart aimed at `aim` lands on a bed `test(number,
        multiplier)` accepts — the ghost's own feel for its throw."""
        s = self.spread()
        hits = 0
        for _ in range(PLAN_SAMPLES):
            if test(*score_at(aim[0] + self._think.gauss(0, s), aim[1] + self._think.gauss(0, s))):
                hits += 1
        return hits / PLAN_SAMPLES

    def _expected(self, aim, value) -> float:
        s = self.spread()
        return sum(value(*score_at(aim[0] + self._think.gauss(0, s), aim[1] + self._think.gauss(0, s)))
                   for _ in range(PLAN_SAMPLES)) / PLAN_SAMPLES

    def _aim_for_number(self, number: int):
        """Spot that most often hits `number` in any bed. A tight thrower is
        indifferent; a wide one learns that the fat part of the wedge, not the
        thin end near the bull, keeps the dart in the number."""
        if number == 25:
            return spot(25, "double")
        key = (number, round(self.spread()))
        if key not in self._number_aims:
            options = [spot(number, "single", r) for r in (60, 103, 125, 140)]
            self._number_aims[key] = max(options, key=lambda a: self._chance(a, lambda n, m: n == number))
        return self._number_aims[key]

    # ── games ─────────────────────────────────────────────────────────────
    def dart_501(self, remaining: int, darts_left: int) -> dict:
        """Aims like a player: T20 while far away, set-up darts that leave a
        favourite double, and the double that finishes (see plan_501)."""
        number, multiplier = plan_501(remaining, darts_left)
        bed = {1: "single", 2: "double", 3: "treble"}[multiplier]
        return self.throw(spot(number, bed))

    def dart_cricket(self, marks: dict, score: float, rivals: list) -> dict:
        """`marks` is {"20": 0..3, ...} for the ghost, `rivals` a list of
        (marks, score) for the other players. Standard play: while behind, score
        on a number the ghost owns and a rival has not closed; otherwise close
        the next open number, 20 down to 15 then bull, always at the treble."""
        order = (20, 19, 18, 17, 16, 15, 25)
        behind = any(s > score for _, s in rivals)
        scoring = [n for n in order if marks[str(n)] >= 3 and any(m[str(n)] < 3 for m, _ in rivals)]
        open_numbers = [n for n in order if marks[str(n)] < 3]
        if (behind or not open_numbers) and scoring:
            target = scoring[0]
        elif open_numbers:
            target = open_numbers[0]
        else:
            target = 20
        return self.throw(spot(target, "double" if target == 25 else "treble"))

    def dart_sequence(self, target_number: int) -> dict:
        """Breakdown / Around the Clock: any bed of the target number counts,
        so the ghost aims where it hits that number most often."""
        return self.throw(self._aim_for_number(target_number))

    def dart_golf(self, hole_number: int, best: int) -> dict:
        """Darts golf: double = 1 stroke, treble = 2, single = 3, another
        number = 4, off the board = 5, and only the best dart counts. The ghost
        weighs going for the double against the safer beds, knowing the stroke
        it already has on this hole (`best`)."""
        def stroke(n, m):
            if n == hole_number:
                return {2: 1, 3: 2, 1: 3}[m]
            return 5 if n == 0 else 4
        options = [spot(hole_number, bed) for bed in ("double", "treble", "single")]
        aim = min(options, key=lambda a: self._expected(a, lambda n, m: min(best, stroke(n, m))))
        return self.throw(aim)

    def dart_bitcoin(self, targets: list) -> dict:
        """One dart at the easiest still-open bitcoin target
        ({"type": single/double/triple, "number": n}; 25 is the outer bull,
        50 the bullseye)."""
        def aim_and_test(t):
            if t["number"] in (25, 50):
                mult = 2 if t["number"] == 50 else 1
                return spot(25, "double" if mult == 2 else "single"), (lambda n, m: n == 25 and m == mult)
            mult = {"single": 1, "double": 2, "triple": 3}.get(t["type"], 1)
            bed = {1: "single", 2: "double", 3: "treble"}[mult]
            return spot(t["number"], bed), (lambda n, m: n == t["number"] and m == mult)
        options = [aim_and_test(t) for t in targets]
        aim, _ = max(options, key=lambda o: self._chance(o[0], o[1])) if len(options) > 1 else options[0]
        return self.throw(aim)


# ── skill from history ───────────────────────────────────────────────────
# (sigma mm, stat) pairs: the stat this ghost averages at that spread when it
# plays the game by its own strategy above, measured by simulating thousands
# of games through mp_game.py's real rules. Regenerate them whenever the
# strategy or the rules change, or the ghost stops matching the player.

CALIBRATION = {
    "501": ((8, 87.55), (10, 74.73), (12, 63.39), (14, 57.17), (17, 46.68), (20, 41.25), (24, 34.14), (28, 30.05), (33, 26.95), (38, 22.74), (44, 19.77), (50, 16.95), (57, 14.62)),
    "301": ((8, 79.72), (10, 67.51), (12, 58.42), (14, 51.83), (17, 42.55), (20, 34.73), (24, 29.23), (28, 25.67), (33, 21.13), (38, 18.08), (44, 15.23), (50, 12.65), (57, 10.66)),
    "cricket": ((8, 4.78), (10, 4.09), (12, 3.45), (14, 2.97), (17, 2.48), (20, 2.14), (24, 1.82), (28, 1.62), (33, 1.48), (38, 1.37), (44, 1.29), (50, 1.22), (57, 1.15)),
    "atc": ((8, 34.16), (10, 33.11), (12, 31.81), (14, 29.79), (17, 27.04), (20, 23.86), (24, 20.16), (28, 17.06), (33, 14.03), (38, 11.09), (44, 8.96), (50, 7.5), (57, 5.97)),
    "breakdown": ((8, 34.16), (10, 33.13), (12, 31.92), (14, 30.29), (17, 27.18), (20, 23.99), (24, 20.17), (28, 17.21), (33, 13.83), (38, 11.32), (44, 9.06), (50, 7.58), (57, 5.88)),
    "progolf": ((8, 1.63), (10, 1.86), (12, 2.03), (14, 2.21), (17, 2.43), (20, 2.54), (24, 2.7), (28, 2.85), (33, 2.99), (38, 3.11), (44, 3.25), (50, 3.35), (57, 3.46)),
    "minigolf": ((8, 1.68), (10, 1.89), (12, 2.05), (14, 2.23), (17, 2.45), (20, 2.54), (24, 2.72), (28, 2.87), (33, 3.03), (38, 3.12), (44, 3.27), (50, 3.36), (57, 3.48)),
    "bitcoin": ((8, 49.8), (10, 47.88), (12, 43.95), (14, 38.08), (17, 28.55), (20, 20.26), (24, 12.14), (28, 7.34), (33, 4.27), (38, 2.84)),
}

# Stat each mode is matched on.
STAT_FOR_MODE = {
    "501": "three_dart_average",
    "301": "three_dart_average",
    "cricket": "mpr",
    "breakdown": "three_dart_average",
    "atc": "three_dart_average",
    "progolf": "avg",
    "minigolf": "avg",
    "bitcoin": "hit_rate",
}


def sigma_for(mode: str, stat: float) -> float:
    """Sigma at which the ghost averages `stat` in `mode`, interpolated from
    CALIBRATION and clamped to its ends."""
    table = CALIBRATION.get(mode)
    if not table:
        return DEFAULT_SIGMA
    sigmas = [s for s, _ in table]
    values = [v for _, v in table]
    rising = values[-1] > values[0]
    # Search on a rising sequence either way.
    keyed = values if rising else [-v for v in values]
    key = stat if rising else -stat
    i = bisect_left(keyed, key)
    if i <= 0:
        return sigmas[0]
    if i >= len(table):
        return sigmas[-1]
    k0, k1 = keyed[i - 1], keyed[i]
    t = (key - k0) / (k1 - k0) if k1 != k0 else 0
    return sigmas[i - 1] + t * (sigmas[i] - sigmas[i - 1])


def stat_at(mode: str, sigma: float) -> float:
    """The stat the ghost averages in `mode` at `sigma` (inverse of sigma_for)."""
    table = CALIBRATION.get(mode)
    if not table:
        return 0.0
    if sigma <= table[0][0]:
        return table[0][1]
    for (s0, v0), (s1, v1) in zip(table, table[1:]):
        if sigma <= s1:
            return v0 + (sigma - s0) / (s1 - s0) * (v1 - v0)
    return table[-1][1]


def ghost_from_history(mode: str, sessions: list, seed=None) -> Ghost:
    """A ghost that shadows the player: `sessions` are the player's recent
    solo `player_stats` dicts for this mode (written by mp_game.py's finish
    functions). No history yet -> a mid-table default rather than refusing
    to start a ghost match."""
    stat = STAT_FOR_MODE.get(mode, "three_dart_average")
    values = [s.get(stat) for s in sessions if s.get(stat)]
    sigma = sigma_for(mode, sum(values) / len(values)) if values else DEFAULT_SIGMA
    sigma = max(SIGMA_MIN, min(SIGMA_MAX, sigma))
    # A good turn is one above what this ghost itself averages — the player's
    # own average, unless the limits above kept the ghost from matching it.
    return Ghost(sigma, par=stat_at(mode, sigma), seed=seed)
