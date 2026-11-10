"""Living Town server adapter for Game Hub.

The browser owns the live simulation. The server owns the starting rules and a
durable copy of the town. No wall-clock time passes while the town is closed.
"""

import sys
import time

AUTOSAVE_EVERY = 10.0

TUNING = {
    "world_size": 4200,
    # One representative day lasts twelve real minutes at 1x and advances the
    # demographic and economic simulation by one year.
    "days_per_second": 1 / 720,
    "adult_age": 18,
    "retire_age": 67,
    # At 140 km/h a vehicle crosses one 70-unit map cell in 0.25 real seconds
    # at 1x. A pedestrian at 5 km/h therefore needs 7 real seconds for it.
    "walk_speed": 10,
    # What walk_speed represents in real terms. Every vehicle's speed is
    # derived from this same ratio (see road_types.*.speed_kmh and the
    # bus/car code in mp.js), keeping movement and journey planning aligned.
    "walk_speed_kmh": 5,
    # Five workdays (Mon-Fri equivalent) out of every 7-day/year cycle, so the
    # remaining two are genuine days off with no work commute - this is what
    # makes park visits cluster on days off instead of competing with work.
    "work_days": 5,
    "work_start_hour": 8,
    "work_end_hour": 17,
    "work_income": 22,
    "living_cost": 4,
    # Either founder alone can finance the first private workplace (900) once
    # the player has chosen business land. This is seed capital, not municipal
    # money.
    "starter_money": 950,
    "starter_treasury": 0,
    # Every road occupies one full building cell (six visual strips). Road
    # types are built independently; changing a road means deleting it first.
    # speed_kmh is only the default a segment gets when built or repaved to
    # that tier - the player can then set any segment's own speed_kmh from
    # its panel, which is what vehicles actually use.
    "road_types": {
        "dirt": {"cost": 0, "width": 6, "sidewalks": True, "lanes": 0, "two_way": True, "pedestrian_access": True, "vehicle_access": False, "speed_kmh": 20},
        "oneway": {"cost": 3, "width": 6, "sidewalks": True, "lanes": 2, "two_way": False, "pedestrian_access": True, "vehicle_access": True, "speed_kmh": 40},
        "twoway": {"cost": 5, "width": 6, "sidewalks": True, "lanes": 2, "two_way": True, "pedestrian_access": True, "vehicle_access": True, "speed_kmh": 50},
        "avenue": {"cost": 9, "width": 6, "sidewalks": True, "lanes": 4, "two_way": True, "pedestrian_access": True, "vehicle_access": True, "speed_kmh": 70},
        "highway": {"cost": 11, "width": 6, "sidewalks": False, "lanes": 6, "two_way": True, "pedestrian_access": False, "vehicle_access": True, "speed_kmh": 110},
    },
    "zone_cost": 0,
    "private_build_cost": {"house": 480, "shop": 900},
    "private_build_days": {"house": 0.04, "shop": 0.04},
    "admin": {
        "clinic": {"cost": 4200, "jobs": 3, "wage": 34},
        "police": {"cost": 3600, "jobs": 3, "wage": 31},
        "fire": {"cost": 3800, "jobs": 3, "wage": 32},
    },
    "bus_stop_cost": 600,
    # Buying a bus (or upgrading a whole line to a bigger tier, once per bus
    # on it) is a full-price purchase, same "no partial credit" rule as road
    # tier upgrades.
    "bus_types": {
        "mini": {"cost": 1800, "capacity": 8},
        "standard": {"cost": 3200, "capacity": 20},
        "double": {"cost": 5200, "capacity": 34},
    },
    "bus_dwell_seconds": 4,
    "bus_fare": 2,
    # A car is a luxury: an upfront price plus a daily tax, both paid to the
    # town treasury, deliberately steeper than a bus fare so residents without
    # money keep riding the bus instead.
    "car_cost": 6000,
    "car_tax": 3,
    # Roads, bus stops and buses are not just a one-time purchase: every day
    # the treasury pays this fraction of each one's build/purchase cost as
    # upkeep (dirt roads cost 0 to build, so they cost 0 to maintain). This
    # is what makes overbuilding infrastructure ahead of the population that
    # would actually use it a losing move, not a free investment.
    "maintenance_rate": 0.01,
    # Happiness decays a little every day worked, recovers slowly at home and
    # recovers faster at a park - modest numbers on purpose, so a park trip is
    # a top-up, not a cure, and nobody needs to visit constantly.
    "happiness_start": 70,
    "happiness_work_decay": 3,
    "happiness_home_gain": 1,
    # Per park level (one level per cell the park was built with), per visit.
    "happiness_park_gain_per_level": 6,
    "happiness_seek_park": 55,
    "happiness_urgent_park": 30,
    "park_cost_per_cell": 900,
    # How long a park visit occupies someone's goal, in the same abstract
    # duration units as a home stay (see p.goal.duration in mp.js) - not real
    # hours. Kept shorter than a home stay so a visit stays a quick top-up.
    "park_visit_duration": 3,
    # Hours reserved for sleep each day when deciding if a special mid-week
    # park trip still leaves enough time before the next work departure.
    "sleep_hours": 8,
}


