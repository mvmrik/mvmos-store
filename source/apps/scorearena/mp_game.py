"""Server-authoritative rules for Score Arena."""
import asyncio
import json
import os
import random
import sqlite3
import sys
import time

# mp_game.py is loaded by Game Hub via importlib.spec_from_file_location, so
# this directory is never on sys.path on its own — ghost.py needs it added
# explicitly to be importable as a plain sibling module.
_APP_DIR = os.path.dirname(__file__)
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from ghost import Ghost, skill_from_history
import sa_stats

CRICKET_TARGETS = (20, 19, 18, 17, 16, 15, 25)

# Breakdown: descending 20 -> 1, then Bull. Any multiplier on the current
# target breaks it down and advances to the next one.
BREAKDOWN_TARGETS = tuple(range(20, 0, -1)) + (25,)
# Around the Clock: ascending 1 -> 20, then Bull. Same any-multiplier rule.
ATC_TARGETS = tuple(range(1, 21)) + (25,)

GOLF_HOLE_COUNTS = {"progolf": 18, "minigolf": 9}

GHOST_ID = "__ghost__"
GHOST_HISTORY_LIMIT = 15
GHOST_DART_DELAY = 1.4  # seconds before each of the ghost's own darts, so the client can show them one by one
CUSTOM_LIMIT = 1_000_000
GHOST_TURN_PAUSE = 2.2  # seconds the finished turn stays on screen before its score is applied
# apps/scorearena/ -> repo root -> backend/apps/gamehub/data.db, the real Game
# Hub database (apps/gamehub/data.db is an unrelated stale empty file).
_GH_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "apps", "gamehub", "data.db")


