import unittest

from api import handle_search
from catalog import add_product, connect, search_products

PRODUCTS = [
    ("O'Reilly Python Cookbook", 4500),
    ("Blue mug", 900),
    ("50% off voucher", 0),
    ("Discount 5000 pack", 1200),
    ("snake_case stickers", 300),
    ("snakeXcase poster", 1500),
    ("Path C:\\temp sticker", 200),
    ("Path C:Xtemp poster", 400),
    ("Tea pot", 2500),
]


class HardSearchTest(unittest.TestCase):
    def setUp(self):
        self.conn = connect()
        for name, price in PRODUCTS:
            add_product(self.conn, name, price)

    def names(self, term, **params):
        return [p["name"] for p in handle_search(self.conn, {"q": term, **params})["results"]]

    def test_a_quote_in_the_term(self):
        self.assertEqual(self.names("O'Reilly"), ["O'Reilly Python Cookbook"])
        self.assertEqual(self.names("o'reilly"), ["O'Reilly Python Cookbook"])

    def test_a_percent_sign_is_a_percent_sign(self):
        self.assertEqual(self.names("50%"), ["50% off voucher"])
        self.assertEqual(self.names("%"), ["50% off voucher"])

    def test_an_underscore_is_an_underscore(self):
        self.assertEqual(self.names("snake_case"), ["snake_case stickers"])
        self.assertEqual(self.names("_"), ["snake_case stickers"])

    def test_a_backslash_is_a_backslash(self):
        self.assertEqual(self.names("C:\\temp"), ["Path C:\\temp sticker"])

    def test_injection_finds_nothing_and_breaks_nothing(self):
        for term in ["' OR '1'='1", "x'; DROP TABLE products; --", "%' --"]:
            self.assertEqual(self.names(term), [], term)
        count = self.conn.execute("SELECT COUNT(*) FROM products").fetchone()[0]
        self.assertEqual(count, len(PRODUCTS))

    def test_an_empty_term_still_lists_everything_up_to_the_limit(self):
        self.assertEqual(len(self.names("", limit="100")), len(PRODUCTS))
        self.assertEqual(self.names("", limit="3"), ["50% off voucher", "Blue mug", "Discount 5000 pack"])

    def test_the_function_itself_is_safe_too(self):
        rows = search_products(self.conn, "O'Reilly")
        self.assertEqual([r["name"] for r in rows], ["O'Reilly Python Cookbook"])
        self.assertEqual(rows[0]["price_cents"], 4500)


if __name__ == "__main__":
    unittest.main()
