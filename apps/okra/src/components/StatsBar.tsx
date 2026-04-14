import './StatsBar.css';

export interface StatsData {
  total_pins: number;
  country_count: number;
  contributor_count: number;
}

export interface StatsBarProps {
  stats: StatsData | null;
  loading: boolean;
  error: boolean;
}

const fmt = new Intl.NumberFormat();

function SkeletonItem({ primary }: { primary?: boolean }) {
  return (
    <div className="stats-bar__item">
      <dt>
        <span
          className={`stats-bar__skeleton ${primary ? 'stats-bar__skeleton--value-primary' : 'stats-bar__skeleton--value'}`}
          aria-hidden="true"
        />
      </dt>
      <dd>
        <span className="stats-bar__skeleton stats-bar__skeleton--label" aria-hidden="true" />
      </dd>
    </div>
  );
}

/**
 * StatsBar — displays community statistics (gardens, countries, growers).
 *
 * Desktop: semi-transparent overlay on top edge of map.
 * Mobile (<768px): compact horizontal strip above the map container.
 * Hides gracefully on error. Shows skeleton placeholders while loading.
 * Uses <dl> semantic HTML for screen reader compatibility.
 */
export function StatsBar({ stats, loading, error }: StatsBarProps) {
  if (error) {
    return null;
  }

  if (loading || !stats) {
    return (
      <dl className="stats-bar" aria-label="Community statistics" aria-busy="true">
        <SkeletonItem primary />
        <SkeletonItem />
      </dl>
    );
  }

  return (
    <dl className="stats-bar" aria-label="Community statistics">
      <div className="stats-bar__item">
        <dt className="stats-bar__value stats-bar__value--primary">
          {fmt.format(stats.total_pins)}
        </dt>
        <dd className="stats-bar__label">growers</dd>
      </div>
      <div className="stats-bar__item">
        <dt className="stats-bar__value">{fmt.format(stats.country_count)}</dt>
        <dd className="stats-bar__label">countries</dd>
      </div>
    </dl>
  );
}
