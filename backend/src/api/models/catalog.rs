use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SourceAttribution {
    pub source: String,
    pub source_id: Option<String>,
    pub source_url: Option<String>,
    pub license: Option<String>,
    pub attribution: Option<String>,
    pub import_batch_id: Option<String>,
    pub imported_at: Option<String>,
    pub last_verified_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CatalogCrop {
    pub id: String,
    pub slug: String,
    pub common_name: String,
    pub scientific_name: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub source_attribution: SourceAttribution,
}

#[derive(Debug, Serialize)]
pub struct CatalogVariety {
    pub id: String,
    pub crop_id: String,
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub source_attribution: SourceAttribution,
}
