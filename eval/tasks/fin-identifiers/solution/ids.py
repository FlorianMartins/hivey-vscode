"""Identifiers a trade carries."""

import re

ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
LEI = re.compile(r"^[A-Z0-9]{18}[0-9]{2}$")
# Four letters for the institution, two for the country, two alphanumerics for the location, and an
# optional three-character branch. `XXX` is the head office and is spelled out rather than omitted.
BIC = re.compile(r"^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$")


def _luhn(digits):
    """Luhn from the right: every second digit doubled, a double above nine reduced by nine."""
    total = 0
    for i, char in enumerate(reversed(digits)):
        digit = int(char)
        if i % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def valid_isin(value):
    """An ISIN is 12 characters: 2 letters, 9 alphanumerics, 1 check digit."""
    if not isinstance(value, str) or not ISIN.match(value):
        return False
    # Each letter becomes its position in the alphabet plus nine, THEN the whole thing is one long
    # number. Converting after concatenating gives a different number and a check that always fails.
    digits = "".join(str(int(c, 36)) if c.isalpha() else c for c in value)
    return _luhn(digits)


def valid_lei(value):
    """A LEI is 20 alphanumerics, the last two being check digits (ISO 17442)."""
    if not isinstance(value, str) or not LEI.match(value):
        return False
    # ISO 7064 MOD 97-10, as ISO 17442 specifies: the whole string, letters as position plus nine,
    # modulo 97 must be 1.
    digits = "".join(str(int(c, 36)) if c.isalpha() else c for c in value)
    return int(digits) % 97 == 1


def valid_bic(value):
    """A BIC is 8 or 11 characters, and its shape is part of what makes it one."""
    return isinstance(value, str) and bool(BIC.match(value))
