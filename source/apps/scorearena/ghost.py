"""Ghost opponent — a simulated rival for solo practice.

Not "vs the computer": this app stays a scorekeeper. A ghost is a virtual
presence in a solo run, turns alternating with the real player, so there is
someone to keep pace with instead of an empty table. It never becomes a real
Game Hub player — it has no id in the room roster, is never invited, never
shows up in anyone else's lobby, and never gets its own session row. The human
player's own solo session is what gets recorded, exactly as if they had played
alone.

Game-agnostic by design so any turn-based scoring game in this app (darts
today, others later) can plug it in with three things:

  Ghost(skill, seed=None)      one ghost, skill 0..1 (see `skill_from_history`)
  ghost.dart(...)              one simulated dart for a specific game (501 /
                                cricket / bitcoin today; a new game adds its own
                                dart_for_<game> variant)
  ghost.react(good: bool)      tell the ghost how its last turn went, so mood
                                drifts before the next one

Skill is a single 0..1 number - how good the ghost's aim is - derived once at
match start from the player's own recent history in this game (see
`skill_from_history`) so the ghost plays at a level that shadows the player
instead of being a fixed difficulty. Mood is separate: it starts neutral and
drifts with results *within* the match (confidence rises on good turns, dips
on bad ones), nudging aim by a small amount on top of the fixed skill so the
ghost feels a little streaky and human rather than a static probability
machine.
"""
import random

DARTS_NUMBERS = tuple(range(1, 21))

# Skill is clamped here, not just at the edges: a ghost below this plays a
# game that is not really a contest (every dart a near-miss), and one above it
# stops feeling beatable, which defeats the "chase yourself" idea.
SKILL_MIN = 0.12
SKILL_MAX = 0.92

# How much the *displayed* skill can wander from the computed one, so two
# matches against the same history don't feel like the exact same ghost.
SKILL_JITTER = 0.06

MOOD_STATES = ("cold", "steady", "hot")


class Ghost:
    def __init__(self, skill: float, seed=None):
        self._rng = random.Random(seed)
        self.base_skill = max(SKILL_MIN, min(SKILL_MAX, skill))
        self.skill = max(SKILL_MIN, min(SKILL_MAX,
                          self.base_skill + self._rng.uniform(-SKILL_JITTER, SKILL_JITTER)))
        # Confidence walks in [-1, 1]. Neutral start: the ghost hasn't proven
        # anything yet this match. Streaks (react()) push it around; effective
        # aim below reads it back as a small, capped bonus/penalty on skill.
        self.confidence = 0.0

    # ── mood ──────────────────────────────────────────────────────────────
    def react(self, good: bool):
        """Call once per ghost turn with whether that turn went well (game
        decides what "well" means — e.g. scored >= 60 in 501, closed a number
        in cricket). Confidence has inertia so one great or terrible turn
        doesn't flip the mood outright — it takes a small streak to."""
        step = 0.22 if good else -0.28  # losing rattles it faster than winning settles it
        self.confidence = max(-1.0, min(1.0, self.confidence + step))

    def mood(self) -> str:
        if self.confidence >= 0.45:
            return "hot"
        if self.confidence <= -0.45:
            return "cold"
        return "steady"

    def _effective_skill(self) -> float:
        # Confidence sways aim by at most ±0.12 skill — enough to feel like a
        # streak, never enough to turn a weak ghost into a sharpshooter.
        return max(SKILL_MIN, min(SKILL_MAX, self.skill + self.confidence * 0.12))

    # ── throws ────────────────────────────────────────────────────────────
    # Every game below models one dart as: pick the intended target, then let
    # skill decide whether it lands clean, drifts to a neighbour, or misses
    # the board entirely. `checkout_attempt` is never set by the ghost — that
    # flag is a human bookkeeping nicety (mp_game.py tracks checkout stats
    # from it), meaningless for a simulated throw.

    def _miss_chance(self) -> float:
        return (1.0 - self._effective_skill()) * 0.5

    def _land(self, number: int, multiplier: int) -> dict:
        skill = self._effective_skill()
        r = self._rng.random()
        if r > skill:
            # A near-miss: same general area, wrong ring or wrong wedge — a
            # dart that was aimed well but did not land where sent, not a
            # blind swing. More likely the worse the skill.
            if self._rng.random() < 0.55 and multiplier > 1:
                multiplier -= 1
            elif number in DARTS_NUMBERS and self._rng.random() < 0.4:
                idx = DARTS_NUMBERS.index(number)
                number = DARTS_NUMBERS[(idx + self._rng.choice((-1, 1))) % 20]
        if self._rng.random() < self._miss_chance() * 0.35:
            return {"number": 0, "multiplier": 0, "checkout_attempt": False}
        return {"number": number, "multiplier": multiplier, "checkout_attempt": False}

    def dart_501(self, remaining: int) -> dict:
        """One simulated dart at a 501 remaining score. Prefers big scoring
        trebles while there's room, then narrows toward doubles/finishes."""
        if remaining <= 40 and remaining % 2 == 0 and remaining <= 50:
            target_num = remaining // 2
            if 1 <= target_num <= 20:
                return self._land(target_num, 2)
        if remaining == 50:
            return self._land(25, 2)
        if remaining > 110:
            return self._land(20, 3)
        return self._land(self._rng.choice((20, 19, 18, 17, 16)), self._rng.choice((1, 1, 3)))

    def dart_cricket(self, open_targets: list) -> dict:
        """One simulated dart aimed at one of the still-open cricket numbers
        (20/19/.../15/25), preferring trebles."""
        if not open_targets:
            return self._land(20, 1)
        number = self._rng.choice(open_targets)
        multiplier = 2 if number == 25 else self._rng.choice((1, 2, 3, 3))
        return self._land(number, multiplier)

    def dart_sequence(self, target_number: int) -> dict:
        """One simulated dart aimed at a single target number, for the
        sequential single-target games (Breakdown, Around the Clock). Any
        multiplier breaks the target down / advances the clock, so the ghost
        just aims for the biggest multiplier it can land, same as a real
        player chasing the fastest finish."""
        if target_number == 25:
            return self._land(25, 1)
        return self._land(target_number, 3)

    def dart_golf(self, hole_number: int) -> dict:
        """One simulated dart at a darts-golf hole: aims for the double
        (best possible stroke) first, since nothing beats it."""
        return self._land(hole_number, 2)

    def dart_bitcoin(self, target: dict) -> dict:
        """One simulated dart aimed squarely at a single bitcoin-darts target
        ({"type": single/double/triple, "number": n})."""
        mult = {"single": 1, "double": 2, "triple": 3}.get(target["type"], 1)
        number = target["number"]
        if number in (25, 50):
            return self._land(25, 2 if number == 50 else 1)
        return self._land(number, mult)


