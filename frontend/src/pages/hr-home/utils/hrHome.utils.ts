import type { DashboardMetrics } from '../hrHome.types';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';

export function getTimeOfDay(): TimeOfDay {
  const currentHour = new Date().getHours();

  if (currentHour >= 5 && currentHour < 12) return 'morning';
  if (currentHour >= 12 && currentHour < 18) return 'afternoon';
  return 'evening';
}

export function getFullDate(): string {
  const currentDate = new Date();
  const currentDay = currentDate.getDate().toString();
  const currentMonth = currentDate.toLocaleDateString('en-US', {
    month: 'long',
  });
  const currentYear = currentDate.getFullYear().toString();
  const currentDayString = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
  }); //In case of another language, it may not start with capital letter!

  return (
    currentDayString +
    ', ' +
    currentDay +
    ' ' +
    currentMonth +
    ' ' +
    currentYear
  );
}

export function formatShortDate(value: string | null): string {
  if (value === null) {
    return 'No date';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

export function getCampaignStatusLabel(
  isActive: boolean | undefined,
): 'Active' | 'Closed' {
  return isActive ? 'Active' : 'Closed';
}

export function areResultsReadyToPublish(metrics: DashboardMetrics): boolean {
  return metrics.completion_rate === 100 && metrics.assignment_count > 0;
}
