"""Identifiers a trade carries."""


def valid_isin(value):
    """An ISIN is 12 characters: 2 letters, 9 alphanumerics, 1 check digit."""
    return len(value) == 12


def valid_lei(value):
    """A LEI is 20 alphanumerics, the last two being check digits (ISO 17442)."""
    return len(value) == 20


def valid_bic(value):
    """A BIC is 8 or 11 characters."""
    return len(value) in (8, 11)
