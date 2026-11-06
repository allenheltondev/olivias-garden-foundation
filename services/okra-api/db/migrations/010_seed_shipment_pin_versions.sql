-- 010_seed_shipment_pin_versions.sql
-- Make the public seed pin projection order-independent.
--
-- The seed request status lives in DynamoDB and the pin lives here, so the
-- two writes can't share a transaction. Every status change bumps a
-- statusVersion on the request, and each pin write carries that version.
-- A write only applies when it's newer than what's stored, so a slow
-- "handled" insert can never resurrect a pin after a later undo removed it.
--
-- Removals are tombstones (visible = false, public fields cleared) rather
-- than deletes, so the version survives to block stale inserts.

ALTER TABLE seed_shipment_pins
  ADD COLUMN IF NOT EXISTS source_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE seed_shipment_pins ALTER COLUMN display_lat DROP NOT NULL;
ALTER TABLE seed_shipment_pins ALTER COLUMN display_lng DROP NOT NULL;

ALTER TABLE seed_shipment_pins
  DROP CONSTRAINT IF EXISTS seed_shipment_pins_visible_has_coords;
ALTER TABLE seed_shipment_pins
  ADD CONSTRAINT seed_shipment_pins_visible_has_coords
  CHECK (NOT visible OR (display_lat IS NOT NULL AND display_lng IS NOT NULL));

-- Pins written before consent was collected were never opted in.
UPDATE seed_shipment_pins
   SET visible = false, first_name = NULL, locality = NULL, country = NULL,
       display_lat = NULL, display_lng = NULL
 WHERE source_version = 0;

DROP INDEX IF EXISTS idx_seed_shipment_pins_sent_at;
CREATE INDEX IF NOT EXISTS idx_seed_shipment_pins_visible_sent_at
  ON seed_shipment_pins(sent_at DESC)
  WHERE visible;
