"""
Health's app-to-app and External API. Other apps send their measurements here
(after the person allowed it in that app) and scripts can read the series. Every
action runs the same functions api.py's own routes use, reached through
sys.modules["app_public_health"].

user_id is always an Apps Hub public_users.id and every action only sees that
profile's own data. source_app / source_app_name identify the sender, which is
how the person sees where a number came from.

Invalid input raises ValueError with a short reason; a missing item raises
LookupError("not found"). Days are YYYY-MM-DD, moments YYYY-MM-DDTHH:MM in the
person's local time, and default to now on the server.
"""

import sys
from datetime import datetime


def _pub():
    pub = sys.modules.get("app_public_health")
    if pub is None:
        raise RuntimeError("health api.py not loaded")
    return pub


_LANGS = ("en", "bg", "de", "es", "fr", "ja", "pt-BR", "ru", "zh-CN")


def _lang(user_id: str, lang: str = None) -> str:
    """The language a new test's name is written in: the one given, else the
    language of the person's profile."""
    if lang:
        return lang
    hub = _pub()._hub()
    try:
        users = hub.get_users_by_ids([user_id]) if hub else []
    except Exception:
        users = []
    lang = users[0].get("language") if users else None
    return lang if lang in _LANGS else "en"


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def status(user_id: str):
    """Whether Health can receive data for this profile. Returns {"ok": true}."""
    _pub()
    return {"ok": True}


def list_metrics():
    """The metrics Health keeps: id, kind (reading = a measurement at a moment,
    daily = a total per day), group, unit and, for readings, the field names."""
    return _pub()._list_metrics()


def record_daily(user_id: str, day: str, values: dict, source_app: str, source_app_name: str = None,
                 goals: dict = None):
    """Set what one app contributes to a day. values maps a daily metric (water
    in ml, caffeine in mg, alcohol in g, calories in kcal, sugar and protein in g)
    to that app's total for the day. It
    replaces the app's earlier value for that day; 0 removes it. Other sources
    of the same day, such as values typed by hand, are added on top. goals
    optionally maps a daily metric to the goal the app had for that day, in the
    same unit; Health draws it in the chart, each day with its own goal."""
    return _pub()._set_daily_many(user_id, day, values, (source_app or "").strip()[:60] or "app",
                                  (source_app_name or source_app or "")[:60], goals)


def record_weight(user_id: str, weight_kg: float, at: str = None, source_app: str = "app",
                  source_app_name: str = None, idempotency_key: str = None, note: str = ""):
    """Add a weight measurement in kilograms. idempotency_key makes a retry
    from the same app return the earlier entry instead of adding a second."""
    return _pub()._add_reading(user_id, "weight", [weight_kg], at, note, (source_app or "app")[:60],
                               (source_app_name or source_app or "")[:60], idempotency_key)


def record_blood_pressure(user_id: str, systolic: float, diastolic: float, pulse: float = None,
                          at: str = None, source_app: str = "app", source_app_name: str = None,
                          idempotency_key: str = None, note: str = ""):
    """Add a blood pressure measurement in mmHg, with the pulse if known.
    idempotency_key makes a retry from the same app return the earlier entry."""
    return _pub()._add_reading(user_id, "bp", [systolic, diastolic, pulse], at, note, (source_app or "app")[:60],
                               (source_app_name or source_app or "")[:60], idempotency_key)


def get_series(user_id: str, metric: str, days: int = 30, end: str = None):
    """The measurements of one metric for the last days days (1 to 366, default
    30) up to end (default today): the points and their statistics (average,
    lowest, highest, latest and change). A daily metric also has each day's goal
    when an app gave one (goal on a point, goals for the whole range) and how
    many of those days reached it (goal_days)."""
    return _pub()._series(user_id, metric, end or _today(), days)


def get_overview(user_id: str, end: str = None):
    """Every metric at a glance: the latest value, the last week's average and
    the last month's points."""
    return _pub()._overview(user_id, end or _today())


def list_lab_tests(user_id: str):
    """The laboratory tests a result can be recorded for. Each has key, code
    (LOINC unless the person changed it), unit (the unit results are shown in),
    units (other units accepted, with conversion), names (per language) and
    aliases (every other name it is known by, including ones the person added)."""
    return _pub()._lab_catalog(user_id)


def create_lab_test(user_id: str, name: str, unit: str, lang: str = None, code: str = None,
                    aliases: list = None, names: dict = None):
    """Make the person's own laboratory test for one that is not in
    list_lab_tests, so its results can be recorded and it is offered from
    then on. name is the name in the language lang (en, bg, de, es, fr, ja,
    pt-BR, ru, zh-CN; default the person's own language), names optionally its name in other languages, unit the unit its results are kept in,
    code an optional code (LOINC) and aliases other names and abbreviations it
    is printed as. When a test with that name, code or alias already exists it
    is returned and nothing new is made. Returns the test (with its key)."""
    with _pub()._db() as c:
        for text in [name, code] + list(aliases or []):
            found = _pub()._find_test(c, user_id, text) if text else None
            if found:
                return found
    all_names = dict(names or {})
    all_names[_lang(user_id, lang)] = name
    return _pub()._save_custom_test(user_id, None, code or "", unit, all_names, list(aliases or []))


