# Phase 6 Entitlements Matrix (v1)

This defines what is available in **free** vs **premium** and acts as the source of truth for backend/frontend gating.

Machine-readable source:
- `config/entitlements/v1.tiers.json`

Enforcement source of truth:
- Backend middleware (`backend/src/api/middleware/entitlements.rs`) loads this JSON directly at runtime so tier rules and API checks cannot drift.

## Tier matrix

| Capability | Entitlement Key | Free | Premium |
|---|---|---:|---:|
| Discover listings | `core.discovery` | ✅ | ✅ |
| Create/update listings | `core.listings.write` | ✅ | ✅ |
| Create/update requests | `core.requests.write` | ✅ | ✅ |
| Claims flow | `core.claims.write` | ✅ | ✅ |
| Derived feed (deterministic) | `core.derived_feed.read` | ✅ | ✅ |
| Scheduled reminders (deterministic) | `reminders.deterministic.schedule` | ✅ | ✅ |
| Manage reminders | `reminders.deterministic.manage` | ✅ | ✅ |
| AI copilot | `ai.copilot.weekly_grow_plan` | ❌ | ✅ |
| AI feed insight cards | `ai.feed_insights.read` | ❌ | ✅ |
| Agentic automations | `agent.tasks.automation` | ❌ | ✅ |
| Premium analytics | `premium.analytics.read` | ❌ | ✅ |

## Product policy rules

1. **AI is premium-only.**
2. **Free-tier reminders must be deterministic (non-LLM).**
3. Premium inherits all free entitlements.

## Versioning

- Version: `v1`
- Any entitlement key rename/removal requires a version bump and migration notes.
