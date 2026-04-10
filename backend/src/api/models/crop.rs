use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct GrowerCropItem {
    pub id: String,
    pub user_id: String,
    pub crop_id: Option<String>,
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
    #[serde(default, alias = "canonicalId", alias = "crop_id", alias = "cropId")]
    pub canonical_id: Option<String>,
    #[serde(default, alias = "cropName")]
    pub crop_name: Option<String>,
    #[serde(default, alias = "varietyId")]
    pub variety_id: Option<String>,
    pub status: String,
    pub visibility: String,
    #[serde(alias = "surplusEnabled")]
    pub surplus_enabled: bool,
    pub nickname: Option<String>,
    #[serde(default, alias = "defaultUnit")]
    pub default_unit: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}
