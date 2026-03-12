# Tips analytics + feedback loop (Issue #138)

## Event taxonomy (v1)

The backend now emits `tips.curated.presented` whenever `GET /me` returns curated tips.

Recommended event names for follow-up frontend instrumentation:
- `tips.curated.presented` (impression payload from backend)
- `tips.curated.saved`
- `tips.curated.dismissed`
- `tips.curated.opened`
- `tips.curated.feedback.negative`
- `tips.curated.followthrough.crop_created`
- `tips.curated.followthrough.listing_created`

## KPI query spec

Use `premium_analytics_events` as the source table.

### Impression volume
```sql
select date_trunc('day', occurred_at) as day,
       count(*) as impressions
from premium_analytics_events
where event_name = 'tips.curated.presented'
group by 1
order by 1 desc;
```

### Engagement rate (save+dismiss+open / impressions)
```sql
with base as (
  select event_name, count(*)::numeric as total
  from premium_analytics_events
  where occurred_at >= now() - interval '30 days'
    and event_name in (
      'tips.curated.presented',
      'tips.curated.saved',
      'tips.curated.dismissed',
      'tips.curated.opened'
    )
  group by event_name
)
select
  coalesce((select total from base where event_name = 'tips.curated.presented'), 0) as impressions,
  coalesce((select total from base where event_name = 'tips.curated.saved'), 0)
  + coalesce((select total from base where event_name = 'tips.curated.dismissed'), 0)
  + coalesce((select total from base where event_name = 'tips.curated.opened'), 0) as engagements;
```

### Guardrail metrics
- Negative feedback rate = `tips.curated.feedback.negative / tips.curated.presented`
- Dismiss-heavy segment detection by experience level, season, and zone.
- Duplicate spam guard: max one `tips.curated.presented` per user per request correlation id.

## Iterative tuning loop

1. Segment by `experienceLevel`, `season`, `zone`.
2. Down-rank tips with high dismiss + negative feedback rates.
3. Promote tips with high save/open + follow-through rates.
4. Review weekly and update targeting metadata in `data/tips/curated_tips.v1.json`.
