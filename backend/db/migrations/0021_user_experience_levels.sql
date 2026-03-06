create table if not exists user_experience_levels (
  user_id uuid primary key references users(id) on delete cascade,
  experience_level text not null check (experience_level in ('beginner', 'intermediate', 'advanced')),
  signals jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_experience_levels_level
  on user_experience_levels(experience_level, computed_at desc);

create table if not exists user_experience_level_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  previous_level text,
  new_level text not null,
  previous_signals jsonb,
  new_signals jsonb not null,
  transition_reason text not null,
  changed_at timestamptz not null default now(),
  constraint user_experience_level_audit_level_values check (
    (previous_level is null or previous_level in ('beginner', 'intermediate', 'advanced'))
    and new_level in ('beginner', 'intermediate', 'advanced')
  )
);

create index if not exists idx_user_experience_level_audit_user_changed
  on user_experience_level_audit(user_id, changed_at desc);
