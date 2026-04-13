-- 0014_ai_guardrails_usage_budget.sql
-- Pro AI safety + cost guardrails foundation.

begin;

create table if not exists ai_usage_events (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  feature_key text not null,
  model_id text not null,
  estimated_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 4) not null default 0,
  status text not null check (status in ('allowed', 'blocked')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_events_user_created
  on ai_usage_events(user_id, created_at desc);

create index if not exists idx_ai_usage_events_feature_created
  on ai_usage_events(feature_key, created_at desc);

commit;
