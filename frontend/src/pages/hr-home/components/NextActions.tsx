import './NextActions.css';
import { AlertTriangle, BarChart3, BellRing, CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DashboardMetrics } from '../hrHome.types';

type NextActionsProps = {
  metrics: DashboardMetrics;
  campaignName: string | undefined;
  onOpenCampaign: () => void;
};

type DashboardAction = {
  id: string;
  title: string;
  context: string;
  actionLabel: string;
  tone?: 'neutral' | 'warning';
  icon: ReactNode;
};

function NextActionItem({ action, onOpenCampaign }: {
  action: DashboardAction;
  onOpenCampaign: () => void;
}) {
  return (
    <div className={`next-action-item ${action.tone ?? 'neutral'}`}>
      <span className="next-action-icon" aria-hidden="true">
        {action.icon}
      </span>
      <div className="next-action-content">
        <strong>{action.title}</strong>
        <span>{action.context}</span>
      </div>
      <button type="button" onClick={onOpenCampaign}>
        {action.actionLabel} →
      </button>
    </div>
  );
}

function getActions(
  metrics: DashboardMetrics,
  campaignName: string,
): DashboardAction[] {
  const actions: DashboardAction[] = [];

  if (metrics.overdue_count > 0) {
    actions.push({
      id: 'overdue',
      title: `${metrics.overdue_count} overdue evaluations`,
      context: campaignName,
      actionLabel: 'Review overdue items',
      tone: 'warning',
      icon: <AlertTriangle size={15} />,
    });
  }

  if (metrics.awaiting_submission_count > 0) {
    actions.push({
      id: 'pending',
      title: `${metrics.awaiting_submission_count} pending submissions`,
      context: campaignName,
      actionLabel: 'Open campaign',
      icon: <BellRing size={15} />,
    });
  }

  if (metrics.submitted_count > 0) {
    actions.push({
      id: 'results',
      title: 'Review campaign results',
      context: `${campaignName} · ${metrics.submitted_count} submitted`,
      actionLabel: 'Open results',
      icon: <BarChart3 size={15} />,
    });
  }

  return actions.slice(0, 4);
}

function NextActions({ metrics, campaignName, onOpenCampaign }: NextActionsProps) {
  const campaignLabel = campaignName ?? 'Selected campaign';
  const actions = getActions(metrics, campaignLabel);

  return (
    <section className="next-actions" aria-labelledby="next-actions-title">
      <div className="next-actions-header">
        <div className="section-title" id="next-actions-title">
          Next Actions
        </div>
        <span>
          {actions.length} {actions.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="card next-actions-panel">
        {actions.length === 0 ? (
          <div className="next-actions-empty">
            <span className="next-action-icon" aria-hidden="true">
              <CheckCircle2 size={15} />
            </span>
            <div>
              <strong>You're all caught up</strong>
              <span>No actions require your attention right now.</span>
            </div>
          </div>
        ) : (
          actions.map((action) => (
            <NextActionItem
              action={action}
              key={action.id}
              onOpenCampaign={onOpenCampaign}
            />
          ))
        )}
      </div>
    </section>
  );
}

export default NextActions;
