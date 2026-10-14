import { API_BASE_URL } from '../../config';

export type PerformanceDimension = {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

async function requestDimensionApi<T>(path: string, options: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/performance-dimensions${path}`, options);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : fallback);
  }
  return response.json() as Promise<T>;
}

export function fetchPerformanceDimensions(requesterUserId: number, signal: AbortSignal) {
  return requestDimensionApi<PerformanceDimension[]>(`?requester_user_id=${encodeURIComponent(requesterUserId)}&include_inactive=true`, { signal }, 'Performance dimensions could not be loaded.');
}

export function createPerformanceDimension(requesterUserId: number, payload: { name: string; description: string }) {
  return requestDimensionApi<PerformanceDimension>(`?requester_user_id=${encodeURIComponent(requesterUserId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: payload.name, description: payload.description || null }) }, 'Performance dimension could not be created.');
}

export function updatePerformanceDimension(requesterUserId: number, dimension: PerformanceDimension, payload: { name: string; description: string; isActive: boolean }) {
  return requestDimensionApi<PerformanceDimension>(`/${dimension.id}?requester_user_id=${encodeURIComponent(requesterUserId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: payload.name, description: payload.description || null, is_active: payload.isActive }) }, 'Performance dimension could not be saved.');
}
