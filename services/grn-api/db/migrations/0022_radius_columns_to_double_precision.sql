-- Migration: Change share_radius_km and search_radius_km from numeric(8,3) to double precision
-- Fixes tokio-postgres type serialization: f64 maps to double precision, not numeric.

ALTER TABLE grower_profiles
  ALTER COLUMN share_radius_km TYPE double precision USING share_radius_km::double precision;

ALTER TABLE gatherer_profiles
  ALTER COLUMN search_radius_km TYPE double precision USING search_radius_km::double precision;
