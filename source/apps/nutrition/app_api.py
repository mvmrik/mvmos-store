"""
Nutrition's app-to-app and External API — the only way another app, mvmAI, a
script or a Shortcut should touch the food journal. Every action runs the same
functions api.py's own routes use, reached through
sys.modules["app_public_nutrition"] (api.py is loaded under that name by
backend/public_loader.py), so the values counted are exactly those of the
Nutrition window.

user_id is always an Apps Hub public_users.id and every action only sees that
profile's own journal, foods, goals and restrictions.

Invalid input raises ValueError with a short reason; a missing entry or food
raises LookupError("not found"). Amounts are in grams (millilitres for a
drink); a day is a YYYY-MM-DD date and defaults to the user's today on the
server. Every food has per 100 g or 100 ml: kcal, protein, carbs, sugar, fat,
sat_fat and fiber (all in g except kcal), salt (g) and water (g, which is ml
of water: 100 for water, about 93 for beer, about 90 for a soup). water is
optional and counts toward the person's water in Health: when the person
describes a food that is mostly water, such as a soup, a drink or a stew, give
a sensible water value; leave it 0 when it is not known. allergens is a list of
gluten, milk, eggs, peanuts, tree_nuts, soy, fish, shellfish, sesame, mustard,
celery, lupin, molluscs and sulphites.

A good order for an assistant: read get_profile, find or describe the food,
run check_food, tell the person what it found, and only then add_entry.

When the person describes something new that is not among their foods or
recipes, log it with add_entry: a single food you describe is kept among their
own foods automatically (like adding it by hand), so it is there next time. For
a dish made of several things ("a beef burger with fries, cabbage and
ketchup") log each part as its own entry with the same plate label, then ask
once whether to keep the whole dish as a recipe for next time. Only if they say
yes, save it with save_recipe and say it is saved; never make a recipe without
that yes, and do not ask again for something they already declined.
"""

import sys


def _pub():
    pub = sys.modules.get("app_public_nutrition")
    if pub is None:
        raise RuntimeError("nutrition api.py not loaded")
    return pub


def _food_dict(name, unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens, ingredients, water=0, tags=None):
    return {"name": name, "unit": unit, "kcal": kcal, "protein": protein, "carbs": carbs, "sugar": sugar,
            "fat": fat, "sat_fat": sat_fat, "fiber": fiber, "salt": salt, "water": water, "allergens": allergens or [],
            "tags": tags or [], "ingredients": ingredients or ""}


def get_profile(user_id: str):
    """Everything needed to judge a food for this person: goal_type (lose_weight,
    maintain, gain_muscle, healthier, high_protein, low_carb or custom),
    the daily goals (cal_min and cal_max, the calorie range the person wants to
    stay in, protein_min, carbs_max, sugar_max, fiber_min, salt_max; 0 means no
    goal), the body data (sex, age, height_cm, weight_kg, target_weight_kg,
    activity; when health_read is true, sex, age, height and weight are the
    person's current values from the Health app and cannot be changed here:
    ask them to change it in Health, and use Health's get_profile and
    record_weight for that), their restrictions (allergy, intolerance,
    avoid, good or limit, each with an allergen or tag key and, for a limit, the daily amount in g or ml) and today with what was eaten
    so far. When health_read is true, health_notes holds the conditions and
    medications the person wrote in Health (free text, may be empty): take them
    into account quietly when you suggest goals or foods, and do not repeat
    them back unless asked."""
    pub = _pub()
    with pub._db() as c:
        st = pub._settings_view(c, user_id)
        restr = pub._restrictions(c, user_id)
    today = pub._today(user_id)
    d = pub._get_day(user_id, today)
    out = {"settings": st, "restrictions": restr, "today": today, "totals": {k: round(v, 1) for k, v in d["totals"].items()},
           "entries": len(d["entries"])}
    if st.get("health_read") and st.get("health_ok"):
        hp = pub._health_profile(user_id) or {}
        out["health_notes"] = {"conditions": hp.get("conditions") or "", "medications": hp.get("medications") or ""}
    return out


