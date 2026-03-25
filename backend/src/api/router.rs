use crate::handlers::{
    agent_task, ai_copilot, analytics, billing, catalog, claim, claim_read, crop, feed, listing,
    listing_discovery, reminder, request, user,
};
use crate::middleware::correlation::{
    add_correlation_id_to_response, extract_or_generate_correlation_id,
};
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use std::env;
use tracing::{error, info};

fn add_cors_headers(mut response: Response<Body>) -> Response<Body> {
    let origin = env::var("ORIGIN").unwrap_or_else(|_| "http://localhost:5173".to_string());

    let headers = response.headers_mut();

    if let Ok(value) = origin.parse() {
        headers.insert("Access-Control-Allow-Origin", value);
    }
    if let Ok(value) = "GET,POST,PUT,DELETE,OPTIONS".parse() {
        headers.insert("Access-Control-Allow-Methods", value);
    }
    if let Ok(value) = "Content-Type,Authorization,Idempotency-Key,Stripe-Signature,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token".parse() {
        headers.insert("Access-Control-Allow-Headers", value);
    }
    if let Ok(value) = "3600".parse() {
        headers.insert("Access-Control-Max-Age", value);
    }

    response
}

fn normalize_route_path(path: &str) -> &str {
    match path {
        "/api" => "/",
        _ => path
            .strip_prefix("/api")
            .filter(|normalized| normalized.starts_with('/'))
            .unwrap_or(path),
    }
}

pub async fn route_request(event: &Request) -> Result<Response<Body>, lambda_http::Error> {
    let correlation_id = extract_or_generate_correlation_id(event);

    let request_path = normalize_route_path(event.uri().path());

    info!(
        correlation_id = correlation_id.as_str(),
        method = event.method().as_str(),
        raw_path = event.uri().path(),
        path = request_path,
        "Request received"
    );

    if event.method().as_str() == "OPTIONS" {
        let response = Response::builder()
            .status(200)
            .body(Body::Empty)
            .map_err(|e| lambda_http::Error::from(e.to_string()))?;

        return Ok(add_correlation_id_to_response(
            add_cors_headers(response),
            &correlation_id,
        ));
    }

    let response = match (event.method().as_str(), request_path) {
        ("GET", "/me") => handle(user::get_current_user(event, &correlation_id).await)?,
        ("PUT", "/me") => handle(user::upsert_current_user(event, &correlation_id).await)?,
        ("GET", "/me/entitlements") => {
            handle(user::get_current_entitlements(event, &correlation_id).await)?
        }

        ("POST", "/billing/checkout-session") => {
            handle(billing::create_checkout_session(event, &correlation_id).await)?
        }
        ("POST", "/billing/webhook") => {
            handle(billing::handle_webhook(event, &correlation_id).await)?
        }

        ("POST", "/ai/copilot/weekly-plan") => {
            handle(ai_copilot::generate_weekly_plan(event, &correlation_id).await)?
        }

        ("POST", "/analytics/premium/events") => {
            handle(analytics::track_premium_event(event, &correlation_id).await)?
        }
        ("GET", "/analytics/premium/kpis") => {
            handle(analytics::get_premium_kpis(event, &correlation_id).await)?
        }

        ("GET", "/agent-tasks") => {
            handle(agent_task::list_agent_tasks(event, &correlation_id).await)?
        }
        ("POST", "/agent-tasks") => {
            handle(agent_task::create_agent_task(event, &correlation_id).await)?
        }

        ("GET", "/crops") => handle(crop::list_my_crops(event, &correlation_id).await)?,
        ("POST", "/crops") => handle(crop::create_my_crop(event, &correlation_id).await)?,

        ("GET", "/my/listings") => handle(listing::list_my_listings(event, &correlation_id).await)?,
        ("GET", "/listings/discover") => {
            handle(listing_discovery::discover_listings(event, &correlation_id).await)?
        }
        ("GET", "/feed/derived") => handle(feed::get_derived_feed(event, &correlation_id).await)?,
        ("POST", "/listings") => handle(listing::create_listing(event, &correlation_id).await)?,
        ("POST", "/requests") => handle(request::create_request(event, &correlation_id).await)?,
        ("GET", "/claims") => handle(claim_read::list_claims(event, &correlation_id).await)?,
        ("POST", "/claims") => handle(claim::create_claim(event, &correlation_id).await)?,

        ("GET", "/reminders") => handle(reminder::list_reminders(event, &correlation_id).await)?,
        ("POST", "/reminders") => handle(reminder::create_reminder(event, &correlation_id).await)?,

        ("GET", "/catalog/crops") => handle(catalog::list_catalog_crops().await)?,

        _ => route_dynamic_routes(event, &correlation_id, request_path).await?,
    };

    let response_with_cors = add_cors_headers(response);
    let response_with_correlation =
        add_correlation_id_to_response(response_with_cors, &correlation_id);

    let response_status = response_with_correlation.status().as_u16();

    if response_status >= 500 {
        error!(
            correlation_id = correlation_id.as_str(),
            method = event.method().as_str(),
            path = request_path,
            status = response_status,
            "Response sent with server error"
        );
    } else {
        info!(
            correlation_id = correlation_id.as_str(),
            method = event.method().as_str(),
            path = request_path,
            status = response_status,
            "Response sent"
        );
    }

    Ok(response_with_correlation)
}

