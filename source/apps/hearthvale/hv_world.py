"""Hearthvale — the one shared world.

Game Hub gives every player their own solo room, and loads mp_game.py afresh
for each of them, so nothing that lives in mp_game.py is shared between two
players. This module is the shared part: mp_game.py loads it once per backend
process under a fixed name (see _world() there) and every room talks to the
same World instance. Game Hub itself knows nothing about it.

The server is deliberately light. It never ticks: it only answers what a
player does, checks that it is plausible and passes it on to everyone else who
is online. The world on disk is the seed the terrain grows from, the place
each player was last standing and what they carry, and what has been changed
in the valley: trees cut down, loose stones picked up and the piles people
left on the ground.

Trees and loose stones are grown by the client from the seed; the server never
holds a list of them. Their ids carry their position (decimetres), which is
all it needs to check that a player is standing next to what they act on.
"""

import json
import math
import os
import random
import re
import sqlite3
import time
import zlib

_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_DIR, "data.db")   # runtime database, never packaged

TUNING = {
    # The playable square, in metres, centred on the origin. The client shapes
    # the island so the sea starts before this edge.
    "world_size": 1400,
    # Client speeds; the server allows a margin on top of the fastest one
    # because a lagging socket delivers two moves at once.
    "walk_speed": 3.2,
    "run_speed": 7.0,
    "speed_slack": 1.5,
    "move_rate_hz": 10,
    # How often a moving player's position reaches the database. Leaving
    # always writes it.
    "persist_every": 15.0,
    # A player whose tab is gone and who has not come back within this many
    # seconds has their solo room closed, so Game Hub offers plain Play again
    # instead of "continue the run".
    "leave_grace": 45.0,
    # Water deeper than `wade` metres cannot be crossed on foot; with a sled
    # on the rope only water up to `sled_wade` can, the rest needs a bridge.
    "wade": 0.6,
    "sled_wade": 0.35,
    # How far from a player the thing they act on may be, in metres.
    "reach": 3.5,
    # Small things go in the backpack, one per slot. A log does not fit in
    # any backpack: it is carried in the hands, one at a time, at a walk.
    "pack_slots": 10,
    # Seconds of chopping a tree takes for someone with Woodcutting 1 and
    # Strength 1, by what is in the hand. The two levels added together divide
    # it: levels 1 and 1 give half of this, so a newcomer chops a tree in
    # 300 seconds with a stone and in 100 with an axe.
    "chop_seconds": {"stone": 600, "axe": 200},
    # Seconds of use a tool lasts before it breaks: an axe chops twelve
    # trees, a hoe digs about a hundred squares of new soil.
    "tool_life": {"axe": 1200, "hoe": 1800},
    # Everything is made the same way, on the ground: the player places its
    # frame, brings the materials to it, and takes the made thing from it.
    # A sled stays where it was built; a tool is picked up off its frame.
    "builds": {"axe": {"stone": 1, "log": 1}, "hoe": {"stone": 1, "log": 1},
               "bucket": {"log": 1}, "sled": {"log": 5}},
    # Tools a build needs without using them up, carried by whoever brings
    # the last material, and the seconds of wear the work costs them: a
    # bucket is carved out of a log with an axe.
    "build_tools": {"bucket": {"axe": 60}},
    # How much room a frame takes, in metres from its middle: two frames
    # stand at least the two rooms added together apart.
    "build_room": {"axe": 0.6, "hoe": 0.6, "bucket": 0.6, "sled": 1.5},
    # How far from a sled or a frame what is taken off it may be put down.
    "unload_reach": 6.0,
    # What things are. `kg` and `l` (litres) are for one piece. `slot` is how
    # many fit in one backpack slot (a slot holds about 3 litres) and `hand`
    # how many the hands carry; 0 means it does not go there at all. `life`
    # is the seconds a picked thing stays good: its quality falls from 1 to 0
    # over that time and what is rotten feeds nobody. Stone, logs and tools
    # do not change. `food` and `water` are what one fresh piece gives.
    "items": {
        "stone":   {"kg": 4.0,  "l": 3.0,  "slot": 1,  "hand": 1},
        "log":     {"kg": 15.0, "l": 30.0, "slot": 0,  "hand": 1},
        "axe":     {"kg": 2.0,  "l": 2.0,  "slot": 1,  "hand": 1},
        "hoe":     {"kg": 1.8,  "l": 2.5,  "slot": 1,  "hand": 1},
        "bucket":  {"kg": 1.5,  "l": 12.0, "slot": 0,  "hand": 1},
        "apple":   {"kg": 0.2,  "l": 0.3,  "slot": 10, "hand": 6,  "life": 259200,
                    "food": 16, "water": 4},
        "berries": {"kg": 0.1,  "l": 0.15, "slot": 20, "hand": 12, "life": 86400,
                    "food": 9, "water": 2},
    },
    # A sled: what it holds, in litres and kilograms, and what it accepts.
    "sled": {"litres": 360.0, "kg": 450.0, "accepts": ["stone", "log", "apple", "berries", "bucket"]},
    # Length of the rope between a sled and whoever pulls it, in metres.
    "rope": 2.4,
    # The client sends one chop tick per this many seconds while chopping.
    "chop_tick": 1.0,
    # Most items one pile on the ground holds before a new one is started.
    # A bucket lies on its own, so the water in each one stays its own.
    "pile_max": {"stone": 40, "log": 12, "apple": 60, "berries": 100, "bucket": 1},
    # Two piles of the same thing closer than this become one.
    "pile_merge": 1.6,
    # Skills. A level takes `base_seconds` of training to climb from level 1
    # and each next level takes `growth` times longer than the one before:
    # 15 minutes, then 1.8 times as long each time, up to level 10 (about 60
    # hours in all). `xp_rate` is seconds of progress per second of training.
    # A skill that is not used while its owner plays loses progress towards
    # its next level after `fade_after` seconds, `fade_rate` seconds of
    # progress per second played. A level, once reached, is never lost, and
    # time spent away from the game fades nothing.
    "skills": {"max_level": 10, "base_seconds": 900, "growth": 1.8, "xp_rate": 1.0,
               "fade_after": 600, "fade_rate": 0.1},
    # What the top level gives on top of level 1: Strength lets a player pull
    # up to three times as much, Stamina gives up to three times the energy.
    "bonus_at_max": 2.0,
    # Pulling a sled: a puller with Strength 1 moves up to `pull_kg` kilograms
    # on it, times the Strength boost. The load slows them in proportion,
    # down to `sled_min_speed` of their speed at that limit; more than the
    # limit cannot be pulled at all.
    "pull_kg": 150,
    "sled_min_speed": 0.10,
    # Needs: food, water and energy, all counted per second of play. Energy
    # is spent by what the player does and comes back only at rest.
    "needs": {
        "food_max": 100, "water_max": 100, "energy_base": 100,
        # Share of the maximum energy that comes back per second of rest.
        "regen": 0.006,
        # Below this share of food or water rest gives back half as much;
        # at zero it gives nothing and effort costs half as much again.
        "low": 25, "starved_cost": 1.5,
        # How long one report of an activity counts, in seconds. A player who
        # stands still sends nothing, so anything after this is rest.
        "act_window": 0.4, "chop_window": 1.5, "max_gap": 600,
        "pull_per_kg": 0.004,
        "rates": {
            "idle": {"food": 0.020, "water": 0.030, "energy": 0},
            "walk": {"food": 0.035, "water": 0.050, "energy": 0.10},
            "run":  {"food": 0.060, "water": 0.100, "energy": 1.00},
            "chop": {"food": 0.060, "water": 0.080, "energy": 0.25},
            "dig":  {"food": 0.060, "water": 0.080, "energy": 0.25},
            "pull": {"food": 0.045, "water": 0.070, "energy": 0.30},
        },
        "sync_every": 1.0,
    },
    # Fruit: `n` fruits on a bush ("b") or an apple tree ("t"), each giving
    # food and a little water, growing back `grow` seconds after it is picked.
    # `tree_share` of a thousand broadleaf trees carry apples.
    "fruit": {
        "b": {"n": 4, "food": 9, "water": 2},
        "t": {"n": 3, "food": 16, "water": 4},
        "grow": 600, "tree_share": 30, "bush_share": 100, "reach": 1.2,
    },
    # Water: a gulp gives `gulp`; at most one per `gap` seconds. A pond is
    # named by its centre and reached anywhere inside `pond_reach`, a river
    # by its nearest bend and reached within `river_reach`.
    "water": {"gulp": 25, "gap": 0.8, "pond_reach": 40, "river_reach": 12},
    # Fields. The ground is cut into squares `cell` metres wide; a player
    # marks the squares they want and digs each one with a hoe: `dig`
    # seconds for new soil and `retill` to loosen it again, both for someone
    # with Farming 1 and Strength 1 (the two levels together, halved,
    # multiply the speed). Fruit planted in loose soil grows into the plant
    # it came from, but only while the soil is loose (`till_life` seconds
    # after it was dug) and watered (`water_life` seconds after a bucket).
    # `grow` is the seconds of such care it needs to bear fruit, `regrow`
    # the care a picked fruit needs to be ripe again, `fruits` how many it
    # bears. A bucket holds `bucket` waterings. Each player may have at most
    # `plan_max` squares waiting to be dug, within `plan_reach` metres.
    "farm": {
        "cell": 1.5, "dig": 30, "retill": 10,
        "till_life": 43200, "water_life": 7200,
        "grow": {"berries": 1800, "apple": 5400}, "regrow": 900,
        "fruits": {"berries": 4, "apple": 3},
        "bucket": 8, "plan_max": 150, "plan_reach": 60,
    },
}

_ANIMS = {"idle", "walk", "run", "jump", "chop", "dig"}
_ITEMS = {"stone", "log"}   # plain things, stored as their name
_TOOLS = {"axe", "hoe"}     # worn by use, stored as {"k": name, "w": seconds left}
_VESSELS = {"bucket"}       # never wear out, stored as {"k": name, "w": waterings in it}
_KEPT = _TOOLS              # stay with the player: never put down or loaded
_FOOD = {"apple", "berries"}   # stacks: {"k", "n", "at"}, `at` when they were picked
_SMALL = {k for k, v in TUNING["items"].items() if v["slot"] > 0}   # fits a backpack slot
_TREE_RE = re.compile(r"^t(-?\d{1,6})_(-?\d{1,6})$")
_STONE_RE = re.compile(r"^s(-?\d{1,6})_(-?\d{1,6})$")
_FRUIT_RE = re.compile(r"^([tb])(-?\d{1,6})_(-?\d{1,6})$")
_WATER_RE = re.compile(r"^([pr])(-?\d{1,6})_(-?\d{1,6})$")
_CELL_RE = re.compile(r"^(-?\d{1,4})_(-?\d{1,4})$")
_CROP_RE = re.compile(r"^f(-?\d{1,4}_-?\d{1,4})$")   # fruit of a planted crop
SKILLS = ("woodcutting", "strength", "stamina", "farming")


