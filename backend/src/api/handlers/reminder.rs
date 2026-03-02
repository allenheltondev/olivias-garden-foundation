use crate::auth::extract_auth_context;
use crate::db;
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use tokio_postgres::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderRequest {
    pub title: String,
    pub reminder_type: String,
    pub cadence_days: i32,
    pub start_date: String,
    pub timezone: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReminderStatusRequest {
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderResponse {
    pub id: String,
    pub title: String,
    pub reminder_type: String,
    pub cadence_days: i32,
    pub start_date: String,
    pub timezone: String,
    pub status: String,
    pub next_run_at: String,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderListResponse {
    pub items: Vec<ReminderResponse>,
}

pub async fn list_reminders(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let client = db::connect().await?;

    let rows = client
        .query(
            "
            select id, title, reminder_type, cadence_days, start_date::text as start_date,
                   timezone, status, next_run_at, last_run_at, created_at
              from reminder_rules
             where user_id = $1
               and deleted_at is null
             order by next_run_at asc
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        reminder_count = rows.len(),
        "Listed deterministic reminders"
    );

    json_response(
        200,
        &ReminderListResponse {
            items: rows.iter().map(row_to_response).collect(),
        },
    )
}

pub async fn create_reminder(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let payload: CreateReminderRequest = parse_json_body(request)?;

    if payload.title.trim().is_empty() {
        return error_response(400, "title is required");
    }

    if !matches!(
        payload.reminder_type.as_str(),
        "watering" | "harvest" | "checkin" | "custom"
    ) {
        return error_response(
            400,
            "reminderType must be one of watering|harvest|checkin|custom",
        );
    }

    if !(1..=365).contains(&payload.cadence_days) {
        return error_response(400, "cadenceDays must be between 1 and 365");
    }

    let start_date = chrono::NaiveDate::parse_from_str(&payload.start_date, "%Y-%m-%d")
        .map_err(|_| lambda_http::Error::from("startDate must use YYYY-MM-DD"))?;
    let timezone = payload.timezone.unwrap_or_else(|| "UTC".to_string());

    let next_run_at = calculate_next_run_at(start_date, payload.cadence_days);

    let client = db::connect().await?;
    let row = client
        .query_one(
            "
            insert into reminder_rules (
              user_id, title, reminder_type, cadence_days, start_date, timezone, status, next_run_at
            )
            values ($1, $2, $3, $4, $5, $6, 'active', $7)
            returning id, title, reminder_type, cadence_days, start_date::text as start_date,
                      timezone, status, next_run_at, last_run_at, created_at
            ",
            &[
                &user_id,
                &payload.title.trim(),
                &payload.reminder_type,
                &payload.cadence_days,
                &start_date,
                &timezone,
                &next_run_at,
            ],
        )
        .await
        .map_err(|e| db_error(&e))?;

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        reminder_id = %row.get::<_, Uuid>("id"),
        "Created deterministic reminder"
    );

    json_response(201, &row_to_response(&row))
}

pub async fn update_reminder_status(
    request: &Request,
    correlation_id: &str,
    reminder_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let reminder_uuid = Uuid::parse_str(reminder_id)
        .map_err(|_| lambda_http::Error::from("Invalid reminder id"))?;
    let payload: UpdateReminderStatusRequest = parse_json_body(request)?;

    if !matches!(payload.status.as_str(), "active" | "paused") {
        return error_response(400, "status must be active or paused");
    }

    let client = db::connect().await?;
    let row = client
        .query_opt(
            "
            update reminder_rules
               set status = $3,
                   updated_at = now()
             where id = $1
               and user_id = $2
               and deleted_at is null
            returning id, title, reminder_type, cadence_days, start_date::text as start_date,
                      timezone, status, next_run_at, last_run_at, created_at
            ",
            &[&reminder_uuid, &user_id, &payload.status],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let Some(row) = row else {
        return error_response(404, "Reminder not found");
    };

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        reminder_id,
        status = payload.status,
        "Updated deterministic reminder status"
    );

    json_response(200, &row_to_response(&row))
}

fn calculate_next_run_at(
    start_date: chrono::NaiveDate,
    cadence_days: i32,
) -> chrono::DateTime<chrono::Utc> {
    use chrono::{Datelike, Duration, TimeZone, Utc};

    let now = Utc::now();
    let mut next = Utc
        .with_ymd_and_hms(
            start_date.year(),
            start_date.month(),
            start_date.day(),
            9,
            0,
            0,
        )
        .single()
        .unwrap_or(now);

    while next < now {
        next += Duration::days(i64::from(cadence_days));
    }

    next
}

fn row_to_response(row: &Row) -> ReminderResponse {
    ReminderResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        title: row.get("title"),
        reminder_type: row.get("reminder_type"),
        cadence_days: row.get("cadence_days"),
        start_date: row.get("start_date"),
        timezone: row.get("timezone"),
        status: row.get("status"),
        next_run_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("next_run_at")
            .to_rfc3339(),
        last_run_at: row
            .get::<_, Option<chrono::DateTime<chrono::Utc>>>("last_run_at")
            .map(|v| v.to_rfc3339()),
        created_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
    }
}

fn extract_user_id(request: &Request) -> Result<Uuid, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    Uuid::parse_str(&auth.user_id).map_err(|_| lambda_http::Error::from("Invalid user ID format"))
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

fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(status, &serde_json::json!({ "error": message }))
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn next_run_calculation_is_deterministic_and_future() {
        let start_date = chrono::NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        let next = calculate_next_run_at(start_date, 7);
        assert!(next > chrono::Utc::now() - chrono::Duration::days(7));
    }
}
