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

class SeasonalRecords(unittest.TestCase):
    setUp = ChargingCosts.setUp
    tearDown = ChargingCosts.tearDown
    add = ChargingCosts.add
    def plan(self, rules, **extra):
        return billing.validate({'name':'Season', 'place_id':'home',
            'start_ts':stamp('2026-01-01'), 'end_ts':stamp('2027-01-01'),
            'currency':'EUR', 'timezone':'Europe/Sofia', 'kind':'all', 'rules':rules, **extra})

    def seasonal(self, summer=True):
        season = {'season_from':401 if summer else 1101, 'season_to':1031 if summer else 331}
        return [band('Day', '07:00' if summer else '06:00', '23:00' if summer else '22:00', .2, **season),
                band('Night', '23:00' if summer else '22:00', '07:00' if summer else '06:00', .1, **season)]

    def test_april_october_and_november_march_do_not_conflict(self):
        self.assertFalse(billing.plans_overlap(self.plan(self.seasonal()), self.plan(self.seasonal(False))))
        # The same four bands also work together inside one record.
        self.plan(self.seasonal() + self.seasonal(False))

    def test_season_follows_local_calendar_date_even_before_dawn(self):
        summer, winter = self.seasonal(), self.seasonal(False)
        for iso, yes, no in [('2026-04-01T02:00',summer,winter), ('2026-11-01T02:00',winter,summer),
                             ('2026-03-31T02:00',winter,summer), ('2026-10-31T02:00',summer,winter)]:
            local = dt.datetime.fromisoformat(iso).replace(tzinfo=ZONE)
            self.assertTrue(any(billing.matches(r, local) for r in yes), iso)
            self.assertFalse(any(billing.matches(r, local) for r in no), iso)

    def test_rate_search_continues_to_other_seasonal_record(self):
        self.add('summer', rules=self.seasonal())
        self.add('winter', rules=self.seasonal(False))
        context=billing.Billing(self.c,'owner',{},[self.place],lambda *args:self.place)
        for date, expected in [('2026-07-10T10:00','summer'),('2026-01-12T23:00','winter'),
                                ('2026-04-01T02:00','summer'),('2026-11-01T02:00','winter')]:
            self.assertEqual(context.rate(stamp(date),self.place,False)[0],expected)

    def test_cost_is_split_at_the_season_boundary(self):
        self.add('summer',rules=[band('Summer','00:00','00:00',.2,season_from=401,season_to=1031)])
        self.add('winter',rules=[band('Winter','00:00','00:00',.1,season_from=1101,season_to=331)])
        start,end=stamp('2026-10-31T23:50'),stamp('2026-11-01T00:10')
        self.c.execute('UPDATE charges SET start_ts=?,end_ts=? WHERE id=1',(start,end))
        self.c.execute('DELETE FROM charge_points')
        self.c.executemany('INSERT INTO charge_points(charge,ts,energy) VALUES(1,?,?)',
                           [(start,0),((start+end)//2,5),(end,10)])
        context=billing.Billing(self.c,'owner',{},[self.place],lambda *args:self.place)
        row=dict(self.c.execute('SELECT * FROM charges WHERE id=1').fetchone())
        result=context.decorate(row)
        self.assertEqual(result['cost'],1.5)
        self.assertEqual({b['tariff_id'] for b in result['cost_breakdown']},{'summer','winter'})
        self.assertFalse(result['pricing_estimated'])

    def test_actual_overlap_still_rejected_including_shared_end_date(self):
        a=self.plan([band('First','00:00','00:00',1,season_from=401,season_to=1031)])
        b=self.plan([band('Second','00:00','00:00',2,season_from=1031,season_to=331)])
        self.assertTrue(billing.plans_overlap(a,b))
        self.assertTrue(billing.plans_overlap(a,a))
        self.assertFalse(billing.plans_overlap({**a,'kind':'ac'},{**a,'kind':'dc'}))

    def test_disjoint_times_days_and_validity(self):
        a=self.plan([band('Day','07:00','22:00',1)])
        b=self.plan([band('Night','22:00','07:00',1)])
        self.assertFalse(billing.plans_overlap(a,b))
        a=self.plan([band('Monday','00:00','00:00',1,days=[0])])
        b=self.plan([band('Tuesday','00:00','00:00',1,days=[1])])
        self.assertFalse(billing.plans_overlap(a,b))
        b={**a,'start_ts':a['end_ts'],'end_ts':stamp('2028-01-01')}
        self.assertFalse(billing.plans_overlap(a,b))

    def test_partial_validity_boundary_does_not_create_false_overlap(self):
        a=self.plan([band('Morning','01:00','02:00',1)],start_ts=stamp('2026-01-12T02:00'),end_ts=stamp('2026-01-12T03:00'))
        self.assertFalse(billing.plans_overlap(a,a))

    def test_february_29_and_year_wrap(self):
        leap=self.plan([band('Leap','00:00','00:00',1,season_from=229,season_to=229)])
        self.assertFalse(billing.plans_overlap(leap,leap)) # no leap day in 2026
        leap.update(start_ts=stamp('2028-01-01'),end_ts=stamp('2029-01-01'))
        self.assertTrue(billing.plans_overlap(leap,leap))
        winter=self.plan(self.seasonal(False))
        self.assertTrue(billing.plans_overlap(winter,winter))

    def test_different_timezones_compare_real_instants(self):
        a=self.plan([band('Local','10:00','11:00',1)],start_ts=stamp('2026-01-12'),end_ts=stamp('2026-01-13'))
        b=self.plan([band('UTC','08:00','09:00',1)],timezone='UTC',start_ts=a['start_ts'],end_ts=a['end_ts'])
        self.assertTrue(billing.plans_overlap(a,b))
        b['rules']=[band('UTC','09:00','10:00',1)]
        self.assertFalse(billing.plans_overlap(a,b))

    def test_dst_gap_and_both_repeated_hours(self):
        a=self.plan([band('Missing','03:10','03:20',1)],start_ts=stamp('2026-03-29'),end_ts=stamp('2026-03-30'))
        self.assertFalse(billing.plans_overlap(a,a))
        a=self.plan([band('Before jump','02:30','03:30',1)],start_ts=a['start_ts'],end_ts=a['end_ts'])
        self.assertTrue(billing.plans_overlap(a,a))
        for utc in ['2026-10-25T00:30:00+00:00','2026-10-25T01:30:00+00:00']:
            ts=int(dt.datetime.fromisoformat(utc).timestamp())
            a=self.plan([band('Repeated','03:00','04:00',1)],start_ts=ts,end_ts=ts+60)
            self.assertTrue(billing.plans_overlap(a,a))


if __name__ == '__main__':
    unittest.main()
