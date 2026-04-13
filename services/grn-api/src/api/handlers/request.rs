use crate::auth::{extract_auth_context, require_user_type, UserType};
use crate::db;
use crate::models::crop::ErrorResponse;
use aws_config::BehaviorVersion;
use aws_sdk_eventbridge::types::PutEventsRequestEntry;
use chrono::{DateTime, Duration, Utc};
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_postgres::{Client, Row};
use tracing::{error, info};
use uuid::Uuid;

const ALLOWED_REQUEST_STATUS: [&str; 3] = ["open", "matched", "closed"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertRequestPayload {
    pub crop_id: String,
    pub variety_id: Option<String>,
    pub unit: Option<String>,
    pub quantity: f64,
    pub needed_by: String,
    pub notes: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug)]
struct NormalizedRequestInput {
    crop_id: Uuid,
    variety_id: Option<Uuid>,
    unit: Option<String>,
    quantity: f64,
    needed_by: DateTime<Utc>,
    notes: Option<String>,
    status: Option<String>,
}

#[derive(Debug)]
struct GathererGeoContext {
    geo_key: String,
    lat: f64,
    lng: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestWriteResponse {
    pub id: String,
    pub user_id: String,
    pub crop_id: String,
    pub variety_id: Option<String>,
    pub unit: Option<String>,
    pub quantity: String,
    pub needed_by: String,
    pub notes: Option<String>,
    pub geo_key: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub status: String,
    pub created_at: String,
}

pub async fn create_request(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context(request)?;
    require_user_type(&auth_context, &UserType::Gatherer)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: UpsertRequestPayload = parse_json_body(request)?;
    let normalized = normalize_payload(&payload)?;
    let idempotency_key = extract_idempotency_key(request);
    let request_id = idempotency_key.as_deref().map_or_else(Uuid::new_v4, |key| {
        derive_deterministic_request_id(user_id, key)
    });
    let status = normalized
        .status
        .clone()
        .unwrap_or_else(|| "open".to_string());

    let client = db::connect().await?;
    validate_catalog_links(&client, normalized.crop_id, normalized.variety_id).await?;
    let geo_context = load_gatherer_geo_context(&client, user_id).await?;

    let maybe_inserted_row = client
        .query_opt(
            "
            insert into requests
                (id, user_id, crop_id, variety_id, unit, quantity, needed_by, notes, geo_key, lat, lng, status)
            values
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::request_status)
            on conflict (id) do nothing
            returning id, user_id, crop_id, variety_id, unit,
                      quantity::text as quantity,
                      needed_by, notes, geo_key, lat, lng,
                      status::text as status, created_at
            ",
            &[
                &request_id,
                &user_id,
                &normalized.crop_id,
                &normalized.variety_id,
                &normalized.unit,
                &normalized.quantity,
                &normalized.needed_by,
                &normalized.notes,
                &geo_context.geo_key,
                &geo_context.lat,
                &geo_context.lng,
                &status,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let (row, is_new_row) = if let Some(inserted_row) = maybe_inserted_row {
        (inserted_row, true)
    } else {
        let existing_row = client
            .query_opt(
                "
                select id, user_id, crop_id, variety_id, unit,
                       quantity::text as quantity,
                       needed_by, notes, geo_key, lat, lng,
                       status::text as status, created_at
                from requests
                where id = $1
                  and user_id = $2
                  and deleted_at is null
                ",
                &[&request_id, &user_id],
            )
            .await
            .map_err(|error| db_error(&error))?;
        let Some(existing_row) = existing_row else {
            return error_response(409, "Idempotency key collision with an existing request");
        };
        (existing_row, false)
    };

    if is_new_row {
        emit_request_event_best_effort("request.created", &row, correlation_id).await;
    }

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        request_id = %row.get::<_, Uuid>("id"),
        idempotency_replay = !is_new_row,
        "Created gatherer request"
    );

    json_response(201, &row_to_write_response(&row))
}

pub async fn update_request(
    request: &Request,
    correlation_id: &str,
    request_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context(request)?;
    require_user_type(&auth_context, &UserType::Gatherer)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(request_id, "requestId")?;

    let payload: UpsertRequestPayload = parse_json_body(request)?;
    let normalized = normalize_payload(&payload)?;

    let client = db::connect().await?;
    validate_catalog_links(&client, normalized.crop_id, normalized.variety_id).await?;
    let geo_context = load_gatherer_geo_context(&client, user_id).await?;

    let maybe_row = client
        .query_opt(
            "
            update requests
            set crop_id = $1,
                variety_id = $2,
                unit = $3,
                quantity = $4,
                needed_by = $5,
                notes = $6,
                geo_key = $7,
                lat = $8,
                lng = $9,
                status = coalesce($10::request_status, status)
            where id = $11
              and user_id = $12
              and deleted_at is null
            returning id, user_id, crop_id, variety_id, unit,
                      quantity::text as quantity,
                      needed_by, notes, geo_key, lat, lng,
                      status::text as status, created_at
            ",
            &[
                &normalized.crop_id,
                &normalized.variety_id,
                &normalized.unit,
                &normalized.quantity,
                &normalized.needed_by,
                &normalized.notes,
                &geo_context.geo_key,
                &geo_context.lat,
                &geo_context.lng,
                &normalized.status,
                &id,
                &user_id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = maybe_row {
        emit_request_event_best_effort("request.updated", &row, correlation_id).await;

        info!(
            correlation_id = correlation_id,
            user_id = %user_id,
            request_id = %id,
            "Updated gatherer request"
        );

        return json_response(200, &row_to_write_response(&row));
    }

    error_response(404, "Request not found")
}

fn normalize_payload(
    payload: &UpsertRequestPayload,
) -> Result<NormalizedRequestInput, lambda_http::Error> {
    if payload.quantity <= 0.0 {
        return Err(lambda_http::Error::from("quantity must be greater than 0"));
    }

    let now = Utc::now();
    let needed_by = parse_datetime(&payload.needed_by, "neededBy")?;
    if needed_by < now {
        return Err(lambda_http::Error::from(
            "neededBy must be a current or future timestamp",
        ));
    }
    if needed_by > now + Duration::days(365) {
        return Err(lambda_http::Error::from(
            "neededBy must be within the next 365 days",
        ));
    }

    let status = payload.status.clone();
    if let Some(status_value) = &status {
        if !ALLOWED_REQUEST_STATUS.contains(&status_value.as_str()) {
            return Err(lambda_http::Error::from(format!(
                "Invalid status '{}'. Allowed values: {}",
                status_value,
                ALLOWED_REQUEST_STATUS.join(", ")
            )));
        }
    }

    Ok(NormalizedRequestInput {
        crop_id: parse_uuid(&payload.crop_id, "cropId")?,
        variety_id: parse_optional_uuid(payload.variety_id.as_deref(), "varietyId")?,
        unit: normalize_optional_text(payload.unit.as_deref()),
        quantity: payload.quantity,
        needed_by,
        notes: normalize_optional_text(payload.notes.as_deref()),
        status,
    })
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

fn derive_deterministic_request_id(user_id: Uuid, idempotency_key: &str) -> Uuid {
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

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

async fn load_gatherer_geo_context(
    client: &Client,
    user_id: Uuid,
) -> Result<GathererGeoContext, lambda_http::Error> {
    let row = client
        .query_opt(
            "
            select geo_key, lat, lng
            from gatherer_profiles
            where user_id = $1
            ",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(gatherer) = row {
        return Ok(GathererGeoContext {
            geo_key: gatherer.get("geo_key"),
            lat: gatherer.get("lat"),
            lng: gatherer.get("lng"),
        });
    }

    Err(lambda_http::Error::from(
        "Gatherer profile location is required before managing requests".to_string(),
    ))
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
            "cropId does not reference an existing catalog crop".to_string(),
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
                "varietyId must belong to the specified cropId".to_string(),
            ));
        }
    }

    Ok(())
}

async fn emit_request_event(
    detail_type: &str,
    request_row: &Row,
    correlation_id: &str,
) -> Result<(), lambda_http::Error> {
    let event_bus_name = std::env::var("EVENT_BUS_NAME").unwrap_or_else(|_| "default".to_string());

    let detail = serde_json::json!({
        "requestId": request_row.get::<_, Uuid>("id").to_string(),
        "userId": request_row.get::<_, Uuid>("user_id").to_string(),
        "status": request_row.get::<_, String>("status"),
        "correlationId": correlation_id,
        "occurredAt": Utc::now().to_rfc3339(),
    });

    let config = aws_config::defaults(BehaviorVersion::latest()).load().await;
    let client = aws_sdk_eventbridge::Client::new(&config);

    let entry = PutEventsRequestEntry::builder()
        .event_bus_name(event_bus_name)
        .source("grn.api")
        .detail_type(detail_type)
        .detail(detail.to_string())
        .build();

    let response = client
        .put_events()
        .entries(entry)
        .send()
        .await
        .map_err(|e| lambda_http::Error::from(format!("Failed to emit request event: {e}")))?;

    if response.failed_entry_count() > 0 {
        return Err(lambda_http::Error::from(
            "Failed to emit request event: one or more entries were rejected",
        ));
    }

    Ok(())
}

async fn emit_request_event_best_effort(
    detail_type: &str,
    request_row: &Row,
    correlation_id: &str,
) {
    if let Err(error) = emit_request_event(detail_type, request_row, correlation_id).await {
        error!(
            correlation_id = correlation_id,
            request_id = %request_row.get::<_, Uuid>("id"),
            detail_type = detail_type,
            error = %error,
            "Failed to emit request event after successful write"
        );
    }
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    Uuid::parse_str(value)
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
}

fn parse_optional_uuid(
    value: Option<&str>,
    field_name: &str,
) -> Result<Option<Uuid>, lambda_http::Error> {
    value.map_or(Ok(None), |v| parse_uuid(v, field_name).map(Some))
}

fn parse_datetime(value: &str, field_name: &str) -> Result<DateTime<Utc>, lambda_http::Error> {
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| {
        lambda_http::Error::from(format!("{field_name} must be a valid RFC3339 timestamp"))
    })?;
    Ok(parsed.with_timezone(&Utc))
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

fn row_to_write_response(row: &Row) -> RequestWriteResponse {
    RequestWriteResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        user_id: row.get::<_, Uuid>("user_id").to_string(),
        crop_id: row.get::<_, Uuid>("crop_id").to_string(),
        variety_id: row
            .get::<_, Option<Uuid>>("variety_id")
            .map(|id| id.to_string()),
        unit: row.get("unit"),
        quantity: row.get("quantity"),
        needed_by: row.get::<_, DateTime<Utc>>("needed_by").to_rfc3339(),
        notes: row.get("notes"),
        geo_key: row.get("geo_key"),
        lat: row.get("lat"),
        lng: row.get("lng"),
        status: row.get("status"),
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

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn valid_payload() -> UpsertRequestPayload {
        UpsertRequestPayload {
            crop_id: "5df666d4-f6b1-4e6f-97d6-321e531ad7ca".to_string(),
            variety_id: None,
            unit: Some("lb".to_string()),
            quantity: 12.5,
            needed_by: (Utc::now() + Duration::days(2)).to_rfc3339(),
            notes: Some("Need for Saturday pickup".to_string()),
            status: Some("open".to_string()),
        }
    }

    #[test]
    fn normalize_payload_accepts_valid_input() {
        let payload = valid_payload();
        let normalized = normalize_payload(&payload).unwrap();
        assert_eq!(normalized.status.as_deref(), Some("open"));
        assert!((normalized.quantity - 12.5).abs() < f64::EPSILON);
        assert_eq!(normalized.unit.as_deref(), Some("lb"));
    }

    #[test]
    fn normalize_payload_keeps_status_none_when_not_provided() {
        let mut payload = valid_payload();
        payload.status = None;
        let normalized = normalize_payload(&payload).unwrap();
        assert!(normalized.status.is_none());
    }

    #[test]
    fn normalize_payload_rejects_non_positive_quantity() {
        let mut payload = valid_payload();
        payload.quantity = 0.0;
        let result = normalize_payload(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("quantity"));
    }

    #[test]
    fn normalize_payload_rejects_past_needed_by() {
        let mut payload = valid_payload();
        payload.needed_by = (Utc::now() - Duration::hours(1)).to_rfc3339();
        let result = normalize_payload(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("neededBy"));
    }

    #[test]
    fn normalize_payload_rejects_invalid_status() {
        let mut payload = valid_payload();
        payload.status = Some("cancelled".to_string());
        let result = normalize_payload(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid status"));
    }

    #[test]
    fn derive_deterministic_request_id_is_stable_per_user_and_key() {
        let user_id = Uuid::parse_str("6b7a6e9d-e31d-4ac2-b688-15f0490adf9b").unwrap();
        let one = derive_deterministic_request_id(user_id, "retry-1");
        let two = derive_deterministic_request_id(user_id, "retry-1");
        assert_eq!(one, two);
    }

    #[test]
    fn derive_deterministic_request_id_differs_by_user() {
        let user_one = Uuid::parse_str("6b7a6e9d-e31d-4ac2-b688-15f0490adf9b").unwrap();
        let user_two = Uuid::parse_str("b630af9b-6de5-44cd-9d83-d37df86ce2ef").unwrap();
        let one = derive_deterministic_request_id(user_one, "retry-1");
        let two = derive_deterministic_request_id(user_two, "retry-1");
        assert_ne!(one, two);
    }
}
