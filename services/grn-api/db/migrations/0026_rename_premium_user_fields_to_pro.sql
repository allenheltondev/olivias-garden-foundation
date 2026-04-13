-- 0026_rename_premium_user_fields_to_pro.sql
-- Forward-fix older environments that still have premium-era user schema.

begin;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'premium_expires_at'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'pro_expires_at'
  ) then
    alter table users rename column premium_expires_at to pro_expires_at;
  end if;
end $$;

alter table users
  add column if not exists pro_expires_at timestamptz;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'users_tier_check'
      and conrelid = 'users'::regclass
  ) then
    alter table users drop constraint users_tier_check;
  end if;
end $$;

update users
set tier = 'pro'
where tier = 'premium';

alter table users
  add constraint users_tier_check
  check (tier in ('free', 'supporter', 'pro'));

commit;
