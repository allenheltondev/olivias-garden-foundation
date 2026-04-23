-- Adds optional organization metadata for grower onboarding without
-- introducing a new user_type. Organizations can participate as growers.

alter table grower_profiles
  add column if not exists is_organization boolean not null default false;

alter table grower_profiles
  add column if not exists organization_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'grower_profiles_organization_name_nonempty'
  ) then
    alter table grower_profiles
      add constraint grower_profiles_organization_name_nonempty
      check (organization_name is null or length(btrim(organization_name)) > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'grower_profiles_organization_requires_name'
  ) then
    alter table grower_profiles
      add constraint grower_profiles_organization_requires_name
      check (is_organization = false or organization_name is not null);
  end if;
end $$;
