"""Replay preserves raw readings and their irregular timestamps."""
import unittest
from unittest.mock import patch
import test_onboarding as fixtures
api=fixtures.api


class Playback(unittest.TestCase):
    setUp=fixtures.Onboarding.setUp
    tearDown=fixtures.Onboarding.tearDown
    prepare=fixtures.Onboarding.prepare
    account=fixtures.Onboarding.account

    def start(self):
        self.prepare();self.account()
        self.c.execute("INSERT INTO trips(id,vehicle,start_ts,end_ts,open) VALUES(1,'v1',100,2500,0)")
        for ts,lat,speed,state in [(100,43.2,60,'driving'),(400,43.21,0,'online'),(2200,None,None,'asleep'),(2500,43.23,80,'driving')]:
            self.c.execute("INSERT INTO samples(vehicle,ts,lat,lng,speed,power,battery,state) VALUES('v1',?,?,27.9,?,10,55,?)",(ts,lat,speed,state))
        self.c.execute("INSERT INTO journeys(id,user_id,vehicle,name,start_ts,end_ts,created_ts,updated_ts) VALUES('j1','alice','v1','Replay',100,2500,100,100)")
        self.c.commit()

    def test_trip_and_saved_journey_preserve_waits_missing_values_and_no_external_calls(self):
        self.start()
        with patch.object(api.eng,'http') as tesla:
            for path in ('trips/1','journeys/j1'):
                r=self.client.get('/pub/tesla/v/v1/'+path,headers=self.alice)
                self.assertEqual(r.status_code,200,r.text)
                frames=r.json()['analysis']['playback']
                self.assertEqual([p[0] for p in frames],[100,400,2200,2500])
                self.assertEqual([frames[i+1][0]-frames[i][0] for i in range(3)],[300,1800,300])
                self.assertEqual(frames[1][3],0);self.assertIsNone(frames[2][3]);self.assertIsNone(frames[2][1])
            tesla.assert_not_called()

    def test_fallback_uses_actual_trip_points_without_synthetic_endpoints(self):
        self.start();self.c.execute('DELETE FROM samples')
        self.c.executemany("INSERT INTO trip_points(trip,ts,lat,lng,speed,power,battery) VALUES(1,?,43.2,27.9,50,12,55)",[(200,),(500,),(2300,)])
        self.c.commit()
        r=self.client.get('/pub/tesla/v/v1/trips/1',headers=self.alice)
        self.assertEqual([p[0] for p in r.json()['analysis']['playback']],[200,500,2300])

    def test_charging_power_is_distinct_from_battery_power(self):
        self.start()
        self.c.execute("UPDATE samples SET state='charging',power=-10.5,charger_power=11 WHERE ts=400")
        self.c.commit()
        frames=self.client.get('/pub/tesla/v/v1/journeys/j1',headers=self.alice).json()['analysis']['playback']
        self.assertEqual(frames[1][4],-10.5)
        self.assertEqual(frames[1][6],'charging')
        self.assertEqual(frames[1][7],11)
