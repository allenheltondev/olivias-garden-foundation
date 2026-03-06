use crate::badge_cabinet::BadgeCabinetEntry;
use crate::gardener_tier::GardenerTierProfile;
use crate::tips_framework::{ExperienceLevel, ExperienceSignals, GardeningTip};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserType {
    Grower,
    Gatherer,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerProfile {
    pub home_zone: Option<String>,
    pub address: Option<String>,
    pub geo_key: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub share_radius_miles: String,
    pub units: String,
    pub locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GathererProfile {
    pub address: String,
    pub geo_key: String,
    pub lat: f64,
    pub lng: f64,
    pub search_radius_miles: String,
    pub organization_affiliation: Option<String>,
    pub units: String,
    pub locale: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UserRatingSummary {
    pub avg_score: String,
    pub rating_count: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionMetadata {
    pub tier: String,
    pub subscription_status: String,
    pub premium_expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeProfileResponse {
    pub id: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub is_verified: bool,
    pub user_type: Option<UserType>,
    pub onboarding_completed: bool,
    pub created_at: String,
    pub subscription: SubscriptionMetadata,
    pub gardener_tier: GardenerTierProfile,
    pub badge_cabinet: Vec<BadgeCabinetEntry>,
    pub seasonal_timeline: Vec<SeasonalTimelineEntry>,
    pub experience_level: ExperienceLevel,
    pub experience_signals: ExperienceSignals,
    pub curated_tips: Vec<GardeningTip>,
    pub grower_profile: Option<GrowerProfile>,
    pub gatherer_profile: Option<GathererProfile>,
    pub rating_summary: Option<UserRatingSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeasonalTimelineEntry {
    pub badge_key: String,
    pub level: i32,
    pub earned_at: String,
}

#[derive(Debug, Serialize)]
pub struct PublicUserResponse {
    pub id: String,
    pub display_name: Option<String>,
    pub created_at: String,
    pub grower_profile: Option<GrowerProfile>,
    pub rating_summary: Option<UserRatingSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerProfileInput {
    pub home_zone: String,
    pub address: String,
    pub share_radius_miles: f64,
    pub units: String,
    pub locale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GathererProfileInput {
    pub address: String,
    pub search_radius_miles: f64,
    pub organization_affiliation: Option<String>,
    pub units: String,
    pub locale: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutMeRequest {
    pub display_name: Option<String>,
    pub user_type: Option<UserType>,
    pub grower_profile: Option<GrowerProfileInput>,
    pub gatherer_profile: Option<GathererProfileInput>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Legacy structure - replaced by PutMeRequest
pub struct UpsertMeProfileRequest {
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub grower_profile: Option<UpsertGrowerProfileRequest>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Legacy structure - replaced by GrowerProfileInput
pub struct UpsertGrowerProfileRequest {
    pub home_zone: Option<String>,
    pub address: Option<String>,
    pub geo_key: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub share_radius_km: Option<String>,
    pub units: Option<String>,
    pub locale: Option<String>,
}
