"""Racelandia - circuits.

Two kinds of circuit exist. The official ones are real circuits shipped in
public/tracks.json (Zandvoort from TUMFTM / OpenStreetMap, and the expanded
catalog from Tomislav Bacinger's MIT-licensed f1-circuits coordinates).
The own circuit is drawn by the player as
control points; this module turns it into a drivable closed centre line,
checks it, prices it and measures it with the same simulation code the browser
runs (track_ref.mjs), so the lap-time floor and the race model of every
circuit come from one source.
"""
import json
import math
import os
import subprocess
import tempfile

_DIR = os.path.dirname(os.path.realpath(__file__))
_FILE = os.path.join(_DIR, "public", "tracks.json")
_cache = {"mtime": 0.0, "data": {}}

OWN = "own"

# The perfect-driver lap (skill 100, standard setup, dry) on the 3150 m circuit the AI field was tuned on.
# Every circuit's lap points and cheat floor keep fixed ratios to its own measured lap, and the computer
# drivers' pace scales with the same ratio. AI_SCALE is how much slower than that perfect lap the field
# of Division 5 drives, as measured with the driver model in public/sim.js.
CALIBRATION_BEST = 55.3167
AI_SCALE = 1.10
FLOOR_RATIO, FAST_RATIO, SLOW_RATIO = 51.0 / 55.8167, 55.0 / 55.8167, 70.0 / 55.8167

# Travel money, per kilometre as the crow flies, charged to the team's budget.
RACE_TRAVEL_BASE, RACE_TRAVEL_KM = 25_000, 250       # the whole team, both cars' worth of equipment, crew and driver
PRACTICE_TRAVEL_BASE, PRACTICE_TRAVEL_KM = 8_000, 70  # the car, the driver and a small crew
OFFICIAL_RENT_PRACTICE, OFFICIAL_RENT_RACE = 25_000, 60_000

# A championship race is at least this far (the distance of a Formula 1 race); a circuit's lap count follows from it.
RACE_MIN_KM = 305.0

# Building the own circuit
WIDTHS = (10, 12, 14, 16)
MIN_LENGTH, MAX_LENGTH = 800.0, 9000.0
MIN_RADIUS = 16.0           # a tight hairpin; the test drive decides whether the car can really take it
MIN_CORNERS = 2
LAND_COST, PIT_COST = 120_000, 80_000
ASPHALT_PER_M2 = 28
CORNER_COST, TIGHT_CORNER_COST = 15_000, 10_000
SEAT_COST = {"seated": 400, "free": 60, "vip": 4_000}
SEAT_PRICE = {"seated": 90, "free": 35, "vip": 800}
DEMOLITION = 0.25           # share of the old circuit's value paid to tear it down
MAINTENANCE_DAY = 0.001     # of the circuit's value, per day
# What the own circuit must offer to be part of the championship calendar.
REQUIRE = {"length": 5000.0, "width": 12, "seated": 2000, "vip": 20}
ENTRY_FEE = 35_000          # paid to the host by each of the other teams

RADIUS_PRESET = None


def official():
    try:
        mt = os.path.getmtime(_FILE)
        if mt != _cache["mtime"]:
            with open(_FILE) as f:
                _cache["data"] = json.load(f)
            _cache["mtime"] = mt
    except (OSError, ValueError):
        pass
    return _cache["data"]


def race_laps(t: dict) -> int:
    """Laps of a championship race on a circuit: its real number where it has one, else the minimum distance divided by the lap."""
    if t.get("race_laps"):
        return int(t["race_laps"])
    return max(10, int(math.ceil(RACE_MIN_KM * 1000.0 / max(500.0, t["length"]))))


def ref_from_best(best: float) -> dict:
    return {"best": round(best, 3), "floor": round(best * FLOOR_RATIO, 3), "fast": round(best * FAST_RATIO, 3),
            "slow": round(best * SLOW_RATIO, 3), "pace": round(best / CALIBRATION_BEST * AI_SCALE, 4)}


