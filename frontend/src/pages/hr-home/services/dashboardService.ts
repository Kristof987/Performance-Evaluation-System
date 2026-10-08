import { API_BASE_URL } from '../../../config';
import type { DashboardResponse } from '../hrHome.types';

export async function fetchDashboard(
  campaignId?: number,
): Promise<DashboardResponse> {
  const searchParams =
    campaignId === undefined ? '' : `?campaign_id=${campaignId}`;
  const response = await fetch(`${API_BASE_URL}/dashboard${searchParams}`);

  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }

  return (await response.json()) as DashboardResponse;
}
