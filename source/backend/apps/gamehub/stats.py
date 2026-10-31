"""
Game Hub — generic statistics engine.

The hub knows nothing about any game. A game describes what it measures in its
own manifest.json, under a "gamehub" key, and reports plain numbers when a
session ends:

    "gamehub": {
        "score":   {"label": {"en": "Points", "bg": "Точки"}, "better": "high"},
        "ranking": "waves",                         # what orders the solo ladder (default "score")
        "metrics": {
            "waves": {"label": {"en": "Waves"}, "type": "number", "better": "high"},
            "time":  {"label": {"en": "Time"},  "type": "duration", "better": "low", "total": false}
        }
    }

    await ctx.finish(records, stats={"rounds": 8})          # numbers about the whole session
    records[i]["stats"] = {"waves": 9, "kills": 118}         # numbers about one player

Metric types: number, decimal, duration (seconds), percent (0-100).
`better` is "high" or "low"; `total` says whether a sum over many sessions
means anything (default true, false for percent).

Everything below works from those declarations alone: boards per metric, a
player's place among the others, a rating for multiplayer, records, trends and
the cross-game ranking. It never branches on a game id.
"""

import json
import math
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone

_BASE = os.path.dirname(__file__)
APPS_DIR = os.path.join(_BASE, "..", "..", "..", "apps")      # apps/<game_id>/manifest.json

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_TYPES = ("number", "decimal", "duration", "percent")
MAX_STAT_KEYS = 40

ELO_START = 1000.0
ELO_K = 32.0
ELO_K_NEW = 48.0
ELO_NEW_GAMES = 8
# A ladder position only counts fully once a player has this many sessions in
# it, so one lucky run cannot outrank somebody who has proven themselves.
CONFIDENCE_GAMES = 5


# ── Schema ───────────────────────────────────────────────────────────────────

