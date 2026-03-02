# AI Safety + Cost Guardrails (Premium)

This document defines baseline guardrails for premium AI features.

## Guardrails implemented

- Per-user daily request cap
- Per-user daily estimated token cap
- Structured logging of allow/deny decisions in DB
- 429 response for blocked premium copilot calls
- Soft-block for feed AI cards when caps are exceeded (degrades to deterministic UX)

## Environment variables

- `AI_MAX_DAILY_REQUESTS_PER_USER` (default: `30`)
- `AI_MAX_DAILY_TOKENS_PER_USER` (default: `60000`)
- `AI_DEFAULT_ESTIMATED_TOKENS` (default: `1200`)

## Data model

- `ai_usage_events`
  - user_id
  - feature_key
  - model_id
  - estimated_tokens
  - estimated_cost_usd
  - status (`allowed|blocked`)
  - reason

## Feature keys used

- `ai.copilot.weekly_grow_plan`
- `ai.feed_insights.read`

## Product behavior

- If premium copilot exceeds cap: return `429` with guardrail reason.
- If feed AI card exceeds cap: hide AI card and continue deterministic feed UX.
