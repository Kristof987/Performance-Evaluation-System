import type { Campaign } from '../campaign.types';
type Props =
  | { campaignList: Campaign[]; campaign?: never }
  | { campaign: Campaign; campaignList?: never };
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
            {campaign.status === 'Completed' || campaign.status === 'Disabled'
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
        <span>Total campaigns</span>
        <strong>{campaignList.length}</strong>
        <small>{campaignList.filter((campaign) => campaign.status === 'Disabled').length} disabled</small>
      </div>
      {(['Scheduled', 'Ongoing', 'Completed'] as const).map((status) => (
        <div className="campaign-mini-stat" key={status}>
          <span>{status}</span>
          <strong>{campaignList.filter((campaign) => campaign.status === status).length}</strong>
        </div>
      ))}
    </div>
  );
}
