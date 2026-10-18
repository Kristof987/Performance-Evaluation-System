import { API_BASE_URL } from '../config';

export type AccessTokenGetter = () => Promise<string>;

export class ApiAccessError extends Error {
  constructor(public readonly status: 401 | 403, detail?: string) {
    super(status === 401 ? 'Your session could not be verified. Sign in again.' : detail ?? 'You do not have permission to perform this action.');
  }
}

export async function authenticatedApiFetch(
  getAccessToken: AccessTokenGetter,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    throw new Error('Could not acquire an access token. Please try again.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (response.status === 401 || response.status === 403) {
    const body: unknown = response.status === 403 ? await response.json().catch(() => null) : null;
    const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
      ? body.detail : undefined;
    throw new ApiAccessError(response.status, detail);
  }
  return response;
}
