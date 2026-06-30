"""
Server Monitor — continuous server metrics logging + query API.
Records metrics every minute via background loop (starts on first request).
Uses only /proc, /sys, df, free — no external dependencies.
Routes: /api/apps/server-monitor/...
"""

import asyncio
import glob
import os
import sqlite3
import subprocess
import sys
import time

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

get_current_session = sys.modules["backend.auth"].get_current_session

router = APIRouter(prefix="/api/apps/server-monitor")
router._app_backend = "server-monitor"

_DB_PATH = os.path.join(
    os.path.dirname(sys.modules["backend.db"].APPS_DIR),
    "apps", "server-monitor", "data.db"
)

_loop_task = None


# ── DB ────────────────────────────────────────────────────────────────────────

def _conn():
    c = sqlite3.connect(_DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("""
        CREATE TABLE IF NOT EXISTS server_metrics (
            ts            INTEGER PRIMARY KEY,
            cpu           REAL,
            load1         REAL,
            load5         REAL,
            load15        REAL,
            ram_used_pct  REAL,
            swap_used_pct REAL,
            disk_used_pct REAL,
            disk_read_mb  REAL,
            disk_write_mb REAL,
            net_in_mb     REAL,
            net_out_mb    REAL,
            temp_max      REAL
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS plant (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            started       INTEGER DEFAULT 0,
            health        REAL    DEFAULT 0.0,
            growth        REAL    DEFAULT 0.0,
            boost_until   INTEGER DEFAULT 0,
            last_hourly   INTEGER DEFAULT 0,
            created_at    INTEGER DEFAULT (strftime('%s','now')),
            generation    INTEGER DEFAULT 1,
            seed          INTEGER DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS plant_log (
            ts            INTEGER PRIMARY KEY,
            health        REAL,
            growth        REAL,
            health_delta  REAL,
            growth_delta  REAL,
            cpu           REAL,
            ram           REAL,
            disk          REAL,
            net_mb        REAL,
            boosted       INTEGER DEFAULT 0,
            disk_read_mb  REAL DEFAULT 0,
            disk_write_mb REAL DEFAULT 0,
            weed_pct      REAL DEFAULT 0
        )
    """)
    for col, typ in [("disk_read_mb","REAL"), ("disk_write_mb","REAL"), ("weed_pct","REAL")]:
        try:
            c.execute(f"ALTER TABLE plant_log ADD COLUMN {col} {typ} DEFAULT 0")
        except Exception:
            pass
    c.execute("""
        CREATE TABLE IF NOT EXISTS plant_archive (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            generation    INTEGER,
            seed          INTEGER,
            name          TEXT,
            health        REAL,
            archived_at   INTEGER,
            started_at    INTEGER,
            days          REAL
        )
    """)
    # migrations for existing installs
    for col, dflt in [("generation", "1"), ("seed", "0")]:
        try:
            c.execute(f"ALTER TABLE plant ADD COLUMN {col} INTEGER DEFAULT {dflt}")
        except Exception:
            pass
    # ensure one row exists
    c.execute("INSERT OR IGNORE INTO plant(id) VALUES(1)")
    c.commit()
    return c


PLANTS = [
    {"name": "Lumivex",   "seed": 1001},
    {"name": "Thornalis", "seed": 2002},
    {"name": "Veradusk",  "seed": 3003},
    {"name": "Crysthorn", "seed": 4004},
    {"name": "Morveil",   "seed": 5005},
    {"name": "Faebloom",  "seed": 6006},
    {"name": "Solmira",   "seed": 7007},
    {"name": "Duskpetal", "seed": 8008},
    {"name": "Irisvex",   "seed": 9009},
    {"name": "Nyxflora",  "seed": 10010},
]

def _plant_def(generation: int) -> dict:
    return PLANTS[(generation - 1) % len(PLANTS)]


# ── /proc helpers ─────────────────────────────────────────────────────────────

def _read_file(path, fallback=""):
    try:
        return open(path).read().strip()
    except:
        return fallback


def _cpu_stat():
    line = open("/proc/stat").readline()
    vals = list(map(int, line.split()[1:]))
    idle  = vals[3]
    total = sum(vals)
    return idle, total


def _meminfo():
    info = {}
    for line in _read_file("/proc/meminfo").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            try:
                info[k.strip()] = int(v.strip().split()[0]) * 1024
            except:
                pass
    return info


def _disk_io():
    # /proc/diskstats: fields 3=reads, 7=writes (in 512-byte sectors)
    read_b = write_b = 0
    for line in _read_file("/proc/diskstats").splitlines():
        parts = line.split()
        if len(parts) < 14:
            continue
        dev = parts[2]
        # only physical disks (sda, vda, nvme0n1, xvda...), skip partitions
        if not any(dev.startswith(p) for p in ("sd", "vd", "nvme", "xvd", "hd")):
            continue
        if dev[-1].isdigit() and not dev.startswith("nvme"):
            continue
        try:
            read_b  += int(parts[5])  * 512
            write_b += int(parts[9])  * 512
        except:
            pass
    return read_b, write_b


def _net_io():
    rx = tx = 0
    for line in _read_file("/proc/net/dev").splitlines()[2:]:
        parts = line.split()
        if len(parts) < 10:
            continue
        iface = parts[0].rstrip(":")
        if iface == "lo":
            continue
        try:
            rx += int(parts[1])
            tx += int(parts[9])
        except:
            pass
    return rx, tx


def _temperatures():
    temps = []
    for zone in glob.glob("/sys/class/thermal/thermal_zone*"):
        try:
            t = int(open(f"{zone}/temp").read().strip()) / 1000
            if t > 0:
                temps.append(t)
        except:
            pass
    for hwmon in glob.glob("/sys/class/hwmon/hwmon*"):
        for tf in glob.glob(f"{hwmon}/temp*_input"):
            try:
                t = int(open(tf).read().strip()) / 1000
                if t > 0:
                    temps.append(t)
            except:
                pass
    return round(max(temps), 1) if temps else None


def _disk_used_pct():
    r = subprocess.run(["df", "-B1", "/"], capture_output=True, text=True)
    lines = r.stdout.splitlines()
    if len(lines) > 1:
        parts = lines[1].split()
        try:
            total = int(parts[1])
            used  = int(parts[2])
            return round(used / total * 100, 1) if total else 0.0
        except:
            pass
    return 0.0


# ── Metrics collection ────────────────────────────────────────────────────────

_prev_cpu   = None
_prev_disk  = None
_prev_net   = None
_prev_ts    = None


def _collect():
    global _prev_cpu, _prev_disk, _prev_net, _prev_ts

    now = int(time.time())

    # CPU — compare two /proc/stat snapshots
    idle2, total2 = _cpu_stat()
    cpu = 0.0
    if _prev_cpu:
        idle1, total1 = _prev_cpu
        dt = total2 - total1
        di = idle2  - idle1
        cpu = round((1 - di / dt) * 100, 1) if dt else 0.0
    _prev_cpu = (idle2, total2)

    # Load
    loadavg = _read_file("/proc/loadavg").split()
    load1 = load5 = load15 = 0.0
    if len(loadavg) >= 3:
        load1, load5, load15 = float(loadavg[0]), float(loadavg[1]), float(loadavg[2])

    # Memory
    mem = _meminfo()
    mem_total = mem.get("MemTotal", 1)
    mem_used  = mem_total - mem.get("MemAvailable", 0)
    ram_pct   = round(mem_used / mem_total * 100, 1) if mem_total else 0.0

    swap_total = mem.get("SwapTotal", 0)
    swap_used  = swap_total - mem.get("SwapFree", 0)
    swap_pct   = round(swap_used / swap_total * 100, 1) if swap_total else 0.0

    # Disk usage
    disk_pct = _disk_used_pct()

    # Disk I/O — MB/s since last sample
    dr2, dw2 = _disk_io()
    disk_read_mb = disk_write_mb = 0.0
    elapsed = (now - _prev_ts) if _prev_ts else 60
    if _prev_disk and elapsed > 0:
        disk_read_mb  = round((dr2 - _prev_disk[0]) / 1024 / 1024 / elapsed, 3)
        disk_write_mb = round((dw2 - _prev_disk[1]) / 1024 / 1024 / elapsed, 3)
    _prev_disk = (dr2, dw2)

    # Network I/O — MB/s
    rx2, tx2 = _net_io()
    net_in_mb = net_out_mb = 0.0
    if _prev_net and elapsed > 0:
        net_in_mb  = round((rx2 - _prev_net[0]) / 1024 / 1024 / elapsed, 3)
        net_out_mb = round((tx2 - _prev_net[1]) / 1024 / 1024 / elapsed, 3)
    _prev_net = (rx2, tx2)

    _prev_ts = now

    # Temperatures
    temp_max = _temperatures()

    row = {
        "ts":            now,
        "cpu":           cpu,
        "load1":         load1,
        "load5":         load5,
        "load15":        load15,
        "ram_used_pct":  ram_pct,
        "swap_used_pct": swap_pct,
        "disk_used_pct": disk_pct,
        "disk_read_mb":  disk_read_mb,
        "disk_write_mb": disk_write_mb,
        "net_in_mb":     net_in_mb,
        "net_out_mb":    net_out_mb,
        "temp_max":      temp_max,
    }

    with _conn() as c:
        c.execute("""
            INSERT OR REPLACE INTO server_metrics
            (ts,cpu,load1,load5,load15,ram_used_pct,swap_used_pct,
             disk_used_pct,disk_read_mb,disk_write_mb,net_in_mb,net_out_mb,temp_max)
            VALUES (:ts,:cpu,:load1,:load5,:load15,:ram_used_pct,:swap_used_pct,
                    :disk_used_pct,:disk_read_mb,:disk_write_mb,:net_in_mb,:net_out_mb,:temp_max)
        """, row)

    return row


# ── Plant hourly logic ────────────────────────────────────────────────────────

def _plant_hourly():
    """Called once per hour if plant is started. Updates health and growth."""
    now = int(time.time())
    with _conn() as c:
        plant = dict(c.execute("SELECT * FROM plant WHERE id=1").fetchone())
        if not plant["started"]:
            return

        # get avg metrics for the last hour from server_metrics
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM server_metrics WHERE ts >= ? AND ts <= ?",
            (now - 3600, now)
        ).fetchall()]

        if not rows:
            return

        cpu  = sum(r["cpu"]          for r in rows) / len(rows)
        ram  = sum(r["ram_used_pct"] for r in rows) / len(rows)
        disk = sum(r["disk_used_pct"] for r in rows) / len(rows)

        boosted = now < plant["boost_until"]

        # net_in/out are MB/s averages → convert to MB/hour
        net_in_hr  = sum(r["net_in_mb"]  for r in rows) / len(rows) * 60
        net_out_hr = sum(r["net_out_mb"] for r in rows) / len(rows) * 60

        # disk I/O — penalty only when write > read, smooth asymptotic formula
        disk_read_avg  = sum(r["disk_read_mb"]  for r in rows) / len(rows)
        disk_write_avg = sum(r["disk_write_mb"] for r in rows) / len(rows)
        if disk_write_avg > disk_read_avg:
            if disk_read_avg > 0:
                r_ = disk_write_avg / disk_read_avg
                x  = r_ - 1
                weed_pct = 3.0 * x / (x + 2.0)
            else:
                weed_pct = 3.0
        else:
            weed_pct = 0.0

        # ── Health delta ──────────────────────────────────────────────────────
        # CPU: neutral at 20%, -4.17%/hr at 100%, +4.17%/hr at 0%
        # RAM: >50% always worsens (amplifies dmg, reduces heal), <50% always helps
        cpu_raw    = (cpu - 20.0) / 80.0 * (100.0 / 24.0)
        ram_mod    = (ram - 50.0) / 50.0 * 0.5          # -0.5 to +0.5
        cpu_effect = cpu_raw - abs(cpu_raw) * ram_mod    # RAM always works against plant when >50%

        # Download bonus: asymptotic, max +3%/day
        dl_bonus = (3.0 * net_in_hr / (net_in_hr + 50.0)) / 24.0

        health_delta = -cpu_effect + dl_bonus

        # Boost: if health would decrease → clamp to 0 (no damage)
        if boosted and health_delta < 0:
            health_delta = 0.0

        new_health = max(0.0, min(100.0, plant["health"] + health_delta))

        # ── Growth delta ──────────────────────────────────────────────────────
        # Base: 1%/day = 1/24 per hour
        base_growth = 1.0 / 24.0

        # Disk slows growth above 50%: at 100% disk → growth = 0
        disk_mult = 1.0 - max(0.0, (disk - 50.0) / 50.0)

        # Upload bonus: asymptotic, max +3%/day
        ul_bonus = (3.0 * net_out_hr / (net_out_hr + 50.0)) / 24.0

        growth_delta = max(0.0, base_growth * disk_mult + ul_bonus)

        # Weed penalty: weed_pct is %/day → convert to %/h; growth floored at 0
        if weed_pct > 0:
            health_delta -= weed_pct / 24.0
            growth_delta = max(0.0, growth_delta - weed_pct / 24.0)

        # Boost: double the growth
        if boosted:
            growth_delta *= 2.0

        new_growth = max(0.0, min(100.0, plant["growth"] + growth_delta))

        c.execute("""
            UPDATE plant SET health=?, growth=?, last_hourly=? WHERE id=1
        """, (round(new_health, 4), round(new_growth, 4), now))

        c.execute("""
            INSERT OR REPLACE INTO plant_log
            (ts, health, growth, health_delta, growth_delta, cpu, ram, disk, net_mb, boosted,
             disk_read_mb, disk_write_mb, weed_pct)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (now, round(new_health,4), round(new_growth,4),
              round(health_delta,4), round(growth_delta,4),
              round(cpu,2), round(ram,2), round(disk,2),
              round((net_in_hr + net_out_hr) / 60, 3),
              1 if boosted else 0,
              round(disk_read_avg,3), round(disk_write_avg,3), round(weed_pct,1)))


async def _monitor_loop():
    # warm up counters, wait 5s, then first real sample, then every 60s
    _cpu_stat(); _disk_io(); _net_io()
    await asyncio.sleep(5)
    _last_hourly = [0]
    while True:
        try:
            _collect()
            # run plant hourly update
            now = int(time.time())
            if now - _last_hourly[0] >= 3600:
                _plant_hourly()
                _last_hourly[0] = now
        except Exception as e:
            print(f"[server-monitor] collect error: {e}")
        await asyncio.sleep(60)


def _ensure_loop():
    global _loop_task
    if _loop_task is None or _loop_task.done():
        try:
            _loop_task = asyncio.get_running_loop().create_task(_monitor_loop())
        except RuntimeError:
            try:
                _loop_task = asyncio.get_event_loop().create_task(_monitor_loop())
            except RuntimeError:
                pass


async def on_startup():
    await asyncio.sleep(0)  # yield to let event loop settle
    _ensure_loop()




# ── Helpers ───────────────────────────────────────────────────────────────────

def _period_bounds(period: str, tz: str = "UTC"):
    import zoneinfo, datetime
    now = int(time.time())
    try:
        zi = zoneinfo.ZoneInfo(tz)
        tz_secs = int(datetime.datetime.now(zi).utcoffset().total_seconds())
    except Exception:
        tz_secs = 0
    today_start = now - ((now + tz_secs) % 86400)
    if period == "today":     return today_start, now
    if period == "yesterday": return today_start - 86400, today_start
    if period == "week":      return now - 7  * 86400, now
    if period == "month":     return now - 30 * 86400, now
    if period == "hour":      return now - 3600, now
    return today_start, now


def _aggregate(rows, bucket_seconds: int):
    if not rows:
        return []
    fields = ["cpu", "load1", "load5", "load15", "ram_used_pct", "swap_used_pct",
              "disk_used_pct", "disk_read_mb", "disk_write_mb", "net_in_mb", "net_out_mb", "temp_max"]
    buckets = {}
    for r in rows:
        bk = (r["ts"] // bucket_seconds) * bucket_seconds
        if bk not in buckets:
            buckets[bk] = {f: [] for f in fields}
        for f in fields:
            v = r[f]
            if v is not None:
                buckets[bk][f].append(v)
    result = []
    for bk in sorted(buckets):
        entry = {"ts": bk}
        for f in fields:
            vals = buckets[bk][f]
            if vals:
                entry[f"avg_{f}"] = round(sum(vals) / len(vals), 2)
                entry[f"min_{f}"] = round(min(vals), 2)
                entry[f"max_{f}"] = round(max(vals), 2)
            else:
                entry[f"avg_{f}"] = entry[f"min_{f}"] = entry[f"max_{f}"] = None
        result.append(entry)
    return result


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/current")
async def get_current(session=Depends(get_current_session)):
    _ensure_loop()
    with _conn() as c:
        row = c.execute(
            "SELECT * FROM server_metrics ORDER BY ts DESC LIMIT 1"
        ).fetchone()
    if not row:
        row = _collect()
        return JSONResponse(dict(row))
    return JSONResponse(dict(row))


@router.get("/metrics")
async def get_metrics(
    period: str = Query("today"),
    from_ts: int = Query(None),
    to_ts:   int = Query(None),
    tz: str = Query("UTC"),
    session=Depends(get_current_session),
):
    if from_ts and to_ts:
        f, t = from_ts, to_ts
    else:
        f, t = _period_bounds(period, tz)

    bucket = {"hour": 60, "today": 300, "yesterday": 900, "week": 3600, "month": 14400}.get(period, 300)

    with _conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM server_metrics WHERE ts >= ? AND ts <= ? ORDER BY ts", (f, t)
        ).fetchall()]

    return JSONResponse({
        "period": period, "from_ts": f, "to_ts": t,
        "bucket": bucket, "points": _aggregate(rows, bucket), "raw_count": len(rows),
    })


@router.get("/plant")
async def get_plant(session=Depends(get_current_session)):
    """Current plant state + last 24 log entries + archive."""
    with _conn() as c:
        plant   = dict(c.execute("SELECT * FROM plant WHERE id=1").fetchone())
        log     = [dict(r) for r in c.execute(
            "SELECT * FROM plant_log ORDER BY ts DESC LIMIT 24"
        ).fetchall()]
        archive = [dict(r) for r in c.execute(
            "SELECT * FROM plant_archive ORDER BY archived_at DESC"
        ).fetchall()]
    now = int(time.time())
    plant["boost_active"]    = now < plant["boost_until"]
    plant["boost_remaining"] = max(0, plant["boost_until"] - now)
    plant["log"]     = list(reversed(log))
    plant["archive"] = archive
    pd = _plant_def(plant.get("generation", 1))
    plant["name"] = pd["name"]
    plant["seed"] = pd["seed"]
    return JSONResponse(plant)


@router.get("/plant-history")
async def plant_history(
    period: str = Query("today"),
    tz: str = Query("UTC"),
    session=Depends(get_current_session),
):
    f, t = _period_bounds(period, tz)
    with _conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT ts, health, growth FROM plant_log WHERE ts >= ? AND ts <= ? ORDER BY ts", (f, t)
        ).fetchall()]
    return JSONResponse({"period": period, "from_ts": f, "to_ts": t, "points": rows})


@router.post("/plant/plant")
async def do_plant(session=Depends(get_current_session)):
    """Plant the seed — starts growth tracking."""
    with _conn() as c:
        row = dict(c.execute("SELECT generation FROM plant WHERE id=1").fetchone())
        gen  = row.get("generation") or 1
        seed = _plant_def(gen)["seed"]
        c.execute("""UPDATE plant SET started=1, health=100.0, growth=0.0,
                     boost_until=0, created_at=strftime('%s','now'), seed=?
                     WHERE id=1""", (seed,))
    _ensure_loop()
    return JSONResponse({"ok": True})


@router.post("/plant/archive")
async def archive_plant(session=Depends(get_current_session)):
    """Archive the current plant (must be 100% growth + health >= 70)."""
    now = int(time.time())
    with _conn() as c:
        plant = dict(c.execute("SELECT * FROM plant WHERE id=1").fetchone())
        if not plant["started"]:
            return JSONResponse({"ok": False, "reason": "not started"})
        if plant["growth"] < 100.0:
            return JSONResponse({"ok": False, "reason": "not fully grown"})
        if plant["health"] < 70.0:
            return JSONResponse({"ok": False, "reason": "health too low"})
        gen  = plant.get("generation") or 1
        pd   = _plant_def(gen)
        days = round((now - plant["created_at"]) / 86400, 1)
        c.execute("""INSERT INTO plant_archive(generation, seed, name, health, archived_at, started_at, days)
                     VALUES(?,?,?,?,?,?,?)""",
                  (gen, pd["seed"], pd["name"], round(plant["health"], 1), now, plant["created_at"], days))
        new_gen = gen + 1
        c.execute("""UPDATE plant SET started=0, health=100.0, growth=0.0,
                     boost_until=0, last_hourly=0, generation=?, seed=?,
                     created_at=strftime('%s','now') WHERE id=1""",
                  (new_gen, _plant_def(new_gen)["seed"]))
    return JSONResponse({"ok": True, "generation": new_gen})


@router.post("/plant/water")
async def water_plant(session=Depends(get_current_session)):
    """Water the plant — boosts health regen and growth for 24 hours."""
    now = int(time.time())
    with _conn() as c:
        plant = dict(c.execute("SELECT * FROM plant WHERE id=1").fetchone())
        if not plant["started"]:
            return JSONResponse({"ok": False, "reason": "not started"})
        boost_until = max(now, plant["boost_until"]) + 86400  # 24 hours
        c.execute("UPDATE plant SET boost_until=? WHERE id=1", (boost_until,))
    return JSONResponse({"ok": True, "boost_until": boost_until})


@router.get("/summary")
async def get_summary(period: str = Query("today"), tz: str = Query("UTC"), session=Depends(get_current_session)):
    f, t = _period_bounds(period, tz)
    fields = ["cpu", "load1", "ram_used_pct", "swap_used_pct",
              "disk_used_pct", "disk_read_mb", "disk_write_mb",
              "net_in_mb", "net_out_mb", "temp_max"]
    with _conn() as c:
        rows = [dict(r) for r in c.execute(
            "SELECT * FROM server_metrics WHERE ts >= ? AND ts <= ?", (f, t)
        ).fetchall()]
    if not rows:
        return JSONResponse({"period": period, "count": 0})
    summary = {"period": period, "count": len(rows)}
    for field in fields:
        vals = [r[field] for r in rows if r[field] is not None]
        if vals:
            summary[f"avg_{field}"] = round(sum(vals) / len(vals), 2)
            summary[f"min_{field}"] = round(min(vals), 2)
            summary[f"max_{field}"] = round(max(vals), 2)
    return JSONResponse(summary)