def ensure_schema(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS session_metrics (
            session_id INTEGER NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
            player_id  TEXT,
            key        TEXT NOT NULL,
            value      REAL NOT NULL
        )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sm_session ON session_metrics(session_id)")
    conn.execute("""CREATE TABLE IF NOT EXISTS stage_results (
        game_id TEXT NOT NULL, stage TEXT NOT NULL, room_id TEXT NOT NULL,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        score REAL NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(game_id, stage, room_id, player_id)
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_stage_best ON stage_results(game_id,stage,player_id,score)")


def stage_records(conn, game_id, stage, player_id):
    ensure_schema(conn)
    row = conn.execute("""SELECT MAX(score) AS overall,
        MAX(CASE WHEN player_id=? THEN score END) AS personal
        FROM stage_results WHERE game_id=? AND stage=?""", (player_id, game_id, stage)).fetchone()
    return {"stage": stage, "personal": row["personal"], "overall": row["overall"]}



def clean_stats(raw):
    """Only finite numbers under short snake_case keys survive."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if len(out) >= MAX_STAT_KEYS:
            break
        if not isinstance(k, str) or not _KEY_RE.match(k):
            continue
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        v = float(v)
        if math.isfinite(v):
            out[k] = v
    return out


def write_metrics(conn, session_id, player_id, raw):
    for k, v in clean_stats(raw).items():
        conn.execute("INSERT INTO session_metrics(session_id,player_id,key,value) VALUES(?,?,?,?)",
                     (session_id, player_id, k, v))


# ── Declarations ─────────────────────────────────────────────────────────────

_decl_cache = {}


def _label(raw):
    if isinstance(raw, str) and raw.strip():
        return {"en": raw.strip()}
    if isinstance(raw, dict):
        out = {str(k): str(v) for k, v in raw.items() if isinstance(v, str) and v.strip()}
        return out or None
    return None


def _metric(key, raw, default_total=True):
    raw = raw if isinstance(raw, dict) else {}
    typ = raw.get("type") if raw.get("type") in _TYPES else "number"
    total = raw.get("total")
    if not isinstance(total, bool):
        total = default_total and typ != "percent"
    return {
        "key": key,
        "label": _label(raw.get("label")),
        "type": typ,
        "better": "low" if raw.get("better") == "low" else "high",
        "total": total,
    }


def declaration(game_id):
    """The game's own description of what it measures, normalised. The first
    metric is always the session score every game already reports."""
    if not _ID_RE.match(game_id or ""):
        return _normalise({})
    path = os.path.join(APPS_DIR, game_id, "manifest.json")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return _normalise({})
    hit = _decl_cache.get(game_id)
    if hit and hit[0] == mtime:
        return hit[1]
    try:
        with open(path, encoding="utf-8") as f:
            raw = (json.load(f).get("gamehub") or {})
    except Exception:
        raw = {}
    decl = _normalise(raw if isinstance(raw, dict) else {})
    _decl_cache[game_id] = (mtime, decl)
    return decl


def _normalise(raw):
    # "score": false hides the session score from the boards, for a game whose
    # scores cannot be compared from one session to the next.
    metrics = [] if raw.get("score") is False else [_metric("score", raw.get("score"))]
    declared = raw.get("metrics") if isinstance(raw.get("metrics"), dict) else {}
    for k, v in declared.items():
        if isinstance(k, str) and _KEY_RE.match(k) and k != "score":
            metrics.append(_metric(k, v))
    keys = {m["key"] for m in metrics}
    # Besides any metric, a game can rank its solo ladder by "win_rate", "wins"
    # or "played". Win rate is the one that cannot be earned by playing more.
    default = "score" if "score" in keys else "win_rate"
    ranking = raw.get("ranking") if raw.get("ranking") in keys | {"win_rate", "wins", "played"} else default
    return {"metrics": metrics, "ranking": ranking}


def _rank_values(table, decl):
    """pid -> the number the solo ladder orders by, and which way is better."""
    key = decl["ranking"]
    if key in ("win_rate", "wins", "played"):
        return {pid: r["win_rate_adj" if key == "win_rate" else key] for pid, r in table.items()}, "high"
    better = _by_key(decl)[key]["better"]
    return {pid: r["best"][key] for pid, r in table.items() if key in r["best"]}, better


def _by_key(decl):
    return {m["key"]: m for m in decl["metrics"]}


# ── Loading ──────────────────────────────────────────────────────────────────

def backfill(conn, game_id, decl):
    """Older sessions kept their numbers in the free-form metadata. For the
    keys the game now declares, copy them across once. Only a solo session is
    unambiguous - in a shared one a bare number does not say whose it is."""
    keys = sorted(m["key"] for m in decl["metrics"] if m["key"] != "score")
    if not keys:
        return
    marker = f"metrics_backfill:{game_id}"
    stamp = ",".join(keys)
    row = conn.execute("SELECT value FROM hub_settings WHERE key=?", (marker,)).fetchone()
    if row and row[0] == stamp:
        return
    rows = conn.execute("""
        SELECT s.id, s.metadata, (SELECT sp.player_id FROM session_players sp WHERE sp.session_id=s.id LIMIT 1) AS pid
        FROM game_sessions s
        WHERE s.game_id=? AND (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id=s.id)=1
    """, (game_id,)).fetchall()
    for sid, meta, pid in rows:
        try:
            data = clean_stats(json.loads(meta or "{}"))
        except Exception:
            continue
        for k in keys:
            if k not in data:
                continue
            if conn.execute("SELECT 1 FROM session_metrics WHERE session_id=? AND key=?", (sid, k)).fetchone():
                continue
            conn.execute("INSERT INTO session_metrics(session_id,player_id,key,value) VALUES(?,?,?,?)",
                         (sid, pid, k, data[k]))
    conn.execute("INSERT OR REPLACE INTO hub_settings(key,value) VALUES(?,?)", (marker, stamp))
    conn.commit()


def period_start(period):
    days = {"week": 7, "month": 30, "year": 365}.get(period)
    if not days:
        return None
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _load(conn, game_id, mode, since):
    """-> list of sessions, each with its registered players and their numbers."""
    where, args = ["s.game_id=?"], [game_id]
    if mode == "single":
        where.append("s.mode='singleplayer'")
    elif mode == "multi":
        where.append("s.mode='multiplayer'")
    if since:
        where.append("s.played_at>=?")
        args.append(since)
    cond = " AND ".join(where)
    sess = {}
    for r in conn.execute(f"SELECT s.id,s.played_at,s.duration_seconds,s.mode FROM game_sessions s WHERE {cond} ORDER BY s.played_at,s.id", args):
        sess[r[0]] = {"id": r[0], "t": r[1], "dur": r[2], "mode": r[3], "players": [], "shared": {}}
    if not sess:
        return []
    for r in conn.execute(f"""SELECT sp.session_id,sp.player_id,sp.score,sp.rank,sp.is_winner
                              FROM session_players sp JOIN game_sessions s ON s.id=sp.session_id
                              WHERE {cond} AND sp.player_id IS NOT NULL""", args):
        sess[r[0]]["players"].append({"pid": r[1], "score": r[2], "rank": r[3], "win": bool(r[4]), "m": {}})
    for r in conn.execute(f"""SELECT sm.session_id,sm.player_id,sm.key,sm.value
                              FROM session_metrics sm JOIN game_sessions s ON s.id=sm.session_id
                              WHERE {cond}""", args):
        s = sess.get(r[0])
        if not s:
            continue
        if r[1] is None:
            s["shared"][r[2]] = r[3]
        else:
            for p in s["players"]:
                if p["pid"] == r[1]:
                    p["m"][r[2]] = r[3]
    out = []
    for s in sess.values():
        for p in s["players"]:
            if p["score"] is not None:
                p["m"]["score"] = float(p["score"])
            for k, v in s["shared"].items():
                p["m"].setdefault(k, v)
        if s["players"]:
            out.append(s)
    return out


# ── Rating (Elo) ─────────────────────────────────────────────────────────────

_elo_cache = {}


def _places(players):
    """Finishing place per player: the reported rank, else by score, else the
    winner first. Equal numbers share a place."""
    if all(p["rank"] is not None for p in players):
        return [p["rank"] for p in players]
    if all(p["score"] is not None for p in players):
        order = sorted(set(p["score"] for p in players), reverse=True)
        return [order.index(p["score"]) + 1 for p in players]
    return [1 if p["win"] else 2 for p in players]


def ratings(conn, game_id):
    """Elo for the multiplayer ladder of a game, replayed from its whole
    history. A group result is read as every pair of players in it."""
    n, last = conn.execute("SELECT COUNT(*),COALESCE(MAX(id),0) FROM game_sessions WHERE game_id=? AND mode='multiplayer'",
                           (game_id,)).fetchone()
    hit = _elo_cache.get(game_id)
    if hit and hit[0] == (n, last):
        return hit[1]
    sessions = [s for s in _load(conn, game_id, "multi", None) if len(s["players"]) >= 2]
    table = {}
    for s in sessions:
        ps = s["players"]
        places = _places(ps)
        count = len(ps)
        delta = {}
        for i in range(count):
            ri = table.get(ps[i]["pid"], {"rating": ELO_START})["rating"]
            total = 0.0
            for j in range(count):
                if i == j or ps[i]["pid"] == ps[j]["pid"]:
                    continue
                rj = table.get(ps[j]["pid"], {"rating": ELO_START})["rating"]
                expected = 1.0 / (1.0 + 10 ** ((rj - ri) / 400.0))
                actual = 1.0 if places[i] < places[j] else 0.5 if places[i] == places[j] else 0.0
                total += actual - expected
            games = table.get(ps[i]["pid"], {"games": 0})["games"]
            k = ELO_K_NEW if games < ELO_NEW_GAMES else ELO_K
            delta[ps[i]["pid"]] = k * total / (count - 1)
        for pid, d in delta.items():
            e = table.setdefault(pid, {"rating": ELO_START, "games": 0, "peak": ELO_START, "history": []})
            e["rating"] += d
            e["games"] += 1
            e["peak"] = max(e["peak"], e["rating"])
            e["history"].append([s["t"], round(e["rating"], 1)])
    _elo_cache[game_id] = ((n, last), table)
    return table


# ── Aggregation ──────────────────────────────────────────────────────────────

def _pick(values, better):
    return max(values) if better == "high" else min(values)


def _player_table(sessions, decl):
    """One row per registered player, aggregated over the given sessions."""
    by_key = _by_key(decl)
    rows = {}
    for s in sessions:
        for p in s["players"]:
            r = rows.setdefault(p["pid"], {"player_id": p["pid"], "played": 0, "wins": 0, "seconds": 0,
                                           "last": s["t"], "first": s["t"], "_v": {}})
            r["played"] += 1
            r["wins"] += 1 if p["win"] else 0
            r["seconds"] += s["dur"] or 0
            r["last"] = max(r["last"], s["t"])
            r["first"] = min(r["first"], s["t"])
            for k, v in p["m"].items():
                if k in by_key:
                    r["_v"].setdefault(k, []).append(v)
    for r in rows.values():
        r["win_rate"] = round(100.0 * r["wins"] / r["played"], 1)
        # What win rates are ordered by: pulled toward 50% as if every player
        # had five extra drawn games, so one win from one game cannot top
        # someone who wins most of a hundred.
        r["win_rate_adj"] = round(100.0 * (r["wins"] + 2.5) / (r["played"] + 5), 2)
        r["best"], r["avg"], r["total"] = {}, {}, {}
        for k, vals in r.pop("_v").items():
            m = by_key[k]
            r["best"][k] = _pick(vals, m["better"])
            r["avg"][k] = sum(vals) / len(vals)
            if m["total"]:
                r["total"][k] = sum(vals)
    return rows


def _position(values, better):
    """pid -> (place, percentile). The percentile is the share of the field the
    player is ahead of, ties counting half, so a lone player sits at 50."""
    items = list(values.items())
    n = len(items)
    out = {}
    for pid, v in items:
        ahead = sum(1 for _, o in items if (o > v if better == "high" else o < v))
        below = sum(1 for _, o in items if (o < v if better == "high" else o > v))
        equal = n - ahead - below
        out[pid] = (ahead + 1, round(100.0 * (below + 0.5 * equal) / n, 1))
    return out


MAX_ROWS = 100


def _capped(rows, me_id):
    """The first MAX_ROWS rows, plus the viewer's own if it falls outside them."""
    out = rows[:MAX_ROWS]
    if me_id and not any(r["player_id"] == me_id for r in out):
        out += [r for r in rows[MAX_ROWS:] if r["player_id"] == me_id]
    return out


def _place_of(a, b):
    return (a > b) - (a < b)


def _trend(sessions, decl, me_id, daily):
    by_key = _by_key(decl)
    buckets = {}
    for s in sessions:
        d = datetime.fromisoformat(s["t"])
        day = d.date() if daily else (d - timedelta(days=d.weekday())).date()
        b = buckets.setdefault(day.isoformat(), {"b": day.isoformat(), "sessions": 0, "f": {}, "m": {}})
        b["sessions"] += 1
        for p in s["players"]:
            for k, v in p["m"].items():
                if k not in by_key:
                    continue
                b["f"].setdefault(k, []).append(v)
                if p["pid"] == me_id:
                    b["m"].setdefault(k, []).append(v)
    out = []
    for key in sorted(buckets)[-40:]:
        b = buckets[key]
        out.append({"b": b["b"], "sessions": b["sessions"],
                    "field": {k: round(sum(v) / len(v), 2) for k, v in b["f"].items()},
                    "me": {k: round(sum(v) / len(v), 2) for k, v in b["m"].items()}})
    return out


def _records(sessions, decl):
    by_key = _by_key(decl)
    out = {}
    for k, m in by_key.items():
        found = []
        for s in sessions:
            for p in s["players"]:
                if k in p["m"]:
                    found.append({"player_id": p["pid"], "value": p["m"][k], "t": s["t"], "session_id": s["id"]})
        found.sort(key=lambda x: x["value"], reverse=(m["better"] == "high"))
        if found:
            out[k] = found[:3]
    return out


def game_insights(conn, game_id, mode, period, me_id):
    """Everything the statistics page of one game needs, in one answer."""
    decl = declaration(game_id)
    ensure_schema(conn)
    backfill(conn, game_id, decl)
    avail = {
        "single": conn.execute("SELECT COUNT(*) FROM game_sessions WHERE game_id=? AND mode='singleplayer'", (game_id,)).fetchone()[0],
        "multi": conn.execute("SELECT COUNT(*) FROM game_sessions WHERE game_id=? AND mode='multiplayer'", (game_id,)).fetchone()[0],
    }
    if mode == "auto":
        # Open on whichever side of the game has seen more play.
        mode = "multi" if avail["multi"] and avail["multi"] >= avail["single"] else "single" if avail["single"] else "all"
    mode = mode if mode in ("single", "multi") else "all"
    since = period_start(period)
    sessions = _load(conn, game_id, mode, since)

    table = _player_table(sessions, decl)
    elo = ratings(conn, game_id)
    for pid, r in table.items():
        e = elo.get(pid)
        r["rating"] = round(e["rating"]) if e else None
        r["rating_games"] = e["games"] if e else 0
        r["rating_peak"] = round(e["peak"]) if e else None

    by_key = _by_key(decl)
    ladder_vals, ladder_better = _rank_values(table, decl)
    pos = _position(ladder_vals, ladder_better) if ladder_vals else {}
    rated = {pid: r["rating"] for pid, r in table.items() if r["rating"] is not None}
    rpos = _position(rated, "high") if rated else {}
    for pid, r in table.items():
        r["place"], r["percentile"] = pos.get(pid, (None, None))
        r["rating_place"], r["rating_percentile"] = rpos.get(pid, (None, None))

    me = None
    if me_id:
        mine = [s for s in sessions if any(p["pid"] == me_id for p in s["players"])]
        played_with, versus = set(), {}
        timeline = []
        for s in mine:
            mp = next(p for p in s["players"] if p["pid"] == me_id)
            others = [p for p in s["players"] if p["pid"] != me_id]
            for o in others:
                played_with.add(o["pid"])
            if len(s["players"]) >= 2:
                places = dict(zip([id(p) for p in s["players"]], _places(s["players"])))
                for o in others:
                    if o["pid"] == me_id:
                        continue
                    v = versus.setdefault(o["pid"], {"player_id": o["pid"], "w": 0, "l": 0, "d": 0})
                    c = _place_of(places[id(o)], places[id(mp)])
                    v["w" if c > 0 else "l" if c < 0 else "d"] += 1
            timeline.append({"id": s["id"], "t": s["t"], "win": mp["win"], "rank": mp["rank"], "dur": s["dur"],
                             "players": len(s["players"]), "m": mp["m"]})
        e = elo.get(me_id)
        me = {
            "player_id": me_id,
            "timeline": timeline[-60:],
            "played_with": sorted(played_with),
            "versus": sorted(versus.values(), key=lambda v: -(v["w"] + v["l"] + v["d"]))[:30],
            "rating_history": (e["history"][-60:] if e else []),
        }

    return {
        "game_id": game_id,
        "decl": decl,
        "mode": mode,
        "period": period or "all",
        "available": avail,
        "totals": {
            "sessions": len(sessions),
            "players": len(table),
            "seconds": sum(s["dur"] or 0 for s in sessions),
            "last": sessions[-1]["t"] if sessions else None,
        },
        "players": sorted(table.values(), key=lambda r: -r["played"]),
        "records": _records(sessions, decl),
        "trend": _trend(sessions, decl, me_id, daily=period in ("week", "month")),
        "me": me,
    }


# ── Ranking across games ─────────────────────────────────────────────────────

def overall(conn, period, game_ids, me_id=None):
    """Every (game, mode) pairing is a ladder. A player earns up to 100 points
    on a ladder for how far up it they stand, scaled down until they have
    played CONFIDENCE_GAMES sessions on it. The ranking sums those points."""
    since = period_start(period)
    ensure_schema(conn)
    players = {}
    ladders = []
    for gid in game_ids:
        decl = declaration(gid)
        backfill(conn, gid, decl)
        # Solo ladder: best value of the game's ranking metric.
        sessions = _load(conn, gid, "single", since)
        table = _player_table(sessions, decl)
        vals, better = _rank_values(table, decl)
        if vals:
            ladders.append(("single", gid, vals, better, table, None))
        # Shared ladder: Elo, for those who played in the period.
        msessions = _load(conn, gid, "multi", since)
        mtable = _player_table([s for s in msessions if len(s["players"]) >= 2], decl)
        elo = ratings(conn, gid)
        mvals = {pid: elo[pid]["rating"] for pid in mtable if pid in elo}
        if mvals:
            ladders.append(("multi", gid, mvals, "high", mtable, elo))
    for mode, gid, vals, better, table, _elo in ladders:
        pos = _position(vals, better)
        for pid, v in vals.items():
            n = table[pid]["played"]
            # Beating nobody earns nothing: a ladder only counts in full once
            # three players stand on it, and half with two.
            conf = min(1.0, n / CONFIDENCE_GAMES) * min(1.0, (len(vals) - 1) / 2.0)
            place, pct = pos[pid]
            pl = players.setdefault(pid, {"player_id": pid, "points": 0.0, "ladders": [], "played": 0, "wins": 0})
            pl["points"] += pct * conf
            pl["played"] += n
            pl["wins"] += table[pid]["wins"]
            pl["ladders"].append({"game_id": gid, "mode": mode, "place": place, "of": len(vals),
                                  "percentile": pct, "confidence": round(conf, 2), "value": round(v, 2), "ladder_size": len(vals),
                                  "played": n, "points": round(pct * conf, 1)})
    rows = sorted(players.values(), key=lambda r: -r["points"])
    for i, r in enumerate(rows):
        r["points"] = round(r["points"], 1)
        r["place"] = i + 1
        r["games"] = len({l["game_id"] for l in r["ladders"]})
        r["avg_percentile"] = round(sum(l["percentile"] for l in r["ladders"]) / len(r["ladders"]), 1)
    return {"period": period or "all", "players": _capped(rows, me_id), "games": list(game_ids),
            "ladders": len(ladders)}


# ── One player against another ───────────────────────────────────────────────

def _streaks(flags):
    """flags: chronological list of True (win) / False. -> (current, best)
    where current is positive for a winning run and negative for a losing one."""
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    cur = 0
    for f in reversed(flags):
        if cur == 0:
            cur = 1 if f else -1
        elif (cur > 0) == f:
            cur += 1 if f else -1
        else:
            break
    return cur, best


def versus(conn, me_id, other_id, game=""):
    """Everything the viewer is shown about how they stand against one other
    player: the record in games they shared, per game, form and streaks, the
    chance of beating them next time, and - for one chosen game - every number
    side by side. Only multiplayer sessions count as being played against."""
    ensure_schema(conn)
    games = [r[0] for r in conn.execute("""
        SELECT DISTINCT s.game_id FROM game_sessions s
        WHERE s.mode='multiplayer'
          AND EXISTS(SELECT 1 FROM session_players WHERE session_id=s.id AND player_id=?)
          AND EXISTS(SELECT 1 FROM session_players WHERE session_id=s.id AND player_id=?)""", (me_id, other_id))]
    per_game, chance = [], {}
    total = {"mine": 0, "theirs": 0, "draws": 0}
    for gid in games:
        if game and gid != game:
            continue
        rec = {"game_id": gid, "mine": 0, "theirs": 0, "draws": 0, "last": None}
        for sess in _load(conn, gid, "multi", None):
            ids = [p["pid"] for p in sess["players"]]
            if me_id not in ids or other_id not in ids:
                continue
            places = dict(zip([id(p) for p in sess["players"]], _places(sess["players"])))
            a = next(p for p in sess["players"] if p["pid"] == me_id)
            b = next(p for p in sess["players"] if p["pid"] == other_id)
            c = _place_of(places[id(b)], places[id(a)])
            rec["mine" if c > 0 else "theirs" if c < 0 else "draws"] += 1
            rec["last"] = sess["t"]
        rec["n"] = rec["mine"] + rec["theirs"] + rec["draws"]
        for k in total:
            total[k] += rec[k]
        per_game.append(rec)
    per_game.sort(key=lambda r: -r["n"])

    # Chance of winning the next game, from the two ratings of each game both have.
    for gid in ([game] if game else games):
        table = ratings(conn, gid)
        if me_id in table and other_id in table:
            ra, rb = table[me_id]["rating"], table[other_id]["rating"]
            chance[gid] = {"me": round(ra), "them": round(rb),
                           "p": round(100.0 / (1.0 + 10 ** ((rb - ra) / 400.0)), 1)}

    def form(pid):
        q = ("SELECT sp.is_winner FROM session_players sp JOIN game_sessions s ON s.id=sp.session_id "
             "WHERE sp.player_id=? AND s.mode='multiplayer'")
        args = [pid]
        if game:
            q += " AND s.game_id=?"
            args.append(game)
        flags = [bool(r[0]) for r in conn.execute(q + " ORDER BY s.played_at, s.id", args)]
        cur, best = _streaks(flags)
        return {"last": flags[-5:], "current": cur, "best": best, "games": len(flags),
                "wins": sum(flags)}

    out = {"shared": {"games": sum(total.values()), **total}, "per_game": per_game, "chance": chance,
           "form": {"me": form(me_id), "them": form(other_id)}, "game": game or None}

    if game:
        decl = declaration(game)
        backfill(conn, game, decl)
        sessions = _load(conn, game, "all", None)
        table = _player_table(sessions, decl)
        # Wins only mean something against other people, so the win figures
        # come from multiplayer sessions alone.
        multi = _player_table([x for x in sessions if x["mode"] == "multiplayer"], decl)
        elo = ratings(conn, game)

        def side(pid):
            r = table.get(pid)
            if not r:
                return None
            m = multi.get(pid) or {"played": 0, "wins": 0, "win_rate": None}
            return {"played": r["played"], "multi": {"played": m["played"], "wins": m["wins"], "win_rate": m["win_rate"] if m["played"] else None},
                    "seconds": r["seconds"], "best": r["best"], "avg": r["avg"], "total": r["total"]}
        out["decl"] = decl
        out["compare"] = {"me": side(me_id), "them": side(other_id)}
        out["rating_history"] = {
            "me": (elo.get(me_id) or {}).get("history", [])[-60:],
            "them": (elo.get(other_id) or {}).get("history", [])[-60:],
        }
    return out
