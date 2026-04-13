# Implementation Plan: Postman E2E Coverage

## Overview

Expand the Good Roots Network API Postman test suite from a single contract collection into a three-collection architecture by creating a Utility Tests collection (stateless infrastructure assertions) and an E2E Flows collection (ordered multi-step business workflows), then integrating both into the CI pipeline as parallel jobs. All files are YAML-based Postman request files and GitHub Actions workflow YAML â€” no application code changes.

## Tasks

- [x] 1. Create Utility Tests collection scaffold
  - [x] 1.1 Create collection-level and subfolder definition files for all seven Utility subfolders
    - Create `.resources/definition.yaml` in each: `Negative Paths/`, `404 Coverage/`, `Entitlement Matrix/`, `Idempotency/`, `Correlation ID/`, `Pagination/`, `409 Conflict/`
    - Each definition uses `$kind: collection` with name, description, and order
    - _Requirements: 1.4_

- [x] 2. Implement Negative Paths subfolder requests
  - [x] 2.1 Create negative path request files for write endpoints
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/Negative Paths/` for:
      - POST /crops with missing `crop_id` â†’ assert 400 + `error` property
      - POST /listings with `quantityTotal` of 0 â†’ assert 400
      - POST /requests with invalid enum `status: "bogus"` â†’ assert 400
      - POST /claims with invalid UUID path format â†’ assert 400
      - POST /reminders with missing `title` â†’ assert 400
      - PUT /me with `shareRadiusMiles` of -1 â†’ assert 400
    - Each file follows `$kind: http-request` convention with `afterResponse` scripts containing `pm.test()` assertions
    - Use `{{proAuthToken}}` for auth (write endpoints need an onboarded user)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Implement 404 Coverage subfolder requests
  - [x] 3.1 Create 404 test request files for resource lookups
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/404 Coverage/` for:
      - GET /crops/{nonExistentUUID} â†’ assert 404 + `error` property
      - GET /my/listings/{nonExistentUUID} â†’ assert 404
      - PUT /claims/{nonExistentUUID} with valid body â†’ assert 404
      - PUT /reminders/{nonExistentUUID} with valid body â†’ assert 404
      - GET /users/{nonExistentUUID} â†’ assert 404
    - Use a hardcoded valid-format UUID that won't match any real resource (e.g., `00000000-0000-4000-a000-000000000000`)
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Implement Entitlement Matrix subfolder requests
  - [x] 4.1 Create entitlement gating test request files
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/Entitlement Matrix/` for:
      - POST /ai/copilot/weekly-plan with free token â†’ assert 403 with `feature_locked`, `entitlementKey`, `requiredTier: "pro"`, `upgradeHintKey`
      - POST /agent-tasks with free token â†’ assert 403 feature_locked
      - PUT /agent-tasks/{id} with free token â†’ assert 403 feature_locked
      - POST /analytics/pro/events with free token â†’ assert 403 feature_locked
      - GET /analytics/pro/kpis with free token â†’ assert 403 feature_locked
    - Use `beforeRequest` scripts to swap `authToken` to `{{freeAuthToken}}` for these requests
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 4.2 Create pro-tier positive entitlement checks
    - Create YAML request files that call the same pro endpoints with `{{proAuthToken}}` and assert non-403 responses
    - _Requirements: 4.3_

- [x] 5. Implement Idempotency subfolder requests
  - [x] 5.1 Create idempotency verification request files
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/Idempotency/` for:
      - PUT /me sent twice: first request captures response snapshot in collection variable, second request asserts same status code and equivalent body
      - POST /listings + GET /my/listings re-read: create a listing, then verify re-reading returns consistent data
      - POST /reminders sent twice: assert no duplicate creation or consistent response
    - Use `beforeRequest` and `afterResponse` scripts for snapshot comparison
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Implement Correlation ID subfolder requests
  - [x] 6.1 Create correlation ID propagation test request files
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/Correlation ID/` for:
      - GET /me with explicit `X-Correlation-Id` header â†’ assert response echoes same value
      - POST /crops without `X-Correlation-Id` header â†’ assert response contains a non-empty `X-Correlation-Id` header
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Implement Pagination subfolder requests
  - [x] 7.1 Create pagination boundary test request files
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/Pagination/` for:
      - GET /listings/discover?limit=1 â†’ assert response `items` array has at most 1 element
      - GET /listings/discover?offset=999999 â†’ assert empty `items` array and `hasMore` equals `false`
      - GET /feed/derived?limit=1 â†’ assert response `items` array has at most 1 element
      - GET /feed/derived?offset=999999 â†’ assert empty `items` and `hasMore` equals `false`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Implement 409 Conflict subfolder requests
  - [x] 8.1 Create quantity conflict test request files
    - Create YAML request files in `postman/collections/Good Roots Network API - Utility Tests/409 Conflict/` for:
      - Setup: create a listing with `quantityTotal: 1` (capture `listingId`)
      - First claim: POST /claims with `quantityClaimed: 1` â†’ assert 201 (exhaust quantity)
      - Second claim: POST /claims with `quantityClaimed: 1` against same listing â†’ assert 409 with `error` containing "Insufficient quantity"
    - Use variable chaining within this subfolder for the setup â†’ claim â†’ conflict sequence
    - _Requirements: 8.1, 8.2_

