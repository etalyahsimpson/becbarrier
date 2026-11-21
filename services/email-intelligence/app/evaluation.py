"""Evaluation orchestration: parse → normalize → rules → deterministic score.

The score is a transparent prioritization heuristic (distinct rule severities,
capped at 100), never a calibrated fraud probability. A score of 0 means
"no rules fired", not "safe". UNKNOWN outcomes are counted and reported.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .mime_parser import ParseResult, parse_eml
from .normalization import normalize_domain
from .rules import ALL_RULES, RULE_VERSION
from .schemas import (
    AnalyzeEmailResponse,
    NormalizedEmail,
    ParseStatus,
    ProvenanceGrade,
    RuleFinding,
)

SEVERITY_WEIGHTS = {"INFO": 0, "LOW": 10, "MEDIUM": 25, "HIGH": 45, "CRITICAL": 70}
PRIORITY_BANDS = [(75, "CRITICAL"), (50, "HIGH"), (25, "MEDIUM"), (1, "LOW")]


@dataclass
class EvaluationContext:
    parse_status: ParseStatus
    normalized: NormalizedEmail | None
    provenance: ProvenanceGrade
    approved_domains: list[str] = field(default_factory=list)
    approved_aliases: list[str] = field(default_factory=list)


def compute_score(findings: list[RuleFinding]) -> int:
    total = 0
    for finding in findings:
        if finding.outcome == "MATCH":
            total += SEVERITY_WEIGHTS.get(finding.severity, 0)
    return min(100, total)


def score_to_priority(score: int) -> str | None:
    for threshold, label in PRIORITY_BANDS:
        if score >= threshold:
            return label
    return None


def evaluate(
    raw: bytes,
    provenance: ProvenanceGrade,
    approved_domains: list[str],
    approved_aliases: list[str],
) -> AnalyzeEmailResponse:
    result: ParseResult = parse_eml(raw, provenance.value)
    domains = sorted({d for d in (normalize_domain(x) for x in approved_domains) if d})
    aliases = sorted({d for d in (normalize_domain(x) for x in approved_aliases) if d})
    ctx = EvaluationContext(
        parse_status=result.status,
        normalized=result.normalized,
        provenance=provenance,
        approved_domains=domains,
        approved_aliases=aliases,
    )
    findings: list[RuleFinding] = []
    if result.status == ParseStatus.OK:
        findings = [rule(ctx) for rule in ALL_RULES]
    else:
        # Malformed/oversize input still yields structured, honest findings.
        findings = [
            RuleFinding(
                ruleId="PARSE",
                version=RULE_VERSION,
                outcome="UNKNOWN",
                severity="INFO",
                provenance=provenance,
                explanation=f"The sample could not be fully parsed ({result.status.value}"
                f"{': ' + result.error if result.error else ''}); findings are UNKNOWN, not PASS.",
            )
        ]
    score = compute_score(findings)
    return AnalyzeEmailResponse(
        digest=result.digest,
        parseStatus=result.status,
        provenance=provenance,
        ruleVersion=RULE_VERSION,
        normalized=result.normalized,
        findings=findings,
        score=score,
        priority=score_to_priority(score),
        unknownCount=sum(1 for f in findings if f.outcome == "UNKNOWN"),
    )
