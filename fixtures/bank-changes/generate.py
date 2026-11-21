#!/usr/bin/env python3
"""Generate the 26 bank-change workflow scenario fixtures (JSON step scripts).

24+ scenarios: at least 12 negative and 12 valid/edge, per the handoff fixture
inventory. Every scenario is executed against the REAL running API by the
integration suite (tests/integration/bank-change-scenarios.test.ts) — these
are executable specifications, not documentation.

All actors, suppliers and account values are synthetic (.example domains,
invalid-check-digit identifiers such as GB00SYNT... that cannot exist as real
IBANs, 555-range phone numbers).

Usage: python3 fixtures/bank-changes/generate.py
"""

from __future__ import annotations

import json
from pathlib import Path

VALID_ACCOUNT = "GB00SYNT00001122334455"
EDITED_ACCOUNT = "GB00SYNT00009988776655"

PROPOSED = {
    "accountIdentifier": VALID_ACCOUNT,
    "beneficiaryName": "Vulcan Steel Supplies Ltd",
    "bankName": "Example Trust Bank",
    "currency": "GBP",
}
PROPOSED_MERIDIAN = {
    "accountIdentifier": "GB00SYNT00002211446688",
    "beneficiaryName": "Meridian Packaging Co",
    "bankName": "Example Commerce Bank",
    "currency": "GBP",
}
PROPOSED_EDITED = {
    "accountIdentifier": EDITED_ACCOUNT,
    "beneficiaryName": "Vulcan Steel Supplies Ltd — Treasury",
    "bankName": "Example Trust Bank",
    "currency": "GBP",
}

SCENARIOS: list[dict] = []


def scenario(sid: str, category: str, description: str, supplier: str, steps: list[dict],
             final_state: str | None = None, audit_events: list[str] | None = None,
             idempotent: bool = True) -> None:
    SCENARIOS.append({
        "id": sid,
        "category": category,
        "description": description,
        "tenant": "atlas",
        "supplier": supplier,
        "steps": steps,
        "finalState": final_state,
        "expectAuditEventTypes": audit_events or [],
        "idempotentSteps": idempotent,
    })


def create(actor: str, proposed: dict, reason: str, status: int = 201, state: str = "ON_HOLD",
           revision: int = 1, supplier: str | None = None, code: str | None = None):
    expect = {"status": status}
    if status < 400:
        expect.update({"state": state, "revision": revision})
    if code:
        expect["code"] = code
    step = {"actor": actor, "action": "create", "input": {"proposed": proposed, "reason": reason},
            "expect": expect}
    if supplier:
        step["supplier"] = supplier
    return step


def verify(actor: str, revision: int, contact: str, result: str, status: int = 200,
           state: str | None = None, code: str | None = None, evidence: str = "call-log-2026-11-21"):
    expect = {"status": status}
    if state:
        expect["state"] = state
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "verify",
            "input": {"revision": revision, "approvedContactId": f"@contact:{contact}",
                      "result": result, "method": "APPROVED_DIRECTORY_CONTACT",
                      "evidenceRef": evidence},
            "expect": expect}


def decide(actor: str, revision: int, decision: str, status: int = 200, state: str | None = None,
           code: str | None = None):
    expect = {"status": status}
    if state:
        expect["state"] = state
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "decide", "input": {"revision": revision, "decision": decision},
            "expect": expect}


def release(actor: str, revision: int, status: int = 200, state: str | None = None, code: str | None = None):
    expect = {"status": status}
    if state:
        expect["state"] = state
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "release", "input": {"revision": revision}, "expect": expect}


def revise(actor: str, revision: int, proposed: dict, reason: str, status: int = 201,
           state: str = "ON_HOLD", new_revision: int | None = None, code: str | None = None):
    expect = {"status": status, "state": state}
    if new_revision:
        expect["revision"] = new_revision
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "revise",
            "input": {"expectedRevision": revision, "proposed": proposed, "reason": reason},
            "expect": expect}


