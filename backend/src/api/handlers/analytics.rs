use crate::auth::extract_auth_context;
use crate::db;
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackEventRequest {
    pub event_name: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PremiumKpiResponse {
    pub window_days: i32,
    pub funnel: HashMap<String, i64>,
    pub conversion_rate: f64,
}

pub async fn track_premium_event(
    request: &Request,
    _correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    let user_id = Uuid::parse_str(&auth.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: TrackEventRequest = parse_json_body(request)?;

    if !matches!(
        payload.event_name.as_str(),
        "paywall_view" | "checkout_start" | "subscribe" | "cancel"
    ) {
        return error_response(400, "Unsupported analytics event");
    }

    let metadata = payload
        .metadata
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| lambda_http::Error::from(format!("Invalid metadata JSON: {e}")))?;

    let client = db::connect().await?;
    client
        .execute(
            "
            insert into premium_analytics_events (user_id, event_name, event_source, metadata)
            values ($1, $2, 'frontend', $3::jsonb)
            ",
            &[&user_id, &payload.event_name, &metadata],
        )
        .await
        .map_err(|e| db_error(&e))?;

    json_response(202, &serde_json::json!({"accepted": true}))
}

pub async fn get_premium_kpis(
    request: &Request,
    _correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let _ = extract_auth_context(request)?;

    let window_days = parse_window_days(request).unwrap_or(7);
    let client = db::connect().await?;

    let rows = client
        .query(
            "
            select event_name, count(*)::bigint as total
              from premium_analytics_events
             where occurred_at >= now() - make_interval(days => $1)
             group by event_name
            ",
            &[&window_days],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let mut funnel: HashMap<String, i64> = HashMap::new();
    for row in rows {
        let event_name: String = row.get("event_name");
        let total: i64 = row.get("total");
        funnel.insert(event_name, total);
    }

    let checkout_start = *funnel.get("checkout_start").unwrap_or(&0);
    let subscribe = *funnel.get("subscribe").unwrap_or(&0);
    let conversion_rate = if checkout_start > 0 {
        count_to_f64(subscribe) / count_to_f64(checkout_start)
    } else {
        0.0
    };

    json_response(
        200,
        &PremiumKpiResponse {
            window_days,
            funnel,
            conversion_rate,
        },
    )
}

pub async fn log_backend_event(
    client: &tokio_postgres::Client,
    user_id: Option<Uuid>,
    event_name: &str,
    metadata: Option<serde_json::Value>,
) -> Result<(), lambda_http::Error> {
    let metadata = metadata
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|e| lambda_http::Error::from(format!("Invalid metadata JSON: {e}")))?;

    client
        .execute(
            "
            insert into premium_analytics_events (user_id, event_name, event_source, metadata)
            values ($1, $2, 'backend', $3::jsonb)
            ",
            &[&user_id, &event_name, &metadata],
        )
        .await
        .map_err(|e| db_error(&e))?;

    Ok(())
}

fn parse_window_days(request: &Request) -> Option<i32> {
    request.uri().query().and_then(|query| {
        query
            .split('&')
            .find_map(|pair| pair.split_once('='))
            .and_then(|(k, v)| {
                if k == "days" {
                    v.parse::<i32>().ok()
                } else {
                    None
                }
            })
    })
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

fn count_to_f64(value: i64) -> f64 {
    i32::try_from(value).map_or_else(|_| f64::from(i32::MAX), f64::from)
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}
