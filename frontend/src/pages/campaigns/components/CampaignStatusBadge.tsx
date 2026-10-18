import type { CampaignWorkflowStatus } from '../campaign.lifecycle';
import './CampaignStatusBadge.css';

export default function CampaignStatusBadge({ status }: { status: CampaignWorkflowStatus }) {
  return <span className={`campaign-lifecycle-badge campaign-lifecycle-${status}`}>{status[0].toUpperCase() + status.slice(1)}</span>;
}
