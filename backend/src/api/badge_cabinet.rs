use chrono::Datelike;
use serde::Serialize;
use tokio_postgres::Client;
use uuid::Uuid;

const FIRST_HARVEST_BADGE_KEY: &str = "first_harvest";
const GARDENER_SEASON_BADGE_PREFIX: &str = "gardener_season_";
const FRUIT_TREE_KEEPER_BADGE_KEY: &str = "fruit_tree_keeper";
const ORCHARD_STARTER_BADGE_KEY: &str = "orchard_starter";
const BERRY_BUILDER_BADGE_KEY: &str = "berry_builder";
const FIRST_SHARE_BADGE_KEY: &str = "first_share";
const NEIGHBORHOOD_PROVIDER_BADGE_KEY: &str = "neighborhood_provider";
const ABUNDANCE_GIVER_BADGE_KEY: &str = "abundance_giver";
const CONSISTENCY_GIVER_BADGE_KEY: &str = "consistency_giver";
const RELIABLE_GROWER_BADGE_KEY: &str = "reliable_grower";
const HERB_WHISPERER_BADGE_KEY: &str = "herb_whisperer";
const POLLINATOR_FRIEND_BADGE_KEY: &str = "pollinator_friend";
const WATER_WISE_BADGE_KEY: &str = "water_wise";
const COMPOST_CHAMPION_BADGE_KEY: &str = "compost_champion";
const SEASON_STARTER_BADGE_KEY: &str = "season_starter";
const SEASON_FINISHER_BADGE_KEY: &str = "season_finisher";
const HARVEST_PROOF_WINDOW_DAYS: i32 = 14;

const PRACTICE_MIN_CONFIDENCE: f64 = 0.8;
const PRACTICE_HERB_EVIDENCE_MIN: i32 = 3;
const PRACTICE_POLLINATOR_EVIDENCE_MIN: i32 = 3;
const PRACTICE_WATER_WISE_EVIDENCE_MIN: i32 = 4;
const PRACTICE_COMPOST_EVIDENCE_MIN: i32 = 4;
const PRACTICE_SEASON_MIN_EVENTS: i32 = 2;

const FRUIT_TREE_KEEPER_MIN_TREE_COUNT: i32 = 1;
const ORCHARD_STARTER_MIN_TREE_COUNT: i32 = 3;
const BERRY_BUILDER_MIN_VARIETY_COUNT: i32 = 3;
const FRUIT_BADGE_MIN_EVIDENCE_PER_TREE: i32 = 2;
const FRUIT_BADGE_MIN_ACTIVITY_DAYS: i64 = 60;

const NEIGHBORHOOD_PROVIDER_MIN_COMPLETED_SHARES: i32 = 10;
const ABUNDANCE_GIVER_MIN_WEIGHT_VOLUME: f64 = 25.0;
const CONSISTENCY_GIVER_STREAK_MONTHS: i32 = 3;
const RELIABLE_GROWER_MIN_COMPLETED_SHARES: i32 = 10;
const RELIABLE_GROWER_MIN_COMPLETION_RATIO: f64 = 0.9;
const RELIABLE_GROWER_MAX_DISRUPTED_OUTCOMES: i32 = 1;

const SEASON_DEFAULT_ACTIVITY_WEEKS_MIN: i32 = 10;
const SEASON_DEFAULT_CROP_COMPLETIONS_MIN: i32 = 3;
const SEASON_DEFAULT_EVIDENCE_COUNT_MIN: i32 = 6;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeCabinetEntry {
    pub badge_key: String,
    pub earned_at: String,
    pub proof_count: i32,
}

#[derive(Debug)]
#[allow(clippy::struct_field_names)]
struct GardenerSeasonCriteria {
    activity_weeks_min: i32,
    crop_completions_min: i32,
    evidence_count_min: i32,
}

#[derive(Debug)]
struct QualifiedSeason {
    season_year: i32,
    earned_at: chrono::DateTime<chrono::Utc>,
}

