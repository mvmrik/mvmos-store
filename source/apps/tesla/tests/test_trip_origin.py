"""Sparse polling retains the parked origin without inventing driving time."""
import unittest
from unittest.mock import patch
import test_onboarding as fixtures

api = fixtures.api


class TripOrigin(unittest.TestCase):
    setUp = fixtures.Onboarding.setUp
    tearDown = fixtures.Onboarding.tearDown
    prepare = fixtures.Onboarding.prepare
    account = fixtures.Onboarding.account

    def start(self, **parked):
        self.prepare()
        self.account()
        values = dict(ts=100, lat=43.1, lng=27.1, speed=0, shift='P',
                      odo_km=1000, battery=80, range_km=400)
        values.update(parked)
        self.c.execute('INSERT INTO samples(vehicle,%s) VALUES(?,%s)' %
                       (','.join(values), ','.join('?' for _ in values)),
                       ['v1', *values.values()])
        return api.eng.last_sample(self.c, 'v1')

    def drive(self, ts, prev=None, odo=1005):
        s = api.eng.parse_sample({})
        s.update(lat=43.12, lng=27.12, shift='D', speed=50, power=12,
                 odo_km=odo, battery=79, range_km=395)
        api.eng.trip_update(self.c, api.eng.get_poll(self.c, 'v1'),
                            {'id': 'v1'}, s, ts, prev)
        return self.c.execute('SELECT * FROM trips').fetchone()

    def finish(self):
        with patch.object(api.eng, 'reverse_geocode'):
            p = api.eng.get_poll(self.c, 'v1')
            api.eng.close_trip(self.c, p, p['trip_id'])
        self.c.commit()

    def detail(self):
        r = self.client.get('/pub/tesla/v/v1/trips/1', headers=self.alice)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_hours_old_parked_origin_survives_report_without_parked_energy(self):
        prev = self.start()
        self.drive(7300, prev)
        self.drive(7360, odo=1006)
        self.finish()
        with patch.object(api.eng, 'http') as http:
            d = self.detail()
            http.assert_not_called()
        self.assertEqual(d['start_ts'], 7300)
        self.assertEqual(d['distance_km'], 6)
        a = d['analysis']
        self.assertEqual(a['stats']['driving_seconds'], 60)
        self.assertAlmostEqual(a['stats']['consumed_kwh'], .2)
        self.assertEqual(len(a['routes']), 1)
        self.assertEqual(a['routes'][0]['points'][0], [43.1, 27.1, None, 100])
        self.assertEqual([p[3] for p in a['routes'][0]['points']], [100, 7300, 7360])
        self.assertEqual([p[0] for p in a['playback']], [7300, 7360])

    def test_single_moving_reading_still_has_a_route_from_home(self):
        prev = self.start()
        self.drive(7300, prev)
        self.finish()
        a = self.detail()['analysis']
        self.assertEqual([p[:2] for p in a['routes'][0]['points']],
                         [[43.1, 27.1], [43.12, 27.12]])
        self.assertEqual(a['stats']['distance_km'], 5)
        self.assertEqual(a['stats']['driving_seconds'], 0)
        self.assertIsNone(a['stats']['avg_speed'])
        self.c.execute("INSERT INTO journeys(id,user_id,vehicle,name,start_ts,end_ts,created_ts,updated_ts) VALUES('j1','alice','v1','Short drive',7300,7400,1,1)")
        self.c.commit()
        r = self.client.get('/pub/tesla/v/v1/journeys/j1', headers=self.alice)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['analysis']['routes'], a['routes'])

    def test_saved_period_including_departure_keeps_origin_but_later_period_does_not(self):
        prev = self.start()
        self.drive(7300, prev)
        self.drive(7360, odo=1006)
        self.finish()
        self.c.execute("INSERT INTO journeys(id,user_id,vehicle,name,start_ts,end_ts,created_ts,updated_ts) VALUES('j1','alice','v1','Test',7200,7400,1,1)")
        self.c.commit()
        def report():
            r = self.client.get('/pub/tesla/v/v1/journeys/j1', headers=self.alice)
            self.assertEqual(r.status_code, 200, r.text)
            return r.json()['analysis']
        self.assertEqual(report()['routes'][0]['points'][0][:2], [43.1, 27.1])
        self.c.execute("UPDATE journeys SET start_ts=7330 WHERE id='j1'")
        self.c.commit()
        self.assertNotIn([43.1, 27.1], [p[:2] for r in report()['routes'] for p in r['points']])

    def test_moving_or_incomplete_previous_reading_is_not_a_parked_origin(self):
        self.start()
        for values in ({'speed': 20, 'shift': None}, {'lng': None}, {'shift': 'D'}):
            with self.subTest(values=values):
                self.c.execute('DELETE FROM samples')
                self.c.execute('DELETE FROM trips')
                self.c.execute('DELETE FROM poll')
                self.c.execute("INSERT INTO samples(vehicle,ts,lat,lng,speed,shift) VALUES('v1',100,43.1,?,?,?)",
                               (values.get('lng', 27.1), values.get('speed', 0), values.get('shift', 'P')))
                prev = api.eng.last_sample(self.c, 'v1')
                tr = self.drive(7300, prev)
                self.assertEqual((tr['start_lat'], tr['start_lng']), (43.12, 27.12))
                self.assertEqual(self.c.execute('SELECT COUNT(*) FROM trip_points').fetchone()[0], 1)
                self.c.execute('DELETE FROM trip_points')
