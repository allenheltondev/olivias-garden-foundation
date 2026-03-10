use crate::badge_cabinet;
use crate::db;
use crate::gardener_tier;
use crate::location;
use crate::middleware::entitlements;
use crate::models::crop::ErrorResponse;
use crate::models::profile::{
    GrowerProfile, MeProfileResponse, PublicUserResponse, PutMeRequest, SeasonalTimelineEntry,
    SubscriptionMetadata, UserRatingSummary, UserType,
};
use crate::tips_framework::{
    assign_experience_level, recommend_curated_tips, season_from_month, ExperienceSignals,
};
use chrono::Datelike;
use lambda_http::{Body, Request, RequestExt, Response};
use serde::Serialize;
use tokio_postgres::Row;
use tracing::error;
use uuid::Uuid;

const KM_PER_MILE: f64 = 1.609_344;

pub async fn get_current_user(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request, correlation_id)?;
    let client = db::connect().await?;

    let user_row = client
        .query_opt(
            "select id, email::text as email, display_name, is_verified, user_type, onboarding_completed, tier, subscription_status, premium_expires_at, created_at from users where id = $1 and deleted_at is null",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(row) = user_row {
        return json_response(200, &to_me_response(&client, row).await?);
    }

    json_response(
        404,
        &ErrorResponse {
            error: "User profile not found".to_string(),
        },
    )
}

#[allow(clippy::too_many_lines)]
pub async fn upsert_current_user(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request, correlation_id)?;
    let auth_email = extract_authorizer_field(request, "email");
    let payload: PutMeRequest = parse_json_body(request)?;

    validate_put_me_payload(&payload)?;

    let client = db::connect().await?;
    let should_complete_onboarding = should_mark_onboarding_complete(&payload);

    let user_row = client
        .query_one(
            "
            insert into users (id, email, display_name, user_type, onboarding_completed)
            values ($1, $2, $3, $4, $5)
            on conflict (id) do update
            set email = coalesce(excluded.email, users.email),
                display_name = coalesce(excluded.display_name, users.display_name),
                user_type = coalesce(excluded.user_type, users.user_type),
                onboarding_completed = case
                    when excluded.onboarding_completed = true then true
                    else users.onboarding_completed
                end,
                updated_at = now()
            returning id, email::text as email, display_name, is_verified, user_type, onboarding_completed, tier, subscription_status, premium_expires_at, created_at
            ",
            &[
                &user_id,
                &auth_email,
                &payload.display_name,
                &payload.user_type.as_ref().map(|t| match t {
                    UserType::Grower => "grower",
                    UserType::Gatherer => "gatherer",
                }),
                &should_complete_onboarding,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let user_id_text = user_id.to_string();

    if let Some(grower_profile) = payload.grower_profile {
        let address = location::normalize_address(&grower_profile.address);
        let geocoded = location::geocode_address(&address, correlation_id).await?;
        let share_radius_km = miles_to_km(grower_profile.share_radius_miles);

        client
            .execute(
                "
                insert into grower_profiles
                    (user_id, home_zone, address, geo_key, lat, lng, share_radius_km, units, locale)
                values
                    ($1::uuid, $2, $3, $4, $5, $6, $7, coalesce($8::text::units_system, 'imperial'::units_system), $9)
                on conflict (user_id) do update
                set home_zone = excluded.home_zone,
                    address = excluded.address,
                    geo_key = excluded.geo_key,
                    lat = excluded.lat,
                    lng = excluded.lng,
                    share_radius_km = excluded.share_radius_km,
                    units = excluded.units,
                    locale = excluded.locale,
                    updated_at = now()
                ",
                &[
                    &user_id_text,
                    &grower_profile.home_zone,
                    &address,
                    &geocoded.geo_key,
                    &geocoded.lat,
                    &geocoded.lng,
                    &share_radius_km,
                    &grower_profile.units,
                    &grower_profile.locale,
                ],
            )
            .await
            .map_err(|error| db_error(&error))?;
    }

    if let Some(gatherer_profile) = payload.gatherer_profile {
        let address = location::normalize_address(&gatherer_profile.address);
        let geocoded = location::geocode_address(&address, correlation_id).await?;
        let search_radius_km = miles_to_km(gatherer_profile.search_radius_miles);

        client
            .execute(
                "
                insert into gatherer_profiles
                    (user_id, address, geo_key, lat, lng, search_radius_km, organization_affiliation, units, locale)
                values
                    ($1::uuid, $2, $3, $4, $5, $6, $7, coalesce($8::text::units_system, 'imperial'::units_system), $9)
                on conflict (user_id) do update
                set address = excluded.address,
                    geo_key = excluded.geo_key,
                    lat = excluded.lat,
                    lng = excluded.lng,
                    search_radius_km = excluded.search_radius_km,
                    organization_affiliation = excluded.organization_affiliation,
                    units = excluded.units,
                    locale = excluded.locale,
                    updated_at = now()
                ",
                &[
                    &user_id_text,
                    &address,
                    &geocoded.geo_key,
                    &geocoded.lat,
                    &geocoded.lng,
                    &search_radius_km,
                    &gatherer_profile.organization_affiliation,
                    &gatherer_profile.units,
                    &gatherer_profile.locale,
                ],
            )
            .await
            .map_err(|error| db_error(&error))?;
    }

    json_response(200, &to_me_response(&client, user_row).await?)
}

pub async fn get_current_entitlements(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request, correlation_id)?;
    let client = db::connect().await?;
    let snapshot = entitlements::get_entitlements_snapshot(&client, user_id).await?;
    json_response(200, &snapshot)
}

