# Migration 0002: User Onboarding Schema

## Purpose
This migration adds support for the user onboarding flow feature by introducing user type distinction (grower vs gatherer) and onboarding completion tracking.

## Changes

### 1. Add `user_type` column to `users` table
- Type: `text`
- Constraint: CHECK constraint allowing only `'grower'` or `'gatherer'`
- Nullable: Yes (allows existing users to have NULL initially)
- Purpose: Distinguishes between growers (who share food) and gatherers (who collect food)

### 2. Add `onboarding_completed` column to `users` table
- Type: `boolean`
- Default: `false`
- Nullable: No
- Purpose: Tracks whether a user has completed the onboarding wizard

### 3. Create index on `user_type`
- Index: `idx_users_user_type`
- Type: Partial index (WHERE user_type IS NOT NULL)
- Purpose: Efficient filtering and queries by user type

### 4. Data migration for existing users
- Sets `user_type = 'grower'` for users who have an existing `grower_profile`
- Sets `onboarding_completed = true` for users who have an existing `grower_profile`
- Purpose: Ensures backward compatibility with existing grower users

## Validation

The migration includes several validations:
- CHECK constraint ensures only valid user types ('grower' or 'gatherer')
- Existing users with grower profiles are automatically migrated
- New users default to `onboarding_completed = false`

## Rollback

To rollback this migration:
```sql
DROP INDEX IF EXISTS idx_users_user_type;
ALTER TABLE users DROP COLUMN IF EXISTS onboarding_completed;
ALTER TABLE users DROP COLUMN IF EXISTS user_type;
```

## Related Requirements

This migration validates the following requirements from the user-onboarding-flow spec:
- Requirement 5.1: user_type field in User_Profile
- Requirement 5.2: onboarding_completed field in User_Profile
- Requirement 5.4: user_type must be set before onboarding is marked complete
- Requirement 10.1: Existing users without user_type default to "grower"
- Requirement 10.2: Existing users without onboarding_completed default based on grower_profile existence

## Testing

Run the test script to verify the migration:
```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/community_garden'
psql "$DATABASE_URL" -f services/grn-api/db/migrations/test_0002_user_onboarding.sql
```

The test script verifies:
1. Columns exist with correct types and constraints
2. Index is created
3. Valid user types are accepted
4. Invalid user types are rejected
5. Migration logic correctly updates existing users with grower_profiles
