"""Battery capacity estimated from charging sessions.

Every finished session says how much energy went in (kWh) and how far the
charge percentage moved, so kWh / (change / 100) is the pack size at 100%.
One session is noisy, so the estimate is a weighted median of several, and
the change is only reported once enough sessions spread over enough time exist.
"""
import time

MIN_DELTA = 30         # percentage points a session must cover to be used
SHOW_AT = 3            # sessions before a kWh estimate is shown
TREND_AT = 8           # sessions before a change is shown
TREND_DAYS = 28        # days between the first and the last session
WINDOW = 4             # sessions in the baseline and in the current estimate
FAR_OFF = 0.25         # an expected capacity this far from the estimate is flagged


def wmedian(items):
    """Weighted median of (value, weight) pairs."""
    items = sorted(items)
    half = sum(w for _, w in items) / 2.0
    run = 0.0
    for v, w in items:
        run += w
        if run >= half:
            return v
    return items[-1][0]


def sessions(rows):
    """Usable sessions, oldest first, with their estimate and weight."""
    out = []
    for r in rows:
        if r["open"] or not r["kwh"] or r["kwh"] <= 0 or r["start_batt"] is None or r["end_batt"] is None:
            continue
        delta = r["end_batt"] - r["start_batt"]
        if delta < MIN_DELTA:
            continue
        full = r["end_batt"] >= 99
        weight = float(delta) * (2.0 if full else 1.0)
        if r["temp_out"] is not None and r["temp_out"] < 5:
            weight *= 0.5   # a cold pack hands out less than it holds
        out.append({"id": r["id"], "ts": r["end_ts"] or r["start_ts"], "kwh": r["kwh"] * 100.0 / delta, "weight": weight,
                    "full": full, "dc": bool(r["dc"]), "delta": delta, "odo": r.get("odo")})
    out.sort(key=lambda s: s["ts"])
    return out


def _est(items):
    return wmedian([(s["kwh"], s["weight"]) for s in items])


def capacity(rows, expected_kwh=None, now=None):
    now = now or int(time.time())
    ss = sessions(rows)
    n = len(ss)
    full = [s for s in ss if s["full"]]
    out = {"count": n, "show_at": SHOW_AT, "trend_at": TREND_AT, "trend_days": TREND_DAYS, "status": "none",
           "full_count": len(full), "since_full_days": round((now - full[-1]["ts"]) / 86400) if full else None,
           "points": [], "current_kwh": None, "baseline_kwh": None, "baseline_ts": None, "change_pct": None,
           "span_days": round((ss[-1]["ts"] - ss[0]["ts"]) / 86400) if n else 0, "reference": None}
    if not n:
        return out
    for i, s in enumerate(ss):
        out["points"].append({"ts": s["ts"], "kwh": round(s["kwh"], 2), "smooth": round(_est(ss[max(0, i - WINDOW + 1):i + 1]), 2),
                              "full": s["full"], "dc": s["dc"], "odo": s["odo"]})
    out["status"] = "collecting"
    if n < SHOW_AT:
        return out
    cur = _est(ss[-WINDOW:])
    out["status"] = "estimate"
    out["current_kwh"] = round(cur, 1)
    if n >= TREND_AT and out["span_days"] >= TREND_DAYS:
        base = _est(ss[:WINDOW])
        out["status"] = "trend"
        out["baseline_kwh"] = round(base, 1)
        out["baseline_ts"] = ss[0]["ts"]
        out["change_pct"] = round((cur / base - 1) * 100, 1)
    if expected_kwh and expected_kwh > 0:
        out["reference"] = {"kwh": expected_kwh, "pct": round(cur / expected_kwh * 100, 1),
                            "gap_kwh": round(cur - expected_kwh, 1), "far_off": abs(cur / expected_kwh - 1) > FAR_OFF}
    return out
