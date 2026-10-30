"""Terrain math, missing data/cache behavior and route authorization."""
import gzip
import io
import os
import struct
import tempfile
import unittest
from unittest.mock import patch
import test_onboarding as fixtures
api = fixtures.api
elev = api.elevation


class Terrain(unittest.TestCase):
    def test_square_and_bilinear_and_void(self):
        self.assertEqual(elev.square(-.1,-.1),'S01W001')
        self.assertEqual(elev.square(43.2,27.9),'N43E027')
        raw=struct.pack('>4h',100,200,0,100)
        self.assertEqual(elev.height(raw,2,.5,.5),100)
        self.assertEqual(elev.height(raw,2,.75,.25),100)
        self.assertIsNone(elev.height(struct.pack('>4h',-32768,0,0,0),2,.5,.5))
        self.assertEqual(elev.height(struct.pack('>4h',-10,-10,-10,-10),2,.5,.5),-10)

    def test_download_once_and_cache_and_invalid_payload(self):
        with tempfile.TemporaryDirectory() as cache, patch.object(elev,'CACHE',cache), patch.object(elev,'_FAILED',{}):
            raw=struct.pack('>h',100)*(1201**2)
            with patch.object(elev.urllib.request,'urlopen',return_value=io.BytesIO(gzip.compress(raw))) as http:
                path=elev._tile('N43E027',elev.time.monotonic()+20)
                self.assertEqual(os.path.getsize(path),len(raw))
                self.assertEqual(path,elev._tile('N43E027',elev.time.monotonic()+20))
                self.assertEqual(http.call_count,1)
                self.assertIn('/skadi/N43/N43E027.hgt.gz',http.call_args.args[0].full_url)
            with patch.object(elev.urllib.request,'urlopen',return_value=io.BytesIO(gzip.compress(b'bad'))):
                self.assertIsNone(elev._tile('N44E027',elev.time.monotonic()+20))
            self.assertFalse(os.path.exists(os.path.join(cache,'N44E027.hgt')))

    def test_profile_smoothing_gaps_and_missing(self):
        rows=[(1,100+i*10,43.2,27.1+i*.001) for i in range(5)]
        with tempfile.NamedTemporaryFile() as f:
            f.write(struct.pack('>h',0)*(1201**2));f.flush()
            with patch.object(elev,'_tile',return_value=f.name),patch.object(elev,'height',side_effect=[10,11,20,15,14]):
                p=elev.profile(rows)
                self.assertEqual((p['ascent_m'],p['descent_m']),(10,5));self.assertFalse(p['partial'])
            with patch.object(elev,'_tile',return_value=None):
                p=elev.profile(rows);self.assertEqual(p['samples'],0);self.assertIsNone(p['min_m']);self.assertTrue(p['partial'])
            with patch.object(elev,'_tile',return_value=f.name),patch.object(elev,'height',side_effect=[10,100]):
                p=elev.profile([rows[0],(2,200,43.2,27.101)])
                self.assertEqual(p['ascent_m'],0);self.assertIn(None,[x[1] for x in p['points']])
        self.assertEqual(elev.profile([])['samples'],0)


class ElevationAccess(unittest.TestCase):
    setUp = fixtures.Onboarding.setUp
    tearDown = fixtures.Onboarding.tearDown
    prepare = fixtures.Onboarding.prepare
    account = fixtures.Onboarding.account

    def test_unauthorized_requests_do_not_download(self):
        self.prepare();self.account()
        with patch.object(elev,'profile') as profile:
            for suffix in ('trips/1/elevation','journeys/missing/elevation'):
                base='/pub/tesla/v/v1/'+suffix
                self.assertIn(self.client.get(base).status_code,(401,403))
                self.assertIn(self.client.get(base,headers=self.bob).status_code,(403,404))
                self.assertEqual(self.client.get(base,headers=self.alice).status_code,404)
            profile.assert_not_called()

    def test_owner_and_shared_reader_use_stored_trip_only(self):
        self.prepare();self.account()
        self.c.execute("INSERT INTO trips(id,vehicle,start_ts,end_ts,open) VALUES(1,'v1',100,200,0)")
        self.c.execute("INSERT INTO trip_points(trip,ts,lat,lng) VALUES(1,100,43.2,27.1)")
        self.c.commit()
        with patch.object(elev,'profile',return_value={'samples':1}) as profile,patch.object(api.eng,'http') as tesla:
            r=self.client.get('/pub/tesla/v/v1/trips/1/elevation',headers=self.alice)
            self.assertEqual(r.status_code,200);self.assertEqual(list(profile.call_args.args[0][0]),[1,100,43.2,27.1]);tesla.assert_not_called()
            self.assertEqual(self.client.get('/pub/tesla/v/other/trips/1/elevation',headers=self.alice).status_code,404)
            api.sharing.grant(self.c,'alice','bob','view')
            self.assertEqual(self.client.get('/pub/tesla/v/v1/trips/1/elevation',headers=self.bob).status_code,200)
            self.c.execute("INSERT INTO journeys(id,user_id,vehicle,name,start_ts,end_ts,created_ts,updated_ts) VALUES('j1','alice','v1','Test',90,210,90,90)")
            self.c.commit()
            self.assertEqual(self.client.get('/pub/tesla/v/v1/journeys/j1/elevation',headers=self.bob).status_code,200)
            self.assertEqual(len(profile.call_args.args[0]),1)
            self.c.execute("DELETE FROM shares");self.c.commit();profile.reset_mock()
            self.assertIn(self.client.get('/pub/tesla/v/v1/journeys/j1/elevation',headers=self.bob).status_code,(403,404))
            profile.assert_not_called()

