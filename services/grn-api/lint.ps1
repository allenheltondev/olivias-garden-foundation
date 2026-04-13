# Linting script for backend
# Run all linting checks in sequence

Write-Host "Running Rust linting checks..." -ForegroundColor Cyan

# Check formatting
Write-Host "`n1. Checking code formatting..." -ForegroundColor Yellow
cargo fmt --all -- --check
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Formatting check failed. Run 'cargo fmt --all' to fix." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Formatting check passed" -ForegroundColor Green

# Run clippy
Write-Host "`n2. Running clippy linter..." -ForegroundColor Yellow
cargo clippy --all-targets --all-features -- -D warnings
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Clippy found issues. See LINT_ISSUES.md for guidance." -ForegroundColor Red
    exit 1
}
Write-Host "✓ Clippy check passed" -ForegroundColor Green

# Run cargo check
Write-Host "`n3. Running cargo check..." -ForegroundColor Yellow
cargo check --all-targets --all-features
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Cargo check failed" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Cargo check passed" -ForegroundColor Green

Write-Host "`n✓ All linting checks passed!" -ForegroundColor Green
