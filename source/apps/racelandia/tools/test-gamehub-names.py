"""New careers consume Game Hub identities; saved careers retain their names."""
import importlib.util
import json
import random
import sqlite3
import tempfile
from pathlib import Path
from name_service_fixture import install, catalogue, connect

install()
ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('names_test_data', ROOT / 'apps/racelandia/apex_data.py')
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)
with tempfile.TemporaryDirectory(prefix='racelandia-names-test-') as scratch:
    data._DB = str(Path(scratch) / 'career.db')
    d = data.get_driver('test-career', 'Test Manager')
    with data._connect() as conn:
        state = data.rivals.ensure(conn, d['player_id'], d['created'], data.SKILLS)
    people = [p for division in state['divisions'].values() for p in division]
    assert len(people) == 90
    assert len({p['country'] for p in people}) > 1
    assert {p['gender'] for p in people} == {'male', 'female'}
    countries = catalogue.defaults()
    for p in people:
        identity = p['name_identity']
        assert identity['country'] == p['country'] and identity['gender'] == p['gender']
        assert p['name'] == identity['latin']
        assert p['country'] in countries and p['country'] != 'teams'
        assert all(word in [v[1] for v in countries['teams']['groups'][group]] for word,group in zip(p['team'].split(), ['prefix','suffix']))
    for division in state['divisions'].values():
        assert len({p['team'] for p in division}) == 9
        assert len({p['name'] for p in division}) == 18
        assert all(division[i]['team'] == division[i+1]['team'] for i in range(0,18,2))
    # Existing fields are read from storage, never regenerated after catalogue changes.
    before = [(p['name'],p['team'],p['name_identity']) for p in people]
    original = data.name_source.generate
    data.name_source.generate = lambda **kw: (_ for _ in ()).throw(AssertionError('Unexpected regeneration'))
    saved = data.get_driver('test-career')
    with data._connect() as conn:
        unchanged = data.rivals.ensure(conn, saved['player_id'], saved['created'], data.SKILLS)
        old = unchanged['divisions']['5']
        old[0]['name'] = 'Existing Driver';old[0].pop('name_identity');old[0].pop('country');old[0].pop('gender')
        conn.execute('UPDATE rival_field SET state=? WHERE player_id=?',(json.dumps(unchanged),'test-career'))
    with data._connect() as conn:
        assert data.rivals.roster(conn,saved)[0]['name'] == 'Existing Driver'
    data.name_source.generate = original
    assert data.reset_career('test-career', saved['created']) is None
    new = data.get_driver('test-career')
    with data._connect() as conn:
        replaced = data.rivals.ensure(conn,new['player_id'],new['created'],data.SKILLS)
    assert replaced != unchanged
    assert data.restore_career('test-career',new['created']) is None
    restored = data.get_driver('test-career')
    with data._connect() as conn:
        assert data.rivals.roster(conn,restored)[0]['name'] == 'Existing Driver'
    # Administrator additions are included by the shared generator, not copied pools.
    with connect() as conn:
        catalogue.schema(conn)
        conn.execute("INSERT INTO name_catalog_custom(country,category,native,latin) VALUES('BG','male_first','Тестовоиме','Customname')")
        rows = catalogue.generate(conn,country='BG',gender='male',count=1000,rng=random.Random(1))
        assert any('Customname' in r['latin'] for r in rows)
print('PASS: 90 persistent international rivals, 45 two-driver teams, gender-matched names, shared defaults/custom names, career reset/archive restoration, and unchanged legacy identities.')
