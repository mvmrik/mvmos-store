"""
Tower Defense — the bank: points as money, and what they have bought for good.

Every finished run pays its score into the player's bank. Those points are
spent in the permanent shop on the game-over screen, on the same weapons,
rings and upgrades the in-run shop sells, at a much higher price; whatever is
bought there is what every later run starts with. Spending never touches the
Game Hub leaderboard — the score a run earned stays the score it earned.

The catalogue below is the only copy of the prices: the browser receives it in
td_start and from api.py, so the in-run shop and the permanent one can never
disagree with what this file will accept.

Runtime data lives in this app's own data.db, never in the package.
"""

import json
import math
import os
import sqlite3
import time

_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_DB_PATH = os.path.join(_APP_DIR, "data.db")

MAX_MOUNTED = 3

# Price of each weapon and of the extras bought once (in coins, in a run).
WEAPONS = {"gun": 0, "fire": 120, "ice": 140, "laser": 220, "mine": 180}
EXTRAS  = {"regen": 90, "shield": 150, "nova": 170, "fring": 200, "iring": 160, "soldiers": 180, "drones": 240,
           "tesla": 220}

# key -> [price of the first level, price growth per level, last level].
# None means there is no last level: only things that physically run out keep
# one — six fireballs fill the ring, the range reaches the edge of the field,
# the ice ring cannot get wider than the range or slow past a standstill, and
# six pylons are all the field has room for.
UPGRADES = {
    "gun.p":    [30, 1.45, None], "gun.r":    [35, 1.45, None],
    "fire.p":   [45, 1.45, None], "fire.r":   [45, 1.45, None],
    "ice.p":    [45, 1.45, None], "ice.r":    [50, 1.45, None],
    "laser.p":  [60, 1.45, None], "laser.r":  [60, 1.45, None],
    "mine.p":   [55, 1.45, None], "mine.r":   [55, 1.45, None],
    "hp":       [60, 1.4, None],
    "range":    [70, 1.5, 17],
    "regen.r":  [60, 1.45, None],
    "shield.c": [70, 1.45, None], "shield.r": [70, 1.45, None],
    "nova.p":   [70, 1.45, None], "nova.r":   [75, 1.45, None],
    "fring.n":  [150, 1.55, 5], "fring.p": [80, 1.45, None], "fring.s": [70, 1.45, None],
    "iring.w":  [70, 1.45, 30], "iring.s": [80, 1.5, 9],
    "soldiers.f": [75, 1.45, None], "soldiers.p": [70, 1.45, None],
    "drones.f":   [90, 1.45, None], "drones.p":   [80, 1.45, None],
    "tesla.n":    [140, 1.55, 4],  "tesla.p":    [80, 1.45, None],
}

# A permanent purchase costs the in-run price times this, so the cheapest
# thing on sale (the first level of the gun's power) costs exactly 10 000
# points, and everything else keeps the in-run proportions and growth.
PERM_FACTOR = 10000 / min(u[0] for u in UPGRADES.values())

# Far above anything reachable; only stops a forged build from asking for a
# price that does not fit in a float.
_LEVEL_CEILING = 500


def catalogue() -> dict:
    return {
        "weapons":  WEAPONS,
        "extras":   EXTRAS,
        "upgrades": UPGRADES,
        "perm_factor": PERM_FACTOR,
        "max_mounted": MAX_MOUNTED,
    }


def perm_price(base: float, mult: float = 1.0, level: int = 0) -> int:
    return int(math.floor(PERM_FACTOR * base * mult ** level / 50 + 0.5)) * 50


def fresh_build() -> dict:
    return {"own": ["gun"], "eq": ["gun"], "lv": {}}


def clean_build(b) -> dict:
    """Only what this catalogue sells, every level held to its cap."""
    if not isinstance(b, dict):
        return fresh_build()
    own = []
    for k in b.get("own") or []:
        if (k in WEAPONS or k in EXTRAS) and k not in own:
            own.append(k)
    if "gun" not in own:
        own.insert(0, "gun")
    eq = []
    for k in b.get("eq") or []:
        if k in WEAPONS and k in own and k not in eq and len(eq) < MAX_MOUNTED:
            eq.append(k)
    if not eq:
        eq.append("gun")
    lv = {}
    raw = b.get("lv") if isinstance(b.get("lv"), dict) else {}
    for k, u in UPGRADES.items():
        try:
            v = int(raw.get(k) or 0)
        except (TypeError, ValueError):
            v = 0
        cap = u[2] if u[2] is not None else _LEVEL_CEILING
        if v > 0:
            lv[k] = min(cap, v)
    return {"own": own, "eq": eq, "lv": lv}


