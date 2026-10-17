import { API_BASE_URL } from '../../config';

export type AuthMe = {
  id: number;
  username: string;
  email: string;
  system_role_id: number;
  is_active: boolean;
  employee: {
    id: number;
    full_name: string;
    company_role_id: number;
    is_active: boolean;
  } | null;
};

export async function fetchAuthMe(
  getAccessToken: () => Promise<string>,
  signal?: AbortSignal,
): Promise<{ status: 'linked'; user: AuthMe } | { status: 'unlinked' | 'forbidden' }> {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (response.status === 401) return { status: 'unlinked' };
  if (response.status === 403) return { status: 'forbidden' };
  if (!response.ok) throw new Error('Could not check the PerfEval account');
  return { status: 'linked', user: await response.json() as AuthMe };
}
