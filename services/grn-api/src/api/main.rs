use lambda_http::{run, service_fn, Body, Error, Request, Response};

mod ai;
mod ai_model_config;
mod auth;
mod badge_cabinet;
mod badge_evidence;
mod db;
mod gardener_tier;
mod handlers;
mod location;
mod middleware;
mod models;
mod router;
mod structured_json;
mod tips_framework;

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    router::route_request(&event).await
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

    run(service_fn(function_handler)).await
}
