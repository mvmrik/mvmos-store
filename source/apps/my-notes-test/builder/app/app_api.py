def list_notes(user_id: str):
    """List the notes of a profile."""
    c = mvmx.db()
    c.execute("CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, owner TEXT, text TEXT)")
    rows = c.execute("SELECT id, text FROM notes WHERE owner=?", (user_id,)).fetchall()
    c.close()
    return [dict(r) for r in rows]
