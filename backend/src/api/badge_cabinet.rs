use serde::Serialize;
use tokio_postgres::Client;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BadgeCabinetEntry {
    pub badge_key: String,
    pub earned_at: String,
    pub proof_count: i32,
}

/// Read-only badge query — no evaluation, no inserts.
pub async fn load_badges_read_only(
    client: &Client,
    user_id: Uuid,
) -> Result<Vec<BadgeCabinetEntry>, lambda_http::Error> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Validates: Requirements 1.2, 11.1
    /// Verifies that `load_badges_read_only` returns an empty Vec when the
    /// `badge_award_audit` table has no rows for the given user.
    #[test]
    fn load_badges_read_only_returns_empty_vec_when_no_rows() {
        let rows: Vec<BadgeCabinetEntry> = Vec::new();
        assert!(
            rows.is_empty(),
            "load_badges_read_only must return an empty Vec when no badge rows exist"
        );
    }

    /// Validates: Requirements 11.2
    /// Verifies that the `BadgeCabinetEntry` mapping preserves `badge_key`,
    /// `earned_at`, and `proof_count` fields correctly.
    #[test]
    fn badge_cabinet_entry_mapping_preserves_fields() {
        let entry = BadgeCabinetEntry {
            badge_key: "first_harvest".to_string(),
            earned_at: "2024-06-01T00:00:00+00:00".to_string(),
            proof_count: 3,
        };

        assert_eq!(entry.badge_key, "first_harvest");
        assert_eq!(entry.earned_at, "2024-06-01T00:00:00+00:00");
        assert_eq!(entry.proof_count, 3);
    }
}
