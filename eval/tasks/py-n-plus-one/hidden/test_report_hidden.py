import math
import random
import unittest

import report_reference
from report import monthly_report
from repo import MAX_IDS_PER_QUERY, MemoryRepo


class CountingRepo(MemoryRepo):
    """Counts the queries, and refuses an oversized batch like the real database layer does."""

    def __init__(self, *args):
        super().__init__(*args)
        self.calls = {"orders_for_month": 0, "get_customer": 0, "get_customers": 0, "get_product": 0, "get_products": 0}
        self.batch_sizes = []

    def orders_for_month(self, year, month):
        self.calls["orders_for_month"] += 1
        return super().orders_for_month(year, month)

    def get_customer(self, customer_id):
        self.calls["get_customer"] += 1
        return super().get_customer(customer_id)

    def get_customers(self, customer_ids):
        self.calls["get_customers"] += 1
        ids = list(customer_ids)
        self.batch_sizes.append(len(ids))
        return super().get_customers(ids)

    def get_product(self, product_id):
        self.calls["get_product"] += 1
        return super().get_product(product_id)

    def get_products(self, product_ids):
        self.calls["get_products"] += 1
        ids = list(product_ids)
        self.batch_sizes.append(len(ids))
        return super().get_products(ids)


def dataset(seed, n_orders, n_customers, n_products):
    rng = random.Random(seed)
    customers = [{"id": i, "name": f"Customer {i}", "country": rng.choice(["BE", "FR", "NL", "DE", "LU"])} for i in range(1, n_customers + 1)]
    products = [{"id": 1000 + i, "name": f"P{i}", "category": rng.choice(["home", "kitchen", "garden", "toys"])} for i in range(n_products)]
    orders = []
    for oid in rng.sample(range(1, 10 * n_orders), n_orders):
        # A few customers and products that no longer exist, as in production.
        customer_id = rng.randint(1, n_customers + 5)
        lines = [
            {"product_id": rng.randint(1000, 1000 + n_products + 3), "quantity": rng.randint(1, 4), "unit_cents": rng.randint(50, 9999)}
            for _ in range(rng.randint(1, 4))
        ]
        orders.append({"id": oid, "month": (2026, 5), "customer_id": customer_id, "lines": lines})
    orders.append({"id": 5, "month": (2026, 4), "customer_id": 1, "lines": [{"product_id": 1000, "quantity": 1, "unit_cents": 1}]})
    return orders, customers, products


class QueryCountTest(unittest.TestCase):
    def check(self, seed, n_orders, n_customers, n_products):
        data = dataset(seed, n_orders, n_customers, n_products)
        expected = report_reference.monthly_report(MemoryRepo(*data), 2026, 5)
        repo = CountingRepo(*data)
        self.assertEqual(monthly_report(repo, 2026, 5), expected, "the output changed")

        month_orders = [o for o in data[0] if o["month"] == (2026, 5)]
        distinct_customers = len({o["customer_id"] for o in month_orders})
        distinct_products = len({l["product_id"] for o in month_orders for l in o["lines"]})
        self.assertEqual(repo.calls["get_customer"], 0, "still one query per order")
        self.assertEqual(repo.calls["get_product"], 0, "still one query per line")
        self.assertEqual(repo.calls["orders_for_month"], 1)
        self.assertLessEqual(repo.calls["get_customers"], math.ceil(distinct_customers / MAX_IDS_PER_QUERY))
        self.assertLessEqual(repo.calls["get_products"], math.ceil(distinct_products / MAX_IDS_PER_QUERY))
        self.assertTrue(all(size <= MAX_IDS_PER_QUERY for size in repo.batch_sizes))

    def test_a_large_month(self):
        self.check(seed=7, n_orders=450, n_customers=230, n_products=150)

    def test_a_small_month(self):
        self.check(seed=3, n_orders=12, n_customers=8, n_products=5)

    def test_exactly_one_batch(self):
        self.check(seed=11, n_orders=400, n_customers=95, n_products=100)

    def test_an_empty_month(self):
        repo = CountingRepo([], [], [])
        self.assertEqual(monthly_report(repo, 2026, 5), ["-- by country", "-- by category"])
        self.assertEqual(repo.calls["get_customer"] + repo.calls["get_product"], 0)


if __name__ == "__main__":
    unittest.main()
