"""A free session must not label a later balance update as a session expense."""
import importlib.util
import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('ledger_team', Path(__file__).resolve().parents[1] / 'team.py')
team = importlib.util.module_from_spec(spec)
spec.loader.exec_module(team)
noop_schema = SimpleNamespace(schema=lambda conn: None)
team.bind(dict(crew=noop_schema, specialists=noop_schema, rivals=noop_schema))
conn = sqlite3.connect(':memory:')
conn.execute('CREATE TABLE driver(player_id TEXT PRIMARY KEY, budget INTEGER NOT NULL)')
team.schema(conn)
conn.execute("INSERT INTO driver(player_id,budget) VALUES('test',10000)")
# Install the released trigger and reproduce the reported category leak.
conn.executescript('''DROP TRIGGER apex_budget_ledger;
CREATE TRIGGER apex_budget_ledger AFTER UPDATE OF budget ON driver
WHEN NEW.budget != OLD.budget BEGIN
  INSERT INTO finance_ledger(player_id,at,category,detail,amount,balance)
  VALUES(NEW.player_id,0,NEW.finance_category,NEW.finance_detail,NEW.budget-OLD.budget,NEW.budget);
  UPDATE driver SET finance_category='adjustment',finance_detail='{}' WHERE player_id=NEW.player_id;
END;''')
team.note(conn, 'test', 'session', dict(name='Test Driver', track='own'))
conn.execute("UPDATE driver SET budget=budget-0 WHERE player_id='test'")
assert conn.execute('SELECT COUNT(*) FROM finance_ledger').fetchone()[0] == 0
conn.execute("UPDATE driver SET budget=budget+6387 WHERE player_id='test'")
assert conn.execute('SELECT category FROM finance_ledger').fetchone()[0] == 'session'
team.schema(conn)
row = conn.execute('SELECT category,amount,balance,detail FROM finance_ledger').fetchone()
assert row[:3] == ('session', 6387, 16387)
assert json.loads(row[3]) == dict(name='Test Driver', track='own')
assert conn.execute('SELECT budget FROM driver').fetchone()[0] == 16387
# No-op budget writes consume their label without creating a ledger entry.
team.note(conn, 'test', 'session', dict(name='Another Driver'))
conn.execute("UPDATE driver SET budget=budget-0 WHERE player_id='test'")
assert conn.execute('SELECT finance_category,finance_detail FROM driver').fetchone() == ('adjustment', '{}')
conn.execute("UPDATE driver SET budget=budget+12 WHERE player_id='test'")
assert conn.execute('SELECT category,detail FROM finance_ledger ORDER BY id DESC LIMIT 1').fetchone() == ('adjustment', '{}')
for category, amount in [('session', -100), ('refund', 50), ('sponsor', 200)]:
    team.note(conn, 'test', category)
    conn.execute("UPDATE driver SET budget=budget+? WHERE player_id='test'", (amount,))
    assert conn.execute('SELECT category,amount FROM finance_ledger ORDER BY id DESC LIMIT 1').fetchone() == (category, amount)
rows = conn.execute('SELECT * FROM finance_ledger').fetchall()
team.schema(conn)
assert conn.execute('SELECT * FROM finance_ledger').fetchall() == rows
print('PASS: reproduced stale session label, preserved historical transactions without guessing their origin, zero-cost sessions clear metadata, normal costs/refunds/sponsors retain categories, schema migration is idempotent')