def _pos_of(object_id: str, pattern) -> tuple | None:
    m = pattern.match(object_id or "") if isinstance(object_id, str) else None
    return (int(m.group(1)) / 10.0, int(m.group(2)) / 10.0) if m else None


def _tree_size(tree_id: str) -> float:
    # 0..1, fixed per tree. The client sizes the tree from the same number,
    # so a bigger tree on screen is a bigger tree here.
    return (zlib.crc32(tree_id.encode()) % 1000) / 1000.0


def _logs_of(tree_id: str) -> int:
    return 2 + int(_tree_size(tree_id) * 5)    # 2 to 6


def _bears_fruit(tree_id: str) -> bool:
    # Fixed per tree, like its size. The client shows apples only on a
    # broadleaf tree; the server cannot tell a pine from a broadleaf.
    return zlib.crc32((tree_id + "f").encode()) % 1000 < TUNING["fruit"]["tree_share"]


def _cell_of(key):
    """The centre of a field square from its key, "column_row" on the grid
    of squares, or None for anything else."""
    m = _CELL_RE.match(key) if isinstance(key, str) else None
    if m is None:
        return None
    c = TUNING["farm"]["cell"]
    x, z = (int(m.group(1)) + 0.5) * c, (int(m.group(2)) + 0.5) * c
    half = TUNING["world_size"] / 2
    return (round(x, 3), round(z, 3)) if abs(x) < half and abs(z) < half else None


def _crop_g(plot: dict, now: float) -> float:
    """Seconds of care the plant on a square has had up to now: time counts
    only while its soil is both loose and watered. The client works it out
    the same way, so nothing has to tick while it grows."""
    crop = plot.get("crop")
    if not crop:
        return 0.0
    f = TUNING["farm"]
    end = min(now, plot["wet"] + f["water_life"], plot["till"] + f["till_life"])
    return crop["g"] + max(0.0, end - crop["t"])


def _crop_settle(plot: dict, now: float):
    # Runs before the soil is watered or dug, so the care counted so far is
    # kept and the new watering or digging only counts from now on.
    crop = plot.get("crop")
    if crop:
        crop["g"] = round(_crop_g(plot, now), 2)
        crop["t"] = now


def _ripe(plot: dict, k: int, now: float) -> bool:
    """A fruit of a grown plant is ripe once the plant has had `regrow`
    seconds of care since it was last picked."""
    crop, f = plot["crop"], TUNING["farm"]
    g, full = _crop_g(plot, now), f["grow"][crop["k"]]
    if g < full:
        return False
    base = crop["pk"][k] if crop["pk"][k] is not None else full - f["regrow"]
    return g >= base + f["regrow"]


def _level(xp: float):
    """(level, xp into the level, xp the level takes) for a total of xp
    seconds of training. The top level takes nothing more."""
    cfg = TUNING["skills"]
    lvl, left = 1, max(0.0, xp)
    while lvl < cfg["max_level"]:
        need = cfg["base_seconds"] * cfg["growth"] ** (lvl - 1)
        if left < need:
            return lvl, left, need
        left -= need
        lvl += 1
    return lvl, 0.0, 0.0


def _floor(xp: float) -> float:
    """The training that took the player to the level they are on."""
    cfg = TUNING["skills"]
    lvl, left, total = 1, max(0.0, xp), 0.0
    while lvl < cfg["max_level"]:
        need = cfg["base_seconds"] * cfg["growth"] ** (lvl - 1)
        if left < need:
            break
        left -= need; total += need; lvl += 1
    return total


def _boost(level: int) -> float:
    """1 at level 1, growing evenly to 1 + bonus_at_max at the top level."""
    return 1.0 + (level - 1) * TUNING["bonus_at_max"] / (TUNING["skills"]["max_level"] - 1)


