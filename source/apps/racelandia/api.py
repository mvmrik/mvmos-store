"""Racelandia - the garage.

The laps are run inside the Game Hub multiplayer framework (mp_game.py). The
garage around them - the driver, the budget, the setup, the training
simulators - is this app's own data and talks to this router with the
caller's Game Hub token. Apps Hub is the only sign-in, so the token says whose
garage it is; nobody can read or change someone else's.
"""
import importlib.util
import os
import sys

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, FileResponse

# Loaded straight from the file, so an app update never keeps running an
# older copy a live backend has already cached.
_APP_DIR = os.path.dirname(os.path.realpath(__file__))
_spec = importlib.util.spec_from_file_location("racelandia_data", os.path.join(_APP_DIR, "apex_data.py"))
data = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(data)

router = APIRouter()


@router.get("/tracks.json")
def circuit_catalog():
    # Public geometry contains no career data and also loads for Apps Hub-only players.
    return FileResponse(os.path.join(_APP_DIR, "public", "tracks.json"),
                        media_type="application/json", headers={"Cache-Control":"no-cache"})


def _user(request: Request):
    hub = sys.modules.get("backend.apphub")
    token = request.headers.get("X-GH-Token", "") or request.headers.get("X-Pub-Token", "")
    return hub.get_pub_session(token) if hub and token else None


def _home_weather(d) -> dict:
    track = data.TRACK if d.get("own") else next((t for t in d["licences"] if data.valid_track(t)), None) or sorted(data.tracks.official())[0]
    return data.weather_of(d, track)


def garage(user) -> dict:
    d = data.get_driver(user["id"], user.get("display_name", ""))
    tracks = []
    prof = data.current_profile(d) if d["has_car"] else None
    for t in data.circuit_menu(d):
        tracks.append({**t, "rent_practice": t["practice_cost"], "setup": data.track_setup(d, t["id"]), "bests": data.best_laps(user["id"], t["id"], prof)})
    return {
        "name_display_rules": data.name_source.display_rules(),
        "driver": data.public_driver(d),
        "team": data.public_team(d),
        "crew": data.public_crew(d),
        "specialists": data.public_specialists(d),
        "career": data.public_career(d),
        "division": data.public_division(d),
        "sponsored": d.get("sponsored", False),
        "tracks": tracks,
        "own": data.public_own(d.get("own")),
        "licences": d["licences"],
        "track_rules": {"widths": list(data.tracks.WIDTHS), "min_length": data.tracks.MIN_LENGTH, "max_length": data.tracks.MAX_LENGTH,
                        "min_radius": data.tracks.MIN_RADIUS, "seat_cost": data.tracks.SEAT_COST, "seat_price": data.tracks.SEAT_PRICE,
                        "require": data.tracks.REQUIRE, "demolition": data.tracks.DEMOLITION},
        "defs": [{"key": k, "group": g, "min": lo, "max": hi, "step": st, "def": df, "unit": u}
                 for k, g, lo, hi, st, df, u in data.SETUP_DEFS],
        "compounds": data.COMPOUNDS,
        "tyre_cost": data.TYRE_COST,
        "warehouse": data.public_warehouse(d),
        "lab": data.public_lab(d),
        "parts": {k: {"new": v["new"], "repair": v["repair"]} for k, v in data.PARTS.items()},
        "costs": {"lap": data.LAP_COST, "fuel": data.FUEL_COST, "train": data.TRAIN_COST,
                  "train_energy": data.TRAIN_ENERGY, "race_min_laps": data.RACE_MIN_LAPS,
                  "practice_energy_lap": data.PRACTICE_ENERGY_PER_LAP, "race_energy": data.RACE_ENERGY,
                  "race_energy_lap": data.RACE_ENERGY_PER_LAP},
        "prizes": data.PRIZES,
        "forecast": _home_weather(d)["forecast"],
        "weather_live": _home_weather(d)["live"],
        "hours": data.HOURS, "hour": data.default_hour(),
        "laps": {"min": data.MIN_LAPS, "max": data.MAX_LAPS},
        "games": list(data.GAMES.keys()),
        "training_levels": data.training_levels(d["skills"]) if d["has_driver"] else {}, "training_refs": data.training_references(d["skills"]) if d["has_driver"] else {},
        "training_hall": data.training_hall(user["id"]),
        "skills": data.SKILLS,
    }