pub async fn load_and_sync_badges(
    client: &Client,
    user_id: Uuid,
) -> Result<Vec<BadgeCabinetEntry>, lambda_http::Error> {
    tracing::info!(user_id = %user_id, "Starting load_and_sync_badges");

    maybe_award_first_harvest(client, user_id).await?;
    tracing::info!(user_id = %user_id, "Completed maybe_award_first_harvest");

    maybe_award_gardener_season_ladder(client, user_id).await?;
    tracing::info!(user_id = %user_id, "Completed maybe_award_gardener_season_ladder");

    maybe_award_fruit_focused_badges(client, user_id).await?;
    tracing::info!(user_id = %user_id, "Completed maybe_award_fruit_focused_badges");

    maybe_award_sharing_credibility_badges(client, user_id).await?;
    tracing::info!(user_id = %user_id, "Completed maybe_award_sharing_credibility_badges");

    maybe_award_practice_badges(client, user_id).await?;
    tracing::info!(user_id = %user_id, "Completed maybe_award_practice_badges");

    let rows = client
        .query(
            "select badge_key, awarded_at, coalesce((award_snapshot->>'proofCount')::int, 0) as proof_count from badge_award_audit where user_id = $1 order by awarded_at asc",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    tracing::info!(user_id = %user_id, "Completed loading badge_award_audit");

    Ok(rows
        .into_iter()
        .map(|row| BadgeCabinetEntry {
            badge_key: row.get("badge_key"),
            earned_at: row
                .get::<_, chrono::DateTime<chrono::Utc>>("awarded_at")
                .to_rfc3339(),
            proof_count: row.get("proof_count"),
        })
        .collect())
}

#[allow(clippy::too_many_lines)]
async fn maybe_award_gardener_season_ladder(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    tracing::info!(user_id = %user_id, "maybe_award_gardener_season_ladder: loading criteria");

    let criteria = load_gardener_season_criteria(client).await?;

    tracing::info!(user_id = %user_id, "maybe_award_gardener_season_ladder: querying year activity");

    let rows = client
        .query(
            r"
            with year_activity as (
              select
                extract(year from c.completed_at at time zone 'utc')::int as season_year,
                min(c.completed_at) as first_activity_at,
                max(c.completed_at) as last_activity_at,
                count(distinct sl.grower_crop_id)::int as crop_completions
              from surplus_listings sl
              join claims c on c.listing_id = sl.id
              where sl.user_id = $1
                and sl.grower_crop_id is not null
                and c.status = 'completed'
                and c.completed_at is not null
              group by extract(year from c.completed_at at time zone 'utc')::int
            ),
            year_evidence as (
              select
                extract(year from coalesce(bes.exif_taken_at, bes.captured_at, bes.created_at) at time zone 'utc')::int as season_year,
                count(*)::int as evidence_count
              from badge_evidence_submissions bes
              where bes.user_id = $1
                and bes.status in ('auto_approved', 'needs_review')
              group by extract(year from coalesce(bes.exif_taken_at, bes.captured_at, bes.created_at) at time zone 'utc')::int
            )
            select
              ya.season_year,
              ya.first_activity_at,
              ya.last_activity_at,
              ya.crop_completions,
              coalesce(ye.evidence_count, 0)::int as evidence_count
            from year_activity ya
            left join year_evidence ye on ye.season_year = ya.season_year
            order by ya.season_year asc
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error in maybe_award_gardener_season_ladder: {e}")))?;

    tracing::info!(user_id = %user_id, row_count = rows.len(), "maybe_award_gardener_season_ladder: processing seasons");

    let mut qualified = Vec::new();
    for row in rows {
        let season_year: i32 = row.get("season_year");
        let first_activity_at: chrono::DateTime<chrono::Utc> = row.get("first_activity_at");
        let last_activity_at: chrono::DateTime<chrono::Utc> = row.get("last_activity_at");
        let crop_completions: i32 = row.get("crop_completions");
        let evidence_count: i32 = row.get("evidence_count");

        let activity_weeks = i32::try_from((last_activity_at - first_activity_at).num_days() / 7)
            .unwrap_or(i32::MAX);
        let qualifies = activity_weeks >= criteria.activity_weeks_min
            && crop_completions >= criteria.crop_completions_min
            && evidence_count >= criteria.evidence_count_min;

        if qualifies {
            qualified.push(QualifiedSeason {
                season_year,
                earned_at: last_activity_at,
            });
        }
    }

    tracing::info!(user_id = %user_id, qualified_count = qualified.len(), "maybe_award_gardener_season_ladder: awarding badges");

    for (index, season) in qualified.iter().enumerate() {
        let level = i32::try_from(index + 1).unwrap_or(i32::MAX);
        let badge_key = format!("{GARDENER_SEASON_BADGE_PREFIX}{level}");

        tracing::info!(user_id = %user_id, badge_key = %badge_key, season_year = season.season_year, "maybe_award_gardener_season_ladder: checking if already awarded");

        let already_awarded = client
            .query_opt(
                r"
                select id
                from badge_award_audit
                where user_id = $1
                  and badge_key = $2
                  and (award_snapshot->>'seasonYear')::int = $3
                limit 1
                ",
                &[&user_id, &badge_key, &season.season_year],
            )
            .await
            .map_err(|e| {
                lambda_http::Error::from(format!("Database query error checking badge award: {e}"))
            })?
            .is_some();

        if already_awarded {
            tracing::info!(user_id = %user_id, badge_key = %badge_key, "maybe_award_gardener_season_ladder: already awarded, skipping");
            continue;
        }

        let snapshot = serde_json::json!({
            "badgeFamily": "seasonal_mastery",
            "seasonYear": season.season_year,
            "level": level,
            "criteria": {
                "minActivityWeeks": criteria.activity_weeks_min,
                "minCropCompletions": criteria.crop_completions_min,
                "minEvidenceCount": criteria.evidence_count_min
            }
        });

        tracing::info!(user_id = %user_id, badge_key = %badge_key, "maybe_award_gardener_season_ladder: about to insert badge");

        client
            .execute(
                "insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot) values ($1, $2, $3, null, $4, '[]'::jsonb, $5)",
                &[
                    &user_id,
                    &badge_key,
                    &season.earned_at,
                    &"Gardener Season awarded: met configured annual activity, crop completion, and evidence thresholds".to_string(),
                    &snapshot,
                ],
            )
            .await
            .map_err(|e| lambda_http::Error::from(format!("Database insert error in maybe_award_gardener_season_ladder for badge {badge_key}: {e}")))?;

        tracing::info!(user_id = %user_id, badge_key = %badge_key, "maybe_award_gardener_season_ladder: badge awarded successfully");
    }

    Ok(())
}

async fn load_gardener_season_criteria(
    client: &Client,
) -> Result<GardenerSeasonCriteria, lambda_http::Error> {
    let row = client
        .query_opt(
            "select min_activity_weeks, min_crop_completions, min_evidence_count from badge_season_criteria where criteria_key = 'gardener_season_v1' limit 1",
            &[],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    Ok(row.map_or(
        GardenerSeasonCriteria {
            activity_weeks_min: SEASON_DEFAULT_ACTIVITY_WEEKS_MIN,
            crop_completions_min: SEASON_DEFAULT_CROP_COMPLETIONS_MIN,
            evidence_count_min: SEASON_DEFAULT_EVIDENCE_COUNT_MIN,
        },
        |r| GardenerSeasonCriteria {
            activity_weeks_min: r.get("min_activity_weeks"),
            crop_completions_min: r.get("min_crop_completions"),
            evidence_count_min: r.get("min_evidence_count"),
        },
    ))
}

#[allow(clippy::too_many_lines)]
async fn maybe_award_fruit_focused_badges(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let tree_rows = client
        .query(
            r"
            with fruit_tree_events as (
              select
                sl.crop_id,
                min(c.completed_at) as first_completed_at,
                max(c.completed_at) as last_completed_at,
                count(*)::int as completed_count
              from surplus_listings sl
              join claims c on c.listing_id = sl.id
              join crops cr on cr.id = sl.crop_id
              where sl.user_id = $1
                and c.status = 'completed'
                and c.completed_at is not null
                and (
                  coalesce(cr.category, '') ilike '%fruit%'
                  or cr.common_name ilike any(array['%apple%', '%pear%', '%peach%', '%plum%', '%cherry%', '%citrus%', '%orange%', '%lemon%'])
                )
              group by sl.crop_id
            ),
            fruit_tree_proof as (
              select
                bes.grower_crop_id,
                count(*)::int as evidence_count
              from badge_evidence_submissions bes
              where bes.user_id = $1
                and bes.status in ('auto_approved', 'needs_review')
              group by bes.grower_crop_id
            )
            select
              fte.crop_id,
              fte.first_completed_at,
              fte.last_completed_at,
              fte.completed_count,
              coalesce(sum(ftp.evidence_count), 0)::int as evidence_count
            from fruit_tree_events fte
            left join grower_crop_library gcl
              on gcl.user_id = $1
             and gcl.crop_id = fte.crop_id
            left join fruit_tree_proof ftp
              on ftp.grower_crop_id = gcl.id
            group by fte.crop_id, fte.first_completed_at, fte.last_completed_at, fte.completed_count
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let qualifying_tree_count = i32::try_from(
        tree_rows
            .iter()
            .filter(|row| {
                let first_completed_at: chrono::DateTime<chrono::Utc> =
                    row.get("first_completed_at");
                let last_completed_at: chrono::DateTime<chrono::Utc> = row.get("last_completed_at");
                let evidence_count: i32 = row.get("evidence_count");
                (last_completed_at - first_completed_at).num_days() >= FRUIT_BADGE_MIN_ACTIVITY_DAYS
                    && evidence_count >= FRUIT_BADGE_MIN_EVIDENCE_PER_TREE
            })
            .count(),
    )
    .unwrap_or(i32::MAX);

    maybe_award_badge_if_needed(
        client,
        user_id,
        FRUIT_TREE_KEEPER_BADGE_KEY,
        qualifying_tree_count >= FRUIT_TREE_KEEPER_MIN_TREE_COUNT,
        serde_json::json!({
            "badgeFamily": "fruit_focus",
            "qualifyingTreeCount": qualifying_tree_count,
            "minTreeCount": FRUIT_TREE_KEEPER_MIN_TREE_COUNT,
            "minEvidencePerTree": FRUIT_BADGE_MIN_EVIDENCE_PER_TREE,
            "minActivityDays": FRUIT_BADGE_MIN_ACTIVITY_DAYS,
        }),
        "Fruit Tree Keeper awarded: sustained fruit tree activity with linked timestamped proof",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        ORCHARD_STARTER_BADGE_KEY,
        qualifying_tree_count >= ORCHARD_STARTER_MIN_TREE_COUNT,
        serde_json::json!({
            "badgeFamily": "fruit_focus",
            "qualifyingTreeCount": qualifying_tree_count,
            "minTreeCount": ORCHARD_STARTER_MIN_TREE_COUNT,
            "minEvidencePerTree": FRUIT_BADGE_MIN_EVIDENCE_PER_TREE,
            "minActivityDays": FRUIT_BADGE_MIN_ACTIVITY_DAYS,
        }),
        "Orchard Starter awarded: maintained at least three fruit trees with evidence-backed seasonal continuity",
    )
    .await?;

    let berry_row = client
        .query_one(
            r"
            select count(distinct coalesce(cv.id::text, sl.variety_id::text, sl.crop_id::text))::int as berry_variety_count
            from surplus_listings sl
            join claims c on c.listing_id = sl.id
            join crops cr on cr.id = sl.crop_id
            left join crop_varieties cv on cv.id = sl.variety_id
            where sl.user_id = $1
              and c.status = 'completed'
              and c.completed_at is not null
              and (
                coalesce(cr.category, '') ilike '%berry%'
                or cr.common_name ilike '%berry%'
                or coalesce(cv.name, '') ilike '%berry%'
              )
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let berry_variety_count: i32 = berry_row.get("berry_variety_count");

    maybe_award_badge_if_needed(
        client,
        user_id,
        BERRY_BUILDER_BADGE_KEY,
        berry_variety_count >= BERRY_BUILDER_MIN_VARIETY_COUNT,
        serde_json::json!({
            "badgeFamily": "fruit_focus",
            "berryVarietyCount": berry_variety_count,
            "minBerryVarietyCount": BERRY_BUILDER_MIN_VARIETY_COUNT,
        }),
        "Berry Builder awarded: completed harvest/share activity across multiple berry varieties",
    )
    .await?;

    Ok(())
}

#[allow(clippy::too_many_lines)]
async fn maybe_award_sharing_credibility_badges(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let outcome_row = client
        .query_one(
            r"
            select
              count(*) filter (where c.status = 'completed')::int as completed_count,
              count(*) filter (where c.status in ('cancelled', 'no_show'))::int as disrupted_count,
              count(*)::int as total_count,
              min(c.completed_at) filter (where c.status = 'completed' and c.completed_at is not null) as first_completed_at,
              max(c.completed_at) filter (where c.status = 'completed' and c.completed_at is not null) as last_completed_at,
              coalesce(sum(c.quantity_claimed) filter (
                where c.status = 'completed'
                  and c.completed_at is not null
                  and lower(coalesce(sl.unit, '')) in ('g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'ml', 'milliliter', 'milliliters', 'l', 'liter', 'liters')
              ), 0)::double precision as weight_volume_completed_quantity
            from surplus_listings sl
            join claims c on c.listing_id = sl.id
            where sl.user_id = $1
              and c.claimer_id <> $1
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let completed_count: i32 = outcome_row.get("completed_count");
    let disrupted_count: i32 = outcome_row.get("disrupted_count");
    let total_count: i32 = outcome_row.get("total_count");
    let first_completed_at: Option<chrono::DateTime<chrono::Utc>> =
        outcome_row.get("first_completed_at");
    let last_completed_at: Option<chrono::DateTime<chrono::Utc>> =
        outcome_row.get("last_completed_at");
    let weight_volume_completed_quantity: f64 = outcome_row.get("weight_volume_completed_quantity");

    maybe_award_badge_if_needed(
        client,
        user_id,
        FIRST_SHARE_BADGE_KEY,
        completed_count >= 1,
        serde_json::json!({
            "badgeFamily": "sharing_credibility",
            "completedShareCount": completed_count,
            "antiAbuse": {
                "excludesSelfClaims": true
            }
        }),
        "First Share awarded: first completed handoff with non-self claimer",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        NEIGHBORHOOD_PROVIDER_BADGE_KEY,
        completed_count >= NEIGHBORHOOD_PROVIDER_MIN_COMPLETED_SHARES,
        serde_json::json!({
            "badgeFamily": "sharing_credibility",
            "completedShareCount": completed_count,
            "minCompletedShareCount": NEIGHBORHOOD_PROVIDER_MIN_COMPLETED_SHARES,
            "antiAbuse": {
                "excludesSelfClaims": true
            }
        }),
        "Neighborhood Provider awarded: ten completed handoffs with non-self claimers",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        ABUNDANCE_GIVER_BADGE_KEY,
        weight_volume_completed_quantity >= ABUNDANCE_GIVER_MIN_WEIGHT_VOLUME,
        serde_json::json!({
            "badgeFamily": "sharing_credibility",
            "weightVolumeCompletedQuantity": weight_volume_completed_quantity,
            "minWeightVolume": ABUNDANCE_GIVER_MIN_WEIGHT_VOLUME,
            "countedUnits": ["g", "gram", "grams", "kg", "kilogram", "kilograms", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "ml", "milliliter", "milliliters", "l", "liter", "liters"],
            "antiAbuse": {
                "excludesSelfClaims": true
            }
        }),
        "Abundance Giver awarded: crossed cumulative completed weight/volume handoff threshold",
    )
    .await?;

    let monthly_rows = client
        .query(
            r"
            select
              date_trunc('month', c.completed_at at time zone 'utc')::date as completed_month,
              count(*)::int as completed_count
            from surplus_listings sl
            join claims c on c.listing_id = sl.id
            where sl.user_id = $1
              and c.claimer_id <> $1
              and c.status = 'completed'
              and c.completed_at is not null
            group by 1
            order by 1 asc
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let mut longest_streak = 0_i32;
    let mut current_streak = 0_i32;
    let mut previous_month: Option<chrono::NaiveDate> = None;

    for row in &monthly_rows {
        let month: chrono::NaiveDate = row.get("completed_month");

        if let Some(prev) = previous_month {
            let prev_idx = prev.year() * 12 + i32::try_from(prev.month()).unwrap_or(i32::MAX);
            let current_idx = month.year() * 12 + i32::try_from(month.month()).unwrap_or(i32::MAX);
            if current_idx == prev_idx + 1 {
                current_streak += 1;
            } else {
                current_streak = 1;
            }
        } else {
            current_streak = 1;
        }

        if current_streak > longest_streak {
            longest_streak = current_streak;
        }

        previous_month = Some(month);
    }

    maybe_award_badge_if_needed(
        client,
        user_id,
        CONSISTENCY_GIVER_BADGE_KEY,
        longest_streak >= CONSISTENCY_GIVER_STREAK_MONTHS,
        serde_json::json!({
            "badgeFamily": "sharing_credibility",
            "longestCompletedMonthStreak": longest_streak,
            "requiredStreakMonths": CONSISTENCY_GIVER_STREAK_MONTHS,
            "activeMonthCount": monthly_rows.len(),
            "antiAbuse": {
                "excludesSelfClaims": true
            }
        }),
        "Consistency Giver awarded: maintained completed shares across consecutive months",
    )
    .await?;

    let completion_ratio = if total_count == 0 {
        0.0
    } else {
        f64::from(completed_count) / f64::from(total_count)
    };

    maybe_award_badge_if_needed(
        client,
        user_id,
        RELIABLE_GROWER_BADGE_KEY,
        completed_count >= RELIABLE_GROWER_MIN_COMPLETED_SHARES
            && completion_ratio >= RELIABLE_GROWER_MIN_COMPLETION_RATIO
            && disrupted_count <= RELIABLE_GROWER_MAX_DISRUPTED_OUTCOMES,
        serde_json::json!({
            "badgeFamily": "sharing_credibility",
            "completedShareCount": completed_count,
            "totalOutcomeCount": total_count,
            "disruptedOutcomeCount": disrupted_count,
            "completionRatio": completion_ratio,
            "minCompletedShareCount": RELIABLE_GROWER_MIN_COMPLETED_SHARES,
            "minCompletionRatio": RELIABLE_GROWER_MIN_COMPLETION_RATIO,
            "maxDisruptedOutcomes": RELIABLE_GROWER_MAX_DISRUPTED_OUTCOMES,
            "firstCompletedAt": first_completed_at.map(|ts| ts.to_rfc3339()),
            "lastCompletedAt": last_completed_at.map(|ts| ts.to_rfc3339()),
            "antiAbuse": {
                "excludesSelfClaims": true
            }
        }),
        "Reliable Grower awarded: high completion outcomes with low cancellation/no-show rate",
    )
    .await?;

    Ok(())
}

#[allow(clippy::too_many_lines)]
async fn maybe_award_practice_badges(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let row = client
        .query_one(
            r"
            with scoped_evidence as (
              select
                lower(coalesce(ai_crop_label, '')) as crop_label,
                lower(coalesce(ai_stage_label, '')) as stage_label,
                coalesce(ai_crop_confidence::double precision, 0) as crop_conf,
                coalesce(ai_stage_confidence::double precision, 0) as stage_conf,
                coalesce(exif_taken_at, captured_at, created_at) as observed_at
              from badge_evidence_submissions
              where user_id = $1
                and status in ('auto_approved', 'needs_review')
            )
            select
              count(*) filter (
                where crop_label like any(array['%herb%', '%basil%', '%mint%', '%cilantro%', '%parsley%'])
                  and greatest(crop_conf, stage_conf) >= $2
              )::int as herb_count,
              count(*) filter (
                where crop_label like any(array['%flower%', '%pollinator%', '%lavender%', '%bee balm%', '%native%'])
                  and greatest(crop_conf, stage_conf) >= $2
              )::int as pollinator_count,
              count(*) filter (
                where stage_label like any(array['%irrig%', '%watering%', '%mulch%'])
                  and greatest(crop_conf, stage_conf) >= $2
              )::int as water_wise_count,
              count(*) filter (
                where crop_label like any(array['%compost%', '%compostable%', '%soil amendment%'])
                  and greatest(crop_conf, stage_conf) >= $2
              )::int as compost_count,
              count(*) filter (
                where extract(month from observed_at at time zone 'utc') between 3 and 5
              )::int as spring_count,
              count(*) filter (
                where extract(month from observed_at at time zone 'utc') between 9 and 11
              )::int as fall_count
            from scoped_evidence
            ",
            &[&user_id, &PRACTICE_MIN_CONFIDENCE],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let herb_count: i32 = row.get("herb_count");
    let pollinator_count: i32 = row.get("pollinator_count");
    let water_wise_count: i32 = row.get("water_wise_count");
    let compost_count: i32 = row.get("compost_count");
    let spring_count: i32 = row.get("spring_count");
    let fall_count: i32 = row.get("fall_count");

    maybe_award_badge_if_needed(
        client,
        user_id,
        HERB_WHISPERER_BADGE_KEY,
        herb_count >= PRACTICE_HERB_EVIDENCE_MIN,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "qualifiedEvidenceCount": herb_count,
            "minEvidenceCount": PRACTICE_HERB_EVIDENCE_MIN,
            "minConfidence": PRACTICE_MIN_CONFIDENCE,
        }),
        "Herb Whisperer awarded: repeated high-confidence herb cultivation evidence",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        POLLINATOR_FRIEND_BADGE_KEY,
        pollinator_count >= PRACTICE_POLLINATOR_EVIDENCE_MIN,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "qualifiedEvidenceCount": pollinator_count,
            "minEvidenceCount": PRACTICE_POLLINATOR_EVIDENCE_MIN,
            "minConfidence": PRACTICE_MIN_CONFIDENCE,
        }),
        "Pollinator Friend awarded: pollinator-supporting evidence sustained across events",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        WATER_WISE_BADGE_KEY,
        water_wise_count >= PRACTICE_WATER_WISE_EVIDENCE_MIN,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "qualifiedEvidenceCount": water_wise_count,
            "minEvidenceCount": PRACTICE_WATER_WISE_EVIDENCE_MIN,
            "minConfidence": PRACTICE_MIN_CONFIDENCE,
        }),
        "Water Wise awarded: recurring irrigation and conservation signals in proof evidence",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        COMPOST_CHAMPION_BADGE_KEY,
        compost_count >= PRACTICE_COMPOST_EVIDENCE_MIN,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "qualifiedEvidenceCount": compost_count,
            "minEvidenceCount": PRACTICE_COMPOST_EVIDENCE_MIN,
            "minConfidence": PRACTICE_MIN_CONFIDENCE,
        }),
        "Compost Champion awarded: repeated compost cycle evidence with confidence thresholds",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        SEASON_STARTER_BADGE_KEY,
        spring_count >= PRACTICE_SEASON_MIN_EVENTS,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "seasonWindow": "spring",
            "qualifiedEvidenceCount": spring_count,
            "minEvidenceCount": PRACTICE_SEASON_MIN_EVENTS,
            "windowMonthsUtc": [3, 4, 5]
        }),
        "Season Starter awarded: spring season proof events met deterministic threshold",
    )
    .await?;

    maybe_award_badge_if_needed(
        client,
        user_id,
        SEASON_FINISHER_BADGE_KEY,
        fall_count >= PRACTICE_SEASON_MIN_EVENTS,
        serde_json::json!({
            "badgeFamily": "garden_practice",
            "seasonWindow": "fall",
            "qualifiedEvidenceCount": fall_count,
            "minEvidenceCount": PRACTICE_SEASON_MIN_EVENTS,
            "windowMonthsUtc": [9, 10, 11]
        }),
        "Season Finisher awarded: fall season proof events met deterministic threshold",
    )
    .await?;

    Ok(())
}

