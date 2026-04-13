use crate::handlers::ai_copilot::{WeeklyPlanRecommendation, WeeklyPlanResponse};

pub enum ValidationResult {
    Valid,
    Repaired(WeeklyPlanResponse),
}

pub fn validate_or_repair_weekly_plan_response(
    payload: &WeeklyPlanResponse,
) -> Result<ValidationResult, String> {
    if validate_weekly_plan_response(payload).is_ok() {
        return Ok(ValidationResult::Valid);
    }

    let repaired = repair_weekly_plan_response(payload);
    validate_weekly_plan_response(&repaired).map(|()| ValidationResult::Repaired(repaired))
}

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

fn repair_weekly_plan_response(payload: &WeeklyPlanResponse) -> WeeklyPlanResponse {
    let recommendations = if payload.recommendations.is_empty() {
        vec![WeeklyPlanRecommendation {
            recommendation: "Fallback recommendation generated due to schema normalization."
                .to_string(),
            confidence: 0.4,
            rationale: vec!["Normalized to match weekly plan schema contract.".to_string()],
        }]
    } else {
        payload
            .recommendations
            .iter()
            .map(|rec| WeeklyPlanRecommendation {
                recommendation: normalize_recommendation_text(&rec.recommendation),
                confidence: rec.confidence.clamp(0.0, 1.0),
                rationale: normalize_rationale(&rec.rationale),
            })
            .collect()
    };

    WeeklyPlanResponse {
        model_id: payload.model_id.clone(),
        model_version: payload.model_version.clone(),
        structured_json: payload.structured_json,
        geo_key: if payload.geo_key.trim().is_empty() {
            "9v00".to_string()
        } else {
            payload.geo_key.trim().to_ascii_lowercase()
        },
        window_days: if [7, 14, 30].contains(&payload.window_days) {
            payload.window_days
        } else {
            7
        },
        recommendations,
    }
}

fn normalize_recommendation_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        "Fallback recommendation generated due to schema normalization.".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_rationale(rationale: &[String]) -> Vec<String> {
    let cleaned: Vec<String> = rationale
        .iter()
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
        .collect();

    if cleaned.is_empty() {
        vec!["Normalized rationale to satisfy structured JSON schema.".to_string()]
    } else {
        cleaned
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn invalid_payload() -> WeeklyPlanResponse {
        WeeklyPlanResponse {
            model_id: "m1".to_string(),
            model_version: "tool_first_json-v1".to_string(),
            structured_json: true,
            geo_key: "  ".to_string(),
            window_days: 999,
            recommendations: vec![WeeklyPlanRecommendation {
                recommendation: "  ".to_string(),
                confidence: 2.5,
                rationale: vec!["  ".to_string()],
            }],
        }
    }

    #[test]
    fn repair_path_returns_valid_payload() {
        let payload = invalid_payload();
        let result = validate_or_repair_weekly_plan_response(&payload);
        assert!(matches!(result, Ok(ValidationResult::Repaired(_))));

        if let Ok(ValidationResult::Repaired(repaired)) = result {
            assert!(validate_weekly_plan_response(&repaired).is_ok());
            assert_eq!(repaired.window_days, 7);
        }
    }
}
