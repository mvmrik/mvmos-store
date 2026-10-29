"""
mvmOS Tesla — the engine: Fleet API client, polling state machine, trip and
charge detection. api.py (routes) and scheduler.py (the minute tick) both load
this file by path, so it only touches this app's own folder and data.db.

Everything is stored in metric units (km, kWh, °C); the browser converts.

The car is never woken. A sleeping car is only looked at through the vehicle
list (which does not wake it), and a car that is awake but idle is left alone
for a while so that it can fall asleep.
"""
import json
import math
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DIR, "data.db")
MI = 1.609344

REGIONS = {
    "eu": ("https://fleet-api.prd.eu.vn.cloud.tesla.com", "https://fleet-auth.prd.vn.cloud.tesla.com", "https://auth.tesla.com"),
    "na": ("https://fleet-api.prd.na.vn.cloud.tesla.com", "https://fleet-auth.prd.vn.cloud.tesla.com", "https://auth.tesla.com"),
    "cn": ("https://fleet-api.prd.cn.vn.cloud.tesla.cn", "https://fleet-auth.prd.vn.cloud.tesla.cn", "https://auth.tesla.cn"),
}
SCOPE = "openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds"
ENDPOINTS_BASE = "charge_state;climate_state;drive_state;location_data;vehicle_state;vehicle_config"
# Everything the car offers. One request returns all of it, so asking for more costs nothing more.
ENDPOINTS = ENDPOINTS_BASE + ";closures_state;gui_settings;charge_schedule_data;preconditioning_schedule_data"
SECRET_KEYS = ("tokens", "backseat_token", "backseat_token_updated_at")

# When to ask the car. Seconds between two looks, per situation; each can be
# changed in the app's settings, also by time of day and day of the week.
SITUATIONS = ("drive", "charge_ac", "charge_dc", "idle", "parked", "parked_check", "asleep")
DEFAULTS = {
    "drive": 60,           # driving
    "charge_ac": 300,      # charging on AC
    "charge_dc": 60,       # fast charging
    "idle": 60,            # just after the car was used: catch the end of the trip, settle
    "parked": 1200,        # awake but unused, left alone so that it can fall asleep
    "parked_check": 300,   # ... meanwhile only the vehicle list (which does not wake it) is read
    "asleep": 900,         # asleep or offline: look at the list to see if it woke up
}
DEFAULT_GRACE = 300        # that long without activity and the car counts as unused
MIN_EVERY, MAX_EVERY = 10, 86400
DC_KW = 30
PRICE_PER_REQUEST = 0.002  # USD, only an estimate for the usage meter


# Columns added after the first release (and for a fresh database too).
SAMPLE_COLUMNS = (
    ("tpms_fl", "REAL"), ("tpms_fr", "REAL"), ("tpms_rl", "REAL"), ("tpms_rr", "REAL"),
    ("tpms_soft", "INTEGER"), ("tpms_hard", "INTEGER"), ("doors", "INTEGER"), ("windows", "INTEGER"),
    ("amps", "REAL"), ("phases", "INTEGER"), ("pilot", "REAL"), ("cable", "TEXT"), ("rate_kmh", "REAL"),
    ("battery_heater", "INTEGER"), ("ideal_range_km", "REAL"), ("sw_status", "TEXT"), ("sw_version", "TEXT"),
)


