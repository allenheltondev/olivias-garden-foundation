# Tips Framework v1 (`tips.v1`)

Issue: #133, #135

## Experience tiers

`beginner` → `intermediate` → `advanced`

Deterministic assignment (`assign_experience_level`) uses a weighted score plus gates:

- **advanced**: score >= 50, completed_grows >= 10, seasonal_consistency >= 2, variety_breadth >= 6
- **intermediate**: score >= 18, completed_grows >= 3, variety_breadth >= 2
- **beginner**: all others

## Locked v1 categories

- `watering`
- `pests`
- `planting`
- `soil`
- `seasonal`
- `harvest`

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

Matching for season/zone/crop tags is case-insensitive. `any` is supported as a wildcard for season, zone, and crop tags.

## Curated catalog (content-driven)

The starter catalog lives in `data/tips/curated_tips.v1.json` and is loaded at runtime.

- One starter tip exists per level/category combination.
- Every tip includes targeting metadata (`seasons`, `zoneTags`, `cropTags`).
- Catalog validation fails startup if required metadata is missing.

## Safety/content quality guidelines

- Tips must be actionable and observable in a garden context.
- Avoid health/legal/medical claims.
- Avoid pesticide recommendations that require licensing or region-specific regulation knowledge unless explicitly constrained and sourced.
- Prefer conservative advice with clear assumptions (climate zone, season, crop type).
- If uncertain, degrade to generic low-risk guidance and tag for catalog review.
