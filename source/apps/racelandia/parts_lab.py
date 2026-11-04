"""Racelandia - the research team, the production line and the balance of the car.

Every part of the car has four segments: performance, efficiency, durability
and lightness. A segment is a number of points, 50 for the stock part. The
team researches a better design for one part: the player pays a flat price,
waits, and receives a report with the result, which he accepts (the design can
then be produced) or rejects. A modest push is nearly safe; a big one can
give much more, never for free and never guaranteed. A built part is stored in
the warehouse and is fitted to the car by hand. The server decides everything
here: the browser only shows it and applies the finished numbers to the lap.

This module knows nothing about the database; apex_data.py keeps the state.
"""
import random

SEGS = ("perf", "eff", "dur", "mass")
STOCK = 50.0
PARTS = ("engine", "gearbox", "battery", "brakes", "suspension", "floor", "frontWing", "rearWing")

# One flat price per research, whatever is asked of the team.
RESEARCH_COST = {"engine": 320_000, "gearbox": 160_000, "battery": 200_000, "brakes": 60_000,
                 "suspension": 90_000, "floor": 110_000, "frontWing": 60_000, "rearWing": 55_000}
# The first research of a simple part takes hours; every later one takes longer, up to days.
RESEARCH_HOURS = {"engine": 14, "gearbox": 8, "battery": 10, "brakes": 3,
                  "suspension": 5, "floor": 6, "frontWing": 3, "rearWing": 3}
RESEARCH_GROWTH = .35
RESEARCH_MAX_HOURS = 240
# Minutes to build one part of the first design; later designs are more complex.
BUILD_MINUTES = {"engine": 150, "gearbox": 90, "battery": 100, "brakes": 25,
                 "suspension": 45, "floor": 55, "frontWing": 25, "rearWing": 25}
BUILD_GROWTH = .12
BUILD_MAX_MINUTES = 3 * 24 * 60
MAX_BATCH = 4
MAX_QUEUE = 6
MAX_DESIGNS = 40
MAX_STORED_PARTS = 60

# How hard the team may be pushed. Up to SAFE points of ambition there is no risk at all.
SAFE = 8.0
LIMIT = 40.0
PUSH_MIN = -15
PUSH_MAX = 30


def stock_id(part):
    return f"{part}-1"


def stock_design(part):
    return {"id": stock_id(part), "part": part, "ver": 1, "stats": {s: STOCK for s in SEGS}, "stock": True}


def new_lab():
    return {"designs": [], "research": None, "queue": [], "done": {}, "next_ver": {}, "seq": 0}


def load_lab(raw):
    import json
    try:
        lab = json.loads(raw or "{}")
    except (TypeError, ValueError):
        lab = {}
    if not isinstance(lab, dict):
        lab = {}
    base = new_lab()
    for k in base:
        if k == "research":
            if isinstance(lab.get(k), dict):
                base[k] = lab[k]
        elif k in lab and isinstance(lab[k], type(base[k])):
            base[k] = lab[k]
    return base


def design_of(lab, part, design_id):
    """The design with that id; the stock part when it is unknown."""
    for g in lab["designs"]:
        if g["part"] == part and g["id"] == design_id:
            return g
    return stock_design(part)


def designs_of(lab, part):
    return [stock_design(part)] + [g for g in lab["designs"] if g["part"] == part]


# ── Prices and times ────────────────────────────────────────────────────────

def _points(stats):
    return sum(max(0.0, stats[s] - STOCK) for s in SEGS), sum(max(0.0, STOCK - stats[s]) for s in SEGS)


def cost_mult(stats):
    """A better part is made of dearer materials: the price climbs faster than the points do."""
    up, down = _points(stats)
    return max(.7, (1 + .012 * up + .0004 * up * up) * (1 - .002 * down))


def unit_cost(part, stats, base):
    return int(round(base * cost_mult(stats) / 1000.0) * 1000)


def build_seconds(part, ver, stats):
    up, _ = _points(stats)
    minutes = BUILD_MINUTES[part] * (1 + BUILD_GROWTH * (ver - 1)) * (1 + .006 * up)
    return int(min(BUILD_MAX_MINUTES, minutes) * 60)


def research_seconds(lab, part):
    hours = RESEARCH_HOURS[part] * (1 + RESEARCH_GROWTH * lab["done"].get(part, 0))
    return int(min(RESEARCH_MAX_HOURS, hours) * 3600)


# ── Research ────────────────────────────────────────────────────────────────

def clean_push(push):
    out = {}
    for s in SEGS:
        try:
            v = float((push or {}).get(s, 0))
        except (TypeError, ValueError, OverflowError):
            return None
        if v != v or v in (float("inf"), float("-inf")):
            return None
        out[s] = float(max(PUSH_MIN, min(PUSH_MAX, round(v))))
    return out


def ambition(push):
    """What is being asked of the team: the gains, eased a little by what the player gives up."""
    up = sum(max(0.0, v) for v in push.values())
    down = sum(max(0.0, -v) for v in push.values())
    return max(0.0, up - .6 * down)


def risk(push):
    return min(1.0, max(0.0, (ambition(push) - SAFE) / (LIMIT - SAFE)))


def success_chance(push):
    return 1 - .75 * risk(push) ** 1.2


_SIDE = {"perf": .9, "eff": 1.0, "dur": 1.2, "mass": .8}


