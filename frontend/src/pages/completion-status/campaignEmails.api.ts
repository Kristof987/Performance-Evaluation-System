import { authenticatedApiFetch, type AccessTokenGetter } from '../../auth/authenticated-api';

export type CampaignReminder = {
  id: number | null;
  days_before_end: number;
  scheduled_for: string | null;
  sent_count: number;
  last_sent_at: string | null;
};

export type CampaignEmailOverview = {
  email_configured: boolean;
  launch_email_enabled: boolean;
  uses_workspace_defaults: boolean;
  launch_sent_count: number;
  failed_count: number;
  manual_last_sent_at: string | null;
  open_recipients: number;
  reminders: CampaignReminder[];
  now: string;
};

type ManualReminderResult = { sent: number; failed: number; skipped_recently_reminded: number };

async function request<T>(getAccessToken: AccessTokenGetter, path: string, init: RequestInit = {}): Promise<T> {
  const response = await authenticatedApiFetch(getAccessToken, path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null;
    throw new Error(typeof detail === 'string' ? detail : 'Campaign emails could not be updated.');
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const fetchCampaignEmails = (getAccessToken: AccessTokenGetter, campaignId: number, signal?: AbortSignal) =>
  request<CampaignEmailOverview>(getAccessToken, `/campaigns/${campaignId}/emails`, { signal });

export const addCampaignReminder = (getAccessToken: AccessTokenGetter, campaignId: number, daysBeforeEnd: number) =>
  request<CampaignEmailOverview>(getAccessToken, `/campaigns/${campaignId}/emails/reminders`, json('POST', { days_before_end: daysBeforeEnd }));

export const deleteCampaignReminder = (getAccessToken: AccessTokenGetter, campaignId: number, daysBeforeEnd: number) =>
  request<CampaignEmailOverview>(getAccessToken, `/campaigns/${campaignId}/emails/reminders/${daysBeforeEnd}`, { method: 'DELETE' });

export const resetCampaignReminders = (getAccessToken: AccessTokenGetter, campaignId: number) =>
  request<CampaignEmailOverview>(getAccessToken, `/campaigns/${campaignId}/emails/reminders/reset`, { method: 'POST' });

export type ReminderRecipient = {
  employee_id: number;
  name: string;
  email: string;
  not_started: number;
  in_progress: number;
  last_reminded_at: string | null;
  recently_reminded: boolean;
};

export const fetchReminderRecipients = (getAccessToken: AccessTokenGetter, campaignId: number) =>
  request<ReminderRecipient[]>(getAccessToken, `/campaigns/${campaignId}/emails/recipients`);

export const setLaunchEmail = (getAccessToken: AccessTokenGetter, campaignId: number, enabled: boolean) =>
  request<CampaignEmailOverview>(getAccessToken, `/campaigns/${campaignId}/emails/launch`, json('PUT', { enabled }));

/** Without employee ids everyone with unfinished evaluations is reminded. */
export const sendReminderNow = (getAccessToken: AccessTokenGetter, campaignId: number, employeeIds?: number[]) =>
  request<ManualReminderResult>(getAccessToken, `/campaigns/${campaignId}/emails/send`,
    json('POST', employeeIds ? { employee_ids: employeeIds } : {}));

export function reminderDayLabel(days: number) {
  return days === 0 ? 'On the last day' : `${days} ${days === 1 ? 'day' : 'days'} before the end`;
}
