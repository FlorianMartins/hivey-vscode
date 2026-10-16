"""Per-tenant settings: the platform defaults with each tenant's overrides on top."""

from util import deep_merge

DEFAULTS = {
    "smtp": {
        "host": "localhost",
        "port": 25,
        "tls": {"enabled": False, "verify": True, "min_version": "1.2"},
    },
    "features": {"beta": False, "exports": True},
    "retries": 3,
    "admins": ["ops@example.com"],
}


def settings_for(overrides):
    """The effective settings of a tenant."""
    return deep_merge(DEFAULTS, overrides)
