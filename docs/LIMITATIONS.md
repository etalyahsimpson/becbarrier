# Limitations

BECBarrier's initial release is a **local, synthetic-data demonstrator** of defensive controls. It is:

- **Not** an SMTP gateway, mailbox monitor or malware scanner — it analyzes explicitly supplied `.eml` files.
- **Not** a bank verification authority: it cannot verify account ownership; the callback attests that a
  human reached a previously approved contact, nothing more.
- **Not** a funds-movement or banking system: `RELEASED_FOR_ERP_UPDATE` produces an instruction for an
  external, separately authorized ERP update; the ERP-ack endpoint is a clearly-marked local contract
  demonstration with an injected adapter secret.
- **Not** enterprise authentication: the demo identity adapter is development/test-only; production boot
  fails closed without a real OIDC provider (PKCE adapter implemented, not wired to a live IdP).
- **Not** a calibrated fraud detector: BEC-01..07 are conservative deterministic heuristics with explicit
  UNKNOWN outcomes; the score is a triage priority. Fixture results are agreement with declared synthetic
  expectations — **no real-world detection-accuracy, prevention or savings claims are made**.
- **Not** claimably tamper-proof: audit chaining deters application-level tampering; an attacker with
  simultaneous database and key access could rebuild a chain (bounded threat model, documented).
- Limited residual risks remain: colluding approvers, a pre-corrupted supplier directory, novel IDN
  homoglyphs below the similarity threshold, and legitimate-but-unusual Reply-To usage (flagged as MEDIUM
  with an explanation).

Deployment readiness: SYNTHETIC-TEST VERIFIED tier. CONTROLLED PILOT READY and PRODUCTION ACCEPTED require
real IdP/MFA, key custody, privacy review, retention policy and operational ownership per the handoff
tiers — none are claimed here.
