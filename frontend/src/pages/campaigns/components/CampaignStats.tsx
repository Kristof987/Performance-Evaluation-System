import type { Campaign } from '../campaign.types';
type Props =
  | { campaignList: Campaign[]; archived?: boolean; campaign?: never }
  | { campaign: Campaign; campaignList?: never; archived?: never };
export default function CampaignStats(props: Props) {
  if (props.campaign) {
    const campaign = props.campaign;
    return (
      <div className="campaign-stats" aria-label="Campaign metrics">
        <div className="campaign-stat">
          <span>Completion rate</span>
          <strong>
            {campaign.sent === 0
              ? '0%'
              : `${Math.round((campaign.done / campaign.sent) * 100)}%`}
          </strong>
        </div>
        <div className="campaign-stat">
          <span>Submitted</span>
          <strong>
            {campaign.done} / {campaign.sent}
          </strong>
        </div>
        <div className="campaign-stat">
          <span>
             {campaign.status === 'closed' || campaign.status === 'review'
              ? 'Not submitted'
              : 'Awaiting submission'}
          </span>
          <strong>{campaign.sent - campaign.done}</strong>
        </div>
        <div className="campaign-stat">
          <span>Evaluations</span>
          <strong>{campaign.issuedFormsCount}</strong>
        </div>
      </div>
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
