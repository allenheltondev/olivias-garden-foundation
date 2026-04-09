# Postman E2E Rollout Plan

Phased CI rollout for Postman/Newman E2E automation. Each phase adds coverage incrementally, gated on the previous phase passing.

> **Current state**: Phases 1–5 are already implemented in `pr-checks.yml` and run on every PR against the shared staging stack. This document formalizes the rollout, defines the gating policy, and captures flake-mitigation notes for ongoing maintenance.

---

## Phase Overview

| # | Phase | Collection / Folder | CI Job | Cadence | Auth Required | Gating |
|---|-------|-------------------|--------|---------|---------------|--------|
| 1 | Public smoke | `curl` (inline) | `staging-public-api-smoke` | Every PR | No | Blocking |
| 2 | Contract tests | `Community Garden API` | `contract-api-tests` | Every PR | Yes (free + premium) | Blocking |
| 3 | Utility / negative-path tests | `Community Garden API - Utility Tests` | `utility-api-tests` | Every PR | Yes (free + premium + gatherer) | Blocking |
| 4 | E2E multi-step flows | `Community Garden API - E2E Flows` | `e2e-api-tests` | Every PR | Yes (premium grower + gatherer) | Blocking |
| 5 | Onboarding flow | `E2E - Search veggie and add to garden` | *(not yet wired)* | Nightly | Yes (grower) | Non-blocking |

---

## Phase 1: Public Smoke

**What it tests**: Unauthenticated request to `/catalog/crops` returns `401`.

**Implementation**: Inline `curl` assertion in `staging-public-api-smoke` job. No Postman collection needed.

**Env / Secrets**: None beyond `api-url` from the staging deploy output.

**Gating**: Blocking — all subsequent phases depend on this passing.

---

## Phase 2: Contract API Tests

**What it tests**: Happy-path contract coverage for all API feature areas — Catalog, Crop Library, Listings, Claims, Requests, Reminders, Feed, Billing, Analytics, AI Features, User Management, Profile Smoke.

**Collection**: `postman/collections/Community Garden API`

**CI Job**: `contract-api-tests`

**Runs**:
1. Full collection with premium-tier token (expects success).
2. `AI Features` subfolder with free-tier token (expects `403 feature_locked`).
3. `Billing Webhook Reliability` subfolder (optional — skipped when `STRIPE_WEBHOOK_SECRET` is not set).

**Env vars injected at runtime**:

| Variable | Source |
|----------|--------|
| `baseUrl` | `deploy-staging-backend.outputs.api-url` |
| `authToken` | CI auth seed → `contract-grower-premium` |
| `expectFeatureLocked` | `false` (premium run) / `true` (free run) |
| `freeAuthToken` | CI auth seed → `contract-grower-free` |
| `stripeWebhookSecret` | `secrets.STRIPE_WEBHOOK_SECRET` (optional) |

**Gating**: Blocking.

---

## Phase 3: Utility / Negative-Path Tests

**What it tests**: Infrastructure-level correctness — 404 coverage, 409 conflict detection, correlation ID propagation, entitlement matrix (free vs premium), idempotency, negative input validation, pagination boundaries.

**Collection**: `postman/collections/Community Garden API - Utility Tests`

**CI Job**: `utility-api-tests`

**Env vars injected at runtime**:

| Variable | Source |
|----------|--------|
| `baseUrl` | `deploy-staging-backend.outputs.api-url` |
| `authToken` | CI auth seed → `util-grower-premium` |
| `premiumAuthToken` | CI auth seed → `util-grower-premium` |
| `freeAuthToken` | CI auth seed → `util-grower-free` |
| `gathererAuthToken` | CI auth seed → `util-gatherer` |

**Gating**: Blocking.

---

## Phase 4: E2E Multi-Step Flows

**What it tests**: Stateful, ordered, cross-user business workflows — Claim Lifecycle state transitions, Listing-to-Claim grower→gatherer flow, Gatherer Persona coverage, Cross-Endpoint Consistency checks.

**Collection**: `postman/collections/Community Garden API - E2E Flows`

**CI Job**: `e2e-api-tests`

**Env vars injected at runtime**:

| Variable | Source |
|----------|--------|
| `baseUrl` | `deploy-staging-backend.outputs.api-url` |
| `authToken` | CI auth seed → `e2e-grower-premium` |
| `growerAuthToken` | CI auth seed → `e2e-grower-premium` |
| `gathererAuthToken` | CI auth seed → `e2e-gatherer` |

