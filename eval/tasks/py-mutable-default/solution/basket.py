"""A shopping basket."""


def add(item, basket=None):
    """Add an item and return the basket."""
    # A default argument is evaluated once, at definition, so a mutable one is shared by every call
    # that does not pass its own.
    if basket is None:
        basket = []
    basket.append(item)
    return basket


def labels(items, seen=None):
    """Number each distinct item, in the order first seen."""
    if seen is None:
        seen = {}
    for item in items:
        if item not in seen:
            seen[item] = len(seen) + 1
    return seen
