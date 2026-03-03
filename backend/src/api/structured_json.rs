use crate::handlers::ai_copilot::{WeeklyPlanRecommendation, WeeklyPlanResponse};

pub fn validate_weekly_plan_response(payload: &WeeklyPlanResponse) -> Result<(), String> {
    if payload.geo_key.trim().is_empty() {
        return Err("geoKey is required".to_string());
    }

    if ![7, 14, 30].contains(&payload.window_days) {
        return Err("windowDays must be one of 7, 14, 30".to_string());
    }

    if payload.recommendations.is_empty() {
        return Err("recommendations must contain at least one item".to_string());
    }

    for rec in &payload.recommendations {
        validate_weekly_plan_recommendation(rec)?;
    }

    Ok(())
}

fn validate_weekly_plan_recommendation(rec: &WeeklyPlanRecommendation) -> Result<(), String> {
    if rec.recommendation.trim().is_empty() {
        return Err("recommendation text is required".to_string());
    }

    if !(0.0..=1.0).contains(&rec.confidence) {
        return Err("confidence must be within [0.0, 1.0]".to_string());
    }

    if rec.rationale.is_empty() {
        return Err("rationale must contain at least one entry".to_string());
    }

    if rec.rationale.iter().any(|r| r.trim().is_empty()) {
        return Err("rationale entries must be non-empty".to_string());
    }

    Ok(())
}
