use crate::auth::extract_auth_context;
use crate::db;
use crate::handlers::analytics;
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use std::collections::HashMap;
use std::env;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionRequest {
    pub success_url: String,
    pub cancel_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionResponse {
    pub checkout_url: String,
    pub checkout_session_id: String,
}

pub async fn create_checkout_session(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    let user_id = Uuid::parse_str(&auth.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: CreateCheckoutSessionRequest = parse_json_body(request)?;

    let stripe_secret = env::var("STRIPE_SECRET_KEY")
        .map_err(|_| lambda_http::Error::from("STRIPE_SECRET_KEY is not configured"))?;
    let stripe_price_id = env::var("STRIPE_PRO_PRICE_ID")
        .map_err(|_| lambda_http::Error::from("STRIPE_PRO_PRICE_ID is not configured"))?;

    let mut form = HashMap::new();
    form.insert("mode", "subscription".to_string());
    form.insert("line_items[0][price]", stripe_price_id);
    form.insert("line_items[0][quantity]", "1".to_string());
    form.insert("success_url", payload.success_url);
    form.insert("cancel_url", payload.cancel_url);
    form.insert("metadata[user_id]", user_id.to_string());
    form.insert("subscription_data[metadata][user_id]", user_id.to_string());

    let client = reqwest::Client::new();
    let stripe_resp = client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .basic_auth(stripe_secret, Some(""))
        .form(&form)
        .send()
        .await
        .map_err(|e| lambda_http::Error::from(format!("Stripe request failed: {e}")))?;

    if !stripe_resp.status().is_success() {
        let status = stripe_resp.status();
        let body = stripe_resp.text().await.unwrap_or_default();
        return Err(lambda_http::Error::from(format!(
            "Stripe checkout creation failed ({status}): {body}"
        )));
    }

    let payload: Value = stripe_resp
        .json()
        .await
        .map_err(|e| lambda_http::Error::from(format!("Invalid Stripe response JSON: {e}")))?;

    let checkout_url = payload
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| lambda_http::Error::from("Stripe checkout URL missing"))?;
    let checkout_session_id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| lambda_http::Error::from("Stripe checkout id missing"))?;

    let _ = analytics::log_backend_event(
        &db::connect().await?,
        Some(user_id),
        "checkout_start",
        Some(serde_json::json!({ "checkoutSessionId": checkout_session_id })),
    )
    .await;

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        checkout_session_id = checkout_session_id,
        "Created Stripe checkout session"
    );

    json_response(
        200,
        &CreateCheckoutSessionResponse {
            checkout_url: checkout_url.to_string(),
            checkout_session_id: checkout_session_id.to_string(),
        },
    )
}

pub async fn handle_webhook(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let raw_body = extract_raw_body(request)?;
    verify_stripe_signature(request, &raw_body)?;

    let event: Value = serde_json::from_str(&raw_body)
        .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}")))?;
    let event_id = event
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| lambda_http::Error::from("Stripe event missing id"))?;
    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let event_created = event
        .get("created")
        .and_then(Value::as_i64)
        .unwrap_or_default();

    let object = event
        .get("data")
        .and_then(|d| d.get("object"))
        .ok_or_else(|| lambda_http::Error::from("Stripe event missing data.object"))?;

    let client = db::connect().await?;

    let inserted = client
        .execute(
            "
            insert into stripe_webhook_events (id, event_type, created_unix)
            values ($1, $2, $3)
            on conflict (id) do nothing
            ",
            &[&event_id, &event_type, &event_created],
        )
        .await
        .map_err(|e| db_error(&e))?;

    if inserted == 0 {
        tracing::info!(
            correlation_id = correlation_id,
            event_id,
            event_type,
            "Duplicate Stripe webhook event ignored"
        );
        return json_response(
            200,
            &serde_json::json!({"received": true, "duplicate": true}),
        );
    }

    let result = match event_type {
        "checkout.session.completed" => {
            apply_checkout_session_completed(&client, object, event_created).await
        }
        "customer.subscription.deleted" | "customer.subscription.updated" => {
            apply_subscription_update(&client, object, event_created).await
        }
        _ => {
            tracing::info!(
                correlation_id = correlation_id,
                event_type,
                supported = is_supported_event_type(event_type),
                "Ignoring unsupported Stripe webhook event"
            );
            Ok(())
        }
    };

    if let Err(err) = result {
        let payload_json: serde_json::Value = serde_json::to_value(&event).unwrap_or_default();
        let _ = client
            .execute(
                "
                insert into stripe_webhook_failures (event_id, event_type, reason, payload)
                values ($1, $2, $3, $4)
                ",
                &[&event_id, &event_type, &err, &payload_json],
            )
            .await;

        return Err(lambda_http::Error::from(format!(
            "Stripe webhook processing failed: {err}"
        )));
    }

    json_response(200, &serde_json::json!({"received": true}))
}

