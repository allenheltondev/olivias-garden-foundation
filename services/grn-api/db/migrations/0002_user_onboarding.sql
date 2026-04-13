-- Migration: Add user_type and onboarding_completed to users table
-- Supports user onboarding flow feature (grower/gatherer distinction)

-- Add user_type column with CHECK constraint (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'user_type'
  ) THEN
    ALTER TABLE users
      ADD COLUMN user_type text CHECK (user_type IN ('grower', 'gatherer'));
  END IF;
END $$;

-- Add onboarding_completed column with default false (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'onboarding_completed'
  ) THEN
    ALTER TABLE users
      ADD COLUMN onboarding_completed boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Create index on user_type for efficient filtering (if not exists)
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type) WHERE user_type IS NOT NULL;

-- Migrate existing users: set user_type='grower' and onboarding_completed=true
-- for users who already have a grower_profile
UPDATE users u
SET
  user_type = 'grower',
  onboarding_completed = true
WHERE EXISTS (
  SELECT 1 FROM grower_profiles gp WHERE gp.user_id = u.id
)
AND user_type IS NULL;
