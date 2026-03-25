use serde::{Deserialize, Serialize};
use tokio_postgres::Client;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum GardenerTier {
    Novice,
    Intermediate,
    Pro,
    Master,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
pub struct GardenerTierScoreBreakdown {
    pub crop_diversity_points: i32,
    pub seasonal_consistency_points: i32,
    pub sharing_outcomes_points: i32,
    pub photo_trust_points: i32,
    pub reliability_points: i32,
    pub total_points: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenerTierDecision {
    pub tier: GardenerTier,
    pub evaluated_at: String,
    pub explanation: Vec<String>,
    pub breakdown: GardenerTierScoreBreakdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenerTierProfile {
    pub current_tier: GardenerTier,
    pub last_promotion_at: Option<String>,
    pub decision: GardenerTierDecision,
}

/// Read-only tier query — no scoring, no promotion inserts.
pub async fn load_tier_read_only(
    client: &Client,
    user_id: Uuid,
) -> Result<GardenerTierProfile, lambda_http::Error> {
    let row = client
        .query_opt(
            "select tier::text as tier, promoted_at, explanation, score_breakdown from gardener_tier_promotions where user_id = $1 order by promoted_at desc limit 1",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    #[allow(clippy::option_if_let_else)]
    match row {
        Some(row) => {
            let tier_str: String = row.get("tier");
            let tier = parse_tier(&tier_str).unwrap_or(GardenerTier::Novice);
            let promoted_at: chrono::DateTime<chrono::Utc> = row.get("promoted_at");
            let breakdown_json: serde_json::Value = row.get("score_breakdown");
            let breakdown: GardenerTierScoreBreakdown = serde_json::from_value(breakdown_json)
                .unwrap_or(GardenerTierScoreBreakdown {
                    crop_diversity_points: 0,
                    seasonal_consistency_points: 0,
                    sharing_outcomes_points: 0,
                    photo_trust_points: 0,
                    reliability_points: 0,
                    total_points: 0,
                });
            let explanation_text: String = row.get("explanation");
            let explanation: Vec<String> = explanation_text
                .split(". ")
                .filter(|s| !s.is_empty())
                .map(|s| {
                    let trimmed = s.trim();
                    if trimmed.ends_with('.') {
                        trimmed.to_string()
                    } else {
                        format!("{trimmed}.")
                    }
                })
                .collect();

            Ok(GardenerTierProfile {
                current_tier: tier.clone(),
                last_promotion_at: Some(promoted_at.to_rfc3339()),
                decision: GardenerTierDecision {
                    tier,
                    evaluated_at: promoted_at.to_rfc3339(),
                    explanation,
                    breakdown,
                },
            })
        }
        None => Ok(default_novice_profile()),
    }
}

pub fn default_novice_profile() -> GardenerTierProfile {
    let now = chrono::Utc::now().to_rfc3339();
    GardenerTierProfile {
        current_tier: GardenerTier::Novice,
        last_promotion_at: None,
        decision: GardenerTierDecision {
            tier: GardenerTier::Novice,
            evaluated_at: now,
            explanation: vec!["No evaluation recorded yet.".to_string()],
            breakdown: GardenerTierScoreBreakdown {
                crop_diversity_points: 0,
                seasonal_consistency_points: 0,
                sharing_outcomes_points: 0,
                photo_trust_points: 0,
                reliability_points: 0,
                total_points: 0,
            },
        },
    }
}

fn parse_tier(value: &str) -> Option<GardenerTier> {
    match value {
        "novice" => Some(GardenerTier::Novice),
        "intermediate" => Some(GardenerTier::Intermediate),
        "pro" => Some(GardenerTier::Pro),
        "master" => Some(GardenerTier::Master),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn default_novice_profile_has_correct_tier_and_zero_breakdown() {
        let profile = default_novice_profile();

        assert_eq!(profile.current_tier, GardenerTier::Novice);
        assert!(profile.last_promotion_at.is_none());
        assert_eq!(profile.decision.tier, GardenerTier::Novice);
        assert_eq!(
            profile.decision.explanation,
            vec!["No evaluation recorded yet."]
        );

        let b = &profile.decision.breakdown;
        assert_eq!(b.crop_diversity_points, 0);
        assert_eq!(b.seasonal_consistency_points, 0);
        assert_eq!(b.sharing_outcomes_points, 0);
        assert_eq!(b.photo_trust_points, 0);
        assert_eq!(b.reliability_points, 0);
        assert_eq!(b.total_points, 0);
    }

    #[test]
    fn default_novice_profile_serializes_with_correct_json_shape() {
        let profile = default_novice_profile();
        let json =
            serde_json::to_value(&profile).unwrap_or_else(|e| panic!("serialization failed: {e}"));

        assert_eq!(json["currentTier"], "novice");
        assert!(json["lastPromotionAt"].is_null());
        assert_eq!(json["decision"]["tier"], "novice");
        assert_eq!(json["decision"]["breakdown"]["cropDiversityPoints"], 0);
        assert_eq!(
            json["decision"]["breakdown"]["seasonalConsistencyPoints"],
            0
        );
        assert_eq!(json["decision"]["breakdown"]["sharingOutcomesPoints"], 0);
        assert_eq!(json["decision"]["breakdown"]["photoTrustPoints"], 0);
        assert_eq!(json["decision"]["breakdown"]["reliabilityPoints"], 0);
        assert_eq!(json["decision"]["breakdown"]["totalPoints"], 0);
    }
}
