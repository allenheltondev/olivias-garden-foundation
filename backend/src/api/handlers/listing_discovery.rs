use crate::auth::extract_auth_context;
use crate::db;
use crate::location;
use crate::models::crop::ErrorResponse;
use crate::models::listing::{DiscoverListingsResponse, ListingItem};
use chrono::{DateTime, Utc};
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use tokio_postgres::Row;
use tracing::info;
use uuid::Uuid;

const ALLOWED_DISCOVER_STATUS: [&str; 1] = ["active"];
const KM_PER_MILE: f64 = 1.609_344;

#[derive(Debug)]
struct DiscoverListingsQuery {
    geo_key: String,
    status: String,
    radius_km: Option<f64>,
    radius_miles: Option<f64>,
    limit: i64,
    offset: i64,
}

pub async fn discover_listings(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context(request)?;
    let query = parse_discover_listings_query(request.uri().query())?;

    let geo_prefix = derive_geo_prefix(&query.geo_key, query.radius_km);
    let geo_pattern = format!("{geo_prefix}%");
    let fetch_limit = query.limit + 1;

    let client = db::connect().await?;
    let rows = client
        .query(
            "
            select id, user_id, grower_crop_id, crop_id, variety_id, title, unit,
                   quantity_total::text as quantity_total,
                   quantity_remaining::text as quantity_remaining,
                   available_start, available_end, status::text,
                   pickup_location_text, pickup_address, effective_pickup_address,
                   pickup_disclosure_policy::text as pickup_disclosure_policy,
                   pickup_notes, contact_pref::text as contact_pref,
                   geo_key, lat, lng, created_at
            from surplus_listings
            where deleted_at is null
              and status = $1::text::listing_status
              and geo_key is not null
              and geo_key like $2
            order by created_at desc, id desc
            limit $3 offset $4
            ",
            &[&query.status, &geo_pattern, &fetch_limit, &query.offset],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let limit = usize::try_from(query.limit)
        .map_err(|_| lambda_http::Error::from("Invalid limit. Must be between 1 and 100"))?;
    let has_more = rows.len() > limit;
    let items = rows
        .into_iter()
        .take(limit)
        .map(|row| row_to_listing_item(&row))
        .collect::<Vec<_>>();

    let response = DiscoverListingsResponse {
        items,
        limit: query.limit,
        offset: query.offset,
        has_more,
        next_offset: if has_more {
            Some(query.offset + query.limit)
        } else {
            None
        },
    };

    info!(
        correlation_id = correlation_id,
        user_id = auth_context.user_id.as_str(),
        geo_key = query.geo_key,
        geo_prefix = geo_prefix,
        status_filter = query.status,
        requested_radius_km = ?query.radius_km,
        requested_radius_miles = ?query.radius_miles,
        limit = query.limit,
        offset = query.offset,
        returned_count = response.items.len(),
        has_more = response.has_more,
        "Listed discoverable surplus listings"
    );

    json_response(200, &response)
}

fn parse_discover_listings_query(
    query: Option<&str>,
) -> Result<DiscoverListingsQuery, lambda_http::Error> {
    let mut geo_key: Option<String> = None;
    let mut status = "active".to_string();
    let mut radius_km: Option<f64> = None;
    let mut radius_miles: Option<f64> = None;
    let mut limit: i64 = 20;
    let mut offset: i64 = 0;

    if let Some(raw_query) = query {
        for pair in raw_query.split('&') {
            if pair.is_empty() {
                continue;
            }

            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));

            match key {
                "geoKey" => {
                    let normalized = value.trim().to_ascii_lowercase();
                    if normalized.is_empty() {
                        return Err(lambda_http::Error::from("geoKey is required"));
                    }
                    if !is_valid_geo_key(&normalized) {
                        return Err(lambda_http::Error::from(
                            "geoKey must be a valid geohash (1-12 chars, base32)",
                        ));
                    }
                    geo_key = Some(normalized);
                }
                "status" => {
                    if value.is_empty() {
                        continue;
                    }
                    if !ALLOWED_DISCOVER_STATUS.contains(&value) {
                        return Err(lambda_http::Error::from(format!(
                            "Invalid listing status '{}'. Allowed values: {}",
                            value,
                            ALLOWED_DISCOVER_STATUS.join(", ")
                        )));
                    }
                    status = value.to_string();
                }
                "radiusMiles" => {
                    let parsed_miles = parse_positive_radius(value, "radiusMiles")?;
                    radius_miles = Some(parsed_miles);
                    radius_km = Some(parsed_miles * KM_PER_MILE);
                }
                "limit" => {
                    limit = value.parse::<i64>().map_err(|_| {
                        lambda_http::Error::from("Invalid limit. Must be an integer")
                    })?;
                    if !(1..=100).contains(&limit) {
                        return Err(lambda_http::Error::from(
                            "Invalid limit. Must be between 1 and 100",
                        ));
                    }
                }
                "offset" => {
                    offset = value.parse::<i64>().map_err(|_| {
                        lambda_http::Error::from("Invalid offset. Must be an integer")
                    })?;
                    if offset < 0 {
                        return Err(lambda_http::Error::from(
                            "Invalid offset. Must be greater than or equal to 0",
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    let geo_key = geo_key.ok_or_else(|| lambda_http::Error::from("geoKey is required"))?;

    Ok(DiscoverListingsQuery {
        geo_key,
        status,
        radius_km,
        radius_miles,
        limit,
        offset,
    })
}

fn parse_positive_radius(value: &str, field_name: &str) -> Result<f64, lambda_http::Error> {
    let parsed = value
        .parse::<f64>()
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid number")))?;

    if !parsed.is_finite() {
        return Err(lambda_http::Error::from(format!(
            "{field_name} must be a finite number",
        )));
    }

    if parsed <= 0.0 {
        return Err(lambda_http::Error::from(format!(
            "{field_name} must be greater than 0"
        )));
    }

    Ok(parsed)
}

fn derive_geo_prefix(geo_key: &str, radius_km: Option<f64>) -> String {
    if let Some(radius_km) = radius_km {
        let precision = geohash_precision_for_radius_km(radius_km);
        let prefix_len = precision.min(geo_key.len());
        return geo_key[..prefix_len].to_string();
    }

    geo_key.to_string()
}

fn geohash_precision_for_radius_km(radius_km: f64) -> usize {
    if radius_km <= 0.61 {
        6
    } else if radius_km <= 2.4 {
        5
    } else if radius_km <= 20.0 {
        4
    } else if radius_km <= 78.0 {
        3
    } else if radius_km <= 630.0 {
        2
    } else if radius_km <= 2500.0 {
        1
    } else {
        1
    }
}

fn is_valid_geo_key(value: &str) -> bool {
    if value.is_empty() || value.len() > 12 {
        return false;
    }

    value
        .chars()
        .all(|ch| matches!(ch, '0'..='9' | 'b'..='h' | 'j'..='k' | 'm'..='n' | 'p'..='z'))
}

fn row_to_listing_item(row: &Row) -> ListingItem {
    ListingItem {
        id: row.get::<_, Uuid>("id").to_string(),
        user_id: row.get::<_, Uuid>("user_id").to_string(),
        grower_crop_id: row
            .get::<_, Option<Uuid>>("grower_crop_id")
            .map(|id| id.to_string()),
        crop_id: row
            .get::<_, Option<Uuid>>("crop_id")
            .map(|id| id.to_string()),
        variety_id: row
            .get::<_, Option<Uuid>>("variety_id")
            .map(|id| id.to_string()),
        title: row.get("title"),
        unit: row.get("unit"),
        quantity_total: row.get("quantity_total"),
        quantity_remaining: row.get("quantity_remaining"),
        available_start: row
            .get::<_, Option<DateTime<Utc>>>("available_start")
            .map(|value| value.to_rfc3339()),
        available_end: row
            .get::<_, Option<DateTime<Utc>>>("available_end")
            .map(|value| value.to_rfc3339()),
        status: row.get("status"),
        pickup_location_text: row.get("pickup_location_text"),
        pickup_address: row.get("pickup_address"),
        effective_pickup_address: row.get("effective_pickup_address"),
        pickup_disclosure_policy: row.get("pickup_disclosure_policy"),
        pickup_notes: row.get("pickup_notes"),
        contact_pref: row.get("contact_pref"),
        geo_key: row.get("geo_key"),
        lat: row
            .get::<_, Option<f64>>("lat")
            .map(location::round_for_response),
        lng: row
            .get::<_, Option<f64>>("lng")
            .map(location::round_for_response),
        created_at: row.get::<_, DateTime<Utc>>("created_at").to_rfc3339(),
    }
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> Result<Response<Body>, lambda_http::Error> {
    let body = serde_json::to_string(payload).map_err(|error| {
        lambda_http::Error::from(format!("Failed to serialize response: {error}"))
    })?;

    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|error| lambda_http::Error::from(error.to_string()))
}

#[allow(dead_code)]
fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(
        status,
        &ErrorResponse {
            error: message.to_string(),
        },
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_discover_listings_query_defaults() {
        let parsed = parse_discover_listings_query(Some("geoKey=9q8yyk8")).unwrap();
        assert_eq!(parsed.geo_key, "9q8yyk8");
        assert_eq!(parsed.status, "active");
        assert_eq!(parsed.radius_km, None);
        assert_eq!(parsed.radius_miles, None);
        assert_eq!(parsed.limit, 20);
        assert_eq!(parsed.offset, 0);
    }

    #[test]
    fn parse_discover_listings_query_with_miles_filters() {
        let parsed = parse_discover_listings_query(Some(
            "geoKey=9q8yyk8&status=active&radiusMiles=10&limit=10&offset=20",
        ))
        .unwrap();

        assert_eq!(parsed.geo_key, "9q8yyk8");
        assert_eq!(parsed.status, "active");
        assert_eq!(parsed.radius_miles, Some(10.0));
        assert_eq!(parsed.radius_km, Some(10.0 * KM_PER_MILE));
        assert_eq!(parsed.limit, 10);
        assert_eq!(parsed.offset, 20);
    }

    #[test]
    fn parse_discover_listings_query_requires_geo_key() {
        let result = parse_discover_listings_query(Some("status=active"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("geoKey is required"));
    }

    #[test]
    fn parse_discover_listings_query_rejects_invalid_geo_key() {
        let result = parse_discover_listings_query(Some("geoKey=abc!"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("valid geohash"));
    }

    #[test]
    fn parse_discover_listings_query_rejects_invalid_miles_radius() {
        let result = parse_discover_listings_query(Some("geoKey=9q8yyk8&radiusMiles=0"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("radiusMiles must be greater than 0"));
    }

    #[test]
    fn parse_discover_listings_query_rejects_infinite_radius() {
        let result = parse_discover_listings_query(Some("geoKey=9q8yyk8&radiusMiles=inf"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("radiusMiles must be a finite number"));
    }

    #[test]
    fn parse_discover_listings_query_rejects_non_active_status() {
        let result = parse_discover_listings_query(Some("geoKey=9q8yyk8&status=expired"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid listing status"));
    }

    #[test]
    fn derive_geo_prefix_uses_radius_precision() {
        assert_eq!(derive_geo_prefix("9q8yyk8", Some(20.0)), "9q8y");
        assert_eq!(derive_geo_prefix("9q8yyk8", Some(78.0)), "9q8");
    }

    #[test]
    fn derive_geo_prefix_uses_full_key_when_radius_missing() {
        assert_eq!(derive_geo_prefix("9q8yyk8", None), "9q8yyk8");
    }
}
