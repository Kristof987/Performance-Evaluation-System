import { useEffect, useState } from 'react';
import { useAppAuth } from '../../../auth/AppAuth';
import { ApiAccessError } from '../../../auth/authenticated-api';

import { fetchDashboard } from '../services/dashboardService';
import type {
  Campaign,
  DashboardMetrics,
  DashboardParticipant,
  DashboardUpcomingDeadline,
} from '../hrHome.types';

export function useHrDashboard() {
  const { getAccessToken, retryAuth0 } = useAppAuth();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentDate, setCurrentDate] = useState<string | null>(null);
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
    if (!getAccessToken) {
      setError('Auth0 sign-in is required to view the Dashboard.');
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    void loadDashboard(undefined, controller.signal);
    return () => controller.abort();
  }, [getAccessToken]);

  async function loadDashboard(campaignId?: number, signal?: AbortSignal) {
    if (!getAccessToken) return;
    setIsLoading(true);

    try {
      const dashboard = await fetchDashboard(getAccessToken, campaignId, signal);
      if (signal?.aborted) return;
      setCampaigns(dashboard.campaigns);
      setCurrentDate(dashboard.current_date);
      setSelectedCampaignId(dashboard.selected_campaign_id);
      setMetrics(dashboard.metrics);
      setParticipants(dashboard.participants ?? []);
      setUpcomingDeadlines(dashboard.upcoming_deadlines ?? []);
      setError('');
    } catch (loadError) {
      if (signal?.aborted) return;
      if (loadError instanceof ApiAccessError) retryAuth0();
      setMetrics(null);
      setParticipants([]);
      setUpcomingDeadlines([]);
      setError(loadError instanceof ApiAccessError ? loadError.message : 'Dashboard could not be loaded.');
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }

  function selectCampaign(campaignId: number) {
    loadDashboard(campaignId);
  }

  return {
    campaigns,
    currentDate,
    selectedCampaign,
    metrics,
    participants,
    upcomingDeadlines,
    isLoading,
    error,
    selectCampaign,
  };
}
