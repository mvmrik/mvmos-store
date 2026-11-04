"""Capacity estimated from charging sessions: filters, thresholds and the typed reference."""
import importlib.util
import os
import unittest

_spec = importlib.util.spec_from_file_location("bh", os.path.join(os.path.dirname(__file__), "..", "battery_health.py"))
bh = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bh)
DAY = 86400
T0 = 1_700_000_000


def row(i, day, cap, start=20, end=80, **kw):
    kwh = cap * (end - start) / 100.0
    return {"id": i, "open": 0, "start_ts": T0 + day * DAY, "end_ts": T0 + day * DAY + 3600, "start_batt": start, "end_batt": end,
            "kwh": kwh, "dc": 0, "temp_out": 15, "odo": None, **kw}


class Capacity(unittest.TestCase):
    def test_no_usable_sessions_means_nothing_to_show(self):
        rows = [row(1, 0, 57, 50, 70), row(2, 1, 57, open=1), row(3, 2, 57, kwh=0)]
        rows[2]["kwh"] = 0
        self.assertEqual(bh.capacity(rows, now=T0 + 9 * DAY)["status"], "none")

    def test_few_sessions_collect_without_a_number(self):
        c = bh.capacity([row(1, 0, 57), row(2, 3, 57)], now=T0 + 5 * DAY)
        self.assertEqual((c["status"], c["current_kwh"], c["count"]), ("collecting", None, 2))

    def test_estimate_without_change_until_enough_sessions_and_days(self):
        c = bh.capacity([row(i, i * 2, 57) for i in range(5)], now=T0 + 20 * DAY)
        self.assertEqual((c["status"], c["current_kwh"], c["change_pct"]), ("estimate", 57.0, None))
        c = bh.capacity([row(i, i, 57) for i in range(10)], now=T0 + 20 * DAY)
        self.assertEqual(c["status"], "estimate")          # ten sessions but only nine days apart

    def test_change_compares_latest_with_first_sessions(self):
        rows = [row(i, i * 10, 58 - i * 0.2) for i in range(12)]
        c = bh.capacity(rows, now=T0 + 130 * DAY)
        self.assertEqual(c["status"], "trend")
        self.assertLess(c["change_pct"], 0)
        self.assertAlmostEqual(c["baseline_kwh"], 57.7, delta=0.3)

    def test_full_charge_counts_double_and_is_reported(self):
        rows = [row(i, i * 10, 57) for i in range(6)] + [row(7, 70, 60, 20, 100)]
        c = bh.capacity(rows, now=T0 + 80 * DAY)
        self.assertEqual((c["full_count"], c["since_full_days"]), (1, 10))
        self.assertTrue(c["points"][-1]["full"])

    def test_expected_capacity_gives_percent_of_it(self):
        rows = [row(i, i * 10, 54) for i in range(10)]
        ref = bh.capacity(rows, 60, now=T0 + 100 * DAY)["reference"]
        self.assertEqual((ref["kwh"], ref["pct"], ref["gap_kwh"], ref["far_off"]), (60, 90.0, -6.0, False))
        self.assertIsNone(bh.capacity(rows, now=T0 + 100 * DAY)["reference"])

    def test_far_off_expected_capacity_is_flagged_but_still_compared(self):
        rows = [row(i, i * 10, 54) for i in range(10)]
        ref = bh.capacity(rows, 80, now=T0 + 100 * DAY)["reference"]
        self.assertTrue(ref["far_off"])
        self.assertEqual(ref["pct"], 67.5)

    def test_no_comparison_before_an_estimate_exists(self):
        self.assertIsNone(bh.capacity([row(1, 0, 57)], 58, now=T0 + DAY)["reference"])


if __name__ == "__main__":
    unittest.main()
