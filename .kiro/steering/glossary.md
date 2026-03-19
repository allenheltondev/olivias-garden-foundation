---
inclusion: auto
description: Definitions of technical and domain terms used across the community food coordination platform codebase.
---

# Glossary – Community Food Coordination Platform

## Technical Terms

**Agentic IDE**
An AI-powered development environment that can autonomously perform development tasks based on steering documents and user intent.

**Monolambda**
A single AWS Lambda function that handles multiple API routes, as opposed to deploying separate Lambda functions per endpoint. Reduces cold start overhead and simplifies deployment.

**Geohash**
A geocoding system that encodes geographic coordinates (latitude/longitude) into short alphanumeric strings. Nearby locations share common prefixes, making it efficient for proximity queries. Example: `9q8yy` represents a region in San Francisco.

**Geohash Precision Levels**
- Precision 4: ~20km x 20km
- Precision 5: ~5km x 5km
- Precision 6: ~1.2km x 600m
- Precision 7: ~150m x 150m

**Single-Table Design**
A DynamoDB pattern where multiple entity types are stored in one table using composite keys (PK/SK) and GSIs for access patterns, rather than creating separate tables per entity.

**Derived Data**
Computed or aggregated data generated from core transactional records. Can be regenerated from source events if lost. Stored separately from core data.

**Event Envelope**
A standardized wrapper structure for domain events that includes metadata like correlation IDs, timestamps, event type, and payload.

**Idempotency**
The property that an operation can be applied multiple times without changing the result beyond the initial application. Critical for handling retries and replays safely.

**PWA (Progressive Web App)**
A web application that can be installed on devices and works offline, providing an app-like experience while being delivered via the web.

**Lambda Powertools**
AWS-provided libraries that standardize structured logging, tracing, metrics, and other Lambda best practices.

## Domain Terms

**Grower**
A user who produces food surplus - includes home gardeners, homesteaders, small farms, and community gardens.

**Searcher**
A user seeking available food - includes families, food banks, community kitchens, schools, and mutual aid organizations.

**Listing**
A declaration of available or upcoming food surplus with time window and location.

**Request**
A searcher's expression of interest in specific items and quantities.

**Commitment**
A coordination agreement between a grower and searcher for food pickup.

**Community Context**
The localized geographic area and participant group relevant to a user, defined implicitly through proximity rather than explicit membership.

**Entitlement**
A fine-grained permission or feature access right attached to a user, used for authorization decisions.
