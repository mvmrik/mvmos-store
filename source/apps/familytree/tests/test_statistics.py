"""Premium statistics, calendar accuracy and access isolation."""
import pathlib
import types
import unittest
from datetime import date
from test_api import TreeTests, SOURCE


class StatisticsTests(TreeTests):
    # Reuse the API fixture/helpers without rerunning its test methods here.
    def setUp(self):
        super().setUp()
        path = SOURCE / 'premium' / 'backend.py'
        self.stats = types.ModuleType('familytree_statistics_test')
        self.stats.__file__ = str(path)
        exec(compile(path.read_text(), str(path), 'exec'), self.stats.__dict__)
        self.module.statistics_module = lambda: self.stats

    def test_statistics_calendar_precision_and_rankings(self):
        old = self.person('Oldest living',gender='female',birth_date='1940-06-10')['id']
        long = self.person('Longest life',birth_date='1900-01-01',deceased=True,death_date='2001-01-01')['id']
        leap = self.person('Leap birthday',birth_date='1996-02-29')['id']
        self.person('Child one',birth_date='1970-01-01',parents=[old])
        self.person('Child two',birth_year=1972,parents=[old])
        self.person('Missing dates')
        self.person('Deceased without death year',birth_year=1950,deceased=True)
        data = self.stats.calculate(self.module,'owner',self.tid,date(2026,1,1))
        self.assertEqual(data['totals']['people'],7)
        self.assertEqual(data['totals']['living'],5)
        self.assertEqual(data['totals']['generations'],2)
        self.assertEqual(data['rankings']['oldest'][0]['id'],old)
        self.assertEqual(data['rankings']['oldest'][0]['value'],85)
        self.assertFalse(data['rankings']['oldest'][0]['approximate'])
        self.assertEqual(data['rankings']['longest'][0]['id'],long)
        self.assertEqual(data['rankings']['longest'][0]['value'],101)
        self.assertEqual(data['rankings']['mostChildren'][0]['value'],2)
        birthday=next(p for p in data['birthdays'] if p['id']==leap)
        self.assertEqual(birthday['date'],'2026-02-28')
        self.assertEqual(birthday['value'],30)
        self.assertEqual(data['averages']['lifespanSample'],1)
        self.assertEqual(data['averages']['lifespan'],101)
        self.assertTrue(next(p for p in data['rankings']['oldest'] if p['name']=='Child two')['approximate'])
        self.assertFalse(any(p['id']==long for p in data['birthdays']))
        leap_year=self.stats.calculate(self.module,'owner',self.tid,date(2024,1,1))
        self.assertEqual(next(p for p in leap_year['birthdays'] if p['id']==leap)['date'],'2024-02-29')

    def test_statistics_deduplicates_and_never_discloses_private_trees(self):
        pid=self.person('Shared person',birth_year=1960)['id']
        other=self.request('POST','/trees',{'title':'Other family'})['id']
        self.request('POST',f'/trees/{other}/references',{'action':'link','person_id':pid})
        private=self.request('POST','/trees',{'title':'Secret family'},user='stranger')['id']
        secret=self.request('POST',f'/trees/{private}/changes',{'action':'create','data':{'name':'Secret person','birth_year':1900}},user='stranger')['id']
        all_data=self.request('GET','/statistics?scope=all')
        self.assertEqual(all_data['totals']['people'],1)
        self.assertEqual(all_data['totals']['trees'],2)
        self.assertFalse(any(x['id']==private for x in all_data['trees']))
        self.request('GET',f'/statistics?scope={private}',status=404)
        self.request('GET','/statistics',user='invalid',status=401)
        self.request('PUT',f'/trees/{other}/members',{'user_id':'viewer','role':'viewer'})
        before=self.request('GET',f'/statistics?scope={other}',user='viewer')
        self.assertEqual(before['totals']['people'],1)
        self.request('PUT',f'/trees/{self.tid}/members',{'user_id':'viewer','role':'remove'})
        after=self.request('GET',f'/statistics?scope={other}',user='viewer')
        self.assertEqual(after['totals']['people'],0)
        self.assertEqual(self.request('GET','/statistics?scope=all',user='viewer')['totals']['people'],0)

    def test_marriage_and_adoption_statistics(self):
        dad=self.person('Father',birth_year=1960)['id']
        mom=self.person('Mother',birth_year=1962,partners=[{'person_id':dad,'kind':'spouse'}])['id']
        former=self.person('Former spouse',birth_year=1955,partners=[{'person_id':dad,'kind':'former_spouse'}])['id']
        child=self.person('Adopted child',birth_year=2010,parents=[dad,mom],adopted_parents=[dad,mom])['id']
        self.person('Other child',birth_year=1980,parents=[dad])
        data=self.stats.calculate(self.module,'owner',self.tid,date(2026,1,1))
        self.assertEqual(data['totals']['adoptedChildren'],1)
        self.assertEqual(data['totals']['adoptiveParents'],2)
        self.assertEqual(data['totals']['adoptedLinks'],2)
        self.assertEqual(data['totals']['currentMarriages'],1)
        self.assertEqual(data['totals']['formerMarriages'],1)
        self.assertEqual(data['distributions']['marriage'],{'married':2,'noMarriage':3})
        self.assertEqual(data['averages']['parenthoodSample'],1)
        self.assertEqual(data['averages']['parenthood'],20)
        row=next(p for p in data['rankings']['mostChildren'] if p['id']==dad)
        self.assertEqual((row['value'],row['adopted_children']),(2,1))
        other=self.request('POST','/trees',{'title':'Other'})['id']
        self.request('POST',f'/trees/{other}/references',{'action':'link','person_id':child})
        self.assertEqual(self.request('GET','/statistics?scope=all')['totals']['adoptedChildren'],1)

    def test_premium_absence_blocks_statistics_and_code_delivery(self):
        self.assertTrue(self.request('GET','/features')['statistics'])
        script=self.client.get('/pub/familytree/statistics.js')
        self.assertEqual(script.status_code,200)
        self.assertIn('no-store',script.headers['cache-control'])
        self.module.statistics_module=lambda:None
        self.assertFalse(self.request('GET','/features')['statistics'])
        self.request('GET','/statistics',status=402)
        response=self.client.get('/pub/familytree/statistics.js')
        self.assertEqual(response.status_code,404)
        self.assertIn('no-store',response.headers['cache-control'])
        empty=self.stats.calculate(self.module,'stranger','all',date(2026,1,1))
        self.assertEqual(empty['totals']['people'],0)
        self.assertIsNone(empty['averages']['living'])


# Only the new statistics tests are collected; the helper class lives elsewhere.
def load_tests(loader, tests, pattern):
    suite=unittest.TestSuite()
    for name in ('test_marriage_and_adoption_statistics','test_statistics_calendar_precision_and_rankings','test_statistics_deduplicates_and_never_discloses_private_trees','test_premium_absence_blocks_statistics_and_code_delivery'):
        suite.addTest(StatisticsTests(name))
    return suite
