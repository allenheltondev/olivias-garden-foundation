---
inclusion: fileMatch
fileMatchPattern: "{backend/**,infra/**,services/**,**/*.yaml,**/*.yml}"
---

# Architecture – Community Food Coordination Platform

## High-Level Architecture (AWS)

* **Frontend**: S3 + CloudFront hosting a static web app and PWA assets
* **Auth**: Cognito user pool issuing JWTs
* **Sync API**: API Gateway HTTP API -> Rust Lambda (monolambda)
* **Data**: DynamoDB core table for transactional data; DynamoDB derived table for aggregates and AI outputs
* **Events**: EventBridge for domain events emitted by the API
* **Async workers**: Node.js Lambdas subscribed via EventBridge rules
* **AI**: Amazon Bedrock invoked only from workers; outputs stored in derived table
* **Notifications**: Modeled as events and deferred; SNS or other notification delivery can be added later

## Data Model Baseline

### Two-Table Design

**Core table (`core`):**

Stores all transactional data using single-table design patterns.

Entity types:
* **Users**: User profiles, preferences, contact info
  - PK: `USER#<user_id>`
  - SK: `PROFILE`
* **Organizations**: Community gardens, food banks, etc.
  - PK: `ORG#<org_id>`
  - SK: `METADATA`
* **Listings**: Available surplus declarations
  - PK: `USER#<user_id>`
  - SK: `LISTING#<listing_id>`
  - GSI1: PK: `GEOHASH#<geohash>`, SK: `LISTING#<timestamp>`
* **Requests**: Searcher requests for food
  - PK: `USER#<user_id>`
  - SK: `REQUEST#<request_id>`
  - GSI1: PK: `GEOHASH#<geohash>`, SK: `REQUEST#<timestamp>`
* **Commitments**: Coordination state between growers and searchers
  - PK: `LISTING#<listing_id>`
  - SK: `COMMITMENT#<commitment_id>`

**Derived table (`derived`):**

Stores computed aggregates and AI outputs. All entries should have TTL.

* **Supply/demand aggregates**: Rolling windows (7d, 14d, 30d) by geohash
  - PK: `GEOHASH#<geohash>`
  - SK: `AGGREGATE#<window>#<timestamp>`
* **Insight signals**: Community-level imbalance indicators
  - PK: `GEOHASH#<geohash>`
  - SK: `INSIGHT#<timestamp>`
* **AI summaries**: Cached Bedrock outputs with explanations
  - PK: `GEOHASH#<geohash>`
  - SK: `AI_SUMMARY#<context>#<timestamp>`
  - TTL: Set appropriately for cache expiration

## Community Context and Geo

* Use geohash buckets as the core geographic index
* Every listing/request writes into one or more geohash precisions
* Queries start at a target precision and may expand radius when density is low

## Domain Events

Core write operations emit domain events to EventBridge:

* `listing.created`, `listing.updated`, `listing.expired`
* `request.created`, `request.updated`
* `commitment.created`, `commitment.updated`
* `insight.requested`, `insight.generated`
* `notification.requested`

## Derived Pipelines

* **Aggregation worker**: Updates rolling windows such as 7, 14, and 30 days
* **Insight worker**: Produces community-level imbalance signals and summary text
* **AI worker**: Generates explanations and optional grower guidance, then caches results

## Security Boundaries

* API authorizes via Cognito JWT
* Workers have least privilege access to DynamoDB and Bedrock
* AI writes only to derived data

## Repository Structure

Single repository with clear boundaries:

* `apps/web` - PWA frontend
* `services/api` - Rust monolambda
* `services/workers` - Node.js async/event handlers
* `infra` - IaC
* `docs/steering` - Steering docs

## API Style

* REST over HTTP API Gateway
* Keep the public API stable and explicit
* Prefer a small number of higher-value endpoints (feeds and summaries) over many chatty endpoints

## Idempotency and Determinism

* All write endpoints must be idempotent using client-generated IDs where appropriate
* Event handlers must be idempotent and safe to replay
* Derived views must be reproducible from core events
