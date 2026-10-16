import copy
import unittest

import settings
from settings import settings_for
from util import deep_merge

PRISTINE = copy.deepcopy(settings.DEFAULTS)


class TenantIsolationTest(unittest.TestCase):
    def setUp(self):
        # Every test starts from the real defaults, even if an earlier one corrupted them.
        settings.DEFAULTS.clear()
        settings.DEFAULTS.update(copy.deepcopy(PRISTINE))

    def test_one_tenant_does_not_leak_into_the_next(self):
        acme = settings_for({"smtp": {"host": "mail.acme.test", "port": 587}})
        globex = settings_for({"features": {"beta": True}})
        self.assertEqual(acme["smtp"]["host"], "mail.acme.test")
        self.assertEqual(globex["smtp"]["host"], "localhost")
        self.assertEqual(globex["smtp"]["port"], 25)
        self.assertEqual(settings.DEFAULTS, PRISTINE)

    def test_a_deep_override_keeps_its_siblings(self):
        s = settings_for({"smtp": {"tls": {"verify": False}}})
        self.assertEqual(s["smtp"]["tls"], {"enabled": False, "verify": False, "min_version": "1.2"})
        self.assertEqual(s["smtp"]["host"], "localhost")
        self.assertEqual(settings_for({})["smtp"]["tls"]["verify"], True)

    def test_changing_a_tenants_settings_does_not_reach_the_defaults(self):
        s = settings_for({})
        s["smtp"]["tls"]["enabled"] = True
        s["admins"].append("intruder@example.com")
        s["features"]["beta"] = True
        self.assertEqual(settings.DEFAULTS, PRISTINE)
        fresh = settings_for({})
        self.assertEqual(fresh["admins"], ["ops@example.com"])
        self.assertFalse(fresh["smtp"]["tls"]["enabled"])

    def test_changing_a_tenants_settings_does_not_reach_its_overrides(self):
        overrides = {"smtp": {"tls": {"verify": False}}, "admins": ["root@acme.test"]}
        before = copy.deepcopy(overrides)
        s = settings_for(overrides)
        s["smtp"]["tls"]["verify"] = True
        s["admins"].append("x@acme.test")
        self.assertEqual(overrides, before)

    def test_a_list_is_replaced_not_concatenated(self):
        self.assertEqual(settings_for({"admins": ["a@acme.test"]})["admins"], ["a@acme.test"])

    def test_a_dict_can_replace_a_scalar_and_the_reverse(self):
        self.assertEqual(settings_for({"retries": {"max": 5}})["retries"], {"max": 5})
        self.assertEqual(settings_for({"features": None})["features"], None)


class DeepMergeTest(unittest.TestCase):
    def test_neither_argument_is_modified(self):
        base = {"a": {"b": {"c": 1, "d": [1]}}, "e": 1}
        override = {"a": {"b": {"c": 2}, "x": {"y": 1}}}
        base_before = copy.deepcopy(base)
        override_before = copy.deepcopy(override)
        merged = deep_merge(base, override)
        self.assertEqual(merged, {"a": {"b": {"c": 2, "d": [1]}, "x": {"y": 1}}, "e": 1})
        self.assertEqual(base, base_before)
        self.assertEqual(override, override_before)
        merged["a"]["x"]["y"] = 99
        merged["a"]["b"]["d"].append(2)
        self.assertEqual(base, base_before)
        self.assertEqual(override, override_before)

    def test_four_levels_deep(self):
        merged = deep_merge({"a": {"b": {"c": {"d": 1, "e": 2}}}}, {"a": {"b": {"c": {"e": 3}}}})
        self.assertEqual(merged, {"a": {"b": {"c": {"d": 1, "e": 3}}}})


if __name__ == "__main__":
    unittest.main()
