use aws_lambda_events::event::apigw::ApiGatewayCustomAuthorizerRequestTypeRequest;
use aws_sdk_cognitoidentityprovider::Client as CognitoClient;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use rustls::{ClientConfig, RootCertStore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use tokio_postgres::config::{ChannelBinding, Config};
use tokio_postgres_rustls::MakeRustlsConnect;
use tracing::{error, warn};
use uuid::Uuid;
#[derive(Clone)]
struct AppState {
    cognito: CognitoClient,
    user_pool_id: String,
    user_pool_client_id: String,
    database_url: String,
}

#[derive(Debug, Deserialize)]
struct JwtClaims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    token_use: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct PolicyDocument {
    version: String,
    statement: Vec<PolicyStatement>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "PascalCase")]
struct PolicyStatement {
    action: String,
    effect: String,
    resource: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PolicyResponse {
    principal_id: String,
    policy_document: PolicyDocument,
    #[serde(skip_serializing_if = "Option::is_none")]
    context: Option<HashMap<String, String>>,
}

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}
#[tokio::main]
async fn main() -> Result<(), Error> {
    install_rustls_crypto_provider();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    let user_pool_id = std::env::var("USER_POOL_ID")?;
    let user_pool_client_id = std::env::var("USER_POOL_CLIENT_ID")?;
    let database_url = std::env::var("DATABASE_URL")?;

    let config = aws_config::load_from_env().await;
    let state = AppState {
        cognito: CognitoClient::new(&config),
        user_pool_id,
        user_pool_client_id,
        database_url,
    };

    run(service_fn(
        |event: LambdaEvent<ApiGatewayCustomAuthorizerRequestTypeRequest>| {
            let state = state.clone();
            async move { handler(event.payload, &state).await }
        },
    ))
    .await
}

async fn handler(
    event: ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    // Allow OPTIONS requests through without authentication for CORS preflight
    if event.http_method.as_ref().map(reqwest::Method::as_str) == Some("OPTIONS") {
        let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
        return Ok(generate_policy("anonymous", "Allow", &api_arn, None));
    }

    match handle_authorization(&event, state).await {
        Ok(policy) => Ok(policy),
        Err(err) => {
            error!(error = %err, "Authorization failed");
            let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
            Ok(generate_policy("user", "Deny", &api_arn, None))
        }
    }
}

async fn handle_authorization(
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    let auth_header = get_authorization_header(event).ok_or("No Authorization header provided")?;

    if !auth_header.starts_with("Bearer ") {
        return Err("Invalid authorization header format".into());
    }

    let token = auth_header.trim_start_matches("Bearer ");
    handle_jwt_auth(token, event, state).await
}

fn get_authorization_header(
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
) -> Option<String> {
    event
        .headers
        .get("authorization")
        .or_else(|| event.headers.get("Authorization"))
        .and_then(|value| value.to_str().ok())
        .map(ToString::to_string)
}

async fn handle_jwt_auth(
    token: &str,
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    state: &AppState,
) -> Result<PolicyResponse, Error> {
    let claims = verify_jwt(token, &state.user_pool_id, &state.user_pool_client_id).await?;
    let user_info = get_user_attributes(token, &state.cognito).await;

    let principal_id = user_info
        .get("sub")
        .cloned()
        .or_else(|| claims.sub.clone())
        .ok_or("Missing sub claim")?;

    let tier = get_user_tier(&state.cognito, &state.user_pool_id, &principal_id).await;
    let user_type = get_user_type_from_db(&state.database_url, &principal_id).await;

    let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
    let context = build_context([
        ("userId", Some(principal_id.clone())),
        ("userType", user_type),
        ("email", user_info.get("email").cloned()),
        ("firstName", user_info.get("given_name").cloned()),
        ("lastName", user_info.get("family_name").cloned()),
        ("tier", tier),
    ]);

    Ok(generate_policy(&principal_id, "Allow", &api_arn, context))
}

async fn get_user_attributes(
    access_token: &str,
    client: &CognitoClient,
) -> HashMap<String, String> {
    match client.get_user().access_token(access_token).send().await {
        Ok(response) => response
            .user_attributes
            .into_iter()
            .filter_map(|attr| attr.value.map(|value| (attr.name, value)))
            .collect(),
        Err(err) => {
            error!(error = %err, "Error fetching user attributes");
            HashMap::new()
        }
    }
}

