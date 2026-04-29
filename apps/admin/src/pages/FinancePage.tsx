import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, FormFeedback, SectionHeading } from '@olivias/ui';
import { getFinanceRevenue, type FinanceBucket, type FinanceRevenueResponse } from '../api';
import type { AdminSession } from '../auth/session';

export interface FinancePageProps {
  session: AdminSession;
}

type Granularity = 'day' | 'week' | 'month';

const GRANULARITY_OPTIONS: Array<{ id: Granularity; label: string }> = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
];

const RANGE_OPTIONS: Array<{ id: string; label: string; days: number; granularity: Granularity }> = [
  { id: '30d', label: 'Last 30 days', days: 30, granularity: 'day' },
  { id: '90d', label: 'Last 90 days', days: 90, granularity: 'week' },
  { id: '6mo', label: 'Last 6 months', days: 183, granularity: 'month' },
  { id: '12mo', label: 'Last 12 months', days: 365, granularity: 'month' },
];

function formatMoney(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);
}

function formatBucketLabel(periodStart: string, granularity: Granularity): string {
  const date = new Date(periodStart);
  if (Number.isNaN(date.valueOf())) return periodStart;
  if (granularity === 'day') {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  if (granularity === 'week') {
    return `Wk of ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function rangeBoundaries(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - days);
  from.setUTCHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

interface ChartRow {
  label: string;
  donationOneTime: number;
  donationRecurring: number;
  merchandise: number;
}

function bucketsToChartRows(buckets: FinanceBucket[], granularity: Granularity): ChartRow[] {
  return buckets.map((bucket) => ({
    label: formatBucketLabel(bucket.periodStart, granularity),
    donationOneTime: bucket.donationOneTimeCents / 100,
    donationRecurring: bucket.donationRecurringCents / 100,
    merchandise: bucket.merchandiseCents / 100,
  }));
}

const SMALL_SCREEN_QUERY = '(max-width: 640px)';

export function FinancePage({ session }: FinancePageProps) {
  const [rangeId, setRangeId] = useState<string>('6mo');
  const [granularityOverride, setGranularityOverride] = useState<Granularity | null>(null);
  const [data, setData] = useState<FinanceRevenueResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(SMALL_SCREEN_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(SMALL_SCREEN_QUERY);
    const update = () => setIsSmallScreen(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const activeRange = useMemo(
    () => RANGE_OPTIONS.find((r) => r.id === rangeId) ?? RANGE_OPTIONS[2],
    [rangeId]
  );
  const activeGranularity: Granularity = granularityOverride ?? activeRange.granularity;

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { from, to } = rangeBoundaries(activeRange.days);
      const response = await getFinanceRevenue(session.accessToken, {
        from,
        to,
        granularity: activeGranularity,
      });
      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load finance data.');
    } finally {
      setIsLoading(false);
    }
  }, [session.accessToken, activeRange.days, activeGranularity]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartRows = useMemo(
    () => (data ? bucketsToChartRows(data.buckets, activeGranularity) : []),
    [data, activeGranularity]
  );

  return (
    <section className="admin-section admin-finance">
      <SectionHeading
        eyebrow="Finance"
        title="Revenue"
        body="Donations and merchandise revenue over time. Recurring donations are split out so you can see Garden Club versus one-time gifts."
      />

      <div className="admin-finance__controls">
        <div className="admin-finance__control-group" role="tablist" aria-label="Date range">
          {RANGE_OPTIONS.map((range) => (
            <button
              key={range.id}
              type="button"
              role="tab"
              aria-selected={range.id === rangeId}
              className={`admin-finance__chip${range.id === rangeId ? ' is-active' : ''}`}
              onClick={() => {
                setRangeId(range.id);
                setGranularityOverride(null);
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
        <div className="admin-finance__control-group" role="tablist" aria-label="Granularity">
          {GRANULARITY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={option.id === activeGranularity}
              className={`admin-finance__chip${option.id === activeGranularity ? ' is-active' : ''}`}
              onClick={() => setGranularityOverride(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <FormFeedback tone="error">{error}</FormFeedback> : null}

      <div className="admin-finance__totals">
        <Card className="admin-finance__tile">
          <p className="admin-finance__tile-label">Total revenue</p>
          <p className="admin-finance__tile-value">{formatMoney(data?.totals.totalCents ?? 0)}</p>
        </Card>
        <Card className="admin-finance__tile">
          <p className="admin-finance__tile-label">One-time donations</p>
          <p className="admin-finance__tile-value">{formatMoney(data?.totals.donationOneTimeCents ?? 0)}</p>
        </Card>
        <Card className="admin-finance__tile">
          <p className="admin-finance__tile-label">Recurring donations</p>
          <p className="admin-finance__tile-value">{formatMoney(data?.totals.donationRecurringCents ?? 0)}</p>
        </Card>
        <Card className="admin-finance__tile">
          <p className="admin-finance__tile-label">Merchandise</p>
          <p className="admin-finance__tile-value">{formatMoney(data?.totals.merchandiseCents ?? 0)}</p>
        </Card>
      </div>

      <Card className="admin-finance__chart-card">
        {isLoading ? (
          <p>Loading revenue…</p>
        ) : chartRows.length === 0 ? (
          <p>No revenue in this range yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={isSmallScreen ? 260 : 320}>
            <BarChart
              data={chartRows}
              margin={{
                top: 16,
                right: isSmallScreen ? 4 : 16,
                bottom: isSmallScreen ? 32 : 8,
                left: isSmallScreen ? 0 : 16,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.1)" />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={isSmallScreen ? 24 : 8}
                angle={isSmallScreen ? -30 : 0}
                textAnchor={isSmallScreen ? 'end' : 'middle'}
                height={isSmallScreen ? 56 : 30}
              />
              <YAxis
                tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                width={isSmallScreen ? 44 : 60}
              />
              <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
              <Legend />
              <Bar dataKey="donationOneTime" name="One-time donations" stackId="rev" fill="#f4a261" />
              <Bar dataKey="donationRecurring" name="Recurring donations" stackId="rev" fill="#2a9d8f" />
              <Bar dataKey="merchandise" name="Merchandise" stackId="rev" fill="#264653" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </section>
  );
}
