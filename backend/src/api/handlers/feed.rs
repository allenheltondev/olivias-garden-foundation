use crate::ai::{SummaryArtifact, SummaryGenerator};
use crate::auth::extract_auth_context;
use crate::db;
use crate::location;
use crate::middleware::{ai_guardrails, entitlements};
use crate::models::feed::{
    DerivedFeedAiSummary, DerivedFeedFreshness, DerivedFeedResponse, DerivedFeedSignal,
    GrowerGuidance, GrowerGuidanceExplanation, GrowerGuidanceSignalRef,
};
use crate::models::listing::ListingItem;
use chrono::{DateTime, Datelike, Utc};
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use tokio_postgres::Row;
use tracing::info;
use uuid::Uuid;

const DEFAULT_WINDOW_DAYS: i32 = 7;
const SUPPORTED_WINDOWS_DAYS: [i32; 3] = [7, 14, 30];

#[derive(Debug)]
struct DerivedFeedQuery {
    geo_key: String,
    window_days: i32,
    limit: i64,
    offset: i64,
}

#[allow(clippy::too_many_lines)]
pub async fn get_derived_feed(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context(request)?;
    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let query = parse_derived_feed_query(request.uri().query())?;
    let geo_prefix = derive_geo_prefix(&query.geo_key);
    let geo_pattern = format!("{geo_prefix}%");
    let fetch_limit = query.limit + 1;
    let as_of = Utc::now();

    let client = db::connect().await?;

    let listing_rows = client
        .query(
            "
            select id, user_id, grower_crop_id, crop_id, variety_id, title, unit,
                   quantity_total::text as quantity_total,
                   quantity_remaining::text as quantity_remaining,
                   available_start, available_end, status::text,
                   pickup_location_text, pickup_address, effective_pickup_address,
                   pickup_disclosure_policy::text as pickup_disclosure_policy,
                   pickup_notes, contact_pref::text as contact_pref,
                   geo_key, lat, lng, created_at
            from surplus_listings
            where deleted_at is null
              and status = 'active'
              and geo_key is not null
              and geo_key like $1
            order by created_at desc, id desc
            limit $2 offset $3
            ",
            &[&geo_pattern, &fetch_limit, &query.offset],
        )
        .await
        .map_err(db_error)?;

    let limit = usize::try_from(query.limit)
        .map_err(|_| lambda_http::Error::from("Invalid limit. Must be between 1 and 100"))?;
    let has_more = listing_rows.len() > limit;
    let items = listing_rows
        .into_iter()
        .take(limit)
        .map(|row| row_to_listing_item(&row))
        .collect::<Vec<_>>();

    let fresh_rows = client
        .query(
            "
            select
              geo_boundary_key,
              crop_id,
              window_days::int as window_days,
              listing_count,
              request_count,
              supply_quantity::text as supply_quantity,
              demand_quantity::text as demand_quantity,
              scarcity_score::float8 as scarcity_score,
              abundance_score::float8 as abundance_score,
              computed_at,
              expires_at
            from list_latest_derived_supply_signals($1, $2, 1, 50, $3)
            order by scarcity_score desc, abundance_score desc, geo_boundary_key asc
            ",
            &[&geo_prefix, &query.window_days, &as_of],
        )
        .await
        .map_err(db_error)?;

    let (signal_rows, freshness) = if fresh_rows.is_empty() {
        let fallback_rows = client
            .query(
                "
                select distinct on (geo_boundary_key, crop_scope_id)
                  geo_boundary_key,
                  crop_id,
                  window_days::int as window_days,
                  listing_count,
                  request_count,
                  supply_quantity::text as supply_quantity,
                  demand_quantity::text as demand_quantity,
                  scarcity_score::float8 as scarcity_score,
                  abundance_score::float8 as abundance_score,
                  computed_at,
                  expires_at
                from derived_supply_signals
                where schema_version = 1
                  and window_days = $2
                  and geo_boundary_key like $1
                order by geo_boundary_key, crop_scope_id, computed_at desc, id desc
                limit 50
                ",
                &[&geo_pattern, &query.window_days],
            )
            .await
            .map_err(db_error)?;

        (
            fallback_rows,
            DerivedFeedFreshness {
                as_of: as_of.to_rfc3339(),
                is_stale: true,
                stale_fallback_used: true,
                stale_reason: Some(
                    "No non-expired derived signals available for requested scope".to_string(),
                ),
            },
        )
    } else {
        (
            fresh_rows,
            DerivedFeedFreshness {
                as_of: as_of.to_rfc3339(),
                is_stale: false,
                stale_fallback_used: false,
                stale_reason: None,
            },
        )
    };

    let signals = signal_rows
        .into_iter()
        .map(|row| row_to_signal(&row))
        .collect::<Vec<_>>();

    let grower_guidance = build_deterministic_grower_guidance(&signals, query.window_days, as_of);

    let ai_summary = if entitlements::require_entitlement(&client, user_id, "ai.feed_insights.read")
        .await
        .is_ok()
    {
        let model_id = std::env::var("BEDROCK_MODEL_PRIMARY")
            .or_else(|_| std::env::var("BEDROCK_MODEL_ID"))
            .unwrap_or_else(|_| "amazon.nova-lite-v1:0".to_string());

        let guardrails =
            ai_guardrails::enforce_and_record(&client, user_id, "ai.feed_insights.read", &model_id)
                .await
                .ok();

        if matches!(guardrails.as_ref().map(|g| g.allowed), Some(false)) {
            None
        } else {
            load_or_generate_ai_summary(&client, &geo_prefix, query.window_days, &signals)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!(error = %error, "AI summary generation failed; degrading gracefully");
                    None
                })
        }
    } else {
        None
    };

    let response = DerivedFeedResponse {
        items,
        signals,
        freshness,
        ai_summary,
        grower_guidance,
        limit: query.limit,
        offset: query.offset,
        has_more,
        next_offset: if has_more {
            Some(query.offset + query.limit)
        } else {
            None
        },
    };

    info!(
        correlation_id = correlation_id,
        user_id = auth_context.user_id.as_str(),
        geo_key = query.geo_key,
        geo_prefix = geo_prefix,
        window_days = query.window_days,
        listing_count = response.items.len(),
        signal_count = response.signals.len(),
        feed_stale = response.freshness.is_stale,
        "Returned derived feed response"
    );

    json_response(200, &response)
}

