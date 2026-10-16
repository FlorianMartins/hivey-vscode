import unittest
from datetime import date

from billing import due_today, next_charge
from subscription import renewals


class RenewalTest(unittest.TestCase):
    def test_mid_month_start(self):
        self.assertEqual(
            renewals(date(2026, 1, 15), 3),
            [date(2026, 2, 15), date(2026, 3, 15), date(2026, 4, 15)],
        )

    def test_across_the_year(self):
        self.assertEqual(renewals(date(2026, 11, 10), 2), [date(2026, 12, 10), date(2027, 1, 10)])

    def test_next_charge(self):
        self.assertEqual(next_charge(date(2026, 1, 15), date(2026, 3, 15)), date(2026, 4, 15))

    def test_due_today(self):
        subs = {"a": date(2026, 1, 15), "b": date(2026, 1, 16), "c": date(2025, 12, 15)}
        self.assertEqual(due_today(subs, date(2026, 3, 15)), ["a", "c"])


if __name__ == "__main__":
    unittest.main()
