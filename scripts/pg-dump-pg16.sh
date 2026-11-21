#!/usr/bin/env bash
# Runs pg_dump inside the postgres:16 service container so the client tools
# always match the server version (used by CI for the T14 backup/restore
# verification). Local development can point PG_DUMP_BIN at a host binary.
set -euo pipefail
CID="$(docker ps --filter ancestor=postgres:16 --format '{{.ID}}' | head -1)"
if [ -z "$CID" ]; then
  echo "pg-dump-pg16: no postgres:16 container is running" >&2
  exit 1
fi
exec docker exec -e PGPASSWORD="${PGPASSWORD:-}" "$CID" pg_dump "$@"
