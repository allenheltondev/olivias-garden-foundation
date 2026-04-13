use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementsPolicy {
    pub ai_is_pro_only: bool,
    pub free_reminders_deterministic_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementsResponse {
    pub tier: String,
    pub entitlements_version: String,
    pub entitlements: Vec<String>,
    pub policy: EntitlementsPolicy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct FeatureLockedErrorResponse {
    pub error: String,
    pub entitlement_key: String,
    pub required_tier: String,
    pub upgrade_hint_key: String,
}
