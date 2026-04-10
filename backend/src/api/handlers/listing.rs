use crate::auth::{extract_auth_context_with_fallback, require_grower};
use crate::db;
use crate::location;
use crate::models::crop::ErrorResponse;
use crate::models::listing::{ListMyListingsResponse, ListingItem};
use aws_config::BehaviorVersion;
use aws_sdk_eventbridge::types::PutEventsRequestEntry;
use chrono::{DateTime, Utc};
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_postgres::{Client, Row};
use tracing::{error, info};
use uuid::Uuid;

const ALLOWED_PICKUP_DISCLOSURE_POLICY: [&str; 3] =
    ["immediate", "after_confirmed", "after_accepted"];
const ALLOWED_CONTACT_PREF: [&str; 3] = ["app_message", "phone", "knock"];
const ALLOWED_LISTING_STATUS: [&str; 5] = ["active", "pending", "claimed", "expired", "completed"];
const ALLOWED_LISTING_READ_STATUS: [&str; 3] = ["active", "expired", "completed"];
const UPDATE_LISTING_SQL: &str = "
            update surplus_listings
            set crop_id = $1,
                grower_crop_id = $2,
                variety_id = $3,
                title = $4,
                unit = $5,
                quantity_total = $6::double precision,
                quantity_remaining = least(coalesce(quantity_remaining, $6::double precision), $6::double precision),
                available_start = $7,
                available_end = $8,
                status = $9::text::listing_status,
                pickup_location_text = $10,
                pickup_address = $11,
                effective_pickup_address = $12,
                pickup_disclosure_policy = $13::text::pickup_disclosure_policy,
                pickup_notes = $14,
                contact_pref = $15::text::contact_preference,
                geo_key = $16,
                lat = $17,
                lng = $18
            where id = $19
              and user_id = $20
              and deleted_at is null
            returning id, user_id, crop_id, grower_crop_id, variety_id, title,
                      quantity_total::text as quantity_total,
                      quantity_remaining::text as quantity_remaining,
                      unit, available_start, available_end, status::text,
                      pickup_location_text, pickup_address, effective_pickup_address,
                      pickup_disclosure_policy::text as pickup_disclosure_policy,
                      pickup_notes, contact_pref::text as contact_pref,
                      geo_key, lat, lng, created_at
            ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertListingRequest {
    pub title: String,
    pub crop_id: Option<String>,        // Optional for user-defined crops
    pub grower_crop_id: Option<String>, // For user-defined crops
    pub variety_id: Option<String>,
    pub quantity_total: f64,
    pub unit: String,
    pub available_start: String,
    pub available_end: String,
    pub pickup_location_text: Option<String>,
    pub pickup_address: Option<String>,
    pub pickup_disclosure_policy: Option<String>,
    pub pickup_notes: Option<String>,
    pub contact_pref: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug)]
struct ResolvedLocationInput {
    effective_pickup_address: String,
    geo_key: String,
    lat: f64,
    lng: f64,
}

#[derive(Debug)]
struct NormalizedListingInput {
    crop_id: Option<Uuid>,
    grower_crop_id: Option<Uuid>,
    variety_id: Option<Uuid>,
    available_start: DateTime<Utc>,
    available_end: DateTime<Utc>,
    pickup_address: Option<String>,
    effective_pickup_address: String,
    pickup_disclosure_policy: String,
    contact_pref: String,
    status: String,
    geo_key: String,
    lat: f64,
    lng: f64,
}

