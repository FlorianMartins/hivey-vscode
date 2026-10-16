import unittest

from api import handle_search
from catalog import add_product, connect


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.conn = connect()
        for name, price in [("Blue mug", 900), ("Red mug", 950), ("Tea pot", 2500)]:
            add_product(self.conn, name, price)

    def test_a_word_in_the_name(self):
        names = [p["name"] for p in handle_search(self.conn, {"q": "mug"})["results"]]
        self.assertEqual(names, ["Blue mug", "Red mug"])

    def test_case_does_not_matter(self):
        names = [p["name"] for p in handle_search(self.conn, {"q": "TEA"})["results"]]
        self.assertEqual(names, ["Tea pot"])

    def test_the_limit(self):
        self.assertEqual(len(handle_search(self.conn, {"q": "", "limit": "2"})["results"]), 2)


if __name__ == "__main__":
    unittest.main()
