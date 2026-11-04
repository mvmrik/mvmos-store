"""
Racelandia - the server half of the game.

Loaded by Game Hub's multiplayer framework by convention. A room is one visit
to the team: each player prepares their car in the garage, sends it out for a
number of laps, and reads the result. The laps are simulated in the browser
(public/sim.js), which spares the server, so what the server keeps is the
part a browser must not decide: the driver's skills, the budget, the
weather, what a setup may contain, and how many points a reported lap is
worth. Other players in the room appear on the track as ghosts: every browser
sends its car's position a few times a second and the server passes it on.
"""
import asyncio
import importlib.util
import os
import random
import time

_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("racelandia_data", os.path.join(_APP_DIR, "apex_data.py"))
data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(data)

POS_MIN_GAP = 0.07        # seconds between two relayed positions per player


def _num(v, lo, hi, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if v != v or v in (float("inf"), float("-inf")):
        return default
    return min(hi, max(lo, v))


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.cfg = {"laps": 3, "hour": data.default_hour()}
        self.date = data.today_ord()
        self.p = {}                      # player id -> state
        self.over = False

    def _st(self, player):
        pid = player["id"]
        st = self.p.get(pid)
        if not st:
            st = self.p[pid] = {"name": player.get("display_name", ""), "run": None, "best_t": None, "best_p": 0,
                                "laps": 0, "crashes": 0, "runs": 0, "done": False, "last_pos": 0.0, "race_pts": 0}
        st["name"] = player.get("display_name", st["name"])
        return st

    def snapshot(self):
        return None

    def _board(self):
        rows = [{"pid": pid, "name": s["name"], "best": s["best_t"], "points": s["best_p"] + s["race_pts"], "laps": s["laps"],
                 "done": s["done"], "running": bool(s["run"])} for pid, s in self.p.items()]
        rows.sort(key=lambda r: (-r["points"], r["best"] if r["best"] is not None else 1e9))
        return rows

    async def on_start(self, settings):
        for p in self.ctx.all_players():
            self._st(p)
        await self.ctx.broadcast({"type": "ap_cfg", "cfg": self.cfg, "board": self._board(), "multi": len(self.ctx.all_players()) > 1})

    async def on_join(self, player):
        self._st(player)
        await self.ctx.send(player["id"], {"type": "ap_cfg", "cfg": self.cfg, "board": self._board(),
                                           "multi": len(self.ctx.all_players()) > 1})
        await self.ctx.broadcast({"type": "ap_board", "board": self._board()})

    async def on_leave(self, player):
        await self.ctx.broadcast({"type": "ap_gone", "pid": player["id"]}, exclude=player["id"])

    async def on_message(self, player, msg):
        if self.over:
            return
        t = msg.get("type")
        st = self._st(player)
        pid = player["id"]
        if t == "ap_division_enter":
            if len(self.ctx.all_players())>1:
                await self.ctx.send(pid, {"type":"ap_err","code":"solo_only"});return
            error=data.enter_division(pid)
            await self.ctx.send(pid,{"type":"ap_err","code":error} if error else {"type":"ap_division_updated"})
        elif t == "ap_new_career":
            error = data.reset_career(pid, msg.get("started"))
            if error:
                await self.ctx.send(pid, {"type": "ap_err", "code": error})
                return
            del self.p[pid]
            self._st(player)
            await self.ctx.send(pid, {"type": "ap_career_reset"})
            await self.ctx.broadcast({"type": "ap_board", "board": self._board()})
        elif t == "ap_restore_career":
            error = data.restore_career(pid, msg.get("started"))
            if error:
                await self.ctx.send(pid, {"type": "ap_err", "code": error})
                return
            del self.p[pid]
            self._st(player)
            await self.ctx.send(pid, {"type": "ap_career_reset"})
            await self.ctx.broadcast({"type": "ap_board", "board": self._board()})
        elif t == "ap_cfg":
            multi = len(self.ctx.all_players()) > 1
            if multi and pid != self.ctx.host_id:
                return
            laps = int(_num(msg.get("laps"), data.MIN_LAPS, data.MAX_LAPS, self.cfg["laps"]))
            hour = int(_num(msg.get("hour"), data.HOURS[0], data.HOURS[-1], self.cfg["hour"]))
            self.cfg = {"laps": laps, "hour": hour}
            await self.ctx.broadcast({"type": "ap_cfg", "cfg": self.cfg, "board": self._board(), "multi": multi})
        elif t == "ap_resume":
            payload=data.pending_session_payload(pid)
            if not payload:
                await self.ctx.send(pid,{"type":"ap_err","code":"session"});return
            if payload['kind'].startswith('d5_') and len(self.ctx.all_players())>1:
                await self.ctx.send(pid,{"type":"ap_err","code":"solo_only"});return
            if len(self.ctx.all_players())>1:payload.pop('timing_field',None)
            st['run']=payload
            await self.ctx.send(pid,{**payload,'type':'ap_go','pid':pid,'name':st['name'],
                'sectors':data.sector_bests(pid,payload.get('track') or data.TRACK),'col':list(self.p.keys()).index(pid)%8,'driver':data.public_driver(data.get_driver(pid))})
        elif t == "ap_run":
            await self._run(player, st, msg)
        elif t == "ap_progress":
            if st["run"] and st["run"].get("session") == msg.get("session"):
                data.save_progress(pid, str(msg.get("session")), msg.get("progress"))
        elif t == "ap_pos":
            now = time.time()
            if not st["run"] or now - st["last_pos"] < POS_MIN_GAP:
                return
            st["last_pos"] = now
            await self.ctx.broadcast({
                "type": "ap_pos", "pid": pid, "name": st["name"], "livery": st["run"].get("livery", {}),
                "x": _num(msg.get("x"), -1e5, 1e5), "y": _num(msg.get("y"), -1e5, 1e5),
                "psi": _num(msg.get("psi"), -10, 10), "v": _num(msg.get("v"), 0, 150),
                "best": _num(msg.get("best"), data.min_lap(0), 1200, None),
                "lap": int(_num(msg.get("lap"), -1, 50)), "col": int(_num(msg.get("col"), 0, 7)),
            }, exclude=pid)
        elif t == "ap_pit":
            await self._pit(player, st, msg)
        elif t == "ap_result":
            await self._result(player, st, msg)
        elif t == "ap_abort":
            data.abandon_session(pid)
            st["run"] = None
            await self.ctx.broadcast({"type": "ap_board", "board": self._board()})
        elif t == "ap_finish":
            data.abandon_session(pid)
            st["done"] = True
            st["run"] = None
            await self.ctx.broadcast({"type": "ap_board", "board": self._board()})
            if all(s["done"] for pid2, s in self.p.items() if any(p["id"] == pid2 for p in self.ctx.players())):
                await self._end()

    # ── a run starts: validate, charge, hand out what the browser needs ──
    async def _run(self, player, st, msg):
        pid = player["id"]
        if st["run"]:
            active=data.active_session(pid)
            if active and active["id"]==st["run"]["session"]:return
            st["run"]=None
        kind = str(msg.get("kind", "practice"))
        compound=msg.get("compound")
        if kind.startswith('d5_') and len(self.ctx.all_players())>1:
            await self.ctx.send(pid,{"type":"ap_err","code":"solo_only"});return
        payload,error=data.reserve_session(pid,kind,msg.get("setup"),compound,self.cfg["laps"],self.cfg["hour"],msg.get("tyre_set"),msg.get("track"),msg.get("tyre_set2"))
        if error:
            await self.ctx.send(pid,{"type":"ap_err","code":error})
            return
        if len(self.ctx.all_players())>1:payload.pop("timing_field",None)
        st["run"]=payload
        d=data.get_driver(pid)
        await self.ctx.send(pid,{**payload,"type":"ap_go","pid":pid,"name":st["name"],
                                "sectors":data.sector_bests(pid,payload.get("track") or data.TRACK),
                                "col":list(self.p.keys()).index(pid)%8,"driver":data.public_driver(d)})
        await self.ctx.broadcast({"type": "ap_board", "board": self._board()})

    # ── a set of tyres bought at the box ──
    async def _pit(self, player, st, msg):
        pid = player["id"]
        run = st["run"]
        comp = msg.get("compound")
        if not run:return
        if run['kind']=='d5_race':
            ok=not msg.get('fuel') and data.race_pit_command(pid,run['session'],msg.get('at'),comp,msg.get('set'),msg.get('wing',False),str(msg.get('car') or 'player'),msg.get('wing_unit'),msg.get('service'),msg.get('pass',False))
        else:ok=data.charge_session_pit(pid,run['session'],comp,msg.get('fuel',0),msg.get('set'),msg.get('swap'),msg.get('car'))
        await self.ctx.send(pid, {"type": "ap_pit_ok", "ok": bool(ok), "compound": comp, "budget": data.get_driver(pid)["budget"], **(ok if isinstance(ok, dict) else {})})

    # ── the browser reports what it measured; the server decides what counts ──
    async def _result(self, player, st, msg):
        pid = player["id"]
        run = st["run"]
        if not run:
            return
        trk = run.get("track") or data.TRACK
        if msg.get("session") != run["session"]:
            return
        # A full field replay must not block the server event loop.
        result=await asyncio.to_thread(data.settle_session,pid,run["session"],msg)
        st["run"]=None
        if result is None:
            await self.ctx.send(pid,{"type":"ap_err","code":"session"});return
        best=result["best"]
        if best and (st["best_t"] is None or best["time"]<st["best_t"]):st["best_t"]=best["time"]
        st["best_p"]=max(st["best_p"],result["qualification"]["points"] if result["qualification"] else 0)
        if result.get("weekend"):st["race_pts"]+=result["weekend"]["points"]
        st["laps"]+=sum(l["valid"] for l in result["laps"])
        st["crashes"]+=int(result["dnf"]=="crash");st["runs"]+=1
        d=data.get_driver(pid)
        await self.ctx.send(pid,{**result,"type":"ap_summary","driver":data.public_driver(d),"career":data.public_career(d),"division":data.public_division(d),
                                "bests":data.best_laps(pid,trk),"sector_bests":data.sector_bests(pid,trk)})
        await self.ctx.broadcast({"type":"ap_board","board":self._board()})

    async def _end(self):
        if self.over:
            return
        self.over = True
        rows = sorted(self.p.items(), key=lambda kv: (-(kv[1]["best_p"] + kv[1]["race_pts"]), kv[1]["best_t"] if kv[1]["best_t"] is not None else 1e9))
        multi = len(rows) > 1
        records = []
        for rank, (pid, s) in enumerate(rows, 1):
            stats = {"laps": s["laps"], "crashes": s["crashes"], "runs": s["runs"]}
            if s["best_t"] is not None:
                stats["best_lap"] = round(s["best_t"], 3)
            score = s["best_p"] + s["race_pts"]
            records.append({"player_id": pid, "score": score, "rank": rank,
                            "is_winner": multi and rank == 1 and score > 0, "stats": stats})
        await self.ctx.broadcast({"type": "ap_over", "board": self._board(), "multi": multi})
        await self.ctx.finish(records, metadata={ "hour": self.cfg["hour"], "laps": self.cfg["laps"]})
