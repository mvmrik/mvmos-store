"""Run: python3 -m unittest discover -s apps/tesla/tests -v"""
import datetime as dt
import importlib.util
import json
import pathlib
import tempfile
import unittest
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]

def load(name):
    spec = importlib.util.spec_from_file_location('tesla_test_' + name, ROOT / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

billing, engine = load('billing'), load('engine')
ZONE = ZoneInfo('Europe/Sofia')
def stamp(s):
    return int(dt.datetime.fromisoformat(s).replace(tzinfo=ZONE).timestamp())

def band(name, start, end, price, **extra):
    return {'name':name,'from':start,'to':end,'price':price,'days':list(range(7)),
            'season_from':101,'season_to':1231,**extra}

class ChargingCosts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = engine.DB_PATH
        engine.DB_PATH = self.temp.name + '/history.db'
        self.c = engine.db()
        self.start, self.end = stamp('2026-01-12T21:50'), stamp('2026-01-12T22:10')
        self.c.execute("INSERT INTO charges(id,vehicle,start_ts,end_ts,kwh,lat,lng,open) VALUES(1,'car',?,?,10,42,23,0)", (self.start,self.end))
        self.c.executemany('INSERT INTO charge_points(charge,ts,energy) VALUES(1,?,?)', [(self.start,0),((self.start+self.end)//2,5),(self.end,10)])
        self.place = {'id':'home','name':'Home','lat':42,'lng':23,'radius':100,'ac_price':None,'dc_price':None}

    def tearDown(self):
        self.c.close()
        engine.DB_PATH = self.old_db
        self.temp.cleanup()

    def add(self, name='plan', **extra):
        p = billing.validate({'name':name,'place_id':'home','start_ts':stamp('2026-01-01'),
            'end_ts':stamp('2027-01-01'),'currency':'EUR','timezone':'Europe/Sofia','kind':'all',
            'rules':[band('Day','07:00','22:00',.2),band('Night','22:00','07:00',.1)],**extra})
        self.c.execute('INSERT INTO tariffs(id,user_id,place_id,name,start_ts,end_ts,currency,timezone,kind,rules,created_ts,updated_ts) VALUES(?,?,?,?,?,?,?,?,?,?,0,0)',
                       (name,'owner',p['place_id'],p['name'],p['start_ts'],p['end_ts'],p['currency'],p['timezone'],p['kind'],json.dumps(p['rules'])))

    def priced(self, start=None, end=None, owner='owner'):
        context = billing.Billing(self.c, owner, {}, [self.place], lambda *args:self.place)
        row = dict(self.c.execute('SELECT * FROM charges WHERE id=1').fetchone())
        row.update(start_ts=start or self.start,end_ts=end or self.end)
        return context.decorate(row)

    def test_meter_reading_exactly_at_tariff_boundary(self):
        self.add()
        r = self.priced()
        self.assertEqual(r['cost'],1.5)
        self.assertFalse(r['pricing_estimated'])
        self.assertEqual([b['kwh'] for b in r['cost_breakdown']],[5,5])
        self.assertEqual(self.priced(end=(self.start+self.end)//2)['cost'],1)

    def test_interpolated_split_is_marked_but_flat_total_is_exact(self):
        self.add()
        self.c.execute('DELETE FROM charge_points WHERE energy=5')
        self.assertTrue(self.priced()['pricing_estimated'])
        self.c.execute('DELETE FROM tariffs')
        self.add(rules=[band('Flat','00:00','00:00',.2)])
        self.assertEqual(self.priced()['cost'],2)
        self.assertFalse(self.priced()['pricing_estimated'])

    def test_unknown_price_keeps_known_subtotal_and_energy(self):
        self.add(rules=[band('Day','07:00','22:00',.2)])
        r=self.priced()
        self.assertIsNone(r['cost'])
        self.assertEqual(r['known_cost'],1)
        self.assertEqual(r['unpriced_kwh'],5)
        self.assertFalse(r['cost_complete'])

    def test_currency_totals_are_separate_and_owner_scoped(self):
        middle=(self.start+self.end)//2
        self.add('first',end_ts=middle)
        self.add('second',start_ts=middle,currency='USD')
        r=self.priced()
        self.assertIsNone(r['cost'])
        self.assertEqual({x['currency']:x['cost'] for x in r['cost_totals']},{'EUR':1,'USD':.5})
        self.assertTrue(r['cost_complete'])
        self.assertFalse(self.priced(owner='other')['cost_complete'])

    def test_fixed_total_overrides_tariffs_and_partial_window_is_proportional(self):
        self.add()
        self.c.execute("INSERT INTO charge_costs(charge,user_id,currency,total_cost,updated_ts) VALUES(1,'owner','EUR',7.5,0)")
        self.assertEqual(self.priced()['cost'],7.5)
        self.assertFalse(self.priced()['pricing_estimated'])
        partial=self.priced(end=(self.start+self.end)//2)
        self.assertEqual(partial['cost'],3.75)
        self.assertTrue(partial['pricing_estimated'])

    def test_free_price_is_known_zero(self):
        self.add(rules=[band('Free','00:00','00:00',0)])
        self.assertEqual(self.priced()['cost'],0)
        self.assertTrue(self.priced()['cost_complete'])

    def test_annual_overnight_rules_use_start_weekday_and_real_timezone(self):
        r=band('Winter','22:00','07:00',1,days=[0],season_from=1001,season_to=331)
        self.assertTrue(billing.matches(r,dt.datetime(2026,1,13,2,tzinfo=ZONE)))
        self.assertFalse(billing.matches(r,dt.datetime(2026,7,14,2,tzinfo=ZONE)))
        for utc in ['2026-10-25T00:30:00+00:00','2026-10-25T01:30:00+00:00']:
            self.assertTrue(billing.matches(band('Night','22:00','07:00',1),dt.datetime.fromisoformat(utc).astimezone(ZONE)))

    def test_overlapping_bands_are_rejected(self):
        with self.assertRaises(ValueError):
            self.add(rules=[band('A','00:00','12:00',1),band('B','10:00','23:00',2)])

if __name__ == '__main__':
    unittest.main()
