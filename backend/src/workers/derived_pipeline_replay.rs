use chrono::{DateTime, Duration, Utc};
use rustls::{ClientConfig, RootCertStore};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::fs;
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

#[derive(Debug, Clone)]
enum ReplayMode {
    Replay,
    Backfill,
}

#[derive(Debug, Clone)]
struct CliConfig {
    mode: ReplayMode,
    from: Option<DateTime<Utc>>,
    to: DateTime<Utc>,
    checkpoint_file: Option<String>,
    dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReplayCheckpoint {
    last_processed_to: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    mode: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_level(true)
        .without_time()
        .json()
        .init();

    let config = parse_cli_config()?;
    let client = connect_db().await?;

    let scopes = match config.mode {
        ReplayMode::Replay => load_replay_scopes(&client, config.from, config.to).await?,
        ReplayMode::Backfill => load_backfill_scopes(&client).await?,
    };

    if scopes.is_empty() {
        warn!("No scopes found for replay/backfill; exiting");
        return Ok(());
    }

    info!(
        mode = %mode_name(&config.mode),
        dry_run = config.dry_run,
        from = ?config.from,
        to = %config.to,
        scope_count = scopes.len(),
        "Starting derived pipeline replay"
    );

    let bucket_start = compute_bucket_start(config.to);
    let mut recompute_count = 0_u64;

    for scope in &scopes {
        for window_days in SUPPORTED_WINDOWS_DAYS {
            if config.dry_run {
                info!(
                    geo_boundary_key = scope.geo_boundary_key,
                    crop_id = ?scope.crop_id,
                    window_days,
                    "Dry-run: would recompute derived signal"
                );
            } else {
                recompute_and_upsert(&client, scope, window_days, bucket_start).await?;
            }
            recompute_count += 1;
        }
    }

    if !config.dry_run {
        if let Some(path) = &config.checkpoint_file {
            write_checkpoint(path, &config)?;
        }
    }

    info!(
        mode = %mode_name(&config.mode),
        dry_run = config.dry_run,
        scope_count = scopes.len(),
        recompute_count,
        "Completed derived pipeline replay"
    );

    Ok(())
}

fn parse_cli_config() -> Result<CliConfig, String> {
    let mode = match env::var("REPLAY_MODE")
        .unwrap_or_else(|_| "replay".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "replay" => ReplayMode::Replay,
        "backfill" => ReplayMode::Backfill,
        other => {
            return Err(format!(
                "Invalid REPLAY_MODE '{other}'. Allowed: replay|backfill"
            ))
        }
    };

    let checkpoint_file = env::var("CHECKPOINT_FILE").ok();
    let dry_run = parse_bool_env("DRY_RUN").unwrap_or(false);

    let now = Utc::now();
    let to = env::var("TO_TS")
        .ok()
        .map(|v| parse_ts(&v, "TO_TS"))
        .transpose()?
        .unwrap_or(now);

    let from = if let Ok(from_ts) = env::var("FROM_TS") {
        Some(parse_ts(&from_ts, "FROM_TS")?)
    } else if let Some(path) = checkpoint_file.as_deref() {
        read_checkpoint(path)?.map_or_else(|| default_from_for_mode(&mode, to), Some)
    } else {
        default_from_for_mode(&mode, to)
    };

    Ok(CliConfig {
        mode,
        from,
        to,
        checkpoint_file,
        dry_run,
    })
}

fn default_from_for_mode(mode: &ReplayMode, to: DateTime<Utc>) -> Option<DateTime<Utc>> {
    match mode {
        ReplayMode::Replay => Some(to - Duration::hours(24)),
        ReplayMode::Backfill => None,
    }
}

fn parse_ts(value: &str, field: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|v| v.with_timezone(&Utc))
        .map_err(|e| format!("Invalid {field} timestamp '{value}': {e}"))
}

fn parse_bool_env(name: &str) -> Option<bool> {
    env::var(name).ok().and_then(|value| match value.as_str() {
        "1" | "true" | "TRUE" | "yes" | "on" => Some(true),
        "0" | "false" | "FALSE" | "no" | "off" => Some(false),
        _ => None,
    })
}

fn read_checkpoint(path: &str) -> Result<Option<DateTime<Utc>>, String> {
    match fs::read_to_string(path) {
        Ok(raw) => {
            let parsed: ReplayCheckpoint =
                serde_json::from_str(&raw).map_err(|e| format!("Invalid checkpoint JSON: {e}"))?;
            Ok(Some(parsed.last_processed_to))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Failed to read checkpoint file: {err}")),
    }
}

fn write_checkpoint(path: &str, config: &CliConfig) -> Result<(), String> {
    let checkpoint = ReplayCheckpoint {
        last_processed_to: config.to,
        updated_at: Utc::now(),
        mode: mode_name(&config.mode).to_string(),
    };

    let payload = serde_json::to_string_pretty(&checkpoint)
        .map_err(|e| format!("Failed to serialize checkpoint: {e}"))?;
    fs::write(path, payload).map_err(|e| format!("Failed to write checkpoint file: {e}"))
}

const fn mode_name(mode: &ReplayMode) -> &'static str {
    match mode {
        ReplayMode::Replay => "replay",
        ReplayMode::Backfill => "backfill",
    }
}

