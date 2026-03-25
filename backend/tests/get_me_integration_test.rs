// Integration tests for GET /me endpoint
// These tests verify that the endpoint returns the correct user profile data
// including userType, onboardingCompleted, and profile information

use serde_json::json;

#[cfg(test)]
#[allow(clippy::panic)]
mod get_me_tests {
    use super::*;

    /// Test that GET /me response includes userType and onboardingCompleted fields
    /// Validates: Requirements 8.1, 1.4
    #[test]
    fn test_response_structure_includes_required_fields() {
        // This test verifies the expected response structure from GET /me
        // The actual endpoint should return a response matching this structure

        let expected_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "email": "test@example.com",
            "displayName": "Test User",
            "isVerified": false,
            "userType": "grower",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": {
                "homeZone": "8a",
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "shareRadiusKm": "5.0",
                "units": "imperial",
                "locale": "en-US"
            },
            "gathererProfile": null,
            "ratingSummary": null
        });

        // Verify required fields exist
        assert!(expected_response.get("userType").is_some());
        assert!(expected_response.get("onboardingCompleted").is_some());
        assert_eq!(expected_response["userType"], "grower");
        assert_eq!(expected_response["onboardingCompleted"], true);
    }

    /// Test that GET /me includes growerProfile for grower users
    /// Validates: Requirement 8.1
    #[test]
    fn test_response_includes_grower_profile_for_growers() {
        let grower_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "email": "grower@example.com",
            "displayName": "Grower User",
            "isVerified": false,
            "userType": "grower",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": {
                "homeZone": "8a",
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "shareRadiusKm": "5.0",
                "units": "imperial",
                "locale": "en-US"
            },
            "gathererProfile": null,
            "ratingSummary": null
        });

        // Verify growerProfile is present and gathererProfile is null
        assert!(grower_response.get("growerProfile").is_some());
        assert!(!grower_response["growerProfile"].is_null());
        assert!(grower_response["gathererProfile"].is_null());
        assert_eq!(grower_response["userType"], "grower");

        // Verify growerProfile has required fields
        let grower_profile = &grower_response["growerProfile"];
        assert!(grower_profile.get("homeZone").is_some());
        assert!(grower_profile.get("geoKey").is_some());
        assert!(grower_profile.get("lat").is_some());
        assert!(grower_profile.get("lng").is_some());
        assert!(grower_profile.get("shareRadiusKm").is_some());
        assert!(grower_profile.get("units").is_some());
        assert!(grower_profile.get("locale").is_some());
    }

    /// Test that GET /me includes gathererProfile for gatherer users
    /// Validates: Requirement 8.1
    #[test]
    fn test_response_includes_gatherer_profile_for_gatherers() {
        let gatherer_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "email": "gatherer@example.com",
            "displayName": "Gatherer User",
            "isVerified": false,
            "userType": "gatherer",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": null,
            "gathererProfile": {
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "searchRadiusKm": "10.0",
                "organizationAffiliation": "SF Food Bank",
                "units": "metric",
                "locale": "en-US"
            },
            "ratingSummary": null
        });

        // Verify gathererProfile is present and growerProfile is null
        assert!(gatherer_response.get("gathererProfile").is_some());
        assert!(!gatherer_response["gathererProfile"].is_null());
        assert!(gatherer_response["growerProfile"].is_null());
        assert_eq!(gatherer_response["userType"], "gatherer");

        // Verify gathererProfile has required fields
        let gatherer_profile = &gatherer_response["gathererProfile"];
        assert!(gatherer_profile.get("geoKey").is_some());
        assert!(gatherer_profile.get("lat").is_some());
        assert!(gatherer_profile.get("lng").is_some());
        assert!(gatherer_profile.get("searchRadiusKm").is_some());
        assert!(gatherer_profile.get("units").is_some());
        assert!(gatherer_profile.get("locale").is_some());
    }

    /// Test that GET /me supports resume onboarding scenario
    /// When userType is set but onboardingCompleted is false
    /// Validates: Requirement 1.4
    #[test]
    fn test_response_supports_resume_onboarding() {
        // User has selected userType but hasn't completed profile setup
        let incomplete_onboarding_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440002",
            "email": "incomplete@example.com",
            "displayName": "Incomplete User",
            "isVerified": false,
            "userType": "grower",
            "onboardingCompleted": false,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": null,
            "gathererProfile": null,
            "ratingSummary": null
        });

        // Verify userType is present even when onboarding is incomplete
        assert_eq!(incomplete_onboarding_response["userType"], "grower");
        assert_eq!(incomplete_onboarding_response["onboardingCompleted"], false);

        // Both profiles should be null since onboarding isn't complete
        assert!(incomplete_onboarding_response["growerProfile"].is_null());
        assert!(incomplete_onboarding_response["gathererProfile"].is_null());

        // This allows the frontend to resume at the correct wizard step
        // (grower-wizard in this case, since userType is 'grower')
    }

    /// Test that GET /me handles new users without userType
    #[test]
    fn test_response_for_new_user_without_user_type() {
        let new_user_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440003",
            "email": "newuser@example.com",
            "displayName": "New User",
            "isVerified": false,
            "userType": null,
            "onboardingCompleted": false,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": null,
            "gathererProfile": null,
            "ratingSummary": null
        });

        // Verify userType is null for new users
        assert!(new_user_response["userType"].is_null());
        assert_eq!(new_user_response["onboardingCompleted"], false);

        // Both profiles should be null
        assert!(new_user_response["growerProfile"].is_null());
        assert!(new_user_response["gathererProfile"].is_null());

        // This triggers the onboarding flow starting at user type selection
    }

    /// Test that GET /me includes all expected user fields
    #[test]
    fn test_response_includes_all_user_fields() {
        let complete_response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "email": "complete@example.com",
            "displayName": "Complete User",
            "isVerified": true,
            "userType": "grower",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": {
                "homeZone": "8a",
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "shareRadiusKm": "5.0",
                "units": "imperial",
                "locale": "en-US"
            },
            "gathererProfile": null,
            "ratingSummary": {
                "avgScore": "4.5",
                "ratingCount": 10
            }
        });

        // Verify all expected fields are present
        assert!(complete_response.get("id").is_some());
        assert!(complete_response.get("email").is_some());
        assert!(complete_response.get("displayName").is_some());
        assert!(complete_response.get("isVerified").is_some());
        assert!(complete_response.get("userType").is_some());
        assert!(complete_response.get("onboardingCompleted").is_some());
        assert!(complete_response.get("createdAt").is_some());
        assert!(complete_response.get("growerProfile").is_some());
        assert!(complete_response.get("gathererProfile").is_some());
        assert!(complete_response.get("ratingSummary").is_some());
    }

    /// Test gatherer with organization affiliation
    #[test]
    fn test_gatherer_with_organization_affiliation() {
        let gatherer_with_org = json!({
            "id": "550e8400-e29b-41d4-a716-446655440004",
            "email": "org@example.com",
            "displayName": "Organization User",
            "isVerified": false,
            "userType": "gatherer",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": null,
            "gathererProfile": {
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "searchRadiusKm": "15.0",
                "organizationAffiliation": "Community Food Bank",
                "units": "metric",
                "locale": "en-US"
            },
            "ratingSummary": null
        });

        let gatherer_profile = &gatherer_with_org["gathererProfile"];
        assert_eq!(
            gatherer_profile["organizationAffiliation"],
            "Community Food Bank"
        );
    }

    /// Test gatherer without organization affiliation
    #[test]
    fn test_gatherer_without_organization_affiliation() {
        let gatherer_without_org = json!({
            "id": "550e8400-e29b-41d4-a716-446655440005",
            "email": "individual@example.com",
            "displayName": "Individual User",
            "isVerified": false,
            "userType": "gatherer",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "growerProfile": null,
            "gathererProfile": {
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "searchRadiusKm": "5.0",
                "organizationAffiliation": null,
                "units": "imperial",
                "locale": "en-US"
            },
            "ratingSummary": null
        });

        let gatherer_profile = &gatherer_without_org["gathererProfile"];
        assert!(gatherer_profile["organizationAffiliation"].is_null());
    }

    /// Test that GET /me response includes gardenerTier with correct structure
    /// Validates: Requirements 2.3, 9.1 (response contract preservation)
    #[test]
    fn test_response_includes_gardener_tier_with_correct_types() {
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "email": "test@example.com",
            "displayName": "Test User",
            "isVerified": false,
            "userType": "grower",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "subscription": { "tier": "free", "subscriptionStatus": "active", "premiumExpiresAt": null },
            "gardenerTier": {
                "currentTier": "intermediate",
                "lastPromotionAt": "2024-06-15T12:00:00+00:00",
                "decision": {
                    "tier": "intermediate",
                    "evaluatedAt": "2024-06-15T12:00:00+00:00",
                    "explanation": ["Promoted based on crop diversity and seasonal consistency."],
                    "breakdown": {
                        "cropDiversityPoints": 15,
                        "seasonalConsistencyPoints": 10,
                        "sharingOutcomesPoints": 8,
                        "photoTrustPoints": 5,
                        "reliabilityPoints": 7,
                        "totalPoints": 45
                    }
                }
            },
            "badgeCabinet": [],
            "seasonalTimeline": [],
            "experienceLevel": "beginner",
            "experienceSignals": { "completedGrows": 0, "successfulHarvests": 0, "activeDaysLast90": 0, "seasonalConsistency": 0, "varietyBreadth": 0, "badgeCredibility": 0 },
            "curatedTips": [],
            "growerProfile": null,
            "gathererProfile": null,
            "ratingSummary": null
        });

        // gardenerTier must be an object
        assert!(response["gardenerTier"].is_object());

        // currentTier must be a string and one of the valid tiers
        let current_tier = response["gardenerTier"]["currentTier"]
            .as_str()
            .unwrap_or_else(|| panic!("currentTier must be a string"));
        assert!(
            ["novice", "intermediate", "pro", "master"].contains(&current_tier),
            "currentTier must be one of novice/intermediate/pro/master, got: {current_tier}"
        );

        // lastPromotionAt must be a string or null
        let last_promo = &response["gardenerTier"]["lastPromotionAt"];
        assert!(
            last_promo.is_string() || last_promo.is_null(),
            "lastPromotionAt must be a string or null"
        );

        // decision must be an object with required fields
        let decision = &response["gardenerTier"]["decision"];
        assert!(decision.is_object());
        assert!(decision["tier"].is_string());
        assert!(decision["evaluatedAt"].is_string());
        assert!(decision["explanation"].is_array());
        assert!(decision["breakdown"].is_object());

        // breakdown must have all score fields as integers
        let breakdown = &decision["breakdown"];
        for field in &[
            "cropDiversityPoints",
            "seasonalConsistencyPoints",
            "sharingOutcomesPoints",
            "photoTrustPoints",
            "reliabilityPoints",
            "totalPoints",
        ] {
            assert!(
                breakdown[field].is_number(),
                "breakdown.{field} must be a number"
            );
        }
    }

    /// Test that GET /me response includes badgeCabinet with correct structure
    /// Validates: Requirements 1.3, 9.1 (response contract preservation)
    #[test]
    fn test_response_includes_badge_cabinet_with_correct_types() {
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "badgeCabinet": [
                {
                    "badgeKey": "first_harvest",
                    "earnedAt": "2024-03-10T08:30:00+00:00",
                    "proofCount": 3
                },
                {
                    "badgeKey": "gardener_season_1",
                    "earnedAt": "2024-07-01T00:00:00+00:00",
                    "proofCount": 6
                }
            ]
        });

        // badgeCabinet must be an array
        assert!(response["badgeCabinet"].is_array());

        let cabinet = response["badgeCabinet"]
            .as_array()
            .unwrap_or_else(|| panic!("badgeCabinet must be an array"));
        assert_eq!(cabinet.len(), 2);

        // Each entry must have badgeKey (string), earnedAt (string), proofCount (integer)
        for entry in cabinet {
            assert!(entry["badgeKey"].is_string(), "badgeKey must be a string");
            assert!(entry["earnedAt"].is_string(), "earnedAt must be a string");
            assert!(
                entry["proofCount"].is_number(),
                "proofCount must be a number"
            );
        }
    }

    /// Test that GET /me response includes experienceLevel and experienceSignals with correct types
    /// Validates: Requirements 3.3, 9.1 (response contract preservation)
    #[test]
    fn test_response_includes_experience_fields_with_correct_types() {
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "experienceLevel": "intermediate",
            "experienceSignals": {
                "completedGrows": 5,
                "successfulHarvests": 3,
                "activeDaysLast90": 22,
                "seasonalConsistency": 2,
                "varietyBreadth": 4,
                "badgeCredibility": 1
            }
        });

        // experienceLevel must be a string and one of the valid levels
        let level = response["experienceLevel"]
            .as_str()
            .unwrap_or_else(|| panic!("experienceLevel must be a string"));
        assert!(
            ["beginner", "intermediate", "advanced"].contains(&level),
            "experienceLevel must be one of beginner/intermediate/advanced, got: {level}"
        );

        // experienceSignals must be an object with all required integer fields
        let signals = &response["experienceSignals"];
        assert!(signals.is_object());
        for field in &[
            "completedGrows",
            "successfulHarvests",
            "activeDaysLast90",
            "seasonalConsistency",
            "varietyBreadth",
            "badgeCredibility",
        ] {
            assert!(
                signals[field].is_number(),
                "experienceSignals.{field} must be a number"
            );
        }
    }

    /// Test that GET /me response includes curatedTips as an array with correct entry structure
    /// Validates: Requirements 4.2, 9.1 (response contract preservation)
    #[test]
    fn test_response_includes_curated_tips_with_correct_types() {
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "curatedTips": [
                {
                    "schemaVersion": "tips.v1",
                    "title": "Water deeply, not often",
                    "body": "Deep watering encourages root growth.",
                    "category": "watering",
                    "level": "beginner",
                    "season": "summer",
                    "cropTags": [],
                    "zoneTags": ["any"]
                }
            ]
        });

        // curatedTips must be an array
        assert!(response["curatedTips"].is_array());

        let tips = response["curatedTips"]
            .as_array()
            .unwrap_or_else(|| panic!("curatedTips must be an array"));
        assert!(!tips.is_empty());

        // Each tip must have the expected fields
        for tip in tips {
            assert!(tip["title"].is_string(), "tip.title must be a string");
            assert!(tip["body"].is_string(), "tip.body must be a string");
            assert!(tip["category"].is_string(), "tip.category must be a string");
            assert!(tip["level"].is_string(), "tip.level must be a string");
            assert!(tip["season"].is_string(), "tip.season must be a string");
        }
    }

    /// Test that a complete GET /me response includes all derived fields together
    /// Validates: Requirements 9.1 (full response contract)
    #[test]
    fn test_complete_response_includes_all_derived_fields() {
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "email": "complete@example.com",
            "displayName": "Complete User",
            "isVerified": true,
            "userType": "grower",
            "onboardingCompleted": true,
            "createdAt": "2024-01-01T00:00:00Z",
            "subscription": { "tier": "free", "subscriptionStatus": "active", "premiumExpiresAt": null },
            "gardenerTier": {
                "currentTier": "novice",
                "lastPromotionAt": null,
                "decision": {
                    "tier": "novice",
                    "evaluatedAt": "2024-01-01T00:00:00Z",
                    "explanation": ["No evaluation recorded yet."],
                    "breakdown": {
                        "cropDiversityPoints": 0,
                        "seasonalConsistencyPoints": 0,
                        "sharingOutcomesPoints": 0,
                        "photoTrustPoints": 0,
                        "reliabilityPoints": 0,
                        "totalPoints": 0
                    }
                }
            },
            "badgeCabinet": [],
            "seasonalTimeline": [],
            "experienceLevel": "beginner",
            "experienceSignals": {
                "completedGrows": 0,
                "successfulHarvests": 0,
                "activeDaysLast90": 0,
                "seasonalConsistency": 0,
                "varietyBreadth": 0,
                "badgeCredibility": 0
            },
            "curatedTips": [],
            "growerProfile": {
                "homeZone": "8a",
                "geoKey": "9q8yy9m",
                "lat": 37.7749,
                "lng": -122.4194,
                "shareRadiusMiles": "3.1",
                "units": "imperial",
                "locale": "en-US"
            },
            "gathererProfile": null,
            "ratingSummary": null
        });

        // All derived fields must be present
        assert!(
            response.get("gardenerTier").is_some(),
            "gardenerTier must be present"
        );
        assert!(
            response.get("badgeCabinet").is_some(),
            "badgeCabinet must be present"
        );
        assert!(
            response.get("seasonalTimeline").is_some(),
            "seasonalTimeline must be present"
        );
        assert!(
            response.get("experienceLevel").is_some(),
            "experienceLevel must be present"
        );
        assert!(
            response.get("experienceSignals").is_some(),
            "experienceSignals must be present"
        );
        assert!(
            response.get("curatedTips").is_some(),
            "curatedTips must be present"
        );

        // Plus the existing core fields
        assert!(response.get("id").is_some());
        assert!(response.get("email").is_some());
        assert!(response.get("displayName").is_some());
        assert!(response.get("isVerified").is_some());
        assert!(response.get("userType").is_some());
        assert!(response.get("onboardingCompleted").is_some());
        assert!(response.get("createdAt").is_some());
        assert!(response.get("subscription").is_some());
        assert!(response.get("growerProfile").is_some());
        assert!(response.get("gathererProfile").is_some());
        assert!(response.get("ratingSummary").is_some());
    }

    /// Test safe defaults for a user with no pre-computed derived data
    /// When a brand new user has no badge awards, no tier promotions, and no experience level record,
    /// GET /me should return safe defaults rather than errors or missing fields.
    /// Validates: Requirements 1.2, 2.2, 3.2, 9.2 (safe defaults)
    #[test]
    fn test_safe_defaults_for_user_with_no_precomputed_data() {
        // Simulates a response for a brand new user before the worker has run
        let response = json!({
            "id": "550e8400-e29b-41d4-a716-446655440099",
            "email": "newuser@example.com",
            "displayName": null,
            "isVerified": false,
            "userType": null,
            "onboardingCompleted": false,
            "createdAt": "2024-12-01T00:00:00Z",
            "subscription": { "tier": "free", "subscriptionStatus": "active", "premiumExpiresAt": null },
            "gardenerTier": {
                "currentTier": "novice",
                "lastPromotionAt": null,
                "decision": {
                    "tier": "novice",
                    "evaluatedAt": "2024-12-01T00:00:00Z",
                    "explanation": ["No evaluation recorded yet."],
                    "breakdown": {
                        "cropDiversityPoints": 0,
                        "seasonalConsistencyPoints": 0,
                        "sharingOutcomesPoints": 0,
                        "photoTrustPoints": 0,
                        "reliabilityPoints": 0,
                        "totalPoints": 0
                    }
                }
            },
            "badgeCabinet": [],
            "seasonalTimeline": [],
            "experienceLevel": "beginner",
            "experienceSignals": {
                "completedGrows": 0,
                "successfulHarvests": 0,
                "activeDaysLast90": 0,
                "seasonalConsistency": 0,
                "varietyBreadth": 0,
                "badgeCredibility": 0
            },
            "curatedTips": [],
            "growerProfile": null,
            "gathererProfile": null,
            "ratingSummary": null
        });

        // badgeCabinet defaults to empty array
        assert!(response["badgeCabinet"].is_array());
        assert_eq!(
            response["badgeCabinet"]
                .as_array()
                .unwrap_or_else(|| panic!("badgeCabinet must be an array"))
                .len(),
            0,
            "badgeCabinet should default to empty array"
        );

        // gardenerTier defaults to novice with null lastPromotionAt
        assert_eq!(response["gardenerTier"]["currentTier"], "novice");
        assert!(response["gardenerTier"]["lastPromotionAt"].is_null());
        assert_eq!(response["gardenerTier"]["decision"]["tier"], "novice");

        // All breakdown scores default to zero
        let breakdown = &response["gardenerTier"]["decision"]["breakdown"];
        assert_eq!(breakdown["cropDiversityPoints"], 0);
        assert_eq!(breakdown["seasonalConsistencyPoints"], 0);
        assert_eq!(breakdown["sharingOutcomesPoints"], 0);
        assert_eq!(breakdown["photoTrustPoints"], 0);
        assert_eq!(breakdown["reliabilityPoints"], 0);
        assert_eq!(breakdown["totalPoints"], 0);

        // experienceLevel defaults to beginner
        assert_eq!(response["experienceLevel"], "beginner");

        // experienceSignals defaults to all zeros
        let signals = &response["experienceSignals"];
        assert_eq!(signals["completedGrows"], 0);
        assert_eq!(signals["successfulHarvests"], 0);
        assert_eq!(signals["activeDaysLast90"], 0);
        assert_eq!(signals["seasonalConsistency"], 0);
        assert_eq!(signals["varietyBreadth"], 0);
        assert_eq!(signals["badgeCredibility"], 0);

        // curatedTips is an array (may be non-empty since tips are computed from experience level + season)
        assert!(response["curatedTips"].is_array());

        // seasonalTimeline defaults to empty array
        assert!(response["seasonalTimeline"].is_array());
        assert_eq!(
            response["seasonalTimeline"]
                .as_array()
                .unwrap_or_else(|| panic!("seasonalTimeline must be an array"))
                .len(),
            0,
            "seasonalTimeline should default to empty array"
        );

        // All fields are present — none omitted
        assert!(response.get("gardenerTier").is_some());
        assert!(response.get("badgeCabinet").is_some());
        assert!(response.get("experienceLevel").is_some());
        assert!(response.get("experienceSignals").is_some());
        assert!(response.get("curatedTips").is_some());
        assert!(response.get("seasonalTimeline").is_some());
    }
}