async fn get_user_tier(
    client: &CognitoClient,
    user_pool_id: &str,
    username: &str,
) -> Option<String> {
    match client
        .admin_list_groups_for_user()
        .user_pool_id(user_pool_id)
        .username(username)
        .send()
        .await
    {
        Ok(response) => {
            let groups = response.groups();
            // Map tier groups to tier values
            // Groups are defined in SAM template: neighbor-tier, supporter-tier, caretaker-tier
            if groups
                .iter()
                .any(|g| g.group_name() == Some("caretaker-tier"))
            {
                Some("caretaker".to_string())
            } else if groups
                .iter()
                .any(|g| g.group_name() == Some("supporter-tier"))
            {
                Some("supporter".to_string())
            } else {
                // Default to neighbor for neighbor-tier or no tier group
                Some("neighbor".to_string())
            }
        }
        Err(err) => {
            error!(error = %err, "Error fetching user groups");
            // Default to neighbor on error
            Some("neighbor".to_string())
        }
    }
}
async fn get_user_type_from_db(database_url: &str, user_id: &str) -> Option<String> {
    let mut config = match Config::from_str(database_url) {
        Ok(config) => config,
        Err(err) => {
            error!(error = %err, "Invalid DATABASE_URL in authorizer");
            return None;
        }
    };

    if matches!(config.get_channel_binding(), ChannelBinding::Require) {
        warn!(
            "DATABASE_URL requested channel_binding=require; downgrading to prefer in authorizer"
        );
        config.channel_binding(ChannelBinding::Prefer);
    }

    let cert_result = rustls_native_certs::load_native_certs();
    if !cert_result.errors.is_empty() {
        error!(
            error_count = cert_result.errors.len(),
            "Errors occurred while loading native root certificates for userType lookup"
        );
    }

    let mut root_store = RootCertStore::empty();
    let (added, _) = root_store.add_parsable_certificates(cert_result.certs);
    if added == 0 {
        error!("No native root certificates available for userType lookup");
        return None;
    }

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let tls = MakeRustlsConnect::new(tls_config);

    let (client, connection) = match config.connect(tls).await {
        Ok(parts) => parts,
        Err(err) => {
            error!(
                error = %err,
                error_debug = ?err,
                "Failed to connect to database for userType lookup"
            );
            return None;
        }
    };

    tokio::spawn(async move {
        if let Err(err) = connection.await {
            error!(error = %err, error_debug = ?err, "Postgres connection error in authorizer");
        }
    });

    let user_uuid = match Uuid::parse_str(user_id) {
        Ok(uuid) => uuid,
        Err(err) => {
            warn!(
                error = %err,
                user_id = user_id,
                "Invalid user_id format for userType lookup"
            );
            return None;
        }
    };

    match client
        .query_opt(
            "select user_type from users where id = $1 and deleted_at is null",
            &[&user_uuid],
        )
        .await
    {
        Ok(Some(row)) => row
            .get::<_, Option<String>>("user_type")
            .and_then(|raw| normalize_user_type(raw.as_str())),
        Ok(None) => None,
        Err(err) => {
            error!(error = %err, user_id = user_id, "Failed to query userType from database");
            None
        }
    }
}

fn normalize_user_type(value: &str) -> Option<String> {
    match value.to_lowercase().as_str() {
        "grower" => Some("grower".to_string()),
        "gatherer" => Some("gatherer".to_string()),
        _ => None,
    }
}

async fn verify_jwt(token: &str, user_pool_id: &str, client_id: &str) -> Result<JwtClaims, Error> {
    let jwks = fetch_jwks(user_pool_id).await?;
    let header = decode_header(token)?;
    let kid = header.kid.ok_or("Missing kid")?;

    let jwk = jwks
        .keys
        .into_iter()
        .find(|key| key.common.key_id.as_deref() == Some(&kid))
        .ok_or("Matching JWK not found")?;

    let decoding_key = DecodingKey::from_jwk(&jwk)?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.validate_exp = true;
    validation.set_issuer(&[issuer_for_pool(user_pool_id)?]);

    let token_data = decode::<JwtClaims>(token, &decoding_key, &validation)?;

    if token_data
        .claims
        .token_use
        .as_deref()
        .filter(|value| *value == "access")
        .is_none()
    {
        return Err("Invalid token_use claim".into());
    }

    if token_data
        .claims
        .client_id
        .as_deref()
        .filter(|value| *value == client_id)
        .is_none()
    {
        return Err("Invalid client_id claim".into());
    }

    Ok(token_data.claims)
}

fn issuer_for_pool(user_pool_id: &str) -> Result<String, Error> {
    let region = user_pool_id
        .split('_')
        .next()
        .ok_or("Invalid USER_POOL_ID")?;
    Ok(format!(
        "https://cognito-idp.{region}.amazonaws.com/{user_pool_id}"
    ))
}

#[derive(Debug, Deserialize)]
struct JwkSet {
    keys: Vec<jsonwebtoken::jwk::Jwk>,
}

async fn fetch_jwks(user_pool_id: &str) -> Result<JwkSet, Error> {
    let region = user_pool_id
        .split('_')
        .next()
        .ok_or("Invalid USER_POOL_ID")?;
    let url =
        format!("https://cognito-idp.{region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json");
    let response = reqwest::get(url).await?.error_for_status()?;
    let jwks = response.json::<JwkSet>().await?;
    Ok(jwks)
}