- [x] 9. Checkpoint â€” Utility collection complete
  - Ensure all Utility collection YAML files are syntactically valid and follow conventions. Ask the user if questions arise.

- [x] 10. Create E2E Flows collection scaffold
  - [x] 10.1 Create the E2E collection definition file at `postman/collections/Good Roots Network API - E2E Flows/.resources/definition.yaml`
    - Define collection name, description, variables (`baseUrl`, `growerAuthToken`, `gathererAuthToken`, `authToken`, `catalogCropId`, `defaultCatalogCropId`, `cropLibraryId`, `listingId`, `requestId`, `claimId`, `reminderId`), and bearer auth
    - _Requirements: 1.2, 1.5_

  - [x] 10.2 Create subfolder definition files for all four E2E subfolders
    - Create `.resources/definition.yaml` in each: `Claim Lifecycle/`, `Listing-to-Claim/`, `Gatherer Persona/`, `Cross-Endpoint Consistency/`
    - _Requirements: 1.5_

- [x] 11. Implement Claim Lifecycle E2E flow
  - [x] 11.1 Create ordered request files for the claim lifecycle flow
    - Create YAML request files in `postman/collections/Good Roots Network API - E2E Flows/Claim Lifecycle/` for:
      - Step 0: Set `authToken` to `{{growerAuthToken}}` via pre-request script
      - Step 1: POST /listings â†’ create listing, capture `listingId`
      - Step 2: POST /claims â†’ create claim against listing, capture `claimId`, assert status `pending`
      - Step 3: PUT /claims/{claimId} with invalid transition (pending â†’ completed) â†’ assert 400
      - Step 4: PUT /claims/{claimId} transition to `confirmed` â†’ assert status `confirmed`
      - Step 5: PUT /claims/{claimId} transition to `completed` â†’ assert status `completed`
    - Each step uses variable chaining; abort run if chained ID is missing
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 12. Implement Listing-to-Claim E2E flow
  - [x] 12.1 Create ordered request files for the listing-to-claim flow
    - Create YAML request files in `postman/collections/Good Roots Network API - E2E Flows/Listing-to-Claim/` for:
      - Step 0: Set `authToken` to `{{growerAuthToken}}`
      - Step 1: POST /crops â†’ grower creates crop, capture `cropLibraryId`
      - Step 2: POST /listings â†’ grower creates listing with captured crop, capture `listingId`
      - Step 3: GET /listings/discover â†’ verify listing appears in discovery results
      - Step 4: Swap `authToken` to `{{gathererAuthToken}}`, POST /claims â†’ gatherer creates claim, capture `claimId`
      - Step 5: Swap `authToken` back to `{{growerAuthToken}}`, PUT /claims/{claimId} â†’ grower confirms claim
      - Step 6: PUT /claims/{claimId} â†’ grower completes claim, assert final status `completed`
    - Abort run if any chained ID is missing via `pm.execution.setNextRequest(null)`
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 13. Implement Gatherer Persona E2E flow
  - [x] 13.1 Create ordered request files for gatherer persona tests
    - Create YAML request files in `postman/collections/Good Roots Network API - E2E Flows/Gatherer Persona/` for:
      - Step 0: Set `authToken` to `{{gathererAuthToken}}`
      - Step 1: PUT /me with gatherer profile â†’ setup gatherer user
      - Step 2: GET /me â†’ assert `userType` equals `gatherer` and `gathererProfile` object is present
      - Step 3: GET /listings/discover â†’ assert successful response for gatherer
      - Step 4: POST /requests â†’ gatherer creates a request, capture `requestId`
      - Step 5: Swap to `{{growerAuthToken}}`, create listing, swap back to `{{gathererAuthToken}}`, POST /claims â†’ gatherer claims listing
    - _Requirements: 11.2, 11.3_

