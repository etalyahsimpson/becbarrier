"""Deterministic BEC-01..BEC-07 rule evaluation (bec-rules-v1).

Every rule emits an independent structured finding with a stable ID, an
explicit outcome (MATCH / NO_MATCH / UNKNOWN), severity, provenance, a short
explanation and a bounded, redacted evidence excerpt. Rules are conservative:
short strings and approved aliases must not raise lookalike findings, and
urgency language alone is never proof of fraud.

BEC-08 (mandatory hold on a materially changed bank fingerprint) is a
WORKFLOW rule that lives in the Express financial guard, not here.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import TYPE_CHECKING

from .normalization import normalize_domain
from .schemas import (
    NormalizedEmail,
    ParseStatus,
    ProvenanceGrade,
    RuleFinding,
    RuleOutcome,
    Severity,
)

if TYPE_CHECKING:
    from .evaluation import EvaluationContext

RULE_VERSION = "bec-rules-v1"

# --- Controlled phrase sets (versioned product configuration) ---------------

BANK_CHANGE_PHRASES = [
    "bank account",
    "account number",
    "account details",
    "bank details",
    "beneficiary",
    "beneficial owner",
    "sort code",
    "iban",
    "swift code",
    "remittance",
    "remittance advice",
    "payment details",
    "payment instructions",
    "change of account",
    "update our bank",
    "new account",
    "banking details",
    "wire transfer",
    "transfer funds",
    "payment account",
]

PAYMENT_CONTEXT_PHRASES = [
    "invoice",
    "payment",
    "remit",
    "supplier",
    "vendor",
    "account",
    "bank",
    "purchase order",
    "billing",
    "finance",
]

URGENCY_PHRASES = [
    "urgent",
    "urgently",
    "immediately",
    "asap",
    "today",
    "right away",
    "before close of business",
    "end of business",
    "end of day",
    "time sensitive",
    "time-sensitive",
    "deadline",
    "no later than",
    "within the hour",
    "last minute",
]

# Conservative similarity threshold for lookalike domains. Below this,
# differences are treated as distinct domains, not impersonation signals.
SIMILARITY_THRESHOLD = 0.72
MIN_DOMAIN_LENGTH = 6

_EXCERPT_RADIUS = 48


def _excerpt(body: str | None, needle: str) -> str | None:
    if not body:
        return None
    index = body.lower().find(needle.lower())
    if index < 0:
        return None
    start = max(0, index - _EXCERPT_RADIUS)
    end = min(len(body), index + len(needle) + _EXCERPT_RADIUS)
    return ("…" if start > 0 else "") + body[start:end] + ("…" if end < len(body) else "")


def _body_text(normalized: NormalizedEmail | None) -> str:
    if normalized is None:
        return ""
    return normalized.bodyTextExcerpt or ""


def _payment_context(body: str) -> bool:
    lowered = body.lower()
    return any(phrase in lowered for phrase in PAYMENT_CONTEXT_PHRASES)


# --- Rules -------------------------------------------------------------------


def bec01_reply_to_mismatch(ctx: EvaluationContext) -> RuleFinding:
    """BEC-01: Reply-To mailbox/domain differs from From."""
    normalized = ctx.normalized
    base = dict(
        ruleId="BEC-01",
        version=RULE_VERSION,
        provenance=ctx.provenance,
        severity=Severity.MEDIUM,
    )
    if normalized is None:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Email could not be parsed; Reply-To comparison unavailable.", **base)  # type: ignore[arg-type]
    reply_to = normalized.replyTo
    from_addr = normalized.fromAddress
    if reply_to is None or not reply_to.get("email"):
        return RuleFinding(
            outcome=RuleOutcome.NO_MATCH,
            explanation="No Reply-To header is present; replies route to the From address by default.",
            **base,  # type: ignore[arg-type]
        )
    if from_addr is None or not from_addr.get("email"):
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="From address could not be parsed.", **base)  # type: ignore[arg-type]
    if reply_to.get("email") == from_addr.get("email"):
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Reply-To matches the From address.", **base)  # type: ignore[arg-type]
    return RuleFinding(
        outcome=RuleOutcome.MATCH,
        explanation=(
            f"Replies route to a different address ({reply_to.get('email')}); legitimate "
            "workflows such as support desks may also do this — verify through the approved directory."
        ),
        evidenceField="Reply-To",
        maskedExcerpt=f"From: {from_addr.get('email')} → Reply-To: {reply_to.get('email')}",
        **base,  # type: ignore[arg-type]
    )


def bec02_lookalike_domain(ctx: EvaluationContext) -> RuleFinding:
    """BEC-02: conservative lookalike of an approved supplier domain."""
    base = dict(ruleId="BEC-02", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.HIGH)
    normalized = ctx.normalized
    if normalized is None or normalized.fromAddress is None:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="From domain unavailable for comparison.", **base)  # type: ignore[arg-type]
    from_domain = normalize_domain(str(normalized.fromAddress.get("domain") or ""))
    if not from_domain:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="From domain could not be normalized.", **base)  # type: ignore[arg-type]
    if from_domain in ctx.approved_domains:
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Sender domain is an approved supplier domain.", **base)  # type: ignore[arg-type]
    if from_domain in ctx.approved_aliases:
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Sender domain is an approved supplier alias.", **base)  # type: ignore[arg-type]
    best: tuple[float, str] | None = None
    for approved in ctx.approved_domains + ctx.approved_aliases:
        if len(approved) < MIN_DOMAIN_LENGTH or len(from_domain) < MIN_DOMAIN_LENGTH:
            continue
        ratio = SequenceMatcher(None, from_domain, approved).ratio()
        if best is None or ratio > best[0]:
            best = (ratio, approved)
    if best and best[0] >= SIMILARITY_THRESHOLD:
        return RuleFinding(
            outcome=RuleOutcome.MATCH,
            explanation=(
                f"Sender domain resembles the approved supplier domain '{best[1]}' "
                f"(similarity {best[0]:.2f}) but is not approved."
            ),
            evidenceField="From.domain",
            maskedExcerpt=f"from domain {from_domain} ≈ approved {best[1]}",
            **base,  # type: ignore[arg-type]
        )
    return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Sender domain does not resemble any approved supplier domain.", **base)  # type: ignore[arg-type]


def bec03_bank_change_language(ctx: EvaluationContext) -> RuleFinding:
    """BEC-03: bank account / beneficiary / payment-change phrases."""
    base = dict(ruleId="BEC-03", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.HIGH)
    if ctx.parse_status != ParseStatus.OK:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Body text unavailable.", **base)  # type: ignore[arg-type]
    body = _body_text(ctx.normalized)
    lowered = body.lower()
    for phrase in BANK_CHANGE_PHRASES:
        if phrase in lowered:
            excerpt = _excerpt(body, phrase)
            return RuleFinding(
                outcome=RuleOutcome.MATCH,
                explanation=(
                    f"Message appears to request a payment-detail change (matched phrase: '{phrase}'); "
                    "independent verification via the governed workflow is required."
                ),
                evidenceField="body",
                maskedExcerpt=excerpt,
                **base,  # type: ignore[arg-type]
            )
    return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="No controlled bank-change phrase found.", **base)  # type: ignore[arg-type]


def bec04_urgency_in_payment_context(ctx: EvaluationContext) -> RuleFinding:
    """BEC-04: urgency/time-pressure phrases, only in payment context."""
    base = dict(ruleId="BEC-04", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.LOW)
    if ctx.parse_status != ParseStatus.OK:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Body text unavailable.", **base)  # type: ignore[arg-type]
    body = _body_text(ctx.normalized)
    lowered = body.lower()
    if not _payment_context(lowered):
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="No payment context for urgency evaluation.", **base)  # type: ignore[arg-type]
    for phrase in URGENCY_PHRASES:
        if phrase in lowered:
            return RuleFinding(
                outcome=RuleOutcome.MATCH,
                explanation=(
                    f"Message uses time pressure ('{phrase}') in a payment context; "
                    "urgency alone is not proof of fraud."
                ),
                evidenceField="body",
                maskedExcerpt=_excerpt(body, phrase),
                **base,  # type: ignore[arg-type]
            )
    return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="No urgency phrase in payment context.", **base)  # type: ignore[arg-type]


def bec05_authentication_failure(ctx: EvaluationContext) -> RuleFinding:
    """BEC-05: trusted SPF/DKIM/DMARC failure only; UNKNOWN otherwise."""
    from .provenance import trusted_transport_evidence

    base = dict(ruleId="BEC-05", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.MEDIUM)
    if ctx.parse_status != ParseStatus.OK:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Headers unavailable.", **base)  # type: ignore[arg-type]
    if not trusted_transport_evidence(ctx.provenance):
        return RuleFinding(
            outcome=RuleOutcome.UNKNOWN,
            explanation=(
                "No trusted transport evidence exists for this provenance; SPF/DKIM/DMARC "
                "cannot be independently evaluated from a raw upload."
            ),
            **base,  # type: ignore[arg-type]
        )
    # A real gateway integration would evaluate verified results here; this
    # release has none, so the trusted branch is never reachable.
    return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Trusted gateway evaluation is not configured in this release.", **base)  # type: ignore[arg-type]


def bec06_claimed_identity_conflict(ctx: EvaluationContext) -> RuleFinding:
    """BEC-06: claimed supplier identity conflicts with the approved directory."""
    base = dict(ruleId="BEC-06", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.HIGH)
    normalized = ctx.normalized
    if normalized is None or normalized.fromAddress is None:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Sender identity unavailable.", **base)  # type: ignore[arg-type]
    from_domain = normalize_domain(str(normalized.fromAddress.get("domain") or ""))
    if not from_domain:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="From domain could not be normalized.", **base)  # type: ignore[arg-type]
    if from_domain in ctx.approved_domains or from_domain in ctx.approved_aliases:
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Sender domain is approved for this supplier directory.", **base)  # type: ignore[arg-type]
    display_name = str(normalized.fromAddress.get("displayName") or "")
    mailbox = str(normalized.fromAddress.get("mailbox") or "")
    claimed = f"{display_name} {mailbox}".lower()
    claimed_compact = re.sub(r"[^a-z0-9]", "", claimed)
    for approved in ctx.approved_domains:
        label = approved.split(".")[0]
        label_compact = re.sub(r"[^a-z0-9]", "", label)
        # Exact hyphenated label (>=4 chars) or compact form (>=6 chars) so
        # short strings and unrelated names do not raise conflicts.
        if (len(label_compact) >= 4 and label in claimed) or (
            len(label_compact) >= 6 and label_compact in claimed_compact
        ):
            return RuleFinding(
                outcome=RuleOutcome.MATCH,
                explanation=(
                    f"Claimed identity references supplier '{label}' while the sender domain "
                    f"'{from_domain}' is not the approved domain for that supplier."
                ),
                evidenceField="From.displayName",
                maskedExcerpt=f"{display_name[:60] or mailbox[:60]} <{normalized.fromAddress.get('email')}>",
                **base,  # type: ignore[arg-type]
            )
    return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="No approved-supplier identity claim detected.", **base)  # type: ignore[arg-type]


def bec07_untrusted_auth_claim(ctx: EvaluationContext) -> RuleFinding:
    """BEC-07: Authentication-Results present on a raw upload (informational)."""
    base = dict(ruleId="BEC-07", version=RULE_VERSION, provenance=ctx.provenance, severity=Severity.INFO)
    if ctx.parse_status != ParseStatus.OK or ctx.normalized is None:
        return RuleFinding(outcome=RuleOutcome.UNKNOWN, explanation="Headers unavailable.", **base)  # type: ignore[arg-type]
    if ctx.provenance != ProvenanceGrade.RAW_UPLOAD:
        return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="Authentication-Results claim evaluated only for raw uploads.", **base)  # type: ignore[arg-type]
    if ctx.normalized.authStatus.authenticationResultsPresent:
        return RuleFinding(
            outcome=RuleOutcome.MATCH,
            explanation=(
                "The upload contains an Authentication-Results header; on a raw upload this is "
                "an untrusted claim, not independently verified SPF/DKIM/DMARC."
            ),
            evidenceField="Authentication-Results",
            maskedExcerpt=(ctx.normalized.authStatus.claimedResults or "")[:160],
            **base,  # type: ignore[arg-type]
        )
    return RuleFinding(outcome=RuleOutcome.NO_MATCH, explanation="No Authentication-Results header present.", **base)  # type: ignore[arg-type]


ALL_RULES = [
    bec01_reply_to_mismatch,
    bec02_lookalike_domain,
    bec03_bank_change_language,
    bec04_urgency_in_payment_context,
    bec05_authentication_failure,
    bec06_claimed_identity_conflict,
    bec07_untrusted_auth_claim,
]
