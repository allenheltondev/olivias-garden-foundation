alter table store_products
  add column if not exists variations jsonb not null default '[]'::jsonb;

alter table store_products
  add constraint store_products_variations_is_array
  check (jsonb_typeof(variations) = 'array');