async fn maybe_award_badge_if_needed(
    client: &Client,
    user_id: Uuid,
    badge_key: &str,
    qualifies: bool,
    snapshot: serde_json::Value,
    reason: &str,
) -> Result<(), lambda_http::Error> {
    if !qualifies {
        return Ok(());
    }

    let already_awarded = client
        .query_opt(
            "select id from badge_award_audit where user_id = $1 and badge_key = $2 limit 1",
            &[&user_id, &badge_key],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?
        .is_some();

    if already_awarded {
        return Ok(());
    }

    client
        .execute(
            "insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot) values ($1, $2, now(), null, $3, '[]'::jsonb, $4)",
            &[&user_id, &badge_key, &reason.to_string(), &snapshot],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    Ok(())
}

async fn maybe_award_first_harvest(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    tracing::info!(user_id = %user_id, "maybe_award_first_harvest: checking if already awarded");

    let already_awarded = client
        .query_opt(
            "select id from badge_award_audit where user_id = $1 and badge_key = $2 limit 1",
            &[&user_id, &FIRST_HARVEST_BADGE_KEY],
        )
        .await
        .map_err(|e| {
            lambda_http::Error::from(format!(
                "Database query error in maybe_award_first_harvest check: {e}"
            ))
        })?
        .is_some();

    if already_awarded {
        tracing::info!(user_id = %user_id, "maybe_award_first_harvest: already awarded, skipping");
        return Ok(());
    }

    tracing::info!(user_id = %user_id, "maybe_award_first_harvest: querying harvest events");

    let window_days = HARVEST_PROOF_WINDOW_DAYS;

    let row = client
        .query_opt(
            r"
            with harvest_events as (
              select
                sl.grower_crop_id,
                min(c.completed_at) as harvest_at
              from surplus_listings sl
              join claims c on c.listing_id = sl.id
              where sl.user_id = $1
                and sl.grower_crop_id is not null
                and c.status = 'completed'
                and c.completed_at is not null
              group by sl.grower_crop_id
            ),
            proof_matches as (
              select
                he.grower_crop_id,
                count(*)::int as proof_count,
                min(he.harvest_at) as first_harvest_at
              from harvest_events he
              join badge_evidence_submissions bes
                on bes.user_id = $1
               and bes.grower_crop_id = he.grower_crop_id
               and bes.status in ('auto_approved', 'needs_review')
               and coalesce(bes.exif_taken_at, bes.captured_at, bes.created_at)
                    between he.harvest_at - make_interval(days => $2)
                        and he.harvest_at + make_interval(days => $2)
              group by he.grower_crop_id
            )
            select sum(proof_count)::int as proof_count,
                   min(first_harvest_at) as first_harvest_at
            from proof_matches
            ",
            &[&user_id, &window_days],
        )
        .await
        .map_err(|e| {
            lambda_http::Error::from(format!(
                "Database query error in maybe_award_first_harvest harvest query: {e}"
            ))
        })?;

    let Some(row) = row else {
        tracing::info!(user_id = %user_id, "maybe_award_first_harvest: no harvest events found");
        return Ok(());
    };

    let proof_count = row.get::<_, Option<i32>>("proof_count").unwrap_or(0);
    let first_harvest_at = row.get::<_, Option<chrono::DateTime<chrono::Utc>>>("first_harvest_at");

    if proof_count <= 0 || first_harvest_at.is_none() {
        tracing::info!(user_id = %user_id, proof_count = proof_count, "maybe_award_first_harvest: insufficient proof");
        return Ok(());
    }

    tracing::info!(user_id = %user_id, proof_count = proof_count, "maybe_award_first_harvest: awarding badge");

    let awarded_at = first_harvest_at.unwrap_or_else(chrono::Utc::now);
    let snapshot = serde_json::json!({
        "proofCount": proof_count,
        "windowDays": HARVEST_PROOF_WINDOW_DAYS,
        "badgeFamily": "milestone_identity"
    });

    tracing::info!(user_id = %user_id, "maybe_award_first_harvest: about to insert badge_award_audit");

    client
        .execute(
            "insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot) values ($1, $2, $3, null, $4, '[]'::jsonb, $5)",
            &[
                &user_id,
                &FIRST_HARVEST_BADGE_KEY,
                &awarded_at,
                &"First Harvest awarded: completed harvest event with timestamped linked photo proof near harvest window".to_string(),
                &snapshot,
            ],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database insert error in maybe_award_first_harvest: {e}")))?;

    tracing::info!(user_id = %user_id, "maybe_award_first_harvest: badge awarded successfully");

    Ok(())
}
