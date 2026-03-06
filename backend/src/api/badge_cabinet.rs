use serde::Serialize;
use tokio_postgres::Client;
use uuid::Uuid;

const FIRST_HARVEST_BADGE_KEY: &str = "first_harvest";
const HARVEST_PROOF_WINDOW_DAYS: i64 = 14;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeCabinetEntry {
    pub badge_key: String,
    pub earned_at: String,
    pub proof_count: i32,
}

pub async fn load_and_sync_badges(
    client: &Client,
    user_id: Uuid,
) -> Result<Vec<BadgeCabinetEntry>, lambda_http::Error> {
    maybe_award_first_harvest(client, user_id).await?;

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
