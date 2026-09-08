"""Server-authoritative rules for Score Arena."""
import random
import time

CRICKET_TARGETS = (20, 19, 18, 17, 16, 15, 25)

BITCOIN_NUMBERS = tuple(range(1, 21))
BITCOIN_BULL = 25
BITCOIN_DOUBLE_BULL = 50
BITCOIN_TOTAL_BLOCKS = 21 * 6
BITCOIN_REWARD_LEVELS = (50, 25, 12.5, 6.25, 3.125, 1.5625)
BITCOIN_DIFFICULTY_RULES = {
    1: (("single", 3),),
    2: (("single", 2), ("double", 1)),
    3: (("single", 1), ("double", 2)),
    4: (("double", 3),),
    5: (("single", 1), ("double", 1), ("triple", 1)),
    6: (("double", 2), ("triple", 1)),
    7: (("double", 1), ("triple", 2)),
    8: (("triple", 3),),
}


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.started = False
        self.started_at = 0.0
        self.mode = "501"
        self.target_wins = 1
        self.order = []
        self.turn_index = 0
        self.players = {}
        self.history = []
        self.round_no = 1
        self.finished = False
        self.dice = {}
        self.difficulty = 1
        self.block_count = 1
        self.total_blocks = 0
        self.halving_reward = BITCOIN_REWARD_LEVELS[0]
        self.halving_count = 0
        self.targets = []

    async def on_start(self, settings):
        roster = self.ctx.all_players()
        if len(roster) < 1:
            return
        saved = self.ctx.saved_state if len(roster) <= 1 else None
        if isinstance(saved, dict):
            self._restore(saved)
            await self.ctx.broadcast(self._state("sa_start"))
            return
        self.mode = settings.get("mode") if settings.get("mode") in ("501", "cricket", "bitcoin") else "501"
        self.target_wins = max(1, min(7, int(settings.get("target_wins", 1))))
        ids = [p["id"] for p in roster]
        method = settings.get("order", "lobby")
        if method == "dice":
            rolls = sorted(((random.randint(1, 6), random.random(), pid) for pid in ids), reverse=True)
            self.order = [pid for _, _, pid in rolls]
            self.dice = {pid: roll for roll, _, pid in rolls}
        elif method == "manual" and settings.get("first_player_id") in ids:
            first = settings["first_player_id"]
            self.order = [first] + [pid for pid in ids if pid != first]
        else:
            self.order = ids
        self.players = {pid: self._fresh_player() for pid in ids}
        self.started = True
        self.started_at = time.time()
        if self.mode == "bitcoin":
            self.targets = self._generate_targets()
        await self.ctx.broadcast(self._state("sa_start"))

    def snapshot(self):
        """Save & exit, asked for by the framework — solo only."""
        if len(self.ctx.all_players()) > 1 or self.finished or not self.started:
            return None
        return {
            "mode": self.mode, "target_wins": self.target_wins, "order": self.order,
            "turn_index": self.turn_index, "players": self.players, "history": self.history,
            "round_no": self.round_no, "dice": self.dice, "started_at": self.started_at,
            "difficulty": self.difficulty, "block_count": self.block_count, "total_blocks": self.total_blocks,
            "halving_reward": self.halving_reward, "halving_count": self.halving_count, "targets": self.targets,
        }

    def _restore(self, data):
        self.mode = data.get("mode", "501")
        self.target_wins = data.get("target_wins", 1)
        self.order = data.get("order", [])
        self.turn_index = data.get("turn_index", 0)
        self.players = data.get("players", {})
        self.history = data.get("history", [])
        self.round_no = data.get("round_no", 1)
        self.dice = data.get("dice", {})
        self.started_at = data.get("started_at", time.time())
        self.difficulty = data.get("difficulty", 1)
        self.block_count = data.get("block_count", 1)
        self.total_blocks = data.get("total_blocks", 0)
        self.halving_reward = data.get("halving_reward", BITCOIN_REWARD_LEVELS[0])
        self.halving_count = data.get("halving_count", 0)
        self.targets = data.get("targets", [])
        self.started = True

    async def on_join(self, player):
        if self.started:
            await self.ctx.send(player["id"], self._state("sa_state"))

    async def on_leave(self, player):
        await self.ctx.broadcast({"type": "sa_presence", "player_id": player["id"], "connected": False})

    async def on_message(self, player, msg):
        if msg.get("type") != "sa_turn" or not self.started or self.finished:
            return
        darts = self._clean_darts(msg.get("darts"))
        if not darts:
            await self.ctx.send(player["id"], {"type": "sa_error", "message": "empty_turn"})
            return
        current = self.order[self.turn_index]
        if self.mode == "bitcoin":
            await self._resolve_bitcoin(darts, player["id"])
            return
        result = self._play_501(current, darts) if self.mode == "501" else self._play_cricket(current, darts)
        result.update({"player_id": current, "entered_by": player["id"], "darts": darts, "round": self.round_no})
        self.history.append(result)

        winner = result.get("round_winner")
        if winner:
            self.players[winner]["wins"] += 1
            if self.players[winner]["wins"] >= self.target_wins:
                await self._finish(winner)
                return
            self.round_no += 1
            self._reset_round()
        else:
            self.turn_index = (self.turn_index + 1) % len(self.order)
        await self.ctx.broadcast(self._state("sa_state", last=result))

    def _fresh_player(self):
        return {"remaining": 501, "score": 0, "marks": {str(n): 0 for n in CRICKET_TARGETS}, "wins": 0,
                "round_darts": 0, "metrics": {"darts": 0, "points": 0, "turns": 0, "checkout_attempts": 0,
                "checkout_hits": 0, "highest_checkout": 0, "best_leg_darts": 0, "scores_100": 0,
                "scores_140": 0, "scores_180": 0, "marks_total": 0, "mark_5": 0, "mark_6": 0,
                "mark_7": 0, "mark_8": 0, "mark_9": 0, "three_triples": 0, "perfect_games": 0}}

    def _clean_darts(self, darts):
        out = []
        if not isinstance(darts, list):
            return out
        for dart in darts[:3]:
            if not isinstance(dart, dict):
                continue
            number = int(dart.get("number", 0))
            multiplier = int(dart.get("multiplier", 0))
            checkout_attempt = bool(dart.get("checkout_attempt", False))
            if number == 0 and multiplier == 0:
                out.append({"number": 0, "multiplier": 0, "checkout_attempt": checkout_attempt})
            elif number == 25 and multiplier in (1, 2):
                out.append({"number": 25, "multiplier": multiplier, "checkout_attempt": checkout_attempt})
            elif 1 <= number <= 20 and multiplier in (1, 2, 3):
                out.append({"number": number, "multiplier": multiplier, "checkout_attempt": checkout_attempt})
        return out

    def _play_501(self, pid, darts):
        start = self.players[pid]["remaining"]
        remaining = start
        bust = False
        won = False
        used = []
        metrics = self.players[pid]["metrics"]
        for dart in darts:
            used.append(dart)
            metrics["darts"] += 1
            self.players[pid]["round_darts"] += 1
            if dart.get("checkout_attempt"):
                metrics["checkout_attempts"] += 1
            remaining -= dart["number"] * dart["multiplier"]
            if remaining < 0 or remaining == 1:
                bust = True
                break
            if remaining == 0:
                if dart["multiplier"] == 2:
                    won = True
                    if not dart.get("checkout_attempt"):
                        metrics["checkout_attempts"] += 1
                    metrics["checkout_hits"] += 1
                    metrics["highest_checkout"] = max(metrics["highest_checkout"], start)
                else:
                    bust = True
                break
        if bust:
            remaining = start
        scored = 0 if bust else start - remaining
        metrics["turns"] += 1
        metrics["points"] += scored
        if scored == 180:
            metrics["scores_180"] += 1
        if scored >= 140:
            metrics["scores_140"] += 1
        if scored >= 100:
            metrics["scores_100"] += 1
        if won:
            leg_darts = self.players[pid]["round_darts"]
            best = metrics["best_leg_darts"]
            metrics["best_leg_darts"] = leg_darts if not best else min(best, leg_darts)
        self.players[pid]["remaining"] = remaining
        return {"kind": "501", "before": start, "after": remaining, "bust": bust,
                "scored": scored, "used": used,
                "round_winner": pid if won else None}

    def _play_cricket(self, pid, darts):
        gained = 0
        changes = []
        round_marks = 0
        metrics = self.players[pid]["metrics"]
        for dart in darts:
            metrics["darts"] += 1
            self.players[pid]["round_darts"] += 1
            number = dart["number"]
            if number not in CRICKET_TARGETS:
                continue
            round_marks += dart["multiplier"]
            key = str(number)
            before = self.players[pid]["marks"][key]
            marks = dart["multiplier"]
            needed = max(0, 3 - before)
            closing = min(needed, marks)
            extra = marks - closing
            self.players[pid]["marks"][key] = min(3, before + marks)
            if extra and any(self.players[other]["marks"][key] < 3 for other in self.order if other != pid):
                points = extra * number
                self.players[pid]["score"] += points
                gained += points
            changes.append({"number": number, "marks": marks})
        metrics["turns"] += 1
        metrics["marks_total"] += round_marks
        if 5 <= round_marks <= 9:
            metrics[f"mark_{round_marks}"] += 1
        if len(darts) == 3 and all(d["number"] in CRICKET_TARGETS and d["multiplier"] == 3 for d in darts):
            metrics["three_triples"] += 1
        closed_all = all(self.players[pid]["marks"][str(n)] >= 3 for n in CRICKET_TARGETS)
        leads = all(self.players[pid]["score"] >= self.players[other]["score"] for other in self.order if other != pid)
        if closed_all and leads and self.players[pid]["round_darts"] <= 8:
            metrics["perfect_games"] += 1
        return {"kind": "cricket", "scored": gained, "changes": changes,
                "round_winner": pid if closed_all and leads else None}

    def _generate_targets(self):
        rule = BITCOIN_DIFFICULTY_RULES[self.difficulty]
        out = []
        for kind, count in rule:
            for _ in range(count):
                if kind == "double" and random.random() < 0.1:
                    out.append({"type": "double", "number": BITCOIN_BULL})
                elif kind == "triple" and random.random() < 0.1:
                    out.append({"type": "triple", "number": BITCOIN_DOUBLE_BULL})
                else:
                    out.append({"type": kind, "number": random.choice(BITCOIN_NUMBERS)})
        return out

    def _target_multiplier(self, kind):
        return {"single": 1, "double": 2, "triple": 3}[kind]

    def _dart_matches(self, dart, target):
        if target["number"] in (BITCOIN_BULL, BITCOIN_DOUBLE_BULL):
            if target["number"] == BITCOIN_BULL:
                return dart["number"] == 25 and dart["multiplier"] == 1
            return dart["number"] == 25 and dart["multiplier"] == 2
        return dart["number"] == target["number"] and dart["multiplier"] == self._target_multiplier(target["type"])

    async def _resolve_bitcoin(self, darts, entered_by):
        pid = self.order[self.turn_index]
        remaining = list(self.targets)
        used = []
        for dart in darts:
            match = next((t for t in remaining if self._dart_matches(dart, t)), None)
            if match:
                remaining.remove(match)
            used.append(dart)
        hit = not remaining
        reward = self.halving_reward if hit else 0
        if hit:
            self.players[pid]["score"] += reward
            self.difficulty = min(8, self.difficulty + 1)
        else:
            self.difficulty = max(1, self.difficulty - 1)
        result = {"kind": "bitcoin", "player_id": pid, "entered_by": entered_by, "darts": used,
                  "round": self.round_no, "targets": self.targets, "hit": hit, "scored": reward,
                  "block": self.block_count, "difficulty": self.difficulty}
        self.history.append(result)

        if hit and not self._can_catch_up():
            await self._finish_bitcoin()
            return

        self.turn_index = (self.turn_index + 1) % len(self.order)
        self.block_count += 1
        self.total_blocks += 1
        if self.block_count > 21:
            self.block_count = 1
            new_reward = self.halving_reward / 2
            self.halving_reward = max(BITCOIN_REWARD_LEVELS[-1], new_reward)
            if new_reward < BITCOIN_REWARD_LEVELS[-1]:
                self.halving_count += 1
            if self.halving_reward == BITCOIN_REWARD_LEVELS[-1] and self.halving_count >= 1:
                await self._finish_bitcoin()
                return
        self.targets = self._generate_targets()
        await self.ctx.broadcast(self._state("sa_state", last=result))

    def _max_possible_score(self):
        remaining_blocks = BITCOIN_TOTAL_BLOCKS - self.total_blocks
        max_score = 0
        current_cycle = 0 if self.total_blocks == 0 else (self.total_blocks - 1) // 21
        used_in_cycle = 0 if self.total_blocks == 0 else (self.total_blocks - 1) % 21 + 1
        remaining_in_cycle = 21 - used_in_cycle
        if remaining_blocks > 0 and current_cycle < len(BITCOIN_REWARD_LEVELS):
            take = min(remaining_blocks, remaining_in_cycle)
            max_score += take * BITCOIN_REWARD_LEVELS[current_cycle]
            remaining_blocks -= take
        current_cycle += 1
        while remaining_blocks > 0 and current_cycle < len(BITCOIN_REWARD_LEVELS):
            take = min(remaining_blocks, 21)
            max_score += take * BITCOIN_REWARD_LEVELS[current_cycle]
            remaining_blocks -= take
            current_cycle += 1
        return max_score

    def _can_catch_up(self):
        if len(self.order) <= 1:
            return True
        scores = sorted((self.players[pid]["score"] for pid in self.order), reverse=True)
        return (scores[0] - scores[1]) <= self._max_possible_score()

    async def _finish_bitcoin(self):
        self.finished = True
        standings = sorted(self.order, key=lambda pid: self.players[pid]["score"], reverse=True)
        winner = standings[0]
        records = [{"player_id": pid, "score": self.players[pid]["score"], "rank": i + 1, "is_winner": pid == winner}
                   for i, pid in enumerate(standings)]
        await self.ctx.broadcast(self._state("sa_finished", winner=winner))
        await self.ctx.finish(records, metadata={"scorearena_mode": self.mode, "rounds": self.round_no,
                                                  "turns": len(self.history), "winner": winner,
                                                  "turn_history": self.history})

    def _reset_round(self):
        for pid in self.order:
            wins = self.players[pid]["wins"]
            metrics = self.players[pid]["metrics"]
            self.players[pid] = self._fresh_player()
            self.players[pid]["wins"] = wins
            self.players[pid]["metrics"] = metrics
        self.turn_index = (self.round_no - 1) % len(self.order)

    async def _finish(self, winner):
        self.finished = True
        standings = sorted(self.order, key=lambda pid: (self.players[pid]["wins"], self.players[pid].get("score", 0)), reverse=True)
        records = [{"player_id": pid, "score": self.players[pid]["wins"], "rank": i + 1, "is_winner": pid == winner}
                   for i, pid in enumerate(standings)]
        await self.ctx.broadcast(self._state("sa_finished", winner=winner))
        player_stats = {}
        for pid in self.order:
            m = dict(self.players[pid]["metrics"])
            m["three_dart_average"] = round((m["points"] / m["darts"] * 3) if m["darts"] else 0, 2)
            m["checkout_rate"] = round((m["checkout_hits"] / m["checkout_attempts"] * 100) if m["checkout_attempts"] else 0, 2)
            m["mpr"] = round((m["marks_total"] / m["turns"]) if m["turns"] else 0, 2)
            m["wins"] = self.players[pid]["wins"]
            player_stats[pid] = m
        await self.ctx.finish(records, metadata={"scorearena_mode": self.mode, "rounds": self.round_no,
                                                  "turns": len(self.history), "winner": winner,
                                                  "player_stats": player_stats, "turn_history": self.history})

    def _state(self, kind, **extra):
        roster = {p["id"]: {k: p.get(k) for k in ("id", "display_name", "avatar_color", "avatar_svg", "connected")}
                  for p in self.ctx.all_players()}
        return {"type": kind, "mode": self.mode, "target_wins": self.target_wins, "order": self.order,
                "turn_index": self.turn_index, "current_player_id": self.order[self.turn_index] if self.order else None,
                "players": self.players, "roster": roster, "history": self.history[-20:], "round": self.round_no,
                "dice": self.dice, "targets": self.targets, "difficulty": self.difficulty,
                "block_count": self.block_count, "halving_reward": self.halving_reward,
                "halving_count": self.halving_count, "total_blocks": self.total_blocks, **extra}
