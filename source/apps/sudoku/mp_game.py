"""
Sudoku — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (any app with an
mp_game.py exposing `Game(ctx)`). The framework owns rooms, sockets, identity,
reconnects and writing the finished session; everything below is this game's
rules.

The server owns the puzzle and its solution. It deals one puzzle per room from
a seed (every player in a room gets the very same one), checks every number a
player enters against the solution and decides when a puzzle is solved, so
nobody can send a made-up result. There is no time limit: the clock only counts
the time for the statistics.

Alone a game is one puzzle of the chosen difficulty. With others everybody
solves the same puzzle at their own pace and, when all are done, the most points
win: guessing is dear (a mistake costs twice a cell) and the clock costs a little
too, so neither speed nor luck decides it alone. A player who has finished can
watch the others. A player who leaves after finishing is already recorded, with
the clock stopped, and counts when the game ends.

  client → server
    sd_set     {i, v}       put number v (1-9) in cell i; v = 0 clears a wrong number
    sd_hint    {sel}        fill one cell; the price grows with the cells filled so far
    sd_quit                 stop playing (with others only)

  server → client
    sd_state   {...}        the whole game, for a start or a reconnect
    sd_cell    {i, v, ok}   the answer to sd_set, with the points as they stand
    sd_sync    {...}        the player's board as the server has it (the client was out of step)
    sd_hint_res {i, v, ...} the cell that was filled, and what it cost
    sd_progress {pid, ...}  where somebody is, for the scoreboard
    sd_done    {...}        the player solved the puzzle: place, points and time
    sd_peer    {pid, ...}   somebody's board, sent only to players who have finished
    sd_over    {results}    everybody is done
"""

import asyncio
import random
import time

DIFFS = ("easy", "medium", "hard", "expert", "master")
# Points one correct cell is worth, by difficulty.
CELL_POINTS = {"easy": 10, "medium": 12, "hard": 14, "expert": 16, "master": 18}
# A hint costs two cells' points plus this many for every cell already filled
# in beyond the clues, so the further the game has gone, the dearer it is.
HINT_STEP = {"easy": 1, "medium": 2, "hard": 3, "expert": 4, "master": 5}
# Clues left in the puzzle (the generator stops at or just above this), and
# whether the puzzle must be solvable by singles alone (and which kind).
TARGET = {"easy": 40, "medium": 34, "hard": 30, "expert": 27, "master": 23}
# Seconds that cost one point: a harder puzzle takes longer, so the clock is gentler on it.
TIME_STEP = {"easy": 10, "medium": 15, "hard": 20, "expert": 25, "master": 30}
GONE_GRACE = 20.0            # seconds everybody left may stay away before the game ends

