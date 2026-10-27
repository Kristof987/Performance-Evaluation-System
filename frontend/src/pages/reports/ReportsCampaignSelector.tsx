import type { ReportCampaignOption } from './types/reports.types';

export default function ReportsCampaignSelector({ campaigns, selectedCampaignId, onSelect }: { campaigns: ReportCampaignOption[]; selectedCampaignId: number | null; onSelect: (campaignId: number) => void }) {
  if (campaigns.length === 0) return <div className="reports-selector-empty">No campaigns available.</div>;
  return <label className="reports-campaign-selector"><span>Selected campaign</span><select title={campaigns.find((campaign) => campaign.id === selectedCampaignId)?.name ?? 'Select campaign'} value={selectedCampaignId ?? ''} onChange={(event) => onSelect(Number(event.target.value))}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>;
}
