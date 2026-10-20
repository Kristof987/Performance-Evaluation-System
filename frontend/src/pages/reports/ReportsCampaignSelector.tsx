import type { ReportCampaignOption } from './types/reports.types';

export default function ReportsCampaignSelector({ campaigns, selectedCampaignId, onSelect }: { campaigns: ReportCampaignOption[]; selectedCampaignId: number | null; onSelect: (campaignId: number) => void }) {
  if (campaigns.length === 0) return <div className="reports-selector-empty">No campaigns available.</div>;
  return <label className="reports-campaign-selector"><span className="sr-only">Selected campaign</span><select className="form-control" value={selectedCampaignId ?? ''} onChange={(event) => onSelect(Number(event.target.value))}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.campaign_status ?? 'Unavailable'}{campaign.is_archived ? ' · Archived' : ''}</option>)}</select></label>;
}
