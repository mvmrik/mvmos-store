"""
IGP Calculator — the server half inside Game Hub.

This is a calculator, not a game, so there is nothing for the room to referee:
the page does all the arithmetic and keeps its records through api.py. The room
only exists because Game Hub's play page is where an Apps Hub account signs in.
It never records a session, so nothing ever lands in the leaderboard.
"""


class Game:
    def __init__(self, ctx):
        self.ctx = ctx

    async def on_start(self, settings):
        pass

    async def on_join(self, player):
        pass

    async def on_leave(self, player):
        pass

    async def on_message(self, player, msg):
        # Closing the calculator ends the room without a result, so the next
        # visit opens a fresh one instead of "a run in progress".
        if msg.get("type") == "igp_exit":
            await self.ctx.close("exit")
