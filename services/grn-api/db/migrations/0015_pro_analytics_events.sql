-- 0015_pro_analytics_events.sql
-- Pro analytics event stream for conversion/retention reporting.

begin;

create table if not exists pro_analytics_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  event_name text not null,
  event_source text not null default 'backend',
  metadata jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_pro_analytics_events_name_time
  on pro_analytics_events(event_name, occurred_at desc);

create index if not exists idx_pro_analytics_events_user_time
  on pro_analytics_events(user_id, occurred_at desc)
  where user_id is not null;

commit;
