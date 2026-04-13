-- Cache AI-generated summaries for derived feed scopes.

create table if not exists derived_signal_summaries (
  id bigserial primary key,
  schema_version integer not null default 1,
  geo_boundary_key text not null,
  window_days smallint not null,
  summary_text text not null,
  model_id text not null,
  model_version text not null,
  signal_snapshot jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint derived_signal_summaries_geo_boundary_format check (
    geo_boundary_key ~ '^[0-9b-hjkmnp-z]{1,12}$'
  ),
  constraint derived_signal_summaries_window_days_allowed check (window_days in (7, 14, 30)),
  constraint derived_signal_summaries_expiry_check check (expires_at > generated_at)
);

create unique index if not exists idx_derived_signal_summaries_identity
  on derived_signal_summaries (
    schema_version,
    geo_boundary_key,
    window_days
  );

create index if not exists idx_derived_signal_summaries_expires_at
  on derived_signal_summaries (expires_at);
