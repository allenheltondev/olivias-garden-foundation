# Tool-First Structured JSON Standard

This standard defines how agent-backed features must produce structured outputs.

## Rules

1. **Schema-first**
   - Define target JSON shape before implementation.
   - Keep schema versioned.

2. **Tool-first generation**
   - Prefer tool/function-based composition for structured responses.
   - Avoid freeform prose generation when endpoint contract is JSON.

3. **Validation required**
   - Validate structured payload before returning.
   - On validation mismatch, use deterministic fallback shape.

4. **Retry/fallback behavior**
   - First attempt: normal generation path.
   - If invalid: log warning and return safe fallback JSON.
   - Never return malformed or partial JSON.

## Applied in code

- Premium copilot endpoint (`POST /ai/copilot/weekly-plan`)
  - Payload is validated by `structured_json::validate_weekly_plan_response`.
  - Invalid payload triggers fallback recommendation JSON.

## Recommended checklist

- [ ] JSON schema/shape documented
- [ ] Validation function exists
- [ ] Fallback path exists and is deterministic
- [ ] Entitlement and guardrail checks happen before generation
