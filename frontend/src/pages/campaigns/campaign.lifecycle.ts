export type CampaignLifecycleStatus = 'Scheduled' | 'Ongoing' | 'Completed' | 'Disabled';
export type CampaignWorkflowStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'review' | 'closed';

export type CampaignSchedule = {
  lifecycle_status: CampaignLifecycleStatus;
};

export function calendarDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function getCampaignLifecycleStatus(
  campaign: CampaignSchedule,
): CampaignLifecycleStatus {
  return campaign.lifecycle_status;
}
