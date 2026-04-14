-- 005_paginated_endpoints.sql
-- Indexes to support the new paginated GET /okra and GET /admin/submissions/review-queue endpoints

-- Support GET /okra: approved submissions ordered by created_at DESC, id DESC
CREATE INDEX IF NOT EXISTS idx_submissions_status_created_id_desc
  ON submissions(status, created_at DESC, id DESC);

-- Support GET /admin/submissions/review-queue: EXISTS subquery on photo readiness
CREATE INDEX IF NOT EXISTS idx_submission_photos_submission_status
  ON submission_photos(submission_id, status);

