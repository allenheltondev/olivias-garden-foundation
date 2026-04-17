use crate::auth::{extract_auth_context, require_admin};
use crate::db;
use crate::models::store::{StoreProduct, StoreProductListResponse, UpsertStoreProductRequest};
use lambda_http::{Body, Request, Response};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

const VALID_STATUSES: &[&str] = &["draft", "active", "archived"];
const VALID_KINDS: &[&str] = &["donation", "merchandise", "ticket", "sponsorship", "other"];
const VALID_FULFILLMENT_TYPES: &[&str] = &["none", "digital", "shipping", "pickup"];

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

pub async fn list_public_products() -> Result<Response<Body>, lambda_http::Error> {
    let client = db::connect().await?;
    let rows = client
        .query(
            "
            select id, slug, name, short_description, description, status::text as status,
                   kind::text as kind, fulfillment_type::text as fulfillment_type,
                   is_public, is_featured, currency, unit_amount_cents,
                   statement_descriptor, nonprofit_program, impact_summary,
                   image_url, metadata, stripe_product_id, stripe_price_id,
                   created_at, updated_at
              from store_products
             where status = 'active' and is_public = true
             order by is_featured desc, created_at desc
            ",
            &[],
        )
        .await
        .map_err(|error| db_error(&error))?;

    json_response(
        200,
        &StoreProductListResponse {
            items: rows.iter().map(map_store_product).collect(),
        },
    )
}

pub async fn list_admin_products(
    request: &Request,
    _correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    require_admin(&auth)?;

    let client = db::connect().await?;
    let rows = client
        .query(
            "
            select id, slug, name, short_description, description, status::text as status,
                   kind::text as kind, fulfillment_type::text as fulfillment_type,
                   is_public, is_featured, currency, unit_amount_cents,
                   statement_descriptor, nonprofit_program, impact_summary,
                   image_url, metadata, stripe_product_id, stripe_price_id,
                   created_at, updated_at
              from store_products
             order by updated_at desc, created_at desc
            ",
            &[],
        )
        .await
        .map_err(|error| db_error(&error))?;

    json_response(
        200,
        &StoreProductListResponse {
            items: rows.iter().map(map_store_product).collect(),
        },
    )
}

