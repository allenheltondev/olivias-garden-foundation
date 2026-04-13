-- 0009_user_tier_subscription_state.sql
-- Adds tier/subscription metadata for pro entitlements.

begin;

alter table users
  add column if not exists tier text not null default 'free'
    check (tier in ('free', 'pro')),
  add column if not exists subscription_status text not null default 'none'
    check (subscription_status in ('none', 'trialing', 'active', 'past_due', 'canceled')),
  add column if not exists pro_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_users_tier on users(tier);
create index if not exists idx_users_subscription_status on users(subscription_status);

commit;
