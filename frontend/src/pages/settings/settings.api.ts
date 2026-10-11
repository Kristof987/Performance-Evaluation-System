import { API_BASE_URL } from '../../config';

export type SettingsGroup = {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
};

export type AccountSettingsProfile = {
  id: number;
  username: string;
  email: string;
  company_role: string;
  system_role: string | null;
  groups: SettingsGroup[];
  is_active: boolean;
  last_login: string | null;
};

export async function fetchAccountSettingsProfile(userId: number, signal: AbortSignal): Promise<AccountSettingsProfile> {
  const response = await fetch(`${API_BASE_URL}/users/${userId}/account-settings/profile`, { signal });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Account profile could not be found.' : 'Account profile could not be loaded.');
  }
  return await response.json() as AccountSettingsProfile;
}
