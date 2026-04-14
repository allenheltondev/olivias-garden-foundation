# Okra

A simple, maintainable web app for Olivia's Garden Foundation to show where Clemson Spineless Okra seeds are being grown around the world.

## Goals (MVP)

- Public submission form for growers to share:
  - relative location (map pin)
  - at least one photo (required)
  - optional name and story
  - optional email for a secure edit link
- Admin review queue to approve or deny submissions.
- Public world map showing **approved** submissions only.
- Clickable pins that show photos and optional details.

## Non-goals (MVP)

- No advanced alerting/monitoring workflows.
- No complex role systems.
- No heavy analytics stack.

## Tech Stack (AWS, Node.js 24)

- **Frontend:** Vite + React (static build)
- **Hosting:** S3 + CloudFront
- **API:** API Gateway HTTP API + Lambda (Node.js 24)
- **Database:** PostgreSQL (Neon)
- **Auth:** Cognito (optional for non-admin in later phase; admin-ready)
- **Storage:** S3 for image originals + normalized derivatives
- **Image Processing:** Lambda (Node.js 24 + sharp)

## Engineering Baseline (match Good Roots Network style)

- Use **AWS SAM** templates for backend/API/image-processor infrastructure.
- Use **esbuild** for Lambda bundling.
- Include **linting + unit tests** from day one.
- Keep one-repo, one-person-operable workflows (minimal moving parts).
- Prefer explicit env/config outputs over hidden/manual config.

## Cognito Reuse Strategy

- Reuse the **existing Good Roots Network Cognito User Pool** where applicable.
- Infrastructure should support either:
  - importing pool/client IDs as parameters, or
  - reading them from stack exports/SSM parameters.
- For MVP, admin access should work with shared user pool claims/groups.

## Monorepo Layout

- `apps/okra/` - Vite + React app
- `services/okra-api/` - Lambda handlers, SAM template, tests, and DB scripts
- `services/okra-api/db/ddl.sql` - PostgreSQL schema reference for MVP
- `services/okra-api/db/migrations/` - ordered SQL migrations applied by the Okra backend migration runner
- `docs/okra/issues.md` - dependency-ordered issue plan

## Quick Start

```bash
npm install
npm run lint
npm run test
```

### Database migration + seed (PostgreSQL / Neon)

Migrations and seeding now use a standard PostgreSQL connection string.

Use these environment variables locally:

```bash
cd services/okra-api
set DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
npm run db:migrate
npm run db:seed
```

In this monorepo, Okra CI should be wired through the top-level GitHub workflows rather than a nested copied workflow set.

Backend local invoke example:

```bash
cd services/okra-api
sam build
sam local invoke HealthFunction
```

Deploy stack (creates API + frontend/media buckets + CloudFront):

```bash
cd services/okra-api
sam deploy --guided
```

Okra deployment integration should be folded into the monorepo workflow set rather than using copied nested workflow files.

## Runtime Baseline

- Node.js: **24.x** for all Lambda functions and tooling.
- Keep architecture boring and solo-maintainable.
- Default backend toolchain: SAM + esbuild + eslint + unit tests.
