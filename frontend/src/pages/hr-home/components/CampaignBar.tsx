import './CampaignBar.css';
import { ChevronDown, Folder } from 'lucide-react';
import { useState } from 'react';

import type { Campaign } from '../hrHome.types';
import CampaignStatusBadge from '../../campaigns/components/CampaignStatusBadge';

type CampaignBarProps = {
  isLoading: boolean;
  error: string;
  campaigns: Campaign[];
  selectedCampaign: Campaign | null;
  onSelectCampaign: (campaignId: number) => void;
  onCreateCampaign: () => void;
  canManageCampaigns: boolean;
  onViewCampaignDetails: () => void;
};

function CampaignBar({
  isLoading,
  error,
  campaigns,
  selectedCampaign,
  onSelectCampaign,
  onCreateCampaign,
  canManageCampaigns,
  onViewCampaignDetails,
}: CampaignBarProps) {
  const [isCampaignListOpen, setIsCampaignListOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="campaign-bar">
        <div className="campaign-selector">
          <Folder size={16} color="#4553C4" />
          <div className="campaign-name">Loading dashboard...</div>
        </div>
      </div>
    );
  }

  if (error !== '') {
    return (
      <div className="card empty-campaign-card">
        <div>
          <div className="empty-campaign-title">Dashboard is unavailable</div>
          <div className="empty-campaign-text">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="card empty-campaign-card">
        <div>
          <div className="empty-campaign-title">No campaigns yet</div>
          <div className="empty-campaign-text">
            {canManageCampaigns ? 'Create your first campaign to start collecting performance feedback.' : 'No campaigns are available yet.'}
          </div>
        </div>
        {canManageCampaigns && <button
          type="button"
          className="btn btn-primary empty-campaign-button"
          onClick={onCreateCampaign}
        >
          Create campaign
        </button>}
      </div>
    );
  }

  return (
    <div className="campaign-bar">
      <div className="campaign-selector-wrap">
        <button
          type="button"
          className="campaign-selector"
          onClick={() => setIsCampaignListOpen(!isCampaignListOpen)}
        >
          <Folder size={16} color="#4553C4" />
          <div className="campaign-name">{selectedCampaign?.name}</div>
          {selectedCampaign && <CampaignStatusBadge status={selectedCampaign.campaign_status} />}
          {selectedCampaign?.is_archived && <span className="campaign-archived-label">Archived</span>}
          <ChevronDown size={14} color="#5A6079" />
        </button>
        {isCampaignListOpen && (
          <div className="campaign-dropdown">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className="campaign-dropdown-item"
                onClick={() => {
                  onSelectCampaign(campaign.id);
                  setIsCampaignListOpen(false);
                }}
              >
                <span>{campaign.name}</span>
                <CampaignStatusBadge status={campaign.campaign_status} />
                {campaign.is_archived && <span className="campaign-archived-label">Archived</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="campaign-details-link"
        onClick={onViewCampaignDetails}
      >
        View campaign details →
      </button>
    </div>
  );
}

export default CampaignBar;