def record_lab_result(user_id: str, test: str, value: float, unit: str = None, day: str = None,
                      low: float = None, high: float = None, lab: str = None, note: str = None,
                      printed_name: str = None, lang: str = None,
                      source_app: str = "app", source_app_name: str = None):
    """Record one laboratory result in a single call, as it is on the lab's
    form. test is the name printed on the form or a test key, code or alias
    (see list_lab_tests). When the printed name is not known yet but you know
    which test it is, pass that test's key as test and the printed name as
    printed_name: Health remembers it, so it is recognised next time. When no
    test fits at all, Health makes the person's own test named test (in the
    language lang, default the person's own) with unit as its unit, so unit is then required. unit is
    the unit of value (default the one the person sees); low and high are the
    reference range of that lab's form, in the same unit. The result is stored
    as written and shown in the person's own unit."""
    pub = _pub()
    with pub._db() as c:
        found = pub._find_test(c, user_id, test, unit)
    if not found:
        if not (unit or "").strip():
            raise ValueError("unit is required to make a new test")
        names = {_lang(user_id, lang): test}
        aliases = [printed_name] if printed_name and printed_name != test else []
        found = pub._save_custom_test(user_id, None, "", unit, names, aliases)
    written = (printed_name or ("" if test == found["key"] else test) or "").strip()
    out = pub._add_lab(user_id, found["key"], value, unit, day, low, high, lab or "", note or "", written,
                       (source_app or "app")[:60], (source_app_name or source_app or "")[:60])
    with pub._db() as c:
        t = pub._test_map(c, user_id).get(found["key"])
        if t:
            pub._remember_alias(c, user_id, t, written)
            c.commit()
    return out


def get_lab_results(user_id: str, test: str):
    """All results of one laboratory test, oldest first, with the reference
    range and status (low, ok, high) of each."""
    return _pub()._lab_results(user_id, test)



def edit_lab_result(user_id: str, result_id: str, value: float = None, unit: str = None, day: str = None,
                    low: float = None, high: float = None, lab: str = None, note: str = None):
    """Correct a recorded laboratory result (its id is in get_lab_results).
    Only the fields given change; value, low and high are in unit (default the
    unit the result was written in). Raises LookupError for an unknown id."""
    pub = _pub()
    with pub._db() as c:
        row = c.execute("SELECT * FROM lab_results WHERE id=? AND user_id=?", (result_id, user_id)).fetchone()
        if not row:
            raise LookupError("not found")
        t = pub._test_map(c, user_id).get(row["test_key"])
        if not t:
            raise LookupError("not found")
    unit = unit or row["orig_unit"] or t["display_unit"]
    keep = lambda v: None if v is None else round(pub._from_base(t, v, unit), 6)
    return pub._edit_lab(user_id, result_id,
                         keep(row["value"]) if value is None else value, unit,
                         day or row["day"],
                         keep(row["low"]) if low is None else low,
                         keep(row["high"]) if high is None else high,
                         row["lab"] if lab is None else lab,
                         row["note"] if note is None else note,
                         row["written_name"])


def delete_lab_result(user_id: str, result_id: str):
    """Delete one laboratory result (its id is in get_lab_results)."""
    return _pub()._delete_lab(user_id, result_id)


def update_lab_test(user_id: str, test: str, add_aliases: list = None, code: str = None, unit: str = None,
                    names: dict = None):
    """Change how a laboratory test is known and shown. test is its key, code,
    name or alias. add_aliases adds names and abbreviations it is printed as,
    so they are recognised from then on; code replaces its code; unit is the
    unit its results are shown in (one the test accepts). names (per language)
    renames only a test the person made with create_lab_test."""
    pub = _pub()
    with pub._db() as c:
        t = pub._find_test(c, user_id, test)
    if not t:
        raise LookupError("not found")
    aliases = None if add_aliases is None else t["user_aliases"] + list(add_aliases)
    if names and t["key"].startswith("c_"):
        all_names = dict(t["names"])
        all_names.update(names)
        t = pub._save_custom_test(user_id, t["key"], t["code"] if code is None else code,
                                  t["base_unit"], all_names, aliases if aliases is not None else t["user_aliases"])
        code, aliases = None, None
    return pub._save_prefs(user_id, t["key"], code, unit, aliases)


def get_lab_overview(user_id: str):
    """Every laboratory test that has results: the latest one, the one before
    it and its status against the reference range."""
    return _pub()._lab_overview(user_id)


def edit_reading(user_id: str, reading_id: str, values: list = None, at: str = None, note: str = None):
    """Correct a weight or blood pressure measurement (its id is in the points
    of get_series). values are in the order of the metric's fields
    (list_metrics); only what is given changes."""
    pub = _pub()
    if values is None:
        with pub._db() as c:
            row = c.execute("SELECT * FROM readings WHERE id=? AND user_id=?", (reading_id, user_id)).fetchone()
        if not row:
            raise LookupError("not found")
        values = [row["v1"], row["v2"], row["v3"]]
    return pub._edit_reading(user_id, reading_id, values, at, note)


def delete_reading(user_id: str, reading_id: str):
    """Delete a weight or blood pressure measurement (its id is in the points
    of get_series)."""
    return _pub()._delete_reading(user_id, reading_id)
