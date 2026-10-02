import unittest
from datetime import datetime, timedelta, timezone

from session import expired

NOW = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)


class ExpiredTest(unittest.TestCase):
    def test_a_timestamp_with_an_offset(self):
        issued = datetime(2026, 10, 2, 13, 30, tzinfo=timezone(timedelta(hours=2)))  # 11:30 UTC
        self.assertFalse(expired(issued, NOW))

    def test_an_offset_that_makes_it_old(self):
        issued = datetime(2026, 10, 2, 8, 0, tzinfo=timezone(timedelta(hours=-3)))  # 11:00 UTC
        self.assertFalse(expired(issued, NOW))
        issued = datetime(2026, 10, 2, 5, 0, tzinfo=timezone(timedelta(hours=-3)))  # 08:00 UTC
        self.assertTrue(expired(issued, NOW))

    def test_a_bare_timestamp_is_read_as_utc(self):
        self.assertFalse(expired(datetime(2026, 10, 2, 11, 30), NOW))
        self.assertTrue(expired(datetime(2026, 10, 2, 8, 0), NOW))


if __name__ == "__main__":
    unittest.main()
