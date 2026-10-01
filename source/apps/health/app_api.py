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


def record_daily(user_id: str, day: str, values: dict, source_app: str, source_app_name: str = None):
    """Set what one app contributes to a day. values maps a daily metric (water
    in ml, caffeine in mg, alcohol in g, calories in kcal, sugar and protein in g)
    to that app's total for the day. It
    replaces the app's earlier value for that day; 0 removes it. Other sources
    of the same day, such as values typed by hand, are added on top."""
    return _pub()._set_daily_many(user_id, day, values, (source_app or "").strip()[:60] or "app",
                                  (source_app_name or source_app or "")[:60])


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
    lowest, highest, latest and change)."""
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


def record_lab_result(user_id: str, test: str, value: float, unit: str = None, day: str = None,
                      low: float = None, high: float = None, lab: str = None, note: str = None,
                      source_app: str = "app", source_app_name: str = None):
    """Record one laboratory result. test is a test key, its code or any name or
    alias it is known by (see list_lab_tests), so the name printed on the lab's
    form works. unit is the unit of value (any unit the test accepts; default
    the one the person sees). low and high are the reference range of that lab's
    form, in the same unit. The result is stored as written and shown in the
    person's own unit. Raises LookupError for an unknown test."""
    return _pub()._add_lab(user_id, test, value, unit, day, low, high, lab or "", note or "", test,
                           (source_app or "app")[:60], (source_app_name or source_app or "")[:60])


def get_lab_results(user_id: str, test: str):
    """All results of one laboratory test, oldest first, with the reference
    range and status (low, ok, high) of each."""
    return _pub()._lab_results(user_id, test)

