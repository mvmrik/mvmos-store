from fastapi import APIRouter, Depends
from pydantic import BaseModel

router = APIRouter()
desktop_router = APIRouter()


class Note(BaseModel):
    text: str


def _conn():
    c = mvmx.db()
    c.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, owner TEXT, text TEXT)")
    return c


@router.post("/note")
def add(n: Note, user=Depends(mvmx.profile_required)):
    with _conn() as c:
        c.execute("INSERT INTO notes(owner, text) VALUES (?, ?)", (user["id"], n.text[:200]))
    return {"ok": True}


@router.get("/notes")
def lst(user=Depends(mvmx.profile_required)):
    with _conn() as c:
        rows = c.execute("SELECT id, text FROM notes WHERE owner=?", (user["id"],)).fetchall()
    return [dict(r) for r in rows]
