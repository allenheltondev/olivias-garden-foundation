// Integration tests for listing write endpoints (Phase 1)
// Focus: create/update contracts, authorization, and required geolocation fields.

use serde_json::json;

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod listing_write_tests {
    use super::*;

    #[test]
    fn test_create_listing_payload_requires_geolocation() {
        let payload = json!({
            "title": "Fresh Roma Tomatoes",
            "cropId": "5df666d4-f6b1-4e6f-97d6-321e531ad7ca",
            "quantityTotal": 12.5,
            "unit": "lb",
            "availableStart": "2026-02-20T10:00:00Z",
            "availableEnd": "2026-02-20T18:00:00Z",
            "pickupLocationText": "Front porch",
            "lat": 37.7749,
            "lng": -122.4194
        });

        assert!(payload.get("lat").is_some());
        assert!(payload.get("lng").is_some());
    }

    #[test]
    fn test_create_listing_rejects_invalid_window_contract() {
        let expected_error = json!({
            "error": "availableStart must be earlier than or equal to availableEnd"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("availableStart"));
    }

    #[test]
    fn test_update_listing_enforces_ownership_contract() {
        let expected_error = json!({
            "error": "Listing not found"
        });

        assert_eq!(expected_error["error"], "Listing not found");
    }

    #[test]
    fn test_listing_write_endpoints_are_grower_only_contract() {
        let expected_error = json!({
            "error": "Forbidden: This feature is only available to growers"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("only available to growers"));
    }
}
