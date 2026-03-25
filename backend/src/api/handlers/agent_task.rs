use crate::auth::extract_auth_context;
use crate::db;
use crate::middleware::entitlements;
use lambda_http::{Body, Request, Response};
use serde::{Deserialize, Serialize};
use tokio_postgres::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentTaskRequest {
    pub name: String,
    pub schedule_cron: String,
    pub instruction: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgentTaskStatusRequest {
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskResponse {
    pub id: String,
    pub name: String,
    pub schedule_cron: String,
    pub instruction: String,
    pub status: String,
    pub last_run_at: Option<String>,
    pub next_run_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskListResponse {
    pub items: Vec<AgentTaskResponse>,
}

pub async fn list_agent_tasks(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let client = db::connect().await?;
    if let Err(feature_locked) = require_premium_automation(&client, user_id).await {
        return json_response(403, &feature_locked.to_response());
    }

    let rows = client
        .query(
            "
            select id, name, schedule_cron, instruction, status, last_run_at, next_run_at, created_at
              from agent_tasks
             where user_id = $1 and deleted_at is null
             order by created_at desc
            ",
            &[&user_id],
        )
        .await
        .map_err(|e| db_error(&e))?;

    tracing::info!(correlation_id = correlation_id, user_id = %user_id, count = rows.len(), "Listed agent tasks");

    json_response(
        200,
        &AgentTaskListResponse {
            items: rows.iter().map(row_to_response).collect(),
        },
    )
}

pub async fn create_agent_task(
    request: &Request,
    correlation_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let payload: CreateAgentTaskRequest = parse_json_body(request)?;
    let client = db::connect().await?;
    if let Err(feature_locked) = require_premium_automation(&client, user_id).await {
        return json_response(403, &feature_locked.to_response());
    }

    if payload.name.trim().is_empty() || payload.instruction.trim().is_empty() {
        return error_response(400, "name and instruction are required");
    }

    if payload.schedule_cron.split_whitespace().count() < 5 {
        return error_response(400, "scheduleCron must look like a cron expression");
    }

    let row = client
        .query_one(
            "
            insert into agent_tasks (user_id, name, schedule_cron, instruction, status)
            values ($1, $2, $3, $4, 'active')
            returning id, name, schedule_cron, instruction, status, last_run_at, next_run_at, created_at
            ",
            &[
                &user_id,
                &payload.name.trim(),
                &payload.schedule_cron.trim(),
                &payload.instruction.trim(),
            ],
        )
        .await
        .map_err(|e| db_error(&e))?;

    tracing::info!(
        correlation_id = correlation_id,
        user_id = %user_id,
        task_id = %row.get::<_, Uuid>("id"),
        "Created premium agent task"
    );

    json_response(201, &row_to_response(&row))
}

pub async fn update_agent_task_status(
    request: &Request,
    correlation_id: &str,
    task_id: &str,
) -> Result<Response<Body>, lambda_http::Error> {
    let user_id = extract_user_id(request)?;
    let task_uuid = Uuid::parse_str(task_id)
        .map_err(|_| lambda_http::Error::from("taskId must be a valid UUID"))?;
    let payload: UpdateAgentTaskStatusRequest = parse_json_body(request)?;
    let client = db::connect().await?;
    if let Err(feature_locked) = require_premium_automation(&client, user_id).await {
        return json_response(403, &feature_locked.to_response());
    }

    if !matches!(payload.status.as_str(), "active" | "paused") {
        return error_response(400, "status must be active or paused");
    }

    let row = client
        .query_opt(
            "
            update agent_tasks
               set status = $3,
                   updated_at = now()
             where id = $1 and user_id = $2 and deleted_at is null
             returning id, name, schedule_cron, instruction, status, last_run_at, next_run_at, created_at
            ",
            &[&task_uuid, &user_id, &payload.status],
        )
        .await
        .map_err(|e| db_error(&e))?;

    let Some(row) = row else {
        return error_response(404, "Agent task not found");
    };

    tracing::info!(correlation_id = correlation_id, user_id = %user_id, task_id = task_id, status = payload.status, "Updated agent task status");

    json_response(200, &row_to_response(&row))
}

fn row_to_response(row: &Row) -> AgentTaskResponse {
    AgentTaskResponse {
        id: row.get::<_, Uuid>("id").to_string(),
        name: row.get("name"),
        schedule_cron: row.get("schedule_cron"),
        instruction: row.get("instruction"),
        status: row.get("status"),
        last_run_at: row
            .get::<_, Option<chrono::DateTime<chrono::Utc>>>("last_run_at")
            .map(|v| v.to_rfc3339()),
        next_run_at: row
            .get::<_, Option<chrono::DateTime<chrono::Utc>>>("next_run_at")
            .map(|v| v.to_rfc3339()),
        created_at: row
            .get::<_, chrono::DateTime<chrono::Utc>>("created_at")
            .to_rfc3339(),
    }
}

async fn require_premium_automation(
    client: &tokio_postgres::Client,
    user_id: Uuid,
) -> Result<(), entitlements::FeatureLockedError> {
    entitlements::require_entitlement(client, user_id, "agent.tasks.automation").await
}

fn extract_user_id(request: &Request) -> Result<Uuid, lambda_http::Error> {
    let auth = extract_auth_context(request)?;
    Uuid::parse_str(&auth.user_id).map_err(|_| lambda_http::Error::from("Invalid user ID format"))
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

fn error_response(status: u16, message: &str) -> Result<Response<Body>, lambda_http::Error> {
    json_response(status, &serde_json::json!({ "error": message }))
}

fn db_error(error: &tokio_postgres::Error) -> lambda_http::Error {
    lambda_http::Error::from(format!("Database query error: {error}"))
}
