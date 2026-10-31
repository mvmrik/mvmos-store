"""
Flask Sort — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (any app with an
mp_game.py exposing `Game(ctx)`). The framework owns rooms, sockets, identity,
reconnects and writing the finished session; everything below is this game's
rules.

The server owns every player's flasks. It builds the levels, checks every pour
and decides when a level is cleared, so nobody can send a made-up result. A
level is a plain function of (room seed, level number): everybody in a room
plays exactly the same levels, each at their own pace. Everybody plays up to
the chosen last level, and when all are done the most points win; a player who
is faster only earns a speed bonus, not the win.

Alone, a game runs through all the levels, each a little harder than the one
before, and ends when the last one is cleared or when the player finishes it.

  client → server
    fs_pour    {a, b}        pour flask a into flask b
    fs_undo                  take back the last pour
    fs_restart               put the level back as it was dealt
    fs_hint                  show the next move, for the price of one filled flask
    fs_quit                  stop playing (alone this ends the run)

  server → client
    fs_state   {...}         the whole game, for a start or a reconnect
    fs_level   {...}         the player's level as it stands now (also the
                             answer to a pour the server did not accept)
    fs_hint_res {a, b, ...}  the move to make (a = -1: none found), and what it cost
    fs_cleared {...}         the player cleared a level; `next` is the next one
    fs_progress {pid, ...}   where somebody is, for the scoreboard
    fs_over    {results}     everybody is done
"""

import asyncio
import random
import time

from backend.assets import asset

MAX_COLORS = 20
MAX_CAP = 8
DOSE_POINTS = 10          # what one dose is worth; a hint costs one flask of them
MAX_LEVEL = 100           # where colours and doses both reach their most: nothing gets harder after it
TARGETS = (3, 5, 8, 10, 15, 20, 30, 40, 50, 75, 100)
GONE_GRACE = 20.0            # seconds everybody left may stay away before the game ends


def params(level: int):
    """Colours, doses per flask and spare flasks for a level. Both grow with the
    level and reach their most together at the last one (MAX_LEVEL): 2 colours
    and flasks of 3 doses at the start, 20 colours and 8 doses at the end, so
    the game ends where it would stop getting harder."""
    p = min(1.0, max(0.0, (level - 1) / (MAX_LEVEL - 1)))
    n = 2 + int(18 * p ** 0.75 + 0.5)
    cap = 3 + int(5.99 * p ** 0.9)
    return min(MAX_COLORS, n), min(MAX_CAP, cap), 2


# ── Solver: proves a level can be cleared and gives its par ──────────────────

def _top_run(t):
    c = t[-1]
    k = 1
    while k < len(t) and t[-1 - k] == c:
        k += 1
    return c, k


def _moves(tubes, cap):
    out = []
    for a, ta in enumerate(tubes):
        if not ta:
            continue
        c, k = _top_run(ta)
        mono = k == len(ta)
        for b, tb in enumerate(tubes):
            if a == b or len(tb) >= cap:
                continue
            if tb:
                if tb[-1] != c:
                    continue
            elif mono:
                continue          # moving a pure flask to an empty one gains nothing
            out.append((a, b, 1 if tb else 0, min(k, cap - len(tb))))
    return out


def _solved(tubes, cap):
    return all(not t or (len(t) == cap and len(set(t)) == 1) for t in tubes)


def _solve(start, cap, limit=20000):
    tubes = tuple(tuple(t) for t in start)
    seen = {tuple(sorted(tubes))}
    stack = [(tubes, 0)]
    nodes = 0
    best = None
    while stack and nodes < limit:
        cur, depth = stack.pop()
        nodes += 1
        if _solved(cur, cap):
            best = depth
            break
        ms = _moves(cur, cap)
        ms.sort(key=lambda m: (m[2], m[3]))          # the best candidate is tried first
        for a, b, _, cnt in ms:
            nt = list(cur)
            c = nt[a][-1]
            nt[a] = nt[a][:-cnt]
            nt[b] = nt[b] + (c,) * cnt
            nt = tuple(nt)
            key = tuple(sorted(nt))
            if key in seen:
                continue
            seen.add(key)
            stack.append((nt, depth + 1))
    return best


