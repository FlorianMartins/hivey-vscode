import unittest

from basket import add, labels


class BasketTest(unittest.TestCase):
    def test_two_baskets_are_independent(self):
        first = add("apple")
        second = add("pear")
        self.assertEqual(first, ["apple"])
        self.assertEqual(second, ["pear"])

    def test_an_explicit_basket_is_still_used(self):
        mine = ["bread"]
        self.assertEqual(add("milk", mine), ["bread", "milk"])

    def test_labels_start_again_each_call(self):
        self.assertEqual(labels(["a", "b"]), {"a": 1, "b": 2})
        self.assertEqual(labels(["c"]), {"c": 1})


if __name__ == "__main__":
    unittest.main()
