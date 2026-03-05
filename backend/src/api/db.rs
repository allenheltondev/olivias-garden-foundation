use rustls::{ClientConfig, RootCertStore};
use std::env;
use tokio_postgres::Client;
use tokio_postgres_rustls::MakeRustlsConnect;

pub async fn connect() -> Result<Client, lambda_http::Error> {
    let database_url = env::var("DATABASE_URL")
        .map_err(|_| lambda_http::Error::from("DATABASE_URL is required".to_string()))?;

    let cert_result = rustls_native_certs::load_native_certs();
    let mut root_store = RootCertStore::empty();
    let (added, _) = root_store.add_parsable_certificates(cert_result.certs);

    if added == 0 {
        return Err(lambda_http::Error::from(
            "No native root certificates available for TLS".to_string(),
        ));
    }

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let tls_connector = MakeRustlsConnect::new(tls_config);

    let (client, connection) = tokio_postgres::connect(&database_url, tls_connector)
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database connection error: {e}")))?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            tracing::error!(error = %e, "Postgres connection error");
        }
    });

    Ok(client)
}
