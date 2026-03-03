# Agent Prompt Review Checklist

Use this checklist for PR review of agent prompt changes.

## RISEN completeness
- [ ] Role section is explicit and scoped
- [ ] Inputs section defines required fields and assumptions
- [ ] Steps section is deterministic and ordered
- [ ] Expected Output section defines schema/shape
- [ ] Negative Constraints section is explicit

## Structured output quality
- [ ] Structured JSON paths are schema-first/tool-first
- [ ] Error fallback is defined for missing/invalid inputs
- [ ] Response includes required metadata fields

## Safety/cost policy
- [ ] Entitlement gates are specified where required
- [ ] Free tier restrictions are respected
- [ ] AI usage limits/fallbacks are specified where applicable