def search_foods(user_id: str, query: str = "", lang: str = "en", online: bool = False, limit: int = 20,
                 meal: str = None):
    """Find foods by name in any language: the person's own foods and recipes
    first, then the ready-made list. An empty query gives what was eaten
    recently (with meal, what was usually eaten for that meal, each with the
    last_amount in g or ml). online true also asks Open Food Facts for packaged products. Each
    food has ref (use it as food in add_entry; online results have none until
    they are used), name, unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber
    salt and water per 100 g or ml, allergens and, for a recipe, portion. origin
    says where a food comes from: mine, standard (the app's own list) or shared
    (another profile's, with owner.name); the person's own come first, then the
    standard ones, then the shared ones."""
    pub = _pub()
    out = pub._search_foods(user_id, query, lang, max(1, min(int(limit), 50)), meal)
    if online:
        try:
            out["online"] = pub._search_online(query, 10)["foods"]
        except RuntimeError:
            out["online"] = []
            out["online_error"] = "offline"
    return out


def lookup_barcode(user_id: str, barcode: str):
    """The food behind a barcode (EAN/UPC): the person's own food first, then
    Open Food Facts. Returns the food with its values per 100 g or ml,
    allergens and ingredients; not found raises LookupError."""
    return _pub()._barcode(user_id, barcode)


def check_food(user_id: str, food: str = None, amount: float = 100, name: str = None, unit: str = "g",
               kcal: float = 0, protein: float = 0, carbs: float = 0, sugar: float = 0, fat: float = 0,
               sat_fat: float = 0, fiber: float = 0, salt: float = 0, water: float = 0, allergens: list = None,
               ingredients: str = None, day: str = None, tags: list = None):
    """Weigh something that is about to be eaten against the person's allergies,
    intolerances, foods to avoid, goals and the day so far, before it is logged.
    Give food (a ref or a name of a known food) or describe it with name and its
    values per 100 g or ml, plus ingredients as printed on the label so
    allergens can be spotted in the text. amount is in grams or ml. Returns
    verdict (ok, caution or avoid), good (the person's "good for me" labels the
    food has), warnings (allergy, intolerance, avoid, over_limit,
    high_sugar, high_sat_fat, high_salt, over_calories, over_sugar, over_salt,
    over_carbs, calorie_dense) and what this portion and the day so far add up
    to against the goals.
    TAGS are labels a food carries, the same in every language: fried, grilled,
    baked, boiled, raw, smoked, cured (how it was prepared), processed,
    processed_meat, red_meat, poultry, vegetable, fruit, citrus, tomato, legume,
    whole_grain, nuts_seeds, sweets, sugary_drink, caffeine, alcohol, spicy (what
    kind of food it is). Standard foods already have them; whenever you describe
    a food yourself (name and values, or add_custom_food), give the tags that
    fit it, for example fried for French fries or grilled and poultry for a
    grilled chicken breast. The person's restrictions work by these tags."""
    pub = _pub()
    if food:
        item = food
    else:
        item = _food_dict(name or "-", unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens, ingredients, water, tags)
    return pub._check(user_id, item, amount, day)


