# Olivia's Garden Foundation Platform

This repository is the working monorepo for the Olivia's Garden Foundation platform.

Today it contains:
- `apps/grn`: the Good Roots Network frontend
- `services/grn-api`: the Good Roots Network Rust API and Node workers
- `apps/web`: the foundation website and public Okra experience
- `packages/ui`: shared UI primitives and brand tokens
- `packages/auth`: shared frontend auth helpers

The long-term platform plan lives in [docs/plans/platform_plan.md](docs/plans/platform_plan.md).

## Repository Layout

```text
.
|-- apps/
|   |-- grn/                  # Good Roots Network frontend (React + Vite)
|   `-- web/                  # Foundation website and public Okra experience
|-- services/
|   `-- grn-api/              # Rust API, SAM template, Node workers, DB migrations
|-- packages/
|   |-- auth/                 # Shared auth utilities
|   `-- ui/                   # Shared UI package
|-- docs/
|   |-- plans/                # Platform planning docs
|   |-- setup/                # Deployment and environment setup guides
|   |-- testing/              # Postman and CI rollout docs
|   `-- ...                   # Domain-specific implementation notes
|-- postman/                  # API contract and E2E collections
|-- scripts/                  # Deployment and data pipeline scripts
|-- data/                     # Seed and generated data artifacts
|-- config/                   # Configuration source files
`-- .kiro/steering/           # Product and engineering steering docs
```

## Current Focus

The repo is in an active restructuring phase:
- Good Roots has been moved into the monorepo layout
- the foundation site now carries the public Okra experience
- shared packages are being established before broader Phase 1 product work

The current architectural and product guidance, in priority order, is:
1. [product-vision.md](.kiro/steering/product-vision.md)
2. [architecture.md](.kiro/steering/architecture.md)
3. [auth-entitlements.md](.kiro/steering/auth-entitlements.md)
4. [frontend-standards.md](.kiro/steering/frontend-standards.md)
5. [rust-standards.md](.kiro/steering/rust-standards.md)

## Workspace Commands

From the repo root:

```bash
npm install
npm run build
npm run lint
npm run test
```

Useful targeted commands:

```bash
# Foundation website and public Okra experience
cd apps/web
npm run dev

# Good Roots frontend
cd apps/grn
npm run dev
npm test

# Good Roots API workers
cd services/grn-api
npm test

# Good Roots Rust API checks
cd services/grn-api
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```

## Deployment and Setup

- Deployment guide: [docs/setup/DEPLOYMENT.md](docs/setup/DEPLOYMENT.md)
- Neon/Postgres setup: [docs/setup/NEON_SETUP.md](docs/setup/NEON_SETUP.md)
- Root deployment helper: `npm run deploy:configure`
- Foundation web shared infrastructure: [infra/foundation-web/template.yaml](infra/foundation-web/template.yaml)

## Testing

This repo treats API compatibility seriously.

- Frontend tests live primarily in `apps/grn`
- backend Rust tests live in `services/grn-api/tests`
- backend worker tests live in `services/grn-api/functions/tests`
- Postman collections live in [postman](postman)

If you change or add API endpoints, update the matching Postman coverage.

For rollout details and CI mapping, see [docs/testing/postman-e2e-rollout.md](docs/testing/postman-e2e-rollout.md).

## Supporting Docs

- Platform plan: [docs/plans/platform_plan.md](docs/plans/platform_plan.md)
- Roadmap: [.kiro/steering/roadmap.md](.kiro/steering/roadmap.md)
- Data model notes: [docs/data-model.md](docs/data-model.md)
- Derived signals notes: [docs/derived-supply-signals.md](docs/derived-supply-signals.md)
- Entitlements contract: [docs/api/entitlements-contract.md](docs/api/entitlements-contract.md)

## Notes

- `services/grn-api` remains under `services/` intentionally. The frontend belongs in `apps/`; the backend is treated as a service boundary.
- `apps/web` is now the main public foundation surface, including the Okra experience.
- `apps/web` now has a dedicated static-hosting deploy path through `infra/foundation-web` and the `Foundation Web` GitHub Actions workflows.
- Some deeper docs still use older product naming such as `grn`; those should be normalized over time where helpful, but the repo structure is now current.