pub async fn create_store_product(
    request: &Request,
    _correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    require_admin(&auth)?;

    let payload: UpsertStoreProductRequest = parse_json_body(request)?;
    validate_payload(&payload)?;

    let stripe = StripeStoreClient::from_env()?;
    let stripe_product_id = stripe.create_product(&payload).await?;
    let stripe_price_id = stripe
        .create_price(
            &stripe_product_id,
            payload.unit_amount_cents,
            &payload.currency,
        )
        .await?;

    let client = db::connect().await?;
    let row = client
        .query_one(
            "
            insert into store_products (
              slug, name, short_description, description, status, kind, fulfillment_type,
              is_public, is_featured, currency, unit_amount_cents, statement_descriptor,
              nonprofit_program, impact_summary, image_url, metadata,
              stripe_product_id, stripe_price_id
            )
            values (
              $1, $2, $3, $4, $5::store_product_status, $6::store_product_kind,
              $7::store_fulfillment_type, $8, $9, $10, $11, $12, $13, $14, $15, $16,
              $17, $18
            )
            returning id, slug, name, short_description, description, status::text as status,
                      kind::text as kind, fulfillment_type::text as fulfillment_type,
                      is_public, is_featured, currency, unit_amount_cents,
                      statement_descriptor, nonprofit_program, impact_summary,
                      image_url, metadata, stripe_product_id, stripe_price_id,
                      created_at, updated_at
            ",
            &[
                &payload.slug,
                &payload.name,
                &payload.short_description,
                &payload.description,
                &payload.status,
                &payload.kind,
                &payload.fulfillment_type,
                &payload.is_public,
                &payload.is_featured,
                &payload.currency,
                &payload.unit_amount_cents,
                &payload.statement_descriptor,
                &payload.nonprofit_program,
                &payload.impact_summary,
                &payload.image_url,
                &payload.metadata,
                &stripe_product_id,
                &stripe_price_id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    json_response(201, &map_store_product(&row))
}

pub async fn update_store_product(
    request: &Request,
    _correlation_id: &str,
    product_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    require_admin(&auth)?;

    let product_uuid = Uuid::parse_str(product_id)
        .map_err(|_| lambda_http::Error::from("product id must be a valid UUID".to_string()))?;
    let payload: UpsertStoreProductRequest = parse_json_body(request)?;
    validate_payload(&payload)?;

    let client = db::connect().await?;
    let existing = client
        .query_opt(
            "
            select stripe_product_id, stripe_price_id, unit_amount_cents, currency
              from store_products
             where id = $1
            ",
            &[&product_uuid],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(existing_row) = existing else {
        return json_response(
            404,
            &ErrorResponse {
                error: "Store product not found".to_string(),
            },
        );
    };

    let stripe_product_id: String = existing_row.get("stripe_product_id");
    let current_amount: i32 = existing_row.get("unit_amount_cents");
    let current_currency: String = existing_row.get("currency");

    let stripe = StripeStoreClient::from_env()?;
    stripe.update_product(&stripe_product_id, &payload).await?;

    let stripe_price_id = if current_amount != payload.unit_amount_cents
        || !current_currency.eq_ignore_ascii_case(&payload.currency)
    {
        stripe
            .create_price(
                &stripe_product_id,
                payload.unit_amount_cents,
                &payload.currency,
            )
            .await?
    } else {
        existing_row.get("stripe_price_id")
    };

    let row = client
        .query_one(
            "
            update store_products
               set slug = $2,
                   name = $3,
                   short_description = $4,
                   description = $5,
                   status = $6::store_product_status,
                   kind = $7::store_product_kind,
                   fulfillment_type = $8::store_fulfillment_type,
                   is_public = $9,
                   is_featured = $10,
                   currency = $11,
                   unit_amount_cents = $12,
                   statement_descriptor = $13,
                   nonprofit_program = $14,
                   impact_summary = $15,
                   image_url = $16,
                   metadata = $17,
                   stripe_price_id = $18,
                   updated_at = now()
             where id = $1
             returning id, slug, name, short_description, description, status::text as status,
                       kind::text as kind, fulfillment_type::text as fulfillment_type,
                       is_public, is_featured, currency, unit_amount_cents,
                       statement_descriptor, nonprofit_program, impact_summary,
                       image_url, metadata, stripe_product_id, stripe_price_id,
                       created_at, updated_at
            ",
            &[
                &product_uuid,
                &payload.slug,
                &payload.name,
                &payload.short_description,
                &payload.description,
                &payload.status,
                &payload.kind,
                &payload.fulfillment_type,
                &payload.is_public,
                &payload.is_featured,
                &payload.currency,
                &payload.unit_amount_cents,
                &payload.statement_descriptor,
                &payload.nonprofit_program,
                &payload.impact_summary,
                &payload.image_url,
                &payload.metadata,
                &stripe_price_id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    json_response(200, &map_store_product(&row))
}

fn validate_payload(payload: &UpsertStoreProductRequest) -> Result<(), lambda_http::Error> {
    if payload.slug.trim().is_empty() || !is_slug(&payload.slug) {
        return Err(lambda_http::Error::from(
            "slug must be lowercase kebab-case".to_string(),
        ));
    }
    if payload.name.trim().is_empty() {
        return Err(lambda_http::Error::from("name is required".to_string()));
    }
    if !VALID_STATUSES.contains(&payload.status.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "status must be one of: {}",
            VALID_STATUSES.join(", ")
        )));
    }
    if !VALID_KINDS.contains(&payload.kind.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "kind must be one of: {}",
            VALID_KINDS.join(", ")
        )));
    }
    if !VALID_FULFILLMENT_TYPES.contains(&payload.fulfillment_type.as_str()) {
        return Err(lambda_http::Error::from(format!(
            "fulfillmentType must be one of: {}",
            VALID_FULFILLMENT_TYPES.join(", ")
        )));
    }
    if payload.currency.len() != 3 || !payload.currency.chars().all(|ch| ch.is_ascii_lowercase()) {
        return Err(lambda_http::Error::from(
            "currency must be a 3-letter lowercase ISO code".to_string(),
        ));
    }
    if payload.unit_amount_cents < 0 {
        return Err(lambda_http::Error::from(
            "unitAmountCents must be greater than or equal to 0".to_string(),
        ));
    }
    if !payload.metadata.is_object() {
        return Err(lambda_http::Error::from(
            "metadata must be a JSON object".to_string(),
        ));
    }
    Ok(())
}

fn is_slug(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed == value
        && !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && !trimmed.starts_with('-')
        && !trimmed.ends_with('-')
        && !trimmed.contains("--")
}

fn map_store_product(row: &tokio_postgres::Row) -> StoreProduct {
    StoreProduct {
        id: row.get::<_, Uuid>("id").to_string(),
        slug: row.get("slug"),
        name: row.get("name"),
        short_description: row.get("short_description"),
        description: row.get("description"),
        status: row.get("status"),
        kind: row.get("kind"),
        fulfillment_type: row.get("fulfillment_type"),
        is_public: row.get("is_public"),
        is_featured: row.get("is_featured"),
        currency: row.get("currency"),
        unit_amount_cents: row.get("unit_amount_cents"),
        statement_descriptor: row.get("statement_descriptor"),
        nonprofit_program: row.get("nonprofit_program"),
        impact_summary: row.get("impact_summary"),
        image_url: row.get("image_url"),
        metadata: row.get("metadata"),
        stripe_product_id: row.get("stripe_product_id"),
        stripe_price_id: row.get("stripe_price_id"),
        created_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("updated_at")
            .to_rfc3339(),
    }
}

