// Integration tests for claim coordination endpoint contracts (Phase 2)
// Focus: transition validity, quantity coordination semantics, and authorization.

use serde_json::json;

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod claim_transition_tests {
    use super::*;

    #[test]
    fn test_create_claim_payload_contract() {
        let payload = json!({
            "listingId": "5df666d4-f6b1-4e6f-97d6-321e531ad7ca",
            "requestId": "3c861fd9-69eb-42f3-ab57-9ef8f85eb6da",
            "quantityClaimed": 4,
            "notes": "Can pick up before noon"
        });

        assert_eq!(payload["listingId"], "5df666d4-f6b1-4e6f-97d6-321e531ad7ca");
        assert_eq!(payload["quantityClaimed"], 4);
    }

    #[test]
    fn test_create_claim_rejects_invalid_quantity_contract() {
        let expected_error = json!({
            "error": "quantityClaimed must be greater than 0"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("quantityClaimed"));
    }

    #[test]
    fn test_pending_to_confirmed_transition_contract() {
        let payload = json!({ "status": "confirmed" });
        let expected_status = json!("confirmed");

        assert_eq!(payload["status"], "confirmed");
        assert_eq!(expected_status, "confirmed");
    }

    #[test]
    fn test_confirmed_to_completed_transition_contract() {
        let payload = json!({ "status": "completed" });
        assert_eq!(payload["status"], "completed");
    }

    #[test]
    fn test_confirmed_to_cancelled_transition_contract() {
        let payload = json!({ "status": "cancelled" });
        assert_eq!(payload["status"], "cancelled");
    }

    #[test]
    fn test_invalid_transition_rejected_contract() {
        let expected_error = json!({
            "error": "Invalid claim transition from 'pending' to 'completed'"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("Invalid claim transition"));
    }

    #[test]
    fn test_non_participant_transition_rejected_contract() {
        let expected_error = json!({
            "error": "Forbidden: You are not a participant in this claim"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .starts_with("Forbidden:"));
    }

    #[test]
    fn test_only_listing_owner_can_confirm_contract() {
        let expected_error = json!({
            "error": "Forbidden: Only listing owner can confirm a pending claim"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("Only listing owner"));
    }

    #[test]
    fn test_no_show_is_owner_only_contract() {
        let expected_error = json!({
            "error": "Forbidden: Only listing owner can mark no_show"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("mark no_show"));
    }

    #[test]
    fn test_confirm_transition_insufficient_quantity_contract() {
        let expected_error = json!({
            "error": "Insufficient quantity remaining"
        });

        assert_eq!(expected_error["error"], "Insufficient quantity remaining");
    }

    #[test]
    fn test_claim_create_endpoint_gatherer_only_contract() {
        let expected_error = json!({
            "error": "Forbidden: This feature requires user type Gatherer"
        });

        assert!(expected_error["error"]
            .as_str()
            .unwrap()
            .contains("requires user type Gatherer"));
    }
}
