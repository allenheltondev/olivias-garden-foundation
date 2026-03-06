# Tips Framework v1 (`tips.v1`)

Issue: #133

## Experience tiers

`beginner` → `intermediate` → `advanced`

Deterministic assignment (`assign_experience_level`):

- **advanced**: completed_grows >= 10 AND successful_harvests >= 6 AND active_days_last_90 >= 45
- **intermediate**: completed_grows >= 3 AND successful_harvests >= 1 AND active_days_last_90 >= 15
- **beginner**: all others

## Locked v1 categories

- `watering`
- `pests`
- `planting`
- `soil`
- `seasonal`

## Tip schema (`tips.v1`)

```json
{
  "schemaVersion": "tips.v1",
  "title": "Water deeply at dawn",
  "body": "Water early to reduce evaporation losses.",
  "category": "watering",
  "level": "beginner",
  "season": "summer",
  "cropTags": ["pepper"],
  "zoneTags": ["10a"]
}
```

## Eligibility + targeting contract

A tip is eligible only when **all** of the following are true:

1. `user_level >= minimum_level`
2. season matches (or tip season list is empty)
3. zone matches (or tip zone list is empty)
4. at least one crop tag overlaps (or tip crop list is empty)

Matching for season/zone/crop tags is case-insensitive.

## Safety/content quality guidelines

- Tips must be actionable and observable in a garden context.
- Avoid health/legal/medical claims.
- Avoid pesticide recommendations that require licensing or region-specific regulation knowledge unless explicitly constrained and sourced.
- Prefer conservative advice with clear assumptions (climate zone, season, crop type).
- If uncertain, degrade to generic low-risk guidance and tag for catalog review.
