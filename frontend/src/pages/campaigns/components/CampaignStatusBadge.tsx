import type { CampaignLifecycleStatus } from '../campaign.lifecycle';
import './CampaignStatusBadge.css';

export default function CampaignStatusBadge({ status }: { status: CampaignLifecycleStatus }) {
  return <span className={`campaign-lifecycle-badge campaign-lifecycle-${status.toLowerCase()}`}>{status}</span>;
}