def add_entry(user_id: str, amount: float, food: str = None, name: str = None, unit: str = "g", kcal: float = 0,
              protein: float = 0, carbs: float = 0, sugar: float = 0, fat: float = 0, sat_fat: float = 0,
              fiber: float = 0, salt: float = 0, water: float = 0, allergens: list = None, ingredients: str = None,
              meal: str = None, day: str = None, save: bool = True, count: float = None, tags: list = None, plate: str = None):
    """Log something eaten. First look the food up with search_foods (the person's own
    foods and recipes come first) and, when it is there, pass its ref as food; only
    when it is not there describe it with name and values. Either food (a ref such as b:apple or u:abc123, or a
    name in any language of a known food or recipe) or name with its values per
    100 g or ml (unit g or ml; kcal, protein, carbs, sugar, fat, sat_fat, fiber
    in g and salt in g). amount is in grams or millilitres; for a food or recipe
    that has a portion (a slice, a piece; search_foods shows portion) give count,
    how many were eaten (2 for two slices), and the amount follows from it; a recipe's portion
    is its weight, which search_foods shows. meal is the id or the name of one
    of the person's meals (see list_meals; leave it out to use the meal whose
    time is nearest to now, and always tell the person which meal you used, or
    ask when it is unclear, since they may have missed one); day defaults to today. When what was eaten is new
    (not among the person's foods or recipes), describe it with name and values:
    it is kept among the person's own foods automatically (save defaults to
    true; pass false only if they ask not to keep it), and an own food with the
    same name is reused instead of duplicated. Say that it was added to their
    foods. Ask before making a recipe of a dish of several things. water is the grams (ml) of
    water per 100 g or ml of the food, for example 85 for a chicken soup. Returns the
    entry with what it counts and today, the day's totals (with what other apps
    sent Health when the person takes that into account). When you describe a
    food by name, always fill in your best estimate of kcal, protein, carbs,
    sugar, fat, sat_fat, fiber, salt and water per 100 g or ml (for a chicken
    soup roughly 35 kcal, 3 protein, 3 carbs, 1 fat, 0.5 fiber, 0.6 salt and 90
    water); never leave them all at 0, and give amount in grams or ml (a bowl
    of soup is about 300).
    TAGS are labels a food carries, the same in every language: fried, grilled,
    baked, boiled, raw, smoked, cured (how it was prepared), processed,
    processed_meat, red_meat, poultry, vegetable, fruit, citrus, tomato, legume,
    whole_grain, nuts_seeds, sweets, sugary_drink, caffeine, alcohol, spicy (what
    kind of food it is). Standard foods already have them; whenever you describe
    a food yourself (name and values, or add_custom_food), give the tags that
    fit it, for example fried for French fries or grilled and poultry for a
    grilled chicken breast. The person's restrictions work by these tags.
    plate marks foods eaten together: when the person ate several things as one
    plate or meal ("a pork chop with lutenitsa, baked potatoes and cucumbers"),
    add each one as its own entry with the same short plate label (for example
    "pork chop plate") and the same meal and day. The app then offers the whole
    combination next time. Do not make a recipe of it unless the person asks."""
    pub = _pub()
    day = day or pub._today(user_id)
    group = pub._plate_group(user_id, day, plate)
    if food:
        out = pub._add_entry(user_id, day, food, amount, meal, None, "en", count, group)
    else:
        if not name:
            raise ValueError("food or name required")
        if not any(float(x or 0) > 0 for x in (kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, water)):
            # Nothing described: the person may already have this food or recipe under that name.
            try:
                known = pub._find_by_name(user_id, name, "en")
            except Exception:
                known = None
            if known:
                out = pub._add_entry(user_id, day, name, amount, meal, None, "en", count, group)
                out["today"] = {k: round(v, 1) for k, v in pub._get_day(user_id, day)["totals"].items()}
                return out
            raise ValueError("the values per 100 g are required: give your best estimate of kcal, protein, carbs, "
                             "sugar, fat, sat_fat, fiber, salt and water instead of leaving them all at 0")
        try:
            known = pub._find_by_name(user_id, name, "en")
        except Exception:
            known = None
        if known and str(known.get("ref", "")).startswith("u:"):
            # Already one of the person's own foods: use it, do not add a duplicate.
            out = pub._add_entry(user_id, day, known["ref"], amount, meal, None, "en", count, group)
            out["today"] = {k: round(v, 1) for k, v in pub._get_day(user_id, day)["totals"].items()}
            return out
        item = _food_dict(name, unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens, ingredients, water, tags)
        item["save"] = bool(save)
        out = pub._add_entry(user_id, day, None, amount, meal, item, "en", None, group)
    out["today"] = {k: round(v, 1) for k, v in pub._get_day(user_id, day)["totals"].items()}
    return out


