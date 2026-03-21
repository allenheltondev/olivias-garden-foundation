# Catalog quality thresholds (400-sample benchmark)

Run from `scripts/catalog`:

```bash
bun run benchmark:400
```

Optional overrides (for calibration runs):

```bash
BENCHMARK_MIN_PROMOTED_PCT=2 \
BENCHMARK_MAX_NEEDS_REVIEW_PCT=45 \
BENCHMARK_MAX_SUSPICIOUS_PCT=25 \
BENCHMARK_MAX_FUZZY_MATCH_PCT=30 \
bun run benchmark:400
```

This produces:
- `data/catalog/metrics_400.json` (machine-readable)
- `data/catalog/metrics_400.md` (human-readable)
- `data/catalog/metrics_400_suspicious.jsonl` (manual-review queue)

Optional baseline compare:

```bash
BENCHMARK_BASELINE_JSON=../../data/catalog/metrics_400.baseline.json \
bun run benchmark:400
```

When provided, benchmark output includes before/after delta metrics in both JSON and markdown.

## Current review thresholds

- promoted_pct >= 5%
- needs_review_pct <= 35%
- suspicious_pct <= 20%
- fuzzy_match_pct <= 25%

If any threshold fails, benchmark status is **FAIL** and should be called out in PR notes.
