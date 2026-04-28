alter table store_product_images
  add column if not exists variation_match jsonb not null default '{}'::jsonb;

alter table store_product_images
  add constraint store_product_images_variation_match_is_object
  check (jsonb_typeof(variation_match) = 'object');
