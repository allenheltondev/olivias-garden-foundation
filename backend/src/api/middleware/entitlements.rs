use crate::models::entitlements::{
    EntitlementsPolicy, EntitlementsResponse, FeatureLockedErrorResponse,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;
use tokio_postgres::Client;
use uuid::Uuid;

const ENTITLEMENTS_CONFIG_JSON: &str =
    include_str!("../../../../config/entitlements/v1.tiers.json");
const DEFAULT_TIER: &str = "free";
const PREMIUM_TIER: &str = "premium";

static ENTITLEMENTS_CONFIG: OnceLock<Result<EntitlementsConfig, String>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct EntitlementsConfig {
    version: String,
    tiers: HashMap<String, TierConfig>,
    policies: PolicyConfig,
}

#[derive(Debug, Deserialize)]
struct TierConfig {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    description: Option<String>,
    #[serde(default)]
    inherits: Vec<String>,
    #[serde(default)]
    entitlements: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct PolicyConfig {
    ai_is_premium_only: bool,
    free_reminders_are_deterministic_only: bool,
}

#[allow(dead_code)]
pub struct FeatureLockedError {
    pub entitlement_key: String,
}

#[allow(dead_code)]
impl FeatureLockedError {
    pub fn to_response(&self) -> FeatureLockedErrorResponse {
        FeatureLockedErrorResponse {
            error: "feature_locked".to_string(),
            entitlement_key: self.entitlement_key.clone(),
            required_tier: PREMIUM_TIER.to_string(),
            upgrade_hint_key: "upgrade.premium".to_string(),
        }
    }
}

pub async fn get_entitlements_snapshot(
    client: &Client,
    user_id: Uuid,
) -> Result<EntitlementsResponse, lambda_http::Error> {
    let tier = load_user_tier(client, user_id).await?;
    let config = load_entitlements_config()?;
    let resolved_tier = if config.tiers.contains_key(&tier) {
        tier
    } else {
        DEFAULT_TIER.to_string()
    };

    let entitlements = resolve_entitlements_for_tier(config, &resolved_tier)?;

    Ok(EntitlementsResponse {
        tier: resolved_tier,
        entitlements_version: config.version.clone(),
        entitlements,
        policy: EntitlementsPolicy {
            ai_is_premium_only: config.policies.ai_is_premium_only,
            free_reminders_deterministic_only: config
                .policies
                .free_reminders_are_deterministic_only,
        },
    })
}

pub async fn require_entitlement(
    client: &Client,
    user_id: Uuid,
    entitlement_key: &str,
) -> Result<(), FeatureLockedError> {
    let snapshot = get_entitlements_snapshot(client, user_id)
        .await
        .map_err(|_| FeatureLockedError {
            entitlement_key: entitlement_key.to_string(),
        })?;

    if snapshot
        .entitlements
        .iter()
        .any(|key| key == entitlement_key)
    {
        Ok(())
    } else {
        Err(FeatureLockedError {
            entitlement_key: entitlement_key.to_string(),
        })
    }
}

#[cfg(test)]
fn tier_has_entitlement(
    config: &EntitlementsConfig,
    tier: &str,
    entitlement_key: &str,
) -> Result<bool, lambda_http::Error> {
    let entitlements = resolve_entitlements_for_tier(config, tier)?;
    Ok(entitlements.iter().any(|key| key == entitlement_key))
}

fn load_entitlements_config() -> Result<&'static EntitlementsConfig, lambda_http::Error> {
    let config = ENTITLEMENTS_CONFIG.get_or_init(|| {
        serde_json::from_str::<EntitlementsConfig>(ENTITLEMENTS_CONFIG_JSON)
            .map_err(|e| format!("Failed to parse entitlements config: {e}"))
    });

    match config {
        Ok(parsed) => Ok(parsed),
        Err(error) => Err(lambda_http::Error::from(error.clone())),
    }
}

fn resolve_entitlements_for_tier(
    config: &EntitlementsConfig,
    tier: &str,
) -> Result<Vec<String>, lambda_http::Error> {
    let mut entitlements = BTreeSet::new();
    let mut visiting = HashSet::new();

    collect_entitlements_recursive(config, tier, &mut entitlements, &mut visiting)?;

    Ok(entitlements.into_iter().collect())
}

fn collect_entitlements_recursive(
    config: &EntitlementsConfig,
    tier: &str,
    entitlements: &mut BTreeSet<String>,
    visiting: &mut HashSet<String>,
) -> Result<(), lambda_http::Error> {
    if !visiting.insert(tier.to_string()) {
        return Err(lambda_http::Error::from(format!(
            "Entitlements config cycle detected at tier '{tier}'"
        )));
    }

    let tier_config = config.tiers.get(tier).ok_or_else(|| {
        lambda_http::Error::from(format!("Unknown tier in entitlements config: {tier}"))
    })?;

    for parent in &tier_config.inherits {
        collect_entitlements_recursive(config, parent, entitlements, visiting)?;
    }

    for entitlement in &tier_config.entitlements {
        entitlements.insert(entitlement.clone());
    }

    visiting.remove(tier);

    Ok(())
}

async fn load_user_tier(client: &Client, user_id: Uuid) -> Result<String, lambda_http::Error> {
    let row = client
        .query_opt(
            "select tier from users where id = $1 and deleted_at is null",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    Ok(row
        .and_then(|r| r.get::<_, Option<String>>("tier"))
        .unwrap_or_else(|| DEFAULT_TIER.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_or_skip() -> Option<&'static EntitlementsConfig> {
        let config = load_entitlements_config();
        assert!(
            config.is_ok(),
            "entitlements config should parse successfully"
        );
        config.ok()
    }

    fn resolve_or_skip(config: &EntitlementsConfig, tier: &str) -> Option<Vec<String>> {
        let entitlements = resolve_entitlements_for_tier(config, tier);
        assert!(entitlements.is_ok(), "tier should resolve successfully");
        entitlements.ok()
    }

    #[test]
    fn free_tier_has_only_free_entitlements() {
        let Some(config) = config_or_skip() else {
            return;
        };
        let Some(entitlements) = resolve_or_skip(config, "free") else {
            return;
        };

        assert!(entitlements.contains(&"core.discovery".to_string()));
        assert!(!entitlements.contains(&"ai.copilot.weekly_grow_plan".to_string()));
    }

    #[test]
    fn premium_tier_inherits_free_and_has_premium_entitlements() {
        let Some(config) = config_or_skip() else {
            return;
        };
        let Some(entitlements) = resolve_or_skip(config, "premium") else {
            return;
        };

        assert!(entitlements.contains(&"core.discovery".to_string()));
        assert!(entitlements.contains(&"ai.copilot.weekly_grow_plan".to_string()));
        assert!(entitlements.contains(&"premium.analytics.read".to_string()));
    }

    #[test]
    fn policy_flags_match_phase6_rules() {
        let Some(config) = config_or_skip() else {
            return;
        };

        assert!(config.policies.ai_is_premium_only);
        assert!(config.policies.free_reminders_are_deterministic_only);
    }

    #[test]
    fn premium_entitlement_denied_for_free_tier() {
        let Some(config) = config_or_skip() else {
            return;
        };

        let has_entitlement = tier_has_entitlement(config, "free", "ai.copilot.weekly_grow_plan");
        assert!(has_entitlement.is_ok());
        assert!(!has_entitlement.unwrap_or(true));
    }

    #[test]
    fn premium_entitlement_allowed_for_premium_tier() {
        let Some(config) = config_or_skip() else {
            return;
        };

        let has_entitlement =
            tier_has_entitlement(config, "premium", "ai.copilot.weekly_grow_plan");
        assert!(has_entitlement.is_ok());
        assert!(has_entitlement.unwrap_or(false));
    }

    #[test]
    fn feature_locked_error_response_contains_upgrade_hint_key() {
        let response = FeatureLockedError {
            entitlement_key: "ai.feed_insights.read".to_string(),
        }
        .to_response();

        assert_eq!(response.error, "feature_locked");
        assert_eq!(response.entitlement_key, "ai.feed_insights.read");
        assert_eq!(response.required_tier, "premium");
        assert_eq!(response.upgrade_hint_key, "upgrade.premium");
    }
}