# Ready-made board games. They run on the same engine as player-made custom games
# (one screen, the host types every turn's points in), but the rules come from here,
# never from the browser, and the stats are shared by everybody who plays them.
# mp.js keeps a copy of the numbers only to describe the rules before a match starts.
BOARD_GAMES = {
    "scrabble":      {"icon": "🔤", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "yahtzee":       {"icon": "🎲", "direction": "up",   "start": 0, "end": "rounds", "target": 0,     "rounds": 13, "winner": "high", "exact": False},
    "farkle":        {"icon": "🎰", "direction": "up",   "start": 0, "end": "target", "target": 10000, "rounds": 10, "winner": "high", "exact": False},
    "catan":         {"icon": "🏝️", "direction": "up",   "start": 0, "end": "target", "target": 10,    "rounds": 10, "winner": "high", "exact": False},
    "splendor":      {"icon": "💎", "direction": "up",   "start": 0, "end": "target", "target": 15,    "rounds": 10, "winner": "high", "exact": False},
    "dominoes":      {"icon": "⬛", "direction": "up",   "start": 0, "end": "target", "target": 100,   "rounds": 10, "winner": "high", "exact": False},
    "ticket":        {"icon": "🚂", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "carcassonne":   {"icon": "🏰", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "azul":          {"icon": "🔷", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "qwirkle":       {"icon": "🔶", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "wingspan":      {"icon": "🐦", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "kingdomino":    {"icon": "👑", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "monopoly":      {"icon": "🏦", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "high", "exact": False},
    "blokus":        {"icon": "🟦", "direction": "up",   "start": 0, "end": "manual", "target": 0,     "rounds": 10, "winner": "low",  "exact": False},
}
for _id, _rules in BOARD_GAMES.items():
    _rules["name"] = _id.capitalize()
    _rules["board"] = _id


def _clean_rules(raw):
    """Validates the rule set of a player-made custom game. Everything comes
    from the browser, so every field is coerced and clamped; returns None when
    the game has no usable name."""
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name") or "").strip()[:40]
    if not name:
        return None

    def num(key, default, lo=-CUSTOM_LIMIT, hi=CUSTOM_LIMIT):
        try:
            return max(lo, min(hi, int(raw.get(key, default))))
        except (TypeError, ValueError):
            return default

    direction = raw.get("direction") if raw.get("direction") in ("up", "down") else "up"
    end = raw.get("end") if raw.get("end") in ("target", "rounds", "manual") else "target"
    rules = {
        "name": name, "icon": (str(raw.get("icon") or "").strip()[:8] or "🎲"),
        "direction": direction, "start": num("start", 0), "end": end,
        "target": num("target", 0), "rounds": num("rounds", 10, 1, 99),
        "winner": raw.get("winner") if raw.get("winner") in ("high", "low") else "high",
        "exact": bool(raw.get("exact")),
    }
    # A target that can never be reached would make an endless game.
    if end == "target" and ((direction == "up" and rules["target"] <= rules["start"])
                            or (direction == "down" and rules["target"] >= rules["start"])):
        rules["end"] = "manual"
    return rules


def _profiles_for(ids):
    """Game Hub profiles of players who are picked into a custom game without
    being in the room. Ids the hub does not know are simply dropped, so nobody
    can be written into a match under a made-up identity."""
    out = {}
    if not ids:
        return out
    try:
        conn = sqlite3.connect(_GH_DB_PATH)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT id, display_name, avatar_color, avatar_svg FROM players WHERE id IN (%s)"
                            % ",".join("?" * len(ids)), list(ids)).fetchall()
        conn.close()
        for r in rows:
            out[str(r["id"])] = dict(r)
    except Exception:
        pass
    return out


def _ghost_skill_for(mode: str, player_id: str) -> float:
    """Reads this player's own recent Score Arena matches in this `mode` from the
    app's own statistics and derives a ghost skill from them (see ghost.py).
    Best effort: any hiccup just falls back to the module's mid-table default,
    never blocks starting a match."""
    try:
        stats = []
        for raw in sa_stats.recent_metadata(player_id, GHOST_HISTORY_LIMIT):
            meta = json.loads(raw or "{}")
            if meta.get("scorearena_mode") != mode:
                continue
            ps = (meta.get("player_stats") or {}).get(str(player_id))
            if ps:
                stats.append(ps)
        return skill_from_history(mode, stats)
    except Exception:
        return 0.5

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
        self.ghost = None                # Ghost instance, solo-vs-ghost matches only
        self.ghost_name = "Ghost"
        self.rules = None                # rule set of a custom game (mode "custom" only)
        self.owner_id = None             # who made that custom game
        self.owner_name = ""
        self.local = {}                  # profiles of players the host scores for, without them being in the room
        self._undo = None                # one-step undo for the last custom turn

    async def on_start(self, settings):
        roster = self.ctx.all_players()
        if len(roster) < 1:
            return
        saved = self.ctx.saved_state if len(roster) <= 1 else None
        if isinstance(saved, dict):
            self._restore(saved)
            await self.ctx.broadcast(self._state("sa_start"))
            await self._maybe_ghost_turn()
            return
        valid_modes = ("501", "301", "cricket", "bitcoin", "breakdown", "atc", "progolf", "minigolf", "custom")
        self.mode = settings.get("mode") if settings.get("mode") in valid_modes else "501"
        if self.mode == "custom":
            board = BOARD_GAMES.get(settings.get("board"))
            self.rules = dict(board) if board else _clean_rules(settings.get("rules"))
            self.owner_id = str(self.ctx.host_id)
            if not self.rules:
                self.mode = "501"
        # Golf is one full round of holes, no leg-repeat concept — force it
        # regardless of what the lobby's "first to N legs" setting says.
        self.target_wins = 1 if self.mode in ("progolf", "minigolf") else max(1, min(7, int(settings.get("target_wins", 1))))
        ids = [p["id"] for p in roster]
        if self.mode == "custom":
            # A custom game is played on one screen: the host keeps the score for
            # themselves and for the favourites they picked, nobody else has to join.
            host = str(self.ctx.host_id)
            picked = []
            for pid in settings.get("local_players") or []:
                pid = str(pid)
                if pid != host and pid not in picked:
                    picked.append(pid)
            profiles = _profiles_for(picked[:7])
            self.local = {pid: {"id": pid, "display_name": profiles[pid]["display_name"],
                                "avatar_color": profiles[pid]["avatar_color"], "avatar_svg": profiles[pid]["avatar_svg"],
                                "connected": True} for pid in picked if pid in profiles}
            self.owner_name = next((p.get("display_name") or "" for p in roster if str(p["id"]) == host), "")
            ids = [host] + list(self.local)
        # The ghost only ever makes sense heads-up against exactly one real
        # player — with two+ real players the humans are already the rivals.
        ghost_wanted = self.mode != "custom" and settings.get("opponent") == "ghost" and len(ids) == 1
        # The ghost is a real participant in the turn order, so dice and the
        # manual "who goes first" choice can put it ahead of the human.
        participants = ids + ([GHOST_ID] if ghost_wanted else [])
        method = settings.get("order", "lobby")
        if method == "dice":
            rolls = sorted(((random.randint(1, 6), random.random(), pid) for pid in participants), reverse=True)
            self.order = [pid for _, _, pid in rolls]
            self.dice = {pid: roll for roll, _, pid in rolls}
        elif method == "manual" and settings.get("first_player_id") in participants:
            first = settings["first_player_id"]
            self.order = [first] + [pid for pid in participants if pid != first]
        else:
            self.order = participants
        self.players = {pid: self._fresh_player() for pid in participants}
        if ghost_wanted:
            self.ghost = Ghost(_ghost_skill_for(self.mode, ids[0]))
        self.started = True
        self.started_at = time.time()
        if self.mode == "bitcoin":
            self.targets = self._generate_targets()
        await self.ctx.broadcast(self._state("sa_start"))
        await self._maybe_ghost_turn()

    def snapshot(self):
        """Save & exit, asked for by the framework — solo only."""
        if len(self.ctx.all_players()) > 1 or self.finished or not self.started:
            return None
        return {
            "mode": self.mode, "target_wins": self.target_wins, "order": self.order,
            "turn_index": self.turn_index, "players": self.players, "history": self.history,
            "round_no": self.round_no, "dice": self.dice, "started_at": self.started_at,
            "rules": self.rules, "owner_id": self.owner_id, "owner_name": self.owner_name, "local": self.local,
            "difficulty": self.difficulty, "block_count": self.block_count, "total_blocks": self.total_blocks,
            "halving_reward": self.halving_reward, "halving_count": self.halving_count, "targets": self.targets,
            "ghost": ({"base_skill": self.ghost.base_skill, "skill": self.ghost.skill,
                       "confidence": self.ghost.confidence} if self.ghost else None),
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
        self.rules = data.get("rules")
        self.owner_id = data.get("owner_id")
        self.owner_name = data.get("owner_name") or ""
        self.local = data.get("local") or {}
        gdata = data.get("ghost")
        if gdata:
            self.ghost = Ghost(gdata.get("base_skill", 0.5))
            self.ghost.skill = gdata.get("skill", self.ghost.skill)
            self.ghost.confidence = gdata.get("confidence", 0.0)
        self.started = True

    async def on_join(self, player):
        if self.started:
            await self.ctx.send(player["id"], self._state("sa_state"))

    async def on_leave(self, player):
        await self.ctx.broadcast({"type": "sa_presence", "player_id": player["id"], "connected": False})

    async def on_message(self, player, msg):
        if self.mode == "custom" and self.started and not self.finished:
            await self._custom_message(player, msg)
            return
        if msg.get("type") != "sa_turn" or not self.started or self.finished:
            return
        darts = self._clean_darts(msg.get("darts"))
        if not darts:
            await self.ctx.send(player["id"], {"type": "sa_error", "message": "empty_turn"})
            return
        current = self.order[self.turn_index]
        if current == GHOST_ID:
            return
        if self.mode == "bitcoin":
            await self._resolve_bitcoin(darts, player["id"])
            return
        result = self._play_turn(self.mode, current, darts)
        result.update({"player_id": current, "entered_by": player["id"], "darts": darts, "round": self.round_no})
        self.history.append(result)

        if self.mode in ("progolf", "minigolf"):
            if self._golf_all_done():
                await self._finish_golf()
                return
            self.turn_index = (self.turn_index + 1) % len(self.order)
            await self.ctx.broadcast(self._state("sa_state", last=result))
            await self._maybe_ghost_turn()
            return

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
        await self._maybe_ghost_turn()

    def _play_turn(self, mode, pid, darts):
        if mode in ("501", "301"):
            return self._play_501(pid, darts)
        if mode == "cricket":
            return self._play_cricket(pid, darts)
        if mode == "breakdown":
            return self._play_sequence(pid, darts, BREAKDOWN_TARGETS, "breakdown")
        if mode == "atc":
            return self._play_sequence(pid, darts, ATC_TARGETS, "atc")
        if mode in ("progolf", "minigolf"):
            hole_count = 18 if mode == "progolf" else 9
            return self._play_golf(pid, darts, hole_count)
        return self._play_cricket(pid, darts)

    async def _maybe_ghost_turn(self):
        """Auto-plays the ghost's turn the instant it's up, so from the real
        player's side it looks like an opponent moving on its own rather than
        something they have to prompt. Loops (round-reset can land back on the
        ghost immediately in a 1-real-player order) until either the match
        ends or play is back with the human."""
        while (self.ghost and self.started and not self.finished
               and self.order and self.order[self.turn_index] == GHOST_ID):
            await self._play_ghost_turn()

    async def _announce_ghost_dart(self, dart, index):
        """Broadcasts one ghost dart on its own, with a short pause before it,
        so the client can show it landing on the board and in the pending-dart
        strip before the whole turn resolves — instead of the score just
        jumping straight to the after-turn total."""
        await asyncio.sleep(GHOST_DART_DELAY)
        await self.ctx.broadcast({"type": "sa_ghost_dart", "dart": dart, "index": index})

    async def _play_ghost_turn(self):
        darts = []
        if self.mode in ("501", "301"):
            remaining = self.players[GHOST_ID]["remaining"]
            for i in range(3):
                d = self.ghost.dart_501(remaining)
                darts.append(d)
                await self._announce_ghost_dart(d, i)
                remaining -= d["number"] * d["multiplier"]
                if remaining <= 0:
                    break
        elif self.mode == "cricket":
            marks = self.players[GHOST_ID]["marks"]
            for i in range(3):
                open_targets = [n for n in CRICKET_TARGETS if marks[str(n)] < 3] or list(CRICKET_TARGETS)
                d = self.ghost.dart_cricket(open_targets)
                darts.append(d)
                await self._announce_ghost_dart(d, i)
        elif self.mode == "bitcoin":
            targets = list(self.targets)
            for i, t in enumerate(targets[:3]):
                d = self.ghost.dart_bitcoin(t)
                darts.append(d)
                await self._announce_ghost_dart(d, i)
            while len(darts) < 3:
                i = len(darts)
                d = self.ghost.dart_bitcoin(random.choice(self.targets))
                darts.append(d)
                await self._announce_ghost_dart(d, i)
        elif self.mode in ("breakdown", "atc"):
            targets = BREAKDOWN_TARGETS if self.mode == "breakdown" else ATC_TARGETS
            idx = self.players[GHOST_ID]["seq_index"]
            for i in range(3):
                target = targets[min(idx, len(targets) - 1)]
                d = self.ghost.dart_sequence(target)
                darts.append(d)
                await self._announce_ghost_dart(d, i)
                if d["number"] == target:
                    idx += 1
                    if idx >= len(targets):
                        break
        else:  # progolf / minigolf
            hole = self.players[GHOST_ID]["golf_hole"]
            for i in range(3):
                d = self.ghost.dart_golf(hole)
                darts.append(d)
                await self._announce_ghost_dart(d, i)
                if d["number"] == hole and d["multiplier"] == 2:
                    break

        # Let the last dart sink in before the score jumps, otherwise the whole
        # turn flashes past faster than the eye can follow.
        await asyncio.sleep(GHOST_TURN_PAUSE)

        if self.mode == "bitcoin":
            await self._resolve_bitcoin(darts, GHOST_ID)
            return

        result = self._play_turn(self.mode, GHOST_ID, darts)
        result.update({"player_id": GHOST_ID, "entered_by": GHOST_ID, "darts": darts, "round": self.round_no})
        self.history.append(result)
        good = result.get("scored", 0) >= (60 if self.mode in ("501", "301") else 4) or bool(result.get("round_winner"))
        self.ghost.react(good)

        if self.mode in ("progolf", "minigolf"):
            if self._golf_all_done():
                await self._finish_golf()
                return
            self.turn_index = (self.turn_index + 1) % len(self.order)
            await self.ctx.broadcast(self._state("sa_state", last=result))
            return

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

    # ── Custom games ─────────────────────────────────────────────────────
    # A player-made game is just a rule set (see _clean_rules): scores go up or
    # down from a start value, and it ends at a target, after N rounds, or when
    # the players say so. Everyone in the room plays by the host's rules.

    def _custom_key(self):
        if self.rules.get("board"):
            return f"board:{self.rules['board']}"
        return f"custom:{self.owner_id}:{self.rules['name'].lower()}"

    def _prefers_low(self):
        r = self.rules
        return r["direction"] == "down" if r["end"] == "target" else r["winner"] == "low"

    def _custom_leaders(self):
        pick = min if self._prefers_low() else max
        best = pick(self.players[pid]["score"] for pid in self.order)
        return [pid for pid in self.order if self.players[pid]["score"] == best]

    async def _custom_message(self, player, msg):
        if str(player["id"]) != str(self.owner_id):
            return
        kind = msg.get("type")
        if kind == "sa_custom_turn":
            try:
                value = int(msg.get("value"))
            except (TypeError, ValueError):
                await self.ctx.send(player["id"], {"type": "sa_error", "message": "empty_turn"})
                return
            if abs(value) > CUSTOM_LIMIT:
                return
            await self._custom_turn(self.order[self.turn_index], value, player["id"])
        elif kind == "sa_custom_undo":
            await self._custom_undo()
        elif kind == "sa_custom_end" and self.rules["end"] == "manual":
            if not any(self.players[pid]["round_darts"] for pid in self.order):
                return
            await self._custom_round_over(self._custom_leaders())

    async def _custom_turn(self, pid, value, entered_by):
        rules, state = self.rules, self.players[pid]
        metrics = state["metrics"]
        self._undo = {"pid": pid, "score": state["score"], "metrics": dict(metrics),
                      "turns": state["round_darts"], "turn_index": self.turn_index,
                      "history_len": len(self.history)}
        before = state["score"]
        after = before + (value if rules["direction"] == "up" else -value)
        bust = won = False
        if rules["end"] == "target":
            reached = after >= rules["target"] if rules["direction"] == "up" else after <= rules["target"]
            if reached:
                if rules["exact"] and after != rules["target"]:
                    bust, after = True, before
                else:
                    won = True
        state["score"] = after
        state["round_darts"] += 1
        metrics["turns"] += 1
        if not bust:
            metrics["points"] += value
            metrics["best_turn"] = max(metrics["best_turn"], value)
        result = {"kind": "custom", "before": before, "after": after, "value": value, "bust": bust,
                  "scored": 0 if bust else value, "round_winner": pid if won else None,
                  "player_id": pid, "entered_by": entered_by, "round": self.round_no}
        self.history.append(result)
        if won:
            await self._custom_round_over([pid])
            return
        self.turn_index = (self.turn_index + 1) % len(self.order)
        if rules["end"] == "rounds" and all(self.players[p]["round_darts"] >= rules["rounds"] for p in self.order):
            await self._custom_round_over(self._custom_leaders())
            return
        await self.ctx.broadcast(self._state("sa_state", last=result))

    async def _custom_undo(self):
        undo = self._undo
        if not undo or undo["history_len"] != len(self.history) - 1:
            return
        state = self.players[undo["pid"]]
        state["score"], state["metrics"], state["round_darts"] = undo["score"], undo["metrics"], undo["turns"]
        self.turn_index = undo["turn_index"]
        self.history.pop()
        self._undo = None
        await self.ctx.broadcast(self._state("sa_state"))

    async def _custom_round_over(self, winners):
        """One game of the match is decided. Ties share the win."""
        self._undo = None
        for pid in winners:
            self.players[pid]["wins"] += 1
        done = [pid for pid in winners if self.players[pid]["wins"] >= self.target_wins]
        if done:
            await self._finish(done[0], done)
            return
        self.round_no += 1
        self._reset_round()
        await self.ctx.broadcast(self._state("sa_state", last=self.history[-1] if self.history else None))

    def _fresh_player(self):
        start = 301 if self.mode == "301" else 501
        score = self.rules["start"] if self.mode == "custom" and self.rules else 0
        return {"remaining": start, "score": score, "marks": {str(n): 0 for n in CRICKET_TARGETS}, "wins": 0,
                "round_darts": 0, "seq_index": 0, "seq_turn_score": 0, "golf_hole": 0, "golf_done": False,
                "golf_strokes": [],
                "metrics": {"best_turn": 0, "darts": 0, "points": 0, "turns": 0, "checkout_attempts": 0,
                "checkout_hits": 0, "highest_checkout": 0, "best_leg_darts": 0, "scores_100": 0,
                "scores_140": 0, "scores_180": 0, "nine_darters": 0, "marks_total": 0, "mark_5": 0, "mark_6": 0,
                "mark_7": 0, "mark_8": 0, "mark_9": 0, "three_triples": 0, "perfect_games": 0,
                "blocks_mined": 0, "blocks_attempted": 0, "btc_earned": 0.0, "best_block_reward": 0.0,
                "mine_streak": 0, "best_mine_streak": 0, "bitcoin_darts": 0, "halvings_survived": 0,
                "best_difficulty": 1,
                "scores_80": 0, "scores_60": 0, "scores_40": 0, "perfect_breakdowns": 0,
                "finishes_8dart": 0,
                "golf_darts": 0, "golf_strokes_total": 0, "albatrosses": 0, "eagles": 0,
                "birdies": 0, "pars": 0, "bogeys": 0, "double_bogeys": 0}}

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
            min_darts = 6 if self.mode == "301" else 9
            if leg_darts <= min_darts:
                metrics["nine_darters"] += 1
        self.players[pid]["remaining"] = remaining
        return {"kind": self.mode, "before": start, "after": remaining, "bust": bust,
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

    def _play_sequence(self, pid, darts, targets, kind):
        """Breakdown / Around the Clock: a single shared sequence of targets
        (descending 20->1->Bull for Breakdown, ascending 1->20->Bull for ATC).
        Any multiplier on the current target breaks it down / advances the
        clock by one step; darts that don't match the current target just do
        nothing (no bust, no penalty — this game has no way to lose ground)."""
        metrics = self.players[pid]["metrics"]
        state = self.players[pid]
        used = []
        turn_score = 0
        won = False
        start_index = state["seq_index"]
        for dart in darts:
            used.append(dart)
            metrics["darts"] += 1
            state["round_darts"] += 1
            if state["seq_index"] >= len(targets):
                break
            target = targets[state["seq_index"]]
            if dart["number"] == target:
                turn_score += dart["number"] * dart["multiplier"]
                state["seq_index"] += 1
                if state["seq_index"] >= len(targets):
                    won = True
                    break
        metrics["turns"] += 1
        metrics["points"] += turn_score
        if kind == "breakdown":
            if turn_score >= 80:
                metrics["scores_80"] += 1
            elif turn_score >= 60:
                metrics["scores_60"] += 1
            elif turn_score >= 40:
                metrics["scores_40"] += 1
            metrics["highest_checkout"] = max(metrics["highest_checkout"], turn_score)
            if won:
                leg_darts = state["round_darts"]
                best = metrics["best_leg_darts"]
                metrics["best_leg_darts"] = leg_darts if not best else min(best, leg_darts)
                if leg_darts <= len(targets):
                    metrics["perfect_breakdowns"] += 1
        else:  # atc
            if won:
                leg_darts = state["round_darts"]
                best = metrics["best_leg_darts"]
                metrics["best_leg_darts"] = leg_darts if not best else min(best, leg_darts)
                if leg_darts <= 8:
                    metrics["finishes_8dart"] += 1
        return {"kind": kind, "before": start_index, "after": state["seq_index"], "used": used,
                "scored": turn_score, "round_winner": pid if won else None}

    def _golf_all_done(self):
        return all(self.players[pid]["golf_done"] for pid in self.order)

    def _play_golf(self, pid, darts, hole_count):
        """Pro Golf / Mini Golf: each hole is target number `golf_hole+1`,
        3 darts, only the single best dart counts (standard darts-golf rule).
        Stroke scale relative to par=3 (a single): double=1 (eagle, or
        albatross if it's holed on the very first dart), triple=2 (birdie),
        single=3 (par), a different number on the board=4 (bogey), a true
        miss=5 (double bogey)."""
        state = self.players[pid]
        metrics = self.players[pid]["metrics"]
        hole_number = state["golf_hole"] + 1
        best_stroke = 5
        best_label = "double_bogeys"
        used = []
        for i, dart in enumerate(darts):
            used.append(dart)
            metrics["golf_darts"] += 1
            if dart["number"] == hole_number and dart["multiplier"] == 2:
                stroke, label = 1, ("albatrosses" if i == 0 else "eagles")
            elif dart["number"] == hole_number and dart["multiplier"] == 3:
                stroke, label = 2, "birdies"
            elif dart["number"] == hole_number and dart["multiplier"] == 1:
                stroke, label = 3, "pars"
            elif dart["number"] == 0:
                stroke, label = 5, "double_bogeys"
            else:
                stroke, label = 4, "bogeys"
            if stroke < best_stroke:
                best_stroke, best_label = stroke, label
            if stroke == 1:
                break  # can't beat an eagle/albatross with the remaining darts
        metrics[best_label] += 1
        metrics["golf_strokes_total"] += best_stroke
        state["golf_strokes"].append(best_stroke)
        state["golf_hole"] += 1
        if state["golf_hole"] >= hole_count:
            state["golf_done"] = True
        return {"kind": "golf", "hole": hole_number, "strokes": best_stroke, "used": used,
                "scored": best_stroke, "round_winner": None}

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
        metrics = self.players[pid]["metrics"]
        metrics["blocks_attempted"] += 1
        metrics["bitcoin_darts"] += len(used)
        if hit:
            self.players[pid]["score"] += reward
            self.difficulty = min(8, self.difficulty + 1)
            metrics["blocks_mined"] += 1
            metrics["btc_earned"] += reward
            metrics["best_block_reward"] = max(metrics["best_block_reward"], reward)
            metrics["mine_streak"] += 1
            metrics["best_mine_streak"] = max(metrics["best_mine_streak"], metrics["mine_streak"])
        else:
            self.difficulty = max(1, self.difficulty - 1)
            metrics["mine_streak"] = 0
        metrics["best_difficulty"] = max(metrics["best_difficulty"], self.difficulty)
        result = {"kind": "bitcoin", "player_id": pid, "entered_by": entered_by, "darts": used,
                  "round": self.round_no, "targets": self.targets, "hit": hit, "scored": reward,
                  "block": self.block_count, "difficulty": self.difficulty}
        self.history.append(result)
        if pid == GHOST_ID and self.ghost:
            self.ghost.react(hit)

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
        if pid != GHOST_ID:
            await self._maybe_ghost_turn()

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

    async def _record(self, records, metadata):
        """Keeps the whole match in Score Arena's own statistics and tells Game
        Hub only what it needs: who played, the points, and the headline facts."""
        ids = {r["player_id"] for r in records if r.get("player_id")} | set(metadata.get("player_stats") or {})
        try:
            await asyncio.to_thread(sa_stats.import_from_hub)
            await asyncio.to_thread(sa_stats.record, metadata["scorearena_mode"], ids,
                                    {k: v for k, v in metadata.items() if k != "turn_history"})
        except Exception as e:
            print(f"[scorearena] could not save match statistics: {e}")
        await self.ctx.finish(records, metadata={k: metadata.get(k) for k in
                                                 ("scorearena_mode", "rounds", "turns", "winner")})

    async def _finish_bitcoin(self):
        self.finished = True
        standings = sorted(self.order, key=lambda pid: self.players[pid]["score"], reverse=True)
        winner = standings[0]
        real_standings = [pid for pid in standings if pid != GHOST_ID]
        records = [{"player_id": pid, "score": self.players[pid]["score"], "rank": i + 1, "is_winner": pid == winner}
                   for i, pid in enumerate(real_standings)]
        await self.ctx.broadcast(self._state("sa_finished", winner=winner))
        had_rival = len([pid for pid in self.order if pid != GHOST_ID]) > 1 or self.ghost is not None
        player_stats = {}
        for pid in self.order:
            if pid == GHOST_ID:
                continue
            m = dict(self.players[pid]["metrics"])
            m["hit_rate"] = round((m["blocks_mined"] / m["blocks_attempted"] * 100) if m["blocks_attempted"] else 0, 2)
            m["darts_per_block"] = round((m["bitcoin_darts"] / m["blocks_attempted"]) if m["blocks_attempted"] else 0, 2)
            m["halvings_survived"] = self.halving_count
            m["wins"] = (1 if pid == winner else 0) if had_rival else 0
            player_stats[pid] = m
        await self._record(records, {"scorearena_mode": self.mode, "rounds": self.round_no,
                                     "turns": len(self.history), "winner": winner,
                                     "player_stats": player_stats, "turn_history": self.history})

    def _reset_round(self):
        for pid in self.order:
            wins = self.players[pid]["wins"]
            metrics = self.players[pid]["metrics"]
            self.players[pid] = self._fresh_player()
            self.players[pid]["wins"] = wins
            self.players[pid]["metrics"] = metrics
        self.turn_index = (self.round_no - 1) % len(self.order)

    async def _finish(self, winner, winners=None):
        self.finished = True
        self._undo = None
        winners = winners or [winner]
        # In a custom game where the lowest score wins, a bigger score ranks worse.
        sign = -1 if self.mode == "custom" and self._prefers_low() else 1
        standings = sorted(self.order, key=lambda pid: (self.players[pid]["wins"], sign * self.players[pid].get("score", 0)), reverse=True)
        real_standings = [pid for pid in standings if pid != GHOST_ID]
        records = [{"player_id": pid, "score": self.players[pid]["wins"], "rank": i + 1, "is_winner": pid in winners}
                   for i, pid in enumerate(real_standings)]
        await self.ctx.broadcast(self._state("sa_finished", winner=winner, winners=winners))
        had_rival = len([pid for pid in self.order if pid != GHOST_ID]) > 1 or self.ghost is not None
        player_stats = {}
        for pid in self.order:
            if pid == GHOST_ID:
                continue
            m = dict(self.players[pid]["metrics"])
            m["three_dart_average"] = round((m["points"] / m["darts"] * 3) if m["darts"] else 0, 2)
            m["checkout_rate"] = round((m["checkout_hits"] / m["checkout_attempts"] * 100) if m["checkout_attempts"] else 0, 2)
            m["mpr"] = round((m["marks_total"] / m["turns"]) if m["turns"] else 0, 2)
            m["avg_turn"] = round((m["points"] / m["turns"]) if m["turns"] else 0, 2)
            m["wins"] = self.players[pid]["wins"] if had_rival else 0
            player_stats[pid] = m
        metadata = {"scorearena_mode": self.mode, "rounds": self.round_no,
                    "turns": len(self.history), "winner": winner,
                    "player_stats": player_stats, "turn_history": self.history}
        if self.mode == "custom":
            # Stats are kept per game *and* per author: two players may both
            # have a "Scrabble" with different rules, and those must not mix.
            metadata["scorearena_mode"] = self._custom_key()
            if self.rules.get("board"):
                metadata["scorearena_board"] = self.rules["board"]
            else:
                metadata["scorearena_custom"] = {**self.rules, "owner_id": self.owner_id, "owner_name": self.owner_name}
        await self._record(records, metadata)

    async def _finish_golf(self):
        """Pro/Mini Golf finish: unlike every other mode, completion isn't
        'first to N wins' — everyone plays every hole, lowest total strokes
        wins, exactly like real golf."""
        self.finished = True
        hole_count = GOLF_HOLE_COUNTS.get(self.mode, 18)
        standings = sorted(self.order, key=lambda pid: self.players[pid]["metrics"]["golf_strokes_total"])
        winner = standings[0]
        real_standings = [pid for pid in standings if pid != GHOST_ID]
        records = [{"player_id": pid, "score": self.players[pid]["metrics"]["golf_strokes_total"],
                    "rank": i + 1, "is_winner": pid == winner}
                   for i, pid in enumerate(real_standings)]
        await self.ctx.broadcast(self._state("sa_finished", winner=winner))
        had_rival = len([pid for pid in self.order if pid != GHOST_ID]) > 1 or self.ghost is not None
        player_stats = {}
        for pid in self.order:
            if pid == GHOST_ID:
                continue
            m = dict(self.players[pid]["metrics"])
            m["darts_per_target"] = round((m["golf_darts"] / hole_count) if hole_count else 0, 2)
            m["avg"] = round((m["golf_strokes_total"] / hole_count) if hole_count else 0, 2)
            m["wins"] = (1 if pid == winner else 0) if had_rival else 0
            player_stats[pid] = m
        await self._record(records, {"scorearena_mode": self.mode, "rounds": self.round_no,
                                     "turns": len(self.history), "winner": winner,
                                     "player_stats": player_stats, "turn_history": self.history})

    def _state(self, kind, **extra):
        roster = {p["id"]: {k: p.get(k) for k in ("id", "display_name", "avatar_color", "avatar_svg", "connected")}
                  for p in self.ctx.all_players()}
        roster.update(self.local)
        if self.ghost and GHOST_ID in self.players:
            roster[GHOST_ID] = {"id": GHOST_ID, "display_name": self.ghost_name, "avatar_color": "#8b5cf6",
                                 "avatar_svg": None, "connected": True, "is_ghost": True, "mood": self.ghost.mood()}
        return {"type": kind, "mode": self.mode, "target_wins": self.target_wins, "order": self.order,
                "turn_index": self.turn_index, "current_player_id": self.order[self.turn_index] if self.order else None,
                "players": self.players, "roster": roster, "history": self.history[-20:], "round": self.round_no,
                "dice": self.dice, "targets": self.targets, "difficulty": self.difficulty,
                "block_count": self.block_count, "halving_reward": self.halving_reward,
                "halving_count": self.halving_count, "total_blocks": self.total_blocks,
                "rules": self.rules, "owner_id": self.owner_id, "can_undo": bool(self._undo), **extra}
