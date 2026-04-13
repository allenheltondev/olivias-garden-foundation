use crate::models::listing::ListingItem;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedFeedSignal {
    pub geo_boundary_key: String,
    pub crop_id: Option<String>,
    pub window_days: i32,
    pub listing_count: i32,
    pub request_count: i32,
    pub supply_quantity: String,
    pub demand_quantity: String,
    pub scarcity_score: f64,
    pub abundance_score: f64,
    pub computed_at: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedFeedFreshness {
    pub as_of: String,
    pub is_stale: bool,
    pub stale_fallback_used: bool,
    pub stale_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedFeedAiSummary {
    pub summary_text: String,
    pub model_id: String,
    pub model_version: String,
    pub generated_at: String,
    pub expires_at: String,
    pub from_cache: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerGuidanceSignalRef {
    pub geo_boundary_key: String,
    pub crop_id: Option<String>,
    pub scarcity_score: f64,
    pub abundance_score: f64,
    pub listing_count: i32,
    pub request_count: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerGuidanceExplanation {
    pub season: String,
    pub strategy: String,
    pub window_days: i32,
    pub source_signal_count: usize,
    pub strongest_scarcity_signal: Option<GrowerGuidanceSignalRef>,
    pub strongest_abundance_signal: Option<GrowerGuidanceSignalRef>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrowerGuidance {
    pub guidance_text: String,
    pub explanation: GrowerGuidanceExplanation,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedFeedResponse {
    pub items: Vec<ListingItem>,
    pub signals: Vec<DerivedFeedSignal>,
    pub freshness: DerivedFeedFreshness,
    pub ai_summary: Option<DerivedFeedAiSummary>,
    pub grower_guidance: Option<GrowerGuidance>,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
    pub next_offset: Option<i64>,
}
