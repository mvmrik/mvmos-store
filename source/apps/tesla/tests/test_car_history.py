"""Daily snapshot boundaries, recorded raw values and access without Tesla calls."""
import json
import zlib
import unittest
from unittest.mock import patch
import test_onboarding as fixtures
api=fixtures.api


class CarHistory(unittest.TestCase):
    setUp=fixtures.Onboarding.setUp
    tearDown=fixtures.Onboarding.tearDown
    prepare=fixtures.Onboarding.prepare
    account=fixtures.Onboarding.account

    def seed(self):
        self.prepare();self.account()
        for ts,battery in [(100,50),(200,60),(300,70)]:
            cur=self.c.execute("INSERT INTO samples(vehicle,ts,battery,state) VALUES('v1',?,?,'charging')",(ts,battery))
            data={'climate_state':{'seat_heater_left':2,'inside_temp':18},'charge_state':{'charger_power':11},'vehicle_state':{'df':1},'vehicle_config':{'car_type':'model3'},'tokens':'secret','drive_state':{'latitude':43}}
            self.c.execute("INSERT INTO raw(sample,vehicle,ts,data) VALUES(?,'v1',?,?)",(cur.lastrowid,ts,zlib.compress(json.dumps(data).encode())))
        self.c.commit()

    def test_bounds_and_half_open_day_use_exact_snapshots(self):
        self.seed()
        with patch.object(api.eng,'http') as tesla:
            base='/pub/tesla/v/v1/history'
            self.assertEqual(self.client.get(base,headers=self.alice).json(),{'first':100,'last':300})
            r=self.client.get(base+'?start=100&end=300',headers=self.alice)
            self.assertEqual(r.status_code,200)
            f=r.json()['frames'];self.assertEqual([x['sample']['battery'] for x in f],[50,60])
            self.assertEqual(f[0]['car']['data']['climate_state']['seat_heater_left'],2)
            self.assertNotIn('tokens',f[0]['car']['data']);self.assertNotIn('drive_state',f[0]['car']['data'])
            self.c.execute('DELETE FROM raw');self.c.commit()
            self.assertEqual(self.client.get(base+'?start=100&end=300',headers=self.alice).json()['frames'][0]['car']['data'],{})
            self.assertEqual(self.client.get(base+'?start=400&end=500',headers=self.alice).json()['frames'],[])
            tesla.assert_not_called()

    def test_access_validation_and_revocation(self):
        self.seed();base='/pub/tesla/v/v1/history?start=100&end=300'
        self.assertIn(self.client.get(base).status_code,(401,403))
        self.assertIn(self.client.get(base,headers=self.bob).status_code,(403,404))
        self.assertEqual(self.client.get('/pub/tesla/v/other/history',headers=self.alice).status_code,404)
        for query in ['start=300&end=100','start=-1&end=200','start=100&end=100000']:
            self.assertEqual(self.client.get('/pub/tesla/v/v1/history?'+query,headers=self.alice).status_code,400)
        self.assertEqual(self.client.get('/pub/tesla/v/v1/history?start=100&end=90100',headers=self.alice).status_code,200)
        api.sharing.grant(self.c,'alice','bob','view')
        self.assertEqual(self.client.get(base,headers=self.bob).status_code,200)
        self.c.execute('DELETE FROM shares');self.c.commit()
        self.assertIn(self.client.get(base,headers=self.bob).status_code,(403,404))

    def test_online_samples_follow_classified_states_and_list_only_events(self):
        self.seed()
        self.c.execute("UPDATE samples SET state='online',charging_state='Charging',charger_power=11")
        self.c.execute("UPDATE samples SET charging_state='Disconnected',shift='D',speed=65 WHERE ts=300")
        for start,end,state in [(100,250,'charging'),(250,300,'asleep'),(300,350,'driving'),(350,None,'offline')]:
            self.c.execute("INSERT INTO states(vehicle,start_ts,end_ts,state) VALUES('v1',?,?,?)",(start,end,state))
        self.c.commit()
        with patch.object(api.eng,'http') as tesla:
            frames=self.client.get('/pub/tesla/v/v1/history?start=100&end=400',headers=self.alice).json()['frames']
            self.assertEqual([f['state'] for f in frames],['charging','charging','asleep','driving','offline'])
            self.assertEqual([f['ts'] for f in frames],[100,200,250,300,350])
            self.assertEqual([f['sample']['ts'] for f in frames],[100,200,200,300,300])
            self.assertEqual(frames[0]['sample']['state'],'online')
            self.assertEqual(frames[0]['sample']['charger_power'],11)
            self.assertEqual(frames[2]['car']['ts'],200)
            self.assertEqual(self.client.get('/pub/tesla/v/v1/history',headers=self.alice).json()['last'],350)
            tesla.assert_not_called()

    def test_fallback_classifies_old_readings_without_state_log(self):
        self.seed()
        self.c.execute("UPDATE samples SET state='online',charging_state='Charging' WHERE ts=100")
        self.c.execute("UPDATE samples SET state='online',shift='D' WHERE ts=200")
        self.c.commit()
        frames=self.client.get('/pub/tesla/v/v1/history?start=100&end=300',headers=self.alice).json()['frames']
        self.assertEqual([f['state'] for f in frames],['charging','driving'])

    def test_state_transition_uses_prior_reading_but_never_a_future_one(self):
        self.seed()
        for start,end,state in [(50,150,'online'),(150,250,'offline'),(250,300,'asleep')]:
            self.c.execute("INSERT INTO states(vehicle,start_ts,end_ts,state) VALUES('v1',?,?,?)",(start,end,state))
        self.c.commit()
        frames=self.client.get('/pub/tesla/v/v1/history?start=220&end=280',headers=self.alice).json()['frames']
        self.assertEqual([(f['ts'],f['sample']['ts'],f['state']) for f in frames],[(250,200,'asleep')])
        self.assertEqual(frames[0]['car']['data']['climate_state']['seat_heater_left'],2)
        frames=self.client.get('/pub/tesla/v/v1/history?start=1&end=100',headers=self.alice).json()['frames']
        self.assertEqual(frames,[])

    def test_historical_charge_details_use_recorded_energy_not_final_totals(self):
        self.seed()
        self.c.execute("UPDATE samples SET energy_added=2.5 WHERE ts=200")
        self.c.execute("INSERT INTO charges(id,vehicle,start_ts,end_ts,start_batt,end_batt,kwh,dc,open) VALUES(1,'v1',100,300,50,90,20,1,0)")
        self.c.execute("INSERT INTO charge_points(charge,ts,voltage,current,energy) VALUES(1,200,400,25,2.5)")
        self.c.commit()
        frame=self.client.get('/pub/tesla/v/v1/history?start=200&end=250',headers=self.alice).json()['frames'][0]
        self.assertEqual(frame['charge'],{'id':1,'start_ts':100,'start_batt':50,'dc':True,'kwh':2.5})
        self.assertEqual(frame['sample']['voltage'],400)
        self.assertEqual(frame['sample']['current'],25)
        self.assertNotIn('end_batt',frame['charge'])

    def test_locations_follow_recorded_coordinates_without_external_lookups(self):
        self.seed()
        self.c.execute("INSERT INTO places(id,user_id,name,lat,lng,radius) VALUES('home','alice','Home',43,27,100)")
        self.c.execute("INSERT INTO trips(vehicle,start_ts,end_ts,start_lat,start_lng,start_addr,end_lat,end_lng,end_addr,open) VALUES('v1',100,300,43.1,27.1,'Recorded street',43.2,27.2,'Recorded destination',0)")
        self.c.execute("UPDATE samples SET lat=43,lng=27 WHERE ts=100")
        self.c.execute("UPDATE samples SET lat=43.1,lng=27.1 WHERE ts=200")
        self.c.execute("UPDATE samples SET lat=44,lng=28 WHERE ts=300")
        self.c.commit()
        with patch.object(api.eng,'http') as http:
            frames=self.client.get('/pub/tesla/v/v1/history?start=100&end=400',headers=self.alice).json()['frames']
            self.assertEqual([f['location'] for f in frames],['Home','Recorded street',''])
            self.assertEqual(frames[-1]['sample']['lat'],44)
            http.assert_not_called()
