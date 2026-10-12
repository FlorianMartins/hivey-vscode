"""Is this IBAN usable?"""

LENGTHS = {"BE": 16, "FR": 27, "DE": 22, "NL": 18}


def valid(iban):
    """True when the IBAN is well formed and its check digits agree with the rest."""
    cleaned = iban.replace(" ", "").upper()
    country = cleaned[:2]
    if country not in LENGTHS or len(cleaned) != LENGTHS[country]:
        return False
    if not cleaned[:2].isalpha() or not cleaned[2:4].isdigit() or not cleaned[4:].isalnum():
        return False
    # ISO 13616: the country code and check digits move to the end, letters become their position
    # in the alphabet plus nine, and the whole number modulo 97 must be 1. This is what catches a
    # single wrong digit and a transposition — the two mistakes a length check cannot see.
    rearranged = cleaned[4:] + cleaned[:4]
    digits = "".join(str(int(c, 36)) for c in rearranged)
    return int(digits) % 97 == 1
