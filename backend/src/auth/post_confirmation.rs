use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use rustls::{ClientConfig, RootCertStore};
use serde_json::Value;
use std::str::FromStr;
use tokio_postgres::config::{ChannelBinding, Config};
use tokio_postgres::Client;
use tokio_postgres_rustls::MakeRustlsConnect;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
struct PostConfirmationContext {
    correlation_id: String,
    trigger_source: Option<String>,
    user_id: Uuid,
    email: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(handler)).await
}

async fn handler(event: LambdaEvent<Value>) -> Result<Value, Error> {
    let (payload, _context) = event.into_parts();
    let onboarding_context = parse_context(&payload)?;

    if !is_post_confirmation_trigger(onboarding_context.trigger_source.as_deref()) {
        warn!(
            correlation_id = onboarding_context.correlation_id.as_str(),
            trigger_source = onboarding_context
                .trigger_source
                .as_deref()
                .unwrap_or("unknown"),
            "Skipping unsupported Cognito trigger"
        );
        return Ok(payload);
    }

    let client = connect().await?;
    upsert_shell_user(
        &client,
        onboarding_context.user_id,
        onboarding_context.email.as_deref(),
    )
    .await?;

    info!(
        correlation_id = onboarding_context.correlation_id.as_str(),
        user_id = onboarding_context.user_id.to_string(),
        has_email = onboarding_context.email.is_some(),
        "Provisioned shell user after Cognito post-confirmation"
    );

    Ok(payload)
}

fn parse_context(payload: &Value) -> Result<PostConfirmationContext, Error> {
    let trigger_source = payload
        .get("triggerSource")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let attributes = payload.pointer("/request/userAttributes").ok_or_else(|| {
        Error::from("Missing request.userAttributes in Cognito event".to_string())
    })?;

    let user_id_raw = attributes
        .get("sub")
        .and_then(Value::as_str)
        .ok_or_else(|| Error::from("Missing userAttributes.sub in Cognito event".to_string()))?;

    let user_id = Uuid::parse_str(user_id_raw)
        .map_err(|_| Error::from("userAttributes.sub must be a valid UUID".to_string()))?;

    let email = attributes
        .get("email")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    let correlation_id = payload
        .pointer("/request/clientMetadata/correlationId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .pointer("/request/clientMetadata/correlation_id")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    Ok(PostConfirmationContext {
        correlation_id,
        trigger_source,
        user_id,
        email,
    })
}

fn is_post_confirmation_trigger(trigger_source: Option<&str>) -> bool {
    matches!(
        trigger_source,
        Some(
            "PostConfirmation_ConfirmSignUp"
                | "PostConfirmation_AdminConfirmSignUp"
                | "PostConfirmation_ConfirmForgotPassword"
        )
    )
}

async fn connect() -> Result<Client, Error> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| Error::from("DATABASE_URL is required".to_string()))?;

    let mut config = Config::from_str(&database_url)
        .map_err(|e| Error::from(format!("Invalid DATABASE_URL: {e}")))?;

    if matches!(config.get_channel_binding(), ChannelBinding::Require) {
        warn!(
            "DATABASE_URL requested channel_binding=require; downgrading to prefer for compatibility"
        );
        config.channel_binding(ChannelBinding::Prefer);
    }

    let cert_result = rustls_native_certs::load_native_certs();
    let mut root_store = RootCertStore::empty();
    let (added, _) = root_store.add_parsable_certificates(cert_result.certs);
    if added == 0 {
        return Err(Error::from(
            "No native root certificates available for TLS".to_string(),
        ));
    }

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let tls_connector = MakeRustlsConnect::new(tls_config);

    let (client, connection) = config
        .connect(tls_connector)
        .await
        .map_err(|e| Error::from(format!("Database connection error: {e}")))?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            tracing::error!(error = %e, error_debug = ?e, "Postgres connection error");
        }
    });

    Ok(client)
}

async fn upsert_shell_user(
    client: &Client,
    user_id: Uuid,
    email: Option<&str>,
) -> Result<(), Error> {
    client
        .execute(
            "
            insert into users (id, email)
            values ($1, $2)
            on conflict (id) do update
            set email = coalesce(users.email, excluded.email)
            ",
            &[&user_id, &email],
        )
        .await
        .map_err(|error| Error::from(format!("Database query error: {error}")))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_context_extracts_fields() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "clientMetadata": {
                    "correlationId": "corr-123"
                },
                "userAttributes": {
                    "sub": "11111111-1111-1111-1111-111111111111",
                    "email": "new-user@example.com"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_ok());

        let Ok(context) = result else { return };

        assert_eq!(
            context.trigger_source.as_deref(),
            Some("PostConfirmation_ConfirmSignUp")
        );
        assert_eq!(context.correlation_id, "corr-123");
        assert_eq!(context.email.as_deref(), Some("new-user@example.com"));
        assert_eq!(
            context.user_id.to_string(),
            "11111111-1111-1111-1111-111111111111"
        );
    }

    #[test]
    fn parse_context_supports_snake_case_correlation_key() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "clientMetadata": {
                    "correlation_id": "corr-456"
                },
                "userAttributes": {
                    "sub": "22222222-2222-2222-2222-222222222222"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_ok());

        let Ok(context) = result else { return };

        assert_eq!(context.correlation_id, "corr-456");
        assert!(context.email.is_none());
    }

    #[test]
    fn parse_context_rejects_invalid_uuid() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "userAttributes": {
                    "sub": "not-a-uuid"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_err());
    }

    #[test]
    fn parse_context_rejects_missing_user_attributes() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "clientMetadata": {
                    "correlationId": "corr-123"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_err());
        assert!(result
            .err()
            .is_some_and(|error| error.to_string().contains("Missing request.userAttributes")));
    }

    #[test]
    fn parse_context_rejects_missing_sub() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "userAttributes": {
                    "email": "new-user@example.com"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_err());
        assert!(result
            .err()
            .is_some_and(|error| error.to_string().contains("Missing userAttributes.sub")));
    }

    #[test]
    fn parse_context_generates_uuid_correlation_id_when_missing_metadata() {
        let payload = json!({
            "triggerSource": "PostConfirmation_ConfirmSignUp",
            "request": {
                "userAttributes": {
                    "sub": "11111111-1111-1111-1111-111111111111"
                }
            }
        });

        let result = parse_context(&payload);
        assert!(result.is_ok());

        let Ok(context) = result else { return };

        assert!(Uuid::parse_str(&context.correlation_id).is_ok());
    }

    #[test]
    fn post_confirmation_trigger_filter_is_strict() {
        assert!(is_post_confirmation_trigger(Some(
            "PostConfirmation_ConfirmSignUp"
        )));
        assert!(is_post_confirmation_trigger(Some(
            "PostConfirmation_AdminConfirmSignUp"
        )));
        assert!(is_post_confirmation_trigger(Some(
            "PostConfirmation_ConfirmForgotPassword"
        )));
        assert!(!is_post_confirmation_trigger(Some("PreSignUp_SignUp")));
        assert!(!is_post_confirmation_trigger(None));
    }
}
