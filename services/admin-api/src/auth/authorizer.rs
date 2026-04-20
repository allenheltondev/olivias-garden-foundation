use aws_lambda_events::event::apigw::ApiGatewayCustomAuthorizerRequestTypeRequest;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::error;

#[derive(Debug, Deserialize)]
struct JwtClaims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    token_use: Option<String>,
    #[serde(default, rename = "cognito:groups")]
    cognito_groups: Vec<String>,
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

    run(service_fn(
        move |event: LambdaEvent<ApiGatewayCustomAuthorizerRequestTypeRequest>| {
            let user_pool_id = user_pool_id.clone();
            let user_pool_client_id = user_pool_client_id.clone();
            async move { handler(event.payload, &user_pool_id, &user_pool_client_id).await }
        },
    ))
    .await
}

async fn handler(
    event: ApiGatewayCustomAuthorizerRequestTypeRequest,
    user_pool_id: &str,
    user_pool_client_id: &str,
) -> Result<PolicyResponse, Error> {
    if event.http_method.as_ref().map(reqwest::Method::as_str) == Some("OPTIONS") {
        let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
        return Ok(generate_policy("anonymous", "Allow", &api_arn, None));
    }

    if is_public_route(&event) {
        let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
        return Ok(generate_policy("anonymous", "Allow", &api_arn, None));
    }

    match authorize_admin(&event, user_pool_id, user_pool_client_id).await {
        Ok(policy) => Ok(policy),
        Err(err) => {
            error!(error = %err, "Authorization failed");
            let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
            Ok(generate_policy("anonymous", "Deny", &api_arn, None))
        }
    }
}

async fn authorize_admin(
    event: &ApiGatewayCustomAuthorizerRequestTypeRequest,
    user_pool_id: &str,
    user_pool_client_id: &str,
) -> Result<PolicyResponse, Error> {
    let auth_header = event
        .headers
        .get("authorization")
        .or_else(|| event.headers.get("Authorization"))
        .and_then(|value| value.to_str().ok())
        .ok_or("No Authorization header provided")?;

    if !auth_header.starts_with("Bearer ") {
        return Err("Invalid authorization header format".into());
    }

    let token = auth_header.trim_start_matches("Bearer ");
    let claims = verify_jwt(token, user_pool_id, user_pool_client_id).await?;
    let principal_id = claims.sub.ok_or("Missing sub claim")?;
    let is_admin = claims
        .cognito_groups
        .iter()
        .any(|group| group.eq_ignore_ascii_case("admin"));

    if !is_admin {
        return Err("Missing admin group".into());
    }

    let api_arn = get_api_arn_pattern(event.method_arn.as_deref().unwrap_or_default());
    let context = build_context([
        ("userId", Some(principal_id.clone())),
        ("isAdmin", Some("true".to_string())),
    ]);

    Ok(generate_policy(&principal_id, "Allow", &api_arn, context))
}

fn is_public_route(event: &ApiGatewayCustomAuthorizerRequestTypeRequest) -> bool {
    let method = event.http_method.as_ref().map(reqwest::Method::as_str);
    let path = event.path.as_deref().unwrap_or_default();

    matches!(method, Some("GET")) && (path == "/api/store/products" || path == "/store/products")
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
        .as_ref()
        .is_none_or(|value| *value != "access")
    {
        return Err("Invalid token_use claim".into());
    }

    if token_data
        .claims
        .client_id
        .as_deref()
        .as_ref()
        .is_none_or(|value| *value != client_id)
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
