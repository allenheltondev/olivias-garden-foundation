use tokio_postgres::Client;
use uuid::Uuid;

pub struct GuardrailsConfig {
    pub max_daily_requests_per_user: i64,
    pub max_daily_tokens_per_user: i64,
    pub default_estimated_tokens: i32,
}

pub struct GuardrailsDecision {
    pub allowed: bool,
    pub reason: Option<String>,
    pub estimated_tokens: i32,
}

pub fn load_config() -> GuardrailsConfig {
    GuardrailsConfig {
        max_daily_requests_per_user: std::env::var("AI_MAX_DAILY_REQUESTS_PER_USER")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(30),
        max_daily_tokens_per_user: std::env::var("AI_MAX_DAILY_TOKENS_PER_USER")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(60000),
        default_estimated_tokens: std::env::var("AI_DEFAULT_ESTIMATED_TOKENS")
            .ok()
            .and_then(|v| v.parse::<i32>().ok())
            .unwrap_or(1200),
    }
}

pub async fn enforce_and_record(
    client: &Client,
    user_id: Uuid,
    feature_key: &str,
    model_id: &str,
) -> Result<GuardrailsDecision, lambda_http::Error> {
    let cfg = load_config();

    let row = client
        .query_one(
            "
            select
              count(*)::bigint as request_count,
              coalesce(sum(estimated_tokens), 0)::bigint as token_sum
            from ai_usage_events
            where user_id = $1
              and created_at >= now() - interval '24 hours'
              and status = 'allowed'
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let request_count: i64 = row.get("request_count");
    let token_sum: i64 = row.get("token_sum");

    let (allowed, reason): (bool, Option<String>) = if request_count
        >= cfg.max_daily_requests_per_user
    {
        (false, Some("daily_request_cap_reached".to_string()))
    } else if token_sum + i64::from(cfg.default_estimated_tokens) > cfg.max_daily_tokens_per_user {
        (false, Some("daily_token_cap_reached".to_string()))
    } else {
        (true, None)
    };

    client
        .execute(
            "
            insert into ai_usage_events (
              user_id, feature_key, model_id, estimated_tokens, estimated_cost_usd, status, reason
            )
            values ($1, $2, $3, $4, 0, $5, $6)
            ",
            &[
                &user_id,
                &feature_key,
                &model_id,
                &cfg.default_estimated_tokens,
                &(if allowed { "allowed" } else { "blocked" }),
                &reason,
            ],
        )
        .await
        .map_err(|e| db_error(&e))?;

    Ok(GuardrailsDecision {
        allowed,
        reason,
        estimated_tokens: cfg.default_estimated_tokens,
    })
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}
