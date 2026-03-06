use serde::Serialize;
use tokio_postgres::Client;
use uuid::Uuid;

const FIRST_HARVEST_BADGE_KEY: &str = "first_harvest";
const GARDENER_SEASON_BADGE_PREFIX: &str = "gardener_season_";
const HARVEST_PROOF_WINDOW_DAYS: i64 = 14;

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
    maybe_award_first_harvest(client, user_id).await?;
    maybe_award_gardener_season_ladder(client, user_id).await?;

    let rows = client
        .query(
            "select badge_key, awarded_at, coalesce((award_snapshot->>'proofCount')::int, 0) as proof_count from badge_award_audit where user_id = $1 order by awarded_at asc",
            &[&user_id],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

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
    let criteria = load_gardener_season_criteria(client).await?;

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
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

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

    for (index, season) in qualified.iter().enumerate() {
        let level = i32::try_from(index + 1).unwrap_or(i32::MAX);
        let badge_key = format!("{GARDENER_SEASON_BADGE_PREFIX}{level}");

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
            .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?
            .is_some();

        if already_awarded {
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

        client
            .execute(
                "insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot) values ($1, $2, $3, null, $4, '[]'::jsonb, $5::jsonb)",
                &[
                    &user_id,
                    &badge_key,
                    &season.earned_at,
                    &"Gardener Season awarded: met configured annual activity, crop completion, and evidence thresholds".to_string(),
                    &snapshot.to_string(),
                ],
            )
            .await
            .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;
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

async fn maybe_award_first_harvest(
    client: &Client,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let already_awarded = client
        .query_opt(
            "select id from badge_award_audit where user_id = $1 and badge_key = $2 limit 1",
            &[&user_id, &FIRST_HARVEST_BADGE_KEY],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?
        .is_some();

    if already_awarded {
        return Ok(());
    }

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
                    between he.harvest_at - ($2 || ' days')::interval
                        and he.harvest_at + ($2 || ' days')::interval
              group by he.grower_crop_id
            )
            select sum(proof_count)::int as proof_count,
                   min(first_harvest_at) as first_harvest_at
            from proof_matches
            ",
            &[&user_id, &HARVEST_PROOF_WINDOW_DAYS],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    let Some(row) = row else {
        return Ok(());
    };

    let proof_count = row.get::<_, Option<i32>>("proof_count").unwrap_or(0);
    let first_harvest_at = row.get::<_, Option<chrono::DateTime<chrono::Utc>>>("first_harvest_at");

    if proof_count <= 0 || first_harvest_at.is_none() {
        return Ok(());
    }

    let awarded_at = first_harvest_at.unwrap_or_else(chrono::Utc::now);
    let snapshot = serde_json::json!({
        "proofCount": proof_count,
        "windowDays": HARVEST_PROOF_WINDOW_DAYS,
        "badgeFamily": "milestone_identity"
    });

    client
        .execute(
            "insert into badge_award_audit (user_id, badge_key, awarded_at, trust_score_snapshot, decision_reason, evidence_submission_ids, award_snapshot) values ($1, $2, $3, null, $4, '[]'::jsonb, $5::jsonb)",
            &[
                &user_id,
                &FIRST_HARVEST_BADGE_KEY,
                &awarded_at,
                &"First Harvest awarded: completed harvest event with timestamped linked photo proof near harvest window".to_string(),
                &snapshot.to_string(),
            ],
        )
        .await
        .map_err(|e| lambda_http::Error::from(format!("Database query error: {e}")))?;

    Ok(())
}
