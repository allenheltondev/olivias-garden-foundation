#!/usr/bin/env bash
# Check which migrations have been applied to the database
# Usage: ./check-migrations.sh [database_url]
# Example: ./check-migrations.sh "postgres://user:pass@host/db"
# Or use environment variable: export DATABASE_URL="postgres://user:pass@host/db"; ./check-migrations.sh

set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required. Install PostgreSQL client tools." >&2
  exit 1
fi

# Use provided URL or fall back to environment variable
if [[ -n "${1:-}" ]]; then
  DATABASE_URL="$1"
elif [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL must be provided as an argument or environment variable." >&2
  echo "Usage: ./check-migrations.sh 'postgres://user:pass@host/db'" >&2
  echo "Or: export DATABASE_URL='postgres://user:pass@host/db'" >&2
  exit 1
fi

echo "Checking applied migrations..."
echo ""

psql "$DATABASE_URL" -c "
  select version, applied_at 
  from schema_migrations 
  order by version
" 2>/dev/null || {
  echo "schema_migrations table does not exist yet."
  echo "Run ./migrate.sh to initialize and apply migrations."
  exit 1
}

echo ""
echo "Pending migrations:"
MIGRATIONS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/migrations" && pwd)"

for file in "$MIGRATIONS_DIR"/*.sql; do
  [[ -f "$file" ]] || continue
  
  # Skip test migrations
  basename_file="$(basename "$file")"
  if [[ "$basename_file" == test_* ]]; then
    continue
  fi

  version="$basename_file"
  applied="$(psql "$DATABASE_URL" -tAc "select 1 from schema_migrations where version = '$version' limit 1" 2>/dev/null || echo "")"

  if [[ "$applied" != "1" ]]; then
    echo "  - $version (NOT APPLIED)"
  fi
done

echo ""
echo "To apply pending migrations, run: ./migrate.sh"
