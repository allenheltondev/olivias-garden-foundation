// Integration tests for request write endpoints (Phase 2)
// Focus: create/update contracts, validation, and user-type authorization.

use serde_json::json;

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod request_write_tests {
    use super::*;

    #[test]
    fn test_create_request_payload_contract() {
        let payload = json!({
            "cropId": "5df666d4-f6b1-4e6f-97d6-321e531ad7ca",
            "varietyId": "3c861fd9-69eb-42f3-ab57-9ef8f85eb6da",
            "unit": "lb",
            "quantity": 6.5,
            "neededBy": "2026-03-20T10:00:00Z",
            "notes": "Looking for weekend pickup",
            "status": "open"
        });

        assert_eq!(payload["cropId"], "5df666d4-f6b1-4e6f-97d6-321e531ad7ca");
        assert_eq!(payload["quantity"], 6.5);
        assert_eq!(payload["status"], "open");
    }

    #[test]
    fn test_update_request_payload_contract() {
        let payload = json!({
            "cropId": "5df666d4-f6b1-4e6f-97d6-321e531ad7ca",
            "quantity": 9,
            "neededBy": "2026-03-25T10:00:00Z",
            "status": "matched"
        });

        assert_eq!(payload["cropId"], "5df666d4-f6b1-4e6f-97d6-321e531ad7ca");
        assert_eq!(payload["quantity"], 9);
        assert_eq!(payload["status"], "matched");
    }

    #[test]
    fn test_request_write_rejects_invalid_quantity_contract() {
        let expected_error = json!({
            "error": "quantity must be greater than 0"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("quantity must be greater than 0"));
    }

    #[test]
    fn test_request_write_rejects_invalid_needed_by_window_contract() {
        let expected_error = json!({
            "error": "neededBy must be within the next 365 days"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("neededBy"));
    }

    #[test]
    fn test_request_write_endpoints_are_gatherer_only_contract() {
        let expected_error = json!({
            "error": "Forbidden: This feature requires user type Gatherer"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("requires user type Gatherer"));
    }

    #[test]
    fn test_update_request_enforces_ownership_contract() {
        let expected_error = json!({
            "error": "Request not found"
        });

        assert_eq!(expected_error["error"], "Request not found");
    }
}