def erp_ack(actor: str, release_ref: str, revision: int, status: int = 200, state: str | None = None,
            code: str | None = None, wrong_secret: bool = False):
    expect = {"status": status}
    if state:
        expect["state"] = state
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "erp-ack",
            "input": {"releaseRef": f"@releaseRef", "revision": revision,
                      "externalReceipt": "ERP-RCPT-2026-0001"},
            "useReleaseRef": True, "wrongSecret": wrong_secret, "expect": expect}


def cancel(actor: str, status: int = 200, state: str = "CANCELLED", code: str | None = None):
    expect = {"status": status, "state": state} if status < 400 else {"status": status}
    if code:
        expect["code"] = code
    return {"actor": actor, "action": "cancel", "input": {}, "expect": expect}


def approve_contact(actor: str, contact_key: str, value: str, label: str):
    return {"actor": actor, "action": "approve-contact",
            "input": {"channel": "PHONE", "value": value, "label": label},
            "contactKey": contact_key, "expect": {"status": 201}}


# ---------------------------------------------------------------------------
# Valid / edge scenarios (12)
# ---------------------------------------------------------------------------

scenario("BC-V01", "valid", "Full governed happy path to ERP acknowledgment",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Supplier emailed updated remittance details."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver1", 1, state="RELEASED_FOR_ERP_UPDATE"),
          erp_ack("atlas-admin", "@releaseRef", 1, state="ERP_APPLIED")],
         final_state="ERP_APPLIED",
         audit_events=["BANK_CHANGE_CREATED", "BANK_CHANGE_HOLD", "CALLBACK_ATTESTED",
                       "DECISION_RECORDED", "BANK_CHANGE_RELEASED", "ERP_ACK_RECORDED"])

scenario("BC-V02", "valid", "Happy path stops at RELEASED_FOR_ERP_UPDATE (no ERP yet)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Annual banking review update."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver2", 1, state="RELEASED_FOR_ERP_UPDATE")],
         final_state="RELEASED_FOR_ERP_UPDATE")

scenario("BC-V03", "edge", "Callback UNREACHABLE then successful retry before approval",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Supplier requested account update by post."),
          verify("atlas-verifier", 1, "vulcan-phone", "UNREACHABLE", state="ON_HOLD"),
          verify("atlas-verifier", 1, "vulcan-alt-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1")],
         final_state="APPROVAL_1")

scenario("BC-V04", "valid", "Approver rejects after a verified callback",
         "meridian-pack",
         [create("atlas-initiator", PROPOSED_MERIDIAN, "Meridian notified new account by email."),
          verify("atlas-verifier", 1, "meridian-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "REJECT", state="REJECTED")],
         final_state="REJECTED")

scenario("BC-V05", "valid", "Initiator cancels their own pending request",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Duplicate request; cancelling."),
          cancel("atlas-initiator")],
         final_state="CANCELLED")

scenario("BC-V06", "edge", "Supplier without an active payment account still enters HOLD",
         "granite-tools",
         [create("atlas-initiator", {
             "accountIdentifier": "GB00SYNT00007788990011",
             "beneficiaryName": "Granite Tooling Co",
             "bankName": "Example Regional Bank",
             "currency": "GBP",
         }, "Onboarding new supplier payment details.", state="ON_HOLD")],
         final_state="ON_HOLD")

scenario("BC-V07", "valid", "Independent callback returns DENIED — request rejected safely",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Suspicious email requested the change."),
          verify("atlas-verifier", 1, "vulcan-phone", "DENIED", state="REJECTED")],
         final_state="REJECTED",
         audit_events=["CALLBACK_DENIED", "REQUEST_REJECTED"])

scenario("BC-V08", "edge", "Identical create replay with same idempotency key returns the same change",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Replayed submission."),
          {"actor": "atlas-initiator", "action": "create-replay", "sameKey": True,
           "input": {"proposed": PROPOSED, "reason": "Replayed submission."},
           "expect": {"status": 201, "sameChange": True, "state": "ON_HOLD"}}],
         final_state="ON_HOLD")

