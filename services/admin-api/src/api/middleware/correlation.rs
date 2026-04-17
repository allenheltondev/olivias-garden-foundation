use lambda_http::{Request, Response};
use uuid::Uuid;

pub const CORRELATION_ID_HEADER: &str = "x-correlation-id";

pub fn extract_or_generate_correlation_id(request: &Request) -> String {
    request
        .headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map_or_else(|| Uuid::new_v4().to_string(), ToString::to_string)
}

pub fn add_correlation_id_to_response<T>(
    mut response: Response<T>,
    correlation_id: &str,
) -> Response<T> {
    if let Ok(header_value) = correlation_id.parse() {
        response
            .headers_mut()
            .insert(CORRELATION_ID_HEADER, header_value);
    }
    response
}
