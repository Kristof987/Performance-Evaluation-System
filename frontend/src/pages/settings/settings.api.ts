import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type SettingsGroup = {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
};

export type AccountSettingsProfile = {
  id: number;
  username: string;
  full_name: string | null;
  email: string;
  company_role: string | null;
  system_role: string | null;
  groups: SettingsGroup[];
  is_active: boolean;
  last_login: string | null;
  profile_image_url?: string | null;
};

export async function fetchAccountSettingsProfile(
  getAccessToken: AccessTokenGetter, signal: AbortSignal,
): Promise<AccountSettingsProfile> {
  const response = await authenticatedApiFetch(getAccessToken, '/me/account-settings/profile', { signal });
  if (!response.ok) {
    throw new Error(response.status === 404 ? 'Account profile could not be found.' : 'Account profile could not be loaded.');
  }
  return await response.json() as AccountSettingsProfile;
}

export type SecuritySettings = {
  sign_in_method: 'auth0';
  identity_provider: string;
  password_reset_available: boolean;
  last_login: string | null;
  timezone: string;
};

async function settingsRequest<T>(getAccessToken: AccessTokenGetter, path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.detail === 'string' ? body.detail : 'Settings request failed. Try again.');
  }
  return await response.json() as T;
}

export function fetchSecuritySettings(getAccessToken: AccessTokenGetter, signal: AbortSignal) {
  return settingsRequest<SecuritySettings>(getAccessToken, '/me/security', { signal });
}

export function requestPasswordReset(getAccessToken: AccessTokenGetter) {
  return settingsRequest<{ message: string }>(getAccessToken, '/me/security/password-reset', { method: 'POST' });
}

export type Preferences = {
  theme: 'system' | 'light' | 'dark';
  language: 'en' | 'hu';
  date_format: 'locale' | 'iso';
  notify_new_assignment: boolean;
  notify_results_available: boolean;
  notify_campaign_status: boolean;
};

export const defaultPreferences: Preferences = {
  theme: 'system', language: 'en', date_format: 'locale',
  notify_new_assignment: true,
  notify_results_available: true, notify_campaign_status: true,
};

export function fetchPreferences(getAccessToken: AccessTokenGetter, signal: AbortSignal) {
  return settingsRequest<Preferences>(getAccessToken, '/me/preferences', { signal });
}

export function patchPreferences(
  getAccessToken: AccessTokenGetter, changes: Partial<Preferences>, signal?: AbortSignal,
) {
  return settingsRequest<Preferences>(getAccessToken, '/me/preferences', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes), signal,
  });
}

export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export function uploadProfilePhoto(getAccessToken: AccessTokenGetter, file: File) {
  const body = new FormData();
  body.append('file', file);
  return settingsRequest<{ profile_image_url: string | null }>(getAccessToken, '/me/profile-photo', { method: 'PUT', body });
}

export function deleteProfilePhoto(getAccessToken: AccessTokenGetter) {
  return settingsRequest<{ profile_image_url: string | null }>(getAccessToken, '/me/profile-photo', { method: 'DELETE' });
}