# ── Database ────────────────────────────────────────────────────────────────
def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    for private_path in (DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"):
        try:
            os.chmod(private_path, 0o600)
        except FileNotFoundError:
            pass
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=8000")
    c.executescript("""
    CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS accounts (
        user_id TEXT PRIMARY KEY, access_token TEXT, refresh_token TEXT, expires_at INTEGER DEFAULT 0,
        connected_at INTEGER, last_error TEXT DEFAULT '', last_ok INTEGER DEFAULT 0,
        refreshing_until INTEGER DEFAULT 0, backoff_until INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, user_id TEXT, created INTEGER, origin TEXT);
    CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, vin TEXT, name TEXT, model TEXT, color TEXT,
        trim TEXT, wheel TEXT, version TEXT, odometer REAL, created INTEGER);
    CREATE TABLE IF NOT EXISTS poll (
        vehicle TEXT PRIMARY KEY, mode TEXT DEFAULT 'idle', next_data INTEGER DEFAULT 0,
        next_check INTEGER DEFAULT 0, last_state TEXT DEFAULT '', last_activity INTEGER DEFAULT 0,
        busy_until INTEGER DEFAULT 0, trip_id INTEGER, charge_id INTEGER, last_sample INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle TEXT NOT NULL, ts INTEGER NOT NULL, state TEXT,
        battery INTEGER, usable INTEGER, range_km REAL, odo_km REAL, lat REAL, lng REAL, heading INTEGER,
        speed REAL, power REAL, shift TEXT, charging_state TEXT, charger_power REAL, energy_added REAL,
        inside_temp REAL, outside_temp REAL, locked INTEGER, sentry INTEGER, climate INTEGER,
        charge_limit INTEGER, user_present INTEGER, version TEXT, to_full INTEGER);
    CREATE INDEX IF NOT EXISTS samples_v ON samples (vehicle, ts);
    CREATE TABLE IF NOT EXISTS states (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle TEXT NOT NULL, start_ts INTEGER NOT NULL,
        end_ts INTEGER, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS states_v ON states (vehicle, start_ts);
    CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle TEXT NOT NULL, start_ts INTEGER, end_ts INTEGER,
        start_odo REAL, end_odo REAL, distance_km REAL DEFAULT 0, energy_kwh REAL DEFAULT 0,
        start_batt INTEGER, end_batt INTEGER, start_range REAL, end_range REAL,
        start_lat REAL, start_lng REAL, end_lat REAL, end_lng REAL, start_addr TEXT DEFAULT '', end_addr TEXT DEFAULT '',
        max_speed REAL DEFAULT 0, temp_out REAL, open INTEGER DEFAULT 1, last_power REAL, last_pts INTEGER);
    CREATE INDEX IF NOT EXISTS trips_v ON trips (vehicle, start_ts);
    CREATE TABLE IF NOT EXISTS trip_points (
        trip INTEGER NOT NULL, ts INTEGER NOT NULL, lat REAL, lng REAL, speed REAL, power REAL, battery INTEGER);
    CREATE INDEX IF NOT EXISTS trip_points_t ON trip_points (trip, ts);
    CREATE TABLE IF NOT EXISTS charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle TEXT NOT NULL, start_ts INTEGER, end_ts INTEGER,
        start_batt INTEGER, end_batt INTEGER, start_range REAL, end_range REAL, kwh REAL DEFAULT 0,
        max_power REAL DEFAULT 0, lat REAL, lng REAL, addr TEXT DEFAULT '', dc INTEGER DEFAULT 0,
        temp_out REAL, open INTEGER DEFAULT 1);
    CREATE INDEX IF NOT EXISTS charges_v ON charges (vehicle, start_ts);
    CREATE TABLE IF NOT EXISTS charge_points (
        charge INTEGER NOT NULL, ts INTEGER NOT NULL, power REAL, battery INTEGER, voltage REAL, current REAL, energy REAL);
    CREATE INDEX IF NOT EXISTS charge_points_c ON charge_points (charge, ts);
    CREATE TABLE IF NOT EXISTS places (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
        radius INTEGER DEFAULT 100, ac_price REAL, dc_price REAL);
    CREATE TABLE IF NOT EXISTS tariffs (
        id TEXT PRIMARY KEY,user_id TEXT NOT NULL,place_id TEXT NOT NULL,name TEXT NOT NULL,
        start_ts INTEGER NOT NULL,end_ts INTEGER NOT NULL,currency TEXT NOT NULL,
        timezone TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'all',rules TEXT NOT NULL,
        created_ts INTEGER NOT NULL,updated_ts INTEGER NOT NULL,CHECK(end_ts>start_ts));
    CREATE INDEX IF NOT EXISTS tariffs_owner ON tariffs(user_id,place_id,start_ts);
    CREATE TABLE IF NOT EXISTS charge_costs (
        charge INTEGER PRIMARY KEY,user_id TEXT NOT NULL,currency TEXT NOT NULL,
        unit_price REAL,total_cost REAL,place_id TEXT,updated_ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS journeys (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, vehicle TEXT NOT NULL,
        name TEXT NOT NULL, start_ts INTEGER NOT NULL, end_ts INTEGER NOT NULL,
        created_ts INTEGER NOT NULL, updated_ts INTEGER NOT NULL,
        CHECK(end_ts > start_ts));
    CREATE INDEX IF NOT EXISTS journeys_owner ON journeys(user_id, vehicle, start_ts);
    CREATE TABLE IF NOT EXISTS prefs (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (user_id, key));
    CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER DEFAULT 0, PRIMARY KEY (day, kind));
    CREATE TABLE IF NOT EXISTS raw (sample INTEGER PRIMARY KEY, vehicle TEXT NOT NULL, ts INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX IF NOT EXISTS raw_v ON raw (vehicle, ts);
    """)
    c.executescript("""
    CREATE TABLE IF NOT EXISTS shares (
        owner_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('view','admin')),
        created_ts INTEGER NOT NULL, PRIMARY KEY(owner_id,user_id));
    CREATE TABLE IF NOT EXISTS credentials (
        user_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, client_secret TEXT NOT NULL,
        region TEXT NOT NULL DEFAULT 'eu', budget REAL NOT NULL DEFAULT 10,
        registered_origin TEXT NOT NULL DEFAULT '', registered_key TEXT NOT NULL DEFAULT '',
        registered_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS user_usage (
        user_id TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER DEFAULT 0,
        PRIMARY KEY(user_id,day,kind));
    """)
    # Upgrade only an unambiguous existing connection. Never give legacy secrets
    # to a newly visiting Apps Hub profile, and never move vehicle history.
    if not cfg_get(c, 'personal_credentials_migrated', False):
        owners = c.execute("SELECT user_id FROM accounts").fetchall()
        if len(owners) == 1 and cfg_get(c, 'client_id') and cfg_get(c, 'client_secret'):
            uid = owners[0]['user_id']
            try:
                budget = float(str(cfg_get(c,'monthly_budget',10)).replace(',', '.'))
                if not math.isfinite(budget): budget = 10
            except (TypeError, ValueError):
                budget = 10
            region = cfg_get(c,'region','eu')
            c.execute("INSERT OR IGNORE INTO credentials(user_id,client_id,client_secret,region,budget) VALUES(?,?,?,?,?)",
                      (uid, cfg_get(c,'client_id'), cfg_get(c,'client_secret'), region if region in REGIONS else 'eu', max(0,budget)))
            c.execute("INSERT OR IGNORE INTO user_usage SELECT ?,day,kind,n FROM usage", (uid,))
            set_cfg(c, 'server_owner', uid)
        set_cfg(c, 'personal_credentials_migrated', True)
        c.commit()
    have = {r[1] for r in c.execute("PRAGMA table_info(samples)")}
    for name, typ in SAMPLE_COLUMNS:
        if name not in have:
            c.execute("ALTER TABLE samples ADD COLUMN %s %s" % (name, typ))
    return c


def cfg_get(c, key, default=""):
    row = c.execute("SELECT value FROM cfg WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    try:
        v = json.loads(row["value"])
    except Exception:
        v = row["value"]
    return default if v is None or v == "" else v


def set_cfg(c, key, value):
    c.execute("INSERT INTO cfg(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              (key, json.dumps(value)))


def settings(c, user_id=None):
    row = c.execute("SELECT * FROM credentials WHERE user_id=?", (user_id,)).fetchone() if user_id else None
    return {
        "user_id": user_id, "client_id": row["client_id"] if row else "",
        "client_secret": row["client_secret"] if row else "",
        "region": row["region"] if row else "eu", "budget": row["budget"] if row else 10,
        "registered_origin": row["registered_origin"] if row else "",
        "registered_key": row["registered_key"] if row else "",
        "registered_at": row["registered_at"] if row else 0,
    }


# Usage belongs to the profile whose developer credentials made the call.
def count(c, kind, user_id=None):
    if user_id:
        c.execute("INSERT INTO user_usage(user_id,day,kind,n) VALUES(?,?,?,1) ON CONFLICT(user_id,day,kind) DO UPDATE SET n=n+1",
                  (user_id, time.strftime("%Y-%m-%d"), kind))


def month_usage(c, user_id=None):
    prefix = time.strftime("%Y-%m") + "-%"
    rows = c.execute("SELECT kind, SUM(n) n FROM user_usage WHERE user_id=? AND day LIKE ? GROUP BY kind", (user_id, prefix)).fetchall()
    return {r["kind"]: r["n"] for r in rows}


def pressure(c, cfg):
    """Slow everything down when the month's budget is nearly used up."""
    allowed = cfg["budget"] / PRICE_PER_REQUEST if cfg["budget"] else 0
    used = sum(month_usage(c, cfg.get("user_id")).values())
    if not allowed:
        return 1
    ratio = used / allowed
    return 4 if ratio >= 1 else 2 if ratio >= 0.8 else 1


# ── The check schedule ──────────────────────────────────────────────────────
def default_schedule():
    return {"base": dict(DEFAULTS), "rules": {k: [] for k in SITUATIONS}, "grace": DEFAULT_GRACE}


def _hhmm(v):
    try:
        h, m = str(v).split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        raise ValueError("bad time")
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("bad time")
    return "%02d:%02d" % (h, m)


def _every(v, allow_pause=True):
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError("bad interval")
    if n == 0 and allow_pause:
        return 0
    if not (MIN_EVERY <= n <= MAX_EVERY):
        raise ValueError("bad interval")
    return n


def clean_schedule(obj):
    """Validate what the browser sends; raises ValueError. Anything left out keeps its default."""
    out = default_schedule()
    if not isinstance(obj, dict):
        raise ValueError("bad schedule")
    base = obj.get("base") or {}
    for k in SITUATIONS:
        if k in base:
            out["base"][k] = _every(base[k], allow_pause=False)
    if "grace" in obj:
        g = int(obj["grace"])
        if not (0 <= g <= 7200):
            raise ValueError("bad grace")
        out["grace"] = g
    rules = obj.get("rules") or {}
    for k in SITUATIONS:
        lst = rules.get(k) or []
        if len(lst) > 12:
            raise ValueError("too many rules")
        for r in lst:
            days = sorted({int(d) for d in (r.get("days") or []) if 0 <= int(d) <= 6})
            if not days:
                raise ValueError("no days")
            out["rules"][k].append({"days": days, "from": _hhmm(r.get("from")), "to": _hhmm(r.get("to")), "every": _every(r.get("every"))})
    return out


def load_schedule(c, user_id):
    row = c.execute("SELECT value FROM prefs WHERE user_id=? AND key='schedule'", (user_id,)).fetchone()
    if not row or not row["value"]:
        return default_schedule()
    try:
        return clean_schedule(json.loads(row["value"]))
    except Exception:
        return default_schedule()


def _minutes(hhmm):
    return int(hhmm[:2]) * 60 + int(hhmm[3:])


def _rule_hit(rule, lt):
    """Is local time `lt` inside the rule's window? A window that crosses midnight belongs to the day it starts on."""
    now_m = lt.tm_hour * 60 + lt.tm_min
    a, b = _minutes(rule["from"]), _minutes(rule["to"])
    if a == b:
        return lt.tm_wday in rule["days"]
    if a < b:
        return lt.tm_wday in rule["days"] and a <= now_m < b
    if now_m >= a:
        return lt.tm_wday in rule["days"]
    return ((lt.tm_wday - 1) % 7) in rule["days"] and now_m < b


def _window_end(ts, rule):
    """The next time the window of this rule closes."""
    b = _minutes(rule["to"])
    lt = time.localtime(ts)
    end = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, b // 60, b % 60, 0, 0, 0, -1))
    if rule["from"] == rule["to"]:
        end = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 0, 0, 0, 0, 0, -1))
    while end <= ts:
        end += 86400
    return int(end)


def delay_for(sched, situation, ts, factor=1):
    """Seconds until the next look in this situation, at this moment."""
    lt = time.localtime(ts)
    for rule in sched["rules"].get(situation, []):
        if _rule_hit(rule, lt):
            if rule["every"] == 0:
                return max(60, _window_end(ts, rule) - ts)
            return max(MIN_EVERY, rule["every"] * factor)
    return max(MIN_EVERY, sched["base"][situation] * factor)


# ── Fleet API ───────────────────────────────────────────────────────────────
class AuthError(Exception):
    pass


def http(method, url, token=None, form=None, timeout=25, payload=None):
    headers = {"User-Agent": "mvmOS-Tesla/0.1"}
    body = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, body, headers, method=method), timeout=timeout)
        raw = r.read().decode() or "{}"
        status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace") or "{}"
        status = e.code
    except Exception as e:
        return 0, {"error": str(e)[:200]}
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, {"error": raw[:200]}


