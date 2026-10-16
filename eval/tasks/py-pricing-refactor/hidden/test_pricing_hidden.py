"""The refactored quote against the original, on thousands of carts it was never shown."""

import random
import unittest

import pricing
import pricing_reference

CATEGORIES = ["kitchen", "books", "garden", "toys"]
COUNTRIES = ["BE", "FR", "NL", "DE", "LU", "CH", "US"]
TIERS = ["regular", "silver", "gold"]
CODES = [None, None, None, "WELCOME10", "FREESHIP", "FLAT5", "FLAT0", "FLAT500", "FLAT", "FLATx", "flat5", "BOGUS", ""]


def outcome(fn, *args):
    try:
        return ("ok", fn(*args))
    except Exception as e:  # noqa: BLE001 — the exception IS the behaviour being compared
        return ("raised", type(e).__name__, str(e))


def random_cart(rng):
    cart = []
    for i in range(rng.choice([0, 1, 1, 2, 3, 5])):
        cents = rng.choice([1, 99, 100, 333, 950, 1999, 2500, 4999, 12345])
        qty = rng.choice([1, 1, 2, 3, 9, 10, 11, 25, 0, -1] if rng.random() < 0.05 else [1, 2, 3, 9, 10, 12])
        cart.append({"sku": f"S{i}", "unit_price": f"{cents // 100}.{cents % 100:02d}", "qty": qty, "category": rng.choice(CATEGORIES)})
    return cart


class SameBehaviourTest(unittest.TestCase):
    def test_random_carts(self):
        rng = random.Random(20261016)
        mismatches = []
        for _ in range(4000):
            cart = random_cart(rng)
            customer = {"tier": rng.choice(TIERS), "country": rng.choice(COUNTRIES)}
            code = rng.choice(CODES)
            expected = outcome(pricing_reference.quote, cart, customer, code)
            actual = outcome(pricing.quote, cart, customer, code)
            if expected != actual:
                mismatches.append((cart, customer, code, expected, actual))
        self.assertEqual(mismatches[:3], [])

    def test_the_edges_of_every_threshold(self):
        mismatches = []
        for price in ["49.99", "50.00", "50.01", "55.55", "74.99", "75.00", "83.33", "199.99", "200.00", "200.01", "222.22"]:
            for qty in [1, 9, 10]:
                for category in ["kitchen", "books"]:
                    for tier in TIERS:
                        for country in COUNTRIES:
                            for code in CODES:
                                cart = [{"sku": "X", "unit_price": price, "qty": qty, "category": category}]
                                customer = {"tier": tier, "country": country}
                                expected = outcome(pricing_reference.quote, cart, customer, code)
                                actual = outcome(pricing.quote, cart, customer, code)
                                if expected != actual:
                                    mismatches.append((cart, customer, code, expected, actual))
        self.assertEqual(mismatches[:3], [])

    def test_the_default_code_is_none(self):
        cart = [{"sku": "X", "unit_price": "10.00", "qty": 1, "category": "toys"}]
        customer = {"tier": "regular", "country": "BE"}
        self.assertEqual(pricing.quote(cart, customer), pricing_reference.quote(cart, customer))


if __name__ == "__main__":
    unittest.main()
