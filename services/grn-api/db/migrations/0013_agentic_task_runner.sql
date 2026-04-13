-- 0013_agentic_task_runner.sql
-- Pro agentic task runner foundation.

begin;

create table if not exists agent_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  schedule_cron text not null,
  instruction text not null,
  status text not null default 'active' check (status in ('active', 'paused')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_agent_tasks_user_status_next
  on agent_tasks(user_id, status, next_run_at)
  where deleted_at is null;

create table if not exists agent_task_runs (
  id bigserial primary key,
  agent_task_id uuid not null references agent_tasks(id) on delete cascade,
  run_status text not null check (run_status in ('queued', 'running', 'succeeded', 'failed')),
  output jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_task_runs_task_created
  on agent_task_runs(agent_task_id, created_at desc);

commit;
