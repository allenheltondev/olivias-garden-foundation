use serde::Serialize;
use tokio_postgres::Client;
use uuid::Uuid;

#[allow(dead_code)]
const SHARING_OUTCOMES_WEIGHT: i32 = 20;
#[allow(dead_code)]
const PHOTO_TRUST_WEIGHT: i32 = 15;
#[allow(dead_code)]
const RELIABILITY_WEIGHT: i32 = 15;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum GardenerTier {
    Novice,
    Intermediate,
    Pro,
    Master,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(clippy::struct_field_names)]
pub struct GardenerTierScoreBreakdown {
    pub crop_diversity_points: i32,
    pub seasonal_consistency_points: i32,
    pub sharing_outcomes_points: i32,
    pub photo_trust_points: i32,
    pub reliability_points: i32,
    pub total_points: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenerTierDecision {
    pub tier: GardenerTier,
    pub evaluated_at: String,
    pub explanation: Vec<String>,
    pub breakdown: GardenerTierScoreBreakdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GardenerTierProfile {
    pub current_tier: GardenerTier,
    pub last_promotion_at: Option<String>,
    pub decision: GardenerTierDecision,
}

#[allow(clippy::too_many_lines, clippy::cast_possible_truncation)]
pub fn evaluate_and_record(
    _client: &Client,
    user_id: Uuid,
) -> Result<GardenerTierProfile, lambda_http::Error> {
    // TODO: Fix UUID serialization issue with tokio-postgres
    tracing::warn!(
        user_id = %user_id,
        "Gardener tier calculation temporarily disabled due to UUID serialization issue"
    );
    Err(lambda_http::Error::from(
        "Gardener tier calculation temporarily disabled",
    ))

    /* Temporarily disabled - UUID serialization issue
    let metrics = client
        .query_one(
            r"
            with crop_metrics as (
              select count(distinct gcl.crop_id)::int as diversity
              from grower_crop_library gcl
              where gcl.user_id = $1 and gcl.status in ('planning', 'growing')
            ),
            season_metrics as (
              select count(distinct date_part('quarter', sl.created_at)::int)::int as active_quarters
              from surplus_listings sl
              where sl.user_id = $1 and sl.deleted_at is null and sl.created_at >= now() - interval '365 days'
            ),
            share_metrics as (
              select count(*) filter (where c.status = 'completed')::int as completed_shares,
                     count(*)::int as total_claims
              from claims c
              join surplus_listings sl on sl.id = c.listing_id
              where sl.user_id = $1
            ),
            evidence_metrics as (
              select coalesce(avg(trust_score), 0)::double precision as avg_trust
              from badge_evidence_submissions
              where user_id = $1 and status in ('auto_approved', 'needs_review')
            )
            select
              cm.diversity,
              sm.active_quarters,
              shm.completed_shares,
              shm.total_claims,
              em.avg_trust
            from crop_metrics cm
            cross join season_metrics sm
            cross join share_metrics shm
            cross join evidence_metrics em
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let diversity = metrics.get::<_, i32>("diversity");
    let active_quarters = metrics.get::<_, i32>("active_quarters");
    let completed_shares = metrics.get::<_, i32>("completed_shares");
    let total_claims = metrics.get::<_, i32>("total_claims");
    let avg_trust = metrics.get::<_, f64>("avg_trust");

    let crop_diversity_points = bucket_points(diversity, &[(1, 8), (3, 16), (5, 24), (8, 30)]);
    let seasonal_consistency_points =
        bucket_points(active_quarters, &[(1, 5), (2, 10), (3, 15), (4, 20)]);
    let sharing_outcomes_points = bucket_points(
        completed_shares,
        &[(1, 6), (3, 12), (8, 16), (15, SHARING_OUTCOMES_WEIGHT)],
    );

    let reliability_ratio = if total_claims == 0 {
        1.0
    } else {
        f64::from(completed_shares) / f64::from(total_claims)
    }
    .clamp(0.0, 1.0);

    let reliability_points = (reliability_ratio * f64::from(RELIABILITY_WEIGHT)).round() as i32;
    let photo_trust_points =
        ((avg_trust / 100.0).clamp(0.0, 1.0) * f64::from(PHOTO_TRUST_WEIGHT)).round() as i32;

    let total_points = crop_diversity_points
        + seasonal_consistency_points
        + sharing_outcomes_points
        + photo_trust_points
        + reliability_points;

    let tier = if total_points >= 80 {
        GardenerTier::Master
    } else if total_points >= 60 {
        GardenerTier::Pro
    } else if total_points >= 35 {
        GardenerTier::Intermediate
    } else {
        GardenerTier::Novice
    };

    let now = chrono::Utc::now();
    let explanation = vec![
        format!("Verified crop diversity observed: {diversity} unique crops."),
        format!(
            "Seasonal consistency observed: {active_quarters} active quarter(s) in trailing year."
        ),
        format!("Sharing outcomes: {completed_shares}/{total_claims} completed claims."),
        format!("Photo evidence trust average: {:.1}.", avg_trust),
        format!(
            "Reliability completion ratio: {:.0}%.",
            reliability_ratio * 100.0
        ),
    ];

    let latest = client
        .query_opt(
            "select tier::text as tier, promoted_at from gardener_tier_promotions where user_id = $1 order by promoted_at desc limit 1",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let mut last_promotion_at = latest.as_ref().map(|row| {
        row.get::<_, chrono::DateTime<chrono::Utc>>("promoted_at")
            .to_rfc3339()
    });

    let prior_tier = latest.and_then(|row| parse_tier(&row.get::<_, String>("tier")));

    if prior_tier.as_ref().map_or(true, |prior| tier > *prior) {
        client
            .execute(
                "insert into gardener_tier_promotions (user_id, tier, explanation, score_breakdown, total_score, promoted_at) values ($1, $2::gardener_tier, $3, $4::jsonb, $5, $6)",
                &[
                    &user_id,
                    &tier_as_str(&tier),
                    &explanation.join(" "),
                    &serde_json::to_string(&GardenerTierScoreBreakdown {
                        crop_diversity_points,
                        seasonal_consistency_points,
                        sharing_outcomes_points,
                        photo_trust_points,
                        reliability_points,
                        total_points,
                    })
                    .map_err(|e| lambda_http::Error::from(format!("Serialize error: {e}")))?,
                    &total_points,
                    &now,
                ],
            )
            .await
            .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

        last_promotion_at = Some(now.to_rfc3339());
    }

    Ok(GardenerTierProfile {
        current_tier: tier.clone(),
        last_promotion_at,
        decision: GardenerTierDecision {
            tier,
            evaluated_at: now.to_rfc3339(),
            explanation,
            breakdown: GardenerTierScoreBreakdown {
                crop_diversity_points,
                seasonal_consistency_points,
                sharing_outcomes_points,
                photo_trust_points,
                reliability_points,
                total_points,
            },
        },
    })
    */
}

#[allow(dead_code)]
fn bucket_points(value: i32, steps: &[(i32, i32)]) -> i32 {
    steps
        .iter()
        .filter(|(min, _)| value >= *min)
        .map(|(_, pts)| *pts)
        .max()
        .unwrap_or(0)
}

#[allow(dead_code)]
fn parse_tier(value: &str) -> Option<GardenerTier> {
    match value {
        "novice" => Some(GardenerTier::Novice),
        "intermediate" => Some(GardenerTier::Intermediate),
        "pro" => Some(GardenerTier::Pro),
        "master" => Some(GardenerTier::Master),
        _ => None,
    }
}

#[allow(dead_code)]
const fn tier_as_str(tier: &GardenerTier) -> &'static str {
    match tier {
        GardenerTier::Novice => "novice",
        GardenerTier::Intermediate => "intermediate",
        GardenerTier::Pro => "pro",
        GardenerTier::Master => "master",
    }
}
