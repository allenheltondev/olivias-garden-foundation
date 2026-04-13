use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfig {
    pub provider: String,
    pub model_id: String,
    pub fallback_model_id: String,
    pub region: String,
    pub response_mode: String,
    pub schema_version: String,
}

pub fn load_model_config() -> AiModelConfig {
    AiModelConfig {
        provider: std::env::var("AI_PROVIDER").unwrap_or_else(|_| "bedrock".to_string()),
        model_id: std::env::var("BEDROCK_MODEL_PRIMARY")
            .or_else(|_| std::env::var("BEDROCK_MODEL_ID"))
            .unwrap_or_else(|_| "amazon.nova-lite-v1:0".to_string()),
        fallback_model_id: std::env::var("BEDROCK_MODEL_FALLBACK")
            .unwrap_or_else(|_| "amazon.nova-micro-v1:0".to_string()),
        region: std::env::var("BEDROCK_REGION")
            .or_else(|_| std::env::var("AWS_REGION"))
            .unwrap_or_else(|_| "us-east-1".to_string()),
        response_mode: std::env::var("AI_RESPONSE_MODE")
            .unwrap_or_else(|_| "tool_first_json".to_string()),
        schema_version: std::env::var("AI_RESPONSE_SCHEMA_VERSION")
            .unwrap_or_else(|_| "v1".to_string()),
    }
}
