# Requirements Document

## Introduction

The Good Roots Network API has 26 endpoints across 14 handler domains, but the existing Postman test suite covers primarily happy-path contract assertions with limited negative testing, no gatherer persona coverage, incomplete entitlement matrix verification, and minimal cross-endpoint data consistency checks. This spec defines requirements for expanding Postman test coverage across two new collection categories â€” utility tests and E2E business flows â€” and integrating them into CI as parallel jobs to catch regressions, validate entitlement boundaries, and ensure the API behaves correctly under error conditions.

## Glossary

- **Test_Suite**: The complete set of Postman collections, folders, and request files under `postman/collections/`
- **Contract_Collection**: The existing "Good Roots Network API" Postman collection that holds contract/happy-path tests for individual endpoints
- **Utility_Collection**: A dedicated Postman collection ("Good Roots Network API - Utility Tests") containing stateless or minimally stateful tests that verify infrastructure-level API behaviors such as idempotency, entitlement gating, negative path validation, 404 handling, correlation ID propagation, pagination boundaries, and 409 conflict detection
- **E2E_Collection**: A dedicated Postman collection ("Good Roots Network API - E2E Flows") containing ordered, stateful, multi-step business workflow tests that use variable chaining between steps
- **CI_Pipeline**: The GitHub Actions workflow (`pr-checks.yml`) that runs Postman collections against the staging environment after deployment
- **Contract_Test**: A Postman request that validates a single endpoint's response schema, status code, and field values for a specific scenario
- **E2E_Flow**: An ordered sequence of Postman requests that exercises a multi-step business workflow with variable chaining between steps
- **Entitlement_Gate**: An API behavior where a request returns 403 with `feature_locked` error when the caller's tier lacks the required entitlement
- **Grower_Token**: A JWT issued by the CI auth seed function representing a grower user (free or pro tier)
- **Gatherer_Token**: A JWT issued by the CI auth seed function representing a gatherer user
- **Negative_Test**: A Postman request that sends intentionally invalid input and asserts the API returns the correct error status code and error response shape
- **Idempotency_Check**: A test pattern where the same write request is sent twice and the second response is verified to be safe (no duplicate creation, consistent response)
- **Variable_Chain**: The Postman pattern of capturing a response field (e.g., `listingId`) into a collection variable for use by subsequent requests
- **Correlation_ID**: A unique identifier propagated via `X-Correlation-Id` header across all API requests and responses for traceability

## Requirements

### Requirement 1: Collection Organization by Test Category

**User Story:** As a developer, I want utility tests and E2E business flow tests organized into separate Postman collections, so that they can be maintained independently and run in parallel CI jobs.

#### Acceptance Criteria

1. THE Test_Suite SHALL contain a Utility_Collection named "Good Roots Network API - Utility Tests" for stateless or minimally stateful infrastructure-level API behavior tests
2. THE Test_Suite SHALL contain an E2E_Collection named "Good Roots Network API - E2E Flows" for ordered, stateful, multi-step business workflow tests that use Variable_Chain between steps
3. THE Contract_Collection ("Good Roots Network API") SHALL continue to hold existing contract/happy-path tests and remain unchanged by this spec
4. THE Utility_Collection SHALL organize tests into subfolders by concern (e.g., Negative Paths, 404 Coverage, Entitlement Matrix, Idempotency, Correlation ID, Pagination, 409 Conflict)
5. THE E2E_Collection SHALL organize tests into subfolders by business flow (e.g., Claim Lifecycle, Listing-to-Claim, Gatherer Persona, Cross-Endpoint Consistency)

### Requirement 2: Negative Path Test Coverage for Validation Errors (Utility)

**User Story:** As a developer, I want Postman tests that send invalid inputs to write endpoints, so that I can verify the API returns correct 400 error responses and does not silently accept bad data.

#### Acceptance Criteria

1. WHEN a request with a missing required field is sent to a write endpoint, THE Utility_Collection SHALL assert a 400 status code and an error response body containing an `error` property
2. WHEN a request with an invalid UUID path parameter is sent, THE Utility_Collection SHALL assert a 400 status code
3. WHEN a request with out-of-range numeric values is sent (e.g., `quantityTotal` of 0, `shareRadiusMiles` of -1), THE Utility_Collection SHALL assert a 400 status code
4. WHEN a request with an invalid enum value is sent (e.g., `status` of `"bogus"`), THE Utility_Collection SHALL assert a 400 status code
5. THE Utility_Collection SHALL include negative path tests for at minimum the following write endpoints: POST /crops, POST /listings, POST /requests, POST /claims, POST /reminders, PUT /me

