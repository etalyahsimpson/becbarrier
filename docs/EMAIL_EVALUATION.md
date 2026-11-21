# Email Evaluation (BEC-01 .. BEC-07, bec-rules-v1)

## Provenance grades

| Grade | Meaning | Permitted use |
|---|---|---|
| TRUSTED_GATEWAY | authenticated ingestion integration | **unreachable in this release** — callers cannot request it |
| RAW_UPLOAD | voluntarily supplied file | text/identifier comparison only; auth headers stay claims |
| SYNTHETIC_FIXTURE | generated test message | rule-branch coverage only |
| UNDETERMINED | parsing insufficient | record uncertainty, never promote |

## Rules

| Rule | Condition | Severity |
|---|---|---|
| BEC-01 | Reply-To differs from From (missing = no match) | MEDIUM |
| BEC-02 | From domain resembles an approved domain (ratio >= 0.72, len >= 6) but is not approved/aliased | HIGH |
| BEC-03 | controlled bank/beneficiary/change phrase with redacted excerpt | HIGH |
| BEC-04 | urgency phrase in payment context | LOW |
| BEC-05 | trusted SPF/DKIM/DMARC failure — UNKNOWN without trusted transport evidence | MEDIUM |
| BEC-06 | claimed supplier identity conflicts with the approved directory | HIGH |
| BEC-07 | Authentication-Results present on raw upload (informational claim) | INFO |
| BEC-08 | workflow rule: bank fingerprint change forces HOLD (Express, not Python) | CRITICAL (workflow) |

Score = sum of distinct triggered severities (INFO 0 / LOW 10 / MEDIUM 25 / HIGH 45 / CRITICAL 70), capped
at 100; priority bands LOW/MEDIUM/HIGH/CRITICAL. This is a transparent triage heuristic, **not** a
calibrated fraud probability; score 0 means "no rules fired", never "safe".

## Fixture results (deterministic, reproducible)

Reproduce with `python3 scripts/summarize-fixtures.py` (pandas + numpy). Latest committed run artifacts:
`artifacts/fixture-evaluation.json`, `artifacts/fixture-outcomes.csv`, `artifacts/rule-distribution.csv`.

- 32 fixtures: 8 normal, 12 suspicious, 6 ambiguous, 6 malformed (all invented entities, `.example` TLD,
  invalid-check-digit account identifiers, 555-range numbers).
- Every suspicious fixture raises at least one MATCH; the 8 normal fixtures include two documented
  benign-exception cases (N04 legitimate support-desk Reply-To scores MEDIUM 25 via BEC-01).
- BEC-05 is UNKNOWN on every fixture (no trusted gateway exists — by design); BEC-02 uses conservative
  similarity so unrelated domains do not flag.

**These are fixture-agreement results for the declared test set only. They are not a measurement of
real-world BEC detection effectiveness, accuracy or financial savings.**
