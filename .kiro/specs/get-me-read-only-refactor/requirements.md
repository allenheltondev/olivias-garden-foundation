# Requirements Document

## Introduction

GET /me currently violates the architecture boundary "Rust API owns synchronous transactional writes and reads" and "Workers own async/derived processing" by performing four categories of database writes on every call: badge evaluation and awarding, gardener tier calculation and promotion recording, experience level computation and persistence, and analytics event logging. This refactor makes GET /me a pure read endpoint that returns pre-computed derived data from the database, and moves all write side-effects into the existing `profile-derived-worker` async pipeline triggered by domain events.

## Glossary

- **GET_Me_Handler**
s badge criteria and inserts awards into `badge_award_audit`.
- **Gardener_Tier_Module**: The Rust module `backend/src/api/gardener_tier.rs` containing `evaluate_and_record` which computes tier scores and inserts promotions into `gardener_tier_promotions`.
- **Experience_Level_Module**: The experience level computation logic in `backend/src/api/tips_framework.rs` and the `persist_experience_level` / `load_experience_signals` functions in `user.rs` that upsert into `user_experience_levels` and `user_experience_level_audit`.
- **Analytics_Logger**: The `analytics::log_backend_event` function that writes `tips.curated.presented` events to `pro_analytics_events` on every GET /me call.
- **EventBridge_Bus**: The AWS EventBridge custom event bus that routes domain events (e.g., `user.profile.updated`, `claim.updated`) to subscribed worker Lambdas.
- **MeProfileResponse**: The JSON response shape returned by GET /me, containing user profile, badge cabinet, gardener tier, experience level, curated tips, and related fields.

## Requirements

### Requirement 1: Remove Badge Evaluation Writes from GET /me

**User Story:** As a platform operator, I want GET /me to read pre-computed badge data instead of evaluating and awarding badges inline, so that the endpoint is fast and free of write side-effects.

#### Acceptance Criteria

1. WHEN GET /me is called, THE GET_Me_Handler SHALL read badge cabinet entries from the `badge_award_audit` table without invoking any badge evaluation or insert logic.
2. WHEN GET /me is called for a user with no badge records in `badge_award_audit`, THE GET_Me_Handler SHALL return an empty badge cabinet array.
3. THE GET_Me_Handler SHALL return the same `badgeCabinet` JSON field shape (array of objects with `badgeKey`, `earnedAt`, `proofCount`) as the current response contract.

### Requirement 2: Remove Gardener Tier Writes from GET /me

**User Story:** As a platform operator, I want GET /me to read pre-computed gardener tier data instead of evaluating and recording tier promotions inline, so that the endpoint performs no writes.

#### Acceptance Criteria

1. WHEN GET /me is called, THE GET_Me_Handler SHALL read the latest gardener tier profile from the `gardener_tier_promotions` table without invoking any tier evaluation or insert logic.
2. WHEN GET /me is called for a user with no tier promotion records, THE GET_Me_Handler SHALL return a default novice tier profile with zero-value score breakdown.
3. THE GET_Me_Handler SHALL return the same `gardenerTier` JSON field shape (`currentTier`, `lastPromotionAt`, `decision` with `tier`, `evaluatedAt`, `explanation`, `breakdown`) as the current response contract.

### Requirement 3: Remove Experience Level Writes from GET /me

**User Story:** As a platform operator, I want GET /me to read pre-computed experience level data instead of computing signals and persisting levels inline, so that the endpoint performs no writes.

#### Acceptance Criteria

1. WHEN GET /me is called, THE GET_Me_Handler SHALL read the experience level and signals from the `user_experience_levels` table without computing signals from source tables or writing to `user_experience_levels` or `user_experience_level_audit`.
2. WHEN GET /me is called for a user with no experience level record, THE GET_Me_Handler SHALL return a default beginner experience level with zero-value signals.
3. THE GET_Me_Handler SHALL return the same `experienceLevel` and `experienceSignals` JSON field shapes as the current response contract.

### Requirement 4: Remove Analytics Event Writes from GET /me

**User Story:** As a platform operator, I want GET /me to stop writing analytics events on every call, so that the endpoint is a pure read and analytics event counts are not inflated by page loads.

#### Acceptance Criteria

1. WHEN GET /me is called, THE GET_Me_Handler SHALL return curated tips without writing any rows to `pro_analytics_events`.
2. THE GET_Me_Handler SHALL continue to compute curated tips using the pre-computed experience level, current season, and user zone.

### Requirement 5: Worker Computes Badge Awards on Domain Events

**User Story:** As a platform operator, I want badge evaluation and awarding to happen asynchronously in the worker pipeline, so that badges are kept up-to-date without blocking read endpoints.

#### Acceptance Criteria

