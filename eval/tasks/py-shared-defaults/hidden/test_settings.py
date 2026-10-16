import unittest

from settings import settings_for


class SettingsTest(unittest.TestCase):
    def test_no_override_gives_the_defaults(self):
        s = settings_for({})
        self.assertEqual(s["smtp"]["host"], "localhost")
        self.assertEqual(s["retries"], 3)

    def test_a_top_level_value_is_replaced(self):
        self.assertEqual(settings_for({"retries": 5})["retries"], 5)

    def test_a_nested_value_is_replaced_and_its_siblings_kept(self):
        s = settings_for({"smtp": {"host": "mail.acme.test"}})
        self.assertEqual(s["smtp"]["host"], "mail.acme.test")
        self.assertEqual(s["smtp"]["port"], 25)


if __name__ == "__main__":
    unittest.main()
