#!/usr/bin/env bash
# Capture genuine screenshots from the running seeded stack with Playwright.
# Requires: api on :4000, email-intelligence on :8001, web on :3000 (or set BASE_URL).
set -euo pipefail
cd "$(dirname "$0")/.."
BASE_URL="${BASE_URL:-http://localhost:3000}"
npx playwright test -c tests/e2e/playwright.config.ts --project=screenshots
