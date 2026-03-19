# Phase 0: Foundations - Requirements

## Overview

Establish a deployable skeleton with authentication and observability that enables a user to sign in, retrieve their profile via an authenticated endpoint, and load the PWA on a phone.

## User Stories

### US-1: User Authentication
As a user, I want to sign in with my email and password so that I can access the platform securely.

### US-2: User Profile Retrieval
As an authenticated user, I want to retrieve my profile information so that I can verify my identity and see my account details.

### US-3: PWA Access
As a user, I want to load the web app on my phone so that I can access the platform from anywhere.

### US-4: Observability
As a developer, I want structured logging with correlation IDs so that I can trace requests through the system and debug issues.

## Acceptance Criteria

### 1.1 Cognito Authentication
- Cognito user pool is configured with email-based authentication
- User pool has three tier groups: neighbor-tier, supporter-tier, caretaker-tier
- JWT tokens include user tier information in claims
- Password policy enforces minimum security requirements

### 1.2 Lambda Authorizer
- Lambda authorizer validates JWT tokens from Cognito
- Authorizer extracts user tier from Cognito groups
- Authorizer passes userId, email, firstName, lastName, and tier to API via context
- OPTIONS requests bypass authentication for CORS preflight

### 1.3 GET /me Endpoint
- Endpoint requires authentication
- Returns authenticated user's profile including:
  - userId (from JWT sub claim)
  - email
  - firstName
  - lastName
  - tier (neighbor, supporter, or caretaker)
- Returns 401 if not authenticated
- Returns 200 with JSON profile on success

### 1.4 DynamoDB Tables
- Core table exists with pk/sk schema and TTL enabled
- Derived table exists with pk/sk schema and TTL enabled
- Both tables use PAY_PER_REQUEST billing mode
- Tables have appropriate encryption and retention policies

### 1.5 EventBridge Bus
- Custom EventBridge bus is created for domain events
- Event envelope structure is defined with:
  - eventType (e.g., "listing.created")
  - correlationId
  - timestamp
  - userId
  - payload (event-specific data)

### 1.6 Correlation ID Plumbing
- API accepts X-Correlation-Id header or generates one if not provided
- Correlation ID is included in all structured logs
- Correlation ID is passed to authorizer context
- Correlation ID is included in event payloads when events are emitted

### 1.7 Frontend PWA Shell
- React + Vite application is scaffolded
- PWA manifest and service worker are configured
- App is deployable to S3 and servable via CloudFront
- App includes Cognito sign-in flow using AWS Amplify or similar
- App can call GET /me endpoint with JWT token
- App displays user profile information after sign-in

### 1.8 Infrastructure Deployment
- SAM template includes all AWS resources:
  - Cognito User Pool and Client
  - Lambda Authorizer Function
  - API Gateway HTTP API
  - Rust API Lambda Function
  - DynamoDB Core and Derived tables
  - EventBridge custom bus
  - S3 bucket for frontend
  - CloudFront distribution
- Template supports local development (localhost:5173)
- Template supports custom domain deployment (optional)

### 1.9 Structured Logging
- All Lambda functions emit JSON-formatted logs
- Log entries include:
  - timestamp
  - level (error, warn, info, debug)
  - correlationId
  - message
  - Additional context fields as appropriate
- Rust API uses tracing crate with JSON formatter
- Lambda authorizer uses tracing crate with JSON formatter

## Non-Functional Requirements

### NFR-1: Security
- All API endpoints use HTTPS
- JWT tokens are validated for signature, expiration, and issuer
- S3 bucket blocks public access
- CloudFront uses OAC for S3 access
- Security headers are set via CloudFront response headers policy

### NFR-2: Performance
- GET /me endpoint responds within 500ms
- Lambda cold start time is acceptable for Phase 0 (< 3s)
- Frontend loads within 2s on 3G connection

### NFR-3: Mobile-First
- PWA is responsive and works on phone screens
- PWA can be installed to home screen
- Touch targets are appropriately sized (minimum 44x44px)

### NFR-4: Observability
- All requests are traceable via correlation ID
- Errors are logged with sufficient context for debugging
- CloudWatch Logs capture all Lambda output

## Out of Scope for Phase 0

- User registration (manual user creation via Cognito console is acceptable)
- Password reset flow
- Profile editing
- Multi-factor authentication
- Advanced PWA features (offline mode, push notifications)
- Performance optimization
- Load testing
- CI/CD pipeline
- Multiple environments (dev/staging/prod)
- Custom domain SSL certificate automation
- Monitoring dashboards
- Alerting
- Cost optimization
- Node.js workers (deferred to Phase 1+)
- Event emission from API (infrastructure only in Phase 0)
- Actual event handlers (deferred to Phase 3+)

## Dependencies

- AWS Account with appropriate permissions
- AWS SAM CLI installed
- Rust toolchain with cargo-lambda
- Node.js and npm/yarn for frontend development
- AWS CLI configured with credentials

## Success Metrics

Phase 0 is complete when:
1. A user can be created in Cognito console
2. User can sign in via the PWA on a phone
3. User can see their profile information displayed in the PWA
4. GET /me endpoint returns correct user data
5. All logs include correlation IDs
6. Infrastructure can be deployed via SAM CLI
7. PWA can be installed to phone home screen