#[derive(Debug)]
struct ListMyListingsQuery {
    status: Option<String>,
    limit: i64,
    offset: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingWriteResponse {
    pub id: String,
    pub user_id: String,
    pub crop_id: String,
    pub variety_id: Option<String>,
    pub title: String,
    pub quantity_total: String,
    pub quantity_remaining: String,
    pub unit: String,
    pub available_start: String,
    pub available_end: String,
    pub status: String,
    pub pickup_location_text: Option<String>,
    pub pickup_address: Option<String>,
    pub effective_pickup_address: Option<String>,
    pub pickup_disclosure_policy: String,
    pub pickup_notes: Option<String>,
    pub contact_pref: String,
    pub geo_key: String,
    pub lat: f64,
    pub lng: f64,
    pub created_at: String,
}

pub async fn list_my_listings(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let query = parse_list_my_listings_query(request.uri().query())?;

    let client = db::connect().await?;
    let fetch_limit = query.limit + 1;

    let rows = if let Some(status) = &query.status {
        client
            .query(
                "
                select id, user_id, grower_crop_id, crop_id, variety_id, title, unit,
                       quantity_total::text as quantity_total,
                       quantity_remaining::text as quantity_remaining,
                       available_start, available_end, status::text,
                       pickup_location_text, pickup_address, effective_pickup_address,
                       pickup_disclosure_policy::text, pickup_notes, contact_pref::text,
                       geo_key, lat, lng, created_at
                from surplus_listings
                where user_id = $1
                  and deleted_at is null
                  and status = $2::text::listing_status
                order by created_at desc, id desc
                limit $3 offset $4
                ",
                &[&user_id, status, &fetch_limit, &query.offset],
            )
            .await
            .map_err(|error| db_error(&error))?
    } else {
        client
            .query(
                "
                select id, user_id, grower_crop_id, crop_id, variety_id, title, unit,
                       quantity_total::text as quantity_total,
                       quantity_remaining::text as quantity_remaining,
                       available_start, available_end, status::text,
                       pickup_location_text, pickup_address, effective_pickup_address,
                       pickup_disclosure_policy::text, pickup_notes, contact_pref::text,
                       geo_key, lat, lng, created_at
                from surplus_listings
                where user_id = $1
                  and deleted_at is null
                order by created_at desc, id desc
                limit $2 offset $3
                ",
                &[&user_id, &fetch_limit, &query.offset],
            )
            .await
            .map_err(|error| db_error(&error))?
    };

    let limit = usize::try_from(query.limit)
        .map_err(|_| lambda_http::Error::from("Invalid limit. Must be between 1 and 100"))?;
    let has_more = rows.len() > limit;
    let items = rows
        .into_iter()
        .take(limit)
        .map(|row| row_to_listing_item(&row))
        .collect::<Vec<_>>();

    let response = ListMyListingsResponse {
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
        user_id = %user_id,
        status_filter = ?query.status,
        limit = query.limit,
        offset = query.offset,
        returned_count = response.items.len(),
        has_more = response.has_more,
        "Listed grower-owned surplus listings"
    );

    json_response(200, &response)
}

pub async fn get_listing(
    request: &Request,
    correlation_id: &str,
    listing_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(listing_id, "listingId")?;

    let client = db::connect().await?;
    let maybe_row = client
        .query_opt(
            "
            select id, user_id, grower_crop_id, crop_id, variety_id, title, unit,
                   quantity_total::text as quantity_total,
                   quantity_remaining::text as quantity_remaining,
                   available_start, available_end, status::text,
                   pickup_location_text, pickup_address, effective_pickup_address,
                   pickup_disclosure_policy::text, pickup_notes, contact_pref::text,
                   geo_key, lat, lng, created_at
            from surplus_listings
            where id = $1
              and user_id = $2
              and deleted_at is null
            ",
            &[&id, &user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = maybe_row {
        info!(
            correlation_id = correlation_id,
            user_id = %user_id,
            listing_id = %id,
            "Fetched grower-owned listing"
        );
        return json_response(200, &row_to_listing_item(&row));
    }

    error_response(404, "Listing not found")
}

#[allow(clippy::too_many_lines)]
pub async fn create_listing(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: UpsertListingRequest = parse_json_body(request)?;
    let idempotency_key = extract_idempotency_key(request);
    let listing_id = idempotency_key.as_deref().map_or_else(Uuid::new_v4, |key| {
        derive_deterministic_listing_id(user_id, key)
    });

    let client = db::connect().await?;

    // Only validate catalog links if crop_id is provided
    if let Some(crop_id_str) = &payload.crop_id {
        validate_catalog_links(
            &client,
            parse_uuid(crop_id_str, "crop_id")?,
            parse_optional_uuid(payload.variety_id.as_deref(), "variety_id")?,
        )
        .await?;
    }

    // Validate that we have either crop_id or grower_crop_id
    if payload.crop_id.is_none() && payload.grower_crop_id.is_none() {
        return error_response(400, "Either crop_id or grower_crop_id must be provided");
    }

    let effective_pickup_address =
        resolve_effective_pickup_address(&client, user_id, payload.pickup_address.as_deref())
            .await?;
    let geocoded = location::geocode_address(&effective_pickup_address, correlation_id).await?;

    let normalized = normalize_payload(
        &payload,
        ResolvedLocationInput {
            effective_pickup_address,
            geo_key: geocoded.geo_key,
            lat: geocoded.lat,
            lng: geocoded.lng,
        },
    )?;

    let inserted_row = client
        .query_opt(
            "
            insert into surplus_listings
                (id, user_id, crop_id, grower_crop_id, variety_id, title, unit,
                 quantity_total, quantity_remaining,
                 available_start, available_end, status,
                 pickup_location_text, pickup_address, effective_pickup_address,
                 pickup_disclosure_policy, pickup_notes,
                 contact_pref, geo_key, lat, lng)
            values
                ($1, $2, $3, $4, $5, $6, $7,
                 $8::double precision, $8::double precision,
                 $9, $10, $11::text::listing_status,
                 $12, $13, $14,
                 $15::text::pickup_disclosure_policy, $16,
                 $17::text::contact_preference, $18, $19, $20)
            on conflict (id) do nothing
            returning id, user_id, crop_id, grower_crop_id, variety_id, title,
                      quantity_total::text as quantity_total,
                      quantity_remaining::text as quantity_remaining,
                      unit, available_start, available_end, status::text,
                      pickup_location_text, pickup_address, effective_pickup_address,
                      pickup_disclosure_policy::text as pickup_disclosure_policy,
                      pickup_notes, contact_pref::text as contact_pref,
                      geo_key, lat, lng, created_at
            ",
            &[
                &listing_id,
                &user_id,
                &normalized.crop_id,
                &normalized.grower_crop_id,
                &normalized.variety_id,
                &payload.title,
                &payload.unit,
                &payload.quantity_total,
                &normalized.available_start,
                &normalized.available_end,
                &normalized.status,
                &payload.pickup_location_text,
                &normalized.pickup_address,
                &normalized.effective_pickup_address,
                &normalized.pickup_disclosure_policy,
                &payload.pickup_notes,
                &normalized.contact_pref,
                &normalized.geo_key,
                &normalized.lat,
                &normalized.lng,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let (row, is_new_row) = if let Some(row) = inserted_row {
        (row, true)
    } else {
        let existing_row = client
            .query_opt(
                "
                select id, user_id, crop_id, variety_id, title,
                       quantity_total::text as quantity_total,
                       quantity_remaining::text as quantity_remaining,
                       unit, available_start, available_end, status::text,
                       pickup_location_text, pickup_address, effective_pickup_address,
                       pickup_disclosure_policy::text as pickup_disclosure_policy,
                       pickup_notes, contact_pref::text as contact_pref,
                       geo_key, lat, lng, created_at
                from surplus_listings
                where id = $1
                  and user_id = $2
                  and deleted_at is null
                ",
                &[&listing_id, &user_id],
            )
            .await
            .map_err(|error| db_error(&error))?;

        let Some(existing_row) = existing_row else {
            return error_response(409, "Idempotency key collision with an existing listing");
        };

        (existing_row, false)
    };

    if is_new_row {
        emit_listing_event_best_effort("listing.created", &row, correlation_id).await;
    }

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        listing_id = %row.get::<_, Uuid>("id"),
        idempotency_replay = !is_new_row,
        "Created surplus listing"
    );

    json_response(201, &row_to_write_response(&row))
}

pub async fn update_listing(
    request: &Request,
    correlation_id: &str,
    listing_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(listing_id, "listingId")?;

    let payload: UpsertListingRequest = parse_json_body(request)?;

    let client = db::connect().await?;

    // Only validate catalog links if crop_id is provided
    if let Some(crop_id_str) = &payload.crop_id {
        validate_catalog_links(
            &client,
            parse_uuid(crop_id_str, "crop_id")?,
            parse_optional_uuid(payload.variety_id.as_deref(), "variety_id")?,
        )
        .await?;
    }

    // Validate that we have either crop_id or grower_crop_id
    if payload.crop_id.is_none() && payload.grower_crop_id.is_none() {
        return error_response(400, "Either crop_id or grower_crop_id must be provided");
    }

    let effective_pickup_address =
        resolve_effective_pickup_address(&client, user_id, payload.pickup_address.as_deref())
            .await?;
    let geocoded = location::geocode_address(&effective_pickup_address, correlation_id).await?;

    let normalized = normalize_payload(
        &payload,
        ResolvedLocationInput {
            effective_pickup_address,
            geo_key: geocoded.geo_key,
            lat: geocoded.lat,
            lng: geocoded.lng,
        },
    )?;

    let maybe_row = client
        .query_opt(
            UPDATE_LISTING_SQL,
            &[
                &normalized.crop_id,
                &normalized.grower_crop_id,
                &normalized.variety_id,
                &payload.title,
                &payload.unit,
                &payload.quantity_total,
                &normalized.available_start,
                &normalized.available_end,
                &normalized.status,
                &payload.pickup_location_text,
                &normalized.pickup_address,
                &normalized.effective_pickup_address,
                &normalized.pickup_disclosure_policy,
                &payload.pickup_notes,
                &normalized.contact_pref,
                &normalized.geo_key,
                &normalized.lat,
                &normalized.lng,
                &id,
                &user_id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = maybe_row {
        emit_listing_event_best_effort("listing.updated", &row, correlation_id).await;

        info!(
            correlation_id = correlation_id,
            user_id = %user_id,
            listing_id = %id,
            "Updated surplus listing"
        );

        return json_response(200, &row_to_write_response(&row));
    }

    error_response(404, "Listing not found")
}

fn normalize_payload(
    payload: &UpsertListingRequest,
    resolved_location: ResolvedLocationInput,
) -> Result<NormalizedListingInput, lambda_http::Error> {
    if payload.title.trim().is_empty() {
        return Err(lambda_http::Error::from("title is required"));
    }

    if payload.unit.trim().is_empty() {
        return Err(lambda_http::Error::from("unit is required"));
    }

    if payload.quantity_total <= 0.0 {
        return Err(lambda_http::Error::from(
            "quantityTotal must be greater than 0",
        ));
    }

    let available_start = parse_datetime(&payload.available_start, "availableStart")?;
    let available_end = parse_datetime(&payload.available_end, "availableEnd")?;

    if available_start > available_end {
        return Err(lambda_http::Error::from(
            "availableStart must be earlier than or equal to availableEnd",
        ));
    }

    let pickup_disclosure_policy = payload
        .pickup_disclosure_policy
        .clone()
        .unwrap_or_else(|| "after_confirmed".to_string());
    if !ALLOWED_PICKUP_DISCLOSURE_POLICY.contains(&pickup_disclosure_policy.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "Invalid pickupDisclosurePolicy '{}'. Allowed values: {}",
            pickup_disclosure_policy,
            ALLOWED_PICKUP_DISCLOSURE_POLICY.join(", ")
        )));
    }

    let contact_pref = payload
        .contact_pref
        .clone()
        .unwrap_or_else(|| "app_message".to_string());
    if !ALLOWED_CONTACT_PREF.contains(&contact_pref.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "Invalid contactPref '{}'. Allowed values: {}",
            contact_pref,
            ALLOWED_CONTACT_PREF.join(", ")
        )));
    }

