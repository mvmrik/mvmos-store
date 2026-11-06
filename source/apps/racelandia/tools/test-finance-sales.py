"""Sales record their own income category after a zero-cost session."""
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('sales_data', Path(__file__).resolve().parents[1] / 'apex_data.py')
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)
with tempfile.TemporaryDirectory(prefix='racelandia-finance-') as scratch:
    data._DB = str(Path(scratch) / 'test.db')
    pid = 'sales-test'
    d = data.get_driver(pid, 'Test Manager')
    tyres = dict(id='S1', compound='S', wear=[.2619, .2585, .7951, .8596], laps=12, runs=4)
    part = 'frontWing'
    design = data.parts_lab.stock_design(part)['id']
    unit = dict(id='test-wing', part=part, design=design, wear=.2)
    warehouse = d['warehouse']
    warehouse['tyres'].append(tyres)
    warehouse['parts'].append(unit)
    conn = data._connect()
    data._save_warehouse(conn, pid, warehouse)
    data.team.note(conn, pid, 'session', dict(track='own'))
    conn.execute('UPDATE driver SET budget=budget-0 WHERE player_id=?', (pid,))
    conn.commit(); conn.close()
    before = data.get_driver(pid)['budget']
    assert data.resale_value(data.TYRE_COST['S'], tyres['wear']) == 6387
    assert data.sell_tyres(pid, 'S1') is None
    conn = data._connect()
    row = conn.execute('SELECT category,amount,detail FROM finance_ledger WHERE player_id=? ORDER BY id DESC LIMIT 1', (pid,)).fetchone()
    assert row['category'] == 'tyre_sale' and row['amount'] == 6387
    assert json.loads(row['detail']) == dict(set='S1', compound='S', qty=1)
    assert conn.execute('SELECT budget FROM driver WHERE player_id=?', (pid,)).fetchone()[0] == before + 6387
    conn.close()
    assert data.sell_tyres(pid, 'S1') == 'tyre_set'
    assert data.sell_part(pid, 'test-wing') is None
    conn = data._connect()
    row = conn.execute('SELECT category,amount,detail FROM finance_ledger WHERE player_id=? ORDER BY id DESC LIMIT 1', (pid,)).fetchone()
    assert row['category'] == 'part_sale' and row['amount'] > 0
    assert json.loads(row['detail']) == dict(unit='test-wing', part=part, qty=1)
    assert 'S1' not in [t['id'] for t in data.get_driver(pid)['warehouse']['tyres']]
    conn.close()
print('PASS: exact S1 wear returns $6387 as tyre sale, part sales have their own category and item detail, sold tyres cannot be sold twice; only a temporary database was used')
