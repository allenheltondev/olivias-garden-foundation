# Tool-First Structured JSON Standard

## Goal
When a premium AI endpoint requires structured output, response generation must follow a tool-first contract instead of freeform prose.

## Applies to
- `POST /ai/copilot/weekly-plan`
- Any future premium AI/copilot endpoint that returns machine-consumable JSON

## Standard
1. **Tool-first mode required**
   - Use `AI_RESPONSE_MODE=tool_first_json` (default)
   - `modelVersion` should include response mode + schema version

2. **Schema validation required**
   - Validate payloads against internal structured schema checks before returning
   - For weekly plan responses this is enforced in `structured_json::validate_weekly_plan_response`

3. **Retry/repair behavior**
   - First pass: validate generated payload
   - If invalid: run a repair normalization pass (trim strings, clamp confidence, normalize rationale/window)
   - Re-validate repaired payload

4. **Fallback behavior**
   - If repaired payload still fails schema validation, return deterministic fallback JSON
   - Fallback must still satisfy response schema contract

5. **When plain text is acceptable**
   - Human-only summaries that are not consumed by app clients
   - Logs, diagnostics, and internal operational notes
   - Never as the primary contract response for structured AI endpoints

## Why this is solo-maintainer friendly
- Deterministic contract path reduces flaky downstream behavior
- Repair pass handles minor schema drift without immediate incident work
- Final fallback prevents endpoint breakage under model variance
