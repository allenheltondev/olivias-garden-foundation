-- 0012_deterministic_reminders.sql
-- Free-tier deterministic reminder engine foundation.

begin;

create table if not exists reminder_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  reminder_type text not null check (reminder_type in ('watering', 'harvest', 'checkin', 'custom')),
  cadence_days integer not null check (cadence_days between 1 and 365),
  start_date date not null,
  timezone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'paused')),
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_reminder_rules_user_status_next
  on reminder_rules(user_id, status, next_run_at)
  where deleted_at is null;

create table if not exists reminder_dispatches (
  id bigserial primary key,
  reminder_rule_id uuid not null references reminder_rules(id) on delete cascade,
  scheduled_for timestamptz not null,
  dispatched_at timestamptz,
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_reminder_dispatches_rule_scheduled
  on reminder_dispatches(reminder_rule_id, scheduled_for desc);

commit;
