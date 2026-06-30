import json, os, sqlite3, sys, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional

get_current_session = sys.modules["backend.auth"].get_current_session
router = APIRouter(prefix="/api/apps/beambuilder", tags=["beambuilder"])

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "apps", "beambuilder", "data.db")

def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            materials TEXT NOT NULL DEFAULT '[]',
            beams TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    """)
    conn.commit()
    return conn

def _row(r):
    d = dict(r)
    for k in ("materials", "beams"):
        if k in d:
            try: d[k] = json.loads(d[k])
            except: d[k] = []
    return d

@router.get("/projects")
async def list_projects(session=Depends(get_current_session)):
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, name, updated_at, created_at FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return JSONResponse([dict(r) for r in rows])

@router.get("/projects/{pid}")
async def get_project(pid: str, session=Depends(get_current_session)):
    with _db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    return JSONResponse(_row(row))

class ProjectBody(BaseModel):
    name: str
    materials: list = []
    beams: list = []

@router.post("/projects")
async def create_project(body: ProjectBody, session=Depends(get_current_session)):
    pid = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        conn.execute(
            "INSERT INTO projects(id,name,materials,beams,updated_at,created_at) VALUES(?,?,?,?,?,?)",
            (pid, body.name, json.dumps(body.materials), json.dumps(body.beams), now, now)
        )
        conn.commit()
    return JSONResponse({"id": pid, "name": body.name})

@router.put("/projects/{pid}")
async def update_project(pid: str, body: ProjectBody, session=Depends(get_current_session)):
    now = datetime.now(timezone.utc).isoformat()
    with _db() as conn:
        r = conn.execute(
            "UPDATE projects SET name=?,materials=?,beams=?,updated_at=? WHERE id=?",
            (body.name, json.dumps(body.materials), json.dumps(body.beams), now, pid)
        )
        conn.commit()
    if r.rowcount == 0:
        raise HTTPException(404, "Project not found")
    return JSONResponse({"id": pid, "name": body.name})

@router.delete("/projects/{pid}")
async def delete_project(pid: str, session=Depends(get_current_session)):
    with _db() as conn:
        conn.execute("DELETE FROM projects WHERE id=?", (pid,))
        conn.commit()
    return JSONResponse({"ok": True})
