"""Private family trees. All mutations and reviews use the same transactional ACL."""
import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

router = APIRouter()
ROOT = os.path.dirname(__file__)
DB = os.path.join(ROOT, 'data.db')


@contextmanager
def database(write=False):
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        if write:
            c.execute('BEGIN IMMEDIATE')
        yield c
        if write:
            c.commit()
    except Exception:
        c.rollback()
        raise
    finally:
        c.close()


with database() as c:
    c.executescript('''
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS trees (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tree_owner ON trees(owner_id);
    CREATE TABLE IF NOT EXISTS members (
        tree_id TEXT REFERENCES trees(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('viewer','editor','admin')),
        PRIMARY KEY(tree_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY, tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS person_tree ON people(tree_id);
    CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY, tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL, action TEXT NOT NULL, person_id TEXT NOT NULL,
        before_data TEXT, after_data TEXT, base_version INTEGER,
        status TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
        reviewer_id TEXT, created_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS proposal_tree ON proposals(tree_id,created_at);
    CREATE TABLE IF NOT EXISTS person_refs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tree_id TEXT NOT NULL REFERENCES trees(id) ON DELETE CASCADE,
        person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        added_by TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(tree_id,person_id)
    );
    CREATE INDEX IF NOT EXISTS ref_person ON person_refs(person_id);
    CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        view_mode TEXT NOT NULL DEFAULT 'tree' CHECK(view_mode IN ('tree','flat'))
    );

    ''')


def now():
    return datetime.now(timezone.utc).isoformat()


def hub():
    return sys.modules['backend.apphub']


def identity(token):
    me = hub().get_pub_session(token)
    if not me:
        raise HTTPException(401, 'unauthorized')
    return me['id']


def fail(code, status=400):
    raise HTTPException(status, code)


