"""
Remember the Pairs — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (any app with an
mp_game.py exposing `Game(ctx)`). The framework owns rooms, sockets, identity,
reconnects and writing the finished session; everything below is this game's
rules.

The server owns the table. It shuffles the deck and keeps it: a browser is only
told what a card is at the moment somebody turns it over, so nobody can read
the table out of the page or the network. Everything else follows from that —
whose turn it is, how long a turn lasts, what counts as a pair.

  client → server
    mp_flip  {i}                        turn card i over (current player only)

  server → client
    mp_state {...}                      the whole table, for a start or a reconnect
    mp_turn  {pid, left}                it is pid's turn, `left` seconds on the clock
    mp_flipped {i, sym, pid}            card i is face up and is `sym`
    mp_match {a, b, pid, pairs}         a pair: both cards leave, pid goes again
    mp_miss  {a, b, hold}               no pair: turn both back after `hold` s
    mp_timeout {pid, down}              the clock ran out; `down` cards go back
    mp_over  {results}                  every pair is gone (or nobody is playing)

Everyone sees every card that is turned over, which is the point of the game;
what the other players do *before* they turn one (rotating, looking) never
leaves their browser.
"""

import math
import random
import time

from backend.assets import asset

# How many different pictures each theme can offer. The client holds the
# pictures themselves; this is only how many pairs a room may ask for.
THEMES = {
    "animals": 60, "food": 60, "nature": 48, "travel": 48, "fun": 48,
    "faces": 48, "numbers": 99, "colors": 24, "shapes": 60,
}
PAIR_CHOICES = (6, 8, 10, 12, 16, 20, 24, 32, 40, 48)
TIME_CHOICES = (0, 10, 15, 20, 30, 45, 60, 90)

HOLD_SOLO = 1.2          # how long a wrong pair stays face up
HOLD_MULTI = 1.8         # longer with others, so everyone can look
GRACE = 1.0              # network slack on top of the turn clock
MATCH_PAUSE = 0.9        # the pair is shown before the next flip is allowed
IDLE_SKIP = 3            # turns in a row without a move before a player is skipped
IDLE_END = 6             # the same, alone: the game is left and ends


def _int(v, default, lo, hi):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def size_factor(pairs: int) -> float:
    """A bigger table is harder, so it is worth a little more. 8 pairs is 1.0."""
    return max(0.9, min(1.6, 1 + 0.15 * math.log2(max(pairs, 6) / 8)))


