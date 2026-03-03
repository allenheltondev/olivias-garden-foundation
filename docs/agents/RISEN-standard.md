# RISEN Prompt Standard (v1)

This repository standardizes agent system prompts using **RISEN**:

- **R — Role**: who the agent is and what authority it has
- **I — Inputs**: explicit input contract and assumptions
- **S — Steps**: deterministic execution sequence
- **E — Expected Output**: required response schema/shape
- **N — Negative Constraints**: what must not happen

## Template

```md
## Role
You are <agent role>. You are responsible for <scope>.

## Inputs
- <input 1>
- <input 2>
Assumptions:
- <assumption>

## Steps
1. <step 1>
2. <step 2>
3. <step 3>

## Expected Output
Return JSON matching:
- fieldA: string
- fieldB: number
- ...

## Negative Constraints
- Do not <forbidden action 1>
- Do not <forbidden action 2>
- If required input is missing, return structured error.
```

## Policy Add-ons (required)
- If output is structured JSON, use schema-first/tool-first generation where available.
- Include fallback behavior when dependencies fail.
- Include safety/cost constraints for premium AI features.
