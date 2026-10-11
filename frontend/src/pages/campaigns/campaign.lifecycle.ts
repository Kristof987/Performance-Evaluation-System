export type CampaignLifecycleStatus = 'Scheduled' | 'Ongoing' | 'Completed' | 'Disabled';

export type CampaignSchedule = {
  is_active: boolean;
  start_date: string;
  end_date: string | null;
  current_date?: string;
};

export function getCalendarToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function calendarDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function getCampaignLifecycleStatus(
  campaign: CampaignSchedule,
  today = campaign.current_date ?? getCalendarToday(),
): CampaignLifecycleStatus {
  if (!campaign.is_active) return 'Disabled';
  const currentDay = calendarDay(today);
  if (calendarDay(campaign.start_date) > currentDay) return 'Scheduled';
  if (campaign.end_date && calendarDay(campaign.end_date) < currentDay) return 'Completed';
  return 'Ongoing';
}
