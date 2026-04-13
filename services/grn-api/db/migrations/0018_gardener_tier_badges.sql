-- Gardener identity tier rubric and promotion audit trail.

do $$
begin
  create type gardener_tier as enum ('novice', 'intermediate', 'pro', 'master');
exception
  when duplicate_object then null;
end $$;

create table if not exists gardener_tier_promotions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  tier gardener_tier not null,
  total_score integer not null,
  explanation text not null,
  score_breakdown jsonb not null default '{}'::jsonb,
  promoted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint gardener_tier_score_bounds check (total_score between 0 and 100)
);

create index if not exists idx_gardener_tier_promotions_user
  on gardener_tier_promotions(user_id, promoted_at desc);
