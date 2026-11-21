# Threat Model

Conventional, publicly described BEC behaviors only. Synthetic data exclusively.

## Attack surface and controls

| Threat | Observation | Control | Residual risk |
|---|---|---|---|
| Executive impersonation | display-name/role language | BEC-01/03/04 indicators; mandatory hold | Titles cannot authenticate a human |
| Supplier lookalike domain | normalized domain similarity | BEC-02 vs approved domains/aliases; IDNA-safe | Conservative threshold may miss novel homoglyphs |
| Reply-To manipulation | reply routing differs | BEC-01 with legitimate-exception explanation | Some honest mail uses different Reply-To |
| Claimed SPF/DKIM/DMARC pass | forged Authentication-Results | UNTRUSTED_CLAIM on raw upload; SPF UNKNOWN (T02) | Only a real gateway integration can verify |
| Compromised real mailbox | passing mail auth | Workflow hold independent of mail signals (T04) | Business controls, not mail auth, carry the risk |
| Fraudulent bank-change request | payment language + urgency | BEC-08 mandatory hold; callback + dual approval | Collusion across all four identities defeats it |
| Callback number in the email | unapproved contact | Invariant 3: directory contact must pre-date request (T07) | A pre-corrupted directory undermines callbacks |
| Privilege abuse / self-approval | actor separation | Server-side role + identity checks (T06, T13, T15) | MFA/IdP hardening is a production gate |
| Concurrent race attacks | duplicate approvals/releases | Row locks, idempotency, unique constraints (T08, T17) | — |
| Audit tampering | history rewrite attempts | Append-only grants + HMAC chain + verifier CLI (T10) | DBA with key access could rebuild a chain |
| Cross-tenant access | known-UUID probing | Tenant-scoped queries; neutral 404s (T09) | — |

## Trust assumptions

The API process, its key material and PostgreSQL are trusted; browsers, uploaded `.eml` content and all
mail headers are untrusted; the Python service is trusted only as an internal analyzer (still gets no keys,
no DB write access, and only restricted-network reachability).

## Non-goals

No malware detection, no SMTP gateway, no funds movement, no automatic calling, no bank-data verification
authority, no real-world effectiveness claims from synthetic fixtures.