scenario("BC-V09", "edge", "Approval replay with same key does not create a second decision",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Approval replay test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          {"actor": "atlas-approver1", "action": "decide-replay", "sameKey": True,
           "input": {"revision": 1, "decision": "APPROVE"},
           "expect": {"status": 200, "approvalCount": 1, "state": "APPROVAL_1"}}],
         final_state="APPROVAL_1")

scenario("BC-V10", "edge", "Release replay with same key yields a single release",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Release replay test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver1", 1, state="RELEASED_FOR_ERP_UPDATE"),
          {"actor": "atlas-approver1", "action": "release-replay", "sameKey": True,
           "input": {"revision": 1}, "expect": {"status": 200, "state": "RELEASED_FOR_ERP_UPDATE"}}],
         final_state="RELEASED_FOR_ERP_UPDATE")

scenario("BC-V11", "edge", "Tenant administrator (authorized finance function) performs the release",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Admin release path test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-admin", 1, state="RELEASED_FOR_ERP_UPDATE")],
         final_state="RELEASED_FOR_ERP_UPDATE")

scenario("BC-V12", "edge", "Early release attempt denied, then workflow completes correctly",
         "meridian-pack",
         [create("atlas-initiator", PROPOSED_MERIDIAN, "Early release attempt test."),
          verify("atlas-verifier", 1, "meridian-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          release("atlas-approver1", 1, status=422, code="INVALID_TRANSITION"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          release("atlas-approver1", 1, status=422, code="INVALID_TRANSITION"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver1", 1, state="RELEASED_FOR_ERP_UPDATE")],
         final_state="RELEASED_FOR_ERP_UPDATE")

# ---------------------------------------------------------------------------
# Negative scenarios (14)
# ---------------------------------------------------------------------------

scenario("BC-N01", "negative", "Initiator cannot approve their own request (T06)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Self-approval attempt."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-initiator", 1, "APPROVE", status=403, code="SEPARATION_OF_DUTIES")],
         final_state="CALLBACK_VERIFIED",
         audit_events=["ACCESS_DENIED"])

scenario("BC-N02", "negative", "Verifier cannot serve as approver (T06)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Verifier approval attempt."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-verifier", 1, "APPROVE", status=403, code="SEPARATION_OF_DUTIES")],
         final_state="CALLBACK_VERIFIED")

scenario("BC-N03", "negative", "Same approver cannot approve twice (T06)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Duplicate approver attempt."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver1", 1, "APPROVE", status=403, code="SEPARATION_OF_DUTIES")],
         final_state="APPROVAL_1")

scenario("BC-N04", "negative", "Security analyst cannot create a bank change",
         "vulcan-steel",
         [create("atlas-analyst", PROPOSED, "Analyst should not initiate.", status=403, code="FORBIDDEN")],
         final_state=None)

scenario("BC-N05", "negative", "Auditor cannot record a callback verification",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Auditor verification attempt."),
          verify("atlas-auditor", 1, "vulcan-phone", "CONFIRMED", status=403, code="FORBIDDEN")],
         final_state="ON_HOLD")

scenario("BC-N06", "negative", "Callback contact approved only AFTER the request is rejected (invariant 3)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Contact freshness test."),
          approve_contact("atlas-admin", "fresh-contact", "+15550188", "Newly approved line"),
          verify("atlas-verifier", 1, "fresh-contact", "CONFIRMED", status=422, code="VERIFICATION_REQUIRED")],
         final_state="ON_HOLD")

scenario("BC-N07", "negative", "Callback using a number that appears only in the email is rejected (T07)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Number supplied in the message body."),
          verify("atlas-verifier", 1, "nonexistent-contact", "CONFIRMED", status=404, code="NOT_FOUND_IN_TENANT")],
         final_state="ON_HOLD")

