import unittest

from pricing import quote

MUG = {"sku": "MUG", "unit_price": "9.50", "qty": 2, "category": "kitchen"}
BOOK = {"sku": "BOOK", "unit_price": "20.00", "qty": 1, "category": "books"}


class QuoteTest(unittest.TestCase):
    def test_a_regular_customer_in_belgium(self):
        self.assertEqual(
            quote([MUG, BOOK], {"tier": "regular", "country": "BE"}),
            {"subtotal": "39.00", "discount": "0.00", "shipping": "4.95", "vat": "9.23", "total": "53.18"},
        )

    def test_a_gold_customer_with_free_shipping(self):
        self.assertEqual(
            quote([MUG], {"tier": "gold", "country": "FR"}, "FREESHIP"),
            {"subtotal": "19.00", "discount": "1.90", "shipping": "0.00", "vat": "3.42", "total": "20.52"},
        )

    def test_an_unknown_code(self):
        with self.assertRaises(ValueError):
            quote([MUG], {"tier": "regular", "country": "BE"}, "BOGUS")


if __name__ == "__main__":
    unittest.main()
