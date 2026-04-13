---
inclusion: fileMatch
fileMatchPattern: "{**/auth/**,**/authorization/**,**/cognito/**,**/*auth*.{rs,mjs,ts}}"
---

# Authentication and Entitlements Model

## Design Philosophy

Design the system to support member tiers from day one, even if pro features are defined later.

## Entitlements Approach

* Treat access control as **entitlements**, not hard-coded feature flags
* The backend should be able to answer: "Does this principal have entitlement X in context Y?"
* Source of truth for entitlements is the authenticated principal identity
* Entitlements are attached to the user and optionally scoped to an organization

## JWT Claims and Propagation

* Propagate entitlements to the API layer via JWT claims so authorization checks are fast and consistent
* Use Cognito groups or a custom claim to represent **tier**
* Optionally include a compact `entitlements` list in the JWT for fine-grained access

## Tier Labels

Prefer a small, stable set of tier labels plus a flexible list of feature entitlements:
* `free`
* `supporter`
* `pro`

## Implementation Baseline

### Cognito Configuration
* Use Cognito groups or a custom claim to represent tier
* Optionally include a compact `entitlements` list in the JWT for fine-grained access

### Rust API
* The Rust API must include a single authorization module that evaluates required entitlements per route
* Authorization checks read from JWT claims
* Return 403 Forbidden when entitlements are insufficient

### Node.js Workers
* Workers should treat entitlements as input context when generating derived outputs
* Workers must not grant entitlements
* Workers can read user tier/entitlements from event context or query from core table

## Evolution Path

When payments/subscriptions are introduced:
* A billing system can update Cognito group membership and/or a tier claim
* The rest of the system should not need to change
* Entitlement checks remain the same
* New entitlements can be added without code changes to authorization logic

## Security Boundaries

* API authorizes via Cognito JWT
* Validate JWT signature and expiration
* Check required entitlements before processing requests
* Log authorization failures for security monitoring
