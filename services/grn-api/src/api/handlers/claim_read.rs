use crate::auth::{extract_auth_context_with_fallback, require_participant_user_type};
use crate::db;
use crate::handlers::claim::ClaimResponse;
use crate::models::crop::ErrorResponse;
use chrono::{DateTime, Utc};
use lambda_http::{Body, Request, Response};
use serde::Serialize;
use tokio_postgres::{Client, Row};
use tracing::info;
use uuid::Uuid;

const ALLOWED_CLAIM_STATUSES: [&str; 5] =
    ["pending", "confirmed", "completed", "cancelled", "no_show"];

#[derive(Debug)]
struct ListClaimsQuery {
    listing_id: Option<Uuid>,
    request_id: Option<Uuid>,
    status: Option<String>,
    limit: i64,
    offset: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListClaimsResponse {
    pub items: Vec<ClaimResponse>,
    pub limit: i64,
    pub offset: i64,
    pub has_more: bool,
    pub next_offset: Option<i64>,
}

pub async fn list_claims(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_participant_user_type(auth_context.user_type.as_ref())?;

    let user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let query = parse_list_claims_query(request.uri().query())?;

    let client = db::connect().await?;
    validate_claim_filter_access(&client, user_id, &query).await?;

    let fetch_limit = query.limit + 1;

    let rows = client
        .query(
            "
            select c.id, c.listing_id, c.request_id, c.claimer_id,
                   l.user_id as listing_owner_id,
                   c.quantity_claimed::text as quantity_claimed,
                   c.status::text as status, c.notes,
                   c.claimed_at, c.confirmed_at, c.completed_at, c.cancelled_at
            from claims c
            inner join surplus_listings l on l.id = c.listing_id
            where l.deleted_at is null
              and (c.claimer_id = $1 or l.user_id = $1)
              and ($2::uuid is null or c.listing_id = $2)
              and ($3::uuid is null or c.request_id = $3)
              and ($4::text is null or c.status::text = $4)
            order by c.claimed_at desc, c.id desc
            limit $5 offset $6
            ",
            &[
                &user_id,
                &query.listing_id,
                &query.request_id,
                &query.status,
                &fetch_limit,
                &query.offset,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let limit = usize::try_from(query.limit)
        .map_err(|_| lambda_http::Error::from("Invalid limit. Must be between 1 and 100"))?;
    let has_more = rows.len() > limit;
    let items = rows
        .into_iter()
        .take(limit)
        .map(|row| row_to_claim_response(&row))
        .collect::<Vec<_>>();

    let response = ListClaimsResponse {
        items,
        limit: query.limit,
        offset: query.offset,
        has_more,
        next_offset: compute_next_offset(query.offset, query.limit, has_more),
    };

    info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        listing_id_filter = ?query.listing_id,
        request_id_filter = ?query.request_id,
        status_filter = ?query.status,
        limit = query.limit,
        offset = query.offset,
        returned_count = response.items.len(),
        has_more = response.has_more,
        "Listed participant claims"
    );

    json_response(200, &response)
}

fn parse_list_claims_query(query: Option<&str>) -> Result<ListClaimsQuery, lambda_http::Error> {
    let mut listing_id: Option<Uuid> = None;
    let mut request_id: Option<Uuid> = None;
    let mut status: Option<String> = None;
    let mut limit: i64 = 20;
    let mut offset: i64 = 0;

    if let Some(raw_query) = query {
        for pair in raw_query.split('&') {
            if pair.is_empty() {
                continue;
            }

            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));

            match key {
                "listingId" if !value.is_empty() => {
                    listing_id = Some(parse_uuid(value, "listingId")?);
                }
                "requestId" if !value.is_empty() => {
                    request_id = Some(parse_uuid(value, "requestId")?);
                }
                "status" if !value.is_empty() => {
                    if !ALLOWED_CLAIM_STATUSES.contains(&value) {
                        return Err(lambda_http::Error::from(format!(
                            "Invalid claim status filter '{}'. Allowed values: {}",
                            value,
                            ALLOWED_CLAIM_STATUSES.join(", ")
                        )));
                    }
                    status = Some(value.to_string());
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

    Ok(ListClaimsQuery {
        listing_id,
        request_id,
        status,
        limit,
        offset,
    })
}

async fn validate_claim_filter_access(
    client: &Client,
    user_id: Uuid,
    query: &ListClaimsQuery,
) -> Result<(), lambda_http::Error> {
    if let Some(listing_id) = query.listing_id {
        ensure_listing_filter_access(client, listing_id, user_id).await?;
    }

    if let Some(request_id) = query.request_id {
        ensure_request_filter_access(client, request_id, user_id).await?;
    }

    Ok(())
}

async fn ensure_listing_filter_access(
    client: &Client,
    listing_id: Uuid,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let listing_owner = client
        .query_opt(
            "
            select user_id
            from surplus_listings
            where id = $1
              and deleted_at is null
            ",
            &[&listing_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(owner_row) = listing_owner else {
        return Err(lambda_http::Error::from("Listing not found"));
    };

    let listing_owner_id = owner_row.get::<_, Uuid>("user_id");
    let is_claimer = client
        .query_one(
            "
            select exists(
                select 1
                from claims
                where listing_id = $1
                  and claimer_id = $2
            )
            ",
            &[&listing_id, &user_id],
        )
        .await
        .map_err(|error| db_error(&error))?
        .get::<_, bool>(0);

    ensure_listing_scope(listing_owner_id, user_id, is_claimer)
}

async fn ensure_request_filter_access(
    client: &Client,
    request_id: Uuid,
    user_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let request_owner = client
        .query_opt(
            "
            select user_id
            from requests
            where id = $1
              and deleted_at is null
            ",
            &[&request_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(owner_row) = request_owner else {
        return Err(lambda_http::Error::from("Request not found"));
    };

    let request_owner_id = owner_row.get::<_, Uuid>("user_id");
    let is_listing_owner_for_request = client
        .query_one(
            "
            select exists(
                select 1
                from claims c
                inner join surplus_listings l on l.id = c.listing_id
                where c.request_id = $1
                  and l.user_id = $2
                  and l.deleted_at is null
            )
            ",
            &[&request_id, &user_id],
        )
        .await
        .map_err(|error| db_error(&error))?
        .get::<_, bool>(0);

    ensure_request_scope(request_owner_id, user_id, is_listing_owner_for_request)
}

fn ensure_listing_scope(
    listing_owner_id: Uuid,
    user_id: Uuid,
    is_claimer: bool,
) -> Result<(), lambda_http::Error> {
    if listing_owner_id == user_id || is_claimer {
        Ok(())
    } else {
        Err(lambda_http::Error::from(
            "Forbidden: You are not permitted to access claims for this listing",
        ))
    }
}

fn ensure_request_scope(
    request_owner_id: Uuid,
    user_id: Uuid,
    is_listing_owner_for_request: bool,
) -> Result<(), lambda_http::Error> {
    if request_owner_id == user_id || is_listing_owner_for_request {
        Ok(())
    } else {
        Err(lambda_http::Error::from(
            "Forbidden: You are not permitted to access claims for this request",
        ))
    }
}

const fn compute_next_offset(offset: i64, limit: i64, has_more: bool) -> Option<i64> {
    if has_more {
        offset.checked_add(limit)
    } else {
        None
    }
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    Uuid::parse_str(value)
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
}

fn row_to_claim_response(row: &Row) -> ClaimResponse {
    ClaimResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        listing_id: row.get::<_, Uuid>("listing_id").to_string(),
        request_id: row
            .get::<_, Option<Uuid>>("request_id")
            .map(|id| id.to_string()),
        claimer_id: row.get::<_, Uuid>("claimer_id").to_string(),
        listing_owner_id: row.get::<_, Uuid>("listing_owner_id").to_string(),
        quantity_claimed: row.get("quantity_claimed"),
        status: row.get("status"),
        notes: row.get("notes"),
        claimed_at: row.get::<_, DateTime<Utc>>("claimed_at").to_rfc3339(),
        confirmed_at: row
            .get::<_, Option<DateTime<Utc>>>("confirmed_at")
            .map(|value| value.to_rfc3339()),
        completed_at: row
            .get::<_, Option<DateTime<Utc>>>("completed_at")
            .map(|value| value.to_rfc3339()),
        cancelled_at: row
            .get::<_, Option<DateTime<Utc>>>("cancelled_at")
            .map(|value| value.to_rfc3339()),
    }
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}

fn json_response<T: serde::Serialize>(
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

#[allow(dead_code)]
fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(
        status,
        &ErrorResponse {
            error: message.to_string(),
        },
    )
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_list_claims_query_defaults() {
        let parsed = parse_list_claims_query(None).unwrap();
        assert_eq!(parsed.listing_id, None);
        assert_eq!(parsed.request_id, None);
        assert_eq!(parsed.status, None);
        assert_eq!(parsed.limit, 20);
        assert_eq!(parsed.offset, 0);
    }

    #[test]
    fn parse_list_claims_query_with_filters() {
        let parsed = parse_list_claims_query(Some(
            "listingId=5df666d4-f6b1-4e6f-97d6-321e531ad7ca&requestId=3c861fd9-69eb-42f3-ab57-9ef8f85eb6da&status=pending&limit=10&offset=5",
        ))
        .unwrap();

        assert_eq!(
            parsed.listing_id,
            Some(Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap())
        );
        assert_eq!(
            parsed.request_id,
            Some(Uuid::parse_str("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da").unwrap())
        );
        assert_eq!(parsed.status.as_deref(), Some("pending"));
        assert_eq!(parsed.limit, 10);
        assert_eq!(parsed.offset, 5);
    }

    #[test]
    fn parse_list_claims_query_rejects_invalid_status() {
        let result = parse_list_claims_query(Some("status=closed"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid claim status filter"));
    }

    #[test]
    fn parse_list_claims_query_rejects_invalid_listing_id() {
        let result = parse_list_claims_query(Some("listingId=not-a-uuid"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("listingId must be a valid UUID"));
    }

    #[test]
    fn parse_list_claims_query_rejects_limit_out_of_range() {
        let result = parse_list_claims_query(Some("limit=0"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid limit. Must be between 1 and 100"));
    }

    #[test]
    fn parse_list_claims_query_rejects_negative_offset() {
        let result = parse_list_claims_query(Some("offset=-1"));
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid offset. Must be greater than or equal to 0"));
    }

    #[test]
    fn ensure_listing_scope_allows_listing_owner() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let result = ensure_listing_scope(user_id, user_id, false);
        assert!(result.is_ok());
    }

    #[test]
    fn ensure_listing_scope_allows_claimer() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let owner_id = Uuid::parse_str("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da").unwrap();
        let result = ensure_listing_scope(owner_id, user_id, true);
        assert!(result.is_ok());
    }

    #[test]
    fn ensure_listing_scope_rejects_non_participant() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let owner_id = Uuid::parse_str("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da").unwrap();
        let result = ensure_listing_scope(owner_id, user_id, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Forbidden"));
    }

    #[test]
    fn ensure_request_scope_allows_request_owner() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let result = ensure_request_scope(user_id, user_id, false);
        assert!(result.is_ok());
    }

    #[test]
    fn ensure_request_scope_allows_listing_owner_for_request() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let request_owner_id = Uuid::parse_str("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da").unwrap();
        let result = ensure_request_scope(request_owner_id, user_id, true);
        assert!(result.is_ok());
    }

    #[test]
    fn ensure_request_scope_rejects_non_participant() {
        let user_id = Uuid::parse_str("5df666d4-f6b1-4e6f-97d6-321e531ad7ca").unwrap();
        let request_owner_id = Uuid::parse_str("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da").unwrap();
        let result = ensure_request_scope(request_owner_id, user_id, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Forbidden"));
    }

    #[test]
    fn compute_next_offset_returns_some_when_has_more() {
        let next = compute_next_offset(20, 10, true);
        assert_eq!(next, Some(30));
    }

    #[test]
    fn compute_next_offset_returns_none_when_no_more() {
        let next = compute_next_offset(20, 10, false);
        assert_eq!(next, None);
    }

    #[test]
    fn compute_next_offset_returns_none_on_overflow() {
        let next = compute_next_offset(i64::MAX, 1, true);
        assert_eq!(next, None);
    }
}
