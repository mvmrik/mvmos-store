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

import asyncio
import importlib.util
import json
import os
import random
import time

# mp_game.py is loaded by Game Hub straight from its file, so its siblings are
# loaded the same way: an app update then never keeps running an older copy a
# live backend has already cached.
_APP_DIR = os.path.dirname(os.path.realpath(__file__))


def _load_sibling(name):
    spec = importlib.util.spec_from_file_location(f"towerdefense_{name}", os.path.join(_APP_DIR, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


td_bank = _load_sibling("td_bank")

# One balance for everyone. There is no difficulty to choose, so every score
# on the leaderboard was earned against the same waves and means the same
# thing. The client reads these numbers out of td_start rather than keeping
# its own copy — one place to balance the game, and no way for the two halves
# to disagree.
TUNING = {"enemy_hp": 0.9, "enemy_speed": 0.95, "spawn_rate": 0.9, "tower_hp": 100}

# What the tower has bought is kept as the browser describes it; the browser
# checks every level against its own catalogue when it reads it back. This is
# only the ceiling on how much of it a room is willing to hold.
_BUILD_MAX_BYTES = 4000


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _state_from(msg) -> dict:
    """The checkpoint a player reported: the run as it stood at the start of
    a wave or in the shop between two waves."""
    build = msg.get("build")
    if not isinstance(build, dict) or len(json.dumps(build)) > _BUILD_MAX_BYTES:
        build = None
    try:
        hp = float(msg.get("hp", 0))
    except (TypeError, ValueError):
        hp = 0.0
    return {
        "score":   _int(msg.get("score")),
        "wave":    max(1, _int(msg.get("wave"), 1)),
        "kills":   _int(msg.get("kills")),
        "hp":      hp,
        "seconds": _int(msg.get("seconds")),
        "coins":   max(0, _int(msg.get("coins"))),
        "build":   build,
    }


class Game:
    def __init__(self, ctx):
        self.ctx        = ctx
        self.seed       = 0
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
        self.seed       = random.randint(1, 2 ** 31 - 1)
        self.started    = True
        self.started_at = time.time()

        # Started from a saved game: it is a new run, with a new seed and a new
        # session — it simply begins where the player stopped instead of at
        # wave one. The framework has already consumed the save.
        saved = self.ctx.saved_state
        if saved:
            self.resumed = _state_from(saved)
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
        return dict(state)

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
            # Two jobs, one message. The whole checkpoint (coins and everything
            # the tower has bought included) is kept for the sender's own
            # reconnect; only score and wave go out to the others, for the
            # shared scoreboard multiplayer will draw.
            self.states[pid] = _state_from(msg)
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
            "tuning":     TUNING,
            # Prices and caps, from the one catalogue the bank also checks.
            "shop":       td_bank.catalogue(),
        }
        # What the player has bought for good: every run starts from it.
        pid = player_id or self.ctx.host_id
        try:
            bank = td_bank.get(pid)
            msg["perm"], msg["best"] = bank["build"], bank["best"]
        except Exception:
            msg["perm"], msg["best"] = td_bank.fresh_build(), 0
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
        # Every score is also paid into its player's bank, to be spent in the
        # permanent shop. The leaderboard below still gets the whole score.
        for p in players:
            result = self.results.get(p["id"], {})
            score = result.get("score", 0)
            try:
                bank = await asyncio.to_thread(td_bank.credit, p["id"], score, result.get("wave", 0))
            except Exception:
                continue
            await self.ctx.send(p["id"], {"type": "td_bank", "earned": score, **bank})
        best = self.results.get(ordered[0]["id"], {}) if ordered else {}
        await self.ctx.finish(records, metadata={
            "waves":      best.get("wave", 0),
            "kills":      best.get("kills", 0),
        })