ALL = 0x1FF
ROW = [i // 9 for i in range(81)]
COL = [i % 9 for i in range(81)]
BOX = [(i // 27) * 3 + (i % 9) // 3 for i in range(81)]
UNITS = ([[r * 9 + c for c in range(9)] for r in range(9)]
         + [[r * 9 + c for r in range(9)] for c in range(9)]
         + [[(b // 3) * 27 + (b % 3) * 3 + (k // 3) * 9 + k % 3 for k in range(9)] for b in range(9)])
PEERS = [sorted({j for u in UNITS if i in u for j in u} - {i}) for i in range(81)]


# ── Solver: proves a puzzle has one solution and grades how hard it is ──────

def _masks(g):
    rows, cols, boxes = [0] * 9, [0] * 9, [0] * 9
    for i, v in enumerate(g):
        if v:
            b = 1 << (v - 1)
            rows[ROW[i]] |= b
            cols[COL[i]] |= b
            boxes[BOX[i]] |= b
    return rows, cols, boxes


def count_solutions(grid, limit=2):
    """How many solutions the grid has, counting no further than `limit`."""
    g = list(grid)
    rows, cols, boxes = _masks(g)
    found = 0

    def go():
        nonlocal found
        best, best_c, best_n = -1, 0, 10
        for i in range(81):
            if g[i]:
                continue
            c = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]])
            n = bin(c).count("1")
            if n < best_n:
                best, best_c, best_n = i, c, n
                if n <= 1:
                    break
        if best < 0:
            found += 1
            return
        if best_n == 0:
            return
        r, c_, b = ROW[best], COL[best], BOX[best]
        while best_c:
            bit = best_c & -best_c
            best_c ^= bit
            g[best] = bit.bit_length()
            rows[r] |= bit; cols[c_] |= bit; boxes[b] |= bit
            go()
            rows[r] ^= bit; cols[c_] ^= bit; boxes[b] ^= bit
            g[best] = 0
            if found >= limit:
                return

    go()
    return found


def solve_singles(grid, hidden=True):
    """Whether the grid can be finished by singles alone: a cell with one
    possible number (naked), and with `hidden` also a number with one possible
    cell in a row, column or box."""
    g = list(grid)
    rows, cols, boxes = _masks(g)

    def put(i, v):
        b = 1 << (v - 1)
        g[i] = v
        rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b

    while True:
        moved = False
        empties = [i for i in range(81) if not g[i]]
        if not empties:
            return True
        for i in empties:
            c = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]])
            if c == 0:
                return False
            if c & (c - 1) == 0:
                put(i, c.bit_length())
                moved = True
        if moved:
            continue
        if not hidden:
            return False
        cand = {i: ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) for i in empties if not g[i]}
        for u in UNITS:
            for d in range(9):
                bit = 1 << d
                spots = [i for i in u if i in cand and cand[i] & bit and not g[i]]
                if len(spots) == 1 and not any(g[i] == d + 1 for i in u):
                    put(spots[0], d + 1)
                    cand.pop(spots[0], None)
                    moved = True
        if not moved:
            return False


def guess_cost(grid, limit=400):
    """How many guesses a solver needs when it uses singles wherever it can and
    branches on the cell with the fewest numbers otherwise: 0 for a puzzle
    that singles finish, more the deeper the puzzle hides its way."""
    cnt = 0

    def prop(g):
        rows, cols, boxes = _masks(g)
        while True:
            moved = False
            for i in range(81):
                if g[i]:
                    continue
                c = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]])
                if c == 0:
                    return False
                if c & (c - 1) == 0:
                    v = c.bit_length(); b = 1 << (v - 1)
                    g[i] = v
                    rows[ROW[i]] |= b; cols[COL[i]] |= b; boxes[BOX[i]] |= b
                    moved = True
            if moved:
                continue
            for u in UNITS:
                for d in range(9):
                    bit = 1 << d
                    if any(g[i] == d + 1 for i in u):
                        continue
                    spots = [i for i in u if not g[i] and ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & bit]
                    if not spots:
                        return False
                    if len(spots) == 1:
                        i = spots[0]
                        g[i] = d + 1
                        rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit
                        moved = True
            if not moved:
                return True

    def go(g):
        nonlocal cnt
        if not prop(g):
            return False
        if all(g):
            return True
        rows, cols, boxes = _masks(g)
        free = [i for i in range(81) if not g[i]]
        best = min(free, key=lambda i: bin(ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]])).count("1"))
        c = ALL & ~(rows[ROW[best]] | cols[COL[best]] | boxes[BOX[best]])
        while c and cnt < limit:
            bit = c & -c
            c ^= bit
            cnt += 1
            h = list(g)
            h[best] = bit.bit_length()
            if go(h):
                g[:] = h
                return True
        return False

    go(list(grid))
    return cnt


