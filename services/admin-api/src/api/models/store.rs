use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoreProduct {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub short_description: Option<String>,
    pub description: Option<String>,
    pub status: String,
    pub kind: String,
    pub fulfillment_type: String,
    pub is_public: bool,
    pub is_featured: bool,
    pub currency: String,
    pub unit_amount_cents: i32,
    pub statement_descriptor: Option<String>,
    pub nonprofit_program: Option<String>,
    pub impact_summary: Option<String>,
    pub image_url: Option<String>,
    pub metadata: Value,
    pub stripe_product_id: String,
    pub stripe_price_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StoreProductListResponse {
    pub items: Vec<StoreProduct>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertStoreProductRequest {
    pub slug: String,
    pub name: String,
    pub short_description: Option<String>,
    pub description: Option<String>,
    pub status: String,
    pub kind: String,
    pub fulfillment_type: String,
    pub is_public: bool,
    pub is_featured: bool,
    pub currency: String,
    pub unit_amount_cents: i32,
    pub statement_descriptor: Option<String>,
    pub nonprofit_program: Option<String>,
    pub impact_summary: Option<String>,
    pub image_url: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}
