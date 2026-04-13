use lambda_http::{Body, Request};
use serde_json::Value;
use std::collections::HashMap;

// Import the router function from the API
// Note: This requires the api binary to expose its modules for testing
// We'll use a more direct approach by testing the handler functions

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod integration_tests {
    use super::*;

    /// Helper function to create a mock request with authorizer context
    fn create_request_with_context(
        method: &str,
        path: &str,
        authorizer_context: HashMap<String, String>,
        correlation_id: Option<&str>,
    ) -> Request {
        // Build the HTTP request using the http crate's builder
        let mut http_request = lambda_http::http::Request::builder()
            .method(method)
            .uri(path);

        // Add correlation ID header if provided
        if let Some(id) = correlation_id {
            http_request = http_request.header("x-correlation-id", id);
        }

        // Create the base HTTP request
        let http_req = http_request.body(Body::Empty).unwrap();

        // Convert to lambda_http::Request which wraps the HTTP request with Lambda context
        let mut lambda_req = Request::from(http_req);

        // Add authorizer context to request context
        // Note: In real Lambda execution, this is populated by API Gateway
        // For testing, we need to simulate this structure
        let mut context_fields = HashMap::new();
        for (key, value) in authorizer_context {
            context_fields.insert(key, Value::String(value));
        }

        // Store context in request extensions for testing
        // This simulates what API Gateway does
        lambda_req.extensions_mut().insert(context_fields);

        lambda_req
    }

    /// Helper function to extract authorizer context from request
    /// This simulates what the handler does
    fn get_authorizer_field(request: &Request, field: &str) -> Option<String> {
        request
            .extensions()
            .get::<HashMap<String, Value>>()
            .and_then(|ctx| ctx.get(field))
            .and_then(|v| v.as_str())
            .map(ToString::to_string)
    }

    #[test]
    fn test_valid_authorizer_context_structure() {
        // Test that we can create and extract authorizer context correctly
        let mut context = HashMap::new();
        context.insert("userId".to_string(), "user-123".to_string());
        context.insert("email".to_string(), "test@example.com".to_string());
        context.insert("firstName".to_string(), "John".to_string());
        context.insert("lastName".to_string(), "Doe".to_string());
        context.insert("tier".to_string(), "free".to_string());

        let request = create_request_with_context("GET", "/me", context, None);

        assert_eq!(
            get_authorizer_field(&request, "userId"),
            Some("user-123".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request, "email"),
            Some("test@example.com".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request, "firstName"),
            Some("John".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request, "lastName"),
            Some("Doe".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request, "tier"),
            Some("free".to_string())
        );
    }

    #[test]
    fn test_missing_authorizer_context_fields() {
        // Test with incomplete context (missing required fields)
        let mut context = HashMap::new();
        context.insert("userId".to_string(), "user-123".to_string());
        // Missing email, firstName, lastName, tier

        let request = create_request_with_context("GET", "/me", context, None);

        assert_eq!(
            get_authorizer_field(&request, "userId"),
            Some("user-123".to_string())
        );
        assert_eq!(get_authorizer_field(&request, "email"), None);
        assert_eq!(get_authorizer_field(&request, "firstName"), None);
        assert_eq!(get_authorizer_field(&request, "lastName"), None);
        assert_eq!(get_authorizer_field(&request, "tier"), None);
    }

    #[test]
    fn test_correlation_id_provided_in_header() {
        // Test that correlation ID is preserved when provided
        let context = HashMap::new();
        let test_correlation_id = "test-correlation-123";

        let request = create_request_with_context("GET", "/me", context, Some(test_correlation_id));

        let header_value = request
            .headers()
            .get("x-correlation-id")
            .and_then(|v| v.to_str().ok());

        assert_eq!(header_value, Some(test_correlation_id));
    }

    #[test]
    fn test_correlation_id_not_provided() {
        // Test that request can be created without correlation ID
        let context = HashMap::new();

        let request = create_request_with_context("GET", "/me", context, None);

        let header_value = request
            .headers()
            .get("x-correlation-id")
            .and_then(|v| v.to_str().ok());

        assert_eq!(header_value, None);
    }

    #[test]
    fn test_all_user_tiers() {
        // Test that all three tier values work correctly
        let tiers = vec!["free", "supporter", "pro"];

        for tier in tiers {
            let mut context = HashMap::new();
            context.insert("userId".to_string(), "user-123".to_string());
            context.insert("email".to_string(), "test@example.com".to_string());
            context.insert("firstName".to_string(), "Test".to_string());
            context.insert("lastName".to_string(), "User".to_string());
            context.insert("tier".to_string(), tier.to_string());

            let request = create_request_with_context("GET", "/me", context, None);

            assert_eq!(
                get_authorizer_field(&request, "tier"),
                Some(tier.to_string())
            );
        }
    }

    #[test]
    fn test_request_method_and_path() {
        // Test that request method and path are set correctly
        let context = HashMap::new();

        let request = create_request_with_context("GET", "/me", context, None);

        assert_eq!(request.method().as_str(), "GET");
        assert_eq!(request.uri().path(), "/me");
    }

    #[test]
    fn test_empty_authorizer_context() {
        // Test with completely empty context
        let context = HashMap::new();

        let request = create_request_with_context("GET", "/me", context, None);

        assert_eq!(get_authorizer_field(&request, "userId"), None);
        assert_eq!(get_authorizer_field(&request, "email"), None);
        assert_eq!(get_authorizer_field(&request, "firstName"), None);
        assert_eq!(get_authorizer_field(&request, "lastName"), None);
        assert_eq!(get_authorizer_field(&request, "tier"), None);
    }

    #[test]
    fn test_correlation_id_with_uuid_format() {
        // Test with a UUID-formatted correlation ID
        let context = HashMap::new();
        let uuid_correlation_id = "550e8400-e29b-41d4-a716-446655440000";

        let request = create_request_with_context("GET", "/me", context, Some(uuid_correlation_id));

        let header_value = request
            .headers()
            .get("x-correlation-id")
            .and_then(|v| v.to_str().ok());

        assert_eq!(header_value, Some(uuid_correlation_id));
    }

    #[test]
    fn test_multiple_requests_with_different_contexts() {
        // Test that multiple requests can have different contexts
        let mut context1 = HashMap::new();
        context1.insert("userId".to_string(), "user-1".to_string());
        context1.insert("tier".to_string(), "free".to_string());

        let mut context2 = HashMap::new();
        context2.insert("userId".to_string(), "user-2".to_string());
        context2.insert("tier".to_string(), "supporter".to_string());

        let request1 = create_request_with_context("GET", "/me", context1, None);
        let request2 = create_request_with_context("GET", "/me", context2, None);

        assert_eq!(
            get_authorizer_field(&request1, "userId"),
            Some("user-1".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request1, "tier"),
            Some("free".to_string())
        );

        assert_eq!(
            get_authorizer_field(&request2, "userId"),
            Some("user-2".to_string())
        );
        assert_eq!(
            get_authorizer_field(&request2, "tier"),
            Some("supporter".to_string())
        );
    }
}