1. WHEN the Profile_Derived_Worker receives a domain event, THE Profile_Derived_Worker SHALL evaluate all badge families (first harvest, season ladder, fruit focused, sharing credibility, practice) for the affected user and insert any newly qualified awards into `badge_award_audit`.
2. THE Profile_Derived_Worker SHALL use idempotent insert logic that skips badges already awarded for the same user and badge key.
3. IF a badge evaluation query fails, THEN THE Profile_Derived_Worker SHALL log the error and continue processing remaining badge families for the same user.

### Requirement 6: Worker Computes Gardener Tier on Domain Events

**User Story:** As a platform operator, I want gardener tier evaluation and promotion recording to happen asynchronously in the worker pipeline, so that tier data is kept current without blocking read endpoints.

#### Acceptance Criteria

1. WHEN the Profile_Derived_Worker receives a domain event, THE Profile_Derived_Worker SHALL evaluate the gardener tier score for the affected user and insert a promotion record into `gardener_tier_promotions` when the tier has increased.
2. THE Profile_Derived_Worker SHALL use the same scoring algorithm (crop diversity, seasonal consistency, sharing outcomes, photo trust, reliability) and tier thresholds (novice < 35, intermediate < 60, pro < 80, master >= 80) as the current Rust implementation.
3. THE Profile_Derived_Worker SHALL skip the promotion insert when the computed tier is equal to or lower than the most recent recorded tier.

### Requirement 7: Worker Computes Experience Level on Domain Events

**User Story:** As a platform operator, I want experience level computation and persistence to happen asynchronously in the worker pipeline, so that experience data is kept current without blocking read endpoints.

#### Acceptance Criteria

1. WHEN the Profile_Derived_Worker receives a domain event, THE Profile_Derived_Worker SHALL compute experience signals from source tables, assign an experience level, and upsert the result into `user_experience_levels`.
2. WHEN the computed experience level or signals differ from the previously stored values, THE Profile_Derived_Worker SHALL insert an audit row into `user_experience_level_audit` with transition reason `profile_updated_worker`.
3. THE Profile_Derived_Worker SHALL use the same scoring formula and level thresholds (beginner, intermediate at score >= 18, advanced at score >= 50) as the current Rust implementation.

### Requirement 8: Worker Logs Derived Refresh Analytics Event

**User Story:** As a platform operator, I want the worker to log a single analytics event per derived data refresh, so that analytics accurately reflect computation events rather than page loads.

#### Acceptance Criteria

1. WHEN the Profile_Derived_Worker completes a successful refresh for a user, THE Profile_Derived_Worker SHALL inser
splayName`, `isVerified`, `userType`, `onboardingCompleted`, `createdAt`, `subscription`, `gardenerTier`, `badgeCabinet`, `seasonalTimeline`, `experienceLevel`, `experienceSignals`, `curatedTips`, `growerProfile`, `gathererProfile`, `ratingSummary`) with the same JSON key names and value types.
2. WHEN a field has no pre-computed data available, THE GET_Me_Handler SHALL return a safe default value (empty array for collections, default enum value for levels, zero-value structs for breakdowns) rather than omitting the field or returning an error.

### Requirement 10: Worker Event Subscriptions Cover All Relevant Triggers

**User Story:** As a platform operator, I want the worker to process all domain events that can affect derived profile data, so that pre-computed data stays fresh.

#### Acceptance Criteria

1. THE Profile_Derived_Worker SHALL be subscribed to `user.profile.updated`, `listing.created`, `listing.updated`, `claim.created`, and `claim.updated` events on the EventBridge_Bus.
2. WHEN a claim event contains both `claimerId` and `listingOwnerId`, THE Profile_Derived_Worker SHALL refresh derived data for both users.
3. WHEN a listing or profile event contains `userId`, THE Profile_Derived_Worker SHALL refresh derived data for that user.

### Requirement 11: Read-Only Badge Cabinet Query

**User Story:** As a platform operator, I want a read-only function for loading badge cabinet entries, so that GET /me can fetch badges without triggering any evaluation logic.

#### Acceptance Criteria

1. THE Badge_Cabinet_Module SHALL expose a read-only function that queries `badge_award_audit` for a given user and returns badge entries without invoking any `maybe_award_*` evaluation functions.
2. THE read-only function SHALL return the same `Vec<BadgeCabinetEntry>` type with the same field mapping (`badge_key`, `earned_at`, `proof_count`) as the current `load_and_sync_badges` function.

### Requirement 12: Read-Only Gardener Tier Query

**User Story:** As a platform operator, I want a read-only function for loading gardener tier profile data, so that GET /me can fetch tier information without triggering any evaluation or promotion logic.

#### Acceptance Criteria

1. THE Gardener_Tier_Module SHALL expose a read-only function that queries `gardener_tier_promotions` for the latest promotion record and returns a `GardenerTierProfile` without invoking any scoring or insert logic.
2. WHEN no promotion record exists for the user, THE read-only function SHALL return a default `GardenerTierProfile` with tier `novice`, zero-value score breakdown, and an explanation indicating no evaluation has occurred.