def _hub():
    return sys.modules['app_backend_gamehub']


def _new_town(language='en'):
    people = []
    buildings = []
    roads = []
    return {
        "version": 9, "start_country": _hub().name_country(language), "founding": True, "elapsed": 0, "day": 0, "year": 1,
        "treasury": TUNING["starter_treasury"], "tax_rate": 0.10,
        "people": people, "buildings": buildings, "roads": roads, "zones": [],
        "busStops": [], "busLines": [], "buses": [], "cars": [],
        "next_person": 1, "next_building": 1, "next_road": 1,
        "next_zone": 1, "next_zone_group": 1,
        "next_bus_stop": 1, "next_bus_line": 1, "next_bus": 1, "next_car": 1,
        "transit_version": 0,
        "events": [{"day": 0, "key": "lt_event_arrived"}],
    }


class Game:
    def __init__(self, ctx):
        self.ctx = ctx
        self.state = None
        self.last_written = -AUTOSAVE_EVERY
        self.wall = None
        self.over = False

    async def on_start(self, settings):
        saved = self.ctx.saved_state
        state = saved.get("state") if isinstance(saved, dict) and isinstance(saved.get("state"), dict) else None
        # Version 9 turns each visible day into one demographic/economic year.
        self.state = state if state and int(state.get("version", 0)) >= 9 else _new_town(settings.get("name_language", "en"))
        self.state.setdefault("start_country", _hub().name_country(settings.get("name_language", "en")))
        self.wall = {"real": time.time(), "elapsed": float(self.state.get("elapsed", 0))}
        await self.ctx.send(self.ctx.host_id, self._start())

    async def on_join(self, player):
        self.wall = {"real": time.time(), "elapsed": float(self.state.get("elapsed", 0))}
        await self.ctx.send(player["id"], self._start())

    async def on_leave(self, player):
        return

    async def on_message(self, player, msg):
        if msg.get("type") != "lt_state" or not isinstance(msg.get("state"), dict):
            return
        state = msg["state"]
        now = time.time()
        reported = float(state.get("elapsed", 0) or 0)
        real_dt = max(0, now - self.wall["real"])
        if reported - self.wall["elapsed"] > real_dt * 1.2 + 3:
            state["elapsed"] = self.wall["elapsed"] + real_dt
        self.wall = {"real": now, "elapsed": float(state.get("elapsed", 0))}
        self.state = state
        elapsed = float(state.get("elapsed", 0))
        if elapsed - self.last_written >= AUTOSAVE_EVERY:
            self.last_written = elapsed
            self.ctx.save_state(player["id"], {"state": state})

    def snapshot(self):
        return {"state": self.state} if self.state else None

    def _start(self):
        return {"type": "lt_start", "tuning": TUNING, "state": self.state, "solo": True,
                "name_catalogue": _hub().name_catalogue(), "name_display_rules": _hub().name_display_rules()}

    def snapshot_for_debug(self):
        return self.state
