-- Migration: Add support for user-defined crop names in grower crop library
-- This migration is written to be idempotent because some environments may
-- already have the canonical_id / crop_name shape from a newer bootstrap schema.

-- Add new columns when missing.
alter table grower_crop_library
  add column if not exists canonical_id uuid references crops(id) on delete restrict;

alter table grower_crop_library
  add column if not exists crop_name text;

-- Ensure crop_name can be backfilled before enforcing not-null.
alter table grower_crop_library
  alter column crop_name set default '';

-- Populate canonical_id / crop_name for existing catalog-linked entries when the
-- legacy crop_id column is still present.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'grower_crop_library'
      and column_name = 'crop_id'
  ) then
    update grower_crop_library
    set canonical_id = coalesce(grower_crop_library.canonical_id, grower_crop_library.crop_id),
        crop_name = coalesce(nullif(grower_crop_library.crop_name, ''), crops.common_name, '')
    from crops
    where grower_crop_library.crop_id = crops.id
      and (
        grower_crop_library.canonical_id is null
        or grower_crop_library.crop_name is null
        or grower_crop_library.crop_name = ''
      );
  end if;
end $$;

-- Enforce the new shape once data is backfilled.
alter table grower_crop_library
  alter column crop_name set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'grower_crop_library'::regclass
      and conname = 'grower_crop_library_crop_link_check'
  ) then
    alter table grower_crop_library
      add constraint grower_crop_library_crop_link_check check (
        (canonical_id is null and crop_name is not null and crop_name <> '') or
        (canonical_id is not null)
      );
  end if;
end $$;

-- Replace the old crop_id-based uniqueness if it still exists.
alter table grower_crop_library
  drop constraint if exists grower_crop_library_user_id_crop_id_variety_id_key;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'grower_crop_library'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, canonical_id, variety_id)'
  ) then
    alter table grower_crop_library
      add constraint grower_crop_library_user_canonical_variety_unique
      unique (user_id, canonical_id, variety_id);
  end if;
end $$;

create index if not exists idx_grower_crop_library_canonical
  on grower_crop_library(canonical_id)
  where canonical_id is not null;

drop index if exists idx_grower_crop_library_crop;

alter table grower_crop_library
  alter column crop_name drop default;

-- crop_id remains nullable for backward compatibility during transition.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'grower_crop_library'
      and column_name = 'crop_id'
  ) then
    alter table grower_crop_library
      alter column crop_id drop not null;
  end if;
end $$;
