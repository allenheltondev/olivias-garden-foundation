do $$
begin
  create type workshop_status as enum ('coming_soon', 'gauging_interest', 'open', 'closed', 'past');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type workshop_signup_kind as enum ('interested', 'registered', 'waitlisted');
exception
  when duplicate_object then null;
end $$;

create table if not exists workshops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  short_description text,
  description text,
  status workshop_status not null default 'coming_soon',
  workshop_date timestamptz,
  location text,
  capacity integer,
  image_s3_key text,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshops_slug_format check (
    slug = lower(slug)
    and slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint workshops_title_nonempty check (length(btrim(title)) > 0),
  constraint workshops_capacity_nonneg check (capacity is null or capacity >= 0)
);

create index if not exists idx_workshops_public_listing
  on workshops (status, workshop_date asc nulls last);

create index if not exists idx_workshops_admin_listing
  on workshops (updated_at desc, created_at desc);

create table if not exists workshop_signups (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references workshops(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind workshop_signup_kind not null,
  created_at timestamptz not null default now(),
  unique (workshop_id, user_id)
);

create index if not exists idx_workshop_signups_workshop
  on workshop_signups (workshop_id, kind, created_at);

create index if not exists idx_workshop_signups_user
  on workshop_signups (user_id, created_at desc);
