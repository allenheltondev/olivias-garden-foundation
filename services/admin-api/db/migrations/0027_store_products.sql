do $$
begin
  create type store_product_status as enum ('draft', 'active', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type store_product_kind as enum ('donation', 'merchandise', 'ticket', 'sponsorship', 'other');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type store_fulfillment_type as enum ('none', 'digital', 'shipping', 'pickup');
exception
  when duplicate_object then null;
end $$;

create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_description text,
  description text,
  status store_product_status not null default 'draft',
  kind store_product_kind not null default 'other',
  fulfillment_type store_fulfillment_type not null default 'none',
  is_public boolean not null default false,
  is_featured boolean not null default false,
  currency text not null default 'usd',
  unit_amount_cents integer not null,
  statement_descriptor text,
  nonprofit_program text,
  impact_summary text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  stripe_product_id text not null unique,
  stripe_price_id text not null unique,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_products_slug_format check (
    slug = lower(slug)
    and slug = btrim(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint store_products_name_nonempty check (length(btrim(name)) > 0),
  constraint store_products_currency_format check (
    currency = lower(currency)
    and currency ~ '^[a-z]{3}$'
  ),
  constraint store_products_amount_nonnegative check (unit_amount_cents >= 0),
  constraint store_products_statement_descriptor_length check (
    statement_descriptor is null or char_length(statement_descriptor) between 5 and 22
  )
);

create index if not exists idx_store_products_public_listing
  on store_products (status, is_public, is_featured desc, created_at desc);

create index if not exists idx_store_products_kind_status
  on store_products (kind, status, created_at desc);
