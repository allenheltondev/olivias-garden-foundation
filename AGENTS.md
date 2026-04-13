# AGENTS.md

This file guides coding agents to make consistent development decisions in this repository.

## Source of truth

When in doubt, follow these documents in order:
1. `.kiro/steering/product-vision.md`
2. `.kiro/steering/architecture.md`
3. `.kiro/steering/auth-entitlements.md`
4. `.kiro/steering/frontend-standards.md`
5. `.kiro/steering/rust-standards.md`

If guidance conflicts, prefer the more specific document for the file you are changing.

## Decision heuristics

### 1) Preserve architecture boundaries
- Frontend is a PWA client only.
- Rust API owns synchronous transactional writes and reads.
- Workers own async/derived processing and AI output generation.
- AI outputs must only write derived data, never core transactional records.

### 2) Choose the smallest change that fits the phase
- Favor incremental, testable steps over broad refactors.
- Keep changes aligned to roadmap phase goals.
- Avoid introducing speculative abstractions.

### 3) Keep API contracts stable
- Prefer explicit REST endpoints with consistent payloads and status codes.
- Do not break existing request/response shapes without migration notes.
- Prefer adding fields over changing semantics of existing fields.

### 4) Enforce idempotency and replay safety
- Write paths must be idempotent.
- Use conditional writes and deterministic keys where applicable.
- Event handlers and derived pipelines must tolerate retries and replay.

### 5) Correlation ID and observability are mandatory
- Propagate correlation IDs end-to-end.
- Keep logs structured and actionable.
- Log at appropriate levels; avoid noisy logs.

## Branching and PR policy

When working on an issue:
- Never push issue implementation work directly to `main`.
- Create a new branch from latest `main`.
- Keep commits scoped to the issue.
- Open a PR when work is complete and checks are green.
- Merge only through PR flow.
- Never merge a PR into `main` without explicit approval for that specific PR.

## Frontend standards (TypeScript/PWA)

- Default to mobile-first UX and low-friction flows.
- Handle loading, error, empty, and offline states explicitly.
- Use semantic HTML and accessible interactions.
- Keep bundle impact in mind; lazy-load non-critical UI.
- Include component tests for behavior changes and critical path tests where needed.

### Frontend decision rules
- If backend API is missing for a UI requirement, create/track backend dependency first.
- Keep API integration concerns isolated (services/hooks) from presentational components.
- Prefer clear, human language in UX copy over system jargon.

## Backend standards (Rust API)

- Centralize authorization checks in one module.
- Read tier/entitlements from JWT claims; return 403 for insufficient access.
- Keep handlers thin: validate -> authorize -> execute use-case -> emit event.
- Use consistent error shapes and status codes.
- Emit domain events only after successful state changes.

### Backend decision rules
- Validate inputs early and fail fast.
- Prefer deterministic access patterns aligned with current table design.
- Add/adjust tests next to changed code.

## Auth and entitlement model

- Treat access control as entitlements, not ad-hoc feature flags.
- Never grant entitlements from workers.
- Keep tier labels stable (`free`, `supporter`, `pro`) unless explicitly changed.

## Data and eventing rules

- Core table stores transactional truth.
- Derived table stores computed/AI outputs and should use TTL where appropriate.
- Events are immutable facts; do not encode mutable state snapshots as source of truth.

## Testing expectations

- Add tests for behavior changes, not just happy paths.
- Prioritize tests for auth, validation, idempotency, and state transitions.
- For frontend, cover critical grower/searcher paths with focused tests.

### API testing is mandatory for backward compatibility

**Critical: API tests are how we ensure backward compatibility.**

When changing or adding API endpoints:
- **Always** add or update Postman tests in the `postman/` folder
- Add assertions to existing end-to-end test collections when applicable
- Create new test requests for new endpoints
- Validate response schemas, status codes, and error cases
- Test both success and failure paths

Postman tests can be run locally before pushing:
```bash
# Run Postman collections locally (if newman is installed)
newman run postman/collections/<collection-name>
```

API contract changes without corresponding Postman tests will be rejected.

### Postman E2E CI rollout

The full phased rollout plan, collection-to-job mapping, required secrets, gating policy, and flake mitigation notes live in [docs/testing/postman-e2e-rollout.md](docs/testing/postman-e2e-rollout.md). Consult that document when adding or modifying Postman CI jobs.

CI phases in brief:
1. **Public smoke** â€” unauthenticated 401 check (blocking, every PR)
2. **Contract tests** â€” Good Roots Network API collection (blocking, every PR)
3. **Utility tests** â€” Good Roots Network API - Utility Tests collection (blocking, every PR)
4. **E2E flows** â€” Good Roots Network API - E2E Flows collection (blocking, every PR)
5. **Onboarding flow** â€” E2E - Search veggie and add to garden (non-blocking, nightly â€” not yet wired)

## Non-goals guardrails

- Do not optimize for competitive metrics (leaderboards, production competition).
- Do not add AI features that mutate transactional workflows.
- Do not over-engineer for scale before reliability basics are covered.

## Required pre-PR quality gates

Before submitting any PR, all of the following must pass:
- Frontend unit tests
- Backend unit tests
- Frontend linting
- Backend linting
- Backend formatting check (`fmt`)
- Postman API tests (if API endpoints were changed/added)

If any required check cannot be run in the current environment, explicitly state that blocker in the PR description and ask for guidance before merging.

## Post-PR workflow failure policy

If a PR is opened and any workflow fails:
- Immediately inspect failed jobs/logs and identify the root cause.
- Implement and push a fix without waiting for manual follow-up.
- Re-run the relevant local checks before pushing when possible.
- Repeat until workflows pass or a hard external blocker is confirmed.
- If blocked by external factors (service outage, missing secret, permission), document the blocker clearly in the PR with next actions.

## Pull request checklist for agents

Before finishing, confirm:
- Change matches current roadmap phase intent.
- API and auth behavior remain consistent and explicit.
- Correlation IDs/logging are preserved.
- Idempotency/replay behavior is not regressed.
- Tests were added/updated for impacted behavior.
- Required pre-PR quality gates are passing.
- Work was done on a feature branch (not `main`) and submitted via PR.
- Documentation or issue dependencies were updated if scope changed.
- Any post-PR workflow failures were diagnosed and fixed, or explicitly documented if externally blocked.


**After all checks pass, automatically open a PR using `gh pr create`.**
