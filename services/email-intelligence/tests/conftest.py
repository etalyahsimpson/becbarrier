"""Shared helpers for the email-intelligence test suite."""

from __future__ import annotations

import base64

from app.evaluation import evaluate
from app.schemas import ProvenanceGrade

APPROVED = ["vulcan-steel.example", "meridian-pack.example", "northlight.example"]
ALIASES = ["northlight-logistics.example"]


def run(raw: bytes, provenance: ProvenanceGrade = ProvenanceGrade.RAW_UPLOAD,
        approved: list[str] | None = None, aliases: list[str] | None = None):
    return evaluate(raw, provenance, approved if approved is not None else APPROVED,
                    aliases if aliases is not None else ALIASES)


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def outcomes(response) -> dict[str, str]:
    return {f.ruleId: f.outcome for f in response.findings}


NORMAL_EML = b"""From: Vulcan Steel <billing@vulcan-steel.example>
To: Finance <finance@atlas.example>
Subject: Invoice INV-2026-118 for November
Date: Fri, 20 Nov 2026 09:00:00 +0000
Message-ID: <normal-1@vulcan-steel.example>

Please find attached invoice INV-2026-118 for November deliveries.
Payment terms remain 30 days net. Nothing about our payment routing has changed.

Kind regards,
Vulcan Steel billing
"""
