#!/bin/bash
# Linting script for backend
# Run all linting checks in sequence

set -e

echo "Running Rust linting checks..."

# Check formatting
echo ""
echo "1. Checking code formatting..."
cargo fmt --all -- --check
echo "✓ Formatting check passed"

# Run clippy
echo ""
echo "2. Running clippy linter..."
cargo clippy --all-targets --all-features -- -D warnings
echo "✓ Clippy check passed"

# Run cargo check
echo ""
echo "3. Running cargo check..."
cargo check --all-targets --all-features
echo "✓ Cargo check passed"

echo ""
echo "✓ All linting checks passed!"