async fn connect_db() -> Result<Client, String> {
    let database_url = env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL environment variable is required".to_string())?;

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

    let (client, connection) = tokio_postgres::connect(&database_url, tls_connector)
        .await
        .map_err(|e| format!("Failed to connect to Postgres: {e}"))?;

    tokio::spawn(async move {
        if let Err(e) = connection.await {
            error!(error = %e, "Database connection error");
        }
    });

    Ok(client)
}

async fn load_replay_scopes(
    client: &Client,
    from: Option<DateTime<Utc>>,
    to: DateTime<Utc>,
) -> Result<Vec<GeoScope>, String> {
    let from_ts = from.unwrap_or(to - Duration::hours(24));

    let listing_rows = client
        .query(
            "
            select geo_key, crop_id
            from surplus_listings
            where deleted_at is null
              and created_at >= $1
              and created_at < $2
              and geo_key is not null
            ",
            &[&from_ts, &to],
        )
        .await
        .map_err(|e| format!("Failed to load listing scopes for replay: {e}"))?;

    let request_rows = client
        .query(
            "
            select geo_key, crop_id
            from requests
            where deleted_at is null
              and created_at >= $1
              and created_at < $2
              and geo_key is not null
            ",
            &[&from_ts, &to],
        )
        .await
        .map_err(|e| format!("Failed to load request scopes for replay: {e}"))?;

    let claim_rows = client
        .query(
            "
            select l.geo_key as listing_geo_key, l.crop_id as listing_crop_id,
                   r.geo_key as request_geo_key, r.crop_id as request_crop_id
            from claims c
            join surplus_listings l on l.id = c.listing_id
            left join requests r on r.id = c.request_id
            where c.claimed_at >= $1
              and c.claimed_at < $2
              and l.deleted_at is null
            ",
            &[&from_ts, &to],
        )
        .await
        .map_err(|e| format!("Failed to load claim scopes for replay: {e}"))?;

    let mut pairs: Vec<(String, Option<Uuid>)> = Vec::new();

    for row in listing_rows {
        let geo_key: String = row.get("geo_key");
        let crop_id: Option<Uuid> = row.get("crop_id");
        pairs.push((geo_key, crop_id));
    }

    for row in request_rows {
        let geo_key: String = row.get("geo_key");
        let crop_id: Option<Uuid> = row.get("crop_id");
        pairs.push((geo_key, crop_id));
    }

    for row in claim_rows {
        let listing_geo_key: Option<String> = row.get("listing_geo_key");
        let listing_crop_id: Option<Uuid> = row.get("listing_crop_id");
        let request_geo_key: Option<String> = row.get("request_geo_key");
        let request_crop_id: Option<Uuid> = row.get("request_crop_id");

        if let Some(geo_key) = listing_geo_key {
            pairs.push((geo_key, listing_crop_id));
        }
        if let Some(geo_key) = request_geo_key {
            pairs.push((geo_key, request_crop_id));
        }
    }

    Ok(expand_geo_scopes(&pairs))
}

async fn load_backfill_scopes(client: &Client) -> Result<Vec<GeoScope>, String> {
    let listing_rows = client
        .query(
            "
            select distinct geo_key, crop_id
            from surplus_listings
            where deleted_at is null
              and geo_key is not null
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Failed to load listing scopes for backfill: {e}"))?;

    let request_rows = client
        .query(
            "
            select distinct geo_key, crop_id
            from requests
            where deleted_at is null
              and geo_key is not null
            ",
            &[],
        )
        .await
        .map_err(|e| format!("Failed to load request scopes for backfill: {e}"))?;

    let mut pairs: Vec<(String, Option<Uuid>)> = Vec::new();

    for row in listing_rows {
        let geo_key: String = row.get("geo_key");
        let crop_id: Option<Uuid> = row.get("crop_id");
        pairs.push((geo_key, crop_id));
    }

    for row in request_rows {
        let geo_key: String = row.get("geo_key");
        let crop_id: Option<Uuid> = row.get("crop_id");
        pairs.push((geo_key, crop_id));
    }

    Ok(expand_geo_scopes(&pairs))
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

    let signal_payload_json = serde_json::to_string(&serde_json::json!({
        "listingCount": listing_count,
        "requestCount": request_count,
        "windowDays": window_days,
        "source": "derived_pipeline_replay"
    }))
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
    fn parse_ts_accepts_rfc3339() {
        let value = parse_ts("2026-02-28T12:00:00Z", "FROM_TS").unwrap();
        assert_eq!(value.to_rfc3339(), "2026-02-28T12:00:00+00:00");
    }

    #[test]
    fn geo_prefixes_use_expected_precisions() {
        assert_eq!(geo_prefixes("9q8yyk8"), vec!["9q8y", "9q8yy", "9q8yyk"]);
    }

    #[test]
    fn checkpoint_round_trip() {
        let tmp_file = std::env::temp_dir().join("derived-replay-checkpoint-test.json");
        let config = CliConfig {
            mode: ReplayMode::Replay,
            from: None,
            to: DateTime::parse_from_rfc3339("2026-02-28T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            checkpoint_file: Some(tmp_file.to_string_lossy().to_string()),
            dry_run: false,
        };

        write_checkpoint(tmp_file.to_str().unwrap(), &config).unwrap();
        let restored = read_checkpoint(tmp_file.to_str().unwrap())
            .unwrap()
            .unwrap();

        assert_eq!(restored, config.to);

        let _ = std::fs::remove_file(tmp_file);
    }
}