def _full_grid(rng):
    """A complete valid grid, from the classic pattern with its rows, columns,
    bands, stacks and digits shuffled."""
    def shuffled():
        bands = list(range(3)); rng.shuffle(bands)
        out = []
        for b in bands:
            inner = list(range(3)); rng.shuffle(inner)
            out += [b * 3 + k for k in inner]
        return out
    rr, cc = shuffled(), shuffled()
    digits = list(range(1, 10)); rng.shuffle(digits)
    return [digits[(3 * (r % 3) + r // 3 + c) % 9] for r in rr for c in cc]


# Guesses a solver needs at least, for the two hardest levels: the puzzle must
# not give itself away to singles alone.
NEED_GUESSES = {"expert": 1, "master": 2}
BUDGET = 4.0                 # seconds the generator may spend looking for a hard enough puzzle


def make_puzzle(seed: str, diff: str) -> dict:
    """The puzzle of a room: clues, solution and how many clues are left. A
    function of (seed, difficulty) alone, so a saved game can be dealt again.
    Clues are taken away in pairs, turned half a revolution around the centre
    so the picture is balanced, as long as the solution stays the only one (and,
    for the easier levels, the puzzle stays solvable by singles). The two
    hardest levels then take single clues until the target is reached, and are
    only accepted when a solver has to guess."""
    target = TARGET[diff]
    logic = diff in ("easy", "medium", "hard")
    need = NEED_GUESSES.get(diff, 0)
    started = time.time()
    best = None
    for attempt in range(40):
        rng = random.Random(f"{seed}:{diff}:{attempt}")
        sol = _full_grid(rng)
        g = list(sol)
        cells = list(range(41))
        rng.shuffle(cells)
        for i in cells:
            j = 80 - i
            if sum(1 for v in g if v) <= target:
                break
            keep_i, keep_j = g[i], g[j]
            g[i] = g[j] = 0
            if logic:
                ok = solve_singles(g, hidden=(diff != "easy"))
            else:
                ok = count_solutions(g, 2) == 1
            if not ok:
                g[i], g[j] = keep_i, keep_j
        if not logic:
            rest = [i for i in range(81) if g[i]]
            rng.shuffle(rest)
            for i in rest:
                if sum(1 for v in g if v) <= target:
                    break
                keep = g[i]
                g[i] = 0
                if count_solutions(g, 2) != 1:
                    g[i] = keep
        left = sum(1 for v in g if v)
        cost = guess_cost(g) if need else 0
        score = (min(cost, need), -left)
        if best is None or score > best[0]:
            best = (score, left, g, sol)
        if cost >= need and left <= target + (2 if logic else 1):
            break
        if time.time() - started > BUDGET:
            break
    _, left, g, sol = best
    return {"puzzle": "".join(map(str, g)), "solution": "".join(map(str, sol)), "clues": left}


# ── The game ─────────────────────────────────────────────────────────────────

def pick_hint(solution, cells, grid, sel, rng):
    """The cell to fill for a hint: the one the player has selected when it is
    open (empty, or holding a wrong number), otherwise the open cell with the
    fewest possible numbers, which is the one a person would do next."""
    open_ = [i for i in range(81) if cells[i] in ".w"]
    if not open_:
        return None
    if sel in open_:
        return sel
    g = [int(grid[i]) if cells[i] in "gch" else 0 for i in range(81)]
    rows, cols, boxes = _masks(g)
    best = []
    best_n = 10
    for i in open_:
        n = bin(ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]])).count("1")
        if n < best_n:
            best, best_n = [i], n
        elif n == best_n:
            best.append(i)
    return rng.choice(best)


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.over = False
        self.multi = False
        self.diff = "easy"
        self.seed = ""
        self.puzzle = ""
        self.solution = ""
        self.order = []
        self.p = {}                 # pid -> player state
        self.finish_no = 0
        self._gone_token = 0

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        ids = [p["id"] for p in self.ctx.all_players()]
        self.multi = len(ids) > 1
        d = (settings or {}).get("difficulty")
        self.diff = d if d in DIFFS else "easy"
        self.seed = f"{self.ctx.room_id}:{random.random()}"
        self.order = ids
        saved = self.ctx.saved_state
        resumed = False
        if saved and not self.multi:
            resumed = await self._resume(ids[0], saved)
        if not resumed:
            await self._deal()
            for pid in ids:
                self.p[pid] = self._fresh()
        self.started = True
        now = time.time()
        for pid in ids:
            st = self.p[pid]
            st["t0"] = now - st["carried"]
        for pid in ids:
            await self.ctx.send(pid, self._state_msg(pid))

    async def _deal(self):
        got = await asyncio.to_thread(make_puzzle, self.seed, self.diff)
        self.puzzle, self.solution = got["puzzle"], got["solution"]

    def _fresh(self):
        return {
            "cells": "".join("g" if c != "0" else "." for c in self.puzzle),
            "grid": list(self.puzzle),
            "points": 0, "mistakes": 0, "hints": 0, "carried": 0.0, "t0": 0.0,
            "done": False, "quit": False, "left": False, "rank": 0, "at": 0.0, "time": 0.0,
            "clean": 0, "timecost": 0, "seq": 0,
        }

    async def _resume(self, pid, saved) -> bool:
        try:
            self.seed = str(saved["seed"])
            self.diff = saved["difficulty"] if saved["difficulty"] in DIFFS else "easy"
            await self._deal()
            if saved["puzzle"] != self.puzzle:
                return False
            st = self._fresh()
            cells = str(saved["cells"])
            grid = [str(c) for c in saved["grid"]]
            if len(cells) != 81 or len(grid) != 81 or any(c not in "g.chw" for c in cells):
                return False
            for i in range(81):
                if (cells[i] == "g") != (self.puzzle[i] != "0"):
                    return False
                if cells[i] in "chw" and not (grid[i].isdigit() and grid[i] != "0"):
                    return False
                if cells[i] in "ch" and grid[i] != self.solution[i]:
                    return False
            st["cells"], st["grid"] = cells, grid
            for k in ("points", "mistakes", "hints"):
                st[k] = int(saved.get(k, 0))
            st["carried"] = max(0.0, float(saved.get("elapsed", 0)))
            self.p[pid] = st
            return True
        except Exception as e:
            print(f"[sudoku] bad save: {e}")
            return False

    def snapshot(self):
        """Save & exit (framework-driven, solo only): the game as it stands.
        Nothing is recorded in Game Hub; that happens when the game ends."""
        if not self.started or self.over or self.multi:
            return None
        st = self.p.get(self.ctx.host_id)
        if not st:
            return None
        return {"seed": self.seed, "difficulty": self.diff, "puzzle": self.puzzle,
                "cells": st["cells"], "grid": st["grid"], "points": st["points"],
                "mistakes": st["mistakes"], "hints": st["hints"], "elapsed": self._elapsed(st)}

    async def on_join(self, player):
        pid = player["id"]
        if not self.started:
            return
        st = self.p.get(pid)
        if st is None:
            return                                  # nobody joins a game that has begun
        st["left"] = False
        self._gone_token += 1
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
        try:
            st["seq"] = int(msg.get("seq", st["seq"]))
        except (TypeError, ValueError):
            pass
        kind = msg.get("type")
        if kind == "sd_set":
            await self._set(pid, st, msg)
        elif kind == "sd_hint":
            await self._hint(pid, st, msg)
        elif kind == "sd_quit" and self.multi:
            await self._quit(pid, st)

    @staticmethod
    def _elapsed(st):
        if st["done"]:
            return st["time"]
        return max(0.0, time.time() - st["t0"]) if st["t0"] else st["carried"]

    def _cell_points(self):
        return CELL_POINTS[self.diff]

    async def _set(self, pid, st, msg):
        try:
            i, v = int(msg.get("i")), int(msg.get("v"))
        except (TypeError, ValueError):
            return
        if not (0 <= i < 81 and 0 <= v <= 9):
            return
        kind = st["cells"][i]
        # A given number, or one the server has accepted, is never changed.
        if kind in "gch" or (v == 0 and kind == "."):
            await self.ctx.send(pid, self._sync_msg(st))
            return
        if v == 0:
            st["grid"][i] = "0"
            st["cells"] = st["cells"][:i] + "." + st["cells"][i + 1:]
            await self.ctx.send(pid, {"type": "sd_cell", "i": i, "v": 0, "ok": True, "points": st["points"],
                                      "mistakes": st["mistakes"], "seq": st["seq"]})
            await self._peers(pid)
            return
        if kind == "w" and st["grid"][i] == str(v):
            return
        ok = self.solution[i] == str(v)
        st["grid"][i] = str(v)
        if ok:
            st["points"] += self._cell_points()
            st["cells"] = st["cells"][:i] + "c" + st["cells"][i + 1:]
        else:
            st["mistakes"] += 1
            st["points"] -= 2 * self._cell_points()
            st["cells"] = st["cells"][:i] + "w" + st["cells"][i + 1:]
        await self.ctx.send(pid, {"type": "sd_cell", "i": i, "v": v, "ok": ok, "points": st["points"],
                                  "mistakes": st["mistakes"], "seq": st["seq"]})
        await self._after(pid, st)

    def _hint_cost(self, st):
        """Cells filled beyond the clues, by the player or by earlier hints."""
        filled = sum(1 for c in st["cells"] if c in "ch")
        return 2 * self._cell_points() + HINT_STEP[self.diff] * filled

    async def _hint(self, pid, st, msg):
        """A hint fills one cell and is paid for with the points of two cells
        plus HINT_STEP for every cell the player has filled so far, even when
        that takes the points below zero. The cell earns nothing."""
        try:
            sel = int(msg.get("sel", -1))
        except (TypeError, ValueError):
            sel = -1
        rng = random.Random(f"{self.seed}:{pid}:{st['hints']}")
        i = pick_hint(self.solution, st["cells"], st["grid"], sel, rng)
        if i is None:
            await self.ctx.send(pid, {"type": "sd_hint_res", "i": -1, "v": 0, "cost": 0,
                                      "points": st["points"], "seq": st["seq"]})
            return
        cost = self._hint_cost(st)
        st["points"] -= cost
        st["hints"] += 1
        st["grid"][i] = self.solution[i]
        st["cells"] = st["cells"][:i] + "h" + st["cells"][i + 1:]
        await self.ctx.send(pid, {"type": "sd_hint_res", "i": i, "v": int(self.solution[i]), "cost": cost,
                                  "points": st["points"], "mistakes": st["mistakes"], "seq": st["seq"]})
        await self._after(pid, st)

    async def _after(self, pid, st):
        if all(c in "gch" for c in st["cells"]):
            await self._solved(pid, st)
        else:
            await self._progress(pid)
            await self._peers(pid)

    def _time_cost(self, seconds):
        """The clock costs a point every so many seconds (more on harder
        levels), so time matters a little without ever being a limit."""
        return int(seconds // TIME_STEP[self.diff])

    async def _solved(self, pid, st):
        """The puzzle is solved: the finishing order decides the places."""
        V = self._cell_points()
        st["done"] = True
        st["at"] = time.time()
        st["time"] = max(0.0, st["at"] - st["t0"])
        st["clean"] = 10 * V if st["mistakes"] == 0 and st["hints"] == 0 else 0
        st["timecost"] = self._time_cost(st["time"])
        st["points"] += st["clean"] - st["timecost"]
        self.finish_no += 1
        st["rank"] = self.finish_no
        await self.ctx.send(pid, {
            "type": "sd_done", "rank": st["rank"], "points": st["points"], "time": st["time"],
            "timecost": st["timecost"], "clean": st["clean"], "peers": self._peers_of(pid),
            "seq": st["seq"],
        })
        await self._progress(pid)
        await self._peers(pid)
        await self._maybe_over()

    async def _quit(self, pid, st):
        st["quit"] = True
        st["time"] = self._elapsed(st)
        st["timecost"] = self._time_cost(st["time"])
        st["points"] -= st["timecost"]
        await self._progress(pid)
        await self._maybe_over()

    async def _maybe_over(self):
        if not self.multi:
            if any(s["done"] for s in self.p.values()):
                await self._finish()
        elif all(s["done"] or s["quit"] for s in self.p.values()):
            await self._finish()
        elif all(s["done"] or s["quit"] or s["left"] for s in self.p.values()):
            self._gone_token += 1
            tok = self._gone_token
            self.ctx.schedule(GONE_GRACE, lambda: self._check_gone(tok))

    # ── what everybody sees ──────────────────────────────────────────────────

    def _filled(self, st):
        return sum(1 for c in st["cells"] if c in "gch")

    def _brief(self, pid):
        st = self.p[pid]
        return {"filled": self._filled(st), "points": st["points"], "mistakes": st["mistakes"],
                "done": st["done"], "quit": st["quit"], "rank": st["rank"]}

    async def _progress(self, pid):
        await self.ctx.broadcast({"type": "sd_progress", "pid": pid, **self._brief(pid)})

    def _board_of(self, pid):
        st = self.p[pid]
        return {"pid": pid, "cells": st["cells"], "grid": "".join(st["grid"]), **self._brief(pid),
                "time": round(self._elapsed(st))}

    def _peers_of(self, me):
        return [self._board_of(pid) for pid in self.order if pid != me]

    async def _peers(self, pid):
        """Players who have finished may watch the others, so they are told
        about every change. Nobody else gets to see a board but their own."""
        board = self._board_of(pid)
        for other, st in self.p.items():
            if other != pid and st["done"]:
                await self.ctx.send(other, {"type": "sd_peer", **board})

    # ── the end ──────────────────────────────────────────────────────────────

    def _results(self):
        rows = []
        for pid in self.order:
            st = self.p[pid]
            # Whoever is still playing, or left, pays for the clock up to now;
            # whoever has finished or given up has paid already.
            if st["done"] or st["quit"]:
                points, cost = st["points"], st["timecost"]
            else:
                cost = self._time_cost(self._elapsed(st))
                points = st["points"] - cost
            rows.append({
                "player_id": pid, "points": points, "mistakes": st["mistakes"], "hints": st["hints"],
                "filled": self._filled(st), "done": st["done"], "at": st["at"],
                "time": round(st["time"] if st["done"] or st["quit"] else self._elapsed(st)),
                "clean": st["clean"], "timecost": cost,
            })
        # The most points win. A tie goes to whoever finished first, then to
        # whoever filled more.
        rows.sort(key=lambda r: (-r["points"], r["at"] if r["done"] else float("inf"), -r["filled"]))
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
        await self.ctx.broadcast({"type": "sd_over", "results": rows, "multi": self.multi, "difficulty": self.diff})
        records = []
        for r in rows:
            stats = {"difficulty": DIFFS.index(self.diff) + 1, "solved": 1 if r["done"] else 0,
                     "mistakes": r["mistakes"], "hints": r["hints"]}
            if r["done"]:
                stats["time"] = r["time"]
            records.append({
                "player_id": r["player_id"],
                "score": r["points"],
                "rank": r["rank"],
                "is_winner": self.multi and r["rank"] == 1 and r["points"] > 0,
                "stats": stats,
            })
        await self.ctx.finish(records, metadata={"difficulty": self.diff})

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _sync_msg(self, st):
        return {"type": "sd_sync", "cells": st["cells"], "grid": "".join(st["grid"]), "points": st["points"],
                "mistakes": st["mistakes"], "hints": st["hints"], "seq": st["seq"]}

    def _state_msg(self, pid):
        st = self.p[pid]
        return {
            "type": "sd_state",
            "multi": self.multi, "difficulty": self.diff, "cell_points": self._cell_points(), "hint_step": HINT_STEP[self.diff], "time_step": TIME_STEP[self.diff],
            "order": self.order, "over": self.over,
            "progress": {p: self._brief(p) for p in self.order},
            "puzzle": self.puzzle,
            "cells": st["cells"], "grid": "".join(st["grid"]),
            "points": st["points"], "mistakes": st["mistakes"], "hints": st["hints"],
            "elapsed": round(self._elapsed(st), 1),
            "done": st["done"], "quit": st["quit"], "rank": st["rank"], "time": st["time"], "timecost": st["timecost"],
            "clean": st["clean"], "timecost": st["timecost"],
            "peers": self._peers_of(pid) if st["done"] else [],
        }
