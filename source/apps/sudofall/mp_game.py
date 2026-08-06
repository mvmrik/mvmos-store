"""
Sudofall multiplayer — transparent relay.
Host generates the sequence and game_start message client-side.
Server just forwards every message to the other player and records the session.
"""
import random


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.scores = {}
        self.started = False
        self.seq = []
        self.ready = set()
        self.finished = set()

    async def on_start(self, settings):
        for p in self.ctx.all_players():
            self.scores[p["id"]] = 0

    async def on_join(self, player):
        # Notify others
        await self.ctx.broadcast(
            {"type": "player_joined",
             "name": player["display_name"],
             "gh_player_id": player["id"],
             "avatar_svg": player.get("avatar_svg")},
            exclude=player["id"]
        )
        # Send reconnect state if game already started
        if self.started:
            players = self.ctx.all_players()
            opp = next((p for p in players if p["id"] != player["id"]), None)
            await self.ctx.send(player["id"], {
                "type": "sf_state",
                "started": True,
                "seq": self.seq,
                "your_turn": False,
                "opponent": {
                    "id": opp["id"],
                    "display_name": opp["display_name"],
                    "avatar_svg": opp.get("avatar_svg"),
                    "avatar_color": opp.get("avatar_color"),
                    "score": self.scores.get(opp["id"], 0),
                } if opp else None,
            })

    async def on_leave(self, player):
        await self.ctx.broadcast({"type": "player_left"}, exclude=player["id"])

    async def on_message(self, player, msg):
        t = msg.get("type", "")
        pid = player["id"]

        if t == "sf_ready":
            self.ready.add(pid)
            players = self.ctx.all_players()
            need = min(2, len(players))
            if len(self.ready) >= need and not self.started:
                self.started = True
                self.seq = [random.randint(0, 9) for _ in range(500)]
                while self.seq[0] == 0:
                    self.seq[0] = random.randint(1, 9)
                first_id = random.choice([p["id"] for p in players])
                for p in players:
                    opp = next((x for x in players if x["id"] != p["id"]), None)
                    await self.ctx.send(p["id"], {
                        "type": "game_start",
                        "seq": self.seq,
                        "first_player_id": first_id,
                        "is_host": p["id"] == players[0]["id"],
                        "opponent": {
                            "id": opp["id"],
                            "display_name": opp["display_name"],
                            "avatar_svg": opp.get("avatar_svg"),
                            "avatar_color": opp.get("avatar_color"),
                        } if opp else None,
                    })
            return

        if t == "score_update":
            self.scores[pid] = msg.get("score", 0)

        if t == "game_over":
            self.scores[pid] = msg.get("score", self.scores.get(pid, 0))
            self.finished.add(pid)
            # Forward to opponent
            await self.ctx.broadcast({"type": "game_over", "score": self.scores[pid]}, exclude=pid)
            if len(self.finished) >= len(self.ctx.all_players()):
                players = self.ctx.all_players()
                standings = sorted(players, key=lambda p: self.scores.get(p["id"], 0), reverse=True)
                records = [{"player_id": p["id"], "score": self.scores.get(p["id"], 0),
                            "rank": i + 1, "is_winner": i == 0}
                           for i, p in enumerate(standings)]
                await self.ctx.finish(records)
            return

        # Forward everything else transparently
        await self.ctx.broadcast(msg, exclude=pid)
