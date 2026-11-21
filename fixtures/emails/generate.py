#!/usr/bin/env python3
"""Generate the 32 synthetic email fixtures and their expected outcomes.

All entities are invented (reserved .example TLD, 555 phone numbers, synthetic
IBAN-style identifiers with invalid '00' check digits). NO real correspondence,
bank data or victim material is used.

Expected outcomes are computed by running the actual evaluation engine
(bec-rules-v1) with the Atlas tenant's approved supplier domains, provenance
RAW_UPLOAD — exactly what the API pipeline will produce. The integration
suite then verifies the running API reproduces these expectations.

Usage: python3 fixtures/emails/generate.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "services" / "email-intelligence"))

from app.evaluation import evaluate  # noqa: E402
from app.schemas import ProvenanceGrade  # noqa: E402

ATLAS_DOMAINS = ["vulcan-steel.example", "meridian-pack.example", "northlight.example", "apexchem.example"]
ATLAS_ALIASES = ["northlight-logistics.example"]

FIXTURES: list[dict[str, str | bytes]] = []


def add(fid: str, category: str, description: str, raw: bytes) -> None:
    FIXTURES.append({"id": fid, "category": category, "description": description, "raw": raw})


def eml(from_header: str, subject: str, body: str, reply_to: str | None = None,
        extra_headers: str = "", to: str = "Finance <finance@atlas-mfg.example>") -> bytes:
    lines = [f"From: {from_header}", f"To: {to}", f"Subject: {subject}"]
    if reply_to:
        lines.append(f"Reply-To: {reply_to}")
    lines.append("Date: Fri, 20 Nov 2026 09:00:00 +0000")
    lines.append("Message-ID: <" + from_header.split("<")[-1].strip(">").split("@")[0][:20]
                 + "-20261120@atlas-mfg.example>")
    if extra_headers:
        lines.append(extra_headers.rstrip("\n"))
    return ("\n".join(lines) + "\n\n" + body).encode("utf-8")


# ---------------------------------------------------------------------------
# Normal mail (8)
# ---------------------------------------------------------------------------

add("N01", "normal", "Internal weekly update, no supplier context",
    eml("Team Update <team@atlas-mfg.example>", "Weekly operations update",
        "The weekly operations review is scheduled for Monday. Facility hours are unchanged."))

add("N02", "normal", "Normal supplier invoice, no bank-change language",
    eml("Vulcan Steel Billing <billing@vulcan-steel.example>", "Invoice INV-2026-118 for November",
        "Please find attached invoice INV-2026-118 for November deliveries.\n"
        "Payment terms remain 30 days net. Nothing about our payment routing has changed.\n"
        "Kind regards,\nVulcan Steel billing"))

add("N03", "normal", "Supplier alias domain, routine shipment note",
    eml("Northlight Ops <ops@northlight-logistics.example>", "Shipment schedule for next week",
        "Your consignments are scheduled for Tuesday and Thursday next week. "
        "Contact the usual desk for any changes."))

add("N04", "normal", "Legitimate reply-to support desk (BEC-01 legitimate exception)",
    eml("Meridian Packaging <orders@meridian-pack.example>", "Order confirmation 4471",
        "Order 4471 is confirmed and queued for dispatch. Replies reach our support desk "
        "for fastest handling.",
        reply_to="support@meridian-pack.example"))

add("N05", "normal", "Benign urgency with no payment context",
    eml("HR Services <hr@atlas-mfg.example>", "Expense reports due today",
        "Reminder: please submit your expense report today before the monthly cutoff."))

add("N06", "normal", "Ordinary newsletter",
    eml("Industry Weekly <news@industry-weekly.example>", "Industry Weekly — November edition",
        "This week: logistics capacity outlook, packaging material trends, and a profile "
        "of regional manufacturers. Manage your subscription in the portal."))

add("N07", "normal", "Well-formed message from an unapproved but unrelated domain",
    eml("Conference Team <hello@manufacturing-summit.example>", "Speaker confirmation",
        "Thank you for confirming your speaking slot. We will share the agenda next week."))

add("N08", "normal", "Supplier statement notification, no indicators",
    eml("Meridian Packaging <statements@meridian-pack.example>", "Your monthly statement is ready",
        "Your November statement is available in the customer portal. No action is required."))

# ---------------------------------------------------------------------------
# Suspicious mail (12)
# ---------------------------------------------------------------------------

add("S01", "suspicious", "Executive impersonation directing urgent payment action",
    eml("Avery Chen (CFO) <avery.chen@atlas-exec.example>", "Urgent: payment needed today",
        "I am in a meeting. Please process a payment immediately and reply with the bank details "
        "for the wire transfer. This must happen today before the deadline."))

add("S02", "suspicious", "Supplier lookalike domain with bank-change language",
    eml("Vulcan Steel Billing <billing@vu1can-steel.example>", "Updated remittance information",
        "Please note our bank account has changed. Update your records with the new account "
        "number for all future payments to Vulcan Steel.",
        reply_to="vulcan.payments@external-mail.example"))

add("S03", "suspicious", "Approved domain with altered Reply-To redirection",
    eml("Vulcan Steel <billing@vulcan-steel.example>", "New payment instructions",
        "Due to an internal system change, our payment instructions are updated. "
        "Please confirm receipt of the new account details.",
        reply_to="vulcan.payments@external-mail.example"))

add("S04", "suspicious", "Authenticated-looking supplier message requesting bank change (T04)",
    eml("Vulcan Steel <billing@vulcan-steel.example>", "Banking update — action required",
        "Our finance department has moved banks. Please update our beneficiary details "
        "urgently so this month's invoice is not delayed.",
        extra_headers="DKIM-Signature: v=1; a=rsa-sha256; d=vulcan-steel.example; s=sel; b=claim\n"
                      "Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass"))

add("S05", "suspicious", "Lookalike domain with urgency plus bank-change combination",
    eml("Meridian <accounts@meridian-pak.example>", "URGENT: account update needed today",
        "We have changed our bank details. Kindly process the update today so the outstanding "
        "invoice payment is not blocked."))

add("S06", "suspicious", "Approved-alias domain carrying claimed SPF/DKIM/DMARC PASS (T02)",
    eml("Northlight Finance <finance@northlight-logistics.example>", "Payment account change",
        "Please update our payment account details in your system for upcoming remittances.",
        extra_headers="Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass"))

add("S07", "suspicious", "Full combination: lookalike, reply-to mismatch, bank language, urgency, claimed auth",
    eml("Vulcan Steel Accounts <billing@vu1can-stee1.example>", "URGENT final notice — banking change",
        "Immediate action required: our bank account number and beneficiary have changed. "
        "Update your records today before the payment deadline or shipments will stop.",
        reply_to="vulcan.payments@external-mail.example",
        extra_headers="Authentication-Results: mx.example; spf=pass; dkim=pass; dmarc=pass"))

add("S08", "suspicious", "Plural-suffix lookalike domain with payment language",
    eml("Vulcan Steels <billing@vulcan-steels.example>", "Invoice payment update",
        "For all future invoice payments please use our updated banking details attached."))

add("S09", "suspicious", "Character-doubled lookalike of a second supplier",
    eml("Northlight <billing@northlightt.example>", "Remittance change notice",
        "Our remittance account has changed. Please update the beneficiary information "
        "for the next payment run."))

add("S10", "suspicious", "Sort-code and account-number specific bank-change request",
    eml("Meridian Packaging <accounts@meridian-pak.example>", "Updated sort code and account",
        "Our bank has issued a new sort code and account number. Please update the "
        "payment details on file for our account."))

add("S11", "suspicious", "Lookalike domain with urgency but no explicit bank-change phrase",
    eml("Vulcan Steel <billing@vu1can-steel.example>", "URGENT invoice follow-up",
        "Following up urgently on the outstanding invoice — please action the payment today "
        "and confirm by reply."))

add("S12", "suspicious", "Display-name supplier spoof from an unapproved domain",
    eml("Vulcan Steel Accounts Receivable <anyone@unrelated-domain.example>", "Payment redirection",
        "Vulcan Steel has updated its bank details. Please direct the next wire transfer "
        "to the new account per the attached instruction."))

# ---------------------------------------------------------------------------
# Ambiguous mail (6)
# ---------------------------------------------------------------------------

add("A01", "ambiguous", "Forwarded thread quoting third-party bank-change language",
    eml("Vulcan Steel <billing@vulcan-steel.example>", "Fwd: Coordinator update",
        "Forwarding for visibility:\n"
        "> From: Project Coordinator\n"
        "> Please note the new bank account details for the community project fund."))

add("A02", "ambiguous", "Trusted supplier writing from a similar alternate domain",
    eml("Meridian Packaging <hello@meridian.example>", "Catalogue update",
        "Our new catalogue is live. Existing order channels and contacts are unchanged."))

add("A03", "ambiguous", "Internationalized supplier domain (IDNA)",
    eml("Bücher Supplies <billing@xn--bcher-supplies.example>", "Order status",
        "Your order is being processed. We will send tracking details once dispatched."))

add("A04", "ambiguous", "Unsigned legitimate correspondence from an approved domain",
    eml("Northlight Logistics <ops@northlight.example>", "Delivery note 2026-11-20",
        "Delivery note attached. Please review quantities at the dock and sign in the portal."))

add("A05", "ambiguous", "Missing metadata: malformed From, no subject or date",
    b"From: <<<broken-address>>>\nX-Note: synthetic\n\nPlease call the office regarding the open invoice.")

add("A06", "ambiguous", "External partner urging invoice payment without bank change",
    eml("Consulting Partner <invoices@summit-consulting.example>", "Invoice overdue — please expedite",
        "Our records show invoice SC-118 remains unpaid. Please expedite the payment this week."))

# ---------------------------------------------------------------------------
# Malformed / parser-adversarial (6)
# ---------------------------------------------------------------------------

add("M01", "malformed", "Oversize payload (exceeds the 2 MiB cap)",
    eml("Big Sender <big@big.example>", "Large message", "x") + b"A" * (2 * 1024 * 1024 + 4096))

add("M02", "malformed", "Broken MIME boundary declaration",
    b"From: billing@vulcan-steel.example\nSubject: statement\n"
    b"Content-Type: multipart/mixed; boundary=\"broken\"\n\n"
    b"--wrong-boundary\nContent-Type: text/plain\n\nplease update payment details\n"
    b"--also-wrong--\n")

add("M03", "malformed", "Deeply folded header continuation lines",
    b"From: billing@vulcan-steel.example\nSubject: " + b"continuation\n " * 60 + b"\n\nbody text")

add("M04", "malformed", "Bogus Authentication-Results tokens",
    b"From: billing@vulcan-steel.example\nSubject: x\n"
    b"Authentication-Results: nonsense; spf=banana; dkim=?; dmarc=\xff\xfe broken\n\n"
    b"Regular text about an invoice.")

add("M05", "malformed", "Unsafe HTML: script handler, remote images, javascript link",
    b"From: billing@vulcan-steel.example\nSubject: invoice\nContent-Type: text/html\n\n"
    b"<html><body onload=\"steal()\">"
    b"<img src=\"https://tracker.example/p.png\">"
    b"<a href=\"javascript:bad()\">click</a>"
    b"<p>Please update our bank details</p></body></html>")

add("M06", "malformed", "Malformed address header",
    b"From: \"unclosed quote <broken@@example\nSubject: broken\n\n"
    b"Please update the account number for payment.")


def main() -> None:
    out_dir = Path(__file__).parent
    expected: list[dict] = []
    for fixture in FIXTURES:
        raw = fixture["raw"]
        assert isinstance(raw, bytes)
        path = out_dir / f"{fixture['id']}.eml"
        path.write_bytes(raw)
        result = evaluate(raw, ProvenanceGrade.RAW_UPLOAD, ATLAS_DOMAINS, ATLAS_ALIASES)
        findings = {f.ruleId: {"outcome": f.outcome, "severity": f.severity} for f in result.findings}
        matched = sorted(f.ruleId for f in result.findings if f.outcome == "MATCH")
        unknown = sorted(f.ruleId for f in result.findings if f.outcome == "UNKNOWN")
        normalized = result.normalized
        summary = None
        if normalized is not None:
            summary = {
                "from": normalized.fromAddress,
                "replyTo": normalized.replyTo,
                "subject": normalized.subject,
                "toCount": len(normalized.to),
                "authStatus": normalized.authStatus.model_dump(),
                "htmlPresent": normalized.htmlPresent,
                "attachmentNames": normalized.attachmentNames,
            }
        expected.append({
            "id": fixture["id"],
            "category": fixture["category"],
            "description": fixture["description"],
            "expected": {
                "digest": result.digest,
                "parseStatus": result.parseStatus.value,
                "provenance": "RAW_UPLOAD",
                "score": result.score,
                "priority": result.priority,
                "matchedRules": matched,
                "unknownRules": unknown,
                "findings": findings,
                "normalizedSummary": summary,
            },
        })
        print(f"{fixture['id']}: parse={result.parseStatus.value} score={result.score} "
              f"priority={result.priority} matched={','.join(matched) or '-'}")

    (out_dir / "expected.json").write_text(json.dumps({
        "rulesetVersion": "bec-rules-v1",
        "provenanceForExpectations": "RAW_UPLOAD",
        "approvedDomainsForExpectations": ATLAS_DOMAINS,
        "approvedAliasesForExpectations": ATLAS_ALIASES,
        "counts": {
            "normal": sum(1 for f in FIXTURES if f["category"] == "normal"),
            "suspicious": sum(1 for f in FIXTURES if f["category"] == "suspicious"),
            "ambiguous": sum(1 for f in FIXTURES if f["category"] == "ambiguous"),
            "malformed": sum(1 for f in FIXTURES if f["category"] == "malformed"),
            "total": len(FIXTURES),
        },
        "fixtures": expected,
    }, indent=2))
    counts = {c: sum(1 for f in FIXTURES if f["category"] == c) for c in ("normal", "suspicious", "ambiguous", "malformed")}
    print("\ncounts:", counts, "total:", len(FIXTURES))


if __name__ == "__main__":
    main()
