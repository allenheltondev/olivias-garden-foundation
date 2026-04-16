# Scripts

This directory contains real, supported repository scripts.

## Deploy

### `deploy-and-configure.mjs`

Builds and deploys the GRN API stack, reads CloudFormation outputs, and writes `apps/grn/.env`.

Use it from the repo root:

```bash
npm run deploy:configure
npm run deploy:configure -- --profile sandbox
npm run deploy:configure -- --config-only --stack-name ogf-grn-staging
```

For full deployment details, see [docs/setup/DEPLOYMENT.md](../docs/setup/DEPLOYMENT.md).

### `configure-foundation-web.mjs`

Deploys the default local dev foundation, GRN, and okra stacks, then writes `apps/web/.env.local`.

Use it from the repo root:

```bash
npm run web:configure
npm run web:configure -- --profile sandbox
npm run web:configure -- --config-only --environment dev
```

Defaults:
- foundation stack: `ogf-web-dev`
- GRN stack: `ogf-grn-dev`
- okra stack: `ogf-okra-dev`

The script also tries to reuse existing local database configuration:
- `GRN_DATABASE_URL`, then `DATABASE_URL`, then `services/grn-api/samconfig.toml`
- `OKRA_DATABASE_URL`, then `DATABASE_URL`, then `services/okra-api/samconfig.toml`, then the GRN URL

Optional foundation signup notifications:
- `FOUNDATION_SIGNUP_SLACK_WEBHOOK_URL`, then `SIGNUP_SLACK_WEBHOOK_URL`

## Catalog

### `catalog/`

The `catalog` folder contains the crop catalog pipeline and its tests.

Useful commands:

```bash
cd scripts/catalog
npm install
npm test
npm run benchmark:400
```

The catalog pipeline uses:
- source files in `scripts/catalog`
- supporting source data in `lib/` and `data/catalog/`
- generated artifacts under `data/catalog/`

## Scope

This README intentionally documents only scripts that exist in the repository today.

Removed from this document:
- references to `update-frontend-config.*`
- references to `ci-deploy.sh`

Those scripts are not present in the repo and are not part of the supported workflow.