def distance_km(a, b) -> float:
    """Great-circle distance between two (lat, lon) pairs."""
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


def travel_cost(kind: str, km: float) -> int:
    if kind == "race":
        return int(round((RACE_TRAVEL_BASE + RACE_TRAVEL_KM * km) / 1000.0)) * 1000
    return int(round((PRACTICE_TRAVEL_BASE + PRACTICE_TRAVEL_KM * km) / 1000.0)) * 1000


# ── Geometry of the own circuit ─────────────────────────────────────────────

def _clean_ctrl(ctrl):
    if not isinstance(ctrl, list) or not 4 <= len(ctrl) <= 40:
        return None
    out = []
    for p in ctrl:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(x) and math.isfinite(y)) or abs(x) > 6000 or abs(y) > 6000:
            return None
        out.append((round(x, 1), round(y, 1)))
    return out


def spline(ctrl, ds=3.0):
    """A closed centripetal Catmull-Rom curve through the control points (it does not overshoot or loop
    where points are unevenly spaced), sampled every ds metres."""
    n = len(ctrl)
    dense = []

    def knot(t, a, b):
        return t + max(math.dist(a, b), 1e-6) ** 0.5

    for i in range(n):
        p0, p1, p2, p3 = ctrl[(i - 1) % n], ctrl[i], ctrl[(i + 1) % n], ctrl[(i + 2) % n]
        t0 = 0.0
        t1 = knot(t0, p0, p1)
        t2 = knot(t1, p1, p2)
        t3 = knot(t2, p2, p3)
        steps = max(8, int(math.dist(p1, p2) / 2.0))
        for k in range(steps):
            t = t1 + (t2 - t1) * k / steps
            pt = []
            for a in (0, 1):
                a1 = (t1 - t) / (t1 - t0) * p0[a] + (t - t0) / (t1 - t0) * p1[a]
                a2 = (t2 - t) / (t2 - t1) * p1[a] + (t - t1) / (t2 - t1) * p2[a]
                a3 = (t3 - t) / (t3 - t2) * p2[a] + (t - t2) / (t3 - t2) * p3[a]
                b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
                b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
                pt.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
            dense.append(tuple(pt))
    cum = [0.0]
    for i in range(len(dense)):
        cum.append(cum[-1] + math.dist(dense[i], dense[(i + 1) % len(dense)]))
    total = cum[-1]
    count = max(8, int(round(total / ds)))
    out, seg = [], 0
    for i in range(count):
        s = total * i / count
        while cum[seg + 1] < s and seg < len(dense) - 1:
            seg += 1
        a, b = dense[seg], dense[(seg + 1) % len(dense)]
        u = (s - cum[seg]) / max(1e-9, cum[seg + 1] - cum[seg])
        out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
    return out, total


