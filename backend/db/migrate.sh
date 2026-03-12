#!/usr/bin/env bash
# Apply database migrations
# Usage: ./migrate.sh [database_url]
# Example: ./migrate.sh "postgres://user:pass@host/db"
# Or use environment variable: export DATABASE_URL="postgres://user:pass@host/db"; ./migrate.sh

set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required to run migrations." >&2
  exit 1
fi

# Use provided URL or fall back to environment variable
if [[ -n "${1:-}" ]]; then
  DATABASE_URL="$1"
elif [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be provided as an argument or environment variable." >&2
  echo "Usage: ./migrate.sh 'postgres://user:pass@host/db'" >&2
  echo "Or: export DATABASE_URL='postgres://user:pass@host/db'" >&2
  exit 1
fi

MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/migrations" && pwd)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
SQL

for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$file" ]] || continue

  version="$(basename "$file")"

  applied="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc "select 1 from schema_migrations where version = '$version' limit 1")"

  if [[ "$applied" == "1" ]]; then
    echo "Skipping already-applied migration: $version"
    continue
  fi

  echo "Applying migration: $version"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "insert into schema_migrations(version) values ('$version')"
done

echo "Migrations complete."