def update_entry(user_id: str, entry_id: str, amount: float = None, meal: str = None, count: float = None):
    """Change the amount (g or ml) and/or the meal (id or name, see list_meals)
    of a logged entry; for an entry logged by count, count (pieces) changes the
    amount from it."""
    return _pub()._edit_entry(user_id, entry_id, amount, meal, count)


def delete_entry(user_id: str, entry_id: str):
    """Remove one logged entry."""
    return _pub()._delete_entry(user_id, entry_id)


def get_day(user_id: str, day: str = None):
    """What was eaten on one day (day defaults to today): entries (id, meal,
    name, amount, unit and the kcal, protein, carbs, sugar, fat, sat_fat, fiber
    salt and water each counts), the totals, the person's goals and warnings, the
    entries that run into one of their restrictions. When the person takes
    other apps' data from Health, totals include what those apps sent Health for
    the day (for example a drink logged in Hydration), own_totals is only what
    was logged here and other lists those apps by name with their amounts."""
    pub = _pub()
    return pub._get_day(user_id, day or pub._today(user_id))


def get_history(user_id: str, days: int = 7, end: str = None):
    """Daily totals (day, kcal, protein, carbs, sugar, fat, sat_fat, fiber,
    salt, water and the number of entries) for the last days days (1 to 90, default
    7) up to and including end, which defaults to today."""
    pub = _pub()
    return {"days": pub._get_history(user_id, end or pub._today(user_id), days)}


def list_foods(user_id: str):
    """The person's own foods and recipes (kind food or recipe), with their
    values per 100 g or ml, allergens, ingredients and, for a recipe, its
    portion in grams and the ingredient rows."""
    return {"foods": _pub()._list_user_foods(user_id)}


def add_custom_food(user_id: str, name: str, unit: str = "g", kcal: float = 0, protein: float = 0,
                    carbs: float = 0, sugar: float = 0, fat: float = 0, sat_fat: float = 0, fiber: float = 0,
                    salt: float = 0, water: float = 0, allergens: list = None, ingredients: str = None, barcode: str = None,
                    portion: float = None, shared: bool = None, tags: list = None):
    """Create a food of the person's own with its values per 100 g or ml
    (unit g or ml), the allergens it holds, its tags (see TAGS below), its ingredients as text, an optional
    barcode and an optional usual portion in grams. shared true lets the other
    profiles on this server find and use it (they cannot change it), false keeps
    it private. Unless the person already said, ask whether to share it; if you
    leave shared out, it follows what they chose last time. Returns it with its ref.
    TAGS are labels a food carries, the same in every language: fried, grilled,
    baked, boiled, raw, smoked, cured (how it was prepared), processed,
    processed_meat, red_meat, poultry, vegetable, fruit, citrus, tomato, legume,
    whole_grain, nuts_seeds, sweets, sugary_drink, caffeine, alcohol, spicy (what
    kind of food it is). Standard foods already have them; whenever you describe
    a food yourself (name and values, or add_custom_food), give the tags that
    fit it, for example fried for French fries or grilled and poultry for a
    grilled chicken breast. The person's restrictions work by these tags."""
    item = _food_dict(name, unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens, ingredients, water, tags)
    item["barcode"], item["portion"] = barcode, portion
    pub = _pub()
    item["shared"] = pub._share_default(user_id) if shared is None else bool(shared)
    pub._remember_share(user_id, item["shared"])
    return pub._add_food(user_id, item)


