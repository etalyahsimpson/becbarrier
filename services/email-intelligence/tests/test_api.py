"""FastAPI boundary tests: internal auth, contract shape, provenance rules
(T02: raw uploads never gain verified authentication)."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("INTERNAL_SERVICE_TOKEN", "test-internal-token")

from conftest import NORMAL_EML, b64

from app.main import app  # noqa: E402

client = TestClient(app)
TOKEN = {"X-Internal-Service-Token": os.environ.get("INTERNAL_SERVICE_TOKEN", "test-internal-token")}


class TestInternalAuth:
    def test_analyze_requires_internal_token(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "RAW_UPLOAD",
        })
        assert response.status_code == 401

    def test_wrong_token_rejected(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "RAW_UPLOAD",
        }, headers={"X-Internal-Service-Token": "wrong"})
        assert response.status_code == 401

    def test_health_open(self):
        assert client.get("/internal/v1/health").status_code == 200


class TestContract:
    def test_analyze_success_shape(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "RAW_UPLOAD",
            "approved_domains": ["vulcan-steel.example"],
        }, headers=TOKEN)
        assert response.status_code == 200
        body = response.json()
        assert body["parseStatus"] == "OK"
        assert body["provenance"] == "RAW_UPLOAD"
        assert body["ruleVersion"] == "bec-rules-v1"
        assert len(body["digest"]) == 64
        assert isinstance(body["findings"], list)
        for finding in body["findings"]:
            assert finding["outcome"] in ("MATCH", "NO_MATCH", "UNKNOWN")
            assert finding["severity"] in ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")

    def test_invalid_base64_is_422(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": "!!!not-base64!!!",
            "provenance": "RAW_UPLOAD",
        }, headers=TOKEN)
        assert response.status_code == 422

    def test_empty_payload_is_422(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(b""),
            "provenance": "RAW_UPLOAD",
        }, headers=TOKEN)
        assert response.status_code == 422

    def test_oversize_payload_is_413(self):
        big = b"From: a@b.example\nSubject: x\n\n" + b"A" * (2 * 1024 * 1024 + 1)
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(big),
            "provenance": "RAW_UPLOAD",
        }, headers=TOKEN)
        assert response.status_code == 413

    def test_malformed_mime_returns_structured_not_crash(self):
        garbage = b"\x00\xff\xfe not an email at all \x00\x01\x02"
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(garbage),
            "provenance": "RAW_UPLOAD",
        }, headers=TOKEN)
        assert response.status_code == 200
        body = response.json()
        assert body["parseStatus"] in ("MALFORMED", "OK")
        # Findings exist and are honest about uncertainty.
        assert body["unknownCount"] >= 1


class TestProvenanceBoundaries:
    def test_trusted_gateway_cannot_be_claimed_by_caller(self):
        """T02 core: no caller flag can promote a raw upload to trusted auth."""
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "TRUSTED_GATEWAY",
        }, headers=TOKEN)
        assert response.status_code == 422

    def test_claimed_spf_pass_stays_untrusted(self):
        raw = (
            b"From: Vulcan Steel <billing@vulcan-steel.example>\n"
            b"DKIM-Signature: v=1; a=rsa-sha256; d=vulcan-steel.example; s=sel; b=claim\n"
            b"Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass\n"
            b"Subject: bank update\n\nPlease update our bank details urgently."
        )
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(raw),
            "provenance": "RAW_UPLOAD",
        }, headers=TOKEN)
        assert response.status_code == 200
        body = response.json()
        auth = body["normalized"]["authStatus"]
        assert auth["spf"] == "UNKNOWN"
        assert auth["dkim"] == "PRESENT_UNVERIFIED"
        assert auth["dmarc"] == "NOT_EVALUATED"
        assert auth["claimTrust"] == "UNTRUSTED_CLAIM"
        outcomes = {f["ruleId"]: f["outcome"] for f in body["findings"]}
        assert outcomes["BEC-05"] == "UNKNOWN"
        assert outcomes["BEC-07"] == "MATCH"

    def test_synthetic_fixture_provenance_accepted(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "SYNTHETIC_FIXTURE",
        }, headers=TOKEN)
        assert response.status_code == 200
        assert response.json()["provenance"] == "SYNTHETIC_FIXTURE"

    def test_undetermined_provenance_rejected_as_input(self):
        response = client.post("/internal/v1/analyze-email", json={
            "content_base64": b64(NORMAL_EML),
            "provenance": "UNDETERMINED",
        }, headers=TOKEN)
        assert response.status_code == 422


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