    let status = payload
        .status
        .clone()
        .unwrap_or_else(|| "active".to_string());
    if !ALLOWED_LISTING_STATUS.contains(&status.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "Invalid status '{}'. Allowed values: {}",
            status,
            ALLOWED_LISTING_STATUS.join(", ")
        )));
    }

    let crop_id = parse_optional_uuid(payload.crop_id.as_deref(), "crop_id")?;
    let grower_crop_id = parse_optional_uuid(payload.grower_crop_id.as_deref(), "grower_crop_id")?;
    let variety_id = parse_optional_uuid(payload.variety_id.as_deref(), "variety_id")?;

    Ok(NormalizedListingInput {
        crop_id,
        grower_crop_id,
        variety_id,
        available_start,
        available_end,
        pickup_address: location::normalize_optional_address(payload.pickup_address.as_deref()),
        effective_pickup_address: resolved_location.effective_pickup_address,
        pickup_disclosure_policy,
        contact_pref,
        status,
        geo_key: resolved_location.geo_key,
        lat: resolved_location.lat,
        lng: resolved_location.lng,
    })
}

async fn resolve_effective_pickup_address(
    client: &Client,
    user_id: Uuid,
    pickup_address: Option<&str>,
) -> Result<String, lambda_http::Error> {
    if let Some(override_address) = location::normalize_optional_address(pickup_address) {
        return Ok(override_address);
    }

    let grower_address = client
        .query_opt(
            "select address from grower_profiles where user_id = $1",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?
        .and_then(|row| row.get::<_, Option<String>>("address"));

    location::normalize_optional_address(grower_address.as_deref()).ok_or_else(|| {
        lambda_http::Error::from(
            "pickupAddress is required because grower profile address is missing".to_string(),
        )
    })
}

fn parse_list_my_listings_query(
    query: Option<&str>,
) -> Result<ListMyListingsQuery, lambda_http::Error> {
    let mut status: Option<String> = None;
    let mut limit: i64 = 20;
    let mut offset: i64 = 0;

    if let Some(raw_query) = query {
        for pair in raw_query.split('&') {
            if pair.is_empty() {
                continue;
            }

            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));

            match key {
                "status" => {
                    if !value.is_empty() {
                        if !ALLOWED_LISTING_READ_STATUS.contains(&value) {
                            return Err(lambda_http::Error::from(format!(
                                "Invalid listing status '{}'. Allowed values: {}",
                                value,
                                ALLOWED_LISTING_READ_STATUS.join(", ")
                            )));
                        }
                        status = Some(value.to_string());
                    }
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

    Ok(ListMyListingsQuery {
        status,
        limit,
        offset,
    })
}

async fn validate_catalog_links(
    client: &Client,
    crop_id: Uuid,
    variety_id: Option<Uuid>,
) -> Result<(), lambda_http::Error> {
    let crop_exists = client
        .query_one(
            "select exists(select 1 from crops where id = $1)",
            &[&crop_id],
        )
        .await
        .map_err(|error| db_error(&error))?
        .get::<_, bool>(0);

    if !crop_exists {
        return Err(lambda_http::Error::from(
            "crop_id does not reference an existing catalog crop".to_string(),
        ));
    }

    if let Some(variety) = variety_id {
        let matches = client
            .query_one(
                "select exists(select 1 from crop_varieties where id = $1 and crop_id = $2)",
                &[&variety, &crop_id],
            )
            .await
            .map_err(|error| db_error(&error))?
            .get::<_, bool>(0);

        if !matches {
            return Err(lambda_http::Error::from(
                "variety_id must belong to the specified crop_id".to_string(),
            ));
        }
    }

    Ok(())
}

async fn emit_listing_event(
    detail_type: &str,
    listing_row: &Row,
    correlation_id: &str,
) -> Result<(), lambda_http::Error> {
    let event_bus_name = std::env::var("EVENT_BUS_NAME").unwrap_or_else(|_| "default".to_string());

    let detail = serde_json::json!({
        "listingId": listing_row.get::<_, Uuid>("id").to_string(),
        "userId": listing_row.get::<_, Uuid>("user_id").to_string(),
        "status": listing_row.get::<_, String>("status"),
        "correlationId": correlation_id,
        "occurredAt": Utc::now().to_rfc3339(),
    });

    let config = aws_config::defaults(BehaviorVersion::latest()).load().await;
    let client = aws_sdk_eventbridge::Client::new(&config);

    let entry = PutEventsRequestEntry::builder()
        .event_bus_name(event_bus_name)
        .source("community-garden.api")
        .detail_type(detail_type)
        .detail(detail.to_string())
        .build();

    let response = client
        .put_events()
        .entries(entry)
        .send()
        .await
        .map_err(|e| lambda_http::Error::from(format!("Failed to emit listing event: {e}")))?;

    if response.failed_entry_count() > 0 {
        return Err(lambda_http::Error::from(
            "Failed to emit listing event: one or more entries were rejected",
        ));
    }

    Ok(())
}

async fn emit_listing_event_best_effort(
    detail_type: &str,
    listing_row: &Row,
    correlation_id: &str,
) {
    if let Err(error) = emit_listing_event(detail_type, listing_row, correlation_id).await {
        error!(
            correlation_id = correlation_id,
            listing_id = %listing_row.get::<_, Uuid>("id"),
            detail_type = detail_type,
            error = %error,
            "Failed to emit listing event after successful write"
        );
    }
}

fn parse_datetime(value: &str, field_name: &str) -> Result<DateTime<Utc>, lambda_http::Error> {
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| {
        lambda_http::Error::from(format!("{field_name} must be a valid RFC3339 timestamp"))
    })?;
    Ok(parsed.with_timezone(&Utc))
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    let normalized = value.trim();
    Uuid::parse_str(normalized)
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
}

fn parse_optional_uuid(
    value: Option<&str>,
    field_name: &str,
) -> Result<Option<Uuid>, lambda_http::Error> {
    value.map_or(Ok(None), |v| parse_uuid(v, field_name).map(Some))
}

fn parse_json_body<T: serde::de::DeserializeOwned>(
    request: &Request,
) -> Result<T, lambda_http::Error> {
    match request.body() {
        Body::Text(text) => serde_json::from_str::<T>(text)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Binary(bytes) => serde_json::from_slice::<T>(bytes)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Empty => Err(lambda_http::Error::from(
            "Request body is required".to_string(),
        )),
    }
}

fn row_to_write_response(row: &Row) -> ListingWriteResponse {
    ListingWriteResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        user_id: row.get::<_, Uuid>("user_id").to_string(),
        crop_id: row.get::<_, Uuid>("crop_id").to_string(),
        variety_id: row
            .get::<_, Option<Uuid>>("variety_id")
            .map(|v| v.to_string()),
        title: row.get("title"),
        quantity_total: row.get("quantity_total"),
        quantity_remaining: row.get("quantity_remaining"),
        unit: row.get("unit"),
        available_start: row.get::<_, DateTime<Utc>>("available_start").to_rfc3339(),
        available_end: row.get::<_, DateTime<Utc>>("available_end").to_rfc3339(),
        status: row.get("status"),
        pickup_location_text: row.get("pickup_location_text"),
        pickup_address: row.get("pickup_address"),
        effective_pickup_address: row.get("effective_pickup_address"),
        pickup_disclosure_policy: row.get("pickup_disclosure_policy"),
        pickup_notes: row.get("pickup_notes"),
        contact_pref: row.get("contact_pref"),
        geo_key: row.get("geo_key"),
        lat: location::round_for_response(row.get("lat")),
        lng: location::round_for_response(row.get("lng")),
        created_at: row.get::<_, DateTime<Utc>>("created_at").to_rfc3339(),
    }
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
            .map(|v| v.to_rfc3339()),
        available_end: row
            .get::<_, Option<DateTime<Utc>>>("available_end")
            .map(|v| v.to_rfc3339()),
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
    let body = serde_json::to_string(payload)
        .map_err(|e| lambda_http::Error::from(format!("Failed to serialize response: {e}")))?;

    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

pub fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(
        status,
        &ErrorResponse {
            error: message.to_string(),
        },
    )
}

fn extract_idempotency_key(request: &Request) -> Option<String> {
    request
        .headers()
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn derive_deterministic_listing_id(user_id: Uuid, idempotency_key: &str) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(user_id.as_bytes());
    hasher.update(b":");
    hasher.update(idempotency_key.as_bytes());

    let digest = hasher.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn valid_payload() -> UpsertListingRequest {
        UpsertListingRequest {
            title: "Fresh Tomatoes".to_string(),
            crop_id: Some("5df666d4-f6b1-4e6f-97d6-321e531ad7ca".to_string()),
            grower_crop_id: None,
            variety_id: None,
            quantity_total: 12.5,
            unit: "lb".to_string(),
            available_start: "2026-02-20T10:00:00Z".to_string(),
            available_end: "2026-02-20T18:00:00Z".to_string(),
            pickup_location_text: Some("Front porch".to_string()),
            pickup_address: Some(" 123 Main St ".to_string()),
            pickup_disclosure_policy: Some("after_confirmed".to_string()),
            pickup_notes: None,
            contact_pref: Some("app_message".to_string()),
            status: Some("active".to_string()),
        }
    }

    fn resolved_location() -> ResolvedLocationInput {
        ResolvedLocationInput {
            effective_pickup_address: "123 Main St".to_string(),
            geo_key: "9q8yyk8".to_string(),
            lat: 37.77493,
            lng: -122.41942,
        }
    }

    #[test]
    fn normalize_payload_accepts_valid_input() {
        let payload = valid_payload();
        let normalized = normalize_payload(&payload, resolved_location()).unwrap();
        assert_eq!(normalized.status, "active");
        assert_eq!(normalized.pickup_disclosure_policy, "after_confirmed");
        assert_eq!(normalized.contact_pref, "app_message");
        assert_eq!(normalized.geo_key, "9q8yyk8");
    }

    #[test]
    fn normalize_payload_rejects_invalid_window() {
        let mut payload = valid_payload();
        payload.available_start = "2026-02-21T10:00:00Z".to_string();
        payload.available_end = "2026-02-20T10:00:00Z".to_string();
        let result = normalize_payload(&payload, resolved_location());
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("availableStart"));
    }

    #[test]
    fn normalize_payload_rejects_invalid_pickup_disclosure_policy() {
        let mut payload = valid_payload();
        payload.pickup_disclosure_policy = Some("always".to_string());
        let result = normalize_payload(&payload, resolved_location());
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid pickupDisclosurePolicy"));
    }

    #[test]
    fn normalize_payload_rejects_invalid_contact_pref() {
        let mut payload = valid_payload();
        payload.contact_pref = Some("carrier_pigeon".to_string());
        let result = normalize_payload(&payload, resolved_location());
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid contactPref"));
    }

    #[test]
    fn normalize_payload_normalizes_pickup_address() {
        let payload = valid_payload();
        let normalized = normalize_payload(&payload, resolved_location()).unwrap();
        assert_eq!(normalized.pickup_address.as_deref(), Some("123 Main St"));
    }

    #[test]
    fn update_listing_sql_preserves_existing_remaining_inventory() {
        assert!(UPDATE_LISTING_SQL.contains("quantity_remaining = least("));
        assert!(UPDATE_LISTING_SQL.contains("coalesce(quantity_remaining, $6::double precision)"));
        assert!(!UPDATE_LISTING_SQL.contains("quantity_remaining = $5,"));
    }

    #[test]
    fn parse_list_my_listings_query_defaults() {
        let parsed = parse_list_my_listings_query(None).unwrap();
        assert_eq!(parsed.status, None);
        assert_eq!(parsed.limit, 20);
        assert_eq!(parsed.offset, 0);
    }

    #[test]
    fn parse_list_my_listings_query_with_filters() {
        let parsed =
            parse_list_my_listings_query(Some("status=active&limit=10&offset=20")).unwrap();
        assert_eq!(parsed.status, Some("active".to_string()));
        assert_eq!(parsed.limit, 10);
        assert_eq!(parsed.offset, 20);
    }

    #[test]
    fn deterministic_listing_id_is_stable_for_same_key() {
        let user_id = Uuid::parse_str("0e7ab2f8-9d1b-46b0-9c53-b6053bc90011").unwrap();
        let id1 = derive_deterministic_listing_id(user_id, "same-key");
        let id2 = derive_deterministic_listing_id(user_id, "same-key");
        assert_eq!(id1, id2);
    }

    #[test]
    fn deterministic_listing_id_differs_for_different_keys() {
        let user_id = Uuid::parse_str("0e7ab2f8-9d1b-46b0-9c53-b6053bc90011").unwrap();
        let id1 = derive_deterministic_listing_id(user_id, "key-a");
        let id2 = derive_deterministic_listing_id(user_id, "key-b");
        assert_ne!(id1, id2);
    }
}
