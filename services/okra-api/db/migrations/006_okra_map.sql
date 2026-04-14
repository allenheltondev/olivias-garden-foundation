-- 006_okra_map.sql
-- Add country column for reverse-geocoded country name

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS country TEXT;

-- Index for stats aggregation: count distinct countries among approved submissions
CREATE INDEX IF NOT EXISTS idx_submissions_approved_country
  ON submissions(status, country)
  WHERE status = 'approved';
