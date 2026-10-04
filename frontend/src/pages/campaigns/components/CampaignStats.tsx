import type { Campaign } from '../campaign.types';
type Props =
  | { campaignList: Campaign[]; campaign?: never }
  | { campaign: Campaign; campaignList?: never };
export default function CampaignStats(props: Props) {
  if (props.campaign) {
    const campaign = props.campaign;
    return (
      <div className="campaign-stats">
        <div className="card campaign-stat">
          <span>Completion rate</span>
          <strong>
            {campaign.sent === 0
              ? '0%'
              : `${Math.round((campaign.done / campaign.sent) * 100)}%`}
          </strong>
        </div>
        <div className="card campaign-stat">
          <span>Submitted</span>
          <strong>
            {campaign.done} / {campaign.sent}
          </strong>
        </div>
        <div className="card campaign-stat">
          <span>
            {campaign.status === 'Closed'
              ? 'Not submitted'
              : 'Awaiting submission'}
          </span>
          <strong>{campaign.sent - campaign.done}</strong>
        </div>
        <div className="card campaign-stat">
          <span>Forms</span>
          <strong>{campaign.forms.length}</strong>
        </div>
      </div>
    );
  }
  const campaignList = props.campaignList;
  return (
    <div className="campaign-overview-stats">
      <div className="card campaign-mini-stat">
        <span>Total campaigns</span>
        <strong>{campaignList.length}</strong>
      </div>
      <div className="card campaign-mini-stat">
        <span>Active</span>
        <strong>
          {
            campaignList.filter((campaign) => campaign.status === 'Active')
              .length
          }
        </strong>
      </div>
      <div className="card campaign-mini-stat">
        <span>Closed</span>
        <strong>
          {
            campaignList.filter((campaign) => campaign.status === 'Closed')
              .length
          }
        </strong>
      </div>
    </div>
  );
}
