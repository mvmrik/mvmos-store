"""
Deal or Not — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (an mp_game.py that
exposes `Game(ctx)`). The framework owns rooms, sockets, identity, reconnects
and writing the finished session; everything below is this game's rules.

The server owns the boxes. It shuffles 36 amounts over 36 numbered boxes and
keeps them: a browser is told what a box held only at the moment the box is
opened, so nobody can read the board out of the page or the network. The same
goes for the banker — only the player he is calling ever sees the offer.

One board, shared by everybody:

  draw    each player in turn draws one random box and keeps it
  open    the players take turns opening the other boxes; an amount that is
          opened is out of the game for everyone
  offer   after a set number of opened boxes the banker calls EVERY player
          that is still playing, privately, with an offer of his own. Everybody
          answers; the answers are revealed together, when the last one is in
  ...     until one closed box is left, then the final call, then the reveal

A player who takes a deal is paid the amount and leaves the table (and watches);
a player who refuses to the end gets whatever is in the box.

  client → server
    dn_draw                            draw my box (my turn only)
    dn_open  {box}                     open box number `box` (my turn only)
    dn_answer {accept}                 answer the banker's offer

  server → client
    dn_state   {...}                   the whole table, for a start or a reconnect
    dn_turn    {phase, pid, left, ...} whose turn it is, and for how long
    dn_drawn   {pid, box}              pid drew box
    dn_opened  {box, value, pid}       box is open and held `value`
    dn_phase   {round, rounds, final, pending, left}   the banker is calling
    dn_offer   {kind, amount|box, left}   (private) what the banker offers
    dn_ready   {pid}                   pid has answered (not what)
    dn_resolved {deals, swaps, ...}    the answers, revealed together
    dn_over    {results, reveal}       the end
"""

import math
import random
import time

TOTAL = 36

# 36 amounts, none repeated, up to one million. The 18 small ones are shown on
# the left of the board and the 18 large ones on the right; most of the money is
# in a few large boxes, as on the show.
LOW = [1, 2, 5, 10, 25, 50, 75, 100, 200, 300, 400, 500, 750, 1000, 2000, 3000, 4000, 5000]
HIGH = [7500, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 75000,
        100000, 125000, 150000, 200000, 300000, 400000, 500000, 1000000]
VALUES = LOW + HIGH

TIME_CHOICES = (10, 15, 20, 30, 45, 60)
DEFAULT_TIME = 60

# How many boxes are opened between two calls. The calls come closer together
# towards the end: whatever the first part cannot use is spent one box at a time.
ROUND_BASE = (6, 5, 5, 4, 4, 3, 3, 2, 2)

DRAW_PAUSE = 2.2          # the box travels to its player
OPEN_PAUSE = 0.1          # between two boxes: the next one can be opened at once
OPEN_PAUSE_LAST = 3.0     # after the last box of a round: the amount is shown before the banker calls
CALL_PAUSE = 1.6          # before the banker's answers are shown
EVENT_PAUSE = 3.2         # for every deal or swap that is revealed
IDLE_SKIP = 3             # turns in a row without a move before a player is passed over
IDLE_END = 4              # the same, alone: the game is left and ends

# Bonuses are a percentage of what a player won, so the best possible result is
# not a fixed ceiling: a player who keeps the million box and reads the banker
# can still beat another who did the same without. Each bonus grows with how
# well the player read the game: a clear win earns a lot, a narrow one a little,
# and a decision that was only just wrong still earns a few points.
BONUS_CAP = 100


def merit(ratio, lo, base, per, cap):
    """Percent for a decision that came out `ratio` times as good as the
    alternative. Below `lo` nothing; from `lo` to 1 a little, up to `base`;
    above 1 it keeps growing with every doubling, up to `cap`."""
    if ratio < lo:
        return 0
    if ratio < 1:
        return base * (ratio - lo) / (1 - lo)
    return min(cap, base + per * math.log2(ratio))


def round_sizes(boxes_to_open: int) -> list:
    out, left = [], boxes_to_open
    for s in ROUND_BASE:
        if left - s >= 2:
            out.append(s)
            left -= s
        else:
            break
    out += [1] * left
    return out


def nice(x: float) -> int:
    """Offers are round numbers: two significant figures."""
    x = max(1.0, x)
    if x < 100:
        return int(round(x))
    mag = 10 ** (int(math.floor(math.log10(x))) - 1)
    return int(round(x / mag) * mag)


