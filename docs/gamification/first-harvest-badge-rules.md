# First Harvest Badge Proof Rules (v1)

Badge key: `first_harvest`

## Deterministic award conditions

Award only when both are true:

1. User has a harvest event on a crop entry
   - implemented as at least one completed claim on a listing linked to `grower_crop_id`
2. User has at least one timestamped photo proof linked to the same crop entry near harvest
   - source: `badge_evidence_submissions`
   - timestamp: `coalesce(exif_taken_at, captured_at, created_at)`
   - allowed window: ±14 days around harvest timestamp

## Guardrails

- Crop linkage is required (`grower_crop_id` must match)
- Canonical crop/variety IDs are inherited via linked `grower_crop_library` entry
- Badge is awarded once per account (idempotent reruns)
- Award audit stores `proofCount` metadata for profile display

## Profile impact

`GET /me` includes `badgeCabinet[]` entries with:

- `badgeKey`
- `earnedAt`
- `proofCount`

This enables profile rendering like: **First Harvest • 1 verified harvest**.
