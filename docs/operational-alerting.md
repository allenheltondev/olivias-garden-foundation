# Operational Dashboards & Alerts (Phase 5)

This document defines baseline production visibility for API + derived pipeline health.

## What is monitored

### API
- Lambda Errors (`AWS/Lambda`, `Errors`, `FunctionName=ApiFunction`)
- Lambda p95 Duration (`AWS/Lambda`, `Duration`, p95)
- Lambda Throttles (`AWS/Lambda`, `Throttles`)

### Rolling Aggregation Worker
- Invocations (`AWS/Lambda`, `Invocations`)
- Errors (`AWS/Lambda`, `Errors`)
- p95 Duration (`AWS/Lambda`, `Duration`, p95)
- Throttles (`AWS/Lambda`, `Throttles`)

### Derived Pipeline Freshness (App namespace)
Dashboard widget is provisioned for these app metrics:
- `CommunityGarden/Derived:ProcessingLagSeconds`
- `CommunityGarden/Derived:FreshnessAgeSeconds`
- `CommunityGarden/Derived:ReplayScopesProcessed`
- `CommunityGarden/Derived:ReplayFailures`

## Provisioned alarms

- `${stack}-api-errors`
  - Triggers when API errors >= 5 for 2 consecutive 1-minute periods.
- `${stack}-rolling-worker-errors`
  - Triggers when worker errors >= 2 for 2 consecutive 1-minute periods.
- `${stack}-rolling-worker-duration-p95`
  - Triggers when p95 worker duration > 10s in 2 of 3 five-minute periods.

## Response ownership

- Primary owner: GRN engineering on-call.
- Escalation owner: platform lead.

## Initial response expectations

1. Acknowledge alarm within 5 minutes.
2. Check dashboard for correlated spikes (errors, throttles, latency).
3. Verify derived freshness in app endpoints (`/feed/derived`).
4. If stale data risk is detected, consider rerunning the aggregation worker for affected scopes.
5. Document root cause + mitigation in incident notes.

## Notes

- Alert action targets (SNS, PagerDuty, Slack webhook) can be attached per environment.
- Thresholds are intentionally conservative for early production hardening and should be tuned with observed traffic.
