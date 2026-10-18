import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type Section = {
  id: number;
  name: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

async function request<T>(getAccessToken: AccessTokenGetter, path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, `/sections${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Sections could not be saved.');
  }
  return body as T;
}

export function fetchSections(getAccessToken: AccessTokenGetter, signal?: AbortSignal) {
  return request<Section[]>(getAccessToken, '?include_archived=true', { signal });
}

export function saveSection(getAccessToken: AccessTokenGetter, sectionId: number | null, name: string) {
  return request<Section>(getAccessToken, sectionId === null ? '' : `/${sectionId}`, {
    method: sectionId === null ? 'POST' : 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function setSectionArchived(getAccessToken: AccessTokenGetter, sectionId: number, archived: boolean) {
  return request<Section>(getAccessToken, `/${sectionId}/${archived ? 'archive' : 'restore'}`, { method: 'POST' });
}
