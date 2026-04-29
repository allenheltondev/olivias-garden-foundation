create table if not exists store_product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references store_products(id) on delete cascade,
  original_s3_bucket text not null,
  original_s3_key text not null,
  normalized_s3_bucket text,
  normalized_s3_key text,
  thumbnail_s3_bucket text,
  thumbnail_s3_key text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'ready', 'failed')),
  mime_type text not null,
  original_byte_size bigint,
  width integer,
  height integer,
  byte_size bigint,
  sort_order integer not null default 0,
  alt_text text,
  processing_error text,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_product_images_mime_type check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint store_product_images_alt_text_length check (
    alt_text is null or char_length(alt_text) <= 200
  )
);

create index if not exists idx_store_product_images_product
  on store_product_images (product_id, sort_order, created_at);

create index if not exists idx_store_product_images_status
  on store_product_images (status, created_at);

create index if not exists idx_store_product_images_cleanup
  on store_product_images (expires_at, deleted_at)
  where expires_at is not null;

create table if not exists store_product_write_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  operation text not null check (operation in ('create', 'update', 'archive')),
  product_id uuid references store_products(id) on delete set null,
  request_hash text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),
  error_message text,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation, idempotency_key)
);

create table if not exists store_product_audit_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references store_products(id) on delete set null,
  action text not null,
  actor_user_id text,
  request_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
