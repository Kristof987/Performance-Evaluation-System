import './MetricsGrid.css';
import type { ReactNode } from 'react';

import type { DashboardMetrics } from '../hrHome.types';
import { formatShortDate } from '../utils/hrHome.utils';

type MetricCardProps = {
  label: string;
  value: ReactNode;
  context: ReactNode;
  variant?: 'accent' | 'danger';
};

function MetricCard({ label, value, context, variant }: MetricCardProps) {
  const valueClassName =
    variant === undefined ? 'metric-value' : `metric-value ${variant}`;

  return (
    <div className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className={valueClassName}>{value}</div>
      <div className="metric-context">{context}</div>
    </div>
  );
}

type MetricsGridProps = {
  metrics: DashboardMetrics;
};

function MetricsGrid({ metrics }: MetricsGridProps) {
  return (
    <div className="metrics">
      <MetricCard
        label="Completion rate"
        variant="accent"
        value={<>{metrics.completion_rate}%</>}
        context={
          <>
            {metrics.submitted_count} of {metrics.assignment_count} assignments
            submitted
          </>
        }
      />
      <MetricCard
        label="Awaiting submission"
        value={metrics.awaiting_submission_count}
        context={
          <>
            {metrics.not_started_count} not started ·{' '}
            {metrics.in_progress_count} in progress
          </>
        }
      />
      <MetricCard
        label="Overdue"
        variant="danger"
        value={metrics.overdue_count}
        context={<>Across {metrics.overdue_forms_count} forms</>}
      />
      <MetricCard
        label="Upcoming reviews"
        value={metrics.upcoming_reviews_count}
        context={<>Next review · {formatShortDate(metrics.next_review_date)}</>}
      />
    </div>
  );
}

export default MetricsGrid;
