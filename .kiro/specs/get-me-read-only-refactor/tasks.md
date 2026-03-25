# Tasks: GET /me Read-Only Refactor

## Task 1: Add read-only badge query function

- [x] 1.1 Add `load_badges_read_only` function to `backend/src/api/badge_cabinet.rs` that queries `badge_award_audit` for a user and returns `Vec<BadgeCabinetEntry>` without invoking any `maybe_award_*` functions
- [x] 1.2 Add unit test verifying `load_badges_read_only` returns empty vec when no badge rows exist

## Task 2: Add read-only gardener tier query function

- [x] 2.1 Add `load_tier_read_only` function to `backend/src/api/gardener_tier.rs` that reads the latest `gardener_tier_promotions` row and returns `GardenerTierProfile`, with default novice profile when no row exists
- [x] 2.2 Add unit test verifying `load_tier_read_only` returns default novice profile with zero-value breakdown when no promotion rows exist

## Task 3: Add read-only experience level query function

- [x] 3.1 Add `load_experience_level_read_only` helper function in `backend/src/api/handlers/user.rs` that reads from `user_experience_levels` and returns `(ExperienceLevel, ExperienceSignals)`, defaulting to beginner with zero signals
- [x] 3.2 Add unit test verifying default beginner level and zero signals are returned when no experience level row exists

## Task 4: Refactor `to_me_response` to use read-only functions

- [x] 4.1 Replace `badge_cabinet::load_and_sync_badges` call with `badge_cabinet::load_badges_read_only` in `to_me_response`
- [x] 4.2 Replace `gardener_tier::evaluate_and_record` call with `gardener_tier::load_tier_read_only` in `to_me_response`
- [x] 4.3 Replace `load_experience_signals` + `assign_experience_level` + `persist_experience_level` with `load_experience_level_read_only` in `to_me_response`
- [x] 4.4 Remove the `analytics::log_backend_event` call for `tips.curated.presented` from `to_me_response`
- [x] 4.5 Update curated tips computation to use the pre-computed experience level from `load_experience_level_read_only`

## Task 5: Add property-based tests for algorithm equivalence

- [x] 5.1 Add `fast-check` as a dev dependency in `backend/package.json`
- [x] 5.2 Add property test: tier scoring algorithm equivalence (Property 6) — for any random metrics, JS `evaluateGardenerTier` scoring produces same tier and breakdown as Rust logic
- [x] 5.3 Add property test: experience level algorithm equivalence (Property 7) — for any random signals, JS `assignExperienceLevel` produces same level as Rust logic
- [x] 5.4 Add property test: user ID extraction covers all event shapes (Property 9) — for any event detail with random user IDs, `extractUserIds` returns correct set

## Task 6: Update integration tests

- [x] 6.1 Update `backend/tests/get_me_integration_test.rs` to verify response includes `gardenerTier`, `badgeCabinet`, `experienceLevel`, `experienceSignals`, `curatedTips` fields with correct types
- [x] 6.2 Add integration test case verifying safe defaults for a user with no pre-computed derived data

## Task 7: Remove dead code from GET /me path

- [x] 7.1 Remove or mark as `#[allow(dead_code)]` the `load_experience_signals` function in `handlers/user.rs` (no longer called from `to_me_response`)
- [x] 7.2 Remove or mark as `#[allow(dead_code)]` the `persist_experience_level` function in `handlers/user.rs` (no longer called from `to_me_response`)
