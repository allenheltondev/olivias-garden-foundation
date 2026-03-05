use aws_lambda_events::event::eventbridge::EventBridgeEvent;
use chrono::{DateTime, Duration, Utc};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use rustls::{ClientConfig, RootCertStore};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::str::FromStr;
use tokio_postgres::config::{ChannelBinding, Config};
use tokio_postgres::Client;
use tokio_postgres_rustls::MakeRustlsConnect;
use tracing::{error, info, warn};
use uuid::Uuid;

const SUPPORTED_WINDOWS_DAYS: [i32; 3] = [7, 14, 30];
const GEO_PRECISIONS: [usize; 3] = [4, 5, 6];
const SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
struct GeoScope {
    geo_boundary_key: String,
    crop_id: Option<Uuid>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DomainEvent {
    Listing {
        listing_id: Uuid,
    },
    Request {
        request_id: Uuid,
    },
    Claim {
        listing_id: Option<Uuid>,
        request_id: Option<Uuid>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListingEventDetail {
    listing_id: Uuid,
    occurred_at: Option<DateTime<Utc>>,
    correlation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestEventDetail {
    request_id: Uuid,
    occurred_at: Option<DateTime<Utc>>,
    correlation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimEventDetail {
    listing_id: Option<Uuid>,
    request_id: Option<Uuid>,
    occurred_at: Option<DateTime<Utc>>,
    correlation_id: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .without_time()
        .json()
        .init();

    run(service_fn(handler)).await
}

async fn handler(event: LambdaEvent<EventBridgeEvent<Value>>) -> Result<(), Error> {
    let bridge_event = event.payload;
    let detail_type = bridge_event.detail_type.clone();

    let (domain_event, occurred_at, correlation_id) =
        parse_event(&detail_type, &bridge_event.detail).map_err(Error::from)?;

    let processing_lag_seconds = (Utc::now() - occurred_at).num_seconds().max(0);

    info!(
        detail_type = detail_type,
        correlation_id = correlation_id,
        processing_lag_seconds = processing_lag_seconds,
        metric_name = "rolling_geo_aggregation.processing_lag_seconds",
        metric_value = processing_lag_seconds,
        "Received aggregation event"
    );

    let client = connect_db().await.map_err(Error::from)?;

    let scopes = resolve_scopes(&client, &domain_event)
        .await
        .map_err(Error::from)?;
    if scopes.is_empty() {
        warn!(
            detail_type = detail_type,
            correlation_id = correlation_id,
            "No geo scopes resolved for event; skipping"
        );
        return Ok(());
    }

    let bucket_start = compute_bucket_start(occurred_at);

    for scope in scopes {
        for window_days in SUPPORTED_WINDOWS_DAYS {
            recompute_and_upsert(&client, &scope, window_days, bucket_start)
                .await
                .map_err(Error::from)?;
        }
    }

    info!(
        detail_type = detail_type,
        correlation_id = correlation_id,
        processing_lag_seconds = processing_lag_seconds,
        "Completed rolling geo aggregation processing"
    );

    Ok(())
}

fn parse_event(
    detail_type: &str,
    detail: &Value,
) -> Result<(DomainEvent, DateTime<Utc>, String), String> {
    match detail_type {
        "listing.created" | "listing.updated" => {
            let parsed: ListingEventDetail =
                serde_json::from_value(detail.clone()).map_err(|e| e.to_string())?;
            Ok((
                DomainEvent::Listing {
                    listing_id: parsed.listing_id,
                },
                parsed.occurred_at.unwrap_or_else(Utc::now),
                parsed
                    .correlation_id
                    .unwrap_or_else(|| "unknown-correlation-id".to_string()),
            ))
        }
        "request.created" | "request.updated" => {
            let parsed: RequestEventDetail =
                serde_json::from_value(detail.clone()).map_err(|e| e.to_string())?;
            Ok((
                DomainEvent::Request {
                    request_id: parsed.request_id,
                },
                parsed.occurred_at.unwrap_or_else(Utc::now),
                parsed
                    .correlation_id
                    .unwrap_or_else(|| "unknown-correlation-id".to_string()),
            ))
        }
        "claim.created" | "claim.updated" => {
            let parsed: ClaimEventDetail =
                serde_json::from_value(detail.clone()).map_err(|e| e.to_string())?;
            Ok((
                DomainEvent::Claim {
                    listing_id: parsed.listing_id,
                    request_id: parsed.request_id,
                },
                parsed.occurred_at.unwrap_or_else(Utc::now),
                parsed
                    .correlation_id
                    .unwrap_or_else(|| "unknown-correlation-id".to_string()),
            ))
        }
        other => Err(format!("Unsupported detail type: {other}")),
    }
}

async fn connect_db() -> Result<Client, String> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;

    let mut config =
        Config::from_str(&database_url).map_err(|e| format!("Invalid DATABASE_URL: {e}"))?;

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
        return Err("No native root certificates available for TLS".to_string());
    }

    let tls_config = ClientConfig::builder()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    let tls_connector = MakeRustlsConnect::new(tls_config);

    let (client, connection) = config
        .connect(tls_connector)
        .await
        .map_err(|e| format!("Failed to connect to Postgres: {e}"))?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            error!(error = %e, error_debug = ?e, "Database connection error");
        }
    });

