"""Small helpers shared by the services."""


def deep_merge(base, override):
    """Return a new dict: `base` with `override` laid on top.

    Nested dicts are merged at every depth; any other value in `override` (lists included)
    replaces the one in `base`. Neither argument is modified.
    """
    result = base.copy()
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key].update(value)
        else:
            result[key] = value
    return result


def chunks(items, size):
    """Split a list into lists of at most `size` items."""
    return [items[i : i + size] for i in range(0, len(items), size)]
