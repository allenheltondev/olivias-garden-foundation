-- Badge evidence verification pipeline foundation
-- Stores photo evidence signals, trust scoring, and moderation decisions.

do $$
begin
  create type badge_evidence_status as enum (
    'pending',
    'auto_approved',
    'needs_review',
    'rejected'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists badge_evidence_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  grower_crop_id uuid references grower_crop_library(id) on delete set null,

  badge_key text not null,
  photo_url text not null,

  captured_at timestamptz,
  exif_taken_at timestamptz,
  exif_lat double precision,
  exif_lng double precision,
  exif_device_make text,
  exif_device_model text,

  sha256_hash text,
  perceptual_hash text,

  ai_crop_label text,
  ai_crop_confidence numeric(5,4),
  ai_stage_label text,
  ai_stage_confidence numeric(5,4),

  duplicate_or_near_duplicate boolean not null default false,
  metadata_mismatch_flag boolean not null default false,

  trust_score integer not null default 0,
  score_breakdown jsonb not null default '{}'::jsonb,
  score_factors jsonb not null default '{}'::jsonb,

  status badge_evidence_status not null default 'pending',
  reviewer_user_id uuid references users(id) on delete set null,
  review_notes text,
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint badge_evidence_score_bounds check (trust_score between 0 and 100),
  constraint badge_evidence_confidence_bounds check (
    (ai_crop_confidence is null or (ai_crop_confidence >= 0 and ai_crop_confidence <= 1)) and
    (ai_stage_confidence is null or (ai_stage_confidence >= 0 and ai_stage_confidence <= 1))
  ),
  constraint badge_evidence_exif_lat_lng_pair check (
    (exif_lat is null and exif_lng is null) or (exif_lat is not null and exif_lng is not null)
  )
);

create index if not exists idx_badge_evidence_user_badge
  on badge_evidence_submissions(user_id, badge_key, created_at desc);

create index if not exists idx_badge_evidence_status_created
  on badge_evidence_submissions(status, created_at desc);

create index if not exists idx_badge_evidence_crop
  on badge_evidence_submissions(grower_crop_id)
  where grower_crop_id is not null;

create unique index if not exists idx_badge_evidence_user_photo_hash
  on badge_evidence_submissions(user_id, sha256_hash)
  where sha256_hash is not null;

create table if not exists badge_award_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  badge_key text not null,
  awarded_at timestamptz not null default now(),

  trust_score_snapshot integer,
  decision_reason text,
  evidence_submission_ids jsonb not null default '[]'::jsonb,
  award_snapshot jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint badge_award_trust_score_bounds check (
    trust_score_snapshot is null or (trust_score_snapshot between 0 and 100)
  )
);

create index if not exists idx_badge_award_user_badge
  on badge_award_audit(user_id, badge_key, awarded_at desc);
