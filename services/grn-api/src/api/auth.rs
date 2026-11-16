use crate::db;
use lambda_http::{Error, Request, RequestExt};
use serde::{Deserialize, Serialize};
use tracing::{error, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserType {
    Grower,
}

#[derive(Debug, Clone)]
pub struct AuthContext {
    pub user_id: String,
    pub user_type: Option<UserType>,
    #[allow(dead_code)]
    // Preserved in context for shared authorizer compatibility and future admin route checks
    pub is_admin: bool,
    #[allow(dead_code)] // Will be used for tier-based authorization in future phases
    pub tier: String,
    #[allow(dead_code)] // Will be used for user communication features
    pub email: Option<String>,
}

pub fn extract_auth_context(request: &Request) -> Result<AuthContext, Error> {
    let user_id = extract_authorizer_field(request, "userId")
        .ok_or_else(|| Error::from("Missing userId in authorizer context"))?;

    let tier = extract_authorizer_field(request, "tier").unwrap_or_else(|| "free".to_string());

    let user_type = extract_authorizer_field(request, "userType").and_then(|s| parse_user_type(&s));
    let is_admin = extract_authorizer_field(request, "isAdmin")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));

    let email = extract_authorizer_field(request, "email");

    Ok(AuthContext {
        user_id,
        user_type,
        is_admin,
        tier,
        email,
    })
}

pub async fn extract_auth_context_with_fallback(request: &Request) -> Result<AuthContext, Error> {
    let mut context = extract_auth_context(request)?;

    if context.user_type.is_some() {
        return Ok(context);
    }

    context.user_type = load_user_type_from_db(&context.user_id).await;

    if context.user_type.is_none() {
        warn!(
            user_id = context.user_id.as_str(),
            "Unable to resolve user type from authorizer context or database"
        );
    }

    Ok(context)
}

async fn load_user_type_from_db(user_id: &str) -> Option<UserType> {
    let Ok(user_uuid) = Uuid::parse_str(user_id) else {
        warn!(
            user_id = user_id,
            "Invalid user id format while resolving user type fallback"
        );
        return None;
    };

    let client = match db::connect().await {
        Ok(client) => client,
        Err(error) => {
            error!(error = %error, user_id = user_id, "Failed to connect to database for user type fallback");
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
            .and_then(|raw| parse_user_type(&raw)),
        Ok(None) => None,
        Err(error) => {
            error!(error = %error, user_id = user_id, "Failed querying user type fallback");
            None
        }
    }
}

pub fn require_grower(ctx: &AuthContext) -> Result<(), Error> {
    match &ctx.user_type {
        Some(UserType::Grower) => Ok(()),
        None => {
            error!(
                user_id = ctx.user_id.as_str(),
                "User type not set, onboarding may be incomplete"
            );
            Err(Error::from(
                "Forbidden: User type not set. Please complete onboarding.",
            ))
        }
    }
}

#[allow(dead_code)] // Preserved for future GRN admin-only endpoints
pub fn require_admin(ctx: &AuthContext) -> Result<(), Error> {
    if ctx.is_admin {
        Ok(())
    } else {
        Err(Error::from(
            "Forbidden: This feature is only available to administrators",
        ))
    }
}

/// Whether the caller authenticated with a GRN API key rather than a signed-in
/// session. The authorizer stamps `authMethod: api_key` on key callers only.
pub fn authenticated_with_api_key(request: &Request) -> bool {
    extract_authorizer_field(request, "authMethod")
        .is_some_and(|method| method.eq_ignore_ascii_case("api_key"))
}

fn extract_authorizer_field(request: &Request, field_name: &str) -> Option<String> {
    request
        .request_context()
        .authorizer()
        .and_then(|auth| auth.fields.get(field_name))
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn parse_user_type(s: &str) -> Option<UserType> {
    match s.to_lowercase().as_str() {
        "grower" => Some(UserType::Grower),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // unwrap is acceptable in tests
mod tests {
    use super::*;

    fn request_with_authorizer(fields: &[(&str, &str)]) -> Request {
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

    #[test]
    fn api_key_callers_are_told_apart_from_sessions() {
        let session = request_with_authorizer(&[("userId", "u-1")]);
        let key = request_with_authorizer(&[("userId", "u-1"), ("authMethod", "api_key")]);
        assert!(!authenticated_with_api_key(&session));
        assert!(authenticated_with_api_key(&key));
    }

    #[test]
    fn parse_user_type_grower() {
        assert_eq!(parse_user_type("grower"), Some(UserType::Grower));
        assert_eq!(parse_user_type("Grower"), Some(UserType::Grower));
        assert_eq!(parse_user_type("GROWER"), Some(UserType::Grower));
    }

    #[test]
    fn parse_user_type_invalid() {
        assert_eq!(parse_user_type("invalid"), None);
        assert_eq!(parse_user_type(""), None);
        assert_eq!(parse_user_type("gatherer"), None);
        assert_eq!(parse_user_type("recipient"), None);
    }

    #[test]
    fn require_grower_with_grower_succeeds() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Grower),
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        assert!(require_grower(&ctx).is_ok());
    }

    #[test]
    fn require_grower_with_no_type_fails() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: None,
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        let result = require_grower(&ctx);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("User type not set"));
    }

    #[test]
    fn user_type_serialization() {
        let grower = UserType::Grower;
        let json = serde_json::to_string(&grower).unwrap();
        assert_eq!(json, r#""grower""#);
    }

    #[test]
    fn user_type_deserialization() {
        let grower: UserType = serde_json::from_str(r#""grower""#).unwrap();
        assert_eq!(grower, UserType::Grower);
    }

    #[test]
    fn require_admin_accepts_admins() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Grower),
            is_admin: true,
            tier: String::from("free"),
            email: None,
        };

        assert!(require_admin(&ctx).is_ok());
    }

    #[test]
    fn require_admin_rejects_non_admins() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Grower),
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };

        let result = require_admin(&ctx);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("administrators"));
    }
}