    Ok(client)
}

async fn resolve_scopes(client: &Client, event: &DomainEvent) -> Result<Vec<GeoScope>, String> {
    let mut source_pairs: Vec<(String, Option<Uuid>)> = Vec::new();

    match event {
        DomainEvent::Listing { listing_id } => {
            if let Some(pair) = load_listing_scope(client, *listing_id).await? {
                source_pairs.push(pair);
            }
        }
        DomainEvent::Request { request_id } => {
            if let Some(pair) = load_request_scope(client, *request_id).await? {
                source_pairs.push(pair);
            }
        }
        DomainEvent::Claim {
            listing_id,
            request_id,
        } => {
            if let Some(listing_id) = listing_id {
                if let Some(pair) = load_listing_scope(client, *listing_id).await? {
                    source_pairs.push(pair);
                }
            }

            if let Some(request_id) = request_id {
                if let Some(pair) = load_request_scope(client, *request_id).await? {
                    source_pairs.push(pair);
                }
            }
        }
    }

    Ok(expand_geo_scopes(&source_pairs))
}

async fn load_listing_scope(
    client: &Client,
    listing_id: Uuid,
) -> Result<Option<(String, Option<Uuid>)>, String> {
    let row = client
        .query_opt(
            "
            select geo_key, crop_id
            from surplus_listings
            where id = $1
              and deleted_at is null
            ",
            &[&listing_id],
        )
        .await
        .map_err(|e| format!("Failed to read listing scope: {e}"))?;

    Ok(row.and_then(|r| {
        let geo_key = r.get::<_, Option<String>>("geo_key")?;
        let crop_id = r.get::<_, Option<Uuid>>("crop_id");
        Some((geo_key, crop_id))
    }))
}

async fn load_request_scope(
    client: &Client,
    request_id: Uuid,
) -> Result<Option<(String, Option<Uuid>)>, String> {
    let row = client
        .query_opt(
            "
            select geo_key, crop_id
            from requests
            where id = $1
              and deleted_at is null
            ",
            &[&request_id],
        )
        .await
        .map_err(|e| format!("Failed to read request scope: {e}"))?;

    Ok(row.and_then(|r| {
        let geo_key = r.get::<_, Option<String>>("geo_key")?;
        let crop_id = r.get::<_, Option<Uuid>>("crop_id");
        Some((geo_key, crop_id))
    }))
}

fn expand_geo_scopes(source_pairs: &[(String, Option<Uuid>)]) -> Vec<GeoScope> {
    let mut dedupe: HashSet<(String, Option<Uuid>)> = HashSet::new();

    for (geo_key, crop_id) in source_pairs {
        for prefix in geo_prefixes(geo_key) {
            dedupe.insert((prefix.clone(), *crop_id));
            dedupe.insert((prefix, None));
        }
    }

    dedupe
        .into_iter()
        .map(|(geo_boundary_key, crop_id)| GeoScope {
            geo_boundary_key,
            crop_id,
        })
        .collect()
}

fn geo_prefixes(geo_key: &str) -> Vec<String> {
    let normalized = geo_key.trim().to_ascii_lowercase();

    GEO_PRECISIONS
        .iter()
        .filter(|p| normalized.len() >= **p)
        .map(|p| normalized[..*p].to_string())
        .collect()
}

