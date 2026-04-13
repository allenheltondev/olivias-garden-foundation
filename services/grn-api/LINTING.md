# Linting Guide for Backend

## Quick Commands

```bash
# Run clippy linter
cargo clippy --all-targets --all-features

# Run clippy with warnings as errors (CI mode)
cargo clippy --all-targets --all-features -- -D warnings

# Auto-fix clippy issues where possible
cargo clippy --all-targets --all-features --fix --allow-dirty --allow-staged

# Check code formatting
cargo fmt --all -- --check

# Apply code formatting
cargo fmt --all

# Run all checks (lint + format + build)
cargo check-all && cargo fmt-check && cargo lint
```

## Using Cargo Aliases

The `.cargo/config.toml` defines convenient aliases:

```bash
cargo lint          # Run clippy with warnings as errors
cargo lint-fix      # Auto-fix clippy issues
cargo fmt-check     # Check formatting without modifying files
cargo check-all     # Run cargo check on all targets
```

## Configuration Files

- `rustfmt.toml` - Code formatting rules
- `clippy.toml` - Clippy linter configuration
- `.cargo/config.toml` - Cargo aliases and build settings
- `Cargo.toml` - Workspace-level lint rules

## Lint Levels

The project enforces:

- **Forbid**: `unsafe_code` - No unsafe code allowed
- **Warn**: Pedantic and nursery clippy lints
- **Warn**: `unwrap_used`, `expect_used`, `panic`, `todo` - Prefer proper error handling

## Pre-commit Workflow

Before committing:

```bash
cargo fmt --all
cargo lint
cargo test
```

## CI Integration

Add to your CI pipeline:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```
