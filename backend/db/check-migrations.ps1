# Check which migrations have been applied to the database
# Usage: .\check-migrations.ps1 [DatabaseUrl]
# Example: .\check-migrations.ps1 "postgres://user:pass@host/db"
# Or use environment variable: $env:DATABASE_URL = "postgres://user:pass@host/db"; .\check-migrations.ps1

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
    Write-Error "DATABASE_URL must be provided as a parameter or environment variable.`nUsage: .\check-migrations.ps1 'postgres://user:pass@host/db'`nOr: `$env:DATABASE_URL = 'postgres://user:pass@host/db'"
    exit 1
}

Write-Host "Checking applied migrations...`n"

# Check if schema_migrations table exists
$tableCheck = psql $dbUrl -tAc "SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations'" 2>$null

if ($tableCheck -ne "1") {
    Write-Host "schema_migrations table does not exist yet."
    Write-Host "Run .\migrate.ps1 to initialize and apply migrations."
    exit 1
}

# Show applied migrations
psql $dbUrl -c "SELECT version, applied_at FROM schema_migrations ORDER BY version"

Write-Host "`nPending migrations:"

$migrationsDir = Join-Path $PSScriptRoot "migrations"
$hasPending = $false

Get-ChildItem -Path $migrationsDir -Filter "*.sql" | Where-Object { $_.Name -notlike "test_*" } | ForEach-Object {
    $version = $_.Name
    $applied = psql $dbUrl -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version' LIMIT 1" 2>$null
    
    if ($applied -ne "1") {
        Write-Host "  - $version (NOT APPLIED)" -ForegroundColor Yellow
        $hasPending = $true
    }
}

if (-not $hasPending) {
    Write-Host "  (none)" -ForegroundColor Green
}

Write-Host "`nTo apply pending migrations, run: .\migrate.ps1"
