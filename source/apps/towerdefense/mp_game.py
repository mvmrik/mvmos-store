"""
Tower Defense — the server half of the game.

Loaded by Game Hub's multiplayer framework (backend/apps/gamehub/mp.py) by
convention: any app with an mp_game.py exposing `Game(ctx)` becomes playable in
Game Hub, solo or with others. The framework owns rooms, sockets, identity,
reconnects and writing the finished session into the leaderboard; everything
below is only this game's rules.

Solo is the only mode today, but the shape here is already the multiplayer one,
because that is the part that is expensive to retrofit: the *server* owns the
wave plan, not the client. It draws one seed per room and hands the same seed
to every player, so a second player added later fights exactly the same waves
in the same order and the two scores mean the same thing. The client derives
the waves from that seed with the same arithmetic (public/mp.js) rather than
receiving thousands of pre-rolled enemies over the socket.
"""

import random
import time

# Difficulty is chosen by the host in the lobby and is part of the room's
# settings, so every player in the room gets the same one. The client reads
# these numbers out of td_start rather than keeping its own copy — one place to
# balance the game, and no way for the two halves to disagree.
DIFFICULTIES = {
    "easy":   {"enemy_hp": 0.75, "enemy_speed": 0.85, "spawn_rate": 0.8,  "tower_hp": 120},
    "normal": {"enemy_hp": 1.0,  "enemy_speed": 1.0,  "spawn_rate": 1.0,  "tower_hp": 100},
    "hard":   {"enemy_hp": 1.35, "enemy_speed": 1.2,  "spawn_rate": 1.35, "tower_hp": 80},
}
DEFAULT_DIFFICULTY = "normal"


