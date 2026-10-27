"""
Jigsaw — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (any app with an
mp_game.py exposing `Game(ctx)`). The framework owns rooms, sockets, identity,
reconnects and writing the finished session; everything below is this game's
rules.

The server deals one picture per room from a seed (every player in a room gets
the very same picture, the same grid and the very same piece shapes, which the
browsers cut out of the seed) and decides which pieces are in their place, how
many points that is worth, and when the puzzle is complete. The browser reports
a piece when the player lets go of it near its slot; the server checks how far
from the slot it was, so a piece can only count where it belongs, and it keeps
a pace no hand can beat. There is no time limit: the clock only counts the time
for the statistics.

Alone a game is one puzzle of the chosen level. With others everybody builds the
same puzzle at their own pace and, when all are done, the most points win:
every piece in place scores, a hint costs more the further the puzzle has gone,
and the clock costs a little, so neither speed nor luck decides it alone. A
player who has finished can watch the others. A player who leaves after
finishing is already recorded, with the clock stopped, and counts when the game
ends.

  client → server
    jp_place   {i, dx, dy}   piece i was let go dx, dy (in pieces) from its slot
    jp_hint    {sel}         put one piece in place; the price grows with the pieces placed
    jp_quit                  stop playing (with others only)

  server → client
    jp_state   {...}         the whole game, for a start or a reconnect
    jp_ok      {i, points}   the answer to jp_place, with the points as they stand
    jp_sync    {...}         the player's pieces as the server has them (the client was out of step)
    jp_hint_res {i, ...}     the piece that was placed, and what it cost
    jp_progress {pid, ...}   where somebody is, for the scoreboard
    jp_done    {...}         the player completed the puzzle: place, points and time
    jp_peer    {pid, ...}    somebody's pieces, sent only to players who have finished
    jp_over    {results}     everybody is done
"""

import importlib.util
import os
import random
import time

from backend.assets import asset

# Loaded straight from the file (Game Hub loads this module by path, so a plain
# import would hand back whatever older copy was cached).
_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("jigsaw_jp_stats", os.path.join(_APP_DIR, "jp_stats.py"))
jp_stats = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(jp_stats)

DIFFS = ("easy", "medium", "hard", "expert", "master")
# Pieces across and down: the pictures are 3 : 2, so every piece is a square.
GRID = {"easy": (6, 4), "medium": (9, 6), "hard": (12, 8), "expert": (15, 10), "master": (18, 12)}
# Points one piece in place is worth.
PIECE_POINTS = {"easy": 10, "medium": 12, "hard": 14, "expert": 16, "master": 18}
# Seconds the level allows for one piece: the puzzle must be finished within pieces x this to earn
# the speed bonus, one point for every second left, so a bigger puzzle gets more time a piece.
SECS_PER_PIECE = {"easy": 10, "medium": 20, "hard": 30, "expert": 40, "master": 50}
# How far from the slot (in pieces) a piece may be let go and still count.
SERVER_TOL = 0.75
MIN_GAP = 0.2                # on average, seconds between two pieces: faster than any hand
BURST = 6                    # pieces a slow connection may deliver in one go
GONE_GRACE = 20.0            # seconds everybody left may stay away before the game ends

THEMES = {
    "nature": ("n_lake", "n_autumn", "n_waterfall", "n_lavender", "n_coast"),
    "animals": ("a_fox", "a_parrots", "a_savanna", "a_reef", "a_pets"),
    "travel": ("t_venice", "t_santorini", "t_market", "t_tulips", "t_balloons"),
}
IMAGES = {i: t for t, ids in THEMES.items() for i in ids}


def pick_image(seed, theme, image):
    """The picture of a room: the one the host chose, else one of the theme (or of all)."""
    if image in IMAGES:
        return image
    pool = THEMES.get(theme) or tuple(IMAGES)
    return random.Random(f"{seed}:image").choice(pool)


def neighbours(i, cols, rows):
    c, r = i % cols, i // cols
    out = []
    if c > 0: out.append(i - 1)
    if c < cols - 1: out.append(i + 1)
    if r > 0: out.append(i - cols)
    if r < rows - 1: out.append(i + cols)
    return out