fn parse_derived_feed_query(query: Option<&str>) -> Result<DerivedFeedQuery, lambda_http::Error> {
    let mut geo_key: Option<String> = None;
    let mut window_days = DEFAULT_WINDOW_DAYS;
    let mut limit: i64 = 20;
    let mut offset: i64 = 0;

    if let Some(raw_query) = query {
        for pair in raw_query.split('&') {
            if pair.is_empty() {
                continue;
            }

            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key {
                "geoKey" => {
                    let normalized = value.trim().to_ascii_lowercase();
                    if normalized.is_empty() {
                        return Err(lambda_http::Error::from("geoKey is required"));
                    }
                    if !is_valid_geo_key(&normalized) {
                        return Err(lambda_http::Error::from(
                            "geoKey must be a valid geohash (1-12 chars, base32)",
                        ));
                    }
                    geo_key = Some(normalized);
                }
                "windowDays" => {
                    let parsed = value.parse::<i32>().map_err(|_| {
                        lambda_http::Error::from("windowDays must be one of: 7, 14, 30")
                    })?;
                    if !SUPPORTED_WINDOWS_DAYS.contains(&parsed) {
                        return Err(lambda_http::Error::from(
                            "windowDays must be one of: 7, 14, 30",
                        ));
                    }
                    window_days = parsed;
                }
                "limit" => {
                    limit = value.parse::<i64>().map_err(|_| {
                        lambda_http::Error::from("Invalid limit. Must be an integer")
                    })?;
                    if !(1..=100).contains(&limit) {
                        return Err(lambda_http::Error::from(
                            "Invalid limit. Must be between 1 and 100",
                        ));
                    }
                }
                "offset" => {
                    offset = value.parse::<i64>().map_err(|_| {
                        lambda_http::Error::from("Invalid offset. Must be an integer")
                    })?;
                    if offset < 0 {
                        return Err(lambda_http::Error::from(
                            "Invalid offset. Must be greater than or equal to 0",
                        ));
                    }
                }
                _ => {}
            }
        }
    }

    let geo_key = geo_key.ok_or_else(|| lambda_http::Error::from("geoKey is required"))?;

    Ok(DerivedFeedQuery {
        geo_key,
        window_days,
        limit,
        offset,
    })
}

fn derive_geo_prefix(geo_key: &str) -> String {
    let prefix_len = 4.min(geo_key.len());
    geo_key[..prefix_len].to_string()
}

fn is_valid_geo_key(value: &str) -> bool {
    if value.is_empty() || value.len() > 12 {
        return false;
    }

    value
        .chars()
        .all(|ch| matches!(ch, '0'..='9' | 'b'..='h' | 'j'..='k' | 'm'..='n' | 'p'..='z'))
}