def _wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def analyse(pts, total, width):
    """Length, corners, tightest radius, and whether the circuit crosses itself or has no straight for a pit lane."""
    n = len(pts)
    ds = total / n
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    for _ in range(6):
        tx, ty = xs[:], ys[:]
        for i in range(n):
            xs[i] = (tx[i - 1] + 2 * tx[i] + tx[(i + 1) % n]) / 4
            ys[i] = (ty[i - 1] + 2 * ty[i] + ty[(i + 1) % n]) / 4
    psi = [math.atan2(ys[(i + 1) % n] - ys[i - 1], xs[(i + 1) % n] - xs[i - 1]) for i in range(n)]
    kap = []
    for i in range(n):
        b = (i + 1) % n
        d = math.hypot(xs[b] - xs[i - 1], ys[b] - ys[i - 1]) or 1.0
        kap.append(_wrap(psi[b] - psi[i - 1]) / d)
    for _ in range(3):
        t = kap[:]
        for i in range(n):
            kap[i] = (t[i - 1] + 2 * t[i] + t[(i + 1) % n]) / 4
    ak = [abs(k) for k in kap]
    kmax = max(ak)
    # corners, as the simulator counts them (runs that really bend, merged when nearly touching)
    thr = 1 / 520.0
    runs, start = [], None
    for i in range(n * 2):
        k = ak[i % n]
        if k > thr and start is None:
            start = i
        if (k <= thr or i == n * 2 - 1) and start is not None:
            if start < n:
                runs.append([start, min(i - 1, start + n - 1)])
            start = None
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 14:
            merged[-1][1] = max(merged[-1][1], r[1])
        else:
            merged.append(r)
    if len(merged) > 1 and merged[0][0] + n - merged[-1][1] < 14:      # one corner across the closing point
        merged[0][0] = merged[-1][0] - n
        merged.pop()
    corners = len(merged)
    tight = 0
    for a, b in merged:
        if max(ak[i % n] for i in range(a, b + 1)) > 1 / 60.0:
            tight += 1
    # straight enough for the start line, the pit entry and the pit exit
    before, after = int(round(150 / ds)), int(round(90 / ds))
    window = sum(ak[(j) % n] for j in range(-before, after + 1))
    best = window
    for i in range(1, n):
        window += ak[(i + after) % n] - ak[(i - before - 1) % n]
        best = min(best, window)
    straight = best * ds <= 0.5     # radians of turning allowed in the 240 m around the line
    # crossing itself, or lying so close that two parts of the circuit touch
    overlap = False
    stride = 2
    gap = width + 10.0
    idx = list(range(0, n, stride))
    for a in range(len(idx)):
        i = idx[a]
        for b in range(a + 1, len(idx)):
            j = idx[b]
            along = min(j - i, n - (j - i)) * ds
            if along < 90.0:
                continue
            if abs(pts[i][0] - pts[j][0]) < gap and abs(pts[i][1] - pts[j][1]) < gap and math.dist(pts[i], pts[j]) < gap:
                overlap = True
                break
        if overlap:
            break
    return {"length": total, "corners": corners, "tight": tight, "min_radius": 1 / kmax if kmax > 1e-9 else 1e9,
            "straight": straight, "overlap": overlap}


def build_cost(info: dict, width: int) -> int:
    return int(round((LAND_COST + PIT_COST + info["length"] * width * ASPHALT_PER_M2
                      + info["corners"] * CORNER_COST + info["tight"] * TIGHT_CORNER_COST) / 1000.0)) * 1000


def seats_cost(seats: dict) -> int:
    return sum(SEAT_COST[k] * seats[k] for k in SEAT_COST)


def clean_seats(raw) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for k in SEAT_COST:
        try:
            v = int(float(raw.get(k, 0)))
        except (TypeError, ValueError, OverflowError):
            v = 0
        out[k] = max(0, v)
    return out


def quote(ctrl, width, seats=None) -> dict:
    """What a drawn circuit would be: ok/error, the cleaned geometry and the price. Nothing is stored."""
    seats = clean_seats(seats)
    try:
        width = int(width)
    except (TypeError, ValueError):
        width = 12
    if width not in WIDTHS:
        width = 12
    ctrl = _clean_ctrl(ctrl)
    if not ctrl:
        return {"ok": False, "error": "shape"}
    pts, total = spline(ctrl)
    info = analyse(pts, total, width)
    error = None
    if total < MIN_LENGTH:
        error = "short"
    elif total > MAX_LENGTH:
        error = "long"
    elif info["overlap"]:
        error = "overlap"
    elif info["min_radius"] < MIN_RADIUS:
        error = "tight"
    elif info["corners"] < MIN_CORNERS:
        error = "corners"
    elif not info["straight"]:
        error = "straight"
    cost = build_cost(info, width)
    out = {"ok": error is None, "error": error, "length": round(total, 1), "corners": info["corners"], "tight": info["tight"],
           "min_radius": round(min(info["min_radius"], 9999.0), 1), "width": width, "cost": cost, "seats": seats,
           "seats_cost": seats_cost(seats), "points": [[round(x, 1), round(y, 1)] for x, y in pts], "ctrl": [list(p) for p in ctrl]}
    out["host"] = hosting(out)
    out["upkeep"] = maintenance_per_day({"cost": cost, "seats_cost": out["seats_cost"]})
    return out


