import unittest
from decimal import Decimal

from money import total


class TotalTest(unittest.TestCase):
    def test_returns_a_decimal(self):
        self.assertIsInstance(total([Decimal("1.00")], Decimal("0")), Decimal)

    def test_rounds_half_away_from_zero(self):
        # The case that separates exact arithmetic from binary floating point: 2.675 cannot be
        # represented, so the nearest double is just under it and rounds DOWN.
        self.assertEqual(total([Decimal("2.675")], Decimal("0")), Decimal("2.68"))

    def test_adds_tax(self):
        self.assertEqual(total([Decimal("10.00"), Decimal("5.00")], Decimal("0.21")), Decimal("18.15"))

    def test_tenths_do_not_drift(self):
        self.assertEqual(total([Decimal("0.10")] * 3, Decimal("0")), Decimal("0.30"))


if __name__ == "__main__":
    unittest.main()