def _dfs_first_move(start, cap, limit):
    """The first move of any solution found by the search, or None."""
    seen = {tuple(sorted(start))}
    stack = [(start, None)]
    nodes = 0
    while stack and nodes < limit:
        cur, first = stack.pop()
        nodes += 1
        if _solved(cur, cap):
            return first
        ms = _moves(cur, cap)
        ms.sort(key=lambda m: (m[2], m[3]))
        for a, b, _, cnt in ms:
            nt = list(cur)
            c = nt[a][-1]
            nt[a] = nt[a][:-cnt]
            nt[b] = nt[b] + (c,) * cnt
            nt = tuple(nt)
            key = tuple(sorted(nt))
            if key in seen:
                continue
            seen.add(key)
            stack.append((nt, first if first else (a, b)))
    return None


def _move_quality(tubes, cap, a, b, cnt):
    """How good a pour looks to a person, without looking ahead: finish a
    flask, move a whole run rather than part of one, empty a flask, build on
    a flask that is already one colour. Leaving a leftover of the colour behind
    when it could all go is the thing to avoid."""
    A, B = tubes[a], tubes[b]
    c, run = _top_run(A)
    score = 0
    same = bool(B)
    if same:
        if len(B) + cnt == cap and all(x == c for x in B):
            score += 100                              # a flask is finished
        if all(x == c for x in B):
            score += 15                               # onto a flask that is already pure
    else:
        score -= 20                                   # into an empty flask: only when it helps
    score += 30 if cnt == run else -30                # the whole run, not a part of it
    if len(A) == cnt:
        score += 25                                   # the flask is emptied
    elif len(A) > cnt:
        under = A[len(A) - cnt - 1]
        # what is uncovered is the same as another flask's top, or is the same
        # colour as the rest of the flask: it can go on next
        if under == c:
            score -= 10
        elif any(t and t[-1] == under for i, t in enumerate(tubes) if i != a and i != b and len(t) < cap):
            score += 12
    if same and all(x == c for x in A) and not all(x == c for x in B):
        score -= 25                                   # do not bury a pure flask under a mixed one
    score -= len(B) * 0.01                            # the smaller the better, all else equal
    return score


def _state_key(tubes):
    return tuple(sorted(tuple(t) for t in tubes))


def first_move(tubes, cap, limit=20000, avoid=None):
    """The best pour to make from where the player is.

    Every legal pour is looked at twice. The solver says how many pours remain
    after it (a pour that leaves a level which cannot be finished is out), and
    only the pours that leave about the fewest are kept; among those the one
    that looks best to a person wins (see _move_quality): finish a flask, move a
    whole colour rather than part of it, and so on. `avoid` holds the positions
    hints have already led to on this level, so that hints never go round in a
    circle."""
    start = tuple(tuple(t) for t in tubes)
    if _solved(start, cap):
        return None
    avoid = avoid if avoid is not None else set()
    cands = []
    for a, b, _, cnt in _moves(start, cap):
        nt = list(start)
        c = nt[a][-1]
        nt[a] = nt[a][:-cnt]
        nt[b] = nt[b] + (c,) * cnt
        cands.append((_move_quality(start, cap, a, b, cnt), a, b, tuple(nt)))
    if not cands:
        return _parking_move(start, cap, avoid)
    fresh = [x for x in cands if _state_key(x[3]) not in avoid]
    pool = sorted(fresh or cands, key=lambda x: -x[0])[:14]
    rated = []
    for q, a, b, nt in pool[:8]:
        if _solved(nt, cap):
            return (a, b, _state_key(nt))
        d = _solve(nt, cap, 6000)
        if d is not None:
            rated.append((d, q, a, b, nt))
    if rated:
        best = min(r[0] for r in rated)
        near = [r for r in rated if r[0] <= best + 2]
        d, q, a, b, nt = max(near, key=lambda r: r[1])
        return (a, b, _state_key(nt))
    # The solver could not vouch for any of them in time: the best-looking
    # ordinary pour is still far better than parking a dose.
    q, a, b, nt = pool[0]
    return (a, b, _state_key(nt))


def _parking_move(start, cap, avoid):
    """When no ordinary pour leads anywhere, a dose has to be parked on a
    different colour. Choose the parking that gives the most ordinary pours
    afterwards, so the next hint is an ordinary one again."""
    best = None
    for a, ta in enumerate(start):
        if not ta:
            continue
        c, k = _top_run(ta)
        for b, tb in enumerate(start):
            if a == b or len(tb) >= cap or not tb or tb[-1] == c:
                continue
            cnt = min(k, cap - len(tb))
            nt = list(start)
            nt[a] = ta[:-cnt]
            nt[b] = tb + (c,) * cnt
            nt = tuple(nt)
            key = _state_key(nt)
            if key in avoid:
                continue
            score = len(_moves(nt, cap)) * 10 + (5 if cnt == k else 0)
            if best is None or score > best[0]:
                best = (score, a, b, key)
    return None if best is None else (best[1], best[2], best[3])


