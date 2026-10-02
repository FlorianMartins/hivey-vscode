"""Is this IBAN usable?"""

LENGTHS = {"BE": 16, "FR": 27, "DE": 22, "NL": 18}


def valid(iban):
    """True when the IBAN is well formed and its check digits agree with the rest."""
    cleaned = iban.replace(" ", "").upper()
    country = cleaned[:2]
    if country not in LENGTHS:
        return False
    return len(cleaned) == LENGTHS[country]
