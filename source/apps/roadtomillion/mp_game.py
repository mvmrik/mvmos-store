"""
Road to a Million — the server half of the game.

Loaded by Game Hub's multiplayer framework by convention (mp_game.py exposing
`Game(ctx)`). The framework owns rooms, sockets, identity and writing the
finished session; everything here is this game's rules.

Twenty questions, easy to hard, the last one worth one million (a plain number,
no currency). Every player who is still in answers the SAME question. A player
can answer, walk away with the sum reached, or use one of three lifelines:

  fifty      removes two wrong answers
  specialist asks one of the three specialists chosen before the game
  country    polls a foreigner from one of three countries (never the player's own) chosen before the game

The server owns the questions: the bank (questions in public/q/) says, for each
one, how hard it is, how likely a person from each country is to know it and
how likely each of the ten specialists is to know it. Answers are shuffled per
question and only the shuffle goes to the browsers, which show the text from
their own language file.

  client → server
    rm_pick   {lang, specs, countries}   choices before the first question
    rm_answer {pos}                            answer with the shown position
    rm_quit                                    take the sum reached
    rm_joker  {kind, who}                      kind fifty | specialist | country

  server → client
    rm_state, rm_picked, rm_q, rm_used, rm_joker_res, rm_ready, rm_reveal, rm_over
"""

import importlib.util
import json
import sys
import math
import os
import random
import time

HERE = os.path.dirname(os.path.abspath(__file__))

LADDER = [100, 200, 300, 500, 1000,
          1500, 2000, 3000, 5000, 7500,
          10000, 15000, 20000, 30000, 50000,
          75000, 100000, 150000, 300000, 1000000]
LEVELS = len(LADDER)
SAFE_EVERY = 5

LANG_COUNTRY = {"bg": "BG", "de": "DE", "en": "US", "es": "ES", "fr": "FR",
                "ja": "JP", "pt-BR": "BR", "ru": "RU", "zh-CN": "CN"}
COUNTRIES = ["BG", "DE", "US", "ES", "FR", "JP", "BR", "RU", "CN"]
PROFESSIONS = ["math", "history", "medicine", "astronomy", "law",
               "geography", "engineering", "literature", "arts", "sport"]

TIME_CHOICES = (20, 30, 45, 60, 90)
DEFAULT_TIME = 45
PICK_TIME = 60
REVEAL_PAUSE = 4.5


def _load_bank_module():
    mod = sys.modules.get("roadtomillion_bank")
    if mod is None:
        spec = importlib.util.spec_from_file_location("roadtomillion_bank", os.path.join(HERE, "bank.py"))
        mod = importlib.util.module_from_spec(spec)
        sys.modules["roadtomillion_bank"] = mod
        spec.loader.exec_module(mod)
    return mod


def _bank():
    """The playable questions, read from the app's database every time a room starts."""
    try:
        return _load_bank_module().game_bank()
    except Exception as e:
        print(f"[roadtomillion] bank not readable: {e}")
        return []


def _text_for(qid, lang):
    try:
        return _load_bank_module().text(qid, lang)
    except Exception as e:
        print(f"[roadtomillion] question text not readable: {e}")
        return None


def amount_for(level):
    if level <= 0:
        return 0
    cycle, index = divmod(level - 1, LEVELS)
    return cycle * LADDER[-1] + LADDER[index]