def count_layers(tubes) -> int:
    """Colour layers in a deal: neighbouring doses of one colour are one layer."""
    n = 0
    for t in tubes:
        if t:
            n += 1 + sum(1 for i in range(1, len(t)) if t[i] != t[i - 1])
    return n


def make_level(seed: str, level: int) -> dict:
    n, cap, empty = params(level)
    tubes = None
    length = None
    for attempt in range(8 if cap == 4 else 3):
        rng = random.Random(f"{seed}:{level}:{attempt}")
        units = [c for c in range(n) for _ in range(cap)]
        rng.shuffle(units)
        cand = [units[i * cap:(i + 1) * cap] for i in range(n)] + [[] for _ in range(empty)]
        if n > 2 and any(len(set(t)) == 1 for t in cand[:n]):
            continue                                   # never deal a finished flask
        length = _solve(cand, cap, 20000 if cap == 4 else 4000)
        if length:
            tubes = cand
            break
    if tubes is None:
        # The search gave up on a very large level. With two spare flasks a
        # random deal is all but always solvable, and a player can always
        # undo or restart, so the last deal stands with an estimated par.
        tubes = cand
        length = round(n * cap * 0.8)
    # Par is the number of colour layers in the deal, counting the bottom one of
    # every flask: a pour moves one top layer, so that many pours is about what
    # a sensible player needs, with room to spare for the times a bottom layer
    # has to move or a dose is parked. It follows from the deal alone, the same
    # for every player and every level, so it can be worked out and checked by
    # anyone.
    par = max(1, count_layers(tubes))
    return {"level": level, "n": n, "cap": cap, "tubes": tubes, "par": par}


def level_score(n: int, cap: int, par: int, moves: int, elapsed: float):
    """What clearing a level is worth, in three parts.

    Doses: every dose is worth DOSE_POINTS, so a flask is worth its doses
    (4 doses 40, 8 doses 80) and everybody who clears a level gets the same
    base, which is by far the biggest part.
    Speed: one point for every second left of the time the level allows
    (as many seconds a move as there are doses in a flask, for the moves of
    par), so a quick player always gets a little more.
    Par: like golf, paid in flasks. Finishing in par moves earns the price of
    one flask, one move under it two flasks, two or more under it three flasks
    (the most); being over par costs nothing."""
    flask = cap * DOSE_POINTS
    base = n * flask
    speed = int(max(0.0, level_allow(par, cap) - elapsed))
    diff = par - moves
    under = flask * min(3, 1 + diff) if diff >= 0 else 0
    return base, speed, under


def level_allow(par: int, cap: int) -> float:
    """Seconds the level allows: as many seconds a move as there are doses in a
    flask (4 doses 4 seconds, 8 doses 8 seconds), for the moves of par."""
    return float(par * cap)


def stars_for(moves: int, par: int) -> int:
    if moves <= par:
        return 3
    if moves <= par * 1.5:
        return 2
    return 1


def _clone(tubes):
    return [list(t) for t in tubes]


