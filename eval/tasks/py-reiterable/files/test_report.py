import unittest

from report import render

LEDGER = """
4010,250
4010,125
6150,900
"""


class RenderTest(unittest.TestCase):
    def test_the_lines_are_rendered(self):
        self.assertEqual(render(LEDGER)["lines"], ["4010 250", "4010 125", "6150 900"])

    def test_the_summary_sees_the_same_records_as_the_lines(self):
        out = render(LEDGER)
        self.assertEqual(out["count"], 3)
        self.assertEqual(out["total"], 1275)


if __name__ == "__main__":
    unittest.main()
