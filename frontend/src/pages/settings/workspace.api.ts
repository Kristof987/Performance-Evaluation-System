import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type WorkspaceSettings = {
  min_individual_peer_reviewers: number;
  min_aggregate_evaluatees: number;
  ai_enabled: boolean;
  ai_model: string | null;
  updated_at: string | null;
  default_model: string | null;
  api_key_configured: boolean;
};

export type WorkspaceSettingsUpdate = Partial<Pick<WorkspaceSettings,
  'min_individual_peer_reviewers' | 'min_aggregate_evaluatees' | 'ai_enabled' | 'ai_model'>>;

export type PermissionMatrix = {
  roles: { id: number; name: string; description: string | null; built_in: boolean; active_users: number; permissions: string[] }[];
  permissions: { name: string; description: string }[];
};

export type AuditCategory = 'lifecycle' | 'archive' | 'operation' | 'privacy' | 'ai' | 'permissions' | 'accounts';

export type AuditEntry = {
  id: string;
  category: AuditCategory;
  occurred_at: string;
  actor_user_id: number | null;
  actor_name: string | null;
  is_automatic: boolean;
  campaign_id: number | null;
  campaign_name: string | null;
  summary: string;
};

function detailMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('detail' in body)) return null;
  const { detail } = body;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return 'Some values are out of range. Check the highlighted fields and try again.';
  return null;
}

async function request<T>(getAccessToken: AccessTokenGetter, path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(detailMessage(body) ?? 'Workspace settings request failed. Try again.');
  }
  return await response.json() as T;
}

const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });

export function fetchWorkspaceSettings(getAccessToken: AccessTokenGetter, signal?: AbortSignal) {
  return request<WorkspaceSettings>(getAccessToken, '/workspace/settings', { signal });
}

export function patchWorkspaceSettings(getAccessToken: AccessTokenGetter, changes: WorkspaceSettingsUpdate) {
  return request<WorkspaceSettings>(getAccessToken, '/workspace/settings', json('PATCH', changes));
}

export function fetchPermissionMatrix(getAccessToken: AccessTokenGetter, signal?: AbortSignal) {
  return request<PermissionMatrix>(getAccessToken, '/workspace/permissions', { signal });
}

export function savePermissionMatrix(getAccessToken: AccessTokenGetter, roles: { role_id: number; permissions: string[] }[]) {
  return request<PermissionMatrix>(getAccessToken, '/workspace/permissions', json('PUT', { roles }));
}

export function createSystemRole(getAccessToken: AccessTokenGetter,
  role: { name: string; description?: string | null; copy_from_role_id?: number | null }) {
  return request<PermissionMatrix>(getAccessToken, '/workspace/permissions/roles', json('POST', role));
}

export function deleteSystemRole(getAccessToken: AccessTokenGetter, roleId: number) {
  return request<PermissionMatrix>(getAccessToken, `/workspace/permissions/roles/${roleId}`, { method: 'DELETE' });
}

export function fetchAuditLog(getAccessToken: AccessTokenGetter, options: {
  category: AuditCategory | null; offset: number; limit: number; signal?: AbortSignal;
}) {
  const query = new URLSearchParams({ offset: String(options.offset), limit: String(options.limit) });
  if (options.category) query.set('category', options.category);
  return request<{ entries: AuditEntry[]; has_more: boolean }>(getAccessToken, `/workspace/audit?${query}`,
    { signal: options.signal });
}
