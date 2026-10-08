import { useEffect, useState } from 'react';

import { fetchDashboard } from '../services/dashboardService';
import type {
  Campaign,
  DashboardMetrics,
  DashboardParticipant,
  DashboardUpcomingDeadline,
} from '../hrHome.types';

export function useHrDashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(
    null,
  );
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [participants, setParticipants] = useState<DashboardParticipant[]>([]);
  const [upcomingDeadlines, setUpcomingDeadlines] = useState<
    DashboardUpcomingDeadline[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? null;

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard(campaignId?: number) {
    setIsLoading(true);

    try {
      const dashboard = await fetchDashboard(campaignId);
      setCampaigns(dashboard.campaigns);
      setSelectedCampaignId(dashboard.selected_campaign_id);
      setMetrics(dashboard.metrics);
      setParticipants(dashboard.participants ?? []);
      setUpcomingDeadlines(dashboard.upcoming_deadlines ?? []);
      setError('');
    } catch (loadError) {
      console.log('Dashboard could not be loaded', loadError);
      setError('Dashboard could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }

  function selectCampaign(campaignId: number) {
    loadDashboard(campaignId);
  }

  return {
    campaigns,
    selectedCampaign,
    metrics,
    participants,
    upcomingDeadlines,
    isLoading,
    error,
    selectCampaign,
  };
}