fn row_to_listing_item(row: &Row) -> ListingItem {
    ListingItem {
        id: row.get::<_, Uuid>("id").to_string(),
        user_id: row.get::<_, Uuid>("user_id").to_string(),
        grower_crop_id: row
            .get::<_, Option<Uuid>>("grower_crop_id")
            .map(|id| id.to_string()),
        crop_id: row.get::<_, Uuid>("crop_id").to_string(),
        variety_id: row
            .get::<_, Option<Uuid>>("variety_id")
            .map(|id| id.to_string()),
        title: row.get("title"),
        unit: row.get("unit"),
        quantity_total: row.get("quantity_total"),
        quantity_remaining: row.get("quantity_remaining"),
        available_start: row
            .get::<_, Option<DateTime<Utc>>>("available_start")
            .map(|value| value.to_rfc3339()),
        available_end: row
            .get::<_, Option<DateTime<Utc>>>("available_end")
            .map(|value| value.to_rfc3339()),
        status: row.get("status"),
        pickup_location_text: row.get("pickup_location_text"),
        pickup_address: row.get("pickup_address"),
        effective_pickup_address: row.get("effective_pickup_address"),
        pickup_disclosure_policy: row.get("pickup_disclosure_policy"),
        pickup_notes: row.get("pickup_notes"),
        contact_pref: row.get("contact_pref"),
        geo_key: row.get("geo_key"),
        lat: row
            .get::<_, Option<f64>>("lat")
            .map(location::round_for_response),
        lng: row
            .get::<_, Option<f64>>("lng")
            .map(location::round_for_response),
        created_at: row.get::<_, DateTime<Utc>>("created_at").to_rfc3339(),
    }
}

fn row_to_signal(row: &Row) -> DerivedFeedSignal {
    DerivedFeedSignal {
        geo_boundary_key: row.get("geo_boundary_key"),
        crop_id: row
            .get::<_, Option<Uuid>>("crop_id")
            .map(|id| id.to_string()),
        window_days: row.get("window_days"),
        listing_count: row.get("listing_count"),
        request_count: row.get("request_count"),
        supply_quantity: row.get("supply_quantity"),
        demand_quantity: row.get("demand_quantity"),
        scarcity_score: row.get("scarcity_score"),
        abundance_score: row.get("abundance_score"),
        computed_at: row.get::<_, DateTime<Utc>>("computed_at").to_rfc3339(),
        expires_at: row.get::<_, DateTime<Utc>>("expires_at").to_rfc3339(),
    }
}

fn build_deterministic_grower_guidance(
    signals: &[DerivedFeedSignal],
    window_days: i32,
    as_of: DateTime<Utc>,
) -> Option<GrowerGuidance> {
    if signals.is_empty() {
        return None;
    }

    let season = season_from_month(as_of.month());
    let signal_count = count_as_f64(signals.len());
    let avg_scarcity = signals
        .iter()
        .map(|signal| signal.scarcity_score)
        .sum::<f64>()
        / signal_count;
    let avg_abundance = signals
        .iter()
        .map(|signal| signal.abundance_score)
        .sum::<f64>()
        / signal_count;

    let strategy = if avg_scarcity >= avg_abundance {
        "increase-resilience"
    } else {
        "share-surplus"
    };

    let strongest_scarcity_signal = strongest_signal_by(signals, |left, right| {
        left.scarcity_score.total_cmp(&right.scarcity_score)
    })
    .map(to_signal_ref);

    let strongest_abundance_signal = strongest_signal_by(signals, |left, right| {
        left.abundance_score.total_cmp(&right.abundance_score)
    })
    .map(to_signal_ref);

    let guidance_text = match strategy {
        "increase-resilience" => format!(
            "{} guidance: local demand signals are outpacing supply. Prioritize dependable {} plantings and staggered harvest windows to reduce scarcity pressure over the next {} days.",
            capitalize_first(season),
            season,
            window_days
        ),
        _ => format!(
            "{} guidance: local supply signals are stronger than demand. Plan shared pickups and preserve {} surplus so abundance can be redistributed effectively over the next {} days.",
            capitalize_first(season),
            season,
            window_days
        ),
    };

    Some(GrowerGuidance {
        guidance_text,
        explanation: GrowerGuidanceExplanation {
            season: season.to_string(),
            strategy: strategy.to_string(),
            window_days,
            source_signal_count: signals.len(),
            strongest_scarcity_signal,
            strongest_abundance_signal,
        },
    })
}

