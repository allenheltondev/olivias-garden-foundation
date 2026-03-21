# Catalog quality thresholds (400-sample benchmark)

Run from `scripts/catalog`:

```bash
bun run benchmark:400
```

This produces:
- `data/catalog/metrics_400.json` (machine-readable)
- `data/catalog/metrics_400.md` (human-readable)
- `data/catalog/metrics_400_suspicious.jsonl` (manual-review queue)

## Current review thresholds

- promoted_pct >= 5%
- needs_review_pct <= 35%
- suspicious_pct <= 20%
- fuzzy_match_pct <= 25%

If any threshold fails, benchmark status is **FAIL** and should be called out in PR notes.
