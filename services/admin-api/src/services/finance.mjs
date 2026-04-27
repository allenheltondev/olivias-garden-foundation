import { query } from './db.mjs';

const SUPPORTED_GRANULARITIES = new Set(['day', 'week', 'month']);

export function parseDateBoundary(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

export function defaultRange(now = new Date()) {
  const to = new Date(now);
  const from = new Date(to);
  from.setUTCMonth(from.getUTCMonth() - 6);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

export function resolveGranularity(value) {
  return SUPPORTED_GRANULARITIES.has(value) ? value : 'month';
}

function emptyBucketTotals() {
  return {
    totalCents: 0,
    donationOneTimeCents: 0,
    donationRecurringCents: 0,
    merchandiseCents: 0
  };
}

function bucketKey(date) {
  return new Date(date).toISOString();
}

function ensureBucket(buckets, periodStart) {
  const key = bucketKey(periodStart);
  if (!buckets.has(key)) {
    buckets.set(key, { periodStart: key, ...emptyBucketTotals() });
  }
  return buckets.get(key);
}

export function aggregateRevenue({ donationRows = [], merchRows = [] } = {}) {
  const buckets = new Map();
  const totals = emptyBucketTotals();

  for (const row of donationRows) {
    const cents = Number(row.cents ?? 0);
    if (!cents) continue;
    const bucket = ensureBucket(buckets, row.period_start);
    if (row.donation_mode === 'recurring') {
      bucket.donationRecurringCents += cents;
      totals.donationRecurringCents += cents;
    } else {
      bucket.donationOneTimeCents += cents;
      totals.donationOneTimeCents += cents;
    }
    bucket.totalCents += cents;
    totals.totalCents += cents;
  }

  for (const row of merchRows) {
    const cents = Number(row.cents ?? 0);
    if (!cents) continue;
    const bucket = ensureBucket(buckets, row.period_start);
    bucket.merchandiseCents += cents;
    bucket.totalCents += cents;
    totals.merchandiseCents += cents;
    totals.totalCents += cents;
  }

  const orderedBuckets = [...buckets.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  return { totals, buckets: orderedBuckets };
}

export async function getRevenueSummary({ from, to, granularity, queryFn = query } = {}) {
  const fallback = defaultRange();
  const range = {
    from: parseDateBoundary(from, fallback.from),
    to: parseDateBoundary(to, fallback.to)
  };
  const grain = resolveGranularity(granularity);

  const donationsResult = await queryFn(
    `
      select
        date_trunc($3, received_at) as period_start,
        donation_mode,
        sum(amount_cents)::bigint as cents
      from donation_events
      where received_at >= $1
        and received_at < $2
      group by 1, 2
      order by 1 asc
    `,
    [range.from, range.to, grain]
  );

  const merchResult = await queryFn(
    `
      select
        date_trunc($3, paid_at) as period_start,
        sum(items_total)::bigint as cents
      from (
        select
          o.id,
          o.paid_at,
          coalesce(sum(case when oi.product_kind <> 'donation' then oi.total_cents else 0 end), 0) as items_total
        from store_orders o
        left join store_order_items oi on oi.order_id = o.id
        where o.status = 'paid'
          and o.paid_at >= $1
          and o.paid_at < $2
        group by o.id, o.paid_at
        having coalesce(sum(case when oi.product_kind <> 'donation' then oi.total_cents else 0 end), 0) > 0
      ) per_order
      group by 1
      order by 1 asc
    `,
    [range.from, range.to, grain]
  );

  const { totals, buckets } = aggregateRevenue({
    donationRows: donationsResult.rows,
    merchRows: merchResult.rows
  });

  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      granularity: grain
    },
    totals,
    buckets
  };
}
