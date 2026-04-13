use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListingItem {
    pub id: String,
    pub user_id: String,
    pub grower_crop_id: Option<String>,
    pub crop_id: Option<String>,
    pub variety_id: Option<String>,
    pub title: Option<String>,
    pub unit: Option<String>,
    pub quantity_total: Option<String>,
    pub quantity_remaining: Option<String>,
    pub available_start: Option<String>,
    pub available_end: Option<String>,
    pub status: String,
    pub pickup_location_text: Option<String>,
    pub pickup_address: Option<String>,
    pub effective_pickup_address: Option<String>,
    pub pickup_disclosure_policy: String,
    pub pickup_notes: Option<String>,
    pub contact_pref: String,
    pub geo_key: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMyListingsResponse {
    pub items: Vec<ListingItem>,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
    pub next_offset: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverListingsResponse {
    pub items: Vec<ListingItem>,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
    pub next_offset: Option<i64>,
}
