"""Profile-scoped access to the server owner's Tesla data."""
import json
import time


def owner_id(c):
    row = c.execute("SELECT value FROM cfg WHERE key='server_owner'").fetchone()
    if not row:return None
    try:return json.loads(row['value'])
    except (ValueError,TypeError):return None


def access(c, actor_id):
    owner = owner_id(c)
    if not owner or not actor_id:return None
    if actor_id == owner:return {'owner_id':owner,'actor_id':actor_id,'role':'owner'}
    row = c.execute('SELECT role FROM shares WHERE owner_id=? AND user_id=?',(owner,actor_id)).fetchone()
    if row and row['role'] in ('view','admin'):
        return {'owner_id':owner,'actor_id':actor_id,'role':row['role']}
    return None


def grant(c, owner, recipient, role):
    if owner != owner_id(c) or recipient == owner or not recipient or role not in ('view','admin'):
        raise ValueError('invalid_share')
    c.execute('''INSERT INTO shares(owner_id,user_id,role,created_ts) VALUES(?,?,?,?)
        ON CONFLICT(owner_id,user_id) DO UPDATE SET role=excluded.role''',(owner,recipient,role,int(time.time())))
    c.commit()