### Requirement 3: 404 Not Found Coverage for Resource Lookups (Utility)

**User Story:** As a developer, I want Postman tests that request non-existent resources, so that I can verify the API returns 404 responses instead of 500 errors or empty 200s.

#### Acceptance Criteria

1. WHEN a GET request is sent with a valid-format UUID that does not match any existing resource, THE Utility_Collection SHALL assert a 404 status code and an error response body
2. WHEN a PUT request targets a non-existent resource ID, THE Utility_Collection SHALL assert a 404 status code
3. THE Utility_Collection SHALL include 404 tests for at minimum: GET /crops/{id}, GET /my/listings/{id}, PUT /claims/{id}, PUT /reminders/{id}, GET /users/{userId}

### Requirement 4: Entitlement Matrix Verification Across Tiers (Utility)

**User Story:** As a developer, I want Postman tests that verify pro-only endpoints return 403 `feature_locked` for free-tier users, so that I can catch entitlement regressions before they reach production.

#### Acceptance Criteria

1. WHEN a free-tier Grower_Token is used to call a pro-only endpoint, THE Utility_Collection SHALL assert a 403 status code with `error` equal to `feature_locked`, a valid `entitlementKey`, a `requiredTier` of `pro`, and an `upgradeHintKey`
2. THE Utility_Collection SHALL verify entitlement gating for all pro endpoints: POST /ai/copilot/weekly-plan, POST /agent-tasks, PUT /agent-tasks/{id}, POST /analytics/pro/events, GET /analytics/pro/kpis
3. WHEN a pro-tier Grower_Token is used to call the same pro endpoints, THE Utility_Collection SHALL assert a successful response (non-403)
4. THE CI_Pipeline SHALL run the entitlement negative checks as part of the utility-api-tests job using the free-tier token

### Requirement 5: Idempotency Verification for Write Endpoints (Utility)

**User Story:** As a developer, I want Postman tests that send the same write request twice and verify safe behavior, so that I can catch idempotency regressions in the API.

#### Acceptance Criteria

1. WHEN the same PUT /me request body is sent twice in sequence, THE Utility_Collection SHALL assert both responses return the same status code and equivalent response bodies
2. WHEN a POST write endpoint is called and then the same logical operation is repeated, THE Utility_Collection SHALL assert the API does not create duplicate resources or returns a consistent response
3. THE Utility_Collection SHALL include idempotency checks for at minimum: PUT /me, POST /listings (via re-read verification), POST /reminders

### Requirement 6: Correlation ID Propagation Verification (Utility)

**User Story:** As a developer, I want Postman tests that verify the API returns a Correlation_ID in every response, so that I can ensure end-to-end traceability is maintained.

#### Acceptance Criteria

1. WHEN any API request includes an `X-Correlation-Id` header, THE Utility_Collection SHALL assert the response includes the same `X-Correlation-Id` header value
2. WHEN an API request does not include an `X-Correlation-Id` header, THE Utility_Collection SHALL assert the response still includes an `X-Correlation-Id` header with a non-empty value
3. THE Utility_Collection SHALL verify Correlation_ID propagation on at minimum one GET and one POST endpoint

### Requirement 7: Pagination Boundary Testing (Utility)

**User Story:** As a developer, I want Postman tests that exercise pagination parameters on list endpoints, so that I can verify limit, offset, and hasMore behavior.

#### Acceptance Criteria

1. WHEN a list endpoint is called with `limit=1`, THE Utility_Collection SHALL assert the response contains at most 1 item in the `items` array
2. WHEN a list endpoint is called with `offset` beyond available data, THE Utility_Collection SHALL assert the response returns an empty `items` array and `hasMore` equal to `false`
3. THE Utility_Collection SHALL include pagination tests for at minimum: GET /listings/discover, GET /feed/derived

### Requirement 8: Quantity Conflict (409) Testing (Utility)

**User Story:** As a developer, I want Postman tests that verify the API returns 409 when a claim exceeds available listing quantity, so that I can catch concurrency and quantity-tracking regressions.

#### Acceptance Criteria

1. WHEN a claim is created with `quantityClaimed` exceeding the listing's remaining quantity, THE Utility_Collection SHALL assert a 409 status code
2. THE Utility_Collection SHALL assert the 409 response body contains an `error` property describing the insufficient quantity

