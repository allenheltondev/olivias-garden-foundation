do $$
begin
  create type store_order_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type store_order_fulfillment_status as enum ('unfulfilled', 'fulfilled', 'shipped', 'delivered');
exception
  when duplicate_object then null;
end $$;

create table if not exists store_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  email citext not null,
  customer_name text,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text unique,
  stripe_customer_id text,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null check (currency = lower(currency) and currency ~ '^[a-z]{3}$'),
  status store_order_status not null default 'pending',
  fulfillment_status store_order_fulfillment_status not null default 'unfulfilled',
  shipping_address jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists idx_store_orders_user
  on store_orders (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_store_orders_email
  on store_orders (email, created_at desc);

create index if not exists idx_store_orders_status
  on store_orders (status, created_at desc);

create table if not exists store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_orders(id) on delete cascade,
  product_id uuid references store_products(id) on delete set null,
  product_slug text not null,
  product_name text not null,
  product_kind text not null,
  quantity integer not null check (quantity > 0),
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  stripe_price_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_order_items_order
  on store_order_items (order_id);