def _clean_skills(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    return {k: _num(raw.get(k), 0, 1e9, 0.0) for k in SKILLS}


def _kind(item):
    if isinstance(item, dict):
        return item.get("k")
    return item


def _count(item) -> int:
    return item["n"] if isinstance(item, dict) and item.get("k") in _FOOD else (1 if item else 0)


def _quality(item, now: float) -> float:
    """1 for something fresh, 0 for something rotten; 1 forever for what
    does not spoil."""
    life = TUNING["items"].get(_kind(item), {}).get("life") if item else None
    if not life or not isinstance(item, dict):
        return 1.0
    return max(0.0, min(1.0, 1.0 - (now - item["at"]) / life))


def _merged_at(n1: int, at1: float, n2: int, at2: float) -> float:
    return (at1 * n1 + at2 * n2) / (n1 + n2)


def _unit_of(kind: str, at: float):
    """One piece of `kind` as it is kept in the hands, the backpack or on a
    sled. Wherever a piece travels on its own, `at` goes with it: when fruit
    was picked, or how many waterings a bucket holds."""
    if kind in _VESSELS:
        return {"k": kind, "w": int(_num(at, 0, TUNING["farm"]["bucket"], 0))}
    return kind


def _unit_at(item) -> float:
    kind = _kind(item)
    if kind in _FOOD:
        return item["at"]
    if kind in _VESSELS:
        return float(item["w"])
    return 0.0


def _weight(item) -> tuple:
    """(kilograms, litres) of one inventory or sled entry."""
    it = TUNING["items"].get(_kind(item))
    if it is None:
        return 0.0, 0.0
    n = _count(item)
    return it["kg"] * n, it["l"] * n


def _load_totals(load) -> tuple:
    kg = l = 0.0
    for e in load:
        a, b = _weight(e)
        kg += a
        l += b
    return kg, l


def _clean_item(item):
    if isinstance(item, str):
        return item if item in _ITEMS else None
    if isinstance(item, dict) and item.get("k") in _FOOD:
        cap = TUNING["items"][item["k"]]["slot"]
        n = int(_num(item.get("n"), 0, cap, 0))
        return {"k": item["k"], "n": n, "at": _num(item.get("at"), 0, 1e12, time.time())} if n > 0 else None
    if isinstance(item, dict) and item.get("k") in _TOOLS:
        w = _num(item.get("w"), 0, TUNING["tool_life"][item["k"]], 0)
        return {"k": item["k"], "w": w} if w > 0 else None
    if isinstance(item, dict) and item.get("k") in _VESSELS:
        return {"k": item["k"], "w": int(_num(item.get("w"), 0, TUNING["farm"]["bucket"], 0))}
    return None


def _new_inventory() -> dict:
    # A newcomer starts with one stone in the backpack — the first tool.
    pack = [None] * TUNING["pack_slots"]
    pack[0] = "stone"
    return {"hand": None, "pack": pack}


def _clean_inventory(raw) -> dict:
    inv = _new_inventory()
    if not isinstance(raw, dict):
        return inv
    inv["hand"] = _clean_item(raw.get("hand"))
    pack = raw.get("pack") if isinstance(raw.get("pack"), list) else []
    items = list(map(_clean_item, pack[:TUNING["pack_slots"]]))
    # What no longer fits a backpack (a bucket once did) goes to the hands,
    # or is put on the ground when the player comes in.
    spill = [x for x in items if x is not None and _kind(x) not in _SMALL]
    if spill and inv["hand"] is None:
        inv["hand"] = spill.pop(0)
    if spill:
        inv["spill"] = spill
    inv["pack"] = [(x if _kind(x) in _SMALL else None) for x in items]
    inv["pack"] += [None] * (TUNING["pack_slots"] - len(inv["pack"]))
    return inv


def _conn():
    conn = sqlite3.connect(_DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def _num(v, lo, hi, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:   # NaN
        return default
    return max(lo, min(hi, f))


class World:
    def __init__(self):
        with _conn() as conn:
            conn.execute("""CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY, value TEXT NOT NULL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS players (
                player_id TEXT PRIMARY KEY,
                x REAL, y REAL, z REAL, ry REAL,
                updated_at REAL)""")
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(players)")}
            if "inv" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN inv TEXT")
            if "skills" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN skills TEXT")
            if "needs" not in cols:
                conn.execute("ALTER TABLE players ADD COLUMN needs TEXT")
            # When each fruit was last picked; it is ripe again after a while.
            conn.execute("""CREATE TABLE IF NOT EXISTS fruit_taken (
                src TEXT NOT NULL, k INTEGER NOT NULL, at REAL NOT NULL,
                PRIMARY KEY (src, k))""")
            conn.execute("""CREATE TABLE IF NOT EXISTS felled (
                tree_id TEXT PRIMARY KEY, at REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS chopping (
                tree_id TEXT PRIMARY KEY, progress REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS taken_stones (
                stone_id TEXT PRIMARY KEY, at REAL)""")
            conn.execute("""CREATE TABLE IF NOT EXISTS piles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, n INTEGER NOT NULL,
                x REAL NOT NULL, z REAL NOT NULL)""")
            pcols = {r["name"] for r in conn.execute("PRAGMA table_info(piles)")}
            if "at" not in pcols:   # when the fruit in a pile was picked
                conn.execute("ALTER TABLE piles ADD COLUMN at REAL NOT NULL DEFAULT 0")
            # Things built on the ground. A frame is kind "site" until its
            # materials are in; data holds what is made, what was brought, and
            # for a sled what it carries.
            conn.execute("""CREATE TABLE IF NOT EXISTS builds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                kind TEXT NOT NULL, x REAL NOT NULL, z REAL NOT NULL,
                ry REAL NOT NULL, data TEXT NOT NULL)""")
            # Chopping times doubled when skills arrived (levels 1 and 1 halve
            # them again), so a tree half chopped before stays half chopped.
            if conn.execute("SELECT 1 FROM meta WHERE key='chop_x2'").fetchone() is None:
                conn.execute("UPDATE chopping SET progress = progress * 2")
                conn.execute("INSERT INTO meta(key,value) VALUES('chop_x2','1')")
            row = conn.execute("SELECT value FROM meta WHERE key='seed'").fetchone()
            if row is None:
                seed = random.randint(1, 2_000_000_000)
                conn.execute("INSERT INTO meta(key,value) VALUES('seed',?)", (str(seed),))
            else:
                seed = int(row["value"])
            conn.commit()
            self.felled = {r["tree_id"] for r in conn.execute("SELECT tree_id FROM felled")}
            self.chopped = {r["tree_id"]: r["progress"] for r in conn.execute("SELECT * FROM chopping")}
            self.taken = {r["stone_id"] for r in conn.execute("SELECT stone_id FROM taken_stones")}
            self.fruit = {(r["src"], r["k"]): r["at"] for r in conn.execute("SELECT src,k,at FROM fruit_taken")}
            self.piles = {r["id"]: dict(r) for r in conn.execute("SELECT id,kind,n,x,z,at FROM piles")}
            # Field squares, by their key on the grid: marked, dug, planted.
            conn.execute("""CREATE TABLE IF NOT EXISTS plots (
                c TEXT PRIMARY KEY, data TEXT NOT NULL)""")
            self.plots = {r["c"]: json.loads(r["data"]) for r in conn.execute("SELECT c,data FROM plots")}
            self.builds = {}
            for r in conn.execute("SELECT * FROM builds"):
                b = {"id": r["id"], "kind": r["kind"], "x": r["x"], "z": r["z"], "ry": r["ry"], "by": None}
                b.update(json.loads(r["data"]))
                self.builds[b["id"]] = b
        self.seed = seed
        # player_id -> live state of everyone online right now
        self.online: dict[str, dict] = {}

    # ── persistence ─────────────────────────────────────────────────────────
    def _load_pos(self, pid: str):
        with _conn() as conn:
            r = conn.execute("SELECT x,y,z,ry,inv,skills,needs FROM players WHERE player_id=?", (pid,)).fetchone()
        return dict(r) if r else None

    def _store_inv(self, p: dict):
        """What the player carries, knows and needs; skills and needs ride
        along because they change as often as the inventory does."""
        n = p["needs"]
        needs = {k: round(n[k], 2) for k in ("food", "water", "energy")}
        with _conn() as conn:
            conn.execute(
                """INSERT INTO players(player_id,inv,skills,needs,updated_at) VALUES(?,?,?,?,?)
                   ON CONFLICT(player_id) DO UPDATE SET
                     inv=excluded.inv, skills=excluded.skills, needs=excluded.needs""",
                (p["id"], json.dumps(p["inv"]),
                 json.dumps({k: round(v, 1) for k, v in p["skills"].items()}),
                 json.dumps(needs), time.time()),
            )
            conn.commit()
        p["stats_saved"] = time.time()

    def _store_build(self, b: dict):
        data = {k: v for k, v in b.items() if k not in ("id", "kind", "x", "z", "ry", "by")}
        with _conn() as conn:
            if b.get("gone"):
                conn.execute("DELETE FROM builds WHERE id=?", (b["id"],))
            elif b["id"] is None:
                cur = conn.execute("INSERT INTO builds(kind,x,z,ry,data) VALUES(?,?,?,?,?)",
                                   (b["kind"], b["x"], b["z"], b["ry"], json.dumps(data)))
                b["id"] = cur.lastrowid
            else:
                conn.execute("UPDATE builds SET kind=?,x=?,z=?,ry=?,data=? WHERE id=?",
                             (b["kind"], b["x"], b["z"], b["ry"], json.dumps(data), b["id"]))
            conn.commit()

    def _store_plots(self, plots: list):
        with _conn() as conn:
            for pl in plots:
                if pl.get("gone"):
                    conn.execute("DELETE FROM plots WHERE c=?", (pl["c"],))
                else:
                    conn.execute("INSERT OR REPLACE INTO plots(c,data) VALUES(?,?)", (pl["c"], json.dumps(pl)))
            conn.commit()

    def _store_pile(self, pile: dict):
        with _conn() as conn:
            if pile["n"] <= 0:
                conn.execute("DELETE FROM piles WHERE id=?", (pile["id"],))
            else:
                conn.execute("UPDATE piles SET n=?, at=? WHERE id=?", (pile["n"], pile["at"], pile["id"]))
            conn.commit()

    def _new_pile(self, kind: str, n: int, x: float, z: float, at: float = 0.0) -> dict:
        with _conn() as conn:
            cur = conn.execute("INSERT INTO piles(kind,n,x,z,at) VALUES(?,?,?,?,?)", (kind, n, x, z, at))
            conn.commit()
            pile = {"id": cur.lastrowid, "kind": kind, "n": n, "x": x, "z": z, "at": at}
        self.piles[pile["id"]] = pile
        return pile

    def _store_pos(self, p: dict):
        with _conn() as conn:
            conn.execute(
                """INSERT INTO players(player_id,x,y,z,ry,updated_at) VALUES(?,?,?,?,?,?)
                   ON CONFLICT(player_id) DO UPDATE SET
                     x=excluded.x, y=excluded.y, z=excluded.z, ry=excluded.ry,
                     updated_at=excluded.updated_at""",
                (p["id"], p["x"], p["y"], p["z"], p["ry"], time.time()),
            )
            conn.commit()
        p["saved_at"] = time.time()

    # ── helpers ─────────────────────────────────────────────────────────────
    @staticmethod
    def _public(p: dict) -> dict:
        return {
            "id": p["id"], "name": p["name"], "color": p["color"],
            "x": p["x"], "y": p["y"], "z": p["z"], "ry": p["ry"], "a": p["anim"],
            "h": _kind(p["inv"]["hand"]),
        }

    async def _to_others(self, pid: str, msg: dict):
        for other in list(self.online.values()):
            if other["id"] != pid:
                await other["ctx"].send(other["id"], msg)

    async def _to_all(self, msg: dict):
        for other in list(self.online.values()):
            await other["ctx"].send(other["id"], msg)

    async def _nope(self, p: dict, reason: str):
        await p["ctx"].send(p["id"], {"type": "hv_nope", "reason": reason})

    async def _inv_changed(self, p: dict, hand_before):
        self._store_inv(p)
        await p["ctx"].send(p["id"], {"type": "hv_inv", "inv": p["inv"]})
        if _kind(p["inv"]["hand"]) != _kind(hand_before):
            await self._to_others(p["id"], {"type": "hv_held", "id": p["id"], "h": _kind(p["inv"]["hand"])})

    @staticmethod
    def _near(p: dict, x: float, z: float, extra: float = 0.0) -> bool:
        if p["x"] is None:
            return False
        return ((p["x"] - x) ** 2 + (p["z"] - z) ** 2) ** 0.5 <= TUNING["reach"] + extra

    def _world_state(self) -> dict:
        return {
            "felled": sorted(self.felled),
            "taken": sorted(self.taken),
            "piles": list(self.piles.values()),
            "builds": list(self.builds.values()),
            "plots": list(self.plots.values()),
            # Fruit still growing back, and the server's clock to time it by.
            "fruit": [[s, k, at] for (s, k), at in self.fruit.items()
                      if time.time() - at < TUNING["fruit"]["grow"]],
            "now": time.time(),
        }

    # ── skills and needs ────────────────────────────────────────────────────
    @staticmethod
    def _lvl(p: dict, skill: str) -> int:
        return _level(p["skills"][skill])[0]

    def _emax(self, p: dict) -> float:
        return TUNING["needs"]["energy_base"] * _boost(self._lvl(p, "stamina"))

    def _needs_view(self, p: dict) -> dict:
        n = p["needs"]
        return {"food": round(n["food"], 1), "water": round(n["water"], 1),
                "energy": round(n["energy"], 1), "emax": round(self._emax(p), 1)}

    def _skills_view(self, p: dict) -> dict:
        return {k: round(v, 1) for k, v in p["skills"].items()}

    def _settle(self, p: dict, now: float):
        """Bring food, water and energy up to now. The server never ticks, so
        this runs whenever the player does something: the time since the last
        run is spent on what they were last doing for as long as that report
        counts, and the rest of it at rest."""
        cfg = TUNING["needs"]
        n = p["needs"]
        last = p["needs_t"]
        gap = min(now - last, cfg["max_gap"])
        p["needs_t"] = now
        if gap <= 0:
            return
        self._fade(p, now, last, gap)
        emax = self._emax(p)
        starved = n["food"] <= 0 or n["water"] <= 0
        low = min(n["food"], n["water"]) < cfg["low"]
        act_dt = min(max(0.0, min(now, p["act_until"]) - last), gap)
        idle_dt = gap - act_dt
        if act_dt > 0:
            r = cfg["rates"][p["act"]]
            cost = r["energy"]
            if p["act"] == "pull":
                sled = self.builds.get(p["pull"]) if p["pull"] is not None else None
                cost += cfg["pull_per_kg"] * _load_totals(sled.get("load", []))[0] if sled else 0
            n["food"] -= r["food"] * act_dt
            n["water"] -= r["water"] * act_dt
            n["energy"] -= cost * (cfg["starved_cost"] if starved else 1) * act_dt
        if idle_dt > 0:
            r = cfg["rates"]["idle"]
            n["food"] -= r["food"] * idle_dt
            n["water"] -= r["water"] * idle_dt
            if not starved:
                n["energy"] += cfg["regen"] * emax * idle_dt * (0.5 if low else 1)
        n["food"] = max(0.0, min(cfg["food_max"], n["food"]))
        n["water"] = max(0.0, min(cfg["water_max"], n["water"]))
        n["energy"] = max(0.0, min(emax, n["energy"]))

    def _fade(self, p: dict, now: float, last: float, gap: float):
        """Skills not used for a while, while playing, lose some progress."""
        cfg = TUNING["skills"]
        for k in SKILLS:
            idle = min(gap, now - max(last, p["skill_t"][k] + cfg["fade_after"]))
            if idle > 0:
                xp = p["skills"][k]
                p["skills"][k] = max(_floor(xp), xp - idle * cfg["fade_rate"])

    def _busy(self, p: dict, act: str, now: float):
        cfg = TUNING["needs"]
        p["act"] = act
        p["act_until"] = now + (cfg["chop_window"] if act in ("chop", "dig") else cfg["act_window"] if act != "idle" else 0)

    async def _push_needs(self, p: dict, now: float, force: bool = False):
        if force or now - p["needs_sent"] >= TUNING["needs"]["sync_every"]:
            p["needs_sent"] = now
            await p["ctx"].send(p["id"], {"type": "hv_needs", "needs": self._needs_view(p),
                                          "skills": self._skills_view(p)})

    async def _train(self, p: dict, skill: str, seconds: float, now: float):
        """Seconds of doing the thing that trains `skill`. The client is told
        about it about once a second, and at once when a level is gained."""
        cfg = TUNING["skills"]
        before = _level(p["skills"][skill])[0]
        if before >= cfg["max_level"] or seconds <= 0:
            return
        p["skills"][skill] += seconds * cfg["xp_rate"]
        p["skill_t"][skill] = now
        up = _level(p["skills"][skill])[0] > before
        if up or now - p["skill_sent"].get(skill, 0.0) >= 1.0:
            p["skill_sent"][skill] = now
            await p["ctx"].send(p["id"], {"type": "hv_skill", "k": skill,
                                          "xp": round(p["skills"][skill], 1), "up": up})
        if up:
            self._store_inv(p)
            if skill == "stamina":
                await self._push_needs(p, now, True)
        elif now - p["stats_saved"] > TUNING["persist_every"]:
            self._store_inv(p)

    def _sled_pull(self, p: dict, sled) -> float:
        """How fast the player can pull this sled, as a share of their speed:
        1 with nothing on it, less with every kilogram loaded, 0 when it is
        more than they can pull at all."""
        kg = _load_totals(sled.get("load", []))[0]
        limit = TUNING["pull_kg"] * _boost(self._lvl(p, "strength"))
        if kg > limit:
            return 0.0
        return max(TUNING["sled_min_speed"], 1.0 - (1.0 - TUNING["sled_min_speed"]) * kg / limit)

    # ── what players do ─────────────────────────────────────────────────────
    async def enter(self, ctx, player: dict, three_url: str):
        """A player's socket is in the world (first time or after reconnect)."""
        pid = str(player["id"])
        prev = self.online.get(pid)
        pos = prev or self._load_pos(pid)
        now = time.time()
        p = {
            "id": pid,
            "name": player.get("display_name") or "?",
            "color": player.get("avatar_color") or "#89b4fa",
            "ctx": ctx,
            "x": pos["x"] if pos else None,
            "y": pos["y"] if pos else 0.0,
            "z": pos["z"] if pos else None,
            "ry": pos["ry"] if pos else 0.0,
            "anim": "idle",
            "t": time.time(),
            "saved_at": time.time(),
            "inv": prev["inv"] if prev else _clean_inventory(
                json.loads(pos["inv"]) if pos and pos.get("inv") else None),
            "chop": None,   # {"tree", "at"} while this player is chopping
            "dig": None,    # {"c", "at"} while this player is digging a square
            "pull": prev["pull"] if prev else None,   # id of the sled they pull
            "skills": prev["skills"] if prev else _clean_skills(
                json.loads(pos["skills"]) if pos and pos.get("skills") else None),
            "needs": prev["needs"] if prev else None,
            "needs_t": now, "act": "idle", "act_until": 0.0, "needs_sent": 0.0,
            "skill_sent": {}, "skill_t": dict.fromkeys(SKILLS, now), "stats_saved": now, "drink_at": 0.0,
        }
        if p["needs"] is None:
            saved = json.loads(pos["needs"]) if pos and pos.get("needs") else {}
            cfg = TUNING["needs"]
            p["needs"] = {"food": _num(saved.get("food"), 0, cfg["food_max"], cfg["food_max"]),
                          "water": _num(saved.get("water"), 0, cfg["water_max"], cfg["water_max"]),
                          "energy": _num(saved.get("energy"), 0, 1e9, self._emax(p))}
            p["needs"]["energy"] = min(p["needs"]["energy"], self._emax(p))
        spill = p["inv"].pop("spill", None)
        if spill:
            for it in spill:
                await self._to_ground(_kind(it), 1, _unit_at(it), p["x"] or 0.0, p["z"] or 0.0)
        if spill or (prev is None and not (pos and pos.get("skills"))):
            self._store_inv(p)
        self.online[pid] = p
        await ctx.send(pid, {
            "type": "hv_welcome",
            "seed": self.seed,
            "tuning": TUNING,
            "three": three_url,
            "you": self._public(p),
            "spawn": p["x"] is None,
            "peers": [self._public(o) for o in self.online.values() if o["id"] != pid],
            "inv": p["inv"],
            "skills": self._skills_view(p),
            "needs": self._needs_view(p),
            "world": self._world_state(),
        })
        if prev is None:
            await self._to_others(pid, {"type": "hv_join", "peer": self._public(p)})

    async def leave(self, ctx, pid: str):
        """The socket of this room went away. A newer room of the same player
        may already have taken their place; only the owner of the entry may
        remove it."""
        p = self.online.get(pid)
        if p is None or p["ctx"] is not ctx:
            return
        if p["x"] is not None:
            self._store_pos(p)
        self._settle(p, time.time())
        self._store_inv(p)
        self._store_chop()
        await self._let_go(p)
        self.online.pop(pid, None)
        await self._to_others(pid, {"type": "hv_leave", "id": pid})

    def is_online_via(self, ctx, pid: str) -> bool:
        p = self.online.get(pid)
        return p is not None and p["ctx"] is ctx

    async def move(self, pid: str, msg: dict):
        p = self.online.get(pid)
        if p is None:
            return
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half)
        z = _num(msg.get("z"), -half, half)
        y = _num(msg.get("y"), -20, 80)
        ry = _num(msg.get("ry"), -1000, 1000) % 6.283185307179586
        anim = msg.get("a") if msg.get("a") in _ANIMS else "idle"
        now = time.time()
        self._settle(p, now)

        if p["x"] is not None:
            # A move faster than anyone can run is refused, and the player is
            # put back where the server last saw them.
            dt = max(now - p["t"], 1.0 / TUNING["move_rate_hz"])
            limit = TUNING["run_speed"] * TUNING["speed_slack"] * dt + 1.0
            if ((x - p["x"]) ** 2 + (z - p["z"]) ** 2) ** 0.5 > limit:
                await p["ctx"].send(pid, {"type": "hv_snap", "x": p["x"], "y": p["y"], "z": p["z"]})
                p["t"] = now
                return

        step = ((x - p["x"]) ** 2 + (z - p["z"]) ** 2) ** 0.5 if p["x"] is not None else 0.0
        trained = min(max(now - p["t"], 0.0), TUNING["needs"]["act_window"])
        p.update(x=x, y=y, z=z, ry=ry, anim=anim, t=now)
        sled = self.builds.get(p["pull"]) if p["pull"] is not None else None
        # What this move costs and trains: pulling a loaded sled trains
        # Strength, running while there is energy left trains Stamina.
        if step > 0.03 and anim not in ("chop", "dig"):
            act = "pull" if sled is not None else "run" if anim == "run" else "walk"
        else:
            act = "idle"
        self._busy(p, act, now)
        if act == "pull" and sled.get("load"):
            await self._train(p, "strength", trained, now)
        elif act == "run" and p["needs"]["energy"] > 0:
            await self._train(p, "stamina", trained, now)
        if sled is not None:
            # The rope: the sled stays where it is until the rope is taut,
            # then it slides after the player. Every client does the same.
            dx, dz = sled["x"] - x, sled["z"] - z
            d = (dx * dx + dz * dz) ** 0.5
            if d > TUNING["rope"]:
                sled["x"] = round(x + dx / d * TUNING["rope"], 2)
                sled["z"] = round(z + dz / d * TUNING["rope"], 2)
                sled["ry"] = round(math.atan2(-dx, -dz), 3)
        await self._to_others(pid, {"type": "hv_move", "id": pid,
                                    "x": round(x, 2), "y": round(y, 2), "z": round(z, 2),
                                    "ry": round(ry, 3), "a": anim})
        if now - p["saved_at"] > TUNING["persist_every"]:
            self._store_pos(p)
            self._store_inv(p)
            if sled is not None:
                self._store_build(sled)
        await self._push_needs(p, now)

    # ── gathering ───────────────────────────────────────────────────────────
    def _store_chop(self):
        with _conn() as conn:
            conn.executemany(
                """INSERT INTO chopping(tree_id,progress) VALUES(?,?)
                   ON CONFLICT(tree_id) DO UPDATE SET progress=excluded.progress""",
                list(self.chopped.items()),
            )
            conn.commit()

    async def chop(self, pid: str, msg: dict):
        """One tick of chopping. Time counts only between two ticks of the
        same player on the same tree, never more than a tick and a bit, so a
        client cannot claim more chopping than it spent next to the tree."""
        p = self.online.get(pid)
        if p is None:
            return
        tree = msg.get("tree")
        pos = _pos_of(tree, _TREE_RE)
        if pos is None or tree in self.felled:
            return
        if not self._near(p, *pos):
            p["chop"] = None
            return await self._nope(p, "far")
        hand = p["inv"]["hand"]
        tool = _kind(hand)
        need = TUNING["chop_seconds"].get(tool)
        if need is None:
            p["chop"] = None
            return await self._nope(p, "need_stone")
        now = time.time()
        self._settle(p, now)
        if p["needs"]["energy"] <= 0:
            p["chop"] = None
            self._busy(p, "idle", now)
            await self._push_needs(p, now, True)
            return await self._nope(p, "tired")
        last = p["chop"]
        gained = 0.0
        if last and last["tree"] == tree:
            gained = min(now - last["at"], TUNING["chop_tick"] * 1.5)
        p["chop"] = {"tree": tree, "at": now}
        self._busy(p, "chop", now)
        # Chopping trains Woodcutting only; Strength helps without training.
        await self._train(p, "woodcutting", gained, now)
        before = self.chopped.get(tree, 0.0)
        # Progress is kept in seconds of stone at levels 1 and 1; a better
        # tool and the two levels together add more per second.
        speed = self._lvl(p, "woodcutting") + self._lvl(p, "strength")
        done = before + gained * (TUNING["chop_seconds"]["stone"] / need) * speed
        full = TUNING["chop_seconds"]["stone"]
        if isinstance(hand, dict) and gained > 0:
            # A tool wears by the seconds it is used and breaks at zero.
            hand["w"] = round(hand["w"] - gained, 2)
            if hand["w"] <= 0:
                p["inv"]["hand"] = None
                p["chop"] = None
                self.chopped[tree] = min(done, full - 0.01)
                self._store_chop()
                await p["ctx"].send(pid, {"type": "hv_broke", "item": tool})
                return await self._inv_changed(p, hand)
            await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})
            if int(hand["w"]) // 10 != int(hand["w"] + gained) // 10:
                self._store_inv(p)
        if done < full:
            self.chopped[tree] = done
            if int(done // 10) != int(before // 10):
                self._store_chop()
            await p["ctx"].send(pid, {"type": "hv_chop_p", "tree": tree, "p": done / full})
            await self._push_needs(p, now)
            return

        # The tree comes down: its wood lands beside the stump as one pile.
        self.chopped.pop(tree, None)
        self.felled.add(tree)
        p["chop"] = None
        with _conn() as conn:
            conn.execute("INSERT OR IGNORE INTO felled(tree_id,at) VALUES(?,?)", (tree, now))
            conn.execute("DELETE FROM chopping WHERE tree_id=?", (tree,))
            conn.commit()
        if isinstance(hand, dict):
            self._store_inv(p)
        n = _logs_of(tree)
        pile = self._new_pile("log", n, round(pos[0] + 1.3, 2), round(pos[1], 2))
        await self._to_all({"type": "hv_felled", "tree": tree, "by": pid, "pile": pile})

    async def pick(self, pid: str, msg: dict):
        """Pick up one thing: a loose stone, or the top item of a pile."""
        p = self.online.get(pid)
        if p is None:
            return
        if msg.get("build") is not None:
            b = self._build_of(p, msg)
            return await (self.take_off(p, b, msg) if b else self._nope(p, "far"))
        inv = p["inv"]
        hand_before = inv["hand"]
        if msg.get("stone") is not None:
            stone = msg.get("stone")
            pos = _pos_of(stone, _STONE_RE)
            if pos is None or stone in self.taken:
                return
            if not self._near(p, *pos):
                return await self._nope(p, "far")
            if not self._put(inv, "stone"):
                return await self._nope(p, "full")
            self.taken.add(stone)
            with _conn() as conn:
                conn.execute("INSERT OR IGNORE INTO taken_stones(stone_id,at) VALUES(?,?)", (stone, time.time()))
                conn.commit()
            await self._to_all({"type": "hv_stone_taken", "id": stone})
            return await self._inv_changed(p, hand_before)

        pile = self.piles.get(msg.get("pile")) if isinstance(msg.get("pile"), int) else None
        if pile is None:
            return
        if not self._near(p, pile["x"], pile["z"]):
            return await self._nope(p, "far")
        moved = 0
        for _ in range(300 if msg.get("all") else 1):
            if pile["n"] <= 0:
                break
            if pile["kind"] in _FOOD:
                if self._add_food(inv, pile["kind"], 1, pile["at"]):
                    break
            elif not self._put(inv, _unit_of(pile["kind"], pile["at"])):
                break
            pile["n"] -= 1
            moved += 1
        if not moved:
            return await self._nope(p, "hands_full" if pile["kind"] not in _SMALL else "full")
        self._store_pile(pile)
        if pile["n"] <= 0:
            self.piles.pop(pile["id"], None)
            await self._to_all({"type": "hv_pile_gone", "id": pile["id"]})
        else:
            await self._to_all({"type": "hv_pile", "pile": pile})
        await self._inv_changed(p, hand_before)

    @staticmethod
    def _put(inv: dict, item) -> bool:
        # A small thing goes to the backpack first and to the hands only when
        # the backpack is full; anything else needs empty hands.
        if _kind(item) in _SMALL and None in inv["pack"]:
            inv["pack"][inv["pack"].index(None)] = item
            return True
        if inv["hand"] is None:
            inv["hand"] = item
            return True
        return False

    @staticmethod
    def _add_food(inv: dict, k: str, n: int, at: float, hands: bool = True) -> int:
        """Put `n` pieces of fruit picked at `at` into the backpack stacks of
        the same fruit, then free slots, then the hands. Returns how many did
        not fit."""
        it = TUNING["items"][k]
        spots = [(i, it["slot"]) for i in range(len(inv["pack"]))]
        if hands:
            spots.append((None, it["hand"]))
        # Stacks of the same fruit first, then the empty places.
        def stack(i):
            return inv["hand"] if i is None else inv["pack"][i]
        order = [sp for sp in spots if _kind(stack(sp[0])) == k] + [sp for sp in spots if stack(sp[0]) is None]
        for i, cap in order:
            if n <= 0:
                break
            cur = stack(i)
            have = cur["n"] if cur else 0
            add = min(n, cap - have)
            if add <= 0:
                continue
            new = {"k": k, "n": have + add,
                   "at": _merged_at(have, cur["at"], add, at) if cur else at}
            if i is None:
                inv["hand"] = new
            else:
                inv["pack"][i] = new
            n -= add
        return n

    def _build_of(self, p: dict, msg: dict):
        b = self.builds.get(msg.get("build")) if isinstance(msg.get("build"), int) else None
        return b if b is not None and self._near_build(p, b) else None

    async def drop(self, pid: str, msg: dict):
        """Put down what is in the hands, or with empty hands one stone from
        the backpack, at the spot in front of the player. It joins a pile of
        the same thing there or starts a new one."""
        p = self.online.get(pid)
        if p is None:
            return
        if msg.get("build") is not None:
            b = self._build_of(p, msg)
            return await (self.put_on(p, b, msg) if b else self._nope(p, "far"))
        inv = p["inv"]
        hand_before = inv["hand"]
        slot = msg.get("slot")
        # A chosen backpack slot comes first, then the hands, then a stone.
        if (isinstance(slot, int) and not isinstance(slot, bool) and 0 <= slot < len(inv["pack"])
                and inv["pack"][slot] is not None):
            item, from_slot = inv["pack"][slot], slot
        elif inv["hand"] is not None:
            item, from_slot = inv["hand"], None
        elif "stone" in inv["pack"]:
            from_slot = len(inv["pack"]) - 1 - inv["pack"][::-1].index("stone")
            item = "stone"
        else:
            return
        if _kind(item) in _KEPT:
            return await self._nope(p, "keep_tool")
        kind, cnt, at = _kind(item), _count(item), _unit_at(item)
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half, p["x"] or 0.0)
        z = _num(msg.get("z"), -half, half, p["z"] or 0.0)
        if not self._near(p, x, z):
            return await self._nope(p, "far")

        if from_slot is None:
            inv["hand"] = None
        else:
            inv["pack"][from_slot] = None
        await self._to_ground(kind, cnt, at, x, z)
        await self._inv_changed(p, hand_before)

    async def _to_ground(self, kind: str, cnt: int, at: float, x: float, z: float):
        """Put `cnt` pieces of one thing down at (x, z): onto a pile of the
        same thing there while it has room, then into new piles next to it."""
        k = 0
        while cnt > 0:
            target, best = None, TUNING["pile_merge"]
            for pile in self.piles.values():
                if pile["kind"] != kind or pile["n"] >= TUNING["pile_max"][kind]:
                    continue
                d = ((pile["x"] - x) ** 2 + (pile["z"] - z) ** 2) ** 0.5
                if d <= best:
                    target, best = pile, d
            if target is None:
                # A new pile, beside any that already lie there.
                while True:
                    a = k * 2.4
                    px, pz = x + math.sin(a) * 0.9 * min(k, 1), z + math.cos(a) * 0.9 * min(k, 1)
                    k += 1
                    if k > 12 or not any((pl["x"] - px) ** 2 + (pl["z"] - pz) ** 2 < 0.36
                                         for pl in self.piles.values()):
                        break
                n = min(cnt, TUNING["pile_max"][kind])
                target = self._new_pile(kind, n, round(px, 2), round(pz, 2), at)
            else:
                n = min(cnt, TUNING["pile_max"][kind] - target["n"])
                if kind in _FOOD:
                    target["at"] = _merged_at(target["n"], target["at"], n, at)
                target["n"] += n
                self._store_pile(target)
            cnt -= n
            await self._to_all({"type": "hv_pile", "pile": target})

    async def hold(self, pid: str, msg: dict):
        """Swap the hands with one backpack slot. A log never goes into the
        backpack, so with a log in the hands nothing happens."""
        p = self.online.get(pid)
        if p is None:
            return
        inv = p["inv"]
        hand_before = inv["hand"]
        slot = msg.get("slot")
        if slot == "stash":
            # Hands into the first free slot.
            if inv["hand"] is None:
                return
            if _kind(inv["hand"]) not in _SMALL:
                return await self._nope(p, "too_big")
            if _kind(inv["hand"]) in _FOOD:
                h = inv["hand"]
                inv["hand"] = None
                left = self._add_food(inv, h["k"], h["n"], h["at"], hands=False)
                if left:
                    inv["hand"] = {"k": h["k"], "n": left, "at": h["at"]}
                    if left == h["n"]:
                        return await self._nope(p, "full")
                return await self._inv_changed(p, hand_before)
            if None not in inv["pack"]:
                return await self._nope(p, "full")
            inv["pack"][inv["pack"].index(None)] = inv["hand"]
            inv["hand"] = None
            return await self._inv_changed(p, hand_before)
        if not isinstance(slot, int) or not 0 <= slot < len(inv["pack"]):
            return
        if inv["hand"] is not None and _kind(inv["hand"]) not in _SMALL:
            return await self._nope(p, "too_big")
        if inv["hand"] is None and inv["pack"][slot] is None:
            return
        h, s_ = inv["hand"], inv["pack"][slot]
        if _kind(h) in _FOOD and _kind(s_) == _kind(h):
            # The same fruit: pour the hands into the slot as far as it goes.
            cap = TUNING["items"][h["k"]]["slot"]
            add = min(h["n"], cap - s_["n"])
            if add <= 0:
                return await self._nope(p, "full")
            s_["at"] = _merged_at(s_["n"], s_["at"], add, h["at"])
            s_["n"] += add
            h["n"] -= add
            inv["hand"] = h if h["n"] > 0 else None
            return await self._inv_changed(p, hand_before)
        if _kind(s_) in _FOOD and s_["n"] > TUNING["items"][s_["k"]]["hand"]:
            # More than the hands hold: take a handful and leave the rest.
            hcap = TUNING["items"][s_["k"]]["hand"]
            if h is not None:
                return await self._nope(p, "full")
            inv["hand"] = {"k": s_["k"], "n": hcap, "at": s_["at"]}
            s_["n"] -= hcap
            p["chop"] = None
            return await self._inv_changed(p, hand_before)
        inv["hand"], inv["pack"][slot] = s_, h
        p["chop"] = p["dig"] = None
        await self._inv_changed(p, hand_before)

    # ── eating and drinking ─────────────────────────────────────────────────
    async def gather(self, pid: str, msg: dict):
        """Pick one ripe fruit off a bush or an apple tree into the backpack,
        or into the hands when the backpack has no room."""
        p = self.online.get(pid)
        if p is None:
            return
        src, k = msg.get("src"), msg.get("k")
        cm = _CROP_RE.match(src) if isinstance(src, str) else None
        if cm is not None:
            return await self._gather_crop(p, cm.group(1), k)
        m = _FRUIT_RE.match(src) if isinstance(src, str) else None
        cfg = TUNING["fruit"]
        if m is None or not isinstance(k, int) or isinstance(k, bool) or not 0 <= k < cfg[m.group(1)]["n"]:
            return
        if m.group(1) == "t" and (src in self.felled or not _bears_fruit(src)):
            return
        pos = (int(m.group(2)) / 10.0, int(m.group(3)) / 10.0)
        if not self._near(p, *pos, extra=cfg["reach"]):
            return await self._nope(p, "far")
        now = time.time()
        at = self.fruit.get((src, k))
        if at is not None and now - at < cfg["grow"]:
            return await self._nope(p, "unripe")
        kind = "apple" if m.group(1) == "t" else "berries"
        hand_before = p["inv"]["hand"]
        if self._add_food(p["inv"], kind, 1, now):
            return await self._nope(p, "full")
        self.fruit[(src, k)] = now
        with _conn() as conn:
            conn.execute("INSERT OR REPLACE INTO fruit_taken(src,k,at) VALUES(?,?,?)", (src, k, now))
            conn.commit()
        await self._to_all({"type": "hv_fruit", "src": src, "k": k, "at": now})
        await self._inv_changed(p, hand_before)

    async def _gather_crop(self, p: dict, c: str, k):
        plot = self.plots.get(c)
        crop = plot.get("crop") if plot else None
        if crop is None or not isinstance(k, int) or isinstance(k, bool) or not 0 <= k < len(crop["pk"]):
            return
        if not self._near(p, plot["x"], plot["z"], extra=TUNING["fruit"]["reach"]):
            return await self._nope(p, "far")
        now = time.time()
        if not _ripe(plot, k, now):
            return await self._nope(p, "unripe")
        hand_before = p["inv"]["hand"]
        if self._add_food(p["inv"], crop["k"], 1, now):
            return await self._nope(p, "full")
        crop["pk"][k] = round(_crop_g(plot, now), 2)
        await self._plots_changed([plot])
        await self._inv_changed(p, hand_before)

    async def eat(self, pid: str, msg: dict):
        """Eat one piece of fruit from the hands or the backpack. What is
        nearly rotten goes first; what is rotten feeds nobody. Fresh fruit
        gives all of its food and water, older fruit less."""
        p = self.online.get(pid)
        if p is None:
            return
        now = time.time()
        inv = p["inv"]
        hand_before = inv["hand"]
        spots = [(None, inv["hand"])] + list(enumerate(inv["pack"]))
        want = msg.get("slot")
        if want == "hand":
            spots = spots[:1]
        elif isinstance(want, int) and not isinstance(want, bool) and 0 <= want < len(inv["pack"]):
            spots = [spots[want + 1]]
        food = [(i, it) for i, it in spots if _kind(it) in _FOOD]
        if not food:
            return await self._nope(p, "no_food")
        fresh = [(i, it) for i, it in food if _quality(it, now) > 0]
        if not fresh:
            return await self._nope(p, "rotten")
        self._settle(p, now)
        n, fx = p["needs"], TUNING["needs"]
        if n["food"] >= fx["food_max"] - 1:
            return await self._nope(p, "not_hungry")
        i, it = min(fresh, key=lambda e: _quality(e[1], now))
        q = _quality(it, now)
        spec = TUNING["items"][it["k"]]
        n["food"] = min(fx["food_max"], n["food"] + spec["food"] * q)
        n["water"] = min(fx["water_max"], n["water"] + spec["water"] * q)
        it["n"] -= 1
        if it["n"] <= 0:
            if i is None:
                inv["hand"] = None
            else:
                inv["pack"][i] = None
        await self._push_needs(p, now, True)
        await self._inv_changed(p, hand_before)

    async def drink(self, pid: str, msg: dict):
        """One gulp from a pond, a river or a carried bucket; the sea is salt.
        A gulp from a bucket uses up one of its waterings."""
        p = self.online.get(pid)
        if p is None:
            return
        bucket = None
        if msg.get("bucket"):
            full = [it for it in [p["inv"]["hand"]] + p["inv"]["pack"]
                    if _kind(it) == "bucket" and it["w"] > 0]
            if not full:
                return await self._nope(p, "bucket_empty")
            bucket = min(full, key=lambda it: it["w"])
        else:
            near = self._at_water(p, msg.get("water"))
            if near is None:
                return
            if not near:
                return await self._nope(p, "far")
        cfg = TUNING["water"]
        now = time.time()
        if now - p["drink_at"] < cfg["gap"]:
            return
        self._settle(p, now)
        n, fx = p["needs"], TUNING["needs"]
        if n["water"] >= fx["water_max"] - 1:
            return await self._nope(p, "not_thirsty")
        p["drink_at"] = now
        n["water"] = min(fx["water_max"], n["water"] + cfg["gulp"])
        await self._push_needs(p, now, True)
        if bucket is not None:
            bucket["w"] -= 1
            self._store_inv(p)
            await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})

    @staticmethod
    def _at_water(p: dict, src):
        """Whether the player stands by this pond or river bend; None when
        it names no water at all."""
        m = _WATER_RE.match(src) if isinstance(src, str) else None
        if m is None:
            return None
        cfg = TUNING["water"]
        pos = (int(m.group(2)) / 10.0, int(m.group(3)) / 10.0)
        reach = cfg["pond_reach"] if m.group(1) == "p" else cfg["river_reach"]
        return p["x"] is not None and ((p["x"] - pos[0]) ** 2 + (p["z"] - pos[1]) ** 2) ** 0.5 <= reach

    # ── fields ──────────────────────────────────────────────────────────────
    async def _plots_changed(self, plots: list):
        self._store_plots(plots)
        for pl in plots:
            if pl.get("gone"):
                self.plots.pop(pl["c"], None)
        await self._to_all({"type": "hv_plots", "plots": plots})

    def _near_plot(self, p: dict, plot: dict) -> bool:
        # A square is reached from anywhere along its edge.
        return self._near(p, plot["x"], plot["z"], TUNING["farm"]["cell"] * 0.6)

    async def plan(self, pid: str, msg: dict):
        """Mark squares of ground to be dug, or unmark ones not dug yet."""
        p = self.online.get(pid)
        cells = msg.get("cells")
        if p is None or p["x"] is None or not isinstance(cells, list):
            return
        f = TUNING["farm"]
        changed = []
        if msg.get("on"):
            mine = sum(1 for pl in self.plots.values() if not pl["till"] and pl.get("by") == pid)
            for c in cells[:f["plan_max"]]:
                pos = _cell_of(c)
                if pos is None or c in self.plots or mine >= f["plan_max"]:
                    continue
                if ((p["x"] - pos[0]) ** 2 + (p["z"] - pos[1]) ** 2) ** 0.5 > f["plan_reach"]:
                    continue
                if any(((b["x"] - pos[0]) ** 2 + (b["z"] - pos[1]) ** 2) ** 0.5 < f["cell"]
                       for b in self.builds.values()):
                    continue
                plot = {"c": c, "x": pos[0], "z": pos[1], "by": pid, "p": 0.0,
                        "till": 0.0, "wet": 0.0, "crop": None}
                self.plots[c] = plot
                changed.append(plot)
                mine += 1
        else:
            for c in cells[:f["plan_max"]]:
                plot = self.plots.get(c) if isinstance(c, str) else None
                if plot is not None and not plot["till"]:
                    plot["gone"] = True
                    changed.append(plot)
        if changed:
            await self._plots_changed(changed)
        elif msg.get("on"):
            await self._nope(p, "plan_none")

    async def dig(self, pid: str, msg: dict):
        """One tick of digging a square with a hoe: new soil out of a marked
        square, or the hardened soil of a field loosened again. Time counts
        the way it does for chopping."""
        p = self.online.get(pid)
        if p is None:
            return
        plot = self.plots.get(msg.get("c")) if isinstance(msg.get("c"), str) else None
        if plot is None:
            return
        if not self._near_plot(p, plot):
            p["dig"] = None
            return await self._nope(p, "far")
        hand = p["inv"]["hand"]
        if _kind(hand) != "hoe":
            p["dig"] = None
            return await self._nope(p, "need_hoe")
        now = time.time()
        self._settle(p, now)
        if p["needs"]["energy"] <= 0:
            p["dig"] = None
            self._busy(p, "idle", now)
            await self._push_needs(p, now, True)
            return await self._nope(p, "tired")
        f = TUNING["farm"]
        last = p["dig"]
        gained = 0.0
        if last and last["c"] == plot["c"]:
            gained = min(now - last["at"], TUNING["chop_tick"] * 1.5)
        p["dig"] = {"c": plot["c"], "at": now}
        self._busy(p, "dig", now)
        # Digging trains Farming; Strength helps without training.
        await self._train(p, "farming", gained, now)
        speed = (self._lvl(p, "farming") + self._lvl(p, "strength")) / 2
        full = f["retill"] if plot["till"] else f["dig"]
        plot["p"] = round(plot["p"] + gained * speed, 2)
        if gained > 0:
            hand["w"] = round(hand["w"] - gained, 2)
            if hand["w"] <= 0:
                p["inv"]["hand"] = None
                p["dig"] = None
                plot["p"] = min(plot["p"], full - 0.01)
                self._store_plots([plot])
                await p["ctx"].send(pid, {"type": "hv_broke", "item": "hoe"})
                return await self._inv_changed(p, hand)
            await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})
            if int(hand["w"]) // 10 != int(hand["w"] + gained) // 10:
                self._store_inv(p)
        if plot["p"] < full:
            await p["ctx"].send(pid, {"type": "hv_dig_p", "c": plot["c"], "p": plot["p"] / full})
            await self._push_needs(p, now)
            return
        _crop_settle(plot, now)
        plot["till"], plot["p"] = now, 0.0
        plot.pop("by", None)
        p["dig"] = None
        self._store_inv(p)
        await self._plots_changed([plot])

    def _soil_loose(self, plot: dict, now: float) -> bool:
        return bool(plot["till"]) and now - plot["till"] < TUNING["farm"]["till_life"]

    async def plant(self, pid: str, msg: dict):
        """Put one fruit into a dug square; it grows into the plant it came
        from. Fruit that has gone rotten grows nothing."""
        p = self.online.get(pid)
        if p is None:
            return
        plot = self.plots.get(msg.get("c")) if isinstance(msg.get("c"), str) else None
        if plot is None or plot.get("crop"):
            return
        if not self._near_plot(p, plot):
            return await self._nope(p, "far")
        now = time.time()
        if not self._soil_loose(plot, now):
            return await self._nope(p, "soil_hard")
        inv = p["inv"]
        hand_before = inv["hand"]
        spots = [(None, inv["hand"])] + list(enumerate(inv["pack"]))
        want = msg.get("k")
        seeds = [(i, it) for i, it in spots
                 if _kind(it) in _FOOD and (want is None or _kind(it) == want) and _quality(it, now) > 0]
        if not seeds:
            return await self._nope(p, "no_seed")
        i, it = max(seeds, key=lambda e: _quality(e[1], now))
        it["n"] -= 1
        if it["n"] <= 0:
            if i is None:
                inv["hand"] = None
            else:
                inv["pack"][i] = None
        plot["crop"] = {"k": it["k"], "t": now, "g": 0.0, "pk": [None] * TUNING["farm"]["fruits"][it["k"]]}
        await self._plots_changed([plot])
        await self._inv_changed(p, hand_before)

    async def water(self, pid: str, msg: dict):
        """Fill the bucket in the hands at a pond or a river, or pour one
        watering of it over a field square."""
        p = self.online.get(pid)
        if p is None:
            return
        hand = p["inv"]["hand"]
        if _kind(hand) != "bucket":
            return await self._nope(p, "need_bucket")
        f = TUNING["farm"]
        if "water" in msg:
            near = self._at_water(p, msg.get("water"))
            if near is None:
                return
            if not near:
                return await self._nope(p, "far")
            hand["w"] = f["bucket"]
            self._store_inv(p)
            return await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})
        plot = self.plots.get(msg.get("c")) if isinstance(msg.get("c"), str) else None
        if plot is None or not plot["till"]:
            return
        if not self._near_plot(p, plot):
            return await self._nope(p, "far")
        if hand["w"] <= 0:
            return await self._nope(p, "bucket_empty")
        now = time.time()
        _crop_settle(plot, now)
        plot["wet"] = now
        hand["w"] -= 1
        self._store_inv(p)
        await p["ctx"].send(pid, {"type": "hv_inv", "inv": p["inv"]})
        await self._plots_changed([plot])

    async def uproot(self, pid: str, msg: dict):
        """Pull out what grows on a square; the dug soil stays."""
        p = self.online.get(pid)
        if p is None:
            return
        plot = self.plots.get(msg.get("c")) if isinstance(msg.get("c"), str) else None
        if plot is None or not plot.get("crop"):
            return
        if not self._near_plot(p, plot):
            return await self._nope(p, "far")
        plot["crop"] = None
        await self._plots_changed([plot])

    async def sync(self, pid: str, msg: dict):
        """The client asks how it is doing; a player at rest sends nothing
        else, and rest is when energy comes back."""
        p = self.online.get(pid)
        if p is None:
            return
        now = time.time()
        self._settle(p, now)
        await self._push_needs(p, now, True)

    # ── builds: frames, sleds ───────────────────────────────────────────────
    async def place(self, pid: str, msg: dict):
        """Lay down the frame of something made on the ground."""
        p = self.online.get(pid)
        if p is None:
            return
        make = msg.get("make")
        need = TUNING["builds"].get(make) if isinstance(make, str) else None
        if need is None:
            return
        half = TUNING["world_size"] / 2
        x = _num(msg.get("x"), -half, half, p["x"] or 0.0)
        z = _num(msg.get("z"), -half, half, p["z"] or 0.0)
        if not self._near(p, x, z):
            return await self._nope(p, "far")
        room = TUNING["build_room"]
        for o in self.builds.values():
            gap = room[make] + room.get(o.get("make") or o["kind"], room["sled"])
            if ((o["x"] - x) ** 2 + (o["z"] - z) ** 2) ** 0.5 < gap:
                return await self._nope(p, "crowded")
        b = {"id": None, "kind": "site", "x": round(x, 2), "z": round(z, 2),
             "ry": round(_num(msg.get("ry"), -1000, 1000) % 6.283185307179586, 3),
             "make": make, "have": {k: 0 for k in need}}
        self._store_build(b)
        b["by"] = None
        self.builds[b["id"]] = b
        await self._to_all({"type": "hv_build", "build": b})

    def _near_build(self, p: dict, b: dict) -> bool:
        # A sled is a couple of metres long; reach it anywhere along its side.
        return self._near(p, b["x"], b["z"], 1.2)

    async def _build_changed(self, b: dict):
        self._store_build(b)
        if b.get("gone"):
            self.builds.pop(b["id"], None)
            await self._to_all({"type": "hv_build_gone", "id": b["id"]})
        else:
            await self._to_all({"type": "hv_build", "build": b})

    @staticmethod
    def _unit_source(inv: dict, slot, kinds=None):
        """Where the next thing to hand over comes from: the chosen slot
        ("hand" or a backpack slot) only, else the hands, else a stone, else
        any fruit in the backpack. `kinds` limits it to things wanted."""
        pack = inv["pack"]
        ok = lambda it: it is not None and _kind(it) not in _KEPT and (kinds is None or _kind(it) in kinds)
        if slot == "hand":
            return ("hand", None) if ok(inv["hand"]) else None
        if isinstance(slot, int) and not isinstance(slot, bool) and 0 <= slot < len(pack):
            return ("pack", slot) if ok(pack[slot]) else None
        if inv["hand"] is not None:
            return ("hand", None) if ok(inv["hand"]) else None
        for i in range(len(pack) - 1, -1, -1):
            if pack[i] == "stone" and ok(pack[i]):
                return ("pack", i)
        for i in range(len(pack) - 1, -1, -1):
            if ok(pack[i]):
                return ("pack", i)
        return None

    @staticmethod
    def _take_unit(inv: dict, src):
        """Remove one piece from an inventory source: (kind, its _unit_at)."""
        where, i = src
        item = inv["hand"] if where == "hand" else inv["pack"][i]
        kind, at = _kind(item), _unit_at(item)
        if kind in _FOOD and item["n"] > 1:
            item["n"] -= 1
        elif where == "hand":
            inv["hand"] = None
        else:
            inv["pack"][i] = None
        return kind, at

    @staticmethod
    def _made_item(name: str):
        if name in _TOOLS:
            return {"k": name, "w": TUNING["tool_life"][name]}
        if name in _VESSELS:
            return {"k": name, "w": 0}
        return name

    def _wear_build_tools(self, p: dict, make: str) -> str | None:
        """Wear the tools a build needs on whoever finishes it. Returns the
        tool that is missing, and then wears nothing."""
        inv = p["inv"]
        need = TUNING["build_tools"].get(make, {})
        for tk in need:
            if not any(_kind(it) == tk for it in [inv["hand"]] + inv["pack"]):
                return tk
        for tk, wear in need.items():
            if _kind(inv["hand"]) == tk:
                tool = inv["hand"]
            else:
                tool = next(it for it in inv["pack"] if _kind(it) == tk)
            tool["w"] = round(tool["w"] - wear, 2)
            if tool["w"] <= 0:
                if inv["hand"] is tool:
                    inv["hand"] = None
                else:
                    inv["pack"][inv["pack"].index(tool)] = None
        return None

    async def put_on(self, p: dict, b: dict, msg: dict | None = None):
        """Bring things to a frame, or load things on a sled: one, or all of
        them when asked, as far as the frame needs them or the sled holds."""
        msg = msg or {}
        inv = p["inv"]
        hand_before = inv["hand"]
        if b["kind"] == "site":
            if b.get("done"):
                return await self._nope(p, "not_needed")
            need = TUNING["builds"][b["make"]]
            moved, why = 0, None
            for _ in range(50 if msg.get("all") else 1):
                wanted = {k for k, n in need.items() if b["have"].get(k, 0) < n}
                src = self._unit_source(inv, msg.get("slot"), wanted)
                if src is None:
                    why = why or "not_needed"
                    break
                if sum(need.values()) - sum(b["have"].values()) == 1:
                    # The last piece finishes it: the tools it needs do the work.
                    miss = self._wear_build_tools(p, b["make"])
                    if miss:
                        why = "need_" + miss
                        break
                kind, _at = self._take_unit(inv, src)
                b["have"][kind] = b["have"].get(kind, 0) + 1
                moved += 1
            if not moved:
                return await self._nope(p, why)
            await self._site_check(p, b)
            await self._build_changed(b)
            return await self._inv_changed(p, hand_before)

        spec = TUNING["sled"]
        moved, why = 0, None
        for _ in range(300 if msg.get("all") else 1):
            src = self._unit_source(inv, msg.get("slot"))
            if src is None:
                break
            item = inv["hand"] if src[0] == "hand" else inv["pack"][src[1]]
            kind = _kind(item)
            if kind not in spec["accepts"]:
                why = "not_accepted"
                break
            kg, l = _load_totals(b["load"])
            unit = TUNING["items"][kind]
            if kg + unit["kg"] > spec["kg"] or l + unit["l"] > spec["litres"]:
                why = "sled_full"
                break
            kind, at = self._take_unit(inv, src)
            if kind in _FOOD:
                st = next((e for e in b["load"] if isinstance(e, dict) and e["k"] == kind), None)
                if st:
                    st["at"] = _merged_at(st["n"], st["at"], 1, at)
                    st["n"] += 1
                else:
                    b["load"].append({"k": kind, "n": 1, "at": at})
            else:
                b["load"].append(_unit_of(kind, at))
            moved += 1
        if not moved:
            if not why and _kind(inv["hand"]) in _KEPT:
                why = "keep_tool"
            if why:
                await self._nope(p, why)
            return
        await self._build_changed(b)
        await self._inv_changed(p, hand_before)

    async def _site_check(self, p: dict, b: dict):
        """A frame with everything it needs is finished: a sled becomes the
        sled itself, a tool lies on its frame until someone takes it."""
        need = TUNING["builds"][b["make"]]
        if not all(b["have"].get(k, 0) >= n for k, n in need.items()):
            return
        if b["make"] == "sled":
            b["kind"] = b.pop("make")
            b.pop("have", None)
            b["load"] = []
        else:
            b["done"] = True
        p["chop"] = p["dig"] = None
        await p["ctx"].send(p["id"], {"type": "hv_made", "item": b.get("make") or b["kind"],
                                      "frame": bool(b.get("done"))})

    def _sled_room(self, b: dict, kind: str) -> str | None:
        """Why one more `kind` cannot go on a sled, or None when it can."""
        spec = TUNING["sled"]
        if kind not in spec["accepts"]:
            return "not_accepted"
        kg, l = _load_totals(b["load"])
        unit = TUNING["items"][kind]
        if kg + unit["kg"] > spec["kg"] or l + unit["l"] > spec["litres"]:
            return "sled_full"
        return None

    def _holder(self, ref):
        """A sled, a frame or a pile named by {"build": id} or {"pile": id}:
        ("build" | "pile", it, x, z), or None."""
        if not isinstance(ref, dict):
            return None
        for kind, pool in (("build", self.builds), ("pile", self.piles)):
            i = ref.get(kind)
            if isinstance(i, int) and not isinstance(i, bool) and i in pool:
                h = pool[i]
                return kind, h, h["x"], h["z"]
        return None

    async def transfer(self, pid: str, msg: dict):
        """Move things straight from one sled, frame or pile to another one
        close by: one, or all of one kind (`k`). The player stands by either
        of them; a frame takes only what it still needs, and the tools that
        finish it are the player's."""
        p = self.online.get(pid)
        if p is None:
            return
        src, dst = self._holder(msg.get("src")), self._holder(msg.get("dst"))
        if src is None or dst is None or src[1] is dst[1]:
            return
        near = lambda h: self._near_build(p, h[1]) if h[0] == "build" else self._near(p, h[2], h[3])
        if not near(src) and not near(dst):
            return await self._nope(p, "far")
        if ((src[2] - dst[2]) ** 2 + (src[3] - dst[3]) ** 2) ** 0.5 > TUNING["unload_reach"] + 1.2:
            return await self._nope(p, "far_spot")
        s, d = src[1], dst[1]
        if src[0] == "pile":
            kind = s["kind"]
        else:
            if s["kind"] == "site" and s.get("done"):
                return
            have = self._contents(s)
            kind = msg.get("k") if msg.get("k") in have else None
        if kind is None:
            return
        if dst[0] == "build" and d["kind"] == "site" and d.get("done"):
            return await self._nope(p, "not_needed")
        inv = p["inv"]
        hand_before = inv["hand"]
        ats, why, wore = [], None, False
        for _ in range(300 if msg.get("all") else 1):
            # Whether the other side takes one more, before anything is moved.
            last = False
            if dst[0] == "build" and d["kind"] == "site":
                need = TUNING["builds"][d["make"]]
                if d["have"].get(kind, 0) >= need.get(kind, 0):
                    why = why or "not_needed"
                    break
                last = sum(need.values()) - sum(d["have"].values()) == 1
                miss = last and next((tk for tk in TUNING["build_tools"].get(d["make"], {})
                                      if not any(_kind(it) == tk for it in [inv["hand"]] + inv["pack"])), None)
                if miss:
                    why = "need_" + miss
                    break
            elif dst[0] == "build":
                why = self._sled_room(d, kind)
                if why:
                    break
            if src[0] == "pile":
                if s["n"] <= 0:
                    break
                s["n"] -= 1
                at = s["at"]
            else:
                at = self._take_from(s, kind)
                if at is None:
                    break
            if last:
                # The last piece finishes it: the tools it needs do the work.
                self._wear_build_tools(p, d["make"])
                wore = True
            if dst[0] == "pile":
                pass   # laid down together below
            elif d["kind"] == "site":
                d["have"][kind] = d["have"].get(kind, 0) + 1
            elif kind in _FOOD:
                st = next((e for e in d["load"] if isinstance(e, dict) and e["k"] == kind), None)
                if st:
                    st["at"] = _merged_at(st["n"], st["at"], 1, at)
                    st["n"] += 1
                else:
                    d["load"].append({"k": kind, "n": 1, "at": at})
            else:
                d["load"].append(_unit_of(kind, at))
            ats.append(at)
        if not ats:
            if why:
                await self._nope(p, why)
            return
        if dst[0] == "pile":
            # Onto the pile there, or beside it once it is full.
            if kind in _VESSELS:
                for at in ats:
                    await self._to_ground(kind, 1, at, d["x"], d["z"])
            else:
                await self._to_ground(kind, len(ats), sum(ats) / len(ats), d["x"], d["z"])
        else:
            if d["kind"] == "site":
                await self._site_check(p, d)
            await self._build_changed(d)
        if src[0] == "pile":
            self._store_pile(s)
            if s["n"] <= 0:
                self.piles.pop(s["id"], None)
                await self._to_all({"type": "hv_pile_gone", "id": s["id"]})
            else:
                await self._to_all({"type": "hv_pile", "pile": s})
        else:
            await self._build_changed(s)
        if wore:
            await self._inv_changed(p, hand_before)

    @staticmethod
    def _contents(b: dict) -> list:
        """What can be taken off a frame or a sled, by kind: [kind, ...]."""
        if b["kind"] == "site":
            return [k for k, n in b["have"].items() if n > 0]
        out = []
        for e in b["load"]:
            if _kind(e) not in out:
                out.append(_kind(e))
        return out

    @staticmethod
    def _take_from(b: dict, kind: str):
        """Take one `kind` off a frame or a sled: its _unit_at, or None when
        there is none."""
        if b["kind"] == "site":
            if b["have"].get(kind, 0) <= 0:
                return None
            b["have"][kind] -= 1
            return 0.0
        for i in range(len(b["load"]) - 1, -1, -1):
            e = b["load"][i]
            if _kind(e) != kind:
                continue
            if kind in _VESSELS:
                b["load"].pop(i)
                return float(e["w"])
            if isinstance(e, dict):
                e["n"] -= 1
                if e["n"] <= 0:
                    b["load"].pop(i)
                return e["at"]
            b["load"].pop(i)
            return 0.0
        return None

    @staticmethod
    def _give_back(b: dict, kind: str, at: float):
        """Undo _take_from when what was taken did not fit anywhere."""
        if b["kind"] == "site":
            b["have"][kind] = b["have"].get(kind, 0) + 1
        elif kind in _FOOD:
            st = next((e for e in b["load"] if isinstance(e, dict) and e["k"] == kind), None)
            if st:
                st["n"] += 1
            else:
                b["load"].append({"k": kind, "n": 1, "at": at})
        else:
            b["load"].append(_unit_of(kind, at))

    async def take_off(self, p: dict, b: dict, msg: dict | None = None):
        """Take things back from a frame or off a sled into the hands and the
        backpack: one, or all of one kind (`k`, else whatever is on top). A
        finished tool is taken with its frame; an empty frame is taken away."""
        msg = msg or {}
        inv = p["inv"]
        hand_before = inv["hand"]
        if b["kind"] == "site" and b.get("done"):
            made = self._made_item(b["make"])
            if inv["hand"] is None:
                inv["hand"] = made
            elif _kind(made) in _SMALL and None in inv["pack"]:
                inv["pack"][inv["pack"].index(None)] = made
            else:
                return await self._nope(p, "full" if _kind(made) in _SMALL else "hands_full")
            b["gone"] = True
            await self._build_changed(b)
            return await self._inv_changed(p, hand_before)
        have = self._contents(b)
        if b["kind"] == "site" and not have:
            b["gone"] = True
            return await self._build_changed(b)
        kind = msg.get("k") if msg.get("k") in have else (
            _kind(b["load"][-1]) if b["kind"] != "site" and b["load"] else have[0] if have else None)
        if kind is None:
            return
        moved, failed = 0, False
        for _ in range(300 if msg.get("all") else 1):
            at = self._take_from(b, kind)
            if at is None:
                break
            ok = (not self._add_food(inv, kind, 1, at)) if kind in _FOOD else self._put(inv, _unit_of(kind, at))
            if not ok:
                self._give_back(b, kind, at)
                failed = True
                break
            moved += 1
        if not moved:
            if failed:
                await self._nope(p, "hands_full" if kind not in _SMALL else "full")
            return
        await self._build_changed(b)
        await self._inv_changed(p, hand_before)

    async def unload(self, pid: str, msg: dict):
        """Put things from a sled or a frame straight on the ground: one or
        all of one kind (`k`), or everything, at a chosen spot near it or
        beside it."""
        p = self.online.get(pid)
        if p is None:
            return
        b = self._build_of(p, msg)
        if b is None:
            return await self._nope(p, "far")
        if b["kind"] == "site" and b.get("done"):
            return
        kinds = self._contents(b)
        if msg.get("k") is not None:
            kinds = [k for k in kinds if k == msg.get("k")]
        if not kinds:
            return
        if msg.get("x") is not None and msg.get("z") is not None:
            half = TUNING["world_size"] / 2
            x = _num(msg.get("x"), -half, half, b["x"])
            z = _num(msg.get("z"), -half, half, b["z"])
            if ((x - b["x"]) ** 2 + (z - b["z"]) ** 2) ** 0.5 > TUNING["unload_reach"]:
                return await self._nope(p, "far_spot")
        else:
            # Beside it, on the side the player stands on.
            sx, sz = math.cos(b["ry"]), -math.sin(b["ry"])
            side = 1 if (p["x"] - b["x"]) * sx + (p["z"] - b["z"]) * sz >= 0 else -1
            x, z = b["x"] + sx * side * 1.5, b["z"] + sz * side * 1.5
        for i, kind in enumerate(kinds):
            ats = []
            for _ in range(10000 if msg.get("all") else 1):
                at = self._take_from(b, kind)
                if at is None:
                    break
                ats.append(at)
            # Different things lie in their own piles, side by side; a bucket
            # keeps its own water, so each one is put down by itself.
            px, pz = x + i * 1.0 * math.cos(b["ry"]), z - i * 1.0 * math.sin(b["ry"])
            if kind in _VESSELS:
                for at in ats:
                    await self._to_ground(kind, 1, at, px, pz)
            elif ats:
                await self._to_ground(kind, len(ats), sum(ats) / len(ats), px, pz)
        await self._build_changed(b)

    async def pull(self, pid: str, msg: dict):
        """Take a sled's rope, or let go of the one in hand."""
        p = self.online.get(pid)
        if p is None:
            return
        if p["pull"] is not None:
            return await self._let_go(p)
        b = self.builds.get(msg.get("build")) if isinstance(msg.get("build"), int) else None
        if b is None or b["kind"] != "sled":
            return
        if not self._near_build(p, b):
            return await self._nope(p, "far")
        if b["by"] is not None and b["by"] in self.online:
            return await self._nope(p, "taken")
        if self._sled_pull(p, b) <= 0:
            return await self._nope(p, "too_heavy")
        b["by"] = pid
        p["pull"] = b["id"]
        await self._to_all({"type": "hv_build", "build": b})

    async def _let_go(self, p: dict):
        b = self.builds.get(p["pull"]) if p.get("pull") is not None else None
        p["pull"] = None
        if b is None:
            return
        b["by"] = None
        await self._build_changed(b)


WORLD = World()
