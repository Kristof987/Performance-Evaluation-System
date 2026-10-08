import './NextActions.css';
import { BellRing } from 'lucide-react';

import type { DashboardMetrics } from '../hrHome.types';
import { areResultsReadyToPublish } from '../utils/hrHome.utils';

type NextActionsProps = {
  metrics: DashboardMetrics;
  campaignName: string | undefined;
};

function NextActions({ metrics, campaignName }: NextActionsProps) {
  return (
    <div className="next-actions">
      <div className="section-title">Next Actions</div>

      {metrics.overdue_count > 0 && (
        <div className="card overdue-alert">
          <div className="overdue-alert-title">
            {metrics.overdue_count} submissions are overdue
          </div>
          <div className="overdue-alert-text">
            Follow up with reviewers who missed their deadline.
          </div>
          <div className="btn btn-secondary reminder-button">
            <BellRing size={14} />
            <span>Send reminders</span>
          </div>
        </div>
      )}

      <div className="card publish-card">
        <div className="publish-card-title">
          {areResultsReadyToPublish(metrics)
            ? 'Results ready to publish'
            : 'Results in progress'}
        </div>
        <div className="publish-card-context">
          {campaignName} · {metrics.submitted_count} submitted
        </div>
        <div className="publish-card-link">Review results →</div>
      </div>
    </div>
  );
}

export default NextActions;
