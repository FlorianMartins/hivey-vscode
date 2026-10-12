import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from market import is_open

PARIS = ZoneInfo("Europe/Paris")


def utc(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


class MarketTest(unittest.TestCase):
    def test_open_in_winter(self):
        # Paris is UTC+1 in January: 09:30 local is 08:30 UTC.
        self.assertTrue(is_open(utc(2026, 1, 15, 8, 30)))
        self.assertFalse(is_open(utc(2026, 1, 15, 7, 30)))   # 08:30 local, before the open

    def test_open_in_summer(self):
        # Paris is UTC+2 in July: 09:30 local is 07:30 UTC. This is the half of the year the fixed
        # window gets wrong.
        self.assertTrue(is_open(utc(2026, 7, 15, 7, 30)))
        self.assertFalse(is_open(utc(2026, 7, 15, 6, 30)))   # 08:30 local, before the open

    def test_closes_at_half_past_five(self):
        self.assertTrue(is_open(utc(2026, 1, 15, 16, 29)))   # 17:29 local
        self.assertFalse(is_open(utc(2026, 1, 15, 16, 30)))  # 17:30 local, closed

    def test_closed_at_the_weekend(self):
        self.assertFalse(is_open(utc(2026, 1, 17, 10, 0)))   # Saturday
        self.assertFalse(is_open(utc(2026, 1, 18, 10, 0)))   # Sunday

    def test_closed_on_a_holiday_the_caller_supplies(self):
        self.assertFalse(is_open(utc(2026, 1, 15, 10, 0), holidays=("2026-01-15",)))


if __name__ == "__main__":
    unittest.main()
