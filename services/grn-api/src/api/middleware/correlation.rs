use lambda_http::{Request, Response};
use uuid::Uuid;

/// Header name for correlation ID
pub const CORRELATION_ID_HEADER: &str = "x-correlation-id";

/// Extract correlation ID from request headers or generate a new one
///
/// This function looks for the X-Correlation-Id header in the request.
/// If found, it returns the value. If not found or invalid, it generates
/// a new UUID v4.
///
/// # Arguments
/// * `request` - The incoming HTTP request
///
/// # Returns
/// A correlation ID string (either from header or newly generated)
/// Extract correlation ID from request headers or generate a new one
///
/// This function looks for the X-Correlation-Id header in the request.
/// If found, it returns the value. If not found or invalid, it generates
/// a new UUID v4.
///
/// # Arguments
/// * `request` - The incoming HTTP request
///
/// # Returns
/// A correlation ID string (either from header or newly generated)
pub fn extract_or_generate_correlation_id(request: &Request) -> String {
    request
        .headers()
        .get(CORRELATION_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map_or_else(|| Uuid::new_v4().to_string(), ToString::to_string)
}

/// Add correlation ID to response headers
///
/// This function adds the X-Correlation-Id header to the response,
/// enabling end-to-end request tracing.
///
/// # Arguments
/// * `response` - The HTTP response builder
/// * `correlation_id` - The correlation ID to add
///
/// # Returns
/// The response builder with the correlation ID header added
/// Add correlation ID to response headers
///
/// This function adds the X-Correlation-Id header to the response,
/// enabling end-to-end request tracing.
///
/// # Arguments
/// * `response` - The HTTP response builder
/// * `correlation_id` - The correlation ID to add
///
/// # Returns
/// The response builder with the correlation ID header added
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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use lambda_http::{http::HeaderValue, Body};

    #[test]
    fn test_extract_correlation_id_when_present() {
        let mut request = Request::default();
        let test_id = "test-correlation-id-123";

        request
            .headers_mut()
            .insert(CORRELATION_ID_HEADER, HeaderValue::from_static(test_id));

        let correlation_id = extract_or_generate_correlation_id(&request);
        assert_eq!(correlation_id, test_id);
    }

    #[test]
    fn test_generate_correlation_id_when_missing() {
        let request = Request::default();
        let correlation_id = extract_or_generate_correlation_id(&request);

        // Should be a valid UUID v4
        assert!(Uuid::parse_str(&correlation_id).is_ok());
    }

    #[test]
    fn test_generate_correlation_id_when_empty() {
        let mut request = Request::default();
        request
            .headers_mut()
            .insert(CORRELATION_ID_HEADER, HeaderValue::from_static(""));

        let correlation_id = extract_or_generate_correlation_id(&request);

        // Should generate a new UUID when header is empty
        assert!(Uuid::parse_str(&correlation_id).is_ok());
    }

    #[test]
    fn test_generate_correlation_id_is_unique() {
        let request = Request::default();

        let id1 = extract_or_generate_correlation_id(&request);
        let id2 = extract_or_generate_correlation_id(&request);

        // Each call should generate a unique ID
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_add_correlation_id_to_response() {
        let response = Response::builder()
            .status(200)
            .body(Body::from("test"))
            .unwrap();

        let correlation_id = "test-id-456";
        let response_with_id = add_correlation_id_to_response(response, correlation_id);

        let header_value = response_with_id
            .headers()
            .get(CORRELATION_ID_HEADER)
            .expect("Correlation ID header should be present");

        assert_eq!(header_value.to_str().unwrap(), correlation_id);
    }

    #[test]
    fn test_add_correlation_id_preserves_other_headers() {
        let response = Response::builder()
            .status(200)
            .header("content-type", "application/json")
            .body(Body::from("test"))
            .unwrap();

        let correlation_id = "test-id-789";
        let response_with_id = add_correlation_id_to_response(response, correlation_id);

        // Check correlation ID was added
        assert!(response_with_id
            .headers()
            .get(CORRELATION_ID_HEADER)
            .is_some());

        // Check other headers are preserved
        assert_eq!(
            response_with_id.headers().get("content-type").unwrap(),
            "application/json"
        );
    }

    #[test]
    fn test_correlation_id_header_name_is_lowercase() {
        // HTTP headers are case-insensitive, but we use lowercase by convention
        assert_eq!(CORRELATION_ID_HEADER, "x-correlation-id");
    }

    #[test]
    fn test_extract_correlation_id_with_uuid_format() {
        let mut request = Request::default();
        let uuid = Uuid::new_v4().to_string();

        request
            .headers_mut()
            .insert(CORRELATION_ID_HEADER, HeaderValue::from_str(&uuid).unwrap());

        let correlation_id = extract_or_generate_correlation_id(&request);
        assert_eq!(correlation_id, uuid);
        assert!(Uuid::parse_str(&correlation_id).is_ok());
    }
}
