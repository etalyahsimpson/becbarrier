"""Rule-level tests: T03 (From/Reply-To mismatch, lookalikes, approved
aliases) and the full BEC-01..07 deterministic contract."""

from __future__ import annotations

from conftest import NORMAL_EML, outcomes, run

from app.schemas import ProvenanceGrade


def eml(from_header: str, reply_to: str | None = None, subject: str = "hello",
        body: str = "Regular business correspondence.", extra: str = "") -> bytes:
    lines = [f"From: {from_header}"]
    if reply_to:
        lines.append(f"Reply-To: {reply_to}")
    lines.append(f"Subject: {subject}")
    lines.append("Date: Fri, 20 Nov 2026 09:00:00 +0000")
    if extra:
        lines.append(extra.rstrip("\n"))
    return ("\n".join(lines) + "\n\n" + body).encode("utf-8")


class TestBEC01:
    def test_mismatch_matches(self):
        result = run(eml("Vulcan Steel <billing@vulcan-steel.example>",
                         "vulcan.payments@external-mail.example"))
        assert outcomes(result)["BEC-01"] == "MATCH"

    def test_missing_reply_to_is_no_match(self):
        result = run(NORMAL_EML)
        assert outcomes(result)["BEC-01"] == "NO_MATCH"

    def test_identical_reply_to_is_no_match(self):
        result = run(eml("Billing <billing@vulcan-steel.example>",
                         "billing@vulcan-steel.example"))
        assert outcomes(result)["BEC-01"] == "NO_MATCH"


class TestBEC02:
    def test_lookalike_domain_matches(self):
        result = run(eml("Vulcan Steel <billing@vu1can-steel.example>"))
        assert outcomes(result)["BEC-02"] == "MATCH"

    def test_character_substitution_lookalike_matches(self):
        result = run(eml("Meridian <ap@meridian-pak.example>"))
        assert outcomes(result)["BEC-02"] == "MATCH"

    def test_approved_domain_no_match(self):
        result = run(eml("Vulcan Steel <billing@vulcan-steel.example>"))
        assert outcomes(result)["BEC-02"] == "NO_MATCH"

    def test_approved_alias_no_match(self):
        result = run(eml("Northlight <ops@northlight-logistics.example>"))
        assert outcomes(result)["BEC-02"] == "NO_MATCH"

    def test_unrelated_domain_no_match(self):
        result = run(eml("Someone <someone@totally-unrelated.example>"))
        assert outcomes(result)["BEC-02"] == "NO_MATCH"

    def test_short_strings_do_not_flag(self):
        # Short common strings must not produce lookalike findings.
        result = run(eml("A <a@acme.example>"), approved=["acme.example", "acme.example"])
        assert outcomes(result)["BEC-02"] == "NO_MATCH"

    def test_similarity_threshold_is_conservative(self):
        # 'vulcan-steels.example' vs 'vulcan-steel.example' should match
        result = run(eml("V <b@vulcan-steels.example>"))
        assert outcomes(result)["BEC-02"] == "MATCH"
        # 'unrelated-vulcan.example' vs 'vulcan-steel.example' should not
        result = run(eml("V <b@unrelated-vulcan.example>"))
        assert outcomes(result)["BEC-02"] == "NO_MATCH"


class TestBEC03:
    def test_bank_change_phrase_matches_with_excerpt(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  body="Please update our bank account details for future remittance.")
        result = run(raw)
        finding = [f for f in result.findings if f.ruleId == "BEC-03"][0]
        assert finding.outcome == "MATCH"
        assert finding.maskedExcerpt is not None
        assert "bank account" in finding.maskedExcerpt.lower()

    def test_iban_phrase_matches(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  body="Our IBAN has changed, please update records.")
        assert outcomes(run(raw))["BEC-03"] == "MATCH"

    def test_plain_correspondence_no_match(self):
        assert outcomes(run(NORMAL_EML))["BEC-03"] == "NO_MATCH"

    def test_account_numbers_redacted_in_evidence(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  body="New account number 12345678901234 for payments.")
        result = run(raw)
        finding = [f for f in result.findings if f.ruleId == "BEC-03"][0]
        assert "12345678901234" not in (finding.maskedExcerpt or "")
        assert "••••" in (finding.maskedExcerpt or "")