### Requirement 9: Claim Status Transition E2E Flow

**User Story:** As a developer, I want an end-to-end Postman flow that exercises the full claim lifecycle, so that I can verify state transitions work correctly and invalid transitions are rejected.

#### Acceptance Criteria

1. THE E2E_Collection SHALL contain a claim lifecycle flow that creates a listing, then creates a claim against the listing, then transitions the claim through pending â†' confirmed â†' completed
2. WHEN a claim transition to an invalid status is attempted (e.g., pending â†' completed directly), THE E2E_Collection SHALL assert a 400 status code
3. WHEN a claim is transitioned to `confirmed`, THE E2E_Collection SHALL assert the response `status` field equals `confirmed`
4. WHEN a claim is transitioned to `completed`, THE E2E_Collection SHALL assert the response `status` field equals `completed`

### Requirement 10: Listing-to-Claim Full Lifecycle E2E Flow

**User Story:** As a developer, I want an end-to-end Postman flow that exercises the grower-posts-food-to-gatherer-claims-it workflow, so that I can verify the core business value chain works end-to-end.

#### Acceptance Criteria

1. THE E2E_Collection SHALL contain a listing-to-claim flow that executes the following ordered steps: grower creates crop â†' grower creates listing â†' listing appears in discovery â†' gatherer creates claim â†' grower confirms claim â†' grower completes claim
2. THE E2E_Collection SHALL use Variable_Chain to pass resource IDs between steps and abort the run if any chained ID is missing
3. WHEN the listing-to-claim flow completes, THE E2E_Collection SHALL assert the final claim status is `completed`
4. THE CI_Pipeline SHALL run the listing-to-claim E2E_Flow as part of the e2e-api-tests job

### Requirement 11: Gatherer Persona Test Coverage (E2E)

**User Story:** As a developer, I want Postman tests that run under a gatherer user token, so that I can verify gatherer-specific endpoints and ensure grower-only operations are properly restricted.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL generate a Gatherer_Token via the CI auth seed function alongside existing grower tokens
2. WHEN a Gatherer_Token is used to call GET /me, THE E2E_Collection SHALL assert the response contains `userType` equal to `gatherer` and a `gathererProfile` object
3. THE E2E_Collection SHALL include gatherer-persona tests for at minimum: PUT /me (gatherer profile setup), GET /listings/discover, POST /requests, POST /claims
4. THE CI_Pipeline SHALL run gatherer-persona tests as part of the e2e-api-tests job using the Gatherer_Token

### Requirement 12: Cross-Endpoint Data Consistency Verification (E2E)

**User Story:** As a developer, I want E2E tests that verify data created by one endpoint appears correctly when read through another endpoint, so that I can catch data consistency bugs across the API surface.

#### Acceptance Criteria

1. WHEN a crop is created via POST /crops, THE E2E_Collection SHALL verify the crop appears in the GET /crops list response with matching field values
2. WHEN a listing is created via POST /listings, THE E2E_Collection SHALL verify the listing appears in GET /my/listings with matching `id` and `status`
3. WHEN a reminder is created via POST /reminders, THE E2E_Collection SHALL verify the reminder appears in GET /reminders with matching `id`, `title`, and `status`
4. WHEN a request is created via POST /requests and a claim is created via POST /claims, THE E2E_Collection SHALL verify the claim appears in GET /claims with the correct `listingId`

### Requirement 13: CI Pipeline Integration with Parallel Test Jobs

**User Story:** As a developer, I want utility and E2E test collections to run as separate parallel CI jobs, so that the test matrix completes faster and failures are isolated by category.

#### Acceptance Criteria

1. THE CI_Pipeline SHALL run the Utility_Collection as a dedicated `utility-api-tests` job that starts after staging deployment completes
2. THE CI_Pipeline SHALL run the E2E_Collection as a dedicated `e2e-api-tests` job that starts after staging deployment completes
3. THE CI_Pipeline SHALL run the `utility-api-tests` and `e2e-api-tests` jobs concurrently (not sequentially dependent on each other)
4. THE CI_Pipeline SHALL include a `staging-validation-summary` job that waits for both `utility-api-tests` and `e2e-api-tests` (and existing `contract-api-tests`) to complete before reporting overall status
5. IF any test job fails, THEN THE CI_Pipeline SHALL fail the overall staging validation summary and block the PR
6. THE CI_Pipeline SHALL continue to run the existing `contract-api-tests` job for the Contract_Collection independently of the new test jobs
