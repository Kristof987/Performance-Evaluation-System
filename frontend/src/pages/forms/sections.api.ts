import { API_BASE_URL } from '../../config';

export type Section = {
  id: number;
  name: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, requesterUserId: number, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/sections${path}${path.includes('?') ? '&' : '?'}requester_user_id=${requesterUserId}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Sections could not be saved.');
  }
  return body as T;
}

export function fetchSections(requesterUserId: number, signal?: AbortSignal) {
  return request<Section[]>('?include_archived=true', requesterUserId, { signal });
}

export function saveSection(requesterUserId: number, sectionId: number | null, name: string) {
  return request<Section>(sectionId === null ? '' : `/${sectionId}`, requesterUserId, {
    method: sectionId === null ? 'POST' : 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function setSectionArchived(requesterUserId: number, sectionId: number, archived: boolean) {
  return request<Section>(`/${sectionId}/${archived ? 'archive' : 'restore'}`, requesterUserId, { method: 'POST' });
}