# ── skill from history ───────────────────────────────────────────────────

def skill_from_history(mode: str, sessions: list) -> float:
    """Derive a 0..1 skill from the player's recent solo `game_sessions` rows
    for this app (already filtered to `mode` and this player). Each entry is
    the `player_stats` dict this game itself wrote via mp_game.py's _finish().

    No history yet -> a mid-table default (0.5) rather than refusing to start
    a ghost match; it simply won't shadow the player until they've played a
    few rounds.
    """
    if not sessions:
        return 0.5
    if mode == "cricket":
        values = [s.get("mpr", 0) for s in sessions if s.get("mpr")]
        if not values:
            return 0.5
        avg = sum(values) / len(values)
        # ~1 MPR is a beginner, ~3+ MPR is a sharp player — map that range to
        # skill, clamped by the module-wide SKILL_MIN/MAX.
        return max(0.0, min(1.0, avg / 3.2))
    if mode in ("progolf", "minigolf"):
        values = [s.get("avg", 0) for s in sessions if s.get("avg")]
        if not values:
            return 0.5
        avg = sum(values) / len(values)
        # Par is 3 strokes/hole; ~3 is a strong player, ~5 (double bogey
        # every hole) is a beginner — lower strokes means higher skill.
        return max(0.0, min(1.0, (5 - avg) / 2))
    if mode == "bitcoin":
        values = [s.get("hit_rate", 0) for s in sessions if s.get("hit_rate")]
        if not values:
            return 0.5
        return max(0.0, min(1.0, (sum(values) / len(values)) / 100))
    # 501, 301 and the sequence games use the three-dart average as the best
    # shared proxy for how often this player's darts land where aimed.
    values = [s.get("three_dart_average", 0) for s in sessions if s.get("three_dart_average")]
    if not values:
        return 0.5
    avg = sum(values) / len(values)
    # ~30 is a beginner three-dart average, ~90+ is a strong club player.
    return max(0.0, min(1.0, (avg - 20) / 70))