async fn apply_checkout_session_completed(
    client: &tokio_postgres::Client,
    object: &Value,
    event_created: i64,
) -> Result<(), String> {
    if let Some(user_id) = extract_user_id_from_object(object) {
        let stripe_customer_id = object.get("customer").and_then(Value::as_str);
        let stripe_subscription_id = object.get("subscription").and_then(Value::as_str);

        client
            .execute(
                "
                update users
                   set tier = 'pro',
                       subscription_status = 'active',
                       stripe_customer_id = coalesce($2, stripe_customer_id),
                       stripe_subscription_id = coalesce($3, stripe_subscription_id),
                       stripe_last_event_created = greatest(coalesce(stripe_last_event_created, 0), $4),
                       updated_at = now()
                 where id = $1
                   and deleted_at is null
                   and coalesce(stripe_last_event_created, 0) <= $4
                ",
                &[&user_id, &stripe_customer_id, &stripe_subscription_id, &event_created],
            )
            .await
            .map_err(|e| format!("Failed to apply checkout completion: {e}"))?;

        let _ = analytics::log_backend_event(
            client,
            Some(user_id),
            "subscribe",
            Some(serde_json::json!({
                "source": "stripe_webhook",
                "status": "active"
            })),
        )
        .await;
    }

    Ok(())
}

async fn apply_subscription_update(
    client: &tokio_postgres::Client,
    object: &Value,
    event_created: i64,
) -> Result<(), String> {
    let stripe_subscription_id = object.get("id").and_then(Value::as_str);
    let status = object
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("canceled");

    if let Some(subscription_id) = stripe_subscription_id {
        let (tier, sub_status) = map_subscription_status(status);
        let current_period_end_unix = extract_current_period_end_unix(object);
        let updated = client
            .execute(
                "
                update users
                   set tier = $2,
                       subscription_status = $3,
                       pro_expires_at = case
                           when $2 = 'pro' and $5 is not null then to_timestamp($5)
                           when $2 = 'pro' then pro_expires_at
                           else null
                       end,
                       stripe_last_event_created = greatest(coalesce(stripe_last_event_created, 0), $4),
                       updated_at = now()
                 where stripe_subscription_id = $1
                   and coalesce(stripe_last_event_created, 0) <= $4
                ",
                &[&subscription_id, &tier, &sub_status, &event_created, &current_period_end_unix],
            )
            .await
            .map_err(|e| format!("Failed to apply subscription update: {e}"))?;

        if updated > 0 {
            let event_name = if tier == "pro" { "subscribe" } else { "cancel" };
            let _ = analytics::log_backend_event(
                client,
                None,
                event_name,
                Some(serde_json::json!({
                    "source": "stripe_webhook",
                    "subscriptionStatus": sub_status
                })),
            )
            .await;
        }
    }

    Ok(())
}

fn extract_user_id_from_object(object: &Value) -> Option<Uuid> {
    let from_metadata = object
        .get("metadata")
        .and_then(|m| m.get("user_id"))
        .and_then(Value::as_str);

    from_metadata.and_then(|s| Uuid::parse_str(s).ok())
}

fn extract_current_period_end_unix(object: &Value) -> Option<i64> {
    object.get("current_period_end").and_then(Value::as_i64)
}

fn is_supported_event_type(event_type: &str) -> bool {
    matches!(
        event_type,
        "checkout.session.completed"
            | "customer.subscription.deleted"
            | "customer.subscription.updated"
    )
}

fn map_subscription_status(status: &str) -> (&'static str, &'static str) {
    match status {
        "active" | "trialing" => ("pro", "active"),
        "past_due" => ("pro", "past_due"),
        "incomplete" | "incomplete_expired" => ("free", "none"),
        _ => ("free", "canceled"),
    }
}

fn extract_raw_body(request: &Request) -> Result<String, lambda_http::Error> {
    match request.body() {
        Body::Text(text) => Ok(text.clone()),
        Body::Binary(bytes) => String::from_utf8(bytes.clone())
            .map_err(|e| lambda_http::Error::from(format!("Invalid UTF-8 body: {e}"))),
        Body::Empty => Err(lambda_http::Error::from(
            "Request body is required".to_string(),
        )),
    }
}

