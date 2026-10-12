"""A shopping basket."""


def add(item, basket=[]):
    """Add an item and return the basket."""
    basket.append(item)
    return basket


def labels(items, seen={}):
    """Number each distinct item, in the order first seen."""
    for item in items:
        if item not in seen:
            seen[item] = len(seen) + 1
    return seen
