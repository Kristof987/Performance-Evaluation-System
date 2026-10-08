import './NextActions.css';
import { BellRing } from 'lucide-react';

import type { DashboardMetrics } from '../hrHome.types';
import { areResultsReadyToPublish } from '../utils/hrHome.utils';

type NextActionsProps = {
  metrics: DashboardMetrics;
  campaignName: string | undefined;
};

function NextActions({ metrics, campaignName }: NextActionsProps) {
  const hasOverdueSubmissions = metrics.overdue_count > 0;
  const hasPendingSubmissions = metrics.awaiting_submission_count > 0;

  return (
    <div className="next-actions">
      <div className="section-title">Next Actions</div>

      <div
        className={
          hasOverdueSubmissions ? 'card overdue-alert' : 'card follow-up-card'
        }
      >
        <div
          className={
            hasOverdueSubmissions
              ? 'overdue-alert-title'
              : 'follow-up-card-title'
          }
        >
          {hasOverdueSubmissions
            ? `${metrics.overdue_count} submissions are overdue`
            : hasPendingSubmissions
              ? `${metrics.awaiting_submission_count} submissions are pending`
              : 'No reminders needed'}
        </div>
        <div
          className={
            hasOverdueSubmissions
              ? 'overdue-alert-text'
              : 'follow-up-card-text'
          }
        >
          {hasOverdueSubmissions
            ? 'Follow up with reviewers who missed their deadline.'
            : hasPendingSubmissions
              ? 'Send manual reminders to reviewers who have not submitted yet. You can also set up automatic reminders in the campaign settings.'
              : 'All assigned submissions are complete for this campaign.'}
        </div>
        {hasPendingSubmissions && (
          <div className="btn btn-secondary reminder-button">
            <BellRing size={14} />
            <span>Send reminders</span>
          </div>
        )}
      </div>

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