**Gating**: Blocking.

---

## Phase 5: Onboarding Flow (Future — Nightly)

**What it tests**: Full grower onboarding — initialize user type, verify onboarding gate, search catalog, add crop to library, verify consistency, cleanup.

**Collection**: `postman/collections/E2E - Search veggie and add to garden`

**CI Job**: Not yet wired. Target: nightly scheduled workflow.

**Env vars needed**:

| Variable | Source |
|----------|--------|
| `baseUrl` | Stable staging API URL |
| `authToken` | CI auth seed → grower token |

**Gating**: Non-blocking (advisory). Failures create an issue but do not block PRs.

---

## Required Secrets and Variables

All secrets are configured in GitHub repository settings → Secrets and variables → Actions.

| Secret | Used By | Required |
|--------|---------|----------|
| `AWS_STAGING_ROLE_ARN` | All phases (staging deploy + Lambda invoke) | Yes |
| `POSTMAN_API_KEY` | Phases 2–5 (Postman CLI login) | Yes |
| `STRIPE_WEBHOOK_SECRET` | Phase 2 billing webhook subfolder | Optional |

| Runtime Variable | Source | Used By |
|-----------------|--------|---------|
| `api-url` | CloudFormation stack output | All phases |
| `ci-auth-seed-users-function` | CloudFormation stack output | Phases 2–4 |

Token generation uses the `CiAuthSeedUsersFunction` Lambda, which creates ephemeral Cognito users with specified roles and tiers, returning short-lived access tokens.

---

## CI Gating Strategy

```
staging-public-api-smoke (Phase 1)
    ├── contract-api-tests (Phase 2)     ─┐
    ├── utility-api-tests (Phase 3)       ├── staging-validation-summary
    └── e2e-api-tests (Phase 4)          ─┘
```

- Phases 2–4 run in parallel after Phase 1 passes.
- `staging-validation-summary` aggregates results — PR mergeability requires all four phases green.
- Phase 5 (nightly) is independent and non-blocking.

### Pass/fail rules

| Scenario | Action |
|----------|--------|
| Phase 1 fails | All downstream phases skipped. PR blocked. |
| Any of Phases 2–4 fails | `staging-validation-summary` fails. PR blocked. |
| Phase 5 nightly fails | GitHub issue auto-created. No PR impact. |
| Billing webhook tests skipped (no secret) | Phase 2 still passes. Logged as info. |

---

## Flake Mitigation

| Risk | Mitigation |
|------|-----------|
| Token expiry during long test runs | CI auth seed generates fresh tokens per job; tokens are short-lived but sufficient for a single collection run. |
| Staging stack not ready | Phase 1 smoke acts as a readiness gate — downstream phases only run after it passes. |
| Shared state between parallel jobs | Each phase uses distinct CI auth seed user names (`contract-*`, `util-*`, `e2e-*`) to avoid cross-job data collisions. |
| Catalog crop ID drift | Collections use `defaultCatalogCropId` as a stable fallback when chaining hasn't populated `catalogCropId`. |
| Eventual consistency on DynamoDB | E2E flows use ordered steps with variable chaining; add short polling retries in pre-request scripts if needed. |
| Postman CLI network issues | Retry at the GitHub Actions step level (`continue-on-error` + re-run) if transient failures appear. |
| Stripe webhook secret not configured | Billing webhook reliability tests gracefully skip with an info log. |

---

## Collection → CI Job → Cadence Mapping

| Collection Path | CI Job Name | Cadence | Tokens Used |
|----------------|-------------|---------|-------------|
| *(inline curl)* | `staging-public-api-smoke` | Every PR | None |
| `Community Garden API` | `contract-api-tests` | Every PR | free-grower, premium-grower |
| `Community Garden API/AI Features` | `contract-api-tests` (free run) | Every PR | free-grower |
| `Community Garden API/Billing Webhook Reliability` | `contract-api-tests` (webhook run) | Every PR | None (webhook secret) |
| `Community Garden API - Utility Tests` | `utility-api-tests` | Every PR | free-grower, premium-grower, gatherer |
| `Community Garden API - E2E Flows` | `e2e-api-tests` | Every PR | premium-grower, gatherer |
| `E2E - Search veggie and add to garden` | *(future nightly)* | Nightly | grower |
