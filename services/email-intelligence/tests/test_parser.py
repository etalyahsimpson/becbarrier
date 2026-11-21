"""T01 (bounded MIME handling) and T16 (Unicode domain / unsafe content) for
the parser, plus adversarial-MIME regression coverage."""

from __future__ import annotations

from conftest import NORMAL_EML, run

from app.mime_parser import parse_eml, redact_digits, strip_html
from app.schemas import ParseStatus


class TestBoundedParsing:
    def test_normal_message_parses(self):
        result = parse_eml(NORMAL_EML)
        assert result.status == ParseStatus.OK
        assert result.normalized is not None
        assert result.normalized.fromAddress["domain"] == "vulcan-steel.example"
        assert len(result.digest) == 64

    def test_empty_payload_is_malformed(self):
        result = parse_eml(b"")
        assert result.status == ParseStatus.MALFORMED

    def test_oversize_input_rejected_before_parse(self):
        result = parse_eml(b"From: a@b.example\n\n" + b"x" * (2 * 1024 * 1024 + 1))
        assert result.status == ParseStatus.REJECTED_OVERSIZE

    def test_deeply_nested_multipart_is_bounded(self):
        depth = 40
        raw = b"From: a@b.example\nSubject: nest\nMIME-Version: 1.0\n"
        raw += b"Content-Type: multipart/mixed; boundary=\"o\"\n\n"
        body = b"nested body text about payment"
        for _ in range(depth):
            body = b"--o\nContent-Type: multipart/mixed; boundary=\"o\"\n\n" + body
        body += b"--o--\n"
        result = parse_eml(raw + body)
        assert result.status == ParseStatus.OK
        assert result.normalized is not None
        assert result.normalized.mimePartCount <= 51  # bounded by MAX_PARTS

    def test_broken_mime_boundary_does_not_crash(self):
        raw = b"From: a@b.example\nContent-Type: multipart/mixed; boundary=\"broken\"\n\n--wrong-boundary\nno closing boundary"
        result = parse_eml(raw)
        assert result.status in (ParseStatus.OK, ParseStatus.MALFORMED)
        if result.status == ParseStatus.OK:
            assert result.normalized is not None

    def test_deeply_folded_headers(self):
        raw = (
            b"From: a@b.example\n"
            b"Subject: " + b"word\n ".join([b"x" * 20] * 50) + b"\n\nbody"
        )
        result = parse_eml(raw)
        assert result.status in (ParseStatus.OK, ParseStatus.MALFORMED)


class TestUnsafeContentHandling:
    def test_html_script_content_never_executed_or_emitted(self):
        raw = (
            b"From: billing@vulcan-steel.example\n"
            b"Subject: invoice\n"
            b"Content-Type: text/html\n\n"
            b"<html><body><script>alert('xss')</script>"
            b"<p>Please update our bank account details today</p>"
            b"</body></html>"
        )
        result = parse_eml(raw)
        assert result.status == ParseStatus.OK
        text = result.normalized.bodyTextExcerpt or ""
        assert "<script>" not in text
        assert "alert" not in text
        assert "bank account" in text

    def test_remote_images_counted_not_fetched(self):
        raw = (
            b"From: billing@vulcan-steel.example\n"
            b"Subject: tracked\n"
            b"Content-Type: text/html\n\n"
            b"<img src=\"https://tracker.example/pixel.gif\"> hello"
        )
        result = parse_eml(raw)
        assert result.status == ParseStatus.OK
        assert result.normalized.remoteImageReferences == 1

    def test_attachments_names_only_never_extracted(self):
        raw = (
            b"From: billing@vulcan-steel.example\n"
            b"Subject: statement\n"
            b"MIME-Version: 1.0\n"
            b"Content-Type: multipart/mixed; boundary=\"q\"\n\n"
            b"--q\nContent-Type: text/plain\n\nplease update payment details\n"
            b"--q\nContent-Type: application/pdf\n"
            b"Content-Disposition: attachment; filename=\"statement.pdf\"\n"
            b"Content-Transfer-Encoding: base64\n\nJVBERi0xLjQ=\n--q--\n"
        )
        result = parse_eml(raw)
        assert result.status == ParseStatus.OK
        assert "statement.pdf" in result.normalized.attachmentNames
        # No PDF bytes ever appear in the excerpt.
        assert "JVBERi" not in (result.normalized.bodyTextExcerpt or "")

    def test_digit_runs_are_redacted_in_excerpts(self):
        assert redact_digits("account 12345678901234 end") == "account •••• end"

    def test_strip_html_removes_tags_and_unescapes(self):
        assert strip_html("<p>a &amp; b</p>") == "a & b"

    def test_unicode_domain_normalizes_to_idna(self):
        raw = (
            "From: Billing <billing@bücher-steel.example>\n"
            "To: finance@atlas.example\nSubject: x\n\nbody"
        ).encode()
        result = run(raw, approved=[])
        assert result.parseStatus == ParseStatus.OK
        normalized_domain = result.normalized.fromAddress["domainNormalized"]
        assert normalized_domain is not None
        assert normalized_domain.startswith("xn--")
        # Original unicode distinction is preserved in the raw domain value.
        assert result.normalized.fromAddress["domain"] == "bücher-steel.example"

    def test_malformed_address_header_yields_structured_result(self):
        raw = b"From: not an address at all\nSubject: x\n\nbody"
        result = run(raw)
        assert result.parseStatus == ParseStatus.OK  # header tolerable
        # From address unparseable → BEC-01/02/06 are UNKNOWN, not false PASS
        from app.evaluation import EvaluationContext  # noqa: F401
        outcomes = {f.ruleId: f.outcome for f in result.findings}
        assert outcomes["BEC-02"] == "UNKNOWN"
        assert outcomes["BEC-06"] == "UNKNOWN"
