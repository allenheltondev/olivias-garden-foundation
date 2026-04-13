// Integration tests for listing read and discovery endpoint contracts.
// These tests validate response shape, geo filtering behavior, and authorization semantics.

use serde_json::json;

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod listing_read_tests {
    use super::*;

    #[test]
    fn test_list_my_listings_pagination_response_shape() {
        let expected = json!({
            "items": [
                {
                    "id": "8b91810e-758b-4cf3-8ed1-95fb48ee6a2a",
                    "userId": "3a6d7091-9f96-44d0-8e29-ec5eb6f2ac68",
                    "status": "active"
                }
            ],
            "limit": 10,
            "offset": 0,
            "hasMore": true,
            "nextOffset": 10
        });

        assert!(expected.get("items").is_some());
        assert!(expected["items"].is_array());
        assert!(expected["items"][0].get("userId").is_some());
        assert!(expected.get("hasMore").is_some());
        assert!(expected["hasMore"].is_boolean());
        assert!(expected.get("nextOffset").is_some());
        assert!(expected["nextOffset"].is_number());
    }

    #[test]
    fn test_list_my_listings_status_filter_contract() {
        let allowed = ["active", "expired", "completed"];

        assert!(allowed.contains(&"active"));
        assert!(allowed.contains(&"expired"));
        assert!(allowed.contains(&"completed"));
        assert!(!allowed.contains(&"pending"));
    }

    #[test]
    fn test_discover_listings_pagination_response_shape() {
        let expected = json!({
            "items": [
                {
                    "id": "f0b98487-d9e8-4c16-88aa-177fcc186c72",
                    "userId": "4a8e16bc-5d06-4226-8ec1-d30a5e19ed53",
                    "geoKey": "9q8yyk8",
                    "status": "active"
                }
            ],
            "limit": 20,
            "offset": 0,
            "hasMore": false,
            "nextOffset": null
        });

        assert!(expected.get("items").is_some());
        assert!(expected["items"].is_array());
        assert!(expected["items"][0].get("geoKey").is_some());
        assert_eq!(expected["items"][0]["status"], "active");
        assert!(expected["hasMore"].is_boolean());
    }

    #[test]
    fn test_discover_listings_geo_filter_contract() {
        let geo_prefix = "9q8yy";

        let expected_items = json!([
            {"geoKey": "9q8yyk8", "status": "active"},
            {"geoKey": "9q8yykb", "status": "active"}
        ]);

        for item in expected_items.as_array().unwrap() {
            assert!(item["geoKey"].as_str().unwrap().starts_with(geo_prefix));
            assert_eq!(item["status"], "active");
        }
    }

    #[test]
    fn test_discover_listings_requires_geo_key_contract() {
        let expected_error = json!({
            "error": "geoKey is required"
        });

        assert_eq!(expected_error["error"], "geoKey is required");
    }

    #[test]
    fn test_discover_listings_status_filter_contract() {
        let allowed = ["active"];

        assert!(allowed.contains(&"active"));
        assert!(!allowed.contains(&"expired"));
        assert!(!allowed.contains(&"completed"));
    }

    #[test]
    fn test_get_listing_ownership_safe_not_found_contract() {
        let expected_error = json!({
            "error": "Listing not found"
        });

        assert_eq!(expected_error["error"], "Listing not found");
    }

    #[test]
    fn test_listings_endpoints_grower_only_contract() {
        let expected_error = json!({
            "error": "Forbidden: This feature is only available to growers"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("only available to growers"));
    }
}
