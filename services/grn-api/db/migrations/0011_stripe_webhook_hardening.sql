-- 0011_stripe_webhook_hardening.sql
-- Stripe webhook reliability: idempotency + failure logging + ordering watermark.

begin;

alter table users
  add column if not exists stripe_last_event_created bigint;

create table if not exists stripe_webhook_events (
  id text primary key,
  event_type text not null,
  created_unix bigint not null,
  processed_at timestamptz not null default now()
);

create table if not exists stripe_webhook_failures (
  id bigserial primary key,
  event_id text,
  event_type text,
  reason text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_stripe_webhook_failures_created_at
  on stripe_webhook_failures(created_at desc);

commit;
