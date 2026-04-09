use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GrowerCropItem {
    pub id: String,
    pub user_id: String,
    pub canonical_id: Option<String>,
    pub crop_name: String,
    pub variety_id: Option<String>,
    pub status: String,
    pub visibility: String,
    pub surplus_enabled: bool,
    pub nickname: Option<String>,
    pub default_unit: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct UpsertGrowerCropRequest {
    pub canonical_id: Option<String>,
    pub crop_name: String,
    pub variety_id: Option<String>,
    pub status: String,
    pub visibility: String,
    pub surplus_enabled: bool,
    pub nickname: Option<String>,
    pub default_unit: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}
