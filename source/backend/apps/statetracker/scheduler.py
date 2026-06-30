import json, os, sqlite3, subprocess
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "statetracker", "data.db")

def _db():
    if not os.path.isfile(DB_PATH): return None
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row; return conn

def _extract(data, path):
    if not path: return data
    for p in path.split("."):
        data = data[p] if isinstance(data, dict) else data[int(p)]
    return data

def _run_probe(entity):
    src = entity.get("source_type","push")
    cfg = entity.get("source_cfg",{})
    if src == "push": return None, None
    if src == "ping":
        host = (cfg.get("host") or "").strip().removeprefix("https://").removeprefix("http://").rstrip("/")
        if not host: return None, "no host"
        try:
            r = subprocess.run(["ping","-c","1","-W","2",host], capture_output=True, timeout=5)
            return ("online" if r.returncode==0 else "offline"), None
        except Exception as e: return "offline", str(e)
    if src in ("http_check","http_fetch"):
        url = (cfg.get("url") or "").strip()
        if not url: return None, "no url"
        try:
            import httpx
            headers = {}
            at = cfg.get("auth_type","none")
            ak, av = cfg.get("auth_key",""), cfg.get("auth_value","")
            if at=="header" and ak: headers[ak]=av
            elif at=="bearer" and av: headers["Authorization"]=f"Bearer {av}"
            elif at=="basic" and ak:
                import base64; headers["Authorization"]="Basic "+base64.b64encode(f"{ak}:{av}".encode()).decode()
            r = httpx.get(url, headers=headers, timeout=10, follow_redirects=True)
            if src=="http_check": return ("online" if r.is_success else "offline"), None
            value = _extract(r.json(), cfg.get("extract_path","").strip())
            return value, None
        except Exception as e: return ("offline" if src=="http_check" else None), str(e)
    return None, f"unknown source: {src}"

def _eval_condition(value, cond):
    if not cond or not cond.strip(): return True
    c = cond.strip()
    if c.lower().startswith("contains "):
        return c[9:].strip().strip("\"'").lower() in str(value).lower()
    for op in (">=","<=","!=","==",">","<"):
        if c.startswith(op):
            rhs = c[len(op):].strip().strip("\"'")
            try: lv,rv = float(value),float(rhs)
            except: lv,rv = str(value).lower(),rhs.lower()
            return {">=":lv>=rv,"<=":lv<=rv,"!=":lv!=rv,"==":lv==rv,">":lv>rv,"<":lv<rv}[op]
    return False

def _eval_state(value, states, match_by_name=False):
    if match_by_name:
        # ping/http_check: match state by name (case-insensitive)
        val_lower = str(value).lower()
        matched = next((s for s in states if s.get("name","").lower() == val_lower), None)
        return matched or (states[-1] if states else None)
    for s in states:
        if _eval_condition(value, s.get("condition","")): return s
    return None

def run(now: datetime, db_path: str, config: dict):
    conn = _db()
    if conn is None: return
    try:
        rows = conn.execute("SELECT * FROM entities").fetchall()
        for row in rows:
            e = dict(row)
            for k in ("source_cfg","states"):
                try: e[k] = json.loads(e[k])
                except: e[k] = {} if k=="source_cfg" else []
            if e.get("source_type")=="push": continue
            interval = int(e.get("source_cfg",{}).get("interval_minutes") or 1)
            if interval > 1:
                total_min = now.hour * 60 + now.minute
                if total_min % interval != 0: continue
            value, _ = _run_probe(e)
            if value is None: continue
            by_name = e.get("source_type") in ("ping","http_check")
            matched = _eval_state(value, e.get("states",[]), match_by_name=by_name)
            if not matched: continue
            last = conn.execute("SELECT state_id FROM events WHERE entity_id=? ORDER BY recorded_at DESC LIMIT 1",(e["id"],)).fetchone()
            if last and last["state_id"]==matched["id"]: continue
            conn.execute("INSERT INTO events(entity_id,state_id,state_name,state_color,raw_value,recorded_at) VALUES(?,?,?,?,?,?)",
                         (e["id"],matched["id"],matched["name"],matched.get("color","#89b4fa"),str(value),datetime.now(timezone.utc).isoformat()))
            conn.commit()
    finally:
        conn.close()
