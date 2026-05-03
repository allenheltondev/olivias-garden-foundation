alter table users
  add column if not exists signup_method text
    check (signup_method in ('email', 'google', 'facebook', 'unknown'));

create index if not exists idx_users_signup_method
  on users(signup_method)
  where signup_method is not null;