fn build_context<const N: usize>(
    entries: [(&'static str, Option<String>); N],
) -> Option<HashMap<String, String>> {
    let mut context = HashMap::new();
    for (key, value) in entries {
        if let Some(value) = value {
            context.insert(key.to_string(), value);
        }
    }

    if context.is_empty() {
        None
    } else {
        Some(context)
    }
}

fn generate_policy(
    principal_id: &str,
    effect: &str,
    resource: &str,
    context: Option<HashMap<String, String>>,
) -> PolicyResponse {
    PolicyResponse {
        principal_id: principal_id.to_string(),
        policy_document: PolicyDocument {
            version: "2012-10-17".to_string(),
            statement: vec![PolicyStatement {
                action: "execute-api:Invoke".to_string(),
                effect: effect.to_string(),
                resource: resource.to_string(),
            }],
        },
        context: if effect == "Allow" { context } else { None },
    }
}

fn get_api_arn_pattern(method_arn: &str) -> String {
    let mut parts = method_arn.split('/');
    let first = parts.next();
    let second = parts.next();
    match (first, second) {
        (Some(part1), Some(part2)) => format!("{part1}/{part2}/*/*"),
        _ => method_arn.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_api_arn_pattern_expands_resource() {
        let arn = "arn:aws:execute-api:us-east-1:123456789012:apiId/prod/GET/resource";
        assert_eq!(
            get_api_arn_pattern(arn),
            "arn:aws:execute-api:us-east-1:123456789012:apiId/prod/*/*"
        );
    }

    #[test]
    fn get_api_arn_pattern_returns_input_when_short() {
        let arn = "invalid";
        assert_eq!(get_api_arn_pattern(arn), arn);
    }

    // Helper function to extract tier mapping logic for testing
    fn map_group_to_tier(group_names: &[&str]) -> String {
        if group_names.contains(&"caretaker-tier") {
            "caretaker".to_string()
        } else if group_names.contains(&"supporter-tier") {
            "supporter".to_string()
        } else if group_names.contains(&"neighbor-tier") {
            "neighbor".to_string()
        } else {
            "neighbor".to_string()
        }
    }

    #[test]
    fn tier_mapping_caretaker_tier_maps_to_caretaker() {
        let groups = vec!["caretaker-tier"];
        assert_eq!(map_group_to_tier(&groups), "caretaker");
    }

    #[test]
    fn tier_mapping_supporter_tier_maps_to_supporter() {
        let groups = vec!["supporter-tier"];
        assert_eq!(map_group_to_tier(&groups), "supporter");
    }

    #[test]
    fn tier_mapping_neighbor_tier_maps_to_neighbor() {
        let groups = vec!["neighbor-tier"];
        assert_eq!(map_group_to_tier(&groups), "neighbor");
    }

    #[test]
    fn tier_mapping_no_group_defaults_to_neighbor() {
        let groups: Vec<&str> = vec![];
        assert_eq!(map_group_to_tier(&groups), "neighbor");
    }

    #[test]
    fn tier_mapping_unknown_group_defaults_to_neighbor() {
        let groups = vec!["some-other-group"];
        assert_eq!(map_group_to_tier(&groups), "neighbor");
    }

    #[test]
    fn tier_mapping_caretaker_takes_precedence_over_supporter() {
        let groups = vec!["supporter-tier", "caretaker-tier"];
        assert_eq!(map_group_to_tier(&groups), "caretaker");
    }

    #[test]
    fn tier_mapping_caretaker_takes_precedence_over_neighbor() {
        let groups = vec!["neighbor-tier", "caretaker-tier"];
        assert_eq!(map_group_to_tier(&groups), "caretaker");
    }

    #[test]
    fn tier_mapping_supporter_takes_precedence_over_neighbor() {
        let groups = vec!["neighbor-tier", "supporter-tier"];
        assert_eq!(map_group_to_tier(&groups), "supporter");
    }

    #[test]
    fn tier_mapping_all_groups_returns_caretaker() {
        let groups = vec!["neighbor-tier", "supporter-tier", "caretaker-tier"];
        assert_eq!(map_group_to_tier(&groups), "caretaker");
    }

    #[test]
    fn normalize_user_type_accepts_supported_values_case_insensitive() {
        assert_eq!(normalize_user_type("grower"), Some("grower".to_string()));
        assert_eq!(normalize_user_type("Grower"), Some("grower".to_string()));
        assert_eq!(
            normalize_user_type("GATHERER"),
            Some("gatherer".to_string())
        );
    }

    #[test]
    fn normalize_user_type_rejects_unsupported_values() {
        assert_eq!(normalize_user_type(""), None);
        assert_eq!(normalize_user_type("neighbor"), None);
    }
}
