use crate::ai_model_config;
use crate::models::feed::DerivedFeedSignal;
use chrono::{Duration, Utc};

#[derive(Debug, Clone)]
pub struct SummaryArtifact {
    pub summary_text: String,
    pub model_id: String,
    pub model_version: String,
    pub generated_at: chrono::DateTime<Utc>,
    pub expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub enum SummaryProvider {
    Bedrock,
    Mock,
}

#[derive(Debug, Clone)]
pub struct SummaryGenerator {
    provider: SummaryProvider,
}

impl SummaryGenerator {
    pub fn from_env() -> Self {
        let provider = match std::env::var("AI_SUMMARY_PROVIDER") {
            Ok(value) if value.eq_ignore_ascii_case("mock") => SummaryProvider::Mock,
            _ => SummaryProvider::Bedrock,
        };

        Self { provider }
    }

    pub fn generate(
        &self,
        geo_boundary_key: &str,
        window_days: i32,
        signals: &[DerivedFeedSignal],
    ) -> Result<SummaryArtifact, lambda_http::Error> {
        match self.provider {
            SummaryProvider::Mock => Ok(mock_generate(geo_boundary_key, window_days, signals)),
            SummaryProvider::Bedrock => {
                // Bedrock integration is intentionally behind this abstraction.
                // If unavailable or failing, callers should degrade gracefully.
                bedrock_generate(geo_boundary_key, window_days, signals)
            }
        }
    }
}

fn mock_generate(
    geo_boundary_key: &str,
    window_days: i32,
    signals: &[DerivedFeedSignal],
) -> SummaryArtifact {
    let strongest = signals
        .iter()
        .max_by(|a, b| a.scarcity_score.total_cmp(&b.scarcity_score));

    let summary_text = strongest.map_or_else(
        || {
            format!(
                "Derived signal summary for {geo_boundary_key} ({window_days}d): no signal rows available."
            )
        },
        |top| {
            format!(
                "Derived signal summary for {geo_boundary_key} ({window_days}d): {} listings, {} requests, scarcity {:.2}, abundance {:.2}.",
                top.listing_count, top.request_count, top.scarcity_score, top.abundance_score
            )
        },
    );

    let generated_at = Utc::now();
    SummaryArtifact {
        summary_text,
        model_id: "mock.derived-signal-summarizer".to_string(),
        model_version: "v1".to_string(),
        generated_at,
        expires_at: generated_at + Duration::hours(6),
    }
}

fn bedrock_generate(
    geo_boundary_key: &str,
    window_days: i32,
    signals: &[DerivedFeedSignal],
) -> Result<SummaryArtifact, lambda_http::Error> {
    // Keep runtime safe by requiring explicit enablement.
    if std::env::var("BEDROCK_SUMMARY_ENABLED").map_or(true, |value| value != "1") {
        return Err(lambda_http::Error::from(
            "Bedrock summarization disabled by configuration".to_string(),
        ));
    }

    // Placeholder message that still persists model metadata for traceability when enabled later.
    let generated_at = Utc::now();
    let summary_text = format!(
        "AI summary pending full Bedrock wiring for {geo_boundary_key} ({window_days}d) across {} rows.",
        signals.len()
    );

    let model_cfg = ai_model_config::load_model_config();

    Ok(SummaryArtifact {
        summary_text,
        model_id: model_cfg.model_id,
        model_version: format!("{}-{}", model_cfg.response_mode, model_cfg.schema_version),
        generated_at,
        expires_at: generated_at + Duration::hours(6),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn mock_generator_emits_traceable_metadata() {
        std::env::set_var("AI_SUMMARY_PROVIDER", "mock");
        let generator = SummaryGenerator::from_env();
        let artifact = generator.generate("9q8y", 7, &[]).unwrap();

        assert_eq!(artifact.model_id, "mock.derived-signal-summarizer");
        assert_eq!(artifact.model_version, "v1");
        assert!(artifact.expires_at > artifact.generated_at);
    }
}
