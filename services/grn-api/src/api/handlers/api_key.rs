use crate::auth::{authenticated_with_api_key, extract_auth_context};
use crate::db;
use crate::handlers::api_access_request::claimable_request;
use crate::models::api_key::{
    ApiKeyItem, ApiKeyListResponse, CreatedApiKeyResponse, UpsertApiKeyRequest,
};
use crate::models::crop::ErrorResponse;
use crate::services::api_gateway_keys;
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio_postgres::Row;
use tracing::info;
use uuid::Uuid;

/// Prefix on every GRN API key. The authorizer uses it to tell an API key
/// apart from a JWT in the Authorization header.
const API_KEY_PREFIX: &str = "grnk_";
const MAX_KEY_NAME_LEN: usize = 100;

/// Most live keys one grower may hold at once.
///
/// Keys are self-serve: any grower can create one, for an integration or for
/// an AI assistant through the grower MCP server. Each is still backed by its
/// own API Gateway key on the integration usage plan, so it is throttled and
/// metered like any other; the cap stops one account accumulating them.
pub const MAX_ACTIVE_KEYS: i64 = 5;

pub async fn list_api_keys(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let client = db::connect().await?;

    let rows = client
        .query(
            "select id, name, key_prefix, last_used_at, created_at
               from api_keys
              where user_id = $1 and revoked_at is null
              order by created_at desc",
            &[&user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        api_key_count = rows.len(),
        "Listed API keys"
    );

    json_response(
        200,
        &ApiKeyListResponse {
            items: rows.iter().map(row_to_item).collect(),
        },
    )
}

pub async fn get_api_key(
    request: &Request,
    _correlation_id: &str,
    api_key_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let id = parse_uuid(api_key_id, "api key id")?;
    let client = db::connect().await?;

    let maybe_row = client
        .query_opt(
            "select id, name, key_prefix, last_used_at, created_at
               from api_keys
              where id = $1 and user_id = $2 and revoked_at is null",
            &[&id, &user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    maybe_row.map_or_else(
        || error_response(404, "API key not found"),
        |row| json_response(200, &row_to_item(&row)),
    )
}

pub async fn create_api_key(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let payload: UpsertApiKeyRequest = parse_json_body(request)?;
    let name = validate_name(&payload.name)?;

    let mut client = db::connect().await?;

    // Generate the secret. Two UUIDv4s give ~244 bits of entropy; the stored
    // prefix is non-secret and only used to identify the key in the UI.
    let secret = generate_api_key();
    let key_prefix: String = secret.chars().take(API_KEY_PREFIX.len() + 8).collect();
    let key_hash = sha256_hex(&secret);

    // Everything from here to the commit is one transaction, so a failure at
    // any point — including the Lambda being killed mid-flight, which drops the
    // connection — leaves the approval unspent rather than stranding a grower
    // with a consumed decision and no credential. The only residue in that case
    // is an API Gateway key nobody holds the secret for.
    let transaction = client.transaction().await.map_err(|e| db_error(&e))?;

    if let Some(refusal) = refuse_over_key_cap(&transaction, user_id).await? {
        return refusal;
    }

    // Keys are self-serve. An approved access request that has not produced a
    // key yet is still linked to the new key, so earlier approvals keep their
    // provenance, but none is required. Read under the grower's row lock, so
    // concurrent creates cannot both reach for the same approval.
    let access_request_id = claimable_request(&transaction, user_id).await?;

    // Insert before provisioning. When an approval is linked, the unique index
    // on access_request_id still guarantees one approval links one key; the row
    // lock above means a conflict should not happen, but if it does the loser
    // falls out here rather than after provisioning a second credential.
    let claimed = transaction
        .query_opt(
            "insert into api_keys (user_id, name, key_prefix, key_hash, access_request_id)
             values ($1, $2, $3, $4, $5)
             on conflict do nothing
             returning id, name, key_prefix, last_used_at, created_at",
            &[&user_id, &name, &key_prefix, &key_hash, &access_request_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let Some(row) = claimed else {
        return json_response(
            409,
            &ErrorResponse {
                error: "A key has already been issued for this approval".to_string(),
            },
        );
    };
    let api_key_id: Uuid = row.get("id");

    // Provision the API Gateway side now that the approval is ours. The grower
    // never sees these identifiers — the authorizer uses them on their behalf,
    // and the hash it already computes to authenticate the key doubles as the
    // API Gateway key value, so nothing extra has to be stored or looked up.
    let provisioned = api_gateway_keys::provision(
        &format!("grn-{user_id}-{key_prefix}"),
        &access_request_id.map_or_else(
            || format!("GRN API key for grower {user_id}"),
            |id| format!("GRN API access for request {id}"),
        ),
        &key_hash,
    )
    .await?;

    // Record the identifiers and commit. If either step fails the claim rolls
    // back, so the API Gateway key it would have pointed at has to go too —
    // otherwise it lives on unreferenced, with no row left to revoke it from.
    if let Err(error) = persist_provisioning(transaction, api_key_id, provisioned.as_ref()).await {
        if let Some(key) = provisioned.as_ref() {
            api_gateway_keys::revoke(&key.aws_api_key_id).await;
        }
        return Err(error);
    }

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        api_key_id = %row.get::<_, Uuid>("id"),
        "Created API key"
    );

    json_response(
        201,
        &CreatedApiKeyResponse {
            id: row.get::<_, Uuid>("id").to_string(),
            name: row.get("name"),
            key_prefix: row.get("key_prefix"),
            key: secret,
            last_used_at: row
                .get::<_, Option<chrono::DateTime<chrono::Utc>>>("last_used_at")
                .map(|v| v.to_rfc3339()),
            created_at: row
                .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
                .to_rfc3339(),
        },
    )
}

pub async fn update_api_key(
    request: &Request,
    correlation_id: &str,
    api_key_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let id = parse_uuid(api_key_id, "api key id")?;
    let payload: UpsertApiKeyRequest = parse_json_body(request)?;
    let name = validate_name(&payload.name)?;

    let client = db::connect().await?;
    let maybe_row = client
        .query_opt(
            "update api_keys
                set name = $1, updated_at = now()
              where id = $2 and user_id = $3 and revoked_at is null
              returning id, name, key_prefix, last_used_at, created_at",
            &[&name, &id, &user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    maybe_row.map_or_else(
        || error_response(404, "API key not found"),
        |row| {
            info!(
                correlation_id = correlation_id,
                user_id = %user_id,
                api_key_id = %id,
                "Renamed API key"
            );
            json_response(200, &row_to_item(&row))
        },
    )
}

pub async fn delete_api_key(
    request: &Request,
    correlation_id: &str,
    api_key_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let id = parse_uuid(api_key_id, "api key id")?;
    let client = db::connect().await?;

    // Soft delete (revoke) so the key can no longer authenticate but history
    // and last_used analytics are preserved.
    let revoked = client
        .query_opt(
            "update api_keys set revoked_at = now(), updated_at = now()
              where id = $1 and user_id = $2 and revoked_at is null
              returning aws_api_key_id",
            &[&id, &user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let Some(row) = revoked else {
        return error_response(404, "API key not found");
    };

    // Disable the API Gateway side too, so a revoked key stops consuming the
    // usage plan. Best effort: the GRN key is already dead in the database.
    if let Some(aws_api_key_id) = row.get::<_, Option<String>>("aws_api_key_id") {
        api_gateway_keys::revoke(&aws_api_key_id).await;
    }

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        api_key_id = %id,
        "Revoked API key"
    );

    Response::builder()
        .status(204)
        .body(Body::Empty)
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

/// A 409 when the grower already holds [`MAX_ACTIVE_KEYS`] live keys.
///
/// Locks the grower's row first, so two concurrent creates are serialised:
/// the second counts the first's key once it commits, and cannot slip past
/// the cap on a stale count.
async fn refuse_over_key_cap(
    transaction: &tokio_postgres::Transaction<'_>,
    user_id: Uuid,
) -> Result<Option<Result<Response<Body>, lambda_http::Error>>, lambda_http::Error> {
    transaction
        .execute("select 1 from users where id = $1 for update", &[&user_id])
        .await
        .map_err(|e| db_error(&e))?;
    let active: i64 = transaction
        .query_one(
            "select count(*) from api_keys where user_id = $1 and revoked_at is null",
            &[&user_id],
        )
        .await
        .map_err(|e| db_error(&e))?
        .get(0);
    if !at_key_cap(active) {
        return Ok(None);
    }
    Ok(Some(json_response(
        409,
        &ErrorResponse {
            error: format!(
                "You already have {MAX_ACTIVE_KEYS} active API keys. Revoke one before creating another."
            ),
        },
    )))
}

/// Whether a grower holding `active` live keys may not create another.
const fn at_key_cap(active: i64) -> bool {
    active >= MAX_ACTIVE_KEYS
}

/// Write the API Gateway identifiers against the claimed row and commit.
///
/// Split out so both failure modes — the update and the commit — share one
/// compensation path at the call site, and so `create_api_key` stays inside
/// the line budget.
async fn persist_provisioning(
    transaction: tokio_postgres::Transaction<'_>,
    api_key_id: Uuid,
    provisioned: Option<&api_gateway_keys::ProvisionedKey>,
) -> Result<(), lambda_http::Error> {
    if let Some(key) = provisioned {
        transaction
            .execute(
                "update api_keys set aws_api_key_id = $1, usage_plan_id = $2, updated_at = now()
                  where id = $3",
                &[&key.aws_api_key_id, &key.usage_plan_id, &api_key_id],
            )
            .await
            .map_err(|e| db_error(&e))?;
    }

    // Taking the transaction by value means an early return here drops it, and
    // dropping a tokio-postgres transaction rolls it back.
    transaction.commit().await.map_err(|e| db_error(&e))
}

fn validate_name(name: &str) -> Result<String, lambda_http::Error> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(lambda_http::Error::from("name is required".to_string()));
    }
    if trimmed.chars().count() > MAX_KEY_NAME_LEN {
        return Err(lambda_http::Error::from(format!(
            "name must be {MAX_KEY_NAME_LEN} characters or fewer"
        )));
    }
    Ok(trimmed.to_string())
}

fn generate_api_key() -> String {
    format!(
        "{API_KEY_PREFIX}{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

fn row_to_item(row: &Row) -> ApiKeyItem {
    ApiKeyItem {
        id: row.get::<_, Uuid>("id").to_string(),
        name: row.get("name"),
        key_prefix: row.get("key_prefix"),
        last_used_at: row
            .get::<_, Option<chrono::DateTime<chrono::Utc>>>("last_used_at")
            .map(|v| v.to_rfc3339()),
        created_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
    }
}

/// The signed-in grower managing their keys.
///
/// Key management needs a session: an API key may not list, create, rename or
/// revoke keys. Otherwise a leaked key could mint further keys that outlive
/// its own revocation. Every handler here goes through this function, and
/// the `Forbidden:` prefix is what the router maps to 403.
fn extract_user_id(request: &Request) -> Result<Uuid, lambda_http::Error> {
    if authenticated_with_api_key(request) {
        return Err(lambda_http::Error::from(
            "Forbidden: API keys can only be managed from a signed-in session, not with an API key"
                .to_string(),
        ));
    }
    let auth = extract_auth_context(request)?;
    Uuid::parse_str(&auth.user_id).map_err(|_| lambda_http::Error::from("Invalid user ID format"))
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    Uuid::parse_str(value.trim())
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
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

fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(status, &serde_json::json!({ "error": message }))
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::{
        at_key_cap, generate_api_key, sha256_hex, validate_name, API_KEY_PREFIX, MAX_ACTIVE_KEYS,
    };

    fn request_as(fields: &[(&str, &str)]) -> lambda_http::Request {
        use lambda_http::request::RequestContext;
        use lambda_http::RequestExt;
        let mut context = aws_lambda_events::apigw::ApiGatewayProxyRequestContext::default();
        for (key, value) in fields {
            context.authorizer.fields.insert(
                (*key).to_string(),
                serde_json::Value::String((*value).to_string()),
            );
        }
        lambda_http::http::Request::builder()
            .body(lambda_http::Body::Empty)
            .unwrap()
            .with_request_context(RequestContext::ApiGatewayV1(context))
    }

    const USER: &str = "6d1c2a52-6b8f-4a7e-9a55-1f2b3c4d5e6f";

    #[test]
    fn a_signed_in_session_may_manage_keys() {
        let session = request_as(&[("userId", USER), ("isAdmin", "false")]);
        assert_eq!(super::extract_user_id(&session).unwrap().to_string(), USER);
    }

    #[test]
    fn an_api_key_may_not_manage_keys() {
        let key = request_as(&[("userId", USER), ("authMethod", "api_key")]);
        let error = super::extract_user_id(&key).unwrap_err().to_string();
        assert!(error.starts_with("Forbidden:"), "{error}");
        assert!(error.contains("signed-in session"), "{error}");
    }

    #[test]
    fn key_cap_allows_up_to_the_limit_and_refuses_beyond() {
        assert!(!at_key_cap(0));
        assert!(!at_key_cap(MAX_ACTIVE_KEYS - 1));
        assert!(at_key_cap(MAX_ACTIVE_KEYS));
        assert!(at_key_cap(MAX_ACTIVE_KEYS + 3));
    }

    #[test]
    fn generated_key_has_prefix_and_expected_length() {
        let key = generate_api_key();
        assert!(key.starts_with(API_KEY_PREFIX));
        // prefix + two 32-char simple UUIDs
        assert_eq!(key.len(), API_KEY_PREFIX.len() + 64);
    }

    #[test]
    fn generated_keys_are_unique() {
        assert_ne!(generate_api_key(), generate_api_key());
    }

    #[test]
    fn sha256_hex_is_stable_and_hex() {
        let a = sha256_hex("grnk_test");
        let b = sha256_hex("grnk_test");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn sha256_hex_differs_for_different_input() {
        assert_ne!(sha256_hex("grnk_a"), sha256_hex("grnk_b"));
    }

    #[test]
    fn validate_name_trims_and_accepts() {
        assert_eq!(validate_name("  My key  ").unwrap(), "My key");
    }

    #[test]
    fn validate_name_rejects_empty() {
        assert!(validate_name("   ").is_err());
    }

    #[test]
    fn validate_name_rejects_too_long() {
        let long = "a".repeat(101);
        assert!(validate_name(&long).is_err());
    }
}
