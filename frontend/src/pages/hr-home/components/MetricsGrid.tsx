import './MetricsGrid.css';
import type { ReactNode } from 'react';

import type { Campaign, DashboardMetrics } from '../hrHome.types';
import {
  formatCompactDate,
  formatStartsIn,
  getLocalDateOnly,
  parseDateOnly,
} from '../utils/hrHome.utils';

type KpiItemProps = {
  label: string;
  value: ReactNode;
  context: ReactNode;
  status?: 'neutral' | 'danger';
};

function KpiItem({ label, value, context, status = 'neutral' }: KpiItemProps) {
  return (
    <div className="kpi-item">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${status}`}>{value}</div>
      <div className="kpi-context">{context}</div>
    </div>
  );
}

type MetricsGridProps = {
  metrics: DashboardMetrics;
  campaigns: Campaign[];
};

function getNextCampaign(campaigns: Campaign[]): Campaign | null {
  const today = getLocalDateOnly();

  return [...campaigns]
    .filter((campaign) => parseDateOnly(campaign.start_date) > today)
    .sort((first, second) => {
      const dateDifference =
        parseDateOnly(first.start_date).getTime() -
        parseDateOnly(second.start_date).getTime();

      if (dateDifference !== 0) return dateDifference;
      return first.name.localeCompare(second.name, 'hu') || first.id - second.id;
    })[0] ?? null;
}

function MetricsGrid({ metrics, campaigns }: MetricsGridProps) {
  const completionRate = Math.min(100, Math.max(0, metrics.completion_rate));
  const overdueStatus = metrics.overdue_count > 0 ? 'danger' : 'neutral';
  const overdueContext =
    metrics.overdue_count > 0
      ? `Across ${metrics.overdue_forms_count} forms`
      : 'No overdue evaluations';
  const nextCampaign = getNextCampaign(campaigns);

  return (
    <div className="card kpi-section" aria-label="Campaign overview metrics">
      <div className="kpi-item kpi-item-primary">
        <div className="kpi-label">Completion rate</div>
        <div className="kpi-value">{metrics.completion_rate}%</div>
        <div
          className="kpi-progress"
          role="progressbar"
          aria-label="Completion rate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionRate}
        >
          <div
            className="kpi-progress-fill"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <div className="kpi-context">
          {metrics.submitted_count} of {metrics.assignment_count} submitted
        </div>
      </div>
      <KpiItem
        label="Awaiting submission"
        value={metrics.awaiting_submission_count}
        context={
          <>
            {metrics.not_started_count} not started ·{' '}
            {metrics.in_progress_count} in progress
          </>
        }
      />
      <KpiItem
        label="Overdue"
        status={overdueStatus}
        value={metrics.overdue_count}
        context={overdueContext}
      />
      <KpiItem
        label="Next campaign"
        value={
          nextCampaign === null
            ? 'None'
            : formatCompactDate(nextCampaign.start_date)
        }
        context={
          nextCampaign === null ? (
            'No upcoming campaigns'
          ) : (
            <>
              {nextCampaign.name} · {formatStartsIn(nextCampaign.start_date)}
            </>
          )
        }
      />
    </div>
  );
}

export default MetricsGrid;
