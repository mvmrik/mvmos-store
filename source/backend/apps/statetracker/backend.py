import json, os, sqlite3, sys, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

get_current_session = sys.modules["backend.auth"].get_current_session
router = APIRouter(prefix="/api/statetracker", tags=["statetracker"])

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "statetracker", "data.db")

def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS entities (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'push',
            source_cfg TEXT NOT NULL DEFAULT '{}',
            states TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT NOT NULL, state_id TEXT NOT NULL,
            state_name TEXT NOT NULL, state_color TEXT NOT NULL DEFAULT '#89b4fa',
            raw_value TEXT, recorded_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ev ON events(entity_id, recorded_at);
    """)
    conn.commit()
    return conn

def _row(r):
    d = dict(r)
    for k in ("source_cfg","states"):
        if k in d:
            try: d[k] = json.loads(d[k])
            except: d[k] = {} if k=="source_cfg" else []
    return d

@router.get("/entities")
async def list_entities(session=Depends(get_current_session)):
    with _db() as conn:
        rows = conn.execute("SELECT * FROM entities ORDER BY created_at").fetchall()
    return JSONResponse([_row(r) for r in rows])

class EntityBody(BaseModel):
    name: str; source_type: str = "push"; source_cfg: dict = {}; states: list = []

@router.post("/entities")
async def create_entity(body: EntityBody, session=Depends(get_current_session)):
    eid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute("INSERT INTO entities(id,name,source_type,source_cfg,states,created_at) VALUES(?,?,?,?,?,?)",
                     (eid, body.name, body.source_type, json.dumps(body.source_cfg), json.dumps(body.states), now))
        conn.commit()
    return JSONResponse({"id": eid})

@router.put("/entities/{eid}")
async def update_entity(eid: str, body: EntityBody, session=Depends(get_current_session)):
    with _db() as conn:
        r = conn.execute("UPDATE entities SET name=?,source_type=?,source_cfg=?,states=? WHERE id=?",
                         (body.name, body.source_type, json.dumps(body.source_cfg), json.dumps(body.states), eid))
        conn.commit()
    if r.rowcount == 0: raise HTTPException(404)
    return JSONResponse({"ok": True})

@router.delete("/entities/{eid}")
async def delete_entity(eid: str, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute("DELETE FROM events WHERE entity_id=?", (eid,))
        conn.execute("DELETE FROM entities WHERE id=?", (eid,))
        conn.commit()
    return JSONResponse({"ok": True})

@router.get("/entities/{eid}/events")
async def get_events(eid: str, frm: str="", to: str="", session=Depends(get_current_session)):
    with _db() as conn:
        if frm and to:
            rows = conn.execute("SELECT * FROM events WHERE entity_id=? AND recorded_at>=? AND recorded_at<=? ORDER BY recorded_at", (eid,frm,to)).fetchall()
            prev = conn.execute("SELECT * FROM events WHERE entity_id=? AND recorded_at<? ORDER BY recorded_at DESC LIMIT 1", (eid,frm)).fetchone()
        else:
            rows = conn.execute("SELECT * FROM events WHERE entity_id=? ORDER BY recorded_at", (eid,)).fetchall()
            prev = None
    return JSONResponse({"events":[dict(r) for r in rows], "prev":dict(prev) if prev else None})

class PushBody(BaseModel):
    state: str; raw_value: Optional[str] = None

@router.post("/entities/{eid}/push")
async def push_event(eid: str, body: PushBody, session=Depends(get_current_session)):
    with _db() as conn:
        row = conn.execute("SELECT * FROM entities WHERE id=?", (eid,)).fetchone()
        if not row: raise HTTPException(404)
        entity = _row(row)
    matched = next((s for s in entity.get("states",[]) if s.get("id")==body.state or s.get("name")==body.state), None)
    if not matched: raise HTTPException(400, detail=f"Unknown state: {body.state}")
    _record(eid, matched["id"], matched["name"], matched.get("color","#89b4fa"), body.raw_value)
    return JSONResponse({"ok": True})

@router.post("/entities/{eid}/test")
async def test_probe(eid: str, session=Depends(get_current_session)):
    with _db() as conn:
        row = conn.execute("SELECT * FROM entities WHERE id=?", (eid,)).fetchone()
    if not row: raise HTTPException(404)
    entity = _row(row)
    import importlib.util, os as _os
    _sp = _os.path.join(_os.path.dirname(__file__), "scheduler.py")
    _sm = importlib.util.spec_from_file_location("_st_sched", _sp)
    _mod = importlib.util.module_from_spec(_sm); _sm.loader.exec_module(_mod)
    try:
        value, error = _mod._run_probe(entity)
        if error: return JSONResponse({"ok":False,"error":error})
        by_name = entity.get("source_type") in ("ping","http_check")
        state = _mod._eval_state(value, entity.get("states",[]), match_by_name=by_name)
        return JSONResponse({"ok":True,"value":str(value),"state":state})
    except Exception as e:
        return JSONResponse({"ok":False,"error":str(e)})

def _record(entity_id, state_id, state_name, state_color, raw_value=None):
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        last = conn.execute("SELECT state_id FROM events WHERE entity_id=? ORDER BY recorded_at DESC LIMIT 1", (entity_id,)).fetchone()
        if last and last["state_id"] == state_id: return False
        conn.execute("INSERT INTO events(entity_id,state_id,state_name,state_color,raw_value,recorded_at) VALUES(?,?,?,?,?,?)",
                     (entity_id, state_id, state_name, state_color, str(raw_value) if raw_value is not None else None, now))
        conn.commit()
    return True