@router.get("/state")
def state(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    return JSONResponse(garage(user))


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


@router.post("/setup")
async def setup(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data.get_driver(user["id"], user.get("display_name", ""))
    if not data.get_driver(user["id"])["has_car"]:
        return JSONResponse({"error":"car"},status_code=400)
    track = str(body.get("track", data.TRACK))
    return JSONResponse({"setup": data.save_setup(user["id"], body.get("setup"), track)})


@router.post("/parts")
async def parts(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data.get_driver(user["id"], user.get("display_name", ""))
    res, err = data.part_action(user["id"], str(body.get("part", "")), str(body.get("mode", "")))
    if err:
        return JSONResponse({"error": err, "driver": data.public_driver(data.get_driver(user["id"]))}, status_code=400)
    return JSONResponse({**res, "driver": data.public_driver(data.get_driver(user["id"]))})


@router.get("/runs")
def runs(request: Request, track: str = data.TRACK):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    return JSONResponse({"runs": data.list_runs(user["id"], track), "bests": data.best_laps(user["id"], track)})


@router.get("/run/{run_id}")
def run_detail(run_id: int, request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    d = data.run_detail(user["id"], run_id)
    if not d:
        return JSONResponse({"error": "missing"}, status_code=404)
    return JSONResponse(d)


@router.post("/name")
async def name(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data.get_driver(user["id"], user.get("display_name", ""))
    data.set_name(user["id"], str(body.get("name", "")))
    return JSONResponse({"driver": data.public_driver(data.get_driver(user["id"]))})


@router.post("/train/start")
async def train_start(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    data.get_driver(user["id"], user.get("display_name", ""))
    tid, err = data.train_start(user["id"], str(body.get("game", "")), str(body["member"]) if body.get("member") else None)
    if err:
        return JSONResponse({"error": err}, status_code=400)
    session = data.training_session(user["id"], tid)
    return JSONResponse({"settings": data.crew_training.settings(session["difficulty"]) if session["subject"] and session["mechanic"] != "staff" else None, "training_hall": data.training_hall(user["id"]), "crew": data.public_crew(data.get_driver(user["id"])), "specialists": data.public_specialists(data.get_driver(user["id"])), "tid": tid, "difficulty": session["difficulty"], "training_refs": data.training_references(data.get_driver(user["id"])["skills"]) if not session["subject"] else None,
                         "driver": data.public_driver(data.get_driver(user["id"]))})


@router.post("/train/finish")
async def train_finish(request: Request):
    user = _user(request)
    if not user:
        return JSONResponse({"error": "signin"}, status_code=401)
    body = await _body(request)
    res, err = data.train_finish(user["id"], str(body.get("tid", "")), body.get("result"))
    if err:
        return JSONResponse({"error": err}, status_code=400)
    d = data.get_driver(user["id"])
    return JSONResponse({**res, "training_hall": data.training_hall(user["id"]), "driver": data.public_driver(d), "training_levels": data.training_levels(d["skills"]) if d["has_driver"] else {}, "training_refs": data.training_references(d["skills"]) if d["has_driver"] else {},
                         "crew": data.public_crew(d), "specialists": data.public_specialists(d)})


@router.post("/driver/recruit")
async def driver_recruit(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    error=data.recruit_driver(user["id"],str(body.get("offer","")))
    if error:return JSONResponse({"error":error},status_code=400)
    return JSONResponse(garage(user))


@router.post("/session/abandon")
async def session_abandon(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    data.abandon_session(user["id"])
    return JSONResponse(garage(user))


@router.post("/warehouse/buy")
async def warehouse_buy(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    error=data.buy_tyres(user["id"],str(body.get("compound","")),body.get("count",1))
    if error:return JSONResponse({"error":error},status_code=400)
    return JSONResponse(garage(user))


@router.post("/warehouse/buy-many")
async def warehouse_buy_many(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.buy_tyres_many(user["id"],body.get("items")))


@router.post("/warehouse/sell")
async def warehouse_sell(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    error=data.sell_tyres(user["id"],body.get("set"))
    if error:return JSONResponse({"error":error},status_code=400)
    return JSONResponse(garage(user))


def _answer(user, error):
    if error:return JSONResponse({"error":error},status_code=400)
    return JSONResponse(garage(user))


@router.post("/lab/research")
async def lab_research(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.research_start(user["id"],str(body.get("part","")),body.get("base",""),body.get("push")))


@router.post("/lab/decide")
async def lab_decide(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.research_decide(user["id"],str(body.get("action",""))))


@router.post("/lab/build")
async def lab_build(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.build_order(user["id"],body.get("design",""),body.get("qty",1)))


@router.post("/warehouse/fit")
async def warehouse_fit(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.fit_part(user["id"],body.get("unit")))


@router.post("/warehouse/sell-part")
async def warehouse_sell_part(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.sell_part(user["id"],body.get("unit")))


@router.post("/track/quote")
async def track_quote(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    d=data.get_driver(user["id"],user.get("display_name",""))
    return JSONResponse(data.own_quote(d,body.get("ctrl"),body.get("width",12),body.get("seats")))


@router.post("/track/verify")
def track_verify(request: Request, body: dict = None):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=body or {}
    d=data.get_driver(user["id"],user.get("display_name",""))
    return JSONResponse(data.own_verify(d,body.get("ctrl"),body.get("width",12)))


@router.post("/track/build")
def track_build(request: Request, body: dict = None):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=body or {}
    error=data.own_build(user["id"],body.get("ctrl"),body.get("width",12),body.get("seats"),body.get("name"),body.get("lat"),body.get("lon"))
    return _answer(user,error)


@router.post("/track/stands/quote")
async def stands_quote(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return JSONResponse(data.stands_quote(data.get_driver(user['id']),body.get('grandstands')))


@router.post("/track/stands")
async def track_stands(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.own_stands(user["id"],body.get("grandstands")))


_geo={}


@router.get("/geocode")
def geocode(request: Request, q: str = ""):
    """Place search for choosing where the own circuit stands (Open-Meteo's free geocoder, no key)."""
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    q=q.strip()[:60]
    if len(q)<2:return JSONResponse({"places":[]})
    if q.lower() in _geo:return JSONResponse({"places":_geo[q.lower()]})
    import json as _json
    import urllib.parse
    import urllib.request
    try:
        url="https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name="+urllib.parse.quote(q)
        with urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"mvmOS-Racelandia"}),timeout=6) as r:
            res=_json.loads(r.read().decode())
    except Exception:
        return JSONResponse({"error":"geocode"},status_code=502)
    places=[{"name":p.get("name",""),"region":p.get("admin1",""),"country":p.get("country",""),"lat":p.get("latitude"),"lon":p.get("longitude")} for p in res.get("results",[])]
    if len(_geo)>200:_geo.clear()
    _geo[q.lower()]=places
    return JSONResponse({"places":places})


@router.get("/forecast")
def forecast_for(request: Request, track: str = data.TRACK):
    """Today's weather at a circuit (cached for hours, so opening a circuit does not ask the service every time)."""
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    d=data.get_driver(user["id"],user.get("display_name",""))
    if not data.valid_track(track) or not data.track_of(d,track):return JSONResponse({"error":"track"},status_code=404)
    w=data.weather_of(d,track)
    return JSONResponse({"forecast":w["forecast"],"hour":w["hour"],"now":w["now"],"now_frac":w["now_frac"],"live":w["live"],"date":w["date"]})


@router.post("/team/name")
async def team_name(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    data.set_team_name(user["id"],str(body.get("name","")))
    return JSONResponse(garage(user))


@router.post("/car/livery")
async def car_livery(request: Request):
    user = _user(request)
    if not user: return JSONResponse({"error":"signin"}, status_code=401)
    body = await _body(request)
    return _answer(user, data.set_livery(user['id'], str(body.get('car', '')), body.get('colors')))


@router.post("/team/select-car")
async def team_select_car(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.team_action(user['id'],'car',ident=str(body.get('id',''))))


@router.post("/team/select-pilot")
async def team_select_pilot(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.team_action(user['id'],'pilot',ident=str(body.get('id',''))))


@router.post("/team/assign")
async def team_assign(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.team_action(user['id'],'assign',car=str(body.get('car','')),pilot=str(body['pilot']) if body.get('pilot') else None))


@router.post("/crew/hire")
async def crew_hire(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.crew_hire(user["id"],str(body.get("car","")),str(body.get("position","")),str(body.get("offer",""))))


@router.post("/crew/dismiss")
async def crew_dismiss(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.crew_dismiss(user["id"],str(body.get("member",""))))


@router.post("/specialists/hire")
async def specialist_hire(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.specialist_hire(user["id"],str(body.get("role","")),str(body.get("offer",""))))


@router.post("/specialists/dismiss")
async def specialist_dismiss(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.specialist_dismiss(user["id"],str(body.get("member",""))))


@router.get("/finances")
def finances(request: Request, before: int = None, category: str = None):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    return JSONResponse(data.finance_state(user['id'],before,category))


@router.post("/sponsors/sign")
async def sponsor_sign(request: Request):
    user=_user(request)
    if not user:return JSONResponse({"error":"signin"},status_code=401)
    body=await _body(request)
    return _answer(user,data.sign_sponsor(user['id'],str(body.get('offer',''))))
