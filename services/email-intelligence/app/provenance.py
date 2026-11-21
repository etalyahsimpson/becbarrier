"""Provenance rules: what each evidence grade may and may not assert.

A raw upload never carries trusted delivery telemetry. Header presence is a
CLAIM, not proof. No code path in this service can promote a message to
TRUSTED_GATEWAY — that grade requires an authenticated ingestion integration
that does not exist in the initial release.
"""

from __future__ import annotations

from .schemas import ProvenanceGrade

# The only provenance grades a caller may request in this release.
CALLER_ALLOWED = {ProvenanceGrade.RAW_UPLOAD, ProvenanceGrade.SYNTHETIC_FIXTURE}

TRUSTED_GRADES = {ProvenanceGrade.TRUSTED_GATEWAY}


def trusted_transport_evidence(provenance: ProvenanceGrade) -> bool:
    """True only for authenticated gateway telemetry (never raw uploads)."""
    return provenance in TRUSTED_GRADES


def auth_result_trust(provenance: ProvenanceGrade) -> str:
    """How an Authentication-Results header may be interpreted."""
    if provenance in TRUSTED_GRADES:
        return "TRUSTED"
    return "UNTRUSTED_CLAIM"