def is_edge(i, cols, rows):
    c, r = i % cols, i // cols
    return c == 0 or r == 0 or c == cols - 1 or r == rows - 1


def pick_hint(placed, sel, cols, rows, rng):
    """The piece to place for a hint: the one the player holds, when it is still
    loose; otherwise the loose piece that touches most pieces already in place,
    which is the one a person would do next (an edge piece to begin with)."""
    loose = [i for i in range(cols * rows) if not placed[i]]
    if not loose:
        return None
    if sel in loose:
        return sel
    if not any(placed):
        edges = [i for i in loose if is_edge(i, cols, rows)] or loose
        return rng.choice(edges)
    best, best_n = [], -1
    for i in loose:
        n = sum(1 for j in neighbours(i, cols, rows) if placed[j])
        if n > best_n:
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
        self.image = ""
        self.seed = ""
        self.cols, self.rows = GRID["easy"]
        self.order = []
        self.p = {}                 # pid -> player state
        self.finish_no = 0
        self._gone_token = 0

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        ids = [p["id"] for p in self.ctx.all_players()]
        self.multi = len(ids) > 1
        s = settings or {}
        d = s.get("difficulty")
        self.diff = d if d in DIFFS else "easy"
        self.cols, self.rows = GRID[self.diff]
        self.seed = f"{self.ctx.room_id}:{random.random()}"
        self.image = pick_image(self.seed, s.get("theme"), s.get("image"))
        self.order = ids
        saved = self.ctx.saved_state
        resumed = False
        if saved and not self.multi:
            resumed = self._resume(ids[0], saved)
        if not resumed:
            for pid in ids:
                self.p[pid] = self._fresh()
        self.started = True
        now = time.time()
        for pid in ids:
            st = self.p[pid]
            st["t0"] = now - st["carried"]
        for pid in ids:
            await self.ctx.send(pid, self._state_msg(pid))

    def _fresh(self):
        return {
            "placed": [False] * (self.cols * self.rows),
            "points": 0, "hints": 0, "carried": 0.0, "t0": 0.0,
            "done": False, "quit": False, "left": False, "rank": 0, "at": 0.0, "time": 0.0,
            "clean": 0, "speed": 0, "seq": 0,
        }

    def _resume(self, pid, saved) -> bool:
        try:
            diff = saved["difficulty"] if saved["difficulty"] in DIFFS else "easy"
            image = saved["image"]
            if image not in IMAGES:
                return False
            n = GRID[diff][0] * GRID[diff][1]
            placed = [bool(x) for x in saved["placed"]]
            if len(placed) != n:
                return False
            self.diff, self.image, self.seed = diff, image, str(saved["seed"])
            self.cols, self.rows = GRID[diff]
            st = self._fresh()
            st["placed"] = placed
            for k in ("points", "hints"):
                st[k] = int(saved.get(k, 0))
            st["carried"] = max(0.0, float(saved.get("elapsed", 0)))
            self.p[pid] = st
            return True
        except Exception as e:
            print(f"[jigsaw] bad save: {e}")
            return False

    def snapshot(self):
        """Save & exit (framework-driven, solo only): the game as it stands.
        Nothing is recorded in Game Hub; that happens when the game ends."""
        if not self.started or self.over or self.multi:
            return None
        st = self.p.get(self.ctx.host_id)
        if not st:
            return None
        return {"seed": self.seed, "difficulty": self.diff, "image": self.image,
                "placed": [1 if x else 0 for x in st["placed"]], "points": st["points"],
                "hints": st["hints"], "elapsed": self._elapsed(st)}

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
        if kind == "jp_place":
            await self._place(pid, st, msg)
        elif kind == "jp_hint":
            await self._hint(pid, st, msg)
        elif kind == "jp_quit" and self.multi:
            await self._quit(pid, st)

    @staticmethod
    def _elapsed(st):
        if st["done"]:
            return st["time"]
        return max(0.0, time.time() - st["t0"]) if st["t0"] else st["carried"]

    def _piece_points(self):
        return PIECE_POINTS[self.diff]

    async def _place(self, pid, st, msg):
        try:
            i = int(msg.get("i"))
            dx, dy = float(msg.get("dx", 0)), float(msg.get("dy", 0))
        except (TypeError, ValueError):
            return
        n = self.cols * self.rows
        if not (0 <= i < n) or st["placed"][i]:
            await self.ctx.send(pid, self._sync_msg(st))
            return
        now = time.time()
        # Never further from the slot than a piece can click in, and never
        # faster than a hand can carry them (a lagging connection may deliver a
        # few at once, which the allowance covers).
        too_fast = self._count(st) + 1 > (now - st["t0"]) / MIN_GAP + BURST
        if (dx * dx + dy * dy) ** 0.5 > SERVER_TOL or too_fast:
            await self.ctx.send(pid, self._sync_msg(st))
            return
        st["placed"][i] = True
        st["points"] += self._piece_points()
        await self.ctx.send(pid, {"type": "jp_ok", "i": i, "points": st["points"], "placed": self._count(st),
                                  "seq": st["seq"]})
        await self._after(pid, st)

    def _hint_cost(self, st):
        """The points of two pieces at the start, and from the moment the pieces
        placed outnumber that, as many points as there are pieces placed: ten
        placed, a hint costs ten, a hundred placed, a hundred. So it grows with
        the puzzle and is dearest at the end, and nobody can begin with cheap hints."""
        return max(2 * self._piece_points(), self._count(st))

    async def _hint(self, pid, st, msg):
        """A hint puts one piece in place and is paid for even when that takes
        the points below zero. The piece earns nothing."""
        try:
            sel = int(msg.get("sel", -1))
        except (TypeError, ValueError):
            sel = -1
        rng = random.Random(f"{self.seed}:{pid}:{st['hints']}")
        i = pick_hint(st["placed"], sel, self.cols, self.rows, rng)
        if i is None:
            await self.ctx.send(pid, {"type": "jp_hint_res", "i": -1, "cost": 0, "points": st["points"], "seq": st["seq"]})
            return
        cost = self._hint_cost(st)
        st["points"] -= cost
        st["hints"] += 1
        st["placed"][i] = True
        await self.ctx.send(pid, {"type": "jp_hint_res", "i": i, "cost": cost, "points": st["points"],
                                  "placed": self._count(st), "seq": st["seq"]})
        await self._after(pid, st)

    async def _after(self, pid, st):
        if all(st["placed"]):
            await self._solved(pid, st)
        else:
            await self._progress(pid)
            await self._peers(pid)

    def _allowance(self):
        """Seconds the whole puzzle may take for the speed bonus."""
        return self.cols * self.rows * SECS_PER_PIECE[self.diff]

    def _speed_bonus(self, seconds):
        """One point for every second left of the time the level allows, like the
        speed bonus of Flasks. A slow player loses nothing: the bonus is only ever
        added, and a puzzle that is not finished earns none of it."""
        return int(max(0.0, self._allowance() - seconds))

    async def _solved(self, pid, st):
        """The puzzle is complete: the finishing order decides the places."""
        V = self._piece_points()
        st["done"] = True
        st["at"] = time.time()
        st["time"] = max(0.0, st["at"] - st["t0"])
        st["clean"] = 10 * V if st["hints"] == 0 else 0
        st["speed"] = self._speed_bonus(st["time"])
        st["points"] += st["clean"] + st["speed"]
        self.finish_no += 1
        st["rank"] = self.finish_no
        await self.ctx.send(pid, {
            "type": "jp_done", "rank": st["rank"], "points": st["points"], "time": st["time"],
            "speed": st["speed"], "clean": st["clean"], "peers": self._peers_of(pid),
            "seq": st["seq"],
        })
        await self._progress(pid)
        await self._peers(pid)
        await self._maybe_over()

    async def _quit(self, pid, st):
        st["quit"] = True
        st["time"] = self._elapsed(st)
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

    @staticmethod
    def _count(st):
        return sum(1 for x in st["placed"] if x)

    def _brief(self, pid):
        st = self.p[pid]
        return {"placed": self._count(st), "points": st["points"], "hints": st["hints"],
                "done": st["done"], "quit": st["quit"], "rank": st["rank"]}

    async def _progress(self, pid):
        await self.ctx.broadcast({"type": "jp_progress", "pid": pid, **self._brief(pid)})

    def _board_of(self, pid):
        st = self.p[pid]
        return {"pid": pid, "placed": "".join("1" if x else "0" for x in st["placed"]), **self._brief(pid),
                "time": round(self._elapsed(st))}

    def _peers_of(self, me):
        return [self._board_of(pid) for pid in self.order if pid != me]

    async def _peers(self, pid):
        """Players who have finished may watch the others, so they are told
        about every change. Nobody else gets to see a board but their own."""
        board = self._board_of(pid)
        for other, st in self.p.items():
            if other != pid and st["done"]:
                await self.ctx.send(other, {"type": "jp_peer", **board})

    # ── the end ──────────────────────────────────────────────────────────────

    def _results(self):
        rows = []
        for pid in self.order:
            st = self.p[pid]
            # The speed bonus is paid for a finished puzzle only.
            points, speed = st["points"], st["speed"]
            rows.append({
                "player_id": pid, "points": points, "hints": st["hints"],
                "placed": self._count(st), "done": st["done"], "at": st["at"],
                "time": round(st["time"] if st["done"] or st["quit"] else self._elapsed(st)),
                "clean": st["clean"], "speed": speed,
            })
        # The most points win. A tie goes to whoever finished first, then to
        # whoever placed more.
        rows.sort(key=lambda r: (-r["points"], r["at"] if r["done"] else float("inf"), -r["placed"]))
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
        await self.ctx.broadcast({"type": "jp_over", "results": rows, "multi": self.multi, "difficulty": self.diff})
        records = []
        n = self.cols * self.rows
        for r in rows:
            stats = {"difficulty": DIFFS.index(self.diff) + 1, "solved": 1 if r["done"] else 0,
                     "pieces": n if r["done"] else r["placed"], "hints": r["hints"]}
            if r["done"]:
                stats["time"] = r["time"]
            records.append({
                "player_id": r["player_id"],
                "score": r["points"],
                "rank": r["rank"],
                "is_winner": self.multi and r["rank"] == 1 and r["points"] > 0,
                "stats": stats,
            })
        for r in rows:
            if r["done"]:
                try:
                    jp_stats.record(r["player_id"], self.image, self.diff, r["points"], r["time"], r["hints"])
                except Exception as e:
                    print(f"[jigsaw] could not keep a result: {e}")
        await self.ctx.finish(records, metadata={"difficulty": self.diff, "image": self.image})

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _sync_msg(self, st):
        return {"type": "jp_sync", "placed": "".join("1" if x else "0" for x in st["placed"]),
                "points": st["points"], "hints": st["hints"], "seq": st["seq"]}

    def _state_msg(self, pid):
        st = self.p[pid]
        return {
            "type": "jp_state",
            "multi": self.multi, "difficulty": self.diff, "cols": self.cols, "rows": self.rows,
            "piece_points": self._piece_points(), "time_allow": self._allowance(),
            "seed": self.seed, "image": self.image,
            "order": self.order, "over": self.over,
            "progress": {p: self._brief(p) for p in self.order},
            "placed": "".join("1" if x else "0" for x in st["placed"]),
            "points": st["points"], "hints": st["hints"],
            "elapsed": round(self._elapsed(st), 1),
            "done": st["done"], "quit": st["quit"], "rank": st["rank"], "time": st["time"],
            "clean": st["clean"], "speed": st["speed"],
            "peers": self._peers_of(pid) if st["done"] else [],
            "urls": {
                "three": asset("/apps/jigsaw/three.module.min.js"),
                "scene": asset("/apps/jigsaw/table3d.js"),
                "image": asset(f"/apps/jigsaw/img/{self.image}.webp"),
                "thumb": asset(f"/apps/jigsaw/img/t/{self.image}.webp"),
            },
        }