fn count_as_f64(count: usize) -> f64 {
    u32::try_from(count).map_or_else(|_| f64::from(u32::MAX), f64::from)
}

fn strongest_signal_by<F>(signals: &[DerivedFeedSignal], cmp: F) -> Option<&DerivedFeedSignal>
where
    F: Fn(&DerivedFeedSignal, &DerivedFeedSignal) -> std::cmp::Ordering,
{
    signals.iter().max_by(|left, right| {
        let primary = cmp(left, right);
        if primary != std::cmp::Ordering::Equal {
            return primary;
        }

        let geo_order = left.geo_boundary_key.cmp(&right.geo_boundary_key).reverse();
        if geo_order != std::cmp::Ordering::Equal {
            return geo_order;
        }

        left.crop_id.cmp(&right.crop_id).reverse()
    })
}

fn to_signal_ref(signal: &DerivedFeedSignal) -> GrowerGuidanceSignalRef {
    GrowerGuidanceSignalRef {
        geo_boundary_key: signal.geo_boundary_key.clone(),
        crop_id: signal.crop_id.clone(),
        scarcity_score: signal.scarcity_score,
        abundance_score: signal.abundance_score,
        listing_count: signal.listing_count,
        request_count: signal.request_count,
    }
}

const fn season_from_month(month: u32) -> &'static str {
    match month {
        3..=5 => "spring",
        6..=8 => "summer",
        9..=11 => "fall",
        _ => "winter",
    }
}

fn capitalize_first(value: &str) -> String {
    let mut chars = value.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().collect::<String>() + chars.as_str()
    })
}

async fn load_or_generate_ai_summary(
    client: &tokio_postgres::Client,
    geo_prefix: &str,
    window_days: i32,
    signals: &[DerivedFeedSignal],
) -> Result<Option<DerivedFeedAiSummary>, lambda_http::Error> {
    if signals.is_empty() {
        return Ok(None);
    }

    let now = Utc::now();
    let cached_row = client
        .query_opt(
            "
            select summary_text, model_id, model_version, generated_at, expires_at
            from derived_signal_summaries
            where schema_version = 1
              and geo_boundary_key = $1
              and window_days = $2
              and expires_at > $3
            order by generated_at desc, id desc
            limit 1
            ",
            &[&geo_prefix, &window_days, &now],
        )
        .await
        .map_err(db_error)?;

    if let Some(row) = cached_row {
        return Ok(Some(DerivedFeedAiSummary {
            summary_text: row.get("summary_text"),
            model_id: row.get("model_id"),
            model_version: row.get("model_version"),
            generated_at: row.get::<_, DateTime<Utc>>("generated_at").to_rfc3339(),
            expires_at: row.get::<_, DateTime<Utc>>("expires_at").to_rfc3339(),
            from_cache: true,
        }));
    }

    let generator = SummaryGenerator::from_env();
    let artifact = generator.generate(geo_prefix, window_days, signals)?;
    persist_ai_summary(client, geo_prefix, window_days, signals, &artifact).await?;

    Ok(Some(DerivedFeedAiSummary {
        summary_text: artifact.summary_text,
        model_id: artifact.model_id,
        model_version: artifact.model_version,
        generated_at: artifact.generated_at.to_rfc3339(),
        expires_at: artifact.expires_at.to_rfc3339(),
        from_cache: false,
    }))
}

async fn persist_ai_summary(
    client: &tokio_postgres::Client,
    geo_prefix: &str,
    window_days: i32,
    signals: &[DerivedFeedSignal],
    artifact: &SummaryArtifact,
) -> Result<(), lambda_http::Error> {
    let snapshot = serde_json::to_string(signals).map_err(|error| {
        lambda_http::Error::from(format!("Failed to serialize signal snapshot: {error}"))
    })?;

    client
        .execute(
            "
            insert into derived_signal_summaries (
              schema_version,
              geo_boundary_key,
              window_days,
              summary_text,
              model_id,
              model_version,
              signal_snapshot,
              generated_at,
              expires_at,
              created_at,
              updated_at
            )
            values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, now(), now())
            on conflict (schema_version, geo_boundary_key, window_days)
            do update
              set summary_text = excluded.summary_text,
                  model_id = excluded.model_id,
                  model_version = excluded.model_version,
                  signal_snapshot = excluded.signal_snapshot,
                  generated_at = excluded.generated_at,
                  expires_at = excluded.expires_at,
                  updated_at = now()
            ",
            &[
                &1,
                &geo_prefix,
                &window_days,
                &artifact.summary_text,
                &artifact.model_id,
                &artifact.model_version,
                &snapshot,
                &artifact.generated_at,
                &artifact.expires_at,
            ],
        )
        .await
        .map_err(db_error)?;

    Ok(())
}

