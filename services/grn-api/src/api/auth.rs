use crate::db;
use lambda_http::{Error, Request, RequestExt};
use serde::{Deserialize, Serialize};
use tracing::{error, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserType {
    Grower,
    Gatherer,
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
        Some(UserType::Gatherer) => {
            error!(
                user_id = ctx.user_id.as_str(),
                "Gatherers cannot access grower-only features"
            );
            Err(Error::from(
                "Forbidden: This feature is only available to growers",
            ))
        }
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

pub fn require_participant_user_type(user_type: Option<&UserType>) -> Result<(), Error> {
    match user_type {
        Some(UserType::Grower | UserType::Gatherer) => Ok(()),
        None => Err(Error::from(
            "Forbidden: User type not set. Please complete onboarding.",
        )),
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

#[allow(dead_code)] // Will be used when gatherer-specific endpoints are implemented
pub fn require_user_type(ctx: &AuthContext, required: &UserType) -> Result<(), Error> {
    match &ctx.user_type {
        Some(user_type) if user_type == required => Ok(()),
        Some(_) => {
            error!(
                user_id = ctx.user_id.as_str(),
                required_type = ?required,
                actual_type = ?ctx.user_type,
                "User does not have required user type"
            );
            Err(Error::from(format!(
                "Forbidden: This feature requires user type {required:?}"
            )))
        }
        None => {
            error!(
                user_id = ctx.user_id.as_str(),
                required_type = ?required,
                "User type not set, onboarding may be incomplete"
            );
            Err(Error::from(
                "Forbidden: User type not set. Please complete onboarding.",
            ))
        }
    }
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
        "gatherer" => Some(UserType::Gatherer),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)] // unwrap is acceptable in tests
mod tests {
    use super::*;

    #[test]
    fn parse_user_type_grower() {
        assert_eq!(parse_user_type("grower"), Some(UserType::Grower));
        assert_eq!(parse_user_type("Grower"), Some(UserType::Grower));
        assert_eq!(parse_user_type("GROWER"), Some(UserType::Grower));
    }

    #[test]
    fn parse_user_type_gatherer() {
        assert_eq!(parse_user_type("gatherer"), Some(UserType::Gatherer));
        assert_eq!(parse_user_type("Gatherer"), Some(UserType::Gatherer));
        assert_eq!(parse_user_type("GATHERER"), Some(UserType::Gatherer));
    }

    #[test]
    fn parse_user_type_invalid() {
        assert_eq!(parse_user_type("invalid"), None);
        assert_eq!(parse_user_type(""), None);
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
    fn require_grower_with_gatherer_fails() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Gatherer),
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        let result = require_grower(&ctx);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("only available to growers"));
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
    fn require_participant_user_type_accepts_grower_and_gatherer() {
        assert!(require_participant_user_type(Some(&UserType::Grower)).is_ok());
        assert!(require_participant_user_type(Some(&UserType::Gatherer)).is_ok());
    }

    #[test]
    fn require_participant_user_type_rejects_missing_type() {
        let result = require_participant_user_type(None);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("User type not set"));
    }

    #[test]
    fn require_user_type_with_matching_type_succeeds() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Gatherer),
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        assert!(require_user_type(&ctx, &UserType::Gatherer).is_ok());
    }

    #[test]
    fn require_user_type_with_non_matching_type_fails() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: Some(UserType::Grower),
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        let result = require_user_type(&ctx, &UserType::Gatherer);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("requires user type"));
    }

    #[test]
    fn require_user_type_with_no_type_fails() {
        let ctx = AuthContext {
            user_id: String::from("test-user"),
            user_type: None,
            is_admin: false,
            tier: String::from("free"),
            email: None,
        };
        let result = require_user_type(&ctx, &UserType::Grower);
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

        let gatherer = UserType::Gatherer;
        let json = serde_json::to_string(&gatherer).unwrap();
        assert_eq!(json, r#""gatherer""#);
    }

    #[test]
    fn user_type_deserialization() {
        let grower: UserType = serde_json::from_str(r#""grower""#).unwrap();
        assert_eq!(grower, UserType::Grower);

        let gatherer: UserType = serde_json::from_str(r#""gatherer""#).unwrap();
        assert_eq!(gatherer, UserType::Gatherer);
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