def resolve(stats, push, seed):
    """The outcome of a research: a new set of segments. The same seed always gives the same report."""
    rnd = random.Random(seed)
    r = risk(push)
    ok = rnd.random() < success_chance(push)
    boost = (1 + .5 * r) if ok else .25
    out = dict(stats)
    gains = 0.0
    for s in SEGS:
        p = push[s]
        if p > 0:
            g = p * boost * rnd.uniform(.85, 1.1) / (1 + max(0.0, stats[s] - STOCK) / 60.0)
            out[s] += g
            gains += g
        elif p < 0:
            out[s] += p * rnd.uniform(.9, 1.1)
    if gains > 0:
        # the more that was pushed, the more the rest of the part pays for it
        side = gains * ((.05 + .75 * r) if ok else (.6 + .6 * r)) * rnd.uniform(.8, 1.2)
        pool = [s for s in SEGS if push[s] == 0]
        if pool:
            w = {s: _SIDE[s] * rnd.uniform(.3, 1.0) for s in pool}
            tot = sum(w.values())
            for s in pool:
                out[s] -= side * w[s] / tot
        else:
            for s in SEGS:
                if push[s] > 0:
                    out[s] -= side * push[s] / max(1.0, sum(max(0.0, v) for v in push.values()))
    return {s: round(max(5.0, out[s]), 1) for s in SEGS}


# ── The car as a whole ──────────────────────────────────────────────────────

_MASS_KG = {"engine": 10, "gearbox": 5, "battery": 8, "brakes": 3, "suspension": 4, "floor": 4, "frontWing": 2, "rearWing": 2}
_PACE = {("engine", "perf"): .030, ("engine", "eff"): .003, ("gearbox", "perf"): .006, ("gearbox", "eff"): .004,
         ("battery", "perf"): .010, ("battery", "eff"): .005, ("brakes", "perf"): .012, ("suspension", "perf"): .015,
         ("floor", "perf"): .015, ("floor", "eff"): .006, ("frontWing", "perf"): .008, ("rearWing", "perf"): .008,
         ("frontWing", "eff"): .003, ("rearWing", "eff"): .003}


def car_mods(stats):
    """What a set of fitted designs does to the car. `stats` maps each part to its segments."""
    def x(part, seg):
        return (stats.get(part, {}).get(seg, STOCK) - STOCK) / STOCK

    pw, br = x("engine", "perf"), x("brakes", "perf")
    grip = (x("suspension", "perf") + x("floor", "perf")) / 2
    strength = (x("gearbox", "dur") + x("gearbox", "eff")) / 2
    # Power the rest of the car cannot take: brakes fade, the rear loses grip, the gearbox suffers.
    over_brake = max(0.0, .8 * pw - br - .15)
    over_grip = max(0.0, pw - grip - .2)
    over_gear = max(0.0, .8 * pw - strength - .2)
    mass = -sum(kg * x(p, "mass") for p, kg in _MASS_KG.items())
    sim = {
        "pIce": 1 + .12 * pw, "fuelK": max(.5, 1 - .12 * x("engine", "eff")),
        "vmax": 1 + .03 * x("gearbox", "perf"), "gearK": 1 + .04 * x("gearbox", "eff"),
        "ersPK": max(.3, 1 + .25 * x("battery", "perf")), "ersK": max(.3, 1 + .3 * x("battery", "eff")),
        "brakeK": (1 + .10 * br) * (1 - .10 * min(1.0, over_brake)), "brakeWear": max(.2, 1 - .4 * x("brakes", "eff")),
        "suspK": (1 + .04 * x("suspension", "perf")) * (1 - .12 * min(1.5, over_grip)),
        "floorK": 1 + .10 * x("floor", "perf"),
        "fw": 1 + .12 * x("frontWing", "perf"), "rw": 1 + .12 * x("rearWing", "perf"),
        "cdw": (1 - .04 * x("floor", "eff")) * (1 - .025 * x("frontWing", "eff")) * (1 - .04 * x("rearWing", "eff")),
        "mass": mass,
    }
    wear = {p: max(.35, 1 - .35 * x(p, "dur")) for p in PARTS}
    wear["brakes"] *= 1 + 1.5 * over_brake
    wear["gearbox"] *= 1 + 1.2 * over_gear
    wear["suspension"] *= 1 + .5 * over_grip
    crash = {p: 1.0 for p in PARTS}
    crash["suspension"] = max(.4, 1 - .3 * x("suspension", "eff"))
    pace = sum(c * x(p, s) for (p, s), c in _PACE.items()) - mass * .0004
    pace -= .05 * min(1.5, over_grip) + .03 * min(1.0, over_brake) + .02 * min(1.0, over_gear)
    return {"sim": {k: round(v, 5) for k, v in sim.items()},
            "wear": {k: round(v, 4) for k, v in wear.items()}, "crash": {k: round(v, 4) for k, v in crash.items()},
            "pace": round(max(-.25, min(.4, pace)), 5),
            "balance": {"brake": round(over_brake, 3), "grip": round(over_grip, 3), "gear": round(over_gear, 3)}}


# ── Time passes ─────────────────────────────────────────────────────────────

def advance(lab, warehouse, now):
    """Finish what is due: a ready research report, the parts the line has built. True when anything changed."""
    changed = False
    r = lab.get("research")
    if r and r.get("status") == "running" and now >= r["done_at"]:
        base = design_of(lab, r["part"], r["base"])
        r["report"] = {"before": base["stats"], "after": resolve(base["stats"], r["push"], r["seed"])}
        r["status"] = "ready"
        changed = True
    for o in list(lab["queue"]):
        ready = min(o["qty"], int(max(0, now - o["start"]) // o["per_unit"]))
        for _ in range(ready - o["delivered"]):
            warehouse["seq"] += 1
            warehouse["parts"].append({"id": f"u{warehouse['seq']}", "part": o["part"], "design": o["design"], "wear": 0.0})
            changed = True
        if ready != o["delivered"]:
            o["delivered"] = ready
            changed = True
        if o["delivered"] >= o["qty"]:
            lab["queue"].remove(o)
            changed = True
    return changed
