use crate::ai_model_config;
use crate::auth::extract_auth_context;
use crate::db;
use crate::middleware::{ai_guardrails, entitlements};
use crate::structured_json;
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use tokio_postgres::Row;
use uuid::Uuid;

const DEFAULT_WINDOW_DAYS: i32 = 7;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyPlanRequest {
    pub geo_key: String,
    pub window_days: Option<i32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyPlanRecommendation {
    pub recommendation: String,
    pub confidence: f64,
    pub rationale: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyPlanResponse {
    pub model_id: String,
    pub model_version: String,
    pub structured_json: bool,
    pub geo_key: String,
    pub window_days: i32,
    pub recommendations: Vec<WeeklyPlanRecommendation>,
}

pub async fn generate_weekly_plan(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    let user_id = Uuid::parse_str(&auth.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;

    let payload: WeeklyPlanRequest = parse_json_body(request)?;
    let window_days = payload.window_days.unwrap_or(DEFAULT_WINDOW_DAYS);
    if ![7, 14, 30].contains(&window_days) {
        return error_response(400, "windowDays must be one of: 7, 14, 30");
    }

    let geo_key = payload.geo_key.trim().to_ascii_lowercase();
    if geo_key.len() < 4 {
        return error_response(400, "geoKey must be at least 4 characters");
    }
    let geo_prefix = geo_key[..4].to_string();

    let client = db::connect().await?;

    if let Err(feature_locked) =
        entitlements::require_entitlement(&client, user_id, "ai.copilot.weekly_grow_plan").await
    {
        return json_response(403, &feature_locked.to_response());
    }

    let rows = client
        .query(
            "
            select
              geo_boundary_key,
              crop_id,
              listing_count,
              request_count,
              scarcity_score::float8 as scarcity_score,
              abundance_score::float8 as abundance_score
            from list_latest_derived_supply_signals($1, $2, 1, 20, now())
            order by scarcity_score desc, abundance_score desc
            ",
            &[&geo_prefix, &window_days],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let recommendations = build_recommendations(&rows);

    let model_cfg = ai_model_config::load_model_config();
    let model_id = model_cfg.model_id.clone();
    let model_version = format!("{}-{}", model_cfg.response_mode, model_cfg.schema_version);

    let guardrails = ai_guardrails::enforce_and_record(
        &client,
        user_id,
        "ai.copilot.weekly_grow_plan",
        &model_id,
    )
    .await?;

    if !guardrails.allowed {
        return error_response(
            429,
            guardrails
                .reason
                .as_deref()
                .unwrap_or("ai_guardrail_blocked"),
        );
    }

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        geo_prefix,
        window_days,
        recommendation_count = recommendations.len(),
        estimated_tokens = guardrails.estimated_tokens,
        "Generated premium weekly grow plan"
    );

    let response = WeeklyPlanResponse {
        model_id,
        model_version,
        structured_json: true,
        geo_key,
        window_days,
        recommendations,
    };

    if let Err(reason) = structured_json::validate_weekly_plan_response(&response) {
        tracing::warn!(reason = %reason, "Weekly plan schema validation failed; using fallback response");

        let fallback = WeeklyPlanResponse {
            model_id: response.model_id.clone(),
            model_version: response.model_version.clone(),
            structured_json: true,
            geo_key: response.geo_key.clone(),
            window_days: response.window_days,
            recommendations: vec![WeeklyPlanRecommendation {
                recommendation:
                    "Use a balanced planting mix this week while local premium insights recalibrate."
                        .to_string(),
                confidence: 0.4,
                rationale: vec![
                    "Fallback triggered due to response schema validation mismatch.".to_string(),
                ],
            }],
        };

        return json_response(200, &fallback);
    }

    json_response(200, &response)
}

fn build_recommendations(rows: &[Row]) -> Vec<WeeklyPlanRecommendation> {
    if rows.is_empty() {
        return vec![WeeklyPlanRecommendation {
            recommendation: "No strong local signal yet. Plant a small mixed trial bed this week and reassess in 7 days.".to_string(),
            confidence: 0.35,
            rationale: vec![
                "No non-expired local derived signals were available.".to_string(),
                "Mixed trials reduce risk while data accumulates.".to_string(),
            ],
        }];
    }

    let scarce = rows
        .iter()
        .max_by(|a, b| {
            a.get::<_, f64>("scarcity_score")
                .total_cmp(&b.get::<_, f64>("scarcity_score"))
        })
        .unwrap_or(&rows[0]);
    let abundant = rows
        .iter()
        .max_by(|a, b| {
            a.get::<_, f64>("abundance_score")
                .total_cmp(&b.get::<_, f64>("abundance_score"))
        })
        .unwrap_or(&rows[0]);

    let scarce_score = scarce.get::<_, f64>("scarcity_score");
    let abundant_score = abundant.get::<_, f64>("abundance_score");

    vec![
        WeeklyPlanRecommendation {
            recommendation: "Prioritize one crop with the highest scarcity score for this week’s planting block.".to_string(),
            confidence: scarce_score.clamp(0.0, 1.0),
            rationale: vec![
                format!("Top scarcity signal: {:.2}", scarce_score),
                format!("Local demand count: {}", scarce.get::<_, i32>("request_count")),
                format!("Local supply count: {}", scarce.get::<_, i32>("listing_count")),
            ],
        },
        WeeklyPlanRecommendation {
            recommendation: "Throttle expansion of currently abundant crops and allocate less bed space this cycle.".to_string(),
            confidence: abundant_score.clamp(0.0, 1.0),
            rationale: vec![
                format!("Top abundance signal: {:.2}", abundant_score),
                format!("Local supply count: {}", abundant.get::<_, i32>("listing_count")),
                "Avoid oversupply to keep harvest useful and reduce waste.".to_string(),
            ],
        },
    ]
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
mod tests {
    use super::*;

    #[test]
    fn parse_window_days_defaults() {
        let payload = WeeklyPlanRequest {
            geo_key: "9v6k".to_string(),
            window_days: None,
        };
        assert_eq!(payload.window_days.unwrap_or(DEFAULT_WINDOW_DAYS), 7);
    }
}
