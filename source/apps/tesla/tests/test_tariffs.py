"""Seasonal tariff writes through the public API, using isolated fixture data."""
import datetime as dt
import unittest
from zoneinfo import ZoneInfo
import test_onboarding as fixtures


class TariffRecords(unittest.TestCase):
    setUp = fixtures.Onboarding.setUp
    tearDown = fixtures.Onboarding.tearDown
    prepare = fixtures.Onboarding.prepare
    account = fixtures.Onboarding.account

    def start(self):
        self.prepare(); self.account()
        r = self.client.post('/pub/tesla/places', headers=self.alice,
                             json={'name':'Home','lat':42,'lng':23,'radius':100})
        self.assertEqual(r.status_code, 200, r.text)
        self.place = r.json()['id']

    def plan(self, summer=True):
        zone = ZoneInfo('Europe/Sofia')
        stamp = lambda y: int(dt.datetime(y,1,1,tzinfo=zone).timestamp())
        season = {'season_from':401 if summer else 1101, 'season_to':1031 if summer else 331}
        return {'name':'Summer' if summer else 'Winter','place_id':self.place,
                'start_ts':stamp(2026),'end_ts':stamp(2027),'currency':'EUR','timezone':'Europe/Sofia','kind':'all',
                'rules':[{'name':name,'from':a,'to':b,'price':price,'days':list(range(7)),**season}
                         for name,a,b,price in [('Day','07:00' if summer else '06:00','23:00' if summer else '22:00',.2),
                                                ('Night','23:00' if summer else '22:00','07:00' if summer else '06:00',.1)]]}

    def save(self, plan, expected=200, tid=None, headers=None):
        response = self.client.request('PUT' if tid else 'POST','/pub/tesla/tariffs'+('/'+tid if tid else ''),
                                       headers=headers or self.alice,json=plan)
        self.assertEqual(response.status_code, expected, response.text)
        return response.json()

    def test_save_two_seasons_edit_and_reject_real_conflicts(self):
        self.start()
        summer = self.save(self.plan())
        winter = self.save(self.plan(False))
        self.assertNotEqual(summer['id'], winter['id'])
        self.save(self.plan(), expected=409)
        changed=self.plan(False);changed['name']='Winter updated';changed['rules'][0]['price']=.3
        self.save(changed, tid=winter['id'])
        changed['rules'][0]['season_from']=1031 # inclusive Oct 31 collides with summer
        self.save(changed, tid=winter['id'], expected=409)
        rows=self.client.get('/pub/tesla/tariffs',headers=self.alice).json()['tariffs']
        self.assertEqual(len(rows),2)
        self.assertEqual(next(p for p in rows if p['id']==winter['id'])['rules'][0]['price'],.3)
        self.assertEqual(self.client.get('/pub/tesla/tariffs',headers=self.bob).status_code,404)
        self.save(self.plan(), headers=self.bob, expected=404)
        self.save(self.plan(), headers={'X-Pub-Token':'invalid'}, expected=401)

    def test_separate_day_and_night_records_and_charging_types(self):
        self.start()
        day=self.plan();night=self.plan()
        day['rules']=day['rules'][:1];night['rules']=night['rules'][1:]
        self.save(day);self.save(night)
        conflict={**day,'kind':'dc'}
        self.save(conflict,expected=409) # all charging types already cover it


if __name__ == '__main__':
    unittest.main()