async fn recompute_and_upsert(
    client: &Client,
    scope: &GeoScope,
    window_days: i32,
    bucket_start: DateTime<Utc>,
) -> Result<(), String> {
    let window_start = Utc::now() - Duration::days(i64::from(window_days));
    let expires_at = Utc::now() + Duration::days(i64::from(retention_days(window_days)));

    let listing_row = client
        .query_one(
            "
            select
              count(*)::int as listing_count,
              coalesce(sum(quantity_remaining), 0)::numeric as supply_quantity
            from surplus_listings
            where deleted_at is null
              and status in ('active', 'pending', 'claimed')
              and created_at >= $1
              and geo_key like $2
              and ($3::uuid is null or crop_id = $3)
            ",
            &[
                &window_start,
                &format!("{}%", scope.geo_boundary_key),
                &scope.crop_id,
            ],
        )
        .await
        .map_err(|e| format!("Failed to aggregate listings: {e}"))?;

    let request_row = client
        .query_one(
            "
            select
              count(*)::int as request_count,
              coalesce(sum(quantity), 0)::numeric as demand_quantity
            from requests
            where deleted_at is null
              and status = 'open'
              and created_at >= $1
              and geo_key like $2
              and ($3::uuid is null or crop_id = $3)
            ",
            &[
                &window_start,
                &format!("{}%", scope.geo_boundary_key),
                &scope.crop_id,
            ],
        )
        .await
        .map_err(|e| format!("Failed to aggregate requests: {e}"))?;

    let listing_count: i32 = listing_row.get("listing_count");
    let request_count: i32 = request_row.get("request_count");
    let supply_quantity: f64 = listing_row.get::<_, f64>("supply_quantity");
    let demand_quantity: f64 = request_row.get::<_, f64>("demand_quantity");

    let scarcity_score = demand_quantity / (supply_quantity + 1.0);
    let abundance_score = supply_quantity / (demand_quantity + 1.0);

    let mut signal_payload = HashMap::new();
    signal_payload.insert("listingCount", serde_json::json!(listing_count));
    signal_payload.insert("requestCount", serde_json::json!(request_count));
    signal_payload.insert("windowDays", serde_json::json!(window_days));
    let signal_payload_json = serde_json::to_string(&signal_payload)
        .map_err(|e| format!("Invalid signal payload JSON: {e}"))?;

    client
        .execute(
            "
            select upsert_derived_supply_signal(
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12::jsonb,
              $13, $14
            )
            ",
            &[
                &SCHEMA_VERSION,
                &scope.geo_boundary_key,
                &window_days,
                &bucket_start,
                &scope.crop_id,
                &listing_count,
                &request_count,
                &supply_quantity,
                &demand_quantity,
                &scarcity_score,
                &abundance_score,
                &signal_payload_json,
                &Utc::now(),
                &expires_at,
            ],
        )
        .await
        .map_err(|e| format!("Failed to upsert derived supply signal: {e}"))?;

    Ok(())
}

fn compute_bucket_start(occurred_at: DateTime<Utc>) -> DateTime<Utc> {
    let seconds = occurred_at.timestamp();
    let bucket_seconds = 5 * 60;
    let floored = seconds - seconds.rem_euclid(bucket_seconds);

    DateTime::<Utc>::from_timestamp(floored, 0).unwrap_or(occurred_at)
}

const fn retention_days(window_days: i32) -> i32 {
    match window_days {
        7 => 35,
        14 => 49,
        _ => 90,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_listing_event() {
        let detail = serde_json::json!({
            "listingId": "8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef",
            "occurredAt": "2026-02-20T21:00:00Z",
            "correlationId": "corr-1"
        });

        let (event, occurred_at, correlation_id) = parse_event("listing.created", &detail).unwrap();
        assert!(matches!(event, DomainEvent::Listing { .. }));
        assert_eq!(occurred_at.to_rfc3339(), "2026-02-20T21:00:00+00:00");
        assert_eq!(correlation_id, "corr-1");
    }

    #[test]
    fn expand_geo_scopes_deduplicates_duplicate_events() {
        let crop = Some(Uuid::parse_str("8b5a1a3e-d7ad-4ca4-9f56-2f188db4e6ef").unwrap());
        let source = vec![("9q8yyk8".to_string(), crop), ("9q8yyk8".to_string(), crop)];

        let scopes = expand_geo_scopes(&source);
        let unique: HashSet<(String, Option<Uuid>)> = scopes
            .iter()
            .map(|s| (s.geo_boundary_key.clone(), s.crop_id))
            .collect();

        // 3 prefixes x (crop + all-crops)
        assert_eq!(unique.len(), 6);
    }

    #[test]
    fn geo_prefixes_use_expected_precisions() {
        let prefixes = geo_prefixes("9q8yyk8");
        assert_eq!(prefixes, vec!["9q8y", "9q8yy", "9q8yyk"]);
    }

    #[test]
    fn retention_matches_spec() {
        assert_eq!(retention_days(7), 35);
        assert_eq!(retention_days(14), 49);
        assert_eq!(retention_days(30), 90);
    }

    #[test]
    fn compute_bucket_start_is_deterministic_for_duplicate_event_replays() {
        let occurred_at = DateTime::parse_from_rfc3339("2026-02-20T21:03:19Z")
            .unwrap()
            .with_timezone(&Utc);

        let first = compute_bucket_start(occurred_at);
        let second = compute_bucket_start(occurred_at);

        assert_eq!(first, second);
        assert_eq!(first.to_rfc3339(), "2026-02-20T21:00:00+00:00");
    }
}
