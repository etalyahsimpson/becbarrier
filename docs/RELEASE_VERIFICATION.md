# Release Verification

This document records the verification performed for the initial release. Values are re-checked at each
publication; the GitHub Actions badge and run history on `main` are the live source of truth.

## Verification checklist

| Check | Status |
|---|---|
| Repository public under `etalyahsimpson/becbarrier` | verified at publication |
| Local suites: unit / python / integration / security | all green (see TESTING_AND_RESULTS.md) |
| Production builds (packages, api, worker, web) | green locally and in the CI build job |
| Audit integrity verification | `npm run test:audit-verify` chain VERIFIED |
| CI on final remote HEAD | see the badge at the top of README.md / Actions tab |
| No secrets committed | CI secret scan + grep gate |
| Least-privilege DB roles | proven by T10 permission-denial tests |
| Hero/mark/social-preview assets | generated originals in assets/ |

## Remote evidence

- CI workflow: `.github/workflows/ci.yml` — jobs: quality, python, integration, build, e2e, security-scans.
- The final published commit must have a successful CI run; if any job is red the release status is
  INCOMPLETE and this document must be updated after the fix.

## Unresolved blockers

None at publication time. Any later blockers are recorded here with exact reasons.