def update_custom_food(user_id: str, food_id: str, name: str, unit: str = "g", kcal: float = 0, protein: float = 0,
                       carbs: float = 0, sugar: float = 0, fat: float = 0, sat_fat: float = 0, fiber: float = 0,
                       salt: float = 0, water: float = 0, allergens: list = None, ingredients: str = None, barcode: str = None,
                       portion: float = None, tags: list = None):
    """Replace the values of one of the person's own foods (food_id is the
    part of its ref after u:). Entries already logged keep their old values."""
    item = _food_dict(name, unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens, ingredients, water, tags)
    item["barcode"], item["portion"] = barcode, portion
    return _pub()._edit_food(user_id, food_id, item)


def delete_custom_food(user_id: str, food_id: str):
    """Delete one of the person's own foods or recipes. Entries already
    logged stay."""
    return _pub()._delete_food(user_id, food_id)


def save_recipe(user_id: str, name: str, ingredients: list, portions: float = 1, total_g: float = None,
                shared: bool = None, tags: list = None):
    """Save a dish as a recipe so it can be picked again. ingredients is a list
    of {food, amount} (food a ref or a name of a known food) or {name, amount,
    unit, kcal, protein, carbs, sugar, fat, sat_fat, fiber, salt, allergens}
    with the values per 100 g or ml. The recipe's values per 100 g are worked
    out from the amounts. total_g is the weight of the finished dish (it
    defaults to the ingredients' weights added up) and portions how many
    portions it makes; one portion is total_g divided by portions. Returns the
    recipe with its ref; log it with add_entry using that ref and an amount in
    grams. Use it only when the person has agreed to keep the dish; after
    saving, tell them it is saved and can be picked or logged by name next time.
    shared true lets the other profiles on this server find and use it (they
    cannot change it), false keeps it private. Unless the person already said,
    ask whether to share it; if you leave shared out, it follows what they chose
    last time. They can change it later in Nutrition, where recipes can also be edited.
    tags are the labels of the finished dish (fried, grilled, baked, boiled, raw,
    smoked, cured, processed, processed_meat, red_meat, poultry, vegetable,
    fruit, citrus, tomato, legume, whole_grain, nuts_seeds, sweets,
    sugary_drink, caffeine, alcohol, spicy); leave them out to take the labels
    of the ingredients, but give them when the cooking changes the dish (a dish
    of potatoes that is fried is fried). The person's restrictions work by them."""
    pub = _pub()
    shared = pub._share_default(user_id) if shared is None else bool(shared)
    pub._remember_share(user_id, shared)
    return pub._save_recipe(user_id, name, ingredients, portions, total_g, "en", shared, None, tags)


def set_goals(user_id: str, goal_type: str = None, cal_min: float = None, cal_max: float = None,
              protein_min: float = None, carbs_max: float = None, sugar_max: float = None,
              fiber_min: float = None, salt_max: float = None, sex: str = None, age: int = None,
              height_cm: float = None, weight_kg: float = None, target_weight_kg: float = None,
              activity: float = None):
    """Set the goal and the body data; what is left out stays as it was. When
    the person has chosen to take their body data from Health (health_read in
    get_profile), sex, age, height_cm and weight_kg are ignored here.
    goal_type is lose_weight, maintain, gain_muscle, healthier, high_protein,
    low_carb or custom. cal_min and cal_max are the calories per day the
    person wants to stay between (not only a ceiling: a day below cal_min is
    too little), protein_min, fiber_min are minimums in g, carbs_max,
    sugar_max in g and salt_max in g maximums; 0 removes a goal. sex is m or f,
    activity 1.2 (sitting), 1.375 (light), 1.55 (moderate), 1.725 (hard) or 1.9
    (very hard)."""
    data = {k: v for k, v in dict(goal_type=goal_type, cal_min=cal_min, cal_max=cal_max, protein_min=protein_min,
                                  carbs_max=carbs_max, sugar_max=sugar_max, fiber_min=fiber_min, salt_max=salt_max,
                                  sex=sex, age=age, height_cm=height_cm, weight_kg=weight_kg,
                                  target_weight_kg=target_weight_kg, activity=activity).items() if v is not None}
    return _pub()._save_settings(user_id, data)


