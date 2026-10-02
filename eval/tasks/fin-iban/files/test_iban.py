import unittest

from iban import valid


class IbanTest(unittest.TestCase):
    def test_accepts_real_ibans(self):
        self.assertTrue(valid("BE68539007547034"))
        self.assertTrue(valid("FR1420041010050500013M02606"))
        self.assertTrue(valid("DE89370400440532013000"))
        self.assertTrue(valid("NL91ABNA0417164300"))

    def test_accepts_the_printed_form_with_spaces(self):
        self.assertTrue(valid("BE68 5390 0754 7034"))

    def test_refuses_a_single_wrong_digit(self):
        # Same length, same country, one digit out: this is the typo the length check lets through.
        self.assertFalse(valid("BE68539007547035"))
        self.assertFalse(valid("DE89370400440532013001"))

    def test_refuses_transposed_digits(self):
        self.assertFalse(valid("BE68539007540734"))

    def test_refuses_an_unknown_country_or_a_wrong_length(self):
        self.assertFalse(valid("XX68539007547034"))
        self.assertFalse(valid("BE6853900754703"))


if __name__ == "__main__":
    unittest.main()
