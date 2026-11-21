#!/usr/bin/env bash
# Deterministic local verification, in CI order. Exits non-zero on the first
# failing gate. Run from a clean checkout with .env (scripts/setup-demo.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== BECBarrier verification ==="
echo "[1/9] dependency install (lockfile consistency)"
npm ci --ignore-scripts >/dev/null 2>&1 || npm ci >/dev/null
echo "[2/9] lint (eslint + ruff)"
npm run lint
echo "[3/9] typecheck"
npm run typecheck
echo "[4/9] unit tests"
npm run test:unit
echo "[5/9] python tests"
npm run test:python
echo "[6/9] database migrations"
npm run db:migrate
echo "[7/9] build (packages, api, worker, web)"
npm run build
echo "[8/9] fixture evaluation report (pandas/numpy)"
python3 scripts/summarize-fixtures.py
echo "[9/9] audit integrity verification"
npm run test:audit-verify
echo "=== verification complete ==="