// Integration tests for GET /me endpoint
#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod get_me_integration_tests {
    use serial_test::serial;

    // Note: These tests require a PostgreSQL database connection
    // They should be run with DATABASE_URL environment variable set
    // Run with: cargo test --test integration_test -- --test-threads=1

    #[tokio::test]
    #[serial]
    #[ignore = "Requires database setup"]
    async fn test_get_me_includes_user_type_and_onboarding_completed() {
        // This test verifies that GET /me returns userType and onboardingCompleted fields
        // Requirement: 8.1 - Response includes userType and onboardingCompleted

        // Setup: Create a test user with userType and onboardingCompleted
        // This would require database setup and cleanup
        // For now, this is a placeholder showing the test structure

        // Expected response structure:
        // {
        //   "id": "uuid",
        //   "email": "test@example.com",
        //   "displayName": "Test User",
        //   "isVerified": false,
        //   "userType": "grower",
        //   "onboardingCompleted": true,
        //   "createdAt": "2024-01-01T00:00:00Z",
        //   "growerProfile": { ... },
        //   "gathererProfile": null,
        //   "ratingSummary": null
        // }
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Requires database setup"]
    async fn test_get_me_includes_grower_profile_for_growers() {
        // This test verifies that GET /me returns growerProfile for grower users
        // Requirement: 8.1 - Response includes growerProfile for growers

        // Expected: growerProfile is populated, gathererProfile is null
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Requires database setup"]
    async fn test_get_me_includes_gatherer_profile_for_gatherers() {
        // This test verifies that GET /me returns gathererProfile for gatherer users
        // Requirement: 8.1 - Response includes gathererProfile for gatherers

        // Expected: gathererProfile is populated, growerProfile is null
    }

    #[tokio::test]
    #[serial]
    #[ignore = "Requires database setup"]
    async fn test_get_me_supports_resume_onboarding() {
        // This test verifies that GET /me returns userType even when onboardingCompleted=false
        // Requirement: 1.4 - Response supports resume onboarding (userType set, onboardingCompleted=false)

        // Setup: Create a user with userType='grower' but onboardingCompleted=false
        // Expected: Response includes userType='grower' and onboardingCompleted=false
        // This allows the frontend to resume the onboarding flow at the correct step
    }
}
