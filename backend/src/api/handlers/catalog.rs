use crate::db;
use crate::models::catalog::{CatalogCrop, CatalogVariety, SourceAttribution};
use crate::models::crop::ErrorResponse;
use lambda_http::{Body, Response};
use serde::Serialize;
use uuid::Uuid;

pub async fn list_catalog_crops() -> Result<Response<Body>, lambda_http::Error> {
    let client = db::connect().await?;
    let rows = client
        .query(
            "select id, slug, common_name, scientific_name, category, description, source_provider, source_record_id, source_url, source_license, attribution_text, import_batch_id, imported_at::text as imported_at, last_verified_at::text as last_verified_at from crops order by common_name asc",
            &[],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let crops = rows
        .into_iter()
        .map(|row| CatalogCrop {
            id: row.get::<_, Uuid>("id").to_string(),
            slug: row.get("slug"),
            common_name: row.get("common_name"),
            scientific_name: row.get("scientific_name"),
            category: row.get("category"),
            description: row.get("description"),
            source_attribution: SourceAttribution {
                source: row.get("source_provider"),
                source_id: row.get("source_record_id"),
                source_url: row.get("source_url"),
                license: row.get("source_license"),
                attribution: row.get("attribution_text"),
                import_batch_id: row.get("import_batch_id"),
                imported_at: row.get("imported_at"),
                last_verified_at: row.get("last_verified_at"),
            },
        })
        .collect::<Vec<_>>();

    json_response(200, &crops)
}

pub async fn list_catalog_varieties(crop_id: &str) -> Result<Response<Body>, lambda_http::Error> {
    let crop_uuid = Uuid::parse_str(crop_id)
        .map_err(|_| lambda_http::Error::from("crop id must be a valid UUID".to_string()))?;

    let client = db::connect().await?;

    let exists = client
        .query_one(
            "select exists(select 1 from crops where id = $1)",
            &[&crop_uuid],
        )
        .await
        .map_err(|error| db_error(&error))?
        .get::<_, bool>(0);

    if !exists {
        return json_response(
            404,
            &ErrorResponse {
                error: "Catalog crop not found".to_string(),
            },
        );
    }

    let rows = client
        .query(
            "select id, crop_id, slug, name, description, source_provider, source_record_id, source_url, source_license, attribution_text, import_batch_id, imported_at::text as imported_at, last_verified_at::text as last_verified_at from crop_varieties where crop_id = $1 order by name asc",
            &[&crop_uuid],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let varieties = rows
        .into_iter()
        .map(|row| CatalogVariety {
            id: row.get::<_, Uuid>("id").to_string(),
            crop_id: row.get::<_, Uuid>("crop_id").to_string(),
            slug: row.get("slug"),
            name: row.get("name"),
            description: row.get("description"),
            source_attribution: SourceAttribution {
                source: row.get("source_provider"),
                source_id: row.get("source_record_id"),
                source_url: row.get("source_url"),
                license: row.get("source_license"),
                attribution: row.get("attribution_text"),
                import_batch_id: row.get("import_batch_id"),
                imported_at: row.get("imported_at"),
                last_verified_at: row.get("last_verified_at"),
            },
        })
        .collect::<Vec<_>>();

    json_response(200, &varieties)
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> Result<Response<Body>, lambda_http::Error> {
    let body = serde_json::to_string(payload)
        .map_err(|e| lambda_http::Error::from(format!("Failed to serialize response: {e}")))?;

    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}
