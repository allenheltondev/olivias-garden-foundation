use crate::handlers::store;
use crate::middleware::correlation::{
    add_correlation_id_to_response, extract_or_generate_correlation_id,
};
use lambda_http::{Body, Request, Response};
use std::env;
use tracing::{error, info};

fn add_cors_headers(mut response: Response<Body>) -> Response<Body> {
    let origin = env::var("ORIGIN").unwrap_or_else(|_| "*".to_string());

    let headers = response.headers_mut();

    if let Ok(value) = origin.parse() {
        headers.insert("Access-Control-Allow-Origin", value);
    }
    if let Ok(value) = "GET,POST,PUT,DELETE,OPTIONS".parse() {
        headers.insert("Access-Control-Allow-Methods", value);
    }
    if let Ok(value) = "Content-Type,Authorization,Idempotency-Key,X-Correlation-Id,X-Amz-Date,X-Api-Key,X-Amz-Security-Token".parse() {
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
        ("GET", "/store/products") => handle(store::list_public_products().await)?,
        ("GET", "/admin/store/products") => {
            handle(store::list_admin_products(event, &correlation_id).await)?
        }
        ("POST", "/admin/store/products") => {
            handle(store::create_store_product(event, &correlation_id).await)?
        }
        _ => route_dynamic_routes(event, &correlation_id, request_path).await?,
    };

    let response = add_correlation_id_to_response(add_cors_headers(response), &correlation_id);
    let status = response.status().as_u16();

    if status >= 500 {
        error!(
            correlation_id = correlation_id.as_str(),
            method = event.method().as_str(),
            path = request_path,
            status,
            "Response sent with server error"
        );
    } else {
        info!(
            correlation_id = correlation_id.as_str(),
            method = event.method().as_str(),
            path = request_path,
            status,
            "Response sent"
        );
    }

    Ok(response)
}

async fn route_dynamic_routes(
    event: &Request,
    correlation_id: &str,
    request_path: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    if let Some(product_id) = request_path.strip_prefix("/admin/store/products/") {
        let result = match event.method().as_str() {
            "PUT" => store::update_store_product(event, correlation_id, product_id).await,
            _ => method_not_allowed(),
        };
        return handle(result);
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
        || message.contains("product id must be a valid UUID")
        || message.contains("Request body is required")
        || message.contains("slug must be lowercase kebab-case")
        || message.contains("name is required")
        || message.contains("kind must be one of")
        || message.contains("status must be one of")
        || message.contains("fulfillmentType must be one of")
        || message.contains("currency must be a 3-letter lowercase ISO code")
        || message.contains("unitAmountCents must be greater than or equal to 0")
        || message.contains("metadata must be a JSON object")
    {
        return store::error_response(400, &message);
    }

    if message.contains("Store product not found") {
        return store::error_response(404, &message);
    }

    if message.contains("Missing userId in authorizer context") {
        return store::error_response(401, &message);
    }

    if message.contains("Forbidden:") {
        return store::error_response(403, &message);
    }

    if message.contains("is not configured") {
        return store::error_response(503, "Service not configured in this environment");
    }

    store::error_response(500, &message)
}
