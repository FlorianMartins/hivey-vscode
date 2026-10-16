import unittest
from datetime import date

from billing import due_today, next_charge
from subscription import renewals


class MonthEndTest(unittest.TestCase):
    def test_the_31st_renews_on_the_last_day_and_comes_back(self):
        self.assertEqual(
            renewals(date(2026, 1, 31), 6),
            [
                date(2026, 2, 28),
                date(2026, 3, 31),
                date(2026, 4, 30),
                date(2026, 5, 31),
                date(2026, 6, 30),
                date(2026, 7, 31),
            ],
        )

    def test_the_30th_and_the_29th(self):
        self.assertEqual(renewals(date(2026, 1, 30), 3), [date(2026, 2, 28), date(2026, 3, 30), date(2026, 4, 30)])
        self.assertEqual(renewals(date(2026, 1, 29), 2), [date(2026, 2, 28), date(2026, 3, 29)])

    def test_a_leap_year(self):
        self.assertEqual(renewals(date(2028, 1, 31), 2), [date(2028, 2, 29), date(2028, 3, 31)])

    def test_a_start_on_the_29th_of_february(self):
        out = renewals(date(2024, 2, 29), 13)
        self.assertEqual(out[0], date(2024, 3, 29))
        self.assertEqual(out[11], date(2025, 2, 28))
        self.assertEqual(out[12], date(2025, 3, 29))

    def test_december_31st_across_the_year(self):
        self.assertEqual(renewals(date(2026, 12, 31), 3), [date(2027, 1, 31), date(2027, 2, 28), date(2027, 3, 31)])

    def test_two_years_out_still_on_the_anchor_day(self):
        out = renewals(date(2026, 1, 31), 24)
        self.assertEqual(len(out), 24)
        self.assertEqual(out[-1], date(2028, 1, 31))
        self.assertEqual(out[12], date(2027, 2, 28))
        self.assertEqual(out[13], date(2027, 3, 31))

    def test_no_renewals(self):
        self.assertEqual(renewals(date(2026, 1, 31), 0), [])

    def test_next_charge_after_a_short_month(self):
        self.assertEqual(next_charge(date(2026, 1, 31), date(2026, 2, 28)), date(2026, 3, 31))
        self.assertEqual(next_charge(date(2026, 1, 31), date(2026, 3, 1)), date(2026, 3, 31))
        self.assertEqual(next_charge(date(2026, 1, 31), date(2026, 1, 31)), date(2026, 2, 28))

    def test_the_nightly_job_on_the_last_day_of_february(self):
        subs = {"jan31": date(2026, 1, 31), "jan30": date(2026, 1, 30), "jan28": date(2026, 1, 28), "jan15": date(2026, 1, 15)}
        self.assertEqual(due_today(subs, date(2026, 2, 28)), ["jan28", "jan30", "jan31"])

    def test_the_nightly_job_on_march_31st(self):
        subs = {"jan31": date(2026, 1, 31), "dec31": date(2025, 12, 31), "mar1": date(2026, 3, 1)}
        self.assertEqual(due_today(subs, date(2026, 3, 31)), ["dec31", "jan31"])


if __name__ == "__main__":
    unittest.main()