def suggest_goals(user_id: str, sex: str, age: float, height_cm: float, weight_kg: float, goal_type: str = "maintain",
                  activity: float = 1.375, target_weight_kg: float = 0):
    """Work out a starting point for the goals from the body data (Mifflin-St
    Jeor): bmr, tdee, a calorie range cal_min to cal_max, protein_min and the
    limits for carbohydrates, sugars, fibre and salt that suit goal_type, and for lose_weight roughly how many weeks a
    pace of 0.5 kg a week takes. It only returns numbers; set_goals saves
    them, after the person has had a chance to change them."""
    return _pub().suggest_goals(sex, age, height_cm, weight_kg, activity, goal_type, target_weight_kg)


def list_restrictions(user_id: str):
    """The person's allergies, intolerances, foods to avoid and foods that are
    good for them and their daily limits: id, kind (allergy, intolerance, avoid, good or limit), key (an
    allergen or a food tag) and, for a limit, amount in g or ml a day."""
    pub = _pub()
    with pub._db() as c:
        return {"restrictions": pub._restrictions(c, user_id)}


def add_restriction(user_id: str, kind: str, key: str, amount: float = None):
    """Build the person's diet from fixed choices, never free text. kind is
    allergy, intolerance (both are warned about), avoid (do not eat it), good
    (favour it; shown as a positive note) or limit (at most amount grams or ml
    a day of it, for example nuts_seeds 30). key is one allergen (gluten, milk,
    eggs, peanuts, tree_nuts, soy, fish, shellfish, sesame, mustard, celery,
    lupin, molluscs, sulphites) or one food tag (fried, grilled, baked, boiled,
    raw, smoked, cured, processed, processed_meat, red_meat, poultry, vegetable,
    fruit, citrus, tomato, legume, whole_grain, nuts_seeds, sweets,
    sugary_drink, caffeine, alcohol, spicy). Every food carries such tags, so
    when the person adds a food that falls under an avoid or over a limit the
    app says so. Add one entry per key and give the reasons in the chat, never
    in the entry. Habits that are not a food or a tag (late meals) are only
    mentioned in the chat. Daily limits of salt, sugar, carbs and calories are
    goals: set them with set_goals (salt_max, sugar_max, carbs_max, cal_max).
    Adding the same kind and key again only updates the amount. To change one
    otherwise, delete it and add it again."""
    return _pub()._add_restriction(user_id, kind, key, "", amount)


def delete_restriction(user_id: str, restriction_id: str):
    """Forget one allergy, intolerance, food to avoid or good food."""
    return _pub()._delete_restriction(user_id, restriction_id)


def list_meals(user_id: str):
    """The person's meals in the order of the day: id, label (the name shown),
    icon, time (HH:MM, empty when it has none). They start as breakfast, lunch,
    dinner and snack and the person may have renamed them or added their own.
    Use an id or a label as meal when logging."""
    return {"meals": [{k: m[k] for k in ("id", "label", "icon", "time")} for m in _pub()._list_meals(user_id)]}


def save_meal(user_id: str, name: str = None, meal: str = None, time: str = None, icon: str = None):
    """Add a meal (name, optional time as HH:MM and icon as one emoji), or
    change an existing one (meal is its id or label; send only what changes;
    an empty time removes the time). At most 12 meals."""
    pub = _pub()
    return pub._save_meal(user_id, pub._resolve_meal(user_id, meal) if meal else None, name, icon, time)


def delete_meal(user_id: str, meal: str):
    """Delete one of the person's meals (id or label). What was logged under it
    stays and shows as Other; one meal always remains."""
    pub = _pub()
    return pub._delete_meal(user_id, pub._resolve_meal(user_id, meal))
