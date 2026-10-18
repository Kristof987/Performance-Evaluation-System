import { authenticatedApiFetch, type AccessTokenGetter } from '../../../auth/authenticated-api';
import type { DashboardResponse } from '../hrHome.types';

export async function fetchDashboard(
  getAccessToken: AccessTokenGetter,
  campaignId?: number,
  signal?: AbortSignal,
): Promise<DashboardResponse> {
  const searchParams =
    campaignId === undefined ? '' : `?campaign_id=${campaignId}`;
  const response = await authenticatedApiFetch(getAccessToken, `/dashboard${searchParams}`, { signal });

  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }

  return (await response.json()) as DashboardResponse;
}