class Game:
    def __init__(self, ctx):
        self.ctx        = ctx
        self.seed       = 0
        self.difficulty = DEFAULT_DIFFICULTY
        self.started    = False
        self.started_at = 0.0
        self.results    = {}   # player_id -> {score, wave, kills, seconds}
        self.progress   = {}   # player_id -> last reported {score, wave}
        # Last full snapshot each player sent, so a reload does not throw the
        # run away. The browser runs the simulation, so the browser is the only
        # thing that knows where the run got to — it reports, the room keeps it,
        # and the player gets it back on reconnect.
        self.states     = {}   # player_id -> {score, wave, kills, hp, seconds}
        # Where a saved game left off, when this run was started from one.
        self.resumed    = None

    # ── Framework callbacks ──────────────────────────────────────────────────

    async def on_start(self, settings):
        self.difficulty = settings.get("difficulty")
        if self.difficulty not in DIFFICULTIES:
            self.difficulty = DEFAULT_DIFFICULTY
        self.seed       = random.randint(1, 2 ** 31 - 1)
        self.started    = True
        self.started_at = time.time()

        # Started from a saved game: it is a new run, with a new seed and a new
        # session — it simply begins where the player stopped instead of at
        # wave one. The framework has already consumed the save.
        saved = self.ctx.saved_state
        if saved:
            self.difficulty = saved.get("difficulty", self.difficulty)
            if self.difficulty not in DIFFICULTIES:
                self.difficulty = DEFAULT_DIFFICULTY
            self.resumed = {
                "score":   int(saved.get("score", 0)),
                "wave":    int(saved.get("wave", 1)),
                "kills":   int(saved.get("kills", 0)),
                "hp":      float(saved.get("hp", 0)),
                "seconds": int(saved.get("seconds", 0)),
            }
            # Reusing the reconnect channel: from here on a resumed save is
            # indistinguishable from a run someone reloaded into, so reloading
            # a resumed run keeps working with no extra code.
            self.states[self.ctx.host_id] = dict(self.resumed)

        await self.ctx.broadcast(self._start_msg())

    def snapshot(self):
        """Save & exit (asked for by the framework, solo only).

        What is saved is the same snapshot a reconnect would get, so a saved
        run and a reloaded one come back through exactly the same path. The
        browser sends a fresh td_progress right before asking to save, and the
        socket keeps order, so this is the run as it stood at the click.
        """
        pid = self.ctx.host_id
        if pid in self.results:
            return None
        state = self.states.get(pid)
        if not state:
            return None
        return {**state, "difficulty": self.difficulty}

    async def on_join(self, player):
        # Reconnect: the room outlives a dropped socket, so a player coming
        # back gets the same seed *and* the point the run had reached, rather
        # than an empty screen or a run restarted from the first wave.
        if self.started:
            await self.ctx.send(player["id"], self._start_msg(player["id"]))
        await self.ctx.broadcast(
            {"type": "td_player_joined", "player_id": player["id"],
             "display_name": player["display_name"]},
            exclude=player["id"],
        )

    async def on_leave(self, player):
        await self.ctx.broadcast(
            {"type": "td_player_left", "player_id": player["id"]},
            exclude=player["id"],
        )

    async def on_message(self, player, msg):
        pid = player["id"]
        kind = msg.get("type", "")

        if kind == "td_progress":
            # Two jobs, one message. The whole snapshot is kept for the sender's
            # own reconnect; only score and wave go out to the others, for the
            # shared scoreboard multiplayer will draw.
            self.states[pid] = {
                "score":   int(msg.get("score", 0)),
                "wave":    int(msg.get("wave", 1)),
                "kills":   int(msg.get("kills", 0)),
                "hp":      float(msg.get("hp", 0)),
                "seconds": int(msg.get("seconds", 0)),
            }
            self.progress[pid] = {
                "score": self.states[pid]["score"],
                "wave":  self.states[pid]["wave"],
            }
            await self.ctx.broadcast(
                {"type": "td_progress", "player_id": pid, **self.progress[pid]},
                exclude=pid,
            )
            return

        if kind == "td_over":
            if pid in self.results:
                return
            self.results[pid] = {
                "score":   int(msg.get("score", 0)),
                "wave":    int(msg.get("wave", 0)),
                "kills":   int(msg.get("kills", 0)),
                "seconds": int(msg.get("seconds", 0)),
            }
            await self.ctx.broadcast(
                {"type": "td_player_over", "player_id": pid, **self.results[pid]},
                exclude=pid,
            )
            # The run ends when nobody is still playing. With one player that
            # is immediate; with several it waits for the last tower to fall.
            if len(self.results) >= len(self.ctx.all_players()):
                await self._finish()
            return

    # ── Internals ────────────────────────────────────────────────────────────

    def _start_msg(self, player_id: str | None = None) -> dict:
        msg = {
            "type":       "td_start",
            "seed":       self.seed,
            "difficulty": self.difficulty,
            "tuning":     DIFFICULTIES[self.difficulty],
        }
        if player_id is None:
            if self.resumed:
                msg["resume"] = self.resumed
            return msg
        # A player who already finished must come back to their result, not to
        # a fresh tower — in multiplayer the room stays open while the others
        # are still playing, so this is a normal thing to reconnect into.
        if player_id in self.results:
            msg["resume"] = {**self.results[player_id], "over": True}
        elif player_id in self.states:
            msg["resume"] = self.states[player_id]
        return msg

    async def _finish(self):
        players  = self.ctx.all_players()
        multi    = len(players) > 1
        ordered  = sorted(
            players,
            key=lambda p: self.results.get(p["id"], {}).get("score", 0),
            reverse=True,
        )
        records = []
        for i, p in enumerate(ordered):
            r = self.results.get(p["id"], {})
            records.append({
                "player_id": p["id"],
                "score":     r.get("score", 0),
                "rank":      i + 1,
                # A solo run has nobody to beat, so it is not a "win" — the
                # leaderboard counts wins, and one-player wins would make it
                # meaningless.
                "is_winner": multi and i == 0,
            })
        best = self.results.get(ordered[0]["id"], {}) if ordered else {}
        await self.ctx.finish(records, metadata={
            "difficulty": self.difficulty,
            "waves":      best.get("wave", 0),
            "kills":      best.get("kills", 0),
        })
