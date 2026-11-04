"""Racelandia - real weather at a circuit.

The forecast comes from Open-Meteo (free, no key). One request per place and day gives the
hourly air temperature, cloud, rain, humidity and sun for yesterday, today and tomorrow of the
circuit's own local time; the table of the day is then turned into what the simulation reads:
one entry per hour with a film of water that builds while it rains and dries in the sun.
Results are kept in the app's database so every player and every request on a day shares them.
When the service cannot be reached the caller falls back to the simulated day.
"""
import json
import math
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

URL = "https://api.open-meteo.com/v1/forecast"
TTL = 3 * 3600


def _fetch(lat: float, lon: float):
    q = urllib.parse.urlencode({
        "latitude": lat, "longitude": lon, "timezone": "auto", "past_days": 1, "forecast_days": 2,
        "hourly": "temperature_2m,relative_humidity_2m,cloud_cover,precipitation,precipitation_probability,shortwave_radiation",
    })
    req = urllib.request.Request(URL + "?" + q, headers={"User-Agent": "mvmOS-Racelandia"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode())


def _tables(raw: dict) -> dict:
    """{local date 'YYYY-MM-DD': 24 simulation entries} from an Open-Meteo answer."""
    h = raw["hourly"]
    times = h["time"]
    n = len(times)
    water = 0.0
    dry = 6
    days = {}
    for i in range(n):
        def val(key, default=0.0):
            v = h.get(key, [None] * n)[i]
            return default if v is None else float(v)
        hour = int(times[i][11:13])
        air = val("temperature_2m", 12.0)
        cloud = min(1.0, max(0.0, val("cloud_cover", 40.0) / 100.0))
        mm = max(0.0, val("precipitation"))
        rain = min(1.0, mm / 2.5)
        sun = min(1.0, max(0.0, val("shortwave_radiation") / 800.0))
        evap = 0.5 - 0.2 * sun * (1 - cloud)
        water = min(6.0, water * evap + 3.2 * rain)
        dry = 0 if water > 0.3 else dry + 1
        solar = 20 * sun * (1 - 0.75 * cloud)
        track = air + solar
        if water > 0.3:
            track = air + 1.0
        elif water > 0.05:
            track = air + 0.4 * solar
        days.setdefault(times[i][:10], []).append({
            "air": round(air, 1), "track": round(track, 1), "cloud": round(cloud, 2), "rain": round(rain, 2),
            "water": round(water if water > 0.02 else 0.0, 2), "sun": round(sun, 2),
            "hum": round(val("relative_humidity_2m", 60.0)), "rubber": round(0.955 + 0.022 * min(dry, 6) / 6, 3),
            "pp": round(val("precipitation_probability") / 100.0, 2), "hour": hour,
        })
    return {d: v for d, v in days.items() if len(v) == 24}


def local_now(raw_offset: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=raw_offset)


def day(conn, lat: float, lon: float):
    """(24 hourly entries for the circuit's local today, local hour now, place's local date, hour with minutes) or None."""
    key = f"{round(lat, 1)}:{round(lon, 1)}"
    now = time.time()
    row = conn.execute("SELECT fetched, data FROM weather_cache WHERE key=?", (key,)).fetchone()
    cached = None
    if row and now - row[0] < TTL:
        cached = json.loads(row[1])
    if cached is None:
        try:
            raw = _fetch(round(lat, 2), round(lon, 2))
            cached = {"offset": int(raw.get("utc_offset_seconds", 0)), "days": _tables(raw)}
            conn.execute("INSERT INTO weather_cache(key, fetched, data) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET fetched=excluded.fetched, data=excluded.data",
                         (key, now, json.dumps(cached)))
            conn.commit()
        except Exception:
            if row:                      # stale data is better than none
                cached = json.loads(row[1])
            else:
                return None
    local = local_now(cached["offset"])
    today = local.strftime("%Y-%m-%d")
    table = cached["days"].get(today)
    if not table:
        return None
    return table, local.hour, today, round(local.hour + local.minute / 60.0, 3)


def public_hours(table: list) -> list:
    """The table the browser needs (without the helper fields)."""
    return [{k: v for k, v in e.items() if k != "hour"} for e in table]


def chance(table: list, start: int, hours: int = 1) -> float:
    """Chance of rain during a session: the highest probability over the hours it covers."""
    start = max(0, min(23, int(start)))
    span = table[start:min(24, start + max(1, int(math.ceil(hours))))]
    return round(max((e["pp"] for e in span), default=0.0) * 20) / 20
