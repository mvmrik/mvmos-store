class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.board = [""] * 9
        self.order = []
        self.turn = 0
        self.done = False

    async def _state(self, status):
        await self.ctx.broadcast({"board": self.board, "status": status})

    async def on_start(self, settings):
        self.order = [p["id"] for p in self.ctx.players()][:2]
        await self._state("X starts")

    async def on_join(self, player):
        await self.ctx.send(player["id"], {"board": self.board, "status": "welcome"})

    async def on_leave(self, player):
        pass

    async def on_message(self, player, msg):
        if self.done or not isinstance(msg, dict) or player["id"] not in self.order:
            return
        i = msg.get("move")
        if self.order[self.turn % 2] != player["id"] or not isinstance(i, int) or not 0 <= i < 9 or self.board[i]:
            return
        self.board[i] = "X" if self.turn % 2 == 0 else "O"
        self.turn += 1
        lines = [(0,1,2),(3,4,5),(6,7,8),(0,3,6),(1,4,7),(2,5,8),(0,4,8),(2,4,6)]
        for a, b, c in lines:
            if self.board[a] and self.board[a] == self.board[b] == self.board[c]:
                self.done = True
                winner = player["id"]
                records = [{"player_id": pid, "score": 1 if pid == winner else 0, "rank": 1 if pid == winner else 2, "is_winner": pid == winner} for pid in self.order]
                await self._state("won:" + self.board[a])
                await self.ctx.finish(records)
                return
        await self._state("next:" + ("X" if self.turn % 2 == 0 else "O"))
