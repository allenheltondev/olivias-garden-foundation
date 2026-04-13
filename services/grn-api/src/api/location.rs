use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::time::Duration;
use tracing::{error, info, warn};

const STORAGE_COORD_PRECISION: i32 = 5;
const RESPONSE_COORD_PRECISION: i32 = 2;

#[derive(Debug)]
pub struct GeocodedPoint {
    pub lat: f64,
    pub lng: f64,
    pub geo_key: String,
}

#[derive(Debug, Deserialize)]
struct NominatimSearchResult {
    lat: String,
    lon: String,
}

pub fn normalize_address(address: &str) -> String {
    address.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn normalize_optional_address(address: Option<&str>) -> Option<String> {
    address.and_then(|value| {
        let normalized = normalize_address(value);
        if normalized.is_empty() {
            None
        } else {
            Some(normalized)
        }
    })
}

pub fn round_for_response(value: f64) -> f64 {
    round_coordinate(value, RESPONSE_COORD_PRECISION)
}

pub async fn geocode_address(
    address: &str,
    correlation_id: &str,
) -> Result<GeocodedPoint, lambda_http::Error> {
    let normalized_address = normalize_address(address);
    if normalized_address.is_empty() {
        return Err(lambda_http::Error::from("address is required".to_string()));
    }

    let address_fingerprint = hash_address(&normalized_address);
    info!(
        correlation_id = correlation_id,
        address_fingerprint = address_fingerprint,
        "Attempting to geocode address"
    );

    let base_url = std::env::var("GEOCODER_BASE_URL")
        .unwrap_or_else(|_| "https://nominatim.openstreetmap.org".to_string());
    let user_agent = std::env::var("GEOCODER_USER_AGENT").unwrap_or_else(|_| {
        "grn/0.1 (+https://github.com/allenheltondev/olivias-garden-foundation)".to_string()
    });
    let timeout_ms = std::env::var("GEOCODER_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(3_000);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .user_agent(user_agent)
        .build()
        .map_err(|error| {
            lambda_http::Error::from(format!("Failed to build geocoder client: {error}"))
        })?;

    let request_url = format!("{}/search", base_url.trim_end_matches('/'));
    let response = client
        .get(request_url)
        .query(&[
            ("format", "jsonv2"),
            ("limit", "1"),
            ("addressdetails", "0"),
            ("q", normalized_address.as_str()),
        ])
        .send()
        .await
        .map_err(|error| {
            error!(
                correlation_id = correlation_id,
                address_fingerprint = address_fingerprint,
                error = %error,
                "Geocoding request failed"
            );
            geocode_dependency_error()
        })?;

    if !response.status().is_success() {
        warn!(
            correlation_id = correlation_id,
            address_fingerprint = address_fingerprint,
            status = response.status().as_u16(),
            "Geocoding request returned non-success status"
        );
        return Err(geocode_dependency_error());
    }

    let results = response
        .json::<Vec<NominatimSearchResult>>()
        .await
        .map_err(|error| {
            error!(
                correlation_id = correlation_id,
                address_fingerprint = address_fingerprint,
                error = %error,
                "Failed to parse geocoding response"
            );
            geocode_dependency_error()
        })?;

    let (lat, lng) = parse_geocoded_coordinates(results)?;

    let lat = round_coordinate(lat, STORAGE_COORD_PRECISION);
    let lng = round_coordinate(lng, STORAGE_COORD_PRECISION);
    let geo_key = geohash::encode(geohash::Coord { x: lng, y: lat }, 7)
        .unwrap_or_else(|_| String::from("unknown"));

    info!(
        correlation_id = correlation_id,
        address_fingerprint = address_fingerprint,
        geo_key = geo_key,
        lat = round_for_response(lat),
        lng = round_for_response(lng),
        "Geocoding succeeded"
    );

    Ok(GeocodedPoint { lat, lng, geo_key })
}

fn geocode_error() -> lambda_http::Error {
    lambda_http::Error::from("Address could not be geocoded".to_string())
}

fn geocode_dependency_error() -> lambda_http::Error {
    lambda_http::Error::from("Geocoding service unavailable".to_string())
}

fn parse_geocoded_coordinates(
    results: Vec<NominatimSearchResult>,
) -> Result<(f64, f64), lambda_http::Error> {
    let top_result = results.into_iter().next().ok_or_else(geocode_error)?;
    let lat = top_result.lat.parse::<f64>().map_err(|_| geocode_error())?;
    let lng = top_result.lon.parse::<f64>().map_err(|_| geocode_error())?;

    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lng) {
        return Err(geocode_error());
    }

    Ok((lat, lng))
}

fn round_coordinate(value: f64, precision: i32) -> f64 {
    let factor = 10_f64.powi(precision);
    (value * factor).round() / factor
}

fn hash_address(address: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    address.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    #[test]
    fn normalize_address_collapses_whitespace() {
        assert_eq!(normalize_address("  123   Main   St  "), "123 Main St");
    }

    #[test]
    fn normalize_optional_address_removes_blank_values() {
        assert_eq!(normalize_optional_address(Some("   ")), None);
        assert_eq!(
            normalize_optional_address(Some(" 100 Oak Ave ")),
            Some("100 Oak Ave".to_string())
        );
    }

    #[test]
    fn round_for_response_uses_low_precision() {
        assert_eq!(round_for_response(37.77493), 37.77);
        assert_eq!(round_for_response(-122.41942), -122.42);
    }
}
