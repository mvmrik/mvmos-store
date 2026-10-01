"""
Hydration's app-to-app and External API — the only way another app, script or
Shortcut should touch the drink journal. Every action runs the same functions
api.py's own routes use, reached through sys.modules["app_public_hydration"]
(api.py is loaded under that name by backend/public_loader.py), so the values
counted are exactly those of the Hydration window.

user_id is always an Apps Hub public_users.id and every action only sees that
profile's own drinks and entries.

Invalid input raises ValueError with a short reason; a missing entry or drink
raises LookupError("not found"). Amounts are in millilitres; a day is a
YYYY-MM-DD date and defaults to today on the server.
"""

import sys
from datetime import datetime


def _pub():
    pub = sys.modules.get("app_public_hydration")
    if pub is None:
        raise RuntimeError("hydration api.py not loaded")
    return pub


def _today():
    return datetime.now().strftime("%Y-%m-%d")


def _resolve_drink(pub, user_id, drink):
    """A ready-made drink id, a custom drink id or, failing those, a custom
    drink's name (any letter case)."""
    drink = (drink or "water").strip()
    with pub._db() as c:
        if pub._find_product(c, user_id, drink):
            return drink
        row = c.execute(
            "SELECT id FROM products WHERE user_id=? AND lower(name)=lower(?)", (user_id, drink)
        ).fetchone()
    if not row:
        raise LookupError("not found")
    return row["id"]


def list_drinks(user_id: str):
    """The drinks that can be logged: ready-made ones (id such as water,
    coffee, beer) and the user's own custom drinks. Each has id, name (custom
    only), water_percent, caffeine_mg_100 per 100 ml, alcohol_percent (alcohol
    by volume), active (shown on the main screen) and servings (a list of
    {ml, last_used}). A ready-made drink the user has changed shows their
    values and modified true."""
    pub = _pub()
    with pub._db() as c:
        drinks = pub._drinks(c, user_id)
    strip = lambda d: {k: v for k, v in d.items() if k not in ("icon", "kind")}
    return {"ready_made": [strip(d) for d in drinks if d["kind"] == "ready"],
            "custom": [strip(d) for d in drinks if d["kind"] == "custom"]}


def get_day(user_id: str, day: str = None):
    """The drinks logged on one day (newest first, day defaults to today)
    with totals: amount_ml, water_ml (only the water in the drinks),
    caffeine_mg and alcohol_g. Each entry has id, name, amount_ml, water_ml,
    caffeine_mg and alcohol_g."""
    return _pub()._get_day(user_id, day or _today())


def get_history(user_id: str, days: int = 7, end: str = None):
    """Daily totals (day, amount_ml, water_ml, caffeine_mg, alcohol_g) for the
    last days days (1 to 90, default 7) up to and including end, which
    defaults to today."""
    return {"days": _pub()._get_history(user_id, end or _today(), days)}


def get_target(user_id: str):
    """The user's daily water target in millilitres and their unit (ml or oz)."""
    pub = _pub()
    with pub._db() as c:
        return pub._settings(c, user_id)


def add_entry(user_id: str, amount_ml: float, drink: str = "water", day: str = None):
    """Log a drink. drink is a ready-made drink id or a custom drink's id or
    name (see list_drinks) and defaults to water; day defaults to today.
    Returns the entry with the water, caffeine and alcohol it counts."""
    pub = _pub()
    return pub._add_entry(user_id, day or _today(), amount_ml, _resolve_drink(pub, user_id, drink))


def update_entry(user_id: str, entry_id: str, amount_ml: float):
    """Change the amount of a logged drink; its drink stays the same."""
    return _pub()._set_amount(user_id, entry_id, amount_ml)


def delete_entry(user_id: str, entry_id: str):
    """Remove one logged drink."""
    return _pub()._delete_entry(user_id, entry_id)


def add_custom_drink(user_id: str, name: str, water_percent: float = 100,
                     caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                     servings_ml: list = None):
    """Create a custom drink: water_percent of it is water (0 to 100),
    caffeine_mg_100 is mg of caffeine per 100 ml, alcohol_percent is alcohol
    by volume, servings_ml the serving sizes offered for it in millilitres
    (default 150, 250 and 500). Returns it with its id."""
    return _pub()._add_product(user_id, name, water_percent, caffeine_mg_100, alcohol_percent, servings_ml)


def update_custom_drink(user_id: str, drink_id: str, name: str, water_percent: float = 100,
                        caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                        servings_ml: list = None):
    """Change a custom drink; servings_ml, when given, replaces its serving
    sizes. Entries already logged keep their old values."""
    return _pub()._edit_product(user_id, drink_id, name, water_percent, caffeine_mg_100,
                                alcohol_percent, servings_ml)


def delete_custom_drink(user_id: str, drink_id: str):
    """Delete a custom drink. Entries already logged with it stay."""
    return _pub()._delete_product(user_id, drink_id)


def update_ready_made_drink(user_id: str, drink_id: str, water_percent: float,
                            caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                            servings_ml: list = None):
    """Change the values of a ready-made drink (drink_id such as coffee or
    beer) for this user only; servings_ml, when given, replaces its serving
    sizes. Entries already logged keep their old values."""
    return _pub()._set_preset(user_id, drink_id, water_percent, caffeine_mg_100, alcohol_percent, servings_ml)


def reset_ready_made_drink(user_id: str, drink_id: str):
    """Put a ready-made drink back to its standard values and servings."""
    return _pub()._reset_preset(user_id, drink_id)


def set_drink_active(user_id: str, drink_id: str, active: bool):
    """Show (true) or hide (false) any drink, ready-made or custom, on the
    main screen of the Hydration window. Hidden drinks can still be logged
    through this API."""
    return _pub()._set_prefs(user_id, drink_id, active=bool(active))


def set_drink_servings(user_id: str, drink_id: str, servings_ml: list):
    """Replace the serving sizes (millilitres, at most 12) offered for any
    drink."""
    return _pub()._set_prefs(user_id, drink_id, servings=servings_ml)
