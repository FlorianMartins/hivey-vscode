import unittest

from report import monthly_report
from repo import MemoryRepo

CUSTOMERS = [
    {"id": 1, "name": "Ada", "country": "BE"},
    {"id": 2, "name": "Bob", "country": "FR"},
]
PRODUCTS = [
    {"id": 10, "name": "Mug", "category": "kitchen"},
    {"id": 11, "name": "Lamp", "category": "home"},
]
ORDERS = [
    {"id": 101, "month": (2026, 5), "customer_id": 2, "lines": [{"product_id": 11, "quantity": 1, "unit_cents": 4500}]},
    {"id": 100, "month": (2026, 5), "customer_id": 1, "lines": [{"product_id": 10, "quantity": 2, "unit_cents": 950}]},
    {"id": 102, "month": (2026, 5), "customer_id": 9, "lines": [{"product_id": 99, "quantity": 1, "unit_cents": 100}]},
    {"id": 90, "month": (2026, 4), "customer_id": 1, "lines": [{"product_id": 10, "quantity": 1, "unit_cents": 950}]},
]


class ReportTest(unittest.TestCase):
    def test_the_report(self):
        repo = MemoryRepo(ORDERS, CUSTOMERS, PRODUCTS)
        self.assertEqual(
            monthly_report(repo, 2026, 5),
            [
                "#100 Ada (BE) 19.00",
                "#101 Bob (FR) 45.00",
                "#102 unknown customer #9 (??) 1.00",
                "-- by country",
                "?? 1.00",
                "BE 19.00",
                "FR 45.00",
                "-- by category",
                "home 45.00",
                "kitchen 19.00",
                "uncategorised 1.00",
            ],
        )


if __name__ == "__main__":
    unittest.main()