def hosting(t: dict) -> dict:
    """Does this circuit meet what a championship round needs, and what would a round pay."""
    seats = t.get("seats") or {}
    need = {"length": t["length"] >= REQUIRE["length"], "width": t["width"] >= REQUIRE["width"],
            "seated": seats.get("seated", 0) >= REQUIRE["seated"], "vip": seats.get("vip", 0) >= REQUIRE["vip"]}
    return {"ok": all(need.values()), "need": need, "require": REQUIRE, "income": race_income(t)}


def race_income(t: dict, rivals: int = 9) -> dict:
    seats = t.get("seats") or {}
    occupancy = max(0.5, min(0.95, 0.55 + 0.03 * t.get("corners", 0) + 0.00003 * t.get("length", 0)))
    tickets = int(sum(seats.get(k, 0) * SEAT_PRICE[k] * occupancy for k in SEAT_PRICE))
    fees = ENTRY_FEE * rivals
    return {"tickets": tickets, "fees": fees, "total": tickets + fees, "occupancy": round(occupancy, 2)}


def value(own: dict) -> int:
    return int(own.get("cost", 0) + own.get("seats_cost", 0))


def maintenance_per_day(own: dict) -> int:
    return int(round(value(own) * MAINTENANCE_DAY / 100.0)) * 100


# ── Measuring and storing the own circuit ───────────────────────────────────

def measure(definition: dict):
    """Run the simulator on a circuit definition in a separate process: start line, best lap, race profile."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(definition, f)
        path = f.name
    try:
        r = subprocess.run(["node", os.path.join(_DIR, "track_ref.mjs"), path], capture_output=True, text=True, timeout=90, cwd=_DIR)
        if r.returncode != 0:
            return None
        return json.loads(r.stdout)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def make_own(ctrl, width, seats, name, lat, lon):
    """The finished own circuit, or (None, error)."""
    if any(clean_seats(seats).values()): return None, "stand_invalid"
    q = quote(ctrl, width, {})
    if not q["ok"]:
        return None, q["error"]
    m = measure({"points": q["points"], "width": q["width"], "runoff": 18, "sectors": [0.34, 0.68]})
    if not m or not m.get("best"):
        return None, "undrivable"
    own = {"id": OWN, "name": str(name or "")[:30].strip() or "Home circuit", "lat": lat, "lon": lon, "ctrl": q["ctrl"],
           "points": q["points"], "width": q["width"], "runoff": 18, "sectors": [0.34, 0.68], "start": m["start"],
           "length": q["length"], "corners": q["corners"], "tight": q["tight"], "cost": q["cost"], "seats": q["seats"],
           "seats_cost": q["seats_cost"], "grandstands": [], "ref": ref_from_best(m["best"]),
           "profile": {**m["profile"], "speeds": [round(v, 3) for v in m["profile"]["speeds"]]}}
    return own, None


def load_own(raw):
    if not raw:
        return None
    try:
        own = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None
    return own if isinstance(own, dict) and own.get("points") else None


def for_player(own, track_id):
    """A circuit by id: an official one, or the player's own."""
    if track_id == OWN:
        return own
    return official().get(track_id)


def public_track(t: dict, with_geometry: bool = False) -> dict:
    out = {k: t[k] for k in ("id", "name", "lat", "lon", "length", "width") if k in t}
    out["ref"] = t.get("ref")
    if with_geometry:
        out["points"] = t["points"]
    return out
