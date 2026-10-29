"""
mvmOS Tesla — routes. Mounted at /pub/tesla. Identity is the Apps Hub token
(X-Pub-Token), used identically by the desktop window and the public page.

The data itself is collected by scheduler.py/engine.py; these routes sign an
account in to the Tesla Fleet API and read the collected history. Everything is
metric here, the browser converts to miles or Fahrenheit if the user wants.
"""
import importlib.util
import json
import os
import secrets
import sys
import time
import urllib.parse
import uuid
import zlib
from typing import Optional

from fastapi import APIRouter, Depends, Header, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel

router = APIRouter()

APP_ID = "tesla"
_DIR = os.path.dirname(os.path.abspath(__file__))
_PUBLIC_DIR = os.path.join(_DIR, "public")

_spec = importlib.util.spec_from_file_location("_tesla_engine_api", os.path.join(_DIR, "engine.py"))
eng = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(eng)
_spec_j = importlib.util.spec_from_file_location("_tesla_journeys_api", os.path.join(_DIR, "journeys.py"))
journey_data = importlib.util.module_from_spec(_spec_j)
_spec_j.loader.exec_module(journey_data)
_spec_b = importlib.util.spec_from_file_location("_tesla_billing_api", os.path.join(_DIR, "billing.py"))
billing = importlib.util.module_from_spec(_spec_b)
_spec_b.loader.exec_module(billing)

_spec_o = importlib.util.spec_from_file_location("_tesla_onboarding_api", os.path.join(_DIR, "onboarding.py"))
onboarding = importlib.util.module_from_spec(_spec_o)
_spec_o.loader.exec_module(onboarding)
_spec_s = importlib.util.spec_from_file_location("_tesla_sharing_api", os.path.join(_DIR, "sharing.py"))
sharing = importlib.util.module_from_spec(_spec_s)
_spec_s.loader.exec_module(sharing)



def _billing_prefs(c, me):
    prefs = _prefs(c, me)
    try:
        currency = sys.modules["backend.platform_api"].get_settings().get("currency", "EUR")
    except Exception:
        currency = "EUR"
    prefs["_billing"] = billing.Billing(c, me["id"], prefs.copy(), _places(c, me), _near, currency)
    return prefs




def _hub():
    return sys.modules.get("backend.apphub")


def _me(token):
    hub = _hub()
    if not hub or not token:
        return None
    return hub.get_pub_session(token)


def _bad(msg, status=400):
    return JSONResponse({"error": msg}, status_code=status)


def _gate(token):
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return None, _bad("private", 403)
    actor = _me(token)
    if not actor:
        return None, _bad("unauthorized", 401)
    with eng.db() as c:
        access = sharing.access(c, actor["id"])
    if not access:
        return None, _bad("not_found", 404)
    me = dict(actor)
    me.update(id=access["owner_id"], actor_id=access["actor_id"], role=access["role"])
    return me, None


def _access_guard(request: Request, x_pub_token: Optional[str] = Header(default=None)):
    path = request.scope['route'].path.removeprefix('/pub/tesla')
    if path in ('/', '/callback'):
        return
    me, error = _gate(x_pub_token)
    if error:
        raise HTTPException(error.status_code, 'not_found' if error.status_code == 404 else 'unauthorized')
    if me['role'] == 'view' and (request.method not in ('GET','HEAD','OPTIONS') or path == '/schedule'):
        raise HTTPException(403, 'view_only')
    owner_routes = ('/credentials','/register','/connect','/disconnect','/shares')
    if me['role'] != 'owner' and any(path == p or path.startswith(p + '/') for p in owner_routes):
        raise HTTPException(403, 'owner_only')



def _vehicle(c, me, vid):
    return c.execute("SELECT * FROM vehicles WHERE id=? AND user_id=?", (vid, me["id"])).fetchone()


def _rows(rows):
    return [dict(r) for r in rows]


def _places(c, me):
    return c.execute("SELECT * FROM places WHERE user_id=?", (me["id"],)).fetchall()


def _prefs(c, me):
    out = {"default_ac_price": None, "default_dc_price": None}
    for r in c.execute("SELECT key, value FROM prefs WHERE user_id=?", (me["id"],)).fetchall():
        try:
            out[r["key"]] = float(r["value"]) if r["value"] not in (None, "") else None
        except ValueError:
            pass
    return out


def _near(places, lat, lng):
    if lat is None or lng is None:
        return None
    best, bd = None, None
    for p in places:
        d = eng.haversine(lat, lng, p["lat"], p["lng"])
        if d <= (p["radius"] or 100) and (bd is None or d < bd):
            best, bd = p, d
    return best


def _charge_out(ch, places, prefs):
    d = dict(ch)
    pl = _near(places, ch["lat"], ch["lng"])
    price = None
    if pl:
        price = pl["dc_price"] if ch["dc"] else pl["ac_price"]
    if price is None:
        price = prefs["default_dc_price"] if ch["dc"] else prefs["default_ac_price"]
    d["place"] = pl["name"] if pl else ""
    d["place_id"] = pl["id"] if pl else None
    d["price"] = price
    d["cost"] = round((ch["kwh"] or 0) * price, 2) if price is not None and ch["kwh"] is not None else None
    d["added_pct"] = (ch["end_batt"] or 0) - (ch["start_batt"] or 0)
    return prefs["_billing"].decorate(d) if "_billing" in prefs else d


def _trip_out(t, places):
    d = dict(t)
    for side in ("start", "end"):
        pl = _near(places, t[side + "_lat"], t[side + "_lng"])
        d[side + "_place"] = pl["name"] if pl else ""
    secs = (t["end_ts"] or 0) - (t["start_ts"] or 0)
    d["duration"] = max(0, secs)
    d["avg_speed"] = round(t["distance_km"] / (secs / 3600), 1) if secs > 60 and t["distance_km"] else 0
    d["wh_km"] = round(t["energy_kwh"] * 1000 / t["distance_km"]) if t["distance_km"] and t["distance_km"] > 0.5 and t["energy_kwh"] is not None and t["energy_kwh"] > 0 else None
    d.pop("last_power", None)
    d.pop("last_pts", None)
    return d


