-- 009_seed_shipment_pins.sql
-- Public-safe map pins for places we've mailed okra seeds to.
--
-- Seed requests (with full names and street addresses) live in DynamoDB and
-- never leave the admin path. When an admin marks a mailed request as handled,
-- we copy ONLY the public-safe projection here: first name, city/region,
-- country, and coordinates rounded to ~1 km. The public map reads this table
-- and never touches the seed request records.

CREATE TABLE IF NOT EXISTS seed_shipment_pins (
  request_id TEXT PRIMARY KEY,
  first_name TEXT,
  locality TEXT,
  country TEXT,
  display_lat DOUBLE PRECISION NOT NULL CHECK (display_lat BETWEEN -90 AND 90),
  display_lng DOUBLE PRECISION NOT NULL CHECK (display_lng BETWEEN -180 AND 180),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seed_shipment_pins_sent_at
  ON seed_shipment_pins(sent_at DESC);
