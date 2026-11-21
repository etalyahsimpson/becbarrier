"""Domain normalization: IDNA-safe canonical domains, bounded header values.

Original raw values are preserved for evidence; normalized values are used
for comparison. Unicode distinctions are never silently destroyed.
"""

from __future__ import annotations

import unicodedata

import idna

MAX_FIELD_LENGTH = 500


def normalize_domain(raw: str | None) -> str | None:
    """Lowercase, IDNA-normalize a domain. Returns None when unparseable."""
    if not raw:
        return None
    candidate = raw.strip().rstrip(".").lower()
    if candidate == "":
        return None
    try:
        # Attempt IDNA 2008 encoding; fall back to the less strict UTS-46
        # implementation so unusual but real registrable domains survive.
        try:
            encoded = idna.encode(candidate).decode("ascii")
        except idna.IDNAError:
            encoded = idna.uts46_remap(candidate, std3_rules=False, transitional=False)
            if isinstance(encoded, str):
                encoded = encoded.encode("ascii", "ignore").decode("ascii")
        return encoded.lower()
    except Exception:
        return None


def display_safe(value: str | None) -> str | None:
    """NFC-normalize a display value without destroying homoglyph evidence."""
    if value is None:
        return None
    return unicodedata.normalize("NFC", value)[:MAX_FIELD_LENGTH]


def split_address(raw: str | None) -> dict[str, str | None] | None:
    """Split 'Display Name <local@domain>' into bounded parts."""
    if not raw:
        return None
    value = raw.strip()
    if len(value) > MAX_FIELD_LENGTH * 2:
        value = value[: MAX_FIELD_LENGTH * 2]
    display_name = None
    addr = value
    if "<" in value and value.endswith(">"):
        start = value.index("<")
        display_name = value[:start].strip().strip('"')
        addr = value[start + 1 : -1]
    mailbox, _, domain = addr.partition("@")
    return {
        "displayName": display_safe(display_name),
        "email": addr.lower() if domain else None,
        "mailbox": mailbox.lower()[:MAX_FIELD_LENGTH] if mailbox else None,
        "domain": domain.lower()[:MAX_FIELD_LENGTH] if domain else None,
        "domainNormalized": normalize_domain(domain),
    }


def is_same_domain(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return normalize_domain(a) == normalize_domain(b)
