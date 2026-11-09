-- 011_seed_shipment_pin_precision.sql
-- How close a public seed pin sits to the real place.
--
--   'city'   (default) coordinates rounded to ~1 km, fuzzed within city radius
--   'nearby' coordinates rounded to ~100 m, fuzzed within ~500 m. Only used for
--            in-person exchanges where an admin entered a street address.
--
-- Existing pins stay at 'city'.

ALTER TABLE seed_shipment_pins
  ADD COLUMN IF NOT EXISTS precision TEXT NOT NULL DEFAULT 'city';

ALTER TABLE seed_shipment_pins
  DROP CONSTRAINT IF EXISTS seed_shipment_pins_precision_valid;
ALTER TABLE seed_shipment_pins
  ADD CONSTRAINT seed_shipment_pins_precision_valid
  CHECK (precision IN ('city', 'nearby'));
