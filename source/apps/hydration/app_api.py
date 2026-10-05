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
YYYY-MM-DD date and defaults to the user's today on the server, which before
the hour they chose as the end of their day (day_end_hour) is still yesterday. Every drink also has
energy (calories_kcal_100), sugar (sugar_g_100) and protein (protein_g_100)
per 100 ml. Solid foods that hold water, such as soup, yogurt and fruit, are
logged by weight: one gram counts as one millilitre.
"""

import os
import re
import sys


def _pub():
    pub = sys.modules.get("app_public_hydration")
    if pub is None:
        raise RuntimeError("hydration api.py not loaded")
    return pub


def _resolve_drink(pub, user_id, drink):
    """A ready-made drink id, a custom drink id or, failing those, a name (any
    letter case): a custom drink's, the user's own name for a ready-made drink
    or the standard name of a ready-made drink in any language."""
    drink = (drink or "water").strip()
    wanted = drink.casefold()
    with pub._db() as c:
        if pub._find_product(c, user_id, drink):
            return drink
        # SQLite's lower() only knows Latin letters, so names are compared here.
        for row in c.execute("SELECT id,name FROM products WHERE user_id=?", (user_id,)):
            if row["name"].casefold() == wanted:
                return row["id"]
        for row in c.execute("SELECT product_id,name FROM preset_overrides WHERE user_id=? AND name<>''", (user_id,)):
            if row["name"].casefold() == wanted:
                return row["product_id"]
    for names in _all_standard_names().values():
        for pid, name in names.items():
            if name.casefold() == wanted:
                return pid
    raise LookupError("not found")


_I18N = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public", "i18n.js")


def _all_standard_names():
    """The translated names of the ready-made drinks, language by language,
    read from the window's own i18n.js so there is a single source."""
    try:
        with open(_I18N, encoding="utf-8") as f:
            src = f.read()
    except OSError:
        return {}
    blocks = {}
    parts = re.split(r'^    "?([A-Za-z-]+)"?: \{\s*$', src, flags=re.M)
    for code, body in zip(parts[1::2], parts[2::2]):
        blocks[code.lower()] = dict(re.findall(r'^\s+hy_p_(\w+): "((?:[^"\\]|\\.)*)"', body, flags=re.M))
    return blocks


def _standard_names(lang):
    """The standard names in one language; English when the language or a name
    is missing."""
    blocks = _all_standard_names()
    pick = blocks.get((lang or "en").lower()) or blocks.get((lang or "en").lower().split("-")[0]) or {}
    return {**blocks.get("en", {}), **pick}


def list_drinks(user_id: str, sort: str = "recent", active_only: bool = False, lang: str = "en",
                drink: str = None, fields: str = None):
    """The drinks that can be logged: ready-made ones (id such as water,
    coffee, beer) and the user's own custom drinks. Each has id, name (a custom
    drink's name, or the user's own name for a ready-made one, empty when it
    has none), label (name, otherwise the standard name of a ready-made drink
    in lang, one of bg, de, en, es, fr, ja, pt-BR, ru, zh-CN), water_percent, caffeine_mg_100 per 100 ml, alcohol_percent (alcohol
    by volume), calories_kcal_100, sugar_g_100, protein_g_100 per 100 ml, active (shown on the main screen),
    last_used (when it was last logged, or null),
    servings (a list of {ml, last_used}), color (#rrggbb) and icon (an emoji).
    A ready-made drink the user has changed shows their values and modified
    true. sort is recent (the default, as in the app: the drink and, inside
    it, the serving logged most recently first; never used ones follow,
    servings from the smallest) or name (alphabetical, servings from the
    smallest). active_only true leaves out the hidden drinks. Ready-made and
    custom drinks come as one list under drinks, each marked with kind (ready
    or custom). drink (an id or a name, as add_entry takes it) returns that
    one drink, hidden or not, under drink instead of drinks. fields is the
    comma separated names of the fields to return instead of all of them: a
    single field gives a plain list of its values (or, with drink, the plain
    value), several give objects with only those fields. servings_ml, which
    only fields can ask for, is the serving sizes as a plain list of
    millilitres. Example: fields label lists the names; drink coffee with
    fields servings_ml gives the sizes of coffee."""
    if sort not in ("recent", "name"):
        raise ValueError("sort must be recent or name")
    pub = _pub()
    with pub._db() as c:
        drinks = pub._drinks(c, user_id)
    if drink:
        wanted = _resolve_drink(pub, user_id, drink)
        drinks = [d for d in drinks if d["id"] == wanted]
    elif active_only:
        drinks = [d for d in drinks if d["active"]]
    standard = _standard_names(lang)
    for d in drinks:
        d["label"] = d.get("name") or standard.get(d["id"]) or d["id"]
        used = sorted((s for s in d["servings"] if s["last_used"]), key=lambda s: s["last_used"], reverse=True)
        rest = sorted((s for s in d["servings"] if not s["last_used"]), key=lambda s: s["ml"])
        d["servings"] = used + rest if sort == "recent" else sorted(d["servings"], key=lambda s: s["ml"])
    if sort == "recent":
        drinks.sort(key=lambda d: d.get("last_used") or "", reverse=True)
    else:
        drinks.sort(key=lambda d: d["label"].lower())
    for d in drinks:
        d["servings_ml"] = [s["ml"] for s in d["servings"]]
    if fields is None or not str(fields).strip():
        shaped = [{k: v for k, v in d.items() if k != "servings_ml"} for d in drinks]
    else:
        names = [f.strip() for f in str(fields).split(",") if f.strip()]
        unknown = [f for f in names if f not in drinks[0]] if drinks else []
        if unknown:
            raise ValueError("unknown field: " + ", ".join(unknown))
        shaped = [d[names[0]] if len(names) == 1 else {f: d[f] for f in names} for d in drinks]
    return {"drink": shaped[0]} if drink else {"drinks": shaped}


