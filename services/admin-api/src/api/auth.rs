use lambda_http::{Error, Request, RequestExt};

#[derive(Debug, Clone)]
pub struct AuthContext {
    #[allow(dead_code)]
    pub user_id: String,
    pub is_admin: bool,
}

pub fn extract_auth_context(request: &Request) -> Result<AuthContext, Error> {
    let user_id = extract_authorizer_field(request, "userId")
        .ok_or_else(|| Error::from("Missing userId in authorizer context"))?;

    let is_admin = extract_authorizer_field(request, "isAdmin")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));

    Ok(AuthContext { user_id, is_admin })
}

pub fn require_admin(ctx: &AuthContext) -> Result<(), Error> {
    if ctx.is_admin {
        Ok(())
    } else {
        Err(Error::from(
            "Forbidden: This feature is only available to administrators",
        ))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn require_admin_accepts_admins() {
        let ctx = AuthContext {
            user_id: "user-1".to_string(),
            is_admin: true,
        };

        assert!(require_admin(&ctx).is_ok());
    }

    #[test]
    fn require_admin_rejects_non_admins() {
        let ctx = AuthContext {
            user_id: "user-1".to_string(),
            is_admin: false,
        };

        let result = require_admin(&ctx);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("administrators"));
    }
}
