"""Small helpers shared by the services."""

import copy


def deep_merge(base, override):
    """Return a new dict: `base` with `override` laid on top.

    Nested dicts are merged at every depth; any other value in `override` (lists included)
    replaces the one in `base`. Neither argument is modified.

    The result shares nothing with either argument. It used to share the nested dicts of `base`
    and update them in place, so the first tenant's SMTP host was written into DEFAULTS and every
    later tenant inherited it; and `update` only merged one level, so overriding smtp.tls.verify
    dropped the rest of smtp.tls.
    """
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def chunks(items, size):
    """Split a list into lists of at most `size` items."""
    return [items[i : i + size] for i in range(0, len(items), size)]