class TestBEC04:
    def test_urgency_in_payment_context_matches(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  body="Urgent: process the invoice payment today.")
        assert outcomes(run(raw))["BEC-04"] == "MATCH"

    def test_urgency_without_payment_context_no_match(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  body="Urgent: please review the attached meeting notes.")
        assert outcomes(run(raw))["BEC-04"] == "NO_MATCH"

    def test_no_urgency_no_match(self):
        assert outcomes(run(NORMAL_EML))["BEC-04"] == "NO_MATCH"


class TestBEC05:
    def test_raw_upload_is_unknown(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  extra="Authentication-Results: spf=fail; dkim=fail; dmarc=fail\n")
        result = run(raw)
        finding = [f for f in result.findings if f.ruleId == "BEC-05"][0]
        assert finding.outcome == "UNKNOWN"
        assert "No trusted transport evidence" in finding.explanation

    def test_synthetic_fixture_is_unknown(self):
        result = run(NORMAL_EML, provenance=ProvenanceGrade.SYNTHETIC_FIXTURE)
        assert outcomes(result)["BEC-05"] == "UNKNOWN"


class TestBEC06:
    def test_claimed_supplier_identity_conflict(self):
        raw = eml("Vulcan Steel Accounts <anyone@some-other-domain.example>")
        result = run(raw)
        assert outcomes(result)["BEC-06"] == "MATCH"

    def test_approved_domain_no_conflict(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>")
        assert outcomes(run(raw))["BEC-06"] == "NO_MATCH"

    def test_generic_sender_no_conflict(self):
        raw = eml("Newsletter <news@random-news.example>")
        assert outcomes(run(raw))["BEC-06"] == "NO_MATCH"


class TestBEC07:
    def test_auth_results_claim_on_raw_upload_is_informational_match(self):
        raw = eml("Vulcan Steel <billing@vulcan-steel.example>",
                  extra="DKIM-Signature: v=1; a=rsa-sha256; d=vulcan-steel.example; s=sel; b=claim\n"
                        "Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass")
        result = run(raw)
        finding = [f for f in result.findings if f.ruleId == "BEC-07"][0]
        assert finding.outcome == "MATCH"
        assert finding.severity == "INFO"
        assert result.normalized.authStatus.spf == "UNKNOWN"
        assert result.normalized.authStatus.dkim == "PRESENT_UNVERIFIED"
        assert result.normalized.authStatus.dmarc == "NOT_EVALUATED"
        assert result.normalized.authStatus.claimTrust == "UNTRUSTED_CLAIM"

    def test_no_auth_results_no_match(self):
        assert outcomes(run(NORMAL_EML))["BEC-07"] == "NO_MATCH"


class TestScoring:
    def test_score_sums_distinct_severities_capped_at_100(self):
        raw = eml(
            "Vulcan Steel Accounts <ops@vu1can-steel.example>",
            reply_to="v.pay@external-mail.example",
            body="Urgent: update our bank account details today for the payment.",
            extra="Authentication-Results: spf=pass; dkim=pass; dmarc=pass\n",
        )
        result = run(raw)
        # BEC-01 MEDIUM 25 + BEC-02 HIGH 45 + BEC-03 HIGH 45 + BEC-04 LOW 10
        # + BEC-06 HIGH 45 + BEC-07 INFO 0 → 170 → capped at 100 (CRITICAL)
        assert result.score == 100
        assert result.priority == "CRITICAL"

    def test_zero_score_is_not_a_safety_claim(self):
        result = run(NORMAL_EML)
        assert result.score == 0
        assert result.priority is None

    def test_unknown_count_is_reported(self):
        result = run(NORMAL_EML)
        assert result.unknownCount >= 1  # BEC-05 always UNKNOWN on raw upload
