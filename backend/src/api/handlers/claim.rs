use crate::auth::{
    extract_auth_context_with_fallback, require_participant_user_type, require_user_type, UserType,
};
use crate::db;
use crate::models::crop::ErrorResponse;
use aws_config::BehaviorVersion;
use aws_sdk_eventbridge::types::PutEventsRequestEntry;
use chrono::{DateTime, Utc};
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use tokio_postgres::{Row, Transaction};
use tracing::{error, info};
use uuid::Uuid;

const ALLOWED_CLAIM_STATUSES: [&str; 5] =
    ["pending", "confirmed", "completed", "cancelled", "no_show"];
const CLAIMABLE_LISTING_STATUSES: [&str; 2] = ["active", "pending"];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateClaimRequest {
    pub listing_id: String,
    pub request_id: Option<String>,
    pub quantity_claimed: f64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionClaimRequest {
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
    pub id: String,
    pub listing_id: String,
    pub request_id: Option<String>,
    pub claimer_id: String,
    pub listing_owner_id: String,
    pub quantity_claimed: String,
    pub status: String,
    pub notes: Option<String>,
    pub claimed_at: String,
    pub confirmed_at: Option<String>,
    pub completed_at: Option<String>,
    pub cancelled_at: Option<String>,
}

#[derive(Debug)]
struct NormalizedCreateClaimInput {
    listing_id: Uuid,
    request_id: Option<Uuid>,
    quantity_claimed: f64,
    notes: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaimStatus {
    Pending,
    Confirmed,
    Completed,
    Cancelled,
    NoShow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaimActorRole {
    Claimer,
    ListingOwner,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ListingQuantityAdjustment {
    None,
    Decrement,
    Increment,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TransitionDecision {
    quantity_adjustment: ListingQuantityAdjustment,
    stamp_confirmed_at: bool,
    stamp_completed_at: bool,
    stamp_cancelled_at: bool,
}

pub async fn create_claim(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_user_type(&auth_context, &UserType::Gatherer)?;

    let claimer_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let payload: CreateClaimRequest = parse_json_body(request)?;
    let normalized = normalize_create_payload(&payload)?;

    let mut client = db::connect().await?;
    let tx = client
        .transaction()
        .await
        .map_err(|error| db_error(&error))?;

    let listing_row = tx
        .query_opt(
            "
            select id, user_id, crop_id, variety_id, status::text as status,
                   quantity_remaining::double precision as quantity_remaining
            from surplus_listings
            where id = $1
              and deleted_at is null
            for update
            ",
            &[&normalized.listing_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(listing) = listing_row else {
        return error_response(404, "Listing not found");
    };

    let listing_owner_id = listing.get::<_, Uuid>("user_id");
    let listing_status: String = listing.get("status");
    let listing_crop_id: Uuid = listing.get("crop_id");

    if !is_claimable_listing_status(&listing_status) {
        return Err(lambda_http::Error::from(
            "Listing is not claimable in its current status",
        ));
    }

    if let Some(quantity_remaining) = listing.get::<_, Option<f64>>("quantity_remaining") {
        if quantity_remaining < normalized.quantity_claimed {
            return error_response(409, "Insufficient quantity remaining");
        }
    }

    if let Some(request_id) = normalized.request_id {
        validate_request_linkage(&tx, request_id, claimer_id, listing_crop_id).await?;
    }

    let claim_row = tx
        .query_one(
            "
            insert into claims
                (listing_id, request_id, claimer_id, quantity_claimed, status, notes)
            values
                ($1, $2, $3, $4::double precision, 'pending'::claim_status, $5)
            returning id, listing_id, request_id, claimer_id,
                      quantity_claimed::text as quantity_claimed,
                      status::text as status, notes,
                      claimed_at, confirmed_at, completed_at, cancelled_at
            ",
            &[
                &normalized.listing_id,
                &normalized.request_id,
                &claimer_id,
                &normalized.quantity_claimed,
                &normalized.notes,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    adjust_listing_quantity_if_needed(
        &tx,
        normalized.listing_id,
        normalized.quantity_claimed,
        ListingQuantityAdjustment::Decrement,
    )
    .await?;

    tx.commit().await.map_err(|error| db_error(&error))?;

    let response = row_to_claim_response(&claim_row, listing_owner_id);
    emit_claim_event_best_effort("claim.created", &response, correlation_id).await;

    info!(
        correlation_id = correlation_id,
        claim_id = response.id.as_str(),
        listing_id = response.listing_id.as_str(),
        claimer_id = response.claimer_id.as_str(),
        "Created claim in pending state"
    );

    json_response(201, &response)
}

pub async fn transition_claim(
    request: &Request,
    correlation_id: &str,
    claim_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let auth_context = extract_auth_context_with_fallback(request).await?;
    require_claim_transition_user_type(auth_context.user_type.as_ref())?;

    let actor_user_id = Uuid::parse_str(&auth_context.user_id)
        .map_err(|_| lambda_http::Error::from("Invalid user ID format"))?;
    let id = parse_uuid(claim_id, "claimId")?;

    let payload: TransitionClaimRequest = parse_json_body(request)?;
    let target_status = parse_claim_status(&payload.status)?;
    let notes = normalize_optional_text(payload.notes.as_deref());

    let mut client = db::connect().await?;
    let tx = client
        .transaction()
        .await
        .map_err(|error| db_error(&error))?;

    let claim_context_row = tx
        .query_opt(
            "
            select c.id, c.listing_id, c.request_id, c.claimer_id,
                   c.quantity_claimed::double precision as quantity_claimed_value,
                   c.quantity_claimed::text as quantity_claimed,
                   c.status::text as status, c.notes,
                   c.claimed_at, c.confirmed_at, c.completed_at, c.cancelled_at,
                   l.user_id as listing_owner_id
            from claims c
            inner join surplus_listings l on l.id = c.listing_id
            where c.id = $1
              and l.deleted_at is null
            for update of c, l
            ",
            &[&id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(claim_context) = claim_context_row else {
        return error_response(404, "Claim not found");
    };

    let current_status = parse_claim_status(&claim_context.get::<_, String>("status"))?;
    let claimer_id: Uuid = claim_context.get("claimer_id");
    let listing_owner_id: Uuid = claim_context.get("listing_owner_id");
    let listing_id: Uuid = claim_context.get("listing_id");
    let quantity_claimed: f64 = claim_context.get("quantity_claimed_value");

    let actor_role = determine_actor_role(actor_user_id, claimer_id, listing_owner_id)?;
    let decision = evaluate_transition(current_status, target_status, actor_role)?;

    adjust_listing_quantity_if_needed(
        &tx,
        listing_id,
        quantity_claimed,
        decision.quantity_adjustment,
    )
    .await?;

    let updated_claim = tx
        .query_one(
            "
            update claims
            set status = $1::claim_status,
                notes = coalesce($2, notes),
                confirmed_at = case
                    when $3 then coalesce(confirmed_at, now())
                    else confirmed_at
                end,
                completed_at = case
                    when $4 then coalesce(completed_at, now())
                    else completed_at
                end,
                cancelled_at = case
                    when $5 then coalesce(cancelled_at, now())
                    else cancelled_at
                end
            where id = $6
            returning id, listing_id, request_id, claimer_id,
                      quantity_claimed::text as quantity_claimed,
                      status::text as status, notes,
                      claimed_at, confirmed_at, completed_at, cancelled_at
            ",
            &[
                &target_status.as_db_value(),
                &notes,
                &decision.stamp_confirmed_at,
                &decision.stamp_completed_at,
                &decision.stamp_cancelled_at,
                &id,
            ],
        )
        .await
        .map_err(|error| db_error(&error))?;

    tx.commit().await.map_err(|error| db_error(&error))?;

    let response = row_to_claim_response(&updated_claim, listing_owner_id);
    emit_claim_event_best_effort("claim.updated", &response, correlation_id).await;

    info!(
        correlation_id = correlation_id,
        claim_id = response.id.as_str(),
        actor_user_id = auth_context.user_id.as_str(),
        previous_status = current_status.as_db_value(),
        new_status = response.status.as_str(),
        "Updated claim state"
    );

    json_response(200, &response)
}

fn normalize_create_payload(
    payload: &CreateClaimRequest,
) -> Result<NormalizedCreateClaimInput, lambda_http::Error> {
    if payload.quantity_claimed <= 0.0 {
        return Err(lambda_http::Error::from(
            "quantityClaimed must be greater than 0",
        ));
    }

    Ok(NormalizedCreateClaimInput {
        listing_id: parse_uuid(&payload.listing_id, "listingId")?,
        request_id: parse_optional_uuid(payload.request_id.as_deref(), "requestId")?,
        quantity_claimed: payload.quantity_claimed,
        notes: normalize_optional_text(payload.notes.as_deref()),
    })
}

async fn validate_request_linkage(
    tx: &Transaction<'_>,
    request_id: Uuid,
    claimer_id: Uuid,
    listing_crop_id: Uuid,
) -> Result<(), lambda_http::Error> {
    let request_row = tx
        .query_opt(
            "
            select user_id, crop_id, status::text as status
            from requests
            where id = $1
              and deleted_at is null
            ",
            &[&request_id],
        )
        .await
        .map_err(|error| db_error(&error))?;

    let Some(request) = request_row else {
        return Err(lambda_http::Error::from("Request not found"));
    };

    let request_owner_id: Uuid = request.get("user_id");
    let request_crop_id: Uuid = request.get("crop_id");
    let request_status: String = request.get("status");

    if request_owner_id != claimer_id {
        return Err(lambda_http::Error::from(
            "Forbidden: requestId must belong to the claimer",
        ));
    }

    if !is_linkable_request_status(&request_status) {
        return Err(lambda_http::Error::from(
            "requestId must reference an open request",
        ));
    }

    if request_crop_id != listing_crop_id {
        return Err(lambda_http::Error::from(
            "requestId crop must match listing crop",
        ));
    }

    Ok(())
}

fn determine_actor_role(
    actor_user_id: Uuid,
    claimer_id: Uuid,
    listing_owner_id: Uuid,
) -> Result<ClaimActorRole, lambda_http::Error> {
    if actor_user_id == claimer_id {
        return Ok(ClaimActorRole::Claimer);
    }

    if actor_user_id == listing_owner_id {
        return Ok(ClaimActorRole::ListingOwner);
    }

    Err(lambda_http::Error::from(
        "Forbidden: You are not a participant in this claim",
    ))
}

fn evaluate_transition(
    current: ClaimStatus,
    target: ClaimStatus,
    actor_role: ClaimActorRole,
) -> Result<TransitionDecision, lambda_http::Error> {
    if current == target {
        return Ok(TransitionDecision {
            quantity_adjustment: ListingQuantityAdjustment::None,
            stamp_confirmed_at: false,
            stamp_completed_at: false,
            stamp_cancelled_at: false,
        });
    }

    match (current, target) {
        (ClaimStatus::Pending, ClaimStatus::Confirmed) => {
            if actor_role != ClaimActorRole::ListingOwner {
                return Err(lambda_http::Error::from(
                    "Forbidden: Only listing owner can confirm a pending claim",
                ));
            }
            Ok(TransitionDecision {
                quantity_adjustment: ListingQuantityAdjustment::Decrement,
                stamp_confirmed_at: true,
                stamp_completed_at: false,
                stamp_cancelled_at: false,
            })
        }
        (ClaimStatus::Pending, ClaimStatus::Cancelled) => Ok(TransitionDecision {
            quantity_adjustment: ListingQuantityAdjustment::None,
            stamp_confirmed_at: false,
            stamp_completed_at: false,
            stamp_cancelled_at: true,
        }),
        (ClaimStatus::Confirmed, ClaimStatus::Completed) => Ok(TransitionDecision {
            quantity_adjustment: ListingQuantityAdjustment::None,
            stamp_confirmed_at: false,
            stamp_completed_at: true,
            stamp_cancelled_at: false,
        }),
        (ClaimStatus::Confirmed, ClaimStatus::Cancelled) => Ok(TransitionDecision {
            quantity_adjustment: ListingQuantityAdjustment::Increment,
            stamp_confirmed_at: false,
            stamp_completed_at: false,
            stamp_cancelled_at: true,
        }),
        (ClaimStatus::Confirmed, ClaimStatus::NoShow) => {
            if actor_role != ClaimActorRole::ListingOwner {
                return Err(lambda_http::Error::from(
                    "Forbidden: Only listing owner can mark no_show",
                ));
            }

            Ok(TransitionDecision {
                quantity_adjustment: ListingQuantityAdjustment::Increment,
                stamp_confirmed_at: false,
                stamp_completed_at: false,
                stamp_cancelled_at: true,
            })
        }
        _ => Err(lambda_http::Error::from(format!(
            "Invalid claim transition from '{}' to '{}'",
            current.as_db_value(),
            target.as_db_value()
        ))),
    }
}

async fn adjust_listing_quantity_if_needed(
    tx: &Transaction<'_>,
    listing_id: Uuid,
    quantity_claimed: f64,
    adjustment: ListingQuantityAdjustment,
) -> Result<(), lambda_http::Error> {
    match adjustment {
        ListingQuantityAdjustment::None => Ok(()),
        ListingQuantityAdjustment::Decrement => {
            let updated_rows = tx
                .execute(
                    "
                    update surplus_listings
                    set quantity_remaining = case
                            when quantity_remaining is null then null
                            else quantity_remaining - $1
                        end,
                        status = case
                            when quantity_remaining is not null and quantity_remaining - $1 <= 0
                                then 'claimed'::listing_status
                            else status
                        end
                    where id = $2
                      and deleted_at is null
                      and (quantity_remaining is null or quantity_remaining >= $1)
                    ",
                    &[&quantity_claimed, &listing_id],
                )
                .await
                .map_err(|error| db_error(&error))?;

            if updated_rows == 0 {
                return Err(lambda_http::Error::from("Insufficient quantity remaining"));
            }

            Ok(())
        }
        ListingQuantityAdjustment::Increment => {
            tx.execute(
                "
                update surplus_listings
                set quantity_remaining = case
                        when quantity_remaining is null then null
                        else quantity_remaining + $1
                    end,
                    status = case
                        when status = 'claimed'::listing_status then 'active'::listing_status
                        else status
                    end
                where id = $2
                  and deleted_at is null
                ",
                &[&quantity_claimed, &listing_id],
            )
            .await
            .map_err(|error| db_error(&error))?;

            Ok(())
        }
    }
}

fn require_claim_transition_user_type(
    user_type: Option<&UserType>,
) -> Result<(), lambda_http::Error> {
    require_participant_user_type(user_type)
}

fn is_claimable_listing_status(status: &str) -> bool {
    CLAIMABLE_LISTING_STATUSES.contains(&status)
}

fn is_linkable_request_status(status: &str) -> bool {
    status == "open"
}

fn parse_claim_status(value: &str) -> Result<ClaimStatus, lambda_http::Error> {
    match value {
        "pending" => Ok(ClaimStatus::Pending),
        "confirmed" => Ok(ClaimStatus::Confirmed),
        "completed" => Ok(ClaimStatus::Completed),
        "cancelled" => Ok(ClaimStatus::Cancelled),
        "no_show" => Ok(ClaimStatus::NoShow),
        _ => Err(lambda_http::Error::from(format!(
            "Invalid claim status '{}'. Allowed values: {}",
            value,
            ALLOWED_CLAIM_STATUSES.join(", ")
        ))),
    }
}

impl ClaimStatus {
    const fn as_db_value(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Confirmed => "confirmed",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::NoShow => "no_show",
        }
    }
}

fn parse_uuid(value: &str, field_name: &str) -> Result<Uuid, lambda_http::Error> {
    Uuid::parse_str(value)
        .map_err(|_| lambda_http::Error::from(format!("{field_name} must be a valid UUID")))
}

fn parse_optional_uuid(
    value: Option<&str>,
    field_name: &str,
) -> Result<Option<Uuid>, lambda_http::Error> {
    value.map_or(Ok(None), |v| parse_uuid(v, field_name).map(Some))
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

fn normalize_optional_text(value: Option<&str>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn row_to_claim_response(row: &Row, listing_owner_id: Uuid) -> ClaimResponse {
    ClaimResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        listing_id: row.get::<_, Uuid>("listing_id").to_string(),
        request_id: row
            .get::<_, Option<Uuid>>("request_id")
            .map(|id| id.to_string()),
        claimer_id: row.get::<_, Uuid>("claimer_id").to_string(),
        listing_owner_id: listing_owner_id.to_string(),
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

async fn emit_claim_event(
    detail_type: &str,
    claim: &ClaimResponse,
    correlation_id: &str,
) -> Result<(), lambda_http::Error> {
    let event_bus_name = std::env::var("EVENT_BUS_NAME").unwrap_or_else(|_| "default".to_string());

    let detail = serde_json::json!({
        "claimId": claim.id,
        "listingId": claim.listing_id,
        "requestId": claim.request_id,
        "claimerId": claim.claimer_id,
        "listingOwnerId": claim.listing_owner_id,
        "status": claim.status,
        "correlationId": correlation_id,
        "occurredAt": Utc::now().to_rfc3339(),
    });

    let config = aws_config::defaults(BehaviorVersion::latest()).load().await;
    let client = aws_sdk_eventbridge::Client::new(&config);

    let entry = PutEventsRequestEntry::builder()
        .event_bus_name(event_bus_name)
        .source("community-garden.api")
        .detail_type(detail_type)
        .detail(detail.to_string())
        .build();

    let response = client
        .put_events()
        .entries(entry)
        .send()
        .await
        .map_err(|e| lambda_http::Error::from(format!("Failed to emit claim event: {e}")))?;

    if response.failed_entry_count() > 0 {
        return Err(lambda_http::Error::from(
            "Failed to emit claim event: one or more entries were rejected",
        ));
    }

    Ok(())
}

async fn emit_claim_event_best_effort(
    detail_type: &str,
    claim: &ClaimResponse,
    correlation_id: &str,
) {
    if let Err(event_error) = emit_claim_event(detail_type, claim, correlation_id).await {
        error!(
            correlation_id = correlation_id,
            claim_id = claim.id.as_str(),
            detail_type = detail_type,
            error = %event_error,
            "Failed to emit claim event after successful write"
        );
    }
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
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

pub fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
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

    fn valid_create_payload() -> CreateClaimRequest {
        CreateClaimRequest {
            listing_id: "5df666d4-f6b1-4e6f-97d6-321e531ad7ca".to_string(),
            request_id: Some("3c861fd9-69eb-42f3-ab57-9ef8f85eb6da".to_string()),
            quantity_claimed: 3.5,
            notes: Some("Can pick up tomorrow".to_string()),
        }
    }

    #[test]
    fn normalize_create_payload_accepts_valid_input() {
        let normalized = normalize_create_payload(&valid_create_payload()).unwrap();
        assert!((normalized.quantity_claimed - 3.5).abs() < f64::EPSILON);
        assert!(normalized.request_id.is_some());
        assert_eq!(normalized.notes.as_deref(), Some("Can pick up tomorrow"));
    }

    #[test]
    fn normalize_create_payload_rejects_non_positive_quantity() {
        let mut payload = valid_create_payload();
        payload.quantity_claimed = 0.0;
        let result = normalize_create_payload(&payload);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("quantityClaimed"));
    }

    #[test]
    fn normalize_create_payload_trims_blank_notes() {
        let mut payload = valid_create_payload();
        payload.notes = Some("   ".to_string());
        let normalized = normalize_create_payload(&payload).unwrap();
        assert_eq!(normalized.notes, None);
    }

    #[test]
    fn require_claim_transition_user_type_accepts_grower_and_gatherer() {
        assert!(require_claim_transition_user_type(Some(&UserType::Grower)).is_ok());
        assert!(require_claim_transition_user_type(Some(&UserType::Gatherer)).is_ok());
    }

    #[test]
    fn require_claim_transition_user_type_rejects_missing_type() {
        let result = require_claim_transition_user_type(None);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("User type not set"));
    }

    #[test]
    fn is_claimable_listing_status_rejects_claimed() {
        assert!(is_claimable_listing_status("active"));
        assert!(is_claimable_listing_status("pending"));
        assert!(!is_claimable_listing_status("claimed"));
    }

    #[test]
    fn is_linkable_request_status_requires_open() {
        assert!(is_linkable_request_status("open"));
        assert!(!is_linkable_request_status("matched"));
        assert!(!is_linkable_request_status("closed"));
    }

    #[test]
    fn parse_claim_status_accepts_valid_values() {
        assert_eq!(parse_claim_status("pending").unwrap(), ClaimStatus::Pending);
        assert_eq!(
            parse_claim_status("confirmed").unwrap(),
            ClaimStatus::Confirmed
        );
        assert_eq!(
            parse_claim_status("completed").unwrap(),
            ClaimStatus::Completed
        );
        assert_eq!(
            parse_claim_status("cancelled").unwrap(),
            ClaimStatus::Cancelled
        );
        assert_eq!(parse_claim_status("no_show").unwrap(), ClaimStatus::NoShow);
    }

    #[test]
    fn parse_claim_status_rejects_invalid_values() {
        let result = parse_claim_status("closed");
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Invalid claim status"));
    }

    #[test]
    fn determine_actor_role_identifies_claimer() {
        let actor = Uuid::parse_str("6b7a6e9d-e31d-4ac2-b688-15f0490adf9b").unwrap();
        let owner = Uuid::parse_str("b630af9b-6de5-44cd-9d83-d37df86ce2ef").unwrap();
        let role = determine_actor_role(actor, actor, owner).unwrap();
        assert_eq!(role, ClaimActorRole::Claimer);
    }

    #[test]
    fn determine_actor_role_identifies_listing_owner() {
        let claimer = Uuid::parse_str("6b7a6e9d-e31d-4ac2-b688-15f0490adf9b").unwrap();
        let owner = Uuid::parse_str("b630af9b-6de5-44cd-9d83-d37df86ce2ef").unwrap();
        let role = determine_actor_role(owner, claimer, owner).unwrap();
        assert_eq!(role, ClaimActorRole::ListingOwner);
    }

    #[test]
    fn determine_actor_role_rejects_non_participants() {
        let actor = Uuid::parse_str("d6d8958f-bfd8-4a9a-a18f-793fbe6746d5").unwrap();
        let claimer = Uuid::parse_str("6b7a6e9d-e31d-4ac2-b688-15f0490adf9b").unwrap();
        let owner = Uuid::parse_str("b630af9b-6de5-44cd-9d83-d37df86ce2ef").unwrap();
        let result = determine_actor_role(actor, claimer, owner);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Forbidden"));
    }

    #[test]
    fn evaluate_transition_allows_pending_to_confirmed_for_listing_owner() {
        let result = evaluate_transition(
            ClaimStatus::Pending,
            ClaimStatus::Confirmed,
            ClaimActorRole::ListingOwner,
        )
        .unwrap();

        assert_eq!(
            result.quantity_adjustment,
            ListingQuantityAdjustment::Decrement
        );
        assert!(result.stamp_confirmed_at);
        assert!(!result.stamp_completed_at);
        assert!(!result.stamp_cancelled_at);
    }

    #[test]
    fn evaluate_transition_rejects_pending_to_confirmed_for_claimer() {
        let result = evaluate_transition(
            ClaimStatus::Pending,
            ClaimStatus::Confirmed,
            ClaimActorRole::Claimer,
        );

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Only listing owner"));
    }

    #[test]
    fn evaluate_transition_allows_pending_to_cancelled_for_both_participants() {
        let claimer_result = evaluate_transition(
            ClaimStatus::Pending,
            ClaimStatus::Cancelled,
            ClaimActorRole::Claimer,
        )
        .unwrap();

        let owner_result = evaluate_transition(
            ClaimStatus::Pending,
            ClaimStatus::Cancelled,
            ClaimActorRole::ListingOwner,
        )
        .unwrap();

        assert_eq!(
            claimer_result.quantity_adjustment,
            ListingQuantityAdjustment::None
        );
        assert_eq!(
            owner_result.quantity_adjustment,
            ListingQuantityAdjustment::None
        );
        assert!(claimer_result.stamp_cancelled_at);
        assert!(owner_result.stamp_cancelled_at);
    }

    #[test]
    fn evaluate_transition_allows_confirmed_to_completed_for_participants() {
        let claimer_result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::Completed,
            ClaimActorRole::Claimer,
        )
        .unwrap();

        let owner_result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::Completed,
            ClaimActorRole::ListingOwner,
        )
        .unwrap();

        assert!(claimer_result.stamp_completed_at);
        assert!(owner_result.stamp_completed_at);
        assert_eq!(
            claimer_result.quantity_adjustment,
            ListingQuantityAdjustment::None
        );
    }

    #[test]
    fn evaluate_transition_allows_confirmed_to_cancelled_and_restores_quantity() {
        let result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::Cancelled,
            ClaimActorRole::Claimer,
        )
        .unwrap();

        assert_eq!(
            result.quantity_adjustment,
            ListingQuantityAdjustment::Increment
        );
        assert!(result.stamp_cancelled_at);
    }

    #[test]
    fn evaluate_transition_allows_confirmed_to_no_show_for_listing_owner_only() {
        let owner_result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::NoShow,
            ClaimActorRole::ListingOwner,
        )
        .unwrap();

        let claimer_result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::NoShow,
            ClaimActorRole::Claimer,
        );

        assert_eq!(
            owner_result.quantity_adjustment,
            ListingQuantityAdjustment::Increment
        );
        assert!(claimer_result.is_err());
        assert!(claimer_result
            .unwrap_err()
            .to_string()
            .contains("Only listing owner"));
    }

    #[test]
    fn evaluate_transition_rejects_invalid_paths() {
        let invalid_paths = vec![
            (ClaimStatus::Pending, ClaimStatus::Completed),
            (ClaimStatus::Pending, ClaimStatus::NoShow),
            (ClaimStatus::Completed, ClaimStatus::Cancelled),
            (ClaimStatus::Cancelled, ClaimStatus::Confirmed),
            (ClaimStatus::NoShow, ClaimStatus::Completed),
        ];

        for (current, target) in invalid_paths {
            let result = evaluate_transition(current, target, ClaimActorRole::ListingOwner);
            assert!(result.is_err());
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("Invalid claim transition"));
        }
    }

    #[test]
    fn evaluate_transition_allows_same_status_as_idempotent() {
        let result = evaluate_transition(
            ClaimStatus::Confirmed,
            ClaimStatus::Confirmed,
            ClaimActorRole::ListingOwner,
        )
        .unwrap();

        assert_eq!(result.quantity_adjustment, ListingQuantityAdjustment::None);
        assert!(!result.stamp_confirmed_at);
        assert!(!result.stamp_completed_at);
        assert!(!result.stamp_cancelled_at);
    }
}
