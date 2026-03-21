# Catalog 400-sample benchmark

- Generated: 2026-03-21T16:15:49.466Z
- Sample size: 400
- Overall: **FAIL**

## Failure summary
- promoted_pct: 0%

## Baseline delta
- none (set BENCHMARK_BASELINE_JSON to compare)

## Distributions

### Match type
- unresolved: 330 (82.5%)
- common_name_fallback: 2 (0.5%)
- ambiguous_common_name: 26 (6.5%)
- normalized_scientific: 12 (3%)
- synonym_match: 30 (7.5%)

### Relevance class
- non_food: 382 (95.5%)
- weed_or_invasive: 5 (1.25%)
- food_crop_core: 13 (3.25%)

### Catalog status
- excluded: 387 (96.75%)
- core: 13 (3.25%)

## Queue counts
- promoted: 0 (0%)
- needs_review: 0 (0%)
- excluded: 387 (96.75%)

## Suspicious sample queue
- flagged: 0 (0%)
- file: ..\..\data\catalog\metrics_400_suspicious.jsonl

## Threshold checks
- promoted_pct: 0% -> FAIL
- needs_review_pct: 0% -> PASS
- suspicious_pct: 0% -> PASS
- fuzzy_match_pct: 0% -> PASS
