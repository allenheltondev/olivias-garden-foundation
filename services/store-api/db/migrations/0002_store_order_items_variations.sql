alter table store_order_items
  add column if not exists selected_variations jsonb;

alter table store_order_items
  add constraint store_order_items_selected_variations_is_object
  check (selected_variations is null or jsonb_typeof(selected_variations) = 'object');
