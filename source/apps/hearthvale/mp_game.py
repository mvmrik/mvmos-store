"""Hearthvale server adapter for Game Hub.

Every player plays in a solo room of their own, which is how Game Hub lets
anyone walk in and out at any time. What makes it one world is hv_world.py,
loaded once per process and shared by all of those rooms.
"""

import importlib.util
import os
import sys

from backend.assets import asset

_WORLD_MODULE = "hearthvale_world"


def _shared():
    # Game Hub executes this file again for every room it starts, so a
    # module-level World here would be a new, empty world per player. The
    # shared one is kept in sys.modules under a fixed name instead.
    mod = sys.modules.get(_WORLD_MODULE)
    if mod is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hv_world.py")
        spec = importlib.util.spec_from_file_location(_WORLD_MODULE, path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules[_WORLD_MODULE] = mod
    return mod


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.shared = _shared()
        self.world = self.shared.WORLD

    def _host(self):
        for p in self.ctx.all_players():
            if p["id"] == self.ctx.host_id:
                return p
        return None

    async def _enter(self, player):
        await self.world.enter(self.ctx, player, asset("/apps/hearthvale/three.module.min.js"))

    async def on_start(self, settings):
        host = self._host()
        if host:
            await self._enter(host)

    async def on_join(self, player):
        await self._enter(player)

    async def on_leave(self, player):
        pid = str(player["id"])
        await self.world.leave(self.ctx, pid)

        async def _close_if_gone():
            if not any(p["id"] == pid for p in self.ctx.players()):
                await self.ctx.close("left")

        self.ctx.schedule(self.shared.TUNING["leave_grace"], _close_if_gone)

    async def on_message(self, player, msg):
        kind = msg.get("type")
        pid = str(player["id"])
        if kind == "hv_move":
            await self.world.move(pid, msg)
        elif kind == "hv_chop":
            await self.world.chop(pid, msg)
        elif kind == "hv_pick":
            await self.world.pick(pid, msg)
        elif kind == "hv_drop":
            await self.world.drop(pid, msg)
        elif kind == "hv_craft":
            await self.world.craft(pid, msg)
        elif kind == "hv_place":
            await self.world.place(pid, msg)
        elif kind == "hv_pull":
            await self.world.pull(pid, msg)
        elif kind == "hv_hold":
            await self.world.hold(pid, msg)
        elif kind == "hv_exit":
            await self.world.leave(self.ctx, pid)
            await self.ctx.close("left")
