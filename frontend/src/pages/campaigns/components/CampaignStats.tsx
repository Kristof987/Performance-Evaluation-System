import type { Campaign } from '../campaign.types';
import { BarChart3 } from 'lucide-react';
type Props =
  | { campaignList: Campaign[]; archived?: boolean; campaign?: never }
  | { campaign: Campaign; inProgressCount: number | null; campaignList?: never; archived?: never };
export default function CampaignStats(props: Props) {
  if (props.campaign) {
    const campaign = props.campaign;
    const completion = campaign.sent === 0 ? 0 : Math.round((campaign.done / campaign.sent) * 100);
    return (
      <section className="campaign-progress" aria-labelledby="campaign-progress-title">
        <div className="campaign-dashboard-card-head"><span className="campaign-dashboard-icon campaign-dashboard-icon-blue"><BarChart3 size={19} aria-hidden="true" /></span><h2 id="campaign-progress-title">Evaluation progress</h2></div>
        <div className="campaign-progress-heading">
          <div><strong>{campaign.done} <span>/ {campaign.sent}</span></strong><small>completed evaluations</small></div>
          <div className="campaign-progress-percent"><strong>{completion}%</strong><small>completed</small></div>
        </div>
        <div className="campaign-progress-track" role="progressbar" aria-label="Evaluation completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, completion))}><span style={{ width: `${Math.min(100, Math.max(0, completion))}%` }} /></div>
        <dl className="campaign-progress-breakdown">
          <div><dd>{campaign.sent - campaign.done}</dd><dt>{campaign.status === 'closed' ? 'not submitted' : 'awaiting submission'}</dt></div>
          <div><dd>{props.inProgressCount ?? <span aria-label="Count unavailable">—</span>}</dd><dt>in progress</dt></div>
          <div><dd>{campaign.done}</dd><dt>completed</dt></div>
        </dl>
      </section>
    );
  }
  const campaignList = props.campaignList;
  return (
    <div className="campaign-overview-stats" aria-label="Campaign statistics">
      <div className="campaign-mini-stat">
        <span>{props.archived ? 'Archived campaigns' : 'Total campaigns'}</span>
        <strong>{campaignList.length}</strong>
      </div>
        {(props.archived ? ['paused', 'closed'] : ['draft', 'scheduled', 'active']).map((status) => (
        <div className="campaign-mini-stat" key={status}>
           <span>{status[0].toUpperCase() + status.slice(1)}</span>
          <strong>{campaignList.filter((campaign) => campaign.status === status).length}</strong>
        </div>
      ))}
    </div>
  );
}