def safe_amount(answered):
    """The sum a player keeps when the next question is missed."""
    n = (answered // SAFE_EVERY) * SAFE_EVERY
    return amount_for(n)


def eff_difficulty(q, country):
    """How hard the question is for someone from `country`: the base difficulty
    moved by how much better or worse than the average that country knows it.
    A question may set its own difficulty for a country (dc): that one is used as it is."""
    k = q.get("k") or []
    d = int(q.get("d", 10))
    own = (q.get("dc") or {}).get(country)
    if own:
        return float(max(1, min(LEVELS, int(own))))      # the question says how hard it is for this country
    if len(k) != len(COUNTRIES) or country not in COUNTRIES:
        return float(d)
    mean = sum(k) / len(k)
    return max(1.0, min(float(LEVELS), d + (mean - k[COUNTRIES.index(country)]) / 10.0))


def specialist_advice(p, opts, correct):
    """What a specialist says. `p` is the chance (percent) that he knows the
    answer. One roll decides everything: under p he knows and the more room
    there is the surer he sounds; over p he can only guess, and at the far end
    he says he does not know."""
    r = random.randint(1, 100)
    if r <= p:
        ratio = r / max(1, p)
        kind = "sure" if ratio <= 0.5 else ("pretty" if ratio <= 0.85 else "think")
        return {"say": kind, "pick": correct}
    if r >= 100 - (100 - p) * 0.35 or r == 100:
        return {"say": "none", "pick": None}
    n = len(opts)
    q = 1.0 / n + (1 - 1.0 / n) * 0.6 * p / 100.0
    if random.random() < q:
        return {"say": "maybe", "pick": correct}
    wrong = [o for o in opts if o != correct]
    return {"say": "maybe", "pick": random.choice(wrong)}


def country_poll(p, opts, correct):
    """A hundred people are asked. Each one who knows votes right; the others
    guess among what is left."""
    votes = {o: 0 for o in opts}
    for _ in range(100):
        if random.randint(1, 100) <= p:
            votes[correct] += 1
        else:
            votes[random.choice(opts)] += 1
    return votes


def _int(v, default, lo, hi):
    try:
        v = int(v)
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.solo = False
        self.started = False
        self.over = False
        self.phase = "pick"          # pick | question | reveal | over
        self.turn_time = 0
        self.bank = _bank()
        self.order = []
        self.st = {}
        self.level = 0               # 1..20 once questions start
        self.q = None
        self.perm = []               # display position -> index in the answer list (0 = right)
        self.deadline = 0.0
        self._tok = 0
        self.used_ids = set()
        self.last_cat = None
        self.results = None
        self.qstart = 0.0
        self.reveal_msg = None

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        t = _int(settings.get("time"), DEFAULT_TIME, 10, 120)
        self.turn_time = min(TIME_CHOICES, key=lambda c: abs(c - t))
        ids = [p["id"] for p in self.ctx.all_players()]
        random.shuffle(ids)
        self.order = ids
        self.solo = len(ids) == 1
        if len(ids) < 2:
            self.turn_time = 0       # alone: nobody to wait for, no clock
        for pid in ids:
            self.st[pid] = {
                "status": "pick", "lang": "en", "specs": [], "countries": [],
                "answered": 0, "amount": 0, "jokers": set(), "removed": [], "advice": [],
                "choice": None, "times": [], "against": 0, "idle": 0,
                "unhelped_streak": 0, "best_unhelped_streak": 0,
                "pos": None, "log": [],
            }
        self.started = True
        await self.ctx.broadcast(self._state_msg(None))
        if self.turn_time:
            tok = self._arm(PICK_TIME)
            self.ctx.schedule(PICK_TIME + 1.0, lambda: self._pick_timeout(tok))

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
        if pid not in self.st:
            return
        if t == "rm_lang":
            # the player's language, told as soon as the page opens, so that even a
            # player who lets the choosing time run out gets the questions in it
            if msg.get("lang") in LANG_COUNTRY:
                self.st[pid]["lang"] = msg["lang"]
        elif t == "rm_pick" and self.phase == "pick":
            await self._pick(pid, msg)
        elif self.phase == "question" and self.st[pid]["status"] == "playing":
            if t == "rm_answer":
                await self._answer(pid, msg.get("pos"))
            elif t == "rm_quit":
                await self._quit(pid)
            elif t == "rm_joker":
                await self._joker(pid, msg)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _arm(self, seconds):
        self._tok += 1
        self.deadline = time.time() + seconds
        return self._tok

    def _left(self):
        return max(0, round(self.deadline - time.time())) if self.deadline else 0

    def _name(self, pid):
        for p in self.ctx.all_players():
            if p["id"] == pid:
                return p.get("display_name", "")
        return ""

    def _active(self):
        return [p for p in self.order if self.st[p]["status"] == "playing"]

    def _foreign(self, pid):
        """Countries a player may ask: every one except their own."""
        own = self._country(pid)
        return [c for c in COUNTRIES if c != own]

    def _country(self, pid):
        return LANG_COUNTRY.get(self.st[pid]["lang"], "US")

    # ── choices before the game ──────────────────────────────────────────────

    async def _pick(self, pid, msg):
        s = self.st[pid]
        if s["status"] != "pick":
            return
        lang = msg.get("lang")
        s["lang"] = lang if lang in LANG_COUNTRY else "en"
        s["specs"] = self._choose(msg.get("specs"), PROFESSIONS, 3)
        s["countries"] = self._choose(msg.get("countries"), self._foreign(pid), 3)
        s["status"] = "ready"
        await self.ctx.send(pid, {"type": "rm_mine", "specs": s["specs"], "countries": s["countries"]})
        await self.ctx.broadcast({"type": "rm_picked", "pid": pid})
        await self._maybe_begin()

    @staticmethod
    def _choose(raw, pool, n):
        out = []
        for x in raw if isinstance(raw, list) else []:
            if x in pool and x not in out:
                out.append(x)
        out = out[:n]
        rest = [x for x in pool if x not in out]
        random.shuffle(rest)
        return out + rest[: n - len(out)]

    async def _pick_timeout(self, tok):
        if tok != self._tok or self.phase != "pick":
            return
        for pid in self.order:
            if self.st[pid]["status"] == "pick":
                s = self.st[pid]
                s["specs"] = self._choose([], PROFESSIONS, 3)
                s["countries"] = self._choose([], self._foreign(pid), 3)
                s["status"] = "ready"
                await self.ctx.send(pid, {"type": "rm_mine", "specs": s["specs"], "countries": s["countries"]})
        await self._maybe_begin()

    async def _maybe_begin(self):
        if self.phase != "pick" or any(self.st[p]["status"] == "pick" for p in self.order):
            return
        self._tok += 1
        for pid in self.order:
            self.st[pid]["status"] = "playing"
        await self._next_question()

    # ── choosing and asking a question ───────────────────────────────────────

    def _pick_question(self):
        n = min(self.level, LEVELS)
        countries = [self._country(p) for p in self._active()] or ["US"]
        pool = [q for q in self.bank if q["id"] not in self.used_ids]
        if not pool:
            return None

        def eff(q):
            return sum(eff_difficulty(q, c) for c in countries) / len(countries)

        scored = []
        for q in pool:
            gap = abs(eff(q) - n)
            if q.get("c") == self.last_cat:
                gap += 0.8               # and the same subject twice in a row is avoided
            scored.append((gap + random.random() * 0.6, q))
        scored.sort(key=lambda x: x[0])
        return scored[0][1]

    async def _next_question(self):
        if self.over:
            return
        active = self._active()
        if not active or (not self.solo and self.level >= LEVELS):
            await self._finish()
            return
        self.level += 1
        q = self._pick_question()
        if q is None:
            self.level -= 1
            for pid in active:
                self.st[pid]["status"] = "exhausted"
            await self._finish()
            return
        self.q = q
        self.used_ids.add(q["id"])
        self.last_cat = q.get("c")
        self.perm = [0, 1, 2, 3]
        random.shuffle(self.perm)
        self.phase = "question"
        self.qstart = time.time()
        for pid in active:
            s = self.st[pid]
            s["choice"] = None
            s["removed"] = []
            s["advice"] = []
            s["log"] = []
            s["pos"] = None
        msg = {"type": "rm_q", "n": self.level, "id": q["id"], "perm": self.perm,
               "cat": q.get("c"), "time": self.turn_time}
        # The text goes with the question, in each player's own language.
        for p in self.ctx.all_players():
            await self.ctx.send(p["id"], dict(msg, text=self._q_text(p["id"])))
        if self.turn_time:
            tok = self._arm(self.turn_time)
            self.ctx.schedule(self.turn_time + 1.0, lambda: self._question_timeout(tok))
        else:
            self.deadline = 0.0

    def _q_text(self, pid):
        lang = (self.st.get(pid) or {}).get("lang") or "en"
        return _text_for(self.q["id"], lang) if self.q else None

    def _right_pos(self):
        return self.perm.index(0)

    def _options(self, pid):
        """The display positions this player can still choose from."""
        gone = set(self.st[pid]["removed"])
        return [i for i in range(4) if i not in gone]

    async def _question_timeout(self, tok):
        if tok != self._tok or self.phase != "question":
            return
        for pid in self._active():
            if self.st[pid]["choice"] is None:
                self.st[pid]["choice"] = "timeout"
                self.st[pid]["idle"] += 1
        await self._resolve()

    # ── what a player does ───────────────────────────────────────────────────

    async def _answer(self, pid, pos):
        s = self.st[pid]
        if s["choice"] is not None:
            return
        try:
            pos = int(pos)
        except (TypeError, ValueError):
            return
        if pos not in self._options(pid):
            return
        s["choice"] = "answer"
        s["pos"] = pos
        s["times"].append(time.time() - self.qstart)
        s["idle"] = 0
        await self.ctx.broadcast({"type": "rm_ready", "pid": pid})
        await self._maybe_resolve()

    async def _quit(self, pid):
        s = self.st[pid]
        if s["choice"] is not None:
            return
        s["choice"] = "quit"
        await self.ctx.broadcast({"type": "rm_ready", "pid": pid})
        await self._maybe_resolve()

    async def _maybe_resolve(self):
        if all(self.st[p]["choice"] is not None for p in self._active()):
            self._tok += 1
            await self._resolve()

    async def _joker(self, pid, msg):
        s = self.st[pid]
        kind = msg.get("kind")
        if s["choice"] is not None or kind not in ("fifty", "specialist", "country", "compass"):
            return
        if kind in s["jokers"]:
            return
        right = self._right_pos()
        opts = self._options(pid)
        if len(opts) <= 1:
            return
        q = self.q
        res = {"type": "rm_joker_res", "kind": kind, "n": self.level}
        if kind == "fifty":
            wrong = [i for i in opts if i != right]
            gone = random.sample(wrong, 2)
            s["removed"] = s["removed"] + gone
            res["removed"] = gone
        elif kind == "compass":
            try:
                pos = int(msg.get("pos"))
            except (TypeError, ValueError):
                return
            if pos not in opts:
                return
            correct = pos == right
            res.update({"pos": pos, "correct": correct})
            if not correct:
                s["removed"].append(pos)
        elif kind == "specialist":
            who = msg.get("who")
            if who not in s["specs"]:
                return
            sp = q.get("s") or []
            p = sp[PROFESSIONS.index(who)] if len(sp) == len(PROFESSIONS) else 40
            adv = specialist_advice(int(p), opts, right)
            res.update({"who": who, **adv})
            s["advice"].append(adv["pick"])
        else:
            who = msg.get("who")
            if who not in s["countries"]:
                return
            kk = q.get("k") or []
            p = kk[COUNTRIES.index(who)] if len(kk) == len(COUNTRIES) else 40
            votes = country_poll(int(p), opts, right)
            res.update({"who": who, "votes": {str(i): v for i, v in votes.items()}})
            top = max(votes, key=votes.get)
            s["advice"].append(top)
        s["jokers"].add(kind)
        s["log"].append(res)
        await self.ctx.send(pid, res)
        await self.ctx.broadcast({"type": "rm_used", "pid": pid, "kind": kind, "n": self.level})

    # ── the answer ───────────────────────────────────────────────────────────

    async def _resolve(self):
        if self.phase != "question":
            return
        self.phase = "reveal"
        right = self._right_pos()
        rows = []
        n = self.level
        for pid in list(self._active()):
            s = self.st[pid]
            ch = s["choice"]
            row = {"pid": pid, "pos": s["pos"], "action": None}
            if ch == "quit":
                s["status"] = "quit"
                s["amount"] = amount_for(n - 1)
                row["action"] = "quit"
            elif ch == "answer" and s["pos"] == right:
                s["answered"] += 1
                s["amount"] = amount_for(n)
                row["action"] = "right"
                if s["log"]:
                    s["unhelped_streak"] = 0
                else:
                    s["unhelped_streak"] += 1
                    s["best_unhelped_streak"] = max(s["best_unhelped_streak"], s["unhelped_streak"])
                if s["advice"] and any(a is not None and a != right for a in s["advice"]):
                    s["against"] += 1
                if n >= LEVELS and not self.solo:
                    s["status"] = "done"
            else:
                s["status"] = "out"
                s["amount"] = safe_amount(s["answered"])
                row["action"] = "wrong" if ch == "answer" else "timeout"
            row["amount"] = s["amount"]
            rows.append(row)
        for pid in self.order:
            s = self.st[pid]
            if s["status"] == "out" or (s["status"] == "playing" and s["idle"] >= 3):
                # a player who keeps missing the clock is let go with what is safe
                if s["status"] == "playing":
                    s["status"] = "out"
                    s["amount"] = safe_amount(s["answered"])
        self.reveal_msg = {"type": "rm_reveal", "n": n, "right": right, "rows": rows,
                           "more": bool(self._active()) and (self.solo or n < LEVELS)}
        await self.ctx.broadcast(self.reveal_msg)
        self.ctx.schedule(REVEAL_PAUSE, self._after_reveal)

    async def _after_reveal(self):
        if self.over:
            return
        if self._active() and (self.solo or self.level < LEVELS):
            await self._next_question()
        else:
            await self._finish()

    # ── the end ──────────────────────────────────────────────────────────────

    def _bonuses(self, pid):
        s = self.st[pid]
        got = []
        asked = len(s["times"])
        if asked >= 10:
            bonus = (("pure", 30), ("frugal", 20), ("thrifty", 10), ("careful", 5))
            used = len(s["jokers"])
            if used < len(bonus):
                got.append(bonus[used])
        if s["against"]:
            got.append(("own", min(10, 5 * s["against"])))
        if s["best_unhelped_streak"] >= 3:
            got.append(("streak", 2 * (s["best_unhelped_streak"] - 2)))
        return got

    def _compute_results(self):
        rows = []
        for pid in self.order:
            s = self.st[pid]
            got = self._bonuses(pid)
            pct = sum(p for _, p in got)
            rows.append({
                "player_id": pid, "display_name": self._name(pid),
                "status": s["status"], "amount": s["amount"], "answered": s["answered"],
                "jokers": len(s["jokers"]),
                "bonuses": [{"id": k, "pct": p} for k, p in got], "bonus_pct": pct,
                "score": round(s["amount"] * (1 + pct / 100.0)),
            })
        rows.sort(key=lambda r: (-r["score"], -r["answered"]))
        return rows

    async def _finish(self):
        if self.over:
            return
        self.over = True
        self.phase = "over"
        self._tok += 1
        for pid in self.order:
            s = self.st[pid]
            if s["status"] == "playing":
                s["status"] = "out"
                s["amount"] = safe_amount(s["answered"])
        rows = self._compute_results()
        self.results = rows
        await self.ctx.broadcast({"type": "rm_over", "results": rows})
        multi = len(rows) > 1
        records = []
        for rank, r in enumerate(rows, 1):
            records.append({
                "player_id": r["player_id"], "score": r["score"], "rank": rank,
                "is_winner": multi and rank == 1,
                "stats": {"winnings": r["amount"], "bonus_pct": r["bonus_pct"],
                          "questions": r["answered"], "jokers": r["jokers"]},
            })
        await self.ctx.finish(records, metadata={"time": self.turn_time, "players": len(rows)},
                              stats={"bank": len(self.bank)})

    # ── what a (re)joining browser needs ─────────────────────────────────────

    def _state_msg(self, pid):
        players = []
        for p in self.order:
            s = self.st[p]
            players.append({"pid": p, "status": s["status"], "amount": s["amount"],
                            "answered": s["answered"], "jokers": sorted(s["jokers"]),
                            "ready": s["choice"] is not None})
        msg = {"type": "rm_state", "ladder": LADDER, "safe": SAFE_EVERY,
               "countries": COUNTRIES, "professions": PROFESSIONS,
               "time": self.turn_time, "order": self.order, "phase": self.phase, "solo": self.solo,
               "left": self._left(), "players": players, "n": self.level, "over": self.over}
        if self.phase == "pick":
            msg["picked"] = [p for p in self.order if self.st[p]["status"] != "pick"]
        if pid and pid in self.st:
            s = self.st[pid]
            msg["mine"] = {"specs": s["specs"], "countries": s["countries"],
                           "used": sorted(s["jokers"]), "removed": s["removed"], "log": s["log"]}
        if self.phase in ("question", "reveal") and self.q:
            msg["q"] = {"n": self.level, "id": self.q["id"], "perm": self.perm,
                        "cat": self.q.get("c"), "time": self.turn_time,
                        "text": self._q_text(pid)}
        if self.phase == "reveal" and self.reveal_msg:
            msg["reveal"] = self.reveal_msg
        if self.over:
            msg["results"] = self.results
        return msg
