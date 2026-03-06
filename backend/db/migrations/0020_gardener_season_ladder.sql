create table if not exists badge_season_criteria (
  criteria_key text primary key,
  min_activity_weeks integer not null check (min_activity_weeks >= 1),
  min_crop_completions integer not null check (min_crop_completions >= 1),
  min_evidence_count integer not null check (min_evidence_count >= 1),
  updated_at timestamptz not null default now()
);

insert into badge_season_criteria (
  criteria_key,
  min_activity_weeks,
  min_crop_completions,
  min_evidence_count
)
values ('gardener_season_v1', 10, 3, 6)
on conflict (criteria_key) do nothing;

create unique index if not exists idx_badge_award_gardener_season_year_once
  on badge_award_audit (user_id, ((award_snapshot->>'seasonYear')::int))
  where badge_key like 'gardener_season_%' and (award_snapshot->>'seasonYear') is not null;
