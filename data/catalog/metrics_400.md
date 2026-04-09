# Catalog 400-sample benchmark

- Generated: 2026-03-27T16:57:53.485Z
- Sample size: 400
- Overall: **PASS**

## Failure summary
- none

## Baseline delta
- none (set BENCHMARK_BASELINE_JSON to compare)

## Distributions

### Match type
- exact_scientific: 55 (13.75%)
- normalized_scientific: 200 (50%)
- common_name_fallback: 71 (17.75%)
- ambiguous_common_name: 69 (17.25%)
- genus_match: 5 (1.25%)

### Relevance class
- non_food: 263 (65.75%)
- food_crop_niche: 74 (18.5%)
- weed_or_invasive: 57 (14.25%)
- food_crop_core: 6 (1.5%)

### Catalog status
- excluded: 320 (80%)
- extended: 74 (18.5%)
- core: 6 (1.5%)

## Queue counts
- promoted: 61 (15.25%)
- needs_review: 19 (4.75%)
- excluded: 320 (80%)

## Promotion blockers (diagnostic)
- non_core_status: 320 (80%)\n- not_auto_approved: 339 (84.75%)\n- no_openfarm_support: 191 (47.75%)\n- low_confidence_band: 34 (8.5%)\n- guardrail_blocked: 89 (22.25%)

## Source coverage (diagnostic)
- openfarm_record_present: 209 (52.25%)\n- openfarm_record_matched: 209 (52.25%)\n- unresolved_only: 0 (0%)

## Unresolved OpenFarm examples (first 25)
- none

## Unresolved token frequency (top 15)
- none

## Suspicious sample queue
- flagged: 0 (0%)
- file: ..\..\data\catalog\metrics_400_suspicious.jsonl

## Threshold checks
- promoted_pct: 15.25% -> PASS
- needs_review_pct: 4.75% -> PASS
- suspicious_pct: 0% -> PASS
- fuzzy_match_pct: 0% -> PASS