fn verify_stripe_signature(request: &Request, body: &str) -> Result<(), lambda_http::Error> {
    let secret = env::var("STRIPE_WEBHOOK_SECRET")
        .map_err(|_| lambda_http::Error::from("STRIPE_WEBHOOK_SECRET is not configured"))?;
    let signature_header = request
        .headers()
        .get("Stripe-Signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| lambda_http::Error::from("Missing Stripe-Signature header"))?;

    verify_signature_with_secret(&secret, signature_header, body)
}

fn verify_signature_with_secret(
    secret: &str,
    signature_header: &str,
    body: &str,
) -> Result<(), lambda_http::Error> {
    type HmacSha256 = hmac::Hmac<Sha256>;
    use hmac::Mac;

    let mut timestamp: Option<String> = None;
    let mut candidate_signatures: Vec<String> = Vec::new();

    for piece in signature_header.split(',') {
        if let Some((k, v)) = piece.split_once('=') {
            match k.trim() {
                "t" => timestamp = Some(v.trim().to_string()),
                "v1" => candidate_signatures.push(v.trim().to_string()),
                _ => {}
            }
        }
    }

    let ts =
        timestamp.ok_or_else(|| lambda_http::Error::from("Stripe signature missing timestamp"))?;
    if candidate_signatures.is_empty() {
        return Err(lambda_http::Error::from(
            "Stripe signature missing v1 digest".to_string(),
        ));
    }

    let signed_payload = format!("{ts}.{body}");
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| lambda_http::Error::from("Invalid webhook secret"))?;
    mac.update(signed_payload.as_bytes());
    let expected = hex::encode(mac.finalize().into_bytes());

    if candidate_signatures.iter().any(|sig| sig == &expected) {
        Ok(())
    } else {
        Err(lambda_http::Error::from(
            "Invalid Stripe signature".to_string(),
        ))
    }
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

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn map_subscription_status_active_maps_to_pro_active() {
        let (tier, status) = map_subscription_status("active");
        assert_eq!(tier, "pro");
        assert_eq!(status, "active");
    }

    #[test]
    fn map_subscription_status_trialing_maps_to_pro_active() {
        let (tier, status) = map_subscription_status("trialing");
        assert_eq!(tier, "pro");
        assert_eq!(status, "active");
    }

    #[test]
    fn map_subscription_status_past_due_maps_to_pro_past_due() {
        let (tier, status) = map_subscription_status("past_due");
        assert_eq!(tier, "pro");
        assert_eq!(status, "past_due");
    }

    #[test]
    fn map_subscription_status_canceled_maps_to_free_canceled() {
        let (tier, status) = map_subscription_status("canceled");
        assert_eq!(tier, "free");
        assert_eq!(status, "canceled");
    }

    #[test]
    fn extract_user_id_from_object_uses_metadata_user_id() {
        let user_id = Uuid::new_v4();
        let payload = json!({
            "metadata": {
                "user_id": user_id.to_string()
            }
        });

        let parsed = extract_user_id_from_object(&payload);
        assert_eq!(parsed, Some(user_id));
    }

    #[test]
    fn extract_user_id_from_object_returns_none_for_missing_or_invalid_values() {
        let missing = json!({});
        let invalid = json!({"metadata": {"user_id": "not-a-uuid"}});

        assert_eq!(extract_user_id_from_object(&missing), None);
        assert_eq!(extract_user_id_from_object(&invalid), None);
    }

    #[test]
    fn extract_current_period_end_unix_reads_subscription_window() {
        let payload = json!({"current_period_end": 1_767_225_600});
        assert_eq!(
            extract_current_period_end_unix(&payload),
            Some(1_767_225_600)
        );
    }

    #[test]
    fn map_subscription_status_incomplete_maps_to_free_none() {
        let (tier, status) = map_subscription_status("incomplete");
        assert_eq!(tier, "free");
        assert_eq!(status, "none");
    }

    #[test]
    fn map_subscription_status_incomplete_expired_maps_to_free_none() {
        let (tier, status) = map_subscription_status("incomplete_expired");
        assert_eq!(tier, "free");
        assert_eq!(status, "none");
    }

    #[test]
    fn map_subscription_status_unpaid_maps_to_free_canceled() {
        let (tier, status) = map_subscription_status("unpaid");
        assert_eq!(tier, "free");
        assert_eq!(status, "canceled");
    }

    #[test]
    fn verify_signature_accepts_valid_hmac() {
        use hmac::Mac;
        type HmacSha256 = hmac::Hmac<Sha256>;

        let secret = "whsec_test";
        let body = "{\"id\":\"evt_1\"}";
        let timestamp = "1700000000";
        let signed_payload = format!("{timestamp}.{body}");

        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(signed_payload.as_bytes());
        let digest = hex::encode(mac.finalize().into_bytes());
        let header = format!("t={timestamp},v1={digest}");

        assert!(verify_signature_with_secret(secret, &header, body).is_ok());
    }

    #[test]
    fn verify_signature_rejects_invalid_hmac() {
        let secret = "whsec_test";
        let body = "{\"id\":\"evt_1\"}";
        let err =
            verify_signature_with_secret(secret, "t=1700000000,v1=deadbeef", body).unwrap_err();
        assert!(err.to_string().contains("Invalid Stripe signature"));
    }

    #[test]
    fn verify_signature_rejects_missing_timestamp() {
        let secret = "whsec_test";
        let body = "{\"id\":\"evt_1\"}";
        let err = verify_signature_with_secret(secret, "v1=abc123", body).unwrap_err();
        assert!(err.to_string().contains("missing timestamp"));
    }

    #[test]
    fn verify_signature_rejects_missing_v1_digest() {
        let secret = "whsec_test";
        let body = "{\"id\":\"evt_1\"}";
        let err = verify_signature_with_secret(secret, "t=1700000000", body).unwrap_err();
        assert!(err.to_string().contains("missing v1 digest"));
    }

    #[test]
    fn supported_event_type_list_is_strict() {
        assert!(is_supported_event_type("checkout.session.completed"));
        assert!(is_supported_event_type("customer.subscription.updated"));
        assert!(is_supported_event_type("customer.subscription.deleted"));
        assert!(!is_supported_event_type("invoice.payment_failed"));
    }
}
