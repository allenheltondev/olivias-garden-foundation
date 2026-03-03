use lambda_http::{run, service_fn, Body, Error, Request, Response};

mod ai;
mod ai_model_config;
mod auth;
mod db;
mod handlers;
mod location;
mod middleware;
mod models;
mod router;
mod structured_json;

async fn function_handler(event: Request) -> Result<Response<Body>, Error> {
    router::route_request(&event).await
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .json()
        .init();

    run(service_fn(function_handler)).await
}