#[allow(clippy::needless_pass_by_value)]
fn db_error(error: tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> Result<Response<Body>, lambda_http::Error> {
    let body = serde_json::to_string(payload).map_err(|error| {
        lambda_http::Error::from(format!("Failed to serialize response: {error}"))
    })?;

    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|error| lambda_http::Error::from(error.to_string()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_derived_feed_query_defaults() {
        let parsed = parse_derived_feed_query(Some("geoKey=9q8yyk8")).unwrap();
        assert_eq!(parsed.geo_key, "9q8yyk8");
        assert_eq!(parsed.window_days, 7);
        assert_eq!(parsed.limit, 20);
        assert_eq!(parsed.offset, 0);
    }

    #[test]
    fn parse_derived_feed_query_accepts_supported_window() {
        let parsed = parse_derived_feed_query(Some("geoKey=9q8yyk8&windowDays=14")).unwrap();
        assert_eq!(parsed.window_days, 14);
    }

    #[test]
    fn parse_derived_feed_query_rejects_unsupported_window() {
        let result = parse_derived_feed_query(Some("geoKey=9q8yyk8&windowDays=9"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("windowDays must be one of: 7, 14, 30"));
    }

    #[test]
    fn parse_derived_feed_query_requires_geo_key() {
        let result = parse_derived_feed_query(Some("windowDays=7"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("geoKey is required"));
    }

    #[test]
    fn derive_geo_prefix_uses_4_char_scope() {
        assert_eq!(derive_geo_prefix("9q8yyk8"), "9q8y");
        assert_eq!(derive_geo_prefix("9q8"), "9q8");
    }

    #[test]
    fn deterministic_grower_guidance_prefers_scarcity_strategy() {
        let signals = vec![
            DerivedFeedSignal {
                geo_boundary_key: "9q8y".to_string(),
                crop_id: None,
                window_days: 7,
                listing_count: 4,
                request_count: 9,
                supply_quantity: "12".to_string(),
                demand_quantity: "25".to_string(),
                scarcity_score: 0.91,
                abundance_score: 0.22,
                computed_at: "2026-02-21T00:00:00Z".to_string(),
                expires_at: "2026-02-22T00:00:00Z".to_string(),
            },
            DerivedFeedSignal {
                geo_boundary_key: "9q8y".to_string(),
                crop_id: Some("11111111-1111-1111-1111-111111111111".to_string()),
                window_days: 7,
                listing_count: 5,
                request_count: 8,
                supply_quantity: "20".to_string(),
                demand_quantity: "26".to_string(),
                scarcity_score: 0.61,
                abundance_score: 0.39,
                computed_at: "2026-02-21T00:00:00Z".to_string(),
                expires_at: "2026-02-22T00:00:00Z".to_string(),
            },
        ];

        let guidance = build_deterministic_grower_guidance(
            &signals,
            7,
            DateTime::parse_from_rfc3339("2026-02-21T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .unwrap();

        assert_eq!(guidance.explanation.strategy, "increase-resilience");
        assert_eq!(guidance.explanation.season, "winter");
        assert_eq!(guidance.explanation.source_signal_count, 2);
        let scarcity_score = guidance
            .explanation
            .strongest_scarcity_signal
            .unwrap()
            .scarcity_score;
        assert!((scarcity_score - 0.91).abs() < f64::EPSILON);
    }

    #[test]
    fn deterministic_grower_guidance_prefers_abundance_strategy() {
        let signals = vec![DerivedFeedSignal {
            geo_boundary_key: "9q8y".to_string(),
            crop_id: None,
            window_days: 14,
            listing_count: 12,
            request_count: 3,
            supply_quantity: "54".to_string(),
            demand_quantity: "11".to_string(),
            scarcity_score: 0.20,
            abundance_score: 0.84,
            computed_at: "2026-07-01T00:00:00Z".to_string(),
            expires_at: "2026-07-02T00:00:00Z".to_string(),
        }];

        let guidance = build_deterministic_grower_guidance(
            &signals,
            14,
            DateTime::parse_from_rfc3339("2026-07-01T12:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
        .unwrap();

        assert_eq!(guidance.explanation.strategy, "share-surplus");
        assert_eq!(guidance.explanation.season, "summer");
        assert!(guidance.guidance_text.contains("Summer guidance"));
    }
}
