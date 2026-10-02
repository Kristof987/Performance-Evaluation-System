import type {
  Campaign,
  CampaignFormValues,
  CampaignResponse,
} from './campaign.types';
import { mapCampaignFromResponse } from './campaign.utils';

const API_BASE_URL = 'http://localhost:8000';

async function requestCampaigns<T>(
  path: string,
  options: RequestInit,
  fallback: string,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/campaigns${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail =
      body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

function getPayload(form: CampaignFormValues) {
  return {
    name: form.name,
    description: form.description || null,
    start_date: form.startDate,
    end_date: form.endDate || null,
    is_active: form.isActive,
    comment: form.comment || null,
  };
}

export async function fetchCampaigns(signal: AbortSignal): Promise<Campaign[]> {
  const campaigns = await requestCampaigns<CampaignResponse[]>(
    '',
    { signal },
    'Campaigns could not be loaded.',
  );
  return campaigns.map(mapCampaignFromResponse);
}

export async function fetchCampaign(
  id: string,
  signal: AbortSignal,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      `/${encodeURIComponent(id)}`,
      { signal },
      'Campaign could not be loaded.',
    ),
  );
}

export async function createCampaign(
  form: CampaignFormValues,
  userId: number,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      '',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...getPayload(form), created_by: userId }),
      },
      'Campaign could not be saved.',
    ),
  );
}

export async function updateCampaign(
  id: string,
  form: CampaignFormValues,
): Promise<Campaign> {
  return mapCampaignFromResponse(
    await requestCampaigns<CampaignResponse>(
      `/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getPayload(form)),
      },
      'Campaign could not be updated.',
    ),
  );
}
