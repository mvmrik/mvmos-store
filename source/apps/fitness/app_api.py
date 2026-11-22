"""
Fitness' app-to-app and External API — the only way another app, mvmAI, a
script or a Shortcut should touch the training log. Every action runs the same
functions api.py's own routes use, reached through
sys.modules["app_public_fitness"] (api.py is loaded under that name by
backend/public_loader.py), so the numbers are exactly those of the Fitness
window.

user_id is always an Apps Hub public_users.id and every action only sees that
profile's own exercises, workouts and sessions.

Invalid input raises ValueError with a short reason; a missing item raises
LookupError("not found"). Weights are in kg, distances in km and times in
seconds (a session's length in minutes); a day is a YYYY-MM-DD date. An
exercise has a type that says which numbers a set has: weight_reps (weight and
reps), reps, time (secs), distance (dist and secs) or cardio (secs, optionally
dist). An exercise is found by its ref (r:<id> for ready-made, u:<id> for the
person's own), its id such as bench_press, or its English name.

A good order for an assistant: read get_overview, find the exercise with
list_exercises, then log_workout or start from a template, and tell the
person about any records it returns.
"""

import sys


def _pub():
    pub = sys.modules.get("app_public_fitness")
    if pub is None:
        raise RuntimeError("fitness api.py not loaded")
    return pub


def get_overview(user_id: str, days: int = 30):
    """How the person is training: totals for the last days days (sessions,
    minutes, estimated kcal, sets, kg lifted in total, km), sessions per week,
    sets per muscle group, the streak of days and of weeks that reached their
    weekly goal, this week's sessions against that goal and their most recent
    records. Use it first."""
    pub = _pub()
    return pub._stats(user_id, days)


def list_exercises(user_id: str, query: str = "", muscle: str = None, limit: int = 40):
    """Ready-made and the person's own exercises with ref, name (English for
    ready-made ones), type, muscle (chest, back, shoulders, biceps, triceps,
    forearms, abs, quads, hamstrings, glutes, calves, full_body, cardio) and
    equipment. query matches the name or id."""
    pub = _pub()
    q = str(query or "").strip().casefold().replace(" ", "_")
    with pub._db() as c:
        allx = list(pub._catalog().values()) + pub._custom_exercises(c, user_id)
    out = []
    for e in allx:
        if muscle and e["muscle"] != muscle:
            continue
        if q and q not in e["name"].casefold().replace(" ", "_") and q not in e["id"]:
            continue
        out.append({"ref": e["ref"], "name": e["name"], "type": e["type"], "muscle": e["muscle"], "equip": e["equip"]})
    return out[:max(1, min(int(limit or 40), 200))]


def create_exercise(user_id: str, name: str, type: str, muscle: str = "full_body", equip: str = "none"):
    """Add an exercise of the person's own. type is weight_reps, reps, time,
    distance or cardio; muscle and equip as in list_exercises (equip is
    barbell, dumbbell, machine, cable, bodyweight, kettlebell, bands,
    cardio_machine or none). Returns it with its ref."""
    return _pub()._add_exercise(user_id, {"name": name, "type": type, "muscle": muscle, "equip": equip})


def list_workouts(user_id: str):
    """The person's saved workouts (templates): name, mode (standard, circuit,
    interval), the weekdays they are planned for (0 Sunday to 6 Saturday) and
    the exercises with their sets and targets."""
    pub = _pub()
    with pub._db() as c:
        return pub._templates(c, user_id)


def create_workout(user_id: str, name: str, exercises: list, days: list = None, notes: str = ""):
    """Save a workout. exercises is a list of {exercise, sets, reps, weight,
    secs, dist, rest_s} in order (exercise a ref, id or English name; give
    reps for weight_reps and reps, secs for time and cardio, dist for
    distance; weight in kg or 0 to let the person choose). days are the
    weekdays it is planned for, 0 Sunday to 6 Saturday."""
    items = [dict(e, ex_ref=e.get("ex_ref") or e.get("exercise")) for e in (exercises or []) if isinstance(e, dict)]
    return _pub()._save_template(user_id, {"name": name, "notes": notes, "days": days or [], "items": items})


def list_sessions(user_id: str, start: str, end: str):
    """The finished sessions between two days (YYYY-MM-DD, at most 400 days
    apart), newest first: id, day, name, duration_s, estimated kcal, sets,
    volume in kg, the exercises done and how many sets broke a record."""
    return _pub()._sessions_range(user_id, start, end)


def get_session(user_id: str, session_id: str):
    """One session with every set (reps, weight, secs, dist, rpe, kind and the
    records the set broke) and, per exercise, what the person did the time before."""
    pub = _pub()
    with pub._db() as c:
        return pub._session_view(c, user_id, pub._get_session(c, user_id, session_id), with_prev=True)


def log_workout(user_id: str, day: str, name: str, exercises: list, duration_min: float = None, notes: str = ""):
    """Record a workout that has been done, in one go. exercises is a list of
    {exercise, sets: [{reps, weight, secs, dist, kind}]} (kind normal, warmup
    or failure). Give what each set has: reps and weight (kg) for weight_reps,
    reps for reps, secs for time, dist (km) and secs for distance, secs for
    cardio. duration_min is the length of the session; left out it is
    estimated from the sets. Returns the session with its estimated kcal and
    the records that were broken (records), which are worth telling the person."""
    return _pub()._log_session(user_id, day, name, exercises, duration_min, notes)


def delete_session(user_id: str, session_id: str):
    """Delete a session and its sets; the records are worked out again without it."""
    return _pub()._delete_session(user_id, session_id)


def get_exercise_stats(user_id: str, exercise: str):
    """Everything about one exercise: its records (best weight, estimated
    one-rep max, best set and session volume, best reps, longest time and
    distance, best pace, best weight per number of reps), a point per session
    for a chart and the last sessions with every set."""
    pub = _pub()
    with pub._db() as c:
        e = pub._find_exercise(c, user_id, exercise)
    return pub._exercise_stats(user_id, e["ref"])


def get_records(user_id: str):
    """The person's records for every exercise they have done."""
    return _pub()._records(user_id)