fn parse_json_body<T: serde::de::DeserializeOwned>(
    request: &Request,
) -> Result<T, lambda_http::Error> {
    match request.body() {
        Body::Text(text) => serde_json::from_str::<T>(text)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Binary(bytes) => serde_json::from_slice::<T>(bytes)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Empty => Err(lambda_http::Error::from(
            "Request body is required".to_string(),
        )),
    }
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

pub fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(
        status,
        &ErrorResponse {
            error: message.to_string(),
        },
    )
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

struct StripeStoreClient {
    http: Client,
    secret_key: String,
}

impl StripeStoreClient {
    fn from_env() -> Result<Self, lambda_http::Error> {
        let secret_key = std::env::var("STRIPE_SECRET_KEY")
            .map_err(|_| lambda_http::Error::from("STRIPE_SECRET_KEY is not configured"))?;

        Ok(Self {
            http: Client::new(),
            secret_key,
        })
    }

    async fn create_product(
        &self,
        payload: &UpsertStoreProductRequest,
    ) -> Result<String, lambda_http::Error> {
        let mut form = Self::base_product_form(payload);
        form.insert(
            "default_price_data[currency]".to_string(),
            payload.currency.clone(),
        );
        form.insert(
            "default_price_data[unit_amount]".to_string(),
            payload.unit_amount_cents.to_string(),
        );

        let response = self
            .http
            .post("https://api.stripe.com/v1/products")
            .basic_auth(&self.secret_key, Some(""))
            .form(&form)
            .send()
            .await
            .map_err(|e| lambda_http::Error::from(format!("Stripe request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(lambda_http::Error::from(format!(
                "Stripe product creation failed ({status}): {body}"
            )));
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| lambda_http::Error::from(format!("Invalid Stripe response JSON: {e}")))?;

        payload
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| lambda_http::Error::from("Stripe product id missing".to_string()))
    }

    async fn create_price(
        &self,
        stripe_product_id: &str,
        unit_amount_cents: i32,
        currency: &str,
    ) -> Result<String, lambda_http::Error> {
        let mut form = HashMap::new();
        form.insert("product".to_string(), stripe_product_id.to_string());
        form.insert("currency".to_string(), currency.to_string());
        form.insert("unit_amount".to_string(), unit_amount_cents.to_string());

        let response = self
            .http
            .post("https://api.stripe.com/v1/prices")
            .basic_auth(&self.secret_key, Some(""))
            .form(&form)
            .send()
            .await
            .map_err(|e| lambda_http::Error::from(format!("Stripe request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(lambda_http::Error::from(format!(
                "Stripe price creation failed ({status}): {body}"
            )));
        }

        let payload: Value = response
            .json()
            .await
            .map_err(|e| lambda_http::Error::from(format!("Invalid Stripe response JSON: {e}")))?;

        payload
            .get("id")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .ok_or_else(|| lambda_http::Error::from("Stripe price id missing".to_string()))
    }

    async fn update_product(
        &self,
        stripe_product_id: &str,
        payload: &UpsertStoreProductRequest,
    ) -> Result<(), lambda_http::Error> {
        let response = self
            .http
            .post(format!(
                "https://api.stripe.com/v1/products/{stripe_product_id}"
            ))
            .basic_auth(&self.secret_key, Some(""))
            .form(&Self::base_product_form(payload))
            .send()
            .await
            .map_err(|e| lambda_http::Error::from(format!("Stripe request failed: {e}")))?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(lambda_http::Error::from(format!(
                "Stripe product update failed ({status}): {body}"
            )))
        }
    }

    fn base_product_form(payload: &UpsertStoreProductRequest) -> HashMap<String, String> {
        let mut form = HashMap::new();
        form.insert("name".to_string(), payload.name.clone());
        form.insert(
            "description".to_string(),
            payload.description.clone().unwrap_or_default(),
        );
        form.insert(
            "active".to_string(),
            if payload.status == "archived" {
                "false".to_string()
            } else {
                "true".to_string()
            },
        );
        form.insert("metadata[slug]".to_string(), payload.slug.clone());
        form.insert("metadata[kind]".to_string(), payload.kind.clone());
        form.insert(
            "metadata[nonprofit_program]".to_string(),
            payload.nonprofit_program.clone().unwrap_or_default(),
        );
        form.insert(
            "metadata[impact_summary]".to_string(),
            payload.impact_summary.clone().unwrap_or_default(),
        );
        if let Some(url) = &payload.image_url {
            form.insert("images[0]".to_string(), url.clone());
        }
        form
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_payload() -> UpsertStoreProductRequest {
        UpsertStoreProductRequest {
            slug: "okra-seed-pack".to_string(),
            name: "Okra Seed Pack".to_string(),
            short_description: Some("Starter seeds".to_string()),
            description: Some("A nonprofit seed pack.".to_string()),
            status: "draft".to_string(),
            kind: "donation".to_string(),
            fulfillment_type: "shipping".to_string(),
            is_public: false,
            is_featured: false,
            currency: "usd".to_string(),
            unit_amount_cents: 1200,
            statement_descriptor: Some("OGF STORE".to_string()),
            nonprofit_program: Some("Seed outreach".to_string()),
            impact_summary: Some("Funds seed distribution".to_string()),
            image_url: None,
            metadata: json!({"campaign": "okra"}),
        }
    }

    #[test]
    fn validate_payload_accepts_valid_product() {
        assert!(validate_payload(&valid_payload()).is_ok());
    }
}