def _is_solved(tubes, cap):
    return all(not t or (len(t) == cap and len(set(t)) == 1) for t in tubes)


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.over = False
        self.multi = False
        self.target = 0
        self.seed = ""
        self.order = []
        self.p = {}                 # pid -> player state
        self.cache = {}             # level -> dealt level
        self.finish_no = 0
        self._gone_token = 0

    # ── levels ───────────────────────────────────────────────────────────────

    async def _level(self, level: int) -> dict:
        got = self.cache.get(level)
        if got is None:
            got = await asyncio.to_thread(make_level, self.seed, level)
            self.cache[level] = got
        return got

    def _prefetch(self, level: int):
        if level > self.target:
            return
        if level in self.cache:
            return

        async def run():
            try:
                await self._level(level)
            except Exception as e:
                print(f"[flasksort] prefetch failed: {e}")
        asyncio.create_task(run())

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        ids = [p["id"] for p in self.ctx.all_players()]
        self.multi = len(ids) > 1
        try:
            t = int(settings.get("levels"))
        except (TypeError, ValueError):
            t = 10
        self.target = min(TARGETS, key=lambda c: abs(c - t)) if self.multi else MAX_LEVEL
        self.seed = f"{self.ctx.room_id}:{random.random()}"
        self.order = ids
        saved = self.ctx.saved_state
        resumed = False
        if saved and not self.multi:
            resumed = await self._resume(ids[0], saved)
        if not resumed:
            for pid in ids:
                self.p[pid] = self._fresh(1)
        self.started = True
        for pid in ids:
            st = self.p[pid]
            lv = await self._level(st["level"])
            if not st["start"]:
                st["start"] = _clone(lv["tubes"])
                st["tubes"] = _clone(lv["tubes"])
                st["par"] = lv["par"]
            st["t0"] = time.time()
            self._prefetch(st["level"] + 1)
        for pid in ids:
            await self.ctx.send(pid, self._state_msg(pid))

    @staticmethod
    def _fresh(level):
        return {
            "level": level, "tubes": None, "start": None, "par": 1, "hist": [],
            "level_penalties": 0, "stage_eligible": True, "moves": 0, "points": 0, "cleared": 0, "perfect": 0,
            "moves_total": 0, "undos": 0, "restarts": 0, "maxn": 0, "hints": 0,
            "done": False, "quit": False, "rank": 0, "left": False, "at": 0.0, "seq": 0, "t0": 0.0,
        }

    async def _resume(self, pid, saved) -> bool:
        try:
            self.seed = str(saved["seed"])
            level = int(saved["level"])
            st = self._fresh(max(1, level))
            lv = await self._level(st["level"])
            start = [[int(c) for c in t] for t in saved["start"]]
            tubes = [[int(c) for c in t] for t in saved["tubes"]]
            if start != lv["tubes"]:
                return False
            n, cap, _ = params(st["level"])
            flat = sorted(c for t in tubes for c in t)
            if flat != sorted(c for c in range(n) for _ in range(cap)) or any(len(t) > cap for t in tubes):
                return False
            st["start"], st["tubes"], st["par"] = start, tubes, lv["par"]
            for k in ("moves", "points", "cleared", "perfect", "moves_total", "undos", "restarts", "maxn", "hints"):
                st[k] = max(0, int(saved.get(k, 0)))
            st["level_penalties"] = max(0, int(saved.get("level_penalties", 0)))
            st["stage_eligible"] = bool(saved.get("stage_eligible", not st["hints"]))
            st["hist"] = [[int(x) for x in h] for h in saved.get("hist", [])][-200:]
            self.p[pid] = st
            return True
        except Exception as e:
            print(f"[flasksort] bad save: {e}")
            return False

    def snapshot(self):
        """Save & exit (framework-driven, solo only): the game as it stands.
        Completed stage records are independent of the unfinished run."""
        if not self.started or self.over or self.multi:
            return None
        st = self.p.get(self.ctx.host_id)
        if not st or st["tubes"] is None:
            return None
        out = {k: st[k] for k in ("level", "moves", "points", "cleared", "perfect", "moves_total", "undos", "restarts", "maxn", "hints")}
        out.update(level_penalties=st["level_penalties"], stage_eligible=st["stage_eligible"], seed=self.seed, start=st["start"], tubes=st["tubes"], hist=st["hist"])
        return out

    async def on_join(self, player):
        pid = player["id"]
        if not self.started:
            return
        st = self.p.get(pid)
        if st is None:
            return                                  # nobody joins a game that has begun
        st["left"] = False
        self._gone_token += 1
        if not st["t0"] and not st["done"]:
            st["t0"] = time.time()          # coming back is going on
        await self.ctx.send(pid, self._state_msg(pid))

    async def on_leave(self, player):
        st = self.p.get(player["id"])
        if not st or self.over or not self.multi:
            return
        st["left"] = True
        self._gone_token += 1
        tok = self._gone_token
        self.ctx.schedule(GONE_GRACE, lambda: self._check_gone(tok))

    async def _check_gone(self, tok):
        if self.over or tok != self._gone_token:
            return
        if all(s["done"] or s["quit"] or s["left"] for s in self.p.values()):
            await self._finish()

    # ── messages ─────────────────────────────────────────────────────────────

    async def on_message(self, player, msg):
        if not self.started or self.over:
            return
        pid = player["id"]
        st = self.p.get(pid)
        if st is None or st["done"] or st["quit"]:
            return
        kind = msg.get("type")
        try:
            st["seq"] = int(msg.get("seq", st["seq"]))
        except (TypeError, ValueError):
            pass
        if kind == "fs_pour":
            await self._pour(pid, st, msg)
        elif kind == "fs_undo":
            self._undo(st)               # the browser did the same; it is only told when out of step
            st.pop("hint_seen", None)
        elif kind == "fs_restart":
            st["tubes"] = _clone(st["start"])
            st["hist"] = []
            st["restarts"] += 1
            st.pop("hint_seen", None)
        elif kind == "fs_ready":
            # The player has seen the result and chosen to go on: only now does
            # the next level's clock start.
            if not st["t0"]:
                st["t0"] = time.time()
        elif kind == "fs_hint":
            await self._hint(pid, st)
        elif kind == "fs_quit":
            await self._quit(pid, st)

    async def _hint(self, pid, st):
        """A hint is the next move of a solution, and it is paid for with the
        points of one filled flask, even when that takes the points below zero."""
        n, cap, _ = params(st["level"])
        seen = st.setdefault("hint_seen", set())
        move = await asyncio.to_thread(first_move, _clone(st["tubes"]), cap, 20000 if cap == 4 else 8000, seen)
        if move is not None:
            seen.add(_state_key(st["tubes"]))
            seen.add(move[2])
        if move is None:
            await self.ctx.send(pid, {"type": "fs_hint_res", "a": -1, "b": -1, "cost": 0,
                                      "points": st["points"], "seq": st["seq"]})
            return
        # The price is the same whatever the player has: the points can go below
        # zero, so that a hint is never free.
        paid = cap * DOSE_POINTS
        st["level_penalties"] += paid
        st["points"] -= paid
        st["hints"] += 1
        await self.ctx.send(pid, {"type": "fs_hint_res", "a": move[0], "b": move[1], "cost": paid,
                                  "points": st["points"], "seq": st["seq"]})
        await self._progress(pid)

    async def _pour(self, pid, st, msg):
        tubes = st["tubes"]
        n, cap, _ = params(st["level"])
        try:
            a, b = int(msg.get("a")), int(msg.get("b"))
        except (TypeError, ValueError):
            return
        # Any dose may go on any other, as long as there is room: a dose can be
        # parked on a different colour to free a flask, so a level is never stuck.
        ok = (0 <= a < len(tubes) and 0 <= b < len(tubes) and a != b and tubes[a] and len(tubes[b]) < cap)
        if ok:
            c, k = _top_run(tubes[a])
        if not ok:
            await self.ctx.send(pid, self._level_msg(st))       # the client was out of step
            return
        if not st["t0"]:
            st["t0"] = time.time()
        cnt = min(k, cap - len(tubes[b]))
        del tubes[a][-cnt:]
        tubes[b].extend([c] * cnt)
        st["hist"].append([a, b, cnt, c])
        del st["hist"][:-200]
        st["moves"] += 1
        st["moves_total"] += 1
        if _is_solved(tubes, cap):
            await self._cleared(pid, st)

    @staticmethod
    def _undo(st):
        if not st["hist"]:
            return
        a, b, cnt, c = st["hist"].pop()
        tubes = st["tubes"]
        del tubes[b][-cnt:]
        tubes[a].extend([c] * cnt)
        st["undos"] += 1

    async def _cleared(self, pid, st):
        level = st["level"]
        n, cap, _ = params(level)
        stars = stars_for(st["moves"], st["par"])
        elapsed = time.time() - st["t0"] if st["t0"] else 0.0
        base, speed, under = level_score(n, cap, st["par"], st["moves"], elapsed)
        gained = base + speed + under
        stage_penalty = st["level_penalties"]
        stage_score = gained - stage_penalty
        stage_best = None
        if st["stage_eligible"] and hasattr(self.ctx, "record_stage"):
            stage_best = await self.ctx.record_stage(pid, f"v1:level:{level}", stage_score)
        st["points"] += gained
        st["cleared"] += 1
        st["perfect"] += 1 if stars == 3 else 0
        st["maxn"] = max(st["maxn"], n)
        nxt = None
        if level >= self.target:
            st["done"] = True
            st["at"] = time.time()
        else:
            st["level"] = level + 1
            lv = await self._level(st["level"])
            st.update(start=_clone(lv["tubes"]), tubes=_clone(lv["tubes"]), par=lv["par"], hist=[], moves=0, t0=0.0, level_penalties=0, stage_eligible=True)
            st.pop("hint_seen", None)
            self._prefetch(st["level"] + 1)
            nxt = self._level_msg(st)
        await self.ctx.send(pid, {
            "type": "fs_cleared", "level_penalty": stage_penalty, "level_score": stage_score, "stage_records": stage_best, "level": level, "gained": gained, "stars": stars,
            "base": base, "speed": speed, "under": under,
            "points": st["points"], "done": st["done"], "rank": st["rank"], "next": nxt,
        })
        await self._progress(pid)
        if st["done"]:
            if self.multi:
                await self._maybe_over()
            else:
                await self._finish()          # the last level of the game is cleared

    async def _quit(self, pid, st):
        st["quit"] = True
        await self._progress(pid)
        if not self.multi:
            await self._finish()
        else:
            await self._maybe_over()

    async def _maybe_over(self):
        if all(s["done"] or s["quit"] for s in self.p.values()):
            await self._finish()
        elif all(s["done"] or s["quit"] or s["left"] for s in self.p.values()):
            self._gone_token += 1
            tok = self._gone_token
            self.ctx.schedule(GONE_GRACE, lambda: self._check_gone(tok))

    async def _progress(self, pid):
        await self.ctx.broadcast({"type": "fs_progress", "pid": pid, **self._brief(pid)})

    def _brief(self, pid):
        st = self.p[pid]
        return {"level": st["level"], "points": st["points"], "cleared": st["cleared"],
                "done": st["done"], "quit": st["quit"], "rank": st["rank"]}

    # ── the end ──────────────────────────────────────────────────────────────

    def _results(self):
        rows = []
        for pid in self.order:
            st = self.p[pid]
            reached = st["level"]
            rows.append({
                "player_id": pid, "level": reached, "cleared": st["cleared"],
                "points": st["points"], "perfect": st["perfect"], "moves": st["moves_total"],
                "undos": st["undos"], "done": st["done"], "colors": st["maxn"], "at": st["at"], "hints": st["hints"],
            })
        # The most points win, however the others got there: points are earned
        # by every flask filled, with a bonus for speed and one for par. A tie is
        # settled by who finished first, then by the level reached.
        rows.sort(key=lambda r: (-r["points"], r["at"] if r["done"] else float("inf"), -r["level"]))
        for i, r in enumerate(rows, 1):
            r["rank"] = i
        return rows

    async def _finish(self):
        if self.over:
            return
        self.over = True
        rows = self._results()
        names = {p["id"]: p for p in self.ctx.all_players()}
        for r in rows:
            r["display_name"] = (names.get(r["player_id"]) or {}).get("display_name", "")
        await self.ctx.broadcast({"type": "fs_over", "results": rows, "multi": self.multi, "target": self.target})
        records = []
        for r in rows:
            records.append({
                "player_id": r["player_id"],
                "score": r["points"],
                "rank": r["rank"],
                "is_winner": self.multi and r["rank"] == 1 and r["points"] > 0,
                "stats": {
                    "level": r["level"], "cleared": r["cleared"], "perfect": r["perfect"],
                    "moves": r["moves"], "undos": r["undos"], "colors": r["colors"], "hints": r["hints"],
                },
            })
        await self.ctx.finish(records, metadata={"levels": self.target or None, "reached": rows[0]["level"] if rows else 0})

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _level_msg(self, st):
        n, cap, _ = params(st["level"])
        return {
            "type": "fs_level", "level_penalties": st["level_penalties"], "level": st["level"], "n": n, "cap": cap,
            "tubes": st["tubes"], "start": st["start"], "par": st["par"], "moves": st["moves"],
            "points": st["points"], "hist": st["hist"], "seq": st["seq"],
            "allow": level_allow(st["par"], cap), "elapsed": max(0.0, time.time() - st["t0"]) if st["t0"] else 0.0,
            "speed_max": round(level_allow(st["par"], cap)),
        }

    def _state_msg(self, pid):
        st = self.p[pid]
        return {
            "type": "fs_state",
            "multi": self.multi, "target": self.target,
            "order": self.order,
            "progress": {p: self._brief(p) for p in self.order},
            "over": self.over,
            "you": self._level_msg(st),
            "done": st["done"], "rank": st["rank"],
            "urls": {
                "three": asset("/apps/flasksort/three.module.min.js"),
                "scene": asset("/apps/flasksort/flasks3d.js"),
            },
        }