def get_day(user_id: str, day: str = None):
    """The drinks logged on one day (newest first, day defaults to today)
    with totals: amount_ml, water_ml (only the water in the drinks),
    caffeine_mg, alcohol_g, calories_kcal, sugar_g and protein_g. Each entry has
    id, name, amount_ml, water_ml, caffeine_mg, alcohol_g, calories_kcal,
    sugar_g and protein_g."""
    pub = _pub()
    return pub._get_day(user_id, day or pub._today(user_id))


def get_history(user_id: str, days: int = 7, end: str = None):
    """Daily totals (day, amount_ml, water_ml, caffeine_mg, alcohol_g, calories_kcal,
    sugar_g, protein_g, and drinks: the amount_ml and water_ml of each drink
    that day) for the last days days (1 to 90, default 7) up to and including
    end, which defaults to today."""
    pub = _pub()
    return {"days": pub._get_history(user_id, end or pub._today(user_id), days)}


def get_target(user_id: str):
    """The user's daily water target in millilitres, their unit (ml or oz)
    and day_end_hour, the hour (0 to 8) at which their day ends."""
    pub = _pub()
    with pub._db() as c:
        return pub._settings(c, user_id)


def add_entry(user_id: str, amount_ml: float, drink: str = "water", day: str = None):
    """Log a drink. drink is a ready-made drink id or a custom drink's id or
    name, or a label from list_drinks, and defaults to water; day defaults to today.
    Returns the entry with the water, caffeine and alcohol it counts, and
    today: the water_ml of the whole day so far, the target_ml and the percent
    of the target reached (rounded)."""
    pub = _pub()
    day = day or pub._today(user_id)
    out = pub._add_entry(user_id, day, amount_ml, _resolve_drink(pub, user_id, drink))
    total = pub._get_day(user_id, day)
    target = total["target_ml"]
    out["today"] = {"water_ml": total["totals"]["water_ml"], "target_ml": target,
                    "percent": round(total["totals"]["water_ml"] / target * 100) if target else None}
    return out


def update_entry(user_id: str, entry_id: str, amount_ml: float):
    """Change the amount of a logged drink; its drink stays the same."""
    return _pub()._set_amount(user_id, entry_id, amount_ml)


def delete_entry(user_id: str, entry_id: str):
    """Remove one logged drink."""
    return _pub()._delete_entry(user_id, entry_id)


def add_custom_drink(user_id: str, name: str, water_percent: float = 100,
                     caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                     servings_ml: list = None, calories_kcal_100: float = 0,
                     sugar_g_100: float = 0, protein_g_100: float = 0,
                     icon: str = None, color: str = None):
    """Create a custom drink: water_percent of it is water (0 to 100),
    caffeine_mg_100 is mg of caffeine per 100 ml, alcohol_percent is alcohol
    by volume, calories_kcal_100, sugar_g_100 and protein_g_100 its energy,
    sugar and protein per 100 ml, servings_ml the serving sizes offered for it
    in millilitres (default 150, 250 and 500), icon an emoji and color a
    #rrggbb colour. Returns it with its id."""
    return _pub()._add_product(user_id, name, water_percent, caffeine_mg_100, alcohol_percent, servings_ml,
                               None, calories_kcal_100, sugar_g_100, protein_g_100, icon, color)


def update_custom_drink(user_id: str, drink_id: str, name: str, water_percent: float = 100,
                        caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                        servings_ml: list = None, calories_kcal_100: float = None,
                        sugar_g_100: float = None, protein_g_100: float = None,
                        icon: str = None, color: str = None):
    """Change a custom drink; servings_ml, when given, replaces its serving
    sizes, and energy, sugar, protein, icon or color left out stay as they
    were. Entries already logged keep their old values."""
    return _pub()._edit_product(user_id, drink_id, name, water_percent, caffeine_mg_100,
                                alcohol_percent, servings_ml, None,
                                calories_kcal_100, sugar_g_100, protein_g_100, icon, color)


def delete_custom_drink(user_id: str, drink_id: str):
    """Delete a custom drink. Entries already logged with it stay."""
    return _pub()._delete_product(user_id, drink_id)


def update_ready_made_drink(user_id: str, drink_id: str, water_percent: float,
                            caffeine_mg_100: float = 0, alcohol_percent: float = 0,
                            servings_ml: list = None, calories_kcal_100: float = None,
                            sugar_g_100: float = None, protein_g_100: float = None,
                            color: str = None, name: str = None):
    """Change the values of a ready-made drink (drink_id such as coffee or
    beer) for this user only; servings_ml, when given, replaces its serving
    sizes, and energy, sugar, protein or color (#rrggbb) left out stay as
    they were. name gives the drink the user's own name (an empty one brings
    back the standard, translated name); left out it stays as it is. Entries
    already logged keep their old values."""
    return _pub()._set_preset(user_id, drink_id, water_percent, caffeine_mg_100, alcohol_percent, servings_ml,
                              None, calories_kcal_100, sugar_g_100, protein_g_100, color, name)


def reset_ready_made_drink(user_id: str, drink_id: str):
    """Put a ready-made drink back to its standard values, servings and colour."""
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
