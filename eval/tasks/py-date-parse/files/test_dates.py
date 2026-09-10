import unittest
from datetime import date

from dates import parse_date


class ParseDate(unittest.TestCase):
    def test_ordinary(self):
        self.assertEqual(parse_date("31/12/2026"), date(2026, 12, 31))

    def test_single_digits(self):
        self.assertEqual(parse_date("1/2/2026"), date(2026, 2, 1))

    def test_day_and_month_are_not_swapped(self):
        self.assertEqual(parse_date("05/11/2026"), date(2026, 11, 5))


if __name__ == "__main__":
    unittest.main()
