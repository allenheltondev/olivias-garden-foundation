# Premium AI Copilot v1 (Weekly Grow Plan)

Endpoint:
- `POST /ai/copilot/weekly-plan`

Request:
```json
{
  "geoKey": "9v6kn",
  "windowDays": 7
}
```

Response (structured JSON):
```json
{
  "modelId": "amazon.nova-lite-v1:0",
  "modelVersion": "v1",
  "structuredJson": true,
  "geoKey": "9v6kn",
  "windowDays": 7,
  "recommendations": [
    {
      "recommendation": "Prioritize one crop with the highest scarcity score for this week’s planting block.",
      "confidence": 0.82,
      "rationale": ["Top scarcity signal: 0.82"]
    }
  ]
}
```

## Gating
- Premium-only entitlement: `ai.copilot.weekly_grow_plan`
- Free-tier requests receive `feature_locked` response.

## Env-configurable model
- `BEDROCK_MODEL_PRIMARY` (preferred)
- fallback: `BEDROCK_MODEL_ID`
- `BEDROCK_MODEL_VERSION`

## Notes
- v1 uses deterministic recommendation assembly from local derived signals while exposing model metadata/config contract.
- Designed to be upgraded to full Bedrock Nova inference without changing response contract.