# ── Storage ──────────────────────────────────────────────────────────────────

def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("""CREATE TABLE IF NOT EXISTS bank (
        player_id  TEXT PRIMARY KEY,
        points     INTEGER NOT NULL DEFAULT 0,
        build      TEXT NOT NULL DEFAULT '',
        updated_at REAL NOT NULL DEFAULT 0
    )""")
    # The furthest wave the player has reached, added after the first release.
    cols = {r["name"] for r in c.execute("PRAGMA table_info(bank)")}
    if "best_wave" not in cols:
        c.execute("ALTER TABLE bank ADD COLUMN best_wave INTEGER NOT NULL DEFAULT 0")
    return c


def _row(c, pid):
    r = c.execute("SELECT points, build FROM bank WHERE player_id=?", (pid,)).fetchone()
    if not r:
        return 0, fresh_build()
    try:
        build = clean_build(json.loads(r["build"])) if r["build"] else fresh_build()
    except ValueError:
        build = fresh_build()
    return int(r["points"]), build


def _save(c, pid, points, build):
    c.execute("""INSERT INTO bank (player_id, points, build, updated_at) VALUES (?,?,?,?)
                 ON CONFLICT(player_id) DO UPDATE SET points=excluded.points,
                 build=excluded.build, updated_at=excluded.updated_at""",
              (pid, int(points), json.dumps(build), time.time()))


def _best(c, pid) -> int:
    r = c.execute("SELECT best_wave FROM bank WHERE player_id=?", (pid,)).fetchone()
    return int(r["best_wave"]) if r else 0


def get(pid: str) -> dict:
    c = _conn()
    try:
        points, build = _row(c, pid)
        best = _best(c, pid)
    finally:
        c.close()
    return {"points": points, "build": build, "best": best}


def credit(pid: str, points: int, wave: int = 0) -> dict:
    """Pay a finished run's score into the bank, and keep the furthest wave
    it reached if that is a new record."""
    points = max(0, int(points or 0))
    c = _conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        have, build = _row(c, pid)
        _save(c, pid, have + points, build)
        best = max(_best(c, pid), max(0, int(wave or 0)))
        c.execute("UPDATE bank SET best_wave=? WHERE player_id=?", (best, pid))
        c.execute("COMMIT")
    except Exception:
        c.execute("ROLLBACK")
        raise
    finally:
        c.close()
    return {"points": have + points, "build": build, "best": best}


def buy(pid: str, act: str, key: str) -> tuple[dict | None, str]:
    """One permanent purchase, checked and paid in a single transaction.
    Returns (bank, "") on success and (None, reason) when it is refused."""
    c = _conn()
    try:
        c.execute("BEGIN IMMEDIATE")
        points, b = _row(c, pid)
        own, eq, lv = b["own"], b["eq"], b["lv"]
        price = 0
        if act == "buy":
            base = WEAPONS.get(key, EXTRAS.get(key))
            if base is None or key in own:
                c.execute("ROLLBACK")
                return None, "invalid"
            price = perm_price(base)
            if points < price:
                c.execute("ROLLBACK")
                return None, "points"
            own.append(key)
            if key in WEAPONS and len(eq) < MAX_MOUNTED:
                eq.append(key)
        elif act == "up":
            u = UPGRADES.get(key)
            owner = key.split(".")[0] if "." in key else None
            level = lv.get(key, 0)
            if not u or (owner and owner not in own) or (u[2] is not None and level >= u[2]) \
                    or level >= _LEVEL_CEILING:
                c.execute("ROLLBACK")
                return None, "invalid"
            price = perm_price(u[0], u[1], level)
            if points < price:
                c.execute("ROLLBACK")
                return None, "points"
            lv[key] = level + 1
        elif act == "eq":
            if key not in WEAPONS or key not in own:
                c.execute("ROLLBACK")
                return None, "invalid"
            if key in eq:
                if len(eq) > 1:
                    eq.remove(key)
            elif len(eq) < MAX_MOUNTED:
                eq.append(key)
        else:
            c.execute("ROLLBACK")
            return None, "invalid"
        points -= price
        _save(c, pid, points, b)
        c.execute("COMMIT")
    except Exception:
        try:
            c.execute("ROLLBACK")
        except Exception:
            pass
        raise
    finally:
        c.close()
    return {"points": points, "build": b, "best": _best_of(pid)}, ""


def _best_of(pid: str) -> int:
    c = _conn()
    try:
        return _best(c, pid)
    finally:
        c.close()
