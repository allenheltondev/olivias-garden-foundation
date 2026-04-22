alter table users
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists bio text,
  add column if not exists city text,
  add column if not exists region text,
  add column if not exists country text,
  add column if not exists timezone text,
  add column if not exists avatar_url text,
  add column if not exists website_url text,
  add column if not exists profile_updated_at timestamptz;
