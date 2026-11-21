#!/usr/bin/env bash
# Runs pg_restore inside the postgres:16 service container (see pg-dump-pg16.sh).
set -euo pipefail
CID="$(docker ps --filter ancestor=postgres:16 --format '{{.ID}}' | head -1)"
if [ -z "$CID" ]; then
  echo "pg-restore-pg16: no postgres:16 container is running" >&2
  exit 1
fi
exec docker exec -e PGPASSWORD="${PGPASSWORD:-}" "$CID" pg_restore "$@"