pub async fn get_public_user(user_id: &str) -> Result<Response<Body>, lambda_http::Error> {
    let user_uuid = parse_uuid(user_id, "user id")?;
    let client = db::connect().await?;

    let row = client
        .query_opt(
            "select id, display_name, created_at from users where id = $1 and deleted_at is null",
            &[&user_uuid],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if let Some(user_row) = row {
        let response = PublicUserResponse {
            id: user_row.get::<_, Uuid>("id").to_string(),
            display_name: user_row.get("display_name"),
            created_at: user_row
                .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
                .to_rfc3339(),
            grower_profile: load_grower_profile(&client, user_uuid).await?,
            rating_summary: load_rating_summary(&client, user_uuid).await?,
        };
        return json_response(200, &response);
    }

    json_response(
        404,
        &ErrorResponse {
            error: "User not found".to_string(),
        },
    )
}

fn extract_user_id(request: &Request, correlation_id: &str) -> Result<Uuid, lambda_http::Error> {
    let user_id = extract_authorizer_field(request, "userId").ok_or_else(|| {
        error!(
            correlation_id = correlation_id,
            "Missing userId in authorizer context"
        );
        lambda_http::Error::from("Missing userId in authorizer context".to_string())
    })?;

    parse_uuid(&user_id, "userId")
}

fn extract_authorizer_field(request: &Request, field_name: &str) -> Option<String> {
    request
        .request_context()
        .authorizer()
        .and_then(|auth| auth.fields.get(field_name))
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn validate_put_me_payload(payload: &PutMeRequest) -> Result<(), lambda_http::Error> {
    if payload.grower_profile.is_some() && payload.gatherer_profile.is_some() {
        return Err(lambda_http::Error::from(
            "Cannot provide both growerProfile and gathererProfile in the same request".to_string(),
        ));
    }

    if let Some(user_type) = &payload.user_type {
        match user_type {
            UserType::Grower => {
                if payload.gatherer_profile.is_some() {
                    return Err(lambda_http::Error::from(
                        "Cannot provide gathererProfile when userType is 'grower'".to_string(),
                    ));
                }
            }
            UserType::Gatherer => {
                if payload.grower_profile.is_some() {
                    return Err(lambda_http::Error::from(
                        "Cannot provide growerProfile when userType is 'gatherer'".to_string(),
                    ));
                }
            }
        }
    }

    if let Some(grower) = &payload.grower_profile {
        if grower.share_radius_miles <= 0.0 {
            return Err(lambda_http::Error::from(
                "shareRadiusMiles must be greater than 0".to_string(),
            ));
        }

        if grower.units != "imperial" && grower.units != "metric" {
            return Err(lambda_http::Error::from(
                "units must be one of: imperial, metric".to_string(),
            ));
        }

        if grower.home_zone.trim().is_empty() {
            return Err(lambda_http::Error::from(
                "homeZone cannot be empty".to_string(),
            ));
        }

        if grower.address.trim().is_empty() {
            return Err(lambda_http::Error::from("address is required".to_string()));
        }
    }

    if let Some(gatherer) = &payload.gatherer_profile {
        if gatherer.search_radius_miles <= 0.0 {
            return Err(lambda_http::Error::from(
                "searchRadiusMiles must be greater than 0".to_string(),
            ));
        }

        if gatherer.units != "imperial" && gatherer.units != "metric" {
            return Err(lambda_http::Error::from(
                "units must be one of: imperial, metric".to_string(),
            ));
        }

        if gatherer.address.trim().is_empty() {
            return Err(lambda_http::Error::from("address is required".to_string()));
        }
    }

    Ok(())
}

fn should_mark_onboarding_complete(payload: &PutMeRequest) -> bool {
    if let Some(user_type) = &payload.user_type {
        match user_type {
            UserType::Grower => {
                if let Some(grower) = &payload.grower_profile {
                    return !grower.home_zone.trim().is_empty()
                        && !grower.address.trim().is_empty()
                        && grower.share_radius_miles > 0.0;
                }
            }
            UserType::Gatherer => {
                if let Some(gatherer) = &payload.gatherer_profile {
                    return !gatherer.address.trim().is_empty()
                        && gatherer.search_radius_miles > 0.0;
                }
            }
        }
    }
    false
}

async fn to_me_response(
    client: &tokio_postgres::Client,
    user_row: Row,
) -> Result<MeProfileResponse, lambda_http::Error> {
    let user_id = user_row.get::<_, Uuid>("id");

    let user_type = user_row
        .get::<_, Option<String>>("user_type")
        .and_then(|s| match s.as_str() {
            "grower" => Some(crate::models::profile::UserType::Grower),
            "gatherer" => Some(crate::models::profile::UserType::Gatherer),
            _ => None,
        });

    let badge_cabinet = badge_cabinet::load_and_sync_badges(client, user_id).await?;

    let experience_signals = match load_experience_signals(client, user_id).await {
        Ok(signals) => signals,
        Err(error) => {
            error!(
                user_id = %user_id,
                reason = %error,
                "Failed to load experience signals; using safe defaults"
            );
            ExperienceSignals::default()
        }
    };

    let experience_level = assign_experience_level(&experience_signals);

    if let Err(error) =
        persist_experience_level(client, user_id, experience_level, &experience_signals).await
    {
        error!(
            user_id = %user_id,
            reason = %error,
            "Failed to persist experience level; continuing without blocking /me response"
        );
    }

    let grower_profile = load_grower_profile(client, user_id).await?;

    let now = chrono::Utc::now();
    let season = season_from_month(now.month());
    let zone = grower_profile
        .as_ref()
        .and_then(|profile| profile.home_zone.as_deref())
        .unwrap_or("any");

    let curated_tips = recommend_curated_tips(experience_level, season, zone, &[], 6);

    let seasonal_timeline = badge_cabinet
        .iter()
        .filter_map(|entry| {
            entry
                .badge_key
                .strip_prefix("gardener_season_")
                .and_then(|level| level.parse::<i32>().ok())
                .map(|level| SeasonalTimelineEntry {
                    badge_key: entry.badge_key.clone(),
                    level,
                    earned_at: entry.earned_at.clone(),
                })
        })
        .collect();

    Ok(MeProfileResponse {
        id: user_id.to_string(),
        email: user_row.get("email"),
        display_name: user_row.get("display_name"),
        is_verified: user_row.get("is_verified"),
        user_type,
        onboarding_completed: user_row.get("onboarding_completed"),
        created_at: user_row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
        subscription: SubscriptionMetadata {
            tier: user_row.get("tier"),
            subscription_status: user_row.get("subscription_status"),
            premium_expires_at: user_row
                .get::<_, Option<chrono::DateTime<chrono::Utc>>>("premium_expires_at")
                .map(|v| v.to_rfc3339()),
        },
        gardener_tier: gardener_tier::evaluate_and_record(client, user_id).await?,
        badge_cabinet,
        seasonal_timeline,
        experience_level,
        experience_signals,
        curated_tips,
        grower_profile,
        gatherer_profile: load_gatherer_profile(client, user_id).await?,
        rating_summary: load_rating_summary(client, user_id).await?,
    })
}

async fn load_grower_profile(
    client: &tokio_postgres::Client,
    user_id: Uuid,
) -> Result<Option<GrowerProfile>, lambda_http::Error> {
    let row = client
        .query_opt(
            "select home_zone, address, geo_key, lat, lng, share_radius_km::text as share_radius_km, units::text as units, locale from grower_profiles where user_id = $1",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    Ok(row.map(|grower| GrowerProfile {
        home_zone: grower.get("home_zone"),
        address: grower.get("address"),
        geo_key: grower.get("geo_key"),
        lat: grower
            .get::<_, Option<f64>>("lat")
            .map(location::round_for_response),
        lng: grower
            .get::<_, Option<f64>>("lng")
            .map(location::round_for_response),
        share_radius_miles: km_text_to_miles_text(&grower.get::<_, String>("share_radius_km")),
        units: grower.get("units"),
        locale: grower.get("locale"),
    }))
}

async fn load_gatherer_profile(
    client: &tokio_postgres::Client,
    user_id: Uuid,
) -> Result<Option<crate::models::profile::GathererProfile>, lambda_http::Error> {
    let row = client
        .query_opt(
            "select coalesce(address, '') as address, geo_key, lat, lng, search_radius_km::text as search_radius_km, organization_affiliation, units::text as units, locale from gatherer_profiles where user_id = $1",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    Ok(row.map(|gatherer| crate::models::profile::GathererProfile {
        address: gatherer.get("address"),
        geo_key: gatherer.get("geo_key"),
        lat: location::round_for_response(gatherer.get("lat")),
        lng: location::round_for_response(gatherer.get("lng")),
        search_radius_miles: km_text_to_miles_text(&gatherer.get::<_, String>("search_radius_km")),
        organization_affiliation: gatherer.get("organization_affiliation"),
        units: gatherer.get("units"),
        locale: gatherer.get("locale"),
    }))
}

async fn load_rating_summary(
    client: &tokio_postgres::Client,
    user_id: Uuid,
) -> Result<Option<UserRatingSummary>, lambda_http::Error> {
    let row = client
        .query_opt(
            "select avg_score::text as avg_score, rating_count from user_rating_summary where user_id = $1",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    Ok(row.map(|rating| UserRatingSummary {
        avg_score: rating.get("avg_score"),
        rating_count: rating.get("rating_count"),
    }))
}

async fn load_experience_signals(
    client: &tokio_postgres::Client,
    user_id: Uuid,
) -> Result<ExperienceSignals, lambda_http::Error> {
    let row = client
        .query_one(
            "
            with activity_events as (
              select created_at as activity_at from grower_crop_library where user_id = $1
              union all
              select updated_at as activity_at from grower_crop_library where user_id = $1
              union all
              select created_at as activity_at from surplus_listings where user_id = $1 and deleted_at is null
              union all
              select claimed_at as activity_at from claims where claimer_id = $1
              union all
              select confirmed_at as activity_at from claims where claimer_id = $1 and confirmed_at is not null
              union all
              select completed_at as activity_at from claims where claimer_id = $1 and completed_at is not null
            )
            select
              (select count(*)::bigint from claims where claimer_id = $1 and status = 'completed') as completed_grows,
              (select count(*)::bigint from claims where claimer_id = $1 and status = 'completed') as successful_harvests,
              (
                select count(distinct date_trunc('day', activity_at))::bigint
                from activity_events
                where activity_at >= now() - interval '90 days'
              ) as active_days_last_90,
              (
                select count(distinct (award_snapshot->>'seasonYear'))::bigint
                from badge_award_audit
                where user_id = $1
                  and badge_key like 'gardener_season_%'
                  and award_snapshot->>'seasonYear' is not null
              ) as seasonal_consistency,
              (
                select count(distinct crop_id)::bigint
                from grower_crop_library
                where user_id = $1
              ) as variety_breadth,
              (
                select count(*)::bigint
                from badge_evidence_submissions
                where user_id = $1 and status = 'auto_approved'
              ) as badge_credibility
            ",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let to_u32 = |column: &str| u32::try_from(row.get::<_, i64>(column).max(0)).unwrap_or(u32::MAX);

    Ok(ExperienceSignals {
        completed_grows: to_u32("completed_grows"),
        successful_harvests: to_u32("successful_harvests"),
        active_days_last_90: to_u32("active_days_last_90"),
        seasonal_consistency: to_u32("seasonal_consistency"),
        variety_breadth: to_u32("variety_breadth"),
        badge_credibility: to_u32("badge_credibility"),
    })
}

async fn persist_experience_level(
    client: &tokio_postgres::Client,
    user_id: Uuid,
    experience_level: crate::tips_framework::ExperienceLevel,
    experience_signals: &ExperienceSignals,
) -> Result<(), lambda_http::Error> {
    let current_row = client
        .query_opt(
            "select experience_level::text as experience_level, signals from user_experience_levels where user_id = $1",
            &[&user_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let level_text = serde_json::to_string(&experience_level)
        .map_err(|error| {
            lambda_http::Error::from(format!("Failed to serialize experience level: {error}"))
        })?
        .trim_matches('"')
        .to_string();
    let new_signals = serde_json::to_string(experience_signals).map_err(|error| {
        lambda_http::Error::from(format!("Failed to serialize experience signals: {error}"))
    })?;

    let previous_level = current_row
        .as_ref()
        .and_then(|row| row.get::<_, Option<String>>("experience_level"));
    let previous_signals = current_row
        .as_ref()
        .and_then(|row| row.get::<_, Option<String>>("signals"));

    client
        .execute(
            "
            insert into user_experience_levels (user_id, experience_level, signals, computed_at, updated_at)
            values ($1, $2, $3::jsonb, now(), now())
            on conflict (user_id) do update
              set experience_level = excluded.experience_level,
                  signals = excluded.signals,
                  computed_at = excluded.computed_at,
                  updated_at = now()
            ",
            &[&user_id, &level_text, &new_signals],
        )
        .await
        .map_err(|error| db_error(&error))?;

    if previous_level.as_deref() != Some(level_text.as_str())
        || previous_signals.as_ref() != Some(&new_signals)
    {
        client
            .execute(
                "
                insert into user_experience_level_audit (
                  user_id,
                  previous_level,
                  new_level,
                  previous_signals,
                  new_signals,
                  transition_reason,
                  changed_at
                )
                values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, now())
                ",
                &[
                    &user_id,
                    &previous_level,
                    &level_text,
                    &previous_signals,
                    &new_signals,
                    &"refresh_me_profile",
                ],
            )
            .await
            .map_err(|error| db_error(&error))?;
    }

    Ok(())
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    let normalized = value.trim();
    Uuid::parse_str(normalized)
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
}

fn miles_to_km(miles: f64) -> f64 {
    miles * KM_PER_MILE
}

fn km_to_miles(km: f64) -> f64 {
    km / KM_PER_MILE
}

fn normalize_radius_text(value: f64) -> String {
    let mut text = format!("{value:.6}");
    while text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    if !text.contains('.') {
        text.push_str(".0");
    }
    text
}

fn km_text_to_miles_text(km_text: &str) -> String {
    km_text
        .parse::<f64>()
        .map(km_to_miles)
        .map_or_else(|_| km_text.to_string(), normalize_radius_text)
}

fn parse_json_body<T: serde::de::DeserializeOwned>(
    request: &Request,
) -> Result<T, lambda_http::Error> {
    match request.body() {
        Body::Text(text) => serde_json::from_str::<T>(text)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Binary(bytes) => serde_json::from_slice::<T>(bytes)
            .map_err(|e| lambda_http::Error::from(format!("Invalid JSON body: {e}"))),
        Body::Empty => Err(lambda_http::Error::from(
            "Request body is required".to_string(),
        )),
    }
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    if let Some(db_error) = error.as_db_error() {
        let detail = db_error.detail().unwrap_or("none");
        return lambda_http::Error::from(format!(
            "Database query error: {} (detail: {})",
            db_error.message(),
            detail
        ));
    }

    lambda_http::Error::from(format!("Database query error: {error}"))
}

fn json_response<T: Serialize>(
    status: u16,
    payload: &T,
) -> Result<Response<Body>, lambda_http::Error> {
    let body = serde_json::to_string(payload)
        .map_err(|e| lambda_http::Error::from(format!("Failed to serialize response: {e}")))?;

    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Body::from(body))
        .map_err(|e| lambda_http::Error::from(e.to_string()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::models::profile::{GathererProfileInput, GrowerProfileInput};

    #[test]
    fn test_validate_both_profiles_rejected() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Grower),
            grower_profile: Some(GrowerProfileInput {
                home_zone: "8a".to_string(),
                address: "123 Main St".to_string(),
                share_radius_miles: 5.0,
                units: "imperial".to_string(),
                locale: "en-US".to_string(),
            }),
            gatherer_profile: Some(GathererProfileInput {
                address: "456 Oak Ave".to_string(),
                search_radius_miles: 10.0,
                organization_affiliation: None,
                units: "metric".to_string(),
                locale: "en-US".to_string(),
            }),
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Cannot provide both"));
    }

    #[test]
    fn test_validate_profile_mismatch_grower() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Grower),
            grower_profile: None,
            gatherer_profile: Some(GathererProfileInput {
                address: "456 Oak Ave".to_string(),
                search_radius_miles: 10.0,
                organization_affiliation: None,
                units: "metric".to_string(),
                locale: "en-US".to_string(),
            }),
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Cannot provide gathererProfile when userType is 'grower'"));
    }

    #[test]
    fn test_validate_grower_missing_address() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Grower),
            grower_profile: Some(GrowerProfileInput {
                home_zone: "8a".to_string(),
                address: "   ".to_string(),
                share_radius_miles: 5.0,
                units: "imperial".to_string(),
                locale: "en-US".to_string(),
            }),
            gatherer_profile: None,
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("address is required"));
    }

    #[test]
    fn test_validate_gatherer_missing_address() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Gatherer),
            grower_profile: None,
            gatherer_profile: Some(GathererProfileInput {
                address: String::new(),
                search_radius_miles: 10.0,
                organization_affiliation: None,
                units: "metric".to_string(),
                locale: "en-US".to_string(),
            }),
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("address is required"));
    }

    #[test]
    fn test_validate_valid_grower_profile() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Grower),
            grower_profile: Some(GrowerProfileInput {
                home_zone: "8a".to_string(),
                address: "123 Main St".to_string(),
                share_radius_miles: 5.0,
                units: "imperial".to_string(),
                locale: "en-US".to_string(),
            }),
            gatherer_profile: None,
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_valid_gatherer_profile() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Gatherer),
            grower_profile: None,
            gatherer_profile: Some(GathererProfileInput {
                address: "456 Oak Ave".to_string(),
                search_radius_miles: 10.0,
                organization_affiliation: Some("SF Food Bank".to_string()),
                units: "metric".to_string(),
                locale: "en-US".to_string(),
            }),
        };

        let result = validate_put_me_payload(&payload);
        assert!(result.is_ok());
    }

    #[test]
    fn test_should_mark_onboarding_complete_grower() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Grower),
            grower_profile: Some(GrowerProfileInput {
                home_zone: "8a".to_string(),
                address: "123 Main St".to_string(),
                share_radius_miles: 5.0,
                units: "imperial".to_string(),
                locale: "en-US".to_string(),
            }),
            gatherer_profile: None,
        };

        assert!(should_mark_onboarding_complete(&payload));
    }

    #[test]
    fn test_should_mark_onboarding_complete_gatherer() {
        let payload = PutMeRequest {
            display_name: Some("Test User".to_string()),
            user_type: Some(UserType::Gatherer),
            grower_profile: None,
            gatherer_profile: Some(GathererProfileInput {
                address: "456 Oak Ave".to_string(),
                search_radius_miles: 10.0,
                organization_affiliation: None,
                units: "metric".to_string(),
                locale: "en-US".to_string(),
            }),
        };

        assert!(should_mark_onboarding_complete(&payload));
    }
}