def authorize_url(cfg, state, redirect):
    return REGIONS[cfg["region"]][2] + "/oauth2/v3/authorize?" + urllib.parse.urlencode({
        "client_id": cfg["client_id"], "redirect_uri": redirect, "response_type": "code",
        "scope": SCOPE, "state": state, "locale": "en-US", "prompt": "login"})


def exchange_code(c, cfg, user_id, code, redirect):
    api, auth, _ = REGIONS[cfg["region"]]
    count(c, "auth", cfg.get("user_id"))
    s, r = http("POST", auth + "/oauth2/v3/token", form={
        "grant_type": "authorization_code", "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "code": code, "redirect_uri": redirect, "audience": api})
    if s != 200 or "refresh_token" not in r:
        raise AuthError(str(r.get("error_description") or r.get("error") or s)[:200])
    now = int(time.time())
    c.execute("""INSERT INTO accounts (user_id, access_token, refresh_token, expires_at, connected_at, last_error, last_ok)
                 VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET access_token=excluded.access_token,
                 refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, connected_at=excluded.connected_at,
                 last_error='', refreshing_until=0, backoff_until=0""",
              (user_id, r["access_token"], r["refresh_token"], now + int(r.get("expires_in", 28800)), now, "", now))
    c.commit()


def access_token(c, cfg, acct, force=False):
    """A valid access token. Tesla's refresh tokens are single-use, so the
    refresh itself is guarded by a lease in the database (this file is loaded
    by two processes' worth of code: the routes and the minute tick)."""
    now = int(time.time())
    if not force and acct["access_token"] and acct["expires_at"] - now > 300:
        return acct["access_token"]
    uid = acct["user_id"]
    for _ in range(12):
        got = c.execute("UPDATE accounts SET refreshing_until=? WHERE user_id=? AND refreshing_until<?",
                        (now + 30, uid, now)).rowcount
        c.commit()
        if got:
            break
        time.sleep(1)
        row = c.execute("SELECT * FROM accounts WHERE user_id=?", (uid,)).fetchone()
        if row and row["expires_at"] - int(time.time()) > 300 and not force:
            return row["access_token"]
        now = int(time.time())
    else:
        raise RuntimeError("token refresh is busy")
    try:
        row = c.execute("SELECT * FROM accounts WHERE user_id=?", (uid,)).fetchone()
        if not force and row["expires_at"] - int(time.time()) > 300:
            return row["access_token"]
        api, auth, _ = REGIONS[cfg["region"]]
        count(c, "auth", cfg.get("user_id"))
        s, r = http("POST", auth + "/oauth2/v3/token", form={
            "grant_type": "refresh_token", "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
            "refresh_token": row["refresh_token"]})
        if s == 200 and "access_token" in r:
            c.execute("UPDATE accounts SET access_token=?, refresh_token=?, expires_at=? WHERE user_id=?",
                      (r["access_token"], r.get("refresh_token") or row["refresh_token"],
                       int(time.time()) + int(r.get("expires_in", 28800)), uid))
            c.commit()
            return r["access_token"]
        if s in (400, 401, 403):
            c.execute("UPDATE accounts SET last_error='reauth' WHERE user_id=?", (uid,))
            c.commit()
            raise AuthError("reauth")
        raise RuntimeError("token refresh failed (%s)" % s)
    finally:
        c.execute("UPDATE accounts SET refreshing_until=0 WHERE user_id=?", (uid,))
        c.commit()


def fleet(c, cfg, acct, path, kind):
    """GET on the Fleet API; one retry with a fresh token on 401."""
    api = REGIONS[cfg["region"]][0]
    token = access_token(c, cfg, acct)
    count(c, kind, cfg.get("user_id"))
    c.commit()
    s, r = http("GET", api + path, token=token)
    if s == 401:
        acct = c.execute("SELECT * FROM accounts WHERE user_id=?", (acct["user_id"],)).fetchone()
        token = access_token(c, cfg, acct, force=True)
        count(c, kind, cfg.get("user_id"))
        s, r = http("GET", api + path, token=token)
    return s, r


# ── Helpers ─────────────────────────────────────────────────────────────────
def _f(v, scale=1.0):
    try:
        return None if v is None else float(v) * scale
    except (TypeError, ValueError):
        return None


def _bar(v):
    try:
        return round(float(v), 3) if v is not None else None
    except (TypeError, ValueError):
        return None


def _mask(d, keys):
    """Which of these flags are on, as one number (first key is bit 1, then 2, 4, ...). None if the car did not say."""
    if not any(k in d for k in keys):
        return None
    return sum(1 << i for i, k in enumerate(keys) if d.get(k))


def haversine(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(min(1, math.sqrt(a)))


def set_state(c, vid, state, ts):
    row = c.execute("SELECT id, state FROM states WHERE vehicle=? AND end_ts IS NULL ORDER BY id DESC LIMIT 1", (vid,)).fetchone()
    if row and row["state"] == state:
        return
    if row:
        c.execute("UPDATE states SET end_ts=? WHERE id=?", (ts, row["id"]))
    c.execute("INSERT INTO states (vehicle, start_ts, state) VALUES (?,?,?)", (vid, ts, state))


def get_poll(c, vid):
    row = c.execute("SELECT * FROM poll WHERE vehicle=?", (vid,)).fetchone()
    if not row:
        c.execute("INSERT INTO poll (vehicle) VALUES (?)", (vid,))
        row = c.execute("SELECT * FROM poll WHERE vehicle=?", (vid,)).fetchone()
    return row


def reverse_geocode(table, rid, lat, lng, col):
    """Name a start or end point. Best effort, in the background, one lookup per point."""
    def work():
        try:
            time.sleep(1.2)
            s, r = http("GET", "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=%f&lon=%f" % (lat, lng), timeout=15)
            if s != 200:
                return
            a = r.get("address") or {}
            street = a.get("road") or a.get("pedestrian") or a.get("neighbourhood") or a.get("suburb") or ""
            if a.get("house_number") and a.get("road"):
                street += " " + a["house_number"]
            town = a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or a.get("county") or ""
            text = ", ".join(x for x in (street, town) if x) or (r.get("display_name") or "")[:80]
            if text:
                cc = db()
                cc.execute("UPDATE %s SET %s=? WHERE id=?" % (table, col), (text, rid))
                cc.commit()
                cc.close()
        except Exception:
            pass
    threading.Thread(target=work, daemon=True).start()


# ── Reading one sample ──────────────────────────────────────────────────────
def parse_sample(d):
    ch, cl, dr, vs = d.get("charge_state") or {}, d.get("climate_state") or {}, d.get("drive_state") or {}, d.get("vehicle_state") or {}
    shift = dr.get("shift_state")
    return {
        "battery": ch.get("battery_level"), "usable": ch.get("usable_battery_level"),
        "range_km": _f(ch.get("battery_range"), MI), "odo_km": _f(vs.get("odometer"), MI),
        "lat": _f(dr.get("latitude")), "lng": _f(dr.get("longitude")), "heading": dr.get("heading"),
        "speed": _f(dr.get("speed"), MI), "power": _f(dr.get("power")), "shift": shift,
        "charging_state": ch.get("charging_state"),
        "charger_power": _f(ch.get("charger_power")), "energy_added": _f(ch.get("charge_energy_added")),
        "voltage": _f(ch.get("charger_voltage")), "current": _f(ch.get("charger_actual_current")),
        "dc": 1 if ch.get("fast_charger_present") else 0,
        "inside_temp": _f(cl.get("inside_temp")), "outside_temp": _f(cl.get("outside_temp")),
        "locked": 1 if vs.get("locked") else 0, "sentry": 1 if vs.get("sentry_mode") else 0,
        "climate": 1 if cl.get("is_climate_on") else 0, "charge_limit": ch.get("charge_limit_soc"),
        "user_present": 1 if vs.get("is_user_present") else 0, "version": (vs.get("car_version") or "").split(" ")[0],
        "to_full": ch.get("minutes_to_full_charge"),
        "tpms_fl": _bar(vs.get("tpms_pressure_fl")), "tpms_fr": _bar(vs.get("tpms_pressure_fr")),
        "tpms_rl": _bar(vs.get("tpms_pressure_rl")), "tpms_rr": _bar(vs.get("tpms_pressure_rr")),
        "tpms_soft": _mask(vs, ("tpms_soft_warning_fl", "tpms_soft_warning_fr", "tpms_soft_warning_rl", "tpms_soft_warning_rr")),
        "tpms_hard": _mask(vs, ("tpms_hard_warning_fl", "tpms_hard_warning_fr", "tpms_hard_warning_rl", "tpms_hard_warning_rr")),
        "doors": _mask(vs, ("df", "dr", "pf", "pr", "ft", "rt")),
        "windows": _mask(vs, ("fd_window", "fp_window", "rd_window", "rp_window")),
        "amps": _f(ch.get("charger_actual_current")), "phases": ch.get("charger_phases"),
        "pilot": _f(ch.get("charger_pilot_current")), "cable": ch.get("conn_charge_cable"),
        "rate_kmh": _f(ch.get("charge_rate"), MI), "battery_heater": 1 if cl.get("battery_heater") else 0,
        "ideal_range_km": _f(ch.get("ideal_battery_range"), MI),
        "sw_status": (vs.get("software_update") or {}).get("status"), "sw_version": (vs.get("software_update") or {}).get("version"),
    }


def store_sample(c, v, d, ts, state):
    s = parse_sample(d)
    row = dict(s)
    row["vehicle"], row["ts"], row["state"] = v["id"], ts, state
    row.pop("voltage", None)
    row.pop("current", None)
    row.pop("dc", None)
    cols = {r[1] for r in c.execute("PRAGMA table_info(samples)")}
    row = {k: val for k, val in row.items() if k in cols}
    cur = c.execute("INSERT INTO samples (%s) VALUES (%s)" % (", ".join(row), ", ".join("?" * len(row))), list(row.values()))
    # The whole answer as the car gave it, so nothing is lost and any field can be looked at later.
    clean = {k: val for k, val in d.items() if k not in SECRET_KEYS}
    c.execute("INSERT INTO raw (sample, vehicle, ts, data) VALUES (?,?,?,?)",
              (cur.lastrowid, v["id"], ts, zlib.compress(json.dumps(clean, separators=(",", ":")).encode(), 6)))
    vc = d.get("vehicle_config") or {}
    c.execute("UPDATE vehicles SET odometer=COALESCE(?,odometer), version=COALESCE(NULLIF(?,''),version), model=COALESCE(?,model), "
              "color=COALESCE(?,color), trim=COALESCE(?,trim), wheel=COALESCE(?,wheel) WHERE id=?",
              (s["odo_km"], s["version"], vc.get("car_type"), vc.get("exterior_color"), vc.get("trim_badging"),
               vc.get("wheel_type"), v["id"]))
    return s


def last_sample(c, vid):
    return c.execute("SELECT * FROM samples WHERE vehicle=? ORDER BY ts DESC LIMIT 1", (vid,)).fetchone()


# ── Trips ───────────────────────────────────────────────────────────────────
def trip_update(c, p, v, s, ts, prev):
    driving = s["shift"] in ("D", "R", "N") or (s["speed"] or 0) > 0
    tid = p["trip_id"]
    if driving:
        if s["lat"] is None:
            return False
        if tid is None:
            # The car may have been left alone while parked: its last parked sample is where the trip began.
            o = prev if prev and prev["shift"] not in ("D", "R", "N") and prev["lat"] is not None else None
            c.execute("""INSERT INTO trips (vehicle, start_ts, start_odo, start_batt, start_range, start_lat, start_lng, temp_out, last_pts)
                         VALUES (?,?,?,?,?,?,?,?,?)""",
                      (v["id"], ts, (o["odo_km"] if o and o["odo_km"] is not None else s["odo_km"]),
                       (o["battery"] if o and o["battery"] is not None else s["battery"]),
                       (o["range_km"] if o and o["range_km"] is not None else s["range_km"]),
                       (o["lat"] if o else s["lat"]), (o["lng"] if o else s["lng"]), s["outside_temp"], ts))
            tid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE poll SET trip_id=? WHERE vehicle=?", (tid, v["id"]))
            t = c.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone()
            if o:
                c.execute("INSERT INTO trip_points (trip, ts, lat, lng, speed, power, battery) VALUES (?,?,?,?,?,?,?)",
                          (tid, o["ts"], o["lat"], o["lng"], 0, 0, o["battery"]))
        t = c.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone()
        dt = max(0, min(180, ts - (t["last_pts"] or ts)))
        pw = s["power"] or 0
        lp = t["last_power"] if t["last_power"] is not None else pw
        kwh = t["energy_kwh"] + (pw + lp) / 2 * dt / 3600.0
        c.execute("INSERT INTO trip_points (trip, ts, lat, lng, speed, power, battery) VALUES (?,?,?,?,?,?,?)",
                  (tid, ts, s["lat"], s["lng"], s["speed"], s["power"], s["battery"]))
        dist = (s["odo_km"] - t["start_odo"]) if s["odo_km"] is not None and t["start_odo"] is not None else t["distance_km"]
        c.execute("""UPDATE trips SET end_ts=?, end_odo=?, distance_km=?, energy_kwh=?, end_batt=?, end_range=?, end_lat=?, end_lng=?,
                     max_speed=MAX(max_speed, ?), temp_out=COALESCE(?, temp_out), last_power=?, last_pts=? WHERE id=?""",
                  (ts, s["odo_km"], max(0, dist or 0), kwh, s["battery"], s["range_km"], s["lat"], s["lng"],
                   s["speed"] or 0, s["outside_temp"], pw, ts, tid))
        return True
    if tid is not None:
        close_trip(c, p, tid)
    return False


def close_trip(c, p, tid):
    t = c.execute("SELECT * FROM trips WHERE id=?", (tid,)).fetchone()
    c.execute("UPDATE poll SET trip_id=NULL WHERE vehicle=?", (p["vehicle"],))
    if not t:
        return
    if (t["distance_km"] or 0) < 0.3 and (t["end_ts"] or 0) - (t["start_ts"] or 0) < 120:
        c.execute("DELETE FROM trips WHERE id=?", (tid,))
        c.execute("DELETE FROM trip_points WHERE trip=?", (tid,))
        return
    c.execute("UPDATE trips SET open=0 WHERE id=?", (tid,))
    if t["start_lat"] is not None:
        reverse_geocode("trips", tid, t["start_lat"], t["start_lng"], "start_addr")
    if t["end_lat"] is not None:
        reverse_geocode("trips", tid, t["end_lat"], t["end_lng"], "end_addr")


# ── Charges ─────────────────────────────────────────────────────────────────
def charge_update(c, p, v, s, ts, prev):
    charging = s["charging_state"] in ("Charging", "Starting")
    cid = p["charge_id"]
    if charging:
        if cid is None:
            lat, lng = s["lat"], s["lng"]
            if lat is None and prev is not None:
                lat, lng = prev["lat"], prev["lng"]
            if lat is None:
                row = c.execute("SELECT lat, lng FROM samples WHERE vehicle=? AND lat IS NOT NULL ORDER BY ts DESC LIMIT 1", (v["id"],)).fetchone()
                lat, lng = (row["lat"], row["lng"]) if row else (None, None)
            c.execute("""INSERT INTO charges (vehicle, start_ts, start_batt, start_range, lat, lng, dc, temp_out)
                         VALUES (?,?,?,?,?,?,?,?)""", (v["id"], ts, s["battery"], s["range_km"], lat, lng, s["dc"], s["outside_temp"]))
            cid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            c.execute("UPDATE poll SET charge_id=? WHERE vehicle=?", (cid, v["id"]))
        c.execute("INSERT INTO charge_points (charge, ts, power, battery, voltage, current, energy) VALUES (?,?,?,?,?,?,?)",
                  (cid, ts, s["charger_power"], s["battery"], s["voltage"], s["current"], s["energy_added"]))
        c.execute("""UPDATE charges SET end_ts=?, end_batt=?, end_range=?, kwh=MAX(kwh, COALESCE(?,0)),
                     max_power=MAX(max_power, COALESCE(?,0)), dc=MAX(dc, ?) WHERE id=?""",
                  (ts, s["battery"], s["range_km"], s["energy_added"], s["charger_power"], s["dc"], cid))
        return True
    if cid is not None:
        # The last reading of a session still carries the final energy figure.
        c.execute("""UPDATE charges SET end_ts=?, end_batt=?, end_range=?, kwh=MAX(kwh, COALESCE(?,0)) WHERE id=?""",
                  (ts, s["battery"], s["range_km"], s["energy_added"], cid))
        close_charge(c, p, cid)
    return False


def close_charge(c, p, cid):
    ch = c.execute("SELECT * FROM charges WHERE id=?", (cid,)).fetchone()
    c.execute("UPDATE poll SET charge_id=NULL WHERE vehicle=?", (p["vehicle"],))
    if not ch:
        return
    if (ch["kwh"] or 0) < 0.05 and (ch["end_batt"] or 0) <= (ch["start_batt"] or 0):
        c.execute("DELETE FROM charges WHERE id=?", (cid,))
        c.execute("DELETE FROM charge_points WHERE charge=?", (cid,))
        return
    c.execute("UPDATE charges SET open=0 WHERE id=?", (cid,))
    if ch["lat"] is not None:
        reverse_geocode("charges", cid, ch["lat"], ch["lng"], "addr")


# ── One look at one vehicle ─────────────────────────────────────────────────
def settle(c, p, s, ts, sched, factor, hot_drive, hot_charge):
    """Decide when to ask this car next."""
    vid = p["vehicle"]
    active = hot_drive or hot_charge or s["climate"] or s["user_present"]
    last_act = ts if active else p["last_activity"]
    check = 0
    if hot_drive:
        mode, wait = "drive", delay_for(sched, "drive", ts, factor)
    elif hot_charge:
        fast = (s["charger_power"] or 0) >= DC_KW or s["dc"]
        mode, wait = "charge", delay_for(sched, "charge_dc" if fast else "charge_ac", ts, factor)
    elif ts - last_act < sched["grace"]:
        mode, wait = "idle", delay_for(sched, "idle", ts, factor)
    else:
        mode, wait = "suspend", delay_for(sched, "parked", ts, factor)
        check = delay_for(sched, "parked_check", ts, factor)
    c.execute("UPDATE poll SET mode=?, next_data=?, next_check=?, last_activity=?, last_sample=?, last_state=? WHERE vehicle=?",
              (mode, ts + wait - (2 if wait >= 20 else 0), ts + check if check else 0, last_act, ts, "online", vid))
    return mode


def sample_vehicle(c, cfg, acct, v, factor):
    vid = v["id"]
    now = int(time.time())
    p = get_poll(c, vid)
    # A short lease so that overlapping ticks never read the same car twice.
    if not c.execute("UPDATE poll SET busy_until=? WHERE vehicle=? AND busy_until<?", (now + 40, vid, now)).rowcount:
        return None
    c.commit()
    try:
        sched = load_schedule(c, acct["user_id"])
        full = cfg_get(c, "endpoints_mode", "full") != "base"
        s, r = fleet(c, cfg, acct, "/api/1/vehicles/%s/vehicle_data?endpoints=%s" % (vid, urllib.parse.quote(ENDPOINTS if full else ENDPOINTS_BASE)), "data")
        if full and s in (400, 403, 422):
            # The car or the account does not offer every section: fall back to the basic set and remember it.
            s, r = fleet(c, cfg, acct, "/api/1/vehicles/%s/vehicle_data?endpoints=%s" % (vid, urllib.parse.quote(ENDPOINTS_BASE)), "data")
            if s == 200:
                c.execute("INSERT OR REPLACE INTO cfg (key, value) VALUES ('endpoints_mode', ?)", (json.dumps("base"),))
        ts = int(time.time())
        p = get_poll(c, vid)
        if s == 200 and isinstance(r.get("response"), dict):
            d = r["response"]
            prev = last_sample(c, vid)
            sm = store_sample(c, v, d, ts, "online")
            hot_drive = trip_update(c, p, v, sm, ts, prev)
            p = get_poll(c, vid)
            hot_charge = charge_update(c, p, v, sm, ts, prev)
            p = get_poll(c, vid)
            set_state(c, vid, "driving" if hot_drive else "charging" if hot_charge else "online", ts)
            mode = settle(c, p, sm, ts, sched, factor, hot_drive, hot_charge)
            c.execute("UPDATE accounts SET last_ok=?, last_error='' WHERE user_id=?", (ts, acct["user_id"]))
            c.commit()
            return mode
        if s == 408:
            go_asleep(c, p, vid, ts, "asleep", sched)
        elif s == 429:
            c.execute("UPDATE accounts SET backoff_until=? WHERE user_id=?", (ts + 120, acct["user_id"]))
            c.execute("UPDATE poll SET next_data=? WHERE vehicle=?", (ts + 120, vid))
        else:
            c.execute("UPDATE accounts SET last_error=? WHERE user_id=?", ("tesla %s" % s, acct["user_id"]))
            c.execute("UPDATE poll SET next_data=? WHERE vehicle=?", (ts + 120, vid))
        c.commit()
        return None
    finally:
        c.execute("UPDATE poll SET busy_until=0 WHERE vehicle=?", (vid,))
        c.commit()


def go_asleep(c, p, vid, ts, state, sched):
    if p["trip_id"] is not None:
        close_trip(c, p, p["trip_id"])
    if p["charge_id"] is not None:
        close_charge(c, p, p["charge_id"])
    set_state(c, vid, state, ts)
    c.execute("UPDATE poll SET mode=?, next_check=?, next_data=?, last_state=? WHERE vehicle=?",
              ("asleep", ts + delay_for(sched, "asleep", ts), 0, state, vid))


def refresh_list(c, cfg, acct, factor):
    s, r = fleet(c, cfg, acct, "/api/1/vehicles", "list")
    ts = int(time.time())
    if s != 200 or not isinstance(r.get("response"), list):
        if s == 429:
            c.execute("UPDATE accounts SET backoff_until=? WHERE user_id=?", (ts + 120, acct["user_id"]))
        elif s != 0:
            c.execute("UPDATE accounts SET last_error=? WHERE user_id=?", ("tesla %s" % s, acct["user_id"]))
        c.commit()
        return {}
    sched = load_schedule(c, acct["user_id"])
    states = {}
    for x in r["response"]:
        vid = str(x.get("id"))
        owner = c.execute("SELECT user_id FROM vehicles WHERE id=?", (vid,)).fetchone()
        if owner and owner['user_id'] != acct['user_id']:
            continue
        states[vid] = x.get("state") or "offline"
        c.execute("""INSERT INTO vehicles (id, user_id, vin, name, created) VALUES (?,?,?,?,?)
                     ON CONFLICT(id) DO UPDATE SET vin=excluded.vin, name=COALESCE(NULLIF(excluded.name,''), vehicles.name)""",
                  (vid, acct["user_id"], x.get("vin"), x.get("display_name") or "", ts))
        p = get_poll(c, vid)
        if states[vid] != "online":
            if p["last_state"] != states[vid] or p["mode"] != "asleep":
                go_asleep(c, p, vid, ts, states[vid], sched)
            else:
                c.execute("UPDATE poll SET next_check=? WHERE vehicle=?", (ts + delay_for(sched, "asleep", ts, factor), vid))
        else:
            if p["last_state"] != "online" or p["mode"] == "asleep":
                # It has just woken up (someone is using it): look at once.
                c.execute("UPDATE poll SET mode='idle', next_data=0, last_state='online', last_activity=? WHERE vehicle=?", (ts, vid))
            elif p["mode"] == "suspend":
                c.execute("UPDATE poll SET next_check=? WHERE vehicle=?", (ts + delay_for(sched, "parked_check", ts, factor), vid))
    c.commit()
    return states


def poll_account(c, cfg, acct, now):
    if acct["last_error"] == "reauth" or acct["backoff_until"] > now:
        return False
    factor = pressure(c, cfg)
    vehicles = c.execute("SELECT * FROM vehicles WHERE user_id=?", (acct["user_id"],)).fetchall()
    fast = None
    need_list = not vehicles
    for v in vehicles:
        p = get_poll(c, v["id"])
        if p["mode"] in ("drive", "charge"):
            continue
        if now >= p["next_check"] and p["mode"] in ("asleep", "suspend"):
            need_list = True
        if p["mode"] == "idle" and p["last_state"] != "online":
            need_list = True
    if need_list:
        refresh_list(c, cfg, acct, factor)
        vehicles = c.execute("SELECT * FROM vehicles WHERE user_id=?", (acct["user_id"],)).fetchall()
    for v in vehicles:
        p = get_poll(c, v["id"])
        if p["mode"] == "asleep" or p["last_state"] not in ("online",):
            continue
        if now >= p["next_data"]:
            mode = sample_vehicle(c, cfg, acct, v, factor)
            if mode == "drive":
                wait = get_poll(c, v["id"])["next_data"] + 2 - int(time.time())
                fast = wait if fast is None else min(fast, wait)
    return fast


def tick():
    """One pass over every connected account. While a car is being driven, returns the seconds until it is due again (else None)."""
    c = db()
    try:
        fast = None
        for acct in c.execute("SELECT * FROM accounts").fetchall():
            cfg = settings(c, acct["user_id"])
            if not cfg["client_id"] or not cfg["client_secret"]:
                continue
            try:
                w = poll_account(c, cfg, acct, int(time.time()))
                if w is not None:
                    fast = w if fast is None else min(fast, w)
            except AuthError:
                pass
            except Exception as e:
                c.execute("UPDATE accounts SET last_error=? WHERE user_id=?", (str(e)[:200], acct["user_id"]))
                c.commit()
        # Clean up leftover sign-in attempts.
        c.execute("DELETE FROM oauth_states WHERE created<?", (int(time.time()) - 900,))
        c.commit()
        return fast
    finally:
        c.close()