def text(value, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        fail('invalid_input')
    return value.strip()


def profiles(ids):
    return {u['id']: {k: u.get(k) for k in ('id','username','display_name','avatar_color')}
            for u in hub().get_users_by_ids(list(ids))}


def access(c, tree_id, user_id, roles=None):
    tree = c.execute('SELECT * FROM trees WHERE id=?', (tree_id,)).fetchone()
    if not tree:
        fail('not_found', 404)
    member = c.execute('SELECT role FROM members WHERE tree_id=? AND user_id=?', (tree_id,user_id)).fetchone()
    role = 'owner' if tree['owner_id'] == user_id else member['role'] if member else None
    if role is None:
        fail('not_found', 404)
    if roles and role not in roles:
        fail('forbidden', 403)
    return dict(tree), role


def person_data(data):
    if not isinstance(data, dict):
        fail('invalid_input')
    out = {k: text(data.get(k, ''), limit, k == 'name') for k,limit in
           [('name',160),('notes',12000),('birth_date',10),('profile_id',100)]}
    for event in ('birth', 'death'):
        out[event + '_date'] = text(data.get(event + '_date', ''), 10)
        year = data.get(event + '_year')
        if year in ('', None):
            year = None
        if year is not None and (type(year) is not int or not 1 <= year <= date.today().year):
            fail('invalid_' + event)
        if out[event + '_date']:
            try:
                known = date.fromisoformat(out[event + '_date'])
            except ValueError:
                fail('invalid_' + event)
            if known.isoformat() != out[event + '_date'] or known > date.today() or (year and year != known.year):
                fail('invalid_' + event)
            year = known.year
        out[event + '_year'] = year
    if (out['birth_year'] and out['death_year'] and out['death_year'] < out['birth_year']) or (
            out['birth_date'] and out['death_date'] and out['death_date'] < out['birth_date']):
        fail('death_before_birth')
    deceased = data.get('deceased', False)
    if type(deceased) is not bool:
        fail('invalid_input')
    out['deceased'] = deceased or bool(out['death_date'] or out['death_year'])
    out['gender'] = data.get('gender', 'unknown')
    if out['gender'] not in ('male', 'female', 'unknown'):
        fail('invalid_gender')
    partners = data.get('partners', [])
    if not isinstance(partners, list) or len(partners) > 100:
        fail('invalid_partners')
    clean_partners = []
    for partner in partners:
        if not isinstance(partner, dict) or not isinstance(partner.get('person_id'), str) or partner.get('kind') not in ('partner', 'spouse', 'former_partner', 'former_spouse'):
            fail('invalid_partners')
        clean_partners.append({'person_id': partner['person_id'], 'kind': partner['kind']})
    if len({p['person_id'] for p in clean_partners}) != len(clean_partners):
        fail('invalid_partners')
    out['partners'] = clean_partners
    parents = data.get('parents', [])
    if not isinstance(parents, list) or len(parents) > 2 or any(not isinstance(p,str) for p in parents) or len(set(parents)) != len(parents):
        fail('invalid_parents')
    out['parents'] = parents
    adopted = data.get('adopted_parents', [])
    if not isinstance(adopted, list) or any(not isinstance(pid, str) or pid not in parents for pid in adopted) or len(set(adopted)) != len(adopted):
        fail('invalid_parents')
    out['adopted_parents'] = adopted
    if out['profile_id'] and out['profile_id'] not in profiles([out['profile_id']]):
        fail('profile_missing')
    return out


def people(c, tree_id):
    return [dict(dict(gender='unknown', deceased=False, death_date='', death_year=None, partners=[]), id=r['id'], version=r['version'], **json.loads(r['data']))
            for r in c.execute('SELECT * FROM people WHERE tree_id=? ORDER BY rowid', (tree_id,))]


def accessible_trees(c, uid):
    return {r['id']: dict(r) for r in c.execute(
        """SELECT t.id,t.title,CASE WHEN t.owner_id=? THEN 'owner' ELSE m.role END AS role
        FROM trees t LEFT JOIN members m ON m.tree_id=t.id AND m.user_id=?
        WHERE t.owner_id=? OR m.user_id=?""", (uid,uid,uid,uid))}


def check_references(c, tree_id, uid, refs):
    if len(refs) > 100 or len(set(refs)) != len(refs):
        fail('invalid_reference')
    for pid in refs:
        row = c.execute('SELECT tree_id FROM people WHERE id=?', (pid,)).fetchone()
        if not row or row['tree_id'] == tree_id:
            fail('invalid_reference')
        access(c,row['tree_id'],uid)


def member_ids(c, tree_id):
    return {r[0] for r in c.execute('SELECT id FROM people WHERE tree_id=? UNION SELECT person_id FROM person_refs WHERE tree_id=?', (tree_id,tree_id))}


def add_references(c, tree_id, uid, refs):
    for pid in refs:
        c.execute('INSERT OR IGNORE INTO person_refs(tree_id,person_id,added_by,created_at) VALUES(?,?,?,?)', (tree_id,pid,uid,now()))


def clean_connections(c, deleted, tree_id=None):
    sql = 'SELECT * FROM people' + (' WHERE tree_id=?' if tree_id else '')
    for row in c.execute(sql, (tree_id,) if tree_id else ()).fetchall():
        if row['id'] in deleted:
            continue
        data = json.loads(row['data'])
        parents = [pid for pid in data['parents'] if pid not in deleted]
        partners = [p for p in data.get('partners',[]) if p['person_id'] not in deleted]
        if parents != data['parents'] or partners != data.get('partners',[]):
            data.update(parents=parents,partners=partners,adopted_parents=[pid for pid in data.get('adopted_parents',[]) if pid in parents])
            c.execute('UPDATE people SET data=?,version=version+1 WHERE id=?', (json.dumps(data),row['id']))


def reference_action(c, tree_id, uid, action, pid, version=None):
    ref = c.execute('SELECT * FROM person_refs WHERE tree_id=? AND person_id=?', (tree_id,pid)).fetchone()
    if action == 'link':
        check_references(c,tree_id,uid,[pid])
        if ref:
            fail('conflict',409)
        if len(member_ids(c,tree_id))>=2000:
            fail('tree_limit')
        add_references(c,tree_id,uid,[pid])
    else:
        if not ref:
            fail('not_found',404)
        if ref['id'] != version:
            fail('conflict',409)
        clean_connections(c,{pid},tree_id)
        c.execute('DELETE FROM person_refs WHERE id=?', (ref['id'],))
    c.execute('UPDATE trees SET updated_at=? WHERE id=?', (now(),tree_id))


def tree_view(c, tree_id, uid, requested):
    allowed = accessible_trees(c,uid)
    adjacency = {tid:set() for tid in allowed}
    memberships = {}
    refs = c.execute('SELECT r.*,p.tree_id AS home_tree_id FROM person_refs r JOIN people p ON p.id=r.person_id').fetchall()
    for r in refs:
        if r['tree_id'] in allowed and r['home_tree_id'] in allowed:
            adjacency[r['tree_id']].add(r['home_tree_id'])
            adjacency[r['home_tree_id']].add(r['tree_id'])
            memberships.setdefault(r['person_id'],set()).update([r['tree_id'],r['home_tree_id']])
    reachable, queue = {tree_id}, [tree_id]
    for tid in queue:
        for other in adjacency[tid]-reachable:
            reachable.add(other); queue.append(other)
    if any(tid not in reachable for tid in requested):
        fail('invalid_reference')
    selected = list(dict.fromkeys([tree_id]+requested))
    if len(selected)>12:
        fail('view_limit')
    result, local_refs = {}, {r['person_id']:r['id'] for r in refs if r['tree_id']==tree_id}
    for tid in selected:
        for person in people(c,tid):
            person.update(home_tree_id=tid,home_tree_title=allowed[tid]['title'],view_tree_id=tid,in_current_tree=tid==tree_id,
                          reference_version=None,redacted=False,stored_partners=[dict(link) for link in person.get('partners',[])])
            result[person['id']] = person
    for r in refs:
        if r['tree_id'] not in selected:
            continue
        pid = r['person_id']
        if pid not in result:
            if r['home_tree_id'] in allowed:
                row = c.execute('SELECT * FROM people WHERE id=?',(pid,)).fetchone()
                person = dict(gender='unknown',deceased=False,death_date='',death_year=None,partners=[])
                person.update(json.loads(row['data']))
                person.update(id=pid,version=row['version'],home_tree_id=r['home_tree_id'],home_tree_title=allowed[r['home_tree_id']]['title'],redacted=False)
            else:
                person = dict(id=pid,version=None,name='',notes='',parents=[],partners=[],gender='unknown',deceased=False,
                              birth_date='',birth_year=None,death_date='',death_year=None,profile_id='',home_tree_id=None,home_tree_title=None,redacted=True)
            person.update(view_tree_id=r['tree_id'],in_current_tree=False,reference_version=None)
            result[pid] = person
        if r['tree_id']==tree_id:
            result[pid]['in_current_tree']=True
    # Show incoming family connections from accessible trees without inserting
    # reciprocal references or changing a source person's stored relationships.
    natives = {pid:person['home_tree_id'] for pid,person in result.items()
               if not person['redacted'] and person['home_tree_id'] in selected}
    sources = {r['tree_id'] for r in refs if r['home_tree_id'] in selected
               and r['tree_id'] in allowed and r['tree_id'] not in selected}

    def preview(person, home, region):
        if person['id'] in result:
            return
        person.update(home_tree_id=home,home_tree_title=allowed[home]['title'],view_tree_id=region,
                      in_current_tree=False,reference_version=None,redacted=False,view_only=True)
        result[person['id']] = person

    for source in sorted(sources):
        for person in people(c,source):
            targets = [pid for pid in person['parents']+[link['person_id'] for link in person.get('partners',[])] if pid in natives]
            if not targets:
                continue
            region = tree_id if tree_id in {natives[pid] for pid in targets} else natives[targets[0]]
            preview(person,source,region)
            # A shared child also needs its other parent, even without marriage.
            if any(pid in natives for pid in person['parents']):
                for parent in person['parents']:
                    if parent in result:
                        continue
                    row = c.execute('SELECT * FROM people WHERE id=?',(parent,)).fetchone()
                    if row and row['tree_id'] in allowed and row['tree_id'] in reachable:
                        data = dict(gender='unknown',deceased=False,death_date='',death_year=None,partners=[])
                        data.update(json.loads(row['data']));data.update(id=row['id'],version=row['version'])
                        preview(data,row['tree_id'],region)
    if len(result)>8000:
        fail('view_limit')
    # Project edges only onto the selected people. Never copy a foreign record's
    # attributes or modify its original tree when creating local connections.
    for pid,person in result.items():
        person['reference_version']=local_refs.get(pid)
        person['parents']=[p for p in person['parents'] if p in result]
        person['adopted_parents']=[p for p in person.get('adopted_parents',[]) if p in person['parents']]
        person['partners']=[p for p in person.get('partners',[]) if p['person_id'] in result]
    for pid,person in result.items():
        for partner in list(person['partners']):
            other=result[partner['person_id']]
            if other['redacted']:
                continue
            if not any(p['person_id']==pid for p in other['partners']):
                other['partners'].append({'person_id':pid,'kind':partner['kind']})
    for pid,person in result.items():
        for other_id in person['parents']+[link['person_id'] for link in person['partners']]:
            homes = {person['home_tree_id'],result[other_id]['home_tree_id']}-{None}
            if len(homes)>1:
                memberships.setdefault(pid,set()).update(homes)
                memberships.setdefault(other_id,set()).update(homes)
    for pid,person in result.items():
        person['linked_tree_ids']=sorted((memberships.get(pid,set())|({person['home_tree_id']} if person['home_tree_id'] else set())) & reachable)
    return list(result.values()), [allowed[tid] for tid in selected], [allowed[tid] for tid in sorted(reachable) if tid!=tree_id]


def validate_graph(c, tree_id, person_id, data, extra_refs=()):
    graph = {r['id']:json.loads(r['data'])['parents'] for r in c.execute('SELECT id,data FROM people')}
    members = member_ids(c,tree_id)|set(extra_refs)
    if person_id not in members and len(members) >= 2000:
        fail('tree_limit')
    if any(p not in members or p == person_id for p in data['parents']):
        fail('invalid_parents')
    if any(p['person_id'] not in members or p['person_id'] == person_id for p in data['partners']):
        fail('invalid_partners')
    # Only this node's outgoing edges change. An ancestor reaching it creates a cycle.
    stack = list(data['parents'])
    seen = set()
    while stack:
        node = stack.pop()
        if node == person_id:
            fail('cycle')
        if node not in seen:
            seen.add(node)
            stack.extend(graph.get(node, []))


def apply(c, tree_id, action, person_id, data):
    if action != 'delete':
        validate_graph(c, tree_id, person_id, data)
    # Partnership changes are reciprocal, and participate in the same version
    # checks as personal details. All affected people commit atomically.
    partners = {p['person_id']: p['kind'] for p in data['partners']} if data else {}
    for other in people(c, tree_id):
        if other['id'] == person_id:
            continue
        previous = dict(other)
        if action == 'delete' and person_id in other['parents']:
            other['parents'] = [p for p in other['parents'] if p != person_id]
            other['adopted_parents'] = [p for p in other.get('adopted_parents',[]) if p in other['parents']]
        links = [p for p in other['partners'] if p['person_id'] != person_id]
        if other['id'] in partners:
            links.append({'person_id': person_id, 'kind': partners[other['id']]})
        other['partners'] = sorted(links, key=lambda p: p['person_id'])
        if previous != other:
            pid = other.pop('id')
            other.pop('version')
            c.execute('UPDATE people SET data=?,version=version+1 WHERE id=? AND tree_id=?', (json.dumps(other),pid,tree_id))
    if action == 'delete':
        clean_connections(c,{person_id})
        c.execute('DELETE FROM people WHERE id=? AND tree_id=?', (person_id,tree_id))
    elif action == 'create':
        data['partners'].sort(key=lambda p: p['person_id'])
        c.execute('INSERT INTO people(id,tree_id,data) VALUES(?,?,?)', (person_id,tree_id,json.dumps(data)))
    else:
        data['partners'].sort(key=lambda p: p['person_id'])
        c.execute('UPDATE people SET data=?,version=version+1 WHERE id=? AND tree_id=?', (json.dumps(data),person_id,tree_id))
    c.execute('UPDATE trees SET updated_at=? WHERE id=?', (now(),tree_id))


class TreeBody(BaseModel):
    title: str = Field(min_length=1, max_length=160)


class MemberBody(BaseModel):
    user_id: str = Field(max_length=100)
    role: str


class ChangeBody(BaseModel):
    action: str
    person_id: str = Field(default='', max_length=100)
    version: int | None = None
    references: list[str] = Field(default_factory=list, max_length=100)
    data: dict = Field(default_factory=dict)
    note: str = Field(default='', max_length=2000)


class ReviewBody(BaseModel):
    decision: str
    note: str = Field(default='', max_length=2000)


@router.get('/')
def index():
    if not hub().is_app_public('familytree'):
        return hub().private_page('Family Tree', '🌳')
    return FileResponse(os.path.join(ROOT, 'public', 'index.html'))


def statistics_module():
    premium = sys.modules.get('backend.premium')
    return premium.load_premium_backend('familytree') if premium else None


@router.get('/features')
def features(x_pub_token: str = Header(default=None)):
    identity(x_pub_token)
    return {'statistics': statistics_module() is not None}


@router.get('/statistics')
def statistics(scope: str = 'all', x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    module = statistics_module()
    if module is None:
        fail('premium_required', 402)
    return module.calculate(sys.modules[__name__], uid, scope)


@router.get('/statistics.js')
def statistics_script():
    module = statistics_module()
    if module is None:
        return Response(status_code=404, headers={'Cache-Control':'no-store'})
    return Response(module.script(), media_type='application/javascript', headers={'Cache-Control':'no-store'})


class ViewPreferenceBody(BaseModel):
    view_mode: str = Field(max_length=10)


@router.get('/preferences')
def get_preferences(x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database() as c:
        row = c.execute('SELECT view_mode FROM user_preferences WHERE user_id=?', (uid,)).fetchone()
    return {'view_mode': row['view_mode'] if row else 'tree'}


@router.put('/preferences')
def save_preferences(body: ViewPreferenceBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    if body.view_mode not in ('tree', 'flat'):
        fail('invalid_input')
    with database(True) as c:
        c.execute('INSERT INTO user_preferences(user_id,view_mode) VALUES(?,?) '
                  'ON CONFLICT(user_id) DO UPDATE SET view_mode=excluded.view_mode', (uid, body.view_mode))
    return {'view_mode': body.view_mode}


@router.get('/profiles')
def search_profiles(q: str = '', x_pub_token: str = Header(default=None)):
    identity(x_pub_token)
    if len(q.strip()) < 2:
        return []
    return [{k: u.get(k) for k in ('id','username','display_name','avatar_color')}
            for u in hub().search_users(q[:100], limit=20)]


@router.get('/trees')
def list_trees(x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database() as c:
        rows = c.execute('''SELECT t.*, CASE WHEN t.owner_id=? THEN 'owner' ELSE m.role END AS role,
            ((SELECT COUNT(*) FROM people p WHERE p.tree_id=t.id)+(SELECT COUNT(*) FROM person_refs r WHERE r.tree_id=t.id)) AS person_count,
            (SELECT COUNT(*) FROM proposals p WHERE p.tree_id=t.id AND p.status='pending') AS pending_count
            FROM trees t LEFT JOIN members m ON m.tree_id=t.id AND m.user_id=?
            WHERE t.owner_id=? OR m.user_id=? ORDER BY t.updated_at DESC''', (uid,uid,uid,uid)).fetchall()
        return [dict(r) for r in rows]


@router.post('/trees')
def create_tree(body: TreeBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    tid = uuid.uuid4().hex
    with database(True) as c:
        c.execute('INSERT INTO trees VALUES(?,?,?,?,?)', (tid,uid,text(body.title,160,True),now(),now()))
    return {'id': tid}


@router.get('/trees/{tree_id}')
def get_tree(tree_id: str, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database() as c:
        tree, role = access(c,tree_id,uid)
        tree['role'] = role
        tree['current_user_id'] = uid
        tree['people'],tree['view_trees'],tree['linked_trees'] = tree_view(c,tree_id,uid,[])
        tree['members'] = [dict(user_id=tree['owner_id'],role='owner')] + [dict(r) for r in c.execute('SELECT user_id,role FROM members WHERE tree_id=?', (tree_id,))]
        query = 'SELECT * FROM proposals WHERE tree_id=?'
        args = [tree_id]
        if role not in ('owner','admin'):
            query += ' AND author_id=?'
            args.append(uid)
        tree['proposals'] = [dict(r) for r in c.execute(query+' ORDER BY created_at DESC LIMIT 300', args)]
        ids = {m['user_id'] for m in tree['members']} | {p['profile_id'] for p in tree['people'] if p['profile_id']}
        for p in tree['proposals']:
            ids.update([p['author_id'],p['reviewer_id']])
            for key in ('before_data','after_data'):
                p[key] = json.loads(p[key]) if p[key] else None
                if p[key] and p[key].get('profile_id'):
                    ids.add(p[key]['profile_id'])
        reference_ids=set()
        for proposal in tree['proposals']:
            for key in ('before_data','after_data'):
                data=proposal[key] or {}
                reference_ids.update(data.get('_references',[]))
                if data.get('reference_id'):reference_ids.add(data['reference_id'])
                reference_ids.update(data.get('parents',[]))
                reference_ids.update(p['person_id'] for p in data.get('partners',[]))
        allowed=accessible_trees(c,uid)
        tree['reference_names']={}
        if reference_ids:
            for row in c.execute('SELECT id,tree_id,data FROM people'):
                if row['id'] in reference_ids and row['tree_id'] in allowed:
                    tree['reference_names'][row['id']]=json.loads(row['data'])['name']
        tree['profiles'] = profiles(ids)
        return tree


@router.put('/trees/{tree_id}')
def rename_tree(tree_id: str, body: TreeBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database(True) as c:
        access(c,tree_id,uid,('owner','admin'))
        c.execute('UPDATE trees SET title=?,updated_at=? WHERE id=?', (text(body.title,160,True),now(),tree_id))
    return {'ok': True}


@router.delete('/trees/{tree_id}')
def delete_tree(tree_id: str, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database(True) as c:
        access(c,tree_id,uid,('owner','admin'))
        clean_connections(c,{r[0] for r in c.execute('SELECT id FROM people WHERE tree_id=?',(tree_id,))})
        c.execute('DELETE FROM trees WHERE id=?', (tree_id,))
    return {'ok': True}


@router.put('/trees/{tree_id}/members')
def set_member(tree_id: str, body: MemberBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database(True) as c:
        tree,_ = access(c,tree_id,uid,('owner','admin'))
        if body.user_id == tree['owner_id'] or body.role not in ('viewer','editor','admin','remove'):
            fail('invalid_role')
        if body.role == 'remove':
            c.execute('DELETE FROM members WHERE tree_id=? AND user_id=?', (tree_id,body.user_id))
        else:
            if body.user_id not in profiles([body.user_id]):
                fail('profile_missing')
            c.execute('INSERT INTO members VALUES(?,?,?) ON CONFLICT(tree_id,user_id) DO UPDATE SET role=excluded.role', (tree_id,body.user_id,body.role))
    return {'ok': True}


@router.get('/people/{person_id}/tree-links')
def person_tree_links(person_id: str, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database() as c:
        person = c.execute('SELECT tree_id FROM people WHERE id=?', (person_id,)).fetchone()
        if not person:
            fail('not_found', 404)
        access(c, person['tree_id'], uid)
        allowed = accessible_trees(c, uid)
        connections = []
        for ref in c.execute('SELECT * FROM person_refs WHERE person_id=?', (person_id,)):
            if ref['tree_id'] not in allowed:
                continue
            target, role = access(c, ref['tree_id'], uid)
            connections.append(dict(tree_id=target['id'], title=target['title'], role=role, version=ref['id']))
        return dict(home_tree_id=person['tree_id'], connections=connections,
                    available=[dict(id=tid, title=target['title'], role=access(c, tid, uid)[1])
                               for tid, target in allowed.items() if tid != person['tree_id']])


@router.post('/trees/{tree_id}/references')
def link_person(tree_id: str, body: ChangeBody, x_pub_token: str = Header(default=None)):
    uid=identity(x_pub_token)
    with database(True) as c:
        _,role=access(c,tree_id,uid,('owner','admin','editor'))
        if body.action not in ('link','unlink'):
            fail('invalid_input')
        pid=body.person_id
        ref=c.execute('SELECT * FROM person_refs WHERE tree_id=? AND person_id=?',(tree_id,pid)).fetchone()
        if body.action=='link':
            check_references(c,tree_id,uid,[pid])
            if ref:fail('conflict',409)
        elif not ref or ref['id']!=body.version:
            fail('conflict',409)
        pending=role=='editor'
        if not pending:reference_action(c,tree_id,uid,body.action,pid,body.version)
        stamp=now();proposal_id=uuid.uuid4().hex
        c.execute("""INSERT INTO proposals(id,tree_id,author_id,action,person_id,after_data,base_version,status,note,reviewer_id,created_at,reviewed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",(proposal_id,tree_id,uid,body.action,pid,json.dumps({'reference_id':pid}),ref['id'] if ref else None,'pending' if pending else 'applied',body.note,None if pending else uid,stamp,None if pending else stamp))
    return {'id':pid,'proposal_id':proposal_id,'status':'pending' if pending else 'applied'}


@router.post('/trees/{tree_id}/changes')
def change(tree_id: str, body: ChangeBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database(True) as c:
        _,role = access(c,tree_id,uid,('owner','admin','editor'))
        if body.action not in ('create','update','delete'):
            fail('invalid_input')
        pid = uuid.uuid4().hex if body.action == 'create' else body.person_id
        old = c.execute('SELECT * FROM people WHERE tree_id=? AND id=?', (tree_id,pid)).fetchone()
        if body.action != 'create':
            if not old:
                fail('not_found',404)
            if body.version != old['version']:
                fail('conflict',409)
        check_references(c,tree_id,uid,body.references)
        data = None if body.action == 'delete' else person_data({**(json.loads(old['data']) if old else {}), **body.data})
        if data:
            validate_graph(c,tree_id,pid,data,body.references)
        pending = role == 'editor'
        if not pending:
            add_references(c,tree_id,uid,body.references)
            apply(c,tree_id,body.action,pid,data)
        proposal_id = uuid.uuid4().hex
        c.execute('''INSERT INTO proposals(id,tree_id,author_id,action,person_id,before_data,after_data,base_version,status,note,reviewer_id,created_at,reviewed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''', (proposal_id,tree_id,uid,body.action,pid,old['data'] if old else None,json.dumps({**data,'_references':body.references}) if data else None,old['version'] if old else None,
            'pending' if pending else 'applied',body.note,None if pending else uid,now(),None if pending else now()))
    return {'id': pid, 'proposal_id': proposal_id, 'status': 'pending' if pending else 'applied'}


@router.post('/trees/{tree_id}/proposals/{proposal_id}/review')
def review(tree_id: str, proposal_id: str, body: ReviewBody, x_pub_token: str = Header(default=None)):
    uid = identity(x_pub_token)
    with database(True) as c:
        access(c,tree_id,uid,('owner','admin'))
        p = c.execute('SELECT * FROM proposals WHERE tree_id=? AND id=?', (tree_id,proposal_id)).fetchone()
        if not p:
            fail('not_found',404)
        if p['status'] != 'pending':
            fail('conflict',409)
        if body.decision not in ('approve','reject'):
            fail('invalid_input')
        if body.decision == 'approve':
            # A removed/demoted editor's outstanding proposals cannot be merged.
            access(c,tree_id,p['author_id'],('owner','admin','editor'))
            if p['action'] in ('link','unlink'):
                if p['action']=='link':
                    check_references(c,tree_id,p['author_id'],[p['person_id']])
                reference_action(c,tree_id,uid,p['action'],p['person_id'],p['base_version'])
            else:
                old = c.execute('SELECT * FROM people WHERE tree_id=? AND id=?', (tree_id,p['person_id'])).fetchone()
                if p['action'] != 'create' and (not old or old['version'] != p['base_version']):
                    fail('conflict',409)
                proposed=json.loads(p['after_data']) if p['after_data'] else None
                refs=proposed.get('_references',[]) if proposed else []
                check_references(c,tree_id,p['author_id'],refs)
                check_references(c,tree_id,uid,refs)
                data = person_data({**(json.loads(old['data']) if old else {}), **proposed}) if proposed else None
                add_references(c,tree_id,p['author_id'],refs)
                apply(c,tree_id,p['action'],p['person_id'],data)
        c.execute('UPDATE proposals SET status=?,reviewer_id=?,review_note=?,reviewed_at=? WHERE id=?',
                  ('approved' if body.decision == 'approve' else 'rejected',uid,body.note,now(),proposal_id))
    return {'ok': True}