def score_of(found: int, attempts: int, pairs: int) -> int:
    """Points depend on how well a player remembered, not on how many people
    shared the table: pairs found per attempt (1.0 is never wrong), scaled for
    the size of the table. Four players on one table and one player alone are
    measured the same way."""
    if not attempts or not found:
        return 0
    return round(1000 * (found / attempts) * size_factor(pairs))


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.over = False
        self.started_at = 0.0
        self.theme = "animals"
        self.pairs = 12
        self.turn_time = 30
        self.deck = []            # card index -> symbol (0 .. pairs-1)
        self.picks = []           # symbol -> picture number in the theme
        self.matched = set()
        self.up = []              # cards face up in the current turn
        self.order = []           # player ids, in turn order
        self.turn = 0             # index into order
        self.turn_pid = None
        self.turn_at = 0.0
        self.locked = False
        self._token = 0
        self.st = {}              # pid -> counters

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        theme = settings.get("theme")
        self.theme = theme if theme in THEMES else "animals"
        pairs = _int(settings.get("pairs"), 12, 6, 48)
        pairs = min(pairs, THEMES[self.theme])
        # The largest offered size that does not ask for more pictures than
        # the theme has.
        self.pairs = max((c for c in PAIR_CHOICES if c <= pairs), default=PAIR_CHOICES[0])
        t = _int(settings.get("time"), 30, 0, 300)
        self.turn_time = min(TIME_CHOICES, key=lambda c: abs(c - t))
        self.started = True
        self.started_at = time.time()

        saved = self.ctx.saved_state
        if not (saved and self._resume(saved)):
            self.picks = random.sample(range(THEMES[self.theme]), self.pairs)
            self.deck = list(range(self.pairs)) * 2
            random.shuffle(self.deck)

        ids = [p["id"] for p in self.ctx.all_players()]
        random.shuffle(ids)
        self.order = ids
        for pid in ids:
            self.st.setdefault(pid, self._fresh())
        if getattr(self, "_saved_stats", None) and self.ctx.host_id in self.st:
            self.st[self.ctx.host_id].update(self._saved_stats)
        await self.ctx.broadcast(self._state_msg(None))
        await self._begin_turn()

    @staticmethod
    def _fresh():
        return {"pairs": 0, "attempts": 0, "streak": 0, "best": 0, "timeouts": 0, "idle": 0}

    def _resume(self, saved: dict) -> bool:
        try:
            theme = saved["theme"]
            deck = [int(x) for x in saved["deck"]]
            picks = [int(x) for x in saved["picks"]]
            pairs = len(picks)
            if theme not in THEMES or pairs < 2 or sorted(deck) != sorted(list(range(pairs)) * 2):
                return False
            if any(not 0 <= p < THEMES[theme] for p in picks):
                return False
            matched = {int(i) for i in saved.get("matched", []) if 0 <= int(i) < len(deck)}
            self.theme, self.pairs, self.deck, self.picks = theme, pairs, deck, picks
            self.matched = matched
            self.turn_time = _int(saved.get("time"), self.turn_time, 0, 300)
            solo = saved.get("stats") or {}
            self._saved_stats = {k: int(v) for k, v in solo.items() if k in self._fresh()}
            return True
        except Exception as e:
            print(f"[memorypairs] bad save: {e}")
            return False

    def snapshot(self):
        """Save & exit (framework-driven, solo only). The table as it stands,
        between two turns: cards that are face up are put back."""
        if not self.started or self.over:
            return None
        pid = self.ctx.host_id
        return {
            "theme": self.theme, "time": self.turn_time,
            "deck": self.deck, "picks": self.picks,
            "matched": sorted(self.matched),
            "stats": dict(self.st.get(pid, self._fresh())),
        }

    async def on_join(self, player):
        pid = player["id"]
        if self.started:
            await self.ctx.send(pid, self._state_msg(pid))
            # A reconnecting player in a game nobody could continue picks up here.
            if not self.over and self.turn_pid is None:
                await self._begin_turn()

    async def on_leave(self, player):
        if (self.started and not self.over and len(self.order) > 1
                and player["id"] == self.turn_pid and not self.locked):
            await self._pass_turn()

    # ── messages ─────────────────────────────────────────────────────────────

    async def on_message(self, player, msg):
        if msg.get("type") != "mp_flip" or not self.started or self.over or self.locked:
            return
        pid = player["id"]
        if pid != self.turn_pid:
            return
        try:
            i = int(msg.get("i"))
        except (TypeError, ValueError):
            return
        if not 0 <= i < len(self.deck) or i in self.matched or i in self.up:
            return
        self.up.append(i)
        self.st[pid]["idle"] = 0
        await self.ctx.broadcast({"type": "mp_flipped", "i": i, "sym": self.deck[i], "pid": pid})
        if len(self.up) < 2:
            return

        a, b = self.up
        s = self.st[pid]
        s["attempts"] += 1
        self.locked = True
        self._token += 1            # the clock of this turn is over
        if self.deck[a] == self.deck[b]:
            s["pairs"] += 1
            s["streak"] += 1
            s["best"] = max(s["best"], s["streak"])
            self.matched.update((a, b))
            self.up = []
            await self.ctx.broadcast({"type": "mp_match", "a": a, "b": b, "pid": pid, "pairs": s["pairs"]})
            if len(self.matched) >= len(self.deck):
                self.ctx.schedule(MATCH_PAUSE + 0.4, self._finish)
            else:
                self.ctx.schedule(MATCH_PAUSE, self._same_player)
        else:
            s["streak"] = 0
            hold = HOLD_MULTI if len(self.order) > 1 else HOLD_SOLO
            self.up = []
            await self.ctx.broadcast({"type": "mp_miss", "a": a, "b": b, "hold": hold})
            self.ctx.schedule(hold + 0.2, self._pass_turn)

    # ── turns ────────────────────────────────────────────────────────────────

    def _active(self, pid) -> bool:
        if len(self.order) < 2:
            return True
        return self.st[pid]["idle"] < IDLE_SKIP

    def _connected(self, pid) -> bool:
        return any(p["id"] == pid for p in self.ctx.players())

    async def _same_player(self):
        if self.over:
            return
        self.locked = False
        await self._begin_turn(keep=True)

    async def _pass_turn(self):
        if self.over:
            return
        self.locked = False
        self.up = []
        await self._begin_turn(keep=False)

    async def _begin_turn(self, keep=False):
        n = len(self.order)
        if not n:
            return
        if not keep:
            self.turn = (self.turn + 1) % n if self.turn_pid is not None else self.turn
        # Find the next player who is here and still playing.
        pick = None
        for k in range(n):
            pid = self.order[(self.turn + k) % n]
            if self._active(pid) and (self.turn_time > 0 or self._connected(pid) or n == 1):
                self.turn = (self.turn + k) % n
                pick = pid
                break
        if pick is None:
            if all(not self._active(p) for p in self.order):
                await self._finish()
            else:
                self.turn_pid = None       # nobody connected; wait for a join
            return
        self.turn_pid = pick
        self.turn_at = time.time()
        self._token += 1
        await self.ctx.broadcast({"type": "mp_turn", "pid": pick, "left": self.turn_time})
        if self.turn_time > 0:
            tok = self._token
            self.ctx.schedule(self.turn_time + GRACE, lambda: self._timeout(tok))

    async def _timeout(self, tok):
        if self.over or self.locked or tok != self._token:
            return
        pid = self.turn_pid
        s = self.st.get(pid)
        if s is None:
            return
        s["timeouts"] += 1
        s["idle"] += 1
        s["streak"] = 0
        down, self.up = self.up, []
        await self.ctx.broadcast({"type": "mp_timeout", "pid": pid, "down": down})
        if len(self.order) < 2 and s["idle"] >= IDLE_END:
            await self._finish()
            return
        self.locked = True
        self.ctx.schedule(0.6, self._pass_turn)

    # ── the end ──────────────────────────────────────────────────────────────

    def _results(self):
        rows = []
        for pid in self.order:
            s = self.st[pid]
            rows.append({
                "player_id": pid,
                "pairs": s["pairs"], "attempts": s["attempts"],
                "accuracy": round(100.0 * s["pairs"] / s["attempts"], 1) if s["attempts"] else 0.0,
                "best": s["best"], "timeouts": s["timeouts"],
                "score": score_of(s["pairs"], s["attempts"], self.pairs),
            })
        rows.sort(key=lambda r: (-r["pairs"], -r["accuracy"], r["attempts"]))
        return rows

    async def _finish(self):
        if self.over:
            return
        self.over = True
        self._token += 1
        rows = self._results()
        names = {p["id"]: p for p in self.ctx.all_players()}
        for r in rows:
            p = names.get(r["player_id"]) or {}
            r["display_name"] = p.get("display_name", "")
        await self.ctx.broadcast({"type": "mp_over", "results": rows})
        multi = len(rows) > 1
        top = rows[0]["pairs"] if rows else 0
        records = []
        for rank, r in enumerate(rows, 1):
            records.append({
                "player_id": r["player_id"],
                "score": r["score"],
                "rank": rank,
                # Alone there is nobody to beat; with others a tie for most
                # pairs is a shared win.
                "is_winner": multi and r["pairs"] == top and top > 0,
                "stats": {
                    "pairs": r["pairs"], "accuracy": r["accuracy"],
                    "best_streak": r["best"], "timeouts": r["timeouts"],
                },
            })
        await self.ctx.finish(
            records,
            metadata={"theme": self.theme, "pairs": self.pairs, "time": self.turn_time},
            stats={"cards": len(self.deck)},
        )

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _state_msg(self, pid):
        left = None
        if self.turn_pid and self.turn_time > 0 and not self.locked:
            left = max(0, round(self.turn_time - (time.time() - self.turn_at)))
        return {
            "type": "mp_state",
            "theme": self.theme, "pairs": self.pairs, "cards": len(self.deck),
            "picks": self.picks, "time": self.turn_time,
            "order": self.order, "turn": self.turn_pid, "left": left,
            "matched": [[i, self.deck[i]] for i in sorted(self.matched)],
            "up": [[i, self.deck[i]] for i in self.up],
            "stats": {p: {"pairs": s["pairs"], "attempts": s["attempts"]} for p, s in self.st.items()},
            "over": self.over,
            "urls": {
                "faces": asset("/apps/memorypairs/faces.js"),
                "three": asset("/apps/memorypairs/three.module.min.js"),
                "cylinder": asset("/apps/memorypairs/cylinder3d.js"),
            },
        }
