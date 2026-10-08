import './CampaignBar.css';
import { ChevronDown, Folder } from 'lucide-react';
import { useState } from 'react';

import type { Campaign } from '../hrHome.types';
import { getCampaignStatusLabel } from '../utils/hrHome.utils';

type CampaignBarProps = {
  isLoading: boolean;
  error: string;
  campaigns: Campaign[];
  selectedCampaign: Campaign | null;
  onSelectCampaign: (campaignId: number) => void;
  onCreateCampaign: () => void;
  onViewCampaignDetails: () => void;
};

function CampaignBar({
  isLoading,
  error,
  campaigns,
  selectedCampaign,
  onSelectCampaign,
  onCreateCampaign,
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
            Refresh the page after the backend connection is restored.
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
            Create your first campaign to start collecting performance
            feedback.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary empty-campaign-button"
          onClick={onCreateCampaign}
        >
          Create campaign
        </button>
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
          <div className="badge badge-success campaign-status">
            {getCampaignStatusLabel(selectedCampaign?.is_active)}
          </div>
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
                <span>{getCampaignStatusLabel(campaign.is_active)}</span>
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
