# Apply database migrations
# Usage: .\migrate.ps1 [DatabaseUrl]
# Example: .\migrate.ps1 "postgres://user:pass@host/db"
# Or use environment variable: $env:DATABASE_URL = "postgres://user:pass@host/db"; .\migrate.ps1

param(
    [string]$DatabaseUrl
)

$ErrorActionPreference = "Stop"

# Check if psql is available
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Error "psql is required. Install PostgreSQL client tools from https://www.postgresql.org/download/windows/"
    exit 1
}

# Use provided URL or fall back to environment variable
if ($DatabaseUrl) {
    $dbUrl = $DatabaseUrl
} elseif ($env:DATABASE_URL) {
    $dbUrl = $env:DATABASE_URL
} else {
    Write-Error "DATABASE_URL must be provided as a parameter or environment variable.`nUsage: .\migrate.ps1 'postgres://user:pass@host/db'`nOr: `$env:DATABASE_URL = 'postgres://user:pass@host/db'"
    exit 1
}

$migrationsDir = Join-Path $PSScriptRoot "migrations"

# Create schema_migrations table if it doesn't exist
Write-Host "Initializing schema_migrations table..."
$createTableSQL = @"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"@

psql $dbUrl -v ON_ERROR_STOP=1 -c $createTableSQL

# Apply migrations
Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Where-Object { $_.Name -notlike "test_*" } | Sort-Object Name | ForEach-Object {
    $version = $_.Name
    $filePath = $_.FullName
    
    # Check if already applied
    $applied = psql $dbUrl -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version' LIMIT 1"
    
    if ($applied -eq "1") {
        Write-Host "Skipping already-applied migration: $version" -ForegroundColor Gray
    } else {
        Write-Host "Applying migration: $version" -ForegroundColor Cyan
        psql $dbUrl -v ON_ERROR_STOP=1 -f $filePath
        psql $dbUrl -v ON_ERROR_STOP=1 -c "INSERT INTO schema_migrations(version) VALUES ('$version')"
        Write-Host "  ✓ Applied successfully" -ForegroundColor Green
    }
}

Write-Host "`nMigrations complete." -ForegroundColor Green