async fn route_dynamic_routes(
    event: &Request,
    correlation_id: &str,
    request_path: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    if let Some(crop_library_id) = request_path.strip_prefix("/crops/") {
        let result = match event.method().as_str() {
            "GET" => crop::get_my_crop(event, correlation_id, crop_library_id).await,
            "PUT" => crop::update_my_crop(event, correlation_id, crop_library_id).await,
            "DELETE" => crop::delete_my_crop(event, correlation_id, crop_library_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(listing_id) = request_path.strip_prefix("/my/listings/") {
        let result = match event.method().as_str() {
            "GET" => listing::get_listing(event, correlation_id, listing_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(listing_id) = request_path.strip_prefix("/listings/") {
        let result = match event.method().as_str() {
            "PUT" => listing::update_listing(event, correlation_id, listing_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(request_id) = request_path.strip_prefix("/requests/") {
        let result = match event.method().as_str() {
            "PUT" => request::update_request(event, correlation_id, request_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(reminder_id) = request_path.strip_prefix("/reminders/") {
        let result = match event.method().as_str() {
            "PUT" => reminder::update_reminder_status(event, correlation_id, reminder_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(task_id) = request_path.strip_prefix("/agent-tasks/") {
        let result = match event.method().as_str() {
            "PUT" => agent_task::update_agent_task_status(event, correlation_id, task_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(claim_id) = request_path.strip_prefix("/claims/") {
        let result = match event.method().as_str() {
            "PUT" => claim::transition_claim(event, correlation_id, claim_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
    }

    if let Some(user_id) = request_path.strip_prefix("/users/") {
        return if event.method().as_str() == "GET" {
            handle(user::get_public_user(user_id).await)
        } else {
            method_not_allowed()
        };
    }

    if let Some(crop_id) = request_path.strip_prefix("/catalog/crops/") {
        if let Some(crop_id) = crop_id.strip_suffix("/varieties") {
            return if event.method().as_str() == "GET" {
                handle(catalog::list_catalog_varieties(crop_id).await)
            } else {
                method_not_allowed()
            };
        }
    }

    Response::builder()
        .status(404)
        .header("content-type", "application/json")
        .body(Body::from(r#"{"error":"Not Found"}"#))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

fn method_not_allowed() -> Result<Response<Body>, lambda_http::Error> {
    Response::builder()
        .status(405)
        .header("content-type", "application/json")
        .body(Body::from(r#"{"error":"Method Not Allowed"}"#))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

fn handle(
    result: Result<Response<Body>, lambda_http::Error>,
) -> Result<Response<Body>, lambda_http::Error> {
    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            error!(error = %error, "Request handler returned error");
            map_api_error_to_response(&error)
        }
    }
}

fn map_api_error_to_response(
    error: &lambda_http::Error,
) -> Result<Response<Body>, lambda_http::Error> {
    let message = error.to_string();

    if message.contains("Invalid JSON body")
        || message.contains("must be a valid UUID")
        || message.contains("Invalid status")
        || message.contains("Invalid claim status")
        || message.contains("Invalid claim transition")
        || message.contains("Invalid visibility")
        || message.contains("Invalid listing status")
        || message.contains("Invalid limit")
        || message.contains("Invalid offset")
        || message.contains("Invalid pickupDisclosurePolicy")
        || message.contains("Invalid contactPref")
        || message.contains("quantityTotal")
        || message.contains("quantity must be greater than 0")
        || message.contains("quantityClaimed must be greater than 0")
        || message.contains("availableStart")
        || message.contains("availableEnd")
        || message.contains("neededBy must be")
        || message.contains("title is required")
        || message.contains("unit is required")
        || message.contains("does not reference an existing catalog crop")
        || message.contains("must belong to the specified crop_id")
        || message.contains("must belong to the specified cropId")
        || message.contains("Request body is required")
        || message.contains("units must be one of")
        || message.contains("homeZone")
        || message.contains("address is required")
        || message.contains("pickupAddress is required because grower profile address is missing")
        || message.contains("geoKey")
        || message.contains("windowDays")
        || message.contains("radiusMiles")
        || message.contains("shareRadiusMiles")
        || message.contains("searchRadiusMiles")
        || message.contains("Gatherer profile location is required")
        || message.contains("Listing is not claimable")
        || message.contains("requestId must reference an open request")
        || message.contains("requestId crop must match listing crop")
    {
        return crop::error_response(400, &message);
    }

    if message.contains("Insufficient quantity remaining") {
        return crop::error_response(409, &message);
    }

    if message.contains("Request not found")
        || message.contains("Claim not found")
        || message.contains("Listing not found")
    {
        return crop::error_response(404, &message);
    }

    if message.contains("Geocoding service unavailable") {
        return crop::error_response(503, &message);
    }

    if message.contains("is not configured") {
        return crop::error_response(503, "Service not configured in this environment");
    }

    if message.contains("Address could not be geocoded") {
        return crop::error_response(400, &message);
    }

    if message.contains("Missing userId in authorizer context") {
        return crop::error_response(401, &message);
    }

    if message.contains("user type not set")
        || message.contains("onboarding may be incomplete")
        || message.contains("Please complete onboarding")
    {
        return onboarding_incomplete_response();
    }

    if message.contains("Forbidden:") {
        return crop::error_response(403, &message);
    }

    crop::error_response(500, &message)
}

#[derive(Serialize)]
struct OnboardingIncompleteError {
    error: String,
    message: String,
}

fn onboarding_incomplete_response() -> Result<Response<Body>, lambda_http::Error> {
    let payload = OnboardingIncompleteError {
        error: "onboarding_incomplete".to_string(),
        message:
            "User type is not configured. Set userType via PUT /me before calling this endpoint."
                .to_string(),
    };

    let body = serde_json::to_string(&payload)
        .map_err(|e| lambda_http::Error::from(format!("Failed to serialize response: {e}")))?;

    Response::builder()
        .status(403)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{map_api_error_to_response, normalize_route_path};
    use lambda_http::Body;

    #[test]
    fn normalize_route_path_strips_api_stage_prefix() {
        assert_eq!(normalize_route_path("/api/crops"), "/crops");
        assert_eq!(normalize_route_path("/api/catalog/crops"), "/catalog/crops");
    }

    #[test]
    fn normalize_route_path_leaves_non_stage_paths_unchanged() {
        assert_eq!(normalize_route_path("/crops"), "/crops");
        assert_eq!(normalize_route_path("/catalog/crops"), "/catalog/crops");
        assert_eq!(normalize_route_path("/api"), "/");
    }

    #[test]
    fn map_api_error_maps_share_radius_miles_validation_to_400() {
        let error = lambda_http::Error::from("shareRadiusMiles must be greater than 0".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 400);
    }

    #[test]
    fn map_api_error_maps_search_radius_miles_validation_to_400() {
        let error =
            lambda_http::Error::from("searchRadiusMiles must be greater than 0".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 400);
    }

    #[test]
    fn map_api_error_maps_request_needed_by_validation_to_400() {
        let error =
            lambda_http::Error::from("neededBy must be within the next 365 days".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 400);
    }

    #[test]
    fn map_api_error_maps_insufficient_quantity_to_409() {
        let error = lambda_http::Error::from("Insufficient quantity remaining".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 409);
    }

    #[test]
    fn map_api_error_maps_request_not_found_to_404() {
        let error = lambda_http::Error::from("Request not found".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 404);
    }

    #[test]
    fn map_api_error_maps_listing_not_found_to_404() {
        let error = lambda_http::Error::from("Listing not found".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 404);
    }

    #[test]
    fn map_api_error_maps_missing_user_type_to_403() {
        let error =
            lambda_http::Error::from("user type not set, onboarding may be incomplete".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 403);
    }

    #[test]
    fn map_api_error_maps_not_configured_to_503() {
        let error = lambda_http::Error::from("STRIPE_SECRET_KEY is not configured".to_string());
        let response = map_api_error_to_response(&error).unwrap();
        assert_eq!(response.status().as_u16(), 503);

        let body = match response.body() {
            Body::Text(text) => text.as_str(),
            _ => "",
        };
        assert!(
            body.contains("Service not configured"),
            "503 body should use generic message, not leak env var names"
        );
    }

    #[test]
    fn map_api_error_missing_user_type_returns_onboarding_code_and_message() {
        let error = lambda_http::Error::from(
            "Forbidden: User type not set. Please complete onboarding.".to_string(),
        );
        let response = map_api_error_to_response(&error).unwrap();

        assert_eq!(response.status().as_u16(), 403);

        let body = match response.body() {
            Body::Text(text) => text,
            Body::Binary(bytes) => std::str::from_utf8(bytes).unwrap(),
            Body::Empty => "",
        };

        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(
            json.get("error").and_then(serde_json::Value::as_str),
            Some("onboarding_incomplete")
        );
        assert_eq!(
            json.get("message").and_then(serde_json::Value::as_str),
            Some("User type is not configured. Set userType via PUT /me before calling this endpoint.")
        );
    }
}
