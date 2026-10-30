"""Manual readings bypass the schedule but keep access checks and history."""
import unittest
from unittest.mock import patch
import test_onboarding as fixtures
api = fixtures.api

class Refresh(unittest.TestCase):
    setUp = fixtures.Onboarding.setUp
    tearDown = fixtures.Onboarding.tearDown
    prepare = fixtures.Onboarding.prepare
    account = fixtures.Onboarding.account

    def start(self):
        self.prepare(); self.account()
        api.eng.get_poll(self.c, 'v1')
        self.c.execute("UPDATE poll SET mode='asleep',last_state='offline',next_check=9999999999,next_data=9999999999 WHERE vehicle='v1'")
        self.c.commit()

    def request(self):
        return self.client.post('/pub/tesla/v/v1/refresh', headers=self.alice)

    def test_requests_data_despite_offline_and_future_schedule_and_saves_reading(self):
        self.start()
        with patch.object(api.eng, 'http', return_value=(200, {'response': {'charge_state': {'battery_level':55}}})) as http:
            response = self.request()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['updated'])
        self.assertEqual(http.call_count, 1)
        self.assertEqual(http.call_args.args[0], 'GET')
        self.assertIn('/vehicles/v1/vehicle_data?', http.call_args.args[1])
        self.assertEqual(self.c.execute('SELECT battery FROM samples').fetchone()[0], 55)
        self.assertEqual(self.c.execute("SELECT n FROM user_usage WHERE kind='data'").fetchone()[0], 1)
        self.assertEqual(self.c.execute('SELECT busy_until FROM poll').fetchone()[0], 0)

    def test_sleeping_car_returns_unavailable_without_wake_command(self):
        self.start()
        with patch.object(api.eng, 'http', return_value=(408, {})) as http:
            response = self.request()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'updated':False,'state':'asleep'})
        self.assertEqual(http.call_count, 1)
        self.assertEqual(http.call_args.args[0], 'GET')
        self.assertEqual(self.c.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 0)

    def test_error_is_not_reported_as_sleep_or_success(self):
        self.start()
        with patch.object(api.eng, 'http', return_value=(403, {})):
            response = self.request()
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(response.json()['error'], 'refresh_failed')

    def test_tesla_rate_limit_is_reported_as_pause(self):
        self.start()
        with patch.object(api.eng, 'http', return_value=(429, {})) as http:
            response = self.request()
        self.assertEqual(response.status_code, 429, response.text)
        self.assertEqual(response.json()['error'], 'refresh_busy')
        self.assertEqual(http.call_count, 1)

    def test_busy_and_rate_limit_do_not_send_requests(self):
        self.start()
        for table,field in [('poll','busy_until'),('accounts','backoff_until')]:
            self.c.execute('UPDATE '+table+' SET '+field+'=9999999999'); self.c.commit()
            with patch.object(api.eng, 'http') as http:
                self.assertIn(self.request().status_code, (409,429)); http.assert_not_called()
            self.c.execute('UPDATE '+table+' SET '+field+'=0'); self.c.commit()

    def test_disconnect_and_other_users_cannot_request_readings(self):
        self.start()
        with patch.object(api.eng, 'http') as http:
            self.assertEqual(self.client.post('/pub/tesla/v/v1/refresh',headers=self.bob).status_code,404)
            self.c.execute('DELETE FROM accounts'); self.c.commit()
            self.assertEqual(self.request().status_code,409); http.assert_not_called()

    def test_viewer_denied_admin_uses_owners_account(self):
        self.start()
        for role in ('view','admin'):
            self.c.execute("INSERT OR REPLACE INTO shares(owner_id,user_id,role,created_ts) VALUES('alice','bob',?,0)",(role,)); self.c.commit()
            with patch.object(api.eng, 'http',return_value=(408,{})) as http:
                response=self.client.post('/pub/tesla/v/v1/refresh',headers=self.bob)
                self.assertEqual(response.status_code,403 if role=='view' else 200,response.text)
                self.assertEqual(http.call_count,0 if role=='view' else 1)