- [x] 14. Implement Cross-Endpoint Consistency E2E flow
  - [x] 14.1 Create ordered request files for cross-endpoint consistency checks
    - Create YAML request files in `postman/collections/Good Roots Network API - E2E Flows/Cross-Endpoint Consistency/` for:
      - Step 1: POST /crops â†’ create crop, capture ID
      - Step 2: GET /crops â†’ verify created crop appears in list with matching fields
      - Step 3: POST /listings â†’ create listing, capture ID
      - Step 4: GET /my/listings â†’ verify listing appears with matching `id` and `status`
      - Step 5: POST /reminders â†’ create reminder, capture ID
      - Step 6: GET /reminders â†’ verify reminder appears with matching `id`, `title`, `status`
      - Step 7: POST /claims â†’ create claim against listing, capture ID
      - Step 8: GET /claims â†’ verify claim appears with correct `listingId`
    - Use `{{growerAuthToken}}` for grower operations, swap to `{{gathererAuthToken}}` for claim
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 15. Checkpoint â€” E2E collection complete
  - Ensure all E2E collection YAML files are syntactically valid and follow conventions. Ask the user if questions arise.

- [x] 16. Update CI pipeline for parallel test jobs
  - [x] 16.1 Add `utility-api-tests` job to `pr-checks.yml`
    - Add a new job `utility-api-tests` that depends on `deploy-staging-backend`, `deploy-staging-frontend`, `staging-public-api-smoke`
    - Job steps: checkout, configure AWS credentials, invoke CI auth seed Lambda, extract `grower_free` and `grower_pro` tokens (with `::add-mask::`), install Postman CLI, login, run Utility collection with pro token, run Entitlement Matrix subfolder with free token
    - _Requirements: 13.1, 4.4_

  - [x] 16.2 Update `e2e-api-tests` job in `pr-checks.yml`
    - Remove dependency on `contract-api-tests` so it runs concurrently (depends only on `deploy-staging-backend`, `deploy-staging-frontend`, `staging-public-api-smoke`)
    - Update collection run command to target `postman/collections/Good Roots Network API - E2E Flows` instead of `E2E - Search veggie and add to garden`
    - Extract `gatherer.access_token` from CI auth seed response alongside grower tokens
    - Pass both `growerAuthToken` and `gathererAuthToken` as `--env-var` to the collection run
    - _Requirements: 10.4, 11.1, 11.4, 13.2, 13.3_

  - [x] 16.3 Update `staging-validation-summary` job in `pr-checks.yml`
    - Add `utility-api-tests` to the `needs` list
    - Add `check_result "utility-api-tests"` to the validation script
    - _Requirements: 13.4, 13.5, 13.6_

- [x] 17. Final checkpoint â€” Full integration
  - Ensure all YAML files are valid, CI pipeline references correct collection paths, and all three test jobs can run concurrently after staging deployment. Ask the user if questions arise.

## Notes

- All Postman request files use YAML format with `$kind: http-request` convention
- The existing Contract collection and "E2E - Search veggie and add to garden" collection remain on disk unchanged
- No changes to `backend/functions/ci-auth-seed.mjs` â€” the gatherer token already exists in the response
- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