def _day_start(ts=None):
    lt = time.localtime(ts or time.time())
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 0, 0, 0, 0, 0, -1)))


def _next_day(ts):
    """The next local midnight (a day is 23 or 25 hours long when the clocks change)."""
    lt = time.localtime(ts)
    return int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday + 1, 0, 0, 0, 0, 0, -1)))


router.dependencies.append(Depends(_access_guard))


# ── Pages ───────────────────────────────────────────────────────────────────
@router.get("/")
def public_index(request: Request, x_pub_token: Optional[str] = Header(default=None)):
    token = x_pub_token or request.cookies.get('apphub_token')
    me, error = _gate(token)
    if error:
        if error.status_code == 401:
            return RedirectResponse('/pub/apphub/', status_code=303)
        return Response(status_code=404)
    return FileResponse(os.path.join(_PUBLIC_DIR, "index.html"))


# ── Connection ──────────────────────────────────────────────────────────────
@router.get("/status")
def status(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        cfg = eng.settings(c, me["id"])
        acct = c.execute("SELECT * FROM accounts WHERE user_id=?", (me["id"],)).fetchone()
        vehicles = c.execute("SELECT * FROM vehicles WHERE user_id=? ORDER BY created", (me["id"],)).fetchall()
        use = eng.month_usage(c, me["id"])
        calls = sum(use.values())
        allowed = int(cfg["budget"] / eng.PRICE_PER_REQUEST) if cfg["budget"] else 0
        personal = me['role'] == 'owner'
        setup = onboarding.credential_info(c, me["id"]) if personal else {
            'can_configure':False, 'server_ready':True, 'ready':False, 'client_id':'', 'has_secret':False}
        out = {
            "access": {"role":me['role'], "is_owner":personal},
            "configured": bool(cfg["client_id"] and cfg["client_secret"]),
            "setup": setup,
            "connected": bool(acct and acct["last_error"] != "reauth"),
            "reauth": bool(acct and acct["last_error"] == "reauth"),
            "error": acct["last_error"] if acct and acct["last_error"] not in ("", "reauth") else "",
            "last_ok": acct["last_ok"] if acct else 0,
            "vehicles": [{"id": v["id"], "name": v["name"], "model": v["model"], "color": v["color"], "trim": v["trim"], "vin": v["vin"]} for v in vehicles],
            "usage": {"calls": calls if personal else 0, "by_kind": use if personal else {}, "allowed": allowed if personal else 0,
                      "cost": round(calls * eng.PRICE_PER_REQUEST, 2) if personal else 0, "budget": cfg["budget"] if personal else 0},
            "now": int(time.time()),
        }
    return JSONResponse(out)


class ShareBody(BaseModel):
    user_id: str
    role: str = 'view'


@router.get('/shares')
def list_shares(x_pub_token: Optional[str] = Header(default=None)):
    me, error = _gate(x_pub_token)
    if error:return error
    hub = _hub()
    with eng.db() as c:
        rows = _rows(c.execute('SELECT user_id,role,created_ts FROM shares WHERE owner_id=? ORDER BY created_ts',(me['id'],)).fetchall())
    people = {u['id']:u for u in hub.get_users_by_ids([r['user_id'] for r in rows])} if rows else {}
    for row in rows:
        person=people.get(row['user_id'],{})
        row.update(username=person.get('username',''),display_name=person.get('display_name',''))
    favourites = [{k:u.get(k,'') for k in ('id','username','display_name')} for u in hub.get_favourites(me['actor_id']) if u['id'] != me['id']]
    return JSONResponse({'shares':rows,'people':favourites})


@router.put('/shares')
def put_share(body: ShareBody, x_pub_token: Optional[str] = Header(default=None)):
    me, error = _gate(x_pub_token)
    if error:return error
    favourites = {u['id'] for u in _hub().get_favourites(me['actor_id'])}
    # Existing shares can still have their role changed after unfavouriting.
    with eng.db() as c:
        exists=c.execute('SELECT 1 FROM shares WHERE owner_id=? AND user_id=?',(me['id'],body.user_id)).fetchone()
        if body.user_id not in favourites and not exists:
            return _bad('invalid_share',400)
        try:sharing.grant(c,me['id'],body.user_id,body.role)
        except ValueError:return _bad('invalid_share',400)
    return JSONResponse({'ok':True})


@router.delete('/shares/{user_id}')
def delete_share(user_id: str, x_pub_token: Optional[str] = Header(default=None)):
    me, error = _gate(x_pub_token)
    if error:return error
    with eng.db() as c:
        c.execute('DELETE FROM shares WHERE owner_id=? AND user_id=?',(me['id'],user_id));c.commit()
    return JSONResponse({'ok':True})


class CredentialBody(BaseModel):
    client_id: str
    client_secret: str = ""
    region: str = "eu"
    budget: float = 10


@router.put("/credentials")
def save_credentials(body: CredentialBody, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        try:
            return JSONResponse(onboarding.save_credentials(c, me["id"], body.client_id, body.client_secret, body.region, body.budget))
        except onboarding.SetupError as e:
            return _bad(str(e), 409)


@router.post("/register")
def register_integration(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        try:
            return JSONResponse(onboarding.register(c, me["id"]))
        except onboarding.SetupError as e:
            return _bad(str(e), 409)


@router.get("/connect")
def connect(request: Request, origin: str = "", x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    parsed = urllib.parse.urlparse(origin)
    host = request.headers.get("host", "")
    if parsed.scheme not in ("http", "https") or parsed.netloc != host:
        return _bad("bad_origin")
    with eng.db() as c:
        cfg = eng.settings(c, me["id"])
        if not cfg["client_id"] or not cfg["client_secret"]:
            return _bad("not_configured")
        if not onboarding.ready(c, me["id"]):
            return _bad("server_required", 409)
        public = onboarding.server_state(c)["origin"]
        if origin.rstrip('/') != public:
            return _bad("public_origin_required", 409)
        state = secrets.token_urlsafe(24)
        redirect = public + "/pub/tesla/callback"
        c.execute("INSERT INTO oauth_states (state, user_id, created, origin) VALUES (?,?,?,?)",
                  (state, me["id"], int(time.time()), redirect))
        c.commit()
        return JSONResponse({"url": eng.authorize_url(cfg, state, redirect), "redirect": redirect})


@router.get("/callback")
def callback(code: str = "", state: str = "", error: str = ""):
    """Tesla sends the browser back here. The signed-in profile is found by the
    one-time state that /connect created, so no token is needed on this route."""
    hub = _hub()
    if hub and not hub.is_app_public(APP_ID):
        return hub.private_page("Tesla", "🚗")
    with eng.db() as c:
        row = c.execute("SELECT * FROM oauth_states WHERE state=?", (state,)).fetchone() if state else None
        if row:
            c.execute("DELETE FROM oauth_states WHERE state=?", (state,))
            c.commit()
        if not row or int(time.time()) - row["created"] > 900:
            return RedirectResponse("/pub/tesla/?connect_error=state", status_code=303)
        if error or not code:
            return RedirectResponse("/pub/tesla/?connect_error=denied", status_code=303)
        cfg = eng.settings(c, row["user_id"])
        if not onboarding.ready(c, row["user_id"]) or row["origin"] != onboarding.server_state(c)["callback"]:
            return RedirectResponse("/pub/tesla/?connect_error=state", status_code=303)
        try:
            eng.exchange_code(c, cfg, row["user_id"], code, row["origin"])
        except Exception:
            return RedirectResponse("/pub/tesla/?connect_error=token", status_code=303)
    try:
        eng.tick()
    except Exception:
        pass
    return RedirectResponse("/pub/tesla/?connected=1", status_code=303)


@router.post("/disconnect")
def disconnect(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        c.execute("DELETE FROM accounts WHERE user_id=?", (me["id"],))
        c.commit()
    return JSONResponse({"ok": True})


# ── Now ─────────────────────────────────────────────────────────────────────
@router.get("/v/{vid}/now")
def now(vid: str, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        v = _vehicle(c, me, vid)
        if not v:
            return _bad("not_found", 404)
        places = _places(c, me)
        prefs = _billing_prefs(c, me)
        p = c.execute("SELECT * FROM poll WHERE vehicle=?", (vid,)).fetchone()
        s = eng.last_sample(c, vid)
        st = c.execute("SELECT * FROM states WHERE vehicle=? AND end_ts IS NULL ORDER BY id DESC LIMIT 1", (vid,)).fetchone()
        d0 = _day_start()
        today = c.execute("SELECT COUNT(*) n, COALESCE(SUM(distance_km),0) km, COALESCE(SUM(energy_kwh),0) kwh FROM trips WHERE vehicle=? AND start_ts>=?", (vid, d0)).fetchone()
        tch = c.execute("SELECT * FROM charges WHERE vehicle=? AND start_ts>=?", (vid, d0)).fetchall()
        open_trip = c.execute("SELECT * FROM trips WHERE vehicle=? AND open=1 ORDER BY id DESC LIMIT 1", (vid,)).fetchone()
        open_charge = c.execute("SELECT * FROM charges WHERE vehicle=? AND open=1 ORDER BY id DESC LIMIT 1", (vid,)).fetchone()
        last_trip = c.execute("SELECT * FROM trips WHERE vehicle=? AND open=0 ORDER BY start_ts DESC LIMIT 1", (vid,)).fetchone()
        last_charge = c.execute("SELECT * FROM charges WHERE vehicle=? AND open=0 ORDER BY start_ts DESC LIMIT 1", (vid,)).fetchone()
        cp = None
        if open_charge:
            cp = c.execute("SELECT ts, power, battery FROM charge_points WHERE charge=? ORDER BY ts DESC LIMIT 1", (open_charge["id"],)).fetchone()
        where = _near(places, s["lat"], s["lng"]) if s else None
        out = {
            "vehicle": {"id": v["id"], "name": v["name"], "model": v["model"], "color": v["color"], "trim": v["trim"],
                        "wheel": v["wheel"], "version": v["version"], "odometer": v["odometer"], "vin": v["vin"]},
            "sample": dict(s) if s else None,
            "state": st["state"] if st else "unknown",
            "since": st["start_ts"] if st else None,
            "mode": p["mode"] if p else "",
            "next_data": p["next_data"] if p else 0,
            "place": where["name"] if where else "",
            "today": {"trips": today["n"], "km": today["km"], "kwh": today["kwh"],
                      "charged_kwh": sum(x["kwh"] or 0 for x in tch)},
            "trip": _trip_out(open_trip, places) if open_trip else None,
            "charge": _charge_out(open_charge, places, prefs) if open_charge else None,
            "charge_power": cp["power"] if cp else None,
            "last_trip": _trip_out(last_trip, places) if last_trip else None,
            "last_charge": _charge_out(last_charge, places, prefs) if last_charge else None,
            "now": int(time.time()),
        }
    return JSONResponse(out)


# ── Trips ───────────────────────────────────────────────────────────────────
@router.get("/v/{vid}/trips")
def trips(vid: str, offset: int = 0, limit: int = 40, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        places = _places(c, me)
        rows = c.execute("SELECT * FROM trips WHERE vehicle=? AND open=0 ORDER BY start_ts DESC LIMIT ? OFFSET ?",
                         (vid, max(1, min(limit, 200)), max(0, offset))).fetchall()
        total = c.execute("SELECT COUNT(*) FROM trips WHERE vehicle=? AND open=0", (vid,)).fetchone()[0]
    return JSONResponse({"trips": [_trip_out(r, places) for r in rows], "total": total})


@router.get("/v/{vid}/trips/{tid}")
def trip(vid: str, tid: int, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        t = c.execute("SELECT * FROM trips WHERE id=? AND vehicle=?", (tid, vid)).fetchone()
        if not t:
            return _bad("not_found", 404)
        pts = c.execute("SELECT ts, lat, lng, speed, power, battery FROM trip_points WHERE trip=? ORDER BY ts", (tid,)).fetchall()
        places, prefs = _places(c, me), _billing_prefs(c, me)
        out = _trip_out(t, places)
        out["analysis"] = journey_data.report(c, vid, t["start_ts"], t["end_ts"] or int(time.time()),
            lambda r: _trip_out(r, places), lambda r: _charge_out(r, places, prefs), only_trip=tid)
    out["points"] = [list(r) for r in pts]
    return JSONResponse(out)


# ── Charges ─────────────────────────────────────────────────────────────────
@router.get("/v/{vid}/charges")
def charges(vid: str, offset: int = 0, limit: int = 40, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        places, prefs = _places(c, me), _billing_prefs(c, me)
        rows = c.execute("SELECT * FROM charges WHERE vehicle=? AND open=0 ORDER BY start_ts DESC LIMIT ? OFFSET ?",
                         (vid, max(1, min(limit, 200)), max(0, offset))).fetchall()
        total = c.execute("SELECT COUNT(*) FROM charges WHERE vehicle=? AND open=0", (vid,)).fetchone()[0]
    return JSONResponse({"charges": [_charge_out(r, places, prefs) for r in rows], "total": total})


@router.get("/v/{vid}/charges/{cid}")
def charge(vid: str, cid: int, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        ch = c.execute("SELECT * FROM charges WHERE id=? AND vehicle=?", (cid, vid)).fetchone()
        if not ch:
            return _bad("not_found", 404)
        pts = c.execute("SELECT ts, power, battery, voltage, current, energy FROM charge_points WHERE charge=? ORDER BY ts", (cid,)).fetchall()
        out = _charge_out(ch, _places(c, me), _billing_prefs(c, me))
    out["points"] = [list(r) for r in pts]
    return JSONResponse(out)


# ── Statistics ──────────────────────────────────────────────────────────────
@router.get("/v/{vid}/stats")
def stats(vid: str, group: str = "day", days: int = 30, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    fmt = "%Y-%m" if group == "month" else "%Y-%m-%d"
    since = int(time.time()) - max(1, min(days, 3660)) * 86400
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        places, prefs = _places(c, me), _billing_prefs(c, me)
        buckets = {}

        def b(k):
            return buckets.setdefault(k, {"key": k, "trips": 0, "km": 0.0, "drive_kwh": 0.0, "charges": 0,
                                          "charged_kwh": 0.0, "cost": 0.0, "priced_kwh": 0.0, "cost_totals": {}, "unpriced_sessions": 0})
        for r in c.execute("""SELECT strftime(?, start_ts,'unixepoch','localtime') k, COUNT(*) n, SUM(distance_km) km, SUM(energy_kwh) kwh
                              FROM trips WHERE vehicle=? AND open=0 AND start_ts>=? GROUP BY k""", (fmt, vid, since)).fetchall():
            x = b(r["k"])
            x["trips"], x["km"], x["drive_kwh"] = r["n"], r["km"] or 0, r["kwh"] or 0
        for r in c.execute("SELECT * FROM charges WHERE vehicle=? AND open=0 AND start_ts>=?", (vid, since)).fetchall():
            o = _charge_out(r, places, prefs)
            k = time.strftime(fmt, time.localtime(r["start_ts"]))
            x = b(k)
            x["charges"] += 1
            x["charged_kwh"] += r["kwh"] or 0
            if not o["cost_complete"]: x["unpriced_sessions"] += 1
            x["priced_kwh"] += max(0,(o.get("billing_kwh") or 0)-(o.get("unpriced_kwh") or 0))
            for cell in o["cost_totals"]:
                x["cost_totals"][cell["currency"]]=x["cost_totals"].get(cell["currency"],0)+cell["cost"]
            x["cost"]=next(iter(x["cost_totals"].values())) if len(x["cost_totals"])==1 else None
        rows = [buckets[k] for k in sorted(buckets)]
        eff = c.execute("""SELECT temp_out t, distance_km km, energy_kwh kwh FROM trips
                           WHERE vehicle=? AND open=0 AND start_ts>=? AND distance_km>=3 AND energy_kwh>0 AND temp_out IS NOT NULL""",
                        (vid, since)).fetchall()
    return JSONResponse({"rows": rows, "efficiency": [{"t": r["t"], "wh_km": round(r["kwh"] * 1000 / r["km"])} for r in eff]})


# ── Battery health and sleep ────────────────────────────────────────────────
@router.get("/v/{vid}/battery")
def battery(vid: str, days: int = 120, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    since = int(time.time()) - max(7, min(days, 3660)) * 86400
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        rows = c.execute("""SELECT ts, battery, range_km, lat, lng, shift, charging_state FROM samples
                            WHERE vehicle=? AND ts>=? AND battery IS NOT NULL ORDER BY ts""", (vid, since)).fetchall()
        states = c.execute("SELECT * FROM states WHERE vehicle=? AND COALESCE(end_ts, ?)>=? ORDER BY start_ts",
                           (vid, int(time.time()), since)).fetchall()
    # Range at 100%, one value per day (the median), from readings with enough charge to be meaningful.
    per_day = {}
    for r in rows:
        if r["range_km"] and r["battery"] and r["battery"] >= 40:
            per_day.setdefault(time.strftime("%Y-%m-%d", time.localtime(r["ts"])), []).append(r["range_km"] * 100.0 / r["battery"])
    series = []
    for k in sorted(per_day):
        vals = sorted(per_day[k])
        series.append({"day": k, "full_km": round(vals[len(vals) // 2], 1)})
    # Losses while parked: two parked readings at the same spot with no charge between them.
    drain = []

    def parked(r):
        return r["shift"] in (None, "P") and r["charging_state"] not in ("Charging", "Starting")
    prev = None
    for r in rows:
        if prev is not None and parked(prev) and parked(r) and prev["lat"] is not None and r["lat"] is not None:
            hours = (r["ts"] - prev["ts"]) / 3600.0
            if 2 <= hours <= 72 and eng.haversine(prev["lat"], prev["lng"], r["lat"], r["lng"]) < 150 and r["battery"] <= prev["battery"]:
                drain.append({"start": prev["ts"], "end": r["ts"], "hours": round(hours, 1),
                              "lost_pct": prev["battery"] - r["battery"],
                              "lost_km": round(max(0, (prev["range_km"] or 0) - (r["range_km"] or 0)), 1)})
        prev = r
    sleep = {}
    now_ts = int(time.time())
    for s in states:
        a, e = max(s["start_ts"], since), s["end_ts"] or now_ts
        while a < e:
            day = time.strftime("%Y-%m-%d", time.localtime(a))
            nxt = max(a + 1, min(e, _next_day(a)))
            d = sleep.setdefault(day, {"day": day, "asleep": 0, "online": 0, "driving": 0, "charging": 0, "offline": 0})
            d[s["state"] if s["state"] in d else "online"] += nxt - a
            a = nxt
    return JSONResponse({"series": series, "drain": drain[-60:], "sleep": [sleep[k] for k in sorted(sleep)]})


@router.get("/v/{vid}/timeline")
def timeline(vid: str, hours: int = 48, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    now_ts = int(time.time())
    since = now_ts - max(1, min(hours, 24 * 30)) * 3600
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        rows = c.execute("SELECT start_ts, end_ts, state FROM states WHERE vehicle=? AND COALESCE(end_ts, ?)>=? ORDER BY start_ts",
                         (vid, now_ts, since)).fetchall()
    return JSONResponse({"since": since, "now": now_ts, "rows": [
        {"start": max(r["start_ts"], since), "end": r["end_ts"] or now_ts, "state": r["state"]} for r in rows]})


@router.get("/v/{vid}/states")
def states(vid: str, hours: int = 24, offset: int = 0, limit: int = 100, x_pub_token: Optional[str] = Header(default=None)):
    """Every state the car was in, newest first: what, from when until when, and where."""
    me, err = _gate(x_pub_token)
    if err:
        return err
    now_ts = int(time.time())
    since = now_ts - max(1, min(hours, 24 * 90)) * 3600
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        places = _places(c, me)
        window = c.execute("SELECT start_ts, end_ts, state FROM states WHERE vehicle=? AND COALESCE(end_ts, ?)>=?",
                           (vid, now_ts, since)).fetchall()
        totals = {}
        for r in window:
            secs = (r["end_ts"] or now_ts) - max(r["start_ts"], since)
            totals[r["state"]] = totals.get(r["state"], 0) + max(0, secs)
        rows = c.execute("""SELECT * FROM states WHERE vehicle=? AND COALESCE(end_ts, ?)>=? ORDER BY start_ts DESC LIMIT ? OFFSET ?""",
                         (vid, now_ts, since, max(1, min(limit, 300)), max(0, offset))).fetchall()
        out = []
        for r in rows:
            a = c.execute("SELECT battery, lat, lng FROM samples WHERE vehicle=? AND ts<=? ORDER BY ts DESC LIMIT 1", (vid, r["start_ts"] + 120)).fetchone()
            e = c.execute("SELECT battery FROM samples WHERE vehicle=? AND ts<=? ORDER BY ts DESC LIMIT 1", (vid, (r["end_ts"] or now_ts) + 120)).fetchone()
            pl = _near(places, a["lat"], a["lng"]) if a else None
            out.append({"state": r["state"], "start": r["start_ts"], "end": r["end_ts"],
                        "batt_start": a["battery"] if a else None, "batt_end": e["battery"] if e else None,
                        "place": pl["name"] if pl else ""})
    return JSONResponse({"states": out, "totals": totals, "since": since, "now": now_ts, "total": len(window)})


# ── The car itself: everything it reports ───────────────────────────────────
def _raw_row(c, vid, ts=None):
    if ts is None:
        return c.execute("SELECT ts, data FROM raw WHERE vehicle=? ORDER BY ts DESC LIMIT 1", (vid,)).fetchone()
    return c.execute("SELECT ts, data FROM raw WHERE vehicle=? AND ts<=? ORDER BY ts DESC LIMIT 1", (vid, ts)).fetchone()


def _unpack(blob):
    try:
        return json.loads(zlib.decompress(blob).decode())
    except Exception:
        return {}


@router.get("/v/{vid}/car")
def car(vid: str, x_pub_token: Optional[str] = Header(default=None)):
    """The latest complete answer of the car, section by section, exactly as Tesla gave it."""
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        row = _raw_row(c, vid)
        n = c.execute("SELECT COUNT(*) FROM raw WHERE vehicle=?", (vid,)).fetchone()[0]
    if not row:
        return JSONResponse({"ts": None, "data": {}, "readings": 0})
    return JSONResponse({"ts": row["ts"], "data": _unpack(row["data"]), "readings": n})


def _dig(d, path):
    for part in path.split("."):
        if isinstance(d, dict) and part in d:
            d = d[part]
        else:
            return None
    return d


@router.get("/v/{vid}/raw/series")
def raw_series(vid: str, path: str, hours: int = 168, x_pub_token: Optional[str] = Header(default=None)):
    """How one field changed over time, read back out of the stored answers."""
    me, err = _gate(x_pub_token)
    if err:
        return err
    if not path or len(path) > 120 or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_." for ch in path):
        return _bad("bad_path")
    since = int(time.time()) - max(1, min(hours, 24 * 120)) * 3600
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        rows = c.execute("SELECT ts, data FROM raw WHERE vehicle=? AND ts>=? ORDER BY ts", (vid, since)).fetchall()
    step = max(1, len(rows) // 600)
    out = []
    for i, r in enumerate(rows):
        if i % step and i != len(rows) - 1:
            continue
        v = _dig(_unpack(r["data"]), path)
        if isinstance(v, bool):
            v = 1 if v else 0
        if isinstance(v, (int, float)):
            out.append([r["ts"], v])
    return JSONResponse({"path": path, "points": out, "readings": len(rows)})


@router.get("/v/{vid}/tires")
def tires(vid: str, days: int = 30, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    since = int(time.time()) - max(1, min(days, 365)) * 86400
    with eng.db() as c:
        if not _vehicle(c, me, vid):
            return _bad("not_found", 404)
        rows = c.execute("""SELECT ts, tpms_fl, tpms_fr, tpms_rl, tpms_rr, outside_temp FROM samples
                            WHERE vehicle=? AND ts>=? AND tpms_fl IS NOT NULL ORDER BY ts""", (vid, since)).fetchall()
    step = max(1, len(rows) // 400)
    return JSONResponse({"rows": [list(r) for i, r in enumerate(rows) if i % step == 0 or i == len(rows) - 1]})


# ── The check schedule ──────────────────────────────────────────────────────
@router.get("/schedule")
def get_schedule(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        sched = eng.load_schedule(c, me["id"])
    lt = time.localtime()
    return JSONResponse({"schedule": sched, "defaults": eng.default_schedule(), "situations": list(eng.SITUATIONS),
                         "tz": time.strftime("%Z", lt), "offset": time.strftime("%z", lt),
                         "limits": {"min": eng.MIN_EVERY, "max": eng.MAX_EVERY}})


@router.put("/schedule")
def put_schedule(body: dict, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    try:
        clean = eng.clean_schedule(body)
    except (ValueError, TypeError, AttributeError):
        return _bad("invalid_schedule")
    with eng.db() as c:
        c.execute("INSERT INTO prefs (user_id, key, value) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value",
                  (me["id"], "schedule", json.dumps(clean)))
        # A new schedule should take effect now, not after the old waiting time.
        c.execute("UPDATE poll SET next_data=0, next_check=0 WHERE vehicle IN (SELECT id FROM vehicles WHERE user_id=?) AND mode IN ('suspend','asleep','idle')", (me["id"],))
        c.commit()
    return JSONResponse({"schedule": clean})


# ── Places and prices ───────────────────────────────────────────────────────
class PlaceBody(BaseModel):
    name: str
    lat: float
    lng: float
    radius: int = 100
    ac_price: Optional[float] = None
    dc_price: Optional[float] = None


def _place_out(r):
    return {"id": r["id"], "name": r["name"], "lat": r["lat"], "lng": r["lng"], "radius": r["radius"],
            "ac_price": r["ac_price"], "dc_price": r["dc_price"]}


@router.get("/places")
def list_places(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        rows = c.execute("SELECT * FROM places WHERE user_id=? ORDER BY name", (me["id"],)).fetchall()
        prefs = _prefs(c, me)
    return JSONResponse({"places": [_place_out(r) for r in rows], "prefs": prefs})


def _check_place(b):
    name = b.name.strip()[:80]
    if not name:
        return None, _bad("name_required")
    if not (-90 <= b.lat <= 90 and -180 <= b.lng <= 180):
        return None, _bad("invalid_position")
    for pr in (b.ac_price, b.dc_price):
        if pr is not None and (pr < 0 or pr > 100000):
            return None, _bad("invalid_price")
    return name, None


@router.post("/places")
def add_place(body: PlaceBody, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    name, bad = _check_place(body)
    if bad:
        return bad
    pid = uuid.uuid4().hex[:12]
    with eng.db() as c:
        if c.execute("SELECT COUNT(*) FROM places WHERE user_id=?", (me["id"],)).fetchone()[0] >= 300:
            return _bad("too_many_places")
        c.execute("INSERT INTO places (id,user_id,name,lat,lng,radius,ac_price,dc_price) VALUES (?,?,?,?,?,?,?,?)",
                  (pid, me["id"], name, body.lat, body.lng, max(30, min(body.radius, 5000)), body.ac_price, body.dc_price))
        c.commit()
        row = c.execute("SELECT * FROM places WHERE id=?", (pid,)).fetchone()
    return JSONResponse(_place_out(row))


@router.put("/places/{pid}")
def edit_place(pid: str, body: PlaceBody, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    name, bad = _check_place(body)
    if bad:
        return bad
    with eng.db() as c:
        cur = c.execute("UPDATE places SET name=?, lat=?, lng=?, radius=?, ac_price=?, dc_price=? WHERE id=? AND user_id=?",
                        (name, body.lat, body.lng, max(30, min(body.radius, 5000)), body.ac_price, body.dc_price, pid, me["id"]))
        c.commit()
        if not cur.rowcount:
            return _bad("not_found", 404)
        row = c.execute("SELECT * FROM places WHERE id=?", (pid,)).fetchone()
    return JSONResponse(_place_out(row))


@router.delete("/places/{pid}")
def delete_place(pid: str, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        c.execute("DELETE FROM tariffs WHERE place_id=? AND user_id=?", (pid, me["id"]))
        c.execute("UPDATE charge_costs SET place_id=NULL WHERE place_id=? AND user_id=?", (pid, me["id"]))
        c.execute("DELETE FROM places WHERE id=? AND user_id=?", (pid, me["id"]))
        c.commit()
    return JSONResponse({"ok": True})


class PrefsBody(BaseModel):
    default_ac_price: Optional[float] = None
    default_dc_price: Optional[float] = None


@router.put("/prefs")
def set_prefs(body: PrefsBody, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err:
        return err
    with eng.db() as c:
        for k, v in (("default_ac_price", body.default_ac_price), ("default_dc_price", body.default_dc_price)):
            if v is not None and (v < 0 or v > 100000):
                return _bad("invalid_price")
            c.execute("INSERT INTO prefs (user_id, key, value) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value",
                      (me["id"], k, "" if v is None else str(v)))
        c.commit()
        out = _prefs(c, me)
    return JSONResponse(out)


# Saved journeys reference existing history; they never control the collector.
class JourneyBody(BaseModel):
    name: str
    start_ts: int
    end_ts: int


def _journey_out(row):
    d = dict(row)
    now = int(time.time())
    d["status"] = "planned" if now < d["start_ts"] else "active" if now < d["end_ts"] else "completed"
    return d


@router.get("/v/{vid}/journeys")
def journey_list(vid: str, offset: int = 0, limit: int = 40, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        if not _vehicle(c, me, vid): return _bad("not_found", 404)
        rows = c.execute("SELECT * FROM journeys WHERE vehicle=? AND user_id=? ORDER BY start_ts DESC LIMIT ? OFFSET ?",
                         (vid, me["id"], max(1, min(100, limit)), max(0, offset))).fetchall()
        total = c.execute("SELECT COUNT(*) FROM journeys WHERE vehicle=? AND user_id=?", (vid, me["id"])).fetchone()[0]
    return {"journeys": [_journey_out(r) for r in rows], "total": total}


@router.post("/v/{vid}/journeys")
@router.put("/v/{vid}/journeys/{jid}")
def journey_save(vid: str, body: JourneyBody, jid: Optional[str] = None, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    name = body.name.strip()
    if not name or len(name) > 120 or not (0 <= body.start_ts < body.end_ts <= 7258118400):
        return _bad("invalid_journey")
    now = int(time.time())
    with eng.db() as c:
        if not _vehicle(c, me, vid): return _bad("not_found", 404)
        if jid:
            row = c.execute("SELECT * FROM journeys WHERE id=? AND vehicle=? AND user_id=?", (jid, vid, me["id"])).fetchone()
            if not row: return _bad("not_found", 404)
            c.execute("UPDATE journeys SET name=?,start_ts=?,end_ts=?,updated_ts=? WHERE id=?", (name, body.start_ts, body.end_ts, now, jid))
        else:
            jid = uuid.uuid4().hex
            c.execute("INSERT INTO journeys(id,user_id,vehicle,name,start_ts,end_ts,created_ts,updated_ts) VALUES(?,?,?,?,?,?,?,?)",
                      (jid, me["id"], vid, name, body.start_ts, body.end_ts, now, now))
        row = c.execute("SELECT * FROM journeys WHERE id=?", (jid,)).fetchone()
    return _journey_out(row)


@router.get("/v/{vid}/journeys/{jid}")
def journey_detail(vid: str, jid: str, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        if not _vehicle(c, me, vid): return _bad("not_found", 404)
        row = c.execute("SELECT * FROM journeys WHERE id=? AND vehicle=? AND user_id=?", (jid, vid, me["id"])).fetchone()
        if not row: return _bad("not_found", 404)
        places, prefs = _places(c, me), _billing_prefs(c, me)
        analysis = journey_data.report(c, vid, row["start_ts"], row["end_ts"],
            lambda r: _trip_out(r, places), lambda r: _charge_out(r, places, prefs))
    return {"journey": _journey_out(row), "analysis": analysis}


@router.delete("/v/{vid}/journeys/{jid}")
def journey_delete(vid: str, jid: str, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        if not _vehicle(c, me, vid): return _bad("not_found", 404)
        result = c.execute("DELETE FROM journeys WHERE id=? AND vehicle=? AND user_id=?", (jid, vid, me["id"]))
        if not result.rowcount: return _bad("not_found", 404)
    return {"ok": True}


@router.post("/v/{vid}/journeys/{jid}/{action}")
def journey_action(vid: str, jid: str, action: str, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        if not _vehicle(c, me, vid): return _bad("not_found", 404)
        row = c.execute("SELECT * FROM journeys WHERE id=? AND vehicle=? AND user_id=?", (jid, vid, me["id"])).fetchone()
        if not row: return _bad("not_found", 404)
        now = int(time.time())
        if action == "start" and now < row["start_ts"]:
            c.execute("UPDATE journeys SET start_ts=?,updated_ts=? WHERE id=?", (now, now, jid))
        elif action == "stop" and row["start_ts"] < now < row["end_ts"]:
            c.execute("UPDATE journeys SET end_ts=?,updated_ts=? WHERE id=?", (now, now, jid))
        else:
            return _bad("invalid_journey_action", 409)
        row = c.execute("SELECT * FROM journeys WHERE id=?", (jid,)).fetchone()
    return _journey_out(row)


# Historical tariffs and manual charging costs.
def _tariff_out(row):
    d = dict(row); d["rules"] = json.loads(d["rules"])
    return d


@router.get("/tariffs")
def tariff_list(x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    with eng.db() as c:
        rows = c.execute("SELECT * FROM tariffs WHERE user_id=? ORDER BY start_ts DESC", (me["id"],)).fetchall()
    return {"tariffs": [_tariff_out(r) for r in rows]}


@router.post("/tariffs")
@router.put("/tariffs/{tid}")
def tariff_save(body: dict, tid: Optional[str] = None, x_pub_token: Optional[str] = Header(default=None)):
    me, err = _gate(x_pub_token)
    if err: return err
    try: clean = billing.validate(body)
    except (ValueError, TypeError, KeyError, AttributeError): return _bad("invalid_tariff")
    with eng.db() as c:
        if not c.execute("SELECT id FROM places WHERE id=? AND user_id=?", (clean["place_id"],me["id"])).fetchone(): return _bad("not_found",404)
        if tid and not c.execute("SELECT id FROM tariffs WHERE id=? AND user_id=?", (tid,me["id"])).fetchone(): return _bad("not_found",404)
        overlap = c.execute("SELECT id,kind FROM tariffs WHERE user_id=? AND place_id=? AND start_ts<? AND end_ts>? AND id!=?",
                            (me["id"],clean["place_id"],clean["end_ts"],clean["start_ts"],tid or '')).fetchall()
        if any(r["kind"]=="all" or clean["kind"]=="all" or r["kind"]==clean["kind"] for r in overlap): return _bad("overlapping_tariffs",409)
        tid = tid or uuid.uuid4().hex
        now = int(time.time())
        c.execute("""INSERT INTO tariffs(id,user_id,place_id,name,start_ts,end_ts,currency,timezone,kind,rules,created_ts,updated_ts)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET place_id=excluded.place_id,name=excluded.name,
            start_ts=excluded.start_ts,end_ts=excluded.end_ts,currency=excluded.currency,timezone=excluded.timezone,
            kind=excluded.kind,rules=excluded.rules,updated_ts=excluded.updated_ts""",
            (tid,me["id"],clean["place_id"],clean["name"],clean["start_ts"],clean["end_ts"],clean["currency"],clean["timezone"],clean["kind"],json.dumps(clean["rules"]),now,now))
        row=c.execute("SELECT * FROM tariffs WHERE id=?",(tid,)).fetchone()
    return _tariff_out(row)


@router.delete("/tariffs/{tid}")
def tariff_delete(tid: str, x_pub_token: Optional[str] = Header(default=None)):
    me,err=_gate(x_pub_token)
    if err:return err
    with eng.db() as c:
        result=c.execute("DELETE FROM tariffs WHERE id=? AND user_id=?",(tid,me["id"]))
        if not result.rowcount:return _bad("not_found",404)
    return {"ok":True}


@router.put("/v/{vid}/charges/{cid}/cost")
def charge_cost_save(vid: str, cid: int, body: dict, x_pub_token: Optional[str] = Header(default=None)):
    me,err=_gate(x_pub_token)
    if err:return err
    currency=str(body.get("currency","EUR")).upper()
    unit,total=body.get("unit_price"),body.get("total_cost")
    if len(currency)!=3 or not currency.isascii() or not currency.isalpha():return _bad("invalid_price")
    if unit is not None and total is not None:return _bad("invalid_price")
    if any(v is not None and (not billing.number(v) or not 0<=v<=100000000) for v in (unit,total)):return _bad("invalid_price")
    with eng.db() as c:
        if not _vehicle(c,me,vid):return _bad("not_found",404)
        row=c.execute("SELECT * FROM charges WHERE id=? AND vehicle=?",(cid,vid)).fetchone()
        if not row:return _bad("not_found",404)
        place=body.get("place_id") or None
        if place and not c.execute("SELECT id FROM places WHERE id=? AND user_id=?",(place,me["id"])).fetchone():return _bad("not_found",404)
        if unit is None and total is None and not place:
            c.execute("DELETE FROM charge_costs WHERE charge=? AND user_id=?",(cid,me["id"]))
        else:
            c.execute("INSERT INTO charge_costs(charge,user_id,currency,unit_price,total_cost,place_id,updated_ts) VALUES(?,?,?,?,?,?,?) ON CONFLICT(charge) DO UPDATE SET currency=excluded.currency,unit_price=excluded.unit_price,total_cost=excluded.total_cost,place_id=excluded.place_id,updated_ts=excluded.updated_ts",
                      (cid,me["id"],currency,unit,total,place,int(time.time())))
        out=_charge_out(row,_places(c,me),_billing_prefs(c,me))
    return out


@router.get("/v/{vid}/costs")
def cost_report(vid: str, start: int, end: int, place_id: Optional[str] = None, kind: str = "all", x_pub_token: Optional[str] = Header(default=None)):
    me,err=_gate(x_pub_token)
    if err:return err
    if not 0<=start<end<=7258118400 or kind not in ("all","ac","dc"):return _bad("invalid_period")
    with eng.db() as c:
        if not _vehicle(c,me,vid):return _bad("not_found",404)
        if place_id and not c.execute("SELECT id FROM places WHERE id=? AND user_id=?",(place_id,me["id"])).fetchone():return _bad("not_found",404)
        places,prefs=_places(c,me),_billing_prefs(c,me)
        rows=[]
        for row in c.execute("SELECT * FROM charges WHERE vehicle=? AND start_ts<? AND COALESCE(end_ts,start_ts)>? ORDER BY start_ts DESC",(vid,end,start)).fetchall():
            if kind!="all" and bool(row["dc"])!=(kind=="dc"):continue
            ch=dict(row);ch["start_ts"]=max(start,ch["start_ts"]);ch["end_ts"]=min(end,ch["end_ts"] or ch["start_ts"])
            out=_charge_out(ch,places,prefs)
            if place_id and out["place_id"]!=place_id:continue
            out["kwh"]=out["billing_kwh"];rows.append(out)
        summary=billing.summarize(rows)
    return {"start":start,"end":end,"charges":rows,"summary":summary}