def _int(v, default, lo, hi):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.over = False
        self.phase = "draw"          # draw | open | offer | over
        self.turn_time = DEFAULT_TIME
        self.box_val = {}            # box number -> amount
        self.gone = set()            # boxes that are out: opened, and shown to everybody
        self.sold = set()            # boxes of players who took a deal: out of play, but kept closed until the end
        self.order = []              # player ids, in turn order
        self.st = {}                 # pid -> player state
        self.draw_idx = 0
        self.turn_pid = None
        self.turn_at = 0.0
        self.deadline = 0.0
        self.sizes = []
        self.round_idx = 0
        self.left_in_round = 0
        self.opened_count = 0
        self.total_open = 0
        self.open_ptr = 0
        self.pending = set()         # players the banker is waiting for
        self._tok = 0
        self.results = None
        self.reveal = []

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        t = _int(settings.get("time"), DEFAULT_TIME, 5, 120)
        self.turn_time = min(TIME_CHOICES, key=lambda c: abs(c - t))
        nums = list(range(1, TOTAL + 1))
        vals = VALUES[:]
        random.shuffle(vals)
        self.box_val = dict(zip(nums, vals))
        ids = [p["id"] for p in self.ctx.all_players()]
        random.shuffle(ids)
        self.order = ids
        if len(ids) < 2:
            self.turn_time = 0       # alone: nobody to wait for, no clock
        for pid in ids:
            self.st[pid] = {
                "status": "playing", "box": None, "amount": None, "round": 0,
                "idle": 0, "offers": [], "answer": None, "offer": None, "swaps": [],
            }
        self.total_open = TOTAL - len(ids) - 1
        self.sizes = round_sizes(self.total_open)
        self.started = True
        # Started from a saved solo game: the boxes, what is open and the
        # banker's history are put back, and the game goes on from there.
        saved = self.ctx.saved_state
        if saved and len(ids) == 1 and self._resume(saved, ids[0]):
            self.phase = "open"
            await self.ctx.broadcast(self._state_msg(None))
            if self.left_in_round <= 0:
                await self._begin_offers()
            else:
                await self._open_turn()
            return
        await self.ctx.broadcast(self._state_msg(None))
        await self._begin_draw()

    def _resume(self, saved: dict, pid: str) -> bool:
        """Put the table back where the save left it. False if the save is not
        usable, so on_start simply carries on with a new game."""
        try:
            box_val = {int(k): int(v) for k, v in (saved.get("box_val") or {}).items()}
            if sorted(box_val) != list(range(1, TOTAL + 1)) or sorted(box_val.values()) != sorted(VALUES):
                return False
            gone = {int(n) for n in saved.get("gone", []) if int(n) in box_val}
            box = int(saved["box"])
            r = int(saved["round_idx"])
            left = int(saved["left_in_round"])
            if box not in box_val or box in gone or not 0 <= r < len(self.sizes) or not 0 <= left <= self.sizes[r]:
                return False
            offers = []
            for o in saved.get("offers", []):
                offers.append({k: o[k] for k in ("rnd", "kind", "amount", "mean", "cur", "accepted") if k in o})
            swaps = [(int(g), int(t)) for g, t in saved.get("swaps", [])]
        except Exception as e:
            print(f"[dealornot] bad save: {e}")
            return False
        self.box_val, self.gone = box_val, gone
        self.opened_count = int(saved.get("opened_count", len(gone)))
        self.round_idx, self.left_in_round = r, left
        self.draw_idx = 1
        st = self.st[pid]
        st["box"], st["offers"], st["swaps"] = box, offers, swaps
        return True

    def snapshot(self):
        """Save & exit (framework-driven, solo only). The natural place to put
        the game down is between two boxes: the banker's call that is still
        ringing is dropped and made again when the game is picked up."""
        if not self.started or self.over or len(self.order) != 1 or self.phase == "draw":
            return None
        st = self.st[self.order[0]]
        if st["status"] != "playing" or st["box"] is None:
            return None
        r, left = self.round_idx, self.left_in_round
        if self.phase == "offer" and st.get("offer") is None and not self.pending:
            # the answer is in and the round is being closed: carry on with the next
            if r + 1 >= len(self.sizes):
                return None
            r, left = r + 1, self.sizes[r + 1]
        offers = [o for o in st["offers"] if "accepted" in o]
        return {
            "box_val": {str(k): v for k, v in self.box_val.items()},
            "gone": sorted(self.gone), "box": st["box"],
            "offers": offers, "swaps": [list(x) for x in st["swaps"]],
            "opened_count": self.opened_count, "round_idx": r, "left_in_round": left,
        }

    async def on_join(self, player):
        if self.started:
            await self.ctx.send(player["id"], self._state_msg(player["id"]))

    async def on_leave(self, player):
        pass

    async def on_message(self, player, msg):
        if not self.started or self.over:
            return
        t = msg.get("type")
        pid = player["id"]
        if t == "dn_draw":
            if self.phase == "draw" and pid == self.turn_pid:
                await self._draw(pid, False)
        elif t == "dn_open":
            if self.phase == "open" and pid == self.turn_pid:
                try:
                    n = int(msg.get("box"))
                except (TypeError, ValueError):
                    return
                if n in self._closed():
                    await self._open(pid, n, False)
        elif t == "dn_answer":
            if self.phase == "offer" and pid in self.pending:
                accept = bool(msg.get("accept"))
                box = None
                if accept and self.st[pid]["offer"]["kind"] == "swap":
                    try:
                        box = int(msg.get("box"))
                    except (TypeError, ValueError):
                        return
                    if box not in self._closed():
                        return
                self.st[pid]["swap_to"] = box
                await self._answer(pid, accept, False)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _held(self):
        return {s["box"] for s in self.st.values() if s["box"] is not None and s["status"] == "playing"}

    def _closed(self):
        """Boxes on the board: not opened, not in anybody's hands."""
        held = self._held()
        return [n for n in self.box_val if n not in self.gone and n not in self.sold and n not in held]

    def _solo(self):
        return len(self.order) < 2

    def _active(self, pid):
        s = self.st[pid]
        if s["status"] != "playing":
            return False
        return self._solo() or s["idle"] < IDLE_SKIP

    def _playing(self):
        return [p for p in self.order if self.st[p]["status"] == "playing"]

    def _name(self, pid):
        for p in self.ctx.all_players():
            if p["id"] == pid:
                return p.get("display_name", "")
        return ""

    def _arm(self, seconds):
        self._tok += 1
        self.deadline = time.time() + seconds
        return self._tok

    def _left(self):
        return max(0, round(self.deadline - time.time())) if self.deadline else 0

    # ── draw ─────────────────────────────────────────────────────────────────

    async def _begin_draw(self):
        if self.draw_idx >= len(self.order):
            await self._begin_open()
            return
        pid = self.order[self.draw_idx]
        self.turn_pid = pid
        self.turn_at = time.time()
        tok = self._arm(self.turn_time)
        await self.ctx.broadcast({"type": "dn_turn", "phase": "draw", "pid": pid, "left": self.turn_time})
        if self.turn_time:
            self.ctx.schedule(self.turn_time + 1.0, lambda: self._draw_timeout(tok))

    async def _draw_timeout(self, tok):
        if tok != self._tok or self.phase != "draw" or self.turn_pid is None:
            return
        pid = self.turn_pid
        self.st[pid]["idle"] += 1
        await self._draw(pid, True)

    async def _draw(self, pid, auto):
        box = random.choice(self._closed())
        self.st[pid]["box"] = box
        if not auto:
            self.st[pid]["idle"] = 0
        self._tok += 1
        self.turn_pid = None
        self.draw_idx += 1
        await self.ctx.broadcast({"type": "dn_drawn", "pid": pid, "box": box})
        self.ctx.schedule(DRAW_PAUSE, self._begin_draw)

    # ── open ─────────────────────────────────────────────────────────────────

    async def _begin_open(self):
        self.phase = "open"
        self.round_idx = 0
        self.left_in_round = self.sizes[0]
        self.open_ptr = 0
        await self._open_turn()

    async def _open_turn(self):
        """Hand the next box to open to the next player who is still here."""
        n = len(self.order)
        pick = None
        for k in range(n):
            pid = self.order[(self.open_ptr + k) % n]
            if self._active(pid):
                self.open_ptr = (self.open_ptr + k) % n
                pick = pid
                break
        if pick is None:
            await self._finish()
            return
        self.turn_pid = pick
        self.turn_at = time.time()
        tok = self._arm(self.turn_time)
        await self.ctx.broadcast({
            "type": "dn_turn", "phase": "open", "pid": pick, "left": self.turn_time,
            "round": self.round_idx + 1, "rounds": len(self.sizes), "to_open": self.left_in_round,
        })
        if self.turn_time:
            self.ctx.schedule(self.turn_time + 1.0, lambda: self._open_timeout(tok))

    async def _open_timeout(self, tok):
        if tok != self._tok or self.phase != "open" or self.turn_pid is None:
            return
        pid = self.turn_pid
        self.st[pid]["idle"] += 1
        if self._solo() and self.st[pid]["idle"] >= IDLE_END:
            await self._finish()
            return
        await self._open(pid, random.choice(self._closed()), True)

    async def _open(self, pid, box, auto):
        if not auto:
            self.st[pid]["idle"] = 0
        self._tok += 1
        self.turn_pid = None
        self.gone.add(box)
        self.opened_count += 1
        self.left_in_round -= 1
        await self.ctx.broadcast({"type": "dn_opened", "box": box, "value": self.box_val[box], "pid": pid})
        self.ctx.schedule(OPEN_PAUSE if self.left_in_round > 0 else OPEN_PAUSE_LAST, self._after_open)

    async def _after_open(self):
        if self.over:
            return
        if self.left_in_round <= 0:
            await self._begin_offers()
            return
        self.open_ptr = (self.open_ptr + 1) % len(self.order)
        await self._open_turn()

    # ── the banker ───────────────────────────────────────────────────────────

    def _swap_chance(self, s, mine, closed, remaining, final):
        """How likely the banker is to offer a swap instead of money.

        A swap is a lie he tells when it pays him. He leans towards offering
        one when the player holds more than what a swap would bring, so the
        player gives a good box away, and
        player would gain. But a banker who only ever offers a swap to a player
        with a big box is read in no time, so every part of this is a lean and
        not a rule: a weak box still gets swaps (a bluff, which costs him a
        little when it is taken), and a strong one often gets money instead.
        He also watches the player: one who takes swaps is fed the trap, one
        who always refuses is bluffed with weak-box swaps so that a swap never
        looks like a sign.
        """
        vals = [self.box_val[n] for n in closed]
        mean_c = sum(vals) / len(vals)
        edge = math.log(max(mine, 1) / max(mean_c, 1))        # > 0: the box is worth more
        p = 0.30 + 0.22 * math.tanh(edge / 1.5)
        if mine >= max(remaining):
            p += 0.15                                          # he wants the biggest prize gone
        if len(closed) <= 2:                                   # he sees almost the whole truth
            p = 0.22 + 0.5 * (mine > mean_c)
        past = [o for o in s["offers"] if o["kind"] == "swap" and "accepted" in o]
        took = sum(1 for o in past if o["accepted"])
        read = (took - (len(past) - took)) / (len(past) + 2.0)   # -1 refuses all .. +1 takes all
        if edge > 0:
            p *= 1 + 0.5 * read
        else:
            p *= 1 - 0.6 * read
        last = [o["kind"] for o in s["offers"][-3:]]
        if last and last[-1] == "swap":
            p *= 0.6                                           # not twice in a row too often
        elif len(last) == 3 and "swap" not in last:
            p *= 1.3                                           # a long silence is its own tell
        if final:
            p *= 1.15
        return max(0.18, min(0.75, p))

    def _make_offer(self, pid, final):
        """What the banker offers one player.

        He knows what is in the player's box and in every box that is still
        closed, and plays to pay as little as he can:

        * Money. His starting point is the average of the amounts still in play,
          times a share that grows as boxes are opened, so early offers are
          stingy and late ones come close to a fair price. He then leans on it:
          when the box is stronger than most of what is left he sweetens the
          offer, so the player is tempted to sell a good box short; when it is
          weaker he sours it, so the player keeps a poor one. Noise on top keeps
          the lean from being a rule that can be read off.
        * A swap, instead of money: the banker only offers it, and the player
          chooses which closed box to take. See _swap_chance: a calculated
          lean towards boxes worth more than the rest, hidden by bluffs.
        """
        s = self.st[pid]
        mine = self.box_val[s["box"]]
        remaining = [v for n, v in self.box_val.items() if n not in self.gone and n not in self.sold]
        closed = self._closed()
        rnd = self.round_idx + 1
        # Every game offers at least one swap: a player is never made to play
        # the whole game with the box they drew. If none has come by the second
        # to last call (when there are still several boxes to choose from), it does.
        owed = (self.round_idx >= len(self.sizes) - 2
                and not any(o["kind"] == "swap" for o in s["offers"]))
        if closed and (owed or random.random() < self._swap_chance(s, mine, closed, remaining, final)):
            return {"kind": "swap", "mean": sum(self.box_val[n] for n in closed) / len(closed)}
        ev = sum(remaining) / len(remaining)
        progress = min(1.0, self.opened_count / max(1, self.total_open))
        share = 0.22 + 0.70 * progress ** 1.2
        q = (sum(1 for v in remaining if v < mine) + 0.5) / len(remaining)
        lean = (q - 0.5) * 0.5
        noise = random.uniform(-0.07, 0.07)
        amount = ev * share * (1 + lean + noise)
        amount = max(min(remaining), min(max(remaining) * 0.95, amount))
        return {"kind": "money", "amount": nice(amount)}

    async def _begin_offers(self):
        self.phase = "offer"
        self.turn_pid = None
        final = self.round_idx >= len(self.sizes) - 1
        self.pending = set()
        for pid in self.order:
            s = self.st[pid]
            s["answer"] = None
            s["offer"] = None
            if s["status"] != "playing":
                continue
            offer = self._make_offer(pid, final)
            offer["rnd"] = self.round_idx + 1
            offer["cur"] = s["box"]
            s["offer"] = offer
            s["offers"].append(offer)
            self.pending.add(pid)
        tok = self._arm(self.turn_time)
        await self.ctx.broadcast({
            "type": "dn_phase", "round": self.round_idx + 1, "rounds": len(self.sizes),
            "final": final, "pending": sorted(self.pending), "left": self.turn_time,
        })
        for pid in list(self.pending):
            await self.ctx.send(pid, self._offer_msg(pid))
        # Somebody who has stopped answering is not waited for.
        for pid in list(self.pending):
            if not self._active(pid):
                await self._answer(pid, False, True)
        if self.phase == "offer" and not self.pending:
            return
        if self.turn_time:
            self.ctx.schedule(self.turn_time + 1.0, lambda: self._offer_timeout(tok))

    def _offer_msg(self, pid):
        o = self.st[pid]["offer"]
        m = {"type": "dn_offer", "kind": o["kind"], "left": self._left(), "cur": o["cur"]}
        if o["kind"] == "money":
            m["amount"] = o["amount"]
        return m

    async def _offer_timeout(self, tok):
        if tok != self._tok or self.phase != "offer":
            return
        for pid in list(self.pending):
            self.st[pid]["idle"] += 1
            await self._answer(pid, False, True)

    async def _answer(self, pid, accept, auto):
        if pid not in self.pending:
            return
        s = self.st[pid]
        s["answer"] = accept
        if not auto:
            s["idle"] = 0
        self.pending.discard(pid)
        await self.ctx.broadcast({"type": "dn_ready", "pid": pid})
        if not self.pending:
            self._tok += 1
            self.ctx.schedule(CALL_PAUSE, self._resolve)

    async def _resolve(self):
        if self.over or self.phase != "offer":
            return
        deals, swaps = [], []
        rnd = self.round_idx + 1
        for pid in self.order:
            s = self.st[pid]
            o = s["offer"]
            if s["status"] != "playing" or o is None:
                continue
            o["accepted"] = False
            if s["answer"] and o["kind"] == "money":
                o["accepted"] = True
                box = s["box"]
                s["status"] = "dealt"
                s["amount"] = o["amount"]
                s["round"] = rnd
                self.sold.add(box)       # what it held stays a secret until the end
                deals.append({"pid": pid, "amount": o["amount"], "box": box})
            elif s["answer"] and o["kind"] == "swap":
                give, take = s["box"], s.get("swap_to")
                if take in self._closed():
                    o["accepted"] = True
                    s["box"] = take
                    s["swaps"].append((give, take))
                    swaps.append({"pid": pid, "give": give, "take": take})
            s["offer"] = None
        await self.ctx.broadcast({
            "type": "dn_resolved", "round": rnd, "deals": deals, "swaps": swaps,
        })
        final = self.round_idx >= len(self.sizes) - 1
        wait = 0.8 + EVENT_PAUSE * (len(deals) + len(swaps))
        if final or not self._playing():
            self.ctx.schedule(wait + 0.6, self._finish)
            return
        self.ctx.schedule(wait, self._next_round)

    async def _next_round(self):
        if self.over:
            return
        self.phase = "open"
        self.round_idx += 1
        self.left_in_round = self.sizes[self.round_idx]
        self.open_ptr = (self.open_ptr + 1) % len(self.order)
        await self._open_turn()

    # ── the end ──────────────────────────────────────────────────────────────

    def _bonuses(self, pid):
        """[(name, percent)] — what this player earned for reading the game."""
        s = self.st[pid]
        offers = s["offers"]
        got = []
        money = [o for o in offers if o["kind"] == "money"]
        final_val = self.box_val[s["box"]]
        if s["status"] == "dealt":
            # sold for more than the box held
            got.append(("smart", merit(s["amount"] / final_val, 0.8, 3, 9, 30)))
            # sold near the best offer of the call history (needs a few calls)
            if len(money) >= 3:
                r = s["amount"] / max(o["amount"] for o in money)
                got.append(("peak", 18 * max(0.0, min(1.0, (r - 0.7) / 0.3))))
        else:
            refused = [o["amount"] for o in money if not o.get("accepted")]
            if refused:
                got.append(("trust", merit(final_val / max(refused), 0.75, 4, 12, 35)))
        if s["swaps"]:
            first = self.box_val[s["swaps"][0][0]]
            got.append(("swap", merit(final_val / first, 0.8, 2, 8, 25)))
        trap = sum(merit(self.box_val[o["cur"]] / max(1, o["mean"]), 0.8, 2, 6, 15)
                   for o in offers if o["kind"] == "swap" and not o.get("accepted"))
        got.append(("trap", min(15, trap)))
        return [(k, int(round(v))) for k, v in got if round(v) >= 1]

    def _compute_results(self):
        rows = []
        for pid in self.order:
            s = self.st[pid]
            held = s["box"]
            amount = s["amount"] if s["status"] == "dealt" else self.box_val[held]
            got = self._bonuses(pid)
            pct = min(BONUS_CAP, sum(p for _, p in got))
            refused = sum(1 for o in s["offers"] if not o.get("accepted"))
            rows.append({
                "player_id": pid, "display_name": self._name(pid),
                "status": s["status"], "amount": amount, "box": held,
                "box_value": self.box_val[held], "round": s["round"],
                "bonuses": [{"id": k, "pct": p} for k, p in got], "bonus_pct": pct,
                "score": round(amount * (1 + pct / 100.0)),
                "refused": refused,
            })
        rows.sort(key=lambda r: (-r["score"], -r["amount"]))
        return rows

    async def _finish(self):
        if self.over:
            return
        self.over = True
        self.phase = "over"
        self._tok += 1
        rows = self._compute_results()
        self.reveal = [[n, v] for n, v in sorted(self.box_val.items()) if n not in self.gone]
        await self.ctx.broadcast({"type": "dn_over", "results": rows, "reveal": self.reveal})
        multi = len(rows) > 1
        records = []
        for rank, r in enumerate(rows, 1):
            records.append({
                "player_id": r["player_id"],
                "score": r["score"],
                "rank": rank,
                "is_winner": multi and rank == 1,
                "stats": {
                    "winnings": r["amount"], "bonus_pct": r["bonus_pct"],
                    "offers_refused": r["refused"],
                },
            })
        self.results = rows
        await self.ctx.finish(records, metadata={"time": self.turn_time, "players": len(rows)},
                              stats={"boxes": TOTAL})

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _state_msg(self, pid):
        players = []
        for p in self.order:
            s = self.st[p]
            players.append({
                "pid": p, "status": s["status"], "amount": s["amount"], "round": s["round"],
                "box": s["box"] if (s["box"] is not None and s["status"] == "playing") else None,
                "ready": self.phase == "offer" and s["status"] == "playing" and p not in self.pending,
            })
        msg = {
            "type": "dn_state",
            "values": sorted(VALUES), "low": LOW, "total": TOTAL,
            "time": self.turn_time, "order": self.order, "phase": self.phase,
            "turn": self.turn_pid, "left": self._left(),
            "gone": [[n, self.box_val[n]] for n in sorted(self.gone)],
            "sold": sorted(self.sold),
            "players": players,
            "round": self.round_idx + 1 if self.phase in ("open", "offer") else 0,
            "rounds": len(self.sizes), "to_open": self.left_in_round,
            "final": self.round_idx >= len(self.sizes) - 1,
            "over": self.over,
        }
        if self.over:
            msg["results"] = self.results
            msg["reveal"] = self.reveal
        if pid and self.phase == "offer" and pid in self.pending and self.st[pid].get("offer"):
            msg["offer"] = self._offer_msg(pid)
        return msg
