"""Battery capacity endpoint and the typed reference in prefs."""
import time
import unittest
import test_onboarding as fixtures
api=fixtures.api
DAY=86400


class BatteryApi(unittest.TestCase):
    setUp=fixtures.Onboarding.setUp
    tearDown=fixtures.Onboarding.tearDown
    prepare=fixtures.Onboarding.prepare
    account=fixtures.Onboarding.account

    def seed(self,n=10):
        self.prepare();self.account()
        now=int(time.time())
        for i in range(n):
            start=now-(n-i)*10*DAY
            self.c.execute("INSERT INTO charges(vehicle,start_ts,end_ts,start_batt,end_batt,kwh,dc,temp_out,open) VALUES('v1',?,?,20,80,34.2,0,15,0)",(start,start+3600))
            self.c.execute("INSERT INTO samples(vehicle,ts,odo_km,battery) VALUES('v1',?,?,80)",(start+3600,50000+i*300))
        self.c.commit()

    def get(self):
        r=self.client.get('/pub/tesla/v/v1/battery',headers=self.alice);self.assertEqual(r.status_code,200);return r.json()

    def test_capacity_comes_from_closed_charges_with_odometer(self):
        self.seed()
        d=self.get()
        self.assertEqual((d['capacity']['status'],d['capacity']['current_kwh'],d['capacity']['count']),('trend',57.0,10))
        self.assertEqual(d['capacity']['points'][0]['odo'],50000)
        self.assertEqual(d['prefs'],{'capacity_kwh':None})

    def test_expected_capacity_is_validated_kept_apart_from_prices_and_removable(self):
        self.seed()
        put=lambda body:self.client.put('/pub/tesla/prefs',json=body,headers=self.alice)
        for bad in [{'capacity_kwh':5},{'capacity_kwh':900}]:
            self.assertEqual(put(bad).status_code,400,bad)
        self.assertEqual(put({'default_ac_price':0.2}).status_code,200)
        self.assertEqual(put({'capacity_kwh':58}).status_code,200)
        out=self.get();self.assertEqual(out['prefs']['capacity_kwh'],58);self.assertEqual(out['capacity']['reference']['pct'],98.3)
        self.assertEqual(put({'default_dc_price':0.4}).json()['capacity_kwh'],58)   # prices never wipe it
        self.assertEqual(put({'capacity_kwh':None}).status_code,200)
        self.assertIsNone(self.get()['capacity']['reference'])

    def test_other_profile_cannot_read_it(self):
        self.seed()
        self.assertIn(self.client.get('/pub/tesla/v/v1/battery',headers=self.bob).status_code,(403,404))


if __name__=='__main__':
    unittest.main()
