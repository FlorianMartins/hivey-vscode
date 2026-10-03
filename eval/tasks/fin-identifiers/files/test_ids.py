import unittest

from ids import valid_bic, valid_isin, valid_lei


class IdentifierTest(unittest.TestCase):
    def test_real_isins(self):
        self.assertTrue(valid_isin("US0378331005"))   # Apple
        self.assertTrue(valid_isin("FR0000120271"))   # Total
        self.assertTrue(valid_isin("GB0002634946"))   # BAE

    def test_isin_with_one_wrong_digit(self):
        # Same length, same country: this is the typo a length check lets through.
        self.assertFalse(valid_isin("US0378331006"))
        self.assertFalse(valid_isin("FR0000120272"))

    def test_isin_shape(self):
        self.assertFalse(valid_isin("0S0378331005"))  # country code must be letters
        self.assertFalse(valid_isin("US037833100"))
        self.assertFalse(valid_isin("US03783310055"))

    def test_real_leis(self):
        self.assertTrue(valid_lei("529900T8BM49AURSDO55"))
        self.assertTrue(valid_lei("7LTWFZYICNSX8D621K86"))

    def test_lei_with_one_wrong_character(self):
        self.assertFalse(valid_lei("529900T8BM49AURSDO56"))
        self.assertFalse(valid_lei("7LTWFZYICNSX8D621K87"))

    def test_bic(self):
        self.assertTrue(valid_bic("DEUTDEFF"))
        self.assertTrue(valid_bic("DEUTDEFF500"))
        self.assertTrue(valid_bic("BNPAFRPPXXX"))
        # Eight characters of the wrong shape is not a BIC.
        self.assertFalse(valid_bic("DEUT1EFF"))
        self.assertFalse(valid_bic("deutdeff"))
        self.assertFalse(valid_bic("DEUTDEF"))


if __name__ == "__main__":
    unittest.main()
