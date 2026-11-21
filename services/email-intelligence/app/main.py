"""Internal FastAPI boundary. Not exposed to browsers.

Accepts authenticated internal requests only (X-Internal-Service-Token),
over the restricted compose network. This service is stateless and
non-authoritative: no database writes, no payment approvals, no bank data.
"""

from __future__ import annotations

import base64
import binascii
import os

from fastapi import FastAPI, Header, HTTPException, status

from .evaluation import evaluate
from .rules import RULE_VERSION
from .schemas import (
    UPLOAD_MAX_BYTES,
    AnalyzeEmailRequest,
    AnalyzeEmailResponse,
    HealthResponse,
    ProvenanceGrade,
)

app = FastAPI(
    title="BECBarrier Email Intelligence",
    version="1.0.0",
    description=(
        "Internal, non-authoritative email analysis: bounded MIME parsing, "
        "provenance-aware normalization and deterministic BEC-01..07 rule evaluation."
    ),
    docs_url="/internal/docs",
    openapi_url="/internal/openapi.json",
)


def _require_internal_token(x_internal_service_token: str | None) -> None:
    expected = os.environ.get("INTERNAL_SERVICE_TOKEN", "")
    if not expected or x_internal_service_token != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Internal service authentication required.",
        )


@app.get("/internal/v1/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="becbarrier-email-intelligence", rulesetVersion=RULE_VERSION)


@app.post(
    "/internal/v1/analyze-email",
    response_model=AnalyzeEmailResponse,
    responses={
        413: {"description": "Payload exceeds the size limit"},
        422: {"description": "Malformed business input"},
    },
)
def analyze_email(
    request: AnalyzeEmailRequest,
    x_internal_service_token: str | None = Header(default=None),
) -> AnalyzeEmailResponse:
    _require_internal_token(x_internal_service_token)
    try:
        raw = base64.b64decode(request.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"content_base64 is not valid base64: {exc}",
        ) from exc
    if len(raw) == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty email payload.")
    if len(raw) > UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Email payload exceeds {UPLOAD_MAX_BYTES} bytes.",
        )
    return evaluate(
        raw,
        request.provenance,
        request.approved_domains,
        request.approved_aliases,
    )


__all__ = ["app", "ProvenanceGrade"]