scenario("BC-N08", "negative", "Approval with a stale revision after material edit returns 409 (T05)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Stale revision test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          revise("atlas-initiator", 1, PROPOSED_EDITED, "Beneficiary corrected by supplier.", new_revision=2),
          decide("atlas-approver1", 1, "APPROVE", status=409, code="STALE_REVISION")],
         final_state="ON_HOLD")

scenario("BC-N09", "negative", "Material edit voids callback and approvals; release with old evidence denied (T05)",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Revision invalidation test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          revise("atlas-initiator", 1, PROPOSED_EDITED, "Bank reissued the account.", new_revision=2),
          release("atlas-approver1", 2, status=422, code="INVALID_TRANSITION"),
          decide("atlas-approver1", 2, "APPROVE", status=422, code="VERIFICATION_REQUIRED")],
         final_state="ON_HOLD",
         audit_events=["REVISION_CREATED"])

scenario("BC-N10", "negative", "Release without two approvals is denied",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Insufficient approvals test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          release("atlas-approver1", 1, status=422, code="INVALID_TRANSITION")],
         final_state="APPROVAL_1")

scenario("BC-N11", "negative", "ERP acknowledgment with the wrong adapter secret is refused",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "ERP auth test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver1", 1, state="RELEASED_FOR_ERP_UPDATE"),
          erp_ack("atlas-admin", "@releaseRef", 1, status=401, code="UNAUTHENTICATED", wrong_secret=True)],
         final_state="RELEASED_FOR_ERP_UPDATE")

scenario("BC-N12", "negative", "ERP acknowledgment with a mismatching releaseRef is refused",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "ERP releaseRef test."),
          verify("atlas-verifier", 1, "vulcan-phone", "CONFIRMED", state="CALLBACK_VERIFIED"),
          decide("atlas-approver1", 1, "APPROVE", state="APPROVAL_1"),
          decide("atlas-approver2", 1, "APPROVE", state="APPROVAL_2"),
          release("atlas-approver1", 1, state="RELEASED_FOR_ERP_UPDATE"),
          {"actor": "atlas-admin", "action": "erp-ack",
           "input": {"releaseRef": "00000000-0000-4000-8000-000000000000",
                     "revision": 1, "externalReceipt": "ERP-RCPT-MISMATCH"},
           "useReleaseRef": False, "wrongSecret": False,
           "expect": {"status": 422, "code": "INVALID_TRANSITION"}}],
         final_state="RELEASED_FOR_ERP_UPDATE")

scenario("BC-N13", "negative", "No further decisions on a rejected change",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Terminal state test."),
          verify("atlas-verifier", 1, "vulcan-phone", "DENIED", state="REJECTED"),
          decide("atlas-approver1", 1, "APPROVE", status=422, code="INVALID_TRANSITION")],
         final_state="REJECTED")

scenario("BC-N14", "negative", "Non-initiator without admin role cannot cancel",
         "vulcan-steel",
         [create("atlas-initiator", PROPOSED, "Cancel permission test."),
          cancel("atlas-analyst", status=403, code="FORBIDDEN", state=None)],
         final_state="ON_HOLD")


def main() -> None:
    out_dir = Path(__file__).parent
    for scenario_dict in SCENARIOS:
        path = out_dir / f"{scenario_dict['id']}.json"
        path.write_text(json.dumps(scenario_dict, indent=2))
    (out_dir / "index.json").write_text(json.dumps({
        "description": "Executable bank-change workflow scenarios (run by tests/integration/bank-change-scenarios.test.ts).",
        "counts": {
            "valid": sum(1 for s in SCENARIOS if s["category"] in ("valid", "edge")),
            "negative": sum(1 for s in SCENARIOS if s["category"] == "negative"),
            "total": len(SCENARIOS),
        },
        "scenarios": [s["id"] for s in SCENARIOS],
    }, indent=2))
    print(f"wrote {len(SCENARIOS)} scenarios:",
          sum(1 for s in SCENARIOS if s['category'] in ('valid', 'edge')), "valid/edge,",
          sum(1 for s in SCENARIOS if s['category'] == 'negative'), "negative")


if __name__ == "__main__":
    main()
