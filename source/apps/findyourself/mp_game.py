"""
FindYourself — multiplayer game logic (plugs into the Game Hub framework).

This file contains ONLY FindYourself rules: rounds, locations, distance scoring
and standings. Everything generic (players, sockets, reconnect, sessions, lobby,
invites) is provided by the hub through `ctx` — see backend/apps/gamehub/mp.py.

Message protocol (all game messages are prefixed `fy_`):

  client → server
    fy_locations  {locations:[{lat,lng,heading}]}   host delivers resolved Street Views
    fy_guess      {lat,lng}                          a player's guess (null lat = timed out)
    fy_next                                          host advances to next round

  server → client
    fy_preparing  {rounds}                           waiting for host to resolve locations
    fy_need_locations {rounds}                        (host only) please resolve & send
    fy_round_start {round,total,time,lat,lng,heading,started_at,api_key}
    fy_guess_update {player_id,display_name,avatar_svg,avatar_color,lat,lng}
    fy_round_end  {round,total,actual:{lat,lng},results:[...],host_id}
    fy_state      {...}                               full state for a (re)joiner
    fy_game_over  {standings:[...]}

Save & exit is not part of this protocol: the hub asks for snapshot() and
hands the blob back through ctx.saved_state, the same way it does for every
other game. Solo only — see backend/apps/gamehub/mp.py.
"""

import math
import time


