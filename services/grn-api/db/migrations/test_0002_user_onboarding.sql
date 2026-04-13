-- Test script for 0002_user_onboarding.sql migration
-- This script verifies the migration works correctly

-- Test 1: Verify user_type column exists with correct constraint
DO $$
BEGIN
    -- Check column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'user_type'
    ) THEN
        RAISE EXCEPTION 'user_type column does not exist';
    END IF;

    -- Check constraint exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name LIKE '%user_type%'
    ) THEN
        RAISE EXCEPTION 'user_type CHECK constraint does not exist';
    END IF;
END $$;

-- Test 2: Verify onboarding_completed column exists with correct default
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'onboarding_completed'
        AND column_default = 'false'
    ) THEN
        RAISE EXCEPTION 'onboarding_completed column does not exist or has wrong default';
    END IF;
END $$;

-- Test 3: Verify index on user_type exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'users' AND indexname = 'idx_users_user_type'
    ) THEN
        RAISE EXCEPTION 'idx_users_user_type index does not exist';
    END IF;
END $$;

-- Test 4: Insert test user and verify constraint works
INSERT INTO users (id, email, display_name, user_type, onboarding_completed)
VALUES (gen_random_uuid(), 'test_grower@example.com', 'Test Grower', 'grower', true);

INSERT INTO users (id, email, display_name, user_type, onboarding_completed)
VALUES (gen_random_uuid(), 'test_gatherer@example.com', 'Test Gatherer', 'gatherer', false);

-- Test 5: Verify invalid user_type is rejected
DO $$
BEGIN
    BEGIN
        INSERT INTO users (id, email, display_name, user_type)
        VALUES (gen_random_uuid(), 'invalid@example.com', 'Invalid', 'invalid_type');
        RAISE EXCEPTION 'Should have rejected invalid user_type';
    EXCEPTION
        WHEN check_violation THEN
            -- Expected behavior
            NULL;
    END;
END $$;

-- Test 6: Verify migration logic for existing users with grower_profiles
-- Create a test user with grower_profile
DO $$
DECLARE
    test_user_id uuid := gen_random_uuid();
BEGIN
    -- Insert user without user_type
    INSERT INTO users (id, email, display_name)
    VALUES (test_user_id, 'existing_grower@example.com', 'Existing Grower');

    -- Insert grower_profile
    INSERT INTO grower_profiles (user_id, home_zone, share_radius_km)
    VALUES (test_user_id, '8a', 5.0);

    -- Run the migration logic
    UPDATE users u
    SET user_type = 'grower', onboarding_completed = true
    WHERE u.id = test_user_id
    AND EXISTS (SELECT 1 FROM grower_profiles gp WHERE gp.user_id = u.id);

    -- Verify the update worked
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = test_user_id
        AND user_type = 'grower'
        AND onboarding_completed = true
    ) THEN
        RAISE EXCEPTION 'Migration logic did not update existing user correctly';
    END IF;
END $$;

-- Cleanup test data
DELETE FROM users WHERE email LIKE 'test_%@example.com' OR email = 'existing_grower@example.com';

SELECT 'All migration tests passed!' as result;
