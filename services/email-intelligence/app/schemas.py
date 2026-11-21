"""Pydantic contracts for the internal analyze-email boundary.

These models mirror @becbarrier/contracts on the TypeScript side. The service
never receives or returns authority claims: provenance is constrained to
RAW_UPLOAD / SYNTHETIC_FIXTURE because no trusted gateway integration exists
in the initial release, and callers cannot promote raw uploads to a trusted
grade by passing a flag.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class ProvenanceGrade(str, Enum):
    TRUSTED_GATEWAY = "TRUSTED_GATEWAY"
    RAW_UPLOAD = "RAW_UPLOAD"
    SYNTHETIC_FIXTURE = "SYNTHETIC_FIXTURE"
    UNDETERMINED = "UNDETERMINED"


class RuleOutcome(str, Enum):
    MATCH = "MATCH"
    NO_MATCH = "NO_MATCH"
    UNKNOWN = "UNKNOWN"


class Severity(str, Enum):
    INFO = "INFO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class ParseStatus(str, Enum):
    OK = "OK"
    MALFORMED = "MALFORMED"
    REJECTED_OVERSIZE = "REJECTED_OVERSIZE"
    UNKNOWN = "UNKNOWN"


RULESET_VERSION = "bec-rules-v1"
UPLOAD_MAX_BYTES = 2 * 1024 * 1024


class AnalyzeEmailRequest(BaseModel):
    content_base64: str = Field(min_length=1, max_length=3_000_000)
    provenance: ProvenanceGrade
    approved_domains: list[str] = Field(default_factory=list, max_length=200)
    approved_aliases: list[str] = Field(default_factory=list, max_length=200)

    @field_validator("provenance")
    @classmethod
    def constrain_caller_provenance(cls, value: ProvenanceGrade) -> ProvenanceGrade:
        # Callers may only declare RAW_UPLOAD or SYNTHETIC_FIXTURE. A caller
        # cannot promote messages to TRUSTED_GATEWAY (no authenticated
        # ingestion integration exists) and UNDETERMINED is a derived output
        # grade, not a caller claim.
        allowed = {ProvenanceGrade.RAW_UPLOAD, ProvenanceGrade.SYNTHETIC_FIXTURE}
        if value not in allowed:
            raise ValueError(
                "provenance must be RAW_UPLOAD or SYNTHETIC_FIXTURE; callers cannot "
                "promote uploads to TRUSTED_GATEWAY in this release."
            )
        return value


class RuleFinding(BaseModel):
    ruleId: str
    version: str
    outcome: RuleOutcome
    severity: Severity
    provenance: ProvenanceGrade
    explanation: str
    evidenceField: str | None = None
    maskedExcerpt: str | None = None


class AuthStatus(BaseModel):
    """Authentication truth handling for raw uploads (never a verified PASS)."""

    spf: str = "UNKNOWN"
    dkim: str = "NOT_PRESENT"
    dmarc: str = "NOT_EVALUATED"
    authenticationResultsPresent: bool = False
    claimedResults: str | None = None
    claimTrust: str = "UNTRUSTED_CLAIM"


class NormalizedEmail(BaseModel):
    digest: str
    parsedHeaders: dict[str, Any] = Field(default_factory=dict)
    fromAddress: dict[str, Any] | None = None
    replyTo: dict[str, Any] | None = None
    sender: dict[str, Any] | None = None
    to: list[dict[str, Any]] = Field(default_factory=list)
    subject: str | None = None
    messageId: str | None = None
    date: str | None = None
    receivedCount: int = 0
    mimePartCount: int = 0
    attachmentNames: list[str] = Field(default_factory=list)
    bodyTextExcerpt: str | None = None
    htmlPresent: bool = False
    remoteImageReferences: int = 0
    authStatus: AuthStatus = Field(default_factory=AuthStatus)
    claimedSupplierDomains: list[str] = Field(default_factory=list)


class AnalyzeEmailResponse(BaseModel):
    digest: str
    parseStatus: ParseStatus
    provenance: ProvenanceGrade
    ruleVersion: str
    normalized: NormalizedEmail | None = None
    findings: list[RuleFinding]
    score: int
    priority: str | None
    unknownCount: int


class HealthResponse(BaseModel):
    status: str
    service: str
    rulesetVersion: str
