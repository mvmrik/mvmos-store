"""Racelandia - everything the server knows and decides.

The lap itself is simulated in the browser (public/sim.js): the player never
steers, so the lap is a pure function of the setup, the driver's skills, the
weather and a seed. What must not be trusted to a browser lives here: the
driver's skills and how training changes them, the budget, the weather of the
day, what a setup may contain, and how many points a reported lap is worth.

Runtime data lives in this app's own data.db, never in the package.
"""
import importlib.util
import json
import math
import os
import random
import sqlite3
import time
import uuid

_DIR = os.path.dirname(os.path.realpath(__file__))
_DB = os.path.join(_DIR, "data.db")
def _local_module(name):
    spec=importlib.util.spec_from_file_location('apex_'+name,os.path.join(_DIR,name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
season = _local_module('season')
race_engine = _local_module('race_engine')
parts_lab = _local_module('parts_lab')
tracks = _local_module('tracks')
grandstands = _local_module('grandstands')
weather = _local_module('weather')
team = _local_module('team')
crew = _local_module('crew')
crew_training = _local_module('crew_training')
specialists = _local_module('specialists')
training_rules = _local_module('training_rules')
pilot_games = _local_module('pilot_games')
sponsors = _local_module('sponsors')
rivals = _local_module('rivals')
team.bind(globals())
crew.bind(globals())
specialists.bind(globals())
sponsors.bind(globals())
rivals.bind(globals())
season.bind(globals())
race_engine.bind(crew, training_rules)

# The own circuit of a player has this id on the client; everybody's records for it are their own.
TRACK = tracks.OWN

# The parts of the car. Wear is a fraction, 0 = new, 1 = finished. `rate` is the
# wear of one lap, `new` what a replacement costs, `repair` what a full repair
# costs.
PARTS = {
    "engine": {"rate": 0.022, "new": 350_000, "repair": 90_000},
    "gearbox": {"rate": 0.018, "new": 180_000, "repair": 50_000},
    "battery": {"rate": 0.016, "new": 220_000, "repair": 60_000},
    "brakes": {"rate": 0.025, "new": 60_000, "repair": 15_000},
    "suspension": {"rate": 0.010, "new": 90_000, "repair": 25_000},
    "floor": {"rate": 0.008, "new": 120_000, "repair": 30_000},
    "frontWing": {"rate": 0.005, "new": 70_000, "repair": 18_000},
    "rearWing": {"rate": 0.005, "new": 60_000, "repair": 15_000},
}
WEAR_KM = 33.0              # PARTS "rate" is the wear of this much driving, so a long lap wears the car more than a short one
REPAIR_SHARE = 0.25         # repairing fully worn part costs this share of what building the same part costs
REPAIR_KEEPS = 0.3          # a repair leaves this share of the wear

KINDS = ("practice",)
RACE_MIN_LAPS = 3
RACE_MAX_TIME = 20000      # seconds: the longest a simulated race may run
RECRUIT_PRICE = 150_000
RECRUIT_INTERVAL = 7 * 86400
AGE_YEAR_SECONDS = 365 * 86400 / 25  # 17 -> 42 in one real year; no forced retirement.
PRACTICE_SECONDS = season.PRACTICE_SECONDS
QUALIFY_SECONDS = season.QUALIFY_SECONDS
QUALIFY_LAPS = season.session_laps(QUALIFY_SECONDS)  # upfront lap reserve; unused laps are refunded on settlement.
QUALIFY_ENERGY = 25
QUALIFY_PRIZES = {"bronze": 200_000, "silver": 260_000, "gold": 320_000}
QUALIFY_TARGETS = {"bronze": 68.0, "silver": 62.0, "gold": 57.0}
QUALIFY_CRITERIA = {"bronze":{"ratio":.5,"spread":.08},"silver":{"ratio":.7,"spread":.04},"gold":{"ratio":.85,"spread":.025}}
PRIZES = list(QUALIFY_PRIZES.values())
RACE_POINTS = []

# ── Setup: the one place that knows the ranges ──────────────────────────────
# (key, group, min, max, step, default, unit)
SETUP_DEFS = [
    ("frontWing", "aero", 1, 12, 1, 6, ""),
    ("rearWing", "aero", 1, 12, 1, 6, ""),
    ("rideF", "chassis", 20, 48, 1, 32, "mm"),
    ("rideR", "chassis", 50, 95, 1, 68, "mm"),
    ("springF", "chassis", 100, 420, 10, 240, "N/mm"),
    ("springR", "chassis", 100, 420, 10, 200, "N/mm"),
    ("arbF", "chassis", 1, 10, 1, 5, ""),
    ("arbR", "chassis", 1, 10, 1, 5, ""),
    ("camberF", "tyres", -5.0, -1.0, 0.1, -3.2, "°"),
    ("camberR", "tyres", -3.5, -0.5, 0.1, -1.8, "°"),
    ("pressF", "tyres", 18.0, 26.0, 0.1, 21.5, "psi"),
    ("pressR", "tyres", 18.0, 26.0, 0.1, 20.5, "psi"),
    ("brakeBias", "drive", 50, 68, 1, 59, "%"),
    ("diff", "drive", 10, 90, 5, 40, "%"),
    ("gearing", "drive", -5, 5, 1, 2, ""),
    ("engine", "drive", 1, 5, 1, 3, ""),
    ("fuel", "drive", 3, 110, 1, 28, "kg"),
]
SETUP_KEYS = [d[0] for d in SETUP_DEFS]
DEFAULT_SETUP = {d[0]: d[5] for d in SETUP_DEFS}

COMPOUNDS = ["S", "M", "H", "I", "W"]
TYRE_COST = {"S": 28000, "M": 24000, "H": 20000, "I": 22000, "W": 22000}

SKILLS = ["reaction", "reflexes", "pace", "braking", "cornering", "traction", "consistency",
          "focus", "composure", "tyreCare", "wet", "fitness", "feedback"]
# A novice driver starts with the same foundation in every skill.
START_SKILLS = {key: 50.0 for key in SKILLS}
POTENTIAL = {"reaction": 93, "reflexes": 94, "pace": 97, "braking": 92, "cornering": 95, "traction": 92,
             "consistency": 91, "focus": 93, "composure": 90, "tyreCare": 90, "wet": 94, "fitness": 92,
             "feedback": 90}

# ── Money ───────────────────────────────────────────────────────────────────
START_BUDGET = 6_000_000
SESSION_FEE = 25_000
LAP_COST = 3_000
FUEL_COST = 600            # per kg
TRAIN_COST = 0            # manual training uses energy and shared daily hall slots
TRAIN_PASS = 0.4          # below this share of the best result a session makes the driver worse
TRAIN_LOSS = 0.35         # the most a skill can lose in one session
SKILL_FLOOR = 25.0
ENERGY_MAX = 100
TRAIN_ENERGY = training_rules.ENERGY
ENERGY_REGEN = 15 / 3600   # per second

MIN_LAPS, MAX_LAPS = 1, 10
PRACTICE_ENERGY_PER_LAP = 3
RACE_ENERGY = 18
RACE_ENERGY_PER_LAP = 2
HOURS = list(range(8, 20))

# Fastest lap the physics can produce on the test circuit in perfect
# conditions; a reported time below this fraction of it is not believed.
FLOOR_LAP = 51.0


def _connect():
    conn = sqlite3.connect(_DB, timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS driver (
        player_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        age INTEGER NOT NULL,
        skills TEXT NOT NULL,
        potential TEXT NOT NULL,
        budget INTEGER NOT NULL,
        energy REAL NOT NULL,
        energy_ts REAL NOT NULL,
        setup TEXT NOT NULL,
        sponsor_ts REAL NOT NULL,
        created REAL NOT NULL,
        trainings INTEGER NOT NULL DEFAULT 0,
        runs INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS laps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        track TEXT NOT NULL,
        compound TEXT NOT NULL,
        lap_time REAL NOT NULL,
        points INTEGER NOT NULL,
        water REAL NOT NULL,
        air REAL NOT NULL,
        setup TEXT NOT NULL,
        at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_laps_player ON laps(player_id, track);
    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL,
        track TEXT NOT NULL,
        kind TEXT NOT NULL,
        compound TEXT NOT NULL,
        hour INTEGER NOT NULL,
        water REAL NOT NULL,
        air REAL NOT NULL,
        asphalt REAL NOT NULL,
        laps INTEGER NOT NULL,
        best REAL,
        points INTEGER NOT NULL DEFAULT 0,
        race_time REAL,
        position INTEGER,
        prize INTEGER NOT NULL DEFAULT 0,
        cost INTEGER NOT NULL DEFAULT 0,
        dnf TEXT,
        pits INTEGER NOT NULL DEFAULT 0,
        setup TEXT NOT NULL,
        final_setup TEXT,
        at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_id, track, at);
    CREATE TABLE IF NOT EXISTS lap_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        track TEXT NOT NULL,
        n INTEGER NOT NULL,
        lap_time REAL NOT NULL,
        s1 REAL, s2 REAL, s3 REAL,
        valid INTEGER NOT NULL,
        pen REAL NOT NULL DEFAULT 0,
        pit INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_lap_run ON lap_log(run_id);
    CREATE INDEX IF NOT EXISTS idx_lap_track ON lap_log(track, valid);
    CREATE TABLE IF NOT EXISTS training (
        tid TEXT PRIMARY KEY,
        player_id TEXT NOT NULL,
        game TEXT NOT NULL,
        started REAL NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 0
    );
    """)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(driver)")}
    if "setups" not in cols:
        conn.execute("ALTER TABLE driver ADD COLUMN setups TEXT NOT NULL DEFAULT '{}'")
    if "parts" not in cols:
        conn.execute("ALTER TABLE driver ADD COLUMN parts TEXT NOT NULL DEFAULT '{}'")
    training_cols = {r[1] for r in conn.execute("PRAGMA table_info(training)")}
    if "difficulty" not in training_cols:
        conn.execute("ALTER TABLE training ADD COLUMN difficulty REAL NOT NULL DEFAULT 0")
    career_cols = {
        "character": "TEXT NOT NULL DEFAULT '{}'",
        "has_car": "INTEGER NOT NULL DEFAULT 1", "has_driver": "INTEGER NOT NULL DEFAULT 1",
        "pilot_id": "TEXT", "car_id": "TEXT", "age_origin": "REAL NOT NULL DEFAULT 0",
        "age_checked": "REAL NOT NULL DEFAULT 0", "recruited_at": "REAL NOT NULL DEFAULT 0",
        "last_recruit_at": "REAL NOT NULL DEFAULT 0", "qualifications": "INTEGER NOT NULL DEFAULT 0",
        "silver_sessions": "INTEGER NOT NULL DEFAULT 0", "license_unlocked": "INTEGER NOT NULL DEFAULT 0",
        "warehouse": "TEXT NOT NULL DEFAULT '{}'", "lab": "TEXT NOT NULL DEFAULT '{}'", "fitted": "TEXT NOT NULL DEFAULT '{}'",
        "team_name": "TEXT NOT NULL DEFAULT ''", "own": "TEXT NOT NULL DEFAULT ''", "licences": "TEXT NOT NULL DEFAULT '[]'", "maint_at": "REAL NOT NULL DEFAULT 0",
        "car_level": "INTEGER NOT NULL DEFAULT 20", "sponsor_tier": "INTEGER NOT NULL DEFAULT 0", "sponsor_bonus_at": "REAL NOT NULL DEFAULT 0",
    }
    for key, definition in career_cols.items():
        if key not in cols:
            conn.execute(f"ALTER TABLE driver ADD COLUMN {key} {definition}")
    if "pilot_id" not in training_cols:
        conn.execute("ALTER TABLE training ADD COLUMN pilot_id TEXT")
    if "mechanic" not in training_cols:
        conn.execute("ALTER TABLE training ADD COLUMN mechanic TEXT")
    if "subject" not in training_cols:
        conn.execute("ALTER TABLE training ADD COLUMN subject TEXT")
    if "who" not in {r[1] for r in conn.execute("PRAGMA table_info(lap_log)")}:
        conn.execute("ALTER TABLE lap_log ADD COLUMN who TEXT")
    run_cols = {r[1] for r in conn.execute("PRAGMA table_info(runs)")}
    for key in ("qualification", "pilot_id", "session_token", "weekend", "profile"):
        if key not in run_cols:
            conn.execute(f"ALTER TABLE runs ADD COLUMN {key} TEXT")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS division_season (player_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS weather_cache (key TEXT PRIMARY KEY, fetched REAL NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS career_archive (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL, profile TEXT NOT NULL, archived_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pilot_archive (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, profile TEXT NOT NULL, archived_at REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS career_session (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL, pilot_id TEXT NOT NULL,
        kind TEXT NOT NULL, payload TEXT NOT NULL, started REAL NOT NULL, status INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_career_session ON career_session(player_id) WHERE status=0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_session_token ON runs(session_token) WHERE session_token IS NOT NULL;
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_training_hall ON training(player_id,started)")
    team.schema(conn)
    sponsors.schema(conn)
    training_rules.schema(conn)
    return conn


def _row(r):
    d = dict(r)
    d["character"] = json.loads(d.get("character") or "{}")
    d["skills"] = json.loads(d["skills"])
    d["potential"] = json.loads(d["potential"])
    d["setup"] = json.loads(d["setup"])
    d["setups"] = json.loads(d.get("setups") or "{}")
    parts = json.loads(d.get("parts") or "{}")
    d["parts"] = {k: min(1.0, max(0.0, float(parts.get(k, 0.0)))) for k in PARTS}
    d["warehouse"] = _load_warehouse(d.get("warehouse"))
    d["own"] = tracks.load_own(d.get("own"))
    try:
        lic = json.loads(d.get("licences") or "[]")
    except (TypeError, ValueError):
        lic = []
    d["licences"] = [str(x) for x in lic] if isinstance(lic, list) else []
    d["lab"] = parts_lab.load_lab(d.get("lab"))
    try:
        fitted = json.loads(d.get("fitted") or "{}")
    except (TypeError, ValueError):
        fitted = {}
    d["fitted"] = {k: str(v) for k, v in fitted.items() if k in PARTS} if isinstance(fitted, dict) else {}
    return d


def _starter_cars(conn, player_id, now):
    """Grant two independent base cars in the new-career transaction."""
    first = None
    for number in (1, 2):
        ident = uuid.uuid4().hex
        profile = dict(car_id=ident, car_level=20, parts={k:0 for k in PARTS},
                       fitted={}, setup=dict(DEFAULT_SETUP), setups={})
        conn.execute('INSERT INTO team_car(id,player_id,number,profile,pilot_id,created) VALUES(?,?,?,?,?,?)',
                     (ident, player_id, number, json.dumps(profile), None, now))
        if first is None:
            first = profile
    team.write_projection(conn, player_id, dict(first, has_car=1, staff_ts=now))


def get_driver(player_id: str, display_name: str = "") -> dict:
    """The player's driver, created with the shared starting values on first use."""
    now = time.time()
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        r = conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not r:
            name = (display_name or "Driver").strip()[:24] or "Driver"
            conn.execute(
                "INSERT OR IGNORE INTO driver (player_id,name,age,skills,potential,budget,energy,energy_ts,setup,sponsor_ts,created,has_car,has_driver)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (player_id, name, 17, json.dumps(START_SKILLS), json.dumps(POTENTIAL), START_BUDGET,
                 ENERGY_MAX, now, json.dumps(DEFAULT_SETUP), now, now, 0, 0))
            _starter_cars(conn, player_id, now)
        r = conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone()
        d = _row(r)
        _age_driver(conn,d,now)
        team.sync(conn,d)
        team.accrue(conn,d)
        season.ensure(conn,d)
        if parts_lab.advance(d["lab"], d["warehouse"], now):
            conn.execute("UPDATE driver SET lab=?, warehouse=? WHERE player_id=?", (json.dumps(d["lab"]), json.dumps(d["warehouse"]), player_id))
        # Every contracted day is paid, including time spent offline, up to expiry.
        previous_budget = d['budget']
        sponsors.accrue(conn, d, now)
        sponsored = d['budget'] > previous_budget
        if d["own"] and d["maint_at"]:
            # the own circuit costs money to keep, charged in chunks as the days pass
            due = int(tracks.maintenance_per_day(d["own"]) * (now - d["maint_at"]) / 86400.0)
            if due >= 1000:
                d["budget"] -= due
                team.note(conn,player_id,"track_maintenance")
                conn.execute("UPDATE driver SET budget=?, maint_at=? WHERE player_id=?", (d["budget"], now, player_id))
        conn.execute("UPDATE driver SET energy=MIN(?,energy+MAX(0,?-energy_ts)*?), energy_ts=MAX(energy_ts,?) WHERE player_id=?",
                     (ENERGY_MAX, now, specialists.regen(conn, player_id), now, player_id))
        fresh = conn.execute("SELECT energy,energy_ts FROM driver WHERE player_id=?", (player_id,)).fetchone()
        d["energy"], d["energy_ts"] = fresh["energy"], fresh["energy_ts"]
        conn.execute("UPDATE career_session SET status=2 WHERE player_id=? AND status=0 AND started<?", (player_id,now-7200))
        conn.commit()
        d["sponsored"] = sponsored
        return d
    finally:
        conn.close()


def _update(player_id: str, _pilot_id=None, **fields):
    conn = _connect()
    try:
        cols, vals = [], []
        for k, v in fields.items():
            cols.append(f"{k}=?")
            vals.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
        vals.append(player_id)
        where = "player_id=?"
        if _pilot_id is not None:
            where += " AND pilot_id=?"
            vals.append(_pilot_id)
        changed = conn.execute(f"UPDATE driver SET {', '.join(cols)} WHERE {where}", vals).rowcount
        conn.commit()
        return bool(changed)
    finally:
        conn.close()


def public_driver(d: dict) -> dict:
    """What the browser may know about the driver."""
    pot = d["potential"]
    sk = d["skills"]
    # the potential is only shown as a rough star rating
    gap = sum(pot[k] - sk[k] for k in SKILLS) / len(SKILLS)
    return {
        "character":dict(d.get("character") or {}) if d["has_driver"] else {},
        "name": d["name"] if d["has_driver"] else "", "age": d["age"] if d["has_driver"] else None,
        "start_reaction_ms":round(training_rules.start_delay(d["skills"]["reaction"],d["energy"])*1000), "driving_energy_factor":training_rules.driving_energy(1,d["skills"]["fitness"]),
        "car_level":d["car_level"] if d["has_car"] else 0, "has_driver": bool(d["has_driver"]), "has_car": bool(d["has_car"]), "pilot_id": d["pilot_id"], "car_id": d["car_id"],
        "aging": d["has_driver"] and d["age"] >= 32, "skills": {k: round(sk[k], 2) for k in SKILLS} if d["has_driver"] else {},
        "budget": d["budget"], "energy": math.floor(d["energy"]*1000)/1000, "energy_regen_hour": specialists.regen_pid(d["player_id"])*3600, "trainings": d["trainings"], "runs": d["runs"],
        "stars": round(min(5.0, max(1.0, 2.0 + (sum(pot.values()) / len(SKILLS) - 70) / 8)), 1),
        "headroom": round(gap, 1),
        "overall": round(sum(sk.values()) / len(SKILLS), 1),
        "parts": {k: round(v, 3) for k, v in d["parts"].items()} if d["has_car"] else {},
    }


def set_team_name(player_id: str, name: str):
    """The name of the player's team, shown in the standings of teams and next to both drivers."""
    name = " ".join((name or "").split())[:28]
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("UPDATE driver SET team_name=? WHERE player_id=?", (name, player_id))
        conn.commit()
    finally:
        conn.close()


def set_name(player_id: str, name: str):
    name = (name or "").strip()[:24]
    if name and get_driver(player_id)["has_driver"]:
        _update(player_id, name=name)


# ── Setup ───────────────────────────────────────────────────────────────────

def clean_setup(raw) -> dict:
    """A setup with every value forced into its range and onto its step."""
    out = {}
    raw = raw if isinstance(raw, dict) else {}
    for key, _g, lo, hi, step, dflt, _u in SETUP_DEFS:
        try:
            v = float(raw.get(key, dflt))
        except (TypeError, ValueError):
            v = dflt
        if not math.isfinite(v):
            v = dflt
        v = min(hi, max(lo, v))
        v = round(round((v - lo) / step) * step + lo, 4)
        out[key] = int(v) if isinstance(dflt, int) and step >= 1 else v
    return out


def track_setup(d: dict, track: str) -> dict:
    """The last setup used on a circuit; a circuit that has none starts from the standard one."""
    return clean_setup(d["setups"].get(track) or (d["setup"] if track == TRACK else None))


def valid_track(track) -> bool:
    return track == tracks.OWN or track in tracks.official()


def tkey(player_id: str, track: str) -> str:
    """The key records are stored under: an official circuit is shared by everybody, the own one is private."""
    return "own:" + player_id if track == tracks.OWN else track


def track_of(d: dict, track: str):
    return tracks.for_player(d.get("own"), track)


def home_of(d: dict):
    own = d.get("own")
    return (own["lat"], own["lon"]) if own and own.get("lat") is not None else None


def trip_km(d: dict, track: str) -> float:
    t = track_of(d, track)
    home = home_of(d)
    if not t or track == tracks.OWN or not home:
        return 0.0
    return tracks.distance_km(home, (t["lat"], t["lon"]))


def practice_extra(d: dict, track: str) -> int:
    """What taking part in a private practice costs beyond the run itself: the trip, and the circuit's rent."""
    if track == tracks.OWN:
        return 0
    return tracks.OFFICIAL_RENT_PRACTICE + tracks.travel_cost("practice", trip_km(d, track))


def can_practice(d: dict, track: str) -> bool:
    if track == tracks.OWN:
        return bool(d.get("own"))
    return track in tracks.official() and track in d["licences"]


def save_setup(player_id: str, setup, track: str = TRACK) -> dict:
    if not valid_track(track):
        track = TRACK
    d = get_driver(player_id)
    s = clean_setup(setup)
    conn=_connect()
    try:
        weekend=season.ensure(conn,d);conn.commit()
        if weekend['stage']>=3 and weekend.get('locked_setup'):return dict(weekend['locked_setup'])
    finally:conn.close()
    setups = dict(d["setups"])
    setups[track] = s
    _update(player_id, setups=setups)
    return s


# ── Weather ─────────────────────────────────────────────────────────────────
# One day at the circuit, the same for everybody: the date is the seed.

def day_seed(date_ord: int) -> int:
    return (date_ord * 2654435761 + 97) & 0xFFFFFFFF


def forecast(date_ord: int) -> list:
    rnd = random.Random(day_seed(date_ord))
    doy = date_ord % 365
    base = 14 + 11 * math.sin((doy - 100) / 365 * 2 * math.pi) + rnd.gauss(0, 3)
    kind = rnd.choices(["clear", "partly", "overcast", "showers", "rain"], [35, 30, 15, 12, 8])[0]
    cloud_base = {"clear": 0.08, "partly": 0.4, "overcast": 0.85, "showers": 0.65, "rain": 0.95}[kind]
    rain = [0.0] * 24
    if kind == "showers":
        for _ in range(rnd.randint(1, 3)):
            start = rnd.randint(8, 18)
            for h in range(start, min(24, start + rnd.randint(1, 3))):
                rain[h] = max(rain[h], rnd.uniform(0.25, 0.8))
    elif kind == "rain":
        start = rnd.randint(5, 11)
        for h in range(start, min(24, start + rnd.randint(6, 12))):
            rain[h] = rnd.uniform(0.3, 0.9)
    amp = 7 if kind in ("clear", "partly") else 3.5
    out = []
    water = 0.0
    dry_hours = 6
    cloud = cloud_base
    for h in range(24):
        sun = max(0.0, math.sin((h - 6) / 14 * math.pi)) if 6 <= h <= 20 else 0.0
        cloud = min(1.0, max(0.0, cloud + rnd.gauss(0, 0.08) + (0.5 - cloud) * 0.05)) if kind != "clear" else min(0.3, max(0.0, cloud + rnd.gauss(0, 0.04)))
        if rain[h] > 0:
            cloud = max(cloud, 0.8)
        air = base - amp * 0.5 + amp * max(0.0, math.sin((h - 8) / 14 * math.pi)) - 1.5 * cloud
        evap = 0.5 - 0.2 * sun * (1 - cloud)
        water = water * evap + 3.2 * rain[h]
        water = min(6.0, water)
        dry_hours = 0 if water > 0.3 else dry_hours + 1
        solar = 20 * sun * (1 - 0.75 * cloud)
        track = air + solar
        if water > 0.3:
            track = air + 1.0
        elif water > 0.05:
            track = air + 0.4 * solar
        rubber = 0.955 + 0.022 * min(dry_hours, 6) / 6
        out.append({
            "air": round(air, 1), "track": round(track, 1), "cloud": round(cloud, 2), "rain": round(rain[h], 2),
            "water": round(water if water > 0.02 else 0.0, 2), "sun": round(sun, 2),
            "hum": round(40 + 40 * cloud + 20 * rain[h], 0), "rubber": round(rubber, 3),
        })
    return out


def today_ord() -> int:
    return int(time.time() // 86400)


def default_hour() -> int:
    h = time.localtime().tm_hour
    return min(HOURS[-1], max(HOURS[0], h))


# ── Points ──────────────────────────────────────────────────────────────────

_WATER_D = {"S": 0.7, "M": 0.7, "H": 0.7, "I": 2.2, "W": 4.5}
_MU = {"S": 2.14, "M": 2.03, "H": 1.93, "I": 1.66, "W": 1.46}


def grip_factor(water: float) -> float:
    """How much slower a lap is than on a dry track, for the best tyre there is."""
    best = max(_MU[c] / (1 + (water / _WATER_D[c]) ** 1.2) for c in COMPOUNDS)
    return (_MU["S"] / best) ** 0.62


PAR_FAST = 55.0
PAR_SLOW = 70.0


def points_for(lap_time: float, water: float) -> int:
    f = grip_factor(water)
    fast, slow = PAR_FAST * f, PAR_SLOW * f
    return int(round(min(1200.0, max(0.0, 1000.0 * (slow - lap_time) / (slow - fast)))))


def min_lap(water: float, floor: float = None) -> float:
    return (FLOOR_LAP if floor is None else floor) * grip_factor(water)


# ── Costs ───────────────────────────────────────────────────────────────────

def session_cost(setup: dict, compound: str, laps: int, kind: str = "practice", track: str = TRACK, tyres: bool = True, extra: int = 0) -> int:
    return extra + (TYRE_COST.get(compound, 24000) if tyres else 0) + LAP_COST * (laps + 1) + FUEL_COST * int(setup["fuel"])


def energy_cost(kind: str, laps: int) -> int:
    if kind == "qualifying":
        return QUALIFY_ENERGY
    if kind == "race":
        return RACE_ENERGY + RACE_ENERGY_PER_LAP * laps
    return PRACTICE_ENERGY_PER_LAP * (laps + 1)


def charge(player_id: str, amount: int, energy: float = 0) -> str:
    """Take money and energy for a run: "" when done, "budget" or "energy" when not."""
    d = get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        r = conn.execute("SELECT budget, energy FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not r:
            conn.rollback()
            return "budget"
        if r["budget"] < amount:
            conn.rollback()
            return "budget"
        if d["energy"] < energy:
            conn.rollback()
            return "energy"
        team.note(conn,player_id,"session")
        conn.execute("UPDATE driver SET budget=budget-?, energy=?, energy_ts=?, runs=runs+1 WHERE player_id=?",
                     (amount, d["energy"] - energy, time.time(), player_id))
        conn.commit()
        return ""
    finally:
        conn.close()


def pay(player_id: str, amount: int):
    conn = _connect()
    try:
        team.note(conn,player_id,"prize")
        conn.execute("UPDATE driver SET budget=budget+? WHERE player_id=?", (int(amount), player_id))
        conn.commit()
    finally:
        conn.close()


def charge_pit(player_id: str, compound: str) -> bool:
    """A set of tyres bought in the pit lane."""
    cost = TYRE_COST.get(compound)
    if cost is None:
        return False
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        r = conn.execute("SELECT budget FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not r or r["budget"] < cost:
            conn.rollback()
            return False
        team.note(conn,player_id,"pit")
        conn.execute("UPDATE driver SET budget=budget-? WHERE player_id=?", (cost, player_id))
        conn.commit()
        return True
    finally:
        conn.close()


# ── The warehouse ───────────────────────────────────────────────────────────
# Everything the team keeps: today the tyre sets bought for practice, later car parts too.

WAREHOUSE_MAX_TYRES = 40
TYRE_DEAD = .98


def _load_warehouse(raw) -> dict:
    try:
        w = json.loads(raw or "{}")
    except (TypeError, ValueError):
        w = {}
    if not isinstance(w, dict):
        w = {}
    tyres = []
    for t in w.get("tyres") if isinstance(w.get("tyres"), list) else []:
        try:
            if t["compound"] in TYRE_COST and isinstance(t["id"], str) and len(t["wear"]) == 4:
                tyres.append({"id": t["id"], "compound": t["compound"], "wear": [min(1.0, max(0.0, float(x))) for x in t["wear"]],
                              "laps": int(t.get("laps", 0)), "runs": int(t.get("runs", 0))})
        except (KeyError, TypeError, ValueError):
            continue
    try:
        seq = int(w.get("seq", 0))
    except (TypeError, ValueError):
        seq = 0
    parts = []
    for u in w.get("parts") if isinstance(w.get("parts"), list) else []:
        try:
            if u["part"] in PARTS and isinstance(u["id"], str) and isinstance(u["design"], str):
                parts.append({"id": u["id"], "part": u["part"], "design": u["design"], "wear": min(1.0, max(0.0, float(u.get("wear", 0))))})
        except (KeyError, TypeError, ValueError):
            continue
    tyre_seq = {}
    for k, v in (w.get("tyre_seq") if isinstance(w.get("tyre_seq"), dict) else {}).items():
        try:
            if k in TYRE_COST: tyre_seq[k] = max(0, int(v))
        except (TypeError, ValueError):
            pass
    return {"seq": max(seq, len(tyres) + len(parts)), "tyres": tyres, "parts": parts, "tyre_seq": tyre_seq}


def public_warehouse(d: dict) -> dict:
    parts = [dict(u, stats=parts_lab.design_of(d["lab"], u["part"], u["design"])["stats"],
                  ver=parts_lab.design_of(d["lab"], u["part"], u["design"])["ver"]) for u in d["warehouse"]["parts"]]
    return {"tyres": d["warehouse"]["tyres"], "max_tyres": WAREHOUSE_MAX_TYRES, "parts": parts, "max_parts": parts_lab.MAX_STORED_PARTS}


def _save_warehouse(conn, player_id: str, w: dict):
    conn.execute("UPDATE driver SET warehouse=? WHERE player_id=?", (json.dumps(w), player_id))


def buy_tyres(player_id: str, compound: str, count=1):
    """Buy new sets into the warehouse. Returns an error code, or None when done."""
    if compound not in TYRE_COST:
        return "tyre"
    try:
        count = int(count)
    except (TypeError, ValueError, OverflowError):
        return "tyre"
    if not 1 <= count <= 4:
        return "tyre"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _row(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())
        if not d["has_car"]:
            return "car"
        w = d["warehouse"]
        if len(w["tyres"]) + count > WAREHOUSE_MAX_TYRES:
            return "warehouse_full"
        cost = TYRE_COST[compound] * count
        if d["budget"] < cost:
            return "budget"
        for _ in range(count):
            # every compound counts its own sets: S1, S2, M1, M2 ... never reusing a number
            used = [int(t["id"][1:]) for t in w["tyres"] if t["compound"] == compound and t["id"][1:].isdigit()]
            n = max([w["tyre_seq"].get(compound, 0)] + used) + 1
            w["tyre_seq"][compound] = n
            w["tyres"].append({"id": f"{compound}{n}", "compound": compound, "wear": [0.0] * 4, "laps": 0, "runs": 0})
        team.note(conn,player_id,"tyres",{'compound':compound,'qty':count})
        conn.execute("UPDATE driver SET budget=budget-? WHERE player_id=?", (cost, player_id))
        _save_warehouse(conn, player_id, w)
        conn.commit()
        return None
    finally:
        conn.close()


def discard_tyres(player_id: str, set_id) -> str | None:
    """Throw a set away, worn or not. Not while a run is out with the tyres."""
    if not isinstance(set_id, str):
        return "tyre_set"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return "busy"
        d = _row(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())
        w = d["warehouse"]
        left = [t for t in w["tyres"] if t["id"] != set_id]
        if len(left) == len(w["tyres"]):
            return "tyre_set"
        w["tyres"] = left
        _save_warehouse(conn, player_id, w)
        conn.commit()
        return None
    finally:
        conn.close()


def apply_warehouse_wear(conn, d: dict, run: dict, msg: dict):
    """What the run did to the sets that were on the car: wear never goes back, and a set
    cannot wear faster than the laps it did allow."""
    w = _load_warehouse(conn.execute("SELECT warehouse FROM driver WHERE player_id=?", (d["player_id"],)).fetchone()[0])
    sets = {t["id"]: t for t in w["tyres"]}
    allowed = {run["tyre_set"]["id"]} | set(run.get("mounted", []))
    log = msg.get("tyre_log") if isinstance(msg.get("tyre_log"), list) else []
    for e in log[:10]:
        if not isinstance(e, dict):
            continue
        t = sets.get(e.get("set"))
        if not t or t["id"] not in allowed or not isinstance(e.get("wear"), list) or len(e["wear"]) < 4:
            continue
        try:
            wear = [min(1., max(0., float(x))) for x in e["wear"][:4]]
            laps = int(min(80, max(0, float(e.get("laps", 0)))))
        except (TypeError, ValueError, OverflowError):
            continue
        t["wear"] = [round(min(1., max(o, min(x, o + .07 * laps + .05))), 4) for o, x in zip(t["wear"], wear)]
        t["laps"] += laps
        t["runs"] += int(laps > 0)
    _save_warehouse(conn, d["player_id"], w)


# ── The research team and the production line ───────────────────────────────

def fitted_design(d: dict, part: str) -> dict:
    return parts_lab.design_of(d["lab"], part, d["fitted"].get(part, parts_lab.stock_id(part)))


def fitted_stats(d: dict, swap: dict = None) -> dict:
    out = {p: fitted_design(d, p)["stats"] for p in PARTS}
    out.update(swap or {})
    return out


def car_mods_of(d: dict) -> dict:
    return parts_lab.car_mods(fitted_stats(d))


def _busy(conn, player_id: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone())


def _load_for_update(conn, player_id: str) -> dict:
    return _row(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())


def _save_lab(conn, d: dict):
    conn.execute("UPDATE driver SET lab=?, warehouse=? WHERE player_id=?", (json.dumps(d["lab"]), json.dumps(d["warehouse"]), d["player_id"]))


def research_start(player_id: str, part: str, base_id: str, push) -> str | None:
    """Hire the team for one research. The price is flat and not returned, whatever they find."""
    if part not in PARTS:
        return "part"
    push = parts_lab.clean_push(push)
    if push is None or not isinstance(base_id, str):
        return "research"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _load_for_update(conn, player_id)
        lab = d["lab"]
        if not d["has_car"]:
            return "car"
        if lab["research"]:
            return "research_busy"
        base = next((g for g in parts_lab.designs_of(lab, part) if g["id"] == base_id), None)
        if not base:
            return "research"
        if len([g for g in lab["designs"] if g["part"] == part]) >= parts_lab.MAX_DESIGNS:
            return "designs_full"
        cost = parts_lab.RESEARCH_COST[part]
        if d["budget"] < cost:
            return "budget"
        now = time.time()
        lab["research"] = {"part": part, "base": base["id"], "push": push, "cost": cost, "started": now,
                           "done_at": now + parts_lab.research_seconds(lab, part), "seed": random.getrandbits(40), "status": "running"}
        lab["done"][part] = lab["done"].get(part, 0) + 1
        team.note(conn,player_id,"research",{'part':part})
        conn.execute("UPDATE driver SET budget=budget-?, lab=? WHERE player_id=?", (cost, json.dumps(lab), player_id))
        conn.commit()
        return None
    finally:
        conn.close()


def research_decide(player_id: str, action: str) -> str | None:
    """Accept the finished report as a new design, or reject it. Either way the team has been paid."""
    if action not in ("accept", "reject"):
        return "research"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _load_for_update(conn, player_id)
        lab = d["lab"]
        r = lab["research"]
        if not r or r.get("status") != "ready":
            return "research"
        if action == "accept":
            part = r["part"]
            ver = max(lab["next_ver"].get(part, 2), 2)
            lab["next_ver"][part] = ver + 1
            lab["designs"].append({"id": f"{part}-{ver}", "part": part, "ver": ver, "stats": r["report"]["after"], "base": r["base"]})
        lab["research"] = None
        conn.execute("UPDATE driver SET lab=? WHERE player_id=?", (json.dumps(lab), player_id))
        conn.commit()
        return None
    finally:
        conn.close()


def build_order(player_id: str, design_id: str, qty) -> str | None:
    """Put parts of an accepted design on the production line; they are paid now and arrive one by one."""
    try:
        qty = int(qty)
    except (TypeError, ValueError, OverflowError):
        return "build"
    if not 1 <= qty <= parts_lab.MAX_BATCH or not isinstance(design_id, str):
        return "build"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _load_for_update(conn, player_id)
        lab, w = d["lab"], d["warehouse"]
        design = next((g for p in PARTS for g in parts_lab.designs_of(lab, p) if g["id"] == design_id), None)
        if not design:
            return "build"
        if not d["has_car"]:
            return "car"
        if len(lab["queue"]) >= parts_lab.MAX_QUEUE:
            return "queue_full"
        if len(w["parts"]) + sum(o["qty"] - o["delivered"] for o in lab["queue"]) + qty > parts_lab.MAX_STORED_PARTS:
            return "warehouse_full"
        cost = parts_lab.unit_cost(design["part"], design["stats"], PARTS[design["part"]]["new"]) * qty
        if d["budget"] < cost:
            return "budget"
        per = parts_lab.build_seconds(design["part"], design["ver"], design["stats"])
        now = time.time()
        start = max([now] + [o["start"] + o["qty"] * o["per_unit"] for o in lab["queue"]])
        lab["seq"] += 1
        lab["queue"].append({"id": lab["seq"], "part": design["part"], "design": design["id"], "qty": qty, "delivered": 0,
                             "start": start, "per_unit": per, "done_at": start + qty * per})
        team.note(conn,player_id,"production",{'part':design['part'],'qty':qty})
        conn.execute("UPDATE driver SET budget=budget-?, lab=? WHERE player_id=?", (cost, json.dumps(lab), player_id))
        conn.commit()
        return None
    finally:
        conn.close()


def _park_fitted(d: dict, part: str):
    """The part that comes off the car goes to the warehouse with its wear, unless it is finished."""
    w = d["warehouse"]
    if d["parts"][part] >= .999 or len(w["parts"]) >= parts_lab.MAX_STORED_PARTS:
        return
    w["seq"] += 1
    w["parts"].append({"id": f"u{w['seq']}", "part": part, "design": d["fitted"].get(part, parts_lab.stock_id(part)), "wear": round(d["parts"][part], 4)})


def fit_part(player_id: str, unit_id) -> str | None:
    """Fit a part from the warehouse; the part on the car goes back into it."""
    if not isinstance(unit_id, str):
        return "unit"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if _busy(conn, player_id):
            return "busy"
        d = _load_for_update(conn, player_id)
        w = d["warehouse"]
        unit = next((u for u in w["parts"] if u["id"] == unit_id), None)
        if not unit or not d["has_car"]:
            return "unit"
        part = unit["part"]
        w["parts"].remove(unit)
        _park_fitted(d, part)
        d["parts"][part] = unit["wear"]
        d["fitted"][part] = unit["design"]
        conn.execute("UPDATE driver SET parts=?, fitted=?, warehouse=? WHERE player_id=?",
                     (json.dumps(d["parts"]), json.dumps(d["fitted"]), json.dumps(w), player_id))
        conn.commit()
        return None
    finally:
        conn.close()


def discard_part(player_id: str, unit_id) -> str | None:
    if not isinstance(unit_id, str):
        return "unit"
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if _busy(conn, player_id):
            return "busy"
        d = _load_for_update(conn, player_id)
        w = d["warehouse"]
        left = [u for u in w["parts"] if u["id"] != unit_id]
        if len(left) == len(w["parts"]):
            return "unit"
        w["parts"] = left
        _save_warehouse(conn, player_id, w)
        conn.commit()
        return None
    finally:
        conn.close()


def _public_design(g: dict, part: str) -> dict:
    return {"id": g["id"], "ver": g["ver"], "stats": g["stats"], "stock": bool(g.get("stock")),
            "cost": parts_lab.unit_cost(part, g["stats"], PARTS[part]["new"]),
            "seconds": parts_lab.build_seconds(part, g["ver"], g["stats"])}


def public_lab(d: dict) -> dict:
    lab = d["lab"]
    research = None
    r = lab["research"]
    if r:
        research = {k: r[k] for k in ("part", "base", "push", "cost", "started", "done_at", "status")}
        if r["status"] == "ready":
            part, after = r["part"], r["report"]["after"]
            now_mods, new_mods = car_mods_of(d), parts_lab.car_mods(fitted_stats(d, {part: after}))
            research["report"] = {"before": r["report"]["before"], "after": after,
                                  "unit_cost": parts_lab.unit_cost(part, after, PARTS[part]["new"]),
                                  "seconds": parts_lab.build_seconds(part, lab["next_ver"].get(part, 2), after),
                                  "balance": new_mods["balance"], "balance_now": now_mods["balance"],
                                  "pace": new_mods["pace"], "pace_now": now_mods["pace"]}
    mods = car_mods_of(d)
    return {
        "now": time.time(),
        "designs": {p: [_public_design(g, p) for g in parts_lab.designs_of(lab, p)] for p in PARTS},
        "fitted": {p: d["fitted"].get(p, parts_lab.stock_id(p)) for p in PARTS},
        "research": research, "queue": lab["queue"],
        "info": {p: {"cost": parts_lab.RESEARCH_COST[p], "seconds": parts_lab.research_seconds(lab, p)} for p in PARTS},
        "balance": mods["balance"], "pace": mods["pace"], "mass": mods["sim"]["mass"],
        "repair_cost": {p: repair_price(d, p, d["parts"][p]) for p in PARTS},
        "consts": {"segs": list(parts_lab.SEGS), "stock": parts_lab.STOCK, "safe": parts_lab.SAFE, "limit": parts_lab.LIMIT,
                   "push_min": parts_lab.PUSH_MIN, "push_max": parts_lab.PUSH_MAX, "max_batch": parts_lab.MAX_BATCH,
                   "max_queue": parts_lab.MAX_QUEUE},
    }


# ── The parts of the car ────────────────────────────────────────────────────

def repair_price(d: dict, part: str, wear: float) -> int:
    """The repair follows the price of making this very part (its fitted design), in proportion to its wear."""
    return int(round(REPAIR_SHARE * parts_lab.unit_cost(part, fitted_design(d, part)["stats"], PARTS[part]["new"]) * max(.25, wear) / 100.0) * 100)


def part_action(player_id: str, part: str, mode: str):
    """Repair a part (cheaper than a new one, leaves some wear, impossible on a finished part).
    A new part is never bought on the spot: it is built on the production line and fitted from the warehouse."""
    if part not in PARTS or mode != "repair":
        return None, "part"
    d = get_driver(player_id)
    if not d["has_car"]:
        return None, "car"
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _row(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return None, "busy"
        w, info = d["parts"][part], PARTS[part]
        if w >= .999: return None, "broken"
        if w < .03: return None, "nothing"
        cost = repair_price(d, part, w)
        new = w * REPAIR_KEEPS
        if d["budget"] < cost: return None, "budget"
        parts = dict(d["parts"])
        parts[part] = new
        team.note(conn,player_id,"repair",{'part':part,'car':d['car_id']})
        conn.execute("UPDATE driver SET budget=budget-?, parts=? WHERE player_id=?", (cost, json.dumps(parts), player_id))
        conn.commit()
        return {"part": part, "cost": cost, "wear": new}, None
    finally:
        conn.close()


_MODE_WEAR = [0, 0.75, 0.88, 1.0, 1.15, 1.35]


def apply_wear(player_id: str, laps: int, setup: dict, kind: str, bottoming: float = 0.0, failed: str = None) -> dict:
    """What driving does to the car: every lap wears every part, some by how it was set up."""
    d = get_driver(player_id)
    parts = dict(d["parts"])
    race = 1.12 if kind == "race" else 1.0
    stress = {
        "engine": _MODE_WEAR[int(setup["engine"])] * (1 + max(0, setup["gearing"]) * 0.03),
        "gearbox": 1.0 + abs(setup["gearing"]) * 0.04,
        "battery": 1.0,
        "brakes": 1.0 + abs(setup["brakeBias"] - 58) * 0.02,
        "suspension": 1.0 + max(0, 30 - setup["rideF"]) * 0.03 + max(0, setup["springF"] - 300) * 0.002,
        "floor": 1.0 + min(5.0, bottoming) * 0.35 + max(0, 28 - setup["rideF"]) * 0.04,
        "frontWing": 1.0, "rearWing": 1.0,
    }
    delta = {}
    for k, info in PARTS.items():
        add = info["rate"] * laps * stress[k] * race
        if add > 0:
            before = parts[k]
            parts[k] = min(1.0, before + add)
            delta[k] = round(parts[k] - before, 4)
    if failed in parts:
        parts[failed] = 1.0 if failed in ("engine", "gearbox") else max(parts[failed], 0.9)
        delta[failed] = round(parts[failed] - d["parts"][failed], 4)
    _update(player_id, parts=parts)
    return delta


def crash_damage(player_id: str, impact: float) -> dict:
    k = min(1.0, max(0.25, (impact - 25.0) / 40.0))
    hit = {"suspension": 0.35, "floor": 0.40, "frontWing": 0.70, "rearWing": 0.35, "brakes": 0.10, "engine": 0.08}
    d = get_driver(player_id)
    parts = dict(d["parts"])
    out = {}
    for p, v in hit.items():
        parts[p] = min(1.0, parts[p] + v * k)
        out[p] = round(v * k, 3)
    _update(player_id, parts=parts)
    return out


def part_failure_chance(wear: float) -> float:
    """Chance that a part fails during WEAR_KM of driving: tiny on a healthy part, rising smoothly with its wear."""
    return 0.0004 + 0.10 * min(1.0, max(0.0, wear)) ** 3


def plan_incidents(skills: dict, parts: dict, laps: int, kind: str, water: float, rnd, km_scale: float = 1.0) -> tuple:
    """Decided by the server before the run so a browser cannot skip them: the first
    driver error (a crash risk that falls with skill) and the first part to break."""
    s = sum(training_rules.effective_skill(skills[k]) for k in ("focus","composure","cornering")) / 300.0
    p_crash = (0.008 + 0.040 * (1 - s) ** 1.6) * (1 + min(0.6, water * 0.25))
    first = 0 if kind == "race" else 1
    crash = None
    for lap in range(first, laps + (0 if kind == "race" else 1)):
        if rnd.random() < p_crash:
            crash = {"lap": lap, "at": round(rnd.uniform(0.05, 0.95), 3)}
            break
    fail = None
    for lap in range(0, laps + 1):
        for part, w in parts.items():
            p = part_failure_chance(w) * km_scale
            if rnd.random() < p:
                fail = {"lap": lap, "part": part, "at": round(rnd.uniform(0.1, 0.9), 3)}
                break
        if fail:
            break
    return crash, fail




def profile_of(car_id, pilot_id, mods: dict, skills: dict) -> dict:
    """What a lap was driven with, kept small: which car and driver, what the fitted parts do to the car (not the part names, so
    a new version simply shows as a different car), and how good the driver was then."""
    sim = {k: round(float(v), 4) for k, v in (mods or {}).items() if isinstance(v, (int, float))}
    overall = round(sum(skills.values()) / max(1, len(skills)), 1) if skills else 0
    return {"car": car_id, "pilot": pilot_id, "mods": sim, "overall": overall}


def current_profile(d: dict) -> dict:
    return profile_of(d.get("car_id"), d.get("pilot_id"), car_mods_of(d)["sim"], d.get("skills") or {})


def record_run(player_id, track, kind, compound, hour, cond, laps, rows, best, points, race_time, position, prize, cost,
               dnf, pits, setup, final_setup, _conn=None, qualification=None, pilot_id=None, session_token=None, who=None, profile=None) -> int:
    conn = _conn or _connect()
    try:
        cur = conn.execute(
            "INSERT INTO runs (player_id,track,kind,compound,hour,water,air,asphalt,laps,best,points,race_time,position,prize,cost,dnf,pits,setup,final_setup,at,qualification,pilot_id,session_token,profile)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (player_id, track, kind, compound, hour, cond["water"], cond["air"], cond["track"], laps, best, points, race_time,
             position, prize, cost, dnf, pits, json.dumps(setup), json.dumps(final_setup), time.time(),json.dumps(qualification) if qualification else None,pilot_id,session_token,json.dumps(profile) if profile else None))
        rid = cur.lastrowid
        for r in rows:
            sec = (r.get("sectors") or [])
            ok_sec = len(sec) == 3 and abs(sum(sec) - r["time"]) < 0.08
            conn.execute("INSERT INTO lap_log (run_id,player_id,track,n,lap_time,s1,s2,s3,valid,pen,pit,who) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                         (rid, player_id, track, r["n"], r["time"], sec[0] if ok_sec else None, sec[1] if ok_sec else None,
                          sec[2] if ok_sec else None, 1 if r["valid"] else 0, r.get("pen", 0), 1 if r.get("pit") else 0, who))
        if _conn is None: conn.commit()
        return rid
    finally:
        if _conn is None: conn.close()


def sector_bests(player_id: str, track: str = TRACK) -> dict:
    """Best sectors of the player and of everybody, from valid laps without a pit stop."""
    track = tkey(player_id, track)
    conn = _connect()
    try:
        out = {}
        for who, where, args in (("personal", "AND player_id=?", (player_id,)), ("record", "", ())):
            row = conn.execute(
                f"SELECT MIN(s1) a, MIN(s2) b, MIN(s3) c, MIN(lap_time) t FROM lap_log WHERE track=? AND valid=1 AND pit=0 AND pen=0 {where}",
                (track,) + args).fetchone()
            out[who] = [row["a"], row["b"], row["c"]]
            out[who + "_lap"] = row["t"]
        return out
    finally:
        conn.close()


def best_laps(player_id: str, track: str = TRACK, profile: dict = None) -> dict:
    track = tkey(player_id, track)
    conn = _connect()
    try:
        allb = conn.execute("SELECT MIN(lap_time) AS t, COUNT(*) AS n FROM lap_log WHERE player_id=? AND track=? AND valid=1 AND pit=0 AND pen=0",
                            (player_id, track)).fetchone()
        pts = conn.execute("SELECT MAX(points) AS p FROM runs WHERE player_id=? AND track=?", (player_id, track)).fetchone()
        rec = conn.execute("SELECT MIN(lap_time) AS t FROM lap_log WHERE track=? AND valid=1 AND pit=0 AND pen=0", (track,)).fetchone()
        runs = conn.execute("SELECT COUNT(*) n, SUM(kind='qualifying') r FROM runs WHERE player_id=? AND track=?", (player_id, track)).fetchone()
        sb = sector_bests(player_id, track)
        theo = sum(sb["personal"]) if all(x is not None for x in sb["personal"]) else None
        out = {"best": allb["t"], "points": pts["p"], "count": allb["n"], "record": rec["t"], "runs": runs["n"], "races": runs["r"] or 0,
               "sectors": sb["personal"], "record_sectors": sb["record"], "theoretical": theo}
        # who holds the record, and what the team would advise: the setup of this driver's best run here
        h = conn.execute("SELECT l.player_id pid, l.who who, l.lap_time t, r.compound c, r.setup s, r.at at FROM lap_log l JOIN runs r ON r.id=l.run_id "
                         "WHERE l.track=? AND l.valid=1 AND l.pit=0 AND l.pen=0 ORDER BY l.lap_time LIMIT 1", (track,)).fetchone()
        out["record_by"] = {"who": h["who"], "mine": h["pid"] == player_id, "compound": h["c"], "at": h["at"]} if h else None
        pil = conn.execute("SELECT pilot_id FROM driver WHERE player_id=?", (player_id,)).fetchone()
        b = conn.execute("SELECT r.setup s, r.best t, r.compound c, r.air a, r.water w, r.at at FROM runs r WHERE r.player_id=? AND r.track=? AND r.best IS NOT NULL "
                         "AND (? IS NULL OR r.pilot_id=?) ORDER BY r.best LIMIT 1", (player_id, track, pil["pilot_id"] if pil else None, pil["pilot_id"] if pil else None)).fetchone()
        # every valid-timed run here by anyone on this account: the team weighs them by driver, time and conditions
        pool = conn.execute("SELECT r.setup s, r.best t, r.laps n, r.air a, r.asphalt k, r.water w, r.pilot_id p, r.profile pr FROM runs r WHERE r.player_id=? AND r.track=? AND r.best IS NOT NULL "
                            "ORDER BY r.best LIMIT 60", (player_id, track)).fetchall()
        cur_p = pil["pilot_id"] if pil else None
        out["pool"] = [{"setup": clean_setup(json.loads(x["s"])), "best": x["t"], "laps": x["n"], "air": x["a"], "asphalt": x["k"], "water": x["w"],
                        "mine": x["p"] is None or x["p"] == cur_p, "profile": json.loads(x["pr"]) if x["pr"] else None} for x in pool]
        out["now"] = profile or current_profile(get_driver(player_id))
        out["advice"] = {"setup": clean_setup(json.loads(b["s"])), "best": b["t"], "compound": b["c"], "air": b["a"], "water": b["w"], "at": b["at"]} if b else None
        return out
    finally:
        conn.close()


def list_runs(player_id: str, track: str = TRACK, limit: int = 40) -> list:
    track = tkey(player_id, track)
    conn = _connect()
    try:
        rows = conn.execute("SELECT * FROM runs WHERE player_id=? AND track=? ORDER BY at DESC LIMIT ?", (player_id, track, limit)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["qualification"] = json.loads(d["qualification"]) if d.get("qualification") else None
            d["weekend"] = json.loads(d["weekend"]) if d.get("weekend") else None
            d["setup"] = json.loads(d["setup"])
            d["final_setup"] = json.loads(d["final_setup"]) if d["final_setup"] else d["setup"]
            out.append(d)
        return out
    finally:
        conn.close()


def run_detail(player_id: str, run_id: int):
    conn = _connect()
    try:
        r = conn.execute("SELECT * FROM runs WHERE id=? AND player_id=?", (run_id, player_id)).fetchone()
        if not r:
            return None
        d = dict(r)
        d["qualification"] = json.loads(d["qualification"]) if d.get("qualification") else None
        d["weekend"] = json.loads(d["weekend"]) if d.get("weekend") else None
        d["setup"] = json.loads(d["setup"])
        d["final_setup"] = json.loads(d["final_setup"]) if d["final_setup"] else d["setup"]
        d["laps_log"] = [dict(x) for x in conn.execute("SELECT n, lap_time, s1, s2, s3, valid, pen, pit FROM lap_log WHERE run_id=? ORDER BY n", (run_id,))]
        return d
    finally:
        conn.close()


# ── Training ────────────────────────────────────────────────────────────────
# Seven short simulators. The browser plays them; the server hands out the
# session, charges for it, scores the raw numbers itself and decides the gain.

# Pilot training: one game for each skill (pilot_games.py); the game id is the skill id.
GAMES = pilot_games.GAMES
# The pit crew trains with the same simulators, one exercise for each kind of position
# (crew.TRAINING); the minimum seconds of a real session come from the simulator that plays it.
CREW_MIN_SECONDS = {"pit": 2, "brake": 10, "rhythm": 18, "lights": 10, **{k: 29.5 for k in crew_training.MECHANICS}}


def _f(v, lo, hi, default=0.0):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(v):
        return default
    return min(hi, max(lo, v))


def training_difficulty(skills: dict, game: str) -> float:
    """How much faster and smaller the games that scale with the level are for this pilot."""
    return pilot_games.level(skills.get(game, 50))


def training_levels(skills: dict) -> dict:
    return {game: training_difficulty(skills, game) for game in GAMES}


def training_references(skills: dict) -> dict:
    """What counts as 'as good as now' in each game, shown to the player before and after a session."""
    return {game: dict(ref=round(pilot_games.reference(game, skills.get(game, 50)), 3), unit=g.get('unit', ''), low=g.get('low', False), kind=g['kind'])
            for game, g in GAMES.items()}


def training_session(player_id: str, tid: str) -> dict:
    conn = _connect()
    try:
        return dict(conn.execute("SELECT * FROM training WHERE tid=? AND player_id=?", (tid, player_id)).fetchone())
    finally:
        conn.close()


def crew_train_start(player_id: str, game: str, member_id: str):
    """A crew member trains: their own energy pays for it, and the exercise is as hard as their skills."""
    if game not in crew.TRAINING:
        return None, "game"
    get_driver(player_id)
    tid = "t%x%x" % (int(time.time() * 1000), random.getrandbits(24))
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = crew.member_row(conn, player_id, member_id)
        if not row:
            return None, "member"
        if crew.TRAINING[game][0] != crew.POSITIONS[row["position"]][0]:
            return None, "game"
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return None, "busy"
        now = time.time()
        if not training_rules.consume(conn, player_id, now):
            return None, 'training_limit'
        p = crew.member_at(json.loads(row["profile"]), now, specialists.regen(conn, player_id))
        if p["energy"] < crew.TRAIN_ENERGY:
            return None, "energy"
        difficulty = crew.difficulty(p, game)
        p["energy"] -= crew.TRAIN_ENERGY
        p["energy_ts"] = now
        conn.execute("UPDATE crew_member SET profile=? WHERE id=?", (json.dumps(p), member_id))
        conn.execute("INSERT INTO training (tid,player_id,game,started,difficulty,pilot_id,subject,mechanic) VALUES (?,?,?,?,?,?,?,?)",
                     (tid, player_id, game, now, difficulty, None, member_id, crew.TRAINING[game][2]))
        conn.commit()
    finally:
        conn.close()
    return tid, None


def staff_train_start(player_id: str, game: str, member_id: str):
    """A specialist trains in their own mini game: their own energy pays for it."""
    get_driver(player_id)
    tid = "t%x%x" % (int(time.time() * 1000), random.getrandbits(24))
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _load_for_update(conn, player_id)
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return None, "busy"
        now = time.time()
        got = specialists.start(conn, d, game, member_id, now)
        if isinstance(got, str):
            return None, got
        row, p = got
        if not training_rules.consume(conn, player_id, now):
            return None, 'training_limit'
        difficulty = specialists.difficulty(p['level'])
        p["energy"] -= specialists.TRAIN_ENERGY
        p["energy_ts"] = now
        conn.execute("UPDATE staff_member SET profile=? WHERE id=?", (json.dumps(p), member_id))
        conn.execute("INSERT INTO training (tid,player_id,game,started,difficulty,pilot_id,subject,mechanic) VALUES (?,?,?,?,?,?,?,?)",
                     (tid, player_id, game, now, difficulty, None, member_id, 'staff'))
        conn.commit()
    finally:
        conn.close()
    return tid, None


def train_start(player_id: str, game: str, subject=None):
    if subject:
        if game in specialists.ROLE_OF_GAME:
            return staff_train_start(player_id, game, subject)
        return crew_train_start(player_id, game, subject)
    if game not in GAMES:
        return None, "game"
    pilot = get_driver(player_id)
    if not pilot["has_driver"]:
        return None, "driver"
    tid = "t%x%x" % (int(time.time() * 1000), random.getrandbits(24))
    conn = _connect()
    try:
        # The energy debit and session creation are one transaction. Concurrent
        # starts cannot spend the same energy twice, even with an empty budget.
        conn.execute("BEGIN IMMEDIATE")
        d = conn.execute("SELECT energy,energy_ts,skills,pilot_id,has_driver FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not d["has_driver"]:
            conn.rollback()
            return None, "driver"
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return None, "busy"
        now = time.time()
        if not training_rules.consume(conn, player_id, now):
            return None, 'training_limit'
        energy = min(ENERGY_MAX, d["energy"] + max(0, now-d["energy_ts"]) * specialists.regen(conn, player_id))
        if energy < TRAIN_ENERGY:
            conn.rollback()
            return None, "energy"
        difficulty = training_difficulty(json.loads(d["skills"]), game)
        conn.execute("UPDATE driver SET energy=?, energy_ts=? WHERE player_id=?", (energy-TRAIN_ENERGY, now, player_id))
        conn.execute("INSERT INTO training (tid,player_id,game,started,difficulty,pilot_id) VALUES (?,?,?,?,?,?)", (tid, player_id, game, now, difficulty,d["pilot_id"]))
        conn.commit()
    finally:
        conn.close()
    return tid, None


def score_training(game: str, res: dict, difficulty: float = 0) -> float:
    """0..1 from the raw numbers the browser measured."""
    if game in crew_training.MECHANICS:
        return crew_training.score(game, res, difficulty)
    res = res if isinstance(res, dict) else {}
    difficulty = max(0, float(difficulty))
    challenge = difficulty*difficulty
    def samples(key, count):
        value=res.get(key)
        return value[:count] if isinstance(value,list) else []
    if game == "lights":
        times = [_f(x, -1, 5000, -1) for x in samples("times",5)]
        good = sorted(t for t in times if t >= 110)
        if len(good) < 2:
            return 0.0
        avg = sum(good) / len(good)
        false = sum(1 for t in times if t < 110)
        best, fail = 350/(1+2*challenge), 850/(1+2.7*challenge)
        return max(0.0, min(1.0, (fail-avg)/max(1,fail-best))) * len(good)/5 * max(0,1-.12*false)
    if game == "catch":
        total = max(1, int(_f(res.get("total"), 0, 200)))
        caught = int(_f(res.get("caught"), 0, 200))
        return max(0.0, min(1.0, caught / total)) ** (1+3*challenge) * min(1.0, total / 28)
    if game in ("tracking", "throttle"):
        return _f(res.get("inside"), 0, 1) ** (1+1.5*challenge)
    if game == "brake":
        errs = [abs(_f(x, -400, 400, 400)) for x in samples("errors",6)]
        if len(errs) != 6:
            return 0.0
        return max(0.0, min(1.0, 1 - (sum(errs) / len(errs)) / (40.0/(1+15*challenge))))
    if game == "rhythm":
        taps = int(_f(res.get("taps"), 0, 400))
        even = _f(res.get("even"), 0, 1)
        return max(0.0, min(1.0, taps / (50.0+180*challenge))) * (0.4 + 0.6 * even)
    if game == "endurance":
        buckets=[_f(x,0,1000) for x in samples('buckets',6)]
        if len(buckets)!=6:return 0.0
        pace=min(1,sum(buckets)/(180+600*challenge))
        sustain=min(1,sum(buckets[-2:])/max(1,sum(buckets[:2])))
        return pace*(.4+.6*sustain)
    if game == "pit":
        steps = max(1, int(_f(res.get("steps"), 0, 100)))
        wrong = int(_f(res.get("wrong"), 0, 100))
        secs = _f(res.get("seconds"), 0.1, 600, 60)
        deadline, best = 34/(1+7*challenge), 12/(1+5*challenge)
        speed = max(0.0, min(1.0, (deadline-secs)/max(.01,deadline-best)))
        return max(0.0, min(1.0, speed * min(1,steps / 12) - 0.12 * wrong))
    return 0.0


def train_finish(player_id: str, tid: str, result: dict):
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        t = conn.execute('SELECT * FROM training WHERE tid=? AND player_id=?', (tid,player_id)).fetchone()
        if not t or t['done']:return None, 'session'
        if t['mechanic']=='staff':
            row=conn.execute('SELECT * FROM staff_member WHERE id=? AND player_id=?',(t['subject'],player_id)).fetchone()
            if not row:return None,'session'
            profile=json.loads(row['profile'])
            quick=time.time()-t['started']<specialists.MIN_SECONDS
            p,gain=specialists.apply_training(profile,specialists.score(result),valid=not quick)
            conn.execute('UPDATE staff_member SET profile=? WHERE id=?',(json.dumps(profile),t['subject']))
            conn.execute('UPDATE training SET done=1 WHERE tid=?',(tid,))
            conn.commit()
            return dict(gains={'level':gain} if gain else {},score=round(p,4),percent=round(p*100,1)),None
        is_crew=bool(t['subject'])
        if is_crew:
            row=crew.member_row(conn,player_id,t['subject'])
            if not row:return None,'session'
            profile=json.loads(row['profile'])
            mechanic=t['mechanic'] or crew.LEGACY_TRAINING[t['game']][0]
            minimum=CREW_MIN_SECONDS[mechanic]
        else:
            row=conn.execute('SELECT * FROM team_pilot WHERE id=? AND player_id=?',(t['pilot_id'],player_id)).fetchone()
            if not row:return None,'session'
            d=_load_for_update(conn,player_id)
            profile=team.snapshot(d,team.PILOT_FIELDS) if d['pilot_id']==t['pilot_id'] else team.pilot_at(json.loads(row['profile']),time.time(),specialists.regen(conn,player_id))
        if is_crew:
            perf=score_training(mechanic,result,t['difficulty'])
            quick=time.time()-t['started'] < training_rules.minimum_seconds(mechanic,t['difficulty'],minimum)
            gains=crew.apply_training(profile,t['game'],perf,legacy=not t['mechanic'],valid=not quick)
            conn.execute('UPDATE crew_member SET profile=? WHERE id=?',(json.dumps(profile),t['subject']))
            p=0.0 if quick else max(-1.0,min(1.0,2.0*perf-1.0))
            detail=dict(score=round(p,4),percent=round(p*100,1))
        else:
            game=t['game']
            if game not in GAMES:return None,'session'
            before=profile['skills'][game]
            p,measured,ref=pilot_games.percent(game,before,result)
            real=measured is not None and time.time()-t['started'] >= GAMES[game]['minimum']
            if not real:p=0.0
            # the coach adds points to every real session, good or bad
            bonus=specialists.coach_bonus(conn,player_id) if real else 0.0
            profile['skills'][game]=max(SKILL_FLOOR,before+p+bonus)
            gains={game:round(profile['skills'][game]-before,3)} if profile['skills'][game]!=before else {}
            profile['trainings']=profile.get('trainings',0)+1
            conn.execute('UPDATE team_pilot SET profile=? WHERE id=?',(json.dumps(profile),t['pilot_id']))
            if d['pilot_id']==t['pilot_id']:
                team.write_projection(conn,player_id,dict(skills=profile['skills'],trainings=profile['trainings']))
            detail=dict(score=round(p,4),percent=round(p*100,1),coach=round(bonus*100,1),measured=None if measured is None else round(measured,4),reference=round(ref,4),unit=GAMES[game].get('unit',''),low=GAMES[game].get('low',False),kind=GAMES[game]['kind'])
        conn.execute('UPDATE training SET done=1 WHERE tid=?',(tid,))
        conn.commit()
        return dict(gains=gains,**detail),None
    finally:conn.close()

# ── Team ownership, careers and official solo qualifying ────────────────────

def _age_penalty(age: float, skill: str) -> float:
    if skill in ("reaction", "reflexes", "fitness"):
        return max(0, min(age, 38)-32)*.65 + max(0, age-38)*1.8
    if skill in ("pace", "braking", "cornering", "traction", "wet"):
        return max(0, min(age, 38)-34)*.35 + max(0, age-38)
    return max(0, age-42)*.15


def _age_driver(conn, d: dict, now: float):
    updates = {}
    if d["has_car"] and not d["car_id"]:
        updates["car_id"] = uuid.uuid4().hex
    if d["has_driver"]:
        if not d["pilot_id"]:
            updates.update(pilot_id=uuid.uuid4().hex, age_origin=now-max(0,d["age"]-17)*AGE_YEAR_SECONDS,
                           age_checked=now,recruited_at=now)
        if "pilot_id" in updates:
            conn.execute("UPDATE training SET pilot_id=? WHERE player_id=? AND pilot_id IS NULL",(updates["pilot_id"],d["player_id"]))
        if not d.get("character"):updates["character"]=season.driver_character(updates.get("pilot_id") or d["pilot_id"])
        origin = updates.get("age_origin", d["age_origin"])
        checked = updates.get("age_checked", d["age_checked"]) or now
        age = 17 + max(0, now-origin)/AGE_YEAR_SECONDS
        previous = 17 + max(0, checked-origin)/AGE_YEAR_SECONDS
        for key in SKILLS:
            loss = max(0, _age_penalty(age,key)-_age_penalty(previous,key))
            d["skills"][key] = max(SKILL_FLOOR,d["skills"][key]-loss)
            d["potential"][key] = max(SKILL_FLOOR,d["potential"][key]-loss)
        updates.update(age=int(age),age_checked=max(now,checked),skills=d["skills"],potential=d["potential"])
    if updates:
        conn.execute("UPDATE driver SET "+", ".join(k+"=?" for k in updates)+" WHERE player_id=?",
                     [json.dumps(v) if isinstance(v,dict) else v for v in updates.values()]+[d["player_id"]])
        d.update(updates)


def qualifying_forecast() -> list:
    return [dict(air=25.0,track=35.0,cloud=.2,rain=0.0,water=0.0,sun=.9,hum=45,rubber=1.0) for _ in range(24)]


def recruit_offers(player_id: str, now=None) -> list:
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        offers=team.ensure_offers(conn,player_id,time.time() if now is None else now)
        conn.commit()
        return offers
    finally:conn.close()


def active_session(player_id: str):
    conn=_connect()
    try:
        row=conn.execute("SELECT id,kind,started FROM career_session WHERE player_id=? AND status=0",(player_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def public_career(d: dict) -> dict:
    remaining=0
    return {"started":d["created"],"recruit_price":RECRUIT_PRICE,"recruit_remaining":int(math.ceil(remaining)),
            "offers":[{k:v for k,v in o.items() if k!="potential"} for o in recruit_offers(d["player_id"])],
            "offers_refresh_at":(int(time.time()//RECRUIT_INTERVAL)+1)*RECRUIT_INTERVAL,
            "qualifications":d["qualifications"],"silver_sessions":d["silver_sessions"],"licensed":bool(d["license_unlocked"]),
            "sponsor_tier":d["sponsor_tier"],"sponsor_base":sponsor_state(d)["daily"],"sponsor_bonus":0,
            "qualify_seconds":QUALIFY_SECONDS,"practice_seconds":PRACTICE_SECONDS,"qualify_laps":QUALIFY_LAPS,"qualify_energy":QUALIFY_ENERGY,
            "prizes":QUALIFY_PRIZES,"targets":QUALIFY_TARGETS,"criteria":QUALIFY_CRITERIA,"forecast":qualifying_forecast(),
            "active_session":active_session(d["player_id"]),"previous_at":previous_career(d["player_id"])}


def public_team(d):
    conn=_connect()
    try:return team.roster(conn,d)
    finally:conn.close()


def team_action(player_id, action, ident=None, car=None, pilot=None):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id)
        error=team.assign(conn,d,car,pilot) if action=='assign' else team.select(conn,d,action,ident)
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def set_livery(player_id, car_id, colors):
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d = _load_for_update(conn, player_id)
        error = team.paint(conn, d, car_id, colors)
        if error: return error
        conn.commit()
        return None
    finally: conn.close()


def finance_state(player_id,before=None,category=None):
    d=get_driver(player_id)
    conn=_connect()
    try:
        out=team.finances(conn,d,before,category)
        out["sponsors"]=sponsors.state(conn,d)
        return out
    finally:conn.close()


def recruit_driver(player_id: str, offer_id: str):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id);now=time.time()
        error=team.locked(conn,d)
        if error:return error
        offer=next((o for o in team.ensure_offers(conn,player_id,now) if o['id']==offer_id),None)
        if not offer:return 'offer'
        if d['budget']<offer['price']:return 'budget'
        team.sync(conn,d)
        ident=uuid.uuid4().hex
        p=dict(pilot_id=ident,name=offer['name'],age=offer['age'],skills=offer['skills'],potential=offer['potential'],character=offer['character'],
               energy=100,energy_ts=now,age_origin=now-(offer['age']-17)*AGE_YEAR_SECONDS,age_checked=now,recruited_at=now,trainings=0)
        team.write_projection(conn,player_id,dict(p,has_driver=1,last_recruit_at=now))
        conn.execute('INSERT INTO team_pilot VALUES(?,?,?,?,?)',(ident,player_id,json.dumps(p),now,now))
        team.note(conn,player_id,'driver_recruitment',{'name':p['name'],'pilot':ident})
        conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?',(offer['price'],player_id))
        conn.execute('DELETE FROM team_offer WHERE id=? AND player_id=?',(offer_id,player_id))
        team.ensure_offers(conn,player_id,now)
        conn.commit()
        return None
    finally:conn.close()


def crew_hire(player_id: str, car_id: str, position: str, offer_id: str):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id)
        if _busy(conn,player_id):return 'busy'
        error=crew.hire(conn,d,car_id,position,offer_id)
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def crew_dismiss(player_id: str, member_id: str):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id)
        if _busy(conn,player_id):return 'busy'
        error=crew.dismiss(conn,d,member_id)
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def specialist_hire(player_id: str, role: str, offer_id: str):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id)
        if _busy(conn,player_id):return 'busy'
        error=specialists.hire(conn,d,role,offer_id)
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def specialist_dismiss(player_id: str, member_id: str):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        d=_load_for_update(conn,player_id)
        if _busy(conn,player_id):return 'busy'
        error=specialists.dismiss(conn,d,member_id)
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def public_specialists(d):
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        out=specialists.public(conn,d);conn.commit();return out
    finally:conn.close()


def public_crew(d):
    conn=_connect()
    try:
        out=crew.public_crew(conn,d,team.roster(conn,d)['cars']);conn.commit();return out
    finally:conn.close()


def abandon_session(player_id: str):
    conn=_connect()
    try:
        conn.execute("UPDATE career_session SET status=2 WHERE player_id=? AND status=0",(player_id,))
        conn.commit()
    finally:
        conn.close()


def race_fuel_kg(meta: dict) -> float:
    """The fuel loaded for a race: for a full distance it is the whole race, for a short one what the setup says."""
    race_m = meta['laps'] * meta['profile']['length']
    return race_m * .00033 * 1.03 + 1.5 if race_m > 60000 else meta.get('setup', {}).get('fuel', 30)


def weekend_trip_fee(d: dict, track_id: str) -> int:
    """Taking the whole team to a championship round: the trip and the entry fee. At home it costs nothing."""
    if track_id == tracks.OWN or track_id not in tracks.official():
        return 0
    return tracks.OFFICIAL_RENT_RACE + tracks.travel_cost("race", trip_km(d, track_id))


def _entries(conn, d):
    """The two entries of the team with the name of the driver in each: [{key, car_id, pilot_id, name, number, car, pilot}]."""
    out = team.slots(conn, d)
    for e in out:
        e["name"] = e["pilot"]["name"] if e["pilot"] else ""
        e["team"] = d.get("team_name") or ""
    return out


def reserve_session(player_id: str, kind: str, setup: dict, compound: str, laps: int, hour: int, tyre_set=None, track=None, tyre_set2=None):
    d=get_driver(player_id)
    competition=kind in tuple("d5_"+p for p in season.PHASES)
    if kind not in KINDS and not competition:return None,"future"
    track=track if valid_track(track) else TRACK
    if not competition and not can_practice(d,track):return None,"licence" if track!=tracks.OWN else "no_track"
    setup=clean_setup(setup)
    laps=QUALIFY_LAPS if kind=="qualifying" else max(MIN_LAPS,min(MAX_LAPS,int(laps)))
    fc=qualifying_forecast() if kind=="qualifying" else forecast(today_ord())
    real=None if competition else weather_of(d,track)
    if real:fc=real["forecast"]
    real_weekend=division_weather(d) if competition else None
    # a test session runs at the circuit's current hour; only the weekend sessions have their own times
    hour=12 if kind=="qualifying" else real["now"] if real and kind=="practice" else max(HOURS[0],min(HOURS[-1],int(hour)))
    compound=compound if compound in COMPOUNDS else "M"
    stocked=kind=="practice"   # practice runs on sets from the warehouse; the other sessions keep paying for their tyres
    cost=session_cost(setup,compound,laps,kind,track=track,tyres=not stocked,extra=practice_extra(d,track))
    if kind=="practice" and track==tracks.OWN:cost=0   # the team's own circuit costs nothing to go out on
    energy=training_rules.driving_energy(energy_cost(kind,laps),d["skills"]["fitness"])
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        current=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
        if not current["has_car"]:return None,"car"
        if not current["has_driver"]:return None,"driver"
        error=team.race_driver(conn,current)
        if error:return None,error
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0",(player_id,)).fetchone():return None,"busy"
        meta=None
        weekend_state=season.ensure(conn,current)
        mine=_entries(conn,current)
        key=team.slot_of(conn,current)
        if not competition and season.parc_ferme(weekend_state,key):return None,'parc_ferme'
        if stocked:
            chosen=next((t for t in current["warehouse"]["tyres"] if t["id"]==tyre_set),None)
            if not chosen or max(chosen["wear"])>=TYRE_DEAD:return None,"tyre_set"
            compound=chosen["compound"]
        if competition:
            if not key:return None,"division_requirements"
            set_ids={key:tyre_set}
            other=next((m for m in mine if m["key"]!=key),None)
            other_setups={}
            if other:
                set_ids[other["key"]]=tyre_set2
                # the other car runs with what its own garage has saved for this circuit (the open car's setup comes from the browser)
                oview=team.slot_view(current,other);tid=weekend_state["calendar"][weekend_state["round"]-1].get("track","zandvoort") if weekend_state.get("entered") and weekend_state["round"]<=20 else TRACK
                other_setups[other["key"]]=clean_setup((oview.get("setups") or {}).get(tid) or oview.get("setup"))
            meta,error=season.prepare(conn,current,kind,setup,key,mine,tyre_set,set_ids,other_setups=other_setups,real=real_weekend,race_laps=lambda tid:tracks.race_laps(track_of(current,tid) or {'length':3000}),trip=lambda tid:weekend_trip_fee(current,tid),usable=lambda tid:tid!=tracks.OWN or bool(current["own"] and tracks.hosting(current["own"])["ok"]))
            if error:return None,error
            meta['energy_base']=meta['energy']
            meta['energy']=training_rules.driving_energy(meta['energy_base'],current['skills']['fitness'])
            setup=meta['setup'];laps=meta['laps'];energy=meta['energy'];hour=meta['hour'];fc=meta['forecast'];compound=meta['tyre_set']['compound']
            track=meta['track'];circuit=track_of(current,track)
            if not circuit:return None,"no_track"
            meta['pace']=circuit['ref']['pace'];meta['profile']=circuit['profile']
            meta['time_factor']=grip_factor((meta['weather']['w0']+meta['weather']['w1'])/2)*meta['pace']
            race=meta['phase']=='race'
            cars=2
            fuel_of=lambda st:race_fuel_kg(meta) if race else st['fuel']
            cost=(35000 if race else 15000)*cars+meta['tyre_fee']+meta['trip_fee']+LAP_COST*(laps+int(not race))*cars+FUEL_COST*sum(fuel_of(e['setup']) for e in meta['entries'].values())
        if current["budget"]<cost:return None,"budget"
        car=car_mods_of(current);current["car_mods"]=car
        crash,fail=plan_incidents(current["skills"],current["parts"],laps,kind,fc[hour]["water"],random.Random(),((track_of(current,track) or {}).get("length") or 3000)/1000.0/WEAR_KM)
        token=uuid.uuid4().hex
        payload={"venue": {"grandstands":current["own"].get("grandstands",[]) if current.get("own") and track==tracks.OWN else [],"occupancy": tracks.race_income(current["own"])["occupancy"] if current.get("own") and track==tracks.OWN and kind=="d5_race" else 0},"livery":team.livery_of(conn,player_id,current["car_id"]),"session":token,"kind":kind,"setup":setup,"compound":compound,"laps":laps,"hour":hour,"hour_frac":real["now_frac"] if real and kind=="practice" else hour,"forecast":fc,
                 "seed":random.getrandbits(31),"cost":cost,"energy":energy,"parts":current["parts"],"mods":car["sim"],"car_mods":car,"skills":current["skills"],
                 "crash":crash,"fail":fail,"track":track,"ref":(track_of(current,track) or {}).get("ref"),"pit_cost":0,"duration":QUALIFY_SECONDS if kind=="qualifying" else None,
                 "character":dict(current["character"]),"car_id":current["car_id"],"pilot_id":current["pilot_id"],"start_energy":current["energy"],"wing_cost":0}
        if meta:
            payload.update(weekend={k:v for k,v in meta.items() if k not in ('forecast','tyres','profile','entries')},locked_setup=meta['phase'] in ('qualifying','race'),duration=meta['duration'],tyre_set=meta['tyre_set'],tyres=meta['tyres'],mounted=[])
            if meta['phase']=='race':
                cars_cfg=[]
                for m in mine:
                    view=team.slot_view(current,m);view["car_mods"]=car_mods_of(view)
                    entry=meta['entries'][m['key']]
                    cars_cfg.append(dict(key=m['key'],view=view,setup=entry['setup'] if m['key']!=key else setup,compound=entry['tyre_set']['compound'],tyre_set=entry['tyre_set'],
                                         tyres=entry['tyres'],livery=team.livery_of(conn,player_id,m['car_id']),crew=crew.crew_of(conn,m['car_id'])))
                payload['race_config']=race_engine.config(cars_cfg,meta,_DIR);payload['race_config'].update(spares={u['id']:u['wear'] for u in current['warehouse']['parts']},wear_rates={k:v['rate'] for k,v in PARTS.items()},wear_km=WEAR_KM)
                payload['entries']={c['key']:dict(tyre_set=c['tyre_set'],tyres=c['tyres'],compound=c['compound'],car_id=c['view']['car_id'],pilot_id=c['view']['pilot_id'],name=c['view']['name'],livery=c['livery']) for c in cars_cfg}
                payload['pit_times']={e['id']:e['pit_typical'] for e in payload['race_config']['entries'] if e.get('mine')}
                payload['entry_setups']={c['key']:c['setup'] for c in cars_cfg}
            else:
                payload['timing_field']=season.timing_field(meta)
                payload['key']=key
                if other:
                    oe=meta['entries'][other['key']];oview["car_mods"]=car_mods_of(oview)
                    ocrash,ofail=plan_incidents(oview["skills"],oview["parts"],laps,kind,fc[hour]["water"],random.Random(),((track_of(current,track) or {}).get("length") or 3000)/1000.0/WEAR_KM)
                    payload['other']=dict(livery=team.livery_of(conn,player_id,oview['car_id']),key=other['key'],name=other['name'],setup=oe['setup'],compound=oe['tyre_set']['compound'],tyre_set=oe['tyre_set'],tyres=oe['tyres'],mounted=[],
                                          skills=oview['skills'],parts=oview['parts'],mods=oview['car_mods']['sim'],car_mods=oview['car_mods'],character=dict(oview['character']),car_id=oview['car_id'],
                                          pilot_id=oview['pilot_id'],start_energy=oview['energy'],energy=training_rules.driving_energy(meta['energy_base'],oview['skills']['fitness']),crash=ocrash,fail=ofail,seed=random.getrandbits(31))
        elif stocked:
            payload.update(tyre_set=chosen,tyres=current["warehouse"]["tyres"],mounted=[],stocked=True)
        conn.execute("INSERT INTO career_session(id,player_id,pilot_id,kind,payload,started) VALUES(?,?,?,?,?,?)",
                     (token,player_id,current["pilot_id"],kind,json.dumps(payload),time.time()))
        team.note(conn,player_id,"session",{"name":current["name"],"track":track,"kind":kind,"car":current["car_id"]})
        conn.execute("UPDATE driver SET budget=budget-?,runs=runs+1 WHERE player_id=?",(cost,player_id))
        team.spend_energy(conn,current,current["pilot_id"],energy)
        if meta:
            for m in mine:
                if m["pilot_id"] and m["pilot_id"]!=current["pilot_id"]:team.spend_energy(conn,current,m["pilot_id"],training_rules.driving_energy(meta['energy_base'],m['pilot']['skills']['fitness']))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback();return None,"busy"
    finally:
        conn.close()
    return payload,None


def charge_session_pit(player_id: str, token: str, compound=None, fuel=0, set_id=None, swap=None, car=None):
    """Buy tyres and additional fuel and fit spare parts from the warehouse atomically, never refuel during a race.
    `swap` maps a part to the unit of the team's warehouse that goes on the car. Returns False, True, or (when parts
    were fitted) what the car is now: {"swap": {part: {unit, wear, design}}, "mods", "car_mods"}."""
    swap=swap or {}
    if not isinstance(swap,dict) or not all(k in PARTS and isinstance(v,str) for k,v in swap.items()):return False
    if compound not in (None,'keep') and compound not in TYRE_COST:return False
    if set_id is not None and not isinstance(set_id,str):return False
    if isinstance(fuel,bool):return False
    try:fuel=float(fuel)
    except (TypeError,ValueError,OverflowError):return False
    if not math.isfinite(fuel) or not 0<=fuel<=110:return False
    cost=(0 if set_id else TYRE_COST.get(compound,0))+math.ceil(fuel*FUEL_COST)
    if cost<=0 and not set_id and not swap:return False
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row=conn.execute("SELECT payload,pilot_id,kind FROM career_session WHERE id=? AND player_id=? AND status=0",(token,player_id)).fetchone()
        d=conn.execute("SELECT budget,pilot_id FROM driver WHERE player_id=?",(player_id,)).fetchone()
        if not row or not d or row['kind']=='d5_race' or row['pilot_id']!=d['pilot_id'] or d['budget']<cost:return False
        payload=json.loads(row['payload'])
        # the two cars of a weekend session have their own tyres and parts: `car` names the one that is being served
        other=bool(car and payload.get('other') and car==payload['other']['key'])
        target=payload['other'] if other else payload
        if (row['kind'].startswith('d5_') or payload.get('stocked')) and compound not in (None,'keep') and not set_id:return False
        if set_id:
            # a weekend allocation: the set must be unused in this session, not worn out, and of the compound claimed
            sets={t['id']:t for t in target.get('tyres',[])}
            t=sets.get(set_id)
            if not t or t['compound']!=compound or max(t['wear'])>=.98 or set_id==target.get('tyre_set',{}).get('id') or set_id in target.get('mounted',[]):return False
            target.setdefault('mounted',[]).append(set_id)
        fitted_now=None
        if swap:
            whole=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
            fitted_before=dict(whole['fitted'])
            if other:
                slot=next((e for e in _entries(conn,whole) if e['key']==car),None)
                if not slot:return False
                fitted_before=dict(team.slot_view(whole,slot).get('fitted') or {})
            done=payload.setdefault('swaps',[])
            taken={s['unit'] for s in done}
            if not _spare_units(whole['warehouse'],swap,taken):return False
            units={u['id']:u for u in whole['warehouse']['parts']}
            for s in done:
                if s.get('car')==(car if other else None):fitted_before[s['part']]=s['design']
            fitted_now=dict(fitted_before)
            for part,uid in swap.items():
                fitted_now[part]=units[uid]['design']
                done.append(dict(car=car if other else None,part=part,unit=uid,design=units[uid]['design'],wear=units[uid]['wear']))
            stats={p:parts_lab.design_of(whole['lab'],p,fitted_now.get(p,parts_lab.stock_id(p)))['stats'] for p in PARTS}
            mods=parts_lab.car_mods(stats)
            target['car_mods']=mods;target['mods']=mods['sim']
            fitted_now={'swap':{p:{'unit':u,'wear':units[u]['wear'],'design':units[u]['design']} for p,u in swap.items()},'mods':mods['sim'],'car_mods':mods}
        payload['pit_cost']+=cost
        payload['fuel_purchased']=payload.get('fuel_purchased',0)+fuel
        team.note(conn,player_id,"pit")
        conn.execute("UPDATE driver SET budget=budget-? WHERE player_id=?",(cost,player_id))
        conn.execute("UPDATE career_session SET payload=? WHERE id=?",(json.dumps(payload),token));conn.commit()
        return fitted_now or True
    finally:conn.close()


def evaluate_qualification(rows: list, duration: float, dnf=None, cheat=False) -> dict:
    timed=[l for l in rows if not l["out"]]
    clean=[l for l in timed if l["valid"] and not l["pit"] and not l["pen"]]
    fastest=sorted(l["time"] for l in clean)[:3]
    avg=sum(fastest)/3 if len(fastest)==3 else None
    consistency=(max(fastest)-min(fastest))/avg if avg else None
    ratio=len(clean)/max(1,len(timed))
    complete=not dnf and not cheat and duration>=QUALIFY_SECONDS
    medal=None
    if complete and avg:
        for tier,criteria in QUALIFY_CRITERIA.items():
            if avg<=QUALIFY_TARGETS[tier] and ratio>=criteria["ratio"] and consistency<=criteria["spread"]:medal=tier
    points=round(1000*(.6*min(1,57/avg)+.25*min(1,len(clean)/9)+.15*max(0,1-consistency/.08))) if medal else 0
    return {"medal":medal,"average":round(avg,3) if avg else None,"consistency":round(consistency*100,2) if consistency is not None else None,
            "clean_laps":len(clean),"timed_laps":len(timed),"reward":QUALIFY_PRIZES.get(medal,0),"points":points,"complete":complete}


def settle_session(player_id: str, token: str, msg: dict):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        session=conn.execute("SELECT * FROM career_session WHERE id=? AND player_id=? AND status=0",(token,player_id)).fetchone()
        if not session:return None
        run=json.loads(session["payload"])
        d=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
        if d["pilot_id"]!=session["pilot_id"] or (run.get("car_id") and d["car_id"]!=run["car_id"]):return None
        if run.get('weekend',{}).get('phase')=='race':
            commands=msg.get('race_commands') if isinstance(msg.get('race_commands'),list) else []
            commands=commands[:30]
            # Only paid tyre choices acknowledged by the server are replayed.
            paid=run.get('race_commands',[])
            if commands!=paid:return None
            result=race_engine.simulate(run['race_config'],paid)
            run['race_result']=result
            weekend_result=season.settle(conn,d,run,[],None,False,specialists.regen(conn,player_id))
            out=_settle_race(conn,player_id,token,session,run,d,msg,result,weekend_result)
        elif run.get('other') and run.get('weekend'):
            out=_settle_pair(conn,player_id,token,session,run,d,msg)
        else:
            out=_settle_car(conn,player_id,token,session["started"],run,d,msg)
        if out is None:return None
        conn.execute("UPDATE career_session SET status=1 WHERE id=?",(token,));conn.commit()
        return out
    finally:
        conn.close()


def _settle_pair(conn,player_id,token,session,run,d,msg):
    """A practice or qualifying with both cars: each car's laps settle on its own, the weekend learns both."""
    o=run['other'];om=msg.get('other')
    if not isinstance(om,dict):return None
    lead_run=dict(run,cost=run['cost']//2)
    first=_settle_car(conn,player_id,token,session["started"],lead_run,d,msg)
    if first is None:return None
    d1=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
    team.switch(conn,d1,o['car_id'],o['pilot_id'])
    d2=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
    orun=dict(run,setup=o['setup'],compound=o['compound'],tyre_set=o['tyre_set'],tyres=o['tyres'],mounted=o['mounted'],car_mods=o['car_mods'],cost=run['cost']-run['cost']//2,pit_cost=0,
              parts=o['parts'],skills=o['skills'],weekend=dict(run['weekend'],key=o['key'],tyre_set=o['tyre_set']),car_id=o['car_id'],pilot_id=o['pilot_id'])
    second=_settle_car(conn,player_id,token,session["started"],orun,d2,om,record_token=token+':2',key=o['key'])
    if second is None:return None
    d3=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
    team.switch(conn,d3,run['car_id'],run['pilot_id'])
    keep=('key','run_id','laps','best','gains','wear','damage','dnf','failed','reward','cost','refund','sponsor_bonus')
    first['other']={f:second.get(f) for f in keep};first['other']['key']=o['key'];first['other']['name']=o['name']
    first['weekend']=second['weekend'] or first['weekend']
    first['cost']=first['cost']+second['cost']
    return first


def _settle_race(conn,player_id,token,session,run,d,msg,result,weekend_result):
    """A race settles both cars of the team: each is paid, worn and taught by its own result."""
    mine=run['weekend']['mine'];lead=d['car_id']
    first_entry=next(m for m in mine if m['car_id']==lead)
    first=_settle_race_car(conn,player_id,token,session,run,d,msg,result,weekend_result,first_entry,token)
    if first is None:return None
    outs={first_entry['key']:first}
    for other in [m for m in mine if m['car_id']!=lead][:1]:
        # the second car is opened for a moment, so that what it earned and wore goes to its own records
        d1=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
        team.switch(conn,d1,other['car_id'],other['pilot_id'])
        d2=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
        second=_settle_race_car(conn,player_id,token,session,run,d2,msg,result,weekend_result,other,token+':2')
        if second is None:return None
        outs[other['key']]=second
        d3=_row(conn.execute("SELECT * FROM driver WHERE player_id=?",(player_id,)).fetchone())
        team.switch(conn,d3,lead,first_entry['pilot_id'])
    first=dict(first,cars={k:{f:v.get(f) for f in ('key','reward','wear','damage','gains','dnf','position','car_points','best','sponsor_bonus','refund','cost')} for k,v in outs.items()},weekend=weekend_result,reward=sum(o['reward'] for o in outs.values()),
               sponsor_bonus=sum(o['sponsor_bonus'] for o in outs.values()),hosting_income=sum(o['hosting_income'] for o in outs.values()),
               cost=sum(o['cost'] for o in outs.values()),refund=sum(o['refund'] for o in outs.values()))
    return first


def _settle_race_car(conn,player_id,token,session,run,d,msg,result,weekend_result,entry,record_token):
    key=entry['key']
    own=next(r for r in result['classification'] if r['id']==key)
    car_commands=[c for c in run.get('race_commands',[]) if (c.get('car') or 'player')==key]
    setup=dict(run.get('entry_setups',{}).get(key) or run['setup'])
    per_car=dict(run,setup=setup,cost=run['cost']//2,pit_cost=sum(PARTS['frontWing']['new'] for c in car_commands if c.get('wing')),
                 compound=run.get('entries',{}).get(key,{}).get('compound',run['compound']),
                 race_result=dict(result,wing_replacements=result['wing_replacements'].get(key,[]),service_stops=result['service_stops'].get(key,[]),contact_damage=(result.get('contact_damage') or {}).get(key,0),laps=result['laps_by'].get(key,[])))
    m={**msg,'laps':result['laps_by'].get(key,[]),'dnf':own['dnf'],'duration':result['duration'],'final_setup':setup,
       'pits':[{} for _ in range(own['stops'])],'impact':50 if own['dnf']=='crash' else 0,'failed':None,'bottoming':0,'spins':0}
    car=weekend_result['cars'][key]
    out=_settle_car(conn,player_id,token,session["started"],per_car,d,m,weekend_result=weekend_result,car_result=car,record_token=record_token,key=key)
    if out is not None:out['position']=car['position'];out['car_points']=car['points'];out['key']=key
    return out


def _settle_car(conn,player_id,token,started,run,d,msg,weekend_result=None,car_result=None,record_token=None,key=None):
    """Everything one car's result changes: wear, money, skills, records. `car_result` is its share of a race."""
    kind=run["kind"]
    raw=msg.get("laps") if isinstance(msg.get("laps"),list) else []
    trk=run.get("track") or TRACK
    rows=[];cheat=False;water=run["forecast"][run["hour"]]["water"];floor=min_lap(water,(run.get("ref") or {}).get("floor"))
    for i,l in enumerate(raw[:run["laps"]+1]):
        if not isinstance(l,dict):continue
        tm=_f(l.get("time"),0,1200);pen=_f(l.get("pen"),0,60);out=(i==0 or bool(l.get("out"))) if kind!="d5_race" else False
        sectors=[round(_f(x,0,500),3) for x in (l.get("sectors") if isinstance(l.get("sectors"),list) else [])[:3]]
        valid=bool(l.get("valid")) and not out and not l.get("invalidated") and not l.get("pit") and not pen
        if len(sectors)!=3 or min(sectors or [0])<=0 or abs(sum(sectors)-tm)>.08:valid=False
        if not out and tm<floor:valid=False;cheat=cheat or (tm<floor*.9 and not l.get("pit") and not l.get("invalidated"))
        rows.append(dict(n=len(rows),time=round(tm,3),valid=valid,out=out,pen=pen,pit=bool(l.get("pit")),sectors=sectors,points=0))
    elapsed=time.time()-started;total=sum(l["time"] for l in rows)
    if not run.get("weekend") and total/90>elapsed+2:cheat=True
    dnf=msg.get("dnf") if msg.get("dnf") in ("crash","failure","recovery","fuel") else None
    duration=_f(msg.get("duration"),0,4000)
    if (kind=="qualifying" or run.get("duration")) and not dnf:
        # Finish the lap that was in progress at expiry; no extra flying laps.
        gap=duration-total
        limit=run.get('duration') or QUALIFY_SECONDS
        if not rows or duration<limit or not -1<=gap<=35 or duration-rows[-1]["time"]>limit+1:cheat=True
    if cheat:rows=[dict(l,valid=False) for l in rows]
    good=[l for l in rows if l["valid"]]
    best=min(good,key=lambda l:l["time"]) if good else None
    q=evaluate_qualification(rows,duration,dnf,cheat) if kind=="qualifying" else None
    if run.get('weekend'):
        if cheat:return None
        if run['weekend']['phase']!='race':
            season.apply_tyres(conn,d,run,msg,rows)
            weekend_result=season.settle(conn,d,run,rows,dnf,cheat,specialists.regen(conn,player_id))
    if run.get('stocked'):apply_warehouse_wear(conn,d,run,msg)
    scored=car_result if car_result is not None else weekend_result
    reward=scored['prize'] if scored else q["reward"] if q else 0;points=scored["points"] if scored else q["points"] if q else 0
    # Apply wear, rewards, learning, the record and the license atomically.
    length=((run.get('race_config') or {}).get('profile') or {}).get('length') or (track_of(d,trk) or {}).get('length') or 3000
    km_scale=length/1000.0/WEAR_KM
    driven=(len(rows)+(.5 if dnf else 0))*km_scale
    setup=run["setup"];parts=dict(d["parts"]);wear={}
    stress={"engine":_MODE_WEAR[int(setup["engine"])]*(1+max(0,setup["gearing"])*.03),
            "gearbox":1+abs(setup["gearing"])*.04,"brakes":1+abs(setup["brakeBias"]-58)*.02,
            "suspension":1+max(0,30-setup["rideF"])*.03+max(0,setup["springF"]-300)*.002,
            "floor":1+min(5,_f(msg.get("bottoming"),0,600))*.35+max(0,28-setup["rideF"])*.04}
    # Parts swapped for spares at the box: each one wears to the moment it came off and goes to the warehouse with that wear;
    # the spare wears from there to the end. The units of the warehouse are the team's, not a car's.
    # the warehouse as it is now: apply_warehouse_wear has just stored the wear of the tyres this run used
    fitted=dict(d["fitted"]);warehouse=_load_warehouse(conn.execute("SELECT warehouse FROM driver WHERE player_id=?",(player_id,)).fetchone()[0]);events=[]
    if kind=='d5_race':
        total=max(1e-9,length*max(1,run["laps"]))
        for stop in (run.get("race_result") or {}).get("service_stops") or []:
            for part,uid in (stop.get("swap") or {}).items():
                events.append(dict(part=part,unit=uid,frac=min(1.0,max(0.0,_f(stop.get("p"),0,1e9)/total)),dmg=0.0))
    else:
        log={x.get("unit"):x for x in (msg.get("swap_log") if isinstance(msg.get("swap_log"),list) else []) if isinstance(x,dict)}
        for s in (run.get("swaps") or []):
            if s.get("car")!=key:continue
            x=log.get(s["unit"],{})
            events.append(dict(part=s["part"],unit=s["unit"],frac=min(1.0,max(0.0,_f(x.get("at"),0,1000)/max(1,len(rows)))),dmg=_f(x.get("dmg"),0,1)))
    for k,info in PARTS.items():
        rate=info["rate"]*stress.get(k,1)*(1.12 if q else 1)*run.get("car_mods",{}).get("wear",{}).get(k,1)
        w=parts[k];before=w;done=0.0;design=fitted.get(k)
        for e in sorted((e for e in events if e["part"]==k),key=lambda e:e["frac"]):
            unit=next((u for u in warehouse["parts"] if u["id"]==e["unit"] and u["part"]==k),None)
            if not unit:continue
            w=min(1,w+rate*driven*(e["frac"]-done)+e["dmg"])
            if w<.999 and len(warehouse["parts"])<parts_lab.MAX_STORED_PARTS:
                warehouse["seq"]+=1
                warehouse["parts"].append({"id":f"u{warehouse['seq']}","part":k,"design":design or parts_lab.stock_id(k),"wear":round(w,4)})
            warehouse["parts"]=[u for u in warehouse["parts"] if u["id"]!=unit["id"]]
            w=unit["wear"];design=unit["design"];done=e["frac"]
        parts[k]=min(1,w+rate*driven*(1-done))
        if design is not None:fitted[k]=design
        wear[k]=round(parts[k]-before,4)
    failed=msg.get("failed") if msg.get("failed") in PARTS else None
    if failed:parts[failed]=1 if failed in ("engine","gearbox") else max(.9,parts[failed]);wear[failed]=round(parts[failed]-d["parts"][failed],4)
    damage={}
    reported=msg.get("damage_parts") if kind!="d5_race" and isinstance(msg.get("damage_parts"),dict) else None
    if reported is not None:
        # the damage the crashes left on each part that the box did not repair
        for k in ("suspension","floor","frontWing","rearWing","brakes","engine"):
            v=_f(reported.get(k),0,1)
            if v>0:before=parts[k];parts[k]=min(1,before+v*run.get("car_mods",{}).get("crash",{}).get(k,1));damage[k]=round(parts[k]-before,3)
    if kind=='d5_race':
        # what the touches of the race did to the front wing, apart from the wear that it had by driving
        hit=_f((run.get('race_result') or {}).get('contact_damage'),0,2)
        if hit>0:before=parts['frontWing'];parts['frontWing']=min(1,before+hit);damage['frontWing']=round(parts['frontWing']-before,3)
    if reported is not None:pass
    elif dnf=="crash":
        impact=_f(msg.get("impact"),0,120);factor=min(1,max(.25,(impact-25)/40))
        for k,v in {"suspension":.35,"floor":.4,"frontWing":.7,"rearWing":.35,"brakes":.1,"engine":.08}.items():
            before=parts[k];parts[k]=min(1,before+v*factor*run.get("car_mods",{}).get("crash",{}).get(k,1));damage[k]=round(parts[k]-before,3)
    gains={};sk=dict(d["skills"])      # driving does not change skills: they are trained only in the training games
    licences=list(d["licences"]);licence_new=None;hosting_income=0
    if kind=='d5_race':
        if trk in tracks.official() and trk not in licences:licences.append(trk);licence_new=trk
        if trk==tracks.OWN and d["own"] and tracks.hosting(d["own"])["ok"] and record_token==token:hosting_income=tracks.race_income(d["own"])["total"]
    success=bool(q and q["medal"]);silver=bool(success and q["medal"] in ("silver","gold"))
    count=d["qualifications"]+int(success);silvers=d["silver_sessions"]+int(silver)
    licensed=d["license_unlocked"] or count>=3 and silvers>=1
    tier=max(d["sponsor_tier"], {"bronze":1,"silver":2,"gold":3}.get(q["medal"] if q else None,0))
    sponsor_car = car_result
    if kind == 'd5_race' and weekend_result:
        entries = list(weekend_result.get('cars', {}).values())
        finishers = [c for c in entries if not c.get('dnf')]
        sponsor_car = dict(min(finishers, key=lambda c:c['position'])) if finishers else dict(dnf=True, points=0, position=99)
        sponsor_car['points'] = sum(c.get('points',0) for c in finishers)
    bonus=sponsors.result(conn,d,token,kind,sponsor_car,q.get('medal') if q else None,cheat,time.time())
    refund=LAP_COST*max(0,run["laps"]+1-len(rows)) if q or run.get("duration") else 0
    cost=run["cost"]+run["pit_cost"]-refund
    for category,amount in [('prize',reward),('sponsor_bonus',bonus),('refund',refund),('hosting',hosting_income)]:
        if amount:
            team.note(conn,player_id,category,{'session':token,'car':d['car_id'],'pilot':d['pilot_id']})
            conn.execute('UPDATE driver SET budget=budget+? WHERE player_id=?',(amount,player_id))
    conn.execute("UPDATE driver SET parts=?,fitted=?,warehouse=?,skills=?,qualifications=?,silver_sessions=?,license_unlocked=?,sponsor_tier=?,sponsor_bonus_at=?,licences=? WHERE player_id=?",
                 (json.dumps(parts),json.dumps(fitted),json.dumps(warehouse),json.dumps(sk),count,silvers,int(licensed),tier,time.time() if bonus else d["sponsor_bonus_at"],json.dumps(licences),player_id))
    if run.get('weekend',{}).get('phase','').startswith('fp'):
        final_setup=clean_setup(msg.get('final_setup') or setup)
        setups=dict(d['setups']);setups[trk]=final_setup
        conn.execute('UPDATE driver SET setup=?,setups=? WHERE player_id=?',(json.dumps(final_setup),json.dumps(setups),player_id))
    cond=run["forecast"][run["hour"]]
    race_own=(car_result if car_result is not None else None) if weekend_result and weekend_result['phase']=='race' else None
    rid=record_run(player_id,tkey(player_id,trk),kind,run["compound"],run["hour"],cond,len(rows),rows,best["time"] if best else None,
                   points,race_own["time"] if race_own else None,race_own["position"] if race_own else None,reward,cost,dnf,len(msg["pits"]) if isinstance(msg.get("pits"),list) else 0,setup,clean_setup(msg.get("final_setup") or setup),
                   _conn=conn,qualification=q,pilot_id=d["pilot_id"],session_token=record_token or token,who=d["name"],
                   profile=profile_of(run.get("car_id") or d.get("car_id"),d["pilot_id"],(run.get("car_mods") or {}).get("sim"),run.get("skills") or d.get("skills")))
    if weekend_result:conn.execute("UPDATE runs SET weekend=? WHERE id=?",(json.dumps(weekend_result),rid))
    return dict(run_id=rid,kind=kind,weekend=weekend_result,laps=rows,best=best,qualification=q,reward=reward,sponsor_bonus=bonus,refund=refund,
                cost=cost,wear=wear,damage=damage,gains=gains,dnf=dnf,failed=failed,cheat=cheat,water=water,track=trk,licence_new=licence_new,hosting_income=hosting_income,
                air=cond["air"],track_temp=cond["track"],spins=int(_f(msg.get("spins"),0,100)),pits=len(msg["pits"]) if isinstance(msg.get("pits"),list) else 0)


CAREER_TABLES = ("runs", "lap_log", "laps", "training", "career_session", "team_car", "team_pilot", "team_offer", "finance_ledger", "crew_member", "crew_offer", "rival_field", "sponsor_contract", "sponsor_event", "training_hall_state", "staff_member", "staff_offer", "staff_retired")
ARCHIVE_KEEP = 7 * 86400


def _career_snapshot(conn, player_id: str) -> dict:
    snap = {"driver": dict(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())}
    previous = conn.execute("SELECT state FROM division_season WHERE player_id=?", (player_id,)).fetchone()
    if previous:
        snap["division_season"] = json.loads(previous[0])
    for table in CAREER_TABLES:
        snap[table] = [dict(r) for r in conn.execute(f"SELECT * FROM {table} WHERE player_id=?", (player_id,))]
    return snap


def _career_wipe(conn, player_id: str):
    conn.execute("DELETE FROM division_season WHERE player_id=?", (player_id,))
    for table in CAREER_TABLES + ("driver",):
        conn.execute(f"DELETE FROM {table} WHERE player_id=?", (player_id,))


def _career_load(conn, player_id: str, snap: dict):
    if snap.get("division_season") is not None:
        conn.execute("INSERT INTO division_season (player_id,state) VALUES (?,?)", (player_id, json.dumps(snap["division_season"])))
    for table in CAREER_TABLES + ("driver",):
        rows = snap.get(table) or []
        if table == "driver":
            rows = [snap["driver"]]
        for row in rows:
            names = list(row)
            conn.execute(f"INSERT INTO {table} ({','.join(names)}) VALUES ({','.join('?' * len(names))})", [row[n] for n in names])


def _expire_archives(conn, now=None):
    conn.execute("DELETE FROM career_archive WHERE archived_at<?", ((now or time.time()) - ARCHIVE_KEEP,))


def previous_career(player_id: str):
    """When the previous career was set aside, or None once the week for taking it back has passed."""
    conn = _connect()
    try:
        _expire_archives(conn)
        conn.commit()
        row = conn.execute("SELECT MAX(archived_at) FROM career_archive WHERE player_id=?", (player_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def reset_career(player_id: str, expected_started):
    """Start over only after an explicit request for the current career.

    The old career is kept privately for seven days and only the latest one
    is kept, so it can be taken back after a mistake. A stale request cannot
    erase a newer career or settle a previous session.
    """
    try:
        expected_started = float(expected_started)
    except (TypeError, ValueError):
        return "session"
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        old = conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not old or old["created"] != expected_started:
            return "session"
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return "busy"
        now = time.time()
        _expire_archives(conn, now)
        archive = _career_snapshot(conn, player_id)
        conn.execute("DELETE FROM career_archive WHERE player_id=?", (player_id,))
        conn.execute("INSERT INTO career_archive VALUES (?,?,?,?)", (uuid.uuid4().hex, player_id, json.dumps(archive), now))
        _career_wipe(conn, player_id)
        conn.execute(
            "INSERT INTO driver (player_id,name,age,skills,potential,budget,energy,energy_ts,setup,sponsor_ts,created,has_car,has_driver)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (player_id, "Driver", 17, json.dumps(START_SKILLS), json.dumps(POTENTIAL), START_BUDGET,
             ENERGY_MAX, now, json.dumps(DEFAULT_SETUP), now, now, 0, 0))
        _starter_cars(conn, player_id, now)
        conn.commit()
        return None
    finally:
        conn.close()


def restore_career(player_id: str, expected_started):
    """Take back the career set aside within the last week; the current one is set aside in its place."""
    try:
        expected_started = float(expected_started)
    except (TypeError, ValueError):
        return "session"
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        now = time.time()
        _expire_archives(conn, now)
        cur = conn.execute("SELECT created FROM driver WHERE player_id=?", (player_id,)).fetchone()
        if not cur or cur["created"] != expected_started:
            return "session"
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return "busy"
        row = conn.execute("SELECT id,profile FROM career_archive WHERE player_id=? ORDER BY archived_at DESC LIMIT 1", (player_id,)).fetchone()
        if not row:
            return "no_archive"
        snap = json.loads(row["profile"])
        current = _career_snapshot(conn, player_id)
        _career_wipe(conn, player_id)
        _career_load(conn, player_id, snap)
        conn.execute("DELETE FROM career_archive WHERE player_id=?", (player_id,))
        conn.execute("INSERT INTO career_archive VALUES (?,?,?,?)", (uuid.uuid4().hex, player_id, json.dumps(current), now))
        conn.commit()
        return None
    finally:
        conn.close()


def circuit_place(d: dict, track: str):
    t = track_of(d, track)
    return (t["lat"], t["lon"]) if t and t.get("lat") is not None else None


def weather_of(d: dict, track: str) -> dict:
    """Today's weather at a circuit: the real forecast for its place, or the simulated day when the service is out."""
    place = circuit_place(d, track)
    if place:
        conn = _connect()
        try:
            got = weather.day(conn, place[0], place[1])
        finally:
            conn.close()
        if got:
            table, hour, date, frac = got
            return {"forecast": weather.public_hours(table), "table": table, "hour": max(HOURS[0], min(HOURS[-1], hour)), "now": hour, "now_frac": frac, "live": True, "date": date}
    return {"forecast": forecast(today_ord()), "table": None, "hour": default_hour(), "now": time.localtime().tm_hour, "now_frac": round(time.localtime().tm_hour + time.localtime().tm_min / 60.0, 3), "live": False, "date": None}


def division_weather(d: dict):
    """The weather of the circuit of the weekend that is next, for the division's forecast and sessions."""
    conn = _connect()
    try:
        s = season.ensure(conn, d)
        conn.commit()
        tid = s["calendar"][s["round"] - 1].get("track") if s.get("entered") and s["round"] <= 20 else None
    finally:
        conn.close()
    if not tid or not track_of(d, tid):
        return None
    w = weather_of(d, tid)
    return w if w["live"] else None


def public_division(d):
    real = division_weather(d)
    conn=_connect()
    try:
        out=season.public(conn,d,real,lambda tid:tracks.race_laps(track_of(d,tid) or {'length':3000}),mine=_entries(conn,d),key=team.slot_of(conn,d));conn.commit();return out
    finally:conn.close()


# ── The own circuit ─────────────────────────────────────────────────────────

def _coord(v, lo, hi):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return round(v, 4) if math.isfinite(v) and lo <= v <= hi else None


def public_own(own) -> dict | None:
    if not own:
        return None
    host = tracks.hosting(own)
    out = {k: own[k] for k in ("id", "name", "lat", "lon", "points", "width", "runoff", "sectors", "start", "length", "corners", "cost",
                               "seats", "seats_cost", "ref", "ctrl", "grandstands") if k in own}
    out.update(venue_bounds=grandstands.bounds(own),host=host, value=tracks.value(own), upkeep=tracks.maintenance_per_day(own))
    return out


def own_quote(d: dict, ctrl, width, seats) -> dict:
    q = tracks.quote(ctrl, width, seats)
    demolition = int(round(tracks.value(d["own"]) * tracks.DEMOLITION / 1000.0)) * 1000 if d.get("own") else 0
    q["demolition"] = demolition
    q["total"] = q["cost"] + q["seats_cost"] + demolition
    q["budget"] = d["budget"]
    return q


def own_verify(d: dict, ctrl, width) -> dict:
    """The geometric check plus the test drive, with the point where the car left the track."""
    q = tracks.quote(ctrl, width, {})
    if not q["ok"]:
        return {"ok": False, "error": q["error"]}
    return tracks.drive_check(q)


def own_build(player_id: str, ctrl, width, seats, name, lat, lon):
    """Build (or rebuild) the own circuit. Returns an error code or None."""
    d = get_driver(player_id)
    lat, lon = _coord(lat, -90, 90), _coord(lon, -180, 180)
    if lat is None or lon is None:
        return "location"
    if any(tracks.clean_seats(seats).values()): return "stand_invalid"
    q = own_quote(d, ctrl, width, {})
    if not q["ok"]:
        return q["error"]
    if d["budget"] < q["total"]:
        return "budget"
    own, error = tracks.make_own(ctrl, width, seats, name, lat, lon)    # runs the simulator: a few seconds, no money taken yet
    if error:
        return error
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _row(conn.execute("SELECT * FROM driver WHERE player_id=?", (player_id,)).fetchone())
        if conn.execute("SELECT 1 FROM career_session WHERE player_id=? AND status=0", (player_id,)).fetchone():
            return "busy"
        _settle_track_upkeep(conn,row)
        demolition = int(round(tracks.value(row["own"]) * tracks.DEMOLITION / 1000.0)) * 1000 if row.get("own") else 0
        total = own["cost"] + own["seats_cost"] + demolition
        if row["budget"] < total:
            return "budget"
        key = tkey(player_id, tracks.OWN)
        for table in ("lap_log", "laps"):
            try:
                conn.execute(f"DELETE FROM {table} WHERE player_id=? AND track=?", (player_id, key))
            except sqlite3.Error:
                pass
        setups = dict(row["setups"])
        setups.pop(tracks.OWN, None)
        team.note(conn,player_id,"track_build")
        conn.execute("UPDATE driver SET budget=budget-?, own=?, setups=?, maint_at=? WHERE player_id=?",
                     (total, json.dumps(own), json.dumps(setups), time.time(), player_id))
        conn.commit()
    finally:
        conn.close()
    return None


def stands_quote(d, raw):
    own = d.get('own')
    if not own: return {'ok':False,'error':'no_track'}
    layout,error = grandstands.validate(raw,own)
    if error: return {'ok':False,'error':error}
    seats=grandstands.totals(layout)
    value=tracks.seats_cost(seats)
    if value>2**53-1: return {'ok':False,'error':'stand_invalid'}
    projected=dict(own,grandstands=layout,seats=seats,seats_cost=value)
    price=grandstands.invoice(own,layout,tracks.SEAT_COST)
    return dict(ok=True,error=None,grandstands=layout,seats=seats,price=price,
                upkeep=tracks.maintenance_per_day(projected),host=tracks.hosting(projected),budget=d['budget'])


def _settle_track_upkeep(conn,row):
    now=time.time()
    if row.get('own') and row.get('maint_at'):
        due=int(tracks.maintenance_per_day(row['own'])*max(0,now-row['maint_at'])/86400)
        if due:
            team.note(conn,row['player_id'],'track_maintenance')
            conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?',(due,row['player_id']))
            row['budget']-=due
    conn.execute('UPDATE driver SET maint_at=? WHERE player_id=?',(now,row['player_id']))


def own_stands(player_id: str, layout):
    """Pay for added capacity and save validated physical placements atomically. Demolition has no refund."""
    get_driver(player_id)
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = _load_for_update(conn,player_id)
        if _busy(conn,player_id): return 'busy'
        q=stands_quote(row,layout)
        if not q['ok']: return q['error']
        _settle_track_upkeep(conn,row)
        if row['budget']<q['price']: return 'budget'
        own=dict(row['own'],grandstands=q['grandstands'],seats=q['seats'],seats_cost=tracks.seats_cost(q['seats']))
        team.note(conn,player_id,'grandstands')
        conn.execute('UPDATE driver SET budget=budget-?,own=? WHERE player_id=?',
                     (q['price'],json.dumps(own),player_id))
        conn.commit()
        return None
    finally: conn.close()


def circuit_menu(d: dict) -> list:
    """Every circuit the garage can show: the own one and the official ones, with what going there costs."""
    out = []
    own = d.get("own")
    if own:
        out.append({"id": tracks.OWN, "own": True, "name": own["name"], "lat": own["lat"], "lon": own["lon"], "length": own["length"],
                    "usable": True, "licensed": True, "km": 0, "practice_cost": 0, "race_trip": 0})
    for tid, t in sorted(tracks.official().items()):
        km = trip_km(d, tid)
        out.append({"id": tid, "own": False, "name": t["name"], "lat": t["lat"], "lon": t["lon"], "length": t["length"],
                    "usable": tid in d["licences"], "licensed": tid in d["licences"], "km": round(km),
                    "practice_cost": practice_extra(d, tid), "race_trip": weekend_trip_fee(d, tid) if home_of(d) else tracks.OFFICIAL_RENT_RACE})
    return out


def calendar_circuits(d: dict) -> list:
    """Draw venues and their order once when entering a season; include one eligible home round."""
    rnd = random.SystemRandom()
    home = bool(d.get("own") and tracks.hosting(d["own"])["ok"])
    cal = rnd.sample(sorted(tracks.official()), 19 if home else 20)
    if home: cal.append(tracks.OWN)
    rnd.shuffle(cal)
    return cal


def enter_division(player_id):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        d=_row(conn.execute('SELECT * FROM driver WHERE player_id=?',(player_id,)).fetchone())
        if conn.execute('SELECT 1 FROM career_session WHERE player_id=? AND status=0',(player_id,)).fetchone():return 'busy'
        error=season.enter(conn,d,_entries(conn,d),calendar_circuits(d))
        if not error:conn.commit()
        return error
    finally:conn.close()


def _spare_units(warehouse: dict, wanted: dict, taken: set):
    """The units of the team's warehouse a call names ({part: unit id}): each must exist for that part, be usable and not be named twice."""
    units={u['id']:u for u in warehouse['parts']}
    for part,uid in wanted.items():
        u=units.get(uid)
        if part not in PARTS or not isinstance(uid,str) or not u or u['part']!=part or u['wear']>=.98 or uid in taken:return None
        taken=taken|{uid}
    return True


def race_pit_command(player_id,token,at,compound,set_id=None,wing=False,car='player',wing_unit=None,service=None,pass_through=False):
    """A call to the pit made for one of the team's two cars. Each car has its own sets, its own calls and its own crew.
    `wing` is the quick stop with a spare front wing (`wing_unit`) next to the tyres; `service` is a long stop that swaps any parts
    ({part: unit id}) for spares of the team's warehouse. Parts are never bought on the spot."""
    if not isinstance(wing,bool) or not isinstance(pass_through,bool) or compound not in (None,*COMPOUNDS) or car not in season.KEYS:return False
    service=service or {}
    if not isinstance(service,dict) or len(service)>len(PARTS) or (wing and service) or (wing and not isinstance(wing_unit,str)) or (not wing and wing_unit is not None):return False
    if pass_through and (compound or set_id is not None or wing or service):return False
    if not compound and (set_id is not None or not (wing or service or pass_through)):return False
    try:stamp=float(at)
    except (TypeError,ValueError,OverflowError):return False
    if not math.isfinite(stamp) or not 0<=stamp<=RACE_MAX_TIME:return False
    stamp=round(stamp,1)
    conn=_connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT payload FROM career_session WHERE id=? AND player_id=? AND status=0',(token,player_id)).fetchone()
        if not row:return False
        payload=json.loads(row[0])
        if payload.get('kind')!='d5_race':return False
        entry=(payload.get('entries') or {}).get(car)
        if not entry:return False
        commands=payload.setdefault('race_commands',[])
        mine=[c for c in commands if (c.get('car') or 'player')==car]
        command=dict(t=stamp,compound=compound,set=set_id)
        if pass_through:command['pass']=True
        if wing:command['wing']=True;command['wing_unit']=wing_unit
        if service:command['service']=dict(service)
        if car!='player':command['car']=car
        if commands and command==commands[-1]:return True
        if stamp+.2<payload.get('progress',{}).get('t',0):return False
        if compound:
            tyre=next((x for x in entry.get('tyres',[]) if x['id']==set_id),None)
            if not tyre or tyre['compound']!=compound or max(tyre['wear'])>=.98 or set_id==entry['tyre_set']['id'] or any(c.get('set')==set_id for c in mine):return False
        if len(commands)>=30 or mine and stamp<mine[-1]['t']+20:return False
        cost=0
        driver=conn.execute('SELECT budget,pilot_id FROM driver WHERE player_id=?',(player_id,)).fetchone()
        if not driver or driver['pilot_id']!=payload['pilot_id'] or driver['budget']<cost:return False
        wanted=dict(service) if service else ({'frontWing':wing_unit} if wing else {})
        if wanted:
            warehouse=_row(conn.execute('SELECT * FROM driver WHERE player_id=?',(player_id,)).fetchone())['warehouse']
            taken={c.get('wing_unit') for c in commands}|{u for c in commands for u in (c.get('service') or {}).values()}
            if not _spare_units(warehouse,wanted,taken):return False
        commands.append(command);payload['pit_cost']+=cost
        checkpoint=max(stamp,payload.get('progress',{}).get('t',0))
        payload['progress']=dict(t=checkpoint,pbt=checkpoint,armed=False,inputs=[])
        team.note(conn,player_id,"pit")
        conn.execute('UPDATE driver SET budget=budget-? WHERE player_id=?',(cost,player_id))
        conn.execute('UPDATE career_session SET payload=? WHERE id=?',(json.dumps(payload),token));conn.commit()
        return True
    finally:conn.close()


def save_progress(player_id,token,progress):
    """Remember how far a running session got and what the player decided, so a reload can continue it."""
    if not isinstance(progress,dict):return False
    inputs=progress.get('inputs')
    if not isinstance(inputs,list) or len(inputs)>80:return False
    clean=[]
    for x in inputs:
        if not isinstance(x,dict) or x.get('k') not in ('pit','svc'):return False
        clean.append(x)
    try:t=float(progress.get('t'));pbt=float(progress.get('pbt'))
    except (TypeError,ValueError):return False
    if not (0<=t<=20000 and 0<=pbt<=t+1):return False
    entry={'t':t,'pbt':pbt,'armed':bool(progress.get('armed')),'pass':bool(progress.get('pass')),'inputs':clean}
    # the other car of a weekend session saves its own clock and decisions
    cars=progress.get('cars')
    if isinstance(cars,dict):
        saved={}
        for ck,cv in list(cars.items())[:2]:
            if not isinstance(cv,dict) or not isinstance(cv.get('inputs'),list) or len(cv['inputs'])>80 or any(not isinstance(x,dict) or x.get('k') not in ('pit','svc') for x in cv['inputs']):return False
            try:ct=float(cv.get('t'))
            except (TypeError,ValueError):return False
            if not 0<=ct<=20000:return False
            saved[str(ck)]={'t':ct,'armed':bool(cv.get('armed')),'pass':bool(cv.get('pass')),'inputs':cv['inputs']}
        entry['cars']=saved
    raw=json.dumps(entry)
    if len(raw)>60000:return False
    conn=_connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row=conn.execute("SELECT payload,kind FROM career_session WHERE id=? AND player_id=? AND status=0",(token,player_id)).fetchone()
        if not row:return False
        payload=json.loads(row['payload'])
        if row['kind']=='d5_race':
            # Race checkpoints never move backwards, including delayed packets
            # from an older tab. Commands are stored separately by the server.
            minimum=max([payload.get('progress',{}).get('t',0)]+[c['t'] for c in payload.get('race_commands',[])])
            if t<minimum or t>RACE_MAX_TIME:return False
            entry=dict(t=round(t,4),pbt=round(t,4),armed=False,inputs=[])
        payload['progress']=entry
        conn.execute("UPDATE career_session SET payload=? WHERE id=?",(json.dumps(payload),token));conn.commit()
        return True
    finally:conn.close()


def pending_session_payload(player_id):
    """Reopen the paid pending run after a page/backend reload, without a debit."""
    d=get_driver(player_id)
    conn=_connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT id,payload FROM career_session WHERE player_id=? AND status=0',(player_id,)).fetchone()
        if not row:return None
        payload=json.loads(row['payload'])
        if payload.get('pilot_id')!=d['pilot_id']:return None
        if payload['kind']=='d5_race' and payload['race_config'].get('traffic_version',0)<2:
            # Reconstruct the saved position with the original rules, then use
            # the revised traffic logic without changing the race before it.
            payload['race_config']['traffic_from']=payload.get('progress',{}).get('t',0)
            payload['race_config']['traffic_version']=2
            conn.execute('UPDATE career_session SET payload=? WHERE id=?',(json.dumps(payload),row['id']))
        if payload['kind']=='d5_race' and payload['race_config'].get('traffic_version',0)<3:
            state=season.ensure(conn,d);roster={r['id']:r for r in state['roster']}
            for entry in payload['race_config']['entries']:
                profile=d if entry['id']=='player' else roster.get(entry['id'],{})
                entry['character']=dict(profile.get('character') or season.driver_character(entry['id']))
                entry['racecraft']=(profile.get('skills',{}).get('cornering',50)+profile.get('skills',{}).get('reflexes',50)+profile.get('skills',{}).get('composure',50))/300
            payload['race_config']['character_from']=payload.get('progress',{}).get('t',0)
            payload['race_config']['traffic_version']=3
            conn.execute('UPDATE career_session SET payload=? WHERE id=?',(json.dumps(payload),row['id']))
        # Standalone tests are private track time, including sessions saved before this rule.
        if not payload.get('weekend') and 'timing_field' in payload:
            payload.pop('timing_field')
            conn.execute('UPDATE career_session SET payload=? WHERE id=?',(json.dumps(payload),row['id']))
        elif payload.get('weekend') and payload['kind']!='d5_race' and ('timing_field' not in payload or any('segments' not in r for r in payload['timing_field'])):
            payload['timing_field']=season.timing_field(payload['weekend'])
            conn.execute('UPDATE career_session SET payload=? WHERE id=?',(json.dumps(payload),row['id']))
        conn.commit();return payload
    finally:conn.close()


def sponsor_state(d):
    conn=_connect()
    try:return sponsors.state(conn,d)
    finally:conn.close()


def sign_sponsor(player_id, offer):
    get_driver(player_id)
    conn=_connect()
    try:
        conn.execute('BEGIN IMMEDIATE')
        d=_load_for_update(conn,player_id)
        error=sponsors.sign(conn,d,offer,time.time())
        if error:return error
        conn.commit()
        return None
    finally:conn.close()


def training_hall(player_id):
    conn=_connect()
    try:return training_rules.hall(conn,player_id,time.time())
    finally:conn.close()