def _haversine(lat1, lng1, lat2, lng2) -> float:
    R = 6371
    dl = (lat2 - lat1) * math.pi / 180
    dg = (lng2 - lng1) * math.pi / 180
    a = math.sin(dl / 2) ** 2 + math.cos(lat1 * math.pi / 180) * math.cos(lat2 * math.pi / 180) * math.sin(dg / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _dist_score(dist_km: float, scale: int = 2000) -> int:
    if dist_km < 0.05:
        return 5000
    return round(5000 * math.exp(-dist_km / scale))




class Game:
    _TIMEOUT_GRACE = 2.5  # seconds; see _start_round

    def __init__(self, ctx):
        self.ctx = ctx
        self.rounds_total = 5
        self.time_per_round = 60
        self.api_key = ""
        self.scale = 2000
        self.country_center = None
        self.country_zoom = 2
        self.current_round = 0
        self.round_started_at = 0.0
        self.result_shown = False
        self.locations = {}          # round → {lat,lng,heading}
        self.guesses = {}            # round → {player_id: {lat,lng,dist_km,dist_score,score}}
        self.totals = {}             # player_id → cumulative score
        self.started = False
        self._round_token = 0

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def on_start(self, settings):
        self.rounds_total   = max(1, min(50, int(settings.get("rounds", 5))))
        self.time_per_round = max(0, int(settings.get("time", 60)))
        self.api_key        = settings.get("api_key", "") or ""
        self.scale          = max(50, min(2000, int(settings.get("scale", 2000))))
        self.country_center = settings.get("country_center") or None
        self.country_zoom   = int(settings.get("country_zoom", 2))
        # Started from a saved solo game: the locations were resolved once, at
        # the very beginning, so there is nothing to ask the browser for — the
        # run simply opens at the round it stopped on, standings and all.
        saved = self.ctx.saved_state
        if saved and await self._resume(saved):
            return
        for p in self.ctx.all_players():
            self.totals.setdefault(p["id"], 0)
        # The host's browser resolves Street View locations and delivers them.
        await self.ctx.broadcast({"type": "fy_preparing", "rounds": self.rounds_total})
        await self.ctx.send(self.ctx.host_id, {"type": "fy_need_locations", "rounds": self.rounds_total})

    async def _resume(self, saved: dict) -> bool:
        """Put the game back where the save left it. Returns False if the save
        is not usable, so on_start can simply carry on with a normal start."""
        try:
            locations = {int(k): v for k, v in (saved.get("locations") or {}).items()}
            r = max(1, int(saved.get("round", 1)))
            self.rounds_total   = max(1, min(50, int(saved.get("rounds", self.rounds_total))))
            if r > self.rounds_total or not locations.get(r):
                return False
            self.time_per_round = max(0, int(saved.get("time", self.time_per_round)))
            self.scale          = max(50, min(2000, int(saved.get("scale", self.scale))))
            self.country_center = saved.get("country_center") or None
            self.country_zoom   = int(saved.get("country_zoom", self.country_zoom))
            self.locations      = locations
            self.totals         = {str(k): int(v) for k, v in (saved.get("totals") or {}).items()}
        except Exception as e:
            print(f"[findyourself] bad save: {e}")
            return False
        for p in self.ctx.all_players():
            self.totals.setdefault(p["id"], 0)
        self.started = True
        await self._start_round(r)
        return True

    def snapshot(self):
        """Save & exit (framework-driven, solo only).

        A round is the natural place to put the game down: an unfinished guess
        is not worth carrying, the standings and the remaining locations are.
        Saving while the results are on screen resumes at the next round.
        """
        if not self.started or self.current_round < 1:
            return None
        r = self.current_round + 1 if self.result_shown else self.current_round
        if r > self.rounds_total or not self.locations.get(r):
            return None
        return {
            "round":          r,
            "rounds":         self.rounds_total,
            "time":           self.time_per_round,
            "scale":          self.scale,
            "country_center": self.country_center,
            "country_zoom":   self.country_zoom,
            "locations":      {str(k): v for k, v in self.locations.items()},
            "totals":         {str(k): v for k, v in self.totals.items()},
        }

    async def on_join(self, player):
        # Bring a (re)connecting player up to the current state.
        await self.ctx.send(player["id"], self._state_for(player["id"]))

    async def on_leave(self, player):
        # A disconnect may complete the round (everyone else already guessed).
        await self._check_round_end()

    async def on_message(self, player, msg):
        t = msg.get("type")
        if t == "fy_locations":
            await self._receive_locations(player, msg)
        elif t == "fy_guess":
            await self._handle_guess(player, msg)
        elif t == "fy_next":
            if player["id"] == self.ctx.host_id and self.result_shown:
                await self._advance()
        elif t == "fy_end":
            if player["id"] == self.ctx.host_id and self.result_shown:
                await self._finish()

    # ── rounds ───────────────────────────────────────────────────────────────

    async def _receive_locations(self, player, msg):
        if player["id"] != self.ctx.host_id or self.started:
            return
        locs = msg.get("locations") or []
        if len(locs) < self.rounds_total:
            return
        for i, loc in enumerate(locs[: self.rounds_total]):
            self.locations[i + 1] = {
                "lat": float(loc["lat"]),
                "lng": float(loc["lng"]),
                "heading": float(loc.get("heading", 0)),
            }
        self.started = True
        await self._start_round(1)

    async def _start_round(self, r):
        self.current_round = r
        self.round_started_at = time.time()
        self.result_shown = False
        self.guesses.setdefault(r, {})
        loc = self.locations.get(r)
        if not loc:
            return
        await self.ctx.broadcast({
            "type": "fy_round_start",
            "round": r,
            "total": self.rounds_total,
            "time": self.time_per_round,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "heading": loc["heading"],
            "api_key": self.api_key,
            "started_at": self.round_started_at,
            "country_center": self.country_center,
            "country_zoom": self.country_zoom,
        })
        if self.time_per_round > 0:
            self._round_token += 1
            tok = self._round_token
            # Grace period: the client fires its own local timer at the same
            # deadline and sends the marked-but-unsubmitted guess as fy_guess,
            # but that message still needs to cross the network. Ending the
            # round exactly at time_per_round loses that race every time, so
            # give it a little slack to arrive before we lock the round.
            self.ctx.schedule(self.time_per_round + self._TIMEOUT_GRACE, lambda: self._timeout(r, tok))

    async def _timeout(self, r, tok):
        if self.current_round == r and tok == self._round_token and not self.result_shown:
            await self._end_round()

    async def _handle_guess(self, player, msg):
        if not self.started or self.result_shown:
            return
        r = self.current_round
        loc = self.locations.get(r)
        if not loc:
            return
        pid = player["id"]
        lat, lng = msg.get("lat"), msg.get("lng")
        dist_km = dscore = None
        if lat is not None and lng is not None:
            try:
                dist_km = _haversine(float(lat), float(lng), loc["lat"], loc["lng"])
                dscore  = _dist_score(dist_km, self.scale)
            except Exception:
                dist_km = dscore = None
        score = dscore or 0
        self.guesses[r][pid] = {
            "lat": lat, "lng": lng, "dist_km": dist_km,
            "dist_score": dscore or 0, "score": score,
        }
        # Live update for everyone else's map (no score leak).
        await self.ctx.broadcast({
            "type": "fy_guess_update",
            "player_id": pid,
            "display_name": player["display_name"],
            "avatar_svg": player.get("avatar_svg"),
            "avatar_color": player.get("avatar_color"),
            "lat": lat, "lng": lng,
        }, exclude=pid)
        await self._check_round_end()

    async def _check_round_end(self):
        if not self.started or self.result_shown:
            return
        connected = self.ctx.players()
        if not connected:
            return
        gs = self.guesses.get(self.current_round, {})
        if all(p["id"] in gs for p in connected):
            await self._end_round()

    async def _end_round(self):
        if self.result_shown:
            return
        self.result_shown = True
        r = self.current_round
        loc = self.locations.get(r, {})
        gs = self.guesses.get(r, {})
        results = []
        for p in self.ctx.all_players():
            pid = p["id"]
            g = gs.get(pid)
            score = g["score"] if g else 0
            self.totals[pid] = self.totals.get(pid, 0) + score
            results.append({
                "player_id": pid,
                "display_name": p["display_name"],
                "avatar_svg": p.get("avatar_svg"),
                "avatar_color": p.get("avatar_color"),
                "lat": g["lat"] if g else None,
                "lng": g["lng"] if g else None,
                "dist_km": g["dist_km"] if g else None,
                "dist_score": g["dist_score"] if g else 0,
                "score": score,
                "total": self.totals[pid],
            })
        results.sort(key=lambda x: x["score"], reverse=True)
        await self.ctx.broadcast({
            "type": "fy_round_end",
            "round": r,
            "total": self.rounds_total,
            "actual": {"lat": loc.get("lat"), "lng": loc.get("lng")},
            "results": results,
            "host_id": self.ctx.host_id,
        })

    async def _advance(self):
        nxt = self.current_round + 1
        if nxt > self.rounds_total:
            await self._finish()
        else:
            await self._start_round(nxt)

    async def _finish(self):
        standings = sorted(
            [{
                "player_id": p["id"],
                "display_name": p["display_name"],
                "avatar_svg": p.get("avatar_svg"),
                "avatar_color": p.get("avatar_color"),
                "total": self.totals.get(p["id"], 0),
            } for p in self.ctx.all_players()],
            key=lambda x: x["total"], reverse=True,
        )
        await self.ctx.broadcast({"type": "fy_game_over", "standings": standings})
        # Persist to Game Hub history.
        records = [{
            "player_id": s["player_id"],
            "score": s["total"],
            "rank": i + 1,
            "is_winner": i == 0 and len(standings) > 1,
        } for i, s in enumerate(standings)]
        await self.ctx.finish(records, metadata={
            "rounds": self.rounds_total,
            "time_per_round": self.time_per_round,
        })

    # ── state snapshot for (re)joiners ───────────────────────────────────────

    def _state_for(self, pid):
        r = self.current_round
        loc = self.locations.get(r, {})
        my = self.guesses.get(r, {}).get(pid)
        state = {
            "type": "fy_state",
            "started": self.started,
            "round": r,
            "total": self.rounds_total,
            "time": self.time_per_round,
            "api_key": self.api_key,
            "started_at": self.round_started_at,
            "country_center": self.country_center,
            "country_zoom": self.country_zoom,
            "result_shown": self.result_shown,
            "you_guessed": my is not None,
            "totals": self.totals,
        }
        if self.started and loc:
            state["location"] = {"lat": loc.get("lat"), "lng": loc.get("lng"), "heading": loc.get("heading", 0)}
        if self.result_shown:
            # Re-send the round results so a returning player sees them.
            gs = self.guesses.get(r, {})
            res = []
            for p in self.ctx.all_players():
                g = gs.get(p["id"])
                res.append({
                    "player_id": p["id"],
                    "display_name": p["display_name"],
                    "avatar_svg": p.get("avatar_svg"),
                    "avatar_color": p.get("avatar_color"),
                    "lat": g["lat"] if g else None,
                    "lng": g["lng"] if g else None,
                    "score": g["score"] if g else 0,
                    "total": self.totals.get(p["id"], 0),
                })
            res.sort(key=lambda x: x["score"], reverse=True)
            state["results"] = res
            state["actual"] = {"lat": loc.get("lat"), "lng": loc.get("lng")}
        return state
