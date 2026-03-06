use crate::auth::{extract_auth_context_with_fallback, require_grower};
use crate::db;
use crate::models::crop::{ErrorResponse, GrowerCropItem, UpsertGrowerCropRequest};
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use tokio_postgres::{Client, Row};
use tracing::info;
use uuid::Uuid;

const ALLOWED_STATUS: [&str; 4] = ["interested", "planning", "growing", "paused"];
const ALLOWED_VISIBILITY: [&str; 3] = ["private", "local", "public"];

pub async fn list_my_crops(
    request: &Request,
    _correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    // Require grower user type - gatherers will receive 403 Forbidden
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let client = db::connect().await?;

    let rows = client
        .query(
            "
            select id, user_id, crop_id, variety_id, status::text, visibility::text,
                   surplus_enabled, nickname, default_unit, notes, created_at, updated_at
            from grower_crop_library
            where user_id = $1
            order by created_at desc
            ",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let items = rows
        .into_iter()
        .map(|row| row_to_item(&row))
        .collect::<Vec<_>>();
    json_response(200, &items)
}

pub async fn get_my_crop(
    request: &Request,
    _correlation_id: &str,
    crop_library_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    // Require grower user type - gatherers will receive 403 Forbidden
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(crop_library_id, "crop library id")?;
    let client = db::connect().await?;

    let maybe_row = client
        .query_opt(
            "
            select id, user_id, crop_id, variety_id, status::text, visibility::text,
                   surplus_enabled, nickname, default_unit, notes, created_at, updated_at
            from grower_crop_library
            where id = $1 and user_id = $2
            ",
            &[&id, &user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = maybe_row {
        return json_response(200, &row_to_item(&row));
    }

    json_response(
        404,
        &ErrorResponse {
            error: "Grower crop record not found".to_string(),
        },
    )
}

pub async fn create_my_crop(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    // Require grower user type - gatherers will receive 403 Forbidden
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: UpsertGrowerCropRequest = parse_json_body(request)?;
    validate_upsert_payload(&payload)?;

    let crop_id = parse_uuid(&payload.crop_id, "crop_id")?;
    let variety_id = parse_optional_uuid(payload.variety_id.as_deref(), "variety_id")?;
    let variety_id_text = variety_id.map(|v| v.to_string());

    let client = db::connect().await?;
    validate_catalog_links(&client, crop_id, variety_id).await?;

    let row = client
        .query_one(
            "
            insert into grower_crop_library
                (user_id, crop_id, variety_id, status, visibility, surplus_enabled, nickname, default_unit, notes)
            values
                ($1, $2, $3::text::uuid, $4::text::grower_crop_status, $5::text::visibility_scope, $6, $7, $8, $9)
            returning id, user_id, crop_id, variety_id, status::text, visibility::text,
                      surplus_enabled, nickname, default_unit, notes, created_at, updated_at
            ",
            &[
                &user_id,
                &crop_id,
                &variety_id_text,
                &payload.status,
                &payload.visibility,
                &payload.surplus_enabled,
                &payload.nickname,
                &payload.default_unit,
                &payload.notes,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        crop_library_id = %row.get::<_, Uuid>("id"),
        "Created grower crop library item"
    );

    json_response(201, &row_to_item(&row))
}

pub async fn update_my_crop(
    request: &Request,
    correlation_id: &str,
    crop_library_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    // Require grower user type - gatherers will receive 403 Forbidden
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: UpsertGrowerCropRequest = parse_json_body(request)?;
    validate_upsert_payload(&payload)?;

    let id = parse_uuid(crop_library_id, "crop library id")?;
    let crop_id = parse_uuid(&payload.crop_id, "crop_id")?;
    let variety_id = parse_optional_uuid(payload.variety_id.as_deref(), "variety_id")?;
    let variety_id_text = variety_id.map(|v| v.to_string());

    let client = db::connect().await?;
    validate_catalog_links(&client, crop_id, variety_id).await?;

    let maybe_row = client
        .query_opt(
            "
            update grower_crop_library
            set crop_id = $1,
                variety_id = $2::text::uuid,
                status = $3::text::grower_crop_status,
                visibility = $4::text::visibility_scope,
                surplus_enabled = $5,
                nickname = $6,
                default_unit = $7,
                notes = $8,
                updated_at = now()
            where id = $9 and user_id = $10
            returning id, user_id, crop_id, variety_id, status::text, visibility::text,
                      surplus_enabled, nickname, default_unit, notes, created_at, updated_at
            ",
            &[
                &crop_id,
                &variety_id_text,
                &payload.status,
                &payload.visibility,
                &payload.surplus_enabled,
                &payload.nickname,
                &payload.default_unit,
                &payload.notes,
                &id,
                &user_id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = maybe_row {
        info!(
            correlation_id = correlation_id,
            user_id = %user_id,
            crop_library_id = %id,
            "Updated grower crop library item"
        );
        return json_response(200, &row_to_item(&row));
    }

    json_response(
        404,
        &ErrorResponse {
            error: "Grower crop record not found".to_string(),
        },
    )
}

pub async fn delete_my_crop(
    request: &Request,
    correlation_id: &str,
    crop_library_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    // Require grower user type - gatherers will receive 403 Forbidden
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_grower(&auth_context)?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(crop_library_id, "crop library id")?;
    let client = db::connect().await?;

    let deleted = client
        .execute(
            "delete from grower_crop_library where id = $1 and user_id = $2",
            &[&id, &user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if deleted == 0 {
        return json_response(
            404,
            &ErrorResponse {
                error: "Grower crop record not found".to_string(),
            },
        );
    }

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        crop_library_id = %id,
        "Deleted grower crop library item"
    );

    Response::builder()
        .status(204)
        .body(Body::Empty)
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

fn validate_upsert_payload(payload: &UpsertGrowerCropRequest) -> Result<(), lambda_http::Error> {
    if !ALLOWED_STATUS.contains(&payload.status.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "Invalid status '{}'. Allowed values: {}",
            payload.status,
            ALLOWED_STATUS.join(", ")
        )));
    }

    if !ALLOWED_VISIBILITY.contains(&payload.visibility.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "Invalid visibility '{}'. Allowed values: {}",
            payload.visibility,
            ALLOWED_VISIBILITY.join(", ")
        )));
    }

    Ok(())
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

fn row_to_item(row: &Row) -> GrowerCropItem {
    GrowerCropItem {
        id: row.get::<_, Uuid>("id").to_string(),
        user_id: row.get::<_, Uuid>("user_id").to_string(),
        crop_id: row.get::<_, Uuid>("crop_id").to_string(),
        variety_id: row
            .get::<_, Option<Uuid>>("variety_id")
            .map(|v| v.to_string()),
        status: row.get("status"),
        visibility: row.get("visibility"),
        surplus_enabled: row.get("surplus_enabled"),
        nickname: row.get("nickname"),
        default_unit: row.get("default_unit"),
        notes: row.get("notes"),
        created_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("updated_at")
            .to_rfc3339(),
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
mod tests {
    use super::{validate_upsert_payload, UpsertGrowerCropRequest};

    fn valid_payload() -> UpsertGrowerCropRequest {
        UpsertGrowerCropRequest {
            crop_id: "5df666d4-f6b1-4e6f-97d6-321e531ad7ca".to_string(),
            variety_id: None,
            status: "growing".to_string(),
            visibility: "local".to_string(),
            surplus_enabled: true,
            nickname: None,
            default_unit: None,
            notes: None,
        }
    }

    #[test]
    fn payload_validation_accepts_valid_enums() {
        let payload = valid_payload();
        assert!(validate_upsert_payload(&payload).is_ok());
    }

    #[test]
    fn payload_validation_rejects_invalid_status() {
        let mut payload = valid_payload();
        payload.status = "harvested".to_string();
        assert!(validate_upsert_payload(&payload).is_err());
    }

    #[test]
    fn payload_validation_rejects_invalid_visibility() {
        let mut payload = valid_payload();
        payload.visibility = "team".to_string();
        assert!(validate_upsert_payload(&payload).is_err());
    }
}
